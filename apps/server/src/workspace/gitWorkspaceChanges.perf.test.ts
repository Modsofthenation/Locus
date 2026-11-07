import { mkdirSync, writeFileSync } from "node:fs";
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
import { readWorkspaceAccess } from "./workspaceAccess.js";
import { readWorkspaceFile } from "./workspaceFiles.js";

const execFileAsync = promisify(execFile);
const ARTIFACT = "/opt/cursor/artifacts/file_open_git_latency.json";
const cleanup: string[] = [];

afterEach(async () => {
  resetGitWorkspaceChangesCache();
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function timeMs(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

/** Previous open path: always rev-parse, then show (or ls-files for untracked). */
async function legacyGitWorkspaceBaseline(root: string, rel: string): Promise<string | undefined> {
  const path = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      timeout: 2000,
      env: gitTestEnv(),
    });
    if (stdout.trim() !== "true") return undefined;
  } catch {
    return undefined;
  }
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-c", "core.quotepath=false", "show", `HEAD:${path}`],
      { cwd: root, timeout: 2000, env: gitTestEnv() },
    );
    return stdout;
  } catch {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "--", path],
        { cwd: root, timeout: 2000, env: gitTestEnv() },
      );
      if (
        stdout
          .split("\n")
          .map((row) => row.trim())
          .filter(Boolean)
          .includes(path)
      )
        return "";
    } catch {
      /* ignore */
    }
    return undefined;
  }
}

describe("git workspace file-open latency", () => {
  it("opens a clean file much cheaper after the dirty set is warm", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-git-open-"));
    cleanup.push(dir);
    await execFileAsync("git", ["init"], { cwd: dir, env: gitTestEnv() });
    await execFileAsync("git", ["config", "user.email", "locus@test"], {
      cwd: dir,
      env: gitTestEnv(),
    });
    await execFileAsync("git", ["config", "user.name", "Locus"], { cwd: dir, env: gitTestEnv() });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "keep.txt"), "one\ntwo\n");
    await writeFile(join(dir, "src", "app.ts"), "export const n = 1;\n");
    await execFileAsync("git", ["add", "."], { cwd: dir, env: gitTestEnv() });
    await execFileAsync("git", ["commit", "-m", "one"], { cwd: dir, env: gitTestEnv() });
    await writeFile(join(dir, "keep.txt"), "one\nTWO\n");

    const before: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      before.push(await timeMs(() => legacyGitWorkspaceBaseline(dir, "src/app.ts")));
    }

    await gitWorkspaceChanges(dir);
    const after: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      after.push(await timeMs(() => gitWorkspaceBaseline(dir, "src/app.ts")));
    }

    const sequential: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      sequential.push(
        await timeMs(async () => {
          const file = await readWorkspaceFile(dir, "src/app.ts");
          await legacyGitWorkspaceBaseline(dir, "src/app.ts");
          return file;
        }),
      );
    }
    const parallel: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      parallel.push(
        await timeMs(() =>
          readWorkspaceAccess({
            kind: "host",
            hasVm: false,
            readWorker: async () => {
              throw new Error("unused");
            },
            readGuest: async () => undefined,
            readHost: () => readWorkspaceFile(dir, "src/app.ts"),
            gitBaseline: () => gitWorkspaceBaseline(dir, "src/app.ts"),
          }),
        ),
      );
    }

    const payload = {
      samples: { baseline: before.length, read: sequential.length },
      gitBaselineCleanMs: {
        beforeMedian: Number(median(before).toFixed(2)),
        afterMedian: Number(median(after).toFixed(2)),
        beforeAll: before.map((n) => Number(n.toFixed(2))),
        afterAll: after.map((n) => Number(n.toFixed(2))),
      },
      readPlusBaselineMs: {
        beforeMedian: Number(median(sequential).toFixed(2)),
        afterMedian: Number(median(parallel).toFixed(2)),
      },
    };
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(ARTIFACT, `${JSON.stringify(payload, null, 2)}\n`);
    } catch {
      /* artifacts dir is optional outside the cloud agent */
    }

    expect(median(after)).toBeLessThan(median(before) / 2);
    expect(median(parallel)).toBeLessThanOrEqual(median(sequential));
  });
});
