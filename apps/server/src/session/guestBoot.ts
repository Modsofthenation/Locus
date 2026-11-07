import type { AgentSession, VmInstance } from "@locus/shared";
import { isGuestReady, sessionRuntime } from "@locus/shared";
import type { WorkerClient } from "@locus/worker";
import type { Hub } from "../core/hub.js";
import type { JsonStore } from "../core/store.js";

export type GuestBootPorts = {
  require: (sessionId: string) => Promise<AgentSession>;
  get: (sessionId: string) => Promise<AgentSession | undefined>;
  sessionNeedsGuest: (session: AgentSession) => boolean;
  isWorkerHost: (session: AgentSession) => boolean;
  isWorkerSession: (session: { placement?: AgentSession["placement"] }) => boolean;
  runStartVm: (sessionId: string) => Promise<VmInstance>;
  ensureDocker: (sessionId: string) => Promise<VmInstance>;
  ensureWorkerHost: (sessionId: string) => Promise<VmInstance>;
  getMachine: (id: string) => VmInstance | undefined;
  workerClient: (backendId: string) => WorkerClient | undefined;
  onVmStatus: (id: string, status: string, error?: string) => Promise<void>;
  resumeIgnoredStartPrompt: (sessionId: string) => Promise<void>;
  bootTimeoutMs: () => Promise<number>;
  store: JsonStore;
  hub: Hub;
};

/**
 * Guest Machine start coordination: inflight dedupe, expected-boot tracking,
 * fire-and-forget Docker/worker boot, and Turn wait-until-ready.
 * ensure/start adapters stay on Session; this module owns the boot seam.
 */
export class GuestBoot {
  private guestBoots = new Map<string, Promise<VmInstance>>();
  private guestExpected = new Set<string>();

  constructor(private readonly ports: GuestBootPorts) {}

  clear(): void {
    this.guestBoots.clear();
    this.guestExpected.clear();
  }

  hasInflight(sessionId: string): boolean {
    return this.guestBoots.has(sessionId) || this.guestExpected.has(sessionId);
  }

  isExpected(sessionId: string): boolean {
    return this.guestExpected.has(sessionId);
  }

  dropExpected(sessionId: string): void {
    this.guestExpected.delete(sessionId);
  }

  async startVm(sessionId: string): Promise<VmInstance> {
    const existing = this.guestBoots.get(sessionId);
    if (existing) return existing;
    this.guestExpected.add(sessionId);
    const pending = this.ports
      .runStartVm(sessionId)
      .then((vm) => {
        if (isGuestReady(vm.status) || vm.status === "error" || vm.status === "stopped") {
          this.guestExpected.delete(sessionId);
        }
        if (isGuestReady(vm.status)) void this.ports.resumeIgnoredStartPrompt(sessionId);
        return vm;
      })
      .catch((err) => {
        this.guestExpected.delete(sessionId);
        throw err;
      })
      .finally(() => {
        if (this.guestBoots.get(sessionId) === pending) this.guestBoots.delete(sessionId);
      });
    this.guestBoots.set(sessionId, pending);
    return pending;
  }

  async bootGuest(sessionId: string, waitUntilStarted: boolean): Promise<void> {
    const session = await this.ports.require(sessionId);
    if (!this.ports.sessionNeedsGuest(session)) return;
    if (
      !waitUntilStarted &&
      (sessionRuntime(session) === "docker" || this.ports.isWorkerHost(session))
    ) {
      if (sessionRuntime(session) === "docker") await this.ports.ensureDocker(sessionId);
      else await this.ports.ensureWorkerHost(sessionId);
      void this.startVm(sessionId).catch((err) => void this.failBoot(sessionId, err));
      return;
    }
    await this.startVm(sessionId);
  }

  async startGuestIfNeeded(sessionId: string): Promise<void> {
    const session = await this.ports.get(sessionId);
    if (!session || !this.ports.sessionNeedsGuest(session)) return;
    const vm = session.vmId ? this.ports.getMachine(session.vmId) : undefined;
    if (isGuestReady(vm?.status)) return;
    try {
      await this.startVm(sessionId);
    } catch (err) {
      await this.failBoot(sessionId, err);
    }
  }

  async waitForGuestIfStarting(sessionId: string, abort: AbortController): Promise<void> {
    const session = await this.ports.get(sessionId);
    if (!session || !this.ports.sessionNeedsGuest(session)) return;
    const attached =
      Boolean(session.vmId) ||
      this.guestBoots.has(sessionId) ||
      this.guestExpected.has(sessionId) ||
      session.status === "provisioning";
    if (!attached) return;
    const timeoutMs = await this.ports.bootTimeoutMs();
    const deadline = Date.now() + timeoutMs;
    while (!abort.signal.aborted && Date.now() < deadline) {
      const current = await this.ports.get(sessionId);
      if (!current) return;
      if (this.ports.isWorkerSession(current) && current.backendId && current.vmId) {
        const client = this.ports.workerClient(current.backendId);
        if (client) {
          const before = this.ports.getMachine(current.vmId)?.status;
          const fresh = await client.refresh(current.vmId);
          if (fresh && fresh.status !== before) {
            await this.ports.onVmStatus(fresh.id, fresh.status, fresh.error);
          }
        }
      }
      const vm = current.vmId ? this.ports.getMachine(current.vmId) : undefined;
      if (isGuestReady(vm?.status)) return;
      const inflight = this.guestBoots.has(sessionId) || this.guestExpected.has(sessionId);
      if ((vm?.status === "error" || current.status === "error") && !inflight) return;
      if (vm?.status === "stopped" && !inflight) return;
      // `sendChat` patches status to "running" before this wait. Do not treat
      // that as "not starting" — Docker/QEMU `start()` often returns while the
      // guest is still creating/booting, and the live machine can lag `vmId`.
      // A leftover `creating` status after start() throws is not in-flight.
      const waiting =
        inflight ||
        vm?.status === "booting" ||
        vm?.status === "installing" ||
        current.status === "provisioning" ||
        Boolean(current.vmId && !vm);
      if (!waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (abort.signal.aborted) return;
    const timedOut = await this.ports.get(sessionId);
    const detail =
      timedOut?.error ||
      (timedOut?.vmId ? this.ports.getMachine(timedOut.vmId)?.error : undefined) ||
      `Guest did not become ready within ${Math.round(timeoutMs / 60_000)} minutes.`;
    await this.failBoot(sessionId, new Error(detail));
  }

  async failBoot(sessionId: string, err: unknown): Promise<void> {
    this.guestExpected.delete(sessionId);
    const message = err instanceof Error ? err.message : "Start failed";
    try {
      const updated = await this.ports.store.mutateSession(sessionId, (current) => {
        current.status = "error";
        current.error = message;
      });
      if (updated) this.ports.hub.broadcast({ type: "session.updated", session: updated });
    } catch {
      /* store may already be torn down */
    }
  }
}
