import { isCursorCliProvider, type AiProvider, type LocusConfig } from "@locus/shared";
import { listProviderModels } from "@locus/providers";
import type { JsonStore } from "../core/store.js";

export type ListProviderModelsFn = (provider: AiProvider) => Promise<string[]>;

function sameModelSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((id) => seen.has(id));
}

export function applyCursorCliModels(
  provider: AiProvider,
  models: string[],
): AiProvider | undefined {
  if (!models.length) return undefined;
  const defaultModel = models.includes(provider.defaultModel)
    ? provider.defaultModel
    : (models[0] ?? provider.defaultModel);
  if (sameModelSet(provider.models, models) && defaultModel === provider.defaultModel) {
    return undefined;
  }
  return { ...provider, models, defaultModel };
}

/** Fetch `agent models` for each Cursor CLI provider and persist when the catalog changed. */
export async function persistCursorCliModels(
  store: JsonStore,
  opts: { listModels?: ListProviderModelsFn; providerId?: string; models?: string[] } = {},
): Promise<{ config: LocusConfig; changed: boolean; models: string[] }> {
  const listModels = opts.listModels ?? listProviderModels;
  const config = await store.loadConfig();
  const listedById = new Map<string, string[]>();
  let models: string[] = opts.models ?? [];
  for (const provider of config.providers) {
    if (!isCursorCliProvider(provider) || (opts.providerId && provider.id !== opts.providerId)) {
      continue;
    }
    try {
      const listed = opts.models ?? (await listModels(provider));
      models = listed;
      if (listed.length) listedById.set(provider.id, listed);
    } catch {
      /* keep the stored catalog when `agent models` is unavailable */
    }
  }
  if (!listedById.size) return { config, changed: false, models };

  const latest = await store.loadConfig();
  let changed = false;
  const providers = latest.providers.map((provider) => {
    const listed = listedById.get(provider.id);
    if (!listed) return provider;
    const next = applyCursorCliModels(provider, listed);
    if (!next) return provider;
    changed = true;
    return next;
  });
  if (!changed) return { config: latest, changed: false, models };
  const next = { ...latest, providers };
  await store.saveConfig(next);
  return { config: next, changed: true, models };
}
