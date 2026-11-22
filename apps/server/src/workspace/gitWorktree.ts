import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  isWorktreeSeedFile,
  parseShortStat,
  parseWorktreeList,
  parseWorktreeSetupConfig,
  type GitWorktreeEntry,
  type SessionWorktree,
  type WorktreeDiffStat,
} from "@locus/shared";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 60_000;

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
  };
}

export type GitRunner = (cwd: string, args: string[]) => Promise<string>;

export const runGit: GitRunner = async (cwd, args) => {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    env: gitEnv(),
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
};

function gitError(err: unknown): string {
  const raw = err as { stderr?: string; message?: string };
  const text = (raw?.stderr || raw?.message || String(err)).trim();
  return text.split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 400);
}

/** Toplevel of the checkout containing `dir`, or undefined when it is not a git work tree. */
export async function gitToplevel(
  dir: string,
  git: GitRunner = runGit,
): Promise<string | undefined> {
  if (!dir || !existsSync(dir)) return undefined;
  try {
    const top = (await git(dir, ["rev-parse", "--show-toplevel"])).trim();
    if (!top) return undefined;
    await git(top, ["rev-parse", "--verify", "HEAD"]);
    return resolve(top);
  } catch {
    return undefined;
  }
}

async function branchExists(source: string, branch: string, git: GitRunner): Promise<boolean> {
  try {
    await git(source, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/** First free `branch`, `branch-2`, `branch-3`, ... */
export async function freeBranchName(
  source: string,
  branch: string,
  git: GitRunner = runGit,
): Promise<string> {
  if (!(await branchExists(source, branch, git))) return branch;
  for (let n = 2; n < 100; n++) {
    const next = `${branch}-${n}`;
    if (!(await branchExists(source, next, git))) return next;
  }
  throw new Error(`Could not find a free branch name near ${branch}`);
}

/**
 * `git worktree add -b <branch> <path> <base>` from `source`.
 * `base` defaults to the source HEAD. Returns the record stored on the session.
 */
export async function addWorktree(
  input: { source: string; path: string; branch: string; base?: string },
  git: GitRunner = runGit,
): Promise<SessionWorktree> {
  const source = await gitToplevel(input.source, git);
  if (!source) throw new Error(`${input.source} is not a git checkout with a commit`);
  const path = resolve(input.path);
  if (path === source || path.startsWith(`${source}${sep}`)) {
    throw new Error("A worktree cannot live inside its source checkout");
  }
  if (existsSync(path)) {
    const entries = await readdir(path).catch(() => []);
    if (entries.length) throw new Error(`Worktree folder already exists: ${path}`);
  }
  await mkdir(dirname(path), { recursive: true });
  const baseRef = input.base?.trim() || "HEAD";
  let baseSha: string;
  try {
    baseSha = (await git(source, ["rev-parse", "--verify", `${baseRef}^{commit}`])).trim();
  } catch (err) {
    throw new Error(`Unknown base ${baseRef}: ${gitError(err)}`);
  }
  let baseBranch = "";
  if (baseRef === "HEAD") {
    baseBranch = (await git(source, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim();
    if (baseBranch === "HEAD") baseBranch = "";
  } else if (await branchExists(source, baseRef, git)) {
    baseBranch = baseRef;
  }
  const branch = await freeBranchName(source, input.branch, git);
  try {
    await git(source, ["worktree", "add", "-b", branch, path, baseSha]);
  } catch (err) {
    throw new Error(`git worktree add failed: ${gitError(err)}`);
  }
  return { source, path, branch, baseSha, ...(baseBranch ? { baseBranch } : {}) };
}

/** Remove the worktree folder and prune. Optionally delete its branch (discard). */
export async function removeWorktree(
  wt: Pick<SessionWorktree, "source" | "path" | "branch">,
  opts: { deleteBranch?: boolean } = {},
  git: GitRunner = runGit,
): Promise<void> {
  if (existsSync(wt.source)) {
    await git(wt.source, ["worktree", "remove", "--force", "--force", wt.path]).catch(
      () => undefined,
    );
  }
  if (existsSync(wt.path))
    await rm(wt.path, { recursive: true, force: true }).catch(() => undefined);
  if (existsSync(wt.source)) {
    await git(wt.source, ["worktree", "prune"]).catch(() => undefined);
    if (opts.deleteBranch) {
      await git(wt.source, ["branch", "-D", wt.branch]).catch(() => undefined);
    }
  }
}

export async function listWorktrees(
  source: string,
  git: GitRunner = runGit,
): Promise<GitWorktreeEntry[]> {
  return parseWorktreeList(await git(source, ["worktree", "list", "--porcelain"]));
}

export type WorktreeStatus = {
  branch: string;
  stat: WorktreeDiffStat;
  commits: number;
  dirty: number;
  /** Changed paths against the base: tracked diff first, then untracked. */
  paths: string[];
};

const UNTRACKED_COUNT_LIMIT = 2 * 1024 * 1024;

/** Lines in a new text file, as `git diff` would count them; 0 for binary, large or unreadable files. */
async function countTextLines(path: string): Promise<number> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > UNTRACKED_COUNT_LIMIT) return 0;
    const text = await readFile(path, "utf8");
    if (!text || text.includes("\0")) return 0;
    const newlines = text.split("\n").length - 1;
    return text.endsWith("\n") ? newlines : newlines + 1;
  } catch {
    return 0;
  }
}

/** Diffstat of committed + uncommitted work against the base commit. */
export async function worktreeStatus(
  wt: Pick<SessionWorktree, "path" | "baseSha">,
  git: GitRunner = runGit,
): Promise<WorktreeStatus> {
  const [branch, short, count, porcelain, names] = await Promise.all([
    git(wt.path, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ""),
    // Intent-to-add is not needed: untracked files are counted in `dirty` and folded in below.
    git(wt.path, ["diff", "--shortstat", wt.baseSha]).catch(() => ""),
    git(wt.path, ["rev-list", "--count", `${wt.baseSha}..HEAD`]).catch(() => "0"),
    git(wt.path, ["status", "--porcelain=v1", "--untracked-files=all"]).catch(() => ""),
    git(wt.path, ["diff", "--name-only", wt.baseSha]).catch(() => ""),
  ]);
  const lines = porcelain.split("\n").filter((line) => line.trim());
  const untrackedPaths = lines
    .filter((line) => line.startsWith("??"))
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""));
  const stat = parseShortStat(short);
  const paths = [
    ...new Set([
      ...names
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      ...untrackedPaths,
    ]),
  ];
  // `git diff` skips untracked files, so new files the agent wrote would read +0.
  const untrackedLines = await Promise.all(
    untrackedPaths.map((rel) => countTextLines(join(wt.path, rel))),
  );
  return {
    branch: branch.trim(),
    stat: {
      ...stat,
      files: stat.files + untrackedPaths.length,
      insertions: stat.insertions + untrackedLines.reduce((sum, n) => sum + n, 0),
    },
    commits: Number(count.trim()) || 0,
    dirty: lines.length,
    paths,
  };
}

