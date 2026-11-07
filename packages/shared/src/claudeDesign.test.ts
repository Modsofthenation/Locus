import { describe, expect, it } from "vitest";
import {
  canonicalKitRel,
  extractClaudeDesignDraft,
  isClaudeDesignManifest,
  isDesignKitPath,
  isSkippedZipImportPath,
  kitImportRank,
  nameFromClaudeNamespace,
  paletteFromTokenVars,
  skillFromKitFile,
  startingPointsFromKitPaths,
  zipImportRank,
} from "./models/claudeDesign.js";
import {
  extractDesignSystemDraft,
  extractDesignSystemDraftFromFiles,
} from "./models/designSystem.js";
import { parseDesignPalette } from "./models/designPalette.js";

const FRONTYARD_MANIFEST = {
  namespace: "Frontyard_978eb3",
  components: [],
  startingPoints: [{ title: "Open tickets" }, { name: "Live promotions" }],
  cards: [
    { path: "foundations/colors.html", group: "Colors" },
    { path: "components/buttons.html", group: "Components" },
    { path: "foundations/spacing-radius-z.html", group: "Spacing" },
    { path: "foundations/typography.html", group: "Type" },
  ],
  templates: [],
  hasThumbnailHtml: false,
  globalCssPaths: [],
  tokens: [],
  themes: [],
  fonts: [],
  brandFonts: [],
  source: "spa",
};

const FRONTYARD_COLORS_HTML = `<!doctype html>
<html>
<head>
<style>
:root {
  --primary-50: #F4F8FE;
  --primary-100: #E8F0FC;
  --primary-200: #D1E1FA;
  --primary-300: #A3C4F5;
  --primary-400: #75A6F0;
  --primary-500: #4789EB;
  --primary-600: #196BE6;
  --primary-700: #1456B8;
  --primary-800: #0F408A;
  --primary-900: #0A2B5C;
  --copy-50: #F9FAFB;
  --copy-100: #EBECEE;
  --copy-200: #D7D9DC;
  --copy-300: #AFB3B9;
  --copy-400: #9CA3AF;
  --copy-500: #6B7280;
  --copy-600: #374151;
  --copy-700: #2C3441;
  --copy-800: #1F2A37;
  --copy-900: #111928;
  --navy-50: #F3F4F5;
  --navy-100: #E9EAEB;
  --navy-200: #D2D4D7;
  --navy-300: #A5A9AF;
  --navy-400: #797F87;
  --navy-500: #4C545F;
  --navy-600: #1F2937;
  --navy-700: #19212C;
  --navy-800: #0F141A;
  --navy-900: #0C1016;
  --sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  --radius: 8px;
}
</style>
</head>
<body>
  <script src="../_ds_bundle.js"></script>
  <script>const { Button } = window.Frontyard_978eb3;</script>
  <p>Canonical action color is <code>--primary-600</code> #196BE6. Primary text is <code>--copy-800</code>.</p>
</body>
</html>
`;

const FRONTYARD_SPEC = `
# Frontyard
Namespace: Frontyard_978eb3

| Step | Hex Value | Usage | CSS Variable |
|------|-----------|-------|--------------|
| 50 | #F9FAFB | Lightest background | \`--copy-50\` |
| 100 | #EBECEE | Very light background | \`--copy-100\` |
| 500 | #6B7280 | Tertiary text, labels | \`--copy-500\` |
| 800 | #1F2A37 | **Primary text** | \`--copy-800\` |
| 600 | #196BE6 | **Canonical action color** | \`--primary-600\` |
| 600 | #1F2937 | UI chrome | \`--navy-600\` |
`;

