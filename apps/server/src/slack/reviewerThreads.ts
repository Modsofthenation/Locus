/**
 * Watching review threads: re-review, retry and question replies, "won't fix" dismissals (in
 * Slack and on the PR), 👍 / 👎 counts, and which threads are watched. Reaches the service's queue
 * and Slack posts through `SlackReviewerContext`.
 */
import {
  isSlackFullRereviewRequest,
  isSlackRetryRequest,
  mergeSlackRepoNotes,
  slackDismissReason,
  slackForgeDismissals,
  slackRepoNotesKey,
  type SlackRepoNote,
  formatSlackDismissed,
  isSlackMentionReviewRequest,
  isSlackRereviewRequest,
  parseSlackDismissRequest,
  parsePullUrl,
  resolveForgeAccount,
  reviewPlural,
  slackReviewerQuestion,
  slackReviewVotes,
  slackAddressedAdded,
  slackAddressedSnapshot,
  slackPostStopped,
  slackReviewPullKey,
  slackReviewPullLabel,
  SLACK_DISMISSED_MAX,
  type LocusConfig,
  type PullComment,
  type SlackMessage,
  type SlackPriorFinding,
  type SlackReviewer,
  slackReviewerRequesterAllowed,
} from "@locus/shared";
import type { SlackReviewerContext } from "./reviewerDeps.js";
import {
  type ReviewedEntry,
  type ReviewerState,
  type StateFile,
  type ReviewJob,
  MAX_ANSWERS_PER_THREAD,
  SKIP_THREAD_KEY,
  THREAD_WATCH_MS,
  reviewerStateFor,
  recordReviewerStats,
} from "./reviewerState.js";
import { reviewerMentionIds, isFinishedPullState, isHumanReply } from "./reviewerHelpers.js";
import { reviewOnPrCommand } from "./reviewerAutoReview.js";

/** One forge call per watched thread this often, so a merged PR's thread stops being polled. */
export const DEFAULT_PULL_STATE_POLL_MS = 10 * 60_000;

/**
 * Check each watched review thread for new human replies: a re-review request, a retry after a
 * failure, a dismissal ("won't fix #2"), or a question that @-mentions the reviewer. Only replies
 * after the last scan count, never the reviewer's own posts. Also refreshes the 👍 / 👎 count on
 * its final message, and every `pullStatePollMs` reads the PR: merged or closed stops the watch,
 * and "won't fix" comments on the PR dismiss findings. `only` limits the scan to threads
 * (`channel:ts`) Socket Mode said have new replies.
 */
