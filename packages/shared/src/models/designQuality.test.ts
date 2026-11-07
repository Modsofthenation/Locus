import { describe, expect, it } from "vitest";
import {
  DESIGN_ITERATE_UNCHANGED_NEEDS_HUMAN,
  DESIGN_QUALITY_NUDGE,
  MAX_DESIGN_QUALITY_NUDGES,
  designIterateUnchangedNeedsHuman,
  formatDesignCanvasSnapshot,
  looksGenericDesign,
} from "./designQuality.js";

const SLOP = `<!doctype html><html><head><style>
body { font-family: Inter, sans-serif; background: linear-gradient(135deg, #667eea, #764ba2); }
</style></head><body><h1>Unlock your potential</h1></body></html>`;

const DISTINCT = `<!doctype html><html><head><style>
:root { --bg:#111; --text:#f4f0e8; --primary:#e08; --line:#333; }
body { font-family: "Iowan Old Style", serif; background: var(--bg); color: var(--text); }
</style></head><body><h1>Press ledger</h1></body></html>`;

describe("looksGenericDesign", () => {
  it("flags purple-gradient Inter landings, CDNs, and mouse-tracking", () => {
    expect(looksGenericDesign(SLOP)).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"></head><body>Hi</body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><script src="https://cdn.tailwindcss.com"></script></head><body>Hi</body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body><script>window.addEventListener("mousemove", (e) => { hero.style.transform = "translate3d(" + e.clientX + "px,0,0)"; });</script></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Geist,sans-serif}</style></head><body><div class="bg-gradient-to-br from-indigo-500 to-purple-600">Hi</div></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Outfit,sans-serif;background:#667eea}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Inter,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Inter,sans-serif}</style></head><body><div class="bg-gradient-to-r from-blue-500">Hi</div></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Inter,sans-serif}</style></head><body><div class="bg-indigo-600">Hi</div></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Geist,sans-serif}</style></head><body><button class="bg-blue-600">Go</button></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Outfit,sans-serif}</style></head><body><h1 class="text-violet-500">Hi</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><div class="bg-indigo-600">Hi</div></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><h1 class="text-violet-500">Hi</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><button class="bg-blue-600">Go</button></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:linear-gradient(135deg,#667eea,#764ba2)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(`<html><body><div class="bg-indigo-600">Hi</div></body></html>`),
    ).toBe(true);
    expect(looksGenericDesign(`<html><body><div class="bg-indigo">Hi</div></body></html>`)).toBe(
      true,
    );
    expect(looksGenericDesign(`<html><body><div class="text-violet">Hi</div></body></html>`)).toBe(
      true,
    );
    expect(looksGenericDesign(`<html><body><div class="bg-blue">Hi</div></body></html>`)).toBe(
      true,
    );
    expect(looksGenericDesign(`<html><body><div class="bg-indigo/80">Hi</div></body></html>`)).toBe(
      true,
    );
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:rgb(79, 70, 229)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:rgb(79 70 229)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:rgb(38.8% 40% 94.5%)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:rgba(38.8%, 40%, 94.5%, 0.9)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:rgb(88% 54% 30%)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:hsl(239, 84%, 67%)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:hsl(239.1 84.2 66.7)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:hsl(30 40 40)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:oklch(0.546 0.245 262.881)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:oklch(54.6% 0.245 262.88)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:oklch(0.63 0.15 45)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:hwb(239 39% 5%)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:hwb(239 39 5)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(hwb 239 39 5)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:hwb(25 30% 12%)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:lch(50.1 80.4 298.8)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:lch(65.4 53.7 59.4)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:lab(50.1 38.7 -70.5)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:lab(65.4 27.4 46.2)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:oklab(0.546 -0.030 -0.243)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:oklab(0.63 0.106 0.106)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:hsl(0.664turn 84% 67%)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(display-p3 0.3904 0.3996 0.9126)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(display-p3 0.39 0.40 0.94)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(srgb 0.388 0.400 0.945)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(srgb 39% 40% 94%)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(display-p3 0.8313 0.5568 0.344)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(rec2020 0.3828 0.3557 0.8958)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(rec2020 0.388 0.400 0.945)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(a98-rgb 0.3914 0.3994 0.9282)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(xyz 0.2577 0.1851 0.8544)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(xyz-d65 0.2577 0.1851 0.8544)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(prophoto-rgb 0.4458 0.3525 0.8704)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(prophoto-rgb 0.388 0.400 0.945)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(xyz-d50 0.2314 0.1763 0.6428)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(xyz-d50 0.2577 0.1851 0.8544)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(xyz 0.2314 0.1763 0.6428)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(rec2020 0.708 0.5283 0.3229)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(rec2020 0.2704 0.3615 0.85)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(prophoto-rgb 0.3674 0.3507 0.8217)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(prophoto-rgb 0.6718 0.5098 0.2859)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(oklch 0.546 0.245 262.881)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(oklab 0.546 -0.030 -0.243)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(lch 50.1 80.4 298.8)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(lab 50.1 38.7 -70.5)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(hwb 239 39% 5%)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(oklch 0.63 0.15 45)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:color(xyz-d50 0.1741 0.1555 0.5795)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:indigo}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:purple}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:violet}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:fuchsia}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:magenta}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:darkviolet}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>:root{--primary:purple}body{font-family:"Iowan Old Style",serif;color:var(--primary)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><div class="bg-[violet]"><h1>Press ledger</h1></div></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><svg><rect fill="purple" width="8" height="8"/></svg><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>:root{--primary:rebeccapurple}body{font-family:"Iowan Old Style",serif;color:var(--primary)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;border:1px solid blue}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;border-top:1px solid indigo}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;outline:2px solid indigo}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;text-shadow:0 0 8px indigo}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background-image:radial-gradient(circle, indigo, #111)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><div class="bg-[indigo]"><h1>Press ledger</h1></div></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><h1 class="text-[rebeccapurple]">Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><svg><rect fill="indigo" width="8" height="8"/></svg><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Indigo Antique",serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:#6366f1ff}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:#3b82f680}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><h1>Note: indigo dye on the press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Purple Press",serif;background:#111;color:#f4f0e8}</style></head><body><h1>Violet ink on the press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:navy}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:darkblue}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;color:midnightblue}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><div class="bg-[navy]"><h1>Press ledger</h1></div></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif}</style></head><body><svg><rect fill="navy" width="8" height="8"/></svg><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>:root{--navy-600:#1F2937}body{font-family:"Iowan Old Style",serif;background:#111;color:var(--navy-600)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Navy Press",serif;background:#111;color:#f4f0e8}</style></head><body><h1>Editorial cream with navy ink</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:rgb(224, 138, 76)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Playfair Display",serif;background:#F4F1EA;color:#C45C26}</style></head><body><h1>Elevate your workflow</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Georgia,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Instrument Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Sora,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Urbanist,sans-serif;background:linear-gradient(#111,#222)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Urbanist,sans-serif;background:radial-gradient(#111,#222)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Urbanist,sans-serif;background:conic-gradient(#111,#222)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font:16px "Instrument Sans",sans-serif;background:radial-gradient(#111,#222)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",serif;background:radial-gradient(#111,#222)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Instrument Sans",sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font:16px/1.4 "Instrument Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font:600 18px Georgia,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font:16px sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font:16px/1.4 "Instrument Sans",sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font:16px "Iowan Old Style",serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><body class="font-sans"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Inter]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Instrument_Sans']"><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>:root{--font-sans:Inter,sans-serif}body{font-family:var(--font-sans);background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(`<html><body class="font-sans"><h1>Press ledger</h1></body></html>`),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>:root{--font-sans:"Iowan Old Style",serif}body{font-family:var(--font-sans);background:#111;color:#f4f0e8}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Syne,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Fraunces,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Bricolage Grotesque",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"General Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Clash Display",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Reckless,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Canela,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Editorial New",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"GT America",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"ABC Diatype",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Newsreader,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Boska,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Reckless,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Favorit,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Söhne",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Array,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Picture,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Favorit,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Neue Haas Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"ABC Social",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"PP Neue Montreal",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"PP Mori",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Neue Montreal",sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"PP Right Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"ABC ROM",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"PP Agrandir",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"ABC Ginto",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"GT Alpina",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"PP Right Grotesk",sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Graphik,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Suisse Intl",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Founders Grotesk",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Apercu,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Gotham,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Graphik,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Circular,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Maison Neue",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Aktiv Grotesk",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Futura,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"SF Pro",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Circular,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Lato,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Raleway,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Barlow,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Noto Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Calibri,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Garamond,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Ubuntu,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Lato]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Didot,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Bodoni Moda",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"DIN Next",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Lexend,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Atkinson Hyperlegible",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Baskerville,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Didot]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Lato,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Didot,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Caslon,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Goudy Old Style",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Minion,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Crimson Text",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"DM Serif Display",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['DM_Serif_Display']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Caslon,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Iowan Old Style",Palatino,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Bebas Neue",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Cooper Black",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Clarendon,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Anton,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Abril Fatface",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Bebas_Neue']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Bebas Neue",sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Comfortaa,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Quicksand,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Exo,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Be Vietnam Pro",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Comfortaa]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Comfortaa,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Sentinel,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Freight Text",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Chronicle,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Whitney,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Ideal Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Sentinel]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Sentinel,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Verlag,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Operator Mono",monospace;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Verlag]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Verlag,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Idlewild,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Knockout,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Hoefler Text",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Surveyor,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Decimal,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Idlewild]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Idlewild,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Knockouting,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Decimalize,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Retinal,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Calibre,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Metric,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Untitled Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:National,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Domaine,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Calibre]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Untitled_Sans']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Calibre,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Calibrete,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Metricize,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Nationalize,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Pitching,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Styrene,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Publico,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Lyon,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Styrene]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Styrene,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Lyonel,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Duplicated,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Featuring,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Gill Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Myriad,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Myriad Pro",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Acumin,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Optima,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Interstate,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Gill_Sans']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Gill Sans",sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Universe,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Optimal,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Myriads,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Acuminate,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Trajan,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Comic Sans MS",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Cambria,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Century Gothic",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Trajan]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Trajan,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Trajanic,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Papayrus,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Menlo,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Monaco,monospace;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Consolas,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Courier New",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Space Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"JetBrains Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Inconsolata,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Fira Code",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Menlo]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Menlo,monospace;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Menlough,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Monacan,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Couriered,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"PP Object Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"PP Telegraf",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Warnock,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Kepler,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Chaparral,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Warnock]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Warnock,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Warnocked,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Keplerian,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"SF Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Cascadia Code",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Andale Mono",monospace;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Anonymous Pro",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Cascadia_Code']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Cascadia Code",monospace;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Cascadian,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Anonymous,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Input Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Dank Mono",monospace;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Berkeley Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Commit Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Iosevka,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Hack,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Input_Mono']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Input Mono",monospace;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Input,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Hacking,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Clash Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Monaspace Neon",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Recursive,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Intel One Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Clash_Grotesk']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Clash Grotesk",sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Recursion,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Monaspaced,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Charter,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"New York",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"PP Hatton",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"PP Kyoto",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"GT Sectra",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Charter]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Charter,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Chartered,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"New Yorker",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"GT Pressura",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Miller,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Escrow,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"SF Compact",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"San Francisco",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Miller]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Miller,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Millered,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Escrowing,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Mona Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Hubot Sans",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Inclusive Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Product Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Aeonik,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Familjen Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Darker Grotesque",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Mona_Sans']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Mona Sans",sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Monastic,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Aeoniks,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"TWK Everett",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"TWK Lausanne",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Saans,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Roobert,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Suisse Works",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"ABC Oracle",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['TWK_Everett']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"TWK Everett",sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Everetting,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Saansel,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Spectral,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Literata,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Cinzel,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Prata,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Departure Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"GT Cinetype",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Benton Sans",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Spectral]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Spectral,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Spectrally,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Cinzella,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Yeseva One",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"PP Supply Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"PP Fraktion",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Fredoka,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Righteous,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Unica77,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Haas Unica",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Yeseva_One']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Yeseva One",serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Yesevan,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Righteousness,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Obviously,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Vulf Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Vulf Mono",monospace;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Cheee,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Matter,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Hobeaux,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Vulf_Sans']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Vulf Sans",sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Obvious,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Matterhorn,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Degular,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Blazeface,cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Ohno Blazeface",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Occidens,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Perfectly Nineties",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Mabry,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Lobster,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Dancing Script",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Great Vibes",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"DM Serif Text",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Perfectly_Nineties']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Degular,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Degularity,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Occidental,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Orbitron,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Teko,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Audiowide,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Bungee,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Permanent Marker",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Caveat,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Sacramento,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Josefin Slab",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Orbitron]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Orbitron,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Tektronix,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Orbital,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Young Serif",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Gloock,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Italiana,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Vollkorn,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Zilla Slab",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Arvo,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Titillium Web",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Fortescue,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Young_Serif']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Young Serif",serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Italian,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Gloocked,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Copperplate,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Rockwell,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Rajdhani,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Sanomat,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Dala Floda",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Nichrome,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Tartuffo,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Antique Olive",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Copperplate]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Copperplate,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Copperplated,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Antique,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Fjalla One",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Francois One",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Alata,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Chivo,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Heebo,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Kanit,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Prompt,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Overpass,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Asap,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Catamaran,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Heebo]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Heebo,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Fjall,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Prompted,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Assistant,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Skolar,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Recife,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Mukta,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Hind,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Chakra Petch",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:VT323,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Press Start 2P",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Assistant]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Assistant,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Assist,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Hindustan,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Oxygen,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Dosis,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Yanone Kaffeesatz",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Varela Round",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Signika,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Maven Pro",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"League Spartan",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Spline Sans",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Hanken Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Oxygen]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['League_Spartan']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Oxygen,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Oxygened,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:League,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Alegreya,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Alegreya Sans",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Akzidenz Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Theinhardt,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Scto Grotesk",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"PP Mondwest",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Arimo,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Tinos,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Cousine,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Pathway Gothic One",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Alegreya]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Akzidenz_Grotesk']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Alegreya,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Akzidenz,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Theinhardted,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Electrolize,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"FF Meta",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Liberation Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Nimbus Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Michroma,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Pixelify Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Silkscreen,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Old Standard TT",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"News Cycle",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Ropa Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Poiret One",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Electrolize]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Liberation_Sans']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Electrolize,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Electrolized,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Meta,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Indie Flower",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Cuprum,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Petrona,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Julius Sans One",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Tenor Sans",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Bangers,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Amatic SC",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Special Elite",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Rokkitt,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Crete Round",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Kaushan Script",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Patrick Hand",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Indie_Flower']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Cuprum]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Indie Flower",cursive;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Indie,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Banger,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Kalam,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Shadows Into Light",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Lustria,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Slabo 27px",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Architects Daughter",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Courgette,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Luckiest Guy",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Russo One",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Volkhov,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Neuton,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Droid Sans",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Kalam]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Shadows_Into_Light']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Kalam,cursive;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Shadows,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Droid,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Staatliches,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Black Ops One",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Lilita One",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Passion One",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Fugaz One",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Titan One",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Bowlby One",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Bowlby One SC",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Squada One",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Monoton,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Homemade Apple",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Allura,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Yellowtail,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Staatliches]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Black_Ops_One']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Staatliches,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Staat,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Black,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Lilita,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Passion,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Homemade,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Cairo,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Readex Pro",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Philosopher,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Aleo,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Alex Brush",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"El Messiri",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Frank Ruhl Libre",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Bellefair,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Cutive,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Cutive Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"IM Fell English",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Sarabun,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Tajawal,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Cairo]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Readex_Pro']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Cairo,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Readex,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Alex,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Frank,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Nanum Gothic",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Zen Kaku Gothic New",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Zen Maru Gothic",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Nanum Myeongjo",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Gothic A1",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Black Han Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Almarai,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Changa,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Reem Kufi",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Amiri,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Secular One",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Sawarabi Gothic",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:DotGothic16,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Nanum_Gothic']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Almarai]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Nanum Gothic",sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Zen,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Nanum,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Gothic,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Secular,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Reem,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Tangerine,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Pinyon Script",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Parisienne,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Grand Hotel",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Oleo Script",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Oleo Script Swash Caps",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Yesteryear,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Niramit,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Bai Jamjuree",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Itim,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Marck Script",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Clicker Script",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Arizonia,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Tangerine]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Pinyon_Script']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Tangerine,cursive;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Pinyon,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Grand,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Oleo,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Bai,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Clicker,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:K2D,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Kosugi,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Kosugi Maru",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Kodchasan,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Mitr,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Pridi,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Sriracha,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Thasadith,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Charm,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Charmonman,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Pattaya,cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Taviraj,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Trirong,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Chonburi,cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Reenie Beanie",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Coming Soon",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Covered By Your Grace",cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Just Another Hand",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Schoolbell,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Creepster,cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Pirata One",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"RocknRoll One",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Lalezar,cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Harmattan,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Lemonada,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Lateef,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Press Start",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Scheherazade New",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Scheherazade,serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Suez One",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"David Libre",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Miriam Libre",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Katibeh,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Markazi Text",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Aref Ruqaa",serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Aref Ruqaa Ink",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Jomhuria,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Rakkas,cursive;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Qahiri,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Noto Naskh Arabic",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Noto Kufi Arabic",sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Scheherazade_New']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Katibeh]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[K2D]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Kosugi_Maru']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-[Creepster]"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><body class="font-['Reenie_Beanie']"><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Reenie Beanie",cursive;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Reenie,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Coming,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Covered,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Just,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:School,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Creep,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Pirata,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:RocknRoll,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Lemon,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Late,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Press,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Scheherazade New",serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Suez,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:David,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Miriam,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Katib,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Markazi,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Aref,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Jomhur,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Rakka,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Qahir,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Noto,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:"Noto Color Emoji",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:K2D,sans-serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Mitre,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Charming,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Patta,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:K2,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Fraunces,serif;background:#111;color:#f4f0e8}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:system-ui,sans-serif;background:#fff}</style></head><body><h1>Empower your teams</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Arial,Helvetica,sans-serif}</style></head><body><h1>Transform your workflow</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:Georgia,serif;background:#fff}</style></head><body><h1>Supercharge your workflow</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksGenericDesign(
        `<html><head><style>body{font-family:sans-serif;background:linear-gradient(#111,#222)}</style></head><body><h1>Press ledger</h1></body></html>`,
      ),
    ).toBe(true);
    expect(looksGenericDesign(DISTINCT)).toBe(false);
    expect(looksGenericDesign("<html><body><h1>One-pager</h1></body></html>")).toBe(false);
    expect(looksGenericDesign("")).toBe(false);
    expect(DESIGN_QUALITY_NUDGE).toMatch(/generic AI template/);
    expect(DESIGN_QUALITY_NUDGE).toMatch(/purple\/indigo\/violet/);
    expect(DESIGN_QUALITY_NUDGE).toMatch(
      /rgb, hsl, hwb, lab, lch, oklch, color\(\), named CSS colors/,
    );
    expect(DESIGN_QUALITY_NUDGE).toMatch(/Geist\/Outfit/);
    expect(DESIGN_QUALITY_NUDGE).toMatch(/Instrument\/Sora\/Urbanist/);
    expect(DESIGN_QUALITY_NUDGE).toMatch(/Syne\/Fraunces\/Clash Display/);
    expect(DESIGN_QUALITY_NUDGE).toMatch(/Reckless\/Canela\/Editorial New/);
    expect(DESIGN_QUALITY_NUDGE).toMatch(/Favorit/);
    expect(DESIGN_QUALITY_NUDGE).toMatch(
      /Neue Haas\/PP Neue Montreal\/PP Right Grotesk\/Graphik\/Circular\/Lato\/Didot\/Caslon\/Bebas Neue\/Comfortaa\/Sentinel\/Verlag\/Idlewild\/Calibre\/Styrene\/Gill Sans\/Trajan\/Menlo\/Warnock\/Cascadia\/Input Mono\/Clash Grotesk\/Charter\/Miller\/Mona\/Everett\/Spectral\/Yeseva\/Vulf\/Degular\/Orbitron\/Young Serif\/Copperplate\/Heebo\/Assistant\/Oxygen\/Alegreya\/Electrolize\/Indie Flower\/Kalam\/Staatliches\/Cairo\/Nanum\/Tangerine\/K2D\/Reenie\/Scheherazade/,
    );
    expect(DESIGN_QUALITY_NUDGE).toMatch(/--font-sans/);
    expect(DESIGN_QUALITY_NUDGE).toMatch(/Tailwind font-sans/);
    expect(DESIGN_QUALITY_NUDGE).toMatch(/Georgia\/Arial\/system-ui/);
    expect(DESIGN_QUALITY_NUDGE).toMatch(/supercharge/);
    expect(MAX_DESIGN_QUALITY_NUDGES).toBe(2);
  });
});

