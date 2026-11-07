/** Planning canvas document. Lives under `~/.locus/boards/<id>/`, not in session JSON. */

import { normalizeRepoUrl, parseOwnerRepo } from "./git.js";

export const BOARD_STARTERS = [
  "architecture",
  "sprint",
  "kanban",
  "retro",
  "rca",
  "research",
  "blank",
] as const;
export type BoardStarter = (typeof BOARD_STARTERS)[number];

export function isBoardStarter(value: unknown): value is BoardStarter {
  return BOARD_STARTERS.includes(value as BoardStarter);
}

export const BOARD_OBJECT_TYPES = [
  "sticky",
  "text",
  "shape",
  "connector",
  "frame",
  "card",
  "image",
  "table",
  "timeline",
  "ink",
  "mermaid",
] as const;
export type BoardObjectType = (typeof BOARD_OBJECT_TYPES)[number];

export const BOARD_SHAPE_KINDS = [
  "rect",
  "rounded",
  "ellipse",
  "diamond",
  "triangle",
  "triangle-down",
  "triangle-left",
  "triangle-right",
  "parallelogram",
  "trapezoid",
  "pentagon",
  "hexagon",
  "octagon",
  "star",
  "arrow-right",
  "arrow-left",
  "arrow-up",
  "arrow-down",
  "chevron",
  "cylinder",
  "cloud",
  "callout",
  "document",
  "pill",
] as const;
export type BoardShapeKind = (typeof BOARD_SHAPE_KINDS)[number];

export const BOARD_SHAPE_GROUPS: { label: string; kinds: BoardShapeKind[] }[] = [
  { label: "Basic", kinds: ["rect", "rounded", "ellipse", "diamond", "pill"] },
  {
    label: "Triangles",
    kinds: ["triangle", "triangle-down", "triangle-left", "triangle-right"],
  },
  {
    label: "Polygons",
    kinds: ["parallelogram", "trapezoid", "pentagon", "hexagon", "octagon", "star"],
  },
  {
    label: "Arrows",
    kinds: ["arrow-right", "arrow-left", "arrow-up", "arrow-down", "chevron"],
  },
  { label: "Notes", kinds: ["cylinder", "cloud", "callout", "document"] },
];

export const BOARD_FONT_SIZES = [12, 14, 16, 18, 20, 24, 32, 48] as const;

export const BOARD_TABLE_COLUMN_KINDS = [
  "text",
  "status",
  "person",
  "date",
  "number",
  "select",
] as const;
export type BoardTableColumnKind = (typeof BOARD_TABLE_COLUMN_KINDS)[number];

export interface BoardTableColumn {
  id: string;
  name: string;
  kind: BoardTableColumnKind;
}

export interface BoardTableRow {
  id: string;
  cells: Record<string, string>;
}

export interface BoardTable {
  columns: BoardTableColumn[];
  rows: BoardTableRow[];
}

export const BOARD_TIMELINE_SCALES = ["days", "weeks", "months"] as const;
export type BoardTimelineScale = (typeof BOARD_TIMELINE_SCALES)[number];

export interface BoardTimelineItem {
  id: string;
  title: string;
  start: string;
  end: string;
  color?: BoardStickyColor;
}

export interface BoardTimeline {
  scale: BoardTimelineScale;
  items: BoardTimelineItem[];
}

export interface BoardInkPoint {
  x: number;
  y: number;
}

export interface BoardInk {
  points: BoardInkPoint[];
  width?: number;
}

export const BOARD_CITE_KINDS = [
  "agent",
  "design",
  "pull",
  "slack",
  "file",
  "automation",
  "jira",
  "linear",
  "brain",
] as const;
export type BoardCiteKind = (typeof BOARD_CITE_KINDS)[number];

export const BOARD_STICKY_COLORS = ["amber", "mint", "sky", "rose", "violet", "paper"] as const;
export type BoardStickyColor = (typeof BOARD_STICKY_COLORS)[number];

export const BOARD_RUN_TARGETS = ["agent", "design", "plan"] as const;
export type BoardRunTarget = (typeof BOARD_RUN_TARGETS)[number];

export function isBoardRunTarget(value: unknown): value is BoardRunTarget {
  return BOARD_RUN_TARGETS.includes(value as BoardRunTarget);
}

export const BOARD_TOOL_NAMES = [
  "board_list",
  "board_get",
  "board_upsert",
  "board_delete",
  "board_comment",
  "board_cluster",
] as const;
export type BoardToolName = (typeof BOARD_TOOL_NAMES)[number];

export function isBoardToolName(name: string): name is BoardToolName {
  return (BOARD_TOOL_NAMES as readonly string[]).includes(name);
}

export interface BoardCite {
  kind: BoardCiteKind;
  sessionId?: string;
  repoId?: string;
  number?: number;
  channelId?: string;
  threadTs?: string;
  path?: string;
  automationId?: string;
  key?: string;
  /** Brain node id (`service:billing`) or memory id (`mem:…`). */
  nodeId?: string;
  label?: string;
  url?: string;
}

export interface BoardObject {
  id: string;
  type: BoardObjectType;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  frameId?: string;
  stackId?: string;
  text?: string;
  color?: string;
  shape?: BoardShapeKind;
  fromId?: string;
  toId?: string;
  label?: string;
  cite?: BoardCite;
  assetId?: string;
  fontSize?: number;
  table?: BoardTable;
  timeline?: BoardTimeline;
  ink?: BoardInk;
}

export interface BoardComment {
  id: string;
  objectId: string;
  body: string;
  author: "operator" | "agent";
  resolved?: boolean;
  createdAt: string;
}

export interface BoardDocument {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  objects: BoardObject[];
  comments: BoardComment[];
  chatSessionId?: string;
  starter?: BoardStarter;
  archived?: boolean;
}

export interface BoardPendingComment {
  id: string;
  objectId: string;
  body: string;
  author: "operator" | "agent";
}

export interface BoardSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  objectCount: number;
  frameCount: number;
  chatSessionId?: string;
  starter?: BoardStarter;
  archived?: boolean;
  pendingComments?: BoardPendingComment[];
}

export interface CreateBoardInput {
  title?: string;
  starter?: BoardStarter;
  prompt?: string;
}

export interface PatchBoardInput {
  title?: string;
  objects?: BoardObject[];
  comments?: BoardComment[];
  chatSessionId?: string | null;
  archived?: boolean;
}

export interface BoardStarterMeta {
  id: BoardStarter;
  title: string;
  blurb: string;
}

export const BOARD_STARTER_META: BoardStarterMeta[] = [
  {
    id: "architecture",
    title: "Architecture",
    blurb: "C4-lite frames: context, container, component, open questions",
  },
  {
    id: "sprint",
    title: "Sprint",
    blurb: "Now / Next / Later lanes and a sticky stack",
  },
  {
    id: "kanban",
    title: "Kanban",
    blurb: "To do / Doing / Done lanes — drop stickies between columns",
  },
  {
    id: "retro",
    title: "Retro",
    blurb: "Went well, to improve, ideas, and actions",
  },
  { id: "rca", title: "RCA", blurb: "What happened, why, fix, follow-up" },
  {
    id: "research",
    title: "Research",
    blurb: "Affinity frames plus a sticky stack to cluster",
  },
  { id: "blank", title: "Blank", blurb: "One untitled frame" },
];

export const BOARD_PLAYBOOK =
  "You are Locus Board. The operator is looking at an infinite planning canvas. Your write target is board objects via board_upsert / board_delete / board_comment — not files, not /workspace/index.html. board_get a frame or the whole board before editing. Prefer stickies for ideas, frames for structure, shapes+connectors for diagrams, tables for grids, timelines for dated work, ink for freehand strokes, mermaid blocks for sequence/state/ERD diagrams (text holds the Mermaid source), and cards to cite agents, PRs, Slack, files, automations, Jira, or Brain nodes. Cluster related stickies into labeled frames with board_cluster (one call, ids of the stickies) instead of upserting each note. Keep text short. Use plain punctuation (hyphen, middle dot, ASCII quotes) rather than fancy dashes. Do not invent share links. When the operator asks to generate stickies, cluster, diagram, table, timeline, mermaid, or a sketch, do that on the canvas in this turn. table objects take table.columns[{id,name,kind}] and table.rows[{id,cells}]. timeline objects take timeline.scale (days|weeks|months) and timeline.items[{id,title,start,end}] with YYYY-MM-DD dates. ink objects take ink.points[{x,y}] in object-local coordinates. mermaid objects store source in text (sequenceDiagram, stateDiagram-v2, or erDiagram). Optional fontSize is 12-48. shape is one of rect, rounded, ellipse, diamond, triangle, hexagon, arrow-right, cylinder, cloud, callout, document, and the other BOARD_SHAPE_KINDS. Optional stackId groups stickies into a Miro-like deck (same stackId, offset x/y). When a Miro token is in Settings, use miro_list / miro_get to read a Miro board, miro_import then board_upsert to copy it here, and miro_export to publish this canvas to Miro. When Figma is connected, figma_list / figma_get / figma_images read a file; pin a Figma URL as a card rather than embedding the editor.";

const GRID = 20;

function sticky(
  id: string,
  x: number,
  y: number,
  text: string,
  color: BoardStickyColor = "amber",
  frameId?: string,
): BoardObject {
  return { id, type: "sticky", x, y, w: 160, h: 140, text, color, frameId };
}

function frame(id: string, x: number, y: number, w: number, h: number, title: string): BoardObject {
  return { id, type: "frame", x, y, w, h, text: title, color: "paper" };
}

function box(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  shape: BoardShapeKind = "rounded",
  frameId?: string,
): BoardObject {
  return { id, type: "shape", x, y, w, h, text: label, shape, color: "sky", frameId };
}

function connector(id: string, fromId: string, toId: string, label?: string): BoardObject {
  return { id, type: "connector", x: 0, y: 0, w: 0, h: 0, fromId, toId, label };
}

function heading(id: string, x: number, y: number, text: string): BoardObject {
  return { id, type: "text", x, y, w: 360, h: 40, text };
}

