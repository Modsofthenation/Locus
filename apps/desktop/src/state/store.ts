import { createContext, useContext, type Dispatch } from "react";
import type {
  AgentRuntime,
  AgentSession,
  ChatMessage,
  Automation,
  AutomationRun,
  BoardDocument,
  BoardSummary,
  BrainDocument,
  BrainSummary,
  ProjectDocument,
  ProjectSummary,
  DesignSystem,
  AssetStyle,
  GameStyle,
  DockerContainer,
  DockerSwarmSnapshot,
  GuestOs,
  LinkedRepo,
  LocusConfig,
  IssueDetail,
  PullRequestDetail,
  SessionKind,
  SetupStatus,
  SlackConversation,
  SlackMessage,
  SlackStatus,
  SlackActivityItem,
  ToolOverlay,
  VmInstance,
  CloneProgress,
  ImageBuildProgress,
  ProductMode,
  QemuInstallProgress,
} from "@locus/shared";
import {
  appendThinkingText,
  boardSummary,
  brainSummary,
  projectSummary,
  compareSessionsForList,
  isBoardSession,
  isCanvasSession,
  isProjectSession,
  isDesignSession,
  isGameSession,
  isAssetSession,
  isIdeSession,
  mergeSlackMessageRows,
} from "@locus/shared";
import type { SettingsTab } from "@/lib/settingsNav";
import { lastVisibleMessageId, startChatVisit, type ChatNewVisit } from "@/lib/chatNewMarker";
import { mergeSession } from "./sessionMerge";

export { mergeSession } from "./sessionMerge";

export type { SettingsTab };

export type UiSection =
  | "agents"
  | "design"
  | "games"
  | "assets"
  | "board"
  | "project"
  | "ide"
  | "codebase"
  | "brain"
  | "slack"
  | "grafana"
  | "docker"
  | "automations"
  | "settings";

export type ProductModeTransition = {
  from: ProductMode;
  to: ProductMode;
};

export const UI_SECTIONS: UiSection[] = [
  "agents",
  "design",
  "games",
  "assets",
  "board",
  "project",
  "ide",
  "codebase",
  "brain",
  "slack",
  "grafana",
  "docker",
  "automations",
  "settings",
];

export function isSessionlessSection(section: UiSection): boolean {
  return (
    section === "automations" ||
    section === "board" ||
    section === "project" ||
    section === "codebase" ||
    section === "brain" ||
    section === "docker" ||
    section === "slack" ||
    section === "grafana" ||
    section === "settings"
  );
}

export function sectionEnter(from: UiSection, to: UiSection): "forward" | "back" | null {
  if (from === to) return null;
  return UI_SECTIONS.indexOf(to) >= UI_SECTIONS.indexOf(from) ? "forward" : "back";
}

export function sectionQuery(state: Pick<UiState, "section" | "queries">): string {
  return state.queries[state.section] ?? "";
}

export interface UiState {
  config: LocusConfig | null;
  sessions: AgentSession[];
  vms: VmInstance[];
  containers: DockerContainer[];
  automations: Automation[];
  boards: BoardSummary[];
  boardDocuments: Record<string, BoardDocument>;
  projects: ProjectSummary[];
  projectDocuments: Record<string, ProjectDocument>;
  runs: AutomationRun[];
  repos: LinkedRepo[];
  designSystems: DesignSystem[];
  assetStyles: AssetStyle[];
  gameStyles: GameStyle[];
  selectedId: string | null;
  selectedAutomationId: string | null;
  selectedBoardId: string | null;
  selectedProjectId: string | null;
  boardFocusObjectId: string | null;
  selectedRepoId: string | null;
  selectedContainerId: string | null;
  pickedContainerIds: string[];
  dockerView: "containers" | "swarm";
  dockerSwarm: DockerSwarmSnapshot | null;
  selectedSwarmServiceId: string | null;
  selectedSwarmNodeId: string | null;
  selectedPullNumber: number | null;
  activePull: PullRequestDetail | null;
  selectedIssueNumber: number | null;
  activeIssue: IssueDetail | null;
  slackStatus: SlackStatus | null;
  slackConversations: SlackConversation[];
  slackActivity: SlackActivityItem[];
  slackActivityOpen: boolean;
  slackActivityUnseen: boolean;
  /** True after the Slack pane has finished its first status + catalog probe. */
  slackCatalogLoaded: boolean;
  selectedSlackChannelId: string | null;
  slackMessages: SlackMessage[];
  slackThreadTs: string | null;
  brain: BrainSummary | null;
  section: UiSection;
  /** Rail Inbox is showing in the list and main pane instead of the section. */
  inboxOpen: boolean;
  /** One-shot: IDE start screen should open this choice when it mounts. */
  ideStart: "open" | "clone" | null;
  queries: Partial<Record<UiSection, string>>;
  collapsed: boolean;
  vmCollapsed: boolean;
  settingsTab: SettingsTab;
  settingsReturnSection: UiSection;
  sessionSettingsOpen: boolean;
  designSystemsOpen: boolean;
  assetStylesOpen: boolean;
  gameStylesOpen: boolean;
  newOpen: boolean;
  newOs: GuestOs | null;
  newRuntime: AgentRuntime | null;
  newDockerImage: string;
  newPrompt: string;
  newHostDir: string;
  newInstructions: string;
  newPlaybook: string;
  newAllowedTools: string[];
  newKind: SessionKind | null;
  newRepoId: string;
  newExtraRepoIds: string[];
  newRepoUrl: string;
  newRepoRef: string;
  newAutomationOpen: boolean;
  editingAutomationId: string | null;
  automationStarterId: string | null;
  /** After creating a webhook job, highlight the hook card until dismissed. */
  highlightAutomationWebhookId: string | null;
  error: string | null;
  connected: boolean;
  hypervisorKind: "mock" | "qemu";
  dockerKind: "mock" | "docker";
  /** The Docker CLI is installed and its daemon answered `docker info`. */
  dockerReady: boolean;
  setup: SetupStatus | null;
  setupOpen: boolean;
  unreadIds: string[];
  /** Last operator-visible message id per chat, snapshotted when you leave. */
  lastSeenMessageIds: Record<string, string>;
  /** Frozen New marker for the current chat visit. Survives ChatPane remounts. */
  chatNewVisit: ChatNewVisit | null;
  unreadAutomationIds: string[];
  overlay: ToolOverlay | null;
  timelineSeek: { sessionId: string; stopId: string } | null;
  replayOpen: boolean;
  compareOpen: boolean;
  composerDraft: string | null;
  findChatOpen: boolean;
  workspaceOpen: WorkspaceOpen | null;
  workspaceFocus: { sessionId: string; path: string } | null;
  canvasHtml: Record<string, string>;
  gameShots: Record<string, string>;
  thinking: Record<string, string>;
  cloneProgress: Record<string, CloneProgress>;
  imageProgress: Record<string, ImageBuildProgress>;
  qemuInstall: QemuInstallProgress | null;
  productModeTransition: ProductModeTransition | null;
}