describe("designIterateUnchangedNeedsHuman", () => {
  it("gates a change ask that never patched, and skips questions and acks", () => {
    expect(
      designIterateUnchangedNeedsHuman({
        userText: "make the headline bolder",
        html: DISTINCT,
        turnStartHtml: DISTINCT,
      }),
    ).toBe(DESIGN_ITERATE_UNCHANGED_NEEDS_HUMAN);
    expect(
      designIterateUnchangedNeedsHuman({
        userText: "make the headline bolder",
        html: `${DISTINCT}<span>night</span>`,
        turnStartHtml: DISTINCT,
      }),
    ).toBeUndefined();
    expect(
      designIterateUnchangedNeedsHuman({
        userText: "how does this layout work?",
        html: DISTINCT,
        turnStartHtml: DISTINCT,
      }),
    ).toBeUndefined();
    expect(
      designIterateUnchangedNeedsHuman({
        userText: "looks good",
        html: DISTINCT,
        turnStartHtml: DISTINCT,
      }),
    ).toBeUndefined();
    expect(
      designIterateUnchangedNeedsHuman({
        userText: "make the headline bolder",
        html: DISTINCT,
        turnStartHtml: "",
      }),
    ).toBeUndefined();
  });
});

describe("formatDesignCanvasSnapshot", () => {
  it("summarizes type, tokens, and generic fingerprints without dumping the page", () => {
    const snap = formatDesignCanvasSnapshot(DISTINCT);
    expect(snap).toMatch(/Design canvas snapshot/);
    expect(snap).toMatch(/index\.html \d+ bytes/);
    expect(snap).toMatch(/<\/html> yes/);
    expect(snap).toMatch(/headline: Press ledger/);
    expect(snap).toMatch(/Iowan Old Style/);
    expect(snap).toMatch(/tokens: --bg --text --primary --line/);
    expect(snap).toMatch(/CDN: no/);
    expect(snap).toMatch(/generic template: no/);
    expect(snap).toMatch(/host fallback: no/);
    expect(snap).toMatch(/Patch index\.html in place/);
    expect(snap).toMatch(/Call playwright/);
    expect(snap).not.toContain("background: var(--bg)");
    const empty = formatDesignCanvasSnapshot("");
    expect(empty).toMatch(/<\/html> NO/);
    expect(empty).toMatch(/tokens: missing/);
    expect(empty).toMatch(/Write a complete self-contained HTML document/);
    expect(formatDesignCanvasSnapshot(SLOP)).toMatch(/generic template: yes/);
    expect(
      formatDesignCanvasSnapshot(
        `<!doctype html><html lang="en" data-locus-host-fallback="design"><body><h1>First draft</h1></body></html>`,
      ),
    ).toMatch(/host fallback: yes/);
    expect(
      formatDesignCanvasSnapshot(
        `<!doctype html><html lang="en"><head><style>:root { --line: color-mix(in srgb, var(--text) 14%, var(--bg)); }</style></head><body><p class="kicker">First draft</p><a class="cta" href="#next">Continue</a></body></html>`,
      ),
    ).toMatch(/host fallback: yes/);
    expect(
      formatDesignCanvasSnapshot(
        `<!doctype html><html lang="en"><head><style>:root { --line: color-mix(in srgb, var(--text) 15%, var(--bg)); }</style></head><body><p class="kicker">First draft</p><a class="cta" href="#next">Continue</a></body></html>`,
      ),
    ).toMatch(/host fallback: yes/);
    expect(
      formatDesignCanvasSnapshot(
        `<!doctype html><html lang="en"><head><style>:root { --line: color-mix(in srgb, var(--text) 15%, var(--bg)); } main { max-width: 40rem; margin: 0 auto; padding: calc(var(--space) * 8); } .lede { margin: 0 0 calc(var(--space) * 6); } .cta { display: inline-block; padding: calc(var(--space) * 1.5) calc(var(--space) * 3); }</style></head><body><p class="kicker">Draft</p><a class="cta" href="#next">Continue</a></body></html>`,
      ),
    ).toMatch(/host fallback: yes/);
  });
});
