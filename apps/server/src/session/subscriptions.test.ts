import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { applySubscribe } from "@locus/shared";
import type { ToolRequest } from "@locus/guest-agent";
import { Hub } from "../core/hub.js";
import { SessionService } from "./sessions.js";
import { JsonStore } from "../core/store.js";
import { SubscriptionService } from "./subscriptions.js";

function runtimeTool(name: string, args: Record<string, unknown>): ToolRequest {
  return { name, args } as ToolRequest;
}

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SubscriptionService", () => {
  it("wakes the session when a once-timer is due", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-sub-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const sessions = new SessionService(store, hypervisor, hub);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const prompts: string[] = [];
    sessions.sendChat = async (_id, content) => {
      prompts.push(content);
    };
    let now = new Date("2026-08-29T12:00:00.000Z");
    const sub = applySubscribe(
      [],
      { kind: "timer", name: "nudge", delaySeconds: 30, once: true, prompt: "look at the queue" },
      { id: "t1", createdAt: now.toISOString(), now },
    ).subscriptions;
    await sessions.patchMeta(created.id, { subscriptions: sub });
    const svc = new SubscriptionService(store, sessions, { hub, now: () => now });
    await svc.tick();
    expect(prompts).toEqual([]);
    now = new Date("2026-08-29T12:00:31.000Z");
    await svc.tick();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatch(/look at the queue/);
    const fresh = await sessions.get(created.id);
    expect(fresh?.subscriptions ?? []).toEqual([]);
  });

  it("patches subscriptions from the session API", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-sub-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const added = await sessions.patchMeta(created.id, {
      subscriptions: [
        {
          id: "s1",
          kind: "slack_channel",
          title: "#eng",
          createdAt: "2026-08-29T12:00:00.000Z",
          channelId: "C0123ABCDEF",
        },
      ],
    });
    expect(added.subscriptions).toHaveLength(1);
    const cleared = await sessions.patchMeta(created.id, { subscriptions: null });
    expect(cleared.subscriptions).toBeUndefined();
  });

  it("adds and removes a timer through the subscribe tools", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-sub-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const added = await sessions.executeTool(
      created.id,
      runtimeTool("subscribe", {
        kind: "timer",
        name: "nudge",
        delaySeconds: 45,
        prompt: "check CI",
      }),
    );
    expect(added.ok).toBe(true);
    expect(added.output).toMatch(/Subscribed/);
    const live = await sessions.get(created.id);
    expect(live?.subscriptions).toHaveLength(1);
    const id = live?.subscriptions?.[0]?.id;
    expect(id).toBeTruthy();
    const listed = await sessions.executeTool(
      created.id,
      runtimeTool("subscribe", { action: "list" }),
    );
    expect(listed.output).toMatch(/nudge/);
    const gone = await sessions.executeTool(created.id, runtimeTool("unsubscribe", { id }));
    expect(gone.ok).toBe(true);
    expect((await sessions.get(created.id))?.subscriptions).toBeUndefined();
  });
});
