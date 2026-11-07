import type { BrainEdge, BrainNode, BrainNodeType } from "@locus/shared";

export const BRAIN_GRAPH_NODE_WIDTH = 196;
export const BRAIN_GRAPH_NODE_HEIGHT = 56;
export const BRAIN_GRAPH_COL_GAP = 72;
export const BRAIN_GRAPH_ROW_GAP = 24;
/** Floor for wheel/buttons/Fit so large maps can still shrink into the stage. */
export const BRAIN_GRAPH_MIN_ZOOM = 0.05;
export const BRAIN_GRAPH_MAX_ZOOM = 2.4;
/** Soft ceiling when Fit would otherwise blow up a tiny graph. */
export const BRAIN_GRAPH_FIT_MAX_ZOOM = 1.15;

export function clampBrainGraphZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(BRAIN_GRAPH_MAX_ZOOM, Math.max(BRAIN_GRAPH_MIN_ZOOM, z));
}

const COL_PITCH = BRAIN_GRAPH_NODE_WIDTH + BRAIN_GRAPH_COL_GAP;
const ROW_PITCH = BRAIN_GRAPH_NODE_HEIGHT + BRAIN_GRAPH_ROW_GAP;
const MIN_ARC = BRAIN_GRAPH_NODE_WIDTH + 32;
const LAYOUT_PASSES = 8;
const FORCE_ITERS = 64;
const LARGE_GRAPH = 60;

export type BrainGraphLayoutId =
  "layers" | "flow" | "tree" | "radial" | "concentric" | "circle" | "clusters" | "grid" | "force";

export type BrainGraphDetail = "overview" | "full";
export type BrainGraphFamilyId = "services" | "apis" | "contracts" | "knowledge";

export const BRAIN_GRAPH_LAYOUTS: { id: BrainGraphLayoutId; label: string }[] = [
  { id: "layers", label: "Architecture layers" },
  { id: "flow", label: "Edge flow" },
  { id: "tree", label: "Spanning tree" },
  { id: "radial", label: "Radial" },
  { id: "concentric", label: "Concentric layers" },
  { id: "circle", label: "Circle" },
  { id: "clusters", label: "Type clusters" },
  { id: "grid", label: "Compact grid" },
  { id: "force", label: "Force directed" },
];

const LAYOUT_IDS = new Set<BrainGraphLayoutId>(BRAIN_GRAPH_LAYOUTS.map((row) => row.id));

export const BRAIN_GRAPH_FAMILIES: {
  id: BrainGraphFamilyId;
  label: string;
  types: readonly BrainNodeType[];
}[] = [
  { id: "services", label: "Services", types: ["Repository", "Service"] },
  { id: "apis", label: "APIs", types: ["APIEndpoint", "Handler"] },
  { id: "contracts", label: "Contracts", types: ["Capability", "UsageContract"] },
  { id: "knowledge", label: "Knowledge", types: ["Concept", "Note"] },
];

export const BRAIN_GRAPH_LAYER_LABELS: Record<number, string> = {
  0: "repos",
  1: "services",
  2: "APIs",
  3: "handlers",
  4: "capabilities",
  5: "contracts",
  6: "concepts",
  7: "notes",
};

const LAYER_FOR: Record<BrainNodeType, number> = {
  Repository: 0,
  Service: 1,
  APIEndpoint: 2,
  Handler: 3,
  Capability: 4,
  UsageContract: 5,
  Concept: 6,
  Note: 7,
};

const OVERVIEW_HIDDEN = new Set<BrainNodeType>(["Concept", "Note"]);
const SINK_TYPES = new Set<BrainNodeType>(["APIEndpoint", "UsageContract"]);
const CONTRACT_TYPES = new Set<BrainNodeType>(["UsageContract", "Capability"]);

const TYPE_PURPOSE: Record<BrainNodeType, string> = {
  Repository:
    "A checkout the brain indexed — the ownership boundary for claims tagged to that remote or folder.",
  Service: "A process or package that owns APIs. Other claims hang off this.",
  APIEndpoint:
    "A published HTTP (or similar) route. A sink: this is where a change becomes a public request.",
  Handler:
    "Code that handles a request or event. Work behind an API, not the published URL itself.",
  Capability: "A named ability the system exposes — what callers can ask for.",
  UsageContract: "How callers are supposed to use a service or API. A contract and a sink.",
  Concept: "A domain idea other claims refer to. Hidden in Overview.",
  Note: "An annotation on the graph, not a structural claim. Hidden in Overview.",
};

