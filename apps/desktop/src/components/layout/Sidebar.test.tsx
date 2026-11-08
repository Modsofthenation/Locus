import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, useReducer, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assessSetup, type AgentSession, type LinkedRepo } from "@locus/shared";
import { Sidebar } from "./Sidebar";
import { NoticeBanner } from "./NoticeBanner";
import { dismissNotice } from "@/lib/notice";
import { LAST_SLACK_SIDEBAR_GROUPS_KEY } from "@/components/slack/Slack";
import { api } from "@/lib/api";
import { setSettingsDirty } from "@/lib/settingsLeave";
import { Store, initialState, reducer, type UiState } from "@/state/store";
import { AUTOMATION_SIDEBAR_PREFS_KEY } from "@/lib/automationPrefs";
import { SWARM_ROSTER_PREFS_KEY } from "@/lib/swarmRosterPrefs";

vi.mock("@/lib/api", () => ({
  api: {
    deleteRepo: vi.fn(async () => ({ ok: true })),
    slackConversations: vi.fn(async () => []),
    slackStar: vi.fn(async () => []),
    dockerContainers: vi.fn(async () => ({ kind: "mock", containers: [] })),
    dockerContainersStop: vi.fn(async () => ({ stopped: [], errors: [] })),
    canvas: vi.fn(async () => ({ html: null, path: "/workspace/index.html" })),
    deleteSession: vi.fn(async () => ({ ok: true })),
    deleteBoard: vi.fn(async () => ({ ok: true })),
    deleteProject: vi.fn(async () => ({ ok: true })),
    duplicateBoard: vi.fn(async (id: string) => ({
      id: `${id}-copy`,
      title: "Retro copy",
      createdAt: "t",
      updatedAt: "t",
      objects: [],
      comments: [],
    })),
    duplicateProject: vi.fn(async (id: string) => ({
      id: `${id}-copy`,
      title: "Auth copy",
      createdAt: "t",
      updatedAt: "t",
      memberIds: [],
      maxConcurrentMembers: 4,
    })),
    fork: vi.fn(async (id: string) => ({
      id: `${id}-fork`,
      title: "Forked teammate",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      vmId: "v2",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      surface: "swarm",
    })),
    patchAutomation: vi.fn(async (id: string, patch: { enabled?: boolean }) => ({
      id,
      name: id,
      enabled: patch.enabled ?? true,
      prompt: "x",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "p",
      model: "grok-4",
      startVm: false,
      schedule: { kind: "interval", everyMinutes: 60 },
      createdAt: "2026-08-17T12:00:00.000Z",
      updatedAt: "2026-08-17T12:00:00.000Z",
    })),
    cloneAutomation: vi.fn(async (id: string) => ({
      id: `${id}-copy`,
      name: `${id} copy`,
      enabled: true,
      prompt: "x",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "p",
      model: "grok-4",
      startVm: false,
      schedule: { kind: "interval", everyMinutes: 60 },
      createdAt: "2026-08-17T12:00:00.000Z",
      updatedAt: "2026-08-17T12:00:00.000Z",
    })),
    deleteAutomation: vi.fn(async () => undefined),
    patchSession: vi.fn(async (id: string, patch: { subscriptions?: unknown }) => ({
      id,
      title: "Build the agent",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      vmId: "v1",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      subscriptions: patch.subscriptions ?? [],
    })),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

const session: AgentSession = {
  id: "s1",
  title: "Build the agent",
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

describe("Sidebar", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.localStorage.removeItem(LAST_SLACK_SIDEBAR_GROUPS_KEY);
    window.localStorage.removeItem(AUTOMATION_SIDEBAR_PREFS_KEY);
    window.localStorage.removeItem(SWARM_ROSTER_PREFS_KEY);
    vi.restoreAllMocks();
    setSettingsDirty(false);
    dismissNotice();
  });

  function render(state: UiState) {
    window.localStorage.removeItem(AUTOMATION_SIDEBAR_PREFS_KEY);
    window.localStorage.removeItem(SWARM_ROSTER_PREFS_KEY);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider value={{ state, dispatch: () => undefined }}>
        <div className={state.collapsed ? "app collapsed" : "app"}>
          <Sidebar />
        </div>
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("keeps section names on the icon rail and in the brand subtitle", () => {
    render({ ...initialState, sessions: [session] });
    const labels = [...host.querySelectorAll(".side-rail-nav > button")].map((el) =>
      el.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["Agents", "Design", "IDE", "Codebase", "Automations"]);
    expect(host.querySelector(".rail-more")).toBeTruthy();
    expect(host.querySelector(".rail-more summary")?.getAttribute("aria-label")).toBe("More");
    expect(host.querySelector(".side-rail-nav .rail-sep")?.getAttribute("role")).toBe("separator");
    expect(host.querySelector(".brand p")?.textContent).toBe("Agents");
    expect(host.querySelector(".brand-mark [data-testid='locus-mascot']")).toBeNull();
    expect(host.querySelector(".brand-actions [data-testid='product-mode-toggle']")).toBeNull();
    expect(
      host.querySelector(".side-rail-nav button[aria-current='page']")?.getAttribute("aria-label"),
    ).toBe("Agents");
    expect(host.querySelector(".side-rail-nav .rail-icon svg")).toBeTruthy();
    expect(host.querySelector(".side-rail-nav button[aria-label='Settings']")).toBeNull();
    expect(host.querySelector(".side-rail-chrome button[aria-label='Settings']")).toBeTruthy();
    expect(host.querySelector(".rail-conn")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector(".search-wrap .search-icon svg")).toBeTruthy();
    expect(host.querySelector(".search")?.getAttribute("placeholder")).toBe("Search agents");
    expect(host.querySelector(".search-wrap kbd")).toBeNull();
    expect(
      [...host.querySelectorAll(".side-rail-nav .rail-label")].map((el) => el.textContent),
    ).toEqual(["Agents", "Design", "IDE", "Codebase", "Automations", "More"]);
  });

  it("lists Games, Assets, Board, and Docker in the More menu", () => {
    render({ ...initialState, sessions: [session] });
    act(() => {
      (host.querySelector(".rail-more summary") as HTMLElement | null)?.click();
    });
    const moreItems = [...host.querySelectorAll(".rail-more [role='menuitem']")].map(
      (el) => el.textContent,
    );
    expect(moreItems).toEqual([
      "Games",
      "Assets",
      "Board",
      "Projects",
      "Brain",
      "Slack",
      "Grafana",
      "Docker",
    ]);
  });

  it("fits full rail labels and wraps the mode toggle below the brand when narrow", () => {
    expect(css).toMatch(/--rail-w: 72px/);
    expect(css).toMatch(
      /\.side-rail-nav > button,[\s\S]*?width: calc\(var\(--rail-w, 64px\) - 8px\)/,
    );
    expect(css).toMatch(/\.side-main \{[\s\S]*?container: side-main \/ inline-size/);
    expect(css).toMatch(
      /@container side-main \(max-width: 300px\) \{\s*\.brand-actions \{[\s\S]*?flex-basis: 100%/,
    );
  });

  it("separates Automations from the rest of the icon rail", () => {
    expect(css).toMatch(/\.side-rail-nav > button,/);
    expect(css).toMatch(/\.side-rail-nav \.rail-sep \{[\s\S]*?height:\s*1px/);
    expect(css).toMatch(/\.side-rail-nav \.rail-sep \{[\s\S]*?background:\s*var\(--line-strong\)/);
    expect(css).toMatch(/\.side-rail-nav \{[\s\S]*?overflow-y:\s*auto/);
  });

  it("finds agents by the last user prompt", () => {
    render({
      ...initialState,
      sessions: [
        {
          ...session,
          title: "Host agent",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Fix the login form",
              createdAt: session.createdAt,
            },
          ],
        },
      ],
      queries: { agents: "login form" },
    });
    expect(host.querySelector(".session-item[title='Host agent']")).toBeTruthy();
  });

  it("houses grouped settings nav in the sidebar", () => {
    render({
      ...initialState,
      section: "settings",
      config: {
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
      },
    });
    expect(host.querySelector(".brand p")?.textContent).toBe("Settings");
    expect(
      host.querySelector(".side-rail-chrome button[aria-label='Settings']")?.className,
    ).toMatch(/active/);
    expect(
      host
        .querySelector(".side-rail-chrome button[aria-current='page']")
        ?.getAttribute("aria-label"),
    ).toBe("Settings");
    expect(host.querySelector(".side-rail-nav button[aria-current='page']")).toBeNull();
    expect(host.querySelector(".side-actions")).toBeNull();
    expect(host.querySelector(".search")).toBeNull();
    expect([...host.querySelectorAll(".settings-nav-group")].map((el) => el.textContent)).toEqual([
      "Models",
      "Workspace",
      "System",
    ]);
    expect(
      [...host.querySelectorAll(".settings-nav button")].map(
        (el) => el.querySelector(".settings-nav-label")?.textContent,
      ),
    ).toEqual([
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
    expect(host.querySelector(".settings-nav button.active .settings-nav-label")?.textContent).toBe(
      "Providers",
    );
    expect(host.querySelector(".settings-nav-count")?.textContent).toBe("1");
  });

  it("turns Swarm Configuration into a Teammates return button", () => {
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              config: { productMode: "swarm" } as NonNullable<UiState["config"]>,
              section: "settings",
            },
            dispatch,
          }}
        >
          <div className="app">
            <Sidebar />
          </div>
        </Store.Provider>,
      );
    });

    const button = host.querySelector("[data-testid='swarm-config']") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Teammates");
    expect(button.textContent).toContain("Teammates");
    act(() => button.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "section", section: "agents" });
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: null });
  });

  it("keeps Teams open in the Swarm shell", () => {
    function Harness() {
      const [state, dispatch] = useReducer(reducer, {
        ...initialState,
        config: { productMode: "swarm" } as NonNullable<UiState["config"]>,
        section: "project",
        projects: [
          {
            id: "team-1",
            title: "Platform",
            teamName: "Platform",
            createdAt: "2020-01-01T00:00:00.000Z",
            updatedAt: "2020-01-01T00:00:00.000Z",
            memberCount: 2,
            surface: "swarm",
          },
        ],
      });
      return (
        <Store.Provider value={{ state, dispatch }}>
          <Sidebar />
        </Store.Provider>
      );
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<Harness />);
    });
    expect(host.querySelector(".brand p")?.textContent).toBe("Teams");
    expect(host.querySelector("[data-testid='swarm-teams']")?.getAttribute("aria-current")).toBe(
      "page",
    );
    expect(host.textContent).toContain("Platform");
    expect(host.textContent).toContain("New team");
    const teammates = host.querySelector("[data-testid='swarm-teammates']") as HTMLButtonElement;
    act(() => {
      teammates.click();
    });
    expect(host.querySelector(".brand p")?.textContent).toBe("Teammates");
  });

  it("shows Teammates, Teams, and More on the Swarm icon rail", () => {
    function Harness() {
      const [state, dispatch] = useReducer(reducer, {
        ...initialState,
        config: { productMode: "swarm" } as NonNullable<UiState["config"]>,
        section: "agents",
      });
      return (
        <Store.Provider value={{ state, dispatch }}>
          <Sidebar />
        </Store.Provider>
      );
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<Harness />);
    });
    expect(host.querySelector(".brand p")?.textContent).toBe("Teammates");
    expect(host.querySelector("[data-testid='swarm-teammates']")).toBeTruthy();
    expect(host.querySelector("[data-testid='swarm-teams']")).toBeTruthy();
    expect(host.querySelector(".rail-more")).toBeTruthy();
    expect(host.querySelector(".swarm-shell-nav")).toBeNull();
    const teams = host.querySelector("[data-testid='swarm-teams']") as HTMLButtonElement;
    act(() => {
      teams.click();
    });
    expect(host.querySelector(".brand p")?.textContent).toBe("Teams");
    expect(host.textContent).toContain("New team");
    expect(host.textContent).toContain("No teams");
  });

  it("hides and restores Swarm teammates from the roster overflow", async () => {
    const teammate: AgentSession = {
      ...session,
      id: "tm1",
      title: "Ops bot",
      surface: "swarm",
    };
    const other: AgentSession = {
      ...session,
      id: "tm2",
      title: "Writer",
      surface: "swarm",
    };
    function Harness() {
      const [state, dispatch] = useReducer(reducer, {
        ...initialState,
        config: { productMode: "swarm" } as NonNullable<UiState["config"]>,
        section: "agents",
        sessions: [teammate, other],
      });
      return (
        <Store.Provider value={{ state, dispatch }}>
          <Sidebar />
        </Store.Provider>
      );
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<Harness />);
    });
    expect(host.textContent).toContain("Ops bot");
    expect(host.textContent).toContain("Writer");
    const toggles = [
      ...host.querySelectorAll('.session-item.has-menu [aria-haspopup="menu"]'),
    ] as HTMLButtonElement[];
    const opsToggle = toggles.find((btn) =>
      btn.closest(".session-item")?.getAttribute("title")?.includes("Ops bot"),
    );
    expect(opsToggle).toBeTruthy();
    act(() => {
      opsToggle!.click();
    });
    const hide = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "Hide",
    );
    expect(hide).toBeTruthy();
    expect([...host.querySelectorAll("[role='menuitem']")].map((el) => el.textContent)).toEqual(
      expect.arrayContaining(["Pin", "Duplicate teammate", "Hide"]),
    );
    await act(async () => {
      hide!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("Ops bot");
    expect(host.textContent).toContain("Writer");
    const showHidden = host.querySelector(
      "[data-testid='swarm-show-hidden'] input",
    ) as HTMLInputElement;
    expect(showHidden).toBeTruthy();
    act(() => {
      showHidden.click();
    });
    expect(host.textContent).toContain("Ops bot");
    const restoreToggle = [
      ...host.querySelectorAll('.session-item.has-menu [aria-haspopup="menu"]'),
    ].find((btn) => btn.closest(".session-item")?.getAttribute("title")?.includes("Ops bot"));
    act(() => {
      (restoreToggle as HTMLButtonElement).click();
    });
    const show = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "Show",
    );
    expect(show).toBeTruthy();
    await act(async () => {
      show!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Ops bot");
    expect(host.querySelector("[data-testid='swarm-show-hidden']")).toBeNull();
  });

  it("duplicates a Swarm teammate via api.fork from the roster overflow", async () => {
    const teammate: AgentSession = {
      ...session,
      id: "tm1",
      title: "Ops bot",
      surface: "swarm",
    };
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              config: { productMode: "swarm" } as NonNullable<UiState["config"]>,
              section: "agents",
              sessions: [teammate],
            },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    const toggle = host.querySelector(
      '.session-item.has-menu [aria-haspopup="menu"]',
    ) as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    const duplicate = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "Duplicate teammate",
    );
    expect(duplicate).toBeTruthy();
    await act(async () => {
      duplicate!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.fork).toHaveBeenCalledWith("tm1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "session",
      session: expect.objectContaining({ id: "tm1-fork" }),
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "tm1-fork" });
  });

  it("duplicates an agent from the sidebar overflow", async () => {
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, section: "agents", sessions: [session] },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    const toggle = host.querySelector(
      '.session-item.has-menu [aria-haspopup="menu"]',
    ) as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    const duplicate = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "Duplicate",
    );
    expect(duplicate).toBeTruthy();
    await act(async () => {
      duplicate!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.fork).toHaveBeenCalledWith("s1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "session",
      session: expect.objectContaining({ id: "s1-fork" }),
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "s1-fork" });
  });

  it("duplicates a design from the sidebar overflow", async () => {
    const design: AgentSession = {
      ...session,
      id: "d1",
      title: "Landing page",
      kind: "design",
      runtime: "docker",
    };
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "design",
              selectedId: "d1",
              sessions: [design],
            },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    const toggle = host.querySelector(
      '.session-item.has-menu [aria-haspopup="menu"]',
    ) as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    const duplicate = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "Duplicate",
    );
    expect(duplicate).toBeTruthy();
    await act(async () => {
      duplicate!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.fork).toHaveBeenCalledWith("d1");
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "d1-fork" });
  });

  it("duplicates a board from the sidebar overflow", async () => {
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "board",
              boards: [
                {
                  id: "b1",
                  title: "Retro",
                  createdAt: "t",
                  updatedAt: "t",
                  objectCount: 2,
                  frameCount: 1,
                },
              ],
            },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    const toggle = host.querySelector(
      '.session-item.has-menu [aria-haspopup="menu"]',
    ) as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    const duplicate = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "Duplicate",
    );
    expect(duplicate).toBeTruthy();
    await act(async () => {
      duplicate!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.duplicateBoard).toHaveBeenCalledWith("b1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "board",
      board: expect.objectContaining({ id: "b1-copy" }),
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "selectBoard", id: "b1-copy" });
  });

  it("duplicates a project from the sidebar overflow", async () => {
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "project",
              projects: [
                {
                  id: "p1",
                  title: "Auth",
                  createdAt: "t",
                  updatedAt: "t",
                  memberCount: 1,
                },
              ],
            },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    const toggle = host.querySelector(
      '.session-item.has-menu [aria-haspopup="menu"]',
    ) as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    const duplicate = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "Duplicate",
    );
    expect(duplicate).toBeTruthy();
    await act(async () => {
      duplicate!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.duplicateProject).toHaveBeenCalledWith("p1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "project",
      project: expect.objectContaining({ id: "p1-copy" }),
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "selectProject", id: "p1-copy" });
  });

  it("shows a Needs you inbox and group when a session is gated", () => {
    render({
      ...initialState,
      sessions: [{ ...session, needsHuman: "Approve git_push" }],
    });
    expect(host.querySelector("button[aria-label='Needs you, 1 waiting']")).toBeTruthy();
    expect(host.querySelector(".icon-badge.danger")?.textContent).toBe("1");
    expect(host.querySelector(".session-group-label.warn")?.textContent).toBe("Needs you");
    expect(host.querySelector(".session-item.needs-you")).toBeTruthy();
    expect(
      host.querySelector(".side-rail-nav button[aria-label='Agents, needs you 1']"),
    ).toBeTruthy();
  });

  it("lists unresolved board comments in Needs you", () => {
    render({
      ...initialState,
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
    expect(host.querySelector("button[aria-label='Needs you, 1 waiting']")).toBeTruthy();
    expect(host.querySelector(".icon-badge.danger")?.textContent).toBe("1");
    expect(host.querySelector(".session-group-label.warn")?.textContent).toBe("Needs you");
    expect(host.textContent).toContain("Name the owner");
    expect(host.querySelector(".rail-more .unread-dot")).toBeTruthy();
    act(() => {
      (host.querySelector(".rail-more summary") as HTMLElement | null)?.click();
    });
    expect(
      [...host.querySelectorAll(".rail-more [role='menuitem']")].some((el) =>
        el.textContent?.includes("Board · unread"),
      ),
    ).toBe(true);
  });

  it("stretches New board in the same side-actions row as New design", () => {
    render({
      ...initialState,
      section: "board",
      boards: [
        {
          id: "b1",
          title: "Retro",
          createdAt: "t",
          updatedAt: "t",
          objectCount: 2,
          frameCount: 1,
        },
      ],
    });
    const btn = host.querySelector(".side-actions-row .btn.primary");
    expect(btn?.getAttribute("aria-label")).toBe("New board");
    expect(btn?.textContent).toMatch(/New board/);
  });

  it("filters only the active section with that section's search", () => {
    render({
      ...initialState,
      section: "agents",
      queries: { slack: "no-such-channel" },
      sessions: [session],
      slackConversations: [{ id: "C_ENG", name: "eng", kind: "channel" }],
    });
    expect(host.querySelector(".session-item[title='Build the agent']")).toBeTruthy();
    expect((host.querySelector(".search") as HTMLInputElement).value).toBe("");
  });

  it("keeps sidebar search per section when switching the rail", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Live() {
      const [state, dispatch] = useReducer(reducer, {
        ...initialState,
        sessions: [session],
        slackStatus: { connected: true, teamName: "Locus Dev", socket: "down" },
        slackConversations: [
          { id: "C_ENG", name: "eng", kind: "channel", topic: "Shipping" },
          {
            id: "D_BOB",
            name: "bob",
            kind: "im",
            avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_BOB.png",
          },
        ],
      });
      return (
        <Store.Provider value={{ state, dispatch }}>
          <Sidebar />
        </Store.Provider>
      );
    }
    act(() => {
      root.render(<Live />);
    });
    const search = () => host.querySelector(".search") as HTMLInputElement;
    const type = (value: string) => {
      const input = search();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    act(() => {
      type("no-such-agent");
    });
    expect(search().value).toBe("no-such-agent");
    expect(host.querySelector(".empty-list")?.textContent).toMatch(/No matching agents/);
    const openSlack = () => {
      act(() => {
        (host.querySelector(".rail-more summary") as HTMLElement | null)?.click();
      });
      const item = [...host.querySelectorAll(".rail-more [role='menuitem']")].find((el) =>
        (el.textContent ?? "").startsWith("Slack"),
      );
      act(() => {
        item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    openSlack();
    expect(search().value).toBe("");
    expect(host.querySelector(".session-group .session-item .title-text")?.textContent).toBe("eng");
    expect(host.textContent).toContain("bob");
    act(() => {
      type("zzz");
    });
    expect(search().value).toBe("zzz");
    expect(host.querySelector(".empty-list")?.textContent).toMatch(/No matching channels/);
    act(() => {
      (host.querySelector("[aria-label='Agents']") as HTMLButtonElement).click();
    });
    expect(search().value).toBe("no-such-agent");
    expect(host.querySelector(".empty-list")?.textContent).toMatch(/No matching agents/);
    openSlack();
    expect(search().value).toBe("zzz");
    expect(host.querySelector(".empty-list")?.textContent).toMatch(/No matching channels/);
  });

  it("lists design sessions only on the Design tab", () => {
    const design: AgentSession = {
      ...session,
      id: "d1",
      title: "Landing page",
      kind: "design",
      runtime: "docker",
    };
    render({
      ...initialState,
      section: "design",
      selectedId: "d1",
      sessions: [session, design],
    });
    expect(host.querySelector(".session-item[title='Landing page']")).toBeTruthy();
    expect(host.querySelector(".session-item[title='Build the agent']")).toBeNull();
    expect(host.querySelector(".side-actions .btn.primary")?.getAttribute("aria-label")).toBe(
      "New design",
    );
    expect(host.querySelector(".brand p")?.textContent).toBe("Design");
    expect(host.querySelector(".search")?.getAttribute("placeholder")).toBe("Search designs");
    expect(host.querySelector(".search-wrap .search-icon svg")).toBeTruthy();
    expect(host.querySelector(".session-item.design-item .design-thumb.is-empty")).toBeTruthy();
    expect(host.querySelector(".session-item.design-item iframe")).toBeNull();
  });

  it("lists game sessions only on the Games tab", () => {
    const game: AgentSession = {
      ...session,
      id: "g1",
      title: "Arcade",
      kind: "game",
      runtime: "docker",
    };
    render({
      ...initialState,
      section: "games",
      selectedId: "g1",
      sessions: [session, game],
    });
    expect(host.querySelector(".session-item[title='Arcade']")).toBeTruthy();
    expect(host.querySelector(".session-item[title='Build the agent']")).toBeNull();
    expect(host.querySelector(".side-actions .btn.primary")?.getAttribute("aria-label")).toBe(
      "New game",
    );
    expect(host.querySelector(".brand p")?.textContent).toBe("Games");
    expect(host.querySelector(".search")?.getAttribute("placeholder")).toBe("Search games");
  });

  it("lists host workspaces only on the IDE tab", () => {
    const workspace: AgentSession = {
      ...session,
      id: "h1",
      title: "Local app",
      kind: "ide",
      runtime: "host",
      vmId: undefined,
    };
    render({
      ...initialState,
      section: "ide",
      selectedId: "h1",
      sessions: [session, workspace],
    });
    expect(host.querySelector(".session-item[title='Local app']")).toBeTruthy();
    expect(host.querySelector(".session-item[title='Build the agent']")).toBeNull();
    expect(host.querySelector(".side-actions .btn.primary")?.getAttribute("aria-label")).toBe(
      "New workspace",
    );
    expect(host.querySelector(".brand p")?.textContent).toBe("IDE");
    expect(host.querySelector(".search")?.getAttribute("placeholder")).toBe("Search workspaces");
  });

  it("keeps host workspaces out of the Agents list", () => {
    const workspace: AgentSession = {
      ...session,
      id: "h1",
      title: "Local app",
      kind: "ide",
      runtime: "host",
      vmId: undefined,
    };
    render({
      ...initialState,
      section: "agents",
      selectedId: "s1",
      sessions: [session, workspace],
    });
    expect(host.querySelector(".session-item[title='Build the agent']")).toBeTruthy();
    expect(host.querySelector(".session-item[title='Local app']")).toBeNull();
  });

  it("lists host agents on the Agents tab", () => {
    const hostAgent: AgentSession = {
      ...session,
      id: "h1",
      title: "Local app",
      runtime: "host",
      vmId: undefined,
    };
    render({
      ...initialState,
      section: "agents",
      selectedId: "s1",
      sessions: [session, hostAgent],
    });
    expect(host.querySelector(".session-item[title='Build the agent']")).toBeTruthy();
    expect(host.querySelector(".session-item[title='Local app']")).toBeTruthy();
  });

  it("previews the design canvas in the sidebar row", () => {
    const design: AgentSession = {
      ...session,
      id: "d1",
      title: "Landing page",
      kind: "design",
      runtime: "docker",
    };
    render({
      ...initialState,
      section: "design",
      selectedId: "d1",
      sessions: [session, design],
      canvasHtml: { d1: "<html><body><h1>Hero</h1></body></html>" },
    });
    const item = host.querySelector(".session-item.design-item") as HTMLElement | null;
    const frame = host.querySelector(".design-thumb iframe") as HTMLIFrameElement | null;
    expect(item).toBeTruthy();
    expect(host.querySelector(".design-thumb.is-empty")).toBeNull();
    expect(frame?.srcdoc).toContain("Hero");
    expect(frame?.srcdoc).toContain("data-locus-preview-guard");
    expect(frame?.srcdoc).toContain("data-locus-thumb-clip");
    expect(frame?.srcdoc).toContain('<base href="/api/sessions/d1/canvas-files/">');
    expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame?.getAttribute("scrolling")).toBe("no");
    expect(frame?.tabIndex).toBe(-1);
    expect(host.querySelector(".session-item.design-item .title-text")?.textContent).toBe(
      "Landing page",
    );
    expect(host.querySelector(".session-item[title='Build the agent'] .design-thumb")).toBeNull();
    expect(css).toMatch(
      /\.session-item\.design-item \{[\s\S]*?grid-template-columns: 88px minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(/\.session-item\.design-item\.has-menu \{[\s\S]*?gap: var\(--space-2-5\)/);
    expect(css).toMatch(
      /\.session-item \.menu > summary\.btn \{[\s\S]*?border-color:\s*transparent/,
    );
    expect(css).toMatch(/\.design-thumb \{[\s\S]*?aspect-ratio: 16 \/ 10/);
    expect(css).toMatch(/\.design-thumb \{[\s\S]*?place-items: center/);
    expect(css).toMatch(/\.design-thumb iframe \{[\s\S]*?overflow:\s*hidden/);
  });

  it("loads canvas html for design rows that are not cached", async () => {
    const design: AgentSession = {
      ...session,
      id: "d1",
      title: "Landing page",
      kind: "design",
      runtime: "docker",
    };
    const dispatch = vi.fn();
    vi.mocked(api.canvas).mockResolvedValue({
      html: "<html><body><h1>Hero</h1></body></html>",
      path: "/workspace/index.html",
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "design",
              selectedId: "d1",
              sessions: [design],
            },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.canvas).toHaveBeenCalledWith("d1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "canvas",
      sessionId: "d1",
      html: "<html><body><h1>Hero</h1></body></html>",
    });
  });

  it("keeps prefetching sibling design canvases after the first one lands", async () => {
    const one: AgentSession = {
      ...session,
      id: "d1",
      title: "Landing page",
      kind: "design",
      runtime: "docker",
    };
    const two: AgentSession = {
      ...session,
      id: "d2",
      title: "Slide deck",
      kind: "design",
      runtime: "docker",
    };
    const pending = new Map<string, (value: { html: string; path: string }) => void>();
    vi.mocked(api.canvas).mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          pending.set(id, resolve);
        }),
    );
    function App() {
      const [state, dispatch] = useReducer(reducer, {
        ...initialState,
        section: "design",
        sessions: [one, two],
      });
      return (
        <Store.Provider value={{ state, dispatch }}>
          <Sidebar />
        </Store.Provider>
      );
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect([...pending.keys()].sort()).toEqual(["d1", "d2"]);
    await act(async () => {
      pending.get("d1")!({
        html: "<html><body><h1>Landing</h1></body></html>",
        path: "/workspace/index.html",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = host.querySelector(
      ".session-item[title='Landing page'] iframe",
    ) as HTMLIFrameElement | null;
    expect(first?.srcdoc).toContain("Landing");
    expect(host.querySelector(".session-item[title='Slide deck'] iframe")).toBeNull();
    await act(async () => {
      pending.get("d2")!({
        html: "<html><body><h1>Deck</h1></body></html>",
        path: "/workspace/index.html",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    const frames = [...host.querySelectorAll(".design-thumb iframe")] as HTMLIFrameElement[];
    expect(frames).toHaveLength(2);
    expect(frames.map((frame) => frame.srcdoc).join("\n")).toContain("Landing");
    expect(frames.map((frame) => frame.srcdoc).join("\n")).toContain("Deck");
    expect(host.querySelector(".design-thumb.is-empty")).toBeNull();
  });

  it("opens the empty create screen instead of the new-agent modal", () => {
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, selectedId: "s1", sessions: [session] },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    act(() => {
      (host.querySelector(".side-actions .btn.primary") as HTMLButtonElement).click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: null });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "new", open: true }));
  });

  it("truncates long session titles and exposes the full name as a tooltip", () => {
    const review: AgentSession = {
      ...session,
      title: "Review #165 · Modsofthenation/Locus",
      runtime: "docker",
      dockerImage: "locus/agent:0.1",
      model: "x-preview-f-free",
      pull: {
        number: 165,
        url: "https://github.com/Modsofthenation/Locus/pull/165",
        title: "Fix sidebar overflow",
        state: "open",
        headRef: "fix",
        baseRef: "main",
      },
    };
    render({ ...initialState, selectedId: "s1", sessions: [review] });
    const item = host.querySelector(".session-item") as HTMLButtonElement | null;
    expect(item?.getAttribute("title")).toBe("Review #165 · Modsofthenation/Locus · fix");
    expect(item?.querySelector(".title-text")?.textContent).toBe(
      "Review #165 · Modsofthenation/Locus",
    );
    expect(item?.querySelector(".session-branch")?.textContent).toBe("fix");
    expect(item?.querySelector(".session-meta-rest")?.textContent).toBe("x-preview-f-free · #165");
    expect(item?.querySelector(".session-meta-sep")?.textContent).toBe("·");
    expect(item?.querySelector(".meta")?.textContent).toBe("fix·x-preview-f-free · #165");
    expect(css).toMatch(/\.session-item \{[\s\S]*?grid-template-columns: 8px minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.session-item \{[\s\S]*?border: 1px solid transparent/);
    expect(css).toMatch(/\.session-item \.dot \+ span \{[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.session-item \.title-text \{[\s\S]*?text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.session-item \.session-branch \{[\s\S]*?text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.session-item \.session-branch \{[\s\S]*?flex:\s*0 0 auto/);
    expect(css).toMatch(/\.session-item \.session-meta-sep \{[\s\S]*?padding:\s*0 0\.4em/);
    expect(css).toMatch(/\.session-item \.session-meta-rest \{[\s\S]*?text-overflow:\s*ellipsis/);
  });

  it("puts the live git branch first and keeps a custom image in the rest of the meta", () => {
    const live: AgentSession = {
      ...session,
      title: "Fix login",
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      model: "composer-2",
      gitBranch: "feat/login",
      pull: {
        number: 12,
        url: "https://github.com/acme/app/pull/12",
        title: "Fix login",
        headRef: "old-head",
      },
      repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
    };
    render({ ...initialState, selectedId: "s1", sessions: [live] });
    const item = host.querySelector(".session-item") as HTMLButtonElement | null;
    expect(item?.querySelector(".session-branch")?.textContent).toBe("feat/login");
    expect(item?.querySelector(".session-meta-rest")?.textContent).toBe(
      "node:22-bookworm · composer-2 · #12",
    );
    expect(item?.getAttribute("title")).toBe("Fix login · feat/login");
  });

  it("pins, renames, and archives from the session row menu", async () => {
    vi.mocked(api.patchSession).mockResolvedValue(session);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Better title");
    render({ ...initialState, selectedId: "s1", sessions: [session] });
    const toggle = host.querySelector('.session-item.has-menu [aria-haspopup="menu"]') as
      HTMLButtonElement | undefined;
    expect(toggle).toBeTruthy();
    function openAndClick(label: string) {
      act(() => {
        toggle!.click();
      });
      const item = [...host.querySelectorAll("[role='menuitem']")].find(
        (el) => el.textContent === label,
      );
      expect(item).toBeTruthy();
      return act(async () => {
        item!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
    }
    await openAndClick("Pin");
    expect(api.patchSession).toHaveBeenCalledWith("s1", { pinned: true });
    await openAndClick("Rename");
    expect(prompt).toHaveBeenCalled();
    expect(api.patchSession).toHaveBeenCalledWith("s1", { title: "Better title" });
    await openAndClick("Archive");
    expect(api.patchSession).toHaveBeenCalledWith("s1", { archived: true });
    prompt.mockRestore();
  });

  it("archives a live agent from Delete and offers undo", async () => {
    vi.mocked(api.patchSession).mockResolvedValue({ ...session, archived: true });
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, selectedId: "s1", sessions: [session] },
            dispatch,
          }}
        >
          <Sidebar />
          <NoticeBanner />
        </Store.Provider>,
      );
    });
    const toggle = host.querySelector(
      '.session-item.has-menu [aria-haspopup="menu"]',
    ) as HTMLElement;
    act(() => {
      toggle.click();
    });
    const del = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "Delete",
    );
    expect(del).toBeTruthy();
    expect(del?.className).toMatch(/danger/);
    await act(async () => {
      del!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", { archived: true });
    expect(api.deleteSession).not.toHaveBeenCalled();
    expect(host.querySelector("[data-testid='app-notice-item']")?.textContent).toContain(
      "Deleted Build the agent",
    );
  });

  it("hard-deletes an archived agent after confirm", async () => {
    vi.mocked(api.deleteSession).mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              selectedId: "s1",
              sessions: [{ ...session, archived: true }],
            },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    act(() => {
      const box = host.querySelector(".archive-toggle input") as HTMLInputElement;
      if (box && !box.checked) box.click();
    });
    const toggle = host.querySelector(
      '.session-item.has-menu [aria-haspopup="menu"]',
    ) as HTMLElement;
    act(() => {
      toggle.click();
    });
    const del = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "Delete",
    );
    await act(async () => {
      del!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(confirm).toHaveBeenCalledWith("This cannot be undone.");
    expect(api.deleteSession).toHaveBeenCalledWith("s1");
    expect(dispatch).toHaveBeenCalledWith({ type: "deleted", id: "s1" });
    confirm.mockRestore();
  });

  it("does not delete an archived agent when confirm is cancelled", async () => {
    vi.mocked(api.deleteSession).mockClear();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render({
      ...initialState,
      selectedId: "s1",
      sessions: [{ ...session, archived: true }],
    });
    act(() => {
      const box = host.querySelector(".archive-toggle input") as HTMLInputElement;
      if (box && !box.checked) box.click();
    });
    const toggle = host.querySelector(
      '.session-item.has-menu [aria-haspopup="menu"]',
    ) as HTMLElement;
    act(() => {
      toggle.click();
    });
    const del = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "Delete",
    );
    await act(async () => {
      del!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.deleteSession).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("deletes a board from its sidebar row menu", async () => {
    vi.mocked(api.deleteBoard).mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "board",
              boards: [
                {
                  id: "b1",
                  title: "Retro",
                  createdAt: "t",
                  updatedAt: "t",
                  objectCount: 2,
                  frameCount: 1,
                },
              ],
            },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    const toggle = host.querySelector('[aria-label="More for Retro"]') as HTMLElement;
    expect(toggle).toBeTruthy();
    act(() => {
      toggle.click();
    });
    const del = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "Delete",
    );
    await act(async () => {
      del!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(confirm).toHaveBeenCalledWith("This cannot be undone.");
    expect(api.deleteBoard).toHaveBeenCalledWith("b1");
    expect(dispatch).toHaveBeenCalledWith({ type: "boardDeleted", id: "b1" });
    confirm.mockRestore();
  });

  it("groups agents by Today, Yesterday, and Earlier", () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11).toISOString();
    const yesterday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
      16,
    ).toISOString();
    const earlier = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 20,
      9,
    ).toISOString();
    render({
      ...initialState,
      selectedId: "t1",
      sessions: [
        { ...session, id: "t1", title: "Today chat", updatedAt: today },
        { ...session, id: "y1", title: "Yesterday chat", updatedAt: yesterday },
        { ...session, id: "e1", title: "Old chat", updatedAt: earlier },
        {
          ...session,
          id: "p1",
          title: "Pinned chat",
          pinned: true,
          updatedAt: earlier,
        },
      ],
    });
    const labels = [...host.querySelectorAll(".session-group-label")].map((el) => el.textContent);
    expect(labels).toEqual(["Pinned", "Today", "Yesterday", "Earlier"]);
    expect(host.querySelector(".session-item[title='Pinned chat']")).toBeTruthy();
    expect(host.querySelector(".session-item[title='Today chat']")).toBeTruthy();
    expect(css).toMatch(/\.session-group-label \{[\s\S]*?text-transform:\s*uppercase/);
  });

  it("nests a repo heading when two chats in a day share a repo", () => {
    const today = new Date().toISOString();
    render({
      ...initialState,
      sessions: [
        {
          ...session,
          id: "a",
          title: "Fix auth",
          updatedAt: today,
          repo: { forge: "github", url: "https://github.com/acme/app.git" },
          repoId: "r1",
        },
        {
          ...session,
          id: "b",
          title: "Add tests",
          updatedAt: today,
          repo: { forge: "github", url: "https://github.com/acme/app.git" },
          repoId: "r1",
        },
        { ...session, id: "c", title: "Scratch", updatedAt: today },
      ],
    });
    expect(host.querySelector(".session-group-label")?.textContent).toBe("Today");
    expect(host.querySelector(".session-repo-label")?.textContent).toBe("app");
    expect(host.querySelector(".session-item[title='Scratch']")).toBeTruthy();
    expect(css).toMatch(/\.session-repo-label \{/);
  });

  it("archives idle chats and empty drafts from the session list menu", async () => {
    const dispatch = vi.fn();
    const now = Date.now();
    const old = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date(now).toISOString();
    const idleOld: AgentSession = {
      ...session,
      id: "idle-old",
      title: "Stale",
      status: "idle",
      updatedAt: old,
    };
    const idlePinned: AgentSession = {
      ...session,
      id: "idle-pin",
      title: "Keep",
      status: "idle",
      pinned: true,
      updatedAt: old,
    };
    const idleFresh: AgentSession = {
      ...session,
      id: "idle-new",
      title: "Recent",
      status: "idle",
      updatedAt: fresh,
    };
    const emptyDraft: AgentSession = {
      ...session,
      id: "draft-empty",
      title: "Untitled",
      status: "draft",
      messages: [],
      updatedAt: fresh,
    };
    const drafted: AgentSession = {
      ...session,
      id: "draft-used",
      title: "Started",
      status: "draft",
      messages: [{ id: "u1", role: "user", content: "hi", createdAt: fresh }],
      updatedAt: fresh,
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              sessions: [idleOld, idlePinned, idleFresh, emptyDraft, drafted],
            },
            dispatch,
          }}
        >
          <Sidebar />
          <NoticeBanner />
        </Store.Provider>,
      );
    });
    expect(host.querySelector("[aria-label='Session list']")).toBeTruthy();
    act(() => {
      (host.querySelector("[aria-label='Session list']") as HTMLElement).click();
    });
    const idleItem = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.startsWith("Archive idle"),
    ) as HTMLButtonElement;
    const draftsItem = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.startsWith("Archive empty drafts"),
    ) as HTMLButtonElement;
    expect(idleItem.textContent).toBe("Archive idle (1)");
    expect(draftsItem.textContent).toBe("Archive empty drafts (1)");
    await act(async () => {
      idleItem.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='app-notice-item']")?.textContent).toContain(
      "Archived 1 idle chat",
    );
    expect(host.querySelector(".app-notice-action")?.textContent).toBe("Undo");
    expect(api.patchSession).toHaveBeenCalledWith("idle-old", { archived: true });
    expect(api.patchSession).not.toHaveBeenCalledWith("idle-pin", { archived: true });
    expect(api.patchSession).not.toHaveBeenCalledWith("idle-new", { archived: true });
    expect(dispatch).toHaveBeenCalledWith({
      type: "session",
      session: { ...idleOld, archived: true },
    });

    act(() => {
      (host.querySelector("[aria-label='Session list']") as HTMLElement).click();
    });
    const draftsAgain = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.startsWith("Archive empty drafts"),
    ) as HTMLButtonElement;
    await act(async () => {
      draftsAgain.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const noticeText = [...host.querySelectorAll("[data-testid='app-notice-item']")].map(
      (el) => el.textContent,
    );
    expect(noticeText.some((text) => text?.includes("Archived 1 empty draft"))).toBe(true);
    expect(api.patchSession).toHaveBeenCalledWith("draft-empty", { archived: true });
    expect(api.patchSession).not.toHaveBeenCalledWith("draft-used", { archived: true });
  });

  it("collapses to the icon rail so labels cannot overflow", () => {
    render({
      ...initialState,
      collapsed: true,
      sessions: [session],
      unreadAutomationIds: ["a1"],
      setup: assessSetup({
        hypervisorKind: "mock",
        qemuFound: false,
        linuxImageReady: false,
        hasProvider: false,
        hasGoldenImage: false,
      }),
    });

    expect(host.querySelector(".app.collapsed .sidebar")).toBeTruthy();
    expect(
      host.querySelector(".side-rail button[aria-label='Agents'] .rail-icon svg"),
    ).toBeTruthy();
    expect(
      host.querySelector(".side-rail button[aria-label='Design'] .rail-icon svg"),
    ).toBeTruthy();
    expect(host.querySelector(".side-rail button[aria-label='Games']")).toBeNull();
    expect(host.querySelector(".side-rail button[aria-label='IDE'] .rail-icon svg")).toBeTruthy();
    expect(host.querySelector(".side-rail button[aria-label='Automations, unread']")).toBeTruthy();
    expect(
      host.querySelector(".side-rail button[aria-label='Automations, unread'] .unread-dot"),
    ).toBeTruthy();
    expect(host.querySelector(".rail-more")).toBeTruthy();
    expect(host.querySelector(".side-rail-nav .rail-sep")).toBeTruthy();
    expect(host.querySelector(".side-rail button[aria-label='Board']")).toBeNull();
    expect(host.querySelector(".side-rail button[aria-label='Docker']")).toBeNull();
    expect(host.querySelector(".side-rail .unread-dot")).toBeTruthy();
    expect(host.querySelector(".setup-btn")?.getAttribute("aria-label")).toBe("Setup");
    expect(host.querySelector(".setup-btn .rail-icon svg")).toBeTruthy();
    expect(host.querySelector(".side-rail button[aria-label='Settings']")).toBeTruthy();
    expect(host.querySelector(".side-rail button[aria-label='Expand sidebar']")).toBeTruthy();
    expect(host.querySelector(".side-rail-chrome .setup-btn")).toBeTruthy();
    expect(host.querySelector(".rail-conn")?.getAttribute("role")).toBe("status");
    expect(host.querySelector(".rail-conn")?.getAttribute("aria-label")).toMatch(
      /Connected|Offline/,
    );
    expect(host.querySelector(".rail-conn")?.getAttribute("aria-hidden")).toBeNull();
    expect(host.querySelector(".side-actions .btn.primary")?.getAttribute("aria-label")).toBe(
      "New agent",
    );
    expect(host.querySelector(".session-item[title='Build the agent']")).toBeTruthy();
    expect(host.querySelector(".side-main")?.hasAttribute("inert")).toBe(true);
    expect(host.querySelector(".side-main")?.getAttribute("aria-hidden")).toBe("true");

    expect(css).toMatch(/\.side-rail \{/);
    expect(css).toMatch(/\.side-rail button:hover \.rail-tip/);
    expect(css).toMatch(/\.side-rail button:focus-visible \.rail-tip/);
    expect(css).toMatch(/\.app \{[\s\S]*?grid-template-columns: 340px 1fr/);
    expect(css).toMatch(/\.app \{[\s\S]*?transition:\s*grid-template-columns var\(--dur-slow\)/);
    expect(css).toMatch(/\.collapsed \.side-main \{[\s\S]*?visibility:\s*hidden/);
    expect(css).toMatch(/\.collapsed \.side-rail \.rail-brand \{[\s\S]*?display: block/);
    expect(css).toMatch(/\.brand-mark \{[\s\S]*?url\("\/logo\.svg"\)/);
    expect(css).toMatch(/grid-template-columns: var\(--rail-w, 64px\) 1fr/);
    expect(css).toMatch(/\.topbar \{[\s\S]*?border-bottom: 1px solid var\(--line\)/);
    expect(css).toMatch(/\.sidebar \{[\s\S]*?border-right: 1px solid var\(--line\)/);
    expect(css).not.toMatch(/\.collapsed \.sidebar \{[\s\S]*?border-right-color:\s*transparent/);
  });

  it("animates the workspace when swapping Agents, Design, and Automations", () => {
    expect(css).toMatch(/\.workspace-stage \{[\s\S]*?flex: 1/);
    expect(css).toMatch(
      /\.workspace-stage\[data-enter="forward"\]\.is-entering \{[\s\S]*?animation:\s*workspace-stage-forward/,
    );
    expect(css).toMatch(
      /\.workspace-stage\[data-enter="back"\]\.is-entering \{[\s\S]*?animation:\s*workspace-stage-back/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.workspace-stage\[data-enter="forward"\]/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.app,[\s\S]*?\.body,[\s\S]*?transition:\s*none/,
    );
  });

  it("groups linked repos by forge with compact badges and PR counts", () => {
    const github: LinkedRepo = {
      id: "r1",
      name: "acme/app",
      checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
      openPullCount: 3,
      autoReview: true,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const gitlab: LinkedRepo = {
      id: "r2",
      name: "acme/api",
      checkout: { forge: "gitlab", url: "https://gitlab.com/acme/api.git", ref: "main" },
      openPullCount: 0,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    render({
      ...initialState,
      section: "codebase",
      selectedRepoId: "r1",
      repos: [github, gitlab],
    });
    expect(host.querySelector(".repo-group-label")?.textContent).toBe("GitHub");
    expect(host.querySelectorAll(".repo-group").length).toBe(2);
    expect(host.querySelector(".repo-item.active .repo-item-open .forge-glyph")?.textContent).toBe(
      "GH",
    );
    expect(host.querySelector(".repo-item.active .title-text")?.textContent).toBe("app");
    expect(host.querySelector(".repo-item.active .meta")?.textContent).toBe("acme/app · main");
    expect(host.querySelector(".repo-item.active .pr-count")?.textContent).toBe("3");
    expect(host.querySelector(".repo-item.active .repo-flag")?.textContent).toBe("auto");
    expect(host.querySelector(".side-foot .hint")?.textContent).toBe("2 repos");
    expect(host.querySelector(".search")?.getAttribute("placeholder")).toBe("Search repos");
    expect(host.querySelector(".search-wrap .search-icon svg")).toBeTruthy();
    expect(host.querySelector(".repo-item.active [aria-label='More for acme/app']")).toBeTruthy();
    expect(css).toMatch(
      /\.session-item\.repo-item \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/,
    );
  });

  it("shows the short repo name when the owner segment is long", () => {
    const repo: LinkedRepo = {
      id: "r3",
      name: "Modsofthenation/Locus",
      checkout: {
        forge: "github",
        url: "https://github.com/Modsofthenation/Locus.git",
        ref: "main",
      },
      openPullCount: 0,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    render({ ...initialState, section: "codebase", selectedRepoId: "r3", repos: [repo] });
    expect(host.querySelector(".repo-item .title-text")?.textContent).toBe("Locus");
    expect(host.querySelector(".repo-item .meta")?.textContent).toBe(
      "Modsofthenation/Locus · main",
    );
  });

  it("shows an empty catalog hint", () => {
    render({ ...initialState, section: "codebase" });
    expect(host.querySelector(".empty-list")?.textContent).toMatch(/No linked repos/);
    expect(
      host.querySelector(".empty-list [data-testid='locus-mascot']")?.getAttribute("data-pose"),
    ).toBe("rest");
  });

  it("lists Slack channels and DMs with hash prefixes", () => {
    render({
      ...initialState,
      section: "slack",
      selectedSlackChannelId: "C_ENG",
      slackStatus: {
        connected: true,
        teamName: "Locus Dev",
        userId: "U_YOU",
        socket: "down",
      },
      slackConversations: [
        { id: "C_ENG", name: "eng", kind: "channel", topic: "Shipping" },
        {
          id: "D_BOB",
          name: "bob",
          kind: "im",
          avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_BOB.png",
        },
      ],
    });
    expect(host.querySelector(".brand p")?.textContent).toBe("slack · Locus Dev");
    expect(host.querySelector(".search")?.getAttribute("placeholder")).toBe("Search channels");
    expect([...host.querySelectorAll(".session-group-label")].map((el) => el.textContent)).toEqual([
      "Channels",
      "Direct messages",
    ]);
    expect(host.querySelector(".session-item.active .title-text")?.textContent).toBe("eng");
    expect(host.querySelector(".session-item.active .slack-list-prefix")?.textContent).toBe("#");
    expect(host.querySelector('[aria-label="Star eng"]')).toBeTruthy();
    expect(host.textContent).toContain("Direct messages");
    expect(host.textContent).toContain("bob");
    const dmAvatar = host.querySelector(".slack-list-avatar") as HTMLImageElement | null;
    expect(dmAvatar?.getAttribute("src")).toBe("https://ca.slack-edge.com/T_MOCK-U_BOB.png");
    expect(host.querySelector(".side-foot .hint")?.textContent).toBe("2 conversations");
  });

  it("pins a Slack channel onto an agent from the conversation row", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
    render({
      ...initialState,
      section: "slack",
      sessions: [session],
      slackStatus: {
        connected: true,
        teamName: "Locus Dev",
        userId: "U_YOU",
        socket: "down",
      },
      slackConversations: [{ id: "C_ENG", name: "eng", kind: "channel", topic: "Shipping" }],
    });
    const listen = host.querySelector("[data-testid='slack-listen']") as HTMLButtonElement;
    expect(listen?.getAttribute("aria-label")).toMatch(/Listen to eng/);
    await act(async () => {
      listen.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        subscriptions: expect.arrayContaining([
          expect.objectContaining({ kind: "slack_channel", channelId: "C_ENG" }),
        ]),
      }),
    );
  });

  it("shows Listening on a pinned Slack row", () => {
    render({
      ...initialState,
      section: "slack",
      selectedSlackChannelId: "C_ENG",
      sessions: [
        {
          ...session,
          subscriptions: [
            {
              id: "sub1",
              kind: "slack_channel",
              title: "eng",
              createdAt: "2020-01-01T00:00:00.000Z",
              channelId: "C_ENG",
            },
          ],
        },
      ],
      slackStatus: {
        connected: true,
        teamName: "Locus Dev",
        userId: "U_YOU",
        socket: "down",
      },
      slackConversations: [{ id: "C_ENG", name: "eng", kind: "channel", topic: "Shipping" }],
    });
    expect(host.querySelector(".session-item.active .meta")?.textContent).toBe(
      "Listening · Shipping",
    );
    expect(host.querySelector("[data-group='channels'] .session-group-label")?.textContent).toBe(
      "Channels",
    );
    expect(host.querySelector("[data-testid='slack-listen']")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("lists Slack Activity above channels and dots the rail when unseen", () => {
    render({
      ...initialState,
      section: "slack",
      selectedSlackChannelId: "C_ENG",
      slackStatus: {
        connected: true,
        teamName: "Locus Dev",
        userId: "U_YOU",
        socket: "down",
      },
      slackActivityUnseen: true,
      slackActivity: [
        {
          id: "C_ENG:1",
          kind: "mention",
          channelId: "C_ENG",
          ts: "1.0",
          text: "hey",
          userName: "alice",
        },
      ],
      slackConversations: [{ id: "C_ENG", name: "eng", kind: "channel", topic: "Shipping" }],
    });
    const activity = host.querySelector("[data-testid='slack-activity-nav']");
    expect(activity?.textContent).toContain("Activity");
    expect(activity?.textContent).toContain("1");
    expect(activity?.querySelector(".unread-dot")).toBeTruthy();
    expect(host.querySelector(".rail-more .unread-dot")).toBeTruthy();
    expect(css).toMatch(/\.slack-activity-item \{/);
  });

  it("lists Slack Unreads, Starred, Channels, and Direct messages like Slack.app", () => {
    render({
      ...initialState,
      section: "slack",
      selectedSlackChannelId: "C_ENG",
      slackStatus: {
        connected: true,
        teamName: "Locus Dev",
        userId: "U_YOU",
        socket: "down",
      },
      slackConversations: [
        { id: "C_ENG", name: "eng", kind: "channel", unread: true, starred: true },
        { id: "C_OPS", name: "ops", kind: "channel" },
        { id: "D_BOB", name: "bob", kind: "im" },
      ],
    });
    expect([...host.querySelectorAll(".session-group-label")].map((el) => el.textContent)).toEqual([
      "Unreads",
      "Starred",
      "Channels",
      "Direct messages",
    ]);
    expect(host.querySelector("[data-group='unreads'] .title-text")?.textContent).toBe("eng");
    expect(host.querySelector("[data-group='starred'] .title-text")?.textContent).toBe("eng");
    expect(
      [...host.querySelectorAll("[data-group='channels'] .title-text")].map((el) => el.textContent),
    ).toEqual(["eng", "ops"]);
  });

  it("collapses Slack sidebar groups and remembers that after remount", () => {
    const slackState: UiState = {
      ...initialState,
      section: "slack",
      selectedSlackChannelId: "C_ENG",
      slackStatus: {
        connected: true,
        teamName: "Locus Dev",
        userId: "U_YOU",
        socket: "down",
      },
      slackConversations: [
        { id: "C_ENG", name: "eng", kind: "channel", topic: "Shipping" },
        {
          id: "D_BOB",
          name: "bob",
          kind: "im",
          avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_BOB.png",
        },
      ],
    };
    render(slackState);
    const channelsToggle = [...host.querySelectorAll(".session-group-toggle")].find((el) =>
      el.textContent?.includes("Channels"),
    ) as HTMLButtonElement;
    expect(channelsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      host.querySelector("[data-group='channels'] .session-item .title-text")?.textContent,
    ).toBe("eng");
    act(() => {
      channelsToggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(channelsToggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("[data-group='channels'] .session-item")).toBeNull();
    expect(host.textContent).toContain("bob");
    act(() => root.unmount());
    host.remove();
    render(slackState);
    const restored = [...host.querySelectorAll(".session-group-toggle")].find((el) =>
      el.textContent?.includes("Channels"),
    );
    expect(restored?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("[data-group='channels'] .session-item")).toBeNull();
    expect(host.textContent).toContain("Direct messages");
  });

  it("shows a channel list skeleton while Slack is still loading", () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: null,
      slackConversations: [],
    });
    expect(host.querySelector("[data-testid='slack-channel-list-skeleton']")).toBeTruthy();
    expect(host.querySelector(".empty-list")).toBeNull();
    expect(host.querySelector(".side-foot .hint")?.textContent).toBe("Loading conversations");
    expect(host.textContent).not.toContain("Sign in with Slack");
    expect(host.textContent).not.toContain("No channels yet");
  });

  it("shows a channel list skeleton when Slack is already linked but still probing", () => {
    render({
      ...initialState,
      section: "slack",
      config: {
        integrations: [
          {
            id: "slack-1",
            kind: "slack",
            name: "Slack",
            enabled: true,
            baseUrl: "https://slack.com/api",
            userToken: "••••••••",
            userName: "you",
            teamName: "Locus Dev",
          },
        ],
      } as UiState["config"],
      slackStatus: { connected: false, socket: "down" },
      slackConversations: [],
    });
    expect(host.querySelector("[data-testid='slack-channel-list-skeleton']")).toBeTruthy();
    expect(host.querySelector(".empty-list")).toBeNull();
    expect(host.querySelector(".side-foot .hint")?.textContent).toBe("Loading conversations");
    expect(host.textContent).not.toContain("Sign in with Slack");
  });

  it("marks private Slack channels with a lock", () => {
    render({
      ...initialState,
      section: "slack",
      selectedSlackChannelId: "G_SHIP",
      slackStatus: {
        connected: true,
        teamName: "Locus Dev",
        userId: "U_YOU",
        socket: "down",
      },
      slackConversations: [
        { id: "C_ENG", name: "eng", kind: "channel", topic: "Shipping" },
        { id: "G_SHIP", name: "shipyard", kind: "private" },
      ],
    });
    const row = [...host.querySelectorAll(".slack-item")].find((el) =>
      el.textContent?.includes("shipyard"),
    );
    expect(row?.querySelector(".slack-list-prefix svg")).toBeTruthy();
    expect(row?.querySelector(".slack-list-prefix")?.textContent).not.toContain("#");
    expect(row?.querySelector(".meta")).toBeNull();
    expect(row?.querySelector(".slack-item-open")?.getAttribute("title")).toBe("🔒shipyard");
  });

  it("lists Docker containers with status dots", () => {
    render({
      ...initialState,
      section: "docker",
      selectedContainerId: "c1",
      containers: [
        {
          id: "c1",
          name: "web",
          image: "nginx:alpine",
          state: "running",
          status: "Up",
          createdAt: "2020-01-01T00:00:00.000Z",
          locus: false,
        },
      ],
    });
    expect(host.querySelector(".brand p")?.textContent).toBe("docker · mock");
    expect(host.querySelector(".session-item.active .title-text")?.textContent).toBe("web");
    expect(host.querySelector(".session-item .dot.running")).toBeTruthy();
    expect(host.querySelector(".session-group-label")?.textContent).toMatch(/Running \(1\)/);
    expect(host.querySelector(".session-item .meta")?.textContent).toMatch(/c1/);
    expect(host.querySelector(".side-actions .btn.primary")).toBeNull();
    expect(host.querySelector(".side-actions [aria-label='Refresh containers']")).toBeTruthy();
    expect(
      host.querySelector(".side-actions [aria-label='Stop selected containers']"),
    ).toBeTruthy();
    expect(host.textContent).toContain("Running only");
    expect(host.querySelector(".side-foot .hint")?.textContent).toMatch(/1 container/);
    expect(host.querySelector(".search-wrap .search-icon svg")).toBeTruthy();
    expect(host.querySelector(".search")?.getAttribute("placeholder")).toBe(
      "Search containers or services",
    );
    expect(host.querySelector(".search-wrap kbd")).toBeNull();
    expect(host.querySelector(".side-foot .hint")?.textContent).toMatch(/daemon mock/);
    expect(host.querySelector("[data-testid='docker-swarm-tab']")?.textContent).toBe("Swarm");
    expect(css).toMatch(
      /\.session-item\.docker-item \{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(/\.session-item\.active[\s\S]*?border-color:\s*var\(--accent\)/);
    expect(css).toMatch(
      /\.docker-pick \{[\s\S]*?padding: 0 var\(--space-2-5\) 0 var\(--space-2-5\)/,
    );
    expect(css).toMatch(/\.docker-item-open \{[\s\S]*?gap: var\(--space-2\)/);
    expect(css).toMatch(
      /\.docker-item-open \{[\s\S]*?padding: var\(--space-2\) var\(--space-2-5\) var\(--space-2\) var\(--space-2\)/,
    );
  });

  it("lists Docker Swarm services on the Swarm tab", () => {
    render({
      ...initialState,
      section: "docker",
      dockerView: "swarm",
      selectedSwarmServiceId: "svc123456789",
      dockerSwarm: {
        info: { state: "active", controlAvailable: true },
        nodes: [
          {
            id: "n1n1n1n1n1n1",
            hostname: "manager",
            status: "Ready",
            availability: "Active",
            managerStatus: "Leader",
          },
        ],
        services: [
          {
            id: "svc123456789",
            name: "web",
            image: "nginx:latest",
            mode: "replicated",
            replicas: "2/2",
          },
        ],
        stacks: [{ name: "app", services: 1 }],
      },
    });
    expect(host.querySelector("[data-testid='docker-swarm-tab']")?.className).toMatch(/on/);
    expect(host.textContent).toMatch(/Services \(1\)/);
    expect(host.textContent).toMatch(/Nodes \(1\)/);
    expect(host.textContent).toMatch(/Stacks \(1\)/);
    expect(host.querySelector(".session-item.active .title-text")?.textContent).toBe("web");
    expect(host.querySelector(".side-foot .hint")?.textContent).toMatch(/swarm manager/);
    expect(host.querySelector(".side-foot .hint")?.textContent).toMatch(/1 stack/);
    expect(host.querySelector("[aria-label='Stop selected containers']")).toBeNull();
  });

  it("groups stopped and exited Docker containers", () => {
    render({
      ...initialState,
      section: "docker",
      selectedContainerId: "c1",
      containers: [
        {
          id: "c1",
          name: "web",
          image: "nginx:alpine",
          state: "running",
          status: "Up 2 hours",
          createdAt: "2020-01-01T00:00:00.000Z",
          locus: true,
        },
        {
          id: "c2",
          name: "worker",
          image: "node:22",
          state: "stopped",
          status: "Stopped",
          createdAt: "2020-01-01T00:00:00.000Z",
          locus: false,
        },
        {
          id: "c3",
          name: "old",
          image: "redis",
          state: "exited",
          status: "Exited (0) 2 days ago",
          createdAt: "2020-01-01T00:00:00.000Z",
          locus: false,
        },
      ],
    });
    const labels = [...host.querySelectorAll(".session-group-label")].map((el) => el.textContent);
    expect(labels).toEqual(["Running (1)", "Stopped (1)", "Exited (1)"]);
    expect(host.querySelector("[data-group='running'] .docker-age")?.textContent).toBe("2h");
    expect(host.querySelector("[data-group='exited'] .title-text")?.textContent).toBe("old");
    expect(host.querySelector(".side-foot .conn")).toBeNull();
  });

  it("stops selected Docker containers", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.dockerContainersStop).mockResolvedValue({
      stopped: [
        {
          id: "c1",
          name: "web",
          image: "nginx:alpine",
          state: "stopped",
          status: "Exited",
          createdAt: "2020-01-01T00:00:00.000Z",
          locus: false,
        },
        {
          id: "c2",
          name: "api",
          image: "node:22",
          state: "stopped",
          status: "Exited",
          createdAt: "2020-01-01T00:00:00.000Z",
          locus: false,
        },
      ],
      errors: [],
    });
    vi.mocked(api.dockerContainers).mockResolvedValue({ kind: "mock", containers: [] });
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "docker",
              selectedContainerId: "c1",
              containers: [
                {
                  id: "c1",
                  name: "web",
                  image: "nginx:alpine",
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
                {
                  id: "c3",
                  name: "old",
                  image: "redis",
                  state: "exited",
                  status: "Exited",
                  createdAt: "2020-01-01T00:00:00.000Z",
                  locus: false,
                },
              ],
            },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    expect(host.querySelector("[aria-label='Stop all running containers']")?.textContent).toMatch(
      /Stop all/,
    );
    await act(async () => {
      (
        host.querySelector("[aria-label='Stop all running containers']") as HTMLButtonElement
      ).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.dockerContainersStop).toHaveBeenCalledWith(["c1", "c2"]);
    expect(dispatch).toHaveBeenCalledWith({ type: "containers", containers: [] });
  });

  it("unlinks a repo from the sidebar menu", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const dispatch = vi.fn();
    const github: LinkedRepo = {
      id: "r1",
      name: "acme/app",
      checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, section: "codebase", repos: [github], selectedRepoId: "r1" },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    act(() => {
      (host.querySelector("[aria-label='More for acme/app']") as HTMLElement).click();
    });
    await act(async () => {
      const unlink = [...host.querySelectorAll(".menu-item")].find(
        (btn) => btn.textContent === "Unlink",
      );
      (unlink as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(api.deleteRepo).toHaveBeenCalledWith("r1");
    expect(dispatch).toHaveBeenCalledWith({ type: "repoDeleted", id: "r1" });
  });

  it("keeps the repo when sidebar unlink fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.deleteRepo).mockRejectedValueOnce(new Error("forge down"));
    const dispatch = vi.fn();
    const github: LinkedRepo = {
      id: "r1",
      name: "acme/app",
      checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, section: "codebase", repos: [github], selectedRepoId: "r1" },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    act(() => {
      (host.querySelector("[aria-label='More for acme/app']") as HTMLElement).click();
    });
    await act(async () => {
      const unlink = [...host.querySelectorAll(".menu-item")].find(
        (btn) => btn.textContent === "Unlink",
      );
      (unlink as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(dispatch).not.toHaveBeenCalledWith({ type: "repoDeleted", id: "r1" });
  });

  it("keeps Compare and Replay off Needs you rows", () => {
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const gated: AgentSession = {
      ...session,
      needsHuman: "Approve git_push",
      messages: [
        {
          id: "u1",
          role: "user",
          content: "ship it",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          content: "need approval",
          screenshotName: "shot.png",
          createdAt: "2020-01-01T00:00:01.000Z",
        },
      ],
    };
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, sessions: [gated] },
            dispatch,
          }}
        >
          <Sidebar />
        </Store.Provider>,
      );
    });
    const group = host.querySelector(".session-group") as HTMLElement;
    expect(group.querySelector(".session-group-label.warn")?.textContent).toBe("Needs you");
    expect(group.querySelector('[aria-label="I don\'t trust this"]')).toBeNull();
    expect(
      [...group.querySelectorAll("button")].some((btn) => btn.textContent === "Compare models"),
    ).toBe(false);
    expect([...group.querySelectorAll("button")].some((btn) => btn.textContent === "Replay")).toBe(
      false,
    );
  });

  it("shows last run, last fact, and next fire on automation cards", () => {
    render({
      ...initialState,
      section: "automations",
      automations: [
        {
          id: "auto-1",
          name: "Overnight",
          enabled: true,
          prompt: "check grafana",
          os: "ubuntu",
          templateId: "ubuntu-24.04",
          providerId: "p",
          model: "grok-4",
          startVm: false,
          persistMemory: true,
          memories: [
            {
              id: "m1",
              text: "Grafana is down after 2am",
              createdAt: "2026-08-29T02:00:00.000Z",
            },
          ],
          schedule: { kind: "interval", everyMinutes: 60 },
          lastRunAt: "2026-08-29T02:00:00.000Z",
          nextRunAt: "2026-08-29T12:00:00.000Z",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T02:00:00.000Z",
        },
      ],
      runs: [
        {
          id: "run-1",
          automationId: "auto-1",
          status: "succeeded",
          trigger: "schedule",
          startedAt: "2026-08-29T02:00:00.000Z",
          finishedAt: "2026-08-29T02:05:00.000Z",
        },
      ],
    });
    const card = host.querySelector(".session-item") as HTMLElement;
    expect(card.textContent).toContain("Overnight");
    expect(card.textContent).toContain("Grafana is down after 2am");
    expect(card.textContent).toContain("succeeded");
    expect(card.textContent).toMatch(/Last /);
    expect(card.textContent).toMatch(/Next /);
  });

  it("filters paused automations and matches schedule in search", () => {
    render({
      ...initialState,
      section: "automations",
      queries: { automations: "git push" },
      automations: [
        {
          id: "auto-1",
          name: "Ship check",
          enabled: false,
          prompt: "lint",
          os: "ubuntu",
          templateId: "ubuntu-24.04",
          providerId: "p",
          model: "grok-4",
          startVm: false,
          schedule: { kind: "forge" },
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
        },
        {
          id: "auto-2",
          name: "Nightly",
          enabled: true,
          prompt: "tests",
          os: "ubuntu",
          templateId: "ubuntu-24.04",
          providerId: "p",
          model: "grok-4",
          startVm: false,
          schedule: { kind: "daily", hour: 9, minute: 0 },
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
        },
      ],
    });
    expect(host.textContent).toContain("Ship check");
    expect(host.textContent).not.toContain("Nightly");
    const filter = host.querySelector('[aria-label="Job filter"]') as HTMLElement;
    const paused = [...filter.querySelectorAll("button")].find((el) => el.textContent === "Paused");
    act(() => {
      paused?.click();
    });
    expect(host.textContent).toContain("Ship check");
    const failing = [...filter.querySelectorAll("button")].find(
      (el) => el.textContent === "Failing",
    );
    act(() => {
      failing?.click();
    });
    expect(host.textContent).toContain("No matching automations");
  });

  it("shows a health strip above the automation list", () => {
    render({
      ...initialState,
      section: "automations",
      automations: [
        {
          id: "auto-1",
          name: "Nightly",
          enabled: true,
          prompt: "tests",
          os: "ubuntu",
          templateId: "ubuntu-24.04",
          providerId: "p",
          model: "grok-4",
          startVm: false,
          schedule: { kind: "daily", hour: 2, minute: 0 },
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
        },
        {
          id: "auto-2",
          name: "Broken",
          enabled: true,
          prompt: "ping",
          os: "ubuntu",
          templateId: "ubuntu-24.04",
          providerId: "p",
          model: "grok-4",
          startVm: false,
          schedule: { kind: "interval", everyMinutes: 30 },
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
        },
        {
          id: "auto-3",
          name: "Digest",
          enabled: false,
          prompt: "summary",
          os: "ubuntu",
          templateId: "ubuntu-24.04",
          providerId: "p",
          model: "grok-4",
          startVm: false,
          schedule: { kind: "daily", hour: 9, minute: 0 },
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
        },
      ],
      runs: [
        {
          id: "run-fail",
          automationId: "auto-2",
          status: "failed",
          trigger: "schedule",
          startedAt: "2026-08-29T02:00:00.000Z",
          finishedAt: "2026-08-29T02:01:00.000Z",
        },
      ],
    });
    expect(host.querySelector("[data-testid='auto-health']")?.textContent).toContain(
      "1 healthy · 1 failing · 1 paused",
    );
  });

  it("splits the automations list and recent activity into equal sidebar panes", () => {
    const automations = Array.from({ length: 8 }, (_, i) => ({
      id: `auto-${i + 1}`,
      name: `Job ${i + 1}`,
      enabled: true,
      prompt: "x",
      os: "ubuntu" as const,
      templateId: "ubuntu-24.04",
      providerId: "p",
      model: "grok-4",
      startVm: false,
      schedule: { kind: "interval" as const, everyMinutes: 60 },
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
    }));
    const runs = Array.from({ length: 12 }, (_, i) => ({
      id: `run-${i + 1}`,
      automationId: automations[i % automations.length]!.id,
      status: i === 0 ? ("failed" as const) : ("succeeded" as const),
      trigger: "schedule" as const,
      startedAt: `2026-08-29T${String(11 - (i % 12)).padStart(2, "0")}:00:00.000Z`,
      finishedAt: `2026-08-29T${String(11 - (i % 12)).padStart(2, "0")}:01:00.000Z`,
    }));
    render({
      ...initialState,
      section: "automations",
      automations,
      runs,
    });
    const split = host.querySelector(".auto-side-split") as HTMLElement;
    const list = split.querySelector(".session-list") as HTMLElement;
    const fleet = split.querySelector("[data-testid='auto-fleet-activity']") as HTMLElement;
    expect(split.classList.contains("is-open")).toBe(true);
    expect(list.compareDocumentPosition(fleet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.textContent).toContain("Job 1");
    expect(list.textContent).toContain("Job 8");
    expect(fleet.querySelectorAll(".auto-fleet-row")).toHaveLength(10);
    act(() => {
      (fleet.querySelector(".auto-fleet-toggle") as HTMLButtonElement).click();
    });
    expect(split.classList.contains("is-open")).toBe(false);
    expect(fleet.querySelector(".auto-fleet-list")).toBeNull();
    expect(list.textContent).toContain("Job 1");
    expect(css).toMatch(
      /\.auto-side-split\.is-open \{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(
      /\.auto-side-split\.is-open > \.auto-fleet-activity \{[\s\S]*?overflow:\s*hidden/,
    );
    expect(css).toMatch(/\.auto-fleet-list \{[\s\S]*?overflow:\s*auto/);
    expect(css).toMatch(/\.side-list-pane \{[\s\S]*?flex:\s*1/);
  });

  it("selects an automation from recent activity without hiding the job list", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Live() {
      const [state, dispatch] = useReducer(reducer, {
        ...initialState,
        section: "automations" as const,
        selectedAutomationId: "auto-1",
        automations: [
          {
            id: "auto-1",
            name: "Nightly",
            enabled: true,
            prompt: "tests",
            os: "ubuntu" as const,
            templateId: "ubuntu-24.04",
            providerId: "p",
            model: "grok-4",
            startVm: false,
            schedule: { kind: "daily" as const, hour: 2, minute: 0 },
            createdAt: "2026-08-29T00:00:00.000Z",
            updatedAt: "2026-08-29T00:00:00.000Z",
          },
          {
            id: "auto-2",
            name: "Broken",
            enabled: true,
            prompt: "ping",
            os: "ubuntu" as const,
            templateId: "ubuntu-24.04",
            providerId: "p",
            model: "grok-4",
            startVm: false,
            schedule: { kind: "interval" as const, everyMinutes: 30 },
            createdAt: "2026-08-29T00:00:00.000Z",
            updatedAt: "2026-08-29T00:00:00.000Z",
          },
        ],
        runs: [
          {
            id: "run-fail",
            automationId: "auto-2",
            status: "failed" as const,
            trigger: "schedule" as const,
            startedAt: "2026-08-29T03:00:00.000Z",
            finishedAt: "2026-08-29T03:01:00.000Z",
          },
        ],
      });
      return (
        <Store.Provider value={{ state, dispatch }}>
          <Sidebar />
        </Store.Provider>
      );
    }
    act(() => {
      root.render(<Live />);
    });
    const fleet = host.querySelector("[data-testid='auto-fleet-activity']") as HTMLElement;
    const jobBtn = [...fleet.querySelectorAll("button")].find((el) => el.textContent === "Broken");
    act(() => {
      jobBtn?.click();
    });
    expect(host.querySelector(".session-item.active")?.textContent).toContain("Broken");
    expect(host.querySelector(".session-list")?.textContent).toContain("Nightly");
  });

  it("keeps a job failing after a later Send-test skip", () => {
    render({
      ...initialState,
      section: "automations",
      automations: [
        {
          id: "auto-2",
          name: "Broken",
          enabled: true,
          prompt: "ping",
          os: "ubuntu",
          templateId: "ubuntu-24.04",
          providerId: "p",
          model: "grok-4",
          startVm: false,
          schedule: { kind: "interval", everyMinutes: 30 },
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
        },
      ],
      runs: [
        {
          id: "run-fail",
          automationId: "auto-2",
          status: "failed",
          trigger: "schedule",
          startedAt: "2026-08-29T02:00:00.000Z",
          finishedAt: "2026-08-29T02:01:00.000Z",
        },
        {
          id: "run-test",
          automationId: "auto-2",
          status: "skipped",
          trigger: "webhook",
          error: "Test POST accepted. No agent run.",
          startedAt: "2026-08-29T03:00:00.000Z",
          finishedAt: "2026-08-29T03:00:00.000Z",
        },
      ],
    });
    expect(host.querySelector("[data-testid='auto-health']")?.textContent).toContain(
      "0 healthy · 1 failing · 0 paused",
    );
    const filter = host.querySelector('[aria-label="Job filter"]') as HTMLElement;
    const failing = [...filter.querySelectorAll("button")].find(
      (el) => el.textContent === "Failing",
    );
    act(() => {
      failing?.click();
    });
    expect(host.textContent).toContain("Broken");
  });

  it("sorts by trigger groups and can pause listed jobs", async () => {
    render({
      ...initialState,
      section: "automations",
      automations: [
        {
          id: "auto-daily",
          name: "Daily job",
          enabled: true,
          prompt: "x",
          os: "ubuntu",
          templateId: "ubuntu-24.04",
          providerId: "p",
          model: "grok-4",
          startVm: false,
          schedule: { kind: "daily", hour: 9, minute: 0 },
          createdAt: "2026-08-17T12:00:00.000Z",
          updatedAt: "2026-08-17T12:00:00.000Z",
        },
        {
          id: "auto-hook",
          name: "Hook job",
          enabled: true,
          prompt: "y",
          os: "ubuntu",
          templateId: "ubuntu-24.04",
          providerId: "p",
          model: "grok-4",
          startVm: false,
          schedule: { kind: "webhook" },
          createdAt: "2026-08-17T12:00:00.000Z",
          updatedAt: "2026-08-17T12:00:00.000Z",
        },
      ],
    });
    expect(host.querySelector("[data-testid='auto-bulk']")).toBeTruthy();
    const sort = host.querySelector('[aria-label="Automation sort"]') as HTMLElement;
    const byTrigger = [...sort.querySelectorAll("button")].find(
      (el) => el.textContent === "By trigger",
    );
    act(() => {
      byTrigger?.click();
    });
    expect(host.querySelector("[data-testid='auto-group-daily']")?.textContent).toContain(
      "Daily job",
    );
    expect(host.querySelector("[data-testid='auto-group-webhook']")?.textContent).toContain(
      "Hook job",
    );
    const pauseListed = [...host.querySelectorAll("button")].find(
      (el) => el.textContent === "Pause listed",
    );
    await act(async () => {
      pauseListed?.click();
    });
    const modal = host.querySelector("[data-testid='auto-bulk-confirm']");
    expect(modal?.textContent).toContain("Pause 2 automations");
    const confirm = [...modal!.querySelectorAll("button")].find(
      (el) => el.textContent === "Pause listed",
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchAutomation).toHaveBeenCalledWith("auto-daily", { enabled: false });
    expect(api.patchAutomation).toHaveBeenCalledWith("auto-hook", { enabled: false });
  });

  it("moves Settings tabs with Arrow keys and j/k", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Live() {
      const [state, dispatch] = useReducer(reducer, {
        ...initialState,
        section: "settings" as const,
      });
      return (
        <Store.Provider value={{ state, dispatch }}>
          <Sidebar />
        </Store.Provider>
      );
    }
    act(() => {
      root.render(<Live />);
    });
    const nav = host.querySelector(".settings-nav") as HTMLElement;
    const active = () =>
      host.querySelector(".settings-nav button.active")?.getAttribute("data-tab");
    expect(active()).toBe("providers");
    act(() => {
      nav.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    expect(active()).toBe("mcp");
    act(() => {
      nav.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }),
      );
    });
    expect(active()).toBe("skills");
    act(() => {
      nav.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true }),
      );
    });
    expect(active()).toBe("mcp");
    act(() => {
      nav.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
      );
    });
    expect(active()).toBe("providers");
  });

  it("auto-saves and leaves dirty Settings without a discard prompt", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Live() {
      const [state, dispatch] = useReducer(reducer, {
        ...initialState,
        section: "settings" as const,
        sessions: [session],
      });
      return (
        <Store.Provider value={{ state, dispatch }}>
          <Sidebar />
        </Store.Provider>
      );
    }
    act(() => {
      root.render(<Live />);
    });
    setSettingsDirty(true);
    const confirm = vi.spyOn(window, "confirm");
    const agents = host.querySelector(
      ".side-rail-nav button[aria-label='Agents']",
    ) as HTMLButtonElement;
    act(() => {
      agents.click();
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(host.querySelector(".settings-nav")).toBeNull();
  });
});
