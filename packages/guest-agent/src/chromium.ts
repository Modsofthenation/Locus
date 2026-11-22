import { WebSocket as WsWebSocket } from "ws";
import type { ToolRequest, ToolResult } from "./types.js";
import { num, optNum, str } from "./types.js";
import {
  CHROMIUM_DEVICE_SCALE,
  CHROMIUM_VIEWPORT,
  LOCUS_CHROME_DOWNLOADS_GUEST,
  LOCUS_CHROME_PROFILE_DIR,
  LOCUS_CHROME_PROFILE_GUEST,
  sanitizeArtifactStem,
  computerKey,
  type BrowserInputMessage,
  type BrowserTab,
} from "@locus/shared";
import { guestLoopbackRelayScript, listenGuestLoopbackTunnel } from "./tunnel.js";
import { LiveCdp, withCdpSession, type WsCtor } from "./cdpSession.js";

export type { WsLike, WsCtor } from "./cdpSession.js";
export { cdpCall, withCdpSession } from "./cdpSession.js";

type DockerExec = (argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export const DOCKER_BROWSER_TOOLS = new Set([
  "screenshot",
  "mouse_move",
  "mouse_click",
  "mouse_drag",
  "mouse_scroll",
  "key",
  "type_text",
  "browser_tabs",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_action",
  "browser_wait",
  "browser_console",
  "browser_network",
  "browser_pdf",
  "browser_trace",
  "browser_download",
]);

export const CHROMIUM_CDP_PORT = 9222;
export const CHROMIUM_REMOTE_ADDRESS = "127.0.0.1";

const CHROMIUM_RASTER_WIDTH = CHROMIUM_VIEWPORT.width * CHROMIUM_DEVICE_SCALE;
const CHROMIUM_RASTER_HEIGHT = CHROMIUM_VIEWPORT.height * CHROMIUM_DEVICE_SCALE;

/** CDP screencast caps: 2× raster at high JPEG quality. */
export const SCREENCAST_PARAMS = {
  format: "jpeg" as const,
  quality: 90,
  maxWidth: CHROMIUM_RASTER_WIDTH,
  maxHeight: CHROMIUM_RASTER_HEIGHT,
  everyNthFrame: 2,
};

/** Loopback CDP HTTP check. `pgrep -f` matches `sh -lc` argv and false-positives. */
export const CDP_READY_PROBE = `curl -fsS --max-time 1 http://${CHROMIUM_REMOTE_ADDRESS}:${CHROMIUM_CDP_PORT}/json/version >/dev/null 2>&1`;

export const ENSURE_BROWSER = [
  `mkdir -p ${LOCUS_CHROME_PROFILE_GUEST}`,
  "if [ -d /workspace/.git ]; then",
  "  mkdir -p /workspace/.git/info",
  `  grep -qxF '${LOCUS_CHROME_PROFILE_DIR}/' /workspace/.git/info/exclude 2>/dev/null || printf '%s\\n' '${LOCUS_CHROME_PROFILE_DIR}/' >> /workspace/.git/info/exclude`,
  "fi",
  `if ${CDP_READY_PROBE}; then echo LOCUS_CHROME_READY; exit 0; fi`,
  "BIN=$(command -v chromium || command -v chromium-browser || command -v google-chrome || command -v google-chrome-stable || true)",
  'if [ -z "$BIN" ]; then BIN=$(ls -1d /ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | tail -n 1 || true); fi',
  'if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then echo LOCUS_NO_CHROME; exit 42; fi',
  "HEADLESS=--headless=new",
  "if command -v Xvfb >/dev/null 2>&1; then",
  `  pgrep -x Xvfb >/dev/null 2>&1 || Xvfb :99 -screen 0 ${CHROMIUM_RASTER_WIDTH}x${CHROMIUM_RASTER_HEIGHT}x24 >/tmp/locus-xvfb.log 2>&1 &`,
  "  export DISPLAY=:99",
  "  HEADLESS=",
  "fi",
  'nohup "$BIN" --no-sandbox --disable-gpu --disable-dev-shm-usage --disable-software-rasterizer',
  `  --remote-debugging-port=9222 --remote-debugging-address=${CHROMIUM_REMOTE_ADDRESS}`,
  `  --user-data-dir=${LOCUS_CHROME_PROFILE_GUEST} --window-size=${CHROMIUM_VIEWPORT.width},${CHROMIUM_VIEWPORT.height} --force-device-scale-factor=${CHROMIUM_DEVICE_SCALE} $HEADLESS about:blank`,
  "  >/tmp/locus-chrome.log 2>&1 &",
  "sleep 0.6",
  "echo LOCUS_CHROME_STARTED",
].join("\n");

/** Copy stdio to Chromium's loopback CDP. bash /dev/tcp, else nc. */
export const CDP_RELAY_SCRIPT = guestLoopbackRelayScript(CHROMIUM_CDP_PORT);

interface CdpTarget {
  type?: string;
  id?: string;
  url?: string;
  title?: string;
  webSocketDebuggerUrl?: string;
}

export interface BrowserSnapshotRef {
  backendDOMNodeId: number;
  role: string;
  name: string;
  frameId?: string;
  states: Record<string, unknown>;
  parent?: string;
  nodeId?: string;
  bounds?: number[];
}

export interface ScreencastFrame {
  data: string;
  mime: "image/jpeg";
  sessionId: number;
  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
  };
}

export interface ChromiumDriver {
  close?(): void;
  handle(req: ToolRequest): Promise<ToolResult>;
  navigate(url: string): Promise<ToolResult>;
  startScreencast?(onFrame: (frame: ScreencastFrame) => void): Promise<void>;
  stopScreencast?(): Promise<void>;
  listPages?(): Promise<BrowserTab[]>;
  listDownloads?(): Promise<string[]>;
  copyDownload?(name?: string): Promise<ToolResult>;
  dispatchInput?(event: BrowserInputMessage): Promise<void>;
  releaseInput?(): Promise<void>;
  invalidateObservation?(): void | Promise<void>;
}

