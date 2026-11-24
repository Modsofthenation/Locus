import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sandboxWorkerKind } from "@locus/shared";
import type { SandboxRecord } from "./sandbox.js";
import type { ComputeHandle, ComputeOrphan } from "./types.js";

export interface ComputeTaskRecord {
  id: string;
  backendId: string;
  sessionId?: string;
  url?: string;
  token?: string;
  size?: string;
  fingerprint?: string;
  requestedAt?: string;
  fargate?: {
    startedBy: string;
    region: string;
    cluster: string;
    ecsUrl?: string;
    stopAccepted?: boolean;
  };
  cleanupPending?: boolean;
  sandbox?: SandboxRecord;
}

export interface ComputeTaskRegistry {
  get(id: string): ComputeTaskRecord | undefined;
  list(): ComputeTaskRecord[];
  assertReadable(): void;
  upsert(row: ComputeTaskRecord, replacesId?: string): void;
  remove(id: string): void;
}

export function computeTasksPath(dataDir: string): string {
  return join(dataDir, "compute-tasks.json");
}

export function loadComputeTaskRegistry(path?: string): ComputeTaskRegistry {
  let tasks = new Map<string, ComputeTaskRecord>();
  let readError: Error | undefined;
  if (path) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { tasks?: unknown };
      if (!Array.isArray(parsed.tasks)) throw new Error("Missing task list");
      for (const row of parsed.tasks) {
        const rec = parseRecord(row);
        if (!rec || tasks.has(rec.id)) throw new Error("Invalid task record");
        tasks.set(rec.id, rec);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        tasks.clear();
        readError = new Error(
          "Compute task registry is unreadable. Restore it before provisioning or cleanup.",
          {
            cause: err,
          },
        );
      }
    }
  }

  const assertReadable = () => {
    if (readError) throw readError;
  };
  const commit = (next: Map<string, ComputeTaskRecord>) => {
    assertReadable();
    if (path) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(tmp, `${JSON.stringify({ tasks: [...next.values()] }, null, 2)}\n`, {
          mode: 0o600,
          flush: true,
        });
        renameSync(tmp, path);
      } catch (err) {
        try {
          unlinkSync(tmp);
        } catch {
          /* temporary file may never have been created */
        }
        throw new Error("Could not persist compute task registry", { cause: err });
      }
    }
    tasks = next;
  };

  return {
    assertReadable,
    get(id) {
      return tasks.get(id);
    },
    list() {
      return [...tasks.values()];
    },
    upsert(row, replacesId) {
      const next = new Map(tasks);
      if (replacesId) next.delete(replacesId);
      next.set(row.id, row);
      commit(next);
    },
    remove(id) {
      const next = new Map(tasks);
      if (next.delete(id)) commit(next);
    },
  };
}

export function handleFromRecord(row: ComputeTaskRecord): ComputeHandle | undefined {
  if (row.cleanupPending) return undefined;
  if (!row.url?.trim() || !row.token?.trim() || !row.size?.trim()) return undefined;
  return {
    id: row.id,
    url: row.url.trim(),
    token: row.token.trim(),
    size: row.size.trim(),
    ...(row.requestedAt ? { requestedAt: row.requestedAt } : {}),
    ...(row.fingerprint?.trim() ? { fingerprint: row.fingerprint.trim() } : {}),
  };
}

export function restoreComputeHandle(
  handles: Map<string, ComputeHandle>,
  registry: ComputeTaskRegistry,
  id: string,
): ComputeHandle | undefined {
  const live = handles.get(id);
  if (live) return live;
  const restored = handleFromRecord(registry.get(id) ?? { id: "", backendId: "" });
  if (!restored) return undefined;
  handles.set(id, restored);
  return restored;
}

export function listRegistryOrphans(
  registry: ComputeTaskRegistry,
  liveIds: Set<string>,
): ComputeOrphan[] {
  const seen = new Set<string>();
  const out: ComputeOrphan[] = [];
  for (const row of registry.list()) {
    if (liveIds.has(row.id) || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, backendId: row.backendId, sessionId: row.sessionId });
  }
  return out.filter((row) => row.backendId);
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
  const { fargate, cleanupPending, requestedAt, sandbox } = row as Partial<ComputeTaskRecord>;
  if (
    fargate !== undefined &&
    (!fargate ||
      typeof fargate.startedBy !== "string" ||
      !/^locus-[a-f0-9]{24}$/.test(fargate.startedBy) ||
      typeof fargate.region !== "string" ||
      !fargate.region ||
      typeof fargate.cluster !== "string" ||
      !fargate.cluster ||
      (fargate.ecsUrl !== undefined && typeof fargate.ecsUrl !== "string") ||
      (fargate.stopAccepted !== undefined && typeof fargate.stopAccepted !== "boolean"))
  )
    return undefined;
  if (
    sandbox !== undefined &&
    (!sandbox ||
      !sandboxWorkerKind(sandbox.kind) ||
      typeof sandbox.marker !== "string" ||
      !/^locus-[a-f0-9]{24}$/.test(sandbox.marker) ||
      id !== `${sandbox.kind}:${sandbox.marker}` ||
      typeof sandbox.template !== "string" ||
      !sandbox.template ||
      (sandbox.region !== undefined && typeof sandbox.region !== "string") ||
      !Number.isSafeInteger(sandbox.deadlineAt) ||
      !Number.isFinite(sandbox.reservedUsd) ||
      sandbox.reservedUsd <= 0 ||
      !Number.isFinite(sandbox.hourlyUsd) ||
      sandbox.hourlyUsd <= 0 ||
      typeof sandbox.rateDate !== "string" ||
      (sandbox.closedUsd !== undefined &&
        (!Number.isFinite(sandbox.closedUsd) || sandbox.closedUsd < 0)) ||
      (sandbox.closedAt !== undefined &&
        (typeof sandbox.closedAt !== "string" || !Number.isFinite(Date.parse(sandbox.closedAt)))) ||
      (sandbox.app !== undefined && typeof sandbox.app !== "string") ||
      (sandbox.remoteId !== undefined && typeof sandbox.remoteId !== "string"))
  )
    return undefined;
  return {
    id: id.trim(),
    ...(typeof requestedAt === "string" && Number.isFinite(Date.parse(requestedAt))
      ? { requestedAt }
      : {}),
    ...(cleanupPending === true ? { cleanupPending } : {}),
    ...(fargate ? { fargate } : {}),
    ...(sandbox ? { sandbox } : {}),
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
