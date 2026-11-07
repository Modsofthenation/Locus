import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ComputeHandle } from "./types.js";

export interface ComputeTaskRecord {
  id: string;
  backendId: string;
  sessionId?: string;
  url?: string;
  token?: string;
  size?: string;
  fingerprint?: string;
}

export interface ComputeTaskRegistry {
  get(id: string): ComputeTaskRecord | undefined;
  list(): ComputeTaskRecord[];
  upsert(row: ComputeTaskRecord): void;
  remove(id: string): void;
}

export function computeTasksPath(dataDir: string): string {
  return join(dataDir, "compute-tasks.json");
}

export function loadComputeTaskRegistry(path?: string): ComputeTaskRegistry {
  const tasks = new Map<string, ComputeTaskRecord>();
  if (path) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { tasks?: unknown };
      if (Array.isArray(parsed.tasks)) {
        for (const row of parsed.tasks) {
          const rec = parseRecord(row);
          if (rec) tasks.set(rec.id, rec);
        }
      }
    } catch {
      /* missing or corrupt — start empty */
    }
  }

  const persist = () => {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify({ tasks: [...tasks.values()] }, null, 2)}\n`);
      renameSync(tmp, path);
    } catch {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  };

  return {
    get(id) {
      return tasks.get(id);
    },
    list() {
      return [...tasks.values()];
    },
    upsert(row) {
      tasks.set(row.id, row);
      persist();
    },
    remove(id) {
      if (!tasks.delete(id)) return;
      persist();
    },
  };
}

export function handleFromRecord(row: ComputeTaskRecord): ComputeHandle | undefined {
  if (!row.url?.trim() || !row.token?.trim() || !row.size?.trim()) return undefined;
  return {
    id: row.id,
    url: row.url.trim(),
    token: row.token.trim(),
    size: row.size.trim(),
    ...(row.fingerprint?.trim() ? { fingerprint: row.fingerprint.trim() } : {}),
  };
}

function parseRecord(row: unknown): ComputeTaskRecord | undefined {
  if (!row || typeof row !== "object") return undefined;
  const id = (row as { id?: unknown }).id;
  const backendId = (row as { backendId?: unknown }).backendId;
  if (typeof id !== "string" || !id.trim()) return undefined;
  if (typeof backendId !== "string" || !backendId.trim()) return undefined;
  const sessionId = (row as { sessionId?: unknown }).sessionId;
  const url = (row as { url?: unknown }).url;
  const token = (row as { token?: unknown }).token;
  const size = (row as { size?: unknown }).size;
  const fingerprint = (row as { fingerprint?: unknown }).fingerprint;
  return {
    id: id.trim(),
    backendId: backendId.trim(),
    ...(typeof sessionId === "string" && sessionId.trim() ? { sessionId: sessionId.trim() } : {}),
    ...(typeof url === "string" && url.trim() ? { url: url.trim() } : {}),
    ...(typeof token === "string" && token.trim() ? { token: token.trim() } : {}),
    ...(typeof size === "string" && size.trim() ? { size: size.trim() } : {}),
    ...(typeof fingerprint === "string" && fingerprint.trim()
      ? { fingerprint: fingerprint.trim() }
      : {}),
  };
}
