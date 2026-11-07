import { existsSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { hostExecEnv, hostSpawnErrorOutput, posixShellPath } from "@locus/guest-agent";
import { parseRepoHooks, type RepoHook, type RepoHooks } from "@locus/shared";
import { resolveWindowsCliSpawn } from "@locus/shared/windowsCliSpawn";

const execFileAsync = promisify(execFile);

export type WorkspaceScriptName = "lint" | "test";

export type WorkspaceScriptFailureKind =
  "missing-dependencies" | "runner" | "timeout" | "script-failure" | "test-failure";

export interface WorkspaceScriptResult {
  ran: boolean;
  ok: boolean;
  output: string;
  cwd?: string;
  command?: string;
  exitCode?: number;
  durationMs?: number;
  failureKind?: WorkspaceScriptFailureKind;
  failedTests?: string[];
  cached?: boolean;
  retryable?: boolean;
}

export interface WorkspaceGitState {
  head: string;
  clean: boolean;
  dependencyStamp: string;
}

export interface WorkspacePackage {
  root: string;
  name: string;
  dependencies: string[];
}

interface PackageManifest {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
}

interface TestPlan {
  workspaces?: string[];
  error?: WorkspaceScriptResult;
}

interface GitChangedFiles {
  files: string[];
  baselineKnown: boolean;
}

const ANSI_CSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function stripAnsi(text: string): string {
  return text.replace(ANSI_CSI, "");
}

export async function runWorkspaceNpmScript(
  workspaceRoot: string | undefined,
  script: WorkspaceScriptName,
  timeoutMs = script === "test" ? 600_000 : 30_000,
): Promise<WorkspaceScriptResult> {
  if (!workspaceRoot) return { ran: false, ok: true, output: "" };
  let manifest: PackageManifest;
  try {
    manifest = await readPackageManifest(join(workspaceRoot, "package.json"));
  } catch (error) {
    if (isMissingFile(error)) return { ran: false, ok: true, output: "" };
    return packageManifestFailure(workspaceRoot, script, error);
  }
  const scripts = manifest.scripts;
  if (!scripts?.[script]?.trim()) return { ran: false, ok: true, output: "" };
  let cwd = workspaceRoot;
  if (script === "test") {
    const plan = await scopedTestPlan(workspaceRoot);
    if (plan.error) return plan.error;
    if (plan.workspaces) {
      if (!plan.workspaces.length) return { ran: false, ok: true, output: "" };
      if (plan.workspaces.length > 1)
        return runScopedWorkspaceTests(workspaceRoot, plan.workspaces, timeoutMs);
      cwd = plan.workspaces[0]!;
    }
  }
  const result = await runNpm(cwd, script, timeoutMs);
  return { ...result, cwd, command: `npm run ${script}` };
}

/** ESLint exploding because node_modules is missing is not a lint finding. */
export function lintOutputLooksLikeMissingDeps(output: string): boolean {
  return outputLooksLikeMissingDeps(output);
}

export function outputLooksLikeMissingDeps(output: string): boolean {
  return /ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module|spawn (?:npm|node) ENOENT/i.test(
    output,
  );
}

export function collectNpmFailLines(output: string): string[] {
  return (
    stripAnsi(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      // Vitest prefixes failed test records with `FAIL  <path>`. Do not treat
      // reviewer verdicts, passing test names, or assertion text containing the
      // word FAIL as a failed test.
      .filter((line) => /^FAIL\s+\S/.test(line) || /^Failed Tests\b/.test(line))
  );
}

/** Preserve the legacy single-workspace helper for callers that need one cwd. */
export function testCwdFromChangedFiles(
  workspaceRoot: string,
  files: string[],
): string | undefined {
  const workspaces = testWorkspacesFromChangedFiles(workspaceRoot, files);
  return workspaces?.length === 1 ? workspaces[0] : undefined;
}

/**
 * Return affected workspace roots for package-scoped tests.
 *
 * `undefined` means the change is repository-wide (or cannot be classified
 * safely), while an empty array means the changes are documentation or
 * harness bookkeeping only and do not need a package test run.
 */
export function testWorkspacesFromChangedFiles(
  workspaceRoot: string,
  files: string[],
): string[] | undefined {
  const meaningful = files
    .map((file) => file.replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter((file) => !isNonTestPath(file));
  if (!meaningful.length) return [];

  const pkgs = new Set<string>();
  for (const norm of meaningful) {
    if (isRepositoryWideTestPath(norm)) return undefined;
    const match = norm.match(/^(apps|packages)\/[^/]+/);
    if (!match) return undefined;
    pkgs.add(match[0]);
  }
  return [...pkgs].map((pkg) => join(workspaceRoot, pkg));
}

/** Pull FAIL lines out of a truncated `npm test` dump so the next model round can see them. */
export function summarizeNpmTestFailure(output: string, maxChars = 12_000): string {
  const clean = stripAnsi(output);
  const allFails = collectNpmFailLines(clean);
  const fails = allFails.slice(0, 20);
  const bodySource = allFails.length
    ? clean
        .split(/\r?\n/)
        .filter((line) => !allFails.includes(line.trim()))
        .join("\n")
        .trim()
    : clean;
  const body = clipScriptOutput(bodySource, maxChars);
  if (!fails.length) return body;
  return `Failed tests:\n${fails.join("\n")}\n\n${body}`;
}

export function formatNpmTestGateFailure(toolName: string, result: WorkspaceScriptResult): string {
  const kind = result.failureKind ?? "script-failure";
  const headline = kind === "test-failure" ? "tests failed" : "validation is unavailable";
  const retryable = result.retryable ?? (kind === "missing-dependencies" || kind === "runner");
  const lines = [
    `Harness blocked ${toolName}: ${headline}.`,
    `Reason: ${kind}.`,
    `Retryable: ${retryable ? "yes" : "no"}.`,
    result.cwd ? `Workspace: ${result.cwd}` : undefined,
    result.command ? `Command: ${result.command}` : undefined,
    typeof result.exitCode === "number" ? `Exit code: ${result.exitCode}.` : undefined,
    result.cached ? "Validation result: reused for the same clean commit." : undefined,
    result.failedTests?.length ? `Failed test count: ${result.failedTests.length}.` : undefined,
  ].filter((line): line is string => Boolean(line));
  const next =
    kind === "missing-dependencies"
      ? "Next: install workspace dependencies, then retry the publish operation."
      : kind === "runner"
        ? "Next: inspect the runner error; local sandbox limits may not represent the host gate."
        : kind === "timeout"
          ? "Next: inspect the test log and rerun the focused workspace test."
          : "Next: fix the reported failures or compare them with the base-branch baseline.";
  return `${lines.join("\n")}\n${next}\n\n${summarizeNpmTestFailure(result.output)}`;
}

export async function workspaceGitState(
  root: string | undefined,
): Promise<WorkspaceGitState | undefined> {
  if (!root) return undefined;
  const head = await gitText(root, ["rev-parse", "HEAD"]);
  if (!head) return undefined;
  const status = await gitText(root, ["status", "--porcelain"]);
  const meaningfulStatus = status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !isHarnessBookkeepingPath(line));
  return {
    head,
    clean: meaningfulStatus.length === 0,
    dependencyStamp: await workspaceDependencyStamp(root),
  };
}

export async function workspaceReadinessNote(
  root: string | undefined,
): Promise<string | undefined> {
  if (!root || existsSync(join(root, "node_modules"))) return undefined;
  try {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    if (!pkg.scripts?.test?.trim() && !pkg.scripts?.lint?.trim()) return undefined;
  } catch {
    return undefined;
  }
  return "Workspace preflight: node_modules is missing. Install dependencies before relying on local lint/test commands; the host publish gate will validate the workspace separately.";
}

async function scopedTestPlan(workspaceRoot: string): Promise<TestPlan> {
  const changes = await gitChangedFiles(workspaceRoot);
  if (!changes.baselineKnown) return {};
  if (!changes.files.length) return {};
  const directWorkspaces = testWorkspacesFromChangedFiles(workspaceRoot, changes.files);
  if (directWorkspaces === undefined) return {};
  if (!directWorkspaces.length) return { workspaces: [] };
  const workspaces = await loadAffectedWorkspaceRoots(workspaceRoot, directWorkspaces);
  if (workspaces === undefined) return {};
  const withTests: string[] = [];
  for (const cwd of workspaces) {
    try {
      const pkg = await readPackageManifest(join(cwd, "package.json"));
      if (pkg.scripts?.test?.trim()) withTests.push(cwd);
    } catch (error) {
      if (isMissingFile(error)) return {};
      return { error: packageManifestFailure(cwd, "test", error) };
    }
  }
  return { workspaces: withTests };
}

/**
 * Expand directly changed workspaces to their transitive dependents.
 * Returning undefined is deliberately fail-closed: an incomplete graph must
 * use the repository-wide test plan instead of silently skipping a consumer.
 */
export function expandAffectedWorkspaceRoots(
  packages: WorkspacePackage[],
  directRoots: string[],
): string[] | undefined {
  const byRoot = new Map(packages.map((pkg) => [pkg.root, pkg]));
  if (directRoots.some((root) => !byRoot.has(root))) return undefined;

  const affectedRoots = new Set(directRoots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const pkg of packages) {
      if (affectedRoots.has(pkg.root)) continue;
      const dependsOnAffected = pkg.dependencies.some((dependency) =>
        packages.some(
          (candidate) => affectedRoots.has(candidate.root) && candidate.name === dependency,
        ),
      );
      if (dependsOnAffected) {
        affectedRoots.add(pkg.root);
        changed = true;
      }
    }
  }

  return packages.filter((pkg) => affectedRoots.has(pkg.root)).map((pkg) => pkg.root);
}

async function loadAffectedWorkspaceRoots(
  workspaceRoot: string,
  directRoots: string[],
): Promise<string[] | undefined> {
  const packages = await loadWorkspacePackages(workspaceRoot);
  if (!packages) return undefined;
  return expandAffectedWorkspaceRoots(packages, directRoots);
}

async function loadWorkspacePackages(
  workspaceRoot: string,
): Promise<WorkspacePackage[] | undefined> {
  const packages: WorkspacePackage[] = [];
  for (const group of ["apps", "packages"]) {
    let entries;
    try {
      entries = await readdir(join(workspaceRoot, group), { withFileTypes: true });
    } catch (error) {
      if (isMissingFile(error)) continue;
      return undefined;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const root = join(workspaceRoot, group, entry.name);
      let manifest: PackageManifest;
      try {
        manifest = await readPackageManifest(join(root, "package.json"));
      } catch (error) {
        if (isMissingFile(error)) continue;
        return undefined;
      }
      if (!manifest.name) return undefined;
      packages.push({
        root,
        name: manifest.name,
        dependencies: dependencyNames(manifest),
      });
    }
  }
  const names = new Set<string>();
  for (const pkg of packages) {
    if (names.has(pkg.name)) return undefined;
    names.add(pkg.name);
  }
  return packages;
}

function dependencyNames(manifest: PackageManifest): string[] {
  const names = new Set<string>();
  for (const field of [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ]) {
    if (!field) continue;
    for (const name of Object.keys(field)) names.add(name);
  }
  return [...names];
}

async function readPackageManifest(path: string): Promise<PackageManifest> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw new Error("package.json must contain a JSON object");
  }
  if (parsed.name !== undefined && typeof parsed.name !== "string") {
    throw new Error("package.json name must be a string");
  }
  if (parsed.scripts !== undefined) {
    if (
      !isRecord(parsed.scripts) ||
      Array.isArray(parsed.scripts) ||
      Object.values(parsed.scripts).some((value) => typeof value !== "string")
    ) {
      throw new Error("package.json scripts must be a string map");
    }
  }
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const value = parsed[field];
    if (value !== undefined && (!isRecord(value) || Array.isArray(value))) {
      throw new Error(`package.json ${field} must be an object`);
    }
  }
  return parsed as PackageManifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function packageManifestFailure(
  cwd: string,
  script: WorkspaceScriptName,
  error: unknown,
): WorkspaceScriptResult {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    ran: true,
    ok: false,
    output: `Unable to read ${join(cwd, "package.json")}: ${detail}`,
    cwd,
    command: `npm run ${script}`,
    failureKind: "runner",
    retryable: true,
  };
}

