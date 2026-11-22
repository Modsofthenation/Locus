import { describe, expect, it } from "vitest";
import { defaultConfig } from "../defaults.js";
import { configSecretValues, mergeSecrets, redactConfig } from "./redact.js";

describe("Custom CLI agent env redaction", () => {
  it("masks secret-named env, keeps the rest, and restores on save", () => {
    const config = defaultConfig("/data");
    config.providers.push({
      id: "cli-agent:Gemini CLI",
      name: "Gemini CLI",
      kind: "cli-agent",
      baseUrl: "cli-agent://local",
      models: [],
      defaultModel: "",
      enabled: true,
      extraHeaders: {},
      cli: {
        command: "gemini",
        args: ["-p", "{prompt}"],
        output: "jsonl",
        env: { GEMINI_API_KEY: "AIza-secret-123", GEMINI_SANDBOX: "false" },
      },
    });
    const redacted = redactConfig(config);
    const row = redacted.providers.find((p) => p.kind === "cli-agent");
    expect(row?.cli?.env).toEqual({ GEMINI_API_KEY: "••••••••", GEMINI_SANDBOX: "false" });
    const merged = mergeSecrets(config, redacted);
    expect(merged.providers.find((p) => p.kind === "cli-agent")?.cli?.env).toEqual({
      GEMINI_API_KEY: "AIza-secret-123",
      GEMINI_SANDBOX: "false",
    });
    expect(configSecretValues(config)).toContain("AIza-secret-123");
  });
});
