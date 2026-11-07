import {
  fileMentionQuery,
  parseSessionSurface,
  sessionDisplayName,
  teammateMentionHandle,
  type AgentSession,
} from "@locus/shared";

export type TeammateMentionItem = {
  id: string;
  /** Token inserted after @ (matches group-chat alias parsing). */
  token: string;
  label: string;
  hint: string;
};

function mentionToken(session: AgentSession, taken: Set<string>): string {
  const name = sessionDisplayName(session).trim();
  const full = teammateMentionHandle(name);
  const first = teammateMentionHandle(name.split(/\s+/)[0] ?? "");
  const candidates = [...new Set([full, first].filter(Boolean))];
  for (const candidate of candidates) {
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${full || first || session.id.slice(0, 8)}-${session.id.slice(0, 4)}`;
}

export function teammateMentionItems(input: {
  session: AgentSession;
  sessions: AgentSession[];
  project?: {
    id: string;
    groupChat?: boolean;
    coordinatorSessionId?: string;
    memberIds?: string[];
  } | null;
}): TeammateMentionItem[] {
  const project = input.project;
  const swarm = parseSessionSurface(input.session.surface) === "swarm";
  if (!swarm && !project?.groupChat) return [];
  const ids = new Set<string>();
  if (project && (project.groupChat || swarm)) {
    if (project.coordinatorSessionId) ids.add(project.coordinatorSessionId);
    for (const id of project.memberIds ?? []) ids.add(id);
    for (const row of input.sessions) {
      if (row.projectId === project.id) ids.add(row.id);
    }
  } else if (swarm) {
    for (const row of input.sessions) {
      if (parseSessionSurface(row.surface) === "swarm") ids.add(row.id);
    }
  }
  ids.delete(input.session.id);
  const everyone: TeammateMentionItem = {
    id: "everyone",
    token: "everyone",
    label: "@everyone",
    hint: "All participants",
  };
  const peers = input.sessions
    .filter((row) => ids.has(row.id) && !row.archived)
    .map((row) => ({ row, hint: sessionDisplayName(row) }))
    .sort((a, b) => a.hint.localeCompare(b.hint));
  const taken = new Set<string>(["everyone"]);
  const peerItems = peers.map(({ row, hint }) => {
    const token = mentionToken(row, taken);
    taken.add(token.toLowerCase());
    return {
      id: row.id,
      token,
      label: `@${token}`,
      hint,
    };
  });
  return [everyone, ...peerItems];
}

/** Higher is a closer @mention match (exact token, then prefix, then fuzzy). */
function teammateMentionScore(item: TeammateMentionItem, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return item.token === "everyone" ? 1 : 0;
  const token = item.token.toLowerCase();
  const hint = item.hint.toLowerCase();
  const label = item.label.toLowerCase();
  if (token === q || label === `@${q}`) return 500;
  if (token.startsWith(q)) return 400;
  if (label.startsWith(`@${q}`)) return 380;
  if (hint.split(/\s+/).some((word) => word.startsWith(q))) return 300;
  if (token.includes(q)) return 200;
  if (hint.includes(q) || label.includes(q)) return 100;
  return 0;
}

export function filterTeammateMentions(
  items: TeammateMentionItem[],
  query: string,
): TeammateMentionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items
    .map((item) => ({ item, score: teammateMentionScore(item, q) }))
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.hint.localeCompare(b.item.hint) ||
        a.item.token.localeCompare(b.item.token),
    )
    .map((row) => row.item);
}

export function insertTeammateMention(
  text: string,
  cursor: number,
  token: string,
): { text: string; cursor: number } {
  const clean = token.replace(/^@/, "").trim();
  if (!clean) return { text, cursor };
  const insert = `@${clean} `;
  const hit = fileMentionQuery(text, cursor);
  const start = hit?.start ?? cursor;
  const end = hit ? Math.max(cursor, start + 1 + hit.query.length) : cursor;
  const next = `${text.slice(0, start)}${insert}${text.slice(end)}`;
  return { text: next, cursor: start + insert.length };
}
