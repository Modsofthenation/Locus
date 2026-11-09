import { awsEndpointUrlError } from "../awsEndpoint.js";
import { invalidHttpUrl, isLoopbackHost } from "../security.js";
import { parseDockerImage } from "./vm.js";
import { DEFAULT_WORKER_PORT } from "./placement.js";
import { parseWorkerAllowedSizes } from "./fargate.js";

export type WorkerKind = "lan" | "cloud" | "fargate" | "azure" | "gcp";

export const WORKER_KINDS: WorkerKind[] = ["lan", "cloud", "fargate", "azure", "gcp"];
export const DEFAULT_WORKER_IDLE_TTL_MS = 15 * 60 * 1000;

/** A LAN box, paste-URL cloud VM, or a provisioned Fargate / Azure / GCP worker. */
export interface WorkerBackend {
  id: string;
  name: string;
  /** Required for LAN/cloud. Provisioned kinds fill this after create. */
  url: string;
  /** Vaulted. Worker token, Fargate secret, Azure client secret, or GCP access token. */
  token?: string;
  /** SHA-256 of the worker TLS cert (`sha256:` + hex). Not a secret. */
  fingerprint?: string;
  /** Default `lan`. Cloud VMs and provisioned kinds get idle TTL + concurrent cap. */
  kind?: WorkerKind;
  /** Destroy the Docker guest on Stop. Default true. */
  destroyOnStop?: boolean;
  /** Idle guest TTL in ms. `0` disables (LAN only). Default 15 minutes. */
  idleTtlMs?: number;
  /** Max live guests. Cloud/Fargate default to 1. LAN unlimited when omitted. */
  maxConcurrent?: number;
  /** Operator-entered VM hourly rate. Cloud requires a positive value. */
  hourlyUsd?: number;
  /** Docker images this worker may run. Cloud/Fargate: empty cannot create. LAN omitted = any. */
  allowedImages?: string[];
  /** Fargate vCPU-GB pairs. Empty cannot provision. */
  allowedSizes?: string[];
  /** AWS region for Fargate, Azure location, or GCP region. */
  region?: string;
  /** ECS cluster. Default `locus`. */
  cluster?: string;
  /** Existing task definition that runs `locus-worker`. */
  taskDefinition?: string;
  /** Optional subnet for `awsvpc`. Locus does not create VPCs. */
  subnet?: string;
  /** AWS access key id (secret key is `token`). */
  accessKeyId?: string;
  /** Optional ECS endpoint (PrivateLink or API Gateway). Empty uses `ecs.{region}.amazonaws.com`. */
  ecsUrl?: string;
  /** Azure AD tenant id. */
  tenantId?: string;
  /** Azure AD application (client) id. */
  clientId?: string;
  /** Azure subscription id. */
  subscriptionId?: string;
  /** Azure resource group. */
  resourceGroup?: string;
  /** Existing Azure Container Instances group name. */
  containerGroup?: string;
  /** Optional ARM endpoint (PrivateLink). Empty uses `management.azure.com`. */
  armUrl?: string;
  /** GCP project id. */
  project?: string;
  /** GCP zone (for example `us-central1-a`). */
  zone?: string;
  /** Existing Compute Engine instance template that already runs locus-worker. */
  instanceTemplate?: string;
  /** Optional Compute Engine endpoint. Empty uses `compute.googleapis.com`. */
  gcpUrl?: string;
}

