import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  INDEX_DIR_ALLOWLIST,
  isRepoMapExtraSkipDir,
  repoMapPathSkipped,
  WORKSPACE_SKIP_DIR_SET,
} from "@locus/shared";
import { containedPath } from "@locus/guest-agent";
import { parseIgnore, pathIgnored, type IgnoreRule } from "./repoIgnore.js";

const execFileAsync = promisify(execFile);

export const WORKSPACE_GREP_MAX_HITS = 80;
const GREP_MAX_FILES = 20_000;
const MAX_REGEX_CHARS = 200;
const GREP_LINE_CHARS = 240;
const GREP_TIMEOUT_MS = 8_000;
const FILE_CONCURRENCY = 32;
/** Files scanned between event-loop yields in the no-ripgrep fallback. */
const WALK_BATCH = 64;
const yieldLoop = () => new Promise<void>((done) => setImmediate(done));
/** Keep in lockstep with `WORKSPACE_FILE_MAX_BYTES` in workspaceFiles.ts. */
const MAX_FILE_BYTES = 1_500_000;

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
  ".wasm",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".bin",
  ".pyc",
  ".mp3",
  ".mp4",
  ".webm",
]);

const SOURCE_HIT_EXT = new Set([
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
  ".vue",
  ".svelte",
  ".swift",
  ".m",
  ".mm",
]);

/** Search these first so identifier hits in source beat docs/config noise. */
export const SOURCE_GREP_GLOBS = [...SOURCE_HIT_EXT].map((ext) => `*${ext}`);

export type WorkspaceGrepHit = {
  path: string;
  line: number;
  text: string;
};

export type WorkspaceGrepOptions = {
  glob?: string;
  exclude?: string;
  regex?: boolean;
  replace?: string;
  /** Test hook. Default tries ripgrep, then a git/walk scan. */
  engine?: "rg" | "walk";
};

export function workspaceGlobToRegExp(glob: string): RegExp | undefined {
  const src = glob.trim().replace(/\\/g, "/");
  if (!src) return undefined;
  const prefixed = src.includes("/") ? src : `**/${src}`;
  const body = prefixed
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\0/g, ".*");
  return new RegExp(`^${body}$`);
}

function expandBraceGlob(glob: string): string[] {
  const match = /^(.*)\{([^{}]+)\}(.*)$/.exec(glob);
  if (!match) return [glob];
  const prefix = match[1] ?? "";
  const suffix = match[3] ?? "";
  return (match[2] ?? "").split(",").flatMap((alt) => expandBraceGlob(`${prefix}${alt}${suffix}`));
}

export function expandWorkspaceGlobList(glob: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  for (const ch of glob) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (buf.trim()) parts.push(...expandBraceGlob(buf.trim()));
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(...expandBraceGlob(buf.trim()));
  return parts;
}

function globListMatches(path: string, glob: string): boolean {
  return expandWorkspaceGlobList(glob).some((item) => workspaceGlobToRegExp(item)?.test(path));
}

