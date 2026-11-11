import type {
  AgentSession,
  Automation,
  BrainSummary,
  ProjectSummary,
  SetupStatus,
  SlackStatus,
} from "@locus/shared";
import { comparePeer, lastUserPrompt, setupHasRemainingTodos, setupTodos } from "@locus/shared";
import type { UiSection } from "@/state/store";
import type { SettingsTab } from "@/lib/settingsNav";
import type { PaletteGroup, PaletteItem } from "@/lib/palette";

/** Surfaces that are easy to miss — shown on Agents empty. */
export type ExploreSurface = {
  id: string;
  section: UiSection;
  title: string;
  blurb: string;
};

export const EXPLORE_SURFACES: ExploreSurface[] = [
  {
    id: "brain",
    section: "brain",
    title: "Brain",
    blurb: "Remember services and conclusions across agents",
  },
  {
    id: "project",
    section: "project",
    title: "Projects",
    blurb: "Coordinator + shared context for a body of work",
  },
  {
    id: "board",
    section: "board",
    title: "Board",
    blurb: "Local planning canvas — stickies and frames",
  },
  {
    id: "slack",
    section: "slack",
    title: "Slack",
    blurb: "Read as you · ask Locus in a thread",
  },
  {
    id: "grafana",
    section: "grafana",
    title: "Grafana",
    blurb: "Open dashboards and trace failures into repos",
  },
];

export type FeatureHint = {
  id: string;
  text: string;
  actionLabel: string;
  /** Section jump, settings tab, or palette-style action id. */
  action:
    | { kind: "section"; section: UiSection }
    | { kind: "settings"; tab: SettingsTab }
    | { kind: "new-automation" }
    | { kind: "compare" }
    | { kind: "replay" };
};

export const SECTION_FEATURE_HINTS: Partial<Record<UiSection, FeatureHint>> = {
  automations: {
    id: "automations-webhook",
    text: "Trigger from a schedule, git push, pull request, or webhook.",
    actionLabel: "New job",
    action: { kind: "new-automation" },
  },
  project: {
    id: "project-coordinator",
    text: "A coordinator plans and delegates — members share context.",
    actionLabel: "New project",
    action: { kind: "section", section: "project" },
  },
  board: {
    id: "board-miro",
    text: "Stickies, frames, and live cards — or ask Locus to map the canvas.",
    actionLabel: "New board",
    action: { kind: "section", section: "board" },
  },
  ide: {
    id: "ide-codebase",
    text: "Review pull requests and walk the change stack in Codebase.",
    actionLabel: "Open Codebase",
    action: { kind: "section", section: "codebase" },
  },
  codebase: {
    id: "codebase-ide",
    text: "Open a linked repo folder in the IDE for edit, git, and debug.",
    actionLabel: "Open IDE",
    action: { kind: "section", section: "ide" },
  },
  brain: {
    id: "brain-memory",
    text: "Coding agents orient here automatically — index a folder to start.",
    actionLabel: "Index folder",
    action: { kind: "section", section: "brain" },
  },
  design: {
    id: "design-promote",
    text: "Promote a design into an agent workspace when you’re ready to build.",
    actionLabel: "New agent",
    action: { kind: "section", section: "agents" },
  },
  games: {
    id: "games-playable",
    text: "Start from Arcade, Platformer, Grid puzzle, Cards, or Twin-stick — the first draft should be playable.",
    actionLabel: "New game",
    action: { kind: "section", section: "games" },
  },
  assets: {
    id: "assets-studio",
    text: "Turn a photo or prompt into a 2D sprite or a rigged 3D mesh — pick topology, resolution, and pose, then iterate texture.",
    actionLabel: "New asset",
    action: { kind: "section", section: "assets" },
  },
  docker: {
    id: "docker-fleet",
    text: "Stop, restart, or pull logs for containers on this host.",
    actionLabel: "Workers",
    action: { kind: "settings", tab: "workers" },
  },
  slack: {
    id: "slack-ask",
    text: "Ask Locus in a thread, or send as you.",
    actionLabel: "Slack settings",
    action: { kind: "settings", tab: "integrations" },
  },
  grafana: {
    id: "grafana-explore",
    text: "Dashboards, firing alerts, Lucene logs, stack traces into linked repos, then Investigate.",
    actionLabel: "Add Grafana",
    action: { kind: "settings", tab: "integrations" },
  },
};

export type CapabilityTodoId = "automation" | "brain" | "project" | "slack" | "mcp";

