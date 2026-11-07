import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { zoomAction, applyZoomLevel } = createRequire(import.meta.url)("./zoom.cjs") as {
  zoomAction: (input: {
    type?: string;
    alt?: boolean;
    control?: boolean;
    meta?: boolean;
    key?: string;
    code?: string;
  }) => "in" | "out" | "reset" | null;
  applyZoomLevel: (current: number, action: "in" | "out" | "reset" | null) => number;
};

describe("zoomAction", () => {
  it("zooms in on Ctrl/Cmd plus, equals, and numpad add", () => {
    expect(zoomAction({ type: "keyDown", control: true, key: "=", code: "Equal" })).toBe("in");
    expect(zoomAction({ type: "keyDown", control: true, key: "+", code: "Equal" })).toBe("in");
    expect(zoomAction({ type: "keyDown", meta: true, key: "+", code: "NumpadAdd" })).toBe("in");
  });

  it("zooms out on Ctrl minus", () => {
    expect(zoomAction({ type: "keyDown", control: true, key: "-", code: "Minus" })).toBe("out");
  });

  it("resets on Ctrl 0", () => {
    expect(zoomAction({ type: "keyDown", control: true, key: "0", code: "Digit0" })).toBe("reset");
  });

  it("ignores keys without a modifier and Alt combinations", () => {
    expect(zoomAction({ type: "keyDown", key: "=", code: "Equal" })).toBeNull();
    expect(
      zoomAction({ type: "keyDown", control: true, alt: true, key: "=", code: "Equal" }),
    ).toBeNull();
    expect(zoomAction({ type: "keyUp", control: true, key: "=", code: "Equal" })).toBeNull();
  });
});

describe("applyZoomLevel", () => {
  it("steps in, out, and reset within bounds", () => {
    expect(applyZoomLevel(0, "in")).toBe(0.5);
    expect(applyZoomLevel(0, "out")).toBe(-0.5);
    expect(applyZoomLevel(1, "reset")).toBe(0);
    expect(applyZoomLevel(5, "in")).toBe(5);
    expect(applyZoomLevel(-3, "out")).toBe(-3);
  });
});
