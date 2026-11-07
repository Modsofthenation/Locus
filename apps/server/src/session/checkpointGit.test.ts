import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkpointNeedsFullSnapshot,
  diffCheckpointRefs,
  restoreCheckpointRef,
  writeCheckpointRef,
} from "./checkpoint.js";
import { gitTestEnv } from "../test/gitEnv.js";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

describe("checkpoint git refs", () => {
  it("writes a hidden ref and diffs later commits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-ckpt-git-"));
    cleanup.push(dir);
    await execFileAsync("git", ["init"], { cwd: dir, env: gitTestEnv() });
    await execFileAsync("git", ["config", "user.email", "locus@test"], {
      cwd: dir,
      env: gitTestEnv(),
    });
    await execFileAsync("git", ["config", "user.name", "Locus"], { cwd: dir, env: gitTestEnv() });
    await writeFile(join(dir, "a.txt"), "one\n");
    await execFileAsync("git", ["add", "."], { cwd: dir, env: gitTestEnv() });
    await execFileAsync("git", ["commit", "-m", "one"], { cwd: dir, env: gitTestEnv() });
    const first = await writeCheckpointRef(dir, "c1");
    expect(first).toMatch(/refs\/locus\/checkpoints\/c1/);
    await writeFile(join(dir, "a.txt"), "two\n");
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "b.ts"), "export const n = 2;\n");
    const second = await writeCheckpointRef(dir, "c2");
    expect(second).toBeTruthy();
    const diff = await diffCheckpointRefs(dir, first!, second!);
    expect(diff).toMatch(/a\.txt/);
    expect(diff).toMatch(/b\.ts/);
    expect(diff).toMatch(/\+two/);
    expect(diff).toMatch(/export const n = 2/);
    const status = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: dir,
      env: gitTestEnv(),
    });
    expect(status.stdout).toMatch(/a\.txt/);
  });

  it("returns undefined when the folder is not a git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-ckpt-empty-"));
    cleanup.push(dir);
    expect(await writeCheckpointRef(dir, "c1")).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")(
    "restores a source-only worktree from the hidden ref",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-ckpt-restore-"));
      cleanup.push(dir);
      await execFileAsync("git", ["init"], { cwd: dir, env: gitTestEnv() });
      await execFileAsync("git", ["config", "user.email", "locus@test"], {
        cwd: dir,
        env: gitTestEnv(),
      });
      await execFileAsync("git", ["config", "user.name", "Locus"], { cwd: dir, env: gitTestEnv() });
      await writeFile(join(dir, "a.txt"), "one\n");
      await execFileAsync("git", ["add", "."], { cwd: dir, env: gitTestEnv() });
      await execFileAsync("git", ["commit", "-m", "one"], { cwd: dir, env: gitTestEnv() });
      const ref = await writeCheckpointRef(dir, "c1");
      expect(ref).toBeTruthy();
      await writeFile(join(dir, "a.txt"), "two\n");
      await writeFile(join(dir, "extra.ts"), "export const n = 2;\n");
      expect(await restoreCheckpointRef(dir, ref!)).toBe(true);
      expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("one\n");
      await expect(readFile(join(dir, "extra.ts"))).rejects.toThrow();
    },
  );

  it("needs a full snapshot when guest Chromium profile exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-ckpt-chrome-"));
    cleanup.push(dir);
    await execFileAsync("git", ["init"], { cwd: dir, env: gitTestEnv() });
    await execFileAsync("git", ["config", "user.email", "locus@test"], {
      cwd: dir,
      env: gitTestEnv(),
    });
    await execFileAsync("git", ["config", "user.name", "Locus"], { cwd: dir, env: gitTestEnv() });
    await writeFile(join(dir, "a.txt"), "one\n");
    await execFileAsync("git", ["add", "."], { cwd: dir, env: gitTestEnv() });
    await execFileAsync("git", ["commit", "-m", "one"], { cwd: dir, env: gitTestEnv() });
    expect(await checkpointNeedsFullSnapshot(dir)).toBe(false);
    await mkdir(join(dir, ".locus-chrome"), { recursive: true });
    await writeFile(join(dir, ".locus-chrome", "Cookies"), "x");
    expect(await checkpointNeedsFullSnapshot(dir)).toBe(true);
  });
});
