import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { extname, join, resolve } from "node:path";
import type { Dirent } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import {
  extractSymbols,
  formatRepoMap,
  normalizeRepoPath,
  parseCtagsXOutput,
  pickSymbolFiles,
  searchRepoMap,
  isRepoMapSkipDir,
  repoMapPathSkipped,
  type RepoMap,
} from "@locus/shared";
import { containedPath } from "@locus/guest-agent";
import { parseIgnore, pathIgnored, type IgnoreRule } from "./repoIgnore.js";
import { WORKSPACE_FILE_MAX_BYTES } from "./workspaceFiles.js";
import { workspaceGitSnapshot } from "./gitPorcelain.js";

const execFileAsync = promisify(execFile);
const FILE_CONCURRENCY = 32;
const DIR_CONCURRENCY = 12;
const BINARY_PEEK_BYTES = 800;
const PROGRESS_EVERY = 64;
const HEARTBEAT_MS = 150;
/** Abort a stuck walk so the Files pane cannot sit on "Indexing 0" forever. */
export const INDEX_BUILD_MS = 15_000;
const GIT_INDEX_TIMEOUT_MS = 8_000;
/** Full symbol reads. Beyond this, files are listed by path/size only so regex cannot block the event loop. */
const MAX_SYMBOL_FILES = 800;

const TEXT_META_EXT = new Set([
  ".md",
  ".txt",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".toml",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".svg",
  ".csv",
  ".env",
  ".gitignore",
  ".dockerignore",
  ".map",
]);
const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".zip",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".wasm",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".bin",
  ".pyc",
  ".whl",
  ".mp3",
  ".mp4",
  ".webm",
  ".ogg",
  ".wav",
]);

function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const wait: Array<() => void> = [];
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => wait.push(resolve));
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      wait.shift()?.();
    }
  };
}

const SOURCE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".swift",
  ".vue",
  ".svelte",
]);
export const MAX_INDEX_FILES = 20_000;
const MAX_INDEX_SYMBOLS = 64_000;
const MAX_SYMBOL_BYTES = 16_000;
const INDEX_VERSION = 2;

export interface IndexedFile {
  path: string;
  hash: string;
  bytes: number;
  mtimeMs: number;
  symbols: string[];
  /** Set once symbols were extracted, so a file with none is not re-read on every build. */
  sx?: 1;
}

export interface IndexMeta {
  version: number;
  head?: string;
  builtAt: string;
  fileCount: number;
  truncated?: boolean;
}

export interface IndexBuildStats {
  files: number;
  reused: number;
  read: number;
  truncated?: boolean;
}

export interface IndexBuildResult {
  map: RepoMap;
  stats: IndexBuildStats;
  meta: IndexMeta;
}

export function indexCacheDir(dataDir: string, sessionId: string): string {
  return join(dataDir, "indexes", sessionId);
}

export async function indexWorkspace(
  root: string,
  opts: {
    query?: string;
    path?: string;
    rank?: boolean;
    cacheDir?: string;
    force?: boolean;
    focus?: string;
  } = {},
): Promise<string> {
  const built = await getWorkspaceIndex(root, {
    cacheDir: opts.cacheDir,
    force: opts.force,
  });
  return formatRepoMap(built.map, {
    query: opts.query,
    path: normalizeRepoPath(opts.path ?? ""),
    rank: opts.rank,
    focus: opts.focus,
  });
}

export async function searchWorkspaceIndex(
  root: string,
  opts: { query?: string; cacheDir?: string; force?: boolean; limit?: number } = {},
): Promise<{
  items: ReturnType<typeof searchRepoMap>;
  fileCount: number;
  builtAt: string;
  truncated?: boolean;
}> {
  const built = await getWorkspaceIndex(root, {
    cacheDir: opts.cacheDir,
    force: opts.force,
  });
  return {
    items: searchRepoMap(built.map, opts.query ?? "", { limit: opts.limit }),
    fileCount: built.meta.fileCount,
    builtAt: built.meta.builtAt,
    truncated: built.meta.truncated,
  };
}

export type WorkspaceIndexProgress = {
  status: "idle" | "building" | "ready";
  fileCount: number;
  scanned: number;
  reused?: number;
  read?: number;
  builtAt?: string;
  truncated?: boolean;
};

