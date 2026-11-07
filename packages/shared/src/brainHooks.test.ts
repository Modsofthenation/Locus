import { describe, expect, it } from "vitest";
import {
  brainHookCommand,
  brainHookExcludeBlock,
  brainIngestScript,
  mergeClaudeHooks,
  mergeCodexHooks,
  mergeCursorHooks,
  redactHookSecrets,
} from "./brainHooks.js";

describe("brain hooks", () => {
  it("redacts token-shaped strings and bakes the loopback port into the hook", () => {
    expect(redactHookSecrets("key sk-abcdefghijklmnopqrstuvwxyz is set")).toContain("[redacted]");
    expect(redactHookSecrets("key sk-abcdefghijklmnopqrstuvwxyz is set")).not.toContain("sk-abc");
    const script = brainIngestScript(7420);
    expect(script).toContain("http://127.0.0.1:");
    expect(script).toContain("/api/brain/transcript");
    expect(script).toContain("process.exit(0)");
    expect(script).not.toContain("0.0.0.0");
  });

  it("merges personal hook commands without dropping existing keys", () => {
    const command = brainHookCommand("cursor");
    const cursor = mergeCursorHooks(
      JSON.stringify({ version: 1, hooks: { stop: [{ command: "echo hi" }] } }),
      command,
    );
    const parsed = JSON.parse(cursor) as {
      hooks: { stop: unknown[]; afterAgentResponse: Array<{ command: string }> };
    };
    expect(parsed.hooks.stop).toHaveLength(1);
    expect(parsed.hooks.afterAgentResponse.map((row) => row.command)).toEqual([command]);
    expect(mergeCursorHooks(cursor, command)).toBe(cursor);

    const claude = JSON.parse(
      mergeClaudeHooks(JSON.stringify({ model: "haiku" }), brainHookCommand("claude")),
    ) as { model: string; hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> } };
    expect(claude.model).toBe("haiku");
    expect(claude.hooks.Stop[0]?.hooks[0]?.command).toBe(brainHookCommand("claude"));

    const codex = JSON.parse(mergeCodexHooks(undefined, brainHookCommand("codex"))) as {
      hooks: { Stop: Array<{ command: string }> };
    };
    expect(codex.hooks.Stop[0]?.command).toBe(brainHookCommand("codex"));
  });

  it("refuses to clobber a non-object hooks file", () => {
    expect(() => mergeCursorHooks("[]", brainHookCommand("cursor"))).toThrow(/JSON object/);
  });

  it("lists the paths that stay out of git", () => {
    const block = brainHookExcludeBlock();
    expect(block).toContain(".locus/hooks/");
    expect(block).toContain(".cursor/hooks.json");
    expect(block).toContain(".claude/settings.local.json");
    expect(block).toContain(".codex/hooks.json");
  });
});
