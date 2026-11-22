import { describe, expect, it } from "vitest";
import { CLI_AGENT_PRESETS, type AiProvider, type CliAgentConfig } from "@locus/shared";
import type { CursorCliSpawnHandle, CursorCliSpawnRequest } from "./cursorCli.js";
import {
  AcpConnection,
  GENERIC_CLI_CONTINUE,
  buildGenericCliArgv,
  checkGenericCli,
  expandCliArgs,
  parseAcpSessionUpdate,
  parseGenericJsonlLine,
  pickAcpPermission,
  streamGenericCli,
  type GenericCliEvent,
} from "./genericCli.js";

function provider(cli: Partial<CliAgentConfig>, extra: Partial<AiProvider> = {}): AiProvider {
  return {
    id: "cli-agent:Test",
    name: "Test agent",
    kind: "cli-agent",
    baseUrl: "cli-agent://local",
    models: [],
    defaultModel: "",
    enabled: true,
    extraHeaders: {},
    cli: { command: "agent-x", args: ["{prompt}"], output: "text", ...cli },
    ...extra,
  };
}

function linesHandle(
  lines: string[],
  opts: { code?: number; stderr?: string; stdin?: string[] } = {},
): CursorCliSpawnHandle {
  return {
    lines: (async function* () {
      for (const line of lines) yield line;
    })(),
    wait: async () => ({ code: opts.code ?? 0, stderr: opts.stderr ?? "" }),
    kill: () => undefined,
    ...(opts.stdin
      ? {
          write: (data: string) => {
            opts.stdin!.push(data);
          },
          endInput: () => undefined,
        }
      : {}),
  };
}

