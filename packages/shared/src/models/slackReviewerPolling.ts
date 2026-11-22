/**
 * How often Slack PR reviewers poll while Socket Mode isn't delivering message events (Settings →
 * Reviewers → Polling). Three modes:
 *
 * - `fixed`: every read runs at its base interval.
 * - `adaptive`: each reviewer slows down while its polls find nothing new (×1.5 per quiet poll, up
 *   to `maxBackoff` × the base) and snaps back to the base as soon as one finds something.
 * - `smart`: adaptive, plus it stays at the base while the reviewer has a review queued or
 *   running or finished one in the last few minutes (people reply to results), and outside
 *   `activeHours` a quiet poll goes straight to the slowest interval.
 *
 * Pure helpers; `apps/server/src/slack/slackReviewer.ts` keeps the per-reviewer cadence.
 */

export const SLACK_REVIEWER_POLL_MODES = ["fixed", "adaptive", "smart"] as const;
export type SlackReviewerPollMode = (typeof SLACK_REVIEWER_POLL_MODES)[number];

/** The three reads a reviewer polls. */
export type SlackReviewerPollKind = "channel" | "threads" | "autoReview";

export interface SlackReviewerActiveHours {
  /** First active hour, 0–23, in the server's local time. */
  start: number;
  /** Hour the active window ends (exclusive), 1–24. Below `start` wraps past midnight. */
  end: number;
  /** Saturday and Sunday are quiet all day. */
  weekdaysOnly: boolean;
}

export interface SlackReviewerPolling {
  mode: SlackReviewerPollMode;
  /** Channel history read, seconds. */
  channelSec: number;
  /** Watched review threads read, seconds. */
  threadSec: number;
  /** `autoReview` open-PR listing, seconds. */
  autoReviewSec: number;
  /** Adaptive and smart: the slowest interval, as a multiple of the base. */
  maxBackoff: number;
  /** Smart: when people are around. */
  activeHours: SlackReviewerActiveHours;
}

export const SLACK_REVIEWER_POLLING_LIMITS = {
  channelSec: [5, 600],
  threadSec: [15, 1_800],
  autoReviewSec: [60, 3_600],
  maxBackoff: [1, 30],
} as const satisfies Record<string, readonly [number, number]>;

export const DEFAULT_SLACK_REVIEWER_POLLING: SlackReviewerPolling = {
  mode: "fixed",
  channelSec: 20,
  threadSec: 60,
  autoReviewSec: 300,
  maxBackoff: 8,
  activeHours: { start: 8, end: 19, weekdaysOnly: true },
};

/** Each quiet poll multiplies the interval by this, in adaptive and smart. */
export const SLACK_POLL_BACKOFF_FACTOR = 1.5;
/** Smart: a review that ended this recently still counts as the reviewer being busy. */
export const SLACK_POLL_BUSY_GRACE_MS = 10 * 60_000;

export type SlackReviewerPollingNumberField = keyof typeof SLACK_REVIEWER_POLLING_LIMITS;

export function clampSlackReviewerPolling(
  field: SlackReviewerPollingNumberField,
  raw: unknown,
): number {
  const [min, max] = SLACK_REVIEWER_POLLING_LIMITS[field];
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || (raw as unknown) === "")
    return DEFAULT_SLACK_REVIEWER_POLLING[field];
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampHour(raw: unknown, min: number, max: number, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(max, Math.max(min, Math.round(raw)))
    : fallback;
}

export function parseSlackReviewerPolling(raw: unknown): SlackReviewerPolling {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const hours =
    value.activeHours && typeof value.activeHours === "object"
      ? (value.activeHours as Record<string, unknown>)
      : {};
  const defaults = DEFAULT_SLACK_REVIEWER_POLLING;
  return {
    mode: SLACK_REVIEWER_POLL_MODES.includes(value.mode as SlackReviewerPollMode)
      ? (value.mode as SlackReviewerPollMode)
      : defaults.mode,
    channelSec: clampSlackReviewerPolling("channelSec", value.channelSec),
    threadSec: clampSlackReviewerPolling("threadSec", value.threadSec),
    autoReviewSec: clampSlackReviewerPolling("autoReviewSec", value.autoReviewSec),
    maxBackoff: clampSlackReviewerPolling("maxBackoff", value.maxBackoff),
    activeHours: {
      start: clampHour(hours.start, 0, 23, defaults.activeHours.start),
      end: clampHour(hours.end, 1, 24, defaults.activeHours.end),
      weekdaysOnly:
        typeof hours.weekdaysOnly === "boolean"
          ? hours.weekdaysOnly
          : defaults.activeHours.weekdaysOnly,
    },
  };
}

/** Whether `date` (server local time) falls inside the smart mode's active hours. */
export function inSlackReviewerActiveHours(hours: SlackReviewerActiveHours, date: Date): boolean {
  const day = date.getDay();
  if (hours.weekdaysOnly && (day === 0 || day === 6)) return false;
  const hour = date.getHours();
  if (hours.start === hours.end % 24) return true; // Same start and end: all day.
  return hours.start < hours.end
    ? hour >= hours.start && hour < hours.end
    : hour >= hours.start || hour < hours.end;
}

