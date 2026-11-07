import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_DOCKER_IMAGE,
  MAX_GROUP_CHAT_PARTICIPANTS,
  MIN_GROUP_CHAT_PARTICIPANTS,
  PROJECT_CONTEXT_PROMPT_BUDGET,
  GROUP_CHAT_CONTEXT_PROMPT_BUDGET,
  GROUP_CHAT_TEAM_EVENT_FOLD_AT,
  GROUP_CHAT_TEAM_EVENT_FOLD_BATCH,
  GROUP_CHAT_TEAM_EVENT_SUMMARY_CHARS,
  PROJECT_CHAT_TOOLS,
  GROUP_CHAT_TOOLS,
  applySubscribe,
  boundedContextText,
  clampProjectConcurrency,
  estimateUsd,
  formatGroupChatThread,
  formatProjectContextIndex,
  groupChatMentionPrompt,
  isProjectMemberKind,
  isProjectSession,
  isProjectStarter,
  isProjectToolName,
  lastAssistantText,
  liveMemberCount,
  parseAgentPlacement,
  parseProductMode,
  parseProjectDocument,
  parseSessionSurface,
  parseSwarmTeamHandoff,
  playbookForStarter,
  projectTeamName,
  projectContextPath,
  projectMemberColumn,
  projectRuleSlug,
  projectSummary,
  projectTitleFromStarter,
  decideFleetWake,
  projectKeepsControlPlane,
  isSwarmNeedAction,
  isSwarmTeamHandoffAction,
  needDedupeKey,
  pendingSwarmNeeds,
  resolveUsageRates,
  seedContextFiles,
  sessionAvatarAccessory,
  sessionAvatarId,
  sessionAvatarPose,
  sessionDisplayName,
  sessionKind,
  sessionRuntime,
  surfaceForProductMode,
  teammateMentionAliases,
  teammateMentionHandle,
  workerComputeUsd,
  type AgentPlacement,
  type AgentRuntime,
  type AgentSession,
  type ChatMessage,
  type CreateProjectInput,
  type CreateSessionInput,
  type PatchProjectInput,
  type ProjectContextEntry,
  type ProjectDocument,
  type ProjectSummary,
  type SessionPull,
  type SessionSurface,
  type TeamEventKind,
  type TeamSpeaker,
  type SwarmNeedAction,
  type SwarmAuditEvent,
  type SwarmNeed,
  type SwarmTeamHandoff,
  type SwarmTeamHandoffAction,
  type SwarmTeamStatus,
} from "@locus/shared";
import type { ToolResult } from "@locus/guest-agent";
import { replaceFile } from "../core/atomic.js";
import type { Hub } from "../core/hub.js";
import type { JsonStore } from "../core/store.js";
import type { RepoService } from "../git/repos.js";
import type { IncomingAttachment } from "../media/attachments.js";
import type { SessionService } from "../session/sessions.js";

