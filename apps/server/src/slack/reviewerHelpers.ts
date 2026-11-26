/**
 * Free helpers for `SlackReviewerService`: provider picks, Slack message filters, PR link
 * canonicalisation, guideline and source reads from a clone or the forge, CI logs and linked
 * issues, posting a review with a body-only fallback, run slots, and error text.
 */
import { readFile } from "node:fs/promises";
import {
  buildSlackReviewLinkedIssues,
  isLocusReviewerPost,
  formatCiFailures,
  mergeSlackReviewResults,
  SLACK_REVIEW_CI_LOG_JOBS,
  SLACK_REVIEW_CI_LOGS_MAX,
  formatSlackReviewBody,
  formatSlackReviewComment,
  hasUsableKey,
  isSlackRereviewRequest,
  parsePullUrl,
  parseSlackReviewResult,
  settleSlackReview,
  slackLinkedIssueNumbers,
  slackReviewPullKey,
  supportsPromptCompletion,
  isPromptCliProvider,
  SLACK_REVIEW_GUIDELINE_FILES_MAX,
  SLACK_REVIEW_GUIDELINE_PATHS,
  type AiProvider,
  type GitForgeAccount,
  type LocusConfig,
  type ParsedPullUrl,
  type SlackMessage,
  type SlackReviewer,
  type SlackReviewRun,
  type TokenUsage,
  SLACK_REVIEW_VERIFY_MAX,
  SLACK_REVIEW_VERIFY_SEVERITIES,
} from "@locus/shared";
import type { PostReviewInput } from "../git/forgeAdapter.js";
import { resolveCheckoutPath } from "./reviewCheckout.js";
import { ReviewSandboxError } from "./reviewSandbox.js";
import type { SlackReviewerForge } from "./reviewerDeps.js";

export function addUsage(
  usage: TokenUsage & { cacheWriteTokens?: number },
  event: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    estimated?: boolean;
  },
): void {
  if (event.estimated) usage.estimated = true;
  usage.inputTokens += event.inputTokens;
  usage.outputTokens += event.outputTokens;
  if (event.cachedInputTokens)
    usage.cachedInputTokens = (usage.cachedInputTokens ?? 0) + event.cachedInputTokens;
  if (event.cacheWriteTokens)
    usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + event.cacheWriteTokens;
}

/** Slack ids that count as @-mentioning this reviewer: the identity it posts as. */
export function reviewerMentionIds(config: LocusConfig, reviewer: SlackReviewer): string[] {
  const slack = (config.integrations ?? []).find((row) => row.kind === "slack");
  if (!slack) return [];
  const id = reviewer.postAs === "user" ? slack.userId : (slack.botUserId ?? slack.userId);
  return id ? [id] : [];
}

const GUIDELINE_READ_MAX = 256 * 1024;

/** Guideline files from a clone, skipping any the PR changes (those would be the author's rules). */
export async function guidelinesFromCheckout(
  dir: string,
  changed: Set<string>,
): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = [];
  for (const path of SLACK_REVIEW_GUIDELINE_PATHS) {
    if (changed.has(path)) continue;
    const resolved = await resolveCheckoutPath(dir, path);
    if ("error" in resolved) continue;
    try {
      const text = await readFile(resolved.abs, "utf8");
      if (text.length <= GUIDELINE_READ_MAX && text.trim()) out.push({ path, text });
    } catch {
      continue;
    }
    if (out.length >= SLACK_REVIEW_GUIDELINE_FILES_MAX) break;
  }
  return out;
}

/** Larger files are left to the diff hunk when a finding is verified. */
const VERIFY_SOURCE_READ_MAX = 512 * 1024;

/**
 * The files the blocker / major findings in the model's reply point at, read from the clone while
 * it still exists, so `verifyFindings` can show the code around each line. Best effort: a reply
 * that doesn't parse (the review fails anyway) or a file that can't be read is skipped.
 */
