import { describe, expect, it } from "vitest";
import {
  prepareCanvasHtml,
  stampCanvasSeq,
  withPickHook,
  withPreviewGuard,
  withThumbOverflowClip,
  canvasSeqFromDocument,
  isCanvasPaintReady,
  pickCanvasHtml,
} from "./canvasHtml";

describe("canvasHtml", () => {
  it("injects a mousemove guard before page scripts", () => {
    const html = withPreviewGuard(
      "<!doctype html><html><head><script>window.moved=true</script></head><body><h1>Hero</h1></body></html>",
    );
    expect(html).toContain("data-locus-preview-guard");
    expect(html).toContain("locus-canvas-ready");
    expect(html.indexOf("data-locus-preview-guard")).toBeLessThan(
      html.indexOf("window.moved=true"),
    );
    expect(withPreviewGuard(html)).toBe(html);
  });

  it("prepends the guard when there is no html tag", () => {
    expect(withPreviewGuard("<h1>Hero</h1>").startsWith("<script data-locus-preview-guard>")).toBe(
      true,
    );
  });

  it("stops later mousemove listeners from running", () => {
    const seen: string[] = [];
    function stop(event: Event) {
      event.stopImmediatePropagation();
    }
    function onWindow() {
      seen.push("window");
    }
    function onDocument() {
      seen.push("document");
    }
    window.addEventListener("mousemove", stop, true);
    window.addEventListener("mousemove", onWindow, true);
    document.addEventListener("mousemove", onDocument);
    try {
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener("mousemove", stop, true);
      window.removeEventListener("mousemove", onWindow, true);
      document.removeEventListener("mousemove", onDocument);
    }
  });

  it("adds the comment pick hook only when commenting", () => {
    const html = "<html><body><h1>Hello</h1></body></html>";
    expect(prepareCanvasHtml(html, false)).toContain("data-locus-preview-guard");
    expect(prepareCanvasHtml(html, false)).not.toContain("data-locus-pick-hook");
    expect(prepareCanvasHtml(html, true)).toContain("data-locus-pick-hook");
    expect(prepareCanvasHtml(html, "edit")).toContain("data-locus-edit-hook");
    expect(prepareCanvasHtml(html, "edit")).toContain("locus-design-edit");
    expect(prepareCanvasHtml(html, "edit")).toContain(
      "var allow = /^(H[1-6]|P|SPAN|A|BUTTON|LABEL|LI|TD|TH|FIGCAPTION|DT|DD|STRONG|EM|SMALL|LEGEND)$/;",
    );
    expect(prepareCanvasHtml(html, "edit")).not.toContain("data-locus-pick-hook");
    expect(withPickHook(html)).toContain("locus-design-pick");
    expect(
      prepareCanvasHtml(html, false, undefined, false, [
        { selector: "h1", viewport: "desktop", text: "Shorter" },
      ]),
    ).toContain("data-locus-pin-hook");
  });

  it("injects a canvas-files base href so relative kit assets resolve", () => {
    const html = '<html><head></head><body><img src="assets/logo.svg"></body></html>';
    const based = prepareCanvasHtml(html, false, "/api/sessions/d1/canvas-files/");
    expect(based).toContain('<base href="/api/sessions/d1/canvas-files/">');
    expect(based.indexOf("<base href=")).toBeGreaterThan(based.indexOf("<head>"));
    expect(based.indexOf("<base href=")).toBeLessThan(based.indexOf("</head>"));
    expect(prepareCanvasHtml(based, false, "/api/sessions/d1/canvas-files/")).toBe(based);
  });

  it("clips overflow only for sidebar thumbs, not the live canvas", () => {
    const html = "<html><head></head><body><h1>Hero</h1></body></html>";
    expect(prepareCanvasHtml(html, false)).not.toContain("data-locus-thumb-clip");
    const clipped = withThumbOverflowClip(prepareCanvasHtml(html, false));
    expect(clipped).toContain("data-locus-thumb-clip");
    expect(clipped).toMatch(/html,\s*body\s*\{[\s\S]*?overflow:\s*hidden\s*!important/);
    expect(clipped).toContain("scrollbar-width: none");
    expect(clipped).toContain("::-webkit-scrollbar");
    expect(clipped.indexOf("data-locus-thumb-clip")).toBeGreaterThan(clipped.indexOf("<head>"));
    expect(clipped.indexOf("data-locus-thumb-clip")).toBeLessThan(clipped.indexOf("</head>"));
    expect(withThumbOverflowClip(clipped)).toBe(clipped);
    expect(withThumbOverflowClip("<h1>Hero</h1>")).toContain("data-locus-thumb-clip");
  });

  it("stamps a seq on the preview guard so blank iframe loads can be ignored", () => {
    const html = prepareCanvasHtml("<html><body><h1>Hero</h1></body></html>", false);
    const stamped = stampCanvasSeq(html, 4);
    expect(stamped).toContain('data-locus-canvas-seq="4"');
    expect(stampCanvasSeq(stamped, 5)).toContain('data-locus-canvas-seq="5"');
    expect(stampCanvasSeq(stamped, 5)).not.toContain('data-locus-canvas-seq="4"');
    const doc = new DOMParser().parseFromString(stampCanvasSeq(html, 7), "text/html");
    expect(canvasSeqFromDocument(doc)).toBe(7);
    expect(
      canvasSeqFromDocument(new DOMParser().parseFromString("<html></html>", "text/html")),
    ).toBeUndefined();
  });

  it("does not treat a head-only doctype as a painted page", () => {
    expect(isCanvasPaintReady("<!DOCTYPE html><html><head>")).toBe(false);
    expect(isCanvasPaintReady("<html><head><style></style>")).toBe(false);
    expect(isCanvasPaintReady("<html><body></body></html>")).toBe(false);
    expect(isCanvasPaintReady("<html><head><style>body{color:red}</style></head></html>")).toBe(
      true,
    );
    expect(isCanvasPaintReady("<html><body><h1>Hero</h1></body></html>")).toBe(true);
    expect(isCanvasPaintReady("<h1>Hero</h1>")).toBe(true);
  });

  it("closes truncated tags so a partial stream can still paint", () => {
    const closed = prepareCanvasHtml("<html><body><h1>Hero</h1>", false);
    expect(closed).toContain("<h1>Hero</h1>");
    expect(closed).toContain("</body>");
    expect(closed).toContain("</html>");
  });

  it("keeps a longer live stream while the agent is writing, then takes the landed file", () => {
    expect(pickCanvasHtml("<h1>Draft deck extra</h1>", "<h1>Draft</h1>", true)).toBe(
      "<h1>Draft deck extra</h1>",
    );
    expect(pickCanvasHtml("<h1>Old</h1>", "<h1>Hello</h1>", true)).toBe("<h1>Hello</h1>");
    expect(pickCanvasHtml("<h1>Old</h1>", "<h1>Hello</h1>", false)).toBe("<h1>Hello</h1>");
    expect(pickCanvasHtml(undefined, "<h1>Disk</h1>", true)).toBe("<h1>Disk</h1>");
    expect(pickCanvasHtml("<h1>Live</h1>", null, true)).toBe("<h1>Live</h1>");
  });
});
