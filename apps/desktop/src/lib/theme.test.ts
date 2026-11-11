import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_IDS, THEME_OPTIONS } from "@locus/shared";
import { describe, expect, it } from "vitest";
import {
  applyChatDensity,
  applyEditorPrefs,
  applyTheme,
  chatDensityPrefValue,
  editorFontSizePx,
  editorFormatOnSave,
  editorShowMinimap,
} from "./theme";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");

describe("applyTheme", () => {
  it("sets the document palette and color-scheme", () => {
    expect(applyTheme("nord")).toBe("nord");
    expect(document.documentElement.dataset.theme).toBe("nord");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("paper")).toBe("paper");
    expect(document.documentElement.dataset.theme).toBe("paper");
    expect(document.documentElement.style.colorScheme).toBe("light");

    expect(applyTheme("tokyo")).toBe("tokyo");
    expect(document.documentElement.dataset.theme).toBe("tokyo");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("linen")).toBe("linen");
    expect(document.documentElement.dataset.theme).toBe("linen");
    expect(document.documentElement.style.colorScheme).toBe("light");

    expect(applyTheme("beacon")).toBe("beacon");
    expect(document.documentElement.dataset.theme).toBe("beacon");
    expect(document.documentElement.style.colorScheme).toBe("light");

    expect(applyTheme("ion")).toBe("ion");
    expect(document.documentElement.dataset.theme).toBe("ion");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("glacier")).toBe("glacier");
    expect(document.documentElement.dataset.theme).toBe("glacier");
    expect(document.documentElement.style.colorScheme).toBe("light");

    expect(applyTheme("dusk")).toBe("dusk");
    expect(document.documentElement.dataset.theme).toBe("dusk");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("brief")).toBe("brief");
    expect(document.documentElement.dataset.theme).toBe("brief");
    expect(document.documentElement.style.colorScheme).toBe("light");

    expect(applyTheme("solstice")).toBe("solstice");
    expect(document.documentElement.dataset.theme).toBe("solstice");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("hotdog")).toBe("hotdog");
    expect(document.documentElement.dataset.theme).toBe("hotdog");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("cosmos")).toBe("cosmos");
    expect(document.documentElement.dataset.theme).toBe("cosmos");
    expect(document.documentElement.dataset.chatScene).toBe("");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("andromeda")).toBe("andromeda");
    expect(document.documentElement.dataset.theme).toBe("andromeda");
    expect(document.documentElement.dataset.chatScene).toBe("");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("cel")).toBe("cel");
    expect(document.documentElement.dataset.theme).toBe("cel");
    expect(document.documentElement.style.colorScheme).toBe("light");

    expect(applyTheme("toon")).toBe("toon");
    expect(document.documentElement.dataset.theme).toBe("toon");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("noir")).toBe("noir");
    expect(document.documentElement.dataset.theme).toBe("noir");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("snow")).toBe("snow");
    expect(document.documentElement.dataset.theme).toBe("snow");
    expect(document.documentElement.style.colorScheme).toBe("light");

    expect(applyTheme("flare")).toBe("flare");
    expect(document.documentElement.dataset.theme).toBe("flare");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("horizon")).toBe("horizon");
    expect(document.documentElement.dataset.theme).toBe("horizon");
    expect(document.documentElement.dataset.themeGradient).toBe("");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("daybreak")).toBe("daybreak");
    expect(document.documentElement.dataset.theme).toBe("daybreak");
    expect(document.documentElement.dataset.themeGradient).toBe("");
    expect(document.documentElement.style.colorScheme).toBe("light");

    expect(applyTheme("reef")).toBe("reef");
    expect(document.documentElement.dataset.theme).toBe("reef");
    expect(document.documentElement.dataset.themeGradient).toBe("");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("lilac")).toBe("lilac");
    expect(document.documentElement.dataset.theme).toBe("lilac");
    expect(document.documentElement.dataset.themeGradient).toBe("");
    expect(document.documentElement.style.colorScheme).toBe("light");

    expect(applyTheme("ruby")).toBe("ruby");
    expect(document.documentElement.dataset.theme).toBe("ruby");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("banner")).toBe("banner");
    expect(document.documentElement.dataset.theme).toBe("banner");
    expect(document.documentElement.style.colorScheme).toBe("light");

    expect(applyTheme("canopy")).toBe("canopy");
    expect(document.documentElement.dataset.theme).toBe("canopy");
    expect(document.documentElement.dataset.themeGradient).toBe("");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    expect(applyTheme("grove")).toBe("grove");
    expect(document.documentElement.dataset.theme).toBe("grove");
    expect(document.documentElement.dataset.themeGradient).toBe("");
    expect(document.documentElement.style.colorScheme).toBe("light");

    expect(applyTheme("console")).toBe("console");
    expect(document.documentElement.dataset.theme).toBe("console");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.dataset.themeGradient).toBeUndefined();
    expect(document.documentElement.dataset.themeTerminal).toBe("");

    expect(applyTheme("teletype")).toBe("teletype");
    expect(document.documentElement.dataset.themeTerminal).toBe("");
    expect(document.documentElement.style.colorScheme).toBe("light");

    expect(applyTheme("not-a-theme")).toBe("ember");
    expect(document.documentElement.dataset.theme).toBe("ember");
    expect(document.documentElement.dataset.chatScene).toBeUndefined();
    expect(document.documentElement.dataset.themeGradient).toBeUndefined();
    expect(document.documentElement.dataset.themeTerminal).toBeUndefined();
  });

  it("defines a CSS palette for every selectable theme", () => {
    for (const id of THEME_IDS) {
      expect(css).toContain(`[data-theme="${id}"]`);
    }
    expect(css).toContain("[data-theme-gradient]");
    expect(css).toMatch(/\[data-theme-gradient\][\s\S]*?\.workspace/);
    expect(css).toMatch(/\[data-theme-gradient\][\s\S]*?\.empty/);
    for (const opt of THEME_OPTIONS.filter((t) => t.gradient)) {
      expect(css).toMatch(new RegExp(`\\[data-theme="${opt.id}"\\][\\s\\S]*?--wash:`));
    }
  });

  it("styles terminal themes as a terminal window", () => {
    expect(css).toMatch(/\[data-theme-terminal\] \{[\s\S]*?IBM Plex Mono/);
    expect(css).toContain("html[data-theme-terminal] #root::before");
    expect(css).toContain("locus \\2014 tty");
    expect(css).toMatch(/html\[data-theme-terminal\]::after[\s\S]*?repeating-linear-gradient/);
    expect(css).toContain(".theme-preview[data-theme-terminal] .theme-preview-chrome em::before");
    const terminals = THEME_OPTIONS.filter((t) => t.terminal);
    expect(terminals.length).toBeGreaterThan(1);
    for (const opt of terminals) {
      expect(css).toMatch(
        new RegExp(`\\[data-theme="${opt.id}"\\] \\{[^}]*--term-glow:[^}]*--term-title:`),
      );
    }
  });

  it("wires photo themes to a chat-pane scene image", () => {
    expect(css).toContain("[data-chat-scene] .chat");
    for (const opt of THEME_OPTIONS.filter((t) => t.chatScene)) {
      expect(css).toContain(`url("/themes/${opt.id}.jpg")`);
      expect(
        readFileSync(
          join(dirname(fileURLToPath(import.meta.url)), `../../public/themes/${opt.id}.jpg`),
        ).length,
      ).toBeGreaterThan(8_000);
    }
  });
});

