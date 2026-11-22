/**
 * Slack PR reviewer triggers that don't start from a Slack post: polling a repo's open PRs for new
 * or newly ready ones (`autoReview`), and "@locus review" comments on the PR (`reviewOnPrComment`).
 * Pure helpers; `apps/server/src/slack/reviewerAutoReview.ts` does the forge and Slack calls.
 */
import type { PullComment } from "./repo.js";
import { reviewGlobToRegExp, type SlackReviewer } from "./slackReviewer.js";

/** How often a reviewer with `autoReview` lists its repos' open PRs. */
export const SLACK_AUTO_REVIEW_POLL_MS = 5 * 60_000;
/** How long an owner's repo list (for `acme/api-*`) is reused before it is listed again. */
export const SLACK_AUTO_REVIEW_REPO_LIST_MS = 60 * 60_000;
/** Repos polled per reviewer, so a broad glob can't turn one poll into hundreds of calls. */
export const SLACK_AUTO_REVIEW_MAX_REPOS = 20;
/** PRs whose comments are read per poll, for "@locus review" on PRs with no watched thread. */
export const SLACK_AUTO_REVIEW_MAX_COMMENT_READS = 10;
/** Open PRs remembered per reviewer. */
export const SLACK_AUTO_REVIEW_MAX_SEEN = 1_000;

/**
 * The repos `autoReview` polls. Exact `owner/repo` entries are polled as written. A `*` in the repo
 * name (`acme/api-*`) is a glob the server expands from the owner's repo list, when the forge can
 * list it. A `*` in the owner (`*\/api`) can't be polled and is ignored here (links still match).
 */
export function slackAutoReviewRepos(reviewer: Pick<SlackReviewer, "repos">): {
  exact: string[];
  globs: Array<{ owner: string; pattern: string }>;
} {
  const exact = new Set<string>();
  const globs: Array<{ owner: string; pattern: string }> = [];
  for (const raw of reviewer.repos) {
    const entry = raw.trim().replace(/\*\*/g, "*");
    const slash = entry.indexOf("/");
    if (slash <= 0 || slash === entry.length - 1) continue;
    const owner = entry.slice(0, slash);
    const name = entry.slice(slash + 1);
    if (owner.includes("*") || owner.includes("?")) continue;
    if (name.includes("*") || name.includes("?")) globs.push({ owner, pattern: entry });
    else exact.add(entry);
  }
  return { exact: [...exact], globs };
}

/** Repos from an owner's list (`owner/name`) that one of the reviewer's globs matches. */
export function expandSlackAutoReviewGlobs(
  globs: Array<{ owner: string; pattern: string }>,
  listed: string[],
): string[] {
  return listed.filter((full) => globs.some((glob) => reviewGlobToRegExp(glob.pattern).test(full)));
}

/** An open PR the poller has seen. */
export interface SlackAutoSeenPull {
  /** Ready for review when last seen (not a draft, or drafts aren't skipped). */
  ready: boolean;
  /** When the poller first saw it. "@locus review" comments before this don't count. */
  since: string;
  /** The forge's `updatedAt` when last seen; a change means new comments may be there. */
  updatedAt?: string;
}

export interface SlackAutoListedPull {
  /** `slackReviewPullKey` of the PR. */
  key: string;
  draft?: boolean;
  updatedAt?: string;
}

/**
 * Which of a repo's open PRs to review, given what the poller saw last time. On the first poll of a
 * repo (`primed` false) every PR is only remembered, so turning `autoReview` on never reviews the
 * backlog. After that a PR qualifies when it is new and ready, or was a draft and is now ready.
 * `changed` lists PRs seen before whose `updatedAt` moved (for the comment check). `seen` is the
 * repo's next set: PRs no longer open drop out.
 */
