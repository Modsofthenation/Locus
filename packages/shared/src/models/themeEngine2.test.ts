import { describe, expect, it } from "vitest";
import { craftedTheme } from "./craftedThemes.js";
import {
  CUSTOM_THEME_ANSI_KEYS,
  ansiToken,
  customThemeCss,
  customThemeFromInput,
  fixThemeReadability,
  hexContrast,
  oppositeSchemeColors,
  paletteFromPixels,
  resolveCodeColors,
  themeForScheme,
  themeReadabilityIssues,
  themeSpecCss,
  type CustomTheme,
} from "./customTheme.js";
import { CRAFTED_THEME_IDS, THEME_OPTIONS, themeOption } from "./theme.js";
import {
  applyThemeManageAction,
  diffThemeSpec,
  materializeTheme,
  normalizeCustomThemes,
  relinkTheme,
  remixTheme,
} from "./themeInheritance.js";
import {
  activeThemeRef,
  normalizeThemePreferences,
  scheduledTheme,
  selectFixedTheme,
  themeFitsScheme,
} from "./themePreferences.js";
import { TOKEN_THEME_IDS, isTokenThemeId, tokenThemeSpec, tokenThemesCss } from "./tokenThemes.js";

const NOW = "2026-11-26T00:00:00.000Z";

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

describe("code, terminal and diff colours", () => {
  it("derives a full readable set and keeps given colours readable", () => {
    const t = sample({ code: { syntax: { keyword: "#1a1a1a" }, diffAdd: "#00ff00" } });
    expect(t.code?.syntax?.keyword).not.toBe("#1a1a1a");
    const code = resolveCodeColors(t.colors, t.extraColors ?? {}, t.scheme, t.code);
    expect(hexContrast(code.syntax.keyword, t.colors.raised)).toBeGreaterThanOrEqual(4.5);
    for (const key of CUSTOM_THEME_ANSI_KEYS) {
      if (key === "black") continue;
      expect(hexContrast(code.ansi[key], "#0b0b0e").toFixed(1), key).not.toBe("1.0");
    }
    expect(code.diffAdd).toBe("#00ff00");
  });

  it("always emits ANSI tokens, and syntax/diff tokens only when asked", () => {
    const plain = customThemeCss(sample());
    expect(plain).toContain(`${ansiToken("brightMagenta")}: #`);
    expect(ansiToken("brightMagenta")).toBe("--ansi-bright-magenta");
    expect(plain).not.toContain("--syn-kw");
    const coded = customThemeCss(sample({ code: {} }));
    expect(coded).toContain("--syn-kw: ");
    expect(coded).toContain("--diff-add: ");
  });
});

