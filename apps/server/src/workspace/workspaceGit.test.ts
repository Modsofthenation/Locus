import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { gitTestEnv } from "../test/gitEnv.js";
import {
  parseUnifiedHunks,
  workspaceGitBlameFile,
  workspaceGitBranches,
  workspaceGitCheckout,
  workspaceGitCheckoutConflict,
  workspaceGitCommit,
  workspaceGitDiscard,
  workspaceGitFetch,
  workspaceGitHunks,
  workspaceGitMerge,
  workspaceGitMergeContinue,
  workspaceGitPull,
  workspaceGitRebase,
  workspaceGitRebasePreview,
  workspaceGitStage,
  workspaceGitStageHunk,
  workspaceGitStash,
  workspaceGitStashList,
  workspaceGitStatus,
  workspaceGitUnstage,
  gitCheckoutReady,
} from "./workspaceGit.js";

const execFileAsync = promisify(execFile);
let cleanup: string[] = [];
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanup.map((dir) => rm(dir, { recursive: true, force: true })));
  cleanup = [];
});

async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, {
    cwd,
    env: gitTestEnv({
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    }),
  });
}

async function repo(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(dir);
  await git(dir, ["init", "-b", "main"]);
  await git(dir, ["config", "user.email", "t@t"]);
  await git(dir, ["config", "user.name", "t"]);
  return dir;
}

describe("workspaceGitStatus", () => {
  it("lists untracked files and stages a commit", async () => {
    const dir = await repo("locus-git-");
    await writeFile(join(dir, "a.ts"), "export const a = 1;\n");
    const dirty = await workspaceGitStatus(dir);
    expect(dirty.branch).toBe("main");
    expect(dirty.files.some((row) => row.path === "a.ts")).toBe(true);
    await workspaceGitStage(dir, ["a.ts"]);
    const staged = await workspaceGitStatus(dir);
    expect(staged.files.find((row) => row.path === "a.ts")?.staged).toBe(true);
    const committed = await workspaceGitCommit(dir, "add a");
    expect(committed.files).toEqual([]);
  });

  it("returns empty status outside a git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-nogit-"));
    cleanup.push(dir);
    await mkdir(join(dir, "src"));
    expect(await workspaceGitStatus(dir)).toEqual({ branch: "", ahead: 0, behind: 0, files: [] });
  });
});

describe("workspaceGitCheckout", () => {
  it("lists branches and switches between them", async () => {
    const dir = await repo("locus-git-branch-");
    await writeFile(join(dir, "a.ts"), "export const a = 1;\n");
    await git(dir, ["add", "a.ts"]);
    await git(dir, ["commit", "-m", "add a"]);
    await git(dir, ["checkout", "-b", "feature"]);
    const listed = await workspaceGitBranches(dir);
    expect(listed.current).toBe("feature");
    expect(listed.branches.sort()).toEqual(["feature", "main"]);
    const back = await workspaceGitCheckout(dir, "main");
    expect(back.branch).toBe("main");
    await expect(workspaceGitCheckout(dir, "-evil")).rejects.toThrow(/Invalid branch/);
    await expect(workspaceGitCheckout(dir, "../x")).rejects.toThrow(/Invalid branch/);
  });

  it("creates a new branch", async () => {
    const dir = await repo("locus-git-new-branch-");
    await writeFile(join(dir, "a.ts"), "export const a = 1;\n");
    await git(dir, ["add", "a.ts"]);
    await git(dir, ["commit", "-m", "add a"]);
    const created = await workspaceGitCheckout(dir, "topic", true);
    expect(created.branch).toBe("topic");
  });

  it.skipIf(process.platform === "win32")("pulls commits from a remote", async () => {
    const dir = await repo("locus-git-pull-");
    const bare = await mkdtemp(join(tmpdir(), "locus-git-bare-"));
    cleanup.push(bare);
    await git(bare, ["init", "--bare", "-b", "main"]);
    await writeFile(join(dir, "a.ts"), "one\n");
    await git(dir, ["add", "a.ts"]);
    await git(dir, ["commit", "-m", "one"]);
    await git(dir, ["remote", "add", "origin", bare]);
    await git(dir, ["push", "-u", "origin", "main"]);
    await writeFile(join(dir, "a.ts"), "two\n");
    await git(dir, ["add", "a.ts"]);
    await git(dir, ["commit", "-m", "two"]);
    await git(dir, ["push"]);
    await git(dir, ["reset", "--hard", "HEAD~1"]);
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("one\n");
    const pulled = await workspaceGitPull(dir);
    expect(pulled.branch).toBe("main");
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("two\n");
  });

  it("surfaces git stderr when pull has no remote", async () => {
    const dir = await repo("locus-git-noremote-");
    await writeFile(join(dir, "a.ts"), "one\n");
    await git(dir, ["add", "a.ts"]);
    await git(dir, ["commit", "-m", "one"]);
    await expect(workspaceGitPull(dir)).rejects.toThrow(/remote|tracking|configure/i);
  });
});

