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

  it("keeps focus on rerender and lets Escape close one dialog at a time", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    function Inner({ close }: { close: () => void }) {
      const ref = useRef<HTMLDivElement>(null);
      useDialogFocus(true, close, ref);
      return (
        <div ref={ref} role="dialog">
          <button type="button" hidden>
            Hidden
          </button>
          <button type="button">Inner action</button>
        </div>
      );
    }

    function Shell() {
      const ref = useRef<HTMLDivElement>(null);
      const [outer, setOuter] = useState(false);
      const [inner, setInner] = useState(false);
      const [text, setText] = useState("");
      useDialogFocus(outer, () => setOuter(false), ref);
      return (
        <>
          <button type="button" onClick={() => setOuter(true)}>
            Open
          </button>
          {outer && (
            <div ref={ref} role="dialog">
              <details>
                <summary>Options</summary>
                <button type="button">Collapsed action</button>
              </details>
              <button type="button" onClick={() => setText("Updated")}>
                Update
              </button>
              <button type="button" onClick={() => setInner(true)}>
                Open inner
              </button>
              <span>{text}</span>
              {inner && <Inner close={() => setInner(false)} />}
            </div>
          )}
        </>
      );
    }

    function press(key: string) {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    }
    async function activate(label: string) {
      const button = [...host.querySelectorAll("button")].find(
        (node) => node.textContent === label,
      )!;
      await act(async () => {
        button.focus();
        button.click();
      });
    }

    await act(async () => root.render(<Shell />));
    await activate("Open");
    expect(document.activeElement?.textContent).toBe("Options");
    act(() => press("Tab"));
    expect(document.activeElement?.textContent).toBe("Update");
    await activate("Update");
    expect(document.activeElement?.textContent).toBe("Update");
    await activate("Open inner");
    expect(document.activeElement?.textContent).toBe("Inner action");
    act(() => press("Escape"));
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement?.textContent).toBe("Open inner");
    act(() => press("Escape"));
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(document.activeElement?.textContent).toBe("Open");
  });
});