/** Deterministic objects for a starter pill. Caller remaps ids on persist. */
export function boardStarterObjects(starter: BoardStarter): BoardObject[] {
  if (starter === "architecture") {
    const ctx = frame("f-ctx", GRID, GRID, 920, 420, "Context");
    const con = frame("f-con", GRID, 480, 920, 420, "Container");
    const cmp = frame("f-cmp", GRID, 940, 920, 420, "Component");
    const qs = frame("f-qs", 980, GRID, 300, 420, "Open questions");
    return [
      ctx,
      con,
      cmp,
      qs,
      heading("t-arch", GRID, -20, "Architecture"),
      box("b-sys", 60, 80, 200, 80, "System", "rounded", ctx.id),
      box("b-user", 360, 80, 200, 80, "Operator", "rounded", ctx.id),
      box("b-ext", 660, 80, 200, 80, "Forge / Slack", "rounded", ctx.id),
      connector("c-1", "b-user", "b-sys"),
      connector("c-2", "b-sys", "b-ext"),
      box("b-app", 60, 560, 220, 90, "App", "rect", con.id),
      box("b-agent", 360, 560, 220, 90, "Agent", "rect", con.id),
      box("b-store", 660, 560, 220, 90, "Store", "rect", con.id),
      connector("c-3", "b-app", "b-agent"),
      connector("c-4", "b-agent", "b-store"),
      sticky("s-q1", 1010, 80, "What is in scope?", "violet", qs.id),
      sticky("s-q2", 1010, 240, "What can wait?", "rose", qs.id),
    ];
  }
  if (starter === "sprint") {
    const now = frame("f-now", GRID, 60, 280, 520, "Now");
    const next = frame("f-next", 320, 60, 280, 520, "Next");
    const later = frame("f-later", 620, 60, 280, 520, "Later");
    return [
      heading("t-sprint", GRID, GRID, "Sprint"),
      now,
      next,
      later,
      sticky("s-n1", 40, 120, "Ship the risky slice", "mint", now.id),
      sticky("s-x1", 340, 120, "Follow-up polish", "sky", next.id),
      sticky("s-l1", 640, 120, "Nice to have", "paper", later.id),
    ];
  }
  if (starter === "kanban") {
    const todo = frame("f-todo", GRID, 60, 280, 560, "To do");
    const doing = frame("f-doing", 320, 60, 280, 560, "Doing");
    const done = frame("f-done", 620, 60, 280, 560, "Done");
    return [
      heading("t-kanban", GRID, GRID, "Kanban"),
      todo,
      doing,
      done,
      sticky("s-k1", 40, 120, "Pick up next", "amber", todo.id),
      sticky("s-k2", 340, 120, "In progress", "sky", doing.id),
      sticky("s-k3", 640, 120, "Shipped", "mint", done.id),
    ];
  }
  if (starter === "retro") {
    const well = frame("f-well", GRID, 60, 260, 480, "Went well");
    const improve = frame("f-imp", 300, 60, 260, 480, "To improve");
    const ideas = frame("f-idea", 580, 60, 260, 480, "Ideas");
    const actions = frame("f-act", 860, 60, 260, 480, "Actions");
    return [
      heading("t-retro", GRID, GRID, "Retro"),
      well,
      improve,
      ideas,
      actions,
      sticky("s-w1", 40, 120, "What worked", "mint", well.id),
      sticky("s-i1", 320, 120, "What to change", "rose", improve.id),
      sticky("s-d1", 600, 120, "Try next time", "violet", ideas.id),
      sticky("s-a1", 880, 120, "Owner + date", "sky", actions.id),
    ];
  }
  if (starter === "rca") {
    const happened = frame("f-hap", GRID, 60, 260, 480, "What happened");
    const why = frame("f-why", 300, 60, 260, 480, "Why");
    const fix = frame("f-fix", 580, 60, 260, 480, "Fix");
    const follow = frame("f-fol", 860, 60, 260, 480, "Follow-up");
    return [
      heading("t-rca", GRID, GRID, "RCA"),
      happened,
      why,
      fix,
      follow,
      sticky("s-h1", 40, 120, "Symptom", "rose", happened.id),
      sticky("s-w1", 320, 120, "Root cause", "amber", why.id),
      sticky("s-f1", 600, 120, "Immediate fix", "mint", fix.id),
      sticky("s-o1", 880, 120, "Prevent next time", "sky", follow.id),
    ];
  }
  if (starter === "research") {
    const notes = frame("f-notes", GRID, 60, 280, 520, "Notes");
    const themes = frame("f-themes", 320, 60, 280, 520, "Themes");
    const ops = frame("f-ops", 620, 60, 280, 520, "Opportunities");
    return [
      heading("t-res", GRID, GRID, "Research"),
      notes,
      themes,
      ops,
      sticky("s-r1", 40, 120, "Observation", "amber", notes.id),
      sticky("s-r2", 40, 280, "Quote", "paper", notes.id),
    ];
  }
  return [frame("f-blank", GRID, GRID, 640, 400, "Untitled")];
}

export function boardSummary(board: BoardDocument): BoardSummary {
  const pendingComments = board.comments
    .filter((row) => !row.resolved)
    .slice(-8)
    .map((row) => ({
      id: row.id,
      objectId: row.objectId,
      body: row.body,
      author: row.author,
    }));
  return {
    id: board.id,
    title: board.title,
    updatedAt: board.updatedAt,
    createdAt: board.createdAt,
    objectCount: board.objects.length,
    frameCount: board.objects.filter((row) => row.type === "frame").length,
    chatSessionId: board.chatSessionId,
    starter: board.starter,
    archived: board.archived,
    pendingComments: pendingComments.length ? pendingComments : undefined,
  };
}

export function isBoardAssetId(value: string): boolean {
  return BOARD_ASSET_ID.test(value);
}

export function boardAssetExt(mime: string): string | undefined {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  return undefined;
}

function finiteCoord(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const CP1252_FROM_UNICODE: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

function unicodeToCp1252Byte(code: number): number | undefined {
  if (code <= 0xff && (code < 0x80 || code > 0x9f)) return code;
  return CP1252_FROM_UNICODE[code];
}

const MOJIBAKE = /Â[\u00a0-\u00ff]|Ã[\u0080-\u00bf]|â[€˜™œ]|â€.|â‰.|â†./;

function decodeMojibake(text: string): string | undefined {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const b = unicodeToCp1252Byte(text.charCodeAt(i));
    if (b === undefined) return undefined;
    bytes[i] = b;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Repair UTF-8 text that was decoded as Windows-1252 (Â·, â€”, â‰ˆ). */
export function repairBoardText(text: string): string {
  let cur = text;
  for (let i = 0; i < 3; i++) {
    if (!MOJIBAKE.test(cur) && !/[ÂÃ]/.test(cur)) break;
    const next = decodeMojibake(cur);
    if (!next || next === cur) break;
    cur = next;
  }
  return cur;
}

function clipText(value: unknown, max = 8_000): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = repairBoardText(value).trim();
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max) : text;
}

export function parseBoardFontSize(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(Math.min(72, Math.max(10, n)));
}

export function stepBoardFontSize(current: number | undefined, dir: 1 | -1): number {
  const cur = current ?? 14;
  let at = 0;
  for (let i = 0; i < BOARD_FONT_SIZES.length; i++) {
    if (BOARD_FONT_SIZES[i]! <= cur) at = i;
  }
  const next = BOARD_FONT_SIZES[Math.max(0, Math.min(BOARD_FONT_SIZES.length - 1, at + dir))];
  return next ?? 14;
}

export function emptyBoardTable(): BoardTable {
  return {
    columns: [
      { id: "title", name: "Title", kind: "text" },
      { id: "description", name: "Description", kind: "text" },
      { id: "status", name: "Status", kind: "status" },
      { id: "assignee", name: "Assignee", kind: "person" },
      { id: "start", name: "Start Date", kind: "date" },
      { id: "end", name: "End Date", kind: "date" },
      { id: "estimate", name: "Estimate", kind: "number" },
      { id: "priority", name: "Priority", kind: "select" },
    ],
    rows: [1, 2, 3, 4, 5].map((n) => ({ id: `row-${n}`, cells: {} })),
  };
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

export function parseBoardDay(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = value.trim().match(ISO_DAY);
  if (!m) return undefined;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function formatBoardDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addBoardDays(day: string, days: number): string {
  const t = boardDayUtc(day) + days * 86_400_000;
  return formatBoardDay(new Date(t));
}

export function boardDayUtc(day: string): number {
  const parsed = parseBoardDay(day);
  if (!parsed) return Date.UTC(2026, 0, 1);
  const [y, m, d] = parsed.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d);
}

export function emptyBoardTimeline(now = new Date()): BoardTimeline {
  const start = formatBoardDay(now);
  return {
    scale: "weeks",
    items: [
      { id: "item-1", title: "First task", start, end: addBoardDays(start, 14) },
      {
        id: "item-2",
        title: "Second task",
        start: addBoardDays(start, 7),
        end: addBoardDays(start, 21),
      },
      {
        id: "item-3",
        title: "Third task",
        start: addBoardDays(start, 14),
        end: addBoardDays(start, 28),
      },
    ],
  };
}

export function parseBoardTable(raw: unknown): BoardTable | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.columns)) return undefined;
  const columns: BoardTableColumn[] = [];
  for (const col of value.columns) {
    if (!col || typeof col !== "object") continue;
    const row = col as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    const name =
      typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 80) : "Column";
    const kind = BOARD_TABLE_COLUMN_KINDS.includes(row.kind as BoardTableColumnKind)
      ? (row.kind as BoardTableColumnKind)
      : "text";
    columns.push({ id, name, kind });
  }
  if (!columns.length) return undefined;
  const rows: BoardTableRow[] = [];
  const incoming = Array.isArray(value.rows) ? value.rows : [];
  for (const item of incoming) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    const cells: Record<string, string> = {};
    if (row.cells && typeof row.cells === "object") {
      for (const [key, cell] of Object.entries(row.cells as Record<string, unknown>)) {
        const text = clipText(cell, 2_000);
        if (text) cells[key] = text;
      }
    }
    rows.push({ id, cells });
  }
  return { columns: columns.slice(0, 40), rows: rows.slice(0, 200) };
}

