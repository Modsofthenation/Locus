import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { repoMapPathSkipped } from "@locus/shared";
import { resolveRipgrep } from "./workspaceGrep.js";
import { workspaceGitSnapshot } from "./gitPorcelain.js";

const execFileAsync = promisify(execFile);

export const GREP_INDEX_VERSION = 2;
export const GREP_NGRAM = 3;
export const AGENT_GREP_BYTE_CAP = 48_000;
const MAX_CANDIDATE_RATIO = 0.2;
const MAX_CANDIDATES = 4_000;
/** `{ files, grams, counts }`; posting ids live in the binary file, in gram order. */
const INDEX_FILE = "grep-index.json";
const POSTINGS_FILE = "grep-postings.bin";
const GREP_META_FILE = "grep-meta.json";
/** v1 kept every posting list in one JSON file that had to be re-parsed on every grep. */
const LEGACY_POSTINGS_FILE = "grep-postings.json";
const BUILD_FILE_CAP = 20_000;
const MAX_FILE_BYTES = 1_500_000;
/** Yield to the event loop this often while building so HTTP and agent turns keep moving. */
const BUILD_YIELD_EVERY = 16;
/** Indexes kept in memory across greps (least recently used is dropped first). */
const MEM_INDEX_MAX = 2;
/** Windows caps a whole command line at 32,767 chars; stay well under it per rg call. */
const MAX_RG_ARGV_CHARS = process.platform === "win32" ? 24_000 : 512_000;

export type GrepIndexMeta = {
  version: number;
  fileCount: number;
  builtAt: string;
  /** HEAD the index was built from. Dirty files are searched directly, so edits never stale it. */
  head?: string;
  unindexed?: string[];
};

export type GrepIndex = {
  files: string[];
  postings: Map<string, Uint32Array>;
  meta: GrepIndexMeta;
};

const memIndexes = new Map<string, GrepIndex>();
const inflightBuilds = new Map<string, Promise<GrepIndex | undefined>>();

function rememberIndex(cacheDir: string, index: GrepIndex): GrepIndex {
  memIndexes.delete(cacheDir);
  memIndexes.set(cacheDir, index);
  while (memIndexes.size > MEM_INDEX_MAX) {
    const oldest = memIndexes.keys().next().value;
    if (oldest === undefined) break;
    memIndexes.delete(oldest);
  }
  return index;
}

/** Drop the in-memory index for one session (or all, for tests). */
export function dropGrepIndex(cacheDir?: string): void {
  if (cacheDir) memIndexes.delete(cacheDir);
  else memIndexes.clear();
}

const yieldLoop = () => new Promise<void>((done) => setImmediate(done));

export function isOpenGrepPattern(pattern: string, regex = true): boolean {
  const alts = splitTopLevelAlts(pattern, regex);
  if (!alts.length) return true;
  return alts.some((alt) => grepLiterals(alt, regex).every((lit) => lit.length < GREP_NGRAM));
}

