import { lstat, mkdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";

function insideReal(realRoot: string, abs: string): boolean {
  const rel = relative(realRoot, abs);
  return !rel.startsWith("..") && !rel.split(sep).includes("..");
}

/** Realpath dest only when it stays inside root. Symlinks that leave return undefined. */
export async function containedPath(root: string, dest: string): Promise<string | undefined> {
  try {
    const realRoot = await realpath(root);
    const real = await realpath(dest);
    if (!insideReal(realRoot, real)) return undefined;
    return real;
  } catch {
    return undefined;
  }
}

/** Create parent dirs without following a symlink out of the workspace. */
export async function ensureParentInside(root: string, rel: string): Promise<string | undefined> {
  const parts = rel.split("/").filter(Boolean);
  if (parts.length === 0) return undefined;
  await mkdir(root, { recursive: true });
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    return undefined;
  }
  let current = realRoot;
  for (const part of parts.slice(0, -1)) {
    const next = join(current, part);
    try {
      const info = await lstat(next);
      if (info.isSymbolicLink() || !info.isDirectory()) return undefined;
      current = await realpath(next);
      if (!insideReal(realRoot, current)) return undefined;
    } catch {
      await mkdir(next);
      current = next;
    }
  }
  return current;
}
