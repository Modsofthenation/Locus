/**
 * Slack PR reviewer accuracy: a compact per-reviewer ledger of what each reviewer posted and what
 * happened to it, so Settings can show whether a prompt or severity change helped.
 *
 * The ledger is one bucket per UTC day, kept for `SLACK_REVIEW_STATS_DAYS` days, in the reviewer
 * state file. Buckets hold counts only (reviews, findings posted by severity, dismissals by reason
 * and severity, findings resolved by a follow-up, findings the `verifyFindings` check rejected or
 * downgraded, 👍 / 👎, tokens and estimated cost), so the file can't grow without bound.
 *
 * Precision is estimated as 1 − false-positive dismissals ÷ findings posted, per severity. It is an
 * upper bound: a wrong finding nobody dismissed still counts as right. Dismissals and resolutions
 * are counted on the day they happen, which may be a later day than the finding was posted.
 */
import type { SlackDismissReason, SlackReviewRun, SlackReviewSeverity } from "./slackReviewer.js";

/** Days of buckets kept per reviewer. */
export const SLACK_REVIEW_STATS_DAYS = 90;
/** Window Settings and the runs response show. */
export const SLACK_REVIEW_STATS_DEFAULT_DAYS = 30;

export type SlackReviewSeverityCounts = Partial<Record<SlackReviewSeverity, number>>;

/** Counts for one reviewer on one UTC day. Zero fields are left out. */
export interface SlackReviewStatsDay {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  /** Reviews that ran to the end (posted, or found nothing). */
  reviews?: number;
  failed?: number;
  /** Thread questions answered. */
  answers?: number;
  /** Findings posted, by severity (after the floor, cap, dismissals and the check). */
  posted?: SlackReviewSeverityCounts;
  /** Findings dismissed, by reason, then by severity. */
  dismissed?: Partial<Record<SlackDismissReason, SlackReviewSeverityCounts>>;
  /** Earlier findings a follow-up review found fixed. */
  resolved?: number;
  /** Findings sent to the `verifyFindings` check. */
  verified?: number;
  /** Findings the check rejected (never posted), by their severity before the check. */
  rejected?: SlackReviewSeverityCounts;
  downgraded?: number;
  /** Change in 👍 / 👎 on final replies counted that day (a removed vote subtracts). */
  up?: number;
  down?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  /** Estimated USD, for runs whose model price is known. */
  usd?: number;
}

export type SlackReviewStatsDelta = Omit<SlackReviewStatsDay, "day">;

/** `GET /api/slack/reviewers/:id/stats`: one reviewer over the last `days` days. */
export interface SlackReviewerStats {
  days: number;
  /** First day in the window, `YYYY-MM-DD`. */
  since: string;
  reviews: number;
  failed: number;
  answers: number;
  /** Findings posted, by severity, and in all. */
  posted: SlackReviewSeverityCounts;
  postedTotal: number;
  /** Dismissals by reason (all severities). */
  dismissed: Record<SlackDismissReason, number>;
  /** False-positive dismissals by severity. */
  falsePositives: SlackReviewSeverityCounts;
  /** 1 − false positives ÷ posted, per severity with any findings posted (0–1). */
  precision: SlackReviewSeverityCounts;
  /** The same over all severities; undefined with nothing posted. */
  precisionAll?: number;
  resolved: number;
  /** Resolved ÷ posted (0–1); undefined with nothing posted. */
  resolveRate?: number;
  verified: number;
  rejected: number;
  downgraded: number;
  votes: { up: number; down: number };
  tokens: { input: number; output: number; cached: number };
  /** Estimated spend in the window; undefined when no run had a known price. */
  usd?: number;
  /** Spend per 7 days: over the days the reviewer has data in the window, or less than a week's actual spend. */
  usdPerWeek?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day of a timestamp, `YYYY-MM-DD`. */
export function slackReviewStatsDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Add `delta` into `into` in place: numbers add, nested objects merge. Zeros are dropped. */
function addInto(into: Record<string, unknown>, delta: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(delta)) {
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value === 0) continue;
      const sum = (typeof into[key] === "number" ? (into[key] as number) : 0) + value;
      // Cost keeps fractions; counts stay whole.
      const next = key === "usd" ? Math.round(sum * 1e6) / 1e6 : sum;
      if (next === 0) delete into[key];
      else into[key] = next;
    } else if (isRecord(value)) {
      const child = isRecord(into[key]) ? (into[key] as Record<string, unknown>) : {};
      addInto(child, value);
      if (Object.keys(child).length) into[key] = child;
      else delete into[key];
    }
  }
}

/**
 * Add a delta to today's bucket and drop buckets older than `keepDays`. Returns a new list,
 * oldest first; the input is not changed.
 */
