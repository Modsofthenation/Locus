import { lastUserPrompt, sessionGitBranch, type AgentSession } from "@locus/shared";

export type SessionSearchRow = Pick<
  AgentSession,
  "title" | "os" | "model" | "messages" | "gitBranch" | "compare" | "pull" | "repo"
>;

export function sessionSearchHaystack(session: SessionSearchRow): string {
  const prompts = session.messages
    .filter((row) => row.role === "user" && row.content.trim())
    .map((row) => row.content);
  const last = lastUserPrompt(session.messages);
  return [session.title, session.os, session.model, sessionGitBranch(session), last, ...prompts]
    .filter(Boolean)
    .join(" ");
}

function fieldMatches(value: string | undefined, q: string): boolean {
  return Boolean(value) && value!.toLowerCase().includes(q);
}

export function sessionMatchesQuery(session: SessionSearchRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (fieldMatches(session.title, q)) return true;
  if (fieldMatches(session.os, q)) return true;
  if (fieldMatches(session.model, q)) return true;
  if (fieldMatches(sessionGitBranch(session), q)) return true;
  for (let i = 0; i < session.messages.length; i += 1) {
    const row = session.messages[i];
    if (row?.role !== "user" || !row.content) continue;
    if (row.content.toLowerCase().includes(q)) return true;
  }
  return false;
}
