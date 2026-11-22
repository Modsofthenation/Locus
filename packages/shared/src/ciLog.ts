/**
 * CI failure logs: the failing checks of a pull request head and a condensed excerpt of each
 * job log. Forge adapters fetch raw logs; this module turns them into something a fix agent
 * can read inside a small budget (error regions plus head/tail, simple failing test ids).
 *
 * Structured test reports (JUnit, go test -json, …) are a separate concern; this only reads
 * plain job logs.
 */
import type { PullCheck } from "./models/repo.js";
import { parseTestOutput, testReportFailedTests } from "./testReport.js";

export const CI_LOG_DEFAULT_MAX_CHARS = 6_000;
export const CI_LOG_MIN_MAX_CHARS = 800;
export const CI_LOG_MAX_MAX_CHARS = 40_000;
/** Raw bytes read from a forge job log before condensing. */
export const CI_LOG_FETCH_MAX_BYTES = 4_000_000;
export const CI_FIX_DEFAULT_MAX_ATTEMPTS = 2;

/** Where a check came from. Only some sources expose a job log. */
export type CiCheckSource =
  "actions" | "check_run" | "status" | "gitlab_job" | "pipeline" | "other";

export interface CiCheckRun {
  /** Forge id of the job / check run (GitHub check-run id doubles as the Actions job id). */
  id?: string;
  name: string;
  status: PullCheck["status"];
  url?: string;
  source: CiCheckSource;
  stage?: string;
  /** Check-run output title/summary, status description, or GitLab failure_reason. */
  summary?: string;
  /** Whether the forge can return a job log for this check. */
  logAvailable: boolean;
}

export interface CondensedCiLog {
  text: string;
  /** Error regions kept (before budget clipping). */
  regions: number;
  failingTests: string[];
  truncated: boolean;
  totalLines: number;
  exitCode?: number;
}

export interface CiFailure extends CiCheckRun {
  log?: CondensedCiLog;
  /** Why there is no log (forge without logs, fetch error, non-Actions check). */
  note?: string;
}

export interface CiFailureReport {
  headSha: string;
  failures: CiFailure[];
  /** Checks still queued or running at the time of the fetch. */
  pending: string[];
}

const FAILING = new Set<PullCheck["status"]>(["failure", "error", "cancelled"]);

export function isFailingCheckStatus(status: string | undefined): boolean {
  return FAILING.has(status as PullCheck["status"]);
}

export function clampCiLogChars(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) return CI_LOG_DEFAULT_MAX_CHARS;
  return Math.min(CI_LOG_MAX_MAX_CHARS, Math.max(CI_LOG_MIN_MAX_CHARS, Math.round(n)));
}

// ---------------------------------------------------------------------------------------------
// Normalizing

// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// eslint-disable-next-line no-control-regex
const ANSI_OTHER = /\u001b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_OSC, "").replace(ANSI_CSI, "").replace(ANSI_OTHER, "");
}

/** GitHub Actions `2024-05-01T12:00:00.1234567Z `, bracketed `[12:00:01]`, and ISO prefixes. */
const LINE_TIMESTAMP =
  /^(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s?|\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\]\s?)/;
const GITLAB_SECTION = /section_(?:start|end):\d+:[A-Za-z0-9_.-]+(?:\[[^\]]*\])?/g;

export function stripLogTimestamp(line: string): string {
  return line.replace(LINE_TIMESTAMP, "");
}

