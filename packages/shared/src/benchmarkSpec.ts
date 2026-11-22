/**
 * Repo-derived benchmark cases ("bug-fix tasks from history") and the history view over runs.
 *
 * A case spec points at a git repository and a base commit (the parent of a real fix). The
 * agent works on the base tree without the fix's tests. At scoring time the fix commit's
 * versions of `protectedPaths` (the hidden tests) are copied in and `testCommand` runs. The
 * case passes when every `failToPass` test now passes, every `passToPass` test still passes,
 * and the agent left `protectedPaths` alone. Spec files are JSON: one spec, an array, or
 * `{ "cases": [...] }`, usually under `.locus/benchmarks/` in a repo.
 */
import {
  benchmarkTargetKey,
  type BenchmarkCaseResult,
  type BenchmarkHarness,
  type BenchmarkRun,
} from "./benchmark.js";

export const BENCHMARK_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
  "ruby",
  "other",
] as const;
export type BenchmarkLanguage = (typeof BENCHMARK_LANGUAGES)[number];

export interface BenchmarkCaseSpec {
  /** Unique within the suite: lowercase letters, digits, `.`, `_`, `-`. */
  id: string;
  title?: string;
  /**
   * Local path (relative to the spec file), a clone URL, or `fixture:<dir>` — a directory with
   * `base/` and `fix/` trees that Locus turns into a two-commit repo (tags `locus-base` and
   * `locus-fix`).
   */
  repo: string;
  /** Commit-ish the agent starts from: the parent of the fix. */
  baseCommit: string;
  /** The real fix. Hidden tests come from here; also kept for provenance. */
  fixCommit?: string;
  /** Issue text the agent receives. */
  prompt: string;
  /** Install command run before the agent starts (for example `npm ci`). */
  setup?: string;
  testCommand: string;
  /** Test ids that fail at base and must pass after the agent. Empty: exit code decides. */
  failToPass: string[];
  /** Test ids that pass at base and must keep passing. */
  passToPass: string[];
  /** Test files the agent must not edit; replaced by the fix commit's versions at scoring. */
  protectedPaths: string[];
  /** Agent time limit. Default 900. */
  timeoutSec?: number;
  language?: BenchmarkLanguage;
  /** Issue references found in the fix commit message (`#123`, `ABC-12`). */
  issues?: string[];
}

export const BENCHMARK_SPEC_DEFAULT_TIMEOUT_SEC = 900;
/** Bumped when spec scoring rules change, so the harness hash moves with them. */
export const BENCHMARK_SCORING_VERSION = 2;

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const COMMITISH_RE = /^[A-Za-z0-9][A-Za-z0-9._/@^~-]{0,199}$/;

function isRelativeSafePath(path: string): boolean {
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\\")) return false;
  return !path.split("/").some((part) => part === ".." || part === "");
}

function stringList(value: unknown, field: string, errors: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) {
    errors.push(`${field} must be a list of non-empty strings`);
    return [];
  }
  return value.map((v: string) => v.trim());
}

export type BenchmarkSpecValidation =
  { ok: true; spec: BenchmarkCaseSpec } | { ok: false; errors: string[] };

