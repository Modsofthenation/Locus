/**
 * Machine lifecycle for an Agent's Guest: create, start, stop, pause and resume
 * a local Docker container or QEMU VM, a worker-placed Docker/VM guest (with
 * its Fargate compute handle), or a worker Host workspace, and open/close the
 * guest's Boot steps list for local starts. `GuestBoot` owns inflight dedupe and
 * Turn wait-until-ready and calls into `runStartVm` / `ensureDocker` /
 * `ensureWorkerHost` here.
 */
import { mkdir } from "node:fs/promises";
import type { AgentSession, GitForgeAccount, VmInstance, WorkerBackend } from "@locus/shared";
import {
  bootHistoryKey,
  defaultNetworkJail,
  forgeProviderAllowlist,
  imageRuntime,
  isCanvasSession,
  isGuestReady,
  jailNetworking,
  parseDockerImage,
  runtimeNeedsGuest,
  sessionComputeMs,
  sessionRuntime,
  workerDestroyOnStop,
  workerImageAllowed,
  workerMaxConcurrent,
  workerPickSize,
  workerProvisionsCompute,
  workerRunsInTask,
} from "@locus/shared";
import type { DockerEngine, Hypervisor } from "@locus/hypervisor";
import { createSelfSignedWorkerTls, WorkerClient } from "@locus/worker";
import type { ComputeBackend } from "@locus/compute";
import type { Hub } from "../core/hub.js";
import type { JsonStore } from "../core/store.js";
import { redactVm } from "../core/redact.js";
import { withFreshForgeToken } from "../git/forgeOauth.js";
import { loadWorkspaceEnvironment } from "../workspace/workspaceMeta.js";
import type { BootTracker } from "./bootSteps.js";

export type MachineLifecyclePorts = {
  require: (sessionId: string) => Promise<AgentSession>;
  get: (sessionId: string) => Promise<AgentSession | undefined>;
  list: () => Promise<AgentSession[]>;
  patch: (
    sessionId: string,
    patch: Partial<
      Pick<
        AgentSession,
        | "status"
        | "vmId"
        | "error"
        | "computeMs"
        | "computeStartedAt"
        | "quotedUsdPerHour"
        | "remoteGuestId"
        | "instanceSize"
      >
    >,
  ) => Promise<AgentSession>;
  persistVm: (vm: VmInstance) => Promise<void>;
  getMachine: (id: string) => VmInstance | undefined;
  onVmStatus: (id: string, status: string, error?: string) => Promise<void>;
  isWorkerSession: (session: { placement?: AgentSession["placement"] }) => boolean;
  isWorkerHost: (session: AgentSession) => boolean;
  requireWorker: (session: AgentSession) => Promise<WorkerClient>;
  attachWorkerGuest: (session: AgentSession, client: WorkerClient, vm: VmInstance) => void;
  destroyWorkerGuest: (session: AgentSession) => Promise<void>;
  engine: (session: AgentSession) => Hypervisor | DockerEngine;
  installGuestGitAuth: (vm: VmInstance) => Promise<void>;
  keepGuestOrDestroy: (
    sessionId: string,
    vmId: string,
    engine: { get(id: string): unknown; destroy(id: string): Promise<void> },
  ) => Promise<void>;
  applyWorkspaceEnvironment: (sessionId: string, vm: VmInstance) => Promise<void>;
  landStudioWorkspace: (sessionId: string) => Promise<void>;
  sessionForge: (
    config: { forges: GitForgeAccount[] },
    session: AgentSession,
  ) => GitForgeAccount | undefined;
  ensureProxy: (sessionId: string) => Promise<{ port: number }>;
  closeProxy: (sessionId: string) => void;
  closeIdeTunnel: (sessionId: string) => void;
  /** Read on each call: `setHypervisor` swaps it and tests swap `fetchFn`. */
  hypervisor: () => Hypervisor;
  docker: () => DockerEngine;
  fetchFn: () => typeof fetch;
  compute: ComputeBackend;
  workers: Pick<Map<string, WorkerClient>, "set">;
  boots: Pick<BootTracker, "begin" | "fail" | "isRunning" | "finish" | "step">;
  /** How long a freshly provisioned compute worker may take to answer `/v1/info`. */
  computeReadyTimeoutMs: () => number;
  /** Shared with the clone and workspace-setup paths that stay on Session. */
  cloned: ReadonlySet<string>;
  cloneInflight: Pick<ReadonlyMap<string, unknown>, "has">;
  envApplied: ReadonlySet<string>;
  bootSetupPending: Set<string>;
  store: JsonStore;
  hub: Hub;
};