const indexBuilds = new Map<string, Promise<IndexBuildResult>>();
const indexProgress = new Map<string, WorkspaceIndexProgress>();
const readyIndexes = new Map<string, IndexBuildResult>();

function progressKey(root: string, cacheDir?: string): string {
  return cacheDir || root;
}

function setIndexProgress(key: string, next: WorkspaceIndexProgress): void {
  indexProgress.set(key, next);
}

/** Ready indexes kept in memory; a 20k-file repo map is tens of MB of heap. */
const MAX_READY_INDEXES = 6;

function rememberReadyIndex(key: string, result: IndexBuildResult): IndexBuildResult {
  readyIndexes.delete(key);
  readyIndexes.set(key, result);
  while (readyIndexes.size > MAX_READY_INDEXES) {
    const oldest = readyIndexes.keys().next().value;
    if (oldest === undefined) break;
    readyIndexes.delete(oldest);
    indexProgress.delete(oldest);
  }
  setIndexProgress(key, {
    status: "ready",
    fileCount: result.meta.fileCount,
    scanned: result.meta.fileCount,
    reused: result.stats.reused,
    read: result.stats.read,
    builtAt: result.meta.builtAt,
    truncated: result.meta.truncated,
  });
  return result;
}

/** Forget one session's in-memory index (its disk cache is the caller's to delete). */
export function dropWorkspaceIndex(cacheDir: string): void {
  readyIndexes.delete(cacheDir);
  indexProgress.delete(cacheDir);
}

/** Test hook: drop in-memory / in-flight index state. */
export function resetWorkspaceIndexCache(): void {
  readyIndexes.clear();
  indexBuilds.clear();
  indexProgress.clear();
}

function resultFromFiles(files: IndexedFile[], meta: IndexMeta): IndexBuildResult {
  const list = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const truncated = list.length >= MAX_INDEX_FILES || meta.truncated ? true : undefined;
  return {
    map: toRepoMap(list, Boolean(truncated)),
    stats: { files: list.length, reused: list.length, read: 0 },
    meta: { ...meta, fileCount: list.length, truncated },
  };
}

async function hydrateReadyIndex(cacheDir?: string): Promise<IndexBuildResult | undefined> {
  if (!cacheDir) return undefined;
  try {
    const meta = JSON.parse(await readFile(join(cacheDir, "meta.json"), "utf8")) as IndexMeta;
    if (meta?.version !== INDEX_VERSION || typeof meta.fileCount !== "number") return undefined;
    const prev = await loadIndex(cacheDir);
    if (!prev.size) return undefined;
    return resultFromFiles([...prev.values()], meta);
  } catch {
    return undefined;
  }
}

/** Serve Quick Open / repo_map from the ready index. Rebuilds only when missing or forced. */
export async function getWorkspaceIndex(
  root: string,
  opts: { cacheDir?: string; force?: boolean } = {},
): Promise<IndexBuildResult> {
  const key = progressKey(root, opts.cacheDir);
  if (!opts.force) {
    const ready = readyIndexes.get(key);
    if (ready) return rememberReadyIndex(key, ready);
    const inflight = indexBuilds.get(key);
    if (inflight) return inflight;
    const disk = await hydrateReadyIndex(opts.cacheDir);
    if (disk) return rememberReadyIndex(key, disk);
  }
  return buildWorkspaceIndex(root, opts);
}

export async function peekWorkspaceIndex(
  cacheDir?: string,
): Promise<WorkspaceIndexProgress | undefined> {
  if (!cacheDir) return undefined;
  const live = indexProgress.get(cacheDir);
  if (live) return { ...live };
  try {
    const meta = JSON.parse(await readFile(join(cacheDir, "meta.json"), "utf8")) as IndexMeta;
    if (meta?.version !== INDEX_VERSION || typeof meta.fileCount !== "number") return undefined;
    return {
      status: "ready",
      fileCount: meta.fileCount,
      scanned: meta.fileCount,
      builtAt: meta.builtAt,
      truncated: meta.truncated,
    };
  } catch {
    return undefined;
  }
}

export async function buildWorkspaceIndex(
  root: string,
  opts: { cacheDir?: string; force?: boolean } = {},
): Promise<IndexBuildResult> {
  const key = progressKey(root, opts.cacheDir);
  if (!opts.force) {
    const existing = indexBuilds.get(key);
    if (existing) return existing;
  }
  const pending = runWorkspaceIndexBuild(root, opts).finally(() => {
    if (indexBuilds.get(key) === pending) indexBuilds.delete(key);
  });
  indexBuilds.set(key, pending);
  return pending;
}

