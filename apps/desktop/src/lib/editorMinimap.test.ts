import { describe, expect, it } from "vitest";
import {
  lineInk,
  minimapLineSpan,
  minimapScrollTop,
  minimapViewportRect,
  paintMinimap,
  shouldShowMinimap,
} from "./editorMinimap";

describe("editor minimap", () => {
  it("hides tiny or binary files", () => {
    expect(shouldShowMinimap({ lineCount: 80 })).toBe(true);
    expect(shouldShowMinimap({ lineCount: 12 })).toBe(false);
    expect(shouldShowMinimap({ lineCount: 200, binary: true })).toBe(false);
    expect(shouldShowMinimap({ lineCount: 200, enabled: false })).toBe(false);
  });

  it("maps a click to scroll and sizes the viewport window", () => {
    expect(minimapScrollTop(50, 100, 400, 100)).toBe(150);
    expect(minimapScrollTop(-4, 100, 400, 100)).toBe(0);
    expect(minimapScrollTop(200, 100, 400, 100)).toBe(300);
    const view = minimapViewportRect(150, 100, 400, 100);
    expect(view.h).toBeGreaterThanOrEqual(8);
    expect(view.y).toBeGreaterThan(0);
    expect(view.y + view.h).toBeLessThanOrEqual(100);
  });

  it("scores non-empty line ink", () => {
    expect(lineInk("")).toBe(0);
    expect(lineInk("    ")).toBe(0);
    expect(lineInk("export function foldOldTurns() {")).toBeGreaterThan(0.2);
  });

  it("spreads a short file across the full canvas, not a 1px-per-line strip at the top", () => {
    expect(minimapLineSpan(0, 175, 700)).toEqual({ y: 0, h: 4 });
    expect(minimapLineSpan(134, 175, 700).y).toBeGreaterThan(500);
    const last = minimapLineSpan(174, 175, 700);
    expect(last.y + last.h).toBe(700);

    const rects: Array<{ y: number; h: number }> = [];
    const ctx = {
      clearRect() {},
      fillRect(_x: number, y: number, _w: number, h: number) {
        rects.push({ y, h });
      },
      fillStyle: "",
    };
    const lines = Array.from({ length: 175 }, (_, i) =>
      i % 7 === 0 ? "" : `export const n${i} = ${i};`,
    );
    paintMinimap(ctx, {
      width: 64,
      height: 700,
      lines,
      scrollTop: 2412,
      clientHeight: 594,
      scrollHeight: 3162,
      ink: "#888",
      viewport: "rgba(255,255,255,0.14)",
    });
    const ink = rects.slice(0, -1);
    const view = rects[rects.length - 1]!;
    expect(Math.max(...ink.map((row) => row.y + row.h))).toBeGreaterThan(650);
    expect(view.y).toBeGreaterThan(400);
  });
});
