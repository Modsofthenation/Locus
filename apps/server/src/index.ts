import { join } from "node:path";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { getRequestListener } from "@hono/node-server";
import {
  guestReadyTimeoutMs,
  hostKeyWarning,
  tryEnsureHostKey,
  waitForGuest,
} from "@locus/guest-agent";
import {
  createDockerEngine,
  createHypervisor,
  type DockerEngine,
  type Hypervisor,
} from "@locus/hypervisor";
import {
  AzureComputeBackend,
  CompositeComputeBackend,
  FargateComputeBackend,
  GcpComputeBackend,
  computeTasksPath,
} from "@locus/compute";
import { loadOrCreateWorkerTls } from "@locus/worker";
import { createApp } from "./app.js";
import { defaultDataDir } from "./defaults.js";
import { AutomationService } from "./automations/automations.js";
import { BoardService } from "./boards/boards.js";
import { ProjectService } from "./projects/projects.js";
import { createProtocolMux } from "./core/controlPlaneListen.js";
import { GuestHub } from "./core/guests.js";
import { Hub } from "./core/hub.js";
import { RepoService } from "./git/repos.js";
import { SessionService } from "./session/sessions.js";
import { attachSockets } from "./core/sockets.js";
import {
  electronResourcesPath,
  syncChromeExtensionFiles,
} from "./runtime/chromeExtensionInstall.js";
import type { ControlPlane } from "./core/controlPlane.js";
import { JsonStore } from "./core/store.js";
import { applyPendingRestore } from "./core/backup.js";
import { persistCursorCliModels } from "./integrations/cursorCliCatalog.js";
import { setPythonInterpreterOverride } from "./workspace/workspacePython.js";
import { BrainService } from "./brain/brain.js";
import { WorkflowService } from "./workflows/service.js";
import { jiraCorpusCollector, slackCorpusCollector } from "./brain/corpus.js";
import { SlackGateway } from "./slack/slackGateway.js";
import { SubscriptionService } from "./session/subscriptions.js";
import { slackSocketConnect } from "./slack/slackSocket.js";
import { attachUi, resolveUiDir } from "./ui.js";
import { phoneListenHost, type GuestOs, type ServerCommand } from "@locus/shared";

