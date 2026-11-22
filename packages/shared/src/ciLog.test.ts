import { describe, expect, it } from "vitest";
import {
  ciFixKey,
  condenseCiLog,
  formatCiFailures,
  formatCiFixPrompt,
  isCiErrorLine,
  normalizeCiLog,
  parseCiFixState,
  parseFailingTestIds,
  planCiFix,
  stripAnsi,
} from "./ciLog.js";

const ESC = "\u001b";

function ts(i: number): string {
  return `2026-11-14T10:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.1234567Z `;
}

function noise(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix} line ${i} doing ordinary work`);
}

/** GitHub Actions job log: setup noise, npm ci, vitest failure, npm ERR, exit code. */
const GITHUB_VITEST = [
  "##[group]Run actions/checkout@v4",
  "with:",
  "  repository: acme/app",
  "##[endgroup]",
  ...noise("checkout", 120),
  "##[group]Run npm ci",
  ...noise("npm ci", 200),
  "added 812 packages in 14s",
  "##[endgroup]",
  "##[group]Run npm test",
  "> app@1.0.0 test",
  "> vitest run",
  "",
  ` ${ESC}[32m✓${ESC}[39m src/math.test.ts (4 tests) 3ms`,
  ...noise("vitest ok", 80),
  ` ${ESC}[31m❯${ESC}[39m src/cart.test.ts (3 tests | 1 failed) 9ms`,
  `   ${ESC}[31m×${ESC}[39m cart > applies discount 5ms`,
  "     → expected 90 to be 80 // Object.is equality",
  "",
  `${ESC}[31m⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯${ESC}[39m`,
  "",
  ` FAIL  src/cart.test.ts > cart > applies discount`,
  "AssertionError: expected 90 to be 80 // Object.is equality",
  "",
  "- Expected",
  "+ Received",
  "",
  "- 80",
  "+ 90",
  "",
  " ❯ src/cart.test.ts:14:30",
  "",
  " Test Files  1 failed | 11 passed (12)",
  "      Tests  1 failed | 47 passed (48)",
  "   Duration  2.31s",
  "",
  "##[error]Process completed with exit code 1.",
]
  .map((line, i) => `${ts(i)}${line}`)
  .join("\n");

const PYTEST = [
  "============================= test session starts ==============================",
  "platform linux -- Python 3.12.1, pytest-8.0.0, pluggy-1.4.0",
  "rootdir: /builds/acme/svc",
  "collected 58 items",
  "",
  ...noise("tests/test_misc.py .", 150),
  "tests/test_api.py ..F.                                                     [ 98%]",
  "tests/test_db.py .                                                         [100%]",
  "",
  "=================================== FAILURES ===================================",
  "_____________________________ test_create_user ________________________________",
  "",
  "    def test_create_user(client):",
  '        resp = client.post("/users", json={"name": "a"})',
  ">       assert resp.status_code == 201",
  "E       assert 500 == 201",
  "E        +  where 500 = <Response [500]>.status_code",
  "",
  "tests/test_api.py:22: AssertionError",
  "=========================== short test summary info ============================",
  "FAILED tests/test_api.py::test_create_user - assert 500 == 201",
  "========================= 1 failed, 57 passed in 3.21s =========================",
  "Cleaning up project directory and file based variables",
  "ERROR: Job failed: exit code 1",
].join("\n");

const GO_TEST = [
  "go: downloading github.com/stretchr/testify v1.9.0",
  ...noise("=== RUN   TestOk", 120),
  "=== RUN   TestParseConfig",
  "    config_test.go:41: ",
  "        \tError Trace:\tconfig_test.go:41",
  '        \tError:      \tNot equal: expected: "prod" actual  : "dev"',
  "--- FAIL: TestParseConfig (0.00s)",
  "=== RUN   TestServer/handles_timeout",
  "--- FAIL: TestServer/handles_timeout (1.02s)",
  "FAIL",
  "FAIL\tgithub.com/acme/svc/internal/config\t0.012s",
  "ok  \tgithub.com/acme/svc/internal/http\t0.231s",
  "FAIL",
  "Error: Process completed with exit code 1.",
].join("\n");

const TSC = [
  "> app@1.0.0 typecheck",
  "> tsc --noEmit",
  "",
  ...noise("tsc progress", 60),
  "src/cart.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/api/users.ts(40,15): error TS2339: Property 'emailAddress' does not exist on type 'User'.",
  ...noise("more output", 60),
  "",
  "Found 2 errors in 2 files.",
  "",
  "Errors  Files",
  "     1  src/cart.ts:12",
  "     1  src/api/users.ts:40",
  "npm error Lifecycle script `typecheck` failed with error:",
  "npm error code 2",
].join("\n");

const CARGO = [
  "running 3 tests",
  "test parser::tests::parses_empty ... ok",
  "test parser::tests::rejects_bad ... FAILED",
  "",
  "failures:",
  "",
  "---- parser::tests::rejects_bad stdout ----",
  "thread 'parser::tests::rejects_bad' panicked at src/parser.rs:88:9:",
  "assertion failed: result.is_err()",
  "",
  "test result: FAILED. 2 passed; 1 failed; 0 ignored",
].join("\n");

describe("normalizeCiLog", () => {
  it("strips ANSI, Actions timestamps, groups, and carriage-return progress", () => {
    const lines = normalizeCiLog(
      `${ts(0)}##[group]Run npm test\n${ts(1)}${ESC}[31mred${ESC}[0m\nprogress 10%\rprogress 100%\n${ts(2)}##[error]boom`,
    );
    expect(lines).toEqual(["Run npm test", "red", "progress 100%", "Error: boom"]);
  });

  it("drops GitLab section markers", () => {
    const lines = normalizeCiLog(
      `section_start:1700000000:step_script\r${ESC}[0KExecuting "step_script"\nsection_end:1700000001:step_script\r${ESC}[0K`,
    );
    expect(lines[0]).toBe('Executing "step_script"');
  });

  it("stripAnsi handles OSC hyperlinks", () => {
    expect(stripAnsi(`${ESC}]8;;https://x${ESC}\\link${ESC}]8;;${ESC}\\`)).toBe("link");
  });
});

describe("isCiErrorLine", () => {
  it("matches common failure lines and skips zero summaries", () => {
    expect(isCiErrorLine("src/a.ts(1,1): error TS2322: nope")).toBe(true);
    expect(isCiErrorLine("--- FAIL: TestX (0.00s)")).toBe(true);
    expect(isCiErrorLine("npm ERR! code ELIFECYCLE")).toBe(true);
    expect(isCiErrorLine("Found 0 errors.")).toBe(false);
    expect(isCiErrorLine("eslint --no-error-on-unmatched-pattern .")).toBe(false);
    expect(isCiErrorLine("all good")).toBe(false);
  });
});

describe("condenseCiLog", () => {
  it("keeps the vitest failure, summary, and exit code within budget", () => {
    const out = condenseCiLog(GITHUB_VITEST, { maxChars: 2_000 });
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(2_000);
    expect(out.text).toContain("AssertionError: expected 90 to be 80");
    expect(out.text).toContain("Tests  1 failed | 47 passed");
    expect(out.text).toContain("Process completed with exit code 1");
    expect(out.text).toMatch(/lines omitted/);
    expect(out.text).not.toContain(ESC);
    expect(out.text).not.toMatch(/2026-11-14T/);
    expect(out.text).not.toContain("npm ci line 150");
    expect(out.exitCode).toBe(1);
    expect(out.failingTests).toContain("src/cart.test.ts > cart > applies discount");
    expect(out.failingTests).toContain("cart > applies discount");
  });

  it("keeps the pytest failure block and parses the test id", () => {
    const out = condenseCiLog(PYTEST, { maxChars: 1_500 });
    expect(out.text).toContain("E       assert 500 == 201");
    expect(out.text).toContain("FAILED tests/test_api.py::test_create_user");
    expect(out.text).not.toContain("tests/test_misc.py . line 70");
    expect(out.failingTests).toEqual(["tests/test_api.py::test_create_user"]);
    expect(out.exitCode).toBe(1);
  });

  it("keeps go test failures and parses test names", () => {
    const out = condenseCiLog(GO_TEST, { maxChars: 1_200 });
    expect(out.text).toContain("--- FAIL: TestParseConfig");
    expect(out.text).toContain('Not equal: expected: "prod"');
    expect(out.failingTests).toEqual(["TestParseConfig", "TestServer/handles_timeout"]);
  });

  it("keeps tsc errors (first region) and the npm summary (tail)", () => {
    const out = condenseCiLog(TSC, { maxChars: 1_000 });
    expect(out.text).toContain("error TS2322");
    expect(out.text).toContain("error TS2339");
    expect(out.text).toContain("npm error code 2");
    expect(out.text).not.toContain("tsc progress line 20");
    expect(out.failingTests).toEqual([]);
  });

  it("parses cargo test failures", () => {
    expect(condenseCiLog(CARGO).failingTests).toEqual(["parser::tests::rejects_bad"]);
  });

  it("returns short logs whole", () => {
    const out = condenseCiLog("Error: tiny\n");
    expect(out).toMatchObject({ text: "Error: tiny", truncated: false, regions: 1 });
  });

  it("clips a log with no error lines to head and tail", () => {
    const out = condenseCiLog(noise("plain", 2_000).join("\n"), { maxChars: 1_000 });
    expect(out.regions).toBe(0);
    expect(out.text).toContain("plain line 0");
    expect(out.text).toContain("plain line 1999");
    expect(out.text.length).toBeLessThanOrEqual(1_000);
  });
});

describe("structured fallback", () => {
  it("uses the TestReport parsers when no simple pattern matches (JUnit XML)", () => {
    const xml = [
      '<?xml version="1.0"?>',
      '<testsuite name="api" tests="2" failures="1">',
      '  <testcase classname="api.UserTest" name="createsUser"><failure message="boom">trace</failure></testcase>',
      '  <testcase classname="api.UserTest" name="listsUsers"/>',
      "</testsuite>",
    ].join("\n");
    expect(condenseCiLog(xml).failingTests.join(" ")).toContain("createsUser");
  });
});

describe("parseFailingTestIds", () => {
  it("reads jest bullets", () => {
    expect(parseFailingTestIds("  ● Cart › applies discount\n")).toEqual([
      "Cart › applies discount",
    ]);
  });
});

describe("formatCiFailures / formatCiFixPrompt", () => {
  const report = {
    headSha: "abc123def4567890",
    pending: ["deploy-preview"],
    failures: [
      {
        name: "test",
        status: "failure" as const,
        source: "actions" as const,
        id: "1",
        logAvailable: true,
        log: condenseCiLog(PYTEST, { maxChars: 1_500 }),
      },
      {
        name: "ci/circleci",
        status: "failure" as const,
        source: "status" as const,
        logAvailable: false,
        note: "Logs not available for commit statuses.",
      },
    ],
  };

  it("fences logs and lists checks without logs", () => {
    const text = formatCiFailures(report);
    expect(text).toContain("Failing checks at abc123def456: 2");
    expect(text).toContain("Still running: deploy-preview");
    expect(text).toContain("Failing tests: tests/test_api.py::test_create_user");
    expect(text).toContain("```text");
    expect(text).toContain("Logs not available for commit statuses.");
  });

  it("builds a reproduce-first, same-branch fix prompt", () => {
    const prompt = formatCiFixPrompt({
      pull: {
        url: "https://github.com/a/b/pull/7",
        title: "Cart",
        headRef: "feat/cart",
        baseRef: "main",
      },
      number: 7,
      report,
      attempt: 1,
      maxAttempts: 2,
    });
    expect(prompt).toContain("CI failed on this pull request: test, ci/circleci.");
    expect(prompt).toContain("Head commit: abc123def4567890");
    expect(prompt).toContain("Reproduce the failure locally");
    expect(prompt).toContain("Never create a new branch, never force-push");
    expect(prompt).toContain("attempt 1 of 2");
    expect(prompt).toContain("E       assert 500 == 201");
  });
});

describe("planCiFix", () => {
  const fail = (name: string) => ({ name, status: "failure" });
  const pass = (name: string) => ({ name, status: "success" });

  it("starts, then de-dupes the same head and check set", () => {
    const first = planCiFix(undefined, { headSha: "s1", checks: [fail("test"), pass("lint")] });
    expect(first).toMatchObject({ action: "start", attempt: 1 });
    const again = planCiFix(first.state, { headSha: "s1", checks: [fail("test")] });
    expect(again.action).toBe("duplicate");
  });

  it("caps after N consecutive attempts on the same check and asks a human", () => {
    let state = planCiFix(undefined, { headSha: "s1", checks: [fail("test")] }).state;
    const second = planCiFix(state, { headSha: "s2", checks: [fail("test")] });
    expect(second).toMatchObject({ action: "start", attempt: 2 });
    state = second.state;
    const third = planCiFix(state, {
      headSha: "s3",
      checks: [fail("test")],
      now: new Date("2026-11-14T00:00:00Z"),
    });
    expect(third.action).toBe("cap");
    if (third.action === "cap") {
      expect(third.capped).toEqual(["test"]);
      expect(third.summary).toContain("stopped after 2 attempts");
      expect(third.state.stoppedAt).toBe("2026-11-14T00:00:00.000Z");
    }
    // Same capped head again is a duplicate, not a second needs-human.
    expect(planCiFix(third.state, { headSha: "s3", checks: [fail("test")] }).action).toBe(
      "duplicate",
    );
  });

  it("resets the counter when the check passes", () => {
    let state = planCiFix(undefined, { headSha: "s1", checks: [fail("test")] }).state;
    state = planCiFix(state, { headSha: "s2", checks: [fail("test")] }).state;
    state = planCiFix(state, { headSha: "s3", checks: [pass("test")] }).state;
    expect(state.attempts).toBeUndefined();
    expect(planCiFix(state, { headSha: "s4", checks: [fail("test")] })).toMatchObject({
      action: "start",
      attempt: 1,
    });
  });

  it("honours a configured cap of 1", () => {
    const state = planCiFix(undefined, {
      headSha: "s1",
      checks: [fail("e2e")],
      maxAttempts: 1,
    }).state;
    expect(planCiFix(state, { headSha: "s2", checks: [fail("e2e")], maxAttempts: 1 }).action).toBe(
      "cap",
    );
  });

  it("does nothing without failures and round-trips state", () => {
    expect(planCiFix(undefined, { headSha: "s", checks: [pass("a")] }).action).toBe("none");
    expect(ciFixKey("s", ["b", "a", "a"])).toBe("s|a,b");
    expect(parseCiFixState({ lastKey: "k", attempts: { a: 2, b: "x" } })).toEqual({
      lastKey: "k",
      attempts: { a: 2 },
    });
    expect(parseCiFixState(null)).toBeUndefined();
  });
});
