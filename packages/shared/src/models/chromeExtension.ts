import { sessionPlacement, type AgentPlacement } from "./placement.js";
import { sessionRuntime, type AgentRuntime } from "./vm.js";
import type { BrowserTab } from "./browser.js";

/** Vaulted pairing for the unpacked Chrome extension. Loopback only. */
export interface ChromeExtensionSettings {
  enabled: boolean;
  token?: string;
}

export const CHROME_EXTENSION_TOKEN_PREFIX = "cx_";

export function generateChromeExtensionToken(randomHex: () => string): string {
  return `${CHROME_EXTENSION_TOKEN_PREFIX}${randomHex()}`;
}

export function formatChromeExtensionToken(token: string): string {
  const raw = token.replace(/^cx_/i, "").replace(/[^0-9a-f]/gi, "");
  const groups = raw.match(/.{1,4}/g) ?? [raw];
  return groups.join("-").toUpperCase();
}

export function isChromeExtensionOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).protocol === "chrome-extension:";
  } catch {
    return false;
  }
}

export function isChromeExtensionApiPath(path: string): boolean {
  return (
    path === "/api/chrome-extension" ||
    path.startsWith("/api/chrome-extension/") ||
    path === "/ws/chrome-extension"
  );
}

/** Host agents on this machine may drive the operator's real Chrome tabs. */
export function sessionLiveChrome(session: {
  liveChrome?: boolean;
  runtime?: AgentRuntime;
  placement?: AgentPlacement;
}): boolean {
  return (
    session.liveChrome === true &&
    sessionRuntime(session) === "host" &&
    sessionPlacement(session) !== "worker"
  );
}

export function formatLiveChrome(on: boolean): string {
  return on ? "On" : "Off";
}

export const LIVE_CHROME_DISCONNECTED =
  "Chrome extension is not connected. Load the Locus unpacked extension (Settings → Chrome), pair it, or turn off Use my Chrome to use isolated host-chrome.";

export const LIVE_CHROME_RESTRICTED =
  "Live Chrome cannot open chrome://, edge://, about:, or extension pages. Use a normal http(s) tab.";

export const LIVE_CHROME_UNSUPPORTED =
  "Live Chrome does not support this tool. Use isolated host-chrome, or pick screenshot / snapshot / click / type / tabs / navigate.";

const RESTRICTED = /^(chrome|edge|devtools|chrome-extension|moz-extension|about|view-source):/i;

export function isLiveChromeRestrictedUrl(url: string | undefined): boolean {
  const raw = url?.trim() ?? "";
  if (!raw) return false;
  return RESTRICTED.test(raw);
}

export type ChromeExtensionHelloMessage = {
  type: "hello";
  token: string;
  version?: number;
};

export type ChromeExtensionTabsMessage = {
  type: "tabs";
  tabs: BrowserTab[];
};

export type ChromeExtensionResultMessage = {
  type: "result";
  id: string;
  ok: boolean;
  output: string;
  image?: { mime: "image/png" | "image/jpeg"; data: string };
};

export type ChromeExtensionFrameMessage = {
  type: "frame";
  mime: "image/jpeg" | "image/png";
  data: string;
  metadata: {
    deviceWidth: number;
    deviceHeight: number;
    offsetTop?: number;
    pageScaleFactor?: number;
  };
};

export type ChromeExtensionPongMessage = { type: "pong" };

export type ChromeExtensionClientMessage =
  | ChromeExtensionHelloMessage
  | ChromeExtensionTabsMessage
  | ChromeExtensionResultMessage
  | ChromeExtensionFrameMessage
  | ChromeExtensionPongMessage;

export type ChromeExtensionHelloOkMessage = { type: "hello-ok" };
export type ChromeExtensionHelloErrorMessage = { type: "hello-error"; error: string };
export type ChromeExtensionCommandMessage = {
  type: "command";
  id: string;
  name: string;
  args: Record<string, unknown>;
  tabId?: string;
};
export type ChromeExtensionPingMessage = { type: "ping" };
export type ChromeExtensionScreencastMessage = { type: "screencast"; on: boolean };
export type ChromeExtensionInputRelayMessage = {
  type: "input";
  kind: string;
  x?: number;
  y?: number;
  button?: string;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  text?: string;
};

export type ChromeExtensionServerMessage =
  | ChromeExtensionHelloOkMessage
  | ChromeExtensionHelloErrorMessage
  | ChromeExtensionCommandMessage
  | ChromeExtensionPingMessage
  | ChromeExtensionScreencastMessage
  | ChromeExtensionInputRelayMessage;

export function parseChromeExtensionClientMessage(
  raw: string,
): ChromeExtensionClientMessage | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return undefined;
    const type = (value as { type?: unknown }).type;
    if (
      type === "hello" ||
      type === "tabs" ||
      type === "result" ||
      type === "frame" ||
      type === "pong"
    ) {
      return value as ChromeExtensionClientMessage;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function parseChromeExtensionServerMessage(
  raw: string,
): ChromeExtensionServerMessage | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return undefined;
    const type = (value as { type?: unknown }).type;
    if (
      type === "hello-ok" ||
      type === "hello-error" ||
      type === "command" ||
      type === "ping" ||
      type === "screencast" ||
      type === "input"
    ) {
      return value as ChromeExtensionServerMessage;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