export type CapabilityTodo = {
  id: CapabilityTodoId;
  label: string;
  done: boolean;
  action: FeatureHint["action"];
};

export const FEATURE_CHECKLIST_DISMISSED_KEY = "locus.featureChecklistDismissed";
export const NUDGE_DISMISSED_PREFIX = "locus.nudgeDismissed.";

export function loadFeatureChecklistDismissed(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): boolean {
  return storage?.getItem(FEATURE_CHECKLIST_DISMISSED_KEY) === "1";
}

export function saveFeatureChecklistDismissed(
  dismissed: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  if (dismissed) storage.setItem(FEATURE_CHECKLIST_DISMISSED_KEY, "1");
  else storage.removeItem(FEATURE_CHECKLIST_DISMISSED_KEY);
}

export function loadNudgeDismissed(
  id: string,
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): boolean {
  return storage?.getItem(`${NUDGE_DISMISSED_PREFIX}${id}`) === "1";
}

export function saveNudgeDismissed(
  id: string,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  storage?.setItem(`${NUDGE_DISMISSED_PREFIX}${id}`, "1");
}

export function capabilityTodos(input: {
  automations?: Automation[];
  projects?: ProjectSummary[];
  brain?: BrainSummary | null;
  slackStatus?: SlackStatus | null;
  mcpServerCount?: number;
}): CapabilityTodo[] {
  const brainReady = Boolean(input.brain && !input.brain.empty);
  return [
    {
      id: "automation",
      label: "Create a job",
      done: (input.automations?.length ?? 0) > 0,
      action: { kind: "new-automation" },
    },
    {
      id: "brain",
      label: "Open Brain",
      done: brainReady,
      action: { kind: "section", section: "brain" },
    },
    {
      id: "project",
      label: "Start a project",
      done: (input.projects?.length ?? 0) > 0,
      action: { kind: "section", section: "project" },
    },
    {
      id: "slack",
      label: "Connect Slack",
      done: Boolean(input.slackStatus?.connected),
      action: { kind: "section", section: "slack" },
    },
    {
      id: "mcp",
      label: "Add an MCP server",
      done: (input.mcpServerCount ?? 0) > 0,
      action: { kind: "settings", tab: "mcp" },
    },
  ];
}

/** Show feature checklist only after core setup is done (or dismissed). */
export function shouldShowFeatureChecklist(input: {
  setup: SetupStatus | null | undefined;
  setupHintDismissed: boolean;
  featureDismissed: boolean;
  automations?: Automation[];
  projects?: ProjectSummary[];
  brain?: BrainSummary | null;
  slackStatus?: SlackStatus | null;
  mcpServerCount?: number;
}): boolean {
  if (input.featureDismissed || !input.setup?.setupCompleted) return false;
  const setupOpen =
    setupHasRemainingTodos(input.setup) &&
    !input.setupHintDismissed &&
    setupTodos(input.setup).some((row) => !row.done);
  if (setupOpen) return false;
  const todos = capabilityTodos(input);
  return todos.some((row) => !row.done);
}

/** Palette feature catalog — searchable synonyms for buried capabilities. */
export function featurePaletteItems(): PaletteItem[] {
  const rows: Array<{
    id: string;
    title: string;
    hint: string;
    keywords: string;
  }> = [
    {
      id: "feature:compare",
      title: "Compare models",
      hint: "Fork and replay the last prompt on another model",
      keywords: "compare models fork replay distrust a/b evaluation",
    },
    {
      id: "feature:replay",
      title: "Replay run",
      hint: "Screenshot timeline of the last agent run",
      keywords: "replay timeline screenshots run history",
    },
    {
      id: "feature:mcp",
      title: "MCP servers",
      hint: "Settings · Tools",
      keywords: "mcp tools plugins servers model context protocol",
    },
    {
      id: "feature:skills",
      title: "Skills",
      hint: "Settings · Tools",
      keywords: "skills slash recipes agent capabilities",
    },
    {
      id: "feature:workers",
      title: "Workers & environments",
      hint: "Settings · Workspace",
      keywords: "workers lan remote environments placement fleet",
    },
    {
      id: "feature:webhooks",
      title: "Webhook jobs",
      hint: "Jobs · event triggers",
      keywords: "webhook cron schedule forge-push pull-request automation",
    },
    {
      id: "feature:phone",
      title: "Phone pairing",
      hint: "Settings · System",
      keywords: "phone android pair mobile shell",
    },
    {
      id: "feature:chrome",
      title: "Use my Chrome",
      hint: "Settings · Chrome",
      keywords: "chrome extension edge live tabs host browser claude",
    },
    {
      id: "feature:swarm",
      title: "Swarm mode",
      hint: "Teammates, teams, and routines",
      keywords: "swarm hub teammates teams routines product mode",
    },
    {
      id: "feature:memory",
      title: "Brain memory",
      hint: "Durable conclusions across agents",
      keywords: "memory remember brain knowledge graph orient",
    },
    {
      id: "feature:subscriptions",
      title: "Subscriptions",
      hint: "Agent settings · Slack, PR, or timer wakes",
      keywords: "subscriptions notify slack pr timer wake agent",
    },
  ];
  return rows.map((row) => ({
    ...row,
    group: "Help" as PaletteGroup,
  }));
}

