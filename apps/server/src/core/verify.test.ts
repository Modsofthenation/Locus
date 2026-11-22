import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatVerifyGateFailure,
  isBlockingVerifyFailure,
  runWorkspaceNpmScript,
} from "./hooks.js";
import {
  clearWorkspaceVerifyPlanCache,
  globToRegExp,
  loadWorkspaceVerifyPlan,
  runWorkspaceVerify,
  workspaceVerifyCommands,
} from "./verify.js";

const isWin = process.platform === "win32";

function hasBinary(name: string): boolean {
  try {
    execFileSync(isWin ? "where" : "which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let dir = "";

beforeEach(async () => {
  clearWorkspaceVerifyPlanCache();
  dir = await mkdtemp(join(tmpdir(), "locus verify "));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeVerify(verify: unknown): Promise<void> {
  await mkdir(join(dir, ".locus"), { recursive: true });
  await writeFile(join(dir, ".locus", "environment.json"), JSON.stringify({ verify }), "utf8");
}

async function writeScript(name: string, body: string): Promise<void> {
  await mkdir(join(dir, name, ".."), { recursive: true });
  await writeFile(join(dir, name), body, "utf8");
}

function git(...args: string[]): void {
  execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
}

const PYTEST_RED = `console.log([
  "FAILED tests/test_a.py::test_bad - AssertionError: one is not two",
  "1 failed, 2 passed in 0.05s",
].join("\\n")); process.exit(1);`;

describe("runWorkspaceVerify", () => {
  it("skips when there is no workspace or nothing to run", async () => {
    expect(await runWorkspaceVerify(undefined, "test")).toEqual({
      ran: false,
      ok: true,
      output: "",
    });
    expect(await runWorkspaceVerify(dir, "test")).toEqual({ ran: false, ok: true, output: "" });
  });

  it.skipIf(isWin)("runs a configured command and attaches a structured report", async () => {
    await writeScript("red.js", PYTEST_RED);
    await writeVerify({ test: "node red.js" });
    const result = await runWorkspaceVerify(dir, "test", { timeoutMs: 20_000 });
    expect(result).toMatchObject({
      ran: true,
      ok: false,
      cwd: dir,
      command: "node red.js",
      exitCode: 1,
      failureKind: "test-failure",
      failedTests: ["tests/test_a.py > test_bad"],
      report: { framework: "pytest", passed: 2, failed: 1, skipped: 0, durationMs: 50 },
    });
    expect(isBlockingVerifyFailure(result)).toBe(true);
    const message = formatVerifyGateFailure("git_push", result);
    expect(message).toMatch(/Harness blocked git_push: tests failed\./);
    expect(message).toContain("Re-run `node red.js` before retrying.");
    expect(message).toContain("Test report (pytest): 1 failed, 2 passed");
    expect(await workspaceVerifyCommands(dir)).toEqual(["node red.js"]);
  });

  it.skipIf(isWin)("maps a missing toolchain to a non-blocking failure", async () => {
    await writeVerify({ test: "locus-definitely-missing-tool test" });
    const result = await runWorkspaceVerify(dir, "test", { timeoutMs: 20_000 });
    expect(result).toMatchObject({
      ran: true,
      ok: false,
      failureKind: "missing-toolchain",
      retryable: true,
    });
    expect(isBlockingVerifyFailure(result)).toBe(false);
  });

  it.skipIf(isWin)("reads fresh JUnit XML named by verify.junit", async () => {
    await writeScript(
      "junit.js",
      `require("fs").mkdirSync("reports/unit", { recursive: true });
require("fs").writeFileSync("reports/unit/TEST-a.xml",
  '<testsuite tests="2" failures="1"><testcase classname="A" name="ok"/>' +
  '<testcase classname="A" name="bad"><failure message="nope"/></testcase></testsuite>');
process.exit(1);`,
    );
    await writeVerify({ test: "node junit.js", junit: "reports/**/TEST-*.xml" });
    const result = await runWorkspaceVerify(dir, "test", { timeoutMs: 20_000 });
    expect(result.report).toEqual({
      framework: "junit",
      passed: 1,
      failed: 1,
      skipped: 0,
      failures: [{ name: "A.bad", message: "nope" }],
    });
    expect(result.failedTests).toEqual(["A.bad"]);
  });

  it("fails closed on an invalid verify block", async () => {
    await writeVerify({ test: 7 });
    const result = await runWorkspaceVerify(dir, "test");
    expect(result).toMatchObject({ ran: true, ok: false, failureKind: "runner", retryable: true });
    expect(result.output).toContain("verify.test must be a command string or false");
  });

  it("delegates npm-only repos to the npm planner unchanged", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { lint: 'node -e "console.log(54321); process.exit(1)"' } }),
    );
    const viaVerify = await runWorkspaceVerify(dir, "lint", { timeoutMs: 10_000 });
    const viaNpm = await runWorkspaceNpmScript(dir, "lint", 10_000);
    const strip = ({ durationMs: _d, ...rest }: typeof viaNpm) => rest;
    expect(strip(viaVerify)).toEqual(strip(viaNpm));
    expect(viaVerify).toMatchObject({ command: "npm run lint", failureKind: "script-failure" });
    expect(await runWorkspaceVerify(dir, "test")).toEqual({ ran: false, ok: true, output: "" });
  });

  it("skips slow preset lint for per-edit feedback", async () => {
    await writeFile(join(dir, "go.mod"), "module example.com/x\n\ngo 1.21\n");
    expect(await runWorkspaceVerify(dir, "lint", { skipSlow: true })).toEqual({
      ran: false,
      ok: true,
      output: "",
    });
    const plan = await loadWorkspaceVerifyPlan(dir);
    expect(plan.targets[0]!.steps.test?.run).toBe("go test -json ./...");
  });

  it.skipIf(isWin || !hasBinary("git"))(
    "scopes polyglot projects to changed files against main",
    async () => {
      await writeScript("root.js", 'console.log("ROOT RAN")');
      await writeScript("svc/svc.js", 'console.log("SVC RAN")');
      await writeVerify({
        test: "node root.js",
        projects: [{ root: "svc", test: "node svc.js" }],
      });
      git("init", "-q", "-b", "main");
      git("-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A");
      git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init");
      git("checkout", "-qb", "feature");

      await writeScript("svc/handler.go", "package svc\n");
      const svcOnly = await runWorkspaceVerify(dir, "test", { timeoutMs: 20_000 });
      expect(svcOnly).toMatchObject({ ran: true, ok: true, command: "node svc.js" });
      expect(svcOnly.output).toContain("SVC RAN");
      expect(svcOnly.output).not.toContain("ROOT RAN");

      await writeScript("lib.txt", "x");
      const both = await runWorkspaceVerify(dir, "test", { timeoutMs: 20_000 });
      expect(both).toMatchObject({ ran: true, ok: true, command: "node root.js; node svc.js" });
      expect(both.output).toMatch(
        /=== \.: node root\.js ===\nROOT RAN[\s\S]*=== svc: node svc\.js ===\nSVC RAN/,
      );

      await rm(join(dir, "lib.txt"));
      await rm(join(dir, "svc", "handler.go"));
      await writeScript("docs/notes.md", "# notes");
      expect(await runWorkspaceVerify(dir, "test")).toEqual({ ran: false, ok: true, output: "" });

      const full = await runWorkspaceVerify(dir, "test", { full: true, timeoutMs: 20_000 });
      expect(full.command).toBe("node root.js; node svc.js");
    },
  );

  it.skipIf(isWin || !hasBinary("git"))(
    "scopes to changed files against origin's default branch when it is not main",
    async () => {
      await writeScript("root.js", 'console.log("ROOT RAN")');
      await writeScript("svc/svc.js", 'console.log("SVC RAN")');
      await writeVerify({
        test: "node root.js",
        projects: [{ root: "svc", test: "node svc.js" }],
      });
      git("init", "-q", "-b", "develop");
      git("-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A");
      git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init");
      git("update-ref", "refs/remotes/origin/develop", "HEAD");
      git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
      git("branch", "-qm", "develop", "feature");

      // Committed on the feature branch, so only the base diff can see it.
      await writeScript("svc/handler.go", "package svc\n");
      git("-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A");
      git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "svc");
      const svcOnly = await runWorkspaceVerify(dir, "test", { timeoutMs: 20_000 });
      expect(svcOnly).toMatchObject({ ran: true, ok: true, command: "node svc.js" });
    },
  );

  it.skipIf(isWin)("ignores linked worktrees and nested clones inside the workspace", async () => {
    // Python at the root, npm projects below it (the signiq8 + e2e layout).
    await writeFile(join(dir, "pyproject.toml"), '[project]\nname = "root"\n');
    // Each nested npm project carries its own lockfile, so it would be its own target.
    for (const nested of [".worktrees/feature/e2e", "tools/wt", "vendor-clone", "libs/sub"]) {
      await writeScript(
        `${nested}/package.json`,
        JSON.stringify({ name: nested, scripts: { test: "node -e 0" } }),
      );
      await writeScript(`${nested}/package-lock.json`, "{}");
    }
    await writeScript("tools/wt/.git", "gitdir: /repo/.git/worktrees/wt\n");
    await mkdir(join(dir, "vendor-clone", ".git"), { recursive: true });
    await writeScript("libs/sub/.git", "gitdir: ../../.git/modules/libs/sub\n");

    const roots = (await loadWorkspaceVerifyPlan(dir)).targets.map((target) => target.root);
    expect(roots).toContain(".");
    expect(roots).toContain("libs/sub");
    expect(roots.some((root) => root.includes("worktrees"))).toBe(false);
    expect(roots).not.toContain("tools/wt");
    expect(roots).not.toContain("vendor-clone");
  });

  it.skipIf(isWin)("keeps a red project blocking when another lacks its toolchain", async () => {
    await writeScript("red.js", PYTEST_RED);
    await writeVerify({
      test: "node red.js",
      projects: [{ root: "svc", test: "locus-definitely-missing-tool" }],
    });
    await mkdir(join(dir, "svc"), { recursive: true });
    const result = await runWorkspaceVerify(dir, "test", { timeoutMs: 20_000, full: true });
    expect(result.failureKind).toBe("test-failure");
    expect(isBlockingVerifyFailure(result)).toBe(true);
  });

  it.skipIf(isWin || !hasBinary("go"))(
    "runs the Go preset with -json and parses it",
    async () => {
      await writeFile(join(dir, "go.mod"), "module example.com/fx\n\ngo 1.21\n");
      await writeFile(
        join(dir, "a_test.go"),
        'package fx\n\nimport "testing"\n\nfunc TestOk(t *testing.T) {}\nfunc TestBad(t *testing.T) { t.Fatal("nope") }\n',
      );
      const result = await runWorkspaceVerify(dir, "test", { timeoutMs: 120_000 });
      expect(result).toMatchObject({
        ran: true,
        ok: false,
        command: "go test ./...",
        failureKind: "test-failure",
        report: { framework: "go", passed: 1, failed: 1 },
        failedTests: ["a_test.go > example.com/fx.TestBad"],
      });
      expect(result.output).toContain("--- FAIL: TestBad");
      expect(result.output).not.toContain('"Action"');
    },
    150_000,
  );

  it.skipIf(isWin || !hasBinary("pytest"))(
    "runs the pytest preset with a temp JUnit report",
    async () => {
      await writeFile(join(dir, "pytest.ini"), "[pytest]\n");
      await writeScript(
        "tests/test_a.py",
        "def test_ok():\n    assert True\n\ndef test_bad():\n    assert 1 == 2\n",
      );
      const result = await runWorkspaceVerify(dir, "test", { timeoutMs: 120_000 });
      expect(result).toMatchObject({
        ran: true,
        ok: false,
        command: "pytest -q",
        report: { framework: "junit", passed: 1, failed: 1 },
      });
      expect(result.failedTests?.[0]).toContain("test_bad");
    },
    150_000,
  );
});

describe("globToRegExp", () => {
  it("supports **, *, and ?", () => {
    const re = globToRegExp("**/target/surefire-reports/TEST-*.xml");
    expect(re.test("target/surefire-reports/TEST-a.xml")).toBe(true);
    expect(re.test("core/target/surefire-reports/TEST-a.xml")).toBe(true);
    expect(re.test("core/target/surefire-reports/sub/TEST-a.xml")).toBe(false);
    expect(globToRegExp("build/test-results/**/*.xml").test("build/test-results/test/x.xml")).toBe(
      true,
    );
    expect(globToRegExp("./out/r?.xml").test("out/r1.xml")).toBe(true);
    expect(globToRegExp("a.b").test("axb")).toBe(false);
  });
});
