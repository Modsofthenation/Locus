import { readdirSync, type Dirent } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as ts from "typescript-ls";
import {
  getCSSLanguageService,
  getSCSSLanguageService,
  getLESSLanguageService,
} from "vscode-css-languageservice";
import { getLanguageService as getHtmlLanguageService } from "vscode-html-languageservice";
import { getLanguageService as getJsonLanguageService } from "vscode-json-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import { sanitizeWorkspaceRel, WORKSPACE_SKIP_DIRS } from "./workspaceFiles.js";
import {
  completePythonFile,
  formatPythonFile,
  inspectPythonFile,
  isPythonWorkspacePath,
  pythonDiagnostics,
  referencesPythonFile,
  renamePythonSymbol,
  resetWorkspacePython,
} from "./workspacePython.js";
import {
  completeExtraLspFile,
  extraLspDiagnostics,
  formatExtraLspFile,
  inspectExtraLspFile,
  isExtraLspPath,
  referencesExtraLspFile,
  resetWorkspaceExtraLsp,
} from "./workspaceExtraLsp.js";

export type WorkspaceTextEdit = {
  path: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  newText: string;
};

export type WorkspaceCompletionItem = {
  label: string;
  insert: string;
  kind: string;
  detail?: string;
  additionalEdits?: WorkspaceTextEdit[];
};

export type WorkspaceCodeAction = {
  title: string;
  files: Array<{ path: string; content: string }>;
  fixAll?: boolean;
};

export type WorkspaceHighlight = {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  kind: "write" | "read" | "text";
};

export type WorkspaceSymbolHit = {
  path: string;
  kind: "symbol";
  symbol: string;
  score: number;
  line: number;
};

export type WorkspaceInspectResult = {
  diagnostics: WorkspaceDiagnostic[];
  hover: WorkspaceHover | null;
  definition: WorkspaceLocation | null;
  signature: WorkspaceSignatureHelp | null;
  typeDefinition: WorkspaceLocation | null;
  implementation: WorkspaceLocation | null;
  highlights: WorkspaceHighlight[];
  pylsp?: boolean;
};

const TS_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const HTML_EXT = new Set([".html", ".htm", ".vue", ".svelte"]);
const CSS_EXT = new Set([".css", ".pcss"]);
const SCSS_EXT = new Set([".scss"]);
const LESS_EXT = new Set([".less"]);
const JSON_EXT = new Set([".json", ".jsonc"]);
const MAX_SCRIPT_FILES = 2_000;
const MAX_ITEMS = 80;
const MAX_CONTENT = 800_000;
const MAX_PROJECTS = 12;
const MAX_TSCONFIGS = 24;
const MAX_TSCONFIG_DEPTH = 10;

type TsProject = {
  key: string;
  root: string;
  configPath: string | null;
  languageService: ts.LanguageService;
  overlay: Map<string, { text: string; version: number }>;
  fileNames: string[];
};

const projects = new Map<string, TsProject>();
type TsconfigIndex = {
  root: string;
  at: number;
  configs: string[];
  fileNames: Map<string, string[]>;
};
let tsconfigIndex: TsconfigIndex | null = null;
const TSCONFIG_TTL_MS = 5_000;

type CssKind = "css" | "scss" | "less";

let htmlLs: ReturnType<typeof getHtmlLanguageService> | undefined;
let cssLs: ReturnType<typeof getCSSLanguageService> | undefined;
let scssLs: ReturnType<typeof getSCSSLanguageService> | undefined;
let lessLs: ReturnType<typeof getLESSLanguageService> | undefined;
let jsonLs: ReturnType<typeof getJsonLanguageService> | undefined;

function htmlService() {
  htmlLs ??= getHtmlLanguageService();
  return htmlLs;
}

function cssKindFromExt(ext: string): CssKind | undefined {
  if (CSS_EXT.has(ext)) return "css";
  if (SCSS_EXT.has(ext)) return "scss";
  if (LESS_EXT.has(ext)) return "less";
  return undefined;
}

function cssService(kind: CssKind) {
  if (kind === "scss") {
    scssLs ??= getSCSSLanguageService();
    return scssLs;
  }
  if (kind === "less") {
    lessLs ??= getLESSLanguageService();
    return lessLs;
  }
  cssLs ??= getCSSLanguageService();
  return cssLs;
}

function jsonService() {
  jsonLs ??= getJsonLanguageService({});
  return jsonLs;
}

export function resetWorkspaceComplete(): void {
  for (const project of projects.values()) project.languageService.dispose();
  projects.clear();
  tsconfigIndex = null;
  resetWorkspacePython();
  resetWorkspaceExtraLsp();
}

function tsFileName(root: string, rel: string): string {
  return join(root, rel.split("/").join(sep));
}

function typescriptLibDir(): string | undefined {
  try {
    const req = createRequire(import.meta.url);
    return dirname(req.resolve("typescript-ls"));
  } catch {
    return undefined;
  }
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (fileName.endsWith(".ts") || fileName.endsWith(".mts") || fileName.endsWith(".cts")) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JS;
}

function projectKey(root: string, configPath: string | null): string {
  return configPath ?? `${resolve(root)}::__inferred__`;
}

function scanScriptFiles(root: string, max = MAX_SCRIPT_FILES): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (found.length >= max || depth > 8) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (found.length >= max) return;
      if (ent.isDirectory()) {
        if (WORKSPACE_SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
        walk(join(dir, ent.name), depth + 1);
        continue;
      }
      if (TS_EXT.has(extname(ent.name).toLowerCase())) found.push(join(dir, ent.name));
    }
  };
  walk(resolve(root), 0);
  return found;
}

function scanWorkspaceTsconfigs(resolved: string, max: number): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (found.length >= max || depth > MAX_TSCONFIG_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (found.length >= max) return;
      if (ent.name === "tsconfig.json" || ent.name === "jsconfig.json") {
        found.push(join(dir, ent.name));
        continue;
      }
      if (!ent.isDirectory()) continue;
      if (WORKSPACE_SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
      walk(join(dir, ent.name), depth + 1);
    }
  };
  walk(resolved, 0);
  found.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return found;
}

function getTsconfigIndex(root: string, max = MAX_TSCONFIGS): TsconfigIndex {
  const resolved = resolve(root);
  if (
    tsconfigIndex &&
    tsconfigIndex.root === resolved &&
    Date.now() - tsconfigIndex.at < TSCONFIG_TTL_MS
  ) {
    return tsconfigIndex;
  }
  tsconfigIndex = {
    root: resolved,
    at: Date.now(),
    configs: scanWorkspaceTsconfigs(resolved, max),
    fileNames: new Map(),
  };
  return tsconfigIndex;
}

export function listWorkspaceTsconfigs(root: string, max = MAX_TSCONFIGS): string[] {
  // Workspace paths use forward slashes in API payloads on every host.
  return getTsconfigIndex(root, max).configs.map((path) => path.split(sep).join("/"));
}

