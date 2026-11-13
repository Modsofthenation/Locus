import type { AgentRuntime, WorkspaceFileChange } from "@locus/shared";
import { mergeWorkspaceChanges } from "@locus/shared";
import {
  parseWorkspaceFind,
  sanitizeWorkspaceRel,
  workspaceFindScript,
  WORKSPACE_FILE_MAX_BYTES,
  type WorkspaceEntry,
  WORKSPACE_LIST_MAX_ENTRIES,
} from "./workspaceFiles.js";

export type WorkspaceAccessKind = "unsupported" | "worker" | "host" | "docker" | "vm";

export type WorkspaceFile = { path: string; content: string; mtime: string; baseline?: string };

export type WorkspaceSaved = { path: string; mtime: string };

export type WorkspaceRawFile = { path: string; bytes: Buffer; mime: string; mtime: string };

export type GuestWorkspaceExec = (req: {
  name: string;
  args: Record<string, unknown>;
}) => Promise<{ ok: boolean; output: string }>;

export const WORKSPACE_UNSUPPORTED =
  "The Files editor is for Docker, Host, and VM agents. This session has no workspace on this machine.";
export const WORKSPACE_VM_MIRROR =
  "VM Files reads the guest over SSH when the machine is ready, otherwise the laptop vm-trees mirror (it can lag). Preview and parallel workers stay Docker/Host.";
export const WORKSPACE_FILE_MISSING = "File not found";
export const WORKSPACE_GUEST_STOPPED = "Guest is not running";

function isWorkspaceMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not found/i.test(message);
}

export function workspaceAccessKind(runtime: AgentRuntime, isWorker: boolean): WorkspaceAccessKind {
  if (runtime === "host" || runtime === "docker") {
    if (isWorker) return "worker";
    return runtime;
  }
  if (runtime === "vm") return "vm";
  return "unsupported";
}

export function workspaceUsesGuestFs(kind: WorkspaceAccessKind): boolean {
  return kind === "docker" || kind === "vm";
}

/** Process launch runs on this machine against the workspace (or worker/VM laptop mirror). */
export function canLaunchWorkspaceDebug(kind: WorkspaceAccessKind): boolean {
  return kind === "host" || kind === "docker" || kind === "worker" || kind === "vm";
}

export const WORKSPACE_DEBUG_WORKER_LAUNCH =
  "Process launch runs against the laptop worker mirror (not the remote guest). Prefer Host or local Docker when you need the live guest process.";

export const WORKSPACE_DEBUG_VM_LAUNCH =
  "Process launch runs against the laptop VM source mirror under vm-trees (not inside QEMU). Prefer Host or local Docker for a live guest process.";

export function workspaceDebugLaunchNote(
  kind: WorkspaceAccessKind,
  runtime: AgentRuntime,
): string | undefined {
  if (kind === "worker") return WORKSPACE_DEBUG_WORKER_LAUNCH;
  if (kind === "vm" || runtime === "vm") return WORKSPACE_DEBUG_VM_LAUNCH;
  return undefined;
}

export async function listGuestWorkspaceEntries(
  execute: GuestWorkspaceExec | undefined,
  rel: string | undefined,
  ready: boolean,
): Promise<WorkspaceEntry[] | undefined> {
  if (!execute || !ready) return undefined;
  try {
    const listed = await execute({
      name: "exec",
      args: { command: workspaceFindScript(rel) },
    });
    if (!listed.ok) {
      throw new Error(listed.output.trim() || "Could not list workspace files");
    }
    const entries = parseWorkspaceFind(listed.output, rel);
    return entries.length ? entries : undefined;
  } catch (err) {
    if (err instanceof Error && /could not list workspace files/i.test(err.message)) throw err;
    if (err instanceof Error && err.message.trim()) throw err;
    return undefined;
  }
}

export async function readGuestWorkspaceFile(
  execute: GuestWorkspaceExec | undefined,
  rel: string,
  ready: boolean,
): Promise<WorkspaceFile | undefined> {
  const clean = sanitizeWorkspaceRel(rel);
  if (!execute || !clean || !ready) return undefined;
  try {
    const path = `/workspace/${clean}`;
    const listed = await execute({
      name: "exec",
      args: { command: `head -c ${WORKSPACE_FILE_MAX_BYTES} -- ${JSON.stringify(path)}` },
    });
    if (!listed.ok) return undefined;
    if (listed.output.includes("\0"))
      throw new Error("Binary files cannot be opened in the host editor");
    return { path: clean, content: listed.output, mtime: new Date().toISOString() };
  } catch (err) {
    if (err instanceof Error && err.message.includes("Binary")) throw err;
    return undefined;
  }
}

