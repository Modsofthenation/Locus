/** Map Miro REST items onto Locus Board objects (and the reverse). */

import {
  BOARD_SHAPE_KINDS,
  parseBoardObject,
  repairBoardText,
  type BoardObject,
  type BoardShapeKind,
  type BoardStickyColor,
} from "./board.js";

export function miroHtmlToText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
  return repairBoardText(text).trim();
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const MIRO_TO_SHAPE: Record<string, BoardShapeKind> = {
  rectangle: "rect",
  round_rectangle: "rounded",
  circle: "ellipse",
  triangle: "triangle",
  rhombus: "diamond",
  parallelogram: "parallelogram",
  trapezoid: "trapezoid",
  pentagon: "pentagon",
  hexagon: "hexagon",
  octagon: "octagon",
  star: "star",
  arrow_right: "arrow-right",
  arrow_left: "arrow-left",
  arrow_up: "arrow-up",
  arrow_down: "arrow-down",
  cloud: "cloud",
  can: "cylinder",
};

const SHAPE_TO_MIRO: Record<BoardShapeKind, string> = {
  rect: "rectangle",
  rounded: "round_rectangle",
  ellipse: "circle",
  diamond: "rhombus",
  triangle: "triangle",
  "triangle-down": "triangle",
  "triangle-left": "triangle",
  "triangle-right": "triangle",
  parallelogram: "parallelogram",
  trapezoid: "trapezoid",
  pentagon: "pentagon",
  hexagon: "hexagon",
  octagon: "octagon",
  star: "star",
  "arrow-right": "arrow_right",
  "arrow-left": "arrow_left",
  "arrow-up": "arrow_up",
  "arrow-down": "arrow_down",
  chevron: "arrow_right",
  cylinder: "can",
  cloud: "cloud",
  callout: "round_rectangle",
  document: "rectangle",
  pill: "round_rectangle",
};

const MIRO_TO_COLOR: Record<string, BoardStickyColor> = {
  light_yellow: "amber",
  yellow: "amber",
  orange: "amber",
  light_green: "mint",
  green: "mint",
  dark_green: "mint",
  light_blue: "sky",
  cyan: "sky",
  blue: "sky",
  dark_blue: "sky",
  light_pink: "rose",
  pink: "rose",
  red: "rose",
  violet: "violet",
  gray: "paper",
  black: "paper",
};

const COLOR_TO_MIRO: Record<BoardStickyColor, string> = {
  amber: "light_yellow",
  mint: "light_green",
  sky: "light_blue",
  rose: "light_pink",
  violet: "violet",
  paper: "gray",
};

function miroFillToColor(fill: string): BoardStickyColor | undefined {
  return MIRO_TO_COLOR[fill];
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function itemBox(item: Record<string, unknown>): { x: number; y: number; w: number; h: number } {
  const pos = rec(item.position);
  const geo = rec(item.geometry);
  const w = Math.max(40, num(geo.width, 160));
  const h = Math.max(40, num(geo.height, 80));
  const origin = pos.origin === "top-left" ? "top-left" : "center";
  return {
    x: origin === "top-left" ? num(pos.x) : num(pos.x) - w / 2,
    y: origin === "top-left" ? num(pos.y) : num(pos.y) - h / 2,
    w,
    h,
  };
}

function itemText(data: Record<string, unknown>): string {
  const raw =
    (typeof data.content === "string" && data.content) ||
    (typeof data.title === "string" && data.title) ||
    (typeof data.description === "string" && data.description) ||
    "";
  return miroHtmlToText(raw);
}

function miroItemToObject(raw: unknown): { miroId: string; object: BoardObject } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const item = raw as Record<string, unknown>;
  const miroId = typeof item.id === "string" ? item.id.trim() : "";
  const type = typeof item.type === "string" ? item.type : "";
  if (!miroId || type === "connector") return undefined;
  const data = rec(item.data);
  const style = rec(item.style);
  const box = itemBox(item);
  const text = itemText(data);
  const color = miroFillToColor(typeof style.fillColor === "string" ? style.fillColor : "");
  const id = crypto.randomUUID();
  let next: Record<string, unknown> = { id, ...box };
  if (type === "sticky_note") {
    next = { ...next, type: "sticky", text, color: color ?? "amber" };
  } else if (type === "shape") {
    const shapeRaw = typeof data.shape === "string" ? data.shape : "round_rectangle";
    const shape = MIRO_TO_SHAPE[shapeRaw];
    next = {
      ...next,
      type: "shape",
      text,
      shape: shape && BOARD_SHAPE_KINDS.includes(shape) ? shape : "rounded",
      color: color ?? "sky",
    };
  } else if (type === "text") {
    next = { ...next, type: "text", text, fontSize: num(style.fontSize) || undefined };
  } else if (type === "frame") {
    next = { ...next, type: "frame", text: text || "Frame" };
  } else if (type === "card") {
    next = {
      ...next,
      type: "card",
      text: text || "Card",
      w: Math.max(box.w, 220),
      h: Math.max(box.h, 72),
    };
  } else {
    if (!text) return undefined;
    next = { ...next, type: "sticky", text, color: color ?? "paper" };
  }
  const object = parseBoardObject(next);
  return object ? { miroId, object } : undefined;
}

