import {
  editorFontSize,
  parseChatDensity,
  resolveTheme,
  themeOption,
  type ChatDensity,
  type ThemeId,
} from "@locus/shared";

let fontSizePref = editorFontSize(undefined);
let formatOnSavePref = true;
let showMinimapPref = true;
let chatDensityPref = parseChatDensity(undefined);

export function applyTheme(value?: string): ThemeId {
  const id = resolveTheme(value);
  const opt = themeOption(id);
  const root = document.documentElement;
  root.dataset.theme = id;
  root.style.colorScheme = opt.scheme;
  if (opt.chatScene) root.dataset.chatScene = "";
  else delete root.dataset.chatScene;
  if (opt.gradient) root.dataset.themeGradient = "";
  else delete root.dataset.themeGradient;
  if (opt.terminal) root.dataset.themeTerminal = "";
  else delete root.dataset.themeTerminal;
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
