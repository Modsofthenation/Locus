import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEATURED_THEME_IDS, THEME_OPTIONS } from "@locus/shared";
import { PRIMARY_RAIL_SECTIONS, MORE_RAIL_SECTIONS } from "./railNav";

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, "../index.css"), "utf8");
const ux = readFileSync(join(dir, "../styles/ux.css"), "utf8");

describe("quiet shell contract", () => {
  it("keeps body type at 14px and never ships a token below 12px", () => {
    expect(css).toMatch(/--type-2xs: 12px;/);
    expect(css).toMatch(/--type-xs: 12px;/);
    expect(css).toMatch(/--type-md: 14px;/);
    expect(css).toMatch(/--type-body: 14px;/);
    expect(css).toMatch(/--chat-font: 14px;/);
    expect(css).not.toMatch(/--type-2xs: 10px;/);
    expect(css).not.toMatch(/--chat-font: 13px;/);
  });

  it("pins a short featured theme set and keeps the rest as extras", () => {
    expect([...FEATURED_THEME_IDS]).toEqual(["ember", "midnight", "paper", "contrast"]);
    expect(THEME_OPTIONS).toHaveLength(98);
  });

  it("ships the quiet-shell screenshot contract in ux.css", () => {
    expect(ux).toMatch(/\.ui-select-toggle \{/);
    expect(ux).toMatch(/\.session-settings-tabs \{/);
    expect(ux).toMatch(/\.integration-catalog \{/);
    expect(ux).not.toMatch(/\.chat-runtime-badge \{/);
    expect(ux).toMatch(/\.chat-empty-hint \{/);
    expect(ux).toMatch(/\.setup-later \{/);
    expect(ux).toMatch(/\.theme-featured-note \{/);
    expect(ux).toMatch(/\.model-picker-combined-toggle \{/);
    expect(ux).toMatch(/\.empty-hero \{/);
    expect(ux).toMatch(/\.empty-hint \{/);
    expect(ux).toMatch(/forced-colors: active/);
    expect(ux).toMatch(/\.field > \.ui-select/);
    expect(ux).toMatch(/\.ui-select\.game-kit-select/);
    expect(ux).toMatch(/\.prompt-modal-form \{/);
    expect(ux).toMatch(/\.app-notice \{/);
    expect(ux).toMatch(/grid-template-columns: minmax\(0, 1fr\) auto 28px;/);
    expect(ux).toMatch(/\.ui-skeleton \{/);
    expect(ux).toMatch(/\.inline-error \{/);
    expect(ux).toMatch(/\.theme-family \{/);
    expect(ux).toMatch(/prefers-contrast: more/);
  });

  it("keeps five primary rails and hides the rest behind More", () => {
    expect([...PRIMARY_RAIL_SECTIONS]).toEqual([
      "agents",
      "design",
      "ide",
      "codebase",
      "automations",
    ]);
    expect([...MORE_RAIL_SECTIONS]).toContain("games");
    expect([...MORE_RAIL_SECTIONS]).toContain("slack");
    expect([...MORE_RAIL_SECTIONS]).not.toContain("codebase");
  });
});
