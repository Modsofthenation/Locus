import type {
  AdvancedSettings,
  DisplayEndpoint,
  GuestOs,
  SerialEndpoint,
  VmInstance,
  VmLifecycle,
  VmNetworking,
  VmTemplate,
} from "@locus/shared";
import { defaultNetworking, isLinux, isWindows, needsUefi } from "@locus/shared";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { appendFile, copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createConnection } from "node:net";
import { buildQemuArgv, displayPort, type LaunchContext } from "./args.js";
import { hostQemuArch, qemuArchForOs, type QemuGuestArch } from "./qemuArch.js";
import { writeCloudInitDir } from "./cloudinit.js";
import { writeDirectoryIso } from "./iso.js";
import { writeOmarchyCidataDir } from "./omarchy.js";
import type { HostCapabilities } from "./detect.js";
import { detectFromAdvanced, resolveAccelerator } from "./detect.js";
import { appendVmLog, formatStatusLine } from "./logs.js";
import { attachSerialLog } from "./serial.js";
import { isGuestDiskImage } from "./media.js";
import type { CommandRunner, SpawnedProcess } from "./runner.js";
import type { CreateVmRequest, Hypervisor, VmListener } from "./types.js";
import { writeUnattendDir } from "./unattend.js";

function now(): string {
  return new Date().toISOString();
}

/** QEMU keeps a write lock on the qcow2 even after `stop` (pause). */
export function qemuHoldsDisk(status: VmLifecycle): boolean {
  return (
    status === "running" ||
    status === "ready" ||
    status === "paused" ||
    status === "booting" ||
    status === "installing"
  );
}

type QmpMessage = {
  QMP?: unknown;
  return?: unknown;
  error?: { desc?: string; class?: string };
};

/** Send one QMP command and wait for its `return` (or error). */
export function executeQmp(port: number, payload: object, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host: "127.0.0.1", port });
    let buf = "";
    let phase: "greeting" | "caps" | "command" = "greeting";
    const timer = setTimeout(() => fail(new Error("QMP timed out")), timeoutMs);
    const fail = (err: Error) => {
      clearTimeout(timer);
      sock.destroy();
      reject(err);
    };
    const done = () => {
      clearTimeout(timer);
      sock.end();
      resolve();
    };
    sock.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      for (;;) {
        const nl = buf.search(/\r?\n/);
        if (nl < 0) break;
        const crlf = buf.startsWith("\r\n", nl) ? 2 : 1;
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + crlf);
        if (!line) continue;
        let msg: QmpMessage;
        try {
          msg = JSON.parse(line) as QmpMessage;
        } catch {
          continue;
        }
        if (msg.error) {
          fail(new Error(msg.error.desc || msg.error.class || "QMP error"));
          return;
        }
        if (phase === "greeting") {
          if (!msg.QMP) continue;
          phase = "caps";
          sock.write(`${JSON.stringify({ execute: "qmp_capabilities" })}\n`);
          continue;
        }
        if (!("return" in msg)) continue;
        if (phase === "caps") {
          phase = "command";
          sock.write(`${JSON.stringify(payload)}\n`);
          continue;
        }
        done();
        return;
      }
    });
    sock.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
  });
}

export interface QemuHypervisorOptions {
  dataDir: string;
  runner: CommandRunner;
  caps: HostCapabilities;
  qemuBinary: string;
  qemuImgBinary: string;
  swtpmBinary: string;
  autoAccelerator: boolean;
  sshPublicKey?: string;
  sshIdentityFile?: string;
  waitGuest?: (
    guest: {
      os: GuestOs;
      ssh?: VmInstance["ssh"];
      winrm?: VmInstance["winrm"];
    },
    signal: AbortSignal,
  ) => Promise<boolean>;
}

interface LiveVm {
  instance: VmInstance;
  process?: SpawnedProcess;
  swtpm?: SpawnedProcess;
  qmpPort: number;
  serialPort: number;
  slot: number;
  template: VmTemplate;
  networking: VmNetworking;
  readyAbort?: AbortController;
  imagePath?: string;
  hostSharePath?: string;
  log: string;
  serialAbort?: AbortController;
}

