/**
 * Case miner: walk a repo's history for commits that change both source and test files, draft
 * a benchmark spec for each (base = parent, hidden tests = the test files the fix changed), and
 * keep only the ones that verify — the tests fail at base + the fix's test files and pass at
 * the fix commit. Kept specs are written as JSON for review (default `<repo>/.locus/benchmarks`).
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  BENCHMARK_SPEC_DEFAULT_TIMEOUT_SEC,
  parseTestResults,
  validateBenchmarkCaseSpec,
  type BenchmarkCaseSpec,
  type TestOutcome,
} from "@locus/shared";
import {
  exportCommit,
  git,
  gitShowFile,
  resolveCommit,
  runShell,
  type ShellResult,
} from "./benchmarkRepo.js";
import { detectTestCommand, type DetectedTestCommand } from "./detectTestCommand.js";

const TEST_PATH_RE = [
  /(^|\/)(__tests__|tests?|spec|specs)\//i,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /_test\.go$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.py$/,
  /(^|\/)conftest\.py$/,
  /_spec\.rb$/,
  /Tests?\.(java|kt|cs)$/,
];

const SOURCE_EXT_RE =
  /\.([cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs|c|cc|cpp|h|hpp|swift|scala|ex|exs|vue|svelte)$/i;
const NOT_SOURCE_RE =
  /(^|\/)(node_modules|vendor|dist|build|\.github|docs?)\/|(\.d\.ts|\.min\.js|\.lock)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum|Cargo\.lock)$/i;

export function isTestPath(path: string): boolean {
  return TEST_PATH_RE.some((re) => re.test(path));
}

export function isSourcePath(path: string): boolean {
  return SOURCE_EXT_RE.test(path) && !NOT_SOURCE_RE.test(path) && !isTestPath(path);
}

export interface MinedCommit {
  sha: string;
  parents: string[];
  subject: string;
  body: string;
  files: string[];
}

/** Parse `git log --format=%x1e%H%x1f%P%x1f%s%x1f%b%x1f --name-only`. */
export function parseMiningLog(text: string): MinedCommit[] {
  return text
    .split("\x1e")
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [sha = "", parents = "", subject = "", body = "", names = ""] = chunk.split("\x1f");
      return {
        sha: sha.trim(),
        parents: parents.trim().split(/\s+/).filter(Boolean),
        subject: subject.trim(),
        body: body.trim(),
        files: names
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
      };
    })
    .filter((c) => /^[0-9a-f]{7,64}$/.test(c.sha));
}

