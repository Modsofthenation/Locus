import { describe, expect, it } from "vitest";
import type { AgentSession } from "@locus/shared";
import { SETTINGS_NAV_GROUPS, settingsNavLabel } from "./settingsNav";
import {
  PALETTE_SHORTCUTS,
  applyPaletteRecents,
  editorOwnsCommandK,
  filterPaletteItems,
  isPaletteShortcutsQuery,
  paletteItems,
  paletteItemsForMode,
} from "./palette";

function session(id: string, title: string): AgentSession {
  return {
    id,
    title,
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
}

describe("paletteItems", () => {
  it("lists agents, guest actions, and themes", () => {
    const current = session("a", "Fix login");
    const items = paletteItems({
      sessions: [current],
      session: current,
      vm: {
        id: "v1",
        sessionId: "a",
        templateId: "ubuntu-24.04",
        os: "ubuntu",
        name: "Ubuntu",
        status: "running",
        diskPath: "/tmp/disk.qcow2",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(items.some((i) => i.id === "session:a")).toBe(true);
    expect(filterPaletteItems(items, "fix login").map((i) => i.id)).toContain("session:a");
    expect(items.some((i) => i.id === "guest-stop")).toBe(true);
    expect(items.some((i) => i.id === "chat-find")).toBe(true);
    expect(items.some((i) => i.id === "chat-archive")).toBe(true);
    expect(items.some((i) => i.id === "chat-clear")).toBe(true);
    expect(filterPaletteItems(items, "clear chat").map((i) => i.id)).toEqual(["chat-clear"]);
    expect(items.some((i) => i.id === "guest-save-image")).toBe(true);
    expect(items.some((i) => i.id === "guest-replay")).toBe(true);
    expect(items.some((i) => i.id === "guest-compare")).toBe(true);
    expect(items.some((i) => i.id === "chat-export-html")).toBe(true);
    expect(items.some((i) => i.id === "chat-export-pdf")).toBe(true);
    expect(filterPaletteItems(items, "export html").map((i) => i.id)).toEqual(["chat-export-html"]);
    expect(items.some((i) => i.id === "theme:ember")).toBe(true);
    expect(items.some((i) => i.id === "theme:tokyo")).toBe(true);
    expect(items.some((i) => i.id === "theme:linen")).toBe(true);
    expect(items.some((i) => i.id === "theme:beacon")).toBe(true);
    expect(items.some((i) => i.id === "theme:ion")).toBe(true);
    expect(items.some((i) => i.id === "theme:siren")).toBe(true);
    expect(items.some((i) => i.id === "theme:keel")).toBe(true);
    expect(items.some((i) => i.id === "theme:brief")).toBe(true);
    expect(items.some((i) => i.id === "theme:solstice")).toBe(true);
    expect(items.some((i) => i.id === "theme:hotdog")).toBe(true);
    expect(items.some((i) => i.id === "theme:cosmos")).toBe(true);
    expect(items.some((i) => i.id === "theme:andromeda")).toBe(true);
    expect(items.some((i) => i.id === "theme:cel")).toBe(true);
    expect(items.some((i) => i.id === "theme:toon")).toBe(true);
    expect(items.some((i) => i.id === "theme:noir")).toBe(true);
    expect(items.some((i) => i.id === "theme:snow")).toBe(true);
    expect(items.some((i) => i.id === "theme:flare")).toBe(true);
    expect(items.some((i) => i.id === "theme:horizon")).toBe(true);
    expect(items.some((i) => i.id === "theme:daybreak")).toBe(true);
    expect(items.some((i) => i.id === "theme:reef")).toBe(true);
    expect(items.some((i) => i.id === "theme:saffron")).toBe(true);
    expect(items.some((i) => i.id === "theme:ruby")).toBe(true);
    expect(items.some((i) => i.id === "theme:canopy")).toBe(true);
    expect(items.some((i) => i.id === "theme:glaze")).toBe(true);
    expect(items.some((i) => i.id === "theme:console")).toBe(true);
    expect(filterPaletteItems(items, "golden").map((i) => i.id)).toEqual(["guest-save-image"]);
    expect(filterPaletteItems(items, "ember")[0]?.id).toBe("theme:ember");
    expect(filterPaletteItems(items, "night city")[0]?.id).toBe("theme:tokyo");
    expect(filterPaletteItems(items, "beacon")[0]?.id).toBe("theme:beacon");
    expect(filterPaletteItems(items, "ion").some((i) => i.id === "theme:ion")).toBe(true);
    expect(filterPaletteItems(items, "ion").map((i) => i.id)).not.toContain("section:automations");
    expect(filterPaletteItems(items, "siren")[0]?.id).toBe("theme:siren");
    expect(filterPaletteItems(items, "glacier")[0]?.id).toBe("theme:glacier");
    expect(filterPaletteItems(items, "crypt")[0]?.id).toBe("theme:crypt");
    expect(filterPaletteItems(items, "mono")[0]?.id).toBe("theme:mono");
    expect(filterPaletteItems(items, "brief")[0]?.id).toBe("theme:brief");
    expect(filterPaletteItems(items, "solstice")[0]?.id).toBe("theme:solstice");
    expect(filterPaletteItems(items, "hotdog")[0]?.id).toBe("theme:hotdog");
    expect(filterPaletteItems(items, "andromeda")[0]?.id).toBe("theme:andromeda");
    expect(filterPaletteItems(items, "hubble")[0]?.id).toBe("theme:hubble");
    expect(filterPaletteItems(items, "cel")[0]?.id).toBe("theme:cel");
    expect(filterPaletteItems(items, "toon")[0]?.id).toBe("theme:toon");
    expect(filterPaletteItems(items, "noir")[0]?.id).toBe("theme:noir");
    expect(filterPaletteItems(items, "arctic")[0]?.id).toBe("theme:snow");
    expect(filterPaletteItems(items, "hot-orange")[0]?.id).toBe("theme:flare");
    expect(filterPaletteItems(items, "sunset wash")[0]?.id).toBe("theme:horizon");
    expect(filterPaletteItems(items, "daybreak")[0]?.id).toBe("theme:daybreak");
    expect(filterPaletteItems(items, "tropical wash")[0]?.id).toBe("theme:reef");
    expect(filterPaletteItems(items, "saffron")[0]?.id).toBe("theme:saffron");
    expect(filterPaletteItems(items, "ruby")[0]?.id).toBe("theme:ruby");
    expect(filterPaletteItems(items, "forest wash")[0]?.id).toBe("theme:canopy");
    expect(filterPaletteItems(items, "porcelain wash")[0]?.id).toBe("theme:glaze");
    expect(filterPaletteItems(items, "terminal window")[0]?.id).toBe("theme:console");
    const idle = paletteItems({ sessions: [current], session: current });
    expect(idle.some((i) => i.id === "guest-start")).toBe(true);
    expect(idle.some((i) => i.id === "guest-save-image")).toBe(false);
  });

  it("groups design sessions separately from agents", () => {
    const agent = session("a", "Fix login");
    const design: AgentSession = {
      ...session("d1", "Landing page"),
      kind: "design",
      runtime: "docker",
    };
    const hostAgent: AgentSession = {
      ...session("h1", "Local app"),
      runtime: "host",
    };
    const workspace: AgentSession = {
      ...session("i1", "Workspace"),
      kind: "ide",
      runtime: "host",
    };
    const items = paletteItems({ sessions: [agent, design, hostAgent, workspace] });
    expect(items.find((i) => i.id === "session:a")?.group).toBe("Agents");
    expect(items.find((i) => i.id === "session:d1")?.group).toBe("Design");
    expect(items.find((i) => i.id === "session:h1")?.group).toBe("Agents");
    expect(items.find((i) => i.id === "session:i1")?.group).toBe("IDE");
    expect(items.find((i) => i.id === "section:ide")?.group).toBe("IDE");
    expect(items.find((i) => i.id === "new-workspace")?.group).toBe("IDE");
    expect(
      paletteItems({ sessions: [workspace], session: workspace }).find(
        (i) => i.id === "workspace-goto",
      ),
    ).toMatchObject({ group: "IDE", hint: "Ctrl/Cmd+P" });
    expect(
      paletteItems({ sessions: [workspace], session: workspace }).find(
        (i) => i.id === "workspace-goto-symbol",
      ),
    ).toMatchObject({ group: "IDE", hint: "Ctrl/Cmd+T" });
    expect(
      paletteItems({ sessions: [workspace], session: workspace }).find(
        (i) => i.id === "workspace-search",
      ),
    ).toMatchObject({ group: "IDE", hint: "Ctrl/Cmd+Shift+F" });
    expect(
      paletteItems({ sessions: [workspace], session: workspace }).find(
        (i) => i.id === "workspace-reindex",
      ),
    ).toMatchObject({ group: "IDE", title: "Re-index workspace" });
    expect(
      paletteItems({ sessions: [workspace], session: workspace }).find(
        (i) => i.id === "workspace-terminal",
      ),
    ).toMatchObject({ group: "IDE", hint: "Ctrl/Cmd+`" });
    expect(
      paletteItems({ sessions: [workspace], session: workspace }).find(
        (i) => i.id === "workspace-format",
      ),
    ).toMatchObject({ group: "IDE", title: "Format document" });
    expect(
      paletteItems({ sessions: [workspace], session: workspace }).find(
        (i) => i.id === "workspace-split",
      ),
    ).toMatchObject({ group: "IDE", hint: "Ctrl/Cmd+\\" });
    expect(
      paletteItems({ sessions: [workspace], session: workspace }).find(
        (i) => i.id === "workspace-terminal-new",
      )?.title,
    ).toBe("New terminal");
    expect(
      paletteItems({ sessions: [hostAgent], session: hostAgent }).find(
        (i) => i.id === "workspace-goto",
      )?.group,
    ).toBe("Guest");
    expect(
      paletteItems({ sessions: [hostAgent], session: hostAgent }).find(
        (i) => i.id === "workspace-terminal",
      )?.group,
    ).toBe("Agents");
    expect(
      paletteItems({ sessions: [agent], session: agent }).find((i) => i.id === "workspace-goto")
        ?.group,
    ).toBe("Guest");
    expect(
      paletteItems({ sessions: [design], session: design }).some((i) => i.id === "workspace-goto"),
    ).toBe(false);
    expect(items.some((i) => i.id === "design-systems")).toBe(true);
    expect(items.some((i) => i.id === "asset-styles")).toBe(true);
    expect(filterPaletteItems(items, "canvas").map((i) => i.id)).toEqual(["session:d1"]);
  });

  it("groups game sessions separately from design", () => {
    const design: AgentSession = {
      ...session("d1", "Landing page"),
      kind: "design",
      runtime: "docker",
    };
    const game: AgentSession = {
      ...session("g1", "Arcade"),
      kind: "game",
      runtime: "docker",
    };
    const asset: AgentSession = {
      ...session("as1", "Hero mesh"),
      kind: "assets",
      runtime: "docker",
    };
    const items = paletteItems({ sessions: [design, game, asset] });
    expect(items.find((i) => i.id === "session:d1")?.group).toBe("Design");
    expect(items.find((i) => i.id === "session:g1")?.group).toBe("Games");
    expect(items.find((i) => i.id === "session:as1")?.group).toBe("Assets");
    expect(items.find((i) => i.id === "section:games")?.group).toBe("Games");
    expect(items.find((i) => i.id === "section:assets")?.group).toBe("Assets");
    expect(filterPaletteItems(items, "canvas").map((i) => i.id)).toEqual(["session:d1"]);
    expect(filterPaletteItems(items, "playable").map((i) => i.id)).toContain("session:g1");
    expect(filterPaletteItems(items, "playable").map((i) => i.id)).not.toContain("session:d1");
    expect(filterPaletteItems(items, "rig").map((i) => i.id)).toContain("session:as1");
  });

  it("lists linked repos in a Codebase group", () => {
    const items = paletteItems({
      sessions: [],
      repos: [
        {
          id: "r1",
          name: "acme/app",
          checkout: { forge: "gitlab", url: "https://gitlab.com/acme/app.git" },
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(items.find((i) => i.id === "repo:r1")).toMatchObject({
      group: "Codebase",
      hint: "GitLab",
    });
    expect(filterPaletteItems(items, "gitlab").map((i) => i.id)).toEqual(["repo:r1"]);
  });

  it("lists Slack channels", () => {
    const items = paletteItems({
      sessions: [],
      slackConversations: [
        { id: "C_ENG", name: "eng", kind: "channel" },
        { id: "D_BOB", name: "bob", kind: "im" },
      ],
    });
    expect(items.find((i) => i.id === "section:slack")?.group).toBe("Slack");
    expect(items.find((i) => i.id === "slack:C_ENG")).toMatchObject({
      title: "#eng",
      group: "Slack",
    });
    expect(items.find((i) => i.id === "slack:D_BOB")?.title).toBe("@bob");
    expect(filterPaletteItems(items, "#eng").map((i) => i.id)).toEqual(["slack:C_ENG"]);
  });

  it("lists Grafana explorer", () => {
    const items = paletteItems({ sessions: [] });
    expect(items.find((i) => i.id === "section:grafana")).toMatchObject({
      title: "Grafana",
      group: "Grafana",
    });
    expect(filterPaletteItems(items, "lucene").map((i) => i.id)).toContain("section:grafana");
  });

  it("lists Docker containers", () => {
    const items = paletteItems({
      sessions: [],
      containers: [
        {
          id: "c1",
          name: "web",
          image: "nginx:alpine",
          state: "running",
          status: "Up 2 hours",
          createdAt: "2020-01-01T00:00:00.000Z",
          locus: false,
        },
        {
          id: "c2",
          name: "api",
          image: "node:22",
          state: "running",
          status: "Up 1 hour",
          createdAt: "2020-01-01T00:00:00.000Z",
          locus: false,
        },
      ],
    });
    expect(items.find((i) => i.id === "section:docker")?.group).toBe("Docker");
    expect(items.find((i) => i.id === "docker-stop-running")).toMatchObject({
      title: "Stop 2 running containers",
      group: "Docker",
    });
    expect(items.find((i) => i.id === "container:c1")).toMatchObject({
      title: "web",
      group: "Docker",
    });
    expect(filterPaletteItems(items, "nginx").map((i) => i.id)).toEqual(["container:c1"]);
    expect(filterPaletteItems(items, "bulk").map((i) => i.id)).toEqual([
      "section:docker",
      "docker-stop-running",
    ]);
  });

  it("lists every settings tab from SETTINGS_NAV_GROUPS", () => {
    const items = paletteItems({ sessions: [] });
    const tabs = SETTINGS_NAV_GROUPS.flatMap((group) => group.items);
    expect(tabs).toEqual([
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
    for (const tab of tabs) {
      expect(items.find((i) => i.id === `settings:${tab}`)).toMatchObject({
        title: `Settings · ${settingsNavLabel(tab)}`,
        group: "Settings",
      });
    }
    expect(filterPaletteItems(items, "mcp").map((i) => i.id)).toEqual([
      "settings:mcp",
      "feature:mcp",
    ]);
    expect(filterPaletteItems(items, "providers")[0]?.id).toBe("settings:providers");
    expect(filterPaletteItems(items, "git")[0]?.id).toBe("settings:git");
    expect(filterPaletteItems(items, "integrations")[0]?.id).toBe("settings:integrations");
    expect(filterPaletteItems(items, "quiet")[0]?.id).toBe("settings:notifications");
    expect(filterPaletteItems(items, "ion").map((i) => i.id)).not.toContain(
      "settings:integrations",
    );
  });

  it("indexes provider, MCP, skill, and worker names on settings rows", () => {
    const items = paletteItems({
      sessions: [],
      config: {
        providers: [{ id: "p1", name: "OpenAI", kind: "openai" }],
        mcpServers: [{ id: "m1", name: "filesystem", command: "npx", url: "" }],
        skills: [{ id: "s1", name: "review", title: "Code review" }],
        workers: [{ id: "w1", name: "office-box", url: "http://127.0.0.1:7421" }],
      } as never,
    });
    expect(filterPaletteItems(items, "OpenAI").map((i) => i.id)).toContain("settings:providers");
    expect(filterPaletteItems(items, "filesystem").map((i) => i.id)).toContain("settings:mcp");
    expect(filterPaletteItems(items, "review").map((i) => i.id)).toContain("settings:skills");
    expect(filterPaletteItems(items, "office-box").map((i) => i.id)).toContain("settings:workers");
  });

  it("lists automations and each job", () => {
    const items = paletteItems({
      sessions: [],
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
    });
    expect(items.find((i) => i.id === "section:automations")?.group).toBe("Jobs");
    expect(items.find((i) => i.id === "automation:auto-1")).toMatchObject({
      title: "Nightly",
      hint: "On · Every 30 minutes",
      group: "Jobs",
    });
    expect(filterPaletteItems(items, "nightly").map((i) => i.id)).toEqual(["automation:auto-1"]);
  });

  it("lists boards and each canvas", () => {
    const items = paletteItems({
      sessions: [],
      boards: [
        {
          id: "b1",
          title: "Sprint 12",
          updatedAt: "2020-01-02T00:00:00.000Z",
          createdAt: "2020-01-01T00:00:00.000Z",
          objectCount: 8,
          frameCount: 2,
          starter: "sprint",
        },
      ],
    });
    expect(items.find((i) => i.id === "section:board")?.group).toBe("Board");
    expect(items.find((i) => i.id === "board:b1")).toMatchObject({
      title: "Sprint 12",
      hint: "8 objects",
      group: "Board",
    });
    expect(filterPaletteItems(items, "sprint 12").map((i) => i.id)).toEqual(["board:b1"]);
  });

  it("lists projects and each coordinator", () => {
    const items = paletteItems({
      sessions: [],
      projects: [
        {
          id: "p1",
          title: "Auth",
          updatedAt: "2020-01-02T00:00:00.000Z",
          createdAt: "2020-01-01T00:00:00.000Z",
          starter: "feature",
          memberCount: 2,
        },
      ],
    });
    expect(items.find((i) => i.id === "section:project")?.group).toBe("Project");
    expect(items.find((i) => i.id === "project:p1")).toMatchObject({
      title: "Auth",
      hint: "2 members",
      group: "Project",
    });
    expect(filterPaletteItems(items, "auth").map((i) => i.id)).toEqual(["project:p1"]);
  });

  it("lists create actions and Finish setup when todos remain", () => {
    const items = paletteItems({
      sessions: [],
      setup: {
        hypervisorKind: "mock",
        qemuFound: false,
        qemuHint: "",
        kvmLabel: "",
        linuxImageReady: false,
        dockerFound: false,
        hasProvider: false,
        hasGoldenImage: false,
        setupCompleted: true,
        ready: false,
        needsWizard: false,
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
    expect(items.find((i) => i.id === "new-agent")).toMatchObject({
      title: "New agent",
      group: "Agents",
    });
    expect(items.find((i) => i.id === "new-design")?.group).toBe("Design");
    expect(items.find((i) => i.id === "new-game")?.group).toBe("Games");
    expect(items.find((i) => i.id === "section:games")?.group).toBe("Games");
    expect(items.find((i) => i.id === "new-asset")?.group).toBe("Assets");
    expect(items.find((i) => i.id === "section:assets")?.group).toBe("Assets");
    expect(items.find((i) => i.id === "section:board")?.group).toBe("Board");
    expect(items.find((i) => i.id === "new-board")?.group).toBe("Board");
    expect(items.find((i) => i.id === "new-workspace")?.group).toBe("IDE");
    expect(items.find((i) => i.id === "new-automation")?.group).toBe("Jobs");
    expect(items.find((i) => i.id === "finish-setup")).toMatchObject({
      title: "Finish setup",
      group: "Help",
    });
    expect(filterPaletteItems(items, "new agent").map((i) => i.id)).toContain("new-agent");
    const complete = paletteItems({
      sessions: [],
      setup: {
        hypervisorKind: "qemu",
        qemuFound: true,
        qemuHint: "",
        kvmLabel: "",
        linuxImageReady: true,
        dockerFound: true,
        hasProvider: true,
        hasGoldenImage: false,
        setupCompleted: true,
        ready: true,
        needsWizard: false,
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
    expect(complete.some((i) => i.id === "finish-setup")).toBe(false);
  });

  it("lists the Needs you inbox and waiting agents", () => {
    const gated = {
      ...session("s2", "Ship"),
      needsHuman: "Protected branch main",
    };
    const items = paletteItems({ sessions: [session("a", "Fix login"), gated] });
    expect(items.find((i) => i.id === "needs-you")).toMatchObject({
      title: "Needs you · 1",
      group: "Needs you",
    });
    expect(items.find((i) => i.id === "needs-you:s2")).toMatchObject({
      title: "Ship",
      hint: "Protected branch main",
      group: "Needs you",
    });
    expect(filterPaletteItems(items, "waiting").map((i) => i.id)).toEqual([
      "needs-you",
      "needs-you:s2",
    ]);
  });

  it("lists unresolved board comments in Needs you", () => {
    const items = paletteItems({
      sessions: [],
      boards: [
        {
          id: "b1",
          title: "Retro",
          createdAt: "t",
          updatedAt: "t",
          objectCount: 2,
          frameCount: 1,
          pendingComments: [{ id: "c9", objectId: "s1", body: "Name the owner", author: "agent" }],
        },
      ],
    });
    expect(items.find((i) => i.id === "needs-you")).toMatchObject({
      title: "Needs you · 1",
    });
    expect(items.find((i) => i.id === "needs-you:board:b1:s1")).toMatchObject({
      title: "Retro",
      hint: "Name the owner",
      group: "Needs you",
    });
  });

  it("lists open brain corrections in Needs you", () => {
    const items = paletteItems({
      sessions: [],
      brain: {
        id: "default",
        title: "Brain",
        nodeCount: 1,
        edgeCount: 0,
        memoryCount: 0,
        updatedAt: "t",
        empty: false,
        inboxCount: 1,
      },
    });
    expect(items.find((i) => i.id === "needs-you")).toMatchObject({
      title: "Needs you · 1",
    });
    expect(items.find((i) => i.id === "needs-you:brain")).toMatchObject({
      title: "Brain",
      hint: "1 graph correction",
      group: "Needs you",
    });
  });

  it("offers takeover when a VM guest is running and handback when driving", () => {
    const current = session("a", "Fix login");
    const vm = {
      id: "v1",
      sessionId: "a",
      templateId: "ubuntu-24.04",
      os: "ubuntu" as const,
      name: "Ubuntu",
      status: "running" as const,
      diskPath: "/tmp/disk.qcow2",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const running = paletteItems({ sessions: [current], session: current, vm });
    expect(running.some((i) => i.id === "guest-takeover")).toBe(true);
    expect(running.some((i) => i.id === "guest-handback")).toBe(false);
    const driving = paletteItems({
      sessions: [{ ...current, control: "human" }],
      session: { ...current, control: "human" },
      vm,
    });
    expect(driving.some((i) => i.id === "guest-handback")).toBe(true);
    expect(driving.some((i) => i.id === "guest-takeover")).toBe(false);
  });

  it("lists keyboard shortcuts and treats ? as the cheat sheet query", () => {
    const items = paletteItems({ sessions: [] });
    expect(items.find((i) => i.id === "keyboard-shortcuts")).toMatchObject({
      group: "Help",
      hint: "Ctrl/Cmd+N, K, F, comma, 1–9, F12",
    });
    expect(PALETTE_SHORTCUTS.map((row) => row.keys)).toEqual([
      "Ctrl/Cmd+N",
      "Ctrl/Cmd+K",
      "Ctrl/Cmd+Shift+K",
      "Ctrl/Cmd+P",
      "Ctrl/Cmd+T",
      "Ctrl/Cmd+Shift+F",
      "Ctrl/Cmd+`",
      "Ctrl/Cmd+,",
      "Ctrl/Cmd+F",
      "Ctrl/Cmd+1–9",
      "Alt+1–9",
      "F12",
      "Alt+F12",
      "Ctrl/Cmd+.",
      "Ctrl/Cmd+W",
      "Ctrl/Cmd+\\",
      "Ctrl/Cmd+S",
      "Ctrl/Cmd+Shift+S",
      "Ctrl/Cmd+Z",
      "Ctrl/Cmd+Shift+Z",
      "F2",
      "Ctrl+Space",
      "Alt+Shift+F",
      "Tab then Enter",
      "R P D M",
      "V H N T R L F C",
      "Ctrl/Cmd+0",
      "Ctrl/Cmd+] [",
    ]);
    expect(isPaletteShortcutsQuery("?")).toBe(true);
    expect(isPaletteShortcutsQuery(" ? ")).toBe(true);
    expect(isPaletteShortcutsQuery("help")).toBe(false);
    expect(filterPaletteItems(items, "cheat").map((i) => i.id)).toEqual(["keyboard-shortcuts"]);
  });

  it("indexes buried features under Help with synonyms", () => {
    const items = paletteItems({ sessions: [] });
    expect(filterPaletteItems(items, "webhook").map((i) => i.id)).toContain("feature:webhooks");
    expect(filterPaletteItems(items, "memory").map((i) => i.id)).toContain("feature:memory");
    expect(filterPaletteItems(items, "mcp").map((i) => i.id)).toContain("feature:mcp");
    expect(items.some((i) => i.id === "section:codebase")).toBe(true);
  });

  it("leaves Ctrl/Cmd+K to the palette unless inline AI is focused", () => {
    const main = document.createElement("div");
    main.className = "workspace-code-main";
    const ta = document.createElement("textarea");
    main.appendChild(ta);
    document.body.appendChild(main);
    expect(editorOwnsCommandK(ta)).toBe(false);
    expect(editorOwnsCommandK(document.createElement("input"))).toBe(false);
    const box = document.createElement("div");
    box.setAttribute("data-editor-inline-ai", "");
    const prompt = document.createElement("textarea");
    box.appendChild(prompt);
    document.body.appendChild(box);
    expect(editorOwnsCommandK(prompt)).toBe(true);
    main.remove();
    box.remove();
  });

  it("hides Design, IDE, Board, Docker, Routines, and Brain in Swarm mode", () => {
    const current = session("a", "Fix login");
    const items = paletteItems({ sessions: [current], session: current });
    const swarm = paletteItemsForMode(items, "swarm");
    expect(swarm.some((i) => i.id === "section:ide")).toBe(false);
    expect(swarm.some((i) => i.id === "new-design")).toBe(false);
    expect(swarm.some((i) => i.id === "new-game")).toBe(false);
    expect(swarm.some((i) => i.id === "section:docker")).toBe(false);
    expect(swarm.some((i) => i.id === "section:automations")).toBe(false);
    expect(swarm.some((i) => i.id === "section:brain")).toBe(false);
    expect(swarm.some((i) => i.id === "section:grafana")).toBe(false);
    expect(swarm.some((i) => i.id === "feature:webhooks")).toBe(false);
    expect(swarm.some((i) => i.id === "feature:memory")).toBe(false);
    expect(swarm.some((i) => i.id === "section:project")).toBe(true);
    expect(paletteItemsForMode(items, "developer").some((i) => i.id === "section:ide")).toBe(true);
  });

  it("ranks title matches ahead of keyword hits", () => {
    const items = paletteItems({ sessions: [] });
    const ranked = filterPaletteItems(items, "mcp");
    expect(ranked[0]?.id).toBe("settings:mcp");
    expect(ranked.map((i) => i.id)).toContain("feature:mcp");
  });

  it("pins recents at the top of an empty query", () => {
    const items = paletteItems({ sessions: [] });
    const pinned = applyPaletteRecents(items, ["settings:git", "new-agent", "missing"]);
    expect(pinned.slice(0, 2).map((i) => i.id)).toEqual(["settings:git", "new-agent"]);
    expect(pinned[0]?.group).toBe("Recents");
    expect(pinned.filter((i) => i.id === "new-agent")).toHaveLength(1);
  });
});
