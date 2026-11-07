import type { AgentSession } from "@locus/shared";
import { lastUserPrompt } from "@locus/shared";
import { api } from "./api";

export async function startModelCompare(
  session: AgentSession,
  next: { providerId: string; model: string },
): Promise<{ a: AgentSession; b: AgentSession }> {
  const prompt = lastUserPrompt(session.messages);
  if (!prompt) throw new Error("Send a prompt first");
  const forked = await api.fork(session.id);
  const groupId = crypto.randomUUID();
  const b = await api.patchSession(forked.id, {
    providerId: next.providerId,
    model: next.model,
    title: `${session.title} · B`,
    compare: { groupId, role: "B", peerId: session.id },
  });
  const a = await api.patchSession(session.id, {
    compare: { groupId, role: "A", peerId: b.id },
  });
  await api.startVm(b.id).catch(() => undefined);
  await api.chat(b.id, prompt);
  return { a, b };
}

export async function pickCompareWinner(
  winner: AgentSession,
  ...losers: AgentSession[]
): Promise<AgentSession> {
  for (const loser of losers) {
    if (loser.id === winner.id) continue;
    await api.abortChat(loser.id).catch(() => undefined);
    await api.stopVm(loser.id).catch(() => undefined);
    await api.patchSession(loser.id, { archived: true, compare: null });
  }
  return api.patchSession(winner.id, { compare: null });
}

export async function startWorkers(session: AgentSession, count = 3): Promise<AgentSession[]> {
  const prompt = lastUserPrompt(session.messages);
  if (!prompt) throw new Error("Send a prompt first");
  return api.spawnWorkers(session.id, { count, prompt });
}
