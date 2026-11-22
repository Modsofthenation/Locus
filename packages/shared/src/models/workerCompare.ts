import type { ChatMessage, ToolCall } from "./session.js";
import { canonicalToolCall, parseExitCode } from "./toolChip.js";
import type { WorktreeDiffStat } from "./worktree.js";
import { isWorkerLockPath } from "./compare.js";

const TEST_COMMAND =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?|npx\s+(?:vitest|jest|playwright\s+test)|vitest|jest|pytest|go\s+test|cargo\s+test|dotnet\s+test|rspec|mix\s+test|phpunit|(?:\.\/)?gradlew?\s+(?:\S+\s+)*test|mvn\s+(?:\S+\s+)*test|make\s+(?:check|test))\b/i;

/** True when a shell command looks like it runs a test suite. */
export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command);
}

/** Shell command of an exec/powershell tool call, if any. */
export function toolCallCommand(call: Pick<ToolCall, "name" | "arguments">): string | undefined {
  const canon = canonicalToolCall(call.name, call.arguments);
  if (canon.name !== "exec" && canon.name !== "powershell") return undefined;
  const command = canon.arguments.command;
  return typeof command === "string" && command.trim() ? command.trim() : undefined;
}

/** Finished without an error, denial, or non-zero exit. */
export function toolCallPassed(call: Pick<ToolCall, "error" | "approval" | "result">): boolean {
  if (call.error) return false;
  if (call.approval === "denied") return false;
  const code = parseExitCode(call.result);
  return code === undefined || code === 0;
}

export type WorkerTestState = "pass" | "fail" | "none";

export interface WorkerTestRun {
  state: WorkerTestState;
  command?: string;
}

/** Result of the last finished test command in a transcript; `none` when no test ran. */
export function lastTestRun(messages: Pick<ChatMessage, "toolCalls">[]): WorkerTestRun {
  for (let i = messages.length - 1; i >= 0; i--) {
    const calls = messages[i]?.toolCalls ?? [];
    for (let j = calls.length - 1; j >= 0; j--) {
      const call = calls[j]!;
      if (!call.finishedAt && call.result === undefined && !call.error) continue;
      const command = toolCallCommand(call);
      if (!command || !isTestCommand(command)) continue;
      return { state: toolCallPassed(call) ? "pass" : "fail", command };
    }
  }
  return { state: "none" };
}

const LINT_COMMAND =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint(?::[\w-]+)?|eslint|biome\s+(?:check|lint)|ruff(?:\s+check)?|flake8|pylint|golangci-lint|cargo\s+clippy|rubocop|stylelint|prettier\s+(?:--check|-c)\b)/i;
const TYPECHECK_COMMAND =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:typecheck|type-check|check-types|tsc)\b|(?:npx\s+)?(?:vue-)?tsc\b|mypy|pyright|cargo\s+check|go\s+vet)/i;

export function isLintCommand(command: string): boolean {
  return LINT_COMMAND.test(command);
}

export function isTypecheckCommand(command: string): boolean {
  return TYPECHECK_COMMAND.test(command);
}

/** Last finished command matching `match` in a transcript; `none` when it never ran. */
export function lastCommandRun(
  messages: Pick<ChatMessage, "toolCalls">[],
  match: (command: string) => boolean,
): WorkerTestRun {
  for (let i = messages.length - 1; i >= 0; i--) {
    const calls = messages[i]?.toolCalls ?? [];
    for (let j = calls.length - 1; j >= 0; j--) {
      const call = calls[j]!;
      if (!call.finishedAt && call.result === undefined && !call.error) continue;
      const command = toolCallCommand(call);
      if (!command || !match(command)) continue;
      return { state: toolCallPassed(call) ? "pass" : "fail", command };
    }
  }
  return { state: "none" };
}

/** Last test, lint, and typecheck result recorded in a transcript. */
export function lastCheckRuns(messages: Pick<ChatMessage, "toolCalls">[]): {
  tests: WorkerTestRun;
  lint: WorkerTestRun;
  typecheck: WorkerTestRun;
} {
  return {
    tests: lastTestRun(messages),
    lint: lastCommandRun(messages, isLintCommand),
    typecheck: lastCommandRun(messages, isTypecheckCommand),
  };
}

/** Paths named by `diff --git a/x b/x` headers, in order, de-duplicated. */
export function diffFilePaths(patch: string): string[] {
  const seen = new Set<string>();
  for (const line of patch.split("\n")) {
    if (!line.startsWith("diff --git ")) continue;
    const m = / b\/(.+)$/.exec(line);
    const path = m?.[1]?.trim();
    if (path && path !== "dev/null") seen.add(path);
  }
  return [...seen];
}

