import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  MockHypervisor,
  MockDockerEngine,
  qemuIsoError,
  type CommandRunner,
  dockerWorkspaceDir,
  type Hypervisor,
} from "@locus/hypervisor";
import { AutomationService } from "./automations/automations.js";
import { BoardService } from "./boards/boards.js";
import { createApp } from "./app.js";
import { Hub } from "./core/hub.js";
import {
  SessionService,
  bootNote,
  cloneStartNote,
  mockAssistantReply,
  EMPTY_MODEL_REPLY,
  EMPTY_CANVAS_NOTE,
  EMPTY_CANVAS_NUDGE,
  DESIGN_MUTATE_NUDGE,
} from "./session/sessions.js";
import { JsonStore } from "./core/store.js";
import { SessionTraceLog } from "./session/traces.js";
import {
  CLOUD_IMAGE_CATALOG,
  DESIGN_CANVAS_PATH,
  DESIGN_PLAYBOOK,
  DESIGN_TOOLS,
  DEFAULT_DESIGN_PALETTE,
  CANVAS_FRAME_CSP,
  CANVAS_FRAME_PATH,
  canvasFrameHtml,
  VIRTIO_ISO,
  rewindTargets,
  type AgentSession,
  type Automation,
  type AutomationRun,
  type ClientEvent,
  type LinkedRepo,
  type LocusConfig,
  type VmInstance,
  type DockerContainer,
  type DockerContainerStats,
  type DockerBulkStopResult,
  OPS_RESEARCH_SKILL,
  REVIEW_PR_SKILL,
  DESIGN_LOOK_NUDGE,
  GAME_PLAYWRIGHT_NUDGE,
  GAME_JUICE_NUDGE,
  ASSET_PLAYWRIGHT_NUDGE,
  ASSET_SCULPT_NUDGE,
  SELF_CORRECT_MISSING_NUDGE,
} from "@locus/shared";

const execFileAsync = promisify(execFile);

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "locus-"));
  const store = new JsonStore(dir);
  await store.init();
  const hypervisor = new MockHypervisor(dir);
  const hub = new Hub();
  const sessions = new SessionService(store, hypervisor, hub);
  const automations = new AutomationService(store, sessions, hub, { waitMs: 4000, pollMs: 20 });
  const boards = new BoardService(store, hub, sessions);
  sessions.plane.boards = boards;
  const app = createApp({ store, sessions, hypervisor, automations, boards });
  return { dir, store, hypervisor, sessions, automations, boards, app, hub };
}

async function waitForHttpRun(
  app: ReturnType<typeof createApp>,
  automationId: string,
  done: (row: AutomationRun) => boolean,
): Promise<AutomationRun> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = (await (
      await app.request(`/api/automations/${automationId}/runs`)
    ).json()) as AutomationRun[];
    const match = rows.find(done);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out waiting for automation run");
}

/** App with a runner that cannot find any binary, so host-installed tools (e.g. tailscale)
 *  do not leak into tests that assert their absence. */
async function setupWithoutHostBinaries() {
  const ctx = await setup();
  const runner: CommandRunner = {
    which: async () => null,
    exists: async () => false,
    exec: async () => ({ stdout: "", stderr: "", code: 1 }),
    spawn: () => {
      throw new Error("no binaries expected in this test");
    },
  };
  const app = createApp({ ...ctx, runner });
  return { ...ctx, app };
}

async function setupSlowChat(delayMs = 180) {
  const dir = await mkdtemp(join(tmpdir(), "locus-"));
  const store = new JsonStore(dir);
  await store.init();
  const config = await store.loadConfig();
  config.providers = config.providers.map((p, i) =>
    i === 0 ? { ...p, apiKey: "sk-test-queue", enabled: true } : p,
  );
  await store.saveConfig(config);
  const hypervisor = new MockHypervisor(dir);
  const hub = new Hub();
  async function* slow(req: { signal?: AbortSignal }) {
    yield { type: "text" as const, text: "one" };
    await new Promise((r) => setTimeout(r, delayMs));
    if (req.signal?.aborted) return;
    yield { type: "text" as const, text: " two" };
  }
  const sessions = new SessionService(store, hypervisor, hub, slow);
  const app = createApp({ store, sessions, hypervisor });
  return { dir, store, hypervisor, sessions, app };
}

async function waitUntilDockerRunning(
  sessions: SessionService,
  sessionId: string,
  timeoutMs = 2000,
): Promise<void> {
  await sessions.startVm(sessionId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = await sessions.get(sessionId);
    const vm = session?.vmId ? sessions.getMachine(session.vmId) : undefined;
    if (vm?.status === "running") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Docker guest did not reach running");
}

async function createIdleSession(ctx: {
  app: ReturnType<typeof createApp>;
}): Promise<AgentSession> {
  const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
  const created = await ctx.app.request("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      runtime: "host",
    }),
  });
  return (await created.json()) as AgentSession;
}

async function stubMediaUrl(item: { url: string }, body: Buffer): Promise<() => Promise<void>> {
  const previous = item.url;
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  item.url = `http://127.0.0.1:${addr.port}/image`;
  return () =>
    new Promise<void>((resolve) => {
      item.url = previous;
      server.close(() => resolve());
    });
}

let cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)),
  );
  cleanup = [];
});

