/** Body-of-work document. Lives under `~/.locus/projects/<id>/`, not in session JSON. */

import type { AgentPlacement } from "./placement.js";
import type { SessionSurface } from "./session.js";
import type { AgentRuntime } from "./vm.js";
import { parseFleetWatchMap, type FleetWatchEntry } from "./fleetWake.js";
import {
  parseSwarmNeeds,
  type SwarmAuditEvent,
  type SwarmNeed,
  type SwarmTeamStatus,
  type SwarmTeamMember,
} from "./swarm.js";

export const PROJECT_STARTERS = ["feature", "migration", "gardening", "blank"] as const;
export type ProjectStarter = (typeof PROJECT_STARTERS)[number];

export function isProjectStarter(value: unknown): value is ProjectStarter {
  return PROJECT_STARTERS.includes(value as ProjectStarter);
}

export const PROJECT_MEMBER_KINDS = ["agent", "review", "design", "game"] as const;
export type ProjectMemberKind = (typeof PROJECT_MEMBER_KINDS)[number];

export function isProjectMemberKind(value: unknown): value is ProjectMemberKind {
  return value === "agent" || value === "review" || value === "design" || value === "game";
}

export const DEFAULT_PROJECT_MAX_CONCURRENT = 4;
export const HARD_PROJECT_MAX_CONCURRENT = 8;
export const MIN_GROUP_CHAT_PARTICIPANTS = 2;
export const MAX_GROUP_CHAT_PARTICIPANTS = 6;
export const PROJECT_CONTEXT_PROMPT_BUDGET = 8_000;

export const PROJECT_TOOL_NAMES = [
  "project_get",
  "project_spawn",
  "project_steer",
  "project_stop",
  "project_replace",
  "team_directory",
  "team_handoff",
  "project_collect",
  "project_propose_merge",
  "project_propose_rule",
  "project_context_list",
  "project_context_read",
  "project_context_write",
  "project_context_delete",
] as const;
export type ProjectToolName = (typeof PROJECT_TOOL_NAMES)[number];

export function isProjectToolName(name: string): name is ProjectToolName {
  return (PROJECT_TOOL_NAMES as readonly string[]).includes(name);
}

export const PROJECT_COORDINATOR_TOOLS = [
  "project_get",
  "project_spawn",
  "project_steer",
  "project_stop",
  "project_replace",
  "team_directory",
  "team_handoff",
  "project_collect",
  "project_propose_merge",
  "project_propose_rule",
  "project_context_list",
  "project_context_read",
  "project_context_write",
  "project_context_delete",
] as const;

export const PROJECT_MEMBER_TOOLS = [
  "project_get",
  "project_collect",
  "project_context_list",
  "project_context_read",
  "project_context_write",
  "project_context_delete",
] as const;

export interface ProjectStarterMeta {
  id: ProjectStarter;
  title: string;
  blurb: string;
}

export const PROJECT_STARTER_META: ProjectStarterMeta[] = [
  {
    id: "feature",
    title: "Feature",
    blurb: "Research, plan, then spawn implement members per slice.",
  },
  {
    id: "migration",
    title: "Migration",
    blurb: "Agree a safe approach, then one member per cohort.",
  },
  {
    id: "gardening",
    title: "Gardening",
    blurb: "Watch PRs and Slack. Spawn a bounded fix when something fires.",
  },
  { id: "blank", title: "Blank", blurb: "Empty context. Describe the work." },
];

export function projectTitleFromStarter(starter?: ProjectStarter): string {
  if (starter === "feature") return "Feature";
  if (starter === "migration") return "Migration";
  if (starter === "gardening") return "Gardening";
  return "Project";
}

export const FEATURE_PLAYBOOK = `You are a Locus Project coordinator for a feature.

Do not write application code, apply_patch, exec, git_push, or open a PR yourself. Delegate.

1. Read project_context_list / INDEX.md. Research with read-only git_pr_list / git_issue_list / repo notes.
2. Write what you learn into context (research/, playbooks/, preferences.md, INDEX.md).
3. Keep a task_list of slices. Ask before opening PRs.
4. project_spawn one implement member per independent slice (kind=agent, or kind=design for a Designer/UI/UX canvas; focus a glob or area).
5. project_collect / project_steer as they run. Stay responsive — spawn returns immediately.
6. If a slice needs the laptop (GUI, hardware), spawn with placement=local.
7. When a member PR is green, project_propose_merge — the operator still Approves the merge.
8. When the same mistake appears twice, project_propose_rule so it lands in context/rules/.

When a subscription fires, re-read context, then spawn or ask. Do not busy-wait.

In Swarm, use team_directory to find another named team and team_handoff for bounded cross-team work when needed.`;

