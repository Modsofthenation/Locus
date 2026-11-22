import { describe, expect, it } from "vitest";
import type { ChatMessage, ToolCall } from "./session.js";
import {
  evidenceWorkerRank,
  isLintCommand,
  isTypecheckCommand,
  lastCheckRuns,
  outOfScopeFiles,
  scoreWorkerEvidence,
  taskScopePaths,
  diffFilePaths,
  formatWorkerRankPrompt,
  heuristicWorkerRank,
  isTestCommand,
  lastTestRun,
  parseWorkerRank,
  type WorkerAttempt,
} from "./workerCompare.js";

function exec(command: string, result: string, extra: Partial<ToolCall> = {}): ToolCall {
  return {
    id: command,
    name: "exec",
    arguments: { command },
    result,
    startedAt: "t",
    finishedAt: "t",
    ...extra,
  };
}

function msg(...toolCalls: ToolCall[]): Pick<ChatMessage, "toolCalls"> {
  return { toolCalls };
}

const attempt = (over: Partial<WorkerAttempt> & { id: string }): WorkerAttempt => ({
  role: over.id,
  model: "m",
  status: "idle",
  stat: { files: 1, insertions: 10, deletions: 0 },
  ...over,
});

describe("isTestCommand", () => {
  it("matches common runners only", () => {
    expect(isTestCommand("npm test")).toBe(true);
    expect(isTestCommand("npx vitest run src")).toBe(true);
    expect(isTestCommand("go test ./...")).toBe(true);
    expect(isTestCommand("npm run build")).toBe(false);
  });
});

describe("lastTestRun", () => {
  it("is none without a test command", () => {
    expect(lastTestRun([msg(exec("ls", "exit code: 0"))])).toEqual({ state: "none" });
    expect(lastTestRun([])).toEqual({ state: "none" });
  });

  it("uses the last finished test command", () => {
    const messages = [
      msg(exec("npm test", "1 failed\nexit code: 1")),
      msg(exec("npm test", "all passed\nexit code: 0"), exec("git status", "")),
    ];
    expect(lastTestRun(messages)).toEqual({ state: "pass", command: "npm test" });
  });

  it("reports a failure and skips calls still running", () => {
    const messages = [
      msg(exec("pytest", "", { error: "boom" })),
      msg({
        id: "x",
        name: "exec",
        arguments: { command: "pytest -k a" },
        startedAt: "t",
      }),
    ];
    expect(lastTestRun(messages)).toEqual({ state: "fail", command: "pytest" });
  });
});

describe("diffFilePaths", () => {
  it("lists b-side paths once in order", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "+x",
      "diff --git a/dev/null b/new file.ts",
      "diff --git a/src/a.ts b/src/a.ts",
    ].join("\n");
    expect(diffFilePaths(patch)).toEqual(["src/a.ts", "new file.ts"]);
  });
});

describe("heuristicWorkerRank", () => {
  it("orders tests pass > not run > fail, then diff size, then cost", () => {
    const ranked = heuristicWorkerRank([
      attempt({ id: "fail", tests: "fail", stat: { files: 1, insertions: 1, deletions: 0 } }),
      attempt({ id: "none", tests: "none" }),
      attempt({ id: "big", tests: "pass", stat: { files: 3, insertions: 90, deletions: 10 } }),
      attempt({ id: "small-dear", tests: "pass", usd: 0.5 }),
      attempt({ id: "small-cheap", tests: "pass", usd: 0.1 }),
    ]);
    expect(ranked.source).toBe("heuristic");
    expect(ranked.entries.map((e) => e.id)).toEqual([
      "small-cheap",
      "small-dear",
      "big",
      "none",
      "fail",
    ]);
    expect(ranked.entries[0]).toEqual({
      id: "small-cheap",
      rank: 1,
      reason: "Tests pass · 10 lines · $0.10",
      evidence: ["Tests pass", "10 lines", "$0.10"],
    });
  });

  it("puts empty and errored attempts last", () => {
    const ranked = heuristicWorkerRank([
      attempt({ id: "empty", tests: "pass", stat: { files: 0, insertions: 0, deletions: 0 } }),
      attempt({ id: "err", status: "error", tests: "pass" }),
      attempt({ id: "ok", tests: "fail" }),
    ]);
    expect(ranked.entries.map((e) => [e.id, e.reason])).toEqual([
      ["ok", "Tests fail · 10 lines"],
      ["empty", "No changes"],
      ["err", "Errored"],
    ]);
  });
});

describe("formatWorkerRankPrompt", () => {
  it("includes the task, each attempt's facts, and clips long diffs", () => {
    const prompt = formatWorkerRankPrompt("Fix the login bug", [
      attempt({ id: "a", role: "1", tests: "pass", usd: 0.25, diff: "+ok" }),
      attempt({ id: "b", role: "2", diff: "x".repeat(10_000) }),
    ]);
    expect(prompt).toContain("Fix the login bug");
    expect(prompt).toContain("## Attempt 1");
    expect(prompt).toContain("tests: pass");
    expect(prompt).toContain("cost: $0.2500");
    expect(prompt).toContain("… diff clipped");
    expect(prompt).toContain('"ranking"');
  });
});