async function runScopedWorkspaceTests(
  workspaceRoot: string,
  workspaces: string[],
  timeoutMs: number,
): Promise<WorkspaceScriptResult> {
  const startedAt = Date.now();
  const results: WorkspaceScriptResult[] = [];
  for (const cwd of workspaces) {
    const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
    const result = await runNpm(cwd, "test", remaining);
    results.push({ ...result, cwd, command: "npm run test" });
  }
  if (!results.length) return { ran: false, ok: true, output: "" };

  const failures = results.filter((result) => !result.ok);
  const exitCode = failures.find((result) => result.exitCode !== undefined)?.exitCode;
  const output = clipScriptOutput(
    results
      .map((result) => {
        const label = relative(workspaceRoot, result.cwd ?? workspaceRoot) || ".";
        return `=== ${label} ===\n${result.output}`;
      })
      .join("\n\n"),
    24_000,
  );
  const failureKind = aggregateFailureKind(failures);
  return {
    ran: true,
    ok: failures.length === 0,
    output,
    cwd: workspaceRoot,
    command: "npm run test (affected workspaces)",
    durationMs: Date.now() - startedAt,
    ...(failures.length
      ? {
          failureKind,
          ...(exitCode !== undefined ? { exitCode } : {}),
          failedTests: [...new Set(failures.flatMap((result) => result.failedTests ?? []))].slice(
            0,
            20,
          ),
        }
      : {}),
  };
}

