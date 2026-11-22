import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import type { LocusConfig } from "@locus/shared";
import { AuditLog, auditConfigChanges, auditInputFromTrace } from "./auditLog.js";
import { BudgetService } from "./budgets.js";
import { TelemetryExporter } from "./telemetry.js";
import { Hub } from "./hub.js";
import { JsonStore } from "./store.js";
import { SessionService } from "../session/sessions.js";
import { createApp } from "../app.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "locus-controls-"));
  cleanup.push(dir);
  return dir;
}

describe("AuditLog", () => {
  it("appends a chain, rotates daily, and survives a restart", async () => {
    const dir = await tempDir();
    const log = new AuditLog(dir);
    await log.append({
      type: "approval",
      actor: "operator",
      tool: "git_push",
      t: "2026-11-13T23:59:00.000Z",
    });
    await log.append({ type: "git_push", actor: "agent", t: "2026-11-14T00:00:30.000Z" });
    const restarted = new AuditLog(dir);
    const third = await restarted.append({
      type: "policy",
      actor: "operator",
      t: "2026-11-14T01:00:00.000Z",
    });
    expect(third.seq).toBe(3);
    expect(await restarted.listFiles()).toEqual([
      "audit-2026-11-13.jsonl",
      "audit-2026-11-14.jsonl",
    ]);
    const verify = await restarted.verify();
    expect(verify).toMatchObject({ ok: true, records: 3, files: 2 });
    expect((await restarted.read("2026-11-14")).map((r) => r.seq)).toEqual([2, 3]);
    const csv = await restarted.export(undefined, "csv");
    expect(csv.split("\n")).toHaveLength(5);
  });

  it("detects on-disk tampering and reports the first broken record", async () => {
    const dir = await tempDir();
    const log = new AuditLog(dir);
    for (let i = 0; i < 3; i++) {
      await log.append({
        type: "approval",
        actor: "operator",
        decision: "denied",
        t: `2026-11-14T0${i}:00:00.000Z`,
      });
    }
    const file = join(dir, "audit", "audit-2026-11-14.jsonl");
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace('"decision":"denied"', '"decision":"approved"'));
    const verify = await new AuditLog(dir).verify();
    expect(verify.ok).toBe(false);
    expect(verify.firstBroken).toMatchObject({ file: "audit-2026-11-14.jsonl", line: 1, seq: 1 });
  });

  it("keeps failing after the tail is truncated, even once new records land", async () => {
    const dir = await tempDir();
    const log = new AuditLog(dir);
    await log.append({ type: "approval", actor: "operator", t: "2026-11-14T00:00:00.000Z" });
    await log.append({ type: "approval", actor: "operator", t: "2026-11-14T01:00:00.000Z" });
    const file = join(dir, "audit", "audit-2026-11-14.jsonl");
    const [first] = (await readFile(file, "utf8")).split("\n");
    await writeFile(file, `${first}\n`);
    expect((await new AuditLog(dir).verify()).firstBroken?.reason).toMatch(/truncated/);
    const fresh = new AuditLog(dir);
    await fresh.append({ type: "policy", actor: "operator", t: "2026-11-14T02:00:00.000Z" });
    const verify = await fresh.verify();
    expect(verify.ok).toBe(false);
    expect(verify.firstBroken).toMatchObject({ line: 2, seq: 3 });
  });

  it("maps trace events to audit records without content", () => {
    expect(
      auditInputFromTrace({
        t: "2026-11-14T00:00:00.000Z",
        kind: "approval",
        sessionId: "s",
        id: "c1",
        name: "approved",
        args: {
          tool: "git_push",
          by: "operator",
          persist: true,
          entry: "git_push(branch:locus/*)",
        },
      }),
    ).toMatchObject({
      type: "approval",
      decision: "approved",
      summary: "Always allow git_push(branch:locus/*)",
    });
    expect(
      auditInputFromTrace({
        t: "",
        kind: "tool.result",
        sessionId: "s",
        name: "git_pr_merge",
        ok: true,
      }),
    ).toMatchObject({ type: "merge", decision: "ok" });
    expect(
      auditInputFromTrace({
        t: "",
        kind: "tool.result",
        sessionId: "s",
        name: "file_write",
        detail: "x",
      }),
    ).toBeUndefined();
  });

  it("records config changes by name, never by value", () => {
    const before = {
      providers: [{ id: "anthropic", apiKey: "sk-old-secret-value" }],
      forges: [],
      workers: [],
      integrations: [],
      mcpServers: [],
      integrationPlugins: [],
      advanced: { autonomy: "guided" },
    } as unknown as LocusConfig;
    const after = {
      ...before,
      providers: [{ id: "anthropic", apiKey: "sk-new-secret-value" }],
      advanced: { autonomy: "autonomous" },
      budgets: { dailyUsd: 5 },
      telemetry: { enabled: true, endpoint: "http://c:4318", headers: { "x-key": "hdr-secret" } },
    } as unknown as LocusConfig;
    const changes = auditConfigChanges(before, after);
    expect(changes.map((row) => row.type)).toEqual(["policy", "credential"]);
    const text = JSON.stringify(changes);
    expect(text).not.toContain("sk-new-secret-value");
    expect(text).not.toContain("hdr-secret");
    expect(changes[0]!.data?.fields).toEqual(["advanced.autonomy", "budgets", "telemetry"]);
    expect(changes[1]!.data).toMatchObject({
      providers: { changed: ["anthropic"] },
      telemetryHeaders: true,
    });
  });
});

