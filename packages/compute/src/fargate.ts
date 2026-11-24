import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import {
  awsSigningRegion,
  awsSigningService,
  workerMaxConcurrent,
  DEFAULT_FARGATE_CLUSTER,
  resolveAwsServiceUrl,
  type WorkerBackend,
} from "@locus/shared";
import { signAwsV4 } from "@locus/shared/awsSign";
import { fargateResources, quoteCloudSize } from "./prices.js";
import {
  loadComputeTaskRegistry,
  handleFromRecord,
  type ComputeTaskRecord,
  type ComputeTaskRegistry,
} from "./registry.js";
import type {
  ComputeBackend,
  ComputeHandle,
  ComputeOrphan,
  CostQuote,
  ProvisionRequest,
} from "./types.js";

const ECS_TARGET_PREFIX = "AmazonEC2ContainerServiceV20141113.";
/** ENI attach on a cold Fargate task commonly takes 10–60s. Poll every 2s for up to 3 minutes. */
const DESCRIBE_ATTEMPTS = 90;
const DESCRIBE_INTERVAL_MS = 2_000;
/** Container name the task definition must use for the `locus-worker` container. */
export const FARGATE_WORKER_CONTAINER = "worker";

export class FargateComputeBackend implements ComputeBackend {
  private readonly provisioning = new Set<string>();
  private readonly stopping = new Map<string, Promise<void>>();
  private handles = new Map<string, ComputeHandle>();
  private creds = new Map<
    string,
    { region: string; cluster: string; accessKeyId: string; secret: string; ecsUrl?: string }
  >();
  private readonly fetchFn: typeof fetch;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly registry: ComputeTaskRegistry;

  constructor(
    fetchFn: typeof fetch = fetch,
    wait?: (ms: number) => Promise<void>,
    registryPath?: string,
  ) {
    this.fetchFn = fetchFn;
    this.wait = wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.registry = loadComputeTaskRegistry(registryPath);
    for (const row of this.registry.list()) {
      const handle = handleFromRecord(row);
      if (handle) this.handles.set(handle.id, handle);
    }
  }

  quote(backend: WorkerBackend, size: string): CostQuote {
    return quoteCloudSize(backend, size, "Fargate");
  }

  async provision(req: ProvisionRequest): Promise<ComputeHandle> {
    const quoted = this.quote(req.backend, req.size);
    const resources = fargateResources(quoted.size);
    const region = req.backend.region?.trim();
    if (!region) throw new Error("Fargate workers need a region");
    const cluster = req.backend.cluster?.trim() || DEFAULT_FARGATE_CLUSTER;
    const ecsUrl = req.backend.ecsUrl?.trim() || undefined;
    resolveAwsServiceUrl({ service: "ecs", region, overrideUrl: ecsUrl });
    if (!req.backend.taskDefinition?.trim())
      throw new Error("Fargate workers need a task definition");
    this.registry.assertReadable();
    const cap = workerMaxConcurrent(req.backend);
    const tracked = this.registry.list().filter((row) => row.backendId === req.backend.id);
    if (tracked.some((row) => row.sessionId === req.sessionId)) {
      throw new Error(
        "This session already has a Fargate task or provisioning attempt to reconcile",
      );
    }
    if (cap !== undefined && tracked.length >= cap) {
      throw new Error(
        `Worker ${req.backend.name} already has ${cap} tracked Fargate tasks (maxConcurrent)`,
      );
    }
    if (!req.backend.accessKeyId?.trim() || !req.backend.token?.trim()) {
      throw new Error("Fargate workers need an AWS access key");
    }
    const startedBy = `locus-${randomBytes(12).toString("hex")}`;
    const intent = {
      id: startedBy,
      backendId: req.backend.id,
      sessionId: req.sessionId,
      size: quoted.size,
      requestedAt: new Date().toISOString(),
      fargate: { startedBy, region, cluster, ecsUrl },
    };
    this.registry.upsert(intent);
    this.provisioning.add(startedBy);
    try {
      return await this.runTrackedTask(req, intent, resources);
    } finally {
      this.provisioning.delete(startedBy);
    }
  }