export type WorkspaceOpen = {
  sessionId: string;
  path: string;
  line?: number;
  follow?: boolean;
  at: number;
};

export const initialState: UiState = {
  config: null,
  sessions: [],
  vms: [],
  containers: [],
  automations: [],
  boards: [],
  boardDocuments: {},
  projects: [],
  projectDocuments: {},
  runs: [],
  repos: [],
  designSystems: [],
  assetStyles: [],
  gameStyles: [],
  selectedId: null,
  selectedAutomationId: null,
  selectedBoardId: null,
  selectedProjectId: null,
  boardFocusObjectId: null,
  selectedRepoId: null,
  selectedContainerId: null,
  pickedContainerIds: [],
  dockerView: "containers",
  dockerSwarm: null,
  selectedSwarmServiceId: null,
  selectedSwarmNodeId: null,
  selectedPullNumber: null,
  activePull: null,
  selectedIssueNumber: null,
  activeIssue: null,
  slackStatus: null,
  slackConversations: [],
  slackActivity: [],
  slackActivityOpen: false,
  slackActivityUnseen: false,
  slackCatalogLoaded: false,
  selectedSlackChannelId: null,
  slackMessages: [],
  slackThreadTs: null,
  brain: null,
  section: "agents",
  inboxOpen: false,
  ideStart: null,
  queries: {},
  collapsed: false,
  vmCollapsed: true,
  settingsTab: "providers",
  settingsReturnSection: "agents",
  sessionSettingsOpen: false,
  designSystemsOpen: false,
  assetStylesOpen: false,
  gameStylesOpen: false,
  newOpen: false,
  newOs: null,
  newRuntime: null,
  newDockerImage: "",
  newPrompt: "",
  newHostDir: "",
  newInstructions: "",
  newPlaybook: "",
  newAllowedTools: [],
  newKind: null,
  newRepoId: "",
  newExtraRepoIds: [],
  newRepoUrl: "",
  newRepoRef: "",
  newAutomationOpen: false,
  editingAutomationId: null,
  automationStarterId: null,
  highlightAutomationWebhookId: null,
  error: null,
  connected: false,
  hypervisorKind: "mock",
  dockerKind: "mock",
  dockerReady: false,
  setup: null,
  setupOpen: false,
  unreadIds: [],
  lastSeenMessageIds: {},
  chatNewVisit: null,
  unreadAutomationIds: [],
  overlay: null,
  timelineSeek: null,
  replayOpen: false,
  compareOpen: false,
  composerDraft: null,
  findChatOpen: false,
  workspaceOpen: null,
  workspaceFocus: null,
  canvasHtml: {},
  gameShots: {},
  thinking: {},
  cloneProgress: {},
  imageProgress: {},
  qemuInstall: null,
  productModeTransition: null,
};

