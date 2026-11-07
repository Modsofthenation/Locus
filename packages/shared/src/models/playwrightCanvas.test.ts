import { describe, expect, it } from "vitest";
import {
  formatPlaywrightReport,
  htmlHasLocator,
  htmlHasText,
  parsePlaywrightStepLine,
  parsePlaywrightSteps,
  parsePlaywrightViewport,
  playwrightChipDetail,
  playwrightImportantConsole,
  playwrightStepNeedsLive,
  playwrightWantsLive,
  playwrightWantsScreenshot,
  isPlaywrightPageUrl,
  PLAYWRIGHT_CHROME_MISSING,
  PLAYWRIGHT_TAINTED_CANVAS,
  PLAYWRIGHT_REPEAT_NOTE,
  PLAYWRIGHT_VIEWPORTS,
  countPlaywrightCallsThisTurn,
  playwrightLooksTainted,
  playwrightRepeatNote,
  playwrightReportFailed,
} from "./playwrightCanvas.js";

const CANVAS = `<!DOCTYPE html><html><body>
<button id="btn-deploy">Deploy</button>
<input id="name" class="field" />
</body></html>`;

describe("playwright canvas args", () => {
  it("parses shorthand steps and named fields", () => {
    expect(parsePlaywrightStepLine("click #btn-deploy")).toEqual({
      kind: "click",
      locator: "#btn-deploy",
    });
    expect(parsePlaywrightStepLine("fill #name Alice")).toEqual({
      kind: "fill",
      locator: "#name",
      text: "Alice",
    });
    expect(parsePlaywrightStepLine("expect Deploy")).toEqual({ kind: "expect", text: "Deploy" });
    expect(parsePlaywrightStepLine("wait #hud")).toEqual({ kind: "wait", locator: "#hud" });
    expect(parsePlaywrightStepLine("wait 15s")).toEqual({
      kind: "wait",
      locator: "15000ms",
      ms: 15_000,
    });
    expect(parsePlaywrightStepLine("seed 4")).toEqual({ kind: "seed", value: 4 });
    expect(parsePlaywrightSteps({ click: "#go", clicks: ["#a"], expect_text: "Ready" })).toEqual([
      { kind: "click", locator: "#go" },
      { kind: "click", locator: "#a" },
      { kind: "expect", text: "Ready" },
    ]);
    expect(
      parsePlaywrightSteps({
        steps: ["click #btn-deploy", "fill #name Alice", "expect Deploy"],
        fill_selector: "#email",
        fill_text: "a@b.c",
        wait_for: "text=HUD",
      }),
    ).toEqual([
      { kind: "click", locator: "#btn-deploy" },
      { kind: "fill", locator: "#name", text: "Alice" },
      { kind: "expect", text: "Deploy" },
      { kind: "fill", locator: "#email", text: "a@b.c" },
      { kind: "wait", locator: "text=HUD" },
    ]);
    expect(parsePlaywrightStepLine("press ArrowRight")).toEqual({ kind: "key", key: "ArrowRight" });
    expect(parsePlaywrightStepLine("key Space")).toEqual({ kind: "key", key: "Space" });
    expect(parsePlaywrightViewport("phone")).toBe("phone");
    expect(parsePlaywrightViewport("landscape")).toBe("landscape");
    expect(parsePlaywrightViewport("nope")).toBe("desktop");
    expect(PLAYWRIGHT_VIEWPORTS.phone).toEqual({ width: 390, height: 844 });
    expect(PLAYWRIGHT_VIEWPORTS.landscape).toEqual({ width: 844, height: 390 });
    expect(playwrightStepNeedsLive({ kind: "key", key: "Space" })).toBe(true);
    expect(playwrightStepNeedsLive({ kind: "click", locator: "#x" })).toBe(true);
    expect(playwrightStepNeedsLive({ kind: "expect", text: "Hi" })).toBe(false);
    expect(playwrightWantsScreenshot({})).toBe(true);
    expect(playwrightWantsScreenshot({ screenshot: false })).toBe(false);
    expect(playwrightWantsScreenshot({ screenshot: true })).toBe(true);
    expect(playwrightWantsLive({ expect_text: "Hi" })).toBe(false);
    expect(playwrightWantsLive({ click: "#go" })).toBe(true);
    expect(playwrightWantsLive({ screenshot: true, expect_text: "Hi" })).toBe(true);
    expect(playwrightWantsLive({ screenshot: false, click: "#go" })).toBe(true);
  });

  it("matches CSS and text locators in markup", () => {
    expect(htmlHasLocator(CANVAS, "#btn-deploy")).toBe(true);
    expect(htmlHasLocator(CANVAS, ".field")).toBe(true);
    expect(htmlHasLocator(CANVAS, "button")).toBe(true);
    expect(htmlHasLocator(CANVAS, "text=Deploy")).toBe(true);
    expect(htmlHasLocator(CANVAS, "#missing")).toBe(false);
    expect(htmlHasText(CANVAS, "Deploy")).toBe(true);
    expect(htmlHasText(CANVAS, "Launch")).toBe(false);
  });

  it("formats a compact report and chip detail", () => {
    expect(playwrightChipDetail({ click: "#btn-deploy" })).toBe("click #btn-deploy");
    expect(playwrightChipDetail({ steps: ["click #a", "expect Ready"] })).toBe("2 steps");
    expect(
      formatPlaywrightReport({
        viewport: "desktop",
        mode: "static",
        results: [
          { step: { kind: "click", locator: "#btn-deploy" }, ok: true },
          { step: { kind: "expect", text: "Launch" }, ok: false, detail: "not in markup" },
        ],
        note: PLAYWRIGHT_CHROME_MISSING,
        screenshot: true,
      }),
    ).toMatch(/fail {2}expect Launch — not in markup/);
    expect(
      formatPlaywrightReport({
        viewport: "desktop",
        mode: "live",
        results: [{ step: { kind: "click", locator: "#go" }, ok: true }],
        screenshot: true,
        stats: "stats mode=3d verts=86 tris=72",
        note: PLAYWRIGHT_TAINTED_CANVAS,
      }),
    ).toMatch(/stats mode=3d verts=86/);
    expect(
      playwrightLooksTainted("SecurityError: The canvas has been tainted by cross-origin data."),
    ).toBe(true);
    expect(playwrightLooksTainted("ok click #btnWire")).toBe(false);
    expect(playwrightReportFailed("stats mode=3d verts=0 — verts is 0")).toBe(true);
    expect(playwrightReportFailed("stats missing — no window.__locusAsset.stats")).toBe(true);
    expect(playwrightReportFailed("ok  click #btnWire\nstats mode=3d verts=12")).toBe(false);
    expect(playwrightLooksTainted("SecurityError: Access to localStorage is denied")).toBe(false);
    const first =
      "Playwright desktop 1280×800 (live)\nok  click #btnWire\nstats mode=3d verts=3262 tris=5898\nscreenshot captured";
    const second =
      "Playwright desktop 1280×800 (live)\nok  click #btnWire\nstats mode=3d verts=3262 tris=5898";
    expect(playwrightRepeatNote(first, second)).toBe(PLAYWRIGHT_REPEAT_NOTE);
    expect(playwrightRepeatNote(first, `${second}\nstats mode=3d verts=4000`)).toBeUndefined();
    expect(
      countPlaywrightCallsThisTurn([
        { role: "user" },
        {
          role: "assistant",
          toolCalls: [
            { name: "playwright", result: first },
            { name: "locus-playwright", result: second },
          ],
        },
      ]),
    ).toEqual({ calls: 2, lastReport: second });
    expect(
      formatPlaywrightReport({
        viewport: "desktop",
        mode: "live",
        results: [{ step: { kind: "click", locator: "#go" }, ok: true }],
        screenshot: true,
        stats: "stats mode=3d verts=12",
        console: [
          "ignored info",
          "THREE.WebGLRenderer: Context Lost",
          "Failed to load ./vendor/x.js",
        ],
      }),
    ).toMatch(/screenshot captured/);
    expect(
      formatPlaywrightReport({
        viewport: "desktop",
        mode: "live",
        results: [{ step: { kind: "click", locator: "#go" }, ok: true }],
        screenshot: true,
        stats: "stats mode=3d verts=12",
        console: [
          "ignored info",
          "THREE.WebGLRenderer: Context Lost",
          "Failed to load ./vendor/x.js",
        ],
      }),
    ).toMatch(/stats mode=3d verts=12/);
    expect(
      playwrightImportantConsole([
        "hello",
        "Failed to load ./vendor/three.module.js",
        "THREE.WebGLRenderer: Context Lost",
      ]),
    ).toEqual(["Failed to load ./vendor/three.module.js", "THREE.WebGLRenderer: Context Lost"]);
  });

  it("accepts http(s) page urls only", () => {
    expect(isPlaywrightPageUrl("http://127.0.0.1:9/app")).toBe(true);
    expect(isPlaywrightPageUrl("https://example.com/")).toBe(true);
    expect(isPlaywrightPageUrl("file:///etc/passwd")).toBe(false);
    expect(isPlaywrightPageUrl("javascript:alert(1)")).toBe(false);
    expect(isPlaywrightPageUrl("not a url")).toBe(false);
  });
});