export const MIGRATION_PLAYBOOK = `You are a Locus Project coordinator for a migration.

Do not write application code yourself. Establish a safe approach in context/playbooks/ first.

Then project_spawn one member per cohort (directory, glob, or service). Early on, every PR waits for the operator. As fixes hold up, keep going through the remaining cohorts.

Ask before expanding the blast radius. Prefer small PRs. project_propose_merge when a cohort PR is green. When the same mistake appears twice, project_propose_rule.

In Swarm, use team_directory to find another named team and team_handoff for bounded cross-team work when needed.`;

export const GARDENING_PLAYBOOK = `You are a Locus Project coordinator for standing maintenance (gardening).

Do not write application code yourself. Do not start speculative refactors.

When a timer or subscription fires: git_pr_list / git_issue_list (or read the event), compare to context, then either ask or project_spawn a bounded review/fix member. Subscribe to specific PRs with subscribe as they appear. No drive-by cleanups.

When you see the same mistake twice, project_propose_rule (title + convention). That writes context/rules/ and asks the operator to apply it to the repo. When a member PR is green, project_propose_merge — do not merge yourself.

In Swarm, use team_directory to find another named team and team_handoff for bounded cross-team work when needed.`;

export const BLANK_PLAYBOOK = `You are a Locus Project coordinator. The operator will describe the body of work.

Do not write application code, apply_patch, exec, git_push, or open a PR yourself. Use project_context_* to accumulate notes and project_spawn to delegate. Stay responsive.

In Swarm, use team_directory to find another named team and team_handoff for bounded cross-team work when needed.`;

export const PROJECT_PLAYBOOK = FEATURE_PLAYBOOK;

export function playbookForStarter(starter?: ProjectStarter): string {
  if (starter === "migration") return MIGRATION_PLAYBOOK;
  if (starter === "gardening") return GARDENING_PLAYBOOK;
  if (starter === "blank") return BLANK_PLAYBOOK;
  return FEATURE_PLAYBOOK;
}

export function seedContextFiles(
  starter: ProjectStarter,
  title: string,
  goal?: string,
): ProjectContextFile[] {
  const goalLine = goal?.trim() ? `\n\n${goal.trim()}` : "";
  const index = `# ${title}\n\nStarter: ${starter}.${goalLine}\n`;
  const files: ProjectContextFile[] = [
    { path: "INDEX.md", content: index },
    { path: "preferences.md", content: "# Preferences\n\nOperator corrections and how we work.\n" },
  ];
  if (starter === "feature") {
    files.push({
      path: "playbooks/feature.md",
      content:
        "# Feature playbook\n\nResearch the system, record findings here, then spawn one member per slice. Ask before PRs.\n",
    });
  } else if (starter === "migration") {
    files.push({
      path: "playbooks/migration.md",
      content:
        "# Migration playbook\n\nWrite the safe approach here. One member per cohort. Small PRs. Wait for review early.\n",
    });
  } else if (starter === "gardening") {
    files.push({
      path: "playbooks/garden.md",
      content:
        "# Garden playbook\n\nOn each timer/PR fire: scan, then spawn a bounded review or fix. No speculative refactors.\n",
    });
    files.push({
      path: "rules/README.md",
      content:
        "# Garden rules\n\nWhen a pattern repeats, add a rule with project_propose_rule. Do not edit CI or Locus.md from the coordinator.\n",
    });
  } else {
    files.push({
      path: "playbooks/notes.md",
      content: "# Playbook\n\nHow this project gets work done.\n",
    });
  }
  return files;
}

export interface ProjectContextFile {
  path: string;
  content: string;
}

export interface ProjectDocument {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  goal?: string;
  recipeId?: ProjectStarter;
  coordinatorSessionId?: string;
  memberIds: string[];
  /** A Swarm project whose coordinator transcript is a shared group chat. */
  groupChat?: boolean;
  placement?: AgentPlacement;
  backendId?: string;
  namedEnvId?: string;
  repoId?: string;
  /** Optional planning board pinned to this project. */
  boardId?: string;
  runtime?: AgentRuntime;
  maxUsd?: number;
  maxConcurrentMembers: number;
  paused?: boolean;
  /**
   * When set, quitting the desktop leaves the control-plane process running
   * so this project's subscriptions and fleet wake keep ticking.
   */
  keepAlive?: boolean;
  /** Per-member forge cursor for wake-and-fix. Not shown in the catalog. */
  fleetWatch?: Record<string, FleetWatchEntry>;
  surface?: SessionSurface;
  archived?: boolean;
  /** Durable team roster metadata; session JSON remains the live source of truth. */
  team?: {
    name?: string;
    members: SwarmTeamMember[];
  };
  /** Durable operator inbox for member gates. */
  needsYou?: SwarmNeed[];
  /** Append-only, bounded operational history for mission control. */
  audit?: SwarmAuditEvent[];
}

