import { describe, expect, it } from "vitest";
import {
  applyGameStylePrompt,
  describeGameCanvasStyle,
  exportGameStyle,
  extractGameStyleDraft,
  formatGameStylePrompt,
  gameStyleFileName,
  materializeGameStyle,
  parseGameStyle,
  parseGameStyleFile,
  resolveGameStyle,
  upsertGameStyleSection,
  withGameStylePrompt,
} from "./models/gameStyle.js";

const style = materializeGameStyle(
  {
    name: "Neon tile",
    summary: "16px night market.",
    guidelines: "Hard pixels. Arcade HUD.",
    tilePx: 16,
    hud: "arcade",
    juice: "crunchy",
  },
  { id: "st1", createdAt: "2026-10-20T00:00:00.000Z" },
)!;

describe("game style", () => {
  it("parses, resolves, and names an export file", () => {
    expect(parseGameStyle(style)?.name).toBe("Neon tile");
    expect(resolveGameStyle("st1", [style])?.juice).toBe("crunchy");
    expect(gameStyleFileName(style)).toBe("neon-tile.locus-game-style.json");
    expect(parseGameStyleFile(exportGameStyle(style))?.name).toBe("Neon tile");
  });

  it("injects look into prompts and GAME.md", () => {
    expect(formatGameStylePrompt(style)).toContain('Saved game style "Neon tile"');
    expect(withGameStylePrompt("Build a loop.", style)).toContain("Tile 16px");
    expect(applyGameStylePrompt(style)).toMatch(/Do not change the win condition/);
    const brief = upsertGameStyleSection("# Drive\n\n## Persistence\n\nlocalStorage.\n", style);
    expect(brief).toContain("## Style");
    expect(brief).toContain("Saved style: Neon tile.");
    expect(brief.indexOf("## Style")).toBeLessThan(brief.indexOf("## Persistence"));
    expect(extractGameStyleDraft(brief).hud).toBe("arcade");
  });

  it("describes a style from a brief and title", () => {
    const draft = describeGameCanvasStyle({
      title: "Slow Roads",
      brief: "# Slow Roads\n\n## Loop\n\nEndless cruise.\n",
      prompt: "Make it dusk.",
      tilePx: 32,
      juice: "floaty",
    });
    expect(draft.name).toBe("Slow Roads style");
    expect(draft.tilePx).toBe(32);
    expect(draft.juice).toBe("floaty");
  });
});
