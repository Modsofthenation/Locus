/** True when `index` sits in markup, not inside a comment, script, or style. */
export function isHtmlMarkupIndex(html: string, index: number): boolean {
  if (index < 0 || index > html.length) return false;
  const before = html.slice(0, index);
  const lastCommentOpen = before.lastIndexOf("<!--");
  const lastCommentClose = before.lastIndexOf("-->");
  if (lastCommentOpen > lastCommentClose) return false;
  const lower = before.toLowerCase();
  const lastScript = lastOpenTag(lower, "script");
  const lastScriptClose = lower.lastIndexOf("</script");
  if (lastScript > lastScriptClose) return false;
  const lastStyle = lastOpenTag(lower, "style");
  const lastStyleClose = lower.lastIndexOf("</style");
  if (lastStyle > lastStyleClose) return false;
  return true;
}

function lastOpenTag(lower: string, tag: string): number {
  const needle = `<${tag}`;
  let at = -1;
  let from = 0;
  while (from < lower.length) {
    const next = lower.indexOf(needle, from);
    if (next < 0) return at;
    const after = lower[next + needle.length];
    if (
      after === undefined ||
      after === ">" ||
      after === " " ||
      after === "\t" ||
      after === "\n" ||
      after === "\r" ||
      after === "/"
    ) {
      at = next;
    }
    from = next + needle.length;
  }
  return at;
}

/** First `needle` match that is not inside a comment, script, or style. */
export function indexOfHtmlMarkup(html: string, needle: RegExp, from = 0): number {
  const flags = needle.flags.includes("g") ? needle.flags : `${needle.flags}g`;
  const re = new RegExp(needle.source, flags);
  re.lastIndex = Math.max(0, from);
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    if (isHtmlMarkupIndex(html, match.index)) return match.index;
    if (!match[0].length) re.lastIndex += 1;
  }
  return -1;
}

/** Drop HTML comments that are not inside a script or style. */
export function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, (block, offset: number) =>
    isHtmlMarkupIndex(html, offset) ? "" : block,
  );
}
