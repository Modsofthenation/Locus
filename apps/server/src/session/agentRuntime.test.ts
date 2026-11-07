import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { Hub } from "../core/hub.js";
import { SessionService } from "./sessions.js";
import { JsonStore } from "../core/store.js";
import { SessionTraceLog } from "./traces.js";
import { indexWorkspace } from "../workspace/repoIndex.js";
import { runIsolatedSubagent, subagentAllowedTools, subagentRefuseTool } from "./subagent.js";
import type { CompleteRequest } from "@locus/providers";
import type { ToolRequest } from "@locus/guest-agent";
import {
  LLM_COMPACT_SYSTEM,
  SEARCH_WANDER_NUDGE,
  VERIFY_NUDGE,
  type ChatMessage,
} from "@locus/shared";

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
  // Generous poll deadline: under heavily loaded parallel runs the async turn
  // can take longer than a few seconds to append its messages.
  const deadline = Date.now() + 15000;
  let fresh = await sessions.get(id);
  while (Date.now() < deadline) {
    fresh = await sessions.get(id);
    if (fresh && pred(fresh)) return fresh;
    await new Promise((r) => setTimeout(r, 20));
  }
  return fresh;
}

describe("session traces", () => {
  it("round-trips jsonl without secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const log = new SessionTraceLog(dir);
    await log.write({
      t: new Date().toISOString(),
      kind: "tool.call",
      sessionId: "s1",
      name: "git_push",
      args: { token: "gho_secret", url: "https://github.com/acme/app.git" },
    });
    const events = await log.read("s1");
    expect(events).toHaveLength(1);
    expect(events[0]?.args).not.toHaveProperty("token");
  });

  it("clips HTML write bodies in tool traces", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const log = new SessionTraceLog(dir);
    const html = `<!DOCTYPE html>${"x".repeat(8_000)}`;
    await log.write({
      t: new Date().toISOString(),
      kind: "tool.result",
      sessionId: "s1",
      name: "apply_patch",
      args: { path: "/workspace/index.html", streamContent: html },
    });
    const events = await log.read("s1");
    expect(String(events[0]?.args?.streamContent ?? "").length).toBeLessThan(html.length);
    expect(events[0]?.args?.path).toBe("/workspace/index.html");
  });
});

describe("repo index", () => {
  it("maps symbols from a workspace tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "compact.ts"), "export function foldOldTurns() {}\n");
    await writeFile(join(dir, "README.md"), "# hi\n");
    const text = await indexWorkspace(dir, { query: "fold" });
    expect(text).toContain("src/compact.ts");
    expect(text).toContain("foldOldTurns");
    expect(text).not.toContain("# hi");
  });
});

