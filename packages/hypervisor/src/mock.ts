import type {
  DisplayEndpoint,
  GuestOs,
  SerialEndpoint,
  VmInstance,
  VmLifecycle,
  VmTemplate,
} from "@locus/shared";
import { defaultNetworking, isLinux, isWindows, qemuPathUnsafe } from "@locus/shared";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { CreateVmRequest, Hypervisor, VmListener } from "./types.js";
import type { HostCapabilities } from "./detect.js";
import { appendVmLog, formatStatusLine } from "./logs.js";

const BOOT_MS = 400;
const READY_MS = 900;

function now(): string {
  return new Date().toISOString();
}

function displayFor(os: GuestOs, slot: number): DisplayEndpoint {
  return {
    protocol: isWindows(os) ? "spice" : "vnc",
    host: "127.0.0.1",
    port: 5900 + slot + 10,
    websocketPort: 6080 + slot + 1,
  };
}

function serialFor(id: string): SerialEndpoint {
  return { kind: "tcp", host: "127.0.0.1", port: 0, path: `mock-serial:${id}` };
}

/**
 * In-process hypervisor used when QEMU is not installed.
 * Advances through creating → booting → ready → running so the UI and
 * session lifecycle can be developed without real VMs.
 */
export class MockHypervisor extends EventEmitter implements Hypervisor {
  readonly kind = "mock" as const;
  readonly liveEngine = false;
  private vms = new Map<string, VmInstance>();
  private timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  private slots = new Map<string, number>();
  private log = new Map<string, string>();

  constructor(private readonly dataDir: string) {
    super();
  }

  async available(): Promise<boolean> {
    return true;
  }

  onStatus(listener: VmListener): void {
    this.on("status", listener);
  }

  list(): VmInstance[] {
    return [...this.vms.values()];
  }

  nextSlot(): number {
    const used = new Set(this.slots.values());
    let slot = 0;
    while (used.has(slot)) slot += 1;
    return slot;
  }

  async refresh(): Promise<HostCapabilities> {
    return {
      qemuBinary: null,
      qemuImgBinary: null,
      swtpmBinary: null,
      xorrisoBinary: null,
      accelerator: "tcg",
      ovmfCodePath: null,
      ovmfVarsPath: null,
      hasKvm: false,
      kvmUsable: false,
      hasVirtfs: false,
    };
  }

  get(id: string): VmInstance | undefined {
    return this.vms.get(id);
  }

  display(id: string): DisplayEndpoint | undefined {
    return this.vms.get(id)?.display;
  }

  serial(id: string): SerialEndpoint | undefined {
    return this.vms.get(id)?.serial;
  }

  logs(id: string): string {
    return this.log.get(id) ?? "";
  }

  async create(req: CreateVmRequest): Promise<VmInstance> {
    const { template, sessionId, name } = req;
    const slot = req.slot ?? this.nextSlot();
    const id = randomUUID();
    const networking = {
      ...defaultNetworking(template.os, slot),
      extraForwards: template.networking?.extraForwards ?? [],
    };
    const vm: VmInstance = {
      id,
      sessionId,
      templateId: template.id,
      os: template.os,
      name,
      status: "creating",
      diskPath: `${this.dataDir}/disks/${id}.qcow2`,
      slot,
      display: displayFor(template.os, slot),
      serial: serialFor(id),
      ssh: isLinux(template.os)
        ? {
            host: "127.0.0.1",
            port: networking.sshHostPort,
            username: template.cloudInit?.username ?? "locus",
          }
        : undefined,
      rdp: isWindows(template.os)
        ? {
            host: "127.0.0.1",
            port: networking.rdpHostPort,
            username: template.unattend?.username ?? "locus",
          }
        : undefined,
      createdAt: now(),
      updatedAt: now(),
    };
    this.vms.set(id, vm);
    this.slots.set(id, slot);
    this.pushLog(id, formatStatusLine("creating"));
    this.emitStatus(vm);
    return vm;
  }

  async start(id: string): Promise<VmInstance> {
    this.clearTimers(id);
    this.setStatus(id, "booting");
    const t1 = setTimeout(() => this.setStatus(id, "ready"), BOOT_MS);
    const t2 = setTimeout(() => this.setStatus(id, "running", undefined, 4242), READY_MS);
    this.timers.set(id, [t1, t2]);
    return this.require(id);
  }

  async stop(id: string): Promise<VmInstance> {
    this.clearTimers(id);
    this.setStatus(id, "stopping");
    const t = setTimeout(() => this.setStatus(id, "stopped"), 200);
    this.timers.set(id, [t]);
    return this.require(id);
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
    this.slots.delete(id);
    this.log.delete(id);
    this.emit("status", id, "stopped");
  }

  configureNetwork(_id: string, _patch: { restrict?: boolean; proxyPort?: number }): void {
    /* mock guests do not route packets */
  }

  adopt(
    instance: VmInstance,
    _template: import("@locus/shared").VmTemplate,
    _extras?: { imagePath?: string; hostSharePath?: string },
  ): VmInstance {
    const slot = instance.slot ?? this.nextSlot();
    const vm: VmInstance = {
      ...instance,
      slot,
      status:
        instance.status === "running" || instance.status === "booting"
          ? "stopped"
          : instance.status,
      pid: undefined,
    };
    this.vms.set(vm.id, vm);
    this.slots.set(vm.id, slot);
    if (!this.log.has(vm.id)) this.log.set(vm.id, "");
    return vm;
  }

  async snapshotDisk(id: string, destPath: string): Promise<void> {
    const vm = this.require(id);
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, `mock-snapshot:${vm.id}`, "utf8");
  }

  async restoreDisk(id: string, srcPath: string): Promise<void> {
    const vm = this.require(id);
    const { mkdir, copyFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(vm.diskPath), { recursive: true });
    await copyFile(srcPath, vm.diskPath);
  }

  /** Instantly mark running — used by tests. */
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
    if (!vm) throw new Error(`VM not found: ${id}`);
    return vm;
  }

  private clearTimers(id: string): void {
    for (const t of this.timers.get(id) ?? []) clearTimeout(t);
    this.timers.delete(id);
  }
}

export function validateTemplate(template: VmTemplate): string[] {
  const errors: string[] = [];
  if (!template.name.trim()) errors.push("Template name is required");
  if (template.hardware.cpuCores < 1) errors.push("At least 1 CPU core is required");
  if (template.hardware.memoryMb < 512) errors.push("Memory must be at least 512 MB");
  if (template.hardware.diskSizeGb < 8) errors.push("Disk must be at least 8 GB");
  if (template.os === "windows-10" && template.hardware.memoryMb < 2048) {
    errors.push("Windows 10 requires at least 2048 MB of RAM");
  }
  if (template.os === "windows-11" && template.hardware.memoryMb < 4096) {
    errors.push("Windows 11 requires at least 4096 MB of RAM");
  }
  if (template.os === "windows-11" && !template.hardware.enableTpm) {
    errors.push("Windows 11 requires TPM 2.0");
  }
  if (qemuPathUnsafe(template.isoPath) || qemuPathUnsafe(template.virtioIsoPath ?? "")) {
    errors.push("ISO path contains characters that cannot be passed to QEMU");
  }
  return errors;
}