function miroConnectorToObject(raw: unknown, idMap: Map<string, string>): BoardObject | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const item = raw as Record<string, unknown>;
  const start = rec(item.startItem);
  const end = rec(item.endItem);
  const fromId = typeof start.id === "string" ? idMap.get(start.id) : undefined;
  const toId = typeof end.id === "string" ? idMap.get(end.id) : undefined;
  if (!fromId || !toId) return undefined;
  const caption = rec(item.captions);
  const label =
    (Array.isArray(item.captions)
      ? miroHtmlToText(String((item.captions as Array<{ content?: string }>)[0]?.content ?? ""))
      : typeof caption.content === "string"
        ? miroHtmlToText(caption.content)
        : "") || undefined;
  return parseBoardObject({
    id: crypto.randomUUID(),
    type: "connector",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    fromId,
    toId,
    label,
  });
}

export function importMiroItems(items: unknown[], connectors: unknown[] = []): BoardObject[] {
  const idMap = new Map<string, string>();
  const objects: BoardObject[] = [];
  for (const raw of items) {
    const mapped = miroItemToObject(raw);
    if (!mapped) continue;
    idMap.set(mapped.miroId, mapped.object.id);
    objects.push(mapped.object);
    if (objects.length >= 250) break;
  }
  for (const raw of connectors) {
    const wire = miroConnectorToObject(raw, idMap);
    if (wire) objects.push(wire);
    if (objects.length >= 280) break;
  }
  return objects;
}

function miroPosition(obj: BoardObject): Record<string, unknown> {
  return { origin: "center", x: obj.x + obj.w / 2, y: obj.y + obj.h / 2 };
}

function tableAsText(obj: BoardObject): string {
  const table = obj.table;
  if (!table) return obj.text || "Table";
  const header = table.columns.map((col) => col.name).join(" | ");
  const rows = table.rows.map((row) =>
    table.columns.map((col) => row.cells[col.id] || "").join(" | "),
  );
  return [obj.text || "Table", header, ...rows].filter(Boolean).join("\n");
}

function timelineAsText(obj: BoardObject): string {
  const items = obj.timeline?.items ?? [];
  return [
    obj.text || "Timeline",
    ...items.map((item) => `${item.title}: ${item.start} → ${item.end}`),
  ].join("\n");
}

export type MiroCreateKind = "sticky_notes" | "shapes" | "texts" | "frames" | "cards";

export function locusObjectToMiroCreate(
  obj: BoardObject,
): { kind: MiroCreateKind; body: Record<string, unknown> } | undefined {
  if (obj.type === "connector" || obj.type === "image" || obj.type === "ink") return undefined;
  const geometry = { width: Math.max(40, obj.w), height: Math.max(40, obj.h) };
  const position = miroPosition(obj);
  if (obj.type === "sticky") {
    return {
      kind: "sticky_notes",
      body: {
        data: { content: obj.text || "", shape: "square" },
        style: {
          fillColor: COLOR_TO_MIRO[(obj.color as BoardStickyColor) ?? "amber"] ?? "light_yellow",
        },
        position,
        geometry,
      },
    };
  }
  if (obj.type === "shape") {
    const shape = SHAPE_TO_MIRO[obj.shape ?? "rounded"] ?? "round_rectangle";
    return {
      kind: "shapes",
      body: {
        data: { content: obj.text || "", shape },
        position,
        geometry,
      },
    };
  }
  if (obj.type === "text" || obj.type === "table" || obj.type === "timeline") {
    const content =
      obj.type === "table"
        ? tableAsText(obj)
        : obj.type === "timeline"
          ? timelineAsText(obj)
          : obj.text || "";
    return {
      kind: "texts",
      body: {
        data: { content },
        style: obj.fontSize ? { fontSize: String(obj.fontSize) } : undefined,
        position,
        geometry,
      },
    };
  }
  if (obj.type === "frame") {
    return {
      kind: "frames",
      body: {
        data: { title: obj.text || "Frame", format: "custom", type: "freeform" },
        position,
        geometry,
      },
    };
  }
  if (obj.type === "card") {
    return {
      kind: "cards",
      body: {
        data: { title: obj.text || obj.cite?.label || "Card" },
        position,
        geometry,
      },
    };
  }
  return undefined;
}

export function locusConnectorToMiroBody(
  obj: BoardObject,
  miroIds: Map<string, string>,
): Record<string, unknown> | undefined {
  if (obj.type !== "connector") return undefined;
  const start = obj.fromId ? miroIds.get(obj.fromId) : undefined;
  const end = obj.toId ? miroIds.get(obj.toId) : undefined;
  if (!start || !end) return undefined;
  return { startItem: { id: start }, endItem: { id: end } };
}
