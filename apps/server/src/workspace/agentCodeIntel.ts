import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
  codeIntelLanguage,
  codeIntelServerMissing,
  codeIntelUnsupported,
  extractSymbolLocations,
  findSymbolInText,
  formatDefinitionResult,
  formatDiagnostics,
  formatPostEditDiagnostics,
  formatReferences,
  formatRenameResult,
  formatSnippet,
  formatSymbolList,
  identifierAt,
  parseCodeIntelTarget,
  parseCodeRenameName,
  patchFilesFromTool,
  pickSymbolCandidate,
  symbolColumnInLine,
  symbolLeaf,
  type CodeIntelDiagnostic,
  type CodeIntelLanguage,
  type CodeIntelLocation,
  type CodeIntelTarget,
  type CodeSymbolCandidate,
} from "@locus/shared";
import { workspaceGitSnapshot } from "./gitPorcelain.js";
import { searchWorkspaceIndex } from "./repoIndex.js";
import {
  inspectWorkspaceFile,
  navigateWorkspaceSymbols,
  outlineWorkspaceFile,
  problemsWorkspaceFiles,
  referencesWorkspaceFile,
  renameWorkspaceSymbol,
} from "./workspaceComplete.js";
import { extraLspLanguage, resolveExtraLspCommand } from "./workspaceExtraLsp.js";
import { readWorkspaceFile, sanitizeWorkspaceRel, writeWorkspaceFile } from "./workspaceFiles.js";
import { inspectPythonFile } from "./workspacePython.js";

/**
 * Agent-facing code intelligence (code_definition / code_references / code_symbols /
 * code_diagnostics / code_rename) and post-edit diagnostics, on top of the editor's
 * language services. Never throws: a missing server or a timeout becomes an actionable message.
 */

export type CodeIntelContext = {
  /** Host path of the workspace (host dir, Docker bind mount, or VM/worker mirror). */
  root: string;
  /** Repo index cache for non-TS workspace symbol lookups. */
  indexCacheDir?: string;
  timeoutMs?: number;
};

export type CodeIntelFileEdit = { path: string; before: string; after: string };

export type CodeIntelResult = {
  ok: boolean;
  output: string;
  /** Files code_rename rewrote on disk (before/after), for undo and change tracking. */
  edited?: CodeIntelFileEdit[];
};

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_DIAGNOSTIC_FILES = 24;
const TIMED_OUT = Symbol("timeout");

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(1, ms));
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

function timedOut(tool: string, ms: number): CodeIntelResult {
  return {
    ok: false,
    output: `${tool}: the language server did not answer within ${Math.round(ms / 1000)}s (it may still be indexing). Retry shortly, or use grep / file_read.`,
  };
}

function fail(output: string): CodeIntelResult {
  return { ok: false, output };
}

function commandOnPath(command: string): boolean {
  if (!command) return false;
  if (command.includes("/") || command.includes("\\")) return existsSync(command);
  const exts =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)]
      : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      if (existsSync(join(dir, `${command}${ext}`))) return true;
    }
  }
  return false;
}

const pythonProbe = new Map<string, { ok: boolean; at: number }>();
const PYTHON_PROBE_TTL_MS = 60_000;

/** Whether pylsp starts for this root. Cached; a failed probe is retried after a minute. */
async function pythonReady(root: string, rel: string, content: string): Promise<boolean> {
  const hit = pythonProbe.get(root);
  if (hit && (hit.ok || Date.now() - hit.at < PYTHON_PROBE_TTL_MS)) return hit.ok;
  let ok = false;
  try {
    ok = (await inspectPythonFile({ root, rel, content, line: 0, character: 0 })).pylsp;
  } catch {
    ok = false;
  }
  pythonProbe.set(root, { ok, at: Date.now() });
  return ok;
}

