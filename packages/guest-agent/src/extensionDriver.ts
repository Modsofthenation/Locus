import {
  CHROMIUM_VIEWPORT,
  LIVE_CHROME_DISCONNECTED,
  LIVE_CHROME_UNSUPPORTED,
  type BrowserInputMessage,
  type BrowserTab,
} from "@locus/shared";
import type { ChromiumDriver, ScreencastFrame } from "./chromium.js";
import type { ToolRequest, ToolResult } from "./types.js";

export type ExtensionRpc = {
  connected: () => boolean;
  call: (req: ToolRequest, tabId?: string) => Promise<ToolResult>;
  listTabs: () => Promise<BrowserTab[]>;
  startScreencast: (onFrame: (frame: ScreencastFrame) => void) => Promise<void>;
  stopScreencast: () => Promise<void>;
  dispatchInput: (event: BrowserInputMessage) => Promise<void>;
};

export class ExtensionChromiumDriver implements ChromiumDriver {
  constructor(private readonly rpc: ExtensionRpc) {}

  async handle(req: ToolRequest): Promise<ToolResult> {
    if (!this.rpc.connected()) {
      return { ok: false, output: LIVE_CHROME_DISCONNECTED };
    }
    if (
      req.name === "browser_pdf" ||
      req.name === "browser_trace" ||
      req.name === "browser_download"
    ) {
      return { ok: false, output: LIVE_CHROME_UNSUPPORTED };
    }
    return this.rpc.call(req);
  }

  async navigate(url: string): Promise<ToolResult> {
    return this.handle({ name: "browser_navigate", args: { url } });
  }

  async listPages(): Promise<BrowserTab[]> {
    if (!this.rpc.connected()) return [];
    return this.rpc.listTabs();
  }

  async startScreencast(onFrame: (frame: ScreencastFrame) => void): Promise<void> {
    if (!this.rpc.connected()) throw new Error(LIVE_CHROME_DISCONNECTED);
    await this.rpc.startScreencast(onFrame);
  }

  async stopScreencast(): Promise<void> {
    await this.rpc.stopScreencast();
  }

  async dispatchInput(event: BrowserInputMessage): Promise<void> {
    if (!this.rpc.connected()) throw new Error(LIVE_CHROME_DISCONNECTED);
    await this.rpc.dispatchInput(event);
  }

  async listDownloads(): Promise<string[]> {
    return [];
  }
}

export function extensionFrameFromMessage(message: {
  mime?: string;
  data?: string;
  metadata?: {
    deviceWidth?: number;
    deviceHeight?: number;
    offsetTop?: number;
    pageScaleFactor?: number;
  };
}): ScreencastFrame | undefined {
  if (!message.data) return undefined;
  return {
    data: message.data,
    mime: "image/jpeg",
    sessionId: 0,
    metadata: {
      offsetTop: Number(message.metadata?.offsetTop) || 0,
      pageScaleFactor: Number(message.metadata?.pageScaleFactor) || 1,
      deviceWidth: Number(message.metadata?.deviceWidth) || CHROMIUM_VIEWPORT.width,
      deviceHeight: Number(message.metadata?.deviceHeight) || CHROMIUM_VIEWPORT.height,
    },
  };
}
