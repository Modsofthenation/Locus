import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN_PALETTE } from "./models/designPalette.js";
import { livingAssetBrief, formatPromoteAssetBrief } from "./models/assetCanvas.js";
import { ASSET_BUILD_DEFAULTS } from "./models/assetBuild.js";
import {
  ASSET_STYLE_FORMAT,
  applyAssetStylePrompt,
  assetStyleFileName,
  describeAssetStudioStyle,
  extractAssetStyleDraft,
  exportAssetStyle,
  formatAssetStylePrompt,
  lastAssetLookPrompt,
  materializeAssetStyle,
  parseAssetStyle,
  parseAssetStyleFile,
  resolveAssetStyle,
  upsertAssetStyleSection,
  withAssetStylePrompt,
} from "./models/assetStyle.js";

const at = "2026-10-06T00:00:00.000Z";

describe("asset styles", () => {
  it("parses, exports, and resolves stored styles", () => {
    const stored = parseAssetStyle({
      id: "st1",
      name: "Clay hero",
      summary: "Chunky terracotta",
      guidelines: "Rounded silhouettes, 2k tris, cream grout.",
      palette: DEFAULT_DESIGN_PALETTE,
      sourceSessionId: "sess-1",
      createdAt: at,
      updatedAt: at,
    });
    expect(stored?.name).toBe("Clay hero");
    expect(stored?.palette?.primary).toBe(DEFAULT_DESIGN_PALETTE.primary);
    expect(resolveAssetStyle("st1", [stored!])?.id).toBe("st1");
    expect(resolveAssetStyle("missing", [stored!])).toBeUndefined();
    const file = exportAssetStyle(stored!);
    expect(file.format).toBe(ASSET_STYLE_FORMAT);
    expect(parseAssetStyleFile(file)?.name).toBe("Clay hero");
    expect(assetStyleFileName(stored!)).toBe("clay-hero.locus-asset-style.json");
  });

  it("materializes a draft and formats prompts", () => {
    const style = materializeAssetStyle(
      {
        name: "Voxel dusk",
        summary: "Blocky night palette",
        guidelines: "Minecraft-like cubes. Keep the source colors.",
      },
      { id: "st2", createdAt: at },
    );
    expect(style?.id).toBe("st2");
    expect(formatAssetStylePrompt(style!)).toMatch(/Saved asset style "Voxel dusk"/);
    expect(formatAssetStylePrompt(style!)).toMatch(/Minecraft-like cubes/);
    expect(withAssetStylePrompt("Generate now.", style!)).toMatch(/Voxel dusk/);
    expect(withAssetStylePrompt("Generate now.")).toBe("Generate now.");
    expect(applyAssetStylePrompt(style!)).toMatch(/Apply saved asset style "Voxel dusk"/);
    expect(applyAssetStylePrompt(style!)).toMatch(/Do not change the subject/);
    expect(materializeAssetStyle({}, { id: "x", createdAt: at })).toBeUndefined();
    expect(
      materializeAssetStyle({ name: "  " }, { id: "x", createdAt: at, fallbackName: "From studio" })
        ?.name,
    ).toBe("From studio");
  });

  it("extracts a draft from ASSET.md and upserts the Style section", () => {
    const fromStyle = extractAssetStyleDraft(
      livingAssetBrief({ title: "Swan", notes: ["Keep the beak sharp."] }),
      { fallbackName: "Swan style" },
    );
    expect(fromStyle.name).toBe("Swan style");
    expect(fromStyle.guidelines).toMatch(/Keep the beak sharp/);

    const brief = `# Hero mesh

## Mode

3D mesh with orbit.

## Style

Saved style: Clay hero.
Chunky terracotta
Rounded silhouettes, 2k tris.

## Export

PNG / GLB.
`;
    const extracted = extractAssetStyleDraft(brief);
    expect(extracted.name).toBe("Clay hero");
    expect(extracted.summary).toBe("Chunky terracotta");
    expect(extracted.guidelines).toMatch(/2k tris/);
    expect(extracted.guidelines).not.toMatch(/PNG/);
    expect(extracted.summary).not.toMatch(/orbit/);

    const next = upsertAssetStyleSection(brief, {
      name: "Ink cutout",
      summary: "High-contrast 2D",
      guidelines: "Hard edges. Two inks.",
    });
    expect(next).toMatch(/Saved style: Ink cutout\./);
    expect(next).not.toMatch(/Clay hero/);
    expect(next).toMatch(/## Export/);

    const seeded = upsertAssetStyleSection("# Empty\n", {
      name: "New look",
      summary: "",
      guidelines: "Soft clay.",
    });
    expect(seeded).toMatch(/## Style/);
    expect(seeded).toMatch(/Soft clay/);
  });

  it("puts a saved style into the living brief and promote brief", () => {
    const style = {
      name: "Clay hero",
      summary: "Chunky terracotta",
      guidelines: "Rounded silhouettes.",
    };
    expect(livingAssetBrief({ title: "Hero", style })).toMatch(/## Style/);
    expect(livingAssetBrief({ title: "Hero", style })).toMatch(/Clay hero/);
    expect(
      formatPromoteAssetBrief({ title: "Hero", assetStyleId: "st1", assetStyleName: "Clay hero" }),
    ).toMatch(/Clay hero/);
  });

  it("describes the live studio look instead of a generic brief", () => {
    const described = describeAssetStudioStyle({
      title: "Clay swan",
      prompt: "A chunky terracotta swan with cream grout",
      html: `<html data-locus-material="clay"><style>:root{--primary:#c45c26;--accent:#f3e6c8}</style>
<img src="./source.png" /><script>THREE.MeshStandardMaterial</script></html>`,
      brief: livingAssetBrief({ title: "Clay swan" }),
      palette: DEFAULT_DESIGN_PALETTE,
      build: { ...ASSET_BUILD_DEFAULTS, topology: "smart", polyBudget: "8k" },
    });
    expect(described.name).toBe("Clay swan style");
    expect(described.summary).toMatch(/terracotta swan/);
    expect(`${described.summary}\n${described.guidelines}`).toMatch(/cream grout|terracotta/i);
    expect(described.guidelines).toMatch(/source\.png/);
    expect(described.guidelines).toMatch(/Clay \/ untextured/);
    expect(described.guidelines).not.toMatch(/3D mesh with orbit, texture, and optional rig/);
    expect(described.summary).not.toMatch(/3D mesh with orbit/);
    expect(
      lastAssetLookPrompt([{ role: "user", content: "Generate from the current operator" }]),
    ).toBeUndefined();
    expect(
      lastAssetLookPrompt([
        { role: "user", content: "A clay swan" },
        { role: "user", content: "Generate from the current operator build settings." },
      ]),
    ).toBe("A clay swan");
  });
});
