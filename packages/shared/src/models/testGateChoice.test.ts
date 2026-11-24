import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEST_GATE_PROMPT_MS,
  DEFAULT_TEST_GATE_SLOW_MS,
  formatTestGateDuration,
  parseTestGateAnswer,
  shouldPromptTestGate,
  testGateAnswer,
  testGatePromptMs,
  testGateSkipRequest,
  testGateSlowMs,
} from "./testGateChoice.js";

describe("test gate choice", () => {
  it("round-trips choices through approval answers and ignores other answers", () => {
    expect(parseTestGateAnswer(testGateAnswer("skip"))).toBe("skip");
    expect(parseTestGateAnswer(testGateAnswer("defer"))).toBe("defer");
    expect(parseTestGateAnswer(testGateAnswer("run"))).toBe("run");
    expect(parseTestGateAnswer(undefined)).toBeUndefined();
    expect(parseTestGateAnswer("edited slack text")).toBeUndefined();
    expect(parseTestGateAnswer("test-gate:bogus")).toBeUndefined();
  });

  it("reads the agent's skip request", () => {
    expect(testGateSkipRequest({})).toEqual({ requested: false });
    expect(testGateSkipRequest({ skipTestsReason: "no" })).toEqual({ requested: false });
    expect(testGateSkipRequest({ skipTests: true, skipTestsReason: "  user said skip " })).toEqual({
      requested: true,
      reason: "user said skip",
    });
  });

  it("prompts when the agent asks to skip or the suite is slow", () => {
    const slowMs = DEFAULT_TEST_GATE_SLOW_MS;
    expect(shouldPromptTestGate({ slowMs, skipRequested: true })).toBe(true);
    expect(shouldPromptTestGate({ slowMs, skipRequested: false })).toBe(false);
    expect(shouldPromptTestGate({ slowMs, skipRequested: false, lastDurationMs: 60_000 })).toBe(
      false,
    );
    expect(
      shouldPromptTestGate({ slowMs, skipRequested: false, lastDurationMs: 45 * 60_000 }),
    ).toBe(true);
    expect(
      shouldPromptTestGate({ slowMs, skipRequested: false, configuredTimeoutMs: 2 * 3600_000 }),
    ).toBe(true);
    expect(
      shouldPromptTestGate({ slowMs: 0, skipRequested: false, lastDurationMs: 3600_000 }),
    ).toBe(false);
  });

  it("clamps config values", () => {
    expect(testGatePromptMs()).toBe(DEFAULT_TEST_GATE_PROMPT_MS);
    expect(testGatePromptMs(1_000)).toBe(DEFAULT_TEST_GATE_PROMPT_MS);
    expect(testGatePromptMs(60_000)).toBe(60_000);
    expect(testGatePromptMs(10 * 3600_000)).toBe(30 * 60_000);
    expect(testGateSlowMs()).toBe(DEFAULT_TEST_GATE_SLOW_MS);
    expect(testGateSlowMs(0)).toBe(0);
    expect(testGateSlowMs(120_000)).toBe(120_000);
  });

  it("formats estimates", () => {
    expect(formatTestGateDuration(undefined)).toBeUndefined();
    expect(formatTestGateDuration(20_000)).toBe("~20 s");
    expect(formatTestGateDuration(45 * 60_000)).toBe("~45 min");
    expect(formatTestGateDuration(3 * 3600_000)).toBe("~3.0 h");
  });
});
