import { fuzzyScore } from "@locus/shared";
import type { WorkspaceEntry, WorkspaceFileChange } from "./api";

export type WorkspaceTreeNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children: WorkspaceTreeNode[];
};

export type WorkspaceFlatRow = {
  name: string;
  path: string;
  type: "file" | "dir";
  depth: number;
  hasChildren: boolean;
};

/** Visible explorer rows: open folders, or every match while filtering. */
export function flattenVisibleWorkspaceRows(
  nodes: WorkspaceTreeNode[],
  expanded: ReadonlySet<string>,
  filtering: boolean,
): WorkspaceFlatRow[] {
  const out: WorkspaceFlatRow[] = [];
  const walk = (node: WorkspaceTreeNode, depth: number) => {
    out.push({
      name: node.name,
      path: node.path,
      type: node.type,
      depth,
      hasChildren: node.type === "dir" && node.children.length > 0,
    });
    if (node.type === "dir" && (filtering || expanded.has(node.path))) {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  for (const node of nodes) walk(node, 0);
  return out;
}

export function buildWorkspaceTree(entries: WorkspaceEntry[]): WorkspaceTreeNode[] {
  const root: WorkspaceTreeNode[] = [];
  const byPath = new Map<string, WorkspaceTreeNode>();

  function ensureDir(path: string): WorkspaceTreeNode {
    const existing = byPath.get(path);
    if (existing) return existing;
    const name = path.split("/").pop() ?? path;
    const node: WorkspaceTreeNode = { name, path, type: "dir", children: [] };
    byPath.set(path, node);
    const slash = path.lastIndexOf("/");
    if (slash === -1) root.push(node);
    else ensureDir(path.slice(0, slash)).children.push(node);
    return node;
  }

  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    if (!entry.path || entry.path === ".") continue;
    if (entry.type === "dir") {
      ensureDir(entry.path);
      continue;
    }
    if (byPath.has(entry.path)) continue;
    const node: WorkspaceTreeNode = {
      name: entry.name || (entry.path.split("/").pop() ?? entry.path),
      path: entry.path,
      type: "file",
      children: [],
    };
    byPath.set(entry.path, node);
    const slash = entry.path.lastIndexOf("/");
    if (slash === -1) root.push(node);
    else ensureDir(entry.path.slice(0, slash)).children.push(node);
  }

  function sortNodes(nodes: WorkspaceTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) sortNodes(node.children);
  }
  sortNodes(root);
  return root;
}

/** Cap expanded filter hits so a 1–2 character query cannot mount the whole workspace. */
export const WORKSPACE_FILTER_MAX_NODES = 400;

export function countWorkspaceTreeNodes(nodes: WorkspaceTreeNode[]): number {
  let n = 0;
  const walk = (node: WorkspaceTreeNode) => {
    n += 1;
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return n;
}

/**
 * Match a file by basename substring, camelCase/word-start fuzzy, an exact
 * ancestor folder name, or a path query that contains `/`. Short queries must
 * not treat `apps` as a hit for `app` and then dump that folder's entire subtree
 * into the DOM.
 */
export function workspaceTreeQueryHits(name: string, path: string, q: string): boolean {
  if (name.toLowerCase().includes(q)) return true;
  const pathL = path.toLowerCase();
  if (q.includes("/")) return pathL.includes(q);
  const parts = pathL.split("/");
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i] === q) return true;
  }
  return q.length >= 2 && fuzzyScore(name, q) > 0;
}

export function workspaceTreeQueryScore(name: string, path: string, q: string): number {
  if (!workspaceTreeQueryHits(name, path, q)) return 0;
  const base = fuzzyScore(name, q);
  const full = fuzzyScore(path, q);
  return Math.max(base > 0 ? base + 8 : 0, full);
}

export function filterWorkspaceTree(
  nodes: WorkspaceTreeNode[],
  query: string,
  maxNodes = WORKSPACE_FILTER_MAX_NODES,
): WorkspaceTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const hits: Array<{ name: string; path: string; score: number }> = [];
  const walk = (node: WorkspaceTreeNode) => {
    if (node.type === "file") {
      const score = workspaceTreeQueryScore(node.name, node.path, q);
      if (score > 0) hits.push({ name: node.name, path: node.path, score });
      return;
    }
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  if (hits.length === 0) return collectExactFolderHits(nodes, q);

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const picked: Array<{ name: string; path: string; type: "file" }> = [];
  const dirs = new Set<string>();
  for (const hit of hits) {
    const parts = hit.path.split("/");
    const extra: string[] = [];
    for (let i = 1; i < parts.length; i += 1) {
      const dir = parts.slice(0, i).join("/");
      if (!dirs.has(dir)) extra.push(dir);
    }
    if (picked.length && dirs.size + picked.length + extra.length + 1 > maxNodes) break;
    for (const dir of extra) dirs.add(dir);
    picked.push({ name: hit.name, path: hit.path, type: "file" });
  }
  return buildWorkspaceTree(picked);
}

