import { formatAssetBuildLines, resolveAssetBuild, type AssetBuild } from "./assetBuild.js";
import { parseDesignPalette, type DesignPalette } from "./designPalette.js";

export const ASSET_STYLE_FORMAT = "locus.asset-style";
export const ASSET_STYLE_VERSION = 1;
export const MAX_ASSET_STYLES = 48;

export interface AssetStyle {
  id: string;
  name: string;
  summary: string;
  guidelines: string;
  palette?: DesignPalette;
  sourceSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetStyleFile {
  format: typeof ASSET_STYLE_FORMAT;
  version: number;
  style: AssetStyleDraft;
}

export type AssetStyleDraft = Partial<AssetStyle>;

export function parseAssetStyle(value: unknown): AssetStyle | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!id || !name) return undefined;
  const createdAt =
    typeof row.createdAt === "string" && row.createdAt.trim() ? row.createdAt.trim() : undefined;
  const updatedAt =
    typeof row.updatedAt === "string" && row.updatedAt.trim() ? row.updatedAt.trim() : createdAt;
  if (!createdAt || !updatedAt) return undefined;
  const summary = typeof row.summary === "string" ? row.summary.trim() : "";
  const guidelines = typeof row.guidelines === "string" ? row.guidelines.trim() : "";
  const sourceSessionId = typeof row.sourceSessionId === "string" ? row.sourceSessionId.trim() : "";
  return {
    id,
    name: name.slice(0, 80),
    summary: summary.slice(0, 240),
    guidelines: guidelines.slice(0, 4000),
    palette: parseDesignPalette(row.palette),
    sourceSessionId: sourceSessionId || undefined,
    createdAt,
    updatedAt,
  };
}

export function parseAssetStyleFile(value: unknown): AssetStyleDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (row.format === ASSET_STYLE_FORMAT && row.style && typeof row.style === "object") {
    return row.style as AssetStyleDraft;
  }
  if (typeof row.name === "string" || typeof row.guidelines === "string") {
    return row as AssetStyleDraft;
  }
  return undefined;
}

export function materializeAssetStyle(
  draft: AssetStyleDraft,
  opts: { id: string; createdAt: string; updatedAt?: string; fallbackName?: string },
): AssetStyle | undefined {
  const name = (typeof draft.name === "string" ? draft.name.trim() : "") || opts.fallbackName || "";
  if (!name) return undefined;
  const summary = typeof draft.summary === "string" ? draft.summary.trim() : "";
  const guidelines = typeof draft.guidelines === "string" ? draft.guidelines.trim() : "";
  const sourceSessionId =
    typeof draft.sourceSessionId === "string" ? draft.sourceSessionId.trim() : "";
  return {
    id: opts.id,
    name: name.slice(0, 80),
    summary: summary.slice(0, 240),
    guidelines: guidelines.slice(0, 4000),
    palette: parseDesignPalette(draft.palette),
    sourceSessionId: sourceSessionId || undefined,
    createdAt: opts.createdAt,
    updatedAt: opts.updatedAt ?? opts.createdAt,
  };
}

export function resolveAssetStyle(
  id: string | undefined,
  stored: AssetStyle[],
): AssetStyle | undefined {
  const key = id?.trim();
  if (!key) return undefined;
  return stored.find((row) => row.id === key);
}

export function exportAssetStyle(style: AssetStyle): AssetStyleFile {
  return {
    format: ASSET_STYLE_FORMAT,
    version: ASSET_STYLE_VERSION,
    style: {
      name: style.name,
      summary: style.summary,
      guidelines: style.guidelines,
      palette: style.palette,
    },
  };
}

export function assetStyleFileName(style: Pick<AssetStyle, "name">): string {
  const stem =
    style.name
      .trim()
      .toLowerCase()
      .replace(/[^\w]+/g, "-")
      .replace(/^-+|-+$/g, "") || "asset-style";
  return `${stem}.locus-asset-style.json`;
}

export type AssetStyleLook = Pick<AssetStyle, "name" | "summary" | "guidelines"> & {
  palette?: DesignPalette;
};

export function formatAssetStylePrompt(style: AssetStyleLook): string {
  const colors = style.palette
    ? [
        "Color language (honor these hexes on materials and sprites):",
        `- --bg: ${style.palette.bg}`,
        `- --surface: ${style.palette.surface}`,
        `- --text: ${style.palette.text}`,
        `- --muted: ${style.palette.muted}`,
        `- --primary: ${style.palette.primary}`,
        `- --accent: ${style.palette.accent}`,
      ].join("\n")
    : "";
  return [
    `Saved asset style "${style.name}". Match this look on every mesh and sprite. Do not invent a new art direction unless the operator asks.`,
    style.summary ? `Summary: ${style.summary}` : "",
    style.guidelines ? `Style guidelines:\n${style.guidelines}` : "",
    colors,
  ]
    .filter(Boolean)
    .join("\n");
}

