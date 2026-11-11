import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { VmInstance } from "@locus/shared";
import {
  DOCKER_TOOLS,
  DOCKER_WORKSPACE,
  normalizePatchCwd,
  type ComputerUseToolName,
} from "@locus/shared";
import { linuxCommand, wrapNohupCommand } from "./commands.js";
import { writeFileKeepExec } from "./workspaceWrite.js";
import { applyGuestPatch } from "./applyPatch.js";
import { isHostFile, lexicalHostPath, resolveReadPath, resolveWritePath } from "./hostPath.js";
import {
  CdpChromiumDriver,
  dispatchBrowserTool,
  isBrowserToolRequest,
  type ChromiumDriver,
} from "./chromium.js";
import type { GuestRuntime, ToolRequest, ToolResult } from "./types.js";
import { str } from "./types.js";

const DOCKER_SET = new Set<string>(DOCKER_TOOLS);

/** HOME for `docker exec -u` so npm/git can write caches without /root. */
export const DOCKER_AGENT_HOME = "/tmp/locus-home";

const WORKSPACE_USER_TOOLS = new Set(["exec", "file_write", "start_process"]);

export type DockerExec = (
  argv: string[],
  opts?: { onOutput?: (chunk: string) => void },
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Package-manager installs that must stay root (and then chown the workspace). */
export function dockerExecNeedsRoot(command: string): boolean {
  if (/\b(apt-get|apt|apk|yum|dnf|microdnf|pacman|zypper|sudo)\b/.test(command)) return true;
  if (/\b(npm|pnpm|yarn)\b/.test(command) && /\s(-g|--global)\b/.test(command)) return true;
  return false;
}

export class DockerGuestRuntime implements GuestRuntime {
  readonly os: VmInstance["os"];
  readonly liveGuest = true;
  private browser?: ChromiumDriver;

  constructor(
    private readonly vm: VmInstance,
    private readonly runner: DockerExec = dockerExec,
    browser?: ChromiumDriver,
  ) {
    this.os = vm.os;
    this.browser = browser;
  }

  async execute(
    req: ToolRequest,
    _signal?: AbortSignal,
    onOutput?: (chunk: string) => void,
  ): Promise<ToolResult> {
    if (!DOCKER_SET.has(req.name)) {
      return { ok: false, output: `${req.name} is not available in a Docker agent` };
    }
    if (req.name === "preview") {
      return { ok: true, output: "preview is handled by the control plane" };
    }
    const cid = this.vm.containerId;
    if (!cid) return { ok: false, output: "Container is not running" };
    if (isBrowserToolRequest(req)) {
      return dispatchBrowserTool(req, this.browserFor(cid));
    }
    if (req.name === "apply_patch") {
      const host = await this.applyPatchOnHost(req);
      // Host apply already parsed the patch. A failure is the real error —
      // do not fall through to `git apply`/`patch` in the image (often missing,
      // and the second error hides the hunk mismatch).
      if (host) return host;
    }
    const remote = dockerCommand(req);
    const owner = this.workspaceOwner();
    const asRoot = req.name === "exec" && dockerExecNeedsRoot(str(req.args, "command"));
    const user = owner && !asRoot && WORKSPACE_USER_TOOLS.has(req.name) ? owner : undefined;
    const argv = this.dockerExecArgv(cid, remote, user);
    const result = await this.runner(argv, onOutput ? { onOutput } : undefined);
    const output = [result.stdout, result.stderr]
      .filter((part) => part.trim())
      .join("\n")
      .trim();
    const ok = result.code === 0;
    if (ok && (req.name === "git_clone" || req.name === "git_fetch")) {
      await this.copyWorkspaceToHost();
      await this.alignWorkspaceOwner();
    } else if (ok && asRoot) {
      await this.alignWorkspaceOwner();
    }
    return { ok, output: output || `(exit ${result.code})` };
  }

  async prepareHostWorkspace(): Promise<void> {
    await this.alignWorkspaceOwner();
  }

  private browserFor(cid: string): ChromiumDriver {
    this.browser ??= new CdpChromiumDriver(cid, this.runner);
    return this.browser;
  }

  chromium(): ChromiumDriver | undefined {
    const cid = this.vm.containerId;
    if (!cid) return undefined;
    return this.browserFor(cid);
  }

  async syncHostDirToGuest(hostDir: string, guestDir: string): Promise<void> {
    const cid = this.vm.containerId;
    const host = hostDir.trim();
    const dest = sanitizeGuestWorkspaceDir(guestDir);
    if (!cid || !host || !dest || !existsSync(host)) return;
    try {
      await this.runner(["docker", "exec", cid, "mkdir", "-p", dest]);
      await this.runner(["docker", "cp", `${host}/.`, `${cid}:${dest}/`]);
    } catch {
      /* bind mount already shares the tree, or the daemon cannot see hostDir */
    }
  }

  private workspaceOwner(): { uid: number; gid: number } | undefined {
    const hostRoot = this.vm.diskPath?.trim();
    if (!hostRoot) return undefined;
    try {
      const st = statSync(hostRoot);
      return { uid: st.uid, gid: st.gid };
    } catch {
      return undefined;
    }
  }

  private dockerExecArgv(
    cid: string,
    remote: string,
    user?: { uid: number; gid: number },
  ): string[] {
    const argv = ["docker", "exec", "-w", DOCKER_WORKSPACE];
    if (user) {
      argv.push("-u", `${user.uid}:${user.gid}`, "-e", `HOME=${DOCKER_AGENT_HOME}`);
      remote = `mkdir -p ${DOCKER_AGENT_HOME}; ${remote}`;
    }
    argv.push(cid, "sh", "-lc", remote);
    return argv;
  }

  /**
   * git clone in the container runs as root, so nested dirs are root-owned on
   * the bind mount. Host apply_patch then gets EACCES. Match the workspace
   * directory owner (the Locus process) after clone/fetch. Also called before
   * host-side `npm test` so Vite can write `node_modules/.vite-temp`.
   */
  private async alignWorkspaceOwner(): Promise<void> {
    const hostRoot = this.vm.diskPath?.trim();
    const cid = this.vm.containerId;
    if (!hostRoot || !cid) return;
    try {
      const st = statSync(hostRoot);
      await this.runner([
        "docker",
        "exec",
        cid,
        "chown",
        "-R",
        `${st.uid}:${st.gid}`,
        DOCKER_WORKSPACE,
      ]);
    } catch {
      /* image may lack chown */
    }
  }

  /**
   * Clone / fetch write into the guest. Copy onto diskPath so Files can list
   * the tree when the bind mount is not the same directory.
   */
  private async copyWorkspaceToHost(): Promise<void> {
    const hostRoot = this.vm.diskPath?.trim();
    const cid = this.vm.containerId;
    if (!hostRoot || !cid) return;
    try {
      await mkdir(hostRoot, { recursive: true });
      await this.runner(["docker", "cp", `${cid}:${DOCKER_WORKSPACE}/.`, `${hostRoot}/`]);
    } catch {
      /* bind mount already shares the tree, or the daemon cannot see hostRoot */
    }
  }

  /** Official images like ubuntu:24.04 do not ship `git` or `patch`. Apply on the bind-mounted workspace. */
  private async applyPatchOnHost(req: ToolRequest): Promise<ToolResult | undefined> {
    const hostRoot = this.vm.diskPath?.trim();
    if (!hostRoot) return undefined;
    return applyGuestPatch({
      patch: str(req.args, "patch"),
      requestedCwd: str(req.args, "path", DOCKER_WORKSPACE),
      workspace: DOCKER_WORKSPACE,
      isFile: (p) => isHostFile(lexicalHostPath(p, hostRoot)),
      read: async (guest) => {
        if (!(await resolveWritePath(guest, hostRoot))) {
          return { ok: false, output: `path is outside /workspace: ${guest}` };
        }
        const hostPath = await resolveReadPath(guest, hostRoot);
        if (!hostPath) return { content: undefined };
        try {
          return { content: await readFile(hostPath, "utf8") };
        } catch {
          return { content: undefined };
        }
      },
      write: async (guest, content) => {
        const hostPath = await resolveWritePath(guest, hostRoot);
        if (!hostPath) return { ok: false, output: `path is outside /workspace: ${guest}` };
        await mkdir(dirname(hostPath), { recursive: true });
        // docker file_write is root:644; unlink so the host-owned workspace can replace it.
        await writeFileKeepExec(hostPath, content, { replace: true });
      },
      remove: async (guest) => {
        const hostPath = await resolveReadPath(guest, hostRoot);
        if (hostPath) await unlink(hostPath).catch(() => undefined);
      },
    });
  }
}

export function dockerCommand(req: ToolRequest): string {
  const ws = DOCKER_WORKSPACE;
  const args = { ...req.args };
  if (req.name === "git_clone" && !str(args, "dest")) args.dest = ws;
  if (req.name === "git_fetch" && !str(args, "path")) args.path = ws;
  if (req.name === "apply_patch") {
    args.path = normalizePatchCwd(str(args, "path", ws), ws);
  } else if (
    (req.name === "git_status" ||
      req.name === "git_diff" ||
      req.name === "git_log" ||
      req.name === "git_commit" ||
      req.name === "git_branch" ||
      req.name === "git_push" ||
      req.name === "git_stash" ||
      req.name === "git_revert" ||
      req.name === "grep" ||
      req.name === "glob") &&
    !str(args, "path")
  ) {
    args.path = ws;
  }
  if (req.name === "start_process") {
    return wrapNohupCommand(str(args, "command"));
  }
  if (req.name === "record_screen") {
    return `export DISPLAY="\${DISPLAY:-:99}"; ${linuxCommand({ name: req.name as ComputerUseToolName, args }, "ubuntu")}`;
  }
  return linuxCommand({ name: req.name as ComputerUseToolName, args }, "ubuntu");
}

function sanitizeGuestWorkspaceDir(raw: string): string | undefined {
  const dest = raw.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (dest !== DOCKER_WORKSPACE && !dest.startsWith(`${DOCKER_WORKSPACE}/`)) return undefined;
  if (dest.split("/").includes("..")) return undefined;
  return dest;
}

async function dockerExec(
  argv: string[],
  opts?: { onOutput?: (chunk: string) => void },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const take = (d: Buffer, sink: "stdout" | "stderr") => {
      const chunk = d.toString();
      if (sink === "stdout") stdout += chunk;
      else stderr += chunk;
      opts?.onOutput?.(chunk);
    };
    child.stdout?.on("data", (d: Buffer) => take(d, "stdout"));
    child.stderr?.on("data", (d: Buffer) => take(d, "stderr"));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}
