export type EditResult = { text: string; start: number; end: number };

export function indentUnitForLanguage(lang: string): string {
  return lang === "python" || lang === "django" ? "    " : "  ";
}

export function detectIndent(text: string, lang: string): string {
  const fallback = indentUnitForLanguage(lang);
  let tabs = 0;
  let two = 0;
  let four = 0;
  let from = 0;
  for (let n = 0; n < 80 && from <= text.length; n += 1) {
    const nl = text.indexOf("\n", from);
    const to = nl < 0 ? text.length : nl;
    const line = text.slice(from, to);
    if (line.startsWith("\t")) tabs += 1;
    else if (/^ {2}[^ ]/.test(line)) two += 1;
    else if (/^ {4}/.test(line)) four += 1;
    if (nl < 0) break;
    from = nl + 1;
  }
  if (tabs > two + four) return "\t";
  if (four > two) return "    ";
  if (two > 0) return "  ";
  return fallback;
}

export function lineCommentPrefix(lang: string): string | undefined {
  if (
    lang === "python" ||
    lang === "bash" ||
    lang === "yaml" ||
    lang === "toml" ||
    lang === "docker" ||
    lang === "ini" ||
    lang === "gitignore" ||
    lang === "graphql" ||
    lang === "hcl" ||
    lang === "powershell" ||
    lang === "cmake" ||
    lang === "elixir"
  )
    return "# ";
  if (lang === "sql" || lang === "lua") return "-- ";
  if (lang === "html" || lang === "xml" || lang === "markdown") return undefined;
  if (lang === "css" || lang === "django") return undefined;
  if (lang === "scss" || lang === "less") return "// ";
  if (!lang) return "// ";
  return "// ";
}

export function blockComment(lang: string): [string, string] | undefined {
  if (lang === "html" || lang === "xml" || lang === "markdown") return ["<!-- ", " -->"];
  if (lang === "django") return ["{# ", " #}"];
  if (lang === "css" || lang === "scss" || lang === "less") return ["/* ", " */"];
  return undefined;
}

function lineStart(text: string, index: number): number {
  return text.lastIndexOf("\n", index - 1) + 1;
}

function lineRange(text: string, start: number, end: number): { from: number; to: number } {
  const from = lineStart(text, start);
  let to = text.indexOf(
    "\n",
    Math.max(end - (end > start && text[end - 1] === "\n" ? 1 : 0), from),
  );
  if (end > start && text[end - 1] === "\n") to = end - 1;
  else if (to < 0) to = text.length;
  return { from, to };
}

export function applyTab(
  text: string,
  start: number,
  end: number,
  indent: string,
  shift: boolean,
): EditResult {
  if (start === end && !shift) {
    const next = text.slice(0, start) + indent + text.slice(end);
    const at = start + indent.length;
    return { text: next, start: at, end: at };
  }
  const { from, to } = lineRange(text, start, end);
  const block = text.slice(from, to);
  const lines = block.split("\n");
  const nextLines = lines.map((line) => {
    if (!shift) return indent + line;
    if (line.startsWith(indent)) return line.slice(indent.length);
    if (line.startsWith("\t")) return line.slice(1);
    if (line.startsWith("    ")) return line.slice(4);
    if (line.startsWith("  ")) return line.slice(2);
    return line.replace(/^ +/, "");
  });
  const nextBlock = nextLines.join("\n");
  const next = text.slice(0, from) + nextBlock + text.slice(to);
  const deltaStart = (nextLines[0]?.length ?? 0) - (lines[0]?.length ?? 0);
  const delta = nextBlock.length - block.length;
  return {
    text: next,
    start: Math.max(from, start + deltaStart),
    end: Math.max(from, end + delta),
  };
}

