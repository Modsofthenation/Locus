import { normalizeHex, parseDesignPalette, type DesignPalette } from "./designPalette.js";
import type { DesignStartingPoint, DesignSystemDraft } from "./designSystem.js";
import { collectTokenAllowlist } from "./designAdherence.js";
import { parseSkillMarkdown, skillSlashName } from "./skill.js";

const META_FILE = /(?:^|\/)(_ds_manifest\.json|_adherence\.oxlintrc\.json|_ds_bundle\.js)$/i;
const CLAUDE_NS = /\b([A-Z][A-Za-z0-9]*)_([0-9a-f]{6})\b/;
const DEFAULT_SANS = "ui-sans-serif, system-ui, sans-serif";
const DEFAULT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const PRIMARY_SCALE_NAMES = ["primary", "brand", "action", "blue"];
const NEUTRAL_SCALE_NAMES = ["copy", "neutral", "gray", "grey", "text", "fg", "ink", "slate"];
const CHROME_SCALE_NAMES = ["navy", "chrome", "secondary", "accent", "ink", "slate"];
const IMPORT_TEXT = /\.(html?|css|json|md|txt)$/i;
const SKIP_IMPORT = /(?:^|\/)(_ds_bundle\.js)$/i;
const EXTRA_TEXT_CAP = 400_000;

export interface DesignImportFile {
  name: string;
  text: string;
}

export function isClaudeDesignFilename(filename: string): boolean {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? "";
  return /_ds_manifest\.json$/i.test(base) || /_adherence\.oxlintrc\.json$/i.test(base);
}

export function isClaudeDesignManifest(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.namespace !== "string" || !row.namespace.trim()) return false;
  if (row.format === "locus.design-system") return false;
  return (
    Array.isArray(row.cards) ||
    Array.isArray(row.tokens) ||
    Array.isArray(row.startingPoints) ||
    Array.isArray(row.globalCssPaths) ||
    Array.isArray(row.fonts) ||
    Array.isArray(row.themes) ||
    row.source === "spa"
  );
}

export function nameFromClaudeNamespace(namespace: string): string {
  const trimmed = namespace.trim();
  const stripped = trimmed
    .replace(/_[0-9a-f]{6}$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return stripped || trimmed;
}

export function extractClaudeDesignDraft(
  text: string,
  filename = "",
): DesignSystemDraft | undefined {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return undefined;
  let manifest: Record<string, unknown> | undefined;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isClaudeDesignManifest(parsed)) manifest = parsed as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
  }
  return draftFromParts({
    manifest,
    vars: collectVars(trimmed, manifest),
    filename,
    extraText: trimmed,
  });
}

export function extractClaudeDesignDraftFromFiles(
  files: DesignImportFile[],
  filename = "",
): DesignSystemDraft | undefined {
  const usable = files.filter((file) => {
    const path = file.name.replace(/\\/g, "/");
    if (SKIP_IMPORT.test(path) || isSkippedZipImportPath(path)) return false;
    return IMPORT_TEXT.test(path) || isClaudeDesignFilename(path);
  });
  if (!usable.length) return undefined;
  let manifest: Record<string, unknown> | undefined;
  const vars: Record<string, string> = {};
  const chunks: string[] = [];
  let extraLen = 0;
  const sorted = usable
    .slice()
    .sort((a, b) => zipImportRank(a.name) - zipImportRank(b.name) || a.name.localeCompare(b.name));
  for (const file of sorted) {
    const text = file.text.replace(/^\uFEFF/, "");
    if (extraLen < EXTRA_TEXT_CAP) {
      chunks.push(text);
      extraLen += text.length;
    }
    if (!manifest) {
      const base = file.name.replace(/\\/g, "/").split("/").pop() ?? "";
      if (/_ds_manifest\.json$/i.test(base)) {
        try {
          const parsed = JSON.parse(text.trim()) as unknown;
          if (isClaudeDesignManifest(parsed)) manifest = parsed as Record<string, unknown>;
        } catch {
          /* skip invalid manifest */
        }
      }
    }
    Object.assign(vars, collectVars(text));
  }
  if (manifest) Object.assign(vars, varsFromManifest(manifest));
  return draftFromParts({
    manifest,
    vars,
    filename: filename || usable[0]?.name || "",
    extraText: chunks.join("\n").slice(0, EXTRA_TEXT_CAP),
  });
}