function isNonTestPath(path: string): boolean {
  return (
    path === ".locus-attachments" ||
    path.startsWith(".locus-attachments/") ||
    /(?:^|\/)README\.md$/i.test(path) ||
    path.startsWith("docs/")
  );
}

function isRepositoryWideTestPath(path: string): boolean {
  if (!path.includes("/")) return true;
  return /^(?:apps|packages)\/[^/]+\/(?:package(?:-lock)?\.json|npm-shrinkwrap\.json)$/i.test(path);
}

function aggregateFailureKind(results: WorkspaceScriptResult[]): WorkspaceScriptFailureKind {
  if (results.some((result) => result.failureKind === "timeout")) return "timeout";
  if (results.some((result) => result.failureKind === "missing-dependencies"))
    return "missing-dependencies";
  if (results.some((result) => result.failureKind === "runner")) return "runner";
  return "test-failure";
}

async function gitChangedFiles(root: string): Promise<GitChangedFiles> {
  const files = new Set<string>();
  const add = (stdout: string) => {
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }
  };
  await gitNames(root, ["diff", "--name-only", "HEAD"], add);
  await gitNames(root, ["diff", "--name-only", "--cached"], add);
  await gitNames(root, ["ls-files", "--others", "--exclude-standard"], add);
  let baselineKnown = false;
  for (const base of ["main", "master", "origin/main", "origin/master"]) {
    const ok = await gitNames(root, ["diff", "--name-only", `${base}...HEAD`], add);
    if (ok) {
      baselineKnown = true;
      break;
    }
  }
  return { files: [...files], baselineKnown };
}

