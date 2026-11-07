import type { Hono } from "hono";
import { configuredToolsForRuntime, isGuestOs } from "@locus/shared";
import { redactVm } from "../core/redact.js";
import type { JsonStore } from "../core/store.js";
import type { SessionService } from "../session/sessions.js";

export function registerMachineRoutes(
  app: Hono,
  opts: { store: JsonStore; sessions: SessionService },
): void {
  app.get("/api/vms", (c) => c.json(opts.sessions.listMachines().map(redactVm)));

  app.get("/api/tools/:os", async (c) => {
    const os = c.req.param("os");
    if (!isGuestOs(os)) return c.json({ error: "Unknown OS" }, 400);
    const runtime = c.req.query("runtime");
    const guestRuntime = runtime === "docker" || runtime === "host" ? runtime : "vm";
    const config = await opts.store.loadConfig();
    return c.json(configuredToolsForRuntime(os, guestRuntime, config.integrations));
  });
}
