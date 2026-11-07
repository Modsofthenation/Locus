import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { debugLogId } from "@locus/shared";
import { createApp } from "../app.js";
import { Hub } from "./hub.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "./store.js";
import { SessionTraceLog } from "../session/traces.js";
import { listDebugLogs, readDebugLog } from "./debugLogs.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "locus-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const hypervisor = new MockHypervisor(dir);
  const sessions = new SessionService(store, hypervisor, new Hub());
  const app = createApp({ store, sessions, hypervisor });
  return { dir, store, sessions, hypervisor, app };
}

describe("debug logs", () => {
  it("lists JSONL traces and on-disk guest logs", async () => {
    const ctx = await setup();
    const traces = new SessionTraceLog(ctx.dir);
    await traces.write({
      t: "2026-08-22T00:00:00.000Z",
      kind: "turn.start",
      sessionId: "sess-1",
    });
    await traces.write({
      t: "2026-08-22T00:00:01.000Z",
      kind: "tool.call",
      sessionId: "sess-1",
      name: "repo_map",
    });
    await mkdir(join(ctx.dir, "vms", "vm-1"), { recursive: true });
    await writeFile(join(ctx.dir, "vms", "vm-1", "qemu.log"), "QEMU: serial tcp ready\nbooting\n");

    const sources = await listDebugLogs(ctx.dir, ctx.sessions);
    expect(sources.map((row) => row.kind).sort()).toEqual(["guest", "trace"]);
    const trace = sources.find((row) => row.kind === "trace");
    expect(trace?.id).toBe(debugLogId("trace", "sess-1"));
    expect(trace?.summary).toContain("repo_map");
    const guest = sources.find((row) => row.kind === "guest");
    expect(guest?.id).toBe(debugLogId("guest", "vm-1"));

    const raw = await readDebugLog(ctx.dir, ctx.sessions, debugLogId("trace", "sess-1"));
    expect(raw?.text).toContain('"kind":"tool.call"');
    expect(raw?.events?.some((event) => event.kind === "tool.call")).toBe(true);
    expect(await readDebugLog(ctx.dir, ctx.sessions, "trace:../passwd")).toBeUndefined();
  });

  it("serves the catalog and a selected trace over HTTP", async () => {
    const ctx = await setup();
    await new SessionTraceLog(ctx.dir).write({
      t: "2026-08-22T00:00:00.000Z",
      kind: "llm.request",
      sessionId: "abc",
      name: "gpt",
    });
    const listed = (await (await ctx.app.request("/api/debug/logs")).json()) as {
      sources: Array<{ id: string; kind: string }>;
    };
    expect(listed.sources.some((row) => row.id === "trace:abc")).toBe(true);
    const missing = await ctx.app.request("/api/debug/logs/trace/missing");
    expect(missing.status).toBe(404);
    const detail = (await (await ctx.app.request("/api/debug/logs/trace/abc")).json()) as {
      text: string;
    };
    expect(detail.text).toContain("llm.request");
    const bad = await ctx.app.request("/api/debug/logs/trace/../passwd");
    expect(bad.status).toBe(404);
    const evalRes = await ctx.app.request("/api/debug/logs/trace/abc/eval");
    expect(evalRes.status).toBe(200);
    const evalBody = (await evalRes.json()) as { fixture: { sessionId: string } };
    expect(evalBody.fixture.sessionId).toBe("abc");
    const saved = await ctx.app.request("/api/debug/logs/trace/abc/eval", { method: "POST" });
    expect(saved.status).toBe(201);
    const savedBody = (await saved.json()) as { path: string; fixture: { sessionId: string } };
    expect(savedBody.path).toContain("evals");
    expect(savedBody.fixture.sessionId).toBe("abc");
  });

  it("tails large logs instead of loading the whole file", async () => {
    const ctx = await setup();
    await mkdir(join(ctx.dir, "vms", "vm-big"), { recursive: true });
    await writeFile(
      join(ctx.dir, "vms", "vm-big", "qemu.log"),
      `${"booting\n".repeat(80_000)}ready\n`,
    );
    const listed = await listDebugLogs(ctx.dir, ctx.sessions);
    expect(listed.some((row) => row.id === debugLogId("guest", "vm-big"))).toBe(true);
    const detail = await readDebugLog(ctx.dir, ctx.sessions, debugLogId("guest", "vm-big"));
    expect(detail?.truncated).toBe(true);
    expect(detail?.text.length).toBeLessThan(410_000);
    expect(detail?.text).toContain("ready");
  });

  it("refuses debug logs from a paired LAN phone", async () => {
    const ctx = await setup();
    const config = await ctx.store.loadConfig();
    config.phoneRemote = { enabled: true, token: "ph_secret" };
    await ctx.store.saveConfig(config);
    const lan = createApp({
      store: ctx.store,
      sessions: ctx.sessions,
      hypervisor: ctx.hypervisor,
      peerAddress: () => "192.168.1.20",
    });
    const res = await lan.request("/api/debug/logs", {
      headers: {
        origin: "http://192.168.1.8:7420",
        authorization: "Bearer ph_secret",
      },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: string }).error).toMatch(/desktop-only/);
  });
});
