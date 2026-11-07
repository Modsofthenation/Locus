const ATTR_REF_RE = /\b(?:src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SRCSET_RE = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_URL_RE = /url\(\s*(['"]?)([^"')]+)\1\s*\)/gi;

/** Relative files a canvas HTML document loads (images, CSS, fonts, scripts). */
export function canvasRelativeAssetRefs(html: string): string[] {
  const found = new Set<string>();
  const consider = (raw: string | undefined) => {
    const rel = normalizeCanvasAssetRel(raw);
    if (rel) found.add(rel);
  };
  let match: RegExpExecArray | null;
  ATTR_REF_RE.lastIndex = 0;
  while ((match = ATTR_REF_RE.exec(html))) {
    consider(match[1] ?? match[2] ?? match[3]);
  }
  SRCSET_RE.lastIndex = 0;
  while ((match = SRCSET_RE.exec(html))) {
    const value = match[1] ?? match[2] ?? "";
    for (const part of value.split(",")) {
      consider(part.trim().split(/\s+/)[0]);
    }
  }
  CSS_URL_RE.lastIndex = 0;
  while ((match = CSS_URL_RE.exec(html))) {
    consider(match[2]);
  }
  return [...found];
}

export function canvasRelativeCssUrls(css: string): string[] {
  const found = new Set<string>();
  CSS_URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSS_URL_RE.exec(css))) {
    const rel = normalizeCanvasAssetRel(match[2]);
    if (rel) found.add(rel);
  }
  return [...found];
}

export function normalizeCanvasAssetRel(raw?: string): string | undefined {
  const value = raw?.trim() ?? "";
  if (!value) return undefined;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return undefined;
  const clean = value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .split("?")[0]
    ?.split("#")[0]
    ?.replace(/^\/+/, "");
  if (!clean) return undefined;
  const parts = clean.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.includes("..")) return undefined;
  const rel = parts.join("/");
  if (rel === "index.html" || rel === "index.htm") return undefined;
  return rel;
}
