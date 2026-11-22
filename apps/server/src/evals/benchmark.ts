/**
 * Run benchmark cases as real Host agent turns against chosen models.
 *
 * Two kinds of case share one runner:
 * - Built-in toy cases (`BENCHMARK_CASES`): files written to a fresh folder; after the turn we
 *   run `npm test` and check the test files were not edited.
 * - Spec cases (repo-derived, see `BenchmarkCaseSpec`): `baseCommit`'s tree is exported into a
 *   fresh folder with no history, `setup` runs, the agent gets the issue text. At scoring time
 *   the fix commit's versions of `protectedPaths` (the hidden tests) are copied in and
 *   `testCommand` runs; fail-to-pass / pass-to-pass decide. A case whose toolchain is missing
 *   here is `skipped`. The built-in fixture suite (TS / Python / Go) runs with the toy cases
 *   unless a `suite` path is given.
 *
 * Each case gets an autonomous Host session (archived afterwards so a failure can be opened).
 * Runs record tokens, estimated cost, wall time, tool calls and a harness version, and are
 * saved as `<dataDir>/benchmarks/<runId>.json`. Mining jobs (`mine`) live in memory.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  BENCHMARK_CASES,
  BENCHMARK_SPEC_DEFAULT_TIMEOUT_SEC,
  aggregateBenchmarkHistory,
  benchmarkCase,
  benchmarkSpecPrompt,
  compareBenchmarkRuns,
  estimateUsd,
  isSessionWorking,
  parseTestResults,
  resolveUsageRates,
  scoreBenchmarkCase,
  scoreSpecCase,
  type AgentSession,
  type BenchmarkCaseResult,
  type BenchmarkCaseSpec,
  type BenchmarkComparison,
  type BenchmarkHistoryRow,
  type BenchmarkRun,
  type BenchmarkTarget,
  type CreateSessionInput,
} from "@locus/shared";
import { runWorkspaceVerify } from "../core/verify.js";
import type { JsonStore } from "../core/store.js";
import {
  exportCommit,
  gitShowFile,
  initSnapshotRepo,
  missingToolchain,
  readMaybe,
  resolveCaseRepo,
  resolveCommit,
  runShell,
  type ShellResult,
} from "./benchmarkRepo.js";
import { mineBenchmarkCases, type MineOptions, type MineResult } from "./benchmarkMiner.js";
import {
  benchmarkHarness,
  builtinSuiteDir,
  loadBenchmarkSuite,
  type LoadedBenchmarkSpec,
} from "./benchmarkSuite.js";

/** The slice of SessionService the runner drives. */
export interface BenchmarkSessions {
  create(input: CreateSessionInput): Promise<AgentSession>;
  sendChat(id: string, content: string): Promise<unknown>;
  get(id: string): Promise<AgentSession | undefined>;
  abortChat(id: string): Promise<void>;
  patchMeta(id: string, patch: { archived?: boolean }): Promise<AgentSession>;
}

export interface StartBenchmarkInput {
  targets: BenchmarkTarget[];
  caseIds?: string[];
  repeat?: number;
  /** Per case. Default 10 minutes; a spec's `timeoutSec` wins for that case. */
  timeoutMs?: number;
  /** Suite folder, spec file or repo (its `.locus/benchmarks/`). Default: the built-in suite. */
  suite?: string;
}

export interface BenchmarkCaseInfo {
  id: string;
  title: string;
  prompt: string;
  kind: "toy" | "spec";
  language?: string;
  repo?: string;
}

export interface StartMineInput {
  repo: string;
  since?: string;
  limit?: number;
  maxCommits?: number;
  requireIssue?: boolean;
  ref?: string;
  testCommand?: string;
  setup?: string | null;
  /** Folder for the drafted specs. Default `<repo>/.locus/benchmarks`. */
  out?: string;
  /** Verify and report only. */
  dryRun?: boolean;
}

export interface MineJob {
  id: string;
  status: "running" | "done" | "error" | "cancelled";
  repo: string;
  startedAt: string;
  finishedAt?: string;
  progress: string[];
  result?: MineResult;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_REPEAT = 5;
const POLL_MS = 500;
const SETUP_TIMEOUT_MS = 15 * 60 * 1000;
const SPEC_TEST_TIMEOUT_MS = 10 * 60 * 1000;

type TestRunner = (root: string) => Promise<{ ran: boolean; ok: boolean; output: string }>;

export class BenchmarkService {
  private active?: {
    run: BenchmarkRun;
    cancelled: boolean;
    sessionId?: string;
    specs: Map<string, LoadedBenchmarkSpec>;
  };
  private readonly dir: string;
  private readonly workRoot: string;
  private readonly repoRoot: string;
  private readonly mines = new Map<string, { job: MineJob; signal: { cancelled: boolean } }>();

