import { describe, expect, it } from "vitest";
import { clampSplit, stepSplitValue } from "./splitter";

describe("splitter", () => {
  it("steps a vertical list width with arrows and Home/End", () => {
    expect(
      stepSplitValue({
        key: "ArrowLeft",
        value: 340,
        min: 240,
        max: 560,
        axis: "vertical",
        step: 16,
      }),
    ).toBe(324);
    expect(
      stepSplitValue({
        key: "ArrowRight",
        shift: true,
        value: 340,
        min: 240,
        max: 560,
        axis: "vertical",
        step: 16,
      }),
    ).toBe(404);
    expect(stepSplitValue({ key: "Home", value: 340, min: 240, max: 560, axis: "vertical" })).toBe(
      240,
    );
    expect(stepSplitValue({ key: "End", value: 340, min: 240, max: 560, axis: "vertical" })).toBe(
      560,
    );
    expect(
      stepSplitValue({ key: "Enter", value: 340, min: 240, max: 560, axis: "vertical" }),
    ).toBeNull();
  });

  it("clamps non-finite values", () => {
    expect(clampSplit(Number.NaN, 10, 20)).toBe(10);
    expect(clampSplit(99, 10, 20)).toBe(20);
  });
});