export function pathMatchesGrepGlobs(path: string, include?: string, exclude?: string): boolean {
  if (exclude?.trim() && globListMatches(path, exclude)) return false;
  if (!include?.trim()) return true;
  return globListMatches(path, include);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksText(buf: Buffer): boolean {
  return !buf.subarray(0, 800).includes(0);
}

function isGeneratedGrepPath(path: string): boolean {
  const lower = (path.split("/").pop() ?? "").toLowerCase();
  return lower.endsWith(".min.js") || lower.endsWith(".min.css") || lower.endsWith(".map");
}

function underRoot(root: string, rel: string): string | undefined {
  const dest = resolve(root, rel);
  const relToRoot = relative(resolve(root), dest);
  if (relToRoot.startsWith("..") || relToRoot.split(sep).includes("..")) return undefined;
  return dest;
}

function clipGrepLine(line: string): string {
  const clipped = line.length > GREP_LINE_CHARS ? `${line.slice(0, GREP_LINE_CHARS - 1)}…` : line;
  return clipped.trimEnd();
}

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

export function rankWorkspaceGrepHits(
  items: WorkspaceGrepHit[],
  query: string,
  regex = false,
): WorkspaceGrepHit[] {
  const needle = query.trim();
  if (!needle || items.length < 2) return items;
  const lower = needle.toLowerCase();
  const word = regex
    ? undefined
    : new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(needle)}([^A-Za-z0-9_]|$)`, "i");
  const defn = regex
    ? undefined
    : new RegExp(
        `(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var|type|interface|enum|def|fn|func)\\s+${escapeRegExp(needle)}\\b`,
        "i",
      );
  const score = (hit: WorkspaceGrepHit): number => {
    let n = 0;
    const ext = extname(hit.path).toLowerCase();
    if (SOURCE_HIT_EXT.has(ext)) n += 40;
    const pathLower = hit.path.toLowerCase();
    if (
      /\.(test|spec)\./.test(pathLower) ||
      /(^|\/)(test|tests|__tests__|fixtures)\//.test(pathLower)
    )
      n -= 18;
    if (!regex && basename(pathLower).includes(lower)) n += 24;
    if (defn?.test(hit.text)) n += 36;
    else if (word?.test(hit.text)) n += 28;
    else if (!regex && hit.text.toLowerCase().includes(lower)) n += 8;
    return n;
  };
  return [...items].sort(
    (a, b) => score(b) - score(a) || a.path.localeCompare(b.path) || a.line - b.line,
  );
}

function compileMatcher(
  needle: string,
  opts: WorkspaceGrepOptions,
): { matcher: (line: string) => boolean; regex?: RegExp; error?: string } {
  if (opts.regex) {
    if (needle.length > MAX_REGEX_CHARS)
      return { matcher: () => false, error: "Regular expression is too long" };
    try {
      const regex = new RegExp(needle, "g");
      return {
        regex,
        matcher: (line) => {
          regex.lastIndex = 0;
          return regex.test(line);
        },
      };
    } catch {
      return { matcher: () => false, error: "Invalid regular expression" };
    }
  }
  const lower = needle.toLowerCase();
  return { matcher: (line) => line.toLowerCase().includes(lower) };
}

let cachedRg: string | false | undefined;

/** File name of the ripgrep binary on this platform. */
export const RIPGREP_BINARY = process.platform === "win32" ? "rg.exe" : "rg";

/**
 * Where to look for ripgrep: an explicit override, then `rg` on PATH (distro builds measured
 * ~1.5x faster than the static `@vscode/ripgrep` binary), then the binary the desktop build
 * copies beside the bundled server (`bin/rg`), then the `@vscode/ripgrep` package (dev installs).
 */
export function ripgrepCandidates(): string[] {
  const out: string[] = [];
  const override = process.env.LOCUS_RG_PATH?.trim();
  if (override) out.push(override);
  out.push("rg");
  try {
    out.push(join(dirname(fileURLToPath(import.meta.url)), "bin", RIPGREP_BINARY));
  } catch {
    /* not a file: URL */
  }
  try {
    const req = createRequire(import.meta.url);
    out.push(
      req.resolve(`@vscode/ripgrep-${process.platform}-${process.arch}/bin/${RIPGREP_BINARY}`),
    );
  } catch {
    /* optional dependency not installed for this platform */
  }
  return out;
}

export async function resolveRipgrep(): Promise<string | undefined> {
  if (cachedRg === false) return undefined;
  if (cachedRg) return cachedRg;
  for (const bin of ripgrepCandidates()) {
    if (bin !== "rg" && !existsSync(bin)) continue;
    try {
      await execFileAsync(bin, ["--version"], { timeout: 2000, windowsHide: true });
      cachedRg = bin;
      return cachedRg;
    } catch {
      /* try the next candidate */
    }
  }
  cachedRg = false;
  return undefined;
}

/** Reset the rg lookup cache (tests). */
export function resetRipgrepCache(): void {
  cachedRg = undefined;
}

let hiddenIgnorePath: string | undefined;

/** gitignore-style rules so `.*` is skipped but `.github` stays searchable. */
export function ripgrepHiddenIgnoreFile(): string {
  if (hiddenIgnorePath) return hiddenIgnorePath;
  const path = join(tmpdir(), "locus-rg-hidden.ignore");
  const lines = [".*", ...INDEX_DIR_ALLOWLIST.flatMap((name) => [`!${name}/`, `!${name}/**`])];
  writeFileSync(path, `${lines.join("\n")}\n`);
  hiddenIgnorePath = path;
  return path;
}

export function ripgrepArgv(
  needle: string,
  opts: WorkspaceGrepOptions,
  extraGlobs: string[] = [],
): string[] {
  const args = [
    "--json",
    "--no-config",
    "--hidden",
    "--no-follow",
    "--ignore-file",
    ripgrepHiddenIgnoreFile(),
    "--max-filesize",
    String(MAX_FILE_BYTES),
  ];
  for (const name of WORKSPACE_SKIP_DIR_SET) {
    args.push("--glob", `!${name}/**`);
  }
  args.push("--glob", "!*.min.js", "--glob", "!*.min.css", "--glob", "!*.map");
  if (!opts.regex) args.push("-F", "-i");
  for (const glob of expandWorkspaceGlobList(opts.glob ?? "")) {
    const trimmed = glob.trim();
    if (trimmed) args.push("--glob", trimmed);
  }
  for (const glob of expandWorkspaceGlobList(opts.exclude ?? "")) {
    const trimmed = glob.trim();
    if (trimmed) args.push("--glob", `!${trimmed}`);
  }
  for (const glob of extraGlobs) args.push("--glob", glob);
  args.push("-e", needle, "--", ".");
  return args;
}

type RgMatch = { path?: { text?: string }; line_number?: number; lines?: { text?: string } };

function parseRipgrepJsonLine(line: string): WorkspaceGrepHit | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const row = JSON.parse(trimmed) as { type?: string; data?: RgMatch };
    if (row.type !== "match" || !row.data) return undefined;
    const path = (row.data.path?.text ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
    const lineNo = row.data.line_number;
    const text = row.data.lines?.text ?? "";
    if (!path || typeof lineNo !== "number") return undefined;
    if (path.includes("\0") || path.split("/").some((part) => part === "." || part === ".."))
      return undefined;
    return { path, line: lineNo, text: clipGrepLine(text.replace(/\r?\n$/, "")) };
  } catch {
    return undefined;
  }
}

async function runRipgrep(
  bin: string,
  root: string,
  args: string[],
  cap: number,
  ignoreFile?: string,
): Promise<{ items: WorkspaceGrepHit[]; truncated?: boolean; error?: string; failed?: boolean }> {
  const argv = ignoreFile ? ["--ignore-file", ignoreFile, ...args] : args;
  return new Promise((resolvePromise) => {
    const child = spawn(bin, argv, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const items: WorkspaceGrepHit[] = [];
    const seen = new Set<string>();
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), GREP_TIMEOUT_MS);

    const finish = (extra: { error?: string; failed?: boolean; truncated?: boolean } = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        items,
        truncated: extra.truncated || items.length > cap || undefined,
        error: extra.error,
        failed: extra.failed,
      });
    };

    const consume = (chunk: string, flush: boolean) => {
      stdout += chunk;
      const lines = stdout.split("\n");
      stdout = flush ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        const hit = parseRipgrepJsonLine(line);
        if (!hit) continue;
        const key = `${hit.path}:${hit.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(hit);
        if (items.length > cap) {
          child.kill("SIGTERM");
          finish({ truncated: true });
          return;
        }
      }
    };

    child.stdout?.on("data", (buf: Buffer) => consume(buf.toString("utf8"), false));
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf8");
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", () => finish({ failed: true }));
    child.on("close", (code) => {
      consume("", true);
      if (code === 0 || code === 1) {
        finish();
        return;
      }
      if (/regex|regexp|parse error|syntax error/i.test(stderr)) {
        finish({ error: "Invalid regular expression" });
        return;
      }
      finish({ failed: true });
    });
  });
}

async function grepWithRipgrep(
  root: string,
  needle: string,
  cap: number,
  opts: WorkspaceGrepOptions,
): Promise<{ items: WorkspaceGrepHit[]; truncated?: boolean; error?: string } | undefined> {
  const bin = await resolveRipgrep();
  if (!bin) return undefined;
  const ignoreFiles: string[] = [];
  for (const name of [".gitignore", ".locusignore"]) {
    try {
      await lstat(join(root, name));
      ignoreFiles.push(join(root, name));
    } catch {
      /* missing */
    }
  }
  const ignoreFile = ignoreFiles[ignoreFiles.length - 1];
  const extraIgnore = ignoreFiles[0] !== ignoreFile ? ignoreFiles[0] : undefined;
  const run = async (extraGlobs: string[]) => {
    const args = ripgrepArgv(needle, opts, extraGlobs);
    if (extraIgnore) args.unshift("--ignore-file", extraIgnore);
    return runRipgrep(bin, root, args, cap, ignoreFile);
  };

  const userGlob = Boolean(opts.glob?.trim());
  const first = await run(userGlob ? [] : SOURCE_GREP_GLOBS);
  if (first.failed) return undefined;
  if (first.error) return { items: [], error: first.error };
  if (userGlob || first.items.length > cap) {
    return {
      items: rankWorkspaceGrepHits(first.items.slice(0, cap), needle, Boolean(opts.regex)),
      truncated: first.truncated || first.items.length > cap || undefined,
    };
  }
  if (first.items.length === cap) {
    return { items: rankWorkspaceGrepHits(first.items, needle, Boolean(opts.regex)) };
  }
  const rest = await run(SOURCE_GREP_GLOBS.map((glob) => `!${glob}`));
  if (rest.failed) {
    return { items: rankWorkspaceGrepHits(first.items.slice(0, cap), needle, Boolean(opts.regex)) };
  }
  if (rest.error) return { items: [], error: rest.error };
  const merged = [...first.items];
  const seen = new Set(first.items.map((hit) => `${hit.path}:${hit.line}`));
  let truncated = Boolean(first.truncated || rest.truncated);
  for (const hit of rest.items) {
    const key = `${hit.path}:${hit.line}`;
    if (seen.has(key)) continue;
    if (merged.length >= cap) {
      truncated = true;
      break;
    }
    seen.add(key);
    merged.push(hit);
    if (merged.length > cap) {
      truncated = true;
      break;
    }
  }
  return {
    items: rankWorkspaceGrepHits(merged.slice(0, cap), needle, Boolean(opts.regex)),
    truncated: truncated || merged.length > cap || undefined,
  };
}

