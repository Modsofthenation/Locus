import { describe, expect, it } from "vitest";
import { CODEX_CLI_MODELS, type AiProvider } from "@locus/shared";
import {
  buildCodexCliArgv,
  checkCodexCli,
  listCodexCliModels,
  parseCodexCliEvents,
  streamCodexCli,
  type CodexCliSpawner,
} from "./codexCli.js";

const provider: AiProvider = {
  id: "codex-cli",
  name: "Codex CLI",
  kind: "codex-cli",
  baseUrl: "codex-cli://local",
  models: [...CODEX_CLI_MODELS],
  defaultModel: "gpt-6-astra",
  enabled: true,
  extraHeaders: {},
};

function spawner(lines: string[], code = 0): CodexCliSpawner {
  return () => ({
    lines: (async function* () {
      for (const line of lines) yield line;
    })(),
    wait: async () => ({ code, stderr: code ? "failed" : "" }),
  });
}

describe("codex cli adapter", () => {
  it.each([undefined, "thread-1"])(
    "configures the session Git bridge when resuming %s",
    (resume) => {
      const argv = buildCodexCliArgv({
        provider,
        prompt: "Publish",
        workspace: "/workspace",
        resume,
        gitMcpUrl: "http://127.0.0.1:7420/mcp/sessions/session-1",
      });
      const { args } = argv;
      expect(args).toContain(
        'mcp_servers.locus_git.url="http://127.0.0.1:7420/mcp/sessions/session-1"',
      );
      expect(args).toContain('mcp_servers.locus_git.default_tools_approval_mode="approve"');
      expect(args).toContain("mcp_servers.locus_git.required=true");
      expect(args).toContain(
        'mcp_servers.locus_git.enabled_tools=["git_status","git_diff","git_log","git_branch","git_commit","git_fetch","git_push","git_pr"]',
      );
      expect(args.join(" ")).not.toContain("playwright");
      expect(args).toContain("mcp_servers.locus_git.tool_timeout_sec=900");
      expect(args.indexOf("--config")).toBeLessThan(args.indexOf("exec"));
      expect(argv.env.LOCUS_GIT_MCP_URL).toBe("http://127.0.0.1:7420/mcp/sessions/session-1");
    },
  );

  it("omits MCP write tools for plan turns", () => {
    const argv = buildCodexCliArgv({
      provider,
      prompt: "Inspect",
      workspace: "/workspace",
      gitMcpUrl: "http://127.0.0.1:7420/mcp/sessions/session-1",
      mode: "plan",
    });
    const { args } = argv;
    expect(args.join(" ")).not.toContain("mcp_servers.locus_git");
    expect(argv.env.LOCUS_GIT_MCP_URL).toBeUndefined();
    expect(args).toContain("read-only");
  });

  it("exposes playwright on Design/Games/Assets Codex MCP", () => {
    const argv = buildCodexCliArgv({
      provider,
      prompt: "Look at the canvas",
      workspace: "/workspace",
      gitMcpUrl: "http://127.0.0.1:7420/mcp/sessions/session-1",
      mcpKind: "canvas",
    });
    expect(argv.args).toContain(
      'mcp_servers.locus_git.enabled_tools=["playwright","git_status","git_diff","git_log","git_branch","git_commit","git_fetch","git_push","git_pr"]',
    );
    expect(argv.env.LOCUS_GIT_MCP_URL).toBe("http://127.0.0.1:7420/mcp/sessions/session-1");
    expect(argv.args).toContain("workspace-write");
  });

  it("exposes inspect-only git_pr tools on review Codex MCP", () => {
    const argv = buildCodexCliArgv({
      provider,
      prompt: "Review the PR",
      workspace: "/workspace",
      gitMcpUrl: "http://127.0.0.1:7420/mcp/sessions/session-1",
      review: true,
      mcpKind: "review",
    });
    const joined = argv.args.join(" ");
    expect(argv.args).toContain("read-only");
    expect(argv.env.LOCUS_GIT_MCP_URL).toBe("http://127.0.0.1:7420/mcp/sessions/session-1");
    expect(joined).toContain("git_pr_get");
    expect(joined).not.toContain("git_push");
    expect(argv.args).toContain(
      'mcp_servers.locus_git.enabled_tools=["git_pr_list","git_pr_get","git_pr_loadpath","git_pr_comment","git_pr_review","git_pr_checks"]',
    );
  });
  it("builds an initial command with workspace, model, search, and API key", () => {
    const argv = buildCodexCliArgv({
      provider: { ...provider, apiKey: "sk-test" },
      prompt: "Inspect the project",
      workspace: "C:\\work\\repo",
      model: "gpt-6-astra",
      webSearch: true,
      env: { PATH: "test" },
    });
    expect(argv.command).toBe("codex");
    expect(argv.args).toEqual([
      "--cd",
      "C:\\work\\repo",
      "--search",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--model",
      "gpt-6-astra",
      "--",
      "Inspect the project",
    ]);
    expect(argv.env.OPENAI_API_KEY).toBe("sk-test");
  });

  it("uses exec resume and a read-only sandbox for plan turns", () => {
    const argv = buildCodexCliArgv({
      provider,
      prompt: "Continue the plan",
      workspace: "/workspace",
      resume: "thread-1",
      mode: "plan",
      webSearch: true,
    });
    expect(argv.args).toEqual([
      "--cd",
      "/workspace",
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "exec",
      "resume",
      "thread-1",
      "--json",
      "--skip-git-repo-check",
      "--",
      "Continue the plan",
    ]);
    expect(argv.args.indexOf("--cd")).toBeLessThan(argv.args.indexOf("exec"));
    expect(argv.args.slice(argv.args.indexOf("resume")).includes("--cd")).toBe(false);
  });

  it("passes supported reasoning effort to Codex and omits unsupported levels", () => {
    const supported = buildCodexCliArgv({
      provider,
      prompt: "Reason carefully",
      workspace: "/workspace",
      model: "gpt-5.6-luna",
      reasoningEffort: "max",
    });
    expect(supported.args).toEqual(
      expect.arrayContaining(["--config", 'model_reasoning_effort="max"']),
    );

    const unsupported = buildCodexCliArgv({
      provider,
      prompt: "Reason carefully",
      workspace: "/workspace",
      model: "gpt-5.5",
      reasoningEffort: "ultra",
    });
    expect(unsupported.args).not.toContain('model_reasoning_effort="ultra"');
  });

  it("maps legacy Codex model ids before invoking the CLI", () => {
    const argv = buildCodexCliArgv({
      provider,
      prompt: "Use the current model",
      workspace: "/workspace",
      model: "gpt-5.3-codex",
    });
    expect(argv.args).toEqual(expect.arrayContaining(["--model", "gpt-6-astra"]));
    expect(argv.args).not.toContain("gpt-5.3-codex");
  });

  it("normalizes Codex JSONL thread, message, tool, and usage events", () => {
    expect(parseCodexCliEvents('{"type":"thread.started","thread_id":"thread-1"}')).toEqual([
      { type: "session", sessionId: "thread-1" },
    ]);
    expect(
      parseCodexCliEvents(
        '{"type":"item.started","item":{"type":"command_execution","id":"cmd-1","command":"npm test"}}',
      ),
    ).toEqual([
      {
        type: "tool_call",
        id: "cmd-1",
        name: "exec",
        status: "running",
        arguments: { command: "npm test" },
      },
    ]);
    expect(parseCodexCliEvents('{"type":"turn.failed","error":{"message":"failed"}}')).toEqual([
      { type: "error", message: "failed", terminal: true },
    ]);
    expect(parseCodexCliEvents('{"type":"turn.failed","message":"turn failed"}')).toEqual([
      { type: "error", message: "turn failed", terminal: true },
    ]);
    expect(
      parseCodexCliEvents(
        '{"type":"item.completed","item":{"type":"agent_message","id":"msg-1","text":"Done"}}',
      ),
    ).toEqual([{ type: "text", text: "Done" }]);
    expect(
      parseCodexCliEvents(
        '{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":4,"output_tokens":7}}',
      ),
    ).toEqual([
      { type: "usage", inputTokens: 12, outputTokens: 7, cachedInputTokens: 4 },
      {
        type: "result",
        status: "FINISHED",
        usage: { inputTokens: 12, outputTokens: 7, cachedInputTokens: 4 },
      },
    ]);
    expect(
      parseCodexCliEvents(
        '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-5.3-codex\' model is not supported when using Codex with a ChatGPT account."}}',
      ),
    ).toEqual([
      {
        type: "error",
        message:
          "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
        terminal: true,
      },
    ]);
  });

  it("stops after a terminal provider error without duplicating stderr", async () => {
    const events = [];
    for await (const event of streamCodexCli({
      provider,
      prompt: "hello",
      workspace: "/workspace",
      spawnFn: spawner(
        [
          '{"type":"thread.started","thread_id":"thread-1"}',
          '{"type":"error","status":400,"error":{"message":"model is unavailable"}}',
        ],
        1,
      ),
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "session", sessionId: "thread-1" },
      { type: "error", message: "model is unavailable", terminal: true },
      { type: "done" },
    ]);
  });

  it("checks the installed CLI and ChatGPT login without exposing probe output", async () => {
    const calls: string[][] = [];
    const health = await checkCodexCli(provider, (req) => {
      calls.push(req.args);
      const isVersion = req.args.includes("--version");
      return {
        lines: (async function* () {
          yield isVersion ? "codex-cli 0.154.0" : "Logged in using ChatGPT";
        })(),
        wait: async () => ({ code: 0, stderr: "account@example.com" }),
      };
    });
    expect(health).toEqual({
      ok: true,
      command: "codex",
      version: "0.154.0",
      authenticated: true,
      authMode: "chatgpt",
    });
    expect(calls).toEqual([["--version"], ["login", "status"]]);
    expect(JSON.stringify(health)).not.toContain("account@example.com");
  });

  it("does not pass provider API keys to health-check executables", async () => {
    const observed: Array<NodeJS.ProcessEnv> = [];
    const health = await checkCodexCli({ ...provider, apiKey: "sk-secret" }, (req) => {
      observed.push(req.env);
      return {
        lines: (async function* () {
          if (req.args.includes("--version")) yield "codex-cli 0.154.0";
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      };
    });
    expect(observed.every((env) => env.OPENAI_API_KEY === undefined)).toBe(true);
    expect(health).toMatchObject({ ok: true, authenticated: false, authMode: "api-key" });
  });

  it("reports missing Codex authentication", async () => {
    const health = await checkCodexCli(provider, (req) => ({
      lines: (async function* () {
        if (req.args.includes("--version")) yield "codex-cli 0.154.0";
        else yield "Not logged in";
      })(),
      wait: async () => ({ code: req.args.includes("--version") ? 0 : 1, stderr: "" }),
    }));
    expect(health).toEqual({
      ok: false,
      command: "codex",
      version: "0.154.0",
      authenticated: false,
      authMode: "missing",
      message: "Codex CLI is not authenticated. Run `codex login` or configure an API key.",
    });
  });

  it("does not treat an unknown successful login status as authenticated", async () => {
    const health = await checkCodexCli(provider, (req) => ({
      lines: (async function* () {
        if (req.args.includes("--version")) yield "codex-cli 0.154.0";
        else yield "authentication required";
      })(),
      wait: async () => ({ code: 0, stderr: "" }),
    }));
    expect(health.ok).toBe(false);
    expect(health.authMode).toBe("missing");
  });

  it("uses the stored model catalog", async () => {
    await expect(listCodexCliModels(provider)).resolves.toEqual(CODEX_CLI_MODELS);
    await expect(listCodexCliModels({ ...provider, models: [] })).resolves.toEqual([
      "gpt-6-astra",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
    ]);
  });
});
