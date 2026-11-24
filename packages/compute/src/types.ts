import type { WorkerBackend } from "@locus/shared";

export interface CostQuote {
  size: string;
  usdPerHour: number;
  maxEstimatedUsd?: number;
  rateDate?: string;
}

export interface ComputeHandle {
  id: string;
  url: string;
  token: string;
  fingerprint?: string;
  requestedAt?: string;
  gateway?: { headers: Record<string, string>; deadlineAt: number };
  size: string;
}

export interface ComputeOrphan {
  id: string;
  backendId: string;
  sessionId?: string;
  cleanupPending?: boolean;
}

export interface ProvisionRequest {
  backend: WorkerBackend;
  sessionId: string;
  size: string;
  /**
   * TLS identity the control plane minted for this task. Fargate injects it so the
   * worker serves a cert whose fingerprint is pinned before the task starts (no TOFU).
   */
  workerTls?: { cert: string; key: string; fingerprint: string };
}

export interface ComputeBackend {
  verify?(backend: WorkerBackend): Promise<void>;
  quote(backend: WorkerBackend, size: string): CostQuote;
  provision(req: ProvisionRequest): Promise<ComputeHandle>;
  destroy(id: string, backend?: WorkerBackend): Promise<void>;
  get(id: string): ComputeHandle | undefined;
  listOrphans(liveIds: Set<string>): Promise<ComputeOrphan[]>;
}