/** Lower is read first. Claude Design kits put tokens in preview, design-system, and skill trees. */
export function zipImportRank(name: string): number {
  const n = name.replace(/\\/g, "/").toLowerCase();
  if (n.endsWith("_ds_manifest.json")) return 0;
  if (n.includes("/foundations/") || n.startsWith("foundations/")) return 1;
  if (n.includes("/preview/") || n.startsWith("preview/")) return 2;
  if (/(?:^|\/)(?:tokens|colors_and_type)\.css$/.test(n)) return 3;
  if (n.includes("/design-system/") && n.endsWith(".css")) return 4;
  if (n.includes("/skill/") && /\.(css|md)$/.test(n)) return 5;
  if (n.endsWith(".css")) return 6;
  if (n.endsWith(".html") || n.endsWith(".htm")) return 7;
  if (n.endsWith(".md")) return 8;
  return 9;
}

/** Source dumps, nested archives, and inlined export HTML are not design tokens. */
export function isSkippedZipImportPath(name: string): boolean {
  const n = name.replace(/\\/g, "/").toLowerCase();
  if (!n) return true;
  if (n.startsWith("uploads/") || n.includes("/uploads/")) return true;
  if (n.endsWith(".zip")) return true;
  if ((n.startsWith("export/") || n.includes("/export/")) && /\.html?$/.test(n)) return true;
  return false;
}

const KIT_FILE = /\.(html?|css|json|md|txt|jsx|tsx|js|svg|png|jpe?g|webp|gif|ttf|otf|woff2?)$/i;
const KIT_ROOTS = new Set(["skill", "ui_kits", "assets", "fonts", "design-system", "preview"]);

/**
 * Drop a wrapper folder so kit paths (`skill/…`, `assets/…`) and
 * `Brand/skill/…` both land at the same workspace roots.
 */
export function canonicalKitRel(name: string): string | undefined {
  const parts = name.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean);
  if (!parts.length) return undefined;
  const idx = parts.findIndex((part) => KIT_ROOTS.has(part.toLowerCase()));
  if (idx >= 0) return parts.slice(idx).join("/");
  const last = parts[parts.length - 1]!;
  if (/^colors_and_type\.css$/i.test(last)) return last;
  return undefined;
}

/** Skill, UI kits, assets, and fonts to land in a Design workspace. */
export function isDesignKitPath(name: string): boolean {
  const n = name.replace(/\\/g, "/").toLowerCase();
  if (!n || isSkippedZipImportPath(name)) return false;
  if (n.startsWith("export/") || n.includes("/export/")) return false;
  if (/(?:^|\/)_ds_bundle\.js$/.test(n)) return false;
  if (!KIT_FILE.test(n)) return false;
  return Boolean(canonicalKitRel(name));
}

export function kitImportRank(name: string): number {
  const n = (canonicalKitRel(name) ?? name).replace(/\\/g, "/").toLowerCase();
  if (/(?:^|\/)skill\/[^/]+\/skill\.md$/.test(n)) return 0;
  if (n.startsWith("skill/")) return 1;
  if (n.startsWith("ui_kits/")) return 2;
  if (n.startsWith("assets/")) return 3;
  if (n.startsWith("fonts/")) return 4;
  if (n.startsWith("design-system/")) return 5;
  if (n.startsWith("preview/")) return 6;
  return 7;
}

export function skillFromKitFile(
  path: string,
  markdown: string,
): { name: string; title: string; body: string; path: string } | undefined {
  const n = path.replace(/\\/g, "/");
  const nested = n.match(/(?:^|\/)skill\/([^/]+)\/skill\.md$/i);
  const root = n.match(/(?:^|\/)skill\/skill\.md$/i);
  if (!nested && !root) return undefined;
  const folder = nested?.[1]?.trim() || "brand";
  const name = skillSlashName(folder.replace(/_/g, "-"));
  if (!name) return undefined;
  const parsed = parseSkillMarkdown(`${name}.md`, markdown);
  if (!parsed?.body.trim()) return undefined;
  return { name: parsed.name, title: parsed.title, body: parsed.body, path: n };
}

function collectVars(text: string, manifest?: Record<string, unknown>): Record<string, string> {
  const vars: Record<string, string> = {};
  if (manifest) Object.assign(vars, varsFromManifest(manifest));
  Object.assign(vars, cssVarsFromText(text));
  for (const [key, value] of Object.entries(tokenHexPairs(text))) {
    if (!vars[key]) vars[key] = value;
  }
  return vars;
}

