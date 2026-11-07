import { MAX_CHAT_ATTACHMENTS } from "./chatLimits.js";

export const MAX_PROMPT_QUEUE = 32;

export interface PromptQueueAttachment {
  name: string;
  mime: string;
  bytes: number;
  storedName: string;
}

export interface PromptQueueItem {
  id: string;
  text: string;
  plan?: boolean;
  skill?: string;
  attachments?: PromptQueueAttachment[];
  /** Wake this session when the queued turn finishes / needs_you / fails. */
  notifySessionId?: string;
  /**
   * When false, a group-chat mention still posts the peer reply on the shared
   * transcript but does not spend a coordinator LLM turn on ordinary `done`.
   */
  wakeRequester?: boolean;
}

function parseQueueAttachments(raw: unknown): PromptQueueAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PromptQueueAttachment[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const mime = typeof value.mime === "string" ? value.mime.trim() : "";
    const storedName = typeof value.storedName === "string" ? value.storedName.trim() : "";
    const bytes =
      typeof value.bytes === "number" && Number.isFinite(value.bytes)
        ? Math.max(0, Math.round(value.bytes))
        : 0;
    if (!name || !storedName) continue;
    out.push({ name, mime: mime || "application/octet-stream", bytes, storedName });
    if (out.length >= MAX_CHAT_ATTACHMENTS) break;
  }
  return out.length ? out : undefined;
}

export function normalizePromptQueue(raw: unknown): PromptQueueItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PromptQueueItem[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const text = typeof value.text === "string" ? value.text.trim() : "";
    const attachments = parseQueueAttachments(value.attachments);
    if (!text && !attachments?.length) continue;
    const id =
      typeof value.id === "string" && value.id.trim() ? value.id.trim() : `q${out.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const skill = typeof value.skill === "string" ? value.skill.trim().toLowerCase() : "";
    const notifySessionId =
      typeof value.notifySessionId === "string" ? value.notifySessionId.trim() : "";
    out.push({
      id,
      text,
      plan: value.plan === true ? true : undefined,
      skill: skill || undefined,
      attachments,
      notifySessionId: notifySessionId || undefined,
      wakeRequester: value.wakeRequester === false ? false : undefined,
    });
    if (out.length >= MAX_PROMPT_QUEUE) break;
  }
  return out;
}

export function queueItemBadge(item: PromptQueueItem): string | undefined {
  if (item.plan) return "Plan";
  if (item.skill) return `/${item.skill}`;
  return undefined;
}

/** True when `text` is already waiting as a follow-up (ignore attachment-only rows). */
export function promptMatchesQueue(queue: PromptQueueItem[] | undefined, text: string): boolean {
  const needle = text.trim();
  if (!needle) return false;
  return (queue ?? []).some((item) => item.text === needle);
}

/**
 * Queue rows that have not already landed as the latest user message.
 * A same-text follow-up with attachments still counts as pending.
 */
export function pendingPromptQueue(
  queue: PromptQueueItem[] | undefined,
  landedText?: string,
): PromptQueueItem[] {
  const rows = queue ?? [];
  const landed = landedText?.trim();
  if (!landed) return rows;
  return rows.filter((item) => item.text !== landed || Boolean(item.attachments?.length));
}

/** Drop text-only queue rows that match a prompt that just landed in the thread. */
export function dropLandedQueueItems(
  queue: PromptQueueItem[] | undefined,
  landedText: string,
): PromptQueueItem[] | undefined {
  const next = pendingPromptQueue(queue, landedText);
  if (next.length === (queue?.length ?? 0)) return queue;
  return next.length ? next : undefined;
}
