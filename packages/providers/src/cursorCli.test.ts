import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AiProvider } from "@locus/shared";
import {
  buildCursorCliArgv,
  listCursorCliModels,
  parseCursorCliLine,
  parseCursorCliModelIds,
  spawnCursorCli,
  streamCursorCli,
  type CursorCliSpawner,
} from "./cursorCli.js";

const CURSOR_CLI_ANSI_MODELS = [
  "\x1b[2mAvailable models\x1b[22m",
  "\x1b[36mauto\x1b[39m \x1b[2m- Auto\x1b[22m\x1b[2m (default)\x1b[22m",
  "\x1b[36mgpt-5.3-codex-low\x1b[39m \x1b[2m- Codex 5.3 Low\x1b[22m",
  "\x1b[32mcomposer-2.5\x1b[39m \x1b[2m- Composer 2.5\x1b[22m\x1b[2m (current)\x1b[22m",
  "\x1b[36mcursor-grok-4.6-high-fast\x1b[39m \x1b[2m- Cursor Grok 4.6 Fast\x1b[22m",
  "\x1b[36mclaude-opus-5-thinking-high\x1b[39m \x1b[2m- Claude Opus 5 1M Thinking\x1b[22m",
  "\x1b[2mTip: use \x1b[36m--model <id>\x1b[39m (or \x1b[36m/model <id>\x1b[39m in interactive mode) to switch.\x1b[22m",
].join(" ");

const provider: AiProvider = {
  id: "cursor-cli",
  name: "Cursor CLI",
  kind: "cursor-cli",
  baseUrl: "cursor-cli://local",
  apiKey: "sk-cli",
  models: ["composer-2"],
  defaultModel: "composer-2",
  enabled: true,
  extraHeaders: { "X-Debug": "1" },
};

function spawner(lines: string[], code = 0, stderr = ""): CursorCliSpawner {
  return () => ({
    lines: (async function* () {
      for (const line of lines) yield line;
    })(),
    wait: async () => ({ code, stderr }),
  });
}

