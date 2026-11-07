import {
  LOAD_PATH_LAYERS,
  buildLoadPath,
  extractPatchSymbols,
  type LoadPathHop,
  type LoadPathLayer,
  type LoadPathReview,
} from "./loadpath.js";
import type { PullComment, PullFile } from "./models/repo.js";
import {
  hunkHeader,
  parseFilePatch,
  parseUnifiedDiff,
  type PatchFile,
  type PatchHunk,
} from "./patch.js";

export const MAX_CHANGE_STACK_COHORTS = 6;
export const CHANGE_STACK_SOURCES = ["heuristic", "heuristic+model"] as const;
export type ChangeStackSource = (typeof CHANGE_STACK_SOURCES)[number];
export const CHANGE_STACK_DIAGRAM_KINDS = ["sequence", "state", "erd"] as const;
export type ChangeStackDiagramKind = (typeof CHANGE_STACK_DIAGRAM_KINDS)[number];
export const CHANGE_STACK_HEAD_SHA_RE = /^[0-9a-f]{7,64}$/i;

export interface ChangeRange {
  path: string;
  startLine: number;
  endLine: number;
  side: "LEFT" | "RIGHT";
  header: string;
  summary: string;
}

export interface ChangeLayerDiagram {
  kind: ChangeStackDiagramKind;
  mermaid: string;
}

export interface ChangeLayer {
  id: string;
  title: string;
  intent: string;
  fileCount: number;
  commentCount: number;
  ranges: ChangeRange[];
  diagram?: ChangeLayerDiagram;
}

export interface ChangeStackRevision {
  headSha: string;
  generatedAt: string;
  source: ChangeStackSource;
  current?: boolean;
}

export interface ChangeCohort {
  id: string;
  title: string;
  summary: string;
  layers: ChangeLayer[];
}

export interface ChangeStackFile {
  path: string;
  cohortId: string;
  layerId: string;
}

export interface ChangeStack {
  repoId: string;
  number: number;
  headSha: string;
  generatedAt: string;
  source: ChangeStackSource;
  cohorts: ChangeCohort[];
  files: ChangeStackFile[];
  markdown: string;
}

export interface ChangeStackMeta {
  repoId: string;
  number: number;
  headSha: string;
  generatedAt?: string;
  comments?: PullComment[];
}

const LAYER_TITLE: Record<LoadPathLayer, string> = {
  permissions: "Permissions",
  api: "API",
  schema: "Schema",
  jobs: "Jobs",
  ui: "UI",
  code: "Code",
  tests: "Tests",
};

const LAYER_INTENT: Record<LoadPathLayer, string> = {
  permissions: "auth",
  api: "contract",
  schema: "contract",
  jobs: "jobs",
  ui: "consumer",
  code: "consumer",
  tests: "tests",
};

const LAYER_RANK: Record<LoadPathLayer, number> = Object.fromEntries(
  LOAD_PATH_LAYERS.map((layer, index) => [layer, index]),
) as Record<LoadPathLayer, number>;

export function isChangeStackSource(value: unknown): value is ChangeStackSource {
  return value === "heuristic" || value === "heuristic+model";
}

export function isChangeStackDiagramKind(value: unknown): value is ChangeStackDiagramKind {
  return value === "sequence" || value === "state" || value === "erd";
}

export function looksLikeMermaid(text: string): boolean {
  return /^\s*(sequenceDiagram|stateDiagram(?:-v2)?|erDiagram|flowchart(?:\s+\w+)?|classDiagram)\b/m.test(
    text,
  );
}

export function safeChangeStackHeadSha(value: string): string | undefined {
  const sha = value.trim();
  if (!CHANGE_STACK_HEAD_SHA_RE.test(sha)) return undefined;
  return sha.toLowerCase();
}