export async function verifySourcesFromCheckout(
  dir: string,
  texts: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let paths: string[];
  try {
    paths = mergeSlackReviewResults(texts.map((text) => parseSlackReviewResult(text)))
      .comments.filter(
        (row) => row.line > 0 && SLACK_REVIEW_VERIFY_SEVERITIES.includes(row.severity),
      )
      .map((row) => row.path);
  } catch {
    return out;
  }
  for (const path of [...new Set(paths)].slice(0, SLACK_REVIEW_VERIFY_MAX)) {
    const resolved = await resolveCheckoutPath(dir, path);
    if ("error" in resolved) continue;
    try {
      const text = await readFile(resolved.abs, "utf8");
      if (text.length <= VERIFY_SOURCE_READ_MAX) out.set(path, text);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Provider for `verifyFindings`: `verifyProviderId` when it names a usable provider (with
 * `verifyModel`, or that provider's default), otherwise the review's own provider with
 * `verifyModel` or the review's model.
 */
export function pickVerifyProvider(
  config: Pick<LocusConfig, "providers">,
  reviewer: Pick<SlackReviewer, "verifyProviderId" | "verifyModel">,
  review: { provider: AiProvider; model: string; cli: boolean },
): { provider: AiProvider; model: string; cli: boolean } {
  if (reviewer.verifyProviderId) {
    const own = pickReviewProvider(
      { providers: config.providers, integrations: [] },
      { providerId: reviewer.verifyProviderId, model: reviewer.verifyModel },
    );
    if (own?.provider.id === reviewer.verifyProviderId) return own;
  }
  return { ...review, model: reviewer.verifyModel || review.model };
}

/**
 * Only the GitHub-style adapter (GitHub, Gitea, Forgejo) posts line comments. The GitLab,
 * Bitbucket and Azure DevOps adapters post the body alone and drop `comments` without an error.
 */
export function forgePostsInlineComments(account: GitForgeAccount): boolean {
  return (
    account.kind !== "gitlab" && account.kind !== "bitbucket" && account.kind !== "azuredevops"
  );
}

export function suggestionStyle(account: GitForgeAccount): "github" | "gitlab" | "plain" {
  if (account.kind === "github") return "github";
  if (account.kind === "gitlab") return "gitlab";
  return "plain";
}

export function isFinishedPullState(state: string | undefined): boolean {
  return state === "merged" || state === "closed";
}

/** A reply written by a person. Bot posts, joins and Locus's own posts never count. */
export function isHumanReply(message: SlackMessage): boolean {
  // Another Locus's reviewer (as the app, or as its user with the reviewer marker) is not a person:
  // its "Dismissed #1" or "Nothing to dismiss" lines must not read as commands, or two reviewers
  // in one channel answer each other forever.
  if (message.agent || message.bot || isLocusReviewerPost(message)) return false;
  if (message.subtype && message.subtype !== "thread_broadcast") return false;
  return Boolean(message.text?.trim());
}

/** A human thread reply asking for another look. Bot posts and Locus's own posts never count. */
export function isRereviewReply(message: SlackMessage): boolean {
  return isHumanReply(message) && isSlackRereviewRequest(message.text);
}

/** Top-level human posts only. Thread replies, bot posts, joins, and Locus's own posts are not review requests. */
export function isReviewablePost(message: SlackMessage): boolean {
  if (message.agent || isLocusReviewerPost(message)) return false;
  if (message.threadTs && message.threadTs !== message.ts) return false;
  if (message.subtype && message.subtype !== "thread_broadcast") return false;
  return Boolean(message.text?.trim());
}

/** Rebuild the link as posted (keeps GitLab / Bitbucket shapes) without Slack's `<…|label>` wrapping. */
export function canonicalPullUrl(pr: ParsedPullUrl, text: string): string {
  for (const match of text.matchAll(/https?:\/\/[^\s<>|"'`]+/g)) {
    const raw = match[0].replace(/[).,;:!?\]]+$/, "");
    const parsed = parsePullUrl(raw);
    if (parsed && slackReviewPullKey(parsed) === slackReviewPullKey(pr)) return raw;
  }
  return `https://${pr.host}/${pr.owner}/${pr.repo}/pull/${pr.number}`;
}

/**
 * Reviewer's provider, else the Slack account default, else the first enabled API provider with a
 * key. CLI agents (Claude Code, Codex, Cursor CLI, Kiro, custom) run only when chosen on the
 * reviewer or as the Slack default, never as the silent fallback: they keep their own tools, and
 * a review feeds them untrusted PR text. Cursor Cloud can't answer a single prompt.
 */
export function pickReviewProvider(
  config: Pick<LocusConfig, "providers" | "integrations">,
  reviewer: Pick<SlackReviewer, "providerId" | "model">,
): { provider: AiProvider; model: string; cli: boolean } | undefined {
  const usable = (row: AiProvider) =>
    row.enabled && supportsPromptCompletion(row) && hasUsableKey(row.apiKey, row.baseUrl, row.kind);
  const slack = (config.integrations ?? []).find((row) => row.kind === "slack");
  const candidates: Array<{ id?: string; model?: string }> = [
    { id: reviewer.providerId, model: reviewer.model },
    { id: slack?.defaultProviderId, model: reviewer.model || slack?.defaultModel },
  ];
  for (const want of candidates) {
    if (!want.id) continue;
    const provider = config.providers.find((row) => row.id === want.id);
    if (!provider || !usable(provider)) continue;
    const cli = isPromptCliProvider(provider);
    const model = want.model || provider.defaultModel || provider.models[0] || "";
    // A CLI can run on its own default model; an API call needs one named.
    if (model || cli) return { provider, model, cli };
  }
  const provider = config.providers.find((row) => usable(row) && !isPromptCliProvider(row));
  const model = reviewer.model || provider?.defaultModel || provider?.models[0];
  return provider && model ? { provider, model, cli: false } : undefined;
}

export async function postReviewWithFallback(
  forge: SlackReviewerForge,
  account: GitForgeAccount,
  pr: ParsedPullUrl,
  input: {
    event: PostReviewInput["event"];
    summary: string;
    inline: ReturnType<typeof settleSlackReview>["inline"];
    general: ReturnType<typeof settleSlackReview>["general"];
    footer: string[];
    progress?: string;
    suggestionStyle?: "github" | "gitlab" | "plain";
    /** False: the forge ignores line comments, so every finding goes in the body. */
    inlineComments?: boolean;
  },
): Promise<void> {
  const findings = [...input.inline, ...input.general].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  // Body-only: a suggestion block means nothing away from its line.
  const allInBody = () => findings.map(({ suggestion: _drop, ...row }) => row);
  const body = (general: typeof input.general) =>
    formatSlackReviewBody({
      summary: input.summary,
      general,
      findings,
      footer: input.footer,
      progress: input.progress,
    });
  if (input.inlineComments === false) {
    await forge.postReview(account, pr.owner, pr.repo, pr.number, {
      event: input.event,
      body: body(allInBody()),
    });
    return;
  }
  const comments = input.inline.map((row) => ({
    path: row.path,
    line: row.line,
    side: "RIGHT" as const,
    body: formatSlackReviewComment(row, input.suggestionStyle),
  }));
  try {
    await forge.postReview(account, pr.owner, pr.repo, pr.number, {
      event: input.event,
      body: body(input.general),
      ...(comments.length ? { comments } : {}),
    });
  } catch (err) {
    if (!comments.length) throw err;
    // A line the forge will not anchor (outdated diff) fails the whole review.
    // Fold every finding into the body instead of losing it.
    await forge.postReview(account, pr.owner, pr.repo, pr.number, {
      event: input.event,
      body: body(allInBody()),
    });
  }
}

export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** Why a model call failed. A missing CLI sandbox is said in full: what to install or set. */
export function modelCallFailure(err: unknown): string {
  return err instanceof ReviewSandboxError
    ? `the CLI agent was not started: ${err.message}`
    : `the model call failed (${errorText(err)})`;
}

/** Stamp the Slack thread a run was discussed in, so Settings can open the chat. Dry runs have none. */
export function withThread(
  run: SlackReviewRun,
  channelId: string,
  threadTs?: string,
): SlackReviewRun {
  if (run.dryRun || !threadTs || !channelId) return run;
  return { ...run, channelId, threadTs };
}

/** A reviewer's run slots: `limit` at once, never two for the same PR. */
export interface ReviewLane {
  limit: number;
  running: number;
  /** PR keys with a run going now. */
  busy: Set<string>;
  waiting: Array<{ key?: string; start: () => void }>;
}

/** Start waiting runs while the lane has free slots, skipping any whose PR is already running. */
export function pumpReviewLane(lane: ReviewLane): void {
  for (let i = 0; i < lane.waiting.length && lane.running < lane.limit;) {
    const row = lane.waiting[i]!;
    if (row.key && lane.busy.has(row.key)) {
      i++;
      continue;
    }
    lane.waiting.splice(i, 1);
    lane.running += 1;
    if (row.key) lane.busy.add(row.key);
    row.start();
  }
}

/** Condensed logs of the failing CI jobs, or "" when the forge can't give them. */
export async function readCiLogs(
  forge: SlackReviewerForge,
  account: GitForgeAccount,
  pr: ParsedPullUrl,
  pull: Awaited<ReturnType<SlackReviewerForge["getPull"]>>,
): Promise<string> {
  if (!forge.ciReport) return "";
  try {
    const report = await forge.ciReport(account, pr.owner, pr.repo, {
      number: pr.number,
      headSha: pull.headSha,
      checks: pull.checks,
      maxChars: Math.floor(SLACK_REVIEW_CI_LOGS_MAX / SLACK_REVIEW_CI_LOG_JOBS),
      maxLogs: SLACK_REVIEW_CI_LOG_JOBS,
    });
    if (!report.failures.some((row) => row.log?.text)) return "";
    return formatCiFailures(
      { ...report, failures: report.failures.slice(0, SLACK_REVIEW_CI_LOG_JOBS) },
      { heading: false },
    )
      .trim()
      .slice(0, SLACK_REVIEW_CI_LOGS_MAX);
  } catch {
    return "";
  }
}

/** Title and body of the issues the PR says it closes, fenced for the prompt. */
export async function readLinkedIssues(
  forge: SlackReviewerForge,
  account: GitForgeAccount,
  pr: ParsedPullUrl,
  body: string | undefined,
): Promise<string> {
  if (!forge.getIssue) return "";
  const numbers = slackLinkedIssueNumbers(body, pr).filter((n) => n !== pr.number);
  const issues: Array<{ number: number; title: string; body?: string }> = [];
  for (const number of numbers) {
    try {
      const issue = await forge.getIssue(account, pr.owner, pr.repo, number);
      issues.push({ number, title: issue.title, body: issue.body });
    } catch {
      // A PR number, a private issue tracker, or a typo: review without it.
    }
  }
  return buildSlackReviewLinkedIssues(issues);
}

/** AGENTS.md and friends from the base branch, so a PR can't rewrite the rules it is held to. */
export async function guidelinesFromForge(
  forge: SlackReviewerForge,
  account: GitForgeAccount,
  pr: ParsedPullUrl,
  baseRef: string,
): Promise<Array<{ path: string; text: string }>> {
  if (!forge.readFile || !baseRef) return [];
  const out: Array<{ path: string; text: string }> = [];
  for (const path of SLACK_REVIEW_GUIDELINE_PATHS) {
    const text = await forge
      .readFile(account, pr.owner, pr.repo, path, baseRef)
      .catch(() => undefined);
    if (text?.trim()) out.push({ path, text });
    if (out.length >= SLACK_REVIEW_GUIDELINE_FILES_MAX) break;
  }
  return out;
}
