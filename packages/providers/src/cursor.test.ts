import { describe, expect, it } from "vitest";
import type { AiProvider } from "@locus/shared";
import {
  cursorCloudApiUrl,
  cursorCreateAgentBody,
  cursorCreateRunBody,
  parseCursorGit,
  parseCursorSseBlock,
  startCursorCloudRun,
  streamCursorRun,
  cancelCursorRun,
} from "./cursor.js";

const provider: AiProvider = {
  id: "cursor",
  name: "Cursor Cloud",
  kind: "cursor",
  baseUrl: "https://api.cursor.com/v1",
  apiKey: "sk-test",
  models: ["composer-2"],
  defaultModel: "composer-2",
  enabled: true,
  extraHeaders: {},
};

function sseResponse(blocks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(`${block}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

describe("cursor cloud agents client", () => {
  it("builds create-agent bodies for GitHub and plan mode", () => {
    expect(cursorCloudApiUrl("https://api.cursor.com/v1/", "agents")).toBe(
      "https://api.cursor.com/v1/agents",
    );
    expect(
      cursorCreateAgentBody({
        prompt: { text: "Add a README", images: [{ data: "aaa", mimeType: "image/png" }] },
        model: "composer-2",
        name: "Add README",
        repos: [{ url: "https://github.com/acme/app", startingRef: "main" }],
        mode: "plan",
        autoCreatePr: true,
      }),
    ).toEqual({
      prompt: {
        text: "Add a README",
        images: [{ data: "aaa", mimeType: "image/png" }],
      },
      model: { id: "composer-2" },
      name: "Add README",
      repos: [{ url: "https://github.com/acme/app", startingRef: "main" }],
      mode: "plan",
      autoCreatePR: true,
    });
    expect(cursorCreateRunBody({ prompt: { text: "also tests" } })).toEqual({
      prompt: { text: "also tests" },
    });
    expect(cursorCreateAgentBody({ prompt: { text: "hi" }, model: "cursor-grok-4.6" })).toEqual({
      prompt: { text: "hi" },
      model: { id: "cursor-grok-4.6-high" },
    });
  });

  it("parses SSE assistant, tool, and result events", () => {
    expect(parseCursorSseBlock('event: assistant\ndata: {"text":"hi"}')).toEqual({
      type: "text",
      text: "hi",
    });
    expect(
      parseCursorSseBlock(
        'event: tool_call\ndata: {"callId":"c1","name":"read_file","status":"completed","args":{"target_file":"README.md"},"result":"ok"}',
      ),
    ).toEqual({
      type: "tool_call",
      id: "c1",
      name: "read_file",
      status: "completed",
      arguments: { target_file: "README.md" },
      result: "ok",
    });
    expect(parseCursorSseBlock("event: heartbeat\ndata: {}")).toBeUndefined();
    expect(parseCursorSseBlock('event: thinking\ndata: {"text":"plan the page"}')).toEqual({
      type: "reasoning",
      text: "plan the page",
    });
    expect(
      parseCursorGit({
        branches: [
          {
            repoUrl: "github.com/acme/app",
            branch: "cursor/readme",
            prUrl: "https://github.com/acme/app/pull/3",
          },
        ],
      }),
    ).toEqual({
      branches: [
        {
          repoUrl: "github.com/acme/app",
          branch: "cursor/readme",
          prUrl: "https://github.com/acme/app/pull/3",
        },
      ],
    });
  });

  it("creates an agent then streams text and tools", async () => {
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/agents") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          prompt?: { text?: string };
          repos?: unknown;
        };
        expect(body.prompt?.text).toBe("Add a README");
        expect(body.repos).toEqual([{ url: "https://github.com/acme/app", startingRef: "main" }]);
        return Response.json({
          agent: {
            id: "bc-1",
            url: "https://cursor.com/agents/bc-1",
            latestRunId: "run-1",
          },
          run: { id: "run-1", agentId: "bc-1" },
        });
      }
      if (url.endsWith("/runs/run-1/stream")) {
        return sseResponse([
          'event: status\ndata: {"runId":"run-1","status":"RUNNING"}',
          'event: assistant\ndata: {"text":"I\'ll update the README."}',
          'event: tool_call\ndata: {"callId":"t1","name":"read_file","status":"running","args":{"target_file":"README.md"}}',
          'event: result\ndata: {"runId":"run-1","status":"FINISHED","text":"done"}',
          "event: done\ndata: {}",
        ]);
      }
      throw new Error(`unexpected ${url}`);
    };
    const handle = await startCursorCloudRun({
      provider,
      prompt: { text: "Add a README" },
      repos: [{ url: "https://github.com/acme/app", startingRef: "main" }],
      fetchFn,
    });
    expect(handle).toEqual({
      agentId: "bc-1",
      runId: "run-1",
      url: "https://cursor.com/agents/bc-1",
    });
    const events = [];
    for await (const ev of streamCursorRun(provider, handle, { fetchFn })) events.push(ev);
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "text", text: "I'll update the README." },
        expect.objectContaining({ type: "tool_call", id: "t1", name: "read_file" }),
        expect.objectContaining({ type: "result", status: "FINISHED" }),
        { type: "done" },
      ]),
    );
  });

  it("follow-ups POST /runs and cancel hits the run cancel URL", async () => {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      urls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/agents/bc-1/runs") && init?.method === "POST") {
        return Response.json({ run: { id: "run-2", agentId: "bc-1" } });
      }
      if (url.endsWith("/runs/run-2/cancel") && init?.method === "POST") {
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected ${url}`);
    };
    const handle = await startCursorCloudRun({
      provider,
      agentId: "bc-1",
      prompt: { text: "also tests" },
      fetchFn,
    });
    expect(handle.runId).toBe("run-2");
    await cancelCursorRun(provider, handle, { fetchFn });
    expect(urls).toEqual([
      "POST https://api.cursor.com/v1/agents/bc-1/runs",
      "POST https://api.cursor.com/v1/agents/bc-1/runs/run-2/cancel",
    ]);
  });
});