export function applyEnter(text: string, start: number, indent: string): EditResult {
  const from = lineStart(text, start);
  const line = text.slice(from, start);
  const lead = line.match(/^[ \t]*/)?.[0] ?? "";
  const extra = /[:{([]$/.test(line.trimEnd()) ? indent : "";
  const insert = `\n${lead}${extra}`;
  const next = text.slice(0, start) + insert + text.slice(start);
  const at = start + insert.length;
  return { text: next, start: at, end: at };
}

export function toggleComment(text: string, start: number, end: number, lang: string): EditResult {
  const linePrefix = lineCommentPrefix(lang);
  if (linePrefix) return toggleLineComment(text, start, end, linePrefix);
  const block = blockComment(lang);
  if (!block) return { text, start, end };
  return toggleBlockComment(text, start, end, block[0], block[1]);
}

function toggleLineComment(text: string, start: number, end: number, prefix: string): EditResult {
  const { from, to } = lineRange(text, start, end);
  const block = text.slice(from, to);
  const lines = block.split("\n");
  const bare = prefix.trimEnd();
  const commented = lines.every((line) => !line.trim() || line.trimStart().startsWith(bare));
  const nextLines = lines.map((line) => {
    if (!line.trim()) return line;
    if (commented) {
      const lead = line.match(/^[ \t]*/)?.[0] ?? "";
      const rest = line.slice(lead.length);
      if (rest.startsWith(prefix)) return lead + rest.slice(prefix.length);
      if (rest.startsWith(bare)) {
        const cut = rest[bare.length] === " " ? bare.length + 1 : bare.length;
        return lead + rest.slice(cut);
      }
      return line;
    }
    return line.match(/^[ \t]*/)?.[0] + prefix + line.trimStart();
  });
  const nextBlock = nextLines.join("\n");
  const next = text.slice(0, from) + nextBlock + text.slice(to);
  return {
    text: next,
    start: from,
    end: from + nextBlock.length,
  };
}

function toggleBlockComment(
  text: string,
  start: number,
  end: number,
  open: string,
  close: string,
): EditResult {
  const from = start === end ? lineStart(text, start) : start;
  const to =
    start === end ? (text.indexOf("\n", start) < 0 ? text.length : text.indexOf("\n", start)) : end;
  const slice = text.slice(from, to);
  const wrapped = slice.startsWith(open) && slice.endsWith(close);
  const inner = wrapped
    ? slice.slice(open.length, slice.length - close.length)
    : `${open}${slice}${close}`;
  const next = text.slice(0, from) + inner + text.slice(to);
  return { text: next, start: from, end: from + inner.length };
}

export function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
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

export function offsetAtLine(text: string, line: number): number {
  if (line <= 1) return 0;
  let current = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      current += 1;
      if (current === line) return i + 1;
    }
  }
  return text.length;
}

export function findMatches(text: string, query: string, caseSensitive = false): number[] {
  const needle = query.trim();
  if (!needle) return [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const find = caseSensitive ? needle : needle.toLowerCase();
  const hits: number[] = [];
  let from = 0;
  while (from <= hay.length - find.length) {
    const at = hay.indexOf(find, from);
    if (at < 0) break;
    hits.push(at);
    from = at + Math.max(1, find.length);
  }
  return hits;
}

export function replaceMatch(
  text: string,
  start: number,
  query: string,
  replacement: string,
): EditResult {
  if (!query) return { text, start, end: start };
  const end = start + query.length;
  if (
    text.slice(start, end) !== query &&
    text.slice(start, end).toLowerCase() !== query.toLowerCase()
  ) {
    return { text, start, end: start };
  }
  const actual = text.slice(start, end);
  const next = text.slice(0, start) + replacement + text.slice(start + actual.length);
  const at = start + replacement.length;
  return { text: next, start: at, end: at };
}

export function replaceAllMatches(text: string, query: string, replacement: string): EditResult {
  const hits = findMatches(text, query);
  if (!hits.length) return { text, start: 0, end: 0 };
  let next = text;
  let shift = 0;
  for (const at of hits) {
    const start = at + shift;
    const actualLen = query.length;
    next = next.slice(0, start) + replacement + next.slice(start + actualLen);
    shift += replacement.length - actualLen;
  }
  return { text: next, start: next.length, end: next.length };
}

export function offsetAtLineCol(text: string, line: number, character: number): number {
  let lineNo = 0;
  let i = 0;
  while (i < text.length && lineNo < line) {
    if (text[i] === "\n") lineNo += 1;
    i += 1;
  }
  return Math.min(text.length, i + Math.max(0, character));
}

export function applyOffsetEdits(
  text: string,
  edits: Array<{ start: number; end: number; newText: string }>,
  caret: number,
): EditResult {
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let next = text;
  let at = caret;
  for (const edit of ordered) {
    next = next.slice(0, edit.start) + edit.newText + next.slice(edit.end);
    const delta = edit.newText.length - (edit.end - edit.start);
    if (edit.end <= caret) at += delta;
    else if (edit.start < caret) at = edit.start + edit.newText.length;
  }
  return { text: next, start: at, end: at };
}

export function suggestedChildPath(parent: string, name: string): string {
  const cleanName = name
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\.\//g, "")
    .trim();
  if (!cleanName) return "";
  if (!parent) return cleanName;
  return `${parent.replace(/\/+$/, "")}/${cleanName}`;
}
