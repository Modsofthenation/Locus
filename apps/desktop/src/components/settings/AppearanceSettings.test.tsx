import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppearanceSettings } from "./AppearanceSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AppearanceSettings", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("groups See all themes by family", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <AppearanceSettings
          theme="ember"
          savedTheme="ember"
          editorFontSize={13}
          formatOnSave
          showMinimap
          onSelect={() => undefined}
          onEditor={() => undefined}
        />,
      );
    });
    expect(host.querySelector("[data-testid='theme-family-dark']")).toBeNull();
    const seeAll = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.startsWith("See all"),
    );
    expect(seeAll).toBeTruthy();
    await act(async () => {
      seeAll!.click();
    });
    expect(host.querySelector("[data-testid='theme-family-dark']")?.textContent).toContain("Dark");
    expect(host.querySelector("[data-testid='theme-family-light']")?.textContent).toContain(
      "Light",
    );
    expect(host.querySelector("[data-testid='theme-family-contrast']")?.textContent).toContain(
      "Contrast",
    );
    expect(host.querySelector("[data-testid='theme-family-gradient']")?.textContent).toContain(
      "Gradient",
    );
  });

  it("puts product mode first with what each mode includes, and uses switches for on/off prefs", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onEditor = vi.fn();
    await act(async () => {
      root.render(
        <AppearanceSettings
          theme="ember"
          savedTheme="ember"
          productMode="developer"
          editorFontSize={13}
          formatOnSave
          showMinimap={false}
          onSelect={() => undefined}
          onEditor={onEditor}
        />,
      );
    });
    const main = host.querySelector(".appearance-main")!;
    expect(main.firstElementChild?.classList.contains("appearance-product-mode")).toBe(true);
    const developer = host.querySelector("[data-testid='appearance-product-mode-developer']");
    expect(developer?.getAttribute("aria-checked")).toBe("true");
    expect(developer?.textContent).toContain("Codebase");
    expect(
      host.querySelector("[data-testid='appearance-product-mode-swarm']")?.textContent,
    ).toMatch(/Teammates/);
    expect(host.querySelector(".appearance-editor-prefs input[type='checkbox']")).toBeNull();
    const minimap = host.querySelector("[data-testid='appearance-minimap']") as HTMLButtonElement;
    expect(minimap.getAttribute("role")).toBe("switch");
    expect(minimap.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      minimap.click();
    });
    expect(onEditor).toHaveBeenCalledWith({ showMinimap: true });
  });
});
