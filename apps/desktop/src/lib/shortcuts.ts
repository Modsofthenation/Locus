/** One registry for the cheat sheet, palette hints, and keydown handlers. */

export type Shortcut = {
  id: string;
  keys: string;
  action: string;
};

export const SHORTCUTS: Shortcut[] = [
  {
    id: "new",
    keys: "Ctrl/Cmd+N",
    action: "New agent, workspace, job, design, game, asset, board, or project",
  },
  { id: "palette", keys: "Ctrl/Cmd+K", action: "Command palette" },
  { id: "inline-ai", keys: "Ctrl/Cmd+Shift+K", action: "Inline AI in the files editor" },
  { id: "goto-file", keys: "Ctrl/Cmd+P", action: "Go to file" },
  { id: "goto-symbol", keys: "Ctrl/Cmd+T", action: "Go to symbol" },
  { id: "search-files", keys: "Ctrl/Cmd+Shift+F", action: "Search in files" },
  { id: "terminal", keys: "Ctrl/Cmd+`", action: "Toggle workspace terminal" },
  { id: "settings", keys: "Ctrl/Cmd+,", action: "Settings" },
  { id: "find", keys: "Ctrl/Cmd+F", action: "Find in chat or the open file" },
  { id: "jump-agent", keys: "Ctrl/Cmd+1–9", action: "Jump to agent" },
  { id: "jump-section", keys: "Alt+1–9", action: "Jump to sidebar section" },
  { id: "goto-def", keys: "F12", action: "Go to definition" },
  { id: "goto-type", keys: "Alt+F12", action: "Go to type definition" },
  { id: "quick-fix", keys: "Ctrl/Cmd+.", action: "Quick Fix" },
  { id: "close-tab", keys: "Ctrl/Cmd+W", action: "Close editor tab" },
  { id: "split", keys: "Ctrl/Cmd+\\", action: "Split editor" },
  { id: "save", keys: "Ctrl/Cmd+S", action: "Save the open file" },
  { id: "save-all", keys: "Ctrl/Cmd+Shift+S", action: "Save all" },
  { id: "undo", keys: "Ctrl/Cmd+Z", action: "Undo in the files editor or design canvas" },
  { id: "redo", keys: "Ctrl/Cmd+Shift+Z", action: "Redo in the files editor or design canvas" },
  { id: "rename", keys: "F2", action: "Rename symbol" },
  { id: "complete", keys: "Ctrl+Space", action: "Trigger editor completions" },
  { id: "format", keys: "Alt+Shift+F", action: "Format the open file" },
  { id: "skip-target", keys: "Tab then Enter", action: "Skip to chat or files" },
  { id: "game-keys", keys: "R P D M", action: "Game reset, pause, debug, mute" },
  {
    id: "board-tools",
    keys: "V H N T R L F C",
    action: "Board select, pan, sticky, text, shape, connector, frame, comment",
  },
  { id: "board-fit", keys: "Ctrl/Cmd+0", action: "Zoom board to fit" },
  {
    id: "board-layer",
    keys: "Ctrl/Cmd+] [",
    action: "Bring board objects forward or send backward",
  },
];

const BY_ID = new Map(SHORTCUTS.map((row) => [row.id, row]));

export function shortcutById(id: string): Shortcut | undefined {
  return BY_ID.get(id);
}

export function shortcutKeys(id: string): string {
  return BY_ID.get(id)?.keys ?? "";
}

export function shortcutHint(id: string, suffix?: string): string {
  const keys = shortcutKeys(id);
  if (!keys) return suffix ?? "";
  return suffix ? `${keys} ${suffix}` : keys;
}

export function shortcutDisplay(keys: string, platform = defaultPlatform()): string {
  if (/Mac|iPhone|iPad/i.test(platform)) return keys.replaceAll("Ctrl/Cmd", "⌘");
  return keys.replaceAll("Ctrl/Cmd+", "Ctrl+").replaceAll("Ctrl/Cmd", "Ctrl");
}

/** Alt/Option key label for the current platform ("⌥" on Mac, "Alt+" elsewhere). */
export function altKeyDisplay(platform = defaultPlatform()): string {
  return /Mac|iPhone|iPad/i.test(platform) ? "⌥" : "Alt+";
}

export function isModKey(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">): boolean {
  return event.metaKey || event.ctrlKey;
}

/** Modifier chord: Ctrl/Cmd + key, optionally Shift. Ignores Alt. */
export function matchModKey(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  key: string,
  shift = false,
): boolean {
  if (!isModKey(event) || event.altKey) return false;
  if (Boolean(event.shiftKey) !== shift) return false;
  if (key === ",") return event.key === ",";
  if (key === "`") return event.key === "`";
  if (key === ".") return event.key === ".";
  if (key === "\\") return event.key === "\\";
  return event.key.toLowerCase() === key.toLowerCase();
}

export function matchModDigit(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): string | null {
  if (!isModKey(event) || event.shiftKey || event.altKey) return null;
  return /^[1-9]$/.test(event.key) ? event.key : null;
}

/** Alt+1–9, without Ctrl/Cmd/Shift — used for the icon rail. */
export function matchAltDigit(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): string | null {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return null;
  return /^[1-9]$/.test(event.key) ? event.key : null;
}

function defaultPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.platform;
}
