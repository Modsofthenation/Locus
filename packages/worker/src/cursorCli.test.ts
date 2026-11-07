import { describe, expect, it } from "vitest";
import {
  allowedWorkerCursorCliCommand,
  rewriteWorkerCliMcpArgs,
  workerCliArgs,
  workerCliEnv,
  workerGitMcpUrl,
} from "./cursorCli.js";

describe("allowedWorkerCursorCliCommand", () => {
  it("allows the Windows Cursor CLI wrapper and rejects shells", () => {
    expect(
      allowedWorkerCursorCliCommand(
        "C:\\Users\\locus\\AppData\\Local\\cursor-agent\\cursor-agent.cmd",
      ),
    ).toBe(true);
    expect(allowedWorkerCursorCliCommand("agent")).toBe(true);
    expect(allowedWorkerCursorCliCommand("claude")).toBe(true);
    expect(allowedWorkerCursorCliCommand("codex")).toBe(true);
    expect(allowedWorkerCursorCliCommand("kiro-cli")).toBe(true);
    expect(allowedWorkerCursorCliCommand("cmd.exe")).toBe(false);
    expect(allowedWorkerCursorCliCommand("bash")).toBe(false);
    expect(allowedWorkerCursorCliCommand("node")).toBe(false);
    expect(allowedWorkerCursorCliCommand("python3")).toBe(false);
    expect(allowedWorkerCursorCliCommand("/usr/bin/node")).toBe(false);
    expect(allowedWorkerCursorCliCommand("agent.mjs")).toBe(true);
  });
});

describe("workerCliEnv", () => {
  it("maps Claude Code keys onto Anthropic env and Cursor CLI onto CURSOR_API_KEY", () => {
    expect(workerCliEnv("claude", "sk-ant").ANTHROPIC_API_KEY).toBe("sk-ant");
    expect(workerCliEnv("claude", "sk-ant").CLAUDE_API_KEY).toBe("sk-ant");
    expect(workerCliEnv("claude", "sk-ant").CURSOR_API_KEY).toBe(process.env.CURSOR_API_KEY);
    expect(workerCliEnv("agent", "key").CURSOR_API_KEY).toBe("key");
    expect(workerCliEnv("codex", "key").OPENAI_API_KEY).toBe("key");
    expect(workerCliEnv("kiro-cli", "key").KIRO_API_KEY).toBe("key");
    expect(workerCliEnv("kiro-cli", "key").CURSOR_API_KEY).toBe(process.env.CURSOR_API_KEY);
    expect(
      workerCliEnv("codex", "key", "http://127.0.0.1:17420/mcp/sessions/s1").LOCUS_GIT_MCP_URL,
    ).toBe("http://127.0.0.1:17420/mcp/sessions/s1");
    expect(workerCliEnv("codex", "key").LOCUS_GIT_MCP_URL).toBeUndefined();
  });

  it("rewrites Codex locus_git loopback onto the worker session MCP", () => {
    const laptop = 'mcp_servers.locus_git.url="http://127.0.0.1:7420/mcp/sessions/s1"';
    const local = "http://127.0.0.1:17420/mcp/sessions/s1";
    const rewritten = rewriteWorkerCliMcpArgs(["--config", laptop, "exec"], local);
    expect(rewritten).toContain(`mcp_servers.locus_git.url=${JSON.stringify(local)}`);
    expect(rewritten.join(" ")).not.toContain("127.0.0.1:7420");
    expect(workerGitMcpUrl(rewritten)).toBe(local);
    expect(workerCliArgs("codex", ["--cd", "old", "--config", laptop], "/ws", local)).toEqual([
      "--cd",
      "/ws",
      "--config",
      `mcp_servers.locus_git.url=${JSON.stringify(local)}`,
    ]);
    expect(rewriteWorkerCliMcpArgs(["-p"], local)).toEqual(["-p"]);
  });

  it("injects --workspace for Cursor CLI only", () => {
    expect(workerCliArgs("agent", ["-p"], "/ws")).toEqual(["--workspace", "/ws", "-p"]);
    expect(workerCliArgs("claude", ["-p", "--output-format", "stream-json"], "/ws")).toEqual([
      "-p",
      "--output-format",
      "stream-json",
    ]);
    expect(workerCliArgs("codex", ["exec", "--cd", "old"], "/ws")).toEqual(["exec", "--cd", "/ws"]);
  });
});
