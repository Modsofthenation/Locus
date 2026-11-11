import { act, useReducer, type Dispatch, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { HOST_TERM_COLLAPSED_KEY, HostWorkspace } from "./HostWorkspace";
import {
  HOST_TERM_SPLIT_DEFAULT,
  HOST_TERM_SPLIT_KEY,
  TERM_SPLIT_MAX,
  TERM_SPLIT_MIN,
} from "./TermSplit";
import { api } from "@/lib/api";
import { Store, initialState, reducer, type Action, type UiState } from "@/state/store";

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

vi.mock("@/lib/api", () => ({
  api: {
    workspaceTree: vi.fn(async () => ({
      entries: [
        { name: "manage.py", path: "manage.py", type: "file" as const },
        { name: "views.py", path: "blog/views.py", type: "file" as const },
      ],
    })),
    workspaceFile: vi.fn(),
    saveWorkspaceFile: vi.fn(),
    mkdirWorkspace: vi.fn(),
    deleteWorkspaceFile: vi.fn(),
    sessionPreview: vi.fn(async () => ({ ports: [] })),
    patchSession: vi.fn(async (id: string) => ({ ...session, id })),
    previewHttpUrl: () => "/preview",
    dockerContainers: vi.fn(async () => ({ kind: "mock", containers: [] })),
    dockerContainerAction: vi.fn(),
  },
  workspaceTerminalWsUrl: (id: string) => `ws://127.0.0.1/workspace-pty/${id}`,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = { disableStdin: false };
    loadAddon() {}
    open() {}
    write() {}
    writeln() {}
    dispose() {}
    blur() {}
    focus() {}
    onData() {
      return { dispose() {} };
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

class FakeWebSocket {
  binaryType = "arraybuffer";
  readyState = 1;
  send() {}
  close() {}
}

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: AgentSession = {
  id: "s1",
  title: "Host app",
  os: "ubuntu",
  templateId: "host",
  runtime: "host",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("HostWorkspace", () => {
  let host: HTMLDivElement;
  let root: Root;
  const previousWs = globalThis.WebSocket;
  const previousRo = globalThis.ResizeObserver;

  beforeEach(() => {
    localStorage.removeItem(HOST_TERM_COLLAPSED_KEY);
    localStorage.removeItem(HOST_TERM_SPLIT_KEY);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    globalThis.WebSocket = previousWs;
    globalThis.ResizeObserver = previousRo;
  });

  function render(state: UiState) {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Harness({ children }: { children: ReactNode }) {
      const [current, dispatch] = useReducer(reducer, state);
      return (
        <Store.Provider value={{ state: current, dispatch: dispatch as Dispatch<Action> }}>
          {children}
        </Store.Provider>
      );
    }
    act(() => {
      root.render(
        <Harness>
          <HostWorkspace />
        </Harness>,
      );
    });
  }

  it("opens the host Files editor", async () => {
    render({
      ...initialState,
      vmCollapsed: false,
      selectedId: session.id,
      sessions: [session],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/Files/);
    expect(host.textContent).toMatch(/Browser/);
    expect(host.textContent).toMatch(/EXPLORER/);
    expect(host.textContent).toMatch(/manage\.py/);
    expect(host.querySelector("[data-project]")?.textContent).toBe("Django");
    expect(api.workspaceTree).toHaveBeenCalledWith("s1", "", 1);
    expect(host.querySelector('[title="Collapse files"]')).toBeTruthy();
    const fsBtn = host.querySelector('[data-testid="workspace-fullscreen"]') as HTMLButtonElement;
    expect(fsBtn).toBeTruthy();
    expect(fsBtn.getAttribute("aria-label")).toBe("Full screen files");
    await act(async () => {
      fsBtn.click();
    });
    expect(host.querySelector(".vm-pane.workspace-fs")).toBeTruthy();
    expect(fsBtn.getAttribute("aria-label")).toBe("Exit full screen");
    expect(fsBtn.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[title="Collapse files"]')).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector(".vm-pane.workspace-fs")).toBeNull();
    expect(fsBtn.getAttribute("aria-label")).toBe("Full screen files");
  });

  it("keeps the editor open in the IDE section and hides the files collapse control", async () => {
    render({
      ...initialState,
      section: "ide",
      selectedId: session.id,
      sessions: [{ ...session, kind: "ide" }],
      vmCollapsed: true,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-editor-slot")).toBeTruthy();
    expect(host.querySelector('[title="Collapse files"]')).toBeNull();
    expect(host.querySelector('[data-testid="workspace-fullscreen"]')).toBeTruthy();
    expect(host.querySelector(".vm-pane.rail")).toBeNull();
  });

  it("opens the workspace terminal from its bottom panel tab", async () => {
    render({
      ...initialState,
      section: "ide",
      selectedId: session.id,
      sessions: [{ ...session, kind: "ide" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='workspace-terminal']")).toBeNull();
    expect(host.querySelector(".docker-ide-tabs")?.textContent).not.toContain("Terminal");
    const toggle = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Terminal",
    );
    expect(toggle?.closest(".term-tabs")).toBeTruthy();
    await act(async () => {
      toggle!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='workspace-terminal']")).toBeTruthy();
    expect(host.querySelector(".host-term.collapsed")).toBeNull();
    const add = host.querySelector('[aria-label="New terminal"]') as HTMLButtonElement;
    expect(add).toBeTruthy();
    await act(async () => {
      add.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelectorAll("[data-testid='workspace-terminal']").length).toBe(2);
    const firstTab = [...host.querySelectorAll(".term-tabs button")].find(
      (btn) => btn.textContent === "Terminal",
    );
    await act(async () => {
      (firstTab as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(host.querySelectorAll("[data-testid='workspace-terminal']").length).toBe(2);
    expect(host.querySelectorAll(".host-term-pane[hidden]").length).toBe(1);
    expect(
      host.querySelectorAll("[data-testid='workspace-terminal'][data-active='1']").length,
    ).toBe(1);
    expect(
      host.querySelectorAll("[data-testid='workspace-terminal'][data-active='0']").length,
    ).toBe(1);
    const collapse = host.querySelector('[aria-label="Collapse terminal"]') as HTMLButtonElement;
    await act(async () => {
      collapse.click();
      await Promise.resolve();
    });
    expect(
      host.querySelectorAll("[data-testid='workspace-terminal'][data-active='1']").length,
    ).toBe(0);
  });

  it("lets you pick a host preview port", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({
      ports: [3000, 5173],
      active: { port: 3000, path: "/", url: "http://127.0.0.1:3000/" },
    });
    render({
      ...initialState,
      section: "ide",
      selectedId: session.id,
      sessions: [{ ...session, kind: "ide" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const more = host.querySelector(".host-workspace-more summary") as HTMLElement;
    expect(more).toBeTruthy();
    await act(async () => {
      more.click();
      await Promise.resolve();
    });
    const preview = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.startsWith("Preview"),
    ) as HTMLElement | undefined;
    expect(preview).toBeTruthy();
    await act(async () => {
      preview!.click();
      await Promise.resolve();
    });
    const select = host.querySelector('[aria-label="Preview port"]') as HTMLElement;
    expect(select).toBeTruthy();
    expect(select.closest("[data-value]")?.getAttribute("data-value")).toBe("3000");
    await act(async () => {
      select.click();
      await Promise.resolve();
    });
    const next = [...host.querySelectorAll(".menu-item")].find(
      (btn) => btn.getAttribute("data-value") === "5173",
    ) as HTMLElement | undefined;
    await act(async () => {
      next?.click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", { preview: { port: 5173, path: "/" } });
  });

  async function expandTerminal() {
    const toggle = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Terminal",
    );
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function desktopEl(): HTMLElement {
    const desktop = host.querySelector(".docker-desktop") as HTMLElement;
    desktop.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 600,
        right: 800,
        width: 800,
        height: 600,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    return desktop;
  }

  it("exposes a draggable gutter above the terminal", async () => {
    render({
      ...initialState,
      section: "ide",
      selectedId: session.id,
      sessions: [{ ...session, kind: "ide" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const gutter = host.querySelector(".term-gutter") as HTMLDivElement;
    expect(gutter).toBeTruthy();
    expect(gutter.getAttribute("role")).toBe("separator");
    expect(gutter.getAttribute("aria-orientation")).toBe("horizontal");
    expect(gutter.getAttribute("aria-label")).toBe("Resize terminal");
    expect(gutter.getAttribute("aria-hidden")).toBe("true");
    expect(gutter.tabIndex).toBe(-1);
    await expandTerminal();
    expect(gutter.getAttribute("aria-hidden")).toBeNull();
    expect(gutter.tabIndex).toBe(0);
    expect((host.querySelector(".docker-desktop") as HTMLElement).style.gridTemplateRows).toMatch(
      new RegExp(`minmax\\(120px, ${HOST_TERM_SPLIT_DEFAULT}fr\\)$`),
    );
  });

  it("resizes the terminal from the gutter and remembers the split", async () => {
    render({
      ...initialState,
      section: "ide",
      selectedId: session.id,
      sessions: [{ ...session, kind: "ide" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await expandTerminal();
    const gutter = host.querySelector(".term-gutter") as HTMLDivElement;
    desktopEl();
    act(() => {
      gutter.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientY: 400, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientY: 340, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientY: 340, pointerId: 1 }),
      );
    });
    expect((host.querySelector(".docker-desktop") as HTMLElement).style.gridTemplateRows).toMatch(
      /minmax\(120px, 0\.42fr\)$/,
    );
    expect(localStorage.getItem(HOST_TERM_SPLIT_KEY)).toBe("0.42");
  });

  it("resizes the terminal from the tab bar and with arrow keys", async () => {
    render({
      ...initialState,
      section: "ide",
      selectedId: session.id,
      sessions: [{ ...session, kind: "ide" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await expandTerminal();
    const tabs = host.querySelector(".term-tabs") as HTMLDivElement;
    desktopEl();
    act(() => {
      tabs.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientY: 400, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientY: 460, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientY: 460, pointerId: 1 }),
      );
    });
    expect((host.querySelector(".docker-desktop") as HTMLElement).style.gridTemplateRows).toMatch(
      /minmax\(120px, 0\.22fr\)$/,
    );
    const gutter = host.querySelector(".term-gutter") as HTMLDivElement;
    act(() => {
      gutter.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    });
    expect((host.querySelector(".docker-desktop") as HTMLElement).style.gridTemplateRows).toMatch(
      /minmax\(120px, 0\.25fr\)$/,
    );
    expect(localStorage.getItem(HOST_TERM_SPLIT_KEY)).toBe("0.25");
    act(() => {
      gutter.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    });
    expect((host.querySelector(".docker-desktop") as HTMLElement).style.gridTemplateRows).toMatch(
      new RegExp(`minmax\\(120px, ${TERM_SPLIT_MIN}fr\\)$`),
    );
    act(() => {
      gutter.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    expect((host.querySelector(".docker-desktop") as HTMLElement).style.gridTemplateRows).toMatch(
      new RegExp(`minmax\\(120px, ${TERM_SPLIT_MAX}fr\\)$`),
    );
    expect(localStorage.getItem(HOST_TERM_SPLIT_KEY)).toBe(String(TERM_SPLIT_MAX));
  });
});