export function splitTopLevelAlts(pattern: string, regex = true): string[] {
  if (!regex || !pattern.includes("|")) return [pattern];
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  let cls = false;
  let escape = false;
  for (const ch of pattern) {
    if (escape) {
      buf += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      buf += ch;
      escape = true;
      continue;
    }
    if (ch === "[" && !cls) {
      cls = true;
      buf += ch;
      continue;
    }
    if (ch === "]" && cls) {
      cls = false;
      buf += ch;
      continue;
    }
    if (!cls && (ch === "(" || ch === "{")) {
      depth += 1;
      buf += ch;
      continue;
    }
    if (!cls && (ch === ")" || ch === "}")) {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (!cls && depth === 0 && ch === "|") {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) parts.push(buf);
  return parts.length ? parts : [pattern];
}

export function grepLiterals(pattern: string, regex = true): string[] {
  if (!regex) {
    const trimmed = pattern.trim();
    return trimmed ? [trimmed] : [];
  }
  const out: string[] = [];
  let buf = "";
  let cls = false;
  let escape = false;
  const flush = () => {
    if (buf.length) {
      out.push(buf);
      buf = "";
    }
  };
  for (const ch of pattern) {
    if (escape) {
      if (/[A-Za-z0-9_]/.test(ch)) buf += ch;
      else flush();
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === "[") {
      cls = true;
      flush();
      continue;
    }
    if (ch === "]" && cls) {
      cls = false;
      continue;
    }
    if (cls) continue;
    if (/[A-Za-z0-9_]/.test(ch)) {
      buf += ch;
      continue;
    }
    flush();
  }
  flush();
  return out;
}

export function trigrams(text: string): string[] {
  const grams = new Set<string>();
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  for (const tok of tokens) {
    if (tok.length < GREP_NGRAM) continue;
    for (let i = 0; i <= tok.length - GREP_NGRAM; i += 1) {
      grams.add(tok.slice(i, i + GREP_NGRAM));
    }
  }
  return [...grams];
}

export function filesForLiteral(index: GrepIndex, literal: string): number[] | undefined {
  const grams = trigrams(literal);
  if (!grams.length) return undefined;
  let current: Set<number> | undefined;
  for (const gram of grams) {
    const posting = index.postings.get(gram);
    if (!posting?.length) return [];
    if (!current) {
      current = new Set(posting);
      continue;
    }
    const next = new Set(posting);
    for (const id of current) {
      if (!next.has(id)) current.delete(id);
    }
    if (!current.size) return [];
  }
  return current ? [...current] : [];
}

export function candidateFileIds(
  index: GrepIndex,
  pattern: string,
  regex = true,
): number[] | undefined {
  if (isOpenGrepPattern(pattern, regex)) return undefined;
  const alts = splitTopLevelAlts(pattern, regex);
  const union = new Set<number>();
  for (const alt of alts) {
    const lits = grepLiterals(alt, regex).filter((lit) => lit.length >= GREP_NGRAM);
    if (!lits.length) return undefined;
    let inter: number[] | undefined;
    for (const lit of lits) {
      const files = filesForLiteral(index, lit);
      if (!files) return undefined;
      if (!inter) inter = files;
      else {
        const keep = new Set(files);
        inter = inter.filter((id) => keep.has(id));
      }
      if (!inter.length) break;
    }
    for (const id of inter ?? []) union.add(id);
  }
  return [...union];
}

/** Load an index from memory, or from disk once per process. */
export async function loadGrepIndex(cacheDir?: string): Promise<GrepIndex | undefined> {
  if (!cacheDir) return undefined;
  const hit = memIndexes.get(cacheDir);
  if (hit) return rememberIndex(cacheDir, hit);
  try {
    const meta = JSON.parse(
      await readFile(join(cacheDir, GREP_META_FILE), "utf8"),
    ) as GrepIndexMeta;
    if (meta?.version !== GREP_INDEX_VERSION || typeof meta.fileCount !== "number")
      return undefined;
    const raw = JSON.parse(await readFile(join(cacheDir, INDEX_FILE), "utf8")) as {
      files?: string[];
      grams?: string[];
      counts?: number[];
    };
    if (!Array.isArray(raw.files) || !Array.isArray(raw.grams) || !Array.isArray(raw.counts)) {
      return undefined;
    }
    const buf = await readFile(join(cacheDir, POSTINGS_FILE));
    // Copy into an aligned buffer: pooled Buffers can start at an odd byte offset.
    const ids = new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const postings = new Map<string, Uint32Array>();
    let at = 0;
    for (let i = 0; i < raw.grams.length; i += 1) {
      const n = raw.counts[i] ?? 0;
      if (at + n > ids.length) return undefined;
      postings.set(raw.grams[i]!, ids.subarray(at, at + n));
      at += n;
    }
    return rememberIndex(cacheDir, { files: raw.files, postings, meta });
  } catch {
    return undefined;
  }
}

async function writeAtomic(dir: string, name: string, data: string | Uint8Array): Promise<void> {
  const tmp = join(dir, `.${name}.tmp`);
  await writeFile(tmp, data);
  try {
    await rename(tmp, join(dir, name));
  } catch {
    await unlink(join(dir, name)).catch(() => undefined);
    await rename(tmp, join(dir, name));
  }
}

export async function buildGrepIndex(
  root: string,
  cacheDir: string,
  paths: string[],
): Promise<GrepIndex> {
  const headPromise = gitHead(root);
  const files = paths.filter((path) => path && !repoMapPathSkipped(path)).slice(0, BUILD_FILE_CAP);
  const lists = new Map<string, number[]>();
  const unindexed: string[] = [];
  for (let i = 0; i < files.length; i += 1) {
    if (i % BUILD_YIELD_EVERY === 0) await yieldLoop();
    const rel = files[i]!;
    let text = "";
    try {
      const buf = await readFile(join(root, rel));
      if (buf.subarray(0, 800).includes(0)) continue;
      if (buf.length > MAX_FILE_BYTES) {
        unindexed.push(rel);
        continue;
      }
      text = buf.toString("utf8");
    } catch {
      continue;
    }
    for (const gram of trigrams(text)) {
      const row = lists.get(gram);
      if (row) row.push(i);
      else lists.set(gram, [i]);
    }
  }
  await yieldLoop();
  const grams = [...lists.keys()];
  const counts = grams.map((gram) => lists.get(gram)!.length);
  const ids = new Uint32Array(counts.reduce((n, c) => n + c, 0));
  const postings = new Map<string, Uint32Array>();
  let at = 0;
  for (const gram of grams) {
    const row = lists.get(gram)!;
    ids.set(row, at);
    postings.set(gram, ids.subarray(at, at + row.length));
    at += row.length;
  }
  lists.clear();
  const meta: GrepIndexMeta = {
    version: GREP_INDEX_VERSION,
    fileCount: files.length,
    builtAt: new Date().toISOString(),
    head: await headPromise,
    ...(unindexed.length ? { unindexed } : {}),
  };
  await mkdir(cacheDir, { recursive: true });
  await writeAtomic(cacheDir, POSTINGS_FILE, new Uint8Array(ids.buffer));
  await writeAtomic(cacheDir, INDEX_FILE, JSON.stringify({ files, grams, counts }));
  await writeAtomic(cacheDir, GREP_META_FILE, `${JSON.stringify(meta)}\n`);
  await unlink(join(cacheDir, LEGACY_POSTINGS_FILE)).catch(() => undefined);
  return rememberIndex(cacheDir, { files, postings, meta });
}

/** Return an index built from the current HEAD, rebuilding (once, deduped) when HEAD moved. */
export async function ensureGrepIndex(
  root: string,
  cacheDir: string,
  head?: string,
): Promise<GrepIndex | undefined> {
  const existing = await loadGrepIndex(cacheDir);
  const current = head ?? (await gitHead(root));
  if (existing && existing.meta.head === current) return existing;
  const inflight = inflightBuilds.get(cacheDir);
  if (inflight) return inflight;
  const pending = (async () => {
    const paths = await indexPaths(root, cacheDir);
    if (!paths?.length) return existing;
    return buildGrepIndex(root, cacheDir, paths);
  })().finally(() => inflightBuilds.delete(cacheDir));
  inflightBuilds.set(cacheDir, pending);
  return pending;
}

/** Fresh index right now, or undefined while a background (re)build runs. Never blocks a grep. */
function freshGrepIndex(root: string, cacheDir: string, head?: string): GrepIndex | undefined {
  const hit = memIndexes.get(cacheDir);
  if (hit && head !== undefined && hit.meta.head === head) return rememberIndex(cacheDir, hit);
  if (!inflightBuilds.has(cacheDir)) {
    void ensureGrepIndex(root, cacheDir, head).catch(() => undefined);
  }
  return undefined;
}

/** Test hook: wait for any background index build. */
export async function settleGrepIndexBuilds(): Promise<void> {
  await Promise.all([...inflightBuilds.values()].map((p) => p.catch(() => undefined)));
}

async function gitHead(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], {
      timeout: 2000,
      windowsHide: true,
    });
    const sha = stdout.trim();
    return /^[0-9a-f]{7,64}$/i.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

/** Paths from the repo index when it exists, else git's tracked + untracked list. */
async function indexPaths(root: string, cacheDir: string): Promise<string[] | undefined> {
  try {
    const raw = await readFile(join(cacheDir, "files.jsonl"), "utf8");
    const paths: string[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { path?: string };
      if (row?.path) paths.push(row.path);
    }
    if (paths.length) return paths;
  } catch {
    /* fall through to git */
  }
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "-C",
        root,
        "-c",
        "core.quotepath=false",
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
      ],
      { timeout: 8000, maxBuffer: 32_000_000, windowsHide: true },
    );
    return stdout.split("\0").filter(Boolean);
  } catch {
    return undefined;
  }
}