export async function writeGuestWorkspaceFile(
  execute: GuestWorkspaceExec | undefined,
  rel: string,
  content: string,
  ready: boolean,
): Promise<void> {
  const clean = sanitizeWorkspaceRel(rel);
  if (!execute || !clean || !ready) return;
  try {
    await execute({
      name: "file_write",
      args: { path: `/workspace/${clean}`, content },
    });
  } catch {
    /* host bind mount already has the save */
  }
}

export async function mkdirGuestWorkspace(
  execute: GuestWorkspaceExec | undefined,
  rel: string,
  ready: boolean,
): Promise<void> {
  const clean = sanitizeWorkspaceRel(rel);
  if (!execute || !clean || !ready) return;
  try {
    await execute({
      name: "exec",
      args: { command: `mkdir -p -- ${JSON.stringify(`/workspace/${clean}`)}` },
    });
  } catch {
    /* host bind mount already has the folder */
  }
}

export async function deleteGuestWorkspacePath(
  execute: GuestWorkspaceExec | undefined,
  rel: string,
  ready: boolean,
): Promise<void> {
  const clean = sanitizeWorkspaceRel(rel);
  if (!execute || !clean || !ready) return;
  const quoted = JSON.stringify(`/workspace/${clean}`);
  try {
    await execute({
      name: "exec",
      args: { command: `rm -f -- ${quoted} || rmdir -- ${quoted}` },
    });
  } catch {
    /* host bind mount already dropped the path */
  }
}

export type WorkspaceListing = {
  entries: WorkspaceEntry[];
  changes: WorkspaceFileChange[];
  /** The listing stopped at the entry cap, so some paths are missing. */
  truncated?: boolean;
};

function withTruncation(listing: Omit<WorkspaceListing, "truncated">): WorkspaceListing {
  return listing.entries.length >= WORKSPACE_LIST_MAX_ENTRIES
    ? { ...listing, truncated: true }
    : listing;
}

