import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { hostExecEnv, hostSpawnErrorOutput, posixShellPath } from "@locus/guest-agent";
import {
  detectVerifyPresets,
  goTestJsonToText,
  mergeTestReports,
  parseJUnitXml,
  parseJsonc,
  parseTestOutput,
  parseVerifyConfig,
  resolveVerifyPlan,
  testReportFailedTests,
  verifyManifestNames,
  verifyPlanCommands,
  verifyTargetForPath,
  type TestReport,
  type VerifyCommandPlan,
  type VerifyStep,
  type VerifyTarget,
} from "@locus/shared";
import {
  aggregateFailureKind,
  clipScriptOutput,
  defaultVerifyTimeoutMs,
  isNonTestPath,
  outputLooksLikeMissingDeps,
  outputLooksLikeMissingToolchain,
  runWorkspaceNpmScript,
  stripAnsi,
  workspaceChangedFiles,
  type WorkspaceScriptFailureKind,
  type WorkspaceScriptResult,
} from "./hooks.js";
import { killTreeOnTimeout, processTreeSpawnOptions } from "./processTree.js";

/**
 * Language-agnostic verify runner behind the publish test gate, post-edit
 * lint, and benchmarks. Runs on the host against the workspace root (Docker
 * agents share it through a bind mount), so a toolchain missing on the host
 * reports `missing-toolchain` instead of blocking.
 */

export interface WorkspaceVerifyOptions {
  /** Overall budget; defaults to `verify.timeoutSec`, then 10 min test / 2 min typecheck / 30 s lint. */
  timeoutMs?: number;
  /** Skip steps that compile the project (`cargo clippy`, `go vet`, …); used for per-edit lint. */
  skipSlow?: boolean;
  /** Ignore changed-file scoping and run every target that has the step. */
  full?: boolean;
  plan?: WorkspaceVerifyPlan;
}

export interface WorkspaceVerifyPlan {
  targets: VerifyTarget[];
  /** `.locus/environment.json` → `verify` validation errors (the plan still uses valid fields). */
  errors: string[];
  configured: boolean;
}

const OUTPUT_MAX = 24_000;
const RAW_MAX = 4_000_000;
const LIST_DEPTH = 4;
const LIST_MAX = 20_000;
const MANIFEST_MAX_BYTES = 256_000;
const PLAN_TTL_MS = 15_000;

const WALK_SKIP = new Set([
  "node_modules",
  ".git",
  "vendor",
  "target",
  "build",
  "dist",
  "out",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  ".gradle",
  ".mvn",
  ".locus-attachments",
  ".next",
  ".turbo",
  "coverage",
  // Linked git worktrees parked inside the repo (`git worktree add .worktrees/x`).
  ".worktrees",
]);

/**
 * A nested clone (`.git` directory) or linked worktree (`.git` file pointing into
 * `…/worktrees/…`) is a separate checkout, not a verify target. Submodules
 * (`.git` file pointing into `…/modules/…`) stay part of the workspace.
 */
async function isNestedCheckout(dir: string): Promise<boolean> {
  const marker = join(dir, ".git");
  try {
    const info = await stat(marker);
    if (info.isDirectory()) return true;
    if (!info.isFile() || info.size > 4096) return false;
    const text = await readFile(marker, "utf8");
    return !/^gitdir:.*[\\/]modules[\\/]/m.test(text);
  } catch {
    return false;
  }
}

const planCache = new Map<string, { at: number; plan: Promise<WorkspaceVerifyPlan> }>();

/** Drop cached plans (tests, or after `.locus/environment.json` changes). */
export function clearWorkspaceVerifyPlanCache(): void {
  planCache.clear();
}

async function listWorkspaceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (out.length >= LIST_MAX) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= LIST_MAX) return;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const child = join(dir, entry.name);
        if (depth < LIST_DEPTH && !WALK_SKIP.has(entry.name) && !(await isNestedCheckout(child))) {
          await walk(child, path, depth + 1);
        }
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        out.push(path);
      }
    }
  };
  await walk(root, "", 1);
  return out;
}

