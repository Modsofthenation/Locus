import { formatPullComments, type PullComment, type PullFile } from "./models/repo.js";
import { extractSymbols } from "./repoMap.js";
import { wrapUntrusted } from "./untrusted.js";

export const MAX_LOAD_PATH_NOTES = 4000;
export const LOAD_PATH_TRACE_LIMIT = 12;
export const LOAD_PATH_TRACE_HOP_LIMIT = 8;
export const LOAD_PATH_LAYERS = [
  "permissions",
  "api",
  "schema",
  "jobs",
  "ui",
  "code",
  "tests",
] as const;
export type LoadPathLayer = (typeof LOAD_PATH_LAYERS)[number];

export const LOAD_PATH_RISKS = ["high", "medium", "low"] as const;
export type LoadPathRisk = (typeof LOAD_PATH_RISKS)[number];

export const LOAD_PATH_HOPS = [
  "imports",
  "imported_by",
  "tested_by",
  "same_module",
  "mentions",
  "publishes",
  "enqueues",
  "auth",
] as const;
export type LoadPathHopKind = (typeof LOAD_PATH_HOPS)[number];

export interface LoadPathNode {
  path: string;
  layer: LoadPathLayer;
  kind: string;
  status?: PullFile["status"];
  symbols: string[];
  seed: boolean;
  sink: boolean;
  tested: boolean;
}

export interface LoadPathHop {
  from: string;
  to: string;
  via: LoadPathHopKind;
  confidence: "extracted" | "inferred";
}

export interface LoadPathTrace {
  seed: string;
  hops: Array<{ path: string; layer: LoadPathLayer; via: LoadPathHopKind }>;
  sinks: Array<{ path: string; layer: LoadPathLayer }>;
}

export interface LoadPathReview {
  risk: LoadPathRisk;
  reasons: string[];
  headline: string;
  changeKinds: string[];
  layers: LoadPathLayer[];
  nodes: LoadPathNode[];
  traces: LoadPathTrace[];
  hops: LoadPathHop[];
  untestedSinks: Array<{ path: string; layer: LoadPathLayer; kind: string }>;
  readOrder: Array<{ path: string; why: string }>;
  notes?: string;
  notesUpdatedAt?: string;
  markdown: string;
}

export interface LoadPathNotes {
  notes: string;
  updatedAt: string;
}

const GENERATED =
  /(^|\/)(node_modules|dist|__pycache__|\.venv|generated|vendor|coverage)(\/|$)|lock\.(json|ya?ml)$|\.min\.js$/i;

/** Change Stack / loadpath noise. Not Files listing skip — lockfiles stay visible there. */
export function isLoadPathNoisePath(path: string): boolean {
  return GENERATED.test(path.replace(/\\/g, "/"));
}
const TEST_DIR = /(^|\/)(tests?|__tests__|spec|e2e|cypress|playwright)(\/|$)/i;
const TEST_FILE = /\.(test|spec)\.[^.]+$/i;
const TEST_STEM = /(^|\/)test_[^/]+$|_test\.[^.]+$|(^|\/)tests?\.(py|ts|js|go)$/i;
const PERM_PATH = /(^|\/)(auth|permissions?|rbac|acl|iam|guards?|casl)(\/|$|\.)/i;
const JOB_PATH =
  /(^|\/)(tasks?|jobs?|workers?|queues?|celery|dramatiq|sidekiq|bullmq|cron)(\.[^.]+)?(\/|$)|management\/commands/i;
const SCHEMA_PATH =
  /(^|\/)migrations?(\/|$)|models\.(py|ts|js|go)$|schema\.(py|prisma|sql|graphql)|alembic/i;
const API_PATH =
  /(^|\/)(serializers?|views?|urls?|routes?|controllers?|handlers?|openapi|swagger|graphql)(\/|$|\.)|(^|\/)api(\/|$)/i;
