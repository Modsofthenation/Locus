import { describe, expect, it } from "vitest";
import type { PatchHunk } from "@locus/shared";
import {
  diffLineRef,
  fileRowCount,
  limitPatchHunks,
  PATCH_VISIBLE_ROW_BUDGET,
  renderPatchHunkHtml,
} from "./patchDiffHtml";

const hunk: PatchHunk = {
  oldStart: 4,
  newStart: 4,
  oldLines: ["old"],
  newLines: ["new"],
  rows: [
    { kind: "del", text: "const old = 1" },
    { kind: "add", text: "const next = 2" },
  ],
};

describe("patchDiffHtml", () => {
  it("numbers add/del sides and paints a hunk as one HTML blob", () => {
    expect(diffLineRef("src/app.ts", { kind: "del", text: "old", oldLine: 4 })).toEqual({
      path: "src/app.ts",
      line: 4,
      side: "LEFT",
    });
    expect(diffLineRef("src/app.ts", { kind: "add", text: "new", newLine: 4 })).toEqual({
      path: "src/app.ts",
      line: 4,
      side: "RIGHT",
    });
    const html = renderPatchHunkHtml(hunk, "ts", true);
    expect(html).toContain('class="patch-line del clickable"');
    expect(html).toContain('data-line="4" data-side="LEFT"');
    expect(html).toContain('data-line="4" data-side="RIGHT"');
    expect(html).toContain('<span class="tok-kw">const</span>');
    expect(html).toContain('<span class="tok-num">2</span>');
    expect(html.startsWith("<button")).toBe(true);
  });

  it("caps visible hunk rows and counts the rest as hidden", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ kind: "add" as const, text: `n${i}` }));
    const hunks = [{ rows: rows.slice(0, 6) }, { rows: rows.slice(6) }];
    expect(fileRowCount({ hunks })).toBe(10);
    const limited = limitPatchHunks(hunks, 7);
    expect(limited.hunks).toHaveLength(2);
    expect(limited.hunks[0]?.rows).toHaveLength(6);
    expect(limited.hunks[1]?.rows).toHaveLength(1);
    expect(limited.hidden).toBe(3);
    expect(limitPatchHunks(hunks, PATCH_VISIBLE_ROW_BUDGET).hidden).toBe(0);
  });
});