async function loadIgnoreFile(root: string, name: string): Promise<IgnoreRule[]> {
  try {
    return parseIgnore(await readFile(join(root, name), "utf8"));
  } catch {
    return [];
  }
}

async function loadIgnore(root: string): Promise<IgnoreRule[]> {
  const rules: IgnoreRule[] = [];
  for (const name of [".gitignore", ".locusignore"]) {
    try {
      rules.push(...parseIgnore(await readFile(join(root, name), "utf8")));
    } catch {
      /* missing */
    }
  }
  return rules;
}

async function gitCandidateFiles(root: string): Promise<string[] | undefined> {
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
    const list = async (extra: string[]) => {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", root, "-c", "core.quotepath=false", "ls-files", "-z", ...extra],
        { timeout: 8000, maxBuffer: 32_000_000, windowsHide: true },
      );
      return stdout.split("\0").filter(Boolean);
    };
    // git applies .gitignore itself (matching it in JS cost ~7 s on a 20k-file repo);
    // only .locusignore rules are evaluated here.
    const [cached, trackedIgnored, others, locus] = await Promise.all([
      list(["--cached"]),
      list(["--cached", "--ignored", "--exclude-standard"]),
      list(["--others", "--exclude-standard"]),
      loadIgnoreFile(root, ".locusignore"),
    ]);
    const skip = new Set(trackedIgnored);
    const files: string[] = [];
    for (const rel of [...cached, ...others]) {
      if (skip.has(rel)) continue;
      const path = rel.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!path || path.split("/").some((part) => part === "." || part === "..")) continue;
      if (repoMapPathSkipped(path) || isGeneratedGrepPath(path)) continue;
      if (locus.length && pathIgnored(path, false, locus)) continue;
      files.push(path);
      if (files.length >= GREP_MAX_FILES) break;
    }
    return files;
  } catch {
    return undefined;
  }
}

