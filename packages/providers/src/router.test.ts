import { describe, expect, it } from "vitest";
import {
  OPENROUTER_APP_TITLE,
  OPENROUTER_APP_URL,
  openaiToolDefs,
  OPS_ROUTING_HABIT,
  toolsForOs,
  type AiProvider,
  type ChatMessage,
} from "@locus/shared";
import { completeChat, hasUsableKey } from "./router.js";
import { buildSystemPrompt, buildSystemPromptParts } from "./prompt.js";
import { toOpenAi, DEFAULT_OPENAI_MAX_TOKENS } from "./openai.js";
import { toAnthropic, toAnthropicSystem } from "./anthropic.js";
import { UNANSWERED_TOOL_RESULT } from "./toolMessages.js";
import {
  extractEmbeddedToolCalls,
  readTokenUsage,
  UNKNOWN_STOP_MESSAGE,
  unknownStopError,
} from "./types.js";
import { runChatTurn } from "./loop.js";
import { isRetryableProviderError } from "./retry.js";
import type { ChatEvent, CompleteRequest } from "./types.js";
import type { CursorCliSpawner } from "./cursorCli.js";

const openai: AiProvider = {
  id: "p1",
  name: "OpenAI",
  kind: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  models: ["gpt-4.1"],
  defaultModel: "gpt-4.1",
  enabled: true,
  extraHeaders: {},
};

