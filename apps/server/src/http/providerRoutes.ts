import type { Hono } from "hono";
import { isMaskedSecret } from "@locus/shared";
import { testProvider } from "@locus/providers";
import {
  persistCursorCliModels,
  type ListProviderModelsFn,
} from "../integrations/cursorCliCatalog.js";
import { providerBaseUrlError } from "../core/configSave.js";
import { redactConfig } from "../core/redact.js";
import type { JsonStore } from "../core/store.js";
import { errorMessage } from "./sessionJson.js";

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
  },
): void {
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
