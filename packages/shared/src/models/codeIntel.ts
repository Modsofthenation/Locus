import type { ExtraToolDef } from "./mcp.js";

/**
 * Agent code-intelligence tools backed by the editor language servers
 * (TypeScript language service, pylsp, gopls / rust-analyzer / jdtls).
 * The tool API is 1-based (line/column); the language servers are 0-based.
 */
export const CODE_DEFINITION_TOOL_NAME = "code_definition";
export const CODE_REFERENCES_TOOL_NAME = "code_references";
export const CODE_SYMBOLS_TOOL_NAME = "code_symbols";
export const CODE_DIAGNOSTICS_TOOL_NAME = "code_diagnostics";
export const CODE_RENAME_TOOL_NAME = "code_rename";

export const CODE_INTEL_READ_TOOL_NAMES = [
  CODE_DEFINITION_TOOL_NAME,
  CODE_REFERENCES_TOOL_NAME,
  CODE_SYMBOLS_TOOL_NAME,
  CODE_DIAGNOSTICS_TOOL_NAME,
] as const;

export const CODE_INTEL_TOOL_NAMES = [
  ...CODE_INTEL_READ_TOOL_NAMES,
  CODE_RENAME_TOOL_NAME,
] as const;
export type CodeIntelToolName = (typeof CODE_INTEL_TOOL_NAMES)[number];

const READ_SET = new Set<string>(CODE_INTEL_READ_TOOL_NAMES);
const ALL_SET = new Set<string>(CODE_INTEL_TOOL_NAMES);

export function isCodeIntelToolName(name: string): name is CodeIntelToolName {
  return ALL_SET.has(name);
}

/** Read-only lookups: plan mode, explore/review sub-agents, REVIEW_TOOLS. */
export function isCodeIntelReadToolName(name: string): boolean {
  return READ_SET.has(name);
}

export function isCodeRenameToolName(name: string): boolean {
  return name === CODE_RENAME_TOOL_NAME;
}

const POSITION_PROPS = {
  path: {
    type: "string",
    description: "File path (relative to the workspace, or /workspace/...).",
  },
  line: { type: "number", description: "1-based line number." },
  column: {
    type: "number",
    description: "1-based column of the identifier on that line.",
  },
  symbol: {
    type: "string",
    description:
      "Symbol name instead of line/column (for example parseConfig or Session.require). With path it is looked up in that file; alone it is resolved from workspace symbols and fails when ambiguous.",
  },
} as const;

export const CODE_DEFINITION_TOOL: ExtraToolDef = {
  name: CODE_DEFINITION_TOOL_NAME,
  description:
    "Go to definition via the language server (TS/JS, Python, Go, Rust, Java). Pass path+line+column of a usage, or a symbol name. Returns the definition location, its type/signature, and a short snippet. Prefer this over grep to find where a symbol is declared.",
  parameters: { type: "object", properties: { ...POSITION_PROPS } },
};

export const CODE_REFERENCES_TOOL: ExtraToolDef = {
  name: CODE_REFERENCES_TOOL_NAME,
  description:
    "Find all references to a symbol via the language server, grouped by file with the line text. Pass path+line+column, or a symbol name. Prefer this over grep before changing a function signature.",
  parameters: {
    type: "object",
    properties: {
      ...POSITION_PROPS,
      limit: { type: "number", description: "Max references to return (default 50, max 200)." },
    },
  },
};

export const CODE_SYMBOLS_TOOL: ExtraToolDef = {
  name: CODE_SYMBOLS_TOOL_NAME,
  description:
    "List symbols. With path: the document outline of that file (functions, classes, methods with lines). With query only: workspace symbols matching the name.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Symbol name or prefix to search for." },
      path: { type: "string", description: "File to outline. query then filters the outline." },
    },
  },
};

export const CODE_DIAGNOSTICS_TOOL: ExtraToolDef = {
  name: CODE_DIAGNOSTICS_TOOL_NAME,
  description:
    "Type/compile errors and warnings from the language server. Pass paths[], or omit it to check the files changed in the workspace (git dirty set). Faster than a full typecheck for a quick check after edits; still run the project's tests before claiming done.",
  parameters: {
    type: "object",
    properties: {
      paths: { type: "array", description: "Files to check (max 24)." },
    },
  },
};

