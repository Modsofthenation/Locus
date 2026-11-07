import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_IDS } from "@locus/shared";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseThemePalettes, themeReadabilityFailures } from "./contrast";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");

describe("theme contrast", () => {
  it("computes WCAG contrast for hex pairs", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#000000", "#000000")).toBeCloseTo(1, 5);
  });

  it("parses ember plus every selectable theme palette", () => {
    const palettes = parseThemePalettes(css);
    const ids = new Set(palettes.map((row) => row.id));
    expect(ids.has("ember")).toBe(true);
    for (const id of THEME_IDS) expect(ids.has(id)).toBe(true);
  });

  it("keeps text, muted labels, and primary buttons readable on every theme", () => {
    const palettes = parseThemePalettes(css);
    const failures: string[] = [];
    for (const palette of palettes) {
      for (const row of themeReadabilityFailures(palette.vars)) {
        failures.push(
          `${palette.id}: ${row.pair} is ${row.ratio.toFixed(2)}:1 (need ${row.minimum}:1)`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("paints docker logs with term-fg because page ink fails on the term pane", () => {
    const palettes = parseThemePalettes(css);
    const lights = ["paper", "linen", "sepia", "parchment", "brief", "folio"];
    for (const id of lights) {
      const vars = palettes.find((row) => row.id === id)?.vars;
      expect(vars, id).toBeTruthy();
      const termFgOnTerm = contrastRatio(vars!["term-fg"]!, vars!.term);
      expect(termFgOnTerm, `${id} term-fg/term`).toBeGreaterThanOrEqual(4.5);
    }
    expect(css).toMatch(/\.docker-logs \{[\s\S]*?color:\s*var\(--term-fg\)/);
    expect(css).toMatch(/\.docker-log-line \.msg \{[\s\S]*?color:\s*var\(--term-fg\)/);
  });
});