describe("api", () => {
  it("serves health and default config", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const health = await ctx.app.request("/api/health");
    expect(health.status).toBe(200);
    expect((await health.json()) as { ok: boolean; docker?: string }).toMatchObject({
      ok: true,
      docker: "mock",
    });

    const frame = await ctx.app.request(CANVAS_FRAME_PATH);
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-security-policy")).toBe(CANVAS_FRAME_CSP);
    expect(await frame.text()).toBe(canvasFrameHtml());

    const hv = (await (await ctx.app.request("/api/hypervisor")).json()) as { kind: string };
    expect(hv.kind).toBe("mock");

    const cfg = await ctx.app.request("/api/config");
    const config = (await cfg.json()) as LocusConfig;
    expect(config.templates.map((t) => t.os)).toEqual([
      "ubuntu",
      "debian",
      "omarchy",
      "windows-11",
      "windows-10",
    ]);
    expect(config.templates[0]?.cloudInit?.packages).toEqual(
      expect.arrayContaining(["ubuntu-desktop-minimal", "xclip", "git", "ffmpeg", "ripgrep"]),
    );
    expect(config.templates[0]?.cloudInit?.runcmd).toEqual(
      expect.arrayContaining(["systemctl restart gdm3 || systemctl restart gdm || true"]),
    );
    expect(config.templates[0]?.cloudInit?.runcmd?.join("\n")).toContain("WaylandEnable=false");
    expect(config.templates.find((t) => t.os === "debian")?.cloudInit?.packages).toEqual(
      expect.arrayContaining(["xfce4", "xclip", "ffmpeg", "ripgrep"]),
    );
    expect(config.templates.find((t) => t.os === "debian")?.cloudInit?.runcmd).toEqual(
      expect.arrayContaining(["systemctl restart lightdm || true"]),
    );
    expect(config.providers.length).toBeGreaterThan(3);
    expect(config.providers[0]).toMatchObject({
      name: "OpenCode",
      kind: "opencode",
      baseUrl: "https://opencode.ai/zen/v1",
      defaultModel: "big-pickle",
    });
    expect(config.hardwareProfiles).toEqual([]);
    expect(config.forges.map((f) => f.kind).sort()).toEqual(["bitbucket", "github", "gitlab"]);
    expect(config.theme).toBe("ember");
    expect(config.setupCompleted).toBe(false);
    expect(config.advanced.hostSharePath).toBe(join(ctx.dir, "share"));
    const stored = await ctx.store.loadConfig();
    stored.advanced.hostSharePath = "";
    await ctx.store.saveConfig(stored);
    expect((await ctx.store.loadConfig()).advanced.hostSharePath).toBe(join(ctx.dir, "share"));
    expect(config.templates[0]?.cloudInit?.password).toBe("••••••••");
    expect(config.templates.find((t) => t.os === "windows-11")?.unattend?.password).toBe(
      "••••••••",
    );
    const storedPassword = (await ctx.store.loadConfig()).templates[0]?.cloudInit?.password;
    expect(storedPassword).toBeTruthy();
    expect(storedPassword).not.toBe("locus");
    ctx.hypervisor.shutdown();
  });

  it("resets all local data after RESET confirm", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    await createIdleSession(ctx);
    await writeFile(join(ctx.dir, "stale.txt"), "nope");
    const denied = await ctx.app.request("/api/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "nope" }),
    });
    expect(denied.status).toBe(400);
    expect(await ctx.store.loadSessions()).toHaveLength(1);

    const reset = await ctx.app.request("/api/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "RESET" }),
    });
    expect(reset.status).toBe(200);
    const body = (await reset.json()) as {
      ok: boolean;
      sessions: unknown[];
      repos: unknown[];
      automations: unknown[];
      config: LocusConfig;
      setup: { needsWizard: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.sessions).toEqual([]);
    expect(body.repos).toEqual([]);
    expect(body.automations).toEqual([]);
    expect(body.config.setupCompleted).toBeFalsy();
    expect(body.setup.needsWizard).toBe(true);
    expect(await ctx.store.loadSessions()).toEqual([]);
    expect(await readFile(join(ctx.dir, "stale.txt"), "utf8").catch(() => "missing")).toBe(
      "missing",
    );
    expect((await (await ctx.app.request("/api/sessions")).json()) as unknown[]).toEqual([]);
    ctx.hypervisor.shutdown();
  });

  it("reports first-run setup status and honors setupCompleted", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const initial = (await (await ctx.app.request("/api/setup")).json()) as {
      needsWizard: boolean;
      ready: boolean;
      hasProvider: boolean;
      linuxImageReady: boolean;
      hypervisorKind: string;
      qemuHint: string;
      hostOs: { platform: string; label: string };
    };
    expect(initial.needsWizard).toBe(true);
    expect(initial.ready).toBe(false);
    expect(initial.hasProvider).toBe(false);
    expect(initial.linuxImageReady).toBe(false);

    const withKeyOnly = await ctx.store.loadConfig();
    withKeyOnly.providers = withKeyOnly.providers.map((p, i) =>
      i === 0 ? { ...p, apiKey: "sk-test-docker-first", enabled: true } : p,
    );
    await ctx.store.saveConfig(withKeyOnly);
    const providerReady = (await (await ctx.app.request("/api/setup")).json()) as {
      ready: boolean;
      needsWizard: boolean;
      hasProvider: boolean;
      linuxImageReady: boolean;
    };
    expect(providerReady.hasProvider).toBe(true);
    expect(providerReady.linuxImageReady).toBe(false);
    expect(providerReady.ready).toBe(true);
    expect(providerReady.needsWizard).toBe(false);
    expect(initial.hypervisorKind).toBe("mock");
    expect(initial.hostOs.platform).toBe(
      process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux",
    );
    expect(initial.hostOs.label).toBeTruthy();
    expect(initial.qemuHint).toBeTruthy();

    const config = await ctx.store.loadConfig();
    config.templates = config.templates.map((t) =>
      t.os === "ubuntu" ? { ...t, isoPath: "/tmp/ubuntu.img" } : t,
    );
    config.providers = config.providers.map((p, i) =>
      i === 0 ? { ...p, apiKey: "sk-test-setup", enabled: true } : p,
    );
    await ctx.store.saveConfig(config);

    const ready = (await (await ctx.app.request("/api/setup")).json()) as {
      needsWizard: boolean;
      ready: boolean;
      hasProvider: boolean;
      linuxImageReady: boolean;
    };
    expect(ready.ready).toBe(true);
    expect(ready.hasProvider).toBe(true);
    expect(ready.linuxImageReady).toBe(true);
    expect(ready.needsWizard).toBe(false);

    config.setupCompleted = true;
    config.templates = config.templates.map((t) => ({ ...t, isoPath: "" }));
    config.providers = config.providers.map((p) => ({ ...p, apiKey: "", enabled: false }));
    await ctx.store.saveConfig(config);
    const skipped = (await (await ctx.app.request("/api/setup")).json()) as {
      needsWizard: boolean;
      ready: boolean;
    };
    expect(skipped.ready).toBe(false);
    expect(skipped.needsWizard).toBe(false);
    ctx.hypervisor.shutdown();
  });

  it("installs QEMU with a one-click setup endpoint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const sessions = new SessionService(store, hypervisor, hub);
    const runner = {
      which: async (bin: string) =>
        bin === "winget" || bin === "winget.exe" ? "C:\\winget.exe" : null,
      exists: async () => false,
      exec: async () => ({ stdout: "", stderr: "", code: 1 }),
      spawn: () => {
        throw new Error("installQemu mock should run instead");
      },
    };
    const caps = {
      qemuBinary: "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
      qemuImgBinary: "C:\\Program Files\\qemu\\qemu-img.exe",
      swtpmBinary: null,
      xorrisoBinary: null,
      accelerator: "whpx" as const,
      ovmfCodePath: null,
      ovmfVarsPath: null,
      hasKvm: false,
      kvmUsable: false,
      hasVirtfs: false,
    };
    const app = createApp({
      store,
      sessions,
      hypervisor,
      runner,
      host: { platform: "win32" },
      installQemu: async () => ({ ok: true, log: "Successfully installed" }),
      onQemuInstalled: async () => ({ hypervisor, capabilities: caps }),
    });

    const initial = (await (await app.request("/api/setup")).json()) as {
      hostOs: { label: string; platform: string };
      qemuInstall: { canInstall: boolean; method: string };
      qemuFound: boolean;
    };
    expect(initial.hostOs).toEqual({ platform: "win32", label: "Windows" });
    expect(initial.qemuInstall.canInstall).toBe(true);
    expect(initial.qemuInstall.method).toBe("winget");
    expect(initial.qemuFound).toBe(false);

    const installed = (await (
      await app.request("/api/hypervisor/install", { method: "POST" })
    ).json()) as {
      ok: boolean;
      qemuFound: boolean;
      setup: { qemuFound: boolean };
    };
    expect(installed.ok).toBe(true);
    expect(installed.qemuFound).toBe(true);
    expect(installed.setup.qemuFound).toBe(true);

    const missingMgr = createApp({
      store,
      sessions,
      hypervisor,
      runner: {
        which: async () => null,
        exists: async () => false,
        exec: async () => ({ stdout: "", stderr: "", code: 1 }),
        spawn: () => {
          throw new Error("should not spawn");
        },
      },
      host: { platform: "win32" },
    });
    const denied = await missingMgr.request("/api/hypervisor/install", { method: "POST" });
    expect(denied.status).toBe(400);
    const body = (await denied.json()) as { error: string };
    expect(body.error).toContain("qemu.org/download/#windows");
    hypervisor.shutdown();
  });

  it("adds Debian, Omarchy, and Windows 10 templates to an older config", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.templates = config.templates.filter((t) => t.os === "ubuntu" || t.os === "windows-11");
    await ctx.store.saveConfig(config);
    const loaded = await ctx.store.loadConfig();
    expect(loaded.templates.map((t) => t.os)).toEqual([
      "ubuntu",
      "windows-11",
      "debian",
      "omarchy",
      "windows-10",
    ]);
    ctx.hypervisor.shutdown();
  });

  it("adds OpenCode Zen and migrates an unused local stub", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.providers = [
      {
        id: "openai",
        name: "OpenAI",
        kind: "openai",
        baseUrl: "https://api.openai.com/v1",
        models: ["gpt-4.1"],
        defaultModel: "gpt-4.1",
        enabled: false,
        extraHeaders: {},
      },
      {
        id: "old-opencode",
        name: "OpenCode",
        kind: "opencode",
        baseUrl: "http://127.0.0.1:4096/v1",
        models: ["opencode"],
        defaultModel: "opencode",
        enabled: false,
        extraHeaders: {},
      },
    ];
    await ctx.store.saveConfig(config);
    const loaded = await ctx.store.loadConfig();
    const opencode = loaded.providers.find((p) => p.kind === "opencode");
    expect(opencode).toMatchObject({
      id: "old-opencode",
      baseUrl: "https://opencode.ai/zen/v1",
      defaultModel: "big-pickle",
    });
    expect(loaded.providers[0]?.kind).toBe("openai");
    expect(loaded.providers.some((p) => p.name === "Ollama")).toBe(true);
    ctx.hypervisor.shutdown();
  });

  it("creates, lists, and runs an automation into a chat", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/automations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Nightly lint",
        prompt: "say hi",
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        schedule: { kind: "interval", everyMinutes: 60 },
        startVm: false,
      }),
    });
    expect(created.status).toBe(201);
    const item = (await created.json()) as Automation;
    expect(item.name).toBe("Nightly lint");
    expect(item.nextRunAt).toBeTruthy();

    const listed = (await (await ctx.app.request("/api/automations")).json()) as Automation[];
    expect(listed.map((a) => a.id)).toContain(item.id);

    const runRes = await ctx.app.request(`/api/automations/${item.id}/run`, { method: "POST" });
    expect(runRes.status).toBe(200);
    const queued = (await runRes.json()) as AutomationRun;
    expect(["running", "succeeded"]).toContain(queued.status);
    expect(queued.trigger).toBe("manual");
    expect(queued.sessionId).toBeTruthy();
    const run = await waitForHttpRun(
      ctx.app,
      item.id,
      (row) => row.id === queued.id && row.status === "succeeded",
    );

    const runs = (await (
      await ctx.app.request(`/api/automations/${item.id}/runs`)
    ).json()) as AutomationRun[];
    expect(runs[0]?.id).toBe(run.id);
    const allRuns = (await (
      await ctx.app.request("/api/automation-runs")
    ).json()) as AutomationRun[];
    expect(allRuns.map((r) => r.id)).toContain(run.id);

    const session = (await (
      await ctx.app.request(`/api/sessions/${run.sessionId}`)
    ).json()) as AgentSession;
    expect(session.automationId).toBe(item.id);
    expect(session.messages.some((m) => m.role === "user" && m.content === "say hi")).toBe(true);
    ctx.hypervisor.shutdown();
  });

  it("lets an automation session run playwright against a url", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/automations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Web check",
        prompt: "say hi",
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        schedule: { kind: "interval", everyMinutes: 60 },
        startVm: false,
      }),
    });
    expect(created.status).toBe(201);
    const item = (await created.json()) as Automation;
    const runRes = await ctx.app.request(`/api/automations/${item.id}/run`, { method: "POST" });
    expect(runRes.status).toBe(200);
    const queued = (await runRes.json()) as AutomationRun;
    expect(queued.sessionId).toBeTruthy();
    const run = await waitForHttpRun(
      ctx.app,
      item.id,
      (row) => row.id === queued.id && Boolean(row.sessionId) && row.status !== "queued",
    );
    const playwright = await ctx.app.request(`/api/sessions/${run.sessionId}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "playwright",
        args: { url: "http://127.0.0.1:9/", expect_text: "Hi" },
      }),
    });
    expect(playwright.status).toBe(200);
    const body = (await playwright.json()) as { ok: boolean; output: string };
    expect(body.output).not.toMatch(/Design agents/);
    expect(body.output).not.toMatch(/not allowed for this agent/);
    expect(body.output).toMatch(/static|not reachable|Chrome/i);
    ctx.hypervisor.shutdown();
  });

  it("overlays a named environment onto an overnight automation run", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    config.namedEnvironments = [
      {
        id: "env-1",
        name: "restricted-oncall",
        runtime: "docker",
        os: "ubuntu",
        dockerImage: "locus/agent",
        network: "restricted",
        recipeId: "ops-loop",
        maxUsd: 20,
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
      },
    ];
    const saved = await ctx.app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    expect(saved.status).toBe(200);
    const created = await ctx.app.request("/api/automations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Overnight",
        prompt: "check grafana",
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        runtime: "docker",
        dockerImage: "ubuntu:24.04",
        namedEnvironmentId: "env-1",
        schedule: {
          kind: "adaptive",
          startHour: 9,
          startMinute: 0,
          endHour: 17,
          endMinute: 0,
          everyMinutes: 60,
          otherwiseEveryMinutes: 180,
        },
        startVm: false,
      }),
    });
    expect(created.status).toBe(201);
    const item = (await created.json()) as Automation;
    expect(item.namedEnvironmentId).toBe("env-1");
    expect(item.reuseSession).toBe(true);
    expect(item.persistMemory).toBe(true);
    const runRes = await ctx.app.request(`/api/automations/${item.id}/run`, { method: "POST" });
    expect(runRes.status).toBe(200);
    const queued = (await runRes.json()) as AutomationRun;
    const run = await waitForHttpRun(
      ctx.app,
      item.id,
      (row) => row.id === queued.id && Boolean(row.sessionId),
    );
    const session = (await (
      await ctx.app.request(`/api/sessions/${run.sessionId}`)
    ).json()) as AgentSession;
    expect(session.runtime).toBe("docker");
    expect(session.dockerImage).toBe("locus/agent:0.1");
    expect(session.network).toBe("restricted");
    expect(session.maxUsd).toBe(20);
    expect(session.playbook).toMatch(/Grafana/i);
    expect(session.allowedTools).not.toContain("playwright");
    ctx.hypervisor.shutdown();
  });

  it("accepts a signed local forge webhook", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const missing = await ctx.app.request("/api/hooks/automations/missing", {
      method: "POST",
      body: "{}",
    });
    expect(missing.status).toBe(404);
    const created = await ctx.app.request("/api/automations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "On push",
        prompt: "review",
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        repo: { forge: "github", url: "https://github.com/acme/app.git" },
        schedule: { kind: "forge" },
        startVm: false,
      }),
    });
    expect(created.status).toBe(201);
    const item = (await created.json()) as Automation;
    expect(item.webhookSecret).toBeTruthy();
    const listed = (await (await ctx.app.request("/api/automations")).json()) as Automation[];
    expect(listed.find((row) => row.id === item.id)?.webhookSecret).toBe("••••••••");
    const got = (await (await ctx.app.request(`/api/automations/${item.id}`)).json()) as Automation;
    expect(got.webhookSecret).toBe("••••••••");
    const unauthorized = await ctx.app.request(`/api/hooks/automations/${item.id}`, {
      method: "POST",
      headers: { "x-locus-secret": "nope" },
      body: "{}",
    });
    expect(unauthorized.status).toBe(401);
    const missingTs = await ctx.app.request(`/api/hooks/automations/${item.id}`, {
      method: "POST",
      headers: {
        "x-locus-secret": item.webhookSecret!,
        "x-github-event": "ping",
      },
      body: "{}",
    });
    expect(missingTs.status).toBe(401);
    const ping = await ctx.app.request(`/api/hooks/automations/${item.id}`, {
      method: "POST",
      headers: {
        "x-locus-secret": item.webhookSecret!,
        "x-locus-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-github-event": "ping",
      },
      body: "{}",
    });
    expect(ping.status).toBe(200);
    expect(((await ping.json()) as { ping?: boolean }).ping).toBe(true);
    ctx.hypervisor.shutdown();
  });

  it("accepts a generic automation webhook and Slack challenge", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/automations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Slack ops",
        prompt: "summarize",
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        schedule: { kind: "webhook" },
        startVm: false,
      }),
    });
    expect(created.status).toBe(201);
    const item = (await created.json()) as Automation;
    expect(item.schedule.kind).toBe("webhook");
    expect(item.webhookSecret).toBeTruthy();
    const challenge = await ctx.app.request(`/api/hooks/automations/${item.id}`, {
      method: "POST",
      headers: {
        "x-locus-secret": item.webhookSecret!,
        "x-locus-timestamp": String(Math.floor(Date.now() / 1000)),
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "url_verification", challenge: "from-slack" }),
    });
    expect(challenge.status).toBe(200);
    expect(((await challenge.json()) as { challenge?: string }).challenge).toBe("from-slack");
    const queued = await ctx.app.request(`/api/hooks/automations/${item.id}`, {
      method: "POST",
      headers: {
        "x-locus-secret": item.webhookSecret!,
        "x-locus-timestamp": String(Math.floor(Date.now() / 1000)),
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "latency spike", channel: "#ops" }),
    });
    expect(queued.status).toBe(200);
    expect(((await queued.json()) as { queued?: boolean }).queued).toBe(true);
    const oversized = await ctx.app.request(`/api/hooks/automations/${item.id}`, {
      method: "POST",
      headers: { "x-locus-secret": item.webhookSecret!, "content-length": "70000" },
      body: "{}",
    });
    expect(oversized.status).toBe(413);
    const gatewayReplay = await ctx.app.request(`/api/hooks/automations/${item.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: "2.0",
        routeKey: "POST /api/hooks/automations/{id}",
        rawPath: `/api/hooks/automations/${item.id}`,
        headers: {
          "x-locus-secret": item.webhookSecret,
          "content-type": "application/json",
        },
        requestContext: { apiId: "abc", timeEpoch: Date.now() },
        body: JSON.stringify({ text: "from api gateway", channel: "#ops" }),
        isBase64Encoded: false,
      }),
    });
    expect(gatewayReplay.status).toBe(401);
    const gateway = await ctx.app.request(`/api/hooks/automations/${item.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-locus-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify({
        version: "2.0",
        routeKey: "POST /api/hooks/automations/{id}",
        rawPath: `/api/hooks/automations/${item.id}`,
        headers: {
          "x-locus-secret": item.webhookSecret,
          "content-type": "application/json",
        },
        requestContext: { apiId: "abc", timeEpoch: Date.now() },
        body: JSON.stringify({ text: "from api gateway", channel: "#ops" }),
        isBase64Encoded: false,
      }),
    });
    expect(gateway.status).toBe(200);
    expect(((await gateway.json()) as { queued?: boolean }).queued).toBe(true);
    const gatewayApiKey = await ctx.app.request(`/api/hooks/automations/${item.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-locus-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify({
        version: "2.0",
        routeKey: "POST /api/hooks/automations/{id}",
        rawPath: `/api/hooks/automations/${item.id}`,
        headers: {
          "x-api-key": item.webhookSecret,
          "content-type": "application/json",
        },
        requestContext: { apiId: "abc", timeEpoch: Date.now() },
        body: JSON.stringify({ text: "from api key", channel: "#ops" }),
        isBase64Encoded: false,
      }),
    });
    expect(gatewayApiKey.status).toBe(200);
    expect(((await gatewayApiKey.json()) as { queued?: boolean }).queued).toBe(true);
    const httpIntegration = await ctx.app.request(`/api/hooks/automations/${item.id}`, {
      method: "POST",
      headers: {
        "x-api-key": item.webhookSecret!,
        "x-locus-timestamp": String(Math.floor(Date.now() / 1000)),
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "from http integration", channel: "#ops" }),
    });
    expect(httpIntegration.status).toBe(200);
    expect(((await httpIntegration.json()) as { queued?: boolean }).queued).toBe(true);
    ctx.hypervisor.shutdown();
  });

  it("creates an Ubuntu session and starts a mock VM", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const template = config.templates.find((t) => t.os === "ubuntu");
    const provider = config.providers[0];
    expect(template).toBeDefined();
    expect(provider).toBeDefined();

    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: template!.id,
        providerId: provider!.id,
        model: provider!.defaultModel,
        startVm: true,
        repo: { forge: "github", url: "https://github.com/acme/demo.git" },
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.os).toBe("ubuntu");
    expect(session.vmId).toBeTruthy();
    expect(session.network).toBe("restricted");
    expect(session.title).toContain("demo");
    expect(session.hardware?.cpuCores).toBe(4);
    expect(session.hardware?.memoryMb).toBe(4096);

    ctx.hypervisor.forceRunning(session.vmId!);
    const deadline = Date.now() + 2000;
    let cloned = false;
    while (Date.now() < deadline) {
      const fresh = await ctx.sessions.get(session.id);
      cloned = Boolean(
        fresh?.messages.some((m) => m.role === "system" && m.content.includes("Cloned")),
      );
      if (cloned) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(cloned).toBe(true);
    const afterClone = await ctx.sessions.get(session.id);
    const systemNotes = afterClone?.messages.filter((m) => m.role === "system") ?? [];
    const cloningIdx = systemNotes.findIndex((m) => m.content.startsWith("Cloning "));
    const cloneNoteIdx = systemNotes.findIndex((m) => m.content.includes("Cloned"));
    expect(cloningIdx).toBeGreaterThanOrEqual(0);
    expect(cloneNoteIdx).toBeGreaterThan(cloningIdx);
    expect(systemNotes[cloningIdx]?.content).toContain("into the guest at /home/locus/workspace");
    const cloneNote = systemNotes[cloneNoteIdx];
    expect(cloneNote?.content).toContain("into the guest at /home/locus/workspace");
    expect(cloneNote?.content).not.toContain("/home/locus/workspace/demo");

    const tool = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "exec", args: { command: "uname -a" } }),
    });
    expect(tool.status).toBe(200);
    const body = (await tool.json()) as { ok: boolean; output: string };
    expect(body.ok).toBe(true);
    expect(body.output).toContain("uname -a");
    ctx.hypervisor.shutdown();
  });

  it("holds the start prompt until the mock guest is ready", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    try {
      const vm = ctx.hypervisor.get(session.vmId!);
      expect(vm?.status === "running" || vm?.status === "ready").toBe(false);
      const chat = await ctx.app.request(`/api/sessions/${session.id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello guest" }),
      });
      expect(chat.status).toBe(200);

      const deadline = Date.now() + 4000;
      let sawUserBeforeReady = false;
      let repliedBeforeReady = false;
      let done = false;
      let reply = "";
      while (Date.now() < deadline) {
        const fresh = await ctx.sessions.get(session.id);
        const live = ctx.hypervisor.get(session.vmId!);
        const guestReady =
          live?.status === "running" || live?.status === "ready" || live?.status === "paused";
        const hasUser = Boolean(
          fresh?.messages.some((m) => m.role === "user" && m.content === "hello guest"),
        );
        const assistant = fresh?.messages.find(
          (m) => m.role === "assistant" && m.content.includes("hello guest"),
        );
        if (hasUser && !guestReady) sawUserBeforeReady = true;
        if (assistant && !guestReady) repliedBeforeReady = true;
        if (assistant && fresh?.status === "idle") {
          reply = assistant.content;
          done = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(sawUserBeforeReady).toBe(true);
      expect(repliedBeforeReady).toBe(false);
      expect(done).toBe(true);
      expect(reply).toMatch(/Guest is \*\*(ready|running|paused)\*\*/);
    } finally {
      ctx.hypervisor.shutdown();
    }
  });

  it("rejects guest tools while the VM is still starting", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    const tool = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "exec", args: { command: "uname -a" } }),
    });
    expect(tool.status).toBe(400);
    const body = (await tool.json()) as { error: string };
    expect(body.error).toMatch(/isn't ready yet/i);

    const pr = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "git_pr", args: { title: "WIP" } }),
    });
    expect(pr.status).toBe(200);
    const prBody = (await pr.json()) as { output: string };
    expect(prBody.output).not.toMatch(/isn't ready yet/i);
    expect(prBody.output).toMatch(/No repository is attached/i);
    ctx.hypervisor.shutdown();
  });

  it("rejects unknown templates", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const res = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: "missing",
        providerId: "x",
        model: "y",
        startVm: false,
      }),
    });
    expect(res.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("renames, pins, and archives a session", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const older = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
        title: "Older",
      }),
    });
    const newer = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
        title: "Newer",
      }),
    });
    expect(older.status).toBe(201);
    expect(newer.status).toBe(201);
    const olderSession = (await older.json()) as AgentSession;
    await ctx.store.mutateSession(olderSession.id, (current) => {
      current.needsHuman = "Reviewer FAIL";
    });
    const spoof = await ctx.app.request(`/api/sessions/${olderSession.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ needsHuman: "spoofed" }),
    });
    expect(spoof.status).toBe(200);
    expect(((await spoof.json()) as AgentSession).needsHuman).toBe("Reviewer FAIL");
    const dismissed = await ctx.app.request(`/api/sessions/${olderSession.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ needsHuman: null }),
    });
    expect(dismissed.status).toBe(200);
    expect(((await dismissed.json()) as AgentSession).needsHuman).toBeUndefined();
    expect((await ctx.sessions.get(olderSession.id))?.needsHuman).toBeUndefined();
    const patched = await ctx.app.request(`/api/sessions/${olderSession.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Pinned older", pinned: true, archived: true }),
    });
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as AgentSession;
    expect(body.title).toBe("Pinned older");
    expect(body.pinned).toBe(true);
    expect(body.archived).toBe(true);

    const listed = (await (await ctx.app.request("/api/sessions")).json()) as AgentSession[];
    expect(listed[0]?.id).toBe(olderSession.id);

    const blank = await ctx.app.request(`/api/sessions/${olderSession.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });
    expect(blank.status).toBe(400);

    const grok =
      config.providers.find((p) => p.kind === "openai" && p.name.toLowerCase().includes("grok")) ??
      config.providers[1];
    const agent = await ctx.app.request(`/api/sessions/${olderSession.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: grok!.id,
        model: grok!.defaultModel,
        instructions: "Always use /mnt/host",
        allowedTools: ["exec", "git_status"],
      }),
    });
    expect(agent.status).toBe(200);
    const updated = (await agent.json()) as AgentSession;
    expect(updated.providerId).toBe(grok!.id);
    expect(updated.model).toBe(grok!.defaultModel);
    expect(updated.instructions).toBe("Always use /mnt/host");
    expect(updated.allowedTools).toEqual(["exec", "git_status"]);

    const vision = await ctx.app.request(`/api/sessions/${olderSession.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vision: "off", playbook: "Always run tests." }),
    });
    expect(vision.status).toBe(200);
    const withVision = (await vision.json()) as AgentSession;
    expect(withVision.vision).toBe("off");
    expect(withVision.playbook).toBe("Always run tests.");

    const autonomy = await ctx.app.request(`/api/sessions/${olderSession.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autonomy: "supervised", maxUsd: 4 }),
    });
    expect(autonomy.status).toBe(200);
    const withAutonomy = (await autonomy.json()) as AgentSession;
    expect(withAutonomy.autonomy).toBe("supervised");
    expect(withAutonomy.maxUsd).toBe(4);

    const web = await ctx.app.request(`/api/sessions/${olderSession.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ webSearch: true }),
    });
    expect(web.status).toBe(200);
    expect(((await web.json()) as AgentSession).webSearch).toBe(true);

    const cleared = await ctx.app.request(`/api/sessions/${olderSession.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instructions: null, allowedTools: [] }),
    });
    expect(cleared.status).toBe(200);
    const empty = (await cleared.json()) as AgentSession;
    expect(empty.instructions).toBeUndefined();
    expect(empty.allowedTools).toBeUndefined();

    const badTool = await ctx.app.request(`/api/sessions/${olderSession.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowedTools: ["powershell"] }),
    });
    expect(badTool.status).toBe(400);
    const unknownProvider = await ctx.app.request(`/api/sessions/${olderSession.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "nope" }),
    });
    expect(unknownProvider.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("applies repo hardware profiles and explicit CPU/RAM overrides", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    config.hardwareProfiles = [
      {
        id: "heavy",
        name: "Heavy",
        repoPattern: "acme/heavy",
        hardware: { cpuCores: 8, memoryMb: 16384 },
      },
    ];
    const saved = await ctx.app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    expect(saved.status).toBe(200);

    const fromRepo = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
        repo: { forge: "github", url: "https://github.com/acme/heavy.git" },
      }),
    });
    expect(fromRepo.status).toBe(201);
    const repoSession = (await fromRepo.json()) as AgentSession;
    expect(repoSession.hardware?.cpuCores).toBe(8);
    expect(repoSession.hardware?.memoryMb).toBe(16384);
    expect(repoSession.hardware?.diskSizeGb).toBe(40);

    const overridden = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
        repo: { forge: "github", url: "https://github.com/acme/heavy.git" },
        hardware: { cpuCores: 2, memoryMb: 2048, diskSizeGb: 20 },
      }),
    });
    expect(overridden.status).toBe(201);
    const overSession = (await overridden.json()) as AgentSession;
    expect(overSession.hardware?.cpuCores).toBe(2);
    expect(overSession.hardware?.memoryMb).toBe(2048);
    expect(overSession.hardware?.diskSizeGb).toBe(20);
    ctx.hypervisor.shutdown();
  });

  it("rejects a hardware profile without a repo pattern", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    config.hardwareProfiles = [
      { id: "bad", name: "Bad", repoPattern: "  ", hardware: { cpuCores: 8 } },
    ];
    const saved = await ctx.app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    expect(saved.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("streams a complete mock chat reply", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const template = config.templates.find((t) => t.os === "ubuntu");
    const provider = config.providers[0];
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: template!.id,
        providerId: provider!.id,
        model: provider!.defaultModel,
        startVm: false,
        runtime: "host",
      }),
    });
    const session = (await created.json()) as AgentSession;
    await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "ping" }),
    });
    const expected = mockAssistantReply("ping", session);
    const deadline = Date.now() + 12_000;
    let assistant = "";
    while (Date.now() < deadline) {
      const fresh = await ctx.sessions.get(session.id);
      assistant = fresh?.messages.find((m) => m.role === "assistant")?.content ?? "";
      if (assistant === expected) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    expect(assistant).toBe(expected);
  }, 15_000);

  it("streams tokens from a configured provider engine", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    async function* engine() {
      yield { type: "text" as const, text: "from-" };
      yield { type: "text" as const, text: "provider" };
      yield { type: "usage" as const, inputTokens: 11, outputTokens: 3 };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: false,
    });
    await sessions.sendChat(created.id, "hi");
    const deadline = Date.now() + 4000;
    let fresh = await sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await sessions.get(created.id);
      const text = fresh?.messages.find((m) => m.role === "assistant")?.content ?? "";
      if (text === "from-provider" && fresh?.usage) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.messages.find((m) => m.role === "assistant")?.content).toBe("from-provider");
    expect(fresh?.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
    expect(fresh?.messages.find((m) => m.role === "assistant")?.usage).toEqual({
      inputTokens: 11,
      outputTokens: 3,
    });
    const log = new SessionTraceLog(dir);
    let response = (await log.read(created.id)).find((event) => event.kind === "llm.response");
    const traceDeadline = Date.now() + 2000;
    while (Date.now() < traceDeadline && response?.inputTokens !== 11) {
      await new Promise((r) => setTimeout(r, 20));
      response = (await log.read(created.id)).find((event) => event.kind === "llm.response");
    }
    expect(response?.inputTokens).toBe(11);
    expect(response?.outputTokens).toBe(3);
  });

  it("executes model tool calls on the guest and continues the turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let round = 0;
    async function* engine() {
      round += 1;
      if (round === 1) {
        yield {
          type: "tool_call" as const,
          id: "call_1",
          name: "exec",
          arguments: { command: "uname -a" },
        };
        return;
      }
      yield { type: "text" as const, text: "Guest kernel listed." };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    hypervisor.forceRunning(created.vmId!);
    await sessions.sendChat(created.id, "what kernel?");
    const deadline = Date.now() + 4000;
    let fresh = await sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await sessions.get(created.id);
      if (fresh?.messages.some((m) => m.content === "Guest kernel listed.")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.messages.some((m) => m.role === "tool" && m.content.includes("uname -a"))).toBe(
      true,
    );
    expect(fresh?.messages.some((m) => m.content === "Guest kernel listed.")).toBe(true);
    const assistant = fresh?.messages.find((m) => m.toolCalls?.some((t) => t.id === "call_1"));
    expect(assistant?.toolCalls?.[0]?.result).toContain("uname -a");
    hypervisor.shutdown();
  });

  it("diagnoses a failed tool and retries without bouncing to the operator", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let round = 0;
    async function* engine() {
      round += 1;
      if (round === 1) {
        yield {
          type: "tool_call" as const,
          id: "fail_1",
          name: "file_read",
          arguments: { path: "/no-such-file" },
        };
        return;
      }
      yield { type: "text" as const, text: "retried after the stack trace" };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    hypervisor.forceRunning(created.vmId!);
    await sessions.sendChat(created.id, "read the missing file");
    const deadline = Date.now() + 4000;
    let fresh = await sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await sessions.get(created.id);
      if (
        fresh?.messages.some((m) => m.content === "retried after the stack trace") &&
        fresh.status !== "running"
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const nudge = fresh?.messages.find(
      (m) => m.role === "system" && m.content === SELF_CORRECT_MISSING_NUDGE,
    );
    expect(nudge?.hidden).toBe(true);
    expect(fresh?.messages.some((m) => m.content === "retried after the stack trace")).toBe(true);
    const traces = new SessionTraceLog(dir);
    const events = await traces.read(created.id);
    expect(events.some((event) => event.kind === "selfCorrect")).toBe(true);
    const evals = await readdir(join(dir, "evals")).catch(() => [] as string[]);
    expect(evals.length).toBeGreaterThan(0);
    hypervisor.shutdown();
  });

  it("runs several independent reads from one model round", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let round = 0;
    async function* engine() {
      round += 1;
      if (round === 1) {
        yield { type: "tool_call" as const, id: "r1", name: "git_status", arguments: {} };
        yield { type: "tool_call" as const, id: "r2", name: "git_diff", arguments: {} };
        return;
      }
      yield { type: "text" as const, text: "both reads" };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    hypervisor.forceRunning(created.vmId!);
    await sessions.sendChat(created.id, "what changed?");
    const deadline = Date.now() + 4000;
    let fresh = await sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await sessions.get(created.id);
      if (fresh?.messages.some((m) => m.content === "both reads")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(round).toBe(2);
    expect(fresh?.messages.filter((m) => m.role === "tool")).toHaveLength(2);
    expect(fresh?.messages.some((m) => m.content === "both reads")).toBe(true);
    hypervisor.shutdown();
  });

  it("offers and executes host websearch when the session toggle is on", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let extraNames: string[] = [];
    let searched = false;
    async function* engine(req: { extraTools?: Array<{ name: string }> }) {
      extraNames = (req.extraTools ?? []).map((t) => t.name);
      if (extraNames.includes("websearch")) {
        if (!searched) {
          searched = true;
          yield {
            type: "tool_call" as const,
            id: "ws_1",
            name: "websearch",
            arguments: { query: "qemu" },
          };
          return;
        }
        yield { type: "text" as const, text: "QEMU is an emulator." };
        return;
      }
      yield { type: "text" as const, text: "No search tool." };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    sessions.fetchFn = (async (input) => {
      const url = String(input);
      if (url.includes("html.duckduckgo.com")) {
        return new Response(
          `<a class="result__a" href="https://www.qemu.org/">QEMU</a><a class="result__snippet">Machine emulator</a>`,
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: false,
    });
    await expect(
      sessions.executeTool(created.id, { name: "websearch" as never, args: { query: "qemu" } }),
    ).rejects.toThrow(/Web search is off/);

    await sessions.sendChat(created.id, "what is qemu?");
    const firstDeadline = Date.now() + 4000;
    let fresh = await sessions.get(created.id);
    while (Date.now() < firstDeadline) {
      fresh = await sessions.get(created.id);
      if (
        fresh?.status !== "running" &&
        fresh?.messages.some((m) => m.content === "No search tool.")
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(extraNames).not.toContain("websearch");
    expect(fresh?.messages.some((m) => m.content === "No search tool.")).toBe(true);

    await sessions.patchMeta(created.id, { webSearch: true });
    await sessions.sendChat(created.id, "search qemu");
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      fresh = await sessions.get(created.id);
      if (fresh?.messages.some((m) => m.content === "QEMU is an emulator.")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(extraNames).toContain("websearch");
    expect(
      fresh?.messages.some((m) => m.role === "tool" && m.content.includes("https://www.qemu.org/")),
    ).toBe(true);
    expect(fresh?.messages.some((m) => m.content === "QEMU is an emulator.")).toBe(true);
    hypervisor.shutdown();
  });

  it("holds git_push until the operator approves or denies it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let phase: "tool" | "text" = "tool";
    let mode: "approve" | "deny" = "approve";
    async function* engine() {
      if (phase === "tool") {
        phase = "text";
        yield {
          type: "tool_call" as const,
          id: "push_1",
          name: "git_push",
          arguments: {},
        };
        return;
      }
      yield { type: "text" as const, text: mode === "approve" ? "Pushed." : "Skipped push." };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const app = createApp({ store, sessions, hypervisor });
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    hypervisor.forceRunning(created.vmId!);
    await sessions.executeTool(created.id, { name: "git_branch", args: { name: "feat/push" } });
    expect((await sessions.get(created.id))?.gitBranch).toBe("feat/push");
    await sessions.sendChat(created.id, "push it");

    const pendingDeadline = Date.now() + 4000;
    let pending = await sessions.get(created.id);
    while (Date.now() < pendingDeadline) {
      pending = await sessions.get(created.id);
      if (
        pending?.messages.some((m) =>
          m.toolCalls?.some((t) => t.id === "push_1" && t.approval === "needed"),
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(pending?.messages.some((m) => m.role === "tool")).toBe(false);
    expect(pending?.messages.some((m) => m.content === "Pushed.")).toBe(false);

    const missing = await app.request("/api/sessions/missing/approvals", {
      method: "POST",
      body: JSON.stringify({ toolCallId: "push_1", decision: "approved" }),
      headers: { "content-type": "application/json" },
    });
    expect(missing.status).toBe(404);
    const nobody = await app.request(`/api/sessions/${created.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ toolCallId: "nope", decision: "approved" }),
      headers: { "content-type": "application/json" },
    });
    expect(nobody.status).toBe(400);

    const approved = await app.request(`/api/sessions/${created.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ toolCallId: "push_1", decision: "approved" }),
      headers: { "content-type": "application/json" },
    });
    expect(approved.status).toBe(200);

    const doneDeadline = Date.now() + 4000;
    let fresh = await sessions.get(created.id);
    while (Date.now() < doneDeadline) {
      fresh = await sessions.get(created.id);
      if (fresh?.messages.some((m) => m.content === "Pushed.")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.messages.some((m) => m.role === "tool" && m.content === "pushed")).toBe(true);
    expect(fresh?.messages.some((m) => m.content === "Pushed.")).toBe(true);
    expect(
      fresh?.messages.find((m) => m.toolCalls?.some((t) => t.id === "push_1"))?.toolCalls?.[0]
        ?.approval,
    ).toBe("approved");

    phase = "tool";
    mode = "deny";
    const other = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    hypervisor.forceRunning(other.vmId!);
    await sessions.sendChat(other.id, "push it");
    const denyWait = Date.now() + 4000;
    let waiting = await sessions.get(other.id);
    while (Date.now() < denyWait) {
      waiting = await sessions.get(other.id);
      if (
        waiting?.messages.some((m) =>
          m.toolCalls?.some((t) => t.id === "push_1" && t.approval === "needed"),
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const denied = await app.request(`/api/sessions/${other.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ toolCallId: "push_1", decision: "denied" }),
      headers: { "content-type": "application/json" },
    });
    expect(denied.status).toBe(200);
    const skipDeadline = Date.now() + 4000;
    let skipped = await sessions.get(other.id);
    while (Date.now() < skipDeadline) {
      skipped = await sessions.get(other.id);
      if (skipped?.messages.some((m) => m.content === "Skipped push.")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(skipped?.messages.some((m) => m.role === "tool" && m.content === "Denied by user")).toBe(
      true,
    );
    expect(skipped?.messages.some((m) => m.content === "pushed")).toBe(false);
    hypervisor.shutdown();
  });

  it.skipIf(process.platform === "win32")(
    "auto-allows listed MCP tools on automation sessions",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-auto-mcp-"));
      cleanup.push(dir);
      const fixture = `#!/usr/bin/env node
let buf = Buffer.alloc(0);
const tools = [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }];
function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write("Content-Length: " + Buffer.byteLength(json) + "\\r\\n\\r\\n" + json);
}
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const idx = buf.indexOf("\\r\\n\\r\\n");
    if (idx < 0) return;
    const header = buf.subarray(0, idx).toString("utf8");
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) return;
    const len = Number(match[1]);
    const start = idx + 4;
    if (buf.length < start + len) return;
    const msg = JSON.parse(buf.subarray(start, start + len).toString("utf8"));
    buf = buf.subarray(start + len);
    if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } });
    else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools } });
    else if (msg.method === "tools/call") {
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: String(msg.params?.arguments?.text ?? "") }] } });
    }
  }
});
`;
      const script = join(dir, "server.mjs");
      await writeFile(script, fixture, { mode: 0o755 });
      const store = new JsonStore(dir);
      await store.init();
      const config = await store.loadConfig();
      const provider = config.providers[0]!;
      provider.apiKey = "sk-test";
      config.mcpServers = [
        {
          id: "echo",
          name: "Echo",
          enabled: true,
          command: process.execPath,
          args: [script],
          env: {},
        },
      ];
      await store.saveConfig(config);
      let phase: "tool" | "text" = "tool";
      async function* engine() {
        if (phase === "tool") {
          phase = "text";
          yield {
            type: "tool_call" as const,
            id: "mcp_1",
            name: "mcp_echo_echo",
            arguments: { text: "pong" },
          };
          return;
        }
        yield { type: "text" as const, text: "Done." };
      }
      const hypervisor = new MockHypervisor(dir);
      const sessions = new SessionService(store, hypervisor, new Hub(), engine);
      await sessions.refreshMcp();
      const created = await sessions.create({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: provider.id,
        model: provider.defaultModel,
        startVm: false,
        automationId: "auto-1",
        allowedMcpTools: ["mcp_echo_echo"],
      });
      await sessions.sendChat(created.id, "ping mcp");
      const deadline = Date.now() + 4000;
      let fresh = await sessions.get(created.id);
      while (Date.now() < deadline) {
        fresh = await sessions.get(created.id);
        if (fresh?.messages.some((m) => m.content === "Done.")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const call = fresh?.messages.find((m) => m.toolCalls?.some((t) => t.id === "mcp_1"))
        ?.toolCalls?.[0];
      expect(call?.approval).not.toBe("needed");
      expect(call?.result).toContain("pong");
      expect(fresh?.messages.some((m) => m.content === "Done.")).toBe(true);
      hypervisor.shutdown();
    },
  );
});

describe("mockAssistantReply", () => {
  it("mentions the guest OS and repo", () => {
    const text = mockAssistantReply("hello", {
      id: "1",
      title: "t",
      os: "windows-11",
      templateId: "windows-11",
      providerId: "p",
      model: "m",
      status: "idle",
      messages: [],
      createdAt: "",
      updatedAt: "",
      repo: { forge: "bitbucket", url: "https://bitbucket.org/acme/app.git", ref: "main" },
    });
    expect(text).toContain("Windows 11");
    expect(text).toContain("bitbucket.org/acme/app.git");
    expect(text).toContain("hello");
    expect(text).toContain("**Demo reply**");
    expect(text).toContain("no provider key is configured");
  });
});

describe("qemuIsoError", () => {
  it("only rejects empty ISOs on QEMU", () => {
    expect((new MockHypervisor("/tmp") as Hypervisor).isoError).toBeUndefined();
    expect(qemuIsoError({ os: "ubuntu", isoPath: "/isos/ubuntu.iso" })).toBeUndefined();
    expect(qemuIsoError({ os: "ubuntu", isoPath: "" })).toMatch(/Ubuntu ISO/);
    expect(qemuIsoError({ os: "ubuntu", isoPath: "" }, { imageId: "img-1" })).toBeUndefined();
    expect(qemuIsoError({ os: "debian", isoPath: "" })).toMatch(/Debian ISO/);
    expect(qemuIsoError({ os: "omarchy", isoPath: "" })).toMatch(/Omarchy ISO/);
    expect(qemuIsoError({ os: "windows-11", isoPath: "" })).toMatch(
      /ISO or disk image path is not set/,
    );
  });

  it("describes boot stages for the chat thread", () => {
    expect(bootNote("booting")).toMatch(/waiting for SSH/);
    expect(bootNote("running")).toBe("Guest is ready.");
    expect(bootNote("error", "boom")).toBe("boom");
    expect(bootNote("creating")).toBeUndefined();
    expect(bootNote("booting", undefined, "docker")).toBe("Starting the container.");
    expect(bootNote("running", undefined, "docker")).toBe("Container is ready.");
  });

  it("describes clone start for the chat thread", () => {
    expect(
      cloneStartNote({
        url: "https://github.com/acme/demo.git",
        dest: "/home/locus/workspace",
        runtime: "vm",
      }),
    ).toBe("Cloning https://github.com/acme/demo.git into the guest at /home/locus/workspace");
    expect(
      cloneStartNote({
        url: "https://github.com/acme/demo.git",
        dest: "/workspace",
        runtime: "docker",
      }),
    ).toBe("Cloning https://github.com/acme/demo.git into the guest at /workspace");
    expect(
      cloneStartNote({
        url: "https://github.com/acme/demo.git",
        dest: "/workspace",
        runtime: "host",
      }),
    ).toBe("Cloning https://github.com/acme/demo.git into the host workspace at /workspace");
    expect(
      cloneStartNote({
        url: "https://github.com/acme/app.git",
        dest: "/workspace/_repo",
        runtime: "docker",
        design: true,
      }),
    ).toBe(
      "Cloning https://github.com/acme/app.git into /workspace/_repo for design context (read-only reference)",
    );
  });

  it("refuses SessionService start when the Ubuntu ISO is empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = {
      kind: "qemu" as const,
      list: () => [],
      get: () => undefined,
      onStatus: () => undefined,
      isoError: qemuIsoError,
    } as unknown as Hypervisor;
    const sessions = new SessionService(store, hypervisor, new Hub());
    const config = await store.loadConfig();
    const template = config.templates.find((t) => t.os === "ubuntu")!;
    const provider = config.providers[0]!;
    await expect(
      sessions.create({
        os: "ubuntu",
        templateId: template.id,
        providerId: provider.id,
        model: provider.defaultModel,
        startVm: true,
      }),
    ).rejects.toThrow(/Ubuntu ISO/);
  });
});

describe("docker agents", () => {
  it("returns a Docker session before the container finishes starting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class SlowDocker extends MockDockerEngine {
      startedStatus: string | undefined;
      override async start(id: string) {
        await gate;
        const vm = await super.start(id);
        this.startedStatus = vm.status;
        return vm;
      }
    }
    const docker = new SlowDocker(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), undefined, undefined, docker);
    const app = createApp({ store, sessions, hypervisor });
    const config = await store.loadConfig();
    const started = Date.now();
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "node:22-bookworm",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    expect(Date.now() - started).toBeLessThan(750);
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.runtime).toBe("docker");
    expect(session.status).toBe("provisioning");
    expect(session.vmId).toBeTruthy();
    expect(docker.get(session.vmId!)?.status).not.toBe("running");
    const design = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "design",
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "locus/agent",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    expect(design.status).toBe(201);
    expect(((await design.json()) as AgentSession).kind).toBe("design");
    release();
    await sessions.startVm(session.id);
    expect(docker.startedStatus).toBe("booting");
    hypervisor.shutdown();
  });

  it("holds the start prompt until a background Docker start finishes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class SlowDocker extends MockDockerEngine {
      override async start(id: string) {
        await gate;
        return super.start(id);
      }
    }
    const docker = new SlowDocker(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), undefined, undefined, docker);
    const app = createApp({ store, sessions, hypervisor });
    const config = await store.loadConfig();
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "locus/agent",
        kind: "design",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    try {
      const chat = await app.request(`/api/sessions/${session.id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "Design a six-slide pitch deck as a single HTML page",
        }),
      });
      expect(chat.status).toBe(200);
      await new Promise((r) => setTimeout(r, 250));
      let fresh = await sessions.get(session.id);
      expect(
        fresh?.messages.some(
          (m) => m.role === "user" && m.content.includes("six-slide pitch deck"),
        ),
      ).toBe(true);
      expect(fresh?.messages.some((m) => m.role === "assistant" && m.content.trim())).toBe(false);
      expect(fresh?.status).toBe("running");
      expect(docker.get(session.vmId!)?.status).not.toBe("running");
      release();
      const deadline = Date.now() + 4000;
      let reply = "";
      while (Date.now() < deadline) {
        fresh = await sessions.get(session.id);
        const assistant = fresh?.messages.find(
          (m) => m.role === "assistant" && m.content.includes("six-slide pitch deck"),
        );
        if (assistant && fresh?.status === "idle") {
          reply = assistant.content;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(reply).toContain("six-slide pitch deck");
      expect(reply).toMatch(/Container is \*\*(ready|running|paused)\*\*/);
      expect(reply).not.toMatch(/Container is \*\*(booting|creating)\*\*/);
    } finally {
      release();
      await sessions.abortChat(session.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("starts a stopped Docker container when a chat is sent", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    try {
      await waitUntilDockerRunning(ctx.sessions, created.id);
      await ctx.sessions.stopVm(created.id);
      expect(ctx.sessions.getMachine(created.vmId!)?.status).toBe("stopped");

      await ctx.sessions.sendChat(created.id, "hello after stop");
      const deadline = Date.now() + 4000;
      let fresh = await ctx.sessions.get(created.id);
      let reply = "";
      while (Date.now() < deadline) {
        fresh = await ctx.sessions.get(created.id);
        const assistant = fresh?.messages.find(
          (m) => m.role === "assistant" && m.content.includes("hello after stop"),
        );
        if (assistant && fresh?.status === "idle") {
          reply = assistant.content;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(reply).toContain("hello after stop");
      expect(reply).toMatch(/Container is \*\*(ready|running|paused)\*\*/);
      expect(
        fresh?.messages.some(
          (m) => m.role === "system" && m.content.includes("did not become ready"),
        ),
      ).toBe(false);
      expect(ctx.sessions.getMachine(created.vmId!)?.status).toMatch(/running|ready|paused/);
    } finally {
      await ctx.sessions.abortChat(created.id).catch(() => undefined);
      ctx.hypervisor.shutdown();
    }
  });

  it("starts a draft Docker container when a chat is sent", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    try {
      expect(created.vmId).toBeFalsy();
      expect(created.status).toBe("draft");

      await ctx.sessions.sendChat(created.id, "hello from draft");
      const deadline = Date.now() + 4000;
      let fresh = await ctx.sessions.get(created.id);
      let reply = "";
      while (Date.now() < deadline) {
        fresh = await ctx.sessions.get(created.id);
        const assistant = fresh?.messages.find(
          (m) => m.role === "assistant" && m.content.includes("hello from draft"),
        );
        if (assistant && fresh?.status === "idle") {
          reply = assistant.content;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(fresh?.vmId).toBeTruthy();
      expect(reply).toContain("hello from draft");
      expect(reply).toMatch(/Container is \*\*(ready|running|paused)\*\*/);
      expect(
        fresh?.messages.some(
          (m) => m.role === "system" && m.content.includes("did not become ready"),
        ),
      ).toBe(false);
      expect(ctx.sessions.getMachine(fresh!.vmId!)?.status).toMatch(/running|ready|paused/);
    } finally {
      await ctx.sessions.abortChat(created.id).catch(() => undefined);
      ctx.hypervisor.shutdown();
    }
  });

  it("does not run a Docker turn when auto-start fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    class FailDocker extends MockDockerEngine {
      override async start(id: string): Promise<VmInstance> {
        const vm = this.get(id);
        if (vm) {
          vm.status = "error";
          vm.error = "image build failed";
          this.emit("status", id, "error", "image build failed");
        }
        throw new Error("image build failed");
      }
    }
    const docker = new FailDocker(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), undefined, undefined, docker);
    const config = await store.loadConfig();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    try {
      await sessions.sendChat(created.id, "hello after failed start");
      const deadline = Date.now() + 4000;
      let fresh = await sessions.get(created.id);
      while (Date.now() < deadline) {
        fresh = await sessions.get(created.id);
        if (
          fresh?.status !== "running" &&
          fresh?.messages.some(
            (m) => m.role === "system" && m.content.includes("did not become ready"),
          )
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(
        fresh?.messages.some((m) => m.role === "user" && m.content === "hello after failed start"),
      ).toBe(true);
      expect(
        fresh?.messages.some(
          (m) => m.role === "system" && m.content.includes("did not become ready"),
        ),
      ).toBe(true);
      expect(
        fresh?.messages.some(
          (m) => m.role === "assistant" && m.content.includes("hello after failed start"),
        ),
      ).toBe(false);
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("runs the start prompt from create without a follow-up chat request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), undefined, undefined, docker);
    const app = createApp({ store, sessions, hypervisor });
    const config = await store.loadConfig();
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "locus/agent",
        kind: "design",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
        prompt: "Build a standup spinner as a single HTML page",
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(
      session.messages.some((m) => m.role === "user" && m.content.includes("standup spinner")),
    ).toBe(true);
    try {
      const deadline = Date.now() + 4000;
      let reply = "";
      while (Date.now() < deadline) {
        const fresh = await sessions.get(session.id);
        const assistant = fresh?.messages.find(
          (m) => m.role === "assistant" && m.content.includes("standup spinner"),
        );
        if (assistant && fresh?.status === "idle") {
          reply = assistant.content;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(reply).toContain("standup spinner");
      expect(reply).toMatch(/Container is \*\*(ready|running|paused)\*\*/);
    } finally {
      await sessions.abortChat(session.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("retries an empty model turn then tells the user if it stays blank", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let calls = 0;
    async function* engine() {
      calls += 1;
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    try {
      await sessions.sendChat(created.id, "hello guest");
      const deadline = Date.now() + 4000;
      let text = "";
      while (Date.now() < deadline) {
        const fresh = await sessions.get(created.id);
        text = fresh?.messages.find((m) => m.role === "assistant")?.content ?? "";
        if (text.includes("no reply") && fresh?.status === "idle") break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(calls).toBe(3);
      expect(text).toContain(EMPTY_MODEL_REPLY);
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("retries a design reply that never writes the canvas, then paints a first draft", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let calls = 0;
    async function* engine() {
      calls += 1;
      yield { type: "text" as const, text: "I will design a spinner." };
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    try {
      await sessions.sendChat(created.id, "Build a standup spinner");
      const deadline = Date.now() + 4000;
      let html: string | null = null;
      let nudged = false;
      let idle = false;
      while (Date.now() < deadline) {
        const fresh = await sessions.get(created.id);
        idle = fresh?.status === "idle";
        nudged = Boolean(
          fresh?.messages.some(
            (m) => m.role === "system" && m.content === EMPTY_CANVAS_NUDGE && m.hidden,
          ),
        );
        html = (await sessions.design.readCanvas(created.id)).html;
        if (idle && html?.includes("standup spinner")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(calls).toBe(3);
      expect(nudged).toBe(true);
      expect(html).toContain("standup spinner");
      expect(html).toContain("First draft");
      expect(html).toContain("data-locus-host-fallback");
      const fresh = await sessions.get(created.id);
      expect(
        fresh?.messages.some((m) => m.role === "system" && m.content === EMPTY_CANVAS_NOTE),
      ).toBe(false);
      expect(fresh?.needsHuman).toMatch(/last-resort host draft/);
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("nudges a silent design turn then paints a first draft", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let calls = 0;
    async function* engine() {
      calls += 1;
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    try {
      await sessions.sendChat(created.id, "Build a standup spinner");
      const deadline = Date.now() + 4000;
      let html: string | null = null;
      let nudged = false;
      let idle = false;
      while (Date.now() < deadline) {
        const fresh = await sessions.get(created.id);
        idle = fresh?.status === "idle";
        nudged = Boolean(
          fresh?.messages.some(
            (m) => m.role === "system" && m.content === EMPTY_CANVAS_NUDGE && m.hidden,
          ),
        );
        html = (await sessions.design.readCanvas(created.id)).html;
        if (idle && html?.includes("standup spinner")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(calls).toBe(5);
      expect(nudged).toBe(true);
      expect(html).toContain("standup spinner");
      expect(html).toContain("data-locus-host-fallback");
      const fresh = await sessions.get(created.id);
      expect(
        fresh?.messages.some((m) => m.role === "system" && m.content === EMPTY_CANVAS_NOTE),
      ).toBe(false);
      expect(fresh?.needsHuman).toMatch(/last-resort host draft/);
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("lets a design turn interview with ask_user before writing the canvas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let calls = 0;
    async function* engine() {
      calls += 1;
      if (calls === 1) {
        yield {
          type: "tool_call" as const,
          id: "q1",
          name: "ask_user",
          arguments: {
            question: "A few details before the first draft",
            questions: [
              { question: "Who is this for?", choices: ["Founders", "Consumers"] },
              { question: "Primary goal?", choices: ["Signups", "Explain"] },
            ],
          },
        };
        return;
      }
      yield {
        type: "tool_call" as const,
        id: "w1",
        name: "file_write",
        arguments: {
          path: DESIGN_CANVAS_PATH,
          content: "<html><body><h1>Founders</h1></body></html>",
        },
      };
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    try {
      await waitUntilDockerRunning(sessions, created.id);
      const turn = sessions.sendChat(created.id, "Make a landing page");
      const deadline = Date.now() + 4000;
      let callId = "";
      while (Date.now() < deadline) {
        const fresh = await sessions.get(created.id);
        const call = fresh?.messages
          .flatMap((m) => m.toolCalls ?? [])
          .find((c) => c.name === "ask_user" && c.approval === "needed");
        if (call) {
          callId = call.id;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(callId).toBeTruthy();
      const mid = await sessions.get(created.id);
      expect(
        mid?.messages.some((m) => m.role === "system" && m.content === EMPTY_CANVAS_NUDGE),
      ).toBe(false);
      await sessions.resolveApproval(
        created.id,
        callId,
        "approved",
        "1. Who is this for?\nFounders\n\n2. Primary goal?\nSignups",
      );
      await turn;
      const doneBy = Date.now() + 4000;
      let html: string | null = null;
      while (Date.now() < doneBy) {
        html = (await sessions.design.readCanvas(created.id)).html;
        if (html?.includes("Founders")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(html).toContain("Founders");
      expect(calls).toBe(2);
      const fresh = await sessions.get(created.id);
      expect(
        fresh?.messages.some((m) => m.role === "system" && m.content === EMPTY_CANVAS_NUDGE),
      ).toBe(false);
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("recovers a design turn that talks first and writes the canvas on the retry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let calls = 0;
    async function* engine() {
      calls += 1;
      if (calls === 1) {
        yield { type: "text" as const, text: "Working on a draft." };
        return;
      }
      if (calls === 2) {
        yield {
          type: "tool_call" as const,
          id: "w1",
          name: "file_write",
          arguments: {
            path: "/workspace/index.html",
            content: "<html><body><h1>Spinner</h1></body></html>",
          },
        };
        return;
      }
      yield { type: "text" as const, text: "Draft is on the canvas." };
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    try {
      await sessions.sendChat(created.id, "Build a standup spinner");
      const deadline = Date.now() + 4000;
      let html: string | null = null;
      let idle = false;
      while (Date.now() < deadline) {
        const fresh = await sessions.get(created.id);
        idle = fresh?.status === "idle";
        html = (await sessions.design.readCanvas(created.id)).html;
        if (idle && html?.includes("Spinner")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(html).toContain("Spinner");
      const fresh = await sessions.get(created.id);
      expect(
        fresh?.messages.some((m) => m.role === "system" && m.content === EMPTY_CANVAS_NOTE),
      ).toBe(false);
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("looks at the canvas after the first successful write, then stops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let calls = 0;
    async function* engine() {
      calls += 1;
      if (calls === 1) {
        yield {
          type: "tool_call" as const,
          id: "w1",
          name: "file_write",
          arguments: {
            path: "/workspace/index.html",
            content: "<html><body><h1>One-pager</h1></body></html>",
          },
        };
        return;
      }
      if (calls === 2) {
        yield { type: "text" as const, text: "Looked at the screenshot." };
        return;
      }
      yield { type: "text" as const, text: "A third thinking round should not run." };
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: "x-preview-f-free",
      startVm: true,
      prompt: "Design a print-like one-pager",
    });
    try {
      const deadline = Date.now() + 4000;
      let html: string | null = null;
      let idle = false;
      while (Date.now() < deadline) {
        const fresh = await sessions.get(created.id);
        idle = fresh?.status === "idle";
        html = (await sessions.design.readCanvas(created.id)).html;
        if (idle && html?.includes("One-pager")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(calls).toBe(3);
      expect(html).toContain("One-pager");
      const fresh = await sessions.get(created.id);
      expect(fresh?.status).toBe("idle");
      expect(fresh?.messages.filter((m) => m.content === DESIGN_LOOK_NUDGE)).toHaveLength(2);
      expect(fresh?.messages.some((m) => m.content.includes("third thinking round"))).toBe(true);
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("looks at a games canvas after the first successful write, juices a dry loop, then stops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let calls = 0;
    async function* engine() {
      calls += 1;
      if (calls === 1) {
        yield {
          type: "tool_call" as const,
          id: "w1",
          name: "file_write",
          arguments: {
            path: "/workspace/index.html",
            content:
              "<!doctype html><html><body><script>window.addEventListener('keydown', () => {});</script>Score 0<button>Restart</button><p>Arcade loop</p></body></html>",
          },
        };
        return;
      }
      if (calls === 2) {
        yield { type: "text" as const, text: "Looked at the screenshot." };
        return;
      }
      yield { type: "text" as const, text: "A third thinking round should not run." };
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "game",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: "x-preview-f-free",
      startVm: true,
      prompt: "Make a playable arcade loop",
    });
    try {
      const deadline = Date.now() + 4000;
      let html: string | null = null;
      let idle = false;
      while (Date.now() < deadline) {
        const fresh = await sessions.get(created.id);
        idle = fresh?.status === "idle";
        html = (await sessions.design.readCanvas(created.id)).html;
        if (idle && html?.includes("Arcade loop")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(calls).toBe(5);
      expect(html).toContain("Arcade loop");
      const fresh = await sessions.get(created.id);
      expect(fresh?.status).toBe("idle");
      expect(fresh?.messages.filter((m) => m.content === GAME_PLAYWRIGHT_NUDGE)).toHaveLength(2);
      expect(fresh?.messages.filter((m) => m.content === GAME_JUICE_NUDGE)).toHaveLength(2);
      expect(fresh?.messages.some((m) => m.content === DESIGN_LOOK_NUDGE)).toBe(false);
      expect(fresh?.messages.some((m) => m.content.includes("third thinking round"))).toBe(true);
      expect(fresh?.needsHuman).toMatch(/still dry/);
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("looks at an assets canvas after the first successful write, sculpts a placeholder, then stops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let calls = 0;
    async function* engine() {
      calls += 1;
      if (calls === 1) {
        yield {
          type: "tool_call" as const,
          id: "w1",
          name: "file_write",
          arguments: {
            path: "/workspace/index.html",
            content:
              '<!doctype html><html><body><canvas></canvas><script>import * as THREE from "./vendor/three.module.js"</script><p>Hero mesh</p></body></html>',
          },
        };
        return;
      }
      if (calls === 2) {
        yield { type: "text" as const, text: "Looked at the screenshot." };
        return;
      }
      yield { type: "text" as const, text: "A third thinking round should not run." };
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "assets",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: "x-preview-f-free",
      startVm: true,
      prompt: "Build a wired hero mesh",
    });
    try {
      const deadline = Date.now() + 4000;
      let html: string | null = null;
      let idle = false;
      while (Date.now() < deadline) {
        const fresh = await sessions.get(created.id);
        idle = fresh?.status === "idle";
        html = (await sessions.design.readCanvas(created.id)).html;
        if (idle && html?.includes("Hero mesh")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(calls).toBe(5);
      expect(html).toContain("Hero mesh");
      const fresh = await sessions.get(created.id);
      expect(fresh?.status).toBe("idle");
      expect(fresh?.messages.filter((m) => m.content === ASSET_PLAYWRIGHT_NUDGE)).toHaveLength(2);
      expect(fresh?.messages.filter((m) => m.content === ASSET_SCULPT_NUDGE)).toHaveLength(2);
      expect(fresh?.messages.some((m) => m.content === DESIGN_LOOK_NUDGE)).toBe(false);
      expect(fresh?.messages.some((m) => m.content.includes("third thinking round"))).toBe(true);
      expect(fresh?.needsHuman).toMatch(/placeholder/);
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("looks at the canvas after a successful apply_patch, then stops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let calls = 0;
    async function* engine() {
      calls += 1;
      if (calls === 1) {
        yield {
          type: "tool_call" as const,
          id: "p1",
          name: "apply_patch",
          arguments: {
            patch: [
              "*** Begin Patch",
              "*** Update File: /workspace/index.html",
              "@@",
              "-<html><head><style>:root { --bg:#111; --surface:#222; --text:#fff; --muted:#aaa; --primary:#e08; --accent:#d4c; --line: gray; }</style></head><body><p>Hi</p></body></html>",
              "+<html><head><style>:root { --bg:#111; --surface:#222; --text:#fff; --muted:#aaa; --primary:#e08; --accent:#d4c; --line: gray; }</style></head><body><p>Hello</p></body></html>",
              "*** End Patch",
            ].join("\n"),
          },
        };
        return;
      }
      if (calls === 2) {
        yield { type: "text" as const, text: "Looked at the screenshot." };
        return;
      }
      yield { type: "text" as const, text: "A third thinking round should not run." };
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: "x-preview-f-free",
      startVm: true,
    });
    try {
      await waitUntilDockerRunning(sessions, created.id);
      const wrote = await sessions.executeTool(created.id, {
        name: "file_write",
        args: {
          path: DESIGN_CANVAS_PATH,
          content:
            "<html><head><style>:root { --bg:#111; --surface:#222; --text:#fff; --muted:#aaa; --primary:#e08; --accent:#d4c; --line: gray; }</style></head><body><p>Hi</p></body></html>\n",
        },
      });
      expect(wrote.ok).toBe(true);
      await sessions.sendChat(created.id, "Say Hello");
      const deadline = Date.now() + 4000;
      let html: string | null = null;
      let idle = false;
      while (Date.now() < deadline) {
        const fresh = await sessions.get(created.id);
        idle = fresh?.status === "idle";
        html = (await sessions.design.readCanvas(created.id)).html;
        if (idle && html?.includes("Hello")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(calls).toBe(3);
      expect(html).toContain("Hello");
      expect(idle).toBe(true);
      const fresh = await sessions.get(created.id);
      expect(fresh?.messages.filter((m) => m.content === DESIGN_LOOK_NUDGE)).toHaveLength(2);
      expect(fresh?.messages.some((m) => m.content.includes("third thinking round"))).toBe(true);
      expect(
        fresh?.messages.some(
          (m) =>
            m.hidden &&
            m.content.startsWith("Design canvas snapshot") &&
            m.content.includes("--bg"),
        ),
      ).toBe(true);
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("requires a canvas edit on design follow-ups instead of ending on chat", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    const choices: Array<string | undefined> = [];
    let calls = 0;
    async function* engine(req: { toolChoice?: "auto" | "required" }) {
      calls += 1;
      choices.push(req.toolChoice);
      if (calls === 1) {
        yield { type: "text" as const, text: "Adding the 25% chip now." };
        return;
      }
      if (calls === 2) {
        yield { type: "text" as const, text: "Still describing the chip." };
        return;
      }
      if (calls === 3) {
        yield {
          type: "tool_call" as const,
          id: "w1",
          name: "file_write",
          arguments: {
            path: DESIGN_CANVAS_PATH,
            content: "<html><body><button>15%</button><button>25%</button></body></html>",
          },
        };
        return;
      }
      yield { type: "text" as const, text: "Done — 25% chip is on the canvas." };
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: "x-preview-f-free",
      startVm: true,
    });
    try {
      await waitUntilDockerRunning(sessions, created.id);
      const wrote = await sessions.executeTool(created.id, {
        name: "file_write",
        args: {
          path: DESIGN_CANVAS_PATH,
          content: "<html><body><button>15%</button></body></html>",
        },
      });
      expect(wrote.ok).toBe(true);
      await sessions.sendChat(created.id, "Add a 25% tip chip");
      const deadline = Date.now() + 4000;
      let html: string | null = null;
      let idle = false;
      let nudged = false;
      while (Date.now() < deadline) {
        const fresh = await sessions.get(created.id);
        idle = fresh?.status === "idle";
        nudged = Boolean(
          fresh?.messages.some(
            (m) => m.role === "system" && m.content === DESIGN_MUTATE_NUDGE && m.hidden,
          ),
        );
        html = (await sessions.design.readCanvas(created.id)).html;
        if (idle && html?.includes("25%")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(nudged).toBe(true);
      expect(
        (await sessions.get(created.id))?.messages.filter((m) => m.content === DESIGN_MUTATE_NUDGE),
      ).toHaveLength(2);
      expect(choices[0]).toBe("required");
      expect(html).toContain("25%");
      expect(idle).toBe(true);
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("does not bury the start prompt under a Container is ready note", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* engine() {
      await gate;
      yield {
        type: "tool_call" as const,
        id: "w1",
        name: "file_write",
        arguments: {
          path: "/workspace/index.html",
          content: "<html><body><h1>Deck</h1></body></html>",
        },
      };
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: "x-preview-f-free",
      startVm: true,
      prompt: "Design a six-slide pitch deck",
    });
    try {
      const deadline = Date.now() + 2000;
      let fresh = await sessions.get(created.id);
      while (Date.now() < deadline) {
        fresh = await sessions.get(created.id);
        if (fresh?.messages.some((m) => m.role === "assistant")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await new Promise((r) => setTimeout(r, 250));
      fresh = await sessions.get(created.id);
      const last = fresh?.messages[fresh.messages.length - 1];
      const readyIdx =
        fresh?.messages.findIndex(
          (m) => m.role === "system" && m.content === "Container is ready.",
        ) ?? -1;
      const assistantIdx = fresh?.messages.findIndex((m) => m.role === "assistant") ?? -1;
      expect(
        fresh?.messages.some((m) => m.role === "user" && m.content.includes("pitch deck")),
      ).toBe(true);
      expect(assistantIdx).toBeGreaterThan(-1);
      expect(readyIdx).toBe(-1);
      expect(last?.content).not.toBe("Container is ready.");
      expect(last?.role).toBe("assistant");
    } finally {
      release();
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("rewrites OpenCode timeout aborts into a readable design error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    async function* engine() {
      yield { type: "activity" as const };
      throw Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      });
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: "x-preview-f-free",
      startVm: true,
    });
    try {
      await sessions.sendChat(created.id, "Design a landing page");
      const deadline = Date.now() + 4000;
      let text = "";
      while (Date.now() < deadline) {
        const fresh = await sessions.get(created.id);
        text = fresh?.messages.find((m) => m.role === "assistant")?.content ?? "";
        if (text.includes("timed out") && fresh?.status === "idle") break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(text).toContain("timed out");
      expect(text).not.toContain("The operation was aborted due to timeout");
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("auto-starts Docker and lands the start prompt without a second Start click", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let calls = 0;
    async function* engine() {
      calls += 1;
      if (calls === 1) {
        yield { type: "text" as const, text: "The container is not ready yet." };
        return;
      }
      yield {
        type: "tool_call" as const,
        id: "w1",
        name: "file_write",
        arguments: {
          path: "/workspace/index.html",
          content: "<html><body><h1>One-pager</h1></body></html>",
        },
      };
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: false,
      prompt: "Design a print-like one-pager",
    });
    try {
      const deadline = Date.now() + 4000;
      let html: string | null = null;
      while (Date.now() < deadline) {
        html = (await sessions.design.readCanvas(created.id)).html;
        if (html?.includes("One-pager")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(html).toContain("One-pager");
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("writes a design canvas when the model puts HTML in chat instead of file_write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    async function* engine() {
      yield {
        type: "text" as const,
        text: "Here is the draft:\n```html\n<html><body><h1>Deck</h1></body></html>\n```",
      };
    }
    const hypervisor = new MockHypervisor(dir);
    const docker = new MockDockerEngine(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    try {
      await sessions.sendChat(created.id, "Design a six-slide deck");
      const deadline = Date.now() + 4000;
      let html: string | null = null;
      while (Date.now() < deadline) {
        html = (await sessions.design.readCanvas(created.id)).html;
        if (html?.includes("Deck")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(html).toContain("Deck");
    } finally {
      await sessions.abortChat(created.id).catch(() => undefined);
      hypervisor.shutdown();
    }
  });

  it("marks the session as error when a background Docker start fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    class FailDocker extends MockDockerEngine {
      override async start(_id: string): Promise<VmInstance> {
        throw new Error("image build failed");
      }
    }
    const docker = new FailDocker(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), undefined, undefined, docker);
    const app = createApp({ store, sessions, hypervisor });
    const config = await store.loadConfig();
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "locus/agent",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    await sessions.startVm(session.id).catch(() => undefined);
    const deadline = Date.now() + 1000;
    let saved = await sessions.get(session.id);
    while (saved?.status !== "error" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      saved = await sessions.get(session.id);
    }
    expect(saved?.status).toBe("error");
    expect(saved?.error).toMatch(/image build failed/);
    hypervisor.shutdown();
  });

  it("starts a container without an ISO and offers Chromium tools", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const ubuntu = config.templates.find((t) => t.os === "ubuntu")!;
    ubuntu.isoPath = "";
    await ctx.store.saveConfig(config);
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: ubuntu.id,
        runtime: "docker",
        dockerImage: "node:22-bookworm",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.runtime).toBe("docker");
    expect(session.dockerImage).toBe("node:22-bookworm");
    expect(session.title).toContain("node:22-bookworm");
    expect(session.vmId).toBeTruthy();
    const vms = (await (await ctx.app.request("/api/vms")).json()) as {
      id: string;
      runtime?: string;
      dockerImage?: string;
    }[];
    expect(
      vms.some(
        (vm) =>
          vm.id === session.vmId &&
          vm.runtime === "docker" &&
          vm.dockerImage === "node:22-bookworm",
      ),
    ).toBe(true);
    const tools = (await (await ctx.app.request("/api/tools/ubuntu?runtime=docker")).json()) as {
      name: string;
    }[];
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "exec",
        "git_commit",
        "file_read",
        "preview",
        "screenshot",
        "record_screen",
        "browser_console",
      ]),
    );
    expect(tools.map((t) => t.name)).not.toContain("jira_search");
    expect(tools.map((t) => t.name)).not.toContain("slack_post");
    await waitUntilDockerRunning(ctx.sessions, session.id);
    const exec = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "exec", args: { command: "pwd" } }),
    });
    expect(exec.status).toBe(200);
    const shot = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "screenshot", args: {} }),
    });
    expect(shot.status).toBe(200);
    const record = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "record_screen", args: { mode: "START_RECORDING" } }),
    });
    expect(record.status).toBe(200);
    expect(((await record.json()) as { output: string }).output).toBe("recording started");
    const image = await ctx.app.request(`/api/sessions/${session.id}/images`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ws" }),
    });
    expect(image.status).toBe(201);
    const saved = (await image.json()) as { runtime?: string; dockerImage?: string };
    expect(saved.runtime).toBe("docker");
    expect(saved.dockerImage).toBe("node:22-bookworm");

    await ctx.sessions.sendChat(session.id, "hi");
    const deadline = Date.now() + 4000;
    let fresh = await ctx.sessions.get(session.id);
    while (Date.now() < deadline) {
      fresh = await ctx.sessions.get(session.id);
      if (fresh?.status !== "running" && fresh?.messages.some((m) => m.role === "user")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.checkpoint || fresh?.checkpoints?.length).toBeTruthy();
    const rewound = await ctx.app.request(`/api/sessions/${session.id}/rewind`, { method: "POST" });
    expect(rewound.status).toBe(200);

    const forkedRes = await ctx.app.request(`/api/sessions/${session.id}/fork`, { method: "POST" });
    expect(forkedRes.status).toBe(201);
    const forked = (await forkedRes.json()) as AgentSession;
    expect(forked.runtime).toBe("docker");
    expect(forked.dockerImage).toBe("node:22-bookworm");

    const win = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "windows-11",
        templateId: config.templates.find((t) => t.os === "windows-11")!.id,
        runtime: "docker",
        dockerImage: "ubuntu:24.04",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    expect(win.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("lists Docker containers and can stop, restart, and pull logs", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: "docker",
        runtime: "docker",
        dockerImage: "node:22-bookworm",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    await waitUntilDockerRunning(ctx.sessions, session.id);
    const listed = (await (await ctx.app.request("/api/docker/containers")).json()) as {
      kind: string;
      containers: DockerContainer[];
    };
    expect(listed.kind).toBe("mock");
    const row = listed.containers.find((item) => item.vmId === session.vmId);
    expect(row).toMatchObject({
      locus: true,
      sessionId: session.id,
      image: "node:22-bookworm",
      state: "running",
    });
    const logs = (await (
      await ctx.app.request(`/api/docker/containers/${row!.id}/logs`)
    ).json()) as { text: string };
    expect(logs.text).toMatch(/running/);
    const stats = (await (
      await ctx.app.request(`/api/docker/containers/${row!.id}/stats`)
    ).json()) as DockerContainerStats;
    expect(stats.running).toBe(true);
    expect(stats.cpuPercent).toBe(1.2);
    expect(stats.memoryUsage).toBe("12.0MiB");
    const stopped = (await (
      await ctx.app.request(`/api/docker/containers/${row!.id}/stop`, { method: "POST" })
    ).json()) as DockerContainer;
    expect(stopped.state).toBe("stopped");
    const restarted = (await (
      await ctx.app.request(`/api/docker/containers/${row!.id}/restart`, { method: "POST" })
    ).json()) as DockerContainer;
    expect(["running", "created", "restarting"]).toContain(restarted.state);
    await waitUntilDockerRunning(ctx.sessions, session.id);
    const missing = await ctx.app.request("/api/docker/containers/missing/stop", {
      method: "POST",
    });
    expect(missing.status).toBe(404);
    const bad = await ctx.app.request("/api/docker/containers/bad%3Bid/logs");
    expect(bad.status).toBe(400);
    const badStats = await ctx.app.request("/api/docker/containers/bad%3Bid/stats");
    expect(badStats.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("exposes Docker Swarm inventory on the mock engine", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const listed = (await (await ctx.app.request("/api/docker/swarm")).json()) as {
      kind: string;
      info: { state: string };
      services: unknown[];
    };
    expect(listed.kind).toBe("mock");
    expect(listed.info.state).toBe("inactive");
    expect(listed.services).toEqual([]);
    const missing = await ctx.app.request("/api/docker/swarm/services/missing");
    expect(missing.status).toBe(404);
    const badScale = await ctx.app.request("/api/docker/swarm/services/web/scale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ replicas: -1 }),
    });
    expect(badScale.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("stops several Docker containers in one request", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const body = {
      os: "ubuntu" as const,
      templateId: "docker",
      runtime: "docker" as const,
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    };
    const first = (await (
      await ctx.app.request("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json()) as AgentSession;
    const second = (await (
      await ctx.app.request("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json()) as AgentSession;
    await waitUntilDockerRunning(ctx.sessions, first.id);
    await waitUntilDockerRunning(ctx.sessions, second.id);
    const listed = (await (await ctx.app.request("/api/docker/containers")).json()) as {
      containers: DockerContainer[];
    };
    const rows = listed.containers.filter(
      (item) => item.vmId === first.vmId || item.vmId === second.vmId,
    );
    expect(rows).toHaveLength(2);
    const invalid = await ctx.app.request("/api/docker/containers/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(invalid.status).toBe(400);
    const unsafe = await ctx.app.request("/api/docker/containers/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["bad;id"] }),
    });
    expect(unsafe.status).toBe(400);
    const result = (await (
      await ctx.app.request("/api/docker/containers/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...rows.map((item) => item.id), "missing"] }),
      })
    ).json()) as DockerBulkStopResult;
    expect(result.stopped.map((item) => item.id).sort()).toEqual(
      rows.map((item) => item.id).sort(),
    );
    expect(result.stopped.every((item) => item.state === "stopped")).toBe(true);
    expect(result.errors).toEqual([{ id: "missing", error: "Container not found" }]);
    ctx.hypervisor.shutdown();
  });

  it("creates a host agent without a VM or container", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.runtime).toBe("host");
    expect(session.kind).toBeUndefined();
    expect(session.status).toBe("idle");
    expect(session.vmId).toBeFalsy();
    expect(session.title).toBe("Host agent");
    expect(ctx.sessions.listMachines()).toEqual([]);

    const tools = (await (await ctx.app.request("/api/tools/ubuntu?runtime=host")).json()) as {
      name: string;
    }[];
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["exec", "file_write", "git_pr", "git_pr_list", "screenshot"]),
    );
    expect(tools.map((t) => t.name)).toContain("browser_snapshot");
    expect(tools.map((t) => t.name)).toContain("preview");
    expect(tools.map((t) => t.name)).toContain("playwright");

    const codingPreview = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "preview", args: {} }),
    });
    expect(codingPreview.status).toBe(200);
    expect((await codingPreview.json()) as { ok: boolean; output: string }).toMatchObject({
      ok: false,
    });
    const codingPlaywright = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "playwright", args: { expect_text: "Hi" } }),
    });
    expect(codingPlaywright.status).toBe(200);
    const codingPlaywrightBody = (await codingPlaywright.json()) as { ok: boolean; output: string };
    expect(codingPlaywrightBody.ok).toBe(false);
    expect(codingPlaywrightBody.output).toMatch(/url|preview/i);

    const codingPlaywrightUrl = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "playwright",
        args: { url: "http://127.0.0.1:9/", expect_text: "Hi" },
      }),
    });
    expect(codingPlaywrightUrl.status).toBe(200);
    const codingPlaywrightUrlBody = (await codingPlaywrightUrl.json()) as {
      ok: boolean;
      output: string;
    };
    expect(codingPlaywrightUrlBody.output).not.toMatch(/Design agents/);
    expect(codingPlaywrightUrlBody.output).toMatch(/static|not reachable|Chrome/i);

    const start = await ctx.app.request(`/api/sessions/${session.id}/vm/start`, { method: "POST" });
    expect(start.status).toBe(400);
    expect(((await start.json()) as { error: string }).error).toMatch(
      /Host agents do not have a VM or container/,
    );

    const wrote = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "file_write",
        args: { path: "/workspace/hello.txt", content: "from host" },
      }),
    });
    expect(wrote.status).toBe(200);
    expect((await wrote.json()) as { ok: boolean }).toMatchObject({ ok: true });
    expect(await readFile(join(ctx.dir, "host-workspaces", session.id, "hello.txt"), "utf8")).toBe(
      "from host",
    );

    const escaped = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "file_write",
        args: { path: "/tmp/locus-host-jail.txt", content: "nope" },
      }),
    });
    expect(escaped.status).toBe(200);
    expect(((await escaped.json()) as { ok: boolean; output: string }).ok).toBe(false);

    const exec = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "exec", args: { command: "pwd" } }),
    });
    expect(exec.status).toBe(200);
    const execBody = (await exec.json()) as { ok: boolean; output: string };
    expect(execBody.ok).toBe(true);
    expect(execBody.output).toContain(`host-workspaces/${session.id}`);

    await ctx.sessions.sendChat(session.id, "hello");
    const deadline = Date.now() + 4000;
    let fresh = await ctx.sessions.get(session.id);
    while (Date.now() < deadline) {
      fresh = await ctx.sessions.get(session.id);
      if (
        fresh?.status !== "running" &&
        fresh?.messages.some((m) => m.role === "assistant" && m.content.trim())
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.status).toBe("idle");
    expect(fresh?.messages.some((m) => m.role === "user" && m.content === "hello")).toBe(true);
    expect(fresh?.messages.some((m) => m.content.includes("Host agent"))).toBe(true);
    expect(ctx.sessions.listMachines()).toEqual([]);
    expect(fresh?.vmId).toBeFalsy();

    const design = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "design",
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    expect(design.status).toBe(201);
    const designBody = (await design.json()) as AgentSession;
    expect(designBody.kind).toBe("design");
    expect(designBody.runtime).toBe("host");
    expect(designBody.vmId).toBeFalsy();
    const emptyPlaywright = await ctx.app.request(`/api/sessions/${designBody.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "playwright", args: { expect_text: "Hi" } }),
    });
    expect(emptyPlaywright.status).toBe(200);
    const emptyPlaywrightBody = (await emptyPlaywright.json()) as { ok: boolean; output: string };
    expect(emptyPlaywrightBody.ok).toBe(false);
    expect(emptyPlaywrightBody.output).toMatch(/empty/);
    const ws = join(ctx.dir, "host-workspaces", designBody.id);
    await mkdir(join(ws, "vendor"), { recursive: true });
    await writeFile(
      join(ws, "index.html"),
      `<!DOCTYPE html><html><body><canvas id="view"></canvas>
<script type="module">import * as THREE from './vendor/three.module.js';</script>
</body></html>`,
    );
    await writeFile(join(ws, "vendor", "three.module.js"), "export const REVISION = '186';\n");
    const page = await ctx.app.request(`/api/sessions/${designBody.id}/canvas-files/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("access-control-allow-origin")).toBe("*");
    expect(page.headers.get("content-security-policy")).toBeNull();
    const html = await page.text();
    expect(html).toContain("data-locus-preview-guard");
    expect(html).toContain("./vendor/three.module.js");
    const vendor = await ctx.app.request(
      `/api/sessions/${designBody.id}/canvas-files/vendor/three.module.js`,
    );
    expect(vendor.status).toBe(200);
    expect(vendor.headers.get("access-control-allow-origin")).toBe("*");
    expect(vendor.headers.get("content-security-policy")).toBeNull();
    expect(await vendor.text()).toContain("REVISION");
    const previewHost = { host: "locus-canvas.localhost:7420" };
    const isolated = await ctx.app.request(`/api/sessions/${designBody.id}/canvas-files/`, {
      headers: previewHost,
    });
    expect(isolated.status).toBe(200);
    expect(await isolated.text()).toContain("./vendor/three.module.js");
    const isolatedApi = await ctx.app.request("/api/config", { headers: previewHost });
    expect(isolatedApi.status).toBe(404);
    const preview = await ctx.app.request(`/api/sessions/${designBody.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "preview", args: {} }),
    });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { ok: boolean; output: string };
    expect(previewBody.ok).toBe(true);
    expect(previewBody.output).toMatch(/canvas-files/);
    expect(previewBody.output).toMatch(/npx serve/);
    const playwright = await ctx.app.request(`/api/sessions/${designBody.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "playwright", args: { expect_text: "canvas" } }),
    });
    expect(playwright.status).toBe(200);
    const playwrightBody = (await playwright.json()) as { ok: boolean; output: string };
    expect(playwrightBody.ok).toBe(true);
    expect(playwrightBody.output).toMatch(/expect canvas/);
    const aliasedWrite = await ctx.app.request(`/api/sessions/${designBody.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "write",
        args: { path: "/workspace/_probe.mjs", content: "export {}\n" },
      }),
    });
    expect(aliasedWrite.status).toBe(200);
    expect((await aliasedWrite.json()) as { ok: boolean; output?: string }).toMatchObject({
      ok: true,
    });
    expect(await readFile(join(ws, "_probe.mjs"), "utf8")).toBe("export {}\n");
    const skill = await ctx.app.request(`/api/sessions/${designBody.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "read_skill", args: { name: "ops-research" } }),
    });
    expect(skill.status).toBe(200);
    const skillBody = (await skill.json()) as { ok: boolean; output: string };
    expect(skillBody.ok).toBe(true);
    expect(skillBody.output).not.toMatch(/not allowed for this agent/i);
    expect(skillBody.output).toMatch(/skill/i);
    await ctx.app.request(`/api/sessions/${designBody.id}`, { method: "DELETE" });

    const deleted = await ctx.app.request(`/api/sessions/${session.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(existsSync(join(ctx.dir, "host-workspaces", session.id))).toBe(false);
    ctx.hypervisor.shutdown();
  });

  it("creates an IDE workspace as a host session with kind ide", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        kind: "ide",
        runtime: "docker",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
        vision: "latest",
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.kind).toBe("ide");
    expect(session.runtime).toBe("host");
    expect(session.vision).toBe("off");
    expect(session.status).toBe("idle");
    expect(session.vmId).toBeFalsy();
    expect(session.title).toBe("Workspace");
    expect(ctx.sessions.listMachines()).toEqual([]);
    ctx.hypervisor.shutdown();
  });

  it("titles a host agent from the first chat prompt and keeps a rename", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.title).toBe("Host agent");

    const chat = await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Fix the login form validation" }),
    });
    expect(chat.status).toBe(200);
    expect((await ctx.sessions.get(session.id))?.title).toBe("Fix the login form validation");
    await ctx.app.request(`/api/sessions/${session.id}/chat/abort`, { method: "POST" });

    const renamed = await ctx.app.request(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Auth work" }),
    });
    expect(renamed.status).toBe(200);
    const follow = await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Also write tests" }),
    });
    expect(follow.status).toBe(200);
    expect((await ctx.sessions.get(session.id))?.title).toBe("Auth work");
    await ctx.app.request(`/api/sessions/${session.id}/chat/abort`, { method: "POST" });
    ctx.hypervisor.shutdown();
  });

  it("titles a new agent from the create prompt", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
        prompt: "Ship the landing page",
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.title).toBe("Ship the landing page");
    await ctx.app.request(`/api/sessions/${session.id}/chat/abort`, { method: "POST" });
    ctx.hypervisor.shutdown();
  });

  it.skipIf(process.platform === "win32")("creates a host agent in a chosen folder", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const folder = await mkdtemp(join(tmpdir(), "locus-host-pick-"));
    cleanup.push(folder);
    await mkdir(join(folder, "src"));
    await writeFile(join(folder, "src", "app.ts"), "export {}\n");
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        hostDir: folder,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.hostDir).toBe(await realpath(folder));

    const wrote = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "file_write",
        args: { path: "/workspace/hello.txt", content: "from folder" },
      }),
    });
    expect(wrote.status).toBe(200);
    expect(await readFile(join(folder, "hello.txt"), "utf8")).toBe("from folder");

    const exec = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "exec", args: { command: "pwd" } }),
    });
    expect(((await exec.json()) as { ok: boolean; output: string }).output).toContain(
      session.hostDir!,
    );

    const tree = await ctx.app.request(`/api/sessions/${session.id}/workspace?depth=1`);
    expect(tree.status).toBe(200);
    const treeBody = (await tree.json()) as { entries: Array<{ path: string; type: string }> };
    expect(treeBody.entries.map((row) => row.path)).toEqual(
      expect.arrayContaining(["src", "hello.txt"]),
    );
    expect(treeBody.entries.map((row) => row.path)).not.toContain("src/app.ts");

    const index = await ctx.app.request(`/api/sessions/${session.id}/workspace/index`);
    expect(index.status).toBe(200);
    expect(await index.json()).toMatchObject({ status: expect.stringMatching(/idle|ready/) });

    const listed = await ctx.app.request(`/api/host/browse?path=${encodeURIComponent(folder)}`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      path: await realpath(folder),
      entries: [{ name: "src" }],
    });

    const saved = await ctx.app.request("/api/host/save-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dir: folder,
        filename: "hero.stl",
        contentBase64: Buffer.from("solid mesh\n").toString("base64"),
      }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      path: join(await realpath(folder), "hero.stl"),
      bytes: 11,
    });
    const escaped = await ctx.app.request("/api/host/save-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dir: folder,
        filename: "../escape.stl",
        contentBase64: Buffer.from("nope").toString("base64"),
      }),
    });
    expect(escaped.status).toBe(400);

    const relative = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        hostDir: "relative/path",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    expect(relative.status).toBe(400);

    const root = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        hostDir: "/",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    expect(root.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("runs the start prompt on a host chat without parking as draft", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
        prompt: "What is Locus?",
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.runtime).toBe("host");
    expect(session.vmId).toBeFalsy();
    expect(
      session.messages.some((m) => m.role === "user" && m.content.includes("What is Locus?")),
    ).toBe(true);
    const deadline = Date.now() + 4000;
    let fresh = await ctx.sessions.get(session.id);
    while (Date.now() < deadline) {
      fresh = await ctx.sessions.get(session.id);
      if (
        fresh?.status === "idle" &&
        fresh.messages.some((m) => m.role === "assistant" && m.content.trim())
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.status).toBe("idle");
    expect(fresh?.messages.some((m) => m.content.includes("Host agent"))).toBe(true);
    expect(fresh?.vmId).toBeFalsy();
    expect(ctx.sessions.listMachines()).toEqual([]);
    ctx.hypervisor.shutdown();
  });

  it("never calls Docker create when a host chat starts with a prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-no-docker-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    class SpyDocker extends MockDockerEngine {
      creates = 0;
      override async create(req: Parameters<MockDockerEngine["create"]>[0]) {
        this.creates += 1;
        return super.create(req);
      }
    }
    const docker = new SpyDocker(dir);
    const hub = new Hub();
    const sessions = new SessionService(store, hypervisor, hub, undefined, undefined, docker);
    const app = createApp({ store, sessions, hypervisor });
    const config = await store.loadConfig();
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
        prompt: "What is Locus?",
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.runtime).toBe("host");
    expect(session.vmId).toBeFalsy();
    const deadline = Date.now() + 4000;
    let fresh = await sessions.get(session.id);
    while (Date.now() < deadline) {
      fresh = await sessions.get(session.id);
      if (
        fresh?.status === "idle" &&
        fresh.messages.some((m) => m.role === "assistant" && m.content.trim())
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.status).toBe("idle");
    expect(docker.creates).toBe(0);
    expect(docker.list()).toEqual([]);
    expect(sessions.listMachines()).toEqual([]);
    hypervisor.shutdown();
  });

  it("offers Jira, Confluence, Slack, and Grafana tools only when those integrations have tokens", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "node:22-bookworm",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    const blocked = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "jira_search", args: { jql: "project = OPS" } }),
    });
    expect(blocked.status).toBe(400);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/Integrations/);

    await ctx.store.saveConfig({
      ...config,
      integrations: [
        {
          id: "j1",
          kind: "jira",
          name: "Jira",
          enabled: true,
          baseUrl: "https://acme.atlassian.net",
          token: "mail:tok",
        },
      ],
    });
    const tools = (await (await ctx.app.request("/api/tools/ubuntu?runtime=docker")).json()) as {
      name: string;
    }[];
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "jira_search",
        "jira_get",
        "jira_comment",
        "jira_create",
        "jira_update",
        "jira_transition",
      ]),
    );
    expect(names).not.toContain("confluence_search");
    expect(names).not.toContain("slack_post");
    expect(names).not.toContain("grafana_search");
    ctx.hypervisor.shutdown();
  });

  it("proxies a Docker app preview from the workspace", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    await new Promise((r) => setTimeout(r, 250));
    const empty = await ctx.app.request(`/api/sessions/${created.id}/preview`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ ports: [] });

    const vm = ctx.sessions.getMachine(created.vmId!);
    expect(vm?.diskPath).toBeTruthy();
    await writeFile(join(vm!.diskPath, "index.html"), "<html><body>hello preview</body></html>");

    const opened = await ctx.app.request(`/api/sessions/${created.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "preview", args: { port: 5173, path: "/" } }),
    });
    expect(opened.status).toBe(200);
    expect(((await opened.json()) as { ok: boolean; output: string }).ok).toBe(true);

    const status = await ctx.app.request(`/api/sessions/${created.id}/preview`);
    expect(await status.json()).toMatchObject({
      ports: [5173],
      active: { port: 5173, path: "/", url: `/api/sessions/${created.id}/preview-http/5173/` },
    });

    const page = await ctx.app.request(`/api/sessions/${created.id}/preview-http/5173/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("hello preview");

    const blocked = await ctx.app.request(`/api/sessions/${created.id}/preview-http/22/`);
    expect(blocked.status).toBe(400);
    const codeServer = await ctx.app.request(`/api/sessions/${created.id}/preview-http/3999/`);
    expect(codeServer.status).toBe(400);

    const guessed = await ctx.app.request(`/api/sessions/${created.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "start_process",
        args: { command: "python3 -m http.server 8000" },
      }),
    });
    expect(guessed.status).toBe(200);
    const afterGuess = await ctx.app.request(`/api/sessions/${created.id}/preview`);
    expect(((await afterGuess.json()) as { ports: number[] }).ports).toEqual(
      expect.arrayContaining([5173, 8000]),
    );

    const agent = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const denied = await ctx.app.request(`/api/sessions/${agent.id}/preview`);
    expect(denied.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("does not advertise a live preview when the Docker container is stopped", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    await new Promise((r) => setTimeout(r, 250));
    const opened = await ctx.app.request(`/api/sessions/${created.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "preview", args: { port: 3000, path: "/" } }),
    });
    expect(opened.status).toBe(200);
    const live = await ctx.app.request(`/api/sessions/${created.id}/preview`);
    expect(await live.json()).toMatchObject({
      ports: [3000],
      active: { port: 3000, path: "/", url: `/api/sessions/${created.id}/preview-http/3000/` },
    });
    await ctx.sessions.stopVm(created.id);
    const stopped = await ctx.app.request(`/api/sessions/${created.id}/preview`);
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual({ ports: [] });
    ctx.hypervisor.shutdown();
  });

  it("stops a running Docker container before restoring a workspace checkpoint", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    const vm = ctx.sessions.getMachine(created.vmId!);
    expect(vm?.diskPath).toBeTruthy();
    await writeFile(join(vm!.diskPath, "note.txt"), "v1");
    await ctx.sessions.sendChat(created.id, "hi");
    const deadline = Date.now() + 4000;
    let fresh = await ctx.sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await ctx.sessions.get(created.id);
      if (fresh?.status !== "running" && fresh?.messages.some((m) => m.role === "user")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await writeFile(join(vm!.diskPath, "note.txt"), "v2");
    const rewound = await ctx.app.request(`/api/sessions/${created.id}/rewind`, { method: "POST" });
    expect(rewound.status).toBe(200);
    expect(await readFile(join(vm!.diskPath, "note.txt"), "utf8")).toBe("v1");
  });

  it.skipIf(process.platform === "win32")(
    "rewinds a git Docker workspace from a hidden checkpoint ref",
    async () => {
      const ctx = await setup();
      cleanup.push(ctx.dir);
      const config = await ctx.store.loadConfig();
      const created = await ctx.sessions.create({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        runtime: "docker",
        dockerImage: "node:22-bookworm",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      });
      const vm = ctx.sessions.getMachine(created.vmId!);
      const ws = vm!.diskPath;
      await execFileAsync("git", ["init"], { cwd: ws });
      await execFileAsync("git", ["config", "user.email", "locus@test"], { cwd: ws });
      await execFileAsync("git", ["config", "user.name", "Locus"], { cwd: ws });
      await writeFile(join(ws, "note.txt"), "v1\n");
      await execFileAsync("git", ["add", "."], { cwd: ws });
      await execFileAsync("git", ["commit", "-m", "one"], { cwd: ws });
      await ctx.sessions.sendChat(created.id, "hi");
      const deadline = Date.now() + 8000;
      let fresh = await ctx.sessions.get(created.id);
      while (Date.now() < deadline) {
        fresh = await ctx.sessions.get(created.id);
        if (fresh?.status !== "running" && fresh?.messages.some((m) => m.role === "user")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(fresh?.status).not.toBe("running");
      const checkpoint = fresh?.checkpoints?.at(-1);
      expect(checkpoint?.gitRef).toMatch(/refs\/locus\/checkpoints\//);
      expect(checkpoint?.diskPath).toBeUndefined();
      await writeFile(join(ws, "note.txt"), "v2\n");
      await writeFile(join(ws, "extra.ts"), "export const n = 2;\n");
      const rewound = await ctx.app.request(`/api/sessions/${created.id}/rewind`, {
        method: "POST",
      });
      expect(rewound.status).toBe(200);
      expect(await readFile(join(ws, "note.txt"), "utf8")).toBe("v1\n");
      await expect(readFile(join(ws, "extra.ts"))).rejects.toThrow();
    },
  );

  it("still copies /workspace when the guest Chromium profile exists", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    const vm = ctx.sessions.getMachine(created.vmId!);
    const ws = vm!.diskPath;
    await execFileAsync("git", ["init"], { cwd: ws });
    await execFileAsync("git", ["config", "user.email", "locus@test"], { cwd: ws });
    await execFileAsync("git", ["config", "user.name", "Locus"], { cwd: ws });
    await writeFile(join(ws, "note.txt"), "v1\n");
    await execFileAsync("git", ["add", "."], { cwd: ws });
    await execFileAsync("git", ["commit", "-m", "one"], { cwd: ws });
    await mkdir(join(ws, ".locus-chrome"), { recursive: true });
    await writeFile(join(ws, ".locus-chrome", "Cookies"), "jar");
    await ctx.sessions.sendChat(created.id, "hi");
    const deadline = Date.now() + 4000;
    let fresh = await ctx.sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await ctx.sessions.get(created.id);
      if (fresh?.status !== "running" && fresh?.messages.some((m) => m.role === "user")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const checkpoint = fresh?.checkpoints?.at(-1);
    expect(checkpoint?.gitRef).toMatch(/refs\/locus\/checkpoints\//);
    expect(checkpoint?.diskPath).toBeTruthy();
  });
});

describe("design sessions", () => {
  it("broadcasts canvas.updated after a canvas write or patch", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    await waitUntilDockerRunning(ctx.sessions, created.id);
    const events: ClientEvent[] = [];
    const sendEvent = ctx.hub.broadcast.bind(ctx.hub);
    ctx.hub.broadcast = (event: ClientEvent) => {
      events.push(event);
      sendEvent(event);
    };
    const wrote = await ctx.sessions.executeTool(created.id, {
      name: "file_write",
      args: { path: DESIGN_CANVAS_PATH, content: "<html><body><p>Hi</p></body></html>\n" },
    });
    expect(wrote.ok).toBe(true);
    expect(
      events.some((event) => event.type === "canvas.updated" && event.html.includes("Hi")),
    ).toBe(true);
    events.length = 0;
    const patched = await ctx.sessions.executeTool(created.id, {
      name: "apply_patch",
      args: {
        patch: [
          "*** Begin Patch",
          "*** Update File: /workspace/index.html",
          "@@",
          "-<html><body><p>Hi</p></body></html>",
          "+<html><body><p>Hello</p></body></html>",
          "*** End Patch",
        ].join("\n"),
      },
    });
    expect(patched.ok).toBe(true);
    expect(
      events.some((event) => event.type === "canvas.updated" && event.html.includes("Hello")),
    ).toBe(true);
  });

  it("refuses canvas text edits while a turn is running", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    await waitUntilDockerRunning(ctx.sessions, created.id);
    await ctx.sessions.executeTool(created.id, {
      name: "file_write",
      args: {
        path: DESIGN_CANVAS_PATH,
        content: '<html><body><h1 class="hero">Old</h1></body></html>\n',
      },
    });
    await ctx.store.mutateSession(created.id, (current) => {
      current.status = "running";
    });
    const denied = await ctx.app.request(`/api/sessions/${created.id}/design/edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selector: "h1.hero", text: "New" }),
    });
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ error: "Wait for the current turn to finish" });
    await ctx.store.mutateSession(created.id, (current) => {
      current.status = "idle";
    });
    const ok = await ctx.app.request(`/api/sessions/${created.id}/design/edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selector: "h1.hero", text: "New" }),
    });
    expect(ok.status).toBe(200);
    const canvas = (await (await ctx.app.request(`/api/sessions/${created.id}/canvas`)).json()) as {
      html?: string | null;
    };
    expect(canvas.html).toContain("New");
  });

  it("creates a Docker design session and serves the canvas file", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        kind: "design",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.kind).toBe("design");
    expect(session.runtime).toBe("docker");
    expect(session.title).toBe("Untitled design");
    expect(session.playbook).toBe(DESIGN_PLAYBOOK);
    expect(session.allowedTools).toEqual(DESIGN_TOOLS);
    expect(session.vision).toBe("off");
    expect(session.palette).toEqual(DEFAULT_DESIGN_PALETTE);

    const empty = await ctx.app.request(`/api/sessions/${session.id}/canvas`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ html: null, path: DESIGN_CANVAS_PATH });

    await waitUntilDockerRunning(ctx.sessions, session.id);
    const wrote = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "file_write",
        args: { path: DESIGN_CANVAS_PATH, content: "<h1>from guest</h1>" },
      }),
    });
    expect(wrote.status).toBe(200);
    const fromGuest = await ctx.app.request(`/api/sessions/${session.id}/canvas`);
    const guestCanvas = (await fromGuest.json()) as { html: string; path: string };
    expect(guestCanvas.path).toBe(DESIGN_CANVAS_PATH);
    expect(guestCanvas.html).toContain("<h1>from guest</h1>");
    expect(guestCanvas.html).toContain("--bg:");
    expect(guestCanvas.html).toContain("--line:");

    const vm = ctx.sessions.getMachine(session.vmId!);
    expect(vm?.diskPath).toBeTruthy();
    await writeFile(join(vm!.diskPath, "index.html"), "<html><body>Hello canvas</body></html>");
    const painted = await ctx.app.request(`/api/sessions/${session.id}/canvas`);
    expect(painted.status).toBe(200);
    expect(await painted.json()).toMatchObject({
      html: "<html><body>Hello canvas</body></html>",
      path: DESIGN_CANVAS_PATH,
    });
    const variant = await ctx.app.request(`/api/sessions/${session.id}/design/variants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Hero" }),
    });
    expect(variant.status).toBe(201);
    const withVariant = (await variant.json()) as AgentSession;
    expect(withVariant.designVariants?.[0]?.name).toBe("Hero");
    expect(withVariant.activeVariantId).toBeTruthy();

    const forkedRes = await ctx.app.request(`/api/sessions/${session.id}/fork`, { method: "POST" });
    expect(forkedRes.status).toBe(201);
    const forked = (await forkedRes.json()) as AgentSession;
    expect(forked.kind).toBe("design");
    expect(forked.runtime).toBe("docker");
    expect(forked.palette).toEqual(DEFAULT_DESIGN_PALETTE);

    const promoted = await ctx.app.request(`/api/sessions/${session.id}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scaffold: "vite-react" }),
    });
    expect(promoted.status).toBe(201);
    const body = (await promoted.json()) as { agent: AgentSession; design: AgentSession };
    expect(body.design.kind).toBe("design");
    expect(body.design.id).toBe(session.id);
    expect(body.design.messages.some((m) => m.content.includes("Promoted to agent"))).toBe(true);
    expect(body.agent.kind).not.toBe("design");
    expect(body.agent.sourceDesignId).toBe(session.id);
    expect(body.design.promotedAgentId).toBe(body.agent.id);
    expect(body.agent.runtime).toBe("docker");
    expect(body.agent.dockerImage).toBe("node:22-bookworm");
    expect(body.agent.imageId).toBeTruthy();
    expect(body.agent.playbook).toMatch(/Vite/);
    const images = await ctx.store.loadImages();
    const seed = images.find((row) => row.id === body.agent.imageId);
    expect(seed?.path).toBeTruthy();
    expect(await readFile(join(seed!.path, "package.json"), "utf8")).toContain("vite");
    expect(await readFile(join(seed!.path, "public", "design.html"), "utf8")).toContain(
      "Hello canvas",
    );
    expect(await readFile(join(seed!.path, "DESIGN.md"), "utf8")).toContain("# Design brief");
    expect(body.agent.playbook).toMatch(/DESIGN\.md/);
    const stillCanvas = await ctx.app.request(`/api/sessions/${session.id}/canvas`);
    expect(stillCanvas.status).toBe(200);
    expect(((await stillCanvas.json()) as { html: string }).html).toContain("Hello canvas");
    const refuse = await ctx.app.request(`/api/sessions/${body.agent.id}/promote`, {
      method: "POST",
    });
    expect(refuse.status).toBe(400);

    const recolored = await ctx.app.request(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ palette: { ...DEFAULT_DESIGN_PALETTE, primary: "#112233" } }),
    });
    expect(recolored.status).toBe(200);
    expect(((await recolored.json()) as AgentSession).palette?.primary).toBe("#112233");
    const paintedCanvas = await ctx.app.request(`/api/sessions/${session.id}/canvas`);
    expect(((await paintedCanvas.json()) as { html: string }).html).toContain("--primary: #112233");

    const agent = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      runtime: "docker",
      dockerImage: "ubuntu:24.04",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const denied = await ctx.app.request(`/api/sessions/${agent.id}/canvas`);
    expect(denied.status).toBe(400);

    const vmDesign = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        kind: "design",
        runtime: "vm",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    expect(vmDesign.status).toBe(400);

    const win = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "windows-11",
        templateId: config.templates.find((t) => t.os === "windows-11")!.id,
        kind: "design",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    expect(win.status).toBe(400);
  });

  it("clones a linked repo into a design session on boot", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const repo: LinkedRepo = {
      id: "11111111-1111-1111-1111-111111111111",
      name: "acme/app",
      checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    await ctx.store.saveRepos([repo]);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        kind: "design",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
        repoId: repo.id,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.kind).toBe("design");
    expect(session.repoId).toBe(repo.id);
    expect(session.repo?.url).toMatch(/acme\/app/);
    expect(session.allowedTools).toEqual(DESIGN_TOOLS);
    await waitUntilDockerRunning(ctx.sessions, session.id);
    const deadline = Date.now() + 2000;
    let fresh = await ctx.sessions.get(session.id);
    while (Date.now() < deadline) {
      if (fresh?.messages.some((m) => m.role === "system" && /Cloned /i.test(m.content))) break;
      await new Promise((r) => setTimeout(r, 20));
      fresh = await ctx.sessions.get(session.id);
    }
    const systemNotes = fresh?.messages.filter((m) => m.role === "system") ?? [];
    const cloningIdx = systemNotes.findIndex((m) => m.content.startsWith("Cloning "));
    const clonedIdx = systemNotes.findIndex((m) => /Cloned /i.test(m.content));
    expect(cloningIdx).toBeGreaterThanOrEqual(0);
    expect(clonedIdx).toBeGreaterThan(cloningIdx);
    expect(systemNotes[cloningIdx]?.content).toMatch(/Cloning .+acme\/app.+design context/);
    expect(fresh?.messages.map((m) => m.content).join("\n")).toMatch(
      /Cloned .+acme\/app.+(?:design|canvas) context/,
    );
    expect(fresh?.messages.some((m) => /not allowed for this agent/i.test(m.content))).toBe(false);
    const blocked = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "git_clone",
        args: { url: "https://github.com/other/repo" },
      }),
    });
    expect(blocked.status).toBe(400);
    expect(((await blocked.json()) as { error?: string }).error).toMatch(/not allowed/i);
  });

  it("clones extra linked repos into /workspace/<name>", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const appRepo: LinkedRepo = {
      id: "11111111-1111-1111-1111-111111111111",
      name: "acme/app",
      checkout: { forge: "github", url: "https://github.com/acme/app.git" },
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const libRepo: LinkedRepo = {
      id: "22222211-1111-1111-1111-111111111111",
      name: "acme/lib",
      checkout: { forge: "github", url: "https://github.com/acme/lib.git" },
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    await ctx.store.saveRepos([appRepo, libRepo]);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        runtime: "docker",
        dockerImage: "ubuntu:24.04",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
        repoId: appRepo.id,
        extraRepoIds: [libRepo.id],
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    expect(session.repo?.url).toMatch(/acme\/app/);
    expect(session.repo?.dest).toBe("/workspace/app");
    expect(session.extraRepos?.map((row) => row.dest)).toEqual(["/workspace/lib"]);
    await waitUntilDockerRunning(ctx.sessions, session.id);
    const deadline = Date.now() + 3000;
    let fresh = await ctx.sessions.get(session.id);
    while (Date.now() < deadline) {
      const notes = fresh?.messages.filter((m) => m.role === "system").map((m) => m.content) ?? [];
      if (
        notes.some((m) => /Cloned .+acme\/app.+\/workspace\/app/.test(m)) &&
        notes.some((m) => /Cloned .+acme\/lib.+\/workspace\/lib/.test(m))
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
      fresh = await ctx.sessions.get(session.id);
    }
    const notes =
      fresh?.messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n") ?? "";
    expect(notes).toMatch(/Cloned .+acme\/app.+\/workspace\/app/);
    expect(notes).toMatch(/Cloned .+acme\/lib.+\/workspace\/lib/);
  });

  it("defaults workspace git to the primary dest and honors ?dest=", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const folder = await mkdtemp(join(tmpdir(), "locus-host-git-dests-"));
    cleanup.push(folder);
    const gitEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    };
    async function initRepo(dir: string, file: string, content: string) {
      await mkdir(dir, { recursive: true });
      await execFileAsync("git", ["init", "-b", "main"], { cwd: dir, env: gitEnv });
      await execFileAsync("git", ["config", "user.email", "locus@test"], { cwd: dir, env: gitEnv });
      await execFileAsync("git", ["config", "user.name", "Locus"], { cwd: dir, env: gitEnv });
      await writeFile(join(dir, file), content);
      await execFileAsync("git", ["add", "."], { cwd: dir, env: gitEnv });
      await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir, env: gitEnv });
    }
    await initRepo(join(folder, "app"), "app.ts", "export const app = 1;\n");
    await initRepo(join(folder, "lib"), "lib.ts", "export const lib = 1;\n");
    await writeFile(join(folder, "lib", "lib.ts"), "export const lib = 2;\n");
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        hostDir: folder,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    await ctx.store.mutateSession(session.id, (current) => {
      current.repo = {
        forge: "github",
        url: "https://github.com/acme/app.git",
        dest: "/workspace/app",
      };
      current.extraRepos = [
        { forge: "github", url: "https://github.com/acme/lib.git", dest: "/workspace/lib" },
      ];
    });

    const git = await ctx.app.request(`/api/sessions/${session.id}/workspace/git`);
    expect(git.status).toBe(200);
    const status = (await git.json()) as {
      dest?: string;
      dests?: Array<{ dest: string }>;
      files: Array<{ path: string }>;
    };
    expect(status.dest).toBe("app");
    expect(status.dests?.map((row) => row.dest)).toEqual(["app", "lib"]);
    expect(status.files).toEqual([]);

    const lib = await ctx.app.request(`/api/sessions/${session.id}/workspace/git?dest=lib`);
    expect(lib.status).toBe(200);
    const libStatus = (await lib.json()) as {
      dest?: string;
      files: Array<{ path: string }>;
    };
    expect(libStatus.dest).toBe("lib");
    expect(libStatus.files.map((row) => row.path)).toContain("lib.ts");

    const tree = await ctx.app.request(`/api/sessions/${session.id}/workspace`);
    expect(tree.status).toBe(200);
    const listed = (await tree.json()) as { changes?: Array<{ path: string }> };
    expect(listed.changes?.map((row) => row.path)).toContain("lib/lib.ts");

    const file = await ctx.app.request(
      `/api/sessions/${session.id}/workspace/file?path=${encodeURIComponent("lib/lib.ts")}`,
    );
    expect(file.status).toBe(200);
    expect(await file.json()).toMatchObject({
      path: "lib/lib.ts",
      content: "export const lib = 2;\n",
      baseline: "export const lib = 1;\n",
    });
    ctx.hypervisor.shutdown();
  });

  it("paints the design canvas while file_write arguments stream", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.providers = config.providers.map((p, i) =>
      i === 0 ? { ...p, apiKey: "sk-test-canvas", enabled: true } : p,
    );
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* engine() {
      yield {
        type: "tool_call_delta" as const,
        id: "c1",
        name: "file_write",
        argumentsRaw: `{"path":"/workspace/index.html","content":"<!doctype html><html><body><h1>Draft deck"}`,
      };
      await gate;
      yield { type: "text" as const, text: "First draft is on the canvas." };
    }
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const app = createApp({ store, sessions, hypervisor });
    try {
      const created = await app.request("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          os: "ubuntu",
          templateId: config.templates[0]!.id,
          kind: "design",
          providerId: config.providers[0]!.id,
          model: config.providers[0]!.defaultModel,
          startVm: true,
        }),
      });
      const session = (await created.json()) as AgentSession;
      await waitUntilDockerRunning(sessions, session.id);
      await sessions.sendChat(session.id, "make a deck");
      const deadline = Date.now() + 4000;
      let html = "";
      while (Date.now() < deadline) {
        const canvas = (await (await app.request(`/api/sessions/${session.id}/canvas`)).json()) as {
          html?: string | null;
        };
        html = canvas.html ?? "";
        if (html.includes("Draft deck")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(html).toContain("Draft deck");
      expect(html).not.toContain("Done");
      release();
      const after = Date.now() + 4000;
      while (Date.now() < after) {
        const fresh = await sessions.get(session.id);
        if (
          fresh?.status === "idle" &&
          fresh.messages.some((m) => m.content.includes("First draft"))
        )
          break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const done = await sessions.get(session.id);
      expect(done?.status).toBe("idle");
      expect(done?.messages.some((m) => m.content.includes("First draft"))).toBe(true);
      const canvas = (await (await app.request(`/api/sessions/${session.id}/canvas`)).json()) as {
        html?: string | null;
      };
      expect(canvas.html).toContain("Draft deck");
    } finally {
      release();
      hypervisor.shutdown();
    }
  });

  it("records a structured canvas comment without starting a turn", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        kind: "design",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    const session = (await created.json()) as AgentSession;
    const posted = await ctx.app.request(`/api/sessions/${session.id}/design-comment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selector: "h1.hero", text: "Hello", viewport: "phone" }),
    });
    expect(posted.status).toBe(200);
    const body = (await posted.json()) as AgentSession;
    expect(body.status).not.toBe("running");
    const msg = body.messages.find(
      (m) => m.role === "user" && m.content.includes("selector: h1.hero"),
    );
    expect(msg?.content).toContain("viewport: phone");
    expect(msg?.content).toContain("text: Hello");
    expect(body.messages.some((m) => m.role === "assistant")).toBe(false);

    const agent = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const preview = await ctx.app.request(`/api/sessions/${agent.id}/design-comment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selector: "button.save", viewport: "desktop" }),
    });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as AgentSession;
    expect(
      previewBody.messages.some((m) => m.content.includes("Preview comment on the live app")),
    ).toBe(true);

    const vm = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const denied = await ctx.app.request(`/api/sessions/${vm.id}/design-comment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selector: "h1", viewport: "desktop" }),
    });
    expect(denied.status).toBe(400);
  });

  it("reads and writes the Docker workspace from the host editor", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        runtime: "docker",
        dockerImage: "locus/agent",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    const session = (await created.json()) as AgentSession;
    const saved = await ctx.app.request(`/api/sessions/${session.id}/workspace/file`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "src/app.ts", content: "export const n = 1;\n" }),
    });
    expect(saved.status).toBe(200);
    const listed = await ctx.app.request(`/api/sessions/${session.id}/workspace`);
    expect(listed.status).toBe(200);
    const tree = (await listed.json()) as { entries: Array<{ path: string; type: string }> };
    expect(tree.entries.map((row) => row.path)).toEqual(
      expect.arrayContaining(["src", "src/app.ts"]),
    );
    const file = await ctx.app.request(
      `/api/sessions/${session.id}/workspace/file?path=src/app.ts`,
    );
    expect(await file.json()).toMatchObject({
      path: "src/app.ts",
      content: "export const n = 1;\n",
    });
    await ctx.store.mutateSession(session.id, (current) => {
      current.messages.push({
        id: "m-write",
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        toolCalls: [
          {
            id: "t-write",
            name: "file_write",
            arguments: {
              path: "/workspace/src/app.ts",
              content: "export const n = 1;\nexport const m = 2;\n",
            },
            result: "wrote",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        ],
      });
    });
    const changed = await ctx.app.request(`/api/sessions/${session.id}/workspace`);
    const withChanges = (await changed.json()) as {
      changes: Array<{ path: string; additions: number; deletions: number }>;
    };
    expect(withChanges.changes).toEqual(
      expect.arrayContaining([{ path: "src/app.ts", additions: 2, deletions: 0 }]),
    );
    const escaped = await ctx.app.request(`/api/sessions/${session.id}/workspace/file`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../secret", content: "nope" }),
    });
    expect(escaped.status).toBe(400);
    const folder = await ctx.app.request(`/api/sessions/${session.id}/workspace/mkdir`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "src/extra" }),
    });
    expect(folder.status).toBe(201);
    const revealed = await ctx.app.request(`/api/sessions/${session.id}/workspace/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "src/app.ts" }),
    });
    expect(revealed.status).toBe(200);
    expect(((await revealed.json()) as { path: string }).path).toMatch(/src$/);
    const escapedReveal = await ctx.app.request(`/api/sessions/${session.id}/workspace/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../secret" }),
    });
    expect(escapedReveal.status).toBe(400);
    const removed = await ctx.app.request(
      `/api/sessions/${session.id}/workspace/file?path=src/app.ts`,
      { method: "DELETE" },
    );
    expect(removed.status).toBe(200);
    const missing = await ctx.app.request(
      `/api/sessions/${session.id}/workspace/file?path=src/app.ts`,
    );
    expect(missing.status).toBe(404);
  });

  it("returns a git baseline and serves workspace screenshots", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        runtime: "docker",
        dockerImage: "locus/agent",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    const session = (await created.json()) as AgentSession;
    const ws = dockerWorkspaceDir(ctx.dir, session.id);
    await mkdir(ws, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: ws });
    await execFileAsync("git", ["config", "user.email", "locus@test"], { cwd: ws });
    await execFileAsync("git", ["config", "user.name", "Locus"], { cwd: ws });
    await writeFile(join(ws, "keep.ts"), "const a = 1;\n");
    await execFileAsync("git", ["add", "."], { cwd: ws });
    await execFileAsync("git", ["commit", "-m", "one"], { cwd: ws });
    await writeFile(join(ws, "keep.ts"), "const a = 1;\nconst b = 2;\n");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await writeFile(join(ws, "shot.png"), png);
    const pdf = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    await writeFile(join(ws, "brief.pdf"), pdf);
    const file = await ctx.app.request(`/api/sessions/${session.id}/workspace/file?path=keep.ts`);
    expect(file.status).toBe(200);
    expect(await file.json()).toMatchObject({
      path: "keep.ts",
      content: "const a = 1;\nconst b = 2;\n",
      baseline: "const a = 1;\n",
    });
    const raw = await ctx.app.request(`/api/sessions/${session.id}/workspace/raw?path=shot.png`);
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await raw.arrayBuffer())).toEqual(png);
    const pdfRaw = await ctx.app.request(
      `/api/sessions/${session.id}/workspace/raw?path=brief.pdf`,
    );
    expect(pdfRaw.status).toBe(200);
    expect(pdfRaw.headers.get("content-type")).toBe("application/pdf");
    expect(pdfRaw.headers.get("content-disposition")).toMatch(/brief\.pdf/);
    expect(Buffer.from(await pdfRaw.arrayBuffer())).toEqual(pdf);
    const escaped = await ctx.app.request(
      `/api/sessions/${session.id}/workspace/raw?path=../shot.png`,
    );
    expect(escaped.status).toBe(400);
  });

  it("lists the cloned repo in the Docker Files tree", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        runtime: "docker",
        dockerImage: "locus/agent",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
        repo: { forge: "github", url: "https://github.com/acme/demo.git" },
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    const deadline = Date.now() + 2000;
    let cloned = false;
    while (Date.now() < deadline) {
      const fresh = await ctx.sessions.get(session.id);
      cloned = Boolean(
        fresh?.messages.some((m) => m.role === "system" && m.content.includes("Cloned")),
      );
      if (cloned) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(cloned).toBe(true);
    const listed = await ctx.app.request(`/api/sessions/${session.id}/workspace`);
    expect(listed.status).toBe(200);
    const tree = (await listed.json()) as { entries: Array<{ path: string; type: string }> };
    expect(tree.entries.map((row) => row.path)).toEqual(expect.arrayContaining(["README.md"]));
    const file = await ctx.app.request(`/api/sessions/${session.id}/workspace/file?path=README.md`);
    expect(file.status).toBe(200);
    const body = (await file.json()) as { path: string; content: string };
    expect(body.path).toBe("README.md");
    expect(body.content).toContain("github.com/acme/demo.git");
    ctx.hypervisor.shutdown();
  });
});

