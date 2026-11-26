import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  THEME_IDS,
  THEME_OPTIONS,
  THEME_STYLES,
  craftedThemesCss,
  customThemeFromInput,
  tokenThemesCss,
} from "@locus/shared";
import { describe, expect, it } from "vitest";
import type { AgentSession } from "@locus/shared";
import {
  activeWorkspaceAccent,
  activeWorkspaceThemeKey,
  configuredTheme,
  applyWorkspaceAccent,
  applyChatDensity,
  applyEditorPrefs,
  applyTheme,
  chatDensityPrefValue,
  editorFontSizePx,
  editorFormatOnSave,
  editorShowMinimap,
  themeSurfaceAttrs,
} from "./theme";

const here = dirname(fileURLToPath(import.meta.url));
const indexCss = readFileSync(join(here, "../index.css"), "utf8");
const styleCss = readFileSync(join(here, "../styles/themeStyles.css"), "utf8");
/** Crafted built-ins are compiled from engine specs at runtime. */
const css = `${indexCss}\n${styleCss}\n${tokenThemesCss()}\n${craftedThemesCss()}`;

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

  it("styles every theme style group with tokens, scoped rules and palettes", () => {
    for (const style of THEME_STYLES) {
      expect(styleCss).toContain(`[data-theme-style="${style}"] {`);
      expect(styleCss).toContain(
        `@scope ([data-theme-style="${style}"]) to ([data-theme]:not([data-theme-style="${style}"]))`,
      );
      expect(styleCss).toContain(`.theme-thumb[data-theme-style="${style}"]`);
    }
    for (const opt of THEME_OPTIONS.filter((t) => t.style && !t.crafted)) {
      expect(styleCss).toContain(`[data-theme="${opt.id}"] {`);
    }
    expect(styleCss).toMatch(
      /html\[data-theme-style="retro"\] #root::before[\s\S]*?--retro-caption/,
    );
    expect(styleCss).toContain("prefers-reduced-transparency");
    expect(styleCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*html\[data-theme-style="hud"\] body::after/,
    );
    expect(styleCss).toMatch(/@property --y2k-angle/);
    expect(styleCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*@scope \(\[data-theme-style="glitch"\]\)[\s\S]*?animation: none/,
    );
    for (const style of ["steampunk", "disco", "psychedelic"]) {
      expect(styleCss).toMatch(
        new RegExp(
          `@media \\(prefers-reduced-motion: reduce\\) \\{\\s*@scope \\(\\[data-theme-style="${style}"\\]\\)[\\s\\S]*?animation: none`,
        ),
      );
    }
    expect(styleCss).toMatch(/@property --disco-sweep/);
    expect(styleCss).toMatch(
      /@media \(prefers-reduced-transparency: reduce\) \{\s*html\[data-theme-style="riso"\] body::after/,
    );
  });

  it("applies generated themes from installed CSS and clears their markers", () => {
    const theme = customThemeFromInput(
      {
        id: "custom-test-glow",
        name: "Test Glow",
        scheme: "light",
        base: "comic",
        colors: { bg: "#fff8ef", text: "#2b1b14", accent: "#d6453d" },
        layout: { radius: 20 },
      },
      { now: "2026-01-01T00:00:00.000Z" },
    );
    expect(applyTheme("custom-test-glow", [theme])).toBe("custom-test-glow");
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("custom-test-glow");
    expect(root.dataset.themeStyle).toBe("comic");
    expect(root.dataset.themeCustom).toBe("");
    expect(root.style.colorScheme).toBe("light");
    expect(document.getElementById("locus-custom-themes")?.textContent).toContain(
      '[data-theme="custom-test-glow"]',
    );
    expect(themeSurfaceAttrs("custom-test-glow")).toMatchObject({
      "data-theme": "custom-test-glow",
      "data-theme-style": "comic",
    });
    // A generated id that no longer exists falls back to the default theme.
    expect(applyTheme("custom-test-glow", [])).toBe("ember");
    expect(root.dataset.themeCustom).toBeUndefined();
    expect(document.getElementById("locus-custom-themes")?.textContent).toBe("");
  });

  it("sets and clears the style group on the document", () => {
    applyTheme("concrete");
    expect(document.documentElement.dataset.themeStyle).toBe("brutalist");
    expect(document.documentElement.style.colorScheme).toBe("light");
    applyTheme("smoke");
    expect(document.documentElement.dataset.themeStyle).toBe("glass");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    applyTheme("visor");
    expect(document.documentElement.dataset.themeStyle).toBe("hud");
    applyTheme("gazette");
    expect(document.documentElement.dataset.themeStyle).toBe("editorial");
    applyTheme("datamosh");
    expect(document.documentElement.dataset.themeStyle).toBe("glitch");
    applyTheme("thermal");
    expect(document.documentElement.dataset.themeStyle).toBe("receipt");
    applyTheme("mirrorball");
    expect(document.documentElement.dataset.themeStyle).toBe("disco");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    applyTheme("bigtop");
    expect(document.documentElement.dataset.themeStyle).toBe("circus");
    expect(document.documentElement.style.colorScheme).toBe("light");
    applyTheme("nord");
    expect(document.documentElement.dataset.themeStyle).toBeUndefined();
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

describe("workspace accents", () => {
  it("uses a project accent before a repository accent and clears it outside the workspace", () => {
    const config = {
      themePreferences: {
        workspaceAccents: {
          "project:one": "#123456",
          "repo:two": "#abcdef",
        },
      },
    };
    const sessions = [{ id: "chat", projectId: "one", repoId: "two" }] as AgentSession[];
    const state = {
      config,
      sessions,
      selectedId: "chat",
      selectedRepoId: "two",
      selectedProjectId: "one",
    };
    const root = document.documentElement;
    applyWorkspaceAccent(activeWorkspaceAccent({ ...state, section: "agents" }));
    expect(root.style.getPropertyValue("--workspace-accent")).toBe("#123456");
    applyWorkspaceAccent(activeWorkspaceAccent({ ...state, section: "codebase" }));
    expect(root.style.getPropertyValue("--workspace-accent")).toBe("#abcdef");
    applyWorkspaceAccent(activeWorkspaceAccent({ ...state, section: "settings" }));
    expect(root.hasAttribute("data-workspace-accent")).toBe(false);
    expect(root.style.getPropertyValue("--workspace-accent")).toBe("");
  });
});

describe("workspace themes, schedules and adaptive themes", () => {
  it("picks the project's own theme, then the schedule", () => {
    const config = {
      theme: "nord" as const,
      themePreferences: {
        workspaceThemes: { "project:one": "velvet" as const },
        scheduleOn: true,
        schedule: [
          { at: "07:00", theme: "paper" as const },
          { at: "20:00", theme: "midnight" as const },
        ],
      },
    };
    const sessions = [{ id: "chat", projectId: "one", repoId: "two" }] as AgentSession[];
    const state = {
      config,
      sessions,
      selectedId: "chat",
      selectedRepoId: "two",
      selectedProjectId: "one",
      section: "agents" as const,
    };
    const key = activeWorkspaceThemeKey(state);
    expect(key).toBe("project:one");
    expect(configuredTheme(config, true, { minute: 600, workspaceKey: key })).toBe("velvet");
    expect(configuredTheme(config, true, { minute: 600 })).toBe("paper");
    expect(configuredTheme(config, true, { minute: 21 * 60 })).toBe("midnight");
    expect(activeWorkspaceThemeKey({ ...state, section: "settings" })).toBeUndefined();
  });

  it("lets CSS choose the colour scheme for adaptive themes", () => {
    applyTheme("riptide");
    expect(document.documentElement.style.colorScheme).toBe("");
    applyTheme("tally");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("installs data and spec built-ins before generated themes", () => {
    applyTheme("nord", []);
    const builtins = document.getElementById("locus-crafted-themes")!;
    expect(builtins.textContent).toContain('[data-theme="nord"] {');
    expect(builtins.textContent).toContain('[data-theme="zenith"] {');
    expect(builtins.textContent).toContain("@media (prefers-color-scheme: light)");
    const custom = document.getElementById("locus-custom-themes");
    if (custom) {
      expect(
        builtins.compareDocumentPosition(custom) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("feeds syntax, diff and terminal colours through tokens with fallbacks", () => {
    expect(indexCss).toMatch(
      /\.tok-kw,\n\.md-kw \{\n {2}color: var\(--syn-kw, var\(--accent-2\)\)/,
    );
    expect(indexCss).toContain("var(--diff-add, var(--ok))");
    expect(indexCss).not.toContain('\n[data-theme="nord"] {');
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

  it("scales the app-wide space and type tokens", () => {
    expect(css).toMatch(/--space-4: calc\(16px \* var\(--density-space\)\);/);
    expect(css).toMatch(
      /\[data-chat-density="comfortable"\] \{\n {2}--density-space: 1\.2;\n {2}--density-type: 1\.07;/,
    );
    expect(css).toMatch(
      /\[data-chat-density="dense"\] \{\n {2}--density-space: 0\.75;\n {2}--density-type: 0\.93;/,
    );
  });
});
