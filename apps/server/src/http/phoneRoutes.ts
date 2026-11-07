import type { Hono } from "hono";
import type { LocusConfig } from "@locus/shared";
import { phoneListenHost, policyAllowsPhoneRemote } from "@locus/shared";
import type { JsonStore } from "../core/store.js";
import { isLocalOperator } from "../core/localguard.js";
import { generatePhoneToken, pairingLinks } from "../runtime/phoneRemote.js";
import type { HostCapabilities } from "@locus/hypervisor";

export function registerPhoneRoutes(
  app: Hono,
  opts: {
    store: JsonStore;
    onConfigSaved?: (config: LocusConfig) => Promise<HostCapabilities | void>;
    peerAddress?: (c: import("hono").Context) => string | undefined;
    phoneTls?: { fingerprint: string };
  },
): void {
  async function phoneStatus(revealToken: boolean) {
    const config = await opts.store.loadConfig();
    const remote = config.phoneRemote;
    const token = remote?.token?.trim();
    const enabled = Boolean(remote?.enabled && token);
    const port = config.advanced.bindPort ?? 7420;
    return {
      enabled,
      token: revealToken && token ? token : undefined,
      listenHost: phoneListenHost(enabled, config.advanced.bindHost),
      port,
      urls: enabled && token ? pairingLinks(port, token, opts.phoneTls?.fingerprint) : [],
      fingerprint: enabled ? opts.phoneTls?.fingerprint : undefined,
      restartHint: enabled
        ? "Restart Locus after enabling so the control plane listens on the LAN."
        : undefined,
    };
  }

  app.get("/api/phone", async (c) => {
    return c.json(await phoneStatus(isLocalOperator(c, opts.peerAddress)));
  });

  app.post("/api/phone", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Phone pairing is configured on the desktop" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
    const config = await opts.store.loadConfig();
    if (body.enabled === true && !policyAllowsPhoneRemote(config.managedPolicy)) {
      return c.json({ error: "Managed policy does not allow phone remote" }, 403);
    }
    const enabled = body.enabled === true;
    let token = config.phoneRemote?.token?.trim();
    if (enabled && !token) token = generatePhoneToken();
    config.phoneRemote = { enabled, token };
    await opts.store.saveConfig(config);
    if (opts.onConfigSaved) await opts.onConfigSaved(config);
    return c.json(await phoneStatus(true));
  });

  app.post("/api/phone/rotate", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Phone pairing is configured on the desktop" }, 403);
    const config = await opts.store.loadConfig();
    const enabled = Boolean(config.phoneRemote?.enabled);
    config.phoneRemote = { enabled, token: generatePhoneToken() };
    await opts.store.saveConfig(config);
    if (opts.onConfigSaved) await opts.onConfigSaved(config);
    return c.json(await phoneStatus(true));
  });
}
