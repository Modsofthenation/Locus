import { execFile } from "node:child_process";
import { mkdir, mkdtemp, open, readdir, realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  forgeWebOrigin,
  gitHttpsAuthUser,
  pullHeadRefspec,
  remoteUrlForToken,
  reviewPathMatchesGlob,
  type ForgeKind,
  type GitForgeAccount,
  type ParsedPullUrl,
} from "@locus/shared";

/**
 * A shallow, read-only clone of a PR's head commit that a Slack review can look around in.
 * The model gets `read_file`, `list_dir`, `find_files` and `grep` over it; nothing in it runs.
 */
export interface ReviewCheckout {
  dir: string;
  /** Commit checked out. Normally the PR head SHA the diff came from. */
  sha: string;
  run(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }>;
  dispose(): Promise<void>;
}

export interface ReviewCheckoutInput {
  /** Folder that holds every review clone (`<dataDir>/slack-reviewers/checkouts`). */
  parentDir: string;
  account: GitForgeAccount;
  pr: ParsedPullUrl;
  headSha: string;
  /** PR source branch. Fetched when neither the SHA nor the forge's PR ref can be. */
  headRef?: string;
  signal?: AbortSignal;
}

const CLONE_TIMEOUT_MS = 180_000;
const CHECKOUT_PREFIX = "review-";
/**
 * A clone older than this is left over: a review deletes its own clone when it ends, and the
 * longest one (clone + 10-minute model budget) finishes well inside it.
 */
export const REVIEW_CHECKOUT_STALE_MS = 30 * 60 * 1000;

/**
 * Delete review clones left behind by a crash, kill or power loss. Only folders this module
 * created (`review-*` in `parentDir`) are touched. `maxAgeMs: 0` removes every one (startup,
 * when no review can be running in this process). Returns how many were removed.
 */
export async function sweepReviewCheckouts(
  parentDir: string,
  opts: { maxAgeMs?: number; now?: number } = {},
): Promise<number> {
  const maxAge = opts.maxAgeMs ?? REVIEW_CHECKOUT_STALE_MS;
  const now = opts.now ?? Date.now();
  let entries;
  try {
    entries = await readdir(parentDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(CHECKOUT_PREFIX)) continue;
    const path = join(parentDir, entry.name);
    try {
      const info = await stat(path);
      if (maxAge > 0 && now - info.mtimeMs < maxAge) continue;
      await rm(path, { recursive: true, force: true });
      removed++;
    } catch {
      /* already gone, or in use on Windows: the next sweep gets it */
    }
  }
  return removed;
}
const TOOL_TIMEOUT_MS = 20_000;
/** Characters of one tool result sent back to the model. */
export const REVIEW_TOOL_OUTPUT_MAX = 16_000;
const READ_PAGE_LINES = 400;
const READ_MAX_BYTES = 2 * 1024 * 1024;
const LIST_MAX = 400;
const FIND_MAX = 200;
const GREP_MAX = 150;
const GREP_LINE_MAX = 300;

function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    // The operator's own git config (insteadOf rewrites, credential helpers, hooks paths) must not
    // apply to a clone made with a Locus token, nor leak a second Authorization header.
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_LFS_SKIP_SMUDGE: "1",
    ...extra,
  };
}

