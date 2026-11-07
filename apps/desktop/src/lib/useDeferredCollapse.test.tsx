import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PANE_MOTION_MS, useDeferredCollapse } from "./useDeferredCollapse";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe(props: { collapsed: boolean; onValue: (value: boolean) => void }) {
  props.onValue(useDeferredCollapse(props.collapsed));
  return null;
}

describe("useDeferredCollapse", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("keeps the expanded tree until the width motion finishes, then swaps on expand immediately", () => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const seen: boolean[] = [];
    act(() => {
      root.render(<Probe collapsed={false} onValue={(value) => seen.push(value)} />);
    });
    expect(seen.at(-1)).toBe(false);
    act(() => {
      root.render(<Probe collapsed onValue={(value) => seen.push(value)} />);
    });
    expect(seen.at(-1)).toBe(false);
    act(() => {
      vi.advanceTimersByTime(PANE_MOTION_MS - 1);
    });
    expect(seen.at(-1)).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(seen.at(-1)).toBe(true);
    act(() => {
      root.render(<Probe collapsed={false} onValue={(value) => seen.push(value)} />);
    });
    expect(seen.at(-1)).toBe(false);
  });
});