function now(): string {
  return new Date().toISOString();
}

export class MachineLifecycle {
  constructor(private readonly ports: MachineLifecyclePorts) {}

  private get hypervisor(): Hypervisor {
    return this.ports.hypervisor();
  }

  private get docker(): DockerEngine {
    return this.ports.docker();
  }

  private get fetchFn(): typeof fetch {
    return this.ports.fetchFn();
  }

  async runStartVm(sessionId: string): Promise<VmInstance> {
    const session = await this.ports.require(sessionId);
    if (this.ports.isWorkerHost(session)) {
      const cloud = await this.beginCloudBootSteps(session);
      try {
        const vm = await this.startWorkerHost(sessionId);
        if (cloud) await this.maybeFinishBootSteps(sessionId);
        return vm;
      } catch (err) {
        if (cloud) {
          this.ports.boots.fail(sessionId, err instanceof Error ? err.message : "Start failed");
        }
        throw err;
      }
    }
    if (!runtimeNeedsGuest(sessionRuntime(session))) {
      throw new Error("Host agents do not have a VM or container.");
    }
    if (!this.ports.isWorkerSession(session)) await this.beginGuestBootSteps(session);
    try {
      if (sessionRuntime(session) === "docker") return await this.startDocker(sessionId);
      if (this.ports.isWorkerSession(session)) return await this.startWorkerVm(sessionId);
      return await this.startQemuVm(sessionId);
    } catch (err) {
      this.ports.boots.fail(sessionId, err instanceof Error ? err.message : "Start failed");
      throw err;
    }
  }

  /**
   * Provisioned compute (Fargate task): Start cloud task → Connect agent → Ready, so a cold
   * task start reads like any other guest boot instead of a silent spinner.
   */
  private async beginCloudBootSteps(session: AgentSession): Promise<boolean> {
    if (!session.backendId) return false;
    const backend = (await this.ports.store.loadConfig()).workers?.find(
      (row) => row.id === session.backendId,
    );
    if (!backend || !workerProvisionsCompute(backend)) return false;
    if (session.remoteGuestId && this.ports.compute.get(session.remoteGuestId) && session.vmId) {
      return false;
    }
    await this.ports.boots.begin(session.id, {
      kind: "cloud",
      key: bootHistoryKey("cloud", `${backend.id}:${session.instanceSize ?? ""}`),
      repo: Boolean(session.repo?.url) && !this.ports.cloned.has(session.id),
    });
    return true;
  }

  /** Local Docker/QEMU only: worker adapters do not report steps. */
  private async beginGuestBootSteps(session: AgentSession): Promise<void> {
    const vm = session.vmId ? this.ports.getMachine(session.vmId) : undefined;
    if (isGuestReady(vm?.status) || vm?.status === "booting" || vm?.status === "installing") return;
    const docker = sessionRuntime(session) === "docker";
    await this.ports.boots.begin(session.id, {
      kind: docker ? "docker" : "vm",
      key: docker
        ? bootHistoryKey("docker", session.dockerImage)
        : bootHistoryKey("vm", session.imageId ?? session.templateId),
      repo: Boolean(session.repo?.url) && !this.ports.cloned.has(session.id),
    });
  }

  /**
   * Ready once the guest is running and no clone or workspace setup is still owed.
   * Called from each of those paths so whichever ends last closes the list.
   */
  async maybeFinishBootSteps(sessionId: string): Promise<void> {
    if (!this.ports.boots.isRunning(sessionId)) return;
    if (this.ports.bootSetupPending.has(sessionId) || this.ports.envApplied.has(sessionId)) return;
    if (this.ports.cloneInflight.has(sessionId)) return;
    const session = await this.ports.get(sessionId);
    if (!session) return;
    if (session.repo?.url && !this.ports.cloned.has(sessionId)) return;
    if (sessionRuntime(session) !== "host") {
      const vm = session.vmId ? this.ports.getMachine(session.vmId) : undefined;
      if (vm?.status !== "running") return;
    }
    await this.ports.boots.finish(sessionId);
  }

