import {
  formatPalettePrompt,
  paletteStyleTag,
  PALETTE_PRESETS,
  parseDesignPalette,
  recolorDesignHtml,
  upsertPaletteStyleTag,
  withPaletteCss,
  type DesignPalette,
  type PalettePreset,
} from "./designPalette.js";
import {
  extractClaudeDesignDraft,
  extractClaudeDesignDraftFromFiles,
  isClaudeDesignFilename,
  isClaudeDesignManifest,
  paletteFromTokenVars,
  type DesignImportFile,
} from "./claudeDesign.js";
import { formatTokenAllowlistPrompt, type DesignToken } from "./designAdherence.js";
import { type DesignTune } from "./designTune.js";

export const DESIGN_SYSTEM_FORMAT = "locus.design-system";
export const DESIGN_SYSTEM_VERSION = 1;
export const MAX_DESIGN_SYSTEMS = 48;
/** Claude Design zips can include fonts and source uploads we skip; cap the archive, not extracted tokens. */
export const MAX_DESIGN_IMPORT_BYTES = 128 * 1024 * 1024;
/** JSON import (text / base64) stays small so the renderer and API never materialize a 100 MB string. */
export const MAX_DESIGN_IMPORT_JSON_BYTES = 16 * 1024 * 1024;

export function formatDesignImportBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export interface DesignTypography {
  sans: string;
  display: string;
  mono: string;
  basePx: number;
}

export interface DesignSystemKit {
  skillName?: string;
  skillTitle?: string;
  fileCount: number;
  bytes: number;
}

export interface DesignStartingPoint {
  id: string;
  title: string;
  kind: "start" | "component" | "ui_kit";
}

export interface DesignSystem {
  id: string;
  name: string;
  summary: string;
  palette: DesignPalette;
  typography: DesignTypography;
  radiusPx: number;
  spacePx: number;
  guidelines?: string;
  kit?: DesignSystemKit;
  tokens?: DesignToken[];
  startingPoints?: DesignStartingPoint[];
  createdAt: string;
  updatedAt: string;
}

export interface DesignSystemFile {
  format: typeof DESIGN_SYSTEM_FORMAT;
  version: number;
  system: DesignSystemDraft;
}

export type DesignSystemDraft = Partial<Omit<DesignSystem, "palette">> & {
  palette?: unknown;
};

export const DEFAULT_DESIGN_TYPOGRAPHY: DesignTypography = {
  sans: "ui-sans-serif, system-ui, sans-serif",
  display: "ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  basePx: 16,
};

export const DEFAULT_DESIGN_RADIUS_PX = 12;
export const DEFAULT_DESIGN_SPACE_PX = 8;

export function parseDesignSystemKit(value: unknown): DesignSystemKit | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const fileCount =
    typeof row.fileCount === "number" && Number.isFinite(row.fileCount)
      ? Math.max(0, Math.round(row.fileCount))
      : 0;
  if (fileCount <= 0) return undefined;
  const bytes =
    typeof row.bytes === "number" && Number.isFinite(row.bytes)
      ? Math.max(0, Math.round(row.bytes))
      : 0;
  const skillName = typeof row.skillName === "string" ? row.skillName.trim().toLowerCase() : "";
  const skillTitle = typeof row.skillTitle === "string" ? row.skillTitle.trim() : "";
  return {
    fileCount,
    bytes,
    skillName: skillName && /^[a-z][a-z0-9-]{0,31}$/.test(skillName) ? skillName : undefined,
    skillTitle: skillTitle ? skillTitle.slice(0, 80) : undefined,
  };
}

export function builtinDesignSystemId(presetId: string): string {
  return `preset:${presetId}`;
}

export function isBuiltinDesignSystemId(id: string): boolean {
  return id.startsWith("preset:");
}

export function designSystemFromPreset(
  preset: PalettePreset,
  at = "2020-01-01T00:00:00.000Z",
): DesignSystem {
  return {
    id: builtinDesignSystemId(preset.id),
    name: preset.name,
    summary: preset.summary,
    palette: { ...preset.colors },
    typography: { ...DEFAULT_DESIGN_TYPOGRAPHY },
    radiusPx: DEFAULT_DESIGN_RADIUS_PX,
    spacePx: DEFAULT_DESIGN_SPACE_PX,
    createdAt: at,
    updatedAt: at,
  };
}

export function builtinDesignSystems(): DesignSystem[] {
  return PALETTE_PRESETS.map((preset) => designSystemFromPreset(preset));
}

