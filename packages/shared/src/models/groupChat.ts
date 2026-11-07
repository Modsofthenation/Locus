import type { ChatMessage, TeamEventKind } from "./session.js";

/** Cap for project context injected into group-chat turns (full projects keep 8k). */
export const GROUP_CHAT_CONTEXT_PROMPT_BUDGET = 2_000;
/** Recent shared-thread excerpt packed into a mention prompt. */
export const GROUP_CHAT_THREAD_BUDGET = 1_600;
export const GROUP_CHAT_THREAD_MAX_TURNS = 10;
export const GROUP_CHAT_THREAD_LINE_CHARS = 240;
/** Fold oldest team events on the shared transcript sooner than fleet projects. */
export const GROUP_CHAT_TEAM_EVENT_FOLD_AT = 24;
export const GROUP_CHAT_TEAM_EVENT_FOLD_BATCH = 12;
export const GROUP_CHAT_TEAM_EVENT_SUMMARY_CHARS = 2_000;

/**
 * Mention routing already posts the peer's reply on the shared transcript.
 * Skip a coordinator LLM wake for ordinary completions; still wake on
 * needs_you / blocked so someone can reassign or ask the operator.
 */
export function shouldWakeGroupChatRequester(kind: TeamEventKind, wakeRequester = true): boolean {
  if (wakeRequester) return true;
  return kind !== "done";
}

function clipLine(text: string, max: number): string {
  const line = text.trim().replace(/\s+/g, " ");
  if (line.length <= max) return line;
  return `${line.slice(0, Math.max(1, max - 1))}…`;
}

function groupChatSpeaker(message: ChatMessage): string {
  if (message.role === "user") return "Operator";
  const name = message.speaker?.displayName?.trim();
  return name || "Locus";
}

/** Compact recent operator / teammate turns for a mention prompt. */
export function formatGroupChatThread(
  messages: ChatMessage[],
  opts?: { budget?: number; maxTurns?: number; lineChars?: number },
): string {
  const budget = Math.max(240, Math.floor(opts?.budget ?? GROUP_CHAT_THREAD_BUDGET));
  const maxTurns = Math.max(2, Math.floor(opts?.maxTurns ?? GROUP_CHAT_THREAD_MAX_TURNS));
  const lineChars = Math.max(80, Math.floor(opts?.lineChars ?? GROUP_CHAT_THREAD_LINE_CHARS));
  const rows = messages.filter(
    (message) =>
      !message.compact &&
      !message.hidden &&
      (message.role === "user" || message.role === "assistant") &&
      Boolean(message.content?.trim()),
  );
  const lines = rows.slice(-maxTurns).map((message) => {
    const who = groupChatSpeaker(message);
    const body = clipLine(message.content, lineChars);
    const prefix = `${who}:`;
    if (body.toLowerCase().startsWith(prefix.toLowerCase())) return body;
    return `${prefix} ${body}`;
  });
  while (lines.length > 2 && lines.join("\n").length > budget) {
    lines.shift();
  }
  const text = lines.join("\n");
  if (text.length <= budget) return text;
  const sliced = text.slice(text.length - budget);
  const nl = sliced.indexOf("\n");
  return nl >= 0 ? sliced.slice(nl + 1) : sliced;
}

/** Short mention prompt: recent shared thread + the operator request. */
export function groupChatMentionPrompt(input: {
  title: string;
  request: string;
  thread?: string;
}): string {
  const title = input.title.trim() || "group";
  const request = input.request.trim();
  const thread = input.thread?.trim();
  const parts = [
    `Group chat "${title}" — you were mentioned. Reply with a concise status or result for the shared thread.`,
  ];
  if (thread) parts.push(`Recent thread:\n${thread}`);
  if (request) parts.push(`Request: ${request}`);
  return parts.join("\n\n");
}