describe("isolated sub-agent", () => {
  it("offers guest reads when the parent has no allowlist", () => {
    expect(subagentAllowedTools()).toEqual(expect.arrayContaining(["file_read", "grep", "glob"]));
    expect(subagentAllowedTools(["file_write", "grep"])).toEqual(["grep"]);
    expect(subagentAllowedTools(undefined, "host")).toEqual(
      expect.arrayContaining(["file_read", "grep", "git_pr_get", "git_pr_list"]),
    );
  });

  it("returns a summary instead of a transcript", async () => {
    async function* engine(req: CompleteRequest) {
      expect(req.system.startsWith("You are an isolated child agent")).toBe(true);
      expect(req.allowedTools).toEqual(expect.arrayContaining(["file_read", "grep", "glob"]));
      expect(req.extraTools?.some((tool) => tool.name === "spawn_agent")).toBeFalsy();
      yield { type: "text" as const, text: "foldOldTurns is in src/compact.ts." };
    }
    const summary = await runIsolatedSubagent("find foldOldTurns", "src", {
      chatEngine: engine,
      complete: {
        provider: {
          id: "p",
          name: "x",
          kind: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk",
          models: ["m"],
          defaultModel: "m",
          enabled: true,
          extraHeaders: {},
        },
        model: "m",
        system: "parent",
        messages: [],
      },
      executeTool: async () => ({ ok: true, output: "unused" }),
    });
    expect(summary).toContain("src/compact.ts");
    expect(summary).not.toContain("parent");
  });

  it("uses a review lens when the child kind is review", async () => {
    async function* engine(req: CompleteRequest) {
      expect(req.system).toContain("reviewing code for bugs");
      yield { type: "text" as const, text: "Missing a test around foldOldTurns." };
    }
    const summary = await runIsolatedSubagent("review compact", undefined, {
      kind: "review",
      chatEngine: engine,
      complete: {
        provider: {
          id: "p",
          name: "x",
          kind: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk",
          models: ["m"],
          defaultModel: "m",
          enabled: true,
          extraHeaders: {},
        },
        model: "m",
        system: "parent",
        messages: [],
      },
      executeTool: async () => ({ ok: true, output: "unused" }),
    });
    expect(summary).toContain("Missing a test");
  });

  it("lets an implement child patch and exec", async () => {
    async function* engine(req: CompleteRequest) {
      expect(req.system).toContain("implements a bounded change");
      expect(req.allowedTools).toEqual(
        expect.arrayContaining(["apply_patch", "file_write", "exec"]),
      );
      yield { type: "text" as const, text: "Patched add() and ran npm test." };
    }
    const summary = await runIsolatedSubagent("fix add", undefined, {
      kind: "implement",
      chatEngine: engine,
      complete: {
        provider: {
          id: "p",
          name: "x",
          kind: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk",
          models: ["m"],
          defaultModel: "m",
          enabled: true,
          extraHeaders: {},
        },
        model: "m",
        system: "parent",
        messages: [],
      },
      executeTool: async () => ({ ok: true, output: "unused" }),
    });
    expect(summary).toContain("Patched add");
    expect(subagentAllowedTools(undefined, undefined, "implement")).toContain("apply_patch");
    expect(subagentAllowedTools(undefined, undefined, "explore")).not.toContain("apply_patch");
    expect(subagentRefuseTool("implement", "exec", { command: "git push origin feat" })).toMatch(
      /cannot git push/i,
    );
    expect(subagentRefuseTool("implement", "exec", { command: "npm test" })).toBeUndefined();
    expect(
      subagentRefuseTool("explore", "exec", { command: "git push origin feat" }),
    ).toBeUndefined();
  });

  it("streams the child transcript to the operator", async () => {
    const snapshots: ChatMessage[][] = [];
    async function* engine() {
      yield { type: "text" as const, text: "grep next" };
      yield {
        type: "tool_call" as const,
        id: "g1",
        name: "grep",
        arguments: { pattern: "foldOldTurns" },
      };
    }
    async function* engine2() {
      yield { type: "text" as const, text: "foldOldTurns is in src/compact.ts." };
    }
    let round = 0;
    const summary = await runIsolatedSubagent("find foldOldTurns", "src", {
      chatEngine: async function* (req) {
        round += 1;
        if (round === 1) yield* engine();
        else yield* engine2();
        void req;
      },
      complete: {
        provider: {
          id: "p",
          name: "x",
          kind: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk",
          models: ["m"],
          defaultModel: "m",
          enabled: true,
          extraHeaders: {},
        },
        model: "m",
        system: "parent",
        messages: [],
      },
      executeTool: async () => ({
        ok: true,
        output: "src/compact.ts:12: export function foldOldTurns",
      }),
      onTranscript: (messages) => {
        snapshots.push(messages.map((row) => ({ ...row })));
      },
    });
    expect(summary).toContain("src/compact.ts");
    expect(snapshots.at(-1)?.some((row) => row.role === "user")).toBe(true);
    expect(
      snapshots.at(-1)?.some((row) => row.role === "tool" && row.content.includes("compact.ts")),
    ).toBe(true);
    const assistant = snapshots
      .at(-1)
      ?.find((row) => row.role === "assistant" && row.toolCalls?.length);
    expect(assistant?.toolCalls?.[0]?.finishedAt).toBeTruthy();
  });

  it("offers host workspace reads to a host child agent", async () => {
    async function* engine(req: CompleteRequest) {
      expect(req.system).not.toContain("no VM, container, or local workspace");
      expect(req.allowedTools).toEqual(expect.arrayContaining(["file_read", "grep", "glob"]));
      yield { type: "text" as const, text: "found entitytag in index.js" };
    }
    const summary = await runIsolatedSubagent("quote entitytag()", "index.js", {
      chatEngine: engine,
      complete: {
        provider: {
          id: "p",
          name: "x",
          kind: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk",
          models: ["m"],
          defaultModel: "m",
          enabled: true,
          extraHeaders: {},
        },
        model: "m",
        system: "parent",
        messages: [],
        runtime: "host",
      },
      executeTool: async () => ({ ok: true, output: "unused" }),
    });
    expect(summary).toContain("entitytag");
  });
});

