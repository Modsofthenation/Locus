import type { ChatMessage } from "./models/session.js";

export const INTERRUPTED_TURN_NOTE =
  "Recovered from an interrupted turn. Completed tool results are in the thread. Undo restores the pre-turn snapshot. Send a message to continue.";

export const CANCELLED_TURN_NOTE =
  "Turn cancelled. The last checkpoint is still available via Undo so the tree stays consistent.";

export function completedToolCallIds(messages: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId) ids.add(message.toolCallId);
  }
  return ids;
}

export function toolResultForCall(messages: ChatMessage[], callId: string): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "tool" && message.toolCallId === callId) return message.content;
  }
  return undefined;
}
