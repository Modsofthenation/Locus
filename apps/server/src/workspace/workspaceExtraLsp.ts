import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LspClient, type LspDiagnostic, type LspRange, type LspTextEdit } from "./workspaceLsp.js";
import { sanitizeWorkspaceRel } from "./workspaceFiles.js";
import type {
  WorkspaceCompletionItem,
  WorkspaceDiagnostic,
  WorkspaceHover,
  WorkspaceInspectResult,
  WorkspaceLocation,
} from "./workspaceComplete.js";

function lspDiagnostics(rel: string, diags: LspDiagnostic[]): WorkspaceDiagnostic[] {
  return diags.slice(0, 80).map((diag) => ({
    path: rel,
    startLine: diag.range.start.line,
    startCharacter: diag.range.start.character,
    endLine: diag.range.end.line,
    endCharacter: diag.range.end.character,
    message: diag.message,
    severity: diag.severity === 1 ? "error" : diag.severity === 2 ? "warning" : "info",
  }));
}

type ExtraLang = "go" | "rust" | "java";

const LANGS: Record<
  ExtraLang,
  { exts: Set<string>; languageId: string; binaries: string[]; envName: string }
> = {
  go: {
    exts: new Set([".go"]),
    languageId: "go",
    binaries: ["gopls"],
    envName: "LOCUS_GOPLS",
  },
  rust: {
    exts: new Set([".rs"]),
    languageId: "rust",
    binaries: ["rust-analyzer"],
    envName: "LOCUS_RUST_ANALYZER",
  },
  java: {
    exts: new Set([".java"]),
    languageId: "java",
    binaries: ["jdtls", "java-language-server"],
    envName: "LOCUS_JDTLS",
  },
};

const clients = new Map<string, Promise<LspClient | null>>();
const versions = new Map<string, number>();

export function extraLspLanguage(rel: string): ExtraLang | undefined {
  const ext = extname(rel).toLowerCase();
  for (const [lang, spec] of Object.entries(LANGS) as Array<
    [ExtraLang, (typeof LANGS)[ExtraLang]]
  >) {
    if (spec.exts.has(ext)) return lang;
  }
  return undefined;
}

export function isExtraLspPath(rel: string): boolean {
  return extraLspLanguage(rel) !== undefined;
}

export function resetWorkspaceExtraLsp(): void {
  for (const pending of clients.values()) {
    void pending.then((client) => client?.shutdown()).catch(() => undefined);
  }
  clients.clear();
  versions.clear();
}

export function resolveExtraLspCommand(
  lang: ExtraLang,
): { command: string; args: string[] } | null {
  const spec = LANGS[lang];
  const env = process.env[spec.envName]?.trim();
  if (env) return { command: env, args: [] };
  const homeBin = join(homedir(), ".local", "bin");
  for (const name of spec.binaries) {
    const win = process.platform === "win32" ? `${name}.exe` : name;
    const candidates = [join(homeBin, win), win];
    for (const candidate of candidates) {
      if (candidate.includes("/") || candidate.includes("\\")) {
        if (existsSync(candidate)) return { command: candidate, args: [] };
      }
    }
  }
  return { command: spec.binaries[0]!, args: [] };
}

function fileUri(root: string, rel: string): string {
  return pathToFileURL(join(root, rel)).href;
}

function uriToRel(root: string, uri: string): string {
  try {
    const abs = fileURLToPath(uri);
    const rel = relative(resolve(root), abs).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return "";
    return rel;
  } catch {
    return "";
  }
}

async function getClient(root: string, lang: ExtraLang): Promise<LspClient | null> {
  const key = `${lang}:${root}`;
  const hit = clients.get(key);
  if (hit) return hit;
  const pending = (async () => {
    const cmd = resolveExtraLspCommand(lang);
    if (!cmd) return null;
    let client: LspClient | undefined;
    try {
      client = LspClient.spawn(cmd.command, cmd.args, root);
      await client.initialize(root);
      return client;
    } catch {
      client?.kill();
      return null;
    }
  })();
  clients.set(key, pending);
  const client = await pending;
  if (!client) clients.delete(key);
  return client;
}

async function synced(
  root: string,
  rel: string,
  content: string,
  lang: ExtraLang,
): Promise<LspClient | null> {
  const client = await getClient(root, lang);
  if (!client) return null;
  const uri = fileUri(root, rel);
  const key = `${lang}:${root}:${rel}`;
  const version = (versions.get(key) ?? 0) + 1;
  versions.set(key, version);
  if (version === 1) client.didOpen(uri, LANGS[lang].languageId, content, version);
  else client.didChange(uri, content, version);
  return client;
}

function asItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown[] }).items)) {
    return (raw as { items: unknown[] }).items;
  }
  return [];
}

function rangeToLoc(range: LspRange): { line: number; character: number } {
  return { line: range.start.line, character: range.start.character };
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

function editOf(raw: unknown): LspTextEdit | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as { range?: LspRange; newText?: string };
  if (!row.range || typeof row.newText !== "string") return undefined;
  return { range: row.range, newText: row.newText };
}

