import { computerKey } from "@locus/shared";
import type { ToolRequest } from "./types.js";
import { num, optNum, str } from "./types.js";

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Select a native Wayland backend; never silently inject only into XWayland. */
export function waylandOrX11(req: ToolRequest, x11: string): string {
  const move = (x: number, y: number) =>
    `ydotool mousemove --absolute -x ${Math.round(x)} -y ${Math.round(y)}`;
  const optionalMove =
    optNum(req.args, "x") !== undefined && optNum(req.args, "y") !== undefined
      ? `${move(num(req.args, "x"), num(req.args, "y"))} && `
      : "";
  let command: string;
  switch (req.name) {
    case "type_text":
      command = `wtype -- ${quote(str(req.args, "text"))}`;
      break;
    case "key": {
      const key = computerKey(str(req.args, "key"));
      const modifiers = [
        [2, "ctrl"],
        [1, "alt"],
        [4, "logo"],
        [8, "shift"],
      ] as const;
      const held = modifiers.filter(([bit]) => (key.modifiers ?? 0) & bit).map(([, name]) => name);
      const names: Record<string, string> = {
        Enter: "Return",
        ArrowLeft: "Left",
        ArrowRight: "Right",
        ArrowUp: "Up",
        ArrowDown: "Down",
        " ": "space",
      };
      command = `wtype ${held.map((m) => `-M ${m}`).join(" ")} -k ${quote(names[key.key] ?? key.key)} ${held
        .reverse()
        .map((m) => `-m ${m}`)
        .join(" ")}`;
      break;
    }
    case "mouse_move":
      command = move(num(req.args, "x"), num(req.args, "y"));
      break;
    case "mouse_click": {
      const button = num(req.args, "button", 1);
      command = `${optionalMove}ydotool click --repeat ${Math.max(1, Math.min(3, Math.round(num(req.args, "count", 1))))} ${button === 3 ? "0xC1" : button === 2 ? "0xC2" : "0xC0"}`;
      break;
    }
    case "mouse_drag":
      command = `${optNum(req.args, "x1") !== undefined ? `${move(num(req.args, "x1"), num(req.args, "y1"))} && ` : ""}ydotool click 0x40 && ${move(num(req.args, "x2"), num(req.args, "y2"))} && ydotool click 0x80`;
      break;
    case "mouse_scroll":
      command = `${optionalMove}ydotool mousemove --wheel ${str(req.args, "axis") === "horizontal" ? "-x" : "-y"} ${-Math.round(num(req.args, "delta"))}`;
      break;
    case "clipboard_get":
      command = "wl-paste --no-newline";
      break;
    case "clipboard_set":
      command = `printf %s ${quote(str(req.args, "text"))} | wl-copy`;
      break;
    case "window_list":
      command = "hyprctl clients -j";
      break;
    case "window_focus":
      command = `hyprctl dispatch focuswindow ${quote("title:^" + str(req.args, "title").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$")}`;
      break;
    default:
      return x11;
  }
  return `if [ -n "$WAYLAND_DISPLAY" ]; then ${command}; else ${x11}; fi`;
}
