import { describe, expect, it } from "vitest";
import {
  PLAYWRIGHT_CHROME_MISSING,
  PLAYWRIGHT_EMPTY_CANVAS,
  PLAYWRIGHT_MISSING_URL,
  PLAYWRIGHT_BAD_URL,
  PLAYWRIGHT_TAINTED_CANVAS,
} from "@locus/shared";
import { runDesignPlaywright, type CanvasBrowser } from "./designPlaywright.js";

const HTML = `<!DOCTYPE html><html><head><title>Dock</title></head><body>
<button id="btn-deploy">Deploy</button>
<input id="name" />
<p id="hud">Ready</p>
</body></html>`;

function mockBrowser(opts?: {
  clicks?: string[];
  stats?: unknown;
  gameTime?: number | null;
  console?: string[];
}): CanvasBrowser {
  const clicks = opts?.clicks ?? [];
  let body = "Deploy Ready";
  return {
    async goto() {},
    async evaluate<T>(expression: string): Promise<T> {
      let value: unknown = true;
      if (expression.includes("document.readyState")) value = "complete";
      else if (expression.includes("document.title")) value = "Dock";
      else if (expression.includes("__locusGameSeed") || expression.includes("game.seed")) {
        value = { ok: true };
      } else if (expression.includes("__locusGame") && !expression.includes("__locusAsset")) {
        value = opts?.gameTime ?? null;
      } else if (expression.includes("__locusAsset")) value = opts?.stats ?? null;
      else if (expression.includes("innerText.includes")) value = body.includes("Ready");
      else if (expression.includes("el.click")) {
        clicks.push("click");
        value = { ok: true };
      } else if (expression.includes("el.value")) {
        body += " Alice";
        value = { ok: true };
      } else if (expression.includes("KeyboardEvent")) {
        value = { ok: true };
      } else if (expression.includes("Boolean(locusFind")) value = true;
      return value as T;
    },
    async screenshot() {
      return "abc123";
    },
    async console() {
      return opts?.console ?? [];
    },
    async title() {
      return "Dock";
    },
    async close() {},
  };
}

