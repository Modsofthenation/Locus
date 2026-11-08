import { afterEach, describe, expect, it, vi } from "vitest";
import { askAlert, askConfirm, askPrompt, bindDialogHost } from "./dialog";

describe("dialog host", () => {
  afterEach(() => {
    bindDialogHost(null);
    vi.restoreAllMocks();
  });

  it("falls back to window.confirm / prompt / alert", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("nightly");
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    expect(await askConfirm({ title: "Stop?", body: "Stop web?", confirmLabel: "Stop" })).toBe(
      true,
    );
    expect(window.confirm).toHaveBeenCalledWith("Stop web?");
    expect(await askPrompt({ title: "Name this golden image", value: "fallback" })).toBe("nightly");
    expect(window.prompt).toHaveBeenCalledWith("Name this golden image", "fallback");
    await askAlert({ title: "Diffs", body: "No diffs yet" });
    expect(alert).toHaveBeenCalledWith("No diffs yet");
  });

  it("uses the bound host when present", async () => {
    bindDialogHost({
      confirm: async () => false,
      prompt: async () => "from-host",
      alert: async () => undefined,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(await askConfirm("Are you sure?")).toBe(false);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(await askPrompt("Name")).toBe("from-host");
  });
});
