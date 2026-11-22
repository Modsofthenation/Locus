import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  SAMPLE_TASK_PROMPT,
  SAMPLE_TASK_TITLE,
  hasUsableKey,
  type AgentSession,
  type CreateSessionInput,
  type LocusConfig,
  type SampleTaskInput,
} from "@locus/shared";

const execFileAsync = promisify(execFile);

/** Bundled sample project: one off-by-one bug, one failing `node --test` suite, no install. */
export const SAMPLE_REPO_FILES: Record<string, string> = {
  "package.json": `${JSON.stringify(
    {
      name: "locus-sample",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { test: "node --test" },
    },
    null,
    2,
  )}\n`,
  "sum.js": [
    "/** Add every number in the list. */",
    "export function sum(numbers) {",
    "  let total = 0;",
    "  for (let i = 0; i < numbers.length - 1; i++) {",
    "    total += numbers[i];",
    "  }",
    "  return total;",
    "}",
    "",
  ].join("\n"),
  "sum.test.js": [
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'import { sum } from "./sum.js";',
    "",
    'test("sum adds every number", () => {',
    "  assert.equal(sum([1, 2, 3]), 6);",
    "});",
    "",
    'test("sum of an empty list is 0", () => {',
    "  assert.equal(sum([]), 0);",
    "});",
    "",
  ].join("\n"),
  "README.md": [
    "# Locus sample",
    "",
    "A tiny project with one failing test. Run `npm test` (or `node --test`).",
    "",
  ].join("\n"),
};

export const SAMPLE_BRANCH = "main";

export function sampleRepoDir(dataDir: string): string {
  return join(dataDir, "samples", "sum");
}

const GIT_IDENTITY = [
  "-c",
  "user.name=Locus",
  "-c",
  "user.email=locus@localhost",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=",
];

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...GIT_IDENTITY, ...args], {
      cwd,
      timeout: 20_000,
      maxBuffer: 2_000_000,
      windowsHide: true,
    });
    return stdout.trim();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error("Git is not installed");
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || (err instanceof Error ? err.message : "git failed"));
  }
}

async function writeSampleFiles(dir: string): Promise<void> {
  for (const [rel, text] of Object.entries(SAMPLE_REPO_FILES)) {
    const target = join(dir, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
}

async function createSampleRepo(dir: string): Promise<string> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await git(dir, ["init", "-q"]);
  await git(dir, ["symbolic-ref", "HEAD", `refs/heads/${SAMPLE_BRANCH}`]);
  await writeSampleFiles(dir);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "Initial commit"]);
  return git(dir, ["rev-parse", "HEAD"]);
}

/**
 * Create the sample repo under the Locus home, or reuse it and reset `main` to the
 * initial commit so every run starts from the same failing test.
 */
export async function ensureSampleRepo(dataDir: string): Promise<{ dir: string; base: string }> {
  const dir = sampleRepoDir(dataDir);
  if (existsSync(join(dir, ".git"))) {
    try {
      const roots = (await git(dir, ["rev-list", "--max-parents=0", "HEAD"])).split("\n");
      const base = roots[roots.length - 1]?.trim();
      if (base) {
        await git(dir, ["checkout", "-q", "-f", "-B", SAMPLE_BRANCH, base]);
        await git(dir, ["clean", "-q", "-fdx"]);
        return { dir, base };
      }
    } catch (err) {
      if (err instanceof Error && err.message === "Git is not installed") throw err;
      /* broken sample repo: rebuild below */
    }
  }
  return { dir, base: await createSampleRepo(dir) };
}

export function pickSampleProvider(
  config: LocusConfig,
  input: SampleTaskInput,
): { providerId: string; model: string } {
  const ready = config.providers.filter(
    (row) => row.enabled && hasUsableKey(row.apiKey, row.baseUrl, row.kind),
  );
  const provider = ready.find((row) => row.id === input.providerId) ?? ready[0];
  if (!provider) throw new Error("Add a provider first");
  const model =
    (provider.id === input.providerId ? input.model?.trim() : "") ||
    provider.defaultModel ||
    provider.models?.[0] ||
    "";
  return { providerId: provider.id, model };
}

export interface SampleTaskDeps {
  dataDir: string;
  loadConfig: () => Promise<LocusConfig>;
  /** SessionService.create with a trusted worktree source. */
  create: (input: CreateSessionInput, worktreeSource: string) => Promise<AgentSession>;
}

/**
 * Reset the bundled sample repo, start a Host agent in a new git worktree of it, and send
 * the fix-the-test prompt. Host needs no Docker or QEMU.
 */
export async function startSampleTask(
  deps: SampleTaskDeps,
  input: SampleTaskInput = {},
): Promise<AgentSession> {
  const config = await deps.loadConfig();
  const { providerId, model } = pickSampleProvider(config, input);
  const sample = await ensureSampleRepo(deps.dataDir);
  return deps.create(
    {
      title: SAMPLE_TASK_TITLE,
      os: "ubuntu",
      templateId: config.templates.find((row) => row.os === "ubuntu")?.id ?? "host",
      runtime: "host",
      providerId,
      model,
      startVm: false,
      worktree: true,
      prompt: SAMPLE_TASK_PROMPT,
      ...(input.surface ? { surface: input.surface } : {}),
    },
    sample.dir,
  );
}