export type BrainGraphPos = { x: number; y: number };

export type BrainInspectorLink = {
  id: string;
  name: string;
  type: BrainNodeType | "";
  edgeType: string;
  edgeLabel: string;
  inferred: boolean;
};

export type BrainInspectorFact = {
  key: string;
  label: string;
  value: string;
};

export type BrainNodeInspection = {
  type: BrainNodeType;
  typeLabel: string;
  layer: string;
  purpose: string;
  name: string;
  id: string;
  roles: string[];
  facts: BrainInspectorFact[];
  inputs: BrainInspectorLink[];
  outputs: BrainInspectorLink[];
  extraInputs: number;
  extraOutputs: number;
  degreeIn: number;
  degreeOut: number;
  pathSummary: string;
  evidence?: string;
  evidenceLoc?: BrainEvidenceLoc;
};

export type BrainEvidenceLoc = {
  display: string;
  path?: string;
  line?: number;
};

const LINK_LIMIT = 16;

export function isBrainGraphLayoutId(value: unknown): value is BrainGraphLayoutId {
  return typeof value === "string" && LAYOUT_IDS.has(value as BrainGraphLayoutId);
}

export function brainGraphLayerFor(type: string): number {
  return LAYER_FOR[type as BrainNodeType] ?? 7;
}

export function brainGraphFamilyFor(type: string): BrainGraphFamilyId {
  for (const family of BRAIN_GRAPH_FAMILIES) {
    if ((family.types as readonly string[]).includes(type)) return family.id;
  }
  return "knowledge";
}

export function brainGraphTypePurpose(type: string): string {
  if (type in TYPE_PURPOSE) return TYPE_PURPOSE[type as BrainNodeType];
  return "A claim on the brain graph.";
}

export function brainGraphLayoutUsesColumns(layout: BrainGraphLayoutId): boolean {
  return layout === "layers" || layout === "flow";
}

export function defaultBrainGraphDetail(nodeCount: number): BrainGraphDetail {
  return nodeCount >= LARGE_GRAPH ? "overview" : "full";
}

export function neighborIds(seed: string, edges: BrainEdge[], hops = 1): Set<string> {
  const ids = new Set<string>([seed]);
  let frontier = new Set<string>([seed]);
  for (let i = 0; i < hops; i += 1) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (frontier.has(edge.from) && !ids.has(edge.to)) {
        ids.add(edge.to);
        next.add(edge.to);
      }
      if (frontier.has(edge.to) && !ids.has(edge.from)) {
        ids.add(edge.from);
        next.add(edge.from);
      }
    }
    frontier = next;
    if (!frontier.size) break;
  }
  return ids;
}

export function visibleBrainGraph(
  nodes: BrainNode[],
  edges: BrainEdge[],
  opts: {
    detail: BrainGraphDetail;
    families: ReadonlySet<BrainGraphFamilyId>;
    focusId?: string | null;
    neighborhoodOnly?: boolean;
  },
): { nodes: BrainNode[]; edges: BrainEdge[]; neighborIds: Set<string> } {
  let kept = nodes.filter((n) => opts.families.has(brainGraphFamilyFor(n.type)));
  if (opts.detail === "overview") {
    kept = kept.filter((n) => !OVERVIEW_HIDDEN.has(n.type));
  }
  const ids = new Set(kept.map((n) => n.id));
  const linked = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const neighbors = opts.focusId ? neighborIds(opts.focusId, linked, 1) : new Set<string>();
  if (opts.neighborhoodOnly && opts.focusId && neighbors.size) {
    kept = kept.filter((n) => neighbors.has(n.id));
    const focusIds = new Set(kept.map((n) => n.id));
    return {
      nodes: kept,
      edges: linked.filter((e) => focusIds.has(e.from) && focusIds.has(e.to)),
      neighborIds: neighbors,
    };
  }
  return { nodes: kept, edges: linked, neighborIds: neighbors };
}

export function searchBrainNodes(nodes: BrainNode[], query: string): BrainNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes
    .filter((n) => {
      const hay =
        `${n.name} ${n.id} ${n.type} ${n.description ?? ""} ${n.evidence ?? ""} ${n.aliases?.join(" ") ?? ""} ${n.repo ?? ""}`.toLowerCase();
      return hay.includes(q);
    })
    .slice(0, 24);
}