describe("config save reloads capabilities", () => {
  it("returns the capabilities from onConfigSaved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const app = createApp({
      store,
      sessions,
      hypervisor,
      capabilities: {
        qemuBinary: "/usr/bin/qemu-system-x86_64",
        qemuImgBinary: "/usr/bin/qemu-img",
        swtpmBinary: null,
        xorrisoBinary: null,
        accelerator: "kvm",
        ovmfCodePath: null,
        ovmfVarsPath: null,
        hasKvm: true,
        kvmUsable: true,
        hasVirtfs: true,
      },
      onConfigSaved: async () => ({
        qemuBinary: "/usr/bin/qemu-system-x86_64",
        qemuImgBinary: "/usr/bin/qemu-img",
        swtpmBinary: null,
        xorrisoBinary: null,
        accelerator: "tcg",
        ovmfCodePath: null,
        ovmfVarsPath: null,
        hasKvm: true,
        kvmUsable: false,
        hasVirtfs: true,
      }),
    });
    const config = (await (await app.request("/api/config")).json()) as LocusConfig;
    const saved = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    expect(saved.status).toBe(200);
    const hv = (await (await app.request("/api/hypervisor")).json()) as {
      capabilities: { kvmUsable: boolean; accelerator: string };
    };
    expect(hv.capabilities.kvmUsable).toBe(false);
    expect(hv.capabilities.accelerator).toBe("tcg");
    hypervisor.shutdown();
  });
});

