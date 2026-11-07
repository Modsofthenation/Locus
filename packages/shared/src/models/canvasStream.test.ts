import { describe, expect, it } from "vitest";
import { DESIGN_CANVAS_PATH } from "./recipes.js";
import {
  fillCanvasFileWritePath,
  htmlFromStreamingToolArgs,
  htmlDocumentFromText,
  isDesignCanvasPath,
  looksLikeHtml,
  recoverFileWriteArgs,
  stripHtmlDocumentFromChat,
  canvasHtmlFromToolCall,
  looksLikeHtmlDocumentDraft,
  fallbackDesignCanvasHtml,
  fallbackGameCanvasHtml,
  fallbackAssetCanvasHtml,
  isMisplacedDesignCanvasRel,
  shouldReplaceCanvasHtml,
  isCompleteHtmlDocument,
  canvasHtmlIncomplete,
  looksHostFallbackCanvas,
  canvasNeedsHttp,
  canvasShouldServeHttp,
  canvasLoadsRelativeRaster,
  canvasReadsPixels,
  canvasFilesPreviewUrl,
} from "./canvasStream.js";
import { looksWiredAsset } from "./assetCanvas.js";

describe("recoverFileWriteArgs", () => {
  it("recovers truncated JSON for any path", () => {
    expect(recoverFileWriteArgs(`{"path":"/workspace/app.js","content":"console.log(1)`)).toEqual({
      path: "/workspace/app.js",
      content: "console.log(1)",
    });
  });

  it("recovers Cursor CLI fileText onto the canvas path", () => {
    expect(
      recoverFileWriteArgs(
        JSON.stringify({ path: "/workspace/index.html", fileText: "<html><body>Hi</body></html>" }),
      ),
    ).toEqual({ path: "/workspace/index.html", content: "<html><body>Hi</body></html>" });
    expect(
      htmlFromStreamingToolArgs(
        "file_write",
        JSON.stringify({ path: "index.html", fileText: "<html><body>Hi</body></html>" }),
      ),
    ).toBe("<html><body>Hi</body></html>");
    expect(
      htmlFromStreamingToolArgs(
        "apply_patch",
        JSON.stringify({
          path: "/workspace/index.html",
          streamContent: "<!doctype html><html><body>Edit</body></html>",
        }),
      ),
    ).toContain("Edit");
    expect(
      canvasHtmlFromToolCall({
        name: "file_write",
        arguments: { path: "/workspace/index.html", fileText: "<html><body>Hi</body></html>" },
      }),
    ).toBe("<html><body>Hi</body></html>");
    expect(
      canvasHtmlFromToolCall({
        name: "file_write",
        arguments: { path: "/workspace/about.html", fileText: "<html><body>Hi</body></html>" },
      }),
    ).toBeUndefined();
  });
});

describe("fallbackDesignCanvasHtml", () => {
  it("builds a palette-stamped fallback canvas from the brief", async () => {
    const { DEFAULT_DESIGN_PALETTE } = await import("./designPalette.js");
    const html = fallbackDesignCanvasHtml("Chihuahua walking <site>", DEFAULT_DESIGN_PALETTE);
    expect(html).toContain("First draft");
    expect(html).toContain("Chihuahua walking &lt;site&gt;");
    expect(html).toContain(DEFAULT_DESIGN_PALETTE.primary);
    expect(html).toContain("data-locus-palette");
    expect(html).toContain('data-locus-host-fallback="design"');
    expect(looksHostFallbackCanvas(html)).toBe(true);
    const unstamped = html.replace(/\s*data-locus-host-fallback="design"/, "");
    expect(looksHostFallbackCanvas(unstamped)).toBe(true);
    expect(looksHostFallbackCanvas(unstamped.replace("14%", "15%"))).toBe(true);
    expect(looksHostFallbackCanvas(unstamped.replace("kicker", "eyebrow"))).toBe(true);
    expect(looksHostFallbackCanvas(unstamped.replace("#next", "#continue"))).toBe(true);
    expect(
      looksHostFallbackCanvas(unstamped.replace("14%", "15%").replace(/First draft/g, "Draft")),
    ).toBe(true);
    expect(looksHostFallbackCanvas("<!doctype html><html><body>ok</body></html>")).toBe(false);
    expect(
      looksHostFallbackCanvas(
        `<!doctype html><html><body><p class="kicker">Dispatch</p><a class="cta" href="#next">Continue</a></body></html>`,
      ),
    ).toBe(false);
  });
});