export function isolateBrainPathIds(
  nodes: BrainNode[],
  edges: BrainEdge[],
  sourceId: string,
  targetId?: string | null,
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const ids = new Set(nodes.map((n) => n.id));
  if (!ids.has(sourceId)) return { nodeIds: new Set(), edgeIds: new Set() };
  const succ = new Map<string, { dst: string; id: string }[]>();
  const pred = new Map<string, { src: string; id: string }[]>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const s = succ.get(e.from) ?? [];
    s.push({ dst: e.to, id: e.id });
    succ.set(e.from, s);
    const p = pred.get(e.to) ?? [];
    p.push({ src: e.from, id: e.id });
    pred.set(e.to, p);
  }
  const sinks = new Set(nodes.filter((n) => SINK_TYPES.has(n.type)).map((n) => n.id));
  const targets = targetId && ids.has(targetId) ? new Set([targetId]) : sinks.size ? sinks : ids;

  const reachable = new Set<string>();
  const stack = [sourceId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const nxt of succ.get(cur) ?? []) {
      if (!reachable.has(nxt.dst)) stack.push(nxt.dst);
    }
  }
  const keep = new Set<string>([sourceId]);
  const back = [...targets].filter((t) => reachable.has(t));
  const seen = new Set(back);
  while (back.length) {
    const cur = back.pop()!;
    keep.add(cur);
    for (const prev of pred.get(cur) ?? []) {
      if (reachable.has(prev.src) && !seen.has(prev.src)) {
        seen.add(prev.src);
        back.push(prev.src);
      }
    }
  }
  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (keep.has(e.from) && keep.has(e.to)) edgeIds.add(e.id);
  }
  return { nodeIds: keep, edgeIds };
}

export function parseBrainEvidence(evidence?: string): BrainEvidenceLoc | undefined {
  const raw = evidence?.trim();
  if (!raw) return undefined;
  const loc = raw.match(/((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]+):(\d+)\s*$/);
  if (loc?.[1]) {
    return { display: raw, path: loc[1], line: Number(loc[2]) };
  }
  return { display: raw };
}

export function inspectBrainNode(
  node: BrainNode,
  nodes: BrainNode[],
  edges: BrainEdge[],
): BrainNodeInspection {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roles: string[] = [];
  if (SINK_TYPES.has(node.type)) roles.push("sink");
  if (CONTRACT_TYPES.has(node.type)) roles.push("contract");
  if (node.confidence) roles.push(node.confidence);

  const incoming = edges.filter((e) => e.to === node.id);
  const outgoing = edges.filter((e) => e.from === node.id);
  const inputs = incoming.slice(0, LINK_LIMIT).map((e) => toLink(e, byId, e.from));
  const outputs = outgoing.slice(0, LINK_LIMIT).map((e) => toLink(e, byId, e.to));
  const facts = factsFromNode(node);
  const inputKinds = countByEdge(inputs);
  const outputKinds = countByEdge(outputs);
  const pathSummary = summarizePath(inputKinds, outputKinds);

  return {
    type: node.type,
    typeLabel: node.type,
    layer: BRAIN_GRAPH_LAYER_LABELS[brainGraphLayerFor(node.type)] ?? "other",
    purpose: brainGraphTypePurpose(node.type),
    name: node.name,
    id: node.id,
    roles,
    facts,
    inputs,
    outputs,
    extraInputs: Math.max(0, incoming.length - LINK_LIMIT),
    extraOutputs: Math.max(0, outgoing.length - LINK_LIMIT),
    degreeIn: incoming.length,
    degreeOut: outgoing.length,
    pathSummary,
    evidence: node.evidence,
    evidenceLoc: parseBrainEvidence(node.evidence),
  };
}

function factsFromNode(node: BrainNode): BrainInspectorFact[] {
  const facts: BrainInspectorFact[] = [];
  const push = (key: string, label: string, value?: string) => {
    const next = value?.trim();
    if (!next) return;
    facts.push({ key, label, value: next });
  };
  push("description", "Description", node.description);
  push("evidence", "Evidence", node.evidence);
  push("repo", "Repo", node.repo);
  if (node.aliases?.length) push("aliases", "Aliases", node.aliases.join(", "));
  return facts;
}

