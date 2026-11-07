import { normalizeRepoPath } from "./repoMap.js";

/** `@src/app.ts` mentions in a chat prompt. Emails like `a@b.com` are ignored. */
const MENTION = /(?:^|[\s(])@([A-Za-z0-9_./-]+)/g;

export function fileMentions(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(MENTION.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const path = normalizeRepoPath(match[1] ?? "");
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

function mentionBefore(text: string, cursor: number): { start: number; query: string } | null {
  const at = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, at);
  const from = before.lastIndexOf("@");
  if (from < 0) return null;
  if (from > 0 && /[\w./]/.test(before[from - 1] ?? "")) return null;
  const query = before.slice(from + 1);
  if (!query.length && from === 0 && text.startsWith("/")) return null;
  if (/[\s\n]/.test(query)) return null;
  if (query.length > 200) return null;
  return { start: from, query };
}

export function fileMentionQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const at = Math.max(0, Math.min(cursor, text.length));
  return mentionBefore(text, at) ?? (at === 0 ? mentionBefore(text, text.length) : null);
}

export function insertFileMention(
  text: string,
  cursor: number,
  path: string,
): { text: string; cursor: number } {
  const clean = normalizeRepoPath(path);
  if (!clean) return { text, cursor };
  const insert = `@${clean} `;
  const hit = fileMentionQuery(text, cursor);
  const start = hit?.start ?? cursor;
  const end = hit ? Math.max(cursor, start + 1 + hit.query.length) : cursor;
  const next = `${text.slice(0, start)}${insert}${text.slice(end)}`;
  return { text: next, cursor: start + insert.length };
}
