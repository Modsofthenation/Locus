import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  attachUi,
  desktopUiCacheDir,
  DEV_UI_PROXY_TIMEOUT_MS,
  resolveDevUiOrigins,
  resolveUiDir,
  safeFile,
  sameOriginUiTarget,
} from "./ui.js";
import { attachPhoneGate } from "./core/localguard.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("attachUi", () => {
  it("serves the desktop index without stealing API routes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-ui-"));
    dirs.push(dir);
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "index.html"), "<html>locus-ui</html>");
    await writeFile(join(dir, "assets", "app.js"), "console.log(1)");
    await writeFile(join(dir, "assets", "scene.jpg"), "jpeg-bytes");

    const app = new Hono();
    app.get("/api/health", (c) => c.json({ ok: true }));
    attachUi(app, dir, { devUiOrigin: "" });

    const health = await app.request("/api/health");
    expect(await health.json()).toEqual({ ok: true });

    const index = await app.request("/");
    expect(index.status).toBe(200);
    expect(index.headers.get("content-security-policy")).toMatch(/default-src 'self'/);
    expect(await index.text()).toContain("locus-ui");

    const asset = await app.request("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("console.log(1)");

    const jpeg = await app.request("/assets/scene.jpg");
    expect(jpeg.status).toBe(200);
    expect(jpeg.headers.get("content-type")).toBe("image/jpeg");
  });

  it("still serves the SPA when / is rewritten to a missing index.html path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-ui-"));
    dirs.push(dir);
    await writeFile(join(dir, "index.html"), "<html>spa</html>");
    const app = new Hono();
    attachUi(app, dir, { devUiOrigin: "" });
    const res = await app.request("/agents/new");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("spa");
  });

  it("pairs a LAN phone onto the UI instead of a Hono 404", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-ui-"));
    dirs.push(dir);
    await writeFile(join(dir, "index.html"), "<html>locus-phone</html>");
    const app = new Hono();
    app.use(
      "*",
      attachPhoneGate({
        remote: () => ({ enabled: true, token: "ph_secret" }),
        peer: () => "192.168.1.20",
      }),
    );
    attachUi(app, dir, { devUiOrigin: "" });

    const first = await app.request("http://192.168.1.8:7420/?token=ph_secret");
    expect(first.status).toBe(200);
    expect(first.headers.get("location")).toBeNull();
    expect(await first.text()).toContain("locus-phone");
    const cookie = first.headers.get("set-cookie");
    expect(cookie).toMatch(/locus_phone=/);
    expect(cookie).not.toMatch(/Secure/);
    expect(first.headers.get("referrer-policy")).toBe("no-referrer");

    const httpsPair = await app.request("https://192.168.1.8:7420/?token=ph_secret", undefined, {
      incoming: { socket: { remoteAddress: "192.168.1.20", encrypted: true } },
    });
    expect(httpsPair.headers.get("set-cookie")).toMatch(/Secure/);

    const shell = await app.request("http://192.168.1.8:7420/");
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("locus-phone");
  });

  it("serves LAN UI assets without a cookie but still gates /api", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-ui-"));
    dirs.push(dir);
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "index.html"), "<html>locus-phone</html>");
    await writeFile(join(dir, "assets", "app.js"), "console.log(1)");
    const app = new Hono();
    app.use(
      "*",
      attachPhoneGate({
        remote: () => ({ enabled: true, token: "ph_secret" }),
        peer: () => "192.168.1.20",
      }),
    );
    app.get("/api/health", (c) => c.json({ ok: true }));
    attachUi(app, dir, { devUiOrigin: "" });

    const asset = await app.request("http://192.168.1.8:7420/assets/app.js");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("console.log(1)");

    const denied = await app.request("http://192.168.1.8:7420/api/health");
    expect(denied.status).toBe(403);

    const authed = await app.request("http://192.168.1.8:7420/api/health", {
      headers: { authorization: "Bearer ph_secret" },
    });
    expect(authed.status).toBe(200);
    expect(await authed.json()).toEqual({ ok: true });
  });

  it("returns a page instead of a tiny 404 when the UI bundle is missing", async () => {
    const app = new Hono();
    attachUi(app, undefined, {
      devUiOrigin: "http://127.0.0.1:9",
      fetchFn: async () => {
        throw new Error("vite down");
      },
    });
    const res = await app.request("/");
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Locus UI is not on this port");
  });

  it("falls back to IPv6 localhost when Vite is not on 127.0.0.1", async () => {
    const tried: string[] = [];
    const app = new Hono();
    attachUi(app, undefined, {
      fetchFn: async (input) => {
        const url = String(input);
        tried.push(url);
        if (url.includes("127.0.0.1")) throw new Error("no ipv4");
        return new Response("<html>vite6</html>", { headers: { "content-type": "text/html" } });
      },
    });
    const index = await app.request("/");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("vite6");
    expect(tried.some((url) => url.includes("127.0.0.1"))).toBe(true);
    expect(tried.some((url) => url.includes("[::1]") || url.includes("localhost"))).toBe(true);
  });

  it("still proxies Vite when the first transform takes longer than 800ms", async () => {
    const app = new Hono();
    attachUi(app, undefined, {
      devUiOrigin: "http://127.0.0.1:5173",
      fetchFn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return new Response("/* css */", { headers: { "content-type": "text/css" } });
      },
    });
    const started = Date.now();
    const css = await app.request("http://192.168.0.155:7420/src/index.css?token=ph_secret");
    expect(Date.now() - started).toBeGreaterThanOrEqual(1200);
    expect(css.status).toBe(200);
    expect(await css.text()).toBe("/* css */");
    expect(DEV_UI_PROXY_TIMEOUT_MS).toBeGreaterThan(800);
  });

  it("follows a same-origin Vite redirect instead of 503", async () => {
    const fetched: string[] = [];
    const app = new Hono();
    attachUi(app, undefined, {
      devUiOrigin: "http://127.0.0.1:5173",
      fetchFn: async (input) => {
        const url = String(input);
        fetched.push(url);
        if (url === "http://127.0.0.1:5173/") {
          return new Response(null, { status: 302, headers: { location: "/index.html" } });
        }
        return new Response("<html>vite-index</html>", {
          headers: { "content-type": "text/html" },
        });
      },
    });
    const index = await app.request("http://192.168.0.155:7420/?token=ph_secret");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("vite-index");
    expect(fetched).toEqual(["http://127.0.0.1:5173/", "http://127.0.0.1:5173/index.html"]);
  });

  it("proxies the Vite UI when the desktop bundle is missing", async () => {
    const app = new Hono();
    attachUi(app, undefined, {
      devUiOrigin: "http://127.0.0.1:5173",
      fetchFn: async (input) => {
        const url = String(input);
        if (url.includes("/src/main.tsx")) {
          return new Response("tsx", { headers: { "content-type": "text/javascript" } });
        }
        return new Response("<html>vite-ui</html>", { headers: { "content-type": "text/html" } });
      },
    });
    const index = await app.request("/");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("vite-ui");
    const mod = await app.request("/src/main.tsx");
    expect(mod.status).toBe(200);
    expect(await mod.text()).toBe("tsx");
  });

  it("resolves LOCUS_UI when index.html exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-ui-"));
    dirs.push(dir);
    await writeFile(join(dir, "index.html"), "<html></html>");
    const prev = process.env.LOCUS_UI;
    process.env.LOCUS_UI = dir;
    try {
      expect(resolveUiDir()).toBe(resolve(dir));
    } finally {
      if (prev === undefined) delete process.env.LOCUS_UI;
      else process.env.LOCUS_UI = prev;
    }
  });

  it("serves a UI bundle that appears after the control plane starts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-ui-late-"));
    dirs.push(dir);
    const app = new Hono();
    attachUi(app, dir, { devUiOrigin: "" });
    const missing = await app.request("/");
    expect(missing.status).toBe(503);
    expect(await missing.text()).toContain("Locus UI is not on this port");
    await writeFile(join(dir, "index.html"), "<html>late-ui</html>");
    const found = await app.request("/");
    expect(found.status).toBe(200);
    expect(await found.text()).toContain("late-ui");
  });

  it("re-resolves when the first UI directory disappears", async () => {
    const a = await mkdtemp(join(tmpdir(), "locus-ui-a-"));
    const b = await mkdtemp(join(tmpdir(), "locus-ui-b-"));
    dirs.push(a, b);
    await writeFile(join(a, "index.html"), "<html>first</html>");
    await writeFile(join(b, "index.html"), "<html>second</html>");
    const prev = process.env.LOCUS_UI;
    process.env.LOCUS_UI = a;
    try {
      const app = new Hono();
      attachUi(app, undefined, { devUiOrigin: "" });
      expect(await (await app.request("/")).text()).toContain("first");
      await rm(a, { recursive: true, force: true });
      process.env.LOCUS_UI = b;
      const res = await app.request("/");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("second");
    } finally {
      if (prev === undefined) delete process.env.LOCUS_UI;
      else process.env.LOCUS_UI = prev;
    }
  });

  it("falls back to the host UI cache when the AppImage mount is gone", async () => {
    const home = await mkdtemp(join(tmpdir(), "locus-home-"));
    dirs.push(home);
    const fakeServer = join(home, "server");
    const cache = join(home, "desktop-ui");
    await mkdir(fakeServer);
    await mkdir(cache);
    await writeFile(join(cache, "index.html"), "<html>cached</html>");
    const prevHome = process.env.LOCUS_HOME;
    const prevUi = process.env.LOCUS_UI;
    const prevApp = process.env.APPDIR;
    const prevCwd = process.cwd();
    process.env.LOCUS_HOME = home;
    delete process.env.LOCUS_UI;
    delete process.env.APPDIR;
    process.chdir(home);
    try {
      expect(desktopUiCacheDir()).toBe(resolve(cache));
      expect(resolveUiDir(pathToFileURL(join(fakeServer, "index.mjs")).href)).toBe(resolve(cache));
    } finally {
      process.chdir(prevCwd);
      if (prevHome === undefined) delete process.env.LOCUS_HOME;
      else process.env.LOCUS_HOME = prevHome;
      if (prevUi === undefined) delete process.env.LOCUS_UI;
      else process.env.LOCUS_UI = prevUi;
      if (prevApp === undefined) delete process.env.APPDIR;
      else process.env.APPDIR = prevApp;
    }
  });

  it("does not proxy Vite from a packaged Electron control plane", async () => {
    const prev = process.env.ELECTRON_RUN_AS_NODE;
    process.env.ELECTRON_RUN_AS_NODE = "1";
    try {
      expect(resolveDevUiOrigins()).toEqual([]);
      const fetched: string[] = [];
      const app = new Hono();
      attachUi(app, undefined, {
        fetchFn: async (input) => {
          fetched.push(String(input));
          return new Response("vite");
        },
      });
      await app.request("/");
      expect(fetched).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
      else process.env.ELECTRON_RUN_AS_NODE = prev;
    }
  });

  it("rejects path traversal", () => {
    expect(safeFile("/tmp/ui", "/../../etc/passwd")).toBeNull();
  });

  it("pins the Vite proxy to the configured origin", () => {
    const origin = "http://127.0.0.1:5173";
    expect(sameOriginUiTarget("/", origin, "http://127.0.0.1:7420/?token=ph_secret")?.href).toBe(
      "http://127.0.0.1:5173/",
    );
    expect(
      sameOriginUiTarget("//127.0.0.1:9/secret", origin, "http://127.0.0.1:7420/"),
    ).toBeUndefined();
    expect(sameOriginUiTarget("/@fs/etc/passwd", origin, "http://127.0.0.1:7420/")).toBeUndefined();
    expect(sameOriginUiTarget("/src/main.tsx", origin, "http://127.0.0.1:7420/")?.href).toBe(
      "http://127.0.0.1:5173/src/main.tsx",
    );
  });

  it("does not fetch off-origin URLs or Vite /@fs through the proxy", async () => {
    const fetched: string[] = [];
    const app = new Hono();
    attachUi(app, undefined, {
      devUiOrigin: "http://127.0.0.1:5173",
      fetchFn: async (input) => {
        fetched.push(String(input));
        return new Response("secret");
      },
    });
    const offOrigin = await app.request("http://127.0.0.1:7420//127.0.0.1:9/secret");
    expect(fetched.some((url) => url.includes("127.0.0.1:9"))).toBe(false);
    expect(offOrigin.status).toBe(503);
    fetched.length = 0;
    const fsPath = await app.request("http://127.0.0.1:7420/@fs/etc/passwd");
    expect(fetched).toEqual([]);
    expect(fsPath.status).toBe(503);
  });

  it("does not follow an off-origin Location from Vite", async () => {
    const fetched: string[] = [];
    const app = new Hono();
    attachUi(app, undefined, {
      devUiOrigin: "http://127.0.0.1:5173",
      fetchFn: async (input) => {
        fetched.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "http://evil.example/phish" },
        });
      },
    });
    const res = await app.request("http://192.168.0.155:7420/");
    expect(fetched).toEqual(["http://127.0.0.1:5173/"]);
    expect(res.status).toBe(503);
  });

  it("does not redirect pairing onto a protocol-relative Location", async () => {
    const app = new Hono();
    app.use(
      "*",
      attachPhoneGate({
        remote: () => ({ enabled: true, token: "ph_secret" }),
        peer: () => "192.168.1.20",
      }),
    );
    attachUi(app, undefined, { devUiOrigin: "" });
    const res = await app.request("http://192.168.1.8:7420//evil.example/phish?token=ph_secret");
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).not.toBe(302);
  });
});
