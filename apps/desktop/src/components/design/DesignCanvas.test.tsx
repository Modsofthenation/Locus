import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DESIGN_TYPOGRAPHY,
  GAME_BALANCE_RUNS,
  GAME_RECORD_MS,
  PALETTE_PRESETS,
  type AgentSession,
  type DesignSystem,
  type VmInstance,
} from "@locus/shared";
import { CANVAS_READY_FALLBACK_MS, DesignCanvas, isCanvasHostHidden } from "./DesignCanvas";
import { canvasFrameDoc } from "@/lib/canvasFrame";
import { api } from "@/lib/api";
import { Store, initialState, type Action, type UiState } from "@/state/store";
import { selectOptionLabels, selectValue, setSelectValue } from "@/lib/selectControl";

vi.mock("@/lib/api", () => ({
  api: {
    canvas: vi.fn(),
    patchSession: vi.fn(),
    designComment: vi.fn(),
    promote: vi.fn(),
    createDesignVariant: vi.fn(),
    activateDesignVariant: vi.fn(),
    renameDesignVariant: vi.fn(),
    deleteDesignVariant: vi.fn(),
    exploreDesignDirections: vi.fn(),
    exportGameZip: vi.fn(),
    saveHostFile: vi.fn(),
    ingestAssetPack: vi.fn().mockResolvedValue(null),
    browseHost: vi.fn(),
    editCanvasText: vi.fn(),
    chat: vi.fn(),
    execTool: vi.fn(),
    workspaceFile: vi.fn().mockRejectedValue(new Error("missing")),
    saveWorkspaceFile: vi.fn(),
    saveAssetStyleFromSession: vi.fn(),
    saveGameStyleFromSession: vi.fn(),
    assetStyles: vi.fn(),
    gameStyles: vi.fn(),
    playLink: vi.fn(),
    generateGameAsset: vi.fn(),
    session: vi.fn(),
    previewHttpUrl: (id: string, port: number, path = "/") =>
      `/api/sessions/${id}/preview-http/${port}${path}`,
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

const session: AgentSession = {
  id: "d1",
  title: "Landing page",
  kind: "design",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  runtime: "docker",
  dockerImage: "ubuntu:24.04",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  vmId: "v1",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

const vm: VmInstance = {
  id: "v1",
  sessionId: "d1",
  templateId: "ubuntu-24.04",
  os: "ubuntu",
  name: "Design",
  status: "ready",
  runtime: "docker",
  diskPath: "/tmp/ws",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("canvas host visibility", () => {
  it("treats opacity-0 ancestors as a hidden canvas host", () => {
    const wrap = document.createElement("div");
    wrap.style.opacity = "0";
    const inner = document.createElement("div");
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    try {
      expect(isCanvasHostHidden(inner)).toBe(true);
      wrap.style.opacity = "1";
      expect(isCanvasHostHidden(inner)).toBe(false);
    } finally {
      wrap.remove();
    }
  });

  it("shows a solo pending iframe instead of leaving the stage white", () => {
    expect(css).toMatch(/\.design-frame-pages iframe\.is-pending\.is-solo \{[\s\S]*?opacity:\s*1/);
    expect(css).not.toMatch(/\.design-frame-pages iframe\.is-pending \{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.design-frame-pages \{[\s\S]*?background:\s*var\(--canvas-page-bg/);
    expect(css).not.toMatch(/\.design-frame iframe \{[^}]*background:\s*#fff/);
    expect(css).not.toMatch(/\.design-frame-pages iframe\.is-ready \{[^}]*z-index:\s*2/);
    expect(css).toMatch(/\.design-stage\.is-asset \{[\s\S]*?padding:\s*0/);
    expect(css).toMatch(
      /\.design-stage\.is-asset \.design-frame \{[\s\S]*?width:\s*100%\s*!important/,
    );
  });

  it("keeps the canvas toolbar on one row and parks Comment / Edit / Tune in the overflow on a narrow pane", () => {
    expect(css).toMatch(/\.design-pane \{[\s\S]*?container-type:\s*inline-size/);
    expect(css).toMatch(/\.design-pane \{[\s\S]*?container-name:\s*design-pane/);
    expect(css).toMatch(/\.design-toolbar-group \{[\s\S]*?display:\s*inline-flex/);
    expect(css).toMatch(/\.design-toolbar-overflow-modes \{[\s\S]*?display:\s*none/);
    expect(css).toMatch(
      /@container design-pane \(max-width: 900px\) \{[\s\S]*?\.vm-status-copy \{[\s\S]*?display:\s*none/,
    );
    expect(css).toMatch(
      /@container design-pane \(max-width: 760px\) \{[\s\S]*?\.design-toolbar-mode \{[\s\S]*?display:\s*none/,
    );
    expect(css).toMatch(
      /@container design-pane \(max-width: 760px\) \{[\s\S]*?\.design-toolbar-overflow-modes \{[\s\S]*?display:\s*contents/,
    );
    expect(css).toMatch(/\.design-pane \.vm-toolbar \{[\s\S]*?flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.design-pane \.vm-toolbar-actions \{[\s\S]*?flex-wrap:\s*wrap/);
    expect(css).toMatch(
      /@container design-pane \(max-width: 560px\) \{[\s\S]*?\.design-system-picker \{[\s\S]*?display:\s*none/,
    );
  });
});

describe("DesignCanvas", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.mocked(api.designComment).mockReset();
    vi.mocked(api.promote).mockReset();
    vi.mocked(api.createDesignVariant).mockReset();
    vi.mocked(api.activateDesignVariant).mockReset();
    vi.mocked(api.editCanvasText).mockReset();
    vi.mocked(api.exploreDesignDirections).mockReset();
    vi.mocked(api.exportGameZip).mockReset();
    vi.mocked(api.saveHostFile).mockReset();
    vi.mocked(api.ingestAssetPack).mockReset();
    vi.mocked(api.browseHost).mockReset();
    vi.mocked(api.patchSession).mockReset();
    vi.mocked(api.chat).mockReset();
    vi.mocked(api.execTool).mockReset();
    vi.mocked(api.workspaceFile).mockReset();
    vi.mocked(api.workspaceFile).mockRejectedValue(new Error("missing"));
    vi.mocked(api.saveWorkspaceFile).mockReset();
    vi.mocked(api.saveAssetStyleFromSession).mockReset();
    vi.mocked(api.saveGameStyleFromSession).mockReset();
    vi.mocked(api.assetStyles).mockReset();
    vi.mocked(api.gameStyles).mockReset();
    vi.mocked(api.playLink).mockReset();
    vi.mocked(api.generateGameAsset).mockReset();
    vi.mocked(api.session).mockReset();
    window.localStorage.removeItem("locus.assetExportDir");
  });

  function render(state: UiState, dispatch: (action: Action) => void = () => undefined) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider value={{ state: { ...state, vmCollapsed: false }, dispatch }}>
        <DesignCanvas />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  function canvasIframe(): HTMLIFrameElement | null {
    return (
      (host.querySelector(
        'iframe[title="Design canvas"].is-pending',
      ) as HTMLIFrameElement | null) ??
      (host.querySelector('iframe[title="Design canvas"].is-front') as HTMLIFrameElement | null) ??
      (host.querySelector('iframe[title="Design canvas"]') as HTMLIFrameElement | null)
    );
  }

  function latestCanvasDoc(): string {
    return canvasFrameDoc(canvasIframe());
  }

  it("renders a live canvas iframe and comments on a clicked element", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.designComment).mockResolvedValue(session);
    const actions: Action[] = [];
    render(
      {
        ...initialState,
        section: "design",
        selectedId: session.id,
        sessions: [session],
        vms: [vm],
      },
      (action) => actions.push(action),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("iframe")?.getAttribute("title")).toBe("Design canvas");
    expect(host.querySelector("iframe")?.getAttribute("src")).toBe("/api/canvas-frame");
    expect(host.querySelector("iframe")?.getAttribute("sandbox")).toBe(
      "allow-scripts allow-forms allow-modals allow-pointer-lock",
    );
    expect(host.querySelector("iframe")?.getAttribute("sandbox")).not.toContain(
      "allow-same-origin",
    );
    expect(
      (host.querySelector(".design-frame") as HTMLElement).style.getPropertyValue(
        "--canvas-page-bg",
      ),
    ).toBe("#111114");
    expect(canvasFrameDoc(host.querySelector("iframe") as HTMLIFrameElement)).toContain(
      "data-locus-preview-guard",
    );
    expect(canvasFrameDoc(host.querySelector("iframe") as HTMLIFrameElement)).toContain(
      "data-locus-palette",
    );
    expect(canvasFrameDoc(host.querySelector("iframe") as HTMLIFrameElement)).toContain(
      '<base href="/api/sessions/d1/canvas-files/">',
    );
    expect(host.querySelector(".palette-swatch-row")).toBeTruthy();
    expect(host.querySelector(".design-frame")?.getAttribute("data-viewport")).toBe("desktop");
    const comment = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Comment",
    );
    act(() => {
      comment!.click();
    });
    const frame = host.querySelector("iframe") as HTMLIFrameElement;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "locus-design-pick", tag: "h1", text: "Hello", id: "", className: "hero" },
          source: frame.contentWindow,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.designComment).toHaveBeenCalledWith("d1", {
      selector: "h1.hero",
      text: "Hello",
      viewport: "desktop",
    });
    expect(
      actions.some((action) => action.type === "compose" && action.text === "On h1.hero: "),
    ).toBe(true);
    expect(actions.some((action) => action.type === "session" && action.session.id === "d1")).toBe(
      true,
    );
    expect(comment!.getAttribute("aria-pressed")).toBe("false");
    expect(host.textContent).toContain("Desktop");
    expect(host.textContent).toContain("Export HTML");
    expect(host.querySelector(".vm-toolbar-actions > .variant-row")).toBeNull();
    expect(host.querySelector(".vm-toolbar-actions > .promote-scaffold")).toBeNull();
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Manage")).toBe(
      false,
    );
    expect(host.querySelector('.vm-toolbar-actions [title="Canvas actions"]')).toBeTruthy();
    expect(host.querySelector(".design-toolbar-group")?.getAttribute("aria-label")).toBe(
      "Appearance",
    );
    expect(
      [...host.querySelectorAll(".design-toolbar-overflow-modes .menu-item")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["Comment", "Edit text", "Inspect", "Undo", "Redo", "Tune"]);
    expect(
      host
        .querySelector('.vm-toolbar-actions [aria-label="Viewport"]')
        ?.classList.contains("control-cluster"),
    ).toBe(true);
    const tablet = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Tablet");
    act(() => {
      tablet!.click();
    });
    expect(host.querySelector(".design-frame")?.getAttribute("data-viewport")).toBe("tablet");
  });

  it("loads vendored ES modules from the canvas-files origin instead of srcdoc", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: `<!DOCTYPE html><html><head></head><body><canvas id="view"></canvas>
<script type="module">import * as THREE from './vendor/three.module.js';</script>
</body></html>`,
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const frame = host.querySelector("iframe") as HTMLIFrameElement | null;
    expect(frame?.getAttribute("src")).toMatch(/\/api\/sessions\/d1\/canvas-files\/\?c=\d+/);
    expect(frame?.getAttribute("src")).toMatch(/^http:\/\/locus-canvas\.localhost:\d+\//);
    expect(frame?.getAttribute("data-canvas-http")).toBe("1");
    expect(frame?.getAttribute("data-srcdoc")).toBeNull();
    expect(frame?.getAttribute("sandbox")).toContain("allow-same-origin");
    expect(frame?.getAttribute("sandbox")).toContain("allow-forms");
  });

  it("loads relative photos from the canvas-files origin so getImageData is not tainted", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: `<!DOCTYPE html><html><body>
<canvas id="view"></canvas>
<script>
  const SRC = "./source.png";
  const img = new Image();
  img.src = SRC;
  off.getContext("2d").getImageData(0, 0, 8, 8);
</script>
</body></html>`,
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    render({
      ...initialState,
      section: "assets",
      selectedId: session.id,
      sessions: [{ ...session, kind: "assets" }],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const frame = host.querySelector('iframe[title="Design canvas"]') as HTMLIFrameElement | null;
    expect(frame?.getAttribute("src")).toMatch(/\/api\/sessions\/d1\/canvas-files\/\?c=\d+/);
    expect(frame?.getAttribute("src")).toMatch(/^http:\/\/locus-canvas\.localhost:\d+\//);
    expect(frame?.getAttribute("data-canvas-http")).toBe("1");
    expect(frame?.getAttribute("data-srcdoc")).toBeNull();
    expect(frame?.getAttribute("sandbox")).toContain("allow-same-origin");
  });

  it("toggles comment mode from the overflow copy used on a narrow pane", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const overflowComment = [
      ...host.querySelectorAll(".design-toolbar-overflow-modes .menu-item"),
    ].find((btn) => btn.textContent === "Comment") as HTMLButtonElement;
    expect(overflowComment).toBeTruthy();
    act(() => {
      overflowComment.click();
    });
    expect(overflowComment.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector(".design-stage")?.classList.contains("commenting")).toBe(true);
  });

  it("offers phone models instead of Desktop / Tablet / Phone on a mobile canvas", async () => {
    const mobile: AgentSession = { ...session, title: "Mobile screen" };
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Items</h1></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.designComment).mockResolvedValue(mobile);
    render({
      ...initialState,
      section: "design",
      selectedId: mobile.id,
      sessions: [mobile],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[aria-label="Viewport"]')).toBeNull();
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Desktop")).toBe(
      false,
    );
    const picker = host.querySelector('[aria-label="Phone model"]');
    expect(picker).toBeTruthy();
    expect(selectValue(host, "Phone model")).toBe("iphone-15");
    expect(selectOptionLabels(host, "Phone model")).toEqual([
      "iPhone SE",
      "iPhone 15",
      "iPhone 16 Pro Max",
      "Pixel 8",
      "Galaxy S24",
    ]);
    expect(host.querySelector(".design-frame")?.getAttribute("data-viewport")).toBe("phone");
    expect(host.querySelector(".design-frame")?.getAttribute("data-phone")).toBe("iphone-15");
    expect((host.querySelector(".design-frame") as HTMLElement).style.width).toBe("390px");
    expect((host.querySelector(".design-frame") as HTMLElement).style.height).toBe("844px");
    expect(host.querySelector(".design-frame-caption")?.textContent).toBe("iPhone 15 · 390 × 844");
    act(() => {
      setSelectValue(host, "Phone model", "pixel-8");
    });
    expect(host.querySelector(".design-frame")?.getAttribute("data-phone")).toBe("pixel-8");
    expect((host.querySelector(".design-frame") as HTMLElement).style.width).toBe("412px");
    expect((host.querySelector(".design-frame") as HTMLElement).style.height).toBe("915px");
    expect(host.querySelector(".design-frame-caption")?.textContent).toBe("Pixel 8 · 412 × 915");
    const comment = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Comment",
    );
    act(() => {
      comment!.click();
    });
    const frame = host.querySelector("iframe") as HTMLIFrameElement;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "locus-design-pick", tag: "h1", text: "Items", id: "", className: "" },
          source: frame.contentWindow,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.designComment).toHaveBeenCalledWith("d1", {
      selector: "h1",
      text: "Items",
      viewport: "phone",
    });
  });

  it("stays in comment mode if the pin fails", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.designComment).mockRejectedValue(new Error("offline"));
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const comment = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Comment",
    );
    act(() => {
      comment!.click();
    });
    expect(comment!.getAttribute("aria-pressed")).toBe("true");
    const frame = host.querySelector("iframe") as HTMLIFrameElement;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "locus-design-pick", tag: "h1", text: "Hello", id: "", className: "hero" },
          source: frame.contentWindow,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.designComment).toHaveBeenCalled();
    expect(comment!.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the previous canvas visible until the next design is ready", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body>First</body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("iframe")).toBeTruthy();
    expect(canvasFrameDoc(host.querySelector("iframe") as HTMLIFrameElement)).toContain("First");
    expect(swapOverlay()).toBeNull();
    vi.mocked(api.canvas).mockImplementation(() => new Promise(() => undefined));
    const other: AgentSession = { ...session, id: "d2", title: "Dashboard", vmId: "v2" };
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: other.id,
              sessions: [session, other],
              vms: [vm],
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    expect(host.querySelector("iframe")).toBeTruthy();
    expect(canvasFrameDoc(host.querySelector("iframe") as HTMLIFrameElement)).toContain("First");
    expect(host.querySelector(".design-empty")).toBeNull();
    expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);
    expect(host.querySelector(".design-stage")?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector(".vm-status-copy .meta")?.textContent).toMatch(/loading/i);
  });

  it("swaps to a cached design without clearing the canvas", async () => {
    const other: AgentSession = { ...session, id: "d2", title: "Dashboard", vmId: "v2" };
    vi.mocked(api.canvas).mockImplementation(async (id: string) => ({
      html: id === "d2" ? "<html><body>Dashboard</body></html>" : "<html><body>First</body></html>",
      path: "/workspace/index.html",
    }));
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session, other],
      vms: [vm],
      canvasHtml: {
        d1: "<html><body>First</body></html>",
        d2: "<html><body>Dashboard</body></html>",
      },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      [...host.querySelectorAll("iframe")].some((el) =>
        canvasFrameDoc(el as HTMLIFrameElement).includes("First"),
      ),
    ).toBe(true);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: other.id,
              sessions: [session, other],
              vms: [vm],
              canvasHtml: {
                d1: "<html><body>First</body></html>",
                d2: "<html><body>Dashboard</body></html>",
              },
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    const docs = [...host.querySelectorAll("iframe")].map((el) =>
      canvasFrameDoc(el as HTMLIFrameElement),
    );
    expect(docs.some((doc) => doc.includes("Dashboard"))).toBe(true);
    expect(host.querySelector(".design-empty")).toBeNull();
    expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);
  });

  it("paints a cached design after swapping sessions without collapsing the pane", async () => {
    const other: AgentSession = { ...session, id: "d2", title: "Dashboard", vmId: "v2" };
    vi.mocked(api.canvas).mockImplementation(async (id: string) => ({
      html: id === "d2" ? "<html><body>Dashboard</body></html>" : "<html><body>First</body></html>",
      path: "/workspace/index.html",
    }));
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session, other],
      vms: [vm],
      canvasHtml: {
        d1: "<html><body>First</body></html>",
        d2: "<html><body>Dashboard</body></html>",
      },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = pendingFrame();
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(
      canvasFrameDoc(host.querySelector("iframe.is-front") as HTMLIFrameElement | null),
    ).toContain("First");

    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: other.id,
              sessions: [session, other],
              vms: [vm],
              canvasHtml: {
                d1: "<html><body>First</body></html>",
                d2: "<html><body>Dashboard</body></html>",
              },
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    expect(
      canvasFrameDoc(host.querySelector("iframe.is-front") as HTMLIFrameElement | null),
    ).toContain("First");
    expect(
      canvasFrameDoc(host.querySelector("iframe.is-pending") as HTMLIFrameElement | null),
    ).toContain("Dashboard");
    expect(
      (host.querySelector("iframe.is-pending") as HTMLIFrameElement | null)?.classList.contains(
        "is-solo",
      ),
    ).toBe(false);
    expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);
    const next = pendingFrame();
    attachCanvasSeq(next);
    await act(async () => {
      next.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(host.querySelector("iframe.is-front")).toBe(next);
    expect(
      canvasFrameDoc(host.querySelector("iframe.is-front") as HTMLIFrameElement | null),
    ).toContain("Dashboard");
    expect(host.querySelector("iframe.is-pending")).toBeNull();
    expect(host.querySelector(".design-empty")).toBeNull();
    expect(swapOverlay()).toBeNull();
    expect(host.querySelector(".design-stage")?.getAttribute("aria-busy")).toBe("false");
  });

  it("promotes the pending iframe in place so a restyle does not remount a white page", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
    });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = pendingFrame();
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(host.querySelector("iframe.is-front")).toBe(first);

    act(() => {
      (host.querySelector(".palette-swatch-row") as HTMLButtonElement).click();
    });
    const paperBtn = [...host.querySelectorAll(".palette-pop button")].find((btn) =>
      btn.textContent?.includes("Paper"),
    ) as HTMLButtonElement | undefined;
    act(() => {
      paperBtn!.click();
    });
    expect(host.querySelector("iframe.is-front")).toBe(first);
    const pending = pendingFrame();
    expect(pending).toBeTruthy();
    expect(pending).not.toBe(first);
    attachCanvasSeq(pending);
    await act(async () => {
      pending.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(host.querySelector("iframe.is-front")).toBe(pending);
    expect(pending.classList.contains("is-front")).toBe(true);
    expect(first.classList.contains("is-idle")).toBe(true);
    expect(latestCanvasDoc()).toContain("--primary:");
  });

  it("hides the swap loader when the next design has no canvas yet", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body>First</body></html>",
      path: "/workspace/index.html",
    });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.mocked(api.canvas).mockResolvedValue({ html: null, path: "/workspace/index.html" });
    const other: AgentSession = { ...session, id: "d2", title: "Dashboard", vmId: "v2" };
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: other.id,
              sessions: [session, other],
              vms: [vm],
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(swapOverlay()).toBeNull();
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector(".design-empty")).toBeTruthy();
    expect(host.querySelector(".design-stage")?.getAttribute("aria-busy")).toBe("false");
  });

  it("shows an empty canvas until index.html exists", async () => {
    vi.mocked(api.canvas).mockResolvedValue({ html: null, path: "/workspace/index.html" });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/index\.html/);
    expect(host.querySelector("iframe")).toBeNull();
    expect(swapOverlay()).toBeNull();
  });

  it("says the agent is working while a draft is still empty", async () => {
    vi.mocked(api.canvas).mockResolvedValue({ html: null, path: "/workspace/index.html" });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [{ ...session, status: "running" }],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".vm-status-copy .meta")?.textContent).toMatch(/agent working/i);
    expect(host.querySelector("[data-testid='design-working']")?.textContent).toMatch(
      /Agent is working/,
    );
    expect(host.textContent).toMatch(/The agent is working/);
    expect(host.querySelector(".dot.running")).toBeTruthy();
    expect(host.querySelector(".design-pane")?.classList.contains("is-working")).toBe(true);
    expect(host.querySelector(".design-stage")?.getAttribute("aria-busy")).toBe("true");
  });

  it("does not look idle while the container is starting and the canvas is empty", async () => {
    vi.mocked(api.canvas).mockResolvedValue({ html: null, path: "/workspace/index.html" });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Put together a visual webpage",
              createdAt: session.createdAt,
            },
            {
              id: "s1",
              role: "system",
              content: "Starting the container.",
              createdAt: session.createdAt,
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "running" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".vm-status-copy .meta")?.textContent).toMatch(/starting container/i);
    expect(host.querySelector(".vm-status-copy .meta")?.textContent).not.toMatch(
      /waiting for a draft/i,
    );
    expect(host.querySelector(".vm-status-copy .meta")?.textContent).not.toMatch(/agent working/i);
    expect(host.querySelector("[data-testid='design-working']")?.textContent).toMatch(
      /Starting the container/,
    );
    expect(host.querySelector("[data-testid='design-working']")?.textContent).not.toMatch(
      /Agent is working/,
    );
    expect(host.textContent).not.toMatch(/Describe a prototype/);
    expect(host.querySelector(".design-pane")?.classList.contains("is-working")).toBe(true);
    expect(host.querySelector(".design-empty")?.classList.contains("is-working")).toBe(true);
    expect(host.querySelector(".design-swap-spinner")).toBeTruthy();
  });

  it("says starting container while the guest is still booting", async () => {
    vi.mocked(api.canvas).mockResolvedValue({ html: null, path: "/workspace/index.html" });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [{ ...session, status: "provisioning", vmId: "v1", messages: [] }],
      vms: [{ ...vm, status: "booting" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".vm-status-copy .meta")?.textContent).toMatch(/starting container/i);
    expect(host.querySelector("[data-testid='design-working']")?.textContent).toMatch(
      /Starting the container/,
    );
    expect(host.textContent).not.toMatch(/Describe a prototype/);
  });

  it("shows an image-build card instead of agent-working while the image is building", async () => {
    vi.mocked(api.canvas).mockResolvedValue({ html: null, path: "/workspace/index.html" });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      imageProgress: {
        [session.id]: { percent: 30, phase: "RUN apt-get update", step: 2, total: 6 },
      },
      sessions: [{ ...session, status: "running" }],
      vms: [{ ...vm, status: "booting" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".vm-status-copy .meta")?.textContent).toMatch(/building image/i);
    expect(host.querySelector("[data-testid='design-working']")?.textContent).toMatch(
      /Building image/,
    );
    const card = host.querySelector("[data-testid=image-build-progress]");
    expect(card?.textContent).toContain("30%");
    expect(card?.textContent).toContain("RUN apt-get update");
    expect(host.textContent).toMatch(/First start builds the agent image/);
    expect(host.textContent).not.toMatch(/The agent is working/);
  });

  it("paints streamed canvas html before the file lands on disk", async () => {
    vi.mocked(api.canvas).mockResolvedValue({ html: null, path: "/workspace/index.html" });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [{ ...session, status: "running" }],
      vms: [vm],
      canvasHtml: { d1: "<html><body><h1>Draft deck</h1></body></html>" },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("iframe")).toBeTruthy();
    expect(canvasFrameDoc(host.querySelector("iframe") as HTMLIFrameElement)).toContain(
      "Draft deck",
    );
    expect(host.querySelector(".vm-status-copy .meta")?.textContent).toMatch(/updating canvas/i);
    expect(host.querySelector("[data-testid='design-working']")?.textContent).toMatch(
      /Updating canvas/,
    );
  });

  it("keeps streamed canvas html if a poll fails", async () => {
    vi.mocked(api.canvas).mockRejectedValue(new Error("canvas offline"));
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [{ ...session, status: "running" }],
      vms: [vm],
      canvasHtml: { d1: "<html><body><h1>Draft deck</h1></body></html>" },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("iframe")).toBeTruthy();
    expect(canvasFrameDoc(host.querySelector("iframe") as HTMLIFrameElement)).toContain(
      "Draft deck",
    );
  });

  it("paints the latest palette even if an earlier save finishes last", async () => {
    const paper = PALETTE_PRESETS.find((preset) => preset.id === "paper")!.colors;
    const ocean = PALETTE_PRESETS.find((preset) => preset.id === "ocean")!.colors;
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    const deferred = new Map<string, { resolve: (next: AgentSession) => void }>();
    vi.mocked(api.patchSession).mockImplementation(
      (_id, patch) =>
        new Promise((resolve) => {
          deferred.set(patch.palette!.primary, { resolve });
        }),
    );
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      (host.querySelector(".palette-swatch-row") as HTMLButtonElement).click();
    });
    const paperBtn = [...host.querySelectorAll(".palette-pop button")].find((btn) =>
      btn.textContent?.includes("Paper"),
    ) as HTMLButtonElement | undefined;
    const oceanBtn = [...host.querySelectorAll(".palette-pop button")].find((btn) =>
      btn.textContent?.includes("Ocean"),
    ) as HTMLButtonElement | undefined;
    act(() => {
      paperBtn!.click();
      oceanBtn!.click();
    });
    expect(latestCanvasDoc()).toContain(`--primary: ${ocean.primary}`);
    await act(async () => {
      await Promise.resolve();
    });
    expect(deferred.has(paper.primary)).toBe(true);
    await act(async () => {
      deferred.get(paper.primary)!.resolve({ ...session, palette: paper });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latestCanvasDoc()).toContain(`--primary: ${ocean.primary}`);
    expect(deferred.has(ocean.primary)).toBe(true);
    await act(async () => {
      deferred.get(ocean.primary)!.resolve({ ...session, palette: ocean });
      await Promise.resolve();
    });
    expect(latestCanvasDoc()).toContain(`--primary: ${ocean.primary}`);
  });

  it("still applies a new session palette after an in-flight save from the previous session", async () => {
    const paper = PALETTE_PRESETS.find((preset) => preset.id === "paper")!.colors;
    const ocean = PALETTE_PRESETS.find((preset) => preset.id === "ocean")!.colors;
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    let resolvePatch: ((next: AgentSession) => void) | undefined;
    vi.mocked(api.patchSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      (host.querySelector(".palette-swatch-row") as HTMLButtonElement).click();
    });
    const paperBtn = [...host.querySelectorAll(".palette-pop button")].find((btn) =>
      btn.textContent?.includes("Paper"),
    ) as HTMLButtonElement | undefined;
    act(() => {
      paperBtn!.click();
    });
    const other: AgentSession = {
      ...session,
      id: "d2",
      title: "Dashboard",
      vmId: "v2",
      palette: ocean,
    };
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: other.id,
              sessions: [session, other],
              vms: [vm],
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      resolvePatch?.({ ...session, palette: paper });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latestCanvasDoc()).toContain(`--primary: ${ocean.primary}`);
    expect(latestCanvasDoc()).not.toContain(`--primary: ${paper.primary}`);
  });

  it("restyles hardcoded canvas colors when the operator picks a new palette", async () => {
    const ink = PALETTE_PRESETS.find((preset) => preset.id === "ink")!.colors;
    const paper = PALETTE_PRESETS.find((preset) => preset.id === "paper")!.colors;
    vi.mocked(api.canvas).mockResolvedValue({
      html: `<html><head><style>:root { --bg: ${ink.bg}; --surface: ${ink.surface}; --text: ${ink.text}; --muted: ${ink.muted}; --primary: ${ink.primary}; --accent: ${ink.accent}; }</style></head><body style="background:${ink.bg}"><a class="cta" style="background:${ink.primary}">Go</a></body></html>`,
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.patchSession).mockImplementation(async (_id, patch) => ({
      ...session,
      palette: patch.palette ?? session.palette,
    }));
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [{ ...session, palette: ink }],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latestCanvasDoc()).toContain(`background:${ink.primary}`);
    act(() => {
      (host.querySelector(".palette-swatch-row") as HTMLButtonElement).click();
    });
    const paperBtn = [...host.querySelectorAll(".palette-pop button")].find((btn) =>
      btn.textContent?.includes("Paper"),
    ) as HTMLButtonElement | undefined;
    act(() => {
      paperBtn!.click();
    });
    expect(latestCanvasDoc()).toContain(`background:${paper.bg}`);
    expect(latestCanvasDoc()).toContain(`background:${paper.primary}`);
    expect(latestCanvasDoc()).not.toContain(ink.primary);
    expect(latestCanvasDoc()).toContain(`--primary: ${paper.primary}`);
  });

  it("offers imported design system palettes in the canvas picker", async () => {
    const imported: DesignSystem = {
      id: "sys-acme",
      name: "Acme brand",
      summary: "Imported kit",
      palette: {
        bg: "#0a1628",
        surface: "#12233d",
        text: "#f6f7fb",
        muted: "#8b97ab",
        primary: "#3d7cff",
        accent: "#f0b429",
      },
      typography: { ...DEFAULT_DESIGN_TYPOGRAPHY },
      radiusPx: 12,
      spacePx: 8,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.patchSession).mockImplementation(async (_id, patch) => ({
      ...session,
      palette: patch.palette ?? session.palette,
    }));
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
      designSystems: [imported],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      (host.querySelector(".palette-swatch-row") as HTMLButtonElement).click();
    });
    expect(host.textContent).toContain("Acme brand");
    const acmeBtn = [...host.querySelectorAll(".palette-pop button")].find((btn) =>
      btn.textContent?.includes("Acme brand"),
    ) as HTMLButtonElement | undefined;
    act(() => {
      acmeBtn!.click();
    });
    expect(latestCanvasDoc()).toContain(`--primary: ${imported.palette.primary}`);
  });

  it("promotes the canvas into an agent without leaving Design", async () => {
    const agent: AgentSession = {
      ...session,
      id: "a1",
      title: "Landing page app",
      kind: undefined,
    };
    const design: AgentSession = {
      ...session,
      messages: [
        { id: "n1", role: "system", content: "Promoted to agent", createdAt: session.createdAt },
      ],
    };
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.promote).mockResolvedValue({ agent, design });
    const actions: Action[] = [];
    render(
      {
        ...initialState,
        section: "design",
        selectedId: session.id,
        sessions: [session],
        vms: [vm],
      },
      (action) => actions.push(action),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const btn = [...host.querySelectorAll("button")].find((el) => el.textContent === "Promote");
    expect(btn).toBeTruthy();
    await act(async () => {
      btn!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.promote).toHaveBeenCalledWith("d1", { scaffold: "vite-react" });
    expect(actions.some((action) => action.type === "session" && action.session.id === "a1")).toBe(
      true,
    );
    expect(actions.some((action) => action.type === "session" && action.session.id === "d1")).toBe(
      true,
    );
    expect(actions.some((action) => action.type === "select")).toBe(false);
    expect(host.querySelector("iframe")?.getAttribute("title")).toBe("Design canvas");
  });

  it("surfaces promote errors and labels the collapse control", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.promote).mockRejectedValue(new Error("Guest is stopped"));
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[aria-label="Collapse canvas"]')).toBeTruthy();
    expect(
      [...host.querySelectorAll("button")].some((btn) => btn.textContent === "Edit text"),
    ).toBe(true);
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Inspect")).toBe(
      true,
    );
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Undo")).toBe(
      true,
    );
    expect(host.textContent).toContain("Export PNG");
    const btn = [...host.querySelectorAll("button")].find((el) => el.textContent === "Promote");
    await act(async () => {
      btn!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".design-canvas-error")?.textContent).toMatch(/Guest is stopped/);
  });

  it("clears a stuck Promoting label when switching sessions", async () => {
    let release: (value: { agent: AgentSession; design: AgentSession }) => void = () => undefined;
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.promote).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const other: AgentSession = { ...session, id: "d2", title: "Other" };
    let current: UiState = {
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session, other],
      vms: [vm, { ...vm, id: "v2", sessionId: "d2" }],
    };
    function dispatch(action: Action) {
      if (action.type === "select") current = { ...current, selectedId: action.id };
    }
    render(current, dispatch);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const btn = [...host.querySelectorAll("button")].find((el) => el.textContent === "Promote");
    act(() => {
      btn!.click();
    });
    expect(host.textContent).toContain("Promoting…");
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...current, selectedId: other.id },
            dispatch,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("Promoting…");
    await act(async () => {
      release({ agent: session, design: session });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("Promoting…");
  });

  it("snapshots the live canvas as a named variant", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.createDesignVariant).mockResolvedValue({
      ...session,
      designVariants: [{ id: "vhero", name: "Hero" }],
      activeVariantId: "vhero",
    });
    const actions: Action[] = [];
    render(
      {
        ...initialState,
        section: "design",
        selectedId: session.id,
        sessions: [session],
        vms: [vm],
      },
      (action) => actions.push(action),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const save = [...host.querySelectorAll("button")].find(
      (el) => el.textContent === "Save variant",
    );
    expect(save?.classList.contains("menu-item")).toBe(true);
    await act(async () => {
      save!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createDesignVariant).toHaveBeenCalledWith("d1", undefined);
    expect(
      actions.some(
        (action) => action.type === "session" && action.session.activeVariantId === "vhero",
      ),
    ).toBe(true);
  });

  it("shows the swap loader on the canvas while activating another variant", async () => {
    const firstHtml = "<html><body><h1>Hero</h1></body></html>";
    const nextHtml = "<html><body><h1>Pricing</h1></body></html>";
    vi.mocked(api.canvas).mockResolvedValue({
      html: firstHtml,
      path: "/workspace/index.html",
    });
    let resolveActivate: (next: AgentSession) => void = () => undefined;
    vi.mocked(api.activateDesignVariant).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveActivate = resolve;
        }),
    );
    const withVariants: AgentSession = {
      ...session,
      designVariants: [
        { id: "vhero", name: "Hero" },
        { id: "vprice", name: "Pricing" },
      ],
      activeVariantId: "vhero",
    };
    const actions: Action[] = [];
    render(
      {
        ...initialState,
        section: "design",
        selectedId: withVariants.id,
        sessions: [withVariants],
        vms: [vm],
      },
      (action) => actions.push(action),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = pendingFrame();
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(swapOverlay()).toBeNull();
    await act(async () => {
      setSelectValue(host, "Design variant", "vprice");
    });
    expect(api.activateDesignVariant).toHaveBeenCalledWith("d1", "vprice");
    expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);
    expect(host.querySelector(".design-stage")?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector(".vm-status-copy .meta")?.textContent).toMatch(/loading/i);
    expect(canvasFrameDoc(host.querySelector("iframe.is-front") as HTMLIFrameElement)).toContain(
      "Hero",
    );
    expect(host.querySelector("#canvas-variant")?.getAttribute("aria-disabled")).toBe("true");

    vi.mocked(api.canvas).mockResolvedValue({
      html: nextHtml,
      path: "/workspace/index.html",
    });
    await act(async () => {
      resolveActivate({ ...withVariants, activeVariantId: "vprice" });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      actions.some(
        (action) => action.type === "session" && action.session.activeVariantId === "vprice",
      ),
    ).toBe(true);
    expect(actions.some((action) => action.type === "canvas" && action.html === nextHtml)).toBe(
      true,
    );
    expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);
    expect(
      [...host.querySelectorAll("iframe")].some((el) =>
        canvasFrameDoc(el as HTMLIFrameElement).includes("Pricing"),
      ),
    ).toBe(true);

    const next = pendingFrame();
    attachCanvasSeq(next);
    await act(async () => {
      next.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(swapOverlay()).toBeNull();
    expect(host.querySelector(".design-stage")?.getAttribute("aria-busy")).toBe("false");
    expect(canvasFrameDoc(host.querySelector("iframe.is-front") as HTMLIFrameElement)).toContain(
      "Pricing",
    );
  });

  it("hides the swap loader if the variant canvas paints before activate returns", async () => {
    const firstHtml = "<html><body><h1>Hero</h1></body></html>";
    const nextHtml = "<html><body><h1>Pricing</h1></body></html>";
    vi.mocked(api.canvas).mockResolvedValue({
      html: firstHtml,
      path: "/workspace/index.html",
    });
    let resolveActivate: (next: AgentSession) => void = () => undefined;
    vi.mocked(api.activateDesignVariant).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveActivate = resolve;
        }),
    );
    const withVariants: AgentSession = {
      ...session,
      designVariants: [
        { id: "vhero", name: "Hero" },
        { id: "vprice", name: "Pricing" },
      ],
      activeVariantId: "vhero",
    };
    const baseState = {
      ...initialState,
      section: "design" as const,
      selectedId: withVariants.id,
      sessions: [withVariants],
      vms: [vm],
      canvasHtml: { d1: firstHtml },
    };
    const actions: Action[] = [];
    function show(state: UiState) {
      root.render(
        <Store.Provider
          value={{
            state,
            dispatch: (action) => actions.push(action),
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    }
    render(baseState, (action) => actions.push(action));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = pendingFrame();
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(swapOverlay()).toBeNull();

    await act(async () => {
      setSelectValue(host, "Design variant", "vprice");
    });
    expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);

    vi.mocked(api.canvas).mockResolvedValue({
      html: nextHtml,
      path: "/workspace/index.html",
    });
    await act(async () => {
      show({ ...baseState, canvasHtml: { d1: nextHtml } });
      await Promise.resolve();
      await Promise.resolve();
    });
    const next = pendingFrame();
    expect(canvasFrameDoc(next)).toContain("Pricing");
    attachCanvasSeq(next);
    await act(async () => {
      next.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(canvasFrameDoc(host.querySelector("iframe.is-front") as HTMLIFrameElement)).toContain(
      "Pricing",
    );

    vi.mocked(api.canvas).mockResolvedValue({
      html: nextHtml,
      path: "/workspace/index.html",
    });
    await act(async () => {
      resolveActivate({ ...withVariants, activeVariantId: "vprice" });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushPaint();
    expect(swapOverlay()).toBeNull();
    expect(host.querySelector(".design-stage")?.getAttribute("aria-busy")).toBe("false");
  });

  it("dismisses the swap overlay when a preview posts canvas-ready after switching agents", async () => {
    const other: AgentSession = { ...session, id: "d2", title: "Dashboard", vmId: "v2" };
    vi.mocked(api.canvas).mockImplementation(async (id: string) => ({
      html: id === "d2" ? "<html><body>Dashboard</body></html>" : "<html><body>First</body></html>",
      path: "/workspace/index.html",
    }));
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session, other],
      vms: [vm],
      canvasHtml: {
        d1: "<html><body>First</body></html>",
        d2: "<html><body>Dashboard</body></html>",
      },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = pendingFrame();
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(swapOverlay()).toBeNull();

    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: other.id,
              sessions: [session, other],
              vms: [vm],
              canvasHtml: {
                d1: "<html><body>First</body></html>",
                d2: "<html><body>Dashboard</body></html>",
              },
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);
    const next = pendingFrame();
    expect(canvasFrameDoc(next)).toContain("Dashboard");
    await signalCanvasReady(next);
    expect(swapOverlay()).toBeNull();
    expect(canvasFrameDoc(host.querySelector("iframe.is-front") as HTMLIFrameElement)).toContain(
      "Dashboard",
    );
  });

  it("dismisses the swap overlay when a unique-origin canvas posts ready after the runner loads", async () => {
    const other: AgentSession = { ...session, id: "d2", title: "Dashboard", vmId: "v2" };
    vi.mocked(api.canvas).mockImplementation(async (id: string) => ({
      html: id === "d2" ? "<html><body>Dashboard</body></html>" : "<html><body>First</body></html>",
      path: "/workspace/index.html",
    }));
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session, other],
      vms: [vm],
      canvasHtml: {
        d1: "<html><body>First</body></html>",
        d2: "<html><body>Dashboard</body></html>",
      },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = pendingFrame();
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(swapOverlay()).toBeNull();

    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: other.id,
              sessions: [session, other],
              vms: [vm],
              canvasHtml: {
                d1: "<html><body>First</body></html>",
                d2: "<html><body>Dashboard</body></html>",
              },
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);
    const next = pendingFrame();
    expect(canvasFrameDoc(next)).toContain("Dashboard");
    Object.defineProperty(next, "contentDocument", { configurable: true, value: null });
    await act(async () => {
      next.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);
    await signalCanvasReady(next);
    expect(swapOverlay()).toBeNull();
    expect(canvasFrameDoc(host.querySelector("iframe.is-front") as HTMLIFrameElement)).toContain(
      "Dashboard",
    );
    expect(host.querySelector(".design-stage")?.getAttribute("aria-busy")).toBe("false");
  });

  it("dismisses the swap overlay when a vendored HTTP canvas loads without a ready ping", async () => {
    const moduleHtml = `<!DOCTYPE html><html><head></head><body><canvas id="view"></canvas>
<script type="module">import * as THREE from './vendor/three.module.js';</script>
</body></html>`;
    const other: AgentSession = { ...session, id: "d2", title: "Depot 13", vmId: "v2" };
    vi.mocked(api.canvas).mockImplementation(async (id: string) => ({
      html: id === "d2" ? moduleHtml : "<html><body>First</body></html>",
      path: "/workspace/index.html",
    }));
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session, other],
      vms: [vm],
      canvasHtml: {
        d1: "<html><body>First</body></html>",
        d2: moduleHtml,
      },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = pendingFrame();
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(swapOverlay()).toBeNull();

    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: other.id,
              sessions: [session, other],
              vms: [vm],
              canvasHtml: {
                d1: "<html><body>First</body></html>",
                d2: moduleHtml,
              },
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);
    const next = pendingFrame();
    expect(next.getAttribute("data-canvas-http")).toBe("1");
    expect(next.getAttribute("src")).toMatch(/\/api\/sessions\/d2\/canvas-files\//);
    Object.defineProperty(next, "contentDocument", { configurable: true, value: null });
    await act(async () => {
      next.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(swapOverlay()).toBeNull();
    expect(host.querySelector("iframe.is-front")).toBe(next);
    expect(host.querySelector(".design-stage")?.getAttribute("aria-busy")).toBe("false");
  });

  it("dismisses the swap overlay if the pending canvas never posts ready", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const other: AgentSession = { ...session, id: "d2", title: "Dashboard", vmId: "v2" };
    vi.mocked(api.canvas).mockImplementation(async (id: string) => ({
      html: id === "d2" ? "<html><body>Dashboard</body></html>" : "<html><body>First</body></html>",
      path: "/workspace/index.html",
    }));
    try {
      render({
        ...initialState,
        section: "design",
        selectedId: session.id,
        sessions: [session, other],
        vms: [vm],
        canvasHtml: {
          d1: "<html><body>First</body></html>",
          d2: "<html><body>Dashboard</body></html>",
        },
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const first = pendingFrame();
      attachCanvasSeq(first);
      await act(async () => {
        first.dispatchEvent(new Event("load"));
      });
      await flushPaint();

      act(() => {
        root.render(
          <Store.Provider
            value={{
              state: {
                ...initialState,
                vmCollapsed: false,
                section: "design",
                selectedId: other.id,
                sessions: [session, other],
                vms: [vm],
                canvasHtml: {
                  d1: "<html><body>First</body></html>",
                  d2: "<html><body>Dashboard</body></html>",
                },
              },
              dispatch: () => undefined,
            }}
          >
            <DesignCanvas />
          </Store.Provider>,
        );
      });
      expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);
      await act(async () => {
        vi.advanceTimersByTime(CANVAS_READY_FALLBACK_MS);
      });
      await flushPaint();
      expect(swapOverlay()).toBeNull();
      expect(canvasFrameDoc(host.querySelector("iframe.is-front") as HTMLIFrameElement)).toContain(
        "Dashboard",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses the swap overlay when canvas-ready posts seq 0 after switching agents", async () => {
    const other: AgentSession = { ...session, id: "d2", title: "Dashboard", vmId: "v2" };
    vi.mocked(api.canvas).mockImplementation(async (id: string) => ({
      html: id === "d2" ? "<html><body>Dashboard</body></html>" : "<html><body>First</body></html>",
      path: "/workspace/index.html",
    }));
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session, other],
      vms: [vm],
      canvasHtml: {
        d1: "<html><body>First</body></html>",
        d2: "<html><body>Dashboard</body></html>",
      },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = pendingFrame();
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    await flushPaint();

    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: other.id,
              sessions: [session, other],
              vms: [vm],
              canvasHtml: {
                d1: "<html><body>First</body></html>",
                d2: "<html><body>Dashboard</body></html>",
              },
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    expect(swapOverlay()?.textContent).toMatch(/Loading canvas/);
    const next = pendingFrame();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "locus-canvas-ready", seq: 0 },
          source: next.contentWindow,
        }),
      );
    });
    await flushPaint();
    expect(swapOverlay()).toBeNull();
    expect(canvasFrameDoc(host.querySelector("iframe.is-front") as HTMLIFrameElement)).toContain(
      "Dashboard",
    );
  });

  it("hides the swap loader if activating a variant fails", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hero</h1></body></html>",
      path: "/workspace/index.html",
    });
    vi.mocked(api.activateDesignVariant).mockRejectedValue(new Error("offline"));
    const withVariants: AgentSession = {
      ...session,
      designVariants: [
        { id: "vhero", name: "Hero" },
        { id: "vprice", name: "Pricing" },
      ],
      activeVariantId: "vhero",
    };
    render({
      ...initialState,
      section: "design",
      selectedId: withVariants.id,
      sessions: [withVariants],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      setSelectValue(host, "Design variant", "vprice");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.activateDesignVariant).toHaveBeenCalledWith("d1", "vprice");
    expect(swapOverlay()).toBeNull();
    expect(host.querySelector(".design-stage")?.getAttribute("aria-busy")).toBe("false");
  });

  it("edits canvas text without a model turn", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: '<html><body><h1 class="hero">Hello</h1></body></html>',
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.editCanvasText).mockResolvedValue(session);
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const edit = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Edit text",
    );
    expect(edit).toBeTruthy();
    act(() => {
      edit!.click();
    });
    expect(edit!.getAttribute("aria-pressed")).toBe("true");
    expect(canvasFrameDoc(host.querySelector("iframe") as HTMLIFrameElement)).toContain(
      "data-locus-edit-hook",
    );
    const frame = host.querySelector("iframe") as HTMLIFrameElement;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "locus-design-edit",
            tag: "h1",
            text: "Ship it",
            id: "",
            className: "hero",
          },
          source: frame.contentWindow,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.editCanvasText).toHaveBeenCalledWith("d1", { selector: "h1.hero", text: "Ship it" });
    expect(edit!.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens canvas knobs and explores three directions", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: '<html data-tune="space:4-16"><body><h1>Hello</h1></body></html>',
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.exploreDesignDirections).mockResolvedValue(session);
    vi.mocked(api.patchSession).mockResolvedValue({ ...session, designTune: { spacePx: 12 } });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const tune = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Tune");
    act(() => {
      tune!.click();
    });
    expect(host.querySelector("[aria-label='Canvas knobs']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Primary color']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Space']")).toBeTruthy();
    const explore = [...host.querySelectorAll("button")].find(
      (el) => el.textContent === "Explore 3 directions",
    );
    expect(explore).toBeTruthy();
    await act(async () => {
      explore!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.exploreDesignDirections).toHaveBeenCalledWith("d1");
  });

  function pendingFrame(): HTMLIFrameElement {
    return host.querySelector("iframe.is-pending") as HTMLIFrameElement;
  }

  function swapOverlay(): HTMLElement | null {
    return host.querySelector("[data-testid='design-swap-overlay']");
  }

  async function signalCanvasReady(iframe: HTMLIFrameElement): Promise<void> {
    const match = canvasFrameDoc(iframe).match(/data-locus-canvas-seq="(\d+)"/);
    const seq = match ? Number(match[1]) : 0;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "locus-canvas-ready", seq },
          source: iframe.contentWindow,
        }),
      );
    });
    await flushPaint();
  }

  function attachCanvasSeq(iframe: HTMLIFrameElement): number {
    const html = canvasFrameDoc(iframe);
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

  it("keeps the same pending iframe while the agent streams html", async () => {
    vi.mocked(api.canvas).mockResolvedValue({ html: null, path: "/workspace/index.html" });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [{ ...session, status: "running" }],
      vms: [vm],
      canvasHtml: { d1: "<html><body><h1>One</h1></body></html>" },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = host.querySelector("iframe") as HTMLIFrameElement;
    expect(first.classList.contains("is-pending")).toBe(true);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: session.id,
              sessions: [{ ...session, status: "running" }],
              vms: [vm],
              canvasHtml: { d1: "<html><body><h1>One</h1><p>Two</p></body></html>" },
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    expect(host.querySelector("iframe")).toBe(first);
    expect(canvasFrameDoc(first)).toContain("Two");
    expect(host.querySelector("iframe.is-front")).toBeNull();
  });

  it("shows the first canvas while it is still pending so a missed ready signal is not a blank page", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
    });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const iframe = pendingFrame();
    expect(iframe.classList.contains("is-solo")).toBe(true);
    expect(iframe.classList.contains("is-pending")).toBe(true);
    expect(host.querySelector("iframe.is-front")).toBeNull();
    expect(canvasFrameDoc(iframe)).toContain("Hello");
  });

  it("waits to mount the iframe until a hidden section host is visible", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    const wrap = document.createElement("div");
    wrap.style.opacity = "0";
    host.appendChild(wrap);
    root = createRoot(wrap);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: session.id,
              sessions: [session],
              vms: [vm],
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(isCanvasHostHidden(host.querySelector(".design-frame"))).toBe(true);
    expect(host.querySelector("iframe")).toBeNull();
    wrap.style.opacity = "1";
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
    expect(isCanvasHostHidden(host.querySelector(".design-frame"))).toBe(false);
    expect(host.querySelector("iframe")).toBeTruthy();
    expect(canvasFrameDoc(host.querySelector("iframe") as HTMLIFrameElement)).toContain("Hello");
    expect((host.querySelector("iframe") as HTMLIFrameElement).classList.contains("is-solo")).toBe(
      true,
    );
  });

  it("ignores a blank iframe load so the canvas does not flash white", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
    });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const iframe = pendingFrame();
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: document.implementation.createHTMLDocument(),
    });
    await act(async () => {
      iframe.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(host.querySelector("iframe.is-front")).toBeNull();
    expect(iframe.classList.contains("is-pending")).toBe(true);
    expect(iframe.classList.contains("is-ready")).toBe(false);
  });

  it("reveals the next page only after the preview guard has loaded", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
    });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const iframe = pendingFrame();
    attachCanvasSeq(iframe);
    await act(async () => {
      iframe.dispatchEvent(new Event("load"));
    });
    expect(iframe.classList.contains("is-ready")).toBe(true);
    await flushPaint();
    const front = host.querySelector("iframe.is-front") as HTMLIFrameElement | null;
    expect(front).toBe(iframe);
    expect(canvasFrameDoc(front)).toContain("Hello");
    expect(host.querySelector("iframe.is-pending")).toBeNull();
  });

  it("paints a follow-up canvas as soon as the pending page loads, without a click", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
    });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [{ ...session, status: "running" }],
      vms: [vm],
      canvasHtml: { d1: "<html><body><h1>Hello</h1></body></html>" },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = pendingFrame();
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(
      canvasFrameDoc(host.querySelector("iframe.is-front") as HTMLIFrameElement | null),
    ).toContain("Hello");

    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: session.id,
              sessions: [{ ...session, status: "running" }],
              vms: [vm],
              canvasHtml: { d1: "<html><body><h1>Hello</h1><p>Updated</p></body></html>" },
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    const pending = pendingFrame();
    expect(pending).toBeTruthy();
    expect(pending).not.toBe(host.querySelector("iframe.is-front"));
    expect(canvasFrameDoc(pending)).toContain("Updated");
    expect(pending.classList.contains("is-solo")).toBe(false);
    attachCanvasSeq(pending);
    await act(async () => {
      pending.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(host.querySelector("iframe.is-front")).toBe(pending);
    expect(
      canvasFrameDoc(host.querySelector("iframe.is-front") as HTMLIFrameElement | null),
    ).toContain("Updated");
    expect(host.querySelector("iframe.is-pending")).toBeNull();
  });

  it("keeps the painted front when a newer canvas arrives before the pending page is ready", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
    });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [{ ...session, status: "running" }],
      vms: [vm],
      canvasHtml: { d1: "<html><body><h1>Hello</h1></body></html>" },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = pendingFrame();
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(host.querySelector("iframe.is-front")).toBe(first);

    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: session.id,
              sessions: [{ ...session, status: "running" }],
              vms: [vm],
              canvasHtml: { d1: "<html><body><h1>Hello</h1><p>Mid</p></body></html>" },
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    const mid = pendingFrame();
    expect(mid).not.toBe(first);
    expect(canvasFrameDoc(mid)).toContain("Mid");
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: session.id,
              sessions: [{ ...session, status: "running" }],
              vms: [vm],
              canvasHtml: { d1: "<html><body><h1>Hello</h1><p>Mid</p><p>Final</p></body></html>" },
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    expect(pendingFrame()).toBe(mid);
    expect(canvasFrameDoc(mid)).toContain("Mid");
    attachCanvasSeq(mid);
    await act(async () => {
      mid.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(host.querySelector("iframe.is-front")).toBe(first);
    const latest = pendingFrame();
    expect(latest).toBeTruthy();
    expect(latest).not.toBe(first);
    expect(canvasFrameDoc(latest)).toContain("Final");
    attachCanvasSeq(latest);
    await act(async () => {
      latest.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(host.querySelector("iframe.is-front")).toBe(latest);
    expect(canvasFrameDoc(latest)).toContain("Final");
    expect(first.classList.contains("is-idle")).toBe(true);
  });

  it("promotes a solo pending page in place when a newer canvas is already queued", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hello</h1></body></html>",
      path: "/workspace/index.html",
    });
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [{ ...session, status: "running" }],
      vms: [vm],
      canvasHtml: { d1: "<html><body><h1>Hello</h1></body></html>" },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = pendingFrame();
    expect(first.classList.contains("is-solo")).toBe(true);
    attachCanvasSeq(first);
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              vmCollapsed: false,
              section: "design",
              selectedId: session.id,
              sessions: [{ ...session, status: "running" }],
              vms: [vm],
              canvasHtml: { d1: "<html><body><h1>Hello</h1><p>Queued</p></body></html>" },
            },
            dispatch: () => undefined,
          }}
        >
          <DesignCanvas />
        </Store.Provider>,
      );
    });
    expect(host.querySelector("iframe.is-pending")).toBe(first);
    await flushPaint();
    expect(host.querySelector("iframe.is-front")).toBe(first);
    expect(canvasFrameDoc(first)).toContain("Hello");
    expect(canvasFrameDoc(first)).not.toContain("Queued");
    const pending = pendingFrame();
    expect(pending).toBeTruthy();
    expect(pending).not.toBe(first);
    expect(canvasFrameDoc(pending)).toContain("Queued");
    expect(pending.classList.contains("is-solo")).toBe(false);
    attachCanvasSeq(pending);
    await act(async () => {
      pending.dispatchEvent(new Event("load"));
    });
    await flushPaint();
    expect(host.querySelector("iframe.is-front")).toBe(pending);
    expect(canvasFrameDoc(pending)).toContain("Queued");
    expect(first.classList.contains("is-idle")).toBe(true);
  });

  it("matches the bound agent preview from the canvas", async () => {
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Draft</h1></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.execTool).mockResolvedValue({
      ok: true,
      output: "ok",
      screenshotBase64: "aaaa",
    });
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    const agent: AgentSession = {
      id: "a1",
      title: "acme/app",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      preview: { port: 5173 },
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    render({
      ...initialState,
      section: "design",
      selectedId: session.id,
      sessions: [{ ...session, promotedAgentId: "a1" }, agent],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const match = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Match preview"),
    );
    expect(match).toBeTruthy();
    await act(async () => {
      match!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.execTool).toHaveBeenCalledWith("a1", "screenshot");
    expect(api.chat).toHaveBeenCalledWith(
      "d1",
      expect.stringContaining("/api/sessions/a1/preview-http/5173/"),
      expect.objectContaining({
        attachments: [expect.objectContaining({ name: "preview.png", contentBase64: "aaaa" })],
      }),
    );
  });

  it("shows Games chrome: kits, landscape, playtest, feel, and canvas-vite promote", async () => {
    const game: AgentSession = {
      ...session,
      id: "g1",
      title: "Arcade",
      kind: "game",
    };
    const gameVm = { ...vm, id: "vg1", sessionId: "g1" };
    vi.mocked(api.canvas).mockResolvedValue({
      html: '<html data-tune="gravity:40-120,jump:8-24" data-controls="WASD: move · Space: jump"><body><canvas></canvas><span>Score 0</span></body></html>',
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.execTool).mockResolvedValue({
      ok: true,
      output: "ok  press ArrowRight",
      screenshotBase64: "aaaa",
    });
    vi.mocked(api.promote).mockResolvedValue({
      agent: { ...game, id: "a-game", kind: undefined, title: "Arcade app" },
      design: game,
    });
    render({
      ...initialState,
      section: "games",
      selectedId: game.id,
      sessions: [game],
      vms: [gameVm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[aria-label='Game kit']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Game kit']")?.getAttribute("title")).toBe("Game kit");
    expect(host.querySelector("[aria-label='Design system']")).toBeNull();
    expect(host.querySelector("[aria-label='Color palette']")).toBeNull();
    expect(host.querySelector(".palette-swatch-row")).toBeNull();
    expect(host.querySelector("[aria-label='Viewport']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Iterate']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Game']")).toBeTruthy();
    expect(host.querySelector(".game-iterate")).toBeNull();
    expect(host.querySelector(".game-controls")).toBeNull();
    expect(host.textContent).toContain("Landscape");
    expect(host.textContent).toContain("Play");
    expect(host.textContent).toContain("Playtest");
    expect(host.textContent).toContain("Mute");
    expect(host.textContent).toContain("Replay");
    expect(host.textContent).toContain("Soften");
    expect(host.textContent).toContain("Crunch");
    expect(host.textContent).toContain("Juice");
    expect(host.textContent).toContain("Teach");
    expect(host.textContent).toContain("Fail-state");
    expect(host.textContent).toContain("Balance");
    expect(host.textContent).toContain("Fix from playtest");
    expect(host.textContent).toContain("Apply brief");
    expect(host.textContent).toContain("Keep feel");
    expect(host.textContent).toContain("Explore 3 loops");
    expect(host.textContent).toContain("Export zip");
    expect(host.textContent).toContain("Pop-out play");
    expect(host.textContent).toContain("Clear save");
    expect(host.textContent).toContain("Reset");
    expect(host.textContent).toContain("Pause");
    expect(host.textContent).toContain("Debug");
    expect(host.textContent).toContain("Touch");
    expect(host.textContent).toContain("Gamepad");
    expect(host.textContent).toContain("Record 15s");
    expect(host.textContent).toContain("Copy play link");
    expect(host.textContent).toContain("Grow this into a project");
    expect(host.textContent).toContain("Generate Sprite");
    expect(host.textContent).toContain("Generate Sheet");
    expect(host.textContent).toContain("Generate Mesh");
    expect(host.textContent).toContain("Generate SFX");
    expect(host.textContent).toContain("Manage game styles");
    expect(host.querySelector("[aria-label='Game style']")).toBeTruthy();
    expect(host.querySelector(".design-toolbar-overflow-modes")?.textContent).toContain("Feel");
    const feel = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Feel");
    act(() => {
      feel!.click();
    });
    expect(host.querySelector("[aria-label='Feel presets']")?.textContent).toMatch(/floaty/);
    expect(host.querySelector("[aria-label='Feel presets']")?.textContent).toMatch(/crunchy/);
    expect(host.querySelector("[aria-label='Feel presets']")?.textContent).toMatch(/heavy/);
    expect(host.querySelector("[aria-label='Primary color']")).toBeNull();
    expect(host.querySelector("[aria-label='Seed']")).toBeTruthy();
    vi.mocked(api.exportGameZip).mockResolvedValue({
      filename: "arcade.zip",
      zipBase64: btoa("PK"),
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:arcade");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const exportZip = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Export zip",
    );
    await act(async () => {
      exportZip!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.exportGameZip).toHaveBeenCalledWith("g1");
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    expect(host.querySelector("[aria-label='Viewport']")).toBeTruthy();
    act(() => {
      setSelectValue(host, "Viewport", "landscape");
    });
    expect(host.querySelector(".design-frame")?.getAttribute("data-viewport")).toBe("landscape");
    expect((host.querySelector(".design-frame") as HTMLElement).style.height).toBe("390px");
    const play = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Play");
    act(() => {
      play!.click();
    });
    expect(host.querySelector(".design-pane")?.classList.contains("is-play-mode")).toBe(true);
    expect(host.textContent).toContain("Exit play");
    expect(host.textContent).toContain("WASD: move · Space: jump");
    expect(host.querySelector(".game-controls")).toBeTruthy();
    expect(latestCanvasDoc()).toContain("data-locus-game-feel");
    expect(latestCanvasDoc()).toContain("data-locus-game-chrome");
    const playtest = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Playtest",
    );
    await act(async () => {
      playtest!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.execTool).toHaveBeenCalledWith(
      "g1",
      "playwright",
      expect.objectContaining({
        viewport: "landscape",
        screenshot: true,
        steps: expect.arrayContaining(["press ArrowRight", "press Space"]),
      }),
    );
    expect(api.saveWorkspaceFile).toHaveBeenCalledWith(
      "g1",
      ".locus-game/last-run.json",
      expect.stringContaining("playtest"),
    );
    const soften = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Soften");
    await act(async () => {
      soften!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith("g1", expect.stringContaining("Soften pass"));
    const fix = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Fix from playtest",
    );
    await act(async () => {
      fix!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith(
      "g1",
      expect.stringContaining("Fix from playtest"),
      expect.objectContaining({
        attachments: [expect.objectContaining({ name: "playtest.png" })],
      }),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(api.playLink).mockResolvedValue({
      token: "pl_abc",
      url: "http://127.0.0.1:7420/play/pl_abc/",
      lanUrls: ["http://192.168.1.20:7420/play/pl_abc/"],
    });
    vi.mocked(api.generateGameAsset).mockResolvedValue({
      game,
      asset: { ...game, id: "as-sprite", kind: "assets", title: "Arcade Sprite" },
    });
    const playLink = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Copy play link",
    );
    await act(async () => {
      playLink!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.playLink).toHaveBeenCalledWith("g1");
    expect(writeText).toHaveBeenCalledWith(
      "http://127.0.0.1:7420/play/pl_abc/\nhttp://192.168.1.20:7420/play/pl_abc/",
    );
    expect(host.textContent).toContain("Unlisted");
    expect(host.querySelector("[aria-label='Play-on-phone QR code']")).toBeTruthy();
    expect(host.querySelector("[data-testid='phone-qr']")?.getAttribute("data-pairing-url")).toBe(
      "http://192.168.1.20:7420/play/pl_abc/",
    );
    const generateSprite = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Generate Sprite",
    );
    await act(async () => {
      generateSprite!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.generateGameAsset).toHaveBeenCalledWith("g1", "sprite");
    expect(selectValue(host, "Promote scaffold")).toBe("canvas-vite");
    expect(selectOptionLabels(host, "Promote scaffold")).toEqual(
      expect.arrayContaining(["Three.js + Vite", "Phaser + Vite"]),
    );
    await act(async () => {
      const promote = [...host.querySelectorAll("button")].find(
        (btn) => btn.textContent === "Grow this into a project",
      );
      promote!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.promote).toHaveBeenCalledWith("g1", { scaffold: "canvas-vite" });
  });

  it("queues Games iterate chips while a turn is running instead of steering", async () => {
    const game: AgentSession = {
      ...session,
      id: "g1",
      title: "Arcade",
      kind: "game",
      status: "running",
    };
    const gameVm = { ...vm, id: "vg1", sessionId: "g1" };
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><canvas></canvas></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    vi.mocked(api.saveWorkspaceFile).mockResolvedValue({
      path: "GAME.md",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    render({
      ...initialState,
      section: "games",
      selectedId: game.id,
      sessions: [game],
      vms: [gameVm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const balance = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Balance",
    );
    expect(balance).toBeTruthy();
    expect(balance!.disabled).toBe(false);
    await act(async () => {
      balance!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith("g1", expect.stringContaining("Balance from 3 seeded"));
    expect(api.chat).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.chat).mock.calls[0]?.[2]?.steer).toBeUndefined();

    const keep = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Keep feel",
    );
    expect(keep!.disabled).toBe(false);
    await act(async () => {
      keep!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith("g1", expect.stringContaining("operator feel knobs"));
    expect(vi.mocked(api.chat).mock.calls[1]?.[2]?.steer).toBeUndefined();
  });

  it("records a full 15s play capture before saving", async () => {
    const game: AgentSession = {
      ...session,
      id: "g1",
      title: "Arcade",
      kind: "game",
      status: "idle",
    };
    const gameVm = { ...vm, id: "vg1", sessionId: "g1" };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><canvas></canvas>Score 0<button>Restart</button></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.execTool).mockResolvedValue({
      ok: true,
      output: "ok  press ArrowRight",
    });
    try {
      render({
        ...initialState,
        section: "games",
        selectedId: game.id,
        sessions: [game],
        vms: [gameVm],
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const record = [...host.querySelectorAll("button")].find(
        (btn) => btn.textContent === "Record 15s",
      );
      expect(record).toBeTruthy();
      await act(async () => {
        record!.click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(api.execTool).toHaveBeenCalledWith("g1", "record_screen", {
        mode: "START_RECORDING",
      });
      expect(api.execTool).toHaveBeenCalledWith(
        "g1",
        "playwright",
        expect.objectContaining({ screenshot: true }),
      );
      expect(api.execTool).not.toHaveBeenCalledWith(
        "g1",
        "record_screen",
        expect.objectContaining({ mode: "SAVE_RECORDING" }),
      );
      await act(async () => {
        vi.advanceTimersByTime(GAME_RECORD_MS);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(api.execTool).toHaveBeenCalledWith(
        "g1",
        "record_screen",
        expect.objectContaining({
          mode: "SAVE_RECORDING",
          save_as_filename: "playtest",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs N seeded playtests before an idle Balance pass", async () => {
    const game: AgentSession = {
      ...session,
      id: "g1",
      title: "Arcade",
      kind: "game",
      status: "idle",
      designTune: { seed: 7 },
    };
    const gameVm = { ...vm, id: "vg1", sessionId: "g1" };
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><canvas></canvas>Score 0<button>Restart</button></body></html>",
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    vi.mocked(api.execTool).mockResolvedValue({
      ok: true,
      output: "ok  seed 7\nstats score=4 deaths=1 time=6",
    });
    vi.mocked(api.saveWorkspaceFile).mockResolvedValue({
      path: ".locus-game/last-run.json",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    render({
      ...initialState,
      section: "games",
      selectedId: game.id,
      sessions: [game],
      vms: [gameVm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const balance = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Balance",
    );
    await act(async () => {
      balance!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const playwrightCalls = vi
      .mocked(api.execTool)
      .mock.calls.filter((call) => call[1] === "playwright");
    expect(playwrightCalls).toHaveLength(GAME_BALANCE_RUNS);
    expect(playwrightCalls.map((call) => (call[2] as { steps?: string[] }).steps?.[0])).toEqual([
      "seed 7",
      "seed 8",
      "seed 9",
    ]);
    expect(api.chat).toHaveBeenCalledWith("g1", expect.stringContaining("Seeded playtests (3)"));
    expect(api.chat).toHaveBeenCalledWith("g1", expect.stringContaining("seed 7"));
    expect(api.chat).toHaveBeenCalledWith("g1", expect.stringContaining("seed 9"));
  });

  it("shows Assets chrome: kits, orbit, pose, clips, and three-vite promote", async () => {
    const asset: AgentSession = {
      ...session,
      id: "as1",
      title: "Hero mesh",
      kind: "assets",
    };
    const assetVm = { ...vm, id: "vas1", sessionId: "as1" };
    vi.mocked(api.canvas).mockResolvedValue({
      html: '<html data-tune="head:-45-45,arms:-80-80,legs:-60-60,twist:-45-45"><body><div id="rig"></div></body></html>',
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.promote).mockResolvedValue({
      agent: { ...asset, id: "a-asset", kind: undefined, title: "Hero mesh app" },
      design: asset,
    });
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({
      ...initialState,
      section: "assets",
      selectedId: asset.id,
      sessions: [asset],
      vms: [assetVm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[aria-label='Asset kit']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Design system']")).toBeNull();
    expect(host.querySelector("[aria-label='Color palette']")).toBeNull();
    expect(host.querySelector("[aria-label='Asset style']")).toBeTruthy();
    expect(host.textContent).toContain("Manage asset styles");
    expect(host.textContent).toContain("Save style from this studio");
    expect(host.querySelector("[aria-label='Studio']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Iterate']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Clip']")).toBeTruthy();
    expect(host.textContent).toContain("Orbit");
    expect(host.textContent).toContain("Wireframe");
    expect(host.querySelector("[aria-label='Studio zoom']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Zoom in']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Zoom out']")).toBeTruthy();
    expect(host.textContent).toContain("Play");
    expect(host.textContent).toContain("Retopo");
    expect(host.textContent).toContain("Texture");
    expect(host.textContent).toContain("Rig");
    expect(host.textContent).toContain("Animate");
    expect(host.textContent).toContain("Low poly");
    expect(host.textContent).toContain("Split");
    expect(host.textContent).toContain("Printability");
    expect(host.textContent).toContain("Apply brief");
    expect(host.textContent).toContain("Generate");
    expect(host.textContent).toContain("Keep pose");
    expect(host.querySelector("[aria-label='Camera']")).toBeTruthy();
    expect(host.textContent).toContain("Grid");
    expect(host.textContent).toContain("Clay");
    expect(host.textContent).toContain("Pause");
    expect(host.textContent).toContain("Export STL");
    expect(host.textContent).toContain("Export textures");
    expect(host.querySelector("[aria-label='Source photos']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Recents']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Units']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Viewport']")).toBeNull();
    expect(host.querySelector("[aria-label='Mesh stats']")).toBeTruthy();
    const buildBtn = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Build",
    );
    expect(buildBtn).toBeTruthy();
    act(() => {
      buildBtn!.click();
    });
    expect(host.querySelector("[aria-label='Build settings']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Topology']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Quality']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Resolution']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Rest pose']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Poly budget']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Timeline']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Backdrop']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Stage']")).toBeNull();
    const clusterLabels = [...host.querySelectorAll(".asset-cluster-label")].map(
      (el) => el.textContent,
    );
    expect(clusterLabels).toEqual(
      expect.arrayContaining([
        "View",
        "Inspect",
        "Generate",
        "Look",
        "Lights",
        "Backdrop",
        "Iterate",
        "Timeline",
        "Source",
        "Recents",
      ]),
    );
    expect(host.querySelector(".design-stage .asset-recents")).toBeNull();
    expect(host.querySelector(".design-pane > .asset-recents")).toBeTruthy();
    const front = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Front");
    expect(front?.getAttribute("title")).toMatch(/front/i);
    const clay = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Clay");
    expect(clay?.getAttribute("title")).toMatch(/form/);
    expect(host.textContent).toContain("Health");
    expect(host.textContent).toContain("Explore 3 directions");
    expect(host.textContent).toContain("Export pack");
    expect(host.textContent).toContain("Pop-out studio");
    expect(host.textContent).toContain("Export PNG");
    expect(host.textContent).toContain("Export GLB");
    expect(host.querySelector(".design-toolbar-overflow-modes")?.textContent).toContain("Pose");
    const poseBtn = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Pose");
    act(() => {
      poseBtn!.click();
    });
    expect(host.querySelector("[aria-label='Pose presets']")?.textContent).toMatch(/idle/);
    expect(host.querySelector("[aria-label='Pose presets']")?.textContent).toMatch(/walk/);
    expect(host.querySelector("[aria-label='Pose presets']")?.textContent).toMatch(/jump/);
    expect(host.querySelector("[aria-label='Pose presets']")?.textContent).toMatch(/pickup/);
    expect(host.querySelector("[aria-label='Pose presets']")?.textContent).toMatch(/carry/);
    expect(host.querySelector("[aria-label='Pose presets']")?.textContent).toMatch(/attack/);
    expect(host.querySelector("[aria-label='Primary color']")).toBeNull();
    expect(host.querySelector("[aria-label='head']")).toBeTruthy();
    expect(host.querySelector("[aria-label='arms']")).toBeTruthy();
    expect(latestCanvasDoc()).toContain("data-locus-asset-pose");
    expect(latestCanvasDoc()).toContain("data-locus-asset-chrome");
    const rig = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Rig");
    await act(async () => {
      rig!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith("as1", expect.stringContaining("Rig pass"));
    const generate = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Generate",
    );
    await act(async () => {
      generate!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createDesignVariant).toHaveBeenCalledWith("as1", "Before generate", {
      id: "undo",
      keepActive: true,
    });
    expect(api.chat).toHaveBeenCalledWith(
      "as1",
      expect.stringContaining("Generate from the current operator"),
    );
    vi.mocked(api.createDesignVariant).mockResolvedValue({
      ...asset,
      designVariants: [{ id: "saved", name: "Hero mesh" }],
    });
    const saveRecent = [...host.querySelectorAll(".asset-recents button")].find(
      (btn) => btn.textContent === "Save",
    ) as HTMLButtonElement | undefined;
    await act(async () => {
      saveRecent!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createDesignVariant).toHaveBeenCalledWith("as1", undefined, { keepActive: true });
    vi.mocked(api.exportGameZip).mockResolvedValue({
      filename: "hero-mesh.zip",
      zipBase64: btoa("PK"),
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:asset");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const exportZip = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Export pack",
    );
    await act(async () => {
      exportZip!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.exportGameZip).toHaveBeenCalledWith("as1");
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    expect(selectValue(host, "Promote scaffold")).toBe("three-vite");
    const scaffoldLabels = selectOptionLabels(host, "Promote scaffold");
    expect(scaffoldLabels).toEqual(expect.arrayContaining(["Three.js + Vite", "Canvas + Vite"]));
    expect(scaffoldLabels).not.toContain("Phaser + Vite");
    await act(async () => {
      const promote = [...host.querySelectorAll("button")].find(
        (btn) => btn.textContent === "Promote",
      );
      promote!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.promote).toHaveBeenCalledWith("as1", { scaffold: "three-vite" });
  });

  it("saves a style from the studio overflow and binds it", async () => {
    const asset: AgentSession = {
      ...session,
      id: "as1",
      title: "Hero mesh",
      kind: "assets",
    };
    const savedStyle = {
      id: "st1",
      name: "Hero mesh style",
      summary: "A clay hero with cream grout",
      guidelines: "Rounded silhouettes.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.mocked(api.canvas).mockResolvedValue({
      html: '<html data-locus-material="clay"><body><div id="rig"></div></body></html>',
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.saveAssetStyleFromSession).mockResolvedValue(savedStyle);
    vi.mocked(api.assetStyles).mockResolvedValue({ styles: [savedStyle], defaultId: undefined });
    vi.mocked(api.session).mockResolvedValue({ ...asset, assetStyleId: "st1" });
    const actions: Action[] = [];
    render(
      {
        ...initialState,
        section: "assets",
        selectedId: asset.id,
        sessions: [asset],
        vms: [{ ...vm, id: "vas1", sessionId: "as1" }],
      },
      (action) => actions.push(action),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const saveStyle = [...host.querySelectorAll(".menu-item")].find(
      (el) => el.textContent === "Save style from this studio",
    ) as HTMLButtonElement | undefined;
    expect(saveStyle).toBeTruthy();
    await act(async () => {
      saveStyle!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.saveAssetStyleFromSession).toHaveBeenCalledWith("as1");
    expect(actions.some((action) => action.type === "assetStyleList")).toBe(true);
    expect(
      actions.some((action) => action.type === "session" && action.session.assetStyleId === "st1"),
    ).toBe(true);
    expect(actions.some((action) => action.type === "assetStyles" && action.open)).toBe(true);
  });

  it("appends the bound asset style when generating", async () => {
    const style = {
      id: "st1",
      name: "Clay hero",
      summary: "Chunky terracotta",
      guidelines: "Rounded silhouettes.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const asset: AgentSession = {
      ...session,
      id: "as1",
      title: "Hero mesh",
      kind: "assets",
      assetStyleId: "st1",
    };
    vi.mocked(api.canvas).mockResolvedValue({
      html: '<html data-tune="head:-45-45"><body><div id="rig"></div></body></html>',
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    vi.mocked(api.createDesignVariant).mockResolvedValue(asset);
    render({
      ...initialState,
      section: "assets",
      selectedId: asset.id,
      sessions: [asset],
      vms: [{ ...vm, id: "vas1", sessionId: "as1" }],
      assetStyles: [style],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const generate = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Generate",
    );
    await act(async () => {
      generate!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith(
      "as1",
      expect.stringContaining('Saved asset style "Clay hero"'),
    );
  });

  it("zooms the asset canvas in, out, and back to 100%", async () => {
    const asset: AgentSession = {
      ...session,
      id: "as1",
      title: "Hero mesh",
      kind: "assets",
    };
    const assetVm = { ...vm, id: "vas1", sessionId: "as1" };
    vi.mocked(api.canvas).mockResolvedValue({
      html: '<html data-tune="head:-45-45"><body><div id="rig"></div></body></html>',
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    render({
      ...initialState,
      section: "assets",
      selectedId: asset.id,
      sessions: [asset],
      vms: [assetVm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const zoom = host.querySelector("[aria-label='Studio zoom']");
    expect(zoom?.textContent).toContain("100%");
    expect(host.querySelector(".design-stage")?.classList.contains("is-asset")).toBe(true);
    const zoomIn = host.querySelector("[aria-label='Zoom in']") as HTMLButtonElement;
    const zoomOut = host.querySelector("[aria-label='Zoom out']") as HTMLButtonElement;
    const reset = host.querySelector("[aria-label='Reset zoom']") as HTMLButtonElement;
    expect(zoomIn.disabled).toBe(false);
    const frame = canvasIframe();
    const posted: Array<{ type?: string }> = [];
    vi.spyOn(frame!.contentWindow!, "postMessage").mockImplementation((data) => {
      posted.push(data as { type?: string });
    });
    const side = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Side");
    act(() => {
      side!.click();
    });
    expect(posted.some((row) => row.type === "locus-asset-camera")).toBe(true);
    posted.length = 0;
    act(() => {
      zoomIn.click();
    });
    expect(posted.some((row) => row.type === "locus-asset-zoom")).toBe(true);
    expect(posted.some((row) => row.type === "locus-asset-camera")).toBe(false);
    expect(zoom?.textContent).toContain("108%");
    act(() => {
      reset.click();
    });
    expect(zoom?.textContent).toContain("100%");
    act(() => {
      zoomOut.click();
    });
    expect(zoom?.textContent).toContain("92%");
    act(() => {
      reset.click();
    });
    expect(zoom?.textContent).toContain("100%");
    const stage = host.querySelector(".design-stage") as HTMLElement;
    act(() => {
      stage.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true }),
      );
    });
    expect(zoom?.textContent).toContain("108%");
    expect(latestCanvasDoc()).toContain("locus-asset-zoom");
    expect(latestCanvasDoc()).toContain("freezePageZoom");
    expect(latestCanvasDoc()).toContain("[data-locus-asset-model], #rig, #model");
    expect(latestCanvasDoc()).not.toContain(
      "[data-locus-asset-model], #rig, #model, canvas, #stage",
    );
    expect(latestCanvasDoc()).toContain(
      "canvas, #stage, #view, #viewport, [data-locus-asset-stage]",
    );
    expect(latestCanvasDoc()).not.toContain("document.documentElement.style.zoom = String(z)");
  });

  it("opens an export save-as modal when Export STL is clicked", async () => {
    const asset: AgentSession = {
      ...session,
      id: "as1",
      title: "Hero mesh",
      kind: "assets",
    };
    const assetVm = { ...vm, id: "vas1", sessionId: "as1" };
    vi.mocked(api.canvas).mockResolvedValue({
      html: '<html data-tune="head:-45-45"><body><div id="rig"></div></body></html>',
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.saveHostFile).mockResolvedValue({
      path: "/tmp/exports/hero-mesh.stl",
      bytes: 11,
    });
    render({
      ...initialState,
      section: "assets",
      selectedId: asset.id,
      sessions: [asset],
      vms: [assetVm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latestCanvasDoc()).toContain("locus-asset-export-progress");
    const frame = canvasIframe();
    const posted: Array<{ type?: string; format?: string; filename?: string }> = [];
    vi.spyOn(frame!.contentWindow!, "postMessage").mockImplementation((data) => {
      posted.push(data as { type?: string; format?: string; filename?: string });
    });
    const stl = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Export STL",
    );
    act(() => {
      stl!.click();
    });
    expect(posted).toEqual([]);
    const modal = document.querySelector("[data-testid='asset-export-modal']");
    expect(modal).toBeTruthy();
    expect(modal?.textContent).toContain("Export STL");
    expect(modal?.textContent).toContain("Choose a file name and folder.");
    expect(modal?.querySelector("[role='progressbar']")).toBeNull();
    const name = document.querySelector(
      "[data-testid='asset-export-filename']",
    ) as HTMLInputElement;
    const folder = document.querySelector(
      "[data-testid='asset-export-folder']",
    ) as HTMLInputElement;
    expect(name.value).toBe("hero-mesh.stl");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(folder, "/tmp/exports");
      folder.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = document.querySelector(
      "[data-testid='asset-export-confirm']",
    ) as HTMLButtonElement;
    act(() => {
      confirm.click();
    });
    expect(posted.some((row) => row.type === "locus-asset-export" && row.format === "stl")).toBe(
      true,
    );
    expect(posted.some((row) => row.filename === "hero-mesh.stl")).toBe(true);
    expect(document.querySelector("[data-testid='asset-export-modal']")?.textContent).toMatch(
      /Preparing STL/,
    );
    expect(document.querySelector("[role='progressbar']")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "locus-asset-export-progress",
            format: "stl",
            phase: "build",
            percent: 62,
          },
          source: frame!.contentWindow,
        }),
      );
    });
    expect(document.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")).toBe(
      "62",
    );
    expect(document.querySelector("[data-testid='asset-export-modal']")?.textContent).toMatch(
      /Building STL/,
    );
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "locus-asset-export-file",
            format: "stl",
            filename: "hero-mesh.stl",
            mime: "model/stl",
            base64: Buffer.from("solid mesh\n").toString("base64"),
          },
          source: frame!.contentWindow,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.saveHostFile).toHaveBeenCalledWith({
      dir: "/tmp/exports",
      filename: "hero-mesh.stl",
      contentBase64: Buffer.from("solid mesh\n").toString("base64"),
    });
    expect(document.querySelector("[data-testid='asset-export-modal']")?.textContent).toContain(
      "STL export ready",
    );
  });

  it("shows a studio export error after the save-as step", async () => {
    const asset: AgentSession = {
      ...session,
      id: "as1",
      title: "Hero mesh",
      kind: "assets",
    };
    const assetVm = { ...vm, id: "vas1", sessionId: "as1" };
    vi.mocked(api.canvas).mockResolvedValue({
      html: '<html data-tune="head:-45-45"><body><div id="rig"></div></body></html>',
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    render({
      ...initialState,
      section: "assets",
      selectedId: asset.id,
      sessions: [asset],
      vms: [assetVm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const frame = canvasIframe();
    const stl = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Export STL",
    );
    act(() => {
      stl!.click();
    });
    const folder = document.querySelector(
      "[data-testid='asset-export-folder']",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(folder, "/tmp/exports");
      folder.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      (document.querySelector("[data-testid='asset-export-confirm']") as HTMLButtonElement).click();
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "locus-asset-export-progress",
            format: "stl",
            phase: "error",
            percent: 62,
            error: "This studio has no STL exporter yet.",
          },
          source: frame!.contentWindow,
        }),
      );
    });
    expect(document.querySelector("[data-testid='asset-export-modal']")?.textContent).toContain(
      "This studio has no STL exporter yet.",
    );
    const dismiss = [
      ...(document
        .querySelector("[data-testid='asset-export-modal']")
        ?.querySelectorAll("button") ?? []),
    ].find((btn) => btn.textContent === "Dismiss");
    act(() => {
      dismiss!.click();
    });
    expect(document.querySelector("[data-testid='asset-export-modal']")).toBeNull();
  });

  it("hides 3D stage chrome on a 2D sprite studio", async () => {
    const asset: AgentSession = {
      ...session,
      id: "as2",
      title: "Tileset",
      kind: "assets",
      designSystemId: "sprite-pack",
    };
    vi.mocked(api.canvas).mockResolvedValue({
      html: `<html data-locus-asset-mode="2d"><body><div>sprite</div></body></html>`,
      path: "/workspace/index.html",
      mtime: "2020-01-01T00:00:00.000Z",
    });
    render({
      ...initialState,
      section: "assets",
      selectedId: asset.id,
      sessions: [asset],
      vms: [{ ...vm, id: "vas2", sessionId: "as2" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[aria-label='Camera']")).toBeNull();
    expect(host.textContent).not.toContain("Orbit");
    expect(host.textContent).not.toContain("Clay");
    expect(host.textContent).toContain("Texture");
    expect(host.textContent).toContain("Low poly");
    expect(host.textContent).not.toContain("Retopo");
    expect(host.textContent).toContain("Generate");
  });
});
