/**
 * The model side of a Slack review: `runReviewModel` (one completion, or an API tool loop over the
 * checkout, with the cost cap) and `verifyReviewFindings` (the second look at blocker / major
 * findings). Both take what they need explicitly instead of the service.
 */
import { randomUUID } from "node:crypto";
import {
  estimateUsd,
  resolveUsageRates,
  reviewPlural,
  slackReviewOutputTokens,
  SLACK_REVIEW_CHECKOUT_TOOLS,
  SLACK_REVIEW_CHECKOUT_TOOL_NAMES,
  SLACK_REVIEW_TOOL_BUDGET_SPENT,
  type AiProvider,
  type ChatMessage,
  type LocusConfig,
  type SlackReviewer,
  type TokenUsage,
  applySlackVerification,
  buildSlackVerifyMessage,
  parseSlackVerifyResult,
  slackFindingsToVerify,
  slackReviewVerifyOutputTokens,
  slackVerifyHunk,
  slackVerifyWindow,
  SLACK_REVIEW_VERIFY_SYSTEM,
  type PullFile,
  type SlackReviewComment,
  type SlackReviewVerification,
  type SlackVerifyItem,
} from "@locus/shared";
import type { OneShotTraceEvent } from "@locus/providers";
import type { SlackReviewTraceRecorder } from "./reviewTrace.js";
import { REVIEW_TOOL_OUTPUT_MAX, type ReviewCheckout } from "./reviewCheckout.js";
import type { SlackReviewerComplete, SlackReviewerDeps } from "./reviewerDeps.js";
import { addUsage, pickVerifyProvider, errorText } from "./reviewerHelpers.js";

export const REVIEW_TIMEOUT_MS = 180_000;
/** No token limits: a whole large diff and a long reply take longer. */
export const UNLIMITED_REVIEW_TIMEOUT_MS = 600_000;
/** CLI agents start a process, load their config, and sign in before answering. */
export const CLI_REVIEW_TIMEOUT_MS = 300_000;
/** Reading around a checkout takes several rounds (or a CLI exploring on its own). */
export const CHECKOUT_REVIEW_TIMEOUT_MS = 600_000;

/** What `verifyReviewFindings` needs from the service. */
export interface ReviewModelContext {
  complete: SlackReviewerComplete;
  /** Daily spend ledger; verification spend is recorded here. */
  budgets?: SlackReviewerDeps["budgets"];
}

/**
 * `verifyFindings`: one small tool-less completion that confirms, downgrades or rejects each
 * blocker / major finding, given the code around its line (from the clone when it was read,
 * otherwise the diff hunk). Runs on `verifyProviderId` / `verifyModel` when set, else on the
 * review's own provider and model, through the same completion path (a CLI agent runs once in
 * an empty scratch folder). Spend goes to the budget ledger here; the caller adds it to the
 * review's usage. Any failure returns the findings unchanged with `verification.failed`.
 */
