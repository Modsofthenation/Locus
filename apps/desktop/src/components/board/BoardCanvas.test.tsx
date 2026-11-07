import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardDocument } from "@locus/shared";
import { serializeBoardClipboard } from "@locus/shared";
import { BoardCanvas } from "./BoardCanvas";
import { Store, initialState, type UiState } from "@/state/store";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    addBoardComment: vi.fn(),
    resolveBoardComment: vi.fn(),
    repoPulls: vi.fn().mockResolvedValue([]),
    uploadBoardAsset: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.PointerEvent !== "function") {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type: string, init: MouseEventInit = {}) {
      super(type, init);
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = function () {};
  HTMLElement.prototype.releasePointerCapture = function () {};
}

if (typeof globalThis.ClipboardEvent !== "function") {
  class ClipboardEventPolyfill extends Event {
    clipboardData: {
      getData: (type: string) => string;
      files?: File[];
      items?: Array<{ kind: string; type: string; getAsFile: () => File | null }>;
    };
    constructor(
      type: string,
      init: EventInit & {
        clipboardData?: {
          getData: (type: string) => string;
          files?: File[];
          items?: Array<{ kind: string; type: string; getAsFile: () => File | null }>;
        };
      } = {},
    ) {
      super(type, init);
      this.clipboardData = init.clipboardData ?? { getData: () => "" };
    }
  }
  globalThis.ClipboardEvent = ClipboardEventPolyfill as unknown as typeof ClipboardEvent;
}

const board: BoardDocument = {
  id: "b1",
  title: "Architecture",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  starter: "architecture",
  objects: [
    { id: "f1", type: "frame", x: 40, y: 40, w: 400, h: 240, text: "Context" },
    { id: "s1", type: "sticky", x: 60, y: 80, w: 160, h: 140, text: "API gateway", color: "amber" },
  ],
  comments: [
    {
      id: "c1",
      objectId: "s1",
      body: "Name the owner",
      author: "operator",
      createdAt: "2020-01-01T00:00:00.000Z",
    },
  ],
};

