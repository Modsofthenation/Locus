import { canonicalToolName } from "./models/toolChip.js";
import { execArgCommands } from "./models/tools.js";

/** Workspace inspect rounds before we tell a coding agent to edit. */
export const CODING_SEARCH_WANDER_ROUNDS = 3;
export const MAX_CODING_WANDER_NUDGES = 2;
export const MAX_VERIFY_NUDGES = 2;

export const CODING_LOOP_HABIT =
  "After you edit, run the project's tests before claiming done (prefer the dirty package's npm test / pytest / cargo test / go test). If there is no test script, run typecheck or lint. If that fails, read the FAIL lines, apply a focused patch, and re-run the same command. Prefer the smallest patch that preserves behaviour. Do not stop after the first compile error, and do not grep for more than a couple of rounds once you know the edit.";

export const SEARCH_WANDER_NUDGE =
  "You have searched for several rounds without editing. If you already know the change, call apply_patch or file_write now. Batch remaining reads in one round. Do not grep, glob, or file_read the same files again.";

export const VERIFY_NUDGE =
  "You edited files this turn but did not run tests or typecheck. Call exec with the project's test command (prefer the dirty package). If there is no test script, run lint or typecheck. Do not claim the work is done until it passes, or say the repo has no test command.";

export const CODING_VERIFY_NEEDS_HUMAN =
  "Files were edited this turn but tests/typecheck never ran. Needs a human.";

export const CODING_FAILED_VERIFY_NEEDS_HUMAN =
  "Tests/typecheck failed this turn and never passed. Needs a human.";

export interface CodingLoopMessage {
  role: string;
  content?: string;
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown>; error?: string }>;
}

const MUTATE_TOOLS = new Set(["apply_patch", "file_write"]);
const VERIFY_TOOLS = new Set(["git_push", "git_pr"]);

const VERIFY_COMMAND =
  /\b(npm test|npm run test|npm run typecheck|pnpm(?:\s+run)?\s+test|yarn(?:\s+run)?\s+test|npx vitest|npx jest|pytest|python -m pytest|cargo test|go test|mvn test|gradlew test|rake test|make test|npm run lint|npx tsc|\btypecheck\b|\bvitest\b|\bjest\b)\b/i;

function catalogName(name: string): string {
  return canonicalToolName(name).replace(/^locus-/, "");
}

export function looksLikeVerifyCommand(command: string): boolean {
  return VERIFY_COMMAND.test(command);
}

export function isCodingMutateTool(name: string): boolean {
  return MUTATE_TOOLS.has(catalogName(name));
}

/** A canvas beside the chat is the deliverable, so search-wander should not demand a repo patch. */
export function wroteAgentCanvas(calls: Array<{ name: string; error?: string }>): boolean {
  return calls.some((call) => !call.error && catalogName(call.name) === "canvas_write");
}

export function isCodingVerifyCall(name: string, args?: Record<string, unknown>): boolean {
  const n = catalogName(name);
  if (VERIFY_TOOLS.has(n)) return true;
  if (n !== "exec" && n !== "powershell") return false;
  return execArgCommands(args).some((cmd) => looksLikeVerifyCommand(cmd));
}

/** Mutate clears verify; a later test/push in the same turn restores it. */
export function foldCodingVerifyFlags(
  calls: Array<{ name: string; arguments?: Record<string, unknown> }>,
  prior: { mutated?: boolean; verified?: boolean } = {},
): { mutated: boolean; verified: boolean } {
  let mutated = Boolean(prior.mutated);
  let verified = Boolean(prior.verified);
  for (const call of calls) {
    if (isCodingMutateTool(call.name)) {
      mutated = true;
      verified = false;
    }
    if (isCodingVerifyCall(call.name, call.arguments)) verified = true;
  }
  return { mutated, verified };
}

export function shouldNudgeSearchWander(obs: {
  isCoding?: boolean;
  mutated?: boolean;
  namedOps?: boolean;
  isReview?: boolean;
  searchRounds: number;
  nudges: number;
  planTurn?: boolean;
  stopped?: boolean;
}): boolean {
  const stillSearching = obs.searchRounds >= CODING_SEARCH_WANDER_ROUNDS || obs.nudges > 0;
  return (
    Boolean(obs.isCoding) &&
    !obs.mutated &&
    !obs.namedOps &&
    !obs.isReview &&
    !obs.planTurn &&
    !obs.stopped &&
    stillSearching &&
    obs.nudges < MAX_CODING_WANDER_NUDGES
  );
}

/** A coding turn with untested edits — including edits after the last verify — cannot ship after the verify cap. */
export function codingVerifyNeedsHuman(messages: CodingLoopMessage[]): boolean {
  const flags = foldCodingVerifyFlags(
    sliceAfterLastUser(messages).flatMap((message) => message.toolCalls ?? []),
  );
  return flags.mutated && !flags.verified;
}

/** Last tests/typecheck this turn failed — talking through the self-correct cap cannot ship red. */
export function codingFailedVerifyNeedsHuman(messages: CodingLoopMessage[]): boolean {
  let last: { error?: string } | undefined;
  for (const message of sliceAfterLastUser(messages)) {
    for (const call of message.toolCalls ?? []) {
      if (isCodingVerifyCall(call.name, call.arguments)) last = call;
    }
  }
  return Boolean(last?.error?.trim());
}

export function codingTurnNeedsHuman(messages: CodingLoopMessage[]): string | undefined {
  if (codingVerifyNeedsHuman(messages)) return CODING_VERIFY_NEEDS_HUMAN;
  if (codingFailedVerifyNeedsHuman(messages)) return CODING_FAILED_VERIFY_NEEDS_HUMAN;
  return undefined;
}

function lastUserMessageIndex(messages: CodingLoopMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

function sliceAfterLastUser(messages: CodingLoopMessage[]): CodingLoopMessage[] {
  const lastUser = lastUserMessageIndex(messages);
  return lastUser >= 0 ? messages.slice(lastUser + 1) : messages;
}

export function shouldNudgeVerify(obs: {
  isCoding?: boolean;
  mutated?: boolean;
  verified?: boolean;
  nudges: number;
  planTurn?: boolean;
  stopped?: boolean;
}): boolean {
  return (
    Boolean(obs.isCoding) &&
    Boolean(obs.mutated) &&
    !obs.verified &&
    !obs.planTurn &&
    !obs.stopped &&
    obs.nudges < MAX_VERIFY_NUDGES
  );
}
