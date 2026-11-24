import { randomBytes } from "node:crypto";
import {
  SANDBOX_WORKER_NAMES,
  sandboxMaxEstimatedUsd,
  sandboxWorkerConfigError,
  sandboxWorkerKind,
  workerMaxConcurrent,
  workerPickSize,
  type SandboxWorkerConfig,
  type SandboxWorkerKind,
  type WorkerBackend,
} from "@locus/shared";
import {
  loadComputeTaskRegistry,
  type ComputeTaskRecord,
  type ComputeTaskRegistry,
} from "./registry.js";
import type { ComputeBackend, ComputeHandle, CostQuote, ProvisionRequest } from "./types.js";

export type SandboxRecord = {
  kind: SandboxWorkerKind;
  marker: string;
  template: string;
  region?: string;
  deadlineAt: number;
  reservedUsd: number;
  hourlyUsd: number;
  rateDate: string;
  closedUsd?: number;
  closedAt?: string;
  app?: string;
  remoteId?: string;
};

export type SandboxWorker = WorkerBackend & { kind: SandboxWorkerKind; token: string };
export type SandboxGateway = { url: string; headers: Record<string, string> };

export interface SandboxDriver {
  verify(backend: SandboxWorker, profile: SandboxWorkerConfig): Promise<void>;
  create(input: {
    backend: SandboxWorker;
    marker: string;
    profile: SandboxWorkerConfig;
    workerEnv: Record<string, string>;
  }): Promise<{ id: string; connect: () => Promise<SandboxGateway> }>;
  /** Search only for this installation's exact provisioning marker. */
  find(backend: SandboxWorker, record: SandboxRecord): Promise<string[]>;
  destroy(backend: SandboxWorker, record: SandboxRecord, remoteId: string): Promise<void>;
}

const GATEWAY_DOMAINS: Record<SandboxWorkerKind, readonly string[]> = {
  daytona: ["proxy.daytona.work", "proxy.daytona.io"],
  e2b: ["e2b.app"],
  modal: ["modal.host", "modal.run"],
  runloop: ["tunnel.runloop.ai"],
};

export const SANDBOX_WORKER_PORT = 7421;
export const SANDBOX_WORKER_COMMAND = [
  "/opt/locus/node_modules/.bin/tsx",
  "/opt/locus/packages/worker/src/main.ts",
] as const;
/** Single-file worker that templates built from Settings carry instead of the source tree. */
export const SANDBOX_WORKER_BUNDLE = "/opt/locus/locus-worker.mjs";
/** Shell launcher: the bundled worker when present, else the image's source tree via tsx. */
export const SANDBOX_WORKER_SHELL = `if [ -f ${SANDBOX_WORKER_BUNDLE} ]; then exec node ${SANDBOX_WORKER_BUNDLE}; else exec ${SANDBOX_WORKER_COMMAND.join(" ")}; fi`;

function validateGateway(kind: SandboxWorkerKind, gateway: SandboxGateway): string {
  const url = new URL(gateway.url);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !GATEWAY_DOMAINS[kind].some((domain) => url.hostname.endsWith(`.${domain}`)) ||
    !Object.keys(gateway.headers).length ||
    Object.values(gateway.headers).some((value) => !value.trim())
  ) {
    throw new Error(`${SANDBOX_WORKER_NAMES[kind]} did not return an authenticated worker gateway`);
  }
  return url.origin;
}

/** One lease and one authenticated WorkerClient per provider resource. */
export class SandboxComputeBackend implements ComputeBackend {
  private readonly registry: ComputeTaskRegistry;
  private readonly starting = new Set<string>();
  private readonly stopping = new Map<string, Promise<void>>();
  private readonly handles = new Map<string, ComputeHandle>();

  constructor(
    private readonly drivers: Record<SandboxWorkerKind, SandboxDriver>,
    registryPath?: string,
    private readonly clock = Date.now,
  ) {
    this.registry = loadComputeTaskRegistry(registryPath);
  }

