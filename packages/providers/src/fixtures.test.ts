import { describe, expect, it } from "vitest";
import type { AiProvider } from "@locus/shared";
import { completeChat } from "./router.js";
import { runChatTurn } from "./loop.js";
import { DEFAULT_OPENAI_MAX_TOKENS } from "./openai.js";
import { UNKNOWN_STOP_MESSAGE } from "./types.js";
import { isRetryableProviderError } from "./retry.js";
import type { ChatEvent, CompleteRequest } from "./types.js";
import { DEFAULT_FIXTURE_MESSAGES, STREAM_FIXTURES, type StreamFixture } from "./fixtures.js";

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

function sseResponse(frames: Array<string | Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        const line = typeof frame === "string" ? frame : JSON.stringify(frame);
        const payload = line.startsWith("data:") ? line : `data: ${line}`;
        controller.enqueue(encoder.encode(`${payload}\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function requestFor(fixture: StreamFixture): CompleteRequest {
  return {
    provider: {
      ...openai,
      kind: fixture.providerKind ?? "openai",
      baseUrl: fixture.baseUrl ?? openai.baseUrl,
    },
    model: fixture.model ?? "gpt-4.1",
    system: "sys",
    guestOs: fixture.guestOs,
    messages: fixture.messages ?? DEFAULT_FIXTURE_MESSAGES,
  };
}

async function play(fixture: StreamFixture): Promise<{
  events: ChatEvent[];
  calls: number;
  maxTokens: unknown;
  messages: Array<{ role?: string }> | undefined;
  error: unknown;
}> {
  let calls = 0;
  let maxTokens: unknown;
  let messages: Array<{ role?: string }> | undefined;
  const fetchFn: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      max_tokens?: unknown;
      messages?: Array<{ role?: string }>;
      stream?: boolean;
    };
    if (calls === 0) {
      maxTokens = body.max_tokens;
      messages = body.messages;
    }
    const attempt = fixture.attempts[Math.min(calls, fixture.attempts.length - 1)]!;
    calls += 1;
    if (body.stream === false) {
      const json = attempt.json ?? {
        choices: [{ message: { content: "" }, finish_reason: "stop" }],
      };
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return sseResponse(attempt.frames ?? ["[DONE]"]);
  };
  const req = requestFor(fixture);
  const events: ChatEvent[] = [];
  let error: unknown;
  try {
    const stream = fixture.loop
      ? runChatTurn((r) => completeChat(r, fetchFn), req, fixture.loop)
      : completeChat(req, fetchFn);
    for await (const ev of stream) events.push(ev);
  } catch (err) {
    error = err;
  }
  return { events, calls, maxTokens, messages, error };
}

describe("provider stream fixtures", () => {
  it.each(STREAM_FIXTURES)("$id — $quirk", async (fixture) => {
    const { events, calls, maxTokens, messages, error } = await play(fixture);
    const text = events
      .filter((ev) => ev.type === "text")
      .map((ev) => ev.text)
      .join("");
    const toolCalls = events.filter((ev) => ev.type === "tool_call");

    if (fixture.expect.error === "unknown_stop") {
      expect(error).toMatchObject({ message: UNKNOWN_STOP_MESSAGE, retryable: true });
      expect(isRetryableProviderError(error)).toBe(true);
    } else {
      expect(error).toBeUndefined();
    }
    if (fixture.expect.retryable != null && error) {
      expect(isRetryableProviderError(error)).toBe(fixture.expect.retryable);
    }
    if (fixture.expect.text != null) expect(text).toBe(fixture.expect.text);
    if (fixture.expect.toolCalls) {
      expect(toolCalls).toEqual(
        fixture.expect.toolCalls.map((call) => ({ type: "tool_call", ...call })),
      );
    }
    if (fixture.expect.calls != null) expect(calls).toBe(fixture.expect.calls);
    if (fixture.expect.maxTokens !== undefined) {
      expect(maxTokens ?? null).toBe(fixture.expect.maxTokens);
    }
    if (fixture.expect.activity) {
      expect(events.some((ev) => ev.type === "activity")).toBe(true);
    }
    if (fixture.expect.reasoning) {
      expect(events.filter((ev) => ev.type === "reasoning")).toEqual(
        fixture.expect.reasoning.map((text) => ({ type: "reasoning", text })),
      );
    }
    if (fixture.expect.openaiAssistantCount != null) {
      expect(messages?.filter((row) => row.role === "assistant")).toHaveLength(
        fixture.expect.openaiAssistantCount,
      );
    }
  });

  it("pins the OpenCode completion-budget constant used by fixtures", () => {
    expect(DEFAULT_OPENAI_MAX_TOKENS).toBe(32_768);
  });
});

describe("assembleToolArguments", () => {
  it("recovers truncated canvas HTML and leaves truncated source as _raw", async () => {
    const { assembleToolArguments } = await import("./types.js");
    expect(
      assembleToolArguments(
        "file_write",
        `{"path":"/workspace/index.html","content":"<!doctype html><html>Hi`,
      ),
    ).toEqual({
      path: "/workspace/index.html",
      content: "<!doctype html><html>Hi",
    });
    const js = assembleToolArguments(
      "file_write",
      `{"path":"/workspace/app.js","content":"console.log(1)`,
    );
    expect(js._raw).toContain("app.js");
  });

  it("does not invent a canvas path for pathless file_write at assemble time", async () => {
    const { assembleToolArguments } = await import("./types.js");
    expect(
      assembleToolArguments(
        "file_write",
        JSON.stringify({ content: "<!doctype html><html><body>Hi</body></html>" }),
      ),
    ).toEqual({
      content: "<!doctype html><html><body>Hi</body></html>",
    });
  });
});
