/**
 * The Slack reviewer's persisted state (`<dataDir>/slack-reviewers/state.json`): per-reviewer
 * cursors, reviewed PRs, watched threads, votes, remembered dismissals, `autoReview` polling and
 * the accuracy ledger, plus the saved queue and recent runs. Also the queued job shapes, the
 * limits that keep the file bounded, and reading and writing it.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type SlackRepoNote,
  type ParsedPullUrl,
  type SlackPriorFinding,
  type SlackReviewer,
  type SlackReviewOutcome,
  type SlackReviewRun,
  addSlackReviewStats,
  type SlackReviewStatsDay,
  type SlackReviewStatsDelta,
  type SlackAutoSeenPull,
} from "@locus/shared";

export interface ReviewedEntry {
  sha: string;
  at: string;
  outcome: SlackReviewOutcome;
  /** Findings from the last review that produced any, for the follow-up review. */
  findings?: SlackPriorFinding[];
  /** Head SHA `findings` were made at (a later skip can move `sha` on). */
  findingsSha?: string;
  summary?: string;
  /** Head SHA of the last review that ran to the end. A follow-up can diff from here. */
  reviewedSha?: string;
  /** Findings the author dismissed in the thread ("won't fix #2"). Never raised again. */
  dismissed?: SlackPriorFinding[];
  /** Newest PR comment already checked for "won't fix" replies on the forge. */
  forgeCursor?: string;
  /** Reviews of this PR that ran to the end, for per-round reactions (💬, 💬+1, 💬+2). */
  rounds?: number;
}

/** A Slack thread the reviewer replied in, watched for "re-review" replies. */
export interface ThreadEntry {
  /** Thread root: the post that asked for the review. */
  ts: string;
  url: string;
  /** Newest reply ts already scanned. */
  cursor: string;
  /** Last review in this thread; the thread stops being watched `THREAD_WATCH_MS` after it. */
  at: string;
  /** Last time the PR was read and still open. Merged or closed stops the watch. */
  checked?: string;
  /** The reviewer's last final message in the thread, whose 👍 / 👎 are counted. */
  resultTs?: string;
  /** Questions answered in this thread. */
  answers?: number;
  /** "Comments addressed" reactions on the root at the last scan, by name. */
  addressed?: Record<string, number>;
  /**
   * The last reply in this thread was a skip that a person may override (a draft, an opt-out
   * label, an already reviewed commit): asking again here reviews anyway.
   */
  skipped?: true;
}

/** 👍 / 👎 on one final message. */
export interface FeedbackEntry {
  pr: string;
  at: string;
  up: number;
  down: number;
}

export interface ReviewerState {
  channelId: string;
  /** Newest Slack ts already scanned. */
  cursor?: string;
  reviewed: Record<string, ReviewedEntry>;
  /** Review threads by PR key. */
  threads?: Record<string, ThreadEntry>;
  /** Votes on final messages, by message ts. */
  feedback?: Record<string, FeedbackEntry>;
  /** Findings dismissed on earlier PRs, by `slackRepoNotesKey`. Sent with later reviews of that repo. */
  repoNotes?: Record<string, SlackRepoNote[]>;
  /** What `autoReview` polling has seen. */
  autoReview?: AutoReviewState;
  /** Newest PR comment checked for "@locus review", by PR key. */
  prCommands?: Record<string, string>;
  /** Accuracy ledger: one bucket per UTC day, the last 90 days. */
  stats?: SlackReviewStatsDay[];
}

/** `autoReview` polling state for one reviewer. */
export interface AutoReviewState {
  /** Repos (`owner/repo`, lower case) listed at least once, so a PR new after that is new. */
  primed: Record<string, string>;
  /** Open PRs seen, by PR key. */
  pulls: Record<string, SlackAutoSeenPull & { repo: string; postTs?: string }>;
}

export interface QueuedJob {
  reviewerId: string;
  url: string;
  channelId: string;
  messageTs: string;
  requestTs?: string;
  rereview?: boolean;
  retry?: boolean;
  fullRereview?: boolean;
  force?: boolean;
  at: string;
}

export interface StateFile {
  reviewers: Record<string, ReviewerState>;
  /** Reviews queued or running when state was last saved. Replayed on start. */
  queue?: QueuedJob[];
  /** The last runs, newest first, so Recent reviews survives a restart. */
  runs?: SlackReviewRun[];
}

