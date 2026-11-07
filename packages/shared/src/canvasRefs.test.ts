import { describe, expect, it } from "vitest";
import {
  canvasRelativeAssetRefs,
  canvasRelativeCssUrls,
  normalizeCanvasAssetRel,
} from "./models/canvasRefs.js";

describe("canvas relative refs", () => {
  it("collects href/src/url assets and skips remote or data URLs", () => {
    const html = `<html><head>
      <link rel="stylesheet" href="styles.css">
      <link rel="stylesheet" href="https://cdn.example/x.css">
    </head><body>
      <img src="assets/logo.png">
      <img srcset="assets/logo.png 1x, assets/logo@2x.png 2x">
      <script src="./vendor/app.js"></script>
      <div style="background:url(fonts/mark.woff2)"></div>
    </body></html>`;
    expect(canvasRelativeAssetRefs(html).sort()).toEqual([
      "assets/logo.png",
      "assets/logo@2x.png",
      "fonts/mark.woff2",
      "styles.css",
      "vendor/app.js",
    ]);
  });

  it("rejects traversal and the canvas document itself", () => {
    expect(normalizeCanvasAssetRel("../secret.css")).toBeUndefined();
    expect(normalizeCanvasAssetRel("index.html")).toBeUndefined();
    expect(normalizeCanvasAssetRel("data:image/png;base64,xx")).toBeUndefined();
    expect(canvasRelativeCssUrls(`body{background:url("./assets/bg.png")}`)).toEqual([
      "assets/bg.png",
    ]);
  });
});
