import { lstat, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import type { Context } from "hono";
import {
  decorateCanvasHtml,
  isPreviewTargetHost,
  parsePreviewPort,
  sanitizePreviewPath,
  type CanvasFileDecorate,
  withPickHook,
} from "@locus/shared";
import { containedPath } from "@locus/guest-agent";

export type PreviewTarget =
  | { kind: "static"; root: string }
  | { kind: "http"; host: string; port: number }
  | { kind: "worker" };

const MAX_PREVIEW_ASSET_BYTES = 32 * 1024 * 1024;

export const PREVIEW_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".wasm": "application/wasm",
};

export function previewRequestPath(c: Context, port: string): string {
  const prefix = `/preview-http/${port}`;
  const raw = c.req.path;
  const idx = raw.indexOf(prefix);
  const rest = idx >= 0 ? raw.slice(idx + prefix.length) : "";
  return sanitizePreviewPath(rest || "/");
}

export function previewBaseHref(prefix: string): string {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

export function withBaseHref(html: string, prefix: string): string {
  const base = `<base href="${previewBaseHref(prefix)}">`;
  if (/<base\b/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (open) => `${open}${base}`);
  return `<head>${base}</head>${html}`;
}

function underRoot(root: string, relPath: string): string | undefined {
  const dest = resolve(root, relPath.replace(/^\/+/, ""));
  const rel = relative(resolve(root), dest);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) return undefined;
  return dest;
}

function asDecorate(decorate: boolean | CanvasFileDecorate | undefined): CanvasFileDecorate {
  if (decorate === true) return { pick: true };
  if (decorate && typeof decorate === "object") return decorate;
  return {};
}

function applyHtmlDecorate(
  html: string,
  proxyPrefix: string | undefined,
  decorate: CanvasFileDecorate,
): string {
  const body = proxyPrefix ? withBaseHref(html, proxyPrefix) : html;
  return decorateCanvasHtml(body, decorate);
}

