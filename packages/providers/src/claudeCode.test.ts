import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AiProvider } from "@locus/shared";
import {
  buildClaudeCodeArgv,
  checkClaudeCode,
  CLAUDE_CODE_MCP_CONFIG,
  claudeCodeDisallowedTools,
  parseClaudeCodeEvents,
  streamClaudeCode,
  type ClaudeCodeSpawner,
} from "./claudeCode.js";

const provider: AiProvider = {
  id: "claude-code",
  name: "Claude Code",
  kind: "claude-code",
  baseUrl: "claude-code://local",
  apiKey: "",
  models: ["claude-sonnet-4-5"],
  defaultModel: "claude-sonnet-4-5",
  enabled: true,
  extraHeaders: {},
};

function spawner(lines: string[], code = 0, stderr = ""): ClaudeCodeSpawner {
  return (req) => ({
    lines: (async function* () {
      void req;
      for (const line of lines) yield line;
    })(),
    wait: async () => ({ code, stderr }),
  });
}

describe("claude code adapter", () => {
  it("builds print-mode argv against a local workspace", () => {
    const argv = buildClaudeCodeArgv({
      provider,
      prompt: "fix the tests",
      workspace: "/tmp/app",
      model: "claude-sonnet-4-5",
      mode: "plan",
    });
    expect(argv.command).toBe("claude");
    expect(argv.cwd).toBe("/tmp/app");
    expect(argv.args).toEqual(
      expect.arrayContaining([
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--dangerously-skip-permissions",
        "--mcp-config",
        CLAUDE_CODE_MCP_CONFIG,
        "--model",
        "claude-sonnet-4-5",
        "--permission-mode",
        "plan",
        "--disallowedTools",
        "WebSearch,WebFetch",
        "fix the tests",
      ]),
    );
  });

  it("resumes and allows web tools when search is on", () => {
    const argv = buildClaudeCodeArgv({
      provider,
      prompt: "continue",
      workspace: "/tmp/app",
      resume: "sess-9",
      webSearch: true,
    });
    expect(argv.args).toContain("--resume");
    expect(argv.args).toContain("sess-9");
    expect(argv.args).not.toContain("--disallowedTools");
    expect(claudeCodeDisallowedTools({ webSearch: false, review: true })).toMatch(/WebSearch/);
    expect(claudeCodeDisallowedTools({ webSearch: false, review: true })).toMatch(/Bash/);
  });

  it("maps stream-json assistant, tools, and usage", () => {
    expect(
      parseClaudeCodeEvents(
        JSON.stringify({ type: "system", subtype: "init", session_id: "cc-1" }),
      ),
    ).toEqual([{ type: "session", sessionId: "cc-1" }]);
    expect(
      parseClaudeCodeEvents(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Reading app.ts" },
              { type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/app.ts" } },
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
        arguments: { file_path: "src/app.ts", path: "src/app.ts" },
      },
    ]);
    expect(
      parseClaudeCodeEvents(
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
      parseClaudeCodeEvents(
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
      parseClaudeCodeEvents(
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
        }),
      ),
    ).toEqual([{ type: "text", text: "Hi" }]);
    expect(
      parseClaudeCodeEvents(
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "thinking_delta", thinking: "hmm" },
          },
        }),
      ),
    ).toEqual([{ type: "reasoning", text: "hmm" }]);
  });

  it("streams mapped events from a fake CLI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-claude-code-"));
    const events: string[] = [];
    for await (const ev of streamClaudeCode({
      provider,
      prompt: "hi",
      workspace: dir,
      spawnFn: spawner([
        JSON.stringify({ type: "system", subtype: "init", session_id: "cc-9" }),
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

  it("keeps the running tool name on completed tool_result events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-claude-code-"));
    const names: string[] = [];
    for await (const ev of streamClaudeCode({
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

  it("streams partial tokens and skips the duplicate assistant payload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-claude-code-partial-"));
    const texts: string[] = [];
    for await (const ev of streamClaudeCode({
      provider,
      prompt: "hi",
      workspace: dir,
      spawnFn: spawner([
        JSON.stringify({
          type: "stream_event",
          event: { delta: { type: "text_delta", text: "Hel" } },
        }),
        JSON.stringify({
          type: "stream_event",
          event: { delta: { type: "text_delta", text: "lo" } },
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }] },
        }),
        JSON.stringify({ type: "result", subtype: "success", result: "Hello" }),
      ]),
    })) {
      if (ev.type === "text") texts.push(ev.text);
    }
    expect(texts).toEqual(["Hel", "lo"]);
  });

  it("checks the installed CLI and claude.ai login without exposing probe output", async () => {
    const calls: string[][] = [];
    const health = await checkClaudeCode(provider, (req) => {
      calls.push(req.args);
      const isVersion = req.args.includes("--version");
      return {
        lines: (async function* () {
          yield isVersion
            ? "2.1.286 (Claude Code)"
            : JSON.stringify({
                loggedIn: true,
                authMethod: "claude.ai",
                email: "account@example.com",
              });
        })(),
        wait: async () => ({ code: 0, stderr: "account@example.com" }),
      };
    });
    expect(health).toEqual({
      ok: true,
      command: "claude",
      version: "2.1.286",
      authenticated: true,
      authMode: "claude.ai",
    });
    expect(calls).toEqual([["--version"], ["auth", "status"]]);
    expect(JSON.stringify(health)).not.toContain("account@example.com");
  });

  it("does not pass provider API keys to health-check executables", async () => {
    const observed: Array<NodeJS.ProcessEnv> = [];
    const health = await checkClaudeCode({ ...provider, apiKey: "sk-secret" }, (req) => {
      observed.push(req.env);
      return {
        lines: (async function* () {
          if (req.args.includes("--version")) yield "2.1.286 (Claude Code)";
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      };
    });
    expect(observed.every((env) => env.ANTHROPIC_API_KEY === undefined)).toBe(true);
    expect(observed.every((env) => env.CLAUDE_API_KEY === undefined)).toBe(true);
    expect(health).toMatchObject({ ok: true, authenticated: false, authMode: "api-key" });
  });

  it("reports missing Claude Code authentication", async () => {
    const health = await checkClaudeCode(provider, (req) => ({
      lines: (async function* () {
        if (req.args.includes("--version")) yield "2.1.286 (Claude Code)";
        else yield JSON.stringify({ loggedIn: false, authMethod: "none" });
      })(),
      wait: async () => ({ code: req.args.includes("--version") ? 0 : 1, stderr: "" }),
    }));
    expect(health).toEqual({
      ok: false,
      command: "claude",
      version: "2.1.286",
      authenticated: false,
      authMode: "missing",
      message: "Claude Code is not authenticated. Run `claude auth login` or paste an API key.",
    });
  });
});
