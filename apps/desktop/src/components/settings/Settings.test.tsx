import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, useReducer, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURSOR_CLI_BASE_URL,
  CLAUDE_CODE_BASE_URL,
  KIRO_CLI_BASE_URL,
  OMARCHY_DEFAULT_HARDWARE,
  UBUNTU_DEFAULT_HARDWARE,
  defaultNetworking,
  type LocusConfig,
} from "@locus/shared";
import { APP_VERSION } from "@/lib/appInfo";
import { Settings, SETTINGS_AUTOSAVE_MS } from "./Settings";
import { Sidebar } from "@/components/layout/Sidebar";
import { api } from "@/lib/api";
import { setSettingsDirty } from "@/lib/settingsLeave";
import { Store, initialState, reducer, type Action } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    hypervisor: vi.fn(async () => ({ kind: "mock", capabilities: {} })),
    images: vi.fn(async () => []),
    browseDiskImages: vi.fn(async () => ({
      path: "/media",
      parent: "/",
      entries: [{ name: "ubuntu.img", path: "/media/ubuntu.img", kind: "file" as const }],
    })),
    saveConfig: vi.fn(),
    revokeAllIntegrations: vi.fn(),
    startVm: vi.fn(),
    stopVm: vi.fn(),
    setup: vi.fn(),
    resetAll: vi.fn(),
    config: vi.fn(),
    startForgeOauth: vi.fn(),
    forgeOauthStatus: vi.fn(),
    cancelForgeOauth: vi.fn(),
    disconnectForgeOauth: vi.fn(),
    startSlackOauth: vi.fn(),
    slackOauthStatus: vi.fn(),
    disconnectSlackOauth: vi.fn(),
    startGoogleOauth: vi.fn(),
    googleOauthStatus: vi.fn(),
    disconnectGoogleOauth: vi.fn(),
    tailscale: vi.fn(async () => ({
      installed: false,
      running: false,
      loggedIn: false,
      funnelEnabled: false,
      error: "Tailscale is not installed",
    })),
    setTailscaleFunnel: vi.fn(),
    testWorker: vi.fn(),
    addWorker: vi.fn(),
    workersStatus: vi.fn(async () => []),
    phone: vi.fn(async () => ({
      enabled: false,
      listenHost: "127.0.0.1",
      port: 7420,
      urls: [],
    })),
    setPhone: vi.fn(),
    rotatePhone: vi.fn(),
    chromeExtension: vi.fn(async () => ({
      enabled: false,
      installDir: "/tmp/locus/chrome-extension",
      connected: false,
      tabs: [],
    })),
    setChromeExtension: vi.fn(),
    rotateChromeExtension: vi.fn(),
    checkUpdates: vi.fn(async () => ({
      status: "unavailable",
      current: "0.18.0",
      message: "No GitHub release found yet. Check for updates works after a v* tag is published.",
    })),
    refreshCursorCli: vi.fn(async () => ({ changed: false, models: [] })),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

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
    {
      id: "omarchy-4",
      name: "Omarchy 4",
      os: "omarchy",
      description: "Omarchy 4 guest",
      isoPath: "",
      hardware: { ...OMARCHY_DEFAULT_HARDWARE },
      networking: defaultNetworking("omarchy", 0),
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

describe("Settings", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  beforeEach(() => {
    vi.mocked(api.saveConfig).mockImplementation(async (payload) => payload);
  });

  afterEach(() => {
    const mounted = root;
    if (mounted) act(() => mounted.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
    vi.clearAllMocks();
    vi.restoreAllMocks();
    setSettingsDirty(false);
  });

  async function flushAutosave() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SETTINGS_AUTOSAVE_MS + 30));
    });
  }

  async function render(
    next = config,
    dispatchSpy?: (action: Action) => void,
    extras?: {
      repos?: typeof initialState.repos;
      vms?: typeof initialState.vms;
      sessions?: typeof initialState.sessions;
      setup?: typeof initialState.setup;
    },
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Harness() {
      const [state, dispatch] = useReducer(reducer, {
        ...initialState,
        section: "settings" as const,
        config: next,
        repos: extras?.repos ?? [],
        vms: extras?.vms ?? [],
        sessions: extras?.sessions ?? [],
        setup: extras?.setup ?? initialState.setup,
      });
      return (
        <Store.Provider
          value={{
            state,
            dispatch: (action) => {
              dispatchSpy?.(action);
              dispatch(action);
            },
          }}
        >
          <div className="app">
            <Sidebar />
            <main className="workspace">
              <Settings />
            </main>
          </div>
        </Store.Provider>
      );
    }
    const node: ReactNode = <Harness />;
    await act(async () => {
      root!.render(node);
    });
  }

  function navButton(label: string) {
    return [...host!.querySelectorAll(".settings-nav button")].find(
      (el) => el.querySelector(".settings-nav-label")?.textContent === label,
    );
  }

  it("fills the workspace so tab switches cannot resize the pane", () => {
    expect(css).toMatch(/\.settings-page \{[\s\S]*?overflow:\s*hidden/);
    expect(css).toMatch(/\.settings-page \.settings-body \{[\s\S]*?overflow:\s*auto/);
  });

  it("spaces settings nav sections farther apart than items within a section", () => {
    expect(css).toMatch(/\.settings-nav \{[\s\S]*?gap:\s*var\(--space-6\)/);
    expect(css).toMatch(/\.settings-nav-block \{[\s\S]*?gap:\s*var\(--space-0-5\)/);
  });

  it("shows a managed policy banner and greys Add provider", async () => {
    expect(css).toMatch(/\.policy-banner \{/);
    await render({
      ...config,
      managedPolicy: {
        active: true,
        source: "/etc/locus/policy.json",
        signed: false,
        policy: { version: 1 },
        locked: ["providers", "hostAgents", "jail", "brainDistiller"],
      },
    });
    expect(host!.querySelector(".policy-banner")?.textContent).toMatch(
      /Managed by organization policy/,
    );
    expect(host!.querySelector(".policy-banner")?.textContent).not.toMatch(/Last Yard/);
    expect((host!.querySelector(".add-provider") as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  it("revokes every integration token from Integrations", async () => {
    vi.mocked(api.revokeAllIntegrations).mockResolvedValue({ ok: true, config });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await render();
    const integrations = navButton("Integrations");
    await act(async () => {
      integrations!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const revoke = host!.querySelector("[data-testid='revoke-all-tokens']") as HTMLButtonElement;
    expect(revoke).toBeTruthy();
    await act(async () => {
      revoke.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(confirm).toHaveBeenCalled();
    expect(api.revokeAllIntegrations).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("shows at least four appearance palettes per row", () => {
    expect(css).toMatch(/\.theme-grid \{[\s\S]*?grid-template-columns:\s*repeat\(4,/);
  });

  it("pins the appearance preview while the theme list scrolls", () => {
    expect(css).toMatch(
      /\.appearance-layout \{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(/\.appearance-preview \{[\s\S]*?position:\s*sticky/);
  });

  it("styles notification prefs as switch cards", () => {
    expect(css).toMatch(/\.notify-layout \{[\s\S]*?max-width:\s*640px/);
    expect(css).toMatch(/\.notify-card \{[\s\S]*?border-radius:\s*var\(--radius-xl\)/);
    expect(css).toMatch(/\.notify-row \{[\s\S]*?align-items:\s*center/);
    expect(css).toMatch(/\.notify-quiet-times \{[\s\S]*?grid-template-columns:\s*1fr 1fr/);
  });

  it("insets the Settings find icon inside the field", () => {
    expect(css).toMatch(/\.settings-find-wrap \{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/\.settings-find-wrap \{[\s\S]*?gap:\s*var\(--space-2-5\)/);
    expect(css).toMatch(/\.settings-find-wrap \{[\s\S]*?padding:\s*0 var\(--space-3-5\)/);
    expect(css).toMatch(
      /label\.search-wrap\.settings-find-wrap > \.search-icon \{[\s\S]*?position:\s*static/,
    );
    expect(css).toMatch(
      /label\.search-wrap\.settings-find-wrap > input\.search \{[\s\S]*?width:\s*0/,
    );
    expect(css).toMatch(
      /label\.search-wrap\.settings-find-wrap > input\.search \{[\s\S]*?flex:\s*1 1 0%/,
    );
    expect(css).toMatch(
      /label\.search-wrap\.settings-find-wrap > input\.search \{[\s\S]*?border:\s*0/,
    );
  });

  it("gives form checkboxes room around the control", () => {
    expect(css).toMatch(/\.check \{[\s\S]*?gap:\s*var\(--space-2-5\)/);
    expect(css).toMatch(/\.check \{[\s\S]*?margin:\s*var\(--space-4\) 0/);
    expect(css).toMatch(/\.check \{[\s\S]*?padding:\s*var\(--space-1-5\) 0/);
    expect(css).toMatch(/\.check \{[\s\S]*?min-height:\s*32px/);
    expect(css).toMatch(
      /\.provider-row,\s*\.template-row \{[\s\S]*?flex-direction:\s*column[\s\S]*?gap:\s*var\(--space-3\)/,
    );
    expect(css).toMatch(/\.git-accounts \{[\s\S]*?border-radius:\s*var\(--radius-lg\)/);
    expect(css).toMatch(/\.git-account-summary \{[\s\S]*?grid-template-columns:/);
  });

  it("keeps the same settings page while switching nav items", async () => {
    await render();
    const page = host!.querySelector(".settings-page");
    expect(page).toBeTruthy();
    expect(host!.textContent).toContain("Base URL");
    expect(host!.querySelector(".settings-nav-group")?.textContent).toBe("Models");
    expect([...host!.querySelectorAll(".settings-nav-group")].map((el) => el.textContent)).toEqual([
      "Models",
      "Workspace",
      "System",
    ]);

    const buttons = [...host!.querySelectorAll(".settings-nav button")];
    expect(buttons.map((el) => el.querySelector(".settings-nav-label")?.textContent)).toEqual([
      "Providers",
      "MCP",
      "Skills",
      "Machines",
      "Workers",
      "Environments",
      "Git",
      "Integrations",
      "Appearance",
      "Notifications",
      "Phone",
      "Chrome",
      "Advanced",
      "About",
    ]);

    await act(async () => {
      navButton("Appearance")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const seeAll = [...host!.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("See all"),
    );
    if (seeAll) {
      await act(async () => {
        seeAll.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(host!.querySelector(".settings-page")).toBe(page);
    expect(host!.textContent).toContain("Hover a theme to preview it live");
    expect(host!.textContent).toContain("New agent");
    expect(host!.querySelector("[data-testid='theme-preview']")?.getAttribute("data-theme")).toBe(
      "ember",
    );
    expect(host!.querySelector("[data-testid='theme-preview']")?.textContent).toContain(
      "What should we talk about?",
    );
    expect(host!.querySelector("[data-testid='theme-preview']")?.textContent).toContain(
      "Start chat",
    );
    expect(host!.textContent).toContain("Night City");
    expect(host!.textContent).toContain("Syntax");
    expect(host!.textContent).toContain("Linen");
    expect(host!.textContent).toContain("Cafe");
    expect(host!.textContent).toContain("Beacon");
    expect(host!.textContent).toContain("Ion");
    expect(host!.textContent).toContain("Siren");
    expect(host!.textContent).toContain("Keel");
    expect(host!.textContent).toContain("Glacier");
    expect(host!.textContent).toContain("Sepia");
    expect(host!.textContent).toContain("Matcha");
    expect(host!.textContent).toContain("Canyon");
    expect(host!.textContent).toContain("Crypt");
    expect(host!.textContent).toContain("Harvest");
    expect(host!.textContent).toContain("Mono");
    expect(host!.textContent).toContain("Dusk");
    expect(host!.textContent).toContain("Aurora");
    expect(host!.textContent).toContain("Copper");
    expect(host!.textContent).toContain("Blossom");
    expect(host!.textContent).toContain("Neon");
    expect(host!.textContent).toContain("Orbit");
    expect(host!.textContent).toContain("Lunar");
    expect(host!.textContent).toContain("Cosmos");
    expect(host!.textContent).toContain("Mars");
    expect(host!.textContent).toContain("Station");
    expect(host!.textContent).toContain("Void");
    expect(host!.textContent).toContain("Hubble");
    expect(host!.textContent).toContain("Andromeda");
    expect(host!.textContent).toContain("space photo behind the chat thread");
    expect(host!.textContent).not.toContain("Base URL");

    await act(async () => {
      navButton("Machines")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector(".settings-page")).toBe(page);
    expect(host!.textContent).toMatch(/Ubuntu 24\.04/);
    expect(host!.textContent).toContain("Omarchy 4");
    expect(host!.textContent).toContain("1 of 2 ready");
    expect(host!.textContent).toContain("ubuntu.img");
    expect(host!.textContent).toContain("no image set - won't start");
    expect(host!.textContent).toContain("Fetch");
    expect(host!.textContent).toContain("Add machine");
    expect(host!.querySelectorAll(".machine-row")).toHaveLength(2);
    expect(host!.querySelectorAll(".machine-row.open")).toHaveLength(1);
    await act(async () => {
      (host!.querySelectorAll(".machine-row-head")[1] as HTMLButtonElement).click();
    });
    expect(host!.textContent).toContain("Fetch ISO");
    expect(host!.textContent).toContain("unattended install");
    expect(host!.textContent).toContain("Live machines");
    expect(host!.textContent).toContain("No live machines");

    await act(async () => {
      navButton("Workers")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector(".settings-page")).toBe(page);
    expect(host!.textContent).toContain("Add worker");
    expect(host!.textContent).toContain("npm run dev:worker");
    expect(host!.textContent).toContain("does not scan the LAN");
    expect(host!.querySelector(".worker-add-paste input")).toBeTruthy();
    expect([...host!.querySelectorAll("button")].some((btn) => btn.textContent === "Add")).toBe(
      true,
    );
    await act(async () => {
      [...host!.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Add worker")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("LAN");
    expect(host!.textContent).toContain("Cloud VM");
    expect(host!.textContent).toContain("Fargate");
    expect(host!.textContent).toContain("Destroy guest on stop");
    expect(host!.textContent).toContain("Idle TTL");
    expect(host!.textContent).toContain("Hourly USD");
    expect(host!.textContent).toContain("Allowed images");
    await act(async () => {
      [...host!.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Fargate")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Allowed sizes");
    expect(host!.textContent).toContain("Task definition");

    await act(async () => {
      navButton("Environments")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector(".settings-page")).toBe(page);
    expect(host!.textContent).toContain("golden image + jail + recipe + spend cap + Where");
    expect(host!.textContent).toContain("No named environments yet");
    expect(host!.textContent).toContain("Save from New agent");
    expect(host!.textContent).toContain("Open Automations");

    await act(async () => {
      navButton("MCP")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("No MCP servers yet");
    expect(host!.textContent).toContain("Add MCP server");
    await act(async () => {
      [...host!.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Add MCP server")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Command or URL");
    expect(host!.textContent).toContain("Preload tool schemas");
    expect(host!.textContent).toContain("Host (security exception)");

    await act(async () => {
      navButton("Skills")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector(".settings-page")).toBe(page);
    expect(host!.textContent).toContain("+ New skill");
    expect(host!.textContent).toContain("On-demand prompts");
  });

  it("previews the selected palette on a new-agent mock", async () => {
    await render();
    await act(async () => {
      navButton("Appearance")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const seeAll = [...host!.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("See all"),
    );
    if (seeAll) {
      await act(async () => {
        seeAll.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    const preview = host!.querySelector("[data-testid='theme-preview']");
    expect(preview?.getAttribute("data-theme")).toBe("ember");
    expect(preview?.textContent).toContain("What should we talk about?");
    expect(preview?.textContent).toContain("Start chat");
    expect(css).toMatch(/\.theme-preview \{[\s\S]*?background:\s*var\(--bg\)/);
    const nord = [...host!.querySelectorAll(".theme-card")].find(
      (el) => el.querySelector("h3")?.textContent === "Nord",
    );
    await act(async () => {
      nord!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector("[data-testid='theme-preview']")?.getAttribute("data-theme")).toBe(
      "nord",
    );
    expect(host!.querySelector(".theme-preview-label")?.textContent).toMatch(/Nord/);
    expect(host!.textContent).toContain("Click to apply");
    expect(host!.textContent).toContain("Applied theme: Ember");
    expect(host!.querySelector("[data-testid='settings-save-status']")?.textContent).toBe(
      "Saving…",
    );
  });

  it("filters appearance palettes and previews a hovered theme", async () => {
    await render();
    await act(async () => {
      navButton("Appearance")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const seeAll = [...host!.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("See all"),
    );
    if (seeAll) {
      await act(async () => {
        seeAll.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(
      host!.querySelector("[data-testid='theme-filter-all']")?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(host!.textContent).toMatch(/\d+ themes/);
    const allCards = host!.querySelectorAll(".theme-card").length;
    await act(async () => {
      host!
        .querySelector("[data-testid='theme-filter-light']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const lightCards = [...host!.querySelectorAll(".theme-card")];
    expect(lightCards.length).toBeGreaterThan(0);
    expect(lightCards.length).toBeLessThan(allCards);
    expect(lightCards.some((el) => el.querySelector("h3")?.textContent === "Paper")).toBe(true);
    expect(lightCards.some((el) => el.querySelector("h3")?.textContent === "Snow")).toBe(true);
    expect(lightCards.some((el) => el.querySelector("h3")?.textContent === "Nord")).toBe(false);
    expect(lightCards.some((el) => el.querySelector("h3")?.textContent === "Beacon")).toBe(false);
    expect(lightCards.some((el) => el.querySelector("h3")?.textContent === "Daybreak")).toBe(false);
    expect(
      lightCards.every((el) => el.querySelector(".theme-card-kind")?.textContent !== "Contrast"),
    ).toBe(true);
    expect(
      lightCards.every((el) => el.querySelector(".theme-card-kind")?.textContent !== "Gradient"),
    ).toBe(true);

    await act(async () => {
      host!
        .querySelector("[data-testid='theme-filter-contrast']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const contrastCards = [...host!.querySelectorAll(".theme-card")];
    expect(contrastCards.map((el) => el.querySelector("h3")?.textContent)).toEqual([
      "Contrast",
      "Beacon",
      "Ion",
      "Siren",
      "Keel",
      "Flare",
      "Volt",
      "Gale",
      "Tide",
      "Pulse",
      "Halo",
      "Ruby",
      "Jade",
      "Plasma",
      "Banner",
      "Brass",
      "Frost",
    ]);

    await act(async () => {
      host!
        .querySelector("[data-testid='theme-filter-gradient']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const gradientCards = [...host!.querySelectorAll(".theme-card")];
    expect(gradientCards.map((el) => el.querySelector("h3")?.textContent)).toEqual([
      "Horizon",
      "Prism",
      "Daybreak",
      "Reef",
      "Cinder",
      "Nocturne",
      "Orchid",
      "Wildfire",
      "Lilac",
      "Marina",
      "Saffron",
      "Canopy",
      "Trench",
      "Comet",
      "Grove",
      "Peony",
      "Glaze",
    ]);
    expect(
      gradientCards.every((el) => el.querySelector(".theme-card-kind")?.textContent === "Gradient"),
    ).toBe(true);

    await act(async () => {
      host!
        .querySelector("[data-testid='theme-filter-all']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const paper = [...host!.querySelectorAll(".theme-card")].find(
      (el) => el.querySelector("h3")?.textContent === "Paper",
    );
    await act(async () => {
      paper!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(host!.querySelector("[data-testid='theme-preview']")?.getAttribute("data-theme")).toBe(
      "paper",
    );
    expect(host!.querySelector(".theme-preview-status")?.textContent).toBe("preview");
    await act(async () => {
      paper!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: host! }));
    });
    expect(host!.querySelector("[data-testid='theme-preview']")?.getAttribute("data-theme")).toBe(
      "ember",
    );
  });

  it("auto-saves the selected appearance palette", async () => {
    await render();
    await act(async () => {
      navButton("Appearance")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const seeAll = [...host!.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("See all"),
    );
    if (seeAll) {
      await act(async () => {
        seeAll.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(host!.querySelector("[data-testid='theme-apply']")).toBeNull();
    expect(host!.querySelector("[data-testid='theme-revert']")).toBeNull();
    expect(host!.querySelector("[data-testid='settings-save-status']")?.textContent).toBe("Saved");
    const nord = [...host!.querySelectorAll(".theme-card")].find(
      (el) => el.querySelector("h3")?.textContent === "Nord",
    );
    await act(async () => {
      nord!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector("[data-testid='settings-save-status']")?.textContent).toBe(
      "Saving…",
    );
    await flushAutosave();
    expect(api.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ theme: "nord" }));
    expect(host!.textContent).toContain("Applied theme: Nord");
    expect(host!.querySelector("[data-testid='settings-save-status']")?.textContent).toBe("Saved");

    const paper = [...host!.querySelectorAll(".theme-card")].find(
      (el) => el.querySelector("h3")?.textContent === "Paper",
    );
    await act(async () => {
      paper!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushAutosave();
    expect(api.saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "paper" }));
    expect(host!.textContent).toContain("Applied theme: Paper");
  });

  it("applies editor font size and format-on-save from Appearance", async () => {
    await render();
    await act(async () => {
      navButton("Appearance")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const font = host!.querySelector("#editor-font-size") as HTMLInputElement;
    const format = [...host!.querySelectorAll("label")]
      .find((el) => el.textContent?.includes("Format on save"))
      ?.querySelector("input") as HTMLInputElement;
    const prefs = host!.querySelector(".appearance-editor-prefs");
    const filters = host!.querySelector(".theme-filters");
    expect(font.value).toBe("12");
    expect(format.checked).toBe(true);
    const minimap = [...host!.querySelectorAll("label")]
      .find((el) => el.textContent?.includes("Editor minimap"))
      ?.querySelector("input") as HTMLInputElement;
    expect(minimap.checked).toBe(true);
    expect(prefs).toBeTruthy();
    expect(filters).toBeTruthy();
    expect(
      prefs!.compareDocumentPosition(filters!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(font, "16");
      font.dispatchEvent(new Event("input", { bubbles: true }));
      format.click();
      minimap.click();
    });
    await flushAutosave();
    expect(api.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ editorFontSize: 16, formatOnSave: false, showMinimap: false }),
    );

    const dense = host!.querySelector("[data-testid='chat-density-dense']") as HTMLButtonElement;
    expect(
      host!.querySelector("[data-testid='chat-density-compact']")?.getAttribute("aria-checked"),
    ).toBe("true");
    await act(async () => {
      dense.click();
    });
    await flushAutosave();
    expect(api.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ chatDensity: "dense" }));
    expect(dense.getAttribute("aria-checked")).toBe("true");
  });

  it("edits desktop notification prefs on Notifications", async () => {
    await render();
    await act(async () => {
      navButton("Appearance")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector("[data-testid='notify-agents']")).toBeNull();
    expect(host!.querySelector("[data-testid='quiet-hours']")).toBeNull();

    await act(async () => {
      navButton("Notifications")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector("h2")?.textContent).toBe("Notifications");
    expect(host!.querySelector(".notify-layout")).toBeTruthy();
    expect(host!.textContent).toContain("Desktop alerts");
    expect(host!.textContent).toContain("Agent turns");
    expect(host!.textContent).toContain("Needs you");
    expect(host!.textContent).toContain("Slack Activity");
    expect(host!.textContent).toContain("Automations");
    expect(host!.textContent).toContain("Quiet hours");
    expect(host!.querySelector("[data-testid='notify-quiet-start']")).toBeNull();
    const agents = host!.querySelector("[data-testid='notify-agents']") as HTMLButtonElement;
    const needsYou = host!.querySelector("[data-testid='notify-needs-you']") as HTMLButtonElement;
    const slack = host!.querySelector("[data-testid='notify-slack']") as HTMLButtonElement;
    const automations = host!.querySelector(
      "[data-testid='notify-automations']",
    ) as HTMLButtonElement;
    expect(agents.getAttribute("aria-checked")).toBe("true");
    expect(needsYou.getAttribute("aria-checked")).toBe("true");
    expect(slack.getAttribute("aria-checked")).toBe("true");
    expect(automations.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      agents.click();
    });
    expect(agents.getAttribute("aria-checked")).toBe("false");

    const quiet = host!.querySelector("[data-testid='notify-quiet']") as HTMLButtonElement;
    expect(quiet.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      quiet.click();
    });
    expect(quiet.getAttribute("aria-checked")).toBe("true");
    const quietStart = host!.querySelector(
      "[data-testid='notify-quiet-start']",
    ) as HTMLInputElement;
    const quietEnd = host!.querySelector("[data-testid='notify-quiet-end']") as HTMLInputElement;
    expect(quietStart.value).toBe("22:00");
    expect(quietEnd.value).toBe("08:00");
    expect(host!.textContent).toContain("Alerts muted from 22:00 until 08:00 (overnight).");

    await flushAutosave();
    expect(api.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        notifyAgents: false,
        notifyQuietStart: "22:00",
        notifyQuietEnd: "08:00",
      }),
    );
    const payload = vi.mocked(api.saveConfig).mock.calls[0]?.[0];
    expect(payload?.notifyAgents).toBe(false);
    expect(payload?.notifyNeedsYou).not.toBe(false);
    expect(payload?.notifySlack).not.toBe(false);
    expect(payload?.notifyAutomations).not.toBe(false);
    expect(host!.querySelector("[data-testid='notify-automations-failed-only']")).toBeTruthy();
    const failedOnly = host!.querySelector(
      "[data-testid='notify-automations-failed-only']",
    ) as HTMLButtonElement;
    expect(failedOnly.getAttribute("aria-checked")).toBe("false");
  });

  it("adds a worker from a pasted add line", async () => {
    const worker = {
      id: "w1",
      name: "studio",
      url: "https://192.168.1.8:7421",
      fingerprint: `sha256:${"ab".repeat(32)}`,
    };
    vi.mocked(api.addWorker).mockResolvedValue({
      worker,
      config: { ...config, workers: [worker] },
    });
    await render();
    await act(async () => {
      navButton("Workers")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const input = host!.querySelector(".worker-add-paste input") as HTMLInputElement;
    const blob = "locus-worker:add?url=https%3A%2F%2F192.168.1.8%3A7421&token=secret&name=studio";
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, blob);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...host!.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Add")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.addWorker).toHaveBeenCalledWith({ blob });
    expect(host!.textContent).toContain("Added studio");
    expect(host!.textContent).toContain("TLS pinned");
    expect(
      (host!.querySelector('input[placeholder="https://192.168.1.10:7421"]') as HTMLInputElement)
        .value,
    ).toBe("https://192.168.1.8:7421");
  });

  it("shows Integrations for Jira, Slack, Grafana, incident.io, and Sentry", async () => {
    await render();
    const integrations = navButton("Integrations");
    expect(integrations).toBeTruthy();
    await act(async () => {
      integrations!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Add Jira");
    expect(host!.textContent).toContain("Add Confluence");
    expect(host!.textContent).toContain("Add Linear");
    expect(host!.textContent).toContain("Add Slack");
    expect(host!.textContent).toContain("Add Grafana");
    expect(host!.textContent).toContain("Add Sentry");
    expect(host!.textContent).toContain("Add Miro");
    expect(host!.textContent).toContain("Add incident.io");
    expect(host!.textContent).toContain("Add AWS IAM");
    expect(host!.textContent).toContain("Add Portainer");
    expect(host!.textContent).toContain("Add Figma");
    expect(host!.textContent).toContain("Add Gmail");
    expect(host!.textContent).toContain("Add Google Calendar");
    expect(host!.textContent).toContain("Add Google Drive");
    expect(host!.textContent).toContain("Add Kubernetes");
    expect(host!.textContent).toContain("Sentry");
    expect(host!.textContent).toContain("GitHub");
    const addMiro = [...host!.querySelectorAll("button")].find(
      (el) => el.querySelector("strong")?.textContent === "Add Miro",
    );
    expect(addMiro).toBeTruthy();
    await act(async () => {
      addMiro!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("REST API token");
    expect(host!.textContent).toContain("miro_list");
    expect(host!.textContent).toContain("miro_export");
    const addConfluence = [...host!.querySelectorAll("button")].find(
      (el) => el.querySelector("strong")?.textContent === "Add Confluence",
    );
    expect(addConfluence).toBeTruthy();
    await act(async () => {
      addConfluence!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("confluence_search");
    expect(host!.textContent).toContain("confluence_comment");
    const addGrafana = [...host!.querySelectorAll("button")].find(
      (el) => el.querySelector("strong")?.textContent === "Add Grafana",
    );
    expect(addGrafana).toBeTruthy();
    await act(async () => {
      addGrafana!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("API key / service account token");
    expect(host!.textContent).toContain("grafana_query");
    const addIncident = [...host!.querySelectorAll("button")].find(
      (el) => el.querySelector("strong")?.textContent === "Add incident.io",
    );
    expect(addIncident).toBeTruthy();
    await act(async () => {
      addIncident!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Create an API key at app.incident.io");
    expect(host!.textContent).toContain("incidentio_search");
    expect(host!.textContent).toContain("incidentio_create");
    const addLinear = [...host!.querySelectorAll("button")].find(
      (el) => el.querySelector("strong")?.textContent === "Add Linear",
    );
    expect(addLinear).toBeTruthy();
    await act(async () => {
      addLinear!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Create a personal API key at linear.app");
    expect(host!.textContent).toContain("linear_search");
    expect(host!.textContent).toContain("linear_create");
    const addAws = [...host!.querySelectorAll("button")].find(
      (el) => el.querySelector("strong")?.textContent === "Add AWS IAM",
    );
    expect(addAws).toBeTruthy();
    await act(async () => {
      addAws!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Secret access key");
    expect(host!.textContent).toContain("instance metadata");
    expect(host!.textContent).toContain("AWS gateway URL");
    expect(host!.textContent).toContain("STS endpoint");
    expect(host!.textContent).toContain("execute-api");
    expect(host!.textContent).toContain("aws_sts_identity");
    expect(host!.textContent).toContain("aws_iam_simulate");
    const addPortainer = [...host!.querySelectorAll("button")].find(
      (el) => el.querySelector("strong")?.textContent === "Add Portainer",
    );
    expect(addPortainer).toBeTruthy();
    await act(async () => {
      addPortainer!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Access token");
    expect(host!.textContent).toContain("portainer_endpoints");
    expect(host!.textContent).toContain("portainer_container_action");
    const addFigma = [...host!.querySelectorAll("button")].find(
      (el) => el.querySelector("strong")?.textContent === "Add Figma",
    );
    expect(addFigma).toBeTruthy();
    await act(async () => {
      addFigma!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Personal access token");
    expect(host!.textContent).toContain("figma_list");
    expect(host!.textContent).toContain("figma_comment");
    const addK8s = [...host!.querySelectorAll("button")].find(
      (el) => el.querySelector("strong")?.textContent === "Add Kubernetes",
    );
    expect(addK8s).toBeTruthy();
    await act(async () => {
      addK8s!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Service account token");
    expect(host!.textContent).toContain("kubectl proxy");
    expect(host!.textContent).toContain("k8s_list");
    expect(host!.textContent).toContain("k8s_apply");
    const addSentry = [...host!.querySelectorAll("button")].find(
      (el) => el.querySelector("strong")?.textContent === "Add Sentry",
    );
    expect(addSentry).toBeTruthy();
    await act(async () => {
      addSentry!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Auth token");
    expect(host!.textContent).toContain("sentry_search");
    expect(host!.textContent).toContain("sentry_update");
    expect(host!.textContent).toContain("Plugins");
    expect(host!.textContent).toContain("No plugins yet.");
    expect(host!.textContent).toContain("Ask an agent to add a plugin");
    const enabled = [...host!.querySelectorAll("label")].find((el) =>
      el.textContent?.trim().startsWith("Enabled"),
    );
    expect(enabled?.classList.contains("check")).toBe(true);
    expect(enabled?.querySelector("input[type='checkbox']")).toBeTruthy();
  });

  it("renders plugin config fields from an authored integration plugin", async () => {
    await render({
      ...config,
      integrationPlugins: [
        {
          id: "pl1",
          slug: "status",
          name: "Statuspage",
          description: "Internal incidents",
          enabled: true,
          configFields: [
            {
              key: "baseUrl",
              label: "Base URL",
              type: "url",
              placeholder: "https://status.example",
            },
            { key: "token", label: "API token", type: "secret" },
          ],
          config: { baseUrl: "https://status.example" },
          tools: [
            {
              name: "list",
              description: "List incidents",
              parameters: { type: "object", properties: {} },
              http: { method: "GET", url: "{{config.baseUrl}}/incidents" },
            },
          ],
        },
      ],
    });
    await act(async () => {
      navButton("Integrations")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Internal incidents");
    expect(host!.textContent).toContain("plugin_status_list");
    expect(host!.textContent).toContain("API token");
    expect(host!.querySelector("input[placeholder='https://status.example']")).toBeTruthy();
    expect(
      [...host!.querySelectorAll("input")].some((el) => el.getAttribute("type") === "password"),
    ).toBe(true);
    const enabled = [...host!.querySelectorAll("label")].find((el) =>
      el.textContent?.trim().startsWith("Enabled"),
    );
    expect(enabled?.classList.contains("check")).toBe(true);
  });

  it("offers Sign in with Slack so Locus can act as you", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(api.startSlackOauth).mockResolvedValue({
      method: "redirect",
      authorizeUrl: "https://slack.com/oauth/v2/authorize?user_scope=chat%3Awrite",
      expiresIn: 900,
    });
    await render({
      ...config,
      integrations: [
        {
          id: "sl1",
          kind: "slack",
          name: "Slack",
          enabled: true,
          baseUrl: "https://slack.com/api",
          oauthClientId: "cid",
        },
      ],
    });
    await act(async () => {
      navButton("Integrations")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Sign in with Slack");
    expect(host!.textContent).toContain("as you by default");
    expect(host!.textContent).toContain("User token");
    expect(host!.textContent).toContain("xoxp-mock");
    expect(host!.textContent).toContain("Channel allowlist");
    const signIn = [...host!.querySelectorAll("button")].find(
      (el) => el.textContent === "Sign in with Slack",
    );
    expect(signIn).toBeTruthy();
    await act(async () => {
      signIn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.startSlackOauth).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "sl1", oauthClientId: "cid" }),
    );
    expect(open).toHaveBeenCalledWith(
      "https://slack.com/oauth/v2/authorize?user_scope=chat%3Awrite",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  it("offers Sign in with Google for Gmail", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(api.startGoogleOauth).mockResolvedValue({
      method: "redirect",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=cid",
      expiresIn: 900,
    });
    await render({
      ...config,
      integrations: [
        {
          id: "gm1",
          kind: "gmail",
          name: "Gmail",
          enabled: true,
          baseUrl: "https://gmail.googleapis.com",
          oauthClientId: "cid.apps.googleusercontent.com",
        },
      ],
    });
    await act(async () => {
      navButton("Integrations")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Sign in with Google");
    expect(host!.textContent).toContain("gmail_search");
    expect(host!.textContent).toContain("gmail_send");
    const signIn = [...host!.querySelectorAll("button")].find(
      (el) => el.textContent === "Sign in with Google",
    );
    expect(signIn).toBeTruthy();
    await act(async () => {
      signIn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.startGoogleOauth).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "gm1",
        oauthClientId: "cid.apps.googleusercontent.com",
      }),
    );
    expect(open).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=cid",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  it("offers GitHub, GitLab, and Bitbucket SSO sign-in on the Git tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(api.startForgeOauth).mockResolvedValue({
      method: "device",
      userCode: "WDJB-MJHT",
      verificationUri: "https://github.com/login/device",
      verificationUriComplete: "https://github.com/login/device?user_code=WDJB-MJHT",
      expiresIn: 900,
    });
    vi.mocked(api.forgeOauthStatus).mockResolvedValue({ status: "pending", method: "device" });
    await render({
      ...config,
      forges: [
        {
          id: "gh1",
          kind: "github",
          name: "GitHub",
          apiBaseUrl: "https://api.github.com",
          oauthClientId: "iv1.local",
        },
        {
          id: "bb1",
          kind: "bitbucket",
          name: "Bitbucket",
          apiBaseUrl: "https://api.bitbucket.org/2.0",
          oauthClientId: "bb-client",
        },
        { id: "gl1", kind: "gitlab", name: "GitLab", apiBaseUrl: "https://gitlab.com/api/v4" },
      ],
    });
    await act(async () => {
      navButton("Git")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Sign in with GitHub, GitLab, or Bitbucket");
    expect(host!.textContent).toContain("OAuth client ID");
    expect(host!.textContent).toContain("http://127.0.0.1:7420/api/oauth/callback");
    expect(host!.querySelector(".git-accounts")).toBeTruthy();
    expect(host!.querySelectorAll(".git-account")).toHaveLength(3);
    expect(host!.querySelectorAll(".git-account.open")).toHaveLength(1);
    const signIn = [...host!.querySelectorAll("button")].find(
      (el) => el.textContent === "Sign in with GitHub",
    );
    expect(signIn).toBeTruthy();
    await act(async () => {
      signIn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.startForgeOauth).toHaveBeenCalledWith(
      "gh1",
      expect.objectContaining({ kind: "github", oauthClientId: "iv1.local" }),
    );
    expect(open).toHaveBeenCalledWith(
      "https://github.com/login/device?user_code=WDJB-MJHT",
      "_blank",
      "noopener,noreferrer",
    );
    expect(host!.textContent).toContain("WDJB-MJHT");
    const summaries = [...host!.querySelectorAll(".git-account-summary")];
    await act(async () => {
      summaries[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Sign in with Bitbucket");
    await act(async () => {
      summaries[2]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Sign in with GitLab");
    open.mockRestore();
  });

  it("renders Git accounts as expandable cards with status and linked-repo usage", async () => {
    await render(
      {
        ...config,
        forges: [
          {
            id: "gh1",
            kind: "github",
            name: "work",
            username: "rmatthews",
            token: "ghs_live",
            authMethod: "oauth",
            apiBaseUrl: "https://api.github.com",
          },
          {
            id: "gh2",
            kind: "github",
            name: "personal",
            username: "rosa-dev",
            token: "ghs_old",
            apiBaseUrl: "https://api.github.com",
            tokenExpiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
          },
        ],
      },
      undefined,
      {
        repos: Array.from({ length: 9 }, (_, i) => ({
          id: `r${i}`,
          name: `repo-${i}`,
          checkout: {
            forge: "github" as const,
            url: `https://github.com/acme/repo-${i}.git`,
            accountId: "gh1",
          },
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
        })),
      },
    );
    await act(async () => {
      navButton("Git")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("@rmatthews");
    expect(host!.textContent).toContain("GitHub — work");
    expect(host!.textContent).toContain("github.com");
    expect(host!.textContent).toContain("Signed in");
    expect(host!.textContent).toContain("Used 12 minutes ago");
    expect(host!.textContent).toContain("Re-authenticate");
    expect(host!.textContent).toContain("Replace token");
    expect(host!.textContent).toContain("Used by 9 linked repos");
    expect(host!.textContent).toContain("repo · read:user · read:org · workflow");
    expect(host!.textContent).toContain("@rosa-dev");
    expect(host!.textContent).toContain("Token expires in 6 days");
    expect(host!.querySelectorAll(".git-account.open")).toHaveLength(1);
    const summaries = [...host!.querySelectorAll(".git-account-summary")];
    await act(async () => {
      summaries[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelectorAll(".git-account.open")).toHaveLength(0);
    expect(host!.textContent).not.toContain("Re-authenticate");
  });

  it("shows version, developer credit, and MIT license on About", async () => {
    await render();
    const about = navButton("About");
    expect(about).toBeTruthy();

    await act(async () => {
      about!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector(".settings-page")).toBeTruthy();
    expect(host!.querySelector(".about-hero .brand-mark")).toBeTruthy();
    expect(host!.textContent).toContain("Locus");
    expect(host!.querySelector(".about-hero [data-testid='locus-mascot']")).toBeNull();
    expect(host!.textContent).toContain(APP_VERSION);
    expect(host!.textContent).toContain("Damon Van Der Linde");
    expect(host!.textContent).toContain("MIT License");
    expect(host!.textContent).toContain("Copyright (c) 2026 Locus contributors");
    expect(host!.textContent).toContain("Permission is hereby granted, free of charge");
    expect(host!.textContent).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    expect(host!.textContent).toContain("encrypted vault");
    expect(host!.textContent).toContain("does not train models");
    expect(host!.textContent).toContain("Check for updates");
    expect(host!.textContent).toContain("GitHub releases");
    await act(async () => {
      await Promise.resolve();
    });
    expect(host!.textContent).toContain("No GitHub release found yet");
    expect(host!.textContent).not.toContain("Base URL");
  });

  it("explains phone pairing on the Phone tab", async () => {
    await render();
    await act(async () => {
      await Promise.resolve();
    });
    const phone = navButton("Phone");
    expect(phone).toBeTruthy();
    await act(async () => {
      phone!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Enable phone remote");
    expect(host!.textContent).toContain("Android");
    expect(host!.textContent).toContain("Do not Funnel port 7420");
    expect(host!.textContent).toContain("Pairing applies immediately");
    expect(vi.mocked(api.phone)).toHaveBeenCalled();
  });

  it("shows a QR code for the preferred LAN pairing URL", async () => {
    vi.mocked(api.phone).mockResolvedValue({
      enabled: true,
      token: "ph_abc",
      listenHost: "0.0.0.0",
      port: 7420,
      urls: [
        {
          address: "172.17.0.1",
          http: "https://172.17.0.1:7420/?token=ph_abc&fp=abababababababababababababababababababababababababababababababab",
          app: "locus://pair?host=172.17.0.1&port=7420&token=ph_abc&fp=abababababababababababababababababababababababababababababababab",
        },
        {
          address: "192.168.1.20",
          http: "https://192.168.1.20:7420/?token=ph_abc&fp=abababababababababababababababababababababababababababababababab",
          app: "locus://pair?host=192.168.1.20&port=7420&token=ph_abc&fp=abababababababababababababababababababababababababababababababab",
        },
      ],
      fingerprint: "sha256:abababababababababababababababababababababababababababababababab",
    });
    await render();
    await act(async () => {
      await Promise.resolve();
    });
    const phone = navButton("Phone");
    expect(phone).toBeTruthy();
    await act(async () => {
      phone!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const qr = host!.querySelector("[data-testid='phone-qr']");
    expect(qr?.getAttribute("data-pairing-url")).toBe(
      "https://192.168.1.20:7420/?token=ph_abc&fp=abababababababababababababababababababababababababababababababab",
    );
    expect(host!.querySelector("svg")).toBeTruthy();
    expect(host!.textContent).toContain("Scan to pair");
    expect(host!.textContent).toContain("TLS fingerprint");
    expect(host!.textContent).toContain("ABC");
  });

  it("saves a disabled phone remote instead of restoring it from the redacted draft", async () => {
    const enabledStatus = {
      enabled: true,
      token: "ph_abc",
      listenHost: "0.0.0.0" as const,
      port: 7420,
      urls: [
        {
          address: "192.168.1.20",
          http: "https://192.168.1.20:7420/?token=ph_abc",
          app: "locus://pair?host=192.168.1.20&port=7420&token=ph_abc",
        },
      ],
    };
    vi.mocked(api.phone).mockResolvedValue(enabledStatus);
    vi.mocked(api.setPhone).mockResolvedValue({
      enabled: false,
      listenHost: "127.0.0.1",
      port: 7420,
      urls: [],
    });
    vi.mocked(api.saveConfig).mockResolvedValue({
      ...config,
      phoneRemote: { enabled: false, token: "••••••••" },
    });
    await render({ ...config, phoneRemote: { enabled: true, token: "••••••••" } });
    await act(async () => {
      await Promise.resolve();
    });
    const phone = navButton("Phone");
    expect(phone).toBeTruthy();
    await act(async () => {
      phone!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Enable phone remote");
    const toggle = host!.querySelector('[data-testid="phone-enabled"]') as HTMLInputElement | null;
    expect(toggle?.checked).toBe(true);
    await act(async () => {
      toggle!.click();
      await Promise.resolve();
    });
    expect(api.setPhone).toHaveBeenCalledWith(false);
    await flushAutosave();
    expect(api.setPhone).toHaveBeenLastCalledWith(false);
    expect(api.saveConfig).toHaveBeenCalled();
  });

  it("pairs the Chrome extension from Settings", async () => {
    vi.mocked(api.chromeExtension).mockResolvedValue({
      enabled: true,
      token: "cx_aabbccddeeff0011",
      formattedToken: "AABB-CCDD-EEFF-0011",
      installDir: "/tmp/locus/chrome-extension",
      connected: true,
      tabs: [{ targetId: "1", url: "https://example.com", title: "Example", active: true }],
    });
    await render(config);
    await act(async () => {
      await Promise.resolve();
    });
    const chrome = navButton("Chrome");
    expect(chrome).toBeTruthy();
    await act(async () => {
      chrome!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Enable Chrome extension");
    expect(host!.textContent).toContain("Load unpacked");
    expect(host!.querySelector('[data-testid="chrome-token"]')?.textContent).toContain("AABB");
    expect(host!.querySelector('[data-testid="chrome-install-dir"]')?.textContent).toContain(
      "chrome-extension",
    );
  });

  it("rejects a reserved slash name before saving skills", async () => {
    await render({
      ...config,
      skills: [
        {
          id: "s1",
          name: "ops-research",
          title: "Ops research",
          hint: "hint",
          body: "Do not steal undo.",
          enabled: true,
        },
      ],
    });
    await act(async () => {
      navButton("Skills")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const name = host!.querySelector(".skill-card input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(name, "undo");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flushAutosave();
    expect(host!.textContent).toMatch(/built-in/);
    expect(host!.querySelector("[data-testid='settings-save-status']")?.textContent).toBe(
      "Save failed",
    );
    expect(api.saveConfig).not.toHaveBeenCalled();
  });

  it("shows collapsible skill cards, + New skill, and the reserved-command note", async () => {
    const skills = [
      {
        id: "s1",
        name: "ops-research",
        title: "Ops research",
        hint: "Jira, Confluence, Grafana, Slack → short answer",
        body: "x".repeat(343),
        enabled: true,
      },
      {
        id: "s2",
        name: "review-pr",
        title: "PR review",
        hint: "Load-path review via git_pr_get; JSON verdict",
        body: "y".repeat(649),
        enabled: true,
      },
      {
        id: "s3",
        name: "triage-alert",
        title: "Triage alert",
        hint: "Grafana → severity, owner, next step",
        body: "z".repeat(89),
        enabled: true,
      },
      {
        id: "s4",
        name: "release-notes",
        title: "Release notes",
        hint: "Merged PRs since tag → changelog",
        body: "w".repeat(122),
        enabled: false,
      },
    ];
    await render({ ...config, skills });
    await act(async () => {
      navButton("Skills")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain(
      "On-demand prompts. Type /name in the composer, with an optional extra task after it.",
    );
    expect(host!.textContent).toContain("Built-in commands like /undo stay reserved.");
    expect(
      [...host!.querySelectorAll("button")].some((btn) => btn.textContent === "+ New skill"),
    ).toBe(true);
    const cards = host!.querySelectorAll(".skill-card");
    expect(cards).toHaveLength(4);
    expect(cards[0]!.classList.contains("open")).toBe(true);
    expect(cards[1]!.classList.contains("open")).toBe(false);
    expect(cards[0]!.textContent).toContain("/ops-research");
    expect(cards[0]!.textContent).toContain("343 chars");
    expect(cards[1]!.textContent).toContain("/review-pr");
    expect(cards[1]!.textContent).toContain("649 chars");
    expect(cards[1]!.querySelector("textarea")).toBeNull();
    expect(cards[3]!.querySelector(".provider-dot")?.classList.contains("on")).toBe(false);
    await act(async () => {
      (cards[1]!.querySelector(".provider-card-summary") as HTMLButtonElement).click();
    });
    expect(cards[0]!.classList.contains("open")).toBe(false);
    expect(cards[1]!.classList.contains("open")).toBe(true);
    expect((cards[1]!.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "y".repeat(649),
    );
    expect((cards[1]!.querySelector("input") as HTMLInputElement).value).toBe("review-pr");
    await act(async () => {
      (cards[1]!.querySelector('[role="switch"]') as HTMLButtonElement).click();
    });
    expect(cards[1]!.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      [...cards[1]!.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Delete skill")!
        .click();
    });
    expect(host!.querySelectorAll(".skill-card")).toHaveLength(3);
    await act(async () => {
      [...host!.querySelectorAll("button")]
        .find((btn) => btn.textContent === "+ New skill")!
        .click();
    });
    const next = host!.querySelectorAll(".skill-card");
    expect(next).toHaveLength(4);
    expect(next[3]!.classList.contains("open")).toBe(true);
    expect(next[3]!.textContent).toContain("/name");
    expect(next[3]!.textContent).toContain("0 chars");
  });

  it("renders a string body instead of [object Object] when a skill body is not text", async () => {
    await render({
      ...config,
      skills: [
        {
          id: "s1",
          name: "review-pr",
          title: "PR review",
          hint: "Load-path review via git_pr_get; JSON verdict",
          body: { prompt: "Review this PR" } as unknown as string,
          enabled: true,
        },
      ],
    });
    await act(async () => {
      navButton("Skills")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const textarea = host!.querySelector(".skill-card textarea") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe("");
    expect(textarea.value).not.toBe("[object Object]");
    expect(host!.textContent).toContain("0 chars");
  });

  it("shows Reset all data on Advanced and confirms before calling the API", async () => {
    await render();
    const advanced = [...host!.querySelectorAll(".settings-nav button")].find(
      (el) => el.textContent === "Advanced",
    );
    await act(async () => {
      advanced!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Reset all data");
    expect(host!.textContent).toContain("Host / QEMU paths");
    expect(host!.textContent).toContain("Python interpreter");
    expect(host!.textContent).toContain("python-lsp-server");
    expect(host!.textContent).toContain("Limits");
    expect(host!.textContent).toContain("Guest boot timeout (ms)");
    expect(host!.textContent).toContain("Approval timeout (ms)");
    expect(host!.textContent).toContain("Prompt queue depth");
    expect(host!.textContent).toContain("Automation chats to keep");
    expect(host!.textContent).toContain("Danger zone");
    expect(host!.textContent).toContain("/tmp");
    expect(host!.textContent).toContain("Autonomy");
    expect(host!.textContent).toContain("ask for push, PR, MCP, plugins, and installs");
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const button = [...host!.querySelectorAll("button")].find(
      (el) => el.textContent === "Reset all data",
    );
    await act(async () => {
      button!.click();
    });
    expect(api.resetAll).not.toHaveBeenCalled();
  });

  it("keeps Advanced limits reachable in Swarm settings", async () => {
    await render({ ...config, productMode: "swarm" });
    expect(navButton("Advanced")).toBeTruthy();
    expect(navButton("Machines")).toBeUndefined();
    await act(async () => {
      navButton("Advanced")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.textContent).toContain("Limits");
    expect(host!.textContent).toContain("Guest boot timeout (ms)");
    expect(host!.textContent).toContain("Approval timeout (ms)");
    expect(host!.textContent).toContain("Prompt queue depth");
    expect(host!.textContent).toContain("Automation chats to keep");
  });

  it("shows the QEMU install command as a copyable block beside a secondary button", async () => {
    await render(config, undefined, {
      setup: {
        hypervisorKind: "mock",
        qemuFound: false,
        qemuHint: "sudo apt install qemu-system-x86 qemu-utils ovmf swtpm",
        kvmLabel: "",
        linuxImageReady: false,
        dockerFound: false,
        hasProvider: false,
        hasGoldenImage: false,
        setupCompleted: false,
        ready: false,
        needsWizard: false,
        hostOs: { platform: "linux", label: "Linux" },
        qemuInstall: {
          method: "apt",
          displayCommand: "",
          canInstall: true,
          packages: [],
          manualHint: "",
        },
      },
    });
    await act(async () => {
      navButton("Advanced")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const block = host!.querySelector(".qemu-install");
    expect(block?.querySelector(".setup-cmd")?.textContent).toBe(
      "sudo apt install qemu-system-x86 qemu-utils ovmf swtpm",
    );
    const install = [...block!.querySelectorAll("button")].find(
      (el) => el.textContent === "Install QEMU",
    );
    expect(install?.classList.contains("primary")).toBe(false);
  });

  it("resets after two confirms", async () => {
    vi.mocked(api.resetAll).mockResolvedValue({
      ok: true,
      dataDir: "/tmp",
      config,
      sessions: [],
      vms: [],
      automations: [],
      runs: [],
      repos: [],
      hypervisor: "mock",
      docker: "mock",
      setup: {
        hypervisorKind: "mock",
        qemuFound: false,
        qemuHint: "",
        kvmLabel: "",
        linuxImageReady: false,
        dockerFound: false,
        hasProvider: false,
        hasGoldenImage: false,
        setupCompleted: false,
        ready: false,
        needsWizard: true,
        hostOs: { platform: "linux", label: "Linux" },
        qemuInstall: {
          method: "apt",
          displayCommand: "",
          canInstall: false,
          packages: [],
          manualHint: "",
        },
      },
    });
    const dispatch = vi.fn();
    await render(config, dispatch);
    const advanced = navButton("Advanced");
    await act(async () => {
      advanced!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const button = [...host!.querySelectorAll("button")].find(
      (el) => el.textContent === "Reset all data",
    );
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });
    expect(api.resetAll).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "reset", config, hypervisorKind: "mock" }),
    );
  });

  it("shows collapsible provider cards, a footer hint, and Add provider", async () => {
    await render({
      ...config,
      providers: [
        config.providers[0]!,
        {
          id: "p2",
          name: "Anthropic",
          kind: "anthropic",
          baseUrl: "https://api.anthropic.com",
          models: ["claude-sonnet-4-5"],
          defaultModel: "claude-sonnet-4-5",
          enabled: true,
          extraHeaders: {},
        },
      ],
    });
    expect(host!.querySelector(".app-settings")).toBeTruthy();
    expect(host!.textContent).toContain("2 of 2 providers enabled");
    expect(host!.querySelector("[data-testid='settings-save-status']")?.textContent).toBe("Saved");
    expect([...host!.querySelectorAll("button")].some((btn) => btn.textContent === "Save")).toBe(
      false,
    );
    expect(host!.querySelector(".settings-nav-count")?.textContent).toBe("2");
    const cards = host!.querySelectorAll(".provider-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.classList.contains("open")).toBe(true);
    expect(cards[1]!.classList.contains("open")).toBe(false);
    expect(cards[1]!.querySelector("input")).toBeNull();
    await act(async () => {
      (cards[1]!.querySelector(".provider-card-summary") as HTMLButtonElement).click();
    });
    expect(cards[1]!.classList.contains("open")).toBe(true);
    expect(
      [...cards[1]!.querySelectorAll("input")].some(
        (el) => (el as HTMLInputElement).value === "https://api.anthropic.com",
      ),
    ).toBe(true);
    await act(async () => {
      (cards[1]!.querySelector('[role="switch"]') as HTMLButtonElement).click();
    });
    expect(cards[1]!.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    expect(host!.textContent).toContain("1 of 2 providers enabled");
    await act(async () => {
      [...host!.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Add provider")!
        .click();
    });
    expect(host!.querySelectorAll(".provider-card")).toHaveLength(3);
    expect(host!.textContent).toContain("Custom");
    expect(host!.textContent).toContain("of 3 providers enabled");
  });

  it("shows collapsible machine rows, a ready count, and Add machine", async () => {
    await render({
      ...config,
      templates: [
        config.templates[0]!,
        config.templates[1]!,
        {
          id: "windows-11",
          name: "Windows 11",
          os: "windows-11",
          description: "Windows guest",
          isoPath: "",
          hardware: { ...UBUNTU_DEFAULT_HARDWARE, memoryMb: 8192, diskSizeGb: 80 },
          networking: defaultNetworking("windows-11", 0),
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });
    await act(async () => {
      navButton("Machines")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(host!.textContent).toContain("1 of 3 ready");
    const rows = host!.querySelectorAll(".machine-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.classList.contains("open")).toBe(true);
    expect(rows[1]!.classList.contains("open")).toBe(false);
    expect(rows[0]!.querySelector("input")).toBeTruthy();
    expect(rows[1]!.querySelector("input")).toBeNull();
    expect(host!.textContent).toContain("4 c · 4096 MB · 40 GB");
    expect(host!.textContent).toContain("licensed ISO required");
    expect(host!.textContent).toContain("Host mock");
    expect(host!.textContent).toContain("OVMF");
    expect(host!.textContent).toContain("swtpm");
    await act(async () => {
      [...host!.querySelectorAll("button")].find((btn) => btn.textContent === "paths")!.click();
    });
    expect(host!.textContent).toContain("QEMU not found");
    await act(async () => {
      (rows[2]!.querySelector(".machine-row-head") as HTMLButtonElement).click();
    });
    expect(rows[2]!.classList.contains("open")).toBe(true);
    expect(host!.textContent).toContain("licensed ISO");
    expect(host!.textContent).toContain("VirtIO driver ISO");
    await act(async () => {
      [...host!.querySelectorAll("button")].find((btn) => btn.textContent === "Browse")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host!.textContent).toContain("ubuntu.img");
    await act(async () => {
      (
        [...host!.querySelectorAll(".host-folder-picker-list button")].find(
          (btn) => btn.textContent === "ubuntu.img",
        ) as HTMLButtonElement
      ).click();
    });
    expect((rows[2]!.querySelector(".machine-image-row input") as HTMLInputElement).value).toBe(
      "/media/ubuntu.img",
    );
    await act(async () => {
      [...host!.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Add machine")!
        .click();
    });
    expect(host!.querySelectorAll(".machine-row")).toHaveLength(4);
    expect(host!.textContent).toContain("Custom machine");
    expect(host!.textContent).toContain("2 of 4 ready");
  });

  it("shows an OpenRouter key hint on the provider card", async () => {
    await render({
      ...config,
      providers: [
        {
          id: "openrouter",
          name: "OpenRouter",
          kind: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          models: ["anthropic/claude-sonnet-4.5"],
          defaultModel: "anthropic/claude-sonnet-4.5",
          enabled: true,
          extraHeaders: {},
        },
      ],
    });
    expect(host!.textContent).toContain("openrouter.ai/keys");
    expect(host!.textContent).toContain("anthropic/claude-sonnet-4.5");
  });

  it("shows a Cursor CLI hint and optional key on the provider card", async () => {
    await render({
      ...config,
      providers: [
        {
          id: "cursor-cli",
          name: "Cursor CLI",
          kind: "cursor-cli",
          baseUrl: CURSOR_CLI_BASE_URL,
          models: ["composer-2"],
          defaultModel: "composer-2",
          enabled: true,
          extraHeaders: {},
        },
      ],
    });
    expect(host!.textContent).toContain("CLI binary");
    expect(host!.textContent).toContain("agent -p");
    expect(host!.textContent).toContain("cursor.com/install");
    expect(host!.textContent).toContain("cursor-agent.cmd");
    expect(host!.textContent).toContain("worker host");
    expect(host!.textContent).toContain("Steer interrupts");
    expect(host!.textContent).not.toContain("Add a key to enable this provider");
    expect(host!.querySelector('[aria-label="Fast"]')).toBeTruthy();
    expect(
      host!
        .querySelector('[aria-label="Fast"]')
        ?.closest("[data-value]")
        ?.getAttribute("data-value"),
    ).toBe("off");
  });

  it("shows a Claude Code hint and optional key on the provider card", async () => {
    await render({
      ...config,
      providers: [
        {
          id: "claude-code",
          name: "Claude Code",
          kind: "claude-code",
          baseUrl: CLAUDE_CODE_BASE_URL,
          models: ["claude-sonnet-4-5"],
          defaultModel: "claude-sonnet-4-5",
          enabled: true,
          extraHeaders: {},
        },
      ],
    });
    expect(host!.textContent).toContain("CLI binary");
    expect(host!.textContent).toContain("claude -p");
    expect(host!.textContent).toContain("code.claude.com");
    expect(host!.textContent).toContain("Steer interrupts");
    expect(host!.textContent).toContain("claude auth login");
    expect(host!.textContent).not.toContain("Add a key to enable this provider");
  });

  it("shows a Kiro CLI hint and optional key on the provider card", async () => {
    await render({
      ...config,
      providers: [
        {
          id: "kiro-cli",
          name: "Kiro CLI",
          kind: "kiro-cli",
          baseUrl: KIRO_CLI_BASE_URL,
          models: ["auto"],
          defaultModel: "auto",
          enabled: true,
          extraHeaders: {},
        },
      ],
    });
    expect(host!.textContent).toContain("CLI binary");
    expect(host!.textContent).toContain("kiro-cli chat --no-interactive");
    expect(host!.textContent).toContain("cli.kiro.dev");
    expect(host!.textContent).toContain("Steer interrupts");
    expect(host!.textContent).toContain("kiro-cli login");
    expect(host!.textContent).not.toContain("Add a key to enable this provider");
  });

  it("finds a provider and jumps to that card", async () => {
    await render();
    await act(async () => {
      navButton("Appearance")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector("h2")?.textContent).toBe("Appearance");
    expect(host!.querySelector(".settings-find-wrap .search-icon svg")).toBeTruthy();
    const find = host!.querySelector("[aria-label='Find a setting']") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(find, "openai");
      find.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host!.querySelector(".settings-find-hits")?.textContent).toMatch(/Providers · OpenAI/);
    await act(async () => {
      find.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(host!.querySelector("h2")?.textContent).toBe("Providers");
    expect(host!.querySelector(".provider-card.open")?.textContent).toMatch(/OpenAI/);
  });

  it("saves pending Settings changes on Close instead of asking to discard", async () => {
    await render();
    expect(host!.querySelector("[data-testid='settings-save-status']")?.textContent).toBe("Saved");
    await act(async () => {
      (host!.querySelector('[role="switch"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector("[data-testid='settings-save-status']")?.textContent).toBe(
      "Saving…",
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const close = [...host!.querySelectorAll("button")].find((el) => el.textContent === "Close");
    await act(async () => {
      close!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(api.saveConfig).toHaveBeenCalled();
    expect(host!.querySelector(".app-settings")).toBeNull();
  });

  it("lists live VMs on Machines and can open or stop them", async () => {
    const dispatch = vi.fn();
    vi.mocked(api.stopVm).mockResolvedValue({} as never);
    await render(config, dispatch, {
      sessions: [
        {
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
        },
      ],
      vms: [
        {
          id: "v1",
          sessionId: "s1",
          templateId: "ubuntu-24.04",
          os: "ubuntu",
          name: "ubuntu",
          status: "running",
          diskPath: "/tmp/disk.qcow2",
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });
    await act(async () => {
      navButton("Machines")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector("[data-testid='machine-inventory']")?.textContent).toContain(
      "Ubuntu agent",
    );
    expect(host!.textContent).toContain("running");
    await act(async () => {
      (
        [...host!.querySelectorAll(".machine-inventory-row button")].find(
          (btn) => btn.textContent === "Stop",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(api.stopVm).toHaveBeenCalledWith("s1");
    await act(async () => {
      (
        [...host!.querySelectorAll(".machine-inventory-row button")].find(
          (btn) => btn.textContent === "Open",
        ) as HTMLButtonElement
      ).click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "s1" });
  });
});
