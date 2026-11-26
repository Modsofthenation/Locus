import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ThemePreferences as Prefs } from "@locus/shared";
import { ThemePreferences } from "./ThemePreferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(preferences: Prefs | undefined, onChange = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <ThemePreferences
        preferences={preferences}
        themes={[]}
        workspaces={[{ key: "repo:web", label: "web" }]}
        onChange={onChange}
      />,
    ),
  );
  return { host, onChange, done: () => act(() => root.unmount()) };
}

describe("ThemePreferences", () => {
  it("turns on a time-of-day schedule seeded from the light/dark pair", () => {
    const { host, onChange, done } = mount({ light: "linen", dark: "nord" });
    const toggle = [...host.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((el) =>
      el.parentElement?.textContent?.includes("time of day"),
    )!;
    act(() => toggle.click());
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleOn: true,
        schedule: [
          { at: "08:00", theme: "linen" },
          { at: "19:00", theme: "nord" },
        ],
      }),
    );
    done();
  });

  it("lists adaptive themes for both slots and sets a workspace theme", () => {
    const { host, onChange, done } = mount({
      scheduleOn: true,
      schedule: [{ at: "09:00", theme: "ember" }],
    });
    const light = host.querySelector<HTMLSelectElement>("select[id$='-light']")!;
    expect([...light.options].map((o) => o.value)).toContain("riptide");
    expect(host.querySelector("input[aria-label='Slot 1 start']")).not.toBeNull();
    const workspace = host.querySelector<HTMLSelectElement>("select[id$='-workspace']")!;
    act(() => {
      workspace.value = "repo:web";
      workspace.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const pick = host.querySelector<HTMLSelectElement>("select[id$='-workspace-theme']")!;
    act(() => {
      pick.value = "velvet";
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceThemes: { "repo:web": "velvet" } }),
    );
    done();
  });
});