function varsFromManifest(row: Record<string, unknown>): Record<string, string> {
  const vars: Record<string, string> = {};
  const lists: unknown[] = [row.tokens];
  if (Array.isArray(row.themes)) {
    for (const theme of row.themes) {
      if (
        theme &&
        typeof theme === "object" &&
        Array.isArray((theme as { tokens?: unknown }).tokens)
      ) {
        lists.push((theme as { tokens: unknown }).tokens);
      }
    }
  }
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const token = item as Record<string, unknown>;
      const rawName = typeof token.name === "string" ? token.name : "";
      const name = rawName.replace(/^--/, "").toLowerCase().trim();
      const value = typeof token.value === "string" ? token.value.trim() : "";
      if (name && value) vars[name] = value;
    }
  }
  const fonts = fontFamiliesFromManifest(row);
  if (fonts[0] && !vars.sans && !vars["font-sans"] && !vars.fontfamily) {
    vars.sans = fontStackFromFamily(fonts[0]);
  }
  return vars;
}

function fontFamiliesFromManifest(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) out.push(value.trim());
    else if (
      value &&
      typeof value === "object" &&
      typeof (value as { family?: unknown }).family === "string"
    ) {
      const family = (value as { family: string }).family.trim();
      if (family) out.push(family);
    }
  };
  if (Array.isArray(row.fonts)) row.fonts.forEach(push);
  if (Array.isArray(row.brandFonts)) row.brandFonts.forEach(push);
  return out;
}

function cssVarsFromText(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;}{]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const key = match[1]!.toLowerCase();
    const raw = match[2]!.trim();
    if (raw && !raw.includes("{")) vars[key] = raw;
  }
  return vars;
}

