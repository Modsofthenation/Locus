export const SWARM_NEED_STATUSES = [
  "open",
  "approved",
  "answered",
  "retrying",
  "cancelled",
  "taken_over",
  "resolved",
] as const;
export type SwarmNeedStatus = (typeof SWARM_NEED_STATUSES)[number];

export const SWARM_NEED_ACTIONS = ["approve", "answer", "retry", "cancel", "takeover"] as const;
export type SwarmNeedAction = (typeof SWARM_NEED_ACTIONS)[number];

export interface SwarmNeed {
  id: string;
  sessionId: string;
  teammateName: string;
  reason: string;
  status: SwarmNeedStatus;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  response?: string;
  resolvedAt?: string;
}

export interface SwarmTeamMember {
  sessionId: string;
  role?: string;
  capabilities: string[];
  enabled: boolean;
  assignedAt: string;
  lastSeenAt?: string;
}

export const SWARM_TEAM_STATUSES = ["idle", "directing", "needs_you", "paused"] as const;
export type SwarmTeamStatus = (typeof SWARM_TEAM_STATUSES)[number];

export const SWARM_TEAM_HANDOFF_STATUSES = ["queued", "accepted", "declined", "completed"] as const;
export type SwarmTeamHandoffStatus = (typeof SWARM_TEAM_HANDOFF_STATUSES)[number];

export const SWARM_TEAM_HANDOFF_ACTIONS = ["accept", "decline", "complete"] as const;
export type SwarmTeamHandoffAction = (typeof SWARM_TEAM_HANDOFF_ACTIONS)[number];

/** Durable work transfer between two named Swarm teams. */
export interface SwarmTeamHandoff {
  id: string;
  sourceTeamId: string;
  sourceTeamName: string;
  targetTeamId: string;
  targetTeamName: string;
  task: string;
  status: SwarmTeamHandoffStatus;
  createdAt: string;
  updatedAt: string;
  sourceSessionId?: string;
  targetSessionId?: string;
  response?: string;
}

export interface SwarmAuditEvent {
  id: string;
  kind: "need" | "team" | "routine" | "artifact";
  message: string;
  createdAt: string;
  actor?: string;
  sessionId?: string;
}

export function isSwarmNeedStatus(value: unknown): value is SwarmNeedStatus {
  return (SWARM_NEED_STATUSES as readonly string[]).includes(value as string);
}

export function isSwarmNeedAction(value: unknown): value is SwarmNeedAction {
  return (SWARM_NEED_ACTIONS as readonly string[]).includes(value as string);
}

export function isSwarmTeamHandoffStatus(value: unknown): value is SwarmTeamHandoffStatus {
  return (SWARM_TEAM_HANDOFF_STATUSES as readonly string[]).includes(value as string);
}

export function isSwarmTeamHandoffAction(value: unknown): value is SwarmTeamHandoffAction {
  return (SWARM_TEAM_HANDOFF_ACTIONS as readonly string[]).includes(value as string);
}

export function parseSwarmTeamHandoff(raw: unknown): SwarmTeamHandoff | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const sourceTeamId = typeof value.sourceTeamId === "string" ? value.sourceTeamId.trim() : "";
  const sourceTeamName =
    typeof value.sourceTeamName === "string" ? value.sourceTeamName.trim() : "";
  const targetTeamId = typeof value.targetTeamId === "string" ? value.targetTeamId.trim() : "";
  const targetTeamName =
    typeof value.targetTeamName === "string" ? value.targetTeamName.trim() : "";
  const task = typeof value.task === "string" ? value.task.trim() : "";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : "";
  if (
    !id ||
    !sourceTeamId ||
    !sourceTeamName ||
    !targetTeamId ||
    !targetTeamName ||
    !task ||
    !createdAt ||
    !updatedAt
  ) {
    return undefined;
  }
  return {
    id,
    sourceTeamId,
    sourceTeamName,
    targetTeamId,
    targetTeamName,
    task,
    status: isSwarmTeamHandoffStatus(value.status) ? value.status : "queued",
    createdAt,
    updatedAt,
    sourceSessionId:
      typeof value.sourceSessionId === "string"
        ? value.sourceSessionId.trim() || undefined
        : undefined,
    targetSessionId:
      typeof value.targetSessionId === "string"
        ? value.targetSessionId.trim() || undefined
        : undefined,
    response:
      typeof value.response === "string" && value.response.trim()
        ? value.response.trim()
        : undefined,
  };
}

