import type { AgentSession, LinkedRepo, LocusConfig } from "@locus/shared";
import { api } from "@/lib/api";
import { loadLastAgent, resolveAgentDefaults, saveLastAgent } from "@/lib/lastAgent";

/**
 * Start a Host coding agent on a linked repo (it clones into a private folder on
 * this machine). Used when Docker is down and the person picks "Use Host instead".
 */
export async function startHostRepoAgent(input: {
  config: LocusConfig;
  repo?: LinkedRepo;
  title?: string;
  prompt?: string;
  providerId?: string;
  model?: string;
}): Promise<AgentSession> {
  const defaults = resolveAgentDefaults(input.config, "ubuntu", loadLastAgent());
  const providerId = input.providerId || defaults.providerId;
  const model = input.model || defaults.model;
  const session = await api.createSession({
    ...(input.title ? { title: input.title } : {}),
    os: "ubuntu",
    templateId:
      defaults.templateId ||
      input.config.templates.find((row) => row.os === "ubuntu")?.id ||
      "host",
    runtime: "host",
    providerId,
    model,
    startVm: false,
    vision: "off",
    ...(input.prompt?.trim() ? { prompt: input.prompt.trim() } : {}),
    ...(input.repo ? { repoId: input.repo.id, repo: input.repo.checkout, branchLock: true } : {}),
  });
  saveLastAgent({ os: "ubuntu", runtime: "host", providerId, model });
  return session;
}