export function parseBoardTimeline(raw: unknown): BoardTimeline | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const scale = BOARD_TIMELINE_SCALES.includes(value.scale as BoardTimelineScale)
    ? (value.scale as BoardTimelineScale)
    : "weeks";
  const incoming = Array.isArray(value.items) ? value.items : [];
  const items: BoardTimelineItem[] = [];
  for (const item of incoming) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const title = clipText(row.title ?? row.text, 200) ?? "Task";
    const start = parseBoardDay(row.start);
    const end = parseBoardDay(row.end) ?? start;
    if (!id || !start || !end) continue;
    const next: BoardTimelineItem = {
      id,
      title,
      start: start <= end ? start : end,
      end: start <= end ? end : start,
    };
    if (BOARD_STICKY_COLORS.includes(row.color as BoardStickyColor))
      next.color = row.color as BoardStickyColor;
    items.push(next);
  }
  return { scale, items: items.slice(0, 80) };
}

export function parseBoardInk(raw: unknown): BoardInk | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.points)) return undefined;
  const points: BoardInkPoint[] = [];
  for (const item of value.points) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    points.push({ x: finiteCoord(row.x), y: finiteCoord(row.y) });
  }
  if (points.length < 2) return undefined;
  const ink: BoardInk = { points: points.slice(0, 4_000) };
  if (typeof value.width === "number" && Number.isFinite(value.width)) {
    ink.width = Math.min(16, Math.max(1, value.width));
  }
  return ink;
}

export function boardObjectFromInkStroke(
  id: string,
  points: BoardInkPoint[],
  color?: string,
): BoardObject | undefined {
  if (points.length < 2) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const pad = 8;
  const x = minX - pad;
  const y = minY - pad;
  const obj: BoardObject = {
    id,
    type: "ink",
    x,
    y,
    w: Math.max(16, maxX - minX + pad * 2),
    h: Math.max(16, maxY - minY + pad * 2),
    ink: {
      points: points.map((point) => ({ x: point.x - x, y: point.y - y })),
      width: 2.5,
    },
  };
  if (color && BOARD_STICKY_COLORS.includes(color as BoardStickyColor)) obj.color = color;
  return obj;
}

export function hydrateBoardObject(obj: BoardObject): BoardObject {
  if (obj.type === "table" && !obj.table) return { ...obj, table: emptyBoardTable() };
  if (obj.type === "timeline" && !obj.timeline) return { ...obj, timeline: emptyBoardTimeline() };
  return obj;
}

export function addBoardTableRow(table: BoardTable): BoardTable {
  return {
    ...table,
    rows: [...table.rows, { id: crypto.randomUUID(), cells: {} }].slice(0, 200),
  };
}

export function addBoardTableColumn(
  table: BoardTable,
  kind: BoardTableColumnKind = "text",
): BoardTable {
  return {
    ...table,
    columns: [...table.columns, { id: crypto.randomUUID(), name: "Column", kind }].slice(0, 40),
  };
}

export function setBoardTableCell(
  table: BoardTable,
  rowId: string,
  columnId: string,
  value: string,
): BoardTable {
  const text = repairBoardText(value).trim();
  return {
    ...table,
    rows: table.rows.map((row) =>
      row.id === rowId
        ? {
            ...row,
            cells: text
              ? { ...row.cells, [columnId]: text }
              : Object.fromEntries(Object.entries(row.cells).filter(([key]) => key !== columnId)),
          }
        : row,
    ),
  };
}

export function addBoardTimelineItem(timeline: BoardTimeline, now = new Date()): BoardTimeline {
  const start = formatBoardDay(now);
  return {
    ...timeline,
    items: [
      ...timeline.items,
      {
        id: crypto.randomUUID(),
        title: "New task",
        start,
        end: addBoardDays(start, 7),
      },
    ].slice(0, 80),
  };
}

export function boardTimelineSpan(
  items: BoardTimelineItem[],
  now = new Date(),
): { start: string; end: string } {
  const days = items.flatMap((item) => [item.start, item.end]);
  if (!days.length) {
    const start = formatBoardDay(now);
    return { start, end: addBoardDays(start, 42) };
  }
  const sorted = [...days].sort();
  const start = sorted[0]!;
  const end = sorted.at(-1)!;
  return { start, end: start === end ? addBoardDays(end, 7) : end };
}

export function shiftBoardTimelineItem(item: BoardTimelineItem, days: number): BoardTimelineItem {
  if (!days) return item;
  return {
    ...item,
    start: addBoardDays(item.start, days),
    end: addBoardDays(item.end, days),
  };
}

export function boardShapePath(kind: BoardShapeKind): string {
  switch (kind) {
    case "rounded":
      return "M 14 4 H 86 Q 96 4 96 14 V 86 Q 96 96 86 96 H 14 Q 4 96 4 86 V 14 Q 4 4 14 4 Z";
    case "ellipse":
      return "M 50 4 A 46 46 0 1 0 50 96 A 46 46 0 1 0 50 4 Z";
    case "diamond":
      return "M 50 4 L 96 50 L 50 96 L 4 50 Z";
    case "triangle":
      return "M 50 6 L 96 94 L 4 94 Z";
    case "triangle-down":
      return "M 4 6 L 96 6 L 50 94 Z";
    case "triangle-left":
      return "M 94 6 L 94 94 L 6 50 Z";
    case "triangle-right":
      return "M 6 6 L 94 50 L 4 94 Z";
    case "parallelogram":
      return "M 22 8 L 96 8 L 78 92 L 4 92 Z";
    case "trapezoid":
      return "M 22 10 L 78 10 L 96 90 L 4 90 Z";
    case "pentagon":
      return "M 50 4 L 96 40 L 78 96 L 22 96 L 4 40 Z";
    case "hexagon":
      return "M 50 4 L 94 27 L 94 73 L 50 96 L 6 73 L 6 27 Z";
    case "octagon":
      return "M 30 4 H 70 L 96 30 V 70 L 70 96 H 30 L 4 70 V 30 Z";
    case "star":
      return "M 50 4 L 61 38 L 96 38 L 68 60 L 79 94 L 50 73 L 21 94 L 32 60 L 4 38 L 39 38 Z";
    case "arrow-right":
      return "M 4 30 H 58 V 12 L 96 50 L 58 88 V 70 H 4 Z";
    case "arrow-left":
      return "M 96 30 H 42 V 12 L 4 50 L 42 88 V 70 H 96 Z";
    case "arrow-up":
      return "M 30 96 V 42 H 12 L 50 4 L 88 42 H 70 V 96 Z";
    case "arrow-down":
      return "M 30 4 V 58 H 12 L 50 96 L 88 58 H 70 V 4 Z";
    case "chevron":
      return "M 4 20 L 50 50 L 4 80 V 96 L 70 50 L 4 4 Z";
    case "cylinder":
      return "M 12 18 A 38 12 0 0 1 88 18 A 38 12 0 0 1 12 18 M 12 18 V 82 A 38 12 0 0 0 88 82 V 18";
    case "cloud":
      return "M 28 78 H 76 A 18 18 0 0 0 78 44 A 20 16 0 0 0 46 36 A 22 20 0 0 0 22 62 A 14 14 0 0 0 28 78 Z";
    case "callout":
      return "M 12 8 H 88 Q 96 8 96 16 V 62 Q 96 70 88 70 H 40 L 18 92 V 70 H 12 Q 4 70 4 62 V 16 Q 4 8 12 8 Z";
    case "document":
      return "M 18 6 H 68 L 92 30 V 94 H 18 Z M 68 6 V 30 H 92";
    case "pill":
      return "M 30 8 H 70 A 22 42 0 0 1 70 92 H 30 A 22 42 0 0 1 30 8 Z";
    default:
      return "M 4 4 H 96 V 96 H 4 Z";
  }
}

export function parseBoardCite(raw: unknown): BoardCite | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const kind = value.kind;
  if (!BOARD_CITE_KINDS.includes(kind as BoardCiteKind)) return undefined;
  const cite: BoardCite = { kind: kind as BoardCiteKind };
  if (typeof value.sessionId === "string" && value.sessionId.trim())
    cite.sessionId = value.sessionId.trim();
  if (typeof value.repoId === "string" && value.repoId.trim()) cite.repoId = value.repoId.trim();
  const number = typeof value.number === "number" ? value.number : Number(value.number);
  if (Number.isInteger(number) && number > 0) cite.number = number;
  if (typeof value.channelId === "string" && value.channelId.trim())
    cite.channelId = value.channelId.trim();
  if (typeof value.threadTs === "string" && value.threadTs.trim())
    cite.threadTs = value.threadTs.trim();
  if (typeof value.path === "string" && value.path.trim()) cite.path = value.path.trim();
  if (typeof value.automationId === "string" && value.automationId.trim())
    cite.automationId = value.automationId.trim();
  if (typeof value.key === "string" && value.key.trim()) cite.key = value.key.trim();
  if (typeof value.nodeId === "string" && value.nodeId.trim()) cite.nodeId = value.nodeId.trim();
  if (typeof value.label === "string" && value.label.trim()) cite.label = value.label.trim();
  if (typeof value.url === "string" && /^https?:\/\//i.test(value.url.trim()))
    cite.url = value.url.trim();
  return cite;
}

export function parseBoardObject(raw: unknown): BoardObject | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const type = value.type;
  if (!id || !BOARD_OBJECT_TYPES.includes(type as BoardObjectType)) return undefined;
  const obj: BoardObject = {
    id,
    type: type as BoardObjectType,
    x: finiteCoord(value.x),
    y: finiteCoord(value.y),
    w: Math.max(0, finiteCoord(value.w, 160)),
    h: Math.max(0, finiteCoord(value.h, 80)),
  };
  if (typeof value.z === "number" && Number.isFinite(value.z)) obj.z = value.z;
  if (typeof value.frameId === "string" && value.frameId.trim()) obj.frameId = value.frameId.trim();
  if (obj.type === "sticky" && typeof value.stackId === "string" && value.stackId.trim()) {
    obj.stackId = value.stackId.trim();
  }
  const text = clipText(value.text);
  if (text) obj.text = text;
  if (BOARD_STICKY_COLORS.includes(value.color as BoardStickyColor))
    obj.color = value.color as BoardStickyColor;
  if (BOARD_SHAPE_KINDS.includes(value.shape as BoardShapeKind))
    obj.shape = value.shape as BoardShapeKind;
  if (typeof value.fromId === "string" && value.fromId.trim()) obj.fromId = value.fromId.trim();
  if (typeof value.toId === "string" && value.toId.trim()) obj.toId = value.toId.trim();
  const label = clipText(value.label, 400);
  if (label) obj.label = label;
  const cite = parseBoardCite(value.cite);
  if (cite) obj.cite = cite;
  if (typeof value.assetId === "string" && value.assetId.trim()) obj.assetId = value.assetId.trim();
  const fontSize = parseBoardFontSize(value.fontSize);
  if (fontSize) obj.fontSize = fontSize;
  const table = parseBoardTable(value.table);
  if (table) obj.table = table;
  const timeline = parseBoardTimeline(value.timeline);
  if (timeline) obj.timeline = timeline;
  const ink = parseBoardInk(value.ink);
  if (ink) obj.ink = ink;
  return obj;
}

