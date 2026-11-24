/**
 * Per-publish choice for the harness test gate on git_push / git_pr.
 *
 * - `run`: run the workspace test command first and block the publish on failure (default).
 * - `skip`: publish without running tests. Only an operator can choose it.
 * - `defer`: publish now, then run the tests in the background and post the result.
 *
 * The agent may *request* a skip (`skipTests: true` plus `skipTestsReason`, usually the
 * user's own words) but never grant one: the operator picks on the approval card or on
 * a countdown prompt, and when nobody answers in time the tests run.
 */
export const TEST_GATE_CHOICES = ["run", "skip", "defer"] as const;

export type TestGateChoice = (typeof TEST_GATE_CHOICES)[number];

export const TEST_GATE_CHOICE_LABELS: Record<TestGateChoice, string> = {
  run: "Run tests first",
  skip: "Skip tests",
  defer: "Push now, test after",
};

/** Approval `answer` prefix that carries a test-gate choice for git_push / git_pr. */
export const TEST_GATE_ANSWER_PREFIX = "test-gate:";

/** Synthetic tool-call name for the countdown prompt shown before a slow test gate. */
export const TEST_GATE_PROMPT_TOOL = "test_gate_choice";

/** Default countdown before the prompt falls back to running the tests. */
export const DEFAULT_TEST_GATE_PROMPT_MS = 2 * 60_000;

/** Test runs at least this long (last run, or configured timeout) count as slow. */
export const DEFAULT_TEST_GATE_SLOW_MS = 5 * 60_000;

export function isTestGateChoice(value: unknown): value is TestGateChoice {
  return typeof value === "string" && (TEST_GATE_CHOICES as readonly string[]).includes(value);
}

export function testGateAnswer(choice: TestGateChoice): string {
  return `${TEST_GATE_ANSWER_PREFIX}${choice}`;
}

/** Read a choice from an approval answer; anything else (plain Approve) is `undefined`. */
export function parseTestGateAnswer(answer: string | undefined): TestGateChoice | undefined {
  if (!answer?.startsWith(TEST_GATE_ANSWER_PREFIX)) return undefined;
  const choice = answer.slice(TEST_GATE_ANSWER_PREFIX.length).trim();
  return isTestGateChoice(choice) ? choice : undefined;
}

export function isPublishTool(name: string): name is "git_push" | "git_pr" {
  return name === "git_push" || name === "git_pr";
}

export interface TestGateSkipRequest {
  requested: boolean;
  reason?: string;
}

/** The agent's `skipTests` / `skipTestsReason` arguments on git_push / git_pr. */
export function testGateSkipRequest(
  args: Record<string, unknown> | undefined,
): TestGateSkipRequest {
  const requested = args?.skipTests === true || args?.skipTests === "true";
  const raw = typeof args?.skipTestsReason === "string" ? args.skipTestsReason.trim() : "";
  return requested ? { requested, ...(raw ? { reason: raw.slice(0, 500) } : {}) } : { requested };
}

/** Countdown prompt length from config; at least 15 s, at most 30 min. */
export function testGatePromptMs(raw?: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 15_000) {
    return Math.min(Math.round(raw), 30 * 60_000);
  }
  return DEFAULT_TEST_GATE_PROMPT_MS;
}

/** Slow threshold from config; 0 disables the prompt for slow suites (agent requests still ask). */
export function testGateSlowMs(raw?: number): number {
  if (raw === 0) return 0;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 10_000) return Math.round(raw);
  return DEFAULT_TEST_GATE_SLOW_MS;
}

export interface TestGatePromptInput {
  /** Last observed duration of this workspace's test gate, when known. */
  lastDurationMs?: number;
  /** Configured `verify.test` timeout, when set. */
  configuredTimeoutMs?: number;
  /** `testGateSlowMs` from config (0 = never prompt just for slowness). */
  slowMs: number;
  /** The agent asked to skip tests. */
  skipRequested: boolean;
}

/** Ask the operator before running the gate when the agent asked to skip or the suite is slow. */
export function shouldPromptTestGate(input: TestGatePromptInput): boolean {
  if (input.skipRequested) return true;
  if (!input.slowMs) return false;
  const expected = Math.max(input.lastDurationMs ?? 0, input.configuredTimeoutMs ?? 0);
  return expected >= input.slowMs;
}

/** "~45 min" style estimate for prompts. */
export function formatTestGateDuration(ms: number | undefined): string | undefined {
  if (!ms || ms <= 0) return undefined;
  const minutes = ms / 60_000;
  if (minutes < 1) return `~${Math.max(1, Math.round(ms / 1000))} s`;
  if (minutes < 90) return `~${Math.round(minutes)} min`;
  return `~${(minutes / 60).toFixed(1)} h`;
}

/**
 * The countdown card is operator UI, not a model tool call: keep it out of the
 * model prompt. The operator's choice reaches the model through the publish result.
 */
export function isTestGatePromptMessage(message: { toolCalls?: Array<{ name: string }> }): boolean {
  const calls = message.toolCalls;
  return Boolean(calls?.length) && calls!.every((call) => call.name === TEST_GATE_PROMPT_TOOL);
}