function toLink(
  edge: BrainEdge,
  byId: Map<string, BrainNode>,
  otherId: string,
): BrainInspectorLink {
  const other = byId.get(otherId);
  return {
    id: otherId,
    name: other?.name || otherId,
    type: other?.type ?? "",
    edgeType: edge.type,
    edgeLabel: edge.type.replaceAll("_", " "),
    inferred: edge.confidence === "low",
  };
}

function countByEdge(links: BrainInspectorLink[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const link of links) {
    const label = link.edgeLabel || link.edgeType;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count }));
}

function summarizePath(
  ins: Array<{ label: string; count: number }>,
  outs: Array<{ label: string; count: number }>,
): string {
  const inText = ins.map((k) => `${k.label} ×${k.count}`).join(", ");
  const outText = outs.map((k) => `${k.label} ×${k.count}`).join(", ");
  if (inText && outText) return `${inText} → this → ${outText}`;
  if (outText) return `this → ${outText}`;
  if (inText) return `${inText} → this`;
  return "";
}

/** Shorten route / service labels so a dense graph stays readable. */
export function shortBrainGraphLabel(name: string, max = 22): string {
  const raw = name.trim();
  if (!raw) return "";
  const route = raw.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/i);
  if (route) {
    const method = route[1]!.toUpperCase();
    const path = route[2]!;
    const leaf = path === "/" ? "/" : `/${path.split("/").filter(Boolean).slice(-2).join("/")}`;
    const label = `${method} ${leaf}`;
    return label.length <= max ? label : `${label.slice(0, Math.max(1, max - 1))}…`;
  }
  if (raw.length <= max) return raw;
  return `${raw.slice(0, Math.max(1, max - 1))}…`;
}

export function presentBrainGraphFamilies(nodes: BrainNode[]): Set<BrainGraphFamilyId> {
  const found = new Set<BrainGraphFamilyId>();
  for (const n of nodes) found.add(brainGraphFamilyFor(n.type));
  return found;
}

export function allBrainGraphFamilies(): Set<BrainGraphFamilyId> {
  return new Set(BRAIN_GRAPH_FAMILIES.map((row) => row.id));
}

export function isLowConfidenceEdge(edge: BrainEdge): boolean {
  return edge.confidence === "low";
}

export function brainEdgePath(from: BrainGraphPos, to: BrainGraphPos, columns: boolean): string {
  const y1 = from.y + BRAIN_GRAPH_NODE_HEIGHT / 2;
  const y2 = to.y + BRAIN_GRAPH_NODE_HEIGHT / 2;
  let x1: number;
  let x2: number;
  if (columns) {
    x1 = from.x + BRAIN_GRAPH_NODE_WIDTH;
    x2 = to.x;
    const mid = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      x1 = from.x + BRAIN_GRAPH_NODE_WIDTH;
      x2 = to.x;
    } else {
      x1 = from.x;
      x2 = to.x + BRAIN_GRAPH_NODE_WIDTH;
    }
  } else {
    x1 = from.x + BRAIN_GRAPH_NODE_WIDTH / 2;
    x2 = to.x + BRAIN_GRAPH_NODE_WIDTH / 2;
    const yStart = dy >= 0 ? from.y + BRAIN_GRAPH_NODE_HEIGHT : from.y;
    const yEnd = dy >= 0 ? to.y : to.y + BRAIN_GRAPH_NODE_HEIGHT;
    const midY = (yStart + yEnd) / 2;
    return `M ${x1} ${yStart} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${yEnd}`;
  }
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

export function layoutBrainGraphBounds(pos: Map<string, BrainGraphPos>): {
  width: number;
  height: number;
  minX: number;
  minY: number;
} {
  if (!pos.size) {
    return { width: 720, height: 220, minX: 0, minY: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + BRAIN_GRAPH_NODE_WIDTH);
    maxY = Math.max(maxY, p.y + BRAIN_GRAPH_NODE_HEIGHT);
  }
  const pad = 36;
  return {
    minX: minX - pad,
    minY: minY - pad,
    width: maxX - minX + pad * 2,
    height: Math.max(220, maxY - minY + pad * 2),
  };
}

/** Shift positions so the top-left sits at the origin padding. */
export function normalizeBrainGraphPositions(
  pos: Map<string, BrainGraphPos>,
): Map<string, BrainGraphPos> {
  if (!pos.size) return pos;
  const bounds = layoutBrainGraphBounds(pos);
  if (bounds.minX === 0 && bounds.minY === 0) return pos;
  const next = new Map<string, BrainGraphPos>();
  for (const [id, p] of pos) {
    next.set(id, { x: p.x - bounds.minX, y: p.y - bounds.minY });
  }
  return next;
}

