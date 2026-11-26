import { describe, expect, it } from "vitest";
import {
  CUSTOM_THEME_HARMONIES,
  CUSTOM_THEME_SYSTEM_PROMPT,
  MANAGE_THEME_TOOL,
  deriveThemePalette,
  inkAcross,
  themeSpecCss,
  customAccentText,
  customThemeContrastIssues,
  customThemeCss,
  customThemeFromInput,
  customThemeWebFonts,
  normalizeFontFamily,
  webFontHref,
  findCustomTheme,
  fixCustomThemeContrast,
  hexContrast,
  isCustomThemeId,
  newCustomThemeId,
  parseCustomThemeJson,
  resolveThemeRef,
  type CustomTheme,
} from "./customTheme.js";
import { THEME_FAMILY_ORDER, themeFamilyLabel } from "./theme.js";
import { applyThemeManageAction, normalizeCustomThemes } from "./themeInheritance.js";

const NOW = "2026-01-01T00:00:00.000Z";

function sample(over: Record<string, unknown> = {}): CustomTheme {
  return customThemeFromInput(
    {
      id: "custom-sample",
      name: "Sample",
      scheme: "dark",
      colors: { bg: "#101014", text: "#f2f2f2", accent: "#ff5c8a" },
      ...over,
    },
    { now: NOW },
  );
}

describe("custom theme ids", () => {
  it("accepts custom- ids and resolves only ones that exist", () => {
    expect(isCustomThemeId("custom-neon-rain")).toBe(true);
    expect(isCustomThemeId("custom-")).toBe(false);
    expect(isCustomThemeId("custom-Bad Id")).toBe(false);
    expect(isCustomThemeId("nord")).toBe(false);
    const themes = [sample()];
    expect(resolveThemeRef("custom-sample", themes)).toBe("custom-sample");
    expect(resolveThemeRef("custom-missing", themes)).toBe("ember");
    expect(resolveThemeRef("nord", themes)).toBe("nord");
    expect(resolveThemeRef(42, themes)).toBe("ember");
    expect(findCustomTheme("custom-sample", themes)?.name).toBe("Sample");
  });

  it("slugs names into unique ids", () => {
    expect(newCustomThemeId("Rainy Tokyo Night!", [])).toBe("custom-rainy-tokyo-night");
    expect(newCustomThemeId("Rainy Tokyo Night", ["custom-rainy-tokyo-night"])).toBe(
      "custom-rainy-tokyo-night-2",
    );
    expect(newCustomThemeId("???", [])).toBe("custom-theme");
  });
});

