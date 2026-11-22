import { describe, expect, it } from "vitest";
import type { BenchmarkCaseResult, BenchmarkRun } from "./benchmark.js";
import {
  aggregateBenchmarkHistory,
  benchmarkGate,
  benchmarkSpecPrompt,
  compareBenchmarkRuns,
  lookupTestOutcome,
  parseBenchmarkSuiteJson,
  parseTestResults,
  scoreSpecCase,
  validateBenchmarkCaseSpec,
} from "./benchmarkSpec.js";

const SPEC = {
  id: "acme-1a2b3c4",
  repo: "../..",
  baseCommit: "1a2b3c4d5e",
  fixCommit: "9f8e7d6c5b",
  prompt: "Dates before 1970 render as NaN.",
  setup: "npm ci",
  testCommand: "npm test",
  failToPass: ["formats negative epochs"],
  passToPass: ["formats today"],
  protectedPaths: ["test/date.test.ts"],
  timeoutSec: 600,
  language: "typescript",
};

describe("validateBenchmarkCaseSpec", () => {
  it("accepts a full spec and trims strings", () => {
    const result = validateBenchmarkCaseSpec({ ...SPEC, prompt: "  Dates break.  " });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.spec).toMatchObject({ id: "acme-1a2b3c4", prompt: "Dates break." });
  });

  it("reports every problem", () => {
    const result = validateBenchmarkCaseSpec({
      id: "Bad Id",
      repo: "",
      baseCommit: "-rf",
      prompt: "x",
      testCommand: "npm test",
      failToPass: ["a", 3],
      passToPass: ["a"],
      protectedPaths: ["../escape.js", "/abs.js"],
      timeoutSec: 1,
      language: "cobol",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.errors.join("\n");
    expect(text).toMatch(/id must be/);
    expect(text).toMatch(/repo must be a non-empty string/);
    expect(text).toMatch(/baseCommit is not a commit-ish/);
    expect(text).toMatch(/failToPass must be a list/);
    expect(text).toMatch(/escape\.js/);
    expect(text).toMatch(/abs\.js/);
    expect(text).toMatch(/timeoutSec/);
    expect(text).toMatch(/language/);
  });

  it("requires failToPass and rejects a test in both lists", () => {
    const { failToPass: _drop, ...rest } = SPEC;
    void _drop;
    expect(validateBenchmarkCaseSpec(rest)).toMatchObject({ ok: false });
    const both = validateBenchmarkCaseSpec({ ...SPEC, passToPass: ["formats negative epochs"] });
    expect(both.ok).toBe(false);
    expect(validateBenchmarkCaseSpec({ ...SPEC, failToPass: [], passToPass: [] }).ok).toBe(true);
  });

  it("parses one spec, an array, or { cases } and flags duplicate ids", () => {
    expect(parseBenchmarkSuiteJson(JSON.stringify(SPEC)).specs).toHaveLength(1);
    expect(
      parseBenchmarkSuiteJson(JSON.stringify([SPEC, { ...SPEC, id: "b" }])).specs,
    ).toHaveLength(2);
    const dup = parseBenchmarkSuiteJson(JSON.stringify({ cases: [SPEC, SPEC] }));
    expect(dup.errors.join()).toMatch(/duplicate id/);
    expect(parseBenchmarkSuiteJson("{nope").errors[0]).toMatch(/invalid JSON/);
  });

  it("tells the agent how it is checked without naming the hidden tests", () => {
    const result = validateBenchmarkCaseSpec(SPEC);
    if (!result.ok) throw new Error("bad spec");
    const prompt = benchmarkSpecPrompt(result.spec);
    expect(prompt).toMatch(/npm test/);
    expect(prompt).toMatch(/test\/date\.test\.ts/);
    expect(prompt).not.toMatch(/negative epochs/);
  });
});

describe("parseTestResults", () => {
  it("reads TAP from node --test", () => {
    const tap = [
      "TAP version 13",
      "# Subtest: adds one",
      "ok 1 - adds one",
      "not ok 2 - rounds up",
      "ok 3 - skipped one # SKIP",
    ].join("\n");
    const map = parseTestResults(tap);
    expect(map.get("adds one")).toBe("passed");
    expect(map.get("rounds up")).toBe("failed");
    expect(map.has("skipped one")).toBe(false);
  });

  it("reads go, pytest, unittest, cargo and check-mark reporters", () => {
    const map = parseTestResults(
      [
        "=== RUN   TestWrap",
        "--- FAIL: TestWrap (0.00s)",
        "    --- PASS: TestWrap/short (0.00s)",
        "--- PASS: TestEmpty (0.00s)",
        "PASSED tests/test_a.py::test_ok",
        "FAILED tests/test_a.py::test_bad - AssertionError: x",
        "tests/test_b.py::test_v PASSED                    [ 50%]",
        "test_minor (test_semver.CompareTests.test_minor) ... FAIL",
        "test_equal (test_semver.CompareTests) ... ok",
        "test parser::tests::empty ... ok",
        "  ✔ formats today (0.8ms)",
        "  ✖ formats negative epochs (1.1ms)",
        "\x1b[32m✓\x1b[39m colored pass",
      ].join("\n"),
    );
    expect(map.get("TestWrap")).toBe("failed");
    expect(map.get("TestWrap/short")).toBe("passed");
    expect(map.get("TestEmpty")).toBe("passed");
    expect(map.get("tests/test_a.py::test_ok")).toBe("passed");
    expect(map.get("tests/test_a.py::test_bad")).toBe("failed");
    expect(map.get("tests/test_b.py::test_v")).toBe("passed");
    expect(map.get("test_semver.CompareTests.test_minor")).toBe("failed");
    expect(map.get("test_semver.CompareTests.test_equal")).toBe("passed");
    expect(map.get("parser::tests::empty")).toBe("passed");
    expect(map.get("formats today")).toBe("passed");
    expect(map.get("formats negative epochs")).toBe("failed");
    expect(map.get("colored pass")).toBe("passed");
  });

  it("keeps a failure when the same test also reports a pass", () => {
    const map = parseTestResults("not ok 1 - flaky\nok 2 - flaky");
    expect(map.get("flaky")).toBe("failed");
  });

  it("looks up a short id by suffix", () => {
    const map = parseTestResults(
      "PASSED tests/test_a.py::test_ok\nFAILED tests/test_a.py::test_bad",
    );
    expect(lookupTestOutcome(map, "test_ok")).toBe("passed");
    expect(lookupTestOutcome(map, "test_bad")).toBe("failed");
    expect(lookupTestOutcome(map, "test_missing")).toBeUndefined();
  });
});

describe("scoreSpecCase", () => {
  const base = {
    failToPass: ["new behaviour"],
    passToPass: ["old behaviour"],
    testsRan: true,
    exitOk: false,
    editedProtected: [] as string[],
  };

  it("passes only when fail-to-pass and pass-to-pass tests all pass", () => {
    const ok = scoreSpecCase({
      ...base,
      results: parseTestResults("ok 1 - new behaviour\nok 2 - old behaviour\nnot ok 3 - unrelated"),
    });
    expect(ok).toMatchObject({ status: "passed", failingTests: [] });
  });

  it("fails when a fail-to-pass test still fails or is missing", () => {
    const still = scoreSpecCase({
      ...base,
      results: parseTestResults("not ok 1 - new behaviour\nok 2 - old behaviour"),
    });
    expect(still).toMatchObject({ status: "failed", failingTests: ["new behaviour"] });
    expect(still.reason).toMatch(/fail-to-pass/);
    const missing = scoreSpecCase({ ...base, results: parseTestResults("ok 2 - old behaviour") });
    expect(missing.failingTests).toEqual(["new behaviour"]);
  });

  it("fails when a pass-to-pass test breaks", () => {
    const broke = scoreSpecCase({
      ...base,
      results: parseTestResults("ok 1 - new behaviour\nnot ok 2 - old behaviour"),
    });
    expect(broke).toMatchObject({ status: "failed", failingTests: ["old behaviour"] });
    expect(broke.reason).toMatch(/pass-to-pass broke/);
  });

  it("fails an agent that edited protected paths even if everything passes", () => {
    const edited = scoreSpecCase({
      ...base,
      editedProtected: ["test/a.test.ts"],
      results: parseTestResults("ok 1 - new behaviour\nok 2 - old behaviour"),
    });
    expect(edited).toMatchObject({ status: "failed" });
    expect(edited.reason).toMatch(/protected paths edited: test\/a\.test\.ts/);
  });

  it("falls back to the exit code when no test ids are listed", () => {
    const input = { ...base, failToPass: [], passToPass: [], results: new Map() };
    expect(scoreSpecCase({ ...input, exitOk: true }).status).toBe("passed");
    expect(scoreSpecCase({ ...input, exitOk: false }).status).toBe("failed");
    expect(scoreSpecCase({ ...input, testsRan: false, exitOk: true }).status).toBe("failed");
    expect(scoreSpecCase({ ...input, error: "boom" }).status).toBe("error");
  });
});

const A = { providerId: "p", model: "a" };
const B = { providerId: "p", model: "b" };

function result(
  caseId: string,
  target: typeof A,
  status: BenchmarkCaseResult["status"],
  extra = {},
) {
  return { caseId, target, attempt: 1, status, ...extra } as BenchmarkCaseResult;
}

function run(
  id: string,
  createdAt: string,
  harness: string,
  results: BenchmarkCaseResult[],
): BenchmarkRun {
  return {
    id,
    createdAt,
    status: "done",
    targets: [...new Map(results.map((r) => [r.target.model, r.target])).values()],
    caseIds: [...new Set(results.map((r) => r.caseId))],
    repeat: 1,
    results,
    harness: { locusVersion: "0.20.0", configHash: harness, key: `0.20.0.${harness}` },
  };
}

describe("benchmark history", () => {
  it("aggregates pass rate, cost and time per model and harness version", () => {
    const rows = aggregateBenchmarkHistory([
      run("r1", "2026-11-01T00:00:00Z", "h1", [
        result("x", A, "passed", { usd: 0.01, durationMs: 1000, inputTokens: 10 }),
        result("y", A, "failed", { usd: 0.03, durationMs: 3000, outputTokens: 5 }),
        result("z", A, "skipped"),
      ]),
      run("r2", "2026-11-02T00:00:00Z", "h1", [result("x", A, "passed", { durationMs: 2000 })]),
      run("r3", "2026-11-03T00:00:00Z", "h2", [result("x", A, "failed"), result("x", B, "passed")]),
    ]);
    const h1 = rows.find((r) => r.model === "a" && r.harnessVersion === "0.20.0.h1")!;
    expect(h1).toMatchObject({ runs: 2, cases: 3, passed: 2, tokens: 15, medianMs: 2000 });
    expect(h1.passRate).toBeCloseTo(2 / 3);
    expect(h1.usd).toBeCloseTo(0.04);
    expect(h1.usdPerCase).toBeCloseTo(0.02);
    expect(h1.lastAt).toBe("2026-11-02T00:00:00Z");
    expect(rows.filter((r) => r.harnessVersion === "0.20.0.h2")).toHaveLength(2);
    expect(rows[0]!.lastAt).toBe("2026-11-03T00:00:00Z");
  });

  it("lists flipped cases between two runs", () => {
    const before = run("r1", "2026-11-01T00:00:00Z", "h1", [
      result("x", A, "passed"),
      result("y", A, "failed"),
      result("z", A, "passed"),
      result("gone", A, "passed"),
    ]);
    const after = run("r2", "2026-11-02T00:00:00Z", "h2", [
      result("x", A, "failed"),
      result("y", A, "passed"),
      result("z", A, "passed"),
      result("new", A, "error"),
    ]);
    const cmp = compareBenchmarkRuns(before, after);
    expect(cmp).toMatchObject({ fixed: 1, broke: 1 });
    expect(cmp.rows.map((r) => `${r.caseId}:${r.change}`)).toEqual([
      "x:broke",
      "y:fixed",
      "new:added",
      "gone:removed",
      "z:still-passing",
    ]);
    expect(cmp.a.harnessVersion).toBe("0.20.0.h1");
    expect(cmp.b.passRate).toBeCloseTo(0.5);
  });

  it("compares two single-model runs across models by case", () => {
    const cmp = compareBenchmarkRuns(
      run("r1", "2026-11-01T00:00:00Z", "h", [result("x", A, "failed")]),
      run("r2", "2026-11-02T00:00:00Z", "h", [result("x", B, "passed")]),
    );
    expect(cmp.rows).toEqual([{ caseId: "x", target: "*", before: 0, after: 1, change: "fixed" }]);
  });

  it("gates CI on the baseline pass rate minus the allowed drop", () => {
    const r = run("r", "2026-11-01T00:00:00Z", "h", [
      result("a", A, "passed"),
      result("b", A, "passed"),
      result("c", A, "failed"),
      result("d", A, "skipped"),
    ]);
    expect(benchmarkGate(r, { passRate: 0.75 }, 0.1)).toMatchObject({
      ok: true,
      scored: 3,
      skipped: 1,
    });
    const low = benchmarkGate(r, { passRate: 0.9, maxDrop: 0.1 });
    expect(low.ok).toBe(false);
    expect(low.message).toMatch(/below the floor/);
    expect(benchmarkGate({ ...r, status: "error" }, { passRate: 0 }).ok).toBe(false);
    expect(benchmarkGate({ ...r, results: [] }, { passRate: 0 }).ok).toBe(false);
  });
});