export function parseBoardComment(raw: unknown): BoardComment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const objectId = typeof value.objectId === "string" ? value.objectId.trim() : "";
  const body = clipText(value.body, 4_000);
  if (!id || !objectId || !body) return undefined;
  const author = value.author === "agent" ? "agent" : "operator";
  const createdAt =
    typeof value.createdAt === "string" && value.createdAt.trim()
      ? value.createdAt.trim()
      : new Date().toISOString();
  return {
    id,
    objectId,
    body,
    author,
    resolved: value.resolved === true ? true : undefined,
    createdAt,
  };
}

export function parseBoardDocument(raw: unknown): BoardDocument | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const title =
    typeof value.title === "string" && value.title.trim() ? value.title.trim() : "Untitled board";
  if (!id) return undefined;
  const createdAt =
    typeof value.createdAt === "string" && value.createdAt.trim()
      ? value.createdAt.trim()
      : new Date().toISOString();
  const updatedAt =
    typeof value.updatedAt === "string" && value.updatedAt.trim()
      ? value.updatedAt.trim()
      : createdAt;
  const objects = pruneStickyStacks(
    Array.isArray(value.objects)
      ? value.objects
          .map(parseBoardObject)
          .filter((row): row is BoardObject => Boolean(row))
          .map(hydrateBoardObject)
      : [],
  );
  const comments = Array.isArray(value.comments)
    ? value.comments.map(parseBoardComment).filter((row): row is BoardComment => Boolean(row))
    : [];
  const board: BoardDocument = { id, title, createdAt, updatedAt, objects, comments };
  if (typeof value.chatSessionId === "string" && value.chatSessionId.trim())
    board.chatSessionId = value.chatSessionId.trim();
  if (isBoardStarter(value.starter)) board.starter = value.starter;
  if (value.archived === true) board.archived = true;
  return board;
}

export function objectsInFrame(board: BoardDocument, frameId: string): BoardObject[] {
  const frameObj = board.objects.find((row) => row.id === frameId && row.type === "frame");
  if (!frameObj) return [];
  const inside = board.objects.filter((row) => {
    if (row.id === frameId) return true;
    if (row.frameId === frameId) return true;
    if (row.type === "connector") {
      const from = board.objects.find((item) => item.id === row.fromId);
      const to = board.objects.find((item) => item.id === row.toId);
      return from?.frameId === frameId || to?.frameId === frameId;
    }
    if (row.type === "frame") return false;
    return (
      row.x >= frameObj.x &&
      row.y >= frameObj.y &&
      row.x + row.w <= frameObj.x + frameObj.w &&
      row.y + row.h <= frameObj.y + frameObj.h
    );
  });
  return inside;
}

export function formatFrameBrief(board: BoardDocument, frameId?: string): string {
  const objects = frameId ? objectsInFrame(board, frameId) : board.objects;
  const frameObj = frameId
    ? board.objects.find((row) => row.id === frameId && row.type === "frame")
    : undefined;
  const title = frameObj?.text?.trim() || board.title;
  const lines = [`# ${title}`, ""];
  const seenStacks = new Set<string>();
  for (const obj of objects) {
    if (obj.type === "frame" && obj.id === frameId) continue;
    if (obj.type === "sticky") {
      if (obj.stackId) {
        if (seenStacks.has(obj.stackId)) continue;
        seenStacks.add(obj.stackId);
        const members = stickyStackMembers(objects, obj.stackId);
        if (members.length >= 2) {
          const texts = members.map((row) => row.text?.trim()).filter(Boolean);
          lines.push(`- Sticky stack (${members.length}): ${texts.join(" · ") || "untitled"}`);
          continue;
        }
      }
      const stickyText = obj.text?.trim();
      if (stickyText) lines.push(`- Sticky: ${stickyText}`);
      continue;
    }
    if (obj.type === "connector") {
      if (obj.label) lines.push(`- Connector: ${obj.label}`);
      continue;
    }
    if (obj.type === "card") {
      const cite = obj.cite;
      const label =
        cite?.label ||
        cite?.key ||
        cite?.path ||
        (cite?.number ? `#${cite.number}` : cite?.sessionId) ||
        obj.text ||
        "card";
      lines.push(`- Card (${cite?.kind ?? "card"}): ${label}`);
      continue;
    }
    if (obj.type === "image") {
      lines.push(`- Image${obj.text ? `: ${obj.text}` : ""}`);
      continue;
    }
    if (obj.type === "mermaid") {
      const src = obj.text?.trim();
      lines.push(`- Mermaid diagram${src ? `:\n\`\`\`mermaid\n${src}\n\`\`\`` : ""}`);
      continue;
    }
    if (obj.type === "table") {
      const table = obj.table;
      lines.push(`- Table: ${obj.text?.trim() || "Table view"}`);
      if (table) {
        lines.push(`  ${table.columns.map((col) => col.name).join(" | ")}`);
        for (const row of table.rows.slice(0, 20)) {
          lines.push(`  ${table.columns.map((col) => row.cells[col.id] || "").join(" | ")}`);
        }
      }
      continue;
    }
    if (obj.type === "timeline") {
      lines.push(`- Timeline: ${obj.text?.trim() || "Timeline view"}`);
      for (const item of obj.timeline?.items ?? []) {
        lines.push(`  ${item.title}: ${item.start} → ${item.end}`);
      }
      continue;
    }
    if (obj.type === "ink") {
      lines.push(`- Ink (${obj.ink?.points.length ?? 0} points)`);
      continue;
    }
    const text = obj.text?.trim() || obj.label?.trim();
    if (!text) continue;
    if (obj.type === "text") lines.push(text);
    else if (obj.type === "shape") lines.push(`- ${obj.shape ?? "shape"}: ${text}`);
    else if (obj.type === "frame") lines.push(`## ${text}`);
  }
  const comments = board.comments.filter(
    (row) => !row.resolved && objects.some((obj) => obj.id === row.objectId),
  );
  if (comments.length) {
    lines.push("", "## Comments");
    for (const row of comments) lines.push(`- ${row.body}`);
  }
  return lines.join("\n").trim();
}

export function formatBoardSlice(board: BoardDocument, opts?: { frameId?: string }): string {
  const objects = opts?.frameId ? objectsInFrame(board, opts.frameId) : board.objects;
  const cap = objects.slice(0, 80);
  const rows = cap.map((obj) => {
    const text = obj.text?.trim() || obj.label?.trim() || "";
    const cite = obj.cite ? ` cite=${obj.cite.kind}` : "";
    let extra = "";
    if (obj.type === "table" && obj.table) {
      const preview = obj.table.rows
        .slice(0, 8)
        .map((row) => obj.table!.columns.map((col) => row.cells[col.id] || "").join("|"))
        .filter((line) => line.replace(/\|/g, "").trim())
        .join("; ");
      extra = ` ${obj.table.columns.length}x${obj.table.rows.length}${preview ? ` ${preview}` : ""}`;
    } else if (obj.type === "timeline" && obj.timeline) {
      extra = ` ${obj.timeline.items.length} items ${obj.timeline.items
        .slice(0, 6)
        .map((item) => `${item.title} ${item.start}..${item.end}`)
        .join("; ")}`;
    } else if (obj.type === "ink" && obj.ink) {
      extra = ` ${obj.ink.points.length} pts`;
    } else if (obj.type === "sticky" && obj.stackId) {
      extra = " stacked";
    }
    return `${obj.id} ${obj.type} (${Math.round(obj.x)},${Math.round(obj.y)} ${Math.round(obj.w)}x${Math.round(obj.h)})${cite}${extra}${text ? ` ${text}` : ""}`;
  });
  const more = objects.length > cap.length ? `\n… ${objects.length - cap.length} more objects` : "";
  return `Board ${board.id} ${board.title}\n${rows.join("\n")}${more}`;
}

export const BOARD_AI_ACTIONS = [
  {
    id: "ask",
    label: "Ask Locus",
    prompt:
      "Look at this selection and help me work with it. Use board_upsert when you write onto the canvas.",
  },
  {
    id: "cluster",
    label: "Cluster stickies",
    prompt:
      "Cluster these stickies by theme. Group related notes into labeled frames or color them. Use board_upsert.",
  },
  {
    id: "summarize",
    label: "Summarize into a sticky",
    prompt:
      "Summarize this selection into one new sticky on the board. Keep it short. Use board_upsert.",
  },
  {
    id: "diagram",
    label: "Diagram this",
    prompt:
      "Turn this selection into a diagram: add shapes and connectors as needed. Use board_upsert.",
  },
] as const;

export type BoardAiActionId = (typeof BOARD_AI_ACTIONS)[number]["id"];

export function formatBoardSelection(board: BoardDocument, ids: Iterable<string>): string {
  const selected = new Set(ids);
  if (!selected.size) return formatFrameBrief(board);
  if (selected.size === 1) {
    const only = board.objects.find((row) => selected.has(row.id));
    if (only?.type === "frame") return formatFrameBrief(board, only.id);
  }
  const objects = board.objects.filter(
    (row) =>
      selected.has(row.id) ||
      (row.type === "connector" &&
        Boolean((row.fromId && selected.has(row.fromId)) || (row.toId && selected.has(row.toId)))),
  );
  return formatFrameBrief({ ...board, objects: objects.length ? objects : board.objects });
}

export function boardAiPrompt(
  board: BoardDocument,
  ids: Iterable<string>,
  action: BoardAiActionId = "ask",
): string {
  const meta = BOARD_AI_ACTIONS.find((row) => row.id === action) ?? BOARD_AI_ACTIONS[0];
  return `${meta.prompt}\n\n${formatBoardSelection(board, ids)}`;
}

const GITHUB_PR = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i;
const GITLAB_MR = /gitlab\.com\/(.+)\/-\/merge_requests\/(\d+)/i;
const JIRA_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const SLACK_ARCHIVES = /slack\.com\/archives\/([A-Z0-9]+)(?:\/p(\d{16}))?/i;
const ATLASSIAN = /atlassian\.net\/browse\/([A-Z][A-Z0-9]+-\d+)/i;
const LINEAR_ISSUE = /linear\.app\/[^/]+\/issue\/([A-Z][A-Z0-9]+-\d+)/i;

export function parseBoardPaste(text: string): BoardCite | undefined {
  const raw = text.trim();
  if (!raw) return undefined;
  const github = raw.match(GITHUB_PR);
  if (github) {
    return {
      kind: "pull",
      number: Number(github[3]),
      url: raw,
      label: `${github[1]}/${github[2]}#${github[3]}`,
    };
  }
  const gitlab = raw.match(GITLAB_MR);
  if (gitlab) {
    return {
      kind: "pull",
      number: Number(gitlab[2]),
      url: raw,
      label: `MR !${gitlab[2]}`,
    };
  }
  const slack = raw.match(SLACK_ARCHIVES);
  if (slack) {
    const stamp = slack[2];
    const threadTs = stamp ? `${stamp.slice(0, 10)}.${stamp.slice(10)}` : undefined;
    return {
      kind: "slack",
      channelId: slack[1],
      threadTs,
      url: raw,
      label: slack[1],
    };
  }
  const linear = raw.match(LINEAR_ISSUE);
  if (linear) {
    return { kind: "linear", key: linear[1], url: raw, label: linear[1] };
  }
  const atlassian = raw.match(ATLASSIAN);
  if (atlassian) {
    return { kind: "jira", key: atlassian[1], url: raw, label: atlassian[1] };
  }
  const jira = raw.match(JIRA_KEY);
  if (jira && !raw.includes(" ")) {
    return { kind: "jira", key: jira[1], label: jira[1] };
  }
  return undefined;
}

export function boardTitleFromStarter(starter?: BoardStarter): string {
  if (!starter || starter === "blank") return "Untitled board";
  const meta = BOARD_STARTER_META.find((row) => row.id === starter);
  return meta?.title ?? "Untitled board";
}

export const BOARD_GRID = 20;
export const BOARD_STACK_OFFSET = 8;
export const BOARD_STACK_MAX = 24;
export const BOARD_CLIPBOARD_PREFIX = "locus-board:";
export const BOARD_RESIZE_HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
export type BoardResizeHandle = (typeof BOARD_RESIZE_HANDLES)[number];
export const BOARD_LAYER_OPS = ["front", "forward", "backward", "back"] as const;
export type BoardLayerOp = (typeof BOARD_LAYER_OPS)[number];
export const BOARD_ALIGN_OPS = ["left", "center", "right", "top", "middle", "bottom"] as const;
export type BoardAlignOp = (typeof BOARD_ALIGN_OPS)[number];
export const BOARD_DISTRIBUTE_OPS = ["horizontal", "vertical"] as const;
export type BoardDistributeOp = (typeof BOARD_DISTRIBUTE_OPS)[number];
export const BOARD_PORTS = ["n", "e", "s", "w"] as const;
export type BoardPort = (typeof BOARD_PORTS)[number];
export const BOARD_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const BOARD_ASSET_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$/i;

export function snapBoardCoord(n: number, grid = BOARD_GRID): number {
  return Math.round(n / grid) * grid;
}

export function boardObjectCenter(obj: BoardObject): { x: number; y: number } {
  return { x: obj.x + obj.w / 2, y: obj.y + obj.h / 2 };
}

export function hitBoardObject(
  objects: BoardObject[],
  x: number,
  y: number,
): BoardObject | undefined {
  const hits = objects.filter(
    (row) =>
      row.type !== "connector" &&
      row.type !== "ink" &&
      x >= row.x &&
      y >= row.y &&
      x <= row.x + row.w &&
      y <= row.y + row.h,
  );
  return hits
    .sort((a, b) => {
      if (a.type === "frame" && b.type !== "frame") return -1;
      if (a.type !== "frame" && b.type === "frame") return 1;
      return (a.z ?? 0) - (b.z ?? 0) || objects.indexOf(a) - objects.indexOf(b);
    })
    .at(-1);
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function pickBoardHit(
  objects: BoardObject[],
  x: number,
  y: number,
  connectorThreshold = 14,
): BoardObject | undefined {
  const box = hitBoardObject(objects, x, y);
  if (box && box.type !== "frame") return box;
  return (
    hitBoardInk(objects, x, y, connectorThreshold) ??
    hitBoardConnector(objects, x, y, connectorThreshold) ??
    box
  );
}

export function hitBoardInk(
  objects: BoardObject[],
  x: number,
  y: number,
  threshold = 10,
): BoardObject | undefined {
  let best: BoardObject | undefined;
  let bestDist = threshold;
  for (const row of objects) {
    if (row.type !== "ink" || !row.ink?.points.length) continue;
    const pts = row.ink.points;
    let d = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      d = Math.min(d, distToSegment(x, y, row.x + a.x, row.y + a.y, row.x + b.x, row.y + b.y));
    }
    const width = row.ink.width ?? 2.5;
    if (d <= Math.max(threshold, width + 4) && d <= bestDist) {
      best = row;
      bestDist = d;
    }
  }
  return best;
}

export function hitBoardConnector(
  objects: BoardObject[],
  x: number,
  y: number,
  threshold = 10,
): BoardObject | undefined {
  let best: BoardObject | undefined;
  let bestDist = threshold;
  for (const row of objects) {
    if (row.type !== "connector" || !row.fromId || !row.toId) continue;
    const from = objects.find((item) => item.id === row.fromId);
    const to = objects.find((item) => item.id === row.toId);
    if (!from || !to) continue;
    const ends = boardConnectorAnchors(from, to);
    const pts = boardConnectorElbow(ends.from, ends.to);
    let d = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      d = Math.min(d, distToSegment(x, y, a.x, a.y, b.x, b.y));
    }
    if (d <= bestDist) {
      best = row;
      bestDist = d;
    }
  }
  return best;
}

