import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type Dispatch, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSession,
  LocusConfig,
  SlackConversation,
  SlackMessage,
  SlackStatus,
} from "@locus/shared";
import {
  SlackAlertToasts,
  SlackPane,
  slackChannelGroups,
  slackWorkspaceBooting,
  pickDefaultSlackChannel,
  LAST_SLACK_CHANNEL_KEY,
  LAST_SLACK_POST_AS_KEY,
  LAST_SLACK_SIDEBAR_GROUPS_KEY,
  SLACK_THREAD_WIDTH_KEY,
} from "./Slack";
import { SLACK_CATCH_UP_CURSOR_KEY, SLACK_CATCH_UP_TEXT } from "@locus/shared";
import { api } from "@/lib/api";
import { LAST_AGENT_KEY } from "@/lib/lastAgent";
import { Store, initialState, type Action, type UiState } from "@/state/store";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

const status: SlackStatus = {
  connected: true,
  teamId: "T_MOCK",
  teamName: "Locus Dev",
  userId: "U_YOU",
  userName: "you",
  avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_YOU.png",
  socket: "down",
};

const conversations: SlackConversation[] = [
  { id: "C_ENG", name: "eng", kind: "channel", topic: "Shipping" },
  {
    id: "D_BOB",
    name: "bob",
    kind: "im",
    userId: "U_BOB",
    avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_BOB.png",
  },
];

