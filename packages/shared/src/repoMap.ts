import { repoMapPathSkipped } from "./workspaceSkip.js";

export interface RepoMapFile {
  path: string;
  bytes?: number;
  symbols: string[];
}

export interface RepoMap {
  files: RepoMapFile[];
  truncated?: boolean;
}

export type RepoIndexHit = {
  path: string;
  kind: "file" | "symbol";
  symbol?: string;
  score: number;
};

export const DEFAULT_REPO_SEARCH_LIMIT = 50;

export const DEFAULT_REPO_MAP_CHARS = 12_000;
const MAX_SYMBOLS_PER_FILE = 24;
const MAX_FILES = 400;
const MAX_PROMPT_TOKENS = 8;

const PROMPT_STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "please",
  "can",
  "you",
  "your",
  "into",
  "just",
  "want",
  "need",
  "also",
  "have",
  "will",
  "would",
  "could",
  "should",
  "about",
  "after",
  "before",
  "these",
  "those",
  "here",
  "there",
  "what",
  "when",
  "where",
  "which",
  "while",
  "using",
  "then",
  "than",
  "not",
  "but",
  "are",
  "was",
  "were",
  "been",
  "being",
  "does",
  "did",
  "how",
  "why",
  "get",
  "got",
  "let",
  "keep",
  "show",
  "see",
  "look",
  "find",
  "make",
  "add",
  "new",
  "old",
  "all",
  "any",
  "our",
  "out",
  "over",
  "some",
  "them",
  "they",
  "fix",
  "set",
  "run",
  "use",
  "via",
  "per",
  "continue",
  "implement",
  "review",
  "change",
  "update",
  "create",
  "build",
  "write",
  "code",
  "file",
  "files",
]);

/** Identifiers from a user prompt to rank the repo map. */
export function repoMapPromptQuery(text: string): string | undefined {
  const tokens: string[] = [];
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9_.-]{2,}/g)) {
    const token = match[0]!;
    if (PROMPT_STOP.has(token.toLowerCase())) continue;
    if (tokens.some((item) => item.toLowerCase() === token.toLowerCase())) continue;
    tokens.push(token);
    if (tokens.length >= MAX_PROMPT_TOKENS) break;
  }
  return tokens.length ? tokens.join(" ") : undefined;
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((token) => token.length >= 3);
}

function fileMatchesQuery(file: RepoMapFile, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const path = file.path.toLowerCase();
  return tokens.some(
    (token) =>
      path.includes(token) || file.symbols.some((symbol) => symbol.toLowerCase().includes(token)),
  );
}

export type RepoSymbol = { name: string; line: number };