async function collect(gen: AsyncGenerator<GenericCliEvent>): Promise<GenericCliEvent[]> {
  const out: GenericCliEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

function texts(events: GenericCliEvent[]): string {
  return events
    .filter((ev): ev is Extract<GenericCliEvent, { type: "text" }> => ev.type === "text")
    .map((ev) => ev.text)
    .join("");
}

describe("expandCliArgs", () => {
  it("fills placeholders inside and across args", () => {
    expect(
      expandCliArgs(["-p", "{prompt}", "--model={model}", "--cwd", "{workspace}"], {
        prompt: "fix it",
        model: "m1",
        workspace: "/w",
      }),
    ).toEqual(["-p", "fix it", "--model=m1", "--cwd", "/w"]);
  });

  it("drops a missing model and the bare flag that carried it", () => {
    expect(
      expandCliArgs(["-p", "{prompt}", "-m", "{model}", "--yolo"], { prompt: "hi", model: "" }),
    ).toEqual(["-p", "hi", "--yolo"]);
    expect(expandCliArgs(["--model={model}", "run"], { prompt: "x" })).toEqual(["run"]);
  });

  it("keeps an empty prompt and drops a missing resume id", () => {
    expect(expandCliArgs(["{prompt}", "--resume", "{resume}"], { prompt: "" })).toEqual([""]);
    expect(expandCliArgs(["--resume", "{resume}"], { resume: "abc" })).toEqual(["--resume", "abc"]);
  });

  it("does not treat a prompt that looks like a placeholder as one", () => {
    expect(expandCliArgs(["{prompt}"], { prompt: "use {model} here" })).toEqual([
      "use {model} here",
    ]);
  });
});

describe("buildGenericCliArgv", () => {
  it("puts the prompt on stdin when args have no {prompt}", () => {
    const argv = buildGenericCliArgv({
      provider: provider({ args: ["--headless"] }),
      prompt: "hello",
      workspace: "/w",
    });
    expect(argv.args).toEqual(["--headless"]);
    expect(argv.stdin).toBe("hello");
    expect(argv.cwd).toBe("/w");
  });

  it("appends resumeArgs only when resuming, and maps the API key env", () => {
    const p = provider(
      {
        args: ["run", "{prompt}"],
        resumeArgs: ["--session", "{resume}"],
        apiKeyEnv: "AGENT_KEY",
        env: { AGENT_MODE: "ci" },
      },
      { apiKey: "sk-test-123" },
    );
    const fresh = buildGenericCliArgv({ provider: p, prompt: "x", workspace: "/w", env: {} });
    expect(fresh.args).toEqual(["run", "x"]);
    expect(fresh.stdin).toBeUndefined();
    expect(fresh.env.AGENT_KEY).toBe("sk-test-123");
    expect(fresh.env.AGENT_MODE).toBe("ci");
    const resumed = buildGenericCliArgv({
      provider: p,
      prompt: "x",
      workspace: "/w",
      resume: "s-9",
      env: {},
    });
    expect(resumed.args).toEqual(["run", "x", "--session", "s-9"]);
  });

  it("treats the `default` model as the CLI's own default", () => {
    const argv = buildGenericCliArgv({
      provider: provider({ args: ["--model", "{model}", "--message", "{prompt}"] }),
      prompt: "x",
      workspace: "/w",
      model: "default",
    });
    expect(argv.args).toEqual(["--message", "x"]);
  });

  it("never sets stdin for ACP and rejects a provider without a command", () => {
    const argv = buildGenericCliArgv({
      provider: provider({ args: ["--acp"], output: "acp" }),
      prompt: "x",
      workspace: "/w",
    });
    expect(argv.stdin).toBeUndefined();
    expect(() =>
      buildGenericCliArgv({ provider: provider({ command: " " }), prompt: "x", workspace: "/w" }),
    ).toThrow(/has no command/);
  });

  it("expands every preset template without leftover placeholders", () => {
    for (const preset of CLI_AGENT_PRESETS) {
      if (!preset.cli.command) continue;
      const argv = buildGenericCliArgv({
        provider: provider(preset.cli),
        prompt: "do it",
        workspace: "/w",
        model: "m",
        resume: "r",
      });
      expect(argv.args.join(" ")).not.toMatch(/\{(prompt|model|workspace|resume)\}/);
    }
  });
});

describe("parseGenericJsonlLine", () => {
  it("maps Gemini stream-json rows", () => {
    expect(
      parseGenericJsonlLine(JSON.stringify({ type: "init", session_id: "g-1", model: "gemini" })),
    ).toEqual([{ type: "session", sessionId: "g-1" }]);
    expect(
      parseGenericJsonlLine(
        JSON.stringify({ type: "message", role: "user", content: "the prompt" }),
      ),
    ).toEqual([]);
    expect(
      parseGenericJsonlLine(
        JSON.stringify({ type: "message", role: "assistant", content: "Hel", delta: true }),
      ),
    ).toEqual([{ type: "text", text: "Hel", partial: true }]);
    expect(
      parseGenericJsonlLine(
        JSON.stringify({
          type: "tool_use",
          tool_name: "read_file",
          tool_id: "t1",
          parameters: { absolute_path: "/w/a.ts" },
        }),
      ),
    ).toEqual([
      {
        type: "tool_call",
        id: "t1",
        name: "file_read",
        status: "running",
        arguments: { absolute_path: "/w/a.ts", path: "/w/a.ts" },
      },
    ]);
    expect(
      parseGenericJsonlLine(
        JSON.stringify({ type: "tool_result", tool_id: "t1", status: "success", output: "ok" }),
      ),
    ).toEqual([
      {
        type: "tool_call",
        id: "t1",
        name: "tool",
        status: "completed",
        arguments: {},
        result: "ok",
      },
    ]);
    expect(
      parseGenericJsonlLine(
        JSON.stringify({
          type: "result",
          status: "success",
          stats: { input_tokens: 10, output_tokens: 4, duration_ms: 99 },
        }),
      ),
    ).toEqual([
      {
        type: "result",
        status: "FINISHED",
        durationMs: 99,
        usage: { inputTokens: 10, outputTokens: 4 },
      },
    ]);
  });

  it("maps generic text / assistant / error shapes", () => {
    expect(parseGenericJsonlLine(JSON.stringify({ type: "text", text: "a" }))).toEqual([
      { type: "text", text: "a" },
    ]);
    expect(
      parseGenericJsonlLine(
        JSON.stringify({
          type: "assistant",
          session_id: "s",
          message: { content: [{ type: "text", text: "b" }] },
        }),
      ),
    ).toEqual([
      { type: "session", sessionId: "s" },
      { type: "text", text: "b" },
    ]);
    expect(parseGenericJsonlLine(JSON.stringify({ type: "error", message: "boom" }))).toEqual([
      { type: "error", message: "boom" },
    ]);
    expect(
      parseGenericJsonlLine(
        JSON.stringify({ type: "result", status: "error", error: { message: "x" } }),
      ),
    ).toEqual([{ type: "error", message: "x" }]);
    expect(parseGenericJsonlLine("not json")).toEqual([]);
  });
});

describe("parseAcpSessionUpdate", () => {
  it("maps message, thought, and tool updates", () => {
    const names = new Map<string, string>();
    expect(
      parseAcpSessionUpdate(
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } },
        names,
      ),
    ).toEqual([{ type: "text", text: "Hi", partial: true }]);
    expect(
      parseAcpSessionUpdate(
        { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } },
        names,
      ),
    ).toEqual([{ type: "reasoning", text: "hmm", partial: true }]);
    expect(
      parseAcpSessionUpdate(
        {
          sessionUpdate: "tool_call",
          toolCallId: "c1",
          title: "Run tests",
          kind: "execute",
          status: "pending",
          rawInput: { command: "npm test" },
        },
        names,
      ),
    ).toEqual([
      {
        type: "tool_call",
        id: "c1",
        name: "exec",
        status: "running",
        arguments: { command: "npm test", title: "Run tests" },
      },
    ]);
    const [done] = parseAcpSessionUpdate(
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "3 passed" } }],
      },
      names,
    );
    expect(done).toMatchObject({ id: "c1", name: "exec", status: "completed", result: "3 passed" });
    expect(parseAcpSessionUpdate({ sessionUpdate: "plan", entries: [] }, names)).toEqual([]);
  });

  it("prefers a one-shot allow for permission requests", () => {
    expect(
      pickAcpPermission({
        options: [
          { optionId: "rej", kind: "reject_once", name: "No" },
          { optionId: "always", kind: "allow_always", name: "Always" },
          { optionId: "once", kind: "allow_once", name: "Yes" },
        ],
      }),
    ).toEqual({ outcome: "selected", optionId: "once" });
    expect(pickAcpPermission({ options: [{ optionId: "rej", kind: "reject_once" }] })).toEqual({
      outcome: "cancelled",
    });
  });
});