async function runWorkspaceIndexBuild(
  root: string,
  opts: { cacheDir?: string; force?: boolean } = {},
): Promise<IndexBuildResult> {
  const key = progressKey(root, opts.cacheDir);
  let seen = 0;
  const files: IndexedFile[] = [];
  const stats: IndexBuildStats = { files: 0, reused: 0, read: 0 };
  const pulse = () => {
    setIndexProgress(key, {
      status: "building",
      fileCount: files.length,
      scanned: Math.max(files.length, seen),
      reused: stats.reused,
      read: stats.read,
    });
  };
  setIndexProgress(key, { status: "building", fileCount: 0, scanned: 0, reused: 0, read: 0 });
  const heartbeat = setInterval(pulse, HEARTBEAT_MS);
  const deadline = Date.now() + INDEX_BUILD_MS;
  try {
    const prevMeta = await loadIndexMeta(opts.cacheDir);
    const prev = await loadIndex(opts.cacheDir);
    const gitIgnore = await loadIgnoreFile(root, ".gitignore");
    const locusIgnore = await loadIgnoreFile(root, ".locusignore");
    const ignore = [...gitIgnore, ...locusIgnore];
    let symbols = 0;
    let symbolFiles = 0;
    const headPromise = gitHead(root);
    const budget: IndexBudget = {
      remaining: () => MAX_INDEX_SYMBOLS - symbols,
      addSymbols: (n) => {
        symbols += n;
      },
      wantSymbols: () => symbols < MAX_INDEX_SYMBOLS && symbolFiles < MAX_SYMBOL_FILES,
      noteSymbolFile: () => {
        symbolFiles += 1;
      },
      addSeen: (n = 1) => {
        seen += n;
      },
      timedOut: () => Date.now() >= deadline,
      onProgress: pulse,
    };
    const gitPlan = await gitIndexPlan(root, locusIgnore);
    if (gitPlan) {
      seen += gitPlan.files.length + gitPlan.extraDirs.length;
      pulse();
      const clean = await cleanTrackedFiles(root, prev, prevMeta, gitPlan, await headPromise);
      await indexListedFiles(root, gitPlan.files, files, prev, locusIgnore, stats, budget, clean);
      for (const dir of gitPlan.extraDirs) {
        if (files.length >= MAX_INDEX_FILES || budget.timedOut()) break;
        await walkIndex(root, dir, files, prev, ignore, stats, budget);
      }
    } else {
      await walkIndex(root, "", files, prev, ignore, stats, budget);
    }
    await fillIndexSymbols(root, files, stats, budget);
    files.sort((a, b) => a.path.localeCompare(b.path));
    stats.files = files.length;
    stats.truncated =
      files.length >= MAX_INDEX_FILES || symbols >= MAX_INDEX_SYMBOLS || budget.timedOut()
        ? true
        : undefined;
    const map = toRepoMap(files, Boolean(stats.truncated));
    const meta: IndexMeta = {
      version: INDEX_VERSION,
      head: await headPromise,
      builtAt: new Date().toISOString(),
      fileCount: files.length,
      truncated: stats.truncated,
    };
    if (opts.cacheDir) await saveIndex(opts.cacheDir, meta, files);
    return rememberReadyIndex(key, { map, stats, meta });
  } finally {
    clearInterval(heartbeat);
  }
}

export async function updateIndexPaths(
  root: string,
  cacheDir: string,
  paths: string[],
): Promise<IndexBuildResult> {
  const prev = await loadIndex(cacheDir);
  const ignore = await loadRootIgnore(root);
  const next = new Map(prev);
  const stats: IndexBuildStats = { files: 0, reused: 0, read: 0 };
  for (const raw of paths) {
    const rel = normalizeRepoPath(raw);
    if (!rel) continue;
    const row = await indexOneFile(root, rel, ignore);
    if (!row) {
      next.delete(rel);
      continue;
    }
    stats.read += 1;
    next.set(rel, row);
  }
  const files = [...next.values()].sort((a, b) => a.path.localeCompare(b.path));
  stats.files = files.length;
  const truncated = files.length >= MAX_INDEX_FILES || undefined;
  const map = toRepoMap(files, Boolean(truncated));
  const meta: IndexMeta = {
    version: INDEX_VERSION,
    head: await gitHead(root),
    builtAt: new Date().toISOString(),
    fileCount: files.length,
    truncated,
  };
  await saveIndex(cacheDir, meta, files);
  return rememberReadyIndex(progressKey(root, cacheDir), { map, stats, meta });
}

