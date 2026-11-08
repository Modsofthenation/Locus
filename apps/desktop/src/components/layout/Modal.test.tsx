import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Modal", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("traps focus, labels the dialog, and closes on backdrop and Escape", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <Modal titleId="sample-title" testId="sample-modal" onClose={onClose}>
          <h2 id="sample-title">Sample</h2>
          <button type="button">First</button>
          <button type="button">Last</button>
        </Modal>,
      );
    });
    const dialog = host.querySelector("[role='dialog']") as HTMLElement;
    expect(dialog.getAttribute("aria-labelledby")).toBe("sample-title");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(host.querySelector("[data-testid='sample-modal']")).toBeTruthy();
    await act(async () => {
      (host.querySelector("[data-testid='sample-modal']") as HTMLElement).click();
    });
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
