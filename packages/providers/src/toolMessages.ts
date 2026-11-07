import type { ChatMessage, ToolCall } from "@locus/shared";

export const UNANSWERED_TOOL_RESULT =
  "Tool did not finish (no result was recorded). Continue from the last successful step.";

/**
 * Providers reject a follow-up turn when an assistant `tool_calls` entry has no
 * matching tool message (OpenAI `invalid_request_error`). A turn can end after
 * the call is stored and before its result is written — cancel, a stale epoch,
 * or a tool that never returned. Close those calls before the next request.
 */
export function closeUnansweredToolCalls(messages: ChatMessage[]): ChatMessage[] {
  const pending = new Map<string, ChatMessage[]>();
  for (const message of messages) {
    if (message.role !== "tool" || !message.toolCallId) continue;
    const queue = pending.get(message.toolCallId) ?? [];
    queue.push(message);
    pending.set(message.toolCallId, queue);
  }
  const consumed = new Set<ChatMessage>();
  const out: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "tool") continue;
    if (message.role !== "assistant" || !message.toolCalls?.length) {
      out.push(message);
      continue;
    }
    const used = new Set<string>();
    const toolCalls: ToolCall[] = message.toolCalls.map((call, index) => ({
      ...call,
      id: uniqueToolCallId(call.id, index, used),
    }));
    out.push(toolCalls === message.toolCalls ? message : { ...message, toolCalls });
    for (let index = 0; index < message.toolCalls.length; index += 1) {
      const original = message.toolCalls[index]!;
      const id = toolCalls[index]!.id;
      const queue = pending.get(original.id);
      const existing = queue?.shift();
      if (existing) {
        consumed.add(existing);
        out.push(existing.toolCallId === id ? existing : { ...existing, toolCallId: id });
        continue;
      }
      out.push({
        id: `missing-${id}`,
        role: "tool",
        toolCallId: id,
        content: UNANSWERED_TOOL_RESULT,
        createdAt: message.createdAt,
      });
    }
  }
  return out;
}

function uniqueToolCallId(raw: string, index: number, used: Set<string>): string {
  const id = raw.trim() || `call_${index}`;
  if (!used.has(id)) {
    used.add(id);
    return id;
  }
  let n = 2;
  while (used.has(`${id}_${n}`)) n += 1;
  const next = `${id}_${n}`;
  used.add(next);
  return next;
}
