import { useSyncExternalStore } from "react";
import {
  activeThemeRef,
  normalizeThemeHex,
  editorFontSize,
  parseChatDensity,
  resolveTheme,
  customThemeCss,
  customThemesCss,
  customThemeWebFonts,
  craftedThemeWebFonts,
  craftedThemesCss,
  minuteOfDay,
  tokenThemesCss,
  webFontHref,
  findCustomTheme,
  themeOption,
  type ChatDensity,
  type CustomTheme,
  type LocusConfig,
  type ThemeRef,
} from "@locus/shared";

import type { UiState } from "@/state/store";

export const THEME_CHANGED_EVENT = "locus:theme-changed";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

function systemThemeQuery(): MediaQueryList | undefined {
  return typeof window === "undefined" ? undefined : window.matchMedia?.(SYSTEM_DARK_QUERY);
}

export function systemPrefersDark(): boolean {
  return systemThemeQuery()?.matches ?? true;
}

function subscribeSystemTheme(change: () => void): () => void {
  const query = systemThemeQuery();
  query?.addEventListener?.("change", change);
  return () => query?.removeEventListener?.("change", change);
}

type ThemeConfig = Pick<LocusConfig, "theme" | "themePreferences" | "customThemes">;

export function configuredTheme(
  config?: ThemeConfig | null,
  dark = systemPrefersDark(),
  context: { minute?: number; workspaceKey?: string } = { minute: minuteOfDay(new Date()) },
): ThemeRef {
  return activeThemeRef(
    config?.theme,
    config?.themePreferences,
    dark,
    config?.customThemes,
    context,
  );
}

/** Minute of the day, re-read every 20s so scheduled themes switch on time. */
function subscribeClock(change: () => void): () => void {
  const timer = window.setInterval(change, 20_000);
  return () => window.clearInterval(timer);
}
const currentMinute = () => minuteOfDay(new Date());

export function useConfiguredTheme(config?: ThemeConfig | null, workspaceKey?: string): ThemeRef {
  const dark = useSyncExternalStore(subscribeSystemTheme, systemPrefersDark, () => true);
  const scheduled = Boolean(config?.themePreferences?.scheduleOn);
  const minute = useSyncExternalStore(
    scheduled ? subscribeClock : subscribeNever,
    scheduled ? currentMinute : zero,
    zero,
  );
  return configuredTheme(config, dark, { minute: scheduled ? minute : undefined, workspaceKey });
}

function subscribeNever(): () => void {
  return () => undefined;
}
function zero(): number {
  return 0;
}

export { selectFixedTheme } from "@locus/shared";

type WorkspaceState = Pick<
  UiState,
  "section" | "sessions" | "selectedId" | "selectedRepoId" | "selectedProjectId"
> & { config: Pick<LocusConfig, "themePreferences"> | null };

/** The first workspace key (project, then repository) that has an entry in `map`. */
function workspaceLookup<T>(
  state: WorkspaceState,
  map?: Record<string, T>,
): [string, T] | undefined {
  if (!map) return undefined;
  const hit = (key: string): [string, T] | undefined =>
    map[key] !== undefined ? [key, map[key]!] : undefined;
  if (state.section === "codebase") return hit(`repo:${state.selectedRepoId}`);
  if (state.section === "project") return hit(`project:${state.selectedProjectId}`);
  if (!["agents", "ide", "design", "games", "assets", "android", "board"].includes(state.section)) {
    return undefined;
  }
  const session = state.sessions.find((row) => row.id === state.selectedId);
  return (
    (session?.projectId ? hit(`project:${session.projectId}`) : undefined) ??
    (session?.repoId ? hit(`repo:${session.repoId}`) : undefined)
  );
}

export function activeWorkspaceAccent(state: WorkspaceState): string | undefined {
  return workspaceLookup(state, state.config?.themePreferences?.workspaceAccents)?.[1];
}