export function emptyChangeStack(meta: ChangeStackMeta): ChangeStack {
  const stack: ChangeStack = {
    repoId: meta.repoId,
    number: meta.number,
    headSha: meta.headSha,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    source: "heuristic",
    cohorts: [],
    files: [],
    markdown: "",
  };
  stack.markdown = formatChangeStackMarkdown(stack);
  return stack;
}

export function buildChangeStack(
  files: Array<Pick<PullFile, "path" | "status" | "patch">>,
  loadPath: LoadPathReview,
  meta: ChangeStackMeta,
): ChangeStack {
  const byPath = new Map(files.map((file) => [file.path.replace(/\\/g, "/"), file] as const));
  const nodes = loadPath.nodes.filter((node) => byPath.has(node.path));
  if (!nodes.length) return emptyChangeStack(meta);

  const layerOf = new Map(nodes.map((node) => [node.path, node.layer] as const));
  const components = connectedComponents(
    nodes.map((node) => node.path),
    loadPath.hops,
  );
  const cohorts: ChangeCohort[] = [];
  const index: ChangeStackFile[] = [];
  const comments = meta.comments ?? [];

  components.forEach((paths, cohortIndex) => {
    const cohortId = `c${cohortIndex + 1}`;
    const layers: ChangeLayer[] = [];
    const grouped = new Map<LoadPathLayer, string[]>();
    for (const path of paths) {
      const layer = layerOf.get(path) ?? "code";
      const list = grouped.get(layer) ?? [];
      list.push(path);
      grouped.set(layer, list);
    }
    const layerKinds = LOAD_PATH_LAYERS.filter((layer) => grouped.has(layer));
    layerKinds.forEach((kind, layerIndex) => {
      const layerPaths = grouped.get(kind) ?? [];
      const ranges: ChangeRange[] = [];
      for (const path of layerPaths) {
        const file = byPath.get(path);
        if (!file) continue;
        ranges.push(...rangesForFile(file, comments));
      }
      const layerId = `${cohortId}-l${layerIndex + 1}`;
      const uniquePaths = unique(ranges.map((range) => range.path));
      const layer: ChangeLayer = {
        id: layerId,
        title: LAYER_TITLE[kind],
        intent: LAYER_INTENT[kind],
        fileCount: uniquePaths.length || layerPaths.length,
        commentCount: commentCountForRanges(ranges, comments),
        ranges,
      };
      const diagram = diagramForLayer(kind, layerPaths, loadPath, byPath);
      if (diagram) layer.diagram = diagram;
      layers.push(layer);
      for (const path of uniquePaths.length ? uniquePaths : layerPaths) {
        index.push({ path, cohortId, layerId });
      }
    });
    const fileCount = unique(paths).length;
    const titles = layerKinds.map((layer) => LAYER_TITLE[layer]);
    cohorts.push({
      id: cohortId,
      title: cohortTitle(titles, fileCount),
      summary: cohortSummary(titles, fileCount, loadPath, cohortIndex === 0),
      layers,
    });
  });

  const stack: ChangeStack = {
    repoId: meta.repoId,
    number: meta.number,
    headSha: meta.headSha,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    source: "heuristic",
    cohorts,
    files: index,
    markdown: "",
  };
  stack.markdown = formatChangeStackMarkdown(stack);
  return stack;
}

export function formatChangeStackMarkdown(stack: ChangeStack): string {
  const lines = ["## Change stack"];
  if (!stack.cohorts.length) {
    lines.push("", "No reviewable ranges in this diff.");
    return lines.join("\n");
  }
  for (const [index, cohort] of stack.cohorts.entries()) {
    lines.push("", `### Cohort ${index + 1}: ${cohort.title}`, cohort.summary);
    for (const [layerIndex, layer] of cohort.layers.entries()) {
      lines.push(
        "",
        `- Layer ${layerIndex + 1} · ${layer.title} (${layer.fileCount} file${
          layer.fileCount === 1 ? "" : "s"
        })`,
      );
      if (layer.diagram?.mermaid) {
        lines.push("", "```mermaid", layer.diagram.mermaid.trim(), "```");
      }
      for (const range of layer.ranges.slice(0, 12)) {
        lines.push(
          `  - \`${range.path}\` ${range.side === "LEFT" ? "L" : ""}${range.startLine}–${range.endLine}: ${range.summary}`,
        );
      }
    }
  }
  return lines.join("\n");
}

