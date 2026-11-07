import { rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DockerEngine, Hypervisor } from "@locus/hypervisor";
import {
  LOCUS_CHROME_PROFILE_DIR,
  rewindTargets,
  snapshotCheckpointWorkingState,
  type AgentSession,
  type SessionCheckpoint,
} from "@locus/shared";

const execFileAsync = promisify(execFile);

export async function snapshotMachineCheckpoint(opts: {
  docker: boolean;
  running: boolean;
  vmId: string;
  destPath: string;
  dockerEngine: Pick<DockerEngine, "snapshotWorkspace">;
  hypervisor: Pick<Hypervisor, "snapshotDisk" | "snapshotRequiresPause" | "pause" | "resume">;
}): Promise<boolean> {
  if (opts.docker && opts.dockerEngine.snapshotWorkspace) {
    await opts.dockerEngine.snapshotWorkspace(opts.vmId, opts.destPath);
    return true;
  }
  if (opts.docker || !opts.hypervisor.snapshotDisk) return false;
  const pauseGuest = Boolean(opts.hypervisor.snapshotRequiresPause && opts.running);
  if (pauseGuest) await opts.hypervisor.pause(opts.vmId).catch(() => undefined);
  try {
    await opts.hypervisor.snapshotDisk(opts.vmId, opts.destPath);
    return true;
  } catch {
    return false;
  } finally {
    if (pauseGuest && opts.hypervisor.resume)
      await opts.hypervisor.resume(opts.vmId).catch(() => undefined);
  }
}

export async function restoreMachineCheckpoint(opts: {
  docker: boolean;
  running: boolean;
  vmId: string;
  srcPath: string;
  dockerEngine: Pick<DockerEngine, "restoreWorkspace">;
  hypervisor: Pick<Hypervisor, "restoreDisk" | "restoreRequiresStop">;
  stop: () => Promise<unknown>;
  start: () => Promise<unknown>;
}): Promise<void> {
  if (opts.docker) {
    if (opts.running) await opts.stop();
    await opts.dockerEngine.restoreWorkspace?.(opts.vmId, opts.srcPath);
    if (opts.running) await opts.start();
    return;
  }
  if (!opts.hypervisor.restoreDisk) return;
  const stopFirst = Boolean(opts.hypervisor.restoreRequiresStop && opts.running);
  if (stopFirst) await opts.stop();
  await opts.hypervisor.restoreDisk(opts.vmId, opts.srcPath);
  if (stopFirst) await opts.start();
}

export const LOCUS_CHECKPOINT_REF_PREFIX = "refs/locus/checkpoints/";

export function checkpointGitRef(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
  return `${LOCUS_CHECKPOINT_REF_PREFIX}${clean || "turn"}`;
}

async function git(
  cwd: string,
  args: string[],
  extraEnv?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd,
    maxBuffer: 2_000_000,
    timeout: 12_000,
    windowsHide: true,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
}

/** Snapshot the worktree (including uncommitted files) at a hidden ref for turn diffs. */
export async function writeCheckpointRef(
  workspace: string,
  checkpointId: string,
): Promise<string | undefined> {
  const indexFile = join(workspace, ".git", "locus-checkpoint.index");
  try {
    const inside = await git(workspace, ["rev-parse", "--is-inside-work-tree"]);
    if (inside.stdout.trim() !== "true") return undefined;
    const ref = checkpointGitRef(checkpointId);
    const indexEnv = { GIT_INDEX_FILE: indexFile };
    try {
      await git(workspace, ["read-tree", "HEAD"], indexEnv);
    } catch {
      /* empty repo: start from an empty index */
    }
    await git(workspace, ["add", "-A"], indexEnv);
    const tree = (await git(workspace, ["write-tree"], indexEnv)).stdout.trim();
    if (!tree) return undefined;
    let parent: string | undefined;
    try {
      parent = (await git(workspace, ["rev-parse", "HEAD"])).stdout.trim();
    } catch {
      parent = undefined;
    }
    const commitArgs = parent
      ? ["commit-tree", tree, "-p", parent, "-m", `locus checkpoint ${checkpointId}`]
      : ["commit-tree", tree, "-m", `locus checkpoint ${checkpointId}`];
    const commit = (await git(workspace, commitArgs)).stdout.trim();
    if (!commit) return undefined;
    await git(workspace, ["update-ref", ref, commit]);
    return ref;
  } catch {
    return undefined;
  } finally {
    await unlink(indexFile).catch(() => undefined);
  }
}

