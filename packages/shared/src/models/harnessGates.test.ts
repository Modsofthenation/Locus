import { describe, expect, it } from "vitest";
import { harnessGateBypassed, parseHarnessGates } from "./harnessGates.js";

describe("parseHarnessGates", () => {
  it("dedupes known gates and maps empty input to undefined", () => {
    expect(parseHarnessGates(["test-gate", " test-gate ", "force-push"])).toEqual([
      "test-gate",
      "force-push",
    ]);
    expect(parseHarnessGates([])).toBeUndefined();
    expect(parseHarnessGates(null)).toBeUndefined();
    expect(parseHarnessGates(undefined)).toBeUndefined();
  });

  it("rejects unknown ids so a typo never leaves a gate silently on", () => {
    expect(() => parseHarnessGates(["test_gate"])).toThrow(/Unknown harness gate/);
    expect(() => parseHarnessGates("test-gate")).toThrow(/array/);
  });

  it("reports whether a gate is bypassed", () => {
    expect(harnessGateBypassed(["test-gate"], "test-gate")).toBe(true);
    expect(harnessGateBypassed(undefined, "test-gate")).toBe(false);
  });
});