export async function scanThreads(
  ctx: SlackReviewerContext,
  reviewer: SlackReviewer,
  state: StateFile,
  config: LocusConfig,
  only?: Set<string>,
): Promise<boolean> {
  const rs = reviewerStateFor(state, reviewer);
  const threads = rs.threads;
  if (!threads) return false;
  let dirty = false;
  const cutoff = ctx.now() - THREAD_WATCH_MS;
  const mentionIds = reviewerMentionIds(config, reviewer);
  for (const [key, thread] of Object.entries(threads)) {
    if (Date.parse(thread.at) < cutoff) {
      delete threads[key];
      dirty = true;
      continue;
    }
    if (only && !only.has(`${reviewer.channelId}:${thread.ts}`)) continue;
    if (ctx.pending.has(`${reviewer.id}:${key}`)) continue;
    const pr = parsePullUrl(thread.url);
    if (!pr) {
      delete threads[key];
      dirty = true;
      continue;
    }
    const job: ReviewJob = {
      reviewer,
      pr,
      url: thread.url,
      channelId: reviewer.channelId,
      messageTs: thread.ts,
    };
    const pullStatePollMs = ctx.deps.pullStatePollMs ?? DEFAULT_PULL_STATE_POLL_MS;
    if (!thread.checked || ctx.now() - Date.parse(thread.checked) >= pullStatePollMs) {
      const pull = await ctx.readPull(pr);
      if (isFinishedPullState(pull?.state)) {
        // Merged or closed: nothing left to re-review, so stop polling the thread.
        delete threads[key];
        dirty = true;
        continue;
      }
      if (pull) {
        thread.checked = new Date(ctx.now()).toISOString();
        dirty = true;
        if (await dismissFromForge(ctx, rs, job, pull.comments)) dirty = true;
        const since = rs.reviewed[slackReviewPullKey(pr)]?.at ?? thread.at;
        const self = resolveForgeAccount(config.forges ?? [], { url: pr.repoUrl })?.username;
        if (await reviewOnPrCommand(ctx, rs, reviewer, pr, thread.url, pull, since, self))
          dirty = true;
      }
    }
    let rows: SlackMessage[];
    try {
      rows = await ctx.deps.slack.replies(reviewer.channelId, thread.ts);
    } catch (err) {
      if (ctx.noteSlackError(err)) throw err;
      continue; // Deleted thread or a blip: try again next poll.
    }
    if (countVotes(ctx, rs, rows)) dirty = true;
    let asked = false;
    if (reviewer.reactions) {
      const root = rows.find((message) => message.ts === thread.ts);
      if (root && slackPostStopped(reviewer.reactionMap, root.reactions)) {
        // Merged or declined on the post: nothing left to review here.
        delete threads[key];
        dirty = true;
        continue;
      }
      if (root && reviewer.reactionMap.rereviewOnAddressed) {
        const snapshot = slackAddressedSnapshot(reviewer.reactionMap, root.reactions);
        // The first look only records what is there: a pen from an earlier round is not new.
        if (thread.addressed && slackAddressedAdded(thread.addressed, snapshot)) asked = true;
        if (JSON.stringify(snapshot) !== JSON.stringify(thread.addressed ?? null)) {
          thread.addressed = snapshot;
          dirty = true;
        }
      }
    }
    let newest = thread.cursor;
    let retry = false;
    let fullRereview = false;
    let question: { text: string; asker?: string } | undefined;
    const dismissals: Array<{
      request: NonNullable<ReturnType<typeof parseSlackDismissRequest>>;
      text: string;
    }> = [];
    for (const message of rows) {
      if (message.ts === thread.ts || Number(message.ts) <= Number(thread.cursor)) continue;
      if (Number(message.ts) > Number(newest)) newest = message.ts;
      if (!isHumanReply(message) || ctx.ownPosts.has(message.ts)) continue;
      const dismiss = reviewer.dismissInThread ? parseSlackDismissRequest(message.text) : undefined;
      if (dismiss) dismissals.push({ request: dismiss, text: message.text });
      // Re-review, retry and questions spend tokens: only listed people may ask. Dismissals
      // cost nothing and stay open to anyone in the thread.
      const mayAsk = slackReviewerRequesterAllowed(reviewer, message.userId);
      const mayRereview = mayAsk && reviewer.rereviewOnThreadReply;
      const full = mayRereview && isSlackFullRereviewRequest(message.text, mentionIds);
      if (full) fullRereview = true;
      const rereview =
        full ||
        (mayRereview &&
          (isSlackRereviewRequest(message.text) ||
            isSlackMentionReviewRequest(message.text, mentionIds)));
      if (rereview) asked = true;
      const again = mayRereview && !rereview && isSlackRetryRequest(message.text);
      if (again) retry = true;
      if (dismiss || rereview || again || question || !reviewer.answerQuestions || !mayAsk) {
        continue;
      }
      const text = slackReviewerQuestion(message.text, mentionIds);
      if (text) question = { text, asker: message.userName };
    }
    if (newest !== thread.cursor) {
      thread.cursor = newest;
      dirty = true;
    }
    for (const { request, text } of dismissals) {
      if (await dismiss(ctx, rs, job, request, text)) dirty = true;
    }
    if (asked || retry) {
      // After a skip, asking again means "review it anyway".
      void ctx.enqueue({
        ...job,
        rereview: true,
        ...(retry ? { retry: true } : {}),
        ...(fullRereview ? { fullRereview: true } : {}),
        ...(thread.skipped ? { force: true } : {}),
      });
    } else if (question && (thread.answers ?? 0) < MAX_ANSWERS_PER_THREAD) {
      thread.answers = (thread.answers ?? 0) + 1;
      dirty = true;
      ctx.enqueueAnswer({
        reviewer,
        pr,
        url: thread.url,
        channelId: reviewer.channelId,
        threadTs: thread.ts,
        question: question.text,
        asker: question.asker,
      });
    }
  }
  return dirty;
}