function sseResponse(lines: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

async function textOf(req: CompleteRequest, fetchFn: typeof fetch): Promise<string> {
  let out = "";
  for await (const ev of completeChat(req, fetchFn)) {
    if (ev.type === "text") out += ev.text;
  }
  return out;
}

describe("completeChat", () => {
  it("streams OpenAI-compatible deltas", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        "data: [DONE]",
      ]);
    const req: CompleteRequest = {
      provider: openai,
      model: "gpt-4.1",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("Hello");
  });

  it("includes extra MCP tools in the OpenAI payload", async () => {
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        tools?: Array<{ function?: { name?: string } }>;
      };
      expect(body.tools?.some((t) => t.function?.name === "mcp_echo_echo")).toBe(true);
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', "data: [DONE]"]);
    };
    const req: CompleteRequest = {
      provider: openai,
      model: "gpt-4.1",
      system: "sys",
      guestOs: "ubuntu",
      extraTools: [
        {
          name: "mcp_echo_echo",
          description: "Echo",
          parameters: { type: "object", properties: { text: { type: "string" } } },
        },
      ],
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("ok");
  });

  it("emits assembled OpenAI tool calls", async () => {
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { tools?: unknown[] };
      expect(body.tools?.length).toBeGreaterThan(3);
      return sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"exec","arguments":"{\\"com"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"mand\\":\\"ls\\"}"}}]}}]}',
        "data: [DONE]",
      ]);
    };
    const req: CompleteRequest = {
      provider: openai,
      model: "gpt-4.1",
      system: "sys",
      guestOs: "ubuntu",
      messages: [{ id: "1", role: "user", content: "list files", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events.filter((ev) => ev.type !== "activity")).toEqual([
      { type: "tool_call", id: "call_1", name: "exec", arguments: { command: "ls" } },
    ]);
  });

  it("emits file_write argument deltas while canvas HTML streams", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"file_write","arguments":"{\\"path\\":\\"/workspace/index.html\\",\\"content\\":\\"<html><body>"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Hi</body></html>\\"}"}}]}}]}',
        "data: [DONE]",
      ]);
    const req: CompleteRequest = {
      provider: openai,
      model: "gpt-4.1",
      system: "sys",
      guestOs: "ubuntu",
      messages: [{ id: "1", role: "user", content: "design it", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events.some((ev) => ev.type === "tool_call_delta" && ev.name === "file_write")).toBe(
      true,
    );
    expect(events.filter((ev) => ev.type === "tool_call")).toEqual([
      {
        type: "tool_call",
        id: "call_1",
        name: "file_write",
        arguments: { path: "/workspace/index.html", content: "<html><body>Hi</body></html>" },
      },
    ]);
  });

  it("emits OpenAI usage from the final chunk", async () => {
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        stream_options?: { include_usage?: boolean };
        max_tokens?: unknown;
      };
      expect(body.stream_options).toEqual({ include_usage: true });
      expect(body.max_tokens).toBeUndefined();
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4}}',
        "data: [DONE]",
      ]);
    };
    const req: CompleteRequest = {
      provider: openai,
      model: "gpt-4.1",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events.filter((ev) => ev.type !== "activity")).toEqual([
      { type: "text", text: "Hi" },
      { type: "usage", inputTokens: 12, outputTokens: 4 },
    ]);
  });

  it("streams OpenCode Zen completions", async () => {
    const fetchFn: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://opencode.ai/zen/v1/chat/completions");
      const body = JSON.parse(String(init?.body)) as { model?: string; max_tokens?: number };
      expect(body.model).toBe("big-pickle");
      expect(body.max_tokens).toBe(DEFAULT_OPENAI_MAX_TOKENS);
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', "data: [DONE]"]);
    };
    const req: CompleteRequest = {
      provider: {
        ...openai,
        kind: "opencode",
        name: "OpenCode",
        baseUrl: "https://opencode.ai/zen/v1",
      },
      model: "big-pickle",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("ok");
  });

  it("signs Bedrock OpenAI-compatible completions with SigV4", async () => {
    const fetchFn: typeof fetch = async (input, init) => {
      expect(String(input)).toBe(
        "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions",
      );
      const headers = new Headers(init?.headers);
      const auth = headers.get("authorization") ?? "";
      expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\//);
      expect(auth).toContain("/bedrock/");
      expect(auth).not.toContain("Bearer");
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', "data: [DONE]"]);
    };
    const req: CompleteRequest = {
      provider: {
        ...openai,
        name: "Amazon Bedrock",
        kind: "openai-compatible",
        baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
        accessKeyId: "AKIATEST",
        apiKey: "secret",
      },
      model: "anthropic.claude-sonnet-4-5",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("ok");
  });

  it("does not POST chat/completions for Cursor Cloud", async () => {
    const fetchFn: typeof fetch = async () => {
      throw new Error("Cursor Cloud must not call /chat/completions");
    };
    const req: CompleteRequest = {
      provider: {
        ...openai,
        kind: "cursor",
        name: "Cursor Cloud",
        baseUrl: "https://api.cursor.com/v1",
      },
      model: "composer-2",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    await expect(textOf(req, fetchFn)).rejects.toThrow(
      /no OpenAI-compatible POST \/v1\/chat\/completions/,
    );
  });

  it("does not POST chat/completions for Cursor CLI", async () => {
    const fetchFn: typeof fetch = async () => {
      throw new Error("Cursor CLI must not call /chat/completions");
    };
    const req: CompleteRequest = {
      provider: {
        ...openai,
        kind: "cursor-cli",
        name: "Cursor CLI",
        baseUrl: "cursor-cli://local",
        apiKey: "",
      },
      model: "composer-2",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    await expect(textOf(req, fetchFn)).rejects.toThrow(/spawn the local `agent` CLI/);
  });

  it("does not POST chat/completions for Kiro CLI", async () => {
    const fetchFn: typeof fetch = async () => {
      throw new Error("Kiro CLI must not call /chat/completions");
    };
    const req: CompleteRequest = {
      provider: {
        ...openai,
        kind: "kiro-cli",
        name: "Kiro CLI",
        baseUrl: "kiro-cli://local",
        apiKey: "",
      },
      model: "auto",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    await expect(textOf(req, fetchFn)).rejects.toThrow(/spawn the local `kiro-cli chat/);
  });

  it("streams OpenRouter completions with attribution headers and a completion budget", async () => {
    const fetchFn: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://openrouter.ai/api/v1/chat/completions");
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer sk-test");
      expect(headers["HTTP-Referer"]).toBe(OPENROUTER_APP_URL);
      expect(headers["X-Title"]).toBe(OPENROUTER_APP_TITLE);
      const body = JSON.parse(String(init?.body)) as { model?: string; max_tokens?: number };
      expect(body.model).toBe("anthropic/claude-sonnet-4.5");
      expect(body.max_tokens).toBe(DEFAULT_OPENAI_MAX_TOKENS);
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', "data: [DONE]"]);
    };
    const req: CompleteRequest = {
      provider: {
        ...openai,
        kind: "openrouter",
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
      },
      model: "anthropic/claude-sonnet-4.5",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("ok");
  });

  it("keeps OpenRouter extraHeaders over default attribution", async () => {
    const fetchFn: typeof fetch = async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["HTTP-Referer"]).toBe("https://example.com");
      expect(headers["X-Title"]).toBe("Example");
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', "data: [DONE]"]);
    };
    const req: CompleteRequest = {
      provider: {
        ...openai,
        kind: "openrouter",
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        extraHeaders: { "HTTP-Referer": "https://example.com", "X-Title": "Example" },
      },
      model: "openai/gpt-4.1",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("ok");
  });

  it("ignores OpenCode reasoning_content and still streams the visible reply", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"think"}}]}',
        'data: {"choices":[{"delta":{"content":"PONG"}}]}',
        "data: [DONE]",
      ]);
    const req: CompleteRequest = {
      provider: { ...openai, kind: "opencode", baseUrl: "https://opencode.ai/zen/v1" },
      model: "x-preview-f-free",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "ping", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events.some((ev) => ev.type === "activity")).toBe(true);
    expect(events.filter((ev) => ev.type === "reasoning")).toEqual([
      { type: "reasoning", text: "think" },
    ]);
    expect(events.filter((ev) => ev.type === "text")).toEqual([{ type: "text", text: "PONG" }]);
  });

  it("ignores final message.reasoning_content snapshots after delta reasoning", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"think"}}]}',
        'data: {"choices":[{"message":{"role":"assistant","reasoning_content":"think about the whole problem"}}]}',
        'data: {"choices":[{"delta":{"content":"PONG"}}]}',
        "data: [DONE]",
      ]);
    const req: CompleteRequest = {
      provider: { ...openai, kind: "opencode", baseUrl: "https://opencode.ai/zen/v1" },
      model: "x-preview-f-free",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "ping", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events.filter((ev) => ev.type === "reasoning")).toEqual([
      { type: "reasoning", text: "think" },
    ]);
    expect(events.filter((ev) => ev.type === "text")).toEqual([{ type: "text", text: "PONG" }]);
  });

  it("asks Ollama to think and keep the model loaded", async () => {
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        think?: unknown;
        keep_alive?: unknown;
      };
      expect(body.think).toBe(true);
      expect(body.keep_alive).toBe("30m");
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', "data: [DONE]"]);
    };
    const req: CompleteRequest = {
      provider: {
        ...openai,
        name: "Ollama",
        kind: "openai-compatible",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "",
      },
      model: "llama3.2",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events.some((ev) => ev.type === "status" && ev.phase === "loading")).toBe(true);
    expect(events.filter((ev) => ev.type === "text")).toEqual([{ type: "text", text: "ok" }]);
  });

  it("emits loading status before a slow local Ollama response", async () => {
    const fetchFn: typeof fetch = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return sseResponse(['data: {"choices":[{"delta":{"content":"Hi"}}]}', "data: [DONE]"]);
    };
    const req: CompleteRequest = {
      provider: {
        ...openai,
        name: "Ollama",
        kind: "openai-compatible",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
      model: "llama3.2",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events[0]).toEqual({ type: "status", phase: "loading" });
    expect(events.filter((ev) => ev.type === "text")).toEqual([{ type: "text", text: "Hi" }]);
  });

  it("assembles a tool call that omits tool_calls.index onto slot 0", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"file_write","arguments":"{\\"path\\":\\"/workspace/index.html\\","}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"\\"content\\":\\"<html>Hi</html>\\"}"}}]}}]}',
        "data: [DONE]",
      ]);
    const req: CompleteRequest = {
      provider: { ...openai, kind: "opencode", baseUrl: "https://opencode.ai/zen/v1" },
      model: "x-preview-f-free",
      system: "sys",
      guestOs: "ubuntu",
      messages: [{ id: "1", role: "user", content: "design it", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events.filter((ev) => ev.type === "tool_call")).toEqual([
      {
        type: "tool_call",
        id: "call_1",
        name: "file_write",
        arguments: { path: "/workspace/index.html", content: "<html>Hi</html>" },
      },
    ]);
  });

  it("assembles tool calls after reasoning_content and object-shaped arguments", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"write it"}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"file_write","arguments":{"path":"/workspace/index.html","content":"<html>Hi</html>"}}}]}}]}',
        "data: [DONE]",
      ]);
    const req: CompleteRequest = {
      provider: { ...openai, kind: "opencode", baseUrl: "https://opencode.ai/zen/v1" },
      model: "x-preview-f-free",
      system: "sys",
      guestOs: "ubuntu",
      messages: [{ id: "1", role: "user", content: "design it", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events.filter((ev) => ev.type === "tool_call")).toEqual([
      {
        type: "tool_call",
        id: "call_1",
        name: "file_write",
        arguments: { path: "/workspace/index.html", content: "<html>Hi</html>" },
      },
    ]);
  });

  it("assembles tool calls from a final message object after OpenCode reasoning", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"plan the page"}}]}',
        'data: {"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","function":{"name":"file_write","arguments":{"path":"/workspace/index.html","content":"<html>Hi</html>"}}}]},"finish_reason":"tool_calls"}]}',
        "data: [DONE]",
      ]);
    const req: CompleteRequest = {
      provider: { ...openai, kind: "opencode", baseUrl: "https://opencode.ai/zen/v1" },
      model: "x-preview-f-free",
      system: "sys",
      guestOs: "ubuntu",
      messages: [{ id: "1", role: "user", content: "design it", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events.filter((ev) => ev.type === "tool_call")).toEqual([
      {
        type: "tool_call",
        id: "call_1",
        name: "file_write",
        arguments: { path: "/workspace/index.html", content: "<html>Hi</html>" },
      },
    ]);
  });

  it("throws a retryable error on an empty unknown finish (Ox Alpha / OpenCode)", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"think"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"unknown"}],"usage":{"prompt_tokens":12,"completion_tokens":0}}',
        "data: [DONE]",
      ]);
    const req: CompleteRequest = {
      provider: { ...openai, kind: "opencode", baseUrl: "https://opencode.ai/zen/v1" },
      model: "x-preview-f-free",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "ping", createdAt: "" }],
    };
    const events: ChatEvent[] = [];
    await expect(async () => {
      for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    }).rejects.toMatchObject({ message: UNKNOWN_STOP_MESSAGE, retryable: true });
    expect(events.filter((ev) => ev.type !== "activity" && ev.type !== "reasoning")).toEqual([]);
    expect(isRetryableProviderError(unknownStopError())).toBe(true);
  });

  it("retries an empty unknown finish as a JSON completion", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { stream?: boolean };
      if (calls === 1) {
        expect(body.stream).not.toBe(false);
        return sseResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}',
          'data: {"choices":[{"message":{"role":"assistant","content":null},"finish_reason":"unknown"}]}',
          "data: [DONE]",
        ]);
      }
      expect(body.stream).toBe(false);
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const req: CompleteRequest = {
      provider: { ...openai, kind: "opencode", baseUrl: "https://opencode.ai/zen/v1" },
      model: "x-preview-f-free",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "ping", createdAt: "" }],
    };
    const events = [];
    for await (const ev of runChatTurn((r) => completeChat(r, fetchFn), req, {
      delaysMs: [0],
      idleMs: 0,
    })) {
      events.push(ev);
    }
    expect(calls).toBe(2);
    expect(events.filter((ev) => ev.type === "text")).toEqual([{ type: "text", text: "ok" }]);
  });

  it("assembles a JSON (non-stream) OpenCode tool call", async () => {
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { stream?: boolean; stream_options?: unknown };
      expect(body.stream).toBe(false);
      expect(body.stream_options).toBeUndefined();
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    function: {
                      name: "file_write",
                      arguments: {
                        path: "/workspace/index.html",
                        content: "<html>Hi</html>",
                      },
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 40 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const req: CompleteRequest = {
      provider: { ...openai, kind: "opencode", baseUrl: "https://opencode.ai/zen/v1" },
      model: "x-preview-f-free",
      system: "sys",
      guestOs: "ubuntu",
      stream: false,
      messages: [{ id: "1", role: "user", content: "design it", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events.filter((ev) => ev.type !== "activity")).toEqual([
      {
        type: "tool_call",
        id: "call_1",
        name: "file_write",
        arguments: { path: "/workspace/index.html", content: "<html>Hi</html>" },
      },
      { type: "usage", inputTokens: 20, outputTokens: 40 },
    ]);
  });

  it("sends tool_choice required when requested", async () => {
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { tool_choice?: unknown };
      expect(body.tool_choice).toBe("required");
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', "data: [DONE]"]);
    };
    const req: CompleteRequest = {
      provider: { ...openai, kind: "opencode", baseUrl: "https://opencode.ai/zen/v1" },
      model: "x-preview-f-free",
      system: "sys",
      guestOs: "ubuntu",
      toolChoice: "required",
      messages: [{ id: "1", role: "user", content: "design it", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("ok");
  });

  it("keeps an unknown finish that already produced text", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"done"}}]}',
        'data: {"choices":[{"delta":{},"finishReason":"unknown"}]}',
        "data: [DONE]",
      ]);
    const req: CompleteRequest = {
      provider: { ...openai, kind: "opencode", baseUrl: "https://opencode.ai/zen/v1" },
      model: "x-preview-f-free",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "ping", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("done");
  });

  it("keeps an unknown finish that already assembled a tool call", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"exec","arguments":"{\\"command\\":\\"ls\\"}"}}]}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"unknown"}]}',
        "data: [DONE]",
      ]);
    const req: CompleteRequest = {
      provider: { ...openai, kind: "opencode", baseUrl: "https://opencode.ai/zen/v1" },
      model: "x-preview-f-free",
      system: "sys",
      guestOs: "ubuntu",
      messages: [{ id: "1", role: "user", content: "list files", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events.filter((ev) => ev.type === "tool_call")).toEqual([
      { type: "tool_call", id: "call_1", name: "exec", arguments: { command: "ls" } },
    ]);
  });

  it("extracts tool calls embedded in assistant text", () => {
    expect(
      extractEmbeddedToolCalls(
        'Thinking.\n<tool_call>{"name":"file_write","arguments":{"path":"/workspace/index.html","content":"<html>Hi</html>"}}</tool_call>',
      ),
    ).toEqual([
      {
        name: "file_write",
        arguments: { path: "/workspace/index.html", content: "<html>Hi</html>" },
      },
    ]);
  });

  it("flushes a final SSE frame that has no trailing newline", async () => {
    const encoder = new TextEncoder();
    const fetchFn: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}'));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    const req: CompleteRequest = {
      provider: openai,
      model: "gpt-4.1",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("ok");
  });

  it("skips a malformed SSE frame instead of aborting the turn", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        "data: {not-json",
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
    const req: CompleteRequest = {
      provider: openai,
      model: "gpt-4.1",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("ok");
  });

  it("joins OpenAI content-part arrays", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Hel"},{"type":"text","text":"lo"}]}}]}',
        "data: [DONE]",
      ]);
    const req: CompleteRequest = {
      provider: openai,
      model: "gpt-4.1",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("Hello");
  });

  it("omits stream_options for local OpenAI-compatible servers", async () => {
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        stream_options?: unknown;
        max_tokens?: unknown;
      };
      expect(body.stream_options).toBeUndefined();
      expect(body.max_tokens).toBeUndefined();
      return sseResponse(['data: {"choices":[{"delta":{"content":"x"}}]}', "data: [DONE]"]);
    };
    const req: CompleteRequest = {
      provider: { ...openai, kind: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1" },
      model: "llama3.2",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("x");
  });

  it("streams Anthropic text deltas", async () => {
    const fetchFn: typeof fetch = async (input) => {
      expect(String(input)).toContain("/v1/messages");
      return sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hey"}}',
        'data: {"type":"message_stop"}',
      ]);
    };
    const req: CompleteRequest = {
      provider: { ...openai, kind: "anthropic", baseUrl: "https://api.anthropic.com" },
      model: "claude-sonnet-4-5",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    expect(await textOf(req, fetchFn)).toBe("Hey");
  });

  it("emits Anthropic usage from message_start and message_delta", async () => {
    const fetchFn: typeof fetch = async () =>
      sseResponse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":80,"output_tokens":1}}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Ok"}}',
        'data: {"type":"message_delta","usage":{"output_tokens":9}}',
        'data: {"type":"message_stop"}',
      ]);
    const req: CompleteRequest = {
      provider: { ...openai, kind: "anthropic", baseUrl: "https://api.anthropic.com" },
      model: "claude-sonnet-4-5",
      system: "sys",
      messages: [{ id: "1", role: "user", content: "hi", createdAt: "" }],
    };
    const events = [];
    for await (const ev of completeChat(req, fetchFn)) events.push(ev);
    expect(events.filter((ev) => ev.type !== "activity")).toEqual([
      { type: "text", text: "Ok" },
      { type: "usage", inputTokens: 80, outputTokens: 9 },
    ]);
  });

  it("rejects missing keys", async () => {
    const req: CompleteRequest = {
      provider: { ...openai, apiKey: "" },
      model: "gpt-4.1",
      system: "s",
      messages: [],
    };
    await expect(async () => {
      for await (const _ of completeChat(req)) {
        /* drain */
      }
    }).rejects.toThrow(/API key/);
  });
});

describe("message mapping", () => {
  it("round-trips assistant tool calls into OpenAI and Anthropic payloads", () => {
    const messages: ChatMessage[] = [
      { id: "u", role: "user", content: "run ls", createdAt: "" },
      {
        id: "a",
        role: "assistant",
        content: "",
        createdAt: "",
        toolCalls: [{ id: "call_1", name: "exec", arguments: { command: "ls" }, startedAt: "" }],
      },
      { id: "t", role: "tool", toolCallId: "call_1", content: "bin\nhome", createdAt: "" },
    ];
    const oa = toOpenAi(messages, "sys");
    expect(oa[0]).toMatchObject({ role: "system" });
    expect(oa[2]).toMatchObject({ role: "assistant" });
    expect(oa[3]).toMatchObject({ role: "tool", tool_call_id: "call_1" });

    const an = toAnthropic(messages);
    expect(an[1]?.role).toBe("assistant");
    expect(an[2]).toMatchObject({ role: "user" });
  });

  it("closes an unanswered tool call so the next turn is a valid request", () => {
    const messages: ChatMessage[] = [
      { id: "u", role: "user", content: "read the engine", createdAt: "" },
      {
        id: "a",
        role: "assistant",
        content: "",
        createdAt: "",
        toolCalls: [
          {
            id: "call_read",
            name: "read",
            arguments: { path: "js/engine.js", offset: "325" },
            startedAt: "",
          },
          { id: "call_read", name: "read", arguments: { path: "js/engine.js" }, startedAt: "" },
        ],
      },
      { id: "u2", role: "user", content: "Can you continue on?", createdAt: "" },
    ];
    const oa = toOpenAi(messages, "sys");
    const assistant = oa.find((row) => row.role === "assistant") as {
      tool_calls: Array<{ id: string }>;
    };
    expect(assistant.tool_calls.map((call) => call.id)).toEqual(["call_read", "call_read_2"]);
    const tools = oa.filter((row) => row.role === "tool");
    expect(tools.map((row) => row.tool_call_id)).toEqual(["call_read", "call_read_2"]);
    expect(tools.every((row) => row.content === UNANSWERED_TOOL_RESULT)).toBe(true);
    const continueAt = oa.findIndex(
      (row) => row.role === "user" && row.content === "Can you continue on?",
    );
    const lastTool = oa.map((row) => row.role).lastIndexOf("tool");
    expect(lastTool).toBeGreaterThan(-1);
    expect(continueAt).toBeGreaterThan(lastTool);

    const an = toAnthropic(messages);
    const roles = an.map((row) => row.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
    const follow = an[2] as {
      content: Array<{ type?: string; tool_use_id?: string; text?: string }>;
    };
    expect(follow.content.map((block) => block.type)).toEqual([
      "tool_result",
      "tool_result",
      "text",
    ]);
    expect(follow.content.map((block) => block.tool_use_id ?? block.text)).toEqual([
      "call_read",
      "call_read_2",
      "Can you continue on?",
    ]);
  });

  it("drops blank assistant placeholders so the model still sees the user prompt", () => {
    const messages: ChatMessage[] = [
      { id: "u", role: "user", content: "Design a one-pager", createdAt: "" },
      { id: "a", role: "assistant", content: "", createdAt: "" },
    ];
    const oa = toOpenAi(messages, "sys");
    expect(oa.filter((row) => row.role === "assistant")).toEqual([]);
    expect(oa.some((row) => row.role === "user" && row.content === "Design a one-pager")).toBe(
      true,
    );
    expect(toAnthropic(messages).filter((row) => row.role === "assistant")).toEqual([]);
  });

  it("does not send thinking-only assistants back to OpenAI or Anthropic", () => {
    const messages: ChatMessage[] = [
      { id: "u", role: "user", content: "Design a one-pager", createdAt: "" },
      {
        id: "a",
        role: "assistant",
        content: "",
        thinking: "Keep the hero tight and use the kit tokens.",
        createdAt: "",
      },
    ];
    expect(toOpenAi(messages, "sys").filter((row) => row.role === "assistant")).toEqual([]);
    expect(toAnthropic(messages).filter((row) => row.role === "assistant")).toEqual([]);
    expect(
      JSON.stringify({ openai: toOpenAi(messages, "sys"), anthropic: toAnthropic(messages) }),
    ).not.toContain("Keep the hero tight");
  });

  it("keeps stable system and repo map before volatile compaction notes", () => {
    const messages: ChatMessage[] = [{ id: "u", role: "user", content: "hi", createdAt: "" }];
    const oa = toOpenAi(messages, "You are Locus.", {
      cacheBlocks: ["Repo map (1 files)"],
      volatilePrefix: "Earlier in this session (2 messages omitted to save context):",
      provider: openai,
    });
    expect(oa[0]).toMatchObject({ role: "system" });
    expect(JSON.stringify(oa[0]?.content)).toContain("You are Locus.");
    expect(JSON.stringify(oa[0]?.content)).toContain("Repo map");
    expect(JSON.stringify(oa[0]?.content)).not.toContain("omitted");
    expect(oa[1]).toMatchObject({ role: "user", content: "hi" });
    expect(oa[2]).toMatchObject({
      role: "system",
      content: "Earlier in this session (2 messages omitted to save context):",
    });
    expect(JSON.stringify(oa)).not.toContain("cache_control");
    const system = toAnthropicSystem({
      system: "You are Locus.",
      cacheBlocks: ["Repo map (1 files)"],
      volatilePrefix: "Earlier in this session (2 messages omitted to save context):",
    });
    expect(JSON.stringify(system)).toContain("cache_control");
    expect(JSON.stringify(system)).not.toContain("omitted");
    const an = toAnthropic(
      messages,
      "Earlier in this session (2 messages omitted to save context):",
    );
    expect(JSON.stringify(an[0])).toContain("cache_control");
    expect(JSON.stringify(an[0])).toContain("hi");
    expect(JSON.stringify(an[0])).toContain("omitted");
    expect(JSON.stringify(an[0]).indexOf("hi")).toBeLessThan(
      JSON.stringify(an[0]).indexOf("omitted"),
    );
  });

  it("sends OpenRouter cache_control on the stable system prefix", () => {
    const messages: ChatMessage[] = [{ id: "u", role: "user", content: "hi", createdAt: "" }];
    const oa = toOpenAi(messages, "You are Locus.", {
      cacheBlocks: ["Repo map (1 files)"],
      volatilePrefix: "Guest status: running",
      provider: {
        ...openai,
        kind: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
      },
    });
    expect(JSON.stringify(oa[0])).toContain("cache_control");
    expect(JSON.stringify(oa[0])).toContain("You are Locus.");
    expect(JSON.stringify(oa[0])).not.toContain("Guest status");
    expect(oa.at(-1)).toMatchObject({ role: "system", content: "Guest status: running" });
  });

  it("tells docker agents to git_clone when no repo is attached", () => {
    const parts = buildSystemPromptParts({
      os: "ubuntu",
      runtime: "docker",
      dockerImage: "locus/agent",
      tools: toolsForOs("ubuntu"),
    });
    expect(parts.stable).toMatch(/Call git_clone with the project URL/);
    expect(parts.stable).toMatch(
      /Do not call git_pr_list or git_issue_list until a repo is attached/,
    );
  });

  it("keeps guest status out of the cached system prefix", () => {
    const ready = buildSystemPromptParts({
      os: "ubuntu",
      runtime: "docker",
      dockerImage: "locus/agent",
      tools: toolsForOs("ubuntu"),
      vmStatus: "running",
    });
    const booting = buildSystemPromptParts({
      os: "ubuntu",
      runtime: "docker",
      dockerImage: "locus/agent",
      tools: toolsForOs("ubuntu"),
      vmStatus: "booting",
    });
    expect(ready.stable).toBe(booting.stable);
    expect(ready.volatile).toContain("running");
    expect(booting.volatile).toContain("not ready yet");
  });

  it("keeps vision, web search, and plan mode out of the cached system prefix", () => {
    const base = {
      os: "ubuntu" as const,
      runtime: "docker" as const,
      dockerImage: "locus/agent",
      tools: toolsForOs("ubuntu"),
      vmStatus: "running",
    };
    const off = buildSystemPromptParts(base);
    const vision = buildSystemPromptParts({ ...base, vision: "latest" });
    const search = buildSystemPromptParts({ ...base, webSearch: true });
    const plan = buildSystemPromptParts({ ...base, plan: true });
    expect(vision.stable).toBe(off.stable);
    expect(search.stable).toBe(off.stable);
    expect(plan.stable).toBe(off.stable);
    expect(off.volatile).toMatch(/Vision is off/);
    expect(vision.volatile).toMatch(/latest screenshot/);
    expect(search.volatile).toMatch(/Web search is on/);
    expect(plan.volatile).toMatch(/Plan mode is on/);
    expect(off.stable).not.toMatch(/Vision is off/);
    expect(off.stable).not.toMatch(/Web search is on/);
    expect(off.stable).not.toMatch(/Plan mode is on/);
  });

  it("reads prompt-cache hits from OpenAI and Anthropic usage", () => {
    expect(
      readTokenUsage({
        prompt_tokens: 100,
        completion_tokens: 10,
        prompt_tokens_details: { cached_tokens: 40 },
      })?.cachedInputTokens,
    ).toBe(40);
    expect(
      readTokenUsage({ input_tokens: 80, output_tokens: 5, cache_read_input_tokens: 20 })
        ?.cachedInputTokens,
    ).toBe(20);
    expect(
      readTokenUsage({
        inputTokens: 7,
        outputTokens: 548,
        cacheReadTokens: 147_695,
        cacheWriteTokens: 39_331,
      }),
    ).toEqual({
      inputTokens: 7,
      outputTokens: 548,
      cachedInputTokens: 147_695,
      cacheWriteTokens: 39_331,
    });
  });

  it("attaches screenshots as images for OpenAI and Anthropic", () => {
    const messages: ChatMessage[] = [
      { id: "u", role: "user", content: "click", createdAt: "" },
      {
        id: "a",
        role: "assistant",
        content: "",
        createdAt: "",
        toolCalls: [{ id: "call_1", name: "screenshot", arguments: {}, startedAt: "" }],
      },
      {
        id: "t",
        role: "tool",
        toolCallId: "call_1",
        content: "screenshot captured",
        screenshotBase64: "abc123",
        createdAt: "",
      },
    ];
    const oa = toOpenAi(messages, "sys");
    expect(
      oa.some(
        (row) => Array.isArray(row.content) && JSON.stringify(row.content).includes("image_url"),
      ),
    ).toBe(true);
    const an = toAnthropic(messages);
    const toolUser = an.find((row) => row.role === "user" && Array.isArray(row.content));
    expect(JSON.stringify(toolUser)).toContain("image");
    expect(JSON.stringify(toolUser)).toContain("abc123");
  });

  it("sends user attachments as images with the stored mime type", () => {
    const messages: ChatMessage[] = [
      {
        id: "u",
        role: "user",
        content: "look at this",
        screenshotBase64: "abc123",
        screenshotMime: "image/jpeg",
        createdAt: "",
      },
    ];
    const oa = toOpenAi(messages);
    expect(JSON.stringify(oa)).toContain("data:image/jpeg;base64,abc123");
    const an = toAnthropic(messages);
    expect(JSON.stringify(an)).toContain('"media_type":"image/jpeg"');
    expect(JSON.stringify(an)).toContain("abc123");
  });

  it("exports OpenAI tool defs per OS", () => {
    expect(openaiToolDefs("ubuntu").some((t) => t.function.name === "exec")).toBe(true);
    expect(openaiToolDefs("ubuntu").some((t) => t.function.name === "powershell")).toBe(false);
    expect(toolsForOs("windows-11").some((t) => t.name === "powershell")).toBe(true);
  });
});

describe("prompt", () => {
  it("names the guest OS and tools", () => {
    const text = buildSystemPrompt({
      os: "windows-11",
      vmStatus: "running",
      repoUrl: "https://github.com/acme/app.git",
      tools: toolsForOs("windows-11"),
    });
    expect(text).toContain("Windows 11");
    expect(text).toContain("powershell");
    expect(text).toContain("uia_tree");
    expect(text).toContain("github.com/acme/app.git");
    expect(text).toContain("call tools");
    expect(text).toContain("C:\\host");
    expect(text).toContain("record_screen");
    expect(text).toContain("Independent reads belong in one turn");
    expect(text).toContain("repo_map");
  });

  it("tells the model to skip guest tools while the VM is starting", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      vmStatus: "booting",
      tools: toolsForOs("ubuntu"),
    });
    expect(text).toContain("still starting");
    expect(text).toContain("do not call guest tools");
  });

  it("describes a docker container without desktop tools", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      vmStatus: "running",
      tools: toolsForOs("ubuntu").filter((t) => t.name === "exec" || t.name === "git_commit"),
    });
    expect(text).toContain("Docker container");
    expect(text).toContain("node:22-bookworm");
    expect(text).toContain("/workspace");
    expect(text).toContain("record_screen");
    expect(text).toContain("Headed Chromium");
    expect(text).toContain("preview");
    expect(text).toContain("0.0.0.0");
    expect(text).toContain("Vision is off");
    expect(text).toMatch(/user-attached images/i);
    expect(text).toMatch(/Python\/Pillow/);
    expect(text).toContain("git_commit, git_push, and git_pr");
    expect(text).toContain("browser_tabs");
    expect(text).toContain("browser_snapshot");
    expect(text).toContain("Prefer snapshot+ref");
    expect(text).toContain("Independent reads belong in one turn");
    expect(text).toContain("commands[]");
    expect(text).toContain("heredocs");
    expect(text).toContain("repo_map");
  });

  it("describes a host agent with a local /workspace", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      runtime: "host",
      tools: [
        { name: "file_write", description: "Write a file." },
        { name: "exec", description: "Run a shell command." },
      ],
    });
    expect(text).toContain("no VM or Docker container");
    expect(text).toContain("/workspace");
    expect(text).toContain("security exception");
    expect(text).toContain("Available host tools");
    expect(text).toContain("start a Docker or VM agent");
    expect(text).toContain("host-chrome");
    expect(text).not.toContain("Guest OS");
    const live = buildSystemPrompt({
      os: "ubuntu",
      runtime: "host",
      liveChrome: true,
      tools: [
        { name: "file_write", description: "Write a file." },
        { name: "browser_snapshot", description: "Snapshot the page." },
      ],
    });
    expect(live).toContain("Use my Chrome is on");
    expect(live).toContain("real Chrome");
    expect(text).not.toContain("You cannot run a shell");
    const withPeers = buildSystemPrompt({
      os: "ubuntu",
      runtime: "host",
      tools: [
        { name: "file_write", description: "Write a file." },
        {
          name: "host_sessions",
          description: "List or inspect other Locus chats.",
        },
      ],
    });
    expect(withPeers).toContain("host_sessions");
    const withCanvas = buildSystemPrompt({
      os: "ubuntu",
      runtime: "host",
      tools: [
        { name: "file_write", description: "Write a file." },
        { name: "canvas_write", description: "Write a canvas." },
        { name: "canvas_read", description: "Read a canvas." },
      ],
    });
    expect(withCanvas).toContain("canvas_write");
    expect(withCanvas).toContain("durable HTML document");
    expect(text).not.toContain("durable HTML document");
    expect(withPeers).toMatch(/Games, Assets, Design/);
  });

  it("tells design sessions to write a live canvas file", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      runtime: "docker",
      kind: "design",
      dockerImage: "ubuntu:24.04",
      vmStatus: "running",
      tools: toolsForOs("ubuntu").filter(
        (t) => t.name === "file_write" || t.name === "apply_patch",
      ),
    });
    expect(text).toContain("Locus Design");
    expect(text).toContain("/workspace/index.html");
    expect(text).toContain("live canvas");
    expect(text).toContain("mouse-tracking");
    expect(text).toContain("paints while you stream");
    expect(text).toContain("Do not end the turn with only chat");
    expect(text).toContain("Do not treat the first paint as finished work");
    expect(text).toMatch(/never paste the page source into chat/);
    expect(text).toContain("never split the page into parts/");
    expect(text).toContain("cut off before </html>");
    expect(text).toContain("ask_user");
    expect(text).toMatch(/websearch \(1–2 queries\)/);
    expect(text).toMatch(/Do not interview to ask what a named thing is/);
    expect(text).not.toContain("git_commit");
    expect(text).toContain("No repository is attached");
    expect(text).toContain("except for the canvas you write");
    expect(text).not.toContain("Call git_clone");
  });

  it("tells design sessions with a repo to inspect the cloned tree", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      runtime: "docker",
      kind: "design",
      dockerImage: "ubuntu:24.04",
      vmStatus: "running",
      repoUrl: "https://github.com/acme/app.git",
      repoRef: "main",
      tools: toolsForOs("ubuntu").filter(
        (t) => t.name === "file_write" || t.name === "apply_patch",
      ),
    });
    expect(text).toContain("Attached repository: https://github.com/acme/app.git (ref main)");
    expect(text).toContain("cloned into /workspace/_repo as read-only design context");
    expect(text).toContain("Do not edit files under /workspace/_repo");
    expect(text).toContain("Skim CONTEXT.md");
    expect(text).toContain("do not walk the whole tree");
    expect(text).toContain("Your only write target is the live canvas at /workspace/index.html");
    expect(text).toContain("does not commit, push, or open pull requests");
    expect(text).not.toContain("Call git_clone");
  });

  it("includes linked asset packs on game prompts", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      runtime: "docker",
      kind: "game",
      dockerImage: "ubuntu:24.04",
      vmStatus: "running",
      linkedAssets:
        "Linked assets:\n@asset:hero-mesh — Hero mesh (mesh)\n  - model: /workspace/vendor/assets/hero-mesh/model.glb",
      tools: toolsForOs("ubuntu").filter(
        (t) => t.name === "file_write" || t.name === "apply_patch",
      ),
    });
    expect(text).toContain("@asset:hero-mesh");
    expect(text).toContain("/workspace/vendor/assets/hero-mesh/model.glb");
  });

  it("lists dests when several repos are attached", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      runtime: "docker",
      dockerImage: "locus/agent",
      repos: [
        { forge: "github", url: "https://github.com/acme/app.git", dest: "/workspace/app" },
        { forge: "github", url: "https://github.com/acme/lib.git", dest: "/workspace/lib" },
      ],
      tools: toolsForOs("ubuntu"),
    });
    expect(text).toContain("at /workspace/app — primary");
    expect(text).toContain("at /workspace/lib");
    expect(text).toMatch(/Pass path to git_status/);
  });

  it("includes a design color palette", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      runtime: "docker",
      kind: "design",
      dockerImage: "ubuntu:24.04",
      vmStatus: "running",
      tools: toolsForOs("ubuntu").filter((t) => t.name === "file_write"),
      palette: {
        bg: "#111114",
        surface: "#1c1c22",
        text: "#f4f1ea",
        muted: "#9a958c",
        primary: "#e08a4c",
        accent: "#d4c4a8",
      },
    });
    expect(text).toContain("--primary (primary): #e08a4c");
    expect(text).toContain("CSS variables");
  });

  it("includes typography tokens when a design system is attached", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      runtime: "docker",
      kind: "design",
      dockerImage: "ubuntu:24.04",
      vmStatus: "running",
      tools: toolsForOs("ubuntu").filter((t) => t.name === "file_write"),
      designSystem: {
        id: "sys1",
        name: "Acme",
        summary: "Warm brand",
        palette: {
          bg: "#111114",
          surface: "#1c1c22",
          text: "#f4f1ea",
          muted: "#9a958c",
          primary: "#e08a4c",
          accent: "#d4c4a8",
        },
        typography: {
          sans: "Inter, sans-serif",
          display: "Inter, sans-serif",
          mono: "JetBrains Mono, monospace",
          basePx: 16,
        },
        radiusPx: 8,
        spacePx: 10,
        guidelines: "No purple.",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(text).toContain("--font-sans: Inter, sans-serif");
    expect(text).toContain("No purple.");
    expect(text).toContain("--radius: 8px");
    expect(text).toContain("--line:");
    expect(text).toContain("Product UI habits");
  });

  it("includes a saved asset style on Assets prompts", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      runtime: "docker",
      kind: "assets",
      dockerImage: "ubuntu:24.04",
      vmStatus: "running",
      tools: toolsForOs("ubuntu").filter((t) => t.name === "file_write"),
      assetStyle: {
        id: "st1",
        name: "Clay hero",
        summary: "Chunky terracotta",
        guidelines: "Rounded silhouettes, 2k tris.",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      assetBuild: {
        topology: "high-detail",
        quality: "flagship",
        resolution: "4x",
        restPose: "t-pose",
        polyBudget: "8k",
        texture: true,
        split: false,
        multiView: true,
        enhance: true,
        printable: true,
      },
    });
    expect(text).toContain('Saved asset style "Clay hero"');
    expect(text).toContain("2k tris");
    expect(text).toMatch(/Locus Assets/);
    expect(text).toMatch(/Operator build settings/);
    expect(text).toMatch(/High detail/);
    expect(text).toMatch(/watertight/);
    expect(text).toMatch(/T-Pose/);
  });

  it("tells design sessions to compose from a landed brand kit", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      runtime: "docker",
      kind: "design",
      dockerImage: "ubuntu:24.04",
      vmStatus: "running",
      tools: toolsForOs("ubuntu").filter((t) => t.name === "file_write"),
      kitSkill: 'Use the "Harbor" skill.\nUse Inter, green CTAs, and marketing ui_kits.',
      designSystem: {
        id: "sys1",
        name: "Harbor",
        summary: "Retail brand",
        palette: {
          bg: "#f7f4ee",
          surface: "#efe8d8",
          text: "#1c1914",
          muted: "#6f6758",
          primary: "#1f6b4a",
          accent: "#2a3a32",
        },
        typography: {
          sans: "Inter, sans-serif",
          display: "Inter, sans-serif",
          mono: "ui-monospace, monospace",
          basePx: 16,
        },
        radiusPx: 10,
        spacePx: 8,
        kit: { fileCount: 12, bytes: 4000, skillName: "harbor-design", skillTitle: "Harbor" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(text).toContain("brand kit is in /workspace");
    expect(text).toContain("ui_kits");
    expect(text).toContain("assets/logo.svg");
    expect(text).toContain('Use the "Harbor" skill.');
    expect(text).toContain("No CDNs");
    expect(text).not.toContain("Do not load webfonts or CDNs; use these stacks as-is.");
  });

  it("uses the default design palette when the session has none", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      runtime: "docker",
      kind: "design",
      dockerImage: "ubuntu:24.04",
      vmStatus: "running",
      tools: toolsForOs("ubuntu").filter((t) => t.name === "file_write"),
    });
    expect(text).toContain("--primary (primary): #e08a4c");
  });

  it("includes operator instructions", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      tools: toolsForOs("ubuntu"),
      instructions: "Always commit on a branch.",
    });
    expect(text).toContain("Operator instructions");
    expect(text).toContain("Always commit on a branch.");
    expect(text).toContain("untrusted-data");
    expect(text).toContain("environment variables");
  });

  it("adds a Claude prompt variant when the model is pinned", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      tools: toolsForOs("ubuntu"),
      model: "claude-sonnet-4-5",
    });
    expect(text).toContain("Claude:");
    expect(text).toContain("cache-stable");
  });

  it("describes supervised and autonomous approval modes", () => {
    expect(
      buildSystemPrompt({ os: "ubuntu", tools: toolsForOs("ubuntu"), autonomy: "supervised" }),
    ).toContain("every mutating command waits");
    expect(
      buildSystemPrompt({ os: "ubuntu", tools: toolsForOs("ubuntu"), autonomy: "autonomous" }),
    ).toContain("unattended");
    expect(buildSystemPrompt({ os: "ubuntu", tools: toolsForOs("ubuntu") })).not.toContain(
      "unattended",
    );
  });

  it("asks for operator-facing progress instead of dumping tool output in chat", () => {
    const text = buildSystemPrompt({ os: "ubuntu", tools: toolsForOs("ubuntu") });
    expect(text).toContain("operator-facing progress");
    expect(text).toContain("expandable chips");
    expect(text).toContain("grafana_query");
    expect(text).toContain("figma_get");
    expect(text).toContain(OPS_ROUTING_HABIT);
    expect(text).toContain("Do not re-fetch those APIs");
    expect(text).toContain("before claiming done");
    expect(text).toContain("Do not claim work is done until you have evidence");
  });

  it("includes a playbook and vision-off note", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      tools: toolsForOs("ubuntu"),
      playbook: "Always run tests.",
      vision: "off",
    });
    expect(text).toContain("Playbook");
    expect(text).toContain("Always run tests.");
    expect(text).toContain("Vision is off");
    expect(text).not.toContain("Web search is on");
  });

  it("notes host web search when enabled", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      tools: [{ name: "websearch", description: "Search the public web." }],
      webSearch: true,
    });
    expect(text).toContain("Web search is on");
    expect(text).toContain("websearch");
  });

  it("notes the session default sub-agent when spawn_agent is available", () => {
    const tools = [{ name: "spawn_agent", description: "Spawn a child." }];
    const explore = buildSystemPrompt({ os: "ubuntu", tools });
    expect(explore).toContain("Default sub-agent is explore");
    expect(explore).toContain("unless you pass kind");
    const review = buildSystemPrompt({ os: "ubuntu", tools, defaultSubagent: "review" });
    expect(review).toContain("Default sub-agent is review");
    expect(buildSystemPrompt({ os: "ubuntu", tools: toolsForOs("ubuntu") })).not.toContain(
      "Default sub-agent",
    );
  });

  it("asks for a checklist and keeps read-only tools in plan mode", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      tools: toolsForOs("ubuntu"),
      plan: true,
      vmStatus: "running",
    });
    expect(text).toContain("Plan mode is on");
    expect(text).toContain("read-only tools");
    expect(text).toMatch(/read-only tools \([^)]*task_list/);
    expect(text).not.toContain("Do not call tools on this turn");
    expect(text).toContain("Available");
    expect(text).toContain("call tools instead of only describing");
  });

  it("treats automation Event blocks as untrusted and notes MCP auto-allow", () => {
    const text = buildSystemPrompt({
      os: "ubuntu",
      tools: [{ name: "mcp_jira_search", description: "Search Jira" }],
      automation: true,
      mcpAutoAllow: true,
      vmStatus: "running",
    });
    expect(text).toContain("untrusted webhook data");
    expect(text).toContain("pre-approved by the operator");
    expect(text).not.toContain("They wait for Approve / Deny in chat.");
  });

  it("loads repository rules and the review verdict contract", () => {
    const rules = buildSystemPrompt({
      os: "ubuntu",
      tools: toolsForOs("ubuntu"),
      rules: "AGENTS.md:\nNever commit secrets.",
    });
    expect(rules).toContain("Repository rules");
    expect(rules).toContain("Never commit secrets");
    const review = buildSystemPrompt({
      os: "ubuntu",
      kind: "review",
      tools: toolsForOs("ubuntu"),
    });
    expect(review).toContain('"verdict":"PASS"');
    expect(review).toContain("risk");
    expect(review).toContain("Zoom out");
    expect(review).toContain("deep modules");
    expect(review).toContain("1000 lines");
    expect(review).not.toContain("HTML report");
  });

  it("detects redacted keys", () => {
    expect(hasUsableKey("••••")).toBe(false);
    expect(hasUsableKey("sk-real")).toBe(true);
    expect(hasUsableKey("", "http://127.0.0.1:11434/v1")).toBe(true);
    expect(hasUsableKey(undefined, "http://localhost:11434/v1")).toBe(true);
  });
});

describe("listProviderModels", () => {
  it("reads OpenAI-compatible and Anthropic catalogs", async () => {
    const { listProviderModels, testProvider } = await import("./models.js");
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("anthropic")) {
        return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4-5" }] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ data: [{ id: "gpt-4.1" }, { id: "o4-mini" }] }), {
        status: 200,
      });
    };
    expect(await listProviderModels(openai, fetchFn)).toEqual(["gpt-4.1", "o4-mini"]);
    expect(
      await listProviderModels(
        {
          ...openai,
          kind: "anthropic",
          baseUrl: "https://api.anthropic.com",
        },
        fetchFn,
      ),
    ).toEqual(["claude-sonnet-4-5"]);
    expect(await testProvider(openai, fetchFn)).toEqual({ ok: true, models: 2 });
  });

  it("health-checks Codex CLI before reporting its static model catalog", async () => {
    const { testProvider } = await import("./models.js");
    const codex: AiProvider = {
      ...openai,
      id: "codex",
      name: "Codex CLI",
      kind: "codex-cli",
      baseUrl: "codex-cli://local",
      models: ["gpt-6-astra"],
      defaultModel: "gpt-6-astra",
      apiKey: "",
    };
    const spawnFn: CursorCliSpawner = (req) => ({
      lines: (async function* () {
        yield req.args.includes("--version") ? "codex-cli 0.154.0" : "Logged in using ChatGPT";
      })(),
      wait: async () => ({ code: 0, stderr: "" }),
    });
    await expect(testProvider(codex, fetch, spawnFn)).resolves.toEqual({
      ok: true,
      models: 1,
      version: "0.154.0",
      authMode: "chatgpt",
      command: "codex",
      scope: "control-plane",
    });
  });

  it("health-checks Claude Code before reporting its static model catalog", async () => {
    const { testProvider } = await import("./models.js");
    const claude: AiProvider = {
      ...openai,
      id: "claude-code",
      name: "Claude Code",
      kind: "claude-code",
      baseUrl: "claude-code://local",
      models: ["claude-sonnet-4-5"],
      defaultModel: "claude-sonnet-4-5",
      apiKey: "",
    };
    const spawnFn: CursorCliSpawner = (req) => ({
      lines: (async function* () {
        yield req.args.includes("--version")
          ? "2.1.286 (Claude Code)"
          : JSON.stringify({ loggedIn: true, authMethod: "claude.ai" });
      })(),
      wait: async () => ({ code: 0, stderr: "" }),
    });
    await expect(testProvider(claude, fetch, spawnFn)).resolves.toEqual({
      ok: true,
      models: 1,
      version: "2.1.286",
      authMode: "claude.ai",
      command: "claude",
      scope: "control-plane",
    });
  });

  it("health-checks Kiro CLI before reporting its static model catalog", async () => {
    const { testProvider } = await import("./models.js");
    const kiro: AiProvider = {
      ...openai,
      id: "kiro-cli",
      name: "Kiro CLI",
      kind: "kiro-cli",
      baseUrl: "kiro-cli://local",
      models: ["auto"],
      defaultModel: "auto",
      apiKey: "",
    };
    const spawnFn: CursorCliSpawner = (req) => ({
      lines: (async function* () {
        yield req.args.includes("--version")
          ? "kiro-cli 2.33.0"
          : JSON.stringify({ loggedIn: true, authType: "builder_id" });
      })(),
      wait: async () => ({ code: 0, stderr: "" }),
    });
    await expect(testProvider(kiro, fetch, spawnFn)).resolves.toEqual({
      ok: true,
      models: 1,
      version: "2.33.0",
      authMode: "account",
      command: "kiro-cli",
      scope: "control-plane",
    });
  });

  it("sends OpenRouter attribution headers when listing models", async () => {
    const { listProviderModels } = await import("./models.js");
    const fetchFn: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://openrouter.ai/api/v1/models");
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer sk-test");
      expect(headers["HTTP-Referer"]).toBe(OPENROUTER_APP_URL);
      expect(headers["X-Title"]).toBe(OPENROUTER_APP_TITLE);
      return new Response(JSON.stringify({ data: [{ id: "openai/gpt-4.1" }] }), { status: 200 });
    };
    expect(
      await listProviderModels(
        {
          ...openai,
          kind: "openrouter",
          name: "OpenRouter",
          baseUrl: "https://openrouter.ai/api/v1",
        },
        fetchFn,
      ),
    ).toEqual(["openai/gpt-4.1"]);
  });

  it("lists Cursor Cloud models from GET /v1/models items", async () => {
    const { listProviderModels } = await import("./models.js");
    const fetchFn: typeof fetch = async (input) => {
      expect(String(input)).toBe("https://api.cursor.com/v1/models");
      return new Response(
        JSON.stringify({
          items: [{ id: "composer-2", displayName: "Composer 2" }, { id: "auto-smart" }],
        }),
        { status: 200 },
      );
    };
    expect(
      await listProviderModels(
        {
          ...openai,
          kind: "cursor",
          name: "Cursor Cloud",
          baseUrl: "https://api.cursor.com/v1",
        },
        fetchFn,
      ),
    ).toEqual(["auto-smart", "composer-2"]);
  });

  it("rejects a missing key", async () => {
    const { listProviderModels } = await import("./models.js");
    await expect(listProviderModels({ ...openai, apiKey: "" })).rejects.toThrow(
      "API key is not set",
    );
  });

  it("rewrites Fastify chat/completions 404s for leftover Cursor hosts", async () => {
    const { ProviderError } = await import("./types.js");
    const { rewriteCursorCompletionsError } = await import("./models.js");
    const err = new ProviderError(
      JSON.stringify({
        message: "Route POST:/chat/completions not found",
        error: "Not Found",
        statusCode: 404,
      }),
      404,
    );
    expect(
      rewriteCursorCompletionsError(
        { kind: "openai-compatible", baseUrl: "https://api2.cursor.sh" },
        err,
      ),
    ).toMatchObject({
      status: 404,
      message: expect.stringMatching(/no OpenAI-compatible POST \/v1\/chat\/completions/),
    });
    expect(rewriteCursorCompletionsError({ kind: "openai", baseUrl: openai.baseUrl }, err)).toBe(
      err,
    );
  });
});
