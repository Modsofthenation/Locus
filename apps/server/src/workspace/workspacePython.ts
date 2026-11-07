import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LspClient, type LspDiagnostic, type LspRange, type LspTextEdit } from "./workspaceLsp.js";
import {
  sanitizeWorkspaceRel,
  WORKSPACE_FILE_MAX_BYTES,
  WORKSPACE_SKIP_DIRS,
} from "./workspaceFiles.js";
import type {
  WorkspaceCompletionItem,
  WorkspaceDiagnostic,
  WorkspaceHover,
  WorkspaceLocation,
} from "./workspaceComplete.js";

const PY_EXT = new Set([".py", ".pyi"]);
export const PYTHON_LIB_PREFIX = "__python__/";
const clients = new Map<string, Promise<LspClient | null>>();
const versions = new Map<string, number>();
const pythonLibAbs = new Map<string, string>();
const interpreterPathCache = new Map<string, string[]>();

export function isPythonWorkspacePath(rel: string): boolean {
  return PY_EXT.has(extname(rel).toLowerCase());
}

export function isPythonLibraryRel(rel: string): boolean {
  const clean = sanitizeWorkspaceRel(rel);
  return Boolean(clean && (clean === "__python__" || clean.startsWith(PYTHON_LIB_PREFIX)));
}

export function resetWorkspacePython(): void {
  for (const pending of clients.values()) {
    void pending.then((client) => client?.shutdown()).catch(() => undefined);
  }
  clients.clear();
  versions.clear();
  pythonLibAbs.clear();
  interpreterPathCache.clear();
}

const VENV_DIR_NAMES = [".venv", "venv", "env", ".virtualenv", "virtualenv"];
let interpreterOverride = "";

export function setPythonInterpreterOverride(path?: string): void {
  const next = path?.trim() ?? "";
  if (next === interpreterOverride) return;
  interpreterOverride = next;
  resetWorkspacePython();
}

function pythonBinRel(): string {
  return process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
}

export function pythonExecutableAt(path: string): string | undefined {
  if (!path) return undefined;
  try {
    const st = statSync(path);
    if (st.isFile()) return path;
    if (st.isDirectory()) {
      const bin = join(path, pythonBinRel());
      if (existsSync(bin)) return bin;
    }
  } catch {
    /* missing */
  }
  return undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) return undefined;
  const tryParse = (raw: string) => {
    try {
      const value = JSON.parse(raw) as unknown;
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  };
  return (
    tryParse(text) ??
    tryParse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"))
  );
}