function collectExactFolderHits(nodes: WorkspaceTreeNode[], q: string): WorkspaceTreeNode[] {
  const out: WorkspaceTreeNode[] = [];
  const walk = (node: WorkspaceTreeNode) => {
    if (node.type === "dir" && node.name.toLowerCase() === q) {
      out.push({ ...node, children: [] });
      return;
    }
    if (node.type === "dir") {
      for (const child of node.children) walk(child);
    }
  };
  for (const node of nodes) walk(node);
  return out;
}

export function workspaceEntriesForMode(
  entries: WorkspaceEntry[],
  changes: WorkspaceFileChange[],
  mode: "all" | "updated",
): WorkspaceEntry[] {
  if (mode !== "updated") return entries;
  const changed = new Set(changes.map((row) => row.path));
  if (changed.size === 0) return [];
  const keep = entries.filter((entry) => {
    if (entry.type === "dir") {
      const prefix = `${entry.path}/`;
      for (const path of changed) {
        if (path === entry.path || path.startsWith(prefix)) return true;
      }
      return false;
    }
    return changed.has(entry.path);
  });
  const have = new Set(keep.map((entry) => entry.path));
  const extra: WorkspaceEntry[] = [];
  for (const row of changes) {
    if (have.has(row.path)) continue;
    extra.push({
      name: row.path.split("/").pop() || row.path,
      path: row.path,
      type: "file",
    });
  }
  return [...keep, ...extra];
}

export function changeStatsForPath(
  path: string,
  type: "file" | "dir",
  byPath: ReadonlyMap<string, WorkspaceFileChange>,
): WorkspaceFileChange | undefined {
  if (type === "file") return byPath.get(path);
  let additions = 0;
  let deletions = 0;
  let hit = false;
  const prefix = `${path}/`;
  for (const [filePath, row] of byPath) {
    if (filePath === path || filePath.startsWith(prefix)) {
      hit = true;
      additions += row.additions;
      deletions += row.deletions;
    }
  }
  return hit ? { path, additions, deletions } : undefined;
}

export function rollupChangeStats(
  changes: WorkspaceFileChange[],
): Map<string, WorkspaceFileChange> {
  const out = new Map<string, WorkspaceFileChange>();
  for (const row of changes) {
    out.set(row.path, { path: row.path, additions: row.additions, deletions: row.deletions });
    const parts = row.path.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const dir = parts.slice(0, i).join("/");
      const prev = out.get(dir);
      if (prev) {
        prev.additions += row.additions;
        prev.deletions += row.deletions;
      } else {
        out.set(dir, { path: dir, additions: row.additions, deletions: row.deletions });
      }
    }
  }
  return out;
}

export function sameWorkspaceEntries(a: WorkspaceEntry[], b: WorkspaceEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]!.path !== b[i]!.path || a[i]!.type !== b[i]!.type || a[i]!.name !== b[i]!.name) {
      return false;
    }
  }
  return true;
}