export async function serveStaticPreview(
  root: string,
  urlPath: string,
  proxyPrefix?: string,
  pick: boolean | CanvasFileDecorate = false,
): Promise<Response> {
  const dest = underRoot(root, urlPath === "/" ? "index.html" : urlPath);
  if (!dest) return new Response("Not found", { status: 404 });
  try {
    let file = dest;
    const link = await lstat(file);
    if (link.isSymbolicLink()) return new Response("Not found", { status: 404 });
    let info = await stat(file);
    if (info.isDirectory()) {
      file = join(file, "index.html");
      const inner = await lstat(file);
      if (inner.isSymbolicLink()) return new Response("Not found", { status: 404 });
      info = await stat(file);
    }
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    if (info.size > MAX_PREVIEW_ASSET_BYTES) {
      return new Response("File is too large", { status: 413 });
    }
    const real = await containedPath(root, file);
    if (!real) return new Response("Not found", { status: 404 });
    const type = PREVIEW_MIME[extname(real).toLowerCase()] ?? "application/octet-stream";
    let body: string | Buffer = await readFile(real);
    const decorate = asDecorate(pick);
    if (type.startsWith("text/html")) {
      body = applyHtmlDecorate(body.toString("utf8"), proxyPrefix, decorate);
    }
    return new Response(body, {
      headers: {
        "content-type": type,
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
      },
    });
  } catch {
    if (urlPath === "/" || urlPath === "/index.html") {
      const html =
        "<!doctype html><html><body><p>No index.html in /workspace yet.</p></body></html>";
      const body = applyHtmlDecorate(html, proxyPrefix, asDecorate(pick));
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return new Response("Not found", { status: 404 });
  }
}

export function previewMime(path: string): string {
  const ext = extname((path === "/" ? "index.html" : path).toLowerCase());
  return PREVIEW_MIME[ext] ?? "application/octet-stream";
}

export function canvasAssetResponse(
  urlPath: string,
  bytes: Buffer | undefined,
  proxyPrefix: string,
  pick: boolean | CanvasFileDecorate = false,
): Response {
  const type = previewMime(urlPath);
  const decorate = asDecorate(pick);
  if (!bytes) {
    if (urlPath === "/" || urlPath === "/index.html") {
      const html =
        "<!doctype html><html><body><p>No index.html in /workspace yet.</p></body></html>";
      const body = applyHtmlDecorate(html, proxyPrefix, decorate);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return new Response("Not found", { status: 404 });
  }
  let body: string | Buffer = bytes;
  if (type.startsWith("text/html")) {
    body = applyHtmlDecorate(bytes.toString("utf8"), proxyPrefix, decorate);
  }
  return new Response(body, {
    headers: {
      "content-type": type,
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}

const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export function rewritePreviewLocation(
  raw: string,
  target: string,
  host: string,
  port: number,
  proxyPrefix?: string,
): string | undefined {
  try {
    const loc = new URL(raw, target);
    const locPort = loc.port ? Number(loc.port) : loc.protocol === "https:" ? 443 : 80;
    const sameHost =
      loc.hostname === host || (host === "127.0.0.1" && loc.hostname === "localhost");
    if (!sameHost || locPort !== port) return undefined;
    if (!proxyPrefix) return `${loc.pathname}${loc.search}`;
    return `${proxyPrefix.replace(/\/$/, "")}${loc.pathname}${loc.search}`;
  } catch {
    return undefined;
  }
}

export async function serveHttpPreview(opts: {
  host: string;
  port: number;
  path: string;
  search: string;
  method: string;
  headers: Headers;
  body?: ArrayBuffer | null;
  proxyPrefix?: string;
  pick?: boolean;
}): Promise<Response> {
  if (!isPreviewTargetHost(opts.host) || !parsePreviewPort(opts.port)) {
    return new Response("Preview target is not allowed", { status: 400 });
  }
  const target = `http://${opts.host}:${opts.port}${sanitizePreviewPath(opts.path)}${opts.search}`;
  const headers = new Headers();
  opts.headers.forEach((value, key) => {
    if (!HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("host", `${opts.host}:${opts.port}`);
  const init: RequestInit = { method: opts.method, headers, redirect: "manual" };
  if (opts.body && opts.method !== "GET" && opts.method !== "HEAD") init.body = opts.body;
  try {
    const upstream = await fetch(target, init);
    const out = new Headers();
    upstream.headers.forEach((value, key) => {
      const name = key.toLowerCase();
      if (HOP.has(name) || name === "content-encoding") return;
      if (name === "location") {
        const next = rewritePreviewLocation(value, target, opts.host, opts.port, opts.proxyPrefix);
        if (next) out.set(key, next);
        return;
      }
      out.set(key, value);
    });
    out.set("cache-control", "no-store");
    const type = (upstream.headers.get("content-type") ?? "").toLowerCase();
    if (type.includes("text/html") && (opts.proxyPrefix || opts.pick)) {
      let html = await upstream.text();
      if (opts.proxyPrefix) html = withBaseHref(html, opts.proxyPrefix);
      if (opts.pick) html = withPickHook(html);
      return new Response(html, { status: upstream.status, headers: out });
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (err) {
    const message = err instanceof Error ? err.message : "preview failed";
    return new Response(message, { status: 502 });
  }
}

export async function servePreview(
  c: Context,
  target: PreviewTarget,
  port: string,
): Promise<Response> {
  const path = previewRequestPath(c, port);
  const url = new URL(c.req.url);
  const pick = url.searchParams.get("locus_pick") === "1";
  url.searchParams.delete("locus_pick");
  const search = url.search;
  const id = c.req.param("id") ?? "";
  const proxyPrefix = `/api/sessions/${encodeURIComponent(id)}/preview-http/${port}`;
  if (target.kind === "static")
    return serveStaticPreview(target.root, path, proxyPrefix, { pick, guard: false });
  if (target.kind === "worker")
    return new Response("Worker preview is proxied by the control plane", { status: 400 });
  const body =
    c.req.method === "GET" || c.req.method === "HEAD"
      ? null
      : await c.req.arrayBuffer().catch(() => null);
  return serveHttpPreview({
    host: target.host,
    port: target.port,
    path,
    search,
    method: c.req.method,
    headers: c.req.raw.headers,
    body,
    proxyPrefix,
    pick,
  });
}
