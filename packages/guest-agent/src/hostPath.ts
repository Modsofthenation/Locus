import { existsSync, statSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { DOCKER_WORKSPACE } from "@locus/shared";
import { containedPath, ensureParentInside } from "./containedPath.js";

/** Map a guest `/workspace/...` path onto hostRoot. Rejects `..` and escapes. */
export function lexicalHostPath(guestPath: string, hostRoot: string): string | undefined {
  const normalized = guestPath.replace(/\\/g, "/");
  let rel: string;
  if (normalized === DOCKER_WORKSPACE) rel = "";
  else if (normalized.startsWith(`${DOCKER_WORKSPACE}/`))
    rel = normalized.slice(DOCKER_WORKSPACE.length + 1);
  else return undefined;
  const parts = rel.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) return undefined;
  const dest = parts.length ? join(hostRoot, ...parts) : hostRoot;
  const relToRoot = relative(resolve(hostRoot), resolve(dest));
  if (
    relToRoot.startsWith("..") ||
    relToRoot.split(sep).includes("..") ||
    relToRoot.startsWith("/") ||
    relToRoot.includes("://")
  ) {
    return undefined;
  }
  return dest;
}

export async function inspectHostPath(
  guestPath: string,
  hostRoot: string,
): Promise<{ kind: "ok"; path: string } | { kind: "missing" } | { kind: "outside" }> {
  const dest = lexicalHostPath(guestPath, hostRoot);
  if (!dest) return { kind: "outside" };
  const real = await containedPath(hostRoot, dest);
  if (real) return { kind: "ok", path: real };
  try {
    await lstat(dest);
    return { kind: "outside" };
  } catch {
    return { kind: "missing" };
  }
}

export async function resolveReadPath(
  guestPath: string,
  hostRoot: string,
): Promise<string | undefined> {
  const found = await inspectHostPath(guestPath, hostRoot);
  return found.kind === "ok" ? found.path : undefined;
}

export async function resolveWritePath(
  guestPath: string,
  hostRoot: string,
): Promise<string | undefined> {
  const dest = lexicalHostPath(guestPath, hostRoot);
  if (!dest) return undefined;
  const existing = await containedPath(hostRoot, dest);
  if (existing) return existing;
  try {
    await lstat(dest);
    return undefined;
  } catch {
    /* dest does not exist yet */
  }
  const rel = relative(resolve(hostRoot), resolve(dest)).split(sep).join("/");
  if (!rel || rel.startsWith("..")) return undefined;
  const parent = await ensureParentInside(hostRoot, rel);
  if (!parent) return undefined;
  return join(parent, basename(dest));
}

export function isHostFile(hostPath: string | undefined): boolean {
  if (!hostPath || !existsSync(hostPath)) return false;
  try {
    return statSync(hostPath).isFile();
  } catch {
    return false;
  }
}
