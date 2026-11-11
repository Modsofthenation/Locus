import type {
  DockerContainerStats,
  DockerHostContainer,
  DockerSwarmInfo,
  DockerSwarmNode,
  DockerSwarmService,
  DockerSwarmStack,
  DockerSwarmTask,
  GuestOs,
  NetworkJail,
  VmInstance,
  VmLifecycle,
  VmTemplate,
} from "@locus/shared";
import {
  dockerIdMatch,
  gitCredentialInstallCommand,
  inactiveDockerSwarmSnapshot,
  isLocusAgentImage,
  matchDockerSwarmService,
  mockDockerContainerStats,
  parseDockerContainerRef,
  parseDockerImage,
  parseDockerLogTail,
  parseDockerNodeLsJson,
  parseDockerServiceLsJson,
  parseDockerServicePsJson,
  parseDockerStackLsJson,
  parseDockerStatsJson,
  parseDockerSwarmInfo,
  parseDockerSwarmRef,
  parseDockerSwarmReplicas,
  parseProcNetTcp,
  uniquePreviewPorts,
  type ImageBuildProgress,
} from "@locus/shared";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, cp, rm, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { appendVmLog, formatStatusLine } from "./logs.js";
import { ensureLocusAgentImage } from "./images.js";
import { nodeRunner, type CommandRunner } from "./runner.js";
import type { MachineLifecycle, VmListener } from "./types.js";

export interface CreateContainerRequest {
  sessionId: string;
  name: string;
  image: string;
  os?: GuestOs;
  templateId?: string;
  hostSharePath?: string;
  /** Worker-only: mount an empty `/mnt/host` on the worker; laptop uploads after create. */
  hostShare?: boolean;
  workspaceSeed?: string;
  network?: NetworkJail;
  proxyPort?: number;
  /** Shared secret for the restricted-jail CONNECT proxy (`locus:<token>` basic auth). */
  proxyAuth?: string;
  allowHosts?: string[];
  env?: Record<string, string>;
  /** Worker host runtime: skip Docker and use a folder on the worker. */
  runtime?: "docker" | "host" | "vm";
  /** Absolute folder on the worker host. Empty means `host-workspaces/<sessionId>`. */
  hostDir?: string;
  /** Worker QEMU: full template from the control plane (isoPath resolved on the worker). */
  template?: VmTemplate;
  /** Worker QEMU: optional golden overlay path on the worker. */
  imagePath?: string;
  /** Control-plane namespace on a shared worker. */
  planeId?: string;
}

export type ImageBuildListener = (id: string, progress: ImageBuildProgress) => void;

export interface DockerEngine extends MachineLifecycle {
  readonly kind: "mock" | "docker";
  create(req: CreateContainerRequest): Promise<VmInstance>;
  restart(id: string): Promise<VmInstance>;
  resume(id: string): Promise<VmInstance>;
  adopt?(instance: VmInstance): VmInstance;
  snapshotWorkspace?(id: string, destPath: string): Promise<void>;
  restoreWorkspace?(id: string, srcPath: string): Promise<void>;
  configureNetwork?(id: string, jail: NetworkJail, proxyPort?: number, proxyAuth?: string): void;
  noteListeningPorts?(id: string, ports: number[]): void;
  listListeningPorts?(id: string): Promise<number[]>;
  inspectAddress?(id: string): Promise<string | undefined>;
  listHostContainers?(): Promise<DockerHostContainer[]>;
  hostControl?(ref: string, action: "start" | "stop" | "restart"): Promise<void>;
  hostLogs?(ref: string, tail?: number): Promise<string>;
  hostStats(ref: string): Promise<DockerContainerStats>;
  swarmInfo(): Promise<DockerSwarmInfo>;
  listSwarmNodes(): Promise<DockerSwarmNode[]>;
  listSwarmServices(): Promise<DockerSwarmService[]>;
  listSwarmStacks(): Promise<DockerSwarmStack[]>;
  listSwarmTasks(service: string): Promise<DockerSwarmTask[]>;
  swarmServiceLogs(ref: string, tail?: number): Promise<string>;
  scaleSwarmService(ref: string, replicas: number): Promise<DockerSwarmService>;
  onBuild(listener: ImageBuildListener): void;
}

export function parseDockerPsJson(stdout: string): DockerHostContainer[] {
  const rows: DockerHostContainer[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      const id = String(row.ID ?? row.Id ?? "").trim();
      if (!id || !parseDockerContainerRef(id)) continue;
      const name = String(row.Names ?? row.Name ?? "")
        .replace(/^\//, "")
        .split(",")[0]
        ?.trim();
      rows.push({
        id,
        name: name && parseDockerContainerRef(name) ? name : id.slice(0, 12),
        image: String(row.Image ?? ""),
        state: String(row.State ?? "").toLowerCase(),
        status: String(row.Status ?? ""),
        createdAt: String(row.CreatedAt ?? row.Created ?? ""),
      });
    } catch {
      /* skip malformed docker ps lines */
    }
  }
  return rows;
}