function tokenHexPairs(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const pairs: Array<[string, string]> = [];
  const named = /--([a-z0-9-]+)[^#\n]{0,100}(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\b/g;
  const hexFirst = /(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\b[^#\n]{0,100}--([a-z0-9-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = named.exec(text))) pairs.push([match[1]!.toLowerCase(), match[2]!]);
  while ((match = hexFirst.exec(text))) pairs.push([match[2]!.toLowerCase(), match[1]!]);
  for (const [key, hex] of pairs) {
    if (!vars[key] && normalizeHex(hex)) vars[key] = hex;
  }
  return vars;
}

function draftFromParts(input: {
  manifest?: Record<string, unknown>;
  vars: Record<string, string>;
  filename: string;
  extraText: string;
}): DesignSystemDraft | undefined {
  const claude = Boolean(input.manifest);
  const palette = paletteFromTokenVars(input.vars);
  if (!palette) return undefined;
  const name =
    (typeof input.manifest?.namespace === "string"
      ? nameFromClaudeNamespace(input.manifest.namespace)
      : "") ||
    nameFromNamespaceMatch(input.extraText) ||
    nameFromImportFile(input.filename) ||
    "Imported system";
  const type = typographyFromVars(input.vars, input.manifest);
  const radiusPx = lengthFromVars(
    input.vars,
    ["radius", "radius-lg", "rounded-lg", "border-radius"],
    0,
    48,
  );
  const spacePx = lengthFromVars(
    input.vars,
    ["space", "spacing", "space-1", "spacing-1", "space-unit"],
    4,
    32,
  );
  const scaled = hasScaledTokens(input.vars);
  const hasType = Boolean(type.sans || type.display || type.mono || type.basePx);
  return {
    name,
    summary: summaryFromManifest(input.manifest, name),
    palette,
    typography: hasType
      ? {
          sans: type.sans ?? DEFAULT_SANS,
          display: type.display ?? type.sans ?? DEFAULT_SANS,
          mono: type.mono ?? DEFAULT_MONO,
          basePx: type.basePx ?? 16,
        }
      : undefined,
    radiusPx: radiusPx ?? (claude || scaled ? 8 : undefined),
    spacePx: spacePx ?? (claude || scaled ? 4 : undefined),
    guidelines: guidelinesFromManifest(input.manifest, input.extraText),
    tokens: collectTokenAllowlist(input.vars),
    startingPoints: startingPointsFromManifest(input.manifest),
  };
}

export function startingPointsFromManifest(
  manifest?: Record<string, unknown>,
): DesignStartingPoint[] | undefined {
  if (!manifest) return undefined;
  const out: DesignStartingPoint[] = [];
  const seen = new Set<string>();
  const push = (title: string, kind: DesignStartingPoint["kind"]) => {
    const clean = title.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const id = clean
      .toLowerCase()
      .replace(/[^\w]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (!id) return;
    out.push({ id, title: clean.slice(0, 80), kind });
  };
  for (const label of catalogNames(manifest.startingPoints)) push(label, "start");
  for (const name of componentNames(manifest)) push(name, "component");
  return out.length ? out.slice(0, 24) : undefined;
}

export function startingPointsFromKitPaths(names: string[]): DesignStartingPoint[] | undefined {
  const out: DesignStartingPoint[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const n = (canonicalKitRel(name) ?? name).replace(/\\/g, "/");
    const match = n.match(/(?:^|\/)ui_kits\/[^/]+\/([^/]+)\.(jsx|tsx|js|html?)$/i);
    if (!match?.[1]) continue;
    const title = match[1].replace(/[-_]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
    const key = title.toLowerCase();
    if (seen.has(key) || /^(index|tokens)$/i.test(match[1])) continue;
    seen.add(key);
    out.push({
      id: match[1]
        .toLowerCase()
        .replace(/[^\w]+/g, "-")
        .slice(0, 40),
      title: title.slice(0, 80),
      kind: "ui_kit",
    });
    if (out.length >= 24) break;
  }
  return out.length ? out : undefined;
}

function nameFromImportFile(filename: string): string | undefined {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? "";
  if (!base || META_FILE.test(base)) return undefined;
  const stem = base
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!stem || /^(colors|typography|spacing|radius|tokens|index)$/i.test(stem)) return undefined;
  return stem.slice(0, 80);
}

function nameFromNamespaceMatch(text: string): string | undefined {
  const match = text.match(CLAUDE_NS);
  return match?.[1] ? nameFromClaudeNamespace(match[0]) : undefined;
}

function summaryFromManifest(
  manifest: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!manifest) return undefined;
  const source = typeof manifest.source === "string" ? manifest.source.trim() : "";
  if (source === "spa") return `${name} — Claude Design SPA export`;
  if (source) return `${name} — Claude Design export (${source})`;
  return `${name} — Claude Design export`;
}

function guidelinesFromManifest(
  manifest: Record<string, unknown> | undefined,
  extraText: string,
): string | undefined {
  const lines: string[] = [];
  if (manifest) {
    const ns = typeof manifest.namespace === "string" ? manifest.namespace.trim() : "";
    lines.push(
      ns
        ? `Imported from Claude Design (namespace ${ns}). Map brand colors onto --bg (page), --surface (icon tiles / wells), --text, --muted, --primary, --accent, and --line (hairline borders). Cards stay on --bg with a 1px --line border — do not fill them with --surface.`
        : "Imported from Claude Design. Map brand colors onto --bg (page), --surface (icon tiles / wells), --text, --muted, --primary, --accent, and --line (hairline borders). Cards stay on --bg with a 1px --line border — do not fill them with --surface.",
    );
    const components = componentNames(manifest);
    if (components.length) lines.push(`Components: ${components.join(", ")}.`);
    const starts = catalogNames(manifest.startingPoints);
    if (starts.length) lines.push(`Starting points: ${starts.join(", ")}.`);
    const templates = catalogNames(manifest.templates);
    if (templates.length) lines.push(`Templates: ${templates.join(", ")}.`);
  } else if (CLAUDE_NS.test(extraText) || hasScaledTokens(cssVarsFromText(extraText))) {
    lines.push(
      "Imported from a Claude Design token export. Map brand colors onto --bg (page), --surface (icon tiles / wells), --text, --muted, --primary, --accent, and --line (hairline borders). Cards stay on --bg with a 1px --line border — do not fill them with --surface.",
    );
  }
  const joined = lines.join("\n").trim();
  return joined ? joined.slice(0, 4000) : undefined;
}

function catalogNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) names.push(item.trim());
    else if (item && typeof item === "object") {
      const row = item as { name?: unknown; title?: unknown; id?: unknown };
      const label =
        (typeof row.title === "string" && row.title.trim()) ||
        (typeof row.name === "string" && row.name.trim()) ||
        (typeof row.id === "string" && row.id.trim()) ||
        "";
      if (label) names.push(label);
    }
  }
  return names.slice(0, 12);
}