  private async ensureWorkerDocker(sessionId: string): Promise<VmInstance> {
    let session = await this.ports.require(sessionId);
    const dockerImage = parseDockerImage(session.dockerImage ?? "");
    if (!dockerImage) throw new Error("Enter a Docker image such as ubuntu:24.04");
    const jail = session.network ?? defaultNetworkJail(session.imageId);
    const config = await this.ports.store.loadConfig();
    const backend = (config.workers ?? []).find((row) => row.id === session.backendId);
    if (!backend) throw new Error("Worker was removed from Settings → Workers");
    const fargate = workerProvisionsCompute(backend);
    if (!session.vmId) {
      if (!workerImageAllowed(backend, dockerImage)) {
        throw new Error(`Worker ${backend.name} does not allow image ${dockerImage}`);
      }
      if (fargate) await this.assertComputeCapacity(session, backend);
    }
    if (fargate) {
      session = await this.ensureFargateHandle(session, backend);
    }
    const client = await this.ports.requireWorker(session);
    let vm = session.vmId ? client.get(session.vmId) : undefined;
    if (!vm && session.vmId) vm = await client.refresh(session.vmId);
    if (!vm) {
      const cap = workerMaxConcurrent(backend);
      if (!fargate && cap != null) {
        const live = (await client.listGuests()).filter(
          (guest) => guest.status !== "stopped" && guest.status !== "error",
        ).length;
        if (live >= cap) {
          throw new Error(
            `Worker ${backend.name} already has ${cap} live guest${cap === 1 ? "" : "s"} (maxConcurrent)`,
          );
        }
      }
      const seed = session.imageId
        ? (await this.ports.store.loadImages()).find((i) => i.id === session.imageId)
        : undefined;
      if (session.imageId && !seed) throw new Error("Golden image not found");
      if (seed && imageRuntime(seed) !== "docker") {
        throw new Error("That golden image is a VM disk, not a container workspace");
      }
      const share = config.advanced.hostSharePath?.trim();
      if (share) await mkdirShare(share);
      const seedEnv = await loadWorkspaceEnvironment(seed?.path);
      const forge = this.ports.sessionForge(config, session);
      const guestEnv: Record<string, string> = {
        ...(seedEnv?.env ?? {}),
        ...(session.guestEnv ?? {}),
      };
      const freshForge = forge
        ? await withFreshForgeToken(this.ports.store, forge, this.fetchFn)
        : undefined;
      if (
        freshForge?.token &&
        !guestEnv.GIT_TOKEN &&
        !guestEnv.GITHUB_TOKEN &&
        !guestEnv.GITLAB_TOKEN &&
        !guestEnv.BITBUCKET_TOKEN
      ) {
        guestEnv.GIT_TOKEN = freshForge.token;
      }
      try {
        vm = await client.create({
          sessionId,
          name: session.title,
          image: dockerImage,
          os: session.os,
          templateId: session.templateId,
          network: jail,
          hostShare: Boolean(share),
          allowHosts:
            jail === "restricted"
              ? forgeProviderAllowlist({ ...config, extraHosts: session.allowHosts })
              : undefined,
          env: Object.keys(guestEnv).length ? guestEnv : undefined,
          planeId: config.workerPlaneId,
        });
        if (seed?.path) await client.uploadTree(vm.id, "workspace-seed", seed.path);
        if (share) await client.uploadTree(vm.id, "host-share", share);
      } catch (err) {
        if (vm) await client.destroy(vm.id).catch(() => undefined);
        if (fargate && session.remoteGuestId) {
          await this.ports.compute.destroy(session.remoteGuestId, backend).catch(() => undefined);
          await this.ports.patch(session.id, { remoteGuestId: undefined });
        }
        throw err;
      }
    }
    this.ports.attachWorkerGuest(session, client, vm);
    await this.ports.patch(sessionId, {
      vmId: vm.id,
      status: vm.status === "running" ? "idle" : "provisioning",
      error: undefined,
      ...(session.computeStartedAt ? {} : { computeStartedAt: now() }),
    });
    await this.ports.persistVm(vm);
    this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    this.ports.hub.broadcast({
      type: "session.updated",
      session: await this.ports.require(sessionId),
    });
    await this.ports.landStudioWorkspace(sessionId);

    return client.get(vm.id) ?? vm;
  }