  private async runTrackedTask(
    req: ProvisionRequest,
    intent: ComputeTaskRecord & Required<Pick<ComputeTaskRecord, "size" | "fargate">>,
    resources: ReturnType<typeof fargateResources>,
  ): Promise<ComputeHandle> {
    const { startedBy, region, cluster, ecsUrl } = intent.fargate;
    const token = randomWorkerToken();
    const environment = fargateWorkerEnvironment({
      token,
      sessionId: req.sessionId,
      tls: req.workerTls,
    });
    const subnet = req.backend.subnet?.trim();
    const securityGroup = req.backend.securityGroup?.trim();
    const run = await this.ecs<Record<string, unknown>>(req.backend, "RunTask", {
      cluster,
      clientToken: startedBy,
      startedBy,
      taskDefinition: req.backend.taskDefinition,
      launchType: "FARGATE",
      count: 1,
      platformVersion: "LATEST",
      overrides: {
        cpu: resources.cpu,
        memory: resources.memory,
        containerOverrides: [{ name: FARGATE_WORKER_CONTAINER, environment }],
      },
      ...(subnet
        ? {
            networkConfiguration: {
              awsvpcConfiguration: {
                subnets: [subnet],
                ...(securityGroup ? { securityGroups: [securityGroup] } : {}),
                assignPublicIp: "ENABLED",
              },
            },
          }
        : {}),
      tags: [
        { key: "locus:managed", value: "true" },
        { key: "locus:session", value: req.sessionId },
        { key: "locus:provisioning", value: startedBy },
      ],
    });
    const taskArn = taskArnFrom(run);
    if (!taskArn) {
      const reason = runFailureFrom(run);
      if (Array.isArray(run.tasks) && run.tasks.length === 0 && reason) {
        this.registry.remove(intent.id);
      }
      throw new Error(
        reason ? `Fargate RunTask failed: ${reason}` : "Fargate RunTask did not return a task ARN",
      );
    }
    const task = { ...intent, id: taskArn };
    try {
      this.registry.upsert(task, intent.id);
    } catch (err) {
      // The original intent is durable even if the ARN update fails. Try to stop immediately.
      await this.requestStop(req.backend, cluster, taskArn).catch(() => undefined);
      throw err;
    }
    this.creds.set(taskArn, {
      region,
      cluster,
      accessKeyId: req.backend.accessKeyId!.trim(),
      secret: req.backend.token!.trim(),
      ecsUrl,
    });
    try {
      const ip = await this.waitForWorkerIp(req.backend, cluster, taskArn);
      const handle: ComputeHandle = {
        id: taskArn,
        url: `https://${ip}:7421`,
        token,
        size: task.size,
        requestedAt: task.requestedAt,
        ...(req.workerTls?.fingerprint ? { fingerprint: req.workerTls.fingerprint } : {}),
      };
      this.registry.upsert({
        ...task,
        url: handle.url,
        token: handle.token,
        size: handle.size,
        fingerprint: handle.fingerprint,
      });
      this.handles.set(handle.id, handle);
      return handle;
    } catch (err) {
      await this.destroy(taskArn, req.backend).catch(() => undefined);
      throw err;
    }
  }

  destroy(id: string, backend?: WorkerBackend): Promise<void> {
    const existing = this.stopping.get(id);
    if (existing) return existing;
    const pending = this.destroyTracked(id, backend).finally(() => this.stopping.delete(id));
    this.stopping.set(id, pending);
    return pending;
  }