export function parseChangeStack(raw: unknown): ChangeStack | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const repoId = typeof value.repoId === "string" ? value.repoId : "";
  const number =
    typeof value.number === "number" && Number.isInteger(value.number) ? value.number : 0;
  const headSha = typeof value.headSha === "string" ? value.headSha : "";
  const generatedAt = typeof value.generatedAt === "string" ? value.generatedAt : "";
  const source = isChangeStackSource(value.source) ? value.source : "heuristic";
  if (!repoId || number <= 0 || !generatedAt) return undefined;
  const cohorts = Array.isArray(value.cohorts)
    ? value.cohorts.map(parseCohort).filter((row): row is ChangeCohort => Boolean(row))
    : [];
  const files = Array.isArray(value.files)
    ? value.files.map(parseStackFile).filter((row): row is ChangeStackFile => Boolean(row))
    : [];
  const markdown = typeof value.markdown === "string" ? value.markdown : "";
  const stack: ChangeStack = {
    repoId,
    number,
    headSha,
    generatedAt,
    source,
    cohorts,
    files,
    markdown,
  };
  if (!stack.markdown) stack.markdown = formatChangeStackMarkdown(stack);
  return stack;
}

export function formatPatchFile(file: PatchFile): string {
  return file.hunks
    .map((hunk) => {
      const body = hunk.rows
        .map((row) => `${row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}${row.text}`)
        .join("\n");
      return `${hunkHeader(hunk)}\n${body}`;
    })
    .join("\n");
}

export function pullFilesFromUnifiedDiff(patch: string): PullFile[] {
  return parseUnifiedDiff(patch).map((file) => ({
    path: file.path,
    status: file.kind === "add" ? "added" : file.kind === "delete" ? "removed" : "modified",
    patch: formatPatchFile(file),
  }));
}

export function buildChangeStackFromPatch(patch: string, meta: ChangeStackMeta): ChangeStack {
  const files = pullFilesFromUnifiedDiff(patch);
  if (!files.length) return emptyChangeStack(meta);
  return buildChangeStack(files, buildLoadPath(files), meta);
}

export type ChangeStackSummaryPatch = {
  cohorts?: Array<{
    id: string;
    title?: string;
    summary?: string;
    layers?: Array<{
      id: string;
      title?: string;
      intent?: string;
      diagram?: { kind?: string; mermaid?: string };
      ranges?: Array<{ path?: string; startLine?: number; summary?: string }>;
    }>;
  }>;
};

export function formatChangeStackSummaryPrompt(
  stack: ChangeStack,
  files: Array<Pick<PullFile, "path" | "patch">>,
): string {
  const byPath = new Map(files.map((file) => [file.path.replace(/\\/g, "/"), file] as const));
  const skeleton = {
    cohorts: stack.cohorts.map((cohort) => ({
      id: cohort.id,
      title: cohort.title,
      summary: cohort.summary,
      layers: cohort.layers.map((layer) => ({
        id: layer.id,
        title: layer.title,
        intent: layer.intent,
        diagram: layer.diagram,
        ranges: layer.ranges.map((range) => ({
          path: range.path,
          startLine: range.startLine,
          endLine: range.endLine,
          summary: range.summary,
        })),
      })),
    })),
  };
  const clips: string[] = [];
  let n = 0;
  for (const cohort of stack.cohorts) {
    for (const layer of cohort.layers) {
      for (const range of layer.ranges) {
        if (n >= 10) break;
        const patch = byPath.get(range.path)?.patch;
        if (!patch) continue;
        clips.push(`### ${range.path} ${range.header}\n${clipPatch(patch, 24)}`);
        n += 1;
      }
    }
  }
  return [
    "Rewrite this Change Stack for a code reviewer.",
    "Return JSON only, using the same cohort and layer ids.",
    "Keep each summary to one or two sentences.",
    "Optionally set layer.diagram to { kind: sequence|state|erd, mermaid } when the layer is a new call flow, lifecycle, or data model.",
    "",
    JSON.stringify(skeleton, null, 2),
    "",
    "## Diff clips",
    clips.join("\n\n") || "(no textual diffs)",
  ].join("\n");
}

