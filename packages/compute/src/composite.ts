import { workerKind, type WorkerBackend } from "@locus/shared";
import type {
  ComputeBackend,
  ComputeHandle,
  ComputeOrphan,
  CostQuote,
  ProvisionRequest,
} from "./types.js";

export class CompositeComputeBackend implements ComputeBackend {
  constructor(
    private readonly fargate: ComputeBackend,
    private readonly azure: ComputeBackend,
    private readonly gcp: ComputeBackend,
  ) {}

  private forBackend(backend: WorkerBackend): ComputeBackend {
    const kind = workerKind(backend);
    if (kind === "azure") return this.azure;
    if (kind === "gcp") return this.gcp;
    return this.fargate;
  }

  quote(backend: WorkerBackend, size: string): CostQuote {
    return this.forBackend(backend).quote(backend, size);
  }

  provision(req: ProvisionRequest): Promise<ComputeHandle> {
    return this.forBackend(req.backend).provision(req);
  }

  destroy(id: string, backend?: WorkerBackend): Promise<void> {
    if (backend) return this.forBackend(backend).destroy(id, backend);
    return Promise.all([
      this.fargate.destroy(id),
      this.azure.destroy(id),
      this.gcp.destroy(id),
    ]).then(() => undefined);
  }

  get(id: string): ComputeHandle | undefined {
    return this.fargate.get(id) ?? this.azure.get(id) ?? this.gcp.get(id);
  }

  async listOrphans(liveIds: Set<string>): Promise<ComputeOrphan[]> {
    const rows = await Promise.all([
      this.fargate.listOrphans(liveIds),
      this.azure.listOrphans(liveIds),
      this.gcp.listOrphans(liveIds),
    ]);
    const seen = new Set<string>();
    const out: ComputeOrphan[] = [];
    for (const row of rows.flat()) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
    return out;
  }
}