export function extractSymbolLocations(
  path: string,
  source: string,
  opts: { limit?: number } = {},
): RepoSymbol[] {
  const ext = extension(path);
  const text = source.length > 80_000 ? source.slice(0, 80_000) : source;
  const cap = Math.max(1, Math.min(opts.limit ?? MAX_SYMBOLS_PER_FILE, 400));
  const found: RepoSymbol[] = [];
  const seen = new Set<string>();
  const push = (name?: string, index = 0) => {
    const clean = (name ?? "").trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    const line = text.slice(0, Math.max(0, index)).split("\n").length;
    found.push({ name: clean, line });
  };

  if (ext === "py") {
    for (const match of text.matchAll(/^[ \t]*class\s+([A-Za-z_][\w]*)/gm))
      push(match[1], match.index);
    for (const match of text.matchAll(/^[ \t]*(?:async\s+)?def\s+([A-Za-z_][\w]*)/gm))
      push(match[1], match.index);
  } else if (ext === "go") {
    for (const match of text.matchAll(/^type\s+([A-Za-z_][\w]*)/gm)) push(match[1], match.index);
    for (const match of text.matchAll(/^func\s+(?:\([^)]+\)\s*)?([A-Za-z_][\w]*)/gm))
      push(match[1], match.index);
  } else if (ext === "rs") {
    for (const match of text.matchAll(/^(?:pub\s+)?(?:struct|enum|trait|mod)\s+([A-Za-z_][\w]*)/gm))
      push(match[1], match.index);
    for (const match of text.matchAll(/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/gm))
      push(match[1], match.index);
  } else if (ext === "java" || ext === "kt") {
    for (const match of text.matchAll(/\b(?:class|interface|enum|object)\s+([A-Za-z_][\w]*)/g))
      push(match[1], match.index);
    for (const match of text.matchAll(
      /\b(?:fun|void|int|string|boolean)\s+([A-Za-z_][\w]*)\s*\(/gi,
    ))
      push(match[1], match.index);
  } else if (ext === "rb") {
    for (const match of text.matchAll(/^[ \t]*module\s+([A-Za-z_][\w]*)/gm))
      push(match[1], match.index);
    for (const match of text.matchAll(/^[ \t]*class\s+([A-Za-z_][\w]*)/gm))
      push(match[1], match.index);
    for (const match of text.matchAll(/^[ \t]*def\s+(?:self\.)?([A-Za-z_][\w]*[!?]?)/gm))
      push(match[1], match.index);
  } else if (ext === "php") {
    for (const match of text.matchAll(
      /\b(?:class|interface|trait|enum|function)\s+([A-Za-z_][\w]*)/g,
    ))
      push(match[1], match.index);
  } else if (ext === "cs") {
    for (const match of text.matchAll(
      /\b(?:class|interface|struct|enum|record|namespace)\s+([A-Za-z_][\w]*)/g,
    ))
      push(match[1], match.index);
  } else if (ext === "swift") {
    for (const match of text.matchAll(
      /\b(?:class|struct|enum|protocol|actor|func|extension)\s+([A-Za-z_][\w]*)/g,
    ))
      push(match[1], match.index);
  } else if (["c", "h", "cc", "cpp", "cxx", "hpp", "hh"].includes(ext)) {
    for (const match of text.matchAll(
      /^[ \t]*(?:typedef\s+)?(?:struct|enum|union|class)\s+([A-Za-z_]\w*)/gm,
    ))
      push(match[1], match.index);
    for (const match of text.matchAll(
      /^[ \t]*(?:(?:static|inline|extern|unsigned|signed|const|volatile)\s+)*[A-Za-z_]\w*(?:\s*\*+)?\s+([A-Za-z_]\w*)\s*\(/gm,
    ))
      push(match[1], match.index);
  } else {
    for (const match of text.matchAll(
      /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][\w]*)|(?:export\s+)?class\s+([A-Za-z_][\w]*)|export\s+(?:const|let|var|type|interface|enum)\s+([A-Za-z_][\w]*)|([A-Za-z_][\w]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>/g,
    )) {
      push(match[1] || match[2] || match[3] || match[4], match.index);
    }
  }
  found.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return found.slice(0, cap);
}

export function extractSymbols(path: string, source: string): string[] {
  return extractSymbolLocations(path, source).map((row) => row.name);
}

/**
 * Parse `ctags -x` (`name kind line path extras`) into path → symbol names.
 * Used when universal-ctags / exuberant-ctags is on PATH; regex extractors stay the fallback.
 */