export async function diffCheckpointRefs(
  workspace: string,
  fromRef: string,
  toRef: string,
): Promise<string> {
  const stat = (await git(workspace, ["diff", "--stat", fromRef, toRef])).stdout.trim();
  let patch = "";
  try {
    patch = (await git(workspace, ["diff", fromRef, toRef])).stdout.trim();
  } catch {
    /* empty trees */
  }
  if (patch.length > 20_000) patch = `${patch.slice(0, 20_000)}\n… truncated …`;
  return [stat, patch].filter(Boolean).join("\n\n");
}

/** True when undo needs a full `/workspace` copy (no git, or guest Chromium profile). */
export async function checkpointNeedsFullSnapshot(workspace: string): Promise<boolean> {
  try {
    const inside = await git(workspace, ["rev-parse", "--is-inside-work-tree"]);
    if (inside.stdout.trim() !== "true") return true;
  } catch {
    return true;
  }
  try {
    const chrome = await stat(join(workspace, LOCUS_CHROME_PROFILE_DIR));
    if (chrome.isDirectory()) return true;
  } catch {
    /* no browser profile */
  }
  return false;
}

/** Restore the worktree to a hidden checkpoint ref without moving HEAD. */
export async function restoreCheckpointRef(workspace: string, ref: string): Promise<boolean> {
  const indexFile = join(workspace, ".git", "locus-checkpoint.index");
  try {
    const inside = await git(workspace, ["rev-parse", "--is-inside-work-tree"]);
    if (inside.stdout.trim() !== "true") return false;
    await git(workspace, ["rev-parse", "--verify", ref]);
    const indexEnv = { GIT_INDEX_FILE: indexFile };
    await git(workspace, ["read-tree", ref], indexEnv);
    await git(workspace, ["checkout-index", "-a", "-f"], indexEnv);
    const inTree = new Set(
      (await git(workspace, ["ls-tree", "-r", "--name-only", ref])).stdout
        .split("\n")
        .map((row) => row.trim())
        .filter(Boolean),
    );
    const extras = new Set<string>();
    try {
      for (const row of (await git(workspace, ["ls-files"])).stdout.split("\n")) {
        const path = row.trim();
        if (path && !inTree.has(path)) extras.add(path);
      }
    } catch {
      /* empty index */
    }
    try {
      for (const row of (
        await git(workspace, [
          "-c",
          "core.quotepath=false",
          "ls-files",
          "--others",
          "--exclude-standard",
        ])
      ).stdout.split("\n")) {
        const path = row.trim();
        if (path && !inTree.has(path)) extras.add(path);
      }
    } catch {
      /* ignore */
    }
    for (const path of extras) {
      await rm(join(workspace, path), { force: true }).catch(() => undefined);
    }
    await rm(join(workspace, LOCUS_CHROME_PROFILE_DIR), { recursive: true, force: true }).catch(
      () => undefined,
    );
    return true;
  } catch {
    return false;
  } finally {
    await unlink(indexFile).catch(() => undefined);
  }
}

export async function deleteCheckpointRef(workspace: string, ref: string): Promise<void> {
  try {
    await git(workspace, ["update-ref", "-d", ref]);
  } catch {
    /* already gone */
  }
}

export type CheckpointMachine = {
  id: string;
  status: string;
  diskPath: string;
};

export type CaptureCheckpointPorts = {
  writeGitRef: (workspace: string, checkpointId: string) => Promise<string | undefined>;
  needsFullSnapshot: (workspace: string) => Promise<boolean>;
  snapshotMachine: (opts: {
    docker: boolean;
    running: boolean;
    vmId: string;
    destPath: string;
  }) => Promise<boolean>;
  deleteGitRef: (workspace: string, ref: string) => Promise<void>;
  removePath: (path: string) => Promise<void>;
};

export function isCheckpointGuestRunning(status: string): boolean {
  return status === "running" || status === "ready";
}

export function dockerCheckpointDest(
  dataDir: string,
  sessionId: string,
  checkpointId: string,
): string {
  return join(dataDir, "checkpoints", sessionId, checkpointId);
}

export function vmCheckpointDest(dataDir: string, sessionId: string, checkpointId: string): string {
  return join(dataDir, "checkpoints", sessionId, `${checkpointId}.qcow2`);
}

