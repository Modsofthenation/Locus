import {
  workerAllowedSizes,
  workerPickSize,
  workerSizeAllowed,
  type WorkerBackend,
} from "@locus/shared";
import { fargateUsdPerHour } from "./prices.js";
import { loadComputeTaskRegistry, handleFromRecord, type ComputeTaskRegistry } from "./registry.js";
import type {
  ComputeBackend,
  ComputeHandle,
  ComputeOrphan,
  CostQuote,
  ProvisionRequest,
} from "./types.js";

export class MockComputeBackend implements ComputeBackend {
  readonly provisions: ProvisionRequest[] = [];
  readonly destroyed: string[] = [];
  private handles = new Map<string, ComputeHandle>();
  private readonly registry: ComputeTaskRegistry;

  constructor(
    private readonly worker?: { url: string; token: string; fingerprint?: string },
    registryPath?: string,
  ) {
    this.registry = loadComputeTaskRegistry(registryPath);
    for (const row of this.registry.list()) {
      const handle = handleFromRecord(row);
      if (handle) this.handles.set(handle.id, handle);
    }
  }

  quote(backend: WorkerBackend, size: string): CostQuote {
    const resolved = workerPickSize(backend, size);
    if (!workerSizeAllowed(backend, resolved)) {
      throw new Error(`Size ${resolved} is not on the allowlist`);
    }
    if (!workerAllowedSizes(backend)?.length) {
      throw new Error(
        "Fargate workers need a size allowlist so a runaway agent cannot pick 4 vCPU",
      );
    }
    return { size: resolved, usdPerHour: fargateUsdPerHour(resolved) };
  }

  async provision(req: ProvisionRequest): Promise<ComputeHandle> {
    const quoted = this.quote(req.backend, req.size);
    if (!this.worker?.url) throw new Error("Mock Fargate needs a worker URL");
    this.provisions.push(req);
    const handle: ComputeHandle = {
      id: `arn:aws:ecs:us-east-1:123:task/locus/${this.provisions.length}`,
      url: this.worker.url,
      token: this.worker.token,
      fingerprint: this.worker.fingerprint,
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
      fingerprint: handle.fingerprint,
    });
    return handle;
  }

  async destroy(id: string, _backend?: WorkerBackend): Promise<void> {
    this.destroyed.push(id);
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
    for (const id of this.handles.keys()) {
      if (liveIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, backendId: this.registry.get(id)?.backendId ?? "" });
    }
    return out.filter((row) => row.backendId);
  }
}