export function boardContentBounds(
  objects: BoardObject[],
  pad = 40,
): { x: number; y: number; w: number; h: number } {
  const boxes = objects.filter((row) => row.type !== "connector");
  if (!boxes.length) return { x: -40, y: -40, w: 800, h: 600 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const row of boxes) {
    minX = Math.min(minX, row.x);
    minY = Math.min(minY, row.y);
    maxX = Math.max(maxX, row.x + row.w);
    maxY = Math.max(maxY, row.y + row.h);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export function cameraToFit(
  objects: BoardObject[],
  viewport: { w: number; h: number },
): { x: number; y: number; z: number } {
  const box = boardContentBounds(objects);
  const vw = Math.max(1, viewport.w);
  const vh = Math.max(1, viewport.h);
  const z = Math.min(
    2.4,
    Math.max(0.25, Math.min(vw / Math.max(1, box.w), vh / Math.max(1, box.h))),
  );
  return { x: box.x, y: box.y, z };
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalizeRect(rect: { x: number; y: number; w: number; h: number }): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  return {
    x: Math.min(rect.x, rect.x + rect.w),
    y: Math.min(rect.y, rect.y + rect.h),
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };
}

export function objectsInRect(
  objects: BoardObject[],
  rect: { x: number; y: number; w: number; h: number },
): string[] {
  const box = normalizeRect(rect);
  return objects
    .filter((row) => row.type !== "connector" && rectsOverlap(row, box))
    .map((row) => row.id);
}

export function stickyStackMembers(objects: BoardObject[], stackId: string): BoardObject[] {
  const order = new Map(objects.map((row, i) => [row.id, i]));
  return objects
    .filter((row) => row.type === "sticky" && row.stackId === stackId)
    .sort((a, b) => {
      const dz = (a.z ?? 0) - (b.z ?? 0);
      if (dz) return dz;
      return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    });
}

export function selectionStickyStackIds(objects: BoardObject[], id: string): string[] {
  const hit = objects.find((row) => row.id === id);
  if (hit?.type === "sticky" && hit.stackId) {
    return stickyStackMembers(objects, hit.stackId).map((row) => row.id);
  }
  return hit ? [id] : [];
}

function pointInBoardObject(obj: BoardObject, x: number, y: number): boolean {
  return x >= obj.x && x <= obj.x + obj.w && y >= obj.y && y <= obj.y + obj.h;
}

export function pruneStickyStacks(objects: BoardObject[]): BoardObject[] {
  const counts = new Map<string, number>();
  for (const row of objects) {
    if (row.type === "sticky" && row.stackId) {
      counts.set(row.stackId, (counts.get(row.stackId) ?? 0) + 1);
    }
  }
  return objects.map((row) => {
    if (!row.stackId) return row;
    if (row.type !== "sticky" || (counts.get(row.stackId) ?? 0) < 2) {
      const next = { ...row };
      delete next.stackId;
      return next;
    }
    return row;
  });
}

export function layoutStickyStack(objects: BoardObject[], stackId: string): BoardObject[] {
  const members = stickyStackMembers(objects, stackId);
  if (members.length < 2) return objects;
  const base = members[0]!;
  const pos = new Map(
    members.map((row, i) => [
      row.id,
      {
        x: base.x + i * BOARD_STACK_OFFSET,
        y: base.y + i * BOARD_STACK_OFFSET,
        z: i,
      },
    ]),
  );
  return objects.map((row) => {
    const next = pos.get(row.id);
    if (!next) return row;
    return { ...row, x: next.x, y: next.y, z: next.z, stackId };
  });
}

export function stackBoardStickies(objects: BoardObject[], ids: Iterable<string>): BoardObject[] {
  const want = new Set([...ids]);
  const seed = objects.filter((row) => want.has(row.id) && row.type === "sticky");
  if (seed.length < 2) return objects;
  const prior = new Set(seed.map((row) => row.stackId).filter(Boolean) as string[]);
  const members: BoardObject[] = [];
  const seen = new Set<string>();
  for (const row of objects) {
    if (row.type !== "sticky") continue;
    if (!want.has(row.id) && !(row.stackId && prior.has(row.stackId))) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    members.push(row);
  }
  const capped = members.slice(0, BOARD_STACK_MAX);
  if (capped.length < 2) return objects;
  const stackId = crypto.randomUUID();
  const stacked = new Set(capped.map((row) => row.id));
  const next = objects.map((row) => (stacked.has(row.id) ? { ...row, stackId } : row));
  return pruneStickyStacks(layoutStickyStack(next, stackId));
}

export function unstackBoardStickies(objects: BoardObject[], ids: Iterable<string>): BoardObject[] {
  const want = new Set([...ids]);
  const stackIds = new Set(
    objects
      .filter((row) => want.has(row.id) && row.type === "sticky" && row.stackId)
      .map((row) => row.stackId!),
  );
  if (!stackIds.size) return objects;
  const pos = new Map<string, { x: number; y: number }>();
  for (const stackId of stackIds) {
    const members = stickyStackMembers(objects, stackId);
    const base = members[0];
    if (!base) continue;
    let x = base.x;
    for (const row of members) {
      pos.set(row.id, { x, y: base.y });
      x += row.w + BOARD_GRID;
    }
  }
  return pruneStickyStacks(
    objects.map((row) => {
      const next = pos.get(row.id);
      if (!next) return row;
      const copy = { ...row, x: next.x, y: next.y };
      delete copy.stackId;
      return copy;
    }),
  );
}

export function maybeStackDroppedStickies(
  objects: BoardObject[],
  movedIds: Set<string>,
): BoardObject[] {
  const moved = objects.filter((row) => movedIds.has(row.id) && row.type === "sticky");
  if (!moved.length) return objects;
  const merge = new Set<string>();
  for (const sticky of moved) {
    const cx = sticky.x + sticky.w / 2;
    const cy = sticky.y + sticky.h / 2;
    const hits = objects.filter((row) => {
      if (row.type !== "sticky" || row.id === sticky.id) return false;
      if (sticky.stackId && row.stackId === sticky.stackId) return false;
      return pointInBoardObject(row, cx, cy);
    });
    if (!hits.length) continue;
    merge.add(sticky.id);
    for (const row of hits) merge.add(row.id);
  }
  if (merge.size < 2) return objects;
  return stackBoardStickies(objects, merge);
}

export function dropBoardObjects(board: BoardDocument, ids: Iterable<string>): BoardDocument {
  const drop = new Set([...ids].filter(Boolean));
  return {
    ...board,
    objects: pruneStickyStacks(
      board.objects.filter((row) => {
        if (drop.has(row.id)) return false;
        if (row.type === "connector" && (drop.has(row.fromId ?? "") || drop.has(row.toId ?? ""))) {
          return false;
        }
        return true;
      }),
    ),
    comments: board.comments.filter((row) => !drop.has(row.objectId)),
  };
}

function geometricallyInFrame(row: BoardObject, frame: BoardObject): boolean {
  return (
    row.x >= frame.x &&
    row.y >= frame.y &&
    row.x + row.w <= frame.x + frame.w &&
    row.y + row.h <= frame.y + frame.h
  );
}

export function childrenOfFrame(objects: BoardObject[], frame: BoardObject): BoardObject[] {
  return objects.filter((row) => {
    if (row.id === frame.id || row.type === "connector" || row.type === "frame") return false;
    return row.frameId === frame.id || geometricallyInFrame(row, frame);
  });
}

export function selectionMoveIds(objects: BoardObject[], selected: string[]): Set<string> {
  const ids = new Set(
    selected.filter((id) => objects.some((row) => row.id === id && row.type !== "connector")),
  );
  for (const obj of objects) {
    if (obj.type === "frame" && ids.has(obj.id)) {
      for (const child of childrenOfFrame(objects, obj)) ids.add(child.id);
    }
  }
  for (const obj of objects) {
    if (obj.type === "sticky" && obj.stackId && ids.has(obj.id)) {
      for (const member of stickyStackMembers(objects, obj.stackId)) ids.add(member.id);
    }
  }
  return ids;
}

export function translateBoardObjects(
  objects: BoardObject[],
  ids: Set<string>,
  dx: number,
  dy: number,
): BoardObject[] {
  if (!dx && !dy) return objects;
  return objects.map((row) => (ids.has(row.id) ? { ...row, x: row.x + dx, y: row.y + dy } : row));
}

export function rehomeBoardObjects(objects: BoardObject[], movedIds?: Set<string>): BoardObject[] {
  const frames = objects.filter((row) => row.type === "frame");
  return objects.map((row) => {
    if (row.type === "connector" || row.type === "frame") return row;
    if (movedIds && !movedIds.has(row.id)) return row;
    let home: BoardObject | undefined;
    for (const frame of frames) {
      if (geometricallyInFrame(row, frame)) home = frame;
    }
    const frameId = home?.id;
    if (frameId === row.frameId) return row;
    return { ...row, frameId };
  });
}

export function resizeBoardObject(
  obj: BoardObject,
  handle: BoardResizeHandle,
  dx: number,
  dy: number,
  grid = BOARD_GRID,
  proportional = false,
): BoardObject {
  const minW = obj.type === "table" || obj.type === "timeline" ? grid * 16 : grid * 3;
  const minH = obj.type === "table" || obj.type === "timeline" ? grid * 8 : grid * 2;
  const right = origRight(obj);
  const bottom = origBottom(obj);
  let w = obj.w;
  let h = obj.h;
  if (handle.includes("e")) w = obj.w + dx;
  if (handle.includes("w")) w = obj.w - dx;
  if (handle.includes("s")) h = obj.h + dy;
  if (handle.includes("n")) h = obj.h - dy;
  if (proportional && handle.length === 2 && obj.w > 0 && obj.h > 0) {
    const sx = w / obj.w;
    const sy = h / obj.h;
    const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    w = obj.w * s;
    h = obj.h * s;
  }
  w = Math.max(minW, snapBoardCoord(w, grid));
  h = Math.max(minH, snapBoardCoord(h, grid));
  const x = handle.includes("w") ? snapBoardCoord(right - w, grid) : obj.x;
  const y = handle.includes("n") ? snapBoardCoord(bottom - h, grid) : obj.y;
  return { ...obj, x, y, w, h };
}

function origRight(obj: BoardObject): number {
  return obj.x + obj.w;
}

function origBottom(obj: BoardObject): number {
  return obj.y + obj.h;
}

export function selectionBounds(
  objects: BoardObject[],
  ids: Iterable<string>,
): { x: number; y: number; w: number; h: number } | undefined {
  const selected = new Set(ids);
  const boxes = objects.filter((row) => selected.has(row.id) && row.type !== "connector");
  if (boxes.length) return boardContentBounds(boxes, 0);
  const pts: { x: number; y: number }[] = [];
  for (const row of objects) {
    if (!selected.has(row.id) || row.type !== "connector") continue;
    const from = objects.find((item) => item.id === row.fromId);
    const to = objects.find((item) => item.id === row.toId);
    if (!from || !to) continue;
    const ends = boardConnectorAnchors(from, to);
    for (const pt of boardConnectorElbow(ends.from, ends.to)) pts.push(pt);
  }
  if (!pts.length) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of pts) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }
  const pad = 16;
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(32, maxX - minX + pad * 2),
    h: Math.max(32, maxY - minY + pad * 2),
  };
}

