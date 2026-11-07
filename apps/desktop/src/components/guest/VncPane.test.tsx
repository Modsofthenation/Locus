import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VncPane } from "./VncPane";

const rfb = vi.hoisted(() => ({
  disconnect: vi.fn(),
  addEventListener: vi.fn(),
}));

vi.mock("@novnc/novnc", () => ({
  default: class RFB {
    scaleViewport = false;
    clipViewport = false;
    background = "";
    constructor(
      public target: HTMLElement,
      public url: string,
    ) {}
    addEventListener = rfb.addEventListener;
    disconnect = rfb.disconnect;
  },
}));

vi.mock("@/lib/api", () => ({
  displayWsUrl: (id: string) => `ws://127.0.0.1/display/${id}`,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("VncPane", () => {
  let host: HTMLDivElement;
  let root: Root | undefined;

  afterEach(() => {
    const mounted = root;
    if (mounted) act(() => mounted.unmount());
    host.remove();
    root = undefined;
    rfb.disconnect.mockReset();
    rfb.addEventListener.mockReset();
  });

  it("loads noVNC on mount and disconnects on unmount", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<VncPane vmId="vm-1" onFail={() => undefined} />);
    });
    expect(host.querySelector(".vnc-surface")).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(rfb.addEventListener).toHaveBeenCalled();
    act(() => {
      root!.unmount();
      root = undefined;
    });
    expect(rfb.disconnect).toHaveBeenCalled();
  });
});
