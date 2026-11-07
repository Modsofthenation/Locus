import { indexOfHtmlMarkup } from "./htmlMarkup.js";

export const PALETTE_ROLES = ["bg", "surface", "text", "muted", "primary", "accent"] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];

export type DesignPalette = Record<PaletteRole, string>;

export const PALETTE_ROLE_LABELS: Record<PaletteRole, string> = {
  bg: "Background",
  surface: "Surface",
  text: "Text",
  muted: "Muted",
  primary: "Primary",
  accent: "Accent",
};

export interface PalettePreset {
  id: string;
  name: string;
  summary: string;
  colors: DesignPalette;
}

export const PALETTE_PRESETS: PalettePreset[] = [
  {
    id: "ink",
    name: "Ink",
    summary: "Charcoal ground, cream type, copper CTA.",
    colors: {
      bg: "#111114",
      surface: "#1c1c22",
      text: "#f4f1ea",
      muted: "#9a958c",
      primary: "#e08a4c",
      accent: "#d4c4a8",
    },
  },
  {
    id: "ember",
    name: "Ember",
    summary: "Locus warm peach on charcoal.",
    colors: {
      bg: "#090a0c",
      surface: "#141821",
      text: "#ece7df",
      muted: "#8b8478",
      primary: "#e7b07a",
      accent: "#7dcec4",
    },
  },
  {
    id: "paper",
    name: "Paper",
    summary: "Editorial cream with navy ink.",
    colors: {
      bg: "#f5efe6",
      surface: "#fffdf8",
      text: "#1a2238",
      muted: "#6b6458",
      primary: "#c2542d",
      accent: "#1a2238",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    summary: "Deep teal with seafoam edges.",
    colors: {
      bg: "#061114",
      surface: "#0c1c22",
      text: "#e8f4f3",
      muted: "#7a9aa0",
      primary: "#5fd0c8",
      accent: "#7eb6e8",
    },
  },
  {
    id: "meadow",
    name: "Meadow",
    summary: "Moss and gold under dark green.",
    colors: {
      bg: "#0c100c",
      surface: "#161c14",
      text: "#eef2e4",
      muted: "#8a9378",
      primary: "#c6b067",
      accent: "#7dba7a",
    },
  },
  {
    id: "contrast",
    name: "Contrast",
    summary: "Stark black, white, and a single signal red.",
    colors: {
      bg: "#ffffff",
      surface: "#f4f4f5",
      text: "#111111",
      muted: "#5c5c5c",
      primary: "#c1121f",
      accent: "#111111",
    },
  },
  {
    id: "linen",
    name: "Linen",
    summary: "Oatmeal page, sage stitch, dusty terracotta.",
    colors: {
      bg: "#f3efe6",
      surface: "#faf7f0",
      text: "#1c1a16",
      muted: "#5f584e",
      primary: "#3f6a4a",
      accent: "#8a4638",
    },
  },
  {
    id: "glacier",
    name: "Glacier",
    summary: "Cool daylight, ice gray, steel-blue edge.",
    colors: {
      bg: "#e8eef4",
      surface: "#f4f7fb",
      text: "#18263a",
      muted: "#4d5d70",
      primary: "#2a5a82",
      accent: "#18263a",
    },
  },
  {
    id: "matcha",
    name: "Matcha",
    summary: "High-key mint, foam, and charcoal.",
    colors: {
      bg: "#eef6ea",
      surface: "#f6fbf4",
      text: "#1c2418",
      muted: "#4d5c48",
      primary: "#2d6b42",
      accent: "#1c2418",
    },
  },
  {
    id: "folio",
    name: "Folio",
    summary: "Editorial cream, charcoal ink, burgundy rule.",
    colors: {
      bg: "#f3efe8",
      surface: "#faf7f2",
      text: "#1c1a18",
      muted: "#5c564e",
      primary: "#7a3040",
      accent: "#1c1a18",
    },
  },
  {
    id: "blossom",
    name: "Blossom",
    summary: "Cherry-petal pink on a pale spring page.",
    colors: {
      bg: "#f8eef2",
      surface: "#fff7fa",
      text: "#2a1218",
      muted: "#6e4a54",
      primary: "#b04060",
      accent: "#3a6a88",
    },
  },
  {
    id: "parchment",
    name: "Parchment",
    summary: "Manuscript cream, oxblood, and olive ink.",
    colors: {
      bg: "#f3e6c8",
      surface: "#faf0d8",
      text: "#2a1c10",
      muted: "#6a5640",
      primary: "#8a2030",
      accent: "#3a4c20",
    },
  },
  {
    id: "brief",
    name: "Brief",
    summary: "Cool white, ink, and a single corporate-blue rule.",
    colors: {
      bg: "#f2f4f7",
      surface: "#ffffff",
      text: "#1a1d24",
      muted: "#4e5560",
      primary: "#1558d6",
      accent: "#1a1d24",
    },
  },
  {
    id: "cel",
    name: "Cel",
    summary: "Animation-cel cream, buttercup, and sky.",
    colors: {
      bg: "#fff4dc",
      surface: "#fffaf0",
      text: "#1a1408",
      muted: "#6a5a38",
      primary: "#c07800",
      accent: "#1568c8",
    },
  },
  {
    id: "zinc",
    name: "Zinc",
    summary: "Brushed aluminum, graphite, workshop-blue rule.",
    colors: {
      bg: "#eceef0",
      surface: "#f6f7f8",
      text: "#1a1d22",
      muted: "#5a616a",
      primary: "#1a4a8c",
      accent: "#1f5c3c",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    summary: "Deep navy with an electric blue CTA.",
    colors: {
      bg: "#070b16",
      surface: "#121a2b",
      text: "#e8eefc",
      muted: "#8a96b4",
      primary: "#6ea8ff",
      accent: "#b8a8ff",
    },
  },
  {
    id: "nebula",
    name: "Nebula",
    summary: "Magenta haze over a violet void.",
    colors: {
      bg: "#120814",
      surface: "#1c1024",
      text: "#f4e8fb",
      muted: "#a88ab8",
      primary: "#e59bff",
      accent: "#7ecbff",
    },
  },
  {
    id: "rose",
    name: "Rose",
    summary: "Champagne pink on a dusky wine base.",
    colors: {
      bg: "#14090d",
      surface: "#1f1116",
      text: "#f8e8ee",
      muted: "#b08a94",
      primary: "#f0a3b5",
      accent: "#e7c9a0",
    },
  },
  {
    id: "cafe",
    name: "Cafe",
    summary: "Espresso, oat milk, and late-afternoon caramel.",
    colors: {
      bg: "#1a1410",
      surface: "#2a221b",
      text: "#f3e8d8",
      muted: "#a89480",
      primary: "#d4a574",
      accent: "#c4b5a0",
    },
  },
  {
    id: "noir",
    name: "Noir",
    summary: "Crime-film black, ivory type, a single crimson cut.",
    colors: {
      bg: "#0c0c0e",
      surface: "#1c1c20",
      text: "#e8dcc8",
      muted: "#9a9084",
      primary: "#e03848",
      accent: "#e8dcc8",
    },
  },
  {
    id: "aurora",
    name: "Aurora",
    summary: "Northern-lights green over a polar purple night.",
    colors: {
      bg: "#0b1018",
      surface: "#141c28",
      text: "#e6f4ee",
      muted: "#8aa0b0",
      primary: "#5ee0b0",
      accent: "#8b7dff",
    },
  },
  {
    id: "primer",
    name: "Primer",
    summary: "Desk charcoal with a link-blue and merge-green.",
    colors: {
      bg: "#0d1117",
      surface: "#161b22",
      text: "#e6edf3",
      muted: "#8b949e",
      primary: "#58a6ff",
      accent: "#3fb950",
    },
  },
  {
    id: "iris",
    name: "Iris",
    summary: "Indigo dusk with a gold petal and lilac edge.",
    colors: {
      bg: "#120c24",
      surface: "#221c3c",
      text: "#f0eaf8",
      muted: "#a098c4",
      primary: "#e0b050",
      accent: "#b89cff",
    },
  },
  {
    id: "harbor",
    name: "Harbor",
    summary: "Fog navy, buoy orange, and a steel-blue rail.",
    colors: {
      bg: "#0c141c",
      surface: "#182430",
      text: "#e8f0f6",
      muted: "#8aa0b0",
      primary: "#f08a3a",
      accent: "#7eb8d4",
    },
  },
  {
    id: "lagoon",
    name: "Lagoon",
    summary: "Tropical night water, coral, and seafoam.",
    colors: {
      bg: "#06161c",
      surface: "#122830",
      text: "#e6f4f2",
      muted: "#7aa8a8",
      primary: "#ff7a62",
      accent: "#5ec8c0",
    },
  },
  {
    id: "harvest",
    name: "Harvest",
    summary: "Warm gray sky, burnt orange, and olive.",
    colors: {
      bg: "#1c1a18",
      surface: "#2c2824",
      text: "#f4ead4",
      muted: "#a09078",
      primary: "#e07828",
      accent: "#b8bb26",
    },
  },
  {
    id: "nord",
    name: "Nord",
    summary: "Polar night, frost cyan, and quiet snow.",
    colors: {
      bg: "#2e3440",
      surface: "#3b4252",
      text: "#eceff4",
      muted: "#9aa3b0",
      primary: "#88c0d0",
      accent: "#a3be8c",
    },
  },
  {
    id: "dusk",
    name: "Dusk",
    summary: "Low-blue night — muted amber on warm charcoal.",
    colors: {
      bg: "#12100f",
      surface: "#1c1916",
      text: "#e8dcc8",
      muted: "#9a8878",
      primary: "#c07048",
      accent: "#7a8a9a",
    },
  },
];

export const DEFAULT_DESIGN_PALETTE: DesignPalette = PALETTE_PRESETS[0]!.colors;

const HEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function normalizeHex(value: string): string | undefined {
  const match = value.trim().match(HEX);
  if (!match?.[1]) return undefined;
  let hex = match[1];
  if (hex.length === 3)
    hex = hex
      .split("")
      .map((ch) => `${ch}${ch}`)
      .join("");
  return `#${hex.toLowerCase()}`;
}

export function parseDesignPalette(value: unknown): DesignPalette | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const next: Partial<DesignPalette> = {};
  for (const role of PALETTE_ROLES) {
    if (typeof row[role] !== "string") return undefined;
    const hex = normalizeHex(row[role]);
    if (!hex) return undefined;
    next[role] = hex;
  }
  return next as DesignPalette;
}

export function resolveDesignPalette(value: unknown): DesignPalette {
  return parseDesignPalette(value) ?? { ...DEFAULT_DESIGN_PALETTE };
}

export function presetIdForPalette(palette: DesignPalette): string | undefined {
  return PALETTE_PRESETS.find((preset) =>
    PALETTE_ROLES.every((role) => preset.colors[role] === palette[role]),
  )?.id;
}

export function paletteCssVars(palette: DesignPalette): string {
  return PALETTE_ROLES.map((role) => `  --${role}: ${palette[role]};`).join("\n");
}

export function paletteStyleTag(palette: DesignPalette, extraVars = ""): string {
  const extras = extraVars.trim() ? `\n${extraVars.trimEnd()}` : "";
  return `<style data-locus-palette>\n:root {\n${paletteCssVars(palette)}${extras}\n}\n</style>`;
}

const PALETTE_STYLE_RE = /<style data-locus-palette>[\s\S]*?<\/style>/gi;

/** Put the operator palette tag last in <head> so it wins over the model's own :root block. */
export function upsertPaletteStyleTag(html: string, tag: string): string {
  const stripped = html.replace(PALETTE_STYLE_RE, "");
  const closeHead = indexOfHtmlMarkup(stripped, /<\/head>/i);
  if (closeHead >= 0) {
    return `${stripped.slice(0, closeHead)}${tag}${stripped.slice(closeHead)}`;
  }
  const head = indexOfHtmlMarkup(stripped, /<head\b[^>]*>/i);
  if (head >= 0) {
    const open = stripped.slice(head).match(/^<head\b[^>]*>/i);
    const at = head + (open?.[0].length ?? 0);
    return `${stripped.slice(0, at)}${tag}${stripped.slice(at)}`;
  }
  const htmlTag = indexOfHtmlMarkup(stripped, /<html\b[^>]*>/i);
  if (htmlTag >= 0) {
    const open = stripped.slice(htmlTag).match(/^<html\b[^>]*>/i);
    const at = htmlTag + (open?.[0].length ?? 0);
    return `${stripped.slice(0, at)}${tag}${stripped.slice(at)}`;
  }
  return `${tag}${stripped}`;
}

export function withPaletteCss(html: string, palette: DesignPalette): string {
  return upsertPaletteStyleTag(html, paletteStyleTag(palette));
}

function cssVarHex(source: string, role: PaletteRole): string | undefined {
  const match = source.match(new RegExp(`--${role}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\b`, "i"));
  return match?.[1] ? normalizeHex(match[1]) : undefined;
}

/** Read --bg/--primary/… from a locus palette tag, or the first :root-style vars in the HTML. */
export function paletteFromHtml(html: string): DesignPalette | undefined {
  const tagged = html.match(/<style data-locus-palette>[\s\S]*?<\/style>/i)?.[0];
  const source = tagged ?? html;
  const next: Partial<DesignPalette> = {};
  for (const role of PALETTE_ROLES) {
    const hex = cssVarHex(source, role);
    if (!hex) return undefined;
    next[role] = hex;
  }
  return next as DesignPalette;
}

function hexForms(hex: string): string[] {
  const normalized = normalizeHex(hex);
  if (!normalized) return [];
  const digits = normalized.slice(1);
  const forms = [normalized];
  if (
    digits.length === 6 &&
    digits[0] === digits[1] &&
    digits[2] === digits[3] &&
    digits[4] === digits[5]
  ) {
    forms.push(`#${digits[0]}${digits[2]}${digits[4]}`);
  }
  return forms;
}

function replacePaletteHex(html: string, from: DesignPalette, to: DesignPalette): string {
  const destBySrc = new Map<string, string>();
  for (const role of PALETTE_ROLES) {
    const src = from[role].toLowerCase();
    if (destBySrc.has(src)) continue;
    destBySrc.set(src, to[role]);
  }
  const tokens = [...destBySrc.keys()].flatMap((src) => hexForms(src).map((form) => form.slice(1)));
  if (!tokens.length) return html;
  const re = new RegExp(`(^|[^0-9a-fA-F])#(${tokens.join("|")})(?![0-9a-fA-F])`, "gi");
  return html.replace(re, (all, prefix: string, digits: string) => {
    const src = normalizeHex(`#${digits}`);
    const dest = src ? destBySrc.get(src) : undefined;
    return dest ? `${prefix}${dest}` : all;
  });
}

/** Swap baked palette hex (CSS vars and hardcoded colors) to the operator's current palette. */
export function recolorDesignHtml(html: string, palette: DesignPalette): string {
  const baked = paletteFromHtml(html);
  if (!baked) return html;
  if (PALETTE_ROLES.every((role) => baked[role] === palette[role])) return html;
  return replacePaletteHex(html, baked, palette);
}

export function formatPalettePrompt(palette: DesignPalette): string {
  const lines = PALETTE_ROLES.map(
    (role) => `- --${role} (${PALETTE_ROLE_LABELS[role].toLowerCase()}): ${palette[role]}`,
  );
  return [
    "Color palette. Put these on :root. --bg is the page; --surface is icon tiles, badges, and inset wells — not full-width cards; --primary is filled CTAs. Do not invent a different scheme or a generic purple gradient.",
    ...lines,
  ].join("\n");
}