function componentNames(manifest: Record<string, unknown>): string[] {
  const names = new Set<string>();
  if (Array.isArray(manifest.components)) {
    for (const item of manifest.components) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { name?: unknown }).name === "string"
      ) {
        const name = (item as { name: string }).name.trim();
        if (name) names.add(name);
      } else if (typeof item === "string" && item.trim()) names.add(item.trim());
    }
  }
  if (Array.isArray(manifest.cards)) {
    for (const card of manifest.cards) {
      const path = card && typeof card === "object" ? (card as { path?: unknown }).path : undefined;
      if (typeof path !== "string") continue;
      if (!/components\//i.test(path)) continue;
      const stem =
        path
          .replace(/\\/g, "/")
          .split("/")
          .pop()
          ?.replace(/\.[^.]+$/, "") ?? "";
      if (stem) names.add(stem.replace(/[-_]+/g, " "));
    }
  }
  return [...names].slice(0, 24);
}

function typographyFromVars(
  vars: Record<string, string>,
  manifest?: Record<string, unknown>,
): { sans?: string; display?: string; mono?: string; basePx?: number } {
  const sansRaw =
    vars["font-sans"] ||
    vars.sans ||
    vars["font-family"] ||
    vars.fontfamily ||
    vars["font-family-sans"];
  const displayRaw = vars["font-display"] || vars.display || vars["font-heading"] || sansRaw;
  const monoRaw = vars["font-mono"] || vars.mono || vars["font-family-mono"];
  const fonts = manifest ? fontFamiliesFromManifest(manifest) : [];
  const sans = parseFontStack(sansRaw) ?? (fonts[0] ? fontStackFromFamily(fonts[0]) : undefined);
  const display = parseFontStack(displayRaw) ?? sans;
  const mono = parseFontStack(monoRaw);
  const basePx =
    parseLength(
      vars["font-size"] ?? vars["text-body"] ?? vars.body3 ?? vars["font-size-base"],
      10,
      28,
    ) ?? (manifest || hasScaledTokens(vars) ? 16 : undefined);
  return { sans, display, mono, basePx };
}

function fontStackFromFamily(family: string): string {
  const trimmed = family
    .replace(/[\r\n;]/g, " ")
    .trim()
    .slice(0, 160);
  if (!trimmed) return trimmed;
  if (trimmed.includes(",")) return trimmed;
  if (/mono|code/i.test(trimmed))
    return `${trimmed}, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  return `${trimmed}, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
}

function parseFontStack(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const stack = value
    .replace(/[\r\n;]/g, " ")
    .trim()
    .slice(0, 160);
  return stack || undefined;
}

function lengthFromVars(
  vars: Record<string, string>,
  keys: string[],
  min: number,
  max: number,
): number | undefined {
  for (const key of keys) {
    const px = parseLength(vars[key], min, max);
    if (px != null) return px;
  }
  return undefined;
}

function parseLength(value: unknown, min: number, max: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, Math.round(value)));
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const px = trimmed.match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
  if (px) return Math.min(max, Math.max(min, Math.round(Number(px[1]))));
  const rem = trimmed.match(/^(\d+(?:\.\d+)?)rem$/i);
  if (rem) return Math.min(max, Math.max(min, Math.round(Number(rem[1]) * 16)));
  return undefined;
}