/** Update votes on any final message in `rows` this reviewer posted. */
function countVotes(ctx: SlackReviewerContext, rs: ReviewerState, rows: SlackMessage[]): boolean {
  if (!rs.feedback) return false;
  let dirty = false;
  for (const message of rows) {
    const entry = rs.feedback[message.ts];
    if (!entry) continue;
    const votes = slackReviewVotes(message.reactions);
    if (votes.up !== entry.up || votes.down !== entry.down) {
      recordReviewerStats(
        rs,
        { up: votes.up - entry.up, down: votes.down - entry.down },
        ctx.now(),
      );
      entry.up = votes.up;
      entry.down = votes.down;
      dirty = true;
    }
  }
  return dirty;
}

/** "won't fix #2": remember the finding as dismissed and say so in the thread. No model call. */
async function dismiss(
  ctx: SlackReviewerContext,
  rs: ReviewerState,
  job: ReviewJob,
  request: NonNullable<ReturnType<typeof parseSlackDismissRequest>>,
  text = "",
): Promise<boolean> {
  const entry = rs.reviewed[slackReviewPullKey(job.pr)];
  const findings = entry?.findings ?? [];
  const picked =
    "all" in request
      ? findings.map((row, i) => ({ ...row, id: i + 1 }))
      : request.ids.flatMap((id) => (findings[id - 1] ? [{ ...findings[id - 1]!, id }] : []));
  if (!entry || !picked.length) {
    const label = slackReviewPullLabel(job.pr);
    await ctx.postText(
      job,
      findings.length
        ? `:thinking_face: The last review of <${job.url}|${label}> has ${reviewPlural(findings.length, "finding")} (#1–#${findings.length}). Nothing to dismiss there.`
        : `:thinking_face: The last review of <${job.url}|${label}> left no findings to dismiss.`,
    );
    return false;
  }
  recordDismissals(ctx, rs, job, entry, picked, () => text);
  await ctx.say(job, "dismissed", {
    dismissed: formatSlackDismissed(picked),
    sha: entry.sha.slice(0, 7),
  });
  return true;
}

/**
 * Add findings to the PR's dismissed list and, with `learnFromDismissals`, to the repo's notes so
 * later PRs aren't held to them either.
 */
function recordDismissals(
  ctx: SlackReviewerContext,
  rs: ReviewerState,
  job: ReviewJob,
  entry: ReviewedEntry,
  picked: Array<SlackPriorFinding & { id: number }>,
  reasonText: (id: number) => string,
): void {
  const dismissed = entry.dismissed ?? [];
  const notes: SlackRepoNote[] = [];
  const at = new Date(ctx.now()).toISOString();
  for (const row of picked) {
    const { id, ...finding } = row;
    const known = dismissed.some(
      (old) => old.path === finding.path && old.line === finding.line && old.body === finding.body,
    );
    if (!known) {
      dismissed.push(finding);
      const reason = slackDismissReason(reasonText(id));
      recordReviewerStats(rs, { dismissed: { [reason]: { [finding.severity]: 1 } } }, ctx.now());
    }
    notes.push({
      path: finding.path,
      severity: finding.severity,
      body: finding.body,
      reason: slackDismissReason(reasonText(id)),
      pr: slackReviewPullLabel(job.pr),
      at,
    });
  }
  entry.dismissed = dismissed.slice(-SLACK_DISMISSED_MAX);
  if (job.reviewer.learnFromDismissals && notes.length) {
    const key = slackRepoNotesKey(job.pr);
    const repoNotes = (rs.repoNotes ??= {});
    repoNotes[key] = mergeSlackRepoNotes(repoNotes[key], notes);
  }
}

/**
 * "won't fix #2" on the PR, or a "won't fix" reply to one of the reviewer's inline comments:
 * dismiss like the Slack command does, and say so in the Slack thread. Only comments newer than
 * the last check count.
 */
