import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import type { KiroCliSpawner } from "@locus/providers";
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

function linesSpawner(
  captured: Array<{ args: string[]; cwd: string }>,
  lines: string[],
): KiroCliSpawner {
  return (req) => {
    captured.push({ args: req.args, cwd: req.cwd });
    return {
      lines: (async function* () {
        for (const line of lines) yield line;
      })(),
      wait: async () => ({ code: 0, stderr: "" }),
    };
  };
}

describe("kiro cli chat loop", () => {
  it("runs kiro-cli chat against the host workspace and resumes the CLI session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-cli-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const kiro = config.providers.find((p) => p.kind === "kiro-cli")!;
    kiro.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    sessions.fetchFn = async () => {
      throw new Error("Kiro CLI must not call chat completions");
    };
    sessions.kiroCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "kiro-sess-1" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Updated README.md." },
            { type: "tool_use", id: "t1", name: "read_file", input: { path: "README.md" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "t1", content: "# app" }],
        },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "Updated README.md." }),
    ]);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: kiro.id,
      model: "auto",
      startVm: false,
    });
    await sessions.sendChat(created.id, "Add a README");
    const fresh = await waitFor(sessions, created.id, (session) =>
      Boolean(session.kiroCli?.sessionId && session.status !== "running"),
    );
    expect(fresh?.kiroCli).toEqual({ sessionId: "kiro-sess-1" });
    const assistant = fresh?.messages.find((m) => m.role === "assistant");
    expect(assistant?.content).toContain("Updated README.md.");
    expect(assistant?.toolCalls?.some((call) => call.name === "file_read")).toBe(true);
    expect(captured[0]?.cwd).toContain("host-workspaces");
    expect(captured[0]?.args.slice(0, 3)).toEqual(["--v3", "chat", "--no-interactive"]);
    expect(captured[0]?.args).toEqual(
      expect.arrayContaining([
        "--v3",
        "chat",
        "--no-interactive",
        "--trust-all-tools",
        "--output-format",
        "stream-json",
        "Add a README",
      ]),
    );
    expect(captured[0]?.args).not.toContain("--require-mcp-startup");
    expect(captured[0]?.args).not.toContain("--resume-id");
    expect(captured[0]?.args).not.toContain("--model");
    const mcp = JSON.parse(
      await readFile(join(captured[0]!.cwd, ".kiro", "settings", "mcp.json"), "utf8"),
    ) as {
      mcpServers: { locus?: { url?: string; autoApprove?: string[] } };
    };
    expect(mcp.mcpServers.locus?.url).toMatch(
      new RegExp(`^http://127\\.0\\.0\\.1:\\d+/mcp/sessions/${created.id}$`),
    );
    expect(mcp.mcpServers.locus?.autoApprove).toEqual(["*"]);
    expect(JSON.stringify(mcp)).not.toMatch(/secret|glsa_|token/i);

    sessions.kiroCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "kiro-sess-1" }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "ok" }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "ok" }),
    ]);
    await sessions.sendChat(created.id, "also tests");
    await waitFor(
      sessions,
      created.id,
      (session) =>
        session.messages.filter((m) => m.role === "user").length >= 2 &&
        session.status !== "running",
    );
    expect(captured[1]?.args).toEqual(expect.arrayContaining(["--resume-id", "kiro-sess-1"]));
  });

  it("shows native Kiro stream-json text in chat instead of a blank turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-native-chat-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const kiro = config.providers.find((p) => p.kind === "kiro-cli")!;
    kiro.enabled = true;
    await store.saveConfig(config);
    const sessions = new SessionService(store, new MockHypervisor(dir), new Hub());
    sessions.fetchFn = async () => {
      throw new Error("Kiro CLI must not call chat completions");
    };
    sessions.kiroCliSpawner = linesSpawner(
      [],
      [
        JSON.stringify({
          version: "v1",
          kind: "AssistantMessage",
          data: {
            sessionId: "kiro-native-hello",
            content: [{ kind: "text", data: "Hello" }],
          },
        }),
      ],
    );
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: kiro.id,
      model: "auto",
      startVm: false,
    });
    await sessions.sendChat(created.id, "Hello");
    const fresh = await waitFor(sessions, created.id, (session) =>
      Boolean(session.messages.some((m) => m.role === "assistant" && m.content.includes("Hello"))),
    );
    expect(fresh?.messages.find((m) => m.role === "assistant")?.content).toContain("Hello");
    expect(fresh?.kiroCli).toEqual({ sessionId: "kiro-native-hello" });
  });

  it("shows V3 agent_message_chunk text in chat", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-v3-chat-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const kiro = config.providers.find((p) => p.kind === "kiro-cli")!;
    kiro.enabled = true;
    await store.saveConfig(config);
    const sessions = new SessionService(store, new MockHypervisor(dir), new Hub());
    sessions.fetchFn = async () => {
      throw new Error("Kiro CLI must not call chat completions");
    };
    sessions.kiroCliSpawner = linesSpawner(
      [],
      [
        JSON.stringify({
          type: "agent_message_chunk",
          sessionId: "v3-hello",
          content: { type: "text", text: "Hello" },
        }),
      ],
    );
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: kiro.id,
      model: "auto",
      startVm: false,
    });
    await sessions.sendChat(created.id, "Hello");
    const fresh = await waitFor(sessions, created.id, (session) =>
      Boolean(session.messages.some((m) => m.role === "assistant" && m.content.includes("Hello"))),
    );
    expect(fresh?.messages.find((m) => m.role === "assistant")?.content).toContain("Hello");
    expect(fresh?.kiroCli).toEqual({ sessionId: "v3-hello" });
  });

  it("shows a clean error when Kiro starts KAS but emits no stream-json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-kas-chat-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const kiro = config.providers.find((p) => p.kind === "kiro-cli")!;
    kiro.enabled = true;
    await store.saveConfig(config);
    const sessions = new SessionService(store, new MockHypervisor(dir), new Hub());
    sessions.fetchFn = async () => {
      throw new Error("Kiro CLI must not call chat completions");
    };
    sessions.kiroCliSpawner = () => ({
      lines: (async function* () {
        /* no stdout */
      })(),
      wait: async () => ({
        code: 0,
        stderr: [
          '[INFO] kas.server.starting {"product":"KAS (Kiro Agent Server)","version":"0.66.70"}',
          "[INFO] Auth: --auth=acp-callback (host-mediated refresh via _kiro/auth/getAccessToken)",
          '[INFO] acp.remote_sessions.enabled {"endpoint":"http://127.0.0.1:9/mcp/sessions/x"}',
        ].join("\n"),
      }),
    });
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: kiro.id,
      model: "auto",
      startVm: false,
    });
    await sessions.sendChat(created.id, "Hello");
    const fresh = await waitFor(sessions, created.id, (session) =>
      Boolean(
        session.status !== "running" &&
        session.messages.some((m) => m.role === "assistant" && m.content.includes("login")),
      ),
    );
    const content = fresh?.messages.find((m) => m.role === "assistant")?.content ?? "";
    expect(content).toMatch(/finished without a reply/);
    expect(content).toMatch(/kiro-cli login|KIRO_API_KEY/);
    expect(content).not.toMatch(/kas\.server\.starting/);
  });

  it("rejects a VM runtime for Kiro CLI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-vm-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const kiro = config.providers.find((p) => p.kind === "kiro-cli")!;
    kiro.enabled = true;
    await store.saveConfig(config);
    const sessions = new SessionService(store, new MockHypervisor(dir), new Hub());
    await expect(
      sessions.create({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "vm",
        providerId: kiro.id,
        model: "auto",
        startVm: false,
      }),
    ).rejects.toThrow(/Docker or Host/);
  });
});
