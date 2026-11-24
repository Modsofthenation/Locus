import { join } from "node:path";
import {
  activeSlackReviewers,
  buildSlackReviewFollowUp,
  buildSlackReviewGuidelines,
  buildSlackReviewSystem,
  buildSlackReviewUserMessage,
  buildSlackReviewDiscussion,
  buildSlackReviewRepoNotes,
  compactPullDiff,
  isTransientReviewError,
  mergeSlackReviewResults,
  planSlackReviewParts,
  slackDiffAnchors,
  slackRepoNotesKey,
  slackResolvedThreadPicker,
  slackReviewPartNote,
  slackReviewCommentCap,
  slackReviewPartSummary,
  SLACK_REVIEW_CI_LOGS_MAX,
  type SlackFindingAnchor,
  type SlackRepoNote,
  type SlackReviewResult,
  estimateTokens,
  estimateUsd,
  extractPullUrls,
  formatSlackReviewFindings,
  formatSlackReviewUsage,
  formatSlackRereviewProgress,
  parsePullUrl,
  parseSlackReviewResult,
  renderSlackReviewerStatus,
  resolveForgeAccount,
  resolveUsageRates,
  reviewPlural,
  settleSlackReview,
  slackPriorFindings,
  slackReviewAuthorMention,
  slackReviewerRepoAllowed,
  slackReviewerWatchesThreads,
  summarizeSlackReviewChecks,
  slackReviewOutcomeReaction,
  slackPostStopped,
  slackReviewPullKey,
  slackReviewPullLabel,
  cliPromptCharLimit,
  slackReviewDiffBudget,
  SLACK_REVIEW_DESCRIPTION_MAX,
  type GitForgeAccount,
  type LocusConfig,
  type ParsedPullUrl,
  type SlackPriorFinding,
  type SlackReviewer,
  type SlackReviewerFeedback,
  type SlackReviewerStatusTemplates,
  type CompactDiff,
  type SlackReviewOutcome,
  type SlackReviewActive,
  type SlackReviewTrace,
  type SlackReviewRun,
  type SlackReviewRunsResponse,
  type SlackReviewerApiLogResponse,
  type SlackReviewThread,
  type TokenUsage,
} from "@locus/shared";
import {
  formatSlackVerifyNote,
  slackFindingsToVerify,
  slackReviewStatsFromRun,
  summarizeSlackReviewStats,
  SLACK_REVIEW_STATS_DEFAULT_DAYS,
  type SlackReviewerStats,
  type SlackReviewStatsDelta,
  type SlackReviewVerification,
  buildSlackReviewConventions,
  buildSlackReviewPathPrompts,
  parseSlackRepoNotesKey,
  slackReviewConventionsBody,
  slackReviewConventionsBranch,
  slackReviewerBaseAllowed,
  slackReviewerRequesterAllowed,
  slackReviewOptOut,
  slackReviewPathPrompts,
  slackReviewProposeSupported,
  SLACK_REVIEW_CONVENTIONS_PATH,
  SLACK_REVIEW_CONVENTIONS_TITLE,
} from "@locus/shared";
import {
  inSlackReviewerActiveHours,
  nextSlackPollCadence,
  parseSlackReviewerPolling,
  SLACK_POLL_BUSY_GRACE_MS,
  slackPollDue,
  slackPollWaitMs,
  type SlackPollCadence,
  type SlackReviewerPollKind,
  type SlackReviewerPollStatus,
  type SlackReviewerPolling,
} from "@locus/shared";
import { completeOneShot, oneShotCliPrompt } from "@locus/providers";
import type { JsonStore } from "../core/store.js";
import { ReviewQuotaReader } from "./reviewQuota.js";
import { ForgeClient } from "../git/forge.js";
import type { PostReviewInput } from "../git/forgeAdapter.js";
import { withFreshForgeToken } from "../git/forgeOauth.js";
import {
  loadSlackReviewTrace,
  saveSlackReviewTrace,
  SlackReviewTraceRecorder,
} from "./reviewTrace.js";
import {
  cloneReviewCheckout,
  sweepReviewCheckouts,
  type ReviewCheckout,
} from "./reviewCheckout.js";
import { ReviewSandboxError, reviewCliSpawner } from "./reviewSandbox.js";
import { cliSandboxEnv } from "@locus/shared/cliSandbox";
import type {
  SlackReviewerForge,
  SlackReviewerComplete,
  SlackReviewerContext,
  SlackReviewerDeps,
} from "./reviewerDeps.js";
import {
  type ReviewerState,
  type ThreadEntry,
  type QueuedJob,
  type StateFile,
  type ReviewJob,
  type AnswerJob,
  MAX_FEEDBACK_PER_REVIEWER,
  MAX_RECENT_RUNS,
  MAX_REVIEWED_PER_REVIEWER,
  QUEUE_REPLAY_MAX_AGE_MS,
  SKIP_THREAD_KEY,
  THREAD_WATCH_MS,
  readReviewerStateFile,
  writeReviewerStateFile,
  reviewerStateFor,
  recordReviewerStats,
  legacyReviewedSha,
  slackReviewRounds,
  autoReviewPostTs,
} from "./reviewerState.js";
import { runReviewModel, verifyReviewFindings } from "./reviewModel.js";
import {
  addUsage,
  guidelinesFromCheckout,
  verifySourcesFromCheckout,
  forgePostsInlineComments,
  suggestionStyle,
  isFinishedPullState,
  isReviewablePost,
  canonicalPullUrl,
  pickReviewProvider,
  postReviewWithFallback,
  errorText,
  modelCallFailure,
  withThread,
  type ReviewLane,
  pumpReviewLane,
  readCiLogs,
  readLinkedIssues,
  guidelinesFromForge,
} from "./reviewerHelpers.js";
import {
  scanThreads,
  dismissFromForge,
  watchThread,
  watchSkippedThread,
} from "./reviewerThreads.js";
import { pollAutoReview } from "./reviewerAutoReview.js";
import { scanMentions, type MentionPoke } from "./reviewerMentions.js";
import { ReviewerApiLog } from "./reviewerApiLog.js";
import { answerQuestion } from "./reviewerAnswer.js";

export type {
  SlackReviewerComplete,
  SlackReviewerDeps,
  SlackReviewerForge,
  SlackReviewerSlack,
} from "./reviewerDeps.js";
export {
  isHumanReply,
  isRereviewReply,
  isReviewablePost,
  pickReviewProvider,
  pickVerifyProvider,
} from "./reviewerHelpers.js";

/** How often the timer looks for due reads; each read has its own interval (Settings → Polling). */
const TICK_MS = 5_000;
/** Status lines this process posted, so a reviewer never answers itself. */
const MAX_OWN_POSTS = 500;
const DEFAULT_RETRY_DELAY_MS = 30_000;
/** First wait after Slack says "ratelimited"; doubles up to `RATE_LIMIT_BACKOFF_MAX_MS`. */
const RATE_LIMIT_BACKOFF_MS = 60_000;
const RATE_LIMIT_BACKOFF_MAX_MS = 10 * 60_000;
/** While Socket Mode delivers message events, polling is only the slow fallback. */
const EVENTS_FRESH_MS = 15 * 60_000;
const EVENT_FALLBACK_CHANNEL_POLL_MS = 5 * 60_000;
const EVENT_FALLBACK_THREAD_POLL_MS = 10 * 60_000;

/**
 * Polls each enabled `config.slackReviewers` channel, detects PR links with a regex, and reviews
 * each PR. Each reviewer has its own queue and runs `maxConcurrentReviews` reviews at a time (one
 * by default, never two of the same PR), so a burst of links in one channel can't fan out into
 * parallel spend or hold up another reviewer's channel. With `autoReview` it also polls its repos'
 * open PRs, and with `reviewOnPrComment` it reads "@locus review" PR comments. State
 * (`<dataDir>/slack-reviewers/state.json`) holds the Slack cursor, the head SHA each PR was
 * reviewed at, dismissed findings, and votes on final messages.
 */