export function parseChangeStackSummaryResponse(text: string): ChangeStackSummaryPatch | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const cohorts = (parsed as { cohorts?: unknown }).cohorts;
    if (!Array.isArray(cohorts)) return undefined;
    return { cohorts: cohorts as ChangeStackSummaryPatch["cohorts"] };
  } catch {
    return undefined;
  }
}

export function applyChangeStackSummaries(
  stack: ChangeStack,
  patch: ChangeStackSummaryPatch | undefined,
): ChangeStack {
  if (!patch?.cohorts?.length) return stack;
  let changed = false;
  const cohorts = stack.cohorts.map((cohort) => {
    const next = patch.cohorts?.find((row) => row.id === cohort.id);
    if (!next) return cohort;
    let title = cohort.title;
    let summary = cohort.summary;
    if (typeof next.title === "string" && next.title.trim() && next.title.trim() !== title) {
      title = next.title.trim();
      changed = true;
    }
    if (
      typeof next.summary === "string" &&
      next.summary.trim() &&
      next.summary.trim() !== summary
    ) {
      summary = next.summary.trim();
      changed = true;
    }
    const layers = cohort.layers.map((layer) => {
      const layerPatch = next.layers?.find((row) => row.id === layer.id);
      if (!layerPatch) return layer;
      let layerTitle = layer.title;
      let intent = layer.intent;
      let diagram = layer.diagram;
      if (
        typeof layerPatch.title === "string" &&
        layerPatch.title.trim() &&
        layerPatch.title.trim() !== layerTitle
      ) {
        layerTitle = layerPatch.title.trim();
        changed = true;
      }
      if (
        typeof layerPatch.intent === "string" &&
        layerPatch.intent.trim() &&
        layerPatch.intent.trim() !== intent
      ) {
        intent = layerPatch.intent.trim();
        changed = true;
      }
      const mermaid =
        typeof layerPatch.diagram?.mermaid === "string" ? layerPatch.diagram.mermaid.trim() : "";
      if (mermaid && looksLikeMermaid(mermaid)) {
        const kind = isChangeStackDiagramKind(layerPatch.diagram?.kind)
          ? layerPatch.diagram.kind
          : mermaidKind(mermaid);
        if (kind && (diagram?.mermaid !== mermaid || diagram.kind !== kind)) {
          diagram = { kind, mermaid };
          changed = true;
        }
      }
      const ranges = layer.ranges.map((range) => {
        const rangePatch = layerPatch.ranges?.find(
          (row) => row.path === range.path && row.startLine === range.startLine,
        );
        const text = typeof rangePatch?.summary === "string" ? rangePatch.summary.trim() : "";
        if (text && text !== range.summary) {
          changed = true;
          return { ...range, summary: text };
        }
        return range;
      });
      return { ...layer, title: layerTitle, intent, diagram, ranges };
    });
    return { ...cohort, title, summary, layers };
  });
  if (!changed) return stack;
  const next: ChangeStack = {
    ...stack,
    source: "heuristic+model",
    cohorts,
    markdown: "",
  };
  next.markdown = formatChangeStackMarkdown(next);
  return next;
}

function mermaidKind(text: string): ChangeStackDiagramKind | undefined {
  if (/^\s*sequenceDiagram\b/m.test(text)) return "sequence";
  if (/^\s*stateDiagram(?:-v2)?\b/m.test(text)) return "state";
  if (/^\s*erDiagram\b/m.test(text)) return "erd";
  return undefined;
}

