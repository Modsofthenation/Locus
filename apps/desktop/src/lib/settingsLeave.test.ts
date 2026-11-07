import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmLeaveSettings,
  paletteActionLeavesSettings,
  setSettingsDirty,
  setSettingsPersist,
  settingsIsDirty,
} from "./settingsLeave";

describe("settingsLeave", () => {
  afterEach(() => {
    setSettingsDirty(false);
    vi.restoreAllMocks();
  });

  it("skips the confirm when Settings is clean", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    setSettingsDirty(false);
    expect(confirmLeaveSettings()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("flushes auto-save instead of asking to discard a dirty draft", () => {
    const persist = vi.fn(async () => true);
    const confirm = vi.spyOn(window, "confirm");
    setSettingsDirty(true);
    setSettingsPersist(persist);
    expect(settingsIsDirty()).toBe(true);
    expect(confirmLeaveSettings()).toBe(true);
    expect(persist).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    setSettingsPersist(null);
  });

  it("keeps Settings / theme / in-place palette actions on the page", () => {
    expect(paletteActionLeavesSettings("settings:git")).toBe(false);
    expect(paletteActionLeavesSettings("theme:ember")).toBe(false);
    expect(paletteActionLeavesSettings("keyboard-shortcuts")).toBe(false);
    expect(paletteActionLeavesSettings("workspace-goto")).toBe(false);
    expect(paletteActionLeavesSettings("guest-takeover")).toBe(false);
    expect(paletteActionLeavesSettings("chat-export-html")).toBe(false);
    expect(paletteActionLeavesSettings("docker-stop-running")).toBe(false);
    expect(paletteActionLeavesSettings("section:slack")).toBe(true);
    expect(paletteActionLeavesSettings("new-agent")).toBe(true);
  });
});
