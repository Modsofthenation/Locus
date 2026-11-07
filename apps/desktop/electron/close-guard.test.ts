import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { CHANNELS, installCloseGuard, windowCanPrompt, senderIsWindow } = createRequire(
  import.meta.url,
)("./close-guard.cjs") as {
  CHANNELS: {
    setGuard: string;
    closeRequested: string;
    closeAck: string;
    confirmClose: string;
  };
  installCloseGuard: (opts: {
    app: { quit: () => void };
    ipcMain: { on: (channel: string, listener: (...args: unknown[]) => void) => void };
    getWindow: () => {
      isDestroyed: () => boolean;
      webContents: { isDestroyed: () => boolean; send: (channel: string) => void };
    } | null;
    promptTimeoutMs?: number;
  }) => {
    onCloseAttempt: (event: { preventDefault: () => void }) => boolean;
    isArmed: () => boolean;
    isAllowed: () => boolean;
  };
  windowCanPrompt: (win: unknown) => boolean;
  senderIsWindow: (
    event: { sender?: unknown },
    getWindow: () => { webContents: unknown } | null,
  ) => boolean;
};

function fakeIpc() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    listeners,
    on(channel: string, listener: (...args: unknown[]) => void) {
      const rows = listeners.get(channel) ?? [];
      rows.push(listener);
      listeners.set(channel, rows);
    },
    emit(channel: string, ...args: unknown[]) {
      for (const listener of listeners.get(channel) ?? []) listener(...args);
    },
  };
}

function fakeWindow() {
  const send = vi.fn();
  const webContents = { isDestroyed: () => false, send };
  return {
    send,
    win: {
      isDestroyed: () => false,
      webContents,
    },
    fromWindow: { sender: webContents },
    foreign: { sender: { isDestroyed: () => false, send: vi.fn() } },
  };
}

describe("installCloseGuard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets the window close when the guard is off", () => {
    const ipc = fakeIpc();
    const app = { quit: vi.fn() };
    const { win, send } = fakeWindow();
    const guard = installCloseGuard({ app, ipcMain: ipc, getWindow: () => win });
    const event = { preventDefault: vi.fn() };
    expect(guard.onCloseAttempt(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("blocks close and asks the renderer when an agent is active", () => {
    const ipc = fakeIpc();
    const app = { quit: vi.fn() };
    const { win, send, fromWindow } = fakeWindow();
    const guard = installCloseGuard({ app, ipcMain: ipc, getWindow: () => win });
    ipc.emit(CHANNELS.setGuard, fromWindow, true);
    expect(guard.isArmed()).toBe(true);
    const event = { preventDefault: vi.fn() };
    expect(guard.onCloseAttempt(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(CHANNELS.closeRequested);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("ignores guard and confirm messages from another sender", () => {
    const ipc = fakeIpc();
    const app = { quit: vi.fn() };
    const { win, fromWindow, foreign } = fakeWindow();
    const guard = installCloseGuard({ app, ipcMain: ipc, getWindow: () => win });
    ipc.emit(CHANNELS.setGuard, foreign, true);
    expect(guard.isArmed()).toBe(false);
    ipc.emit(CHANNELS.setGuard, fromWindow, true);
    ipc.emit(CHANNELS.confirmClose, foreign);
    expect(guard.isAllowed()).toBe(false);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("quits after the renderer confirms close", () => {
    const ipc = fakeIpc();
    const app = { quit: vi.fn() };
    const { win, fromWindow } = fakeWindow();
    const guard = installCloseGuard({ app, ipcMain: ipc, getWindow: () => win });
    ipc.emit(CHANNELS.setGuard, fromWindow, true);
    ipc.emit(CHANNELS.confirmClose, fromWindow);
    expect(guard.isAllowed()).toBe(true);
    expect(app.quit).toHaveBeenCalledOnce();
    const event = { preventDefault: vi.fn() };
    expect(guard.onCloseAttempt(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not block if the window is already gone", () => {
    const ipc = fakeIpc();
    const app = { quit: vi.fn() };
    const guard = installCloseGuard({ app, ipcMain: ipc, getWindow: () => null });
    ipc.emit(CHANNELS.setGuard, { sender: {} }, true);
    const event = { preventDefault: vi.fn() };
    expect(guard.onCloseAttempt(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("fails open if the renderer never acks the prompt", () => {
    vi.useFakeTimers();
    const ipc = fakeIpc();
    const app = { quit: vi.fn() };
    const { win, fromWindow } = fakeWindow();
    const guard = installCloseGuard({
      app,
      ipcMain: ipc,
      getWindow: () => win,
      promptTimeoutMs: 20,
    });
    ipc.emit(CHANNELS.setGuard, fromWindow, true);
    expect(guard.onCloseAttempt({ preventDefault: vi.fn() })).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(guard.isAllowed()).toBe(true);
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("does not auto-quit after the renderer acks the prompt", () => {
    vi.useFakeTimers();
    const ipc = fakeIpc();
    const app = { quit: vi.fn() };
    const { win, fromWindow } = fakeWindow();
    const guard = installCloseGuard({
      app,
      ipcMain: ipc,
      getWindow: () => win,
      promptTimeoutMs: 20,
    });
    ipc.emit(CHANNELS.setGuard, fromWindow, true);
    expect(guard.onCloseAttempt({ preventDefault: vi.fn() })).toBe(true);
    ipc.emit(CHANNELS.closeAck, fromWindow);
    vi.advanceTimersByTime(50);
    expect(guard.isAllowed()).toBe(false);
    expect(app.quit).not.toHaveBeenCalled();
  });
});

describe("windowCanPrompt", () => {
  it("rejects destroyed windows and contents", () => {
    expect(windowCanPrompt(null)).toBe(false);
    expect(windowCanPrompt({ isDestroyed: () => true, webContents: {} })).toBe(false);
    expect(
      windowCanPrompt({
        isDestroyed: () => false,
        webContents: { isDestroyed: () => true },
      }),
    ).toBe(false);
    expect(
      windowCanPrompt({
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false },
      }),
    ).toBe(true);
  });
});

describe("senderIsWindow", () => {
  it("requires the event sender to be this window's webContents", () => {
    const webContents = { isDestroyed: () => false };
    const getWindow = () => ({ isDestroyed: () => false, webContents });
    expect(senderIsWindow({ sender: webContents }, getWindow)).toBe(true);
    expect(senderIsWindow({ sender: {} }, getWindow)).toBe(false);
    expect(senderIsWindow({ sender: webContents }, () => null)).toBe(false);
  });
});

describe("electron close wiring", () => {
  it("keeps preload channels aligned with the close guard", () => {
    const preload = readFileSync(join(desktopRoot, "electron/preload.cjs"), "utf8");
    const main = readFileSync(join(desktopRoot, "electron/main.cjs"), "utf8");
    expect(preload).toContain(`"${CHANNELS.setGuard}"`);
    expect(preload).toContain(`"${CHANNELS.closeRequested}"`);
    expect(preload).toContain(`"${CHANNELS.closeAck}"`);
    expect(preload).toContain(`"${CHANNELS.confirmClose}"`);
    expect(preload).toContain("ackClosePrompt");
    expect(preload).toContain("exposeInMainWorld");
    expect(preload).toContain("locusDesktop");
    expect(main).toContain('preload: join(__dirname, "preload.cjs")');
    expect(main).toContain("installCloseGuard");
    expect(main).toContain('win.on("close"');
    expect(main).toContain("closeGuard.onCloseAttempt");
  });
});
