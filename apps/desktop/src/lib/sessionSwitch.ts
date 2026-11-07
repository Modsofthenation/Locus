import type { AgentSession } from "@locus/shared";

export function switchableSessions(sessions: AgentSession[]): AgentSession[] {
  return sessions.filter((s) => !s.archived);
}

export function sessionForDigit(sessions: AgentSession[], key: string): AgentSession | undefined {
  if (!/^[1-9]$/.test(key)) return undefined;
  return switchableSessions(sessions)[Number(key) - 1];
}

export function filterSessions(sessions: AgentSession[], query: string): AgentSession[] {
  const q = query.trim().toLowerCase();
  const rows = switchableSessions(sessions);
  if (!q) return rows;
  return rows.filter(
    (s) =>
      s.title.toLowerCase().includes(q) || s.os.includes(q) || s.model.toLowerCase().includes(q),
  );
}