/** Porcelain v1 `-z` paths. Renames and copies list the new path first, then the source. */
export function parsePorcelainZ(stdout: string): string[] {
  const parts = stdout.split("\0");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const row = parts[i];
    if (!row) continue;
    const code = row.slice(0, 2);
    const path =
      row.length >= 3 && row[2] === " " ? row.slice(3) : row.slice(Math.min(3, row.length));
    if (code.includes("R") || code.includes("C")) i += 1;
    const rel = path.replace(/\\/g, "/").trim();
    if (rel && !repoMapPathSkipped(rel)) out.push(rel);
  }
  return out;
}

export async function dirtyWorkspaceFiles(root: string): Promise<string[]> {
  return (await workspaceGitSnapshot(root))?.dirty ?? [];
}

export function grepContextLines(args: Record<string, unknown>, fallback = 3): number {
  const value = args.context;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(8, Math.max(0, Math.round(value)));
}

export function hostGrepPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return ".";
  const path = raw.trim().replace(/\\/g, "/");
  if (path === "." || path === "/workspace") return ".";
  if (path.startsWith("/workspace/")) return path.slice("/workspace/".length);
  return path.replace(/^\.\//, "");
}

/** Relative path inside `root`, or undefined if the grep path would leave the workspace. */
export function containedGrepPath(root: string, raw: unknown): string | undefined {
  const mapped = hostGrepPath(raw);
  if (mapped !== "." && (isAbsolute(mapped) || mapped.includes("\0"))) return undefined;
  const base = resolve(root);
  const dest = resolve(base, mapped);
  const rel = relative(base, dest);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel ? rel.split(sep).join("/") : ".";
}

