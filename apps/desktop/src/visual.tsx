import { useEffect, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  UBUNTU_DEFAULT_HARDWARE,
  defaultNetworking,
  resolveTheme,
  type AgentSession,
  type LocusConfig,
  type ThemeId,
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
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { Settings } from "@/components/settings/Settings";
import { DesignEmpty } from "@/components/design/DesignEmpty";
import { IdeEmpty } from "@/components/workspace/IdeEmpty";
import { api } from "@/lib/api";
import { showUndoNotice } from "@/lib/notice";
import { applyTheme } from "@/lib/theme";
import { Store, initialState, type Action, type UiState } from "@/state/store";
import "./index.css";
import "./styles/phone.css";
import "./styles/swarm.css";
import "./styles/ux.css";

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
  "design-empty",
  "ide-empty",
  "settings-providers",
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
  api.checkUpdates = async () =>
    ({
      status: "unavailable",
      current: "0.19.0",
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
  if (screen === "settings-providers") {
    return { ...initialState, config: themed, section: "settings", settingsTab: "providers" };
  }
  if (screen === "appearance") {
    return { ...initialState, config: themed, section: "settings", settingsTab: "appearance" };
  }
  if (screen === "sidebar" || screen === "rail") {
    return {
      ...initialState,
      config: themed,
      section: "agents",
      connected: true,
      sessions: [
        visualSession as AgentSession,
        {
          ...visualSession,
          id: "s2",
          title: "Review checkout",
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

function Screen(props: { screen: VisualScreen; theme: ThemeId }): ReactNode {
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
  if (props.screen === "design-empty") return <DesignEmpty />;
  if (props.screen === "ide-empty") return <IdeEmpty />;
  if (props.screen === "settings-providers") return <Settings />;
  if (props.screen === "feedback") return <FeedbackPreview />;
  if (props.screen === "shortcuts") return <ShortcutsPreview />;
  if (props.screen === "chat") return <ChatPreview />;
  if (props.screen === "empty-hint") return <EmptyHintPreview />;
  if (props.screen === "splitter") return <SplitterPreview />;
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
        state: visualState(props.screen, props.theme),
        dispatch: (_action: Action) => undefined,
      }}
    >
      <DialogHost />
      <Screen screen={props.screen} theme={props.theme} />
    </Store.Provider>
  );
}

const params = new URLSearchParams(window.location.search);
const screen = parseScreen(params.get("screen"));
const theme = parseThemeParam(params.get("theme"));
stubApi();
applyTheme(theme);
createRoot(document.getElementById("root")!).render(<Harness screen={screen} theme={theme} />);
