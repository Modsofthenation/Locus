import type { ChatMessage } from "./models/session.js";
import { formatWorkingState, type AgentWorkingState } from "./models/workingState.js";
import { redactKnownSecrets } from "./security.js";

export type TraceLevel = "debug" | "info" | "warn" | "error";

export type TraceKind =
  | "turn.start"
  | "turn.end"
  | "llm.request"
  | "llm.response"
  | "llm.retry"
  | "tool.call"
  | "tool.result"
  | "compact"
  | "subagent.start"
  | "subagent.end"
  | "governor"
  | "egress"
  | "approval"
  | "selfCorrect"
  | "blocked"
  | "error";

export interface TraceEvent {
  t: string;
  kind: TraceKind;
  level?: TraceLevel;
  sessionId: string;
  turnId?: string;
  round?: number;
  name?: string;
  id?: string;
  ms?: number;
  ok?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  detail?: string;
  args?: Record<string, unknown>;
}

export function formatTraceLine(event: TraceEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function replayTrace(text: string): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as TraceEvent;
      if (parsed && typeof parsed === "object" && typeof parsed.kind === "string")
        events.push(parsed);
    } catch {
      /* skip bad lines */
    }
  }
  return events;
}

export function clipTraceDetail(text: string, max = 4_000): string {
  const one = text.trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

/** Write bodies in traces stay short so jsonl / HTML export is not a second canvas. */
export const TRACE_ARG_CHARS = 2_000;

export function summarizeTrace(events: TraceEvent[]): string {
  const tools = events
    .filter((event) => event.kind === "tool.call")
    .map((event) => event.name)
    .filter(Boolean);
  const retries = events.filter((event) => event.kind === "llm.retry").length;
  const compact = events.some((event) => event.kind === "compact");
  const errors = events.filter((event) => event.kind === "error" || event.ok === false).length;
  const selfCorrects = events.filter((event) => event.kind === "selfCorrect").length;
  const bits = [
    `${events.length} events`,
    tools.length ? `tools ${[...new Set(tools)].join(",")}` : undefined,
    retries ? `${retries} retries` : undefined,
    compact ? "compacted" : undefined,
    selfCorrects ? `${selfCorrects} self-corrects` : undefined,
    errors ? `${errors} errors` : undefined,
  ].filter(Boolean);
  return bits.join(" · ");
}

export interface TraceEvalCase {
  sessionId: string;
  prompt: string;
  tools: Array<{ name: string; ok?: boolean }>;
  failed: boolean;
  outcome: string;
  selfCorrects: number;
  approvals: number;
}

export function evalCaseFromTrace(events: TraceEvent[]): TraceEvalCase {
  const start = events.find((event) => event.kind === "turn.start");
  const end = [...events].reverse().find((event) => event.kind === "turn.end");
  const results = new Map<string, { name: string; ok?: boolean }>();
  for (const event of events) {
    if (event.kind !== "tool.call" && event.kind !== "tool.result") continue;
    const key = event.id || `${event.name ?? "tool"}-${results.size}`;
    const prev = results.get(key);
    results.set(key, {
      name: event.name || prev?.name || "tool",
      ok: event.kind === "tool.result" ? event.ok : prev?.ok,
    });
  }
  const tools = [...results.values()];
  const denied = events.some(
    (event) => event.kind === "tool.result" && /Denied by user|Cancelled/i.test(event.detail ?? ""),
  );
  const failed =
    tools.some((tool) => tool.ok === false) ||
    events.some((event) => event.kind === "error") ||
    events.some((event) => event.kind === "governor" && event.ok === false);
  const lastAssist = [...events]
    .reverse()
    .find((event) => event.kind === "llm.response")
    ?.detail?.trim();
  const lastError = [...events]
    .reverse()
    .find((event) => event.kind === "error" || event.ok === false)
    ?.detail?.trim();
  return {
    sessionId: start?.sessionId || events[0]?.sessionId || "",
    prompt: (start?.detail ?? "").trim(),
    tools,
    failed,
    outcome: lastError || lastAssist || (failed ? "failed" : "ok"),
    selfCorrects: events.filter((event) => event.kind === "selfCorrect").length,
    approvals: typeof end?.args?.approvals === "number" ? end.args.approvals : denied ? 1 : 0,
  };
}

export function workingStateForTrace(state?: AgentWorkingState): string {
  return formatWorkingState(state);
}

export function redactedTraceArgs(args: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (/key|token|secret|password|passwd|auth|credential|bearer|api[_-]?key/i.test(key)) continue;
    next[key] = redactTraceValue(value);
  }
  return next;
}

function redactTraceValue(value: unknown): unknown {
  if (typeof value === "string") {
    const redacted = redactKnownSecrets(value);
    return redacted.length > TRACE_ARG_CHARS
      ? clipTraceDetail(redacted, TRACE_ARG_CHARS)
      : redacted;
  }
  if (Array.isArray(value)) return value.map(redactTraceValue);
  if (value && typeof value === "object") {
    return redactedTraceArgs(value as Record<string, unknown>);
  }
  return value;
}

export const DEBUG_LOG_KINDS = ["trace", "guest"] as const;
export type DebugLogKind = (typeof DEBUG_LOG_KINDS)[number];

export interface DebugLogSource {
  id: string;
  kind: DebugLogKind;
  title: string;
  path: string;
  sessionId?: string;
  vmId?: string;
  bytes: number;
  mtime: string;
  summary: string;
}

export interface DebugLogDetail {
  source: DebugLogSource;
  text: string;
  truncated: boolean;
  events?: TraceEvent[];
}

const DEBUG_LOG_KEY = /^[a-zA-Z0-9._-]+$/;

export function debugLogId(kind: DebugLogKind, key: string): string {
  return `${kind}:${key}`;
}

export function parseDebugLogId(raw: string): { kind: DebugLogKind; key: string } | undefined {
  const split = raw.indexOf(":");
  if (split <= 0) return undefined;
  const kind = raw.slice(0, split);
  const key = raw.slice(split + 1);
  if (kind !== "trace" && kind !== "guest") return undefined;
  if (!DEBUG_LOG_KEY.test(key) || key === "." || key === ".." || key.includes(".."))
    return undefined;
  return { kind, key };
}

export type { ChatMessage };
