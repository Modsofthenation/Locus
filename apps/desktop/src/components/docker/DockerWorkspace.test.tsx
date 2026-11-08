import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, useReducer, type Dispatch, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, VmInstance } from "@locus/shared";
import { DOCKER_TERM_COLLAPSED_KEY, DockerWorkspace } from "./DockerWorkspace";
import { DOCKER_TERM_SPLIT_DEFAULT, DOCKER_TERM_SPLIT_KEY } from "@/components/workspace/TermSplit";
import { api } from "@/lib/api";
import { Store, initialState, reducer, type Action, type UiState } from "@/state/store";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

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
    sessionPreview: vi.fn(),
    sessionIde: vi.fn(async () => ({ url: null as string | null })),
    previewHttpUrl: (id: string, port: number, path = "/") =>
      `/api/sessions/${id}/preview-http/${port}${path.startsWith("/") ? path : `/${path}`}`,
    patchSession: vi.fn(),
    execTool: vi.fn(),
    vmLogs: vi.fn(async () => ({ text: "" })),
    shareFiles: vi.fn(async () => ({ files: [] })),
    captureImage: vi.fn(),
    rewind: vi.fn(),
    workspaceTree: vi.fn(async () => ({ entries: [] })),
    workspaceFile: vi.fn(),
    saveWorkspaceFile: vi.fn(),
    mkdirWorkspace: vi.fn(),
    deleteWorkspaceFile: vi.fn(),
    designComment: vi.fn(),
    dockerContainerStats: vi.fn(),
  },
  browserWsUrl: (id: string) => `ws://browser.test/ws/browser/${id}`,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: AgentSession = {
  id: "s1",
  title: "Web app",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  runtime: "docker",
  dockerImage: "node:22-bookworm",
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
  sessionId: "s1",
  templateId: "ubuntu-24.04",
  os: "ubuntu",
  name: "node",
  status: "ready",
  runtime: "docker",
  dockerImage: "node:22-bookworm",
  diskPath: "/tmp/ws",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("DockerWorkspace preview", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.removeItem(DOCKER_TERM_COLLAPSED_KEY);
    localStorage.removeItem(DOCKER_TERM_SPLIT_KEY);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.removeItem(DOCKER_TERM_COLLAPSED_KEY);
    vi.mocked(api.sessionPreview).mockReset();
    vi.mocked(api.sessionIde).mockReset();
    vi.mocked(api.workspaceTree).mockReset();
    vi.mocked(api.workspaceTree).mockResolvedValue({ entries: [] });
    vi.mocked(api.workspaceFile).mockReset();
    vi.mocked(api.dockerContainerStats).mockReset();
  });

  function render(state: UiState, dispatch: (action: Action) => void = () => undefined) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider value={{ state: { ...state, vmCollapsed: false }, dispatch }}>
        <DockerWorkspace />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("shows the host workspace tree until a port is listening", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).toMatch(/\/workspace/);
    expect(host.textContent).toMatch(/SHELL/);
    expect(host.textContent).toMatch(/LOGS/);
    expect(host.textContent).toMatch(/STATS/);
    expect(host.textContent).toMatch(/turn 1 • runs in container, not on host/);
    expect(host.textContent).toMatch(/-> \/workspace/);
    expect(host.textContent).toMatch(/node 22/);
    expect(api.workspaceTree).toHaveBeenCalledWith("s1", "", 1);
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Desktop")).toBe(
      false,
    );
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Preview")).toBe(
      false,
    );
    expect(
      [...host.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Files")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Browser")).toBe(
      true,
    );
    const fsBtn = host.querySelector('[data-testid="workspace-fullscreen"]') as HTMLButtonElement;
    expect(fsBtn).toBeTruthy();
    expect(fsBtn.getAttribute("aria-label")).toBe("Full screen files");
    await act(async () => {
      fsBtn.click();
    });
    expect(host.querySelector(".vm-pane.workspace-fs")).toBeTruthy();
    expect(fsBtn.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fsBtn.click();
    });
    expect(host.querySelector(".vm-pane.workspace-fs")).toBeNull();
  });

  it("paints the selected shell tab with terminal foreground on the term pane", () => {
    expect(css).toMatch(
      /\.term\.docker-term \.term-tabs button\.active,[\s\S]*?color:\s*var\(--term-fg\)/,
    );
    expect(css).toMatch(
      /\.term\.docker-term \.term-tabs button\.active,[\s\S]*?-webkit-text-fill-color:\s*var\(--term-fg\)/,
    );
    expect(css).toMatch(
      /\.term\.docker-term \.term-tabs button\.active,[\s\S]*?box-shadow:\s*inset 0 -1px 0 var\(--term-fg\)/,
    );
    expect(css).toMatch(
      /\.docker-term \.term-tabs button \{[\s\S]*?-webkit-text-fill-color:\s*color-mix\(in srgb, var\(--term-fg\)/,
    );
    expect(css).toMatch(/\.term-log \.log-blob > summary \{[\s\S]*?color:\s*var\(--term-fg\)/);
    expect(css).toMatch(
      /\.docker-term \.term-ok \{[\s\S]*?color:\s*color-mix\(in srgb, var\(--ok\) 50%, var\(--term-fg\)/,
    );
    expect(css).toMatch(
      /\.docker-term \.term-err \{[\s\S]*?color:\s*color-mix\(in srgb, var\(--danger\) 50%, var\(--term-fg\)/,
    );
  });

  it("lets the stopped container card fill a narrow preview pane", () => {
    expect(css).toMatch(/\.docker-desktop \.chrome \{[\s\S]*?max-width:\s*none/);
    expect(css).toMatch(/\.desktop \.spec \{[\s\S]*?white-space:\s*pre-wrap/);
    expect(css).toMatch(/\.desktop \.spec \{[\s\S]*?overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.vm-pane \{[\s\S]*?width:\s*100%/);
    expect(css).toMatch(/\.docker-term-main \{[\s\S]*?width:\s*100%/);
  });

  it("starts the shell prompt at the top of the terminal pane", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const pane = host.querySelector(".docker-term .term-log");
    const prompt = host.querySelector(".docker-term form.term-input");
    expect(pane).toBeTruthy();
    expect(prompt).toBeTruthy();
    expect(host.querySelector(".docker-term > form.term-input")).toBeNull();
    expect(pane?.contains(prompt)).toBe(true);
    expect(pane?.firstElementChild).toBe(prompt);
  });

  it("collapses the shell pane so the workspace editor can grow", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const collapse = host.querySelector(".term-collapse");
    expect(collapse?.getAttribute("aria-expanded")).toBe("true");
    expect(collapse?.getAttribute("aria-label")).toBe("Collapse shell");
    expect(host.querySelector(".docker-term")?.classList.contains("collapsed")).toBe(false);
    expect(host.querySelector(".docker-term .term-log")).toBeTruthy();
    expect(host.querySelector(".workspace-editor")).toBeTruthy();
    act(() => {
      (collapse as HTMLButtonElement).click();
    });
    expect(host.querySelector(".docker-term")?.classList.contains("collapsed")).toBe(true);
    expect(host.querySelector(".docker-term .term-log")).toBeNull();
    expect(host.querySelector(".workspace-editor")).toBeTruthy();
    expect(host.textContent).toMatch(/SHELL/);
    expect(host.textContent).toMatch(/LOGS/);
    expect(host.textContent).toMatch(/STATS/);
    expect(host.textContent).not.toMatch(/-> \/workspace/);
    expect(collapse?.getAttribute("aria-expanded")).toBe("false");
    expect(collapse?.getAttribute("aria-label")).toBe("Expand shell");
    expect(localStorage.getItem(DOCKER_TERM_COLLAPSED_KEY)).toBe("1");
    act(() => {
      (collapse as HTMLButtonElement).click();
    });
    expect(host.querySelector(".docker-term")?.classList.contains("collapsed")).toBe(false);
    expect(host.querySelector(".docker-term .term-log")).toBeTruthy();
    expect(host.textContent).toMatch(/-> \/workspace/);
    expect(collapse?.getAttribute("aria-label")).toBe("Collapse shell");
    expect(localStorage.getItem(DOCKER_TERM_COLLAPSED_KEY)).toBe("0");
  });

  it("resizes the shell from the gutter above the tab bar", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const gutter = host.querySelector(".term-gutter") as HTMLDivElement;
    expect(gutter).toBeTruthy();
    expect(gutter.getAttribute("aria-label")).toBe("Resize terminal");
    const split = host.querySelector(".docker-term-split") as HTMLElement;
    expect(split.style.gridTemplateRows).toMatch(
      new RegExp(`minmax\\(120px, ${DOCKER_TERM_SPLIT_DEFAULT}fr\\)$`),
    );
    split.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 500,
        right: 800,
        width: 800,
        height: 500,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    act(() => {
      gutter.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientY: 300, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientY: 250, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientY: 250, pointerId: 1 }),
      );
    });
    expect(split.style.gridTemplateRows).toMatch(/minmax\(120px, 0\.5fr\)$/);
    expect(localStorage.getItem(DOCKER_TERM_SPLIT_KEY)).toBe("0.5");
  });

  it("expands the collapsed shell when a tab is selected", async () => {
    localStorage.setItem(DOCKER_TERM_COLLAPSED_KEY, "1");
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    vi.mocked(api.dockerContainerStats).mockResolvedValue({
      id: "cid1",
      name: "node",
      cpuPercent: 2.69,
      memoryPercent: 0,
      memoryUsage: "8.348MiB",
      memoryLimit: "60.53GiB",
      networkRx: "12.5kB",
      networkTx: "126B",
      blockRead: "52.8MB",
      blockWrite: "36.9kB",
      pids: 3,
      running: true,
      sampledAt: "2020-01-01T00:00:00.000Z",
    });
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".docker-term")?.classList.contains("collapsed")).toBe(true);
    expect(host.querySelector(".docker-stats")).toBeNull();
    const statsTab = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "STATS",
    );
    act(() => {
      statsTab!.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".docker-term")?.classList.contains("collapsed")).toBe(false);
    expect(host.querySelector(".docker-stats")).toBeTruthy();
    expect(host.textContent).toMatch(/8\.348MiB/);
    expect(localStorage.getItem(DOCKER_TERM_COLLAPSED_KEY)).toBe("0");
  });

  it("restores a collapsed shell from localStorage", async () => {
    localStorage.setItem(DOCKER_TERM_COLLAPSED_KEY, "1");
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".docker-term.collapsed")).toBeTruthy();
    expect(host.querySelector(".docker-term .term-log")).toBeNull();
    expect(host.querySelector(".workspace-editor")).toBeTruthy();
    expect(host.querySelector(".term-collapse")?.getAttribute("aria-label")).toBe("Expand shell");
  });

  it("stacks live Preview under Files when a port is listening", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({
      ports: [5173],
      active: { port: 5173, path: "/", url: "/api/sessions/s1/preview-http/5173/" },
    });
    vi.mocked(api.workspaceTree).mockResolvedValue({
      entries: [{ name: "app.ts", path: "app.ts", type: "file" }],
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, preview: { port: 5173 } }],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("iframe")?.getAttribute("title")).toBe("App preview :5173");
    expect(host.textContent).toMatch(/app\.ts/);
    expect(host.querySelector(".docker-desktop")?.className).toMatch(/has-editor/);
    expect(host.querySelector(".docker-desktop")?.className).toMatch(/has-preview/);
    expect(
      [...host.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Files")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    const preview = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Preview",
    );
    expect(preview?.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the guest Chromium pane from the Browser tab", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const browser = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Browser",
    );
    expect(browser).toBeTruthy();
    act(() => {
      browser!.click();
    });
    expect(host.querySelector(".browser-pane")).toBeTruthy();
    expect(host.querySelector('input[aria-label="Page URL"]')).toBeTruthy();
    expect(host.textContent).toMatch(/Agent/);
    expect(host.textContent).toMatch(/Take over browser/);
    expect(browser?.getAttribute("aria-pressed")).toBe("true");
  });

  it("switches to Browser when the agent clicks in Chromium", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
      overlay: { sessionId: session.id, name: "mouse_click", x: 640, y: 400 },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".browser-pane")).toBeTruthy();
    expect(
      [...host.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Browser")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("renders a live app iframe with viewport toggles", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({
      ports: [5173],
      active: { port: 5173, path: "/", url: "/api/sessions/s1/preview-http/5173/" },
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, preview: { port: 5173 } }],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const preview = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Preview",
    );
    expect(preview).toBeTruthy();
    act(() => {
      preview!.click();
    });
    const frame = host.querySelector("iframe");
    expect(frame?.getAttribute("title")).toBe("App preview :5173");
    expect(frame?.getAttribute("src")).toBe("/api/sessions/s1/preview-http/5173/");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-modals");
    expect(host.querySelector(".design-frame")?.getAttribute("data-viewport")).toBe("desktop");
    const phone = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Phone");
    expect(phone).toBeTruthy();
    act(() => {
      phone!.click();
    });
    expect(host.querySelector(".design-frame")?.getAttribute("data-viewport")).toBe("phone");
    const comment = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Comment",
    );
    expect(comment).toBeTruthy();
    act(() => {
      comment!.click();
    });
    expect(host.querySelector("iframe")?.getAttribute("src")).toBe(
      "/api/sessions/s1/preview-http/5173/?locus_pick=1",
    );
  });

  it("still shows a live app preview for locus/agent when Preview is selected", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({
      ports: [5173],
      active: { port: 5173, path: "/", url: "/api/sessions/s1/preview-http/5173/" },
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, dockerImage: "locus/agent", preview: { port: 5173 } }],
      vms: [{ ...vm, dockerImage: "locus/agent" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const preview = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Preview",
    );
    act(() => {
      preview!.click();
    });
    expect(host.querySelector("iframe")?.getAttribute("title")).toBe("App preview :5173");
    expect(host.querySelector(".docker-desktop")).toBeTruthy();
  });

  it("opens the host workspace editor", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const files = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Files");
    expect(files).toBeTruthy();
    act(() => {
      files!.click();
    });
    expect(host.textContent).toMatch(/\/workspace/);
    expect(api.workspaceTree).toHaveBeenCalledWith("s1", "", 1);
  });

  it("shows the host workspace tree for locus/agent instead of a code-server iframe", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    vi.mocked(api.workspaceTree).mockClear();
    vi.mocked(api.workspaceTree).mockResolvedValue({
      entries: [{ name: "README.md", path: "README.md", type: "file" }],
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, dockerImage: "locus/agent" }],
      vms: [{ ...vm, dockerImage: "locus/agent", containerId: "cid1" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.sessionIde).not.toHaveBeenCalled();
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector(".docker-desktop")).toBeTruthy();
    const files = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Files");
    expect(files?.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toMatch(/\/workspace/);
    expect(host.textContent).toMatch(/README\.md/);
    expect(host.textContent).toMatch(/EXPLORER/);
    expect(host.textContent).toMatch(/This folder/);
    expect(api.workspaceTree).toHaveBeenCalledWith("s1", "", 1);
  });

  it("labels worker Files as a worker folder", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    vi.mocked(api.workspaceTree).mockResolvedValue({
      entries: [{ name: "README.md", path: "README.md", type: "file" }],
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, placement: "worker", backendId: "w1", dockerImage: "locus/agent" }],
      vms: [{ ...vm, dockerImage: "locus/agent", containerId: "cid1", backendId: "w1" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/Worker folder/);
  });

  it("keeps Files visible when Preview is selected on locus/agent", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({
      ports: [5173],
      active: { port: 5173, path: "/", url: "/api/sessions/s1/preview-http/5173/" },
    });
    vi.mocked(api.workspaceTree).mockResolvedValue({
      entries: [{ name: "app.ts", path: "app.ts", type: "file" }],
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, dockerImage: "locus/agent", preview: { port: 5173 } }],
      vms: [{ ...vm, dockerImage: "locus/agent", containerId: "cid1" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("iframe")?.getAttribute("title")).toBe("App preview :5173");
    expect(host.textContent).toMatch(/app\.ts/);
    const files = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Files");
    const preview = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Preview",
    );
    expect(files?.getAttribute("aria-pressed")).toBe("true");
    expect(preview?.getAttribute("aria-pressed")).toBe("true");
    act(() => {
      preview!.click();
    });
    expect(host.querySelector("iframe")?.getAttribute("title")).toBe("App preview :5173");
    expect(host.textContent).toMatch(/app\.ts/);
    expect(files?.getAttribute("aria-pressed")).toBe("true");
    act(() => {
      files!.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("iframe")?.getAttribute("title")).toBe("App preview :5173");
    expect(host.textContent).toMatch(/app\.ts/);
    expect(files?.getAttribute("aria-pressed")).toBe("true");
  });

  it("hides stacked Files and Preview when Browser is selected", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({
      ports: [5173],
      active: { port: 5173, path: "/", url: "/api/sessions/s1/preview-http/5173/" },
    });
    vi.mocked(api.workspaceTree).mockResolvedValue({
      entries: [{ name: "app.ts", path: "app.ts", type: "file" }],
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, preview: { port: 5173 } }],
      vms: [vm],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="workspace-fullscreen"]')).toBeTruthy();
    const browser = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Browser",
    );
    act(() => {
      browser!.click();
    });
    expect(host.querySelector(".browser-pane")).toBeTruthy();
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector(".workspace-editor-slot")?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector('[data-testid="workspace-fullscreen"]')).toBeNull();
  });

  it("shows live CPU and memory in the STATS tab", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    vi.mocked(api.dockerContainerStats).mockResolvedValue({
      id: "cid1",
      name: "node",
      cpuPercent: 12.4,
      memoryPercent: 8.2,
      memoryUsage: "86.2MiB",
      memoryLimit: "7.7GiB",
      networkRx: "1.2MB",
      networkTx: "340kB",
      blockRead: "24.1MB",
      blockWrite: "8.2MB",
      pids: 14,
      running: true,
      sampledAt: "2020-01-01T00:00:00.000Z",
    });
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const statsTab = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "STATS",
    );
    expect(statsTab).toBeTruthy();
    act(() => {
      statsTab!.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/CPU, memory, and I\/O from docker stats/);
    expect(host.textContent).toMatch(/Live/);
    expect(host.textContent).toMatch(/CPU/);
    expect(host.textContent).toMatch(/12\.40%/);
    expect(host.textContent).toMatch(/86\.2MiB \/ 7\.7GiB/);
    expect(host.textContent).toMatch(/Net I\/O/);
    expect(host.textContent).toMatch(/1\.2MB \/ 340kB/);
    expect(host.textContent).toMatch(/PIDs/);
    expect(host.textContent).toMatch(/14/);
    expect(statsTab?.getAttribute("type")).toBe("button");
    expect(statsTab?.getAttribute("aria-pressed")).toBe("true");
    expect(api.dockerContainerStats).toHaveBeenCalledWith("v1");
  });

  it("keeps the last stats sample when a later poll fails", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
      vi.mocked(api.dockerContainerStats)
        .mockResolvedValueOnce({
          id: "cid1",
          name: "node",
          cpuPercent: 12.4,
          memoryPercent: 8.2,
          memoryUsage: "86.2MiB",
          memoryLimit: "7.7GiB",
          networkRx: "1.2MB",
          networkTx: "340kB",
          blockRead: "24.1MB",
          blockWrite: "8.2MB",
          pids: 14,
          running: true,
          sampledAt: "2020-01-01T00:00:00.000Z",
        })
        .mockRejectedValue(new Error("docker stats failed"));
      render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const statsTab = [...host.querySelectorAll("button")].find(
        (btn) => btn.textContent === "STATS",
      );
      act(() => {
        statsTab!.click();
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(host.textContent).toMatch(/12\.40%/);
      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(host.textContent).toMatch(/12\.40%/);
      expect(host.textContent).toMatch(/docker stats failed/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides preview chrome and container tools when no container is running", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({
      ports: [3000],
      active: { port: 3000, path: "/", url: "/api/sessions/s1/preview-http/3000/" },
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, preview: { port: 3000 }, vmId: undefined }],
      vms: [],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).toMatch(/Container offline/);
    expect(host.textContent).toMatch(/no container/);
    expect(host.textContent).toMatch(/Start the container to use preview/);
    expect(host.querySelector(".docker-desktop .chrome")).toBeTruthy();
    expect(host.querySelector(".docker-desktop .spec")).toBeTruthy();
    expect(host.textContent).not.toMatch(/SHELL/);
    expect(host.textContent).not.toMatch(/STATS/);
    expect(host.textContent).not.toMatch(/LOGS/);
    const labels = [...host.querySelectorAll("button")].map((btn) => btn.textContent);
    expect(labels).not.toContain("Files");
    expect(labels).not.toContain("Preview");
    expect(labels).not.toContain("Tools");
    expect(labels).not.toContain("Desktop");
    expect(labels).not.toContain("Tablet");
    expect(labels).not.toContain("Phone");
    expect(labels).not.toContain("Comment");
    expect(api.sessionPreview).not.toHaveBeenCalled();
  });

  it("ignores a leftover preview port when the container is stopped", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({
      ports: [3000],
      active: { port: 3000, path: "/", url: "/api/sessions/s1/preview-http/3000/" },
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, preview: { port: 3000 } }],
      vms: [{ ...vm, status: "stopped" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).toMatch(/Start the container to use preview/);
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Preview")).toBe(
      false,
    );
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Desktop")).toBe(
      false,
    );
    expect(host.textContent).not.toMatch(/SHELL/);
  });

  it("shows boot logs while the container is starting", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    vi.mocked(api.vmLogs).mockResolvedValue({ text: "creating container" });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [{ ...vm, status: "booting" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/Container is starting/);
    expect(host.textContent).toMatch(/LOGS/);
    expect(host.textContent).toMatch(/creating container/);
    expect(host.textContent).not.toMatch(/SHELL/);
    expect(host.textContent).not.toMatch(/STATS/);
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Preview")).toBe(
      false,
    );
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Files")).toBe(
      false,
    );
    expect(api.vmLogs).toHaveBeenCalledWith("s1");
  });

  it("says the image is building when docker build progress is live", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    vi.mocked(api.vmLogs).mockResolvedValue({
      text: "Building locus/agent:0.1 (git, Node, Chromium/Xvfb, ffmpeg, code-server)…\n",
    });
    render({
      ...initialState,
      selectedId: session.id,
      imageProgress: {
        [session.id]: { percent: 30, phase: "RUN apt-get update", step: 2, total: 6 },
      },
      sessions: [session],
      vms: [{ ...vm, status: "booting" }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/Building the agent image/);
    expect(host.textContent).toMatch(/live docker output is in Logs/);
    expect(host.textContent).not.toMatch(/Container is starting/);
  });

  it("keeps a Files follow until the Files tab is showing", async () => {
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    vi.mocked(api.workspaceFile).mockResolvedValue({
      path: "src/app.ts",
      content: 'const x = "hi";\n',
      mtime: "t",
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let latest: UiState = initialState;
    let dispatchRef: Dispatch<Action> = () => undefined;
    function Live() {
      const [state, dispatch] = useReducer(reducer, {
        ...initialState,
        vmCollapsed: false,
        selectedId: session.id,
        sessions: [session],
        vms: [vm],
      });
      latest = state;
      dispatchRef = dispatch;
      return (
        <Store.Provider value={{ state, dispatch }}>
          <DockerWorkspace />
        </Store.Provider>
      );
    }
    act(() => {
      root.render(<Live />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const browser = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Browser",
    );
    act(() => {
      browser!.click();
    });
    expect(host.querySelector(".browser-pane")).toBeTruthy();
    act(() => {
      dispatchRef({
        type: "openWorkspace",
        open: {
          sessionId: session.id,
          path: "src/app.ts",
          line: 1,
          follow: true,
          at: 1,
        },
      });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".browser-pane")).toBeTruthy();
    expect(latest.workspaceOpen?.path).toBe("src/app.ts");
    expect(api.workspaceFile).not.toHaveBeenCalled();
    const files = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Files");
    act(() => {
      files!.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".browser-pane")).toBeNull();
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "src/app.ts");
    expect(latest.workspaceOpen).toBeNull();
  });

  it("prompts for a workspace image name before capturing", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("nightly-node");
    vi.mocked(api.captureImage).mockResolvedValue({} as never);
    vi.mocked(api.sessionPreview).mockResolvedValue({ ports: [] });
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const trigger = host.querySelector('[title="Container tools"]') as HTMLElement;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    const item = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.includes("Save workspace image"),
    ) as HTMLButtonElement;
    await act(async () => {
      item.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.prompt).toHaveBeenCalledWith("Name this golden image", "Web app image");
    expect(api.captureImage).toHaveBeenCalledWith("s1", "nightly-node");
  });
});
