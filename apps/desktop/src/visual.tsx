import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  UBUNTU_DEFAULT_HARDWARE,
  defaultNetworking,
  resolveTheme,
  type AgentSession,
  type LocusConfig,
  parseSlackReviewers,
  type ThemeId,
  customThemeFromInput,
  type CustomTheme,
} from "@locus/shared";
import { NewAutomationModal } from "@/components/automations/NewAutomation";
import { NewSessionModal } from "@/components/chat/NewSession";
import { ChatThread } from "@/components/chat/ChatThread";
import { KeyboardShortcutsSheet } from "@/components/layout/KeyboardShortcutsSheet";
import { EmptyHero, EmptyHint } from "@/components/layout/EmptyHero";
import { Splitter } from "@/components/layout/Splitter";
import { ConfirmModal } from "@/components/layout/ConfirmModal";
import { PromptModal } from "@/components/layout/PromptModal";
import { NoticeBanner } from "@/components/layout/NoticeBanner";
import { BusyButton, ErrorBanner, InlineError, Skeleton } from "@/components/layout/Skeleton";
import { Tooltip } from "@/components/layout/Tooltip";
import { DialogHost } from "@/components/layout/DialogHost";
import { Sidebar } from "@/components/layout/Sidebar";
import { InboxPane } from "@/components/layout/InboxPane";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { Settings } from "@/components/settings/Settings";
import { DesignEmpty } from "@/components/design/DesignEmpty";
import { IdeEmpty } from "@/components/workspace/IdeEmpty";
import { AndroidPane } from "@/components/android/AndroidPane";
import { Topbar } from "@/components/layout/Topbar";
import { DesignCanvas } from "@/components/design/DesignCanvas";
import { WorkspaceBody } from "@/components/workspace/WorkspaceBody";
import { WorkspaceStage } from "@/components/workspace/WorkspaceStage";
import { api } from "@/lib/api";
import { showUndoNotice } from "@/lib/notice";
import { applyTheme } from "@/lib/theme";
import { useDrawerSidebar } from "@/lib/useDrawerSidebar";
import { Store, initialState, type Action, type UiState } from "@/state/store";
import "./index.css";
import "./styles/phone.css";
import "./styles/swarm.css";
import "./styles/ux.css";
import "./styles/themeStyles.css";
import "./styles/themeEditor.css";

const SCREENS = [
  "new-agent",
  "new-automation",
  "empty-hero",
  "rail",
  "sidebar",
  "confirm",
  "prompt",
  "toast",
  "appearance",
  "appearance-generated",
  "design-empty",
  "ide-empty",
  "android-start",
  "android-canvas",
  "design-canvas",
  "settings-providers",
  "settings-reviewers",
  "inbox",
  "feedback",
  "shortcuts",
  "chat",
  "empty-hint",
  "splitter",
] as const;
type VisualScreen = (typeof SCREENS)[number];

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