  quote(
    backend: WorkerBackend,
    size: string,
  ): CostQuote & Required<Pick<CostQuote, "maxEstimatedUsd" | "rateDate">> {
    const error = sandboxWorkerConfigError(backend, this.clock());
    if (error) throw new Error(error);
    if (!sandboxWorkerKind(backend.kind) || !backend.sandbox || !backend.hourlyUsd) {
      throw new Error("An approved sandbox profile and rate are required");
    }
    const { maxMinutes, rateDate } = backend.sandbox;
    return {
      size: workerPickSize(backend, size),
      usdPerHour: backend.hourlyUsd,
      maxEstimatedUsd: sandboxMaxEstimatedUsd(maxMinutes, backend.hourlyUsd),
      rateDate,
    };
  }

  async verify(backend: WorkerBackend): Promise<void> {
    this.quote(backend, "");
    const provider = this.requireCredentials(backend);
    try {
      await this.drivers[provider.kind].verify(provider, backend.sandbox!);
    } catch {
      throw new Error(
        `${SANDBOX_WORKER_NAMES[provider.kind]} could not verify this profile. Check the credentials and the existing template or image.`,
      );
    }
  }

  async provision(req: ProvisionRequest): Promise<ComputeHandle> {
    await this.verify(req.backend);
    const quote = this.quote(req.backend, req.size);
    const backend = this.requireCredentials(req.backend);
    const profile = req.backend.sandbox!;
    const now = this.clock();
    this.registry.assertReadable();
    const rows = this.registry.list();
    const sessionRows = rows.filter((row) => row.sessionId === req.sessionId);
    const tracked = rows.filter(
      (row) => row.backendId === backend.id && row.sandbox?.closedUsd === undefined,
    );
    if (sessionRows.some((row) => row.sandbox?.closedUsd === undefined)) {
      throw new Error("This session already has a sandbox lease awaiting cleanup");
    }
    const spent = sessionRows.reduce((sum, row) => sum + (row.sandbox?.closedUsd ?? 0), 0);
    if (spent + quote.maxEstimatedUsd > profile.maxUsd) {
      throw new Error("This session's remaining sandbox budget cannot cover a new lease");
    }
    const cap = workerMaxConcurrent(backend) ?? 1;
    if (tracked.length >= cap) {
      throw new Error(
        `Worker ${backend.name} already has ${cap} tracked sandboxes (maxConcurrent)`,
      );
    }

    const marker = `locus-${randomBytes(12).toString("hex")}`;
    const id = `${backend.kind}:${marker}`;
    const record: SandboxRecord = {
      kind: backend.kind,
      marker,
      template: profile.template,
      ...(backend.region ? { region: backend.region } : {}),
      deadlineAt: now + profile.maxMinutes * 60_000,
      reservedUsd: quote.maxEstimatedUsd,
      hourlyUsd: quote.usdPerHour,
      rateDate: profile.rateDate,
      ...(profile.app ? { app: profile.app } : {}),
    };
    const intent: ComputeTaskRecord = {
      id,
      backendId: backend.id,
      sessionId: req.sessionId,
      requestedAt: new Date(now).toISOString(),
      size: quote.size,
      sandbox: record,
    };
    this.registry.upsert(intent);
    this.starting.add(id);

    const driver = this.drivers[backend.kind];
    const token = randomBytes(24).toString("base64url");
    try {
      const remote = await driver.create({
        backend,
        marker,
        profile,
        workerEnv: {
          LOCUS_WORKER_TOKEN: token,
          LOCUS_WORKER_TRANSPORT: "vendor-gateway",
          LOCUS_WORKER_HOME: "/tmp/locus-worker",
          LOCUS_WORKER_HOST: "0.0.0.0",
          LOCUS_WORKER_PORT: String(SANDBOX_WORKER_PORT),
          LOCUS_WORKER_ALLOW_HOST: "1",
        },
      });
      try {
        this.registry.upsert({ ...intent, sandbox: { ...record, remoteId: remote.id } });
      } catch (err) {
        await driver.destroy(backend, record, remote.id).catch(() => undefined);
        throw err;
      }
      const gateway = await remote.connect();
      if (this.clock() >= record.deadlineAt) throw new Error("Sandbox expired during startup");
      const handle: ComputeHandle = {
        id,
        token,
        url: validateGateway(backend.kind, gateway),
        size: quote.size,
        requestedAt: intent.requestedAt,
        gateway: { headers: gateway.headers, deadlineAt: record.deadlineAt },
      };
      this.handles.set(id, handle);
      return handle;
    } catch (err) {
      await this.destroy(id, backend).catch(() => undefined);
      throw new Error(
        `${SANDBOX_WORKER_NAMES[backend.kind]} sandbox failed to start. Check the worker profile, permissions, and cleanup status.`,
        { cause: err },
      );
    } finally {
      this.starting.delete(id);
    }
  }

