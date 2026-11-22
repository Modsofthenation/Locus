import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, LocusConfig } from "@locus/shared";
import { NewSessionModal } from "./NewSession";
import { api } from "@/lib/api";
import { Store, initialState, type Action } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    createSession: vi.fn(),
    fanout: vi.fn(),
    browseHost: vi.fn(async () => ({ path: "/", entries: [] })),
    workersStatus: vi.fn(async () => []),
    saveConfig: vi.fn(),
    images: vi.fn(async () => []),
    listImages: vi.fn(async () => []),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const provider = (id: string, name: string, model: string) => ({
  id,
  name,
  kind: "openai-compatible" as const,
  baseUrl: "http://127.0.0.1:1/v1",
  models: [model],
  defaultModel: model,
  enabled: true,
  extraHeaders: {},
});

const config = {
  theme: "ember",
  providers: [provider("claude", "Claude Code", "opus"), provider("codex", "Codex CLI", "gpt")],
  templates: [{ id: "ubuntu-24.04", os: "ubuntu", name: "Ubuntu" }],
  hardwareProfiles: [],
  forges: [],
  workers: [],
  advanced: { dataDir: "/tmp", bindHost: "127.0.0.1", bindPort: 7420 },
} as unknown as LocusConfig;

const session = (id: string): AgentSession => ({
  id,
  title: "t",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "claude",
  model: "opus",
  status: "idle",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
});

describe("NewSessionModal parallel agents", () => {
  let host: HTMLDivElement;
  let root: Root;
  let actions: Action[];

  beforeEach(() => {
    localStorage.clear();
    actions = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  async function render() {
    await act(async () => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              config,
              newOpen: true,
              newRuntime: "host",
              newHostDir: "/home/me/repo",
              newPrompt: "make the build faster",
            },
            dispatch: (action) => actions.push(action),
          }}
        >
          <NewSessionModal />
        </Store.Provider>,
      );
    });
  }

  const byText = (label: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent === label) as
      HTMLButtonElement | undefined;

  it("fans the task out to the primary pick plus each added agent", async () => {
    vi.mocked(api.fanout).mockResolvedValue({
      parent: session("p"),
      workers: [session("w1"), session("w2")],
    });
    await render();
    await act(async () => byText("+ Add agent")!.click());
    expect(byText("Start 2 agents")).toBeDefined();
    await act(async () => byText("Start 2 agents")!.click());
    expect(api.createSession).not.toHaveBeenCalled();
    const body = vi.mocked(api.fanout).mock.calls[0]![0];
    expect(body.prompt).toBe("make the build faster");
    expect(body.create.prompt).toBeUndefined();
    expect(body.create.hostDir).toBe("/home/me/repo");
    expect(body.agents).toEqual([
      { providerId: "claude", model: "opus" },
      { providerId: "codex", model: "gpt" },
    ]);
    expect(actions).toContainEqual({ type: "select", id: "p" });
    expect(actions.filter((a) => a.type === "session")).toHaveLength(3);
  });

  it("creates a single worktree agent when the toggle is on", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session("s"));
    await render();
    const toggle = [...document.querySelectorAll("label")]
      .find((l) => l.textContent?.includes("new git worktree"))!
      .querySelector("input")!;
    await act(async () => toggle.click());
    await act(async () => byText("Start chat")!.click());
    expect(api.fanout).not.toHaveBeenCalled();
    expect(vi.mocked(api.createSession).mock.calls[0]![0]).toMatchObject({
      runtime: "host",
      hostDir: "/home/me/repo",
      worktree: true,
      prompt: "make the build faster",
    });
  });

  it("does not request a worktree by default", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session("s"));
    await render();
    await act(async () => byText("Start chat")!.click());
    expect(vi.mocked(api.createSession).mock.calls[0]![0].worktree).toBeUndefined();
  });
});
