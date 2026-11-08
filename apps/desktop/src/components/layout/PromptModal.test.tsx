import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptModal } from "./PromptModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PromptModal", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("submits the typed value and cancels on Escape", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(
        <PromptModal
          title="Name this golden image"
          value="Web app image"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />,
      );
    });
    const dialog = host.querySelector("[data-testid='prompt-modal']");
    expect(dialog).toBeTruthy();
    expect(host.querySelector("#prompt-modal-title")?.textContent).toBe("Name this golden image");
    const input = host.querySelector(".prompt-modal-input") as HTMLInputElement;
    expect(input.value).toBe("Web app image");
    await act(async () => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Save")!.click();
    });
    expect(onConfirm).toHaveBeenCalledWith("Web app image");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