/** Validate one parsed JSON value as a case spec. Trims strings; does not touch the disk. */
export function validateBenchmarkCaseSpec(raw: unknown): BenchmarkSpecValidation {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["a case spec must be an object"] };
  }
  const row = raw as Record<string, unknown>;
  const str = (field: string, required: boolean): string | undefined => {
    const value = row[field];
    if (value === undefined || value === null) {
      if (required) errors.push(`${field} is required`);
      return undefined;
    }
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`${field} must be a non-empty string`);
      return undefined;
    }
    return value.trim();
  };
  const id = str("id", true);
  if (id && !ID_RE.test(id)) errors.push("id must be lowercase letters, digits, . _ - (max 96)");
  const repo = str("repo", true);
  const baseCommit = str("baseCommit", true);
  if (baseCommit && !COMMITISH_RE.test(baseCommit)) errors.push("baseCommit is not a commit-ish");
  const fixCommit = str("fixCommit", false);
  if (fixCommit && !COMMITISH_RE.test(fixCommit)) errors.push("fixCommit is not a commit-ish");
  const prompt = str("prompt", true);
  const testCommand = str("testCommand", true);
  const setup = str("setup", false);
  const title = str("title", false);
  const failToPass = stringList(row.failToPass, "failToPass", errors);
  const passToPass = stringList(row.passToPass, "passToPass", errors);
  const protectedPaths = stringList(row.protectedPaths, "protectedPaths", errors);
  const issues = stringList(row.issues, "issues", errors);
  if (row.failToPass === undefined) errors.push("failToPass is required (use [] for exit code)");
  for (const path of protectedPaths) {
    if (!isRelativeSafePath(path)) errors.push(`protectedPaths entry is not a repo path: ${path}`);
  }
  const overlap = failToPass.filter((id) => passToPass.includes(id));
  if (overlap.length) errors.push(`tests in both failToPass and passToPass: ${overlap.join(", ")}`);
  let timeoutSec: number | undefined;
  if (row.timeoutSec !== undefined) {
    if (
      typeof row.timeoutSec !== "number" ||
      !Number.isFinite(row.timeoutSec) ||
      row.timeoutSec < 10 ||
      row.timeoutSec > 6 * 3600
    ) {
      errors.push("timeoutSec must be a number of seconds between 10 and 21600");
    } else timeoutSec = Math.round(row.timeoutSec);
  }
  let language: BenchmarkLanguage | undefined;
  if (row.language !== undefined) {
    if (!BENCHMARK_LANGUAGES.includes(row.language as BenchmarkLanguage)) {
      errors.push(`language must be one of ${BENCHMARK_LANGUAGES.join(", ")}`);
    } else language = row.language as BenchmarkLanguage;
  }
  if (errors.length) return { ok: false, errors };
  const spec: BenchmarkCaseSpec = {
    id: id!,
    repo: repo!,
    baseCommit: baseCommit!,
    prompt: prompt!,
    testCommand: testCommand!,
    failToPass,
    passToPass,
    protectedPaths,
  };
  if (title) spec.title = title;
  if (fixCommit) spec.fixCommit = fixCommit;
  if (setup) spec.setup = setup;
  if (timeoutSec) spec.timeoutSec = timeoutSec;
  if (language) spec.language = language;
  if (issues.length) spec.issues = issues;
  return { ok: true, spec };
}

/** Parse a suite file's text: one spec, an array, or `{ cases: [...] }`. */
export function parseBenchmarkSuiteJson(text: string): {
  specs: BenchmarkCaseSpec[];
  errors: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { specs: [], errors: [`invalid JSON: ${err instanceof Error ? err.message : err}`] };
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { cases?: unknown }).cases)
      ? (parsed as { cases: unknown[] }).cases
      : [parsed];
  const specs: BenchmarkCaseSpec[] = [];
  const errors: string[] = [];
  rows.forEach((row, i) => {
    const result = validateBenchmarkCaseSpec(row);
    const label =
      row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
        ? (row as { id: string }).id
        : `#${i + 1}`;
    if (result.ok) specs.push(result.spec);
    else errors.push(...result.errors.map((e) => `${label}: ${e}`));
  });
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.id)) errors.push(`${spec.id}: duplicate id`);
    seen.add(spec.id);
  }
  return { specs, errors };
}