export function fitBrainGraphCamera(
  content: { width: number; height: number },
  view: { width: number; height: number },
  padding = 28,
): { x: number; y: number; z: number } {
  const availW = Math.max(1, view.width - padding * 2);
  const availH = Math.max(1, view.height - padding * 2);
  const z = Math.min(
    BRAIN_GRAPH_FIT_MAX_ZOOM,
    clampBrainGraphZoom(Math.min(availW / content.width, availH / content.height)),
  );
  return {
    z,
    x: (view.width - content.width * z) / 2,
    y: (view.height - content.height * z) / 2,
  };
}

export function layoutBrainGraphPositions(
  nodes: BrainNode[],
  edges: BrainEdge[] = [],
  layout: BrainGraphLayoutId = "layers",
): Map<string, BrainGraphPos> {
  if (layout === "flow") return layoutFlow(nodes, edges);
  if (layout === "tree") return layoutTree(nodes, edges);
  if (layout === "radial") return layoutRadial(nodes, edges);
  if (layout === "concentric") return layoutConcentric(nodes);
  if (layout === "circle") return layoutCircle(nodes);
  if (layout === "clusters") return layoutClusters(nodes);
  if (layout === "grid") return layoutGrid(nodes);
  if (layout === "force") return layoutForce(nodes, edges);
  return layoutLayers(nodes, edges);
}

export function layoutBrainGraph(
  nodes: BrainNode[],
  edges: BrainEdge[] = [],
  layout: BrainGraphLayoutId = "layers",
): {
  nodes: Array<BrainNode & BrainGraphPos>;
  height: number;
  width: number;
} {
  const pos = normalizeBrainGraphPositions(layoutBrainGraphPositions(nodes, edges, layout));
  const bounds = layoutBrainGraphBounds(pos);
  return {
    nodes: nodes.map((row) => ({ ...row, ...(pos.get(row.id) ?? { x: 0, y: 0 }) })),
    width: bounds.width,
    height: bounds.height,
  };
}

function median(values: number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function byName(a: BrainNode, b: BrainNode): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function byLayerThenName(a: BrainNode, b: BrainNode): number {
  return brainGraphLayerFor(a.type) - brainGraphLayerFor(b.type) || byName(a, b);
}

function placeRing(ring: BrainNode[], radius: number, pos: Map<string, BrainGraphPos>): void {
  ring.forEach((n, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(ring.length, 1);
    pos.set(n.id, { x: Math.cos(theta) * radius, y: Math.sin(theta) * radius });
  });
}

function ringRadius(count: number, ringIndex: number): number {
  return Math.max(
    ringIndex * COL_PITCH,
    count <= 1 ? (ringIndex === 0 ? 0 : BRAIN_GRAPH_NODE_WIDTH) : (count * MIN_ARC) / (2 * Math.PI),
  );
}

function placeColumns(order: BrainNode[][], edges: BrainEdge[]): Map<string, BrainGraphPos> {
  const pos = new Map<string, BrainGraphPos>();
  if (!order.length) return pos;

  const ids = new Set(order.flat().map((n) => n.id));
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const n of order.flat()) {
    preds.set(n.id, []);
    succs.set(n.id, []);
  }
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    succs.get(e.from)!.push(e.to);
    preds.get(e.to)!.push(e.from);
  }

  const colOf = new Map<string, number>();
  order.forEach((col, colIndex) => {
    for (const n of col) colOf.set(n.id, colIndex);
  });

  const rank = new Map<string, number>();
  const refreshRanks = () => {
    for (const col of order) col.forEach((n, i) => rank.set(n.id, i));
  };
  refreshRanks();

  const sortByBarycenter = (col: BrainNode[], neighborsOf: (id: string) => string[]) => {
    const keyed = col.map((n, i) => {
      const nbrs = neighborsOf(n.id)
        .map((id) => rank.get(id))
        .filter((v): v is number => v !== undefined);
      const bary = median(nbrs);
      return { n, bary: Number.isNaN(bary) ? i : bary, name: n.name, id: n.id };
    });
    keyed.sort(
      (a, b) => a.bary - b.bary || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
    return keyed.map((k) => k.n);
  };
  const inColumn = (colIndex: number) => (nbr: string) => colOf.get(nbr) === colIndex;

  for (let pass = 0; pass < LAYOUT_PASSES; pass += 1) {
    for (let i = 1; i < order.length; i += 1) {
      order[i] = sortByBarycenter(order[i]!, (id) => (preds.get(id) ?? []).filter(inColumn(i - 1)));
      refreshRanks();
    }
    for (let i = order.length - 2; i >= 0; i -= 1) {
      order[i] = sortByBarycenter(order[i]!, (id) => (succs.get(id) ?? []).filter(inColumn(i + 1)));
      refreshRanks();
    }
  }

  const maxRows = Math.max(...order.map((col) => col.length), 1);
  order.forEach((col, colIndex) => {
    const y0 = ((maxRows - col.length) * ROW_PITCH) / 2;
    col.forEach((n, i) => {
      pos.set(n.id, { x: colIndex * COL_PITCH, y: y0 + i * ROW_PITCH });
    });
  });
  return pos;
}

