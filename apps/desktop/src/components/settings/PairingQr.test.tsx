import { describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { PairingQr } from "./PairingQr";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PairingQr", () => {
  it("renders an SVG QR for the pairing URL", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let root: Root | undefined;
    const url = "http://192.168.1.20:7420/?token=ph_abc";
    act(() => {
      root = createRoot(host);
      root.render(<PairingQr url={url} />);
    });
    const qr = host.querySelector("[data-testid='phone-qr']");
    expect(qr?.getAttribute("data-pairing-url")).toBe(url);
    expect(host.querySelector("svg")).toBeTruthy();
    expect(host.querySelector("[aria-label='Pairing QR code']")).toBeTruthy();
    act(() => root?.unmount());
    host.remove();
  });
});
