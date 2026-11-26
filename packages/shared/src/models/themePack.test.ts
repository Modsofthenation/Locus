import { describe, expect, it } from "vitest";
import { customThemeCss, customThemeFromInput, normalizeThemeBackdrop } from "./customTheme.js";
import { activeThemeRef, normalizeThemePreferences } from "./themePreferences.js";
import { exportThemePack, importThemePack } from "./themePack.js";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMkoAAAAASUVORK5CYII=";

describe("theme packs", () => {
  it("round-trips palettes, component overrides, effects, and embedded raster assets", () => {
    const dark = customThemeFromInput({
      name: "Porcelain night",
      scheme: "dark",
      base: "porcelain",
      backdrop: png,
      extraColors: { terminal: "#111122", terminalText: "#ffeedd", codeBlock: "#112233" },
    });
    const light = customThemeFromInput({
      name: "Porcelain day",
      scheme: "light",
      quietEffects: true,
    });
    const json = exportThemePack("Porcelain pair", [dark, light]);
    const pack = importThemePack(json, [dark.id]);
    expect(pack.name).toBe("Porcelain pair");
    expect(pack.variants).toMatchObject([
      { id: `${dark.id}-2`, backdrop: png, base: "porcelain", extraColors: dark.extraColors },
      { id: light.id, scheme: "light", quietEffects: true },
    ]);
    const css = customThemeCss(pack.variants[0]!, true);
    expect(css).toContain(`[data-theme="${dark.id}-2"][data-theme-draft]`);
    expect(css).toContain(`url("${png}")`);
    expect(css).toContain("--term-fg: #ffeedd");
    expect(css).toContain("background: #112233");
  });

  it("rejects unknown versions, filename URLs, unsafe image types, and packs over capacity", () => {
    expect(() =>
      importThemePack('{"format":"locus-theme-pack","version":2,"variants":[]}', []),
    ).toThrow(/version/);
    expect(() =>
      importThemePack(
        JSON.stringify({ name: "Remote", backdrop: "https://example.com/a.png" }),
        [],
      ),
    ).toThrow(/backdrop/);
    expect(normalizeThemeBackdrop("data:image/svg+xml;base64,PHN2Zz4=")).toBeUndefined();
    expect(normalizeThemeBackdrop(`${png}\n`)).toBeUndefined();
    expect(normalizeThemeBackdrop("data:image/png;base64,BBBBBBBBBBBBBBBB")).toBeUndefined();
    expect(() =>
      importThemePack(
        '{"name":"Overflow"}',
        Array.from({ length: 48 }, (_, i) => `custom-${i}`),
      ),
    ).toThrow(/space/);
  });
});

describe("system theme preferences", () => {
  it("clears invalid choices and keeps fixed selections and scheme-compatible system fallbacks", () => {
    const dark = customThemeFromInput({ name: "Dark accent", scheme: "dark" });
    const prefs = normalizeThemePreferences(
      {
        followSystem: true,
        light: dark.id,
        dark: dark.id,
        workspaceAccents: {
          "repo:my-repo": "abc",
          "project:my-project": "#f13030",
          "repo:bad": "url()",
          __proto__: "#ffffff",
        },
      },
      [dark],
    );
    expect(prefs).toEqual({
      followSystem: true,
      dark: dark.id,
      workspaceAccents: { "repo:my-repo": "#aabbcc", "project:my-project": "#f13030" },
    });
    expect(activeThemeRef("nord", prefs, false, [dark])).toBe("paper");
    expect(activeThemeRef("nord", prefs, true, [dark])).toBe(dark.id);
    expect(activeThemeRef("nord", prefs, true, [])).toBe("ember");
    expect(activeThemeRef("nord", { ...prefs, followSystem: false }, false, [dark])).toBe("nord");
  });
});