  /** Provisioned workers: one task per agent, so count this backend's live agents. */
  private async assertComputeCapacity(
    session: AgentSession,
    backend: WorkerBackend,
  ): Promise<void> {
    const cap = workerMaxConcurrent(backend);
    if (cap == null) return;
    const live = (await this.ports.list()).filter(
      (row) =>
        row.id !== session.id &&
        row.backendId === backend.id &&
        Boolean(row.remoteGuestId || (row.vmId && row.status !== "stopped")),
    ).length;
    if (live >= cap) {
      throw new Error(
        `Worker ${backend.name} already has ${cap} live guest${cap === 1 ? "" : "s"} (maxConcurrent)`,
      );
    }
  }

  async ensureWorkerHost(sessionId: string): Promise<VmInstance> {
    let session = await this.ports.require(sessionId);
    const config = await this.ports.store.loadConfig();
    const backend = (config.workers ?? []).find((row) => row.id === session.backendId);
    if (!backend) throw new Error("Worker was removed from Settings → Workers");
    const provisioned = workerProvisionsCompute(backend);
    if (provisioned) {
      if (!session.remoteGuestId) await this.assertComputeCapacity(session, backend);
      session = await this.ensureFargateHandle(session, backend);
    }
    const client = await this.ports.requireWorker(session);
    let vm = session.vmId ? client.get(session.vmId) : undefined;
    if (!vm && session.vmId) {
      // A replacement task (after the idle reaper or a restart) has never seen the old guest.
      vm = provisioned
        ? await client.refresh(session.vmId).catch(() => undefined)
        : await client.refresh(session.vmId);
    }
    if (!vm) {
      try {
        vm = await client.create({
          sessionId,
          name: session.title,
          image: "host",
          os: session.os,
          templateId: session.templateId,
          runtime: "host",
          hostDir: workerRunsInTask(backend) ? undefined : session.hostDir?.trim() || undefined,
          planeId: config.workerPlaneId,
        });
      } catch (err) {
        if (provisioned && session.remoteGuestId) {
          await this.ports.compute.destroy(session.remoteGuestId, backend).catch(() => undefined);
          await this.ports.patch(session.id, { remoteGuestId: undefined, vmId: undefined });
        }
        throw err;
      }
    }
    this.ports.attachWorkerGuest(session, client, vm);
    await this.ports.patch(sessionId, {
      vmId: vm.id,
      status: isGuestReady(vm.status) ? "idle" : "provisioning",
      error: undefined,
      ...(session.computeStartedAt ? {} : { computeStartedAt: now() }),
    });
    await this.ports.persistVm(vm);
    this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    this.ports.hub.broadcast({
      type: "session.updated",
      session: await this.ports.require(sessionId),
    });
    await this.ports.landStudioWorkspace(sessionId);
    return client.get(vm.id) ?? vm;
  }

  private async startWorkerHost(sessionId: string): Promise<VmInstance> {
    let vm = await this.ensureWorkerHost(sessionId);
    const session = await this.ports.require(sessionId);
    const client = await this.ports.requireWorker(session);
    this.ports.attachWorkerGuest(session, client, vm);
    if (isGuestReady(vm.status)) {
      await this.ports.installGuestGitAuth(vm);
      await this.ports.onVmStatus(vm.id, vm.status, vm.error);
      return vm;
    }
    vm = await client.start(vm.id);
    this.ports.attachWorkerGuest(session, client, vm);
    await this.ports.installGuestGitAuth(vm);
    await this.ports.patch(sessionId, { vmId: vm.id, status: "provisioning", error: undefined });
    await this.ports.persistVm(vm);
    this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    await this.ports.onVmStatus(vm.id, vm.status, vm.error);
    return vm;
  }