function stamp(date = new Date()): string {
  return date.toISOString();
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function teamSpeakerFrom(session: AgentSession): TeamSpeaker {
  return {
    sessionId: session.id,
    displayName: sessionDisplayName(session),
    avatarId: sessionAvatarId(session),
    avatarPose: sessionAvatarPose(session),
    avatarAccessory: sessionAvatarAccessory(session),
    avatarAccent: session.persona?.avatarAccent,
  };
}

/** Skip repeated forge hits when the coordinator polls project_get. */
const PULL_REFRESH_DEBOUNCE_MS = 30_000;
const MAX_PROJECT_AUDIT_EVENTS = 100;
const MAX_TEAM_HANDOFFS = 200;
const MAX_TEAM_NAME_LENGTH = 80;

const GROUP_CHAT_PLAYBOOK = `You are the coordinator for a Swarm group chat.

The operator is in a shared thread with the listed teammates. When they @name someone,
that teammate owns the reply — do not also answer. @everyone is routed to every
teammate automatically — do not also answer. With no mention, pick a single owner
and team_message them. Do not fan out duplicate work. Ask before external actions.

The group transcript is the source of truth; teammate completions appear here. Durable
notes live in context/ — use project_context_* instead of re-pasting setup.`;

function groupChatRosterLines(rows: AgentSession[], memberIds: string[]): string {
  return rows
    .filter((row) => memberIds.includes(row.id))
    .map(
      (row) =>
        `- @${teammateMentionHandle(sessionDisplayName(row))}${row.persona?.hubRole ? ` (${row.persona.hubRole})` : ""}`,
    )
    .join("\n");
}

function groupChatPlaybookText(roster: string): string {
  return `${GROUP_CHAT_PLAYBOOK}\n\nParticipants:\n${roster}`;
}

function sameStringList(a: string[] | undefined, b: readonly string[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((name, i) => name === b[i]);
}

function groupMentionAliases(row: AgentSession): string[] {
  return teammateMentionAliases(row);
}

function groupMentionedMembers(
  content: string,
  members: AgentSession[],
): {
  everyone: boolean;
  targets: AgentSession[];
} {
  const tokens = [...content.matchAll(/@([a-z0-9][a-z0-9._-]*)/gi)].map((match) =>
    match[1]!.toLowerCase(),
  );
  const everyone = tokens.includes("everyone");
  const targets = members.filter((row) => {
    const aliases = groupMentionAliases(row);
    return tokens.some((token) => aliases.includes(token));
  });
  return { everyone, targets: everyone ? members : targets };
}

export class ProjectService {
  private readonly pullRefreshAt = new Map<string, number>();
  private readonly wakeAt = new Map<string, number>();

  constructor(
    private readonly store: JsonStore,
    private readonly hub: Hub,
    private readonly sessions: SessionService,
    private readonly repos?: RepoService,
    private readonly opts?: { wakeDebounceMs?: number },
  ) {}

  private root(): string {
    return join(this.store.dataDir, "projects");
  }

  private dir(id: string): string {
    return join(this.root(), id);
  }

  private path(id: string): string {
    return join(this.dir(id), "project.json");
  }

  private contextDir(id: string): string {
    return join(this.dir(id), "context");
  }

  private handoffRoot(): string {
    return join(this.store.dataDir, "swarm-handoffs");
  }

  private handoffPath(id: string): string {
    return join(this.handoffRoot(), id, "handoff.json");
  }

  private async readHandoff(id: string): Promise<SwarmTeamHandoff | undefined> {
    const key = id.trim();
    if (!key || key.includes("..") || key.includes("/") || key.includes("\\")) return undefined;
    try {
      return parseSwarmTeamHandoff(JSON.parse(await readFile(this.handoffPath(key), "utf8")));
    } catch {
      return undefined;
    }
  }

  private async writeHandoff(handoff: SwarmTeamHandoff): Promise<SwarmTeamHandoff> {
    await mkdir(dirname(this.handoffPath(handoff.id)), { recursive: true, mode: 0o700 });
    await replaceFile(this.handoffPath(handoff.id), JSON.stringify(handoff, null, 2));
    return handoff;
  }

  private async allHandoffs(): Promise<SwarmTeamHandoff[]> {
    await mkdir(this.handoffRoot(), { recursive: true, mode: 0o700 });
    let names: string[] = [];
    try {
      names = await readdir(this.handoffRoot());
    } catch {
      return [];
    }
    const rows = await Promise.all(names.map((name) => this.readHandoff(name)));
    return rows
      .filter((row): row is SwarmTeamHandoff => Boolean(row))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async assertUniqueTeamName(
    name: string,
    surface: SessionSurface | undefined,
    exceptId?: string,
  ): Promise<void> {
    if (surface !== "swarm") return;
    const trimmed = name.trim();
    if (trimmed.length > MAX_TEAM_NAME_LENGTH) {
      throw new Error(`Team name must be ${MAX_TEAM_NAME_LENGTH} characters or fewer`);
    }
    const normalized = trimmed.toLocaleLowerCase();
    if (!normalized) throw new Error("Team name is required");
    const conflict = (await this.list()).find(
      (row) =>
        row.surface === "swarm" &&
        row.id !== exceptId &&
        (row.teamName ?? row.title).trim().toLocaleLowerCase() === normalized,
    );
    if (conflict) throw new Error(`A Swarm team named "${trimmed}" already exists`);
  }

  private async chooseTeamName(
    base: string,
    surface: SessionSurface | undefined,
    explicit: boolean,
  ): Promise<string> {
    const candidate = base.trim() || "Team";
    if (surface !== "swarm") return candidate;
    if (candidate.length > MAX_TEAM_NAME_LENGTH) {
      throw new Error(`Team name must be ${MAX_TEAM_NAME_LENGTH} characters or fewer`);
    }
    const existing = await this.list();
    const taken = new Set(
      existing
        .filter((row) => row.surface === "swarm")
        .map((row) => (row.teamName ?? row.title).trim().toLocaleLowerCase()),
    );
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
    if (explicit) throw new Error(`A Swarm team named "${candidate}" already exists`);
    let suffix = 2;
    while (taken.has(`${candidate} ${suffix}`.toLocaleLowerCase())) suffix += 1;
    return `${candidate} ${suffix}`;
  }

  private async teamStatus(project: ProjectDocument): Promise<SwarmTeamStatus> {
    if (project.paused || (await this.isPaused(project.id))) return "paused";
    if (pendingSwarmNeeds(project.needsYou).length > 0) return "needs_you";
    if (this.sessions && project.coordinatorSessionId) {
      const coordinator = await this.sessions.get(project.coordinatorSessionId);
      if (coordinator?.needsHuman?.trim()) return "needs_you";
      if (coordinator?.status === "running" || coordinator?.status === "provisioning") {
        return "directing";
      }
    }
    return "idle";
  }

  async list(): Promise<ProjectSummary[]> {
    await mkdir(this.root(), { recursive: true, mode: 0o700 });
    let names: string[] = [];
    try {
      names = await readdir(this.root());
    } catch {
      return [];
    }
    const rows: ProjectSummary[] = [];
    for (const name of names) {
      const project = await this.get(name);
      if (project && !project.archived) {
        const summary = projectSummary(project);
        if (project.surface === "swarm") summary.teamStatus = await this.teamStatus(project);
        rows.push(summary);
      }
    }
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return rows;
  }

  async get(id: string): Promise<ProjectDocument | undefined> {
    const key = id.trim();
    if (!key || key.includes("..") || key.includes("/") || key.includes("\\")) return undefined;
    try {
      const raw = JSON.parse(await readFile(this.path(key), "utf8")) as unknown;
      return parseProjectDocument(raw);
    } catch {
      return undefined;
    }
  }

  async require(id: string): Promise<ProjectDocument> {
    const project = await this.get(id);
    if (!project) throw new Error("Project not found");
    return project;
  }

  async groupForSession(sessionId: string): Promise<ProjectDocument | undefined> {
    const key = sessionId.trim();
    if (!key) return undefined;
    await mkdir(this.root(), { recursive: true, mode: 0o700 });
    let names: string[] = [];
    try {
      names = await readdir(this.root());
    } catch {
      return undefined;
    }
    for (const name of names) {
      const project = await this.get(name);
      if (project?.groupChat && !project.archived && project.memberIds.includes(key)) {
        return project;
      }
    }
    return undefined;
  }

  private async validateGroupMembers(memberIds: string[]): Promise<string[]> {
    const requested = [...new Set(memberIds.filter((id) => typeof id === "string" && id.trim()))];
    if (
      requested.length < MIN_GROUP_CHAT_PARTICIPANTS ||
      requested.length > MAX_GROUP_CHAT_PARTICIPANTS
    ) {
      throw new Error(
        `Choose ${MIN_GROUP_CHAT_PARTICIPANTS}-${MAX_GROUP_CHAT_PARTICIPANTS} teammates for a group chat.`,
      );
    }
    const available = new Set(
      ((await this.sessions?.list()) ?? [])
        .filter(
          (row) =>
            parseSessionSurface(row.surface) === "swarm" &&
            !row.archived &&
            sessionKind(row) === "agent",
        )
        .map((row) => row.id),
    );
    if (requested.some((id) => !available.has(id))) {
      throw new Error("Group chats can only include active Swarm teammates.");
    }
    return requested;
  }

  async isPaused(id: string | undefined): Promise<boolean> {
    if (!id) return false;
    const project = await this.get(id);
    if (!project) return false;
    if (project.paused) return true;
    if (project.maxUsd == null) return false;
    return (await this.spendUsd(project)) >= project.maxUsd;
  }

  private async write(project: ProjectDocument): Promise<ProjectDocument> {
    await mkdir(this.dir(project.id), { recursive: true, mode: 0o700 });
    const next = { ...project, updatedAt: stamp() };
    await replaceFile(this.path(next.id), JSON.stringify(next, null, 2));
    this.hub.broadcast({ type: "project.updated", project: next });
    return next;
  }

  private async audit(
    project: ProjectDocument,
    input: Omit<SwarmAuditEvent, "id" | "createdAt">,
  ): Promise<ProjectDocument> {
    const event: SwarmAuditEvent = { ...input, id: randomUUID(), createdAt: stamp() };
    project.audit = [...(project.audit ?? []), event].slice(-MAX_PROJECT_AUDIT_EVENTS);
    return this.write(project);
  }

  async create(input: CreateProjectInput = {}): Promise<ProjectDocument> {
    const starter = isProjectStarter(input.starter) ? input.starter : "blank";
    const requestedTitle = input.title?.trim() || input.teamName?.trim();
    const title = requestedTitle || projectTitleFromStarter(starter);
    const config = await this.store.loadConfig();
    const surface: SessionSurface =
      input.surface === "swarm" || input.surface === "developer"
        ? input.surface
        : surfaceForProductMode(parseProductMode(config.productMode));
    const groupChat = input.groupChat === true;
    let memberIds: string[] = [];
    if (groupChat) {
      if (surface !== "swarm") throw new Error("Group chats are only available in Locus Swarm.");
      memberIds = await this.validateGroupMembers(input.participantIds ?? []);
    }
    const teamName = await this.chooseTeamName(
      input.teamName?.trim() || title,
      surface,
      Boolean(input.teamName?.trim() || input.title?.trim()),
    );
    const project: ProjectDocument = {
      id: randomUUID(),
      title: requestedTitle || teamName,
      createdAt: stamp(),
      updatedAt: stamp(),
      goal: input.prompt?.trim() || undefined,
      recipeId: starter,
      memberIds,
      groupChat: groupChat || undefined,
      placement: input.placement,
      backendId: input.backendId?.trim() || undefined,
      namedEnvId: input.namedEnvId?.trim() || undefined,
      repoId: input.repoId?.trim() || undefined,
      boardId: input.boardId?.trim() || undefined,
      runtime: input.runtime,
      maxUsd: typeof input.maxUsd === "number" && input.maxUsd > 0 ? input.maxUsd : undefined,
      maxConcurrentMembers: clampProjectConcurrency(input.maxConcurrentMembers),
      surface,
      team: { name: teamName, members: [] },
      needsYou: [],
      audit: [],
    };
    const saved = await this.write(project);
    await mkdir(this.contextDir(saved.id), { recursive: true, mode: 0o700 });
    for (const file of seedContextFiles(starter, saved.title, input.prompt)) {
      await this.writeContextFile(saved.id, file.path, file.content);
    }
    const prompt = input.prompt?.trim();
    if (prompt) {
      await this.ensureChat(saved.id, prompt);
      return (await this.get(saved.id)) ?? saved;
    }
    return saved;
  }

  async duplicate(id: string): Promise<ProjectDocument> {
    const src = await this.require(id);
    const title = `${src.title} copy`;
    const teamName = await this.chooseTeamName(
      `${(src.team?.name ?? src.title).trim() || title} copy`,
      src.surface,
      false,
    );
    const copy: ProjectDocument = {
      id: randomUUID(),
      title,
      createdAt: stamp(),
      updatedAt: stamp(),
      goal: src.goal,
      recipeId: src.recipeId,
      memberIds: [],
      placement: src.placement,
      backendId: src.backendId,
      namedEnvId: src.namedEnvId,
      repoId: src.repoId,
      boardId: src.boardId,
      runtime: src.runtime,
      maxUsd: src.maxUsd,
      maxConcurrentMembers: src.maxConcurrentMembers,
      surface: src.surface,
      team: { name: teamName, members: [] },
      needsYou: [],
      audit: [],
    };
    const saved = await this.write(copy);
    try {
      await cp(this.contextDir(id), this.contextDir(saved.id), { recursive: true });
    } catch {
      await mkdir(this.contextDir(saved.id), { recursive: true, mode: 0o700 });
    }
    return saved;
  }

  async patch(id: string, input: PatchProjectInput): Promise<ProjectDocument> {
    const project = await this.require(id);
    const previousTeamName = projectTeamName(project);
    if (input.teamName !== undefined) {
      const nextName =
        input.teamName === null || !input.teamName.trim()
          ? input.title?.trim() || project.title
          : input.teamName.trim();
      await this.assertUniqueTeamName(nextName, project.surface, project.id);
    }
    if (typeof input.title === "string" && input.title.trim()) project.title = input.title.trim();
    if (input.goal === null) delete project.goal;
    else if (typeof input.goal === "string") project.goal = input.goal.trim() || undefined;
    if (input.coordinatorSessionId === null) delete project.coordinatorSessionId;
    else if (typeof input.coordinatorSessionId === "string" && input.coordinatorSessionId.trim())
      project.coordinatorSessionId = input.coordinatorSessionId.trim();
    if (Array.isArray(input.memberIds)) {
      const requested = input.memberIds.filter((row) => typeof row === "string" && row.trim());
      if (project.groupChat) {
        project.memberIds = await this.validateGroupMembers(requested);
      } else if (this.sessions) {
        const sessionRows = await this.sessions.list();
        const allowed = new Set(
          sessionRows
            .filter(
              (row) =>
                row.projectId === project.id &&
                (!project.surface || parseSessionSurface(row.surface) === project.surface),
            )
            .map((row) => row.id),
        );
        project.memberIds = requested.filter((row) => allowed.has(row));
      } else {
        project.memberIds = requested;
      }
    }
    if (input.placement === null) delete project.placement;
    else if (input.placement === "local" || input.placement === "worker")
      project.placement = input.placement;
    if (input.backendId === null) delete project.backendId;
    else if (typeof input.backendId === "string")
      project.backendId = input.backendId.trim() || undefined;
    if (input.namedEnvId === null) delete project.namedEnvId;
    else if (typeof input.namedEnvId === "string")
      project.namedEnvId = input.namedEnvId.trim() || undefined;
    if (input.repoId === null) delete project.repoId;
    else if (typeof input.repoId === "string") project.repoId = input.repoId.trim() || undefined;
    if (input.boardId === null) delete project.boardId;
    else if (typeof input.boardId === "string") project.boardId = input.boardId.trim() || undefined;
    if (input.runtime === null) delete project.runtime;
    else if (input.runtime === "docker" || input.runtime === "host" || input.runtime === "vm")
      project.runtime = input.runtime;
    if (input.maxUsd === null) delete project.maxUsd;
    else if (typeof input.maxUsd === "number")
      project.maxUsd = input.maxUsd > 0 ? input.maxUsd : undefined;
    if (input.maxConcurrentMembers != null)
      project.maxConcurrentMembers = clampProjectConcurrency(input.maxConcurrentMembers);
    if (typeof input.paused === "boolean") project.paused = input.paused || undefined;
    if (typeof input.keepAlive === "boolean") project.keepAlive = input.keepAlive || undefined;
    if (typeof input.archived === "boolean") project.archived = input.archived || undefined;
    if (input.teamName === null) {
      if (project.team) delete project.team.name;
    } else if (typeof input.teamName === "string") {
      project.team = {
        ...(project.team ?? { members: [] }),
        name: input.teamName.trim() || undefined,
      };
    }
    if (Array.isArray(input.teamMembers)) {
      const validIds = new Set(project.memberIds);
      project.team = {
        ...(project.team ?? { members: [] }),
        members: input.teamMembers.filter((member) => validIds.has(member.sessionId)),
      };
    }
    const saved = await this.write(project);
    const nextName = projectTeamName(saved);
    if (this.sessions && saved.coordinatorSessionId && nextName && nextName !== previousTeamName) {
      try {
        await this.sessions.patchMeta(saved.coordinatorSessionId, { title: nextName });
      } catch {
        /* Coordinator may already be deleted. */
      }
    }
    return saved;
  }

  /** Add a Swarm session to a named team's roster. No-op for missing or non-swarm projects. */
  async attachSwarmMember(input: {
    sessionId: string;
    projectId: string;
    role?: string;
  }): Promise<void> {
    const project = await this.get(input.projectId);
    if (!project || project.surface !== "swarm") return;
    if (project.coordinatorSessionId === input.sessionId) return;
    if (project.memberIds.includes(input.sessionId)) return;
    if (this.sessions) {
      const session = await this.sessions.get(input.sessionId);
      if (!session || isProjectSession(session)) return;
      if (parseSessionSurface(session.surface) !== "swarm") return;
      if (session.projectId !== project.id) {
        await this.sessions.assignProject(session.id, project.id);
      }
    }
    const role = input.role?.trim() || undefined;
    const now = stamp();
    await this.patch(project.id, {
      memberIds: [...project.memberIds, input.sessionId],
      teamMembers: [
        ...(project.team?.members ?? []),
        {
          sessionId: input.sessionId,
          role,
          capabilities: [],
          enabled: true,
          assignedAt: now,
          lastSeenAt: now,
        },
      ],
    });
  }

  /**
   * Attach an existing Swarm teammate to a named team. Moves them off a previous
   * team when `session.projectId` is already set.
   */
  async enrollExistingMember(
    projectId: string,
    sessionId: string,
  ): Promise<{ project: ProjectDocument; session: AgentSession }> {
    if (!this.sessions) throw new Error("Sessions unavailable");
    const project = await this.require(projectId);
    if (project.surface !== "swarm") throw new Error("Only Swarm teams can enroll teammates");
    const session = await this.sessions.get(sessionId.trim());
    if (!session) throw new Error("Teammate not found");
    if (session.archived) throw new Error("Archived teammates cannot join a team");
    if (isProjectSession(session)) throw new Error("The team coordinator cannot join as a member");
    if (parseSessionSurface(session.surface) !== "swarm") {
      throw new Error("Only Swarm teammates can join a team");
    }
    if (project.coordinatorSessionId === session.id) {
      return { project, session };
    }
    if (project.memberIds.includes(session.id) && session.projectId === project.id) {
      return { project, session };
    }
    if (session.projectId && session.projectId !== project.id) {
      const previous = await this.get(session.projectId);
      if (previous?.coordinatorSessionId === session.id) {
        throw new Error("The team coordinator cannot move to another team");
      }
      if (previous) {
        await this.patch(previous.id, {
          memberIds: previous.memberIds.filter((id) => id !== session.id),
          teamMembers: (previous.team?.members ?? []).filter(
            (member) => member.sessionId !== session.id,
          ),
        });
      }
    }
    await this.attachSwarmMember({
      sessionId: session.id,
      projectId: project.id,
      role: session.persona?.hubRole,
    });
    const enrolled = await this.require(project.id);
    const live = await this.sessions.get(session.id);
    if (!live) throw new Error("Teammate not found");
    if (!enrolled.memberIds.includes(live.id) || live.projectId !== enrolled.id) {
      throw new Error("Could not add teammate to this team");
    }
    return { project: enrolled, session: live };
  }

  async remove(id: string): Promise<void> {
    const project = await this.get(id);
    if (!project) return;
    const handoffs = await this.allHandoffs();
    await Promise.all(
      handoffs
        .filter((handoff) => handoff.sourceTeamId === id || handoff.targetTeamId === id)
        .map((handoff) =>
          rm(dirname(this.handoffPath(handoff.id)), { recursive: true, force: true }),
        ),
    );
    await rm(this.dir(id), { recursive: true, force: true });
    this.hub.broadcast({ type: "project.deleted", id });
  }

  async listContext(id: string): Promise<ProjectContextEntry[]> {
    await this.require(id);
    return this.walkContext(this.contextDir(id), "");
  }

  async readContext(id: string, rawPath: string): Promise<string> {
    await this.require(id);
    const rel = projectContextPath(rawPath);
    if (!rel) throw new Error("Invalid context path");
    const file = join(this.contextDir(id), rel);
    try {
      return await readFile(file, "utf8");
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code === "ENOENT") throw new Error("Context file not found");
      throw new Error("Could not read context file");
    }
  }

  async writeContextFile(id: string, rawPath: string, content: string): Promise<string> {
    await this.require(id);
    const rel = projectContextPath(rawPath);
    if (!rel) throw new Error("Invalid context path");
    const file = join(this.contextDir(id), rel);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, content, "utf8");
    return rel;
  }

  async deleteContext(id: string, rawPath: string): Promise<void> {
    const rel = projectContextPath(rawPath);
    if (!rel) throw new Error("Invalid context path");
    await rm(join(this.contextDir(id), rel), { force: true });
  }

  async contextPrompt(id: string): Promise<string> {
    const project = await this.require(id);
    const files = await this.listContext(id);
    let index = "";
    try {
      index = await this.readContext(id, "INDEX.md");
    } catch {
      /* optional */
    }
    const summaries: Array<{ path: string; content: string }> = [];
    for (const file of files.filter((row) => row.path !== "INDEX.md").slice(0, 6)) {
      try {
        summaries.push({ path: file.path, content: await this.readContext(id, file.path) });
      } catch {
        /* an individual note may disappear while a member is writing */
      }
    }
    return boundedContextText({
      title: project.title,
      index,
      files,
      summaries,
      budget: project.groupChat ? GROUP_CHAT_CONTEXT_PROMPT_BUDGET : PROJECT_CONTEXT_PROMPT_BUDGET,
    });
  }

  private async walkContext(dir: string, prefix: string): Promise<ProjectContextEntry[]> {
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const rows: ProjectContextEntry[] = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      const full = join(dir, name);
      const info = await stat(full);
      if (info.isDirectory()) {
        rows.push(...(await this.walkContext(full, rel)));
      } else if (info.isFile()) {
        rows.push({ path: rel, bytes: info.size });
      }
    }
    rows.sort((a, b) => a.path.localeCompare(b.path));
    return rows;
  }

  private async defaultCreateFields(): Promise<
    Pick<CreateSessionInput, "os" | "templateId" | "providerId" | "model">
  > {
    const config = await this.store.loadConfig();
    const template =
      config.templates.find((row) => row.os === "ubuntu") ??
      config.templates.find((row) => !row.os.startsWith("windows")) ??
      config.templates[0];
    const provider = config.providers[0];
    if (!template || !provider) throw new Error("Finish setup before running a project");
    return {
      os: template.os,
      templateId: template.id,
      providerId: provider.id,
      model: provider.defaultModel || provider.models[0] || "mock",
    };
  }

  /**
   * Append a structured handoff / status note to the coordinator transcript
   * (Swarm multi-speaker team thread).
   */
  async appendTeamEvent(
    coordinatorSessionId: string,
    input: {
      content: string;
      speaker?: TeamSpeaker;
      teamEvent: TeamEventKind;
    },
  ): Promise<void> {
    if (!this.sessions) return;
    const content = input.content.trim();
    if (!content) return;
    const current = await this.sessions.get(coordinatorSessionId);
    const duplicate = current?.messages.some(
      (message) =>
        message.teamEvent === input.teamEvent &&
        message.speaker?.sessionId === input.speaker?.sessionId &&
        message.content.trim() === content &&
        Date.now() - Date.parse(message.createdAt) < 2 * 60 * 1000,
    );
    if (duplicate) return;
    const teamMessages = current?.messages.filter((message) => message.teamEvent) ?? [];
    const groupChat = Boolean(current?.projectId && (await this.get(current.projectId))?.groupChat);
    const foldAt = groupChat ? GROUP_CHAT_TEAM_EVENT_FOLD_AT : 80;
    const foldBatch = groupChat ? GROUP_CHAT_TEAM_EVENT_FOLD_BATCH : 40;
    const summaryCap = groupChat ? GROUP_CHAT_TEAM_EVENT_SUMMARY_CHARS : 4_000;
    if (teamMessages.length >= foldAt) {
      const folded = teamMessages.slice(0, foldBatch);
      const summary: ChatMessage = {
        id: randomUUID(),
        role: "system",
        content: `Earlier team updates (${folded.length}):\n${folded
          .map((message) => message.content.trim())
          .filter(Boolean)
          .join("\n")
          .slice(0, summaryCap)}`,
        compact: { dropped: folded.length, source: "heuristic" },
        createdAt: stamp(),
      };
      const foldedIds = new Set(folded.map((message) => message.id));
      const saved = await this.store.mutateSession(coordinatorSessionId, (session) => {
        session.messages = [
          ...session.messages.filter((message) => !foldedIds.has(message.id)),
          summary,
        ];
      });
      if (saved) this.hub.broadcast({ type: "session.updated", session: saved });
    }
    await this.sessions.appendMessage(coordinatorSessionId, {
      id: randomUUID(),
      role: "assistant",
      content,
      speaker: input.speaker,
      teamEvent: input.teamEvent,
      createdAt: stamp(),
    });
  }

  /** Relay a member `needsHuman` gate into the coordinator team thread. */
  async relayMemberNeedsHuman(memberId: string, reason: string): Promise<void> {
    if (!this.sessions) return;
    const session = await this.sessions.get(memberId);
    if (!session?.projectId) return;
    const project = await this.get(session.projectId);
    if (!project?.coordinatorSessionId || project.coordinatorSessionId === memberId) return;
    const detail = reason.trim() || "Needs you";
    const key = needDedupeKey(memberId, detail);
    const existing = (project.needsYou ?? []).find(
      (need) =>
        (need.status === "open" || need.status === "retrying") &&
        needDedupeKey(need.sessionId, need.reason) === key,
    );
    if (existing) return;
    const now = stamp();
    const need: SwarmNeed = {
      id: randomUUID(),
      sessionId: memberId,
      teammateName: sessionDisplayName(session),
      reason: detail,
      status: "open",
      createdAt: now,
      updatedAt: now,
      attempts: 0,
    };
    project.needsYou = [...(project.needsYou ?? []), need].slice(-100);
    await this.audit(project, {
      kind: "need",
      message: `${need.teammateName} needs you: ${detail}`,
      sessionId: memberId,
    });
    await this.appendTeamEvent(project.coordinatorSessionId, {
      content: `${sessionDisplayName(session)}: ${detail}`,
      speaker: teamSpeakerFrom(session),
      teamEvent: "needs_you",
    }).catch(() => undefined);
  }

  async actOnNeed(
    projectId: string,
    needId: string,
    action: SwarmNeedAction,
    response?: string,
  ): Promise<ProjectDocument> {
    if (!isSwarmNeedAction(action)) throw new Error("Unknown Needs-you action");
    const project = await this.require(projectId);
    const need = (project.needsYou ?? []).find((row) => row.id === needId);
    if (!need) throw new Error("Needs-you item not found");
    if (need.status !== "open" && need.status !== "retrying") {
      throw new Error("Needs-you item is already resolved");
    }
    if (!this.sessions) throw new Error("Sessions unavailable");
    const session = await this.sessions.get(need.sessionId);
    if (!session || session.projectId !== project.id) throw new Error("Teammate not found");
    const text = response?.trim();
    if (action === "answer" && !text) throw new Error("An answer is required");
    const status =
      action === "approve"
        ? "approved"
        : action === "answer"
          ? "answered"
          : action === "retry"
            ? "retrying"
            : action === "cancel"
              ? "cancelled"
              : "taken_over";
    const now = stamp();
    project.needsYou = (project.needsYou ?? []).map((row) =>
      row.id === need.id
        ? {
            ...row,
            status,
            updatedAt: now,
            attempts: row.attempts + (action === "retry" ? 1 : 0),
            response: text ?? row.response,
            resolvedAt: action === "retry" ? undefined : now,
          }
        : row,
    );
    const saved = await this.audit(project, {
      kind: "need",
      message: `${action} · ${need.teammateName}: ${need.reason}`,
      sessionId: need.sessionId,
      actor: "operator",
    });
    if (action === "cancel" || action === "takeover") await this.sessions.abortChat(session.id);
    await this.sessions.patchMeta(session.id, { needsHuman: null });
    if (action === "answer") {
      await this.sessions.sendChat(session.id, `Operator answer:\n${text}`);
    } else if (action === "approve" || action === "retry") {
      await this.sessions.sendChat(
        session.id,
        action === "approve"
          ? "The operator approved this. Retry the blocked operation now and report the result."
          : "Retry the blocked operation now and report the result.",
      );
    }
    return (await this.get(saved.id)) ?? saved;
  }

  async ensureChat(
    id: string,
    prompt?: string,
  ): Promise<{ project: ProjectDocument; sessionId: string }> {
    const project = await this.require(id);
    if (project.coordinatorSessionId) {
      const existing = await this.sessions?.get(project.coordinatorSessionId);
      if (existing) {
        await this.syncGroupChatCoordinator(project, existing);
        await this.syncFleetPulls(project);
        if (prompt?.trim()) {
          await this.sessions?.sendChat(project.coordinatorSessionId, prompt.trim());
        }
        return { project, sessionId: existing.id };
      }
    }
    if (!this.sessions) throw new Error("Sessions unavailable");
    const defaults = await this.defaultCreateFields();
    const surface =
      project.surface === "swarm" || project.surface === "developer" ? project.surface : undefined;
    const groupRoster = project.groupChat
      ? groupChatRosterLines(await this.sessions.list(), project.memberIds)
      : "";
    const session = await this.sessions.create({
      ...defaults,
      title: project.title,
      kind: "project",
      runtime: "host",
      startVm: false,
      projectId: project.id,
      repoId: project.repoId,
      playbook: project.groupChat
        ? groupChatPlaybookText(groupRoster)
        : playbookForStarter(project.recipeId),
      allowedTools: [...(project.groupChat ? GROUP_CHAT_TOOLS : PROJECT_CHAT_TOOLS)],
      webSearch: true,
      prompt: prompt?.trim() || undefined,
      ...(surface ? { surface } : {}),
      ...(project.groupChat ? { persona: { displayName: "Locus", hubRole: "Coordinator" } } : {}),
    });
    const next = await this.patch(project.id, { coordinatorSessionId: session.id });
    if (project.recipeId === "gardening") {
      await this.seedGardenTimer(session.id);
    }
    const fresh = (await this.get(next.id)) ?? next;
    await this.syncFleetPulls(fresh);
    return { project: fresh, sessionId: session.id };
  }

  private async syncGroupChatCoordinator(
    project: ProjectDocument,
    session: AgentSession,
  ): Promise<void> {
    if (!project.groupChat || !this.sessions) return;
    const playbook = groupChatPlaybookText(
      groupChatRosterLines(await this.sessions.list(), project.memberIds),
    );
    const tools = [...GROUP_CHAT_TOOLS];
    const patch: { allowedTools?: string[]; playbook?: string } = {};
    if (!sameStringList(session.allowedTools, tools)) patch.allowedTools = tools;
    if (session.playbook !== playbook) patch.playbook = playbook;
    if (!Object.keys(patch).length) return;
    await this.sessions.patchMeta(session.id, patch);
  }

  /** Route explicit group-chat mentions while keeping the shared transcript visible. */
  async sendGroupMessage(
    coordinatorSessionId: string,
    content: string,
    opts: {
      plan?: boolean;
      skill?: string;
      steer?: boolean;
      attachments?: IncomingAttachment[];
      focusPath?: string;
      notifySessionId?: string;
    } = {},
  ): Promise<boolean> {
    if (!this.sessions) return false;
    const coordinator = await this.sessions.get(coordinatorSessionId);
    if (!coordinator?.projectId) return false;
    const project = await this.get(coordinator.projectId);
    if (!project?.groupChat || project.coordinatorSessionId !== coordinatorSessionId) return false;

    const members = (await this.sessions.list()).filter(
      (row) => project.memberIds.includes(row.id) && !row.archived,
    );
    const mentions = groupMentionedMembers(content, members);
    if (!mentions.everyone && !mentions.targets.length) {
      await this.sessions.sendChat(coordinatorSessionId, content, opts);
      return true;
    }

    const body = content.trim();
    if (!body) return false;
    const recent = formatGroupChatThread(coordinator.messages ?? []);
    await this.sessions.appendMessage(coordinatorSessionId, {
      id: randomUUID(),
      role: "user",
      content: body,
      createdAt: stamp(),
    });
    const prompt = groupChatMentionPrompt({
      title: project.title,
      request: body,
      thread: recent,
    });
    await Promise.all(
      mentions.targets.map((member) =>
        this.sessions!.sendChat(member.id, prompt, {
          plan: opts.plan,
          skill: opts.skill,
          steer: opts.steer,
          attachments: opts.attachments,
          focusPath: opts.focusPath,
          notifySessionId: coordinatorSessionId,
          wakeRequester: false,
        }),
      ),
    );
    return true;
  }

  private async seedGardenTimer(sessionId: string): Promise<void> {
    if (!this.sessions) return;
    const session = await this.sessions.get(sessionId);
    if (!session) return;
    const before = session.subscriptions?.length ?? 0;
    const added = applySubscribe(session.subscriptions, {
      kind: "timer",
      name: "garden-scan",
      delaySeconds: 15 * 60,
      title: "Garden scan",
      prompt:
        "Garden scan: read project context, then git_pr_list if a repo is linked. Ask or spawn a bounded review/fix. No speculative refactors.",
    });
    if (added.subscriptions.length <= before) return;
    await this.sessions.patchMeta(sessionId, { subscriptions: added.subscriptions });
  }

  async spawnMember(
    id: string,
    input: {
      task: string;
      kind?: string;
      placement?: string;
      focus?: string;
      title?: string;
      role?: string;
      personality?: string;
      capabilities?: string[];
      repo?: AgentSession["repo"];
      pull?: AgentSession["pull"];
    },
  ): Promise<{ project: ProjectDocument; sessionId: string; title: string }> {
    if (!this.sessions) throw new Error("Sessions unavailable");
    const project = await this.require(id);
    if (project.paused) throw new Error("Project is paused");
    const task = input.task.trim();
    if (!task) throw new Error("task is required");
    const sessions = await this.sessions.list();
    const live = liveMemberCount(sessions, project.memberIds);
    if (live >= project.maxConcurrentMembers) {
      throw new Error(
        `Concurrent member cap (${project.maxConcurrentMembers}). Stop a member or raise the cap.`,
      );
    }
    const spend = await this.spendUsd(project, sessions);
    if (project.maxUsd != null && spend >= project.maxUsd) {
      throw new Error(`Project spend cap ($${project.maxUsd.toFixed(2)}) reached`);
    }
    const kind = isProjectMemberKind(input.kind) ? input.kind : "agent";
    const placement = this.memberPlacement(project, input.placement);
    const runtime = this.memberRuntime(project, kind);
    const defaults = await this.defaultCreateFields();
    const context = await this.contextPrompt(project.id);
    const focus = input.focus?.trim();
    const role = input.role?.trim();
    const personality = input.personality?.trim();
    const brief = [
      `You are a member of Project "${project.title}".`,
      "Write durable notes with project_context_write so later agents can reuse them.",
      role ? `Your team role: ${role}.` : "",
      personality ? `Personality: ${personality}` : "",
      focus ? `Stay inside: ${focus}` : "",
      "",
      context,
      "",
      task,
    ]
      .filter(Boolean)
      .join("\n");
    const title =
      input.title?.trim() || (task.length > 48 ? `${task.slice(0, 47)}…` : task) || project.title;
    const surface =
      project.surface === "swarm" || project.surface === "developer" ? project.surface : undefined;
    const session = await this.sessions.create(
      {
        ...defaults,
        title,
        kind,
        runtime,
        startVm: runtime !== "host",
        dockerImage: runtime === "docker" ? DEFAULT_DOCKER_IMAGE : undefined,
        projectId: project.id,
        repoId: project.repoId,
        ...(input.repo ? { repo: input.repo } : {}),
        ...(input.pull ? { pull: input.pull } : {}),
        placement: placement === "worker" ? "worker" : undefined,
        backendId: placement === "worker" ? project.backendId : undefined,
        maxUsd: project.maxUsd,
        prompt: brief,
        ...(role || personality
          ? {
              persona: {
                ...(role ? { hubRole: role } : {}),
                ...(personality ? { personality } : {}),
                ...(input.title?.trim() ? { displayName: input.title.trim() } : {}),
              },
            }
          : {}),
        ...(surface ? { surface } : {}),
      },
      { waitUntilStarted: false },
    );
    const memberIds = [...new Set([...project.memberIds, session.id])];
    const capabilities = (input.capabilities ?? [])
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 12);
    const next = await this.patch(project.id, {
      memberIds,
      teamMembers: [
        ...(project.team?.members ?? []).filter((member) => member.sessionId !== session.id),
        {
          sessionId: session.id,
          role: role || undefined,
          capabilities,
          enabled: true,
          assignedAt: stamp(),
          lastSeenAt: stamp(),
        },
      ],
    });
    if (project.coordinatorSessionId) {
      await this.appendTeamEvent(project.coordinatorSessionId, {
        content: `Spawned ${sessionDisplayName(session)}`,
        speaker: teamSpeakerFrom(session),
        teamEvent: "spawn",
      }).catch(() => undefined);
    }
    return { project: next, sessionId: session.id, title: session.title };
  }

  async replaceMember(
    id: string,
    memberId: string,
    input: { task: string; title?: string; role?: string; focus?: string; capabilities?: string[] },
  ) {
    const project = await this.require(id);
    await this.requireMember(id, memberId);
    if (!this.sessions) throw new Error("Sessions unavailable");
    const previous = project.team?.members.find((member) => member.sessionId === memberId);
    await this.sessions.abortChat(memberId).catch(() => undefined);
    await this.patch(id, {
      teamMembers: (project.team?.members ?? []).map((member) =>
        member.sessionId === memberId ? { ...member, enabled: false, lastSeenAt: stamp() } : member,
      ),
    });
    const replacement = await this.spawnMember(id, {
      ...input,
      role: input.role ?? previous?.role,
      capabilities: input.capabilities ?? previous?.capabilities,
    });
    const fresh = await this.require(id);
    await this.audit(fresh, {
      kind: "team",
      message: `Replaced ${memberId} with ${replacement.title}`,
      sessionId: replacement.sessionId,
      actor: "coordinator",
    });
    return replacement;
  }

  private memberPlacement(project: ProjectDocument, override?: string): AgentPlacement {
    if (override === "local") return "local";
    if (override === "worker") return "worker";
    return parseAgentPlacement(project.placement, project.backendId ? "worker" : "local");
  }

  private memberRuntime(project: ProjectDocument, kind: string): AgentRuntime {
    if (kind === "design" || kind === "game" || kind === "assets" || kind === "review")
      return "docker";
    if (project.runtime === "docker" || project.runtime === "host") return project.runtime;
    return this.sessions?.dockerKind() === "docker" ? "docker" : "host";
  }

  async spendUsd(project: ProjectDocument, sessions?: AgentSession[]): Promise<number> {
    const rows = sessions ?? (this.sessions ? await this.sessions.list() : []);
    const ids = new Set([project.coordinatorSessionId, ...project.memberIds].filter(Boolean));
    const config = await this.store.loadConfig();
    let usd = 0;
    for (const row of rows) {
      if (!ids.has(row.id)) continue;
      const provider = config.providers.find((item) => item.id === row.providerId);
      const llm = row.usage ? estimateUsd(row.usage, resolveUsageRates(provider, row.model)) : 0;
      usd += llm ?? 0;
      usd += workerComputeUsd(
        row,
        (config.workers ?? []).find((item) => item.id === row.backendId),
      );
    }
    return usd;
  }

  private memberView(project: ProjectDocument, row: AgentSession) {
    return {
      id: row.id,
      title: row.title,
      name: sessionDisplayName(row),
      role: row.persona?.hubRole,
      capabilities:
        project.team?.members.find((member) => member.sessionId === row.id)?.capabilities ?? [],
      status: row.status,
      kind: sessionKind(row),
      placement: row.placement,
      needsHuman: row.needsHuman,
      pull: row.pull,
      computer: {
        runtime: sessionRuntime(row),
        vmId: row.vmId,
        status: row.status,
        control: row.control,
      },
      artifacts: row.messages.filter((message) =>
        Boolean(message.artifactName || message.artifactKind),
      ).length,
      column: projectMemberColumn(row),
    };
  }

  async missionControl(id: string) {
    const project = await this.require(id);
    await this.syncFleetPulls(project);
    const sessions = this.sessions ? await this.sessions.list() : [];
    const members = sessions
      .filter((row) => project.memberIds.includes(row.id))
      .map((row) => this.memberView(project, row));
    const coordinator = project.coordinatorSessionId
      ? sessions.find((row) => row.id === project.coordinatorSessionId)
      : undefined;
    const needsYou = pendingSwarmNeeds(project.needsYou);
    const health = project.paused
      ? "paused"
      : needsYou.length || members.some((row) => row.status === "error")
        ? "attention"
        : "healthy";
    return {
      project,
      members,
      needsYou,
      handoffs: await this.listHandoffs(project.id),
      health,
      routines: coordinator?.subscriptions ?? [],
      context: await this.listContext(project.id),
      audit: project.audit ?? [],
      spendUsd: await this.spendUsd(project, sessions),
    };
  }

  async listHandoffs(projectId: string): Promise<SwarmTeamHandoff[]> {
    await this.require(projectId);
    const rows = await this.allHandoffs();
    return rows
      .filter((row) => row.sourceTeamId === projectId || row.targetTeamId === projectId)
      .slice(0, MAX_TEAM_HANDOFFS);
  }

  async teamDirectory() {
    return (await this.list())
      .filter((row) => row.surface === "swarm")
      .map((row) => ({
        id: row.id,
        name: row.teamName ?? row.title,
        memberCount: row.memberCount,
        paused: Boolean(row.paused),
        needsYouCount: row.needsYouCount ?? 0,
        updatedAt: row.updatedAt,
      }));
  }

  async handoffToTeam(
    sourceTeamId: string,
    input: {
      targetTeamId: string;
      task: string;
      targetMemberId?: string;
      sourceSessionId?: string;
    },
  ): Promise<SwarmTeamHandoff> {
    const source = await this.require(sourceTeamId);
    const target = await this.require(input.targetTeamId);
    if (source.id === target.id) throw new Error("Choose a different target team");
    if (source.surface !== "swarm" || target.surface !== "swarm") {
      throw new Error("Cross-team handoffs are only available between Swarm teams");
    }
    const task = input.task.trim();
    if (!task) throw new Error("Handoff task is required");
    const targetMemberId = input.targetMemberId?.trim() || undefined;
    if (
      targetMemberId &&
      targetMemberId !== target.coordinatorSessionId &&
      !target.memberIds.includes(targetMemberId)
    ) {
      throw new Error("Target member is not part of the receiving team");
    }
    const now = stamp();
    const handoff: SwarmTeamHandoff = {
      id: randomUUID(),
      sourceTeamId: source.id,
      sourceTeamName: projectTeamName(source),
      targetTeamId: target.id,
      targetTeamName: projectTeamName(target),
      task,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      sourceSessionId: input.sourceSessionId?.trim() || undefined,
      targetSessionId: targetMemberId,
    };
    await this.writeHandoff(handoff);
    await this.audit(source, {
      kind: "team",
      message: `Handoff sent to ${handoff.targetTeamName}: ${task}`,
      actor: "coordinator",
      sessionId: handoff.sourceSessionId,
    });
    await this.audit(target, {
      kind: "team",
      message: `Handoff received from ${handoff.sourceTeamName}: ${task}`,
      actor: "team",
      sessionId: handoff.targetSessionId,
    });
    let receiving = target;
    if (!receiving.coordinatorSessionId && this.sessions) {
      try {
        receiving = (await this.ensureChat(receiving.id)).project;
      } catch {
        // Keep the handoff queued when the receiving team cannot be initialized yet.
      }
    }
    if (receiving.coordinatorSessionId) {
      const sourceCoordinator =
        this.sessions && source.coordinatorSessionId
          ? await this.sessions.get(source.coordinatorSessionId)
          : undefined;
      await this.appendTeamEvent(receiving.coordinatorSessionId, {
        content: `Incoming handoff from ${handoff.sourceTeamName}: ${task}`,
        speaker: sourceCoordinator ? teamSpeakerFrom(sourceCoordinator) : undefined,
        teamEvent: "handoff",
      }).catch(() => undefined);
    }
    return handoff;
  }

  async actOnHandoff(
    projectId: string,
    handoffId: string,
    action: SwarmTeamHandoffAction,
    response?: string,
  ): Promise<SwarmTeamHandoff> {
    if (!isSwarmTeamHandoffAction(action)) throw new Error("Unknown team handoff action");
    const actingProject = await this.require(projectId);
    const handoff = await this.readHandoff(handoffId);
    if (!handoff) throw new Error("Team handoff not found");
    if (handoff.sourceTeamId !== projectId && handoff.targetTeamId !== projectId) {
      throw new Error("Team handoff is not associated with this team");
    }
    if (action !== "complete" && handoff.targetTeamId !== projectId) {
      throw new Error("Only the receiving team can accept or decline a handoff");
    }
    if (action === "accept" && handoff.status !== "queued") {
      throw new Error("Only queued handoffs can be accepted");
    }
    if (action === "decline" && (handoff.status === "declined" || handoff.status === "completed")) {
      throw new Error("Handoff is already closed");
    }
    if (action === "complete" && handoff.status !== "accepted") {
      throw new Error("Accept the handoff before completing it");
    }
    if (action === "accept") {
      if (await this.isPaused(actingProject.id)) {
        throw new Error("Resume the receiving team before accepting a handoff");
      }
      const recipient = handoff.targetSessionId || actingProject.coordinatorSessionId;
      if (!recipient) {
        throw new Error("The receiving team needs a coordinator or target member before accepting");
      }
      if (this.sessions && !(await this.sessions.get(recipient))) {
        throw new Error("The receiving team member is no longer available");
      }
    }
    const now = stamp();
    handoff.status =
      action === "accept" ? "accepted" : action === "decline" ? "declined" : "completed";
    handoff.updatedAt = now;
    handoff.response = response?.trim() || handoff.response;
    await this.writeHandoff(handoff);
    await this.audit(actingProject, {
      kind: "team",
      message: `${action} handoff from ${handoff.sourceTeamName} to ${handoff.targetTeamName}`,
      actor: actingProject.id === handoff.targetTeamId ? "receiving-team" : "coordinator",
      sessionId: handoff.targetSessionId,
    });
    const otherId =
      actingProject.id === handoff.sourceTeamId ? handoff.targetTeamId : handoff.sourceTeamId;
    const other = await this.require(otherId);
    await this.audit(other, {
      kind: "team",
      message: `${handoff.targetTeamName} marked the handoff ${action}`,
      actor: "team",
      sessionId: handoff.sourceSessionId,
    });
    if (action === "accept" && actingProject.id === handoff.targetTeamId && this.sessions) {
      const recipient = handoff.targetSessionId || actingProject.coordinatorSessionId;
      if (recipient) {
        await this.sessions
          .sendChat(
            recipient,
            `[Team handoff ${handoff.id}] The receiving team accepted this task. Delegate or complete it now, then mark the handoff complete in mission control.\n\n${handoff.task}`,
          )
          .catch(() => undefined);
      }
    }
    return handoff;
  }

  async collectMember(id: string, memberId: string): Promise<string> {
    if (!this.sessions) throw new Error("Sessions unavailable");
    const project = await this.require(id);
    if (!project.memberIds.includes(memberId) && project.coordinatorSessionId !== memberId) {
      throw new Error("Not a member of this project");
    }
    const session = await this.sessions.get(memberId);
    if (!session) throw new Error("Member not found");
    const summary = lastAssistantText(session.messages) ?? "(no assistant message yet)";
    const pr = session.pull?.url ? `PR: ${session.pull.url}` : "";
    const output = [`${session.title} [${session.status}]`, pr, summary].filter(Boolean).join("\n");
    if (project.coordinatorSessionId && project.coordinatorSessionId !== memberId) {
      const clip = summary.length > 280 ? `${summary.slice(0, 279)}…` : summary;
      await this.appendTeamEvent(project.coordinatorSessionId, {
        content: `${sessionDisplayName(session)} done — ${clip}`,
        speaker: teamSpeakerFrom(session),
        teamEvent: "done",
      }).catch(() => undefined);
    }
    return output;
  }

  async keepsControlPlane(): Promise<boolean> {
    return projectKeepsControlPlane(await this.list());
  }

  /**
   * Poll member pull requests and either spawn one fix member or flag Needs you
   * when CI goes green. Merge stays an operator Approve. Paused projects skip.
   */
  async tickFleet(): Promise<void> {
    await mkdir(this.root(), { recursive: true, mode: 0o700 });
    let names: string[] = [];
    try {
      names = await readdir(this.root());
    } catch {
      return;
    }
    for (const name of names) {
      const project = await this.get(name);
      if (!project || project.archived || project.paused) continue;
      await this.wakeMembers(project).catch(() => undefined);
    }
  }

  private async wakeMembers(project: ProjectDocument): Promise<void> {
    if (!this.sessions || !this.repos) return;
    const debounce = this.opts?.wakeDebounceMs ?? 60_000;
    const last = this.wakeAt.get(project.id) ?? 0;
    if (Date.now() - last < debounce) return;
    this.wakeAt.set(project.id, Date.now());
    const sessions = await this.sessions.list();
    const members = sessions.filter(
      (row) => project.memberIds.includes(row.id) && row.pull?.number && !row.archived,
    );
    if (!members.length) return;
    const watch: NonNullable<ProjectDocument["fleetWatch"]> = { ...(project.fleetWatch ?? {}) };
    const steered = new Set<string>();
    let dirty = false;
    for (const row of members) {
      const number = row.pull?.number;
      const repoId = row.repoId || project.repoId;
      if (!number || !repoId) continue;
      let detail;
      try {
        detail = await this.repos.getPull(repoId, number, { fresh: true });
      } catch {
        continue;
      }
      const decision = decideFleetWake(watch[row.id], {
        number: detail.number,
        state: detail.state,
        headSha: detail.headSha,
        checkState: detail.checkState,
        checks: detail.checks ?? [],
        comments: (detail.comments ?? []).map((comment) => ({
          id: comment.id,
          author: comment.author,
          body: comment.body,
        })),
      });
      const before = JSON.stringify(watch[row.id] ?? null);
      const pullKey = `${repoId}:${number}`;
      if (decision.action === "spawn" && decision.task) {
        if (steered.has(pullKey)) {
          watch[row.id] = decision.entry;
        } else {
          const fix = members.find(
            (member) => member.pull?.number === number && member.title.startsWith(`Fix #${number}`),
          );
          try {
            if (fix) {
              await this.sessions.sendChat(fix.id, decision.task);
            } else {
              await this.spawnMember(project.id, {
                task: decision.task,
                title: `Fix #${number}`,
                repo: row.repo,
                pull: {
                  number: detail.number,
                  url: detail.url,
                  title: detail.title,
                  state: detail.state,
                  headRef: detail.headRef,
                  baseRef: detail.baseRef,
                  checkState: detail.checkState,
                },
              });
            }
            steered.add(pullKey);
            watch[row.id] = decision.entry;
          } catch {
            /* cap or spend: leave the cursor so the next tick retries */
          }
        }
      } else if (decision.action === "ready" && decision.reason) {
        const signature = decision.entry.readySignature;
        const seen = Object.values(watch).some((entry) => entry.readySignature === signature);
        if (!seen) {
          await this.sessions.flagNeedsHuman(row.id, decision.reason).catch(() => undefined);
        }
        watch[row.id] = decision.entry;
      } else {
        watch[row.id] = decision.entry;
      }
      if (JSON.stringify(watch[row.id] ?? null) !== before) dirty = true;
      if (row.pull?.checkState !== detail.checkState || row.pull?.state !== detail.state) {
        await this.sessions.attachPull(row.id, {
          number: detail.number,
          url: detail.url,
          title: detail.title,
          state: detail.state,
          headRef: detail.headRef,
          baseRef: detail.baseRef,
          checkState: detail.checkState,
        });
      }
    }
    if (!dirty) return;
    const fresh = await this.get(project.id);
    if (!fresh) return;
    fresh.fleetWatch = watch;
    await this.write(fresh);
  }

  /**
   * Refresh member `session.pull.state` from the forge when a Project is opened or
   * `project_get` runs. Quietly keeps the cached pull on failure. Debounced per project.
   */
  async syncFleetPulls(project: ProjectDocument): Promise<void> {
    if (!this.sessions || !this.repos) return;
    const last = this.pullRefreshAt.get(project.id) ?? 0;
    if (Date.now() - last < PULL_REFRESH_DEBOUNCE_MS) return;
    this.pullRefreshAt.set(project.id, Date.now());
    const sessions = await this.sessions.list();
    const members = sessions.filter((row) => project.memberIds.includes(row.id));
    await Promise.all(
      members.map(async (row) => {
        const number = row.pull?.number;
        if (!number) return;
        const repoId = row.repoId || project.repoId;
        if (!repoId) return;
        try {
          const detail = await this.repos!.getPull(repoId, number, { fresh: true });
          const next: SessionPull = {
            number: detail.number,
            url: detail.url,
            title: detail.title,
            state: detail.state,
            headRef: detail.headRef,
            baseRef: detail.baseRef,
            checkState: detail.checkState,
          };
          const prev = row.pull;
          if (
            prev &&
            prev.state === next.state &&
            prev.url === next.url &&
            prev.title === next.title &&
            prev.headRef === next.headRef &&
            prev.baseRef === next.baseRef &&
            prev.checkState === next.checkState
          ) {
            return;
          }
          await this.sessions!.attachPull(row.id, next);
        } catch {
          /* quiet degrade — keep cached pull */
        }
      }),
    );
  }

  async executeTool(
    session: Pick<AgentSession, "id" | "kind" | "projectId">,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (!isProjectToolName(name)) return { ok: false, output: `Unknown project tool ${name}` };
    const projectId = str(args, "project_id") || session.projectId || "";
    if (!projectId) return { ok: false, output: "Pass project_id or use a project chat." };
    const coordinator = sessionKind(session) === "project";
    try {
      if (name === "team_directory") {
        const project = await this.require(projectId);
        if (project.surface !== "swarm") {
          return { ok: false, output: "Named team tools are only available in Locus Swarm." };
        }
        return { ok: true, output: JSON.stringify(await this.teamDirectory(), null, 2) };
      }
      if (name === "project_context_list") {
        const files = await this.listContext(projectId);
        return { ok: true, output: formatProjectContextIndex(files) };
      }
      if (name === "project_context_read") {
        const path = str(args, "path");
        const body = await this.readContext(projectId, path);
        return { ok: true, output: body };
      }
      if (name === "project_context_write") {
        const path = await this.writeContextFile(
          projectId,
          str(args, "path"),
          str(args, "content"),
        );
        const project = await this.require(projectId);
        this.hub.broadcast({ type: "project.updated", project });
        return { ok: true, output: `Wrote context/${path}` };
      }
      if (name === "project_context_delete") {
        await this.deleteContext(projectId, str(args, "path"));
        return { ok: true, output: `Deleted ${str(args, "path")}` };
      }
      if (name === "project_get") {
        const project = await this.require(projectId);
        await this.syncFleetPulls(project);
        const handoffs = await this.listHandoffs(projectId);
        const files = await this.listContext(projectId);
        const sessions = this.sessions ? await this.sessions.list() : [];
        const members = sessions
          .filter((row) => project.memberIds.includes(row.id))
          .map((row) => ({ ...this.memberView(project, row), pull: row.pull?.url }));
        const coordinatorSession = project.coordinatorSessionId
          ? sessions.find((row) => row.id === project.coordinatorSessionId)
          : undefined;
        return {
          ok: true,
          output: JSON.stringify(
            {
              ...projectSummary(project),
              goal: project.goal,
              paused: Boolean(project.paused),
              maxUsd: project.maxUsd,
              spendUsd: await this.spendUsd(project, sessions),
              liveMembers: liveMemberCount(sessions, project.memberIds),
              subscriptions: coordinatorSession?.subscriptions ?? [],
              needsYou: pendingSwarmNeeds(project.needsYou),
              handoffs: handoffs.slice(0, 20),
              audit: (project.audit ?? []).slice(-20),
              context: formatProjectContextIndex(files),
              members,
            },
            null,
            2,
          ),
        };
      }
      if (name === "project_collect") {
        const memberId = str(args, "member_id");
        return { ok: true, output: await this.collectMember(projectId, memberId) };
      }
      if (!coordinator) {
        return {
          ok: false,
          output: "Only the project coordinator can manage members or send team handoffs.",
        };
      }
      if (name === "team_handoff") {
        const handoff = await this.handoffToTeam(projectId, {
          targetTeamId: str(args, "target_team_id"),
          targetMemberId: str(args, "target_member_id") || undefined,
          task: str(args, "task"),
          sourceSessionId: session.id,
        });
        return {
          ok: true,
          output: JSON.stringify({
            handoffId: handoff.id,
            targetTeamId: handoff.targetTeamId,
            targetTeamName: handoff.targetTeamName,
            status: handoff.status,
          }),
        };
      }
      if (name === "project_spawn") {
        const result = await this.spawnMember(projectId, {
          task: str(args, "task"),
          kind: str(args, "kind") || undefined,
          placement: str(args, "placement") || undefined,
          focus: str(args, "focus") || undefined,
          title: str(args, "title") || undefined,
          role: str(args, "role") || undefined,
          personality: str(args, "personality") || undefined,
          capabilities: Array.isArray(args.capabilities)
            ? args.capabilities.filter((value): value is string => typeof value === "string")
            : undefined,
        });
        return {
          ok: true,
          output: JSON.stringify({
            memberId: result.sessionId,
            title: result.title,
          }),
        };
      }
      if (name === "project_steer") {
        const memberId = str(args, "member_id");
        const prompt = str(args, "prompt");
        if (!this.sessions) throw new Error("Sessions unavailable");
        await this.requireMember(projectId, memberId);
        const project = await this.require(projectId);
        await this.sessions.sendChat(memberId, prompt, {
          notifySessionId: project.coordinatorSessionId,
        });
        return { ok: true, output: `Steered ${memberId}` };
      }
      if (name === "project_stop") {
        const memberId = str(args, "member_id");
        if (!this.sessions) throw new Error("Sessions unavailable");
        await this.requireMember(projectId, memberId);
        await this.sessions.abortChat(memberId);
        return { ok: true, output: `Stopped ${memberId}` };
      }
      if (name === "project_replace") {
        const memberId = str(args, "member_id");
        const replacement = await this.replaceMember(projectId, memberId, {
          task: str(args, "task"),
          title: str(args, "title") || undefined,
          role: str(args, "role") || undefined,
          focus: str(args, "focus") || undefined,
          capabilities: Array.isArray(args.capabilities)
            ? args.capabilities.filter((value): value is string => typeof value === "string")
            : undefined,
        });
        return {
          ok: true,
          output: JSON.stringify({ memberId: replacement.sessionId, title: replacement.title }),
        };
      }
      if (name === "project_propose_merge") {
        const memberId = str(args, "member_id");
        await this.requireMember(projectId, memberId);
        if (!this.sessions) throw new Error("Sessions unavailable");
        const member = await this.sessions.get(memberId);
        if (!member?.pull?.number) {
          return { ok: false, output: "That member has no pull request yet." };
        }
        const ci = member.pull.checkState ? ` CI ${member.pull.checkState}.` : "";
        const reason = `Propose merge #${member.pull.number}.${ci} Approve git_pr_merge on the member.`;
        await this.sessions.flagNeedsHuman(memberId, reason);
        return {
          ok: true,
          output: JSON.stringify({
            memberId,
            pull: member.pull.url,
            number: member.pull.number,
            checkState: member.pull.checkState,
          }),
        };
      }
      if (name === "project_propose_rule") {
        const title = str(args, "title");
        const rule = str(args, "rule");
        if (!title || !rule) return { ok: false, output: "Pass title and rule." };
        const slug = projectRuleSlug(title);
        const path = `rules/${slug}.md`;
        await this.writeContextFile(projectId, path, `# ${title}\n\n${rule.trim()}\n`);
        const project = await this.require(projectId);
        const now = stamp();
        const need: SwarmNeed = {
          id: randomUUID(),
          sessionId: project.coordinatorSessionId || project.id,
          teammateName: projectTeamName(project),
          reason: `Apply rule “${title}” from context/${path} to the repo (Locus.md / .locus/rules / CI).`,
          status: "open",
          createdAt: now,
          updatedAt: now,
          attempts: 0,
        };
        project.needsYou = [...(project.needsYou ?? []), need].slice(-100);
        await this.audit(project, {
          kind: "need",
          message: need.reason,
          sessionId: project.coordinatorSessionId,
        });
        this.hub.broadcast({ type: "project.updated", project });
        return {
          ok: true,
          output: `Wrote context/${path}. Operator still applies it to the repo.`,
        };
      }
      return { ok: false, output: `Unknown project tool ${name}` };
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : "Failed" };
    }
  }

  private async requireMember(projectId: string, memberId: string): Promise<void> {
    const project = await this.require(projectId);
    if (!project.memberIds.includes(memberId)) throw new Error("Not a member of this project");
  }
}
