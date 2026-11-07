/** WCAG relative-luminance helpers for theme readability audits. */

export function parseCssHex(value: string): [number, number, number] | null {
  const raw = value.trim().toLowerCase();
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return [
      Number.parseInt(hex[0]! + hex[0], 16),
      Number.parseInt(hex[1]! + hex[1], 16),
      Number.parseInt(hex[2]! + hex[2], 16),
    ];
  }
  if (/^[0-9a-f]{6}$/.test(hex)) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number | null {
  const rgb = parseCssHex(hex);
  if (!rgb) return null;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(foreground: string, background: string): number | null {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  if (a == null || b == null) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

export interface ThemePalette {
  id: string;
  vars: Record<string, string>;
}

const THEME_BLOCK = /(?::root|\[data-theme="([a-z0-9-]+)"\])\s*\{([\s\S]*?)\}/g;
const VAR_LINE = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;

export function parseThemePalettes(css: string): ThemePalette[] {
  const palettes: ThemePalette[] = [];
  for (const match of css.matchAll(THEME_BLOCK)) {
    const id = match[1] ?? "ember";
    const body = match[2] ?? "";
    const vars: Record<string, string> = {};
    for (const line of body.matchAll(VAR_LINE)) {
      const name = line[1];
      const value = line[2]?.trim();
      if (name && value?.startsWith("#")) vars[name] = value;
    }
    palettes.push({ id, vars });
  }
  return palettes;
}

export interface ContrastCheck {
  pair: string;
  ratio: number;
  minimum: number;
}

export function themeContrastChecks(vars: Record<string, string>): {
  ok: ContrastCheck[];
  fail: ContrastCheck[];
} {
  const pairs: Array<[string, string, string, number]> = [
    ["text", "bg", "text / bg", 4.5],
    ["text", "bg-1", "text / bg-1", 4.5],
    ["muted", "bg", "muted / bg", 4.5],
    ["muted", "bg-1", "muted / bg-1", 4.5],
    ["faint", "bg", "faint / bg", 3],
    ["accent-ink", "accent", "accent-ink / accent", 4.5],
    ["ok", "bg", "ok / bg", 3],
    ["danger", "bg", "danger / bg", 3],
    ["warn", "bg", "warn / bg", 3],
    ["accent", "bg", "accent / bg", 3],
    ["accent-2", "bg", "accent-2 / bg", 3],
    ["term-fg", "term", "term-fg / term", 4.5],
  ];
  const ok: ContrastCheck[] = [];
  const fail: ContrastCheck[] = [];
  for (const [fgKey, bgKey, pair, minimum] of pairs) {
    const fg = vars[fgKey];
    const bg = vars[bgKey];
    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio == null) continue;
    const row = { pair, ratio, minimum };
    if (ratio + 1e-6 >= minimum) ok.push(row);
    else fail.push(row);
  }
  return { ok, fail };
}

/** Muted labels sit on both the page and raised panes, so both must clear AA. */
export function themeReadabilityFailures(vars: Record<string, string>): ContrastCheck[] {
  return themeContrastChecks(vars).fail;
}