function toRepoMap(files: IndexedFile[], truncated: boolean): RepoMap {
  return {
    files: files.map((file) => ({ path: file.path, bytes: file.bytes, symbols: file.symbols })),
    truncated: truncated || undefined,
  };
}

type IndexBudget = {
  remaining: () => number;
  addSymbols: (n: number) => void;
  wantSymbols: () => boolean;
  noteSymbolFile: () => void;
  addSeen: (n?: number) => void;
  timedOut: () => boolean;
  onProgress?: () => void;
};

async function indexListedFiles(
  root: string,
  rels: string[],
  out: IndexedFile[],
  prev: Map<string, IndexedFile>,
  ignore: IgnoreRule[],
  stats: IndexBuildStats,
  budget: IndexBudget,
  clean?: Set<string>,
): Promise<void> {
  const limitFile = createLimiter(FILE_CONCURRENCY);
  const noteProgress = () => {
    if (out.length === 1 || out.length % PROGRESS_EVERY === 0) budget.onProgress?.();
  };
  let n = 0;
  if (clean?.size) {
    // Same HEAD and git reports no change: reuse the row without an lstat per file.
    const rest: string[] = [];
    for (const rel of rels) {
      const row = clean.has(rel) ? prev.get(rel) : undefined;
      if (row && out.length < MAX_INDEX_FILES) {
        out.push(row);
        stats.reused += 1;
        budget.addSeen();
      } else rest.push(rel);
    }
    rels = rest;
    budget.onProgress?.();
  }
  await Promise.all(
    rels.map((rel) =>
      limitFile(async () => {
        if (out.length >= MAX_INDEX_FILES || budget.timedOut()) return;
        n += 1;
        if (n % FILE_CONCURRENCY === 0) await new Promise<void>((resolve) => setImmediate(resolve));
        budget.addSeen();
        const row = await indexPath(root, rel, prev, ignore, stats, budget);
        if (!row) return;
        out.push(row);
        noteProgress();
      }),
    ),
  );
}

async function indexPath(
  root: string,
  rel: string,
  prev: Map<string, IndexedFile>,
  ignore: IgnoreRule[],
  stats: IndexBuildStats,
  budget: IndexBudget,
): Promise<IndexedFile | undefined> {
  if (!rel || repoMapPathSkipped(rel) || pathIgnored(rel, false, ignore)) return undefined;
  if (budget.timedOut()) return undefined;
  const abs = join(root, rel);
  try {
    const info = await lstat(abs);
    if (info.isSymbolicLink() || !info.isFile()) return undefined;
    if (info.size > WORKSPACE_FILE_MAX_BYTES) return undefined;
    const existing = prev.get(rel);
    if (existing && existing.mtimeMs === info.mtimeMs && existing.bytes === info.size) {
      stats.reused += 1;
      return existing;
    }
    return readIndexedFile(abs, rel, info.size, info.mtimeMs, false);
  } catch {
    return undefined;
  }
}