async function walkCandidateFiles(root: string, ignore: IgnoreRule[]): Promise<string[]> {
  const out: string[] = [];
  const visit = async (abs: string, rel: string): Promise<void> => {
    if (out.length >= GREP_MAX_FILES) return;
    let names: string[] = [];
    try {
      names = await readdir(abs);
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= GREP_MAX_FILES) return;
      if (WORKSPACE_SKIP_DIR_SET.has(name)) continue;
      const childAbs = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      try {
        const info = await lstat(childAbs);
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) {
          if (isRepoMapExtraSkipDir(name) || pathIgnored(childRel, true, ignore)) continue;
          await visit(childAbs, childRel);
          continue;
        }
        if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
        if (pathIgnored(childRel, false, ignore) || isGeneratedGrepPath(childRel)) continue;
        const ext = extname(name).toLowerCase();
        if (BINARY_EXT.has(ext)) continue;
        out.push(childRel);
      } catch {
        /* skip */
      }
    }
  };
  await visit(root, "");
  return out;
}

function scanFileHits(
  rel: string,
  original: string,
  matcher: (line: string) => boolean,
  cap: number,
  replacing: boolean,
  needle: string,
  regex: RegExp | undefined,
  replace: string | undefined,
): { hits: WorkspaceGrepHit[]; next?: string; replaced: number; truncated: boolean } {
  const lines = original.split(/\r?\n/);
  const hits: WorkspaceGrepHit[] = [];
  let nextLines: string[] | undefined;
  let replaced = 0;
  let truncated = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!matcher(line)) continue;
    if (hits.length < cap) {
      hits.push({ path: rel, line: i + 1, text: clipGrepLine(line) });
    } else if (!replacing) {
      truncated = true;
      break;
    }
    if (replacing && replace != null) {
      nextLines ??= [...lines];
      if (regex) {
        regex.lastIndex = 0;
        nextLines[i] = line.replace(regex, replace);
      } else {
        nextLines[i] = line.replace(new RegExp(escapeRegExp(needle), "gi"), () => replace);
      }
      replaced += 1;
    }
  }
  return {
    hits,
    next:
      nextLines && (original.endsWith("\n") ? `${nextLines.join("\n")}\n` : nextLines.join("\n")),
    replaced,
    truncated,
  };
}

