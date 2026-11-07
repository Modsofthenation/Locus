import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  desktopNotifyAllowed,
  isBoardSession,
  isProjectSession,
  isDesignSession,
  isGameSession,
  isAssetSession,
  isTestWebhookSkip,
  newSlackActivityItems,
  parseProductMode,
  sessionRuntime,
  shouldNotifySlackActivity,
  shouldFireSlackAlert,
  shouldNotifyAutomationOutcome,
  slackActivityDedupIds,
  slackActivityHeadline,
  slackActivityMentionNames,
  slackAlertBody,
  slackMessageActivityItem,
  isWorkspaceWriteTool,
  isSessionListView,
  workspaceFollowFromTool,
  type SlackActivityItem,
} from "@locus/shared";
import { ArtifactDrawer } from "@/components/chat/ArtifactDrawer";
import { BootReveal, BootScreen } from "@/components/layout/BootScreen";
import { ProductModeTransition } from "@/components/layout/ProductModeTransition";
import { CloseGuard } from "@/components/layout/CloseGuard";
import { DesignEmpty } from "@/components/design/DesignEmpty";
import { GameEmpty } from "@/components/game/GameEmpty";
import { AssetEmpty } from "@/components/assets/AssetEmpty";
import { IdeEmpty } from "@/components/workspace/IdeEmpty";
import { EmptyState } from "@/components/layout/EmptyState";
import { SessionSwitcher } from "@/components/layout/SessionSwitcher";
import { FeatureChecklist } from "@/components/layout/FeatureChecklist";
import { NoticeBanner } from "@/components/layout/NoticeBanner";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { WorkspaceBody } from "@/components/workspace/WorkspaceBody";
import { WorkspaceStage } from "@/components/workspace/WorkspaceStage";
import { SwarmComputerPanel } from "@/components/layout/SwarmComputerPanel";
import { api, connectEvents, retryEvents } from "@/lib/api";
import { locusWindowTitle } from "@/lib/windowTitle";
import { sleep } from "@/lib/net";
import {
  notifyTurnDone,
  shouldMarkAutomationUnread,
  shouldMarkUnread,
  shouldNotifyAutomationRun,
  shouldNotifyTurn,
  shouldNotifyNeedsYou,
  isFinishedAutomationRun,
} from "@/lib/notify";
import { applyChatDensity, applyEditorPrefs, applyTheme } from "@/lib/theme";
import { resolveUiShell, setUiShell, type UiShell } from "@/lib/mobileShell";
import { needsYouCount, needsYouKeys } from "@/lib/needsYou";
import { phoneToken } from "@/lib/phoneAuth";
import { Store, initialState, isIdeSession, reducer, sectionEnter } from "@/state/store";