describe("streamGenericCli", () => {
  it("streams text output and finishes", async () => {
    let seen: CursorCliSpawnRequest | undefined;
    const events = await collect(
      streamGenericCli({
        provider: provider({ args: ["-x", "{prompt}"] }),
        prompt: "hi",
        workspace: "/w",
        spawnFn: (req) => {
          seen = req;
          return linesHandle(["\u001b[32mline one\u001b[0m", "line two"]);
        },
      }),
    );
    expect(seen?.args).toEqual(["-x", "hi"]);
    expect(seen?.interactive).toBeUndefined();
    expect(texts(events)).toBe("line one\nline two\n");
    expect(events.at(-2)).toEqual({ type: "result", status: "FINISHED" });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("writes the prompt to stdin when {prompt} is not in args", async () => {
    const stdin: string[] = [];
    let seen: CursorCliSpawnRequest | undefined;
    await collect(
      streamGenericCli({
        provider: provider({ args: ["--headless"] }),
        prompt: "from stdin",
        workspace: "/w",
        spawnFn: (req) => {
          seen = req;
          return linesHandle(["ok"], { stdin });
        },
      }),
    );
    expect(seen?.interactive).toBe(true);
    expect(stdin).toEqual(["from stdin\n"]);
  });

  it("explains when a placement has no stdin pipe", async () => {
    const events = await collect(
      streamGenericCli({
        provider: provider({ args: ["--headless"] }),
        prompt: "x",
        workspace: "/w",
        spawnFn: () => linesHandle(["ok"]),
      }),
    );
    expect(events[0]).toMatchObject({ type: "error" });
    expect((events[0] as { message: string }).message).toMatch(/Put \{prompt\} in the args/);
  });

  it("reports a failing exit with stderr", async () => {
    const events = await collect(
      streamGenericCli({
        provider: provider({}),
        prompt: "x",
        workspace: "/w",
        spawnFn: () => linesHandle([], { code: 2, stderr: "bad flag --foo" }),
      }),
    );
    expect(events).toContainEqual({ type: "error", message: "Test agent failed: bad flag --foo" });
  });

  it("remembers a thread for id-less resumeArgs", async () => {
    const events = await collect(
      streamGenericCli({
        provider: provider({ resumeArgs: ["--continue"] }),
        prompt: "x",
        workspace: "/w",
        spawnFn: () => linesHandle(["done"]),
      }),
    );
    expect(events).toContainEqual({ type: "session", sessionId: GENERIC_CLI_CONTINUE });
  });

  it("parses jsonl and drops the final full echo after deltas", async () => {
    const events = await collect(
      streamGenericCli({
        provider: provider({ output: "jsonl" }),
        prompt: "x",
        workspace: "/w",
        spawnFn: () =>
          linesHandle([
            JSON.stringify({ type: "init", session_id: "g-7" }),
            JSON.stringify({ type: "message", role: "assistant", content: "He", delta: true }),
            JSON.stringify({ type: "message", role: "assistant", content: "llo", delta: true }),
            JSON.stringify({ type: "message", role: "assistant", content: "Hello" }),
            JSON.stringify({ type: "result", status: "success" }),
          ]),
      }),
    );
    expect(events[0]).toEqual({ type: "session", sessionId: "g-7" });
    expect(texts(events)).toBe("Hello");
    expect(events).toContainEqual({ type: "result", status: "FINISHED" });
  });

  it("falls back to plain lines when jsonl output is not JSON", async () => {
    const events = await collect(
      streamGenericCli({
        provider: provider({ output: "jsonl" }),
        prompt: "x",
        workspace: "/w",
        spawnFn: () => linesHandle(["plain answer"]),
      }),
    );
    expect(texts(events)).toBe("plain answer\n");
  });

  it("reuses the Claude Code stream-json parser", async () => {
    const events = await collect(
      streamGenericCli({
        provider: provider({ output: "claude-stream-json" }),
        prompt: "x",
        workspace: "/w",
        spawnFn: () =>
          linesHandle([
            JSON.stringify({ type: "system", subtype: "init", session_id: "c-1" }),
            JSON.stringify({
              type: "assistant",
              message: {
                content: [
                  { type: "text", text: "Done." },
                  { type: "tool_use", id: "u1", name: "Bash", input: { command: "ls" } },
                ],
              },
            }),
            JSON.stringify({ type: "result", subtype: "success", result: "Done." }),
          ]),
      }),
    );
    expect(events[0]).toEqual({ type: "session", sessionId: "c-1" });
    expect(texts(events)).toBe("Done.");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_call", id: "u1", name: "exec" }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "result", text: undefined }));
  });
});

/** A tiny in-process ACP agent: reads JSON-RPC lines written to stdin, answers on stdout. */
function fakeAcpAgent(opts: {
  loadSession?: boolean;
  history?: string[];
  onPermission?: (result: unknown) => void;
}) {
  const out: string[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const received: Record<string, unknown>[] = [];
  const emit = (msg: Record<string, unknown>) => {
    out.push(JSON.stringify({ jsonrpc: "2.0", ...msg }));
    wake?.();
  };
  const update = (sessionId: string, u: Record<string, unknown>) =>
    emit({ method: "session/update", params: { sessionId, update: u } });
  let pendingPrompt: { id: number; sessionId: string } | undefined;
  const handle: CursorCliSpawnHandle = {
    lines: (async function* () {
      for (;;) {
        while (out.length) yield out.shift()!;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    })(),
    wait: async () => ({ code: 0, stderr: "" }),
    kill: () => {
      closed = true;
      wake?.();
    },
    endInput: () => {
      closed = true;
      wake?.();
    },
    write: (data: string) => {
      for (const line of data.split("\n").filter(Boolean)) {
        const msg = JSON.parse(line) as Record<string, unknown>;
        received.push(msg);
        const id = msg.id as number;
        const params = (msg.params ?? {}) as Record<string, unknown>;
        if (msg.method === "initialize") {
          emit({
            id,
            result: {
              protocolVersion: 1,
              agentCapabilities: {
                loadSession: Boolean(opts.loadSession),
                mcpCapabilities: { http: true },
              },
            },
          });
        } else if (msg.method === "session/new") {
          emit({ id, result: { sessionId: "acp-new" } });
        } else if (msg.method === "session/load") {
          for (const text of opts.history ?? []) {
            update(params.sessionId as string, {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text },
            });
          }
          emit({ id, result: null });
        } else if (msg.method === "session/prompt") {
          const sessionId = params.sessionId as string;
          pendingPrompt = { id, sessionId };
          update(sessionId, {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "thinking" },
          });
          update(sessionId, {
            sessionUpdate: "tool_call",
            toolCallId: "t1",
            title: "Edit a.ts",
            kind: "edit",
            status: "pending",
            locations: [{ path: "/w/a.ts" }],
          });
          emit({
            id: 900,
            method: "session/request_permission",
            params: {
              sessionId,
              toolCall: { toolCallId: "t1" },
              options: [
                { optionId: "no", kind: "reject_once", name: "Reject" },
                { optionId: "yes", kind: "allow_once", name: "Allow" },
              ],
            },
          });
        } else if (msg.id === 900 && !msg.method) {
          opts.onPermission?.(msg.result);
          const pending = pendingPrompt!;
          update(pending.sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: "t1",
            status: "completed",
            content: [{ type: "diff", path: "/w/a.ts", oldText: "a", newText: "b" }],
          });
          update(pending.sessionId, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Edited." },
          });
          emit({ id: pending.id, result: { stopReason: "end_turn" } });
        } else if (msg.method && msg.id !== undefined) {
          emit({ id, error: { code: -32601, message: "nope" } });
        }
      }
    },
  };
  return { handle, received };
}

