import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useDialogFocus } from "./useDialogFocus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe(props: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(props.open, props.onClose, dialog);
  if (!props.open) return <button type="button">Opener</button>;
  return (
    <div ref={dialog} role="dialog">
      <button type="button">First</button>
      <button type="button">Last</button>
    </div>
  );
}

describe("useDialogFocus", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("focuses the first control, wraps Tab, and restores on close", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let closed = false;
    function Shell() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" id="opener" onClick={() => setOpen(true)}>
            Open
          </button>
          <Probe
            open={open}
            onClose={() => {
              closed = true;
              setOpen(false);
            }}
          />
        </>
      );
    }
    act(() => {
      root.render(<Shell />);
    });
    const opener = host.querySelector("#opener") as HTMLButtonElement;
    act(() => {
      opener.focus();
      opener.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement?.textContent).toBe("First");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe("Last");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe("First");
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(closed).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(opener);
  });
});