export const CODE_RENAME_TOOL: ExtraToolDef = {
  name: CODE_RENAME_TOOL_NAME,
  description:
    "Rename a symbol everywhere it is referenced, via the language server (TS/JS and Python). Edits files on disk like apply_patch and returns a per-file summary plus the diff. Prefer this over hand-patching every call site.",
  parameters: {
    type: "object",
    properties: {
      path: POSITION_PROPS.path,
      line: POSITION_PROPS.line,
      column: POSITION_PROPS.column,
      symbol: {
        type: "string",
        description: "Symbol to rename instead of line/column (with path, looked up in that file).",
      },
      newName: { type: "string", description: "New identifier." },
    },
    required: ["newName"],
  },
};

export const CODE_INTEL_READ_TOOLS: ExtraToolDef[] = [
  CODE_DEFINITION_TOOL,
  CODE_REFERENCES_TOOL,
  CODE_SYMBOLS_TOOL,
  CODE_DIAGNOSTICS_TOOL,
];

export const CODE_INTEL_TOOLS: ExtraToolDef[] = [...CODE_INTEL_READ_TOOLS, CODE_RENAME_TOOL];

/** JSON schemas for harness rule 5 (validated at execute time like TOOL_SCHEMAS). */
export function codeIntelToolSchema(name: string): ExtraToolDef["parameters"] | undefined {
  return CODE_INTEL_TOOLS.find((tool) => tool.name === name)?.parameters;
}

export type CodeIntelLanguage = "typescript" | "python" | "go" | "rust" | "java";

const LANGUAGE_EXT: Array<[CodeIntelLanguage, RegExp]> = [
  ["typescript", /\.(?:[cm]?[jt]sx?)$/i],
  ["python", /\.pyi?$/i],
  ["go", /\.go$/i],
  ["rust", /\.rs$/i],
  ["java", /\.java$/i],
];

export function codeIntelLanguage(path: string): CodeIntelLanguage | undefined {
  const clean = path.trim();
  if (!clean) return undefined;
  for (const [lang, re] of LANGUAGE_EXT) if (re.test(clean)) return lang;
  return undefined;
}

/** Language server binary + install hint, for actionable "not installed" messages. */
export const CODE_INTEL_SERVERS: Record<CodeIntelLanguage, { server: string; install: string }> = {
  typescript: { server: "TypeScript", install: "bundled with Locus" },
  python: { server: "pylsp", install: "pip install python-lsp-server, or set LOCUS_PYLSP" },
  go: {
    server: "gopls",
    install: "go install golang.org/x/tools/gopls@latest, or set LOCUS_GOPLS",
  },
  rust: {
    server: "rust-analyzer",
    install: "rustup component add rust-analyzer, or set LOCUS_RUST_ANALYZER",
  },
  java: { server: "jdtls", install: "install Eclipse jdtls on PATH, or set LOCUS_JDTLS" },
};

export function codeIntelServerMissing(lang: CodeIntelLanguage, tool: string): string {
  const row = CODE_INTEL_SERVERS[lang];
  return `${row.server} not found (${row.install}). ${tool} cannot answer for this file; use grep / file_read instead.`;
}

export function codeIntelUnsupported(path: string, tool: string): string {
  return `${tool} supports TS/JS, Python, Go, Rust and Java files; ${path || "this file"} is not one. Use grep / file_read instead.`;
}

/** 0-based target. `line` and `character` are set together, or `symbol` is set. */
export type CodeIntelTarget = {
  path?: string;
  line?: number;
  character?: number;
  symbol?: string;
};

export type CodeIntelParse<T> =
  { ok: true; value: T } | { ok: false; error: string; reason?: "missing" | "ambiguous" };

/** Positive integer from a number or numeric string (models send both). */
export function parsePositiveInt(raw: unknown): number | undefined {
  const value =
    typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return undefined;
  const int = Math.floor(value);
  return int >= 1 ? int : undefined;
}

