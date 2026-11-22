/**
 * Risk-gated merge: when the latest review verdict for a pull request (or a parallel worker)
 * is at or above the configured risk, merge-type actions need an explicit human approval.
 * Autonomous tiers, `autoAllow`, and Always allow do not bypass it.
 */
import { parseAgentVerdict, parseAnyReviewVerdict, type AgentVerdict } from "../verdict.js";
import { parseCiFixMaxAttempts } from "../ciLog.js";
import { normalizeRepoUrl } from "./git.js";
import type { ApprovalPolicy } from "./approval.js";

/**
 * `high` (default): FAIL or risk high needs approval. `low`: every reviewed merge needs
 * approval. `never`: off. Verdict risk is only low|high today, so `medium` reads as `high`.
 */
export const REVIEW_RISK_THRESHOLDS = ["high", "low", "never"] as const;
export type ReviewRiskThreshold = (typeof REVIEW_RISK_THRESHOLDS)[number];
export const DEFAULT_REVIEW_RISK_THRESHOLD: ReviewRiskThreshold = "high";

export interface ReviewSettings {
  /** Merge / Pick this one / git_pr_merge need a human when the latest verdict is at or above this. */
  requireApprovalAtRisk?: ReviewRiskThreshold;
  /** Consecutive automatic CI fix attempts per failing check before Needs you. Default 2. */
  ciFixMaxAttempts?: number;
}

export function parseReviewRiskThreshold(raw: unknown): ReviewRiskThreshold {
  if (typeof raw !== "string") return DEFAULT_REVIEW_RISK_THRESHOLD;
  const value = raw.trim().toLowerCase();
  if (value === "medium") return "high";
  if (value === "any" || value === "always") return "low";
  if (value === "off" || value === "none") return "never";
  return (REVIEW_RISK_THRESHOLDS as readonly string[]).includes(value)
    ? (value as ReviewRiskThreshold)
    : DEFAULT_REVIEW_RISK_THRESHOLD;
}

export function parseReviewSettings(raw: unknown): ReviewSettings {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    requireApprovalAtRisk: parseReviewRiskThreshold(value.requireApprovalAtRisk),
    ciFixMaxAttempts: parseCiFixMaxAttempts(value.ciFixMaxAttempts),
  };
}

export interface RiskGate {
  gated: boolean;
  verdict?: AgentVerdict;
  threshold: ReviewRiskThreshold;
  /** Operator-facing reason, set when gated. */
  reason?: string;
  /** Session the verdict came from. */
  sourceId?: string;
}

/** Pure predicate: does this verdict need a human before merge at this threshold? */
export function verdictNeedsMergeApproval(
  verdict: Pick<AgentVerdict, "verdict" | "risk"> | undefined,
  threshold: ReviewRiskThreshold = DEFAULT_REVIEW_RISK_THRESHOLD,
): boolean {
  if (!verdict || threshold === "never") return false;
  if (threshold === "low") return true;
  return verdict.risk === "high" || verdict.verdict === "FAIL";
}

