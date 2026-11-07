import { describe, expect, it } from "vitest";
import {
  buildContextBreakdown,
  calibrateCharsPerToken,
  contextBudget,
  contextFillLevel,
  collectPromptContextParts,
  contextSnapshot,
  DEFAULT_CHARS_PER_TOKEN,
  DEFAULT_CONTEXT_WINDOW,
  formatTokenCount,
  formatContextPercent,
  formatContextUsage,
  modelContextWindow,
  reservedOutputTokens,
  occupancyFromCursorCliUsage,
  scalePartsToUsed,
} from "./contextWindow.js";

describe("context windows and token calibration", () => {
  it("calibrates chars per token toward reported usage", () => {
    expect(calibrateCharsPerToken(0, 100)).toBe(DEFAULT_CHARS_PER_TOKEN);
    expect(calibrateCharsPerToken(8000, 0)).toBe(DEFAULT_CHARS_PER_TOKEN);
    expect(calibrateCharsPerToken(16_000, 1_000)).toBeCloseTo(7.6);
    expect(calibrateCharsPerToken(16_000, 1_000, 7.6)).toBeGreaterThan(7.6);
    expect(calibrateCharsPerToken(100, 10_000, 1.5)).toBe(1.5);
    expect(calibrateCharsPerToken(10_000, 100, 16)).toBe(16);
  });

  it("looks up per-model windows and reserved output", () => {
    expect(modelContextWindow("gpt-4.1")).toBe(1_047_576);
    expect(modelContextWindow("claude-sonnet-4-5")).toBe(200_000);
    expect(modelContextWindow("grok-4")).toBe(256_000);
    expect(modelContextWindow("gemini-2.5-pro")).toBe(1_048_576);
    expect(modelContextWindow("x-preview-f-free", "opencode")).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(modelContextWindow("mystery-model")).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(reservedOutputTokens("claude-sonnet-4-5", { kind: "anthropic" })).toBe(4096);
    expect(
      reservedOutputTokens("x-preview-f-free", {
        kind: "opencode",
        baseUrl: "https://opencode.ai/zen/v1",
      }),
    ).toBe(32_768);
    expect(
      reservedOutputTokens("openai/gpt-4.1", {
        kind: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
      }),
    ).toBe(32_768);
    expect(
      reservedOutputTokens("openai/gpt-4.1", {
        kind: "openai-compatible",
        baseUrl: "https://openrouter.ai/api/v1",
      }),
    ).toBe(32_768);
    expect(
      reservedOutputTokens("llama3.2", {
        kind: "openai-compatible",
        baseUrl: "http://127.0.0.1:11434/v1",
      }),
    ).toBe(0);
    expect(contextBudget({ window: 128_000, reservedOutput: 32_768 })).toBe(
      128_000 - 32_768 - Math.floor(128_000 * 0.1),
    );
  });

  it("builds a breakdown and scales parts to measured usage", () => {
    const breakdown = buildContextBreakdown({
      window: 128_000,
      reserved: 32_768,
      charsPerToken: 4,
      measuredUsed: 10_000,
      parts: [
        { id: "system", label: "System", chars: 8_000 },
        { id: "messages", label: "Messages", chars: 32_000 },
      ],
    });
    expect(breakdown.measured).toBe(true);
    expect(breakdown.used).toBe(10_000);
    expect(breakdown.parts.find((part) => part.id === "system")?.tokens).toBe(2_000);
    expect(breakdown.parts.find((part) => part.id === "messages")?.tokens).toBe(8_000);
    expect(breakdown.parts.find((part) => part.id === "reserved")?.tokens).toBe(32_768);
    expect(scalePartsToUsed([{ id: "a", label: "A", tokens: 3 }], 10)[0]?.tokens).toBe(10);
    expect(formatTokenCount(12_400)).toBe("12.4k");
    expect(formatTokenCount(128_000)).toBe("128k");
    expect(formatTokenCount(1_047_576)).toBe("1M");
    expect(formatContextPercent(12_400, 128_000)).toBe("10%");
    expect(formatContextUsage(12_400, 128_000, { measured: true })).toBe("12.4k / 128k");
    expect(formatContextUsage(12_400, 128_000)).toBe("~12.4k / 128k");
    expect(contextFillLevel(12_000, 128_000)).toBe("ok");
    expect(contextFillLevel(100_000, 128_000)).toBe("warn");
    expect(contextFillLevel(120_000, 128_000)).toBe("hot");
    const split = collectPromptContextParts({
      systemChars: 10_000,
      toolsChars: 4_000,
      rulesChars: 500,
      skillsChars: 1_000,
      mcpChars: 800,
      repoChars: 2_000,
      conversationChars: 3_000,
    });
    expect(split.find((part) => part.id === "system")?.chars).toBe(3_700);
    expect(split.find((part) => part.id === "tools")?.label).toBe("Tools");
    expect(split.find((part) => part.id === "conversation")?.label).toBe("Conversation");
    expect(contextSnapshot({ model: "grok-4" }).window).toBe(256_000);
    expect(contextSnapshot({ model: "grok-4", context: breakdown }).used).toBe(10_000);
    expect(
      buildContextBreakdown({
        window: 100_000,
        reserved: 0,
        measuredUsed: 8_000,
        cachedInputTokens: 2_400,
        parts: [{ id: "conversation", label: "Conversation", chars: 8_000 }],
      }).cachedInputTokens,
    ).toBe(2_400);
  });

  it("caps occupancy at the model window", () => {
    const over = buildContextBreakdown({
      window: 256_000,
      reserved: 0,
      measuredUsed: 275_312,
      cachedInputTokens: 636_000,
      parts: [{ id: "conversation", label: "Conversation", chars: 275_312 * 4 }],
    });
    expect(over.used).toBe(256_000);
    expect(over.window).toBe(256_000);
    expect(over.cachedInputTokens).toBe(256_000);
    expect(over.parts.find((part) => part.id === "conversation")?.tokens).toBe(256_000);
    expect(formatContextPercent(over.used, over.window)).toBe("100%");
    expect(formatContextUsage(over.used, over.window, { measured: true })).toBe("256k / 256k");

    const persisted = contextSnapshot({
      model: "cursor-grok-4.6",
      context: {
        window: 256_000,
        used: 275_312,
        reserved: 0,
        charsPerToken: 4,
        measured: true,
        cachedInputTokens: 636_000,
        parts: [{ id: "conversation", label: "Conversation", tokens: 275_312 }],
      },
    });
    expect(persisted.used).toBe(256_000);
    expect(persisted.cachedInputTokens).toBe(256_000);
    expect(persisted.parts.find((part) => part.id === "conversation")?.tokens).toBe(256_000);
  });

  it("treats Cursor CLI billing totals as window occupancy", () => {
    expect(
      occupancyFromCursorCliUsage({
        inputTokens: 20_000,
        cachedInputTokens: 10_624,
        window: 200_000,
      }),
    ).toEqual({ used: 30_624, cachedInputTokens: 10_624 });
    expect(
      occupancyFromCursorCliUsage({
        inputTokens: 7,
        cachedInputTokens: 147_695,
        cacheWriteTokens: 39_331,
        window: 200_000,
      }),
    ).toEqual({ used: 187_033, cachedInputTokens: 147_695 });
    expect(
      occupancyFromCursorCliUsage({
        inputTokens: 275_312,
        cachedInputTokens: 636_000,
        window: 256_000,
      }),
    ).toEqual({ used: 256_000, cachedInputTokens: 256_000 });
    expect(occupancyFromCursorCliUsage({ inputTokens: 12_400, window: 200_000 })).toEqual({
      used: 12_400,
    });
  });
});
