import { canonicalToolName } from "./models/toolChip.js";
import { execArgCommands } from "./models/tools.js";
import { patchFilesFromTool } from "./patch.js";

/** Workspace inspect rounds before we tell a coding agent to edit. */
export const CODING_SEARCH_WANDER_ROUNDS = 3;
export const MAX_CODING_WANDER_NUDGES = 2;
export const MAX_VERIFY_NUDGES = 2;

export const CODING_LOOP_HABIT =
  "After you edit, run the project's tests before claiming done (prefer the dirty package's npm test / pytest / cargo test / go test). If there is no test script, run typecheck or lint. If that fails, read the FAIL lines, apply a focused patch, and re-run the same command. Prefer the smallest patch that preserves behaviour. Do not stop after the first compile error, do not grep for more than a couple of rounds once you know the edit, and do not edit files after the last test run. For symbol navigation prefer code_definition / code_references over grep (they follow imports and skip same-named strings), and use code_rename instead of hand-patching every call site.";

export const SEARCH_WANDER_NUDGE =
  "You have searched for several rounds without editing. If you already know the change, call apply_patch or file_write now. Batch remaining reads in one round. Do not grep, glob, or file_read the same files again.";

export const VERIFY_NUDGE =
  "You edited files this turn but did not run tests or typecheck after the last edit. Call exec with the project's test command (prefer the dirty package). If there is no test script, run lint or typecheck. Do not edit files after that command. Do not claim the work is done until it passes, or say the repo has no test command.";

export const CODING_VERIFY_NEEDS_HUMAN =
  "Files were edited this turn but tests/typecheck never ran. Needs a human.";

export const CODING_FAILED_VERIFY_NEEDS_HUMAN =
  "Tests/typecheck failed this turn and never passed. Needs a human.";

export interface CodingLoopToolCall {
  name: string;
  arguments?: Record<string, unknown>;
  error?: string;
}

export interface CodingLoopMessage {
  role: string;
  content?: string;
  toolCalls?: CodingLoopToolCall[];
}

const MUTATE_TOOLS = new Set(["apply_patch", "file_write", "code_rename"]);
const VERIFY_TOOLS = new Set(["git_push", "git_pr"]);

const VERIFY_COMMAND =
  /\b(npm test|npm run test|npm run typecheck|pnpm(?:\s+run)?\s+test|yarn(?:\s+run)?\s+test|npx vitest|npx jest|pytest|python3?\s+-m\s+(?:pytest|unittest|py_compile)|manage\.py test|django-admin test|cargo test|go test|mvn test|gradlew test|rake test|make test|npm run lint|npx tsc|flake8|mypy|ruff (?:check|test)|black --check|\btypecheck\b|\bvitest\b|\bjest\b)\b/i;

const SCRATCH_PATH =
  /^(?:\/tmp\/|\/var\/tmp\/|\/private\/tmp\/|(?:[A-Za-z]:)?\\(?:Users\\[^\\]+\\AppData\\Local\\Temp\\|Windows\\Temp\\))/i;

function catalogName(name: string): string {
  return canonicalToolName(name).replace(/^locus-/, "");
}

/** Repo-specific verify commands (from `.locus/environment.json` → `verify` or detected presets). */
export interface CodingVerifyOptions {
  verifyCommands?: readonly string[];
}

function shellWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/^['"]|['"]$/g, ""));
}

/** Program plus its first non-flag argument (`go test`, `make check`, `pytest`). */
function commandKey(command: string): string[] {
  const words = shellWords(command).filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  const head = words[0];
  if (!head) return [];
  const next = words[1];
  return next && !next.startsWith("-") ? [head, next] : [head];
}

function sameProgram(a: string, b: string): boolean {
  const base = (word: string) => word.replace(/^\.\//, "").replace(/\.(?:exe|cmd|bat)$/i, "");
  return base(a) === base(b);
}

/**
 * True when `command` runs one of the configured verify commands: any shell
 * segment (split on `&&`, `||`, `;`, `|`) that starts with the configured
 * program and its first sub-command, so `pytest -q tests/x.py` counts for a
 * configured `pytest -q` and `cd svc && go test ./pkg` counts for `go test ./...`.
 */
export function matchesVerifyCommand(command: string, configured: readonly string[]): boolean {
  if (!configured.length) return false;
  const segments = command.split(/&&|\|\||;|\||\n/).map((part) => shellWords(part));
  for (const want of configured) {
    const key = commandKey(want);
    if (!key.length) continue;
    for (const words of segments) {
      const rest = words.filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
      if (rest.length < key.length) continue;
      if (!sameProgram(rest[0]!, key[0]!)) continue;
      if (key.length === 2 && rest[1] !== key[1]) continue;
      return true;
    }
  }
  return false;
}

export function looksLikeVerifyCommand(command: string, opts?: CodingVerifyOptions): boolean {
  return VERIFY_COMMAND.test(command) || matchesVerifyCommand(command, opts?.verifyCommands ?? []);
}

export function isCodingMutateTool(name: string): boolean {
  return MUTATE_TOOLS.has(catalogName(name));
}

const FILE_CHANGE_KIND = /^(add|update|delete)$/i;

function fileChangeEntries(
  args?: Record<string, unknown>,
): Array<{ path: string; kind: "add" | "update" | "delete" }> {
  if (!args) return [];
  const buckets = [args.changes, args.value];
  for (const value of buckets) {
    if (!Array.isArray(value)) continue;
    const out: Array<{ path: string; kind: "add" | "update" | "delete" }> = [];
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const path = typeof rec.path === "string" ? rec.path.trim() : "";
      const kind = typeof rec.kind === "string" ? rec.kind.trim().toLowerCase() : "";
      if (!path || !FILE_CHANGE_KIND.test(kind)) continue;
      out.push({ path, kind: kind as "add" | "update" | "delete" });
    }
    if (out.length) return out;
  }
  return [];
}