export function withAssetStylePrompt(prompt: string, style?: AssetStyleLook | null): string {
  if (!style?.name?.trim()) return prompt;
  return `${prompt}\n\n${formatAssetStylePrompt(style)}`;
}

const GENERIC_STYLE_GUIDELINE =
  /^(2D sprites, tiles, or a cutout sheet\.|3D mesh with orbit, texture, and optional rig\.|3D mesh\.)$/i;

const OPERATOR_ASSET_CHROME_PROMPT =
  /^(Generate from the current operator|Generate the first viewable studio|Retopo pass\.|Texture pass only:|Add or fix a humanoid|Add idle, walk|Reduce poly count|Split the current mesh|Printability pass:|Apply this ASSET\.md|Apply saved asset style|Keep these operator pose|Explore three distinct asset|New source photo dropped|Use this (?:front|side|back) photo|This is a (?:front|side|back) view)/i;

function isGenericStyleLine(text: string): boolean {
  return GENERIC_STYLE_GUIDELINE.test(text.trim());
}

function dropGenericStyleLines(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((part) =>
      part
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !isGenericStyleLine(line))
        .join("\n")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}

function firstLookSummary(...candidates: Array<string | undefined>): string {
  for (const raw of candidates) {
    const text = (raw ?? "").trim();
    if (text && !isGenericStyleLine(text)) return text.slice(0, 240);
  }
  return "";
}

export function isOperatorAssetChromePrompt(text: string): boolean {
  return OPERATOR_ASSET_CHROME_PROMPT.test(text.trim());
}

export function lastAssetLookPrompt(
  messages: Array<{ role: string; content: string }>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role !== "user") continue;
    const text = messages[i]!.content.trim();
    if (!text || isOperatorAssetChromePrompt(text)) continue;
    return text.replace(/\s+/g, " ").slice(0, 400);
  }
  return undefined;
}

function cssVar(html: string, name: string): string {
  const match = html.match(new RegExp(`--${name}\\s*:\\s*([^;\\n}]+)`, "i"));
  const value = match?.[1]?.trim() ?? "";
  if (!value || value.startsWith("var(")) return "";
  return value;
}

