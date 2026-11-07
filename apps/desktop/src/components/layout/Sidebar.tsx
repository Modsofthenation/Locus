import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  dockerDotClass,
  dockerSwarmActive,
  dockerSwarmManager,
  dockerSwarmNodeReady,
  dockerSwarmServiceLive,
  formatSchedule,
  forgeLabel,
  forgeShort,
  guestLabel,
  isDesignSession,
  isGameSession,
  isAssetSession,
  conversationLabel,
  isDirectConversation,
  isLocusAgentImage,
  sessionGitBranch,
  sessionRuntime,
  shortRepoName,
  automationLastFact,
  automationLatestRun,
  automationLatestAgentRun,
  automationHealth,
  automationHealthCounts,
  automationMatchesQuery,
  clipFact,
  formatAutomationHealth,
  formatNextFire,
  runHistoryStatusLabel,
  runStatusText,
  sessionsListeningOnSlack,
  boardNeedsYouItems,
  brainClaimsForRepo,
  parseProductMode,
  sessionDisplayName,
  sessionAvatarId,
  sessionAvatarPose,
  sessionAvatarAccessory,
  sessionListStamp,
  sessionMatchesSurface,
  type AgentSession,
  type Automation,
  type AutomationRun,
  type ForgeKind,
  type LinkedRepo,
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
  clusterSessionsByRepo,
  groupSessionsByDay,
  isEmptyDraftSession,
  isIdleArchiveCandidate,
  loadHideAutomationChats,
  saveHideAutomationChats,
  sessionRepoKey,
  sessionRepoLabel,
} from "@/lib/sessionGroups";
import { loadSidebarPrefs, saveSidebarPrefs } from "@/lib/sidebarPrefs";
import {
  IconAgents,
  IconChevron,
  IconClock,
  IconContainer,
  IconFolder,
  IconFrame,
  IconStack,
  IconGear,
  IconHash,
  IconPalette,
  IconGamepad,
  IconCube,
  IconPanel,
  IconPlus,
  IconRefresh,
  IconRepo,
  IconBrain,
  IconGrafana,
  IconStar,
  IconStop,
  IconWrench,
  IconInbox,
} from "./Icons";
import { DesignThumb } from "@/components/design/DesignThumb";
import { MenuItem, MenuLabel, MenuSep, OverflowMenu } from "./OverflowMenu";
import { Mascot } from "./Mascot";
import { SearchField } from "./SearchField";
import { rememberBrainInbox } from "@/lib/brainViewPrefs";
import { needsYouSessions, sessionHasNeedsYou } from "@/lib/needsYou";
import { formatSwarmListWhen, swarmRosterMeta } from "@/lib/swarmPresence";
import {
  addSwarmRosterSection,
  hideSwarmSession,
  loadSwarmRosterPrefs,
  moveSwarmSessionToSection,
  saveSwarmRosterPrefs,
  sectionIdForSession,
  showSwarmSession,
  type SwarmRosterPrefs,
} from "@/lib/swarmRosterPrefs";
import { TrustActions } from "@/components/chat/TrustActions";
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
import { loadAutomationSidebarPrefs, saveAutomationSidebarPrefs } from "@/lib/automationPrefs";
import { formatWhen } from "@/components/automations/Automations";
import { ConfirmModal } from "@/components/layout/ConfirmModal";
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
import { showNotice } from "@/lib/notice";
import { moreRailSections, primaryRailSections } from "@/lib/railNav";
import { ProductModeToggle } from "@/components/layout/ProductModeToggle";
import { swarmShellKeepsSection } from "@/lib/productMode";
import { PersonaAvatar } from "@/components/layout/PersonaAvatar";

const SECTION_META: Record<Exclude<UiSection, "settings">, { label: string; icon: ReactNode }> = {
  agents: { label: "Agents", icon: <IconAgents /> },
  design: { label: "Design", icon: <IconPalette /> },
  games: { label: "Games", icon: <IconGamepad /> },
  assets: { label: "Assets", icon: <IconCube /> },
  ide: { label: "IDE", icon: <IconFolder /> },
  board: { label: "Board", icon: <IconFrame /> },
  project: { label: "Projects", icon: <IconStack /> },
  codebase: { label: "Codebase", icon: <IconRepo /> },
  brain: { label: "Brain", icon: <IconBrain /> },
  slack: { label: "Slack", icon: <IconHash /> },
  grafana: { label: "Grafana", icon: <IconGrafana /> },
  docker: { label: "Docker", icon: <IconContainer /> },
  automations: { label: "Automations", icon: <IconClock /> },
};

function sectionMetaFor(
  mode: ReturnType<typeof parseProductMode>,
): Record<Exclude<UiSection, "settings">, { label: string; icon: ReactNode }> {
  if (mode !== "swarm") return SECTION_META;
  return {
    ...SECTION_META,
    agents: { label: "Teammates", icon: <IconAgents /> },
    project: { label: "Teams", icon: <IconStack /> },
    automations: { label: "Routines", icon: <IconClock /> },
  };
}

function sectionLabel(
  section: UiSection,
  mode: ReturnType<typeof parseProductMode> = "developer",
): string {
  if (section === "settings") return "Settings";
  return sectionMetaFor(mode)[section]?.label ?? "Agents";
}

