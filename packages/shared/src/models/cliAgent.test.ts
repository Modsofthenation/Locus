import { describe, expect, it } from "vitest";
import {
  CLI_AGENT_PRESETS,
  cliAgentConfigError,
  cliAgentPromptInArgs,
  formatCliArgsText,
  normalizeCliAgentConfig,
  parseCliArgsText,
} from "./cliAgent.js";
import {
  builtinProviderKey,
  hasUsableKey,
  isGenericCliProvider,
  isLocalAgentCliProvider,
  mergeBuiltinProviders,
  type AiProvider,
} from "./provider.js";

describe("cliAgentConfigError", () => {
  it("accepts every preset that has a command", () => {
    for (const preset of CLI_AGENT_PRESETS) {
      if (!preset.cli.command) continue;
      expect(cliAgentConfigError(preset.name, preset.cli)).toBeUndefined();
    }
  });

  it("rejects missing or multi-word commands", () => {
    expect(cliAgentConfigError("X", undefined)).toMatch(/pick a preset/);
    expect(cliAgentConfigError("X", { command: "", args: [], output: "text" })).toMatch(
      /command is required/,
    );
    expect(cliAgentConfigError("X", { command: "gemini -p", args: [], output: "text" })).toMatch(
      /put flags in args/,
    );
    expect(
      cliAgentConfigError("X", { command: "/opt/my agent/bin/run", args: [], output: "text" }),
    ).toBeUndefined();
  });

  it("rejects bad output, args, placeholders, and env", () => {
    expect(cliAgentConfigError("X", { command: "a", args: [], output: "xml" })).toMatch(
      /output must be one of/,
    );
    expect(cliAgentConfigError("X", { command: "a", args: "run", output: "text" })).toMatch(
      /args must be a list/,
    );
    expect(cliAgentConfigError("X", { command: "a", args: ["{promt}"], output: "text" })).toMatch(
      /unknown placeholder \{promt\}/,
    );
    expect(cliAgentConfigError("X", { command: "a", args: ["{prompt}"], output: "acp" })).toMatch(
      /ACP agents receive the prompt/,
    );
    expect(
      cliAgentConfigError("X", {
        command: "a",
        args: ["{prompt}"],
        resumeArgs: ["{prompt}"],
        output: "text",
      }),
    ).toMatch(/belongs in args/);
    expect(
      cliAgentConfigError("X", {
        command: "a",
        args: [],
        output: "text",
        env: { "BAD-NAME": "1" },
      }),
    ).toMatch(/env name/);
    expect(
      cliAgentConfigError("X", { command: "a", args: [], output: "text", apiKeyEnv: "nope nope" }),
    ).toMatch(/API key env var/);
  });
});

describe("normalizeCliAgentConfig", () => {
  it("trims, drops junk, and defaults output", () => {
    expect(
      normalizeCliAgentConfig({
        command: "  aider ",
        args: ["--message", 3, "{prompt}"],
        resumeArgs: [],
        output: "weird",
        env: { " A ": "1", B: 2 },
        apiKeyEnv: " ",
        preset: "nope",
      }),
    ).toEqual({
      command: "aider",
      args: ["--message", "{prompt}"],
      output: "text",
      env: { A: "1" },
    });
    expect(normalizeCliAgentConfig(null)).toBeUndefined();
  });
});

describe("argv text", () => {
  it("round-trips quoted args", () => {
    const args = parseCliArgsText(`-p {prompt} --title "two words" ''`);
    expect(args).toEqual(["-p", "{prompt}", "--title", "two words", ""]);
    expect(parseCliArgsText(formatCliArgsText(args))).toEqual(args);
  });

  it("knows when the prompt travels in argv", () => {
    expect(cliAgentPromptInArgs({ args: ["-p", "{prompt}"], output: "text" })).toBe(true);
    expect(cliAgentPromptInArgs({ args: ["--headless"], output: "text" })).toBe(false);
    expect(cliAgentPromptInArgs({ args: ["{prompt}"], output: "acp" })).toBe(false);
  });
});

describe("cli-agent providers", () => {
  const row = (name: string): AiProvider => ({
    id: `cli-agent:${name}`,
    name,
    kind: "cli-agent",
    baseUrl: "cli-agent://local",
    models: [],
    defaultModel: "",
    enabled: true,
    extraHeaders: {},
    cli: { command: "x", args: ["{prompt}"], output: "text" },
  });

  it("are local CLI providers that need no key", () => {
    expect(isGenericCliProvider({ kind: "cli-agent" })).toBe(true);
    expect(isGenericCliProvider({ baseUrl: "cli-agent://local" })).toBe(true);
    expect(isLocalAgentCliProvider({ kind: "cli-agent" })).toBe(true);
    expect(hasUsableKey("", "cli-agent://local", "cli-agent")).toBe(true);
  });

  it("can be configured more than once", () => {
    expect(builtinProviderKey(row("Gemini CLI"))).toBe("cli-agent:Gemini CLI");
    const merged = mergeBuiltinProviders([row("Gemini CLI"), row("Aider")], []);
    expect(merged.map((p) => p.name)).toEqual(["Gemini CLI", "Aider"]);
  });
});