describe("runDesignPlaywright", () => {
  it("fails on an empty canvas", async () => {
    const result = await runDesignPlaywright({
      html: "  ",
      url: "http://127.0.0.1:7420/api/sessions/s1/canvas-files/",
      args: { expect_text: "Hi" },
    });
    expect(result.ok).toBe(false);
    expect(result.output).toBe(PLAYWRIGHT_EMPTY_CANVAS);
  });

  it("dispatches live key steps and uses the landscape viewport", async () => {
    const result = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { steps: ["press ArrowRight", "key Space"], viewport: "landscape" },
      browser: mockBrowser(),
    });
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/live/);
    expect(result.output).toMatch(/ok {2}press ArrowRight/);
    expect(result.output).toMatch(/ok {2}press Space/);
    expect(result.output).toMatch(/landscape/);
  });

  it("applies a seed step on the live page", async () => {
    const result = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { steps: ["seed 4", "press ArrowRight"] },
      browser: mockBrowser(),
    });
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/ok {2}seed 4/);
  });

  it("runs live click/fill/expect against a mock browser", async () => {
    const clicks: string[] = [];
    const result = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: {
        steps: ["click #btn-deploy", "fill #name Alice", "expect Ready"],
      },
      browser: mockBrowser({ clicks }),
    });
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/live/);
    expect(result.output).toMatch(/ok {2}click #btn-deploy/);
    expect(result.screenshotBase64).toBe("abc123");
    expect(result.output).toMatch(/screenshot captured/);
    expect(clicks).toEqual(["click"]);
  });

  it("skips the PNG when screenshot is false", async () => {
    const result = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { click: "#btn-deploy", screenshot: false },
      browser: mockBrowser(),
    });
    expect(result.ok).toBe(true);
    expect(result.screenshotBase64).toBeUndefined();
    expect(result.output).not.toMatch(/screenshot captured/);
  });

  it("falls back to markup when Chrome is missing", async () => {
    const result = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { click: "#btn-deploy", expect_text: "Deploy" },
    });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/static/);
    expect(result.output).toContain(PLAYWRIGHT_CHROME_MISSING);
    expect(result.output).toMatch(/fail {2}click #btn-deploy/);
    expect(result.output).toMatch(/ok {2}expect Deploy/);
  });

  it("passes expect-only static checks without a live browser", async () => {
    const result = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { expect_text: "Deploy" },
    });
    expect(result.output).toMatch(/static/);
    expect(result.output).toMatch(/ok {2}expect Deploy/);
    expect(result.screenshotBase64).toBeUndefined();
  });

  it("fails without a url when html is not required", async () => {
    const result = await runDesignPlaywright({
      html: "",
      url: "  ",
      args: { expect_text: "Hi" },
      requireHtml: false,
    });
    expect(result.ok).toBe(false);
    expect(result.output).toBe(PLAYWRIGHT_MISSING_URL);
  });

  it("runs live checks against a url without canvas html", async () => {
    const result = await runDesignPlaywright({
      html: "",
      url: "http://127.0.0.1:9/app",
      args: { expect_text: "Ready", click: "#btn-deploy" },
      requireHtml: false,
      browser: mockBrowser(),
    });
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/live/);
    expect(result.output).toMatch(/ok {2}expect Ready/);
    expect(result.output).toMatch(/ok {2}click #btn-deploy/);
    expect(result.screenshotBase64).toBe("abc123");
    expect(result.output).toMatch(/screenshot captured/);
  });

  it("rejects a non-http url", async () => {
    const result = await runDesignPlaywright({
      html: "",
      url: "file:///etc/passwd",
      args: { expect_text: "Hi" },
      requireHtml: false,
    });
    expect(result.ok).toBe(false);
    expect(result.output).toBe(PLAYWRIGHT_BAD_URL);
  });

  it("fails live checks when the page reports a tainted canvas", async () => {
    const browser = mockBrowser();
    browser.evaluate = async <T>(expression: string): Promise<T> => {
      if (expression.includes("document.readyState")) return "complete" as T;
      if (expression.includes("__locusAsset")) {
        return {
          stats: "stats error The canvas has been tainted by cross-origin data.",
          text: "getImageData on CanvasRenderingContext2D: The canvas has been tainted by cross-origin data.",
        } as T;
      }
      if (expression.includes("el.click") || expression.includes("Boolean(locusFind")) {
        return { ok: true } as T;
      }
      return true as T;
    };
    browser.console = async () => [
      "SecurityError: Failed to execute 'getImageData': The canvas has been tainted by cross-origin data.",
    ];
    const result = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { click: "#btn-deploy" },
      browser,
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain(PLAYWRIGHT_TAINTED_CANVAS);
    expect(result.output).toMatch(/tainted by cross-origin/);
    expect(result.output).toMatch(/stats error/);
  });

  it("fails Image-to-3D when asset stats are css-3d or verts is 0, and still returns the PNG", async () => {
    const empty = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { click: "#btnWire" },
      assetStats: true,
      browser: mockBrowser({
        stats: { mode: "3d", verts: 0, tris: 0 },
        console: ["THREE.WebGLRenderer: Context Lost"],
      }),
    });
    expect(empty.ok).toBe(false);
    expect(empty.screenshotBase64).toBe("abc123");
    expect(empty.output).toMatch(/stats mode=3d verts=0/);
    expect(empty.output).toMatch(/verts is 0/);
    expect(empty.output).toMatch(/THREE\.WebGLRenderer/);
    const css = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { click: "#btnWire" },
      assetStats: true,
      browser: mockBrowser({ stats: { mode: "css-3d", verts: 4 } }),
    });
    expect(css.ok).toBe(false);
    expect(css.output).toMatch(/mode is css-3d/);
    const mesh = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { click: "#btnWire" },
      assetStats: true,
      browser: mockBrowser({ stats: { mode: "3d", verts: 12, tris: 8 } }),
    });
    expect(mesh.ok).toBe(true);
    expect(mesh.output).toMatch(/stats mode=3d verts=12 tris=8/);
    const sprite = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { click: "#btnWire" },
      assetStats: true,
      browser: mockBrowser({ stats: { mode: "2d", verts: 0 } }),
    });
    expect(sprite.ok).toBe(true);
  });

  it("fails a Games drive playtest when stats.time never moves, and still returns the PNG", async () => {
    const stuck = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { steps: ["press ArrowRight", "press ArrowUp"] },
      gameDrive: true,
      driveWaitMs: 0,
      browser: mockBrowser({ gameTime: 0.1 }),
    });
    expect(stuck.ok).toBe(false);
    expect(stuck.screenshotBase64).toBe("abc123");
    expect(stuck.output).toMatch(/stats\.time>=2/);
    expect(stuck.output).toMatch(/time is 0\.1/);
    const driven = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { steps: ["press ArrowRight"] },
      gameDrive: true,
      driveWaitMs: 0,
      browser: mockBrowser({ gameTime: 3 }),
    });
    expect(driven.ok).toBe(true);
    expect(driven.output).not.toMatch(/stats\.time>=2/);
    const hud = await runDesignPlaywright({
      html: HTML,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { steps: ["click #bRestart", "expect road #"] },
      gameDrive: true,
      driveWaitMs: 0,
      browser: mockBrowser({ gameTime: 0.1 }),
    });
    expect(hud.output).not.toMatch(/stats\.time>=2/);
  });

  it("fails Image-to-3D when stats are missing on an unwired CSS-3D studio", async () => {
    const css3d = `<html><body><div style="transform-style:preserve-3d">css-3d mesh</div></body></html>`;
    const missing = await runDesignPlaywright({
      html: css3d,
      url: "http://127.0.0.1:9/api/sessions/s1/canvas-files/",
      args: { click: "#btnWire" },
      assetStats: true,
      browser: mockBrowser(),
    });
    expect(missing.ok).toBe(false);
    expect(missing.output).toMatch(/stats missing/);
    expect(missing.screenshotBase64).toBe("abc123");
  });
});
