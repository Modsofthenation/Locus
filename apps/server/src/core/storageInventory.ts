import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { StorageEntry, StorageInventory } from "@locus/shared";
import type { JsonStore } from "./store.js";

export const STORAGE_FOLDERS = {
  worktrees: "Worktrees",
  disks: "VM disks",
  images: "Golden images",
  recordings: "Recordings",
  "visual-reviews": "Visual reviews",
} as const;

const CLEANUP_AGE = 24 * 60 * 60 * 1000;

export class StorageInventoryService {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: JsonStore) {}

  private get pinFile() {
    return join(this.store.dataDir, "storage-pins.json");
  }

  private async pins(): Promise<Set<string>> {
    const raw = await readFile(this.pinFile, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "[]";
      throw error;
    });
    return new Set(JSON.parse(raw) as string[]);
  }

  private async folder(category: StorageEntry["category"]): Promise<string | undefined> {
    const root = await realpath(this.store.dataDir);
    const path = join(root, category);
    const dir = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!dir?.isDirectory() || (await realpath(path)) !== path) return undefined;
    return path;
  }

  async inventory(): Promise<StorageInventory> {
    const [pinned, sessions] = await Promise.all([this.pins(), this.store.loadSessions()]);
    const sessionIds = new Set(sessions.map((row) => row.id));
    const entries: StorageEntry[] = [];
    const seen = new Set<string>();
    const deadline = Date.now() + 8000;
    let complete = true;

    async function size(path: string): Promise<number> {
      if (Date.now() > deadline) {
        complete = false;
        return 0;
      }
      const info = await lstat(path).catch(() => undefined);
      if (!info || info.isSymbolicLink()) return 0;
      if (info.isFile()) {
        const key = `${info.dev}:${info.ino}`;
        if (info.ino && seen.has(key)) return 0;
        if (info.ino) seen.add(key);
        return info.blocks > 0 || info.size === 0 ? info.blocks * 512 : info.size;
      }
      if (!info.isDirectory()) return 0;
      const children = await readdir(path, { withFileTypes: true }).catch(() => {
        complete = false;
        return [];
      });
      let bytes = 0;
      for (const child of children) {
        if (!child.isDirectory() && !child.isFile()) continue;
        bytes += await size(join(path, child.name));
        if (Date.now() > deadline) break;
      }
      return bytes;
    }

    for (const category of Object.keys(STORAGE_FOLDERS) as StorageEntry["category"][]) {
      const folder = await this.folder(category);
      if (!folder) continue;
      for (const child of await readdir(folder, { withFileTypes: true })) {
        if (Date.now() > deadline) {
          complete = false;
          break;
        }
        if (!child.isDirectory() && !child.isFile()) continue;
        const id = `${category}/${child.name}`;
        const path = join(folder, child.name);
        const bytes = await size(path);
        const recording =
          category === "recordings" && child.isDirectory() && !sessionIds.has(child.name);
        const candidates =
          recording && !pinned.has(id) ? await this.orphanRecordings(folder, child.name) : [];
        entries.push({
          id,
          category,
          name: child.name,
          bytes,
          pinned: pinned.has(id),
          reclaimableBytes: candidates.reduce((total, file) => total + file.bytes, 0),
        });
      }
    }
    entries.sort((a, b) => b.bytes - a.bytes);
    return { complete, entries };
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writes.then(task, task);
    this.writes = next.catch(() => undefined);
    return next;
  }

  pin(id: string, keep: boolean): Promise<void> {
    return this.serial(async () => {
      const [category, name, extra] = id.split("/");
      if (
        !category ||
        !Object.hasOwn(STORAGE_FOLDERS, category) ||
        !name ||
        extra !== undefined ||
        /[\\]/.test(name) ||
        name === "." ||
        name === ".."
      ) {
        throw new Error("Invalid storage item");
      }
      const folder = await this.folder(category as StorageEntry["category"]);
      const info = folder && (await lstat(join(folder, name)).catch(() => undefined));
      if (keep && (!info || (!info.isFile() && !info.isDirectory())))
        throw new Error("Storage item no longer exists");
      const pins = await this.pins();
      if (keep) pins.add(id);
      else pins.delete(id);
      const temp = `${this.pinFile}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify([...pins]), { mode: 0o600 });
        await rename(temp, this.pinFile);
      } finally {
        await unlink(temp).catch(() => undefined);
      }
    });
  }

  cleanup(ids: string[]): Promise<{ removed: number; bytes: number }> {
    return this.serial(async () => {
      const [pinned, sessions, folder] = await Promise.all([
        this.pins(),
        this.store.loadSessions(),
        this.folder("recordings"),
      ]);
      const sessionIds = new Set(sessions.map((row) => row.id));
      let removed = 0;
      let bytes = 0;
      if (!folder) return { removed, bytes };
      for (const id of new Set(ids)) {
        const match = /^recordings\/([^/\\]+)$/.exec(id);
        if (!match || pinned.has(id) || sessionIds.has(match[1]!)) continue;
        for (const file of await this.orphanRecordings(folder, match[1]!)) {
          const current = await lstat(file.path).catch(() => undefined);
          if (
            !current?.isFile() ||
            current.ino !== file.ino ||
            current.dev !== file.dev ||
            current.mtimeMs !== file.mtimeMs
          )
            continue;
          if (
            await unlink(file.path).then(
              () => true,
              () => false,
            )
          ) {
            removed++;
            bytes += file.bytes;
          }
        }
      }
      return { removed, bytes };
    });
  }

  private async orphanRecordings(folder: string, name: string) {
    const dir = resolve(folder, name);
    if (dir !== join(folder, name) || dirname(dir) !== folder) return [];
    if ((await realpath(dir).catch(() => undefined)) !== dir) return [];
    const children = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const child of children) {
      if (!child.isFile() || !/\.mp4$/i.test(child.name)) continue;
      const path = join(dir, child.name);
      const info = await lstat(path).catch(() => undefined);
      if (!info?.isFile() || info.nlink > 1 || Date.now() - info.mtimeMs < CLEANUP_AGE) continue;
      files.push({
        path,
        ino: info.ino,
        dev: info.dev,
        mtimeMs: info.mtimeMs,
        bytes: info.blocks ? info.blocks * 512 : info.size,
      });
    }
    return files;
  }
}