export function qemuIsoError(
  template: { os: string; isoPath: string },
  opts: { imageId?: string } = {},
): string | undefined {
  if (opts.imageId) return undefined;
  if (template.isoPath.trim()) return undefined;
  if (template.os === "ubuntu") {
    return "Ubuntu ISO or cloud image path is not set. Add it in Settings → Machines before starting a VM.";
  }
  if (template.os === "debian") {
    return "Debian ISO or cloud image path is not set. Add it in Settings → Machines before starting a VM.";
  }
  if (template.os === "omarchy") {
    return "Omarchy ISO path is not set. Fetch it in Settings → Machines before starting a VM.";
  }
  return "ISO or disk image path is not set. Add it in Settings → Machines before starting a VM.";
}

export class QemuHypervisor extends EventEmitter implements Hypervisor {
  readonly kind = "qemu" as const;
  readonly liveEngine = true;
  readonly restoreRequiresStop = true;
  readonly snapshotRequiresPause = true;
  private vms = new Map<string, LiveVm>();

  private opts: QemuHypervisorOptions;

  constructor(opts: QemuHypervisorOptions) {
    super();
    this.opts = opts;
  }

  private guestArch(os: GuestOs): QemuGuestArch {
    return qemuArchForOs(os, this.opts.caps.guestArch ?? hostQemuArch());
  }

  private qemuBinaryFor(arch: QemuGuestArch): string {
    if (arch === "aarch64") {
      return this.opts.caps.qemuAarch64Binary || this.opts.qemuBinary;
    }
    return this.opts.caps.qemuX86Binary || this.opts.qemuBinary;
  }

  isoError(
    template: { os: string; isoPath: string },
    opts?: { imageId?: string },
  ): string | undefined {
    return qemuIsoError(template, opts);
  }

  async available(): Promise<boolean> {
    return Boolean(this.opts.caps.qemuBinary && this.opts.caps.qemuImgBinary);
  }

  onStatus(listener: VmListener): void {
    this.on("status", listener);
  }

  list(): VmInstance[] {
    return [...this.vms.values()].map((v) => v.instance);
  }

  nextSlot(): number {
    const used = new Set([...this.vms.values()].map((v) => v.slot));
    let slot = 0;
    while (used.has(slot)) slot += 1;
    return slot;
  }

  async refresh(advanced: AdvancedSettings): Promise<HostCapabilities> {
    const caps = await detectFromAdvanced(this.opts.runner, advanced);
    this.opts.caps = {
      ...caps,
      qemuBinary: caps.qemuBinary ?? this.opts.qemuBinary,
      qemuImgBinary: caps.qemuImgBinary ?? this.opts.qemuImgBinary,
    };
    this.opts.qemuBinary = caps.qemuBinary ?? this.opts.qemuBinary;
    this.opts.qemuImgBinary = caps.qemuImgBinary ?? this.opts.qemuImgBinary;
    this.opts.swtpmBinary = caps.swtpmBinary ?? advanced.swtpmBinary;
    this.opts.autoAccelerator = advanced.defaultAcceleratorAuto;
    this.opts.dataDir = advanced.dataDir;
    return this.opts.caps;
  }

  get(id: string): VmInstance | undefined {
    return this.vms.get(id)?.instance;
  }

  display(id: string): DisplayEndpoint | undefined {
    return this.vms.get(id)?.instance.display;
  }

  serial(id: string): SerialEndpoint | undefined {
    return this.vms.get(id)?.instance.serial;
  }

  logs(id: string): string {
    return this.vms.get(id)?.log ?? "";
  }

  async create(req: CreateVmRequest): Promise<VmInstance> {
    const { template, sessionId, name } = req;
    const slot = req.slot ?? this.nextSlot();
    const id = randomUUID();
    const vmDir = join(this.opts.dataDir, "vms", id);
    await mkdir(vmDir, { recursive: true });
    const diskPath = join(vmDir, "disk.qcow2");
    const networking: VmNetworking = {
      ...defaultNetworking(template.os, slot),
      extraForwards: template.networking?.extraForwards ?? [],
    };
    const qmpPort = 7100 + slot * 10;
    const serialPort = 7101 + slot * 10;
    const instance: VmInstance = {
      id,
      sessionId,
      templateId: template.id,
      os: template.os,
      name,
      status: "creating",
      diskPath,
      slot,
      runtime: "vm",
      display: {
        protocol: template.hardware.display,
        host: "127.0.0.1",
        port: displayPort(networking.vncDisplay),
        websocketPort: 6080 + slot + 1,
      },
      serial: { kind: "tcp", host: "127.0.0.1", port: serialPort },
      ssh: {
        host: "127.0.0.1",
        port: networking.sshHostPort,
        username: isLinux(template.os)
          ? (template.cloudInit?.username ?? "locus")
          : (template.unattend?.username ?? "locus"),
        identityFile: this.opts.sshIdentityFile,
      },
      rdp: isWindows(template.os)
        ? {
            host: "127.0.0.1",
            port: networking.rdpHostPort,
            username: template.unattend?.username ?? "locus",
          }
        : undefined,
      winrm:
        isWindows(template.os) && template.unattend?.enableWinRm
          ? {
              host: "127.0.0.1",
              port: networking.winrmHostPort,
              username: template.unattend.username,
              password: template.unattend.password,
            }
          : undefined,
      createdAt: now(),
      updatedAt: now(),
    };
    this.vms.set(id, {
      instance,
      qmpPort,
      serialPort,
      slot,
      template,
      networking,
      imagePath: req.imagePath,
      hostSharePath: req.hostSharePath,
      log: "",
    });
    this.pushLog(this.requireLive(id), formatStatusLine("creating"));
    this.emitStatus(instance);
    return instance;
  }