export function paletteFromTokenVars(vars: Record<string, string>): DesignPalette | undefined {
  const scales = collectScales(vars);
  const primaryScale = firstScale(scales, PRIMARY_SCALE_NAMES);
  const copyScale = firstScale(scales, NEUTRAL_SCALE_NAMES);
  const chromeScale = firstScale(
    scales,
    CHROME_SCALE_NAMES.filter((name) => name !== primaryScale?.name && name !== copyScale?.name),
  );
  const light = isLightScale(copyScale) ?? isLightScale(primaryScale) ?? true;

  const semantic: Record<string, string | undefined> = {
    bg: pickHex(vars, [
      "bg",
      "background",
      "color-bg",
      "surface-page",
      "page-bg",
      "background-color",
    ]),
    surface: pickHex(vars, ["surface", "color-surface", "background-subtle", "surface-card"]),
    text: pickHex(vars, ["text", "fg", "foreground", "color-text", "text-primary", "text-body"]),
    muted: pickHex(vars, ["muted", "text-muted", "text-secondary", "text-tertiary", "color-muted"]),
    primary: pickHex(vars, ["primary", "color-primary", "brand", "action"]),
    accent: pickHex(vars, ["accent", "color-accent", "secondary", "color-secondary"]),
  };

  semantic.primary ??= scaleHex(primaryScale, [600, 500, 700, 400]);
  semantic.text ??= scaleHex(copyScale, light ? [800, 900, 700] : [50, 100, 200]);
  semantic.muted ??= scaleHex(copyScale, light ? [500, 400, 600] : [400, 300, 500]);
  semantic.bg ??=
    scaleHex(copyScale, light ? [50, 100] : [900, 800]) ??
    scaleHex(primaryScale, light ? [50, 100] : [900, 800]);
  semantic.surface ??=
    scaleHex(copyScale, light ? [100, 50, 200] : [800, 700, 900]) ??
    scaleHex(chromeScale, light ? [50, 100] : [800, 700]);
  semantic.accent ??=
    scaleHex(chromeScale, [600, 500, 700]) ?? scaleHex(primaryScale, [400, 500, 300]);

  if (semantic.bg && semantic.surface && semantic.bg === semantic.surface) {
    semantic.surface = scaleHex(copyScale, light ? [100, 200] : [800, 700]) ?? semantic.surface;
  }
  if (semantic.primary && semantic.accent && semantic.primary === semantic.accent) {
    semantic.accent =
      scaleHex(chromeScale, [600, 700]) ?? scaleHex(primaryScale, [800, 400]) ?? semantic.accent;
  }

  return parseDesignPalette({
    bg: semantic.bg,
    surface: semantic.surface,
    text: semantic.text,
    muted: semantic.muted,
    primary: semantic.primary,
    accent: semantic.accent,
  });
}

function hasScaledTokens(vars: Record<string, string>): boolean {
  return Object.keys(vars).some((key) =>
    /^(?:color-)?(primary|brand|copy|neutral|gray|navy)-[0-9]{2,3}$/.test(key),
  );
}

function pickHex(vars: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const hex = hexFromCss(vars[name]);
    if (hex) return hex;
  }
  return undefined;
}

function hexFromCss(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const hex = normalizeHex(trimmed);
  if (hex) return hex;
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)/i);
  if (rgb) {
    const toHex = (n: string) =>
      Math.min(255, Math.max(0, Number(n)))
        .toString(16)
        .padStart(2, "0");
    return normalizeHex(`#${toHex(rgb[1]!)}${toHex(rgb[2]!)}${toHex(rgb[3]!)}`);
  }
  return undefined;
}

interface ColorScale {
  name: string;
  steps: Map<number, string>;
}

function collectScales(vars: Record<string, string>): ColorScale[] {
  const byName = new Map<string, Map<number, string>>();
  for (const [key, value] of Object.entries(vars)) {
    const match = key.match(/^(?:color-)?([a-z]+)-([0-9]{2,3})$/);
    if (!match) continue;
    const hex = hexFromCss(value);
    if (!hex) continue;
    const name = match[1]!;
    const step = Number(match[2]);
    if (![50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].includes(step)) continue;
    const steps = byName.get(name) ?? new Map<number, string>();
    steps.set(step, hex);
    byName.set(name, steps);
  }
  return [...byName.entries()].map(([name, steps]) => ({ name, steps }));
}

function firstScale(scales: ColorScale[], names: string[]): ColorScale | undefined {
  for (const name of names) {
    const found = scales.find((scale) => scale.name === name);
    if (found) return found;
  }
  return undefined;
}

function scaleHex(scale: ColorScale | undefined, steps: number[]): string | undefined {
  if (!scale) return undefined;
  for (const step of steps) {
    const hex = scale.steps.get(step);
    if (hex) return hex;
  }
  return undefined;
}

function isLightScale(scale: ColorScale | undefined): boolean | undefined {
  if (!scale) return undefined;
  const light = scale.steps.get(50) ?? scale.steps.get(100);
  const dark = scale.steps.get(900) ?? scale.steps.get(800);
  if (!light || !dark) return undefined;
  return hexLuminance(light) > hexLuminance(dark);
}

function hexLuminance(hex: string): number {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(n)) return 0;
  const lin = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
