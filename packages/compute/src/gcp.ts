import { randomBytes } from "node:crypto";
import { workerAllowedSizes, workerPickSize, type WorkerBackend } from "@locus/shared";
import { fargateUsdPerHour } from "./prices.js";
import { handleFromRecord, loadComputeTaskRegistry, type ComputeTaskRegistry } from "./registry.js";
import type {
  ComputeBackend,
  ComputeHandle,
  ComputeOrphan,
  CostQuote,
  ProvisionRequest,
} from "./types.js";

const DESCRIBE_ATTEMPTS = 8;

export class GcpComputeBackend implements ComputeBackend {
  private handles = new Map<string, ComputeHandle>();
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
      throw new Error("GCP workers need a size allowlist so a runaway agent cannot pick 4 vCPU");
    }
    return { size: resolved, usdPerHour: fargateUsdPerHour(resolved) };
  }

  async provision(req: ProvisionRequest): Promise<ComputeHandle> {
    const quoted = this.quote(req.backend, req.size);
    const token = randomWorkerToken();
    const project = req.backend.project?.trim();
    const zone = req.backend.zone?.trim();
    const template = req.backend.instanceTemplate?.trim();
    const access = req.backend.token?.trim();
    if (!project || !zone || !template || !access) {
      throw new Error("GCP workers need a project, zone, instance template, and access token");
    }
    const name = `locus-${req.sessionId.replace(/[^a-z0-9]/gi, "").slice(0, 20) || "worker"}`;
    const id = `projects/${project}/zones/${zone}/instances/${name}`;
    this.registry.upsert({ id, backendId: req.backend.id, sessionId: req.sessionId });
    const created = await this.compute<Record<string, unknown>>(
      req.backend,
      "POST",
      `/compute/v1/projects/${project}/zones/${zone}/instances?sourceInstanceTemplate=${encodeURIComponent(template)}`,
      {
        name,
        metadata: {
          items: [{ key: "locus-worker-token", value: token }],
        },
        labels: { "locus-managed": "true", "locus-session": req.sessionId.slice(0, 63) },
      },
    );
    const instanceName = instanceNameFrom(created) || name;
    const liveId = `projects/${project}/zones/${zone}/instances/${instanceName}`;
    try {
      const ip = await this.waitForIp(req.backend, liveId);
      const handle: ComputeHandle = {
        id: liveId,
        url: `https://${ip}:7421`,
        token,
        size: quoted.size,
      };
      this.handles.set(handle.id, handle);
      this.registry.upsert({
        id: handle.id,
        backendId: req.backend.id,
        sessionId: req.sessionId,
        url: handle.url,
        token: handle.token,
        size: handle.size,
      });
      return handle;
    } catch (err) {
      await this.destroy(liveId, req.backend).catch(() => undefined);
      throw err;
    }
  }

  async destroy(id: string, backend?: WorkerBackend): Promise<void> {
    if (backend) {
      try {
        await this.compute(backend, "DELETE", `/compute/v1/${id}`);
      } catch {
        /* already gone */
      }
    }
    this.handles.delete(id);
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
    const out: ComputeOrphan[] = [];
    const seen = new Set<string>();
    for (const row of this.registry.list()) {
      if (liveIds.has(row.id) || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ id: row.id, backendId: row.backendId });
    }
    return out.filter((row) => row.backendId);
  }

  private async waitForIp(backend: WorkerBackend, id: string): Promise<string> {
    for (let attempt = 0; attempt < DESCRIBE_ATTEMPTS; attempt += 1) {
      if (attempt) await this.wait(1_000);
      const described = await this.compute<Record<string, unknown>>(
        backend,
        "GET",
        `/compute/v1/${id}`,
      );
      const ip = natIpFrom(described);
      if (ip) return ip;
    }
    throw new Error("GCP instance did not get a public IP");
  }

  private async compute<T>(
    backend: WorkerBackend,
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const access = backend.token?.trim();
    if (!access) throw new Error("GCP workers need an access token");
    const base = (backend.gcpUrl?.trim() || "https://compute.googleapis.com").replace(/\/+$/, "");
    const url = path.startsWith("http")
      ? path
      : `${base}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await this.fetchFn(url, {
      method,
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
      },
      body: body && method !== "GET" && method !== "DELETE" ? JSON.stringify(body) : undefined,
    });
    if (method === "DELETE" && (res.status === 204 || res.status === 404)) return {} as T;
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) {
      throw new Error(json.error?.message || `GCP compute ${method} failed (${res.status})`);
    }
    return json;
  }
}

function randomWorkerToken(): string {
  return randomBytes(24).toString("hex");
}

function instanceNameFrom(row: Record<string, unknown>): string | undefined {
  if (typeof row.name === "string" && row.name.trim()) return row.name.trim();
  const target = typeof row.targetLink === "string" ? row.targetLink : "";
  const match = /instances\/([^/]+)$/.exec(target);
  return match?.[1];
}

function natIpFrom(row: Record<string, unknown>): string | undefined {
  const nics = row.networkInterfaces as
    | Array<{
        accessConfigs?: Array<{ natIP?: string }>;
      }>
    | undefined;
  return nics?.[0]?.accessConfigs?.[0]?.natIP?.trim() || undefined;
}