function describeCanvasArtDirection(html: string): string[] {
  const text = html.trim();
  if (!text) return [];
  const lines: string[] = [];
  const material = text.match(/data-locus-material=["']([^"']+)/i)?.[1]?.toLowerCase();
  if (material === "clay") lines.push("Clay / untextured form — judge silhouette before albedo.");
  else if (material === "albedo") lines.push("Show the source photo as albedo.");
  if (/source\.png|source-side\.png|source-back\.png/i.test(text)) {
    lines.push(
      "Map ./source.png (and side/back views when present) as albedo. Do not invent a second subject.",
    );
  }
  if (/\bvoxel\b|minecraft|blocky/i.test(text)) lines.push("Blocky / voxel silhouette.");
  if (/toon|cel[- ]?shad|flat[- ]color/i.test(text)) lines.push("Toon / flat color shading.");
  if (/low[- ]?poly/i.test(text)) lines.push("Low-poly readable silhouette.");
  if (
    /sprite-sheet|tileset|\bcutout\b/i.test(text) &&
    !/THREE\.|WebGLRenderer|three\.module/i.test(text)
  ) {
    lines.push("2D sprite or cutout language, not a 3D hull.");
  }
  const primary = cssVar(text, "primary");
  const accent = cssVar(text, "accent");
  if (primary || accent) {
    lines.push(
      `Keep the current material colors${primary ? ` (primary ${primary}` : ""}${
        accent ? `${primary ? ", " : " ("}accent ${accent}` : ""
      }${primary || accent ? ")" : ""}.`,
    );
  }
  return lines;
}

export function describeAssetStudioStyle(input: {
  brief?: string | null;
  html?: string | null;
  title?: string | null;
  prompt?: string | null;
  palette?: DesignPalette;
  build?: AssetBuild | null;
}): AssetStyleDraft {
  const title = input.title?.trim() || "";
  const fromBrief = extractAssetStyleDraft(input.brief ?? "", {
    fallbackName: title ? `${title} style` : undefined,
  });
  const lookPrompt = (input.prompt ?? "").trim().replace(/\s+/g, " ").slice(0, 400);
  const canvasLines = describeCanvasArtDirection(input.html ?? "");
  const briefGuidelines = dropGenericStyleLines(fromBrief.guidelines ?? "");
  const name =
    (fromBrief.name && fromBrief.name !== "Untitled style" ? fromBrief.name : "") ||
    (title ? `${title} style` : "Studio style");
  const summary = firstLookSummary(fromBrief.summary, lookPrompt, canvasLines[0]);
  const build = input.build ? resolveAssetBuild(input.build) : undefined;
  const parts = [
    lookPrompt && lookPrompt !== summary ? `Operator brief: ${lookPrompt}` : "",
    briefGuidelines,
    ...canvasLines,
    build ? formatAssetBuildLines(build).join("\n") : "",
  ]
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const guidelines = parts
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n\n")
    .slice(0, 4000);
  return {
    name: name.slice(0, 80),
    summary: summary.slice(0, 240),
    guidelines,
    palette: input.palette,
  };
}

export function applyAssetStylePrompt(style: AssetStyle): string {
  return [
    `Apply saved asset style "${style.name}" to the live studio. Restyle silhouette, materials, and palette to match. Do not change the subject, orbit, or rig.`,
    style.summary ? `Summary: ${style.summary}` : "",
    style.guidelines ? style.guidelines : "",
    "Read ASSET.md first. Patch /workspace/index.html with apply_patch. Keep window.__locusAsset including exportGlb / exportPng.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function extractAssetStyleDraft(
  brief: string,
  opts?: { fallbackName?: string },
): AssetStyleDraft {
  const text = brief.replace(/^\uFEFF/, "").trim();
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  const styleSection = markdownSection(text, "Style");
  const mode = markdownSection(text, "Mode");
  const notes = markdownSection(text, "Notes");
  let name = opts?.fallbackName?.trim() || "";
  let summary = "";
  let guidelines = "";
  if (styleSection) {
    const saved = styleSection.match(/^Saved style:\s*(.+?)\.\s*$/m);
    if (saved?.[1]?.trim()) name = name || saved[1].trim();
    const withoutSaved = styleSection.replace(/^Saved style:\s*.+\.\s*$/m, "").trim();
    const lines = withoutSaved
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      summary = lines[0]!;
      guidelines = lines.slice(1).join("\n");
    } else {
      guidelines = withoutSaved;
    }
  } else {
    const parts = [mode, notes].filter(Boolean);
    guidelines = parts.join("\n\n");
  }
  if (!name) name = heading || "Untitled style";
  if (!summary && mode) summary = mode.split("\n")[0]?.trim() ?? "";
  return {
    name: name.slice(0, 80),
    summary: summary.slice(0, 240),
    guidelines: guidelines.slice(0, 4000),
  };
}

export function upsertAssetStyleSection(
  brief: string,
  style: Pick<AssetStyle, "name" | "summary" | "guidelines">,
): string {
  const lines = ["## Style", "", `Saved style: ${style.name}.`];
  if (style.summary.trim()) lines.push(style.summary.trim());
  if (style.guidelines.trim()) {
    lines.push("", style.guidelines.trim());
  }
  const block = `${lines.join("\n")}\n`;
  const source = brief.replace(/^\uFEFF/, "");
  const range = markdownSectionRange(source, "Style");
  if (range) {
    const suffix = source.slice(range.end);
    return `${source.slice(0, range.start)}${block}${suffix && !suffix.startsWith("\n") ? "\n" : ""}${suffix}`;
  }
  if (/^## Export\s*$/m.test(source)) {
    return source.replace(/^## Export\s*$/m, `${block}\n## Export`);
  }
  const trimmed = source.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

function markdownSection(text: string, heading: string): string {
  const range = markdownSectionRange(text, heading);
  return range ? text.slice(range.bodyStart, range.end).trim() : "";
}

function markdownSectionRange(
  text: string,
  heading: string,
): { start: number; bodyStart: number; end: number } | undefined {
  const startRe = new RegExp(`^## ${heading}\\s*$`, "im");
  const start = startRe.exec(text);
  if (!start || start.index === undefined) return undefined;
  const bodyStart = start.index + start[0].length;
  const after = text.slice(bodyStart);
  const next = after.search(/^## /m);
  return {
    start: start.index,
    bodyStart,
    end: next < 0 ? text.length : bodyStart + next,
  };
}