function pyrightTomlSection(text: string): string {
  const idx = text.search(/\[tool\.pyright\]/);
  if (idx < 0) return "";
  const rest = text.slice(idx);
  const next = rest.search(/\n\[/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function pyrightTomlValue(text: string, key: string): string {
  const section = pyrightTomlSection(text);
  if (!section) return "";
  const match = section.match(new RegExp(`(?:^|\\n)${key}\\s*=\\s*["']([^"']+)["']`));
  return match?.[1] ?? "";
}

function expandWorkspacePath(root: string, value: string): string {
  const expanded = value.replace(/\$\{workspaceFolder\}/g, root);
  return isAbsolute(expanded) ? expanded : resolve(root, expanded);
}

function interpreterFromVscode(root: string): string | undefined {
  const data = parseJsonObject(readText(join(root, ".vscode", "settings.json")));
  if (!data) return undefined;
  const value = [data["python.defaultInterpreterPath"], data["python.pythonPath"]].find(
    (item): item is string => typeof item === "string" && Boolean(item.trim()),
  );
  return value ? pythonExecutableAt(expandWorkspacePath(root, value.trim())) : undefined;
}

function interpreterFromPyright(root: string): string | undefined {
  const json = parseJsonObject(readText(join(root, "pyrightconfig.json")));
  const toml = readText(join(root, "pyproject.toml"));
  const pythonPath =
    (typeof json?.pythonPath === "string" && json.pythonPath) ||
    pyrightTomlValue(toml, "pythonPath");
  if (pythonPath.trim()) {
    const found = pythonExecutableAt(expandWorkspacePath(root, pythonPath.trim()));
    if (found) return found;
  }
  const venv = (typeof json?.venv === "string" && json.venv) || pyrightTomlValue(toml, "venv");
  if (!venv.trim()) return undefined;
  const venvPath =
    (typeof json?.venvPath === "string" && json.venvPath) ||
    pyrightTomlValue(toml, "venvPath") ||
    ".";
  return pythonExecutableAt(join(expandWorkspacePath(root, venvPath.trim() || "."), venv.trim()));
}

export function resolvePylspCommand(): { command: string; args: string[] } | null {
  const homeBin = join(
    homedir(),
    ".local",
    "bin",
    process.platform === "win32" ? "pylsp.exe" : "pylsp",
  );
  const which = process.env.LOCUS_PYLSP;
  if (which) return { command: which, args: [] };
  if (existsSync(homeBin)) return { command: homeBin, args: [] };
  return { command: process.platform === "win32" ? "python" : "python3", args: ["-m", "pylsp"] };
}

export function resolvePythonInterpreter(root: string): string | undefined {
  const explicit = interpreterOverride || process.env.LOCUS_PYTHON?.trim() || "";
  if (explicit) {
    const found = pythonExecutableAt(expandWorkspacePath(root, explicit));
    if (found) return found;
  }
  const fromVscode = interpreterFromVscode(root);
  if (fromVscode) return fromVscode;
  const fromPyright = interpreterFromPyright(root);
  if (fromPyright) return fromPyright;
  for (const name of VENV_DIR_NAMES) {
    const found = pythonExecutableAt(join(root, name));
    if (found) return found;
  }
  const virtualEnv = process.env.VIRTUAL_ENV?.trim();
  if (virtualEnv) return pythonExecutableAt(virtualEnv);
  return undefined;
}

function venvRootFromPython(python: string): string | undefined {
  const parent = dirname(python);
  const folder = parent.split(/[/\\]/).pop();
  if (folder === "bin" || folder === "Scripts") return dirname(parent);
  return undefined;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function walkFiles(root: string, max = 250): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (dir: string, depth: number) => {
    if (found.length >= max || depth > 6) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (found.length >= max) return;
      if (WORKSPACE_SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      const abs = join(dir, name);
      if (seen.has(abs)) continue;
      seen.add(abs);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs, depth + 1);
      else found.push(abs);
    }
  };
  const src = join(root, "src");
  if (existsSync(src)) walk(src, 1);
  walk(root, 0);
  return found;
}

export type PythonProjectKind = "django" | "flask" | "python";

export function detectPythonProject(root: string): {
  kind: PythonProjectKind;
  extraPaths: string[];
  djangoSettings?: string;
} {
  const files = walkFiles(root);
  const rel = (abs: string) =>
    abs
      .slice(root.length)
      .replace(/^[\\/]/, "")
      .replace(/\\/g, "/");
  const names = files.map(rel);
  const extraPaths = [root];
  const manifest = ["pyproject.toml", "setup.cfg", "setup.py", "requirements.txt"]
    .map((name) => readText(join(root, name)))
    .join("\n");
  let djangoSettings: string | undefined;
  let django =
    names.includes("manage.py") ||
    existsSync(join(root, "manage.py")) ||
    /\bdjango\b/i.test(manifest);
  let flask =
    existsSync(join(root, "src", "flask", "__init__.py")) ||
    existsSync(join(root, "flask", "__init__.py")) ||
    /\bflask\b/i.test(manifest);
  for (const abs of files) {
    const path = rel(abs);
    if (path.endsWith("apps.py")) {
      django = true;
      const parent = dirname(path).replace(/\\/g, "/");
      const pkgRoot = parent.includes("/") ? parent.slice(0, parent.lastIndexOf("/")) : "";
      if (pkgRoot) extraPaths.push(join(root, pkgRoot));
    }
    const text =
      path.endsWith(".py") ||
      path.endsWith(".txt") ||
      path.endsWith(".cfg") ||
      path.endsWith(".toml")
        ? readText(abs)
        : "";
    djangoSettings ??= djangoSettingsFromText(text);
    if (
      /\b(?:Django|django)\b/.test(text) &&
      /(requirements|pyproject|manage|settings|wsgi|asgi)/.test(path)
    ) {
      django = true;
    }
    if (/\bfrom flask import\b|\bimport flask\b|\bFlask\(__name__\)/.test(text)) flask = true;
  }
  extraPaths.push(join(root, "src"));
  if (django) extraPaths.push(join(root, "apps"));
  const uniquePaths = [...new Set(extraPaths.filter((dir) => existsSync(dir)))];
  if (!djangoSettings) {
    for (const abs of files) {
      const path = rel(abs);
      if (path.endsWith("settings.py") && path.includes("/")) {
        django = true;
        djangoSettings = moduleFromSettingsPath(path, uniquePaths, root);
        break;
      }
    }
  }
  const kind: PythonProjectKind = django ? "django" : flask ? "flask" : "python";
  return { kind, extraPaths: uniquePaths, djangoSettings };
}

function djangoSettingsFromText(text: string): string | undefined {
  const match = text.match(/DJANGO_SETTINGS_MODULE["']?\s*,\s*["']([A-Za-z_][\w.]*)["']/);
  return match?.[1];
}

function moduleFromSettingsPath(rel: string, extraPaths: string[], root: string): string {
  let path = rel.replace(/\.py$/, "").replace(/\\/g, "/");
  const prefixes = extraPaths
    .map((abs) => relative(root, abs).replace(/\\/g, "/"))
    .filter((prefix) => prefix && prefix !== ".")
    .sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (path === prefix) return "";
    if (path.startsWith(`${prefix}/`)) {
      path = path.slice(prefix.length + 1);
      break;
    }
  }
  return path.replace(/\//g, ".");
}

function pylspSettings(root: string): Record<string, unknown> {
  const python = resolvePythonInterpreter(root) ?? null;
  const project = detectPythonProject(root);
  return {
    pylsp: {
      plugins: {
        jedi: {
          environment: python,
          extra_paths: project.extraPaths,
          prioritize_extra_paths: true,
          auto_import_modules: ["django", "flask", "numpy"],
        },
        jedi_completion: { include_params: true, fuzzy: true, eager: true },
        jedi_definition: {
          enabled: true,
          follow_imports: true,
          follow_builtin_imports: true,
        },
        jedi_hover: { enabled: true },
        jedi_references: { enabled: true },
        jedi_signature_help: { enabled: true },
        jedi_symbols: { enabled: true },
        pyflakes: { enabled: true },
        pycodestyle: { enabled: false },
        autopep8: { enabled: true },
        yapf: { enabled: false },
        pylint: { enabled: false },
        rope_autoimport: { enabled: project.kind !== "python" },
        rope_completion: { enabled: false },
      },
    },
  };
}

async function getClient(root: string): Promise<LspClient | null> {
  const existing = clients.get(root);
  if (existing) return existing;
  const pending = (async () => {
    const cmd = resolvePylspCommand();
    if (!cmd) return null;
    const project = detectPythonProject(root);
    const env: NodeJS.ProcessEnv = {};
    if (project.djangoSettings) env.DJANGO_SETTINGS_MODULE = project.djangoSettings;
    const python = resolvePythonInterpreter(root);
    const venv = python ? venvRootFromPython(python) : undefined;
    if (venv) env.VIRTUAL_ENV = venv;
    env.PYTHONPATH = [process.env.PYTHONPATH, root, ...project.extraPaths]
      .filter(Boolean)
      .join(process.platform === "win32" ? ";" : ":");
    let client: LspClient | null = null;
    try {
      client = LspClient.spawn(cmd.command, cmd.args, root, env);
      await client.initialize(root, pylspSettings(root));
      client.notify("workspace/didChangeConfiguration", { settings: pylspSettings(root) });
      return client;
    } catch {
      client?.kill();
      return null;
    }
  })();
  clients.set(root, pending);
  const client = await pending;
  if (!client) clients.delete(root);
  return client;
}

function fileUri(root: string, rel: string): string {
  return pathToFileURL(join(root, rel)).href;
}

async function synced(root: string, rel: string, content: string): Promise<LspClient | null> {
  const client = await getClient(root);
  if (!client) return null;
  const uri = fileUri(root, rel);
  const key = `${root}:${rel}`;
  const version = (versions.get(key) ?? 0) + 1;
  versions.set(key, version);
  if (version === 1) client.didOpen(uri, "python", content, version);
  else client.didChange(uri, content, version);
  return client;
}

function rangeToLoc(range: LspRange): { line: number; character: number } {
  return { line: range.start.line, character: range.start.character };
}

function severityOf(code?: number): WorkspaceDiagnostic["severity"] {
  if (code === 1) return "error";
  if (code === 2) return "warning";
  return "info";
}

export function lspDiagnostics(rel: string, diags: LspDiagnostic[]): WorkspaceDiagnostic[] {
  return diags.slice(0, 80).map((diag) => ({
    path: rel,
    startLine: diag.range.start.line,
    startCharacter: diag.range.start.character,
    endLine: diag.range.end.line,
    endCharacter: diag.range.end.character,
    message: diag.message,
    severity: severityOf(diag.severity),
  }));
}

function asItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown[] }).items)) {
    return (raw as { items: unknown[] }).items;
  }
  return [];
}

