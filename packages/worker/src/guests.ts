import type { GuestOs, VmInstance } from "@locus/shared";
import { hostChromeProfileDir } from "@locus/shared";
import { createGuestRuntime, type GuestRuntime } from "@locus/guest-agent";

export interface WorkerGuestHubOpts {
  liveDocker?: boolean;
  liveQemu?: boolean;
  dataDir?: string;
  identityFile?: string;
}

/** Docker, host-folder, and QEMU guests for locus-worker. */
export class WorkerGuestHub {
  private runtimes = new Map<string, GuestRuntime>();
  private liveDocker: boolean;
  private liveQemu: boolean;
  private readonly dataDir?: string;
  private readonly identityFile?: string;

  constructor(opts: WorkerGuestHubOpts = {}) {
    this.liveDocker = Boolean(opts.liveDocker);
    this.liveQemu = Boolean(opts.liveQemu);
    this.dataDir = opts.dataDir;
    this.identityFile = opts.identityFile;
  }

  setLiveDocker(live: boolean): void {
    if (this.liveDocker === live) return;
    this.liveDocker = live;
    for (const id of this.runtimes.keys()) this.drop(id);
  }

  setLiveQemu(live: boolean): void {
    if (this.liveQemu === live) return;
    this.liveQemu = live;
    for (const id of this.runtimes.keys()) this.drop(id);
  }

  forVm(vm: VmInstance): GuestRuntime {
    const existing = this.runtimes.get(vm.id);
    if (existing) return existing;
    const runtime = this.create(vm);
    this.runtimes.set(vm.id, runtime);
    return runtime;
  }

  private create(vm: VmInstance): GuestRuntime {
    return createGuestRuntime(vm, {
      liveDocker: this.liveDocker,
      liveQemu: this.liveQemu,
      identityFile: this.identityFile,
      hostChromeProfileDir: this.dataDir
        ? hostChromeProfileDir(this.dataDir, vm.sessionId)
        : undefined,
    });
  }

  drop(vmId: string): void {
    this.runtimes.get(vmId)?.dispose?.();
    this.runtimes.delete(vmId);
  }

  osOf(vm: VmInstance): GuestOs {
    return vm.os;
  }
}

export function isWorkerVmGuest(vm: Pick<VmInstance, "runtime" | "ssh" | "display">): boolean {
  if (vm.runtime === "docker" || vm.runtime === "host") return false;
  return vm.runtime === "vm" || Boolean(vm.ssh || vm.display);
}
