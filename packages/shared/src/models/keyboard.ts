/** Transport-neutral keyboard input. Text/IME composition uses insertText instead. */
export interface ComputerKey {
  key: string;
  code?: string;
  modifiers?: number;
  windowsVirtualKeyCode?: number;
}

const MODIFIERS: Record<string, number> = {
  alt: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  super: 4,
  win: 4,
  cmd: 4,
  shift: 8,
};
const KEYS: Record<string, [string, string, number]> = {
  enter: ["Enter", "Enter", 13],
  return: ["Enter", "Enter", 13],
  tab: ["Tab", "Tab", 9],
  escape: ["Escape", "Escape", 27],
  esc: ["Escape", "Escape", 27],
  backspace: ["Backspace", "Backspace", 8],
  delete: ["Delete", "Delete", 46],
  space: [" ", "Space", 32],
  left: ["ArrowLeft", "ArrowLeft", 37],
  right: ["ArrowRight", "ArrowRight", 39],
  up: ["ArrowUp", "ArrowUp", 38],
  down: ["ArrowDown", "ArrowDown", 40],
  home: ["Home", "Home", 36],
  end: ["End", "End", 35],
  pageup: ["PageUp", "PageUp", 33],
  pagedown: ["PageDown", "PageDown", 34],
};

export function computerKey(input: string): ComputerKey {
  const parts = input.split("+");
  let modifiers = 0;
  while (parts.length > 1 && MODIFIERS[parts[0]!.toLowerCase()] !== undefined) {
    modifiers |= MODIFIERS[parts.shift()!.toLowerCase()]!;
  }
  const raw = parts.join("+");
  const named = KEYS[raw.toLowerCase().replace(/^arrow/, "")];
  if (named) return { key: named[0], code: named[1], windowsVirtualKeyCode: named[2], modifiers };
  if (/^[a-z]$/i.test(raw))
    return {
      key: modifiers & 8 ? raw.toUpperCase() : raw.toLowerCase(),
      code: `Key${raw.toUpperCase()}`,
      windowsVirtualKeyCode: raw.toUpperCase().charCodeAt(0),
      modifiers,
    };
  if (/^[0-9]$/.test(raw))
    return { key: raw, code: `Digit${raw}`, windowsVirtualKeyCode: raw.charCodeAt(0), modifiers };
  if (/^f([1-9]|1[0-2])$/i.test(raw))
    return {
      key: raw.toUpperCase(),
      code: raw.toUpperCase(),
      windowsVirtualKeyCode: 111 + Number(raw.slice(1)),
      modifiers,
    };
  return { key: raw, modifiers };
}

export function x11Key(input: string): string {
  const event = computerKey(input);
  const names: Record<string, string> = {
    Enter: "Return",
    " ": "space",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    ArrowDown: "Down",
    PageUp: "Prior",
    PageDown: "Next",
  };
  return [
    ...(event.modifiers! & 2 ? ["ctrl"] : []),
    ...(event.modifiers! & 1 ? ["alt"] : []),
    ...(event.modifiers! & 4 ? ["super"] : []),
    ...(event.modifiers! & 8 ? ["shift"] : []),
    names[event.key] ?? event.key,
  ].join("+");
}

export function windowsSendKey(input: string): string {
  // Preserve legacy SendKeys syntax, including ^a and {ENTER}.
  if (/^[\^%{]/.test(input)) return input;
  const event = computerKey(input);
  if (event.modifiers! & 4)
    throw new Error("Windows-key combinations require desktop UI Automation or native input.");
  const names: Record<string, string> = {
    Enter: "ENTER",
    Escape: "ESC",
    Backspace: "BACKSPACE",
    Delete: "DELETE",
    ArrowLeft: "LEFT",
    ArrowRight: "RIGHT",
    ArrowUp: "UP",
    ArrowDown: "DOWN",
    PageUp: "PGUP",
    PageDown: "PGDN",
  };
  const key =
    event.key.length === 1
      ? /^[+^%~(){}]$/.test(event.key)
        ? `{${event.key}}`
        : event.key
      : `{${names[event.key] ?? event.key.toUpperCase()}}`;
  return `${event.modifiers! & 2 ? "^" : ""}${event.modifiers! & 1 ? "%" : ""}${event.modifiers! & 8 ? "+" : ""}${key}`;
}