export class SlackReviewerService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;
  private state: StateFile | undefined;
  /** Run slots per reviewer id. */
  private readonly lanes = new Map<string, ReviewLane>();
  /** Every queued or running review and answer, for `idle()`. */
  private readonly tasks = new Set<Promise<void>>();
  /** The run of each pending review, by its `pending` key. */
  private readonly pendingRuns = new Map<string, Promise<void>>();
  /** Last `autoReview` poll per reviewer id. */
  private readonly lastAutoPoll = new Map<string, number>();
  /** Repos each forge account can see (`owner/name`), for `autoReview` globs, by account id. */
  private readonly accountRepos = new Map<string, { at: number; repos: string[] }>();
  /** Jobs queued or running per reviewer id, for the "queued behind N" notice. */
  private readonly inFlight = new Map<string, number>();
  private saving: Promise<void> = Promise.resolve();
  private readonly pending = new Set<string>();
  private readonly ownPosts = new Set<string>();
  private lastThreadPoll = 0;
  private lastChannelPoll = 0;
  /** Per-reviewer polling cadence while Socket Mode is quiet, by `<reviewer id>:<kind>`. */
  private readonly cadence = new Map<string, SlackPollCadence>();
  /** When each reviewer's last review or answer ended, for smart polling. */
  private readonly lastWorkAt = new Map<string, number>();
  private recent: SlackReviewRun[] = [];
  /** Reviews and answers queued or running, for Settings' "In progress" list. */
  private readonly active = new Map<number, SlackReviewActive>();
  private activeSeq = 0;
  /** Traces of runs in progress, so Settings can watch one live. Saved to disk when it ends. */
  private readonly liveTraces = new Map<string, SlackReviewTraceRecorder>();
  private readonly forge: SlackReviewerForge;
  private readonly quota: ReviewQuotaReader;
  private readonly complete: SlackReviewerComplete;
  /** No Slack reads before this time: Slack said "ratelimited". */
  private backoffUntil = 0;
  private backoffMs = 0;
  /** Last time Socket Mode delivered a message event for a watched channel. */
  private lastEventAt = 0;
  /** A message event arrived for a channel: scan it on the next tick. */
  private readonly channelsPoked = new Set<string>();
  /** A message event arrived in a thread (`channel:threadTs`): check it on the next tick. */
  private readonly threadsPoked = new Set<string>();
  /** Thread replies Socket Mode reported since the last tick, by `channel:ts`, for `reviewOnMention`. */
  private readonly mentionsPoked = new Map<string, MentionPoke>();
  /** Replies `reviewOnMention` already read. */
  private readonly mentionsHandled = new Set<string>();
  private unsubscribe: (() => void) | undefined;
  private intervalMs = TICK_MS;
  /** What the thread-watching, auto-review and answer modules reach of this service. */
  private readonly ctx: SlackReviewerContext;
  /** Every Slack and forge call, for Settings → Reviewers → Live logs. */
  private readonly apiLog: ReviewerApiLog;

  constructor(
    private readonly store: JsonStore,
    private readonly deps: SlackReviewerDeps,
  ) {
    this.apiLog = new ReviewerApiLog(() => this.now());
    // Every Slack and forge call goes through the log, wherever in the reviewer it is made.
    this.deps = deps = { ...deps, slack: this.apiLog.wrap("slack", deps.slack) };
    this.forge = this.apiLog.wrap("forge", deps.forge ?? new ForgeClient(deps.fetch ?? fetch));
    const budgets = deps.budgets;
    this.quota = new ReviewQuotaReader({
      readUsage: deps.readProviderUsage,
      budgetStatus: budgets?.status ? (config) => budgets.status!(config) : undefined,
      now: () => this.now(),
    });
    // API providers get one completion; CLI agents run once, read-only, in a scratch folder.
    this.complete =
      deps.complete ??
      async function* (req, opts) {
        // Settings → Advanced → CLI agent sandbox, read per review so a change applies at once.
        const env = deps.cliSandbox?.env
          ? undefined
          : cliSandboxEnv((await store.loadConfig()).advanced.cliSandbox);
        yield* completeOneShot(req, {
          fetchFn: deps.fetch ?? fetch,
          workspace: opts?.workspace,
          // A CLI reads untrusted PR text: keep the server's credentials out of its environment.
          isolateEnv: true,
          // …and run it sandboxed: no home directory beyond its login, no host loopback.
          spawnFor: (workspace) =>
            reviewCliSpawner({
              provider: req.provider,
              workspace,
              locusHome: store.dataDir,
              ...(env ? { env } : {}),
              ...deps.cliSandbox,
            }),
          ...(opts?.onUsage ? { onUsage: opts.onUsage } : {}),
          ...(opts?.onTrace ? { onTrace: opts.onTrace } : {}),
        });
      };
    this.ctx = {
      store,
      deps,
      forge: this.forge,
      now: () => this.now(),
      pending: this.pending,
      ownPosts: this.ownPosts,
      lastAutoPoll: this.lastAutoPoll,
      accountRepos: this.accountRepos,
      enqueue: (job) => this.enqueue(job),
      enqueueAnswer: (job) => this.enqueueAnswer(job),
      say: (job, template, vars, prefix) => this.say(job, template, vars, prefix),
      postText: (job, text) => this.postText(job, text),
      postToChannel: (reviewer, text) => this.postToChannel(reviewer, text),
      readPull: (pr) => this.readPull(pr),
      complete: this.complete,
      forgeAccount: (config, pr) => this.forgeAccount(config, pr),
      loadState: () => this.loadState(),
      noteSlackError: (err) => this.noteSlackError(err),
    };
  }

  start(intervalMs = TICK_MS): void {
    if (this.timer) return;
    this.intervalMs = intervalMs;
    // Nothing is reviewing yet in this process: any clone on disk is left over from the last run.
    void sweepReviewCheckouts(this.checkoutsDir, { maxAgeMs: 0 }).catch(() => undefined);
    void this.restore().catch(() => undefined);
    this.unsubscribe = this.deps.slack.onChannelMessage?.((event) => this.onMessageEvent(event));
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /**
   * After a restart: put back the runs Recent reviews showed, and queue again the reviews that
   * were waiting or running when the process stopped (their Slack cursor had already moved on).
   */
  async restore(): Promise<number> {
    const state = await this.loadState();
    if (state.runs?.length && !this.recent.length)
      this.recent = state.runs.slice(0, MAX_RECENT_RUNS);
    const queued = state.queue ?? [];
    state.queue = [];
    if (!queued.length) return 0;
    const config = await this.store.loadConfig();
    let replayed = 0;
    for (const row of queued) {
      if (this.now() - Date.parse(row.at) > QUEUE_REPLAY_MAX_AGE_MS) continue;
      const reviewer = activeSlackReviewers(config.slackReviewers).find(
        (item) => item.id === row.reviewerId && item.channelId === row.channelId,
      );
      const pr = parsePullUrl(row.url);
      if (!reviewer || !pr) continue;
      void this.enqueue({
        reviewer,
        pr,
        url: row.url,
        channelId: row.channelId,
        messageTs: row.messageTs,
        ...(row.requestTs ? { requestTs: row.requestTs } : {}),
        ...(row.rereview ? { rereview: true } : {}),
        ...(row.retry ? { retry: true } : {}),
        ...(row.fullRereview ? { fullRereview: true } : {}),
        ...(row.force ? { force: true } : {}),
      });
      replayed++;
    }
    await this.saveState().catch(() => undefined);
    return replayed;
  }

  /** Socket Mode saw a message: look at that channel or thread now instead of at the next poll. */
  private onMessageEvent(event: {
    channelId: string;
    ts: string;
    threadTs?: string;
    text?: string;
  }): void {
    this.lastEventAt = this.now();
    if (event.threadTs && event.threadTs !== event.ts) {
      this.threadsPoked.add(`${event.channelId}:${event.threadTs}`);
      // `message` and `app_mention` both arrive for a tagged reply; keep one, preferring text.
      const key = `${event.channelId}:${event.ts}`;
      if (!this.mentionsPoked.get(key)?.text) {
        this.mentionsPoked.set(key, {
          channelId: event.channelId,
          threadTs: event.threadTs,
          ts: event.ts,
          ...(event.text !== undefined ? { text: event.text } : {}),
        });
      }
    } else {
      this.channelsPoked.add(event.channelId);
    }
    void this.tick();
  }

  /** Whether Socket Mode has delivered message events lately, so polling can slow down. */
  private eventsLive(): boolean {
    return this.lastEventAt > 0 && this.now() - this.lastEventAt < EVENTS_FRESH_MS;
  }

  /** Slack said "ratelimited": stop reading for a while, longer each time it repeats. */
  private noteSlackError(err: unknown): boolean {
    if (!/ratelimit|rate limit|\b429\b/i.test(errorText(err))) return false;
    this.backoffMs = Math.min(
      RATE_LIMIT_BACKOFF_MAX_MS,
      this.backoffMs ? this.backoffMs * 2 : RATE_LIMIT_BACKOFF_MS,
    );
    this.backoffUntil = this.now() + this.backoffMs;
    return true;
  }

  /** Resolves when every queued review has finished, including ones queued while waiting. */
  async idle(): Promise<void> {
    while (this.tasks.size) await Promise.all([...this.tasks]);
  }

  /** Slack and forge calls with `seq` above `after`, oldest first, for Live logs. */
  apiLogs(after = 0): SlackReviewerApiLogResponse {
    return this.apiLog.list(after);
  }

  recentRuns(): SlackReviewRun[] {
    return [...this.recent];
  }

  /** Reviews and answers queued or running now, oldest first. */
  activeRuns(): SlackReviewActive[] {
    return [...this.active.values()].map((row) => ({ ...row }));
  }

  /**
   * Recent runs with the current 👍 / 👎 on their final message, per-reviewer totals, what is
   * queued or running, and the review chats still watched.
   */
  async runsWithFeedback(): Promise<
    SlackReviewRunsResponse & { feedback: Record<string, SlackReviewerFeedback> }
  > {
    const state = await this.loadState();
    if (!this.recent.length && state.runs?.length)
      this.recent = state.runs.slice(0, MAX_RECENT_RUNS);
    const runs = this.recent.map((run) => {
      const entry = run.resultTs
        ? state.reviewers[run.reviewerId]?.feedback?.[run.resultTs]
        : undefined;
      return entry ? { ...run, votes: { up: entry.up, down: entry.down } } : { ...run };
    });
    const feedback: Record<string, SlackReviewerFeedback> = {};
    for (const [id, rs] of Object.entries(state.reviewers)) {
      const rows = Object.values(rs.feedback ?? {});
      if (!rows.length) continue;
      feedback[id] = {
        up: rows.reduce((sum, row) => sum + row.up, 0),
        down: rows.reduce((sum, row) => sum + row.down, 0),
        reviews: rows.length,
      };
    }
    const cutoff = this.now() - THREAD_WATCH_MS;
    const threads: SlackReviewThread[] = [];
    for (const [id, rs] of Object.entries(state.reviewers)) {
      if (!rs.channelId) continue;
      for (const [key, thread] of Object.entries(rs.threads ?? {})) {
        if (Date.parse(thread.at) < cutoff) continue;
        const pr = parsePullUrl(thread.url);
        threads.push({
          reviewerId: id,
          pr: pr ? slackReviewPullLabel(pr) : key,
          url: thread.url,
          channelId: rs.channelId,
          threadTs: thread.ts,
          at: thread.at,
          ...(thread.answers ? { answers: thread.answers } : {}),
        });
      }
    }
    threads.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const stats: Record<string, SlackReviewerStats> = {};
    for (const [id, rs] of Object.entries(state.reviewers)) {
      if (rs.stats?.length) {
        stats[id] = summarizeSlackReviewStats(rs.stats, {
          days: SLACK_REVIEW_STATS_DEFAULT_DAYS,
          now: this.now(),
        });
      }
    }
    const polling = await this.pollStatus().catch(() => undefined);
    return {
      runs,
      feedback,
      active: this.activeRuns(),
      threads,
      stats,
      ...(polling ? { polling } : {}),
    };
  }

  /** A reviewer's accuracy over the last `days` days (1–90), from its daily ledger. */
  async reviewerStats(
    reviewerId: string,
    days = SLACK_REVIEW_STATS_DEFAULT_DAYS,
  ): Promise<SlackReviewerStats> {
    const state = await this.loadState();
    return summarizeSlackReviewStats(state.reviewers[reviewerId]?.stats, { days, now: this.now() });
  }

  /** Add to today's bucket of a reviewer's accuracy ledger (the caller saves). */
  private recordStats(rs: ReviewerState, delta: SlackReviewStatsDelta): void {
    recordReviewerStats(rs, delta, this.now());
  }

  /** Count a finished run (review, failure or answer) in its reviewer's ledger. */
  private recordRunStats(state: StateFile, run: SlackReviewRun): void {
    const rs = state.reviewers[run.reviewerId];
    const delta = rs ? slackReviewStatsFromRun(run) : undefined;
    if (rs && delta) this.recordStats(rs, delta);
  }

  /** Findings a reviewer remembers as dismissed, per repo, for Settings. */
  async repoNotes(reviewerId: string): Promise<Record<string, SlackRepoNote[]>> {
    const state = await this.loadState();
    return structuredClone(state.reviewers[reviewerId]?.repoNotes ?? {});
  }

  /**
   * Forget remembered dismissals: one note (`index` into that repo's list), a whole repo, or all
   * of a reviewer's. Returns how many were removed.
   */
  async forgetRepoNotes(reviewerId: string, repo?: string, index?: number): Promise<number> {
    const state = await this.loadState();
    const notes = state.reviewers[reviewerId]?.repoNotes;
    if (!notes) return 0;
    let removed = 0;
    if (repo === undefined) {
      removed = Object.values(notes).reduce((sum, rows) => sum + rows.length, 0);
      delete state.reviewers[reviewerId]!.repoNotes;
    } else if (index === undefined) {
      removed = notes[repo]?.length ?? 0;
      delete notes[repo];
    } else if (notes[repo]?.[index]) {
      notes[repo]!.splice(index, 1);
      if (!notes[repo]!.length) delete notes[repo];
      removed = 1;
    }
    if (removed) await this.saveState();
    return removed;
  }

  /**
   * Open a PR that adds a repo's remembered dismissals to its `REVIEW.md` as conventions: read the
   * file on the default branch, append the section, commit it on a new branch, open the PR. The
   * notes are kept; once the PR merges, the reviewer reads them from REVIEW.md anyway. GitHub and
   * GitLab only.
   */
  async proposeRepoNotes(
    reviewerId: string,
    repo: string,
  ): Promise<{ url: string; number: number; branch: string; notes: number }> {
    const state = await this.loadState();
    const notes = state.reviewers[reviewerId]?.repoNotes?.[repo];
    if (!notes?.length) throw new Error(`No remembered dismissals for ${repo}`);
    const target = parseSlackRepoNotesKey(repo);
    if (!target) throw new Error(`Not a repo: ${repo}`);
    const config = await this.store.loadConfig();
    const account = await this.forgeAccount(config, target);
    const { listBranches, createPull, commitFileToNewBranch, readFile } = this.forge;
    if (
      !slackReviewProposeSupported(account.kind) ||
      !listBranches ||
      !createPull ||
      !commitFileToNewBranch ||
      !readFile
    ) {
      throw new Error(
        `Proposing REVIEW.md is not supported on this forge (${account.kind}). GitHub and GitLab only.`,
      );
    }
    const forge = this.forge as Required<SlackReviewerForge>;
    const { owner, repo: name } = target;
    const branches = await forge.listBranches(account, owner, name);
    const base = branches.defaultBranch;
    if (!base) throw new Error(`Couldn't find the default branch of ${owner}/${name}`);
    const existing = await forge.readFile(
      account,
      owner,
      name,
      SLACK_REVIEW_CONVENTIONS_PATH,
      base,
    );
    const content = buildSlackReviewConventions(notes, existing);
    if (existing !== undefined && content.trim() === existing.replace(/\r\n/g, "\n").trim()) {
      throw new Error(`${SLACK_REVIEW_CONVENTIONS_PATH} on ${base} already has these conventions`);
    }
    const branch = slackReviewConventionsBranch(new Date(this.now()), branches.branches);
    await forge.commitFileToNewBranch(account, owner, name, {
      branch,
      base,
      path: SLACK_REVIEW_CONVENTIONS_PATH,
      content,
      message: SLACK_REVIEW_CONVENTIONS_TITLE,
      expectNew: existing === undefined,
    });
    const created = await forge.createPull(account, owner, name, {
      title: SLACK_REVIEW_CONVENTIONS_TITLE,
      body: slackReviewConventionsBody(notes.length, `${owner}/${name}`),
      head: branch,
      base,
    });
    return { url: created.url, number: created.number, branch, notes: notes.length };
  }

  /** Review clones live here, not in the OS temp folder, so a sweep only ever sees its own. */
  private get checkoutsDir(): string {
    return join(this.store.dataDir, "slack-reviewers", "checkouts");
  }

  private get tracesDir(): string {
    return join(this.store.dataDir, "slack-reviewers", "traces");
  }

  /**
   * A run's trace: the model's prompt, reasoning, tool calls with their output, and reply. Live
   * (still growing) while the run is going, from disk after. Undefined when unknown or pruned.
   */
  async trace(id: string): Promise<SlackReviewTrace | undefined> {
    const live = this.liveTraces.get(id);
    if (live) return { ...live.trace, steps: [...live.trace.steps], live: true };
    return loadSlackReviewTrace(this.tracesDir, id);
  }

  /** Start a run's trace and show it on its "In progress" row. */
  private openTrace(
    row: { reviewerId: string; pr: string; kind: "review" | "answer" },
    tracked: { start: (traceId?: string) => void },
  ): SlackReviewTraceRecorder {
    const trace = new SlackReviewTraceRecorder(row, () => this.now());
    this.liveTraces.set(trace.id, trace);
    tracked.start(trace.id);
    return trace;
  }

  /**
   * Save a run's trace and stamp its id on the run. Also called from `finally` with no run, so a
   * run that threw still keeps what was traced. A failed save leaves the run without a trace id.
   */
  private async closeTrace(
    trace: SlackReviewTraceRecorder,
    run?: SlackReviewRun,
  ): Promise<SlackReviewRun | undefined> {
    if (!this.liveTraces.has(trace.id)) return run;
    if (run?.model) trace.setModel(run.model);
    this.liveTraces.delete(trace.id);
    // Skips and failures before the model call have nothing to show: keep the disk for real ones.
    if (!trace.trace.steps.length) return run;
    const saved = await saveSlackReviewTrace(this.tracesDir, trace.finish()).then(
      () => true,
      () => false,
    );
    return run && saved ? { ...run, traceId: trace.id } : run;
  }

  private get statePath(): string {
    return join(this.store.dataDir, "slack-reviewers", "state.json");
  }

  private async loadState(): Promise<StateFile> {
    if (this.state) return this.state;
    this.state = await readReviewerStateFile(this.statePath);
    return this.state;
  }

  /** Saves are chained: a tick and a finishing review may both save, and must not share a temp file mid-write. */
  private saveState(): Promise<void> {
    const run = this.saving.then(async () => {
      if (!this.state) return;
      await writeReviewerStateFile(this.statePath, this.state);
    });
    this.saving = run.catch(() => undefined);
    return run;
  }

  /** One poll of every enabled reviewer. Safe to call concurrently (later calls no-op). */
  async tick(): Promise<void> {
    if (this.ticking) return;
    if (this.now() < this.backoffUntil) return;
    this.ticking = true;
    try {
      const config = await this.store.loadConfig();
      const reviewers = activeSlackReviewers(config.slackReviewers);
      if (!reviewers.length) return;
      const state = await this.loadState();
      let dirty = false;
      let limited = false;
      const live = this.eventsLive();
      const polling = this.polling(config);
      // With events arriving, a channel is read when an event says so, plus a slow sweep in case
      // one was missed. Without them, each reviewer on its own cadence (Settings → Polling).
      const eventSweep =
        live && this.now() - this.lastChannelPoll >= EVENT_FALLBACK_CHANNEL_POLL_MS;
      if (eventSweep) this.lastChannelPoll = this.now();
      const poked = new Set(this.channelsPoked);
      this.channelsPoked.clear();
      for (const reviewer of reviewers) {
        const due = live ? eventSweep : this.pollDue(polling, reviewer, "channel");
        if (!due && !poked.has(reviewer.channelId)) continue;
        const before = reviewerStateFor(state, reviewer).cursor;
        try {
          dirty =
            (await this.apiLog.scope("channel", reviewer.id, () => this.scan(reviewer, state))) ||
            dirty;
        } catch (err) {
          // Slack signed out, channel not allowed, or a network blip: try again next tick.
          if (this.noteSlackError(err)) {
            limited = true;
            break;
          }
        }
        // A new message (not the first look that primes the cursor) means people are around.
        const after = reviewerStateFor(state, reviewer).cursor;
        this.pollRan(polling, reviewer, "channel", before !== undefined && after !== before);
      }
      // Threads are polled less often than the channel: one API call per watched thread.
      const threadSweep = live && this.now() - this.lastThreadPoll >= EVENT_FALLBACK_THREAD_POLL_MS;
      const threadsPoked = new Set(this.threadsPoked);
      this.threadsPoked.clear();
      if (!limited) {
        if (threadSweep) this.lastThreadPoll = this.now();
        for (const reviewer of reviewers) {
          if (!slackReviewerWatchesThreads(reviewer)) continue;
          const sweep = live ? threadSweep : this.pollDue(polling, reviewer, "threads");
          if (!sweep && !threadsPoked.size) continue;
          const before = threadFingerprint(state.reviewers[reviewer.id] ?? {});
          try {
            dirty =
              (await this.apiLog.scope("threads", reviewer.id, () =>
                scanThreads(this.ctx, reviewer, state, config, sweep ? undefined : threadsPoked),
              )) || dirty;
          } catch (err) {
            // Slack signed out or a blip: try again next poll.
            if (this.noteSlackError(err)) {
              limited = true;
              break;
            }
          }
          if (sweep && !live) {
            const after = threadFingerprint(state.reviewers[reviewer.id] ?? {});
            this.pollRan(polling, reviewer, "threads", after !== before);
          }
        }
      }
      const mentions = [...this.mentionsPoked.values()];
      this.mentionsPoked.clear();
      if (!limited && mentions.length) {
        for (const reviewer of reviewers) {
          try {
            // A tagged reply is a thread read: logged with the thread poll.
            await this.apiLog.scope("threads", reviewer.id, () =>
              scanMentions(this.ctx, reviewer, state, config, mentions, this.mentionsHandled),
            );
          } catch (err) {
            if (this.noteSlackError(err)) {
              limited = true;
              break;
            }
          }
        }
      }
      if (!limited) {
        for (const reviewer of reviewers) {
          // Forge polling doesn't get Socket Mode events: it always follows Settings → Polling.
          const pollMs = this.pollWait(polling, reviewer, "autoReview");
          const lastBefore = this.lastAutoPoll.get(reviewer.id);
          const before = autoReviewFingerprint(state.reviewers[reviewer.id] ?? {});
          // Forge errors are per repo inside; anything else waits for the next poll.
          dirty =
            (await this.apiLog
              .scope("autoReview", reviewer.id, () =>
                pollAutoReview(this.ctx, reviewer, state, config, pollMs),
              )
              .catch(() => false)) || dirty;
          if (this.lastAutoPoll.get(reviewer.id) !== lastBefore) {
            const after = autoReviewFingerprint(state.reviewers[reviewer.id] ?? {});
            this.pollRan(polling, reviewer, "autoReview", after !== before);
          }
        }
      }
      if (!limited) this.backoffMs = 0;
      if (dirty) await this.saveState().catch(() => undefined);
    } finally {
      this.ticking = false;
    }
  }

  /** Settings → Polling, with defaults. */
  private polling(config: LocusConfig): SlackReviewerPolling {
    return config.slackReviewerPolling ?? parseSlackReviewerPolling(undefined);
  }

  /** Test overrides for the base interval of each read. */
  private pollOverride(kind: SlackReviewerPollKind): number | undefined {
    if (kind === "channel") return this.deps.channelPollMs;
    if (kind === "threads") return this.deps.threadPollMs;
    return this.deps.autoReviewPollMs;
  }

  /** Smart polling: a review or answer queued, running, or ended a few minutes ago. */
  private reviewerBusy(reviewerId: string): boolean {
    if ((this.inFlight.get(reviewerId) ?? 0) > 0) return true;
    const ended = this.lastWorkAt.get(reviewerId);
    return ended !== undefined && this.now() - ended < SLACK_POLL_BUSY_GRACE_MS;
  }

  private pollSignals(reviewer: SlackReviewer, kind: SlackReviewerPollKind) {
    const override = this.pollOverride(kind);
    return {
      now: this.now(),
      busy: this.reviewerBusy(reviewer.id),
      ...(override !== undefined ? { overrideMs: override } : {}),
    };
  }

  private pollDue(
    polling: SlackReviewerPolling,
    reviewer: SlackReviewer,
    kind: SlackReviewerPollKind,
  ): boolean {
    const cadence = this.cadence.get(`${reviewer.id}:${kind}`);
    return slackPollDue(polling, kind, cadence, this.pollSignals(reviewer, kind));
  }

  private pollWait(
    polling: SlackReviewerPolling,
    reviewer: SlackReviewer,
    kind: SlackReviewerPollKind,
  ): number {
    const cadence = this.cadence.get(`${reviewer.id}:${kind}`);
    return slackPollWaitMs(polling, kind, cadence, this.pollSignals(reviewer, kind));
  }

  /** A read ran: speed up if it found something, else let adaptive and smart modes slow down. */
  private pollRan(
    polling: SlackReviewerPolling,
    reviewer: SlackReviewer,
    kind: SlackReviewerPollKind,
    activity: boolean,
  ): void {
    const key = `${reviewer.id}:${kind}`;
    this.cadence.set(
      key,
      nextSlackPollCadence(polling, kind, this.cadence.get(key), {
        ...this.pollSignals(reviewer, kind),
        activity,
      }),
    );
  }

  /** What each enabled reviewer polls at now, for Settings → Reviewers → Polling. */
  async pollStatus(): Promise<Record<string, SlackReviewerPollStatus>> {
    const config = await this.store.loadConfig();
    const polling = this.polling(config);
    const live = this.eventsLive();
    const quiet =
      polling.mode === "smart" &&
      !inSlackReviewerActiveHours(polling.activeHours, new Date(this.now()));
    const out: Record<string, SlackReviewerPollStatus> = {};
    for (const reviewer of activeSlackReviewers(config.slackReviewers)) {
      const busy = polling.mode === "smart" && this.reviewerBusy(reviewer.id);
      const offHours =
        quiet && !busy && Boolean(this.cadence.get(`${reviewer.id}:channel`)?.offHours);
      out[reviewer.id] = {
        events: live,
        channelMs: live
          ? EVENT_FALLBACK_CHANNEL_POLL_MS
          : this.pollWait(polling, reviewer, "channel"),
        ...(slackReviewerWatchesThreads(reviewer)
          ? {
              threadsMs: live
                ? EVENT_FALLBACK_THREAD_POLL_MS
                : this.pollWait(polling, reviewer, "threads"),
            }
          : {}),
        ...(reviewer.autoReview && reviewer.repos.length
          ? { autoReviewMs: this.pollWait(polling, reviewer, "autoReview") }
          : {}),
        ...(busy ? { busy: true } : {}),
        ...(offHours ? { offHours: true } : {}),
      };
    }
    return out;
  }

  private async scan(reviewer: SlackReviewer, state: StateFile): Promise<boolean> {
    const rs = reviewerStateFor(state, reviewer);
    const rows = await this.deps.slack.peekHistory(reviewer.channelId, {
      ...(rs.cursor ? { oldest: rs.cursor } : {}),
    });
    const newest = rows.at(-1)?.ts;
    if (!rs.cursor) {
      // First look: prime the cursor. Reviewing the channel's backlog would be a surprise bill.
      rs.cursor = newest ?? String(this.now() / 1000);
      return true;
    }
    if (!newest) return false;
    const autoPosts = autoReviewPostTs(rs);
    for (const message of rows) {
      if (Number(message.ts) <= Number(rs.cursor)) continue;
      if (!isReviewablePost(message)) continue;
      // The reviewer's own "New PR" post: its review is already queued.
      if (this.ownPosts.has(message.ts) || autoPosts.has(message.ts)) continue;
      // Only listed people may ask for a review; others are ignored without a reply.
      if (!slackReviewerRequesterAllowed(reviewer, message.userId)) continue;
      // Already marked merged or declined (e.g. reposted with the reaction stack): leave it.
      if (reviewer.reactions && slackPostStopped(reviewer.reactionMap, message.reactions)) continue;
      for (const pr of extractPullUrls(message.text)) {
        // Saved in the queue before the cursor moves past the post, so a restart can't lose it.
        void this.enqueue({
          reviewer,
          pr,
          url: canonicalPullUrl(pr, message.text),
          channelId: reviewer.channelId,
          messageTs: message.ts,
        });
      }
    }
    rs.cursor = newest;
    return true;
  }

  /** The PR, or undefined when it can't be read (keep watching and try again later). */
  private async readPull(
    pr: ParsedPullUrl,
  ): Promise<Awaited<ReturnType<SlackReviewerForge["getPull"]>> | undefined> {
    try {
      const config = await this.store.loadConfig();
      const account = await this.forgeAccount(config, pr);
      return await this.forge.getPull(account, pr.owner, pr.repo, pr.number);
    } catch {
      return undefined;
    }
  }

  private async forgeAccount(
    config: LocusConfig,
    pr: Pick<ParsedPullUrl, "host" | "repoUrl">,
  ): Promise<GitForgeAccount> {
    const resolved = resolveForgeAccount(config.forges, { url: pr.repoUrl });
    if (!resolved) throw new Error(`no forge account for ${pr.host}`);
    return this.deps.freshForgeToken
      ? await this.deps.freshForgeToken(resolved)
      : await withFreshForgeToken(this.store, resolved, this.deps.fetch ?? fetch);
  }

  /**
   * Review one PR now (Settings "Try it", HTTP route). Replies go to `threadTs` when given. A dry
   * run posts nothing to the PR or Slack, records nothing, and reviews even an already-reviewed
   * commit; the run carries the findings. `fullRereview` reviews the full PR diff in a live run.
   */
  async reviewNow(
    reviewerId: string,
    url: string,
    threadTs?: string,
    opts: { dryRun?: boolean; fullRereview?: boolean } = {},
  ): Promise<SlackReviewRun> {
    const config = await this.store.loadConfig();
    const reviewer = (config.slackReviewers ?? []).find((row) => row.id === reviewerId);
    if (!reviewer) throw new Error(`No Slack reviewer ${reviewerId}`);
    if (threadTs && !reviewer.channelId && !opts.dryRun)
      throw new Error("Pick a Slack channel for this reviewer first");
    const pr = parsePullUrl(url);
    if (!pr) throw new Error("Not a pull request URL");
    let run: SlackReviewRun | undefined;
    await this.enqueue(
      opts.dryRun
        ? { reviewer, pr, url, channelId: reviewer.channelId, dryRun: true }
        : {
            reviewer,
            pr,
            url,
            channelId: reviewer.channelId,
            messageTs: threadTs,
            fullRereview: opts.fullRereview,
          },
      (result) => {
        run = result;
      },
    );
    if (!run) throw new Error("Review is already queued for this pull request");
    return run;
  }

  /**
   * Run `task` once one of the reviewer's `limit` slots is free and nothing else for the same `key`
   * (a PR) is running. Waiting tasks start in order, but one whose PR is busy lets later ones
   * pass. Returns when it is done.
   */
  private chain(
    slot: { reviewerId: string; key?: string; limit?: number },
    task: () => Promise<void>,
  ): Promise<void> {
    const { reviewerId, key, limit = 1 } = slot;
    this.inFlight.set(reviewerId, (this.inFlight.get(reviewerId) ?? 0) + 1);
    let lane = this.lanes.get(reviewerId);
    if (!lane) {
      lane = { limit, running: 0, busy: new Set(), waiting: [] };
      this.lanes.set(reviewerId, lane);
    }
    const slots = lane;
    slots.limit = Math.max(1, limit);
    const next: Promise<void> = new Promise<void>((resolve) => {
      slots.waiting.push({ key, start: resolve });
      pumpReviewLane(slots);
    })
      // A job queued from inside a poll is still the review's own work in Live logs.
      .then(() => this.apiLog.scope("review", reviewerId, task))
      .catch(() => undefined)
      .finally(() => {
        slots.running -= 1;
        if (key) slots.busy.delete(key);
        const left = (this.inFlight.get(reviewerId) ?? 1) - 1;
        if (left > 0) this.inFlight.set(reviewerId, left);
        else this.inFlight.delete(reviewerId);
        this.lastWorkAt.set(reviewerId, this.now());
        this.tasks.delete(next);
        pumpReviewLane(slots);
        if (!slots.running && !slots.waiting.length && this.lanes.get(reviewerId) === slots)
          this.lanes.delete(reviewerId);
      });
    this.tasks.add(next);
    return next;
  }

  /** Whether a new run for PR `key` would have to wait for a slot or for that PR. */
  private wouldWait(reviewerId: string, key: string, limit: number): boolean {
    const lane = this.lanes.get(reviewerId);
    if (!lane) return false;
    return (
      lane.running + lane.waiting.length >= Math.max(1, limit) ||
      lane.busy.has(key) ||
      lane.waiting.some((row) => row.key === key)
    );
  }

  /** Track a queued job for the "In progress" list. Returns start and finish callbacks. */
  private track(row: Omit<SlackReviewActive, "status" | "since">): {
    start: (traceId?: string) => void;
    finish: () => void;
  } {
    const id = ++this.activeSeq;
    this.active.set(id, { ...row, status: "queued", since: new Date(this.now()).toISOString() });
    return {
      start: (traceId?: string) => {
        const entry = this.active.get(id);
        if (entry) {
          entry.status = "running";
          if (traceId) entry.traceId = traceId;
        }
      },
      finish: () => {
        this.active.delete(id);
      },
    };
  }

  private enqueue(job: ReviewJob, done?: (run: SlackReviewRun) => void): Promise<void> {
    const key = `${job.reviewer.id}:${slackReviewPullKey(job.pr)}${job.dryRun ? ":dry" : ""}`;
    if (this.pending.has(key)) return this.pendingRuns.get(key) ?? Promise.resolve();
    const prKey = slackReviewPullKey(job.pr);
    const limit = job.reviewer.maxConcurrentReviews;
    this.pending.add(key);
    const tracked = this.track({
      reviewerId: job.reviewer.id,
      pr: slackReviewPullLabel(job.pr),
      url: job.url,
      kind: "review",
      ...(job.messageTs && !job.dryRun
        ? { channelId: job.channelId, threadTs: job.messageTs }
        : {}),
      ...(job.dryRun ? { dryRun: true } : {}),
    });
    const saved = this.saveQueued(job);
    const ahead = this.inFlight.get(job.reviewer.id) ?? 0;
    const waits = ahead > 0 && this.wouldWait(job.reviewer.id, prKey, limit);
    if (waits && job.messageTs && !job.dryRun) {
      void this.say(job, "queued", {
        ahead: reviewPlural(ahead, "review"),
        sha: undefined,
      });
    }
    const run = this.chain({ reviewerId: job.reviewer.id, key: prKey, limit }, async () => {
      const trace = this.openTrace(
        { reviewerId: job.reviewer.id, pr: slackReviewPullLabel(job.pr), kind: "review" },
        tracked,
      );
      try {
        const wasSaved = await saved;
        const reviewed = await this.reviewWithRetry(job, trace);
        const run = withThread(
          (await this.closeTrace(trace, reviewed)) ?? reviewed,
          job.channelId,
          job.messageTs,
        );
        await this.remember(run, wasSaved ? job : undefined);
        done?.(run);
      } finally {
        await this.closeTrace(trace);
        this.pending.delete(key);
        this.pendingRuns.delete(key);
        tracked.finish();
      }
    });
    this.pendingRuns.set(key, run);
    return run;
  }

  /**
   * Save a channel or thread review in the state's queue before it runs, so a restart replays it.
   * Dry runs and HTTP runs with no thread aren't saved. Resolves to whether it was saved.
   */
  private async saveQueued(job: ReviewJob): Promise<boolean> {
    if (job.dryRun || !job.messageTs) return false;
    const state = await this.loadState();
    const queue = (state.queue ??= []);
    const same = (row: QueuedJob) =>
      row.reviewerId === job.reviewer.id && row.url === job.url && row.messageTs === job.messageTs;
    if (!queue.some(same)) {
      queue.push({
        reviewerId: job.reviewer.id,
        url: job.url,
        channelId: job.channelId,
        messageTs: job.messageTs,
        ...(job.requestTs ? { requestTs: job.requestTs } : {}),
        ...(job.rereview ? { rereview: true } : {}),
        ...(job.retry ? { retry: true } : {}),
        ...(job.fullRereview ? { fullRereview: true } : {}),
        ...(job.force ? { force: true } : {}),
        at: new Date(this.now()).toISOString(),
      });
    }
    await this.saveState().catch(() => undefined);
    return true;
  }

  /**
   * Run a review, and once more after `retryDelayMs` when it failed on an error that usually
   * passes (rate limit, overload, timeout, dropped connection). The thread hears about the retry.
   */
  private async reviewWithRetry(
    job: ReviewJob,
    trace?: SlackReviewTraceRecorder,
  ): Promise<SlackReviewRun> {
    const first = await this.review(job, trace);
    if (first.outcome !== "failed" || job.dryRun || !first.reason || !first.retryable) {
      return first;
    }
    const delay = this.deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    await this.postText(
      job,
      `:repeat: That looked temporary. Trying ${slackReviewPullLabel(job.pr)} once more in ${Math.round(delay / 1000)}s.`,
    );
    await (this.deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(delay);
    trace?.note(`Retrying after a temporary failure: ${first.reason}`);
    const second = await this.review({ ...job, retry: true }, trace);
    if (second.outcome === "failed") {
      await this.postText(job, `Reply *retry* in this thread to try again later.`);
    }
    return second;
  }

  private enqueueAnswer(job: AnswerJob): void {
    const tracked = this.track({
      reviewerId: job.reviewer.id,
      pr: slackReviewPullLabel(job.pr),
      url: job.url,
      kind: "answer",
      channelId: job.channelId,
      threadTs: job.threadTs,
    });
    const slot = {
      reviewerId: job.reviewer.id,
      key: slackReviewPullKey(job.pr),
      limit: job.reviewer.maxConcurrentReviews,
    };
    void this.chain(slot, async () => {
      const trace = this.openTrace(
        { reviewerId: job.reviewer.id, pr: slackReviewPullLabel(job.pr), kind: "answer" },
        tracked,
      );
      try {
        const answered = await answerQuestion(this.ctx, job, trace);
        const run = (await this.closeTrace(trace, answered)) ?? answered;
        await this.remember(withThread(run, job.channelId, job.threadTs));
      } finally {
        await this.closeTrace(trace);
        tracked.finish();
      }
    });
  }

  /** A top-level post in the reviewer's channel as its `postAs` identity. Returns its ts. */
  private async postToChannel(reviewer: SlackReviewer, text: string): Promise<string | undefined> {
    try {
      const posted = await this.deps.slack.post(
        reviewer.channelId,
        text,
        undefined,
        undefined,
        reviewer.postAs,
      );
      if (!posted?.ts) return undefined;
      this.ownPosts.add(posted.ts);
      if (this.ownPosts.size > MAX_OWN_POSTS) {
        this.ownPosts.delete(this.ownPosts.values().next().value!);
      }
      return posted.ts;
    } catch {
      return undefined;
    }
  }

  /** Keep a run for Recent reviews (saved, so it survives a restart) and drop its queue entry. */
  private async remember(run: SlackReviewRun, job?: ReviewJob): Promise<void> {
    const { retryable: _drop, ...row } = run;
    this.recent.unshift(row);
    this.recent.length = Math.min(this.recent.length, MAX_RECENT_RUNS);
    if (run.dryRun && !job) return;
    const state = await this.loadState();
    this.recordRunStats(state, run);
    state.runs = this.recent.filter((item) => !item.dryRun);
    if (job && state.queue) {
      state.queue = state.queue.filter(
        (item) =>
          !(
            item.reviewerId === job.reviewer.id &&
            item.url === job.url &&
            item.messageTs === job.messageTs
          ),
      );
    }
    await this.saveState().catch(() => undefined);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * A large PR reviewed in parts: post what one part found as soon as it finishes, so the thread
   * shows every part, not only the merged result at the end. A reply that doesn't parse is left
   * to the merged result to report.
   */
  private async sayPartDone(
    job: ReviewJob,
    index: number,
    parts: CompactDiff[],
    text: string,
    settle: (text: string, shown: CompactDiff) => { findings: unknown[]; summary: string },
  ): Promise<void> {
    let settled: { findings: unknown[]; summary: string };
    try {
      settled = settle(text, parts[index]!);
    } catch {
      return;
    }
    const shown = parts[index]!;
    await this.say(job, "partDone", {
      part: `${index + 1} of ${parts.length}`,
      files:
        reviewPlural(shown.reviewed.length, "file") +
        (shown.truncated.length ? ` (${shown.truncated.length} truncated)` : ""),
      comments: reviewPlural(settled.findings.length, "comment"),
      summary: slackReviewPartSummary(settled.summary),
    });
  }

  /** Post one status line in the job's thread. Returns the posted message's ts. */
  private async say(
    job: ReviewJob,
    template: keyof SlackReviewerStatusTemplates,
    vars: Record<string, string | number | undefined>,
    prefix = "",
  ): Promise<string | undefined> {
    if (!job.messageTs || job.dryRun) return undefined;
    const source = job.reviewer.status[template];
    let text = renderSlackReviewerStatus(
      source,
      { url: job.url, label: slackReviewPullLabel(job.pr) },
      vars,
    );
    // A failure line has no usage line of its own: the provider's usage goes under it.
    const quota = typeof vars.providerUsage === "string" ? vars.providerUsage.trim() : "";
    if (
      template === "failed" &&
      quota &&
      !source.includes("{providerUsage}") &&
      !source.includes("{usage}")
    ) {
      text += `\n_${quota}_`;
    }
    return this.postText(job, `${prefix}${text}`);
  }

  private async postText(job: ReviewJob, text: string): Promise<string | undefined> {
    if (!job.messageTs || job.dryRun) return undefined;
    try {
      const posted = await this.deps.slack.post(
        job.channelId,
        text,
        job.messageTs,
        undefined,
        job.reviewer.postAs,
      );
      if (posted?.ts) {
        this.ownPosts.add(posted.ts);
        if (this.ownPosts.size > MAX_OWN_POSTS) {
          this.ownPosts.delete(this.ownPosts.values().next().value!);
        }
      }
      return posted?.ts;
    } catch {
      // A failed status line must not abort or repeat the review.
      return undefined;
    }
  }

  private async react(job: ReviewJob, name: string, remove = false): Promise<void> {
    if (!job.reviewer.reactions || !job.messageTs || job.dryRun) return;
    try {
      await this.deps.slack.react(job.channelId, job.messageTs, name, { remove });
    } catch {
      /* already reacted / missing scope */
    }
  }

  /** Take the "reviewing now" reaction (👀 in the classic set) off the post. */
  private async unreactWorking(job: ReviewJob): Promise<void> {
    const name = job.reviewer.reactionMap.working;
    if (name) await this.react(job, name, true);
  }

  private async review(job: ReviewJob, trace?: SlackReviewTraceRecorder): Promise<SlackReviewRun> {
    const { reviewer, pr } = job;
    const label = slackReviewPullLabel(pr);
    const base = {
      reviewerId: reviewer.id,
      pr: label,
      url: job.url,
      ...(job.dryRun ? { dryRun: true } : {}),
    };
    const finish = async (
      run: Omit<SlackReviewRun, keyof typeof base | "at">,
      sha?: string,
      result?: { findings: SlackPriorFinding[]; summary: string },
      /** A skip replied in the thread: keep listening there, and whether asking again overrides it. */
      skipReply?: { overridable: boolean },
    ): Promise<SlackReviewRun> => {
      const full: SlackReviewRun = { ...base, ...run, at: new Date(this.now()).toISOString() };
      if (job.dryRun) return full;
      const state = await this.loadState();
      const rs = reviewerStateFor(state, reviewer);
      let dirty = false;
      const key = slackReviewPullKey(pr);
      if (sha && run.outcome !== "failed") {
        const before = rs.reviewed[key];
        // A skip keeps the last findings; a finished review replaces them (none left = clean).
        const kept = result
          ? result.findings.length
            ? { findings: result.findings, findingsSha: sha, summary: result.summary }
            : {}
          : before?.findings?.length
            ? {
                findings: before.findings,
                findingsSha: before.findingsSha ?? before.sha,
                ...(before.summary ? { summary: before.summary } : {}),
              }
            : {};
        const reviewedSha = result ? sha : (before?.reviewedSha ?? legacyReviewedSha(before));
        rs.reviewed[key] = {
          sha,
          at: full.at,
          outcome: run.outcome,
          ...kept,
          ...(reviewedSha ? { reviewedSha } : {}),
          ...(before?.dismissed?.length ? { dismissed: before.dismissed } : {}),
        };
        const rounds = result ? slackReviewRounds(before) + 1 : before?.rounds;
        if (rounds) rs.reviewed[key]!.rounds = rounds;
        const keys = Object.keys(rs.reviewed);
        for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_REVIEWED_PER_REVIEWER))) {
          delete rs.reviewed[stale];
        }
        dirty = true;
      }
      if (full.resultTs) {
        const feedback = (rs.feedback ??= {});
        feedback[full.resultTs] = { pr: label, at: full.at, up: 0, down: 0 };
        const stale = Object.keys(feedback).slice(
          0,
          Math.max(0, Object.keys(feedback).length - MAX_FEEDBACK_PER_REVIEWER),
        );
        for (const row of stale) delete feedback[row];
        dirty = true;
      }
      // Any reply in the thread (even a failure or skip) means the author may answer there.
      if (job.messageTs && slackReviewerWatchesThreads(reviewer)) {
        if (full.outcome !== "skipped") {
          watchThread(rs, job, full.at, full.resultTs);
          dirty = true;
        } else if (skipReply) {
          watchSkippedThread(rs, job, full.at, skipReply.overridable);
          dirty = true;
        }
      }
      if (dirty) await this.saveState().catch(() => undefined);
      if (run.outcome === "failed" && reviewer.reactionMap.failed) {
        await this.react(job, reviewer.reactionMap.failed);
      }
      return full;
    };
    /** `overridable`: "@Locus review again" in the thread reviews anyway (`force`). */
    const skip = async (reason: string, sha?: string, overridable = false) => {
      await this.say(job, "skipped", { reason, sha: sha?.slice(0, 7) });
      return finish({ outcome: "skipped", reason }, sha, undefined, { overridable });
    };

    if (!slackReviewerRepoAllowed(reviewer, pr)) {
      return finish({
        outcome: "skipped",
        reason: `${pr.owner}/${pr.repo} is not in this reviewer's repo list`,
      });
    }

    const config = await this.store.loadConfig();
    const pick = pickReviewProvider(config, reviewer);
    if (!pick) {
      await this.say(job, "failed", {
        reason:
          "no provider can run it. Enable an API provider with a key, or pick a CLI agent for this reviewer",
      });
      return finish({ outcome: "failed", reason: "no provider" });
    }

    let account: GitForgeAccount;
    let pull: Awaited<ReturnType<SlackReviewerForge["getPull"]>>;
    try {
      account = await this.forgeAccount(config, pr);
      pull = await this.forge.getPull(account, pr.owner, pr.repo, pr.number);
    } catch (err) {
      const reason = `couldn't read the PR (${errorText(err)})`;
      await this.say(job, "failed", { reason });
      return finish({ outcome: "failed", reason });
    }

    if (isFinishedPullState(pull.state) && !job.dryRun) {
      // Merged or closed: stop watching its thread now rather than at the next state check.
      const rs = reviewerStateFor(await this.loadState(), reviewer);
      const prKey = slackReviewPullKey(pr);
      for (const key of Object.keys(rs.threads ?? {})) {
        if (key === prKey || key.startsWith(`${prKey}${SKIP_THREAD_KEY}`)) delete rs.threads![key];
      }
    }
    if (!slackReviewerBaseAllowed(reviewer, pull.baseRef)) {
      // Like the repo filter: another branch's PR is none of this reviewer's business, no reply.
      return finish({
        outcome: "skipped",
        reason: `it targets \`${pull.baseRef}\`, not one of this reviewer's base branches`,
      });
    }
    if (pull.state !== "open") {
      // Nothing to ask for in a closed PR's thread, so it isn't watched.
      await this.say(job, "skipped", {
        reason: `it is ${pull.state}`,
        sha: pull.headSha.slice(0, 7),
      });
      return finish({ outcome: "skipped", reason: `it is ${pull.state}` }, pull.headSha);
    }
    if (reviewer.skipDrafts && pull.draft && !job.dryRun && !job.force) {
      return skip("it is a draft", pull.headSha, true);
    }
    const optOut = job.dryRun || job.force ? undefined : slackReviewOptOut(reviewer, pull);
    // No head SHA recorded: once the label or marker is gone, the same commit can be reviewed.
    if (optOut) return skip(optOut, undefined, true);
    const state = await this.loadState();
    const reviewerState = reviewerStateFor(state, reviewer);
    if (!job.dryRun && (await dismissFromForge(this.ctx, reviewerState, job, pull.comments))) {
      await this.saveState().catch(() => undefined);
    }
    const prior = reviewerState.reviewed[slackReviewPullKey(pr)];
    // Only a review that ran to the end counts: a draft or opt-out skip at this commit doesn't.
    const lastReviewed = prior?.reviewedSha ?? legacyReviewedSha(prior);
    // Explicit requests to review this commit bypass the usual head-SHA and follow-up checks.
    if (!job.dryRun && !job.retry && !job.force && !job.fullRereview && lastReviewed) {
      if (lastReviewed === pull.headSha && job.rereview) {
        return skip(
          `no new commits since \`${lastReviewed.slice(0, 7)}\`. Push the fixes, then ask again, or say "full re-review" to review the whole PR again`,
          lastReviewed,
          true,
        );
      }
      if (lastReviewed === pull.headSha || (!reviewer.rereviewOnNewCommits && !job.rereview)) {
        return skip(`already reviewed at \`${lastReviewed.slice(0, 7)}\``, lastReviewed, true);
      }
    }
    const dismissed = prior?.dismissed ?? [];
    /** Earlier reviews of this PR that ran to the end: picks 💬 / 💬+1 / 💬+2 in round-based maps. */
    const round = slackReviewRounds(prior);
    // Follow-up: hand the model the earlier findings so it can say which were fixed. Dismissed
    // ones are settled already, so they neither go back to the model nor count as open.
    const priorFindings =
      prior?.findings?.length && (prior.findingsSha ?? prior.sha) !== pull.headSha
        ? prior.findings.filter(
            (row) =>
              !dismissed.some(
                (old) => old.path === row.path && old.line === row.line && old.body === row.body,
              ),
          )
        : [];

    const checkoutMode = reviewer.cloneRepo ? (pick.cli ? "cli" : "tools") : undefined;
    let system = buildSlackReviewSystem(reviewer, config.skills, { checkout: checkoutMode });

    // Context the diff alone doesn't carry: CI, the issues the PR closes, and the repo's rules.
    const ci = reviewer.ciContext ? summarizeSlackReviewChecks(pull.checks) : undefined;
    const issues = reviewer.linkedIssues
      ? await readLinkedIssues(this.forge, account, pr, pull.body)
      : "";
    const ciLogs =
      ci?.failing.length && reviewer.ciLogs ? await readCiLogs(this.forge, account, pr, pull) : "";
    const discussion = reviewer.prDiscussion ? buildSlackReviewDiscussion(pull.comments) : "";
    const repoNotes = reviewer.learnFromDismissals
      ? buildSlackReviewRepoNotes(
          reviewerState.repoNotes?.[slackRepoNotesKey(pr)],
          pull.files.map((row) => row.path),
        )
      : "";
    let guidelineFiles = reviewer.repoGuidelines
      ? await guidelinesFromForge(this.forge, account, pr, pull.baseRef)
      : [];
    const pathPrompts = buildSlackReviewPathPrompts(
      slackReviewPathPrompts(
        reviewer,
        pull.files.map((row) => row.path),
      ),
      { skills: config.skills, reviewerPrompt: reviewer.prompt },
    );
    const contextChars =
      pathPrompts.length +
      (ci?.line.length ?? 0) +
      issues.length +
      Math.min(ciLogs.length, SLACK_REVIEW_CI_LOGS_MAX + 400) +
      discussion.length +
      repoNotes.length +
      (guidelineFiles.length ? buildSlackReviewGuidelines(guidelineFiles, pull.baseRef).length : 0);
    const cliLimit = this.deps.cliPromptLimit ?? cliPromptCharLimit(process.platform);
    let budget = slackReviewDiffBudget(
      reviewer,
      pick.cli
        ? {
            promptLimit: cliLimit,
            // System prompt, capped description, extra context, headers, fences, and the CLI's
            // own preamble.
            reservedChars: system.length + SLACK_REVIEW_DESCRIPTION_MAX + contextChars + 2_000,
          }
        : undefined,
    );

    // Follow-up after new commits: send only what changed since the last finished review, when
    // the forge can say so and the head moved forward (no force-push).
    const sinceSha =
      reviewer.incrementalRereview && !job.dryRun && !job.fullRereview ? lastReviewed : undefined;
    let incremental: { since: string; files: typeof pull.files } | undefined;
    if (sinceSha && sinceSha !== pull.headSha && this.forge.compareCommits) {
      const files = await this.forge
        .compareCommits(account, pr.owner, pr.repo, sinceSha, pull.headSha)
        .catch(() => undefined);
      if (files?.length) incremental = { since: sinceSha, files };
    }
    const planDiff = (b: typeof budget) => {
      let planned = compactPullDiff(pull.files, b);
      // A PR over budget may be split into parts, one model call each, instead of listing files.
      let plannedParts: ReturnType<typeof planSlackReviewParts> = [];
      if (incremental) {
        const step = compactPullDiff(incremental.files, b);
        // Inline comments can go on any line the whole PR diff shows, not just the new commits.
        const commentable = compactPullDiff(pull.files, {
          ...b,
          unlimitedTokens: true,
        }).commentable;
        planned = { ...step, commentable };
      } else if (
        reviewer.splitLargePrs &&
        planned.omitted.length &&
        // A CLI agent's prompt is capped by its command line even with No token limits.
        (!reviewer.unlimitedTokens || pick.cli)
      ) {
        plannedParts = planSlackReviewParts(pull.files, b);
        if (plannedParts.length > 1) {
          const commentable = new Map<string, Set<number>>();
          for (const part of plannedParts) {
            for (const [path, lines] of part.commentable) commentable.set(path, lines);
          }
          const last = plannedParts.at(-1)!;
          planned = {
            ...plannedParts[0]!,
            reviewed: plannedParts.flatMap((part) => part.reviewed),
            truncated: plannedParts.flatMap((part) => part.truncated),
            omitted: last.omitted,
            commentable,
          };
        } else {
          plannedParts = [];
        }
      }
      return { diff: planned, parts: plannedParts };
    };
    let { diff, parts } = planDiff(budget);
    if (incremental && !diff.reviewed.length) {
      return skip(
        `only generated, lockfile, binary, or deleted files changed since \`${incremental.since.slice(0, 7)}\``,
        pull.headSha,
      );
    }
    const anchorOf: SlackFindingAnchor = slackDiffAnchors(pull.files);
    if (!diff.reviewed.length) {
      return skip(
        "no reviewable changes (only generated, lockfile, binary, or deleted files)",
        pull.headSha,
      );
    }

    const pullInfo = {
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      title: pull.title,
      author: pull.author,
      baseRef: pull.baseRef,
      headRef: pull.headRef,
      body: pull.body,
    };
    const buildUser = (partIndex?: number) => {
      const shown = partIndex === undefined ? diff : parts[partIndex]!;
      const userBase = buildSlackReviewUserMessage(pullInfo, shown, {
        ...(incremental ? { incrementalSince: incremental.since } : {}),
        ...(ci?.line ? { ci: ci.line } : {}),
        ...(ciLogs ? { ciLogs } : {}),
        ...(issues ? { issues } : {}),
        ...(guidelineFiles.length
          ? { guidelines: buildSlackReviewGuidelines(guidelineFiles, pull.baseRef) }
          : {}),
        ...(repoNotes ? { repoNotes } : {}),
        ...(discussion ? { discussion } : {}),
        ...(partIndex !== undefined ? { part: slackReviewPartNote(partIndex, parts) } : {}),
        ...(pathPrompts ? { pathPrompts } : {}),
      });
      const followUp =
        priorFindings.length || dismissed.length
          ? buildSlackReviewFollowUp(
              {
                sha: prior!.findingsSha ?? prior!.sha,
                summary: prior!.summary,
                findings: priorFindings,
              },
              { incremental: Boolean(incremental), dismissed },
            )
          : "";
      return followUp ? `${userBase}\n\n${followUp}` : userBase;
    };
    if (pick.cli) {
      // The diff budget above is an estimate (the omitted-file list, earlier findings and the
      // CLI's preamble aren't in it). Measure the prompt the CLI will get, and shrink the diff
      // until it fits the command line instead of failing the review.
      const promptOver = () =>
        Math.max(
          ...(parts.length ? parts.map((_part, i) => buildUser(i)) : [buildUser()]).map((text) =>
            slackReviewCliPromptChars(system, text),
          ),
        ) - cliLimit;
      for (let attempt = 0, over = promptOver(); over > 0 && attempt < 5; attempt++) {
        const maxDiffChars = Math.max(1_000, budget.maxDiffChars - over - 1_000);
        if (maxDiffChars === budget.maxDiffChars) break;
        budget = {
          ...budget,
          maxDiffChars,
          maxFileChars: Math.min(budget.maxFileChars, maxDiffChars),
        };
        ({ diff, parts } = planDiff(budget));
        over = promptOver();
      }
    }
    let user = parts.length ? buildUser(0) : buildUser();
    // CLI agents may run on their own default model; say so instead of printing nothing.
    const modelLabel = pick.model || `${pick.provider.name} default`;
    trace?.setModel(modelLabel);
    const filesLabel =
      reviewPlural(diff.reviewed.length, "file") +
      (incremental ? ` changed since ${incremental.since.slice(0, 7)}` : "") +
      (diff.ignored.length ? ` (${diff.ignored.length} generated/lockfile skipped)` : "") +
      (diff.omitted.length ? ` (${diff.omitted.length} over budget)` : "") +
      (parts.length ? ` in ${parts.length} parts` : "");
    const marks = reviewer.reactionMap;
    if (marks.pickup) await this.react(job, marks.pickup);
    if (marks.working) await this.react(job, marks.working);
    await this.say(job, "started", {
      model: modelLabel,
      provider: pick.provider.name,
      files: filesLabel,
      tokens: (parts.length
        ? parts.reduce((sum, _part, i) => sum + estimateTokens(system + buildUser(i)), 0)
        : estimateTokens(system + user)
      ).toLocaleString("en-US"),
      checkout: checkoutMode ? ", with the repo checked out to check callers and tests" : "",
      title: pull.title,
      author: pull.author,
      sha: pull.headSha.slice(0, 7),
    });

    // Clone the PR head so the model can check the change against the code around it. A failed
    // clone is not a failed review: it falls back to the diff and says so in the usage line.
    let checkout: ReviewCheckout | undefined;
    let checkoutNote = "";
    if (checkoutMode) {
      try {
        checkout = await (this.deps.checkout ?? cloneReviewCheckout)({
          parentDir: this.checkoutsDir,
          account,
          pr,
          headSha: pull.headSha,
          headRef: pull.headRef,
        });
        // Bitbucket Cloud reports a short hash: a checkout that starts with it is the same commit.
        if (checkout.sha && pull.headSha && !checkout.sha.startsWith(pull.headSha)) {
          checkoutNote = `checked out ${checkout.sha.slice(0, 7)}, not ${pull.headSha.slice(0, 7)}`;
        }
      } catch (err) {
        checkoutNote = `diff only, clone failed: ${errorText(err).slice(0, 120)}`;
        system = buildSlackReviewSystem(reviewer, config.skills);
      }
    }
    if (reviewer.repoGuidelines && !guidelineFiles.length && checkout && !pick.cli) {
      // The forge couldn't read them: take the ones this PR doesn't touch from the clone, which
      // match the base branch. A CLI agent reads the clone itself, and its prompt is already
      // sized to fit its command line.
      guidelineFiles = await guidelinesFromCheckout(
        checkout.dir,
        new Set(pull.files.map((row) => row.path)),
      );
      if (guidelineFiles.length) user = parts.length ? buildUser(0) : buildUser();
    }

    // A split PR is several reviews in one: each part may keep the reviewer's comment cap.
    const capReviewer = {
      ...reviewer,
      maxComments: slackReviewCommentCap(reviewer.maxComments, parts.length),
    };
    const partSettle = (text: string, shown: CompactDiff) =>
      settleSlackReview(parseSlackReviewResult(text), shown, reviewer, { dismissed, anchorOf });
    const started = this.now();
    const texts: string[] = [];
    let lookups = 0;
    let capped = false;
    /** Files the serious findings point at, read from the clone before it goes, for `verifyFindings`. */
    let verifySources = new Map<string, string>();
    const usage: TokenUsage & { cacheWriteTokens?: number } = { inputTokens: 0, outputTokens: 0 };
    try {
      const users = parts.length ? parts.map((_part, i) => buildUser(i)) : [user];
      if (checkoutNote) trace?.note(checkoutNote);
      for (const [index, partUser] of users.entries()) {
        if (users.length > 1) trace?.note(`Part ${index + 1} of ${users.length}`);
        trace?.prompt(partUser);
        const out = await runReviewModel(this.complete, {
          reviewer,
          pick,
          system,
          user: partUser,
          checkout,
          usage,
          trace,
        });
        texts.push(out.text);
        lookups += out.lookups;
        capped = capped || out.capped;
        if (users.length > 1) await this.sayPartDone(job, index, parts, out.text, partSettle);
      }
      if (reviewer.verifyFindings && checkout) {
        verifySources = await verifySourcesFromCheckout(checkout.dir, texts).catch(
          () => new Map<string, string>(),
        );
      }
    } catch (err) {
      await this.unreactWorking(job);
      const message = errorText(err);
      // No CLI sandbox won't pass on a retry, whatever words its reason uses ("network").
      const noSandbox = err instanceof ReviewSandboxError;
      const reason = modelCallFailure(err);
      trace?.note(`Failed: ${reason}`);
      // A rate limit or quota error is when the provider's usage matters most.
      const providerUsage = (await this.quota.line(pick.provider, config)) ?? "";
      await this.say(job, "failed", { reason, model: modelLabel, providerUsage });
      return finish({
        outcome: "failed",
        reason,
        model: modelLabel,
        usage,
        ...(isTransientReviewError(message) && !job.retry && !noSandbox ? { retryable: true } : {}),
      });
    } finally {
      await checkout?.dispose().catch(() => undefined);
      await this.deps.budgets
        ?.record(
          { id: `slack-reviewer:${reviewer.id}`, providerId: pick.provider.id, model: pick.model },
          usage,
          config,
        )
        .catch(() => undefined);
    }
    let usd = estimateUsd(usage, resolveUsageRates(pick.provider, pick.model));
    const notes = [
      checkoutNote,
      capped ? `stopped reading at the $${reviewer.maxCostUsd.toFixed(2)} cost cap` : "",
    ].filter(Boolean);
    // Read after the model call, so it includes this review's spend where the vendor is quick.
    const providerUsage = (await this.quota.line(pick.provider, config)) ?? "";
    const usageLineNow = () =>
      formatSlackReviewUsage({
        model: modelLabel,
        ...usage,
        usd,
        elapsedMs: this.now() - started,
        ...(checkout && !pick.cli ? { lookups } : {}),
        ...(notes.length ? { note: notes.join(" · ") } : {}),
        providerUsage,
      });
    let usageLine = usageLineNow();

    let settled: ReturnType<typeof settleSlackReview>;
    let progress = "";
    let resolvedPrior: SlackPriorFinding[] = [];
    try {
      const parsed = mergeSlackReviewResults(
        texts.map((text): SlackReviewResult => parseSlackReviewResult(text)),
      );
      settled = settleSlackReview(parsed, diff, capReviewer, { dismissed, anchorOf });
      resolvedPrior = (parsed.previous ?? [])
        .filter((row) => row.resolved)
        .flatMap((row) => (priorFindings[row.id - 1] ? [priorFindings[row.id - 1]!] : []));
      progress = formatSlackRereviewProgress(priorFindings.length, parsed.previous);
    } catch (err) {
      await this.unreactWorking(job);
      const reason = errorText(err);
      await this.say(job, "failed", { reason, model: modelLabel, usage: usageLine, providerUsage });
      return finish({ outcome: "failed", reason, model: modelLabel, usage, usd });
    }

    // Second look at blocker / major findings before they are posted. Never fails the review.
    let verification: SlackReviewVerification | undefined;
    if (reviewer.verifyFindings && slackFindingsToVerify(settled.findings).length) {
      if (reviewer.maxCostUsd > 0 && usd !== undefined && usd >= reviewer.maxCostUsd) {
        notes.push("not verified: at the cost cap");
      } else {
        const checked = await verifyReviewFindings(
          { complete: this.complete, budgets: this.deps.budgets },
          {
            reviewer,
            config,
            pick,
            findings: settled.findings,
            files: pull.files,
            sources: verifySources,
            pull: { owner: pr.owner, repo: pr.repo, number: pr.number, title: pull.title },
            trace,
          },
        );
        verification = checked.verification;
        addUsage(usage, checked.usage);
        if (checked.usd !== undefined) usd = (usd ?? 0) + checked.usd;
        notes.push(
          formatSlackVerifyNote(verification) +
            (checked.model !== pick.model && checked.model ? ` (${checked.model})` : ""),
        );
        if (!verification.failed) {
          // Numbers, inline/body split and the verdict all follow from what is left.
          settled = settleSlackReview(
            { verdict: settled.verdict, summary: settled.summary, comments: checked.comments },
            diff,
            capReviewer,
            { anchorOf },
          );
        }
      }
      usageLine = usageLineNow();
    }

    const count = settled.findings.length;
    let outcome: SlackReviewOutcome =
      settled.verdict === "request_changes"
        ? reviewer.forgeMode === "verdict"
          ? "changesRequested"
          : "commented"
        : count
          ? "commented"
          : reviewer.forgeMode === "verdict"
            ? "approved"
            : "clean";
    let summary = settled.summary;
    if (outcome === "approved" && reviewer.holdApprovalOnFailingCi && ci?.failing.length) {
      // No findings, but CI is red: say so instead of approving over it.
      outcome = "clean";
      summary =
        `Not approving while CI is failing (${ci.failing.slice(0, 3).join(", ")}${ci.failing.length > 3 ? ", …" : ""}). ${summary}`.trim();
    }
    const reviewResult = {
      findings: settled.findings,
      summary,
    };

    const checkedRun = {
      ...(verification ? { verification } : {}),
      ...(resolvedPrior.length ? { resolved: resolvedPrior.length } : {}),
    };
    if (job.dryRun) {
      return finish({
        outcome,
        model: modelLabel,
        usage,
        usd,
        comments: count,
        ...reviewResult,
        ...checkedRun,
      });
    }

    if (reviewer.forgeMode !== "none") {
      const event: PostReviewInput["event"] =
        reviewer.forgeMode === "verdict"
          ? outcome === "approved"
            ? "APPROVE"
            : outcome === "changesRequested"
              ? "REQUEST_CHANGES"
              : "COMMENT"
          : "COMMENT";
      const footer = [
        `Automated review by Locus (${modelLabel}) of ${label} at ${pull.headSha.slice(0, 7)}${incremental ? `, changes since ${incremental.since.slice(0, 7)}` : ""}${checkout ? ", with the repo checked out" : ""}`,
        ...(count ? ['Reply "won\'t fix #n" in the Slack thread to dismiss a finding'] : []),
      ];
      try {
        await postReviewWithFallback(this.forge, account, pr, {
          event,
          // Part summaries are one per line: keep them apart in Markdown too.
          summary: parts.length ? summary.replace(/\n/g, "\n\n") : summary,
          inline: settled.inline,
          general: settled.general,
          footer,
          progress: progress.trim(),
          suggestionStyle: suggestionStyle(account),
          inlineComments: forgePostsInlineComments(account),
        });
        if (
          reviewer.resolveFixedThreads &&
          resolvedPrior.length &&
          this.forge.resolveReviewThreads
        ) {
          // Fixed since the last review: close those comment threads so the PR shows what's left.
          await this.forge
            .resolveReviewThreads(
              account,
              pr.owner,
              pr.repo,
              pr.number,
              slackResolvedThreadPicker(resolvedPrior),
            )
            .catch(() => 0);
        }
      } catch (err) {
        await this.unreactWorking(job);
        const reason = `the review was written but posting it to the PR failed (${errorText(err)})`;
        await this.say(job, "failed", {
          reason,
          model: modelLabel,
          usage: usageLine,
          providerUsage,
        });
        return finish({
          outcome: "failed",
          reason,
          model: modelLabel,
          usage,
          usd,
          comments: count,
        });
      }
    } else if (outcome === "changesRequested") {
      outcome = "commented";
    }

    await this.unreactWorking(job);
    const done = slackReviewOutcomeReaction(outcome, reviewer.reactionMap, round);
    if (done) await this.react(job, done);
    const resultTs = await this.say(
      job,
      outcome as keyof SlackReviewerStatusTemplates,
      {
        comments: reviewPlural(count, "comment"),
        // Part summaries go one per line under the headline.
        summary: parts.length && summary.includes("\n") ? `\n${summary}` : summary,
        findings: formatSlackReviewFindings(settled.findings),
        progress,
        usage: usageLine,
        providerUsage,
        model: modelLabel,
        provider: pick.provider.name,
        title: pull.title,
        author: pull.author,
        sha: pull.headSha.slice(0, 7),
      },
      slackReviewAuthorMention(reviewer, pull.author),
    );
    return finish(
      {
        outcome,
        model: modelLabel,
        usage,
        usd,
        comments: count,
        ...reviewResult,
        ...checkedRun,
        ...(resultTs ? { resultTs } : {}),
      },
      pull.headSha,
      {
        findings: slackPriorFindings(settled.findings, anchorOf),
        summary,
      },
    );
  }
}

/** Changes when a watched thread gets a reply, a reaction change, or a new or finished watch. */
function threadFingerprint(rs: { threads?: Record<string, ThreadEntry> }): string {
  return Object.entries(rs.threads ?? {})
    .map(([key, row]) => `${key}@${row.cursor ?? ""}#${JSON.stringify(row.addressed ?? null)}`)
    .sort()
    .join("|");
}

/** Changes when `autoReview` sees a new, newly ready, updated or closed PR. */
function autoReviewFingerprint(rs: {
  autoReview?: { pulls: Record<string, { ready: boolean; updatedAt?: string }> };
}): string {
  return Object.entries(rs.autoReview?.pulls ?? {})
    .map(([key, row]) => `${key}:${row.ready ? 1 : 0}:${row.updatedAt ?? ""}`)
    .sort()
    .join("|");
}

/** Length of the single prompt a CLI agent gets for this review (see oneShotCliPrompt). */
function slackReviewCliPromptChars(system: string, user: string): number {
  return oneShotCliPrompt(
    {
      system,
      messages: [{ id: "measure", role: "user", content: user, createdAt: "" }],
    },
    // The longer preamble (a checkout to read), so either way the prompt fits.
    { readWorkspace: true },
  ).length;
}
