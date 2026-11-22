import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBenchmarkSuiteJson, parseTestResults } from "@locus/shared";
import {
  classifyVerification,
  draftPrompt,
  isSourcePath,
  isTestPath,
  issueRefs,
  mineBenchmarkCases,
  parseMiningLog,
  pickCandidates,
  specRepoField,
} from "./benchmarkMiner.js";
import { git } from "./benchmarkRepo.js";
import { detectTestCommand } from "./detectTestCommand.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function temp(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

async function write(root: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, ...rel.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
  }
}

async function commit(root: string, message: string, files: Record<string, string>) {
  await write(root, files);
  await git(["add", "-A"], root);
  await git(["commit", "-q", "--no-verify", "-m", message], root);
  return (await git(["rev-parse", "HEAD"], root)).trim();
}

const TEST = (body: string) =>
  ['import assert from "node:assert/strict";', 'import { test } from "node:test";', body, ""].join(
    "\n",
  );

describe("miner helpers", () => {
  it("tells test files from source files", () => {
    for (const path of [
      "src/a.test.ts",
      "test/util.js",
      "pkg/__tests__/x.tsx",
      "wrap_test.go",
      "tests/test_api.py",
      "app/models_test.py",
      "spec/user_spec.rb",
    ]) {
      expect(isTestPath(path), path).toBe(true);
      expect(isSourcePath(path), path).toBe(false);
    }
    for (const path of ["src/a.ts", "lib/x.py", "main.go", "src/lib.rs"]) {
      expect(isSourcePath(path), path).toBe(true);
    }
    for (const path of [
      "README.md",
      "package-lock.json",
      "dist/a.js",
      "types/x.d.ts",
      "docs/a.ts",
    ]) {
      expect(isSourcePath(path), path).toBe(false);
    }
  });

  it("parses the log format and picks single-parent source + test commits", () => {
    const log = [
      "\x1eaaaaaaa1\x1fbbbbbbb1\x1ffix: rounding (#12)\x1fLong body.\n\nSigned-off-by: X <x@y>\x1f\nsrc/a.js\ntest/a.test.js\n",
      "\x1eccccccc1\x1fddddddd1\x1fdocs\x1f\x1f\nREADME.md\n",
      "\x1eeeeeeee1\x1fa1 b1\x1fmerge\x1f\x1f\nsrc/a.js\ntest/a.test.js\n",
      "\x1efffffff1\x1f1111111\x1fonly tests\x1f\x1f\ntest/a.test.js\n",
    ].join("");
    const commits = parseMiningLog(log);
    expect(commits).toHaveLength(4);
    expect(commits[0]).toMatchObject({
      sha: "aaaaaaa1",
      parents: ["bbbbbbb1"],
      subject: "fix: rounding (#12)",
      files: ["src/a.js", "test/a.test.js"],
    });
    const picked = pickCandidates(commits);
    expect(picked.map((c) => c.sha)).toEqual(["aaaaaaa1"]);
    expect(picked[0]).toMatchObject({ testFiles: ["test/a.test.js"], issues: ["#12"] });
    expect(pickCandidates(commits, { requireIssue: true })).toHaveLength(1);
    expect(pickCandidates(commits.slice(1), { requireIssue: true })).toHaveLength(0);
  });

  it("drafts an issue-style prompt and finds issue references", () => {
    expect(
      draftPrompt("fix(api): handle empty body", "Crashes on {}.\n\nCo-Authored-By: A <a@b>"),
    ).toBe("handle empty body\n\nCrashes on {}.");
    expect(draftPrompt("Handle empty body", "")).toBe("Handle empty body");
    expect(issueRefs("Fixes #42 and PROJ-7, see https://github.com/o/r/issues/9")).toEqual([
      "https://github.com/o/r/issues/9",
      "#42",
      "PROJ-7",
    ]);
  });

  it("verifies fail-to-pass and pass-to-pass from the two test runs", () => {
    const base = { ok: false, results: parseTestResults("ok 1 - old\nnot ok 2 - new") };
    const fix = { ok: true, results: parseTestResults("ok 1 - old\nok 2 - new\nok 3 - added") };
    expect(classifyVerification(base, fix)).toMatchObject({
      verified: true,
      failToPass: ["new", "added"],
      passToPass: ["old"],
    });
    expect(classifyVerification({ ...base, ok: true }, fix)).toMatchObject({ verified: false });
    expect(classifyVerification(base, { ...fix, ok: false })).toMatchObject({ verified: false });
    expect(
      classifyVerification({ ok: false, results: new Map() }, { ok: true, results: new Map() }),
    ).toMatchObject({ verified: true, failToPass: [] });
  });

  it("writes a relative repo path for specs stored inside the repo", () => {
    expect(specRepoField("/r/app", "/r/app/.locus/benchmarks")).toBe("../..");
    expect(specRepoField("/r/app", "/elsewhere")).toBe("/r/app");
  });
});