/** ANSI, carriage-return progress bars, timestamps, GitLab section markers, `##[group]`. */
export function normalizeCiLog(raw: string): string[] {
  const text = stripAnsi(raw.replace(/^\uFEFF/, "")).replace(/\r\n/g, "\n");
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    // A bare \r rewrites the line (progress bars): keep the last frame.
    const frames = rawLine.split("\r");
    let line = frames[frames.length - 1] ?? "";
    if (!line.trim() && frames.length > 1) line = frames.filter((f) => f.trim()).pop() ?? "";
    line = stripLogTimestamp(line.replace(GITLAB_SECTION, ""));
    line = line
      .replace(/^##\[(?:group|endgroup|section|command)\]/, "")
      .replace(/^##\[error\]/, "Error: ")
      .replace(/^##\[warning\]/, "Warning: ")
      .replace(/^::error(?: [^:]*)?::/, "Error: ")
      .replace(/\s+$/, "");
    out.push(line);
  }
  while (out.length && !out[out.length - 1]!.trim()) out.pop();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Error regions

const ERROR_LINE: RegExp[] = [
  /^Error: /,
  /\b(?:error|ERROR)(?:\[[A-Z]?\d+\])?:/,
  /\berror TS\d+:/,
  /^\s*(?:FAIL|FAILED)\b/,
  /\bFAILED\b/,
  /^\s*--- FAIL:/,
  /^\s*[×✕✗✖]\s/,
  /^\s*●\s/,
  /\bpanicked at\b/,
  /^panic: /,
  /^Traceback \(most recent call last\)/,
  /^E\s{2,}\S/,
  /\b\w*(?:Error|Exception): /,
  /\bAssertionError\b/,
  /\bnpm ERR!/,
  /\bnpm error\b/,
  /\bELIFECYCLE\b/,
  /\bexit(?:ed with)? (?:code|status) [1-9]\d*/i,
  /Process completed with exit code [1-9]/,
  /={3,} (?:FAILURES|ERRORS|short test summary info) ={3,}/,
  /^\s*Tests?:?\s+.*\b\d+ failed\b/i,
  /^\s*Test (?:Files|Suites):?\s+.*\b\d+ failed\b/i,
  /\bBuild FAILED\b/i,
  /\btest result: FAILED\b/,
];

/** Lines that look like an error but are not (summaries of zero, flags). */
const NOT_ERROR: RegExp[] = [
  /\b0 (?:errors?|failed|failures)\b/i,
  /--[\w-]*error[\w-]*/i,
  /\berror(?:s)?: 0\b/i,
  /^\s*Warning: /,
];

export function isCiErrorLine(line: string): boolean {
  if (!line.trim()) return false;
  if (NOT_ERROR.some((re) => re.test(line))) return false;
  return ERROR_LINE.some((re) => re.test(line));
}

const BEFORE = 3;
const AFTER = 8;
const HEAD_LINES = 3;
const TAIL_LINES = 15;
const MAX_LINE_CHARS = 500;
/** Rough size of a `… N lines omitted …` marker. */
const GAP_CHARS = 26;

function clipLine(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 1)}…` : line;
}

function assemble(lines: string[], picked: Set<number>): string {
  const order = [...picked].sort((a, b) => a - b);
  const parts: string[] = [];
  let cursor = 0;
  for (const i of order) {
    if (i > cursor) parts.push(`… ${i - cursor} lines omitted …`);
    parts.push(clipLine(lines[i]!));
    cursor = i + 1;
  }
  if (cursor < lines.length) parts.push(`… ${lines.length - cursor} lines omitted …`);
  return parts.join("\n");
}

/**
 * Keep error lines with a few lines of context before and more after, plus the head and
 * tail of a job log, within `maxChars`. Lines are picked by priority: the last lines, the
 * first and last error, the remaining errors (newest first), their context rings, the
 * tail, then the head. Gaps become `… N lines omitted …`.
 */
export function condenseCiLog(raw: string, opts: { maxChars?: number } = {}): CondensedCiLog {
  const maxChars = clampCiLogChars(opts.maxChars ?? CI_LOG_DEFAULT_MAX_CHARS);
  const lines = normalizeCiLog(raw);
  const totalLines = lines.length;
  const failingTests = mergeTestIds(lines);
  const exitCode = parseExitCodeLine(lines);
  const exit = exitCode !== undefined ? { exitCode } : {};
  const errors: number[] = [];
  lines.forEach((line, i) => {
    if (isCiErrorLine(line)) errors.push(i);
  });
  let regions = 0;
  let lastEnd = -Infinity;
  for (const i of errors) {
    if (i - BEFORE > lastEnd + 1) regions += 1;
    lastEnd = Math.max(lastEnd, i + AFTER);
  }
  const full = lines.map(clipLine).join("\n");
  if (full.length <= maxChars) {
    return { text: full, regions, failingTests, truncated: false, totalLines, ...exit };
  }

  const order: number[] = [];
  const push = (i: number) => {
    if (i >= 0 && i < totalLines) order.push(i);
  };
  for (let i = totalLines - 3; i < totalLines; i += 1) push(i);
  const ranked = errors.length
    ? [errors[0]!, errors[errors.length - 1]!, ...errors.slice(1, -1).reverse()]
    : [];
  for (const e of ranked) push(e);
  for (let d = 1; d <= AFTER; d += 1) {
    for (const e of ranked) {
      push(e + d);
      if (d <= BEFORE) push(e - d);
    }
  }
  for (let i = totalLines - 1; i >= totalLines - TAIL_LINES; i -= 1) push(i);
  for (let i = 0; i < HEAD_LINES; i += 1) push(i);

  const picked = new Set<number>();
  const added: number[] = [];
  let used = 0;
  for (const i of order) {
    if (picked.has(i)) continue;
    const joined = picked.has(i - 1) || picked.has(i + 1);
    const cost = clipLine(lines[i]!).length + 1 + (joined ? 0 : GAP_CHARS);
    if (used + cost > maxChars) continue;
    picked.add(i);
    added.push(i);
    used += cost;
  }
  let text = assemble(lines, picked);
  while (text.length > maxChars && added.length) {
    picked.delete(added.pop()!);
    text = assemble(lines, picked);
  }
  return { text, regions, failingTests, truncated: true, totalLines, ...exit };
}

/**
 * Failing test ids: the simple line patterns below (runner-native ids such as
 * `tests/x.py::name`), else the structured runner parsers in testReport.ts.
 */
function mergeTestIds(lines: string[]): string[] {
  const simple = parseFailingTestIds(lines);
  if (simple.length) return simple;
  try {
    return testReportFailedTests(parseTestOutput(lines.join("\n")), 30);
  } catch {
    return [];
  }
}

function parseExitCodeLine(lines: string[]): number | undefined {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = /(?:exit(?:ed with)? (?:code|status)|Process completed with exit code)\s+(\d+)/i.exec(
      lines[i]!,
    );
    if (m) return Number(m[1]);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Failing test ids

const TEST_ID_PATTERNS: Array<{ re: RegExp; pick: (m: RegExpExecArray) => string | undefined }> = [
  // pytest short summary: FAILED tests/test_x.py::test_name - AssertionError
  { re: /^(?:FAILED|ERROR)\s+(\S+::\S+)/, pick: (m) => m[1] },
  // vitest / jest file line: FAIL  src/a.test.ts > suite > case
  { re: /^\s*FAIL\s+(\S+\.(?:[cm]?[jt]sx?)(?:\s+>\s+.+)?)$/, pick: (m) => m[1] },
  // vitest case: × suite > case 12ms
  {
    re: /^\s*[×✕✗✖]\s+(.+?)(?:\s+\d+(?:\.\d+)?\s?m?s)?$/,
    pick: (m) => m[1]?.replace(/\s*\[\s*\S+\s*\]$/, ""),
  },
  // jest: ● suite › case
  { re: /^\s*●\s+(.+›.+)$/, pick: (m) => m[1] },
  // go test: --- FAIL: TestName (0.00s)
  { re: /^\s*--- FAIL:\s+(\S+)/, pick: (m) => m[1] },
  // cargo test: test path::name ... FAILED
  { re: /^test\s+(\S+)\s+\.\.\.\s+FAILED$/, pick: (m) => m[1] },
];

/** Simple test ids from common runners (vitest, jest, pytest, go test, cargo test). */
export function parseFailingTestIds(lines: string[] | string, max = 30): string[] {
  const list = typeof lines === "string" ? normalizeCiLog(lines) : lines;
  const seen = new Set<string>();
  for (const line of list) {
    for (const { re, pick } of TEST_ID_PATTERNS) {
      const m = re.exec(line);
      if (!m) continue;
      const id = pick(m)?.trim();
      if (id && id.length <= 300) seen.add(id);
      break;
    }
    if (seen.size >= max) break;
  }
  return [...seen];
}

// ---------------------------------------------------------------------------------------------
// Formatting

function checkLine(row: CiFailure): string {
  const where = [row.stage, row.source === "status" ? "status" : undefined]
    .filter(Boolean)
    .join(", ");
  return `${row.name}: ${row.status}${where ? ` (${where})` : ""}${row.url ? ` ${row.url}` : ""}`;
}

/** Tool / prompt text for a failure report. Logs are fenced so the model treats them as data. */
export function formatCiFailures(
  report: CiFailureReport,
  opts: { heading?: boolean } = {},
): string {
  const out: string[] = [];
  if (opts.heading !== false) {
    out.push(
      report.failures.length
        ? `Failing checks at ${report.headSha.slice(0, 12) || "(unknown head)"}: ${report.failures.length}`
        : `No failing checks at ${report.headSha.slice(0, 12) || "(unknown head)"}.`,
    );
    if (report.pending.length) out.push(`Still running: ${report.pending.join(", ")}`);
  }
  for (const row of report.failures) {
    out.push("", `## ${checkLine(row)}`);
    if (row.summary?.trim()) out.push(row.summary.trim().slice(0, 1_000));
    if (row.log?.failingTests.length) {
      out.push(`Failing tests: ${row.log.failingTests.slice(0, 15).join(", ")}`);
    }
    if (row.log?.text) {
      const meta = [
        `${row.log.totalLines} lines`,
        row.log.truncated ? "condensed" : undefined,
        row.log.exitCode !== undefined ? `exit ${row.log.exitCode}` : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      out.push(`Log (${meta}):`, "```text", row.log.text.replace(/```/g, "``​`"), "```");
    } else {
      out.push(row.note || "Logs not available for this check.");
    }
  }
  return out.join("\n");
}

/** Stable key for "this exact set of failing checks on this head". */
export function ciFixKey(headSha: string, checks: string[]): string {
  return `${headSha}|${[...new Set(checks)].sort((a, b) => a.localeCompare(b)).join(",")}`;
}

export function formatCiFixPrompt(input: {
  pull: { url: string; title: string; headRef: string; baseRef: string };
  number: number;
  report: CiFailureReport;
  attempt?: number;
  maxAttempts?: number;
}): string {
  const { report } = input;
  const names = report.failures.map((row) => row.name);
  const attempt =
    input.attempt && input.maxAttempts
      ? `This is CI fix attempt ${input.attempt} of ${input.maxAttempts} for these checks.`
      : undefined;
  return [
    `CI failed on this pull request: ${names.join(", ") || "(unknown checks)"}.`,
    `Head commit: ${report.headSha || "(unknown)"}. Branch ${input.pull.headRef} → ${input.pull.baseRef}.`,
    attempt,
    "",
    "Do this in order:",
    `1. Make sure the workspace is on ${input.pull.headRef} at ${report.headSha.slice(0, 12) || "the PR head"} (git_fetch, then check git_log).`,
    "2. Reproduce the failure locally in the guest first: run the failing command or test from the log below (the narrowest one that shows the failure). Do not guess a fix before you have seen it fail.",
    "3. Fix the cause. Do not delete or skip the failing test, and do not loosen lint/typecheck config to get green.",
    "4. Re-run the same command until it passes, then run the package's wider test/typecheck command.",
    `5. Commit and git_push to the same PR branch (${input.pull.headRef}). Never create a new branch, never force-push, never push to main/master. The existing push gates still apply.`,
    "Call git_ci_logs if you need the full condensed log of another check.",
    "",
    formatCiFailures(report),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

// ---------------------------------------------------------------------------------------------
// De-dupe and attempt cap

/** Per checks-subscription memory of CI fixes already started. */
export interface CiFixState {
  /** ciFixKey of the last fix started (or skipped as a duplicate). */
  lastKey?: string;
  /** Consecutive fix attempts started per failing check name; reset when the check passes. */
  attempts?: Record<string, number>;
  /** Set when the cap stopped automatic fixes; cleared when every capped check passes. */
  stoppedAt?: string;
}

export type CiFixDecision =
  | { action: "start"; key: string; attempt: number; state: CiFixState }
  | { action: "duplicate"; key: string; state: CiFixState }
  | { action: "cap"; key: string; capped: string[]; summary: string; state: CiFixState }
  | { action: "none"; state: CiFixState };

export function parseCiFixMaxAttempts(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(n) || n < 1) return CI_FIX_DEFAULT_MAX_ATTEMPTS;
  return Math.min(10, n);
}

/**
 * Apply a checks snapshot without starting anything: a check that passes resets its
 * counter, and the stop marker clears once no capped check is still failing.
 */
export function settleCiFixState(
  prev: CiFixState | undefined,
  checks: Array<{ name: string; status: string }>,
  maxAttempts?: number,
): CiFixState | undefined {
  if (!prev) return undefined;
  const max = parseCiFixMaxAttempts(maxAttempts);
  const attempts: Record<string, number> = { ...(prev.attempts ?? {}) };
  for (const row of checks) {
    if (row.status === "success" || row.status === "neutral") delete attempts[row.name];
  }
  const stillCapped = checks.some(
    (row) => isFailingCheckStatus(row.status) && (attempts[row.name] ?? 0) >= max,
  );
  const out: CiFixState = {
    ...(prev.lastKey ? { lastKey: prev.lastKey } : {}),
    ...(Object.keys(attempts).length ? { attempts } : {}),
    ...(prev.stoppedAt && stillCapped ? { stoppedAt: prev.stoppedAt } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/**
 * Decide whether a checks wake should start a CI fix.
 * - Same head SHA and the same failing set as the last fix: duplicate, do nothing.
 * - Any failing check already had `maxAttempts` consecutive fixes: stop and hand to a human.
 * - Otherwise start one fix and count an attempt for every failing check.
 * Checks that now pass reset their counter.
 */
export function planCiFix(
  prev: CiFixState | undefined,
  input: {
    headSha: string;
    checks: Array<{ name: string; status: string }>;
    maxAttempts?: number;
    now?: Date;
  },
): CiFixDecision {
  const max = parseCiFixMaxAttempts(input.maxAttempts);
  const base = settleCiFixState(prev, input.checks, max) ?? {};
  const attempts: Record<string, number> = { ...(base.attempts ?? {}) };
  const failing = [
    ...new Set(input.checks.filter((row) => isFailingCheckStatus(row.status)).map((r) => r.name)),
  ];
  if (!failing.length) return { action: "none", state: base };
  const key = ciFixKey(input.headSha, failing);
  if (prev?.lastKey === key) return { action: "duplicate", key, state: base };
  const capped = failing.filter((name) => (attempts[name] ?? 0) >= max);
  if (capped.length) {
    const summary = `CI fix stopped after ${max} attempt${max === 1 ? "" : "s"}: ${capped.join(", ")} still failing at ${input.headSha.slice(0, 12)}. Needs a human.`;
    return {
      action: "cap",
      key,
      capped,
      summary,
      state: {
        ...base,
        lastKey: key,
        stoppedAt: prev?.stoppedAt ?? (input.now ?? new Date()).toISOString(),
      },
    };
  }
  for (const name of failing) attempts[name] = (attempts[name] ?? 0) + 1;
  const attempt = Math.max(...failing.map((name) => attempts[name] ?? 1));
  return {
    action: "start",
    key,
    attempt,
    state: { lastKey: key, attempts },
  };
}

export function parseCiFixState(raw: unknown): CiFixState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const out: CiFixState = {};
  if (typeof value.lastKey === "string" && value.lastKey)
    out.lastKey = value.lastKey.slice(0, 2_000);
  if (value.attempts && typeof value.attempts === "object") {
    const attempts: Record<string, number> = {};
    for (const [name, count] of Object.entries(value.attempts as Record<string, unknown>)) {
      if (typeof count === "number" && Number.isInteger(count) && count > 0)
        attempts[name.slice(0, 200)] = Math.min(count, 100);
    }
    if (Object.keys(attempts).length) out.attempts = attempts;
  }
  if (typeof value.stoppedAt === "string" && value.stoppedAt) out.stoppedAt = value.stoppedAt;
  return Object.keys(out).length ? out : undefined;
}
