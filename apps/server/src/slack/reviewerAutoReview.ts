/**
 * `autoReview` polling (new and ready PRs in the reviewer's repos, posted to the channel and
 * reviewed in that post's thread) and `reviewOnPrComment` ("@locus review" on the PR). Reaches the
 * service's queue and Slack posts through `SlackReviewerContext`.
 */
import {
  parsePullUrl,
  resolveForgeAccount,
  slackReviewerAuthorExcluded,
  slackReviewerRepoAllowed,
  slackReviewPullKey,
  slackReviewPullLabel,
  type GitForgeAccount,
  type LocusConfig,
  type ParsedPullUrl,
  type PullComment,
  type SlackReviewer,
  expandSlackAutoReviewGlobs,
  formatSlackAutoReviewPost,
  formatSlackPrCommandReply,
  isDraftPull,
  planSlackAutoReview,
  slackAutoReviewRepos,
  slackPrReviewCommand,
  SLACK_AUTO_REVIEW_MAX_COMMENT_READS,
  SLACK_AUTO_REVIEW_MAX_REPOS,
  SLACK_AUTO_REVIEW_MAX_SEEN,
  SLACK_AUTO_REVIEW_POLL_MS,
  SLACK_AUTO_REVIEW_REPO_LIST_MS,
  type PullRequestRef,
} from "@locus/shared";
import { withFreshForgeToken } from "../git/forgeOauth.js";
import type { SlackReviewerContext } from "./reviewerDeps.js";
import {
  type ReviewerState,
  type StateFile,
  type ReviewJob,
  MAX_REVIEWED_PER_REVIEWER,
  reviewerStateFor,
  legacyReviewedSha,
} from "./reviewerState.js";

/**
 * `autoReview`: every `pollMs` (Settings → Polling), list the open PRs of the reviewer's repos and review
 * each one opened or marked ready since the last poll, under a new post in the channel. The
 * first poll of a repo only remembers what is open (no backlog). With `reviewOnPrComment`, PRs
 * updated since the last poll are read for "@locus review" comments.
 */