/** Codex cleanup (delete a temp shim) should not re-gate a turn that already ran tests. */
export function isDeleteOnlyCodingMutate(call: CodingLoopToolCall): boolean {
  if (!isCodingMutateTool(call.name)) return false;
  const changes = fileChangeEntries(call.arguments);
  if (changes.length) return changes.every((row) => row.kind === "delete");
  const files = patchFilesFromTool(catalogName(call.name), call.arguments ?? {});
  return files.length > 0 && files.every((file) => file.kind === "delete");
}

function mutatePaths(call: CodingLoopToolCall): string[] {
  const args = call.arguments ?? {};
  const files = patchFilesFromTool(catalogName(call.name), args).map((file) => file.path);
  const direct = typeof args.path === "string" ? args.path.trim() : "";
  if (direct && !files.includes(direct)) files.push(direct);
  return files;
}

/** A scratch-dir write (PR body under /tmp) is not a source edit that needs tests. */
export function isScratchCodingMutate(call: CodingLoopToolCall): boolean {
  if (!isCodingMutateTool(call.name)) return false;
  const paths = mutatePaths(call);
  return paths.length > 0 && paths.every((path) => SCRATCH_PATH.test(path));
}

/** A canvas beside the chat is the deliverable, so search-wander should not demand a repo patch. */
export function wroteAgentCanvas(calls: Array<{ name: string; error?: string }>): boolean {
  return calls.some((call) => !call.error && catalogName(call.name) === "canvas_write");
}

export function isCodingVerifyCall(
  name: string,
  args?: Record<string, unknown>,
  opts?: CodingVerifyOptions,
): boolean {
  const n = catalogName(name);
  if (VERIFY_TOOLS.has(n)) return true;
  const cmds = execArgCommands(args);
  // Kiro V3 tool_call_update often lands as name "tool" with a command payload.
  if (n !== "exec" && n !== "powershell" && n !== "tool") return false;
  if (n === "tool" && !cmds.length) return false;
  return cmds.some((cmd) => looksLikeVerifyCommand(cmd, opts));
}

/** Mutate clears verify; a later test/push in the same turn restores it. */
export function foldCodingVerifyFlags(
  calls: Array<CodingLoopToolCall>,
  prior: { mutated?: boolean; verified?: boolean } = {},
  opts?: CodingVerifyOptions,
): { mutated: boolean; verified: boolean } {
  let mutated = Boolean(prior.mutated);
  let verified = Boolean(prior.verified);
  for (const call of calls) {
    if (isCodingMutateTool(call.name) && !isScratchCodingMutate(call)) {
      mutated = true;
      if (!isDeleteOnlyCodingMutate(call)) verified = false;
    }
    if (isCodingVerifyCall(call.name, call.arguments, opts)) verified = true;
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
export function codingVerifyNeedsHuman(
  messages: CodingLoopMessage[],
  opts?: CodingVerifyOptions,
): boolean {
  const flags = foldCodingVerifyFlags(
    sliceAfterLastUser(messages).flatMap((message) => message.toolCalls ?? []),
    {},
    opts,
  );
  return flags.mutated && !flags.verified;
}

/** Last tests/typecheck this turn failed — talking through the self-correct cap cannot ship red. */
export function codingFailedVerifyNeedsHuman(
  messages: CodingLoopMessage[],
  opts?: CodingVerifyOptions,
): boolean {
  let last: { error?: string } | undefined;
  for (const message of sliceAfterLastUser(messages)) {
    for (const call of message.toolCalls ?? []) {
      if (isCodingVerifyCall(call.name, call.arguments, opts)) last = call;
    }
  }
  return Boolean(last?.error?.trim());
}

export function codingTurnNeedsHuman(
  messages: CodingLoopMessage[],
  opts?: CodingVerifyOptions,
): string | undefined {
  if (codingVerifyNeedsHuman(messages, opts)) return CODING_VERIFY_NEEDS_HUMAN;
  if (codingFailedVerifyNeedsHuman(messages, opts)) return CODING_FAILED_VERIFY_NEEDS_HUMAN;
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