export type Action =
  | {
      type: "hydrate";
      config: LocusConfig;
      sessions: AgentSession[];
      vms: VmInstance[];
      hypervisorKind?: "mock" | "qemu";
      dockerKind?: "mock" | "docker";
      dockerReady?: boolean;
      automations?: Automation[];
      boards?: BoardSummary[];
      projects?: ProjectSummary[];
      runs?: AutomationRun[];
      repos?: LinkedRepo[];
      containers?: DockerContainer[];
      designSystems?: DesignSystem[];
      assetStyles?: AssetStyle[];
      gameStyles?: GameStyle[];
      setup?: SetupStatus;
    }
  | {
      type: "reset";
      config: LocusConfig;
      vms?: VmInstance[];
      hypervisorKind?: "mock" | "qemu";
      dockerKind?: "mock" | "docker";
      dockerReady?: boolean;
      setup?: SetupStatus;
    }
  | { type: "session"; session: AgentSession }
  | { type: "sessions"; sessions: AgentSession[] }
  | { type: "deleted"; id: string }
  | { type: "vm"; vm: VmInstance }
  | { type: "vms"; vms: VmInstance[] }
  | { type: "select"; id: string | null }
  /** Close a chat that is being removed; a no-op when another chat is open. */
  | { type: "deselect"; id: string }
  | { type: "selectAutomation"; id: string | null }
  | { type: "selectBoard"; id: string | null; objectId?: string }
  | { type: "selectProject"; id: string | null }
  | { type: "selectRepo"; id: string | null }
  | { type: "selectContainer"; id: string | null }
  | { type: "pickContainers"; ids: string[] }
  | { type: "dockerView"; view: "containers" | "swarm" }
  | { type: "dockerSwarm"; swarm: DockerSwarmSnapshot | null }
  | { type: "selectSwarmService"; id: string | null }
  | { type: "selectSwarmNode"; id: string | null }
  | { type: "selectPull"; number: number | null }
  | { type: "selectIssue"; number: number | null }
  | { type: "slackStatus"; status: SlackStatus }
  | { type: "slackConversations"; conversations: SlackConversation[] }
  | { type: "slackActivity"; items: SlackActivityItem[]; unseen?: boolean }
  | { type: "selectSlackActivity" }
  | { type: "slackCatalogLoaded" }
  | { type: "slackChannel"; conversation: SlackConversation }
  | { type: "selectSlackChannel"; id: string | null }
  | { type: "slackMessages"; messages: SlackMessage[] }
  | { type: "slackMessage"; message: SlackMessage }
  | { type: "slackThread"; ts: string | null }
  | { type: "section"; section: UiSection }
  | { type: "inbox"; open: boolean }
  | { type: "ideStart"; intent: "open" | "clone" | null }
  | { type: "query"; query: string }
  | { type: "toggleSidebar" }
  | { type: "sidebarCollapsed"; collapsed: boolean }
  | { type: "toggleVmPane" }
  | { type: "showVmPane" }
  | { type: "settings"; open: boolean }
  | { type: "settingsTab"; tab: SettingsTab }
  | { type: "sessionSettings"; open: boolean }
  | { type: "designSystems"; open: boolean }
  | { type: "designSystemList"; systems: DesignSystem[] }
  | { type: "assetStyles"; open: boolean }
  | { type: "gameStyles"; open: boolean }
  | { type: "gameStyleList"; styles: GameStyle[] }
  | { type: "assetStyleList"; styles: AssetStyle[] }
  | { type: "setup"; setup: SetupStatus }
  | { type: "setupOpen"; open: boolean }
  | {
      type: "new";
      open: boolean;
      os?: GuestOs;
      prompt?: string;
      runtime?: AgentRuntime;
      dockerImage?: string;
      hostDir?: string;
      instructions?: string;
      playbook?: string;
      allowedTools?: string[];
      kind?: SessionKind;
      repoId?: string;
      extraRepoIds?: string[];
      repoUrl?: string;
      repoRef?: string;
    }
  | { type: "newAutomation"; open: boolean; editId?: string | null; starterId?: string | null }
  | { type: "highlightAutomationWebhook"; id: string | null }
  | { type: "automation"; automation: Automation }
  | { type: "automations"; automations: Automation[] }
  | { type: "automationDeleted"; id: string }
  | { type: "board"; board: BoardDocument }
  | { type: "boards"; boards: BoardSummary[] }
  | { type: "boardDeleted"; id: string }
  | { type: "project"; project: ProjectDocument }
  | { type: "projects"; projects: ProjectSummary[] }
  | { type: "projectDeleted"; id: string }
  | { type: "brain"; brain: BrainSummary | BrainDocument }
  | { type: "run"; run: AutomationRun }
  | { type: "runs"; runs: AutomationRun[] }
  | { type: "repos"; repos: LinkedRepo[] }
  | { type: "repo"; repo: LinkedRepo }
  | { type: "repoDeleted"; id: string }
  | { type: "containers"; containers: DockerContainer[] }
  | { type: "container"; container: DockerContainer }
  | { type: "pull"; pull: PullRequestDetail | null }
  | { type: "issue"; issue: IssueDetail | null }
  | { type: "error"; error: string | null }
  | { type: "connected"; connected: boolean }
  | { type: "delta"; sessionId: string; messageId: string; delta: string }
  | { type: "message"; sessionId: string; message: ChatMessage }
  | { type: "thinking"; sessionId: string; snippet: string }
  | { type: "thinkingDelta"; sessionId: string; messageId: string; delta: string }
  | { type: "cloneProgress"; sessionId: string; progress: CloneProgress | null }
  | { type: "imageProgress"; sessionId: string; progress: ImageBuildProgress | null }
  | { type: "qemuInstall"; progress: QemuInstallProgress | null }
  | { type: "unread"; id: string }
  | { type: "unreadAutomation"; id: string }
  | { type: "overlay"; overlay: ToolOverlay | null }
  | { type: "seekTimeline"; seek: { sessionId: string; stopId: string } | null }
  | { type: "replay"; open: boolean }
  | { type: "compare"; open: boolean }
  | { type: "compose"; text: string | null }
  | { type: "findChat"; open: boolean }
  | { type: "openWorkspace"; open: WorkspaceOpen | null }
  | { type: "workspaceFocus"; sessionId: string; path: string | null }
  | { type: "canvas"; sessionId: string; html: string | null }
  | { type: "gameShot"; sessionId: string; image: string | null }
  | { type: "productModeTransition"; transition: ProductModeTransition | null }
  | { type: "config"; config: LocusConfig };

/** Open Settings, optionally landing on a named tab (Git, Integrations, …). */
export function openSettings(dispatch: Dispatch<Action>, tab?: SettingsTab): void {
  dispatch({ type: "settings", open: true });
  if (tab) dispatch({ type: "settingsTab", tab });
}

/** Navigating anywhere from the rail, list, switcher, or a deep link leaves the Inbox. */
const LEAVES_INBOX = new Set<Action["type"]>([
  "section",
  "select",
  "selectBoard",
  "selectProject",
  "selectAutomation",
  "selectRepo",
  "selectPull",
  "selectIssue",
  "selectContainer",
  "selectSwarmService",
  "selectSwarmNode",
  "selectSlackChannel",
  "selectSlackActivity",
  "settings",
]);

export function reducer(state: UiState, action: Action): UiState {
  const next = rememberChatOnLeave(state, action, reduceUiState(state, action));
  if (next.inboxOpen && LEAVES_INBOX.has(action.type)) return { ...next, inboxOpen: false };
  return next;
}

function sectionShowsChatThread(section: UiSection): boolean {
  return (
    section === "agents" ||
    section === "design" ||
    section === "games" ||
    section === "assets" ||
    section === "ide" ||
    section === "project" ||
    section === "board"
  );
}

function withLastSeen(
  lastSeen: Record<string, string>,
  sessions: AgentSession[],
  sessionId: string,
): Record<string, string> {
  const session = sessions.find((row) => row.id === sessionId);
  const messageId = lastVisibleMessageId(session?.messages ?? []);
  if (!messageId || lastSeen[sessionId] === messageId) return lastSeen;
  return { ...lastSeen, [sessionId]: messageId };
}