  async start(id: string): Promise<VmInstance> {
    const live = this.requireLive(id);
    const { template } = live;
    if (needsUefi(template.os, template.hardware) && !this.opts.caps.ovmfCodePath) {
      this.setStatus(id, "error", "OVMF firmware not found. Set the path in Settings → Advanced.");
      throw new Error("OVMF firmware not found");
    }
    if (template.hardware.enableTpm && !this.opts.caps.swtpmBinary) {
      this.setStatus(id, "error", "swtpm not found (required for TPM 2.0).");
      throw new Error("swtpm not found");
    }
    const sourcePath = template.isoPath.trim();
    const golden = live.imagePath?.trim();
    if (!sourcePath && !golden && !(await this.opts.runner.exists(live.instance.diskPath))) {
      const message =
        "ISO, cloud image, or golden image path is not set. Add it in Settings → Machines.";
      this.setStatus(id, "error", message);
      throw new Error(message);
    }
    if (sourcePath && !(await this.opts.runner.exists(sourcePath))) {
      this.setStatus(id, "error", `Image not found: ${sourcePath}`);
      throw new Error(`Image not found: ${sourcePath}`);
    }
    if (golden && !(await this.opts.runner.exists(golden))) {
      this.setStatus(id, "error", `Golden image not found: ${golden}`);
      throw new Error(`Golden image not found: ${golden}`);
    }

    const diskImage = Boolean(golden) || isGuestDiskImage(sourcePath);
    const backing = golden || (isGuestDiskImage(sourcePath) ? sourcePath : undefined);
    const vmDir = join(this.opts.dataDir, "vms", id);
    await mkdir(vmDir, { recursive: true });
    const diskExisted = await this.opts.runner.exists(live.instance.diskPath);
    await this.ensureDisk(live.instance.diskPath, template.hardware.diskSizeGb, backing);
    const attachInstaller = Boolean(sourcePath) && !diskImage && !diskExisted;

    let seedIsoPath: string | undefined;
    let seedDir: string | undefined;
    if (isLinux(template.os) && template.cloudInit) {
      const sshAuthorizedKeys = [...template.cloudInit.sshAuthorizedKeys];
      if (this.opts.sshPublicKey && !sshAuthorizedKeys.includes(this.opts.sshPublicKey)) {
        sshAuthorizedKeys.push(this.opts.sshPublicKey);
      }
      const cloudInit = { ...template.cloudInit, sshAuthorizedKeys };
      if (template.os === "omarchy") {
        if (attachInstaller) {
          seedDir = await writeOmarchyCidataDir(join(vmDir, "cidata"), cloudInit, {
            diskSizeGb: template.hardware.diskSizeGb,
          });
          seedIsoPath = await this.makeSeedIso(seedDir, join(vmDir, "cidata.iso"), "cidata");
        }
      } else {
        const runcmd = live.networking.proxyPort
          ? [...template.cloudInit.runcmd, ...linuxProxyRuncmd()]
          : template.cloudInit.runcmd;
        seedDir = await writeCloudInitDir(
          join(vmDir, "cidata"),
          { ...cloudInit, runcmd },
          { os: template.os, autoinstall: attachInstaller && template.os === "ubuntu" },
        );
        seedIsoPath = await this.makeSeedIso(seedDir, join(vmDir, "cidata.iso"), "cidata");
      }
    }
    if (isWindows(template.os) && template.unattend) {
      const unattendDir = await writeUnattendDir(
        join(vmDir, "unattend"),
        template.unattend,
        this.opts.sshPublicKey,
      );
      seedIsoPath = await this.makeSeedIso(unattendDir, join(vmDir, "unattend.iso"), "UNATTEND");
      seedDir = unattendDir;
    }

    const arch = this.guestArch(template.os);
    const ovmfVarsSrc =
      arch === "aarch64"
        ? (this.opts.caps.ovmfAarch64VarsPath ?? this.opts.caps.ovmfVarsPath)
        : this.opts.caps.ovmfVarsPath;
    const ovmfCodeSrc =
      arch === "aarch64"
        ? (this.opts.caps.ovmfAarch64CodePath ?? this.opts.caps.ovmfCodePath)
        : this.opts.caps.ovmfCodePath;
    let ovmfVarsCopyPath: string | undefined;
    if ((needsUefi(template.os, template.hardware) || arch === "aarch64") && ovmfVarsSrc) {
      ovmfVarsCopyPath = join(vmDir, "OVMF_VARS.fd");
      await copyFile(ovmfVarsSrc, ovmfVarsCopyPath);
    }

    let swtpmSocket: string | undefined;
    let swtpmTcpPort: number | undefined;
    if (template.hardware.enableTpm && this.opts.caps.swtpmBinary) {
      const swtpmDir = join(vmDir, "tpm");
      await mkdir(swtpmDir, { recursive: true });
      const useTcp = process.platform === "win32";
      if (useTcp) {
        swtpmTcpPort = 2321 + live.slot;
        live.swtpm = this.opts.runner.spawn(this.opts.caps.swtpmBinary, [
          "socket",
          "--tpmstate",
          `dir=${swtpmDir}`,
          "--ctrl",
          `type=tcp,port=${swtpmTcpPort}`,
          "--tpm2",
          "--log",
          "level=0",
        ]);
      } else {
        swtpmSocket = join(vmDir, "swtpm.sock");
        live.swtpm = this.opts.runner.spawn(this.opts.caps.swtpmBinary, [
          "socket",
          "--tpmstate",
          `dir=${swtpmDir}`,
          "--ctrl",
          `type=unixio,path=${swtpmSocket}`,
          "--tpm2",
          "--log",
          "level=0",
        ]);
      }
    }

    const accel = resolveAccelerator(
      template.hardware.accelerator,
      this.opts.autoAccelerator,
      this.opts.caps,
    );
    if (live.hostSharePath && isLinux(template.os) && !this.opts.caps.hasVirtfs) {
      this.pushLog(live, "Host share skipped: this QEMU build has no 9p/fsdev support.\n");
    }
    const ctx: LaunchContext = {
      vmId: id,
      diskPath: live.instance.diskPath,
      isoPath: attachInstaller ? sourcePath : undefined,
      virtioIsoPath: template.virtioIsoPath || undefined,
      seedIsoPath,
      seedDir: seedIsoPath ? undefined : seedDir,
      virtfs: this.opts.caps.hasVirtfs,
      ovmfCodePath: ovmfCodeSrc ?? undefined,
      ovmfVarsCopyPath,
      arch,
      swtpmSocket,
      swtpmTcpPort,
      qmpPort: live.qmpPort,
      serialPort: live.serialPort,
      accelerator: accel,
      networking: live.networking,
      hostSharePath: live.hostSharePath,
    };
    const argv = buildQemuArgv(template, ctx);
    const child = this.opts.runner.spawn(this.qemuBinaryFor(arch), argv, { cwd: vmDir });
    live.process = child;
    live.instance.pid = child.pid;
    this.setStatus(id, "booting");

    const stderr = (child as SpawnedProcess & { stderr?: NodeJS.ReadableStream }).stderr;
    stderr?.on("data", (chunk: Buffer | string) => {
      this.pushLog(live, typeof chunk === "string" ? chunk : chunk.toString());
    });
    live.serialAbort?.abort();
    live.serialAbort = new AbortController();
    attachSerialLog({
      port: live.serialPort,
      signal: live.serialAbort.signal,
      onData: (chunk) => this.pushLog(live, chunk),
    });

    child.on("exit", (code) => {
      if (live.instance.status === "stopping" || live.instance.status === "stopped") {
        this.setStatus(id, "stopped");
        return;
      }
      const detail = live.log.trim();
      this.setStatus(
        id,
        code === 0 ? "stopped" : "error",
        code ? detail.slice(-2000) || `QEMU exited with code ${code}` : undefined,
      );
    });
    child.on("error", (err) => {
      this.setStatus(id, "error", err.message);
    });

    live.readyAbort?.abort();
    live.readyAbort = new AbortController();
    if (this.opts.waitGuest && (live.instance.ssh || live.instance.winrm)) {
      void this.waitUntilReady(id);
    } else {
      setTimeout(() => {
        if (this.vms.get(id)?.instance.status === "booting") this.setStatus(id, "running");
      }, 800);
    }

    return this.require(id);
  }

