import { describe, expect, it } from "vitest";
import { BUILTIN_PROVIDERS, builtinProviderKey, type AiProvider } from "./provider.js";
import {
  automationRunUsd,
  formatRatePair,
  formatUsdPerMillion,
  modelFamilyKey,
  normalizeModelId,
  projectedModelCosts,
  publishedRates,
  resolveUsageRates,
} from "./pricing.js";

function builtins(): AiProvider[] {
  return BUILTIN_PROVIDERS.map((p) => ({ ...p, id: builtinProviderKey(p), apiKey: "" }));
}

describe("normalizeModelId", () => {
  it("strips vendor prefixes and punctuation", () => {
    expect(normalizeModelId("openai/gpt-4.1")).toBe("gpt-4-1");
    expect(normalizeModelId("anthropic/claude-sonnet-4.5")).toBe("claude-sonnet-4-5");
    expect(normalizeModelId("accounts/fireworks/models/llama-v3p3-70b-instruct")).toBe(
      "llama-v3p3-70b-instruct",
    );
    expect(modelFamilyKey("meta-llama/Llama-3.3-70B-Instruct-Turbo")).toBe("llama-3-3-70b");
    expect(modelFamilyKey("llama-3.3-70b-versatile")).toBe("llama-3-3-70b");
    expect(modelFamilyKey("gpt-4.1")).not.toBe(modelFamilyKey("gpt-4.1-mini"));
  });
});

describe("publishedRates", () => {
  it("returns list prices for builtin cloud models", () => {
    const openai = builtins().find((p) => p.kind === "openai")!;
    expect(publishedRates(openai, "gpt-4.1")).toEqual({
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 8,
    });
    expect(publishedRates(openai, "gpt-4.1-mini")).toEqual({
      inputUsdPerMillion: 0.4,
      outputUsdPerMillion: 1.6,
    });
    const anthropic = builtins().find((p) => p.kind === "anthropic")!;
    expect(publishedRates(anthropic, "claude-sonnet-4-5")).toEqual({
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
    });
  });

  it("treats local and OpenCode free models as $0", () => {
    const ollama = builtins().find((p) => p.name === "Ollama")!;
    expect(publishedRates(ollama, "llama3.2")).toEqual({
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
    });
    const opencode = builtins().find((p) => p.kind === "opencode")!;
    expect(publishedRates(opencode, "big-pickle")).toEqual({
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
    });
    expect(publishedRates(opencode, "x-preview-f-free")).toEqual({
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
    });
  });

  it("matches OpenRouter ids to first-party list prices", () => {
    const openrouter = builtins().find((p) => p.kind === "openrouter")!;
    expect(openrouter).toMatchObject({ name: "OpenRouter", id: "openrouter" });
    expect(publishedRates(openrouter, "openai/gpt-4.1")).toEqual({
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 8,
    });
    expect(publishedRates(openrouter, "anthropic/claude-sonnet-4.5")).toEqual({
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
    });
  });
});

describe("resolveUsageRates", () => {
  it("prefers Settings overrides over published rates", () => {
    const openai = {
      ...builtins().find((p) => p.kind === "openai")!,
      inputUsdPerMillion: 9,
      outputUsdPerMillion: 11,
    };
    expect(resolveUsageRates(openai, "gpt-4.1")).toEqual({
      inputUsdPerMillion: 9,
      outputUsdPerMillion: 11,
    });
  });

  it("falls back to published rates when Settings fields are empty", () => {
    const openai = builtins().find((p) => p.kind === "openai")!;
    expect(resolveUsageRates(openai, "o4-mini")).toEqual({
      inputUsdPerMillion: 1.1,
      outputUsdPerMillion: 4.4,
    });
  });
});

describe("projectedModelCosts", () => {
  it("lists the selected model on every provider that offers it", () => {
    const rows = projectedModelCosts(builtins(), "openai", "gpt-4.1");
    expect(rows[0]).toMatchObject({ providerName: "OpenAI", current: true, model: "gpt-4.1" });
    const openrouter = rows.find((row) => row.providerName === "OpenRouter");
    expect(openrouter).toMatchObject({
      model: "openai/gpt-4.1",
      source: "published",
      rates: { inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
    });
    expect(rows.some((row) => row.providerName === "Anthropic")).toBe(false);
  });

  it("includes Cursor Cloud for Claude even when list prices are unpublished", () => {
    const rows = projectedModelCosts(builtins(), "anthropic", "claude-sonnet-4-5");
    expect(rows.map((row) => row.providerName)).toEqual(
      expect.arrayContaining(["Anthropic", "OpenRouter", "Cursor Cloud"]),
    );
    expect(rows.find((row) => row.providerName === "Cursor Cloud")?.source).toBe("unknown");
    expect(rows.find((row) => row.providerName === "Anthropic")?.rates).toEqual({
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
    });
  });
});

describe("formatRatePair", () => {
  it("formats compact $/1M pairs", () => {
    expect(formatUsdPerMillion(2)).toBe("$2");
    expect(formatUsdPerMillion(0.4)).toBe("$0.40");
    expect(formatUsdPerMillion(0.435)).toBe("$0.435");
    expect(formatRatePair({ inputUsdPerMillion: 2, outputUsdPerMillion: 8 })).toBe(
      "$2 in · $8 out /1M",
    );
    expect(formatRatePair()).toBeUndefined();
  });
});

describe("automationRunUsd", () => {
  it("keeps a stamped spend and otherwise estimates from usage", () => {
    const provider = builtins().find((row) => row.kind === "openai");
    expect(
      automationRunUsd({
        spendUsd: 1.25,
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
        provider,
        model: "gpt-4.1",
      }),
    ).toBe(1.25);
    expect(
      automationRunUsd({
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
        provider,
        model: "gpt-4.1",
      }),
    ).toBe(2);
    expect(automationRunUsd({})).toBeUndefined();
  });
});
