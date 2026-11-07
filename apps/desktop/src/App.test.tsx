import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, LocusConfig } from "@locus/shared";
import { App } from "./App";
import { api } from "@/lib/api";
import { clearPhoneAuth, initPhoneAuth } from "@/lib/phoneAuth";
import { setUiShell } from "@/lib/mobileShell";

vi.mock("@/lib/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/net")>();
  return { ...actual, sleep: vi.fn(async () => undefined) };
});

vi.mock("@/lib/api", () => ({
  api: {
    config: vi.fn(),
    sessions: vi.fn(async () => []),
    session: vi.fn(),
    vms: vi.fn(async () => []),
    health: vi.fn(async () => ({ ok: true, hypervisor: "mock", docker: "mock" })),
    automations: vi.fn(async () => []),
    boards: vi.fn(async () => []),
    projects: vi.fn(async () => []),
    automationRuns: vi.fn(async () => []),
    repos: vi.fn(async () => []),
    dockerContainers: vi.fn(async () => ({ kind: "mock", containers: [] })),
    designSystems: vi.fn(async () => ({ systems: [], builtins: [], defaultId: undefined })),
    assetStyles: vi.fn(async () => ({ styles: [], defaultId: undefined })),
    gameStyles: vi.fn(async () => ({ styles: [], defaultId: undefined })),
    setup: vi.fn(async () => null),
    refreshCursorCli: vi.fn(async () => ({ changed: false, models: [], config: null })),
    sessionSkills: vi.fn(async () => []),
    slackStatus: vi.fn(async () => ({ connected: false, socket: "down" })),
    slackActivity: vi.fn(async () => []),
    hypervisor: vi.fn(async () => ({ kind: "mock", capabilities: {} })),
    images: vi.fn(async () => []),
    phone: vi.fn(async () => ({
      enabled: false,
      listenHost: "127.0.0.1",
      port: 7420,
      urls: [],
    })),
    chromeExtension: vi.fn(async () => ({
      enabled: false,
      installDir: "/tmp/locus/chrome-extension",
      connected: false,
      tabs: [],
    })),
    checkUpdates: vi.fn(async () => ({ status: "unavailable", current: "0.16.1" })),
    workersStatus: vi.fn(async () => []),
    tailscale: vi.fn(async () => ({
      installed: false,
      running: false,
      loggedIn: false,
      funnelEnabled: false,
    })),
    workspaceTree: vi.fn(async () => ({ entries: [] })),
    workspaceFile: vi.fn(),
    saveWorkspaceFile: vi.fn(),
    mkdirWorkspace: vi.fn(),
    deleteWorkspaceFile: vi.fn(),
  },
  connectEvents: vi.fn(() => () => undefined),
  retryEvents: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: LocusConfig = {
  theme: "nord",
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
};

const session: AgentSession = {
  id: "s1",
  title: "Nightly review",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  runtime: "host",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("App boot screen", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    vi.restoreAllMocks();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function renderApp() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<App />);
    });
  }

  it("keeps the mascot loader up until theme and chats hydrate", async () => {
    const pending = deferred<LocusConfig>();
    vi.mocked(api.config).mockReturnValue(pending.promise);
    vi.mocked(api.sessions).mockResolvedValue([session]);

    await renderApp();
    expect(host.querySelector("[data-testid='boot-screen']")).toBeTruthy();
    expect(host.querySelector("[data-testid='locus-mascot']")?.getAttribute("data-pose")).toBe(
      "think",
    );
    expect(host.querySelector(".app")).toBeNull();
    expect(host.textContent).not.toContain("What should this agent do?");
    expect(host.textContent).not.toContain("Nightly review");

    await act(async () => {
      pending.resolve(config);
      await pending.promise;
    });
    expect(host.querySelector("[data-testid='boot-screen']")).toBeTruthy();

    await vi.waitFor(() => {
      expect(host.querySelector(".app")).toBeTruthy();
      expect(host.textContent).toContain("Nightly review");
    });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid='boot-screen']")).toBeNull();
    });
    expect(host.textContent).not.toContain("What should this agent do?");
    expect(document.documentElement.dataset.theme).toBe("nord");
    await vi.waitFor(() => {
      expect(host.textContent).toMatch(/EXPLORER/);
    });
  });

  it("fetches the full selected transcript after a list-view snapshot", async () => {
    const dump = `unique-tool-dump-${"z".repeat(400)}`;
    const slim: AgentSession = {
      ...session,
      listView: true,
      messages: [
        {
          id: "t1",
          role: "tool",
          content: `${dump.slice(0, 40)}…`,
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    };
    const full: AgentSession = {
      ...session,
      messages: [
        {
          id: "t1",
          role: "tool",
          content: dump,
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    };
    vi.mocked(api.config).mockResolvedValue(config);
    vi.mocked(api.sessions).mockResolvedValue([slim]);
    vi.mocked(api.session).mockResolvedValue(full);

    await renderApp();
    await vi.waitFor(() => {
      expect(host.querySelector(".app")).toBeTruthy();
    });
    await vi.waitFor(() => {
      expect(api.session).toHaveBeenCalledWith("s1");
    });
  });

  it("stays on the loader with an error if the snapshot never arrives", async () => {
    vi.mocked(api.config).mockRejectedValue(new Error("offline"));

    await renderApp();
    await flush();

    expect(host.querySelector("[data-testid='boot-screen']")).toBeTruthy();
    expect(host.querySelector("[data-testid='locus-mascot']")?.getAttribute("data-pose")).toBe(
      "rest",
    );
    expect(host.querySelector(".boot-screen-error")?.textContent).toBe("offline");
    expect(host.querySelector(".app")).toBeNull();
  });
});

describe("App mobile shell", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    clearPhoneAuth();
    sessionStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-shell");
    vi.restoreAllMocks();
  });

  it("renders the phone shell after pairing instead of the desktop chrome", async () => {
    initPhoneAuth(
      { pathname: "/", search: "?token=ph_secret", hash: "" },
      { replaceState: vi.fn() },
    );
    vi.mocked(api.config).mockResolvedValue(config);
    vi.mocked(api.sessions).mockResolvedValue([session]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='boot-screen']")).toBeTruthy();
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid='mobile-shell']")).toBeTruthy();
    });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid='boot-screen']")).toBeNull();
    });
    expect(host.querySelector(".app")).toBeNull();
    expect(host.textContent).toContain("Nightly review");
    expect(host.textContent).toContain("Agents");
  });

  it("keeps the desktop chrome when the shell is forced", async () => {
    setUiShell("desktop");
    initPhoneAuth(
      { pathname: "/", search: "?token=ph_secret", hash: "" },
      { replaceState: vi.fn() },
    );
    vi.mocked(api.config).mockResolvedValue(config);
    vi.mocked(api.sessions).mockResolvedValue([session]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".app")).toBeTruthy();
    expect(host.querySelector(".skip-links")?.textContent).toContain("Skip to chat");
    expect(host.querySelector(".skip-links")?.textContent).toContain("Skip to files");
    expect(host.querySelector("[data-testid='mobile-shell']")).toBeNull();
    const back = host.querySelector("[data-testid='phone-layout-bar'] button");
    expect(back?.textContent).toContain("Use phone layout");
    await act(async () => {
      (back as HTMLButtonElement).click();
    });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid='mobile-shell']")).toBeTruthy();
    });
    expect(host.querySelector(".app")).toBeNull();
  });

  it("hides skip links on Docker and Settings", async () => {
    setUiShell("desktop");
    vi.mocked(api.config).mockResolvedValue(config);
    vi.mocked(api.sessions).mockResolvedValue([session]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid='boot-screen']")).toBeNull();
    });
    expect(host.querySelector(".skip-links")?.textContent).toContain("Skip to chat");
    await act(async () => {
      const docker = host.querySelector(
        ".side-rail-nav button[aria-label='Docker']",
      ) as HTMLButtonElement;
      docker.click();
    });
    expect(host.querySelector(".skip-links")).toBeNull();
    await act(async () => {
      (host.querySelector("button[aria-label='Settings']") as HTMLButtonElement).click();
    });
    expect(host.querySelector(".skip-links")).toBeNull();
    await vi.waitFor(() => {
      expect(host.querySelector(".app-settings")).toBeTruthy();
    });
    expect(host.querySelector(".topbar")).toBeNull();
  });
});

describe("App Slack activity", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    vi.restoreAllMocks();
  });

  it("loads Slack activity once Slack is connected", async () => {
    vi.mocked(api.config).mockResolvedValue(config);
    vi.mocked(api.sessions).mockResolvedValue([session]);
    vi.mocked(api.slackStatus).mockResolvedValue({
      connected: true,
      teamId: "T_MOCK",
      teamName: "Locus Dev",
      userId: "U_YOU",
      userName: "you",
      socket: "down",
    });
    vi.mocked(api.slackActivity).mockResolvedValue([
      {
        id: "C_ENG:1.0",
        kind: "mention",
        channelId: "C_ENG",
        channelName: "eng",
        ts: "1.0",
        text: "hey <@U_YOU>",
        userName: "alice",
      },
    ]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<App />);
    });
    await vi.waitFor(() => {
      expect(api.slackActivity).toHaveBeenCalled();
    });
  });
});
