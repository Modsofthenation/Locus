/**
 * Crafted themes: built-in themes written as engine specs instead of
 * hand-tuned CSS. Each one leans on a different part of the theme engine
 * (seeded palettes, pattern backdrops, pane accents, heading treatments,
 * button feel, motion and effects), and doubles as a starting point that can be
 * remixed into an editable generated theme.
 */
import {
  customThemeFromInput,
  customThemeWebFonts,
  themeSpecCss,
  type CustomTheme,
  type CustomThemeId,
} from "./customTheme.js";
import { CRAFTED_THEME_IDS, isCraftedThemeId, type CraftedThemeId } from "./theme.js";

/** Loose spec input, the same shape the editor, AI generator and imports use. */
type CraftedSpec = Record<string, unknown> & { name: string; summary: string };

export const CRAFTED_THEME_SPECS: Record<CraftedThemeId, CraftedSpec> = {
  zenith: {
    name: "Zenith",
    summary: "Sunburst rays over a molten horizon, with depth-pressed buttons.",
    scheme: "dark",
    adaptive: true,
    palette: { seed: "#ff7a3d", harmony: "complementary" },
    layout: {
      background: "sunburst",
      backgroundIntensity: 0.6,
      radius: 14,
      shadow: "layered",
      paneAccent: "gradient",
      topbar: "gradient",
      bubble: "gradient",
      button: "depth",
    },
    type: { headingFont: "geometric", headingWeight: 800, headingStyle: "shadow" },
    motion: { backdrop: "breathe", enter: "rise", easing: "smooth" },
    effects: { vignette: true },
  },
  tartan: {
    name: "Tartan",
    summary: "Woven plaid, oxblood and bottle green, set in a library serif.",
    scheme: "light",
    colors: {
      bg: "#f4efe2",
      surface: "#fbf7ec",
      raised: "#ebe3cf",
      text: "#1f2a1f",
      accent: "#9e2a2b",
      accent2: "#1f5c3a",
    },
    layout: {
      background: "plaid",
      backgroundIntensity: 0.45,
      radius: 6,
      paneAccent: "top",
      sidebar: "tinted",
      button: "depth",
    },
    type: { font: "serif", headingFont: "didone", headingWeight: 700, numerals: "oldstyle" },
    motion: { enter: "fade", speed: "relaxed" },
    effects: { noise: true },
  },
  riptide: {
    name: "Riptide",
    summary: "Rolling waves under frosted glass that sways with the tide.",
    scheme: "dark",
    adaptive: true,
    palette: { seed: "#22c3d6", harmony: "analogous" },
    layout: {
      background: "waves",
      backgroundIntensity: 0.7,
      patternScale: 1.25,
      pane: "glass",
      blur: 18,
      sidebar: "glass",
      topbar: "glass",
      bubble: "glass",
      radius: 18,
      controls: "pill",
      button: "gradient",
    },
    type: { font: "outfit", headingWeight: 600 },
    motion: { backdrop: "sway", enter: "rise", easing: "smooth", speed: "relaxed" },
    effects: { sheen: true },
  },
  halftone: {
    name: "Halftone",
    summary: "Pop-art dots, boxed headlines and hard-edged brutal buttons.",
    scheme: "light",
    components: {
      button: { radius: 0 },
      input: { radius: 0, borderWidth: 2 },
      modal: { shadow: "hard", borderWidth: 3 },
    },
    colors: {
      bg: "#fff9e8",
      surface: "#fffdf5",
      text: "#1a1a1a",
      accent: "#d62839",
      accent2: "#1d4ed8",
      accentInk: "#ffffff",
    },
    layout: {
      background: "halftone",
      backgroundIntensity: 0.5,
      radius: 4,
      borderWidth: 2,
      borderColor: "text",
      shadow: "hard",
      button: "brutal",
      bubble: "tail",
    },
    type: { font: "grotesk", headingFont: "poster", headingCase: "upper", headingStyle: "boxed" },
    motion: { enter: "pop", hover: "press", easing: "snappy" },
    effects: {},
  },
  jubilee: {
    name: "Jubilee",
    summary: "Party zigzags, candy triadic colours and bouncy rounded pills.",
    scheme: "light",
    adaptive: true,
    palette: { seed: "#e0457b", harmony: "triadic" },
    layout: {
      background: "zigzag",
      backgroundIntensity: 0.4,
      radius: 22,
      controls: "pill",
      density: "spacious",
      paneAccent: "gradient",
      bubble: "tail",
      button: "soft",
    },
    type: { font: "rounded", headingFont: "rounded", headingWeight: 800 },
    motion: { easing: "bouncy", enter: "drop", hover: "grow" },
    effects: { lift: true },
  },
  spectra: {
    name: "Spectra",
    summary: "Chromatic-split headings and a glowing frame over a colour-cycling grid.",
    scheme: "dark",
    adaptive: true,
    palette: { seed: "#8b5cf6", harmony: "split" },
    layout: {
      background: "grid",
      backgroundIntensity: 0.7,
      radius: 10,
      sidebar: "gradient",
      bubble: "gradient",
      button: "glow",
      focusRing: "glow",
    },
    type: { headingFont: "tech", headingCase: "upper", headingTracking: 0.08 },
    motion: { enter: "flip", backdrop: "hue" },
    effects: { chromatic: true, frame: true, scanlines: true },
  },
  tally: {
    name: "Tally",
    summary: "An accountant's green ledger: ruled lines, tabular figures, square controls.",
    scheme: "light",
    code: {
      syntax: { keyword: "#1f6b45", string: "#7a4a1f", comment: "#5d6b5f", number: "#a4472a" },
      diffAdd: "#1f6b45",
      diffDel: "#a4472a",
    },
    components: { input: { radius: 0 }, modal: { radius: 0, borderWidth: 2 } },
    colors: {
      bg: "#f3f6ef",
      surface: "#fbfcf8",
      raised: "#e6ecdf",
      text: "#18261c",
      accent: "#1f6b45",
      accent2: "#a4472a",
    },
    extraColors: { caret: "#a4472a" },
    layout: {
      background: "lines",
      radius: 2,
      controls: "square",
      borderWidth: 1,
      density: "compact",
      topbar: "underline",
      paneAccent: "left",
      bubble: "quote",
    },
    type: {
      font: "grotesk",
      monoFont: "mono",
      numerals: "tabular",
      headingCase: "upper",
      headingTracking: 0.06,
      headingWeight: 600,
      scale: 0.95,
    },
    motion: { speed: "fast", enter: "unfold" },
    effects: {},
  },
  terracotta: {
    name: "Terracotta",
    summary: "Sun-baked brick courses, slab headings and warm clay buttons.",
    scheme: "light",
    palette: { seed: "#c2562e", harmony: "analogous" },
    layout: {
      background: "bricks",
      backgroundIntensity: 0.55,
      radius: 12,
      shadow: "soft",
      sidebar: "tinted",
      bubble: "filled",
      button: "depth",
    },
    type: { font: "outfit", headingFont: "slab", headingWeight: 700 },
    motion: { enter: "rise", hover: "press" },
    effects: {},
  },
  frostline: {
    name: "Frostline",
    summary: "Icy glass panes, a pale aurora and a cold morning sheen.",
    scheme: "light",
    adaptive: true,
    palette: { seed: "#3f7fd0", harmony: "mono" },
    layout: {
      background: "aurora",
      backgroundColors: ["#7cc4ff", "#b9a6ff", "#8fe3d0"],
      backgroundIntensity: 0.6,
      pane: "glass",
      blur: 22,
      sidebar: "glass",
      topbar: "glass",
      bubble: "glass",
      radius: 16,
      shadow: "layered",
    },
    type: { font: "geometric", headingWeight: 300, headingTracking: 0.02 },
    motion: { enter: "unfold", backdrop: "drift", speed: "relaxed", easing: "smooth" },
    effects: { sheen: true },
  },
  velvet: {
    name: "Velvet",
    summary: "Plush wine velvet, gold leaf headings and a cabaret spotlight.",
    scheme: "dark",
    code: {
      syntax: { keyword: "#e0a3b8", string: "#d9a441", function: "#f1c27d" },
      ansi: { magenta: "#d06a92", yellow: "#d9a441" },
    },
    components: { modal: { radius: 22, shadow: "glow" }, button: { radius: 999 } },
    colors: {
      bg: "#170a12",
      surface: "#200e19",
      raised: "#2b1322",
      overlay: "#341829",
      text: "#f3e6ea",
      accent: "#d9a441",
      accent2: "#c2335f",
      accentInk: "#1a0d12",
    },
    layout: {
      background: "spotlight",
      backgroundColors: ["#c2335f"],
      backgroundIntensity: 0.7,
      radius: 12,
      shadow: "layered",
      paneAccent: "gradient",
      sidebar: "tinted",
      bubble: "glass",
      button: "gradient",
    },
    type: { font: "serif", headingFont: "didone", headingItalic: true, headingStyle: "gradient" },
    motion: { enter: "blur", speed: "relaxed", easing: "smooth", hover: "shine" },
    effects: { vignette: true, sheen: true, noise: true },
  },
  nightshift: {
    name: "Night Shift",
    summary: "Amber monospace on graphite with a faint halftone hum.",
    scheme: "dark",
    code: {
      syntax: {
        keyword: "#f2c94c",
        string: "#c9b98a",
        comment: "#8a8270",
        function: "#ffe08a",
        type: "#e8a54b",
      },
      diffAdd: "#c9d66b",
      diffDel: "#e8765b",
    },
    palette: { seed: "#f2c94c", harmony: "mono" },
    extraColors: { caret: "#f2c94c", scrollbar: "#8a7430" },
    layout: {
      background: "halftone",
      backgroundIntensity: 0.35,
      patternScale: 0.75,
      radius: 4,
      controls: "square",
      density: "compact",
      topbar: "underline",
      button: "soft",
      scrollbar: "thin",
    },
    type: {
      font: "mono",
      headingFont: "mono",
      numerals: "slashed",
      headingCase: "upper",
      headingTracking: 0.12,
    },
    motion: { enter: "fade", speed: "fast" },
    effects: {},
  },
  orchard: {
    name: "Orchard",
    summary: "Rolling green hills, plum accents and soft rounded buttons.",
    scheme: "light",
    adaptive: true,
    palette: { seed: "#4f9a3a", harmony: "complementary" },
    layout: {
      background: "waves",
      backgroundIntensity: 0.45,
      patternScale: 1.5,
      radius: 18,
      controls: "pill",
      sidebar: "tinted",
      paneAccent: "top",
      bubble: "tail",
      button: "soft",
    },
    type: { font: "rounded", headingFont: "serif", headingWeight: 700 },
    motion: { backdrop: "sway", enter: "rise", easing: "smooth" },
    effects: {},
  },
  kunsthalle: {
    name: "Kunsthalle",
    summary: "Bauhaus primaries with boxed headlines, brutal buttons and a sunburst.",
    scheme: "light",
    base: "bauhaus",
    colors: {
      bg: "#f2efe6",
      surface: "#faf8f2",
      text: "#111111",
      accent: "#c8211a",
      accent2: "#1f4fbf",
      accentInk: "#ffffff",
    },
    layout: {
      background: "sunburst",
      backgroundColors: ["#f1c40f", "#1f4fbf"],
      backgroundIntensity: 0.3,
      paneAccent: "left",
      button: "brutal",
    },
    type: { font: "geometric", headingCase: "upper", headingStyle: "boxed" },
    motion: { enter: "slide", hover: "press" },
    effects: {},
  },
  overdrive: {
    name: "Overdrive",
    summary: "Neon racing grid, chromatic headlines and a glowing window frame.",
    scheme: "dark",
    code: { syntax: { keyword: "#ff33d8", string: "#77f042", function: "#5ee7ff" } },
    base: "neon",
    palette: { seed: "#ff2bd6", harmony: "split" },
    layout: {
      background: "grid",
      patternScale: 1.5,
      backgroundIntensity: 0.8,
      sidebar: "gradient",
      topbar: "underline",
      button: "glow",
    },
    type: { headingFont: "tech", headingCase: "upper", headingTracking: 0.1 },
    motion: { backdrop: "pan", enter: "flip", hover: "glow" },
    effects: { chromatic: true, frame: true, glow: true },
  },
  picnic: {
    name: "Picnic",
    summary: "A gingham blanket under paper panes, with handwritten headings.",
    scheme: "light",
    base: "paper",
    colors: {
      bg: "#fbf6ee",
      surface: "#fffcf6",
      text: "#2a1f1a",
      accent: "#c8323c",
      accent2: "#3a7d44",
    },
    layout: {
      background: "plaid",
      backgroundColors: ["#c8323c", "#c8323c"],
      backgroundIntensity: 0.4,
      patternScale: 0.8,
      bubble: "tail",
      button: "depth",
    },
    type: { headingFont: "hand", headingWeight: 700 },
    motion: { enter: "drop", easing: "bouncy" },
    effects: {},
  },
  mossgarden: {
    name: "Moss Garden",
    summary: "Raked-gravel rings around deep moss, breathing slowly.",
    scheme: "dark",
    base: "zen",
    colors: {
      bg: "#0f1510",
      surface: "#141c15",
      raised: "#1b251c",
      text: "#e4eadf",
      accent: "#9cc98a",
      accent2: "#d8c39a",
    },
    layout: {
      background: "rings",
      backgroundIntensity: 0.45,
      patternScale: 1.5,
      radius: 20,
      bubble: "quote",
    },
    type: { font: "serif", headingWeight: 400, lineHeight: 1.75 },
    motion: { backdrop: "breathe", speed: "slow", easing: "smooth", enter: "fade" },
    effects: { sheen: true, vignette: true },
  },
};

