/**
 * Answers to questions asked of the reviewer in its review thread: one small tool-less completion
 * over the last review's findings and the PR diff, posted as a thread reply.
 */
import { randomUUID } from "node:crypto";
import {
  buildSlackReviewAnswerMessage,
  compactPullDiff,
  estimateUsd,
  resolveUsageRates,
  slackReviewPullKey,
  slackReviewPullLabel,
  cliPromptCharLimit,
  slackReviewDiffBudget,
  SLACK_REVIEW_ANSWER_DIFF_MAX,
  SLACK_REVIEW_ANSWER_MAX_TOKENS,
  SLACK_REVIEW_ANSWER_SYSTEM,
  type SlackReviewRun,
  type TokenUsage,
} from "@locus/shared";
import type { SlackReviewTraceRecorder } from "./reviewTrace.js";
import type { SlackReviewerContext, SlackReviewerForge } from "./reviewerDeps.js";
import { type AnswerJob, type ReviewJob, reviewerStateFor } from "./reviewerState.js";
import { CLI_REVIEW_TIMEOUT_MS, REVIEW_TIMEOUT_MS } from "./reviewModel.js";
import { addUsage, errorText, modelCallFailure, pickReviewProvider } from "./reviewerHelpers.js";

export const ANSWER_SLACK_MAX = 3_000;

/**
 * Answer a question someone asked the reviewer in its thread: one small completion over the last
 * review's findings and the PR diff, posted as a thread reply. No tools.
 */
export async function answerQuestion(
  ctx: SlackReviewerContext,
  job: AnswerJob,
  trace?: SlackReviewTraceRecorder,
): Promise<SlackReviewRun> {
  const { reviewer, pr } = job;
  const label = slackReviewPullLabel(pr);
  const reviewJob: ReviewJob = {
    reviewer,
    pr,
    url: job.url,
    channelId: job.channelId,
    messageTs: job.threadTs,
  };
  const base = { reviewerId: reviewer.id, pr: label, url: job.url };
  const fail = async (reason: string, extra: Partial<SlackReviewRun> = {}) => {
    await ctx.postText(reviewJob, `:warning: Couldn't answer that: ${reason}`);
    return {
      ...base,
      outcome: "failed" as const,
      reason,
      ...extra,
      at: new Date(ctx.now()).toISOString(),
    };
  };
  const config = await ctx.store.loadConfig();
  const pick = pickReviewProvider(config, reviewer);
  if (!pick) return fail("no provider can run it");
  let pull: Awaited<ReturnType<SlackReviewerForge["getPull"]>>;
  try {
    const account = await ctx.forgeAccount(config, pr);
    pull = await ctx.forge.getPull(account, pr.owner, pr.repo, pr.number);
  } catch (err) {
    return fail(`couldn't read the PR (${errorText(err)})`);
  }
  const prior = reviewerStateFor(await ctx.loadState(), reviewer).reviewed[slackReviewPullKey(pr)];
  const diffChars = Math.min(reviewer.maxDiffChars, SLACK_REVIEW_ANSWER_DIFF_MAX);
  const diff = compactPullDiff(
    pull.files,
    slackReviewDiffBudget(
      { ...reviewer, unlimitedTokens: false, maxDiffChars: diffChars },
      pick.cli
        ? {
            promptLimit: ctx.deps.cliPromptLimit ?? cliPromptCharLimit(process.platform),
            reservedChars: SLACK_REVIEW_ANSWER_SYSTEM.length + 8_000,
          }
        : undefined,
    ),
  );
  const user = buildSlackReviewAnswerMessage({
    pull: {
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      title: pull.title,
      author: pull.author,
      baseRef: pull.baseRef,
      headRef: pull.headRef,
    },
    diff,
    findings: prior?.findings ?? [],
    summary: prior?.summary,
    question: job.question,
    asker: job.asker,
  });
  const modelLabel = pick.model || `${pick.provider.name} default`;
  trace?.setModel(modelLabel);
  trace?.prompt(user);
  const usage: TokenUsage & { cacheWriteTokens?: number } = { inputTokens: 0, outputTokens: 0 };
  let text = "";
  try {
    for await (const event of ctx.complete(
      {
        provider: pick.provider,
        model: pick.model,
        system: SLACK_REVIEW_ANSWER_SYSTEM,
        messages: [
          {
            id: `slack-review-${randomUUID()}`,
            role: "user",
            content: user,
            createdAt: new Date().toISOString(),
          },
        ],
        allowedTools: [],
        maxTokens: SLACK_REVIEW_ANSWER_MAX_TOKENS,
        signal: AbortSignal.timeout(pick.cli ? CLI_REVIEW_TIMEOUT_MS : REVIEW_TIMEOUT_MS),
      },
      trace && pick.cli ? { onTrace: (event) => trace.cli(event) } : undefined,
    )) {
      trace?.event(event);
      if (event.type === "text") text += event.text;
      else if (event.type === "usage") addUsage(usage, event);
    }
  } catch (err) {
    trace?.note(`Failed: ${modelCallFailure(err)}`);
    return fail(modelCallFailure(err), { model: modelLabel, usage });
  } finally {
    await ctx.deps.budgets
      ?.record(
        { id: `slack-reviewer:${reviewer.id}`, providerId: pick.provider.id, model: pick.model },
        usage,
        config,
      )
      .catch(() => undefined);
  }
  const usd = estimateUsd(usage, resolveUsageRates(pick.provider, pick.model));
  const reply = text.trim();
  if (!reply) return fail("the model returned nothing", { model: modelLabel, usage, usd });
  await ctx.postText(
    reviewJob,
    reply.length > ANSWER_SLACK_MAX ? `${reply.slice(0, ANSWER_SLACK_MAX)}…` : reply,
  );
  return {
    ...base,
    outcome: "answered",
    model: modelLabel,
    usage,
    usd,
    at: new Date(ctx.now()).toISOString(),
  };
}
