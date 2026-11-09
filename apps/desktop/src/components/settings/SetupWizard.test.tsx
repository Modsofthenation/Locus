import {
  CLAUDE_CODE_BASE_URL,
  KIRO_CLI_BASE_URL,
  UBUNTU_DEFAULT_HARDWARE,
  defaultNetworking,
  type LocusConfig,
  type SetupStatus,
} from "@locus/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupWizard } from "./SetupWizard";
import { api } from "@/lib/api";
import { LAST_AGENT_KEY, loadLastAgent, saveLastAgent } from "@/lib/lastAgent";
import { Store, initialState, reducer, type UiState } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    saveConfig: vi.fn(),
    setup: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: LocusConfig = {
  theme: "ember",
  providers: [
    {
      id: "p1",
      name: "OpenAI",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4.1"],
      defaultModel: "gpt-4.1",
      enabled: true,
      extraHeaders: {},
    },
  ],
  templates: [
    {
      id: "ubuntu-24.04",
      name: "Ubuntu 24.04 LTS",
      os: "ubuntu",
      description: "Desktop Ubuntu guest",
      isoPath: "/iso/ubuntu.img",
      hardware: { ...UBUNTU_DEFAULT_HARDWARE },
      networking: defaultNetworking("ubuntu", 0),
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    },
  ],
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
};

const setup: SetupStatus = {
  hypervisorKind: "mock",
  qemuFound: false,
  qemuHint: "sudo apt install qemu-system-x86",
  kvmLabel: "KVM not present",
  linuxImageReady: false,
  dockerFound: true,
  hasProvider: true,
  hasGoldenImage: false,
  setupCompleted: false,
  ready: true,
  needsWizard: true,
  hostOs: { platform: "linux", label: "Linux" },
  qemuInstall: {
    method: "apt",
    displayCommand: "sudo apt install qemu-system-x86",
    canInstall: true,
    packages: ["qemu-system-x86"],
    manualHint: "sudo apt install qemu-system-x86",
  },
};