  private async ensureFargateHandle(
    session: AgentSession,
    backend: WorkerBackend,
  ): Promise<AgentSession> {
    if (session.remoteGuestId) {
      if (this.ports.compute.get(session.remoteGuestId)) return session;
      await this.ports.compute.destroy(session.remoteGuestId, backend).catch(() => undefined);
      session = await this.ports.patch(session.id, { remoteGuestId: undefined });
    }
    const size = workerPickSize(backend, session.instanceSize);
    const quote = this.ports.compute.quote(backend, size);
    const workerTls = workerRunsInTask(backend) ? createSelfSignedWorkerTls() : undefined;
    const handle = await this.ports.compute.provision({
      backend,
      sessionId: session.id,
      size,
      workerTls,
    });
    this.ports.boots.step(session.id, "connect");
    const probe = new WorkerClient(
      {
        ...backend,
        url: handle.url,
        token: handle.token,
        fingerprint: handle.fingerprint ?? backend.fingerprint,
      },
      this.fetchFn === fetch ? undefined : (input, init) => this.fetchFn(input, init),
    );
    try {
      // A cold task still has to pull the worker image and start Node after the ENI is up.
      const health = await probe.waitReady({ timeoutMs: this.ports.computeReadyTimeoutMs() });
      if (health.fingerprint) handle.fingerprint = health.fingerprint;
    } catch (err) {
      await this.ports.compute.destroy(handle.id, backend).catch(() => undefined);
      throw err;
    }
    this.ports.workers.set(`${backend.id}:${handle.id}`, probe);
    return this.ports.patch(session.id, {
      remoteGuestId: handle.id,
      quotedUsdPerHour: quote.usdPerHour,
      instanceSize: size,
    });
  }

  private async startWorkerVm(sessionId: string): Promise<VmInstance> {
    let vm = await this.ensureWorkerVm(sessionId);
    const session = await this.ports.require(sessionId);
    const client = await this.ports.requireWorker(session);
    this.ports.attachWorkerGuest(session, client, vm);
    if (isGuestReady(vm.status)) {
      await this.ports.installGuestGitAuth(vm);
      return vm;
    }
    vm = await client.start(vm.id);
    this.ports.attachWorkerGuest(session, client, vm);
    await this.ports.keepGuestOrDestroy(sessionId, vm.id, client);
    await this.ports.installGuestGitAuth(vm);
    await this.ports.patch(sessionId, { vmId: vm.id, status: "provisioning", error: undefined });
    await this.ports.persistVm(vm);
    this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    await this.ports.onVmStatus(vm.id, vm.status, vm.error);
    return vm;
  }

