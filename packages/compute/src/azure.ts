import { randomBytes } from "node:crypto";
import { fargateResources, fargateUsdPerHour } from "./prices.js";
import { handleFromRecord, loadComputeTaskRegistry, type ComputeTaskRegistry } from "./registry.js";
import type {
  ComputeBackend,
  ComputeHandle,
  ComputeOrphan,
  CostQuote,
  ProvisionRequest,
} from "./types.js";
import { workerAllowedSizes, workerPickSize, type WorkerBackend } from "@locus/shared";

const DESCRIBE_ATTEMPTS = 8;

export class AzureComputeBackend implements ComputeBackend {
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
      throw new Error("Azure workers need a size allowlist so a runaway agent cannot pick 4 vCPU");
    }
    return { size: resolved, usdPerHour: fargateUsdPerHour(resolved) };
  }

  async provision(req: ProvisionRequest): Promise<ComputeHandle> {
    const quoted = this.quote(req.backend, req.size);
    const resources = fargateResources(quoted.size);
    const token = randomWorkerToken();
    const access = await this.accessToken(req.backend);
    const name = req.backend.containerGroup?.trim();
    if (!name) throw new Error("Azure workers need a container group name");
    const subscription = req.backend.subscriptionId?.trim();
    const resourceGroup = req.backend.resourceGroup?.trim();
    const region = req.backend.region?.trim();
    const image = req.backend.allowedImages?.[0]?.trim();
    if (!subscription || !resourceGroup || !region || !image) {
      throw new Error("Azure workers need subscription, resource group, region, and an image");
    }
    const id = `/subscriptions/${subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerInstance/containerGroups/${name}`;
    this.registry.upsert({ id, backendId: req.backend.id, sessionId: req.sessionId });
    await this.arm(req.backend, access, "PUT", `${id}?api-version=2023-05-01`, {
      location: region,
      properties: {
        osType: "Linux",
        restartPolicy: "Never",
        ipAddress: { type: "Public", ports: [{ protocol: "TCP", port: 7421 }] },
        containers: [
          {
            name: "worker",
            properties: {
              image,
              ports: [{ port: 7421 }],
              environmentVariables: [{ name: "LOCUS_WORKER_TOKEN", value: token }],
              resources: {
                requests: {
                  cpu: Number(resources.cpu) / 1024,
                  memoryInGB: Number(resources.memory) / 1024,
                },
              },
            },
          },
        ],
      },
      tags: { "locus:managed": "true", "locus:session": req.sessionId },
    });
    try {
      const ip = await this.waitForIp(req.backend, access, id);
      const handle: ComputeHandle = {
        id,
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
      await this.destroy(id, req.backend).catch(() => undefined);
      throw err;
    }
  }

  async destroy(id: string, backend?: WorkerBackend): Promise<void> {
    if (backend) {
      try {
        const access = await this.accessToken(backend);
        await this.arm(backend, access, "DELETE", `${id}?api-version=2023-05-01`);
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
    const seen = new Set<string>();
    const out: ComputeOrphan[] = [];
    for (const row of this.registry.list()) {
      if (liveIds.has(row.id) || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ id: row.id, backendId: row.backendId });
    }
    return out.filter((row) => row.backendId);
  }

  private async waitForIp(backend: WorkerBackend, access: string, id: string): Promise<string> {
    for (let attempt = 0; attempt < DESCRIBE_ATTEMPTS; attempt += 1) {
      if (attempt) await this.wait(1_000);
      const described = await this.arm<Record<string, unknown>>(
        backend,
        access,
        "GET",
        `${id}?api-version=2023-05-01`,
      );
      const ip = ipFromAci(described);
      if (ip) return ip;
    }
    throw new Error("Azure container group did not get a public IP");
  }

  private async accessToken(backend: WorkerBackend): Promise<string> {
    const tenant = backend.tenantId?.trim();
    const clientId = backend.clientId?.trim();
    const secret = backend.token?.trim();
    if (!tenant || !clientId || !secret) {
      throw new Error("Azure workers need a tenant, client id, and client secret");
    }
    const url = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: secret,
      scope: "https://management.azure.com/.default",
    });
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string };
    if (!res.ok || !json.access_token) throw new Error("Azure token request failed");
    return json.access_token;
  }

  private async arm<T>(
    backend: WorkerBackend,
    access: string,
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const base = (backend.armUrl?.trim() || "https://management.azure.com").replace(/\/+$/, "");
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
      throw new Error(json.error?.message || `Azure ARM ${method} failed (${res.status})`);
    }
    return json;
  }
}

function randomWorkerToken(): string {
  return randomBytes(24).toString("hex");
}

function ipFromAci(row: Record<string, unknown>): string | undefined {
  const properties = row.properties as { ipAddress?: { ip?: string } } | undefined;
  const ip = properties?.ipAddress?.ip?.trim();
  return ip || undefined;
}
