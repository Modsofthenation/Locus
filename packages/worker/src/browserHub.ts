import type { WebSocket } from "ws";
import {
  parseBrowserClientMessage,
  type BrowserClientMessage,
  type BrowserServerMessage,
  type BrowserTab,
} from "@locus/shared";
import type { ChromiumDriver, ScreencastFrame } from "@locus/guest-agent";
import type { DockerEngine } from "@locus/hypervisor";
import type { VmInstance } from "@locus/shared";
import type { WorkerGuestHub } from "./guests.js";

/** Screencast + tabs for one worker guest. Laptop fans out to the operator pane. */
export class WorkerBrowserHub {
  private viewers = new Map<string, Set<WebSocket>>();
  private live = new Set<string>();
  private drivers = new Map<string, ChromiumDriver>();
  private tabTimer = new Map<string, ReturnType<typeof setInterval>>();
  private lastTabs = new Map<string, string>();
  private lastDownloads = new Map<string, string>();
  private inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly guests: WorkerGuestHub,
    private readonly engine: DockerEngine,
    private readonly lookupGuest?: (id: string) => VmInstance | undefined,
  ) {}

  attach(vmId: string, ws: WebSocket): void {
    const set = this.viewers.get(vmId) ?? new Set();
    set.add(ws);
    this.viewers.set(vmId, set);
    const drop = () => this.detach(vmId, ws);
    ws.on("close", drop);
    ws.on("error", drop);
    ws.on("message", (raw) => {
      void this.onClient(vmId, String(raw));
    });
    void this.ensure(vmId);
  }

  drop(vmId: string): void {
    for (const ws of this.viewers.get(vmId) ?? []) {
      try {
        ws.close(1001, "guest gone");
      } catch {
        /* already closed */
      }
    }
    this.viewers.delete(vmId);
    this.stopLive(vmId);
  }

  private detach(vmId: string, ws: WebSocket): void {
    const set = this.viewers.get(vmId);
    if (!set) return;
    set.delete(ws);
    if (set.size > 0) return;
    this.viewers.delete(vmId);
    this.stopLive(vmId);
  }

  private stopLive(vmId: string): void {
    this.lastTabs.delete(vmId);
    this.lastDownloads.delete(vmId);
    const timer = this.tabTimer.get(vmId);
    if (timer) clearInterval(timer);
    this.tabTimer.delete(vmId);
    if (!this.live.delete(vmId)) return;
    const driver = this.drivers.get(vmId);
    this.drivers.delete(vmId);
    void driver?.stopScreencast?.();
  }

  private async ensure(vmId: string): Promise<void> {
    const prev = this.inflight.get(vmId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => this.ensureLive(vmId));
    this.inflight.set(vmId, run);
    try {
      await run;
    } finally {
      if (this.inflight.get(vmId) === run) this.inflight.delete(vmId);
    }
  }

  private async ensureLive(vmId: string): Promise<void> {
    const vm = this.lookupGuest?.(vmId) ?? this.engine.get(vmId);
    if (!vm) {
      this.send(vmId, {
        type: "status",
        controller: "agent",
        ready: false,
        error: "Guest is not running",
      });
      return;
    }
    const driver = this.guests.forVm(vm).chromium();
    if (!driver?.startScreencast) {
      this.send(vmId, {
        type: "status",
        controller: "agent",
        ready: false,
        error: "Live Chromium needs a real Docker engine.",
      });
      return;
    }
    if (this.live.has(vmId)) {
      this.send(vmId, { type: "status", controller: "agent", ready: true });
      await this.pushTabs(vmId, driver);
      await this.pushDownloads(vmId, driver);
      return;
    }
    this.live.add(vmId);
    this.drivers.set(vmId, driver);
    try {
      await driver.startScreencast((frame) => this.fanoutFrame(vmId, frame));
      if ((this.viewers.get(vmId)?.size ?? 0) === 0) {
        this.stopLive(vmId);
        return;
      }
      this.send(vmId, { type: "status", controller: "agent", ready: true });
      await this.pushTabs(vmId, driver);
      await this.pushDownloads(vmId, driver);
      const timer = setInterval(() => {
        void this.pushTabs(vmId, driver);
        void this.pushDownloads(vmId, driver);
      }, 1000);
      timer.unref?.();
      this.tabTimer.set(vmId, timer);
    } catch (err) {
      this.stopLive(vmId);
      this.send(vmId, {
        type: "status",
        controller: "agent",
        ready: false,
        error: err instanceof Error ? err.message : "Chromium screencast failed",
      });
    }
  }

  private async onClient(vmId: string, raw: string): Promise<void> {
    const message = parseBrowserClientMessage(raw);
    if (!message) return;
    if (
      message.type === "takeover" ||
      message.type === "handback" ||
      message.type === "open-download"
    ) {
      return;
    }
    try {
      await this.handleClient(vmId, message);
    } catch {
      /* keep the pane attached */
    }
  }

  private async handleClient(vmId: string, message: BrowserClientMessage): Promise<void> {
    const vm = this.lookupGuest?.(vmId) ?? this.engine.get(vmId);
    if (!vm) return;
    const driver = this.drivers.get(vmId) ?? this.guests.forVm(vm).chromium();
    if (!driver) return;
    if (message.type === "input") {
      await driver.dispatchInput?.(message);
      return;
    }
    if (message.type === "navigate") {
      await driver.navigate(message.url);
      this.lastTabs.delete(vmId);
      await this.pushTabs(vmId, driver);
      return;
    }
    if (message.type !== "tab") return;
    await driver.handle({
      name: "browser_tabs",
      args: { action: message.action, targetId: message.targetId, url: message.url },
    });
    this.lastTabs.delete(vmId);
    await this.pushTabs(vmId, driver);
  }

  private async pushTabs(vmId: string, driver: ChromiumDriver): Promise<void> {
    if (!driver.listPages) return;
    try {
      const tabs = await driver.listPages();
      const key = JSON.stringify(tabs);
      if (this.lastTabs.get(vmId) === key) return;
      this.lastTabs.set(vmId, key);
      const active = tabs.find((tab: BrowserTab) => tab.active) ?? tabs[0];
      this.send(vmId, { type: "tabs", tabs, url: active?.url });
    } catch {
      /* keep the last strip */
    }
  }

  private async pushDownloads(vmId: string, driver: ChromiumDriver): Promise<void> {
    if (!driver.listDownloads) return;
    try {
      const files = await driver.listDownloads();
      const key = files.join("\n");
      if (this.lastDownloads.get(vmId) === key) return;
      this.lastDownloads.set(vmId, key);
      this.send(vmId, { type: "downloads", files });
    } catch {
      /* keep the last list */
    }
  }

  private fanoutFrame(vmId: string, frame: ScreencastFrame): void {
    this.send(vmId, {
      type: "frame",
      mime: frame.mime,
      data: frame.data,
      metadata: frame.metadata,
    });
  }

  private send(vmId: string, message: BrowserServerMessage): void {
    const raw = JSON.stringify(message);
    for (const ws of this.viewers.get(vmId) ?? []) {
      if (ws.readyState === 1) ws.send(raw);
    }
  }
}
