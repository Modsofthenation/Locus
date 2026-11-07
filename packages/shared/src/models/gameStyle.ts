import { parseDesignPalette, type DesignPalette } from "./designPalette.js";

export const GAME_STYLE_JUICES = ["floaty", "crunchy", "heavy"] as const;
export type GameStyleJuice = (typeof GAME_STYLE_JUICES)[number];

export const GAME_STYLE_FORMAT = "locus.game-style";
export const GAME_STYLE_VERSION = 1;
export const MAX_GAME_STYLES = 48;

export const GAME_STYLE_HUDS = ["normal", "minimal", "arcade"] as const;
export type GameStyleHud = (typeof GAME_STYLE_HUDS)[number];

export const GAME_STYLE_TILES = [8, 16, 32, 48] as const;
export type GameStyleTile = (typeof GAME_STYLE_TILES)[number];

export function isGameStyleHud(value: unknown): value is GameStyleHud {
  return typeof value === "string" && (GAME_STYLE_HUDS as readonly string[]).includes(value);
}

export function isGameStyleTile(value: unknown): value is GameStyleTile {
  return typeof value === "number" && (GAME_STYLE_TILES as readonly number[]).includes(value);
}

export function isGameStyleJuice(value: unknown): value is GameStyleJuice {
  return typeof value === "string" && (GAME_STYLE_JUICES as readonly string[]).includes(value);
}

export interface GameStyle {
  id: string;
  name: string;
  summary: string;
  guidelines: string;
  palette?: DesignPalette;
  tilePx: GameStyleTile;
  hud: GameStyleHud;
  juice: GameStyleJuice;
  sourceSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GameStyleFile {
  format: typeof GAME_STYLE_FORMAT;
  version: number;
  style: GameStyleDraft;
}

export type GameStyleDraft = Partial<GameStyle>;

export function parseGameStyle(value: unknown): GameStyle | undefined {
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
  const tileRaw = Number(row.tilePx);
  return {
    id,
    name: name.slice(0, 80),
    summary: summary.slice(0, 240),
    guidelines: guidelines.slice(0, 4000),
    palette: parseDesignPalette(row.palette),
    tilePx: isGameStyleTile(tileRaw) ? tileRaw : 16,
    hud: isGameStyleHud(row.hud) ? row.hud : "normal",
    juice: isGameStyleJuice(row.juice) ? row.juice : "crunchy",
    sourceSessionId: sourceSessionId || undefined,
    createdAt,
    updatedAt,
  };
}

export function parseGameStyleFile(value: unknown): GameStyleDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (row.format === GAME_STYLE_FORMAT && row.style && typeof row.style === "object") {
    return row.style as GameStyleDraft;
  }
  if (typeof row.name === "string" || typeof row.guidelines === "string") {
    return row as GameStyleDraft;
  }
  return undefined;
}

export function materializeGameStyle(
  draft: GameStyleDraft,
  opts: { id: string; createdAt: string; updatedAt?: string; fallbackName?: string },
): GameStyle | undefined {
  const name = (typeof draft.name === "string" ? draft.name.trim() : "") || opts.fallbackName || "";
  if (!name) return undefined;
  const summary = typeof draft.summary === "string" ? draft.summary.trim() : "";
  const guidelines = typeof draft.guidelines === "string" ? draft.guidelines.trim() : "";
  const sourceSessionId =
    typeof draft.sourceSessionId === "string" ? draft.sourceSessionId.trim() : "";
  const tileRaw = Number(draft.tilePx);
  return {
    id: opts.id,
    name: name.slice(0, 80),
    summary: summary.slice(0, 240),
    guidelines: guidelines.slice(0, 4000),
    palette: parseDesignPalette(draft.palette),
    tilePx: isGameStyleTile(tileRaw) ? tileRaw : 16,
    hud: isGameStyleHud(draft.hud) ? draft.hud : "normal",
    juice: isGameStyleJuice(draft.juice) ? draft.juice : "crunchy",
    sourceSessionId: sourceSessionId || undefined,
    createdAt: opts.createdAt,
    updatedAt: opts.updatedAt ?? opts.createdAt,
  };
}

export function resolveGameStyle(
  id: string | undefined,
  stored: GameStyle[],
): GameStyle | undefined {
  const key = id?.trim();
  if (!key) return undefined;
  return stored.find((row) => row.id === key);
}

export function exportGameStyle(style: GameStyle): GameStyleFile {
  return {
    format: GAME_STYLE_FORMAT,
    version: GAME_STYLE_VERSION,
    style: {
      name: style.name,
      summary: style.summary,
      guidelines: style.guidelines,
      palette: style.palette,
      tilePx: style.tilePx,
      hud: style.hud,
      juice: style.juice,
    },
  };
}

export function gameStyleFileName(style: Pick<GameStyle, "name">): string {
  const stem =
    style.name
      .trim()
      .toLowerCase()
      .replace(/[^\w]+/g, "-")
      .replace(/^-+|-+$/g, "") || "game-style";
  return `${stem}.locus-game-style.json`;
}

export type GameStyleLook = Pick<
  GameStyle,
  "name" | "summary" | "guidelines" | "tilePx" | "hud" | "juice"
> & {
  palette?: DesignPalette;
};