describe("cursor cli adapter", () => {
  it("builds print-mode argv against a local workspace", () => {
    const argv = buildCursorCliArgv({
      provider,
      prompt: "Add a README",
      workspace: "/tmp/ws",
      model: "composer-2",
      resume: "sess-1",
      mode: "plan",
      env: { PATH: "/usr/bin", CURSOR_CLI: "" },
    });
    expect(argv.command).toBe("agent");
    expect(argv.cwd).toBe("/tmp/ws");
    expect(argv.args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--force",
      "--approve-mcps",
      "--trust",
      "--sandbox",
      "disabled",
      "--workspace",
      "/tmp/ws",
      "--model",
      "composer-2",
      "--mode",
      "plan",
      "--exclude-tools",
      "web_search_tool_call,web_fetch_tool_call",
      "--resume",
      "sess-1",
      "-H",
      "X-Debug: 1",
      "--",
      "Add a README",
    ]);
    expect(argv.env.CURSOR_API_KEY).toBe("sk-cli");
    expect(argv.env.PATH).toBe("/usr/bin");
    expect(argv.args.join(" ")).not.toMatch(/--api-key/);
    expect(argv.args.join(" ")).not.toContain("sk-cli");
  });

  it("strips the AppImage mount from PATH so Shell cannot exec the GUI as locus", () => {
    const argv = buildCursorCliArgv({
      provider,
      prompt: "Add a README",
      workspace: "/tmp/ws",
      env: {
        PATH: "/tmp/.mount_Locus-C1G4Tu:/usr/bin",
        APPDIR: "/tmp/.mount_Locus-C1G4Tu",
        CURSOR_CLI: "",
      },
    });
    expect(argv.env.PATH).toBe("/usr/bin");
    expect(argv.env.PATH).not.toContain("/tmp/.mount_Locus");
  });

  it("normalizes a bare Cursor Grok 4.6 id to an effort slug", () => {
    const argv = buildCursorCliArgv({
      provider,
      prompt: "Add a README",
      workspace: "/tmp/ws",
      model: "cursor-grok-4.6",
      env: { PATH: "/usr/bin", CURSOR_CLI: "" },
    });
    expect(argv.args).toEqual(expect.arrayContaining(["--model", "cursor-grok-4.6-high"]));
    expect(argv.args).not.toContain("cursor-grok-4.6");
  });

  it("keeps a frozen --exclude-tools list when web search is later enabled", () => {
    const frozen = buildCursorCliArgv({
      provider,
      prompt: "hi",
      workspace: "/tmp/ws",
      webSearch: true,
      excludeTools: "web_search_tool_call,web_fetch_tool_call",
      env: { PATH: "/usr/bin", CURSOR_CLI: "" },
    });
    expect(frozen.args).toEqual(
      expect.arrayContaining(["--exclude-tools", "web_search_tool_call,web_fetch_tool_call"]),
    );
  });

  it("excludes Cursor webSearch unless the Locus Web toggle is on", () => {
    const off = buildCursorCliArgv({
      provider,
      prompt: "Who is kp.com.au?",
      workspace: "/tmp/ws",
      env: { PATH: "/usr/bin", CURSOR_CLI: "" },
    });
    expect(off.args).toEqual(
      expect.arrayContaining(["--exclude-tools", "web_search_tool_call,web_fetch_tool_call"]),
    );
    const on = buildCursorCliArgv({
      provider,
      prompt: "Who is kp.com.au?",
      workspace: "/tmp/ws",
      webSearch: true,
      env: { PATH: "/usr/bin", CURSOR_CLI: "" },
    });
    expect(on.args).not.toContain("--exclude-tools");
    expect(on.args.join(" ")).not.toMatch(/web_search_tool_call/);
  });

  it("strips write and shell tools on review sessions", () => {
    const review = buildCursorCliArgv({
      provider,
      prompt: "review this",
      workspace: "/tmp/ws",
      review: true,
      env: { PATH: "/usr/bin", CURSOR_CLI: "" },
    });
    const exclude = review.args[review.args.indexOf("--exclude-tools") + 1] ?? "";
    expect(exclude).toMatch(/write_tool_call/);
    expect(exclude).toMatch(/shell_tool_call/);
    expect(exclude).toMatch(/web_search_tool_call/);
    const webOn = buildCursorCliArgv({
      provider,
      prompt: "review this",
      workspace: "/tmp/ws",
      review: true,
      webSearch: true,
      env: { PATH: "/usr/bin", CURSOR_CLI: "" },
    });
    expect(webOn.args).toEqual(expect.arrayContaining(["--exclude-tools"]));
    expect(webOn.args.join(" ")).not.toMatch(/web_search_tool_call/);
    expect(webOn.args.join(" ")).toMatch(/write_tool_call/);
  });

  it("parses stream-json assistant, tool, and session events", () => {
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "c6b62c6f-7ead-4fd6-9922-e952131177ff",
        }),
      ),
    ).toEqual({ type: "session", sessionId: "c6b62c6f-7ead-4fd6-9922-e952131177ff" });
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "thinking",
          text: "plan the hero",
        }),
      ),
    ).toEqual({ type: "reasoning", text: "plan the hero" });
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: { role: "assistant", content: [{ type: "text", text: "I'll read it" }] },
        }),
      ),
    ).toEqual({ type: "text", text: "I'll read it" });
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 2,
          model_call_id: "dup",
          message: { content: [{ type: "text", text: "I'll read it" }] },
        }),
      ),
    ).toBeUndefined();
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "started",
          call_id: "c1",
          tool_call: { readToolCall: { args: { path: "README.md" } } },
        }),
      ),
    ).toEqual({
      type: "tool_call",
      id: "c1",
      name: "file_read",
      status: "running",
      arguments: { path: "README.md" },
    });
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "c2",
          tool_call: {
            webSearchToolCall: {
              args: { searchTerm: "kp.com.au" },
              result: { success: { references: [] } },
            },
          },
        }),
      ),
    ).toMatchObject({
      type: "tool_call",
      id: "c2",
      name: "websearch",
      status: "completed",
      arguments: { searchTerm: "kp.com.au" },
    });
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "c1",
          tool_call: {
            writeToolCall: {
              args: { path: "README.md", fileText: "# app" },
              result: { success: { path: "/tmp/ws/README.md", linesCreated: 1 } },
            },
          },
        }),
      ),
    ).toMatchObject({
      type: "tool_call",
      id: "c1",
      name: "file_write",
      status: "completed",
      arguments: {
        path: "README.md",
        fileText: "# app",
        patch: "*** Add File: README.md\n+# app",
      },
    });
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "edit",
          tool_call: {
            editToolCall: {
              args: {
                path: "src/app.ts",
                applyPatch: { patchContent: "@@ -1 +1 @@\n-old\n+new\n" },
              },
              result: { success: {} },
            },
          },
        }),
      ),
    ).toMatchObject({
      type: "tool_call",
      id: "edit",
      name: "apply_patch",
      arguments: {
        path: "src/app.ts",
        patch: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
      },
    });
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "started",
          call_id: "sr",
          tool_call: {
            searchReplaceToolCall: {
              args: { path: "src/app.ts", old_string: "old", new_string: "new" },
            },
          },
        }),
      ),
    ).toMatchObject({
      type: "tool_call",
      id: "sr",
      name: "apply_patch",
      arguments: {
        path: "src/app.ts",
        patch: "*** Update File: src/app.ts\n@@\n-old\n+new",
      },
    });
    const failedPatch = parseCursorCliLine(
      JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        call_id: "sr-fail",
        tool_call: {
          searchReplaceToolCall: {
            args: { path: "src/app.ts", old_string: "old", new_string: "new" },
            result: { error: "failed to apply patch" },
          },
        },
      }),
    );
    expect(failedPatch).toMatchObject({
      type: "tool_call",
      id: "sr-fail",
      name: "apply_patch",
      status: "completed",
    });
    expect(failedPatch && "result" in failedPatch ? failedPatch.result : undefined).toMatch(
      /failed to apply patch/,
    );
    expect(failedPatch && "result" in failedPatch ? failedPatch.result : undefined).toMatch(
      /"error"/,
    );
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "plan",
          tool_call: {
            createPlanToolCall: {
              args: {
                name: "Ubuntu 26.04 ISO",
                todos: [{ content: "Rewrite scripts/build-iso.sh" }],
              },
              result: { success: {} },
            },
          },
        }),
      ),
    ).toMatchObject({
      type: "tool_call",
      id: "plan",
      name: "createPlan",
      status: "completed",
      arguments: { name: "Ubuntu 26.04 ISO" },
    });
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "ask",
          tool_call: {
            askQuestionToolCall: {
              args: { title: "Ubuntu scope", questions: [{ prompt: "ISO only?" }] },
              result: { success: { rejected: { reason: "Questions skipped by the user" } } },
            },
          },
        }),
      ),
    ).toMatchObject({
      type: "tool_call",
      id: "ask",
      name: "askQuestion",
      status: "completed",
      arguments: { title: "Ubuntu scope" },
    });
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Done",
          session_id: "sess-1",
          duration_ms: 12,
        }),
      ),
    ).toMatchObject({ type: "result", status: "FINISHED", text: "Done", durationMs: 12 });
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "Done",
          usage: {
            inputTokens: 20_000,
            outputTokens: 80,
            cacheReadTokens: 10_624,
            cacheWriteTokens: 2_000,
            contextWindow: 200_000,
          },
        }),
      ),
    ).toEqual({
      type: "result",
      status: "FINISHED",
      text: "Done",
      durationMs: undefined,
      usage: {
        inputTokens: 20_000,
        outputTokens: 80,
        cachedInputTokens: 10_624,
        cacheWriteTokens: 2_000,
        window: 200_000,
      },
    });
    expect(
      parseCursorCliLine(
        JSON.stringify({
          type: "usage",
          usage: { inputTokens: 12_400, outputTokens: 40, cacheReadTokens: 2_000 },
        }),
      ),
    ).toEqual({
      type: "usage",
      inputTokens: 12_400,
      outputTokens: 40,
      cachedInputTokens: 2_000,
    });
  });

  it("streams a mocked CLI run and lists models from JSON", async () => {
    const events = [];
    for await (const ev of streamCursorCli({
      provider,
      prompt: "Add a README",
      workspace: "/tmp/ws",
      spawnFn: spawner([
        JSON.stringify({ type: "system", subtype: "init", session_id: "sess-9" }),
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: { content: [{ type: "text", text: "Updated README.md." }] },
        }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "t1",
          tool_call: {
            readToolCall: { args: { path: "README.md" }, result: { success: "# app" } },
          },
        }),
        JSON.stringify({ type: "result", subtype: "success", result: "Updated README.md." }),
      ]),
    })) {
      events.push(ev);
    }
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "session", sessionId: "sess-9" },
        { type: "text", text: "Updated README.md." },
        expect.objectContaining({ type: "tool_call", name: "file_read", id: "t1" }),
        { type: "done" },
      ]),
    );
    expect(parseCursorCliModelIds('{"models":[{"id":"composer-2"},{"id":"auto"}]}')).toEqual([
      "auto",
      "composer-2",
    ]);
    expect(parseCursorCliModelIds("composer-2\ngpt-5\n")).toEqual(["composer-2", "gpt-5"]);
    expect(
      parseCursorCliModelIds(
        "Available models\nauto - Auto (default)\ncomposer-2.5 - Composer 2.5 (current)\n",
      ),
    ).toEqual(["auto", "composer-2.5"]);
    expect(parseCursorCliModelIds(CURSOR_CLI_ANSI_MODELS)).toEqual([
      "auto",
      "claude-opus-5-thinking-high",
      "composer-2.5",
      "cursor-grok-4.6-high-fast",
      "gpt-5.3-codex-low",
    ]);
    expect(
      parseCursorCliModelIds(
        "claude-fable-5-thinking-high - Claude Fable 5 1M Thinking (NO ZDR) kimi-k3-max - Kimi K3 Tip: use --model <id>",
      ),
    ).toEqual(["claude-fable-5-thinking-high", "kimi-k3-max"]);
    expect(
      await listCursorCliModels(provider, (req) => {
        expect(req.args.slice(0, 3)).toEqual(["models", "--format", "json"]);
        expect(req.env.NO_COLOR).toBe("1");
        return spawner(['{"items":[{"id":"composer-2"},{"id":"gpt-5"}]}'])(req);
      }),
    ).toEqual(["composer-2", "gpt-5"]);
    expect(await listCursorCliModels(provider, spawner([CURSOR_CLI_ANSI_MODELS]))).toEqual([
      "auto",
      "claude-opus-5-thinking-high",
      "composer-2.5",
      "cursor-grok-4.6-high-fast",
      "gpt-5.3-codex-low",
    ]);
  });

  it("falls back to --list-models text when JSON listing fails", async () => {
    expect(
      await listCursorCliModels(provider, (req) => {
        if (req.args.includes("--format")) {
          return spawner(["unknown option --format"], 1, "unknown option --format")(req);
        }
        expect(req.args[0]).toBe("--list-models");
        return spawner([CURSOR_CLI_ANSI_MODELS])(req);
      }),
    ).toEqual([
      "auto",
      "claude-opus-5-thinking-high",
      "composer-2.5",
      "cursor-grok-4.6-high-fast",
      "gpt-5.3-codex-low",
    ]);
  });

  it("does not dump the full CLI model blob when listing fails", async () => {
    const blob = `(failed) ${"please log in to cursor ".repeat(40)}`;
    try {
      await listCursorCliModels(provider, spawner([blob]));
      expect.unreachable("listing should fail");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message).toMatch(/^Cursor CLI did not list models:/);
      expect(message.endsWith("…")).toBe(true);
      expect(message.length).toBeLessThan(400);
    }
  });

  it("ends the stream on the terminal result even if stdout stays open", async () => {
    const events = [];
    for await (const ev of streamCursorCli({
      provider,
      prompt: "hi",
      workspace: "/tmp/ws",
      spawnFn: () => ({
        lines: (async function* () {
          yield JSON.stringify({ type: "system", subtype: "init", session_id: "sess-hang" });
          yield JSON.stringify({
            type: "assistant",
            timestamp_ms: 1,
            message: { content: [{ type: "text", text: "hi" }] },
          });
          yield JSON.stringify({ type: "result", subtype: "success", result: "hi" });
          await new Promise(() => {});
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      }),
    })) {
      events.push(ev);
    }
    expect(events).toEqual([
      { type: "session", sessionId: "sess-hang" },
      { type: "text", text: "hi" },
      expect.objectContaining({ type: "result", status: "FINISHED" }),
      { type: "done" },
    ]);
  }, 2000);

  it("keeps the CLI session id from the terminal result when init is missing", async () => {
    const events = [];
    for await (const ev of streamCursorCli({
      provider,
      prompt: "hi",
      workspace: "/tmp/ws",
      spawnFn: spawner([
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: { content: [{ type: "text", text: "ok" }] },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "ok",
          session_id: "sess-from-result",
        }),
      ]),
    })) {
      events.push(ev);
    }
    expect(events).toEqual([
      { type: "text", text: "ok" },
      { type: "session", sessionId: "sess-from-result" },
      expect.objectContaining({ type: "result", status: "FINISHED" }),
      { type: "done" },
    ]);
  });

  it("uses an explicit binary path from the provider base URL", () => {
    expect(
      buildCursorCliArgv({
        provider: { ...provider, baseUrl: "/opt/cursor/agent" },
        prompt: "hi",
        workspace: "/tmp/ws",
        env: {},
      }).command,
    ).toBe("/opt/cursor/agent");
  });

  it.skipIf(process.platform === "win32")(
    "does not emit unhandledRejection before wait() when the CLI is missing",
    async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const handle = spawnCursorCli({
          command: "locus-missing-cursor-agent",
          args: ["models"],
          cwd: process.cwd(),
          env: process.env,
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(unhandled).toEqual([]);
        await expect(handle.wait()).rejects.toThrow(/not on PATH/);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    },
  );

  it("still spawns a real process after Windows hide/verbatim options", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-spawn-"));
    const script = join(dir, "agent.mjs");
    await writeFile(script, `console.log(JSON.stringify({ items: [{ id: "composer-2" }] }));`);
    try {
      const handle = spawnCursorCli({
        command: process.execPath,
        args: [script],
        cwd: dir,
        env: process.env,
      });
      const lines: string[] = [];
      for await (const line of handle.lines) lines.push(line);
      expect(await handle.wait()).toMatchObject({ code: 0 });
      expect(lines.join("\n")).toContain("composer-2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses a Windows .cmd path from the provider base URL", () => {
    expect(
      buildCursorCliArgv({
        provider: {
          ...provider,
          baseUrl: "C:\\Users\\locus\\AppData\\Local\\cursor-agent\\cursor-agent.cmd",
        },
        prompt: "hi",
        workspace: "/tmp/ws",
        env: {},
      }).command,
    ).toBe("C:\\Users\\locus\\AppData\\Local\\cursor-agent\\cursor-agent.cmd");
  });

  it("rewrites Windows spawn EINVAL into a Cursor CLI hint", async () => {
    await expect(
      listCursorCliModels(provider, () => {
        throw Object.assign(new Error("spawn EINVAL"), { code: "EINVAL" });
      }),
    ).rejects.toThrow(/spawn EINVAL/);
  });
});