async function copyDir(src: string, dest: string): Promise<void> {
  const parent = dirname(dest);
  await mkdir(parent, { recursive: true });
  const tmp = join(parent, `.${basename(dest)}.tmp-${randomUUID()}`);
  try {
    await cp(src, tmp, { recursive: true });
    await rm(dest, { recursive: true, force: true });
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

async function seedWorkspace(req: CreateContainerRequest, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  if (req.workspaceSeed?.trim()) await copyDir(req.workspaceSeed.trim(), dest);
}

const BOOT_MS = 80;
const READY_MS = 180;

export function restrictedEgressScript(proxyPort: number): string {
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) return "true";
  return [
    "IPT=$(command -v iptables-nft || command -v iptables || true)",
    '[ -n "$IPT" ] || { echo LOCUS_NO_IPTABLES; exit 1; }',
    "$IPT -F OUTPUT >/dev/null 2>&1 || true",
    "$IPT -P OUTPUT DROP",
    "$IPT -A OUTPUT -o lo -j ACCEPT",
    "$IPT -A OUTPUT -d 127.0.0.0/8 -j ACCEPT",
    "HOSTIP=$(getent hosts host.docker.internal 2>/dev/null | awk '{ print $1; exit }')",
    `[ -n "$HOSTIP" ] && $IPT -A OUTPUT -d "$HOSTIP" -p tcp --dport ${proxyPort} -j ACCEPT`,
    "$IPT -A OUTPUT -d 127.0.0.11 -p udp --dport 53 -j ACCEPT",
    "$IPT -A OUTPUT -d 127.0.0.11 -p tcp --dport 53 -j ACCEPT",
    "$IPT -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || $IPT -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true",
  ].join("\n");
}

function now(): string {
  return new Date().toISOString();
}

function assertSafeSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId) || sessionId.length > 80) {
    throw new Error("Invalid session id");
  }
}

export function dockerWorkspaceDir(dataDir: string, sessionId: string): string {
  assertSafeSessionId(sessionId);
  return join(dataDir, "docker-workspaces", sessionId);
}

export function hostWorkspaceDir(dataDir: string, sessionId: string): string {
  assertSafeSessionId(sessionId);
  return join(dataDir, "host-workspaces", sessionId);
}

export function sessionHostWorkspace(
  dataDir: string,
  session: { id: string; hostDir?: string },
): string {
  const chosen = session.hostDir?.trim();
  return chosen || hostWorkspaceDir(dataDir, session.id);
}

function workspaceHost(dataDir: string, sessionId: string): string {
  return dockerWorkspaceDir(dataDir, sessionId);
}

function locusContainerName(id: string): string {
  return `locus-${id}`;
}

function assertNotHostRuntime(req: CreateContainerRequest): void {
  if (req.runtime === "host") {
    throw new Error("Host agents do not have a VM or container.");
  }
  if (req.runtime === "vm") {
    throw new Error("VM guests use the QEMU hypervisor, not Docker.");
  }
}

function instanceFrom(req: CreateContainerRequest, id: string, dataDir: string): VmInstance {
  return {
    id,
    sessionId: req.sessionId,
    templateId: req.templateId || "docker",
    os: req.os ?? "ubuntu",
    name: req.name,
    status: "creating",
    diskPath: workspaceHost(dataDir, req.sessionId),
    runtime: "docker",
    dockerImage: req.image,
    network: req.network,
    planeId: req.planeId,
    createdAt: now(),
    updatedAt: now(),
  };
}

export class MockDockerEngine extends EventEmitter implements DockerEngine {
  readonly kind = "mock" as const;
  readonly liveEngine = false;
  private vms = new Map<string, VmInstance>();
  private timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  private log = new Map<string, string>();
  private jails = new Map<string, { jail: NetworkJail; proxyPort?: number; proxyAuth?: string }>();
  private listening = new Map<string, Set<number>>();
  private swarm = inactiveDockerSwarmSnapshot();
  private swarmLogs = new Map<string, string>();
  private swarmTasks = new Map<string, DockerSwarmTask[]>();

  constructor(private readonly dataDir: string) {
    super();
  }

  async available(): Promise<boolean> {
    return true;
  }

  onStatus(listener: VmListener): void {
    this.on("status", listener);
  }

  onBuild(listener: ImageBuildListener): void {
    this.on("build", listener);
  }

  list(): VmInstance[] {
    return [...this.vms.values()];
  }

  get(id: string): VmInstance | undefined {
    return this.vms.get(id);
  }

  logs(id: string): string {
    return this.log.get(id) ?? "";
  }

  async swarmInfo(): Promise<DockerSwarmInfo> {
    return { ...this.swarm.info };
  }

  async listSwarmNodes(): Promise<DockerSwarmNode[]> {
    return this.swarm.nodes.map((row) => ({ ...row }));
  }

