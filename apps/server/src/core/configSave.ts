import { join } from "node:path";
import {
  BUILTIN_SLASH_NAMES,
  agentRoundLimit,
  approvalTimeoutMs,
  automationChatLimit,
  guestBootTimeoutMs,
  invalidHttpUrl,
  awsEndpointUrlError,
  promptQueueLimit,
  isAutonomyTier,
  isCursorCliProvider,
  isClaudeCodeProvider,
  isCodexCliProvider,
  isKiroCliProvider,
  isLoopbackHost,
  isThemeId,
  normalizePlugins,
  normalizeSkills,
  parseAllowHosts,
  parseApprovalPolicy,
  parseWorkerBackend,
  qemuPathUnsafe,
  validateHardwareOverride,
  validateMcpServer,
  validatePlugin,
  validateSkill,
  workerBackendError,
  namedEnvironmentsError,
  parseNamedEnvironments,
  parseDesktopNotifyPrefs,
  parseChatDensity,
  inspectIntegrationToken,
  policyTokenFree,
  policyTokenScopeMode,
  stampIntegrationToken,
  type LocusConfig,
} from "@locus/shared";
import { validateTemplate as validateVmTemplate } from "@locus/hypervisor";
import { mergeSecrets } from "./redact.js";

export type ConfigSaveResult = { ok: true; config: LocusConfig } | { ok: false; error: string };

export function providerBaseUrlError(provider: {
  name: string;
  kind?: string;
  baseUrl: string;
}): string | undefined {
  if (
    isCursorCliProvider(provider) ||
    isClaudeCodeProvider(provider) ||
    isCodexCliProvider(provider) ||
    isKiroCliProvider(provider)
  )
    return undefined;
  return invalidHttpUrl(provider.baseUrl, `${provider.name} base URL`);
}

/** Merge incoming Settings with stored secrets, lock managed policy, then normalize. */
export function prepareSavedConfig(
  current: LocusConfig,
  body: LocusConfig,
  dataDir: string,
): ConfigSaveResult {
  const merged = mergeSecrets(current, body);
  merged.managedPolicy = current.managedPolicy;
  return normalizeSavedConfig(merged, body.theme, dataDir);
}

