/**
 * Run the built-in benchmark cases as real Host agent turns against chosen models.
 *
 * Each case gets a fresh folder under `<tmp>/locus-benchmarks/<runId>/`, an autonomous Host
 * session on that folder, and the case prompt. When the turn ends (or hits the time limit)
 * we run `npm test` ourselves, check the test files were not edited, and record tokens,
 * estimated cost and wall time. Sessions are archived, not deleted, so a failure can be
 * opened and read. Runs are saved as `<dataDir>/benchmarks/<runId>.json`.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  BENCHMARK_CASES,
  benchmarkCase,
  estimateUsd,
  isSessionWorking,
  resolveUsageRates,
  scoreBenchmarkCase,
  type AgentSession,
  type BenchmarkCaseResult,
  type BenchmarkRun,
  type BenchmarkTarget,
  type CreateSessionInput,
} from "@locus/shared";
import { runWorkspaceNpmScript } from "../core/hooks.js";
import type { JsonStore } from "../core/store.js";

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
  /** Per case. Default 10 minutes. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_REPEAT = 5;
const POLL_MS = 500;

export class BenchmarkService {
  private active?: { run: BenchmarkRun; cancelled: boolean; sessionId?: string };
  private readonly dir: string;
  private readonly workRoot: string;

  constructor(
    private readonly store: JsonStore,
    private readonly sessions: BenchmarkSessions,
    private readonly opts: {
      pollMs?: number;
      runTests?: (root: string) => Promise<{ ran: boolean; ok: boolean; output: string }>;
      now?: () => number;
      /** Case folders. Host agents may not work inside the data dir, so default to tmp. */
      workRoot?: string;
    } = {},
  ) {
    this.dir = join(store.dataDir, "benchmarks");
    this.workRoot = opts.workRoot ?? join(tmpdir(), "locus-benchmarks");
  }

  cases() {
    return BENCHMARK_CASES.map(({ id, title, prompt }) => ({ id, title, prompt }));
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
    const caseIds = input.caseIds?.length ? input.caseIds : BENCHMARK_CASES.map((c) => c.id);
    for (const id of caseIds) if (!benchmarkCase(id)) throw new Error(`Unknown case: ${id}`);
    const repeat = Math.max(1, Math.min(MAX_REPEAT, Math.floor(input.repeat ?? 1)));
    const run: BenchmarkRun = {
      id: `bench-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomUUID().slice(0, 6)}`,
      createdAt: new Date().toISOString(),
      status: "running",
      targets,
      caseIds,
      repeat,
      results: [],
    };
    for (const target of targets) {
      for (let attempt = 1; attempt <= repeat; attempt += 1) {
        for (const caseId of caseIds)
          run.results.push({ caseId, target, attempt, status: "pending" });
      }
    }
    await this.save(run);
    this.active = { run, cancelled: false };
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
    for (let i = 0; i < run.results.length; i += 1) {
      const row = run.results[i]!;
      if (active.cancelled) break;
      row.status = "running";
      row.startedAt = new Date().toISOString();
      await this.save(run);
      Object.assign(
        row,
        await this.runCase(row, join(this.workRoot, run.id, `${i + 1}-${row.caseId}`), timeoutMs),
      );
      await this.save(run);
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

  private async runCase(
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
    const config = await this.store.loadConfig();
    const template = config.templates[0];
    if (!template) return { status: "error", reason: "No machine template configured" };
    let session: AgentSession;
    try {
      session = await this.sessions.create({
        title: `Benchmark · ${spec.id} · ${row.target.model}`,
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
      return { status: "error", reason: err instanceof Error ? err.message : String(err) };
    }
    this.active!.sessionId = session.id;
    let timedOut = false;
    let turnError: string | undefined;
    try {
      await this.sessions.sendChat(session.id, spec.prompt);
      timedOut = !(await this.waitForTurn(session.id, started, timeoutMs));
      if (timedOut) await this.sessions.abortChat(session.id).catch(() => undefined);
    } catch (err) {
      turnError = err instanceof Error ? err.message : String(err);
    }
    this.active!.sessionId = undefined;
    const fresh = (await this.sessions.get(session.id)) ?? session;
    if (!turnError && fresh.status === "error" && fresh.error) turnError = fresh.error;

    const edited: string[] = [];
    for (const rel of spec.protectedFiles) {
      const now = await readFile(join(root, ...rel.split("/")), "utf8").catch(() => "");
      if (now !== spec.files[rel]) edited.push(rel);
    }
    const tests = await (
      this.opts.runTests ?? ((dir) => runWorkspaceNpmScript(dir, "test", 120_000))
    )(root);
    const score = scoreBenchmarkCase({
      testsRan: tests.ran,
      testsOk: tests.ok,
      editedProtected: edited,
      timedOut,
      error: turnError && !tests.ok ? turnError : undefined,
    });
    const provider = config.providers.find((p) => p.id === row.target.providerId);
    const usage = fresh.usage;
    const usd = usage
      ? estimateUsd(usage, resolveUsageRates(provider, row.target.model))
      : undefined;
    await this.sessions.patchMeta(session.id, { archived: true }).catch(() => undefined);
    return {
      status: score.status,
      reason:
        fresh.needsHuman && score.status !== "passed"
          ? `${score.reason}; needs you: ${fresh.needsHuman}`
          : score.reason,
      sessionId: session.id,
      durationMs: now() - started,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      usd,
      toolCalls: fresh.messages.reduce((n, m) => n + (m.toolCalls?.length ?? 0), 0),
      testOutput: tests.output.slice(-2000),
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
}