export function scaleBoardSelection(
  objects: BoardObject[],
  ids: Iterable<string>,
  handle: BoardResizeHandle,
  dx: number,
  dy: number,
  proportional = false,
): BoardObject[] {
  const idSet = new Set(ids);
  const box = selectionBounds(objects, idSet);
  if (!box || box.w <= 0 || box.h <= 0) return objects;
  const scaled = resizeBoardObject(
    { id: "_box", type: "frame", x: box.x, y: box.y, w: box.w, h: box.h },
    handle,
    dx,
    dy,
    BOARD_GRID,
    proportional,
  );
  const sx = scaled.w / box.w;
  const sy = scaled.h / box.h;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return objects;
  return objects.map((row) => {
    if (!idSet.has(row.id) || row.type === "connector") return row;
    return {
      ...row,
      x: snapBoardCoord(scaled.x + (row.x - box.x) * sx),
      y: snapBoardCoord(scaled.y + (row.y - box.y) * sy),
      w: Math.max(BOARD_GRID, snapBoardCoord(row.w * sx)),
      h: Math.max(BOARD_GRID, snapBoardCoord(row.h * sy)),
    };
  });
}

function stampZ(objects: BoardObject[]): BoardObject[] {
  return objects.map((row, i) => (row.z === i ? row : { ...row, z: i }));
}

export function layerBoardObjects(
  objects: BoardObject[],
  ids: string[],
  op: BoardLayerOp,
): BoardObject[] {
  const selected = new Set(ids);
  if (!selected.size) return objects;
  if (op === "front" || op === "back") {
    const moving = objects.filter((row) => selected.has(row.id));
    const rest = objects.filter((row) => !selected.has(row.id));
    return stampZ(op === "front" ? [...rest, ...moving] : [...moving, ...rest]);
  }
  const result = objects.slice();
  if (op === "forward") {
    for (let i = result.length - 2; i >= 0; i--) {
      if (selected.has(result[i]!.id) && !selected.has(result[i + 1]!.id)) {
        [result[i], result[i + 1]] = [result[i + 1]!, result[i]!];
      }
    }
  } else {
    for (let i = 1; i < result.length; i++) {
      if (selected.has(result[i]!.id) && !selected.has(result[i - 1]!.id)) {
        [result[i], result[i - 1]] = [result[i - 1]!, result[i]!];
      }
    }
  }
  return stampZ(result);
}

export function remapBoardObjects(
  objects: BoardObject[],
  opts?: { keepUnknownRefs?: boolean; dx?: number; dy?: number },
): BoardObject[] {
  const ids = new Map<string, string>();
  const stacks = new Map<string, string>();
  for (const obj of objects) ids.set(obj.id, crypto.randomUUID());
  const dx = opts?.dx ?? 0;
  const dy = opts?.dy ?? 0;
  return objects
    .map((obj) => {
      const next: BoardObject = {
        ...obj,
        id: ids.get(obj.id) ?? obj.id,
        x: obj.type === "connector" ? obj.x : obj.x + dx,
        y: obj.type === "connector" ? obj.y : obj.y + dy,
      };
      if (obj.stackId) {
        let mapped = stacks.get(obj.stackId);
        if (!mapped) {
          mapped = crypto.randomUUID();
          stacks.set(obj.stackId, mapped);
        }
        next.stackId = mapped;
      }
      if (obj.frameId) {
        const mapped = ids.get(obj.frameId);
        if (mapped) next.frameId = mapped;
        else if (opts?.keepUnknownRefs) next.frameId = obj.frameId;
        else delete next.frameId;
      }
      if (obj.fromId) {
        const mapped = ids.get(obj.fromId);
        if (mapped) next.fromId = mapped;
        else delete next.fromId;
      }
      if (obj.toId) {
        const mapped = ids.get(obj.toId);
        if (mapped) next.toId = mapped;
        else delete next.toId;
      }
      return next;
    })
    .filter((row) => row.type !== "connector" || (row.fromId && row.toId));
}

