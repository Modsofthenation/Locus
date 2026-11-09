import { createServer } from "node:https";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { DEFAULT_ADVANCED, DEFAULT_WORKER_PORT } from "@locus/shared";
import { createDockerEngine, createHypervisor } from "@locus/hypervisor";
import { ensureHostKey, guestReadyTimeoutMs, waitForGuest } from "@locus/guest-agent";
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

const loaded = await loadOrCreateWorkerToken(dataDir);
const token = loaded.token;
const tls = await loadOrCreateWorkerTls(dataDir);
const engine = await createDockerEngine(dataDir);
const hostKey = await ensureHostKey(dataDir);
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
  name,
  guests,
  dataDir,
  hostname: hostname(),
  hostGuests,
  onGuestDeleted: (id) => browsers.drop(id),
  allowHostRuntime: process.env.LOCUS_WORKER_ALLOW_HOST === "1",
});

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
    tokenFromEnv: Boolean(process.env.LOCUS_WORKER_TOKEN?.trim()),
    printToken: Boolean(process.stdout.isTTY),
  }),
);

const server = serve(
  {
    fetch: app.fetch,
    hostname: bindHost,
    port: bindPort,
    createServer,
    serverOptions: { key: tls.key, cert: tls.cert },
  },
  (info) => {
    console.log(`Ready on https://${info.address}:${info.port}`);
  },
);
attachWorkerBrowser(server, {
  token,
  engine,
  guests,
  browsers,
  lookupGuest,
});
attachWorkerDisplay(server, {
  token,
  lookupGuest: (id) => lookupGuest(id) ?? engine.get(id),
});