function sectionSearchPlaceholder(
  section: UiSection,
  mode: ReturnType<typeof parseProductMode> = "developer",
): string {
  if (section === "docker") return "Search containers or services";
  if (section === "automations") {
    return mode === "swarm" ? "Search routines" : "Search automations";
  }
  if (section === "board") return "Search boards";
  if (section === "project") {
    return mode === "swarm" ? "Search teams" : "Search projects";
  }
  if (section === "design") return "Search designs";
  if (section === "games") return "Search games";
  if (section === "assets") return "Search assets";
  if (section === "ide") return "Search workspaces";
  if (section === "codebase") return "Search repos";
  if (section === "brain") return "Search claims";
  if (section === "slack") return "Search channels";
  if (section === "grafana") return "Search queries and dashboards";
  return mode === "swarm" ? "Search teammates" : "Search agents";
}

function EmptyListNote({ children }: { children: ReactNode }) {
  return (
    <div className="empty-list">
      <Mascot pose="rest" size={36} />
      <div className="empty-list-body">{children}</div>
    </div>
  );
}

const FORGE_ORDER: ForgeKind[] = ["github", "gitlab", "bitbucket"];

function groupRepos(repos: LinkedRepo[]): Array<{ forge: ForgeKind; repos: LinkedRepo[] }> {
  const buckets = new Map<ForgeKind, LinkedRepo[]>();
  for (const row of repos) {
    const list = buckets.get(row.checkout.forge) ?? [];
    list.push(row);
    buckets.set(row.checkout.forge, list);
  }
  return FORGE_ORDER.filter((forge) => buckets.has(forge)).map((forge) => ({
    forge,
    repos: buckets.get(forge)!,
  }));
}

function agentRuntimeMeta(s: AgentSession): string {
  const where =
    sessionRuntime(s) === "host"
      ? "Host"
      : s.runtime === "docker"
        ? s.dockerImage?.trim() && !isLocusAgentImage(s.dockerImage.trim())
          ? s.dockerImage.trim()
          : null
        : guestLabel(s.os);
  return [where, s.model].filter(Boolean).join(" · ");
}

