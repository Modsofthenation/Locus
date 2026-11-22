import { describe, expect, it } from "vitest";
import { resolveModelRoute } from "./modelRoute.js";
import type { AiProvider } from "./provider.js";

function provider(row: Partial<AiProvider> & Pick<AiProvider, "id" | "kind">): AiProvider {
  return {
    name: row.id,
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    models: [],
    defaultModel: `${row.id}-default`,
    enabled: true,
    extraHeaders: {},
    ...row,
  };
}

const anthropic = provider({
  id: "p-anthropic",
  name: "Anthropic",
  kind: "anthropic",
  models: ["claude-opus-5-5", "claude-haiku-5-5"],
  defaultModel: "claude-opus-5-5",
});
const openai = provider({
  id: "p-openai",
  name: "OpenAI",
  kind: "openai",
  models: ["gpt-6", "gpt-6-mini"],
  defaultModel: "gpt-6",
});
const noKey = provider({ id: "p-xai", name: "xAI", kind: "xai", apiKey: "" });
const cli = provider({ id: "p-claude-code", name: "Claude Code", kind: "claude-code" });
const providers = [anthropic, openai, noKey, cli];
const current = { provider: anthropic, model: "claude-opus-5-5" };

describe("resolveModelRoute", () => {
  it("keeps the session provider and model when nothing is asked", () => {
    expect(resolveModelRoute(providers, undefined, current)).toMatchObject({
      ok: true,
      provider: anthropic,
      model: "claude-opus-5-5",
      overridden: false,
    });
  });

  it("matches a provider by id, name, or kind and uses its default model", () => {
    for (const token of ["p-openai", "openai", "OpenAI"]) {
      expect(resolveModelRoute(providers, { provider: token }, current)).toMatchObject({
        ok: true,
        provider: openai,
        model: "gpt-6",
        overridden: true,
      });
    }
  });

  it("keeps the session provider for a model it lists", () => {
    expect(resolveModelRoute(providers, { model: "claude-haiku-5-5" }, current)).toMatchObject({
      ok: true,
      provider: anthropic,
      model: "claude-haiku-5-5",
      overridden: true,
    });
  });

  it("finds the provider that lists a model when none is named", () => {
    expect(resolveModelRoute(providers, { model: "gpt-6-mini" }, current)).toMatchObject({
      ok: true,
      provider: openai,
      model: "gpt-6-mini",
    });
  });

  it("refuses unknown, keyless, and CLI providers and lists the usable ones", () => {
    const unknown = resolveModelRoute(providers, { provider: "gemini" }, current);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toContain("OpenAI (p-openai) · gpt-6");
    const keyless = resolveModelRoute(providers, { provider: "xai" }, current);
    expect(keyless.ok).toBe(false);
    if (!keyless.ok) expect(keyless.error).toContain("no API key");
    const loop = resolveModelRoute(providers, { provider: "claude-code" }, current);
    expect(loop.ok).toBe(false);
    if (!loop.ok) expect(loop.error).toContain("own agent loop");
  });
});
