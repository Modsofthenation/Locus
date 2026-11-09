import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_WORKER_DISK_BYTES,
  safeWorkerImageId,
  saveWorkerGoldenDisk,
  workerGoldenDiskInfo,
  workerGoldenDiskPath,
} from "./goldenDisk.js";

describe("worker golden disks", () => {
  it("stores a qcow2 under dataDir/images and rejects oversized uploads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-golden-"));
    expect(safeWorkerImageId("img-12345")).toBe("img-12345");
    expect(safeWorkerImageId("no")).toBeUndefined();
    expect(workerGoldenDiskPath(dir, "img-12345")).toBe(join(dir, "images", "img-12345.qcow2"));
    const body = new Blob([new Uint8Array([1, 2, 3, 4])]).stream();
    const saved = await saveWorkerGoldenDisk(dir, "img-12345", body);
    expect(saved.bytes).toBe(4);
    expect(await readFile(saved.path)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(await workerGoldenDiskInfo(dir, "img-12345")).toEqual(saved);
    await expect(
      saveWorkerGoldenDisk(dir, "img-12345", new Blob([new Uint8Array(8)]).stream(), 4),
    ).rejects.toThrow(/too large/);
    expect(MAX_WORKER_DISK_BYTES).toBe(8 * 1024 * 1024 * 1024);
  });
});
