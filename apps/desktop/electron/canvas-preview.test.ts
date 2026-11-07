// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./main.cjs", import.meta.url), "utf8");

describe("electron canvas preview", () => {
  it("maps locus-canvas.localhost to IPv4 loopback before app ready", () => {
    expect(src).toContain('app.commandLine.appendSwitch("host-resolver-rules"');
    expect(src).toContain("MAP ${CANVAS_PREVIEW_HOST} 127.0.0.1");
    expect(src.indexOf("host-resolver-rules")).toBeLessThan(src.indexOf("app\n  .whenReady"));
  });

  it("allows the canvas preview host in frame-src", () => {
    expect(src).toContain("http://locus-canvas.localhost:*");
    expect(src).not.toContain("http://*.localhost:*");
  });

  it("does not stamp the control-plane CSP onto the canvas preview origin", () => {
    expect(src).toContain("function isCanvasPreviewUrl(url)");
    expect(src).toContain("if (isCanvasPreviewUrl(details.url))");
  });
});