describe("fallbackGameCanvasHtml", () => {
  it("builds a playable fallback loop from the brief", async () => {
    const { DEFAULT_DESIGN_PALETTE } = await import("./designPalette.js");
    const { looksPlayableGame } = await import("./gameCanvas.js");
    const html = fallbackGameCanvasHtml("Dodge rocks with arrows.", DEFAULT_DESIGN_PALETTE);
    expect(html).toContain("Score");
    expect(html).toContain("__locusGame");
    expect(html).toContain("KeyR");
    expect(looksPlayableGame(html)).toBe(true);
    expect(html).toContain('data-locus-host-fallback="game"');
    expect(looksHostFallbackCanvas(html)).toBe(true);
    const unstamped = html.replace(/\s*data-locus-host-fallback="game"/, "");
    expect(looksHostFallbackCanvas(unstamped)).toBe(true);
    expect(looksHostFallbackCanvas(unstamped.replace("x: 420", "x: 421"))).toBe(true);
    expect(
      looksHostFallbackCanvas(unstamped.replace("x-12, y-24, 24, 24", "x-10, y-20, 20, 20")),
    ).toBe(true);
    const twoToken = unstamped
      .replace("x: 420", "x: 421")
      .replace("x-12, y-24, 24, 24", "x-10, y-20, 20, 20");
    expect(looksHostFallbackCanvas(twoToken)).toBe(true);
    expect(
      looksHostFallbackCanvas(
        twoToken.replace(
          "const keys = {};",
          "const keys = {}; function beep(){ new AudioContext(); }",
        ),
      ),
    ).toBe(true);
  });
});

describe("fallbackAssetCanvasHtml", () => {
  it("builds a posed studio fallback from the brief", async () => {
    const { DEFAULT_DESIGN_PALETTE } = await import("./designPalette.js");
    const html = fallbackAssetCanvasHtml("Hero from a photo.", DEFAULT_DESIGN_PALETTE);
    expect(html).toContain("Studio");
    expect(html).toContain("__locusAsset");
    expect(html).toContain("--head");
    expect(html).toContain("Hero from a photo.");
    expect(html).toContain("--zoom");
    expect(html).toMatch(/zoom\(z\)/);
    expect(html).toContain("data-locus-asset-model");
    expect(html).toMatch(/pickup/);
    expect(html).toMatch(/attack-heavy/);
    expect(html).toMatch(/PRESETS/);
    expect(html).toContain("<canvas");
    expect(html).toContain("./source.png");
    expect(html).toContain("./vendor/reconstruct.js");
    expect(html).toMatch(/mode: "3d"/);
    expect(html).not.toMatch(/transform-style: preserve-3d/);
    expect(html).not.toMatch(/document\.documentElement\.style\.zoom/);
    expect(looksWiredAsset(html)).toBe(true);
    expect(html).toContain('data-locus-host-fallback="asset"');
    expect(looksHostFallbackCanvas(html)).toBe(true);
    const unstamped = html.replace(/\s*data-locus-host-fallback="asset"/, "");
    expect(looksHostFallbackCanvas(unstamped)).toBe(true);
    expect(looksHostFallbackCanvas(unstamped.replace("drawPlaceholder", "drawMesh"))).toBe(true);
    expect(looksHostFallbackCanvas(unstamped.replace("72, 118", "70, 110"))).toBe(true);
    expect(
      looksHostFallbackCanvas(
        unstamped.replace("drawPlaceholder", "drawMesh").replace("72, 118", "70, 110"),
      ),
    ).toBe(true);
    expect(
      looksHostFallbackCanvas(
        unstamped
          .replace("drawPlaceholder", "drawMesh")
          .replace("72, 118", "70, 110")
          .replace("0.012", "0.02"),
      ),
    ).toBe(true);
  });
});