describe("ACP client", () => {
  it("initializes, creates a session, prompts, and answers permission", async () => {
    let permission: unknown;
    const agent = fakeAcpAgent({ onPermission: (r) => (permission = r) });
    let seen: CursorCliSpawnRequest | undefined;
    const events = await collect(
      streamGenericCli({
        provider: provider({ args: ["--acp"], output: "acp" }),
        prompt: "edit a.ts",
        workspace: "/w",
        mcpUrl: "http://127.0.0.1:7420/mcp/sessions/s1",
        spawnFn: (req) => {
          seen = req;
          return agent.handle;
        },
      }),
    );
    expect(seen?.interactive).toBe(true);
    const methods = agent.received.map((m) => m.method).filter(Boolean);
    expect(methods).toEqual(["initialize", "session/new", "session/prompt"]);
    const newParams = agent.received.find((m) => m.method === "session/new")?.params as {
      cwd: string;
      mcpServers: { url: string }[];
    };
    expect(newParams.cwd).toBe("/w");
    expect(newParams.mcpServers[0]?.url).toBe("http://127.0.0.1:7420/mcp/sessions/s1");
    const prompt = agent.received.find((m) => m.method === "session/prompt")?.params as {
      prompt: { text: string }[];
    };
    expect(prompt.prompt[0]?.text).toBe("edit a.ts");
    expect(permission).toEqual({ outcome: { outcome: "selected", optionId: "yes" } });
    expect(events[0]).toEqual({ type: "session", sessionId: "acp-new" });
    expect(events).toContainEqual({ type: "reasoning", text: "thinking" });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        id: "t1",
        name: "apply_patch",
        status: "completed",
        result: "updated /w/a.ts",
      }),
    );
    expect(texts(events)).toBe("Edited.");
    expect(events).toContainEqual(expect.objectContaining({ type: "result", status: "FINISHED" }));
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("resumes with session/load and hides the replayed history", async () => {
    const agent = fakeAcpAgent({ loadSession: true, history: ["old reply"] });
    const events = await collect(
      streamGenericCli({
        provider: provider({ args: [], output: "acp" }),
        prompt: "again",
        workspace: "/w",
        resume: "acp-old",
        spawnFn: () => agent.handle,
      }),
    );
    const methods = agent.received.map((m) => m.method).filter(Boolean);
    expect(methods).toEqual(["initialize", "session/load", "session/prompt"]);
    expect(events[0]).toEqual({ type: "session", sessionId: "acp-old" });
    expect(texts(events)).toBe("Edited.");
  });

  it("starts a new session when the agent cannot load one", async () => {
    const agent = fakeAcpAgent({ loadSession: false });
    await collect(
      streamGenericCli({
        provider: provider({ args: [], output: "acp" }),
        prompt: "again",
        workspace: "/w",
        resume: "acp-old",
        spawnFn: () => agent.handle,
      }),
    );
    expect(agent.received.map((m) => m.method).filter(Boolean)).toContain("session/new");
  });

  it("rejects pending requests when the agent exits", async () => {
    const conn = new AcpConnection(
      {
        lines: (async function* () {
          /* agent exits immediately */
        })(),
        write: () => undefined,
      },
      { onNotification: () => undefined, onRequest: () => undefined },
    );
    const pending = conn.request("initialize", {});
    await conn.run(async () => new Error("gone"));
    await expect(pending).rejects.toThrow("gone");
  });

  it("refuses ACP on a placement without stdin", async () => {
    const events = await collect(
      streamGenericCli({
        provider: provider({ args: [], output: "acp" }),
        prompt: "x",
        workspace: "/w",
        spawnFn: () => linesHandle([]),
      }),
    );
    expect((events[0] as { message?: string }).message).toMatch(/ACP needs a stdin pipe/);
  });
});

describe("checkGenericCli", () => {
  it("runs --version without the API key env", async () => {
    let seen: CursorCliSpawnRequest | undefined;
    process.env.LOCUS_TEST_AGENT_KEY = "secret";
    try {
      const health = await checkGenericCli(
        provider({ command: "gemini", apiKeyEnv: "LOCUS_TEST_AGENT_KEY" }),
        (req) => {
          seen = req;
          return linesHandle(["gemini 0.9.1"]);
        },
      );
      expect(health).toEqual({ ok: true, command: "gemini", version: "0.9.1" });
      expect(seen?.args).toEqual(["--version"]);
      expect(seen?.env.LOCUS_TEST_AGENT_KEY).toBeUndefined();
    } finally {
      delete process.env.LOCUS_TEST_AGENT_KEY;
    }
  });

  it("reports a missing command and a failing probe", async () => {
    expect((await checkGenericCli(provider({ command: "" }))).ok).toBe(false);
    const failed = await checkGenericCli(provider({}), () =>
      linesHandle([], { code: 127, stderr: "not found" }),
    );
    expect(failed.ok).toBe(false);
    expect(failed.message).toMatch(/exited 127/);
  });
});
