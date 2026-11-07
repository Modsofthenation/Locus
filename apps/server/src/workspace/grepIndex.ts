import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { repoMapPathSkipped } from "@locus/shared";
import { resolveRipgrep } from "./workspaceGrep.js";

const execFileAsync = promisify(execFile);

export const GREP_INDEX_VERSION = 1;
export const GREP_NGRAM = 3;
export const AGENT_GREP_BYTE_CAP = 48_000;
const MAX_CANDIDATE_RATIO = 0.2;
const MAX_CANDIDATES = 4_000;
const POSTINGS_FILE = "grep-postings.json";
const GREP_META_FILE = "grep-meta.json";
const BUILD_FILE_CAP = 20_000;
const MAX_FILE_BYTES = 1_500_000;

export type GrepIndexMeta = {
  version: number;
  fileCount: number;
  builtAt: string;
  head?: string;
  sourceMtimeMs?: number;
  sourceSize?: number;
  unindexed?: string[];
};

export type GrepIndex = {
  files: string[];
  postings: Map<string, number[]>;
  meta: GrepIndexMeta;
};

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
    const next = new Set(posting);
    if (!current) {
      current = next;
      continue;
    }
    for (const id of current) {
      if (!next.has(id)) current.delete(id);
    }
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
      inter = inter ? inter.filter((id) => files.includes(id)) : files;
      if (!inter.length) break;
    }
    for (const id of inter ?? []) union.add(id);
  }
  return [...union];
}

export async function loadGrepIndex(cacheDir?: string): Promise<GrepIndex | undefined> {
  if (!cacheDir) return undefined;
  try {
    const meta = JSON.parse(
      await readFile(join(cacheDir, GREP_META_FILE), "utf8"),
    ) as GrepIndexMeta;
    if (meta?.version !== GREP_INDEX_VERSION || typeof meta.fileCount !== "number")
      return undefined;
    const raw = JSON.parse(await readFile(join(cacheDir, POSTINGS_FILE), "utf8")) as {
      files?: string[];
      postings?: Record<string, number[]>;
    };
    if (!Array.isArray(raw.files) || !raw.postings || typeof raw.postings !== "object") {
      return undefined;
    }
    const postings = new Map<string, number[]>();
    for (const [gram, ids] of Object.entries(raw.postings)) {
      if (Array.isArray(ids)) postings.set(gram, ids);
    }
    return { files: raw.files, postings, meta };
  } catch {
    return undefined;
  }
}

export async function buildGrepIndex(
  root: string,
  cacheDir: string,
  paths: string[],
): Promise<GrepIndex> {
  const files = paths.filter((path) => path && !repoMapPathSkipped(path)).slice(0, BUILD_FILE_CAP);
  const postings = new Map<string, number[]>();
  const unindexed: string[] = [];
  for (let i = 0; i < files.length; i += 1) {
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
      const row = postings.get(gram);
      if (row) row.push(i);
      else postings.set(gram, [i]);
    }
  }
  const source = await filesJsonlStamp(cacheDir);
  const meta: GrepIndexMeta = {
    version: GREP_INDEX_VERSION,
    fileCount: files.length,
    builtAt: new Date().toISOString(),
    ...(source ? { sourceMtimeMs: source.mtimeMs, sourceSize: source.size } : {}),
    ...(unindexed.length ? { unindexed } : {}),
  };
  await mkdir(cacheDir, { recursive: true });
  const tmp = join(cacheDir, `.${POSTINGS_FILE}.tmp`);
  const tmpMeta = join(cacheDir, `.${GREP_META_FILE}.tmp`);
  const payload = {
    files,
    postings: Object.fromEntries(postings),
  };
  await writeFile(tmp, JSON.stringify(payload));
  await writeFile(tmpMeta, `${JSON.stringify(meta)}\n`);
  try {
    await rename(tmp, join(cacheDir, POSTINGS_FILE));
  } catch {
    await unlink(join(cacheDir, POSTINGS_FILE)).catch(() => undefined);
    await rename(tmp, join(cacheDir, POSTINGS_FILE));
  }
  try {
    await rename(tmpMeta, join(cacheDir, GREP_META_FILE));
  } catch {
    await unlink(join(cacheDir, GREP_META_FILE)).catch(() => undefined);
    await rename(tmpMeta, join(cacheDir, GREP_META_FILE));
  }
  return { files, postings, meta };
}

export async function ensureGrepIndex(
  root: string,
  cacheDir: string,
): Promise<GrepIndex | undefined> {
  const existing = await loadGrepIndex(cacheDir);
  const stamp = await filesJsonlStamp(cacheDir);
  if (
    existing &&
    (!stamp ||
      (existing.meta.sourceMtimeMs === stamp.mtimeMs && existing.meta.sourceSize === stamp.size))
  ) {
    return existing;
  }
  const paths = await loadIndexPaths(cacheDir);
  if (!paths?.length) return existing;
  return buildGrepIndex(root, cacheDir, paths);
}

async function filesJsonlStamp(
  cacheDir: string,
): Promise<{ mtimeMs: number; size: number } | undefined> {
  try {
    const st = await stat(join(cacheDir, "files.jsonl"));
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return undefined;
  }
}

async function loadIndexPaths(cacheDir: string): Promise<string[] | undefined> {
  try {
    const raw = await readFile(join(cacheDir, "files.jsonl"), "utf8");
    const paths: string[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { path?: string };
      if (row?.path) paths.push(row.path);
    }
    return paths;
  } catch {
    return undefined;
  }
}

export function parsePorcelainZ(stdout: string): string[] {
  const parts = stdout.split("\0");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const row = parts[i];
    if (!row) continue;
    const code = row.slice(0, 2);
    let path =
      row.length >= 3 && row[2] === " " ? row.slice(3) : row.slice(Math.min(3, row.length));
    if (code.includes("R") || code.includes("C")) {
      const next = parts[i + 1];
      if (next) {
        path = next;
        i += 1;
      }
    }
    const rel = path.replace(/\\/g, "/").trim();
    if (rel && !repoMapPathSkipped(rel)) out.push(rel);
  }
  return out;
}

export async function dirtyWorkspaceFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "-c", "core.quotepath=false", "status", "--porcelain", "-z"],
      { timeout: 4000, maxBuffer: 8_000_000, windowsHide: true },
    );
    return parsePorcelainZ(stdout);
  } catch {
    return [];
  }
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
  const index = input.cacheDir ? await ensureGrepIndex(input.root, input.cacheDir) : undefined;
  const dirty = await dirtyWorkspaceFiles(input.root);
  let files: string[] | undefined;
  let usedIndex = false;
  if (index && !isOpenGrepPattern(pattern, input.regex !== false)) {
    const ids = candidateFileIds(index, pattern, input.regex !== false);
    if (ids && !indexTooWide(ids, index.files.length)) {
      const set = new Set<string>();
      for (const id of ids) {
        const path = index.files[id];
        if (path) set.add(path);
      }
      for (const path of dirty) set.add(path);
      for (const path of index.meta.unindexed ?? []) set.add(path);
      files = [...set].filter((path) => pathMatchesPrefix(path, rel));
      usedIndex = true;
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
    regex: input.regex !== false,
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
  if (input.files) {
    if (!input.files.length) return "";
    args.push(...input.files);
  } else {
    args.push(input.searchPath || ".");
  }
  return spawnRg(input.bin, args, input.root, input.cap);
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