export interface CdpEndpoint {
  host: string;
  port: number;
}

export interface CdpDriverOptions {
  endpoint?: () => Promise<CdpEndpoint>;
  wsCtor?: WsCtor;
  listen?: (containerId: string) => Promise<CdpEndpoint & { close: () => void }>;
  /** Host-runtime Chrome: start an isolated profile instead of `docker exec`. */
  launch?: () => Promise<ToolResult>;
}

export function isBrowserUrl(command: string): boolean {
  return /^https?:\/\/\S+$/i.test(command.trim());
}

export function isBrowserToolRequest(req: ToolRequest): boolean {
  return (
    DOCKER_BROWSER_TOOLS.has(req.name) ||
    ((req.name === "exec" || req.name === "start_process") &&
      isBrowserUrl(str(req.args, "command")))
  );
}

export function dispatchBrowserTool(req: ToolRequest, driver: ChromiumDriver): Promise<ToolResult> {
  if (req.name === "exec" || req.name === "start_process") {
    return driver.navigate(str(req.args, "command").trim());
  }
  return driver.handle(req);
}

/** Map raw CDP/fetch failures to an action the model can take. */
export function describeCdpError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(message)) {
    return "Chromium DevTools is not reachable. Use screenshot or browser_tabs; do not hand-roll chrome-remote-interface or decode PNGs with Python.";
  }
  return message || "Chromium DevTools call failed";
}

export class CdpChromiumDriver implements ChromiumDriver {
  private pointer = { x: 640, y: 400 };
  private ready = false;
  private tunnel?: CdpEndpoint & { close?: () => void };
  private tracing = false;
  private screencast?: LiveCdp;
  private onScreencastFrame?: (frame: ScreencastFrame) => void;
  private snapshotRefs = new Map<string, BrowserSnapshotRef>();
  private activeTargetId?: string;
  private snapshotDocument?: { targetId?: string; backendNodeId?: number };
  private snapshotSequence = 0;
  private heldKeys = new Map<string, BrowserInputMessage>();
  private heldButton?: "left" | "middle" | "right";
  private commandSession?: LiveCdp;
  private commandUrl?: string;
  private commandConnecting?: Promise<LiveCdp>;

  constructor(
    private readonly containerId: string,
    private readonly runner: DockerExec,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly options: CdpDriverOptions = {},
  ) {}

  close(): void {
    this.commandSession?.close();
    this.screencast?.close();
    this.tunnel?.close?.();
    this.commandSession = undefined;
    this.screencast = undefined;
    this.tunnel = undefined;
    this.ready = false;
    this.invalidateObservation();
  }

  async handle(req: ToolRequest): Promise<ToolResult> {
    const started = await this.ensure();
    if (!started.ok) return started;
    try {
      switch (req.name) {
        case "screenshot":
          return await this.screenshot();
        case "mouse_move":
          this.pointer = { x: num(req.args, "x"), y: num(req.args, "y") };
          await this.input({ type: "mouseMoved", x: this.pointer.x, y: this.pointer.y });
          return { ok: true, output: `mouse_move ${this.pointer.x},${this.pointer.y}` };
        case "mouse_click": {
          const x = optNum(req.args, "x") ?? this.pointer.x;
          const y = optNum(req.args, "y") ?? this.pointer.y;
          this.pointer = { x, y };
          const count = Math.max(1, Math.min(3, Math.round(optNum(req.args, "count") ?? 1)));
          const button = cdpButton(optNum(req.args, "button") ?? 1);
          await this.input({ type: "mouseMoved", x, y });
          for (let i = 1; i <= count; i += 1) {
            await this.input({ type: "mousePressed", x, y, button, clickCount: i });
            await this.input({ type: "mouseReleased", x, y, button, clickCount: i });
          }
          return { ok: true, output: `mouse_click ${x},${y}` };
        }
        case "mouse_drag": {
          const x1 = optNum(req.args, "x1") ?? this.pointer.x;
          const y1 = optNum(req.args, "y1") ?? this.pointer.y;
          const x2 = num(req.args, "x2");
          const y2 = num(req.args, "y2");
          await this.input({ type: "mouseMoved", x: x1, y: y1 });
          await this.input({ type: "mousePressed", x: x1, y: y1, button: "left", clickCount: 1 });
          await this.input({ type: "mouseMoved", x: x2, y: y2, button: "left", buttons: 1 });
          await this.input({ type: "mouseReleased", x: x2, y: y2, button: "left", clickCount: 1 });
          this.pointer = { x: x2, y: y2 };
          return { ok: true, output: `mouse_drag ${x2},${y2}` };
        }
        case "mouse_scroll": {
          const x = optNum(req.args, "x") ?? this.pointer.x;
          const y = optNum(req.args, "y") ?? this.pointer.y;
          const delta = num(req.args, "delta");
          const axis = str(req.args, "axis") === "horizontal" ? "horizontal" : "vertical";
          const pixels = delta * 80;
          await this.input({
            type: "mouseWheel",
            x,
            y,
            deltaX: axis === "horizontal" ? -pixels : 0,
            deltaY: axis === "vertical" ? -pixels : 0,
          });
          return { ok: true, output: `mouse_scroll ${delta}` };
        }
        case "key": {
          const key = computerKey(str(req.args, "key"));
          await this.call("Input.dispatchKeyEvent", { type: "keyDown", ...key });
          await this.call("Input.dispatchKeyEvent", { type: "keyUp", ...key });
          return { ok: true, output: `key ${str(req.args, "key")}` };
        }
        case "type_text":
          await this.call("Input.insertText", { text: str(req.args, "text") });
          return { ok: true, output: "type_text" };
        case "browser_tabs":
          return await this.tabs(req);
        case "browser_navigate":
          return await this.navigate(str(req.args, "url"));
        case "browser_snapshot":
          return await this.snapshot();
        case "browser_click":
          return await this.clickRef(str(req.args, "ref"));
        case "browser_type": {
          const clicked = await this.clickRef(str(req.args, "ref"));
          if (!clicked.ok) return clicked;
          await this.call("Input.insertText", { text: str(req.args, "text") });
          return { ok: true, output: `typed into ${normalizeSnapshotRef(str(req.args, "ref"))}` };
        }
        case "browser_action":
          return await this.semanticAction(req);
        case "browser_wait":
          return await this.waitReady(req.args);
        case "browser_console":
          return await this.consoleLog();
        case "browser_network":
          return await this.networkLog();
        case "browser_pdf":
          return await this.printPdf(req);
        case "browser_trace":
          return await this.trace(req);
        case "browser_download":
          return await this.downloads(req);
        default:
          return { ok: false, output: `${req.name} is not a Chromium tool` };
      }
    } catch (err) {
      return { ok: false, output: describeCdpError(err) };
    }
  }