export function parseDesignTypography(value: unknown): DesignTypography | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const sans = parseFontStack(row.sans);
  const display = parseFontStack(row.display) ?? sans;
  const mono = parseFontStack(row.mono);
  const basePx = parseCssPx(row.basePx, 10, 28) ?? DEFAULT_DESIGN_TYPOGRAPHY.basePx;
  if (!sans || !mono) return undefined;
  return { sans, display: display ?? sans, mono, basePx };
}

export function resolveDesignTypography(value: unknown): DesignTypography {
  return parseDesignTypography(value) ?? { ...DEFAULT_DESIGN_TYPOGRAPHY };
}

export function parseDesignSystem(value: unknown): DesignSystem | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!id || !name) return undefined;
  const palette = parseDesignPalette(row.palette);
  if (!palette) return undefined;
  const createdAt =
    typeof row.createdAt === "string" && row.createdAt.trim() ? row.createdAt.trim() : undefined;
  const updatedAt =
    typeof row.updatedAt === "string" && row.updatedAt.trim() ? row.updatedAt.trim() : createdAt;
  if (!createdAt || !updatedAt) return undefined;
  const summary = typeof row.summary === "string" ? row.summary.trim() : "";
  const guidelines = typeof row.guidelines === "string" ? row.guidelines.trim() : "";
  return {
    id,
    name: name.slice(0, 80),
    summary: summary.slice(0, 240),
    palette,
    typography: resolveDesignTypography(row.typography),
    radiusPx: parseCssPx(row.radiusPx, 0, 48) ?? DEFAULT_DESIGN_RADIUS_PX,
    spacePx: parseCssPx(row.spacePx, 4, 32) ?? DEFAULT_DESIGN_SPACE_PX,
    guidelines: guidelines ? guidelines.slice(0, 4000) : undefined,
    kit: parseDesignSystemKit(row.kit),
    tokens: parseDesignTokens(row.tokens),
    startingPoints: parseDesignStartingPoints(row.startingPoints),
    createdAt,
    updatedAt,
  };
}

export function parseDesignSystemFile(value: unknown): DesignSystemDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (row.format === DESIGN_SYSTEM_FORMAT && row.system && typeof row.system === "object") {
    return row.system as DesignSystemDraft;
  }
  if (typeof row.name === "string" || row.palette) return row as DesignSystemDraft;
  return undefined;
}

export function materializeDesignSystem(
  draft: DesignSystemDraft,
  opts: { id: string; createdAt: string; updatedAt?: string; fallbackName?: string },
): DesignSystem | undefined {
  const palette = parseDesignPalette(draft.palette);
  if (!palette) return undefined;
  const name = (typeof draft.name === "string" ? draft.name.trim() : "") || opts.fallbackName || "";
  if (!name) return undefined;
  const summary = typeof draft.summary === "string" ? draft.summary.trim() : "";
  const guidelines = typeof draft.guidelines === "string" ? draft.guidelines.trim() : "";
  return {
    id: opts.id,
    name: name.slice(0, 80),
    summary: summary.slice(0, 240),
    palette,
    typography: resolveDesignTypography(draft.typography),
    radiusPx: parseCssPx(draft.radiusPx, 0, 48) ?? DEFAULT_DESIGN_RADIUS_PX,
    spacePx: parseCssPx(draft.spacePx, 4, 32) ?? DEFAULT_DESIGN_SPACE_PX,
    guidelines: guidelines ? guidelines.slice(0, 4000) : undefined,
    kit: parseDesignSystemKit(draft.kit),
    tokens: parseDesignTokens(draft.tokens),
    startingPoints: parseDesignStartingPoints(draft.startingPoints),
    createdAt: opts.createdAt,
    updatedAt: opts.updatedAt ?? opts.createdAt,
  };
}

export function resolveDesignSystem(
  id: string | undefined,
  stored: DesignSystem[],
): DesignSystem | undefined {
  const key = id?.trim();
  if (!key) return undefined;
  return (
    stored.find((row) => row.id === key) ?? builtinDesignSystems().find((row) => row.id === key)
  );
}

export function exportDesignSystem(system: DesignSystem): DesignSystemFile {
  return {
    format: DESIGN_SYSTEM_FORMAT,
    version: DESIGN_SYSTEM_VERSION,
    system: {
      name: system.name,
      summary: system.summary,
      palette: system.palette,
      typography: system.typography,
      radiusPx: system.radiusPx,
      spacePx: system.spacePx,
      guidelines: system.guidelines,
      tokens: system.tokens,
      startingPoints: system.startingPoints,
    },
  };
}

export function designSystemFileName(system: Pick<DesignSystem, "name">): string {
  const stem =
    system.name
      .trim()
      .toLowerCase()
      .replace(/[^\w]+/g, "-")
      .replace(/^-+|-+$/g, "") || "design-system";
  return `${stem}.locus-design.json`;
}

