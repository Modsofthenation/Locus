import { estimateUsd, type TokenUsage, type UsageRates } from "./models/session.js";

export interface TaskBudget {
  maxUsd?: number;
  maxMs?: number;
  maxRounds?: number;
  maxTokens?: number;
  maxSubagents?: number;
}

export interface TaskSpend {
  usd?: number;
  startedAtMs: number;
  round: number;
  tokens?: number;
  subagents?: number;
}

export type GovernorReason = "usd" | "time" | "rounds" | "tokens" | "subagents";

export type GovernorVerdict =
  | { ok: true; warn?: GovernorReason; message?: string }
  | { ok: false; reason: GovernorReason; message: string };

const WARN_RATIO = 0.8;

export function taskSpendNow(input: {
  startedAtMs: number;
  round: number;
  usage?: TokenUsage;
  rates?: UsageRates;
  subagents?: number;
  nowMs?: number;
  computeUsd?: number;
}): TaskSpend {
  const llmUsd = input.usage ? estimateUsd(input.usage, input.rates) : undefined;
  const computeUsd =
    typeof input.computeUsd === "number" && input.computeUsd > 0 ? input.computeUsd : 0;
  const usd = llmUsd == null ? (computeUsd > 0 ? computeUsd : undefined) : llmUsd + computeUsd;
  const tokens = input.usage ? input.usage.inputTokens + input.usage.outputTokens : undefined;
  return {
    usd,
    startedAtMs: input.startedAtMs,
    round: input.round,
    tokens,
    subagents: input.subagents,
  };
}

export function checkBudget(
  spend: TaskSpend,
  budget: TaskBudget,
  nowMs = Date.now(),
): GovernorVerdict {
  const elapsed = Math.max(0, nowMs - spend.startedAtMs);
  const checks: Array<{ reason: GovernorReason; used: number; max?: number; label: string }> = [
    { reason: "usd", used: spend.usd ?? 0, max: positive(budget.maxUsd), label: "spend cap" },
    { reason: "time", used: elapsed, max: positive(budget.maxMs), label: "time budget" },
    { reason: "rounds", used: spend.round, max: positive(budget.maxRounds), label: "round limit" },
    {
      reason: "tokens",
      used: spend.tokens ?? 0,
      max: positive(budget.maxTokens),
      label: "token budget",
    },
    {
      reason: "subagents",
      used: spend.subagents ?? 0,
      max: positive(budget.maxSubagents),
      label: "sub-agent cap",
    },
  ];
  for (const check of checks) {
    if (check.max == null) continue;
    // Round count is a pacing hint in the loop. Spend, time, tokens, and sub-agents still stop.
    if (check.reason === "rounds") continue;
    if (check.used >= check.max) {
      return {
        ok: false,
        reason: check.reason,
        message: progressStopMessage(check.reason, check.label, check.used, check.max),
      };
    }
  }
  for (const check of checks) {
    if (check.max == null || check.max <= 0) continue;
    if (check.used / check.max >= WARN_RATIO) {
      return {
        ok: true,
        warn: check.reason,
        message: `Near the ${check.label} (${formatUsed(check.reason, check.used)} / ${formatUsed(check.reason, check.max)}). Finish the current step, update task_list, and summarize progress instead of starting new work.`,
      };
    }
  }
  return { ok: true };
}

/** LLM stream timeout for this round. Guest tools can burn the turn wall clock; keep at least
 * 30s (or the whole cap if it is shorter) so the last round is not a 2s provider timeout.
 * When timeCap <= 30s this returns timeCap even if little time remains, so a short turn can
 * run slightly past maxMs rather than dying mid-stream. */
export function providerRoundTimeoutMs(timeCap: number, elapsedMs: number): number {
  const left = timeCap - elapsedMs;
  return Math.max(left, Math.min(30_000, timeCap));
}

export function formatProgressReport(input: {
  reason: string;
  scratchpad?: string;
  tasks?: Array<{ id: string; text: string; status: string }>;
  lastAssistant?: string;
}): string {
  const tasks = input.tasks?.length
    ? input.tasks.map((item) => `- [${item.status}] ${item.id}: ${item.text}`).join("\n")
    : "(none)";
  const pad = input.scratchpad?.trim() ? clip(input.scratchpad.trim(), 800) : "(none)";
  const last = input.lastAssistant?.trim() ? clip(input.lastAssistant.trim(), 400) : "(none)";
  return [
    input.reason,
    "Progress so far (not a silent stop):",
    `Task list:\n${tasks}`,
    `Scratchpad:\n${pad}`,
    `Last agent note:\n${last}`,
  ].join("\n\n");
}

function progressStopMessage(
  reason: GovernorReason,
  label: string,
  used: number,
  max: number,
): string {
  return `Stopped: ${label} reached (${formatUsed(reason, used)} / ${formatUsed(reason, max)}). Reporting progress instead of continuing.`;
}

function formatUsed(reason: GovernorReason, value: number): string {
  if (reason === "usd") return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
  if (reason === "time")
    return value >= 1000 ? `${Math.round(value / 1000)}s` : `${Math.round(value)}ms`;
  return String(Math.round(value));
}

function positive(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