describe("applyEditorPrefs", () => {
  it("sets editor CSS vars and format-on-save", () => {
    expect(applyEditorPrefs(16, false, false)).toBe(16);
    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--editor-line-height")).toBe("24px");
    expect(editorFontSizePx()).toBe(16);
    expect(editorFormatOnSave()).toBe(false);
    expect(editorShowMinimap()).toBe(false);
    applyEditorPrefs(12, true, true);
    expect(editorFormatOnSave()).toBe(true);
    expect(editorShowMinimap()).toBe(true);
  });
});

describe("applyChatDensity", () => {
  it("sets the document density and ignores junk", () => {
    expect(applyChatDensity("dense")).toBe("dense");
    expect(document.documentElement.dataset.chatDensity).toBe("dense");
    expect(chatDensityPrefValue()).toBe("dense");
    expect(applyChatDensity("comfortable")).toBe("comfortable");
    expect(document.documentElement.dataset.chatDensity).toBe("comfortable");
    expect(applyChatDensity("nope")).toBe("compact");
    expect(document.documentElement.dataset.chatDensity).toBe("compact");
  });

  it("defines comfortable and dense chat spacing", () => {
    expect(css).toMatch(/\[data-chat-density="comfortable"\][\s\S]*?--chat-font: 14\.5px;/);
    expect(css).toMatch(/\[data-chat-density="dense"\][\s\S]*?--chat-font: 12px;/);
    expect(css).toMatch(/\.thread \{[\s\S]*?padding: var\(--chat-thread-pad\)/);
  });
});