function strArg(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Parse `{ path, line, column | symbol }` with 1-based line/column into a 0-based target. */
export function parseCodeIntelTarget(
  tool: string,
  args: Record<string, unknown> = {},
): CodeIntelParse<CodeIntelTarget> {
  const path = strArg(args, "path", "file", "file_path");
  const symbol = strArg(args, "symbol", "name");
  const rawLine = args.line;
  const rawColumn = args.column ?? args.col ?? args.character;
  const line = parsePositiveInt(rawLine);
  const column = parsePositiveInt(rawColumn);
  if (rawLine != null && rawLine !== "" && line === undefined) {
    return { ok: false, error: `${tool}.line must be a 1-based line number.` };
  }
  if (rawColumn != null && rawColumn !== "" && column === undefined) {
    return { ok: false, error: `${tool}.column must be a 1-based column number.` };
  }
  if (line !== undefined && column !== undefined) {
    if (!path) return { ok: false, error: `${tool} needs path with line and column.` };
    return {
      ok: true,
      value: { path, line: line - 1, character: column - 1, ...(symbol ? { symbol } : {}) },
    };
  }
  if (symbol) {
    return {
      ok: true,
      value: {
        ...(path ? { path } : {}),
        ...(line !== undefined ? { line: line - 1 } : {}),
        symbol,
      },
    };
  }
  if (line !== undefined) {
    return {
      ok: false,
      error: `${tool} needs column (1-based) with line, or a symbol name to find on that line.`,
    };
  }
  return {
    ok: false,
    error: `${tool} needs path + line + column (1-based), or symbol (optionally with path).`,
  };
}

const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

export function parseCodeRenameName(raw: unknown): CodeIntelParse<string> {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return { ok: false, error: "code_rename needs newName." };
  if (!IDENTIFIER.test(name)) {
    return { ok: false, error: `code_rename newName must be a single identifier, got "${name}".` };
  }
  return { ok: true, value: name };
}

/** `Session.require` → `require`; `mod::fn` → `fn`. */
export function symbolLeaf(symbol: string): string {
  const parts = symbol.trim().split(/::|\.|#/);
  return parts[parts.length - 1]?.trim() || symbol.trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 0-based column of `symbol` (its leaf) as a whole word in `lineText`, or -1. */
export function symbolColumnInLine(lineText: string, symbol: string): number {
  const leaf = symbolLeaf(symbol);
  if (!leaf) return -1;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_$])${escapeRegExp(leaf)}(?![\\p{L}\\p{N}_$])`, "u");
  const match = re.exec(lineText);
  if (!match) return -1;
  return match.index + match[1]!.length;
}

/** First whole-word occurrence of `symbol` in `text` as a 0-based position. */
export function findSymbolInText(
  text: string,
  symbol: string,
): { line: number; character: number } | undefined {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const col = symbolColumnInLine(lines[i]!, symbol);
    if (col >= 0) return { line: i, character: col };
  }
  return undefined;
}

/** The identifier under a 0-based column, for labels. */
export function identifierAt(lineText: string, character: number): string {
  const word = /[\p{L}\p{N}_$]/u;
  let start = Math.max(0, Math.min(character, lineText.length));
  let end = start;
  while (start > 0 && word.test(lineText[start - 1]!)) start -= 1;
  while (end < lineText.length && word.test(lineText[end]!)) end += 1;
  return lineText.slice(start, end);
}

/** A symbol candidate. `line` is 1-based (as the symbol index reports it). */
export type CodeSymbolCandidate = {
  path: string;
  line: number;
  symbol: string;
  kind?: string;
};

function symbolMatches(candidate: string, wanted: string): boolean {
  const a = candidate.trim();
  const b = wanted.trim();
  if (a === b) return true;
  if (/::|\.|#/.test(b)) return a.endsWith(`.${b}`) || a.endsWith(`::${b}`);
  return symbolLeaf(a) === b;
}

/** Choose one declaration for `symbol`; ambiguous or missing names return an actionable error. */
export function pickSymbolCandidate(
  tool: string,
  candidates: CodeSymbolCandidate[],
  symbol: string,
  scope: { path?: string; line?: number } = {},
): CodeIntelParse<CodeSymbolCandidate> {
  const seen = new Set<string>();
  let hits = candidates.filter((row) => {
    if (!symbolMatches(row.symbol, symbol)) return false;
    const key = `${row.path}:${row.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (scope.path) hits = hits.filter((row) => row.path === scope.path);
  if (scope.line !== undefined) hits = hits.filter((row) => row.line === scope.line! + 1);
  if (hits.length === 1) return { ok: true, value: hits[0]! };
  if (!hits.length) {
    return {
      ok: false,
      reason: "missing",
      error: `${tool}: no declaration named "${symbol}"${scope.path ? ` in ${scope.path}` : " in workspace symbols"}. Pass path + line + column, or grep for it.`,
    };
  }
  const list = hits
    .slice(0, 8)
    .map((row) => `- ${row.symbol} ${row.path}:${row.line}`)
    .join("\n");
  const more = hits.length > 8 ? `\n… ${hits.length - 8} more` : "";
  return {
    ok: false,
    reason: "ambiguous",
    error: `${tool}: "${symbol}" is ambiguous (${hits.length} declarations). Pass path (and line/column) for one of:\n${list}${more}`,
  };
}

/** 0-based location with optional line text. */
export type CodeIntelLocation = {
  path: string;
  line: number;
  character: number;
  text?: string;
};

export function formatCodeLocation(loc: { path: string; line: number; character: number }): string {
  return `${loc.path}:${loc.line + 1}:${loc.character + 1}`;
}

function clipLine(text: string, max = 160): string {
  const one = text.replace(/\t/g, "  ").replace(/\s+$/, "");
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

/** Numbered snippet from `lines` starting at 0-based `start`. */
export function formatSnippet(lines: string[], start: number, count = 6): string {
  const out: string[] = [];
  const end = Math.min(lines.length, start + count);
  const width = String(end).length;
  for (let i = Math.max(0, start); i < end; i += 1) {
    out.push(`${String(i + 1).padStart(width)} | ${clipLine(lines[i] ?? "")}`);
  }
  return out.join("\n");
}

export function formatDefinitionResult(input: {
  from: CodeIntelLocation & { symbol?: string };
  definitions: Array<CodeIntelLocation & { snippet?: string }>;
  hover?: string;
}): string {
  const label = input.from.symbol ? `\`${input.from.symbol}\` at ` : "";
  if (!input.definitions.length) {
    return `No definition found for ${label}${formatCodeLocation(input.from)}. Check the column points at an identifier, or grep for it.`;
  }
  const parts: string[] = [];
  const hover = input.hover?.trim();
  if (hover) parts.push(hover.length > 600 ? `${hover.slice(0, 599)}…` : hover);
  for (const def of input.definitions) {
    parts.push(`Definition: ${formatCodeLocation(def)}${def.snippet ? `\n${def.snippet}` : ""}`);
  }
  return `${label ? `${label}${formatCodeLocation(input.from)}\n` : ""}${parts.join("\n\n")}`;
}

/** References grouped by file, each with 1-based line:column and the line text. */
export function formatReferences(input: {
  from: CodeIntelLocation & { symbol?: string };
  items: CodeIntelLocation[];
  limit?: number;
}): string {
  const limit = Math.max(1, Math.min(200, input.limit ?? 50));
  const label = input.from.symbol ? `\`${input.from.symbol}\`` : formatCodeLocation(input.from);
  if (!input.items.length) return `No references found for ${label}.`;
  const shown = input.items.slice(0, limit);
  const byFile = new Map<string, CodeIntelLocation[]>();
  for (const item of shown) {
    const list = byFile.get(item.path) ?? [];
    list.push(item);
    byFile.set(item.path, list);
  }
  const fileCount = new Set(input.items.map((item) => item.path)).size;
  const lines = [
    `${input.items.length} reference${input.items.length === 1 ? "" : "s"} to ${label} in ${fileCount} file${fileCount === 1 ? "" : "s"}`,
  ];
  for (const [path, list] of byFile) {
    lines.push("", path);
    for (const item of list.sort((a, b) => a.line - b.line || a.character - b.character)) {
      const text = item.text !== undefined ? `  ${clipLine(item.text.trim(), 140)}` : "";
      lines.push(`  ${item.line + 1}:${item.character + 1}${text}`);
    }
  }
  if (input.items.length > shown.length) {
    lines.push("", `… ${input.items.length - shown.length} more (raise limit, max 200)`);
  }
  return lines.join("\n");
}

export type CodeIntelDiagnostic = {
  path: string;
  startLine: number;
  startCharacter: number;
  message: string;
  severity: "error" | "warning" | "info";
};

function diagnosticLine(diag: CodeIntelDiagnostic): string {
  const first = diag.message.split("\n")[0] ?? "";
  return `${diag.path}:${diag.startLine + 1}:${diag.startCharacter + 1} ${diag.severity}: ${clipLine(first, 200)}`;
}

function sortDiagnostics(diags: CodeIntelDiagnostic[]): CodeIntelDiagnostic[] {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return [...diags].sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      a.path.localeCompare(b.path) ||
      a.startLine - b.startLine ||
      a.startCharacter - b.startCharacter,
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Compact diagnostics: errors first, then warnings; info dropped; capped. */
export function formatDiagnostics(input: {
  diagnostics: CodeIntelDiagnostic[];
  checked: string[];
  skipped?: string[];
  limit?: number;
}): string {
  const limit = Math.max(1, input.limit ?? 40);
  const rows = sortDiagnostics(input.diagnostics.filter((diag) => diag.severity !== "info"));
  const errors = rows.filter((diag) => diag.severity === "error").length;
  const warnings = rows.length - errors;
  const files = new Set(rows.map((diag) => diag.path)).size;
  const skipped = input.skipped?.length ? `\nSkipped: ${input.skipped.join("; ")}` : "";
  if (!rows.length) {
    const list = input.checked.slice(0, 12).join(", ");
    const more = input.checked.length > 12 ? `, … ${input.checked.length - 12} more` : "";
    return `No errors or warnings in ${plural(input.checked.length, "file")}${list ? `: ${list}${more}` : ""}.${skipped}`;
  }
  const lines = [
    `${plural(errors, "error")}, ${plural(warnings, "warning")} in ${plural(files, "file")} (checked ${input.checked.length})`,
    ...rows.slice(0, limit).map(diagnosticLine),
  ];
  if (rows.length > limit) lines.push(`… ${rows.length - limit} more`);
  return lines.join("\n") + skipped;
}

export const POST_EDIT_DIAGNOSTICS_CAP = 10;

/** Errors-only note appended after file_write / apply_patch / code_rename. */
export function formatPostEditDiagnostics(input: {
  errors: CodeIntelDiagnostic[];
  repeated?: number;
  cap?: number;
}): string | undefined {
  const cap = Math.max(1, input.cap ?? POST_EDIT_DIAGNOSTICS_CAP);
  const rows = sortDiagnostics(input.errors.filter((diag) => diag.severity === "error"));
  if (!rows.length) {
    return input.repeated
      ? `(${plural(input.repeated, "earlier type error")} still present in edited files; code_diagnostics lists them)`
      : undefined;
  }
  const lines = [
    `Type errors in edited files (not reverted, ${plural(rows.length, "new error")}):`,
    ...rows.slice(0, cap).map(diagnosticLine),
  ];
  if (rows.length > cap) lines.push(`… ${rows.length - cap} more (code_diagnostics for all)`);
  if (input.repeated) lines.push(`(${plural(input.repeated, "earlier error")} still present)`);
  return lines.join("\n");
}

export function formatSymbolList(input: {
  items: CodeSymbolCandidate[];
  path?: string;
  query?: string;
  limit?: number;
}): string {
  const limit = Math.max(1, input.limit ?? 80);
  const where = input.path ? `in ${input.path}` : "in workspace symbols";
  const what = input.query ? ` matching "${input.query}"` : "";
  if (!input.items.length) return `No symbols${what} ${where}.`;
  const lines = [`${plural(input.items.length, "symbol")}${what} ${where}`];
  for (const item of input.items.slice(0, limit)) {
    const kind = item.kind ? `${item.kind} ` : "";
    lines.push(
      input.path
        ? `  ${item.line}  ${kind}${item.symbol}`
        : `  ${kind}${item.symbol}  ${item.path}:${item.line}`,
    );
  }
  if (input.items.length > limit) lines.push(`… ${input.items.length - limit} more`);
  return lines.join("\n");
}

/** Changed lines between two versions of a file, for a rename (same line count). */
function changedLineIndexes(before: string[], after: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
    if (before[i] !== after[i]) out.push(i);
  }
  return out;
}

/** Minimal unified diff for rename edits (one hunk per changed line, no context). */
export function renameUnifiedDiff(
  files: Array<{ path: string; before: string; after: string }>,
): string {
  const out: string[] = [];
  for (const file of files) {
    if (file.before === file.after) continue;
    const before = file.before.split("\n");
    const after = file.after.split("\n");
    out.push(
      `diff --git a/${file.path} b/${file.path}`,
      `--- a/${file.path}`,
      `+++ b/${file.path}`,
    );
    if (before.length !== after.length) {
      out.push(`@@ -1,${before.length} +1,${after.length} @@`);
      out.push(...before.map((line) => `-${line}`), ...after.map((line) => `+${line}`));
      continue;
    }
    for (const i of changedLineIndexes(before, after)) {
      out.push(`@@ -${i + 1},1 +${i + 1},1 @@`, `-${before[i]}`, `+${after[i]}`);
    }
  }
  return out.join("\n");
}

export function renameChangedLineCount(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length !== b.length) return Math.max(a.length, b.length);
  return changedLineIndexes(a, b).length;
}

export const RENAME_DIFF_MAX_CHARS = 6_000;

export function formatRenameResult(input: {
  oldName: string;
  newName: string;
  files: Array<{ path: string; before: string; after: string }>;
}): string {
  const changed = input.files.filter((file) => file.before !== file.after);
  if (!changed.length) return `Nothing to rename: no references to \`${input.oldName}\` changed.`;
  const counts = changed.map((file) => ({
    path: file.path,
    lines: renameChangedLineCount(file.before, file.after),
  }));
  const total = counts.reduce((sum, row) => sum + row.lines, 0);
  const head = `Renamed \`${input.oldName}\` → \`${input.newName}\` in ${plural(changed.length, "file")} (${plural(total, "line")}):`;
  const list = counts.map((row) => `- ${row.path}: ${plural(row.lines, "line")}`);
  let diff = renameUnifiedDiff(changed);
  if (diff.length > RENAME_DIFF_MAX_CHARS) {
    const cut = diff.lastIndexOf("\n", RENAME_DIFF_MAX_CHARS);
    diff = `${diff.slice(0, cut > 0 ? cut : RENAME_DIFF_MAX_CHARS)}\n(diff truncated; git_diff for the rest)`;
  }
  return [head, ...list, "", diff].join("\n");
}

/** The unified diff a code_rename result carries after its summary, for workspace-change stats. */
export function codeRenameDiffFromResult(result?: string): string {
  if (!result) return "";
  const at = result.indexOf("\ndiff --git a/");
  if (at < 0) return "";
  return result.slice(at + 1);
}

export const CODE_INTEL_NO_WORKSPACE =
  "No host workspace for language-server lookups in this session. Use grep / file_read in the guest instead.";

/**
 * Why code_rename cannot run here, or undefined when it can. Rename writes the host copy of the
 * workspace, so it needs a host or Docker (bind-mounted) workspace on this machine; VM and worker
 * sessions only have a read mirror. Review sessions and allowlists without apply_patch stay read-only.
 */
export function codeRenameRefusal(input: {
  runtime?: string;
  worker?: boolean;
  kind?: string;
  allowedTools?: string[];
}): string | undefined {
  if (input.kind === "review") {
    return "code_rename is not available in review sessions (inspect and comment only).";
  }
  if (
    input.allowedTools?.length &&
    !input.allowedTools.includes(CODE_RENAME_TOOL_NAME) &&
    !input.allowedTools.includes("apply_patch")
  ) {
    return "code_rename is not allowed for this agent (its tool allowlist has no apply_patch).";
  }
  if (input.worker || (input.runtime !== "host" && input.runtime !== "docker")) {
    return "code_rename needs a Host or Docker workspace; this session's language server only sees a read-only mirror of the guest. Use code_references to list the call sites, then apply_patch each file.";
  }
  return undefined;
}