function readConfigFileNames(configPath: string): string[] {
  const cached = tsconfigIndex?.fileNames.get(configPath);
  if (cached) return cached;
  const read = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, dirname(configPath));
  const names = parsed.fileNames.slice(0, MAX_SCRIPT_FILES);
  tsconfigIndex?.fileNames.set(configPath, names);
  return names;
}

function pickConfigForFile(root: string, rel: string): string | null {
  const abs = resolve(root, rel);
  const configs = listWorkspaceTsconfigs(root);
  let best: { configPath: string; size: number } | null = null;
  for (const configPath of configs) {
    let names: string[] = [];
    try {
      names = readConfigFileNames(configPath);
    } catch {
      continue;
    }
    if (names.some((name) => resolve(name) === abs)) {
      if (!best || names.length < best.size) best = { configPath, size: names.length };
    }
  }
  if (best) return best.configPath;
  let nearest: string | null = null;
  let nearestLen = -1;
  for (const configPath of configs) {
    const dir = dirname(configPath);
    if (abs === dir || abs.startsWith(dir + sep)) {
      if (dir.length > nearestLen) {
        nearest = configPath;
        nearestLen = dir.length;
      }
    }
  }
  return nearest;
}

function touchProject(project: TsProject): TsProject {
  projects.delete(project.key);
  projects.set(project.key, project);
  return project;
}

function evictOldest(keepKey: string): void {
  if (projects.size < MAX_PROJECTS) return;
  for (const key of projects.keys()) {
    if (key === keepKey) continue;
    projects.get(key)?.languageService.dispose();
    projects.delete(key);
    return;
  }
}

function loadTsProject(root: string, configPath: string | null): TsProject {
  const key = projectKey(root, configPath);
  const existing = projects.get(key);
  if (existing) return touchProject(existing);

  let fileNames: string[] = [];
  const options: ts.CompilerOptions = {
    allowJs: true,
    allowNonTsExtensions: true,
    checkJs: false,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  };
  const currentDir = configPath ? dirname(configPath) : resolve(root);
  if (configPath) {
    const read = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
    const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, currentDir);
    Object.assign(options, parsed.options, { skipLibCheck: true, noLib: false });
    fileNames = parsed.fileNames.slice(0, MAX_SCRIPT_FILES);
  } else {
    fileNames = scanScriptFiles(root);
  }

  const libDir = typescriptLibDir();
  const defaultLib = libDir ? join(libDir, ts.getDefaultLibFileName(options)) : "";
  if (!defaultLib || !ts.sys.fileExists(defaultLib)) options.noLib = true;

  const overlay = new Map<string, { text: string; version: number }>();
  const host = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => {
      const names = new Set(fileNames);
      for (const name of overlay.keys()) names.add(name);
      return [...names];
    },
    getScriptVersion: (fileName: string) => overlay.get(fileName)?.version.toString() ?? "0",
    getScriptSnapshot: (fileName: string) => {
      const text = overlay.get(fileName)?.text ?? ts.sys.readFile(fileName);
      return text == null ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getScriptKind: (fileName: string) => scriptKind(fileName),
    getCurrentDirectory: () => currentDir,
    getDefaultLibFileName: (opts: ts.CompilerOptions) =>
      libDir ? join(libDir, ts.getDefaultLibFileName(opts)) : ts.getDefaultLibFileName(opts),
    getDefaultLibLocation: () => libDir ?? "",
    fileExists: (path: string) => overlay.has(path) || ts.sys.fileExists(path),
    readFile: (path: string) => overlay.get(path)?.text ?? ts.sys.readFile(path),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const languageService = ts.createLanguageService(
    host as ts.LanguageServiceHost,
    ts.createDocumentRegistry(),
  );
  evictOldest(key);
  const project: TsProject = {
    key,
    root: resolve(root),
    configPath,
    languageService,
    overlay,
    fileNames,
  };
  projects.set(key, project);
  return project;
}

function loadTsForFile(root: string, rel: string): TsProject {
  return loadTsProject(root, pickConfigForFile(root, rel));
}

function setOverlay(project: TsProject, fileName: string, text: string): void {
  const prev = project.overlay.get(fileName);
  if (prev?.text === text) return;
  project.overlay.set(fileName, { text, version: (prev?.version ?? 0) + 1 });
}

export function offsetAtPosition(text: string, line: number, character: number): number {
  let lineNo = 0;
  let i = 0;
  while (i < text.length && lineNo < line) {
    if (text[i] === "\n") lineNo += 1;
    i += 1;
  }
  return Math.min(text.length, i + Math.max(0, character));
}

function tsKind(kind: string): string {
  if (kind === ts.ScriptElementKind.keyword) return "keyword";
  return "symbol";
}

