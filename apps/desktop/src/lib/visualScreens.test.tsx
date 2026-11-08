import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  THEME_OPTIONS,
  UBUNTU_DEFAULT_HARDWARE,
  defaultNetworking,
  themeOption,
  type LocusConfig,
} from "@locus/shared";
import { NewSessionModal } from "@/components/chat/NewSession";
import { NewAutomationModal } from "@/components/automations/NewAutomation";
import { EmptyHero } from "@/components/layout/EmptyHero";
import { Store, initialState } from "@/state/store";
import { MORE_RAIL_SECTIONS, PRIMARY_RAIL_SECTIONS, primaryRailSections } from "./railNav";

vi.mock("@/lib/api", () => ({
  api: {
    images: vi.fn(async () => []),
    workersStatus: vi.fn(async () => []),
    createSession: vi.fn(),
    createAutomation: vi.fn(),
    browseHost: vi.fn(),
    saveConfig: vi.fn(async (config) => config),
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

describe("visual screens contract", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    host?.remove();
  });

  it("keeps Contrast as the featured high-contrast theme name", () => {
    expect(themeOption("contrast").name).toBe("Contrast");
    expect(THEME_OPTIONS.find((row) => row.id === "contrast")?.name).toBe("Contrast");
  });

  it("renders New agent without a native select on the default path", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, newOpen: true },
            dispatch: () => undefined,
          }}
        >
          <NewSessionModal />
        </Store.Provider>,
      );
    });
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector("#new-session-title")?.textContent).toBe("New agent");
    expect(host.querySelector('[aria-label="More options"]')).toBeTruthy();
    expect(host.querySelector(".ui-select")).toBeTruthy();
  });

  it("renders New automation trigger-first with a themed schedule picker", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, newAutomationOpen: true },
            dispatch: () => undefined,
          }}
        >
          <NewAutomationModal />
        </Store.Provider>,
      );
    });
    expect(host.querySelector("[data-testid='auto-trigger-family']")).toBeTruthy();
    const schedule = host.querySelector('[aria-label="Schedule"]');
    expect(schedule).toBeTruthy();
    expect(schedule instanceof HTMLSelectElement).toBe(false);
  });

  it("uses one empty-hero pattern", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<EmptyHero title="Board" lead="A local planning canvas." />);
    });
    expect(host.querySelector(".empty-hero h2")?.textContent).toBe("Board");
    expect(host.querySelector(".empty-hero p")?.textContent).toContain("planning canvas");
    expect(host.querySelector(".mascot")).toBeTruthy();
  });

  it("lists the visual harness screens including dialogs and empty states", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../visual.tsx"),
      "utf8",
    );
    for (const screen of [
      "confirm",
      "prompt",
      "toast",
      "appearance",
      "design-empty",
      "ide-empty",
      "settings-providers",
      "feedback",
      "shortcuts",
      "chat",
      "empty-hint",
      "splitter",
    ]) {
      expect(source).toContain(`"${screen}"`);
    }
  });

  it("keeps five primary rails and Swarm Teammates + Teams", () => {
    expect([...PRIMARY_RAIL_SECTIONS]).toEqual([
      "agents",
      "design",
      "ide",
      "codebase",
      "automations",
    ]);
    expect([...MORE_RAIL_SECTIONS]).toContain("brain");
    expect([...primaryRailSections("swarm")]).toEqual(["agents", "project"]);
  });
});
