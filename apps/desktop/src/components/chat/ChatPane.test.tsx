import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StrictMode, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_CANVAS_NUDGE,
  SELF_CORRECT_NUDGE,
  type AgentSession,
  type LocusConfig,
  type VmInstance,
} from "@locus/shared";
import { ChatPane, resetComposerDrafts } from "./ChatPane";
import { api } from "@/lib/api";
import { Store, initialState, type Action, type UiState } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    chat: vi.fn(() => new Promise(() => undefined)),
    abortChat: vi.fn(async () => ({ ok: true })),
    sendQueueNow: vi.fn(),
    patchSession: vi.fn(),
    rewind: vi.fn(),
    clearChat: vi.fn(),
    resolveApproval: vi.fn(),
    takeover: vi.fn(),
    handback: vi.fn(),
    fork: vi.fn(),
    spawnWorkers: vi.fn(),
    cycleRole: vi.fn(),
    sessionSkills: vi.fn(async () => []),
    workspaceSearch: vi.fn(async () => ({ items: [], fileCount: 0, builtAt: "" })),
    execTool: vi.fn(),
    session: vi.fn(),
    checkpointDiff: vi.fn(),
    revealWorkspace: vi.fn(async () => ({ path: "/tmp" })),
  },
  retryEvents: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pasteClipboardFiles(target: Element, files: File[]) {
  const items = files.map((file) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  }));
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      items,
      files,
      getData: () => "",
    },
  });
  target.dispatchEvent(event);
  return event;
}

function pasteClipboardText(target: Element, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
      files: [],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
  target.dispatchEvent(event);
  return event;
}

function dropFiles(target: Element, files: File[]) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files, types: ["Files"] },
  });
  target.dispatchEvent(event);
}

