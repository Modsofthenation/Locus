import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_REPORT_FAILURES,
  decodeXmlEntities,
  formatTestReport,
  goTestJsonToText,
  mergeTestReports,
  parseCargoTestOutput,
  parseGoTestJson,
  parseJUnitXml,
  parseJestOutput,
  parsePytestOutput,
  parseTestOutput,
  parseVitestOutput,
  testFailureLabel,
  testReportFailedTests,
  type TestReport,
} from "./testReport.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "testReport");
const fixture = (name: string) => readFileSync(join(fixtureDir, name), "utf8");

describe("parseJUnitXml", () => {
  it("parses pytest --junitxml output with entities and skips", () => {
    const report = parseJUnitXml(fixture("pytest-junit.xml"))!;
    expect(report).toMatchObject({ framework: "junit", passed: 1, failed: 2, skipped: 1 });
    expect(report.durationMs).toBe(32);
    expect(report.failures.map((f) => f.name)).toEqual([
      "tests.test_a.test_bad",
      "tests.test_a.TestK.test_inner",
    ]);
    expect(report.failures[0]!.message).toMatch(/^AssertionError: one is not two\nassert 1 == 2/);
    expect(report.failures[1]!.message).toContain('ValueError("boom <&>")');
  });

  it("parses Maven surefire reports with CDATA, errors, and skipped cases", () => {
    const report = parseJUnitXml(fixture("surefire.xml"))!;
    expect(report).toMatchObject({ passed: 1, failed: 2, skipped: 1, durationMs: 45 });
    expect(report.failures[0]).toEqual({
      name: "com.example.CalculatorTest.divides",
      message: expect.stringMatching(
        /^expected: <2> but was: <3>\norg\.opentest4j\.AssertionFailedError/,
      ),
    });
    expect(report.failures[0]!.message).not.toContain("dividing 6 by 2");
    expect(report.failures[1]!.message).toMatch(/^boom\njava\.lang\.IllegalStateException: boom/);
  });

  it("parses Gradle reports", () => {
    const report = parseJUnitXml(fixture("gradle.xml"))!;
    expect(report).toMatchObject({ passed: 2, failed: 1, skipped: 0, durationMs: 1250 });
    expect(report.failures[0]!.name).toBe("org.acme.ParserTest.rejectsGarbage()");
    expect(report.failures[0]!.message).toContain('should reject "??"');
  });

  it("handles <testsuites>, nested suites, file attributes, and counts-only suites", () => {
    const xml = `<?xml version="1.0"?>
<testsuites tests="3">
  <testsuite name="outer" tests="3" failures="1" time="2">
    <testsuite name="inner" file="spec/a.spec.ts" tests="3" failures="1" time="2">
      <testcase name="a" classname="inner" time="0.5"/>
      <testcase name="inner b" classname="inner" time="0.5"><failure>nope</failure></testcase>
      <testcase name="c" classname="inner"><skipped/></testcase>
    </testsuite>
  </testsuite>
</testsuites>`;
    expect(parseJUnitXml(xml)).toEqual({
      framework: "junit",
      passed: 1,
      failed: 1,
      skipped: 1,
      durationMs: 2000,
      failures: [{ name: "inner b", file: "spec/a.spec.ts", message: "nope" }],
    });
    expect(
      parseJUnitXml('<testsuite tests="5" failures="1" errors="1" skipped="1" time="0.1"/>'),
    ).toEqual({
      framework: "junit",
      passed: 2,
      failed: 2,
      skipped: 1,
      durationMs: 100,
      failures: [],
    });
  });

  it("ignores non-JUnit text and survives truncated XML", () => {
    expect(parseJUnitXml("hello")).toBeUndefined();
    expect(parseJUnitXml("<html><body/></html>")).toBeUndefined();
    const truncated =
      '<testsuite tests="2"><testcase name="a"/><testcase name="b"><failure message="x"';
    expect(() => parseJUnitXml(truncated)).not.toThrow();
    expect(parseJUnitXml(truncated)?.passed).toBe(2);
  });

  it("decodes numeric and named entities", () => {
    expect(decodeXmlEntities("&lt;a&gt; &amp; &#65;&#x42; &bogus;")).toBe("<a> & AB &bogus;");
  });
});

