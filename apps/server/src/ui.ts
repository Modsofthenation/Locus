import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context, Hono } from "hono";
import { CONTROL_PLANE_CSP } from "@locus/shared";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".map": "application/json",
};

const DEFAULT_DEV_UI_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://[::1]:5173",
  "http://localhost:5173",
];

/** Vite's first transform of the desktop bundle (index.css is ~200KB) exceeds 800ms. */
export const DEV_UI_PROXY_TIMEOUT_MS = 30_000;
const DEV_UI_MAX_REDIRECTS = 3;

export type AttachUiOptions = {
  /** Vite (or other) origin used when the built desktop bundle is missing. Empty skips proxying. */
  devUiOrigin?: string;
  fetchFn?: typeof fetch;
};

export function desktopUiCacheDir(home?: string): string {
  const root = home?.trim() || process.env.LOCUS_HOME?.trim() || join(homedir(), ".locus");
  return join(root, "desktop-ui");
}

function hasUiIndex(dir: string): boolean {
  return existsSync(resolve(dir, "index.html"));
}

export function resolveUiDir(from = import.meta.url): string | undefined {
  const here = fileURLToPath(new URL(".", from));
  const appDir = process.env.APPDIR?.trim();
  const candidates = [
    process.env.LOCUS_UI,
    appDir && join(appDir, "resources", "ui"),
    resolve(here, "../ui"),
    resolve(process.cwd(), "ui"),
    resolve(here, "../../desktop/dist"),
    resolve(here, "../../dist"),
    resolve(process.cwd(), "apps/desktop/dist"),
    desktopUiCacheDir(),
  ];
  for (const dir of candidates) {
    if (!dir?.trim()) continue;
    const root = resolve(dir);
    if (hasUiIndex(root)) return root;
  }
  return undefined;
}

export function attachUi(app: Hono, distDir?: string, opts: AttachUiOptions = {}): void {
  const pinned = distDir?.trim() ? resolve(distDir) : undefined;
  let root = pinned && hasUiIndex(pinned) ? pinned : undefined;
  const origins = resolveDevUiOrigins(opts.devUiOrigin);
  const fetchFn = opts.fetchFn ?? fetch;
  let cachedOrigin: string | undefined;

  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api")) return next();
    if (pinned && hasUiIndex(pinned)) {
      const served = await serveStaticUi(c, pinned);
      if (served) return served;
    }
    if (!root || !hasUiIndex(root)) root = resolveUiDir() ?? root;
    if (root) {
      let served = await serveStaticUi(c, root);
      if (!served) {
        const fresh = resolveUiDir();
        if (fresh && fresh !== root) {
          root = fresh;
          served = await serveStaticUi(c, root);
        }
      }
      if (served) return served;
    }
    const tryOrigins = cachedOrigin
      ? [cachedOrigin, ...origins.filter((origin) => origin !== cachedOrigin)]
      : origins;
    for (const origin of tryOrigins) {
      const proxied = await proxyDevUi(c, origin, fetchFn);
      if (proxied) {
        cachedOrigin = origin;
        return proxied;
      }
    }
    return c.html(missingUiHtml(), 503, { "content-security-policy": CONTROL_PLANE_CSP });
  });
}

export function resolveDevUiOrigins(preferred?: string): string[] {
  if (preferred === "") return [];
  if (preferred?.trim()) return [preferred.trim()];
  // Packaged Electron runs the control plane as Node. Vite is not in that bundle,
  // and probing :5173 can block the UI request for tens of seconds.
  if (process.env.ELECTRON_RUN_AS_NODE) return [];
  const env = process.env.LOCUS_UI_URL?.trim();
  return [...new Set([env, ...DEFAULT_DEV_UI_ORIGINS].filter((v): v is string => Boolean(v)))];
}

export function safeFile(distDir: string, urlPath: string): string | null {
  const relativePath = urlPath.replace(/^\/+/, "");
  if (!relativePath || relativePath.includes("\0")) return null;
  const file = resolve(distDir, relativePath);
  const rel = relative(distDir, file);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) return null;
  return file;
}

export function missingUiHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Locus</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        font-family: ui-sans-serif, system-ui, sans-serif;
        background: #0b0d10;
        color: #e8eaed;
      }
      main { max-width: 28rem; padding: 24px; }
      h1 { font-size: 1.25rem; margin: 0 0 8px; }
      p { color: #9aa3af; line-height: 1.45; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>Locus UI is not on this port</h1>
      <p>
        The control plane is running, but the desktop UI is missing. Phone pairing needs the desktop
        bundle or Vite on port 5173 — <code>locus serve</code> alone is not enough. Run
        <code>npm run dev</code>, <code>npm run app</code>, or the packaged Locus app, then retry this URL.
      </p>
    </main>
  </body>
</html>`;
}

async function serveStaticUi(c: Context, root: string): Promise<Response | undefined> {
  const reqPath = c.req.path;
  const urlPath = reqPath === "/" ? "/index.html" : reqPath;
  const file = safeFile(root, urlPath);
  if (file) {
    try {
      const body = await readFile(file);
      const type = TYPES[extname(file)] ?? "application/octet-stream";
      return c.body(body, 200, {
        "content-type": type,
        "content-security-policy": CONTROL_PLANE_CSP,
      });
    } catch {
      /* fall through to SPA */
    }
  }
  if (extname(reqPath)) return c.text("Not found", 404);
  try {
    return c.html(await readFile(resolve(root, "index.html"), "utf8"), 200, {
      "content-security-policy": CONTROL_PLANE_CSP,
    });
  } catch {
    return undefined;
  }
}

async function proxyDevUi(
  c: Context,
  origin: string,
  fetchFn: typeof fetch,
): Promise<Response | undefined> {
  const target = sameOriginUiTarget(c.req.path, origin, c.req.url);
  if (!target) return undefined;
  try {
    const res = await fetchDevUi(target, c, fetchFn);
    if (!res) return undefined;
    const type = res.headers.get("content-type") ?? "application/octet-stream";
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": type, "content-security-policy": CONTROL_PLANE_CSP },
    });
  } catch {
    return undefined;
  }
}

async function fetchDevUi(
  start: URL,
  c: Context,
  fetchFn: typeof fetch,
): Promise<Response | undefined> {
  let target = start;
  const signal = AbortSignal.timeout(DEV_UI_PROXY_TIMEOUT_MS);
  for (let hop = 0; hop <= DEV_UI_MAX_REDIRECTS; hop++) {
    const headers = new Headers();
    const accept = c.req.header("accept");
    if (accept) headers.set("accept", accept);
    headers.set("host", target.host);
    const res = await fetchFn(target.href, {
      headers,
      redirect: "manual",
      signal,
    });
    if (res.status < 300 || res.status >= 400) return res;
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    const location = res.headers.get("location");
    if (!location) return undefined;
    let next: URL;
    try {
      next = new URL(location, target);
    } catch {
      return undefined;
    }
    if (next.origin !== target.origin) return undefined;
    target = next;
  }
  return undefined;
}

export function sameOriginUiTarget(
  path: string,
  origin: string,
  requestUrl: string,
): URL | undefined {
  if (!path.startsWith("/") || path.startsWith("//")) return undefined;
  if (path === "/@fs" || path.startsWith("/@fs/")) return undefined;
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return undefined;
  }
  let target: URL;
  try {
    target = new URL(path, base);
    const incoming = new URL(requestUrl);
    target.search = incoming.search;
    target.searchParams.delete("token");
  } catch {
    return undefined;
  }
  if (target.origin !== base.origin) return undefined;
  return target;
}