  private async destroyTracked(id: string, backend?: WorkerBackend): Promise<void> {
    this.registry.assertReadable();
    let task = this.registry.get(id);
    if (!task) return;
    const stored = this.creds.get(id);
    const scope = task.fargate ?? stored ?? backend;
    const accessKeyId = backend?.accessKeyId ?? stored?.accessKeyId;
    const token = backend?.token ?? stored?.secret;
    const credentialsAvailable = scope?.region && accessKeyId && token;
    const cluster = scope?.cluster?.trim() || DEFAULT_FARGATE_CLUSTER;
    const row: WorkerBackend = {
      id: task.backendId,
      name: "Fargate cleanup",
      url: "",
      kind: "fargate",
      region: scope?.region,
      cluster,
      ecsUrl: scope?.ecsUrl,
      accessKeyId,
      token,
    };
    this.handles.delete(id);
    const isIntent = task.fargate?.startedBy === id;
    if (!task.cleanupPending) {
      task = { ...task, cleanupPending: true, token: undefined };
      try {
        this.registry.upsert(task);
      } catch (err) {
        // The previous record still tracks this resource even if the marker could not be saved.
        if (!isIntent && credentialsAvailable) {
          await this.requestStop(row, cluster, id).catch(() => undefined);
        }
        throw err;
      }
    }
    if (!credentialsAvailable) {
      throw new Error("Fargate cleanup needs the original worker's AWS credentials");
    }
    if (isIntent) {
      const discovered = await this.ecs<{ taskArns?: string[]; nextToken?: string }>(
        row,
        "ListTasks",
        { cluster, startedBy: id },
      );
      const arn = discovered.taskArns?.[0];
      // ECS is eventually consistent. An empty listing cannot prove that RunTask failed.
      if (!arn?.startsWith("arn:") || discovered.taskArns?.length !== 1 || discovered.nextToken) {
        throw new Error("Fargate provisioning outcome is still unconfirmed");
      }
      try {
        this.registry.upsert({ ...task, id: arn }, id);
      } catch (err) {
        await this.requestStop(row, cluster, arn).catch(() => undefined);
        throw err;
      }
      await this.destroy(arn, row);
      return;
    }

    if (!task.fargate?.stopAccepted) {
      // A response can be lost after ECS accepted it. Confirm the status before retrying.
      const stopped = await this.requestStop(row, cluster, id).catch(() => undefined);
      if (stopped?.taskArn === id && stopped.lastStatus === "STOPPED") {
        this.forgetTask(id);
        return;
      }
      if (stopped?.taskArn === id && stopped.desiredStatus === "STOPPED" && task.fargate) {
        task = { ...task, fargate: { ...task.fargate, stopAccepted: true } };
        this.registry.upsert(task);
      }
    }

    const described = await this.ecs<{
      tasks?: { taskArn?: string; lastStatus?: string; desiredStatus?: string }[];
      failures?: { arn?: string; reason?: string }[];
    }>(row, "DescribeTasks", { cluster, tasks: [id] });
    const status = described.tasks?.find((candidate) => candidate.taskArn === id);
    const missingAfterStop =
      task.fargate?.stopAccepted &&
      described.failures?.some((failure) => failure.arn === id && failure.reason === "MISSING");
    if (status?.lastStatus === "STOPPED" || missingAfterStop) {
      this.forgetTask(id);
      return;
    }
    throw new Error("ECS has not confirmed that the Fargate task stopped");
  }

  private async requestStop(backend: WorkerBackend, cluster: string, task: string) {
    const response = await this.ecs<{
      task?: { taskArn?: string; lastStatus?: string; desiredStatus?: string };
    }>(backend, "StopTask", { cluster, task, reason: "locus destroy-on-stop" });
    return response.task;
  }

  private forgetTask(id: string): void {
    this.registry.remove(id);
    this.creds.delete(id);
  }

  get(id: string): ComputeHandle | undefined {
    return this.handles.get(id);
  }

  async listOrphans(liveIds: Set<string>): Promise<ComputeOrphan[]> {
    this.registry.assertReadable();
    return this.registry.list().flatMap((row) => {
      if (row.fargate && this.provisioning.has(row.fargate.startedBy)) return [];
      if (!row.cleanupPending && liveIds.has(row.id)) return [];
      return [
        {
          id: row.id,
          backendId: row.backendId,
          sessionId: row.sessionId,
          ...(row.cleanupPending ? { cleanupPending: true } : {}),
        },
      ];
    });
  }

  private async waitForWorkerIp(
    backend: WorkerBackend,
    cluster: string,
    taskArn: string,
  ): Promise<string> {
    const deadline = Date.now() + DESCRIBE_ATTEMPTS * DESCRIBE_INTERVAL_MS;
    for (let attempt = 0; attempt < DESCRIBE_ATTEMPTS && Date.now() < deadline; attempt += 1) {
      if (attempt) await this.wait(DESCRIBE_INTERVAL_MS);
      const described = await this.ecs<Record<string, unknown>>(backend, "DescribeTasks", {
        cluster,
        tasks: [taskArn],
      });
      const stopped = stoppedReasonFrom(described);
      if (stopped) throw new Error(`Fargate task stopped before it was reachable: ${stopped}`);
      const ip = workerIpFrom(described);
      if (ip) return ip;
    }
    throw new Error("Fargate task did not get an ENI address within 3 minutes");
  }