describe("detectTestCommand", () => {
  it("detects npm, go, cargo and python projects", async () => {
    const root = await temp("locus-detect-");
    const at = async (name: string, files: Record<string, string>) => {
      const dir = join(root, name);
      await write(dir, files);
      return detectTestCommand(dir);
    };
    expect(
      await at("npm", {
        "package.json": '{"scripts":{"test":"vitest run"},"devDependencies":{"typescript":"5"}}',
        "package-lock.json": "{}",
      }),
    ).toEqual({
      command: "npm test",
      setup: "npm ci --no-audit --no-fund",
      language: "typescript",
    });
    expect(
      await at("npm-default", {
        "package.json": '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}',
      }),
    ).toBeUndefined();
    expect((await at("go", { "go.mod": "module x\n" }))?.command).toBe("go test -v ./...");
    expect((await at("rust", { "Cargo.toml": "[package]\n" }))?.command).toBe("cargo test");
    expect(await at("pytest", { "pyproject.toml": "[tool.pytest.ini_options]\n" })).toMatchObject({
      command: "python3 -m pytest -rA",
      language: "python",
    });
    expect((await at("unittest", { "setup.py": "" }))?.command).toMatch(/unittest/);
    expect(await at("empty", { "notes.txt": "" })).toBeUndefined();
  });

  it("prefers the repo's .locus/environment.json verify.test and install", async () => {
    const root = await temp("locus-detect-verify-");
    const dir = join(root, "configured");
    await write(dir, {
      "go.mod": "module x\n",
      ".locus/environment.json": JSON.stringify({
        install: "make deps",
        verify: { test: "make test-verbose" },
      }),
    });
    expect(detectTestCommand(dir)).toEqual({
      command: "make test-verbose",
      setup: "make deps",
      language: "go",
    });
    const off = join(root, "disabled");
    await write(off, {
      "go.mod": "module x\n",
      ".locus/environment.json": JSON.stringify({ verify: { test: false } }),
    });
    expect(detectTestCommand(off)?.command).toBe("go test -v ./...");
  });
});

describe("mineBenchmarkCases", () => {
  it("keeps only commits whose new tests fail at base and pass at the fix", async () => {
    const repo = await temp("locus-mine-repo-");
    await git(["init", "-q"], repo);
    await commit(repo, "Initial", {
      "package.json": JSON.stringify({
        name: "mini",
        private: true,
        type: "module",
        scripts: { test: "node --test --test-reporter=tap test/*.test.js" },
      }),
      "src/round.js": "export const round = (n) => Math.floor(n);\n",
      "test/round.test.js": TEST(
        'import { round } from "../src/round.js";\ntest("rounds down whole", () => assert.equal(round(2), 2));',
      ),
    });
    const fix = await commit(repo, "fix: round halves up (#12)\n\nround(2.5) returned 2.", {
      "src/round.js": "export const round = (n) => Math.round(n);\n",
      "test/round.test.js": TEST(
        'import { round } from "../src/round.js";\ntest("rounds down whole", () => assert.equal(round(2), 2));\ntest("rounds halves up", () => assert.equal(round(2.5), 3));',
      ),
    });
    await commit(repo, "Update readme", { "README.md": "# mini\n" });
    // Source + test change, but the new test already passes on the old code.
    await commit(repo, "Refactor and add a test", {
      "src/round.js": "export const round = (n) => Math.round(n); // tidy\n",
      "test/extra.test.js": TEST(
        'import { round } from "../src/round.js";\ntest("rounds 1", () => assert.equal(round(1), 1));',
      ),
    });

    const out = join(repo, ".locus", "benchmarks");
    const progress: string[] = [];
    const result = await mineBenchmarkCases({
      repo,
      limit: 5,
      outDir: out,
      onProgress: (line) => progress.push(line),
    });
    expect(result.scanned).toBe(4);
    expect(result.candidates.map((c) => [c.subject, c.kept])).toEqual([
      ["Refactor and add a test", false],
      ["fix: round halves up (#12)", true],
    ]);
    expect(result.candidates[0]!.reason).toMatch(/already pass/);
    expect(result.specs).toHaveLength(1);
    const spec = result.specs[0]!;
    expect(spec).toMatchObject({
      baseCommit: (await git(["rev-parse", `${fix}^`], repo)).trim(),
      fixCommit: fix,
      prompt: "round halves up (#12)\n\nround(2.5) returned 2.",
      testCommand: "npm test",
      failToPass: ["rounds halves up"],
      passToPass: ["rounds down whole"],
      protectedPaths: ["test/round.test.js"],
      language: "javascript",
      issues: ["#12"],
      repo: "../..",
    });
    const file = join(out, `${spec.id}.json`);
    expect(existsSync(file)).toBe(true);
    const parsed = parseBenchmarkSuiteJson(readFileSync(file, "utf8"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.specs[0]!.id).toBe(spec.id);
    expect(progress.join("\n")).toMatch(/Scanned 4 commits, 2 candidates/);
  }, 60_000);

  it("honours --since and refuses a folder that is not a repo", async () => {
    const repo = await temp("locus-mine-since-");
    await git(["init", "-q"], repo);
    await write(repo, { "a.txt": "x" });
    await git(["add", "-A"], repo);
    const old = {
      GIT_AUTHOR_DATE: "2001-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2001-01-01T00:00:00Z",
    };
    await git(["commit", "-q", "-m", "Old"], repo, { env: old });
    expect((await mineBenchmarkCases({ repo, since: "2000-01-01" })).scanned).toBe(1);
    const result = await mineBenchmarkCases({ repo, since: "2010-01-01" });
    expect(result).toMatchObject({ scanned: 0, specs: [] });
    const plain = await temp("locus-mine-plain-");
    await expect(mineBenchmarkCases({ repo: plain })).rejects.toThrow(/Not a git repository/);
  });
});
