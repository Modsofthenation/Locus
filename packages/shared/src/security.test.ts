import { describe, expect, it } from "vitest";
import {
  CANVAS_FRAME_CSP,
  CANVAS_FRAME_HTML_TYPE,
  CANVAS_FRAME_PATH,
  CANVAS_FRAME_READY_TYPE,
  CANVAS_HTTP_ISOLATED_SANDBOX,
  CANVAS_PREVIEW_HOST,
  CANVAS_PREVIEW_SANDBOX,
  CONTROL_PLANE_CSP,
  canvasFrameHtml,
  canvasHttpFrameSrc,
  canvasIframeSandbox,
  isolateCanvasFrameOrigin,
  isCanvasFilesPath,
  isCanvasPreviewHost,
  isCanvasPreviewUrl,
  isGamePlayPath,
} from "./security.js";

describe("canvas frame CSP", () => {
  it("keeps the control plane from running inline scripts", () => {
    expect(CONTROL_PLANE_CSP).toMatch(/script-src 'self'/);
    expect(CONTROL_PLANE_CSP).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(CONTROL_PLANE_CSP).toMatch(/frame-src 'self' blob: http:\/\/127\.0\.0\.1:\*/);
    expect(CONTROL_PLANE_CSP).toMatch(/http:\/\/locus-canvas\.localhost:\*/);
    expect(CONTROL_PLANE_CSP).not.toMatch(/http:\/\/\*\.localhost:\*/);
    expect(CONTROL_PLANE_CSP).toMatch(/connect-src 'self' ws:\/\/127\.0\.0\.1:\*/);
    expect(CONTROL_PLANE_CSP).not.toMatch(/connect-src 'self' ws: /);
  });

  it("lets painted canvas HTML run inline scripts in the nested frame", () => {
    expect(CANVAS_FRAME_PATH).toBe("/api/canvas-frame");
    expect(CANVAS_FRAME_CSP).toMatch(/script-src 'unsafe-inline'/);
    expect(CANVAS_FRAME_CSP).toMatch(/style-src 'unsafe-inline'/);
    const html = canvasFrameHtml();
    expect(html).toContain(`type === "${CANVAS_FRAME_HTML_TYPE}"`);
    expect(html).toContain(`type: "${CANVAS_FRAME_READY_TYPE}"`);
    expect(html).toContain(`sandbox="${CANVAS_PREVIEW_SANDBOX}"`);
    expect(html).toContain("allow-forms");
    expect(html).not.toMatch(/sandbox="[^"]*allow-same-origin/);
    expect(html).toContain("frame.srcdoc = data.html");
    expect(html).toContain("frame.contentWindow.postMessage");
  });

  it("isolates HTTP canvases onto locus-canvas.localhost so modules can use allow-same-origin", () => {
    expect(isolateCanvasFrameOrigin("http://127.0.0.1:7420")).toBe(
      "http://locus-canvas.localhost:7420",
    );
    expect(isolateCanvasFrameOrigin("http://localhost:5173")).toBe(
      "http://locus-canvas.localhost:5173",
    );
    expect(isolateCanvasFrameOrigin("http://192.168.1.9:7420")).toBeUndefined();
    expect(isolateCanvasFrameOrigin("http://locus-canvas.localhost:7420")).toBeUndefined();
    expect(canvasHttpFrameSrc("/api/sessions/d1/canvas-files/", "http://127.0.0.1:7420")).toEqual({
      src: "http://locus-canvas.localhost:7420/api/sessions/d1/canvas-files/",
      isolated: true,
    });
    expect(canvasHttpFrameSrc("/api/sessions/d1/canvas-files/", "http://192.168.1.9:7420")).toEqual(
      {
        src: "/api/sessions/d1/canvas-files/",
        isolated: false,
      },
    );
    expect(canvasIframeSandbox(true)).toBe(CANVAS_HTTP_ISOLATED_SANDBOX);
    expect(canvasIframeSandbox(false)).toBe(CANVAS_PREVIEW_SANDBOX);
    expect(CANVAS_HTTP_ISOLATED_SANDBOX).toContain("allow-same-origin");
    expect(CANVAS_PREVIEW_SANDBOX).not.toContain("allow-same-origin");
    expect(isCanvasPreviewHost("locus-canvas.localhost:7420")).toBe(true);
    expect(isCanvasPreviewHost("127.0.0.1:7420")).toBe(false);
    expect(
      isCanvasPreviewUrl("http://locus-canvas.localhost:7420/api/sessions/d1/canvas-files/"),
    ).toBe(true);
    expect(isCanvasPreviewUrl("http://127.0.0.1:7420/api/sessions/d1/canvas-files/")).toBe(false);
    expect(isCanvasFilesPath("/api/sessions/d1/canvas-files/")).toBe(true);
    expect(isCanvasFilesPath("/api/sessions/d1/canvas-files/vendor/three.module.js")).toBe(true);
    expect(isCanvasFilesPath("/api/config")).toBe(false);
    expect(isGamePlayPath("/play/pl_abc123/")).toBe(true);
    expect(isGamePlayPath("/play/pl_abc123/vendor/boot-three.js")).toBe(true);
    expect(isGamePlayPath("/api/sessions/d1/canvas-files/")).toBe(false);
    expect(CANVAS_PREVIEW_HOST).toBe("locus-canvas.localhost");
  });
});