export function planSlackAutoReview(input: {
  primed: boolean;
  seen: Record<string, SlackAutoSeenPull>;
  pulls: SlackAutoListedPull[];
  skipDrafts: boolean;
  now: string;
}): { review: string[]; changed: string[]; seen: Record<string, SlackAutoSeenPull> } {
  const review: string[] = [];
  const changed: string[] = [];
  const seen: Record<string, SlackAutoSeenPull> = {};
  for (const pull of input.pulls) {
    const ready = !(input.skipDrafts && pull.draft);
    const before = input.seen[pull.key];
    seen[pull.key] = {
      ready,
      since: before?.since ?? input.now,
      ...(pull.updatedAt ? { updatedAt: pull.updatedAt } : {}),
    };
    if (!input.primed) continue;
    if (ready && (!before || !before.ready)) review.push(pull.key);
    else if (before && pull.updatedAt && pull.updatedAt !== before.updatedAt)
      changed.push(pull.key);
  }
  return { review, changed, seen };
}

/**
 * A PR comment asking this reviewer for a review: "@locus review", "locus re-review",
 * "@Locus rereview please". Only the `locus review` forms, so other bots' `/review` commands don't
 * trigger it.
 */
export const SLACK_PR_REVIEW_COMMAND = /^\s*@?locus\s+(re-?)?review\b/i;

export function isSlackPrReviewCommand(body: string | undefined): boolean {
  return Boolean(body && SLACK_PR_REVIEW_COMMAND.test(body));
}

/** A comment by a bot account (GitHub Apps end in `[bot]`, GitLab and others often in `-bot`). */
function isBotAuthor(author: string | undefined): boolean {
  return Boolean(author && /(?:\[bot\]|[-_]bot)$/i.test(author));
}

/**
 * The newest "@locus review" comment posted after `since`, from a person other than the
 * reviewer's own forge account (`selfLogins`, any case). `newest` is the latest comment time seen,
 * to store as the next `since`.
 */
export function slackPrReviewCommand(
  comments: PullComment[] | undefined,
  since: string | undefined,
  selfLogins: Array<string | undefined> = [],
): { request?: { author?: string; createdAt: string; id: string }; newest?: string } {
  const after = since ? Date.parse(since) : 0;
  const self = new Set(selfLogins.filter(Boolean).map((row) => row!.toLowerCase()));
  let newest: string | undefined;
  let request: { author?: string; createdAt: string; id: string } | undefined;
  for (const row of comments ?? []) {
    const at = Date.parse(row.createdAt);
    if (!Number.isFinite(at) || at <= after) continue;
    if (!newest || at > Date.parse(newest)) newest = row.createdAt;
    if (!isSlackPrReviewCommand(row.body)) continue;
    if (row.author && self.has(row.author.toLowerCase())) continue;
    if (isBotAuthor(row.author)) continue;
    if (!request || at > Date.parse(request.createdAt))
      request = {
        ...(row.author ? { author: row.author } : {}),
        createdAt: row.createdAt,
        id: row.id,
      };
  }
  return { ...(request ? { request } : {}), ...(newest ? { newest } : {}) };
}

function slackText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The top-level channel post an auto review replies under. */
export function formatSlackAutoReviewPost(input: {
  url: string;
  label: string;
  title?: string;
  author?: string;
  /** Who asked on the PR with "@locus review", for a PR the reviewer found by its comment. */
  requestedBy?: string;
}): string {
  const link = `<${input.url}|${input.label}>`;
  const title = input.title?.trim() ? `: ${slackText(input.title.trim().slice(0, 200))}` : "";
  if (input.requestedBy !== undefined) {
    const who = input.requestedBy ? slackText(input.requestedBy) : "Someone";
    return `:mag: ${who} asked for a review of ${link} on the PR${title}`;
  }
  const by = input.author ? ` by ${slackText(input.author)}` : "";
  return `:mag: New PR ${link}${by}${title}`;
}

/** The line a watched thread gets when "@locus review" on the PR starts a follow-up there. */
export function formatSlackPrCommandReply(author: string | undefined): string {
  return `:speech_balloon: ${author ? slackText(author) : "Someone"} asked for a review on the PR.`;
}
