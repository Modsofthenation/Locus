import { describe, expect, it } from "vitest";
import {
  ADHERENCE_NUDGE_PREFIX,
  MAX_ADHERENCE_NUDGES,
  collectTokenAllowlist,
  enforceDesignAdherence,
  formatAdherenceNudge,
  formatTokenAllowlistPrompt,
  isAdherenceNudge,
  designAdherenceNeedsHuman,
  DESIGN_ADHERENCE_NEEDS_HUMAN,
} from "./models/designAdherence.js";

const PALETTE = {
  bg: "#f9fafb",
  surface: "#ebecee",
  text: "#1f2a37",
  muted: "#6b7280",
  primary: "#196be6",
  accent: "#1f2937",
};

describe("design adherence", () => {
  it("strips Google Fonts, injects :root vars, and maps known hex", () => {
    const html = `<html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<style>
:root { --primary-600: #196BE6; }
.hero { color: #196BE6; }
.card { background: var(--surface); padding: 16px; }
</style>
</head><body><article class="card">Hi</article></body></html>`;
    const result = enforceDesignAdherence(html, {
      kit: true,
      palette: PALETTE,
      tokenCss: "  --radius: 8px;\n  --space: 4px;\n  --line: gray;",
      tokens: [{ name: "primary-600", value: "#196BE6" }],
    });
    expect(result.patched).toBe(true);
    expect(result.html).not.toMatch(/fonts\.googleapis/);
    expect(result.html).toContain("--bg:");
    expect(result.html).toContain("--line:");
    expect(result.html).toContain("color: var(--primary-600)");
    expect(result.html).toMatch(/\.card[\s\S]*background: var\(--bg\)/);
    expect(result.issues.filter((issue) => issue.code === "cdn")).toEqual([]);
    expect(result.issues.filter((issue) => issue.code === "hex")).toEqual([]);
  });

  it("injects required :root vars on a bare draft and does not nudge", () => {
    const result = enforceDesignAdherence("<html><body><h1>Hi</h1></body></html>", {
      palette: PALETTE,
    });
    expect(result.patched).toBe(true);
    expect(result.html).toContain("--bg:");
    expect(result.html).toContain("--line:");
    expect(result.issues).toEqual([]);
  });

  it("does not rewrite a canvas that already has the required vars", () => {
    const html = `<html><head><style>:root {
      --bg:#fff; --surface:#eee; --text:#111; --muted:#888; --primary:#00f; --accent:#0af; --line: gray;
    }</style></head><body><h1>Hi</h1></body></html>`;
    const result = enforceDesignAdherence(html, { palette: PALETTE });
    expect(result.patched).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it("leaves leftover issues for a nudge when hex cannot be mapped", () => {
    const html = `<html><head><style>.x { color: #ff00aa; }</style></head><body></body></html>`;
    const result = enforceDesignAdherence(html, { kit: true, palette: PALETTE });
    expect(result.issues.some((issue) => issue.code === "hex")).toBe(true);
    expect(formatAdherenceNudge(result.issues)).toContain(ADHERENCE_NUDGE_PREFIX);
    expect(isAdherenceNudge(formatAdherenceNudge(result.issues))).toBe(true);
    expect(designAdherenceNeedsHuman(result.issues)).toBe(DESIGN_ADHERENCE_NEEDS_HUMAN);
    expect(designAdherenceNeedsHuman([])).toBeUndefined();
    expect(MAX_ADHERENCE_NUDGES).toBe(2);
  });

  it("strips script CDN tags and ajax Google APIs links", () => {
    const html = `<html><head>
<link rel="stylesheet" href="https://ajax.googleapis.com/ajax/libs/jqueryui/1.12.1/themes/smoothness/jquery-ui.css">
<script src="https://cdn.jsdelivr.net/npm/foo.js"></script>
<style>:root { --bg:#fff; --surface:#eee; --text:#111; --muted:#888; --primary:#00f; --accent:#0af; --line: gray; }</style>
</head><body></body></html>`;
    const result = enforceDesignAdherence(html, { kit: true, palette: PALETTE });
    expect(result.html).not.toMatch(/cdn\.jsdelivr/);
    expect(result.html).not.toMatch(/ajax\.googleapis/);
    expect(result.issues.filter((issue) => issue.code === "cdn")).toEqual([]);
  });

  it("does not treat a background image url as a font failure", () => {
    const html = `<html><head><style>
:root { --bg:#fff; --surface:#eee; --text:#111; --muted:#888; --primary:#00f; --accent:#0af; --line: gray; }
.hero { background: url(https://example.com/hero.jpg); }
@font-face { font-family: Inter; src: url("/fonts/inter.woff2"); }
</style></head><body></body></html>`;
    const result = enforceDesignAdherence(html, { kit: true, palette: PALETTE });
    expect(result.issues.filter((issue) => issue.code === "fonts")).toEqual([]);
    expect(result.issues.filter((issue) => issue.code === "cdn")).toEqual([]);
  });

  it("flags remote @font-face urls", () => {
    const html = `<html><head><style>
:root { --bg:#fff; --surface:#eee; --text:#111; --muted:#888; --primary:#00f; --accent:#0af; --line: gray; }
@font-face { font-family: Inter; src: url("https://fonts.gstatic.com/s/inter.woff2"); }
</style></head><body></body></html>`;
    const result = enforceDesignAdherence(html, { kit: true, palette: PALETTE });
    expect(result.issues.some((issue) => issue.code === "fonts")).toBe(true);
  });

  it("does not rewrite .my-article surface fills as cards", () => {
    const html = `<html><head><style>
:root { --bg:#fff; --surface:#eee; --text:#111; --muted:#888; --primary:#00f; --accent:#0af; --line: gray; }
.my-article { background: var(--surface); }
article.card { background: var(--surface); }
</style></head><body></body></html>`;
    const result = enforceDesignAdherence(html, { kit: true, palette: PALETTE });
    expect(result.html).toMatch(/\.my-article[\s\S]*?background: var\(--surface\)/);
    expect(result.html).toMatch(/article\.card[\s\S]*?background: var\(--bg\)/);
    expect(result.issues.filter((issue) => issue.code === "surface-card")).toEqual([]);
  });

  it("still restyles div.card surface fills", () => {
    const html = `<html><head><style>
:root { --bg:#fff; --surface:#eee; --text:#111; --muted:#888; --primary:#00f; --accent:#0af; --line: gray; }
div.card { background: var(--surface); }
</style></head><body></body></html>`;
    const result = enforceDesignAdherence(html, { kit: true, palette: PALETTE });
    expect(result.html).toMatch(/div\.card[\s\S]*?background: var\(--bg\)/);
  });

  it("builds a capped token allowlist for the prompt", () => {
    const tokens = collectTokenAllowlist({
      "primary-600": "#196BE6",
      "copy-800": "#1F2A37",
      sans: "Inter, sans-serif",
      "unused-long": "x".repeat(200),
    });
    expect(tokens.map((token) => token.name)).toEqual(["copy-800", "primary-600", "sans"]);
    const prompt = formatTokenAllowlistPrompt(tokens);
    expect(prompt).toMatch(/--primary-600: #196BE6/);
    expect(prompt).toMatch(/Do not invent hex/);
  });
});