describe("parseGoTestJson", () => {
  it("counts leaf tests, reports build failures, and keeps file:line", () => {
    const report = parseGoTestJson(fixture("go-test.jsonl"))!;
    expect(report).toMatchObject({ framework: "go", passed: 2, failed: 4, skipped: 1 });
    expect(report.durationMs).toBe(3);
    expect(report.failures.map((f) => f.name)).toEqual([
      "example.com/fx.TestBad",
      "example.com/fx.TestParent/leaf_bad",
      "example.com/fx/sub",
    ]);
    expect(report.failures[0]).toMatchObject({
      file: "a_test.go",
      message: "a_test.go:6: want 2 got 1",
    });
    expect(report.failures[2]!.message).toContain("undefined: undefinedThing");
  });

  it("rebuilds the plain transcript from events", () => {
    const text = goTestJsonToText(fixture("go-test.jsonl"));
    expect(text).toContain("--- FAIL: TestBad (0.00s)");
    expect(text).toContain("sub/b.go:3:23: undefined: undefinedThing");
    expect(text).not.toContain('"Action"');
    expect(goTestJsonToText("plain text")).toBe("plain text");
  });

  it("returns undefined for non-JSON output", () => {
    expect(parseGoTestJson("--- FAIL: TestX\nFAIL")).toBeUndefined();
  });
});

describe("parseCargoTestOutput", () => {
  it("parses libtest results, panic locations, and trims backtraces", () => {
    const report = parseCargoTestOutput(fixture("cargo-test.txt"))!;
    expect(report).toMatchObject({
      framework: "cargo",
      passed: 1,
      failed: 1,
      skipped: 1,
      durationMs: 200,
    });
    expect(report.failures).toEqual([
      {
        name: "tests::bad",
        file: "src/lib.rs",
        message: expect.stringContaining("assertion `left == right` failed"),
      },
    ]);
    expect(report.failures[0]!.message).not.toContain("stack backtrace");
  });

  it("sums several test binaries and doc-tests, and reads old panic syntax", () => {
    const text = [
      "running 2 tests",
      "test a::one ... ok",
      "test a::two ... FAILED",
      "",
      "failures:",
      "",
      "---- a::two stdout ----",
      "thread 'a::two' panicked at 'boom', src/a.rs:4:5",
      "",
      "failures:",
      "    a::two",
      "",
      "test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s",
      "running 1 test",
      "test src/lib.rs - two (line 1) ... ok",
      "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.30s",
    ].join("\n");
    const report = parseCargoTestOutput(text)!;
    expect(report).toMatchObject({ passed: 2, failed: 1, skipped: 0, durationMs: 310 });
    expect(report.failures[0]).toMatchObject({ name: "a::two", file: "src/a.rs" });
  });

  it("ignores unrelated text", () => {
    expect(parseCargoTestOutput("cargo build finished")).toBeUndefined();
  });
});

describe("parseVitestOutput / parseJestOutput", () => {
  it("parses vitest's default reporter", () => {
    const report = parseVitestOutput(fixture("vitest.txt"))!;
    expect(report).toEqual({
      framework: "vitest",
      passed: 2,
      failed: 1,
      skipped: 1,
      durationMs: 196,
      failures: [
        {
          name: "math > fails",
          file: "src/math.test.ts",
          message: expect.stringMatching(/^AssertionError: expected 2 to be 3/),
        },
      ],
    });
  });

  it("strips ANSI colors and tolerates FAIL lines without a summary", () => {
    const esc = String.fromCharCode(27);
    const report = parseVitestOutput(
      `${esc}[31mFAIL${esc}[39m  src/a.test.ts > spawn budget\nError: nope\n`,
    )!;
    expect(report.failures).toEqual([
      { name: "spawn budget", file: "src/a.test.ts", message: "Error: nope" },
    ]);
    expect(report.failed).toBe(1);
  });

  it("parses Jest's default reporter", () => {
    const report = parseJestOutput(fixture("jest.txt"))!;
    expect(report).toEqual({
      framework: "jest",
      passed: 2,
      failed: 1,
      skipped: 1,
      durationMs: 512,
      failures: [
        {
          name: "math › fails",
          file: "src/math.test.js",
          message: expect.stringMatching(/^expect\(received\)\.toBe\(expected\)/),
        },
      ],
    });
    expect(parseVitestOutput(fixture("jest.txt"))).toBeUndefined();
  });
});