export async function dropCheckpointArtifacts(
  workspace: string | undefined,
  dropped: SessionCheckpoint[],
  ports: Pick<CaptureCheckpointPorts, "deleteGitRef" | "removePath">,
): Promise<void> {
  for (const item of dropped) {
    if (item.diskPath) await ports.removePath(item.diskPath);
    if (item.gitRef && workspace) await ports.deleteGitRef(workspace, item.gitRef);
  }
}

export async function fsRemoveCheckpointPath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

export async function captureTurnCheckpoint(input: {
  session: Pick<
    AgentSession,
    "id" | "messages" | "scratchpad" | "taskList" | "plan" | "checkpoints" | "checkpoint"
  >;
  messageCount?: number;
  createdAt: string;
  id: string;
  dataDir: string;
  vm?: CheckpointMachine;
  docker: boolean;
  canSnapshotWorkspace: boolean;
  canSnapshotDisk: boolean;
  maxCheckpoints: number;
  ports: CaptureCheckpointPorts;
}): Promise<SessionCheckpoint[]> {
  const checkpoint: SessionCheckpoint = {
    id: input.id,
    messageCount: input.messageCount ?? input.session.messages.length,
    createdAt: input.createdAt,
    ...snapshotCheckpointWorkingState(input.session),
  };
  const vm = input.vm;
  if (vm && input.docker && input.canSnapshotWorkspace) {
    const dest = dockerCheckpointDest(input.dataDir, input.session.id, checkpoint.id);
    try {
      const gitRef = await input.ports.writeGitRef(vm.diskPath, checkpoint.id);
      if (gitRef) checkpoint.gitRef = gitRef;
      const needsDisk = !gitRef || (await input.ports.needsFullSnapshot(vm.diskPath));
      if (needsDisk) {
        const ok = await input.ports.snapshotMachine({
          docker: true,
          running: isCheckpointGuestRunning(vm.status),
          vmId: vm.id,
          destPath: dest,
        });
        if (ok) checkpoint.diskPath = dest;
      }
    } catch {
      /* chat rewind still works without a workspace snapshot */
    }
  } else if (vm && input.canSnapshotDisk && !input.docker) {
    const dest = vmCheckpointDest(input.dataDir, input.session.id, checkpoint.id);
    const ok = await input.ports.snapshotMachine({
      docker: false,
      running: isCheckpointGuestRunning(vm.status),
      vmId: vm.id,
      destPath: dest,
    });
    if (ok) checkpoint.diskPath = dest;
  }
  const next = [...rewindTargets(input.session), checkpoint];
  while (next.length > input.maxCheckpoints) {
    const old = next.shift();
    if (old?.diskPath) await input.ports.removePath(old.diskPath);
    if (old?.gitRef && vm?.diskPath) await input.ports.deleteGitRef(vm.diskPath, old.gitRef);
  }
  return next;
}

export async function restoreWorkspaceCheckpoint(input: {
  checkpoint: SessionCheckpoint;
  vmId?: string;
  workspace?: string;
  restoreDisk: (srcPath: string) => Promise<void>;
  restoreGit: (workspace: string, ref: string) => Promise<unknown>;
  dropDropped: () => Promise<void>;
}): Promise<void> {
  if (input.checkpoint.diskPath && input.vmId) {
    try {
      await input.restoreDisk(input.checkpoint.diskPath);
    } finally {
      await input.dropDropped();
    }
    return;
  }
  if (input.checkpoint.gitRef && input.workspace) {
    await input.restoreGit(input.workspace, input.checkpoint.gitRef);
  }
  await input.dropDropped();
}

export async function diffTurnCheckpoints(
  targets: SessionCheckpoint[],
  checkpointId: string,
  workspace: string | undefined,
  diffRefs: (root: string, fromRef: string, toRef: string) => Promise<string>,
): Promise<string> {
  const index = targets.findIndex((item) => item.id === checkpointId);
  const current = index >= 0 ? targets[index] : undefined;
  const previous = index > 0 ? targets[index - 1] : undefined;
  if (!current?.gitRef || !previous?.gitRef) {
    throw new Error("No git checkpoint diff for that turn");
  }
  if (!workspace) throw new Error("No workspace to diff");
  return diffRefs(workspace, previous.gitRef, current.gitRef);
}