  private async ensureWorkerVm(sessionId: string): Promise<VmInstance> {
    let session = await this.ports.require(sessionId);
    const config = await this.ports.store.loadConfig();
    const backend = (config.workers ?? []).find((row) => row.id === session.backendId);
    if (!backend) throw new Error("Worker was removed from Settings → Workers");
    const template = config.templates.find((row) => row.id === session.templateId);
    if (!template) throw new Error("Template missing");
    if (workerProvisionsCompute(backend)) {
      session = await this.ensureFargateHandle(session, backend);
    }
    const client = await this.ports.requireWorker(session);
    let vm = session.vmId ? client.get(session.vmId) : undefined;
    if (!vm && session.vmId) vm = await client.refresh(session.vmId);
    if (!vm) {
      const cap = workerMaxConcurrent(backend);
      if (cap != null) {
        const live = (await client.listGuests()).filter(
          (guest) => guest.status !== "stopped" && guest.status !== "error",
        ).length;
        if (live >= cap) {
          throw new Error(
            `Worker ${backend.name} already has ${cap} live guest${cap === 1 ? "" : "s"} (maxConcurrent)`,
          );
        }
      }
      const hardware = session.hardware ?? template.hardware;
      const seed = session.imageId
        ? (await this.ports.store.loadImages()).find((i) => i.id === session.imageId)
        : undefined;
      if (session.imageId && !seed) throw new Error("Golden image not found");
      if (seed && imageRuntime(seed) !== "vm") {
        throw new Error("That golden image is a container workspace, not a VM disk");
      }
      let imagePath = seed?.path;
      if (seed?.path && session.imageId) {
        const remote = await client.hasGoldenDisk(session.imageId);
        if (remote?.path) imagePath = remote.path;
        else {
          const uploaded = await client.uploadGoldenDisk(session.imageId, seed.path);
          imagePath = uploaded.path;
        }
      }
      vm = await client.create({
        sessionId,
        name: session.title,
        image: "vm",
        os: session.os,
        templateId: session.templateId,
        runtime: "vm",
        template: { ...template, hardware },
        network: session.network ?? defaultNetworkJail(session.imageId),
        imagePath,
        planeId: config.workerPlaneId,
      });
    }
    this.ports.attachWorkerGuest(session, client, vm);
    await this.ports.patch(sessionId, {
      vmId: vm.id,
      status: isGuestReady(vm.status) ? "idle" : "provisioning",
      error: undefined,
      ...(session.computeStartedAt ? {} : { computeStartedAt: now() }),
    });
    await this.ports.persistVm(vm);
    this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    this.ports.hub.broadcast({
      type: "session.updated",
      session: await this.ports.require(sessionId),
    });
    await this.ports.landStudioWorkspace(sessionId);
    return client.get(vm.id) ?? vm;
  }

  private async startWorkerDocker(sessionId: string): Promise<VmInstance> {
    let vm = await this.ensureWorkerDocker(sessionId);
    const session = await this.ports.require(sessionId);
    const client = await this.ports.requireWorker(session);
    this.ports.attachWorkerGuest(session, client, vm);
    if (isGuestReady(vm.status)) {
      await this.ports.installGuestGitAuth(vm);
      return vm;
    }
    vm = await client.start(vm.id);
    this.ports.attachWorkerGuest(session, client, vm);
    await this.ports.keepGuestOrDestroy(sessionId, vm.id, client);
    await this.ports.installGuestGitAuth(vm);
    await this.ports.patch(sessionId, { vmId: vm.id, status: "provisioning", error: undefined });
    await this.ports.persistVm(vm);
    this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    await this.ports.onVmStatus(vm.id, vm.status, vm.error);
    return vm;
  }

  async ensureDocker(sessionId: string): Promise<VmInstance> {
    const session = await this.ports.require(sessionId);
    if (sessionRuntime(session) !== "docker") {
      throw new Error(
        sessionRuntime(session) === "host"
          ? "Host agents do not have a VM or container."
          : "This agent is not a Docker session.",
      );
    }
    if (this.ports.isWorkerSession(session)) return this.ensureWorkerDocker(sessionId);
    const dockerImage = parseDockerImage(session.dockerImage ?? "");
    if (!dockerImage) throw new Error("Enter a Docker image such as ubuntu:24.04");
    const config = await this.ports.store.loadConfig();
    const share = session.offline ? undefined : config.advanced.hostSharePath?.trim();
    if (share) await mkdirShare(share);

    const seed = session.imageId
      ? (await this.ports.store.loadImages()).find((i) => i.id === session.imageId)
      : undefined;
    if (session.imageId && !seed) throw new Error("Golden image not found");
    if (seed && imageRuntime(seed) !== "docker") {
      throw new Error("That golden image is a VM disk, not a container workspace");
    }

    let vm = session.vmId ? this.docker.get(session.vmId) : undefined;
    if (!vm && session.vmId && this.docker.adopt) {
      const persisted = (await this.ports.store.loadVms()).find((v) => v.id === session.vmId);
      if (persisted) vm = this.docker.adopt(persisted);
    }
    if (!vm) {
      const seedEnv = await loadWorkspaceEnvironment(seed?.path);
      const forge = session.offline ? undefined : this.ports.sessionForge(config, session);
      const guestEnv: Record<string, string> = {
        ...(seedEnv?.env ?? {}),
        ...(session.guestEnv ?? {}),
      };
      const freshForge = forge
        ? await withFreshForgeToken(this.ports.store, forge, this.fetchFn)
        : undefined;
      if (
        freshForge?.token &&
        !guestEnv.GIT_TOKEN &&
        !guestEnv.GITHUB_TOKEN &&
        !guestEnv.GITLAB_TOKEN &&
        !guestEnv.BITBUCKET_TOKEN
      ) {
        guestEnv.GIT_TOKEN = freshForge.token;
      }
      vm = await this.docker.create({
        sessionId,
        name: session.title,
        image: dockerImage,
        os: session.os,
        templateId: session.templateId,
        hostSharePath: share || undefined,
        cachedImageOnly: session.offline,
        workspaceSeed: seed?.path,
        network: session.network ?? defaultNetworkJail(session.imageId),
        env: Object.keys(guestEnv).length ? guestEnv : undefined,
      });
    }
    const jail = session.network ?? defaultNetworkJail(session.imageId);
    if (jail === "restricted") {
      const proxy = await this.ports.ensureProxy(sessionId);
      this.docker.configureNetwork?.(vm.id, jail, proxy.port);
    } else {
      this.ports.closeProxy(sessionId);
      this.docker.configureNetwork?.(vm.id, jail);
    }
    await this.ports.patch(sessionId, {
      vmId: vm.id,
      status: vm.status === "running" ? "idle" : "provisioning",
      error: undefined,
    });
    await this.ports.persistVm(vm);
    this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    this.ports.hub.broadcast({
      type: "session.updated",
      session: await this.ports.require(sessionId),
    });
    return this.docker.get(vm.id) ?? vm;
  }