describe("customThemeFromInput", () => {
  it("fills a full palette from three colours and infers the scheme", () => {
    const theme = customThemeFromInput({
      name: "Paperwhite",
      colors: { bg: "#fafafa", text: "#111111", accent: "#0055ff" },
    });
    expect(theme.scheme).toBe("light");
    expect(theme.id).toBe("custom-paperwhite");
    for (const value of Object.values(theme.colors)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("accepts aliases, snake_case and flat layout keys", () => {
    const theme = customThemeFromInput({
      name: "Alias",
      colors: { background: "#000", pane: "#111111", success: "#22cc66", on_accent: "#000000" },
      border_width: 9,
      radius: -4,
      heading_case: "upper",
      font: "pixel",
      vignette: true,
    });
    expect(theme.colors.bg).toBe("#000000");
    expect(theme.colors.surface).toBe("#111111");
    expect(theme.layout.borderWidth).toBe(4);
    expect(theme.layout.radius).toBe(0);
    expect(theme.type.headingCase).toBe("upper");
    expect(theme.type.font).toBe("pixel");
    expect(theme.effects.vignette).toBe(true);
  });

  it("drops anything outside the allowed vocabulary", () => {
    const theme = customThemeFromInput({
      name: "<script>alert(1)</script>Evil",
      base: "not-a-style",
      colors: { bg: "red; } body { display:none", text: "url(x)", accent: "#zzzzzz" },
      layout: { shadow: "0 0 0 red", background: "url(https://x)", pane: "glass" },
      type: { font: "Comic Sans MS; color: red" },
    });
    expect(theme.name).not.toMatch(/[<>]/);
    expect(theme.base).toBeUndefined();
    expect(theme.layout.shadow).toBeUndefined();
    expect(theme.layout.background).toBeUndefined();
    expect(theme.layout.pane).toBe("glass");
    expect(theme.type.font).toBeUndefined();
    const css = customThemeCss(theme);
    expect(css).not.toContain("url(");
    expect(css).not.toContain("display:none");
    expect(css).not.toContain("<");
  });

  it("repairs unreadable colours unless asked not to", () => {
    const loose = {
      name: "Murky",
      scheme: "dark",
      colors: {
        bg: "#202020",
        surface: "#262626",
        text: "#3a3a3a",
        muted: "#303030",
        accent: "#2a2a2a",
        accentInk: "#2b2b2b",
      },
    };
    expect(customThemeContrastIssues(customThemeFromInput(loose).colors)).toEqual([]);
    expect(
      customThemeContrastIssues(customThemeFromInput(loose, { fixContrast: false }).colors).length,
    ).toBeGreaterThan(0);
  });
});

describe("fixCustomThemeContrast", () => {
  it("brings every promised pair over its minimum", () => {
    const fixed = fixCustomThemeContrast({
      ...sample().colors,
      bg: "#f5f5f5",
      surface: "#ffffff",
      text: "#cccccc",
      muted: "#dddddd",
      faint: "#eeeeee",
      accent: "#ffee00",
      accentInk: "#ffffff",
    });
    expect(customThemeContrastIssues(fixed)).toEqual([]);
    expect(hexContrast(fixed.accentInk, fixed.accent)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("customAccentText", () => {
  it("clears AA on page and panes for light and dark themes", () => {
    const cases = [
      { bg: "#f6f4ef", surface: "#fbfaf7", text: "#1c1b19", accent: "#c2410c" },
      { bg: "#fafafa", surface: "#ffffff", text: "#111111", accent: "#6a8f73" },
      { bg: "#101014", surface: "#16161c", text: "#f2f2f2", accent: "#7a3aff" },
      { bg: "#c41018", surface: "#d41820", text: "#fff8c8", accent: "#ffcc00" },
    ];
    for (const row of cases) {
      const colors = fixCustomThemeContrast({ ...sample().colors, ...row });
      const accentText = customAccentText(colors);
      expect(hexContrast(accentText, colors.bg), row.accent).toBeGreaterThanOrEqual(4.5);
      expect(hexContrast(accentText, colors.surface), row.accent).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is emitted as a token so accent labels stay readable on generated themes", () => {
    const theme = sample();
    expect(customThemeCss(theme)).toContain(`--accent-text: ${customAccentText(theme.colors)};`);
  });
});

describe("normalizeCustomThemes", () => {
  it("keeps valid rows, de-dupes ids and ignores junk", () => {
    const rows = normalizeCustomThemes([
      sample(),
      { ...sample(), name: "Duplicate" },
      { id: "nord", name: "Not custom" },
      null,
      "string",
    ]);
    expect(rows.map((t) => t.name)).toEqual(["Sample"]);
    expect(normalizeCustomThemes("nope")).toEqual([]);
  });
});

describe("customThemeCss", () => {
  it("scopes tokens and component rules to the theme", () => {
    const theme = sample({
      base: "comic",
      layout: {
        radius: 20,
        controls: "pill",
        borderWidth: 2,
        shadow: "hard",
        background: "grid",
        pane: "glass",
        sidebar: "accent",
        bubble: "quote",
        button: "gradient",
      },
      type: { font: "tech", headingFont: "didone", headingCase: "upper", headingWeight: 800 },
      effects: { scanlines: true, vignette: true, lift: true },
    });
    const css = customThemeCss(theme);
    expect(css).toContain('[data-theme="custom-sample"] {');
    expect(css).toContain("--radius-control: 999px;");
    expect(css).toContain(
      '@scope ([data-theme="custom-sample"]) to ([data-theme]:not([data-theme="custom-sample"]))',
    );
    expect(css).toContain('html[data-theme="custom-sample"] body::after');
    expect(css).toContain("text-transform: uppercase");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain('.theme-thumb[data-theme="custom-sample"]');
    // Balanced braces, so one theme can never swallow the next.
    expect(css.split("{").length).toBe(css.split("}").length);
  });

  it("emits only tokens for a colour-only theme", () => {
    const css = customThemeCss(sample());
    expect(css).not.toContain("@scope");
    expect(css).toContain("--accent: #ff5c8a;");
  });
});

describe("expressive theme fields", () => {
  it("keeps web font names to letters, digits and spaces", () => {
    expect(normalizeFontFamily("  Space   Grotesk ")).toBe("Space Grotesk");
    expect(normalizeFontFamily('"Fraunces"')).toBe("Fraunces");
    expect(normalizeFontFamily("Evil; } body { display: none")).toBeUndefined();
    expect(normalizeFontFamily("a)b")).toBeUndefined();
    expect(normalizeFontFamily("x".repeat(60))).toBeUndefined();
    expect(webFontHref("Space Grotesk")).toBe(
      "https://fonts.googleapis.com/css2?family=Space+Grotesk&display=swap",
    );
    expect(webFontHref("bad/../name")).toBeUndefined();
  });

  it("normalizes the extended vocabulary and drops junk", () => {
    const theme = sample({
      extraColors: { sidebar: "#223344", link: "#ff5c8a", userBubble: "nope" },
      layout: {
        density: "spacious",
        topbar: "glass",
        borderColor: "accent",
        focusRing: "glow",
        scrollbar: "thin",
        blur: 99,
        messageWidth: 900,
        background: "aurora",
        backgroundColors: ["#ff0000", "zzz", "#00ff00", "#0000ff", "#ffffff", "#000000"],
        backgroundAngle: 400,
        backgroundIntensity: 0.73,
        patternScale: 2,
      },
      type: {
        fontFamily: "Space Grotesk",
        headingFontFamily: "Bad;Name",
        monoFont: "typewriter",
        scale: 1.12,
        bodyWeight: 450,
        lineHeight: 1.8,
        headingStyle: "gradient",
        links: "highlight",
      },
      motion: {
        speed: "relaxed",
        easing: "bouncy",
        enter: "rise",
        hover: "shine",
        backdrop: "drift",
        extra: "x",
      },
      effects: { noise: true, glow: true },
    });
    expect(theme.extraColors).toMatchObject({ sidebar: "#223344" });
    expect(theme.extraColors?.userBubble).toBeUndefined();
    expect(theme.layout.blur).toBe(40);
    expect(theme.layout.backgroundAngle).toBe(360);
    expect(theme.layout.backgroundIntensity).toBeCloseTo(0.75);
    expect(theme.layout.backgroundColors).toEqual(["#ff0000", "#00ff00", "#0000ff", "#ffffff"]);
    expect(theme.type.fontFamily).toBe("Space Grotesk");
    expect(theme.type.headingFontFamily).toBeUndefined();
    expect(theme.type.bodyWeight).toBe(500);
    expect(theme.motion).toEqual({
      speed: "relaxed",
      easing: "bouncy",
      enter: "rise",
      hover: "shine",
      backdrop: "drift",
    });
    expect(customThemeWebFonts(theme)).toEqual(["Space Grotesk", "Courier Prime"]);

    const css = customThemeCss(theme);
    expect(css).toContain('"Space Grotesk", ');
    expect(css).toContain("--space-4: calc(20px * var(--density-space, 1));");
    expect(css).toContain("--ease-standard: cubic-bezier(0.34, 1.56, 0.64, 1);");
    expect(css).toContain("--dur-slow: 600ms;");
    expect(css).toContain("@keyframes locus-custom-sample-enter");
    expect(css).toContain("@keyframes locus-custom-sample-backdrop");
    expect(css).toContain("background-clip: text");
    expect(css).toContain("max-width: 900px");
    expect(css).toContain("blur(40px)");
    expect(css).toContain("scrollbar-width: thin");
    expect(css).toContain("feTurbulence");
    // Every animation is cancelled under reduced motion.
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain('html[data-theme="custom-sample"]::before');
    expect(css.split("{").length).toBe(css.split("}").length);
  });

  it("keeps per-surface text readable", () => {
    const theme = sample({
      extraColors: { link: "#202024", heading: "#151518", sidebar: "#fafafa", topbar: "#f0f0f0" },
    });
    expect(hexContrast(theme.extraColors!.link!, theme.colors.bg)).toBeGreaterThanOrEqual(4.5);
    expect(hexContrast(theme.extraColors!.heading!, theme.colors.bg)).toBeGreaterThanOrEqual(4.5);
    const css = customThemeCss(theme);
    // Light sidebar on a dark theme gets dark ink, not the theme's light text.
    expect(css).toMatch(/\.sidebar \{\n\s+background: #fafafa;\n\s+--text: #111111;/);
  });

  it("treats the old lift flag as the lift hover", () => {
    const css = customThemeCss(sample({ effects: { lift: true } }));
    expect(css).toContain("transform: translateY(-1px)");
    expect(css).toContain("prefers-reduced-motion");
  });
});

describe("parseCustomThemeJson", () => {
  it("reads fenced or chatty model output", () => {
    expect(parseCustomThemeJson('Sure!\n```json\n{"name":"A"}\n```')).toEqual({ name: "A" });
    expect(parseCustomThemeJson('Here: {"name":"B","colors":{}} hope you like it')).toEqual({
      name: "B",
      colors: {},
    });
    expect(() => parseCustomThemeJson("no json here")).toThrow();
  });

  it("documents every knob in the system prompt and tool", () => {
    for (const word of [
      "scanlines",
      "headingCase",
      "bubble",
      "sidebar",
      "accentInk",
      "fontFamily",
      "extraColors",
      "backgroundColors",
      "motion",
      "backdrop",
      "density",
    ]) {
      expect(CUSTOM_THEME_SYSTEM_PROMPT).toContain(word);
      expect(MANAGE_THEME_TOOL.description).toContain(word);
    }
  });
});

describe("applyThemeManageAction", () => {
  const spec = JSON.stringify({
    name: "Forest Floor",
    scheme: "dark",
    colors: { bg: "#0f1a12", text: "#e8f0e0", accent: "#8bc34a" },
    layout: { background: "grain" },
  });

  it("creates and applies by default", () => {
    const result = applyThemeManageAction([], { action: "create", theme: spec }, NOW);
    expect(result.ok).toBe(true);
    expect(result.themes).toHaveLength(1);
    expect(result.themes[0]!.origin).toBe("ai");
    expect(result.theme).toBe("custom-forest-floor");
  });

  it("creates without applying when apply is false", () => {
    const result = applyThemeManageAction(
      [],
      { action: "create", theme: spec, apply: "false" },
      NOW,
    );
    expect(result.theme).toBeUndefined();
  });

  it("updates by merging, keeping id and created time", () => {
    const created = applyThemeManageAction([], { action: "create", theme: spec }, NOW).themes;
    const result = applyThemeManageAction(
      created,
      { action: "update", id: "custom-forest-floor", theme: '{"layout":{"radius":24}}' },
      "2026-02-02T00:00:00.000Z",
    );
    const theme = result.themes[0]!;
    expect(theme.id).toBe("custom-forest-floor");
    expect(theme.layout).toEqual({ background: "grain", radius: 24 });
    expect(theme.colors.accent).toBe(created[0]!.colors.accent);
    expect(theme.createdAt).toBe(NOW);
    expect(theme.updatedAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("applies built-in or generated themes, lists, and deletes", () => {
    const themes = applyThemeManageAction([], { action: "create", theme: spec }, NOW).themes;
    expect(applyThemeManageAction(themes, { action: "apply", id: "nord" }).theme).toBe("nord");
    expect(applyThemeManageAction(themes, { action: "apply", id: "Forest Floor" }).theme).toBe(
      "custom-forest-floor",
    );
    expect(applyThemeManageAction(themes, { action: "apply", id: "missing" }).ok).toBe(false);
    expect(applyThemeManageAction(themes, { action: "list" }).output).toContain("Forest Floor");
    const deleted = applyThemeManageAction(themes, { action: "delete", id: "custom-forest-floor" });
    expect(deleted.themes).toEqual([]);
  });

  it("rejects bad input with a readable message", () => {
    expect(applyThemeManageAction([], { action: "create", theme: "{nope" }).output).toMatch(
      /did not parse/,
    );
    expect(applyThemeManageAction([], { action: "create" }).ok).toBe(false);
    expect(applyThemeManageAction([], { action: "explode" }).ok).toBe(false);
  });
});

describe("generated family", () => {
  it("is a labelled family after the style groups", () => {
    expect(THEME_FAMILY_ORDER.at(-1)).toBe("generated");
    expect(themeFamilyLabel("generated")).toBe("Generated");
  });
});

describe("engine extensions", () => {
  it("grows a readable palette from one seed for every harmony", () => {
    for (const harmony of CUSTOM_THEME_HARMONIES) {
      for (const scheme of ["light", "dark"] as const) {
        const colors = deriveThemePalette("#3a86ff", scheme, harmony);
        expect(customThemeContrastIssues(colors)).toEqual([]);
        expect(scheme === "light" ? colors.bg > "#e0" : colors.bg < "#30").toBe(true);
      }
    }
    const comp = deriveThemePalette("#ff0000", "dark", "complementary");
    // Complementary sends the second accent across the wheel (red → cyan).
    expect(Number.parseInt(comp.accent2.slice(5, 7), 16)).toBeGreaterThan(
      Number.parseInt(comp.accent2.slice(1, 3), 16),
    );
    // Grey seeds stay neutral instead of inventing a hue.
    const grey = deriveThemePalette("#808080", "light", "mono");
    expect(grey.bg.slice(1, 3)).toBe(grey.bg.slice(3, 5));
  });

  it("builds colours from palette.seed and lets explicit colours win", () => {
    const seeded = customThemeFromInput(
      { name: "Seeded", scheme: "light", palette: { seed: "#2a9d8f", harmony: "triadic" } },
      { now: NOW },
    );
    expect(seeded.palette).toEqual({ seed: "#2a9d8f", harmony: "triadic" });
    expect(seeded.colors).toEqual(deriveThemePalette("#2a9d8f", "light", "triadic"));
    const pinned = customThemeFromInput(
      { name: "Pinned", scheme: "dark", seed: "#2a9d8f", colors: { accent2: "#ffcc00" } },
      { now: NOW },
    );
    expect(pinned.colors.accent2).toBe("#ffcc00");
    expect(pinned.colors.bg).toBe(deriveThemePalette("#2a9d8f", "dark").bg);
    expect(customThemeFromInput({ name: "x", palette: { seed: "nope" } }).palette).toBeUndefined();
  });

  it("normalizes the new layout, type, effect and colour fields", () => {
    const theme = sample({
      layout: { paneAccent: "gradient", background: "bricks", sidebar: "glass" },
      type: { numerals: "tabular", headingStyle: "boxed" },
      effects: { chromatic: true, frame: true, sheen: true },
      extraColors: { caret: "#ff5c8a", scrollbar: "#333333" },
      motion: { enter: "unfold", backdrop: "breathe" },
    });
    expect(theme.layout).toMatchObject({ paneAccent: "gradient", background: "bricks" });
    expect(theme.type.numerals).toBe("tabular");
    expect(theme.effects).toMatchObject({ chromatic: true, frame: true, sheen: true });
    expect(theme.extraColors).toMatchObject({ caret: "#ff5c8a", scrollbar: "#333333" });
    expect(sample({ layout: { paneAccent: "zigzag" } }).layout.paneAccent).toBeUndefined();
  });

  it("emits CSS for every new option value", () => {
    const backgrounds = ["sunburst", "plaid", "zigzag", "waves", "halftone", "bricks"] as const;
    for (const background of backgrounds) {
      const css = customThemeCss(sample({ layout: { background } }));
      expect(css).toMatch(
        /html\[data-theme="custom-sample"\],\s*html\[data-theme="custom-sample"\] body \{\s*background: /,
      );
      expect(css.split("(").length).toBe(css.split(")").length);
    }
    const css = customThemeCss(
      sample({
        layout: {
          background: "waves",
          paneAccent: "gradient",
          sidebar: "gradient",
          topbar: "underline",
          bubble: "gradient",
          button: "brutal",
          shadow: "layered",
        },
        type: { numerals: "slashed", headingStyle: "shadow" },
        effects: { chromatic: true, frame: true, sheen: true, glow: true },
        extraColors: { caret: "#ff5c8a" },
        motion: { enter: "flip", backdrop: "sway" },
      }),
    );
    expect(css).toContain("font-variant-numeric: slashed-zero;");
    expect(css).toContain("caret-color: #ff5c8a;");
    expect(css).toContain('html[data-theme="custom-sample"] #root::after');
    expect(css).toMatch(/background-size: 100% 3px, 100% 100%/);
    expect(css).toContain("border-bottom: 2px solid #ff5c8a");
    // Offset echo, chromatic split and glow stack into one text-shadow.
    expect(css).toMatch(/text-shadow: 0\.06em 0\.06em 0 [^;]*rgba\(255, 0, 90[^;]*0 0 10px/);
    expect(css).toContain("rotateX(-22deg)");
    expect(css).toContain("rotate(1.5deg)");
    expect(css).toContain("outline: 2px solid #ff5c8a;");
    expect(css.split("{").length).toBe(css.split("}").length);
  });

  it("keeps ink readable on gradient fills", () => {
    expect(inkAcross(["#111111", "#222244"])).toBe("#ffffff");
    expect(inkAcross(["#ffee88", "#ccffee"])).toBe("#111111");
  });

  it("compiles specs under any safe selector id and refuses unsafe ones", () => {
    const theme = sample({ layout: { radius: 8 } });
    expect(themeSpecCss(theme, "zenith")).toContain('[data-theme="zenith"] {');
    expect(themeSpecCss(theme, 'x"] body{}')).toBe("");
    expect(themeSpecCss(theme, "UPPER")).toBe("");
  });

  it("documents the new fields for the generator", () => {
    expect(CUSTOM_THEME_SYSTEM_PROMPT).toContain('"palette"');
    expect(CUSTOM_THEME_SYSTEM_PROMPT).toContain('"paneAccent"');
    expect(CUSTOM_THEME_SYSTEM_PROMPT).toContain('"numerals"');
    expect(CUSTOM_THEME_SYSTEM_PROMPT).toContain('"chromatic"');
    expect(CUSTOM_THEME_SYSTEM_PROMPT).toContain('"sunburst"');
  });
});