const UI_EXT = /\.(tsx|jsx|vue|svelte|css|scss|less|html)$/i;
const UI_PATH =
  /(^|\/)(components?|pages?|templates?|frontend|client|ui)(\/|$)|(^|\/)app\/.+\/page\.[jt]sx?$/i;

const PERM_PATCH =
  /\b(permission_classes|IsAuthenticated|IsAdminUser|login_required|permission_required|has_perm|CanActivate|casl|rbac)\b/;
const JOB_PATCH =
  /\b(shared_task|apply_async|dramatiq|celery|delay\(|send_with_options|BullMQ|agenda\.|crontab)\b/;
const API_PATCH =
  /\b(api_view|APIView|ViewSet|serializer_class|FastAPI|APIRouter|@app\.(get|post|put|patch|delete)|router\.(get|post)|re_path|openapi|gql`)\b/;
const UI_PATCH =
  /\b(useQuery|useMutation|createSlice|fetch\(|axios\.|hx-(get|post)|react-router)\b/;

const IMPORT_RE =
  /(?:from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|from\s+([A-Za-z_][\w.]*)\s+import)/g;

const SINK_LAYERS = new Set<LoadPathLayer>(["permissions", "api", "jobs", "ui", "tests"]);
const LAYER_RANK: Record<LoadPathLayer, number> = {
  permissions: 0,
  api: 1,
  schema: 2,
  jobs: 3,
  ui: 4,
  code: 5,
  tests: 6,
};

export function isLoadPathLayer(value: unknown): value is LoadPathLayer {
  return typeof value === "string" && (LOAD_PATH_LAYERS as readonly string[]).includes(value);
}

export function isLoadPathRisk(value: unknown): value is LoadPathRisk {
  return value === "high" || value === "medium" || value === "low";
}

export function parseLoadPathNotes(raw: unknown): LoadPathNotes | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const notes = typeof value.notes === "string" ? clipLoadPathNotes(value.notes) : "";
  const updatedAt =
    typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt : "";
  if (!notes.trim() && !updatedAt) return undefined;
  return { notes, updatedAt: updatedAt || new Date().toISOString() };
}

export function shortLoadPath(path: string, allPaths: string[]): string {
  const file = path.replace(/\\/g, "/");
  const name = file.split("/").pop() || file;
  const nameHits = allPaths.filter((item) => basenameWithExt(item) === name);
  if (nameHits.length <= 1) return name;
  const parent = file.split("/").slice(-2).join("/");
  const parentHits = allPaths.filter(
    (item) =>
      item.replace(/\\/g, "/").endsWith(`/${parent}`) || item.replace(/\\/g, "/") === parent,
  );
  return parentHits.length <= 1 ? parent : file;
}

export function classifyLoadPathFile(
  path: string,
  patch?: string,
): { layer: LoadPathLayer; kind: string } {
  const file = path.replace(/\\/g, "/");
  const body = livePatchText(patch);
  if (TEST_DIR.test(file) || TEST_FILE.test(file) || TEST_STEM.test(file)) {
    return {
      layer: "tests",
      kind: file.includes("e2e") || file.includes("cypress") ? "e2e" : "unit",
    };
  }
  if (PERM_PATH.test(file) || PERM_PATCH.test(body)) return { layer: "permissions", kind: "auth" };
  if (JOB_PATH.test(file) || JOB_PATCH.test(body)) return { layer: "jobs", kind: "task" };
  if (SCHEMA_PATH.test(file)) {
    return { layer: "schema", kind: /migration/i.test(file) ? "migration" : "model" };
  }
  if (API_PATH.test(file) || API_PATCH.test(body)) {
    if (/serializer/i.test(file)) return { layer: "api", kind: "serializer" };
    if (/url|route/i.test(file)) return { layer: "api", kind: "route" };
    if (/graphql|gql/i.test(file)) return { layer: "api", kind: "graphql" };
    return { layer: "api", kind: "endpoint" };
  }
  if (UI_EXT.test(file) || UI_PATH.test(file) || UI_PATCH.test(body)) {
    if (/page|template/i.test(file)) return { layer: "ui", kind: "page" };
    return { layer: "ui", kind: "component" };
  }
  return { layer: "code", kind: "module" };
}

export function extractPatchImports(path: string, patch?: string): string[] {
  const text = livePatchText(patch);
  if (!text) return [];
  const found: string[] = [];
  for (const match of text.matchAll(IMPORT_RE)) {
    const raw = (match[1] || match[2] || match[3] || match[4] || "").trim();
    if (!raw || found.includes(raw)) continue;
    found.push(raw);
  }
  const dir = dirname(path);
  return found.map((item) => resolveImportHint(dir, item)).filter(Boolean);
}

export function extractPatchSymbols(path: string, patch?: string): string[] {
  return unique([
    ...extractSymbols(path, addedPatchText(patch)),
    ...extractSymbols(path, livePatchText(patch)),
  ]);
}

export function buildLoadPath(
  files: Array<Pick<PullFile, "path" | "status" | "patch">>,
  opts: { notes?: string; notesUpdatedAt?: string } = {},
): LoadPathReview {
  const usable = files.filter((file) => file.path && !isLoadPathNoisePath(file.path));
  const nodes: LoadPathNode[] = usable.map((file) => {
    const path = file.path.replace(/\\/g, "/");
    const classified = classifyLoadPathFile(path, file.patch);
    const symbols = extractPatchSymbols(path, file.patch);
    const sink = SINK_LAYERS.has(classified.layer) || classified.kind === "migration";
    return {
      path,
      layer: classified.layer,
      kind: classified.kind,
      status: file.status,
      symbols,
      seed: classified.layer !== "tests",
      sink,
      tested: false,
    };
  });

  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const hops: LoadPathHop[] = [];
  const pushHop = (
    from: string,
    to: string,
    via: LoadPathHopKind,
    confidence: LoadPathHop["confidence"],
  ) => {
    if (from === to) return;
    if (!byPath.has(from) || !byPath.has(to)) return;
    if (hops.some((hop) => hop.from === from && hop.to === to && hop.via === via)) return;
    hops.push({ from, to, via, confidence });
  };

  for (const file of usable) {
    const src = file.path.replace(/\\/g, "/");
    const imports = extractPatchImports(src, file.patch);
    for (const hint of imports) {
      const dest = matchImport(hint, [...byPath.keys()], src);
      if (!dest) continue;
      pushHop(src, dest, "imports", hintConfidence(hint));
      pushHop(dest, src, "imported_by", hintConfidence(hint));
    }
  }

  for (const node of nodes) {
    if (node.layer !== "tests") continue;
    for (const other of nodes) {
      if (other.path === node.path || other.layer === "tests") continue;
      if (
        coversAsTest(
          node.path,
          other.path,
          node.symbols,
          other.symbols,
          usable.find((f) => f.path === node.path)?.patch,
        )
      ) {
        pushHop(
          other.path,
          node.path,
          "tested_by",
          sameStem(node.path, other.path) ? "extracted" : "inferred",
        );
        other.tested = true;
      }
    }
  }

  for (const a of nodes) {
    for (const b of nodes) {
      if (a.path >= b.path) continue;
      if (dirname(a.path) !== dirname(b.path)) continue;
      if (a.layer === "tests" || b.layer === "tests") continue;
      if (relatedKinds(a, b) || sameStem(a.path, b.path)) {
        pushHop(a.path, b.path, "same_module", "inferred");
        pushHop(b.path, a.path, "same_module", "inferred");
      }
    }
  }

  for (const a of nodes) {
    if (!a.symbols.length) continue;
    for (const b of nodes) {
      if (a.path === b.path) continue;
      const patch = usable.find((file) => file.path === b.path)?.patch;
      const body = livePatchText(patch);
      if (!body) continue;
      const hit = a.symbols.some(
        (symbol) => symbol.length > 2 && new RegExp(`\\b${escapeReg(symbol)}\\b`).test(body),
      );
      if (!hit) continue;
      const via = mentionVia(a.layer, b.layer);
      pushHop(a.path, b.path, via, "inferred");
    }
  }

  for (const node of nodes) {
    node.tested = hops.some((hop) => hop.from === node.path && hop.via === "tested_by");
  }

  const traces = compactLoadPathTraces(nodes, hops);

  const layers = unique(nodes.map((node) => node.layer)).sort(
    (a, b) => LAYER_RANK[a] - LAYER_RANK[b],
  );
  const untestedSinks = nodes
    .filter((node) => node.sink && node.layer !== "tests" && !node.tested)
    .map((node) => ({ path: node.path, layer: node.layer, kind: node.kind }));
  const changeKinds = classifyChangeKinds(nodes);
  const { risk, reasons } = scoreRisk(nodes, untestedSinks, changeKinds);
  const readOrder = readOrderFiles(nodes);
  const notes = clipLoadPathNotes(opts.notes ?? "").trim() || undefined;
  const headline = buildHeadline(risk, changeKinds, untestedSinks.length, nodes);
  const review: LoadPathReview = {
    risk,
    reasons,
    headline,
    changeKinds,
    layers,
    nodes,
    traces,
    hops,
    untestedSinks,
    readOrder,
    notes,
    notesUpdatedAt: notes ? opts.notesUpdatedAt : undefined,
    markdown: "",
  };
  review.markdown = formatLoadPathMarkdown(review);
  return review;
}

export function formatLoadPathMarkdown(review: LoadPathReview): string {
  const lines = [
    `## Load path: ${review.risk.toUpperCase()}`,
    "",
    review.headline,
    "",
    "### What kind of change is this?",
    review.changeKinds.map((kind) => kind.replace(/_/g, " ")).join(", ") || "unknown",
    "",
    "### Layers",
    review.layers.join(", ") || "none",
    "",
    "### Read this first",
  ];
  for (const item of review.readOrder.slice(0, 16)) {
    lines.push(`- \`${item.path}\` — ${item.why}`);
  }
  if (!review.readOrder.length) lines.push("- (no files)");
  lines.push("", "### Traces");
  if (!review.traces.length) {
    lines.push("No cross-file traces from this diff. Treat each changed file as a leaf.");
  } else {
    for (const trace of review.traces.slice(0, LOAD_PATH_TRACE_LIMIT)) {
      const seed = review.nodes.find((node) => node.path === trace.seed);
      lines.push(`- \`${trace.seed}\`${seed ? ` (${seed.layer})` : ""}`);
      for (const hop of trace.hops) {
        lines.push(`  → \`${hop.path}\` (${hop.layer} / ${hop.via.replace(/_/g, " ")})`);
      }
    }
  }
  lines.push("", "### Confidence");
  for (const reason of review.reasons) lines.push(`- ${reason}`);
  if (review.untestedSinks.length) {
    lines.push("", "### Untested sinks");
    for (const sink of review.untestedSinks.slice(0, 12)) {
      lines.push(`- \`${sink.path}\` (${sink.layer} ${sink.kind})`);
    }
  }
  if (review.notes?.trim()) {
    lines.push(
      "",
      "### Operator notes",
      wrapUntrusted({
        kind: "operator-notes",
        source: "loadpath",
        text: clipLoadPathNotes(review.notes).trim(),
      }),
    );
  }
  if (review.risk === "low") {
    lines.push("", "_Fast-track: loadpath:low-risk. Human review can be a glance._");
  }
  return lines.join("\n");
}

