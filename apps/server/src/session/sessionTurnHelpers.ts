import type { AgentSession } from "@locus/shared";
import {
  isReviewSession,
  parseReviewSessionVerdict,
  requestedDefaultSubagent,
  runtimeNeedsGuest,
  sessionRuntime,
} from "@locus/shared";

export function sessionRulesChars(input: {
  instructions?: string;
  playbook?: string;
  memories?: string;
  pins?: string;
  rules?: string;
}): number {
  return [
    input.instructions ? `Operator instructions:\n${input.instructions}` : "",
    input.rules ? `Repository rules:\n${input.rules}` : "",
    input.playbook ? `Playbook:\n${input.playbook}` : "",
    input.memories ?? "",
    input.pins
      ? `Sticky design pins (keep these CSS selectors valid across rewrites):\n${input.pins}`
      : "",
  ]
    .filter(Boolean)
    .join("\n").length;
}

export function applyRequestedDefaultSubagent(current: AgentSession, text: string): void {
  const kind = requestedDefaultSubagent(text);
  if (kind) current.defaultSubagent = kind;
}

export function parkedStatus(session: {
  vmId?: string;
  runtime?: AgentSession["runtime"];
}): "idle" | "draft" {
  return session.vmId || !runtimeNeedsGuest(sessionRuntime(session)) ? "idle" : "draft";
}

export function llmResponseDetail(
  reply?: { content?: string; thinking?: string },
  toolCalls?: Array<{ name: string }>,
): string {
  const tools = toolCalls?.length ? `tools ${toolCalls.map((call) => call.name).join(",")}` : "";
  const text = reply?.content?.trim() ? `text ${reply.content.trim().length}` : "";
  const thinking = reply?.thinking?.trim() ? `thinking ${reply.thinking.trim().length}` : "";
  return [tools, text, thinking].filter(Boolean).join(" · ") || "blank";
}

export function withWorkspaceReadiness(prompt: string, note?: string): string {
  return note ? `${note}\n\n${prompt}` : prompt;
}

export function reviewTurnEndArgs(session?: AgentSession | null): Record<string, unknown> {
  if (!session || !isReviewSession(session)) return {};
  const verdict = parseReviewSessionVerdict(session.messages);
  return { review: verdict?.verdict ?? "missing" };
}
