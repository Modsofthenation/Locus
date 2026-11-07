import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmModal } from "./ConfirmModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

describe("ConfirmModal", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("confirms and cancels with the close-confirm chrome", async () => {
    expect(css).toMatch(/\.modal\.close-confirm \{[\s\S]*?width:\s*min\(420px/);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(
        <ConfirmModal
          title="Delete job"
          body="This cannot be undone."
          confirmLabel="Delete"
          danger
          testId="auto-confirm"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />,
      );
    });
    const dialog = host.querySelector("[data-testid='auto-confirm']");
    expect(dialog).toBeTruthy();
    expect(host.querySelector("#confirm-modal-title")?.textContent).toBe("Delete job");
    expect(host.textContent).toContain("This cannot be undone.");
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((row) => row.textContent)).toEqual(["Cancel", "Delete"]);
    await act(async () => {
      buttons[1]!.click();
    });
    expect(onConfirm).toHaveBeenCalledOnce();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
