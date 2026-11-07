import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import {
  INDEX_DIR_ALLOWLIST,
  isRepoMapExtraSkipDir,
  isWorkspaceBinaryPreviewPath,
  isWorkspacePdfPath,
  isWorkspaceRawBytesPath,
  WORKSPACE_SKIP_DIR_SET,
  workspaceListingPathDropped,
  workspaceRawMime,
  workspaceRelFromToolPath,
} from "@locus/shared";
import { parseIgnore, pathIgnored, type IgnoreRule } from "./repoIgnore.js";
import { containedPath, ensureParentInside } from "@locus/guest-agent";

export const WORKSPACE_SKIP_DIRS = WORKSPACE_SKIP_DIR_SET;
export const WORKSPACE_LIST_MAX_ENTRIES = 16_000;
export const WORKSPACE_FILE_MAX_BYTES = 1_500_000;
const MAX_FILE_BYTES = WORKSPACE_FILE_MAX_BYTES;
/** PDFs in the Files pane; matches worker static / kit write cap. */
const MAX_RAW_BYTES = 8 * 1024 * 1024;
const MAX_MESH_BYTES = 32 * 1024 * 1024;
const TEXT_EXT = new Set([
  ".txt",
  ".md",
  ".json",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".svg",
  ".yml",
  ".yaml",
  ".toml",
  ".xml",
  ".sh",
  ".py",
  ".pyi",
  ".pyw",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".sql",
  ".env",
  ".gitignore",
  ".dockerignore",
  ".vue",
  ".svelte",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".swift",
  ".map",
]);

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