export function objectsForClipboard(objects: BoardObject[], selected: string[]): BoardObject[] {
  const selectedSet = new Set(selected);
  return objects.filter((row) => {
    if (selectedSet.has(row.id)) return true;
    return (
      row.type === "connector" &&
      selectedSet.has(row.fromId ?? "") &&
      selectedSet.has(row.toId ?? "")
    );
  });
}

export function duplicateBoardObjects(
  objects: BoardObject[],
  selected: string[],
  grid = BOARD_GRID,
): { objects: BoardObject[]; ids: string[] } {
  const src = objectsForClipboard(objects, selected);
  if (!src.length) return { objects, ids: [] };
  const copies = pruneStickyStacks(
    remapBoardObjects(src, { keepUnknownRefs: true, dx: grid, dy: grid }),
  );
  return { objects: [...objects, ...copies], ids: copies.map((row) => row.id) };
}

export function serializeBoardClipboard(objects: BoardObject[]): string {
  return `${BOARD_CLIPBOARD_PREFIX}${JSON.stringify(objects)}`;
}

export function parseBoardClipboard(text: string): BoardObject[] | undefined {
  const raw = text.trim();
  if (!raw.startsWith(BOARD_CLIPBOARD_PREFIX)) return undefined;
  try {
    const parsed = JSON.parse(raw.slice(BOARD_CLIPBOARD_PREFIX.length)) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const objects = parsed.map(parseBoardObject).filter((row): row is BoardObject => Boolean(row));
    return objects.length ? objects : undefined;
  } catch {
    return undefined;
  }
}

export function boardObjectPort(obj: BoardObject, port: BoardPort): { x: number; y: number } {
  const c = boardObjectCenter(obj);
  if (port === "n") return { x: c.x, y: obj.y };
  if (port === "s") return { x: c.x, y: obj.y + obj.h };
  if (port === "w") return { x: obj.x, y: c.y };
  return { x: obj.x + obj.w, y: c.y };
}

export function boardConnectorAnchors(
  from: BoardObject,
  to: BoardObject,
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const ac = boardObjectCenter(from);
  const bc = boardObjectCenter(to);
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  return {
    from: boardObjectPort(from, horizontal ? (dx >= 0 ? "e" : "w") : dy >= 0 ? "s" : "n"),
    to: boardObjectPort(to, horizontal ? (dx >= 0 ? "w" : "e") : dy >= 0 ? "n" : "s"),
  };
}

export function boardConnectorElbow(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const mid = from.x + dx / 2;
    return [from, { x: mid, y: from.y }, { x: mid, y: to.y }, to];
  }
  const mid = from.y + dy / 2;
  return [from, { x: from.x, y: mid }, { x: to.x, y: mid }, to];
}

function selectableBoxes(objects: BoardObject[], ids: Iterable<string>): BoardObject[] {
  const selected = new Set(ids);
  return objects.filter((row) => selected.has(row.id) && row.type !== "connector");
}

export function alignBoardObjects(
  objects: BoardObject[],
  ids: Iterable<string>,
  op: BoardAlignOp,
): BoardObject[] {
  const boxes = selectableBoxes(objects, ids);
  if (boxes.length < 2) return objects;
  const box = boardContentBounds(boxes, 0);
  const next = new Map(boxes.map((row) => [row.id, row]));
  for (const row of boxes) {
    let x = row.x;
    let y = row.y;
    if (op === "left") x = box.x;
    else if (op === "center") x = box.x + (box.w - row.w) / 2;
    else if (op === "right") x = box.x + box.w - row.w;
    else if (op === "top") y = box.y;
    else if (op === "middle") y = box.y + (box.h - row.h) / 2;
    else y = box.y + box.h - row.h;
    next.set(row.id, { ...row, x: snapBoardCoord(x), y: snapBoardCoord(y) });
  }
  return objects.map((row) => next.get(row.id) ?? row);
}

export function distributeBoardObjects(
  objects: BoardObject[],
  ids: Iterable<string>,
  axis: BoardDistributeOp,
): BoardObject[] {
  const boxes = selectableBoxes(objects, ids);
  if (boxes.length < 3) return objects;
  const horizontal = axis === "horizontal";
  const ordered = [...boxes].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const start = horizontal ? first.x : first.y;
  const end = horizontal ? last.x + last.w : last.y + last.h;
  const span = ordered.reduce((sum, row) => sum + (horizontal ? row.w : row.h), 0);
  const gap = (end - start - span) / (ordered.length - 1);
  let cursor = start;
  const next = new Map<string, BoardObject>();
  for (const row of ordered) {
    next.set(
      row.id,
      horizontal ? { ...row, x: snapBoardCoord(cursor) } : { ...row, y: snapBoardCoord(cursor) },
    );
    cursor += (horizontal ? row.w : row.h) + gap;
  }
  return objects.map((row) => next.get(row.id) ?? row);
}

export function frameBoardSelection(
  objects: BoardObject[],
  ids: Iterable<string>,
): { objects: BoardObject[]; frameId: string } {
  const boxes = selectableBoxes(objects, ids);
  if (!boxes.length) return { objects, frameId: "" };
  const box = boardContentBounds(boxes, BOARD_GRID);
  const frameId = crypto.randomUUID();
  const frame: BoardObject = {
    id: frameId,
    type: "frame",
    x: snapBoardCoord(box.x - BOARD_GRID),
    y: snapBoardCoord(box.y - BOARD_GRID * 2),
    w: Math.max(BOARD_GRID * 8, snapBoardCoord(box.w + BOARD_GRID * 2)),
    h: Math.max(BOARD_GRID * 6, snapBoardCoord(box.h + BOARD_GRID * 3)),
    text: "Frame",
  };
  const boxed = new Set(boxes.map((row) => row.id));
  const next = objects.map((row) =>
    boxed.has(row.id) && row.type !== "frame" ? { ...row, frameId } : row,
  );
  return { objects: [frame, ...next], frameId };
}

const CLUSTER_STOP = new Set([
  "this",
  "that",
  "with",
  "from",
  "into",
  "about",
  "have",
  "will",
  "just",
  "note",
  "notes",
  "todo",
  "make",
  "need",
  "should",
  "them",
  "they",
  "your",
  "when",
  "what",
]);

export function clusterBoardStickies(
  objects: BoardObject[],
  ids: Iterable<string>,
): { objects: BoardObject[]; frameIds: string[] } {
  const selected = new Set(ids);
  const stickies = objects.filter((row) => row.type === "sticky" && selected.has(row.id));
  if (stickies.length < 2) return { objects, frameIds: [] };
  const groups = clusterStickyGroups(stickies);
  const bounds = boardContentBounds(stickies, 0);
  let cursorX = snapBoardCoord(bounds.x);
  const top = snapBoardCoord(bounds.y);
  const placed = new Map<string, BoardObject>();
  const frames: BoardObject[] = [];
  const frameIds: string[] = [];
  for (const group of groups) {
    const frameId = crypto.randomUUID();
    const layout = layoutStickyFrame(group.stickies, group.title, cursorX, top, frameId);
    frames.push(layout.frame);
    frameIds.push(frameId);
    for (const sticky of layout.stickies) placed.set(sticky.id, sticky);
    cursorX = snapBoardCoord(layout.frame.x + layout.frame.w + BOARD_GRID * 2);
  }
  const next = objects.map((row) => placed.get(row.id) ?? row);
  return { objects: [...frames, ...next], frameIds };
}

function clusterStickyGroups(
  stickies: BoardObject[],
): Array<{ title: string; stickies: BoardObject[] }> {
  const tokensById = new Map(stickies.map((row) => [row.id, themeTokens(row.text ?? "")]));
  const owners = new Map<string, string[]>();
  for (const sticky of stickies) {
    for (const token of tokensById.get(sticky.id) ?? []) {
      const list = owners.get(token) ?? [];
      list.push(sticky.id);
      owners.set(token, list);
    }
  }
  const shared = new Set(
    [...owners.entries()].filter(([, ids]) => ids.length >= 2).map(([token]) => token),
  );
  const assigned = new Map<string, string>();
  for (const sticky of stickies) {
    const choices = (tokensById.get(sticky.id) ?? []).filter((token) => shared.has(token));
    if (!choices.length) continue;
    choices.sort((a, b) => {
      const size = (owners.get(b)?.length ?? 0) - (owners.get(a)?.length ?? 0);
      return size || a.localeCompare(b);
    });
    assigned.set(sticky.id, choices[0]!);
  }
  const buckets = new Map<string, BoardObject[]>();
  const other: BoardObject[] = [];
  for (const sticky of stickies) {
    const token = assigned.get(sticky.id);
    if (!token) {
      other.push(sticky);
      continue;
    }
    const list = buckets.get(token) ?? [];
    list.push(sticky);
    buckets.set(token, list);
  }
  const groups = [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([token, rows]) => ({ title: themeLabel(token, rows), stickies: rows }));
  if (other.length && groups.length) groups.push({ title: "Other", stickies: other });
  else if (other.length) groups.push({ title: "Notes", stickies: other });
  return groups;
}

function themeTokens(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4 && !CLUSTER_STOP.has(token)),
    ),
  ];
}

function themeLabel(token: string, stickies: BoardObject[]): string {
  const re = new RegExp(`\\b${token}\\b`, "i");
  for (const sticky of stickies) {
    const match = sticky.text?.match(re);
    if (match?.[0]) return match[0];
  }
  return token;
}

