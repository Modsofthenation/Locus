import { clusterChatThread, isHiddenChatMessage, type ChatMessage } from "@locus/shared";

export type ChatNewVisit = { sessionId: string; markerId?: string };

function visibleClusters(messages: ChatMessage[]) {
  return clusterChatThread(messages.filter((row) => !isHiddenChatMessage(row)));
}

function clusterIds(block: ReturnType<typeof visibleClusters>[number]): string[] {
  return block.kind === "turn"
    ? [block.message.id, ...block.tools.map((row) => row.id)]
    : [block.message.id];
}

/** Last operator-visible message id, including tools folded under a turn. */
export function lastVisibleMessageId(messages: ChatMessage[]): string | undefined {
  const clusters = visibleClusters(messages);
  const last = clusters[clusters.length - 1];
  if (!last) return undefined;
  const ids = clusterIds(last);
  return ids[ids.length - 1];
}

/**
 * First rendered cluster after `lastSeenId`. Undefined when nothing is unread
 * or the watermark is missing (compacted / never visited).
 */
export function firstNewClusterMessageId(
  messages: ChatMessage[],
  lastSeenId: string | undefined,
): string | undefined {
  if (!lastSeenId) return undefined;
  const clusters = visibleClusters(messages);
  let passed = false;
  for (const block of clusters) {
    if (!passed) {
      if (!clusterIds(block).includes(lastSeenId)) continue;
      passed = true;
      continue;
    }
    return block.message.id;
  }
  return undefined;
}

export function startChatVisit(
  sessionId: string,
  messages: ChatMessage[],
  lastSeenId: string | undefined,
): ChatNewVisit {
  return {
    sessionId,
    markerId: firstNewClusterMessageId(messages, lastSeenId),
  };
}

export function visitMarkerId(
  visit: ChatNewVisit | null | undefined,
  sessionId: string | undefined,
): string | undefined {
  if (!visit || !sessionId || visit.sessionId !== sessionId) return undefined;
  return visit.markerId;
}