/** Hidden / cache folders the root listing shows but does not walk. */
export function dirsNeedingWorkspaceListing(
  entries: readonly WorkspaceEntry[],
  expanded: ReadonlySet<string>,
): string[] {
  const have = new Set(entries.filter((row) => row.type === "dir").map((row) => row.path));
  const withChildren = new Set<string>();
  for (const row of entries) {
    const slash = row.path.lastIndexOf("/");
    if (slash !== -1) withChildren.add(row.path.slice(0, slash));
  }
  const out: string[] = [];
  for (const path of expanded) {
    if (!path || !have.has(path) || withChildren.has(path)) continue;
    out.push(path);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function mergeWorkspaceEntries(
  base: readonly WorkspaceEntry[],
  extra: readonly WorkspaceEntry[],
): WorkspaceEntry[] {
  if (extra.length === 0) return [...base];
  const byPath = new Map<string, WorkspaceEntry>();
  for (const row of base) byPath.set(row.path, row);
  for (const row of extra) byPath.set(row.path, row);
  return [...byPath.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

export async function withExpandedWorkspaceListings(
  root: readonly WorkspaceEntry[],
  expanded: ReadonlySet<string>,
  list: (path: string) => Promise<readonly WorkspaceEntry[]>,
): Promise<WorkspaceEntry[]> {
  let entries: WorkspaceEntry[] = [...root];
  const seen = new Set<string>();
  for (let round = 0; round < 8; round += 1) {
    const need = dirsNeedingWorkspaceListing(entries, expanded).filter((path) => !seen.has(path));
    if (need.length === 0) return entries;
    for (const path of need) seen.add(path);
    const extras = await Promise.all(need.map((path) => list(path)));
    for (const extra of extras) entries = mergeWorkspaceEntries(entries, extra);
  }
  return entries;
}

export function sameWorkspaceChanges(a: WorkspaceFileChange[], b: WorkspaceFileChange[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.path !== y.path || x.additions !== y.additions || x.deletions !== y.deletions) {
      return false;
    }
  }
  return true;
}

export const MAX_HOT_WORKSPACE_DOCS = 24;

export type HotWorkspaceDoc = {
  path: string;
  content: string;
  original: string;
  kind?: string;
  baseline?: string;
  cold?: boolean;
};

/** Drop idle file buffers so many open tabs stay cheap. Never evicts the active or dirty doc. */
export function pruneHotWorkspaceDocs<T extends HotWorkspaceDoc>(
  docs: T[],
  activePath: string,
  keepPath?: string,
): T[] {
  const loaded = docs.filter(
    (doc) =>
      doc.path === activePath ||
      doc.path === keepPath ||
      (doc.kind !== "image" && doc.kind !== "pdf" && doc.content !== ""),
  );
  if (loaded.length <= MAX_HOT_WORKSPACE_DOCS) return docs;
  const drop: string[] = [];
  for (const doc of docs) {
    if (drop.length >= loaded.length - MAX_HOT_WORKSPACE_DOCS) break;
    if (doc.path === activePath || (keepPath && doc.path === keepPath)) continue;
    if (doc.kind === "image" || doc.kind === "pdf") continue;
    if (doc.cold || !doc.content || doc.content !== doc.original) continue;
    drop.push(doc.path);
  }
  if (drop.length === 0) return docs;
  const dropSet = new Set(drop);
  return docs.map((doc) =>
    dropSet.has(doc.path)
      ? { ...doc, content: "", original: "", baseline: undefined, cold: true }
      : doc,
  );
}

export function languageLabel(lang: string): string {
  const labels: Record<string, string> = {
    js: "JavaScript",
    ts: "TypeScript",
    jsx: "JavaScript (JSX)",
    tsx: "TypeScript (TSX)",
    json: "JSON",
    css: "CSS",
    scss: "SCSS",
    less: "Less",
    html: "HTML",
    xml: "XML",
    django: "Django template",
    python: "Python",
    go: "Go",
    rust: "Rust",
    java: "Java",
    ruby: "Ruby",
    php: "PHP",
    bash: "Shell",
    yaml: "YAML",
    docker: "Dockerfile",
    sql: "SQL",
    kotlin: "Kotlin",
    swift: "Swift",
    c: "C",
    cpp: "C++",
    csharp: "C#",
    toml: "TOML",
    markdown: "Markdown",
    ini: "INI",
    gitignore: "Ignore file",
    graphql: "GraphQL",
    proto: "Protocol Buffers",
    hcl: "HCL",
    lua: "Lua",
    dart: "Dart",
    powershell: "PowerShell",
    groovy: "Groovy",
    jenkins: "Jenkinsfile",
    prisma: "Prisma",
    cmake: "CMake",
    gomod: "Go module",
    elixir: "Elixir",
    scala: "Scala",
  };
  return labels[lang] ?? (lang ? lang.toUpperCase() : "Plain text");
}

export function dockerRuntimeLabel(image: string): string | undefined {
  const leaf = image.trim().split("/").pop() ?? "";
  if (!leaf) return undefined;
  const colon = leaf.indexOf(":");
  const name = colon === -1 ? leaf : leaf.slice(0, colon);
  const tag = colon === -1 ? "" : leaf.slice(colon + 1);
  if (name !== "node") return undefined;
  const ver = tag.match(/^(\d+(?:\.\d+)?)/);
  return ver ? `node ${ver[1]}` : "node";
}
