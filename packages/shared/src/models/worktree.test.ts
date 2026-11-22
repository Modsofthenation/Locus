import { describe, expect, it } from "vitest";
import {
  diffStatFromPatch,
  isWorktreeSeedFile,
  parseSessionWorktree,
  parseShortStat,
  parseWorktreeAgents,
  parseWorktreeList,
  parseWorktreeSetupConfig,
  worktreeBranchName,
  worktreeDirName,
  WORKTREE_AGENTS_MAX,
} from "./worktree.js";
import { parseSessionCompare } from "./compare.js";

describe("worktree names", () => {
  it("slugs the title into a locus/ branch", () => {
    expect(worktreeBranchName("Fix the Login bug!", "a1b2c3")).toBe(
      "locus/fix-the-login-bug-a1b2c3",
    );
    expect(worktreeBranchName("", "x")).toBe("locus/agent-x");
    expect(worktreeBranchName("ünïcode — title", "1")).toBe("locus/unicode-title-1");
  });

  it("keeps folder names flat and safe", () => {
    expect(worktreeDirName("/home/me/src/my app", "1234-5678-abcd")).toBe("my-app-12345678abcd");
    expect(worktreeDirName("C:\\code\\..\\repo", "z")).toBe("repo-z");
    expect(worktreeDirName("/", "")).toBe("repo-wt");
  });
});

describe("parseSessionWorktree", () => {
  it("requires source, path, branch and a sha", () => {
    expect(
      parseSessionWorktree({ source: "/a", path: "/b", branch: "locus/x", baseSha: "abc1234" }),
    ).toEqual({ source: "/a", path: "/b", branch: "locus/x", baseSha: "abc1234" });
    expect(parseSessionWorktree({ source: "/a", path: "/b", branch: "x", baseSha: "nope" })).toBe(
      undefined,
    );
    expect(parseSessionWorktree(null)).toBe(undefined);
  });
});

describe("parseWorktreeAgents", () => {
  it("drops incomplete rows and caps the count", () => {
    const rows = parseWorktreeAgents([
      { providerId: "claude", model: "opus" },
      { providerId: "codex", model: "" },
      { providerId: " codex ", model: " gpt ", reasoningEffort: "high" },
      "junk",
    ]);
    expect(rows).toEqual([
      { providerId: "claude", model: "opus" },
      { providerId: "codex", model: "gpt", reasoningEffort: "high" },
    ]);
    const many = Array.from({ length: 20 }, () => ({ providerId: "p", model: "m" }));
    expect(parseWorktreeAgents(many)).toHaveLength(WORKTREE_AGENTS_MAX);
    expect(parseWorktreeAgents(undefined)).toEqual([]);
  });
});

describe("diff stats", () => {
  it("parses git shortstat", () => {
    expect(parseShortStat(" 3 files changed, 10 insertions(+), 2 deletions(-)\n")).toEqual({
      files: 3,
      insertions: 10,
      deletions: 2,
    });
    expect(parseShortStat(" 1 file changed, 1 insertion(+)")).toEqual({
      files: 1,
      insertions: 1,
      deletions: 0,
    });
    expect(parseShortStat("")).toEqual({ files: 0, insertions: 0, deletions: 0 });
  });

  it("counts a unified patch", () => {
    const patch = [
      "diff --git a/x b/x",
      "--- a/x",
      "+++ b/x",
      "@@ -1 +1,2 @@",
      "-old",
      "+new",
      "+more",
      "diff --git a/y b/y",
      "+++ b/y",
      "+y",
    ].join("\n");
    expect(diffStatFromPatch(patch)).toEqual({ files: 2, insertions: 3, deletions: 1 });
  });
});

describe("parseWorktreeList", () => {
  it("reads porcelain output", () => {
    const text = [
      "worktree /repo",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /wt/one",
      "HEAD def",
      "detached",
      "",
      "worktree /wt/two",
      "HEAD 123",
      "branch refs/heads/locus/two",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    expect(parseWorktreeList(text)).toEqual([
      { path: "/repo", head: "abc", branch: "main" },
      { path: "/wt/one", head: "def", detached: true },
      { path: "/wt/two", head: "123", branch: "locus/two", prunable: true },
    ]);
  });
});

describe("worktree seeding", () => {
  it("copies env-ish files but not committed examples", () => {
    expect(isWorktreeSeedFile(".env")).toBe(true);
    expect(isWorktreeSeedFile(".env.local")).toBe(true);
    expect(isWorktreeSeedFile(".env.development.local")).toBe(true);
    expect(isWorktreeSeedFile(".envrc")).toBe(true);
    expect(isWorktreeSeedFile(".env.example")).toBe(false);
    expect(isWorktreeSeedFile("env")).toBe(false);
  });

  it("rejects escaping copy paths", () => {
    expect(
      parseWorktreeSetupConfig({
        copy: ["config/local.json", "../secret", "/etc/passwd", "C:/x", ".git/config", 3],
        setup: "  npm ci ",
      }),
    ).toEqual({ copy: ["config/local.json"], setup: "npm ci" });
    expect(parseWorktreeSetupConfig("nope")).toEqual({ copy: [] });
  });
});

describe("worker groups", () => {
  it("accepts up to eight members for worktree fan-out", () => {
    const memberIds = Array.from({ length: 8 }, (_, i) => `s${i}`);
    expect(
      parseSessionCompare({ groupId: "g", role: "1", kind: "workers", memberIds })?.memberIds,
    ).toHaveLength(8);
    expect(
      parseSessionCompare({
        groupId: "g",
        role: "1",
        kind: "workers",
        memberIds: [...memberIds, "s9"],
      }),
    ).toBe(undefined);
  });
});
