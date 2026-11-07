import { describe, expect, it } from "vitest";
import {
  CANVAS_SEQ_ATTR,
  decorateCanvasHtml,
  guessListenPorts,
  isPreviewTargetHost,
  parseProcNetTcp,
  parsePreviewPort,
  parseSessionPreview,
  pickPreviewPort,
  previewProxyPath,
  sanitizePreviewPath,
  withCanvasPreviewGuard,
} from "./models/preview.js";

describe("preview helpers", () => {
  it("parses LISTEN ports from /proc/net/tcp and skips blocked ones", () => {
    const text = [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1",
      "   1: 0100007F:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2",
      "   2: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 3",
      "   3: 0100007F:1F90 0100007F:BBBB 01 00000000:00000000 00:00000000 00000000     0        0 4",
    ].join("\n");
    expect(parseProcNetTcp(text)).toEqual([80, 8080]);
  });

  it("guesses ports from common start commands", () => {
    expect(guessListenPorts("python3 -m http.server 9000")).toEqual([9000]);
    expect(guessListenPorts("python3 -m http.server")).toEqual([8000]);
    expect(guessListenPorts("npx vite --port 5174 --host 0.0.0.0")).toEqual([5174]);
    expect(guessListenPorts("next dev -p 3001")).toEqual([3001]);
    expect(guessListenPorts("npx vite")).toEqual([5173]);
    expect(guessListenPorts("PORT=4000 npm start")).toEqual([4000]);
    expect(guessListenPorts("ssh -p 22")).toEqual([]);
  });

  it("picks a preferred port and sanitizes paths", () => {
    expect(pickPreviewPort([22, 8080, 3000])).toBe(3000);
    expect(pickPreviewPort([9000, 8080], 9000)).toBe(9000);
    expect(sanitizePreviewPath("../etc/passwd")).toBe("/");
    expect(sanitizePreviewPath("app")).toBe("/app");
    expect(previewProxyPath("s1", 3000, "/docs")).toBe("/api/sessions/s1/preview-http/3000/docs");
    expect(parsePreviewPort(22)).toBeUndefined();
    expect(parsePreviewPort(3999)).toBeUndefined();
    expect(parsePreviewPort(9222)).toBeUndefined();
    expect(parsePreviewPort(3000)).toBe(3000);
    expect(parseSessionPreview({ port: 5173, path: "/app" })).toEqual({ port: 5173, path: "/app" });
  });

  it("only allows loopback and private hop addresses", () => {
    expect(isPreviewTargetHost("127.0.0.1")).toBe(true);
    expect(isPreviewTargetHost("10.0.0.4")).toBe(true);
    expect(isPreviewTargetHost("172.17.0.2")).toBe(true);
    expect(isPreviewTargetHost("192.168.1.9")).toBe(true);
    expect(isPreviewTargetHost("8.8.8.8")).toBe(false);
    expect(isPreviewTargetHost("169.254.169.254")).toBe(false);
    expect(isPreviewTargetHost("example.com")).toBe(false);
  });
});

describe("canvas HTML decorate", () => {
  const page = "<html><head></head><body><h1>app</h1></body></html>";

  it("injects the mousemove guard by default and skips it when asked", () => {
    const guarded = withCanvasPreviewGuard(page, 4);
    expect(guarded).toContain("data-locus-preview-guard");
    expect(guarded).toContain(`${CANVAS_SEQ_ATTR}="4"`);
    const decorated = decorateCanvasHtml(page, { seq: 9 });
    expect(decorated).toContain("data-locus-preview-guard");
    expect(decorated).toContain(`${CANVAS_SEQ_ATTR}="9"`);
    const coding = decorateCanvasHtml(page, { seq: 9, guard: false });
    expect(coding).not.toContain("data-locus-preview-guard");
    expect(coding).toBe(page);
    expect(guarded).toContain("setTimeout(ping, 0)");
  });

  it("adds pick or edit hooks after the guard", () => {
    const picked = decorateCanvasHtml(page, { pick: true });
    expect(picked).toContain("data-locus-preview-guard");
    expect(picked).toContain("data-locus-pick-hook");
    const edited = decorateCanvasHtml(page, { edit: true, guard: false });
    expect(edited).toContain("data-locus-edit-hook");
    expect(edited).not.toContain("data-locus-preview-guard");
    const game = decorateCanvasHtml(page, {
      game: true,
      guard: false,
      tune: { gravity: 100, seed: 7 },
    });
    expect(game).toContain("data-locus-game-chrome");
    expect(game).toContain("data-locus-game-feel");
    expect(game).toContain("--gravity: 100");
    const assets = decorateCanvasHtml(page, { assets: true, guard: false });
    expect(assets).toContain("data-locus-asset-chrome");
    const pinned = decorateCanvasHtml(page, {
      pins: [{ selector: "h1.hero", viewport: "desktop", text: "Shorter" }],
    });
    expect(pinned).toContain("data-locus-pin-hook");
    expect(pinned).toContain("h1.hero");
  });

  it("keeps pointer events live on games and assets and shims opaque localStorage", () => {
    const game = decorateCanvasHtml(page, { game: true, seq: 2 });
    expect(game).toContain('data-locus-live-pointers="1"');
    expect(game).toContain("locus-probe");
    expect(game).toContain("localStorage");
    const design = decorateCanvasHtml(page, { seq: 2 });
    expect(design).not.toContain("data-locus-live-pointers=");
    expect(design).toContain("pointermove");
  });
});
