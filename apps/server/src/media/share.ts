import { readdir, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { guestSharePath, qemuPathUnsafe, type GuestOs } from "@locus/shared";

export function shareDest(root: string, filename: string): string {
  const name = basename(filename.replaceAll("\\", "/"));
  if (!name || name === "." || name === ".." || qemuPathUnsafe(name)) {
    throw new Error("Invalid filename");
  }
  const dest = resolve(root, name);
  const rel = relative(resolve(root), dest);
  if (!rel || rel.startsWith("..") || rel.includes("/") || rel.includes("\\")) {
    throw new Error("Invalid filename");
  }
  return dest;
}

export interface ShareFile {
  name: string;
  size: number;
  mtime: string;
  guestPath: string;
}

export async function listShareFiles(root: string, os: GuestOs = "ubuntu"): Promise<ShareFile[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const files: ShareFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    let dest: string;
    try {
      dest = shareDest(root, entry.name);
    } catch {
      continue;
    }
    const info = await stat(dest);
    files.push({
      name: entry.name,
      size: info.size,
      mtime: info.mtime.toISOString(),
      guestPath: guestSharePath(os, entry.name),
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export function attachmentFilename(name: string): string {
  return basename(name).replace(/["\\\r\n]/g, "_");
}