function completeTypescript(
  root: string,
  rel: string,
  content: string,
  line: number,
  character: number,
): WorkspaceCompletionItem[] {
  const project = loadTsForFile(root, rel);
  const fileName = tsFileName(root, rel);
  setOverlay(project, fileName, content);
  const offset = offsetAtPosition(content, line, character);
  const info = project.languageService.getCompletionsAtPosition(fileName, offset, {
    includeCompletionsForModuleExports: true,
    includeCompletionsWithInsertText: true,
    includeAutomaticOptionalChainCompletions: true,
    includePackageJsonAutoImports: "auto",
    allowIncompleteCompletions: true,
  });
  if (!info?.entries.length) return [];
  const rawPrefix = prefixAt(content, line, character);
  const prefix = (
    info.isMemberCompletion ? (rawPrefix.split(".").pop() ?? "") : rawPrefix
  ).toLowerCase();
  const ranked = info.entries
    .filter((entry) => {
      if (String(entry.kind) === "warning") return false;
      if (!prefix) return true;
      const name = entry.name.toLowerCase();
      const insert = (entry.insertText ?? "").toLowerCase();
      return name.startsWith(prefix) || insert.startsWith(prefix);
    })
    .sort((a, b) => {
      const aBoost = a.hasAction || a.source ? 0 : 1;
      const bBoost = b.hasAction || b.source ? 0 : 1;
      if (aBoost !== bBoost) return aBoost - bBoost;
      return a.name.length - b.name.length;
    });
  const items: WorkspaceCompletionItem[] = [];
  for (const entry of ranked) {
    let insert = entry.insertText ?? entry.name;
    let additionalEdits: WorkspaceTextEdit[] | undefined;
    if ((entry.hasAction || entry.source) && items.length < 24) {
      const details = project.languageService.getCompletionEntryDetails(
        fileName,
        offset,
        entry.name,
        FORMAT,
        entry.source,
        {
          quotePreference: "auto",
          includeCompletionsForModuleExports: true,
          includeCompletionsWithInsertText: true,
          includePackageJsonAutoImports: "auto",
        },
        entry.data,
      );
      if (details?.codeActions?.length) {
        additionalEdits = [];
        for (const action of details.codeActions) {
          for (const change of action.changes) {
            const path =
              relInside(root, change.fileName) || (change.fileName === fileName ? rel : "");
            if (!path) continue;
            const original =
              change.fileName === fileName
                ? content
                : (project.overlay.get(change.fileName)?.text ??
                  ts.sys.readFile(change.fileName) ??
                  "");
            for (const textChange of change.textChanges) {
              const start = tsPosition(original, textChange.span.start);
              const end = tsPosition(original, textChange.span.start + textChange.span.length);
              additionalEdits.push({
                path,
                startLine: start.line,
                startCharacter: start.character,
                endLine: end.line,
                endCharacter: end.character,
                newText: textChange.newText,
              });
            }
          }
        }
      }
      if (details?.name) insert = entry.insertText ?? details.name;
    }
    items.push({
      label: entry.name,
      insert,
      kind: insert.includes("$") ? "snippet" : tsKind(entry.kind),
      detail: entry.source ? `${entry.kind} · ${entry.source}` : entry.kind,
      additionalEdits,
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

function labelOf(item: { label: string | { label: string } }): string {
  return typeof item.label === "string" ? item.label : item.label.label;
}

function insertOf(item: {
  label: string | { label: string };
  insertText?: string | { value?: string };
  textEdit?: { newText?: string; replace?: { newText?: string } };
}): string {
  const label = labelOf(item);
  if (typeof item.insertText === "string" && item.insertText) return item.insertText;
  if (item.insertText && typeof item.insertText === "object" && item.insertText.value) {
    return item.insertText.value;
  }
  if (item.textEdit?.newText) return item.textEdit.newText;
  if (item.textEdit?.replace?.newText) return item.textEdit.replace.newText;
  return label;
}

function lspKind(kind: number | string | undefined): string {
  if (kind === 14 || kind === "keyword") return "keyword";
  if (kind === 15 || kind === "snippet") return "snippet";
  return "symbol";
}

function prefixAt(text: string, line: number, character: number): string {
  const offset = offsetAtPosition(text, line, character);
  return text.slice(0, offset).match(/[A-Za-z_#.@-][\w-]{0,64}$/)?.[0] ?? "";
}

type LsItem = {
  label: string | { label: string };
  insertText?: string | { value?: string };
  textEdit?: { newText?: string; replace?: { newText?: string } };
  kind?: number | string;
  detail?: string;
  documentation?: string | { value?: string };
};

function asLsItem(item: unknown): LsItem | undefined {
  if (!item || typeof item !== "object") return undefined;
  return item as LsItem;
}

function fromLsItems(items: readonly unknown[], prefix: string): WorkspaceCompletionItem[] {
  const needle = prefix.toLowerCase();
  const scored: { item: WorkspaceCompletionItem; score: number }[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const item = asLsItem(raw);
    if (!item) continue;
    const label = labelOf(item);
    if (!label || seen.has(label)) continue;
    const lower = label.toLowerCase();
    let score = 0;
    if (needle) {
      if (lower === needle) score = 0;
      else if (lower.startsWith(needle)) score = 1;
      else if (lower.includes(needle)) score = 2;
      else continue;
    }
    seen.add(label);
    const insert = insertOf(item);
    const detail =
      item.detail ||
      (typeof item.documentation === "string" ? item.documentation : item.documentation?.value);
    scored.push({
      item: {
        label,
        insert,
        kind: insert.includes("$") ? "snippet" : lspKind(item.kind),
        detail,
      },
      score,
    });
  }
  scored.sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
  return scored.slice(0, MAX_ITEMS).map((row) => row.item);
}

function completeHtml(
  root: string,
  rel: string,
  content: string,
  line: number,
  character: number,
): WorkspaceCompletionItem[] {
  const uri = pathToFileURL(join(root, rel)).href;
  const doc = TextDocument.create(uri, "html", 0, content);
  const parsed = htmlService().parseHTMLDocument(doc);
  const list = htmlService().doComplete(doc, { line, character }, parsed);
  return fromLsItems(list.items, prefixAt(content, line, character));
}

function completeCss(
  root: string,
  rel: string,
  content: string,
  line: number,
  character: number,
  kind: CssKind,
  inline = false,
): WorkspaceCompletionItem[] {
  const uri = pathToFileURL(join(root, rel)).href;
  const parsed = cssDocument(uri, kind, content, inline);
  const pos = cssPosInDoc(content, line, character, parsed.prefix);
  const list = parsed.service.doComplete(parsed.doc, pos, parsed.sheet);
  return fromLsItems(list.items, prefixAt(content, line, character));
}

type CssRegion = {
  start: number;
  end: number;
  kind: CssKind;
  inner: string;
  inline?: boolean;
};

const INLINE_CSS_PREFIX = "*{";
const INLINE_CSS_SUFFIX = "}";

function cssDocument(uri: string, kind: CssKind, inner: string, inline = false) {
  const prefix = inline ? INLINE_CSS_PREFIX.length : 0;
  const text = inline ? `${INLINE_CSS_PREFIX}${inner}${INLINE_CSS_SUFFIX}` : inner;
  const doc = TextDocument.create(uri, kind, 0, text);
  const service = cssService(kind);
  return { doc, service, sheet: service.parseStylesheet(doc), prefix, text };
}

function cssPosInDoc(
  inner: string,
  line: number,
  character: number,
  prefix: number,
): { line: number; character: number } {
  if (!prefix) return { line, character };
  return tsPosition(
    `${INLINE_CSS_PREFIX}${inner}`,
    offsetAtPosition(inner, line, character) + prefix,
  );
}

function styleLangFromAttrs(attrs: string): CssKind {
  const hit = attrs.match(/\blang\s*=\s*["']?\s*(scss|sass|less|css)\b/i);
  const lang = hit?.[1]?.toLowerCase();
  if (lang === "less") return "less";
  if (lang === "scss" || lang === "sass") return "scss";
  return "css";
}

function insideHtmlTag(content: string, index: number): boolean {
  const open = content.lastIndexOf("<", index);
  if (open < 0) return false;
  const close = content.lastIndexOf(">", index);
  return open > close;
}

function cssRegions(content: string): CssRegion[] {
  const out: CssRegion[] = [];
  const styleTag = /<style\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = styleTag.exec(content))) {
    const start = styleTag.lastIndex;
    const close = content.slice(start).search(/<\/style\s*>/i);
    const end = close < 0 ? content.length : start + close;
    out.push({
      start,
      end,
      kind: styleLangFromAttrs(match[1] ?? ""),
      inner: content.slice(start, end),
    });
    styleTag.lastIndex = Math.max(end, start + 1);
  }
  const attr = /(?<![\w-])style\s*=\s*(["'])/gi;
  while ((match = attr.exec(content))) {
    if (!insideHtmlTag(content, match.index)) {
      attr.lastIndex = Math.max(attr.lastIndex, match.index + 1);
      continue;
    }
    const quote = match[1]!;
    const start = attr.lastIndex;
    let end = start;
    while (end < content.length && content[end] !== quote && content[end] !== "\n") {
      if (content[end] === "\\") end += 2;
      else end += 1;
    }
    out.push({ start, end, kind: "css", inner: content.slice(start, end), inline: true });
    attr.lastIndex = Math.max(end, start + 1);
  }
  return out;
}

function cssRegionAt(
  content: string,
  line: number,
  character: number,
): (CssRegion & { line: number; character: number }) | undefined {
  const offset = offsetAtPosition(content, line, character);
  for (const region of cssRegions(content)) {
    if (offset < region.start || offset > region.end) continue;
    const innerPos = tsPosition(region.inner, offset - region.start);
    return { ...region, line: innerPos.line, character: innerPos.character };
  }
  return undefined;
}

function remapCssRange(
  content: string,
  origin: number,
  inner: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  prefix = 0,
): {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
} {
  const wrapped = prefix ? `${INLINE_CSS_PREFIX}${inner}` : inner;
  const startOff = Math.min(
    inner.length,
    Math.max(0, offsetAtPosition(wrapped, range.start.line, range.start.character) - prefix),
  );
  const endOff = Math.min(
    inner.length,
    Math.max(0, offsetAtPosition(wrapped, range.end.line, range.end.character) - prefix),
  );
  const start = tsPosition(content, origin + startOff);
  const end = tsPosition(content, origin + endOff);
  return {
    startLine: start.line,
    startCharacter: start.character,
    endLine: end.line,
    endCharacter: end.character,
  };
}

function stripLsMarkup(text: string): string {
  return text
    .replace(/```[\w+-]*\r?\n?([\s\S]*?)```/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function lsMarkupText(contents: unknown): string {
  const parts = Array.isArray(contents) ? contents : [contents];
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") out.push(stripLsMarkup(part));
    else if (part && typeof part === "object" && "value" in part) {
      const rec = part as { value?: unknown; language?: unknown };
      if (typeof rec.value === "string") {
        out.push(typeof rec.language === "string" ? rec.value : stripLsMarkup(rec.value));
      }
    }
  }
  return out.filter(Boolean).join("\n\n").trim();
}

function uriRel(root: string, uri: string): string {
  try {
    return relInside(root, fileURLToPath(uri));
  } catch {
    return "";
  }
}

function lsSeverity(severity: number | undefined): "error" | "warning" | "info" {
  if (severity === 1) return "error";
  if (severity === 2) return "warning";
  return "info";
}

function cssDiagnosticsFor(
  root: string,
  rel: string,
  full: string,
  inner: string,
  kind: CssKind,
  origin: number,
  inline = false,
): WorkspaceDiagnostic[] {
  const uri = pathToFileURL(join(root, rel)).href;
  const parsed = cssDocument(uri, kind, inner, inline);
  const out: WorkspaceDiagnostic[] = [];
  for (const diag of parsed.service.doValidation(parsed.doc, parsed.sheet)) {
    const range = remapCssRange(full, origin, inner, diag.range, parsed.prefix);
    out.push({
      path: rel,
      ...range,
      message: diag.message,
      severity: lsSeverity(diag.severity),
    });
    if (out.length >= 80) break;
  }
  return out;
}

function inspectCss(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
  kind: CssKind;
  region?: CssRegion;
}): WorkspaceInspectResult {
  const inner = input.region?.inner ?? input.content;
  const origin = input.region?.start ?? 0;
  const uri = pathToFileURL(join(input.root, input.rel)).href;
  const parsed = cssDocument(uri, input.kind, inner, input.region?.inline);
  const pos = cssPosInDoc(inner, input.line, input.character, parsed.prefix);
  const remap = (range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  }) =>
    range
      ? remapCssRange(input.content, origin, inner, range, parsed.prefix)
      : {
          startLine: input.line,
          startCharacter: input.character,
          endLine: input.line,
          endCharacter: input.character,
        };
  const diagnostics = cssDiagnosticsFor(
    input.root,
    input.rel,
    input.content,
    inner,
    input.kind,
    origin,
    input.region?.inline,
  );
  const hoverRaw = parsed.service.doHover(parsed.doc, pos, parsed.sheet);
  const hoverText = hoverRaw ? lsMarkupText(hoverRaw.contents) : "";
  const hover = hoverText ? { text: hoverText, ...remap(hoverRaw?.range ?? undefined) } : null;
  const def = parsed.service.findDefinition(parsed.doc, pos, parsed.sheet);
  let definition: WorkspaceLocation | null = null;
  if (def) {
    const path = uriRel(input.root, def.uri) || input.rel;
    const range = path === input.rel ? remap(def.range) : undefined;
    definition = {
      path,
      line: range?.startLine ?? def.range.start.line,
      character: range?.startCharacter ?? def.range.start.character,
    };
  }
  const highlights: WorkspaceHighlight[] = [];
  for (const hit of parsed.service.findDocumentHighlights(parsed.doc, pos, parsed.sheet)) {
    const range = remap(hit.range);
    highlights.push({
      ...range,
      kind: hit.kind === 3 ? "write" : hit.kind === 2 ? "read" : "text",
    });
    if (highlights.length >= 80) break;
  }
  return {
    diagnostics,
    hover,
    definition,
    signature: null,
    typeDefinition: null,
    implementation: null,
    highlights,
  };
}

export async function completeWorkspaceFile(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
}): Promise<{ items: WorkspaceCompletionItem[]; source: string }> {
  const rel = sanitizeWorkspaceRel(input.rel);
  if (!rel) return { items: [], source: "none" };
  const content =
    input.content.length > MAX_CONTENT ? input.content.slice(0, MAX_CONTENT) : input.content;
  const line = Math.max(0, Math.floor(input.line) || 0);
  const character = Math.max(0, Math.floor(input.character) || 0);
  const ext = extname(rel).toLowerCase();
  try {
    if (TS_EXT.has(ext)) {
      return {
        items: completeTypescript(input.root, rel, content, line, character),
        source: "typescript",
      };
    }
    if (HTML_EXT.has(ext)) {
      const region = cssRegionAt(content, line, character);
      if (region) {
        return {
          items: completeCss(
            input.root,
            rel,
            region.inner,
            region.line,
            region.character,
            region.kind,
            region.inline,
          ),
          source: "css",
        };
      }
      return { items: completeHtml(input.root, rel, content, line, character), source: "html" };
    }
    const cssKind = cssKindFromExt(ext);
    if (cssKind) {
      return {
        items: completeCss(input.root, rel, content, line, character, cssKind),
        source: "css",
      };
    }
    if (isPythonWorkspacePath(rel)) {
      return completePythonFile({ root: input.root, rel, content, line, character });
    }
    if (isExtraLspPath(rel)) {
      return completeExtraLspFile({ root: input.root, rel, content, line, character });
    }
  } catch {
    return { items: [], source: "none" };
  }
  return { items: [], source: "none" };
}

export type WorkspaceDiagnostic = {
  path: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  message: string;
  severity: "error" | "warning" | "info";
};

export type WorkspaceHover = {
  text: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
};

export type WorkspaceLocation = {
  path: string;
  line: number;
  character: number;
};

export type WorkspaceSignatureHelp = {
  label: string;
  documentation?: string;
  activeParameter: number;
  parameters: Array<{ label: string; documentation?: string }>;
};

const FORMAT: ts.FormatCodeSettings = {
  indentSize: 2,
  tabSize: 2,
  convertTabsToSpaces: true,
  insertSpaceAfterCommaDelimiter: true,
  insertSpaceAfterSemicolonInForStatements: true,
  insertSpaceBeforeAndAfterBinaryOperators: true,
  insertSpaceAfterKeywordsInControlFlowStatements: true,
  insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
  placeOpenBraceOnNewLineForFunctions: false,
  placeOpenBraceOnNewLineForControlBlocks: false,
};

function relInside(root: string, abs: string): string {
  const rel = relative(root, abs).split(sep).join("/");
  if (!rel || rel.startsWith("..") || rel.startsWith("/")) return "";
  return rel;
}

function tsPosition(text: string, offset: number): { line: number; character: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let last = 0;
  for (let i = 0; i < clamped; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      last = i + 1;
    }
  }
  return { line, character: clamped - last };
}

function tsSeverity(category: ts.DiagnosticCategory): "error" | "warning" | "info" {
  if (category === ts.DiagnosticCategory.Error) return "error";
  if (category === ts.DiagnosticCategory.Warning) return "warning";
  return "info";
}

function diagnosticMessage(diag: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diag.messageText, "\n");
}

export async function inspectWorkspaceFile(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
}): Promise<WorkspaceInspectResult> {
  const empty: WorkspaceInspectResult = {
    diagnostics: [],
    hover: null,
    definition: null,
    signature: null,
    typeDefinition: null,
    implementation: null,
    highlights: [],
  };
  const rel = sanitizeWorkspaceRel(input.rel);
  if (!rel) return empty;
  const content =
    input.content.length > MAX_CONTENT ? input.content.slice(0, MAX_CONTENT) : input.content;
  const ext = extname(rel).toLowerCase();
  if (isPythonWorkspacePath(rel)) {
    const py = await inspectPythonFile({
      root: input.root,
      rel,
      content,
      line: input.line,
      character: input.character,
    });
    return {
      ...empty,
      diagnostics: py.diagnostics,
      hover: py.hover,
      definition: py.definition,
      signature: py.signature,
      pylsp: py.pylsp,
    };
  }
  if (isExtraLspPath(rel)) {
    return inspectExtraLspFile({
      root: input.root,
      rel,
      content,
      line: input.line,
      character: input.character,
    });
  }
  const cssKind = cssKindFromExt(ext);
  if (cssKind) {
    return inspectCss({
      root: input.root,
      rel,
      content,
      line: input.line,
      character: input.character,
      kind: cssKind,
    });
  }
  if (HTML_EXT.has(ext)) {
    const region = cssRegionAt(content, input.line, input.character);
    if (region) {
      return inspectCss({
        root: input.root,
        rel,
        content,
        line: region.line,
        character: region.character,
        kind: region.kind,
        region,
      });
    }
  }
  if (!TS_EXT.has(ext)) return empty;
  const project = loadTsForFile(input.root, rel);
  const fileName = tsFileName(input.root, rel);
  setOverlay(project, fileName, content);
  const offset = offsetAtPosition(content, input.line, input.character);
  const diagnostics: WorkspaceDiagnostic[] = [];
  const diags = [
    ...project.languageService.getSyntacticDiagnostics(fileName),
    ...project.languageService.getSemanticDiagnostics(fileName),
  ];
  for (const diag of diags) {
    if (diag.file?.fileName !== fileName || diag.start == null) continue;
    const start = tsPosition(content, diag.start);
    const end = tsPosition(content, diag.start + (diag.length ?? 0));
    diagnostics.push({
      path: rel,
      startLine: start.line,
      startCharacter: start.character,
      endLine: end.line,
      endCharacter: end.character,
      message: diagnosticMessage(diag),
      severity: tsSeverity(diag.category),
    });
    if (diagnostics.length >= 80) break;
  }
  let hover: WorkspaceHover | null = null;
  const info = project.languageService.getQuickInfoAtPosition(fileName, offset);
  if (info) {
    const start = tsPosition(content, info.textSpan.start);
    const end = tsPosition(content, info.textSpan.start + info.textSpan.length);
    const text = ts.displayPartsToString(info.displayParts);
    const docs = ts.displayPartsToString(info.documentation);
    hover = {
      text: docs ? `${text}\n\n${docs}` : text,
      startLine: start.line,
      startCharacter: start.character,
      endLine: end.line,
      endCharacter: end.character,
    };
  }
  const definition = locationFromSpan(
    input.root,
    rel,
    fileName,
    content,
    project.overlay,
    project.languageService.getDefinitionAtPosition(fileName, offset)?.[0],
  );
  const typeDefinition = locationFromSpan(
    input.root,
    rel,
    fileName,
    content,
    project.overlay,
    project.languageService.getTypeDefinitionAtPosition(fileName, offset)?.[0],
  );
  const implementation = locationFromSpan(
    input.root,
    rel,
    fileName,
    content,
    project.overlay,
    project.languageService.getImplementationAtPosition(fileName, offset)?.[0],
  );
  let signature: WorkspaceSignatureHelp | null = null;
  const sigItems = project.languageService.getSignatureHelpItems(fileName, offset, {});
  const sigItem = sigItems?.items[sigItems.selectedItemIndex] ?? sigItems?.items[0];
  if (sigItems && sigItem) {
    const parts = [
      ...sigItem.prefixDisplayParts,
      ...sigItem.parameters.flatMap((param, i) => [
        ...(i ? sigItem.separatorDisplayParts : []),
        ...param.displayParts,
      ]),
      ...sigItem.suffixDisplayParts,
    ];
    signature = {
      label: ts.displayPartsToString(parts),
      documentation: ts.displayPartsToString(sigItem.documentation) || undefined,
      activeParameter: sigItems.argumentIndex,
      parameters: sigItem.parameters.map((param) => ({
        label: ts.displayPartsToString(param.displayParts),
        documentation: ts.displayPartsToString(param.documentation) || undefined,
      })),
    };
  }
  const highlights = documentHighlights(
    project.languageService.getDocumentHighlights(fileName, offset, [fileName]),
    fileName,
    content,
  );
  return {
    diagnostics,
    hover,
    definition,
    signature,
    typeDefinition,
    implementation,
    highlights,
  };
}

function locationFromSpan(
  root: string,
  rel: string,
  fileName: string,
  content: string,
  overlay: Map<string, { text: string; version: number }>,
  hit: { fileName: string; textSpan: { start: number } } | undefined,
): WorkspaceLocation | null {
  if (!hit) return null;
  const defRel = relInside(root, hit.fileName) || (hit.fileName === fileName ? rel : "");
  if (!defRel) return null;
  const defText =
    hit.fileName === fileName
      ? content
      : (overlay.get(hit.fileName)?.text ?? ts.sys.readFile(hit.fileName) ?? "");
  const pos = tsPosition(defText, hit.textSpan.start);
  return { path: defRel, line: pos.line, character: pos.character };
}

function documentHighlights(
  rows: readonly ts.DocumentHighlights[] | undefined,
  fileName: string,
  content: string,
): WorkspaceHighlight[] {
  const out: WorkspaceHighlight[] = [];
  for (const row of rows ?? []) {
    if (row.fileName !== fileName) continue;
    for (const span of row.highlightSpans) {
      const start = tsPosition(content, span.textSpan.start);
      const end = tsPosition(content, span.textSpan.start + span.textSpan.length);
      const kind =
        span.kind === ts.HighlightSpanKind.writtenReference
          ? "write"
          : span.kind === ts.HighlightSpanKind.reference
            ? "read"
            : "text";
      out.push({
        startLine: start.line,
        startCharacter: start.character,
        endLine: end.line,
        endCharacter: end.character,
        kind,
      });
      if (out.length >= 80) return out;
    }
  }
  return out;
}

function applyTsEdits(text: string, edits: readonly ts.TextChange[]): string {
  const ordered = [...edits].sort((a, b) => b.span.start - a.span.start);
  let next = text;
  for (const edit of ordered) {
    next =
      next.slice(0, edit.span.start) +
      edit.newText +
      next.slice(edit.span.start + edit.span.length);
  }
  return next;
}

export async function formatWorkspaceFile(input: {
  root: string;
  rel: string;
  content: string;
}): Promise<{
  content: string;
  source: string;
}> {
  const rel = sanitizeWorkspaceRel(input.rel);
  if (!rel) return { content: input.content, source: "none" };
  if (input.content.length > MAX_CONTENT) return { content: input.content, source: "none" };
  const content = input.content;
  const ext = extname(rel).toLowerCase();
  if (TS_EXT.has(ext)) {
    const project = loadTsForFile(input.root, rel);
    const fileName = tsFileName(input.root, rel);
    setOverlay(project, fileName, content);
    const edits = project.languageService.getFormattingEditsForDocument(fileName, FORMAT);
    return { content: applyTsEdits(content, edits), source: "typescript" };
  }
  if (HTML_EXT.has(ext) || cssKindFromExt(ext) || JSON_EXT.has(ext)) {
    return { content: formatWebFile(input.root, rel, content, ext), source: webFormatSource(ext) };
  }
  if (isPythonWorkspacePath(rel)) return formatPythonFile({ root: input.root, rel, content });
  if (isExtraLspPath(rel)) return formatExtraLspFile({ root: input.root, rel, content });
  return { content, source: "none" };
}

function webFormatSource(ext: string): string {
  if (HTML_EXT.has(ext)) return "html";
  if (JSON_EXT.has(ext)) return "json";
  return "css";
}

function formatWebFile(root: string, rel: string, content: string, ext: string): string {
  const uri = pathToFileURL(join(root, rel)).href;
  const options = { tabSize: 2, insertSpaces: true };
  if (HTML_EXT.has(ext)) {
    const doc = TextDocument.create(uri, "html", 0, content);
    const edits = htmlService().format(doc, undefined, options);
    return TextDocument.applyEdits(doc, edits);
  }
  if (CSS_EXT.has(ext) || SCSS_EXT.has(ext) || LESS_EXT.has(ext)) {
    const kind = cssKindFromExt(ext) ?? "css";
    const doc = TextDocument.create(uri, kind, 0, content);
    const edits = cssService(kind).format(doc, undefined, options);
    return TextDocument.applyEdits(doc, edits);
  }
  const doc = TextDocument.create(uri, "json", 0, content);
  const range = { start: { line: 0, character: 0 }, end: doc.positionAt(content.length) };
  const edits = jsonService().format(doc, range, options);
  return TextDocument.applyEdits(doc, edits);
}

export function organizeWorkspaceImports(input: { root: string; rel: string; content: string }): {
  content: string;
  source: string;
} {
  const rel = sanitizeWorkspaceRel(input.rel);
  if (!rel) return { content: input.content, source: "none" };
  if (input.content.length > MAX_CONTENT) return { content: input.content, source: "none" };
  const content = input.content;
  const ext = extname(rel).toLowerCase();
  if (!TS_EXT.has(ext)) return { content, source: "none" };
  const project = loadTsForFile(input.root, rel);
  const fileName = tsFileName(input.root, rel);
  setOverlay(project, fileName, content);
  const edits = project.languageService.organizeImports({ type: "file", fileName }, FORMAT, {});
  const changes = edits.flatMap((item) => item.textChanges);
  return { content: applyTsEdits(content, changes), source: "typescript" };
}

function referencesCssFile(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
  ext: string;
}): { items: WorkspaceLocation[] } | undefined {
  const kind = cssKindFromExt(input.ext);
  const region =
    !kind && HTML_EXT.has(input.ext)
      ? cssRegionAt(input.content, input.line, input.character)
      : undefined;
  const cssKind = kind ?? region?.kind;
  if (!cssKind) return undefined;
  const inner = region?.inner ?? input.content;
  const origin = region?.start ?? 0;
  const line = region?.line ?? input.line;
  const character = region?.character ?? input.character;
  const uri = pathToFileURL(join(input.root, input.rel)).href;
  const parsed = cssDocument(uri, cssKind, inner, region?.inline);
  const pos = cssPosInDoc(inner, line, character, parsed.prefix);
  const items: WorkspaceLocation[] = [];
  for (const loc of parsed.service.findReferences(parsed.doc, pos, parsed.sheet)) {
    const path = uriRel(input.root, loc.uri) || input.rel;
    const range =
      path === input.rel
        ? remapCssRange(input.content, origin, inner, loc.range, parsed.prefix)
        : undefined;
    items.push({
      path,
      line: range?.startLine ?? loc.range.start.line,
      character: range?.startCharacter ?? loc.range.start.character,
    });
    if (items.length >= 80) break;
  }
  return { items };
}

function renameCssSymbol(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
  newName: string;
  ext: string;
}): { files: Array<{ path: string; content: string }> } | undefined {
  const kind = cssKindFromExt(input.ext);
  const region =
    !kind && HTML_EXT.has(input.ext)
      ? cssRegionAt(input.content, input.line, input.character)
      : undefined;
  const cssKind = kind ?? region?.kind;
  if (!cssKind) return undefined;
  const inner = region?.inner ?? input.content;
  const origin = region?.start ?? 0;
  const line = region?.line ?? input.line;
  const character = region?.character ?? input.character;
  const uri = pathToFileURL(join(input.root, input.rel)).href;
  const parsed = cssDocument(uri, cssKind, inner, region?.inline);
  const pos = cssPosInDoc(inner, line, character, parsed.prefix);
  const edit = parsed.service.doRename(parsed.doc, pos, input.newName, parsed.sheet);
  const changes = edit.changes ?? {};
  const files: Array<{ path: string; content: string }> = [];
  for (const [target, textEdits] of Object.entries(changes)) {
    const path = uriRel(input.root, target) || (target === uri ? input.rel : "");
    if (!path) continue;
    const original = path === input.rel ? input.content : "";
    if (!original) continue;
    const mapped = (textEdits ?? []).map((item) => {
      const range = remapCssRange(original, origin, inner, item.range, parsed.prefix);
      return {
        range: {
          start: { line: range.startLine, character: range.startCharacter },
          end: { line: range.endLine, character: range.endCharacter },
        },
        newText: item.newText,
      };
    });
    const applyDoc = TextDocument.create(uri, cssKind, 0, original);
    files.push({ path, content: TextDocument.applyEdits(applyDoc, mapped) });
  }
  return { files };
}

export async function renameWorkspaceSymbol(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
  newName: string;
}): Promise<{ files: Array<{ path: string; content: string }> }> {
  const rel = sanitizeWorkspaceRel(input.rel);
  const name = input.newName.trim();
  if (!rel || !name) return { files: [] };
  if (input.content.length > MAX_CONTENT) return { files: [] };
  const content = input.content;
  const ext = extname(rel).toLowerCase();
  if (isPythonWorkspacePath(rel)) {
    return renamePythonSymbol({
      root: input.root,
      rel,
      content,
      line: input.line,
      character: input.character,
      newName: name,
    });
  }
  const cssRename = renameCssSymbol({
    root: input.root,
    rel,
    content,
    line: input.line,
    character: input.character,
    newName: name,
    ext,
  });
  if (cssRename) return cssRename;
  if (!TS_EXT.has(ext)) return { files: [] };
  const project = loadTsForFile(input.root, rel);
  const fileName = tsFileName(input.root, rel);
  setOverlay(project, fileName, content);
  const offset = offsetAtPosition(content, input.line, input.character);
  const locations = project.languageService.findRenameLocations(
    fileName,
    offset,
    false,
    false,
    true,
  );
  if (!locations?.length) return { files: [] };
  const byFile = new Map<string, ts.RenameLocation[]>();
  for (const loc of locations) {
    const list = byFile.get(loc.fileName) ?? [];
    list.push(loc);
    byFile.set(loc.fileName, list);
  }
  const files: Array<{ path: string; content: string }> = [];
  for (const [abs, locs] of byFile) {
    const path = relInside(input.root, abs);
    if (!path) continue;
    const original =
      abs === fileName ? content : (project.overlay.get(abs)?.text ?? ts.sys.readFile(abs) ?? "");
    const edits = locs.map((loc) => ({
      span: loc.textSpan,
      newText: `${loc.prefixText ?? ""}${name}${loc.suffixText ?? ""}`,
    }));
    const next = applyTsEdits(original, edits);
    setOverlay(project, abs, next);
    files.push({ path, content: next });
  }
  return { files };
}