describe("htmlFromStreamingToolArgs", () => {
  it("reads a complete file_write to the canvas", () => {
    const html = htmlFromStreamingToolArgs(
      "file_write",
      JSON.stringify({ path: "/workspace/index.html", content: "<html><body>Hi</body></html>" }),
    );
    expect(html).toBe("<html><body>Hi</body></html>");
  });

  it("reads an incomplete JSON content string", () => {
    const html = htmlFromStreamingToolArgs(
      "file_write",
      `{"path":"/workspace/index.html","content":"<!doctype html>\\n<html><body><h1>Deck`,
    );
    expect(html).toBe("<!doctype html>\n<html><body><h1>Deck");
  });

  it("ignores writes to other files", () => {
    expect(
      htmlFromStreamingToolArgs(
        "file_write",
        '{"path":"/workspace/app.js","content":"<html>nope"}',
      ),
    ).toBeUndefined();
  });

  it("ignores other tools", () => {
    expect(htmlFromStreamingToolArgs("exec", '{"command":"ls"}')).toBeUndefined();
  });

  it("treats a Cursor write alias as a canvas file_write", () => {
    expect(
      htmlFromStreamingToolArgs(
        "write",
        JSON.stringify({ path: "/workspace/index.html", contents: "<html><body>Hi</body></html>" }),
      ),
    ).toBe("<html><body>Hi</body></html>");
  });

  it("treats html-looking content as a canvas draft when the path has not arrived yet", () => {
    expect(
      htmlFromStreamingToolArgs("file_write", '{"content":"<!doctype html><html><h1>A'),
    ).toContain("<h1>A");
    expect(htmlFromStreamingToolArgs("file_write", '{"content":"not html yet')).toBeUndefined();
  });

  it("does not paint StrReplace overlay fragments as the live canvas", () => {
    const overlay = `<div id="pauseOv">
  <h2>WRECKED</h2>
  <button type="button">Race again</button>
  <button type="button">Cruise instead</button>
</div></main>`;
    expect(looksLikeHtml(overlay)).toBe(true);
    expect(looksLikeHtmlDocumentDraft(overlay)).toBe(false);
    expect(
      canvasHtmlFromToolCall({
        name: "apply_patch",
        arguments: { path: "/workspace/index.html", streamContent: overlay },
      }),
    ).toBeUndefined();
    expect(
      htmlFromStreamingToolArgs(
        "apply_patch",
        JSON.stringify({ path: "/workspace/index.html", streamContent: overlay }),
      ),
    ).toBeUndefined();
    expect(
      canvasHtmlFromToolCall({
        name: "apply_patch",
        arguments: {
          path: "/workspace/index.html",
          streamContent: '<button type="button" id="bMode">Mode: Race</button>',
        },
      }),
    ).toBeUndefined();
    const page = "<!doctype html><html><body><p>Drive</p></body></html>";
    expect(looksLikeHtmlDocumentDraft(page)).toBe(true);
    expect(
      canvasHtmlFromToolCall({
        name: "file_write",
        arguments: { path: "/workspace/index.html", content: page },
      }),
    ).toBe(page);
  });
});

describe("htmlDocumentFromText", () => {
  it("pulls a fenced HTML document out of chat", () => {
    const html = htmlDocumentFromText(
      "Draft:\n```html\n<html><body><h1>Hi</h1></body></html>\n```\n",
    );
    expect(html).toBe("<html><body><h1>Hi</h1></body></html>");
  });

  it("ignores text that is not a document", () => {
    expect(htmlDocumentFromText("I will design a spinner.")).toBeUndefined();
  });
});

describe("fillCanvasFileWritePath", () => {
  it("defaults a full HTML document to the live canvas only for Design", () => {
    const page = "<!doctype html><html><body>Hi</body></html>";
    expect(fillCanvasFileWritePath({ content: page })).toEqual({ content: page });
    expect(fillCanvasFileWritePath({ content: page }, { design: true })).toEqual({
      content: page,
      path: DESIGN_CANVAS_PATH,
    });
    expect(fillCanvasFileWritePath({ content: "console.log(1)" }, { design: true })).toEqual({
      content: "console.log(1)",
    });
    expect(fillCanvasFileWritePath({ content: "<div>fragment</div>" }, { design: true })).toEqual({
      content: "<div>fragment</div>",
    });
    expect(
      fillCanvasFileWritePath(
        {
          path: "/workspace/about.html",
          content: page,
        },
        { design: true },
      ),
    ).toMatchObject({ path: "/workspace/about.html" });
  });
});

describe("stripHtmlDocumentFromChat", () => {
  it("hides a dumped HTML page and keeps surrounding prose", () => {
    const page = `<!DOCTYPE html>\n<html lang="en"><head><title>Harbor</title></head><body>${"p".repeat(400)}</body></html>`;
    expect(stripHtmlDocumentFromChat(page)).toBe("");
    expect(stripHtmlDocumentFromChat(`Here is the draft.\n\n${page}`)).toBe("Here is the draft.");
    expect(stripHtmlDocumentFromChat('Add `<html lang="en">` to the root.')).toContain(
      '<html lang="en">',
    );
  });
});

describe("isDesignCanvasPath", () => {
  it("accepts index.html under the workspace", () => {
    expect(isDesignCanvasPath("/workspace/index.html")).toBe(true);
    expect(isDesignCanvasPath("index.html")).toBe(true);
    expect(isDesignCanvasPath("/workspace/app.tsx")).toBe(false);
    expect(looksLikeHtml("<div>")).toBe(true);
  });

  it("treats a nested workspace/index.html as a misplaced canvas", () => {
    expect(
      isMisplacedDesignCanvasRel("/home/locus/.locus/docker-workspaces/sess/workspace/index.html"),
    ).toBe(true);
    expect(isMisplacedDesignCanvasRel("workspace/index.html")).toBe(true);
    expect(isMisplacedDesignCanvasRel("index.html")).toBe(false);
    expect(shouldReplaceCanvasHtml(undefined, "<html><body>Hi</body></html>")).toBe(true);
    expect(shouldReplaceCanvasHtml("<html><body>", "<html><body>Hi</body></html>")).toBe(true);
    expect(shouldReplaceCanvasHtml("<html><body>Hi</body></html>", "<html><body>")).toBe(false);
  });
});