describe("BoardCanvas", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(doc: BoardDocument = board, ui: UiState = initialState) {
    host = document.createElement("div");
    document.body.appendChild(host);
    const onChange = vi.fn();
    const onOpenCite = vi.fn();
    const onRunFrame = vi.fn();
    const onAskLocus = vi.fn();
    act(() => {
      root = createRoot(host);
      root.render(
        <Store.Provider value={{ state: ui, dispatch: vi.fn() }}>
          <BoardCanvas
            board={doc}
            onChange={onChange}
            onOpenCite={onOpenCite}
            onRunFrame={onRunFrame}
            onAskLocus={onAskLocus}
          />
        </Store.Provider>,
      );
    });
    return { onChange, onOpenCite, onRunFrame, onAskLocus };
  }

  function stageRect(stage: HTMLDivElement) {
    stage.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON() {},
      }) as DOMRect;
  }

  function selectSticky(stage: HTMLDivElement) {
    stageRect(stage);
    act(() => {
      stage.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 120,
          clientY: 160,
          pointerId: 1,
          button: 0,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 120, clientY: 160, pointerId: 1 }),
      );
    });
  }

  it("renders frames, stickies, and the run control", () => {
    const { onRunFrame } = render();
    expect(host.querySelector(".board-workspace")).toBeTruthy();
    expect(host.textContent).toContain("Context");
    expect(host.textContent).toContain("API gateway");
    expect(host.querySelector(".board-obj.sticky")).toBeTruthy();
    const run = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Run");
    expect(run).toBeTruthy();
    act(() => {
      run!.click();
    });
    const agent = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "agent");
    expect(agent).toBeTruthy();
    act(() => {
      agent!.click();
    });
    expect(onRunFrame).toHaveBeenCalledWith("f1", "agent");
  });

  it("exposes zoom-to-fit, undo, and frame navigation", () => {
    render();
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Fit")).toBe(
      true,
    );
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Undo")).toBe(
      true,
    );
    const frameNav = host.querySelector(".board-frames");
    expect(frameNav?.textContent).toContain("Context");
    expect(host.querySelector('button[title="Zoom to fit (Ctrl/Cmd+0)"]')).toBeTruthy();
  });

  it("switches tools from keyboard and Escape returns to select", () => {
    render();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    });
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Shape");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    });
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Connector");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Select");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    });
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Mermaid");
  });

  it("presents the first frame on the first J press", () => {
    const twoFrames: BoardDocument = {
      ...board,
      objects: [
        { id: "f1", type: "frame", x: 40, y: 40, w: 400, h: 240, text: "Context" },
        { id: "f2", type: "frame", x: 40, y: 360, w: 400, h: 240, text: "Next" },
        {
          id: "s1",
          type: "sticky",
          x: 60,
          y: 80,
          w: 160,
          h: 140,
          text: "API gateway",
          color: "amber",
        },
      ],
    };
    render(twoFrames);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    });
    expect(host.querySelector("[data-testid='board-present-hint']")?.textContent).toMatch(
      /Presenting frame 1/,
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    });
    expect(host.querySelector("[data-testid='board-present-hint']")?.textContent).toMatch(
      /Presenting frame 2/,
    );
  });

  it("spawns a mind-map child with Tab only when one object is selected", () => {
    const { onChange } = render();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.some((row) => row.type === "connector")).toBe(true);
  });

  it("resolves an open comment from the canvas list", async () => {
    const resolved: BoardDocument = {
      ...board,
      comments: [{ ...board.comments[0]!, resolved: true }],
    };
    vi.mocked(api.resolveBoardComment).mockResolvedValue(resolved);
    const { onChange } = render();
    const resolve = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Resolve",
    );
    expect(resolve).toBeTruthy();
    await act(async () => {
      resolve!.click();
    });
    expect(api.resolveBoardComment).toHaveBeenCalledWith("b1", "c1");
    expect(onChange).toHaveBeenCalledWith(resolved);
  });

  it("pastes copied board objects onto the canvas", () => {
    const { onChange } = render();
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    const payload = serializeBoardClipboard([
      { id: "s2", type: "sticky", x: 20, y: 20, w: 160, h: 140, text: "Pasted", color: "mint" },
    ]);
    const data = {
      getData: (type: string) => (type === "text/plain" ? payload : ""),
    };
    act(() => {
      stage.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          clipboardData: data as unknown as DataTransfer,
        }),
      );
    });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.some((row) => row.text === "Pasted")).toBe(true);
  });

  it("resizes a selected sticky from the se handle", () => {
    const { onChange } = render();
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    expect(host.querySelector(".board-overlay")).toBeTruthy();
    const handle = host.querySelector(".board-resize.se") as HTMLButtonElement;
    expect(handle).toBeTruthy();
    handle.setPointerCapture = vi.fn();
    act(() => {
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 260,
          clientY: 260,
          pointerId: 2,
          button: 0,
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 340,
          clientY: 340,
          pointerId: 2,
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 340, clientY: 340, pointerId: 2 }),
      );
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.find((row) => row.id === "s1")?.w).toBeGreaterThan(160);
  });

  it("asks Locus about the selection from the overlay", () => {
    const { onAskLocus } = render();
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    const ask = host.querySelector(
      '.board-overlay-bar [aria-label="Ask Locus"]',
    ) as HTMLButtonElement | null;
    expect(ask).toBeTruthy();
    expect(ask?.textContent?.trim()).toBe("");
    act(() => {
      ask!.click();
    });
    expect(onAskLocus).toHaveBeenCalled();
    expect(String(onAskLocus.mock.calls[0]?.[0])).toMatch(/API gateway/);
    expect(host.querySelector('.board-overlay-bar [aria-label="Duplicate"]')).toBeTruthy();
    expect(host.querySelector(".board-overlay-bar")?.textContent).not.toMatch(/Duplicate|Cluster/);
    expect(host.querySelector(".board-overlay-bar.below")).toBeNull();
  });

  it("clusters selected stickies into a frame without asking Locus", () => {
    const { onChange, onAskLocus } = render({
      ...board,
      objects: [
        ...board.objects,
        {
          id: "s2",
          type: "sticky",
          x: 300,
          y: 80,
          w: 160,
          h: 140,
          text: "API gateway retry",
          color: "amber",
        },
      ],
    });
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    act(() => {
      stage.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 420,
          clientY: 190,
          pointerId: 3,
          button: 0,
          shiftKey: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 420,
          clientY: 190,
          pointerId: 3,
          shiftKey: true,
        }),
      );
    });
    const cluster = host.querySelector(
      '.board-overlay-bar [aria-label="Cluster stickies"]',
    ) as HTMLButtonElement | null;
    expect(cluster).toBeTruthy();
    act(() => {
      cluster!.click();
    });
    expect(onAskLocus).not.toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    const frame = next.objects.find((row) => row.type === "frame" && row.id !== "f1");
    expect(frame?.text).toBeTruthy();
    expect(next.objects.find((row) => row.id === "s1")?.frameId).toBe(frame?.id);
    expect(next.objects.find((row) => row.id === "s2")?.frameId).toBe(frame?.id);
  });

  it("flips the overlay bar below a selection near the top", () => {
    render({
      ...board,
      objects: [
        {
          id: "s1",
          type: "sticky",
          x: 60,
          y: 0,
          w: 160,
          h: 140,
          text: "API gateway",
          color: "amber",
        },
      ],
    });
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    expect(host.querySelector(".board-overlay-bar.below")).toBeTruthy();
  });

  it("recolors every selected sticky from the overlay", () => {
    const { onChange } = render({
      ...board,
      objects: [
        ...board.objects,
        { id: "s2", type: "sticky", x: 240, y: 80, w: 160, h: 140, text: "Auth", color: "amber" },
      ],
    });
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    act(() => {
      stage.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 360,
          clientY: 190,
          pointerId: 3,
          button: 0,
          shiftKey: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 360,
          clientY: 190,
          pointerId: 3,
          shiftKey: true,
        }),
      );
    });
    const mint = host.querySelector('.board-overlay-bar [aria-label="mint"]') as HTMLButtonElement;
    expect(mint).toBeTruthy();
    act(() => {
      mint.click();
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.find((row) => row.id === "s1")?.color).toBe("mint");
    expect(next.objects.find((row) => row.id === "s2")?.color).toBe("mint");
  });

  it("closes the context menu after Duplicate", () => {
    const { onChange } = render();
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    act(() => {
      stage.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 140, clientY: 180 }),
      );
    });
    expect(document.querySelector(".board-ctx")).toBeTruthy();
    const dup = [...document.querySelectorAll("[role='menuitem']")].find(
      (btn) => btn.textContent === "Duplicate",
    );
    expect(dup).toBeTruthy();
    act(() => {
      (dup as HTMLButtonElement).click();
    });
    expect(document.querySelector(".board-ctx")).toBeNull();
    expect(onChange).toHaveBeenCalled();
  });

  it("layers the selection from the context menu", () => {
    const layered: BoardDocument = {
      ...board,
      objects: [
        ...board.objects,
        { id: "s2", type: "sticky", x: 320, y: 80, w: 160, h: 140, text: "Auth", color: "mint" },
      ],
    };
    const { onChange } = render(layered);
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    act(() => {
      stage.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 140, clientY: 180 }),
      );
    });
    const front = [...document.querySelectorAll("[role='menuitem']")].find(
      (btn) => btn.textContent === "Bring to front",
    );
    expect(front).toBeTruthy();
    act(() => {
      (front as HTMLButtonElement).click();
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.at(-1)?.id).toBe("s1");
  });

  it("renders image objects and connector ports on a single select", () => {
    render({
      ...board,
      objects: [
        ...board.objects,
        {
          id: "img1",
          type: "image",
          x: 280,
          y: 80,
          w: 160,
          h: 120,
          assetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png",
        },
      ],
    });
    const img = host.querySelector(".board-obj.image img") as HTMLImageElement | null;
    expect(img?.getAttribute("src")).toBe(
      "/api/boards/b1/assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png",
    );
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    expect(host.querySelector(".board-port.e")).toBeTruthy();
    expect(host.querySelector(".board-resize.e")).toBeNull();
    expect(host.querySelector(".board-resize.se")).toBeTruthy();
    expect(
      host.querySelector(".board-overlay-bar [aria-label='Duplicate']")?.textContent?.trim(),
    ).toBe("");
  });

  it("spawns a connected sticky from a blue-dot port", () => {
    const { onChange } = render();
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    const port = host.querySelector(".board-port.e") as HTMLButtonElement;
    expect(port).toBeTruthy();
    port.setPointerCapture = vi.fn();
    act(() => {
      port.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 280,
          clientY: 190,
          pointerId: 7,
          button: 0,
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 420,
          clientY: 190,
          pointerId: 7,
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 700, clientY: 500, pointerId: 7 }),
      );
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.some((row) => row.type === "connector" && row.fromId === "s1")).toBe(true);
    expect(next.objects.filter((row) => row.type === "sticky")).toHaveLength(2);
  });

  it("frames a multi-select from the overlay and aligns from the menu", () => {
    const { onChange } = render({
      ...board,
      objects: [
        ...board.objects,
        { id: "s2", type: "sticky", x: 240, y: 80, w: 160, h: 140, text: "Auth", color: "amber" },
      ],
    });
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    act(() => {
      stage.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 360,
          clientY: 190,
          pointerId: 3,
          button: 0,
          shiftKey: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 360,
          clientY: 190,
          pointerId: 3,
          shiftKey: true,
        }),
      );
    });
    expect(host.querySelector(".board-port")).toBeNull();
    const frameBtn = host.querySelector(
      '.board-overlay-bar [aria-label="Frame selection"]',
    ) as HTMLButtonElement | null;
    expect(frameBtn).toBeTruthy();
    expect(frameBtn?.textContent?.trim()).toBe("");
    act(() => {
      stage.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 140, clientY: 180 }),
      );
    });
    const align = [...document.querySelectorAll("[role='menuitem']")].find(
      (btn) => btn.textContent === "Align left",
    );
    expect(align).toBeTruthy();
    act(() => {
      (align as HTMLButtonElement).click();
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.find((row) => row.id === "s1")?.x).toBe(
      next.objects.find((row) => row.id === "s2")?.x,
    );
  });

  it("binds a pasted pull URL to a linked repo", () => {
    const { onChange } = render(board, {
      ...initialState,
      repos: [
        {
          id: "r1",
          name: "app",
          checkout: { url: "https://github.com/acme/app.git", forge: "github" },
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    });
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    act(() => {
      stage.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          clipboardData: {
            getData: (type: string) =>
              type === "text/plain" ? "https://github.com/acme/app/pull/12" : "",
          } as unknown as DataTransfer,
        }),
      );
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    const card = next.objects.find((row) => row.type === "card");
    expect(card?.cite).toMatchObject({ kind: "pull", number: 12, repoId: "r1" });
  });

  it("uploads a pasted image onto the canvas", async () => {
    class FakeImage {
      width = 0;
      height = 0;
      naturalWidth = 0;
      naturalHeight = 0;
      complete = false;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.complete = true;
      }
    }
    const Original = globalThis.Image;
    globalThis.Image = FakeImage as unknown as typeof Image;
    vi.mocked(api.uploadBoardAsset).mockResolvedValue({
      assetId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.png",
      mime: "image/png",
    });
    try {
      const { onChange } = render();
      const stage = host.querySelector(".board-stage") as HTMLDivElement;
      const file = new File([Uint8Array.from([1, 2, 3])], "shot.png", { type: "image/png" });
      await act(async () => {
        stage.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            clipboardData: {
              getData: () => "",
              files: [file],
            } as unknown as DataTransfer,
          }),
        );
        await Promise.resolve();
      });
      expect(api.uploadBoardAsset).toHaveBeenCalledWith("b1", file);
      const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
      expect(
        next.objects.some((row) => row.type === "image" && row.assetId?.endsWith(".png")),
      ).toBe(true);
    } finally {
      globalThis.Image = Original;
    }
  });

  it("sizes a pasted image from its natural dimensions", async () => {
    class FakeImage {
      width = 0;
      height = 0;
      naturalWidth = 0;
      naturalHeight = 0;
      complete = false;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.width = 640;
        this.height = 320;
        this.naturalWidth = 640;
        this.naturalHeight = 320;
        this.complete = true;
      }
    }
    const Original = globalThis.Image;
    globalThis.Image = FakeImage as unknown as typeof Image;
    vi.mocked(api.uploadBoardAsset).mockResolvedValue({
      assetId: "cccccccc-cccc-cccc-cccc-cccccccccccc.png",
      mime: "image/png",
    });
    try {
      const { onChange } = render();
      const stage = host.querySelector(".board-stage") as HTMLDivElement;
      const file = new File([Uint8Array.from([1, 2, 3])], "wide.png", { type: "image/png" });
      await act(async () => {
        stage.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            clipboardData: {
              getData: () => "",
              files: [file],
            } as unknown as DataTransfer,
          }),
        );
        await Promise.resolve();
      });
      const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
      const img = next.objects.find((row) => row.type === "image");
      expect(img?.w).toBe(480);
      expect(img?.h).toBe(240);
    } finally {
      globalThis.Image = Original;
    }
  });

  it("marks a missing session card as stale", () => {
    render({
      ...board,
      objects: [
        ...board.objects,
        {
          id: "card1",
          type: "card",
          x: 280,
          y: 80,
          w: 220,
          h: 72,
          cite: { kind: "agent", sessionId: "gone", label: "Old agent" },
          text: "Old agent",
        },
      ],
    });
    expect(host.querySelector(".board-obj.card.stale")).toBeTruthy();
    expect(host.textContent).toContain("stale");
  });

  it("opens the shape picker and places a hexagon", () => {
    const { onChange } = render();
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    stage.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON() {},
      }) as DOMRect;
    const shapeBtn = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Shape",
    );
    act(() => {
      shapeBtn!.click();
    });
    expect(host.querySelector(".board-shape-pop")).toBeTruthy();
    const hex = host.querySelector('[aria-label="hexagon"]') as HTMLButtonElement;
    act(() => {
      hex.click();
    });
    act(() => {
      stage.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 200,
          clientY: 200,
          pointerId: 9,
          button: 0,
        }),
      );
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.some((row) => row.type === "shape" && row.shape === "hexagon")).toBe(true);
  });

  it("grows sticky text from the overlay", () => {
    const { onChange } = render();
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    const larger = host.querySelector(
      '.board-overlay-bar [aria-label="Larger text"]',
    ) as HTMLButtonElement;
    expect(larger).toBeTruthy();
    act(() => {
      larger.click();
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.find((row) => row.id === "s1")?.fontSize).toBe(16);
  });

  it("renders a table and adds a row", () => {
    const { onChange } = render({
      ...board,
      objects: [
        ...board.objects,
        {
          id: "tbl1",
          type: "table",
          x: 40,
          y: 300,
          w: 400,
          h: 200,
          text: "Table view",
          table: {
            columns: [{ id: "title", name: "Title", kind: "text" }],
            rows: [
              { id: "row-1", cells: { title: "First" } },
              { id: "row-2", cells: {} },
            ],
          },
        },
      ],
    });
    expect(host.textContent).toContain("Table view");
    expect(host.textContent).toContain("First");
    const add = host.querySelector('[aria-label="Add row"]') as HTMLButtonElement;
    act(() => {
      add.click();
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.find((row) => row.id === "tbl1")?.table?.rows).toHaveLength(3);
  });

  it("renders a timeline with task bars", () => {
    render({
      ...board,
      objects: [
        ...board.objects,
        {
          id: "tl1",
          type: "timeline",
          x: 40,
          y: 300,
          w: 500,
          h: 200,
          text: "Timeline view",
          timeline: {
            scale: "weeks",
            items: [
              { id: "i1", title: "First task", start: "2026-09-07", end: "2026-09-21" },
              { id: "i2", title: "Second task", start: "2026-09-14", end: "2026-10-05" },
            ],
          },
        },
      ],
    });
    expect(host.textContent).toContain("Timeline view");
    expect(host.textContent).toContain("First task");
    expect(host.querySelector(".board-timeline-bar")).toBeTruthy();
    expect(host.querySelector('[aria-label="Timeline scale"]')).toBeTruthy();
  });

  it("shows overlay delete for a selected connector", () => {
    const { onChange } = render({
      ...board,
      objects: [
        { id: "f1", type: "frame", x: 40, y: 40, w: 560, h: 240, text: "Lane" },
        { id: "a", type: "sticky", x: 60, y: 80, w: 160, h: 140, text: "A", color: "amber" },
        { id: "b", type: "sticky", x: 400, y: 80, w: 160, h: 140, text: "B", color: "mint" },
        { id: "c1", type: "connector", x: 0, y: 0, w: 0, h: 0, fromId: "a", toId: "b" },
      ],
    });
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    stageRect(stage);
    act(() => {
      stage.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 350,
          clientY: 190,
          pointerId: 1,
          button: 0,
        }),
      );
    });
    expect(host.querySelector(".board-overlay")).toBeTruthy();
    expect(host.querySelector(".board-overlay-size")?.textContent).toMatch(/Connector/);
    const del = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Delete",
    );
    expect(del).toBeTruthy();
    act(() => {
      del!.click();
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.some((row) => row.id === "c1")).toBe(false);
    expect(next.objects.some((row) => row.id === "a")).toBe(true);
    expect(next.objects.some((row) => row.id === "f1")).toBe(true);
  });

  it("deletes a selected connector with the Delete key", () => {
    const { onChange } = render({
      ...board,
      objects: [
        { id: "a", type: "sticky", x: 60, y: 80, w: 160, h: 140, text: "A", color: "amber" },
        { id: "b", type: "sticky", x: 400, y: 80, w: 160, h: 140, text: "B", color: "mint" },
        { id: "c1", type: "connector", x: 0, y: 0, w: 0, h: 0, fromId: "a", toId: "b" },
      ],
    });
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    stageRect(stage);
    act(() => {
      stage.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 350,
          clientY: 190,
          pointerId: 1,
          button: 0,
        }),
      );
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.some((row) => row.id === "c1")).toBe(false);
    expect(next.objects.some((row) => row.id === "a")).toBe(true);
  });

  it("draws an ink stroke with the Draw tool", () => {
    const { onChange } = render();
    const draw = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Draw");
    expect(draw).toBeTruthy();
    act(() => {
      draw!.click();
    });
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    stageRect(stage);
    act(() => {
      stage.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 120,
          clientY: 160,
          pointerId: 3,
          button: 0,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 140,
          clientY: 170,
          pointerId: 3,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 160,
          clientY: 210,
          pointerId: 3,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 180,
          clientY: 200,
          pointerId: 3,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 180, clientY: 200, pointerId: 3 }),
      );
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(
      next.objects.some((row) => row.type === "ink" && (row.ink?.points.length ?? 0) >= 3),
    ).toBe(true);
    expect(host.querySelector(".board-toolbar button[aria-pressed='true']")?.textContent).toBe(
      "Draw",
    );
  });

  it("stacks stickies from the overlay", () => {
    const { onChange } = render({
      ...board,
      objects: [
        ...board.objects,
        { id: "s2", type: "sticky", x: 240, y: 80, w: 160, h: 140, text: "Auth", color: "amber" },
      ],
    });
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    act(() => {
      stage.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 360,
          clientY: 190,
          pointerId: 3,
          button: 0,
          shiftKey: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 360,
          clientY: 190,
          pointerId: 3,
          shiftKey: true,
        }),
      );
    });
    const stackBtn = host.querySelector(
      '.board-overlay-bar [aria-label="Stack stickies"]',
    ) as HTMLButtonElement | null;
    expect(stackBtn).toBeTruthy();
    act(() => {
      stackBtn!.click();
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    const a = next.objects.find((row) => row.id === "s1");
    const b = next.objects.find((row) => row.id === "s2");
    expect(a?.stackId).toBeTruthy();
    expect(b?.stackId).toBe(a?.stackId);
    expect(b?.x).toBe((a?.x ?? 0) + 8);
    expect(b?.y).toBe((a?.y ?? 0) + 8);
  });

  it("selects a sticky stack together and unstacks from the overlay", () => {
    const { onChange } = render({
      ...board,
      objects: [
        board.objects[0]!,
        {
          id: "s1",
          type: "sticky",
          x: 60,
          y: 80,
          w: 160,
          h: 140,
          text: "API gateway",
          color: "amber",
          stackId: "pack",
          z: 0,
        },
        {
          id: "s2",
          type: "sticky",
          x: 68,
          y: 88,
          w: 160,
          h: 140,
          text: "Auth",
          color: "amber",
          stackId: "pack",
          z: 1,
        },
      ],
    });
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    selectSticky(stage);
    expect(host.querySelectorAll(".board-obj.sticky.stacked")).toHaveLength(2);
    expect(host.querySelector(".board-overlay-size")?.textContent).toMatch(/Stack · 2/);
    expect(host.querySelector('.board-overlay-bar [aria-label="Stack stickies"]')).toBeNull();
    const unstack = host.querySelector(
      '.board-overlay-bar [aria-label="Unstack"]',
    ) as HTMLButtonElement | null;
    expect(unstack).toBeTruthy();
    act(() => {
      unstack!.click();
    });
    const next = onChange.mock.calls.at(-1)?.[0] as BoardDocument;
    expect(next.objects.find((row) => row.id === "s1")?.stackId).toBeUndefined();
    expect(next.objects.find((row) => row.id === "s2")?.stackId).toBeUndefined();
    expect(next.objects.find((row) => row.id === "s2")?.x).toBe(240);
  });
});
