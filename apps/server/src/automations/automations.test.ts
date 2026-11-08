import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import {
  computeNextRunAt,
  formatSchedule,
  LIFETIME_CAP_SKIP_REASON,
  MAX_AUTOMATION_CHATS,
  type AgentSession,
  type AutomationEvent,
} from "@locus/shared";
import type { CompleteRequest } from "@locus/providers";
import { AutomationService } from "./automations.js";
import { Hub } from "../core/hub.js";
import { SessionService, type ChatEngine } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";

function locusSecret(secret: string | undefined) {
  return { secret, timestamp: String(Math.floor(Date.now() / 1000)) };
}

async function setup(now = () => new Date("2026-08-17T12:00:00.000Z"), chatEngine?: ChatEngine) {
  const dir = await mkdtemp(join(tmpdir(), "locus-auto-"));
  const store = new JsonStore(dir);
  await store.init();
  const hypervisor = new MockHypervisor(dir);
  const hub = new Hub();
  const sessions = new SessionService(store, hypervisor, hub, chatEngine);
  const automations = new AutomationService(store, sessions, hub, {
    now,
    waitMs: 4000,
    pollMs: 20,
  });
  return { dir, store, hypervisor, sessions, automations };
}

let cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.map((d) =>
      rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }).catch(() => undefined),
    ),
  );
  cleanup = [];
});

describe("computeNextRunAt", () => {
  it("adds interval minutes", () => {
    const from = new Date("2026-08-17T12:00:00.000Z");
    expect(computeNextRunAt({ kind: "interval", everyMinutes: 30 }, from).toISOString()).toBe(
      "2026-08-17T12:30:00.000Z",
    );
  });

  it("rolls daily time to the next day when already past", () => {
    const from = new Date("2026-08-17T10:00:00");
    const next = computeNextRunAt({ kind: "daily", hour: 9, minute: 0 }, from);
    expect(next.getHours()).toBe(9);
    expect(next.getDate()).toBe(from.getDate() + 1);
  });

  it("formats schedules", () => {
    expect(formatSchedule({ kind: "interval", everyMinutes: 15 })).toBe("Every 15 minutes");
    expect(formatSchedule({ kind: "daily", hour: 9, minute: 5 })).toBe("Daily at 09:05");
    expect(formatSchedule({ kind: "weekly", weekday: 1, hour: 18, minute: 0 })).toBe(
      "Weekly on Monday at 18:00",
    );
    expect(formatSchedule({ kind: "forge" })).toBe("On git push");
    expect(formatSchedule({ kind: "pull_request" })).toBe("On pull request");
    expect(formatSchedule({ kind: "webhook" })).toBe("On webhook");
    expect(formatSchedule({ kind: "cron", expr: "0 9 * * 1" })).toBe("Cron 0 9 * * 1");
    expect(
      formatSchedule({
        kind: "adaptive",
        startHour: 9,
        startMinute: 0,
        endHour: 17,
        endMinute: 0,
        everyMinutes: 60,
        otherwiseEveryMinutes: 180,
      }),
    ).toBe("Every hour 09:00–17:00, otherwise every 3 hours");
    const from = new Date("2026-08-20T12:00:00.000Z");
    expect(computeNextRunAt({ kind: "cron", expr: "0 9 * * *" }, from).getTime()).toBeGreaterThan(
      from.getTime(),
    );
  });
});

