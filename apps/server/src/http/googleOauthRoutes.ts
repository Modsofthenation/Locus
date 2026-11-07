import type { Hono } from "hono";
import { isGoogleIntegrationKind } from "@locus/shared";
import { redactConfig } from "../core/redact.js";
import type { JsonStore } from "../core/store.js";
import type { GoogleOauth } from "../integrations/googleOauth.js";

export function registerGoogleOauthRoutes(app: Hono, oauth: GoogleOauth, store: JsonStore): void {
  app.post("/api/google/oauth/start", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        accountId?: string;
        oauthClientId?: string;
        oauthClientSecret?: string;
      };
      const config = await store.loadConfig();
      const accountId =
        body.accountId?.trim() ||
        (config.integrations ?? []).find((row) => isGoogleIntegrationKind(row.kind))?.id;
      if (!accountId) {
        return c.json(
          { error: "Add Gmail, Google Calendar, or Google Drive in Settings → Integrations" },
          400,
        );
      }
      return c.json(await oauth.start(accountId, body));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Google sign-in failed" }, 400);
    }
  });

  app.get("/api/google/oauth/status", async (c) => {
    const accountId = c.req.query("accountId")?.trim();
    const config = await store.loadConfig();
    const id =
      accountId || (config.integrations ?? []).find((row) => isGoogleIntegrationKind(row.kind))?.id;
    if (!id) return c.json({ status: "idle" });
    return c.json(await oauth.status(id));
  });

  app.post("/api/google/oauth/disconnect", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { accountId?: string };
      const config = await store.loadConfig();
      const id =
        body.accountId?.trim() ||
        (config.integrations ?? []).find((row) => isGoogleIntegrationKind(row.kind))?.id;
      if (!id) return c.json({ error: "Unknown Google account" }, 400);
      await oauth.disconnect(id);
      return c.json({ ok: true, config: redactConfig(await store.loadConfig()) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Disconnect failed" }, 400);
    }
  });
}