describe("agent runtime loop", () => {
  it("keeps scratchpad and task list on the session and traces the turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let extra: string[] = [];
    let round = 0;
    async function* engine(req: { extraTools?: Array<{ name: string }> }) {
      extra = (req.extraTools ?? []).map((tool) => tool.name);
      round += 1;
      if (round === 1) {
        yield {
          type: "tool_call" as const,
          id: "s1",
          name: "scratchpad",
          arguments: { action: "write", content: "keep the public API" },
        };
        yield {
          type: "tool_call" as const,
          id: "t1",
          name: "task_list",
          arguments: { action: "add", text: "land prune" },
        };
        return;
      }
      yield { type: "text" as const, text: "notes saved" };
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
    await sessions.sendChat(created.id, "remember this");
    const fresh = await waitFor(sessions, created.id, (session) =>
      session.messages.some((m) => m.content === "notes saved"),
    );
    expect(extra).toEqual(
      expect.arrayContaining(["scratchpad", "task_list", "repo_map", "spawn_agent"]),
    );
    expect(fresh?.scratchpad).toBe("keep the public API");
    expect(fresh?.taskList).toEqual([{ id: "t1", text: "land prune", status: "pending" }]);
    const traces = await new SessionTraceLog(dir).read(created.id);
    expect(traces.some((event) => event.kind === "turn.start")).toBe(true);
    expect(traces.some((event) => event.kind === "tool.call" && event.name === "scratchpad")).toBe(
      true,
    );
    expect(traces.some((event) => event.kind === "llm.request")).toBe(true);
    hypervisor.shutdown();
  });

  it("lets /plan use task_list and folds only this turn's rows into the card", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let extra: string[] = [];
    let round = 0;
    async function* engine(req: { extraTools?: Array<{ name: string }> }) {
      extra = (req.extraTools ?? []).map((tool) => tool.name);
      round += 1;
      if (round === 1) {
        yield {
          type: "tool_call" as const,
          id: "t2",
          name: "task_list",
          arguments: { action: "add", text: "Open the PR" },
        };
        return;
      }
      yield {
        type: "text" as const,
        text: "1. Clone the repo\n2. Run tests\n3. Open the PR",
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
    await store.mutateSession(created.id, (current) => {
      current.taskList = [{ id: "t1", text: "old leftover work", status: "in_progress" }];
    });
    await sessions.sendChat(created.id, "fix login", { plan: true });
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) => Boolean(session.plan?.items.length) && session.status !== "running",
    );
    expect(extra).toEqual(expect.arrayContaining(["task_list", "repo_map"]));
    expect(extra).not.toContain("scratchpad");
    expect(extra).not.toContain("spawn_agent");
    expect(fresh?.plan?.items.map((item) => item.text)).toEqual([
      "Clone the repo",
      "Run tests",
      "Open the PR",
    ]);
    expect(fresh?.plan?.items.map((item) => item.text)).not.toContain("old leftover work");
    expect(fresh?.taskList?.map((item) => item.text)).toEqual([
      "Clone the repo",
      "Run tests",
      "Open the PR",
    ]);
    hypervisor.shutdown();
  });

  it("indexes the host workspace for repo_map", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const wrote = await sessions.executeTool(created.id, {
      name: "file_write",
      args: { path: "/workspace/src/hello.ts", content: "export const hello = 1;\n" },
    } as unknown as ToolRequest);
    expect(wrote.ok).toBe(true);
    const mapped = await sessions.executeTool(created.id, {
      name: "repo_map",
      args: {},
    } as unknown as ToolRequest);
    expect(mapped.ok).toBe(true);
    expect(mapped.output).toMatch(/hello\.ts/);
    expect(mapped.output).not.toMatch(/no local workspace/i);
    const nova = await sessions.executeTool(created.id, {
      name: "file_write",
      args: {
        path: "/workspace/src/nova.ts",
        content: "export function nova() {}\n",
      },
    } as unknown as ToolRequest);
    expect(nova.ok).toBe(true);
    const remapped = await sessions.executeTool(created.id, {
      name: "repo_map",
      args: { query: "nova" },
    } as unknown as ToolRequest);
    expect(remapped.ok).toBe(true);
    expect(remapped.output).toContain("nova.ts");
    expect(remapped.output).toContain("nova");
    hypervisor.shutdown();
  });

  it("spawns a child agent and posts its summary, not a transcript", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let parentRounds = 0;
    async function* engine(req: CompleteRequest) {
      if (req.system.startsWith("You are an isolated child agent")) {
        yield { type: "usage" as const, inputTokens: 9, outputTokens: 3 };
        yield {
          type: "text" as const,
          text: "Found foldOldTurns in packages/shared/src/compact.ts.",
        };
        return;
      }
      parentRounds += 1;
      if (parentRounds === 1) {
        yield {
          type: "tool_call" as const,
          id: "c1",
          name: "spawn_agent",
          arguments: { task: "find foldOldTurns" },
        };
        return;
      }
      yield { type: "text" as const, text: "child reported" };
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
    await sessions.sendChat(created.id, "explore");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((m) => m.content === "child reported"),
    );
    const tool = fresh?.messages.find((m) => m.role === "tool");
    expect(tool?.content).toContain("packages/shared/src/compact.ts");
    expect(fresh?.usage).toEqual({ inputTokens: 9, outputTokens: 3 });
    expect(fresh?.messages.filter((m) => m.role === "assistant").length).toBeLessThan(5);
    expect(fresh?.subagents?.[0]?.toolCallId).toBe("c1");
    expect(fresh?.subagents?.[0]?.messages?.some((m) => m.role === "user")).toBe(true);
    expect(
      fresh?.subagents?.[0]?.messages?.some((m) =>
        m.content.includes("packages/shared/src/compact.ts"),
      ),
    ).toBe(true);
    expect(fresh?.subagents?.[0]?.kind).toBe("explore");
    hypervisor.shutdown();
  });

  it("uses the session default subagent kind when spawn_agent omits kind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    const systems: string[] = [];
    async function* engine(req: CompleteRequest) {
      systems.push(req.system);
      yield { type: "text" as const, text: "Missing coverage on foldOldTurns." };
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
    await sessions.patchMeta(created.id, { defaultSubagent: "review" });
    const result = await sessions.executeTool(created.id, {
      name: "spawn_agent",
      args: { task: "review compact" },
    } as unknown as ToolRequest);
    expect(result.ok).toBe(true);
    expect(systems.some((row) => row.includes("reviewing code for bugs"))).toBe(true);
    const fresh = await sessions.get(created.id);
    expect(fresh?.defaultSubagent).toBe("review");
    expect(fresh?.subagents?.[0]?.kind).toBe("review");
    hypervisor.shutdown();
  });

  it("lets operator chat override the session default for this spawn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    const systems: string[] = [];
    let parentRounds = 0;
    async function* engine(req: CompleteRequest) {
      if (req.system.startsWith("You are an isolated child agent")) {
        systems.push(req.system);
        yield { type: "text" as const, text: "Found foldOldTurns." };
        return;
      }
      parentRounds += 1;
      if (parentRounds === 1) {
        yield {
          type: "tool_call" as const,
          id: "c1",
          name: "spawn_agent",
          arguments: { task: "find foldOldTurns" },
        };
        return;
      }
      yield { type: "text" as const, text: "child reported" };
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
    await sessions.sendChat(created.id, "use the review subagent to find foldOldTurns");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.subagents?.[0]?.kind === "review" &&
        session.messages.some((m) => m.content === "child reported"),
    );
    expect(fresh?.defaultSubagent).toBeUndefined();
    expect(fresh?.subagents?.[0]?.kind).toBe("review");
    expect(systems.some((row) => row.includes("reviewing code for bugs"))).toBe(true);
    hypervisor.shutdown();
  });

  it("persists a default subagent when the operator asks in chat", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    async function* engine() {
      yield { type: "text" as const, text: "Default is now review." };
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
    await sessions.sendChat(created.id, "set the default subagent to review");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) => session.status !== "running" && session.defaultSubagent === "review",
    );
    expect(fresh?.defaultSubagent).toBe("review");
    hypervisor.shutdown();
  });

  it("does not persist a queued default-subagent prompt until that turn runs", async () => {
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
      yield { type: "text" as const, text: "working" };
      await gate;
      yield { type: "text" as const, text: " done" };
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
    const pending = sessions.sendChat(created.id, "look around");
    await waitFor(sessions, created.id, (session) => session.status === "running");
    await sessions.sendChat(created.id, "set the default subagent to review");
    const queued = await sessions.get(created.id);
    expect(queued?.defaultSubagent).toBeUndefined();
    expect(queued?.queue?.map((item) => item.text)).toEqual(["set the default subagent to review"]);
    release();
    await pending;
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) => session.status !== "running" && session.defaultSubagent === "review",
    );
    expect(fresh?.defaultSubagent).toBe("review");
    hypervisor.shutdown();
  });

  it("reports progress when the time budget is exhausted", async () => {
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
        await new Promise((r) => setTimeout(r, 25));
        yield {
          type: "tool_call" as const,
          id: "s1",
          name: "scratchpad",
          arguments: { action: "read" },
        };
        return;
      }
      yield { type: "text" as const, text: "should not run" };
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
      maxMs: 10,
    });
    await sessions.sendChat(created.id, "hurry");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((m) => m.role === "system" && m.content.includes("Progress so far")),
    );
    expect(fresh?.messages.some((m) => m.content === "should not run")).toBe(false);
    expect(fresh?.messages.some((m) => m.content.includes("time budget"))).toBe(true);
    hypervisor.shutdown();
  });

  it(
    "refuses spawn_agent when the time budget is already exhausted",
    { timeout: 20_000 },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-"));
      cleanup.push(dir);
      const store = new JsonStore(dir);
      await store.init();
      const config = await store.loadConfig();
      const provider = config.providers[0]!;
      provider.apiKey = "sk-test";
      await store.saveConfig(config);
      let childRan = false;
      let parentRounds = 0;
      async function* engine(req: CompleteRequest) {
        if (req.system.startsWith("You are an isolated child agent")) {
          childRan = true;
          yield { type: "text" as const, text: "should not spawn" };
          return;
        }
        parentRounds += 1;
        if (parentRounds === 1) {
          await new Promise((r) => setTimeout(r, 25));
          yield {
            type: "tool_call" as const,
            id: "c1",
            name: "spawn_agent",
            arguments: { task: "find foldOldTurns" },
          };
          return;
        }
        yield { type: "text" as const, text: "should not run" };
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
        maxMs: 10,
      });
      await sessions.sendChat(created.id, "explore");
      const fresh = await waitFor(
        sessions,
        created.id,
        (session) =>
          session.status !== "running" &&
          session.messages.some(
            (m) => m.role === "tool" && m.content.includes("no time remaining"),
          ) &&
          session.messages.some(
            (m) => m.role === "system" && m.content.includes("Progress so far"),
          ),
      );
      expect(childRan).toBe(false);
      expect(fresh?.messages.some((m) => m.content === "should not run")).toBe(false);
      expect(fresh?.messages.some((m) => m.content.includes("no time remaining"))).toBe(true);
      hypervisor.shutdown();
    },
  );

  it("does not halt after the legacy 48-round default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.advanced.maxAgentRounds = 48;
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let round = 0;
    async function* engine() {
      round += 1;
      if (round <= 50) {
        yield {
          type: "tool_call" as const,
          id: `s${round}`,
          name: "scratchpad",
          arguments: { action: "read" },
        };
        return;
      }
      yield { type: "text" as const, text: "still going" };
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
    await sessions.sendChat(created.id, "keep going");
    const deadline = Date.now() + 20_000;
    let fresh = await sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await sessions.get(created.id);
      if (fresh?.messages.some((m) => m.content === "still going")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fresh?.messages.some((m) => m.content === "still going")).toBe(true);
    expect(fresh?.messages.some((m) => /Stopped after \d+ tool rounds/.test(m.content))).toBe(
      false,
    );
    expect(round).toBeGreaterThan(48);
    hypervisor.shutdown();
  });

  it("reports progress when an explicit round cap is reached", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.advanced.maxAgentRounds = 8;
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let round = 0;
    async function* engine() {
      round += 1;
      yield {
        type: "tool_call" as const,
        id: `s${round}`,
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
    await sessions.sendChat(created.id, "keep going");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((m) => m.role === "system" && m.content.includes("Progress so far")),
    );
    expect(fresh?.messages.some((m) => m.content.includes("round limit"))).toBe(true);
    expect(fresh?.messages.some((m) => m.content.includes("Send another message"))).toBe(false);
    expect(round).toBe(8);
    hypervisor.shutdown();
  });

  it("calibrates token estimates from provider usage and records a context breakdown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    async function* engine() {
      yield { type: "usage" as const, inputTokens: 2000, outputTokens: 10 };
      yield { type: "text" as const, text: "hello" };
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
    await sessions.sendChat(created.id, "hi");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) => session.context?.measured === true,
    );
    expect(fresh?.context?.used).toBe(2000);
    expect(fresh?.context?.window).toBeGreaterThan(2000);
    expect(fresh?.charsPerToken).toBeGreaterThan(0);
    expect(fresh?.context?.parts.some((part) => part.id === "system")).toBe(true);
    expect(fresh?.context?.parts.some((part) => part.id === "conversation")).toBe(true);
    hypervisor.shutdown();
  });

  it("uses a compact-model note when the fold drops several rounds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let compactCalls = 0;
    async function* engine(req: CompleteRequest) {
      if (req.system === LLM_COMPACT_SYSTEM) {
        compactCalls += 1;
        expect(req.allowedTools).toEqual([]);
        expect(req.messages[0]?.content).toMatch(/Known inspected files/);
        expect(req.messages[0]?.content).toMatch(/land prune/);
        yield {
          type: "text" as const,
          text: [
            "## Goal",
            "Land compact.",
            "## Decisions",
            "- Keep the heuristic fallback",
            "## Already inspected (do not re-read whole files)",
            "- /workspace/src/parse.ts",
            "## In progress",
            "- land prune",
            "## Open questions",
            "- (none)",
          ].join("\n"),
        };
        return;
      }
      yield { type: "text" as const, text: "continued from compact" };
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
    await store.mutateSession(created.id, (current) => {
      current.scratchpad = "keep API";
      current.taskList = [{ id: "t1", text: "land prune", status: "in_progress" }];
      current.inspectedFiles = ["/workspace/src/parse.ts"];
      current.context = {
        window: 128_000,
        used: 200_000,
        reserved: 4_096,
        charsPerToken: 4,
        measured: true,
        parts: [],
      };
      current.messages = bulkyHistory(4);
    });
    await sessions.sendChat(created.id, "continue");
    const fresh = await waitFor(sessions, created.id, (session) =>
      session.messages.some((m) => m.content === "continued from compact"),
    );
    expect(compactCalls).toBe(1);
    const traces = await new SessionTraceLog(dir).read(created.id);
    const compact = traces.find((event) => event.kind === "compact");
    expect(compact?.args?.source).toBe("llm");
    expect(compact?.detail).toMatch(/summarized to save context/);
    expect(fresh?.messages.some((m) => m.content === "continued from compact")).toBe(true);
    hypervisor.shutdown();
  });

  it("falls back to the heuristic compact note when the compact model returns junk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    async function* engine(req: CompleteRequest) {
      if (req.system === LLM_COMPACT_SYSTEM) {
        yield { type: "text" as const, text: "not a compact note" };
        return;
      }
      yield { type: "text" as const, text: "continued from heuristic" };
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
    await store.mutateSession(created.id, (current) => {
      current.context = {
        window: 128_000,
        used: 200_000,
        reserved: 4_096,
        charsPerToken: 4,
        measured: true,
        parts: [],
      };
      current.messages = bulkyHistory(4);
    });
    await sessions.sendChat(created.id, "continue");
    await waitFor(sessions, created.id, (session) =>
      session.messages.some((m) => m.content === "continued from heuristic"),
    );
    const traces = await new SessionTraceLog(dir).read(created.id);
    const compact = traces.find((event) => event.kind === "compact");
    expect(compact?.args?.source).toBe("heuristic");
    expect(compact?.detail).toMatch(/omitted to save context/);
    hypervisor.shutdown();
  });

  it("re-injects a live Design canvas snapshot on compact continue", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    const workspace = await mkdtemp(join(tmpdir(), "locus-compact-design-"));
    cleanup.push(dir, workspace);
    const html = `<!DOCTYPE html><html><head><title>Keep</title><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:Fraunces,serif}</style></head><body><h1>CompactKeepHeadline</h1></body></html>\n`;
    await writeFile(join(workspace, "index.html"), html);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    const continuePrefixes: string[] = [];
    async function* engine(req: CompleteRequest) {
      if (req.system === LLM_COMPACT_SYSTEM) {
        yield { type: "text" as const, text: "not a compact note" };
        return;
      }
      if (req.volatilePrefix) continuePrefixes.push(req.volatilePrefix);
      yield { type: "text" as const, text: "continued from compact snapshot" };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "host",
      hostDir: workspace,
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: false,
    });
    await store.mutateSession(created.id, (current) => {
      current.context = {
        window: 128_000,
        used: 200_000,
        reserved: 4_096,
        charsPerToken: 4,
        measured: true,
        parts: [],
      };
      current.messages = bulkyHistory(4);
    });
    await sessions.sendChat(created.id, "continue");
    await waitFor(sessions, created.id, () => continuePrefixes.length > 0);
    await sessions.abortChat(created.id).catch(() => undefined);
    expect(continuePrefixes.some((text) => /Design canvas snapshot/.test(text))).toBe(true);
    expect(continuePrefixes.some((text) => text.includes("CompactKeepHeadline"))).toBe(true);
    expect(continuePrefixes.some((text) => text.includes("Patch index.html in place"))).toBe(true);
    hypervisor.shutdown();
  });

  it("nudges a coding turn that only greps, then one that edits without tests", async () => {
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
      if (round <= 3) {
        yield {
          type: "tool_call" as const,
          id: `g${round}`,
          name: "grep",
          arguments: { pattern: "TODO" },
        };
        return;
      }
      if (round === 4) {
        yield {
          type: "tool_call" as const,
          id: "w1",
          name: "file_write",
          arguments: { path: "/workspace/src/nudge.js", content: "export const n = 1;\n" },
        };
        return;
      }
      yield { type: "text" as const, text: "done without tests" };
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
    await sessions.sendChat(created.id, "clean up TODOs");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((m) => m.content === VERIFY_NUDGE) &&
        session.messages.some((m) => m.content === "done without tests"),
    );
    expect(fresh?.messages.some((m) => m.content === SEARCH_WANDER_NUDGE)).toBe(true);
    expect(fresh?.messages.some((m) => m.content === VERIFY_NUDGE)).toBe(true);
    expect(fresh?.messages.some((m) => m.content === "done without tests")).toBe(true);
    expect(fresh?.needsHuman).toMatch(/tests/);
    hypervisor.shutdown();
  });

  it("does not ship a coding turn whose last tests failed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-"));
    const workspace = await mkdtemp(join(tmpdir(), "locus-fail-tests-"));
    cleanup.push(dir, workspace);
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({
        name: "locus-fail-tests",
        private: true,
        scripts: { test: "node --test fail.test.js" },
      }),
    );
    await writeFile(
      join(workspace, "fail.test.js"),
      `import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("fails", () => { assert.equal(1, 2); });\n`,
    );
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
          id: "w1",
          name: "file_write",
          arguments: { path: "/workspace/nudge.js", content: "export const n = 1;\n" },
        };
        return;
      }
      if (round === 2) {
        yield {
          type: "tool_call" as const,
          id: "t1",
          name: "exec",
          arguments: { command: "npm test" },
        };
        return;
      }
      yield { type: "text" as const, text: "tests failed but I am done" };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      hostDir: workspace,
      providerId: provider.id,
      model: provider.defaultModel,
      autonomy: "autonomous",
      startVm: false,
    });
    await sessions.sendChat(created.id, "clean up TODOs");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) => session.status !== "running" && Boolean(session.needsHuman),
    );
    expect(fresh?.needsHuman).toMatch(/never passed/);
    hypervisor.shutdown();
  });
});

function bulkyHistory(turns: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let n = 0; n < turns; n += 1) {
    messages.push({
      id: `u${n}`,
      role: "user",
      content: `investigate slice ${n} ${"x".repeat(800)}`,
      createdAt: "",
    });
    messages.push({
      id: `a${n}`,
      role: "assistant",
      content: `working on ${n}`,
      createdAt: "",
      toolCalls: [
        {
          id: `c${n}`,
          name: "file_read",
          arguments: { path: `/workspace/src/file${n}.ts` },
          startedAt: "",
        },
      ],
    });
    messages.push({
      id: `t${n}`,
      role: "tool",
      toolCallId: `c${n}`,
      content: `body${n} `.repeat(40),
      createdAt: "",
    });
  }
  return messages;
}