async function walkIndex(
  root: string,
  startRel: string,
  out: IndexedFile[],
  prev: Map<string, IndexedFile>,
  ignore: IgnoreRule[],
  stats: IndexBuildStats,
  budget: IndexBudget,
): Promise<void> {
  const limitFile = createLimiter(FILE_CONCURRENCY);
  const limitDir = createLimiter(DIR_CONCURRENCY);
  let pending = 0;
  let settle: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const visit = (rel: string) => {
    if (out.length >= MAX_INDEX_FILES || budget.timedOut()) return;
    pending += 1;
    void limitDir(async () => {
      try {
        await visitDir(rel);
      } catch {
        /* skip unreadable dirs */
      } finally {
        pending -= 1;
        if (pending === 0) settle?.();
      }
    });
  };

  const noteProgress = () => {
    if (out.length === 1 || out.length % PROGRESS_EVERY === 0) budget.onProgress?.();
  };

  const visitDir = async (rel: string) => {
    if (out.length >= MAX_INDEX_FILES || budget.timedOut()) return;
    budget.addSeen();
    budget.onProgress?.();
    const abs = rel ? join(root, rel) : root;
    let entries: Dirent[];
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs: string[] = [];
    const files: Array<{ childRel: string; childAbs: string }> = [];
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (isRepoMapSkipDir(ent.name) || pathIgnored(childRel, true, ignore)) continue;
        dirs.push(childRel);
        continue;
      }
      if (!ent.isFile()) continue;
      if (pathIgnored(childRel, false, ignore)) continue;
      files.push({ childRel, childAbs: join(abs, ent.name) });
    }
    if (out.length < MAX_INDEX_FILES && !budget.timedOut()) {
      for (const childRel of dirs) visit(childRel);
    }
    await Promise.all(
      files.map((file) =>
        limitFile(async () => {
          if (out.length >= MAX_INDEX_FILES || budget.timedOut()) return;
          budget.addSeen();
          try {
            const info = await lstat(file.childAbs);
            if (info.isSymbolicLink() || !info.isFile()) return;
            if (info.size > WORKSPACE_FILE_MAX_BYTES) return;
            const existing = prev.get(file.childRel);
            if (existing && existing.mtimeMs === info.mtimeMs && existing.bytes === info.size) {
              stats.reused += 1;
              out.push(existing);
              noteProgress();
              return;
            }
            const row = await readIndexedFile(
              file.childAbs,
              file.childRel,
              info.size,
              info.mtimeMs,
              false,
            );
            if (!row) return;
            out.push(row);
            noteProgress();
          } catch {
            /* skip */
          }
        }),
      ),
    );
  };

  visit(startRel);
  if (pending === 0) settle?.();
  await done;
}

/** Run ctags over just the files that still need symbols (never `-R .` over the whole tree). */
async function ctagsSymbolMap(
  root: string,
  files: string[],
): Promise<Map<string, string[]> | undefined> {
  if (!files.length) return undefined;
  const bin = process.platform === "win32" ? "ctags.exe" : "ctags";
  const stdout = await new Promise<string | undefined>((done) => {
    let out = "";
    let settled = false;
    const finish = (value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(value);
    };
    const child = spawn(bin, ["-x", "-L", "-"], {
      cwd: root,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(undefined);
    }, 8_000);
    child.on("error", () => finish(undefined));
    child.stdout?.on("data", (buf: Buffer) => {
      out += buf.toString("utf8");
      if (out.length > 8 * 1024 * 1024) {
        child.kill("SIGTERM");
        finish(undefined);
      }
    });
    child.on("close", (code) => finish(code === 0 ? out : undefined));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(`${files.join("\n")}\n`);
  });
  if (!stdout) return undefined;
  const parsed = parseCtagsXOutput(stdout);
  if (!parsed.size) return undefined;
  const out = new Map<string, string[]>();
  for (const [file, rows] of parsed) {
    const names: string[] = [];
    for (const row of rows) {
      if (!names.includes(row.name)) names.push(row.name);
    }
    out.set(file, names);
  }
  return out;
}

async function fillIndexSymbols(
  root: string,
  files: IndexedFile[],
  stats: IndexBuildStats,
  budget: IndexBudget,
): Promise<void> {
  const candidates = files.filter(
    (file) => SOURCE_EXT.has(extname(file.path).toLowerCase()) && file.bytes <= MAX_SYMBOL_BYTES,
  );
  const chosen = new Set(
    pickSymbolFiles(
      candidates.map((file) => file.path),
      MAX_SYMBOL_FILES,
    ),
  );
  const targets = candidates.filter((file) => chosen.has(file.path));
  const missing = targets.filter((file) => !file.symbols.length && !file.sx);
  if (!missing.length) {
    for (const file of targets) {
      if (!file.symbols.length) continue;
      budget.noteSymbolFile();
      budget.addSymbols(file.symbols.length);
    }
    return;
  }
  const fromCtags = await ctagsSymbolMap(
    root,
    missing.map((file) => file.path),
  );
  const limitFile = createLimiter(FILE_CONCURRENCY);
  await Promise.all(
    targets.map((file) =>
      limitFile(async () => {
        if (budget.timedOut()) return;
        if (file.symbols.length || file.sx) {
          budget.noteSymbolFile();
          budget.addSymbols(file.symbols.length);
          return;
        }
        const tagged = fromCtags?.get(file.path);
        if (tagged?.length) {
          file.symbols = tagged;
          file.sx = 1;
          budget.noteSymbolFile();
          budget.addSymbols(file.symbols.length);
          return;
        }
        const abs = join(root, file.path);
        try {
          const buf = await readFile(abs);
          if (buf.subarray(0, Math.min(BINARY_PEEK_BYTES, buf.length)).includes(0)) return;
          file.symbols = extractSymbols(file.path, buf.toString("utf8"));
          file.sx = 1;
          stats.read += 1;
          budget.noteSymbolFile();
          budget.addSymbols(file.symbols.length);
        } catch {
          /* skip */
        }
      }),
    ),
  );
}