/** Undefined when the backend can run; otherwise the actionable "not installed" message. */
async function backendMissing(
  tool: string,
  lang: CodeIntelLanguage,
  root: string,
  rel: string,
  content: string,
): Promise<string | undefined> {
  if (lang === "typescript") return undefined;
  if (lang === "python") {
    return (await pythonReady(root, rel, content)) ? undefined : codeIntelServerMissing(lang, tool);
  }
  const extra = extraLspLanguage(rel);
  const cmd = extra ? resolveExtraLspCommand(extra) : null;
  return cmd && commandOnPath(cmd.command) ? undefined : codeIntelServerMissing(lang, tool);
}

/** Cheap, non-spawning readiness check for post-edit diagnostics. */
function backendKnownReady(lang: CodeIntelLanguage, root: string, rel: string): boolean {
  if (lang === "typescript") return true;
  if (lang === "python") return pythonProbe.get(root)?.ok === true;
  const extra = extraLspLanguage(rel);
  const cmd = extra ? resolveExtraLspCommand(extra) : null;
  return Boolean(cmd && commandOnPath(cmd.command));
}

async function readText(root: string, rel: string): Promise<string | undefined> {
  try {
    return (await readWorkspaceFile(root, rel))?.content;
  } catch {
    return undefined;
  }
}

function makeFileCache(root: string) {
  const cache = new Map<string, Promise<string | undefined>>();
  return (rel: string) => {
    let hit = cache.get(rel);
    if (!hit) {
      hit = readText(root, rel);
      cache.set(rel, hit);
    }
    return hit;
  };
}

type Resolved = {
  rel: string;
  content: string;
  line: number;
  character: number;
  symbol?: string;
  lang: CodeIntelLanguage;
};

async function fileSymbolCandidates(
  root: string,
  rel: string,
  content: string,
): Promise<CodeSymbolCandidate[]> {
  if (codeIntelLanguage(rel) === "typescript") {
    try {
      const outline = outlineWorkspaceFile({ root, rel, content, limit: 400 });
      if (outline.length) {
        return outline.map((item) => ({
          path: rel,
          line: item.line + 1,
          symbol: item.container ? `${item.container}.${item.name}` : item.name,
          kind: item.kind,
        }));
      }
    } catch {
      /* fall back to the regex extractor */
    }
  }
  return extractSymbolLocations(rel, content, { limit: 400 }).map((row) => ({
    path: rel,
    line: row.line,
    symbol: row.name,
  }));
}

/** Workspace symbol search: TS language service plus the repo symbol index for other languages. */
async function workspaceSymbols(
  ctx: CodeIntelContext,
  query: string,
  exact: boolean,
): Promise<CodeSymbolCandidate[]> {
  const leaf = symbolLeaf(query);
  const out: CodeSymbolCandidate[] = [];
  try {
    for (const hit of navigateWorkspaceSymbols({ root: ctx.root, query: leaf, limit: 40 }).items) {
      out.push({ path: hit.path, line: hit.line, symbol: hit.symbol });
    }
  } catch {
    /* no TS project */
  }
  try {
    const indexed = await searchWorkspaceIndex(ctx.root, {
      query: leaf,
      cacheDir: ctx.indexCacheDir,
      limit: 60,
    });
    const want = leaf.toLowerCase();
    const paths = [
      ...new Set(
        indexed.items
          .filter(
            (item) =>
              item.kind === "symbol" &&
              item.symbol &&
              codeIntelLanguage(item.path) &&
              codeIntelLanguage(item.path) !== "typescript" &&
              (exact ? item.symbol === leaf : item.symbol.toLowerCase().includes(want)),
          )
          .map((item) => item.path),
      ),
    ].slice(0, 20);
    for (const path of paths) {
      const text = await readText(ctx.root, path);
      if (!text) continue;
      for (const row of extractSymbolLocations(path, text, { limit: 400 })) {
        const match = exact ? row.name === leaf : row.name.toLowerCase().includes(want);
        if (match) out.push({ path, line: row.line, symbol: row.name });
      }
    }
  } catch {
    /* index unavailable */
  }
  return out;
}

