import type { Hono } from "hono";
import { isMaskedSecret, type AiProvider, type ProviderUsage } from "@locus/shared";
import { isUsageCapableProvider, testProvider } from "@locus/providers";
import {
  persistCursorCliModels,
  type ListProviderModelsFn,
} from "../integrations/cursorCliCatalog.js";
import { providerBaseUrlError } from "../core/configSave.js";
import { redactConfig } from "../core/redact.js";
import type { JsonStore } from "../core/store.js";
import { errorMessage } from "./sessionJson.js";

const USAGE_CACHE_MS = 60_000;

async function resolveProvider(
  store: JsonStore,
  id: string,
  patch: { apiKey?: string; baseUrl?: string },
) {
  const config = await store.loadConfig();
  const provider = config.providers.find((p) => p.id === id);
  if (!provider) throw new Error("Provider not found");
  const apiKey =
    patch.apiKey === undefined || isMaskedSecret(patch.apiKey) ? provider.apiKey : patch.apiKey;
  const baseUrl =
    typeof patch.baseUrl === "string" && patch.baseUrl.trim()
      ? patch.baseUrl.trim()
      : provider.baseUrl;
  const urlError = providerBaseUrlError({ ...provider, baseUrl });
  if (urlError) throw new Error(urlError);
  return { ...provider, apiKey, baseUrl };
}

export function registerProviderRoutes(
  app: Hono,
  opts: {
    store: JsonStore;
    listModels: ListProviderModelsFn;
    readUsage?: (provider: AiProvider) => Promise<ProviderUsage>;
  },
): void {
  const usageCache = new Map<string, { at: number; usage: ProviderUsage }>();
  const inflight = new Map<string, Promise<ProviderUsage>>();

  function usageFor(provider: AiProvider, refresh: boolean): Promise<ProviderUsage> {
    const readUsage = opts.readUsage;
    if (!readUsage) return Promise.reject(new Error("Usage is not available"));
    // Key on everything that changes which account is read.
    const key = `${provider.id}\u0000${provider.kind}\u0000${provider.baseUrl}\u0000${provider.apiKey ? "key" : ""}`;
    const hit = usageCache.get(key);
    if (!refresh && hit && Date.now() - hit.at < USAGE_CACHE_MS) return Promise.resolve(hit.usage);
    const pending = inflight.get(key);
    if (pending) return pending;
    const next = readUsage(provider)
      .then((usage) => {
        usageCache.set(key, { at: Date.now(), usage });
        return usage;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, next);
    return next;
  }

  /** Plan / quota usage for every enabled local agent CLI (Codex, Claude Code, Cursor, Kiro). */
  app.get("/api/providers/usage", async (c) => {
    const config = await opts.store.loadConfig();
    const refresh = c.req.query("refresh") === "1";
    const only = c.req.query("id");
    const rows = config.providers.filter(
      (p) => isUsageCapableProvider(p) && (only ? p.id === only : p.enabled),
    );
    const usage = await Promise.all(rows.map((p) => usageFor(p, refresh)));
    return c.json({ usage });
  });

  app.post("/api/providers/:id/models", async (c) => {
    try {
      const provider = await resolveProvider(
        opts.store,
        c.req.param("id"),
        await c.req.json().catch(() => ({})),
      );
      const models = await opts.listModels(provider);
      if (provider.kind === "cursor-cli") {
        await persistCursorCliModels(opts.store, {
          listModels: opts.listModels,
          providerId: provider.id,
          models,
        });
      }
      return c.json({ models });
    } catch (err) {
      const notFound = err instanceof Error && err.message === "Provider not found";
      return c.json({ error: errorMessage(err) }, notFound ? 404 : 400);
    }
  });

  app.post("/api/providers/cursor-cli/refresh", async (c) => {
    const result = await persistCursorCliModels(opts.store, { listModels: opts.listModels });
    return c.json({
      changed: result.changed,
      models: result.models,
      config: redactConfig(result.config),
    });
  });

  app.post("/api/providers/:id/test", async (c) => {
    try {
      const provider = await resolveProvider(
        opts.store,
        c.req.param("id"),
        await c.req.json().catch(() => ({})),
      );
      return c.json(await testProvider(provider));
    } catch (err) {
      const notFound = err instanceof Error && err.message === "Provider not found";
      return c.json({ error: errorMessage(err) }, notFound ? 404 : 400);
    }
  });
}