function rememberChatOnLeave(prev: UiState, action: Action, next: UiState): UiState {
  let lastSeen = next.lastSeenMessageIds ?? {};
  let visit = next.chatNewVisit ?? null;
  if (action.type === "deleted") {
    if (action.id in lastSeen) {
      const copy = { ...lastSeen };
      delete copy[action.id];
      lastSeen = copy;
    }
    if (visit?.sessionId === action.id) visit = null;
  }

  const leftId =
    prev.selectedId && prev.selectedId !== next.selectedId
      ? prev.selectedId
      : sectionShowsChatThread(prev.section) &&
          !sectionShowsChatThread(next.section) &&
          prev.selectedId
        ? prev.selectedId
        : null;
  if (leftId) lastSeen = withLastSeen(lastSeen, prev.sessions, leftId);

  const enteredId =
    next.selectedId && prev.selectedId !== next.selectedId
      ? next.selectedId
      : !sectionShowsChatThread(prev.section) &&
          sectionShowsChatThread(next.section) &&
          next.selectedId
        ? next.selectedId
        : null;
  if (enteredId) {
    const session = next.sessions.find((row) => row.id === enteredId);
    visit = startChatVisit(enteredId, session?.messages ?? [], lastSeen[enteredId]);
  } else if (leftId && !enteredId) {
    visit = null;
  }

  if (lastSeen === next.lastSeenMessageIds && visit === next.chatNewVisit) return next;
  return { ...next, lastSeenMessageIds: lastSeen, chatNewVisit: visit };
}