async function readVerifyConfig(root: string): Promise<{
  config?: ReturnType<typeof parseVerifyConfig>["config"];
  errors: string[];
}> {
  let text: string;
  try {
    text = await readFile(join(root, ".locus", "environment.json"), "utf8");
  } catch {
    return { errors: [] };
  }
  let raw: unknown;
  try {
    raw = parseJsonc(text);
  } catch (error) {
    // Only fail loudly when the operator meant to configure verify.
    if (!/"verify"\s*:/.test(text)) return { errors: [] };
    const detail = error instanceof Error ? error.message : String(error);
    return { errors: [`.locus/environment.json is not valid JSON: ${detail}`] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { errors: [] };
  return parseVerifyConfig((raw as { verify?: unknown }).verify);
}

async function buildPlan(root: string): Promise<WorkspaceVerifyPlan> {
  const [{ config, errors }, files] = await Promise.all([
    readVerifyConfig(root),
    listWorkspaceFiles(root),
  ]);
  const manifestNames = new Set(verifyManifestNames());
  const contents: Record<string, string> = {};
  const manifests = files.filter((file) =>
    manifestNames.has(file.slice(file.lastIndexOf("/") + 1)),
  );
  await Promise.all(
    manifests.slice(0, 200).map(async (file) => {
      try {
        const path = join(root, ...file.split("/"));
        const info = await stat(path);
        if (info.size > MANIFEST_MAX_BYTES) return;
        contents[file] = await readFile(path, "utf8");
      } catch {
        /* unreadable manifests are treated as absent (npm re-reads and fails closed) */
      }
    }),
  );
  const targets = resolveVerifyPlan(config, detectVerifyPresets({ files, contents }));
  return { targets, errors, configured: Boolean(config) };
}

/** Resolve `.locus/environment.json` `verify` over auto-detected presets (cached briefly). */
export function loadWorkspaceVerifyPlan(root: string): Promise<WorkspaceVerifyPlan> {
  const hit = planCache.get(root);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.plan;
  const plan = buildPlan(root);
  planCache.set(root, { at: Date.now(), plan });
  if (planCache.size > 64) {
    const oldest = planCache.keys().next().value;
    if (oldest !== undefined) planCache.delete(oldest);
  }
  return plan;
}

/** Commands that count as a verification run for this workspace ("verify before done"). */
export async function workspaceVerifyCommands(root: string | undefined): Promise<string[]> {
  if (!root) return [];
  try {
    return verifyPlanCommands((await loadWorkspaceVerifyPlan(root)).targets);
  } catch {
    return [];
  }
}

function targetTimeoutMs(
  step: VerifyStep,
  target: VerifyTarget,
  opts: WorkspaceVerifyOptions,
): number {
  if (opts.timeoutMs) return opts.timeoutMs;
  if (target.timeoutSec) return Math.round(target.timeoutSec * 1000);
  return defaultVerifyTimeoutMs(step);
}

/**
 * Run `test`, `lint`, or `typecheck` for a workspace. Picks the configured or
 * detected command per target, scopes to targets owning changed files when
 * the base diff is known, and attaches a parsed {@link TestReport} for tests.
 */
export async function runWorkspaceVerify(
  workspaceRoot: string | undefined,
  step: VerifyStep,
  opts: WorkspaceVerifyOptions = {},
): Promise<WorkspaceScriptResult> {
  if (!workspaceRoot) return { ran: false, ok: true, output: "" };
  let plan: WorkspaceVerifyPlan;
  try {
    plan = opts.plan ?? (await loadWorkspaceVerifyPlan(workspaceRoot));
  } catch (error) {
    return {
      ran: true,
      ok: false,
      output: `Unable to resolve verify commands: ${error instanceof Error ? error.message : String(error)}`,
      cwd: workspaceRoot,
      failureKind: "runner",
      retryable: true,
    };
  }
  if (plan.errors.length) {
    return {
      ran: true,
      ok: false,
      output: `Invalid verify config in .locus/environment.json:\n${plan.errors.map((err) => `- ${err}`).join("\n")}`,
      cwd: workspaceRoot,
      command: `verify ${step}`,
      failureKind: "runner",
      retryable: true,
    };
  }
  const withStep = plan.targets.filter((target) => {
    const cmd = target.steps[step];
    return cmd && !(opts.skipSlow && cmd.slow);
  });
  if (!withStep.length) return { ran: false, ok: true, output: "" };
  const projectRoots = plan.targets.filter((target) => target.root !== ".").map((t) => t.root);

  // Single npm-family root and no sub-projects: the legacy npm planner, unchanged.
  const rootTarget = plan.targets[0]!;
  if (
    !projectRoots.length &&
    withStep.length === 1 &&
    withStep[0] === rootTarget &&
    rootTarget.steps[step]!.script
  ) {
    const script = rootTarget.steps[step]!.script!;
    return runWorkspaceNpmScript(workspaceRoot, step, targetTimeoutMs(step, rootTarget, opts), {
      packageManager: script.manager,
      full: opts.full,
    });
  }

  const selected = opts.full ? withStep : await scopeTargets(workspaceRoot, plan.targets, withStep);
  if (!selected.length) return { ran: false, ok: true, output: "" };

  const startedAt = Date.now();
  const budget = opts.timeoutMs;
  const results: WorkspaceScriptResult[] = [];
  for (const target of selected) {
    const cmd = target.steps[step]!;
    const own = targetTimeoutMs(step, target, { ...opts, timeoutMs: undefined });
    const remaining = budget ? Math.max(1, budget - (Date.now() - startedAt)) : own;
    const timeoutMs = Math.min(own, remaining);
    const cwd =
      target.root === "." ? workspaceRoot : join(workspaceRoot, ...target.root.split("/"));
    if (cmd.script) {
      const result = await runWorkspaceNpmScript(cwd, step, timeoutMs, {
        packageManager: cmd.script.manager,
        full: opts.full,
        ...(target.root === "." ? { ignorePaths: projectRoots } : {}),
      });
      if (result.ran) results.push({ ...result, cwd: result.cwd ?? cwd });
      continue;
    }
    results.push(await runVerifyCommand(cwd, step, cmd, timeoutMs));
  }
  return aggregateVerifyResults(workspaceRoot, results, Date.now() - startedAt);
}

async function scopeTargets(
  workspaceRoot: string,
  all: VerifyTarget[],
  withStep: VerifyTarget[],
): Promise<VerifyTarget[]> {
  const changes = await workspaceChangedFiles(workspaceRoot);
  if (!changes.baselineKnown || !changes.files.length) return withStep;
  const owners = new Set<string>();
  for (const raw of changes.files) {
    const file = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    if (isNonTestPath(file)) continue;
    owners.add(verifyTargetForPath(all, file).root);
  }
  return withStep.filter((target) => owners.has(target.root));
}

function aggregateVerifyResults(
  workspaceRoot: string,
  results: WorkspaceScriptResult[],
  durationMs: number,
): WorkspaceScriptResult {
  if (!results.length) return { ran: false, ok: true, output: "" };
  if (results.length === 1) return results[0]!;
  const failures = results.filter((result) => !result.ok);
  const exitCode = failures.find((result) => result.exitCode !== undefined)?.exitCode;
  const output = clipScriptOutput(
    results
      .map((result) => {
        const label = relative(workspaceRoot, result.cwd ?? workspaceRoot) || ".";
        return `=== ${label}: ${result.command ?? "verify"} ===\n${result.output}`;
      })
      .join("\n\n"),
    OUTPUT_MAX,
  );
  const report = mergeTestReports(results.map((result) => result.report));
  return {
    ran: true,
    ok: failures.length === 0,
    output,
    cwd: workspaceRoot,
    command: [...new Set(results.map((result) => result.command).filter(Boolean))].join("; "),
    durationMs,
    ...(report ? { report } : {}),
    ...(failures.length
      ? {
          failureKind: aggregateFailureKind(failures),
          ...(exitCode !== undefined ? { exitCode } : {}),
          failedTests: [...new Set(failures.flatMap((result) => result.failedTests ?? []))].slice(
            0,
            20,
          ),
        }
      : {}),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Run one shell command for one target and parse its output. */
export async function runVerifyCommand(
  cwd: string,
  step: VerifyStep,
  plan: VerifyCommandPlan,
  timeoutMs: number,
): Promise<WorkspaceScriptResult> {
  let command = plan.run ?? plan.command;
  let junitTemp: string | undefined;
  if (step === "test" && plan.junitFlag && plan.source !== "config") {
    junitTemp = join(tmpdir(), `locus-junit-${randomUUID()}.xml`);
    command = `${command} ${plan.junitFlag}=${shellQuote(junitTemp)}`;
  }
  const startedAt = Date.now();
  const run = await runShellCapture(cwd, command, timeoutMs);
  const durationMs = Date.now() - startedAt;
  let report: TestReport | undefined;
  if (step === "test") {
    if (junitTemp) {
      report = await readJUnitFile(junitTemp);
      await rm(junitTemp, { force: true }).catch(() => undefined);
    } else if (plan.junit) {
      report = await readJUnitGlob(cwd, plan.junit, startedAt);
    }
    report ??= parseTestOutput(run.raw, plan.format === "junit" ? undefined : plan.format);
  }
  const text = plan.format === "go-json" ? goTestJsonToText(run.raw) : run.raw;
  const body =
    clipScriptOutput(stripAnsi(text).trim(), OUTPUT_MAX) ||
    (run.spawnError ?? `(${plan.command} exited ${run.code ?? "null"})`);
  const ok = run.code === 0 && !run.timedOut && !run.spawnError;
  const failedTests = testReportFailedTests(report);
  return {
    ran: true,
    ok,
    output: body,
    cwd,
    command: plan.command,
    ...(typeof run.code === "number" ? { exitCode: run.code } : {}),
    durationMs,
    ...(report ? { report } : {}),
    ...(ok
      ? {}
      : {
          failureKind: classifyVerifyFailure(step, body, run),
          ...(failedTests.length ? { failedTests } : {}),
          ...(run.spawnError || outputLooksLikeMissingToolchain(body, run.code ?? undefined)
            ? { retryable: true }
            : {}),
        }),
  };
}

function classifyVerifyFailure(
  step: VerifyStep,
  output: string,
  run: ShellRun,
): WorkspaceScriptFailureKind {
  if (run.timedOut) return "timeout";
  if (run.spawnError) return "runner";
  if (outputLooksLikeMissingToolchain(output, run.code ?? undefined)) return "missing-toolchain";
  if (outputLooksLikeMissingDeps(output)) return "missing-dependencies";
  if (run.code == null) return "runner";
  return step === "test" ? "test-failure" : "script-failure";
}

interface ShellRun {
  raw: string;
  code: number | null;
  timedOut: boolean;
  spawnError?: string;
}

function runShellCapture(cwd: string, command: string, timeoutMs: number): Promise<ShellRun> {
  return new Promise((resolve) => {
    const shell = posixShellPath();
    let raw = "";
    let timedOut = false;
    let settled = false;
    const env = hostExecEnv(process.platform, { ...process.env, CI: "1" }, shell);
    const child = spawn(shell, ["-lc", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...processTreeSpawnOptions,
    });
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const append = (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      // Keep the tail: summaries and failure lists print last.
      if (raw.length > RAW_MAX) raw = raw.slice(-Math.floor(RAW_MAX * 0.75));
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const onClose = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (fallback) clearTimeout(fallback);
      resolve({ raw, code, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      fallback = killTreeOnTimeout(child, () => onClose(null));
    }, timeoutMs);
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (fallback) clearTimeout(fallback);
      resolve({ raw, code: null, timedOut, spawnError: hostSpawnErrorOutput(err, shell, cwd) });
    });
    child.on("close", onClose);
  });
}

async function readJUnitFile(path: string): Promise<TestReport | undefined> {
  try {
    return parseJUnitXml(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Convert a `**` / `*` / `?` glob into an anchored regex over POSIX relative paths. */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  const src = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (c === "*") {
      if (src[i + 1] === "*") {
        i += 1;
        if (src[i + 1] === "/") {
          i += 1;
          out += "(?:.*/)?";
        } else out += ".*";
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** Read JUnit reports matching `glob` under `cwd` written since `sinceMs` (stale reports are ignored). */
async function readJUnitGlob(
  cwd: string,
  glob: string,
  sinceMs: number,
): Promise<TestReport | undefined> {
  const pattern = globToRegExp(glob);
  const matches: string[] = [];
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > 10 || matches.length >= 500) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git")
          await walk(join(dir, entry.name), path, depth + 1);
      } else if (pattern.test(path)) matches.push(path);
    }
  };
  await walk(cwd, "", 0);
  const reports: Array<TestReport | undefined> = [];
  for (const rel of matches) {
    const path = join(cwd, ...rel.split("/"));
    try {
      const info = await stat(path);
      if (info.mtimeMs < sinceMs - 2000) continue;
      reports.push(parseJUnitXml(await readFile(path, "utf8")));
    } catch {
      /* skip unreadable report */
    }
  }
  return mergeTestReports(reports);
}