function clipPatch(patch: string, maxLines: number): string {
  const lines = patch.replace(/\r\n/g, "\n").split("\n").slice(0, maxLines);
  return lines.map((line) => (line.length > 160 ? `${line.slice(0, 157)}...` : line)).join("\n");
}

export function patchFilesForLayer(files: PatchFile[], layer: ChangeLayer): PatchFile[] {
  const byPath = new Map(files.map((file) => [file.path, file] as const));
  const order: string[] = [];
  for (const range of layer.ranges) {
    if (!order.includes(range.path)) order.push(range.path);
  }
  const out: PatchFile[] = [];
  for (const path of order) {
    const file = byPath.get(path);
    if (!file) continue;
    const starts = new Set(
      layer.ranges.filter((range) => range.path === path).map((range) => range.startLine),
    );
    const hunks = file.hunks.filter(
      (hunk) => starts.has(hunk.newStart) || starts.has(hunk.oldStart),
    );
    out.push({ ...file, hunks: hunks.length ? hunks : file.hunks });
  }
  return out;
}

export function layerForPath(
  stack: ChangeStack,
  path: string,
): { cohortId: string; layerId: string } | undefined {
  return stack.files.find((file) => file.path === path);
}

function parseCohort(raw: unknown): ChangeCohort | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  const title = typeof value.title === "string" ? value.title : "";
  if (!id || !title) return undefined;
  const layers = Array.isArray(value.layers)
    ? value.layers.map(parseLayer).filter((row): row is ChangeLayer => Boolean(row))
    : [];
  return {
    id,
    title,
    summary: typeof value.summary === "string" ? value.summary : "",
    layers,
  };
}

function parseLayer(raw: unknown): ChangeLayer | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  const title = typeof value.title === "string" ? value.title : "";
  if (!id || !title) return undefined;
  const ranges = Array.isArray(value.ranges)
    ? value.ranges.map(parseRange).filter((row): row is ChangeRange => Boolean(row))
    : [];
  const fileCount =
    typeof value.fileCount === "number" && Number.isInteger(value.fileCount)
      ? value.fileCount
      : unique(ranges.map((range) => range.path)).length;
  const commentCount =
    typeof value.commentCount === "number" && Number.isInteger(value.commentCount)
      ? value.commentCount
      : 0;
  const layer: ChangeLayer = {
    id,
    title,
    intent: typeof value.intent === "string" ? value.intent : "",
    fileCount,
    commentCount,
    ranges,
  };
  const diagram = parseDiagram(value.diagram);
  if (diagram) layer.diagram = diagram;
  return layer;
}

function parseDiagram(raw: unknown): ChangeLayerDiagram | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const mermaid = typeof value.mermaid === "string" ? value.mermaid.trim() : "";
  if (!mermaid || !looksLikeMermaid(mermaid)) return undefined;
  const kind = isChangeStackDiagramKind(value.kind) ? value.kind : mermaidKind(mermaid);
  if (!kind) return undefined;
  return { kind, mermaid };
}

function parseRange(raw: unknown): ChangeRange | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const path = typeof value.path === "string" ? value.path : "";
  const startLine =
    typeof value.startLine === "number" && Number.isInteger(value.startLine) ? value.startLine : 0;
  const endLine =
    typeof value.endLine === "number" && Number.isInteger(value.endLine)
      ? value.endLine
      : startLine;
  if (!path || startLine <= 0) return undefined;
  return {
    path,
    startLine,
    endLine: Math.max(startLine, endLine),
    side: value.side === "LEFT" ? "LEFT" : "RIGHT",
    header: typeof value.header === "string" ? value.header : "",
    summary: typeof value.summary === "string" ? value.summary : "",
  };
}