  async listSwarmServices(): Promise<DockerSwarmService[]> {
    return this.swarm.services.map((row) => ({ ...row }));
  }

  async listSwarmStacks(): Promise<DockerSwarmStack[]> {
    return this.swarm.stacks.map((row) => ({ ...row }));
  }

  async listSwarmTasks(service: string): Promise<DockerSwarmTask[]> {
    const row = this.requireSwarmService(service);
    return (this.swarmTasks.get(row.id) ?? this.swarmTasks.get(row.name) ?? []).map((task) => ({
      ...task,
    }));
  }

  async swarmServiceLogs(ref: string, tail?: number): Promise<string> {
    const row = this.requireSwarmService(ref);
    const text = this.swarmLogs.get(row.id) ?? this.swarmLogs.get(row.name) ?? "";
    const n = parseDockerLogTail(tail);
    const lines = text.split("\n");
    return lines.slice(-n).join("\n") || "No logs yet.";
  }

  async scaleSwarmService(ref: string, replicas: number): Promise<DockerSwarmService> {
    if (this.swarm.info.state !== "active") throw new Error("Docker Swarm is inactive");
    if (!this.swarm.info.controlAvailable) throw new Error("This node is not a Swarm manager");
    const count = parseDockerSwarmReplicas(replicas);
    if (count === undefined) throw new Error("Invalid replica count");
    const row = this.requireSwarmService(ref);
    if (row.mode.toLowerCase() === "global") throw new Error("Cannot scale a global service");
    row.replicas = `${count}/${count}`;
    row.mode = "replicated";
    return { ...row };
  }

  seedSwarm(input: {
    info?: Partial<DockerSwarmInfo>;
    nodes?: DockerSwarmNode[];
    services?: DockerSwarmService[];
    stacks?: DockerSwarmStack[];
    tasks?: Record<string, DockerSwarmTask[]>;
    logs?: Record<string, string>;
  }): void {
    this.swarm = {
      info: { ...inactiveDockerSwarmSnapshot().info, ...input.info },
      nodes: (input.nodes ?? []).map((row) => ({ ...row })),
      services: (input.services ?? []).map((row) => ({ ...row })),
      stacks: (input.stacks ?? []).map((row) => ({ ...row })),
    };
    this.swarmTasks.clear();
    this.swarmLogs.clear();
    for (const [key, tasks] of Object.entries(input.tasks ?? {})) {
      this.swarmTasks.set(
        key,
        tasks.map((task) => ({ ...task })),
      );
    }
    for (const [key, text] of Object.entries(input.logs ?? {})) {
      this.swarmLogs.set(key, text);
    }
  }

  private requireSwarmService(ref: string): DockerSwarmService {
    const parsed = parseDockerSwarmRef(ref);
    if (!parsed) throw new Error("Invalid service");
    const row = this.swarm.services.find((item) => matchDockerSwarmService(item, parsed));
    if (!row) throw new Error("Service not found");
    return row;
  }

  async hostStats(ref: string): Promise<DockerContainerStats> {
    const parsed = parseDockerContainerRef(ref);
    if (!parsed) throw new Error("Invalid container");
    const vm =
      this.get(parsed) ??
      this.list().find(
        (row) =>
          row.name === parsed ||
          locusContainerName(row.id) === parsed ||
          (row.containerId ? dockerIdMatch(row.containerId, parsed) : false),
      );
    if (!vm) throw new Error("Container not found");
    const running = vm.status === "running" || vm.status === "ready";
    return mockDockerContainerStats({
      id: vm.containerId || vm.id,
      name: vm.name,
      running,
    });
  }

  async create(req: CreateContainerRequest): Promise<VmInstance> {
    assertNotHostRuntime(req);
    const image = parseDockerImage(req.image);
    if (!image) throw new Error("Enter a Docker image such as ubuntu:24.04");
    const id = randomUUID();
    await seedWorkspace(req, workspaceHost(this.dataDir, req.sessionId));
    const vm = instanceFrom({ ...req, image }, id, this.dataDir);
    this.vms.set(id, vm);
    this.jails.set(id, {
      jail: req.network ?? "open",
      proxyPort: req.proxyPort,
      proxyAuth: req.proxyAuth,
    });
    this.pushLog(id, formatStatusLine("creating"));
    this.emitStatus(vm);
    return vm;
  }

  async start(id: string): Promise<VmInstance> {
    this.clearTimers(id);
    this.setStatus(id, "booting");
    const t1 = setTimeout(() => this.setStatus(id, "ready"), BOOT_MS);
    const t2 = setTimeout(() => this.setStatus(id, "running", undefined, 1), READY_MS);
    this.timers.set(id, [t1, t2]);
    return this.require(id);
  }

  async stop(id: string): Promise<VmInstance> {
    this.clearTimers(id);
    this.setStatus(id, "stopped");
    return this.require(id);
  }

  async restart(id: string): Promise<VmInstance> {
    await this.stop(id);
    return this.start(id);
  }

