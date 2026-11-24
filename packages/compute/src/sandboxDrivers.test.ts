import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxWorkerConfig } from "@locus/shared";
import { SANDBOX_WORKER_PORT, type SandboxRecord, type SandboxWorker } from "./sandbox.js";
import { sandboxDrivers } from "./sandboxDrivers.js";

const mock = vi.hoisted(() => ({
  daytonaCreate: vi.fn(),
  daytonaGet: vi.fn(),
  daytonaDelete: vi.fn(),
  daytonaExec: vi.fn(),
  daytonaPreview: vi.fn(),
  daytonaSnapshot: vi.fn(),
  e2bCreate: vi.fn(),
  e2bList: vi.fn(),
  e2bKill: vi.fn(),
  e2bRun: vi.fn(),
  e2bTemplates: vi.fn(),
  modalCreate: vi.fn(),
  modalToken: vi.fn(),
  modalTerminate: vi.fn(),
  modalFromName: vi.fn(),
  modalApp: vi.fn(),
  modalImage: vi.fn(),
  runloopCreate: vi.fn(),
  runloopAwait: vi.fn(),
  runloopTunnel: vi.fn(),
  runloopList: vi.fn(),
  runloopRetrieve: vi.fn(),
  runloopShutdown: vi.fn(),
  runloopBlueprint: vi.fn(),
}));

vi.mock("@daytona/sdk", () => ({
  Daytona: class {
    create = mock.daytonaCreate;
    get = mock.daytonaGet;
    snapshot = { get: mock.daytonaSnapshot };
    async [Symbol.asyncDispose]() {}
  },
  DaytonaGoneError: class extends Error {},
  DaytonaNotFoundError: class extends Error {},
}));

vi.mock("e2b", () => ({
  Sandbox: { create: mock.e2bCreate, list: mock.e2bList, kill: mock.e2bKill },
  Template: { list: mock.e2bTemplates },
}));

vi.mock("modal", () => ({
  ModalClient: class {
    apps = { fromName: mock.modalApp };
    images = { fromId: mock.modalImage };
    sandboxes = {
      create: mock.modalCreate,
      fromId: vi.fn(async () => ({
        createConnectToken: mock.modalToken,
        terminate: mock.modalTerminate,
      })),
      fromName: mock.modalFromName,
    };
    close() {}
  },
  NotFoundError: class extends Error {},
}));

vi.mock("@runloop/api-client", () => ({
  Runloop: class {
    static NotFoundError = class extends Error {};
    blueprints = { retrieve: mock.runloopBlueprint };
    devboxes = {
      create: mock.runloopCreate,
      awaitRunning: mock.runloopAwait,
      enableTunnel: mock.runloopTunnel,
      list: mock.runloopList,
      retrieve: mock.runloopRetrieve,
      shutdown: mock.runloopShutdown,
    };
  },
}));

const marker = "locus-123456789012345678901234";
const profile: SandboxWorkerConfig = {
  template: "profile",
  app: "app",
  maxMinutes: 10,
  maxUsd: 1,
  rateDate: "2026-11-22",
};
const workerEnv = { LOCUS_WORKER_TOKEN: "lease-token", LOCUS_WORKER_TRANSPORT: "vendor-gateway" };

function worker(kind: SandboxWorker["kind"]): SandboxWorker {
  return { kind, id: "worker", token: "provider-key", name: "Worker", url: "", sandbox: profile };
}

function record(kind: SandboxRecord["kind"]): SandboxRecord {
  return {
    kind,
    marker,
    template: profile.template,
    deadlineAt: 1,
    reservedUsd: 0.2,
    hourlyUsd: 1,
    rateDate: profile.rateDate,
    app: profile.app,
  };
}

function pages<T>(items: T[]) {
  let hasNext = true;
  return {
    get hasNext() {
      return hasNext;
    },
    nextItems: async () => {
      hasNext = false;
      return items;
    },
  };
}