  constructor(
    private readonly store: JsonStore,
    private readonly sessions: BenchmarkSessions,
    private readonly opts: {
      pollMs?: number;
      /** Toy cases: run `npm test`. */
      runTests?: TestRunner;
      /** Spec cases: run a shell command (setup and testCommand). */
      runCommand?: (command: string, cwd: string, timeoutMs: number) => Promise<ShellResult>;
      now?: () => number;
      /** Case folders. Host agents may not work inside the data dir, so default to tmp. */
      workRoot?: string;
      /** Fixture builds and clones for spec cases; kept apart from the agent's folder. */
      repoRoot?: string;
      /** Built-in spec suite. Default `apps/server/fixtures/benchmark` when present. */
      builtinSuite?: string | null;
      /** Missing binary for a language, or undefined when it can run here. */
      missingToolchain?: (language: BenchmarkCaseSpec["language"]) => string | undefined;
    } = {},
  ) {
    this.dir = join(store.dataDir, "benchmarks");
    this.workRoot = opts.workRoot ?? join(tmpdir(), "locus-benchmarks");
    this.repoRoot = opts.repoRoot ?? join(tmpdir(), "locus-benchmark-repos");
  }

  private async specSuite(suite?: string) {
    const builtin =
      this.opts.builtinSuite === null ? undefined : (this.opts.builtinSuite ?? builtinSuiteDir());
    const path = suite ?? builtin;
    if (!path)
      return { root: undefined, cases: [] as LoadedBenchmarkSpec[], errors: [] as string[] };
    return loadBenchmarkSuite(path);
  }

  /** Toy cases plus the spec suite (`suite` replaces the built-in fixtures). */
  async cases(suite?: string): Promise<{ cases: BenchmarkCaseInfo[]; errors: string[] }> {
    const loaded = await this.specSuite(suite);
    const specs: BenchmarkCaseInfo[] = loaded.cases.map(({ spec }) => ({
      id: spec.id,
      title: spec.title ?? spec.prompt.split("\n")[0]!.slice(0, 120),
      prompt: spec.prompt,
      kind: "spec",
      language: spec.language,
      repo: spec.repo,
    }));
    const toys: BenchmarkCaseInfo[] = suite
      ? []
      : BENCHMARK_CASES.map(({ id, title, prompt }) => ({ id, title, prompt, kind: "toy" }));
    return { cases: [...toys, ...specs], errors: loaded.errors };
  }

  private path(id: string): string {
    return join(this.dir, `${id.replace(/[^a-zA-Z0-9-]/g, "")}.json`);
  }