function stubApi(): void {
  api.images = async () => [];
  api.workersStatus = async () => [];
  api.createSession = async () => {
    throw new Error("visual harness");
  };
  api.createAutomation = async () => {
    throw new Error("visual harness");
  };
  api.browseHost = async () => ({ path: "", parent: null, entries: [] });
  api.saveConfig = async (next) => next;
  api.slackStatus = async () => ({ connected: true, socket: "up", canPostAsBot: true });
  api.slackConversations = async () => [
    { id: "C1", name: "pr-reviews", kind: "channel" },
    { id: "C2", name: "web", kind: "channel" },
  ];
  api.slackReviewerTrace = async (id) => ({
    id,
    reviewerId: "r1",
    pr: "acme/api#482",
    kind: "review",
    model: "gpt-4.1",
    startedAt: "2026-11-21T10:03:10.000Z",
    finishedAt: "2026-11-21T10:04:00.000Z",
    steps: [
      {
        kind: "prompt",
        text: "Pull request acme/api#482: Add rate limiting to /login\n\n```diff\n+ app.use(limit({ window: 60 }))\n```",
        at: "2026-11-21T10:03:10.000Z",
      },
      {
        kind: "thinking",
        text: "The limiter is mounted after the auth router, so /login is not covered. Check where routes are registered.",
        at: "2026-11-21T10:03:12.000Z",
      },
      {
        kind: "tool",
        id: "t1",
        tool: "grep",
        args: '{"pattern":"app.use\\(","path":"src"}',
        output:
          "src/server.ts:14: app.use(authRouter)\nsrc/server.ts:15: app.use(limit({ window: 60 }))",
        at: "2026-11-21T10:03:14.000Z",
      },
      {
        kind: "tool",
        id: "t2",
        tool: "read_file",
        args: '{"path":"src/server.ts"}',
        output:
          "12  const app = express();\n13\n14  app.use(authRouter);\n15  app.use(limit({ window: 60 }));",
        at: "2026-11-21T10:03:16.000Z",
      },
      {
        kind: "text",
        text: '{"verdict":"comment","summary":"Limiter is mounted after the auth router.","comments":[…]}',
        at: "2026-11-21T10:03:58.000Z",
      },
    ],
  });
  api.modelUsage = async () => ({
    since: "2026-11-21T08:00:00.000Z",
    models: [
      {
        providerId: "openai-review",
        providerName: "OpenAI",
        model: "gpt-4.1",
        inputTokens: 124_608,
        outputTokens: 8_422,
        estimatedTokens: 0,
        unpricedTokens: 0,
        usd: 0.29,
      },
      {
        providerId: "ollama-local",
        providerName: "Ollama",
        model: "qwen3-coder",
        inputTokens: 38_241,
        outputTokens: 2_123,
        estimatedTokens: 0,
        unpricedTokens: 0,
        usd: 0,
      },
    ],
  });
  api.slackReviewerRuns = async () => ({
    runs: [
      {
        reviewerId: "r1",
        pr: "acme/api#482",
        url: "https://github.com/acme/api/pull/482",
        outcome: "commented",
        model: "gpt-4.1",
        usage: { inputTokens: 10_240, outputTokens: 640, cachedInputTokens: 3_100 },
        usd: 0.0256,
        comments: 3,
        at: "2026-11-21T10:04:00.000Z",
        channelId: "C1",
        threadTs: "1763719440.000100",
        traceId: "3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f",
      },
      {
        reviewerId: "r1",
        pr: "acme/api#479",
        url: "https://github.com/acme/api/pull/479",
        outcome: "skipped",
        reason: "it is a draft",
        at: "2026-11-21T09:51:00.000Z",
      },
    ],
    active: [
      {
        reviewerId: "r1",
        pr: "acme/api#490",
        url: "https://github.com/acme/api/pull/490",
        kind: "review",
        status: "running",
        since: "2026-11-21T10:12:00.000Z",
        channelId: "C1",
        threadTs: "1763719920.000200",
      },
    ],
    threads: [
      {
        reviewerId: "r1",
        pr: "acme/api#482",
        url: "https://github.com/acme/api/pull/482",
        channelId: "C1",
        threadTs: "1763719440.000100",
        at: "2026-11-21T10:04:00.000Z",
        answers: 1,
      },
    ],
  });
  api.hypervisor = async () => ({ kind: "mock", capabilities: {} }) as never;
  api.tailscale = async () =>
    ({ installed: false, running: false, loggedIn: false, funnelEnabled: false }) as never;
  api.phone = async () =>
    ({ enabled: false, listenHost: "127.0.0.1", port: 7420, urls: [] }) as never;
  api.chromeExtension = async () =>
    ({
      enabled: false,
      installDir: "/tmp/locus/chrome-extension",
      connected: false,
      tabs: [],
    }) as never;
  api.setup = async () => null as never;
  api.canvas = async () => ({
    html: "<html><body><h1>Hello</h1></body></html>",
    path: "/workspace/index.html",
    mtime: "2020-01-01T00:00:00.000Z",
  });
  api.workspaceFile = async () => {
    throw new Error("visual harness");
  };
  api.checkUpdates = async () =>
    ({
      status: "unavailable",
      current: "0.29.0",
      message: "No GitHub release found yet.",
    }) as never;
}

function parseScreen(raw: string | null): VisualScreen {
  return SCREENS.find((row) => row === raw) ?? "new-agent";
}

function parseThemeParam(raw: string | null): ThemeId {
  return resolveTheme(raw ?? "ember");
}

