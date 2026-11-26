import { describe, expect, it } from "vitest";
import {
  CRAFTED_THEME_SPECS,
  craftedTheme,
  craftedThemeWebFonts,
  craftedThemesCss,
  remixCraftedTheme,
} from "./craftedThemes.js";
import { customThemeContrastIssues, customThemeSwatches } from "./customTheme.js";
import { CRAFTED_THEME_IDS, THEME_OPTIONS, isThemeId, themeFamily } from "./theme.js";

describe("crafted themes", () => {
  it("are built-in themes with a spec, a Crafted card and matching swatches", () => {
    expect(CRAFTED_THEME_IDS.length).toBeGreaterThanOrEqual(16);
    expect(Object.keys(CRAFTED_THEME_SPECS).sort()).toEqual([...CRAFTED_THEME_IDS].sort());
    for (const id of CRAFTED_THEME_IDS) {
      expect(isThemeId(id)).toBe(true);
      const opt = THEME_OPTIONS.find((row) => row.id === id)!;
      const theme = craftedTheme(id)!;
      expect(opt.crafted).toBe(true);
      expect(themeFamily(opt)).toBe("crafted");
      expect(opt.name).toBe(theme.name);
      expect(opt.scheme).toBe(theme.scheme);
      expect(opt.style).toBe(theme.base);
      expect(opt.swatches).toEqual(customThemeSwatches(theme));
    }
  });

  it("pass the engine's readability checks", () => {
    for (const id of CRAFTED_THEME_IDS) {
      expect(customThemeContrastIssues(craftedTheme(id)!.colors), id).toEqual([]);
    }
  });

  it("each use a part of the engine the hand-written themes cannot", () => {
    const uses = (id: (typeof CRAFTED_THEME_IDS)[number]) => {
      const t = craftedTheme(id)!;
      return [
        t.palette ? "palette" : "",
        t.layout.paneAccent ?? "",
        t.type.numerals ?? "",
        t.effects.chromatic ? "chromatic" : "",
        t.effects.frame ? "frame" : "",
        t.effects.sheen ? "sheen" : "",
        ["sunburst", "plaid", "zigzag", "waves", "halftone", "bricks"].includes(
          t.layout.background ?? "",
        )
          ? "pattern"
          : "",
        ["soft", "depth", "brutal"].includes(t.layout.button ?? "") ? "button" : "",
        ["tail", "gradient", "glass"].includes(t.layout.bubble ?? "") ? "bubble" : "",
        ["shadow", "boxed"].includes(t.type.headingStyle ?? "") ? "heading" : "",
        ["drop", "unfold", "flip"].includes(t.motion?.enter ?? "") ? "enter" : "",
        ["breathe", "sway"].includes(t.motion?.backdrop ?? "") ? "backdrop" : "",
      ].filter(Boolean);
    };
    for (const id of CRAFTED_THEME_IDS) expect(uses(id).length, id).toBeGreaterThan(0);
  });

  it("compile to CSS keyed by their built-in ids", () => {
    const css = craftedThemesCss();
    for (const id of CRAFTED_THEME_IDS) {
      expect(css).toContain(`[data-theme="${id}"] {`);
      expect(css).toContain(`.theme-thumb[data-theme="${id}"]`);
    }
    expect(css).not.toContain("custom-");
    expect(css.split("{").length).toBe(css.split("}").length);
    expect(craftedThemeWebFonts("terracotta")).toContain("Zilla Slab");
    expect(craftedThemeWebFonts("ember")).toEqual([]);
  });

  it("remix into an editable generated theme", () => {
    const remix = remixCraftedTheme("velvet", ["custom-velvet-remix"], "2026-11-26T00:00:00.000Z")!;
    expect(remix.id).toBe("custom-velvet-remix-2");
    expect(remix.name).toBe("Velvet remix");
    expect(remix.colors).toEqual(craftedTheme("velvet")!.colors);
    expect(remix.layout).toEqual(craftedTheme("velvet")!.layout);
    expect(remixCraftedTheme("ember", [])).toBeUndefined();
  });
});
