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

describe("SubscriptionService CI fix loop", () => {
  it("starts one CI fix per head + check set, then stops after two attempts with Needs you", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-sub-ci-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    await store.saveConfig({
      ...config,
      forges: [
        {
          id: "gh",
          kind: "github",
          name: "GitHub",
          apiBaseUrl: "https://api.github.com",
          token: "gh-token",
        },
      ],
    });
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const real = new SessionService(store, hypervisor, hub);
    const created = await real.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const now = new Date("2026-11-14T12:00:00.000Z");
    await store.mutateSession(created.id, (row) => {
      row.repoId = "repo-1";
      row.repo = { url: "https://github.com/acme/app", forge: "github" } as never;
      row.subscriptions = [
        {
          id: "checks-1",
          kind: "checks",
          title: "PR #7 checks",
          createdAt: now.toISOString(),
          repoUrl: "https://github.com/acme/app",
          pullNumber: 7,
        },
      ];
    });

    let sha = "s1";
    let state = "pending";
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      const body = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url.endsWith("/pulls/7")) {
        return body({
          number: 7,
          title: "Cart",
          state: "open",
          head: { ref: "feat/cart", sha },
          base: { ref: "main" },
          updated_at: now.toISOString(),
        });
      }
      if (url.endsWith(`/commits/${sha}/status`)) {
        return body({ statuses: [{ context: "test", state }] });
      }
      if (url.includes("/graphql")) return body({ data: {} });
      return body([]);
    };

    const fixes: Array<{ number: number; ci: unknown }> = [];
    const flagged: Array<{ id: string; text: string }> = [];
    const wakes: string[] = [];
    const svc = new SubscriptionService(
      store,
      {
        sendChat: async (_id: string, text: string) => {
          wakes.push(text);
        },
        flagNeedsHuman: async (id: string, text: string) => {
          flagged.push({ id, text });
          return {} as never;
        },
      } as never,
      {
        hub,
        fetch: fetchFn,
        now: () => now,
        repos: {
          startFixSession: async (_repoId: string, number: number, opts?: { ci?: unknown }) => {
            fixes.push({ number, ci: opts?.ci });
            return { session: { id: created.id } } as never;
          },
        },
      },
    );
    const step = async (nextSha: string, nextState: string) => {
      sha = nextSha;
      state = nextState;
      await svc.tick();
    };

    await step("s1", "pending"); // primes the cursor
    await step("s1", "failure");
    expect(fixes).toEqual([
      { number: 7, ci: { headSha: "s1", checks: ["test"], attempt: 1, maxAttempts: 2 } },
    ]);
    expect(wakes).toEqual([]); // the fix runs in this same session

    // Same head and check set fails again (re-run): no second fix.
    await step("s1", "pending");
    await step("s1", "failure");
    expect(fixes).toHaveLength(1);

    await step("s2", "pending");
    await step("s2", "failure");
    expect(fixes).toHaveLength(2);
    expect((fixes[1]!.ci as { attempt: number }).attempt).toBe(2);

    await step("s3", "pending");
    await step("s3", "failure");
    expect(fixes).toHaveLength(2);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.id).toBe(created.id);
    expect(flagged[0]!.text).toMatch(/stopped after 2 attempts: test still failing at s3/);
    const sub = (await store.loadSessions()).find((row) => row.id === created.id)
      ?.subscriptions?.[0];
    expect(sub?.ciFix?.stoppedAt).toBeTruthy();

    // Green resets the counter; the next red starts a fresh attempt 1.
    await step("s4", "success");
    expect(
      (await store.loadSessions()).find((row) => row.id === created.id)?.subscriptions?.[0]?.ciFix
        ?.attempts,
    ).toBeUndefined();
    await step("s5", "failure");
    expect(fixes).toHaveLength(3);
    expect((fixes[2]!.ci as { attempt: number }).attempt).toBe(1);
  });
});
