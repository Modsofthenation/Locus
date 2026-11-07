export const GUEST_SCREEN = { width: 1920, height: 1080 };

export interface ToolOverlay {
  sessionId: string;
  name: string;
  x?: number;
  y?: number;
  key?: string;
  text?: string;
  title?: string;
}

/** Scale overlay coordinates onto this screen. Docker Chromium is 1280×800. */
export function overlayPosition(
  overlay: Pick<ToolOverlay, "x" | "y">,
  screen: { width: number; height: number } = GUEST_SCREEN,
): { left: string; top: string } {
  const left = overlay.x != null ? `${(overlay.x / screen.width) * 100}%` : "50%";
  const top = overlay.y != null ? `${(overlay.y / screen.height) * 100}%` : "50%";
  return { left, top };
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return undefined;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function overlayFromTool(
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): ToolOverlay | undefined {
  if (name === "mouse_move" || name === "mouse_click" || name === "mouse_scroll") {
    const x = num(args, "x");
    const y = num(args, "y");
    if (x == null && y == null) return { sessionId, name };
    return { sessionId, name, x, y };
  }
  if (name === "mouse_drag") {
    return { sessionId, name, x: num(args, "x2"), y: num(args, "y2") };
  }
  if (name === "key") return { sessionId, name, key: str(args, "key") };
  if (name === "type_text") return { sessionId, name, text: str(args, "text") };
  if (name === "window_focus") return { sessionId, name, title: str(args, "title") };
  if (name.startsWith("browser_"))
    return { sessionId, name, title: str(args, "url") ?? str(args, "ref") };
  const command = str(args, "command");
  if (
    (name === "exec" || name === "start_process") &&
    command &&
    /^https?:\/\/\S+$/i.test(command)
  ) {
    return { sessionId, name, title: command };
  }
  return undefined;
}
