import { act, type Dispatch } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, LocusConfig, ProjectDocument } from "@locus/shared";
import { ProjectFleet } from "./ProjectPane";
import { api } from "@/lib/api";
import { Store, initialState, type Action, type UiState } from "@/state/store";
import { setSelectValue } from "@/lib/selectControl";

vi.mock("@/lib/api", () => ({
  api: {
    projectContext: vi.fn(async () => [{ path: "INDEX.md", bytes: 23 }]),
    projectContextRead: vi.fn(async () => ({
      path: "INDEX.md",
      content: "# Team Rapid Fire\nShared notes.",
    })),
    projectMissionControl: vi.fn(async () => ({
      project: null,
      members: [],
      needsYou: [],
      handoffs: [],
      health: "healthy" as const,
      routines: [],
      context: [{ path: "INDEX.md", bytes: 23 }],
      audit: [],
      spendUsd: 0,
    })),
    patchProject: vi.fn(),
    projectNeedAction: vi.fn(),
    createProjectHandoff: vi.fn(),
    projectHandoffAction: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: LocusConfig = {
  theme: "ember",
  productMode: "swarm",
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

const project: ProjectDocument = {
  id: "team-1",
  title: "Team Rapid Fire",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  coordinatorSessionId: "coord",
  memberIds: ["mate-1"],
  maxConcurrentMembers: 4,
  surface: "swarm",
  team: {
    name: "Team Rapid Fire",
    members: [
      {
        sessionId: "mate-1",
        role: "Builder",
        capabilities: [],
        enabled: true,
        assignedAt: "2020-01-01T00:00:00.000Z",
      },
    ],
  },
};

const coordinator: AgentSession = {
  id: "coord",
  title: "Team Rapid Fire",
  os: "ubuntu",
  templateId: "host",
  providerId: "p",
  model: "m",
  status: "idle",
  kind: "project",
  surface: "swarm",
  projectId: "team-1",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

const teammate: AgentSession = {
  id: "mate-1",
  title: "The Builder",
  os: "ubuntu",
  templateId: "host",
  providerId: "p",
  model: "m",
  status: "idle",
  surface: "swarm",
  projectId: "team-1",
  persona: { displayName: "The Builder", hubRole: "Builder" },
  instructions: "Ship the landing page.",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("ProjectFleet hub roster", () => {
  let host: HTMLDivElement;
  let root: Root;
  let dispatched: Action[] = [];
  let state: UiState;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  function render(selectedId: string | null = coordinator.id) {
    dispatched = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    state = {
      ...initialState,
      config,
      selectedId,
      selectedProjectId: project.id,
      projectDocuments: { [project.id]: project },
      projects: [
        {
          id: project.id,
          title: project.title,
          teamName: "Team Rapid Fire",
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          coordinatorSessionId: project.coordinatorSessionId,
          memberCount: 1,
          memberIds: project.memberIds,
          surface: "swarm",
        },
      ],
      sessions: [coordinator, teammate],
      boards: [
        {
          id: "board-1",
          title: "Auth plan",
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          objectCount: 2,
          frameCount: 1,
        },
      ],
    };
    const dispatch = ((action: Action) => {
      dispatched.push(action);
      if (action.type === "select") {
        state = { ...state, selectedId: action.id };
        act(() => {
          root.render(
            <Store.Provider value={{ state, dispatch }}>
              <ProjectFleet project={project} />
            </Store.Provider>,
          );
        });
      }
    }) as Dispatch<Action>;
    act(() => {
      root.render(
        <Store.Provider value={{ state, dispatch }}>
          <ProjectFleet project={project} />
        </Store.Provider>,
      );
    });
  }

  it("marks the selected teammate and switches chat on click", async () => {
    render(coordinator.id);
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="roster-coord"]')?.getAttribute("aria-current")).toBe(
      "true",
    );
    expect(
      host.querySelector('[data-testid="roster-mate-1"]')?.getAttribute("aria-current"),
    ).toBeNull();

    await act(async () => {
      host
        .querySelector('[data-testid="roster-mate-1"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dispatched).toContainEqual({ type: "select", id: "mate-1" });
    expect(host.querySelector('[data-testid="roster-mate-1"]')?.getAttribute("aria-current")).toBe(
      "true",
    );
    expect(host.querySelector('[data-testid="teammate-brief"]')?.textContent).toBe(
      "Ship the landing page.",
    );
  });

  it("opens a team briefing file in the inline viewer", async () => {
    render();
    await act(async () => {
      await Promise.resolve();
    });
    const file = host.querySelector('[data-testid="briefing-file-INDEX.md"]') as HTMLButtonElement;
    expect(file).toBeTruthy();
    await act(async () => {
      file.click();
    });
    expect(api.projectContextRead).toHaveBeenCalledWith("team-1", "INDEX.md");
    const viewer = host.querySelector('[data-testid="briefing-viewer"]');
    expect(viewer?.textContent).toMatch(/Shared notes/);
    const editor = viewer?.querySelector("textarea.project-briefing-editor") as HTMLTextAreaElement;
    expect(editor?.value).toContain("Shared notes");
    expect(editor?.getAttribute("aria-label")).toBe("Team briefing");
  });

  it("pins a board from the fleet More section", async () => {
    vi.mocked(api.patchProject).mockResolvedValue({ ...project, boardId: "board-1" });
    render();
    await act(async () => {
      await Promise.resolve();
    });
    const more = host.querySelector(".project-fleet-more") as HTMLDetailsElement;
    expect(more).toBeTruthy();
    act(() => {
      more.open = true;
    });
    expect(host.querySelector('[aria-label="Board"]')).toBeTruthy();
    act(() => {
      setSelectValue(host, "Board", "board-1");
    });
    await act(async () => {
      const pin = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Pin");
      pin?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.patchProject).toHaveBeenCalledWith("team-1", { boardId: "board-1" });
  });

  it("pins the project to keep running after the desktop quits", async () => {
    vi.mocked(api.patchProject).mockResolvedValue({ ...project, keepAlive: true });
    render();
    await act(async () => {
      await Promise.resolve();
    });
    const buttons = [...host.querySelectorAll("button")].filter(
      (btn) => btn.textContent === "Keep running",
    );
    expect(buttons).toHaveLength(1);
    const button = buttons[0];
    expect(button?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.patchProject).toHaveBeenCalledWith("team-1", { keepAlive: true });
  });
});
