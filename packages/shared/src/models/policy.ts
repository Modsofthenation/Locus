import { providerLooksLikeAws } from "../awsEndpoint.js";
import type { AutonomyTier } from "./autonomy.js";
import type { LocusConfig } from "./config.js";
import type { IntegrationAccount } from "./integration.js";
import type { McpServerConfig } from "./mcp.js";
import {
  isClaudeCodeProvider,
  isCodexCliProvider,
  isCursorCliProvider,
  isCursorProvider,
  isKiroCliProvider,
  isLocalAgentCliProvider,
  isLocalOpenAiBase,
  isOllamaProvider,
  isOpenRouterProvider,
  type AiProvider,
} from "./provider.js";
import type { NetworkJail } from "./vm.js";

/** Admin-managed policy file (`/etc/locus/policy.json` or a signed `~/.locus/policy.json`). */
export const MANAGED_POLICY_VERSION = 1;
export const MANAGED_POLICY_MCP_ID = "managed-policy";
/** Token-free MCP id from 0.16.0; still stripped so a saved config does not keep two proxies. */
const LEGACY_MANAGED_POLICY_MCP_ID = "last-yard-policy";

function isManagedPolicyMcpId(id: string): boolean {
  return id === MANAGED_POLICY_MCP_ID || id === LEGACY_MANAGED_POLICY_MCP_ID;
}

/** Enterprise/API endpoints a locked profile allows by default. */
export const ENTERPRISE_PROVIDER_KEYS = ["anthropic", "openai", "bedrock", "ollama"] as const;
export type EnterpriseProviderKey = (typeof ENTERPRISE_PROVIDER_KEYS)[number];

export function isEnterpriseProviderKey(value: unknown): value is EnterpriseProviderKey {
  return (
    typeof value === "string" &&
    (ENTERPRISE_PROVIDER_KEYS as readonly string[]).includes(value.toLowerCase())
  );
}

export interface ManagedSandboxPolicy {
  allowHostAgents?: boolean;
  allowHostMcp?: boolean;
  allowHostAutomations?: boolean;
  allowLiveChrome?: boolean;
  allowPhoneRemote?: boolean;
  allowAutonomous?: boolean;
  /** Forced guest jail. Default restricted. */
  defaultJail?: "restricted" | "none";
  /** When true, operators cannot pick open networking. Default true when a profile is active. */
  forceJail?: boolean;
}

export interface ManagedPolicy {
  version: typeof MANAGED_POLICY_VERSION;
  /** Optional org label in the Settings banner. Missing uses "organization". */
  name?: string;
  /**
   * Allow-listed provider keys (`anthropic`, `openai`, `bedrock`, `ollama`) or concrete provider ids.
   * Missing uses the enterprise defaults. An empty list means nothing is allowed (Brain falls back
   * to local heuristics).
   */
  allowedProviders?: string[];
  /** Optional per-provider model allow-list. Missing or empty means any model on that provider. */
  allowedModels?: Record<string, string[]>;
  /** Block Cursor / Claude / Codex / Kiro consumer logins. Default true when a profile is active. */
  blockConsumerLogins?: boolean;
  /** Block custom OpenAI-compatible base URLs that are not Ollama or Bedrock. Default true. */
  blockArbitraryBaseUrls?: boolean;
  /** Pin Brain distiller to this provider key or id. */
  brainDistillerProvider?: string;
  brainDistillerModel?: string;
  sandbox?: ManagedSandboxPolicy;
  /** Outbound Giphy lookup. Default false when a profile is active. */
  gifLookup?: boolean;
  /** Integrations must not store personal tokens; use a managed MCP/proxy instead. */
  tokenFreeMode?: boolean;
  /** Managed MCP or HTTP proxy for token-free integrations. */
  integrationProxyUrl?: string;
  /** Extra write/admin scopes on save: warn (default) or block. */
  tokenScope?: "warn" | "block";
  /** Default-deny guest egress (restricted jail + logged allowlist). Default true. */
  defaultDenyEgress?: boolean;
}

export interface ManagedPolicyStatus {
  active: boolean;
  source?: string;
  signed?: boolean;
  policy: ManagedPolicy;
  locked: string[];
}

