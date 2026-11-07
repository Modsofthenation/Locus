/** Parse Figma URLs and compact REST documents for host tools. */

export type FigmaFileRef = {
  fileKey: string;
  nodeId?: string;
};

export type FigmaTeamRef = {
  teamId: string;
  projectId?: string;
};

export type FigmaNodeSummary = {
  id: string;
  name: string;
  type: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  text?: string;
  fills?: string[];
  layout?: string;
  gap?: number;
  fontSize?: number;
  font?: string;
  children?: FigmaNodeSummary[];
  more?: number;
};

const FILE_KEY_RE = /^[A-Za-z0-9]{10,}$/;
const FIGMA_HOST = /(^|\.)figma\.com$/i;
const FILE_PATH_RE = /\/(?:file|design|proto|board|slides|figjam)\/([A-Za-z0-9]+)/i;

export function figmaApiNodeId(raw: string): string {
  try {
    return decodeURIComponent(raw.trim()).replace(/-/g, ":");
  } catch {
    return raw.trim().replace(/-/g, ":");
  }
}

export function parseFigmaFileRef(raw: string): FigmaFileRef | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const fromUrl = parseFigmaUrl(trimmed);
  if (fromUrl?.fileKey) {
    return { fileKey: fromUrl.fileKey, nodeId: fromUrl.nodeId };
  }
  if (FILE_KEY_RE.test(trimmed)) return { fileKey: trimmed };
  return undefined;
}

export function parseFigmaTeamRef(raw: string): FigmaTeamRef | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (!FIGMA_HOST.test(url.hostname)) return undefined;
    const team = url.pathname.match(/\/files\/team\/(\d+)/);
    if (!team?.[1]) return undefined;
    const project = url.pathname.match(/\/project\/(\d+)/);
    return { teamId: team[1], projectId: project?.[1] };
  } catch {
    return undefined;
  }
}

function parseFigmaUrl(raw: string): FigmaFileRef | undefined {
  try {
    const url = new URL(raw);
    if (!FIGMA_HOST.test(url.hostname)) return undefined;
    const match = url.pathname.match(FILE_PATH_RE);
    if (!match?.[1]) return undefined;
    const nodeRaw = url.searchParams.get("node-id") || url.searchParams.get("node_id");
    return {
      fileKey: match[1],
      nodeId: nodeRaw ? figmaApiNodeId(nodeRaw) : undefined,
    };
  } catch {
    return undefined;
  }
}

export function summarizeFigmaDocument(
  body: unknown,
  opts?: { maxNodes?: number; depth?: number },
): {
  name?: string;
  lastModified?: string;
  version?: string;
  thumbnailUrl?: string;
  pages?: FigmaNodeSummary[];
  nodes?: FigmaNodeSummary[];
  truncated?: boolean;
} {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const state = { count: 0, max: opts?.maxNodes ?? 80, truncated: false };
  const depth = opts?.depth ?? 3;
  const out: {
    name?: string;
    lastModified?: string;
    version?: string;
    thumbnailUrl?: string;
    pages?: FigmaNodeSummary[];
    nodes?: FigmaNodeSummary[];
    truncated?: boolean;
  } = {};
  if (typeof rec.name === "string" && rec.name.trim()) out.name = rec.name;
  if (typeof rec.lastModified === "string") out.lastModified = rec.lastModified;
  if (typeof rec.version === "string") out.version = rec.version;
  if (typeof rec.thumbnailUrl === "string") out.thumbnailUrl = rec.thumbnailUrl;
  if (rec.nodes && typeof rec.nodes === "object") {
    const nodes: FigmaNodeSummary[] = [];
    for (const row of Object.values(rec.nodes as Record<string, unknown>)) {
      const entry = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const summary = walkNode(entry.document ?? row, depth, state);
      if (summary) nodes.push(summary);
    }
    out.nodes = nodes;
  } else {
    const document =
      rec.document && typeof rec.document === "object"
        ? (rec.document as Record<string, unknown>)
        : rec;
    const pages = Array.isArray(document.children) ? document.children : [];
    out.pages = pages
      .map((page) => walkNode(page, depth, state))
      .filter((row): row is FigmaNodeSummary => Boolean(row));
  }
  if (state.truncated) out.truncated = true;
  return out;
}

function walkNode(node: unknown, depth: number, state: WalkState): FigmaNodeSummary | undefined {
  if (!node || typeof node !== "object") return undefined;
  const rec = node as Record<string, unknown>;
  if (rec.visible === false) return undefined;
  if (state.count >= state.max) {
    state.truncated = true;
    return undefined;
  }
  state.count += 1;
  const summary: FigmaNodeSummary = {
    id: typeof rec.id === "string" ? rec.id : "",
    name: typeof rec.name === "string" ? rec.name : "",
    type: typeof rec.type === "string" ? rec.type : "UNKNOWN",
  };
  const box = rec.absoluteBoundingBox;
  if (box && typeof box === "object") {
    const b = box as Record<string, unknown>;
    if (typeof b.x === "number") summary.x = Math.round(b.x);
    if (typeof b.y === "number") summary.y = Math.round(b.y);
    if (typeof b.width === "number") summary.w = Math.round(b.width);
    if (typeof b.height === "number") summary.h = Math.round(b.height);
  }
  if (typeof rec.characters === "string" && rec.characters.trim()) {
    summary.text = clipText(rec.characters, 160);
  }
  const fills = solidFills(rec.fills);
  if (fills.length) summary.fills = fills;
  if (rec.layoutMode === "HORIZONTAL") summary.layout = "horizontal";
  else if (rec.layoutMode === "VERTICAL") summary.layout = "vertical";
  if (typeof rec.itemSpacing === "number") summary.gap = rec.itemSpacing;
  const style = rec.style;
  if (style && typeof style === "object") {
    const s = style as Record<string, unknown>;
    if (typeof s.fontSize === "number") summary.fontSize = s.fontSize;
    if (typeof s.fontFamily === "string" && s.fontFamily.trim()) summary.font = s.fontFamily;
  }
  const kids = Array.isArray(rec.children) ? rec.children : [];
  if (!kids.length) return summary;
  if (depth <= 0) {
    summary.more = kids.length;
    return summary;
  }
  const children: FigmaNodeSummary[] = [];
  let omitted = 0;
  for (const child of kids) {
    if (state.count >= state.max) {
      omitted += 1;
      state.truncated = true;
      continue;
    }
    const next = walkNode(child, depth - 1, state);
    if (next) children.push(next);
  }
  if (children.length) summary.children = children;
  if (omitted) summary.more = omitted;
  return summary;
}

type WalkState = { count: number; max: number; truncated: boolean };

function solidFills(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const fill = row as Record<string, unknown>;
    if (fill.visible === false || fill.type !== "SOLID") continue;
    const color = fill.color;
    if (!color || typeof color !== "object") continue;
    const hex = rgbToHex(color as Record<string, unknown>);
    if (hex && !out.includes(hex)) out.push(hex);
  }
  return out;
}

function rgbToHex(color: Record<string, unknown>): string | undefined {
  const r = num01(color.r);
  const g = num01(color.g);
  const b = num01(color.b);
  if (r === undefined || g === undefined || b === undefined) return undefined;
  const hex = `#${toByte(r)}${toByte(g)}${toByte(b)}`;
  const a = num01(color.a);
  if (a !== undefined && a < 1) return `${hex}${toByte(a)}`;
  return hex;
}

function num01(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toByte(value: number): string {
  return Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, "0");
}

function clipText(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