export async function referencesWorkspaceFile(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
}): Promise<{ items: WorkspaceLocation[] }> {
  const rel = sanitizeWorkspaceRel(input.rel);
  if (!rel) return { items: [] };
  if (input.content.length > MAX_CONTENT) return { items: [] };
  const content = input.content;
  const ext = extname(rel).toLowerCase();
  if (isPythonWorkspacePath(rel)) {
    return referencesPythonFile({
      root: input.root,
      rel,
      content,
      line: input.line,
      character: input.character,
    });
  }
  if (isExtraLspPath(rel)) {
    return referencesExtraLspFile({
      root: input.root,
      rel,
      content,
      line: input.line,
      character: input.character,
    });
  }
  const cssRefs = referencesCssFile({
    root: input.root,
    rel,
    content,
    line: input.line,
    character: input.character,
    ext,
  });
  if (cssRefs) return cssRefs;
  if (!TS_EXT.has(ext)) return { items: [] };
  const project = loadTsForFile(input.root, rel);
  const fileName = tsFileName(input.root, rel);
  setOverlay(project, fileName, content);
  const offset = offsetAtPosition(content, input.line, input.character);
  const refs = project.languageService.getReferencesAtPosition(fileName, offset) ?? [];
  const items: WorkspaceLocation[] = [];
  for (const ref of refs) {
    const path = relInside(input.root, ref.fileName) || (ref.fileName === fileName ? rel : "");
    if (!path) continue;
    const text =
      ref.fileName === fileName
        ? content
        : (project.overlay.get(ref.fileName)?.text ?? ts.sys.readFile(ref.fileName) ?? "");
    const pos = tsPosition(text, ref.textSpan.start);
    items.push({ path, line: pos.line, character: pos.character });
    if (items.length >= 80) break;
  }
  return { items };
}

