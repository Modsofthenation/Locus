import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  rewritePreviewLocation,
  serveHttpPreview,
  serveStaticPreview,
  withBaseHref,
} from "./preview.js";

let cleanup: string[] = [];
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    cleanup.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)),
  );
  cleanup = [];
});

describe("preview proxy", () => {
  it("serves workspace files and blocks path escape", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-preview-"));
    cleanup.push(dir);
    await writeFile(join(dir, "index.html"), "<html><head></head><body><h1>app</h1></body></html>");
    await mkdir(join(dir, "fonts"), { recursive: true });
    await writeFile(join(dir, "fonts", "Inter.ttf"), Buffer.alloc(40, 7));
    const page = await serveStaticPreview(dir, "/", "/api/sessions/s1/preview-http/8080");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<h1>app</h1>");
    expect(html).toContain('<base href="/api/sessions/s1/preview-http/8080/">');
    const coding = await serveStaticPreview(dir, "/", "/api/sessions/s1/preview-http/8080", {
      guard: false,
    });
    expect(await coding.text()).not.toContain("data-locus-preview-guard");
    const canvas = await serveStaticPreview(dir, "/", "/api/sessions/s1/canvas-files/", {
      seq: 7,
      guard: true,
    });
    const canvasHtml = await canvas.text();
    expect(canvasHtml).toContain("data-locus-preview-guard");
    expect(canvasHtml).toContain('data-locus-canvas-seq="7"');
    expect(canvas.headers.get("access-control-allow-origin")).toBe("*");
    expect(canvas.headers.get("content-security-policy")).toBeNull();
    const picked = await serveStaticPreview(dir, "/", "/api/sessions/s1/preview-http/8080", true);
    expect(await picked.text()).toContain("data-locus-pick-hook");
    const font = await serveStaticPreview(dir, "/fonts/Inter.ttf");
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/ttf");
    expect(font.headers.get("access-control-allow-origin")).toBe("*");
    expect(font.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    const escaped = await serveStaticPreview(dir, "/../secret");
    expect(escaped.status).toBe(404);
  });

  it.skipIf(process.platform === "win32")(
    "does not follow workspace symlinks outside the root",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-preview-link-"));
      cleanup.push(dir);
      await symlink("/etc/passwd", join(dir, "secret.html"));
      const leaked = await serveStaticPreview(dir, "/secret.html");
      expect(leaked.status).toBe(404);
    },
  );

  it("rewrites same-port Location under the proxy prefix and drops other ports", () => {
    const prefix = "/api/sessions/s1/preview-http/3000";
    const target = "http://172.17.0.2:3000/";
    expect(rewritePreviewLocation("/login", target, "172.17.0.2", 3000, prefix)).toBe(
      "/api/sessions/s1/preview-http/3000/login",
    );
    expect(
      rewritePreviewLocation("http://172.17.0.2:7420/api", target, "172.17.0.2", 3000, prefix),
    ).toBeUndefined();
    expect(
      rewritePreviewLocation("http://8.8.8.8/", target, "172.17.0.2", 3000, prefix),
    ).toBeUndefined();
    expect(withBaseHref("<html><head></head></html>", prefix)).toContain(
      '<base href="/api/sessions/s1/preview-http/3000/">',
    );
  });

  it("proxies loopback HTTP and rejects public hops", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("from-app");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    try {
      const ok = await serveHttpPreview({
        host: "127.0.0.1",
        port: addr.port,
        path: "/",
        search: "",
        method: "GET",
        headers: new Headers(),
      });
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe("from-app");
      const htmlServer = createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body><h1>app</h1></body></html>");
      });
      await new Promise<void>((resolve) => htmlServer.listen(0, "127.0.0.1", resolve));
      const htmlAddr = htmlServer.address();
      if (!htmlAddr || typeof htmlAddr === "string") throw new Error("no port");
      try {
        const picked = await serveHttpPreview({
          host: "127.0.0.1",
          port: htmlAddr.port,
          path: "/",
          search: "",
          method: "GET",
          headers: new Headers(),
          pick: true,
        });
        expect(await picked.text()).toContain("data-locus-pick-hook");
      } finally {
        await new Promise<void>((resolve) => htmlServer.close(() => resolve()));
      }
      const denied = await serveHttpPreview({
        host: "8.8.8.8",
        port: 80,
        path: "/",
        search: "",
        method: "GET",
        headers: new Headers(),
      });
      expect(denied.status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