describe("Claude Design import", () => {
  it("detects a Claude Design SPA manifest", () => {
    expect(isClaudeDesignManifest(FRONTYARD_MANIFEST)).toBe(true);
    expect(nameFromClaudeNamespace("Frontyard_978eb3")).toBe("Frontyard");
    expect(
      isClaudeDesignManifest({ format: "locus.design-system", namespace: "Nope_aaaaaa" }),
    ).toBe(false);
    expect(
      extractClaudeDesignDraft(JSON.stringify(FRONTYARD_MANIFEST), "_ds_manifest.json"),
    ).toBeUndefined();
  });

  it("maps Frontyard foundation HTML onto the Locus palette", () => {
    const draft = extractDesignSystemDraft(FRONTYARD_COLORS_HTML, "colors.html");
    expect(draft?.name).toBe("Frontyard");
    expect(draft?.palette).toEqual({
      bg: "#f9fafb",
      surface: "#ebecee",
      text: "#1f2a37",
      muted: "#6b7280",
      primary: "#196be6",
      accent: "#1f2937",
    });
    expect(draft?.typography?.sans).toMatch(/^Inter,/);
    expect(draft?.radiusPx).toBe(8);
    expect(draft?.spacePx).toBe(4);
  });

  it("joins a Claude Design folder: manifest plus foundations HTML", () => {
    const draft = extractDesignSystemDraftFromFiles(
      [
        { name: "frontyard/_ds_manifest.json", text: JSON.stringify(FRONTYARD_MANIFEST) },
        { name: "frontyard/foundations/colors.html", text: FRONTYARD_COLORS_HTML },
        { name: "frontyard/components/buttons.html", text: "<p>Button reference</p>" },
      ],
      "frontyard.zip",
    );
    expect(draft?.name).toBe("Frontyard");
    expect(draft?.summary).toMatch(/Claude Design SPA/);
    expect(parseDesignPalette(draft?.palette)?.primary).toBe("#196be6");
    expect(draft?.guidelines).toMatch(/Frontyard_978eb3/);
    expect(draft?.guidelines).toMatch(/buttons/);
    expect(draft?.guidelines).toMatch(/Starting points: Open tickets/);
    expect(draft?.guidelines).toMatch(/hairline borders/);
    expect(draft?.startingPoints?.map((row) => row.title)).toEqual(
      expect.arrayContaining(["Open tickets", "Live promotions"]),
    );
    expect(draft?.startingPoints?.[0]?.title).toBe("Open tickets");
    expect(draft?.tokens?.some((token) => token.name === "primary-600")).toBe(true);
  });

  it("reads populated manifest tokens without HTML", () => {
    const draft = extractClaudeDesignDraft(
      JSON.stringify({
        ...FRONTYARD_MANIFEST,
        tokens: [
          { name: "--copy-50", value: "#F9FAFB", kind: "color" },
          { name: "--copy-100", value: "#EBECEE", kind: "color" },
          { name: "--copy-500", value: "#6B7280", kind: "color" },
          { name: "--copy-800", value: "#1F2A37", kind: "color" },
          { name: "--primary-600", value: "#196BE6", kind: "color" },
          { name: "--navy-600", value: "#1F2937", kind: "color" },
        ],
        fonts: [{ family: "Inter" }],
      }),
      "_ds_manifest.json",
    );
    expect(draft?.name).toBe("Frontyard");
    expect(parseDesignPalette(draft?.palette)?.primary).toBe("#196be6");
    expect(draft?.typography?.sans).toMatch(/^Inter,/);
  });

  it("does not fall back to the lightest scale step for primary", () => {
    expect(
      paletteFromTokenVars({ "primary-50": "#FFFFFF", "copy-50": "#FAFAFA", "copy-800": "#111111" })
        ?.primary,
    ).toBeUndefined();
    const draft = extractDesignSystemDraft(
      `:root { --primary-50: #FFFFFF; --copy-50: #FAFAFA; --copy-100: #F0F0F0; --copy-500: #888888; --copy-800: #111111; }`,
      "tokens.css",
    );
    expect(parseDesignPalette(draft?.palette)?.primary).not.toBe("#ffffff");
  });

  it("pulls token/hex pairs out of a Claude Design spec markdown table", () => {
    const draft = extractDesignSystemDraft(FRONTYARD_SPEC, "frontyard.md");
    const palette = parseDesignPalette(draft?.palette);
    expect(palette?.primary).toBe("#196be6");
    expect(palette?.text).toBe("#1f2a37");
    expect(palette?.bg).toBe("#f9fafb");
    expect(draft?.name).toBe("Frontyard");
  });

  it("joins a Claude Design kit: root CSS, preview HTML, skill tokens, no foundations", () => {
    const manifest = {
      namespace: "Harbor_a1b2c3",
      components: [{ name: "Hero" }],
      cards: [
        { path: "preview/colors.html", group: "Colors" },
        { path: "preview/type.html", group: "Type" },
      ],
      tokens: [],
      source: "spa",
    };
    const tokens = `:root {
      --primary-600: #1F6B4A; --copy-50: #F7F4EE; --copy-100: #EFE8D8;
      --copy-500: #6F6758; --copy-800: #1C1914; --navy-600: #2A3A32;
      --sans: Inter, sans-serif; --radius: 10px;
    }`;
    const draft = extractDesignSystemDraftFromFiles(
      [
        { name: "_ds_manifest.json", text: JSON.stringify(manifest) },
        { name: "colors_and_type.css", text: tokens },
        { name: "preview/colors.html", text: `<style>${tokens}</style>` },
        { name: "skill/harbor-design/tokens.css", text: tokens },
        { name: "design-system/tokens.css", text: tokens },
        { name: "uploads/Colors (4).pdf", text: "not tokens" },
        { name: "_ds_bundle.js", text: "window.Harbor_a1b2c3 = {};" },
      ],
      "Harbor_Design_System.zip",
    );
    expect(draft?.name).toBe("Harbor");
    expect(draft?.summary).toMatch(/Claude Design SPA/);
    expect(parseDesignPalette(draft?.palette)?.primary).toBe("#1f6b4a");
    expect(draft?.typography?.sans).toMatch(/^Inter/);
    expect(draft?.guidelines).toMatch(/Harbor_a1b2c3/);
    expect(draft?.startingPoints?.some((row) => row.title === "Hero")).toBe(true);
    expect(draft?.tokens?.some((token) => token.name === "primary-600")).toBe(true);
  });

  it("ranks kit paths ahead of generic HTML and skips uploads and nested zips", () => {
    expect(zipImportRank("_ds_manifest.json")).toBeLessThan(zipImportRank("preview/colors.html"));
    expect(zipImportRank("preview/colors.html")).toBeLessThan(zipImportRank("ads.jsx"));
    expect(zipImportRank("colors_and_type.css")).toBeLessThan(zipImportRank("landing.html"));
    expect(isSkippedZipImportPath("uploads/inter.zip")).toBe(true);
    expect(isSkippedZipImportPath("uploads/source-notes.pdf")).toBe(true);
    expect(isSkippedZipImportPath("export/src/index.html")).toBe(true);
    expect(isSkippedZipImportPath("preview/colors.html")).toBe(false);
    expect(isSkippedZipImportPath(".design-canvas.state.json")).toBe(false);
  });

  it("selects skill, UI kits, and assets for the workspace kit", () => {
    expect(isDesignKitPath("skill/harbor-design/SKILL.md")).toBe(true);
    expect(isDesignKitPath("ui_kits/marketing/Hero.jsx")).toBe(true);
    expect(startingPointsFromKitPaths(["ui_kits/marketing/Hero.jsx"])?.[0]).toEqual({
      id: "hero",
      title: "Hero",
      kind: "ui_kit",
    });
    expect(isDesignKitPath("assets/logo.svg")).toBe(true);
    expect(isDesignKitPath("fonts/Inter.ttf")).toBe(true);
    expect(isDesignKitPath("Harbor/assets/logo-dark.svg")).toBe(true);
    expect(canonicalKitRel("Harbor/assets/logo-dark.svg")).toBe("assets/logo-dark.svg");
    expect(canonicalKitRel("design-system/assets/logo.svg")).toBe("design-system/assets/logo.svg");
    expect(canonicalKitRel("index.html")).toBeUndefined();
    expect(isDesignKitPath("uploads/ebook.pdf")).toBe(false);
    expect(isDesignKitPath("export/index.html")).toBe(false);
    expect(isDesignKitPath("export/src/design-system/tokens.css")).toBe(false);
    expect(kitImportRank("skill/harbor-design/SKILL.md")).toBeLessThan(
      kitImportRank("ui_kits/marketing/Hero.jsx"),
    );
    expect(kitImportRank("Brand Kit/skill/harbor-design/SKILL.md")).toBe(
      kitImportRank("skill/harbor-design/SKILL.md"),
    );
    const skill = skillFromKitFile(
      "skill/harbor-design/SKILL.md",
      "---\ntitle: Harbor\n---\nUse Inter, green CTAs, and marketing ui_kits.\n",
    );
    expect(skill?.name).toBe("harbor-design");
    expect(skill?.title).toBe("Harbor");
    expect(skill?.body).toMatch(/Inter/);
  });
});
