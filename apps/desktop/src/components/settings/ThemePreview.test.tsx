import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ThemePreview } from "./ThemePreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ThemePreview", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders a static new-agent mock for the given theme", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<ThemePreview theme="paper" />);
    });
    const preview = host.querySelector("[data-testid='theme-preview']");
    expect(preview?.getAttribute("data-theme")).toBe("paper");
    expect(preview?.hasAttribute("data-theme-gradient")).toBe(false);
    expect(preview?.hasAttribute("inert")).toBe(true);
    expect(host.textContent).toContain("Preview");
    expect(host.textContent).toContain("Paper");
    expect(host.textContent).toContain("What should we talk about?");
    expect(host.textContent).toContain("Start chat");
    expect(host.querySelector("textarea")?.getAttribute("placeholder")).toBe("Ask a question…");
  });

  it("marks gradient themes on the preview surface", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<ThemePreview theme="horizon" />);
    });
    const preview = host.querySelector("[data-testid='theme-preview']");
    expect(preview?.getAttribute("data-theme")).toBe("horizon");
    expect(preview?.hasAttribute("data-theme-gradient")).toBe(true);
    expect(host.textContent).toContain("Horizon");
  });
});