function addedPatchText(patch?: string): string {
  return patchLines(patch, (line) => line.startsWith("+") && !line.startsWith("+++"));
}

function livePatchText(patch?: string): string {
  return patchLines(
    patch,
    (line) =>
      (line.startsWith("+") && !line.startsWith("+++")) ||
      (line.startsWith(" ") && !line.startsWith("+++")),
  );
}

function patchLines(patch: string | undefined, keep: (line: string) => boolean): string {
  if (!patch) return "";
  return patch
    .split(/\r?\n/)
    .filter(keep)
    .map((line) => line.slice(1))
    .join("\n");
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

function basenameWithExt(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

function basename(path: string): string {
  return basenameWithExt(path).replace(/\.[^.]+$/, "");
}

function stem(path: string): string {
  return basename(path)
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

function relatedKinds(a: LoadPathNode, b: LoadPathNode): boolean {
  const pair = new Set([a.kind, b.kind]);
  return (
    (pair.has("serializer") && (pair.has("endpoint") || pair.has("route"))) ||
    (pair.has("page") && (pair.has("endpoint") || pair.has("component"))) ||
    (pair.has("model") && (pair.has("serializer") || pair.has("task")))
  );
}

function coversAsTest(
  testPath: string,
  targetPath: string,
  testSymbols: string[],
  targetSymbols: string[],
  patch?: string,
): boolean {
  if (sameStem(testPath, targetPath)) return true;
  const imports = extractPatchImports(testPath, patch);
  const targetNoExt = targetPath.replace(/\.(py|ts|tsx|js|jsx)$/, "");
  if (
    imports.some(
      (hint) =>
        hint === targetNoExt ||
        targetNoExt.endsWith(`/${hint.replace(/\.(py|ts|tsx|js|jsx)$/, "")}`),
    )
  ) {
    return true;
  }
  const body = `${testPath}\n${livePatchText(patch)}`.toLowerCase();
  const targetBase = basename(targetPath).toLowerCase();
  if (targetBase.length > 3 && new RegExp(`\\b${escapeReg(targetBase)}\\b`).test(body)) return true;
  const targetStem = stem(targetPath);
  if (targetStem.length > 3 && new RegExp(`\\b${escapeReg(targetStem)}\\b`).test(body)) return true;
  return targetSymbols.some(
    (symbol) =>
      symbol.length > 2 &&
      (testSymbols.includes(symbol) || new RegExp(`\\b${escapeReg(symbol)}\\b`, "i").test(body)),
  );
}

function resolveImportHint(dir: string, spec: string): string {
  if (spec.startsWith(".")) {
    const parts = [...(dir ? dir.split("/") : []), ...spec.split("/")];
    const out: string[] = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    return out.join("/");
  }
  return spec.replace(/\./g, "/");
}

function matchImport(hint: string, paths: string[], from: string): string | undefined {
  const clean = hint.replace(/\.(py|ts|tsx|js|jsx)$/, "");
  const exact = paths.find((path) => {
    const noExt = path.replace(/\.(py|ts|tsx|js|jsx)$/, "");
    return noExt === clean || noExt.endsWith(`/${clean}`) || noExt.endsWith(`/${clean}/index`);
  });
  if (exact) return exact;
  const stemHint = stem(clean);
  return paths.find(
    (path) => path !== from && stem(path) === stemHint && dirname(path) === dirname(from),
  );
}

function hintConfidence(hint: string): LoadPathHop["confidence"] {
  return hint.startsWith(".") || hint.includes("/") ? "extracted" : "inferred";
}

function mentionVia(from: LoadPathLayer, to: LoadPathLayer): LoadPathHopKind {
  if (to === "permissions" || from === "permissions") return "auth";
  if (to === "jobs" || from === "jobs") return "enqueues";
  if (to === "api" || from === "api") return "publishes";
  return "mentions";
}

const WALK_STOP = new Set<LoadPathHopKind>(["tested_by", "same_module", "mentions"]);

function hopRank(hop: LoadPathHop, byPath: Map<string, LoadPathNode>): number {
  if (hop.via === "tested_by") return 0;
  const node = byPath.get(hop.to);
  if (node?.sink && !node.tested) return 1;
  if (node?.sink) return 2;
  if (
    hop.via === "imported_by" ||
    hop.via === "publishes" ||
    hop.via === "enqueues" ||
    hop.via === "auth"
  )
    return 3;
  if (hop.via === "imports") return 4;
  return 5;
}

function walkTrace(seed: string, nodes: LoadPathNode[], hops: LoadPathHop[]): LoadPathTrace {
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const seen = new Set<string>([seed]);
  const out: LoadPathTrace["hops"] = [];
  const queue = [seed];
  while (queue.length && out.length < LOAD_PATH_TRACE_HOP_LIMIT) {
    const cur = queue.shift()!;
    const candidates = hops
      .filter((hop) => hop.from === cur && !seen.has(hop.to) && byPath.has(hop.to))
      .sort((a, b) => hopRank(a, byPath) - hopRank(b, byPath) || a.to.localeCompare(b.to));
    for (const hop of candidates) {
      if (out.length >= LOAD_PATH_TRACE_HOP_LIMIT) break;
      if (seen.has(hop.to)) continue;
      seen.add(hop.to);
      const node = byPath.get(hop.to);
      if (!node) continue;
      out.push({ path: hop.to, layer: node.layer, via: hop.via });
      if (!WALK_STOP.has(hop.via)) queue.push(hop.to);
    }
  }
  const sinks = out
    .filter((hop) => {
      const node = byPath.get(hop.path);
      return node?.sink;
    })
    .map((hop) => ({ path: hop.path, layer: hop.layer }));
  const seedNode = byPath.get(seed);
  if (seedNode?.sink && !sinks.some((row) => row.path === seed)) {
    sinks.unshift({ path: seed, layer: seedNode.layer });
  }
  return { seed, hops: out, sinks: uniqueBy(sinks, (row) => row.path) };
}

function scoreTrace(trace: LoadPathTrace, byPath: Map<string, LoadPathNode>): number {
  const seed = byPath.get(trace.seed);
  let score = 0;
  if (seed?.sink && !seed.tested) score += 40;
  if (trace.hops.some((hop) => hop.via === "tested_by")) score += 20;
  score += new Set([seed?.layer, ...trace.hops.map((hop) => hop.layer)]).size * 5;
  score += Math.min(trace.hops.length, LOAD_PATH_TRACE_HOP_LIMIT);
  score += 10 - LAYER_RANK[seed?.layer ?? "code"];
  return score;
}

function compactLoadPathTraces(nodes: LoadPathNode[], hops: LoadPathHop[]): LoadPathTrace[] {
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const parent = new Map<string, string>();
  const find = (path: string): string => {
    if (!parent.has(path)) parent.set(path, path);
    const cur = parent.get(path)!;
    if (cur !== path) parent.set(path, find(cur));
    return parent.get(path)!;
  };
  const union = (left: string, right: string) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(a, b);
  };
  for (const hop of hops) {
    if (hop.via === "mentions") continue;
    union(hop.from, hop.to);
  }

  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.seed) continue;
    const root = find(node.path);
    const list = groups.get(root) ?? [];
    list.push(node.path);
    groups.set(root, list);
  }

  const outgoing = (path: string) =>
    hops.filter((hop) => hop.from === path && hop.via !== "mentions" && hop.via !== "same_module")
      .length;

  const traces: LoadPathTrace[] = [];
  for (const seeds of groups.values()) {
    const seed = [...seeds].sort((a, b) => {
      const byOut = outgoing(b) - outgoing(a);
      if (byOut) return byOut;
      const na = byPath.get(a);
      const nb = byPath.get(b);
      return (
        LAYER_RANK[na?.layer ?? "code"] - LAYER_RANK[nb?.layer ?? "code"] || a.localeCompare(b)
      );
    })[0];
    if (!seed) continue;
    const trace = walkTrace(seed, nodes, hops);
    if (trace.hops.length) traces.push(trace);
  }
  return traces.sort(
    (a, b) => scoreTrace(b, byPath) - scoreTrace(a, byPath) || a.seed.localeCompare(b.seed),
  );
}