describe("parseWorkerRank", () => {
  const rows = [
    attempt({ id: "a", role: "1" }),
    attempt({ id: "b", role: "2" }),
    attempt({ id: "c", role: "3" }),
  ];

  it("maps labels to ids, keeps reasons to one line, and appends missing attempts", () => {
    const text =
      'Sure:\n{"ranking":[{"attempt":"Attempt 2","reason":"Handles the edge case\\nmore"},{"attempt":"1","reason":"Works"},{"attempt":"2","reason":"dup"}]}';
    expect(parseWorkerRank(text, rows)).toEqual([
      { id: "b", rank: 1, reason: "Handles the edge case" },
      { id: "a", rank: 2, reason: "Works" },
      { id: "c", rank: 3, reason: "Not ranked" },
    ]);
  });

  it("is undefined for junk", () => {
    expect(parseWorkerRank("no json here", rows)).toBeUndefined();
    expect(parseWorkerRank('{"ranking":[{"attempt":"9"}]}', rows)).toBeUndefined();
    expect(parseWorkerRank("{not json}", rows)).toBeUndefined();
  });
});

describe("lint / typecheck commands", () => {
  it("classifies common runners", () => {
    expect(isLintCommand("npm run lint")).toBe(true);
    expect(isLintCommand("npx eslint src")).toBe(true);
    expect(isLintCommand("ruff check .")).toBe(true);
    expect(isLintCommand("npm test")).toBe(false);
    expect(isTypecheckCommand("npm run typecheck")).toBe(true);
    expect(isTypecheckCommand("npx tsc --noEmit")).toBe(true);
    expect(isTypecheckCommand("mypy app")).toBe(true);
    expect(isTypecheckCommand("npm run build")).toBe(false);
  });

  it("reads the last test, lint, and typecheck results", () => {
    const runs = lastCheckRuns([
      msg(exec("npm run lint", "exit code: 1")),
      msg(exec("npm run typecheck", "exit code: 0"), exec("npm test", "exit code: 0")),
    ]);
    expect(runs.tests.state).toBe("pass");
    expect(runs.lint).toEqual({ state: "fail", command: "npm run lint" });
    expect(runs.typecheck).toEqual({ state: "pass", command: "npm run typecheck" });
  });
});

describe("task scope", () => {
  it("extracts named paths and directories", () => {
    expect(
      taskScopePaths("Fix the redirect in `src/auth/login.ts` and add a test under tests/auth/."),
    ).toEqual(["src/auth/login.ts", "tests/auth/"]);
    expect(taskScopePaths("Make the button blue")).toEqual([]);
    expect(taskScopePaths("see https://example.com/a/b")).toEqual([]);
  });

  it("flags files outside the named paths and lockfiles always", () => {
    const task = "Fix the redirect in src/auth/login.ts";
    expect(
      outOfScopeFiles(
        [
          "src/auth/login.ts",
          "src/auth/session.ts",
          "src/auth/login.test.ts",
          "test/login.spec.ts",
          "src/billing/invoice.ts",
          "package-lock.json",
        ],
        task,
      ),
    ).toEqual(["src/billing/invoice.ts", "package-lock.json"]);
    expect(outOfScopeFiles(["src/x.ts", "yarn.lock"], "Make it faster")).toEqual(["yarn.lock"]);
  });
});

describe("evidenceWorkerRank", () => {
  it("prefers passing tests, then green lint/typecheck, then in-scope, then smaller diffs", () => {
    const ranked = evidenceWorkerRank([
      attempt({ id: "scope", tests: "pass", outOfScope: ["src/billing/x.ts"] }),
      attempt({ id: "lintfail", tests: "pass", lint: "fail" }),
      attempt({
        id: "best",
        tests: "pass",
        typecheck: "pass",
        lint: "pass",
        stat: { files: 2, insertions: 40, deletions: 2 },
      }),
      attempt({ id: "tiny-untested", stat: { files: 1, insertions: 1, deletions: 0 } }),
      attempt({ id: "red", tests: "fail" }),
    ]);
    expect(ranked.source).toBe("heuristic");
    expect(ranked.entries.map((row) => row.id)).toEqual([
      "best",
      "scope",
      "lintfail",
      "tiny-untested",
      "red",
    ]);
    expect(ranked.entries[0]!.evidence).toEqual([
      "Tests pass",
      "Typecheck pass",
      "Lint pass",
      "42 lines",
    ]);
    expect(ranked.entries[1]!.evidence).toContain("1 file outside scope (src/billing/x.ts)");
  });

  it("uses the model to break ties within a tier but never over evidence", () => {
    const rows = [
      attempt({
        id: "a",
        role: "1",
        tests: "pass",
        stat: { files: 1, insertions: 5, deletions: 0 },
      }),
      attempt({
        id: "b",
        role: "2",
        tests: "pass",
        stat: { files: 1, insertions: 50, deletions: 0 },
      }),
      attempt({ id: "c", role: "3", tests: "fail" }),
    ];
    const model = [
      { id: "c", rank: 1, reason: "Cleanest approach" },
      { id: "b", rank: 2, reason: "Handles the edge case" },
      { id: "a", rank: 3, reason: "Misses null input" },
    ];
    const ranked = evidenceWorkerRank(rows, model);
    expect(ranked.source).toBe("model");
    expect(ranked.entries.map((row) => [row.id, row.reason])).toEqual([
      ["b", "Handles the edge case"],
      ["a", "Misses null input"],
      ["c", "Cleanest approach"],
    ]);
    expect(ranked.entries[2]!.evidence?.[0]).toBe("Tests fail");
  });

  it("scores errored attempts last", () => {
    expect(scoreWorkerEvidence(attempt({ id: "e", error: "boom" })).tier[0]).toBe(1);
  });
});