/** `#123`, `GH-12`, `ABC-123`, and issue URLs in a commit message. */
export function issueRefs(message: string): string[] {
  const refs = new Set<string>();
  for (const m of message.matchAll(/https?:\/\/\S+\/(?:issues|pull)\/\d+/g)) refs.add(m[0]);
  for (const m of message.matchAll(/(?:^|[\s(])(#\d+)\b/g)) refs.add(m[1]!);
  for (const m of message.matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g)) refs.add(m[1]!);
  return [...refs];
}

const TRAILER_RE = /^[A-Za-z][\w-]*: .+$/;

/** Issue-style prompt from a commit message: no trailers, no conventional-commit prefix. */
export function draftPrompt(subject: string, body: string): string {
  const lines = body.split(/\r?\n/);
  while (lines.length && (!lines.at(-1)!.trim() || TRAILER_RE.test(lines.at(-1)!.trim()))) {
    lines.pop();
  }
  const title = subject.replace(/^(fix|bug|bugfix|hotfix)(\([^)]*\))?!?:\s*/i, "").trim();
  const text = lines.join("\n").trim();
  return text ? `${title}\n\n${text}` : title;
}

export interface CandidateCommit extends MinedCommit {
  testFiles: string[];
  sourceFiles: string[];
  issues: string[];
}

/** Commits worth verifying: one parent, at least one source and one test file changed. */
export function pickCandidates(
  commits: MinedCommit[],
  opts: { requireIssue?: boolean } = {},
): CandidateCommit[] {
  const out: CandidateCommit[] = [];
  for (const commit of commits) {
    if (commit.parents.length !== 1) continue;
    const testFiles = commit.files.filter(isTestPath);
    const sourceFiles = commit.files.filter(isSourcePath);
    if (!testFiles.length || !sourceFiles.length) continue;
    const issues = issueRefs(`${commit.subject}\n${commit.body}`);
    if (opts.requireIssue && !issues.length) continue;
    out.push({ ...commit, testFiles, sourceFiles, issues });
  }
  return out;
}

export interface VerificationSide {
  ok: boolean;
  results: Map<string, TestOutcome>;
}

export interface Verification {
  verified: boolean;
  reason: string;
  failToPass: string[];
  passToPass: string[];
}

const MAX_PASS_TO_PASS = 500;

/**
 * Decide whether a drafted case holds up. `base` ran at the parent plus the fix's test files;
 * `fix` ran at the fix commit.
 */
export function classifyVerification(base: VerificationSide, fix: VerificationSide): Verification {
  const none = { failToPass: [], passToPass: [] };
  if (!fix.ok) return { verified: false, reason: "tests fail at the fix commit", ...none };
  if (base.ok) {
    return { verified: false, reason: "tests already pass at base with the new tests", ...none };
  }
  if (!fix.results.size) {
    return { verified: true, reason: "verified by exit code (no per-test output)", ...none };
  }
  const passedAtFix = [...fix.results].filter(([, o]) => o === "passed").map(([name]) => name);
  const failToPass = passedAtFix.filter((name) => base.results.get(name) !== "passed");
  const passToPass = passedAtFix
    .filter((name) => base.results.get(name) === "passed")
    .slice(0, MAX_PASS_TO_PASS);
  if (!failToPass.length) {
    return { verified: false, reason: "no test went from failing to passing", ...none };
  }
  return {
    verified: true,
    reason: `${failToPass.length} fail-to-pass, ${passToPass.length} pass-to-pass`,
    failToPass,
    passToPass,
  };
}

export interface MineOptions {
  /** Local git checkout to mine. */
  repo: string;
  /** `git log --since` value, e.g. `6 months ago` or `2026-01-01`. */
  since?: string;
  /** Verified cases to keep. Default 5. */
  limit?: number;
  /** Commits to scan. Default 500. */
  maxCommits?: number;
  /** Candidates to verify before giving up. Default limit × 4. */
  maxCandidates?: number;
  requireIssue?: boolean;
  /** Branch or commit to walk back from. Default HEAD. */
  ref?: string;
  /** Override the detected test command. */
  testCommand?: string;
  /** Override the detected install step; `null` skips it. */
  setup?: string | null;
  /** Per test / setup run. Default 300. */
  commandTimeoutSec?: number;
  /** Where to write kept specs. Unset: do not write. */
  outDir?: string;
  workDir?: string;
  run?: (command: string, cwd: string, timeoutMs: number) => Promise<ShellResult>;
  detect?: (root: string) => DetectedTestCommand | undefined;
  onProgress?: (line: string) => void;
  signal?: { cancelled: boolean };
}

export interface MinedCandidateReport {
  sha: string;
  subject: string;
  kept: boolean;
  reason: string;
  specId?: string;
  file?: string;
}

export interface MineResult {
  repo: string;
  scanned: number;
  candidates: MinedCandidateReport[];
  specs: BenchmarkCaseSpec[];
  outDir?: string;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "repo"
  );
}

/** `repo` field for a spec written into `outDir`: relative when the spec lives in the repo. */
export function specRepoField(repoAbs: string, outDir: string): string {
  const rel = relative(outDir, repoAbs);
  const inside =
    !relative(repoAbs, outDir).startsWith("..") && !isAbsolute(relative(repoAbs, outDir));
  if (!inside) return repoAbs;
  return rel.split(sep).join("/") || ".";
}

async function overlayTestFiles(repo: string, sha: string, files: string[], dest: string) {
  for (const path of files) {
    const target = join(dest, ...path.split("/"));
    const body = await gitShowFile(repo, sha, path);
    if (body === undefined) await rm(target, { force: true });
    else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
    }
  }
}

