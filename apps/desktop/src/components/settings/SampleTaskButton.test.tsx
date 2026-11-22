import {
  UBUNTU_DEFAULT_HARDWARE,
  defaultNetworking,
  type AgentSession,
  type LocusConfig,
  type SetupStatus,
} from "@locus/shared";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "@/components/layout/EmptyState";
import { api } from "@/lib/api";
import { paletteItems } from "@/lib/palette";
import { Store, initialState, reducer, type UiState } from "@/state/store";
import { SampleTaskButton } from "./SampleTaskButton";
import { SetupWizard } from "./SetupWizard";

vi.mock("@/lib/api", () => ({
  api: {
    images: vi.fn(async () => []),
    workersStatus: vi.fn(async () => []),
    saveConfig: vi.fn(async (config: unknown) => config),
    setup: vi.fn(),
    startSampleTask: vi.fn(),
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
      apiKey: "sk-test",
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
  qemuHint: "",
  kvmLabel: "",
  linuxImageReady: false,
  dockerFound: false,
  hasProvider: true,
  hasGoldenImage: false,
  setupCompleted: false,
  ready: true,
  needsWizard: true,
  hostOs: { platform: "linux", label: "Linux" },
  qemuInstall: {
    method: "apt",
    displayCommand: "",
    canInstall: false,
    packages: [],
    manualHint: "",
  },
};

const sample: AgentSession = {
  id: "sample-1",
  title: "Sample task: fix sum",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  runtime: "host",
  providerId: "p1",
  model: "gpt-4.1",
  status: "running",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((btn) => btn.textContent === text);
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe("Try a sample task", () => {
  let host: HTMLDivElement;
  let root: Root;
  let state: UiState;

  beforeEach(() => {
    vi.mocked(api.startSampleTask).mockReset();
    vi.mocked(api.startSampleTask).mockResolvedValue(sample);
    vi.mocked(api.saveConfig).mockClear();
    vi.mocked(api.setup).mockResolvedValue({ ...setup, setupCompleted: true, needsWizard: false });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.localStorage.removeItem("locus.lastAgent");
  });

  function mount(initial: Partial<UiState>, child: ReactNode) {
    state = { ...initialState, config, setup, ...initial };
    function Slice() {
      return (
        <Store.Provider
          value={{
            state,
            dispatch: (action) => {
              state = reducer(state, action);
              act(() => root.render(<Slice />));
            },
          }}
        >
          {child}
        </Store.Provider>
      );
    }
    act(() => root.render(<Slice />));
  }

  it("finishes the wizard, starts the sample, and opens the new agent", async () => {
    mount({ setupOpen: true }, <SetupWizard />);
    act(() => {
      (host.querySelector("[data-testid='setup-mode-swarm']") as HTMLButtonElement).click();
    });
    const btn = buttonByText(host, "Try a sample task");
    expect(btn).toBeTruthy();
    await act(async () => {
      btn!.click();
      await flush();
    });
    expect(api.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        setupCompleted: true,
        productMode: "swarm",
        setupFirstTask: "done",
      }),
    );
    expect(api.startSampleTask).toHaveBeenCalledWith({
      providerId: "p1",
      model: "gpt-4.1",
      surface: "swarm",
    });
    expect(state.setupOpen).toBe(false);
    expect(state.section).toBe("agents");
    expect(state.selectedId).toBe("sample-1");
    expect(state.sessions.map((row) => row.id)).toEqual(["sample-1"]);
  });

  it("routes to Settings → Providers when no provider is ready", () => {
    mount(
      {
        setupOpen: true,
        setup: { ...setup, hasProvider: false },
      },
      <SampleTaskButton />,
    );
    expect(buttonByText(host, "Try a sample task")).toBeUndefined();
    act(() => {
      buttonByText(host, "Add a provider first")!.click();
    });
    expect(api.startSampleTask).not.toHaveBeenCalled();
    expect(state.setupOpen).toBe(false);
    expect(state.section).toBe("settings");
    expect(state.settingsTab).toBe("providers");
  });

  it("offers the sample on the empty Agents state and marks the first task done", async () => {
    mount({ config: { ...config, setupFirstTask: "pending" }, dockerKind: "mock" }, <EmptyState />);
    const card = host.querySelector("[data-testid='first-task-card']") as HTMLElement;
    expect(card.querySelector("h3")?.textContent).toBe("Try a sample task");
    await act(async () => {
      buttonByText(card, "Try a sample task")!.click();
      await flush();
    });
    expect(api.startSampleTask).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "p1", surface: "developer" }),
    );
    expect(api.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ setupFirstTask: "done" }),
    );
    expect(state.selectedId).toBe("sample-1");
  });

  it("keeps the repo suggestions when a repo is linked, without the sample", () => {
    mount(
      {
        config: { ...config, setupFirstTask: "pending" },
        dockerKind: "mock",
        repos: [
          {
            id: "r1",
            name: "acme/app",
            checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
            createdAt: "2020-01-01T00:00:00.000Z",
            updatedAt: "2020-01-01T00:00:00.000Z",
          },
        ],
      },
      <EmptyState />,
    );
    const card = host.querySelector("[data-testid='first-task-card']") as HTMLElement;
    expect(card.textContent).toContain("acme/app");
    expect(buttonByText(card, "Try a sample task")).toBeUndefined();
  });

  it("lists Try a sample task in the command palette", () => {
    const items = paletteItems({ sessions: [], setup, config });
    expect(items.find((row) => row.id === "sample-task")).toMatchObject({
      title: "Try a sample task",
      hint: "Host agent fixes a failing test",
    });
    const noProvider = paletteItems({
      sessions: [],
      setup: { ...setup, hasProvider: false },
      config,
    });
    expect(noProvider.find((row) => row.id === "sample-task")?.hint).toBe("Add a provider first");
  });
});
