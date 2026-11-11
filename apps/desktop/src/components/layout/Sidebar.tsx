import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  dockerDotClass,
  dockerSwarmActive,
  dockerSwarmManager,
  dockerSwarmNodeReady,
  dockerSwarmServiceLive,
  forgeLabel,
  forgeShort,
  isDesignSession,
  isGameSession,
  isAssetSession,
  conversationLabel,
  isDirectConversation,
  shortRepoName,
  automationLatestAgentRun,
  automationHealth,
  automationHealthCounts,
  automationMatchesQuery,
  formatAutomationHealth,
  runHistoryStatusLabel,
  runStatusText,
  sessionsListeningOnSlack,
  boardNeedsYouItems,
  brainClaimsForRepo,
  parseProductMode,
  sessionMatchesSurface,
} from "@locus/shared";
import { api } from "@/lib/api";
import { useCanvasPrefetch } from "@/lib/useCanvasPrefetch";
import {
  compactDockerAge,
  groupDockerContainers,
  runStopContainers,
  shortContainerId,
} from "@/lib/docker";
import {
  isEmptyDraftSession,
  isIdleArchiveCandidate,
  loadHideAutomationChats,
  saveHideAutomationChats,
} from "@/lib/sessionGroups";
import {
  loadSidebarPrefs,
  saveSidebarPrefs,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type SidebarGroupBy,
  type SidebarListFilter,
} from "@/lib/sidebarPrefs";
import {
  buildInboxRows,
  inboxRowMatchesQuery,
  openInboxRow as openInboxTarget,
  type InboxRow,
} from "@/lib/inboxList";
import { clampSplit, stepSplitValue } from "@/lib/splitter";
import {
  IconAgents,
  IconChevron,
  IconClock,
  IconGear,
  IconPlus,
  IconRefresh,
  IconStar,
  IconStop,
  IconInbox,
} from "./Icons";
import { DesignThumb } from "@/components/design/DesignThumb";
import { MenuItem, MenuLabel, MenuSep, OverflowMenu } from "./OverflowMenu";
import { SearchField } from "./SearchField";
import { rememberBrainInbox } from "@/lib/brainViewPrefs";
import { needsYouSessions, sessionHasNeedsYou } from "@/lib/needsYou";
import { swarmRosterMeta } from "@/lib/swarmPresence";
import {
  loadSwarmRosterPrefs,
  saveSwarmRosterPrefs,
  type SwarmRosterPrefs,
} from "@/lib/swarmRosterPrefs";
import {
  automationFleetExtras,
  automationSpendLabel,
  fleetRecentRuns,
  fleetShouldAutoOpen,
  formatAutomationFleetExtras,
  groupAutomationsBySchedule,
  sortAutomationsByPriority,
  type AutomationListSort,
} from "@/lib/automations";
import {
  loadAutomationSidebarPrefs,
  saveAutomationSidebarPrefs,
  type AutomationJobFilter,
} from "@/lib/automationPrefs";
import { formatWhen } from "@/components/automations/Automations";
import { ConfirmModal } from "@/components/layout/ConfirmModal";
import { Select } from "@/components/layout/Select";
import { Splitter } from "@/components/layout/Splitter";
import { FilterChips } from "@/components/layout/sidebar/FilterChips";
import { InboxList } from "@/components/layout/sidebar/InboxList";
import { SideRail, shortcutCaption, type RailPeekRow } from "@/components/layout/sidebar/SideRail";
import {
  AutomationListItem,
  patchListedAutomations,
} from "@/components/layout/sidebar/automationList";
import {
  groupRepos,
  sectionLabel,
  sectionMetaFor,
  sectionSearchPlaceholder,
} from "@/components/layout/sidebar/sectionMeta";
import {
  SessionGroupBlocks,
  SessionRow,
  agentMeta,
  sessionPassesListFilter,
} from "@/components/layout/sidebar/sessionList";
import {
  SlackChannelListSkeleton,
  SlackKindMark,
  SlackListenButton,
  loadSlackSidebarGroups,
  saveSlackSidebarGroups,
  slackChannelGroups,
  slackWorkspaceBooting,
  starSlackChannel,
  type SlackSidebarGroupId,
  type SlackSidebarGroups,
} from "@/components/slack/Slack";
import { sessionMatchesQuery } from "@/lib/sessionSearch";
import { sidebarBrandSubtitle } from "@/lib/sidebarCopy";
import { matchAltDigit } from "@/lib/shortcuts";
import {
  sectionQuery,
  sessionFitsSection,
  openSettings,
  useStore,
  type UiSection,
} from "@/state/store";
import {
  DEFAULT_SWARM_SETTINGS_TAB,
  settingsNavCount,
  settingsNavGroupsForMode,
  settingsNavLabel,
  settingsNavTabs,
} from "@/lib/settingsNav";
import { confirmLeaveSettings } from "@/lib/settingsLeave";
import { showErrorNotice, showNotice } from "@/lib/notice";
import { askConfirm } from "@/lib/dialog";
import { archiveSessions } from "@/lib/sessionUndo";
import {
  isLockedRailSection,
  lockedRailSections,
  moveRailSection,
  pinRailSection,
  railShortcutTargets,
  reorderRailSections,
  resolveRailSections,
  unpinRailSection,
} from "@/lib/railNav";
import { swarmShellKeepsSection } from "@/lib/productMode";
import { useDrawerSidebar } from "@/lib/useDrawerSidebar";
import { EmptyListNote } from "./EmptyHero";

/** Sort and bulk pause/enable only earn their rows once the list is long. */
const JOB_LIST_TOOLS_MIN = 10;

const JOB_FILTER_OPTIONS: { value: AutomationJobFilter; label: string }[] = [
  { value: "all", label: "All jobs" },
  { value: "failing", label: "Failing" },
  { value: "needs-you", label: "Needs you" },
  { value: "running", label: "Running" },
  { value: "paused", label: "Paused" },
  { value: "over-cap", label: "Over cap" },
];

