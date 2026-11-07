import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE_PRESETS, type AgentSession } from "@locus/shared";
import { DesignThumb, designThumbFit, designThumbSrcDoc, designThumbViewport } from "./DesignThumb";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

const session: AgentSession = {
  id: "d1",
  title: "Landing page",
  kind: "design",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  runtime: "docker",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  vmId: "v1",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("DesignThumb", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    const current = root;
    if (current) act(() => current.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(node);
    });
  }

  it("builds a guarded canvas document with kit assets and palette vars", () => {
    const html = designThumbSrcDoc("<html><body><h1>Hero</h1></body></html>", session, []);
    expect(html).toContain("Hero");
    expect(html).toContain("data-locus-preview-guard");
    expect(html).toContain("data-locus-palette");
    expect(html).toContain('<base href="/api/sessions/d1/canvas-files/">');
    expect(html).not.toContain("data-locus-pick-hook");
    expect(html).toContain("data-locus-thumb-clip");
    expect(html).toMatch(/html,\s*body\s*\{[\s\S]*?overflow:\s*hidden\s*!important/);
    expect(html).toContain("::-webkit-scrollbar");
  });

  it("uses a phone viewport for mobile canvases", () => {
    expect(designThumbViewport(session)).toEqual({ width: 1280, height: 800 });
    expect(designThumbViewport({ ...session, title: "Mobile screen" })).toEqual({
      width: 390,
      height: 844,
    });
  });

  it("scales the full canvas viewport into the thumb instead of cropping a corner", () => {
    const desktop = designThumbFit({ width: 1280, height: 800 });
    expect(desktop.scale).toBeCloseTo(88 / 1280);
    expect(desktop.x).toBeCloseTo(0);
    expect(desktop.y).toBeCloseTo(0);
    expect(desktop.scale * 1280).toBeCloseTo(88);
    expect(desktop.scale * 800).toBeCloseTo(55);
    const phone = designThumbFit({ width: 390, height: 844 });
    expect(phone.scale * 844).toBeCloseTo(55);
    expect(phone.scale * 390).toBeLessThan(88);
    expect(phone.x).toBeGreaterThan(0);
  });

  it("shows a placeholder when the canvas is empty", () => {
    render(<DesignThumb session={session} systems={[]} />);
    expect(host!.querySelector(".design-thumb.is-empty")).toBeTruthy();
    expect(host!.querySelector("iframe")).toBeNull();
  });

  it("prefers a playtest shot over the live iframe", () => {
    render(
      <DesignThumb
        session={{ ...session, kind: "game" }}
        html="<html><body><canvas></canvas></body></html>"
        systems={[]}
        shot="aaaa"
      />,
    );
    expect(host!.querySelector(".design-thumb iframe")).toBeNull();
    expect(host!.querySelector(".design-thumb-shot")?.getAttribute("src")).toBe(
      "data:image/png;base64,aaaa",
    );
  });

  it("shows a sandboxed preview iframe for a painted canvas", () => {
    render(
      <DesignThumb session={session} html="<html><body><h1>Hero</h1></body></html>" systems={[]} />,
    );
    const frame = host!.querySelector(".design-thumb iframe") as HTMLIFrameElement | null;
    expect(host!.querySelector(".design-thumb.is-empty")).toBeNull();
    expect(host!.querySelector(".design-thumb")?.getAttribute("data-viewport")).toBe("desktop");
    expect(frame?.srcdoc).toContain("Hero");
    expect(frame?.style.width).toBe("1280px");
    expect(frame?.style.height).toBe("800px");
    expect(Number(frame?.style.zoom)).toBeCloseTo(88 / 1280);
    expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame?.getAttribute("scrolling")).toBe("no");
    expect(frame?.getAttribute("aria-hidden")).toBe("true");
    expect(frame?.tabIndex).toBe(-1);
    expect(
      (host!.querySelector(".design-thumb") as HTMLElement).style.getPropertyValue(
        "--canvas-page-bg",
      ),
    ).toBe("#111114");
  });

  it("does not paint sidebar thumbs on a hardcoded white iframe", () => {
    expect(css).toMatch(/\.design-thumb iframe \{[\s\S]*?background:\s*var\(--canvas-page-bg/);
    expect(css).not.toMatch(/\.design-thumb iframe \{[^}]*background:\s*#fff/);
  });

  function pendingFrame(): HTMLIFrameElement {
    return host!.querySelector("iframe.is-pending") as HTMLIFrameElement;
  }

  function attachCanvasSeq(iframe: HTMLIFrameElement): number {
    const html = iframe.srcdoc;
    const match = html.match(/data-locus-canvas-seq="(\d+)"/);
    const seq = match ? Number(match[1]) : NaN;
    const doc = document.implementation.createHTMLDocument();
    const script = doc.createElement("script");
    script.setAttribute("data-locus-preview-guard", "");
    if (Number.isFinite(seq)) script.setAttribute("data-locus-canvas-seq", String(seq));
    doc.head.appendChild(script);
    Object.defineProperty(iframe, "contentDocument", { configurable: true, value: doc });
    return seq;
  }

  async function flushPaint(): Promise<void> {
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  it("promotes the pending thumb iframe in place so a restyle does not remount white", async () => {
    render(
      <DesignThumb session={session} html="<html><body><h1>Hero</h1></body></html>" systems={[]} />,
    );
    const first = pendingFrame();
    expect(first.classList.contains("is-solo")).toBe(true);
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(host!.querySelector("iframe.is-front")).toBe(first);

    act(() => {
      root!.render(
        <DesignThumb
          session={session}
          html="<html><body><h1>Hero</h1><p>Updated</p></body></html>"
          systems={[]}
        />,
      );
    });
    expect(host!.querySelector("iframe.is-front")).toBe(first);
    const pending = pendingFrame();
    expect(pending).toBeTruthy();
    expect(pending).not.toBe(first);
    expect(pending.srcdoc).toContain("Updated");
    attachCanvasSeq(pending);
    await act(async () => {
      pending.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(host!.querySelector("iframe.is-front")).toBe(pending);
    expect(pending.classList.contains("is-front")).toBe(true);
    expect(first.classList.contains("is-idle")).toBe(true);
  });

  it("keeps the solo thumb on screen when html updates before the first load", () => {
    render(
      <DesignThumb session={session} html="<html><body><h1>Hero</h1></body></html>" systems={[]} />,
    );
    const first = pendingFrame();
    act(() => {
      root!.render(
        <DesignThumb
          session={session}
          html="<html><body><h1>Hero</h1><p>Updated</p></body></html>"
          systems={[]}
        />,
      );
    });
    expect(host!.querySelector("iframe.is-front")).toBe(first);
    const pending = pendingFrame();
    expect(pending).not.toBe(first);
    expect(pending.srcdoc).toContain("Updated");
    expect(first.srcdoc).toContain("Hero");
    expect(pending.classList.contains("is-solo")).toBe(false);
  });

  it("keeps the painted thumb while a new palette loads behind it", async () => {
    const paper = PALETTE_PRESETS.find((preset) => preset.id === "paper")!.colors;
    render(
      <DesignThumb session={session} html="<html><body><h1>Hero</h1></body></html>" systems={[]} />,
    );
    const first = pendingFrame();
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    act(() => {
      root!.render(
        <DesignThumb
          session={{ ...session, palette: paper }}
          html="<html><body><h1>Hero</h1></body></html>"
          systems={[]}
        />,
      );
    });
    expect(host!.querySelector("iframe.is-front")).toBe(first);
    const pending = pendingFrame();
    expect(pending.srcdoc).toContain(`--primary: ${paper.primary}`);
    expect(pending.classList.contains("is-solo")).toBe(false);
    attachCanvasSeq(pending);
    await act(async () => {
      pending.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(host!.querySelector("iframe.is-front")).toBe(pending);
    expect(
      (host!.querySelector(".design-thumb") as HTMLElement).style.getPropertyValue(
        "--canvas-page-bg",
      ),
    ).toBe(paper.bg);
  });
});
