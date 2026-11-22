import { hostAllowed, type NetworkJail } from "./vm.js";

/** Headed Chromium in Docker (`--window-size=1280,800`). Not the VM desktop. */
export const CHROMIUM_VIEWPORT = { width: 1280, height: 800 };
/** Raster scale for the live pane. Layout stays `CHROMIUM_VIEWPORT` CSS pixels. */
export const CHROMIUM_DEVICE_SCALE = 2;

/** Bind-mounted Chromium profile. Survives container restart; wiped with the session. */
export const LOCUS_CHROME_PROFILE_DIR = ".locus-chrome";
export const LOCUS_CHROME_PROFILE_GUEST = `/workspace/${LOCUS_CHROME_PROFILE_DIR}`;
export const LOCUS_CHROME_DOWNLOADS_GUEST = "/tmp/locus-downloads";

/** Isolated host-runtime Chromium profile. Not the operator's real Chrome. */
export function hostChromeProfileDir(dataDir: string, sessionId: string): string {
  const id = sessionId.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80) || "session";
  return `${dataDir.replace(/[/\\]+$/, "")}/host-chrome/${id}`;
}

export interface BrowserTab {
  targetId: string;
  url: string;
  title?: string;
  active?: boolean;
}

export type BrowserController = "agent" | "operator";

export interface BrowserFrameMessage {
  type: "frame";
  mime: "image/jpeg" | "image/png";
  data: string;
  metadata: {
    deviceWidth: number;
    deviceHeight: number;
    offsetTop?: number;
    pageScaleFactor?: number;
  };
}

export interface BrowserTabsMessage {
  type: "tabs";
  tabs: BrowserTab[];
  url?: string;
}

export interface BrowserStatusMessage {
  type: "status";
  controller: BrowserController;
  ready?: boolean;
  error?: string;
  /** Hostname the restricted jail refused. Cleared when the URL is allowed or blank. */
  deniedHost?: string | null;
  jail?: NetworkJail;
  /** Isolated host-chrome vs the operator's real Chrome via the extension. */
  source?: "isolated" | "extension";
}

export interface BrowserDownloadsMessage {
  type: "downloads";
  files: string[];
  opened?: string;
}

export type BrowserServerMessage =
  | { type: "action-result"; requestId: string; ok: boolean; output?: string }
  | BrowserFrameMessage
  | BrowserTabsMessage
  | BrowserStatusMessage
  | BrowserDownloadsMessage;

export type BrowserInputKind =
  | "mouseMoved"
  | "mousePressed"
  | "mouseReleased"
  | "mouseWheel"
  | "keyDown"
  | "keyUp"
  | "insertText";

export interface BrowserInputMessage {
  type: "input";
  kind: BrowserInputKind;
  x?: number;
  y?: number;
  button?: "left" | "middle" | "right";
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  code?: string;
  modifiers?: number;
  windowsVirtualKeyCode?: number;
  text?: string;
}

export interface BrowserNavigateMessage {
  type: "navigate";
  url: string;
}

export interface BrowserTabActionMessage {
  type: "tab";
  action: "new" | "close" | "select";
  targetId?: string;
  url?: string;
}

export interface BrowserTakeoverMessage {
  type: "takeover";
}

export interface BrowserHandbackMessage {
  type: "handback";
}

export interface BrowserOpenDownloadMessage {
  type: "open-download";
  name: string;
}

export type BrowserClientMessage = (
  | { type: "invalidate-observation" }
  | { type: "release-input" }
  | BrowserInputMessage
  | BrowserNavigateMessage
  | BrowserTabActionMessage
  | BrowserTakeoverMessage
  | BrowserHandbackMessage
  | BrowserOpenDownloadMessage
) & { requestId?: string };

export const OPERATOR_HAS_BROWSER = "Operator has the browser. Wait for handback.";

export function isBrowserServerMessage(value: unknown): value is BrowserServerMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "frame" ||
    type === "tabs" ||
    type === "status" ||
    type === "downloads" ||
    type === "action-result"
  );
}