export async function mineBenchmarkCases(opts: MineOptions): Promise<MineResult> {
  const repo = resolve(opts.repo);
  await git(["rev-parse", "--git-dir"], repo).catch(() => {
    throw new Error(`Not a git repository: ${repo}`);
  });
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 5)));
  const maxCandidates = Math.max(limit, Math.floor(opts.maxCandidates ?? limit * 4));
  const timeoutMs = Math.max(10, opts.commandTimeoutSec ?? 300) * 1000;
  const run = opts.run ?? runShell;
  const detect = opts.detect ?? detectTestCommand;
  const progress = opts.onProgress ?? (() => undefined);
  const ref = opts.ref ?? "HEAD";
  if (ref.startsWith("-")) throw new Error(`Not a ref: ${ref}`);
  await resolveCommit(repo, ref);

  const args = [
    "log",
    "--no-merges",
    "--no-renames",
    `--max-count=${Math.max(1, Math.min(10_000, opts.maxCommits ?? 500))}`,
    "--format=%x1e%H%x1f%P%x1f%s%x1f%b%x1f",
    "--name-only",
  ];
  if (opts.since) args.push(`--since=${opts.since}`);
  args.push(ref, "--");
  const commits = parseMiningLog(await git(args, repo, { timeoutMs: 120_000 }));
  const candidates = pickCandidates(commits, { requireIssue: opts.requireIssue }).slice(
    0,
    maxCandidates,
  );
  progress(`Scanned ${commits.length} commits, ${candidates.length} candidates.`);

  const work = opts.workDir ?? join(tmpdir(), "locus-bench-mine", randomUUID().slice(0, 8));
  const result: MineResult = { repo, scanned: commits.length, candidates: [], specs: [] };
  const usedIds = new Set<string>();
  try {
    for (const commit of candidates) {
      if (opts.signal?.cancelled || result.specs.length >= limit) break;
      const short = commit.sha.slice(0, 7);
      const report = (kept: boolean, reason: string, spec?: BenchmarkCaseSpec) => {
        result.candidates.push({
          sha: commit.sha,
          subject: commit.subject,
          kept,
          reason,
          specId: spec?.id,
        });
        progress(`${kept ? "✓" : "✗"} ${short} ${commit.subject} — ${reason}`);
      };
      const baseDir = join(work, `${short}-base`);
      const fixDir = join(work, `${short}-fix`);
      try {
        const parent = commit.parents[0]!;
        await exportCommit(repo, parent, baseDir);
        await overlayTestFiles(repo, commit.sha, commit.testFiles, baseDir);
        await exportCommit(repo, commit.sha, fixDir);
        const detected = detect(fixDir);
        const testCommand = opts.testCommand ?? detected?.command;
        if (!testCommand) {
          report(false, "no test command detected");
          continue;
        }
        const setup = opts.setup === null ? undefined : (opts.setup ?? detected?.setup);
        if (setup) {
          const [a, b] = [
            await run(setup, baseDir, timeoutMs),
            await run(setup, fixDir, timeoutMs),
          ];
          if (!a.ok || !b.ok) {
            report(false, `setup failed: ${setup}`);
            continue;
          }
        }
        const atBase = await run(testCommand, baseDir, timeoutMs);
        const atFix = await run(testCommand, fixDir, timeoutMs);
        if (atFix.timedOut || atBase.timedOut) {
          report(false, "tests timed out");
          continue;
        }
        const verdict = classifyVerification(
          { ok: atBase.ok, results: parseTestResults(atBase.output) },
          { ok: atFix.ok, results: parseTestResults(atFix.output) },
        );
        if (!verdict.verified) {
          report(false, verdict.reason);
          continue;
        }
        let id = `${slug(basename(repo))}-${short}`;
        while (usedIds.has(id)) id = `${id}-x`;
        usedIds.add(id);
        const raw: BenchmarkCaseSpec = {
          id,
          title: commit.subject.slice(0, 200),
          repo,
          baseCommit: parent,
          fixCommit: commit.sha,
          prompt: draftPrompt(commit.subject, commit.body),
          ...(setup ? { setup } : {}),
          testCommand,
          failToPass: verdict.failToPass,
          passToPass: verdict.passToPass,
          protectedPaths: commit.testFiles,
          timeoutSec: BENCHMARK_SPEC_DEFAULT_TIMEOUT_SEC,
          ...(detected?.language ? { language: detected.language } : {}),
          ...(commit.issues.length ? { issues: commit.issues } : {}),
        };
        const checked = validateBenchmarkCaseSpec(raw);
        if (!checked.ok) {
          report(false, `draft did not validate: ${checked.errors.join("; ")}`);
          continue;
        }
        result.specs.push(checked.spec);
        report(true, verdict.reason, checked.spec);
      } catch (err) {
        report(false, err instanceof Error ? err.message : String(err));
      } finally {
        await rm(baseDir, { recursive: true, force: true }).catch(() => undefined);
        await rm(fixDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  } finally {
    if (!opts.workDir) await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }

  if (opts.outDir && result.specs.length) {
    const outDir = resolve(opts.outDir);
    await mkdir(outDir, { recursive: true });
    const repoField = specRepoField(repo, outDir);
    for (const spec of result.specs) {
      spec.repo = repoField;
      const file = join(outDir, `${spec.id}.json`);
      await writeFile(file, `${JSON.stringify(spec, null, 2)}\n`);
      const row = result.candidates.find((c) => c.specId === spec.id);
      if (row) row.file = file;
    }
    result.outDir = outDir;
  }
  return result;
}
