import { WRITE_BODY_ARG_KEYS } from "./compact.js";
import type { AgentSession, ChatMessage, SubagentLive, ToolCall } from "./models/session.js";
import { TRACE_ARG_CHARS } from "./trace.js";

/** Tool results / write bodies in GET /api/sessions. Full transcript is GET /api/sessions/:id. */
export const LIST_VIEW_TOOL_CHARS = TRACE_ARG_CHARS;
/** Assistant / thinking text kept in the list payload. User prompts stay whole for search. */
export const LIST_VIEW_TEXT_CHARS = 8_000;

export function isSessionListView(session: Pick<AgentSession, "listView">): boolean {
  return session.listView === true;
}

function clipText(text: string | undefined, max: number): string | undefined {
  if (text == null || text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function slimArgs(args: Record<string, unknown>): Record<string, unknown> {
  let next: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string") continue;
    const max =
      (WRITE_BODY_ARG_KEYS as readonly string[]).includes(key) ||
      value.length > LIST_VIEW_TOOL_CHARS
        ? LIST_VIEW_TOOL_CHARS
        : value.length;
    if (value.length <= max) continue;
    next ??= { ...args };
    next[key] = `${value.slice(0, max - 1)}…`;
  }
  return next ?? args;
}

function slimToolCall(call: ToolCall): ToolCall {
  const args = slimArgs(call.arguments);
  const result = clipText(call.result, LIST_VIEW_TOOL_CHARS);
  const error = clipText(call.error, LIST_VIEW_TOOL_CHARS);
  if (args === call.arguments && result === call.result && error === call.error) return call;
  return { ...call, arguments: args, result, error };
}

function slimImages(message: ChatMessage): ChatMessage["images"] {
  const images = message.images;
  if (!images?.length) return images;
  let changed = false;
  const next = images.map((img) => {
    if (!img.base64) return img;
    changed = true;
    const { base64: _drop, ...rest } = img;
    return rest;
  });
  return changed ? next : images;
}

function slimMessage(message: ChatMessage): ChatMessage {
  const toolCalls = message.toolCalls?.map(slimToolCall);
  const toolsChanged = toolCalls?.some((call, i) => call !== message.toolCalls![i]);
  const images = slimImages(message);
  const contentMax =
    message.role === "user"
      ? message.content.length
      : message.role === "tool"
        ? LIST_VIEW_TOOL_CHARS
        : LIST_VIEW_TEXT_CHARS;
  const content = clipText(message.content, contentMax) ?? message.content;
  const thinking = clipText(message.thinking, LIST_VIEW_TEXT_CHARS);
  const dropShot = Boolean(message.screenshotBase64);
  if (
    !dropShot &&
    !toolsChanged &&
    images === message.images &&
    content === message.content &&
    thinking === message.thinking
  ) {
    return message;
  }
  const next: ChatMessage = {
    ...message,
    content,
    toolCalls: toolsChanged ? toolCalls : message.toolCalls,
    images,
    thinking,
  };
  if (dropShot) delete next.screenshotBase64;
  return next;
}

function slimSubagent(row: SubagentLive): SubagentLive {
  if (!row.messages?.length) return row;
  const messages = row.messages.map(slimMessage);
  if (messages.every((message, i) => message === row.messages![i])) return row;
  return { ...row, messages };
}

/**
 * Sidebar / `GET /api/sessions` payload: keep metadata, user prompts, and approval
 * chips, drop screenshot bytes and huge tool dumps. Does not mutate `session`.
 */
export function sessionListView(session: AgentSession): AgentSession {
  const messages = session.messages.map(slimMessage);
  const subagents = session.subagents?.map(slimSubagent);
  const clipped =
    messages.some((message, i) => message !== session.messages[i]) ||
    Boolean(subagents && session.subagents?.some((row, i) => row !== subagents[i]));
  if (!clipped) return session;
  return {
    ...session,
    listView: true,
    messages,
    ...(subagents ? { subagents } : {}),
  };
}

export function sessionListViews(sessions: AgentSession[]): AgentSession[] {
  return sessions.map(sessionListView);
}