export const DESIGN_LINE_CSS = "color-mix(in srgb, var(--text) 14%, var(--bg))";

export function designTokenCssVars(
  system: Pick<DesignSystem, "typography" | "radiusPx" | "spacePx">,
): string {
  return [
    `  --font-sans: ${system.typography.sans};`,
    `  --font-display: ${system.typography.display};`,
    `  --font-mono: ${system.typography.mono};`,
    `  --font-size: ${system.typography.basePx}px;`,
    `  --radius: ${system.radiusPx}px;`,
    `  --space: ${system.spacePx}px;`,
    `  --line: ${DESIGN_LINE_CSS};`,
  ].join("\n");
}

export function withDesignSystemCss(html: string, system: DesignSystem): string {
  return upsertPaletteStyleTag(html, paletteStyleTag(system.palette, designTokenCssVars(system)));
}

/** Recolor baked hex, then stamp operator :root vars last in <head> so the canvas restyles live. */
export function paintDesignCanvasHtml(
  html: string,
  palette: DesignPalette,
  system?: DesignSystem,
): string {
  const recoded = recolorDesignHtml(html, palette);
  return system
    ? withDesignSystemCss(recoded, { ...system, palette })
    : withPaletteCss(recoded, palette);
}

export function formatDesignLayoutPrompt(
  system?: Pick<DesignSystem, "radiusPx" | "spacePx">,
): string {
  const unit = system?.spacePx ?? DEFAULT_DESIGN_SPACE_PX;
  const radius = system?.radiusPx ?? DEFAULT_DESIGN_RADIUS_PX;
  return [
    "Product UI habits:",
    `- Page sits on --bg. Raised cards and list rows sit on --bg with a 1px --line border and ${radius}px corners. Do not fill a whole card with --surface.`,
    "- --surface is only for icon tiles, badges, chips, and inset wells.",
    `- --space (${unit}px) is the grid unit, not card padding. Use 4× for card padding, 6× for section gaps, 8× for page inset.`,
    "- Page header: title + muted subtitle, primary CTA top-right. Section kickers: uppercase muted label and optional count badge.",
    "- List rows: content left, actions right. Primary is filled --primary; secondary is an outline on --primary; destructive is an icon, not a third filled button.",
    "- Starters: single-row cards with a --surface icon tile, title + meta, and a + affordance.",
    "- No drop shadows or purple gradients. Hairline borders, generous whitespace, ~72px header rhythm.",
  ].join("\n");
}