export function parseWorkerBackends(raw: unknown): WorkerBackend[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkerBackend[] = [];
  for (const row of raw) {
    const parsed = parseWorkerBackend(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseWorkerBackend(raw: unknown): WorkerBackend | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const kind = parseWorkerKind(value.kind);
  const url = normalizeWorkerUrl(typeof value.url === "string" ? value.url : "") ?? "";
  if (!id || !name) return undefined;
  if (!workerProvisionsCompute({ kind }) && !url) return undefined;
  const token =
    typeof value.token === "string" && value.token.trim() ? value.token.trim() : undefined;
  const fingerprint = parseWorkerFingerprint(
    typeof value.fingerprint === "string" ? value.fingerprint : undefined,
  );
  const destroyOnStop = value.destroyOnStop === false ? false : undefined;
  const idleTtlMs =
    typeof value.idleTtlMs === "number" && Number.isFinite(value.idleTtlMs)
      ? Math.max(0, Math.floor(value.idleTtlMs))
      : undefined;
  const maxConcurrent =
    typeof value.maxConcurrent === "number" && Number.isFinite(value.maxConcurrent)
      ? Math.floor(value.maxConcurrent)
      : undefined;
  const hourlyUsd =
    typeof value.hourlyUsd === "number" && Number.isFinite(value.hourlyUsd)
      ? value.hourlyUsd
      : undefined;
  const allowedImages = Array.isArray(value.allowedImages)
    ? parseWorkerAllowedImages(value.allowedImages)
    : undefined;
  const allowedSizes = Array.isArray(value.allowedSizes)
    ? parseWorkerAllowedSizes(value.allowedSizes)
    : undefined;
  const region =
    typeof value.region === "string" && value.region.trim() ? value.region.trim() : undefined;
  const cluster =
    typeof value.cluster === "string" && value.cluster.trim() ? value.cluster.trim() : undefined;
  const taskDefinition =
    typeof value.taskDefinition === "string" && value.taskDefinition.trim()
      ? value.taskDefinition.trim()
      : undefined;
  const subnet =
    typeof value.subnet === "string" && value.subnet.trim() ? value.subnet.trim() : undefined;
  const accessKeyId =
    typeof value.accessKeyId === "string" && value.accessKeyId.trim()
      ? value.accessKeyId.trim()
      : undefined;
  const ecsUrl =
    typeof value.ecsUrl === "string" && value.ecsUrl.trim() ? value.ecsUrl.trim() : undefined;
  const optional = (key: string): string | undefined => {
    const raw = value[key];
    return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
  };
  return {
    id,
    name,
    url,
    token,
    fingerprint,
    ...(kind ? { kind } : {}),
    ...(destroyOnStop === false ? { destroyOnStop: false } : {}),
    ...(idleTtlMs !== undefined ? { idleTtlMs } : {}),
    ...(maxConcurrent !== undefined ? { maxConcurrent } : {}),
    ...(hourlyUsd !== undefined ? { hourlyUsd } : {}),
    ...(allowedImages !== undefined ? { allowedImages } : {}),
    ...(allowedSizes !== undefined ? { allowedSizes } : {}),
    ...(region ? { region } : {}),
    ...(cluster ? { cluster } : {}),
    ...(taskDefinition ? { taskDefinition } : {}),
    ...(subnet ? { subnet } : {}),
    ...(accessKeyId ? { accessKeyId } : {}),
    ...(ecsUrl ? { ecsUrl } : {}),
    ...(optional("tenantId") ? { tenantId: optional("tenantId") } : {}),
    ...(optional("clientId") ? { clientId: optional("clientId") } : {}),
    ...(optional("subscriptionId") ? { subscriptionId: optional("subscriptionId") } : {}),
    ...(optional("resourceGroup") ? { resourceGroup: optional("resourceGroup") } : {}),
    ...(optional("containerGroup") ? { containerGroup: optional("containerGroup") } : {}),
    ...(optional("armUrl") ? { armUrl: optional("armUrl") } : {}),
    ...(optional("project") ? { project: optional("project") } : {}),
    ...(optional("zone") ? { zone: optional("zone") } : {}),
    ...(optional("instanceTemplate") ? { instanceTemplate: optional("instanceTemplate") } : {}),
    ...(optional("gcpUrl") ? { gcpUrl: optional("gcpUrl") } : {}),
  };
}

export function parseWorkerAllowedImages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (typeof row !== "string") continue;
    const image = parseDockerImage(row);
    if (!image || seen.has(image)) continue;
    seen.add(image);
    out.push(image);
  }
  return out;
}