async function resolveTarget(
  tool: string,
  ctx: CodeIntelContext,
  target: CodeIntelTarget,
): Promise<{ ok: true; value: Resolved } | { ok: false; error: string }> {
  let rel = "";
  if (target.path) {
    rel = sanitizeWorkspaceRel(target.path, ctx.root);
    if (!rel) return { ok: false, error: `${tool}: ${target.path} is not a workspace path.` };
  }
  const symbol = target.symbol;
  let line = target.line;
  let character = target.character;
  if (!rel) {
    if (!symbol) return { ok: false, error: `${tool} needs path or symbol.` };
    const picked = pickSymbolCandidate(tool, await workspaceSymbols(ctx, symbol, true), symbol);
    if (!picked.ok) return picked;
    rel = picked.value.path;
    line = picked.value.line - 1;
    character = undefined;
  }
  const lang = codeIntelLanguage(rel);
  if (!lang) return { ok: false, error: codeIntelUnsupported(rel, tool) };
  const content = await readText(ctx.root, rel);
  if (content === undefined) return { ok: false, error: `${tool}: ${rel} not found.` };
  const lines = content.split("\n");
  if (line !== undefined && line >= lines.length) {
    return {
      ok: false,
      error: `${tool}: line ${line + 1} is past the end of ${rel} (${lines.length} lines).`,
    };
  }
  if (line !== undefined && character !== undefined) {
    const text = lines[line] ?? "";
    const at = Math.min(character, text.length);
    return {
      ok: true,
      value: { rel, content, line, character: at, symbol: symbol || identifierAt(text, at), lang },
    };
  }
  if (!symbol) return { ok: false, error: `${tool} needs column or symbol.` };
  if (line === undefined) {
    const picked = pickSymbolCandidate(
      tool,
      await fileSymbolCandidates(ctx.root, rel, content),
      symbol,
    );
    if (picked.ok) line = picked.value.line - 1;
    else if (picked.reason === "ambiguous") return picked;
    else {
      const hit = findSymbolInText(content, symbol);
      if (!hit) return { ok: false, error: `${tool}: "${symbol}" does not appear in ${rel}.` };
      return { ok: true, value: { rel, content, ...hit, symbol, lang } };
    }
  }
  const col = symbolColumnInLine(lines[line] ?? "", symbol);
  if (col < 0) {
    return {
      ok: false,
      error: `${tool}: "${symbol}" is not on line ${line + 1} of ${rel}. Pass line + column.`,
    };
  }
  return { ok: true, value: { rel, content, line, character: col, symbol, lang } };
}