async function indexOneFile(
  root: string,
  rel: string,
  ignore: IgnoreRule[],
): Promise<IndexedFile | undefined> {
  if (!rel || repoMapPathSkipped(rel)) return undefined;
  if (pathIgnored(rel, false, ignore)) return undefined;
  const dest = join(root, rel);
  try {
    const info = await lstat(dest);
    if (info.isSymbolicLink() || !info.isFile()) return undefined;
    if (!(await containedPath(root, dest))) return undefined;
    if (info.size > WORKSPACE_FILE_MAX_BYTES) return undefined;
    return readIndexedFile(dest, rel, info.size, info.mtimeMs, true);
  } catch {
    return undefined;
  }
}

async function readIndexedFile(
  abs: string,
  rel: string,
  bytes: number,
  mtimeMs: number,
  wantSymbols: boolean,
): Promise<IndexedFile | undefined> {
  const ext = extname(rel).toLowerCase();
  if (BINARY_EXT.has(ext)) return undefined;
  const extract = wantSymbols && SOURCE_EXT.has(ext) && bytes <= MAX_SYMBOL_BYTES;
  if (extract) {
    const buf = await readFile(abs);
    if (buf.subarray(0, Math.min(BINARY_PEEK_BYTES, buf.length)).includes(0)) return undefined;
    return {
      path: rel,
      hash: "",
      bytes,
      mtimeMs,
      symbols: extractSymbols(rel, buf.toString("utf8")),
      sx: 1,
    };
  }
  if (TEXT_META_EXT.has(ext) || SOURCE_EXT.has(ext) || bytes === 0) {
    return { path: rel, hash: "", bytes, mtimeMs, symbols: [] };
  }
  if (bytes > 0 && (await fileLooksBinary(abs, bytes))) return undefined;
  return { path: rel, hash: "", bytes, mtimeMs, symbols: [] };
}

