import { hasUsableKey, supportsOneShotCompletion, type AiProvider } from "./provider.js";

/**
 * A per-step model choice: a child agent (`spawn_agent`) or a workflow agent node
 * asking to run on a different configured provider/model than its session.
 */
export interface ModelRouteRequest {
  /** Provider id, display name, or kind (e.g. "anthropic"). Case-insensitive except id. */
  provider?: string;
  /** Model id. Without a provider, the session's provider is kept when it can serve it. */
  model?: string;
}

export type ModelRouteResult =
  | { ok: true; provider: AiProvider; model: string; overridden: boolean }
  | { ok: false; error: string };

/**
 * A provider a step can be handed to: enabled, keyed, and callable as a plain chat
 * turn. CLI agents and Cursor Cloud run their own loop, so they cannot serve a step.
 */
export function canServeModelRoute(provider: AiProvider): boolean {
  return (
    provider.enabled &&
    hasUsableKey(provider.apiKey, provider.baseUrl, provider.kind) &&
    supportsOneShotCompletion(provider)
  );
}

function routeChoices(providers: AiProvider[]): string {
  const rows = providers
    .filter(canServeModelRoute)
    .map((row) => `${row.name} (${row.id}) · ${row.defaultModel}`);
  return rows.length ? ` Available: ${rows.join("; ")}.` : " No other provider is usable.";
}

function findProvider(providers: AiProvider[], token: string): AiProvider | undefined {
  const lower = token.toLowerCase();
  const byId = providers.find((row) => row.id === token);
  if (byId) return byId;
  const byName = providers.filter((row) => row.name.toLowerCase() === lower);
  const byKind = providers.filter((row) => row.kind.toLowerCase() === lower);
  for (const group of [byName, byKind]) {
    if (!group.length) continue;
    return group.find(canServeModelRoute) ?? group[0];
  }
  return undefined;
}

function whyUnusable(provider: AiProvider): string {
  if (!supportsOneShotCompletion(provider)) {
    return `${provider.name} runs its own agent loop and cannot serve a single step`;
  }
  if (!provider.enabled) return `${provider.name} is disabled in Settings → Providers`;
  return `${provider.name} has no API key`;
}

/**
 * Resolve which provider/model a step runs on. No request keeps the session's
 * provider and model. A provider that is missing or unusable is an error that
 * lists the usable choices, so a model calling a tool can correct itself.
 */
export function resolveModelRoute(
  providers: AiProvider[],
  request: ModelRouteRequest | undefined,
  current: { provider: AiProvider; model: string },
): ModelRouteResult {
  const token = request?.provider?.trim() ?? "";
  const model = request?.model?.trim() ?? "";
  if (!token && !model) {
    return { ok: true, provider: current.provider, model: current.model, overridden: false };
  }
  let provider = current.provider;
  if (token) {
    const found = findProvider(providers, token);
    if (!found) {
      return {
        ok: false,
        error: `No provider "${token}" is configured.${routeChoices(providers)}`,
      };
    }
    if (found.id !== current.provider.id && !canServeModelRoute(found)) {
      return { ok: false, error: `${whyUnusable(found)}.${routeChoices(providers)}` };
    }
    provider = found;
  } else if (current.provider.models.length && !current.provider.models.includes(model)) {
    provider =
      providers.find((row) => canServeModelRoute(row) && row.models.includes(model)) ??
      current.provider;
  }
  const chosen =
    model || (provider.id === current.provider.id ? current.model : provider.defaultModel);
  if (!chosen) {
    return { ok: false, error: `${provider.name} has no default model; pass model.` };
  }
  return {
    ok: true,
    provider,
    model: chosen,
    overridden: provider.id !== current.provider.id || chosen !== current.model,
  };
}
