import {
  normalizeHex,
  paletteStyleTag,
  upsertPaletteStyleTag,
  type DesignPalette,
} from "./designPalette.js";

export const REQUIRED_CANVAS_VARS = [
  "bg",
  "surface",
  "text",
  "muted",
  "primary",
  "accent",
  "line",
] as const;

export const MAX_ADHERENCE_NUDGES = 2;

export const ADHERENCE_NUDGE_PREFIX = "The canvas failed design-system adherence.";

export const DESIGN_ADHERENCE_NEEDS_HUMAN =
  "Design canvas still fails kit adherence. Needs a human.";

export const MAX_TOKEN_ALLOWLIST = 80;

export type AdherenceIssueCode = "hex" | "cdn" | "fonts" | "vars" | "surface-card";

export interface AdherenceIssue {
  code: AdherenceIssueCode;
  detail: string;
}

export interface DesignToken {
  name: string;
  value: string;
}

export interface AdherenceContext {
  kit?: boolean;
  palette?: DesignPalette;
  /** Extra :root lines (--font-sans, --radius, --space, --line). */
  tokenCss?: string;
  tokens?: DesignToken[];
}

const CDN =
  /fonts\.googleapis\.com|fonts\.gstatic\.com|fonts\.bunny\.net|use\.typekit\.net|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|ajax\.googleapis\.com/i;