const visualSession = {
  id: "s1",
  title: "Fix login",
  os: "ubuntu" as const,
  templateId: "ubuntu-24.04",
  providerId: "p1",
  model: "gpt-4.1",
  status: "idle" as const,
  vmId: "v1",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

function visualState(screen: VisualScreen, theme: ThemeId): UiState {
  const themed = { ...config, theme };
  if (screen === "android-start" || screen === "android-canvas")
    return {
      ...initialState,
      config: themed,
      section: "android",
      // The device panel follows the topbar toggle; the harness can't dispatch, so open it.
      vmCollapsed: false,
      selectedId: screen === "android-canvas" ? "s1" : null,
      sessions:
        screen === "android-canvas"
          ? [
              {
                ...visualSession,
                vmId: undefined,
                runtime: "host",
                playbook: "LOCUS_ANDROID_WORKFLOW",
                title: "Habit tracker",
              },
            ]
          : [],
    };
  if (screen === "design-canvas") {
    return {
      ...initialState,
      config: themed,
      section: "design",
      selectedId: "d1",
      vmCollapsed: false,
      connected: true,
      sessions: [
        {
          ...visualSession,
          id: "d1",
          title: "Landing page",
          kind: "design",
          runtime: "docker",
          dockerImage: "ubuntu:24.04",
        } as AgentSession,
      ],
      vms: [
        {
          id: "v1",
          sessionId: "d1",
          templateId: "ubuntu-24.04",
          os: "ubuntu",
          name: "Design",
          status: "ready",
          runtime: "docker",
          diskPath: "/tmp/ws",
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    };
  }
  if (screen === "new-agent") {
    return { ...initialState, config: themed, newOpen: true, newRuntime: "docker" };
  }
  if (screen === "new-automation") {
    return { ...initialState, config: themed, newAutomationOpen: true };
  }
  if (screen === "design-empty") {
    return { ...initialState, config: themed, section: "design" };
  }
  if (screen === "ide-empty") {
    return { ...initialState, config: themed, section: "ide" };
  }
  if (screen === "settings-reviewers") {
    return {
      ...initialState,
      config: {
        ...themed,
        slackReviewers: parseSlackReviewers([
          {
            id: "r1",
            name: "API reviews",
            channelId: "C1",
            prompt:
              "Focus on auth checks, SQL built from strings, and missing timeouts. Follow /house-rules.",
            repos: ["acme/api"],
          },
          {
            id: "r2",
            name: "Web reviews",
            channelId: "",
            forgeMode: "verdict",
            providerId: "claude-code",
          },
        ]),
        providers: [
          ...themed.providers,
          {
            id: "claude-code",
            name: "Claude Code",
            kind: "claude-code",
            baseUrl: "claude-code://local",
            models: [],
            defaultModel: "",
            enabled: true,
            extraHeaders: {},
          },
        ],
        skills: [
          {
            id: "k1",
            name: "house-rules",
            title: "House rules",
            hint: "Team conventions for API code",
            body: "Every handler checks the caller's org. No raw SQL outside the repository layer.",
          },
          {
            id: "k2",
            name: "migrations",
            title: "Migration safety",
            hint: "Locking and backfills",
            body: "Flag migrations that lock large tables or backfill in one transaction.",
          },
        ],
      },
      section: "settings",
      settingsTab: "reviewers",
    };
  }
  if (screen === "inbox") {
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const agent = (over: Partial<AgentSession>) =>
      ({ ...visualSession, updatedAt: ago(30), ...over }) as AgentSession;
    return {
      ...initialState,
      config: {
        ...themed,
        slackReviewers: parseSlackReviewers([
          { id: "r1", name: "API reviews", channelId: "C1", repos: ["acme/api"] },
        ]),
      },
      section: "agents",
      inboxOpen: true,
      connected: true,
      sessions: [
        agent({
          id: "s2",
          title: "Ship rate limiter",
          runtime: "docker",
          messages: [
            {
              id: "m1",
              role: "assistant",
              content: "Running the suite before I push.",
              createdAt: ago(2),
              toolCalls: [
                {
                  id: "c1",
                  name: "exec",
                  arguments: { command: "npm test -- --run" },
                  startedAt: ago(2),
                  approval: "needed",
                },
              ],
            },
          ],
        } as Partial<AgentSession>),
        agent({ id: "s3", title: "Answer: which region?", needsHuman: "Which AWS region?" }),
        agent({
          id: "s4",
          title: "Migrate billing to Stripe v2",
          status: "running",
          updatedAt: ago(1),
          subagents: [
            { id: "x1", task: "Explore webhooks", status: "running" },
            { id: "x2", task: "Write tests", status: "running" },
          ],
        }),
        agent({
          id: "s5",
          title: "Onboarding hero",
          kind: "design",
          status: "running",
          updatedAt: ago(4),
        }),
        agent({ id: "s6", title: "Spin up worker", status: "provisioning", updatedAt: ago(0) }),
        agent({
          id: "s7",
          title: "Review acme/web#211",
          kind: "review",
          status: "running",
          updatedAt: ago(3),
          pull: { number: 211, url: "https://github.com/acme/web/pull/211", title: "Nav" },
        }),
        agent({ id: "s8", title: "Fix login", updatedAt: ago(45) }),
        agent({ id: "s9", title: "Dependency bumps", updatedAt: ago(180) }),
      ],
      automations: [
        {
          id: "a1",
          name: "Nightly triage",
          enabled: true,
          schedule: { kind: "interval", everyMinutes: 1440 },
          nextRunAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
        },
        {
          id: "a2",
          name: "Flaky test sweep",
          enabled: true,
          schedule: { kind: "interval", everyMinutes: 360 },
        },
      ] as never,
      runs: [
        { id: "u1", automationId: "a1", status: "running", trigger: "schedule", startedAt: ago(6) },
        {
          id: "u2",
          automationId: "a2",
          status: "succeeded",
          trigger: "schedule",
          startedAt: ago(70),
          finishedAt: ago(62),
        },
        {
          id: "u3",
          automationId: "a1",
          status: "failed",
          trigger: "manual",
          startedAt: ago(300),
          finishedAt: ago(290),
        },
      ] as never,
    };
  }
  if (screen === "settings-providers") {
    return { ...initialState, config: themed, section: "settings", settingsTab: "providers" };
  }
  if (screen === "appearance") {
    return { ...initialState, config: themed, section: "settings", settingsTab: "appearance" };
  }
  if (screen === "sidebar" || screen === "rail") {
    return {
      ...initialState,
      config: {
        ...themed,
        workers: [
          {
            id: "cloud-worker",
            name: "Cloud worker",
            url: "https://worker.example.com",
            kind: "cloud",
          },
        ],
      },
      section: "agents",
      connected: true,
      sessions: [
        visualSession as AgentSession,
        {
          ...visualSession,
          id: "s2",
          title: "Review checkout",
          placement: "worker",
          backendId: "cloud-worker",
          needsHuman: "Approve git_push",
          updatedAt: "2020-01-02T00:00:00.000Z",
        } as AgentSession,
      ],
    };
  }
  return { ...initialState, config: themed, section: "agents" };
}

function ToastPreview() {
  useEffect(() => {
    showUndoNotice("Archived 1 idle chat", () => undefined);
  }, []);
  return <NoticeBanner />;
}

function FeedbackPreview() {
  return (
    <div className="visual-feedback" data-testid="visual-feedback">
      <ErrorBanner message="Could not load Grafana" onRetry={() => undefined} />
      <InlineError message="That folder is not writable." />
      <Skeleton lines={3} label="Loading board" />
      <BusyButton className="btn primary" busy busyLabel="Saving…">
        Save
      </BusyButton>
      <Tooltip label="Send" disabledReason="Write a message first">
        <button type="button" className="btn primary small" disabled>
          Send
        </button>
      </Tooltip>
      <Tooltip label="Full screen files">
        <button type="button" className="btn icon ghost">
          FS
        </button>
      </Tooltip>
      <EmptyHero
        eyebrow="Docker"
        pose="rest"
        title="No containers"
        lead="Start an agent, or run something with the Docker CLI — it will show up here."
      />
    </div>
  );
}

function EmptyHintPreview() {
  return (
    <div className="visual-feedback" data-testid="visual-empty-hint">
      <EmptyHint title="No plugins yet." lead="Ask an agent to add a plugin for an internal API." />
      <EmptyHint title="No firing alerts." />
      <EmptyHint title="No pull requests." />
    </div>
  );
}

function SplitterPreview() {
  return (
    <div className="visual-feedback" data-testid="visual-splitter">
      <p className="hint">Pull request list</p>
      <div
        className="pr-inbox-split"
        style={{
          display: "grid",
          gridTemplateColumns: "240px 6px minmax(0, 1fr)",
          minHeight: 120,
          border: "1px solid var(--line)",
        }}
      >
        <div className="pr-inbox-list" style={{ padding: 12 }}>
          <EmptyHint title="No pull requests." />
        </div>
        <Splitter
          className="pr-inbox-gutter"
          orientation="vertical"
          label="Resize pull request list"
          value={240}
          min={240}
          max={560}
          valueText="240 pixels"
        />
        <div className="pr-inbox-detail" style={{ padding: 12 }}>
          <EmptyHint title="Select a pull request." />
        </div>
      </div>
    </div>
  );
}

function ShortcutsPreview() {
  return (
    <div className="modal switcher" role="dialog" aria-label="Keyboard shortcuts">
      <h2 className="palette-shortcuts-title">Keyboard shortcuts</h2>
      <KeyboardShortcutsSheet />
      <div className="modal-actions">
        <button type="button" className="btn">
          Close
        </button>
      </div>
    </div>
  );
}

function ChatPreview() {
  const threadRef = useRef<HTMLDivElement>(null);
  return (
    <div className="body" data-testid="visual-chat">
      <ChatThread
        threadRef={threadRef}
        onScroll={() => undefined}
        followLatest
        session={visualSession as AgentSession}
        clusters={[]}
        messages={[]}
        viewing={null}
        swarmMode={false}
        thoughtTraces={false}
        hideLifecycleIds={new Set()}
        findHits={[]}
        turnDiffs={new Map()}
        waitingGuest={false}
        waitingStartNote={false}
        showTailWorking={false}
        workingLabel="Thinking"
        thinkingSnippet=""
        turning={false}
        teamMembers={[]}
        hostChat={false}
        docker
        onOpenPath={() => undefined}
        onOpenSubagent={() => undefined}
        onEditLast={() => undefined}
        onRetryLast={() => undefined}
        onCopyText={() => undefined}
        onRemoveSubscription={() => undefined}
      />
    </div>
  );
}

const SAMPLE_GENERATED: CustomTheme[] = [
  customThemeFromInput(
    {
      id: "custom-mission-control",
      name: "Mission Control",
      summary: "Amber console glass over a starfield grid.",
      scheme: "dark",
      colors: { bg: "#0d0b08", text: "#ffe9c2", accent: "#ffb000", accent2: "#5ad1ff" },
      layout: {
        radius: 2,
        borderWidth: 1,
        shadow: "glow",
        pane: "glass",
        background: "grid",
        sidebar: "inverted",
        bubble: "quote",
        button: "glow",
      },
      type: { font: "tech", headingFont: "tech", headingCase: "upper", headingTracking: 0.12 },
      effects: { scanlines: true, vignette: true },
      origin: "ai",
    },
    { now: "2026-01-01T00:00:00.000Z" },
  ),
  customThemeFromInput(
    {
      id: "custom-picnic",
      name: "Picnic",
      summary: "Gingham reds, rounded pills and a handwritten menu.",
      scheme: "light",
      colors: { bg: "#fff8ef", text: "#2b1b14", accent: "#d6453d", accent2: "#3c8d5a" },
      layout: {
        radius: 20,
        controls: "pill",
        borderWidth: 2,
        borderStyle: "dashed",
        shadow: "hard",
        background: "dots",
        sidebar: "accent",
        bubble: "accent",
        button: "filled",
      },
      type: { font: "rounded", headingFont: "hand" },
      effects: { lift: true },
    },
    { now: "2026-01-01T00:00:00.000Z" },
  ),
];

/** Appearance with working generated-theme state, for the Generated filter and editor. */
function GeneratedAppearance() {
  const [themes, setThemes] = useState<CustomTheme[]>(SAMPLE_GENERATED);
  const [selected, setSelected] = useState<string>(SAMPLE_GENERATED[0]!.id);
  useEffect(() => {
    applyTheme(selected, themes);
  }, [selected, themes]);
  return (
    <div className="settings-pane visual-appearance">
      <AppearanceSettings
        theme={selected}
        savedTheme={selected}
        customThemes={themes}
        providers={config.providers}
        editorFontSize={13}
        formatOnSave
        showMinimap
        onSelect={setSelected}
        onCustomThemes={(next, select) => {
          setThemes(next);
          if (select) setSelected(select);
        }}
        onEditor={() => undefined}
      />
    </div>
  );
}

function Screen(props: { screen: VisualScreen; theme: ThemeId; drawer: boolean }): ReactNode {
  if (props.screen === "android-start" || props.screen === "android-canvas")
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <Topbar />
        <AndroidPane />
      </div>
    );
  if (props.screen === "design-canvas") {
    return (
      <div className="desktop-shell">
        <div className="app">
          <Sidebar />
          <main className="workspace">
            <WorkspaceStage section="design" enter={null}>
              <WorkspaceBody
                variant="design"
                collapsed={false}
                topbarToggle
                chat={<section className="chat" data-testid="visual-design-chat" />}
                preview={<DesignCanvas />}
              />
            </WorkspaceStage>
          </main>
        </div>
        <NoticeBanner />
      </div>
    );
  }
  if (props.screen === "new-agent") return <NewSessionModal />;
  if (props.screen === "new-automation") return <NewAutomationModal />;
  if (props.screen === "confirm") {
    return (
      <ConfirmModal
        title="Delete job?"
        body="This cannot be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );
  }
  if (props.screen === "prompt") {
    return (
      <PromptModal
        title="Name this golden image"
        value="Web app image"
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );
  }
  if (props.screen === "toast") return <ToastPreview />;
  if (props.screen === "appearance") {
    return (
      <div className="settings-pane visual-appearance">
        <AppearanceSettings
          theme={props.theme}
          savedTheme={props.theme}
          editorFontSize={13}
          formatOnSave
          showMinimap
          onSelect={() => undefined}
          onEditor={() => undefined}
        />
      </div>
    );
  }
  if (props.screen === "appearance-generated") return <GeneratedAppearance />;
  if (props.screen === "design-empty") return <DesignEmpty />;
  if (props.screen === "ide-empty") return <IdeEmpty />;
  if (props.screen === "settings-providers" || props.screen === "settings-reviewers")
    return <Settings />;
  if (props.screen === "feedback") return <FeedbackPreview />;
  if (props.screen === "shortcuts") return <ShortcutsPreview />;
  if (props.screen === "chat") return <ChatPreview />;
  if (props.screen === "empty-hint") return <EmptyHintPreview />;
  if (props.screen === "splitter") return <SplitterPreview />;
  if (props.screen === "inbox") {
    return (
      <div className={props.drawer ? "app collapsed" : "app"}>
        <Sidebar />
        <main className="workspace">
          <InboxPane />
        </main>
      </div>
    );
  }
  if (props.screen === "rail") {
    return (
      <div className="app collapsed">
        <Sidebar />
        <div />
      </div>
    );
  }
  if (props.screen === "sidebar") {
    return (
      <div className="app">
        <Sidebar />
        <div />
      </div>
    );
  }
  return (
    <div className="empty design-start">
      <div className="empty-card">
        <EmptyHero
          title="Board"
          lead="A local planning canvas. Stickies, frames, diagrams, live cards, and Locus on the canvas — no guest."
        />
      </div>
    </div>
  );
}

function Harness(props: { screen: VisualScreen; theme: ThemeId }) {
  const [inboxFocusKey, setInboxFocusKey] = useState<string | null>(null);
  const drawer = useDrawerSidebar();
  useEffect(() => {
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body) active.blur();
        document.documentElement.dataset.visualReady = "true";
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, [props.screen, props.theme]);

  return (
    <Store.Provider
      value={{
        state: {
          ...visualState(props.screen, props.theme),
          ...(props.screen === "inbox" ? { inboxFocusKey, collapsed: drawer } : {}),
        },
        dispatch: (action: Action) => {
          if (props.screen === "inbox" && action.type === "inboxFocus")
            setInboxFocusKey(action.key);
        },
      }}
    >
      <DialogHost />
      <Screen screen={props.screen} theme={props.theme} drawer={drawer} />
    </Store.Provider>
  );
}

(window as { visualNotice?: (text: string) => void }).visualNotice = (text) =>
  showUndoNotice(text, () => undefined);

const params = new URLSearchParams(window.location.search);
const screen = parseScreen(params.get("screen"));
const theme = parseThemeParam(params.get("theme"));
stubApi();
applyTheme(theme);
createRoot(document.getElementById("root")!).render(<Harness screen={screen} theme={theme} />);
