import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import {
  isRepoMapExtraSkipDir,
  isWorkspaceImagePath,
  WORKSPACE_SKIP_DIR_SET,
  workspaceImageMime,
  workspaceRelFromToolPath,
} from "@locus/shared";
import { containedPath, ensureParentInside } from "@locus/guest-agent";

const SKIP = WORKSPACE_SKIP_DIR_SET;
const MAX_ENTRIES = 16_000;
const MAX_FILE_BYTES = 1_500_000;
const MAX_STATIC_BYTES = 8 * 1024 * 1024;
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
  ".map",
]);

export interface WorkerWorkspaceEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

function underRoot(root: string, rel: string): string | undefined {
  const dest = resolve(root, rel);
  const relToRoot = relative(resolve(root), dest);
  if (relToRoot.startsWith("..") || relToRoot.split(sep).includes("..")) return undefined;
  return dest;
}

export async function listWorkerWorkspace(root: string, rel = ""): Promise<WorkerWorkspaceEntry[]> {
  const clean = workspaceRelFromToolPath(rel, root);
  const dest = underRoot(root, clean);
  if (!dest) return [];
  const real = await containedPath(root, dest);
  if (!real) return [];
  const entries: WorkerWorkspaceEntry[] = [];
  await walk(root, real, clean, entries);
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

async function walk(
  root: string,
  abs: string,
  rel: string,
  out: WorkerWorkspaceEntry[],
): Promise<void> {
  if (out.length >= MAX_ENTRIES) return;
  let names: string[] = [];
  try {
    names = await readdir(abs);
  } catch {
    return;
  }
  for (const name of names) {
    if (out.length >= MAX_ENTRIES) return;
    if (SKIP.has(name)) continue;
    const childAbs = join(abs, name);
    const childRel = rel ? `${rel}/${name}` : name;
    try {
      const info = await lstat(childAbs);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        out.push({ name, path: childRel, type: "dir" });
        if (!isRepoMapExtraSkipDir(name)) await walk(root, childAbs, childRel, out);
      } else if (info.isFile()) {
        out.push({ name, path: childRel, type: "file", size: info.size });
      }
    } catch {
      /* skip */
    }
  }
}

export function workspaceStaticMime(path: string): string {
  const ext = extname(path).toLowerCase();
  if (isWorkspaceImagePath(path)) return workspaceImageMime(path);
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".htm": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".otf": "font/otf",
      ".txt": "text/plain; charset=utf-8",
      ".map": "application/json",
      ".wasm": "application/wasm",
      ".pdf": "application/pdf",
    }[ext] ?? "application/octet-stream"
  );
}

export async function readWorkerWorkspaceFile(
  root: string,
  rel: string,
): Promise<{ path: string; content: string; mtime: string } | undefined> {
  const clean = workspaceRelFromToolPath(rel, root);
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
    const buf = await readFile(real);
    if (ext && !TEXT_EXT.has(ext) && buf.includes(0)) {
      throw new Error("Binary files cannot be opened in the host editor");
    }
    return { path: clean, content: buf.toString("utf8"), mtime: info.mtime.toISOString() };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("too large") || err.message.includes("Binary"))
    )
      throw err;
    return undefined;
  }
}

export async function readWorkerWorkspaceBytes(
  root: string,
  rel: string,
): Promise<{ path: string; bytes: Buffer; mime: string; mtime: string } | undefined> {
  const clean = workspaceRelFromToolPath(rel, root);
  if (!clean) throw new Error("Invalid path");
  const dest = underRoot(root, clean);
  if (!dest) return undefined;
  try {
    const link = await lstat(dest);
    if (link.isSymbolicLink() || !link.isFile()) return undefined;
    if (link.size > MAX_STATIC_BYTES) throw new Error("File is too large to edit");
    const real = await containedPath(root, dest);
    if (!real) return undefined;
    const info = await stat(real);
    return {
      path: clean,
      bytes: await readFile(real),
      mime: workspaceStaticMime(clean),
      mtime: info.mtime.toISOString(),
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("too large")) throw err;
    return undefined;
  }
}

export async function writeWorkerWorkspaceFile(
  root: string,
  rel: string,
  content: string | Buffer,
): Promise<{ path: string; mtime: string }> {
  const clean = workspaceRelFromToolPath(rel, root);
  if (!clean) throw new Error("Invalid path");
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  const cap = Buffer.isBuffer(content) ? MAX_STATIC_BYTES : MAX_FILE_BYTES;
  if (bytes.length > cap) throw new Error("File is too large to edit");
  const dest = underRoot(root, clean);
  if (!dest) throw new Error("Invalid path");
  const realParent = await ensureParentInside(root, clean);
  if (!realParent) throw new Error("Invalid path");
  await mkdir(realParent, { recursive: true });
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

export async function mkdirWorkerWorkspace(root: string, rel: string): Promise<{ path: string }> {
  const clean = workspaceRelFromToolPath(rel, root);
  if (!clean) throw new Error("Invalid path");
  const dest = underRoot(root, clean);
  if (!dest) throw new Error("Invalid path");
  const parent = await ensureParentInside(root, `${clean}/.keep`);
  if (!parent) throw new Error("Invalid path");
  return { path: clean };
}

export async function deleteWorkerWorkspacePath(
  root: string,
  rel: string,
): Promise<{ path: string }> {
  const clean = workspaceRelFromToolPath(rel, root);
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
