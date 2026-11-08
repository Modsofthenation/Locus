import { type ReactNode } from "react";

/** Wrap case-insensitive matches of `query` in <mark>. */
export function HighlightQuery(props: { text: string; query: string }): ReactNode {
  const q = props.query.trim();
  if (!q) return props.text;
  const lower = props.text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let key = 0;
  while (from < props.text.length) {
    const idx = lower.indexOf(needle, from);
    if (idx === -1) {
      parts.push(props.text.slice(from));
      break;
    }
    if (idx > from) parts.push(props.text.slice(from, idx));
    parts.push(<mark key={key++}>{props.text.slice(idx, idx + needle.length)}</mark>);
    from = idx + needle.length;
  }
  return parts;
}