function editOf(raw: unknown): LspTextEdit | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as { range?: LspRange; newText?: string };
  if (!row.range || typeof row.newText !== "string") return undefined;
  return { range: row.range, newText: row.newText };
}

function additionalFrom(
  uri: string,
  root: string,
  edits: unknown,
): NonNullable<WorkspaceCompletionItem["additionalEdits"]> {
  if (!Array.isArray(edits)) return [];
  const path = uriToRel(root, uri);
  const out: NonNullable<WorkspaceCompletionItem["additionalEdits"]> = [];
  for (const edit of edits) {
    const parsed = editOf(edit);
    if (!parsed) continue;
    out.push({
      path,
      startLine: parsed.range.start.line,
      startCharacter: parsed.range.start.character,
      endLine: parsed.range.end.line,
      endCharacter: parsed.range.end.character,
      newText: parsed.newText,
    });
  }
  return out.filter((row) => row.path);
}

export async function completePythonFile(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
}): Promise<{ items: WorkspaceCompletionItem[]; source: string }> {
  const rel = sanitizeWorkspaceRel(input.rel);
  if (!rel || !isPythonWorkspacePath(rel)) return { items: [], source: "none" };
  const client = await synced(input.root, rel, input.content);
  if (!client) return { items: [], source: "none" };
  const uri = fileUri(input.root, rel);
  try {
    const result = await client.request("textDocument/completion", {
      textDocument: { uri },
      position: { line: input.line, character: input.character },
    });
    const items: WorkspaceCompletionItem[] = [];
    for (const raw of asItems(result)) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as {
        label?: string | { label?: string };
        insertText?: string;
        detail?: string;
        additionalTextEdits?: LspTextEdit[];
        textEdit?: { newText?: string };
      };
      const label = typeof row.label === "string" ? row.label : row.label?.label;
      if (!label) continue;
      const insert = row.insertText || row.textEdit?.newText || label;
      items.push({
        label,
        insert,
        kind: insert.includes("$") ? "snippet" : "symbol",
        detail: row.detail,
        additionalEdits: additionalFrom(uri, input.root, row.additionalTextEdits),
      });
      if (items.length >= 80) break;
    }
    return { items, source: "python" };
  } catch {
    return { items: [], source: "none" };
  }
}