export interface ProjectSummary {
  id: string;
  title: string;
  teamName?: string;
  updatedAt: string;
  createdAt: string;
  starter?: ProjectStarter;
  coordinatorSessionId?: string;
  memberCount: number;
  /** Present for group chats so the desktop can resolve @mentions without a full doc fetch. */
  memberIds?: string[];
  groupChat?: boolean;
  paused?: boolean;
  keepAlive?: boolean;
  teamStatus?: SwarmTeamStatus;
  archived?: boolean;
  repoId?: string;
  boardId?: string;
  placement?: AgentPlacement;
  surface?: SessionSurface;
  needsYouCount?: number;
}

export interface CreateProjectInput {
  title?: string;
  teamName?: string;
  starter?: ProjectStarter;
  prompt?: string;
  repoId?: string;
  placement?: AgentPlacement;
  backendId?: string;
  runtime?: AgentRuntime;
  maxUsd?: number;
  maxConcurrentMembers?: number;
  namedEnvId?: string;
  boardId?: string;
  surface?: SessionSurface;
  groupChat?: boolean;
  participantIds?: string[];
}

export interface PatchProjectInput {
  title?: string;
  goal?: string | null;
  coordinatorSessionId?: string | null;
  memberIds?: string[];
  placement?: AgentPlacement | null;
  backendId?: string | null;
  namedEnvId?: string | null;
  repoId?: string | null;
  boardId?: string | null;
  runtime?: AgentRuntime | null;
  maxUsd?: number | null;
  maxConcurrentMembers?: number;
  paused?: boolean;
  keepAlive?: boolean;
  archived?: boolean;
  teamName?: string | null;
  teamMembers?: SwarmTeamMember[];
}

export interface ProjectContextEntry {
  path: string;
  bytes: number;
}

export function projectSummary(project: ProjectDocument): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    teamName: project.team?.name?.trim() || project.title,
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,
    starter: project.recipeId,
    coordinatorSessionId: project.coordinatorSessionId,
    memberCount: project.memberIds.length,
    memberIds: project.groupChat ? [...project.memberIds] : undefined,
    groupChat: project.groupChat,
    paused: project.paused,
    keepAlive: project.keepAlive,
    archived: project.archived,
    repoId: project.repoId,
    boardId: project.boardId,
    placement: project.placement,
    surface: project.surface,
    needsYouCount: (project.needsYou ?? []).filter(
      (row) => row.status === "open" || row.status === "retrying",
    ).length,
  };
}

export function projectTeamName(project: Pick<ProjectDocument, "title" | "team">): string {
  return project.team?.name?.trim() || project.title;
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function clampProjectConcurrency(value: unknown): number {
  const n = num(value);
  if (n == null) return DEFAULT_PROJECT_MAX_CONCURRENT;
  return Math.max(1, Math.min(HARD_PROJECT_MAX_CONCURRENT, Math.round(n)));
}

export function parseProjectDocument(raw: unknown): ProjectDocument | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = str(value.id);
  const title = str(value.title);
  const createdAt = str(value.createdAt);
  const updatedAt = str(value.updatedAt);
  if (!id || !title || !createdAt || !updatedAt) return undefined;
  const memberIds = Array.isArray(value.memberIds)
    ? value.memberIds.filter((row): row is string => typeof row === "string" && Boolean(row.trim()))
    : [];
  const recipeId = isProjectStarter(value.recipeId) ? value.recipeId : undefined;
  const placement =
    value.placement === "worker" || value.placement === "local" ? value.placement : undefined;
  const runtime =
    value.runtime === "docker" || value.runtime === "host" || value.runtime === "vm"
      ? value.runtime
      : undefined;
  return {
    id,
    title,
    createdAt,
    updatedAt,
    goal: str(value.goal),
    recipeId,
    coordinatorSessionId: str(value.coordinatorSessionId),
    memberIds,
    groupChat: value.groupChat === true ? true : undefined,
    placement,
    backendId: str(value.backendId),
    namedEnvId: str(value.namedEnvId),
    repoId: str(value.repoId),
    boardId: str(value.boardId),
    runtime,
    maxUsd: num(value.maxUsd),
    maxConcurrentMembers: clampProjectConcurrency(value.maxConcurrentMembers),
    paused: value.paused === true ? true : undefined,
    keepAlive: value.keepAlive === true ? true : undefined,
    fleetWatch: parseFleetWatchMap(value.fleetWatch),
    archived: value.archived === true ? true : undefined,
    surface: value.surface === "swarm" || value.surface === "developer" ? value.surface : undefined,
    team:
      value.team && typeof value.team === "object"
        ? {
            name:
              typeof (value.team as Record<string, unknown>).name === "string"
                ? ((value.team as Record<string, unknown>).name as string).trim() || undefined
                : undefined,
            members: Array.isArray((value.team as Record<string, unknown>).members)
              ? ((value.team as Record<string, unknown>).members as unknown[]).filter(
                  (row): row is SwarmTeamMember => {
                    if (!row || typeof row !== "object") return false;
                    const member = row as Record<string, unknown>;
                    return (
                      typeof member.sessionId === "string" &&
                      typeof member.assignedAt === "string" &&
                      Array.isArray(member.capabilities) &&
                      typeof member.enabled === "boolean"
                    );
                  },
                )
              : [],
          }
        : undefined,
    needsYou: parseSwarmNeeds(value.needsYou),
    audit: Array.isArray(value.audit)
      ? value.audit.filter((row): row is SwarmAuditEvent =>
          Boolean(
            row &&
            typeof row === "object" &&
            typeof (row as Record<string, unknown>).id === "string" &&
            typeof (row as Record<string, unknown>).kind === "string" &&
            typeof (row as Record<string, unknown>).message === "string" &&
            typeof (row as Record<string, unknown>).createdAt === "string",
          ),
        )
      : undefined,
  };
}

