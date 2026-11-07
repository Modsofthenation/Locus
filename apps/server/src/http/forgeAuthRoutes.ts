import type { Hono } from "hono";
import { redactConfig } from "../core/redact.js";
import type { JsonStore } from "../core/store.js";
import { ForgeOauth, type ForgeOauthStartInput } from "../git/forgeOauth.js";
import type { GoogleOauth } from "../integrations/googleOauth.js";
import type { SlackOauth } from "../slack/slackOauth.js";

export function registerForgeAuthRoutes(
  app: Hono,
  opts: {
    store: JsonStore;
    oauth: ForgeOauth;
    slackOauth: SlackOauth;
    googleOauth: GoogleOauth;
  },
): void {
  app.post("/api/forges/:id/oauth/start", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as ForgeOauthStartInput;
      return c.json(await opts.oauth.start(c.req.param("id"), body));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "SSO start failed" }, 400);
    }
  });

  app.get("/api/forges/:id/oauth/status", async (c) => {
    return c.json(await opts.oauth.status(c.req.param("id")));
  });

  app.post("/api/forges/:id/oauth/cancel", (c) => {
    opts.oauth.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/forges/:id/oauth/disconnect", async (c) => {
    try {
      const account = await opts.oauth.disconnect(c.req.param("id"));
      const config = await opts.store.loadConfig();
      return c.json({
        ok: true,
        account: redactConfig(config).forges.find((row) => row.id === account.id),
        config: redactConfig(config),
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Disconnect failed" }, 400);
    }
  });

  app.get("/api/oauth/callback", async (c) => {
    const state = c.req.query("state");
    const query = {
      code: c.req.query("code"),
      state,
      error: c.req.query("error"),
      error_description: c.req.query("error_description"),
    };
    if (opts.slackOauth.ownsState(state) || (state ?? "").startsWith("slack.")) {
      const result = await opts.slackOauth.handleCallback(query);
      return c.html(result.html, result.ok ? 200 : 400);
    }
    if (opts.googleOauth.ownsState(state) || (state ?? "").startsWith("google.")) {
      const result = await opts.googleOauth.handleCallback(query);
      return c.html(result.html, result.ok ? 200 : 400);
    }
    const result = await opts.oauth.handleCallback(query);
    return c.html(result.html, result.ok ? 200 : 400);
  });
}