async function gitNames(
  root: string,
  args: string[],
  add: (stdout: string) => void,
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
      timeout: 5000,
      windowsHide: true,
    });
    add(stdout);
    return true;
  } catch {
    return false;
  }
}

async function gitText(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
      timeout: 5000,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

function isHarnessBookkeepingPath(statusLine: string): boolean {
  const path = statusLine.slice(3).trim().replace(/^"|"$/g, "").replace(/\\/g, "/");
  return path === ".locus-attachments" || path.startsWith(".locus-attachments/");
}

async function workspaceDependencyStamp(root: string): Promise<string> {
  for (const rel of [join("node_modules", ".package-lock.json"), "node_modules"]) {
    try {
      const info = await stat(join(root, rel));
      return `${rel}:${info.mtimeMs}:${info.size}`;
    } catch {
      /* try the next dependency marker */
    }
  }
  return "missing";
}

function runNpm(
  cwd: string,
  script: WorkspaceScriptName,
  timeoutMs: number,
): Promise<WorkspaceScriptResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let timedOut = false;
    const env = { ...process.env, npm_config_loglevel: "error" };
    const target = resolveWindowsCliSpawn("npm", ["run", script], { env });
    const child = spawn(target.command, target.args, {
      cwd,
      env: { ...env, ...target.envPatch },
      windowsVerbatimArguments: target.windowsVerbatimArguments,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 24_000) output = clipScriptOutput(output, 24_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = err.message;
      resolve({
        ran: true,
        ok: false,
        output,
        durationMs: Date.now() - startedAt,
        failureKind: classifyScriptFailure(script, output, undefined, false),
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const uniqueFails = [...new Set(collectNpmFailLines(output))].slice(0, 20);
      const body = stripAnsi(output).trim() || `(npm run ${script} exited ${code ?? "null"})`;
      const ok = code === 0 && !timedOut;
      resolve({
        ran: true,
        ok,
        output: body,
        ...(typeof code === "number" ? { exitCode: code } : {}),
        durationMs: Date.now() - startedAt,
        ...(ok
          ? {}
          : {
              failureKind: classifyScriptFailure(script, body, code ?? undefined, timedOut),
              ...(uniqueFails.length ? { failedTests: uniqueFails } : {}),
            }),
      });
    });
  });
}

