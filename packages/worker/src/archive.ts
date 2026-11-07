import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { containedPath } from "@locus/guest-agent";

export const MAX_WORKER_ARCHIVE_BYTES = 512 * 1024 * 1024;

export async function packDirectory(src: string): Promise<Buffer> {
  const info = await stat(src);
  if (!info.isDirectory()) throw new Error("Seed path is not a directory");
  return runTar(["-C", src, "-czf", "-", "."]);
}

export async function unpackDirectory(archive: Buffer, dest: string): Promise<void> {
  if (archive.length > MAX_WORKER_ARCHIVE_BYTES) {
    throw new Error("Archive is too large");
  }
  const listing = await runTar(["-tzf", "-"], archive);
  for (const name of listing.toString("utf8").split(/\r?\n/)) {
    if (name && archiveMemberUnsafe(name)) {
      throw new Error("Archive contains an unsafe path");
    }
  }
  await mkdir(dest, { recursive: true });
  await runTar(["--no-same-owner", "-C", dest, "-xzf", "-"], archive);
  await stripEscapingLinks(dest);
}

export function archiveMemberUnsafe(name: string): boolean {
  const normalized = name.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized === ".") return false;
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return true;
  return normalized.split("/").includes("..");
}

async function stripEscapingLinks(root: string): Promise<void> {
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let info;
      try {
        info = await lstat(full);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) {
        if (!(await containedPath(root, full))) await rm(full, { force: true });
        continue;
      }
      if (info.isDirectory()) await walk(full);
    }
  }
  await walk(root);
}

function runTar(args: string[], stdin?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `tar failed (${code ?? "unknown"})`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}

export function safeWorkerSessionId(id: string | undefined): string | undefined {
  const value = id?.trim() ?? "";
  if (!value || value.length > 80) return undefined;
  if (!/^[A-Za-z0-9._-]+$/.test(value)) return undefined;
  return value;
}
