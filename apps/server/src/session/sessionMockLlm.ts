import type { AgentSession } from "@locus/shared";
import { guestLabel, sessionRepoCheckouts, sessionRuntime } from "@locus/shared";
import type { ChatEvent } from "@locus/providers";

const DEMO_REPLY_LEAD =
  "**Demo reply** — no provider key is configured, so this is a simulated answer. Add a key in Settings → Providers (Ollama and other localhost servers need no key).";

export async function* mockChunks(text: string): AsyncGenerator<ChatEvent> {
  for (let i = 0; i < text.length; i += 12) {
    yield { type: "text", text: text.slice(i, i + 12) };
  }
}

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
  if (plan) {
    return [
      host ? "1. Answer the question in chat" : `1. Inspect the ${label} workspace`,
      `2. Make the requested change: ${content.trim()}`,
      "3. Verify the result",
    ].join("\n");
  }
  if (host) {
    const checkouts = sessionRepoCheckouts(session);
    const repo = checkouts.length
      ? `I will clone ${checkouts.map((row) => `\`${row.url}\`${row.dest ? ` into \`${row.dest}\`` : ""}`).join(" and ")} on this machine.`
      : "No repository is attached. You can add a GitHub, GitLab, or Bitbucket URL in session settings.";
    return [
      DEMO_REPLY_LEAD,
      "",
      "Host agent — no VM or container. Workspace is `/workspace` on this machine.",
      repo,
      "",
      `I heard: *${content.trim()}*`,
      "",
      "I can read and edit files, run a shell, and use git on this machine. I cannot control a desktop or headed browser.",
    ].join("\n");
  }
  const vm = vmStatus
    ? `${docker ? "Container" : "Guest"} is **${vmStatus}**.`
    : docker
      ? "No container is attached yet — start it from the toolbar."
      : "No VM is attached yet — start the machine from the toolbar.";
  const checkouts = sessionRepoCheckouts(session);
  const repo = checkouts.length
    ? `I will clone ${checkouts.map((row) => `\`${row.url}\`${row.dest ? ` into \`${row.dest}\`` : ""}`).join(" and ")} into the ${docker ? "container" : "guest"} workspace.`
    : "No repository is attached. You can add a GitHub, GitLab, or Bitbucket URL in session settings.";
  return [
    DEMO_REPLY_LEAD,
    "",
    docker ? `Working in a **${label}** container.` : `Working in a **${label}** agent VM.`,
    vm,
    repo,
    "",
    `I heard: *${content.trim()}*`,
    "",
    docker
      ? "I will use shell, files, git, and headed Chromium (screenshot / click / type) inside this container rather than on your host."
      : "Once the real hypervisor and guest agent are connected, I will use OS-specific computer-use tools (shell, desktop, files, git) inside this machine rather than on your host.",
  ].join("\n");
}

export const EMPTY_MODEL_REPLY =
  "The model returned no reply. Your prompt is still in the thread — send it again, or check the provider and model in Settings.";