const SCOPE_PATH =
  /(?:^|[\s`'"([])((?:\.\/)?(?:[\w@.-]+\/)+[\w@.-]*|[\w.-]+\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs|c|cc|cpp|h|hpp|swift|md|json|ya?ml|toml|css|scss|html|sql|sh|vue|svelte))(?=$|[\s`'"),.:;\]])/g;

/** Paths and directories the task text names (`src/auth/`, `login.ts`). Empty when none. */
export function taskScopePaths(task: string): string[] {
  const out = new Set<string>();
  for (const m of task.matchAll(SCOPE_PATH)) {
    const raw = (m[1] ?? "").replace(/^\.\//, "").replace(/[.,:;]+$/, "");
    if (!raw || /^https?:/i.test(raw) || raw.includes("//")) continue;
    if (/^(?:and|or)\//i.test(raw)) continue;
    out.add(raw);
  }
  return [...out];
}

function stem(path: string): string {
  const leaf = path.split("/").pop() ?? path;
  return leaf.replace(/\.(?:test|spec)(?=\.)/, "").replace(/\.[^.]+$/, "");
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i + 1) : "";
}

function inScope(file: string, scope: string[]): boolean {
  for (const entry of scope) {
    const isDir = entry.endsWith("/") || !/\.[^/]+$/.test(entry);
    if (isDir) {
      const dir = entry.endsWith("/") ? entry : `${entry}/`;
      if (file.startsWith(dir) || file.includes(`/${dir}`)) return true;
      continue;
    }
    if (file === entry || file.endsWith(`/${entry}`)) return true;
    // Siblings of a named file and its tests count as the same change.
    const entryDir = entry.includes("/") ? dirOf(entry) : undefined;
    if (entryDir !== undefined && dirOf(file) === entryDir) return true;
    if (stem(file) === stem(entry)) return true;
  }
  return false;
}

/**
 * Changed files outside what the task asked for: lockfiles always (workers must not touch
 * them), plus files outside the paths the task names when it names any.
 */
export function outOfScopeFiles(files: string[], task: string): string[] {
  const scope = taskScopePaths(task);
  return files.filter(
    (file) => isWorkerLockPath(file) || (scope.length > 0 && !inScope(file, scope)),
  );
}

/** What a ranker needs to know about one attempt. */
export interface WorkerAttempt {
  id: string;
  role: string;
  model: string;
  status: string;
  stat: WorktreeDiffStat;
  tests?: WorkerTestState;
  lint?: WorkerTestState;
  typecheck?: WorkerTestState;
  /** Changed files that are outside the task's scope (see `outOfScopeFiles`). */
  outOfScope?: string[];
  usd?: number;
  error?: string;
  diff?: string;
}

export interface WorkerRankEntry {
  id: string;
  rank: number;
  reason: string;
  /** Objective signals behind the rank, one short phrase each. */
  evidence?: string[];
}

/**
 * `model`: evidence first, a model judged ties and wrote the reasons.
 * `heuristic`: evidence only (tests, lint/typecheck, scope, diff size, cost).
 */
export interface WorkerRanking {
  source: "model" | "heuristic";
  entries: WorkerRankEntry[];
}

function changedLines(stat: WorktreeDiffStat): number {
  return stat.insertions + stat.deletions;
}

function usable(row: WorkerAttempt): boolean {
  return row.status !== "error" && !row.error && row.stat.files > 0;
}

const TEST_ORDER: Record<WorkerTestState, number> = { pass: 0, none: 1, fail: 2 };

export interface WorkerEvidence {
  /** Lexicographic key; lower is better. Ties fall to the model, then size, then cost. */
  tier: [number, number, number, number];
  lines: number;
  usd: number;
  evidence: string[];
}

/** Pure scoring of one attempt from recorded signals. */
export function scoreWorkerEvidence(row: WorkerAttempt): WorkerEvidence {
  const ok = usable(row);
  const tests = row.tests ?? "none";
  const failingChecks = (row.lint === "fail" ? 1 : 0) + (row.typecheck === "fail" ? 1 : 0);
  const outside = row.outOfScope?.length ?? 0;
  const evidence: string[] = [];
  if (!ok) {
    evidence.push(row.error || row.status === "error" ? "Errored" : "No changes");
  } else {
    evidence.push(
      tests === "pass" ? "Tests pass" : tests === "fail" ? "Tests fail" : "No tests run",
    );
    if (row.typecheck && row.typecheck !== "none")
      evidence.push(row.typecheck === "pass" ? "Typecheck pass" : "Typecheck fail");
    if (row.lint && row.lint !== "none")
      evidence.push(row.lint === "pass" ? "Lint pass" : "Lint fail");
    if (outside) {
      const shown = row.outOfScope!.slice(0, 2).join(", ");
      evidence.push(
        `${outside} file${outside === 1 ? "" : "s"} outside scope (${shown}${outside > 2 ? ", …" : ""})`,
      );
    }
    evidence.push(`${changedLines(row.stat)} lines`);
    if (typeof row.usd === "number") evidence.push(`$${row.usd.toFixed(2)}`);
  }
  return {
    tier: [ok ? 0 : 1, TEST_ORDER[tests], failingChecks, outside],
    lines: changedLines(row.stat),
    usd: row.usd ?? Number.POSITIVE_INFINITY,
    evidence,
  };
}

function compareTier(a: WorkerEvidence["tier"], b: WorkerEvidence["tier"]): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

/**
 * Evidence-first ranking: usable > tests pass > not run > fail, then fewer failing
 * lint/typecheck runs, then fewer files outside scope. Within a tier, a model ranking
 * (when given) breaks ties; otherwise the smaller diff, then the lower cost.
 */
export function evidenceWorkerRank(
  rows: WorkerAttempt[],
  model?: WorkerRankEntry[],
): WorkerRanking {
  const scored = rows.map((row, index) => ({ row, index, score: scoreWorkerEvidence(row) }));
  const modelRank = new Map(model?.map((entry) => [entry.id, entry]) ?? []);
  scored.sort((a, b) => {
    const tier = compareTier(a.score.tier, b.score.tier);
    if (tier) return tier;
    const ma = modelRank.get(a.row.id)?.rank;
    const mb = modelRank.get(b.row.id)?.rank;
    if (ma !== undefined && mb !== undefined && ma !== mb) return ma - mb;
    if (a.score.lines !== b.score.lines) return a.score.lines - b.score.lines;
    if (a.score.usd !== b.score.usd) return a.score.usd < b.score.usd ? -1 : 1;
    return a.index - b.index;
  });
  const usedModel = Boolean(model?.length);
  return {
    source: usedModel ? "model" : "heuristic",
    entries: scored.map(({ row, score }, i) => {
      const judged = modelRank.get(row.id)?.reason?.trim();
      const reason =
        usedModel && judged && judged !== "Not ranked" ? judged : score.evidence.join(" · ");
      return { id: row.id, rank: i + 1, reason, evidence: score.evidence };
    }),
  };
}

/** Evidence-only ranking (no model). Kept for callers of the earlier heuristic. */
export function heuristicWorkerRank(rows: WorkerAttempt[]): WorkerRanking {
  return evidenceWorkerRank(rows);
}

const RANK_DIFF_CHARS = 6000;

/** User prompt asking a model to order the attempts. Diffs are clipped per attempt. */
export function formatWorkerRankPrompt(task: string, rows: WorkerAttempt[]): string {
  const blocks = rows.map((row) => {
    const diff = (row.diff ?? "").trim();
    const clipped =
      diff.length > RANK_DIFF_CHARS ? `${diff.slice(0, RANK_DIFF_CHARS)}\n… diff clipped` : diff;
    return [
      `## Attempt ${row.role}`,
      `model: ${row.model}`,
      `status: ${row.status}${row.error ? ` (${row.error})` : ""}`,
      `tests: ${row.tests ?? "none"}`,
      ...(row.typecheck && row.typecheck !== "none" ? [`typecheck: ${row.typecheck}`] : []),
      ...(row.lint && row.lint !== "none" ? [`lint: ${row.lint}`] : []),
      ...(row.outOfScope?.length
        ? [`outside task scope: ${row.outOfScope.slice(0, 5).join(", ")}`]
        : []),
      `diffstat: ${row.stat.files} files, +${row.stat.insertions} -${row.stat.deletions}`,
      ...(typeof row.usd === "number" ? [`cost: $${row.usd.toFixed(4)}`] : []),
      "```diff",
      clipped || "(no changes)",
      "```",
    ].join("\n");
  });
  return [
    "Several agents attempted the same task in parallel. Rank the attempts from best to worst.",
    "Judge correctness and completeness against the task first, then test results, then simplicity. Test, lint, typecheck, and scope facts are already used to group attempts; your order breaks ties and your reasons explain the pick.",
    'Reply with JSON only: {"ranking":[{"attempt":"<label>","reason":"<one short line>"}]} listing every attempt once.',
    "",
    "# Task",
    task.trim() || "(task prompt unavailable)",
    "",
    ...blocks,
  ].join("\n");
}

/**
 * Parse a model reply into ranked entries. Labels map back to ids by role.
 * Attempts the model left out are appended in input order. Undefined when nothing parsed.
 */
export function parseWorkerRank(
  text: string,
  rows: WorkerAttempt[],
): WorkerRankEntry[] | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
  const list = (parsed as { ranking?: unknown })?.ranking;
  if (!Array.isArray(list)) return undefined;
  const byRole = new Map(rows.map((row) => [row.role.toLowerCase(), row]));
  const out: WorkerRankEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const label = String(raw.attempt ?? raw.id ?? "")
      .replace(/^attempt\s+/i, "")
      .trim()
      .toLowerCase();
    const row = byRole.get(label);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    const reason =
      typeof raw.reason === "string" ? raw.reason.trim().split("\n")[0]!.slice(0, 160) : "";
    out.push({ id: row.id, rank: out.length + 1, reason });
  }
  if (!out.length) return undefined;
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    out.push({ id: row.id, rank: out.length + 1, reason: "Not ranked" });
  }
  return out;
}