function parseStackFile(raw: unknown): ChangeStackFile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const path = typeof value.path === "string" ? value.path : "";
  const cohortId = typeof value.cohortId === "string" ? value.cohortId : "";
  const layerId = typeof value.layerId === "string" ? value.layerId : "";
  if (!path || !cohortId || !layerId) return undefined;
  return { path, cohortId, layerId };
}

function connectedComponents(paths: string[], hops: LoadPathHop[]): string[][] {
  const uf = new UnionFind(paths);
  for (const hop of hops) {
    if (uf.has(hop.from) && uf.has(hop.to)) uf.union(hop.from, hop.to);
  }
  joinNearest(uf, paths, (a, b) => sameStem(a, b));
  joinNearest(uf, paths, (a, b) => dirname(a) === dirname(b) && dirname(a) !== "");
  const groups = uf.groups();
  groups.sort(compareComponents);
  return capComponents(groups);
}

function joinNearest(
  uf: UnionFind,
  paths: string[],
  related: (a: string, b: string) => boolean,
): void {
  for (const path of paths) {
    if (uf.size(path) > 1) continue;
    let best: string | undefined;
    let bestSize = 0;
    for (const other of paths) {
      if (other === path || !related(path, other)) continue;
      const size = uf.size(other);
      if (size > bestSize || (size === bestSize && other < (best ?? "\uffff"))) {
        best = other;
        bestSize = size;
      }
    }
    if (best) uf.union(path, best);
  }
}

function capComponents(groups: string[][]): string[][] {
  if (groups.length <= MAX_CHANGE_STACK_COHORTS) return groups;
  const kept = groups.slice(0, MAX_CHANGE_STACK_COHORTS - 1);
  const rest = groups.slice(MAX_CHANGE_STACK_COHORTS - 1).flat();
  rest.sort((a, b) => a.localeCompare(b));
  kept.push(rest);
  return kept;
}

function compareComponents(a: string[], b: string[]): number {
  const rank = (paths: string[]) =>
    Math.min(...paths.map((path) => LAYER_RANK[layerHint(path)] ?? LAYER_RANK.code));
  return rank(a) - rank(b) || a[0]!.localeCompare(b[0]!);
}

function layerHint(path: string): LoadPathLayer {
  const file = path.replace(/\\/g, "/");
  if (/(^|\/)(tests?|__tests__|spec)(\/|$)/i.test(file) || /\.(test|spec)\.[^.]+$/i.test(file))
    return "tests";
  if (/(^|\/)migrations?(\/|$)/i.test(file)) return "schema";
  if (/(^|\/)(auth|permissions?)(\/|$)/i.test(file)) return "permissions";
  if (/(^|\/)(routes?|controllers?|serializers?|api)(\/|$)/i.test(file)) return "api";
  if (/\.(tsx|jsx|vue|svelte|css|html)$/i.test(file)) return "ui";
  return "code";
}

function rangesForFile(
  file: Pick<PullFile, "path" | "status" | "patch">,
  comments: PullComment[],
): ChangeRange[] {
  const path = file.path.replace(/\\/g, "/");
  const kind = file.status === "added" ? "add" : file.status === "removed" ? "delete" : "update";
  const parsed = parseFilePatch(path, file.patch, kind);
  const symbols = extractPatchSymbols(path, file.patch);
  if (!parsed.hunks.length) {
    const side = kind === "delete" ? "LEFT" : "RIGHT";
    return [
      {
        path,
        startLine: 1,
        endLine: 1,
        side,
        header: "",
        summary: kind === "delete" ? `Delete ${basename(path)}` : `Update ${basename(path)}`,
      },
    ];
  }
  return parsed.hunks.map((hunk) => rangeFromHunk(path, kind, hunk, symbols, comments));
}