export function Sidebar() {
  const { state, dispatch } = useStore();
  const sideRef = useRef<HTMLElement>(null);
  const [showArchived, setShowArchived] = useState(() => loadSidebarPrefs().showArchived);
  const [showHiddenTeammates, setShowHiddenTeammates] = useState(
    () => loadSidebarPrefs().showHiddenTeammates,
  );
  const [rosterPrefs, setRosterPrefs] = useState(loadSwarmRosterPrefs);
  const [stopping, setStopping] = useState(false);
  const [runningOnly, setRunningOnly] = useState(() => loadSidebarPrefs().runningOnly);
  const [sidebarWidth, setSidebarWidth] = useState(() => loadSidebarPrefs().width);
  const [pinnedSections, setPinnedSections] = useState<string[] | undefined>(
    () => loadSidebarPrefs().pinnedSections,
  );
  const [listFilter, setListFilter] = useState<SidebarListFilter>(
    () => loadSidebarPrefs().listFilter,
  );
  const [groupBy, setGroupBy] = useState<SidebarGroupBy>(() => loadSidebarPrefs().groupBy);
  const inboxOpen = state.inboxOpen;
  const [resizing, setResizing] = useState(false);
  const [hideAutomationChats, setHideAutomationChats] = useState(loadHideAutomationChats);
  const [slackGroups, setSlackGroups] = useState<SlackSidebarGroups>(loadSlackSidebarGroups);
  const [autoFilter, setAutoFilter] = useState(() => loadAutomationSidebarPrefs().filter);
  const [autoSort, setAutoSort] = useState<AutomationListSort>(
    () => loadAutomationSidebarPrefs().sort,
  );
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<null | { enabled: boolean; count: number }>(null);
  const [deleteAutomationId, setDeleteAutomationId] = useState<string | null>(null);
  const [fleetOpen, setFleetOpen] = useState(() => {
    const prefs = loadAutomationSidebarPrefs();
    if (prefs.fleetOpen === true) return true;
    if (prefs.fleetOpen === false) return false;
    return false;
  });
  const query = sectionQuery(state);
  useEffect(() => {
    saveSidebarPrefs({
      showArchived,
      runningOnly,
      showHiddenTeammates,
      queries: state.queries,
      width: sidebarWidth,
      pinnedSections,
      listFilter,
      groupBy,
    });
  }, [
    showArchived,
    runningOnly,
    showHiddenTeammates,
    state.queries,
    sidebarWidth,
    pinnedSections,
    listFilter,
    groupBy,
  ]);
  const q = query.toLowerCase();
  const productMode = parseProductMode(state.config?.productMode);
  const hideAutomationInList = hideAutomationChats || productMode === "swarm";
  const archivedCount = state.sessions.filter(
    (s) =>
      s.archived &&
      sessionFitsSection(s, "agents") &&
      sessionMatchesSurface(s, productMode) &&
      (productMode !== "swarm" || !s.projectId),
  ).length;
  const archivedIdeCount = state.sessions.filter(
    (s) => s.archived && sessionFitsSection(s, "ide") && sessionMatchesSurface(s, productMode),
  ).length;
  const archivedDesignCount = state.sessions.filter(
    (s) => s.archived && isDesignSession(s) && sessionMatchesSurface(s, productMode),
  ).length;
  const archivedGameCount = state.sessions.filter(
    (s) => s.archived && isGameSession(s) && sessionMatchesSurface(s, productMode),
  ).length;
  const archivedAssetCount = state.sessions.filter(
    (s) => s.archived && isAssetSession(s) && sessionMatchesSurface(s, productMode),
  ).length;
  const agentCatalog = state.sessions.filter((s) => {
    if (!sessionFitsSection(s, "agents")) return false;
    if (!sessionMatchesSurface(s, productMode)) return false;
    if (productMode === "swarm" && s.projectId) return false;
    if (s.archived && !showArchived) return false;
    if (hideAutomationInList && s.automationId) return false;
    if (
      productMode === "swarm" &&
      !showHiddenTeammates &&
      rosterPrefs.hiddenSessionIds.includes(s.id)
    ) {
      return false;
    }
    return sessionMatchesQuery(s, q);
  });
  const sessions = agentCatalog.filter((s) =>
    sessionPassesListFilter(s, listFilter, state.unreadIds),
  );
  const hiddenTeammateCount =
    productMode === "swarm"
      ? state.sessions.filter(
          (s) =>
            sessionFitsSection(s, "agents") &&
            sessionMatchesSurface(s, "swarm") &&
            !s.projectId &&
            !s.archived &&
            rosterPrefs.hiddenSessionIds.includes(s.id),
        ).length
      : 0;

  function updateRosterPrefs(next: SwarmRosterPrefs) {
    saveSwarmRosterPrefs(next);
    setRosterPrefs(next);
  }
  const ideCatalog = state.sessions.filter((s) => {
    if (!sessionFitsSection(s, "ide")) return false;
    if (!sessionMatchesSurface(s, productMode)) return false;
    if (s.archived && !showArchived) return false;
    return sessionMatchesQuery(s, q);
  });
  const ideSessions = ideCatalog.filter((s) =>
    sessionPassesListFilter(s, listFilter, state.unreadIds),
  );
  const designCatalog = state.sessions.filter((s) => {
    if (!isDesignSession(s)) return false;
    if (!sessionMatchesSurface(s, productMode)) return false;
    if (s.archived && !showArchived) return false;
    return sessionMatchesQuery(s, q);
  });
  const designs = designCatalog.filter((s) =>
    sessionPassesListFilter(s, listFilter, state.unreadIds),
  );
  const gameCatalog = state.sessions.filter((s) => {
    if (!isGameSession(s)) return false;
    if (!sessionMatchesSurface(s, productMode)) return false;
    if (s.archived && !showArchived) return false;
    return sessionMatchesQuery(s, q);
  });
  const games = gameCatalog.filter((s) => sessionPassesListFilter(s, listFilter, state.unreadIds));
  const assetCatalog = state.sessions.filter((s) => {
    if (!isAssetSession(s)) return false;
    if (!sessionMatchesSurface(s, productMode)) return false;
    if (s.archived && !showArchived) return false;
    return sessionMatchesQuery(s, q);
  });
  const assets = assetCatalog.filter((s) =>
    sessionPassesListFilter(s, listFilter, state.unreadIds),
  );
  useCanvasPrefetch(
    state.section === "design" || state.section === "games" || state.section === "assets",
    state.section === "games" ? games : state.section === "assets" ? assets : designs,
    state.canvasHtml,
    dispatch,
  );
  const automations = state.automations.filter((a) => automationMatchesQuery(a, q));
  const listedAutomations = sortAutomationsByPriority(
    automations.filter((a) => {
      if (autoFilter === "paused") return !a.enabled;
      const health = automationHealth(a, automationLatestAgentRun(state.runs, a.id));
      if (autoFilter === "failing") return health === "failing";
      if (autoFilter === "needs-you") return health === "needs_you";
      if (autoFilter === "running") {
        return state.runs.some(
          (run) =>
            run.automationId === a.id && (run.status === "running" || run.status === "queued"),
        );
      }
      if (autoFilter === "over-cap") {
        return Boolean(
          automationSpendLabel(state.runs, a, state.sessions, state.config ?? undefined)?.over,
        );
      }
      return true;
    }),
    state.runs,
  );
  const manyJobs = state.automations.length > JOB_LIST_TOOLS_MIN;
  const automationGroups =
    manyJobs && autoSort === "schedule" ? groupAutomationsBySchedule(listedAutomations) : null;
  const fleetExtras = formatAutomationFleetExtras(
    automationFleetExtras(state.automations, state.runs, state.sessions, state.config ?? undefined),
  );
  const showFleetActivity =
    !inboxOpen &&
    state.section === "automations" &&
    state.automations.length > 1 &&
    state.runs.length > 0;
  const boards = state.boards.filter(
    (row) =>
      !row.archived &&
      (row.title.toLowerCase().includes(q) || (row.starter ?? "").toLowerCase().includes(q)),
  );
  const projects = state.projects.filter(
    (row) =>
      !row.archived &&
      sessionMatchesSurface(row, productMode) &&
      ((row.teamName ?? row.title).toLowerCase().includes(q) ||
        row.title.toLowerCase().includes(q) ||
        (row.starter ?? "").toLowerCase().includes(q)),
  );
  const repos = state.repos.filter(
    (row) =>
      row.name.toLowerCase().includes(q) ||
      row.checkout.url.toLowerCase().includes(q) ||
      row.checkout.forge.includes(q),
  );
  const containers = state.containers.filter(
    (row) =>
      row.name.toLowerCase().includes(q) ||
      row.image.toLowerCase().includes(q) ||
      (row.sessionTitle ?? "").toLowerCase().includes(q) ||
      row.state.includes(q),
  );
  const swarmServices = (state.dockerSwarm?.services ?? []).filter(
    (row) =>
      row.name.toLowerCase().includes(q) ||
      row.image.toLowerCase().includes(q) ||
      row.replicas.toLowerCase().includes(q),
  );
  const swarmNodes = (state.dockerSwarm?.nodes ?? []).filter(
    (row) =>
      row.hostname.toLowerCase().includes(q) ||
      row.status.toLowerCase().includes(q) ||
      (row.managerStatus ?? "").toLowerCase().includes(q),
  );
  const swarmStacks = (state.dockerSwarm?.stacks ?? []).filter(
    (row) =>
      row.name.toLowerCase().includes(q) || (row.orchestrator ?? "").toLowerCase().includes(q),
  );
  const slackConversations = state.slackConversations.filter((row) => {
    const label = conversationLabel(row).toLowerCase();
    return (
      label.includes(q) ||
      row.name.toLowerCase().includes(q) ||
      (row.topic ?? "").toLowerCase().includes(q)
    );
  });
  const slackUnread =
    state.slackConversations.some((row) => row.unread) ||
    (state.slackActivityUnseen && !state.slackActivityOpen);
  const waiting = needsYouSessions(state.sessions);
  const boardWaiting = boardNeedsYouItems(state.boards);
  const brainWaiting = state.brain?.inboxCount ?? 0;
  const sectionMeta = sectionMetaFor(productMode);
  const railSections = resolveRailSections(productMode, pinnedSections);
  const primarySections = railSections.primary.map((id) => ({
    id,
    ...sectionMeta[id as Exclude<UiSection, "settings">],
  }));
  const secondarySections = railSections.more.map((id) => ({
    id,
    ...sectionMeta[id as Exclude<UiSection, "settings">],
  }));
  const inboxAll = buildInboxRows({
    sessions: state.sessions.filter((s) => sessionMatchesSurface(s, productMode)),
    boards: state.boards,
    brain: state.brain,
    automations: state.automations,
    runs: state.runs,
  });
  const inboxRows = inboxAll.filter((row) => inboxRowMatchesQuery(row, q));
  const inboxCount = inboxAll.length;
  const sessionListSection =
    state.section === "agents" ||
    state.section === "design" ||
    state.section === "games" ||
    state.section === "assets" ||
    state.section === "ide";
  const showNeedsGroup =
    !inboxOpen && state.section === "agents" && listFilter === "all" && groupBy === "day";
  const sectionCatalog =
    state.section === "design"
      ? designCatalog
      : state.section === "games"
        ? gameCatalog
        : state.section === "assets"
          ? assetCatalog
          : state.section === "ide"
            ? ideCatalog
            : agentCatalog;
  // Chips only once there is something to filter.
  const showSessionFilters = !inboxOpen && sessionListSection && sectionCatalog.length > 0;
  const slackBooting = slackWorkspaceBooting({
    slackStatus: state.slackStatus,
    slackConversations: state.slackConversations,
    slackCatalogLoaded: state.slackCatalogLoaded,
    integrations: state.config?.integrations,
  });
  const picked = new Set(state.pickedContainerIds);
  const grouped = groupDockerContainers(containers);
  const liveListed = grouped.running;
  const grafanaConnected = (state.config?.integrations ?? []).some(
    (row) => row.kind === "grafana" && Boolean(row.token?.trim()),
  );
  function focusGrafanaInvestigate() {
    const target =
      document.querySelector<HTMLTextAreaElement>(".grafana-investigate textarea") ??
      document.querySelector<HTMLInputElement>(".grafana-query input");
    target?.scrollIntoView({ block: "nearest" });
    target?.focus();
  }
  const idleTargets = state.sessions.filter((s) => {
    if (!sessionFitsSection(s, state.section)) return false;
    if (!sessionMatchesSurface(s, productMode)) return false;
    if (productMode === "swarm" && state.section === "agents" && s.projectId) return false;
    if (sessionHasNeedsYou(s)) return false;
    return isIdleArchiveCandidate(s);
  });
  const emptyDrafts = state.sessions.filter((s) => {
    if (!sessionFitsSection(s, state.section)) return false;
    if (!sessionMatchesSurface(s, productMode)) return false;
    if (productMode === "swarm" && state.section === "agents" && s.projectId) return false;
    if (sessionHasNeedsYou(s)) return false;
    return isEmptyDraftSession(s);
  });

  function setPicked(next: Set<string>) {
    dispatch({ type: "pickContainers", ids: [...next] });
  }

  async function stopSelectedContainers(rows = liveListed) {
    if (!rows.length || stopping) return;
    setStopping(true);
    try {
      const result = await runStopContainers(rows, {
        stop: api.dockerContainersStop,
        list: api.dockerContainers,
      });
      if (!result) return;
      dispatch({ type: "containers", containers: result.containers });
      setPicked(new Set([...picked].filter((id) => !result.stoppedIds.has(id))));
      if (result.errors.length) {
        showNotice(result.errors.map((row) => `${row.id}: ${row.error}`).join("\n"));
      }
    } catch (err) {
      showErrorNotice(err, "Could not stop containers");
    } finally {
      setStopping(false);
    }
  }

  function togglePinnedSection(section: UiSection) {
    if (section === "settings" || isLockedRailSection(section, productMode)) return;
    const next = railSections.primary.includes(section)
      ? unpinRailSection(productMode, pinnedSections, section)
      : pinRailSection(productMode, pinnedSections, section);
    setPinnedSections(next);
  }

  function movePinnedSection(section: UiSection, delta: -1 | 1) {
    setPinnedSections(moveRailSection(productMode, pinnedSections, section, delta));
  }

  function reorderPinnedSection(section: UiSection, target: UiSection) {
    setPinnedSections(reorderRailSections(productMode, pinnedSections, section, target));
  }

  function goToSection(section: UiSection) {
    if (state.section === "settings" && !confirmLeaveSettings()) return;
    dispatch({ type: "inbox", open: false });
    if (productMode === "swarm" && section === "project") {
      const selected = state.projects.find((item) => item.id === state.selectedProjectId);
      if (!selected || selected.surface !== "swarm") {
        dispatch({ type: "selectProject", id: null });
        return;
      }
    }
    dispatch({ type: "section", section });
  }

  function openInbox() {
    if (state.section === "settings") {
      if (!confirmLeaveSettings()) return;
      dispatch({ type: "settings", open: false });
    }
    dispatch({ type: "inbox", open: true });
  }

  function openInboxRow(row: InboxRow) {
    openInboxTarget(row, dispatch);
  }

  function setWidth(next: number) {
    const clamped = clampSplit(next, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX);
    setSidebarWidth(clamped);
    saveSidebarPrefs({ width: clamped });
  }

  function onSidebarGutterDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const origin = event.clientX;
    // Narrow windows cap the aside in CSS; drag from what is on screen so the
    // handle tracks the pointer instead of the larger saved width.
    const shown = sideRef.current?.getBoundingClientRect().width;
    const start = shown && shown < sidebarWidth ? Math.round(shown) : sidebarWidth;
    const node = event.currentTarget;
    if (typeof node.setPointerCapture === "function") node.setPointerCapture(event.pointerId);
    setResizing(true);
    function move(ev: PointerEvent) {
      setSidebarWidth(
        clampSplit(start + (ev.clientX - origin), SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX),
      );
    }
    function up() {
      setResizing(false);
      if (typeof node.releasePointerCapture === "function") {
        node.releasePointerCapture(event.pointerId);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSidebarWidth((value) => {
        saveSidebarPrefs({ width: value });
        return value;
      });
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onSidebarGutterKey(event: KeyboardEvent<HTMLDivElement>) {
    const next = stepSplitValue({
      key: event.key,
      shift: event.shiftKey,
      value: sidebarWidth,
      min: SIDEBAR_WIDTH_MIN,
      max: SIDEBAR_WIDTH_MAX,
      axis: "vertical",
      step: 16,
      largeStep: 48,
    });
    if (next == null) return;
    event.preventDefault();
    setWidth(next);
  }

  const pinMenuItem =
    state.section !== "settings" && !isLockedRailSection(state.section, productMode) ? (
      <MenuItem onClick={() => togglePinnedSection(state.section)}>
        {railSections.primary.includes(state.section) ? "Unpin from rail" : "Pin to rail"}
      </MenuItem>
    ) : null;
  const pinIndex = railSections.primary.indexOf(state.section);
  const pinFloor = lockedRailSections(productMode).length;
  const pinOrderMenu =
    pinIndex >= 0 && !isLockedRailSection(state.section, productMode) ? (
      <>
        <MenuItem
          disabled={pinIndex <= pinFloor}
          onClick={() => movePinnedSection(state.section, -1)}
        >
          Move up
        </MenuItem>
        <MenuItem
          disabled={pinIndex >= railSections.primary.length - 1}
          onClick={() => movePinnedSection(state.section, 1)}
        >
          Move down
        </MenuItem>
      </>
    ) : null;

  const sessionListMenu = sessionListSection ? (
    <OverflowMenu title="Session list" toggleClassName="btn icon ghost">
      <MenuItem
        disabled={!idleTargets.length}
        onClick={() => {
          const n = idleTargets.length;
          void archiveSessions(
            idleTargets,
            dispatch,
            n === 1 ? "Archived 1 idle chat" : `Archived ${n} idle chats`,
          );
        }}
      >
        {idleTargets.length ? `Archive idle (${idleTargets.length})` : "Archive idle"}
      </MenuItem>
      <MenuItem
        disabled={!emptyDrafts.length}
        onClick={() => {
          const n = emptyDrafts.length;
          void archiveSessions(
            emptyDrafts,
            dispatch,
            n === 1 ? "Archived 1 empty draft" : `Archived ${n} empty drafts`,
          );
        }}
      >
        {emptyDrafts.length
          ? `Archive empty drafts (${emptyDrafts.length})`
          : "Archive empty drafts"}
      </MenuItem>
      {state.section === "agents" ? (
        <MenuItem
          onClick={() => {
            const next = !hideAutomationChats;
            setHideAutomationChats(next);
            saveHideAutomationChats(next);
          }}
        >
          {hideAutomationChats ? "Show job chats" : "Hide job chats"}
        </MenuItem>
      ) : null}
      {pinMenuItem}
      {pinOrderMenu}
      <MenuSep />
      <MenuLabel>Group by</MenuLabel>
      {(
        [
          ["day", "Day"],
          ["repo", "Repo"],
          ["status", "Status"],
        ] as const
      ).map(([value, label]) => (
        <MenuItem key={value} checked={groupBy === value} onClick={() => setGroupBy(value)}>
          {label}
        </MenuItem>
      ))}
    </OverflowMenu>
  ) : null;

  const connTitle = state.connected ? "Control plane connected" : "Control plane offline";
  const connParts = [
    state.connected ? "Connected" : "Offline",
    state.hypervisorKind === "qemu" ? "QEMU" : null,
    state.dockerKind === "docker" ? "Docker" : null,
  ].filter(Boolean);
  const connDetail = connParts.join(" · ");
  const swarmMode = productMode === "swarm";

  useEffect(() => {
    if (!swarmMode) return;
    if (swarmShellKeepsSection(state.section)) return;
    dispatch({ type: "section", section: "agents" });
  }, [swarmMode, state.section, dispatch]);

  // Narrow windows: the list is an overlay drawer. Start it closed, reopen it if the
  // window widens again, and close it after a pick so the chosen item is visible.
  const drawer = useDrawerSidebar();
  const drawerAutoClosed = useRef(false);
  useEffect(() => {
    if (drawer) {
      if (!state.collapsed) {
        drawerAutoClosed.current = true;
        dispatch({ type: "sidebarCollapsed", collapsed: true });
      }
    } else if (drawerAutoClosed.current) {
      drawerAutoClosed.current = false;
      dispatch({ type: "sidebarCollapsed", collapsed: false });
    }
    // Only react to crossing the breakpoint, not to every open / close.
  }, [drawer]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickKey = [
    state.section,
    state.selectedId,
    state.selectedBoardId,
    state.selectedProjectId,
    state.selectedAutomationId,
    state.selectedRepoId,
    state.selectedContainerId,
    state.selectedSlackChannelId,
  ].join("|");
  const lastPick = useRef({ key: pickKey, section: state.section });
  useEffect(() => {
    const prev = lastPick.current;
    lastPick.current = { key: pickKey, section: state.section };
    // A rail switch also moves the selection; keep the drawer open for that.
    if (prev.key === pickKey || prev.section !== state.section) return;
    if (drawer && !state.collapsed) dispatch({ type: "sidebarCollapsed", collapsed: true });
  }, [pickKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const prefs = loadAutomationSidebarPrefs();
    if (prefs.fleetOpen !== undefined) return;
    if (fleetShouldAutoOpen(state.runs)) setFleetOpen(true);
  }, [state.runs]);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      const digit = matchAltDigit(event);
      if (!digit) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      const dest = railShortcutTargets(productMode, pinnedSections)[Number(digit) - 1];
      if (!dest) return;
      event.preventDefault();
      if (dest === "inbox") openInbox();
      else goToSection(dest);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // goToSection / openInbox close over the latest section; listing them retriggers every render.
  }, [productMode, pinnedSections, state.section]); // eslint-disable-line react-hooks/exhaustive-deps

  function returnToSwarmTeammates() {
    if (!confirmLeaveSettings()) return;
    dispatch({ type: "inbox", open: false });
    const selected = state.sessions.find((s) => s.id === state.selectedId);
    dispatch({ type: "section", section: "agents" });
    // Section navigation can fall back to the first session. If that session
    // is not a Swarm teammate, keep the return action on the creation surface
    // instead of showing a Developer chat in the Swarm shell.
    if (!selected || !sessionMatchesSurface(selected, "swarm")) {
      dispatch({ type: "select", id: null });
    }
  }

  const shortcutTargets = railShortcutTargets(productMode, pinnedSections);
  function shortcutHint(target: "inbox" | UiSection) {
    return shortcutCaption(shortcutTargets.indexOf(target));
  }

  function peekRows(target: "inbox" | UiSection): RailPeekRow[] {
    if (target === "inbox") {
      return inboxAll.map((row) => ({ key: row.key, title: row.title, detail: row.detail }));
    }
    if (target === "agents") {
      return agentCatalog.map((s) => ({ key: s.id, title: s.title }));
    }
    if (target === "design") {
      return designCatalog.map((s) => ({ key: s.id, title: s.title }));
    }
    if (target === "games") {
      return gameCatalog.map((s) => ({ key: s.id, title: s.title }));
    }
    if (target === "assets") {
      return assetCatalog.map((s) => ({ key: s.id, title: s.title }));
    }
    if (target === "ide") {
      return ideCatalog.map((s) => ({ key: s.id, title: s.title }));
    }
    if (target === "codebase") {
      return repos.map((row) => ({ key: row.id, title: row.name }));
    }
    if (target === "automations") {
      return automations.map((row) => ({ key: row.id, title: row.name }));
    }
    if (target === "docker") {
      return containers.map((row) => ({ key: row.id, title: row.name, detail: row.state }));
    }
    if (target === "slack") {
      return slackConversations.map((row) => ({
        key: row.id,
        title: conversationLabel(row),
      }));
    }
    if (target === "board") {
      return boards.map((row) => ({ key: row.id, title: row.title }));
    }
    if (target === "project") {
      return projects.map((row) => ({ key: row.id, title: row.teamName ?? row.title }));
    }
    if (target === "brain" && state.brain) {
      return [
        {
          key: "brain",
          title: "Brain",
          detail:
            (state.brain.inboxCount ?? 0) > 0
              ? `${state.brain.inboxCount} waiting`
              : `${state.brain.nodeCount} nodes`,
        },
      ];
    }
    return [];
  }

  function onPeekOpen(target: "inbox" | UiSection, row: RailPeekRow) {
    if (target === "inbox") {
      const found = inboxAll.find((item) => item.key === row.key);
      if (found) openInboxRow(found);
      else openInbox();
      return;
    }
    if (
      target === "agents" ||
      target === "design" ||
      target === "games" ||
      target === "assets" ||
      target === "ide"
    ) {
      dispatch({ type: "select", id: row.key });
      return;
    }
    if (target === "codebase") {
      dispatch({ type: "selectRepo", id: row.key });
      return;
    }
    if (target === "automations") {
      dispatch({ type: "selectAutomation", id: row.key });
      return;
    }
    if (target === "docker") {
      dispatch({ type: "selectContainer", id: row.key });
      return;
    }
    if (target === "slack") {
      dispatch({ type: "selectSlackChannel", id: row.key });
      return;
    }
    if (target === "board") {
      dispatch({ type: "selectBoard", id: row.key });
      return;
    }
    if (target === "project") {
      dispatch({ type: "selectProject", id: row.key });
      return;
    }
    goToSection(target);
  }

  const headerShown = state.section !== "settings" && !inboxOpen;
  const layoutMenu = pinMenuItem ? (
    <OverflowMenu title="Sidebar layout" toggleClassName="btn icon ghost">
      {pinMenuItem}
      {pinOrderMenu}
    </OverflowMenu>
  ) : null;
  const headerMenu = sessionListSection
    ? swarmMode && state.section === "agents"
      ? null
      : sessionListMenu
    : layoutMenu;
  const pickedLive = liveListed.filter((row) => picked.has(row.id));

  function primaryButton(label: string, onClick: () => void, icon = <IconPlus />) {
    return (
      <button className="btn primary" title={label} aria-label={label} onClick={onClick}>
        {icon} <span>{label}</span>
      </button>
    );
  }

  const primaryAction =
    state.section === "automations" ? (
      primaryButton(
        swarmMode ? "New routine" : "New job",
        () => dispatch({ type: "newAutomation", open: true }),
        <IconClock />,
      )
    ) : state.section === "board" ? (
      primaryButton("New board", () => dispatch({ type: "selectBoard", id: null }))
    ) : state.section === "project" ? (
      primaryButton(swarmMode ? "New team" : "New project", () =>
        dispatch({ type: "selectProject", id: null }),
      )
    ) : state.section === "design" ? (
      primaryButton("New design", () => dispatch({ type: "select", id: null }))
    ) : state.section === "games" ? (
      primaryButton("New game", () => dispatch({ type: "select", id: null }))
    ) : state.section === "assets" ? (
      primaryButton("New asset", () => dispatch({ type: "select", id: null }))
    ) : state.section === "ide" ? (
      <OverflowMenu
        className="side-primary-menu"
        title="New workspace"
        align="left"
        toggleClassName="btn primary"
        testId="ide-new-workspace"
        label={
          <>
            <IconPlus /> <span>New workspace</span>
          </>
        }
      >
        {(
          [
            ["open", "Open folder…"],
            ["clone", "Clone repo…"],
          ] as const
        ).map(([intent, label]) => (
          <MenuItem
            key={intent}
            onClick={() => {
              dispatch({ type: "select", id: null });
              dispatch({ type: "ideStart", intent });
            }}
          >
            {label}
          </MenuItem>
        ))}
      </OverflowMenu>
    ) : state.section === "codebase" ? (
      primaryButton("Link repo", () => dispatch({ type: "selectRepo", id: null }))
    ) : state.section === "slack" ? (
      state.slackStatus?.connected || slackConversations.length > 0 ? (
        <button
          className="btn"
          title="Refresh channels"
          aria-label="Refresh channels"
          onClick={() => {
            void api.slackConversations(true).then(
              (conversations) => dispatch({ type: "slackConversations", conversations }),
              (err: unknown) => {
                showErrorNotice(err, "Could not refresh Slack");
              },
            );
          }}
        >
          <IconRefresh /> <span>Refresh</span>
        </button>
      ) : null
    ) : state.section === "docker" ? (
      <>
        <button
          className="btn icon ghost"
          title="Refresh containers"
          aria-label="Refresh containers"
          onClick={() => {
            void Promise.all([
              api.dockerContainers(),
              typeof api.dockerSwarm === "function" ? api.dockerSwarm() : null,
            ]).then(
              ([snapshot, swarm]) => {
                dispatch({ type: "containers", containers: snapshot.containers });
                if (swarm) {
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
              },
              (err: unknown) => {
                showErrorNotice(err, "Could not refresh Docker");
              },
            );
          }}
        >
          <IconRefresh />
        </button>
        {state.dockerView === "containers" && pickedLive.length ? (
          <button
            className="btn"
            title="Stop selected"
            aria-label="Stop selected containers"
            disabled={stopping}
            onClick={() => void stopSelectedContainers(pickedLive)}
          >
            <IconStop /> <span>Stop {pickedLive.length}</span>
          </button>
        ) : null}
      </>
    ) : state.section === "brain" ? null : state.section === "grafana" ? (
      grafanaConnected ? (
        primaryButton("Investigate", focusGrafanaInvestigate, <></>)
      ) : (
        primaryButton("Add Grafana", () => openSettings(dispatch, "integrations"))
      )
    ) : (
      primaryButton(swarmMode ? "New teammate" : "New agent", () =>
        dispatch({ type: "select", id: null }),
      )
    );

  const brandSubtitle = sidebarBrandSubtitle({
    inboxOpen,
    inboxCount,
    section: state.section,
    mode: productMode,
    settingsTab: state.settingsTab,
    dockerKind: state.dockerKind,
    slackTeam: state.slackStatus?.teamName,
    agentCount: agentCatalog.length,
    needsCount: agentCatalog.filter(sessionHasNeedsYou).length,
    designCount: designCatalog.length,
    gameCount: gameCatalog.length,
    assetCount: assetCatalog.length,
    ideCount: ideCatalog.length,
    repoCount: repos.length,
    boardCount: boards.length,
    projectCount: projects.length,
    automationCount: automations.length,
    brainNodes: state.brain?.nodeCount,
    brainMemories: state.brain?.memoryCount,
  });

  return (
    <aside
      ref={sideRef}
      className={`sidebar${swarmMode ? " swarm-sidebar" : ""}${resizing ? " resizing" : ""}`}
      style={state.collapsed && !swarmMode ? undefined : { width: sidebarWidth }}
    >
      <SideRail
        collapsed={state.collapsed}
        swarmMode={swarmMode}
        connected={state.connected}
        connTitle={connTitle}
        connDetail={connDetail}
        inboxOpen={inboxOpen}
        inboxCount={inboxCount}
        activeSection={state.section}
        primary={primarySections}
        secondary={secondarySections}
        waiting={waiting}
        unreadAutomation={state.unreadAutomationIds.length > 0}
        slackUnread={slackUnread}
        boardWaiting={boardWaiting.length}
        shortcutHint={shortcutHint}
        setupOpen={Boolean(state.setup && !state.setup.ready)}
        onInbox={openInbox}
        onSection={goToSection}
        onPin={togglePinnedSection}
        onReorder={reorderPinnedSection}
        onMove={movePinnedSection}
        onSettings={() => dispatch({ type: "settings", open: true })}
        onToggleCollapse={() => dispatch({ type: "toggleSidebar" })}
        onSetup={() => dispatch({ type: "setupOpen", open: true })}
        peekRows={peekRows}
        onPeekOpen={onPeekOpen}
      />
      <div
        className="side-main"
        inert={state.collapsed || undefined}
        aria-hidden={state.collapsed || undefined}
      >
        <div className="brand">
          <div className="brand-copy">
            <h1>{inboxOpen ? "Inbox" : sectionLabel(state.section, productMode)}</h1>
            {brandSubtitle ? <p>{brandSubtitle}</p> : null}
          </div>
          {headerShown && !primaryAction && headerMenu ? (
            <div className="brand-actions">{headerMenu}</div>
          ) : null}
        </div>
        {headerShown && primaryAction ? (
          <div className="side-actions">
            <div className="side-actions-row">
              {primaryAction}
              {headerMenu}
            </div>
          </div>
        ) : null}
        {state.section !== "settings" ? (
          <SearchField
            className="search"
            placeholder={
              inboxOpen ? "Search inbox" : sectionSearchPlaceholder(state.section, productMode)
            }
            value={query}
            onChange={(e: FormEvent<HTMLInputElement>) =>
              dispatch({ type: "query", query: (e.target as HTMLInputElement).value })
            }
            shortcut={undefined}
          />
        ) : null}
        {showSessionFilters ? (
          <FilterChips
            label="Session filter"
            value={listFilter}
            options={(
              [
                ["all", "All"],
                ["needs", "Needs you"],
                ["running", "Running"],
                ["unseen", "Unread"],
              ] as const
            ).map(([value, label]) => ({
              value,
              label,
              count:
                value === "all"
                  ? undefined
                  : sectionCatalog.filter((s) => sessionPassesListFilter(s, value, state.unreadIds))
                      .length,
            }))}
            onChange={setListFilter}
          />
        ) : null}
        {state.section === "docker" ? (
          <>
            <div className="docker-view-toggle" role="tablist" aria-label="Docker view">
              <button
                type="button"
                role="tab"
                className={state.dockerView === "containers" ? "on" : ""}
                aria-selected={state.dockerView === "containers"}
                onClick={() => dispatch({ type: "dockerView", view: "containers" })}
              >
                Containers
              </button>
              <button
                type="button"
                role="tab"
                className={state.dockerView === "swarm" ? "on" : ""}
                aria-selected={state.dockerView === "swarm"}
                data-testid="docker-swarm-tab"
                onClick={() => dispatch({ type: "dockerView", view: "swarm" })}
              >
                Services
              </button>
            </div>
            {state.dockerView === "containers" && containers.length ? (
              <FilterChips
                label="Container filter"
                value={runningOnly ? "running" : "all"}
                options={[
                  { value: "all", label: "All" },
                  { value: "running", label: "Running", count: grouped.running.length },
                ]}
                onChange={(value) => setRunningOnly(value === "running")}
              />
            ) : null}
          </>
        ) : null}
        {state.section === "automations" && state.automations.length ? (
          <>
            <div className="auto-side-filters">
              <Select
                compact
                ariaLabel="Job filter"
                value={autoFilter}
                options={JOB_FILTER_OPTIONS}
                onChange={(next) => {
                  setAutoFilter(next);
                  saveAutomationSidebarPrefs({ filter: next, sort: autoSort });
                }}
              />
              {manyJobs ? (
                <div className="auto-side-filter-row" role="group" aria-label="Job sort">
                  {(
                    [
                      ["priority", "Priority"],
                      ["schedule", "By trigger"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`btn small${autoSort === value ? " primary" : " ghost"}`}
                      aria-pressed={autoSort === value}
                      onClick={() => {
                        setAutoSort(value);
                        saveAutomationSidebarPrefs({ filter: autoFilter, sort: value });
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {manyJobs && listedAutomations.length ? (
              <div className="auto-bulk" data-testid="auto-bulk">
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={bulkBusy || listedAutomations.every((a) => !a.enabled)}
                  onClick={() => {
                    const targets = listedAutomations.filter((a) => a.enabled);
                    if (!targets.length) return;
                    if (targets.length > 1) {
                      setBulkConfirm({ enabled: false, count: targets.length });
                      return;
                    }
                    setBulkBusy(true);
                    setBulkError(null);
                    void patchListedAutomations(targets, false, dispatch)
                      .then((result) => {
                        if (result.failed) {
                          setBulkError(
                            result.error
                              ? `Paused ${result.ok}/${targets.length}. ${result.error}`
                              : `Paused ${result.ok}/${targets.length}.`,
                          );
                        }
                      })
                      .finally(() => setBulkBusy(false));
                  }}
                >
                  Pause listed
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={bulkBusy || listedAutomations.every((a) => a.enabled)}
                  onClick={() => {
                    const targets = listedAutomations.filter((a) => !a.enabled);
                    if (!targets.length) return;
                    if (targets.length > 1) {
                      setBulkConfirm({ enabled: true, count: targets.length });
                      return;
                    }
                    setBulkBusy(true);
                    setBulkError(null);
                    void patchListedAutomations(targets, true, dispatch)
                      .then((result) => {
                        if (result.failed) {
                          setBulkError(
                            result.error
                              ? `Enabled ${result.ok}/${targets.length}. ${result.error}`
                              : `Enabled ${result.ok}/${targets.length}.`,
                          );
                        }
                      })
                      .finally(() => setBulkBusy(false));
                  }}
                >
                  Enable listed
                </button>
              </div>
            ) : null}
            {bulkConfirm ? (
              <ConfirmModal
                title={
                  bulkConfirm.enabled
                    ? `Enable ${bulkConfirm.count} jobs?`
                    : `Pause ${bulkConfirm.count} jobs?`
                }
                body={
                  bulkConfirm.enabled
                    ? "Listed paused jobs will be turned back on."
                    : "Listed enabled jobs will stop firing until you enable them again."
                }
                confirmLabel={bulkConfirm.enabled ? "Enable listed" : "Pause listed"}
                danger={!bulkConfirm.enabled}
                testId="auto-bulk-confirm"
                onCancel={() => setBulkConfirm(null)}
                onConfirm={() => {
                  const enabled = bulkConfirm.enabled;
                  const targets = listedAutomations.filter((a) => a.enabled !== enabled);
                  setBulkConfirm(null);
                  setBulkBusy(true);
                  setBulkError(null);
                  void patchListedAutomations(targets, enabled, dispatch)
                    .then((result) => {
                      if (result.failed) {
                        const verb = enabled ? "Enabled" : "Paused";
                        setBulkError(
                          result.error
                            ? `${verb} ${result.ok}/${targets.length}. ${result.error}`
                            : `${verb} ${result.ok}/${targets.length}.`,
                        );
                      }
                    })
                    .finally(() => setBulkBusy(false));
                }}
              />
            ) : null}
            {deleteAutomationId ? (
              <ConfirmModal
                title={`Delete ${state.automations.find((a) => a.id === deleteAutomationId)?.name ?? "job"}?`}
                body="This cannot be undone."
                confirmLabel="Delete"
                danger
                testId="auto-sidebar-delete-confirm"
                onCancel={() => setDeleteAutomationId(null)}
                onConfirm={() => {
                  const id = deleteAutomationId;
                  setDeleteAutomationId(null);
                  void api
                    .deleteAutomation(id)
                    .then(() => dispatch({ type: "automationDeleted", id }));
                }}
              />
            ) : null}
            {bulkError ? <p className="error auto-bulk-error">{bulkError}</p> : null}
          </>
        ) : null}
        {state.section === "automations" && state.automations.length ? (
          <div className="auto-health" data-testid="auto-health">
            <p>{formatAutomationHealth(automationHealthCounts(state.automations, state.runs))}</p>
            {fleetExtras ? <p data-testid="auto-fleet-extras">{fleetExtras}</p> : null}
          </div>
        ) : null}
        <div
          className={`side-list-pane${showFleetActivity ? " auto-side-split" : ""}${
            showFleetActivity && fleetOpen ? " is-open" : ""
          }`}
        >
          <div
            className="session-list"
            aria-label={inboxOpen ? "Inbox" : sectionLabel(state.section, productMode)}
          >
            {inboxOpen ? (
              <InboxList
                rows={inboxRows}
                sessions={state.sessions}
                query={q}
                mode={productMode}
                onOpen={openInboxRow}
              />
            ) : state.section === "settings" ? (
              <nav
                className="settings-nav"
                aria-label="Settings"
                onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
                  const tabs = settingsNavTabs(productMode);
                  const index = tabs.indexOf(state.settingsTab);
                  const down = event.key === "ArrowDown" || event.key === "j";
                  const up = event.key === "ArrowUp" || event.key === "k";
                  if (!down && !up) return;
                  event.preventDefault();
                  const next =
                    tabs[down ? Math.min(tabs.length - 1, index + 1) : Math.max(0, index - 1)];
                  if (!next || next === state.settingsTab) return;
                  dispatch({ type: "settingsTab", tab: next });
                  const btn = event.currentTarget.querySelector(`[data-tab="${next}"]`);
                  if (btn instanceof HTMLElement) btn.focus();
                }}
              >
                {settingsNavGroupsForMode(productMode).map((group) => (
                  <div className="settings-nav-block" key={group.label}>
                    <p className="settings-nav-group">{group.label}</p>
                    {group.items.map((item) => {
                      const count = settingsNavCount(item, state.config);
                      return (
                        <button
                          key={item}
                          type="button"
                          data-tab={item}
                          className={state.settingsTab === item ? "active" : ""}
                          onClick={() => dispatch({ type: "settingsTab", tab: item })}
                        >
                          <span className="settings-nav-label">{settingsNavLabel(item)}</span>
                          {count != null ? (
                            <span className="settings-nav-count">{count}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>
            ) : state.section === "automations" ? (
              listedAutomations.length === 0 ? (
                <EmptyListNote>
                  {q || autoFilter !== "all" ? (
                    <>
                      No matching jobs
                      <button
                        type="button"
                        className="btn small"
                        data-testid="auto-clear-filters"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          setAutoFilter("all");
                          saveAutomationSidebarPrefs({ filter: "all", sort: autoSort });
                          dispatch({ type: "query", query: "" });
                        }}
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    "No jobs"
                  )}
                </EmptyListNote>
              ) : automationGroups ? (
                automationGroups.map((group) => (
                  <div
                    key={group.kind}
                    className="auto-group"
                    data-testid={`auto-group-${group.kind}`}
                  >
                    <p className="auto-group-label">{group.label}</p>
                    {group.items.map((a) => (
                      <AutomationListItem
                        key={a.id}
                        item={a}
                        runs={state.runs}
                        selected={state.selectedAutomationId === a.id}
                        unread={state.unreadAutomationIds.includes(a.id)}
                        onSelect={(id) => dispatch({ type: "selectAutomation", id })}
                        onPauseToggle={(item) => {
                          void api
                            .patchAutomation(item.id, { enabled: !item.enabled })
                            .then((automation) => dispatch({ type: "automation", automation }));
                        }}
                        onDuplicate={(item) => {
                          void api.cloneAutomation(item.id).then((copy) => {
                            dispatch({ type: "automation", automation: copy });
                            dispatch({ type: "selectAutomation", id: copy.id });
                          });
                        }}
                        onSettings={(item) =>
                          dispatch({ type: "newAutomation", open: true, editId: item.id })
                        }
                        onDelete={(item) => setDeleteAutomationId(item.id)}
                      />
                    ))}
                  </div>
                ))
              ) : (
                listedAutomations.map((a) => (
                  <AutomationListItem
                    key={a.id}
                    item={a}
                    runs={state.runs}
                    selected={state.selectedAutomationId === a.id}
                    unread={state.unreadAutomationIds.includes(a.id)}
                    onSelect={(id) => dispatch({ type: "selectAutomation", id })}
                    onPauseToggle={(item) => {
                      void api
                        .patchAutomation(item.id, { enabled: !item.enabled })
                        .then((automation) => dispatch({ type: "automation", automation }));
                    }}
                    onDuplicate={(item) => {
                      void api.cloneAutomation(item.id).then((copy) => {
                        dispatch({ type: "automation", automation: copy });
                        dispatch({ type: "selectAutomation", id: copy.id });
                      });
                    }}
                    onSettings={(item) =>
                      dispatch({ type: "newAutomation", open: true, editId: item.id })
                    }
                    onDelete={(item) => setDeleteAutomationId(item.id)}
                  />
                ))
              )
            ) : state.section === "board" ? (
              boards.length === 0 ? (
                <EmptyListNote>{q ? "No matching boards" : "No boards"}</EmptyListNote>
              ) : (
                boards.map((row) => (
                  <div
                    key={row.id}
                    className={`session-item has-menu ${state.selectedBoardId === row.id ? "active" : ""}`}
                    title={row.title}
                  >
                    <button
                      type="button"
                      className="session-item-open"
                      title={row.title}
                      onClick={() => dispatch({ type: "selectBoard", id: row.id })}
                    >
                      <span className="dot idle" />
                      <span>
                        <div className="title">
                          <span className="title-text">{row.title}</span>
                        </div>
                        <div className="meta">
                          {row.objectCount} {row.objectCount === 1 ? "object" : "objects"}
                          {row.frameCount ? ` · ${row.frameCount} frames` : ""}
                          {row.updatedAt ? ` · ${formatWhen(row.updatedAt)}` : ""}
                        </div>
                      </span>
                    </button>
                    <OverflowMenu
                      title={`More for ${row.title}`}
                      toggleClassName="btn icon ghost small"
                    >
                      <MenuItem
                        onClick={() => {
                          void api
                            .duplicateBoard(row.id)
                            .then((board) => {
                              dispatch({ type: "board", board });
                              dispatch({ type: "selectBoard", id: board.id });
                            })
                            .catch((err: unknown) => {
                              showNotice(
                                err instanceof Error ? err.message : "Could not duplicate",
                              );
                            });
                        }}
                      >
                        Duplicate
                      </MenuItem>
                      <MenuSep />
                      <MenuItem
                        danger
                        onClick={() => {
                          void (async () => {
                            if (
                              !(await askConfirm({
                                title: `Delete ${row.title}?`,
                                body: "This cannot be undone.",
                                confirmLabel: "Delete",
                                danger: true,
                              }))
                            )
                              return;
                            void api
                              .deleteBoard(row.id)
                              .then(() => dispatch({ type: "boardDeleted", id: row.id }));
                          })();
                        }}
                      >
                        Delete
                      </MenuItem>
                    </OverflowMenu>
                  </div>
                ))
              )
            ) : state.section === "project" ? (
              projects.length === 0 ? (
                <EmptyListNote>
                  {q
                    ? swarmMode
                      ? "No matching teams"
                      : "No matching projects"
                    : swarmMode
                      ? "No teams"
                      : "No projects"}
                </EmptyListNote>
              ) : (
                projects.map((row) => {
                  const displayName = swarmMode ? (row.teamName ?? row.title) : row.title;
                  const teamStatus = swarmMode ? row.teamStatus : undefined;
                  const statusDot =
                    teamStatus === "directing"
                      ? "running"
                      : teamStatus === "needs_you"
                        ? "needs-you"
                        : teamStatus === "paused"
                          ? "paused"
                          : row.paused
                            ? "paused"
                            : "idle";
                  return (
                    <div
                      key={row.id}
                      className={`session-item has-menu ${state.selectedProjectId === row.id ? "active" : ""}`}
                      title={displayName}
                    >
                      <button
                        type="button"
                        className="session-item-open"
                        title={displayName}
                        onClick={() => dispatch({ type: "selectProject", id: row.id })}
                      >
                        <span className={`dot ${statusDot}`} />
                        <span>
                          <div className="title">
                            <span className="title-text">{displayName}</span>
                          </div>
                          <div className="meta">
                            {teamStatus ? `${teamStatus.replace("_", " ")} - ` : ""}
                            {row.starter ?? "project"}
                            {` · ${row.memberCount} ${row.memberCount === 1 ? "member" : "members"}`}
                            {row.needsYouCount ? ` · ${row.needsYouCount} needs you` : ""}
                            {row.paused ? " · paused" : ""}
                            {row.updatedAt ? ` · ${formatWhen(row.updatedAt)}` : ""}
                          </div>
                        </span>
                      </button>
                      <OverflowMenu
                        title={`More for ${displayName}`}
                        toggleClassName="btn icon ghost small"
                      >
                        <MenuItem
                          onClick={() => {
                            void api
                              .duplicateProject(row.id)
                              .then((project) => {
                                dispatch({ type: "project", project });
                                dispatch({ type: "selectProject", id: project.id });
                              })
                              .catch((err: unknown) => {
                                showNotice(
                                  err instanceof Error ? err.message : "Could not duplicate",
                                );
                              });
                          }}
                        >
                          Duplicate
                        </MenuItem>
                        <MenuSep />
                        <MenuItem
                          danger
                          onClick={() => {
                            void (async () => {
                              if (
                                !(await askConfirm({
                                  title: `Delete ${displayName}?`,
                                  body: swarmMode
                                    ? "Teammates stay in Swarm."
                                    : "Members stay on Agents.",
                                  confirmLabel: "Delete",
                                  danger: true,
                                }))
                              )
                                return;
                              void api
                                .deleteProject(row.id)
                                .then(() => dispatch({ type: "projectDeleted", id: row.id }));
                            })();
                          }}
                        >
                          Delete
                        </MenuItem>
                      </OverflowMenu>
                    </div>
                  );
                })
              )
            ) : state.section === "design" ? (
              designs.length === 0 ? (
                <EmptyListNote>{q ? "No matching designs" : "No designs"}</EmptyListNote>
              ) : (
                <SessionGroupBlocks
                  sessions={designs}
                  selectedId={state.selectedId}
                  unreadIds={state.unreadIds}
                  repos={state.repos}
                  metaFor={(s) => `${s.archived ? "Archived · " : ""}${s.model}`}
                  previewFor={(s) => (
                    <DesignThumb
                      session={s}
                      html={state.canvasHtml[s.id]}
                      systems={state.designSystems}
                    />
                  )}
                  onSelect={(id) => dispatch({ type: "select", id })}
                  groupBy={groupBy}
                />
              )
            ) : state.section === "games" ? (
              games.length === 0 ? (
                <EmptyListNote>{q ? "No matching games" : "No games"}</EmptyListNote>
              ) : (
                <SessionGroupBlocks
                  sessions={games}
                  selectedId={state.selectedId}
                  unreadIds={state.unreadIds}
                  repos={state.repos}
                  metaFor={(s) => `${s.archived ? "Archived · " : ""}${s.model}`}
                  previewFor={(s) => (
                    <DesignThumb
                      session={s}
                      html={state.canvasHtml[s.id]}
                      systems={state.designSystems}
                      shot={state.gameShots[s.id]}
                    />
                  )}
                  onSelect={(id) => dispatch({ type: "select", id })}
                  groupBy={groupBy}
                />
              )
            ) : state.section === "assets" ? (
              assets.length === 0 ? (
                <EmptyListNote>{q ? "No matching assets" : "No assets"}</EmptyListNote>
              ) : (
                <SessionGroupBlocks
                  sessions={assets}
                  selectedId={state.selectedId}
                  unreadIds={state.unreadIds}
                  repos={state.repos}
                  metaFor={(s) => `${s.archived ? "Archived · " : ""}${s.model}`}
                  previewFor={(s) => (
                    <DesignThumb
                      session={s}
                      html={state.canvasHtml[s.id]}
                      systems={state.designSystems}
                    />
                  )}
                  onSelect={(id) => dispatch({ type: "select", id })}
                  groupBy={groupBy}
                />
              )
            ) : state.section === "ide" ? (
              ideSessions.length === 0 ? (
                <EmptyListNote>{q ? "No matching workspaces" : "No workspaces"}</EmptyListNote>
              ) : (
                <SessionGroupBlocks
                  sessions={ideSessions}
                  selectedId={state.selectedId}
                  unreadIds={state.unreadIds}
                  repos={state.repos}
                  metaFor={agentMeta}
                  onSelect={(id) => dispatch({ type: "select", id })}
                  groupBy={groupBy}
                />
              )
            ) : state.section === "codebase" ? (
              <>
                {repos.length === 0 ? (
                  <EmptyListNote>{q ? "No matching repos" : "No repos yet"}</EmptyListNote>
                ) : (
                  groupRepos(repos).map((group) => (
                    <div key={group.forge} className="repo-group">
                      <p className="repo-group-label">{forgeLabel(group.forge)}</p>
                      {group.repos.map((row) => {
                        const claims = brainClaimsForRepo(state.brain, row.checkout.url).nodeCount;
                        return (
                          <div
                            key={row.id}
                            className={`session-item repo-item ${state.selectedRepoId === row.id ? "active" : ""}`}
                          >
                            <button
                              type="button"
                              className="repo-item-open"
                              title={row.name}
                              onClick={() => dispatch({ type: "selectRepo", id: row.id })}
                            >
                              <span className={`forge-glyph ${row.checkout.forge}`} aria-hidden>
                                {forgeShort(row.checkout.forge)}
                              </span>
                              <span>
                                <div className="title">
                                  <span className="title-text">
                                    {shortRepoName(row.checkout.url, row.name)}
                                  </span>
                                  {row.autoReview ? (
                                    <span
                                      className="repo-flag"
                                      title="Auto-review new pull requests"
                                    >
                                      auto
                                    </span>
                                  ) : null}
                                  {claims > 0 ? (
                                    <span
                                      className="repo-flag"
                                      title={`${claims} brain claims for this remote`}
                                    >
                                      {claims}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="meta">
                                  {row.name}
                                  {row.checkout.ref ? ` · ${row.checkout.ref}` : ""}
                                </div>
                              </span>
                              <span
                                className={`pr-count ${row.openPullCount ? "has-open" : ""}`}
                                title={`${row.openPullCount ?? 0} open pull requests`}
                              >
                                {typeof row.openPullCount === "number" ? row.openPullCount : "—"}
                              </span>
                            </button>
                            <OverflowMenu
                              title={`More for ${row.name}`}
                              toggleClassName="btn icon ghost small"
                            >
                              <MenuItem
                                danger
                                onClick={() => {
                                  void (async () => {
                                    if (
                                      !(await askConfirm({
                                        title: `Unlink ${row.name}?`,
                                        body: "Agents keep their checkout.",
                                        confirmLabel: "Unlink",
                                        danger: true,
                                      }))
                                    )
                                      return;
                                    void api.deleteRepo(row.id).then(
                                      () => dispatch({ type: "repoDeleted", id: row.id }),
                                      (err: unknown) => {
                                        showNotice(
                                          err instanceof Error
                                            ? err.message
                                            : `Could not unlink ${row.name}`,
                                        );
                                      },
                                    );
                                  })();
                                }}
                              >
                                Unlink
                              </MenuItem>
                            </OverflowMenu>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </>
            ) : state.section === "brain" ? (
              <EmptyListNote>{q ? "No matching claims" : "No claims yet"}</EmptyListNote>
            ) : state.section === "grafana" ? (
              <EmptyListNote>{q ? "No matching queries" : "No saved queries yet"}</EmptyListNote>
            ) : state.section === "slack" ? (
              slackBooting ? (
                <SlackChannelListSkeleton />
              ) : slackConversations.length === 0 && !state.slackStatus?.connected ? (
                <EmptyListNote>
                  {q ? "No matching channels" : "Sign in with Slack to see channels"}
                </EmptyListNote>
              ) : (
                <div className="slack-sidebar">
                  <div className="slack-views">
                    <button
                      type="button"
                      className={`slack-view-item ${state.slackActivityOpen ? "active" : ""} ${state.slackActivityUnseen ? "unread" : ""}`}
                      data-testid="slack-activity-nav"
                      onClick={() => dispatch({ type: "selectSlackActivity" })}
                    >
                      <span className="slack-list-prefix" aria-hidden>
                        <IconInbox />
                      </span>
                      <span className="title-text">Activity</span>
                      {state.slackActivity.length ? (
                        <span
                          className="slack-view-count"
                          aria-label={`${state.slackActivity.length} items`}
                        >
                          {state.slackActivity.length}
                        </span>
                      ) : null}
                      {state.slackActivityUnseen ? (
                        <span className="unread-dot" aria-label="Unread" />
                      ) : null}
                    </button>
                  </div>
                  {slackConversations.length === 0 ? (
                    <EmptyListNote>{q ? "No matching channels" : "No channels yet"}</EmptyListNote>
                  ) : (
                    slackChannelGroups(slackConversations).map((group) => {
                      const open =
                        Boolean(q) || slackGroups[group.id as SlackSidebarGroupId] !== false;
                      const unread = group.items.filter((row) => row.unread).length;
                      return (
                        <div
                          key={group.id}
                          className="session-group slack-group"
                          data-group={group.id}
                        >
                          <button
                            type="button"
                            className="session-group-toggle"
                            aria-expanded={open}
                            onClick={() => {
                              if (q) return;
                              const id = group.id as SlackSidebarGroupId;
                              const next = { ...slackGroups, [id]: slackGroups[id] === false };
                              setSlackGroups(next);
                              saveSlackSidebarGroups(next);
                            }}
                          >
                            <IconChevron expanded={open} />
                            <span className="session-group-label">{group.label}</span>
                            {!open && unread ? (
                              <span className="unread-dot" aria-label={`${unread} unread`} />
                            ) : null}
                          </button>
                          {open
                            ? group.items.map((row) => {
                                const listening = sessionsListeningOnSlack(
                                  state.sessions,
                                  row.id,
                                ).length;
                                return (
                                  <div
                                    key={row.id}
                                    className={`session-item slack-item ${!state.slackActivityOpen && state.selectedSlackChannelId === row.id ? "active" : ""} ${row.unread ? "unread" : ""}`}
                                  >
                                    <button
                                      type="button"
                                      className="slack-item-open"
                                      title={conversationLabel(row)}
                                      onClick={() =>
                                        dispatch({ type: "selectSlackChannel", id: row.id })
                                      }
                                    >
                                      <span className="slack-list-prefix" aria-hidden>
                                        {row.avatarUrl && isDirectConversation(row.kind) ? (
                                          <img
                                            className="slack-list-avatar"
                                            src={row.avatarUrl}
                                            alt=""
                                          />
                                        ) : (
                                          <SlackKindMark kind={row.kind} />
                                        )}
                                      </span>
                                      <span>
                                        <div className="title">
                                          <span className="title-text">
                                            {row.name.replace(/^[@#]/, "")}
                                          </span>
                                          {row.unread ? (
                                            <span className="unread-dot" aria-label="Unread" />
                                          ) : null}
                                        </div>
                                        {listening ? (
                                          <div className="meta">
                                            {row.topic ? `Listening · ${row.topic}` : "Listening"}
                                          </div>
                                        ) : null}
                                      </span>
                                    </button>
                                    <SlackListenButton
                                      channelId={row.id}
                                      channelName={row.name.replace(/^[@#]/, "")}
                                    />
                                    <button
                                      type="button"
                                      className={`slack-star-btn${row.starred ? " on" : ""}`}
                                      title={row.starred ? "Unstar" : "Star"}
                                      aria-label={
                                        row.starred ? `Unstar ${row.name}` : `Star ${row.name}`
                                      }
                                      onClick={() =>
                                        void starSlackChannel(row.id, !row.starred, dispatch).catch(
                                          (err: unknown) => {
                                            showNotice(
                                              err instanceof Error
                                                ? err.message
                                                : "Could not update favorite",
                                            );
                                          },
                                        )
                                      }
                                    >
                                      <IconStar filled={Boolean(row.starred)} />
                                    </button>
                                  </div>
                                );
                              })
                            : null}
                        </div>
                      );
                    })
                  )}
                </div>
              )
            ) : state.section === "docker" && state.dockerView === "swarm" ? (
              <>
                {!dockerSwarmActive(state.dockerSwarm?.info ?? { state: "inactive" }) ? (
                  <EmptyListNote>Swarm inactive</EmptyListNote>
                ) : swarmServices.length === 0 &&
                  swarmNodes.length === 0 &&
                  swarmStacks.length === 0 ? (
                  <EmptyListNote>
                    {q
                      ? "No matching services"
                      : dockerSwarmManager(state.dockerSwarm?.info ?? { controlAvailable: false })
                        ? "No services"
                        : "Worker node — no service list"}
                  </EmptyListNote>
                ) : (
                  <>
                    {swarmServices.length ? (
                      <div className="docker-group" data-group="running">
                        <div className="docker-group-head">
                          <p className="session-group-label">Services ({swarmServices.length})</p>
                        </div>
                        {swarmServices.map((row) => (
                          <div
                            key={row.id}
                            className={`session-item docker-item ${state.selectedSwarmServiceId === row.id || state.selectedSwarmServiceId === row.name ? "active" : ""}`}
                          >
                            <button
                              type="button"
                              className="docker-item-open"
                              title={row.name}
                              onClick={() => dispatch({ type: "selectSwarmService", id: row.id })}
                            >
                              <span
                                className={`dot ${dockerSwarmServiceLive(row) ? "running" : "stopped"}`}
                              />
                              <span>
                                <div className="title">
                                  <span className="title-text">{row.name}</span>
                                  <span className="docker-age">{row.replicas}</span>
                                </div>
                                <div className="meta">
                                  {row.image || row.mode}
                                  {row.ports ? ` · ${row.ports}` : ""}
                                </div>
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {swarmNodes.length ? (
                      <div className="docker-group" data-group="stopped">
                        <div className="docker-group-head">
                          <p className="session-group-label">Nodes ({swarmNodes.length})</p>
                        </div>
                        {swarmNodes.map((row) => (
                          <div
                            key={row.id}
                            className={`session-item docker-item ${state.selectedSwarmNodeId === row.id || state.selectedSwarmNodeId === row.hostname ? "active" : ""}`}
                          >
                            <button
                              type="button"
                              className="docker-item-open"
                              title={row.hostname}
                              onClick={() => dispatch({ type: "selectSwarmNode", id: row.id })}
                            >
                              <span
                                className={`dot ${dockerSwarmNodeReady(row) ? "running" : "stopped"}`}
                              />
                              <span>
                                <div className="title">
                                  <span className="title-text">{row.hostname}</span>
                                  <span className="docker-age">{row.status}</span>
                                </div>
                                <div className="meta">
                                  {row.availability}
                                  {row.managerStatus ? ` · ${row.managerStatus}` : ""}
                                </div>
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {swarmStacks.length ? (
                      <div className="docker-group" data-group="exited">
                        <div className="docker-group-head">
                          <p className="session-group-label">Stacks ({swarmStacks.length})</p>
                        </div>
                        {swarmStacks.map((row) => (
                          <div key={row.name} className="session-item docker-item">
                            <div className="docker-item-open">
                              <span className="dot stopped" />
                              <span>
                                <div className="title">
                                  <span className="title-text">{row.name}</span>
                                  <span className="docker-age">
                                    {row.services} {row.services === 1 ? "service" : "services"}
                                  </span>
                                </div>
                                <div className="meta">{row.orchestrator || "Swarm"}</div>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </>
            ) : state.section === "docker" ? (
              <>
                {containers.length === 0 ? (
                  <EmptyListNote>{q ? "No matching containers" : "No containers"}</EmptyListNote>
                ) : (
                  (
                    [
                      ["running", "Running", grouped.running],
                      ...(runningOnly
                        ? []
                        : ([
                            ["stopped", "Stopped", grouped.stopped],
                            ["exited", "Exited", grouped.exited],
                          ] as const)),
                    ] as const
                  ).map(([id, label, rows]) =>
                    rows.length === 0 ? null : (
                      <div key={id} className="docker-group" data-group={id}>
                        <div className="docker-group-head">
                          <p className="session-group-label">
                            {label} ({rows.length})
                          </p>
                          {id === "running" ? (
                            <button
                              type="button"
                              className="docker-group-action"
                              disabled={stopping}
                              aria-label="Stop all running containers"
                              onClick={() => void stopSelectedContainers(rows)}
                            >
                              Stop all
                            </button>
                          ) : null}
                        </div>
                        {rows.map((row) => {
                          const age = compactDockerAge(row.status, row.createdAt);
                          const shortId = shortContainerId(row.containerId || row.id);
                          return (
                            <div
                              key={row.id}
                              className={`session-item docker-item ${state.selectedContainerId === row.id ? "active" : ""}`}
                            >
                              <label className="docker-pick">
                                <input
                                  type="checkbox"
                                  checked={picked.has(row.id)}
                                  disabled={stopping}
                                  aria-label={`Select ${row.name}`}
                                  onChange={(e) => {
                                    const next = new Set(picked);
                                    if (e.target.checked) next.add(row.id);
                                    else next.delete(row.id);
                                    setPicked(next);
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                className="docker-item-open"
                                title={row.name}
                                onClick={() => dispatch({ type: "selectContainer", id: row.id })}
                              >
                                <span className={`dot ${dockerDotClass(row.state)}`} />
                                <span>
                                  <div className="title">
                                    <span className="title-text">{row.name}</span>
                                    {age ? <span className="docker-age">{age}</span> : null}
                                  </div>
                                  <div className="meta">
                                    {shortId}
                                    {row.sessionTitle ? ` · ${row.sessionTitle}` : ""}
                                    {row.locus ? "" : " · host"}
                                  </div>
                                </span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ),
                  )
                )}
              </>
            ) : sessions.length === 0 && !boardWaiting.length ? (
              <EmptyListNote>
                {q
                  ? productMode === "swarm"
                    ? "No matching teammates"
                    : "No matching agents"
                  : productMode === "swarm"
                    ? "No teammates"
                    : "No agents"}
              </EmptyListNote>
            ) : (
              <>
                {showNeedsGroup &&
                (sessions.filter(sessionHasNeedsYou).length ||
                  boardWaiting.length ||
                  brainWaiting) ? (
                  <div className="session-group">
                    {productMode === "swarm" ? null : (
                      <p className="session-group-label warn">Needs you</p>
                    )}
                    {sessions.filter(sessionHasNeedsYou).map((s) => (
                      <SessionRow
                        key={`need-${s.id}`}
                        session={s}
                        selected={state.selectedId === s.id}
                        unread={state.unreadIds.includes(s.id)}
                        meta={
                          productMode === "swarm"
                            ? swarmRosterMeta(s)
                            : agentMeta(
                                s,
                                state.projects.find((row) => row.id === s.projectId)?.title,
                              )
                        }
                        hub={productMode === "swarm"}
                        rosterPrefs={productMode === "swarm" ? rosterPrefs : undefined}
                        onRosterPrefs={productMode === "swarm" ? updateRosterPrefs : undefined}
                        onSelect={(id) => dispatch({ type: "select", id })}
                      />
                    ))}
                    {boardWaiting.map((row) => (
                      <button
                        key={row.key}
                        type="button"
                        className={`session-item needs-you${state.selectedBoardId === row.boardId && state.boardFocusObjectId === row.objectId ? " active" : ""}`}
                        title={`${row.title} · ${row.detail}`}
                        onClick={() =>
                          dispatch({
                            type: "selectBoard",
                            id: row.boardId,
                            objectId: row.objectId,
                          })
                        }
                      >
                        <span className="dot needs-you" aria-hidden="true" />
                        <span>
                          <div className="title">
                            <span className="title-text">{row.title}</span>
                          </div>
                          <div className="meta">{row.detail}</div>
                        </span>
                      </button>
                    ))}
                    {brainWaiting ? (
                      <button
                        type="button"
                        className="session-item needs-you"
                        title="Brain inbox"
                        onClick={() => {
                          rememberBrainInbox();
                          dispatch({ type: "section", section: "brain" });
                        }}
                      >
                        <span className="dot needs-you" aria-hidden="true" />
                        <span>
                          <div className="title">
                            <span className="title-text">Brain</span>
                          </div>
                          <div className="meta">
                            {brainWaiting === 1
                              ? "1 graph correction"
                              : `${brainWaiting} graph corrections`}
                          </div>
                        </span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {productMode === "swarm" && rosterPrefs.sections.length ? (
                  (() => {
                    const rest = showNeedsGroup
                      ? sessions.filter((s) => !sessionHasNeedsYou(s))
                      : sessions;
                    const assigned = new Set(
                      rosterPrefs.sections.flatMap((section) => section.sessionIds),
                    );
                    return (
                      <>
                        {rosterPrefs.sections.map((section) => {
                          const rows = rest.filter((s) => section.sessionIds.includes(s.id));
                          if (!rows.length) return null;
                          return (
                            <div key={section.id} className="session-group">
                              <p className="session-group-label">{section.name}</p>
                              {rows.map((s) => (
                                <SessionRow
                                  key={s.id}
                                  session={s}
                                  selected={state.selectedId === s.id}
                                  unread={state.unreadIds.includes(s.id)}
                                  meta={swarmRosterMeta(s)}
                                  hub
                                  rosterPrefs={rosterPrefs}
                                  onRosterPrefs={updateRosterPrefs}
                                  onSelect={(id) => dispatch({ type: "select", id })}
                                />
                              ))}
                            </div>
                          );
                        })}
                        <SessionGroupBlocks
                          sessions={rest.filter((s) => !assigned.has(s.id))}
                          selectedId={state.selectedId}
                          unreadIds={state.unreadIds}
                          repos={state.repos}
                          hub
                          rosterPrefs={rosterPrefs}
                          onRosterPrefs={updateRosterPrefs}
                          metaFor={(s) => swarmRosterMeta(s)}
                          onSelect={(id) => dispatch({ type: "select", id })}
                          groupBy={groupBy}
                        />
                      </>
                    );
                  })()
                ) : (
                  <SessionGroupBlocks
                    sessions={
                      showNeedsGroup ? sessions.filter((s) => !sessionHasNeedsYou(s)) : sessions
                    }
                    selectedId={state.selectedId}
                    unreadIds={state.unreadIds}
                    repos={state.repos}
                    hub={productMode === "swarm"}
                    rosterPrefs={productMode === "swarm" ? rosterPrefs : undefined}
                    onRosterPrefs={productMode === "swarm" ? updateRosterPrefs : undefined}
                    metaFor={(s) =>
                      productMode === "swarm"
                        ? swarmRosterMeta(s)
                        : agentMeta(s, state.projects.find((row) => row.id === s.projectId)?.title)
                    }
                    onSelect={(id) => dispatch({ type: "select", id })}
                    groupBy={groupBy}
                  />
                )}
              </>
            )}
          </div>
          {showFleetActivity ? (
            <section className="auto-fleet-activity" data-testid="auto-fleet-activity">
              <button
                type="button"
                className="auto-fleet-toggle"
                aria-expanded={fleetOpen}
                onClick={() => {
                  setFleetOpen((v) => {
                    const next = !v;
                    saveAutomationSidebarPrefs({ fleetOpen: next });
                    return next;
                  });
                }}
              >
                Recent activity
              </button>
              {fleetOpen ? (
                <ul className="auto-fleet-list">
                  {fleetRecentRuns(state.runs, 10).map((run) => {
                    const job = state.automations.find((a) => a.id === run.automationId);
                    const statusLabel = runHistoryStatusLabel(run);
                    const detail = run.summary?.trim() || run.error?.trim() || run.reason?.trim();
                    return (
                      <li key={run.id} className="auto-fleet-row">
                        <span className={`status-chip ${statusLabel}`}>{runStatusText(run)}</span>
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() =>
                            dispatch({ type: "selectAutomation", id: run.automationId })
                          }
                        >
                          {job?.name ?? run.automationId}
                        </button>
                        <span className="hint">{formatWhen(run.startedAt)}</span>
                        {detail ? <span className="hint">{detail}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
        <div className="side-foot">
          {swarmMode ? (
            <button
              type="button"
              className={`btn ghost swarm-config-btn${state.section === "settings" ? " active" : ""}`}
              aria-label={state.section === "settings" ? "Teammates" : "Settings"}
              data-testid="swarm-config"
              onClick={() =>
                state.section === "settings"
                  ? returnToSwarmTeammates()
                  : openSettings(dispatch, DEFAULT_SWARM_SETTINGS_TAB)
              }
            >
              {state.section === "settings" ? <IconAgents /> : <IconGear />}
              <span>{state.section === "settings" ? "Teammates" : "Settings"}</span>
            </button>
          ) : null}
          {swarmMode && state.section === "agents" && hiddenTeammateCount > 0 ? (
            <label className="hint archive-toggle" data-testid="swarm-show-hidden">
              <input
                type="checkbox"
                checked={showHiddenTeammates}
                onChange={(e) => setShowHiddenTeammates(e.target.checked)}
              />
              Show hidden ({hiddenTeammateCount})
            </label>
          ) : null}
          {state.section === "codebase" ? (
            <span className="hint">
              {repos.length} {repos.length === 1 ? "repo" : "repos"}
            </span>
          ) : state.section === "board" ? (
            <span className="hint">
              {boards.length} {boards.length === 1 ? "board" : "boards"}
            </span>
          ) : state.section === "project" ? (
            <span className="hint">
              {projects.length}{" "}
              {swarmMode
                ? projects.length === 1
                  ? "team"
                  : "teams"
                : projects.length === 1
                  ? "project"
                  : "projects"}
            </span>
          ) : state.section === "slack" ? (
            <span className="hint">
              {slackBooting
                ? "Loading conversations"
                : `${state.slackConversations.length} ${
                    state.slackConversations.length === 1 ? "conversation" : "conversations"
                  }`}
            </span>
          ) : state.section === "docker" ? (
            <span className="hint docker-daemon">
              <span className={state.dockerKind === "docker" && state.connected ? "ok" : ""}>
                {state.dockerKind === "docker" ? "daemon ok" : "daemon mock"}
              </span>
              {state.dockerView === "swarm" ? (
                <span>
                  {dockerSwarmActive(state.dockerSwarm?.info ?? { state: "inactive" })
                    ? dockerSwarmManager(state.dockerSwarm?.info ?? { controlAvailable: false })
                      ? "swarm manager"
                      : "swarm worker"
                    : "swarm off"}
                  {" · "}
                  {state.dockerSwarm?.services.length ?? 0}{" "}
                  {(state.dockerSwarm?.services.length ?? 0) === 1 ? "service" : "services"}
                  {" · "}
                  {state.dockerSwarm?.stacks.length ?? 0}{" "}
                  {(state.dockerSwarm?.stacks.length ?? 0) === 1 ? "stack" : "stacks"}
                </span>
              ) : (
                <span>
                  {containers.length} {containers.length === 1 ? "container" : "containers"}
                </span>
              )}
            </span>
          ) : inboxOpen ? null : (state.section === "agents" && archivedCount > 0) ||
            (state.section === "ide" && archivedIdeCount > 0) ||
            (state.section === "design" && archivedDesignCount > 0) ||
            (state.section === "games" && archivedGameCount > 0) ||
            (state.section === "assets" && archivedAssetCount > 0) ? (
            <label className="hint archive-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Archived (
              {state.section === "design"
                ? archivedDesignCount
                : state.section === "games"
                  ? archivedGameCount
                  : state.section === "assets"
                    ? archivedAssetCount
                    : state.section === "ide"
                      ? archivedIdeCount
                      : archivedCount}
              )
            </label>
          ) : null}
        </div>
      </div>
      {drawer && !state.collapsed && !swarmMode ? (
        <div
          className="side-scrim"
          data-testid="side-scrim"
          aria-hidden="true"
          onClick={() => dispatch({ type: "sidebarCollapsed", collapsed: true })}
        />
      ) : null}
      {state.collapsed && !swarmMode ? null : (
        <Splitter
          className="sidebar-gutter"
          orientation="vertical"
          label="Resize sidebar"
          value={sidebarWidth}
          min={SIDEBAR_WIDTH_MIN}
          max={SIDEBAR_WIDTH_MAX}
          valueText={`${sidebarWidth} pixels`}
          onPointerDown={onSidebarGutterDown}
          onKeyDown={onSidebarGutterKey}
          onDoubleClick={() => setWidth(SIDEBAR_WIDTH_DEFAULT)}
        />
      )}
    </aside>
  );
}
