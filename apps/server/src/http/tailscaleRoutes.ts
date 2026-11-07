import type { Hono } from "hono";
import type { CommandRunner } from "@locus/hypervisor";
import { readTailscaleStatus, setTailscaleFunnel } from "../runtime/tailscale.js";
import type { JsonStore } from "../core/store.js";

export function registerTailscaleRoutes(
  app: Hono,
  opts: { store: JsonStore; runner: CommandRunner },
): void {
  app.get("/api/tailscale", async (c) => {
    const config = await opts.store.loadConfig();
    return c.json(await readTailscaleStatus(opts.runner, config.advanced.bindPort));
  });

  app.post("/api/tailscale/funnel", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
    const config = await opts.store.loadConfig();
    const status = await setTailscaleFunnel(
      opts.runner,
      config.advanced.bindPort,
      body.enabled === true,
    );
    if (status.funnelUrl) {
      const origin = status.funnelUrl.replace(/\/api\/hooks\/?$/, "");
      if (origin.startsWith("https://") && !config.advanced.webhookBaseUrl) {
        config.advanced.webhookBaseUrl = origin;
        await opts.store.saveConfig(config);
      }
    }
    const saved = await opts.store.loadConfig();
    return c.json({ ...status, webhookBaseUrl: saved.advanced.webhookBaseUrl });
  });
}