async function codeDefinition(
  ctx: CodeIntelContext,
  args: Record<string, unknown>,
): Promise<CodeIntelResult> {
  const tool = "code_definition";
  const parsed = parseCodeIntelTarget(tool, args);
  if (!parsed.ok) return fail(parsed.error);
  const ms = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolved = await withTimeout(resolveTarget(tool, ctx, parsed.value), ms);
  if (resolved === TIMED_OUT) return timedOut(tool, ms);
  if (!resolved.ok) return fail(resolved.error);
  const at = resolved.value;
  const missing = await backendMissing(tool, at.lang, ctx.root, at.rel, at.content);
  if (missing) return fail(missing);
  const inspected = await withTimeout(
    inspectWorkspaceFile({
      root: ctx.root,
      rel: at.rel,
      content: at.content,
      line: at.line,
      character: at.character,
    }),
    ms,
  );
  if (inspected === TIMED_OUT) return timedOut(tool, ms);
  const read = makeFileCache(ctx.root);
  const defs: Array<CodeIntelLocation & { snippet?: string }> = [];
  const seen = new Set<string>();
  for (const loc of [inspected.definition, inspected.implementation]) {
    if (!loc) continue;
    const key = `${loc.path}:${loc.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = loc.path === at.rel ? at.content : await read(loc.path);
    defs.push({
      ...loc,
      snippet: text !== undefined ? formatSnippet(text.split("\n"), loc.line, 6) : undefined,
    });
  }
  return {
    ok: true,
    output: formatDefinitionResult({
      from: { path: at.rel, line: at.line, character: at.character, symbol: at.symbol },
      definitions: defs,
      hover: inspected.hover?.text,
    }),
  };
}

async function codeReferences(
  ctx: CodeIntelContext,
  args: Record<string, unknown>,
): Promise<CodeIntelResult> {
  const tool = "code_references";
  const parsed = parseCodeIntelTarget(tool, args);
  if (!parsed.ok) return fail(parsed.error);
  const ms = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolved = await withTimeout(resolveTarget(tool, ctx, parsed.value), ms);
  if (resolved === TIMED_OUT) return timedOut(tool, ms);
  if (!resolved.ok) return fail(resolved.error);
  const at = resolved.value;
  const missing = await backendMissing(tool, at.lang, ctx.root, at.rel, at.content);
  if (missing) return fail(missing);
  const refs = await withTimeout(
    referencesWorkspaceFile({
      root: ctx.root,
      rel: at.rel,
      content: at.content,
      line: at.line,
      character: at.character,
    }),
    ms,
  );
  if (refs === TIMED_OUT) return timedOut(tool, ms);
  const read = makeFileCache(ctx.root);
  const items: CodeIntelLocation[] = [];
  for (const ref of refs.items) {
    const text = ref.path === at.rel ? at.content : await read(ref.path);
    items.push({ ...ref, text: text?.split("\n")[ref.line] });
  }
  const limit = typeof args.limit === "number" ? args.limit : Number(args.limit) || undefined;
  return {
    ok: true,
    output: formatReferences({
      from: { path: at.rel, line: at.line, character: at.character, symbol: at.symbol },
      items,
      limit,
    }),
  };
}

async function codeSymbols(
  ctx: CodeIntelContext,
  args: Record<string, unknown>,
): Promise<CodeIntelResult> {
  const tool = "code_symbols";
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const path = typeof args.path === "string" ? args.path.trim() : "";
  const ms = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (path) {
    const rel = sanitizeWorkspaceRel(path, ctx.root);
    if (!rel) return fail(`${tool}: ${path} is not a workspace path.`);
    const content = await readText(ctx.root, rel);
    if (content === undefined) return fail(`${tool}: ${rel} not found.`);
    const items = await withTimeout(fileSymbolCandidates(ctx.root, rel, content), ms);
    if (items === TIMED_OUT) return timedOut(tool, ms);
    const want = query.toLowerCase();
    const filtered = want
      ? items.filter((item) => item.symbol.toLowerCase().includes(want))
      : items;
    return { ok: true, output: formatSymbolList({ items: filtered, path: rel, query }) };
  }
  if (!query) return fail(`${tool} needs query (workspace symbols) or path (file outline).`);
  const items = await withTimeout(workspaceSymbols(ctx, query, false), ms);
  if (items === TIMED_OUT) return timedOut(tool, ms);
  return { ok: true, output: formatSymbolList({ items, query, limit: 60 }) };
}

function diagnosticPaths(args: Record<string, unknown>): string[] {
  const raw = Array.isArray(args.paths)
    ? args.paths
    : typeof args.paths === "string"
      ? [args.paths]
      : typeof args.path === "string"
        ? [args.path]
        : [];
  return raw.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

/** Language-server diagnostics for `rels`, re-reading push-based servers once after a short wait. */
async function collectDiagnostics(
  root: string,
  files: Array<{ rel: string; content: string }>,
  deadline: number,
): Promise<CodeIntelDiagnostic[] | typeof TIMED_OUT> {
  const first = await withTimeout(problemsWorkspaceFiles({ root, files }), deadline - Date.now());
  if (first === TIMED_OUT) return TIMED_OUT;
  const pushed = files.filter((file) => codeIntelLanguage(file.rel) !== "typescript");
  if (!pushed.length) return first.diagnostics;
  // pylsp / gopls / rust-analyzer publish diagnostics asynchronously after didChange.
  await sleep(Math.min(1_000, deadline - Date.now() - 200));
  if (Date.now() >= deadline) return first.diagnostics;
  const again = await withTimeout(
    problemsWorkspaceFiles({ root, files: pushed }),
    deadline - Date.now(),
  );
  if (again === TIMED_OUT) return first.diagnostics;
  const pushedRels = new Set(pushed.map((file) => file.rel));
  return [...first.diagnostics.filter((diag) => !pushedRels.has(diag.path)), ...again.diagnostics];
}

async function codeDiagnostics(
  ctx: CodeIntelContext,
  args: Record<string, unknown>,
): Promise<CodeIntelResult> {
  const tool = "code_diagnostics";
  const ms = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let requested = diagnosticPaths(args);
  const fromGit = !requested.length;
  if (fromGit) {
    const snap = await workspaceGitSnapshot(ctx.root);
    if (!snap)
      return fail(`${tool}: not a git workspace, so there is no changed-file set. Pass paths[].`);
    requested = snap.dirty.filter((path) => !path.endsWith("/") && codeIntelLanguage(path));
    if (!requested.length) {
      return {
        ok: true,
        output:
          "No changed TS/JS, Python, Go, Rust or Java files in the workspace. Pass paths[] to check specific files.",
      };
    }
  }
  const skipped: string[] = [];
  const files: Array<{ rel: string; content: string }> = [];
  const rels = [...new Set(requested.map((path) => sanitizeWorkspaceRel(path, ctx.root)))];
  for (const rel of rels) {
    if (!rel) continue;
    if (files.length >= MAX_DIAGNOSTIC_FILES) {
      skipped.push(
        `${rels.length - MAX_DIAGNOSTIC_FILES} more files (max ${MAX_DIAGNOSTIC_FILES})`,
      );
      break;
    }
    const lang = codeIntelLanguage(rel);
    if (!lang) {
      skipped.push(`${rel} (unsupported language)`);
      continue;
    }
    const content = await readText(ctx.root, rel);
    if (content === undefined) {
      skipped.push(`${rel} (not found)`);
      continue;
    }
    const missing = await backendMissing(tool, lang, ctx.root, rel, content);
    if (missing) {
      skipped.push(`${rel} (${missing.split(" (")[0]})`);
      continue;
    }
    files.push({ rel, content });
  }
  if (!files.length) {
    return fail(
      `${tool}: nothing to check.${skipped.length ? ` Skipped: ${skipped.join("; ")}` : ""}`,
    );
  }
  const diags = await collectDiagnostics(ctx.root, files, Date.now() + ms);
  if (diags === TIMED_OUT) return timedOut(tool, ms);
  return {
    ok: true,
    output: formatDiagnostics({
      diagnostics: diags.filter((diag) => files.some((file) => file.rel === diag.path)),
      checked: files.map((file) => file.rel),
      skipped,
    }),
  };
}

async function codeRename(
  ctx: CodeIntelContext,
  args: Record<string, unknown>,
): Promise<CodeIntelResult> {
  const tool = "code_rename";
  const name = parseCodeRenameName(args.newName ?? args.new_name);
  if (!name.ok) return fail(name.error);
  const parsed = parseCodeIntelTarget(tool, args);
  if (!parsed.ok) return fail(parsed.error);
  const ms = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolved = await withTimeout(resolveTarget(tool, ctx, parsed.value), ms);
  if (resolved === TIMED_OUT) return timedOut(tool, ms);
  if (!resolved.ok) return fail(resolved.error);
  const at = resolved.value;
  if (at.lang !== "typescript" && at.lang !== "python") {
    return fail(
      `${tool} supports TS/JS and Python. For ${at.rel} use code_references to list the call sites, then apply_patch.`,
    );
  }
  const missing = await backendMissing(tool, at.lang, ctx.root, at.rel, at.content);
  if (missing) return fail(missing);
  const oldName = identifierAt(at.content.split("\n")[at.line] ?? "", at.character) || at.symbol;
  if (!oldName)
    return fail(`${tool}: no identifier at ${at.rel}:${at.line + 1}:${at.character + 1}.`);
  if (oldName === name.value) return fail(`${tool}: \`${oldName}\` already has that name.`);
  const renamed = await withTimeout(
    renameWorkspaceSymbol({
      root: ctx.root,
      rel: at.rel,
      content: at.content,
      line: at.line,
      character: at.character,
      newName: name.value,
    }),
    ms,
  );
  if (renamed === TIMED_OUT) return timedOut(tool, ms);
  if (!renamed.files.length) {
    return fail(
      `${tool}: nothing to rename at ${at.rel}:${at.line + 1}:${at.character + 1} (\`${oldName}\`). Point line/column at the identifier itself.`,
    );
  }
  const blocked = renamed.files.filter(
    (file) => /(^|\/)node_modules\//.test(file.path) || file.path.startsWith("__python__/"),
  );
  if (blocked.length) {
    return fail(
      `${tool}: \`${oldName}\` is declared outside the project (${blocked[0]!.path}); refusing to edit dependencies.`,
    );
  }
  const edits: CodeIntelFileEdit[] = [];
  for (const file of renamed.files) {
    const before = file.path === at.rel ? at.content : await readText(ctx.root, file.path);
    if (before === undefined) return fail(`${tool}: could not read ${file.path}; nothing written.`);
    if (before !== file.content) edits.push({ path: file.path, before, after: file.content });
  }
  const written: CodeIntelFileEdit[] = [];
  for (const edit of edits) {
    try {
      await writeWorkspaceFile(ctx.root, edit.path, edit.after);
      written.push(edit);
    } catch (err) {
      for (const done of written) {
        await writeWorkspaceFile(ctx.root, done.path, done.before).catch(() => undefined);
      }
      const why = err instanceof Error ? err.message : "write failed";
      return fail(`${tool}: could not write ${edit.path} (${why}); rolled back.`);
    }
  }
  return {
    ok: true,
    output: formatRenameResult({ oldName, newName: name.value, files: written }),
    edited: written,
  };
}

