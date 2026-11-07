import { describe, expect, it } from "vitest";
import {
  LIST_ROW_FALLBACK,
  listIndexAtOffset,
  listPreserveScrollTop,
  listScrollHeight,
  listSizePrefix,
  listWindowFromSizes,
  listWindowRange,
  shouldUpdateListWindow,
} from "./listWindow";

describe("listWindowRange", () => {
  it("falls back to a short window when the pane has no height", () => {
    expect(listWindowRange({ scrollTop: 0, clientHeight: 0, rowCount: 4_000, rowPx: 24 })).toEqual({
      start: 0,
      end: LIST_ROW_FALLBACK,
      padTop: 0,
      padBottom: (4_000 - LIST_ROW_FALLBACK) * 24,
      height: 4_000 * 24,
    });
  });

  it("windows the tail when stickToEnd and the pane has no height", () => {
    const range = listWindowRange({
      scrollTop: 0,
      clientHeight: 0,
      rowCount: 200,
      rowPx: 140,
      stickToEnd: true,
    });
    expect(range.start).toBe(200 - LIST_ROW_FALLBACK);
    expect(range.end).toBe(200);
    expect(range.padBottom).toBe(0);
  });

  it("covers the viewport plus overscan", () => {
    const range = listWindowRange({
      scrollTop: 240,
      clientHeight: 360,
      rowCount: 2_000,
      rowPx: 24,
    });
    expect(range.start).toBeLessThanOrEqual(12);
    expect(range.end).toBeGreaterThan(range.start);
    expect(range.end - range.start).toBeLessThan(50);
    expect(range.padTop + (range.end - range.start) * 24 + range.padBottom).toBe(2_000 * 24);
  });

  it("keeps the tail painted when scrollTop overshoots the estimated height", () => {
    const range = listWindowRange({
      scrollTop: 80_000,
      clientHeight: 800,
      rowCount: 200,
      rowPx: 140,
    });
    expect(range.end).toBe(200);
    expect(range.start).toBeGreaterThan(0);
    expect(range.start).toBeLessThan(range.end);
    expect(range.padBottom).toBe(0);
  });

  it("windows the tail when stickToEnd even after layout", () => {
    const range = listWindowRange({
      scrollTop: 12,
      clientHeight: 800,
      rowCount: 200,
      rowPx: 140,
      stickToEnd: true,
    });
    expect(range.start).toBe(200 - LIST_ROW_FALLBACK);
    expect(range.end).toBe(200);
    expect(range.padBottom).toBe(0);
  });
});

describe("listWindowFromSizes", () => {
  it("maps scrollTop through measured row heights instead of a fixed guess", () => {
    const sizes = Array.from({ length: 40 }, (_, i) => (i < 20 ? 140 : 800));
    const offsets = listSizePrefix(sizes);
    const range = listWindowFromSizes({
      scrollTop: offsets[24]! + 10,
      clientHeight: 800,
      sizes,
    });
    expect(range.start).toBeLessThanOrEqual(24);
    expect(range.end).toBeGreaterThan(24);
    expect(range.padTop).toBe(offsets[range.start]);
    expect(range.padBottom).toBe(offsets[40]! - offsets[range.end]!);
    expect(range.height).toBe(offsets[40]);
  });

  it("keeps the tail painted when scrollTop overshoots a short estimated thread", () => {
    const sizes = Array.from({ length: 20 }, () => 140);
    const range = listWindowFromSizes({
      scrollTop: 20_000,
      clientHeight: 800,
      sizes,
    });
    expect(range.end).toBe(20);
    expect(range.start).toBeGreaterThan(0);
    expect(range.start).toBeLessThan(range.end);
    expect(range.padBottom).toBe(0);
  });

  it("windows the tail when stickToEnd after layout", () => {
    const sizes = Array.from({ length: 200 }, () => 140);
    const range = listWindowFromSizes({
      scrollTop: 0,
      clientHeight: 800,
      sizes,
      stickToEnd: true,
    });
    expect(range.start).toBe(200 - LIST_ROW_FALLBACK);
    expect(range.end).toBe(200);
  });
});

describe("listPreserveScrollTop", () => {
  it("shifts scrollTop by the growth of rows above the viewport", () => {
    const prev = listSizePrefix(Array.from({ length: 10 }, () => 140));
    const next = listSizePrefix([140, 140, 140, 2000, 140, 140, 140, 140, 140, 140]);
    expect(listIndexAtOffset(prev, 700)).toBe(5);
    expect(listPreserveScrollTop(prev, next, 700)).toBe(700 + (2000 - 140));
  });
});

describe("shouldUpdateListWindow", () => {
  it("keeps the painted window while scrolling inside the overscan", () => {
    const current = { start: 100, end: 220 };
    expect(shouldUpdateListWindow(current, { start: 116, end: 204 })).toBe(false);
    expect(shouldUpdateListWindow(current, { start: 100, end: 220 })).toBe(false);
  });

  it("reloads when the viewport nears the edge of the painted window", () => {
    const current = { start: 100, end: 220 };
    expect(shouldUpdateListWindow(current, { start: 90, end: 200 })).toBe(true);
    expect(shouldUpdateListWindow(current, { start: 110, end: 216 })).toBe(true);
  });
});

describe("listScrollHeight", () => {
  it("matches row boxes", () => {
    expect(listScrollHeight(0, 24)).toBe(0);
    expect(listScrollHeight(10, 28)).toBe(280);
  });
});