  private async startDocker(sessionId: string): Promise<VmInstance> {
    const current = await this.ports.require(sessionId);
    if (this.ports.isWorkerHost(current)) return this.startWorkerHost(sessionId);
    if (this.ports.isWorkerSession(current)) return this.startWorkerDocker(sessionId);
    let vm = await this.ensureDocker(sessionId);
    if (vm.status === "running" || vm.status === "ready" || vm.status === "booting") {
      await this.ports.installGuestGitAuth(vm);
      return vm;
    }
    const before = await this.ports.require(sessionId);
    const setupHere =
      !isCanvasSession(before) && (!before.repo?.url || this.ports.cloned.has(sessionId));
    if (setupHere) this.ports.bootSetupPending.add(sessionId);
    try {
      vm = await this.docker.start(vm.id);
      await this.ports.keepGuestOrDestroy(sessionId, vm.id, this.docker);
      await this.ports.installGuestGitAuth(vm);
      const session = await this.ports.require(sessionId);
      if (!isCanvasSession(session) && (!session.repo?.url || this.ports.cloned.has(sessionId))) {
        await this.ports.applyWorkspaceEnvironment(sessionId, vm);
      }
    } finally {
      this.ports.bootSetupPending.delete(sessionId);
    }
    await this.maybeFinishBootSteps(sessionId);
    await this.ports.patch(sessionId, { vmId: vm.id, status: "provisioning", error: undefined });
    await this.ports.persistVm(vm);
    this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    return vm;
  }