export async function pollAutoReview(
  ctx: SlackReviewerContext,
  reviewer: SlackReviewer,
  state: StateFile,
  config: LocusConfig,
  /** Wait since the last poll; the service passes Settings → Polling's current interval. */
  pollMs = ctx.deps.autoReviewPollMs ?? SLACK_AUTO_REVIEW_POLL_MS,
): Promise<boolean> {
  if (!reviewer.autoReview || !reviewer.repos.length || !ctx.forge.listPulls) return false;
  const last = ctx.lastAutoPoll.get(reviewer.id);
  if (last !== undefined && ctx.now() - last < pollMs) return false;
  ctx.lastAutoPoll.set(reviewer.id, ctx.now());
  const resolved = resolveForgeAccount(config.forges ?? [], {});
  if (!resolved) return false;
  const account = ctx.deps.freshForgeToken
    ? await ctx.deps.freshForgeToken(resolved)
    : await withFreshForgeToken(ctx.store, resolved, ctx.deps.fetch ?? fetch);
  const rs = reviewerStateFor(state, reviewer);
  const auto = (rs.autoReview ??= { primed: {}, pulls: {} });
  const repos = await autoReviewRepoList(ctx, reviewer, account);
  const now = new Date(ctx.now()).toISOString();
  let dirty = false;
  let reads = 0;
  for (const full of repos) {
    const slash = full.indexOf("/");
    let rows: Array<Omit<PullRequestRef, "repoId">>;
    try {
      rows = await ctx.forge.listPulls(account, full.slice(0, slash), full.slice(slash + 1));
    } catch {
      continue; // No access or a blip: the repo stays as it was until the next poll.
    }
    const repoKey = full.toLowerCase();
    const listed = rows.flatMap((row) => {
      const pr = parsePullUrl(row.url);
      return pr ? [{ row, pr, key: slackReviewPullKey(pr) }] : [];
    });
    const before = Object.fromEntries(
      Object.entries(auto.pulls).filter(([, row]) => row.repo === repoKey),
    );
    const plan = planSlackAutoReview({
      primed: Boolean(auto.primed[repoKey]),
      seen: before,
      pulls: listed.map(({ row, key }) => ({
        key,
        draft: isDraftPull(row),
        updatedAt: row.updatedAt,
      })),
      skipDrafts: reviewer.skipDrafts,
      now,
    });
    for (const key of Object.keys(before)) delete auto.pulls[key];
    for (const [key, row] of Object.entries(plan.seen)) {
      const postTs = before[key]?.postTs;
      auto.pulls[key] = { ...row, repo: repoKey, ...(postTs ? { postTs } : {}) };
    }
    auto.primed[repoKey] ??= now;
    dirty = true;
    for (const key of plan.review) {
      const item = listed.find((row) => row.key === key)!;
      // Not posted (Slack down): forget it was ready, so the next poll tries again.
      if (!(await autoReviewPull(ctx, reviewer, rs, item))) auto.pulls[key]!.ready = false;
    }
    if (!reviewer.reviewOnPrComment) continue;
    for (const key of plan.changed) {
      if (reads >= SLACK_AUTO_REVIEW_MAX_COMMENT_READS) break;
      const item = listed.find((row) => row.key === key)!;
      reads++;
      let pull: { title?: string; comments?: PullComment[] };
      try {
        pull = await ctx.forge.getPull(account, item.pr.owner, item.pr.repo, item.pr.number);
      } catch {
        continue;
      }
      const thread = rs.threads?.[key];
      const since = thread ? (rs.reviewed[key]?.at ?? thread.at) : (auto.pulls[key]?.since ?? now);
      const url = thread?.url ?? item.row.url;
      if (await reviewOnPrCommand(ctx, rs, reviewer, item.pr, url, pull, since, account.username))
        dirty = true;
    }
  }
  // Repos no longer polled are forgotten; if they come back they are primed again.
  const polled = new Set(repos.map((row) => row.toLowerCase()));
  for (const repo of Object.keys(auto.primed)) {
    if (polled.has(repo)) continue;
    delete auto.primed[repo];
    for (const [key, row] of Object.entries(auto.pulls))
      if (row.repo === repo) delete auto.pulls[key];
  }
  const keys = Object.entries(auto.pulls)
    .sort((a, b) => Date.parse(b[1].since) - Date.parse(a[1].since))
    .map(([key]) => key);
  for (const stale of keys.slice(SLACK_AUTO_REVIEW_MAX_SEEN)) delete auto.pulls[stale];
  return dirty;
}

/**
 * The repos `autoReview` polls: exact `owner/repo` entries, plus the repos the account can see
 * that match a `*` in a repo name (listed at most hourly). At most `SLACK_AUTO_REVIEW_MAX_REPOS`.
 */
async function autoReviewRepoList(
  ctx: SlackReviewerContext,
  reviewer: SlackReviewer,
  account: GitForgeAccount,
): Promise<string[]> {
  const { exact, globs } = slackAutoReviewRepos(reviewer);
  const out = new Map(exact.map((row) => [row.toLowerCase(), row]));
  if (globs.length && ctx.forge.listRepos) {
    let cached = ctx.accountRepos.get(account.id);
    if (!cached || ctx.now() - cached.at >= SLACK_AUTO_REVIEW_REPO_LIST_MS) {
      try {
        const rows = await ctx.forge.listRepos(account);
        cached = { at: ctx.now(), repos: rows.map((row) => `${row.owner}/${row.name}`) };
        ctx.accountRepos.set(account.id, cached);
      } catch {
        /* the forge can't list repos: only exact entries are polled */
      }
    }
    for (const full of expandSlackAutoReviewGlobs(globs, cached?.repos ?? [])) {
      if (!out.has(full.toLowerCase())) out.set(full.toLowerCase(), full);
    }
  }
  return [...out.values()].slice(0, SLACK_AUTO_REVIEW_MAX_REPOS);
}

