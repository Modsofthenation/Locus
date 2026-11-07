import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, LocusConfig } from "@locus/shared";
import { SessionSwitcher } from "./SessionSwitcher";
import { api } from "@/lib/api";
import { exportSessionChat } from "@/lib/chatExport";
import { Store, initialState, type Action } from "@/state/store";
import { setSettingsDirty, setSettingsPersist } from "@/lib/settingsLeave";

vi.mock("@/lib/api", () => ({
  api: {
    startVm: vi.fn(),
    stopVm: vi.fn(),
    takeover: vi.fn(),
    handback: vi.fn(),
    captureImage: vi.fn(),
    saveConfig: vi.fn(),
    dockerContainersStop: vi.fn(),
    dockerContainers: vi.fn(),
    abortChat: vi.fn(),
    patchSession: vi.fn(),
    clearChat: vi.fn(),
  },
}));

vi.mock("@/lib/chatExport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chatExport")>();
  return { ...actual, exportSessionChat: vi.fn() };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: AgentSession = {
  id: "s1",
  title: "Fix login",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  vmId: "v1",
  messages: [
    {
      id: "u1",
      role: "user",
      content: "fix login",
      createdAt: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "t1",
      role: "tool",
      content: "shot",
      screenshotName: "a.png",
      createdAt: "2020-01-01T00:00:01.000Z",
    },
  ],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

const config = {
  theme: "ember",
  providers: [],
  templates: [],
  hardwareProfiles: [],
  forges: [],
  advanced: {
    dataDir: "/tmp",
    qemuBinary: "qemu-system-x86_64",
    swtpmBinary: "swtpm",
    ovmfCodePath: "",
    ovmfVarsPath: "",
    maxConcurrentVms: 4,
    defaultAcceleratorAuto: true,
    logLevel: "info",
    bindHost: "127.0.0.1",
    bindPort: 7420,
    openBrowserOnStart: true,
    hostSharePath: "",
  },
} as LocusConfig;

describe("SessionSwitcher palette", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    setSettingsDirty(false);
  });

  it("opens with Ctrl+K and runs Start guest / Replay / Theme", async () => {
    const actions: Action[] = [];
    vi.mocked(api.startVm).mockResolvedValue({} as never);
    vi.mocked(api.saveConfig).mockImplementation(async (next) => next);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{
          state: { ...initialState, config, sessions: [session], selectedId: "s1" },
          dispatch: (action) => {
            actions.push(action);
          },
        }}
      >
        <SessionSwitcher />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    expect(host.querySelector(".switcher")).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(host.querySelector("[aria-label='Command palette']")).toBeTruthy();
    expect(host.querySelector(".switcher .search-icon svg")).toBeTruthy();
    expect(host.textContent).toContain("Start guest");
    expect(host.textContent).toContain("Replay run");
    expect(host.textContent).toContain("Theme · Ember");

    const start = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Start guest"),
    );
    await act(async () => {
      start!.click();
      await Promise.resolve();
    });
    expect(api.startVm).toHaveBeenCalledWith("s1");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    const replay = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Replay run"),
    );
    act(() => {
      replay!.click();
    });
    expect(actions).toContainEqual({ type: "replay", open: true });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    const compare = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Compare models"),
    );
    act(() => {
      compare!.click();
    });
    expect(actions).toContainEqual({ type: "compare", open: true });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(host.textContent).toContain("Export chat as HTML");
    const exportHtml = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Export chat as HTML"),
    );
    act(() => {
      exportHtml!.click();
    });
    expect(exportSessionChat).toHaveBeenCalledWith(session, "html");
  });

  it("stops running Docker containers from the palette", async () => {
    const actions: Action[] = [];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.dockerContainersStop).mockResolvedValue({
      stopped: [],
      errors: [],
    });
    vi.mocked(api.dockerContainers).mockResolvedValue({ kind: "mock", containers: [] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              containers: [
                {
                  id: "c1",
                  name: "web",
                  image: "nginx",
                  state: "running",
                  status: "Up",
                  createdAt: "2020-01-01T00:00:00.000Z",
                  locus: false,
                },
                {
                  id: "c2",
                  name: "api",
                  image: "node:22",
                  state: "running",
                  status: "Up",
                  createdAt: "2020-01-01T00:00:00.000Z",
                  locus: false,
                },
              ],
            },
            dispatch: (action) => {
              actions.push(action);
            },
          }}
        >
          <SessionSwitcher />
        </Store.Provider>,
      );
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    const stop = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Stop 2 running containers"),
    );
    await act(async () => {
      stop!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.dockerContainersStop).toHaveBeenCalledWith(["c1", "c2"]);
    expect(actions).toContainEqual({ type: "containers", containers: [] });
  });

  it("jumps to settings tabs, automations, Needs you, and keyboard shortcuts", async () => {
    const actions: Action[] = [];
    vi.mocked(api.takeover).mockResolvedValue({} as never);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const waiting: AgentSession = {
      ...session,
      id: "s2",
      title: "Ship",
      needsHuman: "Protected branch main",
    };
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              config,
              sessions: [session, waiting],
              selectedId: "s1",
              automations: [
                {
                  id: "auto-1",
                  name: "Nightly",
                  enabled: true,
                  prompt: "check the build",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  providerId: "p",
                  model: "grok-4",
                  startVm: false,
                  schedule: { kind: "interval", everyMinutes: 30 },
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
              vms: [
                {
                  id: "v1",
                  sessionId: "s1",
                  templateId: "ubuntu-24.04",
                  os: "ubuntu",
                  name: "Ubuntu",
                  status: "running",
                  diskPath: "/tmp/disk.qcow2",
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: (action) => {
              actions.push(action);
            },
          }}
        >
          <SessionSwitcher />
        </Store.Provider>,
      );
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(host.textContent).toContain("Settings · Git");
    expect(host.textContent).toContain("Settings · Integrations");
    expect(host.textContent).toContain("Settings · MCP");
    expect(host.textContent).toContain("Needs you · 1");
    expect(host.textContent).toContain("Nightly");
    expect(host.textContent).toContain("Take over");
    expect(host.textContent).toContain("Keyboard shortcuts");

    const mcp = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Settings · MCP"),
    );
    act(() => {
      mcp!.click();
    });
    expect(actions).toContainEqual({ type: "settings", open: true });
    expect(actions).toContainEqual({ type: "settingsTab", tab: "mcp" });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    const nightly = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Nightly"),
    );
    act(() => {
      nightly!.click();
    });
    expect(actions).toContainEqual({ type: "selectAutomation", id: "auto-1" });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    const inbox = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Needs you · 1"),
    );
    act(() => {
      inbox!.click();
    });
    expect(actions).toContainEqual({ type: "select", id: "s2" });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    const takeover = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Take over"),
    );
    await act(async () => {
      takeover!.click();
      await Promise.resolve();
    });
    expect(api.takeover).toHaveBeenCalledWith("s1");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    const shortcuts = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Keyboard shortcuts"),
    );
    act(() => {
      shortcuts!.click();
    });
    expect(host.querySelector("[aria-label='Command palette']")).toBeNull();
    expect(host.querySelector("[aria-label='Keyboard shortcuts']")).toBeTruthy();
    expect(host.querySelector("[data-testid='palette-shortcuts']")?.textContent).toContain(
      "Ctrl/Cmd+K",
    );
    expect(host.querySelector("[data-testid='palette-shortcuts']")?.textContent).toContain(
      "Ctrl/Cmd+F",
    );
    expect(host.querySelector("[data-testid='palette-shortcuts']")?.textContent).toContain(
      "Ctrl/Cmd+,",
    );
    expect(host.querySelector("[data-testid='palette-shortcuts']")?.textContent).toContain(
      "Ctrl/Cmd+1–9",
    );
    expect(host.querySelector("[data-testid='palette-shortcuts']")?.textContent).toContain("F12");
    expect(host.querySelector("[data-testid='palette-shortcuts']")?.textContent).toContain(
      "Ctrl/Cmd+W",
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector("[aria-label='Keyboard shortcuts']")).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    const search = host.querySelector(".switcher-input") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "?");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='palette-shortcuts']")?.textContent).toMatch(
      /Ctrl\/Cmd\+N/,
    );
    expect(host.textContent).not.toContain("Settings · MCP");
  });

  it("leaves dirty Settings from the palette without a discard prompt", () => {
    const actions: Action[] = [];
    setSettingsDirty(true);
    const persist = vi.fn(async () => true);
    setSettingsPersist(persist);
    const confirm = vi.spyOn(window, "confirm");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "settings",
              config,
              sessions: [session],
              selectedId: "s1",
            },
            dispatch: (action) => {
              actions.push(action);
            },
          }}
        >
          <SessionSwitcher />
        </Store.Provider>,
      );
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    const next = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("New agent"),
    );
    act(() => {
      next!.click();
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalled();
    expect(actions).toContainEqual({ type: "section", section: "agents" });
    setSettingsPersist(null);
  });

  it("opens the palette with Ctrl+K even when the files editor is focused", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, sessions: [session], selectedId: "s1" },
            dispatch: () => undefined,
          }}
        >
          <SessionSwitcher />
        </Store.Provider>,
      );
    });
    const main = document.createElement("div");
    main.className = "workspace-code-main";
    const ta = document.createElement("textarea");
    main.appendChild(ta);
    document.body.appendChild(main);
    ta.focus();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(host.querySelector("[aria-label='Command palette']")).toBeTruthy();
    main.remove();
  });
});
