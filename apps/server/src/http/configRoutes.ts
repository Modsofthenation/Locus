import { join } from "node:path";
import type { Hono } from "hono";
import { clearIntegrationCredentials, type LocusConfig } from "@locus/shared";
import type { AutomationService } from "../automations/automations.js";
import { redactConfig, redactVm } from "../core/redact.js";
import { prepareSavedConfig } from "../core/configSave.js";
import {
  checkGithubRelease,
  downloadAndVerifyUpdate,
  openVerifiedUpdate,
} from "../core/updates.js";
import type { JsonStore } from "../core/store.js";
import type { SessionService } from "../session/sessions.js";
import type { HostCapabilities, Hypervisor } from "@locus/hypervisor";

export function registerConfigRoutes(
  app: Hono,
  opts: {
    store: JsonStore;
    sessions: SessionService;
    automations?: AutomationService;
    slack: { restart: () => void | Promise<void> };
    getHypervisor: () => Hypervisor;
    setHypervisor: (hypervisor: Hypervisor) => void;
    getCapabilities: () => HostCapabilities | undefined;
    setCapabilities: (capabilities: HostCapabilities) => void;
    onConfigSaved?: (config: LocusConfig) => Promise<HostCapabilities | void>;
    onReset?: () => Promise<{ hypervisor: Hypervisor; capabilities: HostCapabilities } | void>;
    setupJson: () => Promise<unknown>;
    fetchFn?: typeof fetch;
  },
): void {
  app.get("/api/config", async (c) => {
    const config = await opts.store.loadConfig();
    return c.json(redactConfig(config));
  });

  app.post("/api/reset", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { confirm?: string };
    if (body.confirm !== "RESET") return c.json({ error: "Confirm RESET to wipe local data" }, 400);
    const resumeAutomations = opts.automations?.pause() ?? false;
    try {
      await opts.sessions.resetAll();
      await opts.store.wipe();
      await opts.sessions.refreshMcp();
      if (opts.onReset) {
        const bundle = await opts.onReset();
        if (bundle) {
          opts.setHypervisor(bundle.hypervisor);
          opts.setCapabilities(bundle.capabilities);
        }
      }
      const config = await opts.store.loadConfig();
      if (opts.onConfigSaved) await opts.onConfigSaved(config);
      return c.json({
        ok: true,
        dataDir: opts.store.dataDir,
        config: redactConfig(config),
        sessions: [],
        vms: opts.sessions.listMachines().map(redactVm),
        automations: [],
        runs: [],
        repos: [],
        hypervisor: opts.getHypervisor().kind,
        docker: opts.sessions.dockerKind(),
        setup: await opts.setupJson(),
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Reset failed" }, 400);
    } finally {
      opts.automations?.resume(resumeAutomations);
    }
  });

  app.put("/api/config", async (c) => {
    const body = (await c.req.json()) as LocusConfig;
    const current = await opts.store.loadConfig();
    const saved = prepareSavedConfig(current, body, opts.store.dataDir);
    if (!saved.ok) return c.json({ error: saved.error }, 400);
    try {
      await opts.store.saveConfig(saved.config);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to save config" }, 500);
    }
    if (opts.onConfigSaved) {
      const next = await opts.onConfigSaved(saved.config);
      if (next) opts.setCapabilities(next);
    }
    void opts.slack.restart();
    const loaded = await opts.store.loadConfig();
    return c.json(redactConfig({ ...saved.config, managedPolicy: loaded.managedPolicy }));
  });

  app.post("/api/integrations/revoke-all", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { confirm?: string };
    if (body.confirm !== "REVOKE") {
      return c.json({ error: "Confirm REVOKE to clear integration tokens" }, 400);
    }
    const current = await opts.store.loadConfig();
    current.integrations = (current.integrations ?? []).map(clearIntegrationCredentials);
    try {
      await opts.store.saveConfig(current);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to revoke tokens" }, 500);
    }
    if (opts.onConfigSaved) await opts.onConfigSaved(current);
    void opts.slack.restart();
    return c.json({ ok: true, config: redactConfig(await opts.store.loadConfig()) });
  });

  app.get("/api/updates", async (c) => {
    const current = (c.req.query("current") ?? "").trim() || "0.0.0";
    return c.json(
      await checkGithubRelease({
        current,
        platform: process.platform,
        fetchFn: opts.fetchFn,
      }),
    );
  });

  app.post("/api/updates/download", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      asset?: { name?: string; url?: string };
      checksums?: { name?: string; url?: string };
    };
    if (!body.asset?.name || !body.asset.url || !body.checksums?.name || !body.checksums.url) {
      return c.json({ error: "Asset and SHA256SUMS URLs are required" }, 400);
    }
    try {
      const result = await downloadAndVerifyUpdate({
        asset: { name: body.asset.name, url: body.asset.url },
        checksums: { name: body.checksums.name, url: body.checksums.url },
        destDir: join(opts.store.dataDir, "updates"),
        fetchFn: opts.fetchFn,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Download failed" }, 400);
    }
  });

  app.post("/api/updates/open", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: string };
    const path = body.path?.trim() ?? "";
    if (!path.startsWith(opts.store.dataDir)) {
      return c.json({ error: "Installer path is not in the data directory" }, 400);
    }
    try {
      openVerifiedUpdate(path);
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Could not open installer" },
        400,
      );
    }
  });
}
