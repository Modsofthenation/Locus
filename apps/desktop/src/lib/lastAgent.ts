import {
  DEFAULT_DOCKER_IMAGE,
  isAgentPlacement,
  isAgentRuntime,
  isGuestOs,
  parseDockerImage,
  type AgentPlacement,
  type AgentRuntime,
  type AiProvider,
  type GuestOs,
  type LocusConfig,
  providerKnowsModel,
  type WorkerBackend,
} from "@locus/shared";

export interface LastAgentPrefs {
  os: GuestOs;
  runtime?: AgentRuntime;
  dockerImage?: string;
  hostDir?: string;
  providerId?: string;
  model?: string;
  placement?: AgentPlacement;
  backendId?: string;
}

export const LAST_AGENT_KEY = "locus.lastAgent";

export function loadLastAgent(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): LastAgentPrefs {
  const fallback: LastAgentPrefs = {
    os: "ubuntu",
    dockerImage: DEFAULT_DOCKER_IMAGE,
  };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(LAST_AGENT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<LastAgentPrefs>;
    const prefs: LastAgentPrefs = {
      os: parsed.os && isGuestOs(parsed.os) ? parsed.os : "ubuntu",
    };
    if (parsed.runtime && isAgentRuntime(parsed.runtime)) prefs.runtime = parsed.runtime;
    const image = typeof parsed.dockerImage === "string" ? parsed.dockerImage.trim() : "";
    if (parseDockerImage(image)) prefs.dockerImage = image;
    if (typeof parsed.hostDir === "string" && parsed.hostDir.trim())
      prefs.hostDir = parsed.hostDir.trim();
    if (typeof parsed.providerId === "string") prefs.providerId = parsed.providerId;
    if (typeof parsed.model === "string") prefs.model = parsed.model;
    if (parsed.placement && isAgentPlacement(parsed.placement)) prefs.placement = parsed.placement;
    if (typeof parsed.backendId === "string" && parsed.backendId.trim()) {
      prefs.backendId = parsed.backendId.trim();
    }
    return prefs;
  } catch {
    return fallback;
  }
}

export function saveLastAgent(
  prefs: LastAgentPrefs,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  storage?.setItem(LAST_AGENT_KEY, JSON.stringify(prefs));
}

export function rememberedWorkerId(prefs?: LastAgentPrefs, workers: WorkerBackend[] = []): string {
  if (prefs?.placement !== "worker" || !prefs.backendId) return "";
  return workers.some((row) => row.id === prefs.backendId) ? prefs.backendId : "";
}

export function rememberedRuntime(prefs?: LastAgentPrefs): AgentRuntime {
  if (prefs?.runtime === "vm" || prefs?.runtime === "docker" || prefs?.runtime === "host") {
    return prefs.runtime;
  }
  return "host";
}

/** First-run / empty prefs pick Docker when the engine is present. */
export function preferredRuntime(prefs?: LastAgentPrefs, dockerFound?: boolean): AgentRuntime {
  if (prefs?.runtime === "vm" || prefs?.runtime === "docker" || prefs?.runtime === "host") {
    return prefs.runtime;
  }
  return dockerFound ? "docker" : "host";
}

export function pickProvider(
  providers: AiProvider[],
  prefs?: LastAgentPrefs,
): AiProvider | undefined {
  const remembered = providers.find((p) => p.id === prefs?.providerId);
  if (remembered) return remembered;
  const enabled = providers.filter((p) => p.enabled);
  if (enabled.length) return enabled[0];
  return providers.find((p) => p.kind === "opencode") ?? providers[0];
}

export function resolveAgentDefaults(
  config: LocusConfig | null,
  os: GuestOs,
  prefs?: LastAgentPrefs,
): { templateId: string; providerId: string; model: string } {
  const templateId = config?.templates.find((t) => t.os === os)?.id ?? "";
  const provider = pickProvider(config?.providers ?? [], prefs);
  const model =
    prefs?.model && providerKnowsModel(provider, prefs.model)
      ? prefs.model
      : (provider?.defaultModel ?? "");
  return { templateId, providerId: provider?.id ?? "", model };
}

export function modelsForProvider(provider?: AiProvider, current?: string): string[] {
  const listed = [...(provider?.models ?? [])];
  if (provider?.defaultModel && !listed.includes(provider.defaultModel)) {
    listed.unshift(provider.defaultModel);
  }
  if (current && !listed.includes(current)) listed.unshift(current);
  return listed;
}
