import { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, LinkedRepo, LocusConfig, SlackStatus, ToolCall } from "@locus/shared";
import { MobileShell } from "./MobileShell";
import { api } from "@/lib/api";
import { setUiShell } from "@/lib/mobileShell";
import { Store, initialState, reducer, type UiState } from "@/state/store";
import { selectOptionValues, selectValue, setSelectValue } from "@/lib/selectControl";

vi.mock("@/components/settings/Settings", () => ({
  Settings: () => <div data-testid="settings-stub">Settings body</div>,
}));
vi.mock("@/components/automations/NewAutomation", () => ({
  NewAutomationModal: () => <div data-testid="new-automation-stub">New automation modal</div>,
}));
vi.mock("@/components/layout/SessionSwitcher", () => ({
  SessionSwitcher: ({ startOpen }: { startOpen?: boolean }) =>
    startOpen ? <div data-testid="palette-stub">Command palette</div> : null,
}));
vi.mock("@/components/guest/VncPane", () => ({
  VncPane: () => <div data-testid="vnc-stub">VNC</div>,
}));

vi.mock("@/lib/api", () => ({
  api: {
    chat: vi.fn(async () => ({ ok: true })),
    abortChat: vi.fn(async () => ({ ok: true })),
    clearChat: vi.fn(),
    fork: vi.fn(),
    resolveApproval: vi.fn(async () => session({ id: "s1", title: "Nightly" })),
    promote: vi.fn(),
    createSession: vi.fn(),
    saveConfig: vi.fn(async (config: LocusConfig) => config),
    slackStatus: vi.fn(async () => ({ connected: false, socket: "down" })),
    slackActivity: vi.fn(async () => []),
    slackConversations: vi.fn(async () => []),
    slackHistory: vi.fn(async () => []),
    slackReplies: vi.fn(async () => []),
    slackPost: vi.fn(),
    slackMarkRead: vi.fn(async () => []),
    slackEmoji: vi.fn(async () => ({})),
    slackUnwatch: vi.fn(async () => ({ ok: true })),
    slackReact: vi.fn(),
    patchSession: vi.fn(),
    revealWorkspace: vi.fn(async () => ({ path: "/tmp" })),
    canvas: vi.fn(async () => ({
      html: "<html><body><h1>Hero</h1></body></html>",
      path: "index.html",
    })),
    designComment: vi.fn(async () => session({ id: "d1", title: "Landing", kind: "design" })),
    commentPull: vi.fn(),
    reviewPull: vi.fn(),
    mergePull: vi.fn(),
    workspaceTree: vi.fn(async () => ({
      entries: [{ name: "src/app.ts", path: "src/app.ts", type: "file" as const }],
    })),
    workspaceFile: vi.fn(async () => ({
      path: "src/app.ts",
      content: "export const n = 1;\n",
      mtime: "2020-01-01T00:00:00.000Z",
    })),
    repoPulls: vi.fn(async () => [
      {
        repoId: "r1",
        forge: "github",
        number: 12,
        title: "Fix the diff viewer",
        state: "open",
        headRef: "feature/diff",
        baseRef: "main",
        headSha: "abcdef123456",
        url: "https://github.com/acme/app/pull/12",
        author: "damon",
        updatedAt: "2020-01-02T00:00:00.000Z",
      },
    ]),
    repoPull: vi.fn(async () => ({
      repoId: "r1",
      forge: "github",
      number: 12,
      title: "Fix the diff viewer",
      state: "open",
      headRef: "feature/diff",
      baseRef: "main",
      headSha: "abcdef123456",
      url: "https://github.com/acme/app/pull/12",
      author: "damon",
      updatedAt: "2020-01-02T00:00:00.000Z",
      body: "Please **review** the hunk.",
      files: [],
      comments: [
        {
          id: "c1",
          body: "Looks good",
          author: "sam",
          createdAt: "2020-01-02T01:00:00.000Z",
        },
      ],
      commits: [],
      checks: [],
    })),
    repoPullChangeStack: vi.fn(async () => ({
      repoId: "r1",
      number: 12,
      headSha: "abcdef123456",
      generatedAt: "2020-01-02T00:00:00.000Z",
      source: "heuristic",
      cohorts: [
        {
          id: "c1",
          title: "Code",
          summary: "1 file",
          layers: [
            {
              id: "c1-l1",
              title: "Code",
              intent: "consumer",
              fileCount: 1,
              commentCount: 0,
              ranges: [],
            },
          ],
        },
      ],
      files: [{ path: "src/app.ts", cohortId: "c1", layerId: "c1-l1" }],
      markdown: "",
    })),
  },
  browserWsUrl: (id: string) => `ws://browser.test/ws/browser/${id}`,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  addEventListener() {}
  send() {}
  close() {}
}

const config = {
  theme: "ember",
  providers: [
    {
      id: "p",
      name: "local",
      kind: "openai",
      baseUrl: "http://127.0.0.1:9/v1",
      models: ["grok-4"],
      defaultModel: "grok-4",
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
} as LocusConfig;

function call(partial: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "c1",
    name: "git_push",
    arguments: { branch: "feat" },
    startedAt: "t",
    approval: "needed",
    ...partial,
  };
}

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Nightly",
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "p",
    model: "grok-4",
    runtime: "host",
    status: "idle",
    messages: [
      { id: "u1", role: "user", content: "Ship it", createdAt: "2020-01-01T00:00:00.000Z" },
    ],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("MobileShell", () => {
  let host: HTMLDivElement;
  let root: Root;
  const previousWs = globalThis.WebSocket;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    sessionStorage.clear();
    globalThis.WebSocket = previousWs;
    vi.mocked(api.patchSession).mockClear();
    vi.mocked(api.resolveApproval).mockClear();
    vi.mocked(api.promote).mockClear();
  });

  function render(state: Partial<UiState> = {}) {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const start: UiState = {
      ...initialState,
      config,
      connected: true,
      sessions: [session()],
      ...state,
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Shell() {
      const [ui, dispatch] = useReducer(reducer, start);
      return (
        <Store.Provider
          value={{
            state: ui,
            dispatch,
          }}
        >
          <MobileShell
            onShell={(next) => {
              setUiShell(next);
            }}
          />
        </Store.Provider>
      );
    }
    act(() => {
      root.render(<Shell />);
    });
  }

  it("opens a nested read-only subagent thread from the spawn_agent card", () => {
    render({
      sessions: [
        session({
          messages: [
            {
              id: "u1",
              role: "user",
              content: "look around",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "a1",
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "c1",
                  name: "spawn_agent",
                  arguments: { task: "find compact.ts" },
                  startedAt: "2020-01-01T00:00:01.000Z",
                  finishedAt: "2020-01-01T00:00:02.000Z",
                },
              ],
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
          subagents: [
            {
              id: "child-1",
              task: "find compact.ts",
              status: "done",
              toolCallId: "c1",
              lastLine: "It's in src/compact.ts",
              messages: [
                {
                  id: "cu1",
                  role: "user",
                  content: "find compact.ts",
                  createdAt: "2020-01-01T00:00:01.000Z",
                },
                {
                  id: "ca1",
                  role: "assistant",
                  content: "It's in src/compact.ts",
                  createdAt: "2020-01-01T00:00:02.000Z",
                },
              ],
            },
          ],
        }),
      ],
    });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Nightly"),
    );
    act(() => {
      row!.click();
    });
    expect(host.querySelector("textarea")).toBeTruthy();
    const card = host.querySelector("[data-testid='subagent-card']") as HTMLButtonElement;
    expect(card?.textContent).toMatch(/find compact\.ts/);
    act(() => {
      card.click();
    });
    expect(host.querySelector("h1")?.textContent).toBe("find compact.ts");
    expect(host.querySelector("[data-testid='subagent-readonly']")?.textContent).toMatch(
      /read-only/,
    );
    expect(host.querySelector("textarea")).toBeFalsy();
    expect(host.textContent).toMatch(/It's in src\/compact\.ts/);
    const back = host.querySelector(".mobile-back") as HTMLButtonElement;
    act(() => {
      back.click();
    });
    expect(host.querySelector("textarea")?.placeholder).toBe("Add a follow up.");
    expect(host.querySelector("h1")?.textContent).toBe("Nightly");
  });

  it("shows clone counts and that the agent is waiting", () => {
    render({
      cloneProgress: {
        s1: {
          percent: 90,
          phase: "Resolving deltas",
          phasePercent: 97,
          received: 485,
          total: 500,
        },
      },
      sessions: [
        session({
          status: "running",
          messages: [
            {
              id: "s0",
              role: "system",
              content:
                "Cloning https://bitbucket.org/acme/widgets.git into the guest at /workspace",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        }),
      ],
    });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Nightly"),
    );
    act(() => {
      row!.click();
    });
    const card = host.querySelector("[data-testid=clone-progress]");
    expect(card?.textContent).toContain("Resolving deltas 97%");
    expect(card?.textContent).toContain("485/500");
    expect(card?.textContent).toMatch(/waiting for this clone/i);
    expect(host.querySelector("[data-testid=mobile-working]")?.textContent).toMatch(
      /Waiting for the clone/,
    );
  });

  it("shows image build progress and that the agent is waiting", () => {
    render({
      imageProgress: {
        s1: { percent: 30, phase: "RUN apt-get update", step: 2, total: 6 },
      },
      sessions: [
        session({
          status: "running",
          messages: [
            {
              id: "s0",
              role: "system",
              content: "Building locus/agent:0.1 (git, Node, Chromium/Xvfb, ffmpeg, code-server)…",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        }),
      ],
    });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Nightly"),
    );
    act(() => {
      row!.click();
    });
    const card = host.querySelector("[data-testid=image-build-progress]");
    expect(card?.textContent).toContain("30%");
    expect(card?.textContent).toContain("RUN apt-get update");
    expect(host.querySelector("[data-testid=mobile-working]")?.textContent).toMatch(
      /Building the agent image/,
    );
  });

  it("shows an Ollama loading hint while the local model has not started", () => {
    render({
      config: {
        ...config,
        providers: [
          {
            id: "p",
            name: "Ollama",
            kind: "openai-compatible",
            baseUrl: "http://127.0.0.1:11434/v1",
            models: ["llama3.2"],
            defaultModel: "llama3.2",
            enabled: true,
            extraHeaders: {},
          },
        ],
      },
      thinking: {},
      sessions: [
        session({
          status: "running",
          model: "llama3.2",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
            { id: "a1", role: "assistant", content: "", createdAt: "2020-01-01T00:00:01.000Z" },
          ],
        }),
      ],
    });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Nightly"),
    );
    act(() => {
      row!.click();
    });
    expect(host.querySelector("[data-testid=mobile-working]")?.textContent).toMatch(
      /Waiting for Ollama/,
    );
    expect(host.querySelector("[data-testid=mobile-working]")?.textContent).toMatch(
      /loading into memory/i,
    );
  });

  it("lists chats and opens a thread with a thumb-sized composer", async () => {
    render();
    const shell = host.querySelector("[data-testid='mobile-shell']");
    expect(shell).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue("--mobile-vh")).toMatch(/^\d+px$/);
    expect(host.textContent).toContain("Agents");
    expect(host.textContent).toContain("Nightly");
    expect(host.textContent).toContain("Ship it");
    expect(host.querySelector(".mobile-status-dot")).toBeTruthy();
    expect(host.querySelector(".mobile-row-mono")?.textContent).toMatch(/local \/ host/);
    expect(host.querySelector('[aria-label="Search"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="New"]')).toBeTruthy();
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Nightly"),
    );
    expect(row).toBeTruthy();
    act(() => {
      row!.click();
    });
    expect(host.querySelector("textarea")?.placeholder).toBe("Add a follow up.");
    const box = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "Keep going");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Send");
    await act(async () => {
      send!.click();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith("s1", "Keep going", undefined);
    expect(host.querySelector('[data-pending="true"]')?.textContent).toMatch(/Keep going/);
  });

  it("draws a New divider when you reopen a chat with later messages", () => {
    render({
      lastSeenMessageIds: { s1: "u1" },
      sessions: [
        session({
          messages: [
            { id: "u1", role: "user", content: "Ship it", createdAt: "2020-01-01T00:00:00.000Z" },
            {
              id: "a1",
              role: "assistant",
              content: "On it",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        }),
      ],
    });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Nightly"),
    );
    act(() => {
      row!.click();
    });
    const divider = host.querySelector("[data-testid='chat-new-divider']");
    expect(divider?.textContent).toBe("New");
    expect(host.querySelector(".mobile-msg.user")?.textContent).toMatch(/Ship it/);
    expect(host.querySelector(".mobile-msg.assistant")?.textContent).toMatch(/On it/);
  });

  it("scrolls a long thread to the last message when you open the chat", async () => {
    render({
      sessions: [
        session({
          messages: [
            { id: "u1", role: "user", content: "first", createdAt: "2020-01-01T00:00:00.000Z" },
            {
              id: "a1",
              role: "assistant",
              content: "older reply",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
            {
              id: "u2",
              role: "user",
              content: "latest question",
              createdAt: "2020-01-01T00:00:02.000Z",
            },
            {
              id: "a2",
              role: "assistant",
              content: "the last thing that happened",
              createdAt: "2020-01-01T00:00:03.000Z",
            },
          ],
        }),
      ],
    });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Nightly"),
    );
    act(() => {
      row!.click();
    });
    const pane = host.querySelector(".mobile-thread") as HTMLDivElement;
    expect(pane).toBeTruthy();
    let top = 0;
    Object.defineProperty(pane, "scrollHeight", { configurable: true, get: () => 2400 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, get: () => 400 });
    Object.defineProperty(pane, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    const diff = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Diff");
    const chat = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Chat");
    act(() => {
      diff!.click();
    });
    act(() => {
      chat!.click();
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
    expect(top).toBe(2400);
    expect(host.textContent).toContain("the last thing that happened");
  });

  it("marks a gated agent with a status dot and waiting meta", () => {
    render({
      sessions: [
        session({
          id: "s2",
          title: "HTML report with diagrams",
          needsHuman: "Protected branch",
          runtime: "docker",
          repo: { forge: "github", url: "https://github.com/acme/widgets.git" },
        }),
      ],
    });
    expect(host.textContent).toContain("WAITING ON YOU");
    expect(host.querySelector(".mobile-status-dot.is-needs")).toBeTruthy();
    expect(host.querySelector(".mobile-row-mono")?.textContent).toMatch(/widgets \/ docker/);
    act(() => {
      host.querySelector<HTMLButtonElement>('[aria-label="Search"]')!.click();
    });
    expect(host.querySelector('input[type="search"]')).toBeTruthy();
  });

  it("dismisses the needs-you banner from the thread", async () => {
    const gated = session({
      id: "s2",
      title: "HTML report with diagrams",
      needsHuman: "Protected branch",
    });
    vi.mocked(api.patchSession).mockResolvedValue({ ...gated, needsHuman: undefined });
    render({ sessions: [gated] });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("HTML report"),
    );
    act(() => {
      row!.click();
    });
    expect(host.querySelector(".needs-you-banner")?.textContent).toMatch(/Protected branch/);
    const dismiss = host.querySelector(".needs-you-banner button") as HTMLButtonElement;
    expect(dismiss?.textContent).toMatch(/Dismiss/);
    await act(async () => {
      dismiss.click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s2", { needsHuman: null });
    expect(host.querySelector(".needs-you-banner")).toBeNull();
  });

  it("renders markdown tables inside the phone thread bubble", () => {
    const report = session({
      title: "HTML report",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content:
            "| Source | Result |\n| --- | --- |\n| Grafana | No matching dashboards; log queries need different fields |\n\nRyan also attached 2026-08-27_app_tables_prod.csv with a long explanation that must wrap on a phone.",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });
    render({ sessions: [report] });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("HTML report"),
    );
    act(() => {
      row!.click();
    });
    const bubble = host.querySelector(".mobile-bubble");
    expect(host.querySelector("[data-testid='mobile-fit']")).toBeTruthy();
    expect(bubble?.querySelector("table.md-table")).toBeTruthy();
    expect(bubble?.textContent).toMatch(/Grafana/);
    expect(bubble?.textContent).toMatch(/Ryan also attached/);
    expect(host.querySelector(".mobile-msg:not(.user)")).toBeTruthy();
    expect(host.querySelector("[data-testid='mobile-chat-tabs']")?.textContent).toMatch(/Chat/);
    expect(host.querySelector("[data-testid='mobile-chat-tabs']")?.textContent).toMatch(/Diff/);
    expect(host.querySelector("[data-testid='mobile-chat-tabs']")?.textContent).toMatch(/Files/);
    expect(host.querySelector(".mobile-model-pill")?.textContent).toBe("grok-4");
  });

  it("shows a thought fold on an assistant reply in the phone thread", () => {
    const report = session({
      title: "HTML report",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "Updated the page.",
          thinking: "Keep the hero tight.",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });
    render({ sessions: [report] });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("HTML report"),
    );
    act(() => {
      row!.click();
    });
    const fold = host.querySelector("[data-testid='thinking-trace']") as HTMLDetailsElement | null;
    expect(fold?.textContent).toContain("Thought");
    expect(fold?.textContent).toContain("Keep the hero tight.");
    expect(fold?.open).toBe(false);
  });

  it("hides thought traces on a Swarm teammate in the phone thread", () => {
    const mate = session({
      title: "Nova",
      surface: "swarm",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "I'll gather the sources.",
          thinking: "Search INDEX.md then summarize.",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });
    render({
      sessions: [mate],
    });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Nova"),
    );
    act(() => {
      row!.click();
    });
    expect(host.querySelector("[data-testid='thinking-trace']")).toBeNull();
    expect(host.textContent).toContain("I'll gather the sources.");
    expect(host.textContent).not.toContain("Search INDEX.md then summarize.");
  });

  it("shows phone tool activity as an operator-facing action and detail", () => {
    const report = session({
      title: "Repo exploration",
      status: "running",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "",
          createdAt: "2020-01-01T00:00:01.000Z",
          toolCalls: [
            {
              id: "c1",
              name: "file_read",
              arguments: { path: "/home/locus/.locus/host-workspaces/ee26bc7e/src/app.ts" },
              result: "ok",
              startedAt: "2020-01-01T00:00:01.000Z",
              finishedAt: "2020-01-01T00:00:02.000Z",
            },
          ],
        },
      ],
    });
    render({
      thinking: { [report.id]: "Gain constants for layout IDs." },
      sessions: [report],
    });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Repo exploration"),
    );
    act(() => {
      row!.click();
    });
    expect(host.querySelector(".mobile-tool-name")?.textContent).toBe("Read");
    expect(host.querySelector(".mobile-tool-detail")?.textContent).toBe("app.ts");
    expect(host.querySelector(".mobile-tool-status")?.textContent).toBe("Completed");
    const working = host.querySelector("[data-testid=mobile-working]");
    expect(working?.querySelector(".mobile-working-label")?.textContent).toBe("Thinking");
    expect(working?.querySelector(".mobile-working-copy")?.textContent).toMatch(/layout IDs/);
  });

  it("renders apply_patch as an inline diff card and on the Diff tab", () => {
    const patch = [
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,1 +1,2 @@",
      " keep()",
      "-old",
      "+expect(await loadWorkspaceMemories(dir)).toMatchObject({ ready: true, items: [] })",
    ].join("\n");
    const report = session({
      title: "Repo exploration",
      messages: [
        {
          id: "u1",
          role: "user",
          content: "Explore the workspace memories.",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          content: "Updated the memory loader test.",
          createdAt: "2020-01-01T00:00:01.000Z",
          toolCalls: [
            {
              id: "c1",
              name: "apply_patch",
              arguments: { patch },
              result: "updated src/app.ts",
              startedAt: "2020-01-01T00:00:01.000Z",
              finishedAt: "2020-01-01T00:00:02.000Z",
            },
            {
              id: "c2",
              name: "exec",
              arguments: { command: "npm test" },
              result: "ok",
              startedAt: "2020-01-01T00:00:02.000Z",
              finishedAt: "2020-01-01T00:00:03.000Z",
            },
          ],
        },
      ],
    });
    render({ sessions: [report] });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Repo exploration"),
    );
    act(() => {
      row!.click();
    });
    const card = host.querySelector("[data-testid='patch-card']");
    expect(card).toBeTruthy();
    expect(card?.querySelector(".patch-path-name")?.textContent).toBe("app.ts");
    expect(card?.querySelector(".patch-file")?.classList.contains("collapsed")).toBe(true);
    act(() => {
      (card?.querySelector(".patch-file-toggle") as HTMLButtonElement).click();
    });
    expect(host.querySelector(".patch-line.add")?.textContent).toMatch(/loadWorkspaceMemories/);
    expect(host.querySelector(".mobile-tool-name")?.textContent).toBe("Ran");
    expect(host.querySelector(".mobile-tool-detail")?.textContent).toMatch(/npm test/);
    const diffTab = [...host.querySelectorAll<HTMLButtonElement>(".mobile-chat-tab")].find(
      (btn) => btn.textContent === "Diff",
    );
    act(() => {
      diffTab!.click();
    });
    expect(diffTab?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector(".mobile-bubble")).toBeNull();
    expect(
      host.querySelector("[data-testid='patch-card']")?.querySelector(".patch-path-name")
        ?.textContent,
    ).toBe("app.ts");
    const chatTab = [...host.querySelectorAll<HTMLButtonElement>(".mobile-chat-tab")].find(
      (btn) => btn.textContent === "Chat",
    );
    act(() => {
      chatTab!.click();
    });
    expect(host.querySelector(".mobile-msg.assistant .mobile-bubble")?.textContent).toMatch(
      /memory loader/,
    );
  });

  it("groups repeated Codex CLI shell steps and unwraps the PowerShell launcher", () => {
    const report = session({
      title: "CLI task",
      status: "idle",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "",
          createdAt: "2020-01-01T00:00:00.000Z",
          toolCalls: Array.from({ length: 5 }, (_, index) => ({
            id: `c${index}`,
            name: "exec",
            arguments: {
              command:
                'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -Command "Get-ChildItem -LiteralPath src"',
            },
            result: "ok",
            startedAt: "2020-01-01T00:00:00.000Z",
            finishedAt: "2020-01-01T00:00:01.000Z",
          })),
        },
      ],
    });
    render({ sessions: [report] });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("CLI task"),
    );
    act(() => {
      row!.click();
    });
    const group = host.querySelector("[data-testid='mobile-tool-group']");
    expect(group?.textContent).toContain("Explored 5 files");
    expect(group?.textContent).not.toContain("5 steps");
    expect(group?.querySelectorAll("[data-testid='mobile-tool']").length).toBe(5);
  });

  it("does not mark a phone exploration group Failed when only one call failed", () => {
    const report = session({
      title: "Partial fail",
      status: "idle",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "",
          createdAt: "2020-01-01T00:00:00.000Z",
          toolCalls: [
            {
              id: "c1",
              name: "file_read",
              arguments: { path: "/workspace/src/a.ts" },
              result: "ok",
              startedAt: "2020-01-01T00:00:00.000Z",
              finishedAt: "2020-01-01T00:00:01.000Z",
            },
            {
              id: "c2",
              name: "file_read",
              arguments: { path: "/workspace/src/b.ts" },
              result: "ok",
              startedAt: "2020-01-01T00:00:01.000Z",
              finishedAt: "2020-01-01T00:00:02.000Z",
            },
            {
              id: "c3",
              name: "grep",
              arguments: { pattern: "TODO" },
              error: "no matches",
              startedAt: "2020-01-01T00:00:02.000Z",
              finishedAt: "2020-01-01T00:00:03.000Z",
            },
            {
              id: "c4",
              name: "exec",
              arguments: { command: "ls" },
              result: "ok",
              startedAt: "2020-01-01T00:00:03.000Z",
              finishedAt: "2020-01-01T00:00:04.000Z",
            },
          ],
        },
      ],
    });
    render({ sessions: [report] });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Partial fail"),
    );
    act(() => {
      row!.click();
    });
    const group = host.querySelector("[data-testid='mobile-tool-group']");
    const groupStatus = group?.querySelector(":scope > summary .mobile-tool-status");
    expect(group?.textContent).toContain("Explored 2 files, 1 search, ran 1 command");
    expect(groupStatus?.textContent).toBe("Completed");
    const inner = [...group!.querySelectorAll("[data-testid='mobile-tool']")];
    expect(inner.map((el) => el.querySelector(".mobile-tool-status")?.textContent)).toEqual([
      "Completed",
      "Completed",
      "Failed",
      "Completed",
    ]);
  });

  it("folds a long Codex CLI shell batch into one exploring summary", () => {
    const report = session({
      title: "Long CLI task",
      status: "idle",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "",
          createdAt: "2020-01-01T00:00:00.000Z",
          toolCalls: Array.from({ length: 20 }, (_, index) => ({
            id: `c${index}`,
            name: "exec",
            arguments: {
              command:
                'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -Command "Get-ChildItem -LiteralPath src"',
            },
            result: "ok",
            startedAt: "2020-01-01T00:00:00.000Z",
            finishedAt: "2020-01-01T00:00:01.000Z",
          })),
        },
      ],
    });
    render({ sessions: [report] });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Long CLI task"),
    );
    act(() => {
      row!.click();
    });
    const groups = [...host.querySelectorAll("[data-testid='mobile-tool-group']")];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.textContent).toContain("Explored 20 files");
    expect(groups[0]?.textContent).not.toMatch(/\d+ steps/);
    expect(host.querySelectorAll("[data-testid='mobile-tool']").length).toBe(20);
  });

  it("opens the last followed workspace file on the Files tab", async () => {
    const report = session({
      title: "Repo exploration",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "Updated app.ts",
          createdAt: "2020-01-01T00:00:01.000Z",
          toolCalls: [
            {
              id: "c1",
              name: "file_write",
              arguments: {
                path: "/home/locus/.locus/host-workspaces/ee26bc7e/src/app.ts",
                content: "x",
              },
              result: "ok",
              startedAt: "2020-01-01T00:00:01.000Z",
              finishedAt: "2020-01-01T00:00:02.000Z",
            },
          ],
        },
      ],
    });
    render({ sessions: [report] });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Repo exploration"),
    );
    act(() => {
      row!.click();
    });
    const filesTab = [...host.querySelectorAll<HTMLButtonElement>(".mobile-chat-tab")].find(
      (btn) => btn.textContent === "Files",
    );
    await act(async () => {
      filesTab!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='mobile-files']")).toBeTruthy();
    expect(api.workspaceTree).toHaveBeenCalledWith(report.id);
    expect(api.workspaceFile).toHaveBeenCalledWith(report.id, "src/app.ts");
    expect(host.querySelector(".mobile-file-body")?.textContent).toMatch(/export const n/);
  });

  it("surfaces pending approvals on Needs you with Approve / Deny", async () => {
    const waiting = session({
      status: "running",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "",
          createdAt: "t",
          toolCalls: [call()],
        },
      ],
    });
    render({ sessions: [waiting] });
    const inbox = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Needs you"),
    );
    act(() => {
      inbox!.click();
    });
    expect(host.textContent).toContain("git_push");
    expect(host.querySelector("[data-testid='mobile-inbox-batch']")).toBeNull();
    expect(
      [...host.querySelectorAll("button")].some((btn) => btn.textContent === "Approve all"),
    ).toBe(false);
    const approve = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Approve",
    );
    await act(async () => {
      approve!.click();
      await Promise.resolve();
    });
    expect(api.resolveApproval).toHaveBeenCalledWith("s1", "c1", "approved");
  });

  it("approves every tool wait from Needs you without opening chats", async () => {
    const waiting = session({
      status: "running",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "",
          createdAt: "t",
          toolCalls: [call(), call({ id: "c2", name: "git_pr" })],
        },
      ],
    });
    const other = session({
      id: "s2",
      title: "Second",
      status: "running",
      messages: [
        {
          id: "a2",
          role: "assistant",
          content: "",
          createdAt: "t",
          toolCalls: [call({ id: "c3", name: "git_push" })],
        },
      ],
    });
    vi.mocked(api.resolveApproval).mockImplementation(async (id) =>
      session({ id, title: id === "s2" ? "Second" : "Nightly" }),
    );
    render({ sessions: [waiting, other] });
    const inbox = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Needs you"),
    );
    act(() => {
      inbox!.click();
    });
    expect(host.querySelector("[data-testid='mobile-inbox-batch']")).toBeTruthy();
    expect(host.textContent).toMatch(/3 tool approvals across 2 chats/);
    const approveAll = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Approve all",
    );
    await act(async () => {
      approveAll!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.resolveApproval).toHaveBeenCalledTimes(3);
    expect(api.resolveApproval).toHaveBeenNthCalledWith(1, "s1", "c1", "approved");
    expect(api.resolveApproval).toHaveBeenNthCalledWith(2, "s1", "c2", "approved");
    expect(api.resolveApproval).toHaveBeenNthCalledWith(3, "s2", "c3", "approved");
  });

  it("denies every tool wait from Needs you and skips ask_user", async () => {
    const waiting = session({
      status: "running",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "",
          createdAt: "t",
          toolCalls: [
            call(),
            call({
              id: "c2",
              name: "ask_user",
              arguments: { question: "Ship it?", choices: ["Yes"] },
            }),
            call({ id: "c3", name: "git_pr" }),
          ],
        },
      ],
    });
    vi.mocked(api.resolveApproval).mockResolvedValue(session({ id: "s1", title: "Nightly" }));
    render({ sessions: [waiting] });
    const inbox = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Needs you"),
    );
    act(() => {
      inbox!.click();
    });
    expect(host.textContent).toMatch(/2 tool approvals/);
    expect(host.textContent).toContain("Ship it?");
    const denyAll = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Deny all",
    );
    await act(async () => {
      denyAll!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.resolveApproval).toHaveBeenCalledTimes(2);
    expect(api.resolveApproval).toHaveBeenNthCalledWith(1, "s1", "c1", "denied");
    expect(api.resolveApproval).toHaveBeenNthCalledWith(2, "s1", "c3", "denied");
  });

  it("dismisses a human gate from Needs you without opening the chat", async () => {
    const gated = session({
      id: "s2",
      title: "HTML report",
      needsHuman: "Protected branch main",
    });
    vi.mocked(api.patchSession).mockResolvedValue({ ...gated, needsHuman: undefined });
    render({ sessions: [gated] });
    const inbox = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Needs you"),
    );
    expect(inbox?.querySelector(".mobile-tab-dot")).toBeTruthy();
    act(() => {
      inbox!.click();
    });
    expect(host.textContent).toContain("Protected branch main");
    expect(host.querySelector("[data-testid='mobile-inbox-batch']")).toBeNull();
    const dismiss = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Dismiss",
    );
    await act(async () => {
      dismiss!.click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s2", { needsHuman: null });
    expect(host.querySelector("h1")?.textContent).toBe("Needs you");
  });

  it("lists Design comment and PR review shortcuts on Needs you", async () => {
    render({
      sessions: [session(), session({ id: "d1", title: "Landing", kind: "design" })],
      repos: [
        {
          id: "r1",
          name: "acme/app",
          checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
          openPullCount: 1,
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });
    const inbox = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Needs you"),
    );
    act(() => {
      inbox!.click();
    });
    expect(host.textContent).toMatch(/Comment on a canvas/);
    expect(host.textContent).toContain("Landing");
    const canvasRow = [...host.querySelectorAll<HTMLButtonElement>(".mobile-row")].find((btn) =>
      btn.textContent?.includes("Landing"),
    );
    expect(canvasRow?.querySelector(".mobile-avatar")).toBeNull();
    expect(canvasRow?.querySelector(".mobile-row-main")).toBeTruthy();
    expect(canvasRow?.textContent).toMatch(/Pin an element, then send a change/);
    expect(host.textContent).toMatch(/Review a pull/);
    expect(host.textContent).toContain("acme/app");
    const canvas = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Landing"),
    );
    act(() => {
      canvas!.click();
    });
    expect(host.querySelector("[data-testid='mobile-canvas']")).toBeTruthy();
    expect(
      [...host.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Comment")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("returns to Needs you after a Review a pull shortcut", async () => {
    render({
      sessions: [session(), session({ id: "d1", title: "Landing", kind: "design" })],
      repos: [
        {
          id: "r1",
          name: "acme/app",
          checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
          openPullCount: 1,
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });
    const inbox = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Needs you"),
    );
    act(() => {
      inbox!.click();
    });
    const repo = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("acme/app"),
    );
    await act(async () => {
      repo!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='mobile-pulls']")).toBeTruthy();
    expect(host.textContent).toContain("Fix the diff viewer");
    act(() => {
      host.querySelector<HTMLButtonElement>(".mobile-back")!.click();
    });
    expect(host.querySelector("h1")?.textContent).toBe("Needs you");
    expect(host.textContent).toMatch(/Comment on a canvas/);
    expect(host.textContent).toMatch(/Review a pull/);
  });

  it("badges Needs you from approvals only", () => {
    render({
      sessions: [session(), session({ id: "d1", title: "Landing", kind: "design" })],
      repos: [
        {
          id: "r1",
          name: "acme/app",
          checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
          openPullCount: 1,
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });
    const inbox = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Needs you"),
    );
    expect(inbox?.querySelector(".mobile-badge")).toBeNull();
    expect(inbox?.querySelector(".mobile-tab-dot")).toBeNull();
  });

  it("asks for an answer on ask_user instead of a bare Approve", async () => {
    const waiting = session({
      status: "running",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "",
          createdAt: "t",
          toolCalls: [
            call({
              name: "ask_user",
              arguments: { question: "Ship it?", choices: ["Yes", "No"] },
            }),
          ],
        },
      ],
    });
    render({ sessions: [waiting] });
    const inbox = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Needs you"),
    );
    act(() => {
      inbox!.click();
    });
    expect(host.textContent).toContain("Ship it?");
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Approve")).toBe(
      false,
    );
    const yes = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Yes");
    await act(async () => {
      yes!.click();
      await Promise.resolve();
    });
    expect(api.resolveApproval).toHaveBeenCalledWith("s1", "c1", "approved", "Yes");
  });

  it("unwraps nested ask_user JSON on the phone approval card", async () => {
    const waiting = session({
      status: "running",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "",
          createdAt: "t",
          toolCalls: [
            call({
              name: "ask_user",
              arguments: {
                ask_user: JSON.stringify({
                  question: "A few details",
                  questions: [
                    { question: "What is Harbor?", choices: ["A product I'm building"] },
                    { question: "Tone?", choices: ["Bold and minimal"] },
                  ],
                }),
              },
            }),
          ],
        },
      ],
    });
    render({ sessions: [waiting] });
    const inbox = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Needs you"),
    );
    act(() => {
      inbox!.click();
    });
    expect(host.textContent).toContain("What is Harbor?");
    expect(host.textContent).toContain("A product I'm building");
    expect(host.textContent).not.toContain('\\"question\\"');
  });

  it("can switch back to the desktop layout", () => {
    render();
    const more = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("More"),
    );
    act(() => {
      more!.click();
    });
    expect(
      [...host.querySelectorAll(".mobile-tags:not(.is-muted) li")].map((el) => el.textContent),
    ).toContain("Promote");
    expect(
      [...host.querySelectorAll(".mobile-tags.is-muted li")].map((el) => el.textContent),
    ).toEqual(["Live VNC control still needs the desktop."]);
    expect(host.textContent).toContain("Settings");
    expect(host.textContent).toContain("New job");
    expect(host.textContent).toContain("Command palette");
    const desktop = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Desktop",
    );
    act(() => {
      desktop!.click();
    });
    expect(sessionStorage.getItem("locus.shell")).toBe("desktop");
  });

  it("lets phone More toggle notification prefs", () => {
    render();
    const more = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("More"),
    );
    act(() => {
      more!.click();
    });
    const row = [...host.querySelectorAll(".mobile-setting-row")].find((el) =>
      el.textContent?.includes("Needs you"),
    );
    expect(row?.textContent).toMatch(/Needs you/);
    expect(host.querySelector("[data-testid='mobile-notify-needs-you']")).toBeTruthy();
    expect(host.querySelector("[data-testid='mobile-pairing']")?.textContent).toMatch(/desktop/i);
    expect(selectValue(host, "Chat density")).toBe("compact");
    expect(selectOptionValues(host, "Chat density")).toEqual(["comfortable", "compact", "dense"]);
  });

  it("points Slack sign-in at the desktop", async () => {
    render({ slackStatus: { connected: false, socket: "down" } });
    const slack = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Slack"),
    );
    await act(async () => {
      slack!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Sign in as yourself");
    expect(host.textContent).toContain("Settings → Integrations");
  });

  it("opens a Slack channel and sends as you", async () => {
    const status: SlackStatus = {
      connected: true,
      teamId: "T_MOCK",
      teamName: "Locus Dev",
      userId: "U_YOU",
      userName: "you",
      socket: "down",
    };
    vi.mocked(api.slackStatus).mockResolvedValue(status);
    vi.mocked(api.slackConversations).mockResolvedValue([
      { id: "C_ENG", name: "eng", kind: "channel", topic: "Shipping" },
    ]);
    vi.mocked(api.slackHistory).mockResolvedValue([
      {
        ts: "1710000001.0",
        channelId: "C_ENG",
        userId: "U_ALICE",
        userName: "alice",
        text: "can you look at checkout?",
      },
    ]);
    vi.mocked(api.slackPost).mockResolvedValue({
      ts: "1710000009.0",
      channelId: "C_ENG",
      userId: "U_YOU",
      userName: "you",
      text: "On it",
    });
    render({
      slackStatus: status,
      slackConversations: [{ id: "C_ENG", name: "eng", kind: "channel", topic: "Shipping" }],
    });
    const slack = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Slack"),
    );
    await act(async () => {
      slack!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("#eng");
    const row = [...host.querySelectorAll<HTMLButtonElement>(".mobile-row")].find((btn) =>
      btn.textContent?.includes("#eng"),
    );
    await act(async () => {
      row!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='mobile-slack-chat']")).toBeTruthy();
    expect(host.textContent).toContain("can you look at checkout?");
    const box = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(box.placeholder).toContain("Message");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "On it");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Send");
    await act(async () => {
      send!.click();
      await Promise.resolve();
    });
    expect(api.slackPost).toHaveBeenCalledWith("C_ENG", "On it", undefined, undefined, "user");
  });

  it("lists Slack Activity above channels on the phone", async () => {
    const status: SlackStatus = {
      connected: true,
      teamId: "T_MOCK",
      teamName: "Locus Dev",
      userId: "U_YOU",
      userName: "you",
      socket: "down",
    };
    vi.mocked(api.slackStatus).mockResolvedValue(status);
    vi.mocked(api.slackConversations).mockResolvedValue([
      { id: "C_ENG", name: "eng", kind: "channel", topic: "Shipping" },
    ]);
    render({
      slackStatus: status,
      slackConversations: [{ id: "C_ENG", name: "eng", kind: "channel", topic: "Shipping" }],
      slackActivityUnseen: true,
      slackActivity: [
        {
          id: "C_ENG:1.0",
          kind: "mention",
          channelId: "C_ENG",
          channelName: "eng",
          ts: "1.0",
          text: "hey <@U_YOU> look at checkout",
          userName: "alice",
        },
      ],
    });
    const slack = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Slack"),
    );
    expect(slack?.querySelector(".mobile-tab-dot")).toBeTruthy();
    await act(async () => {
      slack!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("alice mentioned you in #eng");
    expect(host.textContent).toContain("hey @you look at checkout");
    expect(slack?.querySelector(".mobile-tab-dot")).toBeNull();
    const mention = [...host.querySelectorAll<HTMLButtonElement>(".mobile-row")].find((btn) =>
      btn.textContent?.includes("mentioned you"),
    );
    await act(async () => {
      mention!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='mobile-slack-chat']")).toBeTruthy();
  });

  it("shows Send as You / Locus pills with the mascot", async () => {
    const status: SlackStatus = {
      connected: true,
      teamId: "T_MOCK",
      teamName: "Locus Dev",
      userId: "U_YOU",
      userName: "you",
      socket: "down",
      canPostAsBot: true,
    };
    vi.mocked(api.slackStatus).mockResolvedValue(status);
    vi.mocked(api.slackConversations).mockResolvedValue([
      { id: "C_SHIP", name: "shipyard", kind: "channel" },
    ]);
    vi.mocked(api.slackHistory).mockResolvedValue([
      {
        ts: "1710000001.0",
        channelId: "C_SHIP",
        userId: "U_RUAN",
        userName: "Ruan",
        text: "Unstoppable now",
      },
    ]);
    render({
      slackStatus: status,
      slackConversations: [{ id: "C_SHIP", name: "shipyard", kind: "private" }],
    });
    const slack = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Slack"),
    );
    await act(async () => {
      slack!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const row = [...host.querySelectorAll<HTMLButtonElement>(".mobile-row")].find((btn) =>
      btn.textContent?.includes("shipyard"),
    );
    await act(async () => {
      row!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const bar = host.querySelector(".mobile-send-as");
    expect(host.querySelector(".mobile-composer.is-slack .mobile-send-as")).toBe(bar);
    expect(host.querySelector(".mobile-composer-bar .mobile-input")).toBeTruthy();
    expect(bar?.textContent).toMatch(/Send as/);
    expect(bar?.textContent).toMatch(/You/);
    expect(bar?.textContent).toMatch(/Locus/);
    expect(bar?.querySelector("[data-testid='locus-mascot']")).toBeTruthy();
    expect(bar?.querySelector("[data-testid='slack-post-as']")?.textContent).toMatch(/Locus/);
    const you = [...bar!.querySelectorAll("button")].find((btn) => btn.textContent === "You");
    expect(you?.className).toMatch(/\bon\b/);
    expect(host.querySelector(".mobile-send")?.innerHTML).toMatch(/M12 19V5/);
  });

  it("lists and opens a Slack DM", async () => {
    const status: SlackStatus = {
      connected: true,
      teamId: "T_MOCK",
      teamName: "Locus Dev",
      userId: "U_YOU",
      userName: "you",
      socket: "down",
    };
    vi.mocked(api.slackStatus).mockResolvedValue(status);
    vi.mocked(api.slackConversations).mockResolvedValue([
      { id: "C_ENG", name: "eng", kind: "channel" },
      {
        id: "D_BOB",
        name: "bob",
        kind: "im",
        userId: "U_BOB",
        avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_BOB.png",
      },
    ]);
    vi.mocked(api.slackHistory).mockImplementation(async (id: string) =>
      id === "D_BOB"
        ? [
            {
              ts: "1710000200.0",
              channelId: "D_BOB",
              userId: "U_BOB",
              userName: "bob",
              text: "got a minute?",
            },
          ]
        : [],
    );
    render({
      slackStatus: status,
      slackConversations: [
        { id: "C_ENG", name: "eng", kind: "channel" },
        {
          id: "D_BOB",
          name: "bob",
          kind: "im",
          userId: "U_BOB",
          avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_BOB.png",
        },
      ],
    });
    const slack = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Slack"),
    );
    await act(async () => {
      slack!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Channels");
    expect(host.textContent).toContain("@bob");
    const row = [...host.querySelectorAll<HTMLButtonElement>(".mobile-row")].find((btn) =>
      btn.textContent?.includes("@bob"),
    );
    await act(async () => {
      row!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='mobile-slack-chat']")).toBeTruthy();
    expect(host.querySelector("h1")?.textContent).toContain("@bob");
    expect(host.textContent).toContain("got a minute?");
    expect(api.slackHistory).toHaveBeenCalledWith("D_BOB");
  });

  it("opens Docker Chromium from a chat and allows takeover", async () => {
    render({
      sessions: [session({ id: "s1", title: "Nightly", runtime: "docker" })],
    });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Nightly"),
    );
    act(() => {
      row!.click();
    });
    const watch = host.querySelector<HTMLButtonElement>('[aria-label="Open browser"]');
    expect(watch).toBeTruthy();
    act(() => {
      watch!.click();
    });
    expect(host.querySelector("[data-testid='mobile-browser']")).toBeTruthy();
    expect(host.textContent).toMatch(/Take over browser/);
    expect(
      [...host.querySelectorAll("button")].some((btn) => btn.textContent?.includes("Take over")),
    ).toBe(true);
    expect(host.textContent).not.toMatch(/Takeover stays on the desktop/);
    act(() => {
      host.querySelector<HTMLButtonElement>(".mobile-back")!.click();
    });
    expect(host.querySelector("[data-testid='mobile-browser']")).toBeNull();
    expect(host.querySelector(".mobile-composer")).toBeTruthy();
  });

  it("does not offer Browser watch on a host chat", () => {
    render({ sessions: [session({ runtime: "host" })] });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Nightly"),
    );
    act(() => {
      row!.click();
    });
    expect(host.querySelector('[aria-label="Open browser"]')).toBeNull();
  });

  it("opens a Games canvas from More and after New game", async () => {
    const created = session({ id: "g2", title: "Fresh Loop", kind: "game", runtime: "docker" });
    vi.mocked(api.createSession).mockResolvedValue(created);
    render({
      sessions: [
        session(),
        session({ id: "g1", title: "Ember Run", kind: "game", runtime: "docker" }),
      ],
      canvasHtml: {
        g1: "<html><body><canvas></canvas></body></html>",
        g2: "<html><body><canvas></canvas></body></html>",
      },
    });
    const more = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("More"),
    );
    act(() => {
      more!.click();
    });
    expect(host.querySelector("[data-testid='mobile-games']")).toBeTruthy();
    expect(host.querySelector("[data-testid='mobile-assets']")).toBeTruthy();
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Ember Run"),
    );
    act(() => {
      row!.click();
    });
    expect(host.querySelector("[data-testid='mobile-canvas']")).toBeTruthy();
    expect(host.textContent).toMatch(/Playtest/);
    act(() => {
      host.querySelector<HTMLButtonElement>(".mobile-back")!.click();
    });
    const neu = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("New game"),
    );
    act(() => {
      neu!.click();
    });
    const start = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Start");
    await act(async () => {
      start!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(expect.objectContaining({ kind: "game" }));
    expect(host.querySelector("[data-testid='mobile-canvas']")).toBeTruthy();
    expect(host.textContent).toContain("Fresh Loop");
  });

  it("opens a Design canvas with Comment and an instruction composer", async () => {
    render({
      sessions: [
        session(),
        session({ id: "d1", title: "Landing", kind: "design", runtime: "docker" }),
      ],
      canvasHtml: { d1: "<html><body><h1>Hero</h1></body></html>" },
    });
    expect(host.textContent).not.toContain("Landing");
    const design = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Design"),
    );
    act(() => {
      design!.click();
    });
    expect(host.querySelector("[data-testid='mobile-design']")).toBeTruthy();
    expect(host.textContent).toContain("Landing");
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Landing"),
    );
    act(() => {
      row!.click();
    });
    expect(host.querySelector("[data-testid='mobile-canvas']")).toBeTruthy();
    expect(host.querySelector("iframe[title='Canvas preview']")).toBeTruthy();
    expect(host.textContent).toMatch(/Comment/);
    expect(host.querySelector('textarea[aria-label="Canvas instruction"]')).toBeTruthy();
    expect(host.querySelector("[data-testid='mobile-promote']")).toBeTruthy();
    expect(host.textContent).toMatch(/Promote/);
    const comment = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Comment",
    );
    act(() => {
      comment!.click();
    });
    expect(comment?.getAttribute("aria-pressed")).toBe("true");
    const frame = host.querySelector("iframe") as HTMLIFrameElement;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "locus-design-pick", tag: "h1", text: "Hero", id: "", className: "hero" },
          source: frame.contentWindow,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.designComment).toHaveBeenCalledWith("d1", {
      selector: "h1.hero",
      text: "Hero",
      viewport: "phone",
    });
    expect(comment?.getAttribute("aria-pressed")).toBe("false");
    expect(host.textContent).toMatch(/Pinned h1\.hero/);
    const box = host.querySelector(
      'textarea[aria-label="Canvas instruction"]',
    ) as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "Make the hero tighter");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Send");
    await act(async () => {
      send!.click();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith("d1", "Make the hero tighter", undefined);
  });

  it("promotes a Design canvas into an agent from the phone", async () => {
    const design = session({ id: "d1", title: "Landing", kind: "design", runtime: "docker" });
    const agent = session({ id: "a1", title: "Landing app", runtime: "docker" });
    vi.mocked(api.promote).mockResolvedValue({
      agent,
      design: { ...design, promotedAgentId: "a1" },
    });
    render({
      sessions: [session(), design],
      canvasHtml: { d1: "<html><body><h1>Hero</h1></body></html>" },
    });
    const tab = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Design"),
    );
    act(() => {
      tab!.click();
    });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Landing"),
    );
    act(() => {
      row!.click();
    });
    expect(selectValue(host, "Promote scaffold")).toBe("vite-react");
    act(() => {
      setSelectValue(host, "Promote scaffold", "next");
    });
    const promote = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Promote",
    );
    await act(async () => {
      promote!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.promote).toHaveBeenCalledWith("d1", { scaffold: "next" });
    expect(host.querySelector("[data-testid='mobile-canvas']")).toBeTruthy();
    const openAgent = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Open agent",
    );
    expect(openAgent).toBeTruthy();
    act(() => {
      openAgent!.click();
    });
    expect(host.querySelector("h1")?.textContent).toBe("Landing app");
  });

  it("steers a running Design canvas instead of queueing", async () => {
    render({
      sessions: [
        session(),
        session({
          id: "d1",
          title: "Landing",
          kind: "design",
          status: "running",
          runtime: "docker",
        }),
      ],
      canvasHtml: { d1: "<html><body><h1>Hero</h1></body></html>" },
    });
    const design = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Design"),
    );
    act(() => {
      design!.click();
    });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Landing"),
    );
    act(() => {
      row!.click();
    });
    expect(host.textContent).toMatch(/agent working/);
    const box = host.querySelector(
      'textarea[aria-label="Canvas instruction"]',
    ) as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "Make the hero tighter");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Send");
    await act(async () => {
      send!.click();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith("d1", "Make the hero tighter", { steer: true });
  });

  it("shows live thinking on a working Design canvas", () => {
    render({
      sessions: [
        session(),
        session({
          id: "d1",
          title: "Landing",
          kind: "design",
          status: "running",
          runtime: "docker",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "hero",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "a1",
              role: "assistant",
              content: "",
              thinking: "Keep the hero tight and use kit tokens.",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        }),
      ],
      canvasHtml: { d1: "<html><body><h1>Hero</h1></body></html>" },
    });
    const design = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Design"),
    );
    act(() => {
      design!.click();
    });
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Landing"),
    );
    act(() => {
      row!.click();
    });
    expect(host.querySelector(".mobile-canvas-live")?.textContent).toMatch(/Keep the hero tight/);
  });

  it("opens a Codebase pull with reply and review, not merge", async () => {
    vi.mocked(api.commentPull).mockResolvedValue({
      repoId: "r1",
      forge: "github",
      number: 12,
      title: "Fix the diff viewer",
      state: "open",
      headRef: "feature/diff",
      baseRef: "main",
      headSha: "abcdef123456",
      url: "https://github.com/acme/app/pull/12",
      author: "damon",
      updatedAt: "2020-01-02T00:00:00.000Z",
      body: "Please **review** the hunk.",
      files: [],
      comments: [
        {
          id: "c1",
          body: "Looks good",
          author: "sam",
          createdAt: "2020-01-02T01:00:00.000Z",
        },
        {
          id: "c2",
          body: "Ship it",
          author: "you",
          createdAt: "2020-01-02T02:00:00.000Z",
        },
      ],
      commits: [],
      checks: [],
    });
    vi.mocked(api.reviewPull).mockResolvedValue({
      repoId: "r1",
      forge: "github",
      number: 12,
      title: "Fix the diff viewer",
      state: "open",
      headRef: "feature/diff",
      baseRef: "main",
      headSha: "abcdef123456",
      url: "https://github.com/acme/app/pull/12",
      author: "damon",
      updatedAt: "2020-01-02T00:00:00.000Z",
      body: "Please **review** the hunk.",
      files: [],
      comments: [],
      commits: [],
      checks: [],
    });
    const repo: LinkedRepo = {
      id: "r1",
      name: "acme/app",
      checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
      openPullCount: 1,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    render({ repos: [repo] });
    const code = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Code"),
    );
    act(() => {
      code!.click();
    });
    expect(host.querySelector("[data-testid='mobile-code']")).toBeTruthy();
    expect(host.querySelector(".mobile-brand")).toBeTruthy();
    expect(host.textContent).toContain("acme/app");
    const row = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("acme/app"),
    );
    await act(async () => {
      row!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".mobile-brand")).toBeNull();
    expect(host.textContent).toContain("Fix the diff viewer");
    const agents = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Agents"),
    );
    act(() => {
      agents!.click();
    });
    expect(host.querySelector(".mobile-brand")).toBeTruthy();
    const codeAgain = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("Code"),
    );
    await act(async () => {
      codeAgain!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".mobile-brand")).toBeNull();
    expect(host.textContent).toContain("Fix the diff viewer");
    const pull = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Fix the diff viewer"),
    );
    await act(async () => {
      pull!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='mobile-pull']")).toBeTruthy();
    expect(host.textContent).toContain("review");
    expect(host.textContent).toContain("Looks good");
    expect(host.textContent).toMatch(/Start agent stays on the desktop/);
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Merge")).toBe(
      true,
    );
    expect(
      [...host.querySelectorAll("button")].some((btn) => btn.textContent === "Start agent"),
    ).toBe(false);
    const reply = [...host.querySelectorAll("textarea")].find((el) =>
      el.getAttribute("placeholder")?.includes("Reply"),
    ) as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(reply, "Ship it");
      reply.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const post = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Post comment",
    );
    await act(async () => {
      post!.click();
      await Promise.resolve();
    });
    expect(api.commentPull).toHaveBeenCalledWith("r1", 12, { body: "Ship it" });
    const review = [...host.querySelectorAll("textarea")].find((el) =>
      el.getAttribute("placeholder")?.includes("Summarize"),
    ) as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(review, "Looks solid");
      review.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const approve = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Approve",
    );
    act(() => {
      approve!.click();
    });
    const submit = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Submit review",
    );
    await act(async () => {
      submit!.click();
      await Promise.resolve();
    });
    expect(api.reviewPull).toHaveBeenCalledWith("r1", 12, {
      body: "Looks solid",
      event: "APPROVE",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.mergePull).mockResolvedValue({
      repoId: "r1",
      forge: "github",
      number: 12,
      title: "Fix the diff viewer",
      state: "merged",
      headRef: "feature/diff",
      baseRef: "main",
      headSha: "abcdef123456",
      url: "https://github.com/acme/app/pull/12",
      updatedAt: "2020-01-02T00:00:00.000Z",
      files: [],
      comments: [],
      commits: [],
      checks: [],
    });
    const merge = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Merge");
    await act(async () => {
      merge!.click();
      await Promise.resolve();
    });
    expect(api.mergePull).toHaveBeenCalledWith("r1", 12);
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".mobile-back")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='mobile-pulls']")).toBeTruthy();
    act(() => {
      host.querySelector<HTMLButtonElement>(".mobile-back")!.click();
    });
    expect(host.querySelector("h1")?.textContent).toBe("Code");
    expect(host.querySelector("[data-testid='mobile-code']")).toBeTruthy();
  });

  it("opens Settings, new automation, and the command palette from More", async () => {
    render();
    const more = [...host.querySelectorAll<HTMLButtonElement>(".mobile-tab")].find((btn) =>
      btn.textContent?.includes("More"),
    );
    act(() => {
      more!.click();
    });
    const settings = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Settings"),
    );
    await act(async () => {
      settings!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='mobile-settings']")).toBeTruthy();
    act(() => {
      host.querySelector<HTMLButtonElement>(".mobile-overlay .mobile-back")!.click();
    });
    const automation = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("New job"),
    );
    await act(async () => {
      automation!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='new-automation-stub']")).toBeTruthy();
    const palette = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Command palette"),
    );
    await act(async () => {
      palette!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='palette-stub']")).toBeTruthy();
  });

  it("opens view-only VNC and find-in-chat on a VM thread", async () => {
    render({
      sessions: [session({ runtime: "vm", vmId: "vm-1" })],
    });
    act(() => {
      host.querySelector<HTMLButtonElement>(".mobile-row")!.click();
    });
    expect(host.querySelector("[data-testid='mobile-vnc-toggle']")).toBeTruthy();
    act(() => {
      host.querySelector<HTMLButtonElement>("[data-testid='mobile-vnc-toggle']")!.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='mobile-vnc']")).toBeTruthy();
    act(() => {
      host.querySelector<HTMLButtonElement>("[data-testid='mobile-vnc-toggle']")!.click();
    });
    const more = host.querySelector<HTMLButtonElement>("[title='Thread']");
    act(() => {
      more!.click();
    });
    const find = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Find in chat"),
    );
    act(() => {
      find!.click();
    });
    expect(host.querySelector("[data-testid='mobile-find']")).toBeTruthy();
  });
});