/** Validate and normalize a merged Settings payload. One interface for PUT /api/config. */
export function normalizeSavedConfig(
  merged: LocusConfig,
  incomingTheme: LocusConfig["theme"] | undefined,
  dataDir: string,
): ConfigSaveResult {
  if (incomingTheme !== undefined && !isThemeId(incomingTheme)) {
    return { ok: false, error: "Unknown theme" };
  }
  if (!isLoopbackHost(merged.advanced.bindHost || "127.0.0.1")) {
    return { ok: false, error: "Bind host must be loopback (127.0.0.1, ::1, or localhost)" };
  }
  for (const provider of merged.providers) {
    const urlError = providerBaseUrlError(provider);
    if (urlError) return { ok: false, error: urlError };
  }
  for (const forge of merged.forges) {
    const urlError = invalidHttpUrl(forge.apiBaseUrl, `${forge.name} API URL`);
    if (urlError) return { ok: false, error: urlError };
  }
  for (const row of merged.integrations ?? []) {
    if (row.kind !== "aws") continue;
    const iamError = awsEndpointUrlError(row.baseUrl, "IAM endpoint");
    if (iamError) return { ok: false, error: iamError };
    const stsError = awsEndpointUrlError(row.stsUrl, "STS endpoint");
    if (stsError) return { ok: false, error: stsError };
    const gatewayError = awsEndpointUrlError(row.gatewayUrl, "AWS gateway URL");
    if (gatewayError) return { ok: false, error: gatewayError };
  }
  for (const t of merged.templates) {
    const errors = validateVmTemplate(t);
    if (errors.length) return { ok: false, error: errors.join("; ") };
    if (qemuPathUnsafe(t.isoPath) || qemuPathUnsafe(t.virtioIsoPath ?? "")) {
      return {
        ok: false,
        error: `${t.name} ISO path contains characters that cannot be passed to QEMU`,
      };
    }
  }
  for (const profile of merged.hardwareProfiles) {
    if (!profile.name.trim()) return { ok: false, error: "Hardware profile name is required" };
    if (!profile.repoPattern.trim())
      return { ok: false, error: "Hardware profile repo pattern is required" };
    const hwError = validateHardwareOverride(profile.hardware);
    if (hwError) return { ok: false, error: hwError };
  }
  merged.mcpServers = merged.mcpServers ?? [];
  for (const server of merged.mcpServers) {
    const mcpError = validateMcpServer(server);
    if (mcpError) return { ok: false, error: mcpError };
  }
  merged.skills = Array.isArray(merged.skills) ? merged.skills : [];
  for (const skill of merged.skills) {
    const skillError = validateSkill(skill, merged.skills, BUILTIN_SLASH_NAMES);
    if (skillError) return { ok: false, error: skillError };
  }
  merged.skills = normalizeSkills(merged.skills);
  merged.integrationPlugins = normalizePlugins(merged.integrationPlugins);
  for (const plugin of merged.integrationPlugins) {
    const pluginError = validatePlugin(plugin, merged.integrationPlugins);
    if (pluginError) return { ok: false, error: pluginError };
  }
  merged.workers = merged.workers ?? [];
  const workers = [];
  const workerIds = new Set<string>();
  for (const row of merged.workers) {
    const parsed = parseWorkerBackend(row);
    if (!parsed) {
      return { ok: false, error: "Each worker needs a name and http(s) URL" };
    }
    const workerError = workerBackendError(parsed);
    if (workerError) return { ok: false, error: workerError };
    if (workerIds.has(parsed.id)) {
      return { ok: false, error: `Duplicate worker id: ${parsed.id}` };
    }
    workerIds.add(parsed.id);
    workers.push(parsed);
  }
  merged.workers = workers;
  merged.namedEnvironments = parseNamedEnvironments(merged.namedEnvironments);
  const envError = namedEnvironmentsError(merged.namedEnvironments, {
    workerIds: workers.map((row) => row.id),
  });
  if (envError) return { ok: false, error: envError };
  merged.advanced.maxAgentRounds = agentRoundLimit(merged.advanced.maxAgentRounds);
  merged.advanced.approvalPolicy = parseApprovalPolicy(merged.advanced.approvalPolicy);
  if (merged.advanced.autonomy != null && !isAutonomyTier(merged.advanced.autonomy)) {
    merged.advanced.autonomy = undefined;
  }
  if (typeof merged.advanced.maxUsdPerTurn === "number") {
    merged.advanced.maxUsdPerTurn =
      merged.advanced.maxUsdPerTurn > 0 ? merged.advanced.maxUsdPerTurn : undefined;
  }
  if (typeof merged.advanced.maxMsPerTurn === "number") {
    merged.advanced.maxMsPerTurn =
      merged.advanced.maxMsPerTurn > 0 ? Math.round(merged.advanced.maxMsPerTurn) : undefined;
  }
  if (typeof merged.advanced.maxSubagentsPerTurn === "number") {
    const n = Math.round(merged.advanced.maxSubagentsPerTurn);
    merged.advanced.maxSubagentsPerTurn = n > 0 ? Math.min(8, n) : undefined;
  }
  merged.advanced.guestBootTimeoutMs = guestBootTimeoutMs(merged.advanced.guestBootTimeoutMs);
  merged.advanced.approvalTimeoutMs = approvalTimeoutMs(merged.advanced.approvalTimeoutMs);
  merged.advanced.maxPromptQueue = promptQueueLimit(merged.advanced.maxPromptQueue);
  merged.advanced.maxAutomationChats = automationChatLimit(merged.advanced.maxAutomationChats);
  if (
    merged.advanced.notifyWebhook &&
    invalidHttpUrl(merged.advanced.notifyWebhook, "Notify webhook")
  ) {
    return {
      ok: false,
      error: invalidHttpUrl(merged.advanced.notifyWebhook, "Notify webhook")!,
    };
  }
  if (
    merged.advanced.webhookBaseUrl &&
    invalidHttpUrl(merged.advanced.webhookBaseUrl, "Webhook base URL")
  ) {
    return {
      ok: false,
      error: invalidHttpUrl(merged.advanced.webhookBaseUrl, "Webhook base URL")!,
    };
  }
  merged.advanced.extraAllowHosts = parseAllowHosts(merged.advanced.extraAllowHosts);
  if (typeof merged.defaultDesignSystemId === "string") {
    merged.defaultDesignSystemId = merged.defaultDesignSystemId.trim() || undefined;
  } else {
    merged.defaultDesignSystemId = undefined;
  }
  if (typeof merged.defaultAssetStyleId === "string") {
    merged.defaultAssetStyleId = merged.defaultAssetStyleId.trim() || undefined;
  } else {
    merged.defaultAssetStyleId = undefined;
  }
  if (typeof merged.defaultGameStyleId === "string") {
    merged.defaultGameStyleId = merged.defaultGameStyleId.trim() || undefined;
  } else {
    merged.defaultGameStyleId = undefined;
  }
  Object.assign(merged, parseDesktopNotifyPrefs(merged));
  merged.chatDensity = parseChatDensity(merged.chatDensity);
  if (typeof merged.advanced.slackSigningSecret === "string") {
    merged.advanced.slackSigningSecret = merged.advanced.slackSigningSecret.trim() || undefined;
  }
  if (!merged.advanced.hostSharePath?.trim()) {
    merged.advanced.hostSharePath = join(merged.advanced.dataDir || dataDir, "share");
  }
  if (qemuPathUnsafe(merged.advanced.hostSharePath ?? "")) {
    return {
      ok: false,
      error: "Host share path contains characters that cannot be passed to QEMU",
    };
  }
  const stamped = stampSavedIntegrations(merged);
  const hygiene = integrationHygieneError(stamped);
  if (hygiene) return { ok: false, error: hygiene };
  return { ok: true, config: stamped };
}

function stampSavedIntegrations(config: LocusConfig): LocusConfig {
  const now = new Date().toISOString();
  return {
    ...config,
    integrations: (config.integrations ?? []).map((row) => {
      const stamped = stampIntegrationToken(row, now);
      const hygiene = inspectIntegrationToken(stamped);
      return { ...stamped, tokenWarning: hygiene.warning };
    }),
  };
}

function integrationHygieneError(config: LocusConfig): string | undefined {
  const status = config.managedPolicy;
  if (policyTokenFree(status)) {
    const personal = (config.integrations ?? []).find(
      (row) => row.token?.trim() || row.userToken?.trim() || row.refreshToken?.trim(),
    );
    if (personal) {
      return "Managed policy is token-free — personal integration tokens are not stored. Use the managed integration proxy.";
    }
  }
  if (policyTokenScopeMode(status) !== "block") return undefined;
  for (const row of config.integrations ?? []) {
    const hygiene = inspectIntegrationToken(row);
    if (hygiene.extraScopes.length) {
      return `${row.name}: ${hygiene.warning}`;
    }
  }
  return undefined;
}