function indexTooWide(candidates: number[], fileCount: number): boolean {
  if (!candidates.length) return false;
  if (candidates.length > MAX_CANDIDATES) return true;
  return fileCount > 0 && candidates.length / fileCount > MAX_CANDIDATE_RATIO;
}

export async function grepIndexedWorkspace(input: {
  root: string;
  pattern: string;
  path?: string;
  glob?: string;
  context?: number;
  regex?: boolean;
  cacheDir?: string;
  byteCap?: number;
}): Promise<
  { output: string; usedIndex: boolean; candidates?: number; files?: number } | undefined
> {
  const pattern = input.pattern.trim();
  if (!pattern) return { output: "", usedIndex: false };
  const cap = input.byteCap ?? AGENT_GREP_BYTE_CAP;
  const rel = containedGrepPath(input.root, input.path);
  if (rel == null) return { output: "", usedIndex: false };
  const rg = await resolveRipgrep();
  if (!rg) return undefined;
  const regex = input.regex !== false;
  let files: string[] | undefined;
  let usedIndex = false;
  let index: GrepIndex | undefined;
  if (input.cacheDir && !isOpenGrepPattern(pattern, regex)) {
    // Narrow with whatever index is loaded first; git status (needed to prove the index is
    // current and to add dirty files) only runs when the candidates will actually be used.
    const loaded = memIndexes.get(input.cacheDir);
    const ids = loaded ? candidateFileIds(loaded, pattern, regex) : undefined;
    if (!loaded) freshGrepIndex(input.root, input.cacheDir);
    else if (ids && !indexTooWide(ids, loaded.files.length)) {
      const snapshot = await workspaceGitSnapshot(input.root);
      index = snapshot ? freshGrepIndex(input.root, input.cacheDir, snapshot.head) : undefined;
      if (index === loaded && snapshot) {
        const set = new Set<string>();
        for (const id of ids) {
          const path = index.files[id];
          if (path) set.add(path);
        }
        for (const path of snapshot.dirty) set.add(path);
        for (const path of index.meta.unindexed ?? []) set.add(path);
        for (const path of snapshot.gone) set.delete(path);
        files = [...set].filter((path) => pathMatchesPrefix(path, rel));
        usedIndex = true;
      }
    }
  }
  if (usedIndex && !files?.length) {
    return { output: "", usedIndex: true, candidates: 0, files: index?.files.length };
  }
  const output = await runAgentRipgrep({
    bin: rg,
    root: input.root,
    pattern,
    files,
    glob: input.glob,
    context: input.context ?? 3,
    regex,
    searchPath: rel,
    cap,
  });
  if (output == null) return undefined;
  return {
    output,
    usedIndex,
    candidates: files?.length,
    files: index?.files.length,
  };
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  if (!prefix || prefix === ".") return true;
  const base = prefix.replace(/\/+$/, "");
  return path === base || path.startsWith(`${base}/`);
}