describe("managed sandbox provider contracts", () => {
  beforeEach(() => vi.resetAllMocks());

  it("Daytona creates a private ephemeral sandbox with a wall-clock TTL and confirms deletion", async () => {
    const backend = worker("daytona");
    const driver = sandboxDrivers.daytona;
    const sandbox = {
      id: "day-sandbox",
      labels: { locus_provisioning: marker },
      process: { executeCommand: mock.daytonaExec },
      getPreviewLink: mock.daytonaPreview,
      delete: mock.daytonaDelete,
    };
    mock.daytonaSnapshot.mockResolvedValue({ gpu: 0 });
    mock.daytonaCreate.mockResolvedValue(sandbox);
    mock.daytonaGet.mockResolvedValue(sandbox);
    mock.daytonaExec.mockResolvedValue({ exitCode: 0 });
    mock.daytonaPreview.mockResolvedValue({
      url: "https://7421-id.proxy.daytona.work",
      token: "preview",
    });
    await driver.verify(backend, profile);
    const lease = await driver.create({ backend, marker, profile, workerEnv });
    expect(mock.daytonaSnapshot).toHaveBeenCalledWith(profile.template);
    expect(mock.daytonaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        public: false,
        ephemeral: true,
        ttlMinutes: 10,
        snapshot: profile.template,
        name: marker,
      }),
      expect.anything(),
    );
    expect(await lease.connect()).toEqual({
      url: "https://7421-id.proxy.daytona.work",
      headers: { "x-daytona-preview-token": "preview" },
    });
    expect(mock.daytonaExec.mock.calls[0]?.[2]).toEqual(workerEnv);
    expect(await driver.find(backend, record("daytona"))).toEqual([lease.id]);
    await driver.destroy(backend, record("daytona"), lease.id);
    expect(mock.daytonaDelete).toHaveBeenCalledWith(15, true);
  });

  it("E2B takes a private template, disables auto-resume, and uses its own traffic token", async () => {
    const backend = worker("e2b");
    const driver = sandboxDrivers.e2b;
    mock.e2bTemplates.mockReturnValue(pages([{ templateId: profile.template }]));
    mock.e2bCreate.mockResolvedValue({
      sandboxId: "e2-sandbox",
      trafficAccessToken: "traffic",
      getHost: (_port: number) => "7421-id.e2b.app",
      commands: { run: mock.e2bRun },
    });
    mock.e2bList.mockReturnValue(
      pages([
        { sandboxId: "e2-sandbox", metadata: { locus_provisioning: marker } },
        { sandboxId: "outside-scope", metadata: { locus_provisioning: "different" } },
      ]),
    );
    await driver.verify(backend, profile);
    const lease = await driver.create({ backend, marker, profile, workerEnv });
    expect(mock.e2bCreate).toHaveBeenCalledWith(
      profile.template,
      expect.objectContaining({
        timeoutMs: 600_000,
        lifecycle: { onTimeout: "kill", autoResume: false },
        network: { allowPublicTraffic: false },
      }),
    );
    expect((await lease.connect()).headers).toEqual({ "e2b-traffic-access-token": "traffic" });
    expect(mock.e2bRun).toHaveBeenCalledWith(
      expect.stringContaining("node /opt/locus/locus-worker.mjs"),
      expect.objectContaining({
        envs: workerEnv,
        background: true,
      }),
    );
    expect(await driver.find(backend, record("e2b"))).toEqual([lease.id]);
    await driver.destroy(backend, record("e2b"), lease.id);
    expect(mock.e2bKill).toHaveBeenCalledWith(lease.id, expect.objectContaining({ retries: 0 }));
  });

  it("Modal sets hard resource limits, uses a connect token, and waits for termination", async () => {
    const backend = worker("modal");
    const driver = sandboxDrivers.modal;
    mock.modalCreate.mockResolvedValue({ sandboxId: "sb-id" });
    mock.modalFromName.mockResolvedValue({ sandboxId: "sb-id" });
    mock.modalToken.mockResolvedValue({ url: "https://sb.modal.run", token: "connect" });
    await driver.verify(backend, profile);
    const lease = await driver.create({ backend, marker, profile, workerEnv });
    expect(mock.modalApp).toHaveBeenCalledWith(profile.app, { createIfMissing: false });
    expect(mock.modalImage).toHaveBeenCalledWith(profile.template);
    expect(mock.modalCreate.mock.calls[0]?.[2]).toMatchObject({
      name: marker,
      timeoutMs: 600_000,
      cpu: 1,
      cpuLimit: 1,
      memoryMiB: 1024,
      memoryLimitMiB: 1024,
      env: workerEnv,
    });
    expect((await lease.connect()).headers).toEqual({ authorization: "Bearer connect" });
    expect(mock.modalToken).toHaveBeenCalledWith({ port: SANDBOX_WORKER_PORT });
    expect(await driver.find(backend, record("modal"))).toEqual([lease.id]);
    expect(mock.modalFromName).toHaveBeenCalledWith(profile.app, marker, {
      includeTerminated: true,
    });
    await driver.destroy(backend, record("modal"), lease.id);
    expect(mock.modalTerminate).toHaveBeenCalledWith({ wait: true });
  });

  it("Runloop sets a fixed lifetime and treats a pending shutdown as unconfirmed", async () => {
    const backend = worker("runloop");
    const driver = sandboxDrivers.runloop;
    mock.runloopCreate.mockResolvedValue({ id: "db-id" });
    mock.runloopTunnel.mockResolvedValue({
      auth_mode: "authenticated",
      tunnel_key: "id",
      auth_token: "tunnel",
    });
    mock.runloopList.mockReturnValue([
      { id: "db-id", metadata: { locus_provisioning: marker } },
      { id: "outside-scope", metadata: {} },
    ]);
    mock.runloopRetrieve.mockResolvedValue({ status: "running" });
    mock.runloopShutdown
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValueOnce({ status: "shutdown" });
    await driver.verify(backend, profile);
    const lease = await driver.create({ backend, marker, profile, workerEnv });
    expect(mock.runloopBlueprint).toHaveBeenCalledWith(profile.template);
    expect(mock.runloopCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        blueprint_id: profile.template,
        launch_parameters: { keep_alive_time_seconds: 600, resource_size_request: "SMALL" },
        environment_variables: workerEnv,
      }),
    );
    expect(await lease.connect()).toEqual({
      url: "https://7421-id.tunnel.runloop.ai",
      headers: { authorization: "Bearer tunnel" },
    });
    expect(mock.runloopTunnel).toHaveBeenCalledWith(lease.id, {
      auth_mode: "authenticated",
      wake_on_http: false,
    });
    expect(await driver.find(backend, record("runloop"))).toEqual([lease.id]);
    await expect(driver.destroy(backend, record("runloop"), lease.id)).rejects.toThrow(
      /has not confirmed/,
    );
    await driver.destroy(backend, record("runloop"), lease.id);
  });
});
