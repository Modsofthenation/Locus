/**
 * Git and shell plumbing for repo-derived benchmark cases: export a commit's tree into a fresh
 * folder (no history, so the agent cannot read the fix), build fixture repos, clone remotes
 * once per run, run shell commands with a time limit, and check for a language toolchain.
 */
import { execFile, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BenchmarkCaseSpec, BenchmarkLanguage } from "@locus/shared";

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Locus Benchmark",
  GIT_AUTHOR_EMAIL: "benchmark@locus.invalid",
  GIT_COMMITTER_NAME: "Locus Benchmark",
  GIT_COMMITTER_EMAIL: "benchmark@locus.invalid",
};

/** Fixed dates so a fixture repo gets the same commit ids on every machine. */
const FIXTURE_DATES = {
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

export function git(
  args: string[],
  cwd: string,
  opts: { env?: Record<string, string>; timeoutMs?: number; encoding?: "utf8" | "buffer" } = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args],
      {
        cwd,
        env: { ...process.env, ...GIT_ENV, ...opts.env },
        timeout: opts.timeoutMs ?? 120_000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || err.message)
            .trim()
            .split("\n")
            .slice(-3)
            .join(" ");
          reject(new Error(`git ${args[0]} failed: ${detail}`));
        } else resolvePromise(String(stdout));
      },
    );
  });
}

/** File contents at `commit`, or undefined when the path does not exist there. */
export function gitShowFile(
  repo: string,
  commit: string,
  path: string,
): Promise<Buffer | undefined> {
  return new Promise((resolvePromise) => {
    execFile(
      "git",
      ["show", `${commit}:${path}`],
      {
        cwd: repo,
        env: { ...process.env, ...GIT_ENV },
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout) => resolvePromise(err ? undefined : stdout),
    );
  });
}

/** Full sha of a commit-ish, or throws when it does not name a commit. */
export async function resolveCommit(repo: string, commitish: string): Promise<string> {
  if (commitish.startsWith("-")) throw new Error(`Not a commit: ${commitish}`);
  return (await git(["rev-parse", "--verify", "--quiet", `${commitish}^{commit}`], repo)).trim();
}

