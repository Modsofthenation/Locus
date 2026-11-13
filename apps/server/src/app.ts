import { Hono } from "hono";
import { cors } from "hono/cors";
import type { LocusConfig } from "@locus/shared";
import { listProviderModels } from "@locus/providers";
import { type ListProviderModelsFn } from "./integrations/cursorCliCatalog.js";
import type { AutomationService } from "./automations/automations.js";
import type { BoardService } from "./boards/boards.js";
import type { ProjectService } from "./projects/projects.js";
import type { RepoService } from "./git/repos.js";

import { registerAutomationRoutes } from "./http/automationRoutes.js";
import { registerBoardRoutes } from "./http/boardRoutes.js";
import { registerProjectRoutes } from "./http/projectRoutes.js";
import { registerBrainRoutes } from "./http/brainRoutes.js";
import { registerWorkflowRoutes } from "./http/workflowRoutes.js";
import { registerDockerRoutes } from "./http/dockerRoutes.js";
import { BrainService } from "./brain/brain.js";
import { registerRepoRoutes } from "./http/repoRoutes.js";
import { registerDesignRoutes } from "./http/designRoutes.js";
import { registerSlackRoutes } from "./http/slackRoutes.js";
import { registerGrafanaRoutes } from "./http/grafanaRoutes.js";
import { GrafanaExplorer } from "./integrations/grafanaExplorer.js";
import { registerWorkspaceRoutes } from "./http/workspaceRoutes.js";
import { registerSessionRoutes } from "./http/sessionRoutes.js";
import { registerConfigRoutes } from "./http/configRoutes.js";
import { registerWorkerRoutes } from "./http/workerRoutes.js";
import { registerForgeAuthRoutes } from "./http/forgeAuthRoutes.js";
import { registerGoogleOauthRoutes } from "./http/googleOauthRoutes.js";
import { registerProviderRoutes } from "./http/providerRoutes.js";
import { registerMcpRoutes } from "./http/mcpRoutes.js";
import { registerPhoneRoutes } from "./http/phoneRoutes.js";
import { registerChromeExtensionRoutes } from "./http/chromeExtensionRoutes.js";
import { electronResourcesPath } from "./runtime/chromeExtensionInstall.js";
import { registerHostRoutes } from "./http/hostRoutes.js";
import { registerImageRoutes } from "./http/imageRoutes.js";
import { registerShareRoutes } from "./http/shareRoutes.js";
import { registerDebugRoutes } from "./http/debugRoutes.js";
import { registerMachineRoutes } from "./http/machineRoutes.js";
import { registerTailscaleRoutes } from "./http/tailscaleRoutes.js";
import { registerBackupRoutes } from "./http/backupRoutes.js";
import { registerBenchmarkRoutes } from "./http/benchmarkRoutes.js";
import { BenchmarkService } from "./evals/benchmark.js";
import {
  attachPhoneGate,
  attachCanvasPreviewHostGate,
  controlPlaneCorsOrigin,
} from "./core/localguard.js";
import type { SessionService } from "./session/sessions.js";
import type { WorkflowService } from "./workflows/service.js";
import { buildSetupStatus } from "./setup.js";
import type { JsonStore } from "./core/store.js";
import { ForgeOauth } from "./git/forgeOauth.js";
import { GoogleOauth } from "./integrations/googleOauth.js";
import { SlackOauth } from "./slack/slackOauth.js";
import { SlackGateway } from "./slack/slackGateway.js";
import { slackSocketConnect } from "./slack/slackSocket.js";
import { Hub } from "./core/hub.js";
import {
  describeHost,
  nodeRunner,
  type CommandRunner,
  type HostCapabilities,
  type HostSetupInfo,
  type Hypervisor,
  type QemuInstallResult,
} from "@locus/hypervisor";

