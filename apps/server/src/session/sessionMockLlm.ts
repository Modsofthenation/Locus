import type { AgentSession } from "@locus/shared";
import {
  guestLabel,
  isAssetSession,
  isCanvasSession,
  isGameSession,
  sessionRuntime,
} from "@locus/shared";
import type { ChatEvent } from "@locus/providers";

export async function* mockChunks(text: string): AsyncGenerator<ChatEvent> {
  for (let i = 0; i < text.length; i += 12) {
    yield { type: "text", text: text.slice(i, i + 12) };
  }
}

/**
 * One short line. The chat's demo-mode banner already explains how to add a provider,
 * so the reply only says what did (not) happen.
 */
export function mockAssistantReply(
  content: string,
  session: AgentSession,
  vmStatus?: string,
  plan?: boolean,
): string {
  const host = sessionRuntime(session) === "host";
  const docker = !host && sessionRuntime(session) === "docker";
  const label = host
    ? "host"
    : docker
      ? (session.dockerImage ?? "container")
      : guestLabel(session.os);
  const asked = content.trim();
  if (plan) {
    return [
      host ? "1. Answer the question in chat" : `1. Inspect the ${label} workspace`,
      `2. Make the requested change: ${asked}`,
      "3. Verify the result",
    ].join("\n");
  }
  const status = vmStatus ? `${docker ? "Container" : "Guest"} is **${vmStatus}**` : "";
  if (isCanvasSession(session)) {
    const what = isGameSession(session) ? "game" : isAssetSession(session) ? "asset" : "design";
    const note = status ? ` (${status})` : "";
    return `**Demo reply**${note} — no provider key is configured, so the canvas keeps a starter ${what} for *${asked}*.`;
  }
  const where = host ? "Host agent" : status ? `${label} · ${status}` : label;
  return `**Demo reply** (${where}) — no provider key is configured, so nothing ran for *${asked}*.`;
}

export const EMPTY_MODEL_REPLY =
  "The model returned no reply. Your prompt is still in the thread — send it again, or check the provider and model in Settings.";