function rangeFromHunk(
  path: string,
  kind: PatchFile["kind"],
  hunk: PatchHunk,
  symbols: string[],
  _comments: PullComment[],
): ChangeRange {
  const side: "LEFT" | "RIGHT" = kind === "delete" ? "LEFT" : "RIGHT";
  const startLine = Math.max(1, side === "LEFT" ? hunk.oldStart : hunk.newStart);
  const count = side === "LEFT" ? hunk.oldLines.length : hunk.newLines.length;
  return {
    path,
    startLine,
    endLine: Math.max(startLine, startLine + Math.max(count, 1) - 1),
    side,
    header: hunkHeader(hunk),
    summary: rangeSummary(path, hunk, symbols, kind),
  };
}

function rangeSummary(
  path: string,
  hunk: PatchHunk,
  symbols: string[],
  kind: PatchFile["kind"],
): string {
  const added = hunk.rows
    .filter((row) => row.kind === "add")
    .map((row) => row.text.trim())
    .filter(Boolean);
  const removed = hunk.rows
    .filter((row) => row.kind === "del")
    .map((row) => row.text.trim())
    .filter(Boolean);
  const base = basename(path);
  const symbol = symbols[0];
  if (kind === "delete") return `Delete ${base}`;
  if (kind === "add" && symbol) return `Add ${symbol} in ${base}`;
  if (symbol && added.length) return `Update ${symbol} in ${base}`;
  if (added[0] && added[0].length <= 72) return added[0];
  if (removed.length && !added.length) return `Remove code in ${base}`;
  return `Update ${base}`;
}

function diagramForLayer(
  kind: LoadPathLayer,
  paths: string[],
  loadPath: LoadPathReview,
  files: Map<string, Pick<PullFile, "path" | "status" | "patch">>,
): ChangeLayerDiagram | undefined {
  if (kind === "tests") return undefined;
  const state = stateDiagramForLayer(paths, files);
  if (state) return state;
  const hops = loadPath.hops.filter((hop) => paths.includes(hop.from) || paths.includes(hop.to));
  if (kind === "schema") {
    return erDiagramForLayer(paths, loadPath, hops);
  }
  if (kind === "api" || kind === "jobs" || kind === "permissions" || hops.length) {
    return sequenceDiagramForLayer(hops);
  }
  return undefined;
}

function sequenceDiagramForLayer(hops: LoadPathHop[]): ChangeLayerDiagram | undefined {
  const used = hops.slice(0, 12);
  const ids = unique(used.flatMap((hop) => [mermaidIdent(hop.from), mermaidIdent(hop.to)]));
  if (ids.length < 2 || !used.length) return undefined;
  const lines = ["sequenceDiagram"];
  for (const hop of used) {
    const from = mermaidIdent(hop.from);
    const to = mermaidIdent(hop.to);
    if (from === to) continue;
    lines.push(`  ${from}->>${to}: ${hop.via}`);
  }
  if (lines.length < 2) return undefined;
  return { kind: "sequence", mermaid: lines.join("\n") };
}

function erDiagramForLayer(
  paths: string[],
  loadPath: LoadPathReview,
  hops: LoadPathHop[],
): ChangeLayerDiagram | undefined {
  const nodes = loadPath.nodes.filter((node) => paths.includes(node.path));
  const symbols = unique(nodes.flatMap((node) => node.symbols)).filter((name) =>
    /^[A-Z][A-Za-z0-9]+$/.test(name),
  );
  const lines = ["erDiagram"];
  if (symbols.length >= 2) {
    for (const name of symbols.slice(0, 8)) lines.push(`  ${name}`);
  }
  let edges = 0;
  for (const hop of hops.slice(0, 8)) {
    const from = mermaidIdent(hop.from);
    const to = mermaidIdent(hop.to);
    if (from === to) continue;
    lines.push(`  ${from} ||--o{ ${to} : ${hop.via}`);
    edges += 1;
  }
  if (symbols.length < 2 && edges < 1) return undefined;
  return { kind: "erd", mermaid: lines.join("\n") };
}