function layoutLayers(nodes: BrainNode[], edges: BrainEdge[]): Map<string, BrainGraphPos> {
  const columns = new Map<number, BrainNode[]>();
  for (const n of nodes) {
    const layer = brainGraphLayerFor(n.type);
    const list = columns.get(layer) ?? [];
    list.push(n);
    columns.set(layer, list);
  }
  const layers = [...columns.keys()].sort((a, b) => a - b);
  const order = layers.map((layer) => [...(columns.get(layer) ?? [])].sort(byName));
  return placeColumns(order, edges);
}

function layoutFlow(nodes: BrainNode[], edges: BrainEdge[]): Map<string, BrainGraphPos> {
  const ids = new Set(nodes.map((n) => n.id));
  const cap = Math.max(nodes.length - 1, 0);
  const rank = new Map<string, number>();
  for (const n of nodes) rank.set(n.id, 0);
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const e of edges) {
      if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
      const next = Math.min((rank.get(e.from) || 0) + 1, cap);
      if (next > (rank.get(e.to) || 0)) {
        rank.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const byRank = new Map<number, BrainNode[]>();
  for (const n of nodes) {
    const r = rank.get(n.id) || 0;
    const list = byRank.get(r) ?? [];
    list.push(n);
    byRank.set(r, list);
  }
  const order = [...byRank.keys()]
    .sort((a, b) => a - b)
    .map((r) => (byRank.get(r) ?? []).sort(byName));
  return placeColumns(order, edges);
}

function layoutRadial(nodes: BrainNode[], edges: BrainEdge[]): Map<string, BrainGraphPos> {
  const pos = new Map<string, BrainGraphPos>();
  if (!nodes.length) return pos;
  const ids = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  const degree = new Map<string, number>();
  for (const n of nodes) {
    adj.set(n.id, []);
    degree.set(n.id, 0);
  }
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  }
  const root =
    [...nodes].sort(
      (a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || byName(a, b),
    )[0] ?? nodes[0]!;

  const depth = new Map<string, number>();
  const rings: BrainNode[][] = [[root]];
  depth.set(root.id, 0);
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depth.get(cur.id) || 0;
    const nbrs = (adj.get(cur.id) ?? [])
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is BrainNode => Boolean(n))
      .sort(byName);
    for (const nbr of nbrs) {
      if (depth.has(nbr.id)) continue;
      depth.set(nbr.id, d + 1);
      const ring = rings[d + 1] ?? [];
      ring.push(nbr);
      rings[d + 1] = ring;
      queue.push(nbr);
    }
  }
  const leftover = nodes.filter((n) => !depth.has(n.id)).sort(byName);
  if (leftover.length) rings.push(leftover);

  rings.forEach((ring, d) => {
    if (d === 0 && ring.length === 1) {
      pos.set(ring[0]!.id, { x: 0, y: 0 });
      return;
    }
    placeRing(ring, ringRadius(ring.length, d === 0 ? 1 : d), pos);
  });
  return pos;
}

function layoutGrid(nodes: BrainNode[]): Map<string, BrainGraphPos> {
  const pos = new Map<string, BrainGraphPos>();
  const sorted = [...nodes].sort(byLayerThenName);
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  sorted.forEach((n, i) => {
    pos.set(n.id, {
      x: (i % cols) * COL_PITCH,
      y: Math.floor(i / cols) * ROW_PITCH,
    });
  });
  return pos;
}

