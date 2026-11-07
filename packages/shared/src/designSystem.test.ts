import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN_PALETTE,
  PALETTE_PRESETS,
  parseDesignPalette,
  presetIdForPalette,
  withPaletteCss,
} from "./models/designPalette.js";
import {
  DESIGN_SYSTEM_FORMAT,
  builtinDesignSystemId,
  builtinDesignSystems,
  designSystemFileName,
  extractDesignSystemDraft,
  exportDesignSystem,
  formatDesignImportBytes,
  formatDesignSystemPrompt,
  parseDesignSystem,
  resolveDesignSystem,
  withDesignSystemCss,
} from "./models/designSystem.js";

const ink = PALETTE_PRESETS[0]!;

describe("design systems", () => {
  it("parses, exports, and resolves builtin presets", () => {
    const stored = parseDesignSystem({
      id: "sys1",
      name: "Brand",
      summary: "Our look",
      palette: ink.colors,
      typography: { sans: "Inter, sans-serif", mono: "JetBrains Mono, monospace", basePx: 17 },
      radiusPx: 8,
      spacePx: 10,
      guidelines: "No purple.",
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    });
    expect(stored?.typography.sans).toBe("Inter, sans-serif");
    expect(stored?.typography.display).toBe("Inter, sans-serif");
    const file = exportDesignSystem(stored!);
    expect(file.format).toBe(DESIGN_SYSTEM_FORMAT);
    expect(file.system.name).toBe("Brand");
    expect(file.system.id).toBeUndefined();
    expect(designSystemFileName(stored!)).toBe("brand.locus-design.json");
    expect(resolveDesignSystem(builtinDesignSystemId("ink"), [])?.palette).toEqual(
      DEFAULT_DESIGN_PALETTE,
    );
    expect(builtinDesignSystems()).toHaveLength(PALETTE_PRESETS.length);
    for (const system of builtinDesignSystems()) {
      expect(resolveDesignSystem(system.id, [])?.palette).toEqual(system.palette);
      expect(presetIdForPalette(system.palette)).toBe(system.id.replace(/^preset:/, ""));
    }
  });

  it("injects token CSS and a prompt the model can follow", () => {
    const system = resolveDesignSystem(builtinDesignSystemId("ink"), [])!;
    const html = withDesignSystemCss("<html><head></head><body></body></html>", system);
    expect(html).toContain("--primary: #e08a4c");
    expect(html).toContain("--font-sans:");
    expect(html).toContain("--radius: 12px");
    const again = withPaletteCss(html, { ...system.palette, primary: "#111111" });
    expect(again).toContain("--primary: #111111");
    expect(formatDesignSystemPrompt(system)).toContain("--font-display:");
    expect(formatDesignSystemPrompt(system)).toContain("Do not load webfonts");
    expect(formatDesignSystemPrompt(system)).toContain("--line:");
    expect(formatDesignSystemPrompt(system)).toContain("Product UI habits");
    expect(formatDesignSystemPrompt(system)).toContain("grid unit");
    expect(html).toContain("--line:");
  });

  it("imports a Locus JSON file and canvas CSS variables", () => {
    const system = resolveDesignSystem(builtinDesignSystemId("paper"), [])!;
    const fromJson = extractDesignSystemDraft(
      JSON.stringify(exportDesignSystem(system)),
      "paper.locus-design.json",
    );
    expect(fromJson?.name).toBe("Paper");
    expect(fromJson?.palette).toEqual(system.palette);
    const html = withDesignSystemCss("<html><head></head></html>", { ...system, name: "Canvas" });
    const fromHtml = extractDesignSystemDraft(html, "landing.html");
    expect(fromHtml?.name).toBe("landing");
    expect(parseDesignPalette(fromHtml?.palette)?.primary).toBe(system.palette.primary);
    expect(extractDesignSystemDraft("not a system")).toBeUndefined();
  });

  it("formats import sizes for the overlay and error copy", () => {
    expect(formatDesignImportBytes(900)).toBe("900 B");
    expect(formatDesignImportBytes(8 * 1024 * 1024)).toBe("8.0 MB");
    expect(formatDesignImportBytes(99.2 * 1024 * 1024)).toBe("99 MB");
  });

  it("tells canvas generation to use a landed brand kit", () => {
    const system = resolveDesignSystem(builtinDesignSystemId("ink"), [])!;
    const withKit = {
      ...system,
      kit: { fileCount: 12, bytes: 4000, skillName: "harbor-design", skillTitle: "Harbor" },
      tokens: [
        { name: "primary-600", value: "#196BE6" },
        { name: "copy-800", value: "#1F2A37" },
      ],
    };
    const prompt = formatDesignSystemPrompt(withKit);
    expect(prompt).toMatch(/ui_kits/);
    expect(prompt).toMatch(/assets\/logo\.svg/);
    expect(prompt).toMatch(/harbor-design/);
    expect(prompt).toMatch(/@font-face/);
    expect(prompt).toMatch(/--primary-600/);
    expect(prompt).not.toContain("Do not load webfonts or CDNs; use these stacks as-is.");
  });
});
