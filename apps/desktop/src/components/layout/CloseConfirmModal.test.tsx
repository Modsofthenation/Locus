import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloseConfirmModal } from "./CloseConfirmModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

describe("CloseConfirmModal", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function render(opts: { onCancel?: () => void; onConfirm?: () => void; count?: number }) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const agents = Array.from({ length: opts.count ?? 1 }, (_, i) => ({ title: `Agent ${i + 1}` }));
    await act(async () => {
      root.render(
        <CloseConfirmModal
          agents={agents}
          onCancel={opts.onCancel ?? (() => undefined)}
          onConfirm={opts.onConfirm ?? (() => undefined)}
        />,
      );
    });
  }

  it("asks before closing with cancel and close actions", async () => {
    expect(css).toMatch(/\.modal\.close-confirm \{[\s\S]*?width:\s*min\(420px/);
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    await render({ onCancel, onConfirm });
    const dialog = host.querySelector("[data-testid='close-confirm-modal']");
    expect(dialog).toBeTruthy();
    expect(host.querySelector("#close-confirm-title")?.textContent).toBe("Active agent");
    expect(host.textContent).toContain(
      "There is currently an active agent. Are you sure you want to close?",
    );
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((row) => row.textContent)).toEqual(["Cancel", "Close"]);
    await act(async () => {
      buttons[0]!.click();
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => {
      buttons[1]!.click();
    });
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cancels from Escape and the backdrop", async () => {
    const onCancel = vi.fn();
    await render({ onCancel, count: 2 });
    expect(host.querySelector("#close-confirm-title")?.textContent).toBe("Active agents");
    expect(host.textContent).toContain("There are currently 2 active agents");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
    await act(async () => {
      host
        .querySelector("[data-testid='close-confirm-modal']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