/** The project or repository key whose own theme applies right now, if any. */
export function activeWorkspaceThemeKey(state: WorkspaceState): string | undefined {
  return workspaceLookup(state, state.config?.themePreferences?.workspaceThemes)?.[0];
}

export function applyWorkspaceAccent(value?: string): void {
  const root = document.documentElement;
  const accent = normalizeThemeHex(value);
  root.toggleAttribute("data-workspace-accent", Boolean(accent));
  if (accent) root.style.setProperty("--workspace-accent", accent);
  else root.style.removeProperty("--workspace-accent");
}

let fontSizePref = editorFontSize(undefined);
let formatOnSavePref = true;
let showMinimapPref = true;
let chatDensityPref = parseChatDensity(undefined);

let customThemesPref: readonly CustomTheme[] = [];
let customThemesCssText = "";
const CUSTOM_STYLE_ID = "locus-custom-themes";
const FONT_LINK_ATTR = "data-locus-theme-font";
/** Cap on web fonts generated themes may pull in at once. */
const MAX_THEME_FONTS = 24;
let draftFonts: string[] = [];
/** Fonts for the active crafted built-in; cards fall back to the preset stack. */
let craftedFonts: string[] = [];
const CRAFTED_STYLE_ID = "locus-crafted-themes";

/**
 * Installs the CSS for built-ins kept as data (token themes) and as engine
 * specs (crafted themes) once. It goes in before generated themes so a
 * generated theme can never be shadowed by it.
 */
