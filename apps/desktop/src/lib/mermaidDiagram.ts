export type MermaidKind = "sequence" | "state" | "erd";

const FONT = 15;
const FONT_SM = 13;
const CHAR_W = 8.4;
const FAMILY = "Outfit, Segoe UI, system-ui, sans-serif";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textWidth(label: string, size = FONT): number {
  return Math.ceil(label.length * CHAR_W * (size / FONT));
}

function svgRoot(label: string, width: number, height: number, body: string): string {
  return `<svg class="pr-stack-mermaid" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeXml(label)}">${body}</svg>`;
}

export function mermaidKindFromSource(source: string): MermaidKind | undefined {
  if (/^\s*sequenceDiagram\b/m.test(source)) return "sequence";
  if (/^\s*stateDiagram(?:-v2)?\b/m.test(source)) return "state";
  if (/^\s*erDiagram\b/m.test(source)) return "erd";
  return undefined;
}

export function mermaidSvg(source: string): string | undefined {
  const kind = mermaidKindFromSource(source);
  if (kind === "sequence") return sequenceSvg(source);
  if (kind === "state") return stateSvg(source);
  if (kind === "erd") return erdSvg(source);
  return undefined;
}

export function diagramKindLabel(kind?: string): string {
  if (kind === "sequence") return "Call flow";
  if (kind === "state") return "Lifecycle";
  if (kind === "erd") return "Data model";
  return "Diagram";
}

function sequenceSvg(source: string): string | undefined {
  const participants: { id: string; label: string }[] = [];
  const messages: { from: string; to: string; text: string }[] = [];
  const addParticipant = (id: string, label = id) => {
    if (!participants.some((row) => row.id === id)) participants.push({ id, label });
  };
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    const participant = line.match(/^participant\s+(\S+)(?:\s+as\s+(.+))?$/i);
    if (participant) {
      addParticipant(participant[1]!, (participant[2] ?? participant[1])!.trim());
      continue;
    }
    const message = line.match(/^(\S+)\s*(-+>>?|-->>)\s*(\S+)\s*:\s*(.*)$/);
    if (message) {
      addParticipant(message[1]!);
      addParticipant(message[3]!);
      messages.push({
        from: message[1]!,
        to: message[3]!,
        text: message[4]!.trim() || "call",
      });
    }
  }
  if (participants.length < 2 || !messages.length) return undefined;
  const boxH = 44;
  const col = Math.max(176, ...participants.map((row) => Math.max(156, textWidth(row.label) + 40)));
  const width = Math.max(480, participants.length * col + 24);
  const rowGap = 52;
  const height = 32 + boxH + messages.length * rowGap + 28;
  const xOf = (id: string) => {
    const index = Math.max(
      0,
      participants.findIndex((row) => row.id === id),
    );
    return 12 + index * col + col / 2;
  };
  const boxes = participants
    .map((row, index) => {
      const w = col - 24;
      const x = 12 + index * col + (col - w) / 2;
      return `${nodeRect(x, 16, w, boxH, 8, row.label)}
        <line class="pr-stack-life" x1="${xOf(row.id)}" y1="${16 + boxH}" x2="${xOf(row.id)}" y2="${height - 12}"/>`;
    })
    .join("");
  const arrows = messages
    .map((row, index) => {
      const y = 16 + boxH + 28 + index * rowGap;
      const x1 = xOf(row.from);
      const x2 = xOf(row.to);
      const dir = x2 >= x1 ? 1 : -1;
      const tip = 10;
      return `<line class="pr-stack-edge" x1="${x1}" y1="${y}" x2="${x2 - tip * dir}" y2="${y}"/>
        <polygon points="${x2},${y} ${x2 - tip * dir},${y - 5} ${x2 - tip * dir},${y + 5}"/>
        <text x="${(x1 + x2) / 2}" y="${y - 8}" text-anchor="middle" font-size="${FONT_SM}" font-family="${FAMILY}">${escapeXml(row.text)}</text>`;
    })
    .join("");
  return svgRoot("Sequence diagram", width, height, `${boxes}${arrows}`);
}

