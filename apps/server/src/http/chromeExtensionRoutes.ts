import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import {
  formatChromeExtensionToken,
  generateChromeExtensionToken,
  policyAllowsLiveChrome,
  type LocusConfig,
} from "@locus/shared";
import type { JsonStore } from "../core/store.js";
import { isLocalOperator } from "../core/localguard.js";
import {
  chromeExtensionInstallDir,
  syncChromeExtensionFiles,
} from "../runtime/chromeExtensionInstall.js";
import type { ChromeExtensionHub } from "../runtime/chromeExtensionHub.js";

export function registerChromeExtensionRoutes(
  app: Hono,
  opts: {
    store: JsonStore;
    hub: ChromeExtensionHub;
    onConfigSaved?: (config: LocusConfig) => Promise<unknown>;
    peerAddress?: (c: import("hono").Context) => string | undefined;
    resourcesPath?: string;
  },
): void {
  async function status(revealToken: boolean) {
    const config = await opts.store.loadConfig();
    const remote = config.chromeExtension;
    const token = remote?.token?.trim();
    const enabled = Boolean(remote?.enabled && token);
    const installDir = await syncChromeExtensionFiles(opts.store.dataDir, {
      resourcesPath: opts.resourcesPath,
    });
    const live = opts.hub.status();
    return {
      enabled,
      token: revealToken && token ? token : undefined,
      formattedToken: revealToken && token ? formatChromeExtensionToken(token) : undefined,
      installDir: chromeExtensionInstallDir(opts.store.dataDir) || installDir,
      connected: live.connected,
      tabs: live.tabs,
    };
  }

  app.get("/api/chrome-extension", async (c) => {
    return c.json(await status(isLocalOperator(c, opts.peerAddress)));
  });

  app.post("/api/chrome-extension", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress)) {
      return c.json({ error: "Chrome pairing is configured on the desktop" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
    const config = await opts.store.loadConfig();
    if (body.enabled === true && !policyAllowsLiveChrome(config.managedPolicy)) {
      return c.json({ error: "Managed policy does not allow Use my Chrome" }, 403);
    }
    const enabled = body.enabled === true;
    let token = config.chromeExtension?.token?.trim();
    if (enabled && !token) {
      token = generateChromeExtensionToken(() => randomBytes(16).toString("hex"));
    }
    config.chromeExtension = { enabled, token };
    await opts.store.saveConfig(config);
    opts.hub.setToken(enabled ? token : undefined);
    if (opts.onConfigSaved) await opts.onConfigSaved(config);
    return c.json(await status(true));
  });

  app.post("/api/chrome-extension/rotate", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress)) {
      return c.json({ error: "Chrome pairing is configured on the desktop" }, 403);
    }
    const config = await opts.store.loadConfig();
    const enabled = Boolean(config.chromeExtension?.enabled);
    config.chromeExtension = {
      enabled,
      token: generateChromeExtensionToken(() => randomBytes(16).toString("hex")),
    };
    await opts.store.saveConfig(config);
    opts.hub.setToken(enabled ? config.chromeExtension.token : undefined);
    if (opts.onConfigSaved) await opts.onConfigSaved(config);
    return c.json(await status(true));
  });
}