const session: AgentSession = {
  id: "s1",
  title: "Test",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "grok-4",
  status: "running",
  vmId: "v1",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

const vm: VmInstance = {
  id: "v1",
  sessionId: "s1",
  templateId: "ubuntu-24.04",
  os: "ubuntu",
  name: "Ubuntu",
  status: "booting",
  diskPath: "/tmp/disk.qcow2",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

const reviewSkill = {
  id: "sk-review",
  name: "review",
  title: "PR review",
  hint: "Review the current diff",
  body: "Look at git_diff and comment.",
  enabled: true,
};

const skillsConfig: LocusConfig = {
  theme: "ember",
  providers: [],
  templates: [],
  hardwareProfiles: [],
  forges: [],
  skills: [reviewSkill],
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

describe("ChatPane", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetComposerDrafts();
    vi.mocked(api.chat).mockReset();
    vi.mocked(api.patchSession).mockClear();
    vi.mocked(api.sendQueueNow).mockClear();
    vi.mocked(api.rewind).mockClear();
    vi.mocked(api.clearChat).mockClear();
    vi.mocked(api.session).mockReset();
    vi.mocked(api.checkpointDiff).mockReset();
  });

  function render(state: UiState, dispatch: (action: Action) => void = () => undefined) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    rerender(state, dispatch);
  }

  function rerender(state: UiState, dispatch: (action: Action) => void = () => undefined) {
    const node: ReactNode = (
      <Store.Provider value={{ state: { ...state, connected: true }, dispatch }}>
        <ChatPane />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  function expectBefore(earlier: Element | null, later: Element | null) {
    expect(earlier).toBeTruthy();
    expect(later).toBeTruthy();
    expect(
      earlier!.compareDocumentPosition(later!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }

  function renderOffline(state: UiState) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider value={{ state: { ...state, connected: false }, dispatch: () => undefined }}>
        <ChatPane />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("posts follow-ups to the session queue while a turn is running", async () => {
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });

    expect(host.textContent).toMatch(/Guest starting · booting · you can still chat/);
    expect(host.textContent).toContain("Queue");
    expect(host.textContent).toMatch(/Send steers this turn/);

    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "follow up after this turn");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const queueBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Queue"),
    );
    expect(queueBtn).toBeTruthy();
    await act(async () => {
      queueBtn!.click();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith("s1", "follow up after this turn", undefined);
  });

  it("shows a needs-you banner when the session is gated", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, needsHuman: "Protected branch main" }],
      vms: [vm],
    });
    expect(host.querySelector(".needs-you-banner")?.textContent).toMatch(/Protected branch main/);
  });

  it("opens find in chat with Ctrl+F and highlights matching messages", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Fix the login form",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "a1",
              role: "assistant",
              content: "Patched auth.ts",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    const input = host.querySelector('[aria-label="Find in chat"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "login");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector('[data-msg-id="u1"]')?.getAttribute("data-find-active")).toBe("true");
    expect(host.querySelector(".chat-find-count")?.textContent).toMatch(/1 of 1/);
  });

  it("does not open find in chat for Ctrl+Shift+F", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle" }],
      vms: [{ ...vm, status: "ready" }],
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(host.querySelector('[aria-label="Find in chat"]')).toBeNull();
  });

  it("does not reserve a find-count slot until there is a query", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle" }],
      vms: [{ ...vm, status: "ready" }],
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    const input = host.querySelector('[aria-label="Find in chat"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.className).toMatch(/\bsearch\b/);
    expect(input.closest(".chat-find-wrap")).toBeTruthy();
    expect(host.querySelector(".chat-find-count")).toBeNull();
  });

  it("opens find in chat from the palette action", () => {
    const dispatch = vi.fn();
    render(
      {
        ...initialState,
        selectedId: session.id,
        findChatOpen: true,
        sessions: [{ ...session, status: "idle" }],
        vms: [{ ...vm, status: "ready" }],
      },
      dispatch,
    );
    expect(host.querySelector('[aria-label="Find in chat"]')).toBeTruthy();
    expect(dispatch).toHaveBeenCalledWith({ type: "findChat", open: false });
  });

  it("dismisses the needs-you banner through the session", async () => {
    const gated = { ...session, needsHuman: "Protected branch main" };
    const cleared = { ...gated, needsHuman: undefined };
    vi.mocked(api.patchSession).mockResolvedValue(cleared);
    const dispatch = vi.fn();
    render(
      {
        ...initialState,
        selectedId: session.id,
        sessions: [gated],
        vms: [vm],
      },
      dispatch,
    );
    const dismiss = host.querySelector(".needs-you-banner button") as HTMLButtonElement;
    expect(dismiss?.textContent).toMatch(/Dismiss/);
    await act(async () => {
      dismiss.click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", { needsHuman: null });
    expect(dispatch).toHaveBeenCalledWith({ type: "session", session: cleared });
  });

  it("steers a running turn instead of queueing", async () => {
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "try the other file");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const sendBtn = host.querySelector(".composer-send") as HTMLButtonElement;
    expect(sendBtn?.getAttribute("aria-label")).toMatch(/steer/i);
    await act(async () => {
      sendBtn.click();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith("s1", "try the other file", { steer: true });
  });

  it("opens a nested read-only subagent thread from the live card", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          subagents: [
            {
              id: "c1",
              task: "find compact.ts",
              status: "running",
              lastLine: "grep compact.ts",
              inputTokens: 400,
              outputTokens: 80,
              messages: [
                {
                  id: "u1",
                  role: "user",
                  content: "find compact.ts",
                  createdAt: "2020-01-01T00:00:00.000Z",
                },
                {
                  id: "a1",
                  role: "assistant",
                  content: "Looking in src…",
                  createdAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [vm],
    });
    const fold = host.querySelector("[data-testid='subagent-fold']");
    expect(fold?.textContent).toMatch(/find compact\.ts/);
    expect(fold?.textContent).toMatch(/Running/);
    expect(fold?.textContent).toMatch(/grep compact\.ts/);
    expect(host.querySelector("textarea")).toBeTruthy();

    const card = host.querySelector("[data-testid='subagent-card']") as HTMLButtonElement;
    act(() => {
      card.click();
    });
    expect(host.querySelector("[data-testid='subagent-banner']")?.textContent).toMatch(
      /Explore subagent/,
    );
    expect(host.querySelector("[data-testid='subagent-readonly']")?.textContent).toMatch(
      /read-only/,
    );
    expect(host.textContent).toMatch(/Looking in src/);
    expect(host.querySelector("textarea")).toBeFalsy();
    expect(host.querySelector("[data-testid='subagent-card']")).toBeFalsy();

    const back = [...host.querySelectorAll("button")].find((b) => b.textContent === "Back");
    act(() => {
      back!.click();
    });
    expect(host.querySelector("[data-testid='subagent-banner']")).toBeFalsy();
    expect(host.querySelector("textarea")).toBeTruthy();
  });

  it("opens a finished subagent from the spawn_agent tool card", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
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
              content: "I'll search.",
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
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const card = host.querySelector("[data-testid='subagent-card']") as HTMLButtonElement;
    expect(card?.textContent).toMatch(/find compact\.ts/);
    act(() => {
      card.click();
    });
    expect(host.querySelector("[data-testid='subagent-readonly']")).toBeTruthy();
    expect(host.querySelector("textarea")).toBeFalsy();
    expect(host.textContent).toMatch(/It's in src\/compact\.ts/);
  });

  it("does not fold a finished subagent into the next working row", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "running",
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
              content: "I'll search.",
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
            {
              id: "u2",
              role: "user",
              content: "now the tests",
              createdAt: "2020-01-01T00:00:03.000Z",
            },
          ],
          subagents: [
            {
              id: "child-1",
              task: "find compact.ts",
              status: "done",
              toolCallId: "c1",
              lastLine: "It's in src/compact.ts",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='subagent-fold']")).toBeNull();
    expect(host.querySelector("[data-testid='subagent-card']")?.textContent).toMatch(
      /find compact\.ts/,
    );
  });

  it("renders the persisted queue and removes items through the session", async () => {
    vi.mocked(api.patchSession).mockResolvedValue({
      ...session,
      status: "running",
      queue: undefined,
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          queue: [{ id: "q1", text: "follow up after this turn", plan: true }],
          queuePaused: true,
        },
      ],
      vms: [vm],
    });

    const queued = host.querySelector("[aria-label='Queued prompts']");
    expect(queued?.textContent).toContain("follow up after this turn");
    expect(queued?.textContent).toMatch(/Plan/);
    expect(host.textContent).toMatch(/Queue paused after Stop/);
    expect(host.textContent).toMatch(/1 queued/);

    const remove = queued!.querySelector(
      "button[aria-label='Remove from queue']",
    ) as HTMLButtonElement;
    await act(async () => {
      remove.click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", { queue: null });
  });

  it("does not keep a landed design follow-up in the composer queue", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          kind: "design",
          runtime: "docker",
          status: "idle",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Can we make sure the colour scheme matches",
              createdAt: "2020-01-01T00:00:02.000Z",
            },
          ],
          queue: [{ id: "q1", text: "Can we make sure the colour scheme matches" }],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    expect(host.querySelector("[aria-label='Queued prompts']")).toBeNull();
    expect(host.textContent).toContain("Can we make sure the colour scheme matches");
    expect(host.textContent).not.toMatch(/1 queued/);
    expect(host.querySelectorAll(".msg.user")).toHaveLength(1);
  });

  it("drops the optimistic bubble when a design follow-up lands in the queue", async () => {
    const design = {
      ...session,
      kind: "design" as const,
      runtime: "docker" as const,
      status: "idle" as const,
      messages: [
        {
          id: "u1",
          role: "user" as const,
          content: "Redesign the Logs page",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    };
    const state = {
      ...initialState,
      selectedId: session.id,
      sessions: [design],
      vms: [{ ...vm, runtime: "docker" as const, status: "ready" as const }],
    };
    render(state);
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "Can we make sure the colour scheme matches");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(host.querySelector('.msg.user[data-pending="true"]')?.textContent).toMatch(
      /colour scheme matches/,
    );
    rerender({
      ...state,
      sessions: [
        {
          ...design,
          queue: [{ id: "q1", text: "Can we make sure the colour scheme matches" }],
        },
      ],
    });
    expect(host.querySelector('.msg.user[data-pending="true"]')).toBeNull();
    expect(host.querySelector("[aria-label='Queued prompts']")?.textContent).toContain(
      "Can we make sure the colour scheme matches",
    );
    expect(host.querySelectorAll(".msg.user")).toHaveLength(1);
  });

  it("drops the optimistic bubble when a design follow-up lands in the queue", async () => {
    const design = {
      ...session,
      kind: "design" as const,
      runtime: "docker" as const,
      status: "idle" as const,
      messages: [
        {
          id: "u1",
          role: "user" as const,
          content: "Redesign the Logs page",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    };
    const state = {
      ...initialState,
      selectedId: session.id,
      sessions: [design],
      vms: [{ ...vm, runtime: "docker" as const, status: "ready" as const }],
    };
    render(state);
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "Can we make sure the colour scheme matches");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(host.querySelector('.msg.user[data-pending="true"]')?.textContent).toMatch(
      /colour scheme matches/,
    );
    rerender({
      ...state,
      sessions: [
        {
          ...design,
          queue: [{ id: "q1", text: "Can we make sure the colour scheme matches" }],
        },
      ],
    });
    expect(host.querySelector('.msg.user[data-pending="true"]')).toBeNull();
    expect(host.querySelector("[aria-label='Queued prompts']")?.textContent).toContain(
      "Can we make sure the colour scheme matches",
    );
    expect(host.querySelectorAll(".msg.user")).toHaveLength(1);
  });

  it("does not echo a follow-up that is already in the session queue", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          kind: "design",
          runtime: "docker",
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Redesign the Logs page",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
          queue: [{ id: "q1", text: "Can we make sure the colour scheme matches" }],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    expect(host.querySelector("[aria-label='Queued prompts']")?.textContent).toContain(
      "Can we make sure the colour scheme matches",
    );
    expect(host.querySelector(".msg.user")?.textContent).not.toMatch(/colour scheme matches/);
  });

  it("sends a queued prompt now through the session", async () => {
    vi.mocked(api.sendQueueNow).mockResolvedValue({
      ...session,
      status: "running",
      queue: undefined,
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          queue: [{ id: "q1", text: "follow up after this turn", plan: true }],
        },
      ],
      vms: [vm],
    });

    const queued = host.querySelector("[aria-label='Queued prompts']");
    const sendNow = queued!.querySelector("button[aria-label^='Send now']") as HTMLButtonElement;
    expect(sendNow).toBeTruthy();
    expect(sendNow.getAttribute("aria-label")).toMatch(/interrupt this turn/i);
    await act(async () => {
      sendNow.click();
      await Promise.resolve();
    });
    expect(api.sendQueueNow).toHaveBeenCalledWith("s1", "q1");
  });

  it("shows an error when Send now fails", async () => {
    vi.mocked(api.sendQueueNow).mockRejectedValue(new Error("Queued prompt not found"));
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          queue: [{ id: "q1", text: "follow up after this turn" }],
        },
      ],
      vms: [vm],
    });

    const sendNow = host.querySelector("button[aria-label^='Send now']") as HTMLButtonElement;
    await act(async () => {
      sendNow.click();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/Queued prompt not found/);
  });

  it("pins the thread when you scroll up and jumps back to latest", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
            {
              id: "a1",
              role: "assistant",
              content: "working",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const pane = host.querySelector(".thread") as HTMLDivElement;
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 80 });
    Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: 0 });
    act(() => {
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const jump = host.querySelector("[data-testid='jump-latest']") as HTMLButtonElement;
    expect(jump).toBeTruthy();
    expect(pane.scrollTop).toBe(0);
    act(() => {
      jump.click();
    });
    expect(host.querySelector("[data-testid='jump-latest']")).toBeNull();
    expect(pane.scrollTop).toBe(1000);
  });

  it("pins to the latest message when you open a chat", async () => {
    const ui = {
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle" as const,
          messages: [
            {
              id: "u1",
              role: "user" as const,
              content: "hello",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "a1",
              role: "assistant" as const,
              content: "working",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
            {
              id: "u2",
              role: "user" as const,
              content: "and then",
              createdAt: "2020-01-01T00:00:02.000Z",
            },
            {
              id: "a2",
              role: "assistant" as const,
              content: "the last thing that happened",
              createdAt: "2020-01-01T00:00:03.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" as const }],
    };
    render(ui);
    const pane = host.querySelector(".thread") as HTMLDivElement;
    let top = 0;
    Object.defineProperty(pane, "scrollHeight", { configurable: true, get: () => 1800 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, get: () => 80 });
    Object.defineProperty(pane, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    rerender(ui);
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
    expect(top).toBe(1800);
  });

  it("keeps a mid-thread scroll position after unpinning", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
            {
              id: "a1",
              role: "assistant",
              content: "working",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const pane = host.querySelector(".thread") as HTMLDivElement;
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 80 });
    Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: 400 });
    act(() => {
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='jump-latest']")).toBeTruthy();
    expect(pane.scrollTop).toBe(400);
  });

  it("shows a left-edge position indicator when the thread overflows", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
            {
              id: "a1",
              role: "assistant",
              content: "working",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const pane = host.querySelector(".thread") as HTMLDivElement;
    const rail = host.querySelector("[data-testid='chat-scroll-indicator']") as HTMLDivElement;
    const track = rail.querySelector(".thread-scroll-track") as HTMLDivElement;
    const thumb = host.querySelector("[data-testid='chat-scroll-thumb']") as HTMLDivElement;
    expect(rail).toBeTruthy();
    expect(rail.classList.contains("is-visible")).toBe(false);
    expect(host.querySelector(".thread-body")).toBeTruthy();

    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 80 });
    Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: 400 });
    Object.defineProperty(track, "clientHeight", { configurable: true, value: 400 });
    act(() => {
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(rail.classList.contains("is-visible")).toBe(true);
    expect(rail.getAttribute("aria-valuenow")).toBe("43");
    expect(Number.parseFloat(thumb.style.top)).toBeGreaterThan(0);
    expect(Number.parseFloat(thumb.style.height)).toBeGreaterThan(0);
  });

  it("jumps the thread when you click the position indicator", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
            {
              id: "a1",
              role: "assistant",
              content: "working",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const pane = host.querySelector(".thread") as HTMLDivElement;
    const rail = host.querySelector("[data-testid='chat-scroll-indicator']") as HTMLDivElement;
    const track = rail.querySelector(".thread-scroll-track") as HTMLDivElement;
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 80 });
    Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: 400 });
    Object.defineProperty(track, "clientHeight", { configurable: true, value: 400 });
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 400,
      right: 5,
      width: 5,
      height: 400,
      toJSON: () => ({}),
    });
    act(() => {
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    act(() => {
      rail.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientY: 400,
          pointerId: 1,
        }),
      );
    });
    expect(pane.scrollTop).toBe(920);
  });

  it("re-pins the thread when you send after scrolling up", async () => {
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const pane = host.querySelector(".thread") as HTMLDivElement;
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 80 });
    Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: 0 });
    act(() => {
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='jump-latest']")).toBeTruthy();
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "next");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Send"),
    );
    await act(async () => {
      send!.click();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='jump-latest']")).toBeNull();
    expect(pane.scrollTop).toBe(1000);
  });

  it("uses a design placeholder on design sessions", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, kind: "design", runtime: "docker", status: "idle" }],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.placeholder).toMatch(/canvas/i);
    expect(host.querySelector("[aria-label='Repository']")).toBeNull();
  });

  it("uses an @asset placeholder on game sessions", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, kind: "game", runtime: "docker", status: "idle" }],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.placeholder).toMatch(/One change per send/i);
    expect(textarea.placeholder).toMatch(/@asset/i);
  });

  it("lists game and asset chats in the @ mention menu on a host agent", () => {
    const hub: AgentSession = {
      ...session,
      id: "h1",
      kind: "agent",
      title: "Hub",
      runtime: "host",
      status: "idle",
    };
    const arcade: AgentSession = {
      ...session,
      id: "g1",
      kind: "game",
      title: "Arcade",
      runtime: "host",
      status: "idle",
    };
    const knight: AgentSession = {
      ...session,
      id: "a1",
      kind: "assets",
      title: "Knight",
      runtime: "host",
      assetPack: {
        slug: "knight",
        kind: "sprite",
        title: "Knight",
        updatedAt: "2020-01-01T00:00:00.000Z",
        files: ["source.png"],
      },
    };
    render({
      ...initialState,
      selectedId: hub.id,
      sessions: [hub, arcade, knight],
      vms: [{ ...vm, runtime: "host", status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.placeholder).toMatch(/@game/i);
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    act(() => {
      setValue?.call(textarea, "@");
      textarea.selectionStart = textarea.selectionEnd = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      [...host.querySelectorAll("[data-testid='asset-mention-menu'] .slash-name")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["@game:arcade", "@asset:knight"]);
  });

  it("lists Assets chats in the @ mention menu on a game session", () => {
    const game: AgentSession = {
      ...session,
      id: "g1",
      kind: "game",
      title: "Arcade",
      runtime: "docker",
      status: "idle",
    };
    const knight: AgentSession = {
      ...session,
      id: "a1",
      kind: "assets",
      title: "Knight",
      assetPack: {
        slug: "knight",
        kind: "sprite",
        title: "Knight",
        updatedAt: "2020-01-01T00:00:00.000Z",
        files: ["source.png"],
      },
    };
    render({
      ...initialState,
      selectedId: game.id,
      sessions: [game, knight],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    act(() => {
      setValue?.call(textarea, "@");
      textarea.selectionStart = textarea.selectionEnd = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      [...host.querySelectorAll("[data-testid='asset-mention-menu'] .slash-name")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["@asset:knight"]);
    expect(
      host
        .querySelector("[data-testid='asset-mention-menu'] [data-testid='asset-preview']")
        ?.getAttribute("src"),
    ).toBe("/api/sessions/a1/canvas-files/.locus-asset/source.png?t=1577836800000");
  });

  it("shows a working state while the agent has an empty reply", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Design a six-slide deck",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            { id: "a1", role: "assistant", content: "", createdAt: "2020-01-01T00:00:01.000Z" },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const working = host.querySelector("[data-testid='agent-working']");
    expect(working?.textContent).toMatch(/Working/);
    expect(working?.querySelector("[data-testid='locus-mascot']")?.getAttribute("data-pose")).toBe(
      "think",
    );
    expect(host.textContent).toContain("Agent is working");
  });

  it("renders a clone percentage card on the Cloning note", () => {
    render({
      ...initialState,
      selectedId: session.id,
      cloneProgress: {
        [session.id]: { percent: 36, phase: "Receiving objects" },
      },
      sessions: [
        {
          ...session,
          runtime: "docker",
          status: "idle",
          messages: [
            {
              id: "s0",
              role: "system",
              content: "Cloning https://github.com/acme/demo.git into the guest at /workspace",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "running" }],
    });
    const card = host.querySelector("[data-testid=clone-progress]");
    expect(card?.textContent).toContain("36%");
    expect(card?.textContent).toContain("Receiving objects");
    expect(card?.textContent).toMatch(/waiting for this clone/i);
  });

  it("renders an image-build card on the Building note", () => {
    render({
      ...initialState,
      selectedId: session.id,
      imageProgress: {
        [session.id]: { percent: 30, phase: "RUN apt-get update", step: 2, total: 6 },
      },
      sessions: [
        {
          ...session,
          runtime: "docker",
          status: "idle",
          messages: [
            {
              id: "s0",
              role: "system",
              content: "Building locus/agent:0.1 (git, Node, Chromium/Xvfb, ffmpeg, code-server)…",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "booting" }],
    });
    const card = host.querySelector("[data-testid=image-build-progress]");
    expect(card?.textContent).toContain("30%");
    expect(card?.textContent).toContain("RUN apt-get update");
    expect(card?.textContent).toMatch(/waiting for this image build/i);
    expect(host.textContent).toMatch(/Building the agent image/);
  });

  it("renders a compact boundary in the thread", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          lastCompact: {
            dropped: 8,
            beforeTokens: 12_000,
            afterTokens: 4_000,
            source: "heuristic",
          },
          messages: [
            {
              id: "c1",
              role: "system",
              content: "stale compact copy",
              compact: {
                dropped: 8,
                beforeTokens: 12_000,
                afterTokens: 4_000,
                source: "heuristic",
              },
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const chip = host.querySelector("[data-testid=compact-notice]");
    expect(chip?.textContent).toBe("Compacted 8 messages · 12000 → 4000 tokens (heuristic)");
    expect(host.querySelectorAll("[data-testid=compact-notice]")).toHaveLength(1);
    expect(host.querySelector(".msg.compact .who")).toBeNull();
  });

  it("shows a Compacted chip when lastCompact exists without a compact message", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          lastCompact: {
            dropped: 1,
            beforeTokens: 9_000,
            afterTokens: 3_000,
            source: "llm",
          },
          messages: [
            {
              id: "u1",
              role: "user",
              content: "keep going",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid=compact-notice]")?.textContent).toBe(
      "Compacted 1 message · 9000 → 3000 tokens (model summary)",
    );
  });

  it("puts the clone card on the latest Cloning note only", () => {
    render({
      ...initialState,
      selectedId: session.id,
      cloneProgress: {
        [session.id]: { percent: 12, phase: "Receiving objects" },
      },
      sessions: [
        {
          ...session,
          runtime: "docker",
          status: "idle",
          messages: [
            {
              id: "s0",
              role: "system",
              content: "Cloning https://github.com/acme/demo.git into the guest at /workspace",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
            {
              id: "s1",
              role: "system",
              content: "Clone failed: timed out",
              createdAt: "2020-01-01T00:00:02.000Z",
            },
            {
              id: "s2",
              role: "system",
              content: "Cloning https://github.com/acme/demo.git into the guest at /workspace",
              createdAt: "2020-01-01T00:00:03.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "running" }],
    });
    const cards = host.querySelectorAll("[data-testid=clone-progress]");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.closest(".msg")?.textContent).toContain("12%");
    expect(host.textContent).toContain("Clone failed: timed out");
  });

  it("says the agent is waiting on the clone instead of working", () => {
    render({
      ...initialState,
      selectedId: session.id,
      cloneProgress: {
        [session.id]: {
          percent: 90,
          phase: "Resolving deltas",
          phasePercent: 97,
          received: 485,
          total: 500,
        },
      },
      sessions: [
        {
          ...session,
          runtime: "docker",
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "fix the login",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "s0",
              role: "system",
              content: "Cloning https://github.com/acme/demo.git into the guest at /workspace",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).toMatch(
      /Waiting for the clone/,
    );
    expect(host.querySelector(".composer-meta")?.textContent).toMatch(/Waiting for the clone/);
    expect(host.textContent).not.toContain("Agent is working");
    expect(host.querySelector("[data-testid=clone-progress]")?.textContent).toContain(
      "Resolving deltas 97%",
    );
    expect(host.querySelector("[data-testid=clone-progress]")?.textContent).toContain("485/500");
  });

  it("keeps a tail working row when a boot note lands after a blank assistant", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          kind: "design",
          runtime: "docker",
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Design a print-like one-pager",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "s0",
              role: "system",
              content: "Starting the container.",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
            { id: "a1", role: "assistant", content: "", createdAt: "2020-01-01T00:00:02.000Z" },
            {
              id: "s1",
              role: "system",
              content: "Container is ready.",
              createdAt: "2020-01-01T00:00:03.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "running" }],
    });
    const working = host.querySelector("[data-testid='agent-working']");
    expect(working?.textContent).toMatch(/Working on the canvas/);
    const thread = host.querySelector(".thread")?.textContent ?? "";
    expect(thread.indexOf("Container is ready.")).toBeGreaterThan(-1);
    expect(thread.indexOf("Container is ready.")).toBeLessThan(
      thread.indexOf("Working on the canvas"),
    );
  });

  it("says the canvas is in progress on a running design session", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          kind: "design",
          runtime: "docker",
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Make a landing page",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).toMatch(
      /Working on the canvas/,
    );
  });

  it("shows a working row while a design boot note is the latest activity", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          kind: "design",
          runtime: "docker",
          status: "idle",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Put together a visual webpage",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "s1",
              role: "system",
              content: "Starting the container.",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "running" }],
    });
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).toMatch(
      /Waiting for the guest/,
    );
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).not.toMatch(
      /Working on the canvas/,
    );
    expect(host.querySelector("[data-testid='guest-start-note']")?.textContent).toMatch(
      /Starting the container/,
    );
    expect(host.querySelector("[data-testid='guest-start-note'] .working-dots")).toBeTruthy();
    expect(host.querySelector("[data-testid='agent-working'] .working-dots")).toBeTruthy();
  });

  it("does not say the canvas is in progress while a running design is still starting", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          kind: "design",
          runtime: "docker",
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Can you design me a one pager on Locus",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "s1",
              role: "system",
              content: "Starting the container.",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "running" }],
    });
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).toMatch(
      /Waiting for the guest/,
    );
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).not.toMatch(
      /Working on the canvas/,
    );
    expect(host.querySelector("[data-testid='guest-start-note']")?.textContent).toMatch(
      /Starting the container/,
    );
    expect(host.querySelector(".composer-meta")?.textContent).not.toMatch(/Agent is working/);
  });

  it("shows waiting for the guest on a provisioning session", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          kind: "design",
          runtime: "docker",
          status: "provisioning",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Make a landing page",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "booting" }],
    });
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).toMatch(
      /Waiting for the guest/,
    );
    expect(host.querySelector(".composer-meta")?.textContent).toMatch(/Guest starting/);
  });

  it("keeps the canvas working row while a file_write is in progress", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          kind: "design",
          runtime: "docker",
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Make a landing page",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "a1",
              role: "assistant",
              content: "Writing the canvas",
              createdAt: "2020-01-01T00:00:01.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "file_write",
                  arguments: { path: "/workspace/index.html", content: "<html></html>" },
                  startedAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).toMatch(
      /Working on the canvas/,
    );
    expect(host.textContent).toContain("Writing the canvas");
  });

  it("hides self-correct nudges from the operator thread", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "read the missing file",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "t1",
              role: "tool",
              content: "ENOENT: no such file\n(exit 1)",
              createdAt: "2020-01-01T00:00:01.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "file_read",
                  arguments: { path: "/no-such-file" },
                  error: "ENOENT: no such file\n(exit 1)",
                  startedAt: "2020-01-01T00:00:01.000Z",
                  finishedAt: "2020-01-01T00:00:01.100Z",
                },
              ],
            },
            {
              id: "n1",
              role: "system",
              content: SELF_CORRECT_NUDGE,
              createdAt: "2020-01-01T00:00:01.200Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.textContent).not.toContain("Do not bounce this to the operator");
    expect(host.textContent).not.toContain("diagnosable error");
    expect(host.textContent).not.toMatch(/\bLocus\b/);
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).toMatch(/Working/);
  });

  it("still shows operator-facing system notes", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            {
              id: "n1",
              role: "system",
              content: "Guest is ready.",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.textContent).toContain("Locus");
    expect(host.textContent).toContain("Guest is ready.");
  });

  it("hides empty-canvas harness nudges from the operator thread", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          kind: "design",
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "make a landing page",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "n1",
              role: "system",
              content: EMPTY_CANVAS_NUDGE,
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    expect(host.textContent).not.toContain("Call file_write now");
    expect(host.textContent).not.toMatch(/\bLocus\b/);
  });

  it("does not show a working state after the turn finishes", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
            { id: "a1", role: "assistant", content: "done", createdAt: "2020-01-01T00:00:01.000Z" },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='agent-working']")).toBeNull();
  });

  it("shows a live thinking snippet while the model is reasoning", () => {
    render({
      ...initialState,
      selectedId: session.id,
      thinking: { [session.id]: "plan the landing page layout" },
      sessions: [
        {
          ...session,
          status: "running",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
            { id: "a1", role: "assistant", content: "", createdAt: "2020-01-01T00:00:01.000Z" },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).toMatch(/Thinking/);
    expect(host.querySelector("[data-testid='agent-thinking']")?.textContent).toBe(
      "plan the landing page layout",
    );
  });

  it("hides thought traces in Swarm and keeps a plain working state", () => {
    render({
      ...initialState,
      selectedId: session.id,
      thinking: { [session.id]: "plan the landing page layout" },
      config: { ...skillsConfig, productMode: "swarm" },
      sessions: [
        {
          ...session,
          surface: "swarm",
          status: "running",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
            {
              id: "a1",
              role: "assistant",
              content: "",
              thinking: "plan the landing page layout",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='thinking-trace']")).toBeNull();
    expect(host.querySelector("[data-testid='agent-thinking']")).toBeNull();
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).toMatch(/Working/);
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).not.toMatch(
      /plan the landing page layout/,
    );

    render({
      ...initialState,
      selectedId: session.id,
      config: { ...skillsConfig, productMode: "swarm" },
      sessions: [
        {
          ...session,
          surface: "swarm",
          status: "idle",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
            {
              id: "a1",
              role: "assistant",
              content: "On it — I'll ping you when the outline is ready.",
              thinking: "Keep the reply short like a messaging app.",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='thinking-trace']")).toBeNull();
    expect(host.textContent).toContain("On it — I'll ping you when the outline is ready.");
    expect(host.textContent).not.toContain("Keep the reply short like a messaging app.");
  });

  it("labels Swarm thinking with the live team name and a running teammate", () => {
    const coordinator: AgentSession = {
      ...session,
      id: "coord",
      title: "R&D",
      kind: "project",
      surface: "swarm",
      projectId: "team-1",
      status: "running",
      messages: [
        { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
        { id: "a1", role: "assistant", content: "", createdAt: "2020-01-01T00:00:01.000Z" },
      ],
    };
    const teammate: AgentSession = {
      ...session,
      id: "mate-1",
      title: "Nova",
      surface: "swarm",
      projectId: "team-1",
      status: "running",
      persona: { displayName: "Nova", hubRole: "Researcher" },
      messages: [],
    };
    render({
      ...initialState,
      selectedId: coordinator.id,
      thinking: { [coordinator.id]: "checking the brief" },
      sessions: [coordinator],
      projects: [
        {
          id: "team-1",
          title: "Team Rapid Fire",
          teamName: "Team Rapid Fire",
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
          coordinatorSessionId: coordinator.id,
          memberCount: 1,
          memberIds: [teammate.id],
          surface: "swarm",
        },
      ],
    });
    expect(host.querySelector(".who.working-who")?.textContent).toBe("Team Rapid Fire");

    render({
      ...initialState,
      selectedId: coordinator.id,
      thinking: { [coordinator.id]: "checking the brief" },
      sessions: [coordinator, teammate],
      projects: [
        {
          id: "team-1",
          title: "Team Rapid Fire",
          teamName: "Team Rapid Fire",
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
          coordinatorSessionId: coordinator.id,
          memberCount: 1,
          memberIds: [teammate.id],
          surface: "swarm",
        },
      ],
    });
    expect(host.querySelector(".who.working-who")?.textContent).toContain("Nova");
    expect(host.querySelector("[data-testid='thinking-trace']")).toBeNull();
    expect(host.querySelector("[data-testid='agent-thinking']")).toBeNull();
  });

  it("shows a collapsible thought fold on a finished design reply", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          kind: "design",
          runtime: "docker",
          status: "idle",
          messages: [
            { id: "u1", role: "user", content: "hero", createdAt: "2020-01-01T00:00:00.000Z" },
            {
              id: "a1",
              role: "assistant",
              content: "Updated the canvas.",
              thinking: "Keep the hero tight and use the kit tokens.",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    const fold = host.querySelector("[data-testid='thinking-trace']") as HTMLDetailsElement | null;
    expect(fold).toBeTruthy();
    expect(fold?.open).toBe(false);
    expect(fold?.textContent).toContain("Thought");
    expect(fold?.textContent).toContain("Keep the hero tight and use the kit tokens.");
    expect(host.textContent).toContain("Updated the canvas.");
  });

  it("keeps a thinking-only design reply visible and opens the fold while working", () => {
    render({
      ...initialState,
      selectedId: session.id,
      thinking: { [session.id]: "plan the landing page layout" },
      sessions: [
        {
          ...session,
          kind: "design",
          runtime: "docker",
          status: "running",
          messages: [
            { id: "u1", role: "user", content: "hero", createdAt: "2020-01-01T00:00:00.000Z" },
            {
              id: "a1",
              role: "assistant",
              content: "",
              thinking: "plan the landing page layout",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    const fold = host.querySelector("[data-testid='thinking-trace']") as HTMLDetailsElement | null;
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).toMatch(/Thinking/);
    expect(host.querySelector("[data-testid='agent-thinking']")).toBeNull();
    expect(fold?.open).toBe(true);
    expect(fold?.textContent).toContain("Thinking");
    expect(fold?.textContent).toContain("plan the landing page layout");
  });

  it("shows an Ollama loading hint until reasoning or text arrives", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          providerId: "p",
          model: "llama3.2",
          status: "running",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
            { id: "a1", role: "assistant", content: "", createdAt: "2020-01-01T00:00:01.000Z" },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
      config: {
        ...skillsConfig,
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
    });
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).toMatch(
      /Waiting for Ollama/,
    );
    expect(host.querySelector("[data-testid='agent-thinking']")?.textContent).toMatch(
      /loading into memory/i,
    );
    expect(host.querySelector(".composer-meta")?.textContent).toMatch(/Waiting for Ollama/);
  });

  it("does not stack a working row under a streaming reply", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "running",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
            {
              id: "a1",
              role: "assistant",
              content: "Here is the first slide",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='agent-working']")).toBeNull();
    expect(host.textContent).toContain("Here is the first slide");
    expect(host.textContent).toContain("Agent is working");
  });

  it("still shows working after a new prompt even if an older tool never finished", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "running",
          messages: [
            {
              id: "a0",
              role: "assistant",
              content: "old",
              createdAt: "2020-01-01T00:00:00.000Z",
              toolCalls: [
                {
                  id: "c0",
                  name: "exec",
                  arguments: { command: "sleep 9" },
                  startedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            { id: "u1", role: "user", content: "continue", createdAt: "2020-01-01T00:00:02.000Z" },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='agent-working']")?.textContent).toMatch(/Working/);
  });

  it("rejects an oversize attachment at pick time", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [{ ...vm, status: "ready" }],
    });
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const oversize = new File(["x".repeat(11)], "shot.png", { type: "image/png" });
    Object.defineProperty(oversize, "size", { value: 10 * 1024 * 1024 + 1 });
    Object.defineProperty(input, "files", { value: [oversize] as unknown as FileList });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toMatch(/shot\.png is too large/);
  });

  it("inserts a pasted image as a chip at the caret", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [{ ...vm, status: "ready" }],
    });
    const composer = host.querySelector(".composer") as HTMLDivElement;
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    const image = new File([new Uint8Array([137, 80, 78, 71])], "clip.png", { type: "image/png" });
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "Look at  please");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      textarea.selectionStart = textarea.selectionEnd = 8;
      pasteClipboardFiles(composer, [image]);
    });
    expect(textarea.value).toBe("Look at [[paste:clip.png]]  please");
    expect(host.querySelector("[data-testid=composer-paste-chip]")?.textContent).toBe(
      "[[paste:clip.png]]",
    );
    expect(host.querySelector(".composer-attach")).toBeNull();
  });

  it("inserts a clipboard text block as a chip at the caret", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [{ ...vm, status: "ready" }],
    });
    const composer = host.querySelector(".composer") as HTMLDivElement;
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "See  please");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      textarea.selectionStart = textarea.selectionEnd = 4;
      pasteClipboardText(composer, "line one\nline two\nline three");
    });
    expect(textarea.value).toBe("See [[paste:Clipboard.txt]]  please");
    expect(host.querySelector("[data-testid=composer-paste-chip]")?.textContent).toBe(
      "[[paste:Clipboard.txt]]",
    );
    expect(host.querySelector(".composer-attach")).toBeNull();
  });

  it("previews clipboard text when hovering the paste chip", async () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [{ ...vm, status: "ready" }],
    });
    const composer = host.querySelector(".composer") as HTMLDivElement;
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      pasteClipboardText(composer, "line one\nline two\nline three");
    });
    const chip = host.querySelector("[data-testid=composer-paste-chip]") as HTMLElement;
    const rect = {
      x: 10,
      y: 10,
      width: 80,
      height: 16,
      top: 10,
      left: 10,
      right: 90,
      bottom: 26,
      toJSON: () => ({}),
    } as DOMRect;
    chip.getBoundingClientRect = () => rect;
    chip.getClientRects = () => [rect] as unknown as DOMRectList;
    await act(async () => {
      textarea.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 20, clientY: 15, bubbles: true }),
      );
    });
    expect(
      document.querySelector("[data-testid=composer-paste-preview] pre")?.textContent,
    ).toContain("line two");
  });

  it("leaves a short clipboard snippet as typed text", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [{ ...vm, status: "ready" }],
    });
    const composer = host.querySelector(".composer") as HTMLDivElement;
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    let event: Event | undefined;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "Use this");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      event = pasteClipboardText(composer, "fix the button");
    });
    expect(event?.defaultPrevented).toBe(false);
    expect(textarea.value).toBe("Use this");
    expect(host.querySelector("[data-testid=composer-paste-chip]")).toBeNull();
  });

  it("attaches a dropped file in the composer", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [{ ...vm, status: "ready" }],
    });
    const composer = host.querySelector(".composer") as HTMLDivElement;
    const note = new File(["hi"], "note.txt", { type: "text/plain" });
    act(() => {
      dropFiles(composer, [note]);
    });
    expect(host.querySelector(".composer-attach")?.textContent).toContain("note.txt");
  });

  it("restores a per-session composer draft after switching chats", () => {
    const other: AgentSession = { ...session, id: "s2", title: "Other", vmId: "v2" };
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        { ...session, status: "idle" },
        { ...other, status: "idle" },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const box = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "draft for s1");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    rerender({
      ...initialState,
      selectedId: other.id,
      sessions: [
        { ...session, status: "idle" },
        { ...other, status: "idle" },
      ],
      vms: [{ ...vm, id: "v2", sessionId: "s2", status: "ready" }],
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
    rerender({
      ...initialState,
      selectedId: session.id,
      sessions: [
        { ...session, status: "idle" },
        { ...other, status: "idle" },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("draft for s1");
  });

  it("keeps composer typing responsive in a long thread", () => {
    const stamp = "2020-01-01T00:00:00.000Z";
    const longThread = Array.from({ length: 60 }, (_, i) =>
      i % 2 === 0
        ? {
            id: `u${i}`,
            role: "user" as const,
            content: `Please change file ${i}`,
            createdAt: stamp,
          }
        : {
            id: `a${i}`,
            role: "assistant" as const,
            content: [
              `Updated \`src/mod${i}.ts\`.`,
              "",
              "```ts",
              `export const n${i} = ${i};`,
              "```",
            ].join("\n"),
            createdAt: stamp,
          },
    );
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle", messages: longThread }],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelectorAll("[data-msg-id]").length).toBe(60);
    const box = host.querySelector("textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    const started = performance.now();
    act(() => {
      for (let i = 1; i <= 12; i++) {
        setter?.call(box, "next change".slice(0, i));
        box.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(box.value).toBe("next change");
    expect(performance.now() - started).toBeLessThan(400);
  });

  it("windows a long thread so the DOM stays near the viewport", () => {
    const stamp = "2020-01-01T00:00:00.000Z";
    const longThread = Array.from({ length: 200 }, (_, i) =>
      i % 2 === 0
        ? {
            id: `u${i}`,
            role: "user" as const,
            content: `Please change file ${i}`,
            createdAt: stamp,
          }
        : {
            id: `a${i}`,
            role: "assistant" as const,
            content: `Updated file ${i}.`,
            createdAt: stamp,
          },
    );
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle", messages: longThread }],
      vms: [{ ...vm, status: "ready" }],
    });
    const mounted = host.querySelectorAll("[data-msg-id]").length;
    expect(mounted).toBeGreaterThan(8);
    expect(mounted).toBeLessThan(120);
  });

  it("keeps the latest messages painted when scrollTop overshoots the estimated height", () => {
    const stamp = "2020-01-01T00:00:00.000Z";
    const longThread = Array.from({ length: 200 }, (_, i) =>
      i % 2 === 0
        ? {
            id: `u${i}`,
            role: "user" as const,
            content: `Please change file ${i}`,
            createdAt: stamp,
          }
        : {
            id: `a${i}`,
            role: "assistant" as const,
            content: `Updated file ${i}.`,
            createdAt: stamp,
          },
    );
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle", messages: longThread }],
      vms: [{ ...vm, status: "ready" }],
    });
    const pane = host.querySelector(".thread") as HTMLDivElement;
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 80_000 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 800 });
    Object.defineProperty(pane, "scrollTop", {
      configurable: true,
      writable: true,
      value: 79_000,
    });
    act(() => {
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const ids = [...host.querySelectorAll("[data-msg-id]")].map((node) =>
      node.getAttribute("data-msg-id"),
    );
    expect(ids.length).toBeGreaterThan(8);
    expect(ids).toContain("a199");
    expect(ids).not.toContain("u0");
  });

  it("jumps to latest on a long thread instead of snapping to the top", () => {
    const stamp = "2020-01-01T00:00:00.000Z";
    const longThread = Array.from({ length: 200 }, (_, i) =>
      i % 2 === 0
        ? {
            id: `u${i}`,
            role: "user" as const,
            content: `Please change file ${i}`,
            createdAt: stamp,
          }
        : {
            id: `a${i}`,
            role: "assistant" as const,
            content: `Updated file ${i}.`,
            createdAt: stamp,
          },
    );
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle", messages: longThread }],
      vms: [{ ...vm, status: "ready" }],
    });
    const pane = host.querySelector(".thread") as HTMLDivElement;
    const height = 80_000;
    let top = 0;
    Object.defineProperty(pane, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 800 });
    Object.defineProperty(pane, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    act(() => {
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='jump-latest']")).toBeTruthy();
    expect(
      [...host.querySelectorAll("[data-msg-id]")].map((node) => node.getAttribute("data-msg-id")),
    ).toContain("u0");

    act(() => {
      (host.querySelector("[data-testid='jump-latest']") as HTMLButtonElement).click();
    });
    expect(host.querySelector("[data-testid='jump-latest']")).toBeNull();
    const ids = [...host.querySelectorAll("[data-msg-id]")].map((node) =>
      node.getAttribute("data-msg-id"),
    );
    expect(ids.length).toBeGreaterThan(8);
    expect(ids).toContain("a199");
    expect(ids).not.toContain("u0");
    expect(top).toBe(height);
  });

  it("keeps a composer draft when ChatPane unmounts and remounts the same chat", () => {
    const idle = { ...session, status: "idle" as const };
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [idle],
      vms: [{ ...vm, status: "ready" }],
    });
    const box = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "still here after settings");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => root.unmount());
    host.remove();
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [idle],
      vms: [{ ...vm, status: "ready" }],
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "still here after settings",
    );
  });

  it("keeps a composer draft across StrictMode remounts of the same chat", () => {
    const idle = { ...session, status: "idle" as const };
    const tree = (pane: ReactNode) => (
      <StrictMode>
        <Store.Provider
          value={{
            state: {
              ...initialState,
              connected: true,
              selectedId: session.id,
              sessions: [idle],
              vms: [{ ...vm, status: "ready" }],
            },
            dispatch: () => undefined,
          }}
        >
          {pane}
        </Store.Provider>
      </StrictMode>
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(tree(<ChatPane />));
    });
    const box = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "strict remount draft");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => root.render(tree(null)));
    act(() => {
      root.render(tree(<ChatPane />));
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "strict remount draft",
    );
  });

  it("rejects an oversize pasted image", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [{ ...vm, status: "ready" }],
    });
    const composer = host.querySelector(".composer") as HTMLDivElement;
    const oversize = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(oversize, "size", { value: 10 * 1024 * 1024 + 1 });
    act(() => {
      pasteClipboardFiles(composer, [oversize]);
    });
    expect(host.textContent).toMatch(/huge\.png is too large/);
    expect(host.querySelector(".composer-attach")).toBeNull();
  });

  it("inserts a pasted image chip on host chats", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, runtime: "host", status: "idle", vmId: undefined }],
      vms: [],
    });
    const composer = host.querySelector(".composer") as HTMLDivElement;
    const image = new File([new Uint8Array([1])], "clip.png", { type: "image/png" });
    act(() => {
      pasteClipboardFiles(composer, [image]);
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "[[paste:clip.png]] ",
    );
    expect(host.querySelector("[data-testid=composer-paste-chip]")).toBeTruthy();
    expect(host.querySelector(".composer-attach")).toBeNull();
  });

  it("sends a pasted chip in the prompt at the caret", async () => {
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, runtime: "host", status: "idle", vmId: undefined }],
      vms: [],
    });
    const composer = host.querySelector(".composer") as HTMLDivElement;
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    const image = new File([new Uint8Array([1])], "clip.png", { type: "image/png" });
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Look at  please");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      textarea.selectionStart = textarea.selectionEnd = 8;
      pasteClipboardFiles(composer, [image]);
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() => {
        expect(api.chat).toHaveBeenCalled();
      });
    });
    expect(api.chat).toHaveBeenCalledWith(
      "s1",
      "Look at [[paste:clip.png]]  please",
      expect.objectContaining({
        attachments: [expect.objectContaining({ name: "clip.png", mime: "image/png" })],
      }),
    );
  });

  it("chips a pasted attachment inline in the thread instead of a leftover attach row", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Look at clip.png at /workspace/.locus-attachments/clip.png please",
              attachments: [
                { name: "clip.png", mime: "image/png", bytes: 4, storedName: "clip.png" },
              ],
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector(".md-paste-chip")?.textContent).toBe("clip.png");
    expect(host.querySelector(".attach-chips")).toBeNull();
  });

  it("sends host chat attachments with the prompt", async () => {
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, runtime: "host", status: "idle", vmId: undefined }],
      vms: [],
    });
    const composer = host.querySelector(".composer") as HTMLDivElement;
    const note = new File(["hello"], "brief.txt", { type: "text/plain" });
    act(() => {
      dropFiles(composer, [note]);
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Use this");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() => {
        expect(api.chat).toHaveBeenCalled();
      });
    });
    expect(api.chat).toHaveBeenCalledWith(
      "s1",
      "Use this",
      expect.objectContaining({
        attachments: [{ name: "brief.txt", mime: "text/plain", contentBase64: btoa("hello") }],
      }),
    );
  });

  it("toggles vision from the composer", async () => {
    vi.mocked(api.patchSession).mockResolvedValue({ ...session, vision: "off" });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [{ ...vm, status: "ready" }],
    });
    const overflow = host.querySelector(
      '[data-testid="composer-commands"] button',
    ) as HTMLButtonElement;
    expect(overflow).toBeTruthy();
    act(() => overflow.click());
    const vision = [...host.querySelectorAll("[role='menuitem']")].find((el) =>
      el.textContent?.includes("Vision"),
    ) as HTMLButtonElement;
    expect(vision).toBeTruthy();
    expect(vision.textContent).toMatch(/On/);
    await act(async () => {
      vision.click();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", { vision: "off" });
  });

  it("toggles web search from the composer", async () => {
    vi.mocked(api.patchSession).mockResolvedValue({ ...session, webSearch: true });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [{ ...vm, status: "ready" }],
    });
    const overflow = host.querySelector(
      '[data-testid="composer-commands"] button',
    ) as HTMLButtonElement;
    act(() => overflow.click());
    const web = [...host.querySelectorAll("[role='menuitem']")].find((el) =>
      el.textContent?.includes("Web search"),
    ) as HTMLButtonElement;
    expect(web).toBeTruthy();
    expect(web.textContent).toMatch(/Off/);
    await act(async () => {
      web.click();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", { webSearch: true });
  });

  it("toggles live Chrome from the composer on host chats", async () => {
    vi.mocked(api.patchSession).mockResolvedValue({
      ...session,
      runtime: "host",
      liveChrome: true,
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, runtime: "host", status: "idle", vmId: undefined }],
      vms: [],
    });
    const overflow = host.querySelector(
      '[data-testid="composer-commands"] button',
    ) as HTMLButtonElement;
    act(() => overflow.click());
    const chrome = [...host.querySelectorAll("[role='menuitem']")].find((el) =>
      el.textContent?.includes("Use my Chrome"),
    ) as HTMLButtonElement;
    expect(chrome).toBeTruthy();
    expect(chrome.textContent).toMatch(/Off/);
    await act(async () => {
      chrome.click();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", { liveChrome: true });
  });

  it("patches the default subagent from the composer picker", async () => {
    vi.mocked(api.patchSession).mockResolvedValue({ ...session, defaultSubagent: "review" });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [{ ...vm, status: "ready" }],
    });
    const picker = host.querySelector("[aria-label='Default subagent']") as HTMLElement;
    expect(host.querySelector(".ui-select-value")?.textContent).toMatch(/Explore/i);
    await act(async () => {
      picker.click();
    });
    const review = [...host.querySelectorAll("[role='menuitem']")].find((el) =>
      el.textContent?.includes("Review"),
    );
    await act(async () => {
      review?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", { defaultSubagent: "review" });
  });

  it("hides the default subagent picker on Design chats", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, kind: "design", runtime: "docker", status: "idle" }],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    expect(host.querySelector("[aria-label='Default subagent']")).toBeNull();
  });

  it("keeps vision on Docker agents and hides it on Design", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, runtime: "docker", dockerImage: "ubuntu:24.04", status: "idle" }],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    expect(host.querySelector("[data-testid='composer-commands']")).toBeTruthy();
    expect(host.querySelector(".vision-toggle")).toBeNull();
    expect(host.querySelector(".websearch-toggle")).toBeNull();
    act(() => root.unmount());
    host.remove();
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, kind: "design", runtime: "docker", status: "idle" }],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    expect(host.querySelector(".vision-toggle")).toBeNull();
    expect(host.querySelector(".websearch-toggle")).toBeNull();
  });

  it("hides guest chrome on host chats", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, runtime: "host", status: "idle", vmId: undefined }],
      vms: [],
    });
    expect(host.textContent).toContain("This chat can read and edit files on this machine");
    expect(host.querySelector(".vision-toggle")).toBeNull();
    expect(host.querySelector(".composer-add")).toBeTruthy();
    expect(host.querySelector(".websearch-toggle")).toBeNull();
    expect(host.querySelector(".chat-runtime-badge")?.textContent).toBe("This machine");
  });

  it("lays out the composer with model and Send on the footer", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          model: "x-preview-f-free",
          usage: { inputTokens: 7484, outputTokens: 400 },
        },
      ],
      vms: [{ ...vm, status: "ready" }],
      config: {
        ...skillsConfig,
        providers: [
          {
            id: "p",
            name: "OpenCode",
            kind: "opencode",
            baseUrl: "https://opencode.ai/zen/v1",
            models: ["x-preview-f-free"],
            defaultModel: "x-preview-f-free",
            enabled: true,
            extraHeaders: {},
          },
        ],
      },
    });
    expect(host.querySelector(".composer-bar .model-picker")).toBeTruthy();
    expect(host.querySelector(".model-picker-combined.on")).toBeTruthy();
    expect(host.querySelector(".model-cost-chip")).toBeNull();
    expect(host.querySelector("[aria-label='Context usage']")).toBeNull();
    expect(host.querySelector(".composer-meta")?.textContent).toMatch(/7,484 in · 400 out · \$0/);
    expect(host.querySelector(".composer-add")).toBeTruthy();
    expect(host.querySelector("[data-testid='composer-commands']")).toBeTruthy();
    expect(
      host.querySelector("[data-testid='composer-commands'] summary")?.getAttribute("aria-label"),
    ).toBe("Commands");
    expect(host.querySelector(".composer-send")?.textContent).toMatch(/Send/);
    expect(host.querySelector(".composer-send .composer-send-label")?.textContent).toBe("Send");
    expect(host.querySelector(".composer-head .model-picker")).toBeNull();
    expect(host.querySelector("[aria-label='Repository']")).toBeNull();
  });

  it("hides the demo provider badge while setting Codex reasoning effort", async () => {
    const codexSession = {
      ...session,
      providerId: "codex-cli",
      model: "gpt-5.5",
      reasoningEffort: "high" as const,
      runtime: "host" as const,
      status: "idle" as const,
      vmId: undefined,
    };
    const codexProvider = {
      id: "codex-cli",
      name: "Codex CLI",
      kind: "codex-cli" as const,
      baseUrl: "codex-cli://local",
      models: ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"],
      defaultModel: "gpt-6-astra",
      enabled: true,
      extraHeaders: {},
    };
    vi.mocked(api.patchSession).mockImplementation(async (_id, patch) => ({
      ...codexSession,
      reasoningEffort: patch.reasoningEffort === null ? undefined : patch.reasoningEffort,
    }));
    render({
      ...initialState,
      selectedId: codexSession.id,
      sessions: [codexSession],
      vms: [],
      config: { ...skillsConfig, providers: [codexProvider] },
    });
    expect(host.querySelector(".demo-chip")).toBeNull();

    await act(async () => {
      (host.querySelector('[aria-label="Model options"]') as HTMLElement).click();
    });
    const xhigh = [...host.querySelectorAll(".model-picker-more [role='menuitem']")].find(
      (item) => item.textContent === "XHigh",
    ) as HTMLButtonElement;
    expect(xhigh).toBeTruthy();
    await act(async () => {
      xhigh.click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", { reasoningEffort: "xhigh" });
  });

  it("collapses the composer footer when the pane is narrower than the controls", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.composer \{[\s\S]*?container-type:\s*inline-size/);
    expect(css).toMatch(/\.composer \{[\s\S]*?container-name:\s*composer/);
    expect(css).toMatch(/\.empty-composer \{[\s\S]*?container-type:\s*inline-size/);
    expect(css).toMatch(/\.composer-bar \{[\s\S]*?flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.composer-actions \{[\s\S]*?flex:\s*1 1 12\.5rem/);
    expect(css).toMatch(
      /@container composer \(max-width: 560px\) \{[\s\S]*?\.composer-actions,[\s\S]*?flex:\s*1 1 100%/,
    );
    expect(css).toMatch(
      /@container composer \(max-width: 560px\) \{[\s\S]*?\.composer-send-label \{[\s\S]*?display:\s*none/,
    );
    expect(css).toMatch(
      /\.model-picker\.compact \.model-picker-provider \{[\s\S]*?overflow:\s*hidden/,
    );
    expect(css).toMatch(
      /\.model-picker\.compact \.model-picker-provider select \{[\s\S]*?min-width:\s*0/,
    );
    expect(css).toMatch(/\.model-picker\.compact > select \{[\s\S]*?flex:\s*1 1 6rem/);
    expect(css).toMatch(
      /\.composer-actions \.model-picker\.compact \.model-picker-provider,[\s\S]*?width:\s*0/,
    );
  });

  it("keeps the chat thread compact so more transcript fits on screen", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    expect(css).toMatch(/:root,[\s\S]*?--chat-thread-pad: 16px 20px 8px;/);
    expect(css).toMatch(/:root,[\s\S]*?--chat-font: 14px;/);
    expect(css).toMatch(/\.thread \{[\s\S]*?padding: var\(--chat-thread-pad\)/);
    expect(css).toMatch(/\.thread \{[\s\S]*?scrollbar-width:\s*none/);
    expect(css).toMatch(/\.thread-scroll-thumb \{[\s\S]*?repeating-linear-gradient/);
    expect(css).toMatch(/\.thread-scroll-current \{[\s\S]*?width:\s*11px/);
    expect(css).toMatch(/\.msg \.bubble \{[\s\S]*?font-size: var\(--chat-font\)/);
    expect(css).toMatch(/\.composer textarea \{[\s\S]*?min-height: var\(--chat-composer-min\)/);
    expect(css).toMatch(
      /\[data-chat-density="comfortable"\][\s\S]*?--chat-thread-pad: 28px 28px 12px;/,
    );
    expect(css).toMatch(/\[data-chat-density="comfortable"\][\s\S]*?--chat-font: 14\.5px;/);
    expect(css).toMatch(/\[data-chat-density="dense"\][\s\S]*?--chat-font: 12px;/);
    expect(css).toMatch(/\[data-chat-density="dense"\][\s\S]*?--chat-msg-gap: 8px;/);
    const phone = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../styles/phone.css"),
      "utf8",
    );
    expect(phone).toMatch(/\.mobile-thread \{[\s\S]*?padding: var\(--chat-mobile-thread-pad\)/);
  });

  it("lets developer thinking snippets fill the message column", () => {
    render({ ...initialState, selectedId: session.id, sessions: [session] });
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.bubble\.working \{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.working-copy \{[^}]*flex:\s*1 1 auto/);
    expect(css).toMatch(/\.working-thought \{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.working-thought \{[^}]*max-width:\s*100%/);
    expect(css).toMatch(/\.working-thought \{[^}]*-webkit-line-clamp:\s*3/);
    expect(css).toMatch(
      /\[data-product-mode="swarm"\][\s\S]*?\.working-thought \{[^}]*max-width:\s*46ch/,
    );
    expect(css).toMatch(
      /\[data-product-mode="swarm"\][\s\S]*?\.working-thought \{[^}]*-webkit-line-clamp:\s*2/,
    );
  });

  it("includes worker VM spend in the usage hint", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          placement: "worker",
          backendId: "w1",
          computeMs: 3_600_000,
          usage: { inputTokens: 7484, outputTokens: 400 },
        },
      ],
      vms: [{ ...vm, status: "ready" }],
      config: {
        ...skillsConfig,
        workers: [
          {
            id: "w1",
            name: "Box",
            url: "http://127.0.0.1:7421",
            hourlyUsd: 0.12,
          },
        ],
        providers: [
          {
            id: "p",
            name: "OpenCode",
            kind: "opencode",
            baseUrl: "https://opencode.ai/zen/v1",
            models: ["x-preview-f-free"],
            defaultModel: "x-preview-f-free",
            enabled: true,
            extraHeaders: {},
          },
        ],
      },
    });
    expect(host.querySelector(".composer-meta")?.textContent).toMatch(/\$0\.12 VM/);
  });

  it("opens a context breakdown from the composer chip", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          model: "x-preview-f-free",
          context: {
            window: 128_000,
            used: 12_400,
            reserved: 32_768,
            charsPerToken: 4,
            measured: true,
            parts: [
              { id: "system", label: "System prompt", tokens: 2_100 },
              { id: "tools", label: "Tools", tokens: 4_000 },
              { id: "rules", label: "Rules", tokens: 181 },
              { id: "skills", label: "Skills", tokens: 800 },
              { id: "conversation", label: "Conversation", tokens: 5_319 },
            ],
          },
        },
      ],
      vms: [{ ...vm, status: "ready" }],
      config: skillsConfig,
    });
    const chip = host.querySelector("[aria-label='Context usage']");
    expect(chip?.textContent).toMatch(/10% context/);
    expect(host.querySelector("[aria-label='Context breakdown']")).toBeNull();
    act(() => {
      (chip as HTMLButtonElement).click();
    });
    const pop = host.querySelector("[aria-label='Context breakdown']");
    expect(pop?.textContent).toMatch(/10% Full/);
    expect(pop?.textContent).toMatch(/12\.4k \/ 128k/);
    expect(pop?.textContent).toMatch(/System prompt/);
    expect(pop?.textContent).toMatch(/Tools/);
    expect(pop?.textContent).toMatch(/Rules/);
    expect(pop?.textContent).toMatch(/Skills/);
    expect(pop?.textContent).toMatch(/Conversation/);
    expect(pop?.textContent).not.toMatch(/Reserved output/);
    expect(pop?.querySelector(".context-meter-swatch")).toBeTruthy();
    expect(host.querySelector(".context-meter.up")).toBeTruthy();
    expect(pop?.classList.contains("placed")).toBe(true);
  });

  it("shows Cursor CLI occupancy on the context chip", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          model: "composer-2",
          context: {
            window: 200_000,
            used: 20_000,
            reserved: 0,
            charsPerToken: 4,
            measured: true,
            cachedInputTokens: 4100,
            parts: [{ id: "conversation", label: "Conversation", tokens: 20_000 }],
          },
        },
      ],
      vms: [{ ...vm, status: "ready" }],
      config: {
        ...skillsConfig,
        providers: [
          {
            id: "p",
            name: "Cursor CLI",
            kind: "cursor-cli",
            baseUrl: "cursor-cli://local",
            models: ["composer-2"],
            defaultModel: "composer-2",
            enabled: true,
            extraHeaders: {},
          },
        ],
      },
    });
    expect(host.querySelector("[aria-label='Context usage']")?.textContent).toMatch(/10% context/);
  });

  it("hides the context meter in Swarm", () => {
    render({
      ...initialState,
      selectedId: session.id,
      config: { ...skillsConfig, productMode: "swarm" },
      sessions: [
        {
          ...session,
          surface: "swarm",
          status: "idle",
          model: "x-preview-f-free",
          context: {
            window: 128_000,
            used: 12_400,
            reserved: 32_768,
            charsPerToken: 4,
            measured: true,
            parts: [{ id: "conversation", label: "Conversation", tokens: 12_400 }],
          },
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[aria-label='Context usage']")).toBeNull();
    expect(host.querySelector(".context-meter")).toBeNull();
    expect(host.textContent).not.toMatch(/% context/);
  });

  it("renders apply_patch and git_diff as inline diff cards", () => {
    const patch = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n";
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
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
                  name: "apply_patch",
                  arguments: { patch },
                  result: "updated src/app.ts",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
            {
              id: "t1",
              role: "tool",
              content: patch,
              createdAt: "2020-01-01T00:00:01.000Z",
              toolCalls: [
                {
                  id: "c2",
                  name: "git_diff",
                  arguments: {},
                  result: patch,
                  startedAt: "2020-01-01T00:00:01.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const cards = host.querySelectorAll("[data-testid='patch-card']");
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector(".patch-path-name")?.textContent).toBe("app.ts");
    expect(host.querySelector(".patch-file")?.classList.contains("collapsed")).toBe(true);
    expect(host.querySelector(".patch-hunk")).toBeNull();
    act(() => {
      (host.querySelector(".patch-file-toggle") as HTMLButtonElement).click();
    });
    expect(host.querySelector(".patch-line.add")?.textContent).toContain("new");
  });

  it("collapses exec output into a one-line chip", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
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
                  name: "exec",
                  arguments: { command: "npm test" },
                  result: "fail\n(exit 1)",
                  error: "fail\n(exit 1)",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='tool-activity'] summary")?.textContent).toMatch(
      /Ran npm test/,
    );
    expect(host.querySelector("[data-testid='tool-activity']")?.hasAttribute("open")).toBe(false);
    expect(host.querySelector(".tool-chip summary")?.textContent).toMatch(
      /exec · npm test · exit 1/,
    );
    expect(host.querySelector(".tool-chip")?.hasAttribute("open")).toBe(false);
    expect(host.querySelector(".tool-chip pre")?.textContent).toContain("(exit 1)");
    expect(host.textContent).not.toMatch(/Tool · exec/);
  });

  it("folds a finished exec under the agent step instead of a Tool header", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
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
                  name: "exec",
                  arguments: { command: "git show develop:app/batch/test.py" },
                  result: "ok",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
            {
              id: "t1",
              role: "tool",
              toolCallId: "c1",
              content: "ok",
              createdAt: "2020-01-01T00:00:01.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "exec",
                  arguments: { command: "git show develop:app/batch/test.py" },
                  result: "ok",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelectorAll(".msg").length).toBe(1);
    expect(host.textContent).not.toMatch(/Tool · exec/);
    expect(host.querySelector("[data-testid='tool-activity'] summary")?.textContent).toMatch(
      /Read test.py/,
    );
    expect(host.querySelector("[data-testid='tool-activity']")?.hasAttribute("open")).toBe(false);
    expect(host.querySelector(".tool-chip summary")?.textContent).toMatch(/exec · git show/);
    expect(host.querySelector(".tool-chip pre")?.textContent).toContain("ok");
  });

  it("renders the session task list instead of a task_list tool chip", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          taskList: [
            { id: "t1", text: "Inspect the workspace", status: "done" },
            { id: "t2", text: "Patch the scanner", status: "in_progress" },
          ],
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: "Working through the list.",
              createdAt: "2020-01-01T00:00:00.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "task_list",
                  arguments: { action: "add", text: "Patch the scanner" },
                  result:
                    "- [done] t1: Inspect the workspace\n- [in_progress] t2: Patch the scanner",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='task-list']")?.textContent).toMatch(/1 of 2 Done/);
    expect(host.textContent).toContain("Patch the scanner");
    expect(host.querySelector("[data-testid='tool-activity']")).toBeNull();
    expect(host.textContent).not.toMatch(/Updated the task list/);
  });

  it("renders a plan card for Cursor createPlan instead of plan-protocol chips", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          plan: {
            phase: "proposed",
            items: [
              { id: "p1", text: "Rewrite scripts/build-iso.sh", status: "pending" },
              { id: "p2", text: "Convert package lists to Ubuntu names", status: "pending" },
            ],
          },
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: "Drafted the Ubuntu 26.04.1 ISO plan.",
              createdAt: "2020-01-01T00:00:00.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "switchMode",
                  arguments: { targetModeId: "plan" },
                  result: '{"fromModeId":"","toModeId":"plan"}',
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
                {
                  id: "c2",
                  name: "createPlan",
                  arguments: { name: "Ubuntu 26.04 ISO" },
                  result: "{}",
                  startedAt: "2020-01-01T00:00:01.000Z",
                  finishedAt: "2020-01-01T00:00:02.000Z",
                },
                {
                  id: "c3",
                  name: "ask_user",
                  arguments: { question: "Ubuntu 26.04.1 base — scope" },
                  result: '{"rejected":{"reason":"Questions skipped by the user"}}',
                  startedAt: "2020-01-01T00:00:00.500Z",
                  finishedAt: "2020-01-01T00:00:00.520Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='plan-card']")).toBeTruthy();
    expect(
      [...host.querySelectorAll("[data-testid='plan-card'] input[type='text']")].map(
        (input) => (input as HTMLInputElement).value,
      ),
    ).toEqual(["Rewrite scripts/build-iso.sh", "Convert package lists to Ubuntu names"]);
    expect(host.textContent).toContain("Ubuntu 26.04.1 base — scope");
    expect(host.textContent).not.toMatch(/plan · Ubuntu 26.04 ISO/);
    expect(host.textContent).not.toMatch(/plan mode/);
  });

  it("shows a subscription card and removes a live subscription", async () => {
    vi.mocked(api.patchSession).mockResolvedValue({
      ...session,
      subscriptions: [],
    });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          subscriptions: [
            {
              id: "sub1",
              kind: "slack_channel",
              title: "#eng",
              createdAt: "2026-08-29T12:00:00.000Z",
              channelId: "C1",
            },
          ],
          messages: [
            {
              id: "u1",
              role: "user",
              content: "watch #eng",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='subscription-card']")?.textContent).toMatch(/#eng/);
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='subscription-remove-sub1']")?.click();
    });
    expect(api.patchSession).toHaveBeenCalledWith(session.id, { subscriptions: null });
  });

  it("keeps the live agent row above the session task list", () => {
    const tasks = [
      { id: "t1", text: "Inspect the workspace", status: "pending" as const },
      { id: "t2", text: "Patch the scanner", status: "pending" as const },
    ];
    const user = {
      id: "u1",
      role: "user" as const,
      content: "keep going",
      createdAt: "2020-01-01T00:00:00.000Z",
    };
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "running",
          taskList: tasks,
          messages: [user],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expectBefore(
      host.querySelector("[data-testid='agent-working']"),
      host.querySelector("[data-testid='task-list']"),
    );

    rerender({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "running",
          taskList: tasks,
          messages: [
            user,
            { id: "a1", role: "assistant", content: "", createdAt: "2020-01-01T00:00:01.000Z" },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expectBefore(
      host.querySelector("[data-testid='agent-working']"),
      host.querySelector("[data-testid='task-list']"),
    );

    rerender({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "running",
          taskList: tasks,
          messages: [
            user,
            {
              id: "a1",
              role: "assistant",
              content: "Next I will patch the scanner.",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='agent-working']")).toBeNull();
    expectBefore(
      host.querySelector(".msg.assistant"),
      host.querySelector("[data-testid='task-list']"),
    );
    expect(host.textContent).toContain("Next I will patch the scanner.");
  });

  it("keeps agent commentary visible and hides the raw command until the step is expanded", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: "Checking how chat renders tool calls.",
              createdAt: "2020-01-01T00:00:00.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "exec",
                  arguments: { command: 'cd /workspace && grep -n "cors" apps/server/src/app.ts' },
                  result: "apps/server/src/app.ts:10:cors",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
            {
              id: "t1",
              role: "tool",
              toolCallId: "c1",
              content: "apps/server/src/app.ts:10:cors",
              createdAt: "2020-01-01T00:00:01.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "exec",
                  arguments: { command: 'cd /workspace && grep -n "cors" apps/server/src/app.ts' },
                  result: "apps/server/src/app.ts:10:cors",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector(".bubble")?.textContent).toContain(
      "Checking how chat renders tool calls.",
    );
    const activity = host.querySelector(
      "[data-testid='tool-activity']",
    ) as HTMLDetailsElement | null;
    expect(activity?.open).toBe(false);
    expect(activity?.querySelector("summary")?.textContent).toMatch(/Grepped cors/);
    expect(activity?.querySelector("summary")?.textContent).not.toMatch(/cd \/workspace/);
    act(() => {
      activity!.querySelector("summary")!.click();
    });
    expect(activity?.open).toBe(true);
    expect(host.querySelector(".tool-chip summary")?.textContent).toMatch(/cd \/workspace && grep/);
  });

  it("hides review verdict JSON from the assistant bubble", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          kind: "review",
          messages: [
            {
              id: "a1",
              role: "assistant",
              content:
                'Prior Mediums look addressed. I’ll post that on the hunk.{"verdict":"FAIL","reasons":["Failed Dramatiq jobs take onComplete"],"risk":"low"}',
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const bubble = host.querySelector(".bubble")?.textContent ?? "";
    expect(bubble).toContain("Prior Mediums look addressed");
    expect(bubble).not.toContain('"verdict"');
    expect(bubble).not.toContain("Failed Dramatiq jobs take onComplete");
  });

  it("hides a dumped HTML page from the assistant bubble", () => {
    const page = `<!DOCTYPE html>\n<html lang="en"><head><title>Harbor</title></head><body><h1>${"Harbor".repeat(40)}</h1></body></html>`;
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          kind: "design",
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: page,
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const bubble = host.querySelector(".bubble")?.textContent ?? "";
    expect(bubble).not.toContain("Harbor");
    expect(bubble).not.toContain("<!DOCTYPE");
  });

  it("groups batched execs into one exploring summary", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
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
                  name: "exec",
                  arguments: { commands: ["cat a", "cat b", "cat c", "cat d"] },
                  result: "ok",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
                {
                  id: "c2",
                  name: "exec",
                  arguments: { commands: ["ls", "pwd", "git status"] },
                  result: "ok",
                  startedAt: "2020-01-01T00:00:01.000Z",
                  finishedAt: "2020-01-01T00:00:02.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const rows = [...host.querySelectorAll(".tool-activity-label")].map((el) => el.textContent);
    expect(rows).toEqual(["Explored 4 files, ran 3 commands"]);
    expect(host.querySelectorAll(".tool-chip").length).toBe(2);
  });

  it("groups mixed tools into one exploring summary instead of separate rows", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
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
                  name: "exec",
                  arguments: { command: "cat package.json" },
                  result: "ok",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
                {
                  id: "c2",
                  name: "git_status",
                  arguments: {},
                  result: "clean",
                  startedAt: "2020-01-01T00:00:01.000Z",
                  finishedAt: "2020-01-01T00:00:02.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const rows = [...host.querySelectorAll(".tool-activity-label")].map((el) => el.textContent);
    expect(rows).toEqual(["Explored 1 file, ran 1 command"]);
    expect(rows.some((text) => text?.includes(" · "))).toBe(false);
    expect(host.querySelectorAll(".tool-chip").length).toBe(2);
  });

  it("groups a mixed turn into one exploring summary instead of one giant step count", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
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
                  arguments: { path: "a.ts" },
                  result: "ok",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
                {
                  id: "c2",
                  name: "file_read",
                  arguments: { path: "b.ts" },
                  result: "ok",
                  startedAt: "2020-01-01T00:00:01.000Z",
                  finishedAt: "2020-01-01T00:00:02.000Z",
                },
                {
                  id: "c3",
                  name: "file_read",
                  arguments: { path: "c.ts" },
                  result: "ok",
                  startedAt: "2020-01-01T00:00:02.000Z",
                  finishedAt: "2020-01-01T00:00:03.000Z",
                },
                {
                  id: "c4",
                  name: "file_read",
                  arguments: { path: "d.ts" },
                  result: "ok",
                  startedAt: "2020-01-01T00:00:03.000Z",
                  finishedAt: "2020-01-01T00:00:04.000Z",
                },
                {
                  id: "c5",
                  name: "grep",
                  arguments: { pattern: "cors" },
                  result: "hit",
                  startedAt: "2020-01-01T00:00:04.000Z",
                  finishedAt: "2020-01-01T00:00:05.000Z",
                },
                {
                  id: "c6",
                  name: "exec",
                  arguments: { command: "npm test" },
                  result: "ok",
                  startedAt: "2020-01-01T00:00:05.000Z",
                  finishedAt: "2020-01-01T00:00:06.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const rows = [...host.querySelectorAll(".tool-activity-label")].map((el) => el.textContent);
    expect(rows).toEqual(["Explored 4 files, 1 search, ran 1 command"]);
    expect(rows.some((text) => text?.match(/\d+ steps/))).toBe(false);
    expect(host.querySelectorAll(".tool-chip").length).toBe(6);
  });

  it("folds a long same-kind batch into one exploring summary", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: "",
              createdAt: "2020-01-01T00:00:00.000Z",
              toolCalls: Array.from({ length: 16 }, (_, index) => ({
                id: `c${index}`,
                name: "file_read",
                arguments: { path: `f${index}.ts` },
                result: "ok",
                startedAt: "2020-01-01T00:00:00.000Z",
                finishedAt: "2020-01-01T00:00:01.000Z",
              })),
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const rows = [...host.querySelectorAll(".tool-activity-label")].map((el) => el.textContent);
    expect(rows).toEqual(["Explored 16 files"]);
    expect(host.querySelectorAll(".tool-chip").length).toBe(16);
  });

  it("shows guest screenshots as a compact card with a thumbnail", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            {
              id: "t1",
              role: "tool",
              content: "focused Firefox",
              screenshotName: "t1.png",
              createdAt: "2020-01-01T00:00:00.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "window_focus",
                  arguments: { title: "Firefox" },
                  result: "focused Firefox",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const card = host.querySelector("[data-testid='shot-card']") as HTMLDetailsElement | null;
    expect(card).toBeTruthy();
    expect(card?.open).toBe(false);
    expect(host.querySelector(".shot-card-thumb img")?.getAttribute("src")).toBe(
      "/api/sessions/s1/screenshots/t1.png",
    );
    expect(host.querySelector(".bubble-shot")).toBeNull();
    expect(host.querySelector(".tool-trace")).toBeNull();
    expect(card?.textContent).toContain("window_focus");
    expect(card?.textContent).toContain("done");
    act(() => {
      card!.querySelector("summary")!.click();
    });
    expect(card?.open).toBe(true);
    expect(host.querySelector(".shot-card-full")?.getAttribute("src")).toBe(
      "/api/sessions/s1/screenshots/t1.png",
    );
    expect(host.querySelector(".shot-card pre")?.textContent).toContain("focused Firefox");
    act(() => {
      (host.querySelector(".shot-card-open") as HTMLButtonElement).click();
    });
    expect(host.querySelector("[data-testid='media-lightbox']")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector("[data-testid='media-lightbox']")).toBeNull();
  });

  it("shows live playwright screenshots as a shot card in the thread", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
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
                  name: "playwright",
                  arguments: { click: "#btn-deploy" },
                  result:
                    "Playwright desktop 1280×800 (live)\nok  click #btn-deploy\nscreenshot captured",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
            {
              id: "t1",
              role: "tool",
              toolCallId: "c1",
              content:
                "Playwright desktop 1280×800 (live)\nok  click #btn-deploy\nscreenshot captured",
              screenshotName: "t1.png",
              createdAt: "2020-01-01T00:00:01.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "playwright",
                  arguments: { click: "#btn-deploy" },
                  result:
                    "Playwright desktop 1280×800 (live)\nok  click #btn-deploy\nscreenshot captured",
                  startedAt: "2020-01-01T00:00:00.000Z",
                  finishedAt: "2020-01-01T00:00:01.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const card = host.querySelector("[data-testid='shot-card']") as HTMLDetailsElement | null;
    expect(card).toBeTruthy();
    expect(host.querySelector(".shot-card-thumb img")?.getAttribute("src")).toBe(
      "/api/sessions/s1/screenshots/t1.png",
    );
    expect(card?.textContent).toContain("playwright");
  });

  it("shows MCP arguments while waiting for approval", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "running",
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: "",
              createdAt: "2020-01-01T00:00:00.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "mcp_github_create_issue",
                  arguments: { title: "Boot hang" },
                  result: "diff --git a/README.md b/README.md\n+x\n",
                  approval: "needed",
                  startedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector(".tool-chip")?.getAttribute("open")).not.toBe(null);
    expect(host.querySelector(".tool-chip pre")?.textContent).toContain("Boot hang");
  });

  it("shows ask_user choices instead of Approve / Deny", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "running",
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: "",
              createdAt: "2020-01-01T00:00:00.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "ask_user",
                  arguments: { question: "Ship the patch?", choices: ["Yes", "No"] },
                  approval: "needed",
                  startedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.textContent).toContain("Ship the patch?");
    expect(host.textContent).toContain("Yes");
    expect(host.textContent).not.toContain("Approve");
    expect(host.querySelector(".tool-chip pre")).toBeNull();
    expect(host.querySelector("[data-testid='ask-user']")).not.toBeNull();
  });

  it("collects a series of ask_user answers before sending", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "running",
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: "",
              createdAt: "2020-01-01T00:00:00.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "ask_user",
                  arguments: {
                    question: "A few details before the first draft",
                    questions: [
                      { question: "Who is this for?", choices: ["Founders", "Consumers"] },
                      { question: "Primary goal?", choices: ["Signups", "Explain"] },
                    ],
                  },
                  approval: "needed",
                  startedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.textContent).toContain("A few details before the first draft");
    expect(host.textContent).toContain("Who is this for?");
    expect(host.textContent).toContain("Primary goal?");
    expect(host.textContent).toContain("Continue");
    expect(host.textContent).not.toContain("Approve");
    const founders = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Founders"),
    ) as HTMLButtonElement;
    const signups = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Signups"),
    ) as HTMLButtonElement;
    act(() => {
      founders.click();
    });
    expect(api.resolveApproval).not.toHaveBeenCalled();
    act(() => {
      signups.click();
    });
    const cont = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Continue"),
    ) as HTMLButtonElement;
    expect(cont.disabled).toBe(false);
    act(() => {
      cont.click();
    });
    expect(api.resolveApproval).toHaveBeenCalledWith(
      session.id,
      "c1",
      "approved",
      expect.stringMatching(/Founders[\s\S]*Signups/),
    );
  });

  it("renders nested ask_user JSON as questions instead of a stringified dump", () => {
    const inner = {
      question:
        "Before I design the page, a few details so the copy and layout actually match Harbor.",
      questions: [
        {
          question: "What is Harbor?",
          choices: ["A product I'm building", "A brand/company I run", "A client/project"],
          allowFreeText: true,
        },
        {
          question: "Who is the page for – the main audience reading it?",
          choices: ["Customers", "Investors", "Hire candidates"],
          allowFreeText: true,
        },
      ],
    };
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "running",
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: "",
              createdAt: "2020-01-01T00:00:00.000Z",
              toolCalls: [
                {
                  id: "c1",
                  name: "ask_user",
                  arguments: { ask_user: JSON.stringify(inner) },
                  approval: "needed",
                  startedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const card = host.querySelector("[data-testid='ask-user']");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("What is Harbor?");
    expect(card?.textContent).toContain("A product I'm building");
    expect(card?.textContent).toContain("Who is the page for");
    expect(host.querySelector(".ask-user-bar, .ask-user-input")).not.toBeNull();
    expect(host.querySelector(".tool-chip pre")).toBeNull();
    expect(host.textContent).not.toContain('\\"question\\"');
    expect(host.textContent).not.toMatch(/\{\s*"ask_user"/);
  });

  it("lists Plan, Web search, Vision, Undo, Fork, and Clear from the composer commands overflow", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle" }],
      vms: [{ ...vm, status: "ready" }],
    });
    const trigger = host.querySelector("[data-testid='composer-commands'] summary") as HTMLElement;
    expect(trigger.getAttribute("aria-label")).toBe("Commands");
    expect(host.querySelector("[data-testid='slash-menu']")).toBeNull();
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    const menu = host.querySelector("[data-testid='composer-commands'] [role='menu']");
    expect(menu?.textContent).toContain("/plan");
    expect(menu?.textContent).toContain("Plan");
    expect(menu?.textContent).toContain("/websearch");
    expect(menu?.textContent).toContain("Web search");
    expect(menu?.textContent).toContain("/vision");
    expect(menu?.textContent).toContain("Vision");
    expect(menu?.textContent).toContain("/undo");
    expect(menu?.textContent).toContain("/fork");
    expect(menu?.textContent).toContain("/clear");
    expect(menu?.textContent).toContain("Clear chat");
    expect(menu?.textContent).toMatch(/Type \/ for more/);
    expect(host.querySelector(".vision-toggle")).toBeNull();
    expect(host.querySelector(".websearch-toggle")).toBeNull();
    expect(host.querySelector(".checkpoint-select")).toBeNull();
    expect(
      [...host.querySelectorAll(".composer-actions button")].some((btn) =>
        /^Undo\b/.test(btn.textContent ?? ""),
      ),
    ).toBe(false);
  });

  it("runs overflow Plan, Web search, Vision, Undo, and Fork with the slash handlers", async () => {
    vi.mocked(api.patchSession).mockImplementation(async (_id, patch) => ({
      ...session,
      status: "idle",
      vision: patch.vision ?? session.vision,
      webSearch: patch.webSearch ?? session.webSearch,
    }));
    vi.mocked(api.rewind).mockResolvedValue({ ...session, status: "idle" });
    vi.mocked(api.fork).mockResolvedValue({ ...session, id: "s2", title: "Forked" });
    const dispatch = vi.fn();
    render(
      {
        ...initialState,
        selectedId: session.id,
        sessions: [{ ...session, status: "idle" }],
        vms: [{ ...vm, status: "ready" }],
      },
      dispatch,
    );
    function openOverflow() {
      const trigger = host.querySelector(
        "[data-testid='composer-commands'] summary",
      ) as HTMLElement;
      act(() => {
        trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        trigger.click();
      });
    }
    function pick(slash: string) {
      return [...host.querySelectorAll("[data-testid='composer-commands'] .menu-item")].find(
        (btn) => btn.textContent?.includes(slash),
      ) as HTMLButtonElement;
    }
    async function confirmModal(label: string) {
      const btn = [...host.querySelectorAll("[data-testid='confirm-modal'] button")].find(
        (item) => item.textContent === label,
      ) as HTMLButtonElement | undefined;
      expect(btn).toBeTruthy();
      await act(async () => {
        btn!.click();
        await Promise.resolve();
      });
    }

    openOverflow();
    await act(async () => {
      pick("/plan").click();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='plan-arm']")).toBeTruthy();
    expect(api.chat).not.toHaveBeenCalled();

    openOverflow();
    await act(async () => {
      pick("/websearch").click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", { webSearch: true });

    openOverflow();
    await act(async () => {
      pick("/vision").click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", { vision: "off" });

    openOverflow();
    await act(async () => {
      pick("/undo").click();
      await Promise.resolve();
    });
    await confirmModal("Rewind");
    expect(api.rewind).toHaveBeenCalledWith("s1", undefined);

    openOverflow();
    await act(async () => {
      pick("/fork").click();
      await Promise.resolve();
    });
    expect(api.fork).toHaveBeenCalledWith("s1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "session",
      session: expect.objectContaining({ id: "s2" }),
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "s2" });
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("lists older rewind turns in the composer overflow instead of a dropdown", async () => {
    vi.mocked(api.rewind).mockResolvedValue({ ...session, status: "idle" });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          checkpoints: [
            { id: "cp0", messageCount: 0, createdAt: "2020-01-01T00:00:00.000Z" },
            { id: "cp1", messageCount: 2, createdAt: "2020-01-01T00:01:00.000Z" },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector(".checkpoint-select")).toBeNull();
    const trigger = host.querySelector("[data-testid='composer-commands'] summary") as HTMLElement;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    const menu = host.querySelector("[data-testid='composer-commands'] [role='menu']");
    expect(menu?.textContent).toContain("/undo");
    expect(menu?.textContent).toContain("Turn -1");
    const older = [...host.querySelectorAll("[data-testid='composer-commands'] .menu-item")].find(
      (btn) => btn.textContent?.includes("Turn -1"),
    ) as HTMLButtonElement;
    await act(async () => {
      older.click();
      await Promise.resolve();
    });
    const rewindBtn = [...host.querySelectorAll("[data-testid='confirm-modal'] button")].find(
      (item) => item.textContent === "Rewind",
    ) as HTMLButtonElement | undefined;
    expect(rewindBtn).toBeTruthy();
    await act(async () => {
      rewindBtn!.click();
      await Promise.resolve();
    });
    expect(api.rewind).toHaveBeenCalledWith("s1", "cp0");
  });

  it("clears chat from the composer overflow after confirm", async () => {
    const busy = {
      ...session,
      status: "idle" as const,
      repoId: "r1",
      messages: [
        {
          id: "u1",
          role: "user" as const,
          content: "refactor auth",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    };
    const cleared = { ...busy, messages: [] };
    vi.mocked(api.clearChat).mockResolvedValue(cleared);
    const dispatch = vi.fn();
    render(
      {
        ...initialState,
        selectedId: session.id,
        sessions: [busy],
        vms: [{ ...vm, status: "ready" }],
      },
      dispatch,
    );
    const trigger = host.querySelector("[data-testid='composer-commands'] summary") as HTMLElement;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    const pick = [...host.querySelectorAll("[data-testid='composer-commands'] .menu-item")].find(
      (btn) => btn.textContent?.includes("/clear"),
    ) as HTMLButtonElement;
    expect(pick.disabled).toBe(false);
    await act(async () => {
      pick.click();
      await Promise.resolve();
    });
    const clearBtn = [...host.querySelectorAll("[data-testid='confirm-modal'] button")].find(
      (item) => item.textContent === "Clear chat",
    ) as HTMLButtonElement | undefined;
    expect(clearBtn).toBeTruthy();
    await act(async () => {
      clearBtn!.click();
      await Promise.resolve();
    });
    expect(api.clearChat).toHaveBeenCalledWith("s1");
    expect(dispatch).toHaveBeenCalledWith({ type: "session", session: cleared });
  });

  it("clears the composer when the same session is wiped from elsewhere", () => {
    const busy = {
      ...session,
      status: "idle" as const,
      messages: [
        {
          id: "u1",
          role: "user" as const,
          content: "refactor auth",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    };
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [busy],
      vms: [{ ...vm, status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setter?.call(textarea, "keep typing");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(textarea.value).toBe("keep typing");
    rerender({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...busy, messages: [] }],
      vms: [{ ...vm, status: "ready" }],
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("hides Vision in the commands overflow on host and Design chats", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, runtime: "host", status: "idle", vmId: undefined }],
      vms: [],
    });
    const hostTrigger = host.querySelector(
      "[data-testid='composer-commands'] summary",
    ) as HTMLElement;
    act(() => {
      hostTrigger.click();
    });
    expect(host.querySelector("[data-testid='composer-commands']")?.textContent).toContain("/plan");
    expect(host.querySelector("[data-testid='composer-commands']")?.textContent).toContain(
      "/websearch",
    );
    expect(host.querySelector("[data-testid='composer-commands']")?.textContent).toContain(
      "/chrome",
    );
    expect(host.querySelector("[data-testid='composer-commands']")?.textContent).not.toContain(
      "/vision",
    );
    expect(host.querySelector("[data-testid='composer-commands']")?.textContent).toContain("/fork");
    act(() => root.unmount());
    host.remove();
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, kind: "design", runtime: "docker", status: "idle" }],
      vms: [{ ...vm, runtime: "docker", status: "ready" }],
    });
    const designTrigger = host.querySelector(
      "[data-testid='composer-commands'] summary",
    ) as HTMLElement;
    act(() => {
      designTrigger.click();
    });
    expect(host.querySelector("[data-testid='composer-commands']")?.textContent).toContain(
      "/websearch",
    );
    expect(host.querySelector("[data-testid='composer-commands']")?.textContent).not.toContain(
      "/vision",
    );
    expect(host.querySelector(".vision-toggle")).toBeNull();
  });

  it("keeps the slash menu when typing / after the commands overflow exists", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle" }],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='composer-commands']")).toBeTruthy();
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "/");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const slash = host.querySelector("[data-testid='slash-menu']");
    expect(slash?.textContent).toContain("/undo");
    expect(slash?.textContent).toContain("/plan");
    expect(slash?.textContent).toContain("/websearch");
    expect(slash?.textContent).toContain("/vision");
    expect(slash?.textContent).toContain("/fork");
    expect(slash?.textContent).toContain("/clear");
  });

  it("runs /undo from the slash menu instead of sending chat", async () => {
    vi.mocked(api.rewind).mockResolvedValue({ ...session, status: "idle" });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          checkpoints: [{ id: "cp", messageCount: 0, createdAt: "2020-01-01T00:00:00.000Z" }],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "/un");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='slash-menu']")?.textContent).toContain("/undo");
    const undoCmd = [...host.querySelectorAll("[data-testid='slash-menu'] button")].find((btn) =>
      btn.textContent?.includes("/undo"),
    ) as HTMLButtonElement | undefined;
    await act(async () => {
      undoCmd!.click();
      await Promise.resolve();
    });
    const rewindBtn = [...host.querySelectorAll("[data-testid='confirm-modal'] button")].find(
      (item) => item.textContent === "Rewind",
    ) as HTMLButtonElement | undefined;
    expect(rewindBtn).toBeTruthy();
    await act(async () => {
      rewindBtn!.click();
      await Promise.resolve();
    });
    expect(api.rewind).toHaveBeenCalledWith("s1", undefined);
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("keeps the parent selected after /workers", async () => {
    const worker: AgentSession = {
      ...session,
      id: "w1",
      title: "Test · 1",
      runtime: "docker",
      compare: { groupId: "g", role: "1", parentId: "s1" },
    };
    const parent: AgentSession = {
      ...session,
      status: "idle",
      runtime: "docker",
      compare: { groupId: "g", role: "parent" },
    };
    vi.mocked(api.spawnWorkers).mockResolvedValue([worker]);
    vi.mocked(api.session).mockResolvedValue(parent);
    const dispatch = vi.fn();
    render(
      {
        ...initialState,
        selectedId: session.id,
        sessions: [{ ...session, status: "idle", runtime: "docker" }],
        vms: [{ ...vm, status: "ready" }],
      },
      dispatch,
    );
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "/wor");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const workersCmd = [...host.querySelectorAll("[data-testid='slash-menu'] button")].find((btn) =>
      btn.textContent?.includes("/workers"),
    ) as HTMLButtonElement | undefined;
    await act(async () => {
      workersCmd!.click();
      await Promise.resolve();
    });
    expect(api.spawnWorkers).toHaveBeenCalledWith("s1", { count: 3 });
    expect(api.session).toHaveBeenCalledWith("s1");
    expect(dispatch).toHaveBeenCalledWith({ type: "session", session: worker });
    expect(dispatch).toHaveBeenCalledWith({ type: "session", session: parent });
    expect(dispatch).not.toHaveBeenCalledWith({ type: "select", id: "w1" });
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("arms plan mode from /plan and sends the next task as a plan turn", async () => {
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle" }],
      vms: [{ ...vm, status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "/plan");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Send"),
    );
    await act(async () => {
      send!.click();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='plan-arm']")).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "fix login");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      send!.click();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith("s1", "fix login", { plan: true });
  });

  it("inserts a skill slash into the composer instead of sending immediately", async () => {
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({
      ...initialState,
      config: skillsConfig,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle" }],
      vms: [{ ...vm, status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "/re");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='slash-menu']")?.textContent).toContain("/review");
    const skillCmd = [...host.querySelectorAll("[data-testid='slash-menu'] button")].find((btn) =>
      btn.textContent?.includes("/review"),
    ) as HTMLButtonElement | undefined;
    await act(async () => {
      skillCmd!.click();
      await Promise.resolve();
    });
    expect(textarea.value).toBe("/review ");
    expect(host.querySelector("[data-testid='slash-menu']")).toBeNull();
    expect(api.chat).not.toHaveBeenCalled();
    const send = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Send"),
    );
    await act(async () => {
      send!.click();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith(
      "s1",
      expect.stringContaining('Use the "PR review" skill.'),
      {
        skill: "review",
      },
    );
    expect(api.chat).toHaveBeenCalledWith(
      "s1",
      expect.stringContaining("Look at git_diff and comment."),
      {
        skill: "review",
      },
    );
  });

  it("sends /skill extra text as the skill task", async () => {
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({
      ...initialState,
      config: skillsConfig,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle" }],
      vms: [{ ...vm, status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "/review staging");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='slash-menu']")).toBeNull();
    const send = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Send"),
    );
    await act(async () => {
      send!.click();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith("s1", expect.stringMatching(/Task:\nstaging/), {
      skill: "review",
    });
  });

  it("keeps /undo as the built-in even if a skill reuses the name", async () => {
    vi.mocked(api.rewind).mockClear();
    vi.mocked(api.chat).mockClear();
    vi.mocked(api.rewind).mockResolvedValue({ ...session, status: "idle" });
    render({
      ...initialState,
      config: {
        ...skillsConfig,
        skills: [
          {
            id: "bad",
            name: "undo",
            title: "Nope",
            hint: "hint",
            body: "Do not run.",
            enabled: true,
          },
        ],
      },
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          checkpoints: [{ id: "cp", messageCount: 0, createdAt: "2020-01-01T00:00:00.000Z" }],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "/undo");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Send"),
    );
    await act(async () => {
      send!.click();
      await Promise.resolve();
    });
    const rewindBtn = [...host.querySelectorAll("[data-testid='confirm-modal'] button")].find(
      (item) => item.textContent === "Rewind",
    ) as HTMLButtonElement | undefined;
    expect(rewindBtn).toBeTruthy();
    await act(async () => {
      rewindBtn!.click();
      await Promise.resolve();
    });
    expect(api.rewind).toHaveBeenCalledWith("s1", undefined);
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("edits the last user prompt by rewinding into the composer", async () => {
    vi.mocked(api.rewind).mockResolvedValue({ ...session, status: "idle", messages: [] });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          checkpoints: [{ id: "cp", messageCount: 0, createdAt: "2020-01-01T00:00:00.000Z" }],
          messages: [
            { id: "u1", role: "user", content: "fix login", createdAt: "2020-01-01T00:00:00.000Z" },
            { id: "a1", role: "assistant", content: "done", createdAt: "2020-01-01T00:00:01.000Z" },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const edit = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Edit");
    await act(async () => {
      edit!.click();
      await Promise.resolve();
    });
    expect(api.rewind).toHaveBeenCalledWith("s1", undefined);
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("fix login");
  });

  it("retries the last turn after rewind", async () => {
    vi.mocked(api.rewind).mockResolvedValue({ ...session, status: "idle", messages: [] });
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          checkpoints: [{ id: "cp", messageCount: 0, createdAt: "2020-01-01T00:00:00.000Z" }],
          messages: [
            { id: "u1", role: "user", content: "fix login", createdAt: "2020-01-01T00:00:00.000Z" },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const retry = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Retry");
    await act(async () => {
      retry!.click();
      await Promise.resolve();
    });
    expect(api.rewind).toHaveBeenCalledWith("s1", undefined);
    expect(api.chat).toHaveBeenCalledWith("s1", "fix login", undefined);
  });

  it("offers Replay after an idle turn and Compare models after two", async () => {
    const dispatch = vi.fn();
    render(
      {
        ...initialState,
        selectedId: session.id,
        sessions: [
          {
            ...session,
            status: "idle",
            messages: [
              {
                id: "u1",
                role: "user",
                content: "fix login",
                createdAt: "2020-01-01T00:00:00.000Z",
              },
              {
                id: "a1",
                role: "assistant",
                content: "done",
                screenshotName: "shot.png",
                createdAt: "2020-01-01T00:00:01.000Z",
              },
            ],
          },
        ],
        vms: [{ ...vm, status: "ready" }],
      },
      dispatch,
    );
    expect(
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Compare models"),
    ).toBeUndefined();
    const replay = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Replay");
    expect(replay).toBeTruthy();
    act(() => root.unmount());
    host.remove();
    render(
      {
        ...initialState,
        selectedId: session.id,
        sessions: [
          {
            ...session,
            status: "idle",
            messages: [
              {
                id: "u1",
                role: "user",
                content: "fix login",
                createdAt: "2020-01-01T00:00:00.000Z",
              },
              {
                id: "a1",
                role: "assistant",
                content: "done",
                screenshotName: "shot.png",
                createdAt: "2020-01-01T00:00:01.000Z",
              },
              {
                id: "u2",
                role: "user",
                content: "also tests",
                createdAt: "2020-01-01T00:00:02.000Z",
              },
              {
                id: "a2",
                role: "assistant",
                content: "ok",
                screenshotName: "shot2.png",
                createdAt: "2020-01-01T00:00:03.000Z",
              },
            ],
          },
        ],
        vms: [{ ...vm, status: "ready" }],
      },
      dispatch,
    );
    const compare = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Compare models",
    );
    expect(compare).toBeTruthy();
    const replayTwo = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Replay",
    );
    act(() => {
      compare!.click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "compare", open: true });
    act(() => {
      replayTwo!.click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "replay", open: true });
    expect(compare!.closest(".turn-trust")).toBeTruthy();
    expect(compare!.closest(".msg")).toBeNull();
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.turn-trust \{[\s\S]*?max-width:\s*720px[\s\S]*?margin:\s*var\(--space-2\) auto var\(--space-1\)/,
    );
    expect(css).toMatch(/\.turn-trust\.compact \{[\s\S]*?max-width:\s*none/);
  });

  it("copies assistant text to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: "here is the patch",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const copy = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Copy"),
    );
    await act(async () => {
      copy!.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("here is the patch");
  });

  it("copies user prompts from the thread", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "fix the login",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const copy = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Copy"),
    );
    await act(async () => {
      copy!.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("fix the login");
  });

  it("copies a markdown fence from the Copy control", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: "```\nconst x = 1;\n```",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const fenceCopy = host.querySelector(".md-copy") as HTMLButtonElement;
    expect(fenceCopy).toBeTruthy();
    await act(async () => {
      fenceCopy.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("const x = 1;");
  });

  it("shows a reconnecting banner when the control plane drops", () => {
    renderOffline({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle" }],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.textContent).toMatch(/Reconnecting/);
    expect(host.querySelector("[data-testid='retry-events']")?.textContent).toMatch(/Retry now/);
    const banners = host.querySelector(".net-banners");
    const thread = host.querySelector(".thread-wrap");
    expect(banners).toBeTruthy();
    expect(thread).toBeTruthy();
    expect(banners!.contains(thread!)).toBe(false);
    expect(host.querySelector(".net-banner")?.closest(".net-banners")).toBe(banners);
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.chat \{[\s\S]*?position:\s*relative/);
    expect(css).toMatch(/\.net-banners \{[\s\S]*?position:\s*absolute/);
  });

  it("puts the composer back when chat POST fails", async () => {
    vi.mocked(api.chat).mockRejectedValue(new Error("Failed to fetch"));
    vi.mocked(api.session).mockRejectedValue(new Error("Failed to fetch"));
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle" }],
      vms: [{ ...vm, status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "draft that must survive");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Send"),
    );
    await act(async () => {
      send!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textarea.value).toBe("draft that must survive");
    expect(host.textContent).toMatch(/Couldn't send/);
  });

  it("does not restore the composer if the turn actually started", async () => {
    vi.mocked(api.chat).mockRejectedValue(new Error("Failed to fetch"));
    vi.mocked(api.session).mockResolvedValue({
      ...session,
      status: "running",
      messages: [
        { id: "u1", role: "user", content: "keep going", createdAt: "2020-01-01T00:00:00.000Z" },
      ],
    });
    const dispatched: Action[] = [];
    render(
      {
        ...initialState,
        selectedId: session.id,
        sessions: [{ ...session, status: "idle" }],
        vms: [{ ...vm, status: "ready" }],
      },
      (action) => {
        dispatched.push(action);
      },
    );
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "keep going");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Send"),
    );
    await act(async () => {
      send!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textarea.value).toBe("");
    expect(host.textContent).not.toMatch(/Couldn't send/);
    expect(dispatched.some((action) => action.type === "session")).toBe(true);
  });

  it("shows the prompt in the thread before the chat POST returns", async () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle", messages: [] }],
      vms: [{ ...vm, status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "hello from composer");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(textarea.value).toBe("");
    expect(host.querySelector('.msg.user[data-pending="true"]')?.textContent).toMatch(
      /hello from composer/,
    );
    expect(api.chat).toHaveBeenCalledWith("s1", "hello from composer", undefined);
  });

  it("does not double-send the same composer prompt", async () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle", messages: [] }],
      vms: [{ ...vm, status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "hello from composer");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledTimes(1);
  });

  it("does not echo queued follow-ups into the live thread", async () => {
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [session],
      vms: [vm],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "follow up after this turn");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const queueBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Queue"),
    );
    await act(async () => {
      queueBtn!.click();
      await Promise.resolve();
    });
    expect(host.querySelector(".msg.user")).toBeNull();
    expect(api.chat).toHaveBeenCalledWith("s1", "follow up after this turn", undefined);
  });

  it("shows an N files changed chip after an idle coding turn and loads the unified diff", async () => {
    const diff = [
      " 3 files changed, 3 insertions(+)",
      "",
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -0,0 +1 @@",
      "+a",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -0,0 +1 @@",
      "+b",
      "diff --git a/c.ts b/c.ts",
      "--- a/c.ts",
      "+++ b/c.ts",
      "@@ -0,0 +1 @@",
      "+c",
    ].join("\n");
    vi.mocked(api.checkpointDiff).mockResolvedValue({ diff });
    const writes = ["a.ts", "b.ts", "c.ts"].map((path, index) => ({
      id: `w${index + 1}`,
      name: "file_write",
      arguments: { path: `/workspace/${path}`, content: path },
      result: "ok",
      startedAt: "2020-01-01T00:00:03.000Z",
      finishedAt: "2020-01-01T00:00:03.000Z",
    }));
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "hi",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "a1",
              role: "assistant",
              content: "hello",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
            {
              id: "u2",
              role: "user",
              content: "edit three files",
              createdAt: "2020-01-01T00:00:02.000Z",
            },
            {
              id: "a2",
              role: "assistant",
              content: "Patched.",
              createdAt: "2020-01-01T00:00:03.000Z",
              toolCalls: writes,
            },
          ],
          checkpoints: [
            {
              id: "cp0",
              messageCount: 2,
              createdAt: "2020-01-01T00:00:01.000Z",
              gitRef: "refs/locus/checkpoints/cp0",
            },
            {
              id: "cp1",
              messageCount: 4,
              createdAt: "2020-01-01T00:00:03.000Z",
              gitRef: "refs/locus/checkpoints/cp1",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    const chip = host.querySelector("[data-testid='turn-diff-chip']") as HTMLButtonElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe("3 files changed");
    expect(host.querySelector("[data-testid='checkpoint-diff']")).toBeNull();
    await act(async () => {
      chip.click();
      await Promise.resolve();
    });
    expect(api.checkpointDiff).toHaveBeenCalledWith("s1", "cp1");
    expect(host.querySelector("[data-testid='checkpoint-diff']")?.textContent).toContain(
      "3 files changed",
    );
    expect(host.querySelector("[data-testid='pr-stack']")).toBeTruthy();
    expect(chip.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not show a turn-diff chip without paired git checkpoints", () => {
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "hi",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "a1",
              role: "assistant",
              content: "hello",
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
          checkpoints: [
            {
              id: "cp0",
              messageCount: 2,
              createdAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='turn-diff-chip']")).toBeNull();
  });

  it("inserts an @file mention and sends it as repo focus", async () => {
    vi.mocked(api.workspaceSearch).mockResolvedValue({
      items: [{ path: "src/app.ts", kind: "file", score: 12 }],
      fileCount: 1,
      builtAt: "2020-01-01T00:00:00.000Z",
    });
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({
      ...initialState,
      selectedId: session.id,
      sessions: [{ ...session, status: "idle" }],
      vms: [{ ...vm, status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "@src");
      textarea.selectionStart = textarea.selectionEnd = 4;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(host.querySelector("[data-testid='file-mention-menu']")?.textContent).toContain(
      "@src/app.ts",
    );
    await act(async () => {
      (host.querySelector("[data-testid='file-mention-menu'] button") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(textarea.value).toBe("@src/app.ts ");
    await act(async () => {
      (host.querySelector(".composer-send") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(api.chat).toHaveBeenCalledWith("s1", "@src/app.ts ", { focusPath: "src/app.ts" });
  });

  it("autocompletes ranked @teammate mentions and chips them in the thread", async () => {
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    const coordinator: AgentSession = {
      ...session,
      id: "coord",
      title: "R&D",
      kind: "project",
      surface: "swarm",
      projectId: "team-1",
      status: "idle",
      messages: [
        {
          id: "u0",
          role: "user",
          content: "Hey @Nova and @everyone",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    };
    const nova: AgentSession = {
      ...session,
      id: "mate-1",
      title: "Nova",
      surface: "swarm",
      projectId: "team-1",
      persona: { displayName: "Nova", hubRole: "Builder" },
      messages: [],
    };
    const nora: AgentSession = {
      ...session,
      id: "mate-2",
      title: "Nora",
      surface: "swarm",
      projectId: "team-1",
      persona: { displayName: "Nora", hubRole: "Researcher" },
      messages: [],
    };
    const project = {
      id: "team-1",
      title: "Team Rapid Fire",
      teamName: "Team Rapid Fire",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      coordinatorSessionId: coordinator.id,
      memberCount: 2,
      memberIds: [nova.id, nora.id],
      surface: "swarm" as const,
      groupChat: true,
    };
    render({
      ...initialState,
      selectedId: coordinator.id,
      config: { ...skillsConfig, productMode: "swarm" },
      sessions: [coordinator, nova, nora],
      projects: [project],
      vms: [{ ...vm, status: "ready" }],
    });
    expect([...host.querySelectorAll(".md-mention")].map((el) => el.textContent)).toEqual([
      "@Nova",
      "@everyone",
    ]);
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.md-mention \{[^}]*background:\s*color-mix/);
    expect(css).toMatch(
      /\.teammate-mention-menu \.slash-name \{[^}]*border-radius:\s*var\(--radius-sm\)/,
    );

    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    act(() => {
      setValue?.call(textarea, "@");
      textarea.selectionStart = textarea.selectionEnd = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const openLabels = [
      ...host.querySelectorAll("[data-testid='teammate-mention-menu'] .slash-name"),
    ].map((el) => el.textContent);
    expect(openLabels[0]).toBe("@everyone");
    expect(openLabels).toContain("@Nora");
    expect(openLabels).toContain("@Nova");

    act(() => {
      setValue?.call(textarea, "@No");
      textarea.selectionStart = textarea.selectionEnd = 3;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const ranked = [
      ...host.querySelectorAll("[data-testid='teammate-mention-menu'] .slash-name"),
    ].map((el) => el.textContent);
    expect(ranked).toEqual(["@Nora", "@Nova"]);
    expect(host.querySelector("[data-testid='file-mention-menu']")).toBeNull();

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(textarea.value).toBe("@Nova ");

    await act(async () => {
      (host.querySelector(".composer-send") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(vi.mocked(api.chat).mock.calls[0]?.[0]).toBe("coord");
    expect(vi.mocked(api.chat).mock.calls[0]?.[1]).toBe("@Nova ");
  });

  it("suggests Swarm teammates with @ outside a group chat", () => {
    const nova: AgentSession = {
      ...session,
      id: "mate-1",
      title: "Nova",
      surface: "swarm",
      status: "idle",
      persona: { displayName: "Nova", hubRole: "Builder" },
      messages: [],
    };
    const nora: AgentSession = {
      ...session,
      id: "mate-2",
      title: "Nora",
      surface: "swarm",
      status: "idle",
      persona: { displayName: "Nora", hubRole: "Researcher" },
      messages: [],
    };
    render({
      ...initialState,
      selectedId: nova.id,
      config: { ...skillsConfig, productMode: "swarm" },
      sessions: [nova, nora],
      vms: [{ ...vm, status: "ready" }],
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    act(() => {
      setValue?.call(textarea, "@");
      textarea.selectionStart = textarea.selectionEnd = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      [...host.querySelectorAll("[data-testid='teammate-mention-menu'] .slash-name")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["@everyone", "@Nora"]);
  });

  it("draws a New divider above messages that arrived after you left", () => {
    const messages = [
      { id: "u1", role: "user" as const, content: "old", createdAt: "2020-01-01T00:00:00.000Z" },
      {
        id: "a1",
        role: "assistant" as const,
        content: "seen reply",
        createdAt: "2020-01-01T00:00:01.000Z",
      },
      { id: "u2", role: "user" as const, content: "new", createdAt: "2020-01-01T00:00:02.000Z" },
      {
        id: "a2",
        role: "assistant" as const,
        content: "fresh reply",
        createdAt: "2020-01-01T00:00:03.000Z",
      },
    ];
    render({
      ...initialState,
      selectedId: session.id,
      lastSeenMessageIds: { [session.id]: "a1" },
      chatNewVisit: { sessionId: session.id, markerId: "u2" },
      sessions: [{ ...session, status: "idle", messages }],
      vms: [{ ...vm, status: "ready" }],
    });
    const divider = host.querySelector("[data-testid='chat-new-divider']");
    expect(divider?.textContent).toBe("New");
    expectBefore(host.querySelector('[data-msg-id="a1"]'), divider);
    expectBefore(divider, host.querySelector('[data-msg-id="u2"]'));
  });

  it("does not draw a New divider on the first visit or while catching up live", () => {
    const seen = [
      { id: "u1", role: "user" as const, content: "hi", createdAt: "2020-01-01T00:00:00.000Z" },
      {
        id: "a1",
        role: "assistant" as const,
        content: "hello",
        createdAt: "2020-01-01T00:00:01.000Z",
      },
    ];
    render({
      ...initialState,
      selectedId: session.id,
      lastSeenMessageIds: { [session.id]: "a1" },
      chatNewVisit: { sessionId: session.id },
      sessions: [{ ...session, status: "idle", messages: seen }],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='chat-new-divider']")).toBeNull();

    rerender({
      ...initialState,
      selectedId: session.id,
      lastSeenMessageIds: { [session.id]: "a1" },
      chatNewVisit: { sessionId: session.id },
      sessions: [
        {
          ...session,
          status: "idle",
          messages: [
            ...seen,
            {
              id: "a2",
              role: "assistant" as const,
              content: "later",
              createdAt: "2020-01-01T00:00:02.000Z",
            },
          ],
        },
      ],
      vms: [{ ...vm, status: "ready" }],
    });
    expect(host.querySelector("[data-testid='chat-new-divider']")).toBeNull();
  });

  it("keeps the New divider in Swarm threads", () => {
    render({
      ...initialState,
      selectedId: session.id,
      lastSeenMessageIds: { [session.id]: "u1" },
      chatNewVisit: { sessionId: session.id, markerId: "a1" },
      config: { ...skillsConfig, productMode: "swarm" },
      sessions: [
        {
          ...session,
          status: "idle",
          surface: "swarm",
          messages: [
            { id: "u1", role: "user", content: "hey", createdAt: "2020-01-01T00:00:00.000Z" },
            {
              id: "a1",
              role: "assistant",
              content: "I can take that",
              createdAt: "2020-01-01T00:00:01.000Z",
              speaker: { sessionId: "mate-1", displayName: "Nova" },
            },
          ],
        },
      ],
    });
    expect(host.querySelector("[data-testid='chat-new-divider']")?.textContent).toBe("New");
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.chat-new-divider \{[\s\S]*?color: var\(--accent\)/);
    expect(css).toMatch(
      /\.chat-new-divider::before,[\s\S]*?background: color-mix\(in srgb, var\(--accent\) 85%/,
    );
    expect(css).toMatch(
      /\[data-product-mode="swarm"\] \.chat-new-divider \{[\s\S]*?max-width:\s*none/,
    );
  });
});
