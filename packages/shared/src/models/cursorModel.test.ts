import { describe, expect, it } from "vitest";
import { CURSOR_CLI_BASE_URL } from "./provider.js";
import {
  cursorModelCapabilities,
  cursorModelPickerIds,
  cursorModelSelectValue,
  cursorModelSupportsFast,
  formatCursorModelId,
  normalizeCursorModelId,
  parseCursorModelId,
  providerKnowsModel,
  retargetCursorModel,
  usesCursorModelIds,
} from "./cursorModel.js";

describe("cursor model ids", () => {
  it("parses Fast and thinking suffixes", () => {
    expect(parseCursorModelId("composer-2")).toEqual({
      base: "composer-2",
      fast: false,
      thinking: "off",
    });
    expect(parseCursorModelId("composer-2-fast")).toEqual({
      base: "composer-2",
      fast: true,
      thinking: "off",
    });
    expect(parseCursorModelId("composer-2.5-fast")).toEqual({
      base: "composer-2.5",
      fast: true,
      thinking: "off",
    });
    expect(parseCursorModelId("gpt-5.2")).toEqual({
      base: "gpt-5.2",
      fast: false,
      thinking: "medium",
    });
    expect(parseCursorModelId("gpt-5.2-fast")).toEqual({
      base: "gpt-5.2",
      fast: true,
      thinking: "medium",
    });
    expect(parseCursorModelId("gpt-5.2-high-fast")).toEqual({
      base: "gpt-5.2",
      fast: true,
      thinking: "high",
    });
    expect(parseCursorModelId("gpt-5.4-medium-fast")).toEqual({
      base: "gpt-5.4",
      fast: true,
      thinking: "medium",
    });
    expect(parseCursorModelId("gpt-5.4-mini-none")).toEqual({
      base: "gpt-5.4-mini",
      fast: false,
      thinking: "none",
    });
    expect(parseCursorModelId("gpt-5.1-codex-max-xhigh-fast")).toEqual({
      base: "gpt-5.1-codex-max",
      fast: true,
      thinking: "xhigh",
    });
    expect(parseCursorModelId("gpt-5.5-extra-high")).toEqual({
      base: "gpt-5.5",
      fast: false,
      thinking: "xhigh",
    });
    expect(parseCursorModelId("claude-opus-4-8-thinking-high")).toEqual({
      base: "claude-opus-4-8",
      fast: false,
      thinking: "high",
    });
    expect(parseCursorModelId("claude-4.5-sonnet-thinking")).toEqual({
      base: "claude-4.5-sonnet",
      fast: false,
      thinking: "thinking",
    });
    expect(parseCursorModelId("sonnet-4-thinking")).toEqual({
      base: "sonnet-4",
      fast: false,
      thinking: "thinking",
    });
    expect(parseCursorModelId("grok-4-20-thinking")).toEqual({
      base: "grok-4-20",
      fast: false,
      thinking: "thinking",
    });
    expect(parseCursorModelId("cursor-grok-4.6")).toEqual({
      base: "cursor-grok-4.6",
      fast: false,
      thinking: "high",
    });
    expect(parseCursorModelId("cursor-grok-4.6-high-fast")).toEqual({
      base: "cursor-grok-4.6",
      fast: true,
      thinking: "high",
    });
    expect(parseCursorModelId("cursor-grok-4.5-medium")).toEqual({
      base: "cursor-grok-4.5",
      fast: false,
      thinking: "medium",
    });
    expect(parseCursorModelId("auto")).toEqual({ base: "auto", fast: false, thinking: "off" });
  });

  it("round-trips composed slugs", () => {
    for (const id of [
      "composer-2",
      "composer-2-fast",
      "gpt-5.2",
      "gpt-5.2-fast",
      "gpt-5.2-high-fast",
      "gpt-5.4-medium",
      "gpt-5.4-medium-fast",
      "gpt-5.4-mini-none",
      "gpt-5.1-codex-max-xhigh-fast",
      "claude-sonnet-4-5",
      "claude-sonnet-4-5-thinking",
      "claude-opus-4-8-thinking-high",
      "grok-4-20",
      "grok-4-20-thinking",
      "cursor-grok-4.6-high",
      "cursor-grok-4.6-high-fast",
      "cursor-grok-4.6-low",
      "cursor-grok-4.5-medium-fast",
      "auto",
    ]) {
      expect(formatCursorModelId(parseCursorModelId(id))).toBe(id);
    }
  });

  it("normalizes extra-high to the xhigh slug", () => {
    expect(formatCursorModelId({ base: "gpt-5.5", thinking: "xhigh" })).toBe("gpt-5.5-xhigh");
  });

  it("requires an effort suffix for Cursor Grok 4.6", () => {
    expect(formatCursorModelId({ base: "cursor-grok-4.6" })).toBe("cursor-grok-4.6-high");
    expect(formatCursorModelId({ base: "cursor-grok-4.6", thinking: "off" })).toBe(
      "cursor-grok-4.6-high",
    );
    expect(formatCursorModelId({ base: "cursor-grok-4.6", thinking: "thinking" })).toBe(
      "cursor-grok-4.6-high",
    );
    expect(formatCursorModelId({ base: "cursor-grok-4.6", thinking: "low", fast: true })).toBe(
      "cursor-grok-4.6-low-fast",
    );
    expect(formatCursorModelId({ base: "cursor-grok-4.6", thinking: "xhigh" })).toBe(
      "cursor-grok-4.6-xhigh",
    );
    expect(formatCursorModelId({ base: "cursor-grok-4.5", thinking: "xhigh" })).toBe(
      "cursor-grok-4.5-high",
    );
    expect(normalizeCursorModelId("cursor-grok-4.6")).toBe("cursor-grok-4.6-high");
    expect(normalizeCursorModelId("cursor-grok-4.6-high-fast")).toBe("cursor-grok-4.6-high-fast");
    for (const id of [
      "cursor-grok-4.6-low",
      "cursor-grok-4.6-low-fast",
      "cursor-grok-4.6-medium",
      "cursor-grok-4.6-medium-fast",
      "cursor-grok-4.6-high",
      "cursor-grok-4.6-high-fast",
      "cursor-grok-4.6-xhigh",
      "cursor-grok-4.6-xhigh-fast",
    ]) {
      expect(normalizeCursorModelId(id)).toBe(id);
    }
  });

  it("exposes Fast and thinking only for relevant families", () => {
    expect(cursorModelSupportsFast("composer-2")).toBe(true);
    expect(cursorModelSupportsFast("composer-1.5")).toBe(false);
    expect(cursorModelSupportsFast("gpt-5")).toBe(true);
    expect(cursorModelSupportsFast("gpt-5.2")).toBe(true);
    expect(cursorModelSupportsFast("gpt-5.1")).toBe(false);
    expect(cursorModelSupportsFast("gpt-5.1-codex-max")).toBe(true);
    expect(cursorModelSupportsFast("gpt-5.4-mini")).toBe(false);
    expect(cursorModelSupportsFast("claude-sonnet-4-5")).toBe(false);
    expect(cursorModelSupportsFast("cursor-grok-4.6")).toBe(true);
    expect(cursorModelSupportsFast("cursor-grok-4.5-high")).toBe(true);
    expect(cursorModelSupportsFast("grok-4-20")).toBe(false);
    expect(cursorModelSupportsFast("auto")).toBe(false);

    expect(cursorModelCapabilities("composer-2").thinkingLevels).toEqual([]);
    expect(
      cursorModelCapabilities("claude-sonnet-4-5").thinkingLevels.map((row) => row.value),
    ).toEqual(["off", "thinking", "high"]);
    expect(cursorModelCapabilities("grok-4-20").thinkingLevels.map((row) => row.value)).toEqual([
      "off",
      "thinking",
    ]);
    expect(
      cursorModelCapabilities("cursor-grok-4.6").thinkingLevels.map((row) => row.value),
    ).toEqual(["low", "medium", "high", "xhigh"]);
    expect(
      cursorModelCapabilities("cursor-grok-4.5").thinkingLevels.map((row) => row.value),
    ).toEqual(["low", "medium", "high"]);
    expect(cursorModelCapabilities("cursor-grok-4.6").defaultThinking).toBe("high");
    expect(cursorModelCapabilities("gpt-5").thinkingLevels.map((row) => row.value)).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(cursorModelCapabilities("gpt-5-mini").thinkingLevels).toEqual([]);
    expect(cursorModelCapabilities("auto").thinkingLevels).toEqual([]);
  });

  it("folds Fast and thinking variants into picker bases", () => {
    expect(
      cursorModelPickerIds([
        "composer-2-fast",
        "composer-2",
        "gpt-5.2-high-fast",
        "gpt-5.2",
        "auto",
      ]),
    ).toEqual(["composer-2", "gpt-5.2", "auto"]);
    expect(
      cursorModelPickerIds([
        "cursor-grok-4.6-high-fast",
        "cursor-grok-4.6-low",
        "cursor-grok-4.6-medium",
        "auto",
      ]),
    ).toEqual(["cursor-grok-4.6", "auto"]);
    expect(cursorModelSelectValue(["composer-2", "auto"], "composer-2-fast")).toBe("composer-2");
  });

  it("keeps Fast when switching to another Fast model", () => {
    expect(retargetCursorModel("composer-2-fast", "gpt-5.2")).toBe("gpt-5.2-fast");
    expect(retargetCursorModel("gpt-5.2-high-fast", "gpt-5.4")).toBe("gpt-5.4-high-fast");
    expect(retargetCursorModel("composer-2-fast", "claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
    expect(retargetCursorModel("gpt-5.2-high", "claude-sonnet-4-5")).toBe(
      "claude-sonnet-4-5-thinking-high",
    );
    expect(retargetCursorModel("claude-sonnet-4-5-thinking", "auto")).toBe("auto");
    expect(retargetCursorModel("composer-2", "cursor-grok-4.6")).toBe("cursor-grok-4.6-high");
    expect(retargetCursorModel("composer-2-fast", "cursor-grok-4.6")).toBe(
      "cursor-grok-4.6-high-fast",
    );
    expect(retargetCursorModel("gpt-5.2-low", "cursor-grok-4.6")).toBe("cursor-grok-4.6-low");
    expect(retargetCursorModel("cursor-grok-4.6-xhigh-fast", "cursor-grok-4.5")).toBe(
      "cursor-grok-4.5-high-fast",
    );
  });

  it("treats Cursor variant slugs as known when the base is listed", () => {
    const provider = {
      kind: "cursor-cli" as const,
      baseUrl: CURSOR_CLI_BASE_URL,
      models: ["composer-2", "auto", "claude-sonnet-4-5", "gpt-5"],
      defaultModel: "composer-2",
    };
    expect(usesCursorModelIds(provider)).toBe(true);
    expect(usesCursorModelIds({ kind: "openai", baseUrl: "https://api.openai.com/v1" })).toBe(
      false,
    );
    expect(providerKnowsModel(provider, "composer-2-fast")).toBe(true);
    expect(providerKnowsModel(provider, "gpt-5-high")).toBe(true);
    expect(providerKnowsModel(provider, "mystery")).toBe(false);
    expect(
      providerKnowsModel(
        { ...provider, kind: "openai", baseUrl: "https://api.openai.com/v1" },
        "composer-2-fast",
      ),
    ).toBe(false);
  });
});