describe("per-component settings", () => {
  it("validates and compiles component overrides after the global layout", () => {
    const t = sample({
      layout: { radius: 4 },
      components: {
        modal: { radius: 24, shadow: "glow", fill: "#202030" },
        button: { radius: "pill", borderWidth: 9 },
        nope: { radius: 3 },
      },
    });
    expect(t.components).toEqual({
      modal: { radius: 24, shadow: "glow", fill: "#202030" },
      button: { radius: 999, borderWidth: 4 },
    });
    const css = customThemeCss(t);
    expect(css).toMatch(/\.modal \{\s*background: #202030;[\s\S]*?border-radius: 24px;/);
    expect(css).toMatch(/\.btn:not\(\.icon\):not\(\.chip\) \{\s*border-radius: 999px;/);
    expect(css.lastIndexOf("border-radius: 24px")).toBeGreaterThan(css.indexOf("--radius: 4px"));
  });
});

describe("adaptive themes", () => {
  it("regrows a seeded theme and mirrors an unseeded one for the other scheme", () => {
    const seeded = sample({ palette: { seed: "#2a9d8f" }, colors: undefined, adaptive: true });
    const light = themeForScheme(seeded, "light");
    expect(light.scheme).toBe("light");
    expect(light.colors.bg > "#e0").toBe(true);
    const mirrored = oppositeSchemeColors(sample().colors, "light");
    expect(hexContrast(mirrored.text, mirrored.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("applies per-scheme variants and compiles both schemes", () => {
    const t = sample({ adaptive: true, variants: { light: { colors: { accent: "#0055aa" } } } });
    expect(themeForScheme(t, "light").colors.accent).toBe("#0055aa");
    const css = customThemeCss(t);
    expect(css).toContain("@media (prefers-color-scheme: light) {");
    expect(css).toMatch(
      /prefers-color-scheme: light\) \{\s*\[data-theme="custom-sample"\] \{\s*color-scheme: light;/,
    );
    expect(css.split("{").length).toBe(css.split("}").length);
  });

  it("can stand in for either scheme in light/dark pairs", () => {
    const t = sample({ adaptive: true });
    expect(themeFitsScheme(t.id, "light", [t])).toBe(true);
    expect(themeFitsScheme(sample().id, "light", [sample()])).toBe(false);
    const adaptiveBuiltin = THEME_OPTIONS.find((o) => o.adaptive)!;
    expect(themeFitsScheme(adaptiveBuiltin.id, "light")).toBe(true);
    expect(themeFitsScheme(adaptiveBuiltin.id, "dark")).toBe(true);
  });
});

describe("readability checks", () => {
  it("covers gradients, surface text, code and the other scheme, and fixes them", () => {
    const base = sample({ adaptive: true });
    const t: CustomTheme = {
      ...base,
      colors: { ...base.colors, accent: "#ffffff", accent2: "#000000" },
      layout: { bubble: "gradient" },
      extraColors: { sidebar: "#ffffff", sidebarText: "#eeeeee" },
      code: { ansi: { red: "#111111" } },
    };
    const where = themeReadabilityIssues(t).map((row) => row.where);
    expect(where).toContain("Your messages (gradient)");
    expect(where).toContain("Sidebar");
    expect(where).toContain("Terminal red");
    expect(themeReadabilityIssues(fixThemeReadability(t))).toEqual([]);
  });

  it("passes for every crafted theme in both schemes", () => {
    for (const id of CRAFTED_THEME_IDS) {
      expect(themeReadabilityIssues(craftedTheme(id)!), id).toEqual([]);
    }
  });
});

describe("palette from an image", () => {
  it("picks the dominant vivid hue, distinct extras and a scheme", () => {
    const px: number[] = [];
    const push = (r: number, g: number, b: number, n: number) => {
      for (let i = 0; i < n; i += 1) px.push(r, g, b, 255);
    };
    push(20, 120, 220, 600); // blue dominates
    push(230, 90, 30, 300); // orange
    push(25, 125, 215, 100); // near-blue, same bucket
    push(10, 10, 12, 1000); // dark, unsaturated
    const found = paletteFromPixels(new Uint8ClampedArray(px));
    expect(found.scheme).toBe("dark");
    expect(found.colors).toHaveLength(2);
    const [r, , b] = [1, 3, 5].map((i) => Number.parseInt(found.seed.slice(i, i + 2), 16));
    expect(b!).toBeGreaterThan(r!);
    expect(paletteFromPixels(new Uint8ClampedArray([200, 200, 200, 255])).colors).toEqual([]);
  });
});

describe("token built-ins", () => {
  it("keep their CSS blocks as validated data and convert to specs", () => {
    expect(TOKEN_THEME_IDS.length).toBeGreaterThan(70);
    expect(isTokenThemeId("nord")).toBe(true);
    expect(isTokenThemeId("ember")).toBe(false);
    const css = tokenThemesCss();
    expect(css).toContain('[data-theme="nord"] {\n  color-scheme: dark;\n  --bg: #2e3440;');
    expect(css.split("{").length).toBe(css.split("}").length);
    const spec = tokenThemeSpec("nord")!;
    expect(spec).toMatchObject({ name: "Nord", scheme: "dark", colors: { bg: "#2e3440" } });
    for (const id of TOKEN_THEME_IDS) {
      const opt = themeOption(id);
      expect(opt.style ?? opt.terminal ?? opt.gradient ?? opt.chatScene ?? opt.crafted).toBeFalsy();
    }
  });
});

describe("inheritance", () => {
  it("records only differences and re-merges the base on load", () => {
    const remix = remixTheme("nord", [], NOW)!;
    expect(remix.extends).toBe("nord");
    expect(remix.colors.bg).toBe("#2e3440");
    const edited = relinkTheme(
      { ...remix, colors: { ...remix.colors, accent: "#ff8800" }, layout: { radius: 3 } },
      [],
    );
    expect(edited.overrides).toEqual({
      name: "Nord remix",
      summary: remix.summary,
      colors: { accent: "#ff8800" },
      layout: { radius: 3 },
    });
    // A stale stored bg is replaced by the base's on load; overrides survive.
    const loaded = normalizeCustomThemes([
      { ...edited, colors: { ...edited.colors, bg: "#000000" } },
    ])[0]!;
    expect(loaded.colors.bg).toBe("#2e3440");
    expect(loaded.colors.accent).toBe("#ff8800");
  });

  it("chains through generated themes, drops removed fields, and survives cycles", () => {
    const base = sample({ id: "custom-base", layout: { paneAccent: "top", radius: 8 } });
    const child = materializeTheme(
      customThemeFromInput(
        {
          name: "Child",
          extends: "custom-base",
          overrides: { name: "Child", layout: { paneAccent: null } },
        },
        { id: "custom-child", now: NOW },
      ),
      [base],
    );
    expect(child.layout).toEqual({ radius: 8 });
    expect(diffThemeSpec({ layout: {} }, { layout: { radius: 8 } })).toEqual({
      layout: { radius: null },
    });
    const a = { ...sample({ id: "custom-a" }), extends: "custom-b", overrides: { name: "A" } };
    const b = { ...sample({ id: "custom-b" }), extends: "custom-a", overrides: { name: "B" } };
    const out = normalizeCustomThemes([a, b]);
    expect(out).toHaveLength(2);
    // A base that disappears leaves the theme intact and unlinked.
    const orphan = normalizeCustomThemes([
      { ...sample(), extends: "custom-gone", overrides: {} },
    ])[0]!;
    expect(orphan.extends).toBeUndefined();
  });

  it("manage_theme creates from a base and updates overrides", () => {
    const created = applyThemeManageAction(
      [],
      {
        action: "create",
        theme: JSON.stringify({
          name: "Plum Velvet",
          extends: "velvet",
          colors: { accent: "#b38bd9" },
        }),
      },
      NOW,
    );
    expect(created.ok).toBe(true);
    const theme = created.themes[0]!;
    expect(theme.extends).toBe("velvet");
    expect(theme.colors.accent).toBe("#b38bd9");
    expect(theme.layout.paneAccent).toBe("gradient");
    const updated = applyThemeManageAction(
      created.themes,
      { action: "update", id: theme.id, theme: { layout: { radius: 2 } } },
      NOW,
    );
    expect(updated.themes[0]!.overrides).toMatchObject({
      colors: { accent: "#b38bd9" },
      layout: { radius: 2 },
    });
    expect(
      applyThemeManageAction([], { action: "create", theme: { name: "x", extends: "nope" } }).ok,
    ).toBe(false);
  });
});

describe("schedules and workspace themes", () => {
  const prefs = normalizeThemePreferences({
    followSystem: true,
    scheduleOn: true,
    schedule: [
      { at: "19:30", theme: "midnight" },
      { at: "07:00", theme: "paper" },
      { at: "25:00", theme: "nord" },
      { at: "12:00", theme: "not-a-theme" },
    ],
    workspaceThemes: { "repo:web": "velvet", "bad key": "nord", "project:x": "nope" },
  })!;

  it("validates slots and workspace themes", () => {
    expect(prefs.schedule).toEqual([
      { at: "19:30", theme: "midnight" },
      { at: "07:00", theme: "paper" },
    ]);
    expect(prefs.workspaceThemes).toEqual({ "repo:web": "velvet" });
  });

  it("picks the latest slot, wrapping past midnight", () => {
    expect(scheduledTheme(prefs.schedule, 6 * 60)).toBe("midnight");
    expect(scheduledTheme(prefs.schedule, 7 * 60)).toBe("paper");
    expect(scheduledTheme(prefs.schedule, 23 * 60)).toBe("midnight");
  });

  it("orders workspace over schedule over system over fixed", () => {
    expect(
      activeThemeRef("nord", prefs, true, [], { minute: 9 * 60, workspaceKey: "repo:web" }),
    ).toBe("velvet");
    expect(activeThemeRef("nord", prefs, true, [], { minute: 9 * 60 })).toBe("paper");
    expect(
      activeThemeRef("nord", { ...prefs, scheduleOn: false }, true, [], { minute: 9 * 60 }),
    ).toBe("ember");
    expect(activeThemeRef("nord", undefined, true, [], { minute: 9 * 60 })).toBe("nord");
  });

  it("a fixed pick turns the schedule off but keeps it", () => {
    const next = selectFixedTheme({ themePreferences: prefs } as never, "nord");
    expect(next.themePreferences).toMatchObject({ scheduleOn: false, followSystem: false });
    expect(next.themePreferences?.schedule).toHaveLength(2);
  });

  it("accepts adaptive themes in either light/dark slot", () => {
    const adaptive = THEME_OPTIONS.find((o) => o.adaptive && o.scheme === "dark")!;
    expect(normalizeThemePreferences({ light: adaptive.id })?.light).toBe(adaptive.id);
  });
});

describe("spec CSS ids", () => {
  it("still refuses unsafe selector ids", () => {
    expect(themeSpecCss(sample(), "a b")).toBe("");
  });
});
