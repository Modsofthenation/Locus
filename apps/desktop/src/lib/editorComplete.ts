import { applyOffsetEdits, offsetAtLineCol } from "./editorEdit";

export type CompletionKind = "word" | "keyword" | "snippet" | "tag" | "symbol";

export interface CompletionItem {
  label: string;
  insert: string;
  kind: CompletionKind;
  detail?: string;
  additionalEdits?: Array<{
    path?: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
    newText: string;
  }>;
}

export interface CompletionQuery {
  text: string;
  offset: number;
  lang: string;
  extraWords?: readonly string[];
  indent?: string;
  forced?: boolean;
}

const MAX_ITEMS = 10;
const IDENT = /[A-Za-z_$][\w$]*/g;

const JS_LANG = new Set(["js", "ts", "jsx", "tsx"]);
const PY_LANG = new Set(["python"]);
const HTML_LANG = new Set(["html", "xml", "django"]);
const CSS_LANG = new Set(["css", "scss", "less"]);

const JS_KEYWORDS = [
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "interface",
  "let",
  "new",
  "null",
  "return",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "undefined",
  "while",
];

const PY_KEYWORDS = [
  "True",
  "False",
  "None",
  "and",
  "as",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "if",
  "import",
  "in",
  "lambda",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "self",
  "try",
  "while",
  "with",
  "yield",
];