const TRY_NEXT_CANDIDATES: Array<{ id: string; when: (ctx: TryNextContext) => boolean }> = [
  { id: "section:brain", when: (ctx) => !ctx.hasBrain },
  { id: "section:project", when: (ctx) => !ctx.hasProjects },
  { id: "section:automations", when: (ctx) => !ctx.hasAutomations },
  { id: "section:board", when: (ctx) => !ctx.hasBoards },
  { id: "section:codebase", when: (ctx) => !ctx.hasRepos },
  { id: "section:slack", when: (ctx) => !ctx.slackConnected },
  { id: "feature:mcp", when: (ctx) => !ctx.hasMcp },
  { id: "feature:compare", when: (ctx) => ctx.canCompare },
];

export type TryNextContext = {
  hasBrain: boolean;
  hasProjects: boolean;
  hasAutomations: boolean;
  hasBoards: boolean;
  hasRepos: boolean;
  slackConnected: boolean;
  hasMcp: boolean;
  canCompare: boolean;
};

export function tryNextContext(input: {
  automations?: Automation[];
  projects?: ProjectSummary[];
  boards?: { id: string }[];
  repos?: { id: string }[];
  brain?: BrainSummary | null;
  slackStatus?: SlackStatus | null;
  mcpServerCount?: number;
  session?: AgentSession;
  sessions?: AgentSession[];
}): TryNextContext {
  const session = input.session;
  const canCompare = Boolean(
    session && lastUserPrompt(session.messages) && !comparePeer(session, input.sessions ?? []),
  );
  return {
    hasBrain: Boolean(input.brain && !input.brain.empty),
    hasProjects: (input.projects?.length ?? 0) > 0,
    hasAutomations: (input.automations?.length ?? 0) > 0,
    hasBoards: (input.boards?.length ?? 0) > 0,
    hasRepos: (input.repos?.length ?? 0) > 0,
    slackConnected: Boolean(input.slackStatus?.connected),
    hasMcp: (input.mcpServerCount ?? 0) > 0,
    canCompare,
  };
}

/** Prefer underused surfaces when the palette opens with an empty query. */
export function orderPaletteForBrowse(
  items: PaletteItem[],
  ctx: TryNextContext,
  limit = 4,
): PaletteItem[] {
  const tryIds = TRY_NEXT_CANDIDATES.filter((row) => row.when(ctx))
    .slice(0, limit)
    .map((row) => row.id);
  if (!tryIds.length) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const tryItems: PaletteItem[] = [];
  for (const id of tryIds) {
    const item = byId.get(id);
    if (!item) continue;
    tryItems.push({ ...item, group: "Recents" });
  }
  if (!tryItems.length) return items;
  const used = new Set(tryItems.map((item) => item.id));
  return [...tryItems, ...items.filter((item) => !used.has(item.id))];
}

export type ChatNudgeId = "compare" | "automation" | "ide";

export function chatNudgeForSession(input: {
  session: AgentSession;
  sessions: AgentSession[];
  dismissed: Set<string> | ((id: string) => boolean);
  hasAutomations: boolean;
}): { id: ChatNudgeId; text: string; actionLabel: string } | null {
  const { session } = input;
  const dismissedCheck = input.dismissed;
  const dismissed =
    typeof dismissedCheck === "function" ? dismissedCheck : (id: string) => dismissedCheck.has(id);

  const assistantTurns = session.messages.filter((m) => m.role === "assistant").length;
  if (assistantTurns < 2) return null;

  if (
    !dismissed("compare") &&
    lastUserPrompt(session.messages) &&
    !comparePeer(session, input.sessions) &&
    !session.compare
  ) {
    return {
      id: "compare",
      text: "Try the same prompt on another model.",
      actionLabel: "Compare",
    };
  }

  return null;
}
