import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export const MAX_WORKER_DISK_BYTES = 8 * 1024 * 1024 * 1024;
const IMAGE_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export function safeWorkerImageId(raw: string | undefined): string | undefined {
  const id = raw?.trim() ?? "";
  return IMAGE_ID_RE.test(id) ? id : undefined;
}

export function workerGoldenDiskPath(dataDir: string, imageId: string): string {
  return join(dataDir, "images", `${imageId}.qcow2`);
}

export async function workerGoldenDiskInfo(
  dataDir: string,
  imageId: string,
): Promise<{ path: string; bytes: number } | undefined> {
  const path = workerGoldenDiskPath(dataDir, imageId);
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size <= 0) return undefined;
    return { path, bytes: info.size };
  } catch {
    return undefined;
  }
}

export async function saveWorkerGoldenDisk(
  dataDir: string,
  imageId: string,
  body: ReadableStream<Uint8Array> | null,
  maxBytes = MAX_WORKER_DISK_BYTES,
): Promise<{ path: string; bytes: number }> {
  if (!body) throw new Error("Disk upload is empty");
  const dest = workerGoldenDiskPath(dataDir, imageId);
  await mkdir(join(dataDir, "images"), { recursive: true, mode: 0o700 });
  let bytes = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        controller.error(new Error("Golden disk is too large"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(body.pipeThrough(limiter)),
    createWriteStream(dest, { mode: 0o600 }),
  );
  return { path: dest, bytes };
}
