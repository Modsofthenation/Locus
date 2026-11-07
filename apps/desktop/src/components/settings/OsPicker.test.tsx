import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { OsPicker, OsSoloHint } from "./OsPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const templates = [
  { os: "ubuntu" as const, isoPath: "/iso/ubuntu.iso" },
  { os: "debian" as const, isoPath: "" },
  { os: "windows-11" as const, isoPath: "/iso/win.iso" },
];

describe("OsPicker", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  it("hides guests without an ISO and keeps the rest", () => {
    render(<OsPicker templates={templates} value="ubuntu" onChange={() => undefined} />);
    expect(host.textContent).toContain("Ubuntu 24.04");
    expect(host.textContent).toContain("Windows 11");
    expect(host.textContent).not.toContain("Debian 12");
    expect(host.textContent).not.toContain("Windows 10");
  });

  it("hides the picker when only one ISO is configured", () => {
    render(
      <>
        <OsPicker
          templates={templates.filter((t) => t.os === "ubuntu")}
          value="ubuntu"
          onChange={() => undefined}
        />
        <OsSoloHint templates={templates.filter((t) => t.os === "ubuntu")} os="ubuntu" />
      </>,
    );
    expect(host.querySelector(".os-grid")).toBeNull();
    expect(host.textContent).toBe("Using Ubuntu 24.04");
  });
});