describe("workspaceGit discard stage-all fetch stash", () => {
  it.skipIf(process.platform === "win32")(
    "discards tracked edits and untracked files",
    async () => {
      const dir = await repo("locus-git-discard-");
      await writeFile(join(dir, "a.ts"), "keep\n");
      await git(dir, ["add", "a.ts"]);
      await git(dir, ["commit", "-m", "keep"]);
      await writeFile(join(dir, "a.ts"), "dirty\n");
      await writeFile(join(dir, "tmp.ts"), "gone\n");
      await workspaceGitDiscard(dir, ["a.ts", "tmp.ts"]);
      expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("keep\n");
      const status = await workspaceGitStatus(dir);
      expect(status.files).toEqual([]);
    },
  );

  it("stages and unstages every path", async () => {
    const dir = await repo("locus-git-all-");
    await writeFile(join(dir, "a.ts"), "a\n");
    await writeFile(join(dir, "b.ts"), "b\n");
    await workspaceGitStage(dir, ["."]);
    const staged = await workspaceGitStatus(dir);
    expect(staged.files.every((row) => row.staged)).toBe(true);
    await workspaceGitUnstage(dir, ["."]);
    const unstaged = await workspaceGitStatus(dir);
    expect(unstaged.files.every((row) => !row.staged)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("fetches from origin and stashes work", async () => {
    const dir = await repo("locus-git-fetch-");
    const bare = await mkdtemp(join(tmpdir(), "locus-git-bare-fetch-"));
    cleanup.push(bare);
    await git(bare, ["init", "--bare", "-b", "main"]);
    await writeFile(join(dir, "a.ts"), "one\n");
    await git(dir, ["add", "a.ts"]);
    await git(dir, ["commit", "-m", "one"]);
    await git(dir, ["remote", "add", "origin", bare]);
    await git(dir, ["push", "-u", "origin", "main"]);
    const fetched = await workspaceGitFetch(dir);
    expect(fetched.branch).toBe("main");
    await writeFile(join(dir, "a.ts"), "stash me\n");
    await workspaceGitStash(dir, "push", "wip");
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("one\n");
    const list = await workspaceGitStashList(dir);
    expect(list[0]?.message).toMatch(/wip/);
    await workspaceGitStash(dir, "pop");
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("stash me\n");
  });
});

describe("workspaceGit hunks", () => {
  it("parses a unified diff into staged-able hunks", () => {
    const diff = `diff --git a/app.ts b/app.ts
index 111..222 100644
--- a/app.ts
+++ b/app.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
`;
    const hunks = parseUnifiedHunks(diff, false);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.path).toBe("app.ts");
    expect(
      hunks[0]?.lines.some((line) => line.kind === "add" && line.text === "const b = 2;"),
    ).toBe(true);
    expect(hunks[0]?.patch).toContain("diff --git");
    expect(hunks[0]?.patch).toContain("@@ -1,3 +1,4 @@");
  });

  it("stages and unstages a single hunk", async () => {
    const dir = await repo("locus-git-hunk-");
    await writeFile(join(dir, "app.ts"), "one\ntwo\nthree\n");
    await git(dir, ["add", "app.ts"]);
    await git(dir, ["commit", "-m", "base"]);
    await writeFile(join(dir, "app.ts"), "one\nTWO\nthree\n");
    const hunks = await workspaceGitHunks(dir, "app.ts");
    expect(hunks.some((hunk) => !hunk.staged)).toBe(true);
    const target = hunks.find((hunk) => !hunk.staged);
    expect(target).toBeTruthy();
    await workspaceGitStageHunk(dir, target!.patch);
    const staged = await workspaceGitStatus(dir);
    expect(staged.files.find((row) => row.path === "app.ts")?.staged).toBe(true);
    const after = await workspaceGitHunks(dir, "app.ts");
    const cached = after.find((hunk) => hunk.staged);
    expect(cached).toBeTruthy();
    await workspaceGitStageHunk(dir, cached!.patch, true);
    const undone = await workspaceGitStatus(dir);
    expect(undone.files.find((row) => row.path === "app.ts")?.staged).toBe(false);
  });
});

describe("workspaceGit rebase", () => {
  it("squashes the latest commit onto the previous one", async () => {
    const dir = await repo("locus-git-rebase-");
    await writeFile(join(dir, "a.ts"), "one\n");
    await git(dir, ["add", "a.ts"]);
    await git(dir, ["commit", "-m", "one"]);
    await writeFile(join(dir, "a.ts"), "two\n");
    await git(dir, ["add", "a.ts"]);
    await git(dir, ["commit", "-m", "two"]);
    const preview = await workspaceGitRebasePreview(dir);
    expect(preview.todos.length).toBeGreaterThanOrEqual(1);
    const log = await execFileAsync("git", ["log", "--reverse", "--format=%H\t%s"], {
      cwd: dir,
      env: gitTestEnv(),
    });
    const rows = log.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const tab = line.indexOf("\t");
        return { sha: line.slice(0, tab), message: line.slice(tab + 1) };
      });
    expect(rows).toHaveLength(2);
    const status = await workspaceGitRebase(dir, {
      onto: "--root",
      todos: [
        { action: "pick", sha: rows[0]!.sha, message: rows[0]!.message },
        { action: "squash", sha: rows[1]!.sha, message: rows[1]!.message },
      ],
    });
    expect(status.rebasing).toBeFalsy();
    const messages = await execFileAsync("git", ["log", "--format=%s"], {
      cwd: dir,
      env: gitTestEnv(),
    });
    expect(messages.stdout.trim().split("\n")).toHaveLength(1);
  });
});

