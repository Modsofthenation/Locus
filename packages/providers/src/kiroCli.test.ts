import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AiProvider } from "@locus/shared";
import {
  buildKiroCliArgv,
  checkKiroCli,
  parseKiroCliEvents,
  streamKiroCli,
  type KiroCliSpawner,
} from "./kiroCli.js";

const provider: AiProvider = {
  id: "kiro-cli",
  name: "Kiro CLI",
  kind: "kiro-cli",
  baseUrl: "kiro-cli://local",
  apiKey: "",
  models: ["auto"],
  defaultModel: "auto",
  enabled: true,
  extraHeaders: {},
};

function spawner(lines: string[], code = 0, stderr = ""): KiroCliSpawner {
  return (req) => ({
    lines: (async function* () {
      void req;
      for (const line of lines) yield line;
    })(),
    wait: async () => ({ code, stderr }),
  });
}

describe("kiro cli adapter", () => {
  it("builds headless stream-json argv against a local workspace", () => {
    const argv = buildKiroCliArgv({
      provider,
      prompt: "fix the tests",
      workspace: "/tmp/app",
      model: "claude-sonnet-5.5",
    });
    expect(argv.command).toBe("kiro-cli");
    expect(argv.cwd).toBe("/tmp/app");
    expect(argv.args.slice(0, 6)).toEqual([
      "chat",
      "--v3",
      "--no-interactive",
      "--trust-all-tools",
      "--output-format",
      "stream-json",
    ]);
    expect(argv.args).toEqual(
      expect.arrayContaining(["--model", "claude-sonnet-5.5", "fix the tests"]),
    );
    expect(argv.args).not.toContain("--require-mcp-startup");
  });

  it("resumes with --resume-id and maps a pasted key onto KIRO_API_KEY", () => {
    const argv = buildKiroCliArgv({
      provider: { ...provider, apiKey: "kiro-secret" },
      prompt: "continue",
      workspace: "/tmp/app",
      resume: "sess-9",
    });
    expect(argv.args).toContain("--resume-id");
    expect(argv.args).toContain("sess-9");
    expect(argv.env.KIRO_API_KEY).toBe("kiro-secret");
  });

  it("maps a session MCP URL onto LOCUS_GIT_MCP_URL", () => {
    const argv = buildKiroCliArgv({
      provider,
      prompt: "open a PR",
      workspace: "/tmp/app",
      gitMcpUrl: "http://127.0.0.1:7420/mcp/sessions/s1",
    });
    expect(argv.env.LOCUS_GIT_MCP_URL).toBe("http://127.0.0.1:7420/mcp/sessions/s1");
  });

  it("omits --model auto so V3 uses its default instead of a missing id", () => {
    const argv = buildKiroCliArgv({
      provider,
      prompt: "Hello",
      workspace: "/tmp/app",
      model: "auto",
    });
    expect(argv.args.slice(0, 3)).toEqual(["chat", "--v3", "--no-interactive"]);
    expect(argv.args).toContain("--output-format");
    expect(argv.args).toContain("stream-json");
    expect(argv.args).not.toContain("--model");
    expect(argv.args).not.toContain("--require-mcp-startup");
  });

  it("maps stream-json assistant, tools, and usage", () => {
    expect(
      parseKiroCliEvents(JSON.stringify({ type: "system", subtype: "init", session_id: "kiro-1" })),
    ).toEqual([{ type: "session", sessionId: "kiro-1" }]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Reading app.ts" },
              { type: "tool_use", id: "t1", name: "read_file", input: { path: "src/app.ts" } },
            ],
          },
        }),
      ),
    ).toEqual([
      { type: "text", text: "Reading app.ts" },
      {
        type: "tool_call",
        id: "t1",
        name: "file_read",
        status: "running",
        arguments: { path: "src/app.ts" },
      },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "t1", content: "const x = 1" }],
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool_call",
        id: "t1",
        name: "tool",
        status: "completed",
        arguments: {},
        result: "const x = 1",
      },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "done",
          usage: { input_tokens: 12, output_tokens: 4 },
        }),
      ),
    ).toEqual([
      {
        type: "result",
        status: "FINISHED",
        text: "done",
        durationMs: undefined,
        usage: { inputTokens: 12, outputTokens: 4 },
      },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
        }),
      ),
    ).toEqual([{ type: "text", text: "Hi" }]);
  });

  it("maps native Kiro {kind, data} stream-json so chat is not blank", () => {
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          version: "v1",
          kind: "AssistantMessage",
          data: {
            message_id: "a1",
            sessionId: "kiro-native-1",
            content: [
              { kind: "text", data: "Hello from Kiro." },
              {
                kind: "toolUse",
                data: { toolUseId: "tu1", name: "read", input: { path: "README.md" } },
              },
            ],
          },
        }),
      ),
    ).toEqual([
      { type: "session", sessionId: "kiro-native-1" },
      { type: "text", text: "Hello from Kiro." },
      {
        type: "tool_call",
        id: "tu1",
        name: "file_read",
        status: "running",
        arguments: { path: "README.md" },
      },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          version: "v1",
          kind: "ToolResults",
          data: {
            content: [
              {
                kind: "toolResult",
                data: {
                  toolUseId: "tu1",
                  content: [{ kind: "text", data: "# app" }],
                  status: "success",
                },
              },
            ],
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool_call",
        id: "tu1",
        name: "tool",
        status: "completed",
        arguments: {},
        result: "# app",
      },
    ]);
    expect(parseKiroCliEvents(JSON.stringify({ type: "assistant", content: "Hello" }))).toEqual([
      { type: "text", text: "Hello" },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "acp-1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Hi" },
            },
          },
        }),
      ),
    ).toEqual([
      { type: "session", sessionId: "acp-1" },
      { type: "text", text: "Hi" },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "_kiro/auth/getAccessToken",
          params: {},
        }),
      ),
    ).toEqual([
      {
        type: "error",
        message:
          "Kiro CLI requested host-mediated ACP auth (`_kiro/auth/getAccessToken`). Headless chat cannot answer that handshake. Run `kiro-cli login` or paste a KIRO_API_KEY.",
      },
    ]);
  });

  it("maps V3 stream-json session-update events without a JSON-RPC envelope", () => {
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "agent_message_chunk",
          sessionId: "v3-sess",
          content: { type: "text", text: "Hello" },
        }),
      ),
    ).toEqual([
      { type: "session", sessionId: "v3-sess" },
      { type: "text", text: "Hello" },
    ]);
    expect(parseKiroCliEvents(JSON.stringify({ type: "text", content: "Hello" }))).toEqual([
      { type: "text", text: "Hello" },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "thinking" },
        }),
      ),
    ).toEqual([{ type: "reasoning", text: "thinking" }]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "tool_call",
          toolCallId: "c1",
          kind: "read",
          status: "pending",
          rawInput: { path: "README.md" },
        }),
      ),
    ).toEqual([
      {
        type: "tool_call",
        id: "c1",
        name: "file_read",
        status: "running",
        arguments: { path: "README.md" },
      },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "tool_call",
          toolCallId: "s1",
          kind: "search",
          status: "pending",
          rawInput: { query: "UserProfile" },
        }),
      ),
    ).toEqual([
      {
        type: "tool_call",
        id: "s1",
        name: "grep",
        status: "running",
        arguments: { query: "UserProfile" },
      },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "tool_call",
          toolCallId: "g1",
          status: "pending",
          rawInput: {
            name: "context-gatherer",
            prompt: "Find the lookup helpers",
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool_call",
        id: "g1",
        name: "context-gatherer",
        status: "running",
        arguments: { name: "context-gatherer", prompt: "Find the lookup helpers" },
      },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "session_info_update",
          sessionId: "v3-sess",
          _meta: { kiro: { kind: "displayError", displayError: { message: "Token expired" } } },
        }),
      ),
    ).toEqual([
      { type: "session", sessionId: "v3-sess" },
      { type: "error", message: "Token expired" },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "session_info_update",
          _meta: { kiro: { kind: "turn_end", stopReason: "end_turn" } },
        }),
      ),
    ).toEqual([]);
  });

  it("maps stream-json {type, data} envelopes so chat is not blank", () => {
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "runStarted",
          data: { payloadSchema: "acp", acpProtocolVersion: 1, engine: "v2" },
        }),
      ),
    ).toEqual([]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "sessionUpdate",
          data: {
            sessionId: "sess_hello",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Hello from Kiro." },
            },
          },
        }),
      ),
    ).toEqual([
      { type: "session", sessionId: "sess_hello" },
      { type: "text", text: "Hello from Kiro." },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "sessionUpdate",
          data: {
            update: {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: "thinking" },
            },
          },
        }),
      ),
    ).toEqual([{ type: "reasoning", text: "thinking" }]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "sessionUpdate",
          data: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "c1",
              status: "pending",
              rawInput: { path: "README.md" },
              _meta: { kiro: { toolName: "fsRead" } },
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool_call",
        id: "c1",
        name: "file_read",
        status: "running",
        arguments: { path: "README.md" },
      },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "metadata",
          data: { sessionId: "sess_hello", contextUsagePercentage: 12 },
        }),
      ),
    ).toEqual([{ type: "session", sessionId: "sess_hello" }]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "runFinished",
          data: {
            status: "success",
            sessionId: "sess_hello",
            finalText: "Hello from Kiro.",
            finalTextTruncated: false,
          },
        }),
      ),
    ).toEqual([
      { type: "session", sessionId: "sess_hello" },
      {
        type: "result",
        status: "FINISHED",
        text: "Hello from Kiro.",
        durationMs: undefined,
      },
    ]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "runError",
          data: { stage: "auth", message: "not logged in" },
        }),
      ),
    ).toEqual([{ type: "error", message: "not logged in" }]);
    expect(
      parseKiroCliEvents(
        JSON.stringify({
          type: "runFinished",
          status: "success",
          sessionId: "flat-1",
          finalText: "Hi",
        }),
      ),
    ).toEqual([
      { type: "session", sessionId: "flat-1" },
      { type: "result", status: "FINISHED", text: "Hi", durationMs: undefined },
    ]);
  });

  it("streams mapped events from a fake CLI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-cli-"));
    const events: string[] = [];
    for await (const ev of streamKiroCli({
      provider,
      prompt: "hi",
      workspace: dir,
      spawnFn: spawner([
        JSON.stringify({ type: "system", subtype: "init", session_id: "kiro-9" }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "ok" }] },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "ok",
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      ]),
    })) {
      events.push(ev.type);
    }
    expect(events).toEqual(["session", "text", "result", "done"]);
  });

  it("streams native Kiro assistant text and reports a blank successful exit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-cli-native-"));
    const events: Array<{ type: string; text?: string }> = [];
    for await (const ev of streamKiroCli({
      provider,
      prompt: "Hello",
      workspace: dir,
      spawnFn: spawner([
        JSON.stringify({
          version: "v1",
          kind: "AssistantMessage",
          data: { content: [{ kind: "text", data: "Hello" }] },
        }),
      ]),
    })) {
      events.push({ type: ev.type, ...(ev.type === "text" ? { text: ev.text } : {}) });
    }
    expect(events).toEqual([{ type: "text", text: "Hello" }, { type: "done" }]);

    const blank: string[] = [];
    for await (const ev of streamKiroCli({
      provider,
      prompt: "Hello",
      workspace: dir,
      spawnFn: spawner([]),
    })) {
      blank.push(ev.type === "error" ? ev.message : ev.type);
    }
    expect(blank).toEqual(["Kiro CLI finished without a reply.", "done"]);
  });

  it("strips ANSI from a blank-exit stderr note", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-cli-ansi-"));
    const blank: string[] = [];
    for await (const ev of streamKiroCli({
      provider,
      prompt: "Hello",
      workspace: dir,
      spawnFn: spawner([], 0, "\u001b[31mnot logged in\u001b[0m"),
    })) {
      blank.push(ev.type === "error" ? ev.message : ev.type);
    }
    expect(blank).toEqual(["Kiro CLI finished without a reply: not logged in", "done"]);
  });

  it("does not dump KAS INFO logs when V3 exits with no stream-json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-cli-kas-"));
    const blank: string[] = [];
    const stderr = [
      '[INFO] kas.server.starting {"product":"KAS (Kiro Agent Server)","version":"0.66.70"}',
      "[INFO] Auth: --auth=acp-callback (host-mediated refresh via _kiro/auth/getAccessToken)",
      '[INFO] acp.content_collection.resolved {"enabled":true}',
      '[INFO] acp.remote_sessions.enabled {"endpoint":"http://127.0.0.1:9/mcp/sessions/x"}',
    ].join("\n");
    for await (const ev of streamKiroCli({
      provider,
      prompt: "Hello",
      workspace: dir,
      spawnFn: spawner([], 0, stderr),
    })) {
      blank.push(ev.type === "error" ? ev.message : ev.type);
    }
    expect(blank[0]).toMatch(/finished without a reply/);
    expect(blank[0]).toMatch(/kiro-cli login|KIRO_API_KEY/);
    expect(blank[0]).not.toMatch(/kas\.server\.starting/);
    expect(blank[0]).not.toMatch(/127\.0\.0\.1/);
    expect(blank[1]).toBe("done");
  });

  it("streams V3 agent_message_chunk events into chat text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-cli-v3-"));
    const events: Array<{ type: string; text?: string }> = [];
    for await (const ev of streamKiroCli({
      provider,
      prompt: "Hello",
      workspace: dir,
      spawnFn: spawner([
        JSON.stringify({
          type: "session_info_update",
          sessionId: "v3-1",
          _meta: { kiro: { kind: "turn_start" } },
        }),
        JSON.stringify({
          type: "agent_message_chunk",
          content: { type: "text", text: "Hel" },
        }),
        JSON.stringify({
          type: "agent_message_chunk",
          content: { type: "text", text: "lo" },
        }),
        JSON.stringify({
          type: "session_info_update",
          _meta: { kiro: { kind: "turn_end", stopReason: "end_turn" } },
        }),
      ]),
    })) {
      events.push({ type: ev.type, ...(ev.type === "text" ? { text: ev.text } : {}) });
    }
    expect(events).toEqual([
      { type: "session" },
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
      { type: "done" },
    ]);
  });

  it("streams envelope sessionUpdate text and runFinished instead of a blank turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-cli-envelope-"));
    const events: Array<{ type: string; text?: string; sessionId?: string }> = [];
    for await (const ev of streamKiroCli({
      provider,
      prompt: "Hi, what model are you?",
      workspace: dir,
      spawnFn: spawner([
        JSON.stringify({
          type: "runStarted",
          data: { payloadSchema: "acp", acpProtocolVersion: 1, engine: "v3" },
        }),
        JSON.stringify({
          type: "sessionUpdate",
          data: {
            sessionId: "sess_model",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "I am Auto, Kiro's default model." },
            },
          },
        }),
        JSON.stringify({
          type: "metadata",
          data: { sessionId: "sess_model" },
        }),
        JSON.stringify({
          type: "runFinished",
          data: {
            status: "success",
            sessionId: "sess_model",
            finalText: "I am Auto, Kiro's default model.",
          },
        }),
      ]),
    })) {
      events.push({
        type: ev.type,
        ...((ev.type === "text" || ev.type === "result") && ev.text ? { text: ev.text } : {}),
        ...(ev.type === "session" ? { sessionId: ev.sessionId } : {}),
      });
    }
    expect(events).toEqual([
      { type: "session", sessionId: "sess_model" },
      { type: "text", text: "I am Auto, Kiro's default model." },
      { type: "session", sessionId: "sess_model" },
      { type: "session", sessionId: "sess_model" },
      { type: "result" },
      { type: "done" },
    ]);
  });

  it("uses runFinished.finalText when the stream had no message chunks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-cli-final-text-"));
    const events: Array<{ type: string; text?: string }> = [];
    for await (const ev of streamKiroCli({
      provider,
      prompt: "Hello",
      workspace: dir,
      spawnFn: spawner([
        JSON.stringify({
          type: "runStarted",
          data: { payloadSchema: "acp", acpProtocolVersion: 1, engine: "v2" },
        }),
        JSON.stringify({
          type: "runFinished",
          data: { status: "success", sessionId: "sess_final", finalText: "Hello" },
        }),
      ]),
    })) {
      events.push({
        type: ev.type,
        ...((ev.type === "text" || ev.type === "result") && ev.text ? { text: ev.text } : {}),
      });
    }
    expect(events).toEqual([
      { type: "session" },
      { type: "result", text: "Hello" },
      { type: "done" },
    ]);
  });

  it("collapses V3 tool_call_update onto one running event and keeps the name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-cli-dup-"));
    const events: Array<{ status?: string; name?: string; id?: string }> = [];
    for await (const ev of streamKiroCli({
      provider,
      prompt: "test",
      workspace: dir,
      spawnFn: spawner([
        JSON.stringify({
          type: "sessionUpdate",
          data: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "e1",
              kind: "execute",
              status: "pending",
              rawInput: { command: "python3 ./manage.py test shop.tests.test_models" },
              _meta: { kiro: { toolName: "executeCommand" } },
            },
          },
        }),
        JSON.stringify({
          type: "sessionUpdate",
          data: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "e1",
              status: "in_progress",
              rawInput: {
                command: "python3 ./manage.py test shop.tests.test_models",
                description: "Run Django tests",
                run_in_background: false,
              },
            },
          },
        }),
        JSON.stringify({
          type: "sessionUpdate",
          data: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "e1",
              status: "completed",
              content: [{ type: "text", text: "OK" }],
            },
          },
        }),
        JSON.stringify({
          type: "runFinished",
          data: { status: "success", sessionId: "sess-e1" },
        }),
      ]),
    })) {
      if (ev.type === "tool_call") events.push({ status: ev.status, name: ev.name, id: ev.id });
    }
    expect(events).toEqual([
      { status: "running", name: "exec", id: "e1" },
      { status: "running", name: "exec", id: "e1" },
      { status: "completed", name: "exec", id: "e1" },
    ]);
  });

  it("keeps the running tool name on completed tool_result events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-cli-"));
    const names: string[] = [];
    for await (const ev of streamKiroCli({
      provider,
      prompt: "read",
      workspace: dir,
      spawnFn: spawner([
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } }],
          },
        }),
        JSON.stringify({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
          },
        }),
        JSON.stringify({ type: "result", subtype: "success", result: "ok" }),
      ]),
    })) {
      if (ev.type === "tool_call") names.push(`${ev.status}:${ev.name}`);
    }
    expect(names).toEqual(["running:file_read", "completed:file_read"]);
  });

  it("checks the installed CLI and account login without exposing probe output", async () => {
    const calls: string[][] = [];
    const health = await checkKiroCli(provider, (req) => {
      calls.push(req.args);
      const isVersion = req.args.includes("--version");
      return {
        lines: (async function* () {
          yield isVersion
            ? "kiro-cli 2.33.0"
            : JSON.stringify({
                loggedIn: true,
                authType: "builder_id",
                email: "account@example.com",
              });
        })(),
        wait: async () => ({ code: 0, stderr: "account@example.com" }),
      };
    });
    expect(health).toEqual({
      ok: true,
      command: "kiro-cli",
      version: "2.33.0",
      authenticated: true,
      authMode: "account",
    });
    expect(calls).toEqual([["--version"], ["whoami", "--format", "json"]]);
    expect(JSON.stringify(health)).not.toContain("account@example.com");
  });

  it("does not pass provider API keys to health-check executables", async () => {
    const observed: Array<NodeJS.ProcessEnv> = [];
    const health = await checkKiroCli({ ...provider, apiKey: "kiro-secret" }, (req) => {
      observed.push(req.env);
      return {
        lines: (async function* () {
          if (req.args.includes("--version")) yield "kiro-cli 2.33.0";
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      };
    });
    expect(observed.every((env) => env.KIRO_API_KEY === undefined)).toBe(true);
    expect(health).toMatchObject({ ok: true, authenticated: false, authMode: "api-key" });
  });

  it("reports missing Kiro CLI authentication", async () => {
    const health = await checkKiroCli(provider, (req) => ({
      lines: (async function* () {
        if (req.args.includes("--version")) yield "kiro-cli 2.33.0";
        else yield JSON.stringify({ loggedIn: false });
      })(),
      wait: async () => ({ code: req.args.includes("--version") ? 0 : 1, stderr: "" }),
    }));
    expect(health).toEqual({
      ok: false,
      command: "kiro-cli",
      version: "2.33.0",
      authenticated: false,
      authMode: "missing",
      message: "Kiro CLI is not authenticated. Run `kiro-cli login` or paste a KIRO_API_KEY.",
    });
  });
});
