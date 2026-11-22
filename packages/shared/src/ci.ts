import type { AgentSession, ToolCall } from "./models/session.js";
import { estimateUsd, type UsageRates } from "./models/session.js";
import { policyEntryMatches } from "./models/approval.js";
import { parseAnyReviewVerdict, type AgentVerdictRisk } from "./verdict.js";

/** `locus ci run` outcomes and their process exit codes. */
export type CiOutcome = "pass" | "fail" | "approval" | "error";

export const CI_EXIT_CODES: Record<CiOutcome, number> = {
  pass: 0,
  fail: 1,
  approval: 2,
  error: 3,
};

export function ciExitCode(outcome: CiOutcome): number {
  return CI_EXIT_CODES[outcome];
}

export const CI_RECIPES = ["pr-reviewer", "repo-fixer"] as const;
export type CiRecipe = (typeof CI_RECIPES)[number];

export function isCiRecipe(value: unknown): value is CiRecipe {
  return value === "pr-reviewer" || value === "repo-fixer";
}

export interface CiTests {
  ran: number;
  /** Last test command result this run, when any ran. */
  passed?: boolean;
  last?: string;
}

export interface CiResult {
  outcome: CiOutcome;
  exitCode: number;
  /** PASS / FAIL from a review verdict, or derived from the run for non-review recipes. */
  verdict: "PASS" | "FAIL" | "NONE";
  reasons: string[];
  risk?: AgentVerdictRisk;
  sessionId?: string;
  recipe?: string;
  model?: string;
  costUsd?: number;
  tokens?: { input: number; output: number };
  tests: CiTests;
  deniedApprovals: Array<{ tool: string; callId: string }>;
  allowedApprovals: Array<{ tool: string; callId: string; rule: string }>;
  pendingApproval?: { tool: string; callId: string };
  pr?: string;
  commentUrl?: string;
  startedAt: string;
  finishedAt: string;
}

export interface ParsedPullUrl {
  host: string;
  owner: string;
  repo: string;
  number: number;
  /** Clone URL for the base repository. */
  repoUrl: string;
}

/** GitHub `/pull/N`, GitLab `/-/merge_requests/N`, Bitbucket `/pull-requests/N`. */
export function parsePullUrl(raw: string): ParsedPullUrl | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  const gh = parts.indexOf("pull");
  const gl = parts.indexOf("merge_requests");
  const bb = parts.indexOf("pull-requests");
  let ownerParts: string[] = [];
  let num = "";
  if (gh >= 2 && parts[gh + 1]) {
    ownerParts = parts.slice(0, gh);
    num = parts[gh + 1]!;
  } else if (gl >= 2 && parts[gl + 1]) {
    ownerParts = parts.slice(0, gl).filter((p) => p !== "-");
    num = parts[gl + 1]!;
  } else if (bb >= 2 && parts[bb + 1]) {
    ownerParts = parts.slice(0, bb);
    num = parts[bb + 1]!;
  } else {
    return undefined;
  }
  const number = Number(num);
  if (!Number.isInteger(number) || number <= 0 || ownerParts.length < 2) return undefined;
  const repo = ownerParts.at(-1)!.replace(/\.git$/, "");
  const owner = ownerParts.slice(0, -1).join("/");
  return {
    host: url.host,
    owner,
    repo,
    number,
    repoUrl: `${url.protocol}//${url.host}/${owner}/${repo}`,
  };
}

const TEST_COMMAND =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|typecheck|lint)\b|\bpytest\b|\bgo\s+test\b|\bcargo\s+test\b|\bvitest\b|\bjest\b|\bmake\s+(test|check)\b|\bmvn\s+(test|verify)\b|\bgradle\w*\s+test\b/;

function commandOf(call: ToolCall): string {
  const args = call.arguments ?? {};
  const cmd = args.command ?? args.cmd ?? args.script;
  return typeof cmd === "string" ? cmd : Array.isArray(cmd) ? cmd.join(" ") : "";
}

