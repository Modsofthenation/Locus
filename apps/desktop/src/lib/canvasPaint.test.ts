import { describe, expect, it } from "vitest";
import { finishCanvasSrcDoc, paintCanvasHtml, paintCanvasSrcDoc } from "./canvasPaint";

const systems: never[] = [];

describe("paintCanvasHtml", () => {
  it("applies Game feel CSS and Asset pose CSS", () => {
    const html = "<html><body><canvas></canvas></body></html>";
    const game = paintCanvasHtml({
      html,
      session: { id: "g1", kind: "game", designTune: { gravity: 0.6 } },
      systems,
    });
    expect(game).toContain("data-locus-game-feel");
    expect(game).toContain("--gravity");
    const asset = paintCanvasHtml({
      html,
      session: { id: "a1", kind: "assets", designTune: { head: 12 } },
      systems,
    });
    expect(asset).toContain("data-locus-asset-pose");
    expect(asset).toContain("--head");
    const design = paintCanvasHtml({
      html,
      session: { id: "d1", kind: "design" },
      systems,
    });
    expect(design).not.toContain("data-locus-game-feel");
    expect(design).not.toContain("data-locus-asset-pose");
  });
});

describe("paintCanvasSrcDoc", () => {
  it("attaches chrome hooks for Game and Asset", () => {
    const html = "<html><body><h1>Hi</h1></body></html>";
    const game = paintCanvasSrcDoc({
      html,
      session: { id: "g1", kind: "game" },
      systems,
      filesBase: "/api/sessions/g1/canvas-files/",
    });
    expect(game).toContain("data-locus-game-chrome");
    const asset = paintCanvasSrcDoc({
      html,
      session: { id: "a1", kind: "assets" },
      systems,
    });
    expect(asset).toContain("data-locus-asset-chrome");
    const prepared = finishCanvasSrcDoc(html, {
      session: { id: "d1", kind: "design" },
      interaction: "comment",
    });
    expect(prepared).toContain("data-locus-pick-hook");
  });

  it("passes inspect pins through prepare", () => {
    const prepared = finishCanvasSrcDoc("<html><body><p>Hi</p></body></html>", {
      session: { id: "d1", kind: "design" },
      interaction: "inspect",
      pins: [{ selector: "p", text: "note", viewport: "desktop" }],
    });
    expect(prepared).toContain("data-locus-pick-hook");
    expect(prepared).toContain("data-locus-pin-hook");
  });
});
