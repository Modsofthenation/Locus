import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  gitWorkspaceBaseline,
  gitWorkspaceChanges,
  resetGitWorkspaceChangesCache,
} from "./gitWorkspaceChanges.js";
import { gitTestEnv } from "../test/gitEnv.js";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd, env: gitTestEnv() });
}

afterEach(async () => {
  resetGitWorkspaceChangesCache();
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

describe("gitWorkspaceChanges", () => {
  it("returns empty when the folder is not a git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-git-ws-"));
    cleanup.push(dir);
    await writeFile(join(dir, "a.txt"), "hi\n");
    expect(await gitWorkspaceChanges(dir)).toEqual([]);
  });

  it("reports numstat for dirty and untracked files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-git-ws-"));
    cleanup.push(dir);
    await git(dir, ["init"]);
    await git(dir, ["config", "user.email", "locus@test"]);
    await git(dir, ["config", "user.name", "Locus"]);
    await writeFile(join(dir, "keep.txt"), "one\ntwo\n");
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "-m", "one"]);
    await writeFile(join(dir, "keep.txt"), "one\nTWO\nthree\n");
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "new.ts"), "export const n = 1;\n");
    const changes = await gitWorkspaceChanges(dir);
    expect(changes).toEqual(
      expect.arrayContaining([
        { path: "keep.txt", additions: 2, deletions: 1 },
        { path: "src/new.ts", additions: 1, deletions: 0 },
      ]),
    );
    expect(await gitWorkspaceBaseline(dir, "keep.txt")).toBe("one\ntwo\n");
    expect(await gitWorkspaceBaseline(dir, "src/new.ts")).toBe("");
  });

  it("does not count untracked files under cache dirs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-git-ws-"));
    cleanup.push(dir);
    await git(dir, ["init"]);
    await git(dir, ["config", "user.email", "locus@test"]);
    await git(dir, ["config", "user.name", "Locus"]);
    await writeFile(join(dir, "keep.txt"), "one\n");
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "-m", "one"]);
    await mkdir(join(dir, ".cache"), { recursive: true });
    await mkdir(join(dir, ".tmp"), { recursive: true });
    await mkdir(join(dir, ".pre-commit-cache-agent"), { recursive: true });
    await writeFile(join(dir, ".cache", "blob.ts"), "export const n = 1;\n");
    await writeFile(join(dir, ".tmp", "noise.ts"), "export const n = 1;\n");
    await writeFile(join(dir, ".pre-commit-cache-agent", "x.ts"), "export const n = 1;\n");
    await writeFile(join(dir, "ok.ts"), "export const n = 1;\n");
    await writeFile(join(dir, "big.ts"), "line\n".repeat(40));
    const changes = await gitWorkspaceChanges(dir);
    expect(changes.map((row) => row.path).sort()).toEqual(["big.ts", "ok.ts"]);
    expect(changes.find((row) => row.path === "big.ts")).toEqual({
      path: "big.ts",
      additions: 1,
      deletions: 0,
    });
  });

  it("returns undefined when there is no git baseline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-git-ws-"));
    cleanup.push(dir);
    await writeFile(join(dir, "a.txt"), "hi\n");
    expect(await gitWorkspaceBaseline(dir, "a.txt")).toBeUndefined();
  });

  it("skips git show for clean files once the dirty set is cached", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-git-ws-"));
    cleanup.push(dir);
    await git(dir, ["init"]);
    await git(dir, ["config", "user.email", "locus@test"]);
    await git(dir, ["config", "user.name", "Locus"]);
    await writeFile(join(dir, "keep.txt"), "one\n");
    await writeFile(join(dir, "other.txt"), "two\n");
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "-m", "one"]);
    await writeFile(join(dir, "keep.txt"), "ONE\n");
    expect(await gitWorkspaceChanges(dir)).toEqual([
      { path: "keep.txt", additions: 1, deletions: 1 },
    ]);
    expect(await gitWorkspaceBaseline(dir, "keep.txt")).toBe("one\n");
    const start = performance.now();
    expect(await gitWorkspaceBaseline(dir, "other.txt")).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(5);
  });

  it("does not treat a non-git folder as a worktree on later reads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-git-ws-"));
    cleanup.push(dir);
    await writeFile(join(dir, "a.txt"), "hi\n");
    expect(await gitWorkspaceBaseline(dir, "a.txt")).toBeUndefined();
    const start = performance.now();
    expect(await gitWorkspaceBaseline(dir, "a.txt")).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(5);
  });
});
