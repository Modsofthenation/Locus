import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HOST_TERM_SPLIT_DEFAULT,
  TERM_COLLAPSED_ROWS,
  TERM_GUTTER_PX,
  TERM_SPLIT_MAX,
  TERM_SPLIT_MIN,
  TERM_TAB_ROW_PX,
  clampTermSplit,
  expandedTermPx,
  termSplitRows,
} from "./TermSplit";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

describe("termSplitRows", () => {
  it("keeps a zero-height gutter when the terminal is collapsed", () => {
    expect(termSplitRows(HOST_TERM_SPLIT_DEFAULT, true)).toBe(TERM_COLLAPSED_ROWS);
  });

  it("sizes the terminal row from the stored fraction", () => {
    expect(termSplitRows(0.4, false)).toBe(
      `minmax(80px, 0.6fr) ${TERM_GUTTER_PX}px minmax(120px, 0.4fr)`,
    );
  });

  it("animates collapse and expand by changing only gutter and terminal pixels", () => {
    expect(TERM_COLLAPSED_ROWS).toBe(`minmax(0, 1fr) 0px ${TERM_TAB_ROW_PX}px`);
    expect(expandedTermPx(1000, 0.32)).toBe(318);
    expect(termSplitRows(0.32, true, 1000)).toBe(TERM_COLLAPSED_ROWS);
    expect(termSplitRows(0.32, false, 1000)).toBe(`minmax(0, 1fr) ${TERM_GUTTER_PX}px 318px`);
  });
});

describe("clampTermSplit", () => {
  it("clamps and rounds to two decimals", () => {
    expect(clampTermSplit(Number.NaN, HOST_TERM_SPLIT_DEFAULT)).toBe(HOST_TERM_SPLIT_DEFAULT);
    expect(clampTermSplit(0.01, HOST_TERM_SPLIT_DEFAULT)).toBe(TERM_SPLIT_MIN);
    expect(clampTermSplit(0.99, HOST_TERM_SPLIT_DEFAULT)).toBe(TERM_SPLIT_MAX);
    expect(clampTermSplit(0.456, HOST_TERM_SPLIT_DEFAULT)).toBe(0.46);
  });
});

describe("terminal gutter CSS", () => {
  it("marks the gutter as a horizontal resize handle like the right-panel split", () => {
    expect(css).toMatch(/\.term-gutter \{[\s\S]*?cursor:\s*row-resize/);
    expect(css).toMatch(
      /\.host-workspace \.docker-desktop\.has-term\.term-resizing \{[\s\S]*?cursor:\s*row-resize/,
    );
    expect(css).toMatch(
      /\.host-workspace \.docker-desktop\.has-term\.term-resizing iframe \{[\s\S]*?pointer-events:\s*none/,
    );
    expect(css).toMatch(
      /\.host-workspace \.docker-desktop\.has-term \{[\s\S]*?transition:\s*grid-template-rows var\(--dur-slow\)/,
    );
    expect(css).toMatch(/\.term-tabs \{[\s\S]*?cursor:\s*row-resize/);
    expect(css).toMatch(/\.term-tabs button \{[\s\S]*?cursor:\s*pointer/);
    expect(css).toMatch(/\.docker-term-split\.term-resizing \{[\s\S]*?cursor:\s*row-resize/);
    expect(css).toMatch(/\.docker-term-split > \.term \{[\s\S]*?min-height:\s*0/);
    expect(css).toMatch(
      new RegExp(`\\.docker-term \\.term-tabs \\{[\\s\\S]*?min-height:\\s*${TERM_TAB_ROW_PX}px`),
    );
  });
});