export function ciTestsFromSession(session: Pick<AgentSession, "messages">): CiTests {
  let ran = 0;
  let passed: boolean | undefined;
  let last: string | undefined;
  for (const message of session.messages) {
    for (const call of message.toolCalls ?? []) {
      if (call.name !== "exec" && call.name !== "powershell") continue;
      const command = commandOf(call);
      if (!TEST_COMMAND.test(command)) continue;
      if (call.result === undefined && call.error === undefined) continue;
      ran += 1;
      passed = !call.error;
      last = command.slice(0, 200);
    }
  }
  return { ran, passed, last };
}

/** Newest tool call still waiting on Approve / Deny. */
export function ciPendingApproval(session: Pick<AgentSession, "messages">): ToolCall | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const hit = session.messages[i]?.toolCalls?.find((call) => call.approval === "needed");
    if (hit) return hit;
  }
  return undefined;
}

/** First `--allow` rule (param-permission syntax, e.g. `git_push(branch:locus/*)`) matching a call. */
export function ciAllowRuleFor(
  rules: string[],
  call: Pick<ToolCall, "name" | "arguments">,
): string | undefined {
  return rules.find((rule) => policyEntryMatches(rule, call.name, call.arguments ?? {}));
}

export function ciCostUsd(
  session: Pick<AgentSession, "usage">,
  rates?: UsageRates,
): number | undefined {
  if (!session.usage) return undefined;
  return estimateUsd(session.usage, rates);
}

/**
 * Map a finished (or stopped) CI session to an outcome. Error beats approval beats verdict.
 * Review recipes use the typed verdict (FAIL or high risk fails). Other recipes fail on a
 * Needs-you gate (including "Budget reached") or a red last test run.
 */
export function ciOutcome(input: {
  session?: Pick<AgentSession, "kind" | "messages" | "status" | "needsHuman" | "error">;
  error?: string;
  pending?: boolean;
}): Pick<CiResult, "outcome" | "verdict" | "reasons" | "risk"> {
  if (input.error || !input.session) {
    return { outcome: "error", verdict: "NONE", reasons: [input.error || "No session"] };
  }
  const session = input.session;
  if (input.pending) {
    return {
      outcome: "approval",
      verdict: "NONE",
      reasons: ["Stopped while a tool call was waiting for approval"],
    };
  }
  if (session.status === "error") {
    return {
      outcome: "error",
      verdict: "NONE",
      reasons: [session.error?.trim() || "Session failed"],
    };
  }
  if (session.kind === "review") {
    const verdict = parseAnyReviewVerdict(session.messages);
    if (!verdict) {
      return {
        outcome: "fail",
        verdict: "NONE",
        reasons: [session.needsHuman?.trim() || "Reviewer did not return a verdict"],
      };
    }
    const failed = verdict.verdict === "FAIL" || verdict.risk === "high";
    return {
      outcome: failed ? "fail" : "pass",
      verdict: verdict.verdict,
      reasons: verdict.reasons,
      risk: verdict.risk,
    };
  }
  const tests = ciTestsFromSession(session);
  const reasons: string[] = [];
  if (session.needsHuman?.trim()) reasons.push(session.needsHuman.trim());
  if (tests.ran > 0 && tests.passed === false) reasons.push(`Tests failed: ${tests.last ?? ""}`);
  return reasons.length
    ? { outcome: "fail", verdict: "FAIL", reasons }
    : { outcome: "pass", verdict: "PASS", reasons: [] };
}

export function formatCiComment(result: CiResult): string {
  const head =
    result.verdict === "NONE"
      ? `**Locus CI:** ${result.outcome}`
      : `**Locus review:** ${result.verdict}${result.risk ? ` (risk ${result.risk})` : ""}`;
  const reasons = result.reasons.length
    ? result.reasons.map((reason) => `- ${reason.replace(/\r?\n/g, " ")}`).join("\n")
    : "- No blocking findings.";
  const cost = typeof result.costUsd === "number" ? ` · est. $${result.costUsd.toFixed(2)}` : "";
  const tokens = result.tokens ? ` · ${result.tokens.input + result.tokens.output} tokens` : "";
  return `${head}\n\n${reasons}\n\n<sub>locus ci run${result.model ? ` · ${result.model}` : ""}${cost}${tokens}</sub>`;
}