/** Run one code-intel tool against the host workspace root. */
export async function runCodeIntelTool(
  name: string,
  args: Record<string, unknown>,
  ctx: CodeIntelContext,
): Promise<CodeIntelResult> {
  try {
    if (name === "code_definition") return await codeDefinition(ctx, args);
    if (name === "code_references") return await codeReferences(ctx, args);
    if (name === "code_symbols") return await codeSymbols(ctx, args);
    if (name === "code_diagnostics") return await codeDiagnostics(ctx, args);
    if (name === "code_rename") return await codeRename(ctx, args);
    return fail(`Unknown code-intel tool ${name}.`);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return fail(`${name} failed: ${why}. Use grep / file_read instead.`);
  }
}

/** Workspace-relative paths a successful file_write / apply_patch / code_rename touched. */
export function editedPathsFromTool(
  name: string,
  args: Record<string, unknown>,
  root: string,
  edited?: CodeIntelFileEdit[],
): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const rel = sanitizeWorkspaceRel(raw, root);
    if (rel && !out.includes(rel)) out.push(rel);
  };
  if (name === "code_rename") for (const file of edited ?? []) push(file.path);
  if (name === "file_write" && typeof args.path === "string") push(args.path);
  if (name === "apply_patch") {
    const cwd = typeof args.cwd === "string" ? args.cwd.trim().replace(/\/+$/, "") : "";
    for (const file of patchFilesFromTool("apply_patch", args)) {
      if (file.kind === "delete") continue;
      const path = file.path.trim();
      push(cwd && !path.startsWith("/") ? `${cwd}/${path}` : path);
    }
  }
  return out;
}