const LINK_CDN =
  /<link\b[^>]*(?:href|src)\s*=\s*["'][^"']*(?:fonts\.googleapis|fonts\.gstatic|fonts\.bunny|typekit\.net|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|ajax\.googleapis)[^"']*["'][^>]*>/gi;
const SCRIPT_CDN =
  /<script\b[^>]*src\s*=\s*["'][^"']*(?:fonts\.googleapis|fonts\.gstatic|fonts\.bunny|typekit\.net|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|ajax\.googleapis)[^"']*["'][^>]*>(?:\s*<\/script>)?/gi;
const IMPORT_CDN =
  /@import\s+(?:url\s*\(\s*)?["'][^"']*(?:fonts\.googleapis|fonts\.gstatic|fonts\.bunny|typekit\.net|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|ajax\.googleapis)[^"']*["']\s*\)?\s*;?/gi;
const FONT_FACE_HTTP = /@font-face\s*\{[^}]*url\(\s*["']?https?:\/\//i;
const HEX_VALUE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const CUSTOM_PROP_HEX = /--[a-z0-9-]+\s*:\s*#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/gi;

export function formatAdherenceNudge(issues: AdherenceIssue[]): string {
  const lines = issues.slice(0, 8).map((issue) => `- ${issue.detail}`);
  return [
    ADHERENCE_NUDGE_PREFIX,
    "Fix with apply_patch or file_write. Use kit CSS variables, not raw hex. No Google Fonts or CDNs. Cards sit on --bg with a 1px --line — do not fill them with --surface. Kit fonts load from fonts/ via @font-face.",
    ...lines,
  ].join("\n");
}

export function isAdherenceNudge(content?: string): boolean {
  return Boolean(content?.startsWith(ADHERENCE_NUDGE_PREFIX));
}

/** Leftover kit issues after the adherence cap cannot ship. */
export function designAdherenceNeedsHuman(issues: AdherenceIssue[]): string | undefined {
  if (!issues.length) return undefined;
  return DESIGN_ADHERENCE_NEEDS_HUMAN;
}

export function collectTokenAllowlist(vars: Record<string, string>): DesignToken[] {
  const out: DesignToken[] = [];
  const seen = new Set<string>();
  const keys = Object.keys(vars).sort((a, b) => tokenRank(a) - tokenRank(b) || a.localeCompare(b));
  for (const key of keys) {
    const name = key.replace(/^--/, "").toLowerCase();
    if (!name || seen.has(name)) continue;
    const value = vars[key]?.trim();
    if (!value || value.length > 160) continue;
    seen.add(name);
    out.push({ name, value });
    if (out.length >= MAX_TOKEN_ALLOWLIST) break;
  }
  return out;
}

function tokenRank(key: string): number {
  const n = key.replace(/^--/, "").toLowerCase();
  if (/^(primary|brand|copy|neutral|gray|grey|navy|text|fg|surface|bg|accent)-[0-9]{2,3}$/.test(n))
    return 0;
  if (
    /^(primary|bg|surface|text|muted|accent|line|radius|space|font-sans|font-display|font-mono)$/.test(
      n,
    )
  )
    return 1;
  if (/^(color|font|radius|space|spacing)/.test(n)) return 2;
  return 3;
}

export function formatTokenAllowlistPrompt(tokens: DesignToken[]): string {
  if (!tokens.length) return "";
  const rows = tokens
    .slice(0, MAX_TOKEN_ALLOWLIST)
    .map((token) => `- --${token.name}: ${token.value}`);
  return [
    "Kit tokens. Use these CSS variable names in the canvas. Do not invent hex or load CDNs.",
    ...rows,
    "The semantic aliases --bg, --surface, --text, --muted, --primary, --accent, and --line still apply for page chrome.",
  ].join("\n");
}

/** Cheap host-side patches, then leftover issues for one nudge round. */
export function enforceDesignAdherence(
  html: string,
  ctx: AdherenceContext = {},
): { html: string; issues: AdherenceIssue[]; patched: boolean } {
  if (!html.trim()) return { html, issues: [], patched: false };
  let next = html;
  const kit = Boolean(ctx.kit);
  if (kit) next = stripCdnFonts(next);
  next = patchSurfaceCards(next);
  const palette = ctx.palette;
  if (palette && missingRootVars(next).length) {
    next = upsertPaletteStyleTag(next, paletteStyleTag(palette, tokenCssWithLine(ctx.tokenCss)));
  }
  if (kit && ctx.tokens?.length) next = replaceKnownHex(next, ctx.tokens);

  const issues: AdherenceIssue[] = [];
  if (kit) {
    if (CDN.test(next)) {
      issues.push({ code: "cdn", detail: "Remove Google Fonts / CDN stylesheet links." });
    }
    if (FONT_FACE_HTTP.test(next)) {
      issues.push({
        code: "fonts",
        detail: "Load kit fonts from fonts/<file> via @font-face, not a remote URL.",
      });
    }
    const leftover = rawHexOutsideTokens(next);
    if (leftover.length) {
      issues.push({
        code: "hex",
        detail: `Replace raw hex (${leftover.slice(0, 4).join(", ")}) with kit CSS variables.`,
      });
    }
  }
  if (palette || ctx.tokenCss) {
    const missing = missingRootVars(next);
    if (missing.length) {
      issues.push({
        code: "vars",
        detail: `Put ${missing.map((name) => `--${name}`).join(", ")} on :root.`,
      });
    }
  }
  if (hasSurfaceCards(next)) {
    issues.push({
      code: "surface-card",
      detail: "Cards and list rows sit on --bg with a 1px --line, not a --surface fill.",
    });
  }

  return { html: next, issues, patched: next !== html };
}

const LINE_FALLBACK = "  --line: color-mix(in srgb, var(--text) 14%, var(--bg));";

function tokenCssWithLine(tokenCss?: string): string {
  if (tokenCss && /--line\s*:/.test(tokenCss)) return tokenCss;
  return `${tokenCss?.trimEnd() ?? ""}\n${LINE_FALLBACK}`.trimStart();
}

function stripCdnFonts(html: string): string {
  return html.replace(LINK_CDN, "").replace(SCRIPT_CDN, "").replace(IMPORT_CDN, "");
}

function patchSurfaceCards(html: string): string {
  return html.replace(
    /((?:\.card\b|(?:^|[,\s>{}])article\b|\.panel\b|\.tile\b|\[class\*=["']card)[^{]{0,200}\{[^}]*?)background(?:-color)?\s*:\s*var\(\s*--surface\s*\)/gi,
    "$1background: var(--bg)",
  );
}

function hasSurfaceCards(html: string): boolean {
  return /(?:(?:\.card\b|(?:^|[,\s>{}])article\b|\.panel\b|\.tile\b|\[class\*=["']card))[^{]{0,200}\{[^}]*background(?:-color)?\s*:\s*var\(\s*--surface\s*\)/i.test(
    html,
  );
}

function replaceKnownHex(html: string, tokens: DesignToken[]): string {
  const byHex = new Map<string, string>();
  for (const token of tokens) {
    const hex = normalizeHex(token.value);
    if (!hex) continue;
    const prev = byHex.get(hex);
    if (!prev || tokenRank(token.name) < tokenRank(prev)) byHex.set(hex, token.name);
  }
  if (!byHex.size) return html;
  return html.replace(
    /(--[a-z0-9-]+\s*:\s*)?(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b)/gi,
    (all, def: string | undefined, hex: string) => {
      if (def) return all;
      const name = byHex.get(normalizeHex(hex) ?? "");
      return name ? `var(--${name})` : all;
    },
  );
}

function rawHexOutsideTokens(html: string): string[] {
  const withoutDefs = html.replace(CUSTOM_PROP_HEX, "");
  const found = withoutDefs.match(HEX_VALUE) ?? [];
  const unique: string[] = [];
  for (const raw of found) {
    const hex = normalizeHex(raw);
    if (hex && !unique.includes(hex)) unique.push(hex);
    if (unique.length >= 8) break;
  }
  return unique;
}

function missingRootVars(html: string): string[] {
  return REQUIRED_CANVAS_VARS.filter((name) => {
    const re = new RegExp(`--${name}\\s*:`);
    return !re.test(html);
  });
}
