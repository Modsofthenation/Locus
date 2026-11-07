import { stripHtmlDocumentFromChat } from "./models/canvasStream.js";

export type AgentVerdictRisk = "low" | "high";
export type AgentVerdictValue = "PASS" | "FAIL";

export interface AgentVerdict {
  verdict: AgentVerdictValue;
  reasons: string[];
  risk: AgentVerdictRisk;
}

export interface ReviewVerdictMessage {
  role: string;
  content?: string;
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
}

export const MAX_REVIEW_VERDICT_NUDGES = 1;

export const REVIEW_VERDICT_NUDGE =
  'This is still a review session. Do not implement the findings or load ship-it — that is Fix with agent. Reply with ONLY a JSON object {"verdict":"PASS"|"FAIL","reasons":[],"risk":"low"|"high"}.';

export function parseAgentVerdict(raw: string): AgentVerdict | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const found = verdictJsonSpans(trimmed).map((row) => row.verdict);
  const fail = [...found].reverse().find((row) => row.verdict === "FAIL");
  return fail ?? found.at(-1);
}

/** Remove harness verdict JSON (and wrapping ```json fences) from operator-facing chat. */
export function stripReviewVerdictJson(text: string): string {
  const spans = verdictJsonSpans(text);
  if (!spans.length) return text;
  const pieces: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    const { start, end } = expandVerdictFence(text, span.start, span.end + 1);
    pieces.push(text.slice(cursor, start));
    cursor = end;
  }
  pieces.push(text.slice(cursor));
  return pieces
    .join("")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Assistant chat the operator should see: prose, or a short summary when the model emitted only JSON. */
export function visibleReviewAssistantText(text: string): string {
  const stripped = stripReviewVerdictJson(text);
  if (stripped) return stripped;
  const verdict = parseAgentVerdict(text);
  if (!verdict) return text.trim();
  return formatReviewOperatorSummary(verdict);
}

export function operatorVisibleText(role: string, content: string): string {
  if (role !== "assistant") return content;
  return visibleReviewAssistantText(stripHtmlDocumentFromChat(content));
}

export function formatReviewOperatorSummary(verdict: AgentVerdict): string {
  if (verdict.verdict === "PASS" && !verdict.reasons.length) {
    return `Reviewer PASS (risk ${verdict.risk}).`;
  }
  const reasons = verdict.reasons.length ? verdict.reasons.join("; ") : "no reasons given";
  return `Reviewer ${verdict.verdict} (risk ${verdict.risk}): ${reasons}`;
}

/** Scan assistant text (newest first), then git_pr_review event as a fallback. */
export function parseAnyReviewVerdict(messages: ReviewVerdictMessage[]): AgentVerdict | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const parsed = parseAgentVerdict(message.content ?? "");
    if (parsed) return parsed;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    for (const call of messages[i]?.toolCalls ?? []) {
      if (forgeToolNameFromCall(call) !== "git_pr_review") continue;
      const fromArgs = verdictFromReviewEvent(reviewEventFromCall(call));
      if (fromArgs) {
        const body = typeof call.arguments?.body === "string" ? call.arguments.body.trim() : "";
        return {
          ...fromArgs,
          reasons: fromArgs.reasons.length
            ? fromArgs.reasons
            : body
              ? [body.slice(0, 240)]
              : fromArgs.reasons,
        };
      }
    }
  }
  return undefined;
}

/** Scan this turn's assistant text (newest first), then git_pr_review event as a fallback. */
export function parseReviewSessionVerdict(
  messages: ReviewVerdictMessage[],
): AgentVerdict | undefined {
  return parseAnyReviewVerdict(sliceAfterLastUser(messages));
}

export function isReviewProgressTool(name: string): boolean {
  const normalized = normalizeReviewToolName(name);
  return (
    normalized === "git_pr_get" ||
    normalized === "git_pr_loadpath" ||
    normalized === "git_pr_comment" ||
    normalized === "git_pr_review"
  );
}

export function turnCalledReviewTools(messages: ReviewVerdictMessage[]): boolean {
  return sliceAfterLastUser(messages).some((message) =>
    (message.toolCalls ?? []).some((call) => isReviewProgressTool(forgeToolNameFromCall(call))),
  );
}

/** First review, or this turn actually reviewed, must produce a verdict. Follow-up chatter after a prior verdict does not. */
export function shouldApplyReviewVerdict(messages: ReviewVerdictMessage[]): boolean {
  if (parseReviewSessionVerdict(messages)) return true;
  if (turnCalledReviewTools(messages)) return true;
  const lastUser = lastUserMessageIndex(messages);
  if (lastUser <= 0) return true;
  return !parseAnyReviewVerdict(messages.slice(0, lastUser));
}

export function shouldNudgeMissingReviewVerdict(obs: {
  isReview: boolean;
  hasVerdict: boolean;
  applyThisTurn: boolean;
  nudges: number;
  planTurn?: boolean;
  stopped?: boolean;
}): boolean {
  return (
    obs.isReview &&
    !obs.hasVerdict &&
    obs.applyThisTurn &&
    !obs.planTurn &&
    !obs.stopped &&
    obs.nudges < MAX_REVIEW_VERDICT_NUDGES
  );
}

