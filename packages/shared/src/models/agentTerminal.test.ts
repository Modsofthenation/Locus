import { describe, expect, it } from "vitest";
import {
  agentTerminalNeedsYou,
  defaultAgentTerminalPresetId,
  isAgentTerminalNeedsYou,
  lastTerminalLine,
  looksLikeTerminalPrompt,
  resolveAgentTerminalCommand,
  stripTerminalAnsi,
} from "./agentTerminal.js";

describe("looksLikeTerminalPrompt", () => {
  it.each([
    "Do you want to make this edit to src/app.ts?",
    "Overwrite file? (y/n)",
    "Apply these changes [Y/n] ",
    "Allow command `npm test`",
    "Approve this plan",
    "> ",
    "❯ ",
    "\u001b[1m? \u001b[0mWhich model would you like to use\u001b[0m",
    "Working...\r\nDone.\r\nWhat next?\r\n\r\n",
  ])("flags %j", (text) => {
    expect(looksLikeTerminalPrompt(text)).toBe(true);
  });

  it.each([
    "",
    "   \r\n",
    "Compiling src/app.ts",
    "user@host:~/proj$ ",
    "Tests: 12 passed",
    "\u001b[32m✓\u001b[0m built in 412ms",
    "Allowing network access to registry",
  ])("ignores %j", (text) => {
    expect(looksLikeTerminalPrompt(text)).toBe(false);
  });

  it("reads through a TUI input box frame", () => {
    const box = "╭────────────╮\r\n│ >          │\r\n╰────────────╯\r\n";
    expect(lastTerminalLine(box)).toBe(">");
    expect(looksLikeTerminalPrompt(box)).toBe(true);
  });

  it("keeps the last carriage-return overwrite of a line", () => {
    expect(stripTerminalAnsi("10%\r50%\r100%")).toBe("100%");
    expect(lastTerminalLine("Thinking…\rContinue? ")).toBe("Continue?");
  });
});

describe("resolveAgentTerminalCommand", () => {
  it("maps presets, raw commands, and the fallback", () => {
    expect(resolveAgentTerminalCommand("claude")).toEqual({
      label: "Claude Code",
      command: "claude",
    });
    expect(resolveAgentTerminalCommand("shell")).toEqual({ label: "Shell", command: null });
    expect(resolveAgentTerminalCommand("", "codex")).toEqual({ label: "Codex", command: "codex" });
    expect(resolveAgentTerminalCommand(undefined, "nope")?.command).toBeNull();
    expect(resolveAgentTerminalCommand("npx foo --bar")).toEqual({
      label: "npx foo --bar",
      command: "npx foo --bar",
    });
  });

  it("rejects multi-line or oversized input", () => {
    expect(resolveAgentTerminalCommand("echo a\nrm -rf /")).toBeNull();
    expect(resolveAgentTerminalCommand("x".repeat(600))).toBeNull();
  });
});

describe("defaultAgentTerminalPresetId", () => {
  it("follows the session provider", () => {
    expect(defaultAgentTerminalPresetId({ kind: "claude-code" })).toBe("claude");
    expect(defaultAgentTerminalPresetId({ baseUrl: "codex-cli://local" })).toBe("codex");
    expect(defaultAgentTerminalPresetId({ kind: "cursor-cli" })).toBe("cursor-agent");
    expect(defaultAgentTerminalPresetId({ kind: "kiro-cli" })).toBe("kiro-cli");
    expect(defaultAgentTerminalPresetId({ kind: "openai" })).toBe("shell");
    expect(defaultAgentTerminalPresetId(undefined)).toBe("shell");
  });
});

describe("agentTerminalNeedsYou", () => {
  it("prefixes and clips the waiting line", () => {
    const text = agentTerminalNeedsYou(`  Do you want   to proceed?${" x".repeat(100)}`);
    expect(text.startsWith("Terminal: Do you want to proceed?")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(130);
    expect(isAgentTerminalNeedsYou(text)).toBe(true);
    expect(isAgentTerminalNeedsYou("Review ready")).toBe(false);
  });
});
