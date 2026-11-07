import { describe, expect, it } from "vitest";
import {
  EDITOR_LINE_PX,
  EDITOR_PAD_PX,
  EDITOR_VIEW_FALLBACK,
  diagsInView,
  editorScrollHeight,
  editorViewRange,
  lineOffsetInView,
  marksInView,
  overlayTranslateY,
  inlineAiAnchorTop,
  inlineAiSelectionRects,
  shouldUpdateEditorView,
  visualCount,
  wrapLineHeightsFromLines,
  wrapVisualAt,
} from "./editorView";

describe("editorViewRange", () => {
  it("falls back to a short window when the pane has no height", () => {
    expect(editorViewRange(0, 0, 4_000)).toEqual({ start: 1, end: EDITOR_VIEW_FALLBACK });
    expect(editorViewRange(0, 0, 10)).toEqual({ start: 1, end: 10 });
  });

  it("covers the viewport plus overscan", () => {
    const range = editorViewRange(240, 360, 2_000);
    expect(range.start).toBeLessThanOrEqual(14);
    expect(range.end).toBeGreaterThan(range.start);
    expect(range.end - range.start).toBeLessThan(80);
  });
});

describe("shouldUpdateEditorView", () => {
  it("keeps the painted window while scrolling inside the overscan", () => {
    const current = { start: 100, end: 220 };
    expect(shouldUpdateEditorView(current, { start: 116, end: 204 })).toBe(false);
    expect(shouldUpdateEditorView(current, { start: 100, end: 220 })).toBe(false);
  });

  it("reloads when the viewport nears the edge of the painted window", () => {
    const current = { start: 100, end: 220 };
    expect(shouldUpdateEditorView(current, { start: 90, end: 200 })).toBe(true);
    expect(shouldUpdateEditorView(current, { start: 110, end: 216 })).toBe(true);
  });
});

describe("editorScrollHeight", () => {
  it("matches padding plus line boxes", () => {
    expect(editorScrollHeight(1)).toBe(EDITOR_PAD_PX * 2 + EDITOR_LINE_PX);
    expect(editorScrollHeight(1_600)).toBe(EDITOR_PAD_PX * 2 + 1_600 * EDITOR_LINE_PX);
  });
});

describe("overlayTranslateY", () => {
  it("keeps line 1 at the padded origin when not scrolled", () => {
    expect(overlayTranslateY(1, 0)).toBe(0);
  });

  it("moves the painted window with the scroller", () => {
    expect(overlayTranslateY(1, 240)).toBe(-240);
    expect(overlayTranslateY(14, 240)).toBe(13 * EDITOR_LINE_PX - 240);
  });
});

describe("inline AI anchors", () => {
  it("sits just under the last selected line in the painted window", () => {
    expect(inlineAiAnchorTop(1, 1)).toBe(EDITOR_PAD_PX + EDITOR_LINE_PX + 4);
    expect(inlineAiAnchorTop(23, 19)).toBe(
      EDITOR_PAD_PX + (23 - 19) * EDITOR_LINE_PX + EDITOR_LINE_PX + 4,
    );
  });

  it("paints one rect per selected line in view", () => {
    const lines = ["const a = 1;", "const b = 2;", "const c = 3;"];
    const rects = inlineAiSelectionRects({
      startLine: 1,
      endLine: 2,
      startCol: 1,
      endCol: 8,
      viewStart: 1,
      viewEnd: 10,
      lineText: (line) => lines[line - 1] ?? "",
    });
    expect(rects).toHaveLength(2);
    expect(rects[0]?.top).toBe(EDITOR_PAD_PX);
    expect(rects[1]?.top).toBe(EDITOR_PAD_PX + EDITOR_LINE_PX);
    expect(rects[0]?.left).toBe(EDITOR_PAD_PX);
    expect(rects[1]?.width).toBeGreaterThan(0);
  });
});

describe("wrap metrics", () => {
  it("counts extra visual rows for long lines", () => {
    const heights = wrapLineHeightsFromLines(["hi", "abcdefghij"], 36, 12);
    expect(heights[0]).toBe(1);
    expect(heights[1]).toBeGreaterThan(1);
    expect(visualCount(heights)).toBe(heights[0]! + heights[1]!);
    expect(lineOffsetInView(2, 1, heights)).toBe(heights[0]! * EDITOR_LINE_PX);
    expect(editorScrollHeight(2, heights)).toBe(
      EDITOR_PAD_PX * 2 + visualCount(heights) * EDITOR_LINE_PX,
    );
  });

  it("maps a character on a wrapped line to its visual row", () => {
    expect(wrapVisualAt("abcdefghij", 0, 36, 12)).toEqual({ row: 0, col: 0 });
    expect(wrapVisualAt("abcdefghij", 3, 36, 12).row).toBe(1);
    expect(wrapVisualAt("abcdefghij", 3, 36, 12).col).toBe(0);
  });
});

describe("visible marks", () => {
  it("keeps only marks and diagnostics that intersect the window", () => {
    expect(
      marksInView(
        [
          { startLine: 2, lineCount: 3 },
          { startLine: 80, lineCount: 2 },
        ],
        1,
        10,
      ),
    ).toEqual([{ startLine: 2, lineCount: 3 }]);
    expect(diagsInView([{ startLine: 0 }, { startLine: 40 }], 1, 10)).toEqual([{ startLine: 0 }]);
  });
});
