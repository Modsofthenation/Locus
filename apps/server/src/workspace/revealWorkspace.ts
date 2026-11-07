import { spawn } from "node:child_process";
import { dirname, relative, resolve, sep, win32 } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { looksAbsoluteHostPath, workspaceRelFromToolPath } from "@locus/shared";
import { containedPath } from "@locus/guest-agent";

export { looksAbsoluteHostPath };

const WIN_DRIVE = /^[a-zA-Z]:[\\/]/;
const WIN_UNC = /^\\\\|^\/\/[^/]/;

function insideRoot(root: string, dest: string): boolean {
  if (WIN_DRIVE.test(root) || WIN_DRIVE.test(dest) || WIN_UNC.test(root) || WIN_UNC.test(dest)) {
    const rel = win32.relative(win32.resolve(root), win32.resolve(dest));
    return rel === "" || (!rel.startsWith("..") && !rel.split(win32.sep).includes(".."));
  }
  const rel = relative(resolve(root), resolve(dest));
  return rel === "" || (!rel.startsWith("..") && !rel.split(sep).includes(".."));
}

function resolveWorkspaceDest(root: string, rawPath: string): string | undefined {
  const trimmed = (rawPath ?? "").trim();
  if (!trimmed || trimmed.includes("\0")) return undefined;
  if (looksAbsoluteHostPath(trimmed)) return resolve(trimmed);
  const rel = workspaceRelFromToolPath(trimmed);
  if (!rel) {
    if (trimmed === "/workspace" || trimmed === "") return root;
    return undefined;
  }
  return resolve(root, rel);
}

export function explorerRevealCommand(
  folder: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === "win32") return { command: "explorer.exe", args: [folder] };
  if (platform === "darwin") return { command: "open", args: [folder] };
  return { command: "xdg-open", args: [folder] };
}

export function spawnExplorer(
  folder: string,
  opts: {
    platform?: NodeJS.Platform;
    spawn?: typeof spawn;
    skip?: boolean;
  } = {},
): { command: string; args: string[]; skipped: boolean } {
  const { command, args } = explorerRevealCommand(folder, opts.platform ?? process.platform);
  const skip = opts.skip ?? Boolean(process.env.VITEST);
  if (skip) return { command, args, skipped: true };
  const spawnFn = opts.spawn ?? spawn;
  const child = spawnFn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
  return { command, args, skipped: false };
}

/** Existing directory to open for a workspace file, jailed to `root`. */
export async function resolveRevealFolder(root: string, rawPath: string): Promise<string> {
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    throw new Error("Workspace folder not found");
  }
  const dest = resolveWorkspaceDest(realRoot, rawPath);
  if (!dest || !insideRoot(realRoot, dest)) throw new Error("Path is outside the workspace");

  let folder = dest;
  try {
    const info = await stat(dest);
    if (!info.isDirectory()) folder = dirname(dest);
  } catch {
    folder = dirname(dest);
  }

  let current = folder;
  for (;;) {
    if (!insideRoot(realRoot, current)) throw new Error("Path is outside the workspace");
    try {
      const info = await stat(current);
      if (info.isDirectory()) {
        const real = await containedPath(realRoot, current);
        if (!real) throw new Error("Path is outside the workspace");
        return real;
      }
    } catch (err) {
      if (err instanceof Error && err.message === "Path is outside the workspace") throw err;
    }
    if (current === realRoot) return realRoot;
    const parent = dirname(current);
    if (parent === current) return realRoot;
    current = parent;
  }
}

export async function revealWorkspaceFolder(
  root: string,
  rawPath: string,
  opts?: {
    platform?: NodeJS.Platform;
    spawn?: typeof spawn;
    skip?: boolean;
  },
): Promise<{ path: string }> {
  const folder = await resolveRevealFolder(root, rawPath);
  spawnExplorer(folder, opts);
  return { path: folder };
}