async function grepByWalk(
  root: string,
  needle: string,
  cap: number,
  opts: WorkspaceGrepOptions,
): Promise<{ items: WorkspaceGrepHit[]; truncated?: boolean; replaced?: number; error?: string }> {
  const compiled = compileMatcher(needle, opts);
  if (compiled.error) return { items: [], error: compiled.error };
  const ignore = await loadIgnore(root);
  const replacing = opts.replace != null;
  const listed = (await gitCandidateFiles(root)) ?? (await walkCandidateFiles(root, ignore));
  const files = listed.filter((path) => pathMatchesGrepGlobs(path, opts.glob, opts.exclude));
  const source: string[] = [];
  const rest: string[] = [];
  for (const path of files) {
    if (!opts.glob?.trim() && SOURCE_HIT_EXT.has(extname(path).toLowerCase())) source.push(path);
    else rest.push(path);
  }
  const ordered = opts.glob?.trim() ? files : [...source, ...rest];
  const items: WorkspaceGrepHit[] = [];
  let replaced = 0;
  let truncated = false;
  const limitFile = createLimiter(FILE_CONCURRENCY);

  const scanOne = async (rel: string) => {
    const abs = join(root, rel);
    try {
      const info = await lstat(abs);
      if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_FILE_BYTES) return undefined;
      const buf = await readFile(abs);
      if (!looksText(buf)) return undefined;
      const original = buf.toString("utf8");
      const scanned = scanFileHits(
        rel,
        original,
        compiled.matcher,
        replacing ? Number.POSITIVE_INFINITY : cap,
        replacing,
        needle,
        compiled.regex,
        opts.replace,
      );
      if (scanned.next) await writeFile(abs, scanned.next);
      return scanned;
    } catch {
      return undefined;
    }
  };

  const take = (scanned: Awaited<ReturnType<typeof scanOne>>) => {
    if (!scanned) return;
    replaced += scanned.replaced;
    if (!replacing && scanned.truncated) truncated = true;
    for (const hit of scanned.hits) {
      if (items.length < cap) items.push(hit);
      else if (!replacing) {
        truncated = true;
        return;
      }
    }
  };

  if (replacing) {
    for (let i = 0; i < ordered.length; i += 1) {
      if (i % WALK_BATCH === 0) await yieldLoop();
      take(await scanOne(ordered[i]!));
    }
  } else {
    // Ordered batches: stop as soon as the cap is met and give the event loop a turn between
    // batches, so a repo without ripgrep cannot freeze the control plane for seconds.
    for (let i = 0; i < ordered.length; i += WALK_BATCH) {
      const batch = ordered.slice(i, i + WALK_BATCH);
      const rows = await Promise.all(batch.map((rel) => limitFile(() => scanOne(rel))));
      for (const row of rows) {
        take(row);
        if (truncated) break;
      }
      if (truncated) break;
      if (items.length >= cap) {
        truncated = i + WALK_BATCH < ordered.length;
        break;
      }
      await yieldLoop();
    }
  }

  return {
    items: rankWorkspaceGrepHits(items.slice(0, cap), needle, Boolean(opts.regex)),
    truncated: truncated || undefined,
    replaced: opts.replace != null ? replaced : undefined,
  };
}