  private async save(run: BenchmarkRun): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(this.path(run.id), `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
  }

  async get(id: string): Promise<BenchmarkRun | undefined> {
    if (this.active?.run.id === id) return this.active.run;
    try {
      const run = JSON.parse(await readFile(this.path(id), "utf8")) as BenchmarkRun;
      // A run still marked running on disk was interrupted by a restart.
      if (run.status === "running") return { ...run, status: "error", error: "Interrupted" };
      return run;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<BenchmarkRun[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch {
      return this.active ? [this.active.run] : [];
    }
    const runs = await Promise.all(
      names.filter((n) => n.endsWith(".json")).map((n) => this.get(n.slice(0, -5))),
    );
    return runs
      .filter((r): r is BenchmarkRun => Boolean(r))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Pass rate / cost / time per (provider, model, harness version) across saved runs. */
  async history(): Promise<BenchmarkHistoryRow[]> {
    return aggregateBenchmarkHistory(await this.list());
  }

  /** Cases that flipped between run `a` (before) and run `b` (after). */
  async compare(a: string, b: string): Promise<BenchmarkComparison> {
    const [ra, rb] = await Promise.all([this.get(a), this.get(b)]);
    if (!ra) throw new Error(`Run not found: ${a}`);
    if (!rb) throw new Error(`Run not found: ${b}`);
    return compareBenchmarkRuns(ra, rb);
  }

  async start(input: StartBenchmarkInput): Promise<BenchmarkRun> {
    if (this.active) throw new Error("A benchmark is already running.");
    const targets = (input.targets ?? []).filter((t) => t?.providerId && t?.model);
    if (!targets.length) throw new Error("Pick at least one provider and model.");
    const config = await this.store.loadConfig();
    for (const target of targets) {
      const provider = config.providers.find((p) => p.id === target.providerId);
      if (!provider) throw new Error(`Unknown provider: ${target.providerId}`);
      if (!provider.enabled)
        throw new Error(`${provider.name} is not enabled in Settings → Providers.`);
    }
    const suite = input.suite?.trim() ? resolve(input.suite.trim()) : undefined;
    const loaded = await this.specSuite(suite);
    if (suite && !loaded.cases.length) {
      throw new Error(
        `No valid cases in ${suite}${loaded.errors.length ? `: ${loaded.errors.slice(0, 3).join("; ")}` : ""}`,
      );
    }
    const specs = new Map(loaded.cases.map((row) => [row.spec.id, row]));
    const toyIds = suite ? [] : BENCHMARK_CASES.map((c) => c.id);
    const caseIds = input.caseIds?.length ? input.caseIds : [...toyIds, ...specs.keys()];
    for (const id of caseIds) {
      if (!specs.has(id) && !(toyIds.includes(id) && benchmarkCase(id))) {
        throw new Error(`Unknown case: ${id}`);
      }
    }
    const repeat = Math.max(1, Math.min(MAX_REPEAT, Math.floor(input.repeat ?? 1)));
    const harness = benchmarkHarness();
    const run: BenchmarkRun = {
      id: `bench-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomUUID().slice(0, 6)}`,
      createdAt: new Date().toISOString(),
      status: "running",
      targets,
      caseIds,
      repeat,
      results: [],
      harness,
      ...(suite ? { suite } : {}),
    };
    for (const target of targets) {
      for (let attempt = 1; attempt <= repeat; attempt += 1) {
        for (const caseId of caseIds)
          run.results.push({
            caseId,
            target,
            attempt,
            status: "pending",
            harnessVersion: harness.key,
          });
      }
    }
    await this.save(run);
    this.active = { run, cancelled: false, specs };
    void this.execute(input.timeoutMs ?? DEFAULT_TIMEOUT_MS).catch(async (err) => {
      run.status = "error";
      run.error = err instanceof Error ? err.message : String(err);
      run.finishedAt = new Date().toISOString();
      await this.save(run).catch(() => undefined);
      this.active = undefined;
    });
    return run;
  }

  async cancel(id: string): Promise<BenchmarkRun | undefined> {
    const active = this.active;
    if (!active || active.run.id !== id) return this.get(id);
    active.cancelled = true;
    if (active.sessionId) await this.sessions.abortChat(active.sessionId).catch(() => undefined);
    return active.run;
  }

  /** Resolves when the active run (if any) has finished. For tests and the CLI's --wait. */
  async idle(): Promise<void> {
    while (this.active) await new Promise((r) => setTimeout(r, this.opts.pollMs ?? POLL_MS));
  }

  private async execute(timeoutMs: number): Promise<void> {
    const active = this.active!;
    const { run } = active;
    const repoCache = join(this.repoRoot, run.id);
    try {
      for (let i = 0; i < run.results.length; i += 1) {
        const row = run.results[i]!;
        if (active.cancelled) break;
        row.status = "running";
        row.startedAt = new Date().toISOString();
        await this.save(run);
        const root = join(this.workRoot, run.id, `${i + 1}-${row.caseId}`);
        const spec = active.specs.get(row.caseId);
        Object.assign(
          row,
          spec
            ? await this.runSpecCase(row, spec, root, repoCache, timeoutMs)
            : await this.runToyCase(row, root, timeoutMs),
        );
        await this.save(run);
      }
    } finally {
      await rm(repoCache, { recursive: true, force: true }).catch(() => undefined);
    }
    for (const row of run.results) {
      if (row.status === "pending" || row.status === "running") {
        row.status = "error";
        row.reason = "cancelled";
      }
    }
    run.status = active.cancelled ? "cancelled" : "done";
    run.finishedAt = new Date().toISOString();
    await this.save(run);
    this.active = undefined;
  }

  /** Start an autonomous Host session on `root`, send the prompt, wait for the turn. */
  private async driveAgent(
    row: BenchmarkCaseResult,
    root: string,
    prompt: string,
    title: string,
    timeoutMs: number,
    started: number,
  ) {
    const config = await this.store.loadConfig();
    const template = config.templates[0];
    if (!template) return { error: "No machine template configured" } as const;
    let session: AgentSession;
    try {
      session = await this.sessions.create({
        title: `Benchmark · ${title} · ${row.target.model}`,
        os: template.os,
        templateId: template.id,
        runtime: "host",
        hostDir: root,
        providerId: row.target.providerId,
        model: row.target.model,
        autonomy: "autonomous",
        startVm: false,
        maxMs: timeoutMs,
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) } as const;
    }
    this.active!.sessionId = session.id;
    let timedOut = false;
    let turnError: string | undefined;
    try {
      await this.sessions.sendChat(session.id, prompt);
      timedOut = !(await this.waitForTurn(session.id, started, timeoutMs));
      if (timedOut) await this.sessions.abortChat(session.id).catch(() => undefined);
    } catch (err) {
      turnError = err instanceof Error ? err.message : String(err);
    }
    this.active!.sessionId = undefined;
    const fresh = (await this.sessions.get(session.id)) ?? session;
    if (!turnError && fresh.status === "error" && fresh.error) turnError = fresh.error;
    const provider = config.providers.find((p) => p.id === row.target.providerId);
    const usage = fresh.usage;
    const usd = usage
      ? estimateUsd(usage, resolveUsageRates(provider, row.target.model))
      : undefined;
    await this.sessions.patchMeta(session.id, { archived: true }).catch(() => undefined);
    return {
      sessionId: session.id,
      session: fresh,
      timedOut,
      turnError,
      metrics: {
        sessionId: session.id,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        usd,
        toolCalls: fresh.messages.reduce((n, m) => n + (m.toolCalls?.length ?? 0), 0),
      } satisfies Partial<BenchmarkCaseResult>,
    } as const;
  }

  private async runToyCase(
    row: BenchmarkCaseResult,
    root: string,
    timeoutMs: number,
  ): Promise<Partial<BenchmarkCaseResult>> {
    const spec = benchmarkCase(row.caseId)!;
    const now = this.opts.now ?? Date.now;
    const started = now();
    for (const [rel, body] of Object.entries(spec.files)) {
      const abs = join(root, ...rel.split("/"));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, body);
    }
    const agent = await this.driveAgent(row, root, spec.prompt, spec.id, timeoutMs, started);
    if ("error" in agent) return { status: "error", reason: agent.error };
    const { session: fresh, timedOut, turnError } = agent;

    const edited: string[] = [];
    for (const rel of spec.protectedFiles) {
      const now = await readFile(join(root, ...rel.split("/")), "utf8").catch(() => "");
      if (now !== spec.files[rel]) edited.push(rel);
    }
    const tests = await (
      this.opts.runTests ?? ((dir) => runWorkspaceVerify(dir, "test", { timeoutMs: 120_000 }))
    )(root);
    const score = scoreBenchmarkCase({
      testsRan: tests.ran,
      testsOk: tests.ok,
      editedProtected: edited,
      timedOut,
      error: turnError && !tests.ok ? turnError : undefined,
    });
    return {
      ...agent.metrics,
      status: score.status,
      reason:
        fresh.needsHuman && score.status !== "passed"
          ? `${score.reason}; needs you: ${fresh.needsHuman}`
          : score.reason,
      durationMs: now() - started,
      testOutput: tests.output.slice(-2000),
    };
  }

  private async runSpecCase(
    row: BenchmarkCaseResult,
    loaded: LoadedBenchmarkSpec,
    root: string,
    repoCache: string,
    runTimeoutMs: number,
  ): Promise<Partial<BenchmarkCaseResult>> {
    const { spec, dir } = loaded;
    const now = this.opts.now ?? Date.now;
    const started = now();
    const language = spec.language;
    const missing = (this.opts.missingToolchain ?? missingToolchain)(spec.language);
    if (missing) {
      return { status: "skipped", reason: `toolchain missing: ${missing}`, language };
    }
    const runCommand = this.opts.runCommand ?? runShell;
    let repo: string;
    let fix: string | undefined;
    const before = new Map<string, Buffer | undefined>();
    try {
      repo = await resolveCaseRepo(spec, dir, repoCache);
      const base = await resolveCommit(repo, spec.baseCommit);
      fix = spec.fixCommit ? await resolveCommit(repo, spec.fixCommit) : undefined;
      await rm(root, { recursive: true, force: true });
      await exportCommit(repo, base, root);
      await initSnapshotRepo(root, `Base (${spec.id})`);
      for (const rel of spec.protectedPaths) {
        before.set(rel, await readMaybe(join(root, ...rel.split("/"))));
      }
    } catch (err) {
      return {
        status: "error",
        reason: `checkout failed: ${err instanceof Error ? err.message : String(err)}`,
        language,
      };
    }
    if (spec.setup) {
      const setup = await runCommand(spec.setup, root, SETUP_TIMEOUT_MS);
      if (!setup.ok) {
        return {
          status: "error",
          reason: `setup failed${setup.timedOut ? " (timed out)" : ""}: ${spec.setup}`,
          testOutput: setup.output.slice(-2000),
          durationMs: now() - started,
          language,
        };
      }
    }
    const timeoutMs =
      (spec.timeoutSec ?? 0) * 1000 || runTimeoutMs || BENCHMARK_SPEC_DEFAULT_TIMEOUT_SEC * 1000;
    const agent = await this.driveAgent(
      row,
      root,
      benchmarkSpecPrompt(spec),
      spec.id,
      timeoutMs,
      started,
    );
    if ("error" in agent) return { status: "error", reason: agent.error, language };
    const { session: fresh, timedOut, turnError } = agent;

    const edited: string[] = [];
    for (const rel of spec.protectedPaths) {
      const was = before.get(rel);
      const is = await readMaybe(join(root, ...rel.split("/")));
      if ((was === undefined) !== (is === undefined) || (was && is && !was.equals(is))) {
        edited.push(rel);
      }
    }
    // Hidden tests: the fix commit's versions (or, without a fix commit, the base ones).
    for (const rel of spec.protectedPaths) {
      const target = join(root, ...rel.split("/"));
      const body = fix ? await gitShowFile(repo, fix, rel) : before.get(rel);
      if (body === undefined) await rm(target, { force: true });
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, body);
      }
    }
    const tests = await runCommand(spec.testCommand, root, SPEC_TEST_TIMEOUT_MS);
    const score = scoreSpecCase({
      failToPass: spec.failToPass,
      passToPass: spec.passToPass,
      results: parseTestResults(tests.output),
      testsRan: tests.code !== null || tests.timedOut,
      exitOk: tests.ok,
      editedProtected: edited,
      timedOut,
      error: turnError && !tests.ok ? turnError : undefined,
    });
    return {
      ...agent.metrics,
      status: score.status,
      reason:
        fresh.needsHuman && score.status !== "passed"
          ? `${score.reason}; needs you: ${fresh.needsHuman}`
          : score.reason,
      failingTests: score.failingTests.length ? score.failingTests : undefined,
      durationMs: now() - started,
      testOutput: tests.output.slice(-2000),
      language,
    };
  }

  /** True when the turn finished, false on timeout or cancel. */
  private async waitForTurn(id: string, started: number, timeoutMs: number): Promise<boolean> {
    const now = this.opts.now ?? Date.now;
    const pollMs = this.opts.pollMs ?? POLL_MS;
    let sawWork = false;
    for (;;) {
      if (this.active?.cancelled) return false;
      const session = await this.sessions.get(id);
      if (!session) return true;
      const working = isSessionWorking(session.status) || Boolean(session.queue?.length);
      if (working) sawWork = true;
      const replied = session.messages.some((m) => m.role === "assistant");
      if (!working && (sawWork || replied || now() - started > 5_000)) return true;
      if (now() - started > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  // ------------------------------------------------------------------------------------------
  // Case mining

  startMine(input: StartMineInput, overrides: Partial<MineOptions> = {}): MineJob {
    const repo = input.repo?.trim();
    if (!repo) throw new Error("Pass the repo path to mine.");
    const abs = resolve(repo);
    const job: MineJob = {
      id: `mine-${randomUUID().slice(0, 8)}`,
      status: "running",
      repo: abs,
      startedAt: new Date().toISOString(),
      progress: [],
    };
    const signal = { cancelled: false };
    this.mines.set(job.id, { job, signal });
    const outDir = input.dryRun
      ? undefined
      : input.out?.trim()
        ? resolve(input.out.trim())
        : join(abs, ".locus", "benchmarks");
    void mineBenchmarkCases({
      repo: abs,
      since: input.since,
      limit: input.limit,
      maxCommits: input.maxCommits,
      requireIssue: input.requireIssue,
      ref: input.ref,
      testCommand: input.testCommand,
      setup: input.setup,
      outDir,
      run: this.opts.runCommand,
      signal,
      onProgress: (line) => {
        job.progress.push(line);
        if (job.progress.length > 500) job.progress.splice(0, job.progress.length - 500);
      },
      ...overrides,
    })
      .then((result) => {
        job.result = result;
        job.status = signal.cancelled ? "cancelled" : "done";
      })
      .catch((err: unknown) => {
        job.status = "error";
        job.error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
      });
    return job;
  }

  getMine(id: string): MineJob | undefined {
    return this.mines.get(id)?.job;
  }

  cancelMine(id: string): MineJob | undefined {
    const entry = this.mines.get(id);
    if (entry) entry.signal.cancelled = true;
    return entry?.job;
  }
}