/**
 * Post a newly opened or ready PR to the channel and queue its review in that post's thread.
 * Skips (returning true) a PR already queued or already reviewed at this head. False when the
 * post failed, so the next poll tries again.
 */
async function autoReviewPull(
  ctx: SlackReviewerContext,
  reviewer: SlackReviewer,
  rs: ReviewerState,
  item: { row: Omit<PullRequestRef, "repoId">; pr: ParsedPullUrl; key: string },
): Promise<boolean> {
  const { row, pr, key } = item;
  if (!slackReviewerRepoAllowed(reviewer, pr)) return true;
  // An author the operator excluded: not posted, not reviewed.
  if (slackReviewerAuthorExcluded(reviewer, row.author)) return true;
  if (ctx.pending.has(`${reviewer.id}:${key}`)) return true;
  const prior = rs.reviewed[key];
  const reviewedSha = prior?.reviewedSha ?? legacyReviewedSha(prior);
  if (prior && row.headSha && reviewedSha === row.headSha) return true;
  if (prior && reviewedSha && !reviewer.rereviewOnNewCommits) return true;
  const ts = await ctx.postToChannel(
    reviewer,
    formatSlackAutoReviewPost({
      url: row.url,
      label: slackReviewPullLabel(pr),
      title: row.title,
      author: row.author,
    }),
  );
  if (!ts) return false;
  const seen = rs.autoReview?.pulls[key];
  if (seen) seen.postTs = ts;
  void ctx.enqueue({
    reviewer,
    pr,
    url: row.url,
    channelId: reviewer.channelId,
    messageTs: ts,
    // Skipped at this head earlier (a draft) but never reviewed: not "already reviewed".
    ...(prior && prior.sha === row.headSha ? { retry: true } : {}),
  });
  return true;
}

/**
 * `reviewOnPrComment`: an "@locus review" comment on the PR posted after `since` (and after the
 * last check) asks for a review. A PR with a watched thread gets a follow-up there, like
 * "re-review"; one without gets a new channel post, only with `autoReview`. Comments by
 * `selfLogin` (the reviewer's forge account) and bots never count.
 */
export async function reviewOnPrCommand(
  ctx: SlackReviewerContext,
  rs: ReviewerState,
  reviewer: SlackReviewer,
  pr: ParsedPullUrl,
  url: string,
  pull: { title?: string; comments?: PullComment[] },
  since: string,
  selfLogin: string | undefined,
): Promise<boolean> {
  if (!reviewer.reviewOnPrComment) return false;
  const key = slackReviewPullKey(pr);
  const cursors = (rs.prCommands ??= {});
  const found = slackPrReviewCommand(pull.comments, cursors[key] ?? since, [selfLogin]);
  let dirty = false;
  if (found.newest && found.newest !== cursors[key]) {
    cursors[key] = found.newest;
    const keys = Object.keys(cursors);
    for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_REVIEWED_PER_REVIEWER)))
      delete cursors[stale];
    dirty = true;
  }
  if (!found.request || ctx.pending.has(`${reviewer.id}:${key}`)) return dirty;
  const thread = rs.threads?.[key];
  if (thread) {
    const job: ReviewJob = {
      reviewer,
      pr,
      url: thread.url,
      channelId: reviewer.channelId,
      messageTs: thread.ts,
    };
    await ctx.postText(job, formatSlackPrCommandReply(found.request.author));
    void ctx.enqueue({ ...job, rereview: true });
    return true;
  }
  if (!reviewer.autoReview) return dirty;
  const ts = await ctx.postToChannel(
    reviewer,
    formatSlackAutoReviewPost({
      url,
      label: slackReviewPullLabel(pr),
      title: pull.title,
      requestedBy: found.request.author ?? "",
    }),
  );
  if (!ts) return dirty;
  const seen = rs.autoReview?.pulls[key];
  if (seen) seen.postTs = ts;
  void ctx.enqueue({
    reviewer,
    pr,
    url,
    channelId: reviewer.channelId,
    messageTs: ts,
    rereview: true,
  });
  return true;
}
