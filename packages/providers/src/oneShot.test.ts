import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AiProvider } from "@locus/shared";
import { collectText } from "./router.js";
import { completeOneShot, oneShotCliPrompt, type OneShotCliStream } from "./oneShot.js";

const codex = {
  id: "codex",
  name: "Codex CLI",
  kind: "codex-cli",
  baseUrl: "codex-cli://local",
  apiKey: "",
  models: ["gpt-5.6-sol"],
  defaultModel: "gpt-5.6-sol",
  enabled: true,
  extraHeaders: {},
} as AiProvider;

const openai = {
  id: "p1",
  name: "OpenAI",
  kind: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  models: ["gpt-4.1"],
  defaultModel: "gpt-4.1",
  enabled: true,
  extraHeaders: {},
} as AiProvider;

const message = (content: string) => ({
  id: "m",
  role: "user" as const,
  content,
  createdAt: new Date(0).toISOString(),
});

describe("completeOneShot", () => {
  it("runs a CLI agent read-only in a scratch directory and returns its text", async () => {
    const calls: Parameters<OneShotCliStream>[0][] = [];
    const cliStream: OneShotCliStream = async function* (input) {
      calls.push(input);
      expect(existsSync(input.workspace)).toBe(true);
      yield { type: "session", text: undefined };
      yield { type: "text", text: '{"name":' };
      yield { type: "text", text: '"Vista"}' };
    };
    const text = await collectText(
      completeOneShot(
        { provider: codex, model: "gpt-5.6-sol", system: "SYS", messages: [message("vista")] },
        { cliStream },
      ),
    );
    expect(text).toBe('{"name":"Vista"}');
    expect(calls[0]).toMatchObject({ mode: "plan", model: "gpt-5.6-sol" });
    expect(calls[0]!.prompt).toContain("SYS");
    expect(calls[0]!.prompt).toContain("vista");
    expect(existsSync(calls[0]!.workspace)).toBe(false);
  });

  it("reports a CLI agent's reasoning and tool calls to onTrace, yielding only the reply", async () => {
    const cliStream: OneShotCliStream = async function* () {
      yield { type: "reasoning", text: "check b.ts" };
      yield {
        type: "tool_call",
        id: "t1",
        name: "file_read",
        status: "running",
        arguments: { path: "b.ts" },
      };
      yield { type: "tool_call", id: "t1", name: "file_read", status: "completed", result: "ok" };
      yield { type: "text", text: "done" };
    };
    const trace: unknown[] = [];
    const events: unknown[] = [];
    for await (const ev of completeOneShot(
      { provider: codex, model: "gpt-5.6-sol", system: "SYS", messages: [message("hi")] },
      { cliStream, onTrace: (ev) => trace.push(ev) },
    )) {
      events.push(ev);
    }
    expect(events).toEqual([
      { type: "text", text: "done" },
      expect.objectContaining({ type: "usage", estimated: true }),
    ]);
    expect(trace).toEqual([
      { type: "reasoning", text: "check b.ts" },
      { type: "tool_call", id: "t1", name: "file_read", arguments: { path: "b.ts" } },
      { type: "tool_result", id: "t1", name: "file_read", output: "ok" },
    ]);
  });

  it("passes through the latest usage the CLI reports, else the result's usage", async () => {
    const run = async (events: Array<Record<string, unknown>>) => {
      const cliStream: OneShotCliStream = async function* () {
        yield { type: "text", text: "ok" };
        for (const ev of events) yield ev as { type: string };
      };
      const out = [];
      for await (const ev of completeOneShot(
        { provider: codex, model: "", system: "", messages: [message("x")] },
        { cliStream },
      ))
        out.push(ev);
      return out.filter((ev) => ev.type === "usage");
    };
    expect(
      await run([
        { type: "usage", inputTokens: 100, outputTokens: 5 },
        { type: "usage", inputTokens: 120, outputTokens: 9, cachedInputTokens: 80 },
        { type: "result", usage: { input_tokens: 1, output_tokens: 1 } },
      ]),
    ).toEqual([{ type: "usage", inputTokens: 120, outputTokens: 9, cachedInputTokens: 80 }]);
    expect(
      await run([{ type: "result", usage: { input_tokens: 300, output_tokens: 20 } }]),
    ).toEqual([{ type: "usage", inputTokens: 300, outputTokens: 20 }]);
    // No token counts (Kiro meters in credits): estimate from the prompt and reply.
    const [estimated] = await run([]);
    expect(estimated).toMatchObject({ type: "usage", outputTokens: 1, estimated: true });
    expect((estimated as { inputTokens: number }).inputTokens).toBeGreaterThan(0);
    // A zero report counts as none.
    expect(await run([{ type: "result", usage: { input_tokens: 0, output_tokens: 0 } }])).toEqual([
      expect.objectContaining({ estimated: true }),
    ]);
  });

  it("estimates nothing when the CLI produced no reply", async () => {
    const cliStream: OneShotCliStream = async function* () {
      yield { type: "result" };
    };
    const out = [];
    for await (const ev of completeOneShot(
      { provider: codex, model: "", system: "", messages: [message("x")] },
      { cliStream },
    ))
      out.push(ev);
    expect(out.filter((ev) => ev.type === "usage")).toEqual([]);
  });

  it("refuses a prompt longer than the command line allows, before spawning", async () => {
    let spawned = false;
    const cliStream: OneShotCliStream = async function* () {
      spawned = true;
      yield { type: "text", text: "never" };
    };
    await expect(
      collectText(
        completeOneShot(
          { provider: codex, model: "", system: "", messages: [message("x".repeat(500))] },
          { cliStream, promptLimit: 200 },
        ),
      ),
    ).rejects.toThrow(/command line, which allows 200/);
    expect(spawned).toBe(false);
  });

  it("raises the CLI's error when it produced no text", async () => {
    const cliStream: OneShotCliStream = async function* () {
      yield { type: "error", message: "not signed in" };
    };
    await expect(
      collectText(
        completeOneShot(
          { provider: codex, model: "", system: "", messages: [message("x")] },
          { cliStream },
        ),
      ),
    ).rejects.toThrow(/not signed in/);
  });

  it("passes a scrubbed env to the CLI only with isolateEnv", async () => {
    const envs: Array<NodeJS.ProcessEnv | undefined> = [];
    const cliStream: OneShotCliStream = async function* (input) {
      envs.push(input.env);
      yield { type: "text", text: "ok" };
    };
    const req = { provider: codex, model: "", system: "", messages: [message("x")] };
    const saved = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, PATH: process.env.PATH };
    process.env.GITHUB_TOKEN = "ghp_secret";
    try {
      await collectText(completeOneShot(req, { cliStream }));
      await collectText(completeOneShot(req, { cliStream, isolateEnv: true }));
    } finally {
      if (saved.GITHUB_TOKEN === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = saved.GITHUB_TOKEN;
    }
    expect(envs[0]).toBeUndefined();
    expect(envs[1]).toBeDefined();
    expect(envs[1]!.GITHUB_TOKEN).toBeUndefined();
    expect(envs[1]!.PATH).toBe(saved.PATH);
  });

  it("asks spawnFor for the spawner with the folder the CLI runs in", async () => {
    const seen: Array<{ workspace: string; spawnFn: unknown }> = [];
    const cliStream: OneShotCliStream = async function* (input) {
      seen.push({ workspace: input.workspace, spawnFn: input.spawnFn });
      yield { type: "text", text: "ok" };
    };
    const spawner = (() => {
      throw new Error("not spawned in this test");
    }) as never;
    const asked: string[] = [];
    const req = { provider: codex, model: "", system: "", messages: [message("x")] };
    await collectText(
      completeOneShot(req, {
        cliStream,
        spawnFor: (workspace) => {
          asked.push(workspace);
          return spawner;
        },
      }),
    );
    expect(seen[0]!.spawnFn).toBe(spawner);
    expect(asked).toEqual([seen[0]!.workspace]);
    // The scratch folder is still removed afterwards.
    expect(existsSync(asked[0]!)).toBe(false);

    await collectText(
      completeOneShot(req, { cliStream, workspace: "/clone", spawnFor: () => undefined }),
    );
    expect(seen[1]).toEqual({ workspace: "/clone", spawnFn: undefined });
  });

  it("never starts the CLI when spawnFor throws, and still removes the scratch folder", async () => {
    let started = false;
    const cliStream: OneShotCliStream = async function* () {
      started = true;
      yield { type: "text", text: "ok" };
    };
    let scratch = "";
    const req = { provider: codex, model: "", system: "", messages: [message("x")] };
    await expect(
      collectText(
        completeOneShot(req, {
          cliStream,
          spawnFor: (workspace) => {
            scratch = workspace;
            throw new Error("no sandbox: install bubblewrap");
          },
        }),
      ),
    ).rejects.toThrow("no sandbox: install bubblewrap");
    expect(started).toBe(false);
    expect(existsSync(scratch)).toBe(false);
  });

  it("reports running CLI usage snapshots through onUsage without changing the output", async () => {
    const cliStream: OneShotCliStream = async function* () {
      yield { type: "text", text: "ok" };
      yield { type: "usage", inputTokens: 100, outputTokens: 5 };
      yield { type: "usage", inputTokens: 0, outputTokens: 9, cachedInputTokens: 80 };
      yield { type: "result", usage: { input_tokens: 1, output_tokens: 1 } };
    };
    const seen: unknown[] = [];
    const out = [];
    for await (const ev of completeOneShot(
      { provider: codex, model: "", system: "", messages: [message("x")] },
      { cliStream, onUsage: (u) => seen.push(u) },
    ))
      out.push(ev);
    expect(seen).toEqual([
      { inputTokens: 100, outputTokens: 5 },
      { inputTokens: 100, outputTokens: 9, cachedInputTokens: 80 },
      { inputTokens: 100, outputTokens: 9, cachedInputTokens: 80 },
    ]);
    expect(out).toEqual([
      { type: "text", text: "ok" },
      { type: "usage", inputTokens: 100, outputTokens: 9, cachedInputTokens: 80 },
    ]);
  });

  it("reports a result-only CLI usage through onUsage", async () => {
    const cliStream: OneShotCliStream = async function* () {
      yield { type: "text", text: "ok" };
      yield { type: "result", usage: { input_tokens: 300, output_tokens: 20 } };
    };
    const seen: unknown[] = [];
    await collectText(
      completeOneShot(
        { provider: codex, model: "", system: "", messages: [message("x")] },
        { cliStream, onUsage: (u) => seen.push(u) },
      ),
    );
    expect(seen).toEqual([{ inputTokens: 300, outputTokens: 20 }]);
  });

  it("reports API usage through onUsage", async () => {
    const encoder = new TextEncoder();
    const fetchFn: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const line of [
              'data: {"choices":[{"delta":{"content":"hi"}}]}',
              'data: {"choices":[],"usage":{"prompt_tokens":40,"completion_tokens":7}}',
              "data: [DONE]",
            ])
              controller.enqueue(encoder.encode(`${line}\n`));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    const seen: unknown[] = [];
    const out = [];
    for await (const ev of completeOneShot(
      { provider: openai, model: "gpt-4.1", system: "", messages: [message("x")] },
      { fetchFn, onUsage: (u) => seen.push(u) },
    ))
      out.push(ev);
    expect(seen).toEqual([{ inputTokens: 40, outputTokens: 7 }]);
    expect(out.filter((ev) => ev.type === "usage")).toHaveLength(1);
  });

  it("folds the system prompt and turns into one CLI prompt", () => {
    expect(oneShotCliPrompt({ system: "S", messages: [message("a"), message("b")] })).toMatch(
      /^S\n\n.*Do not use tools.*\n\na\n\nb$/s,
    );
  });
});