function agentMeta(s: AgentSession, projectTitle?: string): string {
  return [
    s.archived ? "Archived" : null,
    s.automationId ? "Automation" : null,
    s.persona?.hubRole ? s.persona.hubRole : null,
    s.projectId ? (projectTitle ?? "Project") : null,
    agentRuntimeMeta(s),
    s.pull ? `#${s.pull.number}` : null,
    s.sourceDesignId ? "design" : null,
    sessionHasNeedsYou(s) ? "Needs you" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function sessionRowTitle(session: AgentSession): string {
  const branch = sessionGitBranch(session);
  const name = sessionDisplayName(session);
  return branch ? `${name} · ${branch}` : name;
}

function sessionRowClass(
  session: AgentSession,
  selected: boolean,
  unread: boolean,
  extra = "",
): string {
  return [
    "session-item",
    extra,
    selected ? "active" : "",
    session.archived ? "archived" : "",
    unread ? "unread" : "",
    sessionHasNeedsYou(session) ? "needs-you" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function SessionTitle(props: { session: AgentSession; unread: boolean }) {
  return (
    <div className="title">
      {props.session.pinned ? (
        <span className="pin" aria-label="Pinned">
          ★
        </span>
      ) : null}
      <span className="title-text">{sessionDisplayName(props.session)}</span>
      {props.unread ? <span className="unread-dot" aria-label="Unread" /> : null}
    </div>
  );
}

function SessionGroupBlocks(props: {
  sessions: AgentSession[];
  selectedId: string | null;
  unreadIds: string[];
  repos: LinkedRepo[];
  metaFor: (session: AgentSession) => string;
  previewFor?: (session: AgentSession) => ReactNode;
  onSelect: (id: string) => void;
  trust?: boolean;
  hub?: boolean;
  rosterPrefs?: SwarmRosterPrefs;
  onRosterPrefs?: (next: SwarmRosterPrefs) => void;
}) {
  return (
    <>
      {groupSessionsByDay(props.sessions).map((group) => (
        <div key={group.id} className="session-group">
          {props.hub ? null : <p className="session-group-label">{group.label}</p>}
          {clusterSessionsByRepo(group.items, sessionRepoKey, (session) =>
            sessionRepoLabel(session, props.repos),
          ).map((cluster) => (
            <div key={cluster.key} className={cluster.label ? "session-repo-group" : undefined}>
              {cluster.label && !props.hub ? (
                <p className="session-repo-label">{cluster.label}</p>
              ) : null}
              {cluster.items.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  selected={props.selectedId === s.id}
                  unread={props.unreadIds.includes(s.id)}
                  meta={props.metaFor(s)}
                  preview={props.previewFor?.(s)}
                  trust={props.trust}
                  hub={props.hub}
                  rosterPrefs={props.rosterPrefs}
                  onRosterPrefs={props.onRosterPrefs}
                  onSelect={props.onSelect}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function SessionRow(props: {
  session: AgentSession;
  selected: boolean;
  unread: boolean;
  meta: string;
  preview?: ReactNode;
  onSelect: (id: string) => void;
  trust?: boolean;
  hub?: boolean;
  rosterPrefs?: SwarmRosterPrefs;
  onRosterPrefs?: (next: SwarmRosterPrefs) => void;
}) {
  const s = props.session;
  const { dispatch } = useStore();
  const branch = sessionGitBranch(s);
  const rowTitle = sessionRowTitle(s);
  const stamp = props.hub ? formatSwarmListWhen(sessionListStamp(s)) : "";
  const rosterPrefs = props.rosterPrefs;
  const hidden = Boolean(rosterPrefs?.hiddenSessionIds.includes(s.id));
  const currentSectionId = rosterPrefs ? sectionIdForSession(rosterPrefs, s.id) : null;

  function patch(next: { pinned?: boolean; archived?: boolean; title?: string }) {
    void api.patchSession(s.id, next).catch((err: unknown) => {
      showNotice(err instanceof Error ? err.message : "Could not update this agent");
    });
  }

  function rename() {
    const next = window.prompt("Rename", s.title)?.trim();
    if (!next || next === s.title) return;
    patch({ title: next });
  }

  function remove() {
    if (!window.confirm(`Delete ${s.title}? This cannot be undone.`)) return;
    void api
      .deleteSession(s.id)
      .then(() => dispatch({ type: "deleted", id: s.id }))
      .catch((err: unknown) => {
        showNotice(err instanceof Error ? err.message : "Could not delete this agent");
      });
  }

  function duplicateSession() {
    void api
      .fork(s.id)
      .then((forked) => {
        dispatch({ type: "session", session: forked });
        dispatch({ type: "select", id: forked.id });
      })
      .catch((err: unknown) => {
        showNotice(err instanceof Error ? err.message : "Could not duplicate");
      });
  }

  function updateRoster(next: SwarmRosterPrefs) {
    props.onRosterPrefs?.(next);
  }

  function hideTeammate() {
    if (!rosterPrefs) return;
    updateRoster(hideSwarmSession(rosterPrefs, s.id));
  }

  function restoreTeammate() {
    if (!rosterPrefs) return;
    updateRoster(showSwarmSession(rosterPrefs, s.id));
  }

  function newSection() {
    if (!rosterPrefs) return;
    const name = window.prompt("Section name")?.trim();
    if (!name) return;
    updateRoster(addSwarmRosterSection(rosterPrefs, name, s.id));
  }

  function moveToSection(sectionId: string | null) {
    if (!rosterPrefs) return;
    updateRoster(moveSwarmSessionToSection(rosterPrefs, s.id, sectionId));
  }

  const menu = (
    <OverflowMenu title={`More for ${s.title}`} toggleClassName="btn icon ghost small">
      <MenuItem onClick={() => patch({ pinned: !s.pinned })}>{s.pinned ? "Unpin" : "Pin"}</MenuItem>
      <MenuItem onClick={duplicateSession}>
        {props.hub ? "Duplicate teammate" : "Duplicate"}
      </MenuItem>
      {props.hub && rosterPrefs ? (
        hidden ? (
          <MenuItem onClick={restoreTeammate}>Show</MenuItem>
        ) : (
          <MenuItem onClick={hideTeammate}>Hide</MenuItem>
        )
      ) : null}
      {props.hub && rosterPrefs ? (
        <>
          <MenuSep />
          <MenuLabel>Section</MenuLabel>
          {rosterPrefs.sections.map((section) => (
            <MenuItem
              key={section.id}
              disabled={section.id === currentSectionId}
              onClick={() => moveToSection(section.id)}
            >
              Move to {section.name}
            </MenuItem>
          ))}
          <MenuItem onClick={newSection}>New section…</MenuItem>
          {currentSectionId ? (
            <MenuItem onClick={() => moveToSection(null)}>Remove from section</MenuItem>
          ) : null}
        </>
      ) : null}
      <MenuItem onClick={rename}>Rename</MenuItem>
      <MenuItem onClick={() => patch({ archived: !s.archived })}>
        {s.archived ? "Unarchive" : "Archive"}
      </MenuItem>
      <MenuSep />
      <MenuItem danger onClick={remove}>
        Delete
      </MenuItem>
    </OverflowMenu>
  );
  const copy = (
    <>
      <div className="session-row-main">
        <SessionTitle session={s} unread={props.unread} />
        {stamp ? <span className="session-stamp">{stamp}</span> : null}
      </div>
      <div className="meta">
        {props.hub ? null : branch ? (
          <span className="session-branch" title={branch}>
            {branch}
          </span>
        ) : null}
        {!props.hub && branch && props.meta ? <span className="session-meta-sep">·</span> : null}
        {props.meta ? <span className="session-meta-rest">{props.meta}</span> : null}
      </div>
    </>
  );
  if (props.preview) {
    return (
      <div
        className={sessionRowClass(s, props.selected, props.unread, "design-item has-menu")}
        title={rowTitle}
      >
        <div className="design-thumb-hit" onClick={() => props.onSelect(s.id)}>
          {props.preview}
          <span className={`dot ${s.status}`} />
        </div>
        <button
          type="button"
          className="design-item-open"
          title={rowTitle}
          onClick={() => props.onSelect(s.id)}
        >
          {copy}
        </button>
        {menu}
      </div>
    );
  }
  const trust = props.trust ? <TrustActions compact session={s} /> : null;
  if (trust) {
    return (
      <div
        className={sessionRowClass(s, props.selected, props.unread, "needs-you-item has-menu")}
        title={rowTitle}
      >
        <button
          type="button"
          className="session-item-open"
          title={rowTitle}
          onClick={() => props.onSelect(s.id)}
        >
          <span className={`dot ${s.status}`} />
          <span>{copy}</span>
        </button>
        {trust}
        {menu}
      </div>
    );
  }
  return (
    <div
      className={sessionRowClass(
        s,
        props.selected,
        props.unread,
        props.hub ? "has-menu hub-session-item" : "has-menu",
      )}
      title={rowTitle}
    >
      <button
        type="button"
        className="session-item-open"
        title={rowTitle}
        onClick={() => props.onSelect(s.id)}
      >
        {props.hub ? (
          <PersonaAvatar
            avatarId={sessionAvatarId(s)}
            pose={sessionAvatarPose(s)}
            accessory={sessionAvatarAccessory(s)}
            accent={s.persona?.avatarAccent}
            size={36}
            title={sessionDisplayName(s)}
          />
        ) : null}
        <span className={`dot ${s.status}`} />
        <span className={props.hub ? "session-item-copy" : undefined}>{copy}</span>
      </button>
      {menu}
    </div>
  );
}

function automationCardMeta(
  item: Automation,
  runs: AutomationRun[],
): { last: string | undefined; next: string } {
  const latest = automationLatestRun(runs, item.id);
  const fact = automationLastFact(item);
  const lastAt = latest?.startedAt ?? item.lastRunAt;
  const last = [lastAt ? `Last ${formatWhen(lastAt)}` : null, fact ? clipFact(fact, 48) : null]
    .filter(Boolean)
    .join(" · ");
  const next = formatNextFire(item);
  const nextLine = !item.enabled
    ? "Paused"
    : next === "On webhook"
      ? "On webhook"
      : next
        ? `Next ${formatWhen(next)}`
        : formatSchedule(item.schedule);
  return { last: last || undefined, next: nextLine };
}

function AutomationListItem(props: {
  item: Automation;
  runs: AutomationRun[];
  selected: boolean;
  unread: boolean;
  onSelect: (id: string) => void;
  onPauseToggle: (item: Automation) => void;
  onDuplicate: (item: Automation) => void;
  onSettings: (item: Automation) => void;
  onDelete: (item: Automation) => void;
}) {
  const latest = automationLatestRun(props.runs, props.item.id);
  const card = automationCardMeta(props.item, props.runs);
  const live = latest?.status === "running" || latest?.status === "queued";
  const dot = live
    ? "running"
    : latest?.status === "failed"
      ? "error"
      : props.item.enabled
        ? "idle"
        : "stopped";
  const menu = (
    <OverflowMenu title={`More for ${props.item.name}`} toggleClassName="btn icon ghost small">
      <MenuItem onClick={() => props.onPauseToggle(props.item)}>
        {props.item.enabled ? "Pause" : "Enable"}
      </MenuItem>
      <MenuItem onClick={() => props.onDuplicate(props.item)}>Duplicate</MenuItem>
      <MenuItem onClick={() => props.onSettings(props.item)}>Settings</MenuItem>
      <MenuSep />
      <MenuItem danger onClick={() => props.onDelete(props.item)}>
        Delete
      </MenuItem>
    </OverflowMenu>
  );
  return (
    <div
      className={`session-item has-menu ${props.selected ? "active" : ""} ${props.unread ? "unread" : ""}`}
      title={props.item.name}
    >
      <button
        type="button"
        className="session-item-open"
        title={props.item.name}
        onClick={() => props.onSelect(props.item.id)}
      >
        <span className={`dot ${dot}`} />
        <span>
          <div className="title">
            <span className="title-text">{props.item.name}</span>
            {latest ? (
              <span className={`status-chip ${latest.status}`}>{latest.status}</span>
            ) : null}
            {props.unread ? <span className="unread-dot" aria-label="Unread" /> : null}
          </div>
          {card.last ? <div className="meta">{card.last}</div> : null}
          <div className="meta">{card.next}</div>
        </span>
      </button>
      {menu}
    </div>
  );
}

async function patchListedAutomations(
  items: Automation[],
  enabled: boolean,
  dispatch: (action: { type: "automation"; automation: Automation }) => void,
): Promise<{ ok: number; failed: number; error?: string }> {
  const results = await Promise.allSettled(
    items.map((a) =>
      api.patchAutomation(a.id, { enabled }).then((automation) => {
        dispatch({ type: "automation", automation });
        return automation;
      }),
    ),
  );
  let ok = 0;
  let failed = 0;
  let error: string | undefined;
  for (const result of results) {
    if (result.status === "fulfilled") ok += 1;
    else {
      failed += 1;
      if (!error) {
        error = result.reason instanceof Error ? result.reason.message : "Could not update jobs";
      }
    }
  }
  return { ok, failed, error };
}

export function Sidebar() {
  const { state, dispatch } = useStore();
  const [showArchived, setShowArchived] = useState(() => loadSidebarPrefs().showArchived);
  const [showHiddenTeammates, setShowHiddenTeammates] = useState(
    () => loadSidebarPrefs().showHiddenTeammates,
  );
  const [rosterPrefs, setRosterPrefs] = useState(loadSwarmRosterPrefs);
  const [stopping, setStopping] = useState(false);
  const [runningOnly, setRunningOnly] = useState(() => loadSidebarPrefs().runningOnly);
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
    });
  }, [showArchived, runningOnly, showHiddenTeammates, state.queries]);
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
  const sessions = state.sessions.filter((s) => {
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
  const ideSessions = state.sessions.filter((s) => {
    if (!sessionFitsSection(s, "ide")) return false;
    if (!sessionMatchesSurface(s, productMode)) return false;
    if (s.archived && !showArchived) return false;
    return sessionMatchesQuery(s, q);
  });
  const designs = state.sessions.filter((s) => {
    if (!isDesignSession(s)) return false;
    if (!sessionMatchesSurface(s, productMode)) return false;
    if (s.archived && !showArchived) return false;
    return sessionMatchesQuery(s, q);
  });
  const games = state.sessions.filter((s) => {
    if (!isGameSession(s)) return false;
    if (!sessionMatchesSurface(s, productMode)) return false;
    if (s.archived && !showArchived) return false;
    return sessionMatchesQuery(s, q);
  });
  const assets = state.sessions.filter((s) => {
    if (!isAssetSession(s)) return false;
    if (!sessionMatchesSurface(s, productMode)) return false;
    if (s.archived && !showArchived) return false;
    return sessionMatchesQuery(s, q);
  });
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
  const automationGroups =
    autoSort === "schedule" ? groupAutomationsBySchedule(listedAutomations) : null;
  const fleetExtras = formatAutomationFleetExtras(
    automationFleetExtras(state.automations, state.runs, state.sessions, state.config ?? undefined),
  );
  const showFleetActivity =
    state.section === "automations" && state.automations.length > 1 && state.runs.length > 0;
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
  const waitingCount = waiting.length + boardWaiting.length + brainWaiting;
  const sectionMeta = sectionMetaFor(productMode);
  const primarySections = primaryRailSections(productMode).map((id) => ({
    id,
    ...sectionMeta[id as Exclude<UiSection, "settings">],
  }));
  const secondarySections = moreRailSections(productMode).map((id) => ({
    id,
    ...sectionMeta[id as Exclude<UiSection, "settings">],
  }));
  const slackBooting = slackWorkspaceBooting({
    slackStatus: state.slackStatus,
    slackConversations: state.slackConversations,
    slackCatalogLoaded: state.slackCatalogLoaded,
    integrations: state.config?.integrations,
  });
  const picked = new Set(state.pickedContainerIds);
  const grouped = groupDockerContainers(containers);
  const liveListed = grouped.running;
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
      showNotice(err instanceof Error ? err.message : "Could not stop containers");
    } finally {
      setStopping(false);
    }
  }

  async function archiveSessions(targets: AgentSession[], prompt: string) {
    if (!targets.length) return;
    if (!window.confirm(prompt)) return;
    const errors: string[] = [];
    for (const session of targets) {
      try {
        await api.patchSession(session.id, { archived: true });
        dispatch({ type: "session", session: { ...session, archived: true } });
      } catch (err) {
        errors.push(
          `${session.title}: ${err instanceof Error ? err.message : "Could not archive"}`,
        );
      }
    }
    if (errors.length) showNotice(errors.join("\n"));
  }

  const sessionListMenu =
    state.section === "agents" ||
    state.section === "design" ||
    state.section === "games" ||
    state.section === "assets" ||
    state.section === "ide" ? (
      <OverflowMenu title="Session list" toggleClassName="btn icon ghost">
        <MenuItem
          disabled={!idleTargets.length}
          onClick={() => {
            const n = idleTargets.length;
            void archiveSessions(
              idleTargets,
              n === 1
                ? "Archive 1 idle chat older than 7 days?"
                : `Archive ${n} idle chats older than 7 days?`,
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
              n === 1
                ? "Archive 1 empty draft that never sent a prompt?"
                : `Archive ${n} empty drafts that never sent a prompt?`,
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
            {hideAutomationChats ? "Show automation chats" : "Hide automation chats"}
          </MenuItem>
        ) : null}
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

  useEffect(() => {
    const prefs = loadAutomationSidebarPrefs();
    if (prefs.fleetOpen !== undefined) return;
    if (fleetShouldAutoOpen(state.runs)) setFleetOpen(true);
  }, [state.runs]);

  function returnToSwarmTeammates() {
    if (!confirmLeaveSettings()) return;
    const selected = state.sessions.find((s) => s.id === state.selectedId);
    dispatch({ type: "section", section: "agents" });
    // Section navigation can fall back to the first session. If that session
    // is not a Swarm teammate, keep the return action on the creation surface
    // instead of showing a Developer chat in the Swarm shell.
    if (!selected || !sessionMatchesSurface(selected, "swarm")) {
      dispatch({ type: "select", id: null });
    }
  }

  return (
    <aside className={`sidebar${swarmMode ? " swarm-sidebar" : ""}`}>
      {swarmMode ? null : (
        <div className="side-rail">
          <div className="brand-mark rail-brand" aria-hidden="true" />
          <nav className="side-rail-nav" aria-label="Sections">
            {primarySections.map((row) => {
              const sectionWaiting = waiting.filter((session) =>
                sessionFitsSection(session, row.id),
              );
              const needCount = sectionWaiting.length;
              const autoUnread = row.id === "automations" && state.unreadAutomationIds.length > 0;
              const unread =
                ((row.id === "ide" || row.id === "agents") && needCount > 0) || autoUnread;
              const label =
                (row.id === "agents" || row.id === "ide") && needCount
                  ? `${row.label}, needs you ${needCount}`
                  : autoUnread
                    ? `${row.label}, unread`
                    : row.label;
              return (
                <button
                  key={row.id}
                  className={state.section === row.id ? "active" : ""}
                  aria-label={label}
                  aria-current={state.section === row.id ? "page" : undefined}
                  onClick={() => {
                    if (state.section === "settings" && !confirmLeaveSettings()) return;
                    dispatch({ type: "section", section: row.id });
                  }}
                >
                  <span className="rail-icon" aria-hidden="true">
                    {row.icon}
                  </span>
                  {unread ? <span className="unread-dot" aria-hidden="true" /> : null}
                  <span className="rail-label">{row.label}</span>
                </button>
              );
            })}
            {secondarySections.length ? <div className="rail-sep" role="separator" /> : null}
            {secondarySections.map((row) => {
              const unread =
                (row.id === "slack" && slackUnread) ||
                (row.id === "board" && boardWaiting.length > 0);
              const label = unread ? `${row.label}, unread` : row.label;
              return (
                <button
                  key={row.id}
                  className={state.section === row.id ? "active" : ""}
                  aria-label={label}
                  aria-current={state.section === row.id ? "page" : undefined}
                  onClick={() => {
                    if (state.section === "settings" && !confirmLeaveSettings()) return;
                    dispatch({ type: "section", section: row.id });
                  }}
                >
                  <span className="rail-icon" aria-hidden="true">
                    {row.icon}
                  </span>
                  {unread ? <span className="unread-dot" aria-hidden="true" /> : null}
                  <span className="rail-label">{row.label}</span>
                </button>
              );
            })}
          </nav>
          <span className="rail-spacer" />
          <div className="side-rail-chrome">
            {waitingCount ? (
              <button
                className="btn icon ghost"
                aria-label={`Needs you, ${waitingCount} waiting`}
                onClick={() => {
                  if (state.section === "settings" && !confirmLeaveSettings()) return;
                  if (waiting[0]) dispatch({ type: "select", id: waiting[0].id });
                  else if (boardWaiting[0]) {
                    dispatch({
                      type: "selectBoard",
                      id: boardWaiting[0].boardId,
                      objectId: boardWaiting[0].objectId,
                    });
                  } else if (brainWaiting) {
                    dispatch({ type: "section", section: "brain" });
                  }
                }}
              >
                <span className="icon-badge-wrap">
                  <IconInbox />
                  <span className="icon-badge danger">{waitingCount}</span>
                </span>
                <span className="rail-tip" aria-hidden="true">
                  Needs you
                </span>
              </button>
            ) : null}
            <span
              className={`conn rail-conn ${state.connected ? "live" : ""}`}
              title={`${connTitle}. ${connDetail}`}
              role="status"
              aria-label={connDetail}
              aria-hidden={state.collapsed ? undefined : true}
            >
              <span className="conn-dot" />
            </span>
            {state.setup && !state.setup.ready && (
              <button
                className="btn ghost setup-btn"
                aria-label="Setup"
                onClick={() => dispatch({ type: "setupOpen", open: true })}
              >
                <span className="rail-icon" aria-hidden="true">
                  <IconWrench />
                </span>
                <span className="rail-tip" aria-hidden="true">
                  Setup
                </span>
              </button>
            )}
            <button
              className={`btn icon ghost${state.section === "settings" ? " active" : ""}`}
              aria-label="Settings"
              aria-current={state.section === "settings" ? "page" : undefined}
              onClick={() => dispatch({ type: "settings", open: true })}
            >
              <IconGear />
              <span className="rail-tip" aria-hidden="true">
                Settings
              </span>
            </button>
            <button
              className="btn icon ghost"
              aria-label={state.collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => dispatch({ type: "toggleSidebar" })}
            >
              <IconPanel />
              <span className="rail-tip" aria-hidden="true">
                {state.collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </span>
            </button>
          </div>
        </div>
      )}
      <div
        className="side-main"
        inert={swarmMode ? undefined : state.collapsed || undefined}
        aria-hidden={swarmMode ? undefined : state.collapsed || undefined}
      >
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          <div className="brand-copy">
            <h1>Locus</h1>
            <p>
              {state.section === "docker"
                ? `docker · ${state.dockerKind === "docker" ? "local" : "mock"}`
                : state.section === "slack"
                  ? state.slackStatus?.teamName
                    ? `slack · ${state.slackStatus.teamName}`
                    : "Slack"
                  : state.section === "grafana"
                    ? "Grafana"
                    : sectionLabel(state.section, productMode)}
            </p>
          </div>
          <div className="brand-actions">
            <ProductModeToggle />
          </div>
        </div>
        {swarmMode && state.section !== "settings" ? (
          <nav className="swarm-shell-nav" aria-label="Swarm">
            <button
              type="button"
              className={state.section === "agents" ? "active" : ""}
              aria-current={state.section === "agents" ? "page" : undefined}
              data-testid="swarm-teammates"
              onClick={() => {
                if (!confirmLeaveSettings()) return;
                dispatch({ type: "section", section: "agents" });
              }}
            >
              Teammates
            </button>
            <button
              type="button"
              className={state.section === "project" ? "active" : ""}
              aria-current={state.section === "project" ? "page" : undefined}
              data-testid="swarm-teams"
              onClick={() => {
                if (!confirmLeaveSettings()) return;
                const selected = state.projects.find((row) => row.id === state.selectedProjectId);
                if (!selected || selected.surface !== "swarm") {
                  dispatch({ type: "selectProject", id: null });
                  return;
                }
                dispatch({ type: "section", section: "project" });
              }}
            >
              Teams
            </button>
          </nav>
        ) : null}
        {state.section !== "settings" ? (
          <div className="side-actions">
            {state.section === "automations" ? (
              <button
                className="btn primary"
                title={swarmMode ? "New routine" : "New automation"}
                aria-label={swarmMode ? "New routine" : "New automation"}
                onClick={() => dispatch({ type: "newAutomation", open: true })}
              >
                <IconClock /> <span>{swarmMode ? "New routine" : "New automation"}</span>
              </button>
            ) : state.section === "board" ? (
              <div className="side-actions-row">
                <button
                  className="btn primary"
                  title="New board"
                  aria-label="New board"
                  onClick={() => dispatch({ type: "selectBoard", id: null })}
                >
                  <IconPlus /> <span>New board</span>
                </button>
              </div>
            ) : state.section === "project" ? (
              <div className="side-actions-row">
                <button
                  className="btn primary"
                  title={swarmMode ? "New team" : "New project"}
                  aria-label={swarmMode ? "New team" : "New project"}
                  onClick={() => dispatch({ type: "selectProject", id: null })}
                >
                  <IconPlus /> <span>{swarmMode ? "New team" : "New project"}</span>
                </button>
              </div>
            ) : state.section === "design" ? (
              <div className="side-actions-row">
                <button
                  className="btn primary"
                  title="New design"
                  aria-label="New design"
                  onClick={() => dispatch({ type: "select", id: null })}
                >
                  <IconPlus /> <span>New design</span>
                </button>
                {sessionListMenu}
              </div>
            ) : state.section === "games" ? (
              <div className="side-actions-row">
                <button
                  className="btn primary"
                  title="New game"
                  aria-label="New game"
                  onClick={() => dispatch({ type: "select", id: null })}
                >
                  <IconPlus /> <span>New game</span>
                </button>
                {sessionListMenu}
              </div>
            ) : state.section === "assets" ? (
              <div className="side-actions-row">
                <button
                  className="btn primary"
                  title="New asset"
                  aria-label="New asset"
                  onClick={() => dispatch({ type: "select", id: null })}
                >
                  <IconPlus /> <span>New asset</span>
                </button>
                {sessionListMenu}
              </div>
            ) : state.section === "ide" ? (
              <div className="side-actions-row">
                <button
                  className="btn primary"
                  title="New workspace"
                  aria-label="New workspace"
                  onClick={() => dispatch({ type: "select", id: null })}
                >
                  <IconPlus /> <span>New workspace</span>
                </button>
                {sessionListMenu}
              </div>
            ) : state.section === "codebase" ? (
              <button
                className="btn primary"
                title="Link repo"
                aria-label="Link repo"
                onClick={() => dispatch({ type: "selectRepo", id: null })}
              >
                <IconPlus /> <span>Link repo</span>
              </button>
            ) : state.section === "slack" ? (
              <button
                className="btn"
                title="Refresh channels"
                aria-label="Refresh channels"
                onClick={() => {
                  void api.slackConversations(true).then(
                    (conversations) => dispatch({ type: "slackConversations", conversations }),
                    (err: unknown) => {
                      showNotice(err instanceof Error ? err.message : "Could not refresh Slack");
                    },
                  );
                }}
              >
                <IconRefresh /> <span>Refresh</span>
              </button>
            ) : state.section === "docker" ? (
              <>
                <button
                  className="btn"
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
                        showNotice(err instanceof Error ? err.message : "Could not refresh Docker");
                      },
                    );
                  }}
                >
                  <IconRefresh /> <span>Refresh</span>
                </button>
                {state.dockerView === "containers" ? (
                  <button
                    className="btn"
                    title="Stop selected"
                    aria-label="Stop selected containers"
                    disabled={
                      stopping || liveListed.filter((row) => picked.has(row.id)).length === 0
                    }
                    onClick={() =>
                      void stopSelectedContainers(liveListed.filter((row) => picked.has(row.id)))
                    }
                  >
                    <IconStop /> <span>Stop selected</span>
                  </button>
                ) : null}
              </>
            ) : state.section === "brain" ? null : (
              <div className="side-actions-row">
                <button
                  className="btn primary"
                  title={swarmMode ? "New teammate" : "New agent"}
                  aria-label={swarmMode ? "New teammate" : "New agent"}
                  onClick={() => dispatch({ type: "select", id: null })}
                >
                  <IconPlus /> <span>{swarmMode ? "New teammate" : "New agent"}</span>
                </button>
                {swarmMode ? null : sessionListMenu}
              </div>
            )}
          </div>
        ) : null}
        {state.section !== "settings" ? (
          <SearchField
            className="search"
            placeholder={sectionSearchPlaceholder(state.section, productMode)}
            value={query}
            onChange={(e: FormEvent<HTMLInputElement>) =>
              dispatch({ type: "query", query: (e.target as HTMLInputElement).value })
            }
            shortcut={undefined}
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
                Swarm
              </button>
            </div>
            {state.dockerView === "containers" ? (
              <label className="side-toggle">
                <input
                  type="checkbox"
                  checked={runningOnly}
                  onChange={(e) => setRunningOnly(e.target.checked)}
                />
                Running only
              </label>
            ) : null}
          </>
        ) : null}
        {state.section === "automations" && state.automations.length ? (
          <>
            <div className="auto-side-filters">
              <div className="auto-side-filter-row" role="group" aria-label="Job filter">
                {(
                  [
                    ["all", "All"],
                    ["failing", "Failing"],
                    ["needs-you", "Needs you"],
                    ["running", "Running"],
                    ["paused", "Paused"],
                    ["over-cap", "Over cap"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`btn small${autoFilter === value ? " primary" : " ghost"}`}
                    aria-pressed={autoFilter === value}
                    onClick={() => {
                      setAutoFilter(value);
                      saveAutomationSidebarPrefs({ filter: value, sort: autoSort });
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="auto-side-filter-row" role="group" aria-label="Automation sort">
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
            </div>
            {listedAutomations.length ? (
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
                    ? `Enable ${bulkConfirm.count} automations?`
                    : `Pause ${bulkConfirm.count} automations?`
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
                title={`Delete ${state.automations.find((a) => a.id === deleteAutomationId)?.name ?? "automation"}?`}
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
            <div className="auto-health-actions" role="group" aria-label="Filter by health">
              <button
                type="button"
                className="btn small ghost"
                onClick={() => {
                  setAutoFilter("failing");
                  saveAutomationSidebarPrefs({ filter: "failing", sort: autoSort });
                }}
              >
                Failing
              </button>
              <button
                type="button"
                className="btn small ghost"
                onClick={() => {
                  setAutoFilter("paused");
                  saveAutomationSidebarPrefs({ filter: "paused", sort: autoSort });
                }}
              >
                Paused
              </button>
              {fleetExtras?.includes("over cap") ? (
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => {
                    setAutoFilter("over-cap");
                    saveAutomationSidebarPrefs({ filter: "over-cap", sort: autoSort });
                  }}
                >
                  Over cap
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div
          className={`side-list-pane${showFleetActivity ? " auto-side-split" : ""}${
            showFleetActivity && fleetOpen ? " is-open" : ""
          }`}
        >
          <div className="session-list" aria-label={sectionLabel(state.section, productMode)}>
            {state.section === "settings" ? (
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
                      No matching automations
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
                    "No automations"
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
                          if (!window.confirm(`Delete ${row.title}? This cannot be undone.`))
                            return;
                          void api
                            .deleteBoard(row.id)
                            .then(() => dispatch({ type: "boardDeleted", id: row.id }));
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
                            if (
                              !window.confirm(
                                swarmMode
                                  ? `Delete ${displayName}? Teammates stay in Swarm.`
                                  : `Delete ${displayName}? Members stay on Agents.`,
                              )
                            )
                              return;
                            void api
                              .deleteProject(row.id)
                              .then(() => dispatch({ type: "projectDeleted", id: row.id }));
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
                />
              )
            ) : state.section === "codebase" ? (
              <>
                {repos.length === 0 ? (
                  <EmptyListNote>
                    {q
                      ? "No matching repos"
                      : "No linked repos. Linked repos appear here, grouped by host."}
                  </EmptyListNote>
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
                                  if (
                                    !window.confirm(
                                      `Unlink ${row.name}? Agents keep their checkout.`,
                                    )
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
              <EmptyListNote>
                {q
                  ? "No matching claims"
                  : "Shared graph of services, APIs, and distilled memory. Build from a repo folder in the pane."}
              </EmptyListNote>
            ) : state.section === "grafana" ? (
              <EmptyListNote>
                {q
                  ? "No matching queries"
                  : "Lucene logs, stack traces into linked repos, and Investigate."}
              </EmptyListNote>
            ) : state.section === "slack" ? (
              slackBooting ? (
                <SlackChannelListSkeleton />
              ) : slackConversations.length === 0 && !state.slackStatus?.connected ? (
                <EmptyListNote>
                  {q ? "No matching channels" : "Sign in with Slack in Settings → Integrations"}
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
                {sessions.filter(sessionHasNeedsYou).length ||
                boardWaiting.length ||
                brainWaiting ? (
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
                    const rest = sessions.filter((s) => !sessionHasNeedsYou(s));
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
                        />
                      </>
                    );
                  })()
                ) : (
                  <SessionGroupBlocks
                    sessions={sessions.filter((s) => !sessionHasNeedsYou(s))}
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
          {state.section === "docker" ? null : (
            <span className={`conn ${state.connected ? "live" : ""}`} title={connTitle}>
              <span className="conn-dot" />
              <span className="conn-label">{connDetail}</span>
            </span>
          )}
          {state.section === "codebase" ? (
            <span className="hint">
              {repos.length} {repos.length === 1 ? "repo" : "repos"}
            </span>
          ) : state.section === "brain" ? (
            <span className="hint">
              {state.brain
                ? `${state.brain.nodeCount} nodes · ${state.brain.memoryCount} memories`
                : "Empty brain"}
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
          ) : (state.section === "agents" && archivedCount > 0) ||
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
    </aside>
  );
}
