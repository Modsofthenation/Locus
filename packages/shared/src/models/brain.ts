import { looksLikeRememberedSecret } from "./memory.js";
import type { ExtraToolDef } from "./mcp.js";
import { normalizeRepoUrl, shortRepoName } from "./git.js";

export const BRAIN_NODE_TYPES = [
  "Repository",
  "Service",
  "APIEndpoint",
  "Handler",
  "Capability",
  "UsageContract",
  "Concept",
  "Note",
] as const;
export type BrainNodeType = (typeof BRAIN_NODE_TYPES)[number];

export const BRAIN_EDGE_TYPES = [
  "OWNS",
  "CALLS",
  "HANDLED_BY",
  "EXPOSES_CAPABILITY",
  "IMPLEMENTS_CAPABILITY",
  "USES",
  "DEFINES",
  "ANNOTATES",
] as const;
export type BrainEdgeType = (typeof BRAIN_EDGE_TYPES)[number];

export const BRAIN_CONFIDENCES = ["high", "medium", "low"] as const;
export type BrainConfidence = (typeof BRAIN_CONFIDENCES)[number];

export const BRAIN_MEMORY_KINDS = ["decision", "gotcha", "convention", "note"] as const;
export type BrainMemoryKind = (typeof BRAIN_MEMORY_KINDS)[number];

export const BRAIN_CORRECTION_STATUSES = ["open", "accepted", "dismissed"] as const;
export type BrainCorrectionStatus = (typeof BRAIN_CORRECTION_STATUSES)[number];

export function isBrainCorrectionStatus(value: unknown): value is BrainCorrectionStatus {
  return (BRAIN_CORRECTION_STATUSES as readonly string[]).includes(value as string);
}

export const DEFAULT_BRAIN_ID = "default";

export interface BrainSettings {
  /** Index into the brain after git_clone / first session. Default on. */
  autoIndex?: boolean;
  /** Pause remember + session distill ingest. Default off. */
  ingestPaused?: boolean;
  /** Mirror cached Slack messages into corpus FTS. Default off. */
  slackCorpus?: boolean;
  /** Mirror recent Jira issue summaries into corpus FTS. Default off. */
  jiraCorpus?: boolean;
  /** Provider id for the LLM distiller (falls back to first usable non-CLI provider). */
  distillerProviderId?: string;
  /** Model id for the LLM distiller. */
  distillerModel?: string;
}

