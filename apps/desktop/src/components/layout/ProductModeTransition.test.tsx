import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ProductModeTransition } from "./ProductModeTransition";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ProductModeTransition", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the mascot while the destination shell is loading", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root.render(<ProductModeTransition transition={{ from: "developer", to: "swarm" }} />);
    });

    const screen = host.querySelector("[data-testid='product-mode-transition']");
    expect(screen?.getAttribute("role")).toBe("status");
    expect(screen?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector("[data-testid='locus-mascot']")?.getAttribute("data-pose")).toBe(
      "think",
    );
    expect(host.querySelector("[data-testid='locus-mascot']")?.getAttribute("aria-label")).toBe(
      "Switching to Swarm",
    );
    expect(host.textContent).toContain("Switching to Swarm");
    expect(host.textContent).toContain("Getting your workspace ready...");
  });
});
