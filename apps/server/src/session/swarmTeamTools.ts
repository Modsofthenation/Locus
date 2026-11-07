import type { AgentSession, CreateSessionInput, TeamSpeaker } from "@locus/shared";
import {
  hubRolePersonaDefaults,
  isCoordinatorHubRole,
  isProjectSession,
  parseSessionSurface,
  sessionDisplayName,
  sessionKind,
} from "@locus/shared";
import type { ToolResult } from "@locus/guest-agent";
import type { JsonStore } from "../core/store.js";
import type { ProjectService } from "../projects/projects.js";

export type SwarmTeamPorts = {
  list: () => Promise<AgentSession[]>;
  create: (input: CreateSessionInput) => Promise<AgentSession>;
  sendChat: (
    sessionId: string,
    message: string,
    opts?: { notifySessionId?: string },
  ) => Promise<unknown>;
  store: JsonStore;
  projects?: ProjectService;
};

export function swarmTeammateSummary(row: AgentSession) {
  const brief = row.instructions?.trim();
  return {
    id: row.id,
    name: sessionDisplayName(row),
    role: row.persona?.hubRole ?? null,
    status: row.status,
    needsHuman: Boolean(row.needsHuman),
    personality: row.persona?.personality ?? null,
    brief: brief ? (brief.length > 160 ? `${brief.slice(0, 159)}…` : brief) : null,
    projectId: row.projectId ?? null,
    updatedAt: row.updatedAt,
  };
}

export function swarmSpeakerFrom(session: AgentSession): TeamSpeaker {
  return {
    sessionId: session.id,
    displayName: sessionDisplayName(session),
    avatarId: session.persona?.avatarId,
    avatarPose: session.persona?.avatarPose,
    avatarAccessory: session.persona?.avatarAccessory,
    avatarAccent: session.persona?.avatarAccent,
  };
}

export function findSwarmPeer(
  peers: AgentSession[],
  args: Record<string, unknown>,
): AgentSession | undefined {
  const id = typeof args.teammate_id === "string" ? args.teammate_id.trim() : "";
  const nameQuery = typeof args.name === "string" ? args.name.trim().toLowerCase() : "";
  return peers.find((row) => {
    if (id && row.id === id) return true;
    if (!nameQuery) return false;
    const label = sessionDisplayName(row).toLowerCase();
    const title = row.title?.toLowerCase() ?? "";
    return label === nameQuery || title === nameQuery || label.includes(nameQuery);
  });
}

/** Swarm team_* tools — roster, peer status, message, and add-teammate. */
export async function executeSwarmTeamTool(
  ports: SwarmTeamPorts,
  session: AgentSession,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (parseSessionSurface(session.surface) !== "swarm") {
    return { ok: false, output: "Team tools are only available in Locus Swarm." };
  }
  const project =
    session.projectId && ports.projects ? await ports.projects.get(session.projectId) : undefined;
  const group =
    project?.groupChat || !ports.projects
      ? project
      : await ports.projects.groupForSession(session.id);
  const groupMemberIds = group?.groupChat
    ? new Set([group.coordinatorSessionId, ...group.memberIds].filter(Boolean))
    : undefined;
  const allPeers = (await ports.list()).filter(
    (row) =>
      parseSessionSurface(row.surface) === "swarm" &&
      !row.archived &&
      sessionKind(row) !== "board" &&
      sessionKind(row) !== "design" &&
      (!groupMemberIds || groupMemberIds.has(row.id)),
  );
  const peers = groupMemberIds
    ? allPeers
    : session.projectId
      ? allPeers.filter((row) => row.projectId === session.projectId)
      : allPeers.filter((row) => !row.projectId);
  if (name === "team_roster") {
    return {
      ok: true,
      output: JSON.stringify({
        you: swarmTeammateSummary(session),
        teammates: peers.map((row) => swarmTeammateSummary(row)),
      }),
    };
  }
  if (name === "team_peer_status") {
    const hit = findSwarmPeer(peers, args);
    if (!hit) return { ok: false, output: "No matching teammate. Call team_roster first." };
    return { ok: true, output: JSON.stringify(swarmTeammateSummary(hit)) };
  }
  if (name === "team_message") {
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) return { ok: false, output: "Pass message for the teammate." };
    const hit = findSwarmPeer(
      peers.filter((row) => row.id !== session.id),
      args,
    );
    if (!hit) return { ok: false, output: "No matching teammate. Call team_roster first." };
    if (!session.projectId || !hit.projectId || hit.projectId !== session.projectId) {
      return {
        ok: false,
        output:
          "Team messages stay inside a named team. Add this teammate to a team, or use team_handoff to send work to another team.",
      };
    }
    await ports.sendChat(hit.id, message, { notifySessionId: session.id });
    return {
      ok: true,
      output: JSON.stringify({
        ok: true,
        async: true,
        teammateId: hit.id,
        name: sessionDisplayName(hit),
        notifiedOn: ["done", "needs_you", "blocked"],
      }),
    };
  }
  if (name === "team_add_teammate") {
    if (!isCoordinatorHubRole(session.persona?.hubRole) && !isProjectSession(session)) {
      return { ok: false, output: "Only a Coordinator can add teammates." };
    }
    const displayName = typeof args.name === "string" ? args.name.trim() : "";
    const role = typeof args.role === "string" ? args.role.trim() : "";
    const personality = typeof args.personality === "string" ? args.personality.trim() : undefined;
    const brief = typeof args.brief === "string" ? args.brief.trim() : undefined;
    if (!displayName || !role) {
      return { ok: false, output: "Pass name and role for the new teammate." };
    }
    if (isProjectSession(session) && session.projectId && ports.projects) {
      const defaults = hubRolePersonaDefaults(role);
      const spawned = await ports.projects.spawnMember(session.projectId, {
        task: brief || `Join the team as ${role}.`,
        title: displayName,
        role,
        personality: personality || defaults.personality,
      });
      return {
        ok: true,
        output: JSON.stringify({
          teammateId: spawned.sessionId,
          name: displayName,
          role,
          via: "project_spawn",
        }),
      };
    }
    const config = await ports.store.loadConfig();
    const provider =
      config.providers.find((row) => row.id === session.providerId) ??
      config.providers.find((row) => row.enabled) ??
      config.providers[0];
    if (!provider?.id) {
      return { ok: false, output: "No provider configured to create a teammate." };
    }
    const defaults = hubRolePersonaDefaults(role);
    const resolvedPersonality = personality || defaults.personality;
    const created = await ports.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      startVm: false,
      providerId: session.providerId || provider.id,
      model: session.model || provider.defaultModel,
      surface: "swarm",
      autonomy: "guided",
      instructions: brief,
      persona: {
        displayName,
        hubRole: role,
        ...(resolvedPersonality ? { personality: resolvedPersonality } : {}),
        ...(defaults.avatarId ? { avatarId: defaults.avatarId } : {}),
      },
    });
    return {
      ok: true,
      output: JSON.stringify({
        teammateId: created.id,
        name: sessionDisplayName(created),
        role,
      }),
    };
  }
  return { ok: false, output: `Unknown team tool ${name}` };
}
