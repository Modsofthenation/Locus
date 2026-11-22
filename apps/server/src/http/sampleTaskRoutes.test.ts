import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SAMPLE_TASK_PROMPT,
  type AgentSession,
  type CreateSessionInput,
  type LocusConfig,
  type SessionWorktree,
} from "@locus/shared";
import { defaultConfig } from "../defaults.js";
import { SAMPLE_REPO_FILES, sampleRepoDir } from "../session/sampleTask.js";
import { addWorktree } from "../workspace/gitWorktree.js";
import { registerSampleTaskRoutes } from "./sampleTaskRoutes.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("POST /api/sample-task", () => {
  let dataDir: string;
  let config: LocusConfig;
  let created: Array<{ input: CreateSessionInput; source: string; worktree: SessionWorktree }>;
  let app: Hono;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "locus-sample-"));
    config = defaultConfig(dataDir);
    config.providers = config.providers.map((row, index) => ({
      ...row,
      enabled: index === 0,
      apiKey: index === 0 ? "sk-test" : "",
      defaultModel: index === 0 ? "test-model" : row.defaultModel,
    }));
    created = [];
    app = new Hono();
    registerSampleTaskRoutes(app, {
      dataDir,
      loadConfig: async () => config,
      // Stand-in for SessionService.create: branch a real worktree from the trusted source.
      create: async (input, source) => {
        const n = created.length + 1;
        const worktree = await addWorktree({
          source,
          path: join(dataDir, "worktrees", `sample-${n}`),
          branch: `locus/sample-${n}`,
        });
        created.push({ input, source, worktree });
        return { id: `sample-${n}`, title: input.title, hostDir: worktree.path } as AgentSession;
      },
    });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const post = (body: unknown = {}) =>
    app.request("/api/sample-task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("refuses without a provider", async () => {
    config.providers = config.providers.map((row) => ({ ...row, enabled: false }));
    const res = await post();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add a provider first" });
    expect(created).toHaveLength(0);
  });

  it("starts a Host agent in a new worktree of the sample repo with the prompt", async () => {
    const res = await post({ surface: "developer" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "sample-1" });

    const provider = config.providers[0]!;
    const repo = sampleRepoDir(dataDir);
    expect(created[0]?.source).toBe(repo);
    expect(created[0]?.input).toMatchObject({
      runtime: "host",
      worktree: true,
      providerId: provider.id,
      model: "test-model",
      startVm: false,
      surface: "developer",
      prompt: SAMPLE_TASK_PROMPT,
    });
    expect(SAMPLE_TASK_PROMPT).toContain("sum.test.js");

    expect(git(repo, ["rev-list", "--count", "HEAD"])).toBe("1");
    const wt = created[0]!.worktree;
    expect(wt.baseBranch).toBe("main");
    expect(await readFile(join(wt.path, "sum.js"), "utf8")).toBe(SAMPLE_REPO_FILES["sum.js"]);

    // The bundled test fails as shipped and passes once the off-by-one is fixed.
    const failing = spawnSync(process.execPath, ["--test"], { cwd: wt.path, encoding: "utf8" });
    expect(failing.status).not.toBe(0);
    await writeFile(
      join(wt.path, "sum.js"),
      SAMPLE_REPO_FILES["sum.js"]!.replace("numbers.length - 1", "numbers.length"),
    );
    const passing = spawnSync(process.execPath, ["--test"], { cwd: wt.path, encoding: "utf8" });
    expect(passing.status).toBe(0);
  });

  it("reuses the sample repo and resets it to the initial commit", async () => {
    expect((await post()).status).toBe(201);
    const repo = sampleRepoDir(dataDir);
    const base = git(repo, ["rev-parse", "HEAD"]);

    // A merged fix and a stray file from the last run.
    await writeFile(join(repo, "sum.js"), "export const sum = () => 6;\n");
    git(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "Merged fix"]);
    await writeFile(join(repo, "stray.txt"), "left over\n");

    expect((await post()).status).toBe(201);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(base);
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    const wt = created[1]!.worktree;
    expect(wt.baseSha).toBe(base);
    expect(await readFile(join(wt.path, "sum.js"), "utf8")).toBe(SAMPLE_REPO_FILES["sum.js"]);
    // The first run's worktree is untouched.
    expect(git(created[0]!.worktree.path, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      "locus/sample-1",
    );
  });

  it("uses the requested provider and model when that provider is ready", async () => {
    const second = config.providers[1]!;
    config.providers[1] = { ...second, enabled: true, apiKey: "sk-two" };
    expect((await post({ providerId: second.id, model: "picked" })).status).toBe(201);
    expect(created[0]?.input).toMatchObject({ providerId: second.id, model: "picked" });
  });
});
