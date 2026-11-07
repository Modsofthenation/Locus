import {
  CANVAS_SEQ_ATTR,
  withCanvasPreviewGuard,
  withEditHook,
  withPickHook,
  withPinHook,
  type DesignComment,
} from "@locus/shared";

export { CANVAS_SEQ_ATTR };

function insertAfterOpenTag(html: string, tag: RegExp, snippet: string): string | undefined {
  const match = html.match(tag);
  if (!match || match.index == null) return undefined;
  const at = match.index + match[0].length;
  return `${html.slice(0, at)}${snippet}${html.slice(at)}`;
}

function tagBalance(html: string, tag: string): number {
  const open = html.match(new RegExp(`<${tag}\\b[^>]*>`, "gi"))?.length ?? 0;
  const close = html.match(new RegExp(`</${tag}\\s*>`, "gi"))?.length ?? 0;
  return open - close;
}

/**
 * Close truncated streaming HTML so the preview can apply CSS instead of
 * painting a blank white document between tokens.
 */
export function stabilizeStreamingHtml(html: string): string {
  if (!html.trim()) return html;
  let out = html;
  const lastLt = out.lastIndexOf("<");
  const lastGt = out.lastIndexOf(">");
  if (lastLt > lastGt) out = out.slice(0, lastLt);

  if (tagBalance(out, "script") > 0) {
    const at = out.toLowerCase().lastIndexOf("<script");
    if (at >= 0) out = out.slice(0, at);
  }

  if (tagBalance(out, "style") > 0) out += "</style>";
  if (tagBalance(out, "head") > 0) out += "</head>";
  if (tagBalance(out, "body") > 0) out += "</body>";
  else if (/<html\b/i.test(out) && !/<body\b/i.test(out) && /<\/head>/i.test(out)) {
    out += "<body></body>";
  }
  if (tagBalance(out, "html") > 0) out += "</html>";
  return out;
}

/** Skip iframe swaps that would replace a painted canvas with a blank head-only draft. */
export function isCanvasPaintReady(html: string): boolean {
  const trimmed = html.trim();
  if (!trimmed) return false;
  if (/<body\b[^>]*>(?:\s*<(?!\/body)|\s*[^<\s])/i.test(trimmed)) return true;
  if (
    /<(?:div|main|section|header|article|h[1-6]|p|nav|footer|button|table|ul|ol|svg)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (trimmed.length < 16) return false;
  if (/<style\b[^>]*>[\s\S]*\{[\s\S]{8,}<\/style>/i.test(trimmed)) return true;
  return trimmed.length >= 800;
}

/** Stop mouse-follow / parallax scripts so the canvas preview stays readable. */
export function withPreviewGuard(html: string): string {
  return withCanvasPreviewGuard(html);
}

export { withEditHook, withPickHook, withPinHook };

export function withCanvasBase(html: string, href: string): string {
  if (!href.trim() || /<base\b/i.test(html)) return html;
  const tag = `<base href="${href}">`;
  return (
    insertAfterOpenTag(html, /<head\b[^>]*>/i, tag) ??
    insertAfterOpenTag(html, /<html\b[^>]*>/i, `<head>${tag}</head>`) ??
    `<head>${tag}</head>${html}`
  );
}

export function prepareCanvasHtml(
  html: string,
  interaction: boolean | "comment" | "edit" | "inspect" = false,
  baseHref?: string,
  livePointers?: boolean,
  pins?: DesignComment[],
): string {
  const stabilized = stabilizeStreamingHtml(html);
  const guarded = withCanvasPreviewGuard(stabilized, undefined, { livePointers });
  const based = baseHref ? withCanvasBase(guarded, baseHref) : guarded;
  const pinned = pins?.length ? withPinHook(based, pins) : based;
  const mode = interaction === true ? "comment" : interaction;
  if (mode === "comment" || mode === "inspect") return withPickHook(pinned);
  if (mode === "edit") return withEditHook(pinned);
  return pinned;
}

const THUMB_OVERFLOW_CLIP = `<style data-locus-thumb-clip>
html, body {
  overflow: hidden !important;
  scrollbar-width: none !important;
}
* {
  scrollbar-width: none !important;
}
*::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
</style>`;

/** Hide native scrollbars in sidebar thumbs. The live Design canvas stays scrollable. */
export function withThumbOverflowClip(html: string): string {
  if (!html.trim() || html.includes("data-locus-thumb-clip")) return html;
  return (
    insertAfterOpenTag(html, /<head\b[^>]*>/i, THUMB_OVERFLOW_CLIP) ??
    insertAfterOpenTag(html, /<html\b[^>]*>/i, `<head>${THUMB_OVERFLOW_CLIP}</head>`) ??
    `${THUMB_OVERFLOW_CLIP}${html}`
  );
}

/** Tag a preview document so we can ignore the blank about:blank iframe load. */
export function stampCanvasSeq(html: string, seq: number): string {
  if (!html.trim()) return html;
  const stamped = `data-locus-preview-guard ${CANVAS_SEQ_ATTR}="${seq}"`;
  if (html.includes(`${CANVAS_SEQ_ATTR}=`)) {
    return html.replace(new RegExp(`${CANVAS_SEQ_ATTR}="\\d+"`), `${CANVAS_SEQ_ATTR}="${seq}"`);
  }
  if (html.includes("data-locus-preview-guard")) {
    return html.replace("data-locus-preview-guard", stamped);
  }
  return html;
}

export function canvasSeqFromDocument(doc: Document | null | undefined): number | undefined {
  const el = doc?.querySelector("[data-locus-preview-guard]");
  if (!el) return undefined;
  const raw = el.getAttribute(CANVAS_SEQ_ATTR);
  if (raw == null || raw === "") return undefined;
  const seq = Number(raw);
  return Number.isFinite(seq) ? seq : undefined;
}

/**
 * Live `canvas.updated` can be ahead of disk while a file_write streams.
 * After a landed write (apply_patch, finished file_write), prefer the polled file.
 */
export function pickCanvasHtml(
  live: string | undefined,
  polled: string | null | undefined,
  turning: boolean,
): string | null | undefined {
  if (!live) return polled;
  if (!polled) return live;
  if (live === polled) return live;
  if (turning && live.length > polled.length) return live;
  return polled;
}