function stateDiagramForLayer(
  paths: string[],
  files: Map<string, Pick<PullFile, "path" | "status" | "patch">>,
): ChangeLayerDiagram | undefined {
  const skip = new Set(["true", "false", "null", "none", "undefined", "id", "name", "type"]);
  const names: string[] = [];
  let hinted = false;
  for (const path of paths) {
    const patch = files.get(path)?.patch ?? "";
    if (/status|state|lifecycle|phase/i.test(path) || /status|state|lifecycle|phase/i.test(patch)) {
      hinted = true;
    }
    for (const match of patch.matchAll(/['"]([A-Za-z][\w-]{2,24})['"]/g)) {
      const token = match[1]!;
      if (skip.has(token.toLowerCase()) || names.includes(token)) continue;
      names.push(token);
    }
  }
  if (!hinted || names.length < 2) return undefined;
  const states = names.slice(0, 8).map(mermaidIdent);
  const lines = ["stateDiagram-v2", `  [*] --> ${states[0]}`];
  for (let i = 0; i < states.length - 1; i += 1) {
    lines.push(`  ${states[i]} --> ${states[i + 1]}`);
  }
  return { kind: "state", mermaid: lines.join("\n") };
}

function mermaidIdent(path: string): string {
  let id = basename(path)
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_]/g, "_");
  if (!id) id = "n";
  if (!/^[A-Za-z]/.test(id)) id = `n_${id}`;
  return id.slice(0, 40);
}

function commentCountForRanges(ranges: ChangeRange[], comments: PullComment[]): number {
  if (!comments.length) return 0;
  let count = 0;
  for (const comment of comments) {
    if (!comment.path) continue;
    if (
      ranges.some(
        (range) =>
          range.path === comment.path &&
          (!comment.line || (comment.line >= range.startLine && comment.line <= range.endLine)),
      )
    ) {
      count += 1;
    }
  }
  return count;
}

function cohortTitle(layers: string[], fileCount: number): string {
  const head = layers.length ? layers.join(" + ") : "Change";
  return `${head} (${fileCount} file${fileCount === 1 ? "" : "s"})`;
}

function cohortSummary(
  layers: string[],
  fileCount: number,
  loadPath: LoadPathReview,
  primary: boolean,
): string {
  if (primary && loadPath.headline) return loadPath.headline;
  return `${fileCount} file${fileCount === 1 ? "" : "s"} · ${layers.join(", ") || "code"}`;
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

function stem(path: string): string {
  return basename(path)
    .replace(/\.[^.]+$/, "")
    .replace(/\.(test|spec)$/i, "")
    .replace(/^test_/, "")
    .replace(/_test$/, "")
    .replace(/(Page|Form|View|Serializer|Service|Task|Hook|Api|API|Client)$/i, "")
    .toLowerCase();
}

function sameStem(a: string, b: string): boolean {
  const left = stem(a);
  const right = stem(b);
  return Boolean(left) && left === right;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  constructor(paths: string[]) {
    for (const path of paths) this.parent.set(path, path);
  }

  has(path: string): boolean {
    return this.parent.has(path);
  }

  find(path: string): string {
    let cur = path;
    while (this.parent.get(cur) !== cur) {
      const next = this.parent.get(cur) ?? cur;
      this.parent.set(cur, this.parent.get(next) ?? next);
      cur = next;
    }
    return cur;
  }

  union(a: string, b: string): void {
    const left = this.find(a);
    const right = this.find(b);
    if (left === right) return;
    const root = left < right ? left : right;
    const other = root === left ? right : left;
    this.parent.set(other, root);
  }

  size(path: string): number {
    const root = this.find(path);
    let n = 0;
    for (const key of this.parent.keys()) {
      if (this.find(key) === root) n += 1;
    }
    return n;
  }

  groups(): string[][] {
    const byRoot = new Map<string, string[]>();
    for (const path of this.parent.keys()) {
      const root = this.find(path);
      const list = byRoot.get(root) ?? [];
      list.push(path);
      byRoot.set(root, list);
    }
    return [...byRoot.values()].map((group) => {
      group.sort((a, b) => a.localeCompare(b));
      return group;
    });
  }
}