export async function inspectPythonFile(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
}): Promise<{
  diagnostics: WorkspaceDiagnostic[];
  hover: WorkspaceHover | null;
  definition: WorkspaceLocation | null;
  signature: {
    label: string;
    documentation?: string;
    activeParameter: number;
    parameters: Array<{ label: string; documentation?: string }>;
  } | null;
  pylsp: boolean;
}> {
  const empty = {
    diagnostics: [] as WorkspaceDiagnostic[],
    hover: null,
    definition: null,
    signature: null,
    pylsp: false,
  };
  const rel = sanitizeWorkspaceRel(input.rel);
  if (!rel || !isPythonWorkspacePath(rel)) return empty;
  const client = await synced(input.root, rel, input.content);
  if (!client) return empty;
  const uri = fileUri(input.root, rel);
  const position = { line: input.line, character: input.character };
  const diagnostics = lspDiagnostics(rel, client.diagnosticsFor(uri));
  let hover: WorkspaceHover | null = null;
  try {
    const raw = (await client.request("textDocument/hover", {
      textDocument: { uri },
      position,
    })) as { contents?: unknown; range?: LspRange } | null;
    const text = hoverText(raw?.contents);
    if (text) {
      hover = {
        text,
        startLine: raw?.range?.start.line ?? input.line,
        startCharacter: raw?.range?.start.character ?? input.character,
        endLine: raw?.range?.end.line ?? input.line,
        endCharacter: raw?.range?.end.character ?? input.character,
      };
    }
  } catch {
    /* ignore */
  }
  let definition: WorkspaceLocation | null = null;
  try {
    const raw = await client.request("textDocument/definition", {
      textDocument: { uri },
      position,
    });
    definition = locationFromLsp(raw, input.root);
  } catch {
    /* ignore */
  }
  let signature = null;
  try {
    const raw = (await client.request("textDocument/signatureHelp", {
      textDocument: { uri },
      position,
    })) as {
      signatures?: Array<{
        label?: string;
        documentation?: unknown;
        parameters?: Array<{ label?: string | { label?: string }; documentation?: unknown }>;
      }>;
      activeParameter?: number;
      activeSignature?: number;
    } | null;
    const sig = raw?.signatures?.[raw.activeSignature ?? 0];
    if (sig?.label) {
      signature = {
        label: sig.label,
        documentation: hoverText(sig.documentation) || undefined,
        activeParameter: raw?.activeParameter ?? 0,
        parameters: (sig.parameters ?? []).map((param) => ({
          label: typeof param.label === "string" ? param.label : (param.label?.label ?? ""),
          documentation: hoverText(param.documentation) || undefined,
        })),
      };
    }
  } catch {
    /* ignore */
  }
  return { diagnostics, hover, definition, signature, pylsp: true };
}