describe("workspaceGit merge and blame", () => {
  it.skipIf(process.platform === "win32")(
    "merges, marks conflicts, and can abort",
    async () => {
      const dir = await repo("locus-git-merge-");
      await writeFile(join(dir, "app.ts"), "base\n");
      await git(dir, ["add", "app.ts"]);
      await git(dir, ["commit", "-m", "base"]);
      await git(dir, ["checkout", "-b", "topic"]);
      await writeFile(join(dir, "app.ts"), "topic\n");
      await git(dir, ["add", "app.ts"]);
      await git(dir, ["commit", "-m", "topic"]);
      await git(dir, ["checkout", "main"]);
      await writeFile(join(dir, "app.ts"), "main\n");
      await git(dir, ["add", "app.ts"]);
      await git(dir, ["commit", "-m", "main"]);
      const conflicted = await workspaceGitMerge(dir, "topic");
      expect(conflicted.merging).toBe(true);
      expect(conflicted.files.find((row) => row.path === "app.ts")?.conflicted).toBe(true);
      const ours = await workspaceGitCheckoutConflict(dir, "app.ts", "ours");
      expect(ours.files.find((row) => row.path === "app.ts")?.conflicted).toBeUndefined();
      const aborted = await workspaceGitMergeContinue(dir, "abort");
      expect(aborted.merging).toBeFalsy();
      const body = await readFile(join(dir, "app.ts"), "utf8");
      expect(body).toBe("main\n");
    },
    20_000,
  );

  it("blames every line in a file", async () => {
    const dir = await repo("locus-git-blame-");
    await writeFile(join(dir, "app.ts"), "one\ntwo\n");
    await git(dir, ["add", "app.ts"]);
    await git(dir, ["commit", "-m", "lines"]);
    const rows = await workspaceGitBlameFile(dir, "app.ts");
    expect(rows.map((row) => row.line)).toEqual([1, 2]);
    expect(rows[0]?.author).toBe("t");
    expect(rows[0]?.sha.length).toBeGreaterThanOrEqual(7);
  }, 20_000);
});

describe("gitCheckoutReady", () => {
  it("is false for a missing path, empty folder, or git init without a commit", async () => {
    expect(gitCheckoutReady("/tmp/locus-missing-checkout-ready")).toBe(false);
    const empty = await mkdtemp(join(tmpdir(), "locus-git-ready-empty-"));
    cleanup.push(empty);
    expect(gitCheckoutReady(empty)).toBe(false);
    const unborn = await repo("locus-git-ready-unborn-");
    expect(gitCheckoutReady(unborn)).toBe(false);
  });

  it("is true after the first commit", async () => {
    const dir = await repo("locus-git-ready-");
    await writeFile(join(dir, "README.md"), "ok\n");
    await git(dir, ["add", "README.md"]);
    await git(dir, ["commit", "-m", "init"]);
    expect(gitCheckoutReady(dir)).toBe(true);
  });
});