/** Write `commit`'s tree into `dest` without touching the source repo's index or work tree. */
export async function exportCommit(repo: string, commit: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const index = join(tmpdir(), `locus-bench-index-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    await git(["read-tree", commit], repo, { env });
    const prefix = `${resolve(dest).replace(/\\/g, "/").replace(/\/+$/, "")}/`;
    await git(["checkout-index", "-a", "-f", `--prefix=${prefix}`], repo, { env });
  } finally {
    await rm(index, { force: true });
  }
}

/** Turn a folder into a one-commit repo so the agent can diff its own work. */
export async function initSnapshotRepo(root: string, message = "Base"): Promise<void> {
  await git(["init", "-q"], root);
  await git(["add", "-A"], root);
  await git(["commit", "-q", "--allow-empty", "--no-verify", "-m", message], root);
}

export const FIXTURE_BASE_TAG = "locus-base";
export const FIXTURE_FIX_TAG = "locus-fix";

/**
 * Build a two-commit repo from a fixture folder: `base/` is the first commit (tag
 * `locus-base`), then `fix/` is laid over it as the fix commit (tag `locus-fix`).
 */
export async function materializeFixtureRepo(
  fixtureDir: string,
  dest: string,
  fixMessage = "Fix",
): Promise<void> {
  const base = join(fixtureDir, "base");
  const fix = join(fixtureDir, "fix");
  if (!existsSync(base) || !existsSync(fix)) {
    throw new Error(`Fixture ${fixtureDir} needs base/ and fix/ folders`);
  }
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(base, dest, { recursive: true });
  const env = FIXTURE_DATES;
  await git(["init", "-q"], dest, { env });
  await git(["add", "-A"], dest, { env });
  await git(["commit", "-q", "--no-verify", "-m", "Initial import"], dest, { env });
  await git(["tag", FIXTURE_BASE_TAG], dest, { env });
  await cp(fix, dest, { recursive: true, force: true });
  await git(["add", "-A"], dest, { env });
  await git(["commit", "-q", "--no-verify", "-m", fixMessage], dest, { env });
  await git(["tag", FIXTURE_FIX_TAG], dest, { env });
}

function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

export function isCloneUrl(repo: string): boolean {
  return /^(https?|ssh|git|file):\/\//i.test(repo) || /^[\w.-]+@[\w.-]+:/.test(repo);
}

/**
 * The local git repo a spec points at. Fixtures are built and remotes cloned under `cacheDir`
 * (once per cache dir); local paths resolve against the spec file's folder.
 */
export async function resolveCaseRepo(
  spec: Pick<BenchmarkCaseSpec, "repo" | "title" | "prompt">,
  specDir: string,
  cacheDir: string,
): Promise<string> {
  if (spec.repo.startsWith("fixture:")) {
    const fixtureDir = resolve(specDir, spec.repo.slice("fixture:".length) || ".");
    const dest = join(cacheDir, `fixture-${shortHash(fixtureDir)}`);
    if (!existsSync(join(dest, ".git"))) {
      await materializeFixtureRepo(fixtureDir, dest, spec.title ?? spec.prompt.split("\n")[0]);
    }
    return dest;
  }
  if (isCloneUrl(spec.repo)) {
    const dest = join(cacheDir, `clone-${shortHash(spec.repo)}`);
    if (!existsSync(join(dest, ".git")) && !existsSync(join(dest, "HEAD"))) {
      await mkdir(cacheDir, { recursive: true });
      await git(["clone", "--quiet", "--no-checkout", "--", spec.repo, dest], cacheDir, {
        timeoutMs: 15 * 60_000,
      });
    }
    return dest;
  }
  const local = resolve(specDir, spec.repo);
  const info = await stat(local).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`Repo not found: ${local}`);
  await git(["rev-parse", "--git-dir"], local).catch(() => {
    throw new Error(`Not a git repository: ${local}`);
  });
  return local;
}

export interface ShellResult {
  /** Exit code; null when killed. */
  code: number | null;
  ok: boolean;
  output: string;
  timedOut: boolean;
}

const OUTPUT_CAP = 2 * 1024 * 1024;

/** Run a shell command (stdout + stderr merged, tail-capped) with a hard time limit. */
export function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  env: Record<string, string> = {},
): Promise<ShellResult> {
  return new Promise((resolvePromise) => {
    let output = "";
    let timedOut = false;
    const posix = process.platform !== "win32";
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: posix,
      windowsHide: true,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > OUTPUT_CAP) output = output.slice(-OUTPUT_CAP);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const kill = () => {
      try {
        if (posix && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ code: null, ok: false, output: `${output}\n${err.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, ok: code === 0 && !timedOut, output, timedOut });
    });
  });
}

const TOOLCHAINS: Record<BenchmarkLanguage, string[][]> = {
  typescript: [["node", "--version"]],
  javascript: [["node", "--version"]],
  python: [
    ["python3", "--version"],
    ["python", "--version"],
  ],
  go: [["go", "version"]],
  rust: [["cargo", "--version"]],
  java: [["java", "-version"]],
  ruby: [["ruby", "--version"]],
  other: [],
};

const toolchainCache = new Map<string, boolean>();

/** The binary a language's cases need, when it is missing on this machine; else undefined. */
export function missingToolchain(language: BenchmarkLanguage | undefined): string | undefined {
  if (!language) return undefined;
  const probes = TOOLCHAINS[language] ?? [];
  if (!probes.length) return undefined;
  let found = toolchainCache.get(language);
  if (found === undefined) {
    found = probes.some(([bin, ...args]) => {
      const res = spawnSync(bin!, args, { stdio: "ignore", timeout: 10_000, windowsHide: true });
      return !res.error && res.status === 0;
    });
    toolchainCache.set(language, found);
  }
  return found ? undefined : probes.map(([bin]) => bin).join(" / ");
}

/** Read a file, or undefined when it does not exist. */
export async function readMaybe(path: string): Promise<Buffer | undefined> {
  return readFile(path).catch(() => undefined);
}