export async function dismissFromForge(
  ctx: SlackReviewerContext,
  rs: ReviewerState,
  job: ReviewJob,
  comments: PullComment[] | undefined,
): Promise<boolean> {
  if (!job.reviewer.dismissOnPr) return false;
  const entry = rs.reviewed[slackReviewPullKey(job.pr)];
  if (!entry?.findings?.length) return false;
  const found = slackForgeDismissals(comments, entry.findings, entry.forgeCursor ?? entry.at);
  let dirty = false;
  if (found.newest && found.newest !== entry.forgeCursor) {
    entry.forgeCursor = found.newest;
    dirty = true;
  }
  const picked = found.ids.flatMap((id) => {
    const row = entry.findings![id - 1]!;
    const already = entry.dismissed?.some(
      (old) => old.path === row.path && old.line === row.line && old.body === row.body,
    );
    return already ? [] : [{ ...row, id }];
  });
  if (!picked.length) return dirty;
  recordDismissals(ctx, rs, job, entry, picked, (id) => found.reasons[id] ?? "");
  await ctx.say(job, "dismissed", {
    dismissed: `${formatSlackDismissed(picked)} (from the PR)`,
    sha: entry.sha.slice(0, 7),
  });
  return true;
}

/** Start (or refresh) watching the thread a review replied in. */
export function watchThread(
  rs: ReviewerState,
  job: ReviewJob,
  at: string,
  resultTs: string | undefined,
): void {
  if (!job.messageTs || !job.channelId || job.channelId !== rs.channelId) return;
  const threads = (rs.threads ??= {});
  const key = slackReviewPullKey(job.pr);
  const current = threads[key];
  // A review ran, so threads that were only kept for "review again" after a skip are done.
  for (const other of Object.keys(threads)) {
    if (other.startsWith(`${key}${SKIP_THREAD_KEY}`)) delete threads[other];
  }
  // Only called after the review read the PR, so it was open just now.
  if (current && current.ts === job.messageTs) {
    current.cursor = laterTs(current.cursor, job.requestTs);
    current.at = at;
    current.url = job.url;
    current.checked = at;
    if (resultTs) current.resultTs = resultTs;
    delete current.skipped;
  } else {
    // A new post of the same PR moves the conversation to its thread.
    threads[key] = {
      ts: job.messageTs,
      url: job.url,
      cursor: laterTs(job.messageTs, job.requestTs),
      at,
      checked: at,
      ...(resultTs ? { resultTs } : {}),
    };
  }
  const keys = Object.entries(threads)
    .sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at))
    .map(([row]) => row);
  for (const stale of keys.slice(job.reviewer.maxWatchedThreads)) delete threads[stale];
}

/**
 * Keep listening in a thread whose reply was a skip, so "@Locus review again" (or "re-review",
 * "retry") there works. `overridable` skips are reviewed anyway when asked. A skip on a new post
 * while another thread of the PR is watched gets its own entry, so the review thread (with its
 * findings, dismissals and votes) keeps being watched too.
 */
export function watchSkippedThread(
  rs: ReviewerState,
  job: ReviewJob,
  at: string,
  overridable: boolean,
): void {
  if (!job.messageTs || !job.channelId || job.channelId !== rs.channelId) return;
  const threads = (rs.threads ??= {});
  const prKey = slackReviewPullKey(job.pr);
  const current = threads[prKey];
  const key =
    !current || current.ts === job.messageTs ? prKey : `${prKey}${SKIP_THREAD_KEY}${job.messageTs}`;
  const entry = threads[key];
  if (entry) {
    entry.cursor = laterTs(entry.cursor, job.requestTs);
    entry.at = at;
    entry.checked = at;
    if (overridable) entry.skipped = true;
    else delete entry.skipped;
  } else {
    threads[key] = {
      ts: job.messageTs,
      url: job.url,
      cursor: laterTs(job.messageTs, job.requestTs),
      at,
      checked: at,
      ...(overridable ? { skipped: true as const } : {}),
    };
  }
  const keys = Object.entries(threads)
    .sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at))
    .map(([row]) => row);
  for (const stale of keys.slice(job.reviewer.maxWatchedThreads)) delete threads[stale];
}

/** The later of two Slack timestamps (`b` may be missing). */
function laterTs(a: string, b: string | undefined): string {
  return b && Number(b) > Number(a) ? b : a;
}