export function parseBrainSettings(raw: unknown): BrainSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const out: BrainSettings = {};
  if (value.autoIndex === false) out.autoIndex = false;
  if (value.autoIndex === true) out.autoIndex = true;
  if (value.ingestPaused === true) out.ingestPaused = true;
  if (value.slackCorpus === true) out.slackCorpus = true;
  if (value.jiraCorpus === true) out.jiraCorpus = true;
  if (typeof value.distillerProviderId === "string" && value.distillerProviderId.trim()) {
    out.distillerProviderId = value.distillerProviderId.trim();
  }
  if (typeof value.distillerModel === "string" && value.distillerModel.trim()) {
    out.distillerModel = value.distillerModel.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

export function brainAutoIndexEnabled(settings?: BrainSettings | null): boolean {
  return settings?.autoIndex !== false;
}

export function brainIngestPaused(settings?: BrainSettings | null): boolean {
  return settings?.ingestPaused === true;
}

export function brainSlackCorpusEnabled(settings?: BrainSettings | null): boolean {
  return settings?.slackCorpus === true;
}

export function brainJiraCorpusEnabled(settings?: BrainSettings | null): boolean {
  return settings?.jiraCorpus === true;
}

export const BRAIN_TOOL_NAMES = [
  "orient",
  "find_entity",
  "get_entity",
  "search_knowledge",
  "correct_graph",
  "brain_brief",
] as const;
export type BrainToolName = (typeof BRAIN_TOOL_NAMES)[number];

export const BRAIN_MCP_TOOL_NAMES = ["orient", "search_knowledge", "remember"] as const;

export function isBrainNodeType(value: string): value is BrainNodeType {
  return (BRAIN_NODE_TYPES as readonly string[]).includes(value);
}

export function isBrainEdgeType(value: string): value is BrainEdgeType {
  return (BRAIN_EDGE_TYPES as readonly string[]).includes(value);
}

export function isBrainConfidence(value: unknown): value is BrainConfidence {
  return value === "high" || value === "medium" || value === "low";
}

export function isBrainMemoryKind(value: unknown): value is BrainMemoryKind {
  return (BRAIN_MEMORY_KINDS as readonly string[]).includes(value as string);
}

export function isBrainToolName(name: string): boolean {
  return (BRAIN_TOOL_NAMES as readonly string[]).includes(name);
}

export function isBrainMcpToolName(name: string): boolean {
  return (BRAIN_MCP_TOOL_NAMES as readonly string[]).includes(name);
}

export function sessionOffersBrain(session: { kind?: string }): boolean {
  return (
    session.kind !== "design" &&
    session.kind !== "game" &&
    session.kind !== "assets" &&
    session.kind !== "setup"
  );
}

export interface BrainProvenance {
  actor: string;
  evidence?: string;
  confidence?: BrainConfidence;
}

export interface BrainNode {
  id: string;
  type: BrainNodeType;
  name: string;
  aliases?: string[];
  description?: string;
  evidence?: string;
  confidence?: BrainConfidence;
  repo?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrainEdge {
  id: string;
  type: BrainEdgeType;
  from: string;
  to: string;
  evidence?: string;
  confidence?: BrainConfidence;
  createdBy: string;
  createdAt: string;
}

export interface BrainMemory {
  id: string;
  claim: string;
  kind: BrainMemoryKind;
  source: "user_stated" | "agent" | "indexer" | "session";
  ambient: boolean;
  evidenceCount: number;
  contradictionCount: number;
  repo?: string;
  sessionId?: string;
  createdAt: string;
}

export interface BrainCorpusRow {
  id: string;
  text: string;
  source: string;
  createdAt: string;
}

export interface BrainActivity {
  id: string;
  kind: "index" | "remember" | "distill" | "build" | "correct";
  text: string;
  at: string;
  /** Indexed checkout scope (remote URL or path) when known. */
  repo?: string;
}

export interface BrainCorrection {
  id: string;
  nodeId?: string;
  memoryId?: string;
  claim: string;
  reason: string;
  status: BrainCorrectionStatus;
  actor: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface BrainIndexedRepo {
  url?: string;
  path?: string;
  head?: string;
  indexedAt: string;
  fileCount?: number;
}

export interface BrainJournalRow {
  at: string;
  verb: string;
  actor: string;
  detail: string;
}

export interface BrainDocument {
  id: string;
  title: string;
  nodes: BrainNode[];
  edges: BrainEdge[];
  memories: BrainMemory[];
  corpus: BrainCorpusRow[];
  journal: BrainJournalRow[];
  activity: BrainActivity[];
  repos: BrainIndexedRepo[];
  corrections?: BrainCorrection[];
  updatedAt: string;
}

export interface BrainSummary {
  id: string;
  title: string;
  nodeCount: number;
  edgeCount: number;
  memoryCount: number;
  updatedAt: string;
  empty: boolean;
  inboxCount?: number;
  /** Per-remote claim counts derived from node/memory `repo` tags. */
  repos?: BrainRepoClaimStats[];
}

export interface BrainRepoClaimStats {
  url: string;
  nodeCount: number;
  memoryCount: number;
}

export const BRAIN_HINT =
  "A knowledge brain is available. Call orient if you feel lost after compact. search_knowledge is pull-only tribal knowledge (symptoms, identifiers, paths). find_entity looks up services and APIs. remember durable conclusions into the brain — send the text, do not classify (workspace memories.json is a manual override via Settings/CLI). Grep remains the source of truth for the tree.";

export function emptyBrain(id = DEFAULT_BRAIN_ID, at = new Date().toISOString()): BrainDocument {
  return {
    id,
    title: id === DEFAULT_BRAIN_ID ? "Brain" : id,
    nodes: [],
    edges: [],
    memories: [],
    corpus: [],
    journal: [],
    activity: [],
    repos: [],
    corrections: [],
    updatedAt: at,
  };
}

/** Aggregate claim counts keyed by normalized remote URL. */
export function brainRepoClaims(doc: BrainDocument): BrainRepoClaimStats[] {
  const map = new Map<string, BrainRepoClaimStats>();
  const touch = (url: string | undefined, which: "node" | "memory") => {
    const raw = url?.trim();
    if (!raw) return;
    const key = normalizeRepoUrl(raw);
    const cur = map.get(key) ?? { url: raw, nodeCount: 0, memoryCount: 0 };
    if (which === "node") cur.nodeCount += 1;
    else cur.memoryCount += 1;
    map.set(key, cur);
  };
  for (const row of doc.nodes) touch(row.repo, "node");
  for (const row of doc.memories) touch(row.repo, "memory");
  return [...map.values()].sort(
    (a, b) => b.nodeCount + b.memoryCount - (a.nodeCount + a.memoryCount),
  );
}

/** Look up claim counts for one linked remote (0 when none tagged). */
export function brainClaimsForRepo(
  summary: Pick<BrainSummary, "repos"> | null | undefined,
  repoUrl: string | undefined,
): { nodeCount: number; memoryCount: number } {
  if (!summary?.repos?.length || !repoUrl?.trim()) return { nodeCount: 0, memoryCount: 0 };
  const key = normalizeRepoUrl(repoUrl);
  const hit = summary.repos.find((row) => normalizeRepoUrl(row.url) === key);
  return hit
    ? { nodeCount: hit.nodeCount, memoryCount: hit.memoryCount }
    : { nodeCount: 0, memoryCount: 0 };
}

/** Stable key for an indexed checkout chip (remote URL, else path). */
export function brainIndexedRepoKey(row: BrainIndexedRepo): string {
  return (row.url?.trim() || row.path?.trim() || row.indexedAt).replace(/\\/g, "/");
}

/** Short label for graph scope chips. */
export function brainIndexedRepoLabel(row: BrainIndexedRepo): string {
  if (row.url?.trim()) return shortRepoName(row.url);
  if (row.path?.trim()) {
    const parts = row.path.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.at(-1) || row.path;
  }
  return "repo";
}

export function normalizeBrainScopeKey(value: string): string {
  return value
    .replace(/\\/g, "/")
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

/** Whether a claim belongs to an indexed checkout (by remote or folder scope tag). */
export function brainNodeMatchesIndexedRepo(
  node: Pick<BrainNode, "repo">,
  indexed: BrainIndexedRepo,
): boolean {
  const tag = node.repo?.trim();
  if (!tag) return false;
  const key = normalizeBrainScopeKey(tag);
  if (indexed.url?.trim() && key === normalizeBrainScopeKey(indexed.url)) return true;
  if (indexed.path?.trim() && key === normalizeBrainScopeKey(indexed.path)) return true;
  return false;
}

/** Subgraph for one indexed checkout, or the full graph when `indexed` is null. */
export function filterBrainGraph(
  doc: Pick<BrainDocument, "nodes" | "edges">,
  indexed: BrainIndexedRepo | null | undefined,
): { nodes: BrainNode[]; edges: BrainEdge[] } {
  if (!indexed) return { nodes: doc.nodes, edges: doc.edges };
  const nodes = doc.nodes.filter((row) => brainNodeMatchesIndexedRepo(row, indexed));
  const ids = new Set(nodes.map((row) => row.id));
  const edges = doc.edges.filter((row) => ids.has(row.from) && ids.has(row.to));
  return { nodes, edges };
}

/** Memories for one indexed checkout, or all when `indexed` is null. */
export function filterBrainMemories(
  memories: BrainMemory[],
  indexed: BrainIndexedRepo | null | undefined,
): BrainMemory[] {
  if (!indexed) return memories;
  return memories.filter((row) => brainNodeMatchesIndexedRepo(row, indexed));
}

/**
 * Activity for one indexed checkout, or all when `indexed` is null.
 * Unscoped historical rows (no `repo`) only appear under All.
 */
export function filterBrainActivity(
  activity: BrainActivity[],
  indexed: BrainIndexedRepo | null | undefined,
): BrainActivity[] {
  if (!indexed) return activity;
  return activity.filter((row) => brainNodeMatchesIndexedRepo(row, indexed));
}

export function brainSummary(doc: BrainDocument): BrainSummary {
  return {
    id: doc.id,
    title: doc.title,
    nodeCount: doc.nodes.length,
    edgeCount: doc.edges.length,
    memoryCount: doc.memories.length,
    updatedAt: doc.updatedAt,
    empty: doc.nodes.length === 0 && doc.memories.length === 0,
    inboxCount: (doc.corrections ?? []).filter((row) => row.status === "open").length,
    repos: brainRepoClaims(doc),
  };
}

export function brainId(type: BrainNodeType, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${type.toLowerCase()}:${slug || "unnamed"}`;
}

export function upsertNode(
  doc: BrainDocument,
  input: {
    type: string;
    name: string;
    aliases?: string[];
    description?: string;
    repo?: string;
    provenance?: BrainProvenance;
  },
  at = new Date().toISOString(),
): { doc: BrainDocument; output: string; ok: boolean } {
  const actor = input.provenance?.actor?.trim() ?? "";
  if (!actor) return { doc, output: "provenance.actor is required", ok: false };
  if (!isBrainNodeType(input.type))
    return { doc, output: `Unknown node type: ${input.type}`, ok: false };
  const name = input.name.trim();
  if (!name) return { doc, output: "name is required", ok: false };
  const id = brainId(input.type, name);
  const existing = doc.nodes.find((row) => row.id === id);
  const confidence = isBrainConfidence(input.provenance?.confidence)
    ? input.provenance!.confidence
    : (existing?.confidence ?? "medium");
  const aliases = uniqueStrings([...(existing?.aliases ?? []), ...(input.aliases ?? [])]);
  const node: BrainNode = {
    id,
    type: input.type,
    name: existing?.name ?? name,
    aliases: aliases.length ? aliases : undefined,
    description: input.description?.trim() || existing?.description,
    evidence: input.provenance?.evidence?.trim() || existing?.evidence,
    confidence,
    repo: input.repo?.trim() || existing?.repo,
    createdBy: existing?.createdBy ?? actor,
    updatedBy: actor,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  const nodes = existing
    ? doc.nodes.map((row) => (row.id === id ? node : row))
    : [...doc.nodes, node];
  const next = stamp(doc, { nodes }, actor, existing ? "merge_entity" : "upsert_entity", id, at);
  return { doc: next, output: existing ? `Updated ${id}` : `Created ${id}`, ok: true };
}

export function upsertEdge(
  doc: BrainDocument,
  input: {
    type: string;
    from: string;
    to: string;
    provenance?: BrainProvenance;
  },
  at = new Date().toISOString(),
): { doc: BrainDocument; output: string; ok: boolean } {
  const actor = input.provenance?.actor?.trim() ?? "";
  if (!actor) return { doc, output: "provenance.actor is required", ok: false };
  if (!isBrainEdgeType(input.type))
    return { doc, output: `Unknown edge type: ${input.type}`, ok: false };
  const from = input.from.trim();
  const to = input.to.trim();
  if (!from || !to) return { doc, output: "from and to are required", ok: false };
  const existing = doc.edges.find(
    (row) => row.type === input.type && row.from === from && row.to === to,
  );
  if (existing)
    return { doc, output: `Edge already exists: ${input.type} ${from} → ${to}`, ok: true };
  const edge: BrainEdge = {
    id: `e${doc.edges.length + 1}-${Math.abs(hash32(`${input.type}:${from}:${to}`)).toString(36)}`,
    type: input.type,
    from,
    to,
    evidence: input.provenance?.evidence?.trim(),
    confidence: isBrainConfidence(input.provenance?.confidence)
      ? input.provenance!.confidence
      : "medium",
    createdBy: actor,
    createdAt: at,
  };
  const next = stamp(
    doc,
    { edges: [...doc.edges, edge] },
    actor,
    "upsert_relation",
    `${input.type} ${from}→${to}`,
    at,
  );
  return { doc: next, output: `Linked ${from} -[${input.type}]-> ${to}`, ok: true };
}

export function findEntities(
  doc: BrainDocument,
  input: { q?: string; qs?: string[]; type?: string; limit?: number },
): { status: "exact" | "matches" | "empty"; matches: BrainNode[] } {
  const queries = [
    ...(typeof input.q === "string" && input.q.trim() ? [input.q] : []),
    ...(Array.isArray(input.qs) ? input.qs : []),
  ]
    .flatMap((row) => row.split(","))
    .map((row) => row.trim())
    .filter(Boolean)
    .slice(0, 10);
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 10)));
  if (!queries.length) return { status: "empty", matches: [] };
  const seen = new Set<string>();
  const matches: BrainNode[] = [];
  for (const q of queries) {
    const exact = doc.nodes.find((row) => row.id === q || row.id === q.toLowerCase());
    if (exact && !seen.has(exact.id) && typeOk(exact, input.type)) {
      seen.add(exact.id);
      matches.push(exact);
    }
    for (const row of doc.nodes) {
      if (matches.length >= limit) break;
      if (seen.has(row.id) || !typeOk(row, input.type)) continue;
      if (entityMatches(row, q)) {
        seen.add(row.id);
        matches.push(row);
      }
    }
  }
  if (!matches.length) return { status: "empty", matches: [] };
  const exactHit = queries.some((q) => matches[0]?.id === q || matches[0]?.id === q.toLowerCase());
  return { status: exactHit ? "exact" : "matches", matches: matches.slice(0, limit) };
}

export function getEntity(doc: BrainDocument, id: string): string {
  const node = doc.nodes.find((row) => row.id === id.trim());
  if (!node) return `No entity ${id.trim() || "(none)"}`;
  const outgoing = doc.edges.filter((row) => row.from === node.id);
  const incoming = doc.edges.filter((row) => row.to === node.id);
  const lines = [
    `${node.type} ${node.id}`,
    `name: ${node.name}`,
    node.description ? `description: ${node.description}` : "",
    node.evidence ? `evidence: ${node.evidence}` : "",
    node.confidence ? `confidence: ${node.confidence}` : "",
    node.aliases?.length ? `aliases: ${node.aliases.join(", ")}` : "",
    node.repo ? `repo: ${node.repo}` : "",
    outgoing.length
      ? `outgoing:\n${outgoing.map((row) => `  -[${row.type}]-> ${row.to}${row.evidence ? ` (${row.evidence})` : ""}`).join("\n")}`
      : "",
    incoming.length
      ? `incoming:\n${incoming.map((row) => `  <-[${row.type}]- ${row.from}${row.evidence ? ` (${row.evidence})` : ""}`).join("\n")}`
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export function searchKnowledge(doc: BrainDocument, q: string, limit = 8): string {
  const query = q.trim();
  if (!query) return "q is required";
  const tokens = tokenize(query);
  if (!tokens.length) return "No matches.";
  const hits: Array<{ score: number; line: string }> = [];
  for (const node of doc.nodes) {
    const hay = `${node.id} ${node.name} ${node.aliases?.join(" ") ?? ""} ${node.description ?? ""} ${node.evidence ?? ""}`;
    const score = scoreHay(hay, tokens);
    if (score > 0) {
      hits.push({
        score: score + (node.repo ? 0.04 : 0),
        line: `${node.type} ${node.id} — ${node.description || node.name}${node.evidence ? ` [${node.evidence}]` : ""}`,
      });
    }
  }
  for (const mem of doc.memories) {
    const score = scoreHay(`${mem.claim} ${mem.kind} ${mem.repo ?? ""}`, tokens);
    if (score > 0) {
      hits.push({
        score: score + (mem.source === "user_stated" ? 0.2 : 0) + (mem.ambient ? 0.05 : 0),
        line: `memory ${mem.id} (${mem.kind}): ${mem.claim}`,
      });
    }
  }
  for (const row of doc.corpus) {
    const score = scoreHay(row.text, tokens);
    if (score > 0) hits.push({ score, line: `corpus ${row.id}: ${clip(row.text, 160)}` });
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, Math.max(1, Math.min(20, limit)));
  if (!top.length)
    return "No matches. The graph stores architecture; grep the tree for current code.";
  return top.map((row) => `- ${row.line}`).join("\n");
}

export function rememberObservation(
  doc: BrainDocument,
  input: {
    text: string;
    kind?: BrainMemoryKind;
    source?: BrainMemory["source"];
    ambient?: boolean;
    repo?: string;
    sessionId?: string;
    actor?: string;
  },
  at = new Date().toISOString(),
): { doc: BrainDocument; output: string; ok: boolean } {
  const text = input.text.trim();
  if (!text) return { doc, output: "text is required", ok: false };
  if (looksLikeRememberedSecret(text)) {
    return { doc, output: "Refusing to store a secret. Keep tokens in Settings.", ok: false };
  }
  const claim = text.slice(0, 800);
  const existing = doc.memories.find((row) => {
    if ((row.repo ?? "") !== (input.repo ?? "")) return false;
    return claimsNearDuplicate(row.claim, claim);
  });
  if (existing) {
    const memories = doc.memories.map((row) =>
      row.id === existing.id
        ? {
            ...row,
            // Prefer the longer / more specific claim when merging near-duplicates.
            claim: claim.length > row.claim.length ? claim : row.claim,
            kind:
              input.kind && isBrainMemoryKind(input.kind) && row.kind === "note"
                ? input.kind
                : row.kind,
            evidenceCount: row.evidenceCount + 1,
            ambient: row.ambient || Boolean(input.ambient) || row.evidenceCount + 1 >= 2,
            source: row.source === "user_stated" ? row.source : (input.source ?? row.source),
          }
        : row,
    );
    const next = stamp(doc, { memories }, input.actor ?? "session", "remember", existing.id, at);
    return { doc: next, output: `Queued (consolidated ${existing.id}).`, ok: true };
  }
  const id = `mem:${Math.abs(hash32(`${claim}:${at}`)).toString(36)}`;
  const memory: BrainMemory = {
    id,
    claim,
    kind: input.kind && isBrainMemoryKind(input.kind) ? input.kind : "note",
    source: input.source ?? "user_stated",
    ambient: input.ambient ?? input.source === "user_stated",
    evidenceCount: 1,
    contradictionCount: 0,
    repo: input.repo,
    sessionId: input.sessionId,
    createdAt: at,
  };
  const next = stamp(
    doc,
    { memories: [...doc.memories, memory].slice(-400) },
    input.actor ?? "session",
    "remember",
    id,
    at,
  );
  return {
    doc: next,
    output: `Queued (${id}). Distiller will file this; you never classify.`,
    ok: true,
  };
}

export function contradictMemory(
  doc: BrainDocument,
  id: string,
  at = new Date().toISOString(),
): BrainDocument {
  const memories = doc.memories.map((row) =>
    row.id === id
      ? { ...row, contradictionCount: row.contradictionCount + 1, ambient: false }
      : row,
  );
  return { ...doc, memories, updatedAt: at };
}

export function openBrainCorrections(doc: Pick<BrainDocument, "corrections">): BrainCorrection[] {
  return (doc.corrections ?? []).filter((row) => row.status === "open");
}

export function queueBrainCorrection(
  doc: BrainDocument,
  input: {
    nodeId?: string;
    memoryId?: string;
    claim?: string;
    reason: string;
    actor?: string;
  },
  at = new Date().toISOString(),
): { doc: BrainDocument; output: string; ok: boolean } {
  const reason = input.reason.trim();
  if (!reason) return { doc, output: "reason is required", ok: false };
  const nodeId = input.nodeId?.trim() || undefined;
  const memoryId = input.memoryId?.trim() || undefined;
  if (nodeId && !doc.nodes.some((row) => row.id === nodeId)) {
    return { doc, output: `Unknown node ${nodeId}`, ok: false };
  }
  if (memoryId && !doc.memories.some((row) => row.id === memoryId)) {
    return { doc, output: `Unknown memory ${memoryId}`, ok: false };
  }
  if (!nodeId && !memoryId) {
    return { doc, output: "Pass nodeId or memoryId.", ok: false };
  }
  const existing = openBrainCorrections(doc).find(
    (row) => row.nodeId === nodeId && row.memoryId === memoryId && row.reason === reason,
  );
  if (existing) {
    return { doc, output: `Already queued (${existing.id}).`, ok: true };
  }
  const id = `fix:${Math.abs(hash32(`${nodeId ?? ""}:${memoryId ?? ""}:${reason}:${at}`)).toString(36)}`;
  const correction: BrainCorrection = {
    id,
    nodeId,
    memoryId,
    claim: (input.claim ?? "").trim() || reason,
    reason,
    status: "open",
    actor: input.actor?.trim() || "session",
    createdAt: at,
  };
  const next = stamp(
    { ...doc, corrections: [...(doc.corrections ?? []), correction].slice(-200) },
    {},
    correction.actor,
    "correct",
    id,
    at,
  );
  return { doc: next, output: `Queued correction ${id} for operator review.`, ok: true };
}

export function resolveBrainCorrection(
  doc: BrainDocument,
  id: string,
  action: "accepted" | "dismissed",
  at = new Date().toISOString(),
): { doc: BrainDocument; output: string; ok: boolean } {
  const current = (doc.corrections ?? []).find((row) => row.id === id);
  if (!current) return { doc, output: `Unknown correction ${id}`, ok: false };
  if (current.status !== "open") {
    return { doc, output: `Correction ${id} is already ${current.status}.`, ok: true };
  }
  let next = doc;
  if (action === "accepted") {
    if (current.memoryId) next = contradictMemory(next, current.memoryId, at);
    if (current.nodeId) {
      next = {
        ...next,
        nodes: next.nodes.map((row) =>
          row.id === current.nodeId
            ? {
                ...row,
                confidence: "low" as const,
                description: [row.description, `Flagged: ${current.reason}`]
                  .filter(Boolean)
                  .join(" "),
                updatedAt: at,
              }
            : row,
        ),
        updatedAt: at,
      };
    }
  }
  const corrections = (next.corrections ?? []).map((row) =>
    row.id === id ? { ...row, status: action, resolvedAt: at } : row,
  );
  next = stamp({ ...next, corrections }, {}, "operator", "correct", `${action}:${id}`, at);
  return {
    doc: next,
    output: action === "accepted" ? `Accepted ${id}.` : `Dismissed ${id}.`,
    ok: true,
  };
}

/** Normalize claim text for consolidate / near-duplicate matching. */
export function normalizeBrainClaim(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function claimsNearDuplicate(a: string, b: string): boolean {
  const na = normalizeBrainClaim(a);
  const nb = normalizeBrainClaim(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = na.split(" ").filter((token) => token.length > 2);
  const tb = new Set(nb.split(" ").filter((token) => token.length > 2));
  if (!ta.length || !tb.size) return false;
  let inter = 0;
  for (const token of ta) if (tb.has(token)) inter += 1;
  const union = ta.length + tb.size - inter;
  return union > 0 && inter / union >= 0.7;
}

/**
 * Apply a batch of distilled observations: contradict, consolidate near-duplicates,
 * strengthen evidence, and promote ambient when evidence earns it.
 */
export function consolidateObservations(
  doc: BrainDocument,
  rows: Array<{
    text: string;
    kind?: BrainMemoryKind;
    source?: BrainMemory["source"];
    ambient?: boolean;
    contradictId?: string;
  }>,
  opts: { repo?: string; sessionId?: string; actor?: string } = {},
  at = new Date().toISOString(),
): { doc: BrainDocument; count: number; contradicted: number } {
  let next = doc;
  let count = 0;
  let contradicted = 0;
  for (const row of rows) {
    const claim = row.text.trim();
    if (!claim) continue;
    let contradictId = row.contradictId?.trim();
    if (!contradictId) contradictId = findContradictedMemoryId(next, claim);
    if (contradictId) {
      next = contradictMemory(next, contradictId, at);
      contradicted += 1;
    }
    const saved = rememberObservation(
      next,
      {
        text: claim,
        kind: row.kind,
        source: row.source,
        ambient: row.ambient,
        repo: opts.repo,
        sessionId: opts.sessionId,
        actor: opts.actor ?? "distiller",
      },
      at,
    );
    if (!saved.ok) continue;
    next = saved.doc;
    count += 1;
  }
  next = promoteAmbientMemories(next, at);
  return { doc: next, count, contradicted };
}

export function findContradictedMemoryId(doc: BrainDocument, claim: string): string | undefined {
  const normalized = normalizeBrainClaim(claim);
  const neverHit = normalized.match(/\bnever\b(.+)$/);
  const alwaysHit = normalized.match(/\b(?:always|we do|we should)\b(.+)$/);
  if (neverHit?.[1]) {
    const tail = neverHit[1].trim();
    if (tail.length < 6) return undefined;
    return doc.memories.find((row) => {
      if (row.contradictionCount > 0) return false;
      const other = normalizeBrainClaim(row.claim);
      return (
        other.includes(tail) &&
        (/\balways\b/.test(other) || /\bwe (?:do|should)\b/.test(other)) &&
        !/\bnever\b/.test(other)
      );
    })?.id;
  }
  if (alwaysHit?.[1]) {
    const tail = alwaysHit[1].trim();
    if (tail.length < 6) return undefined;
    return doc.memories.find((row) => {
      if (row.contradictionCount > 0) return false;
      const other = normalizeBrainClaim(row.claim);
      return other.includes(tail) && /\bnever\b/.test(other);
    })?.id;
  }
  return undefined;
}

function promoteAmbientMemories(doc: BrainDocument, at: string): BrainDocument {
  let changed = false;
  const memories = doc.memories.map((row) => {
    if (row.ambient || row.contradictionCount > 0) return row;
    if (row.source === "user_stated" || row.evidenceCount >= 2) {
      changed = true;
      return { ...row, ambient: true };
    }
    return row;
  });
  return changed ? { ...doc, memories, updatedAt: at } : doc;
}

export function renderOrientDoc(doc: BrainDocument, repo?: string): string {
  if (!doc.nodes.length && !doc.memories.length) {
    return [
      "# Brain",
      "Empty brain — Build from Codebase (or `locus brain build`) to index services and APIs.",
      "Call search_knowledge for distilled memory. Grep remains the source of truth for the tree.",
    ].join("\n");
  }
  const services = doc.nodes.filter((row) => row.type === "Service");
  const endpoints = doc.nodes.filter((row) => row.type === "APIEndpoint");
  const ranked = [...doc.nodes].sort((a, b) => {
    const ra = a.repo && repo && sameRepo(a.repo, repo) ? 0 : 1;
    const rb = b.repo && repo && sameRepo(b.repo, repo) ? 0 : 1;
    return ra - rb;
  });
  const ambient = doc.memories.filter((row) => memoryEntersOrient(row));
  const lines = [
    "# Brain",
    `${doc.nodes.length} claims · ${doc.edges.length} edges · ${doc.memories.length} memories`,
    "",
  ];
  if (services.length) {
    lines.push("## Services");
    for (const row of services.slice(0, 24)) {
      lines.push(
        `- ${row.name}${row.description ? ` — ${row.description}` : ""}${row.evidence ? ` (${row.evidence})` : ""}`,
      );
    }
    lines.push("");
  }
  if (endpoints.length) {
    lines.push("## APIs");
    for (const row of (repo ? ranked : endpoints)
      .filter((row) => row.type === "APIEndpoint")
      .slice(0, 32)) {
      lines.push(`- ${row.name}${row.evidence ? ` (${row.evidence})` : ""}`);
    }
    lines.push("");
  }
  if (ambient.length) {
    lines.push("## Memory");
    for (const row of ambient.slice(0, 40)) {
      lines.push(`- ${row.claim} [${row.id}]`);
    }
    lines.push("");
  }
  lines.push("Call find_entity / search_knowledge to pull more. Grep the tree to verify.");
  return lines.join("\n");
}

export function memoryEntersOrient(row: BrainMemory): boolean {
  if (row.contradictionCount > 0) return false;
  if (
    row.kind === "note" &&
    row.source !== "user_stated" &&
    row.evidenceCount < 2 &&
    !row.ambient
  ) {
    return false;
  }
  if (row.source === "user_stated") return true;
  if (row.ambient && row.evidenceCount >= 1) return true;
  return row.evidenceCount >= 2;
}

/** Max chars of session transcript fed to the distiller (matches LLM distill prompt budget). */
export const BRAIN_DISTILL_TAIL_CHARS = 12_000;

/**
 * Build a session-tail blob for idle/close distill: newest user/assistant turns,
 * walking backward until `maxChars`. Older turns are kept when they fit.
 */
export function sessionDistillTail(
  messages: ReadonlyArray<{ role: string; content?: string }>,
  maxChars = BRAIN_DISTILL_TAIL_CHARS,
): string {
  if (maxChars <= 0) return "";
  const parts: string[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = (msg.content ?? "").trim();
    if (!text) continue;
    const labeled = `${msg.role}: ${text}`;
    if (total + labeled.length + (parts.length ? 1 : 0) > maxChars) {
      if (!parts.length) return labeled.slice(0, maxChars);
      break;
    }
    parts.push(labeled);
    total += labeled.length + (parts.length > 1 ? 1 : 0);
  }
  return parts.reverse().join("\n");
}

export function distillSessionText(
  text: string,
): Array<{ text: string; kind: BrainMemoryKind; ambient: boolean; source: BrainMemory["source"] }> {
  const out: Array<{
    text: string;
    kind: BrainMemoryKind;
    ambient: boolean;
    source: BrainMemory["source"];
  }> = [];
  const seen = new Set<string>();
  const push = (claim: string, kind: BrainMemoryKind, source: BrainMemory["source"]) => {
    const next = claim.trim().replace(/\s+/g, " ").slice(0, 800);
    if (!next || next.length < 12 || looksLikeRememberedSecret(next)) return;
    const key = next.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      text: next,
      kind,
      ambient: source === "user_stated" || kind === "convention" || kind === "gotcha",
      source,
    });
  };
  const remember = text.match(/remember(?:\s+this)?[:\s]+(.{12,400})/gi) ?? [];
  for (const row of remember) {
    const claim = row.replace(/^remember(?:\s+this)?[:\s]+/i, "").trim();
    push(claim, "decision", "user_stated");
  }
  for (const line of text.split("\n")) {
    const one = line.trim();
    if (one.length < 12 || one.length > 400) continue;
    if (/\bwe never\b|\balways\b|\bdo not\b|\bdon't\b|\bnever do\b/i.test(one)) {
      push(one, /\bnever\b/i.test(one) ? "gotcha" : "convention", "session");
    } else if (/\bdecided\b|\bdecision\b|\bgoing with\b|\bchose\b/i.test(one)) {
      push(one, "decision", "session");
    }
    if (out.length >= 8) break;
  }
  return out.slice(0, 8).map((row) => ({ ...row }));
}

export interface ExtractedClaim {
  type: BrainNodeType;
  name: string;
  aliases?: string[];
  description?: string;
  evidence?: string;
  confidence?: BrainConfidence;
  owns?: string;
}

export function extractBrainClaims(
  files: Array<{ path: string; text: string }>,
  opts: { repo?: string } = {},
): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  const pkg = files.find((row) => /(^|\/)package\.json$/i.test(row.path));
  if (pkg) {
    try {
      const json = JSON.parse(pkg.text) as { name?: unknown; description?: unknown };
      const name = typeof json.name === "string" ? json.name.trim() : "";
      if (name) {
        claims.push({
          type: "Service",
          name,
          description: typeof json.description === "string" ? json.description.trim() : undefined,
          evidence: `${opts.repo ? `${opts.repo}:` : ""}${pkg.path}:1`,
          confidence: "high",
        });
      }
    } catch {
      /* ignore */
    }
  }
  for (const file of files) {
    for (const route of extractHttpRoutes(file.path, file.text)) {
      claims.push({
        type: "APIEndpoint",
        name: `${route.method} ${route.path}`,
        evidence: `${opts.repo ? `${opts.repo}:` : ""}${file.path}:${route.line}`,
        confidence: "high",
        owns: pkgNameFromClaims(claims),
      });
    }
    for (const service of extractComposeServices(file.path, file.text)) {
      claims.push({
        type: "Service",
        name: service.name,
        evidence: `${opts.repo ? `${opts.repo}:` : ""}${file.path}:${service.line}`,
        confidence: "medium",
      });
    }
  }
  return claims;
}

export function extractHttpRoutes(
  path: string,
  text: string,
): Array<{ method: string; path: string; line: number }> {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb)$/i.test(path)) return [];
  const out: Array<{ method: string; path: string; line: number }> = [];
  const patterns: Array<{
    re: RegExp;
    methodFrom?: (m: RegExpExecArray) => string;
    pathGroup?: number;
  }> = [
    {
      // Express / Fastify / Hono / chi-style JS
      re: /(?:app|router|r)\.(get|post|put|patch|delete|options|head|all)\(\s*["'`]([^"'`]+)["'`]/gi,
      methodFrom: (m) => String(m[1] ?? "GET").toUpperCase(),
    },
    {
      // Flask / FastAPI decorators
      re: /@(?:app|bp|router)\.(get|post|put|patch|delete|options|head|route)\(\s*["'`]([^"'`]+)["'`]/gi,
      methodFrom: (m) => {
        const verb = String(m[1] ?? "GET").toUpperCase();
        return verb === "ROUTE" ? "GET" : verb;
      },
    },
    {
      re: /@(?:app|bp|router)\.route\(\s*["'`]([^"'`]+)["'`]/gi,
      methodFrom: () => "GET",
      pathGroup: 1,
    },
    {
      // Django path()/re_path()
      re: /\b(?:path|re_path|url)\(\s*["'`]([^"'`]+)["'`]/g,
      methodFrom: () => "GET",
      pathGroup: 1,
    },
    {
      // Rails match/get/post
      re: /\b(?:get|post|put|patch|delete)\s+["']([^"']+)["']/gi,
      methodFrom: (m) => String(m[0]?.split(/\s+/)[0] ?? "GET").toUpperCase(),
      pathGroup: 1,
    },
    {
      // Go chi / net/http HandleFunc-ish and typed methods
      re: /\.(Get|Post|Put|Patch|Delete|HandleFunc|Handle)\(\s*"([^"]+)"/g,
      methodFrom: (m) => {
        const verb = String(m[1] ?? "GET");
        if (verb === "HandleFunc" || verb === "Handle") return "GET";
        return verb.toUpperCase();
      },
    },
    {
      // Go chi r.Method(...)
      re: /\.Method\(\s*"([A-Z]+)"\s*,\s*"([^"]+)"/g,
      methodFrom: (m) => String(m[1] ?? "GET").toUpperCase(),
    },
  ];
  for (const { re, methodFrom, pathGroup } of patterns) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const raw = pathGroup != null ? match[pathGroup] : (match[2] ?? match[1] ?? "");
      const route = String(raw ?? "").trim();
      const normalized = route.startsWith("/") ? route : route ? `/${route}` : "";
      if (!normalized.startsWith("/")) continue;
      if (normalized.includes("${") || normalized.includes("*") || normalized.includes("("))
        continue;
      out.push({
        method: methodFrom?.(match) ?? "GET",
        path: normalized,
        line: lineAt(text, match.index),
      });
    }
  }
  return out.slice(0, 80);
}

export function extractComposeServices(
  path: string,
  text: string,
): Array<{ name: string; line: number }> {
  if (!/(^|\/)docker-compose\.ya?ml$/i.test(path) && !/(^|\/)compose\.ya?ml$/i.test(path)) {
    return [];
  }
  const out: Array<{ name: string; line: number }> = [];
  const lines = text.split("\n");
  let inServices = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices && /^\S/.test(line) && !/^\s/.test(line)) break;
    if (inServices) {
      const hit = line.match(/^ {2}([A-Za-z0-9._-]+):\s*$/);
      if (hit?.[1]) out.push({ name: hit[1], line: i + 1 });
    }
  }
  return out.slice(0, 40);
}

export const ORIENT_TOOL: ExtraToolDef = {
  name: "orient",
  description:
    "Return the ambient brain docs: services, APIs, and distilled memory for this repo. Call first, and again after compact.",
  parameters: { type: "object", properties: {} },
};

export const FIND_ENTITY_TOOL: ExtraToolDef = {
  name: "find_entity",
  description:
    "Look up a service, API, or concept in the brain by name, id, or phrase. Prefer one call with q (comma-separated for a few lookups).",
  parameters: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description: "Name, id, or phrase (comma-separated for a few lookups).",
      },
      type: { type: "string", description: "Optional node type such as Service or APIEndpoint." },
      limit: { type: "string", description: "Max matches (1–50, default 10)." },
    },
    required: ["q"],
  },
};

export const GET_ENTITY_TOOL: ExtraToolDef = {
  name: "get_entity",
  description: "Read a brain entity card: properties, evidence, and edges.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Entity id from find_entity or orient." },
    },
    required: ["id"],
  },
};

export const SEARCH_KNOWLEDGE_TOOL: ExtraToolDef = {
  name: "search_knowledge",
  description:
    "Search distilled memory and the graph like grep: symptoms, identifiers, command names, file paths.",
  parameters: {
    type: "object",
    properties: {
      q: { type: "string", description: "Search text." },
    },
    required: ["q"],
  },
};

export const CORRECT_GRAPH_TOOL: ExtraToolDef = {
  name: "correct_graph",
  description:
    "Flag a wrong brain claim for the operator Inbox. Pass nodeId or memoryId plus reason. Does not mutate the graph until someone Accepts it.",
  parameters: {
    type: "object",
    properties: {
      nodeId: { type: "string", description: "Entity id from find_entity or get_entity." },
      memoryId: { type: "string", description: "Memory id (mem:…) from orient or search." },
      reason: { type: "string", description: "What is wrong, in one sentence." },
      claim: { type: "string", description: "Optional replacement wording." },
    },
    required: ["reason"],
  },
};

export const BRAIN_BRIEF_TOOL: ExtraToolDef = {
  name: "brain_brief",
  description:
    "Draft a short brain briefing (owning service, file:line evidence, decisions) for a Jira or Linear issue and post it as a comment. Pass issue (key or URL). Optional target jira|linear, title, and summary. The comment is shown for Approve before it is posted. Host-side.",
  parameters: {
    type: "object",
    properties: {
      issue: { type: "string", description: "Issue key (ENG-12) or Jira/Linear URL." },
      target: { type: "string", description: "jira or linear. Inferred from a URL when omitted." },
      title: { type: "string", description: "Issue title, when already known." },
      summary: { type: "string", description: "Issue summary, when already known." },
    },
    required: ["issue"],
  },
};

export const BRAIN_READ_TOOLS: ExtraToolDef[] = [
  ORIENT_TOOL,
  FIND_ENTITY_TOOL,
  GET_ENTITY_TOOL,
  SEARCH_KNOWLEDGE_TOOL,
  CORRECT_GRAPH_TOOL,
];

export type BrainBriefTarget = "jira" | "linear";

export function parseBrainBriefIssue(raw: string): { issue: string; target?: BrainBriefTarget } {
  const text = raw.trim();
  const linear = text.match(/linear\.app\/[^/\s]+\/issue\/([A-Z][A-Z0-9]+-\d+)/i);
  if (linear?.[1]) return { issue: linear[1].toUpperCase(), target: "linear" };
  const jira = text.match(/atlassian\.net\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
  if (jira?.[1]) return { issue: jira[1].toUpperCase(), target: "jira" };
  const key = text.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  if (key?.[1]) return { issue: key[1].toUpperCase() };
  return { issue: text };
}

export function issueFieldsFromToolOutput(output: string): { title?: string; summary?: string } {
  try {
    const json = JSON.parse(output) as Record<string, unknown>;
    const fields =
      json.fields && typeof json.fields === "object"
        ? (json.fields as Record<string, unknown>)
        : json;
    const title =
      textField(fields.summary) || textField(fields.title) || textField(json.title) || undefined;
    const description = fields.description ?? json.description;
    const summary =
      typeof description === "string" ? description.trim() : adfPlainText(description).trim();
    return { title, summary: summary || undefined };
  } catch {
    return {};
  }
}

export function formatBrainIssueBrief(input: {
  issue: string;
  title?: string;
  summary?: string;
  doc: BrainDocument;
}): string {
  const query = [input.title, input.summary].filter(Boolean).join(" ");
  const tokens = briefTokens(query, input.issue);
  const service = owningService(input.doc, tokens);
  const evidence = briefEvidence(input.doc, tokens, service);
  const decisions = briefDecisions(input.doc, tokens);
  const lines = [`Brain briefing for ${input.issue}`];
  if (input.title?.trim()) lines.push(input.title.trim());
  lines.push("", "Owning service");
  if (service) {
    const about = service.description ? ` — ${service.description}` : "";
    const ev = service.evidence ? ` (${service.evidence})` : "";
    lines.push(`${service.name}${about}${ev}`);
  } else {
    lines.push("No owning service in the brain.");
  }
  lines.push("", "Evidence");
  if (evidence.length) {
    for (const row of evidence) lines.push(`- ${row}`);
  } else {
    lines.push("No file evidence.");
  }
  lines.push("", "Decisions");
  if (decisions.length) {
    for (const row of decisions) lines.push(`- ${row}`);
  } else {
    lines.push("No matching decisions.");
  }
  return lines.join("\n");
}

export function applyBrainBriefApprovalBody(
  name: string,
  args: Record<string, unknown> | undefined,
  answer?: string,
): Record<string, unknown> | undefined {
  if (name !== "brain_brief") return args;
  const body = answer?.trim();
  if (!body) return args;
  return { ...(args ?? {}), body };
}

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function adfPlainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const rec = node as { text?: unknown; content?: unknown };
  const own = textField(rec.text);
  const kids = Array.isArray(rec.content)
    ? rec.content.map((child) => adfPlainText(child)).filter(Boolean)
    : [];
  return [own, ...kids].filter(Boolean).join(" ");
}

function briefTokens(query: string, issue: string): string[] {
  const prefix = issue.match(/^([A-Za-z][A-Za-z0-9]+)-\d+$/)?.[1]?.toLowerCase();
  const skip = new Set(prefix ? [prefix] : []);
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3 && !skip.has(token)),
    ),
  ];
}

function tokenScore(hay: string, tokens: string[]): number {
  if (!tokens.length) return 0;
  const text = hay.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (text.includes(token)) score += token.length >= 5 ? 2 : 1;
  }
  return score;
}

function nodeHay(node: BrainNode): string {
  return `${node.name} ${node.aliases?.join(" ") ?? ""} ${node.description ?? ""} ${node.evidence ?? ""}`;
}

function owningService(doc: BrainDocument, tokens: string[]): BrainNode | undefined {
  const services = doc.nodes.filter((row) => row.type === "Service");
  const ranked = services
    .map((node) => ({ node, score: tokenScore(nodeHay(node), tokens) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name));
  if (ranked[0]) return ranked[0].node;
  const endpointIds = new Set(
    doc.nodes
      .filter((row) => row.type === "APIEndpoint" && tokenScore(nodeHay(row), tokens) > 0)
      .map((row) => row.id),
  );
  if (!endpointIds.size) return undefined;
  const ownerId = doc.edges.find(
    (edge) => edge.type === "OWNS" && (endpointIds.has(edge.to) || endpointIds.has(edge.from)),
  );
  if (!ownerId) return undefined;
  const id = endpointIds.has(ownerId.to) ? ownerId.from : ownerId.to;
  return services.find((row) => row.id === id);
}

function briefEvidence(doc: BrainDocument, tokens: string[], service?: BrainNode): string[] {
  const lines: string[] = [];
  const push = (label: string, evidence?: string) => {
    if (!evidence?.trim()) return;
    const line = `${label} — ${evidence.trim()}`;
    if (lines.includes(line) || lines.length >= 5) return;
    lines.push(line);
  };
  if (service) push(service.name, service.evidence);
  const ranked = doc.nodes
    .filter((row) => row.id !== service?.id && row.evidence && tokenScore(nodeHay(row), tokens) > 0)
    .sort(
      (a, b) =>
        tokenScore(nodeHay(b), tokens) - tokenScore(nodeHay(a), tokens) ||
        a.name.localeCompare(b.name),
    );
  for (const node of ranked) push(node.name, node.evidence);
  return lines;
}

function briefDecisions(doc: BrainDocument, tokens: string[]): string[] {
  return doc.memories
    .filter((row) => row.kind === "decision" && row.contradictionCount === 0)
    .map((row) => ({ claim: row.claim.trim(), score: tokenScore(row.claim, tokens) }))
    .filter((row) => row.claim && row.score > 0)
    .sort((a, b) => b.score - a.score || a.claim.localeCompare(b.claim))
    .slice(0, 4)
    .map((row) => row.claim);
}

export function brainMcpTools(): Array<{
  name: string;
  description: string;
  inputSchema: ExtraToolDef["parameters"];
}> {
  return [
    {
      name: ORIENT_TOOL.name,
      description: ORIENT_TOOL.description,
      inputSchema: ORIENT_TOOL.parameters,
    },
    {
      name: SEARCH_KNOWLEDGE_TOOL.name,
      description: SEARCH_KNOWLEDGE_TOOL.description,
      inputSchema: SEARCH_KNOWLEDGE_TOOL.parameters,
    },
    {
      name: "remember",
      description:
        "Save a durable conclusion into the Locus brain. Send the text; the distiller files it. Do not store secrets.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The thing to remember." },
          action: {
            type: "string",
            description: "Optional. add is the default for this MCP tool.",
          },
        },
        required: ["text"],
      },
    },
  ];
}

export function formatFindEntities(result: { status: string; matches: BrainNode[] }): string {
  if (!result.matches.length) return "No matches.";
  return result.matches
    .map((row) => {
      const bits = [row.type, row.id, row.name];
      if (row.description) bits.push("—", row.description);
      if (row.evidence) bits.push(`[${row.evidence}]`);
      return bits.join(" ");
    })
    .join("\n");
}

function typeOk(row: BrainNode, type?: string): boolean {
  if (!type?.trim()) return true;
  return row.type.toLowerCase() === type.trim().toLowerCase();
}

function entityMatches(row: BrainNode, q: string): boolean {
  const tokens = tokenize(q);
  if (!tokens.length) return false;
  const hay =
    `${row.id} ${row.name} ${row.aliases?.join(" ") ?? ""} ${row.description ?? ""} ${row.evidence ?? ""}`.toLowerCase();
  return tokens.every((token) => hay.includes(token));
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

function scoreHay(hay: string, tokens: string[]): number {
  const lower = hay.toLowerCase();
  let n = 0;
  for (const token of tokens) {
    if (lower.includes(token)) n += 1;
  }
  return n === 0 ? 0 : n / tokens.length;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const next = value.trim();
    if (!next) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out.slice(0, 12);
}

function stamp(
  doc: BrainDocument,
  patch: Partial<
    Pick<BrainDocument, "nodes" | "edges" | "memories" | "corpus" | "repos" | "activity">
  >,
  actor: string,
  verb: string,
  detail: string,
  at: string,
): BrainDocument {
  return {
    ...doc,
    ...patch,
    journal: [...doc.journal, { at, verb, actor, detail }].slice(-2000),
    updatedAt: at,
  };
}

function sameRepo(a: string, b: string): boolean {
  return normalizeRepoUrl(a) === normalizeRepoUrl(b);
}

function pkgNameFromClaims(claims: ExtractedClaim[]): string | undefined {
  return claims.find((row) => row.type === "Service")?.name;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h;
}