describe("parsePytestOutput", () => {
  it("parses the short summary and the final counts line", () => {
    const report = parsePytestOutput(fixture("pytest.txt"))!;
    expect(report).toEqual({
      framework: "pytest",
      passed: 1,
      failed: 2,
      skipped: 1,
      durationMs: 30,
      failures: [
        { name: "test_bad", file: "tests/test_a.py", message: "AssertionError: one is not two" },
        { name: "TestK::test_inner", file: "tests/test_a.py", message: "ValueError: boom <&>" },
      ],
    });
  });

  it("counts errors, xfail, and xpass and reads banner-style summaries", () => {
    const report = parsePytestOutput(
      [
        "ERROR tests/test_b.py - ModuleNotFoundError: No module named 'requests'",
        "==== 1 failed, 4 passed, 1 error, 2 xfailed, 1 xpassed, 3 warnings in 1.50s ====",
      ].join("\n"),
    )!;
    expect(report).toMatchObject({ passed: 5, failed: 2, skipped: 2, durationMs: 1500 });
    expect(report.failures[0]).toMatchObject({
      name: "tests/test_b.py (collection error)",
      file: "tests/test_b.py",
    });
  });

  it("parses an all-green quiet run", () => {
    expect(parsePytestOutput("....\n4 passed in 0.02s")).toEqual({
      framework: "pytest",
      passed: 4,
      failed: 0,
      skipped: 0,
      durationMs: 20,
      failures: [],
    });
  });
});

describe("parseTestOutput", () => {
  it("sniffs the framework when no hint is given", () => {
    expect(parseTestOutput(fixture("go-test.jsonl"))?.framework).toBe("go");
    expect(parseTestOutput(fixture("cargo-test.txt"))?.framework).toBe("cargo");
    expect(parseTestOutput(fixture("pytest.txt"))?.framework).toBe("pytest");
    expect(parseTestOutput(fixture("vitest.txt"))?.framework).toBe("vitest");
    expect(parseTestOutput(fixture("jest.txt"))?.framework).toBe("jest");
    expect(parseTestOutput(fixture("surefire.xml"))?.framework).toBe("junit");
    expect(parseTestOutput("make: *** [test] Error 2")).toBeUndefined();
    expect(parseTestOutput("")).toBeUndefined();
  });

  it("prefers the hinted parser and falls back to sniffing", () => {
    expect(parseTestOutput(fixture("pytest.txt"), "pytest")?.framework).toBe("pytest");
    expect(parseTestOutput(fixture("cargo-test.txt"), "go-json")?.framework).toBe("cargo");
  });
});

describe("report helpers", () => {
  const a: TestReport = {
    framework: "go",
    passed: 3,
    failed: 1,
    skipped: 0,
    durationMs: 100,
    failures: [{ name: "pkg.TestA", file: "a_test.go", message: "want 1\nmore" }],
  };
  const b: TestReport = {
    framework: "pytest",
    passed: 1,
    failed: 1,
    skipped: 2,
    failures: [{ name: "tests/x.py::t", file: "tests/x.py" }],
  };

  it("merges counts, durations, and failures", () => {
    expect(mergeTestReports([a, undefined, b])).toEqual({
      framework: "mixed",
      passed: 4,
      failed: 2,
      skipped: 2,
      durationMs: 100,
      failures: [...a.failures, ...b.failures],
    });
    expect(mergeTestReports([undefined])).toBeUndefined();
    expect(mergeTestReports([a])).toBe(a);
  });

  it("labels failures without repeating the file", () => {
    expect(testFailureLabel(a.failures[0]!)).toBe("a_test.go > pkg.TestA");
    expect(testFailureLabel(b.failures[0]!)).toBe("tests/x.py::t");
    expect(testReportFailedTests(mergeTestReports([a, b]))).toEqual([
      "a_test.go > pkg.TestA",
      "tests/x.py::t",
    ]);
    expect(testReportFailedTests(undefined)).toEqual([]);
  });

  it("formats a short summary", () => {
    expect(formatTestReport(a)).toBe(
      "Test report (go): 1 failed, 3 passed in 0.1s.\n- a_test.go > pkg.TestA: want 1",
    );
    const many: TestReport = {
      ...b,
      failures: Array.from({ length: 12 }, (_, i) => ({ name: `t${i}` })),
    };
    expect(formatTestReport(many, 10)).toMatch(/- … 2 more$/);
  });

  it("caps failures per report", () => {
    const lines = Array.from({ length: 80 }, (_, i) => `FAILED tests/t.py::t${i} - boom`);
    lines.push("80 failed in 1.00s");
    const report = parsePytestOutput(lines.join("\n"))!;
    expect(report.failed).toBe(80);
    expect(report.failures).toHaveLength(MAX_REPORT_FAILURES);
  });
});