  get(id: string): ComputeHandle | undefined {
    const handle = this.handles.get(id);
    return handle?.gateway && handle.gateway.deadlineAt > this.clock() ? handle : undefined;
  }

  destroy(id: string, backend?: WorkerBackend): Promise<void> {
    const existing = this.stopping.get(id);
    if (existing) return existing;
    const result = this.destroyTracked(id, backend).finally(() => this.stopping.delete(id));
    this.stopping.set(id, result);
    return result;
  }

  private async destroyTracked(id: string, configured?: WorkerBackend): Promise<void> {
    this.registry.assertReadable();
    const row = this.registry.get(id);
    const record = row?.sandbox;
    if (!row || !record || record.closedUsd !== undefined) return;
    this.handles.delete(id);
    if (configured?.id !== row.backendId || configured.kind !== record.kind) {
      throw new Error("Sandbox cleanup needs the original worker configuration and credentials");
    }
    const backend = this.requireCredentials({ ...configured, region: record.region });
    const driver = this.drivers[record.kind];
    // An intent or confirmed ID remains durable even if this attempt cannot save its status.
    const pending = { ...row, cleanupPending: true };
    this.registry.upsert(pending);
    const remoteIds = record.remoteId ? [record.remoteId] : await driver.find(backend, record);
    if (remoteIds.length === 0) {
      // An empty provider listing cannot resolve an ambiguous creation.
      throw new Error("Sandbox provisioning result remains unconfirmed");
    }
    for (const remoteId of remoteIds) await driver.destroy(backend, record, remoteId);
    const requestedAt = Date.parse(row.requestedAt ?? "");
    const closedAt = this.clock();
    const elapsed = (closedAt - requestedAt) / 60_000;
    const closedUsd =
      Number.isFinite(elapsed) && elapsed >= 0
        ? sandboxMaxEstimatedUsd(elapsed, record.hourlyUsd) * remoteIds.length
        : record.reservedUsd * remoteIds.length;
    this.registry.upsert({
      ...row,
      cleanupPending: false,
      sandbox: { ...record, closedUsd, closedAt: new Date(closedAt).toISOString() },
    });
  }

  async listOrphans(liveIds: Set<string>) {
    this.registry.assertReadable();
    return this.registry.list().flatMap((row) => {
      if (row.sandbox?.closedUsd !== undefined || this.starting.has(row.id)) return [];
      const cleanupPending = row.cleanupPending || !this.get(row.id);
      if (liveIds.has(row.id) && !cleanupPending) return [];
      return [{ id: row.id, backendId: row.backendId, sessionId: row.sessionId, cleanupPending }];
    });
  }

  private requireCredentials(backend: WorkerBackend): SandboxWorker {
    const kind = sandboxWorkerKind(backend.kind);
    const token = backend.token?.trim();
    if (!kind || !token || (kind === "modal" && !backend.accessKeyId?.trim())) {
      throw new Error("Add the sandbox provider credentials in Settings → Workers");
    }
    return { ...backend, kind, token };
  }
}