async function replaceWithRipgrepList(
  root: string,
  needle: string,
  cap: number,
  opts: WorkspaceGrepOptions,
): Promise<
  { items: WorkspaceGrepHit[]; truncated?: boolean; replaced?: number; error?: string } | undefined
> {
  const bin = await resolveRipgrep();
  if (!bin) return undefined;
  const compiled = compileMatcher(needle, opts);
  if (compiled.error) return { items: [], error: compiled.error };
  const args = ripgrepArgv(needle, opts).filter((arg) => arg !== "--json");
  args.unshift("--files-with-matches");
  for (const name of [".gitignore", ".locusignore"]) {
    try {
      await lstat(join(root, name));
      args.unshift("--ignore-file", join(root, name));
    } catch {
      /* missing */
    }
  }
  try {
    const { stdout } = await execFileAsync(bin, args, {
      cwd: root,
      timeout: GREP_TIMEOUT_MS,
      maxBuffer: 8_000_000,
      encoding: "utf8",
      windowsHide: true,
    });
    const files = stdout
      .split("\n")
      .map((rel) => rel.trim().replace(/\\/g, "/").replace(/^\.\//, ""))
      .filter(Boolean);
    const items: WorkspaceGrepHit[] = [];
    let replaced = 0;
    for (const rel of files) {
      const abs = join(root, rel);
      try {
        const buf = await readFile(abs);
        if (!looksText(buf)) continue;
        const original = buf.toString("utf8");
        const scanned = scanFileHits(
          rel,
          original,
          compiled.matcher,
          Number.POSITIVE_INFINITY,
          true,
          needle,
          compiled.regex,
          opts.replace,
        );
        if (scanned.next) await writeFile(abs, scanned.next);
        replaced += scanned.replaced;
        for (const hit of scanned.hits) {
          if (items.length < cap) items.push(hit);
        }
      } catch {
        /* skip */
      }
    }
    return {
      items: rankWorkspaceGrepHits(items.slice(0, cap), needle, Boolean(opts.regex)),
      truncated: items.length >= cap || undefined,
      replaced,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/regex|regexp|parse error|syntax error/i.test(message)) {
      return { items: [], error: "Invalid regular expression" };
    }
    const code = (err as { code?: string | number }).code;
    if (code === 1) return { items: [], replaced: 0 };
    return undefined;
  }
}

export async function grepWorkspace(
  root: string,
  query: string,
  limit = WORKSPACE_GREP_MAX_HITS,
  opts: WorkspaceGrepOptions = {},
): Promise<{ items: WorkspaceGrepHit[]; truncated?: boolean; replaced?: number; error?: string }> {
  const needle = query.trim();
  if (needle.length < 2) return { items: [] };
  const cap = Math.min(Math.max(1, Math.floor(limit)), 200);
  const dest = underRoot(root, "");
  if (!dest) return { items: [] };
  const real = await containedPath(root, dest);
  if (!real) return { items: [] };
  if (opts.regex && needle.length > MAX_REGEX_CHARS) {
    return { items: [], error: "Regular expression is too long" };
  }

  if (opts.engine !== "walk" && opts.replace != null) {
    const replaced = await replaceWithRipgrepList(real, needle, cap, opts);
    if (replaced) return replaced;
  } else if (opts.engine !== "walk") {
    const rg = await grepWithRipgrep(real, needle, cap, opts);
    if (rg) return rg;
  }
  return grepByWalk(real, needle, cap, opts);
}