export async function verifyReviewFindings(
  ctx: ReviewModelContext,
  input: {
    reviewer: SlackReviewer;
    config: LocusConfig;
    pick: { provider: AiProvider; model: string; cli: boolean };
    findings: SlackReviewComment[];
    files: PullFile[];
    sources: Map<string, string>;
    pull: { owner: string; repo: string; number: number; title?: string };
    trace?: SlackReviewTraceRecorder;
  },
): Promise<{
  comments: SlackReviewComment[];
  verification: SlackReviewVerification;
  usage: TokenUsage & { cacheWriteTokens?: number };
  usd?: number;
  model: string;
}> {
  const { reviewer, findings, trace } = input;
  const pick = pickVerifyProvider(input.config, reviewer, input.pick);
  const modelLabel = pick.model || `${pick.provider.name} default`;
  const toCheck = slackFindingsToVerify(findings);
  const patches = new Map(input.files.map((row) => [row.path, row.patch]));
  const items: SlackVerifyItem[] = toCheck.map((finding) => {
    const source = input.sources.get(finding.path);
    const window = source !== undefined ? slackVerifyWindow(source, finding.line) : undefined;
    if (window) return { finding, code: window.text, source: "checkout" };
    const hunk = finding.line ? slackVerifyHunk(patches.get(finding.path), finding.line) : "";
    return hunk ? { finding, code: hunk, source: "diff" } : { finding, code: "", source: "none" };
  });
  const user = buildSlackVerifyMessage(items, input.pull);
  const usage: TokenUsage & { cacheWriteTokens?: number } = { inputTokens: 0, outputTokens: 0 };
  const unchanged = (reason: string) => {
    trace?.note(`Verification failed, posting the findings unchecked: ${reason}`);
    return {
      comments: findings,
      verification: { checked: toCheck.length, rejected: {}, downgraded: 0, failed: true },
      usage,
      model: modelLabel,
    };
  };
  trace?.note(
    `Verifying ${reviewPlural(toCheck.length, "blocker / major finding")} with ${modelLabel}`,
  );
  trace?.prompt(user);
  let text = "";
  let failure: string | undefined;
  try {
    for await (const event of ctx.complete(
      {
        provider: pick.provider,
        model: pick.model,
        system: SLACK_REVIEW_VERIFY_SYSTEM,
        messages: [
          {
            id: `slack-review-${randomUUID()}`,
            role: "user",
            content: user,
            createdAt: new Date().toISOString(),
          },
        ],
        allowedTools: [],
        maxTokens: slackReviewVerifyOutputTokens(toCheck.length),
        signal: AbortSignal.timeout(pick.cli ? CLI_REVIEW_TIMEOUT_MS : REVIEW_TIMEOUT_MS),
      },
      trace && pick.cli ? { onTrace: (event) => trace.cli(event) } : undefined,
    )) {
      trace?.event(event);
      if (event.type === "text") text += event.text;
      else if (event.type === "usage") addUsage(usage, event);
    }
  } catch (err) {
    failure = `the model call failed (${errorText(err)})`;
  }
  const usd = estimateUsd(usage, resolveUsageRates(pick.provider, pick.model));
  await ctx.budgets
    ?.record(
      { id: `slack-reviewer:${reviewer.id}`, providerId: pick.provider.id, model: pick.model },
      usage,
      input.config,
    )
    .catch(() => undefined);
  if (failure) return { ...unchanged(failure), usd };
  let decisions: ReturnType<typeof parseSlackVerifyResult>;
  try {
    decisions = parseSlackVerifyResult(text);
  } catch (err) {
    return { ...unchanged(errorText(err)), usd };
  }
  const applied = applySlackVerification(
    findings,
    toCheck.map((row) => row.id!),
    decisions,
  );
  trace?.note(
    `Verification: ${
      decisions
        .map(
          (row) =>
            `#${row.id} ${row.status === "downgrade" ? `downgraded to ${row.severity}` : row.status}${row.quote ? ` (${JSON.stringify(row.quote.slice(0, 120))})` : ""}`,
        )
        .join("; ") || "no answers, findings kept"
    }`,
  );
  return { ...applied, usage, usd, model: modelLabel };
}

/**
 * The model side of one review. Without a checkout (or for a CLI agent, which explores the
 * checkout itself) it is one completion. An API model with a checkout gets read-only tools over
 * it for up to `maxToolRounds` rounds, then one more round to answer; the reply is the text of
 * the last round. Usage accumulates into `usage` so a failure still reports what was spent. With
 * `maxCostUsd` set, reaching it ends the lookups early the same way the round budget does.
 */
export async function runReviewModel(
  complete: SlackReviewerComplete,
  input: {
    reviewer: SlackReviewer;
    pick: { provider: AiProvider; model: string; cli: boolean };
    system: string;
    user: string;
    checkout?: ReviewCheckout;
    usage: TokenUsage & { cacheWriteTokens?: number };
    trace?: SlackReviewTraceRecorder;
  },
): Promise<{ text: string; lookups: number; capped: boolean }> {
  const { reviewer, pick, system, user, checkout, usage, trace } = input;
  const timeoutMs = checkout
    ? CHECKOUT_REVIEW_TIMEOUT_MS
    : reviewer.unlimitedTokens
      ? UNLIMITED_REVIEW_TIMEOUT_MS
      : pick.cli
        ? CLI_REVIEW_TIMEOUT_MS
        : REVIEW_TIMEOUT_MS;
  const tools = checkout && !pick.cli;
  const rates = resolveUsageRates(pick.provider, pick.model);
  const overCap = (extra?: TokenUsage) => {
    if (!(reviewer.maxCostUsd > 0)) return false;
    const usd = estimateUsd(
      extra
        ? {
            ...usage,
            inputTokens: usage.inputTokens + extra.inputTokens,
            outputTokens: usage.outputTokens + extra.outputTokens,
            cachedInputTokens: (usage.cachedInputTokens ?? 0) + (extra.cachedInputTokens ?? 0),
          }
        : usage,
      rates,
    );
    return usd !== undefined && usd >= reviewer.maxCostUsd;
  };
  // A CLI agent explores on its own in one run, so the only way to hold it to the cost cap is to
  // stop the run when its running usage reaches it. That works only for CLIs that report usage
  // while they run; others are bounded by the timeout alone.
  const costStop = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), costStop.signal]);
  const onUsage =
    pick.cli && reviewer.maxCostUsd > 0
      ? (running: TokenUsage) => {
          if (overCap(running)) costStop.abort(new Error("cost cap"));
        }
      : undefined;
  const messages: ChatMessage[] = [
    {
      id: `slack-review-${randomUUID()}`,
      role: "user",
      content: user,
      createdAt: new Date().toISOString(),
    },
  ];
  let lookups = 0;
  let capped = false;
  // Tool rounds, one answer round, and one grace round for a model that keeps calling tools.
  const maxRounds = tools ? reviewer.maxToolRounds + 2 : 1;
  // The round after which tool calls are refused: the round budget, or earlier at the cost cap.
  let lastToolRound = reviewer.maxToolRounds;
  for (let round = 0; round < maxRounds; round++) {
    let text = "";
    const calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    try {
      for await (const event of complete(
        {
          provider: pick.provider,
          model: pick.model,
          system,
          messages,
          allowedTools: [],
          ...(tools ? { extraTools: SLACK_REVIEW_CHECKOUT_TOOLS } : {}),
          // Streaming keeps a long, uncapped reply from hitting an HTTP timeout.
          stream: reviewer.unlimitedTokens,
          maxTokens: slackReviewOutputTokens(reviewer),
          signal,
        },
        pick.cli && (checkout || onUsage || trace)
          ? {
              ...(checkout ? { workspace: checkout.dir } : {}),
              ...(onUsage ? { onUsage } : {}),
              ...(trace ? { onTrace: (event: OneShotTraceEvent) => trace.cli(event) } : {}),
            }
          : undefined,
      )) {
        if (costStop.signal.aborted) break;
        trace?.event(event);
        if (event.type === "text") text += event.text;
        else if (event.type === "tool_call") {
          calls.push(event);
          trace?.toolCall(event);
        } else if (event.type === "usage") addUsage(usage, event);
      }
    } catch (err) {
      // The cost cap aborted the CLI: say that, not "aborted", which would look temporary.
      if (!costStop.signal.aborted) throw err;
    }
    if (costStop.signal.aborted) {
      throw new Error(
        `the CLI agent reached the $${reviewer.maxCostUsd.toFixed(2)} cost cap before it answered`,
      );
    }
    if (!tools || !calls.length) return { text, lookups, capped };
    if (round + 1 < lastToolRound && overCap()) {
      // Spent the cap: this round's calls are the last ones run.
      capped = true;
      lastToolRound = round + 1;
    }
    const stamp = new Date().toISOString();
    messages.push({
      id: `slack-review-${randomUUID()}`,
      role: "assistant",
      content: text,
      toolCalls: calls.map((call) => ({ ...call, startedAt: stamp })),
      createdAt: stamp,
    });
    // Past the budget, tool calls are answered with "answer now" instead of being run.
    const refuse = round >= lastToolRound;
    const spent = round + 1 >= lastToolRound;
    for (const call of calls) {
      let output: string;
      let refused = false;
      if (refuse) {
        output = SLACK_REVIEW_TOOL_BUDGET_SPENT;
        refused = true;
      } else if (!SLACK_REVIEW_CHECKOUT_TOOL_NAMES.has(call.name)) {
        output = `Tool ${call.name} is not available in this review. Use read_file, list_dir, find_files or grep.`;
        refused = true;
      } else {
        lookups++;
        const result = await checkout!.run(call.name, call.arguments ?? {});
        output = (result.output || "(empty)").slice(0, REVIEW_TOOL_OUTPUT_MAX + 200);
      }
      trace?.toolResult({
        id: call.id,
        tool: call.name,
        output,
        ...(refused ? { refused } : {}),
      });
      messages.push({
        id: `slack-review-${randomUUID()}`,
        role: "tool",
        toolCallId: call.id,
        content: output,
        createdAt: new Date().toISOString(),
      });
    }
    if (spent) {
      // Tell the model on the last tool result so the conversation still alternates correctly.
      const last = messages.at(-1)!;
      if (!last.content.includes(SLACK_REVIEW_TOOL_BUDGET_SPENT)) {
        last.content = `${last.content}\n\n${SLACK_REVIEW_TOOL_BUDGET_SPENT}`;
      }
    }
  }
  throw new Error(`no answer after ${reviewer.maxToolRounds} rounds of reading the checkout`);
}