describe("SetupWizard", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.localStorage.removeItem(LAST_AGENT_KEY);
  });

  it("opens the empty Agents composer on Continue instead of the new-agent modal", async () => {
    saveLastAgent({ os: "ubuntu", runtime: "vm" });
    vi.mocked(api.saveConfig).mockResolvedValue({ ...config, setupCompleted: true });
    vi.mocked(api.setup).mockResolvedValue({ ...setup, setupCompleted: true, needsWizard: false });
    let state: UiState = {
      ...initialState,
      config,
      setup,
      setupOpen: true,
      selectedId: "s1",
    };

    function AppSlice() {
      return (
        <Store.Provider
          value={{
            state,
            dispatch: (action) => {
              state = reducer(state, action);
              act(() => {
                root.render(<AppSlice />);
              });
            },
          }}
        >
          <SetupWizard />
        </Store.Provider>
      );
    }

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<AppSlice />);
    });
    expect(host.querySelector("[data-testid='locus-mascot']")?.getAttribute("data-pose")).toBe(
      "idle",
    );
    expect(
      host.querySelector("[data-testid='setup-mode-developer']")?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      host.querySelector("[data-testid='setup-mode-swarm']")?.getAttribute("aria-checked"),
    ).toBe("false");
    const continueBtn = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Continue",
    );
    await act(async () => {
      continueBtn!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(state.setupOpen).toBe(false);
    expect(state.section).toBe("agents");
    expect(state.selectedId).toBeNull();
    expect(state.newOpen).toBe(false);
    expect(host.querySelector(".modal")).toBeNull();
    const prefs = loadLastAgent();
    expect(prefs.runtime).toBe("docker");
    expect(api.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ setupCompleted: true, setupFirstTask: "pending" }),
    );
  });

  it("does not treat a missing Docker CLI as a mock engine you can continue through", () => {
    const missingDocker: SetupStatus = { ...setup, dockerFound: false, hypervisorKind: "mock" };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, setup: missingDocker, setupOpen: true },
            dispatch: () => undefined,
          }}
        >
          <SetupWizard />
        </Store.Provider>,
      );
    });
    expect(host.textContent).toContain(
      "Install Docker Desktop or the Docker CLI, then check again",
    );
    expect(host.textContent).toContain("Host agents still work without Docker");
    expect(host.textContent).not.toContain("mock engine");
    expect(host.textContent).not.toContain("click through");
    expect(host.textContent).toContain("VM agents need QEMU");
    expect(host.textContent).not.toContain("mock hypervisor");
    expect(
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Continue"),
    ).toBeUndefined();
    expect(
      [...host.querySelectorAll("button")].some((btn) => btn.textContent === "Check again"),
    ).toBe(true);
    expect(
      [...host.querySelectorAll("button")].some((btn) => btn.textContent === "Use Host instead"),
    ).toBe(true);
    expect(host.querySelector(".setup-cmd")?.textContent).toBe("sudo apt install qemu-system-x86");
    const optional = [...host.querySelectorAll(".setup-list button")].filter((btn) =>
      ["Check again", "Install QEMU", "Fetch Ubuntu 24.04"].includes(btn.textContent ?? ""),
    );
    expect(optional.length).toBeGreaterThan(0);
    expect(optional.every((btn) => !btn.classList.contains("primary"))).toBe(true);
  });

  it("Check again refreshes setup and Continue appears when Docker is found", async () => {
    vi.mocked(api.setup).mockResolvedValue({ ...setup, dockerFound: true });
    let state: UiState = {
      ...initialState,
      config,
      setup: { ...setup, dockerFound: false },
      setupOpen: true,
    };

    function AppSlice() {
      return (
        <Store.Provider
          value={{
            state,
            dispatch: (action) => {
              state = reducer(state, action);
              act(() => {
                root.render(<AppSlice />);
              });
            },
          }}
        >
          <SetupWizard />
        </Store.Provider>
      );
    }

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<AppSlice />);
    });
    const check = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Check again",
    );
    await act(async () => {
      check!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.setup).toHaveBeenCalled();
    expect(state.setup?.dockerFound).toBe(true);
    expect(state.dockerKind).toBe("docker");
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Continue")).toBe(
      true,
    );
  });

  it("Use Host instead finishes setup without defaulting to Docker", async () => {
    saveLastAgent({ os: "ubuntu", runtime: "vm" });
    vi.mocked(api.saveConfig).mockResolvedValue({ ...config, setupCompleted: true });
    vi.mocked(api.setup).mockResolvedValue({
      ...setup,
      dockerFound: false,
      setupCompleted: true,
      needsWizard: false,
    });
    let state: UiState = {
      ...initialState,
      config,
      setup: { ...setup, dockerFound: false },
      setupOpen: true,
      selectedId: "s1",
    };

    function AppSlice() {
      return (
        <Store.Provider
          value={{
            state,
            dispatch: (action) => {
              state = reducer(state, action);
              act(() => {
                root.render(<AppSlice />);
              });
            },
          }}
        >
          <SetupWizard />
        </Store.Provider>
      );
    }

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<AppSlice />);
    });
    const useHost = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Use Host instead",
    );
    await act(async () => {
      useHost!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(state.setupOpen).toBe(false);
    expect(state.section).toBe("agents");
    expect(state.selectedId).toBeNull();
    expect(loadLastAgent().runtime).toBe("host");
  });

  it("streams QEMU installer output in the wizard", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              config,
              setup,
              setupOpen: true,
              qemuInstall: {
                phase: "Installing QEMU",
                log: "Get:1 qemu-system-x86",
                percent: 40,
              },
            },
            dispatch: () => undefined,
          }}
        >
          <SetupWizard />
        </Store.Provider>,
      );
    });
    expect(host.querySelector("[data-testid='qemu-install-progress']")?.textContent).toContain(
      "Installing QEMU",
    );
    expect(host.querySelector(".qemu-install-log")?.textContent).toContain("qemu-system-x86");
    expect(
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Installing QEMU…"),
    ).toBeTruthy();
  });

  it("enables Claude Code without an API key", async () => {
    const next = {
      ...config,
      providers: [
        {
          id: "claude-code",
          name: "Claude Code",
          kind: "claude-code" as const,
          baseUrl: CLAUDE_CODE_BASE_URL,
          models: ["claude-sonnet-4-5"],
          defaultModel: "claude-sonnet-4-5",
          enabled: false,
          extraHeaders: {},
        },
      ],
    };
    vi.mocked(api.saveConfig).mockResolvedValue({
      ...next,
      providers: [{ ...next.providers[0]!, enabled: true }],
    });
    vi.mocked(api.setup).mockResolvedValue({ ...setup, hasProvider: true });
    let state: UiState = {
      ...initialState,
      config: next,
      setup: { ...setup, hasProvider: false },
      setupOpen: true,
    };

    function AppSlice() {
      return (
        <Store.Provider
          value={{
            state,
            dispatch: (action) => {
              state = reducer(state, action);
              act(() => {
                root.render(<AppSlice />);
              });
            },
          }}
        >
          <SetupWizard />
        </Store.Provider>
      );
    }

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<AppSlice />);
    });
    const enable = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Save key",
    );
    expect(enable).toBeTruthy();
    expect((enable as HTMLButtonElement).disabled).toBe(false);
    expect((host.querySelector("input[type='password']") as HTMLInputElement).placeholder).toBe(
      "optional — uses claude login",
    );
    await act(async () => {
      enable!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.saveConfig).toHaveBeenCalled();
    const saved = vi.mocked(api.saveConfig).mock.calls.at(-1)?.[0] as LocusConfig;
    expect(saved.providers[0]).toMatchObject({ id: "claude-code", enabled: true });
  });

  it("enables Kiro CLI without an API key", async () => {
    const next = {
      ...config,
      providers: [
        {
          id: "kiro-cli",
          name: "Kiro CLI",
          kind: "kiro-cli" as const,
          baseUrl: KIRO_CLI_BASE_URL,
          models: ["auto"],
          defaultModel: "auto",
          enabled: false,
          extraHeaders: {},
        },
      ],
    };
    vi.mocked(api.saveConfig).mockResolvedValue({
      ...next,
      providers: [{ ...next.providers[0]!, enabled: true }],
    });
    vi.mocked(api.setup).mockResolvedValue({ ...setup, hasProvider: true });
    let state: UiState = {
      ...initialState,
      config: next,
      setup: { ...setup, hasProvider: false },
      setupOpen: true,
    };

    function AppSlice() {
      return (
        <Store.Provider
          value={{
            state,
            dispatch: (action) => {
              state = reducer(state, action);
              act(() => {
                root.render(<AppSlice />);
              });
            },
          }}
        >
          <SetupWizard />
        </Store.Provider>
      );
    }

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<AppSlice />);
    });
    const enable = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Save key",
    );
    expect(enable).toBeTruthy();
    expect((enable as HTMLButtonElement).disabled).toBe(false);
    expect((host.querySelector("input[type='password']") as HTMLInputElement).placeholder).toBe(
      "optional — uses kiro-cli login",
    );
    await act(async () => {
      enable!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.saveConfig).toHaveBeenCalled();
    const saved = vi.mocked(api.saveConfig).mock.calls.at(-1)?.[0] as LocusConfig;
    expect(saved.providers[0]).toMatchObject({ id: "kiro-cli", enabled: true });
  });
});
