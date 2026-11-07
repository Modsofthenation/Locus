import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const RENAME_ATTEMPTS = 8;

export function isLockedFileError(err: unknown): boolean {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

export type MoveIntoPlaceIo = {
  rename: (tmp: string, dest: string) => Promise<void>;
  copyFile: (tmp: string, dest: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

const defaultIo: MoveIntoPlaceIo = {
  rename,
  copyFile,
  unlink,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Replace dest with tmp. POSIX rename overwrites dest atomically. Windows
 * MoveFileEx fails with EPERM/EACCES when Defender, Search, or another handle
 * has dest open — retry, then copy in place (same-directory tmp, so not EXDEV).
 */
export async function moveIntoPlace(
  tmp: string,
  dest: string,
  io: MoveIntoPlaceIo = defaultIo,
): Promise<void> {
  const wait = io.sleep ?? sleep;
  let lastErr: unknown;
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
    if (attempt > 0) await wait(Math.min(100, 25 * attempt));
    try {
      await io.rename(tmp, dest);
      return;
    } catch (err) {
      lastErr = err;
      if (!isLockedFileError(err)) throw err;
    }
    try {
      await io.copyFile(tmp, dest);
      await io.unlink(tmp).catch(() => undefined);
      return;
    } catch (err) {
      lastErr = err;
      if (!isLockedFileError(err)) throw err;
    }
  }
  throw lastErr;
}

export async function replaceFile(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, data, { encoding: "utf8", mode: 0o600 });
    await moveIntoPlace(tmp, path);
    await chmod(path, 0o600).catch(() => undefined);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}