export function formatGameStylePrompt(style: GameStyleLook): string {
  const colors = style.palette
    ? [
        "Color language (honor these hexes on tiles, HUD, and juice):",
        `- --bg: ${style.palette.bg}`,
        `- --surface: ${style.palette.surface}`,
        `- --text: ${style.palette.text}`,
        `- --muted: ${style.palette.muted}`,
        `- --primary: ${style.palette.primary}`,
        `- --accent: ${style.palette.accent}`,
      ].join("\n")
    : "";
  return [
    `Saved game style "${style.name}". Match this look on every loop. Do not invent a new art direction unless the operator asks.`,
    style.summary ? `Summary: ${style.summary}` : "",
    `Tile ${style.tilePx}px. HUD ${style.hud}. Juice preset ${style.juice}.`,
    style.guidelines ? `Style guidelines:\n${style.guidelines}` : "",
    colors,
  ]
    .filter(Boolean)
    .join("\n");
}

export function withGameStylePrompt(prompt: string, style?: GameStyleLook | null): string {
  if (!style?.name?.trim()) return prompt;
  return `${prompt}\n\n${formatGameStylePrompt(style)}`;
}

export function applyGameStylePrompt(style: GameStyle): string {
  return [
    `Apply saved game style "${style.name}" to the live canvas. Restyle tiles, HUD, and juice to match. Do not change the win condition or rewrite the loop.`,
    style.summary ? `Summary: ${style.summary}` : "",
    style.guidelines ? style.guidelines : "",
    `Tile ${style.tilePx}px. HUD ${style.hud}. Honor juice preset ${style.juice}.`,
    "Read GAME.md first. Patch /workspace/index.html with apply_patch. Keep window.__locusGame including replay.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function upsertGameStyleSection(
  brief: string,
  style: Pick<GameStyle, "name" | "summary" | "guidelines" | "tilePx" | "hud" | "juice">,
): string {
  const lines = [
    "## Style",
    "",
    `Saved style: ${style.name}.`,
    `Tile ${style.tilePx}px. HUD ${style.hud}. Juice ${style.juice}.`,
  ];
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
  if (/^## Persistence\s*$/m.test(source)) {
    return source.replace(/^## Persistence\s*$/m, `${block}\n## Persistence`);
  }
  const trimmed = source.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

export function describeGameCanvasStyle(input: {
  brief?: string | null;
  title?: string | null;
  prompt?: string | null;
  palette?: DesignPalette;
  tilePx?: number;
  hud?: GameStyleHud;
  juice?: GameStyleJuice;
}): GameStyleDraft {
  const title = input.title?.trim() || "";
  const lookPrompt = (input.prompt ?? "").trim().replace(/\s+/g, " ").slice(0, 400);
  const fromBrief = extractGameStyleDraft(input.brief ?? "", {
    fallbackName: title ? `${title} style` : undefined,
  });
  const name =
    (fromBrief.name && fromBrief.name !== "Untitled style" ? fromBrief.name : "") ||
    (title ? `${title} style` : "Game style");
  const summary = (fromBrief.summary || lookPrompt).slice(0, 240);
  const tileRaw = Number(input.tilePx ?? fromBrief.tilePx);
  return {
    name: name.slice(0, 80),
    summary,
    guidelines: (fromBrief.guidelines || lookPrompt).slice(0, 4000),
    palette: input.palette,
    tilePx: isGameStyleTile(tileRaw) ? tileRaw : 16,
    hud: input.hud ?? fromBrief.hud ?? "normal",
    juice: input.juice ?? fromBrief.juice ?? "crunchy",
  };
}

export function extractGameStyleDraft(
  brief: string,
  opts?: { fallbackName?: string },
): GameStyleDraft {
  const text = brief.replace(/^\uFEFF/, "").trim();
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  const styleSection = markdownSection(text, "Style");
  const loop = markdownSection(text, "Loop");
  let name = opts?.fallbackName?.trim() || "";
  let summary = "";
  let guidelines = "";
  let tilePx: GameStyleTile | undefined;
  let hud: GameStyleHud | undefined;
  let juice: GameStyleJuice | undefined;
  if (styleSection) {
    const saved = styleSection.match(/^Saved style:\s*(.+?)\.\s*$/m);
    if (saved?.[1]?.trim()) name = name || saved[1].trim();
    const meta = styleSection.match(/Tile\s+(\d+)px\.\s*HUD\s+(\w+)\.\s*Juice\s+(\w+)/i);
    if (meta) {
      const tile = Number(meta[1]);
      if (isGameStyleTile(tile)) tilePx = tile;
      if (isGameStyleHud(meta[2]?.toLowerCase())) hud = meta[2]!.toLowerCase() as GameStyleHud;
      if (isGameStyleJuice(meta[3]?.toLowerCase()))
        juice = meta[3]!.toLowerCase() as GameStyleJuice;
    }
    const without = styleSection
      .replace(/^Saved style:\s*.+\.\s*$/m, "")
      .replace(/^Tile\s+\d+px\..+$/m, "")
      .trim();
    const lines = without
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      summary = lines[0]!;
      guidelines = lines.slice(1).join("\n");
    } else {
      guidelines = without;
    }
  } else if (loop) {
    summary = loop.split("\n")[0]?.trim() ?? "";
    guidelines = loop;
  }
  if (!name) name = heading || "Untitled style";
  return {
    name: name.slice(0, 80),
    summary: summary.slice(0, 240),
    guidelines: guidelines.slice(0, 4000),
    tilePx,
    hud,
    juice,
  };
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