export async function referencesPythonFile(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
}): Promise<{ items: WorkspaceLocation[] }> {
  const rel = sanitizeWorkspaceRel(input.rel);
  if (!rel || !isPythonWorkspacePath(rel)) return { items: [] };
  const client = await synced(input.root, rel, input.content);
  if (!client) return { items: [] };
  try {
    const raw = await client.request("textDocument/references", {
      textDocument: { uri: fileUri(input.root, rel) },
      position: { line: input.line, character: input.character },
      context: { includeDeclaration: true },
    });
    const items: WorkspaceLocation[] = [];
    for (const loc of Array.isArray(raw) ? raw : [raw]) {
      const item = locationFromLsp(loc, input.root);
      if (!item) continue;
      items.push(item);
      if (items.length >= 80) break;
    }
    return { items };
  } catch {
    return { items: [] };
  }
}

export async function formatPythonFile(input: {
  root: string;
  rel: string;
  content: string;
}): Promise<{ content: string; source: string }> {
  const rel = sanitizeWorkspaceRel(input.rel);
  if (!rel || !isPythonWorkspacePath(rel)) return { content: input.content, source: "none" };
  const client = await synced(input.root, rel, input.content);
  if (!client) return { content: input.content, source: "none" };
  try {
    const raw = await client.request("textDocument/formatting", {
      textDocument: { uri: fileUri(input.root, rel) },
      options: { tabSize: 4, insertSpaces: true },
    });
    const edits = Array.isArray(raw) ? raw.map(editOf).filter(Boolean) : [];
    if (!edits.length) return { content: input.content, source: "python" };
    return { content: applyTextEdits(input.content, edits as LspTextEdit[]), source: "python" };
  } catch {
    return { content: input.content, source: "none" };
  }
}

export async function renamePythonSymbol(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
  newName: string;
}): Promise<{ files: Array<{ path: string; content: string }> }> {
  const rel = sanitizeWorkspaceRel(input.rel);
  if (!rel || !isPythonWorkspacePath(rel) || !input.newName.trim()) return { files: [] };
  const client = await synced(input.root, rel, input.content);
  if (!client) return { files: [] };
  try {
    const raw = (await client.request("textDocument/rename", {
      textDocument: { uri: fileUri(input.root, rel) },
      position: { line: input.line, character: input.character },
      newName: input.newName.trim(),
    })) as { changes?: Record<string, LspTextEdit[]> } | null;
    const files: Array<{ path: string; content: string }> = [];
    for (const [uri, edits] of Object.entries(raw?.changes ?? {})) {
      const path = uriToRel(input.root, uri);
      if (!path || isPythonLibraryRel(path)) continue;
      const original = path === rel ? input.content : readText(join(input.root, path));
      files.push({ path, content: applyTextEdits(original, edits) });
    }
    return { files };
  } catch {
    return { files: [] };
  }
}

export async function pythonDiagnostics(
  root: string,
  rel: string,
  content: string,
): Promise<WorkspaceDiagnostic[]> {
  const client = await synced(root, rel, content);
  if (!client) return [];
  return lspDiagnostics(rel, client.diagnosticsFor(fileUri(root, rel)));
}

function locationFromLsp(raw: unknown, root: string): WorkspaceLocation | null {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const loc = locationFromLsp(item, root);
      if (loc) return loc;
    }
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const row = raw as {
    uri?: string;
    targetUri?: string;
    range?: LspRange;
    targetSelectionRange?: LspRange;
    targetRange?: LspRange;
  };
  const uri = typeof row.uri === "string" ? row.uri : row.targetUri;
  const range = row.range ?? row.targetSelectionRange ?? row.targetRange;
  if (!uri || !range) return null;
  const path = uriToRel(root, uri);
  if (!path) return null;
  return { path, ...rangeToLoc(range) };
}