export function isBrowserClientMessage(value: unknown): value is BrowserClientMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const short = (v: unknown, max = 8192) => typeof v === "string" && v.length <= max;
  if (row.requestId !== undefined && !short(row.requestId, 100)) return false;
  if (
    row.type === "takeover" ||
    row.type === "handback" ||
    row.type === "release-input" ||
    row.type === "invalidate-observation"
  )
    return true;
  if (row.type === "navigate") return short(row.url);
  if (row.type === "open-download") return short(row.name, 255);
  if (row.type === "tab")
    return (
      ["new", "close", "select"].includes(String(row.action)) &&
      (row.targetId === undefined || short(row.targetId, 255)) &&
      (row.url === undefined || short(row.url))
    );
  if (
    row.type !== "input" ||
    ![
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
      "mouseWheel",
      "keyDown",
      "keyUp",
      "insertText",
    ].includes(String(row.kind))
  )
    return false;
  if (
    ["x", "y", "deltaX", "deltaY"].some(
      (k) =>
        row[k] !== undefined &&
        (typeof row[k] !== "number" ||
          !Number.isFinite(row[k]) ||
          Math.abs(row[k] as number) > 1e7),
    )
  )
    return false;
  if (
    row.modifiers !== undefined &&
    (!Number.isInteger(row.modifiers) || Number(row.modifiers) < 0 || Number(row.modifiers) > 15)
  )
    return false;
  if (row.button !== undefined && !["left", "middle", "right"].includes(String(row.button)))
    return false;
  if (
    row.clickCount !== undefined &&
    (!Number.isInteger(row.clickCount) || Number(row.clickCount) < 1 || Number(row.clickCount) > 3)
  )
    return false;
  if (row.code !== undefined && !short(row.code, 80)) return false;
  if (
    row.windowsVirtualKeyCode !== undefined &&
    (!Number.isInteger(row.windowsVirtualKeyCode) ||
      Number(row.windowsVirtualKeyCode) < 0 ||
      Number(row.windowsVirtualKeyCode) > 255)
  )
    return false;
  if (row.kind === "insertText") return short(row.text, 65536);
  if (row.kind === "keyDown" || row.kind === "keyUp") return short(row.key, 80);
  return true;
}

export function parseBrowserServerMessage(raw: string): BrowserServerMessage | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return isBrowserServerMessage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function parseBrowserClientMessage(raw: string): BrowserClientMessage | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return isBrowserClientMessage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function isOperatorDrivingBrowser(
  session: { browserControl?: string } | undefined,
): boolean {
  return session?.browserControl === "human";
}

export function browserUrlHost(url: string | undefined): string | undefined {
  const raw = url?.trim();
  if (!raw || raw === "about:blank") return undefined;
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (
      parsed.protocol === "about:" ||
      parsed.protocol === "data:" ||
      parsed.protocol === "blob:"
    ) {
      return undefined;
    }
    return parsed.hostname || undefined;
  } catch {
    return undefined;
  }
}

/** Restricted jail: hostname the CONNECT proxy will refuse. Localhost stays in-guest. */
export function browserDeniedHost(
  url: string | undefined,
  jail: NetworkJail | undefined,
  allow: string[],
): string | undefined {
  if (jail !== "restricted") return undefined;
  const host = browserUrlHost(url);
  if (!host) return undefined;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return undefined;
  if (hostAllowed(host, allow)) return undefined;
  return host;
}

export function mapCanvasToDevice(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const x = rect.width <= 0 ? 0 : ((clientX - rect.left) / rect.width) * viewport.width;
  const y = rect.height <= 0 ? 0 : ((clientY - rect.top) / rect.height) * viewport.height;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Docker tools that mean the guest Chromium is in play (switch the Browser tab). */
export function isDockerBrowserActivity(name: string, args: Record<string, unknown> = {}): boolean {
  if (
    name === "screenshot" ||
    name === "mouse_move" ||
    name === "mouse_click" ||
    name === "mouse_drag" ||
    name === "mouse_scroll" ||
    name === "key" ||
    name === "type_text" ||
    name.startsWith("browser_")
  ) {
    return true;
  }
  if (name === "exec" || name === "start_process") {
    const command = typeof args.command === "string" ? args.command.trim() : "";
    return /^https?:\/\/\S+$/i.test(command);
  }
  return false;
}

/** Agent tools that must wait while the operator has the Chromium lock. */
export function isMutatingBrowserTool(name: string, args: Record<string, unknown> = {}): boolean {
  if (
    name === "window_focus" ||
    name === "clipboard_set" ||
    name === "mouse_move" ||
    name === "mouse_click" ||
    name === "mouse_drag" ||
    name === "mouse_scroll" ||
    name === "key" ||
    name === "type_text" ||
    name === "browser_navigate" ||
    name === "browser_click" ||
    name === "browser_type" ||
    name === "browser_action"
  ) {
    return true;
  }
  if (name === "browser_tabs") {
    const action = typeof args.action === "string" ? args.action : "list";
    return action === "new" || action === "close" || action === "select";
  }
  if (name === "exec" || name === "start_process") {
    return isDockerBrowserActivity(name, args);
  }
  return false;
}
