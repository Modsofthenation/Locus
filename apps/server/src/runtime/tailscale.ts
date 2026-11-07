import type { CommandRunner } from "@locus/hypervisor";

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  loggedIn: boolean;
  funnelEnabled: boolean;
  funnelUrl?: string;
  error?: string;
}

const HOOKS_PATH = "/api/hooks";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function hostnameFromStatus(json: unknown): string | undefined {
  const self = asRecord(asRecord(json)?.Self);
  const dns = typeof self?.DNSName === "string" ? self.DNSName.replace(/\.$/, "") : "";
  return dns || undefined;
}

function funnelUrlFromServe(json: unknown, hostname?: string): string | undefined {
  const web = asRecord(asRecord(json)?.Web);
  if (!web) return undefined;
  for (const [host, routes] of Object.entries(web)) {
    const table = asRecord(routes);
    if (!table) continue;
    const paths = Object.keys(table);
    if (!paths.length) continue;
    const hooksOnly = paths.every(
      (path) =>
        path === HOOKS_PATH || path === `${HOOKS_PATH}/` || path.startsWith(`${HOOKS_PATH}/`),
    );
    if (!hooksOnly) continue;
    const hostOnly = host.replace(/:\d+$/, "").replace(/\.$/, "") || hostname;
    if (!hostOnly) continue;
    return `https://${hostOnly}${HOOKS_PATH}`;
  }
  return undefined;
}

async function tailscaleJson(runner: CommandRunner, args: string[]): Promise<unknown> {
  const bin = await runner.which("tailscale");
  if (!bin) throw new Error("Tailscale is not installed");
  const result = await runner.exec(bin, args);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `tailscale ${args[0]} failed`);
  }
  const text = result.stdout.trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

export async function readTailscaleStatus(
  runner: CommandRunner,
  _bindPort: number,
): Promise<TailscaleStatus> {
  const bin = await runner.which("tailscale");
  if (!bin) {
    return {
      installed: false,
      running: false,
      loggedIn: false,
      funnelEnabled: false,
      error: "Tailscale is not installed",
    };
  }
  try {
    const status = await tailscaleJson(runner, ["status", "--json"]);
    const backend =
      typeof asRecord(status)?.BackendState === "string"
        ? String(asRecord(status)?.BackendState)
        : "";
    const running = backend === "Running";
    const loggedIn = running && Boolean(hostnameFromStatus(status));
    let funnelUrl: string | undefined;
    try {
      const serve = await tailscaleJson(runner, ["serve", "status", "--json"]);
      funnelUrl = funnelUrlFromServe(serve, hostnameFromStatus(status));
    } catch {
      /* serve may be unset */
    }
    return {
      installed: true,
      running,
      loggedIn,
      funnelEnabled: Boolean(funnelUrl),
      funnelUrl,
      error: running ? undefined : backend ? `Tailscale is ${backend}` : "Tailscale is not running",
    };
  } catch (err) {
    return {
      installed: true,
      running: false,
      loggedIn: false,
      funnelEnabled: false,
      error: err instanceof Error ? err.message : "Tailscale status failed",
    };
  }
}

export async function setTailscaleFunnel(
  runner: CommandRunner,
  bindPort: number,
  enabled: boolean,
): Promise<TailscaleStatus> {
  const bin = await runner.which("tailscale");
  if (!bin) {
    return {
      installed: false,
      running: false,
      loggedIn: false,
      funnelEnabled: false,
      error: "Tailscale is not installed",
    };
  }
  const port = Number.isInteger(bindPort) && bindPort > 0 && bindPort < 65536 ? bindPort : 7420;
  const target = `http://127.0.0.1:${port}${HOOKS_PATH}`;
  if (enabled) {
    await runner.exec(bin, ["funnel", "off"]);
    await runner.exec(bin, ["serve", "reset"]);
    const serve = await runner.exec(bin, [
      "serve",
      "--bg",
      "--https=443",
      `--set-path=${HOOKS_PATH}`,
      target,
    ]);
    if (serve.code !== 0) {
      const fallback = await runner.exec(bin, [
        "funnel",
        "--bg",
        "--https=443",
        `--set-path=${HOOKS_PATH}`,
        target,
      ]);
      if (fallback.code !== 0) {
        return {
          installed: true,
          running: false,
          loggedIn: false,
          funnelEnabled: false,
          error:
            fallback.stderr.trim() || serve.stderr.trim() || "Failed to start Tailscale Funnel",
        };
      }
    } else {
      await runner.exec(bin, ["funnel", "--bg", "--https=443", "on"]);
    }
  } else {
    await runner.exec(bin, ["funnel", "off"]);
    await runner.exec(bin, ["serve", "reset"]);
  }
  return readTailscaleStatus(runner, port);
}

export function hooksUrl(baseUrl: string | undefined, automationId: string): string | undefined {
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return undefined;
  return `${base}/api/hooks/automations/${automationId}`;
}