export function addSlackReviewStats(
  days: SlackReviewStatsDay[] | undefined,
  delta: SlackReviewStatsDelta,
  nowMs: number,
  keepDays = SLACK_REVIEW_STATS_DAYS,
): SlackReviewStatsDay[] {
  const today = slackReviewStatsDay(nowMs);
  const oldest = slackReviewStatsDay(nowMs - (keepDays - 1) * DAY_MS);
  const rows = (days ?? [])
    .filter((row) => isRecord(row) && typeof row.day === "string" && row.day >= oldest)
    .map((row) => structuredClone(row));
  let bucket = rows.find((row) => row.day === today);
  if (!bucket) {
    bucket = { day: today };
    rows.push(bucket);
  }
  const { day: _day, ...counts } = delta as SlackReviewStatsDay;
  addInto(bucket as unknown as Record<string, unknown>, counts as Record<string, unknown>);
  return rows.sort((a, b) => a.day.localeCompare(b.day));
}

/** What one finished run adds to the ledger. Undefined for dry runs and runs that spent nothing. */
export function slackReviewStatsFromRun(run: SlackReviewRun): SlackReviewStatsDelta | undefined {
  if (run.dryRun) return undefined;
  const delta: SlackReviewStatsDelta = {};
  if (run.outcome === "answered") delta.answers = 1;
  else if (run.outcome === "failed") delta.failed = 1;
  else if (run.outcome !== "skipped") {
    delta.reviews = 1;
    const posted: SlackReviewSeverityCounts = {};
    for (const row of run.findings ?? []) posted[row.severity] = (posted[row.severity] ?? 0) + 1;
    if (Object.keys(posted).length) delta.posted = posted;
    if (run.resolved) delta.resolved = run.resolved;
    if (run.verification) {
      delta.verified = run.verification.checked;
      delta.rejected = { ...run.verification.rejected };
      delta.downgraded = run.verification.downgraded;
    }
  }
  if (run.usage) {
    delta.inputTokens = run.usage.inputTokens;
    delta.outputTokens = run.usage.outputTokens;
    if (run.usage.cachedInputTokens) delta.cachedInputTokens = run.usage.cachedInputTokens;
  }
  if (run.usd !== undefined && Number.isFinite(run.usd)) delta.usd = run.usd;
  const spent = Boolean(delta.inputTokens || delta.outputTokens || delta.usd);
  if (run.outcome === "skipped" && !spent) return undefined;
  return delta;
}

function sumSeverities(counts: SlackReviewSeverityCounts | undefined): number {
  return Object.values(counts ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Totals and derived rates over the last `days` days (today included). */
export function summarizeSlackReviewStats(
  buckets: SlackReviewStatsDay[] | undefined,
  opts: { days?: number; now: number },
): SlackReviewerStats {
  const days = Math.min(
    SLACK_REVIEW_STATS_DAYS,
    Math.max(1, Math.round(opts.days ?? SLACK_REVIEW_STATS_DEFAULT_DAYS)),
  );
  const since = slackReviewStatsDay(opts.now - (days - 1) * DAY_MS);
  const rows = (buckets ?? []).filter((row) => typeof row?.day === "string" && row.day >= since);
  const total: SlackReviewStatsDay = { day: since };
  for (const { day: _day, ...row } of rows) {
    addInto(total as unknown as Record<string, unknown>, row as Record<string, unknown>);
  }
  const posted = total.posted ?? {};
  const postedTotal = sumSeverities(posted);
  const falsePositives = { ...(total.dismissed?.["false-positive"] ?? {}) };
  const precision: SlackReviewSeverityCounts = {};
  for (const [severity, count] of Object.entries(posted) as Array<[SlackReviewSeverity, number]>) {
    if (count > 0) precision[severity] = clamp01(1 - (falsePositives[severity] ?? 0) / count);
  }
  const fpTotal = sumSeverities(falsePositives);
  const resolved = total.resolved ?? 0;
  const out: SlackReviewerStats = {
    days,
    since,
    reviews: total.reviews ?? 0,
    failed: total.failed ?? 0,
    answers: total.answers ?? 0,
    posted,
    postedTotal,
    dismissed: {
      "false-positive": fpTotal,
      "by-design": sumSeverities(total.dismissed?.["by-design"]),
      "wont-fix": sumSeverities(total.dismissed?.["wont-fix"]),
    },
    falsePositives,
    precision,
    resolved,
    verified: total.verified ?? 0,
    rejected: sumSeverities(total.rejected),
    downgraded: total.downgraded ?? 0,
    votes: { up: total.up ?? 0, down: total.down ?? 0 },
    tokens: {
      input: total.inputTokens ?? 0,
      output: total.outputTokens ?? 0,
      cached: total.cachedInputTokens ?? 0,
    },
  };
  if (postedTotal > 0) {
    out.precisionAll = clamp01(1 - fpTotal / postedTotal);
    out.resolveRate = clamp01(resolved / postedTotal);
  }
  if (rows.some((row) => row.usd !== undefined)) {
    const usd = total.usd ?? 0;
    // Over the days the reviewer has data in the window, but never stretch less than a week of
    // data into a week: that would invent spend that hasn't happened.
    const first = rows.reduce((min, row) => (row.day < min ? row.day : min), rows[0]!.day);
    const spanDays = Math.min(
      days,
      Math.floor((Date.parse(slackReviewStatsDay(opts.now)) - Date.parse(first)) / DAY_MS) + 1,
    );
    out.usd = Math.round(usd * 1e6) / 1e6;
    out.usdPerWeek = Math.round(((usd * 7) / Math.max(7, spanDays)) * 1e6) / 1e6;
  }
  return out;
}