async function fileLooksBinary(abs: string, bytes: number): Promise<boolean> {
  const peekLen = Math.min(BINARY_PEEK_BYTES, bytes);
  const fh = await open(abs, "r");
  try {
    const peek = Buffer.allocUnsafe(peekLen);
    const { bytesRead } = await fh.read(peek, 0, peekLen, 0);
    return peek.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

async function loadIgnoreFile(root: string, name: string): Promise<IgnoreRule[]> {
  try {
    return parseIgnore(await readFile(join(root, name), "utf8"));
  } catch {
    return [];
  }
}

async function loadRootIgnore(root: string): Promise<IgnoreRule[]> {
  const rules: IgnoreRule[] = [];
  for (const name of [".gitignore", ".locusignore"]) {
    rules.push(...(await loadIgnoreFile(root, name)));
  }
  return rules;
}

async function loadIndexMeta(cacheDir?: string): Promise<IndexMeta | undefined> {
  if (!cacheDir) return undefined;
  try {
    const meta = JSON.parse(await readFile(join(cacheDir, "meta.json"), "utf8")) as IndexMeta;
    return meta?.version === INDEX_VERSION ? meta : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tracked paths that cannot have changed since the last build: HEAD is the same and
 * `git status` does not list them. Undefined when that cannot be proven.
 */
async function cleanTrackedFiles(
  root: string,
  prev: Map<string, IndexedFile>,
  prevMeta: IndexMeta | undefined,
  plan: { files: string[]; trackedCount: number },
  head: string | undefined,
): Promise<Set<string> | undefined> {
  if (!prev.size || !head || prevMeta?.head !== head) return undefined;
  const snap = await workspaceGitSnapshot(root, GIT_INDEX_TIMEOUT_MS);
  if (!snap || snap.head !== head) return undefined;
  const changed = new Set([...snap.dirty, ...snap.gone]);
  const clean = new Set<string>();
  for (let i = 0; i < plan.trackedCount; i += 1) {
    const rel = plan.files[i]!;
    if (!changed.has(rel)) clean.add(rel);
  }
  return clean;
}

async function loadIndex(cacheDir?: string): Promise<Map<string, IndexedFile>> {
  const out = new Map<string, IndexedFile>();
  if (!cacheDir) return out;
  try {
    const meta = JSON.parse(await readFile(join(cacheDir, "meta.json"), "utf8")) as IndexMeta;
    if (meta?.version !== INDEX_VERSION) return out;
  } catch {
    return out;
  }
  try {
    const raw = await readFile(join(cacheDir, "files.jsonl"), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as IndexedFile;
      if (row?.path && typeof row.hash === "string") out.set(row.path, row);
    }
  } catch {
    /* missing or corrupt */
  }
  return out;
}

async function saveIndex(cacheDir: string, meta: IndexMeta, files: IndexedFile[]): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const tmpMeta = join(cacheDir, `.meta.json.tmp`);
  const tmpFiles = join(cacheDir, `.files.jsonl.tmp`);
  await writeFile(tmpMeta, `${JSON.stringify(meta)}\n`);
  await writeFile(
    tmpFiles,
    files.map((file) => JSON.stringify(file)).join("\n") + (files.length ? "\n" : ""),
  );
  await rename(tmpMeta, join(cacheDir, "meta.json"));
  try {
    await rename(tmpFiles, join(cacheDir, "files.jsonl"));
  } catch {
    await unlink(join(cacheDir, "files.jsonl")).catch(() => undefined);
    await rename(tmpFiles, join(cacheDir, "files.jsonl"));
  }
}

async function gitHead(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], {
      timeout: 2000,
      windowsHide: true,
    });
    const sha = stdout.trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

async function gitIndexPlan(
  root: string,
  ignore: IgnoreRule[],
): Promise<{ files: string[]; extraDirs: string[]; trackedCount: number } | undefined> {
  try {
    const { stdout: topRaw } = await execFileAsync(
      "git",
      ["-C", root, "rev-parse", "--show-toplevel"],
      { timeout: 2000, windowsHide: true },
    );
    const top = topRaw.trim();
    if (!top || resolve(top) !== resolve(root)) return undefined;
  } catch {
    return undefined;
  }
  try {
    const cached = await gitLsFiles(root, ["--cached"]);
    const others = await gitLsFiles(root, ["--others", "--exclude-standard"]);
    const files: string[] = [];
    const extraDirs: string[] = [];
    const seenDir = new Set<string>();
    for (const rel of cached) {
      if (files.length >= MAX_INDEX_FILES) break;
      if (repoMapPathSkipped(rel) || pathIgnored(rel, false, ignore)) continue;
      files.push(rel);
    }
    const trackedCount = files.length;
    for (const rel of others) {
      if (repoMapPathSkipped(rel) || pathIgnored(rel, false, ignore)) continue;
      try {
        const info = await lstat(join(root, rel));
        if (info.isDirectory()) {
          if (isRepoMapSkipDir(rel.split("/").pop() ?? rel) || pathIgnored(rel, true, ignore)) {
            continue;
          }
          if (!seenDir.has(rel)) {
            seenDir.add(rel);
            extraDirs.push(rel);
          }
          continue;
        }
        if (!info.isFile() || files.length >= MAX_INDEX_FILES) continue;
        files.push(rel);
      } catch {
        /* skip */
      }
    }
    return { files, extraDirs, trackedCount };
  } catch {
    return undefined;
  }
}

async function gitLsFiles(root: string, extra: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", root, "-c", "core.quotepath=false", "ls-files", "-z", ...extra],
    { timeout: GIT_INDEX_TIMEOUT_MS, maxBuffer: 32_000_000, windowsHide: true },
  );
  const out: string[] = [];
  for (const raw of stdout.split("\0")) {
    const rel = raw.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    if (rel) out.push(rel);
  }
  return out;
}
