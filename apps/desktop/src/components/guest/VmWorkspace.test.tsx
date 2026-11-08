import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, GoldenImage, VmInstance } from "@locus/shared";
import { VmWorkspace } from "./VmWorkspace";
import { api } from "@/lib/api";
import { Store, initialState, type Action, type UiState } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    images: vi.fn(async () => []),
    captureImage: vi.fn(),
    shareFiles: vi.fn(async () => ({ files: [] })),
    shareFileUrl: (name: string) => `/api/share/${name}`,
    execTool: vi.fn(),
    vmLogs: vi.fn(async () => ({ text: "" })),
    workspaceTree: vi.fn(async () => ({ entries: [], changes: [] })),
    workspaceFile: vi.fn(),
    workspaceGit: vi.fn(async () => ({ branch: "main", ahead: 0, behind: 0, files: [] })),
    workspaceGitHunks: vi.fn(async () => ({ items: [] })),
    workspaceProblems: vi.fn(async () => ({ diagnostics: [] })),
    workspaceIndexStatus: vi.fn(async () => ({ status: "ready", fileCount: 0 })),
    handback: vi.fn(),
    uploadShare: vi.fn(),
  },
  terminalWsUrl: (id: string) => `ws://127.0.0.1/pty/${id}`,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    write() {}
    writeln() {}
    dispose() {}
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const session: AgentSession = {
  id: "s1",
  title: "Ubuntu agent",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
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
  name: "ubuntu",
  status: "running",
  diskPath: "/tmp/disk.qcow2",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

const saved: GoldenImage = {
  id: "img-1",
  name: "Ubuntu agent image",
  os: "ubuntu",
  path: "/tmp/images/img-1.qcow2",
  createdAt: "2026-08-25T00:00:00.000Z",
};

describe("VmWorkspace golden image toast", () => {
  let host: HTMLDivElement;
  let root: Root;
  const previousWs = globalThis.WebSocket;
  const previousRo = globalThis.ResizeObserver;

  beforeEach(() => {
    vi.spyOn(window, "prompt").mockReturnValue("Fix login image");
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    globalThis.WebSocket = previousWs;
    globalThis.ResizeObserver = previousRo;
    vi.mocked(api.images).mockReset();
    vi.mocked(api.images).mockResolvedValue([]);
    vi.mocked(api.captureImage).mockReset();
    vi.mocked(api.shareFiles).mockReset();
    vi.mocked(api.shareFiles).mockResolvedValue({ files: [] });
    vi.mocked(window.prompt).mockRestore();
  });

  function render(state: UiState, dispatch: (action: Action) => void = () => undefined) {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider value={{ state: { ...state, vmCollapsed: false }, dispatch }}>
        <VmWorkspace />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  function toastSaveButton() {
    return [...host.querySelectorAll("button")].find(
      (btn) =>
        btn.textContent === "Save" || btn.textContent === "Retry" || btn.textContent === "Saving…",
    );
  }

  it("hides the save prompt after a successful capture even if a stale image list arrives later", async () => {
    let resolveImages: ((rows: GoldenImage[]) => void) | undefined;
    vi.mocked(api.images).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImages = resolve;
        }),
    );
    vi.mocked(api.captureImage).mockResolvedValue(saved);
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/Save a golden image/);
    await act(async () => {
      toastSaveButton()?.click();
      await Promise.resolve();
    });
    expect(host.textContent).not.toMatch(/Save a golden image/);
    expect(host.textContent).not.toMatch(/Could not save the golden image/);
    await act(async () => {
      resolveImages?.([]);
      await Promise.resolve();
    });
    expect(host.textContent).not.toMatch(/Save a golden image/);
  });

  it("keeps the prompt and shows the error when capture fails", async () => {
    vi.mocked(api.images).mockResolvedValue([]);
    vi.mocked(api.captureImage).mockRejectedValue(new Error('Failed to get shared "write" lock'));
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      toastSaveButton()?.click();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/Could not save the golden image/);
    expect(host.textContent).toMatch(/Failed to get shared "write" lock/);
    expect(toastSaveButton()?.textContent).toBe("Retry");
  });

  it("opens Files and an honest Preview empty state on a QEMU guest", async () => {
    render({ ...initialState, selectedId: session.id, sessions: [session], vms: [vm] });
    await act(async () => {
      await Promise.resolve();
    });
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Files")).toBe(
      true,
    );
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Preview")).toBe(
      true,
    );
    await act(async () => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Files")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/guest over SSH|vm-trees mirror/);
    expect(host.querySelector(".workspace-editor")).toBeTruthy();
    await act(async () => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Preview")!.click();
    });
    expect(host.textContent).toMatch(/do not publish mapped host ports/);
    expect(host.querySelector(".workspace-editor")).toBeNull();
  });
});