const HTML_TAGS = [
  "a",
  "article",
  "aside",
  "body",
  "button",
  "div",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "head",
  "header",
  "html",
  "img",
  "input",
  "label",
  "li",
  "main",
  "nav",
  "p",
  "script",
  "section",
  "span",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

const DJANGO_TAGS = [
  "autoescape",
  "block",
  "comment",
  "csrf_token",
  "elif",
  "else",
  "endblock",
  "endfor",
  "endif",
  "extends",
  "filter",
  "for",
  "if",
  "include",
  "load",
  "static",
  "trans",
  "url",
  "with",
];

const JS_SNIPPETS: CompletionItem[] = [
  { label: "log", insert: "console.log($0)", kind: "snippet", detail: "console.log" },
  { label: "useState", insert: "useState($0)", kind: "snippet", detail: "React" },
  {
    label: "useEffect",
    insert: "useEffect(() => {\n  $0\n}, [])",
    kind: "snippet",
    detail: "React",
  },
  { label: "useMemo", insert: "useMemo(() => $0, [])", kind: "snippet", detail: "React" },
  {
    label: "useCallback",
    insert: "useCallback(() => {\n  $0\n}, [])",
    kind: "snippet",
    detail: "React",
  },
  { label: "useRef", insert: "useRef($0)", kind: "snippet", detail: "React" },
  { label: "fn", insert: "function $0() {\n  \n}", kind: "snippet", detail: "function" },
  {
    label: "afn",
    insert: "async function $0() {\n  \n}",
    kind: "snippet",
    detail: "async function",
  },
  { label: "imp", insert: 'import { $0 } from ""', kind: "snippet", detail: "import" },
];

const PY_SNIPPETS: CompletionItem[] = [
  { label: "def", insert: "def $0():\n    ", kind: "snippet", detail: "function" },
  { label: "cls", insert: "class $0:\n    ", kind: "snippet", detail: "class" },
  {
    label: "main",
    insert: 'if __name__ == "__main__":\n    $0',
    kind: "snippet",
    detail: "entrypoint",
  },
  { label: "pr", insert: "print($0)", kind: "snippet", detail: "print" },
  {
    label: "try",
    insert: "try:\n    $0\nexcept Exception:\n    ",
    kind: "snippet",
    detail: "try/except",
  },
  {
    label: "with",
    insert: "with open($0) as handle:\n    ",
    kind: "snippet",
    detail: "with open",
  },
  {
    label: "for",
    insert: "for item in $0:\n    ",
    kind: "snippet",
    detail: "for",
  },
  {
    label: "comp",
    insert: "[$0 for item in items]",
    kind: "snippet",
    detail: "comprehension",
  },
  {
    label: "dcls",
    insert: "@dataclass\nclass $0:\n    ",
    kind: "snippet",
    detail: "dataclass",
  },
  {
    label: "pytest",
    insert: "def test_$0():\n    assert True\n",
    kind: "snippet",
    detail: "pytest",
  },
  {
    label: "djview",
    insert: 'def $0(request):\n    return render(request, "")\n',
    kind: "snippet",
    detail: "Django view",
  },
];

const CSS_PROPERTIES = [
  "align-items",
  "background",
  "background-color",
  "border",
  "border-radius",
  "bottom",
  "box-shadow",
  "color",
  "content",
  "cursor",
  "display",
  "flex",
  "flex-direction",
  "font-family",
  "font-size",
  "font-weight",
  "gap",
  "grid-template-columns",
  "height",
  "justify-content",
  "left",
  "line-height",
  "margin",
  "max-width",
  "min-height",
  "opacity",
  "overflow",
  "padding",
  "position",
  "right",
  "text-align",
  "top",
  "transform",
  "transition",
  "white-space",
  "width",
  "z-index",
];

const CSS_SNIPPETS: CompletionItem[] = [
  {
    label: "@media",
    insert: "@media $0 {\n  \n}",
    kind: "snippet",
    detail: "media query",
  },
  {
    label: "@keyframes",
    insert: "@keyframes $0 {\n  from {\n    \n  }\n  to {\n    \n  }\n}",
    kind: "snippet",
    detail: "keyframes",
  },
];

const DJANGO_SNIPPETS: CompletionItem[] = [
  { label: "block", insert: "{% block $0 %}\n\n{% endblock %}", kind: "snippet" },
  { label: "for", insert: "{% for $0 in %}\n\n{% endfor %}", kind: "snippet" },
  { label: "if", insert: "{% if $0 %}\n\n{% endif %}", kind: "snippet" },
  { label: "extends", insert: '{% extends "$0" %}', kind: "snippet" },
  { label: "include", insert: '{% include "$0" %}', kind: "snippet" },
  { label: "load", insert: "{% load $0 %}", kind: "snippet" },
];

export function tokenAt(
  text: string,
  offset: number,
  lang = "",
): { prefix: string; start: number; trigger: "ident" | "tag" | "django" } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const django = before.match(/\{%\s*([a-z_]*)$/i);
  if (django) {
    return {
      prefix: django[1] ?? "",
      start: clamped - (django[1]?.length ?? 0),
      trigger: "django",
    };
  }
  const tag = before.match(/<([A-Za-z][\w-]*)$/);
  if (tag) {
    return { prefix: tag[1] ?? "", start: clamped - (tag[1]?.length ?? 0), trigger: "tag" };
  }
  if (CSS_LANG.has(lang)) {
    const css = before.match(/(?:--|[@.#$]|[A-Za-z_])[\w-]*$/);
    if (css) {
      return { prefix: css[0], start: clamped - css[0].length, trigger: "ident" };
    }
    return { prefix: "", start: clamped, trigger: "ident" };
  }
  const ident = before.match(/[A-Za-z_$][\w$]*$/);
  if (ident) {
    return { prefix: ident[0], start: clamped - ident[0].length, trigger: "ident" };
  }
  return { prefix: "", start: clamped, trigger: "ident" };
}

export function harvestWords(text: string): string[] {
  const slice = text.length > 80_000 ? text.slice(0, 80_000) : text;
  const seen = new Set<string>();
  const words: string[] = [];
  IDENT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IDENT.exec(slice))) {
    const word = match[0];
    if (word.length < 2 || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

function lineIndentAt(text: string, offset: number): string {
  const from = text.lastIndexOf("\n", offset - 1) + 1;
  return text.slice(from, offset).match(/^[ \t]*/)?.[0] ?? "";
}

export function expandSnippet(insert: string, lead: string): { text: string; cursor: number } {
  const indented = insert.replace(/\n/g, `\n${lead}`);
  const mark = indented.indexOf("$0");
  if (mark < 0) return { text: indented, cursor: indented.length };
  return { text: indented.replace("$0", ""), cursor: mark };
}

function kindRank(kind: CompletionKind): number {
  if (kind === "symbol") return 0;
  if (kind === "word") return 1;
  if (kind === "snippet") return 2;
  if (kind === "tag") return 3;
  return 4;
}

function scoreItem(item: CompletionItem, prefix: string): number | null {
  if (!prefix) return kindRank(item.kind);
  const needle = prefix.toLowerCase();
  const label = item.label.toLowerCase();
  const detail = (item.detail ?? "").toLowerCase();
  if (label === needle) return kindRank(item.kind);
  if (label.startsWith(needle)) return 10 + kindRank(item.kind);
  if (detail.startsWith(needle) || item.insert.toLowerCase().startsWith(needle)) {
    return 20 + kindRank(item.kind);
  }
  if (label.includes(needle)) return 30 + kindRank(item.kind);
  return null;
}

function catalog(lang: string, trigger: "ident" | "tag" | "django"): CompletionItem[] {
  if (trigger === "django" || lang === "django") {
    const tags = DJANGO_TAGS.map((label) => ({
      label,
      insert: label,
      kind: "keyword" as const,
      detail: "django",
    }));
    return trigger === "django" ? [...DJANGO_SNIPPETS, ...tags] : [...DJANGO_SNIPPETS, ...tags];
  }
  if (trigger === "tag" || HTML_LANG.has(lang)) {
    const tags = HTML_TAGS.map((label) => ({
      label,
      insert: label,
      kind: "tag" as const,
      detail: "tag",
    }));
    if (trigger === "tag") return tags;
    if (lang === "html" || lang === "xml") return tags;
  }
  if (JS_LANG.has(lang)) {
    return [
      ...JS_SNIPPETS,
      ...JS_KEYWORDS.map((label) => ({
        label,
        insert: label,
        kind: "keyword" as const,
        detail: "keyword",
      })),
    ];
  }
  if (PY_LANG.has(lang)) {
    return [
      ...PY_SNIPPETS,
      ...PY_KEYWORDS.map((label) => ({
        label,
        insert: label,
        kind: "keyword" as const,
        detail: "keyword",
      })),
    ];
  }
  if (CSS_LANG.has(lang)) {
    return [
      ...CSS_SNIPPETS,
      ...CSS_PROPERTIES.map((label) => ({
        label,
        insert: label,
        kind: "keyword" as const,
        detail: "css",
      })),
    ];
  }
  return [];
}

export function completeAt(input: CompletionQuery): CompletionItem[] {
  const offset = Math.max(0, Math.min(input.offset, input.text.length));
  const { prefix, trigger } = tokenAt(input.text, offset, input.lang);
  if (!input.forced && prefix.length < 2 && trigger === "ident") return [];
  const words = harvestWords(input.text)
    .concat(input.extraWords ?? [])
    .filter((word) => word !== prefix);
  const fromFile: CompletionItem[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    fromFile.push({ label: word, insert: word, kind: "word", detail: "in file" });
  }
  const items = [...fromFile, ...catalog(input.lang, trigger)];
  const ranked = items
    .map((item) => {
      const score = scoreItem(item, prefix);
      return score == null ? null : { item, score };
    })
    .filter((row): row is { item: CompletionItem; score: number } => Boolean(row))
    .sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
  const out: CompletionItem[] = [];
  const used = new Set<string>();
  for (const row of ranked) {
    const key = `${row.item.kind}:${row.item.label}`;
    if (used.has(key)) continue;
    used.add(key);
    out.push(row.item);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

const KINDS = new Set<CompletionKind>(["word", "keyword", "snippet", "tag", "symbol"]);

export function fromRemoteCompletion(row: {
  label: string;
  insert?: string;
  kind?: string;
  detail?: string;
  additionalEdits?: CompletionItem["additionalEdits"];
}): CompletionItem {
  const insert = row.insert || row.label;
  const kind: CompletionKind =
    insert.includes("$0") || insert.includes("$1")
      ? "snippet"
      : KINDS.has(row.kind as CompletionKind)
        ? (row.kind as CompletionKind)
        : "symbol";
  return {
    label: row.label,
    insert,
    kind,
    detail: row.detail,
    additionalEdits: row.additionalEdits,
  };
}

export function mergeCompletions(
  remote: readonly CompletionItem[],
  local: readonly CompletionItem[],
  limit = 16,
): CompletionItem[] {
  const out: CompletionItem[] = [];
  const seen = new Set<string>();
  for (const item of [...remote, ...local]) {
    const key = item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function shouldAutoComplete(
  text: string,
  offset: number,
  forced = false,
  lang = "",
): boolean {
  if (forced) return true;
  const ch = offset > 0 ? text[offset - 1] : "";
  if (ch === "." || ch === "/" || ch === "<") return true;
  if (CSS_LANG.has(lang) && (ch === ":" || ch === "-" || ch === "@" || ch === "#" || ch === "$")) {
    return true;
  }
  const { prefix, trigger } = tokenAt(text, offset, lang);
  if (trigger === "tag" || trigger === "django") return true;
  return prefix.length >= 2;
}

export function applyCompletion(
  text: string,
  offset: number,
  item: CompletionItem,
  indent = "  ",
  currentPath = "",
  lang = "",
): { text: string; start: number; end: number } {
  const { prefix, start } = tokenAt(text, offset, lang);
  void prefix;
  const lead = lineIndentAt(text, start);
  const snippet = item.kind === "snippet" ? expandSnippet(item.insert, lead) : null;
  const insert = snippet ? snippet.text : item.insert;
  const cursor = snippet ? snippet.cursor : insert.length;
  const extras = (item.additionalEdits ?? [])
    .filter((edit) => !edit.path || !currentPath || edit.path === currentPath)
    .map((edit) => ({
      start: offsetAtLineCol(text, edit.startLine, edit.startCharacter),
      end: offsetAtLineCol(text, edit.endLine, edit.endCharacter),
      newText: edit.newText,
    }))
    .filter((edit) => edit.start !== start || edit.end !== offset);
  const next = text.slice(0, start) + insert + text.slice(offset);
  const shift = insert.length - (offset - start);
  const shifted = extras.map((edit) => ({
    start: edit.start >= offset ? edit.start + shift : edit.start,
    end: edit.end >= offset ? edit.end + shift : edit.end,
    newText: edit.newText,
  }));
  const at = start + cursor;
  void indent;
  if (!shifted.length) return { text: next, start: at, end: at };
  return applyOffsetEdits(next, shifted, at);
}

export function caretOffset(
  text: string,
  offset: number,
  metrics: {
    pad: number;
    lineHeight: number;
    charWidth: number;
    scrollTop: number;
    scrollLeft: number;
  },
): { left: number; top: number } {
  const { line, col } = offsetToLineColLocal(text, offset);
  return {
    left: metrics.pad + (col - 1) * metrics.charWidth - metrics.scrollLeft,
    top: metrics.pad + line * metrics.lineHeight - metrics.scrollTop,
  };
}

function offsetToLineColLocal(text: string, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let last = 0;
  for (let i = 0; i < clamped; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      last = i + 1;
    }
  }
  return { line, col: clamped - last + 1 };
}
