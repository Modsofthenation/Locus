import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
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
});