export async function listWorkspaceAccess(input: {
  kind: WorkspaceAccessKind;
  hasVm: boolean;
  messageChanges: WorkspaceFileChange[];
  listWorker: () => Promise<WorkspaceEntry[]>;
  listGuest: () => Promise<WorkspaceEntry[] | undefined>;
  listHost: () => Promise<WorkspaceEntry[]>;
  gitChanges: () => Promise<WorkspaceFileChange[]>;
  skipGit?: boolean;
}): Promise<WorkspaceListing> {
  if (input.kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
  if (input.kind === "worker") {
    if (!input.hasVm) return { entries: [], changes: input.messageChanges };
    try {
      const entries = await input.listWorker();
      return withTruncation({ entries, changes: input.messageChanges });
    } catch {
      const entries = (await input.listGuest()) ?? [];
      return withTruncation({ entries, changes: input.messageChanges });
    }
  }
  const gitPromise = input.skipGit ? undefined : input.gitChanges();
  const hostEntries = await input.listHost();
  let entries = hostEntries;
  if (input.kind === "vm") {
    const fromGuest = await input.listGuest();
    if (fromGuest?.length) entries = fromGuest;
  } else if (workspaceUsesGuestFs(input.kind) && !hostEntries.length) {
    entries = (await input.listGuest()) ?? hostEntries;
  }
  return withTruncation({
    entries,
    changes: gitPromise
      ? mergeWorkspaceChanges(input.messageChanges, await gitPromise)
      : input.messageChanges,
  });
}

export async function readWorkspaceAccess(input: {
  kind: WorkspaceAccessKind;
  hasVm: boolean;
  readWorker: () => Promise<WorkspaceFile>;
  readGuest: () => Promise<WorkspaceFile | undefined>;
  readHost: () => Promise<WorkspaceFile | undefined>;
  gitBaseline: () => Promise<string | undefined>;
}): Promise<WorkspaceFile> {
  if (input.kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
  if (input.kind === "worker") {
    if (!input.hasVm) throw new Error(WORKSPACE_FILE_MISSING);
    try {
      return await input.readWorker();
    } catch (err) {
      if (isWorkspaceMissingError(err)) throw new Error(WORKSPACE_FILE_MISSING);
      const fromGuest = await input.readGuest();
      if (fromGuest) return fromGuest;
      throw new Error(WORKSPACE_FILE_MISSING);
    }
  }
  const gitPromise = input.gitBaseline();
  const file = await input.readHost();
  if (file) {
    const baseline = await gitPromise;
    return baseline === undefined ? file : { ...file, baseline };
  }
  void gitPromise.catch(() => undefined);
  if (input.kind === "host") throw new Error(WORKSPACE_FILE_MISSING);
  const fromGuest = await input.readGuest();
  if (fromGuest) return fromGuest;
  throw new Error(WORKSPACE_FILE_MISSING);
}

export async function readWorkspaceRawAccess(input: {
  kind: WorkspaceAccessKind;
  hasVm: boolean;
  readWorker: () => Promise<WorkspaceRawFile>;
  readHost: () => Promise<WorkspaceRawFile | undefined>;
}): Promise<WorkspaceRawFile> {
  if (input.kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
  if (input.kind === "worker") {
    if (!input.hasVm) throw new Error(WORKSPACE_FILE_MISSING);
    return input.readWorker();
  }
  const file = await input.readHost();
  if (file) return file;
  throw new Error(WORKSPACE_FILE_MISSING);
}

export async function writeWorkspaceAccess(input: {
  kind: WorkspaceAccessKind;
  hasVm: boolean;
  rel: string;
  writeWorker: () => Promise<WorkspaceSaved>;
  writeGuest: () => Promise<void>;
  writeHost: () => Promise<WorkspaceSaved>;
}): Promise<WorkspaceSaved> {
  if (input.kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
  if (input.kind === "worker") {
    const clean = sanitizeWorkspaceRel(input.rel);
    if (!clean) throw new Error("Invalid path");
    if (!input.hasVm) throw new Error(WORKSPACE_GUEST_STOPPED);
    try {
      return await input.writeWorker();
    } catch {
      await input.writeGuest();
      return { path: clean, mtime: new Date().toISOString() };
    }
  }
  const saved = await input.writeHost();
  if (workspaceUsesGuestFs(input.kind)) await input.writeGuest();
  return saved;
}

export async function writeWorkspaceBytesAccess(input: {
  kind: WorkspaceAccessKind;
  hasVm: boolean;
  rel: string;
  writeWorker: () => Promise<WorkspaceSaved>;
  writeHost: () => Promise<WorkspaceSaved>;
}): Promise<WorkspaceSaved> {
  if (input.kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
  if (input.kind === "worker") {
    const clean = sanitizeWorkspaceRel(input.rel);
    if (!clean) throw new Error("Invalid path");
    if (!input.hasVm) throw new Error(WORKSPACE_GUEST_STOPPED);
    return input.writeWorker();
  }
  return input.writeHost();
}

export async function mkdirWorkspaceAccess(input: {
  kind: WorkspaceAccessKind;
  hasVm: boolean;
  rel: string;
  mkdirWorker: () => Promise<{ path: string }>;
  mkdirGuest: () => Promise<void>;
  mkdirHost: () => Promise<{ path: string }>;
}): Promise<{ path: string }> {
  if (input.kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
  if (input.kind === "worker") {
    const clean = sanitizeWorkspaceRel(input.rel);
    if (!clean) throw new Error("Invalid path");
    if (!input.hasVm) throw new Error(WORKSPACE_GUEST_STOPPED);
    try {
      return await input.mkdirWorker();
    } catch {
      await input.mkdirGuest();
      return { path: clean };
    }
  }
  const created = await input.mkdirHost();
  if (workspaceUsesGuestFs(input.kind)) await input.mkdirGuest();
  return created;
}

export async function deleteWorkspaceAccess(input: {
  kind: WorkspaceAccessKind;
  hasVm: boolean;
  rel: string;
  deleteWorker: () => Promise<{ path: string }>;
  deleteGuest: () => Promise<void>;
  deleteHost: () => Promise<{ path: string }>;
}): Promise<{ path: string }> {
  if (input.kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
  if (input.kind === "worker") {
    const clean = sanitizeWorkspaceRel(input.rel);
    if (!clean) throw new Error("Invalid path");
    if (!input.hasVm) throw new Error(WORKSPACE_GUEST_STOPPED);
    try {
      return await input.deleteWorker();
    } catch (err) {
      if (isWorkspaceMissingError(err)) throw new Error(WORKSPACE_FILE_MISSING);
      await input.deleteGuest();
      return { path: clean };
    }
  }
  const removed = await input.deleteHost();
  if (workspaceUsesGuestFs(input.kind)) await input.deleteGuest();
  return removed;
}