export function createApp(opts: {
  store: JsonStore;
  sessions: SessionService;
  hypervisor: Hypervisor;
  capabilities?: HostCapabilities;
  automations?: AutomationService;
  boards?: BoardService;
  projects?: ProjectService;
  repos?: RepoService;
  onConfigSaved?: (config: LocusConfig) => Promise<HostCapabilities | void>;
  runner?: CommandRunner;
  installQemu?: (opts?: { onOutput?: (chunk: string) => void }) => Promise<QemuInstallResult>;
  onQemuInstalled?: () => Promise<{
    hypervisor: Hypervisor;
    capabilities: HostCapabilities;
  } | void>;
  onReset?: () => Promise<{ hypervisor: Hypervisor; capabilities: HostCapabilities } | void>;
  host?: { platform?: string; osRelease?: string };
  fetchFn?: typeof fetch;
  listProviderModels?: ListProviderModelsFn;
  hub?: Hub;
  slack?: SlackGateway;
  brain?: BrainService;
  workflows?: WorkflowService;
  benchmarks?: BenchmarkService;
  peerAddress?: (c: import("hono").Context) => string | undefined;
  phoneTls?: { fingerprint: string };
}): Hono {
  const app = new Hono();
  let hypervisor = opts.hypervisor;
  let capabilities = opts.capabilities;
  const runner = opts.runner ?? nodeRunner;
  const listModels = opts.listProviderModels ?? listProviderModels;
  const oauth = new ForgeOauth(opts.store, opts.fetchFn ?? fetch);
  const slackOauth = new SlackOauth(opts.store, opts.fetchFn ?? fetch);
  const googleOauth = new GoogleOauth(opts.store, opts.fetchFn ?? fetch);
  const hub = opts.hub ?? new Hub();
  const brain = opts.brain ?? opts.sessions.plane.brain ?? new BrainService(opts.store, hub);
  opts.sessions.plane.brain = brain;
  const slack =
    opts.slack ??
    new SlackGateway(
      opts.store,
      opts.sessions,
      hub,
      opts.fetchFn ?? fetch,
      slackSocketConnect,
      brain,
    );

  async function hostInfo(): Promise<HostSetupInfo> {
    return describeHost(runner, opts.host);
  }

  async function setupJson() {
    const [config, images, host] = await Promise.all([
      opts.store.loadConfig(),
      opts.store.loadImages(),
      hostInfo(),
    ]);
    return buildSetupStatus({
      config,
      hypervisorKind: hypervisor.kind,
      dockerKind: opts.sessions.dockerKind(),
      capabilities,
      images,
      platform: host.os.platform,
      distro: host.os.distro,
      packageManager: host.packageManager,
    });
  }

  app.use("*", cors({ origin: controlPlaneCorsOrigin, credentials: true }));
  app.use("*", attachCanvasPreviewHostGate());
  app.use(
    "*",
    attachPhoneGate({
      remote: async () => (await opts.store.loadConfig()).phoneRemote,
      chromeExtension: async () => (await opts.store.loadConfig()).chromeExtension,
      peer: opts.peerAddress,
    }),
  );

  app.get("/api/health", async (c) =>
    c.json({
      ok: true,
      name: "locus",
      hypervisor: hypervisor.kind,
      docker: opts.sessions.dockerKind(),
      dockerReady: await opts.sessions.dockerReady(),
    }),
  );

  registerMcpRoutes(app, {
    store: opts.store,
    sessions: opts.sessions,
    brain,
    fetchFn: opts.fetchFn,
  });
  registerPhoneRoutes(app, {
    store: opts.store,
    onConfigSaved: opts.onConfigSaved,
    peerAddress: opts.peerAddress,
    phoneTls: opts.phoneTls,
  });
  registerChromeExtensionRoutes(app, {
    store: opts.store,
    hub: opts.sessions.chromeExtension,
    onConfigSaved: opts.onConfigSaved,
    peerAddress: opts.peerAddress,
    resourcesPath: electronResourcesPath(),
  });
  registerHostRoutes(app, {
    store: opts.store,
    sessions: opts.sessions,
    runner,
    host: opts.host,
    getHypervisor: () => hypervisor,
    setHypervisor: (next) => {
      hypervisor = next;
    },
    getCapabilities: () => capabilities,
    setCapabilities: (next) => {
      capabilities = next;
    },
    setupJson,
    hostInfo,
    hub,
    installQemu: opts.installQemu,
    onQemuInstalled: opts.onQemuInstalled,
  });

  registerConfigRoutes(app, {
    store: opts.store,
    sessions: opts.sessions,
    automations: opts.automations,
    slack,
    getHypervisor: () => hypervisor,
    setHypervisor: (next) => {
      hypervisor = next;
    },
    getCapabilities: () => capabilities,
    setCapabilities: (next) => {
      capabilities = next;
    },
    onConfigSaved: opts.onConfigSaved,
    onReset: opts.onReset,
    setupJson,
    fetchFn: opts.fetchFn,
  });
  registerWorkerRoutes(app, {
    store: opts.store,
    sessions: opts.sessions,
    onConfigSaved: opts.onConfigSaved,
    peerAddress: opts.peerAddress,
  });
  registerForgeAuthRoutes(app, { store: opts.store, oauth, slackOauth, googleOauth });
  registerProviderRoutes(app, { store: opts.store, listModels });

  registerSessionRoutes(app, {
    sessions: opts.sessions,
    store: opts.store,
    projects: opts.projects,
    repos: opts.repos,
    onConfigSaved: opts.onConfigSaved,
    peerAddress: opts.peerAddress,
  });

  registerImageRoutes(app, opts.store);
  registerShareRoutes(app, {
    store: opts.store,
    sessions: opts.sessions,
    getHypervisor: () => hypervisor,
  });
  registerDebugRoutes(app, {
    store: opts.store,
    sessions: opts.sessions,
    peerAddress: opts.peerAddress,
  });
  registerMachineRoutes(app, { store: opts.store, sessions: opts.sessions });
  registerDockerRoutes(app, opts.sessions.dockerInventory);
  registerTailscaleRoutes(app, { store: opts.store, runner });
  registerBackupRoutes(app, { store: opts.store, peerAddress: opts.peerAddress });
  registerBenchmarkRoutes(app, opts.benchmarks ?? new BenchmarkService(opts.store, opts.sessions));

  const grafana = new GrafanaExplorer(opts.store, opts.sessions, opts.fetchFn ?? fetch, brain);
  registerSlackRoutes(app, slack, slackOauth, opts.store);
  registerGrafanaRoutes(app, grafana);
  registerGoogleOauthRoutes(app, googleOauth, opts.store);
  registerDesignRoutes(app, opts.sessions.design, opts.store);
  registerWorkspaceRoutes(app, opts.sessions.workspace);
  registerRepoRoutes(app, opts.repos);

  registerAutomationRoutes(app, opts.automations);
  registerBoardRoutes(app, opts.boards);
  registerProjectRoutes(app, opts.projects);
  registerBrainRoutes(app, brain, {
    store: opts.store,
    fetchFn: opts.fetchFn,
    peerAddress: opts.peerAddress,
  });
  registerWorkflowRoutes(app, opts.workflows);

  return app;
}
