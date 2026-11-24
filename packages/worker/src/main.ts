import { createServer } from "node:https";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { DEFAULT_ADVANCED, DEFAULT_WORKER_PORT } from "@locus/shared";
import { createDockerEngine, createHypervisor } from "@locus/hypervisor";
import {
  guestReadyTimeoutMs,
  hostKeyWarning,
  tryEnsureHostKey,
  waitForGuest,
} from "@locus/guest-agent";
import type { GuestOs, VmInstance } from "@locus/shared";
import { createWorkerApp } from "./app.js";
import { WorkerBrowserHub } from "./browserHub.js";
import { attachWorkerBrowser } from "./browserSockets.js";
import { attachWorkerDisplay } from "./displaySockets.js";
import { WorkerGuestHub } from "./guests.js";
import { workerAddStdout } from "./advertise.js";
import { loadOrCreateWorkerTls } from "./tls.js";
import { loadOrCreateWorkerToken } from "./token.js";

const dataDir = process.env.LOCUS_WORKER_HOME ?? join(homedir(), ".locus-worker");
const bindHost = process.env.LOCUS_WORKER_HOST ?? "0.0.0.0";
const bindPort = Number(process.env.LOCUS_WORKER_PORT ?? DEFAULT_WORKER_PORT);
const name = process.env.LOCUS_WORKER_NAME?.trim() || hostname();

const gatewayTransport = process.env.LOCUS_WORKER_TRANSPORT === "vendor-gateway";
const tokenFromEnv = Boolean(process.env.LOCUS_WORKER_TOKEN?.trim());
if (gatewayTransport && !tokenFromEnv) throw new Error("Cloud worker needs an injected token");
const loaded = await loadOrCreateWorkerToken(dataDir);
const token = loaded.token;
const tls = gatewayTransport ? undefined : await loadOrCreateWorkerTls(dataDir);
// Guest commands and CLI agents are children of this process: keep the bearer token and
// TLS private key out of their environment once loaded.
for (const key of ["LOCUS_WORKER_TOKEN", "LOCUS_WORKER_TLS_CERT_B64", "LOCUS_WORKER_TLS_KEY_B64"]) {
  delete process.env[key];
}
const engine = await createDockerEngine(dataDir);
const { key: hostKey, error: hostKeyError } = await tryEnsureHostKey(dataDir);
if (hostKeyError) console.warn(hostKeyWarning(hostKeyError));
const { hypervisor } = await createHypervisor({ ...DEFAULT_ADVANCED, dataDir }, undefined, {
  sshPublicKey: hostKey.publicKey,
  sshIdentityFile: hostKey.privateKeyPath,
  waitGuest: (guest: { os: GuestOs }, signal: AbortSignal) =>
    waitForGuest(guest, { signal, timeoutMs: guestReadyTimeoutMs(guest.os) }),
});
const hostGuests = new Map<string, VmInstance>();
const guests = new WorkerGuestHub({
  liveDocker: Boolean(engine.liveEngine),
  liveQemu: Boolean(hypervisor.liveEngine),
  dataDir,
  identityFile: hostKey.privateKeyPath,
});
const lookupGuest = (id: string) => hostGuests.get(id) ?? hypervisor.get(id);
const browsers = new WorkerBrowserHub(guests, engine, lookupGuest);
const app = createWorkerApp({
  engine,
  hypervisor,
  token,
  gatewayTransport,
  name,
  guests,
  dataDir,
  hostname: hostname(),
  hostGuests,
  onGuestDeleted: (id) => browsers.drop(id),
  allowHostRuntime: process.env.LOCUS_WORKER_ALLOW_HOST === "1",
});

if (tls)
  console.log(
    workerAddStdout({
      engineKind: engine.kind,
      name,
      dataDir,
      bindHost,
      bindPort,
      fingerprint: tls.fingerprint,
      token,
      tokenCreated: loaded.created,
      tokenFromEnv,
      printToken: Boolean(process.stdout.isTTY),
    }),
  );

const server = serve(
  {
    fetch: app.fetch,
    hostname: bindHost,
    port: bindPort,
    ...(tls ? { createServer, serverOptions: { key: tls.key, cert: tls.cert } } : {}),
  },
  (info) => {
    console.log(`Ready on ${tls ? "https" : "http"}://${info.address}:${info.port}`);
  },
);
attachWorkerBrowser(server, {
  token,
  gatewayTransport,
  engine,
  guests,
  browsers,
  lookupGuest,
});
attachWorkerDisplay(server, {
  token,
  gatewayTransport,
  lookupGuest: (id) => lookupGuest(id) ?? engine.get(id),
});
