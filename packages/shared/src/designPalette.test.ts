import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN_PALETTE,
  formatPalettePrompt,
  normalizeHex,
  PALETTE_PRESETS,
  paletteFromHtml,
  parseDesignPalette,
  presetIdForPalette,
  recolorDesignHtml,
  resolveDesignPalette,
  withPaletteCss,
} from "./models/designPalette.js";
import { paintDesignCanvasHtml } from "./models/designSystem.js";

function channelLin(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function hexLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channelLin((n >> 16) & 255) +
    0.7152 * channelLin((n >> 8) & 255) +
    0.0722 * channelLin(n & 255)
  );
}

function contrastRatio(a: string, b: string): number {
  const l1 = hexLuminance(a);
  const l2 = hexLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

describe("design palette", () => {
  it("normalizes 3- and 6-digit hex", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("E08A4C")).toBe("#e08a4c");
    expect(normalizeHex("nope")).toBeUndefined();
  });

  it("parses a complete palette and rejects junk", () => {
    expect(parseDesignPalette(DEFAULT_DESIGN_PALETTE)).toEqual(DEFAULT_DESIGN_PALETTE);
    expect(parseDesignPalette({ ...DEFAULT_DESIGN_PALETTE, primary: "red" })).toBeUndefined();
    expect(resolveDesignPalette(undefined)).toEqual(DEFAULT_DESIGN_PALETTE);
    expect(presetIdForPalette(DEFAULT_DESIGN_PALETTE)).toBe("ink");
  });

  it("ships unique starter palettes with AA text and readable muted/primary/accent", () => {
    expect(PALETTE_PRESETS.map((preset) => preset.id)).toEqual([
      "ink",
      "ember",
      "paper",
      "ocean",
      "meadow",
      "contrast",
      "linen",
      "glacier",
      "matcha",
      "folio",
      "blossom",
      "parchment",
      "brief",
      "cel",
      "zinc",
      "midnight",
      "nebula",
      "rose",
      "cafe",
      "noir",
      "aurora",
      "primer",
      "iris",
      "harbor",
      "lagoon",
      "harvest",
      "nord",
      "dusk",
    ]);
    const ids = new Set<string>();
    for (const preset of PALETTE_PRESETS) {
      expect(preset.name.trim().length).toBeGreaterThan(0);
      expect(preset.summary.trim().length).toBeGreaterThan(8);
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);
      const parsed = parseDesignPalette(preset.colors);
      expect(parsed).toEqual(preset.colors);
      expect(presetIdForPalette(preset.colors)).toBe(preset.id);
      expect(contrastRatio(preset.colors.text, preset.colors.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(preset.colors.text, preset.colors.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(preset.colors.muted, preset.colors.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(preset.colors.muted, preset.colors.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(preset.colors.primary, preset.colors.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(preset.colors.accent, preset.colors.bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it("writes CSS variables and a prompt the model can follow", () => {
    const html = withPaletteCss("<html><head></head><body></body></html>", DEFAULT_DESIGN_PALETTE);
    expect(html).toContain("data-locus-palette");
    expect(html).toContain("--primary: #e08a4c");
    expect(html.indexOf("data-locus-palette")).toBeLessThan(html.indexOf("</head>"));
    const again = withPaletteCss(html, { ...DEFAULT_DESIGN_PALETTE, primary: "#111111" });
    expect(again).toContain("--primary: #111111");
    expect(again.split("data-locus-palette").length).toBe(2);
    expect(formatPalettePrompt(DEFAULT_DESIGN_PALETTE)).toContain("--primary (primary): #e08a4c");
    expect(formatPalettePrompt(DEFAULT_DESIGN_PALETTE)).toContain(
      "--surface is icon tiles, badges, and inset wells",
    );
  });

  it("does not inject the palette tag into a script string that mentions </head>", () => {
    const html = withPaletteCss(
      `<html><head><script>const s="</head>";</script></head><body></body></html>`,
      DEFAULT_DESIGN_PALETTE,
    );
    expect(html).toContain('const s="</head>";');
    expect(html).not.toMatch(/const s="<style data-locus-palette>/);
    expect(html.indexOf("data-locus-palette")).toBeGreaterThan(html.indexOf("</script>"));
    expect(html.indexOf("data-locus-palette")).toBeLessThan(html.lastIndexOf("</head>"));
  });

  it("stamps the operator palette after the model's :root so vars win", () => {
    const paper = PALETTE_PRESETS.find((preset) => preset.id === "paper")!.colors;
    const html = withPaletteCss(
      `<html><head><style>:root { --primary: ${DEFAULT_DESIGN_PALETTE.primary}; }</style></head><body></body></html>`,
      paper,
    );
    const agentAt = html.indexOf(`--primary: ${DEFAULT_DESIGN_PALETTE.primary}`);
    const operatorAt = html.lastIndexOf(`--primary: ${paper.primary}`);
    expect(agentAt).toBeGreaterThan(-1);
    expect(operatorAt).toBeGreaterThan(agentAt);
    expect(html.indexOf("data-locus-palette")).toBeGreaterThan(agentAt);
  });

  it("rewrites baked palette hex so hardcoded colors follow a new preset", () => {
    const paper = PALETTE_PRESETS.find((preset) => preset.id === "paper")!.colors;
    const ink = DEFAULT_DESIGN_PALETTE;
    const source = `<html><head><style>:root { --bg: ${ink.bg}; --surface: ${ink.surface}; --text: ${ink.text}; --muted: ${ink.muted}; --primary: ${ink.primary}; --accent: ${ink.accent}; }</style></head><body style="background:${ink.bg}"><a style="background:${ink.primary}">Go</a></body></html>`;
    expect(paletteFromHtml(source)).toEqual(ink);
    const recoded = recolorDesignHtml(source, paper);
    expect(recoded).toContain(`background:${paper.bg}`);
    expect(recoded).toContain(`background:${paper.primary}`);
    expect(recoded).not.toContain(ink.primary);
    const painted = paintDesignCanvasHtml(source, paper);
    expect(painted).toContain(`--primary: ${paper.primary}`);
    expect(painted).toContain(`background:${paper.primary}`);
    expect(painted.indexOf("data-locus-palette")).toBeGreaterThan(painted.indexOf(":root { --bg:"));
  });

  it("remaps overlapping hex in one pass", () => {
    const from = { ...DEFAULT_DESIGN_PALETTE, primary: "#aaa000", accent: "#bbb000" };
    const to = { ...DEFAULT_DESIGN_PALETTE, primary: "#bbb000", accent: "#ccc000" };
    const html = `<html><head><style>:root { --bg: ${from.bg}; --surface: ${from.surface}; --text: ${from.text}; --muted: ${from.muted}; --primary: ${from.primary}; --accent: ${from.accent}; }</style></head><body></body></html>`;
    const recoded = recolorDesignHtml(html, to);
    expect(recoded).toContain("--primary: #bbb000");
    expect(recoded).toContain("--accent: #ccc000");
    expect(recoded).not.toContain("#aaa000");
  });
});