export function reviewRiskGate(
  verdict: AgentVerdict | undefined,
  settings?: ReviewSettings,
  sourceId?: string,
): RiskGate {
  const threshold = parseReviewRiskThreshold(settings?.requireApprovalAtRisk);
  const gated = verdictNeedsMergeApproval(verdict, threshold);
  return {
    gated,
    threshold,
    ...(verdict ? { verdict } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(gated && verdict ? { reason: riskGateReason(verdict) } : {}),
  };
}

export function riskGateReason(
  verdict: Pick<AgentVerdict, "verdict" | "risk" | "reasons">,
): string {
  const why = verdict.reasons.length ? `: ${verdict.reasons.slice(0, 3).join("; ")}` : "";
  return `Review ${verdict.verdict} (risk ${verdict.risk})${why}. Merge needs your approval.`;
}

interface VerdictSession {
  id: string;
  kind?: string;
  repoId?: string;
  repo?: { url?: string };
  pull?: { number?: number };
  archived?: boolean;
  updatedAt: string;
  messages: Array<{
    role: string;
    content?: string;
    toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
  }>;
}

function samePullRepo(row: VerdictSession, target: { repoId?: string; repoUrl?: string }): boolean {
  if (target.repoId && row.repoId === target.repoId) return true;
  const a = target.repoUrl ? normalizeRepoUrl(target.repoUrl) : "";
  const b = row.repo?.url ? normalizeRepoUrl(row.repo.url) : "";
  return Boolean(a && b && a === b);
}

/**
 * Latest review verdict for a pull: newest non-archived review session on that repo + PR
 * with a parseable verdict.
 */
export function latestPullVerdict(
  sessions: VerdictSession[],
  target: { repoId?: string; repoUrl?: string; number: number },
): { verdict: AgentVerdict; sessionId: string } | undefined {
  const rows = sessions
    .filter(
      (row) =>
        row.kind === "review" &&
        !row.archived &&
        row.pull?.number === target.number &&
        samePullRepo(row, target),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const row of rows) {
    const verdict = parseAnyReviewVerdict(row.messages);
    if (verdict) return { verdict, sessionId: row.id };
  }
  return undefined;
}

/**
 * Latest verdict for a parallel worker: a review of its PR when it opened one, else a
 * `{verdict, reasons, risk}` JSON in its own transcript (e.g. a review sub-agent summary).
 */
export function latestWorkerVerdict(
  worker: VerdictSession,
  sessions: VerdictSession[],
): { verdict: AgentVerdict; sessionId: string } | undefined {
  if (worker.pull?.number) {
    const fromPull = latestPullVerdict(sessions, {
      repoId: worker.repoId,
      repoUrl: worker.repo?.url,
      number: worker.pull.number,
    });
    if (fromPull) return fromPull;
  }
  for (let i = worker.messages.length - 1; i >= 0; i -= 1) {
    const message = worker.messages[i];
    if (message?.role !== "assistant") continue;
    const verdict = parseAgentVerdict(message.content ?? "");
    if (verdict) return { verdict, sessionId: worker.id };
  }
  return undefined;
}

/** Tools that merge a pull request. `git_pr` opens one and is not gated here. */
export const RISK_GATED_TOOLS = ["git_pr_merge"] as const;

export function isRiskGatedTool(name: string): boolean {
  return (RISK_GATED_TOOLS as readonly string[]).includes(name);
}

/**
 * Force approval for merge tools on a gated pull. Appended after sticky Always-allow is
 * subtracted, and `alwaysAsk` wins over `autoAllow`, so autonomy cannot skip it.
 * `pullNumbers` scopes the ask to those PRs (`git_pr_merge(pull_number:N)`); `sessionPull`
 * also gates a bare `git_pr_merge` that targets the session's own PR.
 */
export function withRiskGate(
  policy: ApprovalPolicy,
  gate: { pullNumbers: number[]; sessionPull?: boolean },
): ApprovalPolicy {
  if (!gate.pullNumbers.length && !gate.sessionPull) return policy;
  const alwaysAsk = [...(policy.alwaysAsk ?? [])];
  const deny = policy.deny ?? [];
  for (const tool of RISK_GATED_TOOLS) {
    if (deny.includes(tool)) continue;
    const entries = gate.sessionPull
      ? [tool]
      : gate.pullNumbers.map((number) => `${tool}(pull_number:${number})`);
    for (const entry of entries) if (!alwaysAsk.includes(entry)) alwaysAsk.push(entry);
  }
  return { ...policy, alwaysAsk };
}

/** Error body when an HTTP merge is refused for a missing approval. */
export interface RiskGateRefusal {
  error: string;
  riskGate: { reason: string; verdict?: AgentVerdict; threshold: ReviewRiskThreshold };
}

export function riskGateRefusal(gate: RiskGate): RiskGateRefusal {
  const reason = gate.reason ?? "Merge needs your approval.";
  return {
    error: reason,
    riskGate: {
      reason,
      threshold: gate.threshold,
      ...(gate.verdict ? { verdict: gate.verdict } : {}),
    },
  };
}
