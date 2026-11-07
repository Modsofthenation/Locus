import {
  boardNeedsYouItems,
  isAskUserToolName,
  type AgentSession,
  type BoardSummary,
  type BrainSummary,
} from "@locus/shared";

export type NeedsYouItem = {
  key: string;
  sessionId?: string;
  boardId?: string;
  objectId?: string;
  commentId?: string;
  section?: "brain";
  title: string;
  detail: string;
};

/** Tool waits that can Approve / Deny without an answer (not ask_user). */
export function isBatchableApproval(name: string): boolean {
  return !isAskUserToolName(name);
}

export function batchableApprovals<T extends { call: { name: string } }>(items: T[]): T[] {
  return items.filter((item) => isBatchableApproval(item.call.name));
}

export function needsYouHumanItems(sessions: AgentSession[]): NeedsYouItem[] {
  return needsYouItems(sessions).filter((row) => row.key.startsWith("h:"));
}

function pendingCalls(session: AgentSession): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  for (const message of session.messages) {
    for (const call of message.toolCalls ?? []) {
      if (call.approval !== "needed" || call.finishedAt) continue;
      if (seen.has(call.id)) continue;
      seen.add(call.id);
      out.push({ id: call.id, name: call.name });
    }
  }
  return out;
}

export function needsYouKeys(session: AgentSession): string[] {
  const keys = pendingCalls(session).map((call) => `a:${call.id}`);
  if (session.needsHuman?.trim()) keys.push(`h:${session.id}`);
  return keys;
}

export function sessionHasNeedsYou(session: AgentSession): boolean {
  if (session.archived) return false;
  return needsYouKeys(session).length > 0;
}

export function needsYouItems(
  sessions: AgentSession[],
  boards?: BoardSummary[],
  brain?: Pick<BrainSummary, "inboxCount"> | null,
): NeedsYouItem[] {
  const out: NeedsYouItem[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    if (session.archived) continue;
    for (const call of pendingCalls(session)) {
      const key = `a:${call.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        sessionId: session.id,
        title: session.title,
        detail: call.name.replace(/_/g, " "),
      });
    }
    const reason = session.needsHuman?.trim();
    if (reason) {
      const key = `h:${session.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, sessionId: session.id, title: session.title, detail: reason });
    }
  }
  for (const row of boardNeedsYouItems(boards ?? [])) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    out.push({
      key: row.key,
      boardId: row.boardId,
      objectId: row.objectId,
      commentId: row.commentId,
      title: row.title,
      detail: row.detail,
    });
  }
  const inbox = brain?.inboxCount ?? 0;
  if (inbox > 0) {
    out.push({
      key: "brain:inbox",
      section: "brain",
      title: "Brain",
      detail: inbox === 1 ? "1 graph correction" : `${inbox} graph corrections`,
    });
  }
  return out;
}

export function needsYouSessions(sessions: AgentSession[]): AgentSession[] {
  return sessions.filter(sessionHasNeedsYou);
}

export function needsYouCount(
  sessions: AgentSession[],
  boards?: BoardSummary[],
  brain?: Pick<BrainSummary, "inboxCount"> | null,
): number {
  return (
    needsYouSessions(sessions).length +
    boardNeedsYouItems(boards ?? []).length +
    (brain?.inboxCount ?? 0)
  );
}