  async pause(id: string): Promise<VmInstance> {
    this.setStatus(id, "paused");
    return this.require(id);
  }

  async resume(id: string): Promise<VmInstance> {
    this.setStatus(id, "running");
    return this.require(id);
  }

  async destroy(id: string): Promise<void> {
    this.clearTimers(id);
    this.vms.delete(id);
    this.log.delete(id);
    this.jails.delete(id);
    this.listening.delete(id);
    this.emit("status", id, "stopped");
  }

  adopt(instance: VmInstance): VmInstance {
    const vm: VmInstance = {
      ...instance,
      runtime: "docker",
      status:
        instance.status === "running" || instance.status === "booting"
          ? "stopped"
          : instance.status,
      pid: undefined,
    };
    this.vms.set(vm.id, vm);
    if (!this.log.has(vm.id)) this.log.set(vm.id, "");
    return vm;
  }

  async snapshotWorkspace(id: string, destPath: string): Promise<void> {
    const vm = this.require(id);
    await copyDir(vm.diskPath, destPath);
  }

  async restoreWorkspace(id: string, srcPath: string): Promise<void> {
    const vm = this.require(id);
    await copyDir(srcPath, vm.diskPath);
  }

  configureNetwork(id: string, jail: NetworkJail, proxyPort?: number, proxyAuth?: string): void {
    const prev = this.jails.get(id);
    this.jails.set(id, { jail, proxyPort, proxyAuth: proxyAuth ?? prev?.proxyAuth });
    const vm = this.vms.get(id);
    if (vm) vm.network = jail;
  }

  noteListeningPorts(id: string, ports: number[]): void {
    const next = this.listening.get(id) ?? new Set<number>();
    for (const port of uniquePreviewPorts(ports)) next.add(port);
    this.listening.set(id, next);
  }

  async listListeningPorts(id: string): Promise<number[]> {
    this.require(id);
    return uniquePreviewPorts([...(this.listening.get(id) ?? [])]);
  }

  async inspectAddress(_id: string): Promise<string | undefined> {
    return undefined;
  }

  networkFor(id: string): { jail: NetworkJail; proxyPort?: number } | undefined {
    return this.jails.get(id);
  }

  forceRunning(id: string): void {
    this.clearTimers(id);
    this.setStatus(id, "running", undefined, 1);
  }

  shutdown(): void {
    for (const id of this.timers.keys()) this.clearTimers(id);
  }

  private setStatus(id: string, status: VmLifecycle, error?: string, pid?: number): void {
    const vm = this.vms.get(id);
    if (!vm) return;
    vm.status = status;
    vm.error = error;
    vm.updatedAt = now();
    if (pid !== undefined) vm.pid = pid;
    if (status === "running" && !vm.containerId) vm.containerId = `mock-${id.slice(0, 12)}`;
    this.vms.set(id, vm);
    this.pushLog(id, formatStatusLine(status, error));
    this.emitStatus(vm);
  }

  private pushLog(id: string, chunk: string): void {
    this.log.set(id, appendVmLog(this.log.get(id) ?? "", chunk));
  }

  private emitStatus(vm: VmInstance): void {
    this.emit("status", vm.id, vm.status, vm.error);
  }

  private require(id: string): VmInstance {
    const vm = this.vms.get(id);
    if (!vm) throw new Error(`Container not found: ${id}`);
    return vm;
  }

  private clearTimers(id: string): void {
    for (const t of this.timers.get(id) ?? []) clearTimeout(t);
    this.timers.delete(id);
  }
}

export class DockerCliEngine extends EventEmitter implements DockerEngine {
  readonly kind = "docker" as const;
  readonly liveEngine = true;
  private vms = new Map<string, VmInstance>();
  private log = new Map<string, string>();
  private shares = new Map<string, string>();
  private jails = new Map<string, { jail: NetworkJail; proxyPort?: number; proxyAuth?: string }>();
  private listening = new Map<string, Set<number>>();
  private envs = new Map<string, Record<string, string>>();

  constructor(
    private readonly dataDir: string,
    private readonly runner: CommandRunner,
    private readonly dockerBin: string,
  ) {
    super();
  }

  async available(): Promise<boolean> {
    const info = await this.runner
      .exec(this.dockerBin, ["info"])
      .catch(() => ({ code: 1, stdout: "", stderr: "" }));
    return info.code === 0;
  }

  onStatus(listener: VmListener): void {
    this.on("status", listener);
  }

  onBuild(listener: ImageBuildListener): void {
    this.on("build", listener);
  }

  list(): VmInstance[] {
    return [...this.vms.values()];
  }

  get(id: string): VmInstance | undefined {
    return this.vms.get(id);
  }

  logs(id: string): string {
    return this.log.get(id) ?? "";
  }

