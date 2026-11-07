import { randomUUID, timingSafeEqual } from "node:crypto";
import type { WebSocket } from "ws";
import {
  LIVE_CHROME_DISCONNECTED,
  parseChromeExtensionClientMessage,
  type BrowserInputMessage,
  type BrowserTab,
  type ChromeExtensionServerMessage,
  type ComputerUseToolName,
} from "@locus/shared";
import {
  ExtensionChromiumDriver,
  extensionFrameFromMessage,
  type ChromiumDriver,
  type ScreencastFrame,
  type ToolRequest,
  type ToolResult,
} from "@locus/guest-agent";

const CALL_TIMEOUT_MS = 20_000;

type Pending = {
  resolve: (result: ToolResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

function tokensMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export class ChromeExtensionHub {
  private sockets = new Set<WebSocket>();
  private pending = new Map<string, Pending>();
  private tabs: BrowserTab[] = [];
  private liveSessions = new Set<string>();
  private drivers = new Map<string, ExtensionChromiumDriver>();
  private onFrame?: (frame: ScreencastFrame) => void;
  private screencastViewers = 0;

  private token: string | undefined;

  constructor(expectedToken?: () => string | undefined) {
    this.token = expectedToken?.();
  }

  setToken(token: string | undefined): void {
    this.token = token?.trim() || undefined;
  }

  connected(): boolean {
    return [...this.sockets].some((ws) => ws.readyState === ws.OPEN);
  }

  setLiveChrome(sessionId: string, on: boolean): void {
    if (on) this.liveSessions.add(sessionId);
    else this.liveSessions.delete(sessionId);
  }

  driverFor(sessionId: string): ChromiumDriver | undefined {
    if (!this.liveSessions.has(sessionId)) return undefined;
    const existing = this.drivers.get(sessionId);
    if (existing) return existing;
    const driver = new ExtensionChromiumDriver({
      connected: () => this.connected(),
      call: (req) => this.call(req),
      listTabs: () => Promise.resolve(this.tabs),
      startScreencast: (onFrame) => this.startScreencast(onFrame),
      stopScreencast: () => this.stopScreencast(),
      dispatchInput: (event) => this.dispatchInput(event),
    });
    this.drivers.set(sessionId, driver);
    return driver;
  }

  attach(ws: WebSocket, token: string | undefined): void {
    if (!tokensMatch(token, this.token)) {
      ws.close(1008, "bad token");
      return;
    }
    this.sockets.add(ws);
    const drop = () => this.detach(ws);
    ws.on("close", drop);
    ws.on("error", drop);
    ws.on("message", (raw) => this.onMessage(String(raw)));
  }

  status(): { connected: boolean; tabs: BrowserTab[] } {
    return { connected: this.connected(), tabs: this.tabs };
  }

  private detach(ws: WebSocket): void {
    this.sockets.delete(ws);
    if (this.sockets.size === 0) {
      this.tabs = [];
      this.failPending(LIVE_CHROME_DISCONNECTED);
    }
  }

  private onMessage(raw: string): void {
    const message = parseChromeExtensionClientMessage(raw);
    if (!message) return;
    if (message.type === "hello") {
      if (!tokensMatch(message.token, this.token)) {
        this.send({ type: "hello-error", error: "bad token" });
        return;
      }
      this.send({ type: "hello-ok" });
      if (this.screencastViewers > 0) this.send({ type: "screencast", on: true });
      return;
    }
    if (message.type === "tabs") {
      this.tabs = message.tabs ?? [];
      return;
    }
    if (message.type === "frame") {
      const frame = extensionFrameFromMessage(message);
      if (frame) this.onFrame?.(frame);
      return;
    }
    if (message.type === "result") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      const result: ToolResult = { ok: message.ok, output: message.output };
      if (message.image?.data) {
        result.screenshotBase64 = message.image.data;
        result.output = message.output || "screenshot";
      }
      pending.resolve(result);
    }
  }

  private async call(req: ToolRequest): Promise<ToolResult> {
    if (!this.connected()) return { ok: false, output: LIVE_CHROME_DISCONNECTED };
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, output: "Chrome extension timed out" });
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      this.send({
        type: "command",
        id,
        name: req.name as ComputerUseToolName,
        args: req.args,
      });
    });
  }

  private async startScreencast(onFrame: (frame: ScreencastFrame) => void): Promise<void> {
    this.onFrame = onFrame;
    this.screencastViewers += 1;
    this.send({ type: "screencast", on: true });
  }

  private async stopScreencast(): Promise<void> {
    this.screencastViewers = Math.max(0, this.screencastViewers - 1);
    if (this.screencastViewers === 0) {
      this.onFrame = undefined;
      this.send({ type: "screencast", on: false });
    }
  }

  private async dispatchInput(event: BrowserInputMessage): Promise<void> {
    this.send({
      type: "input",
      kind: event.kind,
      x: event.x,
      y: event.y,
      button: event.button,
      clickCount: event.clickCount,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      key: event.key,
      text: event.text,
    });
    const mapped = inputToTool(event);
    if (mapped) await this.call(mapped);
  }

  private send(message: ChromeExtensionServerMessage): void {
    const raw = JSON.stringify(message);
    for (const ws of this.sockets) {
      if (ws.readyState === ws.OPEN) ws.send(raw);
    }
  }

  private failPending(output: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, output });
      this.pending.delete(id);
    }
  }
}

function inputToTool(event: BrowserInputMessage): ToolRequest | undefined {
  if (event.kind === "insertText") {
    return { name: "type_text", args: { text: event.text ?? "" } };
  }
  if (event.kind === "keyDown") {
    return { name: "key", args: { key: event.key ?? "" } };
  }
  if (event.kind === "mousePressed") {
    return { name: "mouse_click", args: { x: event.x, y: event.y, count: event.clickCount } };
  }
  if (event.kind === "mouseMoved") {
    return { name: "mouse_move", args: { x: event.x, y: event.y } };
  }
  if (event.kind === "mouseWheel") {
    return {
      name: "mouse_scroll",
      args: { x: event.x, y: event.y, delta: Math.round((event.deltaY ?? 0) / 80) },
    };
  }
  return undefined;
}