export const DEFAULT_MANAGED_POLICY: ManagedPolicy = {
  version: 1,
  allowedProviders: [...ENTERPRISE_PROVIDER_KEYS],
  blockConsumerLogins: true,
  blockArbitraryBaseUrls: true,
  sandbox: {
    allowHostAgents: false,
    allowHostMcp: false,
    allowHostAutomations: false,
    allowLiveChrome: false,
    allowPhoneRemote: false,
    allowAutonomous: false,
    defaultJail: "restricted",
    forceJail: true,
  },
  gifLookup: false,
  tokenFreeMode: false,
  tokenScope: "warn",
  defaultDenyEgress: true,
};

function strList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = item.trim().toLowerCase();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function strMap(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = key.trim().toLowerCase();
    if (!id) continue;
    const models = strList(value) ?? [];
    out[id] = models;
  }
  return out;
}

export function parseManagedPolicy(raw: unknown): ManagedPolicy | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (value.version != null && value.version !== 1 && value.version !== "1") return undefined;
  const sandboxRaw =
    value.sandbox && typeof value.sandbox === "object" && !Array.isArray(value.sandbox)
      ? (value.sandbox as Record<string, unknown>)
      : undefined;
  const defaultJail =
    sandboxRaw?.defaultJail === "none" || sandboxRaw?.defaultJail === "restricted"
      ? sandboxRaw.defaultJail
      : undefined;
  const tokenScope =
    value.tokenScope === "block" || value.tokenScope === "warn" ? value.tokenScope : undefined;
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : undefined;
  const brainDistillerProvider =
    typeof value.brainDistillerProvider === "string" && value.brainDistillerProvider.trim()
      ? value.brainDistillerProvider.trim()
      : undefined;
  const brainDistillerModel =
    typeof value.brainDistillerModel === "string" && value.brainDistillerModel.trim()
      ? value.brainDistillerModel.trim()
      : undefined;
  const integrationProxyUrl =
    typeof value.integrationProxyUrl === "string" && value.integrationProxyUrl.trim()
      ? value.integrationProxyUrl.trim()
      : undefined;
  const allowedProviders = strList(value.allowedProviders);
  return {
    version: 1,
    name,
    allowedProviders,
    allowedModels: strMap(value.allowedModels),
    blockConsumerLogins: value.blockConsumerLogins === false ? false : true,
    blockArbitraryBaseUrls: value.blockArbitraryBaseUrls === false ? false : true,
    brainDistillerProvider,
    brainDistillerModel,
    sandbox: sandboxRaw
      ? {
          allowHostAgents: sandboxRaw.allowHostAgents === true,
          allowHostMcp: sandboxRaw.allowHostMcp === true,
          allowHostAutomations: sandboxRaw.allowHostAutomations === true,
          allowLiveChrome: sandboxRaw.allowLiveChrome === true,
          allowPhoneRemote: sandboxRaw.allowPhoneRemote === true,
          allowAutonomous: sandboxRaw.allowAutonomous === true,
          defaultJail: defaultJail ?? "restricted",
          forceJail: sandboxRaw.forceJail === false ? false : true,
        }
      : { ...DEFAULT_MANAGED_POLICY.sandbox },
    gifLookup: value.gifLookup === true,
    tokenFreeMode: value.tokenFreeMode === true,
    integrationProxyUrl,
    tokenScope: tokenScope ?? "warn",
    defaultDenyEgress: value.defaultDenyEgress === false ? false : true,
  };
}

export function effectiveManagedPolicy(policy?: ManagedPolicy | null): ManagedPolicy {
  if (!policy)
    return { ...DEFAULT_MANAGED_POLICY, allowedProviders: [...ENTERPRISE_PROVIDER_KEYS] };
  return {
    ...DEFAULT_MANAGED_POLICY,
    ...policy,
    allowedProviders: policy.allowedProviders ?? [...ENTERPRISE_PROVIDER_KEYS],
    sandbox: { ...DEFAULT_MANAGED_POLICY.sandbox, ...policy.sandbox },
  };
}

export function inactiveManagedPolicyStatus(): ManagedPolicyStatus {
  return { active: false, policy: DEFAULT_MANAGED_POLICY, locked: [] };
}

