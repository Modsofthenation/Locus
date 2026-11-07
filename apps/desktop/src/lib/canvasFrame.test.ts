import { describe, expect, it } from "vitest";
import { CANVAS_FRAME_HTML_TYPE, CANVAS_FRAME_PATH } from "@locus/shared";
import {
  canvasFrameDoc,
  canvasFrameSrc,
  isCanvasFrameReady,
  postCanvasFrameHtml,
} from "./canvasFrame";

describe("canvasFrame", () => {
  it("points the preview iframe at the same-origin runner", () => {
    expect(canvasFrameSrc()).toBe(CANVAS_FRAME_PATH);
  });

  it("reads painted html from the data-srcdoc attribute", () => {
    const frame = document.createElement("iframe");
    frame.setAttribute("data-srcdoc", "<h1>Deck</h1>");
    expect(canvasFrameDoc(frame)).toBe("<h1>Deck</h1>");
    expect(isCanvasFrameReady({ type: "locus-canvas-frame-ready" })).toBe(true);
    expect(isCanvasFrameReady({ type: "locus-canvas-ready" })).toBe(false);
  });

  it("posts canvas html to the runner window", () => {
    const posted: unknown[] = [];
    const win = {
      postMessage(data: unknown) {
        posted.push(data);
      },
    };
    postCanvasFrameHtml(win as Window, "<h1>Hi</h1>");
    expect(posted).toEqual([{ type: CANVAS_FRAME_HTML_TYPE, html: "<h1>Hi</h1>" }]);
  });
});