export function navigateWorkspaceSymbols(input: { root: string; query: string; limit?: number }): {
  items: WorkspaceSymbolHit[];
} {
  const query = input.query.trim();
  if (!query) return { items: [] };
  const configs = listWorkspaceTsconfigs(input.root).slice(0, 8);
  const projects = configs.length
    ? configs.map((configPath) => loadTsProject(input.root, configPath))
    : [loadTsProject(input.root, null)];
  const limit = Math.min(40, Math.max(1, input.limit ?? 40));
  const items: WorkspaceSymbolHit[] = [];
  const seen = new Set<string>();
  for (const project of projects) {
    const found = project.languageService.getNavigateToItems(query, limit, undefined, true, true);
    for (const hit of found) {
      const path = relInside(input.root, hit.fileName);
      if (!path) continue;
      const text = project.overlay.get(hit.fileName)?.text ?? ts.sys.readFile(hit.fileName) ?? "";
      const pos = tsPosition(text, hit.textSpan.start);
      const symbol = hit.containerName ? `${hit.containerName}.${hit.name}` : hit.name;
      const key = `${path}:${symbol}:${pos.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const score =
        hit.matchKind === "exact"
          ? 100
          : hit.matchKind === "prefix"
            ? 80
            : hit.matchKind === "substring"
              ? 50
              : 20;
      items.push({
        path,
        kind: "symbol",
        symbol,
        score,
        line: pos.line + 1,
      });
    }
  }
  items.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { items: items.slice(0, limit) };
}

export function applyWorkspaceEdits(
  files: Map<string, string>,
  edits: WorkspaceTextEdit[],
): Map<string, string> {
  const grouped = new Map<string, WorkspaceTextEdit[]>();
  for (const edit of edits) {
    const list = grouped.get(edit.path) ?? [];
    list.push(edit);
    grouped.set(edit.path, list);
  }
  const next = new Map(files);
  for (const [path, list] of grouped) {
    const original = next.get(path);
    if (original == null) continue;
    const ordered = [...list].sort((a, b) => {
      if (a.startLine !== b.startLine) return b.startLine - a.startLine;
      return b.startCharacter - a.startCharacter;
    });
    let text = original;
    for (const edit of ordered) {
      const start = offsetAtPosition(text, edit.startLine, edit.startCharacter);
      const end = offsetAtPosition(text, edit.endLine, edit.endCharacter);
      text = text.slice(0, start) + edit.newText + text.slice(end);
    }
    next.set(path, text);
  }
  return next;
}

export function fixWorkspaceFile(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
}): WorkspaceCodeAction[] {
  const rel = sanitizeWorkspaceRel(input.rel);
  if (!rel) return [];
  if (input.content.length > MAX_CONTENT) return [];
  const ext = extname(rel).toLowerCase();
  if (!TS_EXT.has(ext)) return [];
  const project = loadTsForFile(input.root, rel);
  const fileName = tsFileName(input.root, rel);
  setOverlay(project, fileName, input.content);
  const offset = offsetAtPosition(input.content, input.line, input.character);
  const diags = [
    ...project.languageService.getSyntacticDiagnostics(fileName),
    ...project.languageService.getSemanticDiagnostics(fileName),
    ...project.languageService.getSuggestionDiagnostics(fileName),
  ];
  const codes = new Set<number>();
  for (const diag of diags) {
    if (diag.file?.fileName !== fileName || diag.start == null) continue;
    const start = diag.start;
    const end = start + (diag.length ?? 0);
    if (offset < start || offset > end) continue;
    codes.add(diag.code as number);
  }
  if (!codes.size) {
    for (const diag of diags) {
      if (diag.file?.fileName !== fileName || diag.start == null) continue;
      const at = tsPosition(input.content, diag.start);
      if (at.line === input.line) codes.add(diag.code as number);
    }
  }
  if (!codes.size) return [];
  const spanStart = Math.max(0, offset);
  const fixes = project.languageService.getCodeFixesAtPosition(
    fileName,
    spanStart,
    Math.max(spanStart, offset),
    [...codes],
    FORMAT,
    { quotePreference: "auto", includeCompletionsForModuleExports: true },
  );
  const actions: WorkspaceCodeAction[] = [];
  for (const fix of fixes) {
    const files = new Map<string, string>();
    const edits: WorkspaceTextEdit[] = [];
    for (const change of fix.changes) {
      const path =
        relInside(input.root, change.fileName) || (change.fileName === fileName ? rel : "");
      if (!path) continue;
      const original =
        change.fileName === fileName
          ? input.content
          : (project.overlay.get(change.fileName)?.text ?? ts.sys.readFile(change.fileName) ?? "");
      files.set(path, original);
      for (const textChange of change.textChanges) {
        const start = tsPosition(original, textChange.span.start);
        const end = tsPosition(original, textChange.span.start + textChange.span.length);
        edits.push({
          path,
          startLine: start.line,
          startCharacter: start.character,
          endLine: end.line,
          endCharacter: end.character,
          newText: textChange.newText,
        });
      }
    }
    const next = applyWorkspaceEdits(files, edits);
    actions.push({
      title: fix.description,
      files: [...next.entries()].map(([path, content]) => ({ path, content })),
    });
    if (actions.length >= 10) break;
  }
  const seenFixAll = new Set<string>();
  for (const fix of fixes) {
    if (actions.length >= 12) break;
    if (fix.fixId == null || !fix.fixAllDescription) {
      continue;
    }
    const id = String(fix.fixId);
    if (seenFixAll.has(id)) continue;
    seenFixAll.add(id);
    let combined: ts.CombinedCodeActions;
    try {
      combined = project.languageService.getCombinedCodeFix(
        { type: "file", fileName },
        fix.fixId,
        FORMAT,
        { quotePreference: "auto", includeCompletionsForModuleExports: true },
      );
    } catch {
      continue;
    }
    const files = new Map<string, string>();
    const edits: WorkspaceTextEdit[] = [];
    for (const change of combined.changes) {
      const path =
        relInside(input.root, change.fileName) || (change.fileName === fileName ? rel : "");
      if (!path) continue;
      const original =
        change.fileName === fileName
          ? input.content
          : (project.overlay.get(change.fileName)?.text ?? ts.sys.readFile(change.fileName) ?? "");
      files.set(path, original);
      for (const textChange of change.textChanges) {
        const start = tsPosition(original, textChange.span.start);
        const end = tsPosition(original, textChange.span.start + textChange.span.length);
        edits.push({
          path,
          startLine: start.line,
          startCharacter: start.character,
          endLine: end.line,
          endCharacter: end.character,
          newText: textChange.newText,
        });
      }
    }
    const next = applyWorkspaceEdits(files, edits);
    if (!next.size) continue;
    actions.push({
      title: fix.fixAllDescription,
      files: [...next.entries()].map(([path, content]) => ({ path, content })),
      fixAll: true,
    });
  }
  return actions;
}

export async function problemsWorkspaceFiles(input: {
  root: string;
  files: Array<{ rel: string; content: string }>;
}): Promise<{ diagnostics: WorkspaceDiagnostic[] }> {
  const diagnostics: WorkspaceDiagnostic[] = [];
  for (const file of input.files.slice(0, 24)) {
    const rel = sanitizeWorkspaceRel(file.rel);
    if (!rel) continue;
    const content =
      file.content.length > MAX_CONTENT ? file.content.slice(0, MAX_CONTENT) : file.content;
    if (isPythonWorkspacePath(rel)) {
      diagnostics.push(...(await pythonDiagnostics(input.root, rel, content)));
      continue;
    }
    if (isExtraLspPath(rel)) {
      diagnostics.push(...(await extraLspDiagnostics(input.root, rel, content)));
      continue;
    }
    const ext = extname(rel).toLowerCase();
    const cssKind = cssKindFromExt(ext);
    if (cssKind) {
      diagnostics.push(...cssDiagnosticsFor(input.root, rel, content, content, cssKind, 0));
      if (diagnostics.length >= 200) return { diagnostics };
      continue;
    }
    if (HTML_EXT.has(ext)) {
      for (const region of cssRegions(content)) {
        diagnostics.push(
          ...cssDiagnosticsFor(
            input.root,
            rel,
            content,
            region.inner,
            region.kind,
            region.start,
            region.inline,
          ),
        );
        if (diagnostics.length >= 200) return { diagnostics };
      }
      continue;
    }
    if (!TS_EXT.has(ext)) continue;
    const project = loadTsForFile(input.root, rel);
    const fileName = tsFileName(input.root, rel);
    setOverlay(project, fileName, content);
    const diags = [
      ...project.languageService.getSyntacticDiagnostics(fileName),
      ...project.languageService.getSemanticDiagnostics(fileName),
    ];
    for (const diag of diags) {
      if (diag.file?.fileName !== fileName || diag.start == null) continue;
      const start = tsPosition(content, diag.start);
      const end = tsPosition(content, diag.start + (diag.length ?? 0));
      diagnostics.push({
        path: rel,
        startLine: start.line,
        startCharacter: start.character,
        endLine: end.line,
        endCharacter: end.character,
        message: diagnosticMessage(diag),
        severity: tsSeverity(diag.category),
      });
      if (diagnostics.length >= 200) return { diagnostics };
    }
  }
  return { diagnostics };
}