function relInsideRoot(root: string, abs: string): string | null {
  const tryRel = (from: string, to: string) => {
    const rel = relative(from, to);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
    return rel.replace(/\\/g, "/");
  };
  const direct = tryRel(resolve(root), resolve(abs));
  if (direct) return direct;
  try {
    return tryRel(realpathSync(root), realpathSync(abs));
  } catch {
    return null;
  }
}

export function pythonLibraryRelFromAbs(abs: string): string {
  const posix = abs.replace(/\\/g, "/");
  for (const marker of ["/site-packages/", "/dist-packages/"]) {
    const idx = posix.toLowerCase().lastIndexOf(marker);
    if (idx >= 0) return `${PYTHON_LIB_PREFIX}${posix.slice(idx + marker.length)}`;
  }
  const std = posix.match(/\/lib\/python[^/]+\/(.+)$/i);
  if (std?.[1] && !std[1].toLowerCase().startsWith("site-packages/")) {
    return `${PYTHON_LIB_PREFIX}${std[1]}`;
  }
  return "";
}

function pythonLibRest(rel: string): string | null {
  const clean = sanitizeWorkspaceRel(rel);
  if (!clean?.startsWith(PYTHON_LIB_PREFIX)) return null;
  const rest = clean.slice(PYTHON_LIB_PREFIX.length);
  if (!rest || rest.split("/").some((part) => part === "." || part === "..")) return null;
  if (!/\.pyi?$/i.test(rest)) return null;
  return rest;
}

function interpreterSysPath(root: string): string[] {
  const hit = interpreterPathCache.get(root);
  if (hit) return hit;
  const python =
    resolvePythonInterpreter(root) ?? (process.platform === "win32" ? "python" : "python3");
  const probe = spawnSync(python, ["-c", "import sys, json; print(json.dumps(sys.path))"], {
    encoding: "utf8",
    timeout: 8_000,
    cwd: root,
    windowsHide: true,
  });
  let paths: string[] = [];
  try {
    const parsed = JSON.parse(probe.stdout || "[]") as unknown;
    if (Array.isArray(parsed)) {
      paths = parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    paths = [];
  }
  const existing = paths.filter((dir) => dir && existsSync(dir));
  interpreterPathCache.set(root, existing);
  return existing;
}

function resolvePythonLibrary(root: string, rest: string): string | undefined {
  const cached = pythonLibAbs.get(`${PYTHON_LIB_PREFIX}${rest}`);
  if (cached && existsSync(cached)) return cached;
  const search = [...interpreterSysPath(root), ...detectPythonProject(root).extraPaths];
  for (const dir of search) {
    const abs = resolve(dir, rest);
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return undefined;
}

export function readPythonLibraryFile(
  root: string,
  rel: string,
): { path: string; content: string; mtime: string } | undefined {
  const rest = pythonLibRest(rel);
  if (!rest) return undefined;
  const abs = resolvePythonLibrary(root, rest);
  if (!abs) return undefined;
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > WORKSPACE_FILE_MAX_BYTES) return undefined;
    return {
      path: `${PYTHON_LIB_PREFIX}${rest}`,
      content: readFileSync(abs, "utf8"),
      mtime: st.mtime.toISOString(),
    };
  } catch {
    return undefined;
  }
}

function uriToRel(root: string, uri: string): string {
  let abs = "";
  try {
    abs = fileURLToPath(uri);
  } catch {
    return "";
  }
  const inside = relInsideRoot(root, abs);
  if (inside && !inside.split("/").some((part) => part === "." || part === "..")) return inside;
  const lib = pythonLibraryRelFromAbs(abs);
  if (lib) {
    pythonLibAbs.set(lib, abs);
    return lib;
  }
  return "";
}

function hoverText(contents: unknown): string {
  if (!contents) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join("\n\n");
  if (typeof contents === "object" && contents && "value" in contents) {
    return String((contents as { value: unknown }).value);
  }
  return "";
}

export function applyTextEdits(text: string, edits: LspTextEdit[]): string {
  const ordered = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });
  let next = text;
  for (const edit of ordered) {
    const start = offsetAt(next, edit.range.start.line, edit.range.start.character);
    const end = offsetAt(next, edit.range.end.line, edit.range.end.character);
    next = next.slice(0, start) + edit.newText + next.slice(end);
  }
  return next;
}

function offsetAt(text: string, line: number, character: number): number {
  let lineNo = 0;
  let i = 0;
  while (i < text.length && lineNo < line) {
    if (text[i] === "\n") lineNo += 1;
    i += 1;
  }
  return Math.min(text.length, i + Math.max(0, character));
}