/** The interval a read runs at when something is going on. `overrideMs` replaces it (tests). */
export function slackPollBaseMs(
  policy: SlackReviewerPolling,
  kind: SlackReviewerPollKind,
  overrideMs?: number,
): number {
  if (overrideMs !== undefined) return overrideMs;
  const sec =
    kind === "channel"
      ? policy.channelSec
      : kind === "threads"
        ? policy.threadSec
        : policy.autoReviewSec;
  return sec * 1_000;
}

/** The slowest interval a read backs off to. Equal to the base in fixed mode. */
export function slackPollCeilingMs(
  policy: SlackReviewerPolling,
  kind: SlackReviewerPollKind,
  overrideMs?: number,
): number {
  const base = slackPollBaseMs(policy, kind, overrideMs);
  return policy.mode === "fixed" ? base : base * policy.maxBackoff;
}

/** Where one read of one reviewer stands. */
export interface SlackPollCadence {
  /** When it last ran (ms since epoch). */
  lastAt: number;
  /** Wait after `lastAt` before it runs again. */
  intervalMs: number;
  /** The wait came from smart mode's quiet hours, not from quiet polls. */
  offHours?: true;
}

export interface SlackPollSignals {
  now: number;
  /** Smart: a review or answer is queued or running, or one ended in the last few minutes. */
  busy?: boolean;
  /** Replaces the base interval (tests). */
  overrideMs?: number;
}

/**
 * How long to wait after the last run, under the current policy. Clamped to the policy's base and
 * ceiling, so a Settings change applies at once instead of after the old interval.
 */
export function slackPollWaitMs(
  policy: SlackReviewerPolling,
  kind: SlackReviewerPollKind,
  cadence: SlackPollCadence | undefined,
  signals: SlackPollSignals,
): number {
  const base = slackPollBaseMs(policy, kind, signals.overrideMs);
  if (!cadence || policy.mode === "fixed") return base;
  if (policy.mode === "smart") {
    if (signals.busy) return base;
    // Quiet hours ended: back to the base until polls say otherwise.
    if (cadence.offHours && inSlackReviewerActiveHours(policy.activeHours, new Date(signals.now)))
      return base;
  }
  const ceiling = slackPollCeilingMs(policy, kind, signals.overrideMs);
  return Math.min(ceiling, Math.max(base, cadence.intervalMs));
}

/** Whether the read is due now. Never run yet means due. */
export function slackPollDue(
  policy: SlackReviewerPolling,
  kind: SlackReviewerPollKind,
  cadence: SlackPollCadence | undefined,
  signals: SlackPollSignals,
): boolean {
  if (!cadence) return true;
  return signals.now - cadence.lastAt >= slackPollWaitMs(policy, kind, cadence, signals);
}

/**
 * The cadence after a run. `activity`: the run found something new (a post, a thread reply, a new
 * or changed PR), so people are around and the next one comes at the base interval.
 */
export function nextSlackPollCadence(
  policy: SlackReviewerPolling,
  kind: SlackReviewerPollKind,
  previous: SlackPollCadence | undefined,
  signals: SlackPollSignals & { activity: boolean },
): SlackPollCadence {
  const base = slackPollBaseMs(policy, kind, signals.overrideMs);
  const ceiling = slackPollCeilingMs(policy, kind, signals.overrideMs);
  const at = signals.now;
  if (policy.mode === "fixed" || signals.activity) return { lastAt: at, intervalMs: base };
  if (policy.mode === "smart") {
    if (signals.busy) return { lastAt: at, intervalMs: base };
    if (!inSlackReviewerActiveHours(policy.activeHours, new Date(at)))
      return { lastAt: at, intervalMs: ceiling, offHours: true };
  }
  const grown = previous
    ? Math.round(Math.max(base, previous.intervalMs) * SLACK_POLL_BACKOFF_FACTOR)
    : base;
  return { lastAt: at, intervalMs: Math.min(ceiling, grown) };
}

/** What a reviewer's reads are polling at now, for Settings. */
export interface SlackReviewerPollStatus {
  /** Socket Mode is delivering events: reads follow events, with a slow safety sweep. */
  events: boolean;
  /** Current wait per read, ms. Missing when the read doesn't apply (no threads, no autoReview). */
  channelMs?: number;
  threadsMs?: number;
  autoReviewMs?: number;
  /** Smart mode is in quiet hours. */
  offHours?: boolean;
  /** Smart mode is holding the base interval for a review in progress or just finished. */
  busy?: boolean;
}

/** "20s", "1m 30s", "5m", "1h". */
export function formatSlackPollInterval(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1_000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3_600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(sec / 3_600);
  const m = Math.round((sec % 3_600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