/** Jail a context-relative path. Rejects absolute paths and `..`. */
export function projectContextPath(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/") || /^[a-zA-Z]:/.test(trimmed)) return undefined;
  const parts = trimmed.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === ".." || part === "~")) return undefined;
  return parts.join("/");
}

export function formatProjectContextIndex(files: ProjectContextEntry[]): string {
  if (!files.length) return "(empty project context)";
  return files.map((row) => `- ${row.path} (${row.bytes} bytes)`).join("\n");
}

export function formatProjectContextPrompt(input: {
  title: string;
  index?: string;
  files: ProjectContextEntry[];
  budget?: number;
}): string {
  const budget = input.budget ?? PROJECT_CONTEXT_PROMPT_BUDGET;
  const listing = formatProjectContextIndex(input.files);
  const index = (input.index ?? "").trim();
  const parts = [`Project: ${input.title}`, "Context files:", listing];
  if (index) parts.push("", "INDEX.md:", index);
  let text = parts.join("\n");
  if (text.length > budget) text = `${text.slice(0, budget - 1)}…`;
  return text;
}

export function liveMemberCount(
  sessions: Array<{ id: string; status?: string }>,
  memberIds: string[],
): number {
  const live = new Set(memberIds);
  return sessions.filter(
    (row) => live.has(row.id) && (row.status === "running" || row.status === "provisioning"),
  ).length;
}

export function projectMemberKind(kind?: string): ProjectMemberKind {
  if (kind === "review" || kind === "design" || kind === "game") return kind;
  return "agent";
}

/** Operational fleet columns. Ready-to-merge is CI-green open PRs. */
export const PROJECT_MEMBER_COLUMNS = [
  "needs_you",
  "working",
  "in_review",
  "ready_to_merge",
  "done",
] as const;
export type ProjectMemberColumn = (typeof PROJECT_MEMBER_COLUMNS)[number];

export const PROJECT_MEMBER_COLUMN_LABELS: Record<ProjectMemberColumn, string> = {
  needs_you: "Needs you",
  working: "Working",
  in_review: "In review",
  ready_to_merge: "Ready to merge",
  done: "Done",
};

/** First match wins: Needs you → Done → Ready to merge → In review → Working. */
export function projectMemberColumn(session: {
  status?: string;
  needsHuman?: string | null;
  pull?: { state?: string; checkState?: string } | null;
}): ProjectMemberColumn {
  if (
    Boolean(session.needsHuman?.trim()) ||
    session.status === "error" ||
    session.pull?.state === "closed"
  ) {
    return "needs_you";
  }
  if (session.pull?.state === "merged") return "done";
  if (session.pull?.state === "open" && session.pull.checkState === "success") {
    return "ready_to_merge";
  }
  if (session.pull?.state === "open" || session.pull?.state === "draft") return "in_review";
  return "working";
}

/** File-safe slug for context/rules/<slug>.md. */
export function projectRuleSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "rule";
}

export function isProjectMemberColumn(value: unknown): value is ProjectMemberColumn {
  return (PROJECT_MEMBER_COLUMNS as readonly string[]).includes(value as string);
}

/** Group members into stacked fleet columns in display order. */
export function projectMembersByColumn<T>(
  members: T[],
  columnOf: (member: T) => ProjectMemberColumn,
): Array<{ column: ProjectMemberColumn; label: string; members: T[] }> {
  const buckets: Record<ProjectMemberColumn, T[]> = {
    needs_you: [],
    working: [],
    in_review: [],
    ready_to_merge: [],
    done: [],
  };
  for (const member of members) {
    buckets[columnOf(member)].push(member);
  }
  return PROJECT_MEMBER_COLUMNS.map((column) => ({
    column,
    label: PROJECT_MEMBER_COLUMN_LABELS[column],
    members: buckets[column],
  }));
}