function classifyScriptFailure(
  script: WorkspaceScriptName,
  output: string,
  exitCode: number | undefined,
  timedOut: boolean,
): WorkspaceScriptFailureKind {
  if (timedOut) return "timeout";
  if (outputLooksLikeMissingDeps(output)) return "missing-dependencies";
  if (exitCode == null) return "runner";
  if (script === "test" && exitCode !== 0) return "test-failure";
  return "script-failure";
}

function clipScriptOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  const head = Math.floor(maxChars / 2);
  const tail = maxChars - head;
  return `${output.slice(0, head)}\n... [output clipped] ...\n${output.slice(-tail)}`;
}

export async function loadRepoHooks(workspaceRoot: string | undefined): Promise<RepoHooks> {
  if (!workspaceRoot) return parseRepoHooks(undefined);
  try {
    const raw = JSON.parse(await readFile(join(workspaceRoot, ".locus", "hooks.json"), "utf8"));
    return parseRepoHooks(raw);
  } catch {
    return parseRepoHooks(undefined);
  }
}

export async function runRepoHook(
  workspaceRoot: string | undefined,
  hook: RepoHook,
  timeoutMs = hook.event === "PreToolUse" ? 30_000 : 15_000,
): Promise<WorkspaceScriptResult> {
  if (!workspaceRoot) return { ran: false, ok: true, output: "" };
  return runShell(workspaceRoot, hook.command, timeoutMs);
}

const HOOK_ENV_KEEP =
  /^(PATH|HOME|USER|LOGNAME|LANG|LANGUAGE|LC_.*|TERM|TMPDIR|TMP|TEMP|PWD|SHELL|NODE_ENV|CI|npm_config_loglevel)$/;

function hookEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { npm_config_loglevel: "error" };
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || !HOOK_ENV_KEEP.test(key)) continue;
    out[key] = value;
  }
  return hostExecEnv(process.platform, out, posixShellPath());
}

function runShell(cwd: string, command: string, timeoutMs: number): Promise<WorkspaceScriptResult> {
  return new Promise((resolve) => {
    const child = spawn(posixShellPath(), ["-lc", command], {
      cwd,
      env: hookEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 24_000) output = output.slice(-16_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ran: true, ok: false, output: hostSpawnErrorOutput(err, posixShellPath(), cwd) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const body = stripAnsi(output).trim() || `(hook exited ${code ?? "null"})`;
      resolve({ ran: true, ok: code === 0, output: body });
    });
  });
}