/** Full patch of the worktree against its base (committed + uncommitted + untracked). */
export async function worktreeDiff(
  wt: Pick<SessionWorktree, "path" | "baseSha">,
  maxChars = 200_000,
  git: GitRunner = runGit,
): Promise<string> {
  const tracked = await git(wt.path, ["diff", "--no-color", wt.baseSha]).catch(() => "");
  const untracked = (
    await git(wt.path, ["ls-files", "--others", "--exclude-standard"]).catch(() => "")
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 200);
  let out = tracked;
  for (const rel of untracked) {
    if (out.length > maxChars) break;
    const body = await git(wt.path, [
      "diff",
      "--no-color",
      "--no-index",
      "--",
      "/dev/null",
      rel,
    ]).catch((err: { stdout?: string }) => err?.stdout ?? "");
    out += body;
  }
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n… diff truncated` : out;
}

/** `git add -A && git commit` when the worktree has changes. Returns true when it committed. */
export async function commitAll(
  dir: string,
  message: string,
  git: GitRunner = runGit,
): Promise<boolean> {
  const status = await git(dir, ["status", "--porcelain=v1"]);
  if (!status.trim()) return false;
  await git(dir, ["add", "-A"]);
  try {
    await git(dir, [
      "-c",
      "user.name=Locus",
      "-c",
      "user.email=locus@localhost",
      "commit",
      "--no-verify",
      "-m",
      message,
    ]);
  } catch (err) {
    throw new Error(`Commit failed: ${gitError(err)}`);
  }
  return true;
}

export type MergeResult =
  { ok: true; summary: string } | { ok: false; conflicts: string[]; message: string };

/**
 * Merge `branch` into whatever is checked out in `target`. Refuses a dirty target.
 * On conflict the merge is aborted so the target is left as it was.
 */
export async function mergeBranchInto(
  target: string,
  branch: string,
  message: string,
  git: GitRunner = runGit,
): Promise<MergeResult> {
  const dirty = (await git(target, ["status", "--porcelain=v1", "--untracked-files=no"])).trim();
  if (dirty) {
    return {
      ok: false,
      conflicts: [],
      message: "The base checkout has uncommitted changes. Commit or stash them, then merge again.",
    };
  }
  try {
    const out = await git(target, [
      "-c",
      "user.name=Locus",
      "-c",
      "user.email=locus@localhost",
      "merge",
      "--no-ff",
      "--no-edit",
      "-m",
      message,
      branch,
    ]);
    return { ok: true, summary: out.trim().split("\n").slice(-1)[0] ?? "Merged" };
  } catch (err) {
    const conflicts = (
      await git(target, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "")
    )
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    await git(target, ["merge", "--abort"]).catch(() => undefined);
    return {
      ok: false,
      conflicts,
      message: conflicts.length
        ? `Merge conflicts in ${conflicts.slice(0, 8).join(", ")}${conflicts.length > 8 ? "…" : ""}. The merge was aborted.`
        : `Merge failed: ${gitError(err)}`,
    };
  }
}

async function readSetupConfig(source: string) {
  try {
    return parseWorktreeSetupConfig(
      JSON.parse(await readFile(join(source, ".locus", "worktree.json"), "utf8")),
    );
  } catch {
    return parseWorktreeSetupConfig(undefined);
  }
}

function insideRoot(root: string, rel: string): string | undefined {
  const abs = resolve(root, rel);
  return abs === root || abs.startsWith(`${root}${sep}`) ? abs : undefined;
}

/**
 * Copy git-ignored local files a fresh worktree lacks: root `.env*` / `.envrc` / `.npmrc`
 * plus any `copy` entries in `.locus/worktree.json`. Returns the copied relative paths.
 */
export async function seedWorktree(source: string, dest: string): Promise<string[]> {
  const copied: string[] = [];
  const config = await readSetupConfig(source);
  const names = (await readdir(source).catch(() => [] as string[])).filter(isWorktreeSeedFile);
  for (const rel of [...names, ...config.copy]) {
    const from = insideRoot(source, rel);
    const to = insideRoot(dest, rel);
    if (!from || !to || existsSync(to)) continue;
    const info = await stat(from).catch(() => undefined);
    if (!info?.isFile()) continue;
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to).catch(() => undefined);
    if (existsSync(to)) copied.push(rel);
  }
  return copied;
}

export async function worktreeSetupCommand(source: string): Promise<string | undefined> {
  return (await readSetupConfig(source)).setup;
}

/** Run the `.locus/worktree.json` setup command in the worktree. Output is tail-capped. */
export function runWorktreeSetup(
  dir: string,
  command: string,
  timeoutMs = 10 * 60_000,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((done) => {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
    const child = spawn(shell, args, { cwd: dir, env: process.env, windowsHide: true });
    let output = "";
    const keep = (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-4000);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      done({ ok: false, output: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ ok: code === 0, output: output.trim() });
    });
  });
}