function layoutStickyFrame(
  stickies: BoardObject[],
  title: string,
  x: number,
  y: number,
  frameId: string,
): { frame: BoardObject; stickies: BoardObject[] } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(stickies.length)));
  const cellW = Math.max(...stickies.map((row) => row.w));
  const cellH = Math.max(...stickies.map((row) => row.h));
  const gap = 16;
  const pad = BOARD_GRID;
  const titleBand = BOARD_GRID * 2;
  const rows = Math.ceil(stickies.length / cols);
  const frame: BoardObject = {
    id: frameId,
    type: "frame",
    x,
    y,
    w: snapBoardCoord(pad * 2 + cols * cellW + (cols - 1) * gap),
    h: snapBoardCoord(titleBand + pad + rows * cellH + (rows - 1) * gap + pad),
    text: title,
    color: "paper",
  };
  const placed = stickies.map((row, index) => {
    const col = index % cols;
    const rowIndex = Math.floor(index / cols);
    return {
      ...row,
      frameId,
      stackId: undefined,
      x: snapBoardCoord(x + pad + col * (cellW + gap)),
      y: snapBoardCoord(y + titleBand + rowIndex * (cellH + gap)),
    };
  });
  return { frame, stickies: placed };
}

export function connectBoardObjects(
  objects: BoardObject[],
  fromId: string,
  toId: string,
): BoardObject[] {
  if (fromId === toId) return objects;
  const from = objects.find((row) => row.id === fromId);
  const to = objects.find((row) => row.id === toId);
  if (!from || !to || from.type === "connector" || to.type === "connector") return objects;
  if (
    objects.some(
      (row) =>
        row.type === "connector" &&
        ((row.fromId === fromId && row.toId === toId) ||
          (row.fromId === toId && row.toId === fromId)),
    )
  ) {
    return objects;
  }
  return [
    ...objects,
    {
      id: crypto.randomUUID(),
      type: "connector",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      fromId,
      toId,
    },
  ];
}

export function spawnConnectedBoardObject(
  objects: BoardObject[],
  fromId: string,
  port: BoardPort,
): { objects: BoardObject[]; id: string } {
  const from = objects.find((row) => row.id === fromId);
  if (!from || from.type === "connector") return { objects, id: "" };
  const id = crypto.randomUUID();
  const gap = BOARD_GRID * 3;
  const w = from.type === "sticky" ? 160 : Math.max(BOARD_GRID * 4, from.w);
  const h = from.type === "sticky" ? 140 : Math.max(BOARD_GRID * 2, from.h);
  let x = from.x;
  let y = from.y;
  if (port === "e") x = from.x + from.w + gap;
  else if (port === "w") x = from.x - w - gap;
  else if (port === "s") y = from.y + from.h + gap;
  else y = from.y - h - gap;
  const child: BoardObject = {
    id,
    type:
      from.type === "card" ||
      from.type === "image" ||
      from.type === "frame" ||
      from.type === "table" ||
      from.type === "timeline" ||
      from.type === "mermaid"
        ? "sticky"
        : from.type,
    x: snapBoardCoord(x),
    y: snapBoardCoord(y),
    w,
    h,
    text: from.type === "sticky" || from.type === "text" || from.type === "shape" ? "" : "Note",
    color: from.color ?? "amber",
    shape: from.shape,
  };
  return { objects: connectBoardObjects([...objects, child], fromId, id), id };
}

/** Frames in reading order for presentation (J/K): top-to-bottom, then left-to-right. */
export function boardFramesInPresentationOrder(objects: BoardObject[]): BoardObject[] {
  return objects
    .filter((row) => row.type === "frame")
    .slice()
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
}

/** First J/K enters the selected (or first/last) frame; later presses step. */
export function nextPresentFrameIndex(
  frameCount: number,
  presentIndex: number | null,
  selectedFrameIndex: number,
  delta: number,
): number {
  if (frameCount <= 0) return 0;
  if (presentIndex == null) {
    if (selectedFrameIndex >= 0) return selectedFrameIndex;
    return delta < 0 ? frameCount - 1 : 0;
  }
  return (presentIndex + delta + frameCount * 8) % frameCount;
}

/** Sticky checklist from a /plan, laid out inside a frame. */
export function pinPlanObjectsToFrame(
  frame: BoardObject,
  items: Array<{ id?: string; text: string }>,
  opts?: { files?: string[]; risks?: string[] },
): BoardObject[] {
  if (frame.type !== "frame") return [];
  const out: BoardObject[] = [];
  let y = frame.y + BOARD_GRID * 2;
  const x = frame.x + BOARD_GRID;
  const w = Math.min(200, Math.max(BOARD_GRID * 6, frame.w - BOARD_GRID * 2));
  const h = 140;
  const colors: BoardStickyColor[] = ["amber", "mint", "sky", "rose", "violet", "paper"];
  for (let i = 0; i < items.length; i++) {
    const text = items[i]?.text?.trim();
    if (!text) continue;
    out.push({
      id: crypto.randomUUID(),
      type: "sticky",
      x: snapBoardCoord(x),
      y: snapBoardCoord(y),
      w,
      h,
      frameId: frame.id,
      text: `${i + 1}. ${text}`,
      color: colors[i % colors.length],
    });
    y += h + BOARD_GRID;
  }
  for (const file of opts?.files ?? []) {
    const path = file.trim();
    if (!path) continue;
    out.push({
      id: crypto.randomUUID(),
      type: "card",
      x: snapBoardCoord(x),
      y: snapBoardCoord(y),
      w: Math.min(240, frame.w - BOARD_GRID * 2),
      h: 64,
      frameId: frame.id,
      text: path,
      cite: { kind: "file", path, label: path },
    });
    y += 72;
  }
  for (const risk of opts?.risks ?? []) {
    const text = risk.trim();
    if (!text) continue;
    out.push({
      id: crypto.randomUUID(),
      type: "sticky",
      x: snapBoardCoord(x),
      y: snapBoardCoord(y),
      w,
      h: 100,
      frameId: frame.id,
      text: `Risk: ${text}`,
      color: "rose",
    });
    y += 112;
  }
  return out;
}

export type BoardCiteLiveContext = {
  sessions?: Array<{
    id: string;
    title: string;
    status?: string;
    archived?: boolean;
    needsHuman?: string;
  }>;
  repos?: Array<{ id: string; name?: string; checkout: { url: string } }>;
  slack?: Array<{ id: string; name: string }>;
  automations?: Array<{ id: string; name: string }>;
  brainNodes?: Array<{ id: string; name: string; type?: string }>;
};

export function bindBoardCite(cite: BoardCite, ctx: BoardCiteLiveContext): BoardCite {
  const next = { ...cite };
  if (cite.kind === "pull" && !cite.repoId && cite.url) {
    const github = cite.url.match(GITHUB_PR);
    const owner = github?.[1];
    const repo = github?.[2];
    const hit = ctx.repos?.find((row) => {
      const parsed = parseOwnerRepo(row.checkout.url);
      if (owner && repo && parsed) {
        return (
          parsed.owner.toLowerCase() === owner.toLowerCase() &&
          parsed.repo.toLowerCase() === repo.toLowerCase()
        );
      }
      return normalizeRepoUrl(row.checkout.url) === normalizeRepoUrl(cite.url ?? "");
    });
    if (hit) {
      next.repoId = hit.id;
      if (!next.label && cite.number) next.label = `${hit.name ?? "PR"} #${cite.number}`;
    }
  }
  if (cite.kind === "slack" && cite.channelId) {
    const hit = ctx.slack?.find((row) => row.id === cite.channelId);
    if (hit) next.label = hit.name;
  }
  return next;
}

export function boardCitePresentation(
  cite: BoardCite,
  ctx: BoardCiteLiveContext,
): { label: string; detail?: string; stale: boolean } {
  const bound = bindBoardCite(cite, ctx);
  if (cite.kind === "agent" || cite.kind === "design") {
    const session = ctx.sessions?.find((row) => row.id === cite.sessionId);
    if (!session || session.archived) {
      return { label: bound.label || "Missing session", detail: "stale", stale: true };
    }
    return {
      label: session.title || bound.label || cite.kind,
      detail: session.needsHuman?.trim() || session.status,
      stale: false,
    };
  }
  if (cite.kind === "pull") {
    const repo = bound.repoId ? ctx.repos?.find((row) => row.id === bound.repoId) : undefined;
    const stale = Boolean(bound.repoId) && !repo;
    return {
      label: bound.label || (bound.number ? `#${bound.number}` : "Pull request"),
      detail: repo?.name,
      stale,
    };
  }
  if (cite.kind === "slack") {
    const channel = bound.channelId
      ? ctx.slack?.find((row) => row.id === bound.channelId)
      : undefined;
    return {
      label: channel?.name || bound.label || "Slack",
      stale: Boolean(bound.channelId) && !channel,
    };
  }
  if (cite.kind === "automation") {
    const job = bound.automationId
      ? ctx.automations?.find((row) => row.id === bound.automationId)
      : undefined;
    return {
      label: job?.name || bound.label || "Automation",
      stale: Boolean(bound.automationId) && !job,
    };
  }
  if (cite.kind === "jira") {
    return { label: bound.key || bound.label || "Jira", stale: false };
  }
  if (cite.kind === "linear") {
    return { label: bound.key || bound.label || "Linear", stale: false };
  }
  if (cite.kind === "brain") {
    const nodeId = bound.nodeId || bound.key;
    const node = nodeId ? ctx.brainNodes?.find((row) => row.id === nodeId) : undefined;
    return {
      label: node?.name || bound.label || nodeId || "Brain",
      detail: node?.type,
      stale: Boolean(nodeId) && Boolean(ctx.brainNodes) && !node,
    };
  }
  return { label: bound.path || bound.label || cite.kind, stale: false };
}

export function boardNeedsYouItems(boards: BoardSummary[]): Array<{
  key: string;
  boardId: string;
  objectId: string;
  commentId: string;
  title: string;
  detail: string;
}> {
  const out: Array<{
    key: string;
    boardId: string;
    objectId: string;
    commentId: string;
    title: string;
    detail: string;
  }> = [];
  for (const board of boards) {
    if (board.archived) continue;
    for (const row of board.pendingComments ?? []) {
      out.push({
        key: `b:${board.id}:${row.id}`,
        boardId: board.id,
        objectId: row.objectId,
        commentId: row.id,
        title: board.title,
        detail: row.body,
      });
    }
  }
  return out;
}