  async stop(id: string): Promise<VmInstance> {
    const live = this.requireLive(id);
    live.readyAbort?.abort();
    live.serialAbort?.abort();
    this.setStatus(id, "stopping");
    await this.qmp(live.qmpPort, { execute: "system_powerdown" }).catch(() => undefined);
    await sleep(400);
    live.process?.kill("SIGTERM");
    live.swtpm?.kill("SIGTERM");
    await sleep(200);
    live.process?.kill("SIGKILL");
    live.swtpm?.kill("SIGKILL");
    this.setStatus(id, "stopped");
    return this.require(id);
  }

  async pause(id: string): Promise<VmInstance> {
    const live = this.requireLive(id);
    await this.qmp(live.qmpPort, { execute: "stop" });
    this.setStatus(id, "paused");
    return this.require(id);
  }

  async resume(id: string): Promise<VmInstance> {
    const live = this.requireLive(id);
    await this.qmp(live.qmpPort, { execute: "cont" }).catch(() => undefined);
    this.setStatus(id, "running");
    return this.require(id);
  }

  async destroy(id: string): Promise<void> {
    this.vms.get(id)?.readyAbort?.abort();
    this.vms.get(id)?.serialAbort?.abort();
    if (this.vms.get(id)?.process) {
      await this.stop(id).catch(() => undefined);
    }
    this.vms.delete(id);
    await rm(join(this.opts.dataDir, "vms", id), { recursive: true, force: true });
    this.emit("status", id, "stopped");
  }

