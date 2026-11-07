import type { WebSocket } from "ws";
import {
  browserDeniedHost,
  isOperatorDrivingBrowser,
  parseBrowserClientMessage,
  sessionLiveChrome,
  sessionRuntime,
  type AgentSession,
  type BrowserClientMessage,
  type BrowserController,
  type BrowserServerMessage,
  type VmInstance,
} from "@locus/shared";
import type { ChromiumDriver, ScreencastFrame, ToolResult } from "@locus/guest-agent";
import type { GuestHub } from "../core/guests.js";

export type BrowserLockHooks = {
  takeover: (sessionId: string) => Promise<unknown>;
  handback: (sessionId: string) => Promise<unknown>;
  allowHosts?: (session: AgentSession) => Promise<string[]>;
  saveDownload?: (sessionId: string, result: ToolResult) => Promise<ToolResult>;
};

export class BrowserStreams {
  private viewers = new Map<string, Set<WebSocket>>();
  private live = new Set<string>();
  private drivers = new Map<string, ChromiumDriver>();
  private tabTimer = new Map<string, ReturnType<typeof setInterval>>();
  private lastTabs = new Map<string, string>();
  private lastDownloads = new Map<string, string>();
  private inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly guests: GuestHub,
    private readonly resolve: (
      sessionId: string,
    ) => Promise<
      | { session: AgentSession; vm?: VmInstance; hostRoot?: string; chromeProfileDir?: string }
      | undefined
    >,
    private readonly locks?: BrowserLockHooks,
  ) {}

  private driverFor(found: {
    session: AgentSession;
    vm?: VmInstance;
    hostRoot?: string;
    chromeProfileDir?: string;
  }): ChromiumDriver | undefined {
    if (found.vm) return this.guests.forVm(found.vm).chromium();
    if (sessionRuntime(found.session) !== "host") return undefined;
    return this.guests
      .forHost(found.session.id, found.session.os, found.hostRoot ?? "", found.chromeProfileDir)
      .chromium();
  }

  attach(sessionId: string, ws: WebSocket): void {
    const set = this.viewers.get(sessionId) ?? new Set();
    set.add(ws);
    this.viewers.set(sessionId, set);
    const drop = () => this.detach(sessionId, ws);
    ws.on("close", drop);
    ws.on("error", drop);
    ws.on("message", (raw) => {
      void this.onClient(sessionId, String(raw));
    });
    void this.ensure(sessionId);
  }

  notifyControl(sessionId: string, controller: BrowserController): void {
    this.send(sessionId, {
      type: "status",
      controller,
      ready: this.live.has(sessionId),
    });
  }

  private detach(sessionId: string, ws: WebSocket): void {
    const set = this.viewers.get(sessionId);
    if (!set) return;
    set.delete(ws);
    if (set.size > 0) return;
    this.viewers.delete(sessionId);
    this.lastTabs.delete(sessionId);
    this.lastDownloads.delete(sessionId);
    const timer = this.tabTimer.get(sessionId);
    if (timer) clearInterval(timer);
    this.tabTimer.delete(sessionId);
    if (!this.live.delete(sessionId)) return;
    const driver = this.drivers.get(sessionId);
    this.drivers.delete(sessionId);
    void driver?.stopScreencast?.();
  }

  private async ensure(sessionId: string): Promise<void> {
    const prev = this.inflight.get(sessionId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => this.ensureLive(sessionId));
    this.inflight.set(sessionId, run);
    try {
      await run;
    } finally {
      if (this.inflight.get(sessionId) === run) this.inflight.delete(sessionId);
    }
  }

  private async ensureLive(sessionId: string): Promise<void> {
    const found = await this.resolve(sessionId);
    const runtime = found ? sessionRuntime(found.session) : undefined;
    if (!found || (runtime !== "docker" && runtime !== "host")) {
      this.send(sessionId, {
        type: "status",
        controller: "agent",
        ready: false,
        error: "Browser is only available on Docker or Host agents.",
      });
      return;
    }
    const controller = controllerOf(found.session);
    const driver = this.driverFor(found);
    if (!driver?.startScreencast) {
      this.send(sessionId, {
        type: "status",
        controller,
        ready: false,
        error:
          runtime === "host"
            ? "Live Chromium needs Chrome or Chromium on this machine."
            : "Live Chromium needs a real Docker engine.",
      });
      return;
    }
    this.send(sessionId, {
      type: "status",
      controller,
      ready: true,
      jail: found.session.network,
      source: sessionLiveChrome(found.session) ? "extension" : "isolated",
    });
    if (this.live.has(sessionId)) {
      await this.pushTabs(sessionId, driver, found.session);
      await this.pushDownloads(sessionId, driver);
      return;
    }
    this.live.add(sessionId);
    this.drivers.set(sessionId, driver);
    try {
      await driver.startScreencast((frame) => this.fanoutFrame(sessionId, frame));
      if ((this.viewers.get(sessionId)?.size ?? 0) === 0) {
        this.live.delete(sessionId);
        this.drivers.delete(sessionId);
        await driver.stopScreencast?.();
        return;
      }
      await this.pushTabs(sessionId, driver, found.session);
      await this.pushDownloads(sessionId, driver);
      const timer = setInterval(() => {
        void this.pushTabs(sessionId, driver, found.session);
        void this.pushDownloads(sessionId, driver);
      }, 1000);
      timer.unref?.();
      this.tabTimer.set(sessionId, timer);
    } catch (err) {
      this.live.delete(sessionId);
      this.drivers.delete(sessionId);
      await driver.stopScreencast?.().catch(() => undefined);
      this.send(sessionId, {
        type: "status",
        controller,
        ready: false,
        error: err instanceof Error ? err.message : "Chromium screencast failed",
      });
    }
  }

  private async onClient(sessionId: string, raw: string): Promise<void> {
    const message = parseBrowserClientMessage(raw);
    if (!message) return;
    try {
      await this.handleClient(sessionId, message);
    } catch {
      /* keep the pane attached */
    }
  }

  private async handleClient(sessionId: string, message: BrowserClientMessage): Promise<void> {
    if (message.type === "takeover") {
      await this.locks?.takeover(sessionId);
      return;
    }
    if (message.type === "handback") {
      await this.locks?.handback(sessionId);
      return;
    }
    const found = await this.resolve(sessionId);
    if (!found) return;
    const driver = this.drivers.get(sessionId) ?? this.driverFor(found);
    if (!driver) return;
    if (message.type === "open-download") {
      await this.openDownload(sessionId, driver, message.name);
      return;
    }
    if (!isOperatorDrivingBrowser(found.session)) return;
    if (message.type === "input") {
      await driver.dispatchInput?.(message);
      return;
    }
    if (message.type === "navigate") {
      await driver.navigate(message.url);
      this.lastTabs.delete(sessionId);
      await this.pushTabs(sessionId, driver, found.session);
      return;
    }
    await driver.handle({
      name: "browser_tabs",
      args: { action: message.action, targetId: message.targetId, url: message.url },
    });
    this.lastTabs.delete(sessionId);
    await this.pushTabs(sessionId, driver, found.session);
  }

  private async pushTabs(
    sessionId: string,
    driver: ChromiumDriver,
    session: AgentSession,
  ): Promise<void> {
    if (!driver.listPages) return;
    try {
      const tabs = await driver.listPages();
      const key = JSON.stringify(tabs);
      if (this.lastTabs.get(sessionId) === key) return;
      this.lastTabs.set(sessionId, key);
      const active = tabs.find((tab) => tab.active) ?? tabs[0];
      this.send(sessionId, { type: "tabs", tabs, url: active?.url });
      const allow = (await this.locks?.allowHosts?.(session)) ?? [];
      this.send(sessionId, {
        type: "status",
        controller: controllerOf(session),
        ready: this.live.has(sessionId),
        jail: session.network,
        deniedHost: browserDeniedHost(active?.url, session.network, allow) ?? null,
      });
    } catch {
      /* keep the last strip */
    }
  }

  private async pushDownloads(sessionId: string, driver: ChromiumDriver): Promise<void> {
    if (!driver.listDownloads) return;
    try {
      const files = await driver.listDownloads();
      const key = files.join("\n");
      if (this.lastDownloads.get(sessionId) === key) return;
      this.lastDownloads.set(sessionId, key);
      this.send(sessionId, { type: "downloads", files });
    } catch {
      /* keep the last list */
    }
  }

  private async openDownload(
    sessionId: string,
    driver: ChromiumDriver,
    name: string,
  ): Promise<void> {
    const copied = driver.copyDownload
      ? await driver.copyDownload(name)
      : await driver.handle({ name: "browser_download", args: { action: "get", filename: name } });
    const saved = this.locks?.saveDownload
      ? await this.locks.saveDownload(sessionId, copied)
      : copied;
    if (!saved.ok || !saved.artifactName) return;
    const files = driver.listDownloads ? await driver.listDownloads() : [];
    this.lastDownloads.set(sessionId, files.join("\n"));
    this.send(sessionId, { type: "downloads", files, opened: saved.artifactName });
  }

  private fanoutFrame(sessionId: string, frame: ScreencastFrame): void {
    this.send(sessionId, {
      type: "frame",
      mime: frame.mime,
      data: frame.data,
      metadata: frame.metadata,
    });
  }

  private send(sessionId: string, message: BrowserServerMessage): void {
    const raw = JSON.stringify(message);
    for (const ws of this.viewers.get(sessionId) ?? []) {
      if (ws.readyState === 1) ws.send(raw);
    }
  }
}

function controllerOf(session: AgentSession): BrowserController {
  return isOperatorDrivingBrowser(session) ? "operator" : "agent";
}