export function parseSwarmTeamHandoffs(raw: unknown): SwarmTeamHandoff[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseSwarmTeamHandoff).filter((row): row is SwarmTeamHandoff => Boolean(row));
}

export function pendingSwarmTeamHandoffs(
  handoffs: SwarmTeamHandoff[] | undefined,
): SwarmTeamHandoff[] {
  return (handoffs ?? []).filter((row) => row.status === "queued" || row.status === "accepted");
}

export function parseSwarmNeed(raw: unknown): SwarmNeed | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const sessionId = typeof value.sessionId === "string" ? value.sessionId.trim() : "";
  const teammateName = typeof value.teammateName === "string" ? value.teammateName.trim() : "";
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : "";
  if (!id || !sessionId || !teammateName || !reason || !createdAt || !updatedAt) return undefined;
  return {
    id,
    sessionId,
    teammateName,
    reason,
    status: isSwarmNeedStatus(value.status) ? value.status : "open",
    createdAt,
    updatedAt,
    attempts:
      typeof value.attempts === "number" && value.attempts >= 0 ? Math.floor(value.attempts) : 0,
    response:
      typeof value.response === "string" && value.response.trim()
        ? value.response.trim()
        : undefined,
    resolvedAt: typeof value.resolvedAt === "string" ? value.resolvedAt : undefined,
  };
}

export function parseSwarmNeeds(raw: unknown): SwarmNeed[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseSwarmNeed).filter((row): row is SwarmNeed => Boolean(row));
}

export function pendingSwarmNeeds(needs: SwarmNeed[] | undefined): SwarmNeed[] {
  return (needs ?? []).filter((row) => row.status === "open" || row.status === "retrying");
}

export function needDedupeKey(sessionId: string, reason: string): string {
  return `${sessionId.trim()}::${reason.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export function boundedContextText(input: {
  title?: string;
  index: string;
  files: Array<{ path: string; bytes: number }>;
  summaries?: Array<{ path: string; content: string }>;
  budget: number;
}): string {
  const budget = Math.max(256, Math.floor(input.budget));
  const preferred = input.files.slice().sort((a, b) => {
    const rank = (path: string) =>
      path === "INDEX.md"
        ? 0
        : path === "preferences.md"
          ? 1
          : path.startsWith("playbooks/")
            ? 2
            : 3;
    return rank(a.path) - rank(b.path) || a.path.localeCompare(b.path);
  });
  const lines = ["Context files:"];
  for (const file of preferred) {
    const line = `- ${file.path} (${file.bytes} bytes)`;
    if ([...lines, line].join("\n").length > budget) break;
    lines.push(line);
  }
  const prefix = [
    input.title?.trim() ? `Project: ${input.title.trim()}` : "Project context",
    lines.join("\n"),
  ];
  const index = input.index.trim();
  if (index) prefix.push("", "INDEX.md:", index);
  const summaries = new Map((input.summaries ?? []).map((row) => [row.path, row.content.trim()]));
  for (const file of preferred) {
    const content = summaries.get(file.path);
    if (!content || file.path === "INDEX.md") continue;
    const excerpt = content.length > 700 ? `${content.slice(0, 699)}…` : content;
    const next = `${file.path}:\n${excerpt}`;
    if ([...prefix, next].join("\n\n").length > budget) break;
    prefix.push("", next);
  }
  const text = prefix.join("\n");
  return text.length <= budget ? text : `${text.slice(0, budget - 1)}…`;
}
