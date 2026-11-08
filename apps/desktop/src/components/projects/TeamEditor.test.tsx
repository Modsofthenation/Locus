import { act, type Dispatch } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, LocusConfig, ProjectDocument } from "@locus/shared";
import { TeamEditor } from "./TeamEditor";
import { api } from "@/lib/api";
import { Store, initialState, type Action } from "@/state/store";
import { setSelectValue } from "@/lib/selectControl";

vi.mock("@/lib/api", () => ({
  api: {
    patchProject: vi.fn(),
    createSession: vi.fn(),
    project: vi.fn(),
    addProjectMember: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setControl(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const config: LocusConfig = {
  theme: "ember",
  providers: [
    {
      id: "p",
      name: "OpenAI",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      models: ["m"],
      defaultModel: "m",
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
};

const project: ProjectDocument = {
  id: "p1",
  title: "Platform",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  goal: "Ship the API",
  memberIds: [],
  maxConcurrentMembers: 4,
  surface: "swarm",
  team: { name: "Platform", members: [] },
};

describe("TeamEditor", () => {
  let host: HTMLDivElement;
  let root: Root;
  let dispatched: Action[] = [];

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  function render(doc: ProjectDocument = project, sessions: AgentSession[] = []) {
    dispatched = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const dispatch = ((action: Action) => {
      dispatched.push(action);
    }) as Dispatch<Action>;
    act(() => {
      root.render(
        <Store.Provider value={{ state: { ...initialState, config, sessions }, dispatch }}>
          <TeamEditor project={doc} />
        </Store.Provider>,
      );
    });
  }

  it("saves a renamed team and its goal", async () => {
    const saved = {
      ...project,
      title: "Infra",
      goal: "Keep deploys boring",
      team: { name: "Infra", members: [] },
      updatedAt: "2020-01-02T00:00:00.000Z",
    };
    vi.mocked(api.patchProject).mockResolvedValue(saved);
    render();
    const name = host.querySelector('[aria-label="Team name"]') as HTMLInputElement;
    const goal = host.querySelector('[aria-label="Team goal"]') as HTMLTextAreaElement;
    act(() => {
      setControl(name, "Infra");
      setControl(goal, "Keep deploys boring");
    });
    const save = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Save team",
    ) as HTMLButtonElement;
    await act(async () => {
      save!.click();
    });
    expect(api.patchProject).toHaveBeenCalledWith("p1", {
      teamName: "Infra",
      title: "Infra",
      goal: "Keep deploys boring",
    });
    expect(dispatched).toEqual([{ type: "project", project: saved }]);
  });

  it("adds a teammate to the open team", async () => {
    const session = { id: "s1", title: "Nova" } as AgentSession;
    const enrolled = { ...project, memberIds: ["s1"], updatedAt: "2020-01-02T00:00:00.000Z" };
    vi.mocked(api.createSession).mockResolvedValue(session);
    vi.mocked(api.project).mockResolvedValue(enrolled);
    render();
    const name = host.querySelector('[aria-label="Teammate name"]') as HTMLInputElement;
    const brief = host.querySelector('[aria-label="Teammate brief"]') as HTMLTextAreaElement;
    act(() => {
      setControl(name, "Nova");
      setSelectValue(host, "Teammate role", "Ops");
      setControl(brief, "Watch deploys");
    });
    const add = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Add teammate",
    );
    await act(async () => {
      add!.click();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "swarm",
        projectId: "p1",
        runtime: "host",
        prompt: "Watch deploys",
        persona: expect.objectContaining({ displayName: "Nova", hubRole: "Ops" }),
      }),
    );
    expect(dispatched).toEqual([
      { type: "session", session },
      { type: "project", project: enrolled },
    ]);
  });

  it("adds an existing teammate to the open team", async () => {
    const nova: AgentSession = {
      id: "s-nova",
      title: "Nova",
      os: "ubuntu",
      templateId: "host",
      providerId: "p",
      model: "m",
      status: "idle",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      surface: "swarm",
      persona: { displayName: "Nova", hubRole: "Researcher" },
    };
    const enrolledSession = { ...nova, projectId: "p1" };
    const enrolled = {
      ...project,
      memberIds: ["s-nova"],
      team: {
        name: "Platform",
        members: [
          {
            sessionId: "s-nova",
            role: "Researcher",
            capabilities: [],
            enabled: true,
            assignedAt: "2020-01-02T00:00:00.000Z",
          },
        ],
      },
      updatedAt: "2020-01-02T00:00:00.000Z",
    };
    vi.mocked(api.addProjectMember).mockResolvedValue({
      project: enrolled,
      session: enrolledSession,
    });
    render(project, [nova]);
    act(() => {
      setSelectValue(host, "Existing teammate", "s-nova");
    });
    const add = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Add to team",
    );
    await act(async () => {
      add!.click();
    });
    expect(api.addProjectMember).toHaveBeenCalledWith("p1", "s-nova");
    expect(dispatched).toEqual([
      { type: "session", session: enrolledSession },
      { type: "project", project: enrolled },
    ]);
  });
});
