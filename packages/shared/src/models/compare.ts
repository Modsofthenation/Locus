import type { AiProvider } from "./provider.js";

export type CompareRole = "A" | "B";
export type CompareKind = "ab" | "workers";

export const WORKER_COUNT_MIN = 2;
export const WORKER_COUNT_MAX = 4;
export const WORKER_COUNT_DEFAULT = 3;

export const WORKER_LOCK_FILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "composer.lock",
  "go.sum",
  "Gemfile.lock",
];

export function workerBranchName(role: string): string {
  const n = role.trim().replace(/[^A-Za-z0-9._-]+/g, "") || "1";
  return `locus/worker-${n}`;
}

export function isWorkerLockPath(path: string): boolean {
  const leaf = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  return WORKER_LOCK_FILES.some((name) => name.toLowerCase() === leaf.toLowerCase());
}

export function workerPlaybook(role: string, count: number): string {
  const branch = workerBranchName(role);
  return [
    `You are worker ${role} of ${count}. Work only on git branch ${branch}.`,
    `Do not modify lockfiles (${WORKER_LOCK_FILES.join(", ")}); another worker may touch the same tree.`,
    "Commit on your branch. Prefer a distinct approach from other workers.",
  ].join(" ");
}

export interface SessionCompare {
  groupId: string;
  role: string;
  peerId?: string;
  memberIds?: string[];
  kind?: CompareKind;
  parentId?: string;
  branch?: string;
}

export function parseWorkerCount(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isInteger(n) || n < WORKER_COUNT_MIN || n > WORKER_COUNT_MAX) return undefined;
  return n;
}

export function parseSessionCompare(value: unknown): SessionCompare | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const groupId = typeof raw.groupId === "string" ? raw.groupId.trim() : "";
  const role = typeof raw.role === "string" ? raw.role.trim() : "";
  if (!groupId || !role) return undefined;
  if (raw.kind === "workers") {
    const memberIds = uniqueIds(raw.memberIds);
    if (memberIds.length < WORKER_COUNT_MIN || memberIds.length > WORKER_COUNT_MAX)
      return undefined;
    const parentId = typeof raw.parentId === "string" ? raw.parentId.trim() : "";
    const branch = typeof raw.branch === "string" ? raw.branch.trim() : "";
    return {
      groupId,
      kind: "workers",
      role,
      memberIds,
      ...(parentId ? { parentId } : {}),
      ...(branch ? { branch } : {}),
    };
  }
  const peerId = typeof raw.peerId === "string" ? raw.peerId.trim() : "";
  if (!peerId || (role !== "A" && role !== "B")) return undefined;
  return { groupId, role, peerId };
}

function uniqueIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function lastUserPrompt(
  messages: Array<{ role: string; content: string }>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role !== "user") continue;
    const text = messages[i]!.content.trim();
    if (text) return text;
  }
  return undefined;
}

/** User prompt plus later steers in the current turn (for spawn_agent kind override). */
export function turnUserPrompt(
  messages: Array<{ role: string; content: string; steer?: boolean }>,
): string | undefined {
  let start = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    if (!message.content.trim()) continue;
    start = i;
    if (!message.steer) break;
  }
  if (start < 0) return undefined;
  const parts: string[] = [];
  for (let i = start; i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const text = message.content.trim();
    if (text) parts.push(text);
  }
  return parts.length ? parts.join("\n") : undefined;
}

export function comparePeer<T extends { id: string; compare?: SessionCompare }>(
  session: T,
  sessions: T[],
): T | undefined {
  const link = session.compare;
  if (!link) return undefined;
  const peer = sessions.find((row) => row.id === link.peerId);
  if (!peer?.compare) return undefined;
  if (peer.compare.peerId !== session.id) return undefined;
  if (peer.compare.groupId !== link.groupId) return undefined;
  return peer;
}

export function compareGroup<T extends { id: string; compare?: SessionCompare }>(
  session: T,
  sessions: T[],
): T[] {
  const link = session.compare;
  if (!link) return [];
  if (link.kind === "workers" && link.memberIds?.length) {
    return link.memberIds
      .map((id) => sessions.find((row) => row.id === id))
      .filter((row): row is T => Boolean(row?.compare && row.compare.groupId === link.groupId));
  }
  const peer = comparePeer(session, sessions);
  return peer ? [session, peer] : [];
}

export function isWorkerCompare(value: SessionCompare | undefined): boolean {
  return value?.kind === "workers";
}

/** Prefer another model on the same provider, then another provider, else the current pair. */
export function otherCompareModel(
  providers: AiProvider[],
  providerId: string,
  model: string,
): { providerId: string; model: string } {
  const current = providers.find((p) => p.id === providerId);
  const alt = current?.models.find((name) => name !== model);
  if (current && alt) return { providerId: current.id, model: alt };
  const other = providers.find((p) => p.id !== providerId);
  const otherModel = other?.defaultModel || other?.models[0];
  if (other && otherModel) return { providerId: other.id, model: otherModel };
  return { providerId, model };
}
