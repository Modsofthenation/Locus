import { describe, expect, it } from "vitest";
import {
  SETTINGS_NAV_GROUPS,
  isSwarmSettingsTab,
  settingsNavCount,
  settingsNavGroupsForMode,
  settingsNavLabel,
  settingsNavTabs,
  settingsSearchHits,
} from "./settingsNav";

describe("settingsNav", () => {
  it("keeps the grouped labels used in the sidebar", () => {
    expect(SETTINGS_NAV_GROUPS.map((group) => group.label)).toEqual([
      "Models",
      "Workspace",
      "System",
    ]);
    expect(SETTINGS_NAV_GROUPS.flatMap((group) => group.items.map(settingsNavLabel))).toEqual([
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
  });

  it("counts list-backed tabs from config", () => {
    expect(settingsNavCount("appearance", null)).toBeUndefined();
    expect(
      settingsNavCount("providers", {
        theme: "ember",
        providers: [
          {
            id: "p1",
            name: "OpenAI",
            kind: "openai",
            baseUrl: "https://api.openai.com/v1",
            models: [],
            defaultModel: "",
            enabled: true,
            extraHeaders: {},
          },
        ],
        templates: [],
        hardwareProfiles: [],
        forges: [],
        mcpServers: [],
        skills: [{ id: "s1", name: "review", title: "Review", hint: "", body: "", enabled: true }],
        workers: [],
        namedEnvironments: [],
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
      }),
    ).toBe(1);
  });

  it("lists tabs in sidebar order", () => {
    expect(settingsNavTabs()).toEqual([
      "providers",
      "mcp",
      "skills",
      "machines",
      "workers",
      "environments",
      "git",
      "integrations",
      "appearance",
      "notifications",
      "phone",
      "chrome",
      "advanced",
      "about",
    ]);
  });

  it("keeps Advanced in Swarm settings so operators can reach limits", () => {
    expect(settingsNavGroupsForMode("swarm").map((group) => group.label)).toEqual(["Swarm"]);
    expect(settingsNavTabs("swarm")).toEqual([
      "providers",
      "appearance",
      "notifications",
      "advanced",
      "about",
    ]);
    expect(isSwarmSettingsTab("appearance")).toBe(true);
    expect(isSwarmSettingsTab("providers")).toBe(true);
    expect(isSwarmSettingsTab("advanced")).toBe(true);
    expect(isSwarmSettingsTab("machines")).toBe(false);
  });

  it("matches tab names and card titles", () => {
    expect(settingsSearchHits(null, "  git ")).toEqual([{ tab: "git", label: "Git" }]);
    const config = {
      theme: "ember" as const,
      providers: [
        {
          id: "p1",
          name: "OpenAI",
          kind: "openai" as const,
          baseUrl: "https://api.openai.com/v1",
          models: [],
          defaultModel: "",
          enabled: true,
          extraHeaders: {},
        },
      ],
      templates: [],
      hardwareProfiles: [],
      forges: [
        {
          id: "g1",
          kind: "github" as const,
          name: "Work GitHub",
          apiBaseUrl: "https://api.github.com",
        },
      ],
      mcpServers: [
        { id: "m1", name: "GitHub MCP", enabled: true, command: "mcp-github", args: [], env: {} },
      ],
      skills: [{ id: "s1", name: "review", title: "PR review", hint: "", body: "", enabled: true }],
      workers: [{ id: "w1", name: "office-box", url: "https://worker.local:7430" }],
      namedEnvironments: [
        {
          id: "e1",
          name: "acme-prod",
          runtime: "docker" as const,
          os: "ubuntu" as const,
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      ],
      integrations: [
        {
          id: "i1",
          kind: "slack" as const,
          name: "Locus Slack",
          enabled: true,
          baseUrl: "https://slack.com",
        },
      ],
      advanced: {
        dataDir: "/tmp",
        qemuBinary: "qemu-system-x86_64",
        swtpmBinary: "swtpm",
        ovmfCodePath: "",
        ovmfVarsPath: "",
        maxConcurrentVms: 4,
        defaultAcceleratorAuto: true,
        logLevel: "info" as const,
        bindHost: "127.0.0.1",
        bindPort: 7420,
        openBrowserOnStart: true,
        hostSharePath: "",
      },
    };
    expect(settingsSearchHits(config, "openai").some((hit) => hit.id === "p1")).toBe(true);
    expect(settingsSearchHits(config, "office-box")).toEqual([
      { tab: "workers", id: "w1", label: "office-box" },
    ]);
    expect(settingsSearchHits(config, "PR review")[0]).toMatchObject({ tab: "skills", id: "s1" });
    expect(settingsSearchHits(config, "")).toEqual([]);
  });
});