export async function completeExtraLspFile(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
}): Promise<{ items: WorkspaceCompletionItem[]; source: string }> {
  const rel = sanitizeWorkspaceRel(input.rel);
  const lang = rel ? extraLspLanguage(rel) : undefined;
  if (!rel || !lang) return { items: [], source: "none" };
  const client = await synced(input.root, rel, input.content, lang);
  if (!client) return { items: [], source: "none" };
  try {
    const result = await client.request("textDocument/completion", {
      textDocument: { uri: fileUri(input.root, rel) },
      position: { line: input.line, character: input.character },
    });
    const items: WorkspaceCompletionItem[] = [];
    for (const raw of asItems(result)) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as {
        label?: string | { label?: string };
        insertText?: string;
        detail?: string;
        textEdit?: { newText?: string };
      };
      const label = typeof row.label === "string" ? row.label : row.label?.label;
      if (!label) continue;
      items.push({
        label,
        insert: row.insertText || row.textEdit?.newText || label,
        kind: "symbol",
        detail: row.detail,
      });
      if (items.length >= 80) break;
    }
    return { items, source: lang };
  } catch {
    return { items: [], source: "none" };
  }
}

export async function inspectExtraLspFile(input: {
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
  const lang = rel ? extraLspLanguage(rel) : undefined;
  if (!rel || !lang) return empty;
  const client = await synced(input.root, rel, input.content, lang);
  if (!client) return empty;
  const uri = fileUri(input.root, rel);
  const pos = { line: input.line, character: input.character };
  const diagnostics = lspDiagnostics(rel, client.diagnosticsFor(uri));
  let hover: WorkspaceHover | null = null;
  let definition: WorkspaceLocation | null = null;
  try {
    const raw = await client.request("textDocument/hover", {
      textDocument: { uri },
      position: pos,
    });
    const contents =
      raw && typeof raw === "object"
        ? (raw as { contents?: { value?: string } | string | Array<{ value?: string } | string> })
            .contents
        : undefined;
    const text = hoverText(contents);
    if (text)
      hover = {
        text,
        startLine: input.line,
        startCharacter: 0,
        endLine: input.line,
        endCharacter: 0,
      };
  } catch {
    /* ignore */
  }
  try {
    definition = locationFromLsp(
      await client.request("textDocument/definition", { textDocument: { uri }, position: pos }),
      input.root,
    );
  } catch {
    /* ignore */
  }
  return { ...empty, diagnostics, hover, definition };
}

function hoverText(contents: unknown): string {
  if (typeof contents === "string") return contents;
  if (contents && typeof contents === "object" && "value" in contents) {
    return String((contents as { value?: string }).value ?? "");
  }
  if (Array.isArray(contents)) {
    return contents
      .map((row) => (typeof row === "string" ? row : hoverText(row)))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export async function formatExtraLspFile(input: {
  root: string;
  rel: string;
  content: string;
}): Promise<{ content: string; source: string }> {
  const rel = sanitizeWorkspaceRel(input.rel);
  const lang = rel ? extraLspLanguage(rel) : undefined;
  if (!rel || !lang) return { content: input.content, source: "none" };
  const client = await synced(input.root, rel, input.content, lang);
  if (!client) return { content: input.content, source: "none" };
  try {
    const raw = await client.request("textDocument/formatting", {
      textDocument: { uri: fileUri(input.root, rel) },
      options: { tabSize: 4, insertSpaces: true },
    });
    const edits = Array.isArray(raw) ? raw.map(editOf).filter(Boolean) : [];
    if (!edits.length) return { content: input.content, source: lang };
    return { content: applyTextEdits(input.content, edits as LspTextEdit[]), source: lang };
  } catch {
    return { content: input.content, source: "none" };
  }
}

export async function referencesExtraLspFile(input: {
  root: string;
  rel: string;
  content: string;
  line: number;
  character: number;
}): Promise<{ items: WorkspaceLocation[] }> {
  const rel = sanitizeWorkspaceRel(input.rel);
  const lang = rel ? extraLspLanguage(rel) : undefined;
  if (!rel || !lang) return { items: [] };
  const client = await synced(input.root, rel, input.content, lang);
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

export async function extraLspDiagnostics(
  root: string,
  rel: string,
  content: string,
): Promise<WorkspaceDiagnostic[]> {
  const lang = extraLspLanguage(rel);
  if (!lang) return [];
  const client = await synced(root, rel, content, lang);
  if (!client) return [];
  return lspDiagnostics(rel, client.diagnosticsFor(fileUri(root, rel)));
}

function applyTextEdits(content: string, edits: LspTextEdit[]): string {
  const ordered = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });
  let next = content;
  for (const edit of ordered) {
    const start = offsetAt(next, edit.range.start);
    const end = offsetAt(next, edit.range.end);
    next = `${next.slice(0, start)}${edit.newText}${next.slice(end)}`;
  }
  return next;
}

function offsetAt(text: string, pos: { line: number; character: number }): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < pos.line && i < lines.length; i += 1) offset += (lines[i]?.length ?? 0) + 1;
  return offset + Math.max(0, pos.character);
}
