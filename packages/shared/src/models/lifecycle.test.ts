import { describe, expect, it } from "vitest";
import {
  modelFamily,
  modelIdLooksPinned,
  modelPromptVariant,
  probeModelCapabilities,
} from "./lifecycle.js";

describe("model lifecycle", () => {
  it("classifies families and pins exact ids", () => {
    expect(modelFamily("claude-sonnet-4-5")).toBe("anthropic");
    expect(modelFamily("gpt-4.1")).toBe("openai");
    expect(modelFamily("o4-mini")).toBe("openai");
    expect(modelFamily("grok-4")).toBe("xai");
    expect(modelFamily("gemini-2.5-flash")).toBe("google");
    expect(modelFamily("llama3.2")).toBe("local");
    expect(modelIdLooksPinned("claude-sonnet-4-5")).toBe(true);
    expect(modelIdLooksPinned("gpt-4.1-latest")).toBe(false);
  });

  it("probes capabilities without a network call", () => {
    expect(probeModelCapabilities("claude-sonnet-4-5")).toMatchObject({
      family: "anthropic",
      tools: true,
      vision: true,
      promptCache: true,
    });
    expect(probeModelCapabilities("o3-mini").reasoning).toBe(true);
    expect(probeModelCapabilities("x-preview-f-free").reasoning).toBe(true);
    expect(probeModelCapabilities("llama3.2").promptCache).toBe(false);
  });

  it("keeps per-family system prompt variants", () => {
    expect(modelPromptVariant("claude-sonnet-4-5")).toContain("Claude");
    expect(modelPromptVariant("gpt-4.1")).toContain("tool schemas");
    expect(modelPromptVariant("grok-4")).toContain("untrusted-data");
    expect(modelPromptVariant("llama3.2")).toContain("summarize");
    expect(modelPromptVariant("x-preview-f-free")).toContain("Call a tool");
    expect(modelPromptVariant("x-preview-f-free")).toContain("apply_patch");
    expect(modelPromptVariant("unknown-model")).toBe("");
  });
});
