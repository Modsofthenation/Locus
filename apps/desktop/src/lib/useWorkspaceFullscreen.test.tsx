import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useWorkspaceFullscreen } from "./useWorkspaceFullscreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The hook decides after the keydown finishes dispatching, so other handlers can claim it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function Probe() {
  const fs = useWorkspaceFullscreen();
  return (
    <aside className={`vm-pane ${fs.className}`.trim()} data-fs={fs.isFullscreen ? "1" : "0"}>
      <button type="button" onClick={fs.toggle}>
        {fs.isFullscreen ? "exit" : "enter"}
      </button>
    </aside>
  );
}

describe("useWorkspaceFullscreen", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<Probe />);
    });
  }

  it("covers the window with a CSS overlay and leaves on Escape", async () => {
    render();
    const pane = host.querySelector(".vm-pane") as HTMLElement;
    await act(async () => {
      host.querySelector("button")!.click();
    });
    expect(pane.classList.contains("workspace-fs")).toBe(true);
    expect(pane.getAttribute("data-fs")).toBe("1");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await settle();
    });
    expect(pane.classList.contains("workspace-fs")).toBe(false);
    expect(pane.getAttribute("data-fs")).toBe("0");
  });

  it("does not exit when Escape was already handled", async () => {
    render();
    const pane = host.querySelector(".vm-pane") as HTMLElement;
    await act(async () => {
      host.querySelector("button")!.click();
    });
    await act(async () => {
      const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      event.preventDefault();
      window.dispatchEvent(event);
      await settle();
    });
    expect(pane.classList.contains("workspace-fs")).toBe(true);
  });

  it("stays when a handler registered later claims the Escape", async () => {
    render();
    const pane = host.querySelector(".vm-pane") as HTMLElement;
    await act(async () => {
      host.querySelector("button")!.click();
    });
    // e.g. a menu opened after entering full screen
    const later = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", later);
    try {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
        await settle();
      });
    } finally {
      window.removeEventListener("keydown", later);
    }
    expect(pane.classList.contains("workspace-fs")).toBe(true);
  });

  it("toggles off from the same control", async () => {
    render();
    const pane = host.querySelector(".vm-pane") as HTMLElement;
    await act(async () => {
      host.querySelector("button")!.click();
    });
    expect(pane.classList.contains("workspace-fs")).toBe(true);
    await act(async () => {
      host.querySelector("button")!.click();
    });
    expect(pane.classList.contains("workspace-fs")).toBe(false);
  });
});