  private async startQemuVm(sessionId: string): Promise<VmInstance> {
    const session = await this.ports.require(sessionId);
    const config = await this.ports.store.loadConfig();
    const template = config.templates.find((t) => t.id === session.templateId);
    if (!template) throw new Error("Template missing");
    const hardware = session.hardware ?? template.hardware;
    const isoError = this.hypervisor.isoError?.(template, { imageId: session.imageId });
    if (isoError) throw new Error(isoError);

    const existing = this.hypervisor
      .list()
      .filter((v) => (v.status === "running" || v.status === "booting") && v.id !== session.vmId);
    if (existing.length >= config.advanced.maxConcurrentVms) {
      throw new Error(`Max concurrent VMs reached (${config.advanced.maxConcurrentVms})`);
    }

    const share = config.advanced.hostSharePath?.trim();
    if (share) await mkdirShare(share);
    const image = session.imageId
      ? (await this.ports.store.loadImages()).find((i) => i.id === session.imageId)
      : undefined;
    if (session.imageId && !image) throw new Error("Golden image not found");

    let vm = session.vmId ? this.hypervisor.get(session.vmId) : undefined;
    if (!vm && session.vmId && this.hypervisor.adopt) {
      const persisted = (await this.ports.store.loadVms()).find((v) => v.id === session.vmId);
      if (persisted) {
        vm = this.hypervisor.adopt(
          persisted,
          { ...template, hardware },
          {
            imagePath: image?.path,
            hostSharePath: share || undefined,
          },
        );
      }
    }
    if (!vm) {
      vm = await this.hypervisor.create({
        sessionId,
        name: session.title,
        template: { ...template, hardware },
        slot: this.hypervisor.nextSlot(),
        imagePath: image?.path,
        hostSharePath: share || undefined,
      });
    }
    if (!vm) throw new Error("VM not found");
    if (session.imageId) vm.imageId = session.imageId;
    const jail = session.network ?? defaultNetworkJail(session.imageId);
    let proxyPort: number | undefined;
    if (jail === "restricted") proxyPort = (await this.ports.ensureProxy(sessionId)).port;
    else this.ports.closeProxy(sessionId);
    this.hypervisor.configureNetwork?.(vm.id, jailNetworking(jail, proxyPort));
    if (
      vm &&
      (vm.status === "running" ||
        vm.status === "ready" ||
        vm.status === "booting" ||
        vm.status === "installing")
    ) {
      await this.ports.patch(sessionId, {
        vmId: vm.id,
        status: vm.status === "running" ? "idle" : "provisioning",
      });
      await this.ports.persistVm(vm);
      this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
      return vm;
    }
    vm = await this.hypervisor.start(vm.id);
    await this.ports.patch(sessionId, { vmId: vm.id, status: "provisioning", error: undefined });
    await this.ports.persistVm(vm);
    this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    return vm;
  }

  async stopVm(sessionId: string): Promise<void> {
    const session = await this.ports.require(sessionId);
    if (this.ports.isWorkerSession(session)) {
      const client = await this.ports.requireWorker(session);
      const config = await this.ports.store.loadConfig();
      const backend =
        (config.workers ?? []).find((row) => row.id === session.backendId) ?? client.backend;
      if (workerDestroyOnStop(backend)) {
        await this.ports.destroyWorkerGuest(session);
        return;
      }
      if (!session.vmId) return;
      const vm = await client.stop(session.vmId);
      this.ports.closeProxy(sessionId);
      this.ports.closeIdeTunnel(sessionId);
      await this.ports.patch(sessionId, {
        status: "stopped",
        computeMs: sessionComputeMs(session),
        computeStartedAt: undefined,
      });
      await this.ports.persistVm(vm);
      this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
      await this.ports.onVmStatus(vm.id, vm.status, vm.error);
      return;
    }
    if (!session.vmId) return;
    const vm = await this.ports.engine(session).stop(session.vmId);
    this.ports.closeProxy(sessionId);
    this.ports.closeIdeTunnel(sessionId);
    await this.ports.patch(sessionId, { status: "stopped" });
    await this.ports.persistVm(vm);
    this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
  }

  async pauseVm(sessionId: string): Promise<VmInstance> {
    const session = await this.ports.require(sessionId);
    if (this.ports.isWorkerSession(session))
      throw new Error("Pause is not available on a worker guest");
    if (!session.vmId) throw new Error("Start the machine before pausing");
    const engine = this.ports.engine(session);
    const vm = await engine.pause(session.vmId);
    await this.ports.persistVm(vm);
    this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    return vm;
  }

  async resumeVm(sessionId: string): Promise<VmInstance> {
    const session = await this.ports.require(sessionId);
    if (this.ports.isWorkerSession(session))
      throw new Error("Resume is not available on a worker guest");
    if (!session.vmId) throw new Error("Start the machine before resuming");
    const engine = this.ports.engine(session);
    const resume = engine.resume?.bind(engine);
    if (!resume) throw new Error("This runtime cannot resume");
    const vm = await resume(session.vmId);
    await this.ports.persistVm(vm);
    this.ports.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    return vm;
  }
}

async function mkdirShare(path: string): Promise<void> {
  await mkdir(path, { recursive: true }).catch(() => undefined);
}