function git(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: opts.cwd,
        env: opts.env ?? gitEnv(),
        timeout: opts.timeoutMs ?? TOOL_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        signal: opts.signal,
      },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number"
            ? ((err as unknown as { code: number }).code as number)
            : err
              ? -1
              : 0;
        if (err && code === -1) {
          reject(
            new Error(
              String(stderr || err.message)
                .trim()
                .slice(0, 400),
            ),
          );
          return;
        }
        resolvePromise({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

async function gitOk(args: string[], opts: Parameters<typeof git>[1] = {}): Promise<string> {
  const res = await git(args, opts);
  if (res.code !== 0) {
    throw new Error(
      (res.stderr || res.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400),
    );
  }
  return res.stdout;
}

/** Token as an HTTP header through env config: never on argv, never in `.git/config`. */
export function reviewCheckoutAuthEnv(url: string, token?: string): Record<string, string> {
  if (!token?.trim()) return {};
  const user = gitHttpsAuthUser(url, token);
  const basic = Buffer.from(`${user}:${token.trim()}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

/**
 * The remote to clone with. A PR link pasted as `http://` keeps that scheme in `repoUrl`, but the
 * forge redirects git to https and git (libcurl) drops the Authorization header across a scheme
 * change, so the fetch fails with "could not read Username" — after the token went out once in
 * the clear. When the account's forge serves this host over https, use https from the start.
 */
export function reviewRemoteUrl(account: GitForgeAccount, repoUrl: string): string {
  const remote = remoteUrlForToken(repoUrl, account.token);
  let url: URL;
  let origin: URL;
  try {
    url = new URL(remote);
    origin = new URL(forgeWebOrigin(account.kind, account.apiBaseUrl));
  } catch {
    return remote;
  }
  if (url.protocol !== "http:" || origin.protocol !== "https:") return remote;
  if (url.hostname.toLowerCase() !== origin.hostname.toLowerCase()) return remote;
  url.protocol = "https:";
  if (url.port === "80") url.port = "";
  return url.toString();
}

function forgeKind(account: GitForgeAccount): ForgeKind {
  return account.kind;
}

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const SHORT_SHA = /^[0-9a-f]{7,64}$/i;
/** How far back a branch fetch looks for the PR head when the branch has moved past it. */
const BRANCH_DEEPEN = 50;

/** A branch name that is safe as `refs/heads/<name>` in a fetch refspec, or undefined. */
export function safeBranchName(raw?: string): string | undefined {
  const name = raw?.trim().replace(/^refs\/heads\//, "");
  if (!name || name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) return undefined;
  // Control characters are not allowed in a ref name.
  // eslint-disable-next-line no-control-regex
  if (/[\s:^~?*[\\\x00-\x1f\x7f]|\.\.|@\{|\/\/|\.lock$|^\.|\/\./.test(name)) return undefined;
  return name;
}

/**
 * Refspecs to try, best first. A full SHA is exact; the forge PR ref is the PR head on GitHub,
 * GitLab and Bitbucket Server; the source branch is the only option on Bitbucket Cloud, which
 * publishes no PR refs and whose API returns 12-character short hashes that git cannot fetch.
 */
export function reviewFetchSpecs(input: {
  forge: ForgeKind;
  number: number;
  headSha: string;
  headRef?: string;
}): string[] {
  const specs: string[] = [];
  const sha = input.headSha.trim();
  if (FULL_SHA.test(sha)) specs.push(sha);
  specs.push(pullHeadRefspec(input.forge, input.number));
  const branch = safeBranchName(input.headRef);
  if (branch) specs.push(`refs/heads/${branch}`);
  return specs;
}

function lastLines(text: string, n: number): string {
  return text.trim().split("\n").slice(-n).join(" ");
}

/**
 * Clone the PR head into a new temp folder: `git init`, then fetch at depth 1 the first of the
 * head SHA, the forge's PR ref and the source branch that the server will serve, and check it
 * out detached with symlinks as plain files. When the head SHA is known only in part (Bitbucket
 * Cloud) and the branch has moved on, the fetch is deepened to find it. Throws with each
 * attempt's git error on failure; the folder is removed.
 */
export async function cloneReviewCheckout(input: ReviewCheckoutInput): Promise<ReviewCheckout> {
  await mkdir(input.parentDir, { recursive: true });
  // Leftovers from a crash or a kill mid-review go before a new clone adds to the folder.
  await sweepReviewCheckouts(input.parentDir);
  const dir = await mkdtemp(join(input.parentDir, CHECKOUT_PREFIX));
  const dispose = () => rm(dir, { recursive: true, force: true }).catch(() => undefined);
  try {
    const remote = reviewRemoteUrl(input.account, input.pr.repoUrl);
    const env = gitEnv(reviewCheckoutAuthEnv(remote, input.account.token));
    const opts = { cwd: dir, env, timeoutMs: CLONE_TIMEOUT_MS, signal: input.signal };
    await gitOk(["init", "-q", "."], opts);
    // Symlinks in an untrusted tree become plain files, so no path in it points outside.
    await gitOk(["config", "core.symlinks", "false"], opts);
    await gitOk(
      ["config", "core.hooksPath", process.platform === "win32" ? "NUL" : "/dev/null"],
      opts,
    );
    await gitOk(["remote", "add", "origin", remote], opts);
    const fetch = (spec: string, depth = 1) =>
      git(
        [
          "fetch",
          "-q",
          "--depth",
          String(depth),
          "--no-tags",
          "--no-recurse-submodules",
          "origin",
          spec,
        ],
        opts,
      );
    const specs = reviewFetchSpecs({
      forge: forgeKind(input.account),
      number: input.pr.number,
      headSha: input.headSha,
      headRef: input.headRef,
    });
    const failures: string[] = [];
    let fetchedSpec: string | undefined;
    for (const spec of specs) {
      const res = await fetch(spec);
      if (res.code === 0) {
        fetchedSpec = spec;
        break;
      }
      failures.push(`${spec}: ${lastLines(res.stderr || res.stdout, 1).slice(0, 160)}`);
    }
    if (!fetchedSpec) {
      throw new Error(failures.join("; ").slice(0, 400) || "nothing to fetch");
    }
    let target = "FETCH_HEAD";
    const want = input.headSha.trim().toLowerCase();
    if (!FULL_SHA.test(want) && SHORT_SHA.test(want)) {
      // Only a prefix of the head is known: make sure it is what we check out.
      const got = (await gitOk(["rev-parse", "FETCH_HEAD"], opts)).trim().toLowerCase();
      if (!got.startsWith(want)) {
        const deeper = await fetch(fetchedSpec, BRANCH_DEEPEN);
        if (deeper.code === 0) {
          const found = await git(["rev-parse", "--verify", "-q", `${want}^{commit}`], opts);
          if (found.code === 0 && found.stdout.trim()) target = found.stdout.trim();
        }
      }
    }
    await gitOk(["-c", "advice.detachedHead=false", "checkout", "-q", "--detach", target], opts);
    const sha = (await gitOk(["rev-parse", "HEAD"], opts)).trim();
    const root = await realpath(dir);
    return {
      dir: root,
      sha,
      run: (name, args) => runReviewTool(root, name, args),
      dispose,
    };
  } catch (err) {
    await dispose();
    throw err;
  }
}

function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function argInt(args: Record<string, unknown>, key: string): number | undefined {
  const n = Number(args[key]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function cap(text: string, max = REVIEW_TOOL_OUTPUT_MAX): string {
  return text.length > max ? `${text.slice(0, max)}\n… (output cut at ${max} characters)` : text;
}

/** Resolve a model-supplied path inside the checkout, or explain why not. */
export async function resolveCheckoutPath(
  root: string,
  raw: string,
): Promise<{ abs: string; rel: string } | { error: string }> {
  const cleaned = raw
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (isAbsolute(raw) && !raw.startsWith("/"))
    return { error: "use a path relative to the repository root" };
  const abs = resolve(root, cleaned || ".");
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return { error: "path is outside the repository" };
  const parts = rel.split(sep);
  if (parts.includes(".git")) return { error: "the .git folder is not part of the review" };
  try {
    const real = await realpath(abs);
    const realRel = relative(root, real);
    if (realRel.startsWith("..") || isAbsolute(realRel))
      return { error: "path is outside the repository" };
  } catch {
    return { error: `no such file or folder: ${cleaned || "."}` };
  }
  return { abs, rel: rel.split(sep).join("/") };
}

export async function runReviewTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  try {
    if (name === "read_file") return await readFileTool(root, args);
    if (name === "list_dir") return await listDirTool(root, args);
    if (name === "find_files") return await findFilesTool(root, args);
    if (name === "grep") return await grepTool(root, args);
    return {
      ok: false,
      output: `Unknown tool ${name}. Use read_file, list_dir, find_files or grep.`,
    };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
}

async function readFileTool(
  root: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const path = argString(args, "path");
  if (!path) return { ok: false, output: "path is required" };
  const target = await resolveCheckoutPath(root, path);
  if ("error" in target) return { ok: false, output: target.error };
  const info = await stat(target.abs);
  if (info.isDirectory()) return { ok: false, output: `${target.rel} is a folder; use list_dir` };
  if (info.size > READ_MAX_BYTES) {
    return {
      ok: false,
      output: `${target.rel} is ${Math.round(info.size / 1024)} KB; use grep on it instead`,
    };
  }
  const handle = await open(target.abs, "r");
  let buf: Buffer;
  try {
    buf = await handle.readFile();
  } finally {
    await handle.close();
  }
  if (buf.subarray(0, 8_000).includes(0))
    return { ok: false, output: `${target.rel} is a binary file` };
  const lines = buf.toString("utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const start = Math.min(Math.max(1, argInt(args, "start_line") ?? 1), Math.max(1, lines.length));
  const wantEnd = argInt(args, "end_line") ?? start + READ_PAGE_LINES - 1;
  const end = Math.min(
    lines.length,
    Math.max(start, Math.min(wantEnd, start + READ_PAGE_LINES * 2 - 1)),
  );
  const width = String(end).length;
  const body: string[] = [];
  let used = 0;
  let last = start - 1;
  for (let n = start; n <= end; n++) {
    const row = `${String(n).padStart(width)}  ${lines[n - 1] ?? ""}`;
    if (used + row.length + 1 > REVIEW_TOOL_OUTPUT_MAX - 200) break;
    body.push(row);
    used += row.length + 1;
    last = n;
  }
  const header = `${target.rel} (lines ${start}-${last} of ${lines.length})`;
  const more = last < lines.length ? `\n… more: read_file start_line=${last + 1}` : "";
  return { ok: true, output: `${header}\n${body.join("\n")}${more}` };
}

async function listDirTool(
  root: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const target = await resolveCheckoutPath(root, argString(args, "path") || ".");
  if ("error" in target) return { ok: false, output: target.error };
  const entries = await readdir(target.abs, { withFileTypes: true });
  const rows = entries
    .filter((entry) => entry.name !== ".git")
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort((a, b) => a.localeCompare(b));
  const shown = rows.slice(0, LIST_MAX);
  const more = rows.length > shown.length ? `\n… ${rows.length - shown.length} more` : "";
  return { ok: true, output: cap(`${target.rel || "."}/\n${shown.join("\n")}${more}`) };
}

async function trackedFiles(root: string): Promise<string[]> {
  const out = await gitOk(["ls-files", "-z"], { cwd: root });
  return out.split("\0").filter(Boolean);
}

async function findFilesTool(
  root: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const pattern = argString(args, "pattern");
  if (!pattern) return { ok: false, output: "pattern is required" };
  const glob = pattern.replace(/^\.\/+/, "").replace(/^\/+/, "");
  const hits = (await trackedFiles(root)).filter((path) => reviewPathMatchesGlob(path, glob));
  if (!hits.length) return { ok: true, output: `No tracked files match ${pattern}` };
  const shown = hits.slice(0, FIND_MAX);
  const more =
    hits.length > shown.length ? `\n… ${hits.length - shown.length} more; narrow the pattern` : "";
  return { ok: true, output: cap(`${shown.join("\n")}${more}`) };
}

async function grepTool(
  root: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const pattern = typeof args.pattern === "string" ? args.pattern : "";
  if (!pattern.trim()) return { ok: false, output: "pattern is required" };
  const gitArgs = ["grep", "-n", "-I", "-E", "--no-color", "--full-name"];
  if (args.ignore_case === true) gitArgs.push("-i");
  gitArgs.push("-e", pattern, "--");
  const path = argString(args, "path");
  if (path) {
    const target = await resolveCheckoutPath(root, path);
    if ("error" in target) return { ok: false, output: target.error };
    gitArgs.push(`:(literal)${target.rel || "."}`);
  }
  const res = await git(gitArgs, { cwd: root });
  if (res.code === 1) return { ok: true, output: "No matches." };
  if (res.code !== 0)
    return { ok: false, output: (res.stderr || "grep failed").trim().slice(0, 400) };
  const glob = argString(args, "glob");
  let rows = res.stdout.split("\n").filter(Boolean);
  if (glob) rows = rows.filter((row) => reviewPathMatchesGlob(row.split(":", 1)[0] ?? "", glob));
  if (!rows.length) return { ok: true, output: "No matches." };
  const shown = rows
    .slice(0, GREP_MAX)
    .map((row) => (row.length > GREP_LINE_MAX ? `${row.slice(0, GREP_LINE_MAX)}…` : row));
  const more =
    rows.length > shown.length
      ? `\n… ${rows.length - shown.length} more matches; narrow the pattern or path`
      : "";
  return { ok: true, output: cap(`${shown.join("\n")}${more}`) };
}