const AutomationsPane = lazy(async () => ({
  default: (await import("@/components/automations/Automations")).AutomationsPane,
}));
const BoardPane = lazy(async () => ({
  default: (await import("@/components/board/BoardPane")).BoardPane,
}));
const ProjectPane = lazy(async () => ({
  default: (await import("@/components/projects/ProjectPane")).ProjectPane,
}));
const ChatPane = lazy(async () => ({
  default: (await import("@/components/chat/ChatPane")).ChatPane,
}));
const CodebasePane = lazy(async () => ({
  default: (await import("@/components/codebase/Codebase")).CodebasePane,
}));
const BrainPane = lazy(async () => ({
  default: (await import("@/components/brain/Brain")).BrainPane,
}));
const DesignCanvas = lazy(async () => ({
  default: (await import("@/components/design/DesignCanvas")).DesignCanvas,
}));
const DockerPane = lazy(async () => ({
  default: (await import("@/components/docker/Docker")).DockerPane,
}));
const SlackPane = lazy(async () => ({
  default: (await import("@/components/slack/Slack")).SlackPane,
}));
const GrafanaPane = lazy(async () => ({
  default: (await import("@/components/grafana/Grafana")).GrafanaPane,
}));
const SlackAlertToasts = lazy(async () => ({
  default: (await import("@/components/slack/Slack")).SlackAlertToasts,
}));
const DesignSystemsModal = lazy(async () => ({
  default: (await import("@/components/design/DesignSystems")).DesignSystemsModal,
}));
const AssetStylesModal = lazy(async () => ({
  default: (await import("@/components/assets/AssetStyles")).AssetStylesModal,
}));
const GameStylesModal = lazy(async () => ({
  default: (await import("@/components/game/GameStyles")).GameStylesModal,
}));
const NewAutomationModal = lazy(async () => ({
  default: (await import("@/components/automations/NewAutomation")).NewAutomationModal,
}));
const NewSessionModal = lazy(async () => ({
  default: (await import("@/components/chat/NewSession")).NewSessionModal,
}));
const SessionSettings = lazy(async () => ({
  default: (await import("@/components/chat/SessionSettings")).SessionSettings,
}));
const Settings = lazy(async () => ({
  default: (await import("@/components/settings/Settings")).Settings,
}));
const SetupWizard = lazy(async () => ({
  default: (await import("@/components/settings/SetupWizard")).SetupWizard,
}));
const VmWorkspace = lazy(async () => ({
  default: (await import("@/components/guest/VmWorkspace")).VmWorkspace,
}));
const HostWorkspace = lazy(async () => ({
  default: (await import("@/components/workspace/HostWorkspace")).HostWorkspace,
}));
const IdeChat = lazy(async () => ({
  default: (await import("@/components/workspace/IdeChat")).IdeChat,
}));
const MobileShell = lazy(async () => ({
  default: (await import("@/components/layout/MobileShell")).MobileShell,
}));

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [shell, setShell] = useState<UiShell>(() => resolveUiShell());
  const [shellReady, setShellReady] = useState(false);
  const [readyForShell, setReadyForShell] = useState(shell);
  const [slackToasts, setSlackToasts] = useState<SlackActivityItem[]>([]);
  const markShellReady = useCallback(() => setShellReady(true), []);
  if (readyForShell !== shell) {
    setReadyForShell(shell);
    setShellReady(false);
  }

  const selectedRef = useRef(state.selectedId);
  const sessionsRef = useRef(state.sessions);
  const sectionRef = useRef(state.section);
  const selectedAutomationRef = useRef(state.selectedAutomationId);
  const automationsRef = useRef(state.automations);
  const configRef = useRef(state.config);
  const workspaceSectionRef = useRef(state.section);
  const workspaceEnterRef = useRef<"forward" | "back" | null>(null);
  const seenGatesRef = useRef(new Set<string>());
  const slackActivityIdsRef = useRef(new Set<string>());
  const slackActivityBootstrappedRef = useRef(false);
  const slackActivityOpenRef = useRef(state.slackActivityOpen);
  const slackActivityRef = useRef(state.slackActivity);
  const slackStatusRef = useRef(state.slackStatus);
  const slackConversationsRef = useRef(state.slackConversations);
  const selectedSlackChannelRef = useRef(state.selectedSlackChannelId);
  const retryBootRef = useRef<() => void>(() => undefined);
  selectedRef.current = state.selectedId;
  sessionsRef.current = state.sessions;
  sectionRef.current = state.section;
  selectedAutomationRef.current = state.selectedAutomationId;
  automationsRef.current = state.automations;
  configRef.current = state.config;
  slackActivityOpenRef.current = state.slackActivityOpen;
  slackActivityRef.current = state.slackActivity;
  slackStatusRef.current = state.slackStatus;
  slackConversationsRef.current = state.slackConversations;
  selectedSlackChannelRef.current = state.selectedSlackChannelId;

  const selectedListView = Boolean(
    state.selectedId &&
    state.sessions.some((row) => row.id === state.selectedId && isSessionListView(row)),
  );
  useEffect(() => {
    const id = state.selectedId;
    if (!id || !selectedListView) return;
    let cancelled = false;
    void api
      .session(id)
      .then((session) => {
        if (!cancelled) dispatch({ type: "session", session });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state.selectedId, selectedListView]);

  function rememberSlackActivity(item: SlackActivityItem) {
    for (const id of slackActivityDedupIds(item)) slackActivityIdsRef.current.add(id);
  }

  function fireSlackAlert(item: SlackActivityItem) {
    if (!shouldFireSlackAlert(item)) return;
    if (
      !desktopNotifyAllowed(configRef.current, "slack") ||
      !shouldNotifySlackActivity({
        hidden: typeof document !== "undefined" && document.hidden,
        section: sectionRef.current,
        activityOpen: slackActivityOpenRef.current,
        selectedChannelId: selectedSlackChannelRef.current,
        itemChannelId: item.channelId,
      })
    ) {
      return;
    }
    const names = slackActivityMentionNames(slackStatusRef.current);
    const body = slackAlertBody(item, names);
    notifyTurnDone(slackActivityHeadline(item), body, true);
    setSlackToasts((rows) => [item, ...rows.filter((row) => row.id !== item.id)].slice(0, 3));
    window.setTimeout(() => {
      setSlackToasts((rows) => rows.filter((row) => row.id !== item.id));
    }, 8000);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      const [
        config,
        sessions,
        vms,
        health,
        automations,
        boards,
        projects,
        runs,
        repos,
        containersSnap,
        designCatalog,
        assetCatalog,
        gameCatalog,
        setup,
      ] = await Promise.all([
        api.config(),
        api.sessions(),
        api.vms(),
        api.health(),
        api.automations(),
        api.boards().catch(() => []),
        api.projects().catch(() => []),
        api.automationRuns(undefined, { limit: 500 }),
        api.repos().catch(() => []),
        api.dockerContainers().catch(() => ({ kind: "mock" as const, containers: [] })),
        api.designSystems().catch(() => ({ systems: [], builtins: [], defaultId: undefined })),
        api.assetStyles().catch(() => ({ styles: [], defaultId: undefined })),
        api.gameStyles().catch(() => ({ styles: [], defaultId: undefined })),
        api.setup().catch(() => null),
      ]);
      if (cancelled) return;
      applyTheme(config.theme);
      applyChatDensity(config.chatDensity);
      dispatch({
        type: "hydrate",
        config: {
          ...config,
          defaultDesignSystemId: config.defaultDesignSystemId ?? designCatalog.defaultId,
          defaultAssetStyleId: config.defaultAssetStyleId ?? assetCatalog.defaultId,
          defaultGameStyleId: config.defaultGameStyleId ?? gameCatalog.defaultId,
        },
        sessions,
        vms,
        automations,
        boards,
        projects,
        runs,
        repos,
        containers: containersSnap.containers,
        designSystems: designCatalog.systems,
        assetStyles: assetCatalog.styles,
        gameStyles: gameCatalog.styles,
        hypervisorKind: health.hypervisor === "qemu" ? "qemu" : "mock",
        dockerKind: health.docker === "docker" ? "docker" : "mock",
        setup: setup ?? undefined,
      });
      seenGatesRef.current = new Set(sessions.flatMap((session) => needsYouKeys(session)));
      dispatch({ type: "error", error: null });
      void api
        .refreshCursorCli()
        .then((result) => {
          if (cancelled || !result?.changed) return;
          dispatch({ type: "config", config: result.config });
        })
        .catch(() => undefined);
      void api
        .brainStatus()
        .then((brain) => {
          if (!cancelled) dispatch({ type: "brain", brain });
        })
        .catch(() => undefined);
    }

    async function resyncLive() {
      try {
        const [sessions, vms, containersSnap] = await Promise.all([
          api.sessions(),
          api.vms(),
          api.dockerContainers().catch(() => ({ kind: "mock" as const, containers: [] })),
        ]);
        if (cancelled) return;
        dispatch({ type: "sessions", sessions });
        dispatch({ type: "vms", vms });
        dispatch({ type: "containers", containers: containersSnap.containers });
        const id = selectedRef.current;
        if (!id) return;
        const session = await api.session(id);
        if (!cancelled) dispatch({ type: "session", session });
      } catch {
        /* keep the last snapshot until the next reconnect */
      }
    }

    async function boot() {
      const delays = [0, 600, 1_500, 3_500];
      for (let i = 0; i < delays.length; i++) {
        if (cancelled) return;
        if (delays[i]) await sleep(delays[i]!);
        try {
          await loadSnapshot();
          return;
        } catch (err) {
          if (!cancelled)
            dispatch({ type: "error", error: err instanceof Error ? err.message : "offline" });
        }
      }
    }

    void boot();
    retryBootRef.current = () => {
      dispatch({ type: "error", error: null });
      retryEvents();
      void loadSnapshot().catch((err) => {
        dispatch({ type: "error", error: err instanceof Error ? err.message : "offline" });
      });
    };
    const stop = connectEvents(
      (event) => {
        switch (event.type) {
          case "session.updated": {
            const prev = seenGatesRef.current;
            if (!event.session.needsHuman?.trim()) prev.delete(`h:${event.session.id}`);
            const fresh = needsYouKeys(event.session).filter((key) => !prev.has(key));
            for (const key of needsYouKeys(event.session)) prev.add(key);
            dispatch({ type: "session", session: event.session });
            if (
              fresh.length &&
              !event.session.automationId &&
              shouldNotifyNeedsYou(event.session.id, selectedRef.current, document.hidden)
            ) {
              if (shouldMarkUnread(event.session.id, selectedRef.current)) {
                dispatch({ type: "unread", id: event.session.id });
              }
              notifyTurnDone(
                event.session.title,
                "Needs you",
                desktopNotifyAllowed(configRef.current, "needsYou"),
              );
            }
            break;
          }
          case "session.deleted":
            dispatch({ type: "deleted", id: event.id });
            break;
          case "vm.updated":
            dispatch({ type: "vm", vm: event.vm });
            break;
          case "chat.message":
            dispatch({
              type: "message",
              sessionId: event.sessionId,
              message: event.message,
            });
            break;
          case "chat.delta":
            dispatch({
              type: "delta",
              sessionId: event.sessionId,
              messageId: event.messageId,
              delta: event.delta,
            });
            break;
          case "chat.thinking":
            dispatch({
              type: "thinking",
              sessionId: event.sessionId,
              snippet: event.snippet,
            });
            break;
          case "chat.thinkingDelta":
            dispatch({
              type: "thinkingDelta",
              sessionId: event.sessionId,
              messageId: event.messageId,
              delta: event.delta,
            });
            break;
          case "clone.progress":
            dispatch({
              type: "cloneProgress",
              sessionId: event.sessionId,
              progress: event.clear
                ? null
                : {
                    percent: event.percent,
                    phase: event.phase,
                    done: event.done,
                    phasePercent: event.phasePercent,
                    received: event.received,
                    total: event.total,
                    size: event.size,
                    rate: event.rate,
                  },
            });
            break;
          case "image.progress":
            dispatch({
              type: "imageProgress",
              sessionId: event.sessionId,
              progress: event.clear
                ? null
                : {
                    percent: event.percent,
                    phase: event.phase,
                    done: event.done,
                    step: event.step,
                    total: event.total,
                    cached: event.cached,
                    detail: event.detail,
                  },
            });
            break;
          case "qemu.install.progress":
            dispatch({
              type: "qemuInstall",
              progress: event.clear
                ? null
                : {
                    phase: event.phase,
                    log: event.log,
                    percent: event.percent,
                    done: event.done,
                    error: event.error,
                  },
            });
            break;
          case "canvas.updated":
            dispatch({ type: "canvas", sessionId: event.sessionId, html: event.html });
            break;
          case "workspace.changed":
            window.dispatchEvent(
              new CustomEvent("locus:workspace-changed", {
                detail: { sessionId: event.sessionId, paths: event.paths },
              }),
            );
            break;
          case "tool.overlay":
            dispatch({ type: "overlay", overlay: event });
            break;
          case "tool.updated": {
            const call = event.toolCall;
            if (!call.finishedAt || call.error) break;
            if (event.sessionId !== selectedRef.current) break;
            if (!isWorkspaceWriteTool(call.name)) break;
            const session = sessionsRef.current.find((row) => row.id === event.sessionId);
            const follow = workspaceFollowFromTool(
              call.name,
              call.arguments ?? {},
              call.result,
              session?.hostDir,
            );
            if (!follow) break;
            dispatch({
              type: "openWorkspace",
              open: {
                sessionId: event.sessionId,
                path: follow.path,
                line: follow.line,
                follow: true,
                at: Date.now(),
              },
            });
            break;
          }
          case "chat.done": {
            dispatch({ type: "thinking", sessionId: event.sessionId, snippet: "" });
            const selectedId = selectedRef.current;
            const session = sessionsRef.current.find((s) => s.id === event.sessionId);
            if (shouldMarkUnread(event.sessionId, selectedId)) {
              dispatch({ type: "unread", id: event.sessionId });
            }
            if (
              !session?.automationId &&
              shouldNotifyTurn(event.sessionId, selectedId, document.hidden)
            ) {
              const title = session?.title ?? "Agent";
              notifyTurnDone(
                title,
                "Turn finished",
                desktopNotifyAllowed(configRef.current, "agents"),
              );
            }
            break;
          }
          case "automation.updated":
            dispatch({ type: "automation", automation: event.automation });
            break;
          case "automation.deleted":
            dispatch({ type: "automationDeleted", id: event.id });
            break;
          case "board.updated":
            dispatch({ type: "board", board: event.board });
            break;
          case "board.deleted":
            dispatch({ type: "boardDeleted", id: event.id });
            break;
          case "project.updated":
            dispatch({ type: "project", project: event.project });
            break;
          case "project.deleted":
            dispatch({ type: "projectDeleted", id: event.id });
            break;
          case "brain.updated":
            dispatch({ type: "brain", brain: event.brain });
            break;
          case "automation.run":
            dispatch({ type: "run", run: event.run });
            if (isFinishedAutomationRun(event.run.status)) {
              if (isTestWebhookSkip(event.run)) break;
              const automationId = event.run.automationId;
              if (
                shouldMarkAutomationUnread(
                  automationId,
                  selectedAutomationRef.current,
                  sectionRef.current,
                )
              ) {
                dispatch({ type: "unreadAutomation", id: automationId });
              }
              if (
                shouldNotifyAutomationOutcome(
                  event.run,
                  Boolean(configRef.current?.notifyAutomationsFailedOnly),
                ) &&
                shouldNotifyAutomationRun(
                  automationId,
                  selectedAutomationRef.current,
                  sectionRef.current,
                  document.hidden,
                )
              ) {
                const name =
                  automationsRef.current.find((a) => a.id === automationId)?.name ?? "Automation";
                notifyTurnDone(
                  name,
                  `Run ${event.run.status}`,
                  desktopNotifyAllowed(configRef.current, "automations"),
                );
              }
            }
            break;
          case "repo.updated":
            dispatch({ type: "repo", repo: event.repo });
            break;
          case "repo.deleted":
            dispatch({ type: "repoDeleted", id: event.id });
            break;
          case "pull.updated":
            if ("files" in event.pull) dispatch({ type: "pull", pull: event.pull });
            break;
          case "issue.updated":
            if ("comments" in event.issue) dispatch({ type: "issue", issue: event.issue });
            break;
          case "slack.status":
            dispatch({
              type: "slackStatus",
              status: {
                connected: event.connected,
                socket: event.socket,
                teamId: event.teamId,
                teamName: event.teamName,
                userId: event.userId,
                userName: event.userName,
                avatarUrl: event.avatarUrl,
                canPostAsBot: event.canPostAsBot,
              },
            });
            break;
          case "slack.channel":
            dispatch({ type: "slackChannel", conversation: event.conversation });
            break;
          case "slack.message": {
            dispatch({ type: "slackMessage", message: event.message });
            const channel = slackConversationsRef.current.find(
              (row) => row.id === event.message.channelId,
            );
            const item = slackMessageActivityItem(
              event.message,
              slackStatusRef.current?.userId,
              channel?.name,
              channel?.kind,
            );
            if (item && !slackActivityIdsRef.current.has(item.id)) {
              rememberSlackActivity(item);
              const items = [item, ...slackActivityRef.current.filter((row) => row.id !== item.id)];
              dispatch({
                type: "slackActivity",
                items,
                unseen: slackActivityOpenRef.current ? false : true,
              });
              fireSlackAlert(item);
            }
            break;
          }
          case "slack.run":
            break;
          default:
            break;
        }
      },
      (connected) => {
        dispatch({ type: "connected", connected });
        if (!connected) return;
        if (configRef.current) void resyncLive();
        else
          void loadSnapshot().catch((err) => {
            if (!cancelled)
              dispatch({ type: "error", error: err instanceof Error ? err.message : "offline" });
          });
      },
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadActivity() {
      try {
        const status = await api.slackStatus();
        if (cancelled) return;
        dispatch({ type: "slackStatus", status });
        if (!status.connected) {
          slackActivityBootstrappedRef.current = false;
          slackActivityIdsRef.current = new Set();
          dispatch({ type: "slackActivity", items: [], unseen: false });
          return;
        }
        const items = await api.slackActivity();
        if (cancelled) return;
        const fresh = newSlackActivityItems(
          slackActivityBootstrappedRef.current,
          slackActivityIdsRef.current,
          items,
        );
        slackActivityBootstrappedRef.current = true;
        for (const item of items) rememberSlackActivity(item);
        dispatch({
          type: "slackActivity",
          items,
          unseen: slackActivityOpenRef.current ? false : fresh.length > 0 ? true : undefined,
        });
        for (const item of fresh) {
          fireSlackAlert(item);
        }
      } catch {
        /* Slack is optional until Sign in succeeds */
      }
    }
    void loadActivity();
    const timer = window.setInterval(() => void loadActivity(), 20_000);
    const onVis = () => {
      if (document.hidden) return;
      void loadActivity();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [dispatch]);

  useEffect(() => {
    document.title = locusWindowTitle({
      needsYou: needsYouCount(state.sessions, state.boards, state.brain),
      unread: state.unreadIds.length,
    });
  }, [state.sessions, state.boards, state.brain, state.unreadIds]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (state.section === "settings") return;
        if (state.section === "automations") dispatch({ type: "newAutomation", open: true });
        else if (state.section === "board") dispatch({ type: "selectBoard", id: null });
        else if (state.section === "project") dispatch({ type: "selectProject", id: null });
        else if (
          state.section === "design" ||
          state.section === "games" ||
          state.section === "assets" ||
          state.section === "ide"
        )
          dispatch({ type: "select", id: null });
        else if (state.section === "codebase") {
          const repo = state.repos.find((row) => row.id === state.selectedRepoId);
          if (repo) {
            dispatch({
              type: "new",
              open: true,
              repoId: repo.id,
              repoUrl: repo.checkout.url,
              repoRef: repo.checkout.ref,
            });
          } else {
            dispatch({ type: "selectRepo", id: null });
          }
        } else dispatch({ type: "select", id: null });
      }
      if (meta && e.key === ",") {
        e.preventDefault();
        dispatch({ type: "settings", open: true });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.section, state.selectedRepoId, state.repos]);

  useEffect(() => {
    if (state.section === "settings") {
      applyEditorPrefs(
        state.config?.editorFontSize,
        state.config?.formatOnSave !== false,
        state.config?.showMinimap !== false,
      );
      return;
    }
    applyTheme(state.config?.theme);
    applyChatDensity(state.config?.chatDensity);
    applyEditorPrefs(
      state.config?.editorFontSize,
      state.config?.formatOnSave !== false,
      state.config?.showMinimap !== false,
    );
  }, [
    state.config?.theme,
    state.config?.chatDensity,
    state.config?.editorFontSize,
    state.config?.formatOnSave,
    state.config?.showMinimap,
    state.section,
  ]);

  useEffect(() => {
    if (state.section !== "docker") return;
    let cancelled = false;
    async function refresh() {
      try {
        const snapshot = await api.dockerContainers();
        if (!cancelled) dispatch({ type: "containers", containers: snapshot.containers });
      } catch {
        /* keep the last snapshot */
      }
      if (typeof api.dockerSwarm === "function") {
        try {
          const swarm = await api.dockerSwarm();
          if (!cancelled) {
            dispatch({
              type: "dockerSwarm",
              swarm: {
                info: swarm.info,
                nodes: swarm.nodes,
                services: swarm.services,
                stacks: swarm.stacks,
              },
            });
          }
        } catch {
          /* keep the last snapshot */
        }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [state.section]);

  const selected = state.sessions.find((s) => s.id === state.selectedId);
  const designSelected = selected && isDesignSession(selected) ? selected : undefined;
  const gameSelected = selected && isGameSession(selected) ? selected : undefined;
  const assetSelected = selected && isAssetSession(selected) ? selected : undefined;
  const ideSelected = selected && isIdeSession(selected) ? selected : undefined;
  const agentSelected =
    selected &&
    !isDesignSession(selected) &&
    !isGameSession(selected) &&
    !isAssetSession(selected) &&
    !isIdeSession(selected) &&
    !isBoardSession(selected) &&
    !isProjectSession(selected)
      ? selected
      : undefined;
  if (workspaceSectionRef.current !== state.section) {
    workspaceEnterRef.current = sectionEnter(workspaceSectionRef.current, state.section);
    workspaceSectionRef.current = state.section;
  }

  const booting = !state.config || !shellReady;
  const productMode = parseProductMode(state.config?.productMode);

  return (
    <Store.Provider value={{ state, dispatch }}>
      <CloseGuard />
      {booting ? <BootScreen onRetry={() => retryBootRef.current()} /> : null}
      {state.productModeTransition ? (
        <ProductModeTransition transition={state.productModeTransition} />
      ) : null}
      {state.config && shell === "mobile" ? (
        <Suspense fallback={null}>
          <BootReveal onReady={markShellReady}>
            <MobileShell onShell={setShell} />
          </BootReveal>
        </Suspense>
      ) : state.config ? (
        <div className="desktop-shell" data-product-mode={productMode}>
          {phoneToken() ? (
            <div className="phone-layout-bar" data-testid="phone-layout-bar">
              <p>This pairing is using the desktop layout.</p>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setUiShell("mobile");
                  setShell("mobile");
                }}
              >
                Use phone layout
              </button>
            </div>
          ) : null}
          {(state.section === "design" && designSelected) ||
          (state.section === "games" && gameSelected) ||
          (state.section === "assets" && assetSelected) ||
          (state.section === "board" && state.selectedBoardId) ||
          (state.section === "project" && state.selectedProjectId) ||
          (state.section === "ide" && ideSelected) ||
          (state.section === "agents" && agentSelected) ? (
            <nav className="skip-links" aria-label="Skip">
              <a href="#chat-pane">Skip to chat</a>
              <a href="#files-pane">Skip to files</a>
            </nav>
          ) : null}
          <div className={`app ${state.collapsed ? "collapsed" : ""}`}>
            <Sidebar />
            <main className="workspace">
              <WorkspaceStage
                key={state.section}
                section={state.section}
                enter={workspaceEnterRef.current}
              >
                {state.section === "settings" ? null : <Topbar />}
                <Suspense fallback={null}>
                  <BootReveal onReady={markShellReady}>
                    {state.section === "settings" ? (
                      <Settings />
                    ) : state.section === "automations" ? (
                      <AutomationsPane />
                    ) : state.section === "codebase" ? (
                      <CodebasePane />
                    ) : state.section === "brain" ? (
                      <BrainPane />
                    ) : state.section === "slack" ? (
                      <SlackPane />
                    ) : state.section === "grafana" ? (
                      <GrafanaPane />
                    ) : state.section === "docker" ? (
                      <DockerPane />
                    ) : state.section === "board" ? (
                      <BoardPane />
                    ) : state.section === "project" ? (
                      <ProjectPane />
                    ) : state.section === "design" ? (
                      designSelected ? (
                        <>
                          <WorkspaceBody
                            variant="design"
                            collapsed={state.vmCollapsed}
                            chat={<ChatPane />}
                            preview={<DesignCanvas />}
                          />
                          <ArtifactDrawer session={designSelected} />
                        </>
                      ) : (
                        <DesignEmpty />
                      )
                    ) : state.section === "games" ? (
                      gameSelected ? (
                        <>
                          <WorkspaceBody
                            variant="design"
                            collapsed={state.vmCollapsed}
                            chat={<ChatPane />}
                            preview={<DesignCanvas />}
                          />
                          <ArtifactDrawer session={gameSelected} />
                        </>
                      ) : (
                        <GameEmpty />
                      )
                    ) : state.section === "assets" ? (
                      assetSelected ? (
                        <>
                          <WorkspaceBody
                            variant="design"
                            collapsed={state.vmCollapsed}
                            chat={<ChatPane />}
                            preview={<DesignCanvas />}
                          />
                          <ArtifactDrawer session={assetSelected} />
                        </>
                      ) : (
                        <AssetEmpty />
                      )
                    ) : state.section === "ide" ? (
                      ideSelected ? (
                        <>
                          <WorkspaceBody
                            variant="ide"
                            collapsed={state.vmCollapsed}
                            chat={<IdeChat />}
                            preview={<HostWorkspace />}
                          />
                          <ArtifactDrawer session={ideSelected} />
                        </>
                      ) : (
                        <IdeEmpty />
                      )
                    ) : agentSelected ? (
                      <>
                        <WorkspaceBody
                          variant="agent"
                          collapsed={state.vmCollapsed}
                          chat={<ChatPane />}
                          preview={
                            productMode === "swarm" ? (
                              <SwarmComputerPanel
                                screen={
                                  sessionRuntime(agentSelected) === "host" ? (
                                    <HostWorkspace embedded />
                                  ) : (
                                    <VmWorkspace embedded />
                                  )
                                }
                              />
                            ) : sessionRuntime(agentSelected) === "host" ? (
                              <HostWorkspace />
                            ) : (
                              <VmWorkspace />
                            )
                          }
                        />
                        <ArtifactDrawer session={agentSelected} />
                      </>
                    ) : (
                      <EmptyState />
                    )}
                  </BootReveal>
                </Suspense>
              </WorkspaceStage>
            </main>
          </div>
          <Suspense fallback={null}>
            {state.newOpen ? <NewSessionModal /> : null}
            {state.sessionSettingsOpen ? <SessionSettings /> : null}
            {state.designSystemsOpen ? <DesignSystemsModal /> : null}
            {state.assetStylesOpen ? <AssetStylesModal /> : null}
            {state.gameStylesOpen ? <GameStylesModal /> : null}
            {state.newAutomationOpen ? <NewAutomationModal /> : null}
            {state.setupOpen ? <SetupWizard /> : null}
          </Suspense>
          <SessionSwitcher />
          <NoticeBanner />
          <FeatureChecklist />
          <Suspense fallback={null}>
            <SlackAlertToasts
              items={slackToasts}
              mentionNames={slackActivityMentionNames(state.slackStatus)}
              onOpen={(item) => {
                setSlackToasts((rows) => rows.filter((row) => row.id !== item.id));
                dispatch({ type: "selectSlackChannel", id: item.channelId });
                if (item.kind === "mention" || item.kind === "thread") {
                  dispatch({ type: "slackThread", ts: item.threadTs || item.ts });
                }
              }}
              onDismiss={(id) => setSlackToasts((rows) => rows.filter((row) => row.id !== id))}
            />
          </Suspense>
        </div>
      ) : null}
    </Store.Provider>
  );
}