function reduceUiState(state: UiState, action: Action): UiState {
  switch (action.type) {
    case "hydrate": {
      const prevById = new Map(state.sessions.map((row) => [row.id, row]));
      const sessions = action.sessions
        .map((row) => {
          const prev = prevById.get(row.id);
          return prev ? mergeSession(prev, row) : row;
        })
        .sort(sortSessions);
      let selectedId =
        state.selectedId ?? firstSessionForSection(sessions, state.section)?.id ?? null;
      let section = state.section;
      if (!state.selectedId && !selectedId) {
        const ide = firstSessionForSection(sessions, "ide");
        if (ide) {
          selectedId = ide.id;
          section = "ide";
        }
      }
      return {
        ...state,
        config: action.config,
        sessions,
        vms: action.vms,
        containers: action.containers ?? state.containers,
        automations: action.automations ?? state.automations,
        boards: action.boards ?? state.boards,
        projects: action.projects ?? state.projects,
        runs: action.runs ?? state.runs,
        repos: action.repos ?? state.repos,
        designSystems: action.designSystems ?? state.designSystems,
        assetStyles: action.assetStyles ?? state.assetStyles,
        gameStyles: action.gameStyles ?? state.gameStyles,
        selectedId,
        section,
        selectedAutomationId: state.selectedAutomationId ?? action.automations?.[0]?.id ?? null,
        selectedBoardId: state.selectedBoardId ?? action.boards?.[0]?.id ?? null,
        selectedProjectId: state.selectedProjectId ?? action.projects?.[0]?.id ?? null,
        selectedRepoId: state.selectedRepoId ?? action.repos?.[0]?.id ?? null,
        selectedContainerId:
          state.selectedContainerId ?? action.containers?.[0]?.id ?? state.selectedContainerId,
        hypervisorKind: action.hypervisorKind ?? state.hypervisorKind,
        dockerKind: action.dockerKind ?? state.dockerKind,
        dockerReady:
          action.dockerReady ??
          (action.dockerKind ? action.dockerKind === "docker" : state.dockerReady),
        setup: action.setup ?? state.setup,
        setupOpen: action.setup?.needsWizard ?? state.setupOpen,
      };
    }
    case "reset":
      return {
        ...initialState,
        connected: true,
        config: action.config,
        vms: action.vms ?? [],
        hypervisorKind: action.hypervisorKind ?? "mock",
        dockerKind: action.dockerKind ?? "mock",
        dockerReady: action.dockerReady ?? action.dockerKind === "docker",
        setup: action.setup ?? null,
        setupOpen: action.setup?.needsWizard ?? false,
      };
    case "session": {
      const existing = state.sessions.find((s) => s.id === action.session.id);
      const session = existing ? mergeSession(existing, action.session) : action.session;
      const others = state.sessions.filter((s) => s.id !== session.id);
      return {
        ...state,
        sessions: [session, ...others].sort(sortSessions),
      };
    }
    case "sessions": {
      const prevById = new Map(state.sessions.map((row) => [row.id, row]));
      const sessions = action.sessions
        .map((row) => {
          const prev = prevById.get(row.id);
          return prev ? mergeSession(prev, row) : row;
        })
        .sort(sortSessions);
      return { ...state, sessions };
    }
    case "deleted": {
      const canvasHtml = { ...state.canvasHtml };
      delete canvasHtml[action.id];
      const gameShots = { ...state.gameShots };
      delete gameShots[action.id];
      const thinking = { ...state.thinking };
      delete thinking[action.id];
      const cloneProgress = { ...state.cloneProgress };
      delete cloneProgress[action.id];
      const imageProgress = { ...state.imageProgress };
      delete imageProgress[action.id];
      return {
        ...state,
        sessions: state.sessions.filter((s) => s.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        unreadIds: state.unreadIds.filter((id) => id !== action.id),
        canvasHtml,
        gameShots,
        thinking,
        cloneProgress,
        imageProgress,
        workspaceFocus: state.workspaceFocus?.sessionId === action.id ? null : state.workspaceFocus,
      };
    }
    case "vm": {
      const others = state.vms.filter((v) => v.id !== action.vm.id);
      return { ...state, vms: [action.vm, ...others] };
    }
    case "vms":
      return { ...state, vms: action.vms };
    case "deselect": {
      if (state.selectedId !== action.id) return state;
      return {
        ...state,
        selectedId: null,
        workspaceFocus: state.workspaceFocus?.sessionId === action.id ? null : state.workspaceFocus,
      };
    }
    case "select": {
      const picked = action.id ? state.sessions.find((s) => s.id === action.id) : undefined;
      const stayOnProject = Boolean(picked?.projectId && state.section === "project");
      return {
        ...state,
        selectedId: action.id,
        section: !action.id
          ? state.section
          : stayOnProject
            ? "project"
            : picked
              ? sectionForSession(picked)
              : "agents",
        selectedBoardId:
          picked && isBoardSession(picked) && picked.boardId
            ? picked.boardId
            : state.selectedBoardId,
        selectedProjectId: stayOnProject
          ? picked!.projectId!
          : picked && isProjectSession(picked) && picked.projectId
            ? picked.projectId
            : state.selectedProjectId,
        unreadIds: action.id ? state.unreadIds.filter((id) => id !== action.id) : state.unreadIds,
        // Design / Games / Assets open with the canvas beside the chat.
        vmCollapsed:
          picked && picked.id !== state.selectedId && isCanvasSession(picked)
            ? false
            : state.vmCollapsed,
      };
    }
    case "unread":
      if (state.unreadIds.includes(action.id)) return state;
      return { ...state, unreadIds: [...state.unreadIds, action.id] };
    case "unreadAutomation":
      if (state.unreadAutomationIds.includes(action.id)) return state;
      return { ...state, unreadAutomationIds: [...state.unreadAutomationIds, action.id] };
    case "overlay":
      return { ...state, overlay: action.overlay };
    case "compose":
      return { ...state, composerDraft: action.text };
    case "findChat":
      return { ...state, findChatOpen: action.open };
    case "openWorkspace":
      return { ...state, workspaceOpen: action.open };
    case "workspaceFocus": {
      const next =
        action.path == null || !action.path
          ? state.workspaceFocus?.sessionId === action.sessionId
            ? null
            : state.workspaceFocus
          : { sessionId: action.sessionId, path: action.path };
      if (
        next?.sessionId === state.workspaceFocus?.sessionId &&
        next?.path === state.workspaceFocus?.path
      ) {
        return state;
      }
      return { ...state, workspaceFocus: next };
    }
    case "canvas": {
      if (action.html == null) {
        if (!(action.sessionId in state.canvasHtml)) return state;
        const canvasHtml = { ...state.canvasHtml };
        delete canvasHtml[action.sessionId];
        return { ...state, canvasHtml };
      }
      return { ...state, canvasHtml: { ...state.canvasHtml, [action.sessionId]: action.html } };
    }
    case "gameShot": {
      if (!action.image) {
        if (!(action.sessionId in state.gameShots)) return state;
        const gameShots = { ...state.gameShots };
        delete gameShots[action.sessionId];
        return { ...state, gameShots };
      }
      return { ...state, gameShots: { ...state.gameShots, [action.sessionId]: action.image } };
    }
    case "selectAutomation":
      return {
        ...state,
        selectedAutomationId: action.id,
        section: "automations",
        unreadAutomationIds: action.id
          ? state.unreadAutomationIds.filter((id) => id !== action.id)
          : state.unreadAutomationIds,
        highlightAutomationWebhookId:
          action.id != null && action.id === state.highlightAutomationWebhookId
            ? state.highlightAutomationWebhookId
            : null,
      };
    case "highlightAutomationWebhook":
      return { ...state, highlightAutomationWebhookId: action.id };
    case "selectBoard": {
      const doc = action.id ? state.boardDocuments[action.id] : undefined;
      const summary = action.id ? state.boards.find((row) => row.id === action.id) : undefined;
      const chatId = doc?.chatSessionId ?? summary?.chatSessionId;
      return {
        ...state,
        selectedBoardId: action.id,
        boardFocusObjectId: action.id ? (action.objectId ?? null) : null,
        section: "board",
        selectedId: chatId ?? state.selectedId,
        vmCollapsed: state.section === "board" ? state.vmCollapsed : true,
      };
    }
    case "selectProject": {
      const doc = action.id ? state.projectDocuments[action.id] : undefined;
      const summary = action.id ? state.projects.find((row) => row.id === action.id) : undefined;
      const chatId = doc?.coordinatorSessionId ?? summary?.coordinatorSessionId;
      return {
        ...state,
        selectedProjectId: action.id,
        section: "project",
        selectedId: chatId ?? state.selectedId,
        vmCollapsed: state.section === "project" ? state.vmCollapsed : false,
      };
    }
    case "boards":
      return { ...state, boards: action.boards };
    case "board": {
      const summary = boardSummary(action.board);
      const boards = state.boards.some((row) => row.id === action.board.id)
        ? state.boards.map((row) => (row.id === action.board.id ? summary : row))
        : [summary, ...state.boards];
      return {
        ...state,
        boards,
        boardDocuments: { ...state.boardDocuments, [action.board.id]: action.board },
        selectedId:
          state.section === "board" && state.selectedBoardId === action.board.id
            ? (action.board.chatSessionId ?? state.selectedId)
            : state.selectedId,
      };
    }
    case "boardDeleted": {
      const { [action.id]: _removed, ...boardDocuments } = state.boardDocuments;
      return {
        ...state,
        boards: state.boards.filter((row) => row.id !== action.id),
        boardDocuments,
        selectedBoardId: state.selectedBoardId === action.id ? null : state.selectedBoardId,
        boardFocusObjectId: state.selectedBoardId === action.id ? null : state.boardFocusObjectId,
      };
    }
    case "projects":
      return { ...state, projects: action.projects };
    case "project": {
      const summary = projectSummary(action.project);
      const projects = state.projects.some((row) => row.id === action.project.id)
        ? state.projects.map((row) => (row.id === action.project.id ? summary : row))
        : [summary, ...state.projects];
      const onThisProject =
        state.section === "project" && state.selectedProjectId === action.project.id;
      const stillOnTeam =
        Boolean(state.selectedId) &&
        (state.selectedId === action.project.coordinatorSessionId ||
          action.project.memberIds.includes(state.selectedId!));
      return {
        ...state,
        projects,
        projectDocuments: { ...state.projectDocuments, [action.project.id]: action.project },
        selectedId: onThisProject
          ? stillOnTeam
            ? state.selectedId
            : (action.project.coordinatorSessionId ?? state.selectedId)
          : state.selectedId,
      };
    }
    case "projectDeleted": {
      const { [action.id]: _removed, ...projectDocuments } = state.projectDocuments;
      return {
        ...state,
        projects: state.projects.filter((row) => row.id !== action.id),
        projectDocuments,
        selectedProjectId: state.selectedProjectId === action.id ? null : state.selectedProjectId,
      };
    }
    case "brain":
      return {
        ...state,
        brain: "nodes" in action.brain ? brainSummary(action.brain) : action.brain,
      };
    case "selectRepo":
      return {
        ...state,
        section: "codebase",
        selectedRepoId: action.id,
        selectedPullNumber: null,
        activePull: null,
        selectedIssueNumber: null,
        activeIssue: null,
      };
    case "selectContainer":
      return {
        ...state,
        section: "docker",
        dockerView: "containers",
        selectedContainerId: action.id,
        selectedSwarmServiceId: null,
        selectedSwarmNodeId: null,
      };
    case "dockerView":
      return {
        ...state,
        section: "docker",
        dockerView: action.view,
      };
    case "dockerSwarm":
      return { ...state, dockerSwarm: action.swarm };
    case "selectSwarmService":
      return {
        ...state,
        section: "docker",
        dockerView: "swarm",
        selectedSwarmServiceId: action.id,
        selectedSwarmNodeId: null,
      };
    case "selectSwarmNode":
      return {
        ...state,
        section: "docker",
        dockerView: "swarm",
        selectedSwarmNodeId: action.id,
        selectedSwarmServiceId: null,
      };
    case "slackStatus":
      return {
        ...state,
        slackStatus: {
          ...(state.slackStatus ?? { connected: false, socket: "down" }),
          ...action.status,
        },
      };
    case "slackConversations": {
      const selected =
        state.selectedSlackChannelId &&
        action.conversations.some((row) => row.id === state.selectedSlackChannelId)
          ? state.selectedSlackChannelId
          : null;
      return {
        ...state,
        slackConversations: action.conversations,
        selectedSlackChannelId: selected,
        slackCatalogLoaded: true,
      };
    }
    case "slackCatalogLoaded":
      return state.slackCatalogLoaded ? state : { ...state, slackCatalogLoaded: true };
    case "slackActivity":
      return {
        ...state,
        slackActivity: action.items,
        slackActivityUnseen:
          action.unseen === undefined ? state.slackActivityUnseen : action.unseen,
      };
    case "selectSlackActivity":
      return { ...state, section: "slack", slackActivityOpen: true, slackActivityUnseen: false };
    case "slackChannel": {
      const idx = state.slackConversations.findIndex((row) => row.id === action.conversation.id);
      const conversations =
        idx >= 0
          ? state.slackConversations.map((row, i) =>
              i === idx ? { ...row, ...action.conversation } : row,
            )
          : [...state.slackConversations, action.conversation];
      const read = action.conversation.unread === false;
      return {
        ...state,
        slackConversations: conversations,
        slackActivity: read
          ? state.slackActivity.filter(
              (item) =>
                item.channelId !== action.conversation.id ||
                (item.kind !== "unread" && item.kind !== "dm"),
            )
          : state.slackActivity,
      };
    }
    case "selectSlackChannel":
      return {
        ...state,
        section: "slack",
        slackActivityOpen: false,
        selectedSlackChannelId: action.id,
        slackMessages: action.id === state.selectedSlackChannelId ? state.slackMessages : [],
        slackThreadTs: action.id === state.selectedSlackChannelId ? state.slackThreadTs : null,
      };
    case "slackMessages":
      return { ...state, slackMessages: mergeSlackMessages([], action.messages) };
    case "slackMessage": {
      if (action.message.subtype === "message_deleted") {
        return {
          ...state,
          slackMessages:
            action.message.channelId === state.selectedSlackChannelId
              ? mergeSlackMessages(state.slackMessages, [action.message])
              : state.slackMessages,
        };
      }
      if (action.message.channelId !== state.selectedSlackChannelId) {
        return {
          ...state,
          slackConversations: state.slackConversations.map((row) =>
            row.id === action.message.channelId
              ? {
                  ...row,
                  lastTs: laterSlackTs(row.lastTs, action.message.ts),
                  unread: row.id !== state.selectedSlackChannelId,
                }
              : row,
          ),
        };
      }
      return {
        ...state,
        slackMessages: mergeSlackMessages(state.slackMessages, [action.message]),
        slackConversations: state.slackConversations.map((row) =>
          row.id === action.message.channelId
            ? { ...row, lastTs: laterSlackTs(row.lastTs, action.message.ts), unread: false }
            : row,
        ),
      };
    }
    case "slackThread":
      return { ...state, slackThreadTs: action.ts };
    case "pickContainers":
      return { ...state, pickedContainerIds: action.ids };
    case "selectPull":
      return {
        ...state,
        section: "codebase",
        selectedPullNumber: action.number,
        activePull: action.number === state.selectedPullNumber ? state.activePull : null,
      };
    case "selectIssue":
      return {
        ...state,
        section: "codebase",
        selectedIssueNumber: action.number,
        activeIssue: action.number === state.selectedIssueNumber ? state.activeIssue : null,
      };
    case "section": {
      if (action.section === state.section) return state;
      const leavingDocker = state.section === "docker" && action.section !== "docker";
      const pickedIds = leavingDocker ? [] : state.pickedContainerIds;
      if (isSessionlessSection(action.section)) {
        return {
          ...state,
          section: action.section,
          pickedContainerIds: pickedIds,
          vmCollapsed:
            action.section === "board"
              ? true
              : action.section === "project"
                ? false
                : state.vmCollapsed,
        };
      }
      const picked = state.sessions.find((s) => s.id === state.selectedId);
      if (sessionFitsSection(picked, action.section)) {
        return { ...state, section: action.section, pickedContainerIds: pickedIds };
      }
      const next = firstSessionForSection(state.sessions, action.section);
      return {
        ...state,
        section: action.section,
        selectedId: next?.id ?? null,
        vmCollapsed: next && isCanvasSession(next) ? false : state.vmCollapsed,
        unreadIds: next ? state.unreadIds.filter((id) => id !== next.id) : state.unreadIds,
        pickedContainerIds: pickedIds,
      };
    }
    case "query": {
      const current = state.queries[state.section] ?? "";
      if (current === action.query) return state;
      return { ...state, queries: { ...state.queries, [state.section]: action.query } };
    }
    case "toggleSidebar":
      return { ...state, collapsed: !state.collapsed };
    case "sidebarCollapsed":
      return action.collapsed === state.collapsed
        ? state
        : { ...state, collapsed: action.collapsed };
    case "inbox":
      return action.open === state.inboxOpen ? state : { ...state, inboxOpen: action.open };
    case "ideStart":
      return action.intent === state.ideStart ? state : { ...state, ideStart: action.intent };
    case "toggleVmPane":
      return { ...state, vmCollapsed: !state.vmCollapsed };
    case "showVmPane":
      return state.vmCollapsed ? { ...state, vmCollapsed: false } : state;
    case "settings": {
      if (action.open) {
        if (state.section === "settings") return state;
        return {
          ...state,
          section: "settings",
          settingsReturnSection: state.section,
        };
      }
      if (state.section !== "settings") return state;
      return {
        ...state,
        section: state.settingsReturnSection,
        settingsReturnSection: "agents",
      };
    }
    case "settingsTab":
      if (action.tab === state.settingsTab) return state;
      return { ...state, settingsTab: action.tab };
    case "sessionSettings":
      return { ...state, sessionSettingsOpen: action.open };
    case "designSystems":
      return { ...state, designSystemsOpen: action.open };
    case "designSystemList":
      return { ...state, designSystems: action.systems };
    case "assetStyles":
      return { ...state, assetStylesOpen: action.open };
    case "assetStyleList":
      return { ...state, assetStyles: action.styles };
    case "gameStyles":
      return { ...state, gameStylesOpen: action.open };
    case "gameStyleList":
      return { ...state, gameStyles: action.styles };
    case "setup":
      return {
        ...state,
        setup: action.setup,
        hypervisorKind: action.setup.hypervisorKind ?? state.hypervisorKind,
        dockerKind: action.setup.dockerFound ? "docker" : "mock",
      };
    case "setupOpen":
      return { ...state, setupOpen: action.open };
    case "new":
      return {
        ...state,
        newOpen: action.open,
        newOs: action.open ? (action.os ?? state.newOs) : null,
        newRuntime: action.open ? (action.runtime ?? state.newRuntime) : null,
        newDockerImage: action.open ? (action.dockerImage ?? state.newDockerImage) : "",
        newPrompt: action.open ? (action.prompt ?? state.newPrompt) : "",
        newHostDir: action.open ? (action.hostDir ?? state.newHostDir) : "",
        newInstructions: action.open ? (action.instructions ?? "") : "",
        newPlaybook: action.open ? (action.playbook ?? "") : "",
        newAllowedTools: action.open ? (action.allowedTools ?? []) : [],
        newKind: action.open ? (action.kind ?? null) : null,
        newRepoId: action.open ? (action.repoId ?? "") : "",
        newExtraRepoIds: action.open ? (action.extraRepoIds ?? []) : [],
        newRepoUrl: action.open ? (action.repoUrl ?? "") : "",
        newRepoRef: action.open ? (action.repoRef ?? "") : "",
      };
    case "newAutomation":
      return {
        ...state,
        newAutomationOpen: action.open,
        editingAutomationId: action.open ? (action.editId ?? null) : null,
        automationStarterId: action.open ? (action.starterId ?? null) : null,
      };
    case "automation": {
      const others = state.automations.filter((a) => a.id !== action.automation.id);
      return {
        ...state,
        automations: [action.automation, ...others].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      };
    }
    case "automations":
      return { ...state, automations: action.automations };
    case "automationDeleted":
      return {
        ...state,
        automations: state.automations.filter((a) => a.id !== action.id),
        runs: state.runs.filter((r) => r.automationId !== action.id),
        selectedAutomationId:
          state.selectedAutomationId === action.id ? null : state.selectedAutomationId,
        unreadAutomationIds: state.unreadAutomationIds.filter((id) => id !== action.id),
      };
    case "run": {
      const others = state.runs.filter((r) => r.id !== action.run.id);
      return {
        ...state,
        runs: [action.run, ...others].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      };
    }
    case "runs":
      return { ...state, runs: action.runs };
    case "repos":
      return { ...state, repos: [...action.repos] };
    case "repo": {
      const others = state.repos.filter((row) => row.id !== action.repo.id);
      return {
        ...state,
        repos: [action.repo, ...others].sort(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name),
        ),
      };
    }
    case "repoDeleted":
      return {
        ...state,
        repos: state.repos.filter((row) => row.id !== action.id),
        selectedRepoId: state.selectedRepoId === action.id ? null : state.selectedRepoId,
        selectedPullNumber: state.selectedRepoId === action.id ? null : state.selectedPullNumber,
        activePull: state.selectedRepoId === action.id ? null : state.activePull,
        selectedIssueNumber: state.selectedRepoId === action.id ? null : state.selectedIssueNumber,
        activeIssue: state.selectedRepoId === action.id ? null : state.activeIssue,
      };
    case "containers": {
      const selected =
        state.selectedContainerId &&
        action.containers.some((row) => row.id === state.selectedContainerId)
          ? state.selectedContainerId
          : (action.containers[0]?.id ?? null);
      return {
        ...state,
        containers: action.containers,
        selectedContainerId: selected,
        pickedContainerIds: state.pickedContainerIds.filter((id) =>
          action.containers.some((row) => row.id === id),
        ),
      };
    }
    case "container": {
      const others = state.containers.filter((row) => row.id !== action.container.id);
      const containers = [action.container, ...others];
      return { ...state, containers, selectedContainerId: action.container.id };
    }
    case "pull":
      return { ...state, activePull: action.pull };
    case "issue":
      return { ...state, activeIssue: action.issue };
    case "error":
      return { ...state, error: action.error };
    case "connected":
      return { ...state, connected: action.connected };
    case "config":
      return { ...state, config: action.config };
    case "productModeTransition":
      return { ...state, productModeTransition: action.transition };
    case "delta": {
      const sessions =
        patchSessionMessage(state.sessions, action.sessionId, action.messageId, (m) => ({
          ...m,
          content: m.content + action.delta,
        })) ?? state.sessions;
      if (!state.thinking[action.sessionId]) {
        return sessions === state.sessions ? state : { ...state, sessions };
      }
      const thinking = { ...state.thinking };
      delete thinking[action.sessionId];
      return { ...state, sessions, thinking };
    }
    case "message": {
      const sessions = state.sessions.map((s) => {
        if (s.id !== action.sessionId) return s;
        if (s.messages.some((m) => m.id === action.message.id)) return s;
        return { ...s, messages: [...s.messages, action.message] };
      });
      if (action.message.role === "user" && !action.message.hidden) {
        return { ...state, sessions: [...sessions].sort(sortSessions) };
      }
      return { ...state, sessions };
    }
    case "thinking": {
      if (!action.snippet) {
        if (!state.thinking[action.sessionId]) return state;
        const thinking = { ...state.thinking };
        delete thinking[action.sessionId];
        return { ...state, thinking };
      }
      return {
        ...state,
        thinking: { ...state.thinking, [action.sessionId]: action.snippet },
      };
    }
    case "thinkingDelta": {
      const sessions = patchSessionMessage(
        state.sessions,
        action.sessionId,
        action.messageId,
        (m) => ({ ...m, thinking: appendThinkingText(m.thinking, action.delta) }),
      );
      return sessions ? { ...state, sessions } : state;
    }
    case "cloneProgress": {
      if (!action.progress) {
        if (!state.cloneProgress[action.sessionId]) return state;
        const cloneProgress = { ...state.cloneProgress };
        delete cloneProgress[action.sessionId];
        return { ...state, cloneProgress };
      }
      return {
        ...state,
        cloneProgress: { ...state.cloneProgress, [action.sessionId]: action.progress },
      };
    }
    case "imageProgress": {
      if (!action.progress) {
        if (!state.imageProgress[action.sessionId]) return state;
        const imageProgress = { ...state.imageProgress };
        delete imageProgress[action.sessionId];
        return { ...state, imageProgress };
      }
      return {
        ...state,
        imageProgress: { ...state.imageProgress, [action.sessionId]: action.progress },
      };
    }
    case "qemuInstall":
      if (!action.progress) {
        if (!state.qemuInstall) return state;
        return { ...state, qemuInstall: null };
      }
      return { ...state, qemuInstall: action.progress };
    case "seekTimeline":
      return { ...state, timelineSeek: action.seek };
    case "replay":
      return { ...state, replayOpen: action.open };
    case "compare":
      return { ...state, compareOpen: action.open };
    default:
      return state;
  }
}

