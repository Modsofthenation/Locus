import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const { dropWindowsApplicationMenu, swallowBareAlt, installWindowsInputGuard } = createRequire(
  import.meta.url,
)("./windows-input.cjs") as {
  dropWindowsApplicationMenu: (
    Menu: { setApplicationMenu: (menu: null) => void } | null,
    platform?: string,
  ) => boolean;
  swallowBareAlt: (input: {
    type?: string;
    key?: string;
    code?: string;
    control?: boolean;
    meta?: boolean;
    shift?: boolean;
  }) => boolean;
  installWindowsInputGuard: (win: unknown, opts?: { platform?: string }) => boolean;
};

describe("dropWindowsApplicationMenu", () => {
  it("nulls the application menu on Windows only", () => {
    const setApplicationMenu = vi.fn();
    expect(dropWindowsApplicationMenu({ setApplicationMenu }, "linux")).toBe(false);
    expect(dropWindowsApplicationMenu({ setApplicationMenu }, "darwin")).toBe(false);
    expect(setApplicationMenu).not.toHaveBeenCalled();
    expect(dropWindowsApplicationMenu({ setApplicationMenu }, "win32")).toBe(true);
    expect(setApplicationMenu).toHaveBeenCalledWith(null);
  });
});

describe("swallowBareAlt", () => {
  it("swallows Alt alone so Windows cannot arm menu mnemonics", () => {
    expect(swallowBareAlt({ type: "keyDown", key: "Alt", code: "AltLeft" })).toBe(true);
    expect(swallowBareAlt({ type: "keyUp", key: "Alt", code: "AltRight" })).toBe(true);
  });

  it("leaves Alt chords and other keys alone", () => {
    expect(swallowBareAlt({ type: "keyDown", key: "Alt", code: "AltLeft", shift: true })).toBe(
      false,
    );
    expect(swallowBareAlt({ type: "keyDown", key: "F", code: "KeyF" })).toBe(false);
    expect(swallowBareAlt({ type: "keyDown", key: "=", code: "Equal", control: true })).toBe(false);
  });
});

describe("installWindowsInputGuard", () => {
  it("is a no-op off Windows", () => {
    const win = { setMenu: vi.fn(), webContents: { on: vi.fn() } };
    expect(installWindowsInputGuard(win, { platform: "linux" })).toBe(false);
    expect(win.setMenu).not.toHaveBeenCalled();
    expect(win.webContents.on).not.toHaveBeenCalled();
  });

  it("strips the window menu and swallows bare Alt on Windows", () => {
    const focus = vi.fn();
    const preventDefault = vi.fn();
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const win = {
      setMenu: vi.fn(),
      setAutoHideMenuBar: vi.fn(),
      setMenuBarVisibility: vi.fn(),
      hookWindowMessage: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
      }),
      webContents: {
        isDestroyed: () => false,
        focus,
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          const list = listeners.get(`wc:${event}`) ?? [];
          list.push(listener);
          listeners.set(`wc:${event}`, list);
        }),
      },
    };
    expect(installWindowsInputGuard(win, { platform: "win32" })).toBe(true);
    expect(win.setMenu).toHaveBeenCalledWith(null);
    expect(win.setAutoHideMenuBar).toHaveBeenCalledWith(false);
    expect(win.setMenuBarVisibility).toHaveBeenCalledWith(false);
    expect(win.hookWindowMessage).not.toHaveBeenCalled();
    const onInput = listeners.get("wc:before-input-event")?.[0] as (
      event: { preventDefault: () => void },
      input: { type: string; key: string },
    ) => void;
    onInput({ preventDefault }, { type: "keyDown", key: "Alt" });
    expect(preventDefault).toHaveBeenCalledOnce();
    preventDefault.mockClear();
    onInput({ preventDefault }, { type: "keyDown", key: "F" });
    expect(preventDefault).not.toHaveBeenCalled();
    listeners.get("focus")?.forEach((fn) => fn());
    expect(focus).toHaveBeenCalledOnce();
  });
});