function classifyChangeKinds(nodes: LoadPathNode[]): string[] {
  const layers = new Set(nodes.filter((node) => node.seed).map((node) => node.layer));
  const kinds: string[] = [];
  if (layers.has("permissions")) kinds.push("auth");
  if (layers.has("api")) kinds.push("public_contract");
  if (layers.has("schema")) kinds.push("schema_migration");
  if (layers.has("jobs")) kinds.push("jobs");
  if (layers.has("ui") && !layers.has("api") && !layers.has("permissions") && !layers.has("jobs"))
    kinds.push("leaf_ui");
  else if (layers.has("ui")) kinds.push("ui");
  if (layers.has("code") && kinds.length === 0) kinds.push("internal_service");
  if (!kinds.length && layers.has("tests")) kinds.push("tests_only");
  if (!kinds.length) kinds.push("internal_service");
  return kinds;
}

export function formatFixPrompt(input: {
  pull: { url: string; title: string; headRef: string; baseRef: string };
  number: number;
  verdict?: { verdict: string; reasons: string[]; risk: string };
  loadpath?: { markdown: string };
}): string {
  const verdict = input.verdict
    ? `Reviewer ${input.verdict.verdict} (risk ${input.verdict.risk}): ${
        input.verdict.reasons.length ? input.verdict.reasons.join("; ") : "no reasons given"
      }`
    : "No reviewer JSON verdict yet. Read the latest review thread if needed, then fix the PR.";
  return [
    "Implement the reviewer's findings on this pull request. Stay on the PR branch. Open or update the PR when the fix is ready. Wait for Approve / Deny before push or merge.",
    "",
    `PR: ${input.pull.url}`,
    `#${input.number} ${input.pull.title}`,
    `${input.pull.headRef} → ${input.pull.baseRef}`,
    verdict,
    input.loadpath?.markdown ? `\n${input.loadpath.markdown}` : undefined,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function formatReviewPrompt(input: {
  prompt: string;
  pull: { url: string; title: string; headRef: string; baseRef: string };
  number: number;
  loadpath?: { markdown: string };
  changestack?: { markdown: string };
  comments?: PullComment[];
  bound?: boolean;
}): string {
  const comments = input.comments?.length
    ? `\nExisting review comments (already inlined — do not git_pr_get include=comments again). Do not re-file a thread unless it is still true on this tip; note disposition in git_pr_review only:\n${formatPullComments(input.comments)}`
    : undefined;
  return [
    input.prompt.trim(),
    "",
    `PR: ${input.pull.url}`,
    `#${input.number} ${input.pull.title}`,
    `${input.pull.headRef} → ${input.pull.baseRef}`,
    "The workspace clone is already at the PR head. Do not git_clone again.",
    'This message already includes the load path, change stack, and existing comments. Call git_pr_get once with include=["files"] (omit paths[] unless that response lists files without patches). Do not re-call git_pr_loadpath, git_pr_checks, or git_pr_get include=comments unless a section is missing.',
    "Tick every load-path file from those patches. Full-file reads only for surrounding symbols; issue independent file_read/grep calls in the same round. Treat untested sinks as review priorities. Missing CI is a signal, not a hard stop.",
    "Do not spawn zoom-out plus adversarial subagents that re-read the same files.",
    input.bound
      ? "This is the same agent bound to this repo — do not start a parallel session."
      : undefined,
    comments,
    input.loadpath?.markdown ? `\n${input.loadpath.markdown}` : undefined,
    input.changestack?.markdown ? `\n${input.changestack.markdown}` : undefined,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function scoreRisk(
  nodes: LoadPathNode[],
  untestedSinks: LoadPathReview["untestedSinks"],
  changeKinds: string[],
): { risk: LoadPathRisk; reasons: string[] } {
  const reasons: string[] = [];
  const seeds = nodes.filter((node) => node.seed);
  const tests = nodes.filter((node) => node.layer === "tests");
  const sinks = nodes.filter((node) => node.sink && node.layer !== "tests");
  const covered = sinks.filter((node) => node.tested).length;
  const sinkRatio = sinks.length ? covered / sinks.length : 1;

  let risk: LoadPathRisk = "low";
  if (changeKinds.includes("auth")) {
    risk = "high";
    reasons.push("permissions or auth code is on the path");
  }
  if (
    (changeKinds.includes("public_contract") || changeKinds.includes("schema_migration")) &&
    sinkRatio < 0.5
  ) {
    risk = "high";
    reasons.push("API/schema sinks are mostly untested in this diff");
  } else if (changeKinds.includes("jobs") && sinkRatio < 0.5) {
    if (risk !== "high") risk = "medium";
    reasons.push("jobs/tasks changed without tests in the radius");
  }
  if (untestedSinks.length && risk === "low") {
    risk = "medium";
    reasons.push(`${untestedSinks.length} untested sink${untestedSinks.length === 1 ? "" : "s"}`);
  }
  if (sinks.length && sinkRatio >= 0.85 && risk !== "high") {
    if (risk === "medium" && !changeKinds.includes("auth")) {
      /* keep medium if other warnings */
    } else if (!untestedSinks.length) {
      risk = "low";
    }
    reasons.push(`tests cover ${covered}/${sinks.length} sinks`);
  } else if (tests.length) {
    reasons.push(`${tests.length} test file${tests.length === 1 ? "" : "s"} in the diff`);
  } else if (sinks.length) {
    reasons.push("no tests landed with this change");
    if (risk === "low") risk = "medium";
  }
  if (
    seeds.length <= 2 &&
    changeKinds.includes("leaf_ui") &&
    sinkRatio >= 0.5 &&
    !untestedSinks.length
  ) {
    risk = "low";
    reasons.push("leaf UI with a small radius");
  }
  if (!reasons.length) reasons.push("impact radius is small");
  while (reasons.length < 3) {
    if (nodes.length)
      reasons.push(`${nodes.length} file${nodes.length === 1 ? "" : "s"} on the load path`);
    else reasons.push("empty diff");
    if (reasons.length < 3) reasons.push("edges resolved from this pull only");
    if (reasons.length >= 3) break;
  }
  return { risk, reasons: reasons.slice(0, 3) };
}

function readOrderFiles(nodes: LoadPathNode[]): Array<{ path: string; why: string }> {
  return [...nodes]
    .sort((a, b) => LAYER_RANK[a.layer] - LAYER_RANK[b.layer] || a.path.localeCompare(b.path))
    .map((node) => ({
      path: node.path,
      why: node.layer === "tests" ? "coverage for this radius" : `${node.layer} ${node.kind}`,
    }));
}

function buildHeadline(
  risk: LoadPathRisk,
  kinds: string[],
  untested: number,
  nodes: LoadPathNode[],
): string {
  const kind = kinds.map((item) => item.replace(/_/g, " ")).join(", ");
  const files = `${nodes.length} file${nodes.length === 1 ? "" : "s"}`;
  if (risk === "high")
    return `${kind || "change"} · ${files} · ${untested} untested sink${untested === 1 ? "" : "s"}`;
  if (risk === "low") return `${kind || "change"} · ${files} · small merge radius`;
  return `${kind || "change"} · ${files} · review the traces before merge`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

function clipLoadPathNotes(notes: string): string {
  return notes.length > MAX_LOAD_PATH_NOTES ? notes.slice(0, MAX_LOAD_PATH_NOTES) : notes;
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