process.on("uncaughtException", (err) => {
  console.error("Locus control plane crashed:", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("Locus control plane unhandled rejection:", err);
});

const dataDir = defaultDataDir();
// A restore staged by POST /api/restore swaps in before anything reads the data dir.
const restored = await applyPendingRestore(dataDir);
if (restored.applied) {
  console.log(`Restored a Locus backup. Previous files: ${restored.movedAsideTo}`);
} else if (restored.error) {
  console.error(`Restore failed: ${restored.error}. Previous files: ${restored.movedAsideTo}`);
}
const store = new JsonStore(dataDir);
await store.init();
const config = await store.loadConfig();
await syncChromeExtensionFiles(dataDir, {
  resourcesPath: electronResourcesPath(),
});

const { key: hostKey, error: hostKeyError } = await tryEnsureHostKey(config.advanced.dataDir);
if (hostKeyError) console.warn(hostKeyWarning(hostKeyError));
const ssh = {
  sshPublicKey: hostKey.publicKey,
  sshIdentityFile: hostKey.privateKeyPath,
  waitGuest: (guest: { os: GuestOs }, signal: AbortSignal) =>
    waitForGuest(guest, { signal, timeoutMs: guestReadyTimeoutMs(guest.os) }),
};
let { hypervisor, capabilities } = await createHypervisor(config.advanced, undefined, ssh);
console.log(`Hypervisor: ${hypervisor.kind}`);
const docker = await createDockerEngine(config.advanced.dataDir);
console.log(`Docker: ${docker.kind}`);
await adoptSavedMachines(hypervisor, docker);
const hub = new Hub();
const guests = new GuestHub({
  liveQemu: Boolean(hypervisor.liveEngine),
  liveDocker: Boolean(docker.liveEngine),
  identityFile: hostKey.privateKeyPath,
});
const plane: ControlPlane = {};
const sessions = new SessionService(
  store,
  hypervisor,
  hub,
  undefined,
  guests,
  docker,
  new CompositeComputeBackend(
    new FargateComputeBackend(fetch, undefined, computeTasksPath(dataDir)),
    new AzureComputeBackend(fetch, undefined, join(dataDir, "compute-azure.json")),
    new GcpComputeBackend(fetch, undefined, join(dataDir, "compute-gcp.json")),
  ),
  plane,
);
sessions.chromeExtension.setToken(
  config.chromeExtension?.enabled ? config.chromeExtension.token : undefined,
);
sessions.startWorkerReaper();
await sessions.reapOrphanCompute();
await sessions.recoverInterruptedTurns();
await sessions.refreshMcp();
void persistCursorCliModels(store).catch((err) => {
  console.warn("Cursor CLI models were not refreshed:", err instanceof Error ? err.message : err);
});
const automations = new AutomationService(store, sessions, hub);
await automations.recoverInterruptedRuns();
const boards = new BoardService(store, hub, sessions);
plane.boards = boards;
const repos = new RepoService(store, sessions, hub);
const projects = new ProjectService(store, hub, sessions, repos);
plane.projects = projects;
const brain = new BrainService(store, hub);
plane.brain = brain;
const workflows = new WorkflowService(dataDir, sessions);
plane.workflows = workflows;
const slack = new SlackGateway(store, sessions, hub, fetch, slackSocketConnect, brain);
plane.onSlackApproval = (sessionId, toolName, callId) => {
  void slack.notifyApproval(sessionId, toolName, callId).catch(() => undefined);
};
brain.setCorpusCollectors([slackCorpusCollector(store, slack), jiraCorpusCollector(store)]);
const subscriptions = new SubscriptionService(store, sessions, { slack, hub, repos, projects });
let liveConfig = config;
setPythonInterpreterOverride(liveConfig.advanced.pythonInterpreter);
const phoneOn = Boolean(liveConfig.phoneRemote?.enabled);
const phoneTls = phoneOn ? await loadOrCreateWorkerTls(dataDir) : undefined;
const app = createApp({
  store,
  sessions,
  hypervisor,
  capabilities,
  automations,
  boards,
  projects,
  repos,
  hub,
  slack,
  brain,
  workflows,
  phoneTls: phoneTls ? { fingerprint: phoneTls.fingerprint } : undefined,
  onConfigSaved: async (next) => {
    liveConfig = next;
    setPythonInterpreterOverride(next.advanced.pythonInterpreter);
    sessions.chromeExtension.setToken(
      next.chromeExtension?.enabled ? next.chromeExtension.token : undefined,
    );
    await sessions.refreshMcp();
    await slack.restart();
    if (hypervisor.refresh) return hypervisor.refresh(next.advanced);
  },
  onQemuInstalled: async () => {
    const nextConfig = await store.loadConfig();
    const bundle = await createHypervisor(nextConfig.advanced, undefined, ssh);
    hypervisor = bundle.hypervisor;
    capabilities = bundle.capabilities;
    sessions.setHypervisor(hypervisor);
    await adoptSavedMachines(hypervisor, docker);
    console.log(`Hypervisor: ${hypervisor.kind}`);
    return bundle;
  },
  onReset: async () => {
    const { key: nextKey, error: nextKeyError } = await tryEnsureHostKey(store.dataDir);
    if (nextKeyError) console.warn(hostKeyWarning(nextKeyError));
    ssh.sshPublicKey = nextKey.publicKey;
    ssh.sshIdentityFile = nextKey.privateKeyPath;
    const nextConfig = await store.loadConfig();
    const bundle = await createHypervisor(nextConfig.advanced, undefined, ssh);
    hypervisor = bundle.hypervisor;
    capabilities = bundle.capabilities;
    sessions.setHypervisor(hypervisor);
    console.log(`Hypervisor: ${hypervisor.kind}`);
    return bundle;
  },
});
const uiDir = resolveUiDir();
attachUi(app, uiDir);
if (uiDir) console.log(`UI: ${uiDir}`);
else console.log("UI: no desktop bundle; phone pairing proxies Vite on :5173 if it is running");

const host = phoneListenHost(
  Boolean(liveConfig.phoneRemote?.enabled),
  liveConfig.advanced.bindHost || "127.0.0.1",
);
const port = Number(process.env.PORT ?? liveConfig.advanced.bindPort ?? 7420);
const listener = getRequestListener(app.fetch);
const httpServer = createHttpServer(listener);
const httpsServer =
  phoneTls && createHttpsServer({ key: phoneTls.key, cert: phoneTls.cert }, listener);

const socketOpts = {
  hub,
  displays: {
    get: (id: string) => hypervisor.get(id),
    connectRemote: (id: string, ws: import("ws").WebSocket) => sessions.pipeWorkerDisplay(id, ws),
  },
  onCommand: handleCommand,
  phoneRemote: () => liveConfig.phoneRemote,
  browsers: {
    attach: (sessionId: string, ws: import("ws").WebSocket) => {
      sessions.attachBrowserSocket(sessionId, ws);
    },
  },
  chromeExtension: {
    attach: (ws: import("ws").WebSocket, token: string | undefined) => {
      sessions.chromeExtension.attach(ws, token);
    },
    token: () =>
      liveConfig.chromeExtension?.enabled ? liveConfig.chromeExtension.token : undefined,
  },
  workspaceShell: {
    root: (sessionId: string) => sessions.workspaceShellRoot(sessionId),
  },
};
attachSockets({ server: httpServer, ...socketOpts });
if (httpsServer) attachSockets({ server: httpsServer, ...socketOpts });

if (httpsServer) {
  const mux = createProtocolMux({ http: httpServer, https: httpsServer });
  mux.listen(port, host, () => {
    console.log(`Locus listening on http://${host}:${port} (HTTPS mux for phone remote)`);
    console.log(`Phone TLS fingerprint: ${phoneTls?.fingerprint}`);
    console.log("Phone remote is on: LAN clients must present the pairing token.");
  });
} else {
  httpServer.listen(port, host, () => {
    console.log(`Locus listening on http://${host}:${port}`);
  });
}

automations.start();
void slack.start();
subscriptions.start();

async function adoptSavedMachines(hv: Hypervisor, engine: DockerEngine): Promise<void> {
  const current = await store.loadConfig();
  for (const vm of await store.loadVms()) {
    if (vm.runtime === "docker") {
      engine.adopt?.(vm);
      continue;
    }
    if (!hv.adopt) continue;
    const template = current.templates.find((t) => t.id === vm.templateId);
    if (!template) continue;
    hv.adopt(vm, template, {
      hostSharePath: current.advanced.hostSharePath?.trim() || undefined,
    });
  }
}

async function handleCommand(cmd: ServerCommand): Promise<void> {
  switch (cmd.type) {
    case "chat.abort":
      await sessions.abortChat(cmd.sessionId);
      break;
    case "vm.start":
      await sessions.startVm(cmd.sessionId);
      break;
    case "vm.stop":
      await sessions.stopVm(cmd.sessionId);
      break;
    case "vm.pause":
      await sessions.pauseVm(cmd.sessionId);
      break;
    case "vm.resume":
      await sessions.resumeVm(cmd.sessionId);
      break;
    default:
      break;
  }
}
