import { hostname as osHostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_WORKER_PORT,
  formatWorkerAddBlob,
  isLanPeerHost,
  isLoopbackHost,
  normalizeWorkerUrl,
  type WorkerAddBlob,
} from "@locus/shared";

export function listWorkerAdvertiseHosts(bindHost: string, hostname = osHostname()): string[] {
  const bind = bindHost.trim() || "0.0.0.0";
  if (bind !== "0.0.0.0" && bind !== "::") return [bind];
  const hosts: string[] = [];
  const nets = networkInterfaces();
  for (const rows of Object.values(nets)) {
    for (const row of rows ?? []) {
      if (row.internal) continue;
      const address = row.address;
      if (address.toLowerCase().startsWith("fe80:")) continue;
      if (!isLanPeerHost(address)) continue;
      if (!hosts.includes(address)) hosts.push(address);
    }
  }
  const name = hostname.trim();
  if (name && name !== "localhost" && !isLoopbackHost(name) && !hosts.includes(name)) {
    hosts.push(name);
  }
  return hosts;
}

export function workerAdvertiseUrls(
  bindHost: string,
  port: number,
  hostname = osHostname(),
): string[] {
  const hosts = listWorkerAdvertiseHosts(bindHost, hostname);
  const urls: string[] = [];
  for (const host of hosts) {
    const url = normalizeWorkerUrl(hostForUrl(host, port));
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function hostForUrl(host: string, port: number): string {
  const wrapped = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `https://${wrapped}:${port}`;
}

export function formatWorkerAddBlobs(input: {
  urls: string[];
  fingerprint: string;
  name?: string;
  token?: string;
}): string[] {
  return input.urls.flatMap((url) => {
    const blob: WorkerAddBlob = {
      url,
      fingerprint: input.fingerprint,
      name: input.name,
      token: input.token,
    };
    return formatWorkerAddBlob(blob);
  });
}

export function workerAddStdout(input: {
  engineKind: string;
  name: string;
  dataDir: string;
  bindHost: string;
  bindPort?: number;
  fingerprint: string;
  token: string;
  tokenCreated: boolean;
  tokenFromEnv: boolean;
  hostname?: string;
  printToken?: boolean;
}): string {
  const port = input.bindPort ?? DEFAULT_WORKER_PORT;
  const urls = workerAdvertiseUrls(input.bindHost, port, input.hostname);
  const includeToken = input.tokenCreated && !input.tokenFromEnv && input.printToken !== false;
  const blobs = formatWorkerAddBlobs({
    urls,
    fingerprint: input.fingerprint,
    name: input.name,
    token: includeToken ? input.token : undefined,
  });
  const lines = [`Locus worker (${input.engineKind}) ${input.name}`, `Data: ${input.dataDir}`];
  if (input.tokenCreated) {
    lines.push(
      includeToken
        ? `Token saved at ${join(input.dataDir, "token")} (also printed once in the add line).`
        : `Token saved at ${join(input.dataDir, "token")} (not printed; stdout is not a TTY).`,
    );
  } else if (!input.tokenFromEnv) {
    lines.push(`Token file: ${join(input.dataDir, "token")} (not reprinted).`);
  }
  lines.push(`TLS fingerprint: ${input.fingerprint}`);
  lines.push(`Listening on https://${input.bindHost}:${port}`);
  lines.push("");
  if (!blobs.length) {
    lines.push(
      "No LAN address to advertise. Set LOCUS_WORKER_HOST or paste the URL in Settings → Workers.",
    );
  } else {
    lines.push(
      "Add on the laptop (Settings → Workers paste, or: locus config workers add '<line>').",
    );
    lines.push("Locus does not scan the LAN — pick the line whose URL this laptop can reach.");
    for (const blob of blobs) lines.push(`  ${blob}`);
  }
  return lines.join("\n");
}
