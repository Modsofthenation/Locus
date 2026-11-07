import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MASCOT_MAX_PX, Mascot } from "./Mascot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.PointerEvent !== "function") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");
const originalMatchMedia = window.matchMedia;

describe("Mascot", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  it("draws the idle viewfinder face and never exceeds 76px", () => {
    render(<Mascot pose="idle" size={200} />);
    const svg = host.querySelector("[data-testid='locus-mascot']");
    expect(svg?.getAttribute("data-pose")).toBe("idle");
    expect(svg?.getAttribute("width")).toBe(String(MASCOT_MAX_PX));
    expect(svg?.getAttribute("height")).toBe(String(MASCOT_MAX_PX));
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector(".mascot-frame path")).toBeTruthy();
    expect(
      host.querySelector(".mascot-body .mascot-gaze .pose-idle .mascot-eyes .mascot-eye"),
    ).toBeTruthy();
    expect(host.querySelector(".mascot-legs")).toBeTruthy();
    expect(svg?.hasAttribute("data-follow-cursor")).toBe(false);
    expect(host.querySelector(".mascot-pupil")).toBeNull();
  });

  it("switches to the thinking face with sparks", () => {
    render(<Mascot pose="think" title="Locus is thinking" />);
    const svg = host.querySelector("[data-testid='locus-mascot']");
    expect(svg?.getAttribute("data-pose")).toBe("think");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Locus is thinking");
    expect(host.querySelectorAll(".mascot-sparks .spark")).toHaveLength(3);
  });

  it("draws a frown and tear for the sad pose", () => {
    render(<Mascot pose="sad" title="Locus is sad" />);
    const svg = host.querySelector("[data-testid='locus-mascot']");
    expect(svg?.getAttribute("data-pose")).toBe("sad");
    expect(svg?.getAttribute("aria-label")).toBe("Locus is sad");
    expect(host.querySelector(".pose-sad .mascot-frown")).toBeTruthy();
    expect(host.querySelector(".pose-sad .mascot-frown")?.getAttribute("d")).toMatch(/c2\.2-4\.6/);
    expect(host.querySelector(".pose-sad .mascot-tear")).toBeTruthy();
    expect(css).toMatch(/\.mascot\[data-pose="sad"\][\s\S]*?pose-sad/);
    expect(css).toMatch(/\.mascot\[data-pose="sad"\][\s\S]*?mascot-sad-droop/);
    expect(css).toMatch(/\.mascot\[data-pose="sad"\][\s\S]*?mascot-tear/);
  });

  it("caps in-app size and stills motion when the user prefers it", () => {
    expect(css).toMatch(/\.mascot\s*\{[\s\S]*?max-width:\s*76px/);
    expect(css).toMatch(/\.mascot\[data-pose="idle"\][\s\S]*?mascot-blink/);
    expect(css).toMatch(/\.mascot\[data-pose="idle"\][\s\S]*?mascot-breathe/);
    expect(css).toMatch(/\.mascot\[data-pose="idle"\][\s\S]*?mascot-glance/);
    expect(css).toMatch(/\.mascot\[data-pose="think"\][\s\S]*?mascot-bob/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.mascot[\s\S]*?animation:\s*none/,
    );
    expect(css).toMatch(
      /\.mascot\[data-follow-cursor="true"\]\[data-pose="idle"\][\s\S]*?mascot-gaze[\s\S]*?animation:\s*none/,
    );
    expect(css).toMatch(
      /\.mascot\[data-follow-cursor="true"\][\s\S]*?mascot-pupil[\s\S]*?--mascot-look-x/,
    );
  });

  it("looks toward the pointer when followCursor is on", () => {
    render(<Mascot pose="idle" followCursor />);
    const svg = host.querySelector("[data-testid='locus-mascot']") as SVGSVGElement;
    expect(svg.getAttribute("data-follow-cursor")).toBe("true");
    expect(host.querySelectorAll(".mascot-eye-white")).toHaveLength(2);
    expect(host.querySelectorAll(".mascot-pupil")).toHaveLength(2);
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 80,
      left: 100,
      top: 80,
      width: 76,
      height: 76,
      right: 176,
      bottom: 156,
      toJSON() {
        return {};
      },
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 40, pointerId: 1 }),
      );
    });
    expect(parseFloat(svg.style.getPropertyValue("--mascot-look-x"))).toBeGreaterThan(0);
    expect(parseFloat(svg.style.getPropertyValue("--mascot-look-y"))).toBeLessThan(0);
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 40, clientY: 200, pointerId: 1 }),
      );
    });
    expect(parseFloat(svg.style.getPropertyValue("--mascot-look-x"))).toBeLessThan(0);
    expect(parseFloat(svg.style.getPropertyValue("--mascot-look-y"))).toBeGreaterThan(0);
  });

  it("does not follow the pointer when the user prefers reduced motion", () => {
    const media = {
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } satisfies MediaQueryList;
    window.matchMedia = (query: string) =>
      query.includes("prefers-reduced-motion") ? media : { ...media, matches: false };
    render(<Mascot pose="idle" followCursor />);
    const svg = host.querySelector("[data-testid='locus-mascot']") as SVGSVGElement;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 80,
      left: 100,
      top: 80,
      width: 76,
      height: 76,
      right: 176,
      bottom: 156,
      toJSON() {
        return {};
      },
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 40, pointerId: 1 }),
      );
    });
    expect(svg.style.getPropertyValue("--mascot-look-x")).toBe("");
    expect(svg.style.getPropertyValue("--mascot-look-y")).toBe("");
  });
});