export function managedPolicyLockedControls(policy: ManagedPolicy): string[] {
  const effective = effectiveManagedPolicy(policy);
  const locked: string[] = ["providers"];
  if (effective.sandbox?.allowHostAgents === false) locked.push("hostAgents");
  if (effective.sandbox?.allowHostMcp === false) locked.push("hostMcp");
  if (effective.sandbox?.allowHostAutomations === false) locked.push("hostAutomations");
  if (effective.sandbox?.allowLiveChrome === false) locked.push("liveChrome");
  if (effective.sandbox?.allowPhoneRemote === false) locked.push("phoneRemote");
  if (effective.sandbox?.allowAutonomous === false) locked.push("autonomous");
  if (effective.sandbox?.forceJail !== false) locked.push("jail");
  locked.push("brainDistiller");
  if (effective.gifLookup !== true) locked.push("gifLookup");
  if (effective.tokenFreeMode) locked.push("personalTokens");
  return locked;
}

function hostFromUrl(url?: string): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function isAnthropicApiBase(baseUrl?: string): boolean {
  const host = hostFromUrl(baseUrl);
  return host === "api.anthropic.com" || Boolean(host?.endsWith(".anthropic.com"));
}

export function isOpenAiApiBase(baseUrl?: string): boolean {
  const host = hostFromUrl(baseUrl);
  return host === "api.openai.com" || Boolean(host?.endsWith(".openai.com"));
}

export function isBedrockApiBase(baseUrl?: string): boolean {
  const host = hostFromUrl(baseUrl);
  if (!host) return false;
  return host.includes("bedrock") || providerLooksLikeAws({ baseUrl });
}

export function enterpriseProviderKey(
  provider: Pick<AiProvider, "kind" | "name" | "baseUrl"> & { id?: string },
): EnterpriseProviderKey | undefined {
  if (isOllamaProvider(provider) || provider.id === "ollama") return "ollama";
  if (provider.kind === "anthropic" && isAnthropicApiBase(provider.baseUrl)) return "anthropic";
  if (provider.kind === "openai" && isOpenAiApiBase(provider.baseUrl)) return "openai";
  if (providerLooksLikeAws(provider) || isBedrockApiBase(provider.baseUrl)) return "bedrock";
  return undefined;
}

export function isConsumerLoginProvider(
  provider: Pick<AiProvider, "kind" | "name" | "baseUrl">,
): boolean {
  if (
    isLocalAgentCliProvider(provider) ||
    isCursorProvider(provider) ||
    isCursorCliProvider(provider)
  ) {
    return true;
  }
  if (
    isClaudeCodeProvider(provider) ||
    isCodexCliProvider(provider) ||
    isKiroCliProvider(provider)
  ) {
    return true;
  }
  if (provider.kind === "opencode" || provider.kind === "xai" || provider.kind === "deepseek")
    return true;
  if (isOpenRouterProvider(provider)) return true;
  const name = provider.name?.trim().toLowerCase() ?? "";
  if (["gemini", "groq", "mistral", "together", "fireworks", "opencode"].includes(name))
    return true;
  return false;
}

export function isArbitraryProviderBase(
  provider: Pick<AiProvider, "kind" | "name" | "baseUrl">,
): boolean {
  if (enterpriseProviderKey(provider)) return false;
  if (isConsumerLoginProvider(provider)) return false;
  if (isLocalOpenAiBase(provider.baseUrl) && isOllamaProvider(provider)) return false;
  return Boolean(provider.baseUrl?.trim());
}

function allowList(policy: ManagedPolicy): string[] {
  return (policy.allowedProviders ?? [...ENTERPRISE_PROVIDER_KEYS]).map((row) => row.toLowerCase());
}

export function providerAllowedByPolicy(
  provider: Pick<AiProvider, "id" | "kind" | "name" | "baseUrl" | "defaultModel">,
  policy?: ManagedPolicy | null,
  active = true,
): boolean {
  if (!active || !policy) return true;
  const effective = effectiveManagedPolicy(policy);
  if (effective.blockConsumerLogins !== false && isConsumerLoginProvider(provider)) return false;
  if (
    effective.blockArbitraryBaseUrls !== false &&
    isArbitraryProviderBase(provider) &&
    !enterpriseProviderKey(provider)
  ) {
    return false;
  }
  const allow = allowList(effective);
  if (!allow.length) return false;
  const key = enterpriseProviderKey(provider);
  const id = provider.id.trim().toLowerCase();
  if (allow.includes(id)) return modelAllowedByPolicy(provider, effective);
  if (key && allow.includes(key)) return modelAllowedByPolicy(provider, effective);
  return false;
}

