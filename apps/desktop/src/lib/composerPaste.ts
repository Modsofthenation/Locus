import {
  deletePasteChipAt,
  insertPasteChips,
  pasteChipNames,
  sanitizePasteChipName,
  uniquePasteChipName,
} from "@locus/shared";

/** Matches `COMPOSER_FILE_CAP` in ComposerFiles. */
const FILE_CAP = 4;

function pasteFileKey(file: File): string {
  return sanitizePasteChipName(file.name);
}

export function applyComposerPaste(
  text: string,
  caret: number,
  current: File[],
  incoming: File[],
  caretEnd = caret,
): { text: string; cursor: number; files: File[] } {
  const room = Math.max(0, FILE_CAP - current.length);
  const used = current.map((file) => file.name);
  const added = incoming.slice(0, room).map((file) => {
    const name = uniquePasteChipName(file.name, used);
    used.push(name);
    if (name === file.name) return file;
    return new File([file], name, { type: file.type, lastModified: file.lastModified });
  });
  const inserted = insertPasteChips(
    text,
    caret,
    added.map((file) => file.name),
    caretEnd,
  );
  return { ...inserted, files: [...current, ...added] };
}

export function splitComposerFiles(text: string, files: File[]): { inline: File[]; bar: File[] } {
  const remaining = pasteChipNames(text);
  const inline: File[] = [];
  const bar: File[] = [];
  for (const file of files) {
    const at = remaining.indexOf(pasteFileKey(file));
    if (at >= 0) {
      remaining.splice(at, 1);
      inline.push(file);
    } else {
      bar.push(file);
    }
  }
  return { inline, bar };
}

export function removePasteFileAt(
  files: File[],
  text: string,
  chipStart: number,
  name: string,
): File[] {
  const key = sanitizePasteChipName(name);
  const before = pasteChipNames(text.slice(0, chipStart)).filter((row) => row === name).length;
  let seen = 0;
  const index = files.findIndex((file) => {
    if (pasteFileKey(file) !== key) return false;
    if (seen === before) return true;
    seen += 1;
    return false;
  });
  if (index < 0) return files;
  return files.filter((_, i) => i !== index);
}

export function applyComposerChipKey(
  key: string,
  text: string,
  caret: number,
  files: File[],
): { text: string; cursor: number; files: File[] } | null {
  const dir = key === "Backspace" ? "backward" : key === "Delete" ? "forward" : null;
  if (!dir) return null;
  const removed = deletePasteChipAt(text, caret, dir);
  if (!removed) return null;
  return {
    text: removed.text,
    cursor: removed.cursor,
    files: removePasteFileAt(files, text, removed.start, removed.name),
  };
}

export function fileForPasteChip(
  files: File[],
  name: string,
  occurrence: number,
): File | undefined {
  const key = sanitizePasteChipName(name);
  let seen = 0;
  for (const file of files) {
    if (pasteFileKey(file) !== key) continue;
    if (seen === occurrence) return file;
    seen += 1;
  }
  return undefined;
}

export function pointInRects(
  rects: ArrayLike<{ left: number; top: number; right: number; bottom: number }>,
  x: number,
  y: number,
): boolean {
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (!rect) continue;
    if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) return true;
  }
  return false;
}

export const PASTE_PREVIEW_MAX_CHARS = 8000;

export function pastePreviewText(text: string, max = PASTE_PREVIEW_MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…`;
}

export function highlightPasteChips(text: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapeAttr = (value: string) => escape(value).replace(/"/g, "&quot;");
  const re = /\[\[paste:([^\]]+)\]\]/g;
  let html = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    html += escape(text.slice(last, match.index));
    const name = match[1] ?? "";
    html += `<span class="composer-paste-chip" data-testid="composer-paste-chip" data-paste-name="${escapeAttr(name)}">${escape(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  html += escape(text.slice(last));
  if (text.endsWith("\n")) html += "<br>";
  return html || " ";
}

export function inlineAttachmentNames(content: string): Set<string> {
  const names = new Set(pasteChipNames(content));
  const pathRe = /\/workspace\/\.locus-attachments\/([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pathRe.exec(content))) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

export function leftoverAttachChips<T extends { name: string; storedName?: string }>(
  content: string,
  attachments: T[],
): T[] {
  const inline = inlineAttachmentNames(content);
  return attachments.filter(
    (item) =>
      !inline.has(item.name) &&
      !inline.has(item.storedName ?? "") &&
      !inline.has(sanitizePasteChipName(item.name)),
  );
}