  async navigate(url: string): Promise<ToolResult> {
    const started = await this.ensure();
    if (!started.ok) return started;
    try {
      await this.call("Page.enable", {});
      this.invalidateObservation();
      const result = (await this.call("Page.navigate", { url })) as {
        errorText?: string;
        isDownload?: boolean;
      };
      if (result.errorText)
        return {
          ok: false,
          output: `Navigation failed: ${result.errorText}`,
          category: "navigation",
          retryable: true,
        };
      if (result.isDownload)
        return { ok: true, output: "Navigation started a download; verify with browser_download." };
      return await this.waitReady({});
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : "navigate failed" };
    }
  }

  async listPages(): Promise<BrowserTab[]> {
    const started = await this.ensure();
    if (!started.ok) return [];
    const target = await this.cdpTarget();
    const res = await this.fetchImpl(`http://${target.host}:${target.port}/json/list`);
    const targets = (await res.json()) as CdpTarget[];
    await this.selectAvailableTarget(targets);
    return parseBrowserPages(targets, this.activeTargetId);
  }

  async startScreencast(onFrame: (frame: ScreencastFrame) => void): Promise<void> {
    this.onScreencastFrame = onFrame;
    if (this.screencast) return;
    const started = await this.ensure();
    if (!started.ok) throw new Error(started.output);
    const url = await this.debuggerUrl();
    const session = await LiveCdp.connect(
      url,
      this.options.wsCtor ?? (WsWebSocket as unknown as WsCtor),
    );
    this.screencast = session;
    session.onClose(() => {
      if (this.screencast === session) {
        this.screencast = undefined;
        this.onScreencastFrame = undefined;
      }
    });
    session.onEvent((method, params) => {
      if (method !== "Page.screencastFrame") return;
      const data = typeof params.data === "string" ? params.data : "";
      const sessionId = typeof params.sessionId === "number" ? params.sessionId : 0;
      const meta =
        params.metadata && typeof params.metadata === "object"
          ? (params.metadata as Record<string, unknown>)
          : {};
      const frame: ScreencastFrame = {
        data,
        mime: "image/jpeg",
        sessionId,
        metadata: {
          offsetTop: Number(meta.offsetTop) || 0,
          pageScaleFactor: Number(meta.pageScaleFactor) || 1,
          deviceWidth: Number(meta.deviceWidth) || CHROMIUM_VIEWPORT.width,
          deviceHeight: Number(meta.deviceHeight) || CHROMIUM_VIEWPORT.height,
        },
      };
      this.onScreencastFrame?.(frame);
      void session.call("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
    });
    try {
      await session.call("Page.enable", {});
      await session
        .call("Emulation.setDeviceMetricsOverride", {
          width: CHROMIUM_VIEWPORT.width,
          height: CHROMIUM_VIEWPORT.height,
          deviceScaleFactor: CHROMIUM_DEVICE_SCALE,
          mobile: false,
        })
        .catch(() => undefined);
      await session.call("Page.startScreencast", SCREENCAST_PARAMS);
    } catch (err) {
      this.screencast = undefined;
      this.onScreencastFrame = undefined;
      session.close();
      throw err;
    }
  }

  async stopScreencast(): Promise<void> {
    const session = this.screencast;
    this.screencast = undefined;
    this.onScreencastFrame = undefined;
    if (!session) return;
    await session.call("Page.stopScreencast", {}).catch(() => undefined);
    session.close();
  }

  async dispatchInput(event: BrowserInputMessage): Promise<void> {
    const started = await this.ensure();
    if (!started.ok) throw new Error(started.output);
    if (event.kind === "insertText") {
      await this.call("Input.insertText", { text: event.text ?? "" });
      return;
    }
    if (event.kind === "keyDown" || event.kind === "keyUp") {
      const key = { ...computerKey(event.key ?? ""), ...event };
      await this.call("Input.dispatchKeyEvent", {
        type: event.kind,
        key: key.key,
        code: key.code,
        modifiers: key.modifiers,
        windowsVirtualKeyCode: key.windowsVirtualKeyCode,
      });
      if (event.kind === "keyDown") this.heldKeys.set(event.code ?? event.key ?? "", event);
      else this.heldKeys.delete(event.code ?? event.key ?? "");
      return;
    }
    const x = event.x ?? this.pointer.x;
    const y = event.y ?? this.pointer.y;
    this.pointer = { x, y };
    if (event.kind === "mousePressed") this.heldButton = event.button;
    if (event.kind === "mouseReleased") this.heldButton = undefined;
    await this.input({
      type: event.kind,
      x,
      y,
      button: event.button,
      buttons:
        this.heldButton === "left"
          ? 1
          : this.heldButton === "right"
            ? 2
            : this.heldButton === "middle"
              ? 4
              : 0,
      clickCount: event.clickCount,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      modifiers: event.modifiers,
    });
  }

  async releaseInput(): Promise<void> {
    const keys = [...this.heldKeys.values()];
    this.heldKeys.clear();
    for (const key of keys) await this.dispatchInput({ ...key, kind: "keyUp", modifiers: 0 });
    if (this.heldButton) {
      const button = this.heldButton;
      this.heldButton = undefined;
      await this.input({ type: "mouseReleased", ...this.pointer, button, clickCount: 1 });
    }
  }

  invalidateObservation(): void {
    this.snapshotRefs.clear();
    this.snapshotDocument = undefined;
  }

  private async waitReady(args: Record<string, unknown>): Promise<ToolResult> {
    const timeout = Math.min(30_000, Math.max(100, optNum(args, "timeout_ms") ?? 8000));
    const deadline = Date.now() + timeout;
    do {
      const result = (await this.call(
        "Runtime.evaluate",
        {
          expression: `({ ready: document.readyState !== 'loading', url: location.href, found: ${typeof args.text === "string" ? `document.body?.innerText.includes(${JSON.stringify(args.text)})` : "true"} })`,
          returnByValue: true,
        },
        Math.max(1, Math.min(8000, deadline - Date.now())),
      )) as { result?: { value?: { ready?: boolean; url?: string; found?: boolean } } };
      const value = result.result?.value;
      if (value?.ready && value.found)
        return { ok: true, output: `ready ${value.url ?? ""}`, details: value };
      await new Promise((r) => setTimeout(r, 100));
    } while (Date.now() < deadline);
    return {
      ok: false,
      output:
        "Browser wait timed out. Take a fresh browser_snapshot before choosing another action.",
      category: "timeout",
      retryable: true,
    };
  }

  private async tabs(req: ToolRequest): Promise<ToolResult> {
    const action = str(req.args, "action") || "list";
    const target = await this.cdpTarget();
    const base = `http://${target.host}:${target.port}`;
    if (action === "new") {
      const url = str(req.args, "url") || "about:blank";
      const res = await this.fetchImpl(`${base}/json/new?${encodeURIComponent(url)}`, {
        method: "PUT",
      });
      const body = await res.text();
      if (res.ok) {
        const page = JSON.parse(body) as CdpTarget;
        await this.changeTarget(page.id);
      }
      return { ok: res.ok, output: body.slice(0, 2000) || "tab created" };
    }
    if (action === "close" || action === "select") {
      const id = str(req.args, "targetId");
      if (!id) return { ok: false, output: "targetId is required" };
      const path =
        action === "close"
          ? `/json/close/${encodeURIComponent(id)}`
          : `/json/activate/${encodeURIComponent(id)}`;
      const res = await this.fetchImpl(`${base}${path}`);
      if (res.ok) {
        if (action === "select") await this.changeTarget(id);
        else if (id === this.activeTargetId) {
          await this.listPages();
        }
      }
      return { ok: res.ok, output: (await res.text()).slice(0, 500) || action };
    }
    const res = await this.fetchImpl(`${base}/json/list`);
    const targets = (await res.json()) as CdpTarget[];
    const lines = targets
      .filter((row) => row.type === "page")
      .map((row) => `${row.webSocketDebuggerUrl?.split("/").pop() ?? "?"} ${row.url ?? ""}`.trim());
    return { ok: true, output: lines.join("\n") || "(no tabs)" };
  }

  private async consoleLog(): Promise<ToolResult> {
    const expr =
      "(() => { try { const e = performance.getEntriesByType('navigation').map(x => x.name); return JSON.stringify({ errors: (window.__locusErrors||[]).slice(-40), nav: e }); } catch (err) { return String(err); } })()";
    const result = (await this.call("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
    })) as {
      result?: { value?: unknown };
    };
    return { ok: true, output: JSON.stringify(result.result?.value ?? {}, null, 0).slice(0, 8000) };
  }

  private async networkLog(): Promise<ToolResult> {
    const expr =
      "JSON.stringify(performance.getEntriesByType('resource').slice(-40).map(e => ({ name: e.name, dur: Math.round(e.duration), type: e.initiatorType })))";
    const result = (await this.call("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
    })) as {
      result?: { value?: unknown };
    };
    const value = result.result?.value;
    return {
      ok: true,
      output:
        typeof value === "string"
          ? value.slice(0, 8000)
          : JSON.stringify(value ?? []).slice(0, 8000),
    };
  }

  private async screenshot(): Promise<ToolResult> {
    const measured = (await this.call("Runtime.evaluate", {
      expression: "({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})",
      returnByValue: true,
    })) as { result?: { value?: { width?: number; height?: number; dpr?: number } } };
    const viewport = measured.result?.value;
    let shot = (await this.call("Page.captureScreenshot", { format: "png" })) as {
      data?: string;
    };
    const png = Buffer.from(shot.data ?? "", "base64");
    if (
      viewport?.width &&
      viewport.height &&
      png.length > 24 &&
      png.readUInt32BE(16) !== viewport.width
    ) {
      // Native display scaling and per-client CDP emulation do not always agree.
      // Measure the returned raster rather than assuming devicePixelRatio is its scale.
      shot = (await this.call("Page.captureScreenshot", {
        format: "png",
        clip: {
          x: 0,
          y: 0,
          width: viewport.width,
          height: viewport.height,
          scale: viewport.width / png.readUInt32BE(16),
        },
      })) as { data?: string };
    }
    const data = shot.data?.replace(/\s/g, "");
    if (!data) return { ok: false, output: "Chromium screenshot was empty" };
    return {
      ok: true,
      output: "screenshot captured",
      screenshotBase64: data,
      ...(viewport?.width
        ? { details: { width: viewport.width, height: viewport.height, coordinateSpace: "css" } }
        : {}),
    };
  }

  private async printPdf(req: ToolRequest): Promise<ToolResult> {
    const printed = (await this.call("Page.printToPDF", { printBackground: true }, 20_000)) as {
      data?: string;
    };
    const data = printed.data?.replace(/\s/g, "");
    if (!data) return { ok: false, output: "Chromium PDF was empty" };
    const artifactName = `${sanitizeArtifactStem(str(req.args, "save_as_filename"), "page")}.pdf`;
    return {
      ok: true,
      output: `pdf saved: ${artifactName}`,
      artifactName,
      artifactKind: "pdf",
      artifactBase64: data,
    };
  }

  private async trace(req: ToolRequest): Promise<ToolResult> {
    const action = str(req.args, "action") || "stop";
    if (action === "start") {
      if (this.tracing) return { ok: false, output: "already tracing" };
      await this.call("Tracing.start", {
        transferMode: "ReturnAsStream",
        streamFormat: "json",
        streamCompression: "none",
        categories: "devtools.timeline,blink.user_timing,disabled-by-default-devtools.screenshot",
      });
      this.tracing = true;
      return { ok: true, output: "DevTools trace started" };
    }
    if (action !== "stop") return { ok: false, output: "action must be start or stop" };
    if (!this.tracing) return { ok: false, output: "not tracing" };
    const data = await this.endTrace();
    this.tracing = false;
    if (!data) return { ok: false, output: "Chromium trace was empty" };
    const artifactName = `${sanitizeArtifactStem(str(req.args, "save_as_filename"), "trace")}.json`;
    return {
      ok: true,
      output: `DevTools trace saved: ${artifactName}`,
      artifactName,
      artifactKind: "trace",
      artifactBase64: data,
    };
  }

  private async endTrace(): Promise<string | undefined> {
    const url = await this.debuggerUrl();
    return withCdpSession(
      url,
      this.options.wsCtor ?? (WsWebSocket as unknown as WsCtor),
      async (session) => {
        const complete = session.wait("Tracing.tracingComplete");
        await session.call("Tracing.end", {});
        const event = await complete;
        const handle = typeof event.stream === "string" ? event.stream : "";
        if (!handle) return undefined;
        let raw = "";
        for (let i = 0; i < 64; i += 1) {
          const chunk = (await session.call("IO.read", { handle, size: 1_048_576 })) as {
            data?: string;
            eof?: boolean;
            base64Encoded?: boolean;
          };
          const piece = chunk.data ?? "";
          raw += chunk.base64Encoded ? Buffer.from(piece, "base64").toString("utf8") : piece;
          if (chunk.eof) break;
        }
        await session.call("IO.close", { handle }).catch(() => undefined);
        if (!raw.trim()) return undefined;
        return Buffer.from(raw, "utf8").toString("base64");
      },
      30_000,
    );
  }

  async listDownloads(): Promise<string[]> {
    const listed = await this.runner([
      "docker",
      "exec",
      this.containerId,
      "sh",
      "-lc",
      `ls -1t ${LOCUS_CHROME_DOWNLOADS_GUEST} 2>/dev/null`,
    ]);
    return listed.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line !== "." && line !== ".." && !line.includes("/"));
  }

  async copyDownload(name?: string): Promise<ToolResult> {
    const names = await this.listDownloads();
    const guestName = name?.trim() || names[0];
    if (!guestName) {
      return {
        ok: false,
        output: "no downloads yet; call browser_download enable first, then list/latest",
      };
    }
    if (name?.trim() && !names.includes(guestName)) {
      return { ok: false, output: "download is not in the Chromium downloads folder" };
    }
    const safe = guestName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
    if (safe !== guestName) return { ok: false, output: "download filename is not allowed" };
    const dumped = await this.runner([
      "docker",
      "exec",
      this.containerId,
      "sh",
      "-lc",
      `python3 -c "import pathlib,sys,base64; p=pathlib.Path('${LOCUS_CHROME_DOWNLOADS_GUEST}/${safe}'); d=p.read_bytes(); sys.stdout.write(base64.b64encode(d).decode())"`,
    ]);
    const data = dumped.stdout.replace(/\s/g, "");
    if (dumped.code !== 0 || !data) {
      return { ok: false, output: dumped.stderr.trim() || "failed to read download" };
    }
    return {
      ok: true,
      output: `download saved: ${safe}`,
      artifactName: safe,
      artifactKind: "download",
      artifactBase64: data,
      artifactGuestPath: `${LOCUS_CHROME_DOWNLOADS_GUEST}/${safe}`,
    };
  }

  private async downloads(req: ToolRequest): Promise<ToolResult> {
    const action = str(req.args, "action") || "list";
    if (action === "enable") {
      await this.runner([
        "docker",
        "exec",
        this.containerId,
        "sh",
        "-lc",
        `mkdir -p ${LOCUS_CHROME_DOWNLOADS_GUEST}`,
      ]);
      try {
        await this.call("Browser.setDownloadBehavior", {
          behavior: "allow",
          downloadPath: LOCUS_CHROME_DOWNLOADS_GUEST,
          eventsEnabled: true,
        });
      } catch {
        await this.call("Page.setDownloadBehavior", {
          behavior: "allow",
          downloadPath: LOCUS_CHROME_DOWNLOADS_GUEST,
        }).catch(() => undefined);
      }
      return { ok: true, output: `downloads enabled at ${LOCUS_CHROME_DOWNLOADS_GUEST}` };
    }
    const names = await this.listDownloads();
    if (action === "list") {
      return { ok: true, output: names.join("\n") || "(no downloads)" };
    }
    if (action === "latest") return this.copyDownload();
    if (action === "get") return this.copyDownload(str(req.args, "filename") || undefined);
    return { ok: false, output: "action must be enable, list, latest, or get" };
  }

  private async snapshot(): Promise<ToolResult> {
    await this.debuggerUrl();
    const document = (await this.call("DOM.getDocument", { depth: 0 })) as {
      root?: { backendNodeId?: number };
    };
    await this.call("Accessibility.enable", {});
    const tree = (await this.call("Accessibility.getFullAXTree", {})) as {
      nodes?: Array<Record<string, unknown>>;
    };
    const layout = (await this.call("DOMSnapshot.captureSnapshot", { computedStyles: [] })) as {
      strings?: string[];
      documents?: Array<{
        frameId?: number;
        scrollOffsetX?: number;
        scrollOffsetY?: number;
        nodes?: { backendNodeId?: number[] };
        layout?: { nodeIndex?: number[]; bounds?: number[][] };
      }>;
    };
    const geometry = new Map<number, { bounds: number[]; frameId?: string }>();
    for (const doc of layout.documents ?? []) {
      for (const [i, index] of (doc.layout?.nodeIndex ?? []).entries()) {
        const id = doc.nodes?.backendNodeId?.[index];
        const b = doc.layout?.bounds?.[i];
        if (id !== undefined && b?.length === 4)
          geometry.set(id, {
            bounds: [
              b[0]! - (doc.scrollOffsetX ?? 0),
              b[1]! - (doc.scrollOffsetY ?? 0),
              b[2]!,
              b[3]!,
            ],
            frameId: typeof doc.frameId === "number" ? layout.strings?.[doc.frameId] : undefined,
          });
      }
    }
    for (const node of tree.nodes ?? []) {
      const box = geometry.get(Number(node.backendDOMNodeId));
      if (box) Object.assign(node, box);
    }
    const { text, refs } = formatAccessibilitySnapshot(
      tree.nodes ?? [],
      `@s${++this.snapshotSequence}e`,
    );
    this.snapshotRefs = refs;
    this.snapshotDocument = {
      targetId: this.activeTargetId,
      backendNodeId: document.root?.backendNodeId,
    };
    return {
      ok: true,
      output: text || "(empty tree)",
      details: {
        targetId: this.activeTargetId,
        snapshotId: this.snapshotSequence,
        nodes: [...refs].map(([ref, node]) => ({ ref, ...node })),
      },
    };
  }

  private async resolveRef(raw: string): Promise<number> {
    await this.debuggerUrl();
    const ref = normalizeSnapshotRef(raw);
    const target = this.snapshotRefs.get(ref);
    if (!target || this.snapshotDocument?.targetId !== this.activeTargetId)
      throw new Error(`Unknown or stale ref ${ref}. Call browser_snapshot first.`);
    const document = (await this.call("DOM.getDocument", { depth: 0 })) as {
      root?: { backendNodeId?: number };
    };
    if (document.root?.backendNodeId !== this.snapshotDocument?.backendNodeId) {
      this.invalidateObservation();
      throw new Error("Page changed. Call browser_snapshot before acting.");
    }
    return target.backendDOMNodeId;
  }

  private async onRef(raw: string, declaration: string, args: unknown[] = []): Promise<unknown> {
    const backendNodeId = await this.resolveRef(raw);
    const resolved = (await this.call("DOM.resolveNode", { backendNodeId })) as {
      object?: { objectId?: string };
    };
    if (!resolved.object?.objectId)
      throw new Error("Element detached. Call browser_snapshot again.");
    const result = (await this.call("Runtime.callFunctionOn", {
      objectId: resolved.object.objectId,
      functionDeclaration: declaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.text ?? "Element action failed");
    return result.result?.value;
  }

  private async semanticAction(req: ToolRequest): Promise<ToolResult> {
    const ref = str(req.args, "ref");
    const action = str(req.args, "action");
    if ((action === "fill" || action === "select") && typeof req.args.value !== "string")
      return { ok: false, output: "fill and select require a string value" };
    if (action === "invoke") return this.clickRef(ref);
    const result =
      action === "check"
        ? undefined
        : await this.onRef(
            ref,
            `function(action, value) {
      if (!this.isConnected || this.disabled || this.getAttribute('aria-disabled') === 'true') return { ok: false, reason: 'Element is detached or disabled' };
      if (action === 'fill') {
        if (!(this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) || this.readOnly) return { ok: false, reason: 'Expected an editable text field' };
        this.focus();
        const proto = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(this, String(value));
        this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: this.value === String(value), value: this.type === 'password' ? '[redacted]' : this.value };
      }
      if (action === 'select') {
        if (!(this instanceof HTMLSelectElement)) return { ok: false, reason: 'Expected a select control' };
        if (![...this.options].some(o => o.value === String(value) && !o.disabled)) return { ok: false, reason: 'Option is unavailable' };
        this.value = String(value); this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: this.value === String(value), value: this.value };
      }
      return { ok: false, reason: 'Unsupported action' };
    }`,
            [action, req.args.value],
          );
    if (action === "check") {
      const wanted = req.args.checked !== false;
      const current = (await this.onRef(
        ref,
        "function() { return { supported: this.matches('input[type=checkbox],input[type=radio],[role=checkbox],[role=switch]') && !this.disabled, checked: this.checked, aria: this.getAttribute('aria-checked') }; }",
      )) as { supported?: boolean; checked?: boolean; aria?: string };
      if (!current.supported)
        return { ok: false, output: "Expected an enabled checkbox, radio or switch" };
      if ((current.checked ?? current.aria === "true") !== wanted) {
        const clicked = await this.clickRef(ref);
        if (!clicked.ok) return clicked;
      }
      const verified = await this.onRef(
        ref,
        "function() { return this.checked ?? (this.getAttribute('aria-checked') === 'true'); }",
      );
      return {
        ok: verified === wanted,
        output:
          verified === wanted ? `checked=${wanted}` : "Checkbox did not reach the requested state",
        details: { checked: verified },
      };
    }
    const observed = result as { ok?: boolean; reason?: string } | undefined;
    return {
      ok: observed?.ok === true,
      output: JSON.stringify(observed ?? { ok: false }),
      details: { action, observed },
    };
  }

  private async clickRef(raw: string): Promise<ToolResult> {
    const ref = normalizeSnapshotRef(raw);
    const backendNodeId = await this.resolveRef(ref);
    await this.call("DOM.enable", {});
    await this.call("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const box = (await this.call("DOM.getBoxModel", {
      backendNodeId,
    })) as {
      model?: { content?: number[] };
    };
    const point = boxCenter(box.model?.content);
    if (!point) return { ok: false, output: `Could not find a box for ${ref}` };
    const actionable = await this.onRef(
      ref,
      `function(x,y) {
      const hit = this.ownerDocument.elementFromPoint(x,y);
      return this.isConnected && !this.disabled && this.getAttribute('aria-disabled') !== 'true' && (hit === this || this.contains(hit));
    }`,
      [point.x, point.y],
    );
    if (!actionable)
      return {
        ok: false,
        output:
          "Element is disabled, obscured, or outside the viewport. Take a fresh snapshot or screenshot.",
        category: "not-actionable",
        retryable: true,
      };
    this.pointer = point;
    await this.input({ type: "mouseMoved", x: point.x, y: point.y });
    await this.input({
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await this.input({
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    return { ok: true, output: `clicked ${ref} ${point.x},${point.y}` };
  }

  private async input(params: Record<string, unknown>): Promise<void> {
    await this.call("Input.dispatchMouseEvent", params);
  }

  private async ensure(): Promise<ToolResult> {
    if (this.options.launch) {
      if (this.ready) return { ok: true, output: "ready" };
      const launched = await this.options.launch();
      if (!launched.ok) return launched;
      this.ready = true;
      return { ok: true, output: "ready" };
    }
    if (this.ready) {
      const probe = await this.runner([
        "docker",
        "exec",
        this.containerId,
        "sh",
        "-lc",
        CDP_READY_PROBE,
      ]);
      if (probe.code === 0) return { ok: true, output: "ready" };
      this.ready = false;
      this.commandSession?.close();
      this.commandSession = undefined;
      this.commandUrl = undefined;
      this.invalidateObservation();
      this.tunnel?.close?.();
      this.tunnel = undefined;
    }
    const launched = await this.runner([
      "docker",
      "exec",
      this.containerId,
      "sh",
      "-lc",
      ENSURE_BROWSER,
    ]);
    const text = [launched.stdout, launched.stderr].join("\n");
    if (text.includes("LOCUS_NO_CHROME") || launched.code === 42) {
      return {
        ok: false,
        output:
          "Chromium is not installed in this image. Use locus/agent or locus/web-qa, or install chromium and xvfb.",
      };
    }
    if (launched.code !== 0 && !text.includes("LOCUS_CHROME")) {
      return { ok: false, output: text.trim() || "failed to start Chromium" };
    }
    this.ready = true;
    return { ok: true, output: "ready" };
  }

  private async debuggerUrl(): Promise<string> {
    const target = await this.cdpTarget();
    let last = "CDP not ready";
    for (let i = 0; i < 8; i += 1) {
      try {
        const res = await this.fetchImpl(`http://${target.host}:${target.port}/json/list`);
        const targets = (await res.json()) as CdpTarget[];
        await this.selectAvailableTarget(targets);
        const page = targets.find(
          (row) =>
            (row.id ?? row.webSocketDebuggerUrl?.split("/").pop()) === this.activeTargetId &&
            row.webSocketDebuggerUrl,
        );
        if (page?.webSocketDebuggerUrl)
          return rewriteCdpWs(page.webSocketDebuggerUrl, target.host, target.port);
      } catch (err) {
        last = describeCdpError(err);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(last);
  }

  private async selectAvailableTarget(targets: CdpTarget[]): Promise<void> {
    const pages = targets.filter((row) => row.type === "page" && row.webSocketDebuggerUrl);
    if (
      pages.some(
        (row) => (row.id ?? row.webSocketDebuggerUrl?.split("/").pop()) === this.activeTargetId,
      )
    )
      return;
    const page = pages[0];
    await this.changeTarget(page?.id ?? page?.webSocketDebuggerUrl?.split("/").pop());
  }

  private async changeTarget(id: string | undefined): Promise<void> {
    if (this.activeTargetId === id) return;
    const callback = this.screencast ? this.onScreencastFrame : undefined;
    await this.releaseInput();
    await this.stopScreencast();
    this.commandSession?.close();
    this.commandSession = undefined;
    this.commandUrl = undefined;
    this.activeTargetId = id;
    this.invalidateObservation();
    if (callback && id) await this.startScreencast(callback);
  }

  private async cdpTarget(): Promise<CdpEndpoint> {
    if (this.options.endpoint) return this.options.endpoint();
    if (this.tunnel) return this.tunnel;
    const listen = this.options.listen ?? listenCdpTunnel;
    this.tunnel = await listen(this.containerId);
    if (this.tunnel.host !== "127.0.0.1") throw new Error("CDP tunnel must bind loopback");
    return this.tunnel;
  }

  private async call(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 8000,
  ): Promise<unknown> {
    const url = await this.debuggerUrl();
    if (!this.commandSession || this.commandUrl !== url) {
      this.commandSession?.close();
      this.commandConnecting ??= LiveCdp.connect(
        url,
        this.options.wsCtor ?? (WsWebSocket as unknown as WsCtor),
      );
      try {
        const session = await this.commandConnecting;
        this.commandSession = session;
        this.commandUrl = url;
        session.onClose(() => {
          if (this.commandSession === session) this.commandSession = undefined;
        });
      } finally {
        this.commandConnecting = undefined;
      }
    }
    return this.commandSession.call(method, params, timeoutMs);
  }
}

export function listenCdpTunnel(containerId: string): Promise<CdpEndpoint & { close: () => void }> {
  return listenGuestLoopbackTunnel(containerId, CHROMIUM_CDP_PORT);
}

export function parseMappedPort(stdout: string): number | undefined {
  const n = Number(stdout.trim());
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
}

export function rewriteCdpWs(url: string, host: string, port = CHROMIUM_CDP_PORT): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = host;
    parsed.port = String(port);
    return parsed.toString();
  } catch {
    return url;
  }
}

export function parseBrowserPages(targets: CdpTarget[], activeTargetId?: string): BrowserTab[] {
  const pages = targets.filter((row) => row.type === "page");
  return pages.map((row, index) => ({
    targetId: row.id || row.webSocketDebuggerUrl?.split("/").pop() || `tab-${index}`,
    url: row.url || "about:blank",
    title: row.title,
    active: activeTargetId
      ? (row.id || row.webSocketDebuggerUrl?.split("/").pop()) === activeTargetId
      : index === 0,
  }));
}

function cdpButton(button: number): "left" | "middle" | "right" {
  if (button === 2) return "middle";
  if (button === 3) return "right";
  return "left";
}

const SNAPSHOT_MAX = 8192;
const SKIP_AX_ROLES = new Set(["RootWebArea", "generic", "InlineTextBox", "none"]);
const INTERACTIVE_AX_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "switch",
  "slider",
  "option",
  "listbox",
  "spinbutton",
  "treeitem",
]);

export function normalizeSnapshotRef(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "@e0";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

export function boxCenter(content?: number[]): { x: number; y: number } | undefined {
  if (!content || content.length < 8) return undefined;
  const xs = [content[0], content[2], content[4], content[6]];
  const ys = [content[1], content[3], content[5], content[7]];
  if (
    xs.some((n) => n == null || !Number.isFinite(n)) ||
    ys.some((n) => n == null || !Number.isFinite(n))
  ) {
    return undefined;
  }
  return {
    x: Math.round((xs[0]! + xs[1]! + xs[2]! + xs[3]!) / 4),
    y: Math.round((ys[0]! + ys[1]! + ys[2]! + ys[3]!) / 4),
  };
}

function axString(field: unknown): string {
  if (typeof field === "string") return field;
  if (!field || typeof field !== "object") return "";
  const value = (field as { value?: unknown }).value;
  return typeof value === "string" ? value : "";
}

export function formatAccessibilitySnapshot(
  nodes: Array<Record<string, unknown>>,
  prefix = "@e",
): {
  text: string;
  refs: Map<string, BrowserSnapshotRef>;
} {
  const refs = new Map<string, BrowserSnapshotRef>();
  const lines: string[] = [];
  let used = 0;
  let index = 0;
  const parents = new Map<unknown, Record<string, unknown>>();
  for (const node of nodes)
    if (Array.isArray(node.childIds)) for (const child of node.childIds) parents.set(child, node);
  for (const node of nodes) {
    if (node.ignored === true) continue;
    const backendDOMNodeId = node.backendDOMNodeId;
    if (typeof backendDOMNodeId !== "number" || !Number.isFinite(backendDOMNodeId)) continue;
    const role = axString(node.role);
    if (!role || SKIP_AX_ROLES.has(role)) continue;
    const name = axString(node.name).replace(/"/g, "'").trim();
    if (!INTERACTIVE_AX_ROLES.has(role) && !name) continue;
    index += 1;
    const ref = `${prefix}${index}`;
    const properties = Array.isArray(node.properties)
      ? (node.properties as Array<{ name: string; value?: { value?: unknown } }>)
      : [];
    const states = properties
      .filter((p) =>
        ["checked", "disabled", "expanded", "selected", "required", "focused", "readonly"].includes(
          p.name,
        ),
      )
      .map((p) => `${p.name}=${String(p.value?.value)}`);
    const value = axString(node.value);
    if (value && !properties.some((p) => p.name === "protected" && p.value?.value === true))
      states.push(`value=${JSON.stringify(value)}`);
    const parent = parents.get(node.nodeId);
    const context =
      parent && axString(parent.name) ? ` parent=${JSON.stringify(axString(parent.name))}` : "";
    const bounds =
      Array.isArray(node.bounds) && node.bounds.length === 4
        ? (node.bounds as number[])
        : undefined;
    const line =
      (name ? `${ref} ${role} "${name}"` : `${ref} ${role}`) +
      (states.length ? ` [${states.join(" ")}]` : "") +
      context +
      (bounds ? ` box=${JSON.stringify(bounds.map((n) => Math.round(n)))}` : "");
    if (used + line.length + (lines.length ? 1 : 0) > SNAPSHOT_MAX) break;
    refs.set(ref, {
      backendDOMNodeId,
      role,
      name,
      states: Object.fromEntries(
        properties
          .filter((p) =>
            [
              "checked",
              "disabled",
              "expanded",
              "selected",
              "required",
              "focused",
              "readonly",
            ].includes(p.name),
          )
          .map((p) => [p.name, p.value?.value]),
      ),
      frameId: typeof node.frameId === "string" ? node.frameId : undefined,
      parent: parent ? String(parent.nodeId ?? "") : undefined,
      nodeId: typeof node.nodeId === "string" ? node.nodeId : undefined,
      bounds,
    });
    lines.push(line);
    used += line.length + (lines.length > 1 ? 1 : 0);
  }
  return { text: lines.join("\n"), refs };
}