const POST_EDIT_TIMEOUT_MS = 3_000;
const POST_EDIT_MAX_FILES = 8;
/** Per session+file: error signatures already reported, so a later edit only shows new ones. */
const reported = new Map<string, Set<string>>();
const MAX_REPORTED_KEYS = 2_000;

function diagnosticSignature(diag: CodeIntelDiagnostic): string {
  return diag.message.split("\n")[0]!.trim();
}

/**
 * New errors (not warnings) in the edited files, formatted for the tool result, or undefined.
 * Time-boxed; skips silently on timeout, unsupported files, or servers that are not running.
 */
export async function postEditDiagnostics(input: {
  root: string;
  paths: string[];
  /** Usually the session id; scopes the "already reported" memory. */
  key: string;
  timeoutMs?: number;
}): Promise<string | undefined> {
  const deadline = Date.now() + (input.timeoutMs ?? POST_EDIT_TIMEOUT_MS);
  const files: Array<{ rel: string; content: string }> = [];
  for (const raw of input.paths) {
    if (files.length >= POST_EDIT_MAX_FILES) break;
    const rel = sanitizeWorkspaceRel(raw, input.root);
    const lang = rel ? codeIntelLanguage(rel) : undefined;
    if (!rel || !lang || !backendKnownReady(lang, input.root, rel)) continue;
    const content = await readText(input.root, rel);
    if (content !== undefined) files.push({ rel, content });
  }
  if (!files.length) return undefined;
  let diags: CodeIntelDiagnostic[] | typeof TIMED_OUT;
  try {
    diags = await collectDiagnostics(input.root, files, deadline);
  } catch {
    return undefined;
  }
  if (diags === TIMED_OUT) return undefined;
  const fresh: CodeIntelDiagnostic[] = [];
  let repeated = 0;
  for (const file of files) {
    const mapKey = `${input.key}\0${input.root}\0${file.rel}`;
    const before = reported.get(mapKey) ?? new Set<string>();
    const errors = diags.filter((diag) => diag.path === file.rel && diag.severity === "error");
    const now = new Set<string>();
    for (const diag of errors) {
      const sig = diagnosticSignature(diag);
      now.add(sig);
      if (before.has(sig)) repeated += 1;
      else fresh.push(diag);
    }
    reported.delete(mapKey);
    if (now.size) reported.set(mapKey, now);
  }
  while (reported.size > MAX_REPORTED_KEYS) {
    const oldest = reported.keys().next().value;
    if (oldest === undefined) break;
    reported.delete(oldest);
  }
  return formatPostEditDiagnostics({ errors: fresh, repeated });
}

/**
 * Post-edit hook next to lint feedback: after a successful file_write / apply_patch (code_rename
 * settles as apply_patch), append new language-server errors for the touched files.
 * `live` is false for VM / worker mirrors, whose host copy may lag the guest.
 */
export async function appendPostEditDiagnostics<T extends { ok: boolean; output: string }>(
  result: T,
  input: {
    name: string;
    args: Record<string, unknown>;
    root?: string;
    key: string;
    enabled: boolean;
    live: boolean;
  },
): Promise<T> {
  if (!result.ok || !input.enabled || !input.live || !input.root) return result;
  if (input.name !== "file_write" && input.name !== "apply_patch") return result;
  const paths = editedPathsFromTool(input.name, input.args, input.root);
  if (!paths.length) return result;
  const note = await postEditDiagnostics({ root: input.root, paths, key: input.key });
  if (!note) return result;
  return { ...result, output: result.output ? `${result.output}\n\n${note}` : note };
}

/** Test hook: forget probe results and reported errors. */
export function resetAgentCodeIntel(): void {
  pythonProbe.clear();
  reported.clear();
}
