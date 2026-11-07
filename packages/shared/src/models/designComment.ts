export const DESIGN_VIEWPORTS = ["desktop", "tablet", "phone"] as const;
export type DesignViewport = (typeof DESIGN_VIEWPORTS)[number];

export function isDesignViewport(value: unknown): value is DesignViewport {
  return DESIGN_VIEWPORTS.includes(value as DesignViewport);
}

export interface DesignComment {
  id?: string;
  selector: string;
  text?: string;
  viewport: DesignViewport;
}

export function pickSelector(pick: { tag: string; id?: string; className?: string }): string {
  const tag = pick.tag.trim().toLowerCase();
  const id = pick.id?.trim();
  const cls = (pick.className ?? "").trim().split(/\s+/).filter(Boolean)[0];
  return [tag, id ? `#${id}` : "", cls ? `.${cls}` : ""].join("");
}

export function parseDesignComment(raw: unknown): DesignComment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const selector = typeof value.selector === "string" ? value.selector.trim().slice(0, 200) : "";
  if (!selector) return undefined;
  if (!isDesignViewport(value.viewport)) return undefined;
  const text = typeof value.text === "string" ? value.text.trim().slice(0, 80) : "";
  const id = typeof value.id === "string" ? value.id.trim().slice(0, 64) : "";
  return {
    id: id || undefined,
    selector,
    text: text || undefined,
    viewport: value.viewport,
  };
}

export type CommentSurface = "canvas" | "preview";

export function formatDesignComment(
  comment: DesignComment,
  surface: CommentSurface = "canvas",
): string {
  return [
    surface === "preview"
      ? "Preview comment on the live app. Apply the operator's next instruction to this element."
      : "Design comment on the canvas. Apply the operator's next instruction to this element.",
    comment.id ? `pin: ${comment.id}` : undefined,
    `selector: ${comment.selector}`,
    comment.text ? `text: ${comment.text}` : undefined,
    `viewport: ${comment.viewport}`,
    "Keep this CSS selector valid across file rewrites so the pin can stick.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseSimpleSelector(
  selector: string,
): { tag: string; id?: string; className?: string } | undefined {
  const match = selector
    .trim()
    .match(/^([a-z][\w-]*)?(?:#([a-zA-Z][\w-]*))?(?:\.([a-zA-Z][\w-]*))?$/i);
  if (!match?.[1] && !match?.[2] && !match?.[3]) return undefined;
  return {
    tag: (match[1] ?? "").toLowerCase(),
    id: match[2] || undefined,
    className: match[3] || undefined,
  };
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const EDITABLE_CANVAS_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "a",
  "button",
  "label",
  "li",
  "td",
  "th",
  "figcaption",
  "dt",
  "dd",
  "strong",
  "em",
  "small",
  "legend",
]);

/** Replace the inner HTML of the first text-ish element matching a simple selector. */
export function replaceElementText(
  html: string,
  selector: string,
  text: string,
): string | undefined {
  const parsed = parseSimpleSelector(selector);
  if (!parsed) return undefined;
  if (parsed.tag && !EDITABLE_CANVAS_TAGS.has(parsed.tag)) return undefined;
  const tag = parsed.tag || `(?:${[...EDITABLE_CANVAS_TAGS].join("|")})`;
  const open = new RegExp(`<(${tag})(\\b[^>]*)>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = open.exec(html))) {
    const attrs = match[2] ?? "";
    if (parsed.id && htmlAttr(attrs, "id") !== parsed.id) continue;
    if (parsed.className && !classAttrHas(attrs, parsed.className)) continue;
    const tagName = match[1]!;
    const start = match.index + match[0].length;
    const close = new RegExp(`</${tagName}\\s*>`, "i");
    const rest = html.slice(start);
    const end = rest.search(close);
    if (end < 0) continue;
    const inner = rest.slice(0, end);
    if (/<[a-z][\s\S]*?>/i.test(inner)) return undefined;
    const escaped = escapeHtmlText(text).replace(/\n/g, "<br>");
    return `${html.slice(0, start)}${escaped}${html.slice(start + end)}`;
  }
  return undefined;
}

function htmlAttr(attrs: string, name: string): string | undefined {
  const quoted = attrs.match(
    new RegExp(`(?:^|\\s)${escapeRe(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
  );
  if (quoted) return quoted[2];
  const unquoted = attrs.match(
    new RegExp(`(?:^|\\s)${escapeRe(name)}\\s*=\\s*([^\\s"'=<>]+)`, "i"),
  );
  return unquoted?.[1];
}

function classAttrHas(attrs: string, className: string): boolean {
  const value = htmlAttr(attrs, "class");
  if (value == null) return false;
  return value.split(/\s+/).includes(className);
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