export function ensureCraftedThemeCss(): void {
  if (typeof document === "undefined" || document.getElementById(CRAFTED_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = CRAFTED_STYLE_ID;
  el.textContent = `${tokenThemesCss()}\n${craftedThemesCss()}`;
  const custom = document.getElementById(CUSTOM_STYLE_ID);
  if (custom) document.head.insertBefore(el, custom);
  else document.head.appendChild(el);
}

/**
 * Adds a Google Fonts stylesheet for each family a generated theme names. Names
 * are validated to letters, digits and spaces in shared; the URL is built there.
 * Links are only ever added, so switching themes does not flash fonts out.
 */
function syncThemeFonts(): void {
  if (typeof document === "undefined") return;
  const wanted = new Set<string>([...draftFonts, ...craftedFonts]);
  for (const theme of customThemesPref) for (const f of customThemeWebFonts(theme)) wanted.add(f);
  const have = new Set(
    [...document.querySelectorAll(`link[${FONT_LINK_ATTR}]`)].map((el) =>
      el.getAttribute(FONT_LINK_ATTR),
    ),
  );
  let count = have.size;
  for (const family of wanted) {
    if (have.has(family) || count >= MAX_THEME_FONTS) continue;
    const href = webFontHref(family);
    if (!href) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute(FONT_LINK_ATTR, family);
    document.head.appendChild(link);
    count += 1;
  }
}

/**
 * Installs CSS for every generated theme, so cards, previews and the app can
 * all use them. Specs are validated data; customThemesCss() is the only writer.
 */
export function setCustomThemes(themes?: readonly CustomTheme[]): void {
  ensureCraftedThemeCss();
  if (themes === customThemesPref && document.getElementById(CUSTOM_STYLE_ID)) return;
  customThemesPref = themes ?? [];
  syncThemeFonts();
  const css = customThemesCss(customThemesPref);
  if (css === customThemesCssText && document.getElementById(CUSTOM_STYLE_ID)) return;
  customThemesCssText = css;
  let el = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = CUSTOM_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

const DRAFT_STYLE_ID = "locus-custom-theme-draft";

/** CSS scoped to an editing or import preview, including when its id is already applied. */
export function setDraftThemeCss(theme: CustomTheme | null): void {
  let el = document.getElementById(DRAFT_STYLE_ID) as HTMLStyleElement | null;
  draftFonts = theme ? customThemeWebFonts(theme) : [];
  syncThemeFonts();
  if (!theme) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = DRAFT_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = customThemeCss(theme, true);
}

export function customThemesPrefValue(): readonly CustomTheme[] {
  return customThemesPref;
}

/** Data attributes that paint a surface (card, preview, or the app) with a theme. */
export function themeSurfaceAttrs(
  value: string | undefined,
  customThemes: readonly CustomTheme[] = customThemesPref,
): Record<string, string> {
  const custom = findCustomTheme(value, customThemes);
  if (custom) {
    return {
      "data-theme": custom.id,
      "data-theme-custom": "",
      ...(custom.base ? { "data-theme-style": custom.base } : {}),
    };
  }
  const opt = themeOption(resolveTheme(value));
  return {
    "data-theme": opt.id,
    ...(opt.gradient ? { "data-theme-gradient": "" } : {}),
    ...(opt.terminal ? { "data-theme-terminal": "" } : {}),
    ...(opt.style ? { "data-theme-style": opt.style } : {}),
  };
}

/** Display name for a built-in or generated theme. */
export function themeDisplayName(
  value: string | undefined,
  customThemes: readonly CustomTheme[] = customThemesPref,
): string {
  return findCustomTheme(value, customThemes)?.name ?? themeOption(resolveTheme(value)).name;
}

export function applyTheme(value?: string, customThemes?: readonly CustomTheme[]): ThemeRef {
  if (customThemes) setCustomThemes(customThemes);
  ensureCraftedThemeCss();
  const root = document.documentElement;
  const custom = findCustomTheme(value, customThemesPref);
  if (custom) {
    root.dataset.theme = custom.id;
    // Adaptive themes set color-scheme from CSS, per system setting.
    root.style.colorScheme = custom.adaptive ? "" : custom.scheme;
    root.dataset.themeCustom = "";
    delete root.dataset.chatScene;
    delete root.dataset.themeGradient;
    delete root.dataset.themeTerminal;
    if (custom.base) root.dataset.themeStyle = custom.base;
    else delete root.dataset.themeStyle;
    window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
    return custom.id;
  }
  delete root.dataset.themeCustom;
  const id = resolveTheme(value);
  const opt = themeOption(id);
  const fonts = craftedThemeWebFonts(id);
  if (fonts.join() !== craftedFonts.join()) {
    craftedFonts = fonts;
    syncThemeFonts();
  }
  root.dataset.theme = id;
  root.style.colorScheme = opt.adaptive ? "" : opt.scheme;
  if (opt.chatScene) root.dataset.chatScene = "";
  else delete root.dataset.chatScene;
  if (opt.gradient) root.dataset.themeGradient = "";
  else delete root.dataset.themeGradient;
  if (opt.terminal) root.dataset.themeTerminal = "";
  else delete root.dataset.themeTerminal;
  if (opt.style) root.dataset.themeStyle = opt.style;
  else delete root.dataset.themeStyle;
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
  return id;
}

export function applyEditorPrefs(
  raw?: number,
  formatOnSave?: boolean,
  showMinimap?: boolean,
): number {
  const size = editorFontSize(raw);
  fontSizePref = size;
  const root = document.documentElement;
  root.style.setProperty("--editor-font-size", `${size}px`);
  root.style.setProperty("--editor-line-height", `${Math.round(size * 1.5)}px`);
  formatOnSavePref = formatOnSave !== false;
  showMinimapPref = showMinimap !== false;
  return size;
}

export function editorFontSizePx(): number {
  return fontSizePref;
}

export function editorFormatOnSave(): boolean {
  return formatOnSavePref;
}

export function editorShowMinimap(): boolean {
  return showMinimapPref;
}

export function applyChatDensity(raw?: unknown): ChatDensity {
  const density = parseChatDensity(raw);
  chatDensityPref = density;
  document.documentElement.dataset.chatDensity = density;
  return density;
}

export function chatDensityPrefValue(): ChatDensity {
  return chatDensityPref;
}
