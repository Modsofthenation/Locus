import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  addWorktree,
  commitAll,
  gitToplevel,
  listWorktrees,
  mergeBranchInto,
  removeWorktree,
  seedWorktree,
  worktreeDiff,
  worktreeStatus,
} from "./gitWorktree.js";

const exec = promisify(execFile);
const git = (cwd: string, ...args: string[]) =>
  exec("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);

async function repo(dir: string): Promise<string> {
  const root = join(dir, "repo");
  await mkdir(root, { recursive: true });
  await git(root, "init", "-q", "-b", "main");
  await writeFile(join(root, "a.txt"), "one\n");
  await writeFile(join(root, ".gitignore"), ".env\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", "init");
  return root;
}

describe("gitWorktree", () => {
  const cleanup: string[] = [];
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function tmp() {
    const dir = await mkdtemp(join(tmpdir(), "locus-wt-"));
    cleanup.push(dir);
    return dir;
  }

  it("adds, measures, merges and removes a worktree", async () => {
    const dir = await tmp();
    const source = await repo(dir);
    expect(await gitToplevel(join(dir, "nope"))).toBe(undefined);
    expect(await gitToplevel(source)).toBe(source);

    const wt = await addWorktree({ source, path: join(dir, "wt", "one"), branch: "locus/one" });
    expect(wt.branch).toBe("locus/one");
    expect(wt.baseBranch).toBe("main");
    expect(wt.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(join(wt.path, "a.txt"), "utf8")).toBe("one\n");

    // Same branch name again gets a suffix instead of failing.
    const two = await addWorktree({ source, path: join(dir, "wt", "two"), branch: "locus/one" });
    expect(two.branch).toBe("locus/one-2");
    expect((await listWorktrees(source)).map((row) => row.branch)).toEqual([
      "main",
      "locus/one",
      "locus/one-2",
    ]);

    await writeFile(join(wt.path, "a.txt"), "one\ntwo\n");
    await writeFile(join(wt.path, "new.txt"), "fresh\n");
    let status = await worktreeStatus(wt);
    expect(status).toMatchObject({ branch: "locus/one", commits: 0, dirty: 2 });
    // The untracked new.txt counts its line too.
    expect(status.stat).toEqual({ files: 2, insertions: 2, deletions: 0 });
    expect(status.paths).toEqual(["a.txt", "new.txt"]);
    const diff = await worktreeDiff(wt);
    expect(diff).toContain("+two");
    expect(diff).toContain("+fresh");

    expect(await commitAll(wt.path, "work")).toBe(true);
    expect(await commitAll(wt.path, "noop")).toBe(false);
    status = await worktreeStatus(wt);
    expect(status).toMatchObject({ commits: 1, dirty: 0 });
    expect(status.stat.files).toBe(2);

    const merged = await mergeBranchInto(source, wt.branch, "merge one");
    expect(merged.ok).toBe(true);
    expect(await readFile(join(source, "new.txt"), "utf8")).toBe("fresh\n");

    await removeWorktree(wt, { deleteBranch: false });
    expect(existsSync(wt.path)).toBe(false);
    await removeWorktree(two, { deleteBranch: true });
    const branches = (await git(source, "branch", "--format=%(refname:short)")).stdout;
    expect(branches).toContain("locus/one");
    expect(branches).not.toContain("locus/one-2");
  });

  it("aborts a conflicting merge and reports the files", async () => {
    const dir = await tmp();
    const source = await repo(dir);
    const wt = await addWorktree({ source, path: join(dir, "wt"), branch: "locus/c" });
    await writeFile(join(wt.path, "a.txt"), "theirs\n");
    await commitAll(wt.path, "theirs");
    await writeFile(join(source, "a.txt"), "ours\n");
    await git(source, "commit", "-qam", "ours");
    const result = await mergeBranchInto(source, wt.branch, "m");
    expect(result).toMatchObject({ ok: false, conflicts: ["a.txt"] });
    expect(await readFile(join(source, "a.txt"), "utf8")).toBe("ours\n");
    expect((await git(source, "status", "--porcelain")).stdout.trim()).toBe("");
  });

  it("refuses to merge into a dirty checkout", async () => {
    const dir = await tmp();
    const source = await repo(dir);
    const wt = await addWorktree({ source, path: join(dir, "wt"), branch: "locus/d" });
    await writeFile(join(source, "a.txt"), "dirty\n");
    const result = await mergeBranchInto(source, wt.branch, "m");
    expect(result.ok).toBe(false);
  });

  it("rejects non-repos and nested paths", async () => {
    const dir = await tmp();
    await expect(addWorktree({ source: dir, path: join(dir, "x"), branch: "b" })).rejects.toThrow(
      /not a git checkout/,
    );
    const source = await repo(dir);
    await expect(
      addWorktree({ source, path: join(source, "inside"), branch: "b" }),
    ).rejects.toThrow(/inside its source/);
  });

  it("seeds ignored env files and configured copies", async () => {
    const dir = await tmp();
    const source = await repo(dir);
    await writeFile(join(source, ".env"), "SECRET=1\n");
    await mkdir(join(source, ".locus"), { recursive: true });
    await mkdir(join(source, "config"), { recursive: true });
    await writeFile(join(source, "config", "local.json"), "{}\n");
    await writeFile(
      join(source, ".locus", "worktree.json"),
      JSON.stringify({ copy: ["config/local.json", "../escape"] }),
    );
    const wt = await addWorktree({ source, path: join(dir, "wt"), branch: "locus/s" });
    const copied = await seedWorktree(source, wt.path);
    expect(copied.sort()).toEqual([".env", "config/local.json"]);
    expect(await readFile(join(wt.path, ".env"), "utf8")).toBe("SECRET=1\n");
  });
});