describe("AutomationService", () => {
  it("creates an automation and runs it into a chat session", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const template = config.templates.find((t) => t.os === "ubuntu")!;
    const provider = config.providers[0]!;
    const created = await ctx.automations.create({
      name: "Nightly lint",
      prompt: "run the linter",
      os: "ubuntu",
      templateId: template.id,
      providerId: provider.id,
      model: provider.defaultModel,
      schedule: { kind: "daily", hour: 9, minute: 0 },
    });
    expect(created.nextRunAt).toBeTruthy();
    expect(created.enabled).toBe(true);

    const run = await ctx.automations.execute(created.id, "manual");
    expect(run.status).toBe("succeeded");
    expect(run.sessionId).toBeTruthy();
    const session = await ctx.sessions.get(run.sessionId!);
    expect(session?.title).toBe("Nightly lint");
    expect(session?.automationId).toBe(created.id);
    expect(session?.messages.some((m) => m.role === "user" && m.content === "run the linter")).toBe(
      true,
    );
    ctx.hypervisor.shutdown();
  });

  it("refuses Run now while paused", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Nightly lint",
      prompt: "run the linter",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "daily", hour: 9, minute: 0 },
    });
    await ctx.automations.patch(created.id, { enabled: false });
    await expect(ctx.automations.execute(created.id, "manual")).rejects.toThrow(/paused/);
    expect(await ctx.automations.listRuns(created.id)).toHaveLength(0);
    ctx.hypervisor.shutdown();
  });

  it("posts notify as the signed-in Slack user when a channel is set", async () => {
    const posts: Array<{ url: string; body: string }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      posts.push({ url: String(input), body: String(init?.body ?? "") });
      if (String(input).includes("chat.postMessage")) {
        return new Response(JSON.stringify({ ok: true, ts: "9.1", channel: "C_OPS" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("ok", { status: 200 });
    };
    const dir = await mkdtemp(join(tmpdir(), "locus-auto-notify-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const sessions = new SessionService(store, hypervisor, hub);
    const automations = new AutomationService(store, sessions, hub, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      waitMs: 4000,
      pollMs: 20,
      fetch: fetchMock,
    });
    const config = await store.loadConfig();
    config.integrations = [
      {
        id: "slack-1",
        kind: "slack",
        name: "Slack",
        enabled: true,
        baseUrl: "https://slack.com/api",
        userToken: "xoxp-notify-user",
        userId: "U_YOU",
        userName: "you",
      },
    ];
    await store.saveConfig(config);
    const created = await automations.create({
      name: "Nightly lint",
      prompt: "run the linter",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "daily", hour: 9, minute: 0 },
      notifyChannel: "C_OPS",
      startVm: false,
    });
    const run = await automations.execute(created.id, "manual");
    expect(run.status).toBe("succeeded");
    const posted = posts.find((row) => row.url.includes("chat.postMessage"));
    expect(posted).toBeTruthy();
    expect(JSON.parse(posted!.body)).toMatchObject({
      channel: "C_OPS",
      text: expect.stringContaining("Nightly lint"),
    });
    expect(posts.every((row) => !row.url.includes("hooks.slack.com"))).toBe(true);
    hypervisor.shutdown();
  });

  it("skips Slack notify on success when failures-only is on", async () => {
    const posts: Array<{ url: string; body: string }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      posts.push({ url: String(input), body: String(init?.body ?? "") });
      if (String(input).includes("chat.postMessage")) {
        return new Response(JSON.stringify({ ok: true, ts: "9.1", channel: "C_OPS" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("ok", { status: 200 });
    };
    const dir = await mkdtemp(join(tmpdir(), "locus-auto-notify-failonly-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const sessions = new SessionService(store, hypervisor, hub);
    const automations = new AutomationService(store, sessions, hub, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      waitMs: 4000,
      pollMs: 20,
      fetch: fetchMock,
    });
    const config = await store.loadConfig();
    config.notifyAutomationsFailedOnly = true;
    config.integrations = [
      {
        id: "slack-1",
        kind: "slack",
        name: "Slack",
        enabled: true,
        baseUrl: "https://slack.com/api",
        userToken: "xoxp-notify-user",
        userId: "U_YOU",
        userName: "you",
      },
    ];
    await store.saveConfig(config);
    const created = await automations.create({
      name: "Nightly lint",
      prompt: "run the linter",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "daily", hour: 9, minute: 0 },
      notifyChannel: "C_OPS",
      startVm: false,
    });
    const run = await automations.execute(created.id, "manual");
    expect(run.status).toBe("succeeded");
    expect(posts.some((row) => row.url.includes("chat.postMessage"))).toBe(false);
    hypervisor.shutdown();
  });

  it("falls back to the notify webhook when the Slack channel is not allowed", async () => {
    const posts: Array<{ url: string; body: string }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      posts.push({ url: String(input), body: String(init?.body ?? "") });
      if (String(input).includes("chat.postMessage")) {
        return new Response(JSON.stringify({ ok: true, ts: "9.1", channel: "C_OPS" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("ok", { status: 200 });
    };
    const dir = await mkdtemp(join(tmpdir(), "locus-auto-notify-allow-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const sessions = new SessionService(store, hypervisor, hub);
    const automations = new AutomationService(store, sessions, hub, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      waitMs: 4000,
      pollMs: 20,
      fetch: fetchMock,
    });
    const config = await store.loadConfig();
    config.integrations = [
      {
        id: "slack-1",
        kind: "slack",
        name: "Slack",
        enabled: true,
        baseUrl: "https://slack.com/api",
        userToken: "xoxp-notify-user",
        userId: "U_YOU",
        userName: "you",
        allowedSlackChannelIds: ["C_ENG"],
      },
    ];
    await store.saveConfig(config);
    const created = await automations.create({
      name: "Nightly lint",
      prompt: "run the linter",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "daily", hour: 9, minute: 0 },
      notifyChannel: "C_OPS",
      notifyWebhook: "https://hooks.slack.com/services/T000/B000/xxx",
      startVm: false,
    });
    const run = await automations.execute(created.id, "manual");
    expect(run.status).toBe("succeeded");
    expect(posts.some((row) => row.url.includes("chat.postMessage"))).toBe(false);
    const hooked = posts.find((row) => row.url.includes("hooks.slack.com"));
    expect(hooked).toBeTruthy();
    expect(JSON.parse(hooked!.body)).toMatchObject({
      text: expect.stringContaining("Nightly lint"),
    });
    hypervisor.shutdown();
  });

  it("creates an adaptive schedule and stamps the next run", async () => {
    const ctx = await setup(() => new Date(2026, 7, 17, 8, 0, 0, 0));
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Peak-hour digest",
      prompt: "summarize inbox",
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: {
        kind: "adaptive",
        startHour: 9,
        startMinute: 0,
        endHour: 17,
        endMinute: 0,
        everyMinutes: 60,
        otherwiseEveryMinutes: 180,
      },
    });
    expect(created.schedule).toEqual({
      kind: "adaptive",
      startHour: 9,
      startMinute: 0,
      endHour: 17,
      endMinute: 0,
      everyMinutes: 60,
      otherwiseEveryMinutes: 180,
    });
    expect(created.nextRunAt).toBe(new Date(2026, 7, 17, 9, 0, 0, 0).toISOString());
    ctx.hypervisor.shutdown();
  });

  it("runs a Docker automation against a container", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Container lint",
      prompt: "run tests",
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    expect(created.runtime).toBe("docker");
    expect(created.dockerImage).toBe("node:22-bookworm");
    const run = await ctx.automations.execute(created.id, "manual");
    expect(run.status).toBe("succeeded");
    const session = await ctx.sessions.get(run.sessionId!);
    expect(session?.runtime).toBe("docker");
    expect(session?.dockerImage).toBe("node:22-bookworm");
    ctx.hypervisor.shutdown();
  });

  it("runs a host automation without a VM or container", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Host digest",
      prompt: "summarize inbox",
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      runtime: "host",
      startVm: true,
      reuseSession: true,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    expect(created.runtime).toBe("host");
    expect(created.startVm).toBe(false);
    expect(created.dockerImage).toBeUndefined();
    const run = await ctx.automations.execute(created.id, "manual");
    expect(run.status).toBe("succeeded");
    const session = await ctx.sessions.get(run.sessionId!);
    expect(session?.runtime).toBe("host");
    expect(session?.vmId).toBeFalsy();
    expect(session?.title).toBe("Host digest");
    expect(ctx.sessions.listMachines()).toEqual([]);
    const second = await ctx.automations.execute(created.id, "manual");
    expect(second.status).toBe("succeeded");
    expect(second.sessionId).toBe(run.sessionId);
    ctx.hypervisor.shutdown();
  });

  it("runs a host automation in a chosen folder", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const folder = await mkdtemp(join(tmpdir(), "locus-auto-host-"));
    cleanup.push(folder);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Host digest",
      prompt: "summarize inbox",
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      runtime: "host",
      hostDir: folder,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    expect(created.hostDir).toBe(await realpath(folder));
    const run = await ctx.automations.execute(created.id, "manual");
    expect(run.status).toBe("succeeded");
    const session = await ctx.sessions.get(run.sessionId!);
    expect(session?.hostDir).toBe(created.hostDir);
    ctx.hypervisor.shutdown();
  });

  it("patches a Docker automation onto host and drops guest fields", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Switch",
      prompt: "hello",
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const patched = await ctx.automations.patch(created.id, { runtime: "host", startVm: true });
    expect(patched.runtime).toBe("host");
    expect(patched.startVm).toBe(false);
    expect(patched.dockerImage).toBeUndefined();
    ctx.hypervisor.shutdown();
  });

  it("rotates a webhook secret and refuses it on clock jobs", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Ops hook",
      prompt: "summarize",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "webhook" },
    });
    const first = created.webhookSecret;
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    const rotated = await ctx.automations.patch(created.id, { rotateWebhookSecret: true });
    expect(rotated.webhookSecret).toMatch(/^[a-f0-9]{32}$/);
    expect(rotated.webhookSecret).not.toBe(first);
    const clock = await ctx.automations.create({
      name: "Daily",
      prompt: "ping",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "daily", hour: 9, minute: 0 },
    });
    await expect(ctx.automations.patch(clock.id, { rotateWebhookSecret: true })).rejects.toThrow(
      /secret to rotate/,
    );
    ctx.hypervisor.shutdown();
  });

  it("clones a job with a new webhook secret and no memories", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Ops hook",
      prompt: "summarize",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "webhook" },
      notifyChannel: "C_OPS",
      persistMemory: true,
    });
    await ctx.automations.patch(created.id, {
      memories: [{ id: "m1", text: "pager is loud", createdAt: "2026-09-01T00:00:00.000Z" }],
      slackSigningSecret: "slack-secret-one",
    });
    const copy = await ctx.automations.clone(created.id);
    expect(copy.id).not.toBe(created.id);
    expect(copy.name).toBe("Ops hook copy");
    expect(copy.prompt).toBe("summarize");
    expect(copy.notifyChannel).toBe("C_OPS");
    expect(copy.persistMemory).toBe(true);
    expect(copy.memories).toBeUndefined();
    expect(copy.webhookSecret).toMatch(/^[a-f0-9]{32}$/);
    expect(copy.webhookSecret).not.toBe(created.webhookSecret);
    expect(copy.slackSigningSecret).toBe("slack-secret-one");
    await expect(ctx.automations.clone("missing")).rejects.toThrow(/not found/);
    ctx.hypervisor.shutdown();
  });

  it("records a skipped test webhook and refuses clock jobs", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const hook = await ctx.automations.create({
      name: "Ops hook",
      prompt: "summarize",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "webhook" },
    });
    const run = await ctx.automations.testWebhook(hook.id);
    expect(run.status).toBe("skipped");
    expect(run.trigger).toBe("webhook");
    expect(run.error).toMatch(/No agent run/);
    expect(await ctx.automations.listRuns(hook.id)).toHaveLength(1);
    await ctx.automations.patch(hook.id, { enabled: false });
    await expect(ctx.automations.testWebhook(hook.id)).rejects.toThrow(/paused/);
    const clock = await ctx.automations.create({
      name: "Daily",
      prompt: "ping",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "daily", hour: 9, minute: 0 },
    });
    await expect(ctx.automations.testWebhook(clock.id)).rejects.toThrow(
      /not triggered by webhooks/,
    );
    ctx.hypervisor.shutdown();
  });

  it("skips overlapping runs", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Busy",
      prompt: "hello",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 5 },
    });
    const first = ctx.automations.execute(created.id, "manual");
    const second = await ctx.automations.execute(created.id, "manual");
    expect(second.status).toBe("skipped");
    const done = await first;
    expect(done.status).toBe("succeeded");
    ctx.hypervisor.shutdown();
  });

  it("fires due scheduled automations on tick", async () => {
    const current = new Date("2026-08-17T12:00:00.000Z");
    const ctx = await setup(() => current);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Due",
      prompt: "ping",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 10 },
    });
    created.nextRunAt = "2026-08-17T11:59:00.000Z";
    await ctx.store.replaceAutomation(created);
    await ctx.automations.tick();
    const runs = await waitForRuns(ctx.automations, created.id, (rows) =>
      rows.some((r) => r.status === "succeeded" && r.trigger === "schedule"),
    );
    expect(runs[0]?.status).toBe("succeeded");
    expect(runs[0]?.trigger).toBe("schedule");
    ctx.hypervisor.shutdown();
  });

  it("rejects an empty prompt", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    await expect(
      ctx.automations.create({
        name: "Empty",
        prompt: "   ",
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        schedule: { kind: "interval", everyMinutes: 10 },
      }),
    ).rejects.toThrow(/Prompt/);
  });

  it("does not resurrect an automation deleted during a run", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Doomed",
      prompt: "hello",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 5 },
    });
    const pending = ctx.automations.execute(created.id, "manual");
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const runs = await ctx.automations.listRuns(created.id);
      if (runs.some((r) => r.status === "running")) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await ctx.automations.remove(created.id);
    await pending;
    expect(await ctx.automations.get(created.id)).toBeUndefined();
    expect(await ctx.automations.listRuns(created.id)).toHaveLength(0);
    ctx.hypervisor.shutdown();
  });

  it("ignores overlapping ticks instead of recording a skip", async () => {
    const current = new Date("2026-08-17T12:00:00.000Z");
    const ctx = await setup(() => current);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Once",
      prompt: "ping",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 10 },
    });
    created.nextRunAt = "2026-08-17T11:59:00.000Z";
    await ctx.store.replaceAutomation(created);
    await Promise.all([ctx.automations.tick(), ctx.automations.tick()]);
    const runs = await waitForRuns(ctx.automations, created.id, (rows) =>
      rows.some((r) => r.status === "succeeded"),
    );
    expect(runs.filter((r) => r.trigger === "schedule")).toHaveLength(1);
    expect(runs[0]?.status).toBe("succeeded");
    expect(runs[0]?.trigger).toBe("schedule");
    ctx.hypervisor.shutdown();
  });

  it("rejects a template that does not match the OS on patch", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "OS",
      prompt: "hi",
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 10 },
    });
    await expect(
      ctx.automations.patch(created.id, {
        os: "windows-11",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      }),
    ).rejects.toThrow(/Template OS/);
    ctx.hypervisor.shutdown();
  });

  it("reuses the previous session when reuseSession is set", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Warm",
      prompt: "again",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      reuseSession: true,
      allowedMcpTools: ["mcp_jira_search"],
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const first = await ctx.automations.execute(created.id, "manual");
    await ctx.automations.patch(created.id, { allowedMcpTools: ["mcp_confluence_search"] });
    const second = await ctx.automations.execute(created.id, "manual");
    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    expect(second.sessionId).toBe(first.sessionId);
    const session = await ctx.sessions.get(second.sessionId!);
    expect(session?.allowedMcpTools).toEqual(["mcp_confluence_search"]);
    ctx.hypervisor.shutdown();
  });

  it("stores persistMemory off by default and on when requested", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Plain",
      prompt: "hello",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    expect(created.persistMemory).toBeUndefined();
    const patched = await ctx.automations.patch(created.id, { persistMemory: true });
    expect(patched.persistMemory).toBe(true);
    const off = await ctx.automations.patch(created.id, { persistMemory: false });
    expect(off.persistMemory).toBeUndefined();
    ctx.hypervisor.shutdown();
  });

  it("lets the operator add, edit, and remove saved facts", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Nightly",
      prompt: "check the build",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      persistMemory: true,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const added = await ctx.automations.patch(created.id, {
      memories: [{ id: "m1", text: "Uses Vite", createdAt: "2026-08-17T12:00:00.000Z" }],
    });
    expect(added.memories?.map((row) => row.text)).toEqual(["Uses Vite"]);
    const edited = await ctx.automations.patch(created.id, {
      memories: [{ id: "m1", text: "Uses Vite and React", createdAt: "2026-08-17T12:00:00.000Z" }],
    });
    expect(edited.memories?.map((row) => row.text)).toEqual(["Uses Vite and React"]);
    await expect(
      ctx.automations.patch(created.id, {
        memories: [
          {
            id: "m1",
            text: "token: sk-live-abcdefghijklmnopqrstuvwxyz",
            createdAt: "2026-08-17T12:00:00.000Z",
          },
        ],
      }),
    ).rejects.toThrow(/Refusing to store a secret/);
    const cleared = await ctx.automations.patch(created.id, { memories: [] });
    expect(cleared.memories).toBeUndefined();
    ctx.hypervisor.shutdown();
  });

  it("carries remember facts into the next run when persistMemory is on", async () => {
    const systems: string[] = [];
    const extras: string[][] = [];
    let added = false;
    async function* engine(req: CompleteRequest) {
      systems.push(req.system);
      extras.push((req.extraTools ?? []).map((tool) => tool.name));
      if (!added && (req.extraTools ?? []).some((tool) => tool.name === "remember")) {
        added = true;
        yield {
          type: "tool_call" as const,
          id: "r1",
          name: "remember",
          arguments: { action: "add", text: "Uses Vite" },
        };
        return;
      }
      yield { type: "text" as const, text: "done" };
    }
    const ctx = await setup(undefined, engine);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.providers[0]!.apiKey = "sk-test";
    await ctx.store.saveConfig(config);
    const created = await ctx.automations.create({
      name: "Nightly",
      prompt: "check the build",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      persistMemory: true,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    expect(created.persistMemory).toBe(true);
    const first = await ctx.automations.execute(created.id, "manual");
    expect(first.status).toBe("succeeded");
    const afterFirst = await ctx.automations.get(created.id);
    expect(afterFirst?.memories?.map((row) => row.text)).toEqual(["Uses Vite"]);
    expect(afterFirst?.memories?.[0]?.runId).toBe(first.id);
    const second = await ctx.automations.execute(created.id, "manual");
    expect(second.status).toBe("succeeded");
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(extras.some((names) => names.includes("remember"))).toBe(true);
    expect(systems.some((system) => system.includes("Uses Vite"))).toBe(true);
    ctx.hypervisor.shutdown();
  });

  it("rewinds a reused session that entered an error state", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Resume",
      prompt: "again",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      reuseSession: true,
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const first = await ctx.automations.execute(created.id, "manual");
    expect(first.status).toBe("succeeded");
    await ctx.store.mutateSession(first.sessionId!, (current) => {
      current.status = "error";
      current.error = "Guest entered an error state.";
    });
    const second = await ctx.automations.execute(created.id, "manual");
    expect(second.status).toBe("succeeded");
    expect(second.sessionId).toBe(first.sessionId);
    expect((await ctx.sessions.get(second.sessionId!))?.status).not.toBe("error");
    ctx.hypervisor.shutdown();
  });

  it.skipIf(process.platform === "win32")(
    "runs a forge automation from a signed webhook and from a new commit poll",
    async () => {
      let sha = "aaa111";
      const fetchMock: typeof fetch = async (input) => {
        const url = String(input);
        if (url.includes("/commits/")) {
          return new Response(JSON.stringify({ sha }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("nope", { status: 404 });
      };
      const dir = await mkdtemp(join(tmpdir(), "locus-auto-"));
      cleanup.push(dir);
      const store = new JsonStore(dir);
      await store.init();
      const hypervisor = new MockHypervisor(dir);
      const hub = new Hub();
      const sessions = new SessionService(store, hypervisor, hub);
      const automations = new AutomationService(store, sessions, hub, {
        now: () => new Date("2026-08-17T12:00:00.000Z"),
        waitMs: 4000,
        pollMs: 20,
        fetch: fetchMock,
      });
      const config = await store.loadConfig();
      config.forges[0]!.token = "ghs_test";
      await store.saveConfig(config);

      await expect(
        automations.create({
          name: "On push",
          prompt: "review the diff",
          os: "ubuntu",
          templateId: config.templates[0]!.id,
          providerId: config.providers[0]!.id,
          model: config.providers[0]!.defaultModel,
          schedule: { kind: "forge" },
        }),
      ).rejects.toThrow(/repository/);

      const created = await automations.create({
        name: "On push",
        prompt: "review the diff",
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
        schedule: { kind: "forge" },
      });
      expect(created.nextRunAt).toBeUndefined();
      expect(created.webhookSecret).toMatch(/^[a-f0-9]{32}$/);

      await expect(
        automations.handleWebhook(created.id, { secret: "nope", raw: "{}" }),
      ).rejects.toThrow(/Invalid webhook/);

      const ping = await automations.handleWebhook(created.id, {
        ...locusSecret(created.webhookSecret),
        event: "ping",
        raw: "{}",
      });
      expect(ping.ping).toBe(true);
      expect(await automations.listRuns(created.id)).toHaveLength(0);

      const queued = await automations.handleWebhook(created.id, {
        ...locusSecret(created.webhookSecret),
        event: "push",
        raw: JSON.stringify({
          ref: "refs/heads/main",
          after: "bbb222",
          repository: { clone_url: "https://github.com/acme/app.git" },
        }),
      });
      expect(queued.queued).toBe(true);
      const deadline = Date.now() + 4000;
      let runs = await automations.listRuns(created.id);
      while (Date.now() < deadline) {
        runs = await automations.listRuns(created.id);
        if (runs.some((r) => r.status === "succeeded" && r.trigger === "forge")) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(runs[0]?.trigger).toBe("forge");
      expect(runs[0]?.status).toBe("succeeded");

      sha = "bbb222";
      await automations.tick();
      expect(await automations.listRuns(created.id)).toHaveLength(1);
      sha = "ccc333";
      await automations.tick();
      const afterPoll = await waitForRuns(
        automations,
        created.id,
        (rows) => rows.length >= 2 && rows.every((r) => r.status !== "running"),
      );
      expect(afterPoll).toHaveLength(2);
      expect(afterPoll[0]?.trigger).toBe("forge");
      hypervisor.shutdown();
    },
  );

  it("creates pull-request automations and posts a notify webhook", async () => {
    const posts: string[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("hooks.example")) {
        posts.push(String(init?.body ?? ""));
        return new Response("ok", { status: 200 });
      }
      return new Response(JSON.stringify([{ number: 12, updated_at: "2026-08-20T00:00:00Z" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const dir = await mkdtemp(join(tmpdir(), "locus-auto-pr-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const sessions = new SessionService(store, hypervisor, hub);
    const automations = new AutomationService(store, sessions, hub, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      waitMs: 4000,
      pollMs: 20,
      fetch: fetchMock,
    });
    const config = await store.loadConfig();
    const created = await automations.create({
      name: "On PR",
      prompt: "review the PR",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      repo: { forge: "github", url: "https://github.com/acme/app.git" },
      schedule: { kind: "pull_request" },
      notifyWebhook: "https://hooks.example/locus",
      maxUsd: 2,
      autonomy: "autonomous",
    });
    expect(created.webhookSecret).toBeTruthy();
    expect(created.nextRunAt).toBeUndefined();
    expect(created.maxUsd).toBe(2);
    expect(created.autonomy).toBe("autonomous");
    const run = await automations.execute(created.id, "pull_request");
    expect(run.status).toBe("succeeded");
    expect(posts.some((body) => body.includes("On PR"))).toBe(true);
    hypervisor.shutdown();
  });

  it("queues a generic webhook, injects the event, and posts a Slack-shaped notify body", async () => {
    const posts: string[] = [];
    const fetchMock: typeof fetch = async (_input, init) => {
      posts.push(String(init?.body ?? ""));
      return new Response("ok", { status: 200 });
    };
    const dir = await mkdtemp(join(tmpdir(), "locus-auto-hook-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const sessions = new SessionService(store, hypervisor, hub);
    const automations = new AutomationService(store, sessions, hub, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      waitMs: 4000,
      pollMs: 20,
      fetch: fetchMock,
    });
    const config = await store.loadConfig();
    const created = await automations.create({
      name: "Ops research",
      prompt: "summarize this event",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "webhook" },
      notifyWebhook: "https://hooks.slack.com/services/T000/B000/xxx",
      allowedMcpTools: ["mcp_jira_search"],
      allowHosts: ["your-domain.atlassian.net"],
      startVm: false,
    });
    expect(created.webhookSecret).toMatch(/^[a-f0-9]{32}$/);
    expect(created.nextRunAt).toBeUndefined();
    expect(created.allowedMcpTools).toEqual(["mcp_jira_search"]);
    expect(created.allowHosts).toEqual(["your-domain.atlassian.net"]);

    await expect(
      automations.handleWebhook(created.id, { secret: "nope", raw: "{}" }),
    ).rejects.toThrow(/Invalid webhook/);

    const challenge = await automations.handleWebhook(created.id, {
      ...locusSecret(created.webhookSecret),
      raw: JSON.stringify({ type: "url_verification", challenge: "abc-123" }),
    });
    expect(challenge.challenge).toBe("abc-123");
    expect(await automations.listRuns(created.id)).toHaveLength(0);

    const queued = await automations.handleWebhook(created.id, {
      ...locusSecret(created.webhookSecret),
      raw: JSON.stringify({ text: "checkout is down", channel: "#ops" }),
    });
    expect(queued.queued).toBe(true);
    const deadline = Date.now() + 4000;
    let runs = await automations.listRuns(created.id);
    while (Date.now() < deadline) {
      runs = await automations.listRuns(created.id);
      if (runs.some((r) => r.status === "succeeded" && r.trigger === "webhook")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(runs[0]?.trigger).toBe("webhook");
    expect(runs[0]?.status).toBe("succeeded");
    const session = await sessions.get(runs[0]!.sessionId!);
    expect(session?.allowedMcpTools).toEqual(["mcp_jira_search"]);
    expect(
      session?.messages.some((m) => m.role === "user" && m.content.includes("checkout is down")),
    ).toBe(true);
    expect(
      session?.messages.some(
        (m) => m.role === "user" && /<untrusted-webhook-event [a-f0-9]+>/.test(m.content),
      ),
    ).toBe(true);
    expect(posts.some((body) => body.includes('"text"') && body.includes("Ops research"))).toBe(
      true,
    );

    const slackBody = JSON.stringify({
      type: "event_callback",
      event_id: "Ev-dup",
      event: { type: "app_mention", text: "<@Ubot> status", channel: "C1", user: "U2" },
    });
    const mention = await automations.handleWebhook(created.id, {
      ...locusSecret(created.webhookSecret),
      raw: slackBody,
    });
    expect(mention.queued).toBe(true);
    const retry = await automations.handleWebhook(created.id, {
      ...locusSecret(created.webhookSecret),
      raw: slackBody,
      slackRetry: "1",
    });
    expect(retry.queued).toBeUndefined();
    const slackDeadline = Date.now() + 4000;
    while (Date.now() < slackDeadline) {
      runs = await automations.listRuns(created.id);
      if (
        runs.filter((r) => r.trigger === "webhook").length >= 2 &&
        runs.every((r) => r.status !== "running")
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(runs.filter((r) => r.trigger === "webhook")).toHaveLength(2);
    hypervisor.shutdown();
  });

  it("starts two due jobs on the same tick without waiting for the first to finish", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* engine() {
      await gate;
      yield { type: "text" as const, text: "done" };
    }
    const ctx = await setup(() => new Date("2026-08-17T12:00:00.000Z"), engine);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.providers[0]!.apiKey = "sk-test";
    await ctx.store.saveConfig(config);
    const ids: string[] = [];
    for (const name of ["A", "B"]) {
      const created = await ctx.automations.create({
        name,
        prompt: "ping",
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        schedule: { kind: "interval", everyMinutes: 10 },
      });
      created.nextRunAt = "2026-08-17T11:59:00.000Z";
      await ctx.store.replaceAutomation(created);
      ids.push(created.id);
    }
    const ticking = ctx.automations.tick();
    const seen = await Promise.all(
      ids.map((id) => waitForRuns(ctx.automations, id, (rows) => rows.length > 0)),
    );
    expect(seen.every((rows) => rows.length === 1)).toBe(true);
    release();
    await ticking;
    await Promise.all(
      ids.map((id) =>
        waitForRuns(ctx.automations, id, (rows) => rows.some((r) => r.status === "succeeded")),
      ),
    );
    ctx.hypervisor.shutdown();
  });

  it("does not record a skip storm when a schedule is due during a manual run", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* engine() {
      await gate;
      yield { type: "text" as const, text: "done" };
    }
    const ctx = await setup(() => new Date("2026-08-17T12:00:00.000Z"), engine);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.providers[0]!.apiKey = "sk-test";
    await ctx.store.saveConfig(config);
    const created = await ctx.automations.create({
      name: "Busy",
      prompt: "ping",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 10 },
    });
    created.nextRunAt = "2026-08-17T11:59:00.000Z";
    await ctx.store.replaceAutomation(created);
    const manual = ctx.automations.execute(created.id, "manual");
    await waitForRuns(ctx.automations, created.id, (rows) =>
      rows.some((r) => r.status === "running"),
    );
    await ctx.automations.tick();
    await ctx.automations.tick();
    await ctx.automations.tick();
    const mid = await ctx.automations.listRuns(created.id);
    expect(mid.filter((r) => r.status === "skipped")).toHaveLength(0);
    const after = await ctx.automations.get(created.id);
    expect(Date.parse(after!.nextRunAt!)).toBeGreaterThan(Date.parse("2026-08-17T12:00:00.000Z"));
    release();
    expect((await manual).status).toBe("succeeded");
    ctx.hypervisor.shutdown();
  });

  it("does not reject tick when a later due job is paused mid-loop", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* engine() {
      await gate;
      yield { type: "text" as const, text: "done" };
    }
    const ctx = await setup(() => new Date("2026-08-17T12:00:00.000Z"), engine);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.providers[0]!.apiKey = "sk-test";
    await ctx.store.saveConfig(config);
    const ids: string[] = [];
    for (const name of ["A", "B"]) {
      const created = await ctx.automations.create({
        name,
        prompt: "ping",
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        schedule: { kind: "interval", everyMinutes: 10 },
      });
      created.nextRunAt = "2026-08-17T11:59:00.000Z";
      await ctx.store.replaceAutomation(created);
      ids.push(created.id);
    }
    await expect(ctx.automations.tick()).resolves.toBeUndefined();
    const started: string[] = [];
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && started.length === 0) {
      for (const id of ids) {
        if ((await ctx.automations.listRuns(id)).length && !started.includes(id)) started.push(id);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    const waiting = ids.find((id) => !started.includes(id));
    if (waiting) await ctx.automations.patch(waiting, { enabled: false });
    release();
    await Promise.all(
      started.map((id) =>
        waitForRuns(ctx.automations, id, (rows) =>
          rows.some((r) => r.status === "succeeded" || r.status === "failed"),
        ),
      ),
    );
    ctx.hypervisor.shutdown();
  });

  it("marks leftover running runs as interrupted", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Stale",
      prompt: "ping",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 10 },
    });
    await ctx.store.replaceRun({
      id: "stale-run",
      automationId: created.id,
      status: "running",
      trigger: "schedule",
      startedAt: "2026-08-17T11:00:00.000Z",
    });
    expect(await ctx.automations.recoverInterruptedRuns()).toBe(1);
    const runs = await ctx.automations.listRuns(created.id);
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.error).toBe("Interrupted");
    ctx.hypervisor.shutdown();
  });

  it("abort before sendChat fails the run without a successful turn", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    async function* engine() {
      started += 1;
      await gate;
      yield { type: "text" as const, text: "done" };
    }
    const ctx = await setup(undefined, engine);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.providers[0]!.apiKey = "sk-test";
    await ctx.store.saveConfig(config);
    const created = await ctx.automations.create({
      name: "Stop me",
      prompt: "ping",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 10 },
    });
    const queued = await ctx.automations.execute(created.id, "manual", undefined, { wait: false });
    expect(queued.status).toBe("running");
    expect(queued.sessionId).toBeTruthy();
    const stopped = await ctx.automations.abort(created.id);
    expect(stopped?.status).toBe("failed");
    expect(stopped?.error).toBe("Stopped");
    release();
    const done = await waitForRuns(ctx.automations, created.id, (rows) =>
      rows.some((r) => r.id === queued.id && r.status !== "running" && r.status !== "queued"),
    );
    expect(done[0]?.status).toBe("failed");
    expect(done[0]?.error).toBe("Stopped");
    expect(started).toBe(0);
    ctx.hypervisor.shutdown();
  });

  it("deletes oldest chats for a job once it exceeds 60", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Every minute",
      prompt: "ping",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 1 },
    });
    const t0 = Date.parse("2026-08-17T10:00:00.000Z");
    for (let i = 0; i < MAX_AUTOMATION_CHATS + 1; i++) {
      await ctx.store.replaceSession(
        seedChat(`seed-${String(i).padStart(2, "0")}`, created.id, t0 + i * 1000),
      );
    }
    await ctx.store.replaceSession(seedChat("manual-1", undefined, t0, { title: "Operator chat" }));
    await ctx.store.replaceSession(seedChat("other-1", "other-job", t0, { title: "Other job" }));
    await ctx.store.replaceSession(seedChat("seed-00", created.id, t0, { pinned: true }));

    const run = await ctx.automations.execute(created.id, "schedule");
    expect(run.status).toBe("succeeded");
    const mine = (await ctx.sessions.list()).filter((s) => s.automationId === created.id);
    expect(mine).toHaveLength(MAX_AUTOMATION_CHATS);
    expect(mine.some((s) => s.id === "seed-00")).toBe(true);
    expect(mine.some((s) => s.id === "seed-01")).toBe(false);
    expect(mine.some((s) => s.id === "seed-02")).toBe(false);
    expect(mine.some((s) => s.id === run.sessionId)).toBe(true);
    expect(await ctx.sessions.get("manual-1")).toBeTruthy();
    expect(await ctx.sessions.get("other-1")).toBeTruthy();
    ctx.hypervisor.shutdown();
  });

  it("skips the next fire once stored spend reaches the lifetime cap", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const created = await ctx.automations.create({
      name: "Capped",
      prompt: "ping",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      lifetimeMaxUsd: 1,
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    await ctx.store.replaceRun({
      id: "spent",
      automationId: created.id,
      status: "succeeded",
      trigger: "schedule",
      spendUsd: 1,
      startedAt: "2026-08-17T11:00:00.000Z",
      finishedAt: "2026-08-17T11:01:00.000Z",
    });
    const run = await ctx.automations.execute(created.id, "manual");
    expect(run.status).toBe("skipped");
    expect(run.error).toBe(LIFETIME_CAP_SKIP_REASON);
    expect((await ctx.automations.get(created.id))?.enabled).toBe(true);
    expect(await ctx.sessions.list()).toHaveLength(0);
    ctx.hypervisor.shutdown();
  });

  it("marks a blocked tool turn as needs you and keeps the session", async () => {
    let asked = false;
    async function* engine() {
      if (!asked) {
        asked = true;
        yield {
          type: "tool_call" as const,
          id: "e1",
          name: "exec",
          arguments: { command: "rm -rf /" },
        };
        return;
      }
      yield { type: "text" as const, text: "still here" };
    }
    const ctx = await setup(undefined, engine);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.providers[0]!.apiKey = "sk-test";
    await ctx.store.saveConfig(config);
    const created = await ctx.automations.create({
      name: "Push",
      prompt: "publish",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      autonomy: "autonomous",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const run = await ctx.automations.execute(created.id, "manual");
    expect(run.status).toBe("needs_you");
    expect(run.summary).toMatch(/recursive delete/i);
    expect(run.error).toBeUndefined();
    const session = await ctx.sessions.get(run.sessionId!);
    expect(session?.needsHuman).toMatch(/recursive delete/i);
    ctx.hypervisor.shutdown();
  });

  it("replays a webhook run with the stored event", async () => {
    async function* engine() {
      yield { type: "text" as const, text: "done" };
    }
    const ctx = await setup(undefined, engine);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.providers[0]!.apiKey = "sk-test";
    await ctx.store.saveConfig(config);
    const created = await ctx.automations.create({
      name: "Hook",
      prompt: "handle it",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "webhook" },
    });
    const event: AutomationEvent = {
      source: "generic",
      text: "deploy me",
      eventId: "evt-123",
      payload: { ok: true },
    };
    const run = await ctx.automations.execute(created.id, "webhook", event);
    expect(run.status, run.error).toBe("succeeded");
    expect(run.reason).toBe("deploy me");
    expect(run.event?.eventId).toBe("evt-123");
    const again = await ctx.automations.replay(created.id, run.id);
    const rows = await waitForRuns(ctx.automations, created.id, (list) =>
      list.some((row) => row.id === again.id && row.status === "succeeded"),
    );
    const replayed = rows.find((row) => row.id === again.id);
    expect(replayed?.trigger).toBe("webhook");
    expect(replayed?.reason).toBe("deploy me");
    expect(replayed?.event?.eventId).toBe("evt-123");
    ctx.hypervisor.shutdown();
  });

  it("runs the latest coalesced event after the current run finishes", async () => {
    const held = blockingEngine();
    const ctx = await setup(undefined, held.engine);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.providers[0]!.apiKey = "sk-test";
    await ctx.store.saveConfig(config);
    const created = await ctx.automations.create({
      name: "Latest",
      prompt: "handle it",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      overlap: "coalesce",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "webhook" },
    });
    const first = ctx.automations.execute(created.id, "webhook", hookEvent("first"));
    await waitForRuns(ctx.automations, created.id, (rows) =>
      rows.some((row) => row.status === "running"),
    );
    const second = await ctx.automations.execute(created.id, "webhook", hookEvent("second"));
    expect(second.status).toBe("running");
    expect(await ctx.automations.listRuns(created.id)).toHaveLength(1);
    held.release();
    expect((await first).status).toBe("succeeded");
    const rows = await waitForRuns(
      ctx.automations,
      created.id,
      (list) => list.filter((row) => row.status === "succeeded").length >= 2,
    );
    expect(rows.filter((row) => row.status === "skipped")).toHaveLength(0);
    expect(rows.map((row) => row.reason).sort()).toEqual(["first", "second"]);
    ctx.hypervisor.shutdown();
  });

  it("promotes one queued run when the current run finishes", async () => {
    const held = blockingEngine();
    const ctx = await setup(undefined, held.engine);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    config.providers[0]!.apiKey = "sk-test";
    await ctx.store.saveConfig(config);
    const created = await ctx.automations.create({
      name: "Queued",
      prompt: "handle it",
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      overlap: "queue",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      schedule: { kind: "webhook" },
    });
    const first = ctx.automations.execute(created.id, "webhook", hookEvent("first"));
    await waitForRuns(ctx.automations, created.id, (rows) =>
      rows.some((row) => row.status === "running"),
    );
    const queued = await ctx.automations.execute(created.id, "webhook", hookEvent("second"));
    expect(queued.status).toBe("queued");
    const replaced = await ctx.automations.execute(created.id, "webhook", hookEvent("third"));
    expect(replaced.id).toBe(queued.id);
    expect(replaced.reason).toBe("third");
    expect(await ctx.automations.listRuns(created.id)).toHaveLength(2);
    held.release();
    expect((await first).status).toBe("succeeded");
    const rows = await waitForRuns(ctx.automations, created.id, (list) =>
      list.every((row) => row.status === "succeeded"),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.reason).sort()).toEqual(["first", "third"]);
    ctx.hypervisor.shutdown();
  });
});

function hookEvent(text: string): AutomationEvent {
  return { source: "generic", text, eventId: text, payload: { text } };
}

function blockingEngine() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const engine: ChatEngine = async function* () {
    if (!held) {
      held = true;
      await gate;
    }
    yield { type: "text" as const, text: "done" };
  };
  return { engine, release: () => release() };
}

async function waitForRuns(
  automations: AutomationService,
  id: string,
  done: (rows: Awaited<ReturnType<AutomationService["listRuns"]>>) => boolean,
  timeoutMs = 4000,
) {
  const deadline = Date.now() + timeoutMs;
  let rows = await automations.listRuns(id);
  while (Date.now() < deadline) {
    if (done(rows)) return rows;
    await new Promise((r) => setTimeout(r, 20));
    rows = await automations.listRuns(id);
  }
  throw new Error("timed out waiting for automation runs");
}

function seedChat(
  id: string,
  automationId: string | undefined,
  createdAtMs: number,
  extra: Partial<AgentSession> = {},
): AgentSession {
  const createdAt = new Date(createdAtMs).toISOString();
  return {
    id,
    title: extra.title ?? id,
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    runtime: "host",
    providerId: "openai",
    model: "gpt-4.1",
    status: "idle",
    messages: [],
    automationId,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}