export function formatDesignSystemPrompt(system: DesignSystem, palette = system.palette): string {
  const kit = system.kit;
  return [
    formatPalettePrompt(palette),
    kit
      ? "Typography and layout tokens. Put these on :root with the colors. Load kit fonts from /workspace/fonts with @font-face; do not use CDNs or Google Fonts."
      : "Typography and layout tokens. Put these on :root with the colors. Do not load webfonts or CDNs; use these stacks as-is.",
    `- --font-sans: ${system.typography.sans}`,
    `- --font-display: ${system.typography.display}`,
    `- --font-mono: ${system.typography.mono}`,
    `- --font-size: ${system.typography.basePx}px`,
    `- --radius: ${system.radiusPx}px`,
    `- --space: ${system.spacePx}px`,
    `- --line: ${DESIGN_LINE_CSS}`,
    formatDesignLayoutPrompt(system),
    kit && system.tokens?.length ? formatTokenAllowlistPrompt(system.tokens) : "",
    kit ? formatDesignKitPrompt(kit) : "",
    system.guidelines ? `Brand guidelines:\n${system.guidelines}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatDesignKitPrompt(kit: DesignSystemKit): string {
  const skill = kit.skillName
    ? `- Brand skill: /workspace/.locus/skills/${kit.skillName}.md and /workspace/skill/${kit.skillName}/SKILL.md. Follow it for every canvas.`
    : "";
  return [
    `A brand kit (${kit.fileCount} files) is in the workspace. Local kit files are allowed; no external CDNs.`,
    skill,
    "- UI kits: /workspace/ui_kits/ (marketing and product). Port those components into /workspace/index.html. There is no JSX bundler — emit HTML and CSS.",
    "- Assets: /workspace/assets/ (logos). Use relative URLs such as assets/logo.svg.",
    '- Fonts: /workspace/fonts/ via @font-face url("fonts/<file>").',
    "- Tokens: /workspace/colors_and_type.css and /workspace/design-system/.",
    "Keep /workspace/index.html as the live canvas. Read the skill and ui_kits before inventing layout.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Pull palette and token vars from a Locus export, Claude Design export, CSS, or canvas HTML. */
export function extractDesignSystemDraft(
  text: string,
  filename = "",
): DesignSystemDraft | undefined {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed) as unknown;
      const parsed = parseDesignSystemFile(json);
      if (parsed) return parsed;
      const claude = extractClaudeDesignDraft(trimmed, filename);
      if (claude) return claude;
    } catch {
      /* fall through to CSS */
    }
  }
  const claude = extractClaudeDesignDraft(trimmed, filename);
  if (claude) return claude;
  const vars = cssVarsFromText(trimmed);
  const palette =
    parseDesignPalette({
      bg: vars.bg,
      surface: vars.surface,
      text: vars.text,
      muted: vars.muted,
      primary: vars.primary,
      accent: vars.accent,
    }) ?? paletteFromTokenVars(vars);
  if (!palette) return undefined;
  const nameFromFile = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return {
    name: nameFromFile || "Imported system",
    palette,
    typography: resolveDesignTypography({
      sans: vars["font-sans"] ?? vars.sans,
      display: vars["font-display"] ?? vars.display,
      mono: vars["font-mono"] ?? vars.mono,
      basePx: vars["font-size"],
    }),
    radiusPx: parseCssPx(vars.radius, 0, 48),
    spacePx: parseCssPx(vars.space, 4, 32),
  };
}

export function extractDesignSystemDraftFromFiles(
  files: DesignImportFile[],
  filename = "",
): DesignSystemDraft | undefined {
  for (const file of files) {
    const parsed = tryLocusJson(file.text);
    if (parsed) return parsed;
  }
  return extractClaudeDesignDraftFromFiles(files, filename);
}

export function claudeDesignImportHint(text?: string, filename = ""): string | undefined {
  if (isClaudeDesignFilename(filename)) {
    return "Claude Design export has no color tokens. Import the downloaded .zip so foundations HTML is included.";
  }
  if (!text?.trim().startsWith("{")) return undefined;
  try {
    if (isClaudeDesignManifest(JSON.parse(text) as unknown)) {
      return "Claude Design export has no color tokens. Import the downloaded .zip so foundations HTML is included.";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function applyDesignTune(system: DesignSystem, tune?: DesignTune): DesignSystem {
  if (!tune) return system;
  return {
    ...system,
    radiusPx: tune.radiusPx ?? system.radiusPx,
    spacePx: tune.spacePx ?? system.spacePx,
    typography: {
      ...system.typography,
      basePx: tune.fontPx ?? system.typography.basePx,
    },
  };
}

export function parseDesignTokens(value: unknown): DesignToken[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: DesignToken[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; value?: unknown };
    const name =
      typeof row.name === "string" ? row.name.replace(/^--/, "").trim().toLowerCase() : "";
    const tokenValue = typeof row.value === "string" ? row.value.trim() : "";
    if (!name || !tokenValue || seen.has(name)) continue;
    seen.add(name);
    out.push({ name: name.slice(0, 80), value: tokenValue.slice(0, 160) });
    if (out.length >= 80) break;
  }
  return out.length ? out : undefined;
}

export function parseDesignStartingPoints(value: unknown): DesignStartingPoint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: DesignStartingPoint[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; title?: unknown; kind?: unknown };
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!title) continue;
    const id =
      (typeof row.id === "string" && row.id.trim()) ||
      title
        .toLowerCase()
        .replace(/[^\w]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const kind =
      row.kind === "component" || row.kind === "ui_kit" || row.kind === "start"
        ? row.kind
        : "start";
    out.push({ id, title: title.slice(0, 80), kind });
    if (out.length >= 24) break;
  }
  return out.length ? out : undefined;
}

export function mergeStartingPoints(
  ...lists: Array<DesignStartingPoint[] | undefined>
): DesignStartingPoint[] | undefined {
  const out: DesignStartingPoint[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const point of list ?? []) {
      const key = point.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(point);
      if (out.length >= 24) return out;
    }
  }
  return out.length ? out : undefined;
}

function tryLocusJson(text: string): DesignSystemDraft | undefined {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return parseDesignSystemFile(JSON.parse(trimmed) as unknown);
  } catch {
    return undefined;
  }
}

function parseFontStack(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const stack = value
    .replace(/[\r\n;]/g, " ")
    .trim()
    .slice(0, 160);
  return stack || undefined;
}

function parseCssPx(value: unknown, min: number, max: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, Math.round(value)));
  }
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
  if (!match) return undefined;
  return Math.min(max, Math.max(min, Math.round(Number(match[1]))));
}

function cssVarsFromText(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;}{]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const key = match[1]!.toLowerCase();
    const raw = match[2]!.trim();
    if (raw) vars[key] = raw;
  }
  return vars;
}
