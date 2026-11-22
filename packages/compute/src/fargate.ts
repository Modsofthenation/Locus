import { randomBytes } from "node:crypto";
import {
  awsSigningRegion,
  awsSigningService,
  workerAllowedSizes,
  workerPickSize,
  DEFAULT_FARGATE_CLUSTER,
  resolveAwsServiceUrl,
  type WorkerBackend,
} from "@locus/shared";
import { signAwsV4 } from "@locus/shared/awsSign";
import { fargateResources, fargateUsdPerHour } from "./prices.js";
import { loadComputeTaskRegistry, handleFromRecord, type ComputeTaskRegistry } from "./registry.js";
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
    const resolved = workerPickSize(backend, size);
    if (!workerAllowedSizes(backend)?.length) {
      throw new Error(
        "Fargate workers need a size allowlist so a runaway agent cannot pick 4 vCPU",
      );
    }
    return { size: resolved, usdPerHour: fargateUsdPerHour(resolved) };
  }

  async provision(req: ProvisionRequest): Promise<ComputeHandle> {
    const quoted = this.quote(req.backend, req.size);
    const resources = fargateResources(quoted.size);
    const region = req.backend.region?.trim();
    if (!region) throw new Error("Fargate workers need a region");
    const cluster = req.backend.cluster?.trim() || DEFAULT_FARGATE_CLUSTER;
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
      taskDefinition: req.backend.taskDefinition,
      launchType: "FARGATE",
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
        { key: "locus:ttl", value: "15m" },
      ],
    });
    const taskArn = taskArnFrom(run);
    if (!taskArn) {
      const reason = runFailureFrom(run);
      throw new Error(
        reason ? `Fargate RunTask failed: ${reason}` : "Fargate RunTask did not return a task ARN",
      );
    }
    this.registry.upsert({
      id: taskArn,
      backendId: req.backend.id,
      sessionId: req.sessionId,
    });
    this.creds.set(taskArn, {
      region,
      cluster,
      accessKeyId: req.backend.accessKeyId!.trim(),
      secret: req.backend.token!.trim(),
      ecsUrl: req.backend.ecsUrl?.trim() || undefined,
    });
    try {
      const ip = await this.waitForWorkerIp(req.backend, cluster, taskArn);
      const handle: ComputeHandle = {
        id: taskArn,
        url: `https://${ip}:7421`,
        token,
        size: quoted.size,
        ...(req.workerTls?.fingerprint ? { fingerprint: req.workerTls.fingerprint } : {}),
      };
      this.handles.set(handle.id, handle);
      this.registry.upsert({
        id: handle.id,
        backendId: req.backend.id,
        sessionId: req.sessionId,
        url: handle.url,
        token: handle.token,
        size: handle.size,
        fingerprint: handle.fingerprint,
      });
      return handle;
    } catch (err) {
      await this.destroy(taskArn, req.backend).catch(() => undefined);
      throw err;
    }
  }

  async destroy(id: string, backend?: WorkerBackend): Promise<void> {
    const stored = this.creds.get(id);
    const row = stored
      ? {
          id: "destroy",
          name: "destroy",
          url: "",
          kind: "fargate" as const,
          region: stored.region,
          cluster: stored.cluster,
          accessKeyId: stored.accessKeyId,
          token: stored.secret,
          ecsUrl: stored.ecsUrl,
        }
      : backend;
    if (row?.region && row.accessKeyId && row.token) {
      try {
        await this.ecs(row, "StopTask", {
          cluster: row.cluster?.trim() || DEFAULT_FARGATE_CLUSTER,
          task: id,
          reason: "locus destroy-on-stop",
        });
      } catch {
        /* already gone */
      }
    }
    this.handles.delete(id);
    this.creds.delete(id);
    this.registry.remove(id);
  }

  get(id: string): ComputeHandle | undefined {
    const live = this.handles.get(id);
    if (live) return live;
    const restored = handleFromRecord(this.registry.get(id) ?? { id: "", backendId: "" });
    if (!restored) return undefined;
    this.handles.set(id, restored);
    return restored;
  }

  async listOrphans(liveIds: Set<string>): Promise<ComputeOrphan[]> {
    const seen = new Set<string>();
    const out: ComputeOrphan[] = [];
    for (const row of this.registry.list()) {
      if (liveIds.has(row.id) || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ id: row.id, backendId: row.backendId });
    }
    for (const id of this.handles.keys()) {
      if (liveIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, backendId: this.registry.get(id)?.backendId ?? "" });
    }
    return out.filter((row) => row.backendId);
  }

  private async waitForWorkerIp(
    backend: WorkerBackend,
    cluster: string,
    taskArn: string,
  ): Promise<string> {
    for (let attempt = 0; attempt < DESCRIBE_ATTEMPTS; attempt += 1) {
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
    const res = await this.fetchFn(url, { method: "POST", headers, body: payload });
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
      if (name === "publicIPv4Address" && typeof value === "string" && value.trim()) return value;
      if (name === "privateIPv4Address" && typeof value === "string" && value.trim()) {
        privateIp = value;
      }
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
