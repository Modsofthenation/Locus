import {
  parseBrowserServerMessage,
  type BrowserClientMessage,
  type BrowserInputMessage,
  type BrowserTab,
} from "@locus/shared";
import type { ChromiumDriver, ScreencastFrame, ToolRequest, ToolResult } from "@locus/guest-agent";
import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";

export interface WorkerBrowserLink {
  execute(id: string, req: ToolRequest, signal?: AbortSignal): Promise<ToolResult>;
  openBrowserSocket(id: string, onMessage: (raw: string) => void): Promise<WebSocket>;
}

const READY_MS = 8_000;

/** Laptop-side ChromiumDriver: screencast/input over pinned worker WSS, files via tools HTTP. */
export class WorkerBrowserDriver implements ChromiumDriver {
  private socket?: WebSocket;
  private onFrame?: (frame: ScreencastFrame) => void;
  private tabs: BrowserTab[] = [];
  private files: string[] = [];
  private ready?: { resolve: () => void; reject: (err: Error) => void };
  private opened: { ready: boolean; error?: Error } = { ready: false };
  private pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

  constructor(
    private readonly link: WorkerBrowserLink,
    private readonly vmId: string,
  ) {}

  async handle(req: ToolRequest): Promise<ToolResult> {
    return this.link.execute(this.vmId, req);
  }

  async navigate(url: string): Promise<ToolResult> {
    return this.link.execute(this.vmId, { name: "browser_navigate", args: { url } });
  }

  async startScreencast(onFrame: (frame: ScreencastFrame) => void): Promise<void> {
    this.onFrame = onFrame;
    if (this.socket && this.socket.readyState === 1) return;
    this.opened = { ready: false };
    const socket = await this.link.openBrowserSocket(this.vmId, (raw) => this.onMessage(raw));
    this.socket = socket;
    socket.on("close", () => {
      for (const pending of this.pending.values())
        pending.reject(new Error("Worker browser WS closed"));
      this.pending.clear();
      if (this.socket === socket) this.socket = undefined;
      this.ready?.reject(new Error("Worker browser WS closed"));
      this.ready = undefined;
    });
    socket.on("error", () => {
      this.ready?.reject(new Error("Worker browser WS failed"));
      this.ready = undefined;
    });
    if (this.opened.error) throw this.opened.error;
    if (this.opened.ready) return;
    await this.waitReady();
  }

  async stopScreencast(): Promise<void> {
    for (const pending of this.pending.values())
      pending.reject(new Error("Worker browser stopped"));
    this.pending.clear();
    this.onFrame = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.ready = undefined;
    socket?.close();
  }

  async listPages(): Promise<BrowserTab[]> {
    return this.tabs;
  }

  async listDownloads(): Promise<string[]> {
    return this.files;
  }

  async copyDownload(name?: string): Promise<ToolResult> {
    return this.link.execute(this.vmId, {
      name: "browser_download",
      args: { action: "get", filename: name ?? "" },
    });
  }

  async dispatchInput(event: BrowserInputMessage): Promise<void> {
    await this.request(event);
  }

  async releaseInput(): Promise<void> {
    if (this.socket?.readyState === 1) await this.request({ type: "release-input" });
  }
  async invalidateObservation(): Promise<void> {
    if (this.socket?.readyState === 1) await this.request({ type: "invalidate-observation" });
    else await this.link.execute(this.vmId, { name: "browser_snapshot", args: {} });
  }
  private request(message: BrowserClientMessage): Promise<void> {
    if (this.socket?.readyState !== 1)
      return Promise.reject(new Error("Worker browser is disconnected"));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Worker browser action timed out"));
      }, READY_MS);
      this.pending.set(requestId, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.send({ ...message, requestId });
    });
  }

  private send(message: BrowserClientMessage): void {
    if (this.socket?.readyState !== 1) return;
    this.socket.send(JSON.stringify(message));
  }

  private onMessage(raw: string): void {
    const message = parseBrowserServerMessage(raw);
    if (!message) return;
    if (message.type === "action-result") {
      const pending = this.pending.get(message.requestId);
      this.pending.delete(message.requestId);
      if (message.ok) pending?.resolve();
      else pending?.reject(new Error(message.output ?? "Worker browser action failed"));
      return;
    }
    if (message.type === "frame") {
      this.onFrame?.({
        data: message.data,
        mime: "image/jpeg",
        sessionId: 0,
        metadata: {
          offsetTop: message.metadata.offsetTop ?? 0,
          pageScaleFactor: message.metadata.pageScaleFactor ?? 1,
          deviceWidth: message.metadata.deviceWidth,
          deviceHeight: message.metadata.deviceHeight,
        },
      });
      return;
    }
    if (message.type === "tabs") {
      this.tabs = message.tabs;
      return;
    }
    if (message.type === "downloads") {
      this.files = message.files;
      return;
    }
    if (message.type !== "status") return;
    if (message.error) {
      const err = new Error(message.error);
      this.opened.error = err;
      this.ready?.reject(err);
      this.ready = undefined;
      return;
    }
    if (message.ready) {
      this.opened.ready = true;
      this.ready?.resolve();
      this.ready = undefined;
    }
  }

  private waitReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ready = undefined;
        reject(new Error("Worker browser WS timed out"));
      }, READY_MS);
      this.ready = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
    });
  }
}