const slackConfig: LocusConfig = {
  theme: "ember",
  providers: [
    {
      id: "openai",
      name: "OpenAI",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4.1", "gpt-4.1-mini"],
      defaultModel: "gpt-4.1",
      enabled: true,
      extraHeaders: {},
    },
    {
      id: "anthropic",
      name: "Anthropic",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com",
      models: ["claude-sonnet-4-5", "claude-opus-4-5"],
      defaultModel: "claude-sonnet-4-5",
      enabled: true,
      extraHeaders: {},
    },
  ],
  templates: [],
  hardwareProfiles: [],
  forges: [],
  integrations: [
    {
      id: "slack-1",
      kind: "slack",
      name: "Slack",
      enabled: true,
      baseUrl: "https://slack.com/api",
      userToken: "xoxp-mock",
      userId: "U_YOU",
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
    logLevel: "info",
    bindHost: "127.0.0.1",
    bindPort: 7420,
    openBrowserOnStart: true,
    hostSharePath: "",
  },
};

const history: SlackMessage[] = [
  {
    ts: "1710000001.0",
    channelId: "C_ENG",
    userId: "U_ALICE",
    userName: "alice",
    avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_ALICE.png",
    text: "can you look at checkout? :wave:",
    replyCount: 1,
    reactions: [{ name: "eyes", count: 2 }],
  },
  {
    ts: "1710000003.0",
    channelId: "C_ENG",
    userId: "U_BOB",
    userName: "bob",
    avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_BOB.png",
    text: "",
    files: [
      {
        url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
        title: "thumbs up",
        mime: "image/gif",
      },
    ],
  },
];

const dmHistory: SlackMessage[] = [
  {
    ts: "1710000200.0",
    channelId: "D_BOB",
    userId: "U_BOB",
    userName: "bob",
    avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_BOB.png",
    text: "got a minute?",
  },
];

vi.mock("@/lib/api", () => ({
  api: {
    slackStatus: vi.fn(async () => status),
    slackConversations: vi.fn(async () => conversations),
    slackHistory: vi.fn(async (id: string) => (id === "D_BOB" ? dmHistory : history)),
    slackReplies: vi.fn(async () => history),
    slackPost: vi.fn(
      async (
        _id: string,
        text: string,
        _thread?: string,
        gif?: { url: string; title?: string },
      ) => ({
        ts: "1710000999.0",
        channelId: "C_ENG",
        userId: "U_YOU",
        userName: "you",
        avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_YOU.png",
        text: text || gif?.title || "GIF",
        files: gif ? [{ url: gif.url, title: gif.title, mime: "image/gif" }] : undefined,
      }),
    ),
    slackUpload: vi.fn(async (_id: string, file: File, opts?: { comment?: string }) => ({
      ts: "1710001000.0",
      channelId: "C_ENG",
      userId: "U_YOU",
      userName: "you",
      avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_YOU.png",
      text: opts?.comment || file.name,
      files: [{ url: `slack-file://${file.name}`, title: file.name, mime: file.type }],
    })),
    slackGiphy: vi.fn(async () => ({
      hits: [
        {
          id: "thumbs",
          title: "Thumbs up",
          url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
          preview: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
        },
      ],
      source: "catalog" as const,
      notice: "Local catalog — set LOCUS_GIPHY_API_KEY for live Giphy search.",
    })),
    slackRun: vi.fn(async () => ({ sessionId: "s-run", created: true })),
    resolveApproval: vi.fn(async (id: string) => ({
      id,
      title: "Slack",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "openai",
      model: "gpt-4.1",
      status: "idle",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    })),
    patchSession: vi.fn(async (_id: string, patch: { subscriptions?: unknown }) => ({
      id: _id,
      title: "Build the agent",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      subscriptions: patch.subscriptions ?? [],
    })),
    slackReact: vi.fn(
      async (_id: string, ts: string, name: string, opts?: { remove?: boolean }) => {
        const base = history.find((row) => row.ts === ts) ?? history[0]!;
        if (opts?.remove) {
          return {
            ...base,
            reactions: name === "eyes" ? [{ name: "eyes", count: 1 }] : base.reactions,
          };
        }
        const others = (base.reactions ?? []).filter((row) => row.name !== name);
        return {
          ...base,
          reactions: [...others, { name, count: name === "eyes" ? 3 : 1, mine: true }],
        };
      },
    ),
    slackStar: vi.fn(async (_id: string, starred: boolean) =>
      conversations.map((row) => (row.id === "C_ENG" ? { ...row, starred } : row)),
    ),
    slackMarkRead: vi.fn(async (id: string) =>
      conversations.map((row) => (row.id === id ? { ...row, unread: false } : row)),
    ),
    slackUpdate: vi.fn(async (_id: string, ts: string, text: string) => ({
      ts,
      channelId: "C_ENG",
      userId: "U_YOU",
      userName: "you",
      text,
    })),
    slackDelete: vi.fn(async (_id: string, ts: string) => ({
      ts,
      channelId: "C_ENG",
      text: "",
      subtype: "message_deleted",
    })),
    slackEmoji: vi.fn(async () => ({ shipit: "https://emoji.slack-edge.com/shipit.png" })),
    slackUnwatch: vi.fn(async () => ({ ok: true })),
    slackSearch: vi.fn(async () => []),
    slackActivity: vi.fn(async () => []),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SlackPane", () => {
  let host: HTMLDivElement;
  let root: Root;
  let dispatch: ReturnType<typeof vi.fn>;
  let mounted = false;

  afterEach(() => {
    if (mounted) {
      act(() => root.unmount());
      mounted = false;
    }
    host.remove();
    window.localStorage.removeItem(LAST_AGENT_KEY);
    window.localStorage.removeItem(LAST_SLACK_CHANNEL_KEY);
    window.localStorage.removeItem(LAST_SLACK_POST_AS_KEY);
    window.localStorage.removeItem(LAST_SLACK_SIDEBAR_GROUPS_KEY);
    window.localStorage.removeItem(SLACK_THREAD_WIDTH_KEY);
    window.localStorage.removeItem(SLACK_CATCH_UP_CURSOR_KEY);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function render(
    state: UiState = {
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
    },
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    const style = document.createElement("style");
    style.textContent = css;
    host.appendChild(style);
    root = createRoot(host);
    dispatch = vi.fn();
    const node: ReactNode = (
      <Store.Provider value={{ state, dispatch: dispatch as unknown as Dispatch<Action> }}>
        <SlackPane />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    mounted = true;
    return state;
  }

  function rerender(state: UiState) {
    act(() => {
      root.render(
        <Store.Provider value={{ state, dispatch: dispatch as unknown as Dispatch<Action> }}>
          <SlackPane />
        </Store.Provider>,
      );
    });
  }

  it("asks the operator to sign in when Slack is disconnected", () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: { connected: false, socket: "down" },
      slackConversations: [],
      selectedSlackChannelId: null,
      slackMessages: [],
    });
    expect(host.textContent).toContain("Sign in as yourself");
    expect(host.textContent).toContain("or as the Locus bot");
    expect(host.textContent).toContain("Settings → Integrations");
    expect(host.querySelector(".slack-title")).toBeNull();
    expect(host.querySelector(".empty-hero .eyebrow")).toBeNull();
    expect(host.querySelectorAll(".slack-pane h2")).toHaveLength(1);
    expect(host.querySelector(".slack-empty .row-actions")).toBeTruthy();
    expect(css).toMatch(/\.slack-empty \.row-actions \{[\s\S]*?justify-content:\s*center/);
    expect(
      host.querySelector(".slack-empty [data-testid='locus-mascot']")?.getAttribute("data-pose"),
    ).toBe("rest");
    const signIn = [...host.querySelectorAll("button")].find(
      (el) => el.textContent === "Sign in with Slack",
    );
    expect(signIn).toBeTruthy();
    expect(
      [...host.querySelectorAll("button")].find((el) => el.textContent === "Open Settings"),
    ).toBeUndefined();
    act(() => {
      signIn!.click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "settings", open: true });
    expect(dispatch).toHaveBeenCalledWith({ type: "settingsTab", tab: "integrations" });
  });

  it("puts signed-in status beside the channel title", () => {
    render();
    expect(host.querySelector(".slack-title .hint")?.textContent).toBe(
      "signed in as you · Locus Dev · Shipping",
    );
    expect(css).toMatch(/\.slack-title \{[\s\S]*?flex-direction:\s*row/);
    expect(css).toMatch(/\.slack-title \{[\s\S]*?flex-wrap:\s*nowrap/);
    expect(css).toMatch(/\.slack-title \.hint \{[\s\S]*?margin:\s*0/);
  });

  it("windows a long channel so the DOM stays near the viewport", () => {
    const longHistory: SlackMessage[] = Array.from({ length: 200 }, (_, i) => ({
      ts: `171000${String(i).padStart(4, "0")}.0`,
      channelId: "C_ENG",
      userId: i % 2 === 0 ? "U_ALICE" : "U_BOB",
      userName: i % 2 === 0 ? "alice" : "bob",
      text: `channel line ${i}`,
    }));
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: longHistory,
    });
    const mounted = host.querySelectorAll("[data-slack-row]").length;
    expect(mounted).toBeGreaterThan(8);
    expect(mounted).toBeLessThan(120);
    expect(host.textContent).toContain("channel line 199");
    expect(host.textContent).not.toContain("channel line 0");
  });

  it("renders channel history as you and sends from the composer", async () => {
    render();
    expect(host.querySelector(".slack-title .hint")?.textContent).toMatch(/signed in as you/);
    expect(host.textContent).toContain("alice");
    expect(host.textContent).toContain("can you look at checkout?");
    const box = host.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(box?.getAttribute("placeholder")).toBe("Message #eng");
    await act(async () => {
      if (!box) throw new Error("missing composer");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "on it");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const send = [...host.querySelectorAll("button")].find((el) => el.textContent === "Send");
      send?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackPost).toHaveBeenCalledWith(
      "C_ENG",
      "on it",
      undefined,
      undefined,
      "user",
      false,
    );
  });

  it("uploads a composer attachment without requiring text", async () => {
    render();
    const attach = [...host.querySelectorAll("button")].find((el) => el.textContent === "Attach");
    const input = host.querySelector("input[type='file']") as HTMLInputElement | null;
    expect(attach).toBeTruthy();
    expect(input).toBeTruthy();
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await act(async () => {
      Object.defineProperty(input!, "files", { configurable: true, value: [file] });
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toContain("notes.txt");
    await act(async () => {
      const send = [...host.querySelectorAll("button")].find((el) => el.textContent === "Send");
      expect(send?.hasAttribute("disabled")).toBe(false);
      send?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackUpload).toHaveBeenCalledWith("C_ENG", file, {
      comment: undefined,
      threadTs: undefined,
      as: "user",
    });
  });

  it("toggles the composer to post as the Locus bot", async () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: { ...status, canPostAsBot: true },
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
    });
    const toggle = host.querySelector("[data-testid='slack-post-as']") as HTMLButtonElement | null;
    expect(toggle).toBeTruthy();
    expect(toggle?.textContent).toBe("as you");
    expect(css).toMatch(/\.slack-post-as\.on/);
    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toggle?.textContent).toBe("as Locus");
    const box = host.querySelector("textarea") as HTMLTextAreaElement | null;
    await act(async () => {
      if (!box) throw new Error("missing composer");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "from the app");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const send = [...host.querySelectorAll("button")].find((el) => el.textContent === "Send");
      send?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackPost).toHaveBeenCalledWith(
      "C_ENG",
      "from the app",
      undefined,
      undefined,
      "bot",
      false,
    );
  });

  it("renders resolved Slack user mentions instead of @user", () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        {
          ts: "1710000200.0",
          channelId: "C_ENG",
          userId: "U_YOU",
          userName: "you",
          text: "<@U_ALICE|alice> <@U_BOB|bob> Testing 26.06 thread",
        },
      ],
    });
    expect(host.textContent).toContain("@alice");
    expect(host.textContent).toContain("@bob");
    expect(host.textContent).not.toContain("@user");
  });

  it("starts Ask Locus from the channel header", async () => {
    render();
    const ask = [...host.querySelectorAll("button")].find((el) => el.textContent === "Ask Locus");
    expect(ask).toBeTruthy();
    await act(async () => {
      ask!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const input = host.querySelector(".slack-ask input") as HTMLInputElement | null;
    expect(input).toBeTruthy();
    await act(async () => {
      if (!input) throw new Error("missing ask field");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "fix checkout");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const run = [...host.querySelectorAll(".slack-ask button")].find(
        (el) => el.textContent === "Run",
      );
      run?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackRun).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "C_ENG",
        text: "fix checkout",
        providerId: "openai",
        model: "gpt-4.1",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "s-run" });
  });

  it("starts a named work recipe from Ask Locus", async () => {
    render();
    const ask = [...host.querySelectorAll("button")].find((el) => el.textContent === "Ask Locus");
    await act(async () => {
      ask!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const recipes = [...host.querySelectorAll("[data-testid='slack-ask-recipe']")].map(
      (el) => el.textContent,
    );
    expect(recipes).toEqual(["Review this PR", "Design this screen", "Ops loop"]);
    await act(async () => {
      host
        .querySelector("[data-testid='slack-ask-recipe'][data-recipe='pr-reviewer']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackRun).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "C_ENG",
        recipeId: "pr-reviewer",
        text: "Review this PR from this Slack thread.",
      }),
    );
  });

  it("runs Catch me up locally without jumping to the agent", async () => {
    window.localStorage.setItem(
      SLACK_CATCH_UP_CURSOR_KEY,
      JSON.stringify({ C_ENG: "1710000001.0" }),
    );
    render();
    const catchUp = host.querySelector("[data-testid='slack-catch-up']") as HTMLButtonElement;
    expect(catchUp?.textContent).toBe("Catch me up");
    await act(async () => {
      catchUp.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackRun).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "C_ENG",
        text: SLACK_CATCH_UP_TEXT,
        sinceTs: "1710000001.0",
      }),
    );
    expect(dispatch).not.toHaveBeenCalledWith({ type: "select", id: "s-run" });
  });

  it("lets the operator edit a slack_post draft and Send", async () => {
    const bound: AgentSession = {
      id: "s-bound",
      title: "Slack",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "openai",
      model: "gpt-4.1",
      status: "idle",
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "",
          createdAt: "2020-01-01T00:00:00.000Z",
          toolCalls: [
            {
              id: "t-post",
              name: "slack_post",
              arguments: { text: "looking now" },
              approval: "needed",
              startedAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      slack: { teamId: "T_MOCK", channelId: "C_ENG", threadTs: "1710000001.0" },
    };
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      sessions: [bound],
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
    });
    const field = host.querySelector("[data-testid='slack-draft-text']") as HTMLTextAreaElement;
    expect(field?.value).toBe("looking now");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(field, "ship the patch");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host
        .querySelector("[data-testid='slack-draft-send']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.resolveApproval).toHaveBeenCalledWith(
      "s-bound",
      "t-post",
      "approved",
      "ship the patch",
    );
  });

  it("turns file, PR, and session mentions into Locus jumps", async () => {
    const sessionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const bound: AgentSession = {
      id: sessionId,
      title: "Slack",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "openai",
      model: "gpt-4.1",
      status: "idle",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      slack: { teamId: "T_MOCK", channelId: "C_ENG", threadTs: "1710000001.0" },
    };
    const citeMessage = {
      ts: "1710000999.0",
      channelId: "C_ENG",
      userId: "U_ALICE",
      userName: "alice",
      text: `see /workspace/apps/desktop/src/components/Slack.tsx and https://github.com/acme/app/pull/12 then ${sessionId}`,
    };
    vi.mocked(api.slackHistory).mockImplementationOnce(async () => [citeMessage]);
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      sessions: [bound],
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
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [citeMessage],
    });
    const chips = [...host.querySelectorAll("[data-testid='slack-cite']")];
    expect(chips.map((el) => el.getAttribute("data-kind"))).toEqual(["file", "pr", "session"]);
    await act(async () => {
      chips[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: sessionId });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "openWorkspace",
        open: expect.objectContaining({
          sessionId,
          path: "/workspace/apps/desktop/src/components/Slack.tsx",
        }),
      }),
    );
    await act(async () => {
      chips[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "selectRepo", id: "r1" });
    expect(dispatch).toHaveBeenCalledWith({ type: "selectPull", number: 12 });
  });

  it("sends the chosen provider and model with Ask Locus", async () => {
    render();
    const ask = [...host.querySelectorAll("button")].find((el) => el.textContent === "Ask Locus");
    await act(async () => {
      ask!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const provider = host.querySelector(
      '.slack-ask select[aria-label="Provider"]',
    ) as HTMLSelectElement;
    const model = host.querySelector('.slack-ask select[aria-label="Model"]') as HTMLSelectElement;
    expect(provider?.value).toBe("openai");
    expect(model?.value).toBe("gpt-4.1");
    const bar = host.querySelector(".slack-ask-bar");
    expect(bar?.contains(provider)).toBe(true);
    expect(bar?.contains(model)).toBe(true);
    const actions = bar!.querySelector(".slack-ask-actions");
    expect([...actions!.querySelectorAll("button")].map((el) => el.textContent)).toEqual([
      "Cancel",
      "Run",
    ]);
    expect(css).toMatch(/\.slack-ask-bar \{[\s\S]*?flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.slack-ask-actions \{[\s\S]*?flex:\s*0 0 auto/);
    await act(async () => {
      provider.value = "anthropic";
      provider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const nextModel = host.querySelector(
      '.slack-ask select[aria-label="Model"]',
    ) as HTMLSelectElement;
    expect(nextModel.value).toBe("claude-sonnet-4-5");
    await act(async () => {
      nextModel.value = "claude-opus-4-5";
      nextModel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const input = host.querySelector(".slack-ask input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "use opus");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const run = [...host.querySelectorAll(".slack-ask button")].find(
        (el) => el.textContent === "Run",
      );
      run?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackRun).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "C_ENG",
        text: "use opus",
        providerId: "anthropic",
        model: "claude-opus-4-5",
      }),
    );
  });

  it("seeds Ask Locus from the bound Slack session", async () => {
    const bound: AgentSession = {
      id: "s-bound",
      title: "Slack",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "anthropic",
      model: "claude-opus-4-5",
      status: "idle",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      slack: { teamId: "T_MOCK", channelId: "C_ENG", threadTs: "1710000001.0" },
    };
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      sessions: [bound],
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
    });
    const ask = [...host.querySelectorAll("button")].find((el) => el.textContent === "Ask Locus");
    await act(async () => {
      ask!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const provider = host.querySelector(
      '.slack-ask select[aria-label="Provider"]',
    ) as HTMLSelectElement;
    const model = host.querySelector('.slack-ask select[aria-label="Model"]') as HTMLSelectElement;
    expect(provider?.value).toBe("anthropic");
    expect(model?.value).toBe("claude-opus-4-5");
  });

  it("searches Slack messages and jumps to a hit", async () => {
    vi.useFakeTimers();
    vi.mocked(api.slackSearch).mockResolvedValue([
      {
        channelId: "C_ENG",
        channelName: "eng",
        ts: "1710000001.0",
        text: "can you look at checkout?",
        userName: "alice",
      },
    ]);
    render();
    const input = host.querySelector('[aria-label="Search Slack messages"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "checkout");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("focus", { bubbles: true }));
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackSearch).toHaveBeenCalledWith("checkout");
    const hit = [...host.querySelectorAll(".slack-search-hit")].find((el) =>
      el.textContent?.includes("checkout"),
    );
    expect(hit).toBeTruthy();
    await act(async () => {
      hit!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "selectSlackChannel", id: "C_ENG" });
    expect(dispatch).toHaveBeenCalledWith({ type: "slackThread", ts: "1710000001.0" });
    vi.useRealTimers();
  });

  it("matches the sidebar search field for message search", () => {
    render();
    const input = host.querySelector('[aria-label="Search Slack messages"]') as HTMLInputElement;
    expect(input.classList.contains("search")).toBe(true);
    expect(host.querySelector(".slack-search-wrap .search-icon svg")).toBeTruthy();
    expect(css).toMatch(/\.search \{[\s\S]*?border:\s*1px solid var\(--line\)/);
    expect(css).toMatch(/\.slack-search-wrap \.search \{[\s\S]*?margin:\s*0/);
    expect(css).toMatch(/\.slack-search-wrap \.search \{[\s\S]*?width:\s*100%/);
  });

  it("renders Slack Activity and opens a mention in its channel", async () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackActivityOpen: true,
      slackActivity: [
        {
          id: "C_ENG:1710000001.0",
          kind: "mention",
          channelId: "C_ENG",
          channelName: "eng",
          ts: "1710000001.0",
          text: "hey <@U_YOU> look at checkout",
          userName: "alice",
        },
        {
          id: "unread:D_BOB",
          kind: "dm",
          channelId: "D_BOB",
          channelName: "bob",
          ts: "1710000200.0",
          text: "Unread direct message",
        },
      ],
    });
    expect(host.querySelector("[data-testid='slack-activity']")?.textContent).toContain(
      "alice mentioned you in #eng",
    );
    expect(host.querySelector("[data-testid='slack-activity']")?.textContent).toContain(
      "hey @you look at checkout",
    );
    const mention = [...host.querySelectorAll(".slack-activity-item")].find((el) =>
      el.textContent?.includes("mentioned you"),
    );
    await act(async () => {
      mention!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "selectSlackChannel", id: "C_ENG" });
    expect(dispatch).toHaveBeenCalledWith({ type: "slackThread", ts: "1710000001.0" });
  });

  it("stops a running bound Slack session without leaving Slack", async () => {
    const bound: AgentSession = {
      id: "s-bound",
      title: "Slack",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "openai",
      model: "gpt-4.1",
      status: "running",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      slack: { teamId: "T_MOCK", channelId: "C_ENG", threadTs: "1710000001.0" },
    };
    vi.mocked(api.slackRun).mockResolvedValue({ sessionId: "s-bound", created: false });
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      sessions: [bound],
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
    });
    const stop = [...host.querySelectorAll("button")].find((el) => el.textContent === "Stop");
    expect(stop).toBeTruthy();
    await act(async () => {
      stop!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackRun).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "C_ENG",
        text: "stop",
        threadTs: "1710000001.0",
      }),
    );
    expect(dispatch).not.toHaveBeenCalledWith({ type: "select", id: "s-bound" });
  });

  it("shows Running or Waiting in Locus for a bound Slack session, not as channel text", () => {
    const bound: AgentSession = {
      id: "s-bound",
      title: "Slack",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "openai",
      model: "gpt-4.1",
      status: "running",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      slack: { teamId: "T_MOCK", channelId: "C_ENG", threadTs: "1710000001.0" },
    };
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      sessions: [bound],
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
    });
    const chip = host.querySelector('[data-testid="slack-locus-status"]');
    expect(chip?.textContent).toBe("Running");
    rerender({
      ...initialState,
      section: "slack",
      config: slackConfig,
      sessions: [{ ...bound, status: "idle", needsHuman: "Approve git_push" }],
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
    });
    expect(host.querySelector('[data-testid="slack-locus-status"]')?.textContent).toBe("Waiting");
    rerender({
      ...initialState,
      section: "slack",
      config: slackConfig,
      sessions: [{ ...bound, status: "idle", needsHuman: undefined }],
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
    });
    expect(host.querySelector('[data-testid="slack-locus-status"]')).toBeNull();
  });

  it("starts header Ask Locus in the open thread drawer", async () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
      slackThreadTs: "1710000001.0",
    });
    const header = host.querySelector(".slack-head");
    const ask = [...header!.querySelectorAll("button")].find(
      (el) => el.textContent === "Ask Locus",
    );
    expect(ask).toBeTruthy();
    await act(async () => {
      ask!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const form = host.querySelector(".slack-drawer .slack-ask") as HTMLFormElement | null;
    expect(form).toBeTruthy();
    expect(host.querySelector(".slack-ask--channel")).toBeNull();
    const input = form!.querySelector("input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "from the header while the thread is open");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const run = [...form!.querySelectorAll("button")].find((el) => el.textContent === "Run");
      run?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackRun).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "C_ENG",
        threadTs: "1710000001.0",
        text: "from the header while the thread is open",
      }),
    );
  });

  it("opens Ask Locus inside the thread drawer", async () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
      slackThreadTs: "1710000001.0",
    });
    const drawer = host.querySelector(".slack-drawer");
    expect(drawer).toBeTruthy();
    const ask = [...drawer!.querySelectorAll("button")].find(
      (el) => el.textContent === "Ask Locus",
    );
    expect(ask).toBeTruthy();
    await act(async () => {
      ask!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const form = drawer!.querySelector(".slack-ask") as HTMLFormElement | null;
    expect(form).toBeTruthy();
    expect(form?.className).toContain("slack-ask--thread");
    expect(host.querySelector(".slack-ask--channel")).toBeNull();
    expect(form?.textContent).toContain("Thread · #eng");
    expect(form?.querySelector(".slack-ask-bar .model-picker-wrap")).toBeTruthy();
    expect(
      [...form!.querySelectorAll(".slack-ask-actions button")].map((el) => el.textContent),
    ).toEqual(["Cancel", "Run"]);
    expect(css).toMatch(/\.slack-ask--thread \.model-picker-wrap \{[\s\S]*?flex:\s*1 1 auto/);
    expect(css).toMatch(/\.slack-ask \.model-picker\.compact \{[\s\S]*?flex-wrap:\s*nowrap/);
    const input = form!.querySelector("input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "summarize this thread");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const run = [...form!.querySelectorAll("button")].find((el) => el.textContent === "Run");
      run?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackRun).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "C_ENG",
        threadTs: "1710000001.0",
        text: "summarize this thread",
      }),
    );
  });

  it("hides the thread gutter until a thread is open", () => {
    render();
    expect(host.querySelector(".slack-thread-gutter")).toBeNull();
    expect(host.querySelector(".slack-split")?.classList.contains("has-thread")).toBe(false);
  });

  it("resizes the thread drawer from the gutter", () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
      slackThreadTs: "1710000001.0",
    });
    const gutter = host.querySelector(".slack-thread-gutter") as HTMLDivElement;
    expect(gutter).toBeTruthy();
    expect(gutter.getAttribute("aria-label")).toBe("Resize thread");
    expect((host.querySelector(".slack-split") as HTMLElement).style.gridTemplateColumns).toBe(
      "minmax(0, 1fr) 6px 360px",
    );
    act(() => {
      gutter.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 360, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 280, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 280, pointerId: 1 }),
      );
    });
    expect((host.querySelector(".slack-split") as HTMLElement).style.gridTemplateColumns).toBe(
      "minmax(0, 1fr) 6px 440px",
    );
    expect(localStorage.getItem(SLACK_THREAD_WIDTH_KEY)).toBe("440");
    act(() => {
      gutter.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 440, pointerId: 2 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: -200, pointerId: 2 }),
      );
    });
    expect((host.querySelector(".slack-split") as HTMLElement).style.gridTemplateColumns).toBe(
      "minmax(0, 1fr) 6px 560px",
    );
    expect(css).toMatch(/\.slack-thread-gutter \{[\s\S]*?cursor:\s*col-resize/);
    expect(css).toMatch(/\.slack-split\.has-thread \{[\s\S]*?display:\s*grid/);
  });

  it("renders Slack quotes, bold, and strikethrough instead of raw &gt;", () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        {
          ts: "1710000200.0",
          channelId: "C_ENG",
          userId: "U_YOU",
          userName: "you",
          text: "&gt; I asked Opus 5 to do a review\n&gt; of *checkout*\n\nplease ~ship~ it",
        },
      ],
    });
    const quote = host.querySelector(".slack-md .md-quote");
    expect(quote).toBeTruthy();
    expect(quote?.textContent).toContain("I asked Opus 5 to do a review");
    expect(quote?.textContent).not.toContain("&gt;");
    expect(host.textContent).not.toContain("&gt;");
    expect(host.querySelector(".slack-md strong")?.textContent).toBe("checkout");
    expect(host.querySelector(".slack-md del")?.textContent).toBe("ship");
  });

  it("renders GIFs posted in the channel", () => {
    render();
    const gif = host.querySelector(".slack-gif") as HTMLImageElement | null;
    expect(gif?.getAttribute("src")).toBe(
      "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
    );
    expect(gif?.getAttribute("alt")).toBe("thumbs up");
    expect(gif?.getAttribute("decoding")).toBe("async");
    expect(host.querySelector(".slack-media-caption")?.textContent).toBe("thumbs up");
    expect((host.querySelector(".slack-media-link") as HTMLElement | null)?.style.aspectRatio).toBe(
      "16 / 9",
    );
  });

  it("opens a Slack image in a near-fullscreen viewer instead of a new tab", async () => {
    render();
    const open = host.querySelector(".slack-media-link") as HTMLAnchorElement | null;
    expect(open?.tagName).toBe("A");
    expect(open?.getAttribute("href")).toContain("l0MYt5jPR6QX5pnqM");
    expect(open?.getAttribute("target")).toBe("_blank");
    await act(async () => {
      open!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    });
    expect(document.querySelector("[data-testid='slack-image-viewer']")).toBeNull();
    await act(async () => {
      open!.click();
    });
    const viewer = document.querySelector("[data-testid='slack-image-viewer']");
    expect(viewer).toBeTruthy();
    expect(document.activeElement).toBe(viewer);
    expect((viewer?.querySelector("img") as HTMLImageElement | null)?.src).toContain(
      "l0MYt5jPR6QX5pnqM",
    );
    expect(css).toMatch(/\.slack-image-viewer \{[\s\S]*?position:\s*fixed/);
    expect(css).toMatch(/\.slack-image-viewer-img \{[\s\S]*?height:\s*min\(92vh/);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector("[data-testid='slack-image-viewer']")).toBeNull();
  });

  it("steps through a Slack image gallery in the viewer", async () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        {
          ts: "1710000100.0",
          channelId: "C_ENG",
          userId: "U_YOU",
          userName: "you",
          text: "Ask for screenshots",
          files: [
            {
              url: "https://files.slack.com/files-pri/T1/F1/a.png",
              title: "image.png",
              mime: "image/png",
            },
            {
              url: "https://files.slack.com/files-pri/T1/F1/b.png",
              title: "image.png",
              mime: "image/png",
            },
          ],
        },
      ],
    });
    const thumbs = [...host.querySelectorAll(".slack-media-link")] as HTMLAnchorElement[];
    expect(thumbs).toHaveLength(2);
    await act(async () => {
      thumbs[0]!.click();
    });
    const viewer = document.querySelector("[data-testid='slack-image-viewer']");
    expect((viewer?.querySelector("img") as HTMLImageElement | null)?.src).toContain("/a.png");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(
      (document.querySelector("[data-testid='slack-image-viewer'] img") as HTMLImageElement).src,
    ).toContain("/b.png");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(
      (document.querySelector("[data-testid='slack-image-viewer'] img") as HTMLImageElement).src,
    ).toContain("/a.png");
    await act(async () => {
      (viewer?.querySelector("[aria-label='Next image']") as HTMLButtonElement).click();
    });
    expect(
      (document.querySelector("[data-testid='slack-image-viewer'] img") as HTMLImageElement).src,
    ).toContain("/b.png");
    await act(async () => {
      (
        document.querySelector(
          "[data-testid='slack-image-viewer'] [aria-label='Previous image']",
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      (document.querySelector("[data-testid='slack-image-viewer'] img") as HTMLImageElement).src,
    ).toContain("/a.png");
    await act(async () => {
      (
        document.querySelector(
          "[data-testid='slack-image-viewer'] [aria-label='Close']",
        ) as HTMLButtonElement
      ).click();
    });
    expect(document.querySelector("[data-testid='slack-image-viewer']")).toBeNull();
  });

  it("renders screenshot batches as a gallery without image.png captions", () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        {
          ts: "1710000100.0",
          channelId: "C_ENG",
          userId: "U_YOU",
          userName: "you",
          text: "Ask for screenshots",
          files: [
            {
              url: "https://files.slack.com/files-pri/T1/F1/a.png",
              title: "image.png",
              mime: "image/png",
            },
            {
              url: "https://files.slack.com/files-pri/T1/F1/b.png",
              title: "image.png",
              mime: "image/png",
            },
          ],
        },
      ],
    });
    const gallery = host.querySelector(".slack-media");
    expect(gallery?.className).toContain("slack-media--gallery");
    expect(gallery?.getAttribute("data-count")).toBe("2");
    expect(host.querySelectorAll(".slack-img")).toHaveLength(2);
    expect(host.querySelector(".slack-media-caption")).toBeNull();
    expect(host.textContent).not.toContain("image.png");
  });

  it("renders HTML uploads as a sandboxed inline preview", () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        {
          ts: "1710000120.0",
          channelId: "C_ENG",
          userId: "U_ALICE",
          userName: "alice",
          text: "Would you be able to cast your eyes on this please",
          files: [
            {
              url: "/api/slack/media?url=https%3A%2F%2Ffiles.slack.com%2Ffiles-pri%2FT1%2FF1%2Fcloud-connect-printer-faq.html",
              title: "cloud-connect-printer-faq.html",
              mime: "text/html",
              permalink: "https://team.slack.com/files/U1/F1/cloud-connect-printer-faq.html",
            },
          ],
        },
      ],
    });
    expect(host.querySelector(".slack-img")).toBeNull();
    expect(host.querySelector(".slack-media")).toBeNull();
    const chip = host.querySelector(".slack-file") as HTMLAnchorElement | null;
    expect(chip?.textContent).toContain("cloud-connect-printer-faq.html");
    expect(chip?.querySelector(".slack-file-kind")?.textContent).toBe("HTML");
    expect(chip?.getAttribute("href")).toBe(
      "https://team.slack.com/files/U1/F1/cloud-connect-printer-faq.html",
    );
    expect(chip?.getAttribute("target")).toBe("_blank");
    const frame = host.querySelector(".slack-html-frame") as HTMLIFrameElement | null;
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("src")).toBe(
      "/api/slack/media?url=https%3A%2F%2Ffiles.slack.com%2Ffiles-pri%2FT1%2FF1%2Fcloud-connect-printer-faq.html&preview=1",
    );
    expect(css).toMatch(/\.slack-file \{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/\.slack-html-frame \{[\s\S]*?height:\s*280px/);
  });

  it("renders PDF uploads as an inline preview", () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        {
          ts: "1710000120.5",
          channelId: "C_ENG",
          userId: "U_ALICE",
          userName: "alice",
          text: "Q3 plan as PDF",
          files: [
            {
              url: "/api/slack/media?url=https%3A%2F%2Ffiles.slack.com%2Ffiles-pri%2FT1%2FF1%2Fq3-plan.pdf",
              title: "q3-plan.pdf",
              mime: "application/pdf",
              permalink: "https://team.slack.com/files/U1/F1/q3-plan.pdf",
            },
          ],
        },
      ],
    });
    expect(host.querySelector(".slack-img")).toBeNull();
    expect(host.querySelector(".slack-media")).toBeNull();
    const chip = host.querySelector(
      "[data-testid='slack-pdf'] .slack-file",
    ) as HTMLAnchorElement | null;
    expect(chip?.textContent).toContain("q3-plan.pdf");
    expect(chip?.querySelector(".slack-file-kind")?.textContent).toBe("PDF");
    expect(chip?.getAttribute("href")).toBe("https://team.slack.com/files/U1/F1/q3-plan.pdf");
    const frame = host.querySelector(".slack-pdf-frame") as HTMLIFrameElement | null;
    expect(frame).toBeTruthy();
    expect(frame?.hasAttribute("sandbox")).toBe(false);
    expect(frame?.getAttribute("src")).toBe(
      "/api/slack/media?url=https%3A%2F%2Ffiles.slack.com%2Ffiles-pri%2FT1%2FF1%2Fq3-plan.pdf&preview=1",
    );
    expect(css).toMatch(/\.slack-pdf-frame \{[\s\S]*?height:\s*420px/);
  });

  it("renders CSV uploads as an inline table preview", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("sku,qty\nA-100,12\nB-200,4\n", {
        headers: { "content-type": "text/csv" },
      }),
    );
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        {
          ts: "1710000122.0",
          channelId: "C_ENG",
          userId: "U_ALICE",
          userName: "alice",
          text: "inventory export",
          files: [
            {
              url: "/api/slack/media?url=https%3A%2F%2Ffiles.slack.com%2Ffiles-pri%2FT1%2FF1%2Finventory.csv",
              title: "inventory.csv",
              mime: "text/csv",
              permalink: "https://team.slack.com/files/U1/F1/inventory.csv",
            },
          ],
        },
      ],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalled();
    const table = host.querySelector("[data-testid='slack-csv'] table");
    expect(table?.textContent).toContain("sku");
    expect(table?.textContent).toContain("A-100");
    expect(host.querySelector(".slack-file-kind")?.textContent).toBe("CSV");
    expect(css).toMatch(/\.slack-csv-scroll \{[\s\S]*?max-height:\s*280px/);
  });

  it("renders video uploads in an inline player", () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        {
          ts: "1710000123.0",
          channelId: "C_ENG",
          userId: "U_YOU",
          userName: "you",
          text: "walkthrough",
          files: [
            {
              url: "/api/slack/media?url=https%3A%2F%2Ffiles.slack.com%2Ffiles-pri%2FT1%2FF1%2Fwalkthrough.mp4",
              title: "walkthrough.mp4",
              mime: "video/mp4",
            },
          ],
        },
      ],
    });
    const video = host.querySelector(
      "[data-testid='slack-video'] video",
    ) as HTMLVideoElement | null;
    expect(video?.getAttribute("controls")).not.toBeNull();
    expect(video?.getAttribute("preload")).toBe("none");
    expect(video?.getAttribute("src")).toContain("walkthrough.mp4");
    expect(video?.getAttribute("title")).toBe("Slack video");
    expect(video?.style.aspectRatio).toBe("16 / 9");
    expect(host.querySelector(".slack-file")).toBeNull();
    expect(host.querySelector(".slack-media-caption")).toBeNull();
    expect(css).toMatch(/\.slack-video-player \{[\s\S]*?aspect-ratio:\s*16\s*\/\s*9/);
    expect(css).toMatch(/\.slack-video \{[\s\S]*?position:\s*relative/);
    expect(css).toMatch(/\.slack-video \.slack-media-caption \{[\s\S]*?position:\s*static/);
    expect(css).toMatch(/\.slack-timeline \{[\s\S]*?overscroll-behavior:\s*contain/);
    expect(css).toMatch(
      /\.slack-media:not\(\.slack-media--gallery\) \.slack-media-link \{[\s\S]*?max-height:\s*260px/,
    );
    expect(css).toMatch(
      /\.slack-media--gallery \{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(118px,\s*1fr\)\)/,
    );
    expect(css).toMatch(/\.slack-media--gallery \{[\s\S]*?max-width:\s*none/);
    expect(css).toMatch(
      /\.slack-media--gallery \.slack-media-link \{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3/,
    );
    expect(css).not.toMatch(/\.slack-msg \{[\s\S]*?content-visibility:\s*auto/);
  });

  it("hides GNOME screencast filenames so they do not overlay reactions", () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        {
          ts: "1710000124.0",
          channelId: "C_ENG",
          userId: "U_YOU",
          userName: "you",
          text: "Also coming to release 26.06 is the ability to reorder sibling fields in the rules builder.",
          files: [
            {
              url: "/api/slack/media?url=https%3A%2F%2Ffiles.slack.com%2Ffiles-pri%2FT1%2FF1%2Fscreencast.mp4",
              title: "Screencast from 2026-08-17 12-11-59.mp4",
              mime: "video/mp4",
            },
          ],
          reactions: [
            { name: "fire", count: 1 },
            { name: "+1", count: 2 },
          ],
        },
      ],
    });
    expect(host.querySelector("[data-testid='slack-video'] video")).toBeTruthy();
    expect(host.querySelector(".slack-media-caption")).toBeNull();
    expect(
      (host.querySelector("[data-testid='slack-video'] video") as HTMLVideoElement | null)?.title,
    ).toBe("Slack video");
    expect(host.querySelector(".slack-reactions")?.textContent).toContain("2");
    expect(host.querySelectorAll(".slack-reaction")).toHaveLength(3);
  });

  it("still captions Slack videos that have a real title", () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        {
          ts: "1710000125.0",
          channelId: "C_ENG",
          userId: "U_YOU",
          userName: "you",
          text: "demo",
          files: [
            {
              url: "/api/slack/media?url=https%3A%2F%2Ffiles.slack.com%2Ffiles-pri%2FT1%2FF1%2Fdemo.mp4",
              title: "Q3 demo walkthrough",
              mime: "video/mp4",
            },
          ],
        },
      ],
    });
    expect(host.querySelector(".slack-media-caption")?.textContent).toBe("Q3 demo walkthrough");
    expect(
      (host.querySelector("[data-testid='slack-video'] video") as HTMLVideoElement | null)?.title,
    ).toBe("Q3 demo walkthrough");
  });

  it("keeps screenshots in a gallery when a document is also attached", () => {
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        {
          ts: "1710000121.0",
          channelId: "C_ENG",
          userId: "U_YOU",
          userName: "you",
          text: "notes plus shots",
          files: [
            {
              url: "https://files.slack.com/files-pri/T1/F1/a.png",
              title: "image.png",
              mime: "image/png",
            },
            {
              url: "https://files.slack.com/files-pri/T1/F1/b.png",
              title: "image.png",
              mime: "image/png",
            },
            {
              url: "https://files.slack.com/files-pri/T1/F1/notes.pdf",
              title: "notes.pdf",
              mime: "application/pdf",
            },
          ],
        },
      ],
    });
    const gallery = host.querySelector(".slack-media");
    expect(gallery?.className).toContain("slack-media--gallery");
    expect(gallery?.getAttribute("data-count")).toBe("2");
    expect(host.querySelectorAll(".slack-img")).toHaveLength(2);
    expect(host.querySelector(".slack-file-name")?.textContent).toBe("notes.pdf");
    expect(host.querySelector(".slack-file-kind")?.textContent).toBe("PDF");
    expect(host.querySelector("[data-testid='slack-pdf']")).toBeTruthy();
    expect(host.querySelector(".slack-pdf-frame")).toBeNull();
  });

  it("posts a Giphy GIF from the composer picker", async () => {
    render();
    const gifBtn = [...host.querySelectorAll("button")].find((el) => el.textContent === "GIF");
    expect(gifBtn).toBeTruthy();
    await act(async () => {
      gifBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const hit = host.querySelector(".slack-gif-hit") as HTMLButtonElement | null;
    expect(hit).toBeTruthy();
    expect(host.textContent).toContain("Local catalog");
    await act(async () => {
      hit!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackPost).toHaveBeenCalledWith(
      "C_ENG",
      "",
      undefined,
      expect.objectContaining({
        url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
        title: "Thumbs up",
      }),
      "user",
      false,
    );
  });

  it("shows a loading skeleton while channel history loads", async () => {
    let resolveHistory: (rows: SlackMessage[]) => void = () => undefined;
    vi.mocked(api.slackHistory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );
    render({
      ...initialState,
      section: "slack",
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [],
    });
    expect(host.querySelector("[data-testid='slack-history-skeleton']")).toBeTruthy();
    await act(async () => {
      resolveHistory(history);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='slack-history-skeleton']")).toBeNull();
  });

  it("shows a workspace skeleton before Slack status arrives", () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: null,
      slackConversations: [],
      selectedSlackChannelId: null,
      slackMessages: [],
    });
    expect(host.querySelector("[data-testid='slack-booting']")).toBeTruthy();
    expect(host.querySelector("[data-testid='slack-history-skeleton']")).toBeTruthy();
    expect(host.querySelector(".slack-loading")?.textContent).toBe("Loading workspace…");
    expect(host.querySelector(".slack-composer--pending")).toBeTruthy();
    expect(host.textContent).not.toContain("Sign in as yourself");
    expect(host.textContent).not.toContain("Pick a channel");
    expect(host.querySelector("textarea")).toBeNull();
    expect(css).toMatch(/\.slack-composer--pending \{[\s\S]*?pointer-events:\s*none/);
  });

  it("keeps the workspace skeleton when Slack is already linked but live status is still disconnected", () => {
    render({
      ...initialState,
      section: "slack",
      config: {
        ...slackConfig,
        integrations: [
          {
            id: "slack-1",
            kind: "slack",
            name: "Slack",
            enabled: true,
            baseUrl: "https://slack.com/api",
            userId: "U_YOU",
            userName: "you",
            teamId: "T_MOCK",
            teamName: "Locus Dev",
          },
        ],
      },
      slackStatus: { connected: false, socket: "down" },
      slackConversations: [],
      selectedSlackChannelId: null,
      slackMessages: [],
    });
    expect(host.querySelector("[data-testid='slack-booting']")).toBeTruthy();
    expect(host.querySelector("[data-testid='slack-history-skeleton']")).toBeTruthy();
    expect(host.querySelector(".slack-loading")?.textContent).toBe("Loading workspace…");
    expect(host.textContent).not.toContain("Sign in as yourself");
    expect(host.textContent).not.toContain("Pick a channel");
    expect(host.querySelector(".slack-empty")).toBeNull();
  });

  it("keeps the workspace skeleton when status is connected but the channel catalog has not arrived", () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: [],
      selectedSlackChannelId: null,
      slackMessages: [],
    });
    expect(host.querySelector("[data-testid='slack-booting']")).toBeTruthy();
    expect(host.textContent).not.toContain("Pick a channel");
    expect(host.textContent).not.toContain("Sign in as yourself");
  });

  it("waits for the channel catalog before leaving the Slack loading state", async () => {
    let resolveConversations: (rows: SlackConversation[]) => void = () => undefined;
    vi.mocked(api.slackConversations).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConversations = resolve;
        }),
    );
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: null,
      slackConversations: [],
      selectedSlackChannelId: null,
      slackMessages: [],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "slackStatus" }));
    expect(host.querySelector("[data-testid='slack-booting']")).toBeTruthy();
    await act(async () => {
      resolveConversations(conversations);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "slackStatus", status });
    expect(dispatch).toHaveBeenCalledWith({ type: "slackConversations", conversations });
  });

  it("leaves the loading skeleton if Slack status cannot be fetched", async () => {
    vi.mocked(api.slackStatus).mockRejectedValueOnce(new Error("status down"));
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: null,
      slackConversations: [],
      selectedSlackChannelId: null,
      slackMessages: [],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "slackStatus",
      status: { connected: false, socket: "down" },
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "slackCatalogLoaded" });
    expect(host.textContent).toContain("status down");
  });

  it("renders avatars, unicode emoji, and reaction chips", async () => {
    render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const avatar = host.querySelector(".slack-avatar img") as HTMLImageElement | null;
    expect(avatar?.getAttribute("src")).toBe("https://ca.slack-edge.com/T_MOCK-U_ALICE.png");
    expect(host.querySelector(".slack-emoji-char")?.textContent).toBe("👋");
    expect(host.querySelector(".slack-reaction")?.textContent).toContain("2");
    expect(host.querySelector('[aria-label="Star #eng"]')).toBeTruthy();
  });

  it("groups Slack like the official sidebar: Unreads, Starred, Channels, DMs", () => {
    const groups = slackChannelGroups([
      { id: "C_ENG", name: "eng", kind: "channel" },
      { id: "C_OPS", name: "ops", kind: "channel", starred: true, unread: true },
      { id: "D_BOB", name: "bob", kind: "im" },
    ]);
    expect(groups.map((row) => row.id)).toEqual(["unreads", "starred", "channels", "dms"]);
    expect(groups[0]?.items.map((row) => row.id)).toEqual(["C_OPS"]);
    expect(groups[1]?.items.map((row) => row.id)).toEqual(["C_OPS"]);
    expect(groups[2]?.items.map((row) => row.id)).toEqual(["C_ENG", "C_OPS"]);
    expect(groups[3]?.items.map((row) => row.id)).toEqual(["D_BOB"]);
  });

  it("renders clickable Slack alert toasts", () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    mounted = true;
    act(() => {
      root.render(
        <SlackAlertToasts
          items={[
            {
              id: "D_BOB:1",
              kind: "dm",
              channelId: "D_BOB",
              channelName: "bob",
              ts: "1.0",
              text: "got a minute?",
              userName: "bob",
            },
          ]}
          onOpen={onOpen}
          onDismiss={onDismiss}
        />,
      );
    });
    expect(host.querySelector("[data-testid='slack-toasts']")).toBeTruthy();
    expect(host.querySelector("[data-testid='slack-toast']")?.textContent).toContain(
      "got a minute?",
    );
    act(() => {
      host
        .querySelector(".slack-toast-open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "D_BOB:1" }));
    expect(css).toMatch(/\.slack-toasts \{/);
  });

  it("holds Slack on a loading skeleton until the catalog probe finishes", () => {
    const linked = slackConfig.integrations;
    expect(
      slackWorkspaceBooting({
        slackStatus: { connected: false, socket: "down" },
        slackConversations: [],
        integrations: [
          {
            id: "slack-1",
            kind: "slack",
            name: "Slack",
            enabled: true,
            baseUrl: "https://slack.com/api",
            userName: "you",
            teamName: "Locus Dev",
          },
        ],
      }),
    ).toBe(true);
    expect(
      slackWorkspaceBooting({
        slackStatus: status,
        slackConversations: [],
        integrations: linked,
      }),
    ).toBe(true);
    expect(
      slackWorkspaceBooting({
        slackStatus: { connected: false, socket: "down" },
        slackConversations: [],
        slackCatalogLoaded: true,
        integrations: linked,
      }),
    ).toBe(false);
    expect(
      slackWorkspaceBooting({
        slackStatus: { connected: false, socket: "down" },
        slackConversations: [],
        integrations: [],
      }),
    ).toBe(false);
    expect(
      slackWorkspaceBooting({
        slackStatus: null,
        slackConversations: [],
        integrations: [],
      }),
    ).toBe(true);
  });

  it("toggles an existing reaction chip as you", async () => {
    render();
    const chip = host.querySelector(".slack-reaction") as HTMLButtonElement | null;
    expect(chip?.textContent).toContain("2");
    await act(async () => {
      chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackReact).toHaveBeenCalledWith(
      "C_ENG",
      "1710000001.0",
      "eyes",
      expect.objectContaining({ remove: false }),
    );
  });

  it("adds a reaction from the hover picker", async () => {
    render();
    const add = host.querySelector('[aria-label="Add reaction"]') as HTMLButtonElement | null;
    expect(add).toBeTruthy();
    await act(async () => {
      add!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector('[aria-label="Choose a reaction"]')).toBeTruthy();
    const hit = [...host.querySelectorAll(".slack-react-hit")].find(
      (el) => el.getAttribute("title") === ":+1:",
    );
    expect(hit).toBeTruthy();
    await act(async () => {
      hit!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackReact).toHaveBeenCalledWith(
      "C_ENG",
      "1710000001.0",
      "+1",
      expect.objectContaining({ remove: false }),
    );
  });

  it("shows React on message hover", async () => {
    render();
    const msg = host.querySelector(".slack-msg") as HTMLElement | null;
    expect(msg).toBeTruthy();
    await act(async () => {
      msg!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      msg!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    const react = [...host.querySelectorAll("button")].find((el) => el.textContent === "React");
    expect(react).toBeTruthy();
  });

  it("stacks the thread reaction picker above later replies", async () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
      slackThreadTs: "1710000001.0",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const drawer = host.querySelector(".slack-drawer") as HTMLElement | null;
    expect(drawer).toBeTruthy();
    const msgs = [...drawer!.querySelectorAll(".slack-msg")];
    expect(msgs.length).toBeGreaterThan(1);
    await act(async () => {
      msgs[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      msgs[0].dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    const react = [...msgs[0].querySelectorAll("button")].find((el) => el.textContent === "React");
    expect(react).toBeTruthy();
    await act(async () => {
      react!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const picker = drawer!.querySelector(".slack-react-picker");
    expect(picker).toBeTruthy();
    expect(msgs[0].contains(picker)).toBe(true);
    expect(msgs[1].contains(picker)).toBe(false);
    expect(css).toMatch(/\.slack-msg:has\(\.slack-react-picker\) \{[\s\S]*?z-index:\s*3/);
  });

  it("does not poll channel history on a timer", () => {
    const delays: number[] = [];
    const real = window.setInterval.bind(window);
    vi.spyOn(window, "setInterval").mockImplementation(((
      handler: TimerHandler,
      ms?: number,
      ...args: unknown[]
    ) => {
      delays.push(Number(ms));
      return real(handler, ms, ...args);
    }) as typeof setInterval);
    render();
    expect(delays).toContain(60_000);
    expect(delays).not.toContain(15_000);
  });

  it("unwatches Slack history when the pane unmounts", async () => {
    render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackHistory).toHaveBeenCalled();
    vi.mocked(api.slackUnwatch).mockClear();
    act(() => root.unmount());
    mounted = false;
    expect(api.slackUnwatch).toHaveBeenCalled();
  });

  it("does not refetch thread replies when channel history grows", async () => {
    const base: UiState = {
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
      slackThreadTs: "1710000001.0",
    };
    render(base);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const calls = vi.mocked(api.slackReplies).mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    const extra: SlackMessage = {
      ts: "1710000998.0",
      channelId: "C_ENG",
      userId: "U_BOB",
      userName: "bob",
      text: "later",
    };
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...base, slackMessages: [...history, extra] },
            dispatch: dispatch as unknown as Dispatch<Action>,
          }}
        >
          <SlackPane />
        </Store.Provider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(vi.mocked(api.slackReplies).mock.calls.length).toBe(calls);
  });

  it("picks a remembered channel, then unread, then starred, then the first channel", () => {
    expect(pickDefaultSlackChannel(conversations, "D_BOB")).toBe("D_BOB");
    expect(
      pickDefaultSlackChannel([
        { id: "C_ENG", name: "eng", kind: "channel" },
        { id: "C_OPS", name: "ops", kind: "channel", starred: true },
        { id: "D_BOB", name: "bob", kind: "im", unread: true },
      ]),
    ).toBe("D_BOB");
    expect(
      pickDefaultSlackChannel([
        { id: "C_ENG", name: "eng", kind: "channel" },
        { id: "C_OPS", name: "ops", kind: "channel", starred: true },
        { id: "D_BOB", name: "bob", kind: "im" },
      ]),
    ).toBe("C_OPS");
    expect(pickDefaultSlackChannel(conversations)).toBe("C_ENG");
    expect(pickDefaultSlackChannel([])).toBeUndefined();
  });

  it("opens the last channel when the pane has no selection", () => {
    window.localStorage.setItem(LAST_SLACK_CHANNEL_KEY, "D_BOB");
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: null,
      slackMessages: [],
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "selectSlackChannel", id: "D_BOB" });
  });

  it("asks the operator to pick a channel when none are listed", () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: [],
      slackCatalogLoaded: true,
      selectedSlackChannelId: null,
      slackMessages: [],
    });
    expect(host.textContent).toContain("Pick a channel");
    expect(host.textContent).toContain("sidebar");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector(".empty-hero h2")?.textContent).toBe("Pick a channel");
  });

  it("pins the timeline when you scroll up and jumps back to latest", async () => {
    render();
    const pane = host.querySelector(".slack-main .slack-timeline") as HTMLDivElement;
    expect(pane).toBeTruthy();
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 80 });
    Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: 0 });
    act(() => {
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const jump = host.querySelector("[data-testid='slack-jump-latest']") as HTMLButtonElement;
    expect(jump).toBeTruthy();
    expect(pane.scrollTop).toBe(0);
    act(() => {
      jump.click();
    });
    expect(host.querySelector("[data-testid='slack-jump-latest']")).toBeNull();
    expect(pane.scrollTop).toBe(1000);
  });

  it("keeps the timeline pinned when loaded history grows in height", () => {
    const observed: ResizeObserverCallback[] = [];
    const Previous = globalThis.ResizeObserver;
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        observed.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    try {
      render();
      const pane = host.querySelector(".slack-main .slack-timeline") as HTMLDivElement;
      expect(pane.querySelector(".slack-timeline-inner")).toBeTruthy();
      Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 1400 });
      Object.defineProperty(pane, "clientHeight", { configurable: true, value: 80 });
      Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: 0 });
      act(() => {
        for (const cb of observed) {
          cb([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
        }
      });
      expect(pane.scrollTop).toBe(1400);
      expect(host.querySelector("[data-testid='slack-jump-latest']")).toBeNull();
      expect(css).toMatch(/\.slack-timeline \{[\s\S]*?scrollbar-gutter:\s*stable/);
      expect(css).toMatch(/\.slack-timeline-inner \{[\s\S]*?justify-content:\s*flex-end/);
    } finally {
      globalThis.ResizeObserver = Previous;
    }
  });

  it("keeps a mid-channel scroll when new messages arrive", () => {
    const base: UiState = {
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
    };
    render(base);
    const pane = host.querySelector(".slack-main .slack-timeline") as HTMLDivElement;
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 80 });
    Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: 400 });
    act(() => {
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='slack-jump-latest']")).toBeTruthy();
    rerender({
      ...base,
      slackMessages: [
        ...history,
        {
          ts: "1710000998.0",
          channelId: "C_ENG",
          userId: "U_BOB",
          userName: "bob",
          text: "later",
        },
      ],
    });
    expect(host.querySelector("[data-testid='slack-jump-latest']")).toBeTruthy();
    expect(pane.scrollTop).toBe(400);
  });

  it("re-pins the timeline when you send after scrolling up", async () => {
    render();
    const pane = host.querySelector(".slack-main .slack-timeline") as HTMLDivElement;
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 80 });
    Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: 0 });
    act(() => {
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='slack-jump-latest']")).toBeTruthy();
    const box = host.querySelector(".slack-main textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "on it");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const send = [...host.querySelectorAll("button")].find((el) => el.textContent === "Send");
      send?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='slack-jump-latest']")).toBeNull();
    expect(pane.scrollTop).toBe(1000);
  });

  it("restores a per-channel composer draft after switching conversations", async () => {
    const eng: UiState = {
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
    };
    render(eng);
    const box = host.querySelector(".slack-main textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "draft for eng");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    rerender({
      ...eng,
      selectedSlackChannelId: "D_BOB",
      slackMessages: [],
    });
    const switched = host.querySelector(".slack-main textarea") as HTMLTextAreaElement;
    expect(switched?.value).toBe("");
    expect(switched?.getAttribute("placeholder")).toBe("Message @bob");
    rerender(eng);
    expect((host.querySelector(".slack-main textarea") as HTMLTextAreaElement).value).toBe(
      "draft for eng",
    );
  });

  it("shows DM history when a direct message is open", async () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "D_BOB",
      slackMessages: dmHistory,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[aria-label='Star @bob']")).toBeTruthy();
    expect(host.querySelector(".slack-main textarea")?.getAttribute("placeholder")).toBe(
      "Message @bob",
    );
    expect(host.textContent).toContain("got a minute?");
    expect(vi.mocked(api.slackHistory)).toHaveBeenCalledWith("D_BOB");
  });

  it("closes the thread drawer on Escape", () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
      slackThreadTs: "1710000001.0",
    });
    expect(host.querySelector(".slack-drawer")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "slackThread", ts: null });
  });

  it("marks the open thread parent in the channel timeline", () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
      slackThreadTs: "1710000001.0",
    });
    expect(host.querySelector(".slack-main .slack-msg.thread-open")).toBeTruthy();
    expect(css).toMatch(
      /\.slack-msg\.thread-open \{[\s\S]*?box-shadow:\s*inset 3px 0 0 var\(--accent\)/,
    );
  });

  it("marks a private channel with a lock instead of a hash", () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: [{ id: "G_SHIP", name: "shipyard", kind: "private", topic: "Work" }],
      selectedSlackChannelId: "G_SHIP",
      slackMessages: [],
    });
    const star = host.querySelector(".slack-star-btn");
    expect(star?.getAttribute("aria-label")).toBe(`Star \u{1F512}shipyard`);
    expect(host.querySelector("textarea")?.getAttribute("placeholder")).toBe(
      `Message \u{1F512}shipyard`,
    );
    expect(css).toMatch(/\.slack-kind-mark\.lock \{[\s\S]*?margin-right:\s*var\(--space-1-5\)/);
  });

  it("shows your Slack profile photo on messages you send", () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        {
          ts: "1710000999.0",
          channelId: "C_ENG",
          userId: "U_YOU",
          userName: "you",
          text: "This is just a test",
        },
      ],
    });
    const you = host.querySelector(".slack-msg.you .slack-avatar img") as HTMLImageElement | null;
    expect(you?.getAttribute("src")).toBe("https://ca.slack-edge.com/T_MOCK-U_YOU.png");
    expect(host.querySelector(".slack-msg.you .slack-avatar")?.textContent).not.toContain("YO");
  });

  it("shows also-sent-to-channel thread replies in the channel timeline", () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [
        ...history,
        {
          ts: "1710000002.0",
          channelId: "C_ENG",
          threadTs: "1710000001.0",
          userId: "U_YOU",
          userName: "you",
          text: "on it in the thread only",
        },
        {
          ts: "1710000002.5",
          channelId: "C_ENG",
          threadTs: "1710000001.0",
          userId: "U_YOU",
          userName: "you",
          text: "I'll trace whether the TruncDate fallback only dirties activity-log JSON.",
          subtype: "thread_broadcast",
          replyBroadcast: true,
        },
      ],
    });
    const main = host.querySelector(".slack-main") as HTMLElement;
    expect(main.textContent).toContain(
      "I'll trace whether the TruncDate fallback only dirties activity-log JSON.",
    );
    expect(main.textContent).not.toContain("on it in the thread only");
    const banner = host.querySelector("[data-testid='slack-also-sent']");
    expect(banner?.textContent).toContain("Also sent to the channel");
    expect(css).toMatch(/\.slack-broadcast \{/);
    act(() => {
      banner?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "slackThread", ts: "1710000001.0" });
  });

  it("marks the open conversation as read after history loads", async () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations.map((row) =>
        row.id === "D_BOB" ? { ...row, unread: true } : row,
      ),
      selectedSlackChannelId: "D_BOB",
      slackMessages: [],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackMarkRead).toHaveBeenCalledWith("D_BOB", "1710000200.0");
  });

  it("edits and deletes your own Slack messages", async () => {
    const youMsg = {
      ts: "1710000999.0",
      channelId: "C_ENG",
      userId: "U_YOU",
      userName: "you",
      text: "typo",
    };
    vi.mocked(api.slackHistory).mockResolvedValue([youMsg]);
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: [youMsg],
    });
    const msg = host.querySelector(".slack-msg.you") as HTMLElement;
    expect(msg).toBeTruthy();
    await act(async () => {
      msg.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      msg.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    const edit = host.querySelector("[data-testid='slack-edit']") as HTMLButtonElement;
    expect(edit).toBeTruthy();
    await act(async () => {
      edit.click();
    });
    const field = host.querySelector("[data-testid='slack-edit-field']") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(field, "fixed");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const save = [...host.querySelectorAll("button")].find((el) => el.textContent === "Save");
      save?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackUpdate).toHaveBeenCalledWith("C_ENG", "1710000999.0", "fixed", "user");
    await act(async () => {
      msg.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='slack-delete']")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackDelete).toHaveBeenCalledWith("C_ENG", "1710000999.0", "user");
  });

  it("inserts an @mention from the composer picker", async () => {
    render();
    const box = host.querySelector(".slack-main textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "@bo");
      box.selectionStart = 3;
      box.selectionEnd = 3;
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.dispatchEvent(new Event("select", { bubbles: true }));
    });
    const picker = host.querySelector("[data-testid='slack-mention-picker']");
    expect(picker?.textContent).toContain("@bob");
    await act(async () => {
      picker!
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(box.value).toBe("@bob ");
    await act(async () => {
      const send = [...host.querySelectorAll("button")].find((el) => el.textContent === "Send");
      send?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackPost).toHaveBeenCalledWith(
      "C_ENG",
      "<@U_BOB|bob>",
      undefined,
      undefined,
      "user",
      false,
    );
  });

  it("sends a thread reply as you and keeps it if replies reload without it", async () => {
    let resolveReplies: ((rows: SlackMessage[]) => void) | undefined;
    vi.mocked(api.slackReplies).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReplies = resolve;
        }),
    );
    vi.mocked(api.slackPost).mockImplementation(async (_id, text) => ({
      ts: "1710000999.0",
      channelId: "C_ENG",
      userId: "U_YOU",
      userName: "you",
      text,
    }));
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
      slackThreadTs: "1710000001.0",
    });
    const box = host.querySelector(".slack-drawer textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "on it from the thread");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const send = [...host.querySelectorAll(".slack-drawer button")].find(
        (el) => el.textContent === "Reply",
      );
      send?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackPost).toHaveBeenCalledWith(
      "C_ENG",
      "on it from the thread",
      "1710000001.0",
      undefined,
      "user",
      false,
    );
    const drawer = host.querySelector(".slack-drawer") as HTMLElement;
    expect(drawer.textContent).toContain("on it from the thread");
    expect(drawer.textContent).toContain("You");
    await act(async () => {
      resolveReplies?.(history);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(drawer.textContent).toContain("on it from the thread");
    const channelTexts = [...host.querySelectorAll(".slack-main .slack-msg")].map(
      (el) => el.textContent ?? "",
    );
    expect(channelTexts.some((text) => text.includes("on it from the thread"))).toBe(false);
  });

  it("also-sends a thread reply to the channel", async () => {
    render({
      ...initialState,
      section: "slack",
      config: slackConfig,
      slackStatus: status,
      slackConversations: conversations,
      selectedSlackChannelId: "C_ENG",
      slackMessages: history,
      slackThreadTs: "1710000001.0",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const check = host.querySelector("[data-testid='slack-also-channel']") as HTMLInputElement;
    expect(check).toBeTruthy();
    expect(check.checked).toBe(false);
    await act(async () => {
      check.click();
    });
    expect(check.checked).toBe(true);
    vi.mocked(api.slackPost).mockClear();
    const box = host.querySelector(".slack-drawer textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "also in channel");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const send = [...host.querySelectorAll(".slack-drawer button")].find(
        (el) => el.textContent === "Reply",
      );
      send?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.slackPost).toHaveBeenLastCalledWith(
      "C_ENG",
      "also in channel",
      "1710000001.0",
      undefined,
      "user",
      true,
    );
  });

  it("links the open channel to Slack.app", () => {
    render();
    const link = host.querySelector("[data-testid='slack-open-slack']") as HTMLAnchorElement;
    expect(link?.getAttribute("href")).toBe("https://app.slack.com/client/T_MOCK/C_ENG");
  });
});