/** Split a candidate list so no single rg command line exceeds `maxChars`. */
export function chunkRgFiles(files: string[], baseChars: number, maxChars: number): string[][] {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let size = baseChars;
  for (const file of files) {
    const cost = file.length + 3;
    if (chunk.length && size + cost > maxChars) {
      chunks.push(chunk);
      chunk = [];
      size = baseChars;
    }
    chunk.push(file);
    size += cost;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

async function runAgentRipgrep(input: {
  bin: string;
  root: string;
  pattern: string;
  files?: string[];
  glob?: string;
  context: number;
  regex: boolean;
  searchPath: string;
  cap: number;
}): Promise<string | undefined> {
  const args = [
    "-n",
    "--hidden",
    "--no-heading",
    "--no-config",
    "--glob",
    "!node_modules/**",
    "--glob",
    "!.git/**",
  ];
  if (input.context > 0) args.push("-C", String(input.context));
  if (!input.regex) args.push("-F");
  const glob = input.glob?.trim();
  if (glob) args.push("--glob", glob);
  if (!input.files?.length) args.push("--max-filesize", String(MAX_FILE_BYTES));
  args.push("-e", input.pattern, "--");
  if (!input.files) {
    return spawnRg(input.bin, [...args, input.searchPath || "."], input.root, input.cap);
  }
  if (!input.files.length) return "";
  const base = input.bin.length + args.reduce((n, arg) => n + arg.length + 3, 0);
  let output = "";
  for (const chunk of chunkRgFiles(input.files, base, MAX_RG_ARGV_CHARS)) {
    const part = await spawnRg(
      input.bin,
      [...args, ...chunk],
      input.root,
      input.cap - output.length,
    );
    if (part == null) return output || undefined;
    output += part && output && !output.endsWith("\n") ? `\n${part}` : part;
    if (output.length >= input.cap) return output.slice(0, input.cap);
  }
  return output;
}

function spawnRg(
  bin: string,
  args: string[],
  cwd: string,
  cap: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), 8_000);
    const finish = (value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf8");
      if (stdout.length > cap) {
        stdout = stdout.slice(0, cap);
        child.kill("SIGTERM");
        finish(stdout);
      }
    });
    child.on("error", () => finish(undefined));
    child.on("close", (code) => {
      if (code === 0 || code === 1 || stdout) finish(stdout.slice(0, cap));
      else finish(undefined);
    });
  });
}