  adopt(
    instance: VmInstance,
    template: VmTemplate,
    extras?: { imagePath?: string; hostSharePath?: string },
  ): VmInstance {
    const existing = this.vms.get(instance.id);
    if (existing) return existing.instance;
    const slot = instance.slot ?? Math.max(0, (instance.display?.port ?? 5910) - 5910);
    const networking: VmNetworking = {
      ...defaultNetworking(template.os, slot),
      extraForwards: template.networking?.extraForwards ?? [],
    };
    if (instance.ssh?.port) networking.sshHostPort = instance.ssh.port;
    if (instance.rdp?.port) networking.rdpHostPort = instance.rdp.port;
    if (instance.winrm?.port) networking.winrmHostPort = instance.winrm.port;
    const restored: VmInstance = {
      ...instance,
      slot,
      status:
        instance.status === "running" || instance.status === "booting"
          ? "stopped"
          : instance.status,
      pid: undefined,
    };
    this.vms.set(instance.id, {
      instance: restored,
      qmpPort: 7100 + slot * 10,
      serialPort: 7101 + slot * 10,
      slot,
      template,
      networking,
      imagePath: extras?.imagePath,
      hostSharePath: extras?.hostSharePath,
      log: "",
    });
    return restored;
  }

  async snapshotDisk(id: string, destPath: string): Promise<void> {
    const live = this.requireLive(id);
    await mkdir(dirname(destPath), { recursive: true });
    // QEMU holds a write lock while the guest is live/paused. convert -U
    // (force-share) is required; without it Save golden image fails and the toast
    // comes back. Pause first so the copy is crash-consistent.
    const args = qemuHoldsDisk(live.instance.status)
      ? ["convert", "-U", "-O", "qcow2", live.instance.diskPath, destPath]
      : ["convert", "-O", "qcow2", live.instance.diskPath, destPath];
    const result = await this.opts.runner.exec(this.opts.qemuImgBinary, args);
    if (result.code !== 0) throw new Error(result.stderr.trim() || "qemu-img convert failed");
  }

  async restoreDisk(id: string, srcPath: string): Promise<void> {
    const live = this.requireLive(id);
    const status = live.instance.status;
    if (
      status === "running" ||
      status === "ready" ||
      status === "booting" ||
      status === "paused" ||
      status === "installing"
    ) {
      throw new Error("Stop the VM before restoring the disk");
    }
    await mkdir(dirname(live.instance.diskPath), { recursive: true });
    await copyFile(srcPath, live.instance.diskPath);
  }

