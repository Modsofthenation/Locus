/**
 * What `SlackReviewerService` is built from (Slack, forge, completion, budgets, clocks), and the
 * context it hands the thread-watching, auto-review and answer modules so they can reach its
 * queue and Slack posts without the class.
 */
import type {
  AiProvider,
  DailyBudgetStatus,
  ProviderUsage,
  GitForgeAccount,
  LocusConfig,
  ParsedPullUrl,
  SlackReviewer,
  SlackReviewerStatusTemplates,
  TokenUsage,
} from "@locus/shared";
import type { ChatEvent, CompleteRequest, OneShotTraceEvent } from "@locus/providers";
import type { JsonStore } from "../core/store.js";
import type { BudgetSessionRef } from "../core/budgets.js";
import type { ForgeClient } from "../git/forge.js";
import type { SlackGateway } from "./slackGateway.js";
import type { ReviewCheckout, ReviewCheckoutInput } from "./reviewCheckout.js";
import type { ReviewSandboxOptions } from "./reviewSandbox.js";
import type { ReviewJob, AnswerJob, StateFile } from "./reviewerState.js";

export type SlackReviewerSlack = Pick<SlackGateway, "peekHistory" | "replies" | "post" | "react"> &
  Partial<Pick<SlackGateway, "onChannelMessage">>;
/**
 * Everything but `getPull` and `postReview` is optional: without them a review uses the whole
 * diff, no repo guidelines from the forge, no linked issues, no CI logs, and leaves fixed
 * findings' threads open.
 */
export type SlackReviewerForge = Pick<ForgeClient, "getPull" | "postReview"> &
  Partial<
    Pick<
      ForgeClient,
      | "compareCommits"
      | "readFile"
      | "getIssue"
      | "ciReport"
      | "resolveReviewThreads"
      | "listPulls"
      | "listRepos"
    >
  > &
  /** Only for "Propose as REVIEW.md": branch, commit and open a PR. */
  Partial<Pick<ForgeClient, "listBranches" | "createPull" | "commitFileToNewBranch">>;
/**
 * `workspace`: a CLI agent runs in that checkout instead of an empty scratch folder. `onUsage`
 * gets running token usage, so a review can stop at its cost cap. `onTrace` gets a CLI agent's
 * reasoning and tool calls for the run's trace.
 */
export type SlackReviewerComplete = (
  req: CompleteRequest,
  opts?: {
    workspace?: string;
    onUsage?: (usage: TokenUsage) => void;
    onTrace?: (event: OneShotTraceEvent) => void;
  },
) => AsyncIterable<ChatEvent>;

export interface SlackReviewerDeps {
  slack: SlackReviewerSlack;
  forge?: SlackReviewerForge;
  complete?: SlackReviewerComplete;
  /** Daily spend ledger, so reviewer tokens count against the global budget caps. */
  budgets?: {
    record(ref: BudgetSessionRef, delta: TokenUsage, config: LocusConfig): Promise<void>;
    /** Today's spend and caps, for the provider usage at the end of the usage line. */
    status?(config: LocusConfig): Promise<DailyBudgetStatus>;
  };
  /** Plan usage of an agent CLI's account, shown at the end of the usage line. */
  readProviderUsage?: (provider: AiProvider) => Promise<ProviderUsage>;
  /** Resolve a forge account to one with a fresh token. Tests swap this. */
  freshForgeToken?: (account: GitForgeAccount) => Promise<GitForgeAccount>;
  fetch?: typeof fetch;
  now?: () => number;
  /** CLI prompt ceiling override (tests). Defaults to this OS's command-line limit. */
  cliPromptLimit?: number;
  /** Base interval for reading each channel, replacing Settings → Polling (tests). */
  channelPollMs?: number;
  /** Base interval for checking review threads, replacing Settings → Polling (tests). */
  threadPollMs?: number;
  /** Clone the PR head for a review that looks beyond the diff. Tests swap this. */
  checkout?: (input: ReviewCheckoutInput) => Promise<ReviewCheckout>;
  /** How often a watched thread's PR is checked for merged or closed. Default 10 min. */
  pullStatePollMs?: number;
  /** Wait before the one automatic retry of a review that failed on a passing error. Default 30 s. */
  retryDelayMs?: number;
  /** Sleep, for the retry wait. Tests swap this. */
  sleep?: (ms: number) => Promise<void>;
  /** Base interval for `autoReview` listing open PRs, replacing Settings → Polling (tests). */
  autoReviewPollMs?: number;
  /** CLI sandbox probe, env and spawner for the default `complete`. Tests swap this. */
  cliSandbox?: ReviewSandboxOptions;
}

/**
 * The parts of `SlackReviewerService` that `reviewerThreads.ts`, `reviewerAutoReview.ts` and
 * `reviewerAnswer.ts` use. The service builds one in its constructor; the sets and maps are its
 * own, shared by reference.
 */
export interface SlackReviewerContext {
  readonly store: JsonStore;
  readonly deps: SlackReviewerDeps;
  readonly forge: SlackReviewerForge;
  now(): number;
  /** Reviews queued or running, by `<reviewer id>:<PR key>` (dry runs add `:dry`). */
  readonly pending: ReadonlySet<string>;
  /** Status lines this process posted, so a reviewer never answers itself. */
  readonly ownPosts: ReadonlySet<string>;
  /** Last `autoReview` poll per reviewer id. */
  readonly lastAutoPoll: Map<string, number>;
  /** Repos each forge account can see (`owner/name`), for `autoReview` globs, by account id. */
  readonly accountRepos: Map<string, { at: number; repos: string[] }>;
  enqueue(job: ReviewJob): Promise<void>;
  enqueueAnswer(job: AnswerJob): void;
  say(
    job: ReviewJob,
    template: keyof SlackReviewerStatusTemplates,
    vars: Record<string, string | number | undefined>,
    prefix?: string,
  ): Promise<string | undefined>;
  postText(job: ReviewJob, text: string): Promise<string | undefined>;
  postToChannel(reviewer: SlackReviewer, text: string): Promise<string | undefined>;
  readPull(
    pr: ParsedPullUrl,
  ): Promise<Awaited<ReturnType<SlackReviewerForge["getPull"]>> | undefined>;
  noteSlackError(err: unknown): boolean;
  complete: SlackReviewerComplete;
  forgeAccount(
    config: LocusConfig,
    pr: Pick<ParsedPullUrl, "host" | "repoUrl">,
  ): Promise<GitForgeAccount>;
  loadState(): Promise<StateFile>;
}