function stateSvg(source: string): string | undefined {
  const states: string[] = [];
  const edges: { from: string; to: string }[] = [];
  const add = (id: string) => {
    if (id !== "[*]" && !states.includes(id)) states.push(id);
  };
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    const edge = line.match(/^(\S+)\s*-->\s*(\S+)$/);
    if (!edge) continue;
    add(edge[1]!);
    add(edge[2]!);
    edges.push({ from: edge[1]!, to: edge[2]! });
  }
  if (states.length < 2) return undefined;

  const pillH = 56;
  const gapX = 44;
  const gapY = 40;
  const padX = 32;
  const padY = 32;
  const startR = 8;
  const pills = states.map((id) => ({
    id,
    w: Math.max(120, textWidth(id) + 48),
    h: pillH,
  }));
  const maxRowWidth = 720;
  const rows: (typeof pills)[] = [];
  let row: typeof pills = [];
  let rowW = 0;
  for (const pill of pills) {
    const next = row.length === 0 ? pill.w : rowW + gapX + pill.w;
    if (row.length && next > maxRowWidth) {
      rows.push(row);
      row = [pill];
      rowW = pill.w;
    } else {
      row.push(pill);
      rowW = next;
    }
  }
  if (row.length) rows.push(row);

  const rowWidths = rows.map(
    (items) => items.reduce((sum, pill) => sum + pill.w, 0) + (items.length - 1) * gapX,
  );
  const contentW = Math.max(...rowWidths);
  const width = Math.max(560, contentW + padX * 2 + startR * 2 + 16);
  const height = padY * 2 + rows.length * pillH + (rows.length - 1) * gapY;

  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  rows.forEach((items, rowIndex) => {
    let x = padX + startR * 2 + 12;
    const y = padY + rowIndex * (pillH + gapY);
    for (const pill of items) {
      pos.set(pill.id, { x, y, w: pill.w, h: pill.h });
      x += pill.w + gapX;
    }
  });

  const first = pos.get(states[0]!);
  const start = first
    ? { cx: first.x - 18 - startR, cy: first.y + pillH / 2 }
    : { cx: padX + startR, cy: padY + pillH / 2 };

  const nodes = pills
    .map((pill) => {
      const p = pos.get(pill.id)!;
      return nodeRect(p.x, p.y, p.w, p.h, pillH / 2, pill.id, "pr-stack-pill");
    })
    .join("");

  const startMark = `<circle class="pr-stack-start" cx="${start.cx}" cy="${start.cy}" r="${startR}"/>`;

  const arrows = edges
    .map((edge) => {
      if (edge.from === "[*]") {
        const target = pos.get(edge.to);
        if (!target) return "";
        const x2 = target.x;
        const y = target.y + target.h / 2;
        return edgeLine(start.cx + startR, y, x2, y);
      }
      const from = pos.get(edge.from);
      const to = pos.get(edge.to);
      if (!from || !to) return "";
      if (from.y === to.y && to.x > from.x) {
        return edgeLine(from.x + from.w, from.y + from.h / 2, to.x, to.y + to.h / 2);
      }
      if (from.y === to.y && to.x < from.x) {
        return edgeLine(from.x, from.y + from.h / 2, to.x + to.w, to.y + to.h / 2, -1);
      }
      const x1 = from.x + from.w / 2;
      const y1 = from.y + from.h;
      const x2 = to.x + to.w / 2;
      const y2 = to.y;
      const midY = (y1 + y2) / 2;
      return `<polyline class="pr-stack-edge" fill="none" points="${x1},${y1} ${x1},${midY} ${x2},${midY} ${x2},${y2}"/>
        <polygon points="${x2},${y2} ${x2 - 5},${y2 - 9} ${x2 + 5},${y2 - 9}"/>`;
    })
    .join("");

  return svgRoot("State diagram", width, height, `${startMark}${nodes}${arrows}`);
}

function erdSvg(source: string): string | undefined {
  const entities: string[] = [];
  const edges: { from: string; to: string; label: string }[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    const rel = line.match(/^(\S+)\s+[|o}{-]+\s+(\S+)(?:\s*:\s*(.*))?$/);
    if (rel) {
      if (!entities.includes(rel[1]!)) entities.push(rel[1]!);
      if (!entities.includes(rel[2]!)) entities.push(rel[2]!);
      edges.push({ from: rel[1]!, to: rel[2]!, label: (rel[3] ?? "").trim() });
      continue;
    }
    if (/^[A-Za-z][\w]*$/.test(line) && line !== "erDiagram" && !entities.includes(line)) {
      entities.push(line);
    }
  }
  if (entities.length < 1) return undefined;
  const boxH = 52;
  const gap = 32;
  const pad = 24;
  const boxes = entities.map((id) => ({
    id,
    w: Math.max(148, textWidth(id) + 48),
  }));
  const width = Math.max(
    480,
    boxes.reduce((sum, box) => sum + box.w, 0) + (boxes.length - 1) * gap + pad * 2,
  );
  const relH = edges.length ? 18 + edges.length * 28 : 0;
  const height = pad + boxH + (relH ? 16 + relH : pad);
  let x = pad;
  const pos = new Map<string, { x: number; w: number }>();
  const nodes = boxes
    .map((box) => {
      const node = nodeRect(x, pad, box.w, boxH, 8, box.id);
      pos.set(box.id, { x, w: box.w });
      x += box.w + gap;
      return node;
    })
    .join("");
  const y0 = pad + boxH;
  const arrows = edges
    .map((edge, index) => {
      const from = pos.get(edge.from);
      const to = pos.get(edge.to);
      if (!from || !to) return "";
      const x1 = from.x + from.w / 2;
      const x2 = to.x + to.w / 2;
      const y = y0 + 20 + index * 28;
      const label = edge.label || `${edge.from} → ${edge.to}`;
      return `<path class="pr-stack-edge" fill="none" d="M ${x1} ${y0} V ${y} H ${x2}"/>
        <text x="${(x1 + x2) / 2}" y="${y - 6}" text-anchor="middle" font-size="${FONT_SM}" font-family="${FAMILY}">${escapeXml(label)}</text>`;
    })
    .join("");
  return svgRoot("Entity diagram", width, height, `${nodes}${arrows}`);
}

function nodeRect(
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  label: string,
  extraClass = "",
): string {
  const cls = extraClass ? `pr-stack-node ${extraClass}` : "pr-stack-node";
  return `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>
    <text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle" font-size="${FONT}" font-family="${FAMILY}">${escapeXml(label)}</text>`;
}

function edgeLine(x1: number, y1: number, x2: number, y2: number, dir = 1): string {
  const tip = 10;
  return `<line class="pr-stack-edge" x1="${x1}" y1="${y1}" x2="${x2 - tip * dir}" y2="${y2}"/>
    <polygon points="${x2},${y2} ${x2 - tip * dir},${y2 - 5} ${x2 - tip * dir},${y2 + 5}"/>`;
}
