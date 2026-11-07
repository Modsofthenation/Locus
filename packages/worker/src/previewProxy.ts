import { lstat, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { isPreviewTargetHost, parsePreviewPort, sanitizePreviewPath } from "@locus/shared";
import { containedPath } from "@locus/guest-agent";
import type { DockerEngine } from "@locus/hypervisor";

const MIME: Record<string, string> = {
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
  "authorization",
  "cookie",
]);

function underRoot(root: string, relPath: string): string | undefined {
  const dest = resolve(root, relPath.replace(/^\/+/, ""));
  const rel = relative(resolve(root), dest);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) return undefined;
  return dest;
}

async function serveStatic(root: string, urlPath: string): Promise<Response> {
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
    const real = await containedPath(root, file);
    if (!real) return new Response("Not found", { status: 404 });
    const type = MIME[extname(real).toLowerCase()] ?? "application/octet-stream";
    const body = await readFile(real);
    return new Response(body, {
      headers: {
        "content-type": type,
        "cache-control": "no-store",
      },
    });
  } catch {
    if (urlPath === "/" || urlPath === "/index.html") {
      return new Response(
        "<!doctype html><html><body><p>No index.html in /workspace yet.</p></body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        },
      );
    }
    return new Response("Not found", { status: 404 });
  }
}

function rewriteWorkerPreviewLocation(
  raw: string,
  target: string,
  host: string,
  port: number,
): string | undefined {
  try {
    const loc = new URL(raw, target);
    const locPort = loc.port ? Number(loc.port) : loc.protocol === "https:" ? 443 : 80;
    const sameHost =
      loc.hostname === host || (host === "127.0.0.1" && loc.hostname === "localhost");
    if (!sameHost || locPort !== port) return undefined;
    return `${loc.pathname}${loc.search}`;
  } catch {
    return undefined;
  }
}

export function workerPreviewPath(rawPath: string, port: string): string {
  const rest = rawPath.includes(`/preview/${port}`)
    ? rawPath.slice(rawPath.indexOf(`/preview/${port}`) + `/preview/${port}`.length)
    : "";
  return sanitizePreviewPath(rest || "/");
}

export async function serveWorkerPreview(opts: {
  engine: DockerEngine;
  id: string;
  port: number;
  path: string;
  search: string;
  method: string;
  headers: Headers;
  body?: ArrayBuffer | null;
}): Promise<Response> {
  const port = parsePreviewPort(opts.port);
  if (!port) return new Response("Invalid preview port", { status: 400 });
  const vm = opts.engine.get(opts.id);
  if (!vm) return new Response("Not found", { status: 404 });
  const host = opts.engine.inspectAddress ? await opts.engine.inspectAddress(opts.id) : undefined;
  if (host && isPreviewTargetHost(host)) {
    const target = `http://${host}:${port}${sanitizePreviewPath(opts.path)}${opts.search}`;
    const headers = new Headers();
    opts.headers.forEach((value, key) => {
      if (!HOP.has(key.toLowerCase())) headers.set(key, value);
    });
    headers.set("host", `${host}:${port}`);
    const init: RequestInit = { method: opts.method, headers, redirect: "manual" };
    if (opts.body && opts.method !== "GET" && opts.method !== "HEAD") init.body = opts.body;
    try {
      const upstream = await fetch(target, init);
      const out = new Headers();
      upstream.headers.forEach((value, key) => {
        const name = key.toLowerCase();
        if (HOP.has(name) || name === "content-encoding") return;
        if (name === "location") {
          const next = rewriteWorkerPreviewLocation(value, target, host, port);
          if (next) out.set(key, next);
          return;
        }
        out.set(key, value);
      });
      out.set("cache-control", "no-store");
      return new Response(upstream.body, { status: upstream.status, headers: out });
    } catch (err) {
      const message = err instanceof Error ? err.message : "preview failed";
      return new Response(message, { status: 502 });
    }
  }
  const root = vm.diskPath?.trim();
  if (!root) return new Response("No workspace on this worker guest", { status: 404 });
  return serveStatic(root, sanitizePreviewPath(opts.path));
}