const CRAFTED_AT = "2026-11-26T00:00:00.000Z";
const cache = new Map<CraftedThemeId, CustomTheme>();

/** The compiled spec behind a crafted built-in theme. */
export function craftedTheme(id: unknown): CustomTheme | undefined {
  if (!isCraftedThemeId(id)) return undefined;
  const hit = cache.get(id);
  if (hit) return hit;
  const theme = customThemeFromInput(CRAFTED_THEME_SPECS[id], {
    id: `custom-${id}` satisfies CustomThemeId,
    origin: "user",
    now: CRAFTED_AT,
  });
  cache.set(id, theme);
  return theme;
}

/** CSS for every crafted theme, keyed to their built-in ids. */
export function craftedThemesCss(): string {
  return CRAFTED_THEME_IDS.map((id) => themeSpecCss(craftedTheme(id)!, id))
    .filter(Boolean)
    .join("\n\n");
}

/** Web fonts a crafted theme needs that index.html does not load. */
export function craftedThemeWebFonts(id: unknown): string[] {
  const theme = craftedTheme(id);
  return theme ? customThemeWebFonts(theme) : [];
}

/**
 * A crafted theme as a new, editable generated-theme spec ("Remix"): the same
 * settings under a fresh id and a "remix" name.
 */
export function remixCraftedTheme(
  id: unknown,
  taken: Iterable<string>,
  now = new Date().toISOString(),
): CustomTheme | undefined {
  const theme = craftedTheme(id);
  if (!theme) return undefined;
  const { id: _id, createdAt: _c, updatedAt: _u, ...spec } = theme;
  return customThemeFromInput(
    { ...spec, name: `${theme.name} remix` },
    { taken, origin: "user", now, fixContrast: false },
  );
}