function layoutCircle(nodes: BrainNode[]): Map<string, BrainGraphPos> {
  const pos = new Map<string, BrainGraphPos>();
  const ordered = [...nodes].sort(byLayerThenName);
  if (ordered.length <= 1) {
    if (ordered[0]) pos.set(ordered[0].id, { x: 0, y: 0 });
    return pos;
  }
  placeRing(ordered, ringRadius(ordered.length, 1), pos);
  return pos;
}

function layoutConcentric(nodes: BrainNode[]): Map<string, BrainGraphPos> {
  const pos = new Map<string, BrainGraphPos>();
  if (!nodes.length) return pos;
  const rings = new Map<number, BrainNode[]>();
  for (const n of nodes) {
    const layer = brainGraphLayerFor(n.type);
    const list = rings.get(layer) ?? [];
    list.push(n);
    rings.set(layer, list);
  }
  const layers = [...rings.keys()].sort((a, b) => a - b);
  layers.forEach((layer, d) => {
    const ring = (rings.get(layer) ?? []).sort(byName);
    if (d === 0 && ring.length === 1) {
      pos.set(ring[0]!.id, { x: 0, y: 0 });
      return;
    }
    placeRing(ring, ringRadius(ring.length, d === 0 ? 1 : d), pos);
  });
  return pos;
}

function layoutClusters(nodes: BrainNode[]): Map<string, BrainGraphPos> {
  const pos = new Map<string, BrainGraphPos>();
  if (!nodes.length) return pos;
  const groups = new Map<string, BrainNode[]>();
  for (const n of nodes) {
    const list = groups.get(n.type) ?? [];
    list.push(n);
    groups.set(n.type, list);
  }
  const types = [...groups.keys()].sort(
    (a, b) => brainGraphLayerFor(a) - brainGraphLayerFor(b) || a.localeCompare(b),
  );
  const packed = types.map((type) => {
    const members = (groups.get(type) ?? []).sort(byName);
    const cols = Math.max(1, Math.ceil(Math.sqrt(members.length)));
    const rows = Math.ceil(members.length / cols);
    return {
      members,
      cols,
      width: Math.max(0, cols - 1) * COL_PITCH,
      height: Math.max(0, rows - 1) * ROW_PITCH,
    };
  });
  const maxSpan = Math.max(
    ...packed.map((g) => Math.hypot(g.width, g.height) / 2 + BRAIN_GRAPH_NODE_WIDTH),
    BRAIN_GRAPH_NODE_WIDTH,
  );
  const radius =
    packed.length <= 1
      ? 0
      : Math.max(COL_PITCH, (packed.length * (maxSpan * 2 + BRAIN_GRAPH_COL_GAP)) / (2 * Math.PI));
  packed.forEach((group, tIndex) => {
    const theta = packed.length === 1 ? 0 : -Math.PI / 2 + (2 * Math.PI * tIndex) / packed.length;
    const cx = Math.cos(theta) * radius;
    const cy = Math.sin(theta) * radius;
    group.members.forEach((n, i) => {
      const col = i % group.cols;
      const row = Math.floor(i / group.cols);
      pos.set(n.id, {
        x: cx - group.width / 2 + col * COL_PITCH,
        y: cy - group.height / 2 + row * ROW_PITCH,
      });
    });
  });
  return pos;
}

