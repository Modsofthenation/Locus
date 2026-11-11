import { describe, expect, it } from "vitest";
import { generationQualityNeedsHuman, scoreGenerationEval } from "./generationEval.js";

describe("generation eval score", () => {
  it("fails generic design HTML and passes a distinctive canvas", () => {
    expect(
      scoreGenerationEval({
        id: "design-slop",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Inter,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2)}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-ok",
        kind: "design",
        html: `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:Georgia,serif;background:var(--bg)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(
      scoreGenerationEval({
        id: "design-tailwind-cdn",
        kind: "design",
        html: `<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-geist-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Geist,sans-serif}</style></head><body><div class="from-indigo-500">Hi</div></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-iowan-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><div class="bg-indigo-600"><h1>Press ledger</h1></div></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-indigo-alone",
        kind: "design",
        html: `<!doctype html><html><body><div class="bg-indigo-600"><h1>Press ledger</h1></div></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-indigo-bare",
        kind: "design",
        html: `<!doctype html><html><body><div class="bg-indigo"><h1>Press ledger</h1></div></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-indigo-opacity",
        kind: "design",
        html: `<!doctype html><html><body><div class="bg-indigo/80"><h1>Press ledger</h1></div></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-blue-bare",
        kind: "design",
        html: `<!doctype html><html><body><div class="bg-blue"><h1>Press ledger</h1></div></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-oklch-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:oklch(0.546 0.245 262.881)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-hwb-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:hwb(239 39% 5%)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-hsl-number-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:hsl(239.1 84.2 66.7)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-hwb-number-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:hwb(239 39 5)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-lch-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:lch(50.1 80.4 298.8)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-lab-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:lab(50.1 38.7 -70.5)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-p3-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:color(display-p3 0.3904 0.3996 0.9126)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-rec2020-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:color(rec2020 0.3828 0.3557 0.8958)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-a98-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:color(a98-rgb 0.3914 0.3994 0.9282)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-xyz-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:color(xyz 0.2577 0.1851 0.8544)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-prophoto-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:color(prophoto-rgb 0.388 0.400 0.945)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-xyz-d50-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:color(xyz-d50 0.2314 0.1763 0.6428)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-color-oklch-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:color(oklch 0.546 0.245 262.881)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-color-oklab-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:color(oklab 0.546 -0.030 -0.243)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-color-lch-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:color(lch 50.1 80.4 298.8)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-color-hwb-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:color(hwb 239 39% 5%)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-srgb-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:color(srgb 0.388 0.400 0.945)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-rgb-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:rgb(79, 70, 229)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-rgb-percent-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:rgb(38.8% 40% 94.5%)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-named-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:indigo}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-named-purple",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:purple}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-named-violet",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:violet}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-named-navy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:navy}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-navy-token",
        kind: "design",
        html: `<!doctype html><html><head><style>:root{--navy-600:#1F2937}body{font-family:"Iowan Old Style",serif;background:#111;color:var(--navy-600)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(
      scoreGenerationEval({
        id: "design-hex8-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:#6366f1ff}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-shorthand-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;border-top:1px solid indigo}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-arbitrary-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><div class="bg-[indigo]"><h1>Press ledger</h1></div></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-svg-indigo",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><svg><rect fill="indigo" width="8" height="8"/></svg><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-inter-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Inter,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-georgia-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Georgia,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-instrument-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Instrument Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-sora-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Sora,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-font-shorthand-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font:16px/1.4 "Instrument Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-font-shorthand-sans",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font:16px sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-urbanist-radial",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Urbanist,sans-serif;background:radial-gradient(#111,#222)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-tw-font-sans",
        kind: "design",
        html: `<!doctype html><html><body class="font-sans"><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-var-font-inter",
        kind: "design",
        html: `<!doctype html><html><head><style>:root{--font-sans:Inter,sans-serif}body{font-family:var(--font-sans);background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-syne-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Syne,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-clash-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Clash Display",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-reckless-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Reckless,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-canela-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Canela,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-editorial-new-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Editorial New",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-favorit-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Favorit,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-soehne-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Söhne",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-array-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Array,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-neue-haas-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Neue Haas Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-abc-social-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"ABC Social",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-pp-neue-montreal-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"PP Neue Montreal",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-pp-right-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"PP Right Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-abc-rom-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"ABC ROM",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-gt-alpina-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"GT Alpina",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-graphik-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Graphik,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-suisse-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Suisse Intl",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-founders-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Founders Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-circular-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Circular,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-lato-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Lato,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-didot-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Didot,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-bodoni-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Bodoni Moda",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-din-next-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"DIN Next",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-lexend-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Lexend,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-atkinson-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Atkinson Hyperlegible",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-caslon-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Caslon,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-goudy-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Goudy Old Style",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-dm-serif-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"DM Serif Display",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-bebas-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Bebas Neue",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-cooper-black-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Cooper Black",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-abril-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Abril Fatface",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-comfortaa-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Comfortaa,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-quicksand-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Quicksand,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-exo-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Exo,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-sentinel-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Sentinel,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-freight-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Freight Text",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-whitney-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Whitney,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-verlag-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Verlag,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-operator-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Operator Mono",monospace;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-idlewild-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Idlewild,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-knockout-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Knockout,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-hoefler-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Hoefler Text",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-calibre-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Calibre,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-untitled-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Untitled Sans",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-national-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:National,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-styrene-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Styrene,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-publico-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Publico,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-lyon-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Lyon,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-gill-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Gill Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-myriad-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Myriad,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-optima-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Optima,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-trajan-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Trajan,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-menlo-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Menlo,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-monaco-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Monaco,monospace;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-consolas-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Consolas,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-courier-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Courier New",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-space-mono-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Space Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-fira-code-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Fira Code",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-object-sans-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"PP Object Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-warnock-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Warnock,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-chaparral-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Chaparral,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-sf-mono-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"SF Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-cascadia-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Cascadia Code",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-andale-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Andale Mono",monospace;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-input-mono-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Input Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-iosevka-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Iosevka,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-dm-mono-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"DM Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-clash-grotesk-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Clash Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-monaspace-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Monaspace Neon",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-recursive-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Recursive,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-charter-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Charter,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-new-york-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"New York",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-hatton-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"PP Hatton",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-miller-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Miller,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-pressura-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"GT Pressura",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-sf-compact-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"SF Compact",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-mona-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Mona Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-aeonik-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Aeonik,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-hubot-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Hubot Sans",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-everett-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"TWK Everett",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-saans-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Saans,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-suisse-works-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Suisse Works",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-spectral-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Spectral,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-cinzel-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Cinzel,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-departure-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Departure Mono",monospace;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-yeseva-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Yeseva One",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-supply-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"PP Supply Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-fredoka-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Fredoka,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-vulf-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Vulf Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-obviously-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Obviously,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-cheee-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Cheee,cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-degular-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Degular,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-mabry-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Mabry,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-lobster-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Lobster,cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-orbitron-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Orbitron,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-bungee-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Bungee,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-caveat-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Caveat,cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-young-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Young Serif",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-gloock-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Gloock,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-fortescue-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Fortescue,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-copperplate-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Copperplate,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-rockwell-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Rockwell,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-rajdhani-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Rajdhani,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-heebo-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Heebo,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-fjalla-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Fjalla One",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-overpass-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Overpass,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-assistant-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Assistant,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-skolar-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Skolar,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-vt323-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:VT323,monospace;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-oxygen-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Oxygen,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-league-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"League Spartan",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-hanken-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Hanken Grotesk",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-alegreya-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Alegreya,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-akzidenz-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Akzidenz Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-arimo-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Arimo,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-electrolize-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Electrolize,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-meta-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"FF Meta",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-liberation-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Liberation Sans",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-indie-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Indie Flower",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-cuprum-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Cuprum,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-petrona-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Petrona,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-kalam-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Kalam,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-shadows-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Shadows Into Light",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-lustria-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Lustria,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-staatliches-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Staatliches,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-blackops-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Black Ops One",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-lilita-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Lilita One",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-cairo-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Cairo,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-readex-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Readex Pro",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-philosopher-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Philosopher,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-nanum-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Nanum Gothic",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-almarai-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Almarai,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-amiri-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Amiri,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-tangerine-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Tangerine,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-pinyon-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Pinyon Script",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-niramit-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Niramit,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-k2d-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:K2D,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-kosugi-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Kosugi,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-mitr-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Mitr,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-reenie-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Reenie Beanie",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-creepster-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Creepster,cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-coming-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Coming Soon",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-scheherazade-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Scheherazade New",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-suez-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Suez One",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-david-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"David Libre",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-comic-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Comic Sans MS",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-cambria-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Cambria,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-raleway-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Raleway,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-noto-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Noto Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-garamond-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Garamond,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-aktiv-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Aktiv Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-futura-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Futura,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-georgia-supercharge",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Georgia,serif;background:#fff}</style></head><body><h1>Supercharge your workflow</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({
        id: "design-sans-copy",
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "generic template" });
    expect(
      scoreGenerationEval({ id: "design-stub", kind: "design", html: "<div>Hi</div>" }),
    ).toMatchObject({ passed: false, reason: "canvas incomplete" });
  });

  it("fails unplayable games and unwired 3D assets", () => {
    expect(
      scoreGenerationEval({
        id: "game-splash",
        kind: "game",
        html: "<html><body>hello</body></html>",
      }),
    ).toMatchObject({ passed: false, reason: "unplayable" });
    expect(
      scoreGenerationEval({
        id: "game-dry",
        kind: "game",
        html: "<html><body><script>window.addEventListener('keydown', () => {});</script>Score 0<button>Restart</button></body></html>",
      }),
    ).toMatchObject({ passed: false, reason: "dry" });
    expect(
      scoreGenerationEval({
        id: "game-ok",
        kind: "game",
        html: "<html><body><script>window.addEventListener('keydown', () => {}); function beep(){ new AudioContext().createOscillator(); }</script>Score 0<button>Restart</button></body></html>",
      }),
    ).toMatchObject({ passed: true, reason: "playable" });
    expect(
      scoreGenerationEval({
        id: "game-unused",
        kind: "game",
        html: "<html><body><script>window.addEventListener('keydown', () => {}); function beep(){ new AudioContext().createOscillator(); }</script>Score 0<button>Restart</button></body></html>",
        assetSlugs: ["knight"],
      }),
    ).toMatchObject({ passed: false, reason: "unused assets" });
    expect(
      scoreGenerationEval({
        id: "game-used",
        kind: "game",
        html: `<html><body><script>window.addEventListener('keydown', () => {}); function beep(){ new AudioContext().createOscillator(); } drawImage("vendor/assets/knight/source.png");</script>Score 0<button>Restart</button></body></html>`,
        assetSlugs: ["knight"],
      }),
    ).toMatchObject({ passed: true, reason: "playable" });
    expect(
      scoreGenerationEval({
        id: "asset-css3d",
        kind: "asset",
        html: `<html><style>#rig{transform-style:preserve-3d}</style><div id="hud">css-3d 3D mesh</div></html>`,
      }),
    ).toMatchObject({ passed: false, reason: "unwired" });
    expect(
      scoreGenerationEval({
        id: "asset-empty",
        kind: "asset",
        html: `<canvas></canvas><script>import * as THREE from "./vendor/three.module.js"</script>`,
      }),
    ).toMatchObject({ passed: false, reason: "placeholder" });
    expect(
      scoreGenerationEval({
        id: "asset-cube",
        kind: "asset",
        html: `<canvas></canvas><script>new THREE.BoxGeometry(1,1,1)</script>`,
      }),
    ).toMatchObject({ passed: false, reason: "placeholder" });
    expect(
      scoreGenerationEval({
        id: "asset-billboard",
        kind: "asset",
        html: `<canvas></canvas><script>new THREE.PlaneGeometry(1,1); new THREE.TextureLoader().load("./source.png");</script>`,
      }),
    ).toMatchObject({ passed: false, reason: "placeholder" });
    expect(
      scoreGenerationEval({
        id: "asset-empty-buffer",
        kind: "asset",
        html: `<canvas></canvas><script>import * as THREE from "./vendor/three.module.js"; new THREE.BufferGeometry();</script>`,
      }),
    ).toMatchObject({ passed: false, reason: "placeholder" });
    expect(
      scoreGenerationEval({
        id: "asset-sculpt",
        kind: "asset",
        html: `<canvas></canvas><script>import * as THREE from "./vendor/three.module.js"; reconstructFromPhoto("./source.png");</script>`,
      }),
    ).toMatchObject({ passed: true, reason: "wired" });
  });

  it("gates a written canvas that still fails the scorer at turn end", () => {
    expect(generationQualityNeedsHuman({ kind: "design", html: "" })).toBeUndefined();
    expect(generationQualityNeedsHuman({ kind: "coding", html: "<html></html>" })).toBeUndefined();
    expect(
      generationQualityNeedsHuman({
        kind: "design",
        html: `<!doctype html><html lang="en" data-locus-host-fallback="design"><body><h1>First draft</h1></body></html>`,
      }),
    ).toMatch(/starter draft on this canvas/);
    expect(
      generationQualityNeedsHuman({
        kind: "asset",
        html: `<!doctype html><html lang="en" data-locus-host-fallback="asset"><body><canvas></canvas><script>import * as THREE from "./vendor/three.module.js"; reconstructFromPhoto("./source.png");</script></body></html>`,
      }),
    ).toMatch(/starter draft on this canvas/);
    expect(
      generationQualityNeedsHuman({
        kind: "design",
        html: `<!doctype html><html lang="en"><head><style>:root { --line: color-mix(in srgb, var(--text) 14%, var(--bg)); }</style></head><body><p class="kicker">First draft</p><a class="cta" href="#next">Continue</a></body></html>`,
      }),
    ).toMatch(/starter draft on this canvas/);
    expect(
      generationQualityNeedsHuman({
        kind: "asset",
        html: `<!doctype html><html><body><canvas></canvas><script>function drawPlaceholder(){ ctx.beginPath(); ctx.ellipse(0, 8, 72, 118, 0, 0, Math.PI * 2); } studio.paint = drawPlaceholder; reconstructFromPhoto("./source.png");</script></body></html>`,
      }),
    ).toMatch(/starter draft on this canvas/);
    expect(
      generationQualityNeedsHuman({
        kind: "design",
        html: `<!doctype html><html lang="en"><head><style>:root { --line: color-mix(in srgb, var(--text) 15%, var(--bg)); }</style></head><body><p class="kicker">First draft</p><a class="cta" href="#next">Continue</a></body></html>`,
      }),
    ).toMatch(/starter draft on this canvas/);
    expect(
      generationQualityNeedsHuman({
        kind: "asset",
        html: `<!doctype html><html><body><canvas></canvas><script>function drawPlaceholder(){ ctx.beginPath(); ctx.ellipse(0, 8, 72, 119, 0, 0, Math.PI * 2); } studio.paint = drawPlaceholder; reconstructFromPhoto("./source.png");</script></body></html>`,
      }),
    ).toMatch(/starter draft on this canvas/);
    expect(
      generationQualityNeedsHuman({
        kind: "design",
        html: `<!doctype html><html lang="en"><head><style>:root { --line: color-mix(in srgb, var(--text) 15%, var(--bg)); } main { max-width: 40rem; margin: 0 auto; padding: calc(var(--space) * 8); } .lede { margin: 0 0 calc(var(--space) * 6); } .cta { display: inline-block; padding: calc(var(--space) * 1.5) calc(var(--space) * 3); }</style></head><body><p class="kicker">Draft</p><p class="lede">Hello</p><a class="cta" href="#next">Continue</a></body></html>`,
      }),
    ).toMatch(/starter draft on this canvas/);
    expect(
      generationQualityNeedsHuman({
        kind: "game",
        html: `<!doctype html><html><body><script>window.addEventListener('keydown', () => {}); const hazards = [{x: 421, y: 0}]; function beep(){ new AudioContext(); } ctx.fillRect(x-10, y-20, 20, 20); h.x -= 3 + score * 0.05; if (keys.Space) vy = -f.j * 0.7; if (y > canvas.height - 64) vy = 0; ctx.fillText("Game over — R restart", 24, 80);</script>Score 0<button>Restart</button></body></html>`,
      }),
    ).toMatch(/starter draft on this canvas/);
    expect(
      generationQualityNeedsHuman({
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:Inter,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2)}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      }),
    ).toMatch(/generic AI template/);
    expect(
      generationQualityNeedsHuman({
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><div class="bg-indigo-600"><h1>Press ledger</h1></div></body></html>`,
      }),
    ).toMatch(/generic AI template/);
    expect(
      generationQualityNeedsHuman({
        kind: "design",
        html: `<!doctype html><html><head><style>body{font-family:"Iowan Old Style",serif;background:oklch(0.546 0.245 262.881)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toMatch(/generic AI template/);
    expect(
      generationQualityNeedsHuman({
        kind: "design",
        html: `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:Georgia,serif;background:var(--bg)}</style></head><body><h1>Press ledger</h1></body></html>`,
      }),
    ).toBeUndefined();
    expect(
      generationQualityNeedsHuman({
        kind: "game",
        html: "<html><body>hello</body></html>",
      }),
    ).toMatch(/not playable/);
    expect(
      generationQualityNeedsHuman({
        kind: "game",
        html: "<html><body><script>window.addEventListener('keydown', () => {}); function beep(){ new AudioContext().createOscillator(); }</script>Score 0<button>Restart</button></body></html>",
        assetSlugs: ["knight"],
      }),
    ).toMatch(/never loaded/);
    expect(
      generationQualityNeedsHuman({
        kind: "asset",
        html: `<canvas></canvas><script>import * as THREE from "./vendor/three.module.js"</script>`,
      }),
    ).toMatch(/placeholder/);
    expect(
      generationQualityNeedsHuman({
        kind: "game",
        html: "<html><body><script>window.addEventListener('keydown', () => {}); function beep(){ new AudioContext().createOscillator(); }</script>Score 0<button>Restart</button></body></html>",
      }),
    ).toBeUndefined();
  });

  it("wraps the coding fixture scorer", () => {
    expect(
      scoreGenerationEval({
        id: "fix-add",
        kind: "coding",
        testsRan: true,
        testsOk: true,
        source: "return a + b;",
        expectSource: /a \+ b/,
      }),
    ).toMatchObject({ passed: true, reason: "tests passed" });
  });
});