export function sortSessions(a: AgentSession, b: AgentSession): number {
  return compareSessionsForList(a, b);
}

export { isIdeSession };

export function sectionForSession(session: AgentSession): UiSection {
  if (isDesignSession(session)) return "design";
  if (isGameSession(session)) return "games";
  if (isAssetSession(session)) return "assets";
  if (isBoardSession(session)) return "board";
  if (isProjectSession(session)) return "project";
  if (isIdeSession(session)) return "ide";
  return "agents";
}

export function sessionFitsSection(session: AgentSession | undefined, section: UiSection): boolean {
  if (!session || isSessionlessSection(section)) return false;
  return sectionForSession(session) === section;
}

function firstSessionForSection(
  sessions: AgentSession[],
  section: UiSection,
): AgentSession | undefined {
  if (isSessionlessSection(section)) return undefined;
  return sessions.find((s) => !s.archived && sessionFitsSection(s, section));
}

function mergeSlackMessages(existing: SlackMessage[], incoming: SlackMessage[]): SlackMessage[] {
  return mergeSlackMessageRows(existing, incoming);
}

function laterSlackTs(current: string | undefined, incoming: string): string {
  if (!current) return incoming;
  return incoming.localeCompare(current) > 0 ? incoming : current;
}

/** Patch one message from the end. Streaming deltas almost always hit the latest assistant row. */
export function patchSessionMessage(
  sessions: AgentSession[],
  sessionId: string,
  messageId: string,
  patch: (message: ChatMessage) => ChatMessage,
): AgentSession[] | undefined {
  const sessionIdx = sessions.findIndex((row) => row.id === sessionId);
  if (sessionIdx < 0) return undefined;
  const session = sessions[sessionIdx]!;
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const current = session.messages[i]!;
    if (current.id !== messageId) continue;
    const nextMessage = patch(current);
    if (nextMessage === current) return sessions;
    const messages = session.messages.slice();
    messages[i] = nextMessage;
    const next = sessions.slice();
    next[sessionIdx] = { ...session, messages };
    return next;
  }
  return undefined;
}

export const Store = createContext<{ state: UiState; dispatch: Dispatch<Action> } | null>(null);

export function useStore() {
  const ctx = useContext(Store);
  if (!ctx) throw new Error("Store missing");
  return ctx;
}
