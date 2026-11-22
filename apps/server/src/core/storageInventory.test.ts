import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { JsonStore } from "./store.js";
import { StorageInventoryService } from "./storageInventory.js";

it("reclaims only old orphan recordings and honors pins persisted across instances", async () => {
  const root = await mkdtemp(join(tmpdir(), "locus-storage-"));
  try {
    const store = new JsonStore(root);
    await store.init();
    const folder = join(root, "recordings", "old-session");
    const old = join(folder, "old.mp4");
    const newFile = join(folder, "new.mp4");
    const external = join(root, "elsewhere");
    await mkdir(folder);
    await mkdir(external);
    await writeFile(old, "old");
    await writeFile(newFile, "new");
    await writeFile(join(external, "elsewhere.mp4"), "other");
    const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(old, oldDate, oldDate);
    await utimes(join(external, "elsewhere.mp4"), oldDate, oldDate);
    await symlink(external, join(root, "recordings", "linked"), "junction");
    const service = new StorageInventoryService(store);
    const id = "recordings/old-session";
    expect(
      (await service.inventory()).entries.find((row) => row.id === id)?.reclaimableBytes,
    ).toBeGreaterThan(0);
    await service.pin(id, true);
    const restarted = new StorageInventoryService(store);
    expect(await restarted.cleanup([id, "recordings/linked"])).toEqual({ removed: 0, bytes: 0 });
    await restarted.pin(id, false);
    expect(await restarted.cleanup([id, "recordings/linked"])).toMatchObject({ removed: 1 });
    await expect(readFile(old)).rejects.toThrow();
    expect(await readFile(newFile, "utf8")).toBe("new");
    expect(await readFile(join(external, "elsewhere.mp4"), "utf8")).toBe("other");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