/** Prompt the agent gets for a spec case: the issue text plus how it is checked. */
export function benchmarkSpecPrompt(spec: BenchmarkCaseSpec): string {
  const lines = [spec.prompt.trim(), "", `Tests run with \`${spec.testCommand}\`.`];
  if (spec.protectedPaths.length) {
    lines.push(`Do not modify these files: ${spec.protectedPaths.join(", ")}.`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Test output parsing

export type TestOutcome = "passed" | "failed";

/**
 * Pull per-test outcomes out of runner output. Understands TAP (`node --test`), Node spec /
 * Jest / Vitest check marks, pytest (`-rA` summary and `-v`), `unittest -v`, `go test -v` and
 * `cargo test`. A test seen both passing and failing counts as failed.
 */
export function parseTestResults(output: string): Map<string, TestOutcome> {
  const out = new Map<string, TestOutcome>();
  const set = (name: string, outcome: TestOutcome) => {
    const id = name.trim();
    if (!id) return;
    if (out.get(id) === "failed") return;
    out.set(id, outcome);
  };
  // Strip ANSI colour codes (ESC [ … m).
  const text = output.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
  for (const line of text.split(/\r?\n/)) {
    let m: RegExpMatchArray | null;
    // TAP: "ok 1 - name", "not ok 2 - name # SKIP"
    if ((m = line.match(/^\s*(not ok|ok)\s+\d+\s*(?:-\s*)?(.*?)(\s+#\s*(SKIP|TODO).*)?$/i))) {
      if (m[3]) continue;
      set(m[2]!, m[1]!.toLowerCase() === "ok" ? "passed" : "failed");
      continue;
    }
    // go test -v: "--- PASS: TestName (0.00s)"
    if ((m = line.match(/^\s*--- (PASS|FAIL): (\S+)/))) {
      set(m[2]!, m[1] === "PASS" ? "passed" : "failed");
      continue;
    }
    // pytest -rA summary: "PASSED tests/test_x.py::test_y", "FAILED path::test - Error"
    if ((m = line.match(/^(PASSED|FAILED|ERROR|XPASS)\s+(\S+::\S+)/))) {
      set(m[2]!, m[1] === "PASSED" || m[1] === "XPASS" ? "passed" : "failed");
      continue;
    }
    // pytest -v: "tests/test_x.py::test_y PASSED [ 50%]"
    if ((m = line.match(/^(\S+::\S+)\s+(PASSED|FAILED|ERROR)\b/))) {
      set(m[1]!, m[2] === "PASSED" ? "passed" : "failed");
      continue;
    }
    // unittest -v: "test_x (mod.Class.test_x) ... ok" (3.11+) or "test_x (mod.Class) ... ok"
    if ((m = line.match(/^(\w+) \(([\w.]+)\)(?: \.\.\.)? .*?\b(ok|FAIL|ERROR)$/))) {
      const id = m[2]!.endsWith(`.${m[1]}`) ? m[2]! : `${m[2]}.${m[1]}`;
      set(id, m[3] === "ok" ? "passed" : "failed");
      continue;
    }
    // cargo test: "test path::name ... ok"
    if ((m = line.match(/^test (\S+) \.\.\. (ok|FAILED)$/))) {
      set(m[1]!, m[2] === "ok" ? "passed" : "failed");
      continue;
    }
    // Node spec / Jest / Vitest: "✔ name (1.2ms)", "✖ name", "✓ name", "× name"
    if ((m = line.match(/^\s*(✔|✓|√|✖|✕|×)\s+(.+?)(?:\s+\(\d+(?:\.\d+)?\s*m?s\))?\s*$/))) {
      set(m[2]!, "✔✓√".includes(m[1]!) ? "passed" : "failed");
    }
  }
  return out;
}

/**
 * Outcome of one required test id. Exact match first, then a parsed name that ends with the id
 * after a separator (`::`, `.`, `/`, ` > `), so `test_x` finds `tests/test_a.py::test_x`.
 */
export function lookupTestOutcome(
  results: Map<string, TestOutcome>,
  id: string,
): TestOutcome | undefined {
  const exact = results.get(id);
  if (exact) return exact;
  let found: TestOutcome | undefined;
  for (const [name, outcome] of results) {
    if (
      name.endsWith(`::${id}`) ||
      name.endsWith(`.${id}`) ||
      name.endsWith(`/${id}`) ||
      name.endsWith(` > ${id}`)
    ) {
      if (outcome === "failed") return "failed";
      found = outcome;
    }
  }
  return found;
}

export interface SpecScoreInput {
  failToPass: string[];
  passToPass: string[];
  /** Parsed outcomes of the scoring test run. */
  results: Map<string, TestOutcome>;
  testsRan: boolean;
  /** Exit code was 0. Only used when both lists are empty. */
  exitOk: boolean;
  editedProtected: string[];
  timedOut?: boolean;
  error?: string;
}

export interface SpecScore {
  status: "passed" | "failed" | "error";
  reason: string;
  /** Required tests that did not pass (missing counts as not passing). */
  failingTests: string[];
}

export function scoreSpecCase(input: SpecScoreInput): SpecScore {
  if (input.error) return { status: "error", reason: input.error, failingTests: [] };
  if (input.editedProtected.length) {
    return {
      status: "failed",
      reason: `protected paths edited: ${input.editedProtected.join(", ")}`,
      failingTests: [],
    };
  }
  if (!input.testsRan) return { status: "failed", reason: "tests did not run", failingTests: [] };
  const suffix = input.timedOut ? " (hit the time limit)" : "";
  if (!input.failToPass.length && !input.passToPass.length) {
    return input.exitOk
      ? { status: "passed", reason: `tests passed${suffix}`, failingTests: [] }
      : { status: "failed", reason: `tests failed${suffix}`, failingTests: [] };
  }
  const notPassing = (ids: string[]) =>
    ids.filter((id) => lookupTestOutcome(input.results, id) !== "passed");
  const f2p = notPassing(input.failToPass);
  const p2p = notPassing(input.passToPass);
  const failingTests = [...f2p, ...p2p];
  if (!failingTests.length) {
    return { status: "passed", reason: `all required tests pass${suffix}`, failingTests };
  }
  const parts: string[] = [];
  if (f2p.length) parts.push(`${f2p.length}/${input.failToPass.length} fail-to-pass still failing`);
  if (p2p.length) parts.push(`${p2p.length}/${input.passToPass.length} pass-to-pass broke`);
  return { status: "failed", reason: `${parts.join("; ")}${suffix}`, failingTests };
}

// ---------------------------------------------------------------------------------------------
// History, compare and the CI gate

const FINISHED = new Set(["passed", "failed", "error"]);

function isScored(row: BenchmarkCaseResult): boolean {
  return FINISHED.has(row.status);
}

export function benchmarkHarnessKey(run: { harness?: BenchmarkHarness }): string {
  return run.harness?.key ?? "unknown";
}

export interface BenchmarkHistoryRow {
  providerId: string;
  model: string;
  harnessVersion: string;
  runs: number;
  runIds: string[];
  /** Scored case runs (passed + failed + error). */
  cases: number;
  passed: number;
  passRate: number;
  usd?: number;
  usdPerCase?: number;
  medianMs?: number;
  tokens: number;
  firstAt: string;
  lastAt: string;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Pass rate, cost and time per (provider, model, harness version), newest first. */
export function aggregateBenchmarkHistory(
  runs: Array<Pick<BenchmarkRun, "id" | "createdAt" | "results" | "harness">>,
): BenchmarkHistoryRow[] {
  const groups = new Map<
    string,
    { row: BenchmarkHistoryRow; costs: number[]; times: number[]; runIds: Set<string> }
  >();
  for (const run of runs) {
    const harnessVersion = benchmarkHarnessKey(run);
    for (const result of run.results) {
      if (!isScored(result)) continue;
      const key = `${benchmarkTargetKey(result.target)}\u0000${harnessVersion}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          row: {
            providerId: result.target.providerId,
            model: result.target.model,
            harnessVersion,
            runs: 0,
            runIds: [],
            cases: 0,
            passed: 0,
            passRate: 0,
            tokens: 0,
            firstAt: run.createdAt,
            lastAt: run.createdAt,
          },
          costs: [],
          times: [],
          runIds: new Set(),
        };
        groups.set(key, group);
      }
      const { row } = group;
      group.runIds.add(run.id);
      row.cases += 1;
      if (result.status === "passed") row.passed += 1;
      if (typeof result.usd === "number") group.costs.push(result.usd);
      if (result.durationMs && result.durationMs > 0) group.times.push(result.durationMs);
      row.tokens += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
      if (run.createdAt < row.firstAt) row.firstAt = run.createdAt;
      if (run.createdAt > row.lastAt) row.lastAt = run.createdAt;
    }
  }
  return [...groups.values()]
    .map(({ row, costs, times, runIds }) => {
      const usd = costs.length ? costs.reduce((a, b) => a + b, 0) : undefined;
      return {
        ...row,
        runIds: [...runIds],
        runs: runIds.size,
        passRate: row.cases ? row.passed / row.cases : 0,
        usd,
        usdPerCase: usd !== undefined && costs.length ? usd / costs.length : undefined,
        medianMs: median(times),
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.model.localeCompare(b.model));
}

export type BenchmarkFlip =
  "fixed" | "broke" | "still-passing" | "still-failing" | "added" | "removed";

export interface BenchmarkCompareRow {
  caseId: string;
  /** `provider/model`, or `*` when two single-model runs are compared across models. */
  target: string;
  /** Share of attempts that passed (0–1); undefined when the case did not run on that side. */
  before?: number;
  after?: number;
  change: BenchmarkFlip;
}

export interface BenchmarkComparison {
  a: { id: string; harnessVersion: string; passRate: number; usd?: number; cases: number };
  b: { id: string; harnessVersion: string; passRate: number; usd?: number; cases: number };
  rows: BenchmarkCompareRow[];
  fixed: number;
  broke: number;
}

function sideStats(run: Pick<BenchmarkRun, "results">) {
  const rows = run.results.filter(isScored);
  const passed = rows.filter((r) => r.status === "passed").length;
  const costs = rows.map((r) => r.usd).filter((v): v is number => typeof v === "number");
  return {
    passRate: rows.length ? passed / rows.length : 0,
    usd: costs.length ? costs.reduce((x, y) => x + y, 0) : undefined,
    cases: rows.length,
  };
}

/** Which cases flipped between run `a` (before) and run `b` (after). A case passes at ≥ 50%. */
export function compareBenchmarkRuns(
  a: Pick<BenchmarkRun, "id" | "results" | "targets" | "harness">,
  b: Pick<BenchmarkRun, "id" | "results" | "targets" | "harness">,
): BenchmarkComparison {
  const keysA = new Set(a.targets.map(benchmarkTargetKey));
  const overlap = b.targets.some((t) => keysA.has(benchmarkTargetKey(t)));
  const crossModel = !overlap && a.targets.length === 1 && b.targets.length === 1;
  const keyOf = (row: BenchmarkCaseResult) =>
    `${row.caseId}\u0000${crossModel ? "*" : benchmarkTargetKey(row.target)}`;
  const rates = (run: Pick<BenchmarkRun, "results">) => {
    const map = new Map<string, { caseId: string; target: string; pass: number; n: number }>();
    for (const row of run.results) {
      if (!isScored(row)) continue;
      const key = keyOf(row);
      const cur = map.get(key) ?? {
        caseId: row.caseId,
        target: crossModel ? "*" : benchmarkTargetKey(row.target),
        pass: 0,
        n: 0,
      };
      cur.n += 1;
      if (row.status === "passed") cur.pass += 1;
      map.set(key, cur);
    }
    return map;
  };
  const before = rates(a);
  const after = rates(b);
  const rows: BenchmarkCompareRow[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const x = before.get(key);
    const y = after.get(key);
    const rateX = x ? x.pass / x.n : undefined;
    const rateY = y ? y.pass / y.n : undefined;
    let change: BenchmarkFlip;
    if (rateX === undefined) change = "added";
    else if (rateY === undefined) change = "removed";
    else {
      const passX = rateX >= 0.5;
      const passY = rateY >= 0.5;
      change =
        passX && passY
          ? "still-passing"
          : !passX && !passY
            ? "still-failing"
            : passY
              ? "fixed"
              : "broke";
    }
    const ref = (x ?? y)!;
    rows.push({ caseId: ref.caseId, target: ref.target, before: rateX, after: rateY, change });
  }
  const order: Record<BenchmarkFlip, number> = {
    broke: 0,
    fixed: 1,
    "still-failing": 2,
    added: 3,
    removed: 4,
    "still-passing": 5,
  };
  rows.sort(
    (p, q) =>
      order[p.change] - order[q.change] ||
      p.caseId.localeCompare(q.caseId) ||
      p.target.localeCompare(q.target),
  );
  return {
    a: { id: a.id, harnessVersion: benchmarkHarnessKey(a), ...sideStats(a) },
    b: { id: b.id, harnessVersion: benchmarkHarnessKey(b), ...sideStats(b) },
    rows,
    fixed: rows.filter((r) => r.change === "fixed").length,
    broke: rows.filter((r) => r.change === "broke").length,
  };
}

export interface BenchmarkBaseline {
  /** 0–1 pass rate of the committed reference run. */
  passRate: number;
  /** Allowed drop below `passRate` before CI fails. Default 0.1. */
  maxDrop?: number;
  runId?: string;
  model?: string;
  harnessVersion?: string;
  updatedAt?: string;
  note?: string;
}

export interface BenchmarkGateResult {
  ok: boolean;
  passRate: number;
  floor: number;
  scored: number;
  skipped: number;
  message: string;
}

/** CI gate: fail when the run's pass rate falls below `baseline.passRate - maxDrop`. */
export function benchmarkGate(
  run: Pick<BenchmarkRun, "results" | "status">,
  baseline: BenchmarkBaseline,
  maxDrop = baseline.maxDrop ?? 0.1,
): BenchmarkGateResult {
  const scored = run.results.filter(isScored);
  const skipped = run.results.filter((r) => r.status === "skipped").length;
  const passed = scored.filter((r) => r.status === "passed").length;
  const passRate = scored.length ? passed / scored.length : 0;
  const floor = Math.max(0, baseline.passRate - maxDrop);
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  if (run.status !== "done") {
    return {
      ok: false,
      passRate,
      floor,
      scored: scored.length,
      skipped,
      message: `run ended ${run.status}`,
    };
  }
  if (!scored.length) {
    return { ok: false, passRate, floor, scored: 0, skipped, message: "no case was scored" };
  }
  const ok = passRate + 1e-9 >= floor;
  return {
    ok,
    passRate,
    floor,
    scored: scored.length,
    skipped,
    message: `${passed}/${scored.length} passed (${pct(passRate)}); baseline ${pct(baseline.passRate)}, floor ${pct(floor)}${skipped ? `; ${skipped} skipped` : ""}${ok ? "" : " — below the floor"}`,
  };
}