export function parseCtagsXOutput(text: string): Map<string, { name: string; line: number }[]> {
  const out = new Map<string, { name: string; line: number }[]>();
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const match = line.match(/^(\S+)\s+\S+\s+(\d+)\s+(\S+)/);
    if (!match) continue;
    const name = match[1];
    const lineno = Number(match[2]);
    const file = normalizeRepoPath((match[3] ?? "").replace(/^\.\//, ""));
    if (!name || !file || !Number.isFinite(lineno) || lineno < 1) continue;
    const rows = out.get(file) ?? [];
    if (!rows.some((row) => row.name === name && row.line === lineno)) {
      rows.push({ name, line: lineno });
      out.set(file, rows);
    }
  }
  return out;
}

/** Higher ranks are extracted first when the symbol budget is tight. */
export function repoSymbolFilePriority(path: string): number {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  let n = 0;
  if (/(^|\/)(src|lib|app|apps|packages|components|server|core|shared)\//.test(lower)) n += 80;
  if (/\.(test|spec)\./.test(lower)) n -= 50;
  if (/(^|\/)(test|tests|__tests__|spec|e2e|fixtures|docs|examples|vendor)\//.test(lower)) n -= 60;
  n -= lower.split("/").filter(Boolean).length * 3;
  return n;
}

export function pickSymbolFiles(paths: string[], limit: number): string[] {
  const cap = Math.max(0, Math.floor(limit));
  return [...paths]
    .sort((a, b) => repoSymbolFilePriority(b) - repoSymbolFilePriority(a) || a.localeCompare(b))
    .slice(0, cap);
}

export function buildRepoMap(
  files: Array<{ path: string; bytes?: number; content?: string }>,
  opts: { maxFiles?: number } = {},
): RepoMap {
  const maxFiles = opts.maxFiles ?? MAX_FILES;
  const out: RepoMapFile[] = [];
  let truncated = false;
  for (const file of files) {
    const path = normalizeRepoPath(file.path);
    if (!path || repoMapPathSkipped(path)) continue;
    if (out.length >= maxFiles) {
      truncated = true;
      break;
    }
    out.push({
      path,
      bytes: file.bytes,
      symbols: typeof file.content === "string" ? extractSymbols(path, file.content) : [],
    });
  }
  return { files: out, truncated: truncated || undefined };
}

export function formatRepoMap(
  map: RepoMap,
  opts: { query?: string; path?: string; maxChars?: number; rank?: boolean; focus?: string } = {},
): string {
  const maxChars = opts.maxChars ?? DEFAULT_REPO_MAP_CHARS;
  const query = (opts.query ?? "").trim();
  const tokens = queryTokens(query);
  const prefix = normalizeRepoPath(opts.path ?? "");
  const focus = normalizeRepoPath(opts.focus ?? "");
  const scoped = map.files.filter((file) => {
    if (prefix && file.path !== prefix && !file.path.startsWith(`${prefix}/`)) return false;
    return true;
  });
  const matched = tokens.length ? scoped.filter((file) => fileMatchesQuery(file, tokens)) : scoped;
  let rows =
    opts.rank && tokens.length
      ? [...matched, ...scoped.filter((file) => !matched.includes(file))]
      : matched;
  if (focus) rows = boostFocus(rows, focus);
  const lines: string[] = [];
  const focusNote = focus ? ` Open file ${focus} listed first.` : "";
  if (opts.rank && tokens.length) {
    lines.push(
      focus
        ? `Repo map (${scoped.length} files${map.truncated ? ", truncated" : ""}).${focusNote} Likely relevant for "${query}" listed next. Prefer grep/file_read on those paths.`
        : `Repo map (${scoped.length} files${map.truncated ? ", truncated" : ""}). Likely relevant for "${query}" listed first. Prefer grep/file_read on those paths.`,
    );
  } else if (query || prefix) {
    lines.push(
      `Repo map filter: ${[prefix && `path ${prefix}`, query && `query ${query}`].filter(Boolean).join(", ")}${focusNote}`,
    );
  } else {
    lines.push(
      `Repo map (${rows.length} files${map.truncated ? ", truncated" : ""}).${focusNote} Prefer grep/file_read on these paths instead of dumping files.`,
    );
  }
  for (const file of rows) {
    const symbols = file.symbols.length ? `  ${file.symbols.slice(0, 12).join(", ")}` : "";
    lines.push(`${file.path}${symbols}`);
    if (lines.join("\n").length > maxChars) {
      lines.pop();
      lines.push("…[repo map truncated]");
      break;
    }
  }
  if (rows.length === 0) lines.push("(no matching files)");
  return lines.join("\n");
}

/** Ranked file and symbol hits for Quick Open / Go to file. */
export function searchRepoMap(
  map: RepoMap,
  query: string,
  opts: { limit?: number } = {},
): RepoIndexHit[] {
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_REPO_SEARCH_LIMIT, 200));
  const q = query.trim();
  if (!q) {
    return [...map.files]
      .sort(
        (a, b) =>
          a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path),
      )
      .slice(0, limit)
      .map((file) => ({ path: file.path, kind: "file" as const, score: 1 }));
  }
  const hits: RepoIndexHit[] = [];
  for (const file of map.files) {
    const pathScore = fuzzyScore(file.path, q);
    const baseScore = fuzzyScore(basename(file.path), q);
    const fileScore = Math.max(pathScore, baseScore > 0 ? baseScore + 8 : 0);
    if (fileScore > 0) {
      hits.push({ path: file.path, kind: "file", score: fileScore + searchPathBonus(file.path) });
    }
    for (const symbol of file.symbols) {
      const symbolScore = fuzzyScore(symbol, q);
      if (symbolScore <= 0) continue;
      hits.push({
        path: file.path,
        kind: "symbol",
        symbol,
        score: symbolScore + 4 + searchPathBonus(file.path),
      });
    }
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.path.localeCompare(b.path) ||
      (a.symbol ?? "").localeCompare(b.symbol ?? ""),
  );
  const seen = new Set<string>();
  const out: RepoIndexHit[] = [];
  for (const hit of hits) {
    const key = `${hit.kind}:${hit.path}:${hit.symbol ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

export function normalizeRepoPath(raw: string): string {
  let path = raw.trim().replace(/\\/g, "/");
  if (path.startsWith("/workspace/")) path = path.slice("/workspace/".length);
  if (path === "/workspace") path = "";
  path = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (path.includes("\0") || path.split("/").some((part) => part === "." || part === ".."))
    return "";
  return path.slice(0, 512);
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function parentDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

function boostFocus(files: RepoMapFile[], focus: string): RepoMapFile[] {
  const dir = parentDir(focus);
  const picked: RepoMapFile[] = [];
  const nearby: RepoMapFile[] = [];
  const rest: RepoMapFile[] = [];
  for (const file of files) {
    if (file.path === focus) picked.push(file);
    else if (
      dir &&
      file.path.startsWith(`${dir}/`) &&
      !file.path.slice(dir.length + 1).includes("/")
    ) {
      nearby.push(file);
    } else rest.push(file);
  }
  return [...picked, ...nearby, ...rest];
}

function searchPathBonus(path: string): number {
  const lower = path.toLowerCase();
  let n = 0;
  if (/(^|\/)(src|lib|app|apps|packages|components)\//.test(lower)) n += 6;
  if (/\.(test|spec)\./.test(lower) || /(^|\/)(test|tests|__tests__|fixtures|docs)\//.test(lower))
    n -= 12;
  return n;
}

/** Word / camelCase starts from the file stem: foldOldTurns → fot, workspaceGrep.ts → wg. */
export function wordStarts(text: string): string {
  const base = text.replace(/\\/g, "/").split("/").pop() ?? text;
  const stem = base.includes(".") ? base.slice(0, base.indexOf(".")) : base;
  let out = "";
  for (let i = 0; i < stem.length; i += 1) {
    const ch = stem[i]!;
    const prev = i === 0 ? "" : stem[i - 1]!;
    const isWord = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
    if (!isWord) continue;
    if (
      i === 0 ||
      prev === "_" ||
      prev === "-" ||
      (prev >= "a" && prev <= "z" && ch >= "A" && ch <= "Z")
    ) {
      out += ch.toLowerCase();
    }
  }
  return out;
}

/** Consecutive and path-separator-aware subsequence score; 0 means no match. */
export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q || !t) return 0;
  if (t === q) return 200;
  if (t.startsWith(q)) return 170;
  const starts = wordStarts(text);
  if (q.length >= 2 && starts === q) return 165;
  if (q.length >= 2 && starts.startsWith(q)) return 155;
  const idx = t.indexOf(q);
  if (idx >= 0) return Math.max(40, 140 - idx * 2);
  if (q.length >= 2 && starts.includes(q)) return 118;
  let ti = 0;
  let score = 0;
  let consecutive = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    consecutive = found === ti ? consecutive + 1 : 1;
    score += consecutive > 1 ? 10 : 3;
    const prev = found === 0 ? "" : t[found - 1]!;
    if (found === 0 || prev === "/" || prev === "." || prev === "_" || prev === "-") score += 14;
    ti = found + 1;
  }
  return Math.max(1, Math.round(score - t.length * 0.08));
}

function extension(path: string): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}