  async create(req: CreateContainerRequest): Promise<VmInstance> {
    assertNotHostRuntime(req);
    const image = parseDockerImage(req.image);
    if (!image) throw new Error("Enter a Docker image such as ubuntu:24.04");
    const id = randomUUID();
    await seedWorkspace(req, workspaceHost(this.dataDir, req.sessionId));
    const vm = instanceFrom({ ...req, image }, id, this.dataDir);
    this.vms.set(id, vm);
    this.jails.set(id, {
      jail: req.network ?? "open",
      proxyPort: req.proxyPort,
      proxyAuth: req.proxyAuth,
    });
    if (req.hostSharePath?.trim()) this.shares.set(id, req.hostSharePath.trim());
    if (req.env && Object.keys(req.env).length) this.envs.set(id, req.env);
    this.pushLog(id, formatStatusLine("creating"));
    this.emitStatus(vm);
    return vm;
  }

  async start(id: string): Promise<VmInstance> {
    const vm = this.require(id);
    if (vm.status === "running" || vm.status === "ready" || vm.status === "paused") return vm;
    this.setStatus(id, "booting");
    try {
      await ensureLocusAgentImage(
        this.runner,
        this.dockerBin,
        vm.dockerImage ?? "",
        (chunk) => this.pushLog(id, chunk),
        undefined,
        (progress) => this.emit("build", id, progress),
      );
      this.assertPresent(id);
      if (vm.containerId) {
        const started = await this.runner.exec(this.dockerBin, ["start", vm.containerId]);
        if (started.code !== 0) {
          throw new Error(started.stderr.trim() || started.stdout.trim() || "docker start failed");
        }
      } else {
        const jail = this.jails.get(id)?.jail ?? vm.network ?? "open";
        if (jail === "restricted") await this.ensureRestrictedNetwork();
        const created = await this.withRunEnvFile(vm, (envFile) =>
          this.runner.exec(this.dockerBin, this.runArgs(vm, envFile)),
        );
        if (created.code !== 0) {
          throw new Error(created.stderr.trim() || created.stdout.trim() || "docker run failed");
        }
        vm.containerId = created.stdout.trim().slice(0, 64);
        if (created.stderr.trim()) this.pushLog(id, created.stderr);
      }
      this.assertPresent(id);
      const running = await this.containerRunning(vm.containerId);
      if (!running) {
        throw new Error("Container exited immediately after start");
      }
      await this.applyRestrictedFirewall(this.require(id));
      this.setStatus(id, "running");
      await this.startCodeServer(this.require(id));
      await this.installGitCredentialHelper(this.require(id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "docker failed";
      await this.removeContainer(id, vm.containerId);
      const failed = this.vms.get(id);
      if (failed) {
        failed.containerId = undefined;
        this.setStatus(id, "error", message);
      }
      throw err;
    }
    return this.require(id);
  }

  async stop(id: string): Promise<VmInstance> {
    const vm = this.require(id);
    this.setStatus(id, "stopping");
    if (vm.containerId) {
      await this.runner.exec(this.dockerBin, ["stop", vm.containerId]).catch(() => undefined);
    }
    this.setStatus(id, "stopped");
    return this.require(id);
  }

  async restart(id: string): Promise<VmInstance> {
    await this.stop(id);
    return this.start(id);
  }

  async listHostContainers(): Promise<DockerHostContainer[]> {
    const listed = await this.runner.exec(this.dockerBin, [
      "ps",
      "-a",
      "--no-trunc",
      "--format",
      "{{json .}}",
    ]);
    if (listed.code !== 0) {
      throw new Error(listed.stderr.trim() || listed.stdout.trim() || "docker ps failed");
    }
    return parseDockerPsJson(listed.stdout);
  }

  async hostControl(ref: string, action: "start" | "stop" | "restart"): Promise<void> {
    const id = parseDockerContainerRef(ref);
    if (!id) throw new Error("Invalid container");
    const ran = await this.runner.exec(this.dockerBin, [action, id]);
    if (ran.code !== 0) {
      throw new Error(ran.stderr.trim() || ran.stdout.trim() || `docker ${action} failed`);
    }
  }

  async hostLogs(ref: string, tail?: number): Promise<string> {
    const id = parseDockerContainerRef(ref);
    if (!id) throw new Error("Invalid container");
    const n = parseDockerLogTail(tail);
    const ran = await this.runner.exec(this.dockerBin, [
      "logs",
      "--timestamps",
      "--tail",
      String(n),
      id,
    ]);
    if (ran.code !== 0) {
      throw new Error(ran.stderr.trim() || ran.stdout.trim() || "docker logs failed");
    }
    return `${ran.stdout}${ran.stderr}`.slice(-200_000);
  }

  async hostStats(ref: string): Promise<DockerContainerStats> {
    const id = parseDockerContainerRef(ref);
    if (!id) throw new Error("Invalid container");
    const ran = await this.runner.exec(this.dockerBin, [
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
      id,
    ]);
    if (ran.code !== 0) {
      throw new Error(ran.stderr.trim() || ran.stdout.trim() || "docker stats failed");
    }
    const stats = parseDockerStatsJson(ran.stdout);
    if (!stats) throw new Error("docker stats returned no data");
    return stats;
  }

  async swarmInfo(): Promise<DockerSwarmInfo> {
    const ran = await this.runner.exec(this.dockerBin, ["info", "--format", "{{json .Swarm}}"]);
    if (ran.code !== 0) {
      throw new Error(ran.stderr.trim() || ran.stdout.trim() || "docker info failed");
    }
    return parseDockerSwarmInfo(ran.stdout);
  }

  async listSwarmNodes(): Promise<DockerSwarmNode[]> {
    const ran = await this.swarmList(["node", "ls", "--format", "{{json .}}"]);
    return ran ? parseDockerNodeLsJson(ran) : [];
  }

  async listSwarmServices(): Promise<DockerSwarmService[]> {
    const ran = await this.swarmList(["service", "ls", "--format", "{{json .}}"]);
    return ran ? parseDockerServiceLsJson(ran) : [];
  }

  async listSwarmStacks(): Promise<DockerSwarmStack[]> {
    const ran = await this.swarmList(["stack", "ls", "--format", "{{json .}}"]);
    return ran ? parseDockerStackLsJson(ran) : [];
  }

  async listSwarmTasks(service: string): Promise<DockerSwarmTask[]> {
    const id = parseDockerSwarmRef(service);
    if (!id) throw new Error("Invalid service");
    const ran = await this.runner.exec(this.dockerBin, [
      "service",
      "ps",
      "--no-trunc",
      "--format",
      "{{json .}}",
      id,
    ]);
    if (ran.code !== 0) {
      throw new Error(ran.stderr.trim() || ran.stdout.trim() || "docker service ps failed");
    }
    return parseDockerServicePsJson(ran.stdout);
  }

  async swarmServiceLogs(ref: string, tail?: number): Promise<string> {
    const id = parseDockerSwarmRef(ref);
    if (!id) throw new Error("Invalid service");
    const n = parseDockerLogTail(tail);
    const ran = await this.runner.exec(this.dockerBin, [
      "service",
      "logs",
      "--timestamps",
      "--tail",
      String(n),
      id,
    ]);
    if (ran.code !== 0) {
      throw new Error(ran.stderr.trim() || ran.stdout.trim() || "docker service logs failed");
    }
    return `${ran.stdout}${ran.stderr}`.slice(-200_000);
  }

  async scaleSwarmService(ref: string, replicas: number): Promise<DockerSwarmService> {
    const id = parseDockerSwarmRef(ref);
    if (!id) throw new Error("Invalid service");
    const count = parseDockerSwarmReplicas(replicas);
    if (count === undefined) throw new Error("Invalid replica count");
    const scaled = await this.runner.exec(this.dockerBin, ["service", "scale", `${id}=${count}`]);
    if (scaled.code !== 0) {
      throw new Error(
        scaled.stderr.trim() || scaled.stdout.trim() || "docker service scale failed",
      );
    }
    const services = await this.listSwarmServices();
    const row = services.find((item) => matchDockerSwarmService(item, id));
    if (!row) throw new Error("Service not found");
    return row;
  }

  private async swarmList(args: string[]): Promise<string | undefined> {
    const ran = await this.runner.exec(this.dockerBin, args);
    if (ran.code === 0) return ran.stdout;
    const message = `${ran.stderr} ${ran.stdout}`.toLowerCase();
    if (message.includes("not a swarm manager") || message.includes("this node is not a swarm")) {
      return undefined;
    }
    throw new Error(ran.stderr.trim() || ran.stdout.trim() || `docker ${args[0]} failed`);
  }

  async pause(id: string): Promise<VmInstance> {
    const vm = this.require(id);
    if (vm.containerId) {
      const paused = await this.runner.exec(this.dockerBin, ["pause", vm.containerId]);
      if (paused.code !== 0) throw new Error(paused.stderr.trim() || "docker pause failed");
    }
    this.setStatus(id, "paused");
    return this.require(id);
  }

  async resume(id: string): Promise<VmInstance> {
    const vm = this.require(id);
    if (vm.containerId) {
      const unpaused = await this.runner.exec(this.dockerBin, ["unpause", vm.containerId]);
      if (unpaused.code !== 0) throw new Error(unpaused.stderr.trim() || "docker unpause failed");
    }
    this.setStatus(id, "running");
    return this.require(id);
  }

  async destroy(id: string): Promise<void> {
    const vm = this.vms.get(id);
    this.vms.delete(id);
    await this.removeContainer(id, vm?.containerId);
    this.log.delete(id);
    this.shares.delete(id);
    this.jails.delete(id);
    this.listening.delete(id);
    this.envs.delete(id);
    this.emit("status", id, "stopped");
  }

  adopt(instance: VmInstance): VmInstance {
    const vm: VmInstance = {
      ...instance,
      runtime: "docker",
      status:
        instance.status === "running" || instance.status === "booting"
          ? "stopped"
          : instance.status,
      pid: undefined,
    };
    this.vms.set(vm.id, vm);
    if (!this.log.has(vm.id)) this.log.set(vm.id, "");
    return vm;
  }

  async snapshotWorkspace(id: string, destPath: string): Promise<void> {
    const vm = this.require(id);
    await copyDir(vm.diskPath, destPath);
  }

  async restoreWorkspace(id: string, srcPath: string): Promise<void> {
    const vm = this.require(id);
    await copyDir(srcPath, vm.diskPath);
  }

  configureNetwork(id: string, jail: NetworkJail, proxyPort?: number, proxyAuth?: string): void {
    const prev = this.jails.get(id);
    this.jails.set(id, { jail, proxyPort, proxyAuth: proxyAuth ?? prev?.proxyAuth });
    const vm = this.vms.get(id);
    if (vm) vm.network = jail;
  }

  noteListeningPorts(id: string, ports: number[]): void {
    const next = this.listening.get(id) ?? new Set<number>();
    for (const port of uniquePreviewPorts(ports)) next.add(port);
    this.listening.set(id, next);
  }

  async listListeningPorts(id: string): Promise<number[]> {
    const vm = this.require(id);
    const advertised = [...(this.listening.get(id) ?? [])];
    if (!vm.containerId) return uniquePreviewPorts(advertised);
    const scanned = await this.runner.exec(this.dockerBin, [
      "exec",
      vm.containerId,
      "sh",
      "-c",
      "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null",
    ]);
    return uniquePreviewPorts([...advertised, ...parseProcNetTcp(scanned.stdout)]);
  }

  async inspectAddress(id: string): Promise<string | undefined> {
    const vm = this.require(id);
    if (!vm.containerId) return undefined;
    const inspect = await this.runner.exec(this.dockerBin, [
      "inspect",
      "-f",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      vm.containerId,
    ]);
    const host = inspect.stdout.trim();
    return host || undefined;
  }

  private collectRunEnv(vm: VmInstance): Record<string, string> {
    const env: Record<string, string> = {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "safe.directory",
      GIT_CONFIG_VALUE_0: "*",
      GIT_TERMINAL_PROMPT: "0",
      HOST: "0.0.0.0",
      HOSTNAME: "0.0.0.0",
    };
    const jail = this.jails.get(vm.id)?.jail ?? vm.network ?? "open";
    const proxyPort = this.jails.get(vm.id)?.proxyPort;
    if (jail === "restricted" && proxyPort) {
      const auth = this.jails.get(vm.id)?.proxyAuth;
      const proxy = auth
        ? `http://locus:${encodeURIComponent(auth)}@host.docker.internal:${proxyPort}`
        : `http://host.docker.internal:${proxyPort}`;
      env.HTTP_PROXY = proxy;
      env.HTTPS_PROXY = proxy;
      env.http_proxy = proxy;
      env.https_proxy = proxy;
      env.ALL_PROXY = proxy;
      env.NO_PROXY = "localhost,127.0.0.1";
    }
    const extra = this.envs.get(vm.id) ?? {};
    for (const [key, value] of Object.entries(extra)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = value;
    }
    return env;
  }

  private async withRunEnvFile<T>(
    vm: VmInstance,
    fn: (envFile: string | undefined) => Promise<T>,
  ): Promise<T> {
    const vars = this.collectRunEnv(vm);
    const keys = Object.keys(vars);
    if (!keys.length) return fn(undefined);
    const path = join(tmpdir(), `locus-docker-env-${vm.id}.env`);
    const body = Object.entries(vars)
      .map(([key, value]) => `${key}=${value.replace(/\r?\n/g, " ")}`)
      .join("\n");
    await writeFile(path, `${body}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      return await fn(path);
    } finally {
      await rm(path, { force: true }).catch(() => undefined);
    }
  }

  private runArgs(vm: VmInstance, envFile?: string): string[] {
    const image = parseDockerImage(vm.dockerImage ?? "");
    if (!image) throw new Error("Container image is missing");
    const jail = this.jails.get(vm.id)?.jail ?? vm.network ?? "open";
    const args = [
      "run",
      "-d",
      "--name",
      locusContainerName(vm.id),
      "-w",
      "/workspace",
      "-v",
      `${vm.diskPath}:/workspace`,
    ];
    if (envFile) args.push("--env-file", envFile);
    if (jail === "none") args.push("--network", "none");
    if (jail === "restricted") {
      args.push("--network", "locus-restricted", "--add-host", "host.docker.internal:host-gateway");
    }
    const share = this.shares.get(vm.id);
    if (share) args.push("-v", `${share}:/mnt/host:ro`);
    // BusyBox images (Alpine) reject `sleep infinity`; tail -f /dev/null is portable.
    args.push("--entrypoint", "tail", image, "-f", "/dev/null");
    return args;
  }

  private async ensureRestrictedNetwork(): Promise<void> {
    const inspect = await this.runner.exec(this.dockerBin, [
      "network",
      "inspect",
      "-f",
      "{{.Internal}}",
      "locus-restricted",
    ]);
    if (inspect.code === 0 && inspect.stdout.trim() === "true") return;
    if (inspect.code === 0) {
      await this.runner.exec(this.dockerBin, ["network", "rm", "locus-restricted"]);
    }
    const created = await this.runner.exec(this.dockerBin, [
      "network",
      "create",
      "--internal",
      "locus-restricted",
    ]);
    if (created.code === 0) return;
    const message = created.stderr.trim() || created.stdout.trim();
    if (/already exists/i.test(message)) return;
    throw new Error(message || "Could not create the locus-restricted Docker network");
  }

  private async applyRestrictedFirewall(vm: VmInstance): Promise<void> {
    const jail = this.jails.get(vm.id)?.jail ?? vm.network ?? "open";
    const proxyPort = this.jails.get(vm.id)?.proxyPort;
    if (jail !== "restricted" || !vm.containerId || !proxyPort) return;
    const applied = await this.runner.exec(this.dockerBin, [
      "exec",
      "--privileged",
      "-u",
      "root",
      vm.containerId,
      "sh",
      "-lc",
      restrictedEgressScript(proxyPort),
    ]);
    if (applied.stdout.includes("LOCUS_NO_IPTABLES") || applied.code !== 0) {
      throw new Error(
        "Restricted jail requires iptables in the guest image (install iptables or use an image that includes it).",
      );
    }
  }

  private setStatus(id: string, status: VmLifecycle, error?: string): void {
    const vm = this.vms.get(id);
    if (!vm) return;
    vm.status = status;
    vm.error = error;
    vm.updatedAt = now();
    this.vms.set(id, vm);
    this.pushLog(id, formatStatusLine(status, error));
    this.emitStatus(vm);
  }

  private pushLog(id: string, chunk: string): void {
    this.log.set(id, appendVmLog(this.log.get(id) ?? "", chunk));
  }

  private emitStatus(vm: VmInstance): void {
    this.emit("status", vm.id, vm.status, vm.error);
  }

  private async installGitCredentialHelper(vm: VmInstance): Promise<void> {
    if (!vm.containerId) return;
    await this.runner
      .exec(this.dockerBin, ["exec", vm.containerId, "sh", "-lc", gitCredentialInstallCommand()])
      .catch(() => undefined);
  }

  private async startCodeServer(vm: VmInstance): Promise<void> {
    if (!vm.containerId || !isLocusAgentImage(vm.dockerImage ?? "")) return;
    await this.runner.exec(this.dockerBin, [
      "exec",
      "-d",
      vm.containerId,
      "sh",
      "-lc",
      "command -v locus-code-server >/dev/null 2>&1 && { pgrep -f /usr/local/bin/code-server >/dev/null 2>&1 || exec locus-code-server; }",
    ]);
  }

  private async containerRunning(id?: string): Promise<boolean> {
    if (!id) return false;
    const inspect = await this.runner.exec(this.dockerBin, [
      "inspect",
      "-f",
      "{{.State.Running}}",
      id,
    ]);
    return inspect.code === 0 && inspect.stdout.trim() === "true";
  }

  private assertPresent(id: string): void {
    if (!this.vms.has(id)) throw new Error(`Container not found: ${id}`);
  }

  private async removeContainer(id: string, containerId?: string): Promise<void> {
    const refs = new Set<string>();
    const named = parseDockerContainerRef(locusContainerName(id));
    if (named) refs.add(named);
    const cid = containerId ? parseDockerContainerRef(containerId) : undefined;
    if (cid) refs.add(cid);
    await Promise.all(
      [...refs].map((ref) =>
        this.runner.exec(this.dockerBin, ["rm", "-f", ref]).catch(() => undefined),
      ),
    );
  }

  private require(id: string): VmInstance {
    const vm = this.vms.get(id);
    if (!vm) throw new Error(`Container not found: ${id}`);
    return vm;
  }
}

export const CONTAINER_ENGINE_CANDIDATES = ["docker", "podman", "nerdctl"] as const;

export async function resolveContainerEngine(
  runner: CommandRunner,
  preferred?: string,
): Promise<string | null> {
  const fromEnv =
    preferred?.trim() ||
    process.env.LOCUS_CONTAINER_ENGINE?.trim() ||
    process.env.LOCUS_DOCKER?.trim() ||
    "";
  const names = fromEnv
    ? [fromEnv, ...CONTAINER_ENGINE_CANDIDATES.filter((name) => name !== fromEnv)]
    : [...CONTAINER_ENGINE_CANDIDATES];
  for (const name of names) {
    const found = await runner.which(name);
    if (found) return found;
  }
  return null;
}

export async function createDockerEngine(
  dataDir: string,
  runner: CommandRunner = nodeRunner,
  preferred?: string,
): Promise<DockerEngine> {
  const dockerBin = await resolveContainerEngine(runner, preferred);
  if (!dockerBin) return new MockDockerEngine(dataDir);
  return new DockerCliEngine(dataDir, runner, dockerBin);
}
