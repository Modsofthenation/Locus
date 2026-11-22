import {
  editorFontSize,
  parseChatDensity,
  resolveTheme,
  customThemeCss,
  customThemesCss,
  customThemeWebFonts,
  webFontHref,
  findCustomTheme,
  themeOption,
  type ChatDensity,
  type CustomTheme,
  type ThemeRef,
} from "@locus/shared";

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

/**
 * Adds a Google Fonts stylesheet for each family a generated theme names. Names
 * are validated to letters, digits and spaces in shared; the URL is built there.
 * Links are only ever added, so switching themes does not flash fonts out.
 */
function syncThemeFonts(): void {
  if (typeof document === "undefined") return;
  const wanted = new Set<string>(draftFonts);
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

/** CSS for the theme open in the editor; it layers over the saved copy for live preview. */
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
  el.textContent = customThemeCss(theme);
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
  const root = document.documentElement;
  const custom = findCustomTheme(value, customThemesPref);
  if (custom) {
    root.dataset.theme = custom.id;
    root.style.colorScheme = custom.scheme;
    root.dataset.themeCustom = "";
    delete root.dataset.chatScene;
    delete root.dataset.themeGradient;
    delete root.dataset.themeTerminal;
    if (custom.base) root.dataset.themeStyle = custom.base;
    else delete root.dataset.themeStyle;
    return custom.id;
  }
  delete root.dataset.themeCustom;
  const id = resolveTheme(value);
  const opt = themeOption(id);
  root.dataset.theme = id;
  root.style.colorScheme = opt.scheme;
  if (opt.chatScene) root.dataset.chatScene = "";
  else delete root.dataset.chatScene;
  if (opt.gradient) root.dataset.themeGradient = "";
  else delete root.dataset.themeGradient;
  if (opt.terminal) root.dataset.themeTerminal = "";
  else delete root.dataset.themeTerminal;
  if (opt.style) root.dataset.themeStyle = opt.style;
  else delete root.dataset.themeStyle;
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
