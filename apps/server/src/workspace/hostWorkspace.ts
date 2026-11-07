import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { mkdir, readdir, realpath, stat, writeFile } from "node:fs/promises";

const MAX_BROWSE_ENTRIES = 400;
export const MAX_HOST_SAVE_BYTES = 64 * 1024 * 1024;
const SECRET_HOME_DIRS = [".ssh", ".gnupg", ".aws", ".kube", ".locus"];
const IMAGE_SECRET_HOME_DIRS = [".ssh", ".gnupg", ".aws", ".kube"];
const DISK_IMAGE_EXT = /\.(iso|img|qcow2?|vmdk|raw)$/i;

export async function resolveHostDir(raw: string, dataDir?: string): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Folder is required");
  if (!isAbsolute(trimmed)) throw new Error("Folder must be an absolute path");
  let info;
  try {
    info = await stat(trimmed);
  } catch {
    throw new Error("Folder does not exist");
  }
  if (!info.isDirectory()) throw new Error("Folder is not a directory");
  const real = await realpath(trimmed);
  const blocked = blockedHostDirReason(real, dataDir);
  if (blocked) throw new Error(blocked);
  return real;
}

export async function resolveOptionalHostDir(
  raw?: string,
  dataDir?: string,
): Promise<string | undefined> {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return resolveHostDir(trimmed, dataDir);
}

export interface HostBrowseEntry {
  name: string;
  path: string;
  kind?: "dir" | "file";
}

export interface HostBrowseListing {
  path: string;
  parent: string | null;
  entries: HostBrowseEntry[];
  blocked?: string;
}

export function blockedHostDirReason(abs: string, dataDir?: string): string | undefined {
  const real = resolve(abs);
  if (dirname(real) === real) return "Folder cannot be the filesystem root";
  const home = resolve(homedir());
  if (real === home) return "Folder cannot be your home directory";
  for (const name of SECRET_HOME_DIRS) {
    const root = join(home, name);
    if (insideOrSame(root, real)) return `Folder cannot be ${root}`;
  }
  if (dataDir && insideOrSame(dataDir, real)) {
    return "Folder cannot be the Locus data directory";
  }
}

function insideOrSame(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !rel.split(sep).includes(".."));
}

export function hostSaveFileName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new Error("File name is required");
  if (name !== basename(name) || name === "." || name === "..") {
    throw new Error("File name cannot contain a path");
  }
  return name;
}

export async function saveHostFile(input: {
  dir: string;
  filename: string;
  contentBase64: string;
  dataDir?: string;
}): Promise<{ path: string; bytes: number }> {
  const dir = await resolveHostDir(input.dir, input.dataDir);
  const filename = hostSaveFileName(input.filename);
  const base64 = input.contentBase64.replace(/\s/g, "");
  if (!base64) throw new Error("File is empty");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new Error("File is empty");
  if (bytes.length > MAX_HOST_SAVE_BYTES) throw new Error("File is too large");
  const target = resolve(dir, filename);
  if (dirname(target) !== dir || basename(target) !== filename) {
    throw new Error("File name cannot contain a path");
  }
  await writeFile(target, bytes);
  return { path: target, bytes: bytes.length };
}

export async function browseHostDir(raw?: string, dataDir?: string): Promise<HostBrowseListing> {
  const start = raw?.trim() || homedir();
  let dir: string;
  try {
    const info = await stat(start);
    dir = info.isDirectory() ? await realpath(start) : dirname(await realpath(start));
  } catch {
    dir = await realpath(homedir());
  }
  const parentDir = dirname(dir);
  const parent = parentDir === dir ? null : parentDir;
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    names = [];
  }
  names.sort((a, b) => a.localeCompare(b));
  const entries: HostBrowseEntry[] = [];
  for (const name of names) {
    if (entries.length >= MAX_BROWSE_ENTRIES) break;
    const path = join(dir, name);
    try {
      if ((await stat(path)).isDirectory()) entries.push({ name, path, kind: "dir" });
    } catch {
      /* skip unreadable entries */
    }
  }
  return { path: dir, parent, entries, blocked: blockedHostDirReason(dir, dataDir) };
}

function isSecretHomeDir(abs: string, names: string[]): boolean {
  const home = resolve(homedir());
  return names.some((name) => insideOrSame(join(home, name), abs));
}

/** List folders plus disk images. Starts in the Locus media dir so Browse can pick cloud images. */
export async function browseDiskImages(raw?: string, dataDir?: string): Promise<HostBrowseListing> {
  const media = dataDir ? join(dataDir, "media") : undefined;
  if (media) await mkdir(media, { recursive: true });
  const start = raw?.trim() || media || homedir();
  let dir: string;
  try {
    const info = await stat(start);
    dir = info.isDirectory() ? await realpath(start) : dirname(await realpath(start));
  } catch {
    dir = media ? await realpath(media) : await realpath(homedir());
  }
  if (isSecretHomeDir(dir, IMAGE_SECRET_HOME_DIRS)) {
    dir = dirname(dir);
  }
  const parentDir = dirname(dir);
  const parent = parentDir === dir ? null : parentDir;
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    names = [];
  }
  names.sort((a, b) => a.localeCompare(b));
  const entries: HostBrowseEntry[] = [];
  for (const name of names) {
    if (entries.length >= MAX_BROWSE_ENTRIES) break;
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (info.isDirectory()) {
        if (isSecretHomeDir(path, IMAGE_SECRET_HOME_DIRS)) continue;
        entries.push({ name, path, kind: "dir" });
      } else if (info.isFile() && DISK_IMAGE_EXT.test(name)) {
        entries.push({ name, path, kind: "file" });
      }
    } catch {
      /* skip unreadable entries */
    }
  }
  return { path: dir, parent, entries };
}