  private async ecs<T>(
    backend: WorkerBackend,
    action: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const region = backend.region?.trim();
    if (!region) throw new Error("Fargate workers need a region");
    const accessKeyId = backend.accessKeyId?.trim();
    const secret = backend.token?.trim();
    if (!accessKeyId || !secret) throw new Error("Fargate workers need an AWS access key");
    const payload = JSON.stringify(body);
    const url = resolveAwsServiceUrl({
      service: "ecs",
      region,
      overrideUrl: backend.ecsUrl,
    });
    const headers = signAwsV4({
      method: "POST",
      url,
      region: awsSigningRegion(url, "ecs", region),
      service: awsSigningService(url, "ecs"),
      payload,
      accessKeyId,
      secret,
      extra: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": `${ECS_TARGET_PREFIX}${action}`,
      },
    });
    const res = await this.fetchFn(url, {
      method: "POST",
      headers,
      body: payload,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(ecsError(text, action, res.status));
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/**
 * Container env for the `worker` container: the per-task bearer token, host-runtime opt-in
 * (the task itself is the sandbox), and the minted TLS identity as base64 PEM.
 */
export function fargateWorkerEnvironment(input: {
  token: string;
  sessionId: string;
  tls?: { cert: string; key: string };
}): { name: string; value: string }[] {
  const env = [
    { name: "LOCUS_WORKER_TOKEN", value: input.token },
    { name: "LOCUS_WORKER_ALLOW_HOST", value: "1" },
    { name: "LOCUS_WORKER_NAME", value: `locus-${input.sessionId.slice(0, 8)}` },
  ];
  if (input.tls) {
    env.push(
      { name: "LOCUS_WORKER_TLS_CERT_B64", value: Buffer.from(input.tls.cert).toString("base64") },
      { name: "LOCUS_WORKER_TLS_KEY_B64", value: Buffer.from(input.tls.key).toString("base64") },
    );
  }
  return env;
}

function randomWorkerToken(): string {
  return randomBytes(24).toString("base64url");
}

function taskArnFrom(body: Record<string, unknown>): string | undefined {
  const tasks = body.tasks;
  if (!Array.isArray(tasks) || !tasks[0] || typeof tasks[0] !== "object") return undefined;
  const arn = (tasks[0] as { taskArn?: unknown }).taskArn;
  return typeof arn === "string" ? arn : undefined;
}

function runFailureFrom(body: Record<string, unknown>): string | undefined {
  const failures = body.failures;
  if (!Array.isArray(failures) || !failures[0] || typeof failures[0] !== "object") return undefined;
  const row = failures[0] as { reason?: unknown; detail?: unknown };
  const reason = typeof row.reason === "string" ? row.reason : "";
  const detail = typeof row.detail === "string" ? row.detail : "";
  return [reason, detail].filter(Boolean).join(" — ") || undefined;
}

function stoppedReasonFrom(body: Record<string, unknown>): string | undefined {
  const tasks = body.tasks;
  if (!Array.isArray(tasks) || !tasks[0] || typeof tasks[0] !== "object") return undefined;
  const task = tasks[0] as {
    lastStatus?: unknown;
    stoppedReason?: unknown;
    containers?: unknown;
  };
  if (task.lastStatus !== "STOPPED" && task.lastStatus !== "DEPROVISIONING") return undefined;
  const containerReason = Array.isArray(task.containers)
    ? task.containers
        .map((row) =>
          row && typeof row === "object" ? (row as { reason?: unknown }).reason : undefined,
        )
        .find((reason): reason is string => typeof reason === "string" && Boolean(reason.trim()))
    : undefined;
  const stopped = typeof task.stoppedReason === "string" ? task.stoppedReason : "";
  return [stopped, containerReason].filter(Boolean).join(" — ") || "task stopped";
}

function workerIpFrom(body: Record<string, unknown>): string | undefined {
  const tasks = body.tasks;
  if (!Array.isArray(tasks) || !tasks[0] || typeof tasks[0] !== "object") return undefined;
  const attachments = (tasks[0] as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return undefined;
  let privateIp: string | undefined;
  for (const row of attachments) {
    if (!row || typeof row !== "object") continue;
    const details = (row as { details?: unknown }).details;
    if (!Array.isArray(details)) continue;
    for (const detail of details) {
      if (!detail || typeof detail !== "object") continue;
      const name = (detail as { name?: unknown }).name;
      const value = (detail as { value?: unknown }).value;
      if (typeof value !== "string" || isIP(value) !== 4) continue;
      if (name === "publicIPv4Address") return value;
      if (name === "privateIPv4Address") privateIp = value;
    }
  }
  return privateIp;
}

function ecsError(text: string, action: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { message?: string; Message?: string };
    const message = parsed.message || parsed.Message;
    if (message) return `Fargate ${action} failed: ${message}`;
  } catch {
    /* raw */
  }
  return `Fargate ${action} failed (${status})`;
}