/** Portable find used to list the guest `/workspace` when the host bind mount is empty. */
export function workspaceFindScript(rel = ""): string {
  const clean = sanitizeWorkspaceRel(rel);
  const base = clean ? `/workspace/${clean}` : "/workspace";
  const quoted = `'${base.replace(/'/g, `'\\''`)}'`;
  const hidden = [...WORKSPACE_SKIP_DIRS].map((name) => `-name ${name}`).join(" -o ");
  const allow = INDEX_DIR_ALLOWLIST.map((name) => `! -name ${name}`).join(" ");
  const shallow = `-type d -name '.*' ${allow}`;
  return (
    `find ${quoted} -mindepth 1 \\( ${hidden} \\) -prune -o ` +
    `\\( ${shallow} \\) -prune -exec printf 'd\\t%s\\n' {} \\; -o ` +
    `-type d -exec printf 'd\\t%s\\n' {} \\; -o -type f -exec printf 'f\\t%s\\n' {} \\; | head -n ${WORKSPACE_LIST_MAX_ENTRIES}`
  );
}

export function parseWorkspaceFind(output: string, rel = ""): WorkspaceEntry[] {
  const want = sanitizeWorkspaceRel(rel);
  const entries: WorkspaceEntry[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();
    if (line.length < 3 || (line[0] !== "d" && line[0] !== "f") || line[1] !== "\t") continue;
    const abs = line.slice(2).trim();
    if (abs !== "/workspace" && !abs.startsWith("/workspace/")) continue;
    const path = abs === "/workspace" ? "" : abs.slice("/workspace/".length).replace(/^\/+/, "");
    if (!path || path.split("/").some((part) => part === "." || part === "..")) continue;
    if (want && path !== want && !path.startsWith(`${want}/`)) continue;
    const type = line[0] === "d" ? "dir" : "file";
    if (workspaceListingPathDropped(path, type, want)) continue;
    const name = path.split("/").pop() ?? path;
    entries.push({ name, path, type });
    if (entries.length >= WORKSPACE_LIST_MAX_ENTRIES) break;
  }
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

export function sanitizeWorkspaceRel(raw?: string, root?: string): string {
  return workspaceRelFromToolPath(raw, root);
}

function fsErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code?: string }).code ?? "");
  }
  return "";
}

/** Missing path. Other codes (EMFILE, EACCES, …) must not look like File not found. */
export function isMissingFsError(err: unknown): boolean {
  return /^(ENOENT|ENOTDIR)$/.test(fsErrorCode(err));
}

/** Process-wide / disk pressure. Surface these so the Files pane is not "File not found". */
export function isUnavailableFsError(err: unknown): boolean {
  return /^(EMFILE|ENFILE|EAGAIN|EBUSY|EIO|ENOSPC)$/.test(fsErrorCode(err));
}

function underRoot(root: string, rel: string): string | undefined {
  const dest = resolve(root, rel);
  const relToRoot = relative(resolve(root), dest);
  if (relToRoot.startsWith("..") || relToRoot.split(sep).includes("..")) return undefined;
  return dest;
}

async function loadLocusIgnore(root: string): Promise<IgnoreRule[]> {
  try {
    return parseIgnore(await readFile(join(root, ".locusignore"), "utf8"));
  } catch {
    return [];
  }
}

export function parseWorkspaceListDepth(raw?: string): number | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(32, Math.floor(n));
}

export async function listWorkspace(
  root: string,
  rel = "",
  maxDepth?: number,
): Promise<WorkspaceEntry[]> {
  const dest = underRoot(root, sanitizeWorkspaceRel(rel, root));
  if (!dest) return [];
  const real = await containedPath(root, dest);
  if (!real) return [];
  const entries: WorkspaceEntry[] = [];
  const ignore = await loadLocusIgnore(root);
  await walk(root, real, sanitizeWorkspaceRel(rel, root), entries, ignore, 1, maxDepth);
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

function createListLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const wait: Array<() => void> = [];
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => wait.push(resolve));
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      wait.shift()?.();
    }
  };
}

async function walk(
  root: string,
  startAbs: string,
  startRel: string,
  out: WorkspaceEntry[],
  ignore: IgnoreRule[],
  startDepth: number,
  maxDepth?: number,
): Promise<void> {
  const limitDir = createListLimiter(12);
  let pending = 0;
  let settle: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const visit = (abs: string, rel: string, depth: number) => {
    if (out.length >= WORKSPACE_LIST_MAX_ENTRIES) return;
    pending += 1;
    void limitDir(async () => {
      try {
        await visitDir(abs, rel, depth);
      } catch {
        /* skip */
      } finally {
        pending -= 1;
        if (pending === 0) settle?.();
      }
    });
  };

  const visitDir = async (abs: string, rel: string, depth: number) => {
    if (out.length >= WORKSPACE_LIST_MAX_ENTRIES) return;
    let entries: Dirent[];
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= WORKSPACE_LIST_MAX_ENTRIES) return;
      if (WORKSPACE_SKIP_DIRS.has(ent.name) || ent.isSymbolicLink()) continue;
      const childAbs = join(abs, ent.name);
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        out.push({ name: ent.name, path: childRel, type: "dir" });
        if (maxDepth != null && depth >= maxDepth) continue;
        if (isRepoMapExtraSkipDir(ent.name) || pathIgnored(childRel, true, ignore)) continue;
        visit(childAbs, childRel, depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;
      let size: number | undefined;
      try {
        size = (await lstat(childAbs)).size;
      } catch {
        continue;
      }
      out.push({ name: ent.name, path: childRel, type: "file", size });
    }
  };

  visit(startAbs, startRel, startDepth);
  if (pending === 0) settle?.();
  await done;
}

export async function readWorkspaceFile(
  root: string,
  rel: string,
): Promise<{ path: string; content: string; mtime: string } | undefined> {
  const clean = sanitizeWorkspaceRel(rel, root);
  if (!clean) return undefined;
  const dest = underRoot(root, clean);
  if (!dest) return undefined;
  try {
    const link = await lstat(dest);
    if (link.isSymbolicLink() || !link.isFile()) return undefined;
    if (link.size > MAX_FILE_BYTES) throw new Error("File is too large to edit");
    const real = await containedPath(root, dest);
    if (!real) return undefined;
    const info = await stat(real);
    const ext = extname(real).toLowerCase();
    if (ext && !TEXT_EXT.has(ext) && !looksText(await readFile(real))) {
      throw new Error("Binary files cannot be opened in the host editor");
    }
    const content = await readFile(real, "utf8");
    return { path: clean, content, mtime: info.mtime.toISOString() };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("too large") || err.message.includes("Binary"))
    )
      throw err;
    if (isMissingFsError(err)) return undefined;
    throw err instanceof Error ? err : new Error("Could not read file");
  }
}

export async function readWorkspaceBytes(
  root: string,
  rel: string,
): Promise<{ path: string; bytes: Buffer; mime: string; mtime: string } | undefined> {
  const clean = sanitizeWorkspaceRel(rel, root);
  if (!clean) throw new Error("Invalid path");
  if (!isWorkspaceRawBytesPath(clean)) return undefined;
  const dest = underRoot(root, clean);
  if (!dest) return undefined;
  try {
    const link = await lstat(dest);
    if (link.isSymbolicLink() || !link.isFile()) return undefined;
    const cap = isWorkspacePdfPath(clean)
      ? MAX_RAW_BYTES
      : isWorkspaceBinaryPreviewPath(clean)
        ? MAX_FILE_BYTES
        : MAX_MESH_BYTES;
    if (link.size > cap) throw new Error("File is too large to edit");
    const real = await containedPath(root, dest);
    if (!real) return undefined;
    const info = await stat(real);
    return {
      path: clean,
      bytes: await readFile(real),
      mime: workspaceRawMime(clean),
      mtime: info.mtime.toISOString(),
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("too large")) throw err;
    if (isMissingFsError(err)) return undefined;
    throw err instanceof Error ? err : new Error("Could not read file");
  }
}

function looksText(buf: Buffer): boolean {
  const slice = buf.subarray(0, 800);
  return !slice.includes(0);
}

export {
  expandWorkspaceGlobList,
  grepWorkspace,
  pathMatchesGrepGlobs,
  rankWorkspaceGrepHits,
  WORKSPACE_GREP_MAX_HITS,
  workspaceGlobToRegExp,
  type WorkspaceGrepHit,
  type WorkspaceGrepOptions,
} from "./workspaceGrep.js";

export async function writeWorkspaceFile(
  root: string,
  rel: string,
  content: string,
): Promise<{ path: string; mtime: string }> {
  const clean = sanitizeWorkspaceRel(rel, root);
  if (!clean) throw new Error("Invalid path");
  if (clean === "__python__" || clean.startsWith("__python__/")) {
    throw new Error("Python library files are read-only");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES)
    throw new Error("File is too large to edit");
  return writeWorkspaceBytes(root, clean, Buffer.from(content, "utf8"));
}

/** Must match `MAX_KIT_ENTRY_BYTES` in unzip.ts so extracted kit fonts can land. */
const MAX_KIT_WRITE_BYTES = 8 * 1024 * 1024;

export async function writeWorkspaceBytes(
  root: string,
  rel: string,
  bytes: Buffer,
): Promise<{ path: string; mtime: string }> {
  const clean = sanitizeWorkspaceRel(rel, root);
  if (!clean) throw new Error("Invalid path");
  if (bytes.length > MAX_KIT_WRITE_BYTES) throw new Error("File is too large to edit");
  const dest = underRoot(root, clean);
  if (!dest) throw new Error("Invalid path");
  const realParent = await ensureParentInside(root, clean);
  if (!realParent) throw new Error("Invalid path");
  const target = join(realParent, basename(dest));
  try {
    const link = await lstat(target);
    if (link.isSymbolicLink()) throw new Error("Refusing to write through a symlink");
    if (!link.isFile()) throw new Error("Invalid path");
  } catch (err) {
    if (err instanceof Error && (err.message.includes("symlink") || err.message === "Invalid path"))
      throw err;
  }
  const tmp = join(realParent, `.${basename(dest)}.tmp-${randomUUID()}`);
  try {
    await writeFile(tmp, bytes);
    try {
      await rename(tmp, target);
    } catch {
      // docker file_write is root:644; drop the guest file so the host-owned temp can take its place.
      await unlink(target).catch(() => undefined);
      await rename(tmp, target);
    }
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  const info = await stat(target);
  return { path: clean, mtime: info.mtime.toISOString() };
}

export async function mkdirWorkspace(root: string, rel: string): Promise<{ path: string }> {
  const clean = sanitizeWorkspaceRel(rel, root);
  if (!clean) throw new Error("Invalid path");
  const dest = underRoot(root, clean);
  if (!dest) throw new Error("Invalid path");
  const parent = await ensureParentInside(root, `${clean}/.keep`);
  if (!parent) throw new Error("Invalid path");
  return { path: clean };
}

export async function deleteWorkspacePath(root: string, rel: string): Promise<{ path: string }> {
  const clean = sanitizeWorkspaceRel(rel, root);
  if (!clean) throw new Error("Invalid path");
  const dest = underRoot(root, clean);
  if (!dest) throw new Error("Invalid path");
  try {
    const link = await lstat(dest);
    if (link.isSymbolicLink()) throw new Error("Refusing to delete a symlink");
    const real = await containedPath(root, dest);
    if (!real) throw new Error("File not found");
    if (link.isDirectory()) await rmdir(real);
    else if (link.isFile()) await unlink(real);
    else throw new Error("Invalid path");
    return { path: clean };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("symlink") || err.message === "Invalid path")
    ) {
      throw err;
    }
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "ENOTEMPTY") throw new Error("Folder is not empty");
    if (code === "ENOENT") throw new Error("File not found");
    throw err instanceof Error ? err : new Error("File not found");
  }
}

export async function renameWorkspacePath(
  root: string,
  fromRel: string,
  toRel: string,
): Promise<{ from: string; path: string }> {
  const from = sanitizeWorkspaceRel(fromRel, root);
  const to = sanitizeWorkspaceRel(toRel, root);
  if (!from || !to) throw new Error("Invalid path");
  if (from === to) return { from, path: to };
  if (to.startsWith(`${from}/`)) throw new Error("Invalid path");
  const fromDest = underRoot(root, from);
  const toDest = underRoot(root, to);
  if (!fromDest || !toDest) throw new Error("Invalid path");
  try {
    const link = await lstat(fromDest);
    if (link.isSymbolicLink()) throw new Error("Refusing to rename a symlink");
  } catch (err) {
    if (err instanceof Error && err.message.includes("symlink")) throw err;
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "ENOENT") throw new Error("File not found");
    throw err instanceof Error ? err : new Error("Invalid path");
  }
  const real = await containedPath(root, fromDest);
  if (!real) throw new Error("File not found");
  try {
    await lstat(toDest);
    throw new Error("Destination exists");
  } catch (err) {
    if (err instanceof Error && err.message === "Destination exists") throw err;
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code && code !== "ENOENT") {
      throw err instanceof Error ? err : new Error("Invalid path");
    }
  }
  const parent = await ensureParentInside(root, to);
  if (!parent) throw new Error("Invalid path");
  await rename(real, join(parent, basename(toDest)));
  return { from, path: to };
}