describe("BudgetService", () => {
  it("persists today's spend and overrides across restarts", async () => {
    const dir = await tempDir();
    const now = () => new Date(2026, 10, 14, 15).getTime();
    const config = { providers: [], budgets: { dailyTokens: 1000 } } as unknown as LocusConfig;
    const service = new BudgetService(dir, now);
    await service.record(
      { id: "s1", providerId: "x", model: "m" },
      { inputTokens: 600, outputTokens: 0 },
      config,
    );
    await service.record(
      { id: "s2", providerId: "x", model: "m" },
      { inputTokens: 300, outputTokens: 200 },
      config,
    );
    expect(await service.check({}, config)).toMatchObject({
      ok: false,
      scope: "global",
      reason: "tokens",
    });
    await service.flush();
    const restarted = new BudgetService(dir, now);
    expect((await restarted.today()).global.tokens).toBe(1100);
    await restarted.override({ scope: "global", by: "operator", reason: "release day" });
    expect((await restarted.check({}, config)).ok).toBe(true);
    const tomorrow = new BudgetService(dir, () => new Date(2026, 10, 15, 0, 5).getTime());
    expect((await tomorrow.today()).global.tokens).toBe(0);
    expect(await tomorrow.listOverrides()).toEqual([]);
  });
});

describe("TelemetryExporter", () => {
  it("batches spans and metrics to OTLP/HTTP JSON and drops on failure without throwing", async () => {
    const posts: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    let fail = false;
    const fetchFn = (async (url: string, init: RequestInit) => {
      if (fail) throw new Error("collector down");
      posts.push({ url, body: String(init.body), headers: init.headers as Record<string, string> });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const exporter = new TelemetryExporter({
      fetchFn,
      flushIntervalMs: 60_000,
      resolveMeta: async () => ({ model: "m1", runtime: "host", kind: "agent", providerId: "p" }),
    });
    exporter.configure({
      enabled: true,
      endpoint: "http://127.0.0.1:4318",
      headers: { "x-api-key": "k" },
    });
    exporter.onTrace({
      t: "2026-11-14T00:00:00.000Z",
      kind: "turn.start",
      sessionId: "s",
      turnId: "t",
      detail: "secret prompt",
    });
    exporter.onTrace({
      t: "2026-11-14T00:00:01.000Z",
      kind: "tool.call",
      sessionId: "s",
      turnId: "t",
      id: "c",
      name: "exec",
      args: { command: "cat secret.txt" },
    });
    exporter.onTrace({
      t: "2026-11-14T00:00:02.000Z",
      kind: "tool.result",
      sessionId: "s",
      turnId: "t",
      id: "c",
      name: "exec",
      ok: true,
      detail: "file body",
    });
    exporter.onUsage({
      sessionId: "s",
      atMs: Date.now(),
      inputTokens: 10,
      outputTokens: 5,
      usd: 0.01,
      model: "m1",
      providerId: "p",
    });
    exporter.onTrace({
      t: "2026-11-14T00:00:03.000Z",
      kind: "turn.end",
      sessionId: "s",
      turnId: "t",
    });
    await exporter.flush();
    expect(posts.map((row) => row.url)).toEqual([
      "http://127.0.0.1:4318/v1/traces",
      "http://127.0.0.1:4318/v1/metrics",
    ]);
    expect(posts[0]!.headers["x-api-key"]).toBe("k");
    const traces = JSON.parse(posts[0]!.body);
    const spans = traces.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(2);
    const all = posts.map((row) => row.body).join("");
    expect(all).not.toContain("secret prompt");
    expect(all).not.toContain("secret.txt");
    expect(all).not.toContain("file body");
    expect(all).toContain("locus.tokens.input");

    fail = true;
    exporter.onTrace({
      t: "2026-11-14T00:01:00.000Z",
      kind: "turn.start",
      sessionId: "s",
      turnId: "t2",
    });
    exporter.onTrace({
      t: "2026-11-14T00:01:01.000Z",
      kind: "turn.end",
      sessionId: "s",
      turnId: "t2",
    });
    await exporter.flush();
    const stats = exporter.status();
    expect(stats.droppedSpans).toBe(1);
    expect(stats.failedRequests).toBeGreaterThan(0);
    expect(stats.lastError).toMatch(/collector down/);
    exporter.stop();
  });

  it("is a no-op when disabled", async () => {
    let calls = 0;
    const exporter = new TelemetryExporter({
      fetchFn: (async () => {
        calls += 1;
        return new Response("");
      }) as unknown as typeof fetch,
      resolveMeta: async () => undefined,
    });
    exporter.configure(undefined);
    exporter.onTrace({ t: "", kind: "turn.start", sessionId: "s" });
    await exporter.flush();
    expect(calls).toBe(0);
    expect(exporter.status().enabled).toBe(false);
  });
});

async function waitFor<T>(read: () => Promise<T>, pred: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000;
  let value = await read();
  while (Date.now() < deadline) {
    value = await read();
    if (pred(value)) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  return value;
}

describe("server-enforced daily budgets", () => {
  it("stops between rounds and at turn start with Budget reached + needsHuman, and audits it", async () => {
    const dir = await tempDir();
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    config.budgets = { dailyTokens: 100 };
    await store.saveConfig(config);
    let rounds = 0;
    async function* engine() {
      rounds += 1;
      yield { type: "usage" as const, inputTokens: 400, outputTokens: 50 };
      yield {
        type: "tool_call" as const,
        id: `r${rounds}`,
        name: "scratchpad",
        arguments: { action: "read" },
      };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: false,
    });
    await sessions.sendChat(created.id, "go");
    const stopped = await waitFor(
      () => sessions.get(created.id),
      (session) =>
        Boolean(session?.needsHuman?.startsWith("Budget reached")) && session?.status !== "running",
    );
    expect(rounds).toBe(1);
    expect(stopped?.needsHuman).toMatch(/^Budget reached: daily token cap \(450 \/ 100 today\)/);
    expect(
      stopped?.messages.some((m) => m.role === "system" && m.content.startsWith("Budget reached")),
    ).toBe(true);

    await sessions.sendChat(created.id, "again");
    await waitFor(
      () => sessions.get(created.id),
      (session) =>
        session?.status !== "running" &&
        (session?.messages.filter((m) => m.content.startsWith("Budget reached")).length ?? 0) >= 2,
    );
    expect(rounds).toBe(1);

    const app = createApp({ store, sessions, hypervisor });
    const status = (await (await app.request("/api/budgets")).json()) as {
      status: { spentTokens: number; capTokens: number };
    };
    expect(status.status).toMatchObject({ spentTokens: 450, capTokens: 100 });
    const override = await app.request("/api/budgets/override", {
      method: "POST",
      body: JSON.stringify({ scope: "global", reason: "ship it" }),
    });
    expect(override.status).toBe(200);
    expect((await sessions.budgets.check({}, await store.loadConfig())).ok).toBe(true);

    const records = await waitFor(
      () => sessions.audit.read(),
      (rows) =>
        rows.some((row) => row.type === "budget_stop") &&
        rows.some((row) => row.type === "budget_override"),
    );
    expect(records.filter((row) => row.type === "budget_stop").length).toBeGreaterThanOrEqual(2);
    expect(records.find((row) => row.type === "budget_override")?.summary).toContain("ship it");
    const verify = (await (await app.request("/api/audit/verify")).json()) as { ok: boolean };
    expect(verify.ok).toBe(true);
    const csv = await (await app.request("/api/audit/log?format=csv")).text();
    expect(csv.split("\n")[0]).toContain("prevHash");
    expect(await readdir(join(dir, "audit"))).toContain("HEAD.json");
    hypervisor.shutdown();
  });
});