function layoutTree(nodes: BrainNode[], edges: BrainEdge[]): Map<string, BrainGraphPos> {
  const pos = new Map<string, BrainGraphPos>();
  if (!nodes.length) return pos;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = new Set(byId.keys());
  const outgoing = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) {
    outgoing.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    outgoing.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
  }
  for (const [id, list] of outgoing) {
    const unique = [...new Set(list)];
    unique.sort((a, b) => byName(byId.get(a)!, byId.get(b)!));
    outgoing.set(id, unique);
  }

  const roots: BrainNode[] = nodes.filter((n) => (indeg.get(n.id) || 0) === 0).sort(byName);
  if (!roots.length) {
    const fallback = [...nodes].sort(
      (a, b) =>
        (outgoing.get(b.id)?.length || 0) - (outgoing.get(a.id)?.length || 0) || byName(a, b),
    )[0]!;
    roots.push(fallback);
  }

  const inTree = new Set<string>();
  const treeKids = new Map<string, string[]>();
  for (const n of nodes) treeKids.set(n.id, []);
  const grow = (id: string) => {
    inTree.add(id);
    for (const kid of outgoing.get(id) ?? []) {
      if (inTree.has(kid)) continue;
      treeKids.get(id)!.push(kid);
      grow(kid);
    }
  };
  for (const root of roots) {
    if (!inTree.has(root.id)) grow(root.id);
  }
  for (const n of [...nodes].sort(byName)) {
    if (inTree.has(n.id)) continue;
    roots.push(n);
    grow(n.id);
  }

  let leaf = 0;
  const place = (id: string, depth: number) => {
    const kids = treeKids.get(id) ?? [];
    if (!kids.length) {
      pos.set(id, { x: leaf * COL_PITCH, y: depth * ROW_PITCH });
      leaf += 1;
      return;
    }
    const start = leaf;
    for (const kid of kids) place(kid, depth + 1);
    pos.set(id, { x: ((start + leaf - 1) / 2) * COL_PITCH, y: depth * ROW_PITCH });
  };
  for (const root of roots) {
    if (!pos.has(root.id)) place(root.id, 0);
  }
  return pos;
}

function separateNodes(pos: Map<string, BrainGraphPos>, nodes: BrainNode[]): void {
  const minX = BRAIN_GRAPH_NODE_WIDTH + 24;
  const minY = BRAIN_GRAPH_NODE_HEIGHT + 16;
  for (let pass = 0; pass < 8; pass += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = pos.get(nodes[i]!.id)!;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = pos.get(nodes[j]!.id)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = minX - Math.abs(dx);
        const overlapY = minY - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (overlapX < overlapY) {
          const push = overlapX / 2;
          const sign = dx < 0 ? -1 : 1;
          a.x -= sign * push;
          b.x += sign * push;
        } else {
          const push = overlapY / 2;
          const sign = dy < 0 ? -1 : 1;
          a.y -= sign * push;
          b.y += sign * push;
        }
      }
    }
  }
}

function layoutForce(nodes: BrainNode[], edges: BrainEdge[]): Map<string, BrainGraphPos> {
  const pos = new Map<string, BrainGraphPos>();
  const ordered = [...nodes].sort(byLayerThenName);
  if (ordered.length <= 1) {
    if (ordered[0]) pos.set(ordered[0].id, { x: 0, y: 0 });
    return pos;
  }

  const n = ordered.length;
  const k = COL_PITCH;
  placeRing(ordered, ringRadius(n, 1), pos);

  const ids = new Set(ordered.map((node) => node.id));
  const links: [string, string][] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const a = e.from < e.to ? e.from : e.to;
    const b = e.from < e.to ? e.to : e.from;
    const key = `${a}|${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push([a, b]);
  }

  const disp = new Map<string, BrainGraphPos>();
  let temp = k;
  const iters = Math.min(FORCE_ITERS, 24 + n);
  for (let iter = 0; iter < iters; iter += 1) {
    for (const node of ordered) disp.set(node.id, { x: 0, y: 0 });
    for (let i = 0; i < n; i += 1) {
      const a = ordered[i]!;
      const pa = pos.get(a.id)!;
      for (let j = i + 1; j < n; j += 1) {
        const b = ordered[j]!;
        const pb = pos.get(b.id)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          dx = ((i % 2) * 2 - 1) * 0.01;
          dy = ((j % 2) * 2 - 1) * 0.01;
          dist = Math.hypot(dx, dy);
        }
        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const da = disp.get(a.id)!;
        const db = disp.get(b.id)!;
        da.x += fx;
        da.y += fy;
        db.x -= fx;
        db.y -= fy;
      }
    }
    for (const [src, dst] of links) {
      const pa = pos.get(src)!;
      const pb = pos.get(dst)!;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const da = disp.get(src)!;
      const db = disp.get(dst)!;
      da.x -= fx;
      da.y -= fy;
      db.x += fx;
      db.y += fy;
    }
    for (const node of ordered) {
      const p = pos.get(node.id)!;
      const d = disp.get(node.id)!;
      const mag = Math.hypot(d.x, d.y) || 0.01;
      const limited = Math.min(mag, temp);
      p.x += (d.x / mag) * limited;
      p.y += (d.y / mag) * limited;
    }
    temp *= 0.9;
  }
  separateNodes(pos, ordered);
  return pos;
}
