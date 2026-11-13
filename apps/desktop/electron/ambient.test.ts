import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
type Listener = (...args: unknown[]) => void;

const ambient = createRequire(import.meta.url)("./ambient.cjs") as {
  ACTION: string;
  NOTIFY: string;
  STATUS: string;
  actionForIndex: (index: number) => string;
  notificationActions: (request: { approvable: boolean }, platform: string) => unknown[];
  parseNotify: (
    raw: unknown,
  ) =>
    | { title: string; body: string; sessionId?: string; callId?: string; approvable: boolean }
    | undefined;
  parseStatus: (raw: unknown) => { running: number; needsYou: number };
  trayCopy: (status: unknown) => { tooltip: string; needs: string; run: string };
  installAmbient: (opts: Record<string, unknown>) => { destroy: () => void };
};

describe("ambient helpers", () => {
  it("clamps status counts", () => {
    expect(ambient.parseStatus({ running: 2.7, needsYou: -1 })).toEqual({
      running: 2,
      needsYou: 0,
    });
    expect(ambient.parseStatus(null)).toEqual({ running: 0, needsYou: 0 });
  });

  it("writes tray copy", () => {
    expect(ambient.trayCopy({ running: 0, needsYou: 0 }).tooltip).toBe("Locus");
    const copy = ambient.trayCopy({ running: 3, needsYou: 1 });
    expect(copy.tooltip).toBe("Locus — 1 needs you · 3 running");
    expect(copy.needs).toBe("1 needs you");
    expect(ambient.trayCopy({ running: 0, needsYou: 2 }).needs).toBe("2 need you");
  });

  it("validates notification requests", () => {
    expect(ambient.parseNotify({ title: "  " })).toBeUndefined();
    expect(ambient.parseNotify({ title: "T", approvable: true })?.approvable).toBe(false);
    expect(
      ambient.parseNotify({ title: "T", sessionId: "s", callId: "c", approvable: true })
        ?.approvable,
    ).toBe(true);
  });

  it("only adds Approve / Deny buttons on macOS", () => {
    expect(ambient.notificationActions({ approvable: true }, "darwin")).toHaveLength(2);
    expect(ambient.notificationActions({ approvable: true }, "linux")).toEqual([]);
    expect(ambient.notificationActions({ approvable: false }, "darwin")).toEqual([]);
    expect([0, 1, 5].map(ambient.actionForIndex)).toEqual(["approve", "deny", "open"]);
  });

  it("keeps preload channels aligned", () => {
    const preload = readFileSync(join(desktopRoot, "electron/preload.cjs"), "utf8");
    for (const channel of [ambient.STATUS, ambient.NOTIFY, ambient.ACTION]) {
      expect(preload).toContain(`"${channel}"`);
    }
  });
});

describe("installAmbient", () => {
  function setup(platform = "darwin") {
    const handlers = new Map<string, Listener>();
    const sent: unknown[] = [];
    const win = {
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: (_channel: string, payload: unknown) => sent.push(payload) },
    };
    const notes: Array<{ handlers: Map<string, Listener>; opts: Record<string, unknown> }> = [];
    class FakeNotification {
      handlers = new Map<string, Listener>();
      constructor(public opts: Record<string, unknown>) {
        notes.push(this);
      }
      static isSupported() {
        return true;
      }
      on(event: string, fn: Listener) {
        this.handlers.set(event, fn);
      }
      show() {}
    }
    const tray = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn(), destroy: vi.fn() };
    const app = { setBadgeCount: vi.fn(), quit: vi.fn() };
    ambient.installAmbient({
      electron: {
        app,
        Menu: { buildFromTemplate: (items: unknown[]) => items },
        Notification: FakeNotification,
        Tray: function Tray() {
          return tray;
        },
        nativeImage: {
          createFromPath: () => ({ isEmpty: () => false, resize: () => ({}) }),
        },
      },
      ipcMain: { on: (channel: string, fn: Listener) => handlers.set(channel, fn) },
      getWindow: () => win,
      icon: "icon.png",
      platform,
    });
    return { handlers, sent, win, notes, tray, app };
  }

  it("updates the badge and tray from status", () => {
    const { handlers, tray, app } = setup();
    handlers.get(ambient.STATUS)!({}, { running: 1, needsYou: 2 });
    expect(app.setBadgeCount).toHaveBeenCalledWith(2);
    expect(tray.setToolTip).toHaveBeenCalledWith("Locus — 2 need you · 1 running");
  });

  it("routes notification clicks and actions back to the renderer", () => {
    const { handlers, sent, win, notes } = setup();
    handlers.get(ambient.NOTIFY)!(
      {},
      { title: "Chat", body: "npm test", sessionId: "s1", callId: "c1", approvable: true },
    );
    expect(notes[0]!.opts.actions).toHaveLength(2);
    notes[0]!.handlers.get("action")!({}, 0);
    expect(sent.at(-1)).toEqual({ action: "approve", sessionId: "s1", callId: "c1" });
    // Approve resolves in the background without raising the window.
    expect(win.show).not.toHaveBeenCalled();
    notes[0]!.handlers.get("click")!();
    expect(sent.at(-1)).toEqual({ action: "open", sessionId: "s1", callId: "c1" });
    expect(win.show).toHaveBeenCalled();
  });
});
