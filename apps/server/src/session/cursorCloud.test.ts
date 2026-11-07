import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { Hub } from "../core/hub.js";
import { SessionService } from "./sessions.js";
import { JsonStore } from "../core/store.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

async function waitFor(
  sessions: SessionService,
  id: string,
  pred: (session: NonNullable<Awaited<ReturnType<SessionService["get"]>>>) => boolean,
) {
  const deadline = Date.now() + 4000;
  let fresh = await sessions.get(id);
  while (Date.now() < deadline) {
    fresh = await sessions.get(id);
    if (fresh && pred(fresh)) return fresh;
    await new Promise((r) => setTimeout(r, 20));
  }
  return fresh;
}

function sseResponse(blocks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(`${block}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("cursor cloud chat loop", () => {
  it("runs a Cloud Agent turn in chat without booting a guest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor")!;
    cursor.apiKey = "sk-cursor";
    cursor.enabled = true;
    await store.saveConfig(config);
    const posts: string[] = [];
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    sessions.fetchFn = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      posts.push(`${method} ${url}`);
      if (url.endsWith("/v1/agents") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          prompt?: { text?: string };
          repos?: Array<{ url?: string }>;
          autoCreatePR?: boolean;
        };
        expect(body.prompt?.text).toBe("Add a README");
        expect(body.repos).toEqual([{ url: "https://github.com/acme/app", startingRef: "main" }]);
        expect(body.autoCreatePR).toBe(true);
        return Response.json({
          agent: { id: "bc-1", url: "https://cursor.com/agents/bc-1", latestRunId: "run-1" },
          run: { id: "run-1", agentId: "bc-1" },
        });
      }
      if (url.endsWith("/runs/run-1/stream")) {
        return sseResponse([
          'event: assistant\ndata: {"text":"Updated README.md."}',
          'event: tool_call\ndata: {"callId":"t1","name":"read_file","status":"completed","args":{"target_file":"README.md"},"result":"# app"}',
          'event: result\ndata: {"status":"FINISHED","text":"Updated README.md.","git":{"branches":[{"repoUrl":"github.com/acme/app","branch":"cursor/readme","prUrl":"https://github.com/acme/app/pull/12"}]}}',
          "event: done\ndata: {}",
        ]);
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "ubuntu:24.04",
      providerId: cursor.id,
      model: "composer-2",
      startVm: true,
      repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
    });
    expect(created.status).toBe("idle");
    expect(created.vmId).toBeUndefined();
    await sessions.sendChat(created.id, "Add a README");
    const fresh = await waitFor(sessions, created.id, (session) =>
      Boolean(session.cursorCloud?.agentId && session.status !== "running"),
    );
    expect(fresh?.cursorCloud).toMatchObject({
      agentId: "bc-1",
      runId: "run-1",
      url: "https://cursor.com/agents/bc-1",
    });
    const assistant = fresh?.messages.find((m) => m.role === "assistant");
    expect(assistant?.content).toContain("Updated README.md.");
    expect(assistant?.toolCalls?.some((call) => call.name === "file_read")).toBe(true);
    expect(assistant?.toolCalls?.some((call) => call.name === "git_pr")).toBe(true);
    expect(fresh?.pull).toMatchObject({
      number: 12,
      url: "https://github.com/acme/app/pull/12",
      headRef: "cursor/readme",
    });
    expect(fresh?.gitBranch).toBe("cursor/readme");
    expect(posts.some((row) => row.startsWith("POST ") && row.endsWith("/v1/agents"))).toBe(true);
    hypervisor.shutdown();
  });

  it("turns Cursor Cloud createPlan into a Locus plan card without /plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-plan-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor")!;
    cursor.apiKey = "sk-cursor";
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    sessions.fetchFn = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/v1/agents") && method === "POST") {
        return Response.json({
          agent: {
            id: "bc-plan",
            url: "https://cursor.com/agents/bc-plan",
            latestRunId: "run-plan",
          },
          run: { id: "run-plan", agentId: "bc-plan" },
        });
      }
      if (url.endsWith("/runs/run-plan/stream")) {
        return sseResponse([
          'event: assistant\ndata: {"text":"Drafted the Ubuntu plan."}',
          'event: tool_call\ndata: {"callId":"mode","name":"switchMode","status":"completed","args":{"targetModeId":"plan"}}',
          'event: tool_call\ndata: {"callId":"plan","name":"createPlan","status":"completed","args":{"name":"Ubuntu 26.04 ISO","todos":[{"content":"Rewrite scripts/build-iso.sh","status":"TODO_STATUS_PENDING"},{"content":"Convert package lists","status":"TODO_STATUS_PENDING"}]},"result":"{}"}',
          'event: result\ndata: {"status":"FINISHED","text":"Drafted the Ubuntu plan."}',
          "event: done\ndata: {}",
        ]);
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "ubuntu:24.04",
      providerId: cursor.id,
      model: "composer-2",
      startVm: true,
      repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
    });
    await sessions.sendChat(created.id, "Can we make this ubuntu based instead of arch.");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) => Boolean(session.plan?.items.length) && session.status !== "running",
    );
    expect(fresh?.plan?.phase).toBe("proposed");
    expect(fresh?.plan?.items.map((item) => item.text)).toEqual([
      "Rewrite scripts/build-iso.sh",
      "Convert package lists",
    ]);
    hypervisor.shutdown();
  });

  it("passes every GitHub extra repo in Cursor Cloud repos[]", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-multi-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor")!;
    cursor.apiKey = "sk-cursor";
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    let repos: Array<{ url?: string; startingRef?: string }> | undefined;
    sessions.fetchFn = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/v1/agents") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          repos?: Array<{ url?: string; startingRef?: string }>;
        };
        repos = body.repos;
        return Response.json({
          agent: { id: "bc-2", url: "https://cursor.com/agents/bc-2", latestRunId: "run-2" },
          run: { id: "run-2", agentId: "bc-2" },
        });
      }
      if (url.endsWith("/runs/run-2/stream")) {
        return sseResponse([
          'event: result\ndata: {"status":"FINISHED","text":"ok"}',
          "event: done\ndata: {}",
        ]);
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
      repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
      extraRepos: [{ forge: "github", url: "https://github.com/acme/lib.git" }],
    });
    await sessions.sendChat(created.id, "sync both");
    await waitFor(sessions, created.id, (session) =>
      Boolean(session.cursorCloud?.agentId && session.status !== "running"),
    );
    expect(repos).toEqual([
      { url: "https://github.com/acme/app", startingRef: "main" },
      { url: "https://github.com/acme/lib", startingRef: undefined },
    ]);
    hypervisor.shutdown();
  });

  it("prepends an ops routing card on Grafana/Slack prompts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-ops-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor")!;
    cursor.apiKey = "sk-cursor";
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    let promptText = "";
    sessions.fetchFn = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/v1/agents") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { prompt?: { text?: string } };
        promptText = body.prompt?.text ?? "";
        return Response.json({
          agent: { id: "bc-ops", url: "https://cursor.com/agents/bc-ops", latestRunId: "run-ops" },
          run: { id: "run-ops", agentId: "bc-ops" },
        });
      }
      if (url.endsWith("/runs/run-ops/stream")) {
        return sseResponse([
          'event: assistant\ndata: {"text":"ok"}',
          'event: result\ndata: {"status":"FINISHED","text":"ok"}',
          "event: done\ndata: {}",
        ]);
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "ubuntu:24.04",
      providerId: cursor.id,
      model: "composer-2",
      startVm: true,
      repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
    });
    await sessions.sendChat(
      created.id,
      "Pull Grafana error logs for the last hour and post them to Slack",
    );
    await waitFor(sessions, created.id, (session) =>
      Boolean(session.cursorCloud?.agentId && session.status !== "running"),
    );
    expect(promptText).toContain("grafana_query");
    expect(promptText).toContain("Do not write a scrape script or curl");
    expect(promptText).toContain("Pull Grafana error logs");
    hypervisor.shutdown();
  });

  it("sends follow-ups to the existing agent and refuses GitLab remotes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor")!;
    cursor.apiKey = "sk-cursor";
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const gitlab = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
      repo: { forge: "gitlab", url: "https://gitlab.com/acme/app.git" },
    });
    await sessions.sendChat(gitlab.id, "fix it");
    const refused = await waitFor(sessions, gitlab.id, (session) =>
      session.messages.some((m) => m.content.includes("only accept GitHub")),
    );
    expect(refused?.messages.some((m) => m.content.includes("only accept GitHub"))).toBe(true);

    let createdAgents = 0;
    let followUps = 0;
    sessions.fetchFn = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/v1/agents") && method === "POST") {
        createdAgents += 1;
        return Response.json({
          agent: { id: "bc-2", latestRunId: "run-1" },
          run: { id: "run-1", agentId: "bc-2" },
        });
      }
      if (url.endsWith("/agents/bc-2/runs") && method === "POST") {
        followUps += 1;
        return Response.json({ run: { id: "run-2", agentId: "bc-2" } });
      }
      if (url.includes("/stream")) {
        return sseResponse(['event: assistant\ndata: {"text":"ok"}', "event: done\ndata: {}"]);
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(created.id, "first");
    await waitFor(
      sessions,
      created.id,
      (session) => session.cursorCloud?.agentId === "bc-2" && session.status !== "running",
    );
    await sessions.sendChat(created.id, "second");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.messages.filter((m) => m.role === "user").length >= 2 &&
        session.status !== "running",
    );
    expect(createdAgents).toBe(1);
    expect(followUps).toBe(1);
    expect(fresh?.cursorCloud?.runId).toBe("run-2");
    hypervisor.shutdown();
  });
});
