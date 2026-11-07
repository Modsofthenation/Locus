import { isCanvasSession, isSetupSession, sessionKind, type AgentSession } from "./session.js";

/** Sibling Docker workers (not the parent that spawned them). */
export function isWorkerSession(session: {
  compare?: { kind?: string; role?: string; parentId?: string };
}): boolean {
  if (session.compare?.kind !== "workers") return false;
  return session.compare.role !== "parent";
}

/** Coding agent that can own a repo + PR. Design canvases, review/setup sessions, and worker forks are not the bound object. */
export function isLiveBoundSession(
  session: Pick<AgentSession, "archived" | "kind" | "compare">,
): boolean {
  if (session.archived) return false;
  if (isCanvasSession(session)) return false;
  if (sessionKind(session) === "review") return false;
  if (isSetupSession(session)) return false;
  if (isWorkerSession(session)) return false;
  return true;
}

export function findBoundAgent(
  sessions: AgentSession[],
  query: {
    repoId?: string;
    sourceDesignId?: string;
    promotedAgentId?: string;
    pullNumber?: number;
  },
): AgentSession | undefined {
  const live = sessions.filter(isLiveBoundSession);
  if (query.promotedAgentId) {
    const hit = live.find((session) => session.id === query.promotedAgentId);
    if (hit) return hit;
  }
  if (query.pullNumber != null && query.repoId) {
    const hit = live.find(
      (session) => session.repoId === query.repoId && session.pull?.number === query.pullNumber,
    );
    if (hit) return hit;
    return undefined;
  }
  if (query.sourceDesignId) {
    const design = sessions.find((session) => session.id === query.sourceDesignId);
    if (design?.promotedAgentId) {
      const hit = live.find((session) => session.id === design.promotedAgentId);
      if (hit) return hit;
    }
    const hit = live.find((session) => session.sourceDesignId === query.sourceDesignId);
    if (hit) return hit;
  }
  if (query.repoId) {
    return live
      .filter((session) => session.repoId === query.repoId && sessionKind(session) === "agent")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }
  return undefined;
}

export function boundPeerIds(session: AgentSession, sessions: AgentSession[]): string[] {
  const ids = new Set<string>([session.id]);
  const add = (id?: string) => {
    if (id) ids.add(id);
  };
  add(session.promotedAgentId);
  add(session.sourceDesignId);
  for (const other of sessions) {
    if (other.id === session.id) continue;
    if (other.id === session.sourceDesignId || other.id === session.promotedAgentId) add(other.id);
    if (other.sourceDesignId === session.id || other.promotedAgentId === session.id) add(other.id);
    if (session.sourceDesignId && other.sourceDesignId === session.sourceDesignId) add(other.id);
    if (session.promotedAgentId && other.promotedAgentId === session.promotedAgentId) add(other.id);
    if (
      session.repoId &&
      other.repoId === session.repoId &&
      session.pull?.number != null &&
      other.pull?.number === session.pull.number
    ) {
      add(other.id);
    }
  }
  return [...ids];
}