export function modelAllowedByPolicy(
  provider: Pick<AiProvider, "id" | "kind" | "name" | "baseUrl" | "defaultModel">,
  policy: ManagedPolicy,
  model?: string,
): boolean {
  const maps = policy.allowedModels ?? {};
  const key = enterpriseProviderKey(provider);
  const id = provider.id.trim().toLowerCase();
  const listed = maps[id] ?? (key ? maps[key] : undefined);
  if (!listed?.length) return true;
  const target = (model ?? provider.defaultModel ?? "").trim();
  if (!target) return true;
  return listed.includes(target.toLowerCase()) || listed.includes(target);
}

export function gifLookupAllowed(status?: ManagedPolicyStatus | null): boolean {
  if (!status?.active) return true;
  return status.policy.gifLookup === true;
}

export function policyAllowsHostAgents(status?: ManagedPolicyStatus | null): boolean {
  if (!status?.active) return true;
  return status.policy.sandbox?.allowHostAgents === true;
}

export function policyAllowsHostMcp(status?: ManagedPolicyStatus | null): boolean {
  if (!status?.active) return true;
  return status.policy.sandbox?.allowHostMcp === true;
}

export function policyAllowsHostAutomations(status?: ManagedPolicyStatus | null): boolean {
  if (!status?.active) return true;
  return status.policy.sandbox?.allowHostAutomations === true;
}

export function policyAllowsLiveChrome(status?: ManagedPolicyStatus | null): boolean {
  if (!status?.active) return true;
  return status.policy.sandbox?.allowLiveChrome === true;
}

export function policyAllowsPhoneRemote(status?: ManagedPolicyStatus | null): boolean {
  if (!status?.active) return true;
  return status.policy.sandbox?.allowPhoneRemote === true;
}

export function policyAllowsAutonomous(status?: ManagedPolicyStatus | null): boolean {
  if (!status?.active) return true;
  return status.policy.sandbox?.allowAutonomous === true;
}

export function policyForcedJail(status?: ManagedPolicyStatus | null): NetworkJail | undefined {
  if (!status?.active) return undefined;
  if (status.policy.sandbox?.forceJail === false) return undefined;
  return status.policy.sandbox?.defaultJail === "none" ? "none" : "restricted";
}

export function policyTokenFree(status?: ManagedPolicyStatus | null): boolean {
  return Boolean(status?.active && status.policy.tokenFreeMode);
}

export function policyTokenScopeMode(status?: ManagedPolicyStatus | null): "warn" | "block" {
  if (!status?.active) return "warn";
  return status.policy.tokenScope === "block" ? "block" : "warn";
}

export function policyBannerLabel(status?: ManagedPolicyStatus | null): string | undefined {
  if (!status?.active) return undefined;
  const name = status.policy.name?.trim() || "organization";
  return `Managed by ${name} policy`;
}

function clampAutonomy(tier: AutonomyTier | undefined, allow: boolean): AutonomyTier | undefined {
  if (!allow && tier === "autonomous") return "guided";
  return tier;
}

function managedPolicyMcp(url: string): McpServerConfig {
  return {
    id: MANAGED_POLICY_MCP_ID,
    name: "Managed integrations",
    enabled: true,
    command: "mcp",
    args: [],
    env: {},
    url,
    runtime: "host",
    managed: true,
  };
}

function clearIntegrationSecrets(row: IntegrationAccount): IntegrationAccount {
  return {
    ...row,
    token: undefined,
    userToken: undefined,
    appToken: undefined,
    refreshToken: undefined,
    sessionToken: undefined,
    accessKeyId: row.kind === "aws" && row.useInstanceMetadata ? row.accessKeyId : undefined,
  };
}