export function normalizeWorkerUrl(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const error = invalidHttpUrl(withScheme, "Worker URL");
  if (error) return undefined;
  try {
    const parsed = new URL(withScheme);
    if (!parsed.port) parsed.port = String(DEFAULT_WORKER_PORT);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export function parseWorkerFingerprint(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().toLowerCase().replace(/:/g, "") ?? "";
  if (!trimmed) return undefined;
  const hex = trimmed.startsWith("sha256") ? trimmed.replace(/^sha256[-]?/, "") : trimmed;
  if (!/^[0-9a-f]{64}$/.test(hex)) return undefined;
  return `sha256:${hex}`;
}

export function parseWorkerKind(raw: unknown): WorkerKind | undefined {
  if (raw === "fargate" || raw === "cloud" || raw === "azure" || raw === "gcp") return raw;
  return undefined;
}

export function workerKind(backend: { kind?: WorkerKind }): WorkerKind {
  return parseWorkerKind(backend.kind) ?? "lan";
}

/** Cloud VM (paste URL) or a provisioned Fargate / Azure / GCP worker. */
export function workerIsMetered(backend: { kind?: WorkerKind }): boolean {
  const kind = workerKind(backend);
  return kind === "cloud" || workerProvisionsCompute(backend);
}

/** Fargate, Azure, and GCP: Locus starts a worker VM, then talks to it over HTTPS. */
export function workerProvisionsCompute(backend: { kind?: WorkerKind }): boolean {
  const kind = workerKind(backend);
  return kind === "fargate" || kind === "azure" || kind === "gcp";
}

export function workerDestroyOnStop(backend: { destroyOnStop?: boolean }): boolean {
  return backend.destroyOnStop !== false;
}

export function workerIdleTtlMs(backend: { kind?: WorkerKind; idleTtlMs?: number }): number {
  if (typeof backend.idleTtlMs === "number" && backend.idleTtlMs >= 0) {
    if (workerIsMetered(backend) && backend.idleTtlMs === 0) return DEFAULT_WORKER_IDLE_TTL_MS;
    return backend.idleTtlMs;
  }
  return DEFAULT_WORKER_IDLE_TTL_MS;
}

export function workerMaxConcurrent(backend: {
  kind?: WorkerKind;
  maxConcurrent?: number;
}): number | undefined {
  if (typeof backend.maxConcurrent === "number" && backend.maxConcurrent > 0) {
    return backend.maxConcurrent;
  }
  return workerIsMetered(backend) ? 1 : undefined;
}

export function workerWhereLabel(backend: WorkerBackend): string {
  const kind = workerKind(backend);
  if (kind === "fargate") return `${backend.name} · fargate`;
  if (kind === "azure") return `${backend.name} · azure`;
  if (kind === "gcp") return `${backend.name} · gcp`;
  if (kind === "cloud") return `${backend.name} · cloud`;
  return backend.name;
}

export function workerHourlyUsd(backend: { hourlyUsd?: number }): number | undefined {
  if (
    typeof backend.hourlyUsd === "number" &&
    Number.isFinite(backend.hourlyUsd) &&
    backend.hourlyUsd > 0
  ) {
    return backend.hourlyUsd;
  }
  return undefined;
}

export function sessionComputeMs(
  session: { computeMs?: number; computeStartedAt?: string },
  now = Date.now(),
): number {
  let ms = Math.max(0, session.computeMs ?? 0);
  if (session.computeStartedAt) {
    const start = Date.parse(session.computeStartedAt);
    if (Number.isFinite(start) && now > start) ms += now - start;
  }
  return ms;
}

export function computeUsdForMs(ms: number, hourlyUsd?: number): number {
  if (!hourlyUsd || hourlyUsd <= 0 || ms <= 0) return 0;
  return (ms / 3_600_000) * hourlyUsd;
}

export function workerComputeUsd(
  session: { computeMs?: number; computeStartedAt?: string; quotedUsdPerHour?: number },
  backend: { hourlyUsd?: number } | undefined,
  now = Date.now(),
): number {
  const quoted =
    typeof session.quotedUsdPerHour === "number" && session.quotedUsdPerHour > 0
      ? session.quotedUsdPerHour
      : undefined;
  return computeUsdForMs(sessionComputeMs(session, now), quoted ?? workerHourlyUsd(backend ?? {}));
}

/** `undefined` = any image (LAN default). `[]` = none (cloud/Fargate default). */
export function workerAllowedImages(backend: {
  kind?: WorkerKind;
  allowedImages?: string[];
}): string[] | undefined {
  if (backend.allowedImages !== undefined) return backend.allowedImages;
  return workerIsMetered(backend) ? [] : undefined;
}

export function workerAllowedSizes(backend: {
  kind?: WorkerKind;
  allowedSizes?: string[];
}): string[] | undefined {
  if (backend.allowedSizes !== undefined) return backend.allowedSizes;
  return workerProvisionsCompute(backend) ? [] : undefined;
}

export function workerSizeAllowed(
  backend: { kind?: WorkerKind; allowedSizes?: string[] },
  size: string,
): boolean {
  const list = workerAllowedSizes(backend);
  if (list === undefined) return true;
  return list.includes(size);
}

export function workerPickSize(
  backend: { kind?: WorkerKind; allowedSizes?: string[] },
  requested?: string,
): string {
  const list = workerAllowedSizes(backend) ?? [];
  if (!list.length) {
    throw new Error(
      "Provisioned workers need a size allowlist so a runaway agent cannot pick 4 vCPU",
    );
  }
  if (requested) {
    if (!list.includes(requested)) throw new Error(`Size ${requested} is not on the allowlist`);
    return requested;
  }
  return list[0]!;
}

export function workerImageAllowed(
  backend: { kind?: WorkerKind; allowedImages?: string[] },
  image: string,
): boolean {
  const list = workerAllowedImages(backend);
  if (list === undefined) return true;
  const canonical = parseDockerImage(image);
  if (!canonical) return false;
  return list.some((row) => parseDockerImage(row) === canonical);
}

export function workerBackendError(backend: WorkerBackend): string | undefined {
  if (!backend.name.trim()) return "Worker name is required";
  const kind = workerKind(backend);
  if (!workerProvisionsCompute(backend)) {
    const url = normalizeWorkerUrl(backend.url);
    if (!url) return "Worker URL must be http or https";
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
        return "Worker URL must be https";
      }
    } catch {
      return "Worker URL must be http or https";
    }
  }
  if (typeof backend.maxConcurrent === "number" && backend.maxConcurrent < 1) {
    return "Max concurrent guests must be at least 1";
  }
  if (workerIsMetered(backend) && backend.idleTtlMs === 0) {
    return "Cloud workers need an idle TTL so guests cannot sit on a metered VM";
  }
  if (typeof backend.hourlyUsd === "number" && !(backend.hourlyUsd > 0)) {
    return "Hourly USD must be greater than 0";
  }
  if (kind === "cloud" && workerHourlyUsd(backend) == null) {
    return "Cloud workers need an hourly USD rate so the spend cap can meter VM time";
  }
  if (workerIsMetered(backend) && !workerAllowedImages(backend)?.length) {
    return "Cloud workers need an image allowlist so a runaway agent cannot pull arbitrary images";
  }
  if (kind === "fargate" && !backend.region?.trim()) {
    return "Fargate workers need a region";
  }
  if (kind === "fargate" && !backend.taskDefinition?.trim()) {
    return "Fargate workers need a task definition that already runs locus-worker";
  }
  if (kind === "fargate" && !backend.accessKeyId?.trim()) {
    return "Fargate workers need an AWS access key";
  }
  if (kind === "fargate" && !workerAllowedSizes(backend)?.length) {
    return "Fargate workers need a size allowlist so a runaway agent cannot pick 4 vCPU";
  }
  if (kind === "azure") {
    if (!backend.tenantId?.trim()) return "Azure workers need a tenant id";
    if (!backend.clientId?.trim()) return "Azure workers need a client id";
    if (!backend.subscriptionId?.trim()) return "Azure workers need a subscription id";
    if (!backend.resourceGroup?.trim()) return "Azure workers need a resource group";
    if (!backend.containerGroup?.trim()) return "Azure workers need a container group name";
    if (!backend.region?.trim()) return "Azure workers need a region";
    if (!workerAllowedSizes(backend)?.length) {
      return "Azure workers need a size allowlist so a runaway agent cannot pick 4 vCPU";
    }
  }
  if (kind === "gcp") {
    if (!backend.project?.trim()) return "GCP workers need a project id";
    if (!backend.zone?.trim()) return "GCP workers need a zone";
    if (!backend.instanceTemplate?.trim()) {
      return "GCP workers need an instance template that already runs locus-worker";
    }
    if (!workerAllowedSizes(backend)?.length) {
      return "GCP workers need a size allowlist so a runaway agent cannot pick 4 vCPU";
    }
  }
  const ecsError =
    kind === "fargate" ? awsEndpointUrlError(backend.ecsUrl, "ECS endpoint") : undefined;
  if (ecsError) return ecsError;
  return undefined;
}

export interface WorkerHealth {
  ok: true;
  service: "locus-worker";
  protocol: number;
  name?: string;
  hostname?: string;
  docker?: "mock" | "docker";
  fingerprint?: string;
}

export function isWorkerHealth(value: unknown): value is WorkerHealth {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.ok === true && row.service === "locus-worker";
}