  configureNetwork(id: string, patch: Pick<VmNetworking, "restrict" | "proxyPort">): void {
    const live = this.requireLive(id);
    live.networking = { ...live.networking, ...patch };
  }

  private async ensureDisk(diskPath: string, sizeGb: number, backingPath?: string): Promise<void> {
    if (await this.opts.runner.exists(diskPath)) return;
    const args = backingPath
      ? ["create", "-f", "qcow2", "-b", backingPath, "-F", "qcow2", diskPath, `${sizeGb}G`]
      : ["create", "-f", "qcow2", diskPath, `${sizeGb}G`];
    const result = await this.opts.runner.exec(this.opts.qemuImgBinary, args);
    if (result.code !== 0 && backingPath) {
      const retry = await this.opts.runner.exec(this.opts.qemuImgBinary, [
        "create",
        "-f",
        "qcow2",
        "-b",
        backingPath,
        diskPath,
        `${sizeGb}G`,
      ]);
      if (retry.code !== 0)
        throw new Error(retry.stderr || result.stderr || "qemu-img failed to create disk");
      return;
    }
    if (result.code !== 0) {
      throw new Error(result.stderr || "qemu-img failed to create disk");
    }
  }

  private async makeSeedIso(dir: string, outPath: string, volume: string): Promise<string> {
    const tool = this.opts.caps.xorrisoBinary;
    if (tool) {
      const args = tool.endsWith("xorriso")
        ? ["-as", "mkisofs", "-output", outPath, "-volid", volume, "-joliet", "-rock", dir]
        : ["-output", outPath, "-volid", volume, "-joliet", "-rock", dir];
      const result = await this.opts.runner.exec(tool, args);
      if (result.code === 0) return outPath;
    }
    return writeDirectoryIso(dir, outPath, volume);
  }

  private qmp(port: number, payload: object): Promise<void> {
    return executeQmp(port, payload);
  }

  private setStatus(id: string, status: VmLifecycle, error?: string): void {
    const live = this.vms.get(id);
    if (!live) return;
    live.instance.status = status;
    live.instance.error = error;
    live.instance.updatedAt = now();
    this.pushLog(live, formatStatusLine(status, error));
    this.emitStatus(live.instance);
  }

  private pushLog(live: LiveVm, chunk: string): void {
    if (!chunk) return;
    live.log = appendVmLog(live.log, chunk);
    const path = join(this.opts.dataDir, "vms", live.instance.id, "qemu.log");
    void appendFile(path, chunk).catch(() => undefined);
  }

  private async waitUntilReady(id: string): Promise<void> {
    const live = this.vms.get(id);
    if (!live || !this.opts.waitGuest) return;
    if (!live.instance.ssh && !live.instance.winrm) return;
    let ok = false;
    try {
      ok = await this.opts.waitGuest(
        { os: live.instance.os, ssh: live.instance.ssh, winrm: live.instance.winrm },
        live.readyAbort?.signal ?? new AbortController().signal,
      );
    } catch {
      ok = false;
    }
    const current = this.vms.get(id);
    if (!current || current.instance.status !== "booting") return;
    if (ok) this.setStatus(id, "running");
    else if (!current.readyAbort?.signal.aborted) {
      this.setStatus(
        id,
        "error",
        isWindows(current.instance.os)
          ? "Guest did not become ready over SSH or WinRM. Check the ISO and unattend."
          : current.instance.os === "omarchy"
            ? "Guest SSH did not become ready. Check the Omarchy ISO, OVMF firmware, and unattended cidata install."
            : "Guest SSH did not become ready. Check the ISO and cloud-init.",
      );
    }
  }

  private emitStatus(vm: VmInstance): void {
    this.emit("status", vm.id, vm.status, vm.error);
  }

  private require(id: string): VmInstance {
    return this.requireLive(id).instance;
  }

  private requireLive(id: string): LiveVm {
    const live = this.vms.get(id);
    if (!live) throw new Error(`VM not found: ${id}`);
    return live;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function linuxProxyRuncmd(): string[] {
  return [
    "printf '%s\\n' 'Acquire::http::Proxy \"http://10.0.2.2:3128/\";' 'Acquire::https::Proxy \"http://10.0.2.2:3128/\";' > /etc/apt/apt.conf.d/99locus-proxy",
    "grep -q http_proxy /etc/environment || printf '%s\\n' http_proxy=http://10.0.2.2:3128 https_proxy=http://10.0.2.2:3128 no_proxy=127.0.0.1,localhost >> /etc/environment",
  ];
}