describe("local access controls", () => {
  it("rejects non-loopback browser origins", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const res = await ctx.app.request("/api/health", {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    const ok = await ctx.app.request("/api/health", {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(ok.status).toBe(200);
    ctx.hypervisor.shutdown();
  });

  it("rejects a non-loopback bind host and a file: provider URL", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const bind = await ctx.app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...config, advanced: { ...config.advanced, bindHost: "0.0.0.0" } }),
    });
    expect(bind.status).toBe(400);
    config.providers[0] = { ...config.providers[0]!, baseUrl: "file:///etc/passwd" };
    const fileUrl = await ctx.app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    expect(fileUrl.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("pairs a LAN phone with a token and keeps the token out of config.json", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const lan = createApp({
      store: ctx.store,
      sessions: ctx.sessions,
      hypervisor: ctx.hypervisor,
      peerAddress: () => "192.168.1.20",
    });
    const blocked = await lan.request("/api/health", {
      headers: { origin: "http://192.168.1.8:7420" },
    });
    expect(blocked.status).toBe(403);
    const enabled = await ctx.app.request("/api/phone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.status).toBe(200);
    const status = (await enabled.json()) as {
      enabled: boolean;
      token?: string;
      listenHost: string;
    };
    expect(status.enabled).toBe(true);
    expect(status.token).toMatch(/^ph_/);
    expect(status.listenHost).toBe("0.0.0.0");
    const uiShell = await lan.request("/", {
      headers: { origin: "http://192.168.1.8:7420" },
    });
    expect(uiShell.status).not.toBe(403);
    const stillGated = await lan.request("/api/health", {
      headers: { origin: "http://192.168.1.8:7420" },
    });
    expect(stillGated.status).toBe(403);
    const onDisk = JSON.parse(await readFile(join(ctx.dir, "config.json"), "utf8")) as {
      phoneRemote?: { enabled?: boolean; token?: string };
    };
    expect(onDisk.phoneRemote?.enabled).toBe(true);
    expect(onDisk.phoneRemote?.token).toBeFalsy();
    const redacted = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    expect(redacted.phoneRemote?.enabled).toBe(true);
    expect(redacted.phoneRemote?.token).toBe("••••••••");
    const allowed = await lan.request("/api/health", {
      headers: {
        origin: "http://192.168.1.8:7420",
        authorization: `Bearer ${status.token}`,
      },
    });
    expect(allowed.status).toBe(200);
    const phoneSees = await lan.request("/api/phone", {
      headers: {
        origin: "http://192.168.1.8:7420",
        authorization: `Bearer ${status.token}`,
      },
    });
    expect(phoneSees.status).toBe(200);
    expect(((await phoneSees.json()) as { token?: string }).token).toBeUndefined();
    const lanEnv = { incoming: { socket: { remoteAddress: "192.168.1.20" } } };
    const productionPeer = await ctx.app.request(
      "/api/phone",
      {
        headers: {
          origin: "http://192.168.1.8:7420",
          authorization: `Bearer ${status.token}`,
        },
      },
      lanEnv,
    );
    expect(productionPeer.status).toBe(200);
    expect(((await productionPeer.json()) as { token?: string }).token).toBeUndefined();
    const lanPost = await ctx.app.request(
      "/api/phone",
      {
        method: "POST",
        headers: {
          origin: "http://192.168.1.8:7420",
          authorization: `Bearer ${status.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
      },
      lanEnv,
    );
    expect(lanPost.status).toBe(403);
    const lanRotate = await ctx.app.request(
      "/api/phone/rotate",
      {
        method: "POST",
        headers: {
          origin: "http://192.168.1.8:7420",
          authorization: `Bearer ${status.token}`,
        },
      },
      lanEnv,
    );
    expect(lanRotate.status).toBe(403);
    expect((await ctx.store.loadConfig()).phoneRemote?.enabled).toBe(true);
    expect((await ctx.store.loadConfig()).phoneRemote?.token).toBe(status.token);
    ctx.hypervisor.shutdown();
  });

  it("does not re-enable phone remote when the UI saves a redacted config", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const enabled = await ctx.app.request("/api/phone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.status).toBe(200);
    const token = ((await enabled.json()) as { token?: string }).token;
    const stale = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    expect(stale.phoneRemote?.enabled).toBe(true);
    expect(stale.phoneRemote?.token).toBe("••••••••");
    const off = await ctx.app.request("/api/phone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);
    expect((await ctx.store.loadConfig()).phoneRemote?.enabled).toBe(false);
    const saved = await ctx.app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(stale),
    });
    expect(saved.status).toBe(200);
    expect((await ctx.store.loadConfig()).phoneRemote?.enabled).toBe(false);
    expect((await ctx.store.loadConfig()).phoneRemote?.token).toBe(token);
    ctx.hypervisor.shutdown();
  });

  it("mints a vaulted Chrome extension pairing token on the loopback operator", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const enabled = await ctx.app.request("/api/chrome-extension", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.status).toBe(200);
    const status = (await enabled.json()) as {
      enabled: boolean;
      token?: string;
      formattedToken?: string;
      installDir?: string;
    };
    expect(status.enabled).toBe(true);
    expect(status.token).toMatch(/^cx_/);
    expect(status.formattedToken).toMatch(/^[A-Z0-9]{4}-/);
    expect(status.installDir).toContain("chrome-extension");
    const onDisk = JSON.parse(await readFile(join(ctx.dir, "config.json"), "utf8")) as {
      chromeExtension?: { enabled?: boolean; token?: string };
    };
    expect(onDisk.chromeExtension?.enabled).toBe(true);
    expect(onDisk.chromeExtension?.token).toBeFalsy();
    const redacted = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    expect(redacted.chromeExtension?.enabled).toBe(true);
    expect(redacted.chromeExtension?.token).toBe("••••••••");
    const lanEnv = { incoming: { socket: { remoteAddress: "192.168.1.20" } } };
    const lanPost = await ctx.app.request(
      "/api/chrome-extension",
      {
        method: "POST",
        headers: {
          origin: "http://192.168.1.8:7420",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
      },
      lanEnv,
    );
    expect(lanPost.status).toBe(403);
    expect((await ctx.store.loadConfig()).chromeExtension?.enabled).toBe(true);
    expect((await ctx.store.loadConfig()).chromeExtension?.token).toBe(status.token);
    ctx.hypervisor.shutdown();
  });

  it("keeps real guest passwords when the UI saves a redacted config", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const password = (await ctx.store.loadConfig()).templates[0]?.cloudInit?.password;
    expect(password).toBeTruthy();
    expect(password).not.toBe("••••••••");
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    expect(config.templates[0]?.cloudInit?.password).toBe("••••••••");
    const saved = await ctx.app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    expect(saved.status).toBe(200);
    expect((await ctx.store.loadConfig()).templates[0]?.cloudInit?.password).toBe(password);
    ctx.hypervisor.shutdown();
  });

  it("persists a theme and rejects unknown palettes", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const saved = await ctx.app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...config, theme: "nord" }),
    });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as LocusConfig).theme).toBe("nord");
    expect((await ctx.store.loadConfig()).theme).toBe("nord");
    const bad = await ctx.app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...config, theme: "not-a-theme" }),
    });
    expect(bad.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("persists custom skills and rejects reserved slash names", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const skill = {
      id: "sk1",
      name: "review",
      title: "PR review",
      hint: "Review the diff",
      body: "Look at git_diff.",
      enabled: true,
    };
    const saved = await ctx.app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...config, skills: [skill] }),
    });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as LocusConfig).skills).toEqual([skill]);
    expect((await ctx.store.loadConfig()).skills).toEqual([
      OPS_RESEARCH_SKILL,
      skill,
      REVIEW_PR_SKILL,
    ]);
    const reserved = await ctx.app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...config, skills: [{ ...skill, name: "undo" }] }),
    });
    expect(reserved.status).toBe(400);
    const empty = await ctx.app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...config, skills: [{ ...skill, body: "  " }] }),
    });
    expect(empty.status).toBe(400);
    ctx.hypervisor.shutdown();
  });
});

describe("golden images, media, and abort", () => {
  it("pauses and resumes a running guest", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    ctx.hypervisor.forceRunning(session.vmId!);
    const paused = await ctx.app.request(`/api/sessions/${session.id}/vm/pause`, {
      method: "POST",
    });
    expect(paused.status).toBe(200);
    expect(((await paused.json()) as { status: string }).status).toBe("paused");
    const resumed = await ctx.app.request(`/api/sessions/${session.id}/vm/resume`, {
      method: "POST",
    });
    expect(resumed.status).toBe(200);
    expect(((await resumed.json()) as { status: string }).status).toBe("running");
    const logs = await ctx.app.request(`/api/sessions/${session.id}/vm/logs`);
    expect(logs.status).toBe(200);
    expect(((await logs.json()) as { text: string }).text).toMatch(/booting|running/);
    ctx.hypervisor.shutdown();
  });

  it("captures, lists, boots from, and deletes a golden image", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    ctx.hypervisor.forceRunning(session.vmId!);
    const shot = await ctx.app.request(`/api/sessions/${session.id}/images`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "base ubuntu" }),
    });
    expect(shot.status).toBe(201);
    const image = (await shot.json()) as { id: string; name: string; path: string };
    expect(image.name).toBe("base ubuntu");
    const listed = (await (await ctx.app.request("/api/images")).json()) as Array<{ id: string }>;
    expect(listed.map((i) => i.id)).toContain(image.id);

    const next = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        imageId: image.id,
        instructions: "Prefer /mnt/host",
        startVm: true,
      }),
    });
    const cloned = (await next.json()) as AgentSession;
    expect(cloned.imageId).toBe(image.id);
    expect(cloned.instructions).toBe("Prefer /mnt/host");
    expect(cloned.vmId).toBeTruthy();

    ctx.hypervisor.forceRunning(session.vmId!);
    const again = await ctx.sessions.startVm(session.id);
    expect(again.status).toBe("running");

    const deleted = await ctx.app.request(`/api/images/${image.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await (await ctx.app.request("/api/images")).json()).toEqual([]);
    ctx.hypervisor.shutdown();
  });

  it("aborts an in-flight chat", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    const session = (await created.json()) as AgentSession;
    await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    const abort = await ctx.app.request(`/api/sessions/${session.id}/chat/abort`, {
      method: "POST",
    });
    expect(abort.status).toBe(200);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const fresh = await ctx.sessions.get(session.id);
      if (fresh?.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    ctx.hypervisor.shutdown();
  });

  it("queues a follow-up while a turn is running and drains it after the turn", async () => {
    const ctx = await setupSlowChat();
    cleanup.push(ctx.dir);
    const session = await createIdleSession(ctx);
    const first = await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "first" }),
    });
    expect(first.status).toBe(200);
    const queued = await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "second", plan: true, skill: "review" }),
    });
    expect(queued.status).toBe(200);
    const mid = await ctx.sessions.get(session.id);
    expect(mid?.status).toBe("running");
    expect(
      mid?.queue?.map((item) => ({ text: item.text, plan: item.plan, skill: item.skill })),
    ).toEqual([{ text: "second", plan: true, skill: "review" }]);
    expect(mid?.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["first"]);

    const deadline = Date.now() + 4000;
    let fresh = mid;
    while (Date.now() < deadline) {
      fresh = await ctx.sessions.get(session.id);
      const users = fresh?.messages.filter((m) => m.role === "user").map((m) => m.content) ?? [];
      if (users.includes("second") && fresh?.status !== "running" && !fresh?.queue?.length) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
      "first",
      "second",
    ]);
    expect(fresh?.queue).toBeUndefined();
    ctx.hypervisor.shutdown();
  });

  it("does not keep a landed prompt in the follow-up queue", async () => {
    const ctx = await setupSlowChat();
    cleanup.push(ctx.dir);
    const session = await createIdleSession(ctx);
    const first = ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "match the colour scheme" }),
    });
    const second = ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "match the colour scheme" }),
    });
    await Promise.all([first, second]);
    const mid = await ctx.sessions.get(session.id);
    expect(
      mid?.messages.filter((m) => m.role === "user" && m.content === "match the colour scheme")
        .length,
    ).toBeGreaterThanOrEqual(1);
    expect(mid?.queue?.some((item) => item.text === "match the colour scheme") ?? false).toBe(
      false,
    );
    ctx.hypervisor.shutdown();
  });

  it("steers a follow-up into the running turn instead of the queue", async () => {
    const ctx = await setupSlowChat();
    cleanup.push(ctx.dir);
    const session = await createIdleSession(ctx);
    const first = await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "first" }),
    });
    expect(first.status).toBe(200);
    const steered = await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "look at src/compact.ts", steer: true }),
    });
    expect(steered.status).toBe(200);
    const mid = await ctx.sessions.get(session.id);
    expect(mid?.queue).toBeUndefined();
    expect(mid?.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
      "first",
      "look at src/compact.ts",
    ]);
    expect(mid?.messages.some((m) => m.role === "user" && m.steer)).toBe(true);
    ctx.hypervisor.shutdown();
  });

  it("sends a queued prompt now and interrupts the running turn", async () => {
    const ctx = await setupSlowChat(800);
    cleanup.push(ctx.dir);
    const session = await createIdleSession(ctx);
    const first = await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "first" }),
    });
    expect(first.status).toBe(200);
    await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "second" }),
    });
    await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "third" }),
    });
    const mid = await ctx.sessions.get(session.id);
    expect(mid?.queue?.map((item) => item.text)).toEqual(["second", "third"]);
    const jump = mid?.queue?.find((item) => item.text === "third");
    expect(jump).toBeTruthy();
    const sent = await ctx.app.request(`/api/sessions/${session.id}/queue/${jump!.id}/send`, {
      method: "POST",
    });
    expect(sent.status).toBe(200);
    const after = (await sent.json()) as AgentSession;
    expect(after.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
      "first",
      "third",
    ]);
    expect(after.messages.some((m) => m.role === "user" && m.steer)).toBe(false);
    expect(after.queue?.map((item) => item.text)).toEqual(["second"]);
    expect(after.queuePaused).toBeUndefined();
    expect(after.status).toBe("running");

    const deadline = Date.now() + 4000;
    let fresh = after;
    while (Date.now() < deadline) {
      fresh = (await ctx.sessions.get(session.id)) ?? fresh;
      const users = fresh.messages.filter((m) => m.role === "user").map((m) => m.content);
      if (users.includes("second") && fresh.status !== "running" && !fresh.queue?.length) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
      "first",
      "third",
      "second",
    ]);
    expect(fresh.queue).toBeUndefined();
    ctx.hypervisor.shutdown();
  });

  it("sends a queued prompt now after Stop without resuming the rest", async () => {
    const ctx = await setupSlowChat();
    cleanup.push(ctx.dir);
    const session = await createIdleSession(ctx);
    await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "first" }),
    });
    await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "later-a" }),
    });
    await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "later-b" }),
    });
    const abort = await ctx.app.request(`/api/sessions/${session.id}/chat/abort`, {
      method: "POST",
    });
    expect(abort.status).toBe(200);
    const stopAt = Date.now() + 2000;
    let parked = await ctx.sessions.get(session.id);
    while (Date.now() < stopAt) {
      parked = await ctx.sessions.get(session.id);
      if (parked?.status !== "running" && parked?.queuePaused) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(parked?.status).not.toBe("running");
    expect(parked?.queuePaused).toBe(true);
    expect(parked?.queue?.map((item) => item.text)).toEqual(["later-a", "later-b"]);
    const item = parked?.queue?.find((row) => row.text === "later-a");
    expect(item).toBeTruthy();
    const sent = await ctx.app.request(`/api/sessions/${session.id}/queue/${item!.id}/send`, {
      method: "POST",
    });
    expect(sent.status).toBe(200);
    const after = (await sent.json()) as AgentSession;
    expect(after.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
      "first",
      "later-a",
    ]);
    expect(after.queue?.map((row) => row.text)).toEqual(["later-b"]);
    expect(after.queuePaused).toBe(true);

    const doneAt = Date.now() + 4000;
    let fresh = after;
    while (Date.now() < doneAt) {
      fresh = (await ctx.sessions.get(session.id)) ?? fresh;
      if (fresh.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh.status).not.toBe("running");
    expect(fresh.queuePaused).toBe(true);
    expect(fresh.queue?.map((row) => row.text)).toEqual(["later-b"]);
    ctx.hypervisor.shutdown();
  });

  it("rejects sending a missing queued prompt", async () => {
    const ctx = await setupSlowChat();
    cleanup.push(ctx.dir);
    const session = await createIdleSession(ctx);
    const missing = await ctx.app.request(`/api/sessions/${session.id}/queue/nope/send`, {
      method: "POST",
    });
    expect(missing.status).toBe(404);
    ctx.hypervisor.shutdown();
  });

  it("rejects over-long chat text", async () => {
    const ctx = await setupSlowChat();
    cleanup.push(ctx.dir);
    const session = await createIdleSession(ctx);
    const res = await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "x".repeat(120_001) }),
    });
    expect(res.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("keeps the queue after Stop instead of draining it", async () => {
    const ctx = await setupSlowChat();
    cleanup.push(ctx.dir);
    const session = await createIdleSession(ctx);
    await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "first" }),
    });
    await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "later" }),
    });
    const abort = await ctx.app.request(`/api/sessions/${session.id}/chat/abort`, {
      method: "POST",
    });
    expect(abort.status).toBe(200);
    const deadline = Date.now() + 2000;
    let fresh = await ctx.sessions.get(session.id);
    while (Date.now() < deadline) {
      fresh = await ctx.sessions.get(session.id);
      if (fresh?.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.status).not.toBe("running");
    expect(fresh?.queuePaused).toBe(true);
    expect(fresh?.queue?.map((item) => item.text)).toEqual(["later"]);
    expect(fresh?.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
      "first",
    ]);

    const resumed = await ctx.app.request(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queuePaused: false }),
    });
    expect(resumed.status).toBe(200);
    const doneAt = Date.now() + 4000;
    while (Date.now() < doneAt) {
      fresh = await ctx.sessions.get(session.id);
      if (
        fresh?.messages.some((m) => m.role === "user" && m.content === "later") &&
        fresh.status !== "running"
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
      "first",
      "later",
    ]);
    expect(fresh?.queue).toBeUndefined();
    ctx.hypervisor.shutdown();
  });

  it("clears the follow-up queue when rewinding a turn", async () => {
    const ctx = await setupSlowChat();
    cleanup.push(ctx.dir);
    const session = await createIdleSession(ctx);
    await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "first" }),
    });
    await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "later" }),
    });
    await ctx.app.request(`/api/sessions/${session.id}/chat/abort`, { method: "POST" });
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const row = await ctx.sessions.get(session.id);
      if (row?.status !== "running" && row?.queue?.length) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const rewound = await ctx.app.request(`/api/sessions/${session.id}/rewind`, { method: "POST" });
    expect(rewound.status).toBe(200);
    const fresh = (await rewound.json()) as AgentSession;
    expect(fresh.queue).toBeUndefined();
    expect(fresh.queuePaused).toBeUndefined();
    ctx.hypervisor.shutdown();
  });

  it("stores a numbered plan from a plan-mode turn", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    const session = (await created.json()) as AgentSession;
    await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "fix the login", plan: true }),
    });
    const deadline = Date.now() + 4000;
    let fresh = await ctx.sessions.get(session.id);
    while (Date.now() < deadline) {
      fresh = await ctx.sessions.get(session.id);
      if (fresh?.plan?.items.length && fresh.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.plan?.items.map((item) => item.text).join(" ")).toMatch(/Inspect/);
    expect(fresh?.plan?.phase).toBe("proposed");
    expect(fresh?.plan?.items.every((item) => item.status === "pending")).toBe(true);
    expect(
      fresh?.messages.some((message) => message.role === "assistant" && message.toolCalls?.length),
    ).toBe(false);
    ctx.hypervisor.shutdown();
  });

  it(
    "persists plan step status and ticks it after a tool finishes",
    { timeout: 15_000 },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-"));
      cleanup.push(dir);
      const store = new JsonStore(dir);
      await store.init();
      const config = await store.loadConfig();
      const provider = config.providers[0]!;
      provider.apiKey = "sk-test";
      await store.saveConfig(config);
      let round = 0;
      async function* engine() {
        round += 1;
        if (round === 1) {
          yield {
            type: "tool_call" as const,
            id: "call_plan",
            name: "file_write",
            arguments: { path: "/tmp/inspected.txt", content: "ok" },
          };
          return;
        }
        yield { type: "text" as const, text: "Inspected." };
      }
      const hypervisor = new MockHypervisor(dir);
      const sessions = new SessionService(store, hypervisor, new Hub(), engine);
      const created = await sessions.create({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: provider.id,
        model: provider.defaultModel,
        startVm: true,
      });
      hypervisor.forceRunning(created.vmId!);
      await sessions.patchMeta(created.id, {
        plan: {
          items: [
            { id: "p1", text: "Inspect", status: "running" },
            { id: "p2", text: "Patch", status: "pending" },
          ],
        },
      });
      const stored = await sessions.get(created.id);
      expect(stored?.plan?.items.map((item) => item.status)).toEqual(["running", "pending"]);
      await sessions.sendChat(created.id, "run the plan");
      const deadline = Date.now() + 8000;
      let fresh = await sessions.get(created.id);
      while (Date.now() < deadline) {
        fresh = await sessions.get(created.id);
        const statuses = fresh?.plan?.items.map((item) => item.status);
        if (statuses?.[0] === "done" && fresh?.status !== "running") break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(fresh?.plan?.items.map((item) => item.status)).toEqual(["done", "pending"]);
      hypervisor.shutdown();
    },
  );

  it("attaches a screenshot after GUI tools", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    ctx.hypervisor.forceRunning(session.vmId!);
    const click = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "mouse_click", args: { button: 1, x: 10, y: 20 } }),
    });
    const body = (await click.json()) as { ok: boolean; screenshotBase64?: string };
    expect(body.ok).toBe(true);
    expect(body.screenshotBase64).toBeTruthy();
    ctx.hypervisor.shutdown();
  });

  it("skips the extra GUI screenshot when vision is off", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
        vision: "off",
      }),
    });
    const session = (await created.json()) as AgentSession;
    ctx.hypervisor.forceRunning(session.vmId!);
    const click = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "mouse_click", args: { button: 1, x: 10, y: 20 } }),
    });
    const body = (await click.json()) as { ok: boolean; screenshotBase64?: string };
    expect(body.ok).toBe(true);
    expect(body.screenshotBase64).toBeUndefined();
    ctx.hypervisor.shutdown();
  });

  it("records the guest desktop and serves the saved video", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    ctx.hypervisor.forceRunning(session.vmId!);
    const start = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "record_screen", args: { mode: "START_RECORDING" } }),
    });
    expect(start.status).toBe(200);
    expect(((await start.json()) as { output: string }).output).toBe("recording started");
    const tools = (await (await ctx.app.request("/api/tools/windows-10")).json()) as {
      name: string;
    }[];
    expect(tools.map((t) => t.name)).toContain("record_screen");
    const save = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "record_screen",
        args: { mode: "SAVE_RECORDING", save_as_filename: "settings panel" },
      }),
    });
    const saved = (await save.json()) as { ok: boolean; recordingName?: string };
    expect(save.status).toBe(200);
    expect(saved.ok).toBe(true);
    expect(saved.recordingName).toBe("settings_panel.mp4");
    const video = await ctx.app.request(
      `/api/sessions/${session.id}/recordings/${saved.recordingName}`,
    );
    expect(video.status).toBe(200);
    expect(video.headers.get("content-type")).toBe("video/mp4");
    const bytes = Buffer.from(await video.arrayBuffer());
    expect(bytes.subarray(4, 8).toString()).toBe("ftyp");
    const escaped = await ctx.app.request(
      `/api/sessions/${session.id}/recordings/${encodeURIComponent("../passwd")}`,
    );
    expect(escaped.status).toBe(400);
    const other = await ctx.app.request(
      "/api/sessions/not-a-session/recordings/settings_panel.mp4",
    );
    expect(other.status).toBe(404);
    ctx.hypervisor.shutdown();
  });

  it("persists a Chromium PDF artifact from a Docker agent", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "locus/agent",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    await waitUntilDockerRunning(ctx.sessions, session.id);
    const pdf = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "browser_pdf", args: { save_as_filename: "invoice" } }),
    });
    expect(pdf.status).toBe(200);
    const saved = (await pdf.json()) as { ok: boolean; artifactName?: string };
    expect(saved.ok).toBe(true);
    expect(saved.artifactName).toBe("invoice.pdf");
    const file = await ctx.app.request(
      `/api/sessions/${session.id}/artifacts/${saved.artifactName}?kind=pdf`,
    );
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    ctx.hypervisor.shutdown();
  });

  it("accepts a composer attachment without chat text", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "locus/agent",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    const chat = await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "",
        attachments: [
          {
            name: "notes.md",
            mime: "text/markdown",
            contentBase64: Buffer.from("# hi\n").toString("base64"),
          },
        ],
      }),
    });
    expect(chat.status).toBe(200);
    const empty = await ctx.app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    expect(empty.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("sends user-attached images to the model even when guest vision is off", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.providers = config.providers.map((p, i) =>
      i === 0 ? { ...p, apiKey: "sk-test-vision-off", enabled: true } : p,
    );
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const seen: string[] = [];
    async function* capture(req: { messages: AgentSession["messages"] }) {
      for (const message of req.messages) {
        if (message.screenshotBase64)
          seen.push(
            `${message.role}:${message.screenshotMime ?? "image/png"}:${message.screenshotBase64}`,
          );
      }
      yield { type: "text" as const, text: "ok" };
    }
    const sessions = new SessionService(store, hypervisor, hub, capture);
    const app = createApp({ store, sessions, hypervisor });
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "locus/agent",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    expect(session.vision).toBe("off");
    const chat = await app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "see this",
        attachments: [{ name: "shot.png", mime: "image/png", contentBase64: png }],
      }),
    });
    expect(chat.status).toBe(200);
    const deadline = Date.now() + 4000;
    let fresh = await sessions.get(session.id);
    while (Date.now() < deadline) {
      fresh = await sessions.get(session.id);
      if (seen.some((row) => row.includes(png)) && fresh?.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(seen.some((row) => row.startsWith("user:") && row.endsWith(png))).toBe(true);
    const user = fresh?.messages.find((m) => m.role === "user");
    expect(user?.screenshotBase64).toBeUndefined();
    expect(user?.attachments?.[0]?.storedName).toBe("shot.png");
    expect(user?.content).toContain("/workspace/.locus-attachments/shot.png");
    expect(
      await readFile(join(dockerWorkspaceDir(dir, session.id), ".locus-attachments", "shot.png")),
    ).toEqual(Buffer.from(png, "base64"));
    hypervisor.shutdown();
  });

  it("attaches images for vision and rehydrates them from a drained queue", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.providers = config.providers.map((p, i) =>
      i === 0 ? { ...p, apiKey: "sk-test-queue", enabled: true } : p,
    );
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const seen: string[] = [];
    async function* capture(req: { messages: AgentSession["messages"]; signal?: AbortSignal }) {
      for (const message of req.messages) {
        if (message.screenshotBase64)
          seen.push(
            `${message.role}:${message.screenshotMime ?? "image/png"}:${message.screenshotBase64}`,
          );
      }
      yield { type: "text" as const, text: "one" };
      await new Promise((r) => setTimeout(r, 180));
      if (req.signal?.aborted) return;
      yield { type: "text" as const, text: " two" };
    }
    const sessions = new SessionService(store, hypervisor, hub, capture);
    const app = createApp({ store, sessions, hypervisor });
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "locus/agent",
        vision: "latest",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    const first = await app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "look",
        attachments: [{ name: "now.png", mime: "image/png", contentBase64: png }],
      }),
    });
    expect(first.status).toBe(200);
    const queued = await app.request(`/api/sessions/${session.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "later",
        attachments: [{ name: "queued.png", mime: "image/png", contentBase64: png }],
      }),
    });
    expect(queued.status).toBe(200);
    const mid = await sessions.get(session.id);
    expect(mid?.queue?.[0]?.attachments?.[0]?.storedName).toBe("queued.png");
    expect(mid?.messages.find((m) => m.role === "user")?.screenshotName).toBeTruthy();
    const deadline = Date.now() + 8000;
    let fresh = mid;
    while (Date.now() < deadline) {
      fresh = await sessions.get(session.id);
      const later = fresh?.messages.find((m) => m.role === "user" && m.content.startsWith("later"));
      if (
        later &&
        fresh?.status !== "running" &&
        !fresh?.queue?.length &&
        seen.filter((row) => row.includes(png)).length >= 2
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    const later = fresh?.messages.find((m) => m.role === "user" && m.content.startsWith("later"));
    expect(later?.screenshotName).toBeTruthy();
    expect(seen.some((row) => row.includes(`user:image/png:${png}`))).toBe(true);
    expect(seen.filter((row) => row.includes(png)).length).toBeGreaterThanOrEqual(2);
    hypervisor.shutdown();
  });

  it("exposes a loopback IDE tunnel for locus/agent and not for other images", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "locus/agent",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    await waitUntilDockerRunning(ctx.sessions, session.id);
    const ide = await ctx.app.request(`/api/sessions/${session.id}/ide`);
    expect(ide.status).toBe(200);
    const body = (await ide.json()) as { url: string | null };
    expect(body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const blocked = await ctx.app.request(`/api/sessions/${session.id}/preview-http/3999/`);
    expect(blocked.status).toBe(400);
    await ctx.app.request(`/api/sessions/${session.id}/vm/stop`, { method: "POST" });

    const other = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "node:22-bookworm",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const node = (await other.json()) as AgentSession;
    await waitUntilDockerRunning(ctx.sessions, node.id);
    const none = await ctx.app.request(`/api/sessions/${node.id}/ide`);
    expect(await none.json()).toEqual({ url: null });
    ctx.hypervisor.shutdown();
  });

  it("reports Tailscale as missing when the binary is not installed", async () => {
    const ctx = await setupWithoutHostBinaries();
    cleanup.push(ctx.dir);
    const status = await ctx.app.request("/api/tailscale");
    expect(status.status).toBe(200);
    const body = (await status.json()) as { installed: boolean; funnelEnabled: boolean };
    expect(body.installed).toBe(false);
    expect(body.funnelEnabled).toBe(false);
    ctx.hypervisor.shutdown();
  });

  it("rejects tools outside the session allowlist", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        allowedTools: ["exec"],
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    ctx.hypervisor.forceRunning(session.vmId!);
    const blocked = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "screenshot", args: {} }),
    });
    expect(blocked.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("refuses to read credential files into the model context", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    const session = (await created.json()) as AgentSession;
    ctx.hypervisor.forceRunning(session.vmId!);
    const blocked = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "file_read", args: { path: "/workspace/.env" } }),
    });
    expect(blocked.status).toBe(200);
    const body = (await blocked.json()) as { ok: boolean; output: string };
    expect(body.ok).toBe(false);
    expect(body.output).toMatch(/credential file/i);
    ctx.hypervisor.shutdown();
  });

  it("parks sessions left running after a crash and journals a recovery note", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
      }),
    });
    const session = (await created.json()) as AgentSession;
    await ctx.store.mutateSession(session.id, (current) => {
      current.status = "running";
    });
    expect(await ctx.sessions.recoverInterruptedTurns()).toBe(1);
    const fresh = await ctx.sessions.get(session.id);
    expect(fresh?.status).not.toBe("running");
    expect(fresh?.messages.some((m) => m.content.includes("interrupted turn"))).toBe(true);
    ctx.hypervisor.shutdown();
  });

  it("fetches a catalog cloud image", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const restore = await stubMediaUrl(
      CLOUD_IMAGE_CATALOG.find((c) => c.os === "ubuntu")!,
      Buffer.from([1, 2, 3, 4]),
    );
    try {
      const res = await ctx.app.request("/api/media/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ os: "ubuntu" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { path: string; name: string };
      expect(body.path).toContain("ubuntu-24.04-server-cloudimg-amd64.img");
      expect(body.name).toContain("Ubuntu");
    } finally {
      await restore();
    }
    ctx.hypervisor.shutdown();
  });

  it("fetches the Omarchy installer ISO", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const restore = await stubMediaUrl(
      CLOUD_IMAGE_CATALOG.find((c) => c.os === "omarchy")!,
      Buffer.from([1, 2, 3, 4]),
    );
    try {
      const res = await ctx.app.request("/api/media/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ os: "omarchy" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { path: string; name: string };
      expect(body.path).toContain("omarchy-4.0.1.iso");
      expect(body.name).toContain("Omarchy");
    } finally {
      await restore();
    }
    ctx.hypervisor.shutdown();
  });

  it("rejects a Windows cloud-image fetch", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const res = await ctx.app.request("/api/media/fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ os: "windows-11" }),
    });
    expect(res.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("fetches the VirtIO driver ISO", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const restore = await stubMediaUrl(VIRTIO_ISO, Buffer.from([1, 2, 3, 4]));
    try {
      const res = await ctx.app.request("/api/media/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media: "virtio" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { path: string; name: string };
      expect(body.path).toContain("virtio-win.iso");
      expect(body.name).toContain("VirtIO");
    } finally {
      await restore();
    }
    ctx.hypervisor.shutdown();
  });

  it("lists and tests provider models", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await ctx.store.saveConfig(config);
    const original = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      expect(String(input)).toContain("/models");
      return new Response(JSON.stringify({ data: [{ id: "gpt-4.1" }, { id: "o4-mini" }] }), {
        status: 200,
      });
    }) as typeof fetch;
    try {
      const listed = await ctx.app.request(`/api/providers/${provider.id}/models`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "••••••••" }),
      });
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual({ models: ["gpt-4.1", "o4-mini"] });
      const tested = await ctx.app.request(`/api/providers/${provider.id}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(tested.status).toBe(200);
      expect(await tested.json()).toEqual({ ok: true, models: 2 });
    } finally {
      globalThis.fetch = original;
    }
    const missing = await ctx.app.request("/api/providers/nope/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(404);
    ctx.hypervisor.shutdown();
  });

  it("auto-persists Cursor CLI models on refresh", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const listed = ["composer-2", "gpt-5", "cursor-grok-4.6"];
    const app = createApp({
      store: ctx.store,
      sessions: ctx.sessions,
      hypervisor: ctx.hypervisor,
      listProviderModels: async (provider) => {
        expect(provider.kind).toBe("cursor-cli");
        return listed;
      },
    });
    const res = await app.request("/api/providers/cursor-cli/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { changed: boolean; models: string[]; config: LocusConfig };
    expect(body.changed).toBe(true);
    expect(body.models).toEqual(listed);
    expect(body.config.providers.find((p) => p.kind === "cursor-cli")?.models).toEqual(listed);
    const saved = await ctx.store.loadConfig();
    expect(saved.providers.find((p) => p.kind === "cursor-cli")?.models).toEqual(listed);
    ctx.hypervisor.shutdown();
  });

  it("checks GitHub releases for an app update", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const app = createApp({
      store: ctx.store,
      sessions: ctx.sessions,
      hypervisor: ctx.hypervisor,
      fetchFn: (async (input) => {
        expect(String(input)).toContain("/releases/latest");
        return new Response("Not Found", { status: 404 });
      }) as typeof fetch,
    });
    const res = await app.request("/api/updates?current=0.16.1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; message?: string };
    expect(body.status).toBe("unavailable");
    expect(body.message).toMatch(/no GitHub release found/i);
    ctx.hypervisor.shutdown();
  });

  it("uploads a file into the host share", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const form = new FormData();
    form.append("file", new File([new Uint8Array([65, 66, 67])], "hello.txt"));
    const res = await ctx.app.request("/api/share/upload", { method: "POST", body: form });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { path: string; guestPath: string };
    expect(body.guestPath).toBe("/mnt/host/hello.txt");
    expect(await readFile(body.path, "utf8")).toBe("ABC");
    const listed = await ctx.app.request("/api/share");
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { files: Array<{ name: string }> }).files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "hello.txt", guestPath: "/mnt/host/hello.txt" }),
      ]),
    );
    const downloaded = await ctx.app.request("/api/share/files/hello.txt");
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe("ABC");
    const escaped = await ctx.app.request("/api/share/files/%2e%2e%2fpasswd");
    expect([400, 404]).toContain(escaped.status);
    const parent = await ctx.app.request("/api/share/files/..");
    expect([400, 404]).toContain(parent.status);
    const missingFile = await ctx.app.request("/api/share/files/nope.txt");
    expect(missingFile.status).toBe(404);
    const bad = new FormData();
    bad.append("file", new File([new Uint8Array([1])], ".."));
    const rejected = await ctx.app.request("/api/share/upload", { method: "POST", body: bad });
    expect(rejected.status).toBe(400);

    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const winTemplate = config.templates.find((t) => t.os === "windows-11");
    const provider = config.providers[0];
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "windows-11",
        templateId: winTemplate!.id,
        providerId: provider!.id,
        model: provider!.defaultModel,
        startVm: false,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    const winForm = new FormData();
    winForm.append("file", new File([new Uint8Array([68])], "win.txt"));
    const winUpload = await ctx.app.request(`/api/share/upload?sessionId=${session.id}`, {
      method: "POST",
      body: winForm,
    });
    expect(winUpload.status).toBe(201);
    expect(((await winUpload.json()) as { guestPath: string }).guestPath).toBe("C:\\host\\win.txt");
    const winListed = await ctx.app.request(`/api/share?sessionId=${session.id}`);
    expect(((await winListed.json()) as { files: Array<{ guestPath: string }> }).files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "win.txt", guestPath: "C:\\host\\win.txt" }),
      ]),
    );
    ctx.hypervisor.shutdown();
  });

  it("broadcasts the user prompt before a slow guest snapshot", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    ctx.hypervisor.forceRunning(created.vmId!);

    let sawUser = false;
    let snapshotStarted = false;
    const sendEvent = ctx.hub.broadcast.bind(ctx.hub);
    ctx.hub.broadcast = (event: ClientEvent) => {
      if (event.type === "chat.message" && event.message.role === "user") {
        expect(snapshotStarted).toBe(false);
        sawUser = true;
      }
      sendEvent(event);
    };

    const snap = ctx.hypervisor.snapshotDisk!.bind(ctx.hypervisor);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.hypervisor.snapshotDisk = async (id, dest) => {
      snapshotStarted = true;
      expect(sawUser).toBe(true);
      await gate;
      await snap(id, dest);
    };

    const pending = ctx.sessions.sendChat(created.id, "hello there");
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !sawUser) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(sawUser).toBe(true);
    const live = await ctx.sessions.get(created.id);
    expect(live?.messages.some((m) => m.role === "user" && m.content === "hello there")).toBe(true);
    release();
    await pending;
    expect(snapshotStarted).toBe(true);
    ctx.hypervisor.shutdown();
  });

  it("rewinds the last turn and restores the mock disk snapshot", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    ctx.hypervisor.forceRunning(created.vmId!);
    await ctx.store.mutateSession(created.id, (current) => {
      current.scratchpad = "before the turn";
      current.taskList = [{ id: "t1", text: "land prune", status: "in_progress" }];
      current.plan = {
        items: [
          { id: "p1", text: "Inspect", status: "running" },
          { id: "p2", text: "Patch", status: "pending" },
        ],
        phase: "accepted",
      };
    });
    await ctx.sessions.sendChat(created.id, "hi");
    const deadline = Date.now() + 4000;
    let fresh = await ctx.sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await ctx.sessions.get(created.id);
      if (
        fresh?.status !== "running" &&
        fresh?.messages.some((m) => m.role === "assistant" && m.content)
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.checkpoint?.diskPath).toBeTruthy();
    expect(fresh?.checkpoint?.scratchpad).toBe("before the turn");
    expect(fresh?.checkpoint?.taskList?.[0]?.text).toBe("land prune");
    expect(fresh?.checkpoint?.plan?.items.map((item) => item.text)).toEqual(["Inspect", "Patch"]);
    await ctx.store.mutateSession(created.id, (current) => {
      current.scratchpad = "after the turn";
      current.taskList = [{ id: "t1", text: "changed", status: "done" }];
      current.plan = {
        items: [{ id: "p1", text: "Inspect", status: "done" }],
        phase: "accepted",
      };
    });
    expect(fresh?.messages.some((m) => m.role === "user" && m.content === "hi")).toBe(true);
    expect(await readFile(fresh!.checkpoint!.diskPath!, "utf8")).toContain(created.vmId);

    const missing = await ctx.app.request("/api/sessions/missing/rewind", { method: "POST" });
    expect(missing.status).toBe(404);

    const rewound = await ctx.app.request(`/api/sessions/${created.id}/rewind`, { method: "POST" });
    expect(rewound.status).toBe(200);
    const body = (await rewound.json()) as AgentSession;
    expect(body.checkpoint).toBeUndefined();
    expect(body.scratchpad).toBe("before the turn");
    expect(body.taskList?.[0]?.status).toBe("in_progress");
    expect(body.plan?.items.map((item) => item.status)).toEqual(["running", "pending"]);
    expect(body.messages.some((m) => m.role === "user" && m.content === "hi")).toBe(false);
    expect(await readFile(ctx.hypervisor.get(created.vmId!)!.diskPath, "utf8")).toContain(
      created.vmId,
    );

    const empty = await ctx.app.request(`/api/sessions/${created.id}/rewind`, { method: "POST" });
    expect(empty.status).toBe(400);
    ctx.hypervisor.shutdown();
  });

  it("clears scratchpad, task list, and plan when the checkpoint lacked them", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    ctx.hypervisor.forceRunning(created.vmId!);
    await ctx.sessions.sendChat(created.id, "hi");
    const deadline = Date.now() + 4000;
    let fresh = await ctx.sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await ctx.sessions.get(created.id);
      if (
        fresh?.status !== "running" &&
        fresh?.messages.some((m) => m.role === "assistant" && m.content)
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.checkpoint).toBeTruthy();
    expect(fresh?.checkpoint?.scratchpad).toBeUndefined();
    expect(fresh?.checkpoint?.taskList).toBeUndefined();
    expect(fresh?.checkpoint?.plan).toBeUndefined();
    await ctx.store.mutateSession(created.id, (current) => {
      current.scratchpad = "after the turn";
      current.taskList = [{ id: "t1", text: "changed", status: "done" }];
      current.plan = {
        items: [{ id: "p1", text: "Inspect", status: "done" }],
        phase: "accepted",
      };
    });
    const rewound = await ctx.app.request(`/api/sessions/${created.id}/rewind`, { method: "POST" });
    expect(rewound.status).toBe(200);
    const body = (await rewound.json()) as AgentSession;
    expect(body.scratchpad).toBeUndefined();
    expect(body.taskList).toBeUndefined();
    expect(body.plan).toBeUndefined();
    ctx.hypervisor.shutdown();
  });

  it("clears chat and model context while keeping selected repos", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const empty = await ctx.app.request(`/api/sessions/${created.id}/clear`, { method: "POST" });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toBe("Nothing to clear");

    const missing = await ctx.app.request("/api/sessions/missing/clear", { method: "POST" });
    expect(missing.status).toBe(404);

    const repo = { forge: "github" as const, url: "https://github.com/acme/app.git", ref: "main" };
    const extra = { forge: "github" as const, url: "https://github.com/acme/lib.git", dest: "lib" };
    await ctx.store.mutateSession(created.id, (current) => {
      current.repoId = "r1";
      current.repo = repo;
      current.extraRepoIds = ["r2"];
      current.extraRepos = [extra];
      current.instructions = "ship it";
      current.vmId = undefined;
      current.messages = [
        { id: "u1", role: "user", content: "refactor auth", createdAt: new Date().toISOString() },
        {
          id: "a1",
          role: "assistant",
          content: "working on it",
          createdAt: new Date().toISOString(),
        },
      ];
      current.scratchpad = "keep the JWT flow";
      current.taskList = [{ id: "t1", text: "land prune", status: "in_progress" }];
      current.plan = {
        items: [{ id: "p1", text: "Inspect", status: "running" }],
        phase: "accepted",
      };
      current.queue = [{ id: "q1", text: "then tests" }];
      current.context = {
        window: 128_000,
        used: 4_000,
        reserved: 0,
        charsPerToken: 4,
        measured: false,
        parts: [{ id: "conversation", label: "Conversation", tokens: 4_000 }],
      };
      current.usage = { inputTokens: 400, outputTokens: 80 };
      current.cursorCli = { sessionId: "cli-1" };
      current.cursorCloud = { agentId: "cloud-1" };
      current.needsHuman = "Approve this";
      current.error = "boom";
      current.checkpoint = { id: "c1", messageCount: 0, createdAt: new Date().toISOString() };
    });

    const cleared = await ctx.app.request(`/api/sessions/${created.id}/clear`, { method: "POST" });
    expect(cleared.status).toBe(200);
    const body = (await cleared.json()) as AgentSession;
    expect(body.messages).toEqual([]);
    expect(body.scratchpad).toBeUndefined();
    expect(body.taskList).toBeUndefined();
    expect(body.plan).toBeUndefined();
    expect(body.queue).toBeUndefined();
    expect(body.context).toBeUndefined();
    expect(body.usage).toBeUndefined();
    expect(body.cursorCli).toBeUndefined();
    expect(body.cursorCloud).toBeUndefined();
    expect(body.needsHuman).toBeUndefined();
    expect(body.error).toBeUndefined();
    expect(body.checkpoint).toBeUndefined();
    expect(body.repoId).toBe("r1");
    expect(body.repo).toEqual(repo);
    expect(body.extraRepoIds).toEqual(["r2"]);
    expect(body.extraRepos).toEqual([extra]);
    expect(body.instructions).toBe("ship it");
    expect(body.status).toBe("idle");
    ctx.hypervisor.shutdown();
  });

  it("rewinds to an earlier checkpoint when given an id", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    ctx.hypervisor.forceRunning(created.vmId!);
    await ctx.sessions.sendChat(created.id, "one");
    const firstDeadline = Date.now() + 4000;
    let fresh = await ctx.sessions.get(created.id);
    while (Date.now() < firstDeadline) {
      fresh = await ctx.sessions.get(created.id);
      if (
        fresh?.status !== "running" &&
        fresh?.messages.some((m) => m.role === "user" && m.content === "one")
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await ctx.sessions.sendChat(created.id, "two");
    const secondDeadline = Date.now() + 4000;
    while (Date.now() < secondDeadline) {
      fresh = await ctx.sessions.get(created.id);
      if (
        fresh?.status !== "running" &&
        fresh?.messages.some((m) => m.role === "user" && m.content === "two")
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const oldest = rewindTargets(fresh!).at(0);
    expect(oldest).toBeTruthy();
    expect(rewindTargets(fresh!).length).toBeGreaterThan(1);
    const rewound = await ctx.app.request(`/api/sessions/${created.id}/rewind`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkpointId: oldest!.id }),
    });
    expect(rewound.status).toBe(200);
    const body = (await rewound.json()) as AgentSession;
    expect(body.messages.some((m) => m.content === "one")).toBe(false);
    expect(body.messages.some((m) => m.content === "two")).toBe(false);
    ctx.hypervisor.shutdown();
  });

  it("lets a human take over the guest and hands it back on the next message", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    ctx.hypervisor.forceRunning(created.vmId!);
    await ctx.sessions.sendChat(created.id, "hi");
    const taken = await ctx.app.request(`/api/sessions/${created.id}/takeover`, { method: "POST" });
    expect(taken.status).toBe(200);
    const human = (await taken.json()) as AgentSession;
    expect(human.control).toBe("human");
    expect(human.status).not.toBe("running");

    const missing = await ctx.app.request("/api/sessions/missing/takeover", { method: "POST" });
    expect(missing.status).toBe(404);

    const back = await ctx.app.request(`/api/sessions/${created.id}/handback`, { method: "POST" });
    expect(((await back.json()) as AgentSession).control).toBeUndefined();

    await ctx.sessions.takeover(created.id);
    await ctx.sessions.sendChat(created.id, "continue");
    const deadline = Date.now() + 4000;
    let fresh = await ctx.sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await ctx.sessions.get(created.id);
      if (fresh?.control !== "human" && fresh?.messages.some((m) => m.content === "continue"))
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.control).toBeUndefined();
    expect(fresh?.messages.some((m) => m.role === "user" && m.content === "continue")).toBe(true);
    ctx.hypervisor.shutdown();
  });

  it("forks a session from the current guest disk", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      instructions: "stay in /workspace",
      allowedTools: ["exec", "screenshot"],
      repo: { forge: "github", url: "https://github.com/acme/app.git" },
      hardware: { cpuCores: 3, memoryMb: 4096, diskSizeGb: 32 },
      startVm: true,
    });
    ctx.hypervisor.forceRunning(created.vmId!);
    await ctx.store.mutateSession(created.id, (current) => {
      current.messages.push({
        id: "m1",
        role: "user",
        content: "hi",
        createdAt: new Date().toISOString(),
      });
    });

    const missing = await ctx.app.request("/api/sessions/missing/fork", { method: "POST" });
    expect(missing.status).toBe(404);

    const forkedRes = await ctx.app.request(`/api/sessions/${created.id}/fork`, { method: "POST" });
    expect(forkedRes.status).toBe(201);
    const forked = (await forkedRes.json()) as AgentSession;
    expect(forked.id).not.toBe(created.id);
    expect(forked.title).toBe(`${created.title} fork`);
    expect(forked.vmId).toBeUndefined();
    expect(forked.status).toBe("draft");
    expect(forked.messages).toEqual([]);
    expect(forked.imageId).toBeTruthy();
    expect(forked.imageId).not.toBe(created.imageId);
    expect(forked.os).toBe(created.os);
    expect(forked.providerId).toBe(created.providerId);
    expect(forked.model).toBe(created.model);
    expect(forked.instructions).toBe("stay in /workspace");
    expect(forked.allowedTools).toEqual(["exec", "screenshot"]);
    expect(forked.repo).toEqual({ forge: "github", url: "https://github.com/acme/app.git" });
    expect(forked.hardware).toMatchObject({ cpuCores: 3, memoryMb: 4096, diskSizeGb: 32 });
    expect(forked.automationId).toBeUndefined();

    const images = await ctx.store.loadImages();
    expect(images.some((image) => image.id === forked.imageId)).toBe(true);

    const draft = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      imageId: forked.imageId,
      startVm: false,
    });
    const copy = (await (
      await ctx.app.request(`/api/sessions/${draft.id}/fork`, { method: "POST" })
    ).json()) as AgentSession;
    expect(copy.imageId).toBe(forked.imageId);
    expect(copy.vmId).toBeUndefined();
    ctx.hypervisor.shutdown();
  });

  it("duplicates a host design canvas without sharing the workspace or chat", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      title: "Landing",
      kind: "design",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      persona: { displayName: "Pixel", hubRole: "Designer" },
      startVm: false,
    });
    const srcDir = join(ctx.dir, "host-workspaces", created.id);
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "index.html"), "<html><body>Hero copy</body></html>");

    const forkedRes = await ctx.app.request(`/api/sessions/${created.id}/fork`, { method: "POST" });
    expect(forkedRes.status).toBe(201);
    const forked = (await forkedRes.json()) as AgentSession;
    expect(forked.id).not.toBe(created.id);
    expect(forked.kind).toBe("design");
    expect(forked.runtime).toBe("host");
    expect(forked.title).toBe("Landing fork");
    expect(forked.messages).toEqual([]);
    expect(forked.persona?.displayName).toBe("Pixel");
    expect(forked.hostDir).toBeFalsy();
    expect(
      await readFile(join(ctx.dir, "host-workspaces", forked.id, "index.html"), "utf8"),
    ).toContain("Hero copy");
    expect(await readFile(join(srcDir, "index.html"), "utf8")).toContain("Hero copy");
  });

  it("duplicates a stopped docker game from the workspace tree", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      title: "Arcade",
      kind: "game",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const srcDir = dockerWorkspaceDir(ctx.dir, created.id);
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "index.html"), "<html><body>Score 12</body></html>");

    const forkedRes = await ctx.app.request(`/api/sessions/${created.id}/fork`, { method: "POST" });
    expect(forkedRes.status).toBe(201);
    const forked = (await forkedRes.json()) as AgentSession;
    expect(forked.kind).toBe("game");
    expect(forked.messages).toEqual([]);
    expect(
      await readFile(join(dockerWorkspaceDir(ctx.dir, forked.id), "index.html"), "utf8"),
    ).toContain("Score 12");
  });

  it("links two sessions as an A/B compare", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const input = {
      os: "ubuntu" as const,
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    };
    const a = await ctx.sessions.create({ ...input, title: "A" });
    const b = await ctx.sessions.create({ ...input, title: "B" });
    const linked = await ctx.app.request(`/api/sessions/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ compare: { groupId: "g1", role: "A", peerId: b.id } }),
    });
    expect(linked.status).toBe(200);
    expect(((await linked.json()) as AgentSession).compare).toEqual({
      groupId: "g1",
      role: "A",
      peerId: b.id,
    });
    const bad = await ctx.app.request(`/api/sessions/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ compare: { role: "C" } }),
    });
    expect(bad.status).toBe(400);
    const cleared = await ctx.app.request(`/api/sessions/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ compare: null }),
    });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as AgentSession).compare).toBeUndefined();
  });

  it("spawns parallel Docker workers from a workspace snapshot", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const ubuntu = config.templates.find((t) => t.os === "ubuntu")!;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: ubuntu.id,
        runtime: "docker",
        dockerImage: "ubuntu:24.04",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as AgentSession;
    await waitUntilDockerRunning(ctx.sessions, session.id);
    const spawned = await ctx.app.request(`/api/sessions/${session.id}/workers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 2, prompt: "fix the tests" }),
    });
    expect(spawned.status).toBe(201);
    const workers = (await spawned.json()) as AgentSession[];
    expect(workers).toHaveLength(2);
    expect(workers[0]?.imageId).toBeTruthy();
    expect(workers[1]?.imageId).toBe(workers[0]?.imageId);
    expect(workers[0]?.compare?.kind).toBe("workers");
    expect(workers[0]?.compare?.memberIds).toEqual(workers.map((row) => row.id));
    expect(workers[0]?.runtime).toBe("docker");
    expect(
      workers.some((row) => row.messages.some((m) => m.content.includes("fix the tests"))),
    ).toBe(true);

    const tooMany = await ctx.app.request(`/api/sessions/${session.id}/workers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 9, prompt: "x" }),
    });
    expect(tooMany.status).toBe(400);

    const vm = await ctx.sessions.create({
      os: "ubuntu",
      templateId: ubuntu.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const vmWorkers = await ctx.app.request(`/api/sessions/${vm.id}/workers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 2, prompt: "x" }),
    });
    expect(vmWorkers.status).toBe(400);

    const again = await ctx.app.request(`/api/sessions/${workers[0]!.id}/workers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 2, prompt: "x" }),
    });
    expect(again.status).toBe(400);

    expect(workers[0]?.compare?.parentId).toBe(session.id);
    expect(workers[0]?.compare?.branch).toMatch(/^locus\/worker-/);
    const parentLive = (await (
      await ctx.app.request(`/api/sessions/${session.id}`)
    ).json()) as AgentSession;
    expect(parentLive.compare?.kind).toBe("workers");
    expect(parentLive.compare?.role).toBe("parent");
    expect(parentLive.compare?.memberIds).toEqual(workers.map((row) => row.id));
    const diffs = await ctx.app.request(`/api/sessions/${workers[0]!.id}/workers/diff`);
    expect(diffs.status).toBe(200);
    const diffBody = (await diffs.json()) as Array<{ id: string; diff: string }>;
    expect(diffBody.length).toBeGreaterThanOrEqual(2);
    const merged = await ctx.app.request(`/api/sessions/${session.id}/workers/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workerId: workers[0]!.id }),
    });
    expect(merged.status).toBe(200);
    const parent = (await merged.json()) as AgentSession;
    expect(parent.id).toBe(session.id);
    expect(parent.messages.some((m) => m.content.includes("Merged worker"))).toBe(true);
  });

  it("defaults guest network to restricted when starting from a golden image", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      imageId: "img-1",
      startVm: false,
    });
    expect(created.network).toBe("restricted");
    const patched = await ctx.app.request(`/api/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ network: "none" }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as AgentSession).network).toBe("none");
    ctx.hypervisor.shutdown();
  });

  it("loads a managed policy, blocks Host agents, and keeps policy off config.json", async () => {
    const prev = process.env.LOCUS_POLICY_PATH;
    const policyDir = await mkdtemp(join(tmpdir(), "locus-policy-"));
    const policyPath = join(policyDir, "policy.json");
    await writeFile(policyPath, JSON.stringify({ version: 1 }));
    process.env.LOCUS_POLICY_PATH = policyPath;
    try {
      const ctx = await setup();
      cleanup.push(ctx.dir, policyDir);
      const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
      expect(config.managedPolicy?.active).toBe(true);
      expect(config.managedPolicy?.policy.name).toBeUndefined();
      const created = await ctx.app.request("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          os: "ubuntu",
          templateId: config.templates[0]!.id,
          providerId: config.providers[0]!.id,
          model: config.providers[0]!.defaultModel,
          startVm: false,
          runtime: "host",
        }),
      });
      expect(created.status).toBe(400);
      expect(((await created.json()) as { error?: string }).error).toMatch(/Host agents/);
      const disk = JSON.parse(await readFile(join(ctx.dir, "config.json"), "utf8")) as LocusConfig;
      expect(disk.managedPolicy).toBeUndefined();
      ctx.hypervisor.shutdown();
    } finally {
      if (prev === undefined) delete process.env.LOCUS_POLICY_PATH;
      else process.env.LOCUS_POLICY_PATH = prev;
    }
  });

  it("revokes all integration tokens and exports session audit", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.integrations = [
      {
        id: "jira-1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://ex.atlassian.net",
        token: "ATATT-secret",
      },
    ];
    await ctx.store.saveConfig(config);
    const refused = await ctx.app.request("/api/integrations/revoke-all", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "nope" }),
    });
    expect(refused.status).toBe(400);
    const revoked = await ctx.app.request("/api/integrations/revoke-all", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "REVOKE" }),
    });
    expect(revoked.status).toBe(200);
    const after = (await revoked.json()) as { config: LocusConfig };
    expect(after.config.integrations?.[0]?.token).toBeUndefined();

    const session = await createIdleSession(ctx);
    const traces = new SessionTraceLog(ctx.dir);
    await traces.write({
      t: "2026-11-06T00:00:00.000Z",
      kind: "egress",
      sessionId: session.id,
      name: "allow",
      detail: "api.anthropic.com:443",
      args: { bytesSent: 42 },
    });
    await traces.write({
      t: "2026-11-06T00:01:00.000Z",
      kind: "approval",
      sessionId: session.id,
      name: "approved",
      args: { tool: "git_push", by: "operator" },
    });
    const egress = await ctx.app.request(`/api/sessions/${session.id}/audit/egress`);
    expect(egress.status).toBe(200);
    const summary = (await egress.json()) as { hosts: Array<{ host: string }>; bytesSent: number };
    expect(summary.bytesSent).toBe(42);
    expect(summary.hosts[0]?.host).toBe("api.anthropic.com");
    const approvals = await ctx.app.request(`/api/sessions/${session.id}/audit/approvals`);
    expect(approvals.status).toBe(200);
    const exported = (await approvals.json()) as {
      approvals: Array<{ tool: string; decision: string }>;
    };
    expect(exported.approvals[0]).toMatchObject({ tool: "git_push", decision: "approved" });
    ctx.hypervisor.shutdown();
  });

  it("refuses audit exports from a paired LAN phone", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.phoneRemote = { enabled: true, token: "ph_secret" };
    await ctx.store.saveConfig(config);
    const session = await createIdleSession(ctx);
    const lan = createApp({
      store: ctx.store,
      sessions: ctx.sessions,
      hypervisor: ctx.hypervisor,
      peerAddress: () => "192.168.1.20",
    });
    const headers = {
      origin: "http://192.168.1.8:7420",
      authorization: "Bearer ph_secret",
    };
    const egress = await lan.request(`/api/sessions/${session.id}/audit/egress`, { headers });
    expect(egress.status).toBe(403);
    expect(((await egress.json()) as { error?: string }).error).toMatch(/desktop-only/);
    const approvals = await lan.request(`/api/sessions/${session.id}/audit/approvals`, { headers });
    expect(approvals.status).toBe(403);
    const fleet = await lan.request("/api/audit/approvals", { headers });
    expect(fleet.status).toBe(403);
    ctx.hypervisor.shutdown();
  });
});