export interface ReviewJob {
  reviewer: SlackReviewer;
  pr: ParsedPullUrl;
  url: string;
  channelId: string;
  /** Original Slack post; replies go in its thread. Undefined for API-triggered runs with no thread. */
  messageTs?: string;
  /**
   * The reply that asked for this review in a thread that wasn't watched (an @-mention). The
   * thread is watched from after it, so the same reply doesn't ask again.
   */
  requestTs?: string;
  /** Asked for in the review thread: review again even with `rereviewOnNewCommits` off. */
  rereview?: boolean;
  /** Review the full PR diff, even if this head commit has already been reviewed. */
  fullRereview?: boolean;
  /** Settings "Try it" dry run: review, but post nothing and record nothing. */
  dryRun?: boolean;
  /** "retry" in the thread: review even a commit already reviewed. */
  retry?: boolean;
  /**
   * Asked for in a thread whose last reply was a skip: review even a draft, a PR with an opt-out
   * label or title marker, or a commit already reviewed. Closed PRs and other filters still apply.
   */
  force?: boolean;
}

export interface AnswerJob {
  reviewer: SlackReviewer;
  pr: ParsedPullUrl;
  url: string;
  channelId: string;
  /** Review thread root. */
  threadTs: string;
  question: string;
  asker?: string;
}

export const MAX_REVIEWED_PER_REVIEWER = 500;
export const MAX_RECENT_RUNS = 50;
/** A review thread quiet this long stops being watched; post the link again to restart. */
export const THREAD_WATCH_MS = 7 * 24 * 60 * 60 * 1000;
/** Questions answered per review thread, so a chatty thread can't run up a bill. */
export const MAX_ANSWERS_PER_THREAD = 10;
/** Final messages whose votes are kept per reviewer. */
export const MAX_FEEDBACK_PER_REVIEWER = 500;
/** A queued review older than this when the server starts is dropped, not replayed. */
export const QUEUE_REPLAY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Watched-thread key suffix for a skip reply on a second post of a PR (`<pr key> skip:<ts>`). */
export const SKIP_THREAD_KEY = " skip:";

/** Read the state file; a missing or unreadable file starts empty. */
export async function readReviewerStateFile(path: string): Promise<StateFile> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as StateFile;
    return raw && typeof raw.reviewers === "object" ? raw : { reviewers: {} };
  } catch {
    return { reviewers: {} };
  }
}

/** Write the state file through a temp file, so a crash mid-write leaves the old one whole. */
export async function writeReviewerStateFile(path: string, state: StateFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, path);
}

/** A reviewer's slice of the state, made fresh when the reviewer is new or its channel changed. */
export function reviewerStateFor(state: StateFile, reviewer: SlackReviewer): ReviewerState {
  const current = state.reviewers[reviewer.id];
  if (current && current.channelId === reviewer.channelId) return current;
  // New reviewer or the channel changed: start fresh so an old cursor does not skip or replay.
  const next: ReviewerState = {
    channelId: reviewer.channelId,
    reviewed: current?.reviewed ?? {},
    ...(current?.repoNotes ? { repoNotes: current.repoNotes } : {}),
    ...(current?.stats ? { stats: current.stats } : {}),
  };
  state.reviewers[reviewer.id] = next;
  return next;
}

/** Add to today's bucket of a reviewer's accuracy ledger (the caller saves). */
export function recordReviewerStats(
  rs: ReviewerState,
  delta: SlackReviewStatsDelta,
  now: number,
): void {
  rs.stats = addSlackReviewStats(rs.stats, delta, now);
}

/** State written before `reviewedSha` existed: a finished outcome's `sha` is the reviewed one. */
export function legacyReviewedSha(entry: ReviewedEntry | undefined): string | undefined {
  if (!entry) return undefined;
  return entry.outcome === "skipped" || entry.outcome === "failed" ? undefined : entry.sha;
}

/** Finished reviews of a PR so far. Entries saved before rounds were counted had at least one. */
export function slackReviewRounds(entry: ReviewedEntry | undefined): number {
  if (!entry) return 0;
  if (entry.rounds !== undefined) return entry.rounds;
  return entry.reviewedSha || legacyReviewedSha(entry) ? 1 : 0;
}

/** Channel posts `autoReview` made, so the channel scan doesn't take them for a request. */
export function autoReviewPostTs(rs: ReviewerState): Set<string> {
  const out = new Set<string>();
  for (const row of Object.values(rs.autoReview?.pulls ?? {})) if (row.postTs) out.add(row.postTs);
  return out;
}
