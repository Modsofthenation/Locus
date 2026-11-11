import type { AgentSession, ChatMessage, SubagentLive } from "@locus/shared";

function preferFullerMessage(local: ChatMessage, incoming: ChatMessage): ChatMessage {
  const nextMsg: ChatMessage = {
    ...incoming,
    content: local.content.length >= incoming.content.length ? local.content : incoming.content,
  };
  const oldThink = local.thinking ?? "";
  const newThink = incoming.thinking ?? "";
  if (oldThink.length >= newThink.length && local.thinking != null) {
    nextMsg.thinking = local.thinking;
  }
  const localTools = local.toolCalls;
  const incomingTools = incoming.toolCalls;
  if (
    localTools?.length &&
    (!incomingTools?.length ||
      localTools.some((call, i) => {
        const other = incomingTools[i];
        if (!other) return true;
        return (
          (call.result?.length ?? 0) > (other.result?.length ?? 0) ||
          JSON.stringify(call.arguments).length > JSON.stringify(other.arguments).length
        );
      }))
  ) {
    nextMsg.toolCalls = localTools;
  }
  if (local.images?.some((img) => img.base64)) nextMsg.images = local.images;
  if (local.screenshotBase64) nextMsg.screenshotBase64 = local.screenshotBase64;
  return nextMsg;
}

function mergeSubagentRows(
  prev: SubagentLive[] | undefined,
  next: SubagentLive[] | undefined,
): SubagentLive[] | undefined {
  if (!next?.length) return prev;
  if (!prev?.length) return next;
  const prevById = new Map(prev.map((row) => [row.id, row]));
  return next.map((row) => {
    const old = prevById.get(row.id);
    if (!old?.messages?.length) return row;
    const oldById = new Map(old.messages.map((message) => [message.id, message]));
    const messages = (row.messages ?? []).map((message) => {
      const prevMsg = oldById.get(message.id);
      return prevMsg ? preferFullerMessage(prevMsg, message) : message;
    });
    return { ...old, ...row, messages };
  });
}

function listViewNeedsRefetch(prev: AgentSession, next: AgentSession): boolean {
  const prevIds = new Set(prev.messages.map((row) => row.id));
  if (next.messages.length !== prev.messages.length) return true;
  if (next.messages.some((row) => !prevIds.has(row.id))) return true;
  const prevAgents = new Map((prev.subagents ?? []).map((row) => [row.id, row]));
  for (const row of next.subagents ?? []) {
    const old = prevAgents.get(row.id);
    if (!old) return true;
    const oldIds = new Set((old.messages ?? []).map((message) => message.id));
    if ((row.messages ?? []).some((message) => !oldIds.has(message.id))) return true;
  }
  return false;
}

/** Merge a streaming Session snapshot into the fuller local transcript. */
export function mergeSession(prev: AgentSession, next: AgentSession): AgentSession {
  if (next.listView && !prev.listView && prev.messages.length > 0) {
    const { listView: _drop, messages: _messages, subagents: _subagents, ...meta } = next;
    const prevById = new Map(prev.messages.map((row) => [row.id, row]));
    const messages = next.messages.map((message) => {
      const old = prevById.get(message.id);
      return old ? preferFullerMessage(old, message) : message;
    });
    const merged: AgentSession = {
      ...prev,
      ...meta,
      messages,
      subagents: mergeSubagentRows(prev.subagents, next.subagents),
    };
    if (listViewNeedsRefetch(prev, next)) merged.listView = true;
    else delete merged.listView;
    return merged;
  }
  const prevById = new Map(prev.messages.map((row) => [row.id, row]));
  const messages = next.messages.map((m) => {
    const old = prevById.get(m.id);
    if (!old) return m;
    let nextMsg = m;
    if (old.content.length > m.content.length && old.content.startsWith(m.content)) {
      nextMsg = { ...nextMsg, content: old.content };
    }
    const oldThink = old.thinking ?? "";
    const newThink = m.thinking ?? "";
    if (oldThink.length > newThink.length && oldThink.startsWith(newThink)) {
      nextMsg = { ...nextMsg, thinking: oldThink };
    }
    return nextMsg;
  });
  const merged = { ...next, messages };
  if (!next.listView) delete merged.listView;
  return merged;
}