describe("isCompleteHtmlDocument", () => {
  it("accepts a closed document and rejects a truncated script", () => {
    expect(isCompleteHtmlDocument("<!doctype html><html><body><h1>Hi</h1></body></html>")).toBe(
      true,
    );
    expect(isCompleteHtmlDocument("<html><body><p>Hi</p></body></html>")).toBe(true);
    expect(isCompleteHtmlDocument("<h1>fragment</h1>")).toBe(true);
    expect(canvasHtmlIncomplete("")).toBe(false);
    expect(canvasHtmlIncomplete(null)).toBe(false);
    expect(
      isCompleteHtmlDocument(`<!DOCTYPE html>
<html lang="en">
<head><title>2026</title></head>
<body>
<canvas id="game"></canvas>
<script>
var W = 320, H = 576;
if(p.alive && G.mode==='play'){
      const`),
    ).toBe(false);
    expect(canvasHtmlIncomplete("<!doctype html><html><body><script>const x = 1")).toBe(true);
    expect(isCompleteHtmlDocument("<html><head><style>body{color:red}")).toBe(false);
    expect(
      isCompleteHtmlDocument("<!doctype html><html><body><!-- <script> --><p>hi</p></body></html>"),
    ).toBe(true);
    const stub = `<!DOCTYPE html><html><body><canvas id="game"></canvas><script>\n/*__GAME__*/\n</script></body></html>`;
    expect(canvasHtmlIncomplete(stub)).toBe(true);
    expect(canvasShouldServeHttp(stub)).toBe(false);
  });
});

describe("canvas HTTP serving", () => {
  const modulePage = `<!DOCTYPE html>
<html><head></head><body>
<canvas id="view"></canvas>
<script type="module">
import * as THREE from './vendor/three.module.js';
</script>
</body></html>`;

  it("detects vendored ES modules and relative scripts", () => {
    expect(canvasNeedsHttp(modulePage)).toBe(true);
    expect(canvasShouldServeHttp(modulePage)).toBe(true);
    expect(
      canvasNeedsHttp(
        `<!DOCTYPE html><html><body><script src="./vendor/three.module.js"></script></body></html>`,
      ),
    ).toBe(true);
    expect(
      canvasNeedsHttp(
        `<!DOCTYPE html><html><body><script type=module>import './a.js'</script></body></html>`,
      ),
    ).toBe(true);
    expect(
      canvasNeedsHttp(
        `<!DOCTYPE html><html><body><script type="importmap">{"imports":{}}</script></body></html>`,
      ),
    ).toBe(true);
    expect(
      canvasNeedsHttp(`<!DOCTYPE html><html><body><script>var x=1;</script></body></html>`),
    ).toBe(false);
    expect(canvasShouldServeHttp("")).toBe(false);
    expect(canvasShouldServeHttp(null)).toBe(false);
  });

  it("serves relative photos over HTTP so getImageData is not tainted", () => {
    const studio = `<!DOCTYPE html><html><body>
<canvas id="view"></canvas>
<script>
  const SRC = "./source.png";
  const img = new Image();
  img.src = SRC;
  off.getContext("2d").getImageData(0, 0, 8, 8);
</script>
</body></html>`;
    expect(canvasLoadsRelativeRaster(studio)).toBe(true);
    expect(canvasReadsPixels(studio)).toBe(true);
    expect(canvasNeedsHttp(studio)).toBe(true);
    expect(canvasShouldServeHttp(studio)).toBe(true);
    expect(
      canvasNeedsHttp(
        `<!DOCTYPE html><html><body><img src=".locus-attachments/image.png"></body></html>`,
      ),
    ).toBe(true);
    expect(
      canvasNeedsHttp(
        `<!DOCTYPE html><html><body><script>var x=1;</script><canvas></canvas></body></html>`,
      ),
    ).toBe(false);
    expect(canvasReadsPixels(`<script>ctx.fillRect(0,0,1,1)</script>`)).toBe(false);
  });

  it("builds canvas-files URLs with seq, pick, and edit", () => {
    expect(canvasFilesPreviewUrl("d1")).toBe("/api/sessions/d1/canvas-files/");
    expect(canvasFilesPreviewUrl("d1", { seq: 3, pick: true })).toBe(
      "/api/sessions/d1/canvas-files/?c=3&locus_pick=1",
    );
    expect(canvasFilesPreviewUrl("d1", { edit: true })).toBe(
      "/api/sessions/d1/canvas-files/?locus_edit=1",
    );
  });
});