export function forgeToolNameFromCall(call: {
  name: string;
  arguments?: Record<string, unknown>;
}): string {
  if (call.name !== "mcp" && call.name !== "tool") return normalizeReviewToolName(call.name);
  const args = call.arguments ?? {};
  for (const key of ["name", "toolName", "tool"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return normalizeReviewToolName(value);
  }
  return normalizeReviewToolName(call.name);
}

function lastUserMessageIndex(messages: ReviewVerdictMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

function sliceAfterLastUser(messages: ReviewVerdictMessage[]): ReviewVerdictMessage[] {
  const lastUser = lastUserMessageIndex(messages);
  return lastUser >= 0 ? messages.slice(lastUser + 1) : messages;
}

function normalizeReviewToolName(name: string): string {
  const trimmed = name.trim();
  const unprefixed = trimmed.replace(/^locus[-_]/i, "");
  return /^(git_pr_|git_)/.test(unprefixed) ? unprefixed : trimmed;
}

function reviewEventFromCall(call: { arguments?: Record<string, unknown> }): unknown {
  const args = call.arguments ?? {};
  if (args.event != null) return args.event;
  const nested = args.arguments;
  if (nested && typeof nested === "object" && nested !== null && "event" in nested) {
    return (nested as { event?: unknown }).event;
  }
  return undefined;
}

export function isCleanPass(verdict?: AgentVerdict): boolean {
  return Boolean(verdict && verdict.verdict === "PASS" && verdict.risk === "low");
}

/** A guessed PASS this turn cannot ship until git_pr_get / loadpath / comment / review actually ran. */
export function reviewPassNeedsInspect(messages: ReviewVerdictMessage[]): boolean {
  if (!shouldApplyReviewVerdict(messages)) return false;
  if (!isCleanPass(parseReviewSessionVerdict(messages))) return false;
  return !turnCalledReviewTools(messages);
}

export const REVIEW_PASS_NEEDS_INSPECT =
  'Reviewer PASS (risk low) without git_pr_get. Inspect the PR with git_pr_get include=["files"] before a passing verdict can ship.';

export function formatVerdictFailure(verdict?: AgentVerdict): string {
  if (!verdict) {
    return "Reviewer output was not valid JSON ({ verdict, reasons, risk }). Needs a human.";
  }
  const reasons = verdict.reasons.length ? verdict.reasons.join("; ") : "no reasons given";
  const summary = `Reviewer ${verdict.verdict} (risk ${verdict.risk}): ${reasons}`;
  return verdict.verdict === "FAIL" ? `${summary} Use Fix with agent to implement.` : summary;
}

export const REVIEW_VERDICT_CONTRACT = [
  "Include a JSON object {verdict, reasons, risk} so the harness can parse it — on its own last line, not mixed into the operator summary. The UI hides that JSON.",
  'A passing review looks exactly like this: {"verdict":"PASS","reasons":[],"risk":"low"}',
  "Allowed values: verdict is PASS or FAIL (APPROVE counts as PASS; REQUEST_CHANGES counts as FAIL); risk is low or high (case-insensitive); reasons holds one short string per reason, and is empty only on a clean PASS.",
  "Operator-facing chat stays prose. If you must narrate, still include that JSON object on its own last line so the harness can parse it.",
  '"Looks fine" is not PASS. Tests must actually pass, and the change must do only what was asked. Any public behaviour change is risk: "high".',
].join(" ");

function verdictFromRecord(parsed: Record<string, unknown>): AgentVerdict | undefined {
  const verdict = normalizeVerdictValue(parsed.verdict);
  const risk = normalizeRisk(parsed.risk);
  if (!verdict || !risk) return undefined;
  const reasons = Array.isArray(parsed.reasons)
    ? parsed.reasons.filter((item): item is string => typeof item === "string")
    : [];
  return { verdict, reasons, risk };
}

function normalizeVerdictValue(raw: unknown): AgentVerdictValue | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toUpperCase().replace(/-/g, "_");
  if (value === "PASS" || value === "APPROVE") return "PASS";
  if (value === "FAIL" || value === "REQUEST_CHANGES" || value === "CHANGES_REQUESTED") {
    return "FAIL";
  }
  return undefined;
}

function normalizeRisk(raw: unknown): AgentVerdictRisk | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "low") return "low";
  if (value === "high") return "high";
  return undefined;
}

function verdictFromReviewEvent(event: unknown): AgentVerdict | undefined {
  const verdict = normalizeVerdictValue(event);
  if (verdict === "PASS") return { verdict: "PASS", reasons: [], risk: "low" };
  if (verdict === "FAIL") {
    return { verdict: "FAIL", reasons: ["git_pr_review requested changes"], risk: "high" };
  }
  return undefined;
}

function verdictJsonSpans(
  text: string,
): Array<{ start: number; end: number; verdict: AgentVerdict }> {
  const found: Array<{ start: number; end: number; verdict: AgentVerdict }> = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    const end = matchingBraceEnd(text, i);
    if (end == null) continue;
    try {
      const parsed = JSON.parse(text.slice(i, end + 1)) as Record<string, unknown>;
      const verdict = verdictFromRecord(parsed);
      if (verdict) {
        found.push({ start: i, end, verdict });
        i = end;
      }
    } catch {
      /* keep scanning */
    }
  }
  return found;
}

function expandVerdictFence(
  text: string,
  start: number,
  endExclusive: number,
): { start: number; end: number } {
  let from = start;
  let to = endExclusive;
  const before = text.slice(0, start);
  const open = before.match(/```(?:json)?[ \t]*\r?\n?$/i);
  if (open) from = start - open[0].length;
  const after = text.slice(to);
  const close = after.match(/^[ \t]*\r?\n?```/);
  if (close) to += close[0].length;
  return { start: from, end: to };
}

function matchingBraceEnd(text: string, start: number): number | undefined {
  if (text[start] !== "{") return undefined;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return undefined;
}
