/** Inline clipboard paste chips in the composer: `[[paste:clip.png]]`. */

export const PASTE_CHIP_RE = /\[\[paste:([^\]]+)\]\]/g;

export function sanitizePasteChipName(name: string): string {
  const cleaned = name
    .replace(/[[\]]/g, "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "pasted";
}

export function pasteChipToken(name: string): string {
  return `[[paste:${sanitizePasteChipName(name)}]]`;
}

/** `clip.png` / `clip 2.png` so two same-name pastes stay distinct tokens. */
export function uniquePasteChipName(name: string, usedNames: string[]): string {
  const base = sanitizePasteChipName(name);
  const taken = new Set(usedNames.map((row) => sanitizePasteChipName(row).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const ext = base.match(/(\.[A-Za-z0-9]{1,8})$/)?.[1] ?? "";
  const stem = ext ? base.slice(0, -ext.length) : base;
  let n = 2;
  while (taken.has(`${stem} ${n}${ext}`.toLowerCase())) n += 1;
  return `${stem} ${n}${ext}`;
}

export function pasteChipNames(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(PASTE_CHIP_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match[1]) out.push(match[1]);
  }
  return out;
}

export function pasteChipSpans(text: string): { start: number; end: number; name: string }[] {
  const out: { start: number; end: number; name: string }[] = [];
  const re = new RegExp(PASTE_CHIP_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (!match[1]) continue;
    out.push({ start: match.index, end: match.index + match[0].length, name: match[1] });
  }
  return out;
}

export function insertPasteChips(
  text: string,
  caret: number,
  names: string[],
  caretEnd = caret,
): { text: string; cursor: number } {
  const from = Math.max(0, Math.min(caret, caretEnd, text.length));
  const to = Math.max(0, Math.min(Math.max(caret, caretEnd), text.length));
  const tokens = names.map((name) => pasteChipToken(name)).filter(Boolean);
  if (!tokens.length) return { text, cursor: from };
  const lead = from > 0 && text[from - 1] && !/\s/.test(text[from - 1]!) ? "\n" : "";
  const insert = `${lead}${tokens.map((token) => `${token} `).join("")}`;
  return {
    text: `${text.slice(0, from)}${insert}${text.slice(to)}`,
    cursor: from + insert.length,
  };
}

/** If the caret sits inside a chip, snap it to the nearer edge so it doesn't look stranded. */
export function snapPasteChipCaret(text: string, caret: number): number {
  const at = Math.max(0, Math.min(caret, text.length));
  for (const { start, end } of pasteChipSpans(text)) {
    if (at <= start || at >= end) continue;
    return at - start <= end - at ? start : end;
  }
  return at;
}

/** Expand a range so it doesn't start or end in the middle of a chip. */
export function snapPasteChipSelection(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  if (start === end) {
    const at = snapPasteChipCaret(text, start);
    return { start: at, end: at };
  }
  const from = Math.max(0, Math.min(start, end, text.length));
  const to = Math.max(0, Math.min(Math.max(start, end), text.length));
  let nextFrom = from;
  let nextTo = to;
  for (const span of pasteChipSpans(text)) {
    if (from > span.start && from < span.end) nextFrom = span.start;
    if (to > span.start && to < span.end) nextTo = span.end;
  }
  return start <= end ? { start: nextFrom, end: nextTo } : { start: nextTo, end: nextFrom };
}

/** Skip a chip as one token when the caret is on/inside it. */
export function movePasteChipCaret(
  text: string,
  caret: number,
  dir: "backward" | "forward",
): number | null {
  for (const { start, end } of pasteChipSpans(text)) {
    const hit = dir === "backward" ? caret > start && caret <= end : caret >= start && caret < end;
    if (hit) return dir === "backward" ? start : end;
  }
  return null;
}

/** Chip covering the caret for Backspace (inside / after) or Delete (inside / before). */
export function deletePasteChipAt(
  text: string,
  caret: number,
  dir: "backward" | "forward",
): { text: string; cursor: number; start: number; name: string } | null {
  for (const { start, end, name } of pasteChipSpans(text)) {
    const hit = dir === "backward" ? caret > start && caret <= end : caret >= start && caret < end;
    if (!hit) continue;
    return {
      text: `${text.slice(0, start)}${text.slice(end)}`,
      cursor: start,
      start,
      name,
    };
  }
  return null;
}

/** True when `landed` is `sent` after clipboard chips were interpolated in place. */
export function pasteChipPromptMatches(sent: string, landed: string): boolean {
  if (landed === sent) return true;
  if (sent.length > 0 && landed.startsWith(`${sent}\n`)) return true;
  const names = pasteChipNames(sent);
  if (!names.length) return false;
  let from = 0;
  let at = 0;
  for (const name of names) {
    const token = pasteChipToken(name);
    const tokenAt = sent.indexOf(token, from);
    if (tokenAt < 0) return false;
    const before = sent.slice(from, tokenAt);
    if (landed.slice(at, at + before.length) !== before) return false;
    at += before.length;
    while (landed[at] === "\n" || landed[at] === " ") at += 1;
    const prefix = `${name} at /workspace/.locus-attachments/`;
    if (!landed.startsWith(prefix, at)) return false;
    at += prefix.length;
    const storedEnd = consumeStoredAttachmentName(landed, at, name);
    if (storedEnd < 0) return false;
    at = storedEnd;
    while (landed[at] === "\n") at += 1;
    from = tokenAt + token.length;
  }
  const tail = sent.slice(from);
  if (!landed.startsWith(tail, at)) return false;
  at += tail.length;
  return at === landed.length || landed.startsWith("\n", at);
}

function consumeStoredAttachmentName(landed: string, at: number, name: string): number {
  const next = landed[at + name.length];
  if (
    landed.startsWith(name, at) &&
    (at + name.length === landed.length || next === " " || next === "\n")
  ) {
    return at + name.length;
  }
  const match = landed.slice(at).match(/^[^\s\n]+/);
  return match ? at + match[0].length : -1;
}