export function applyManagedPolicy(
  config: LocusConfig,
  status?: ManagedPolicyStatus | null,
): LocusConfig {
  const attached: LocusConfig = {
    ...config,
    managedPolicy: status?.active ? status : (status ?? inactiveManagedPolicyStatus()),
  };
  if (!status?.active) return attached;
  const policy = effectiveManagedPolicy(status.policy);
  const providers = config.providers.map((provider) => {
    const allowed = providerAllowedByPolicy(provider, policy, true);
    if (allowed) return provider;
    return { ...provider, enabled: false };
  });
  const distiller = pickPolicyDistiller(providers, policy);
  let mcpServers = [...(config.mcpServers ?? [])];
  if (policy.sandbox?.allowHostMcp === false) {
    mcpServers = mcpServers.map((server) => {
      if (isManagedPolicyMcpId(server.id) || server.managed) return server;
      if (server.url?.trim()) return { ...server, enabled: false };
      return { ...server, runtime: "guest" as const };
    });
  }
  if (policy.tokenFreeMode && policy.integrationProxyUrl) {
    mcpServers = [
      managedPolicyMcp(policy.integrationProxyUrl),
      ...mcpServers.filter((server) => !isManagedPolicyMcpId(server.id)),
    ];
  }
  const integrations = policy.tokenFreeMode
    ? (config.integrations ?? []).map(clearIntegrationSecrets)
    : config.integrations;
  return {
    ...attached,
    providers,
    mcpServers,
    integrations,
    phoneRemote:
      policy.sandbox?.allowPhoneRemote === false
        ? { ...config.phoneRemote, enabled: false, token: config.phoneRemote?.token }
        : config.phoneRemote,
    chromeExtension:
      policy.sandbox?.allowLiveChrome === false
        ? { ...config.chromeExtension, enabled: false, token: config.chromeExtension?.token }
        : config.chromeExtension,
    advanced: {
      ...config.advanced,
      autonomy: clampAutonomy(config.advanced.autonomy, policy.sandbox?.allowAutonomous === true),
    },
    brain: {
      ...config.brain,
      distillerProviderId: distiller?.providerId,
      distillerModel: distiller?.model,
    },
    managedPolicy: {
      ...status,
      policy,
      locked: managedPolicyLockedControls(policy),
    },
  };
}

export function pickPolicyDistiller(
  providers: AiProvider[],
  policy?: ManagedPolicy | null,
  active = true,
): { providerId: string; model: string } | undefined {
  if (!active || !policy) return undefined;
  const effective = effectiveManagedPolicy(policy);
  const allow = allowList(effective);
  if (!allow.length) return undefined;
  const pin = effective.brainDistillerProvider?.trim();
  const candidates = providers.filter(
    (row) => row.enabled && providerAllowedByPolicy(row, effective, true),
  );
  const pinned = pin
    ? candidates.find(
        (row) =>
          row.id === pin ||
          row.id.toLowerCase() === pin.toLowerCase() ||
          enterpriseProviderKey(row) === pin.toLowerCase(),
      )
    : undefined;
  const picked = pinned ?? candidates[0];
  if (!picked) return undefined;
  const models =
    effective.allowedModels?.[picked.id.toLowerCase()] ??
    (enterpriseProviderKey(picked)
      ? effective.allowedModels?.[enterpriseProviderKey(picked)!]
      : undefined);
  const model =
    effective.brainDistillerModel?.trim() ||
    (models?.[0] ? models[0] : undefined) ||
    picked.defaultModel ||
    picked.models[0];
  if (!model) return undefined;
  return { providerId: picked.id, model };
}

export function stripManagedPolicy<T extends { managedPolicy?: ManagedPolicyStatus }>(
  config: T,
): Omit<T, "managedPolicy"> {
  const { managedPolicy: _ignored, ...rest } = config;
  return rest;
}

export function policyRejectsCreate(input: {
  runtime?: string;
  autonomy?: string;
  network?: string;
  liveChrome?: boolean;
  status?: ManagedPolicyStatus | null;
}): string | undefined {
  const status = input.status;
  if (!status?.active) return undefined;
  if (input.runtime === "host" && !policyAllowsHostAgents(status)) {
    return "Managed policy does not allow Host agents";
  }
  if (input.autonomy === "autonomous" && !policyAllowsAutonomous(status)) {
    return "Managed policy does not allow Autonomous mode";
  }
  if (input.liveChrome && !policyAllowsLiveChrome(status)) {
    return "Managed policy does not allow Use my Chrome";
  }
  const forced = policyForcedJail(status);
  if (forced && input.network === "open") {
    return `Managed policy requires the ${forced} network jail`;
  }
  return undefined;
}
