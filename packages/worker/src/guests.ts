import type { GuestOs, VmInstance } from "@locus/shared";
import { DOCKER_WORKSPACE, LINUX_WORKSPACE, hostChromeProfileDir } from "@locus/shared";
import {
  DockerGuestRuntime,
  HostGuestRuntime,
  MockGuestRuntime,
  SshGuestRuntime,
  sshTargetFromInstance,
  type GuestRuntime,
} from "@locus/guest-agent";

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
    this.runtimes.clear();
  }

  setLiveQemu(live: boolean): void {
    if (this.liveQemu === live) return;
    this.liveQemu = live;
    this.runtimes.clear();
  }

  forVm(vm: VmInstance): GuestRuntime {
    const existing = this.runtimes.get(vm.id);
    if (existing) return existing;
    const runtime = this.create(vm);
    this.runtimes.set(vm.id, runtime);
    return runtime;
  }

  private create(vm: VmInstance): GuestRuntime {
    if (vm.runtime === "host") {
      return new HostGuestRuntime(
        vm.os,
        vm.diskPath,
        undefined,
        this.dataDir ? hostChromeProfileDir(this.dataDir, vm.sessionId) : undefined,
      );
    }
    if (isWorkerVmGuest(vm)) {
      const ssh = sshTargetFromInstance(vm);
      if (this.liveQemu && ssh) {
        return new SshGuestRuntime(vm.os, {
          ...ssh,
          identityFile: ssh.identityFile ?? this.identityFile,
        });
      }
      return new MockGuestRuntime(vm.os, { cwd: LINUX_WORKSPACE });
    }
    return this.liveDocker
      ? new DockerGuestRuntime(vm)
      : new MockGuestRuntime(vm.os, { cwd: DOCKER_WORKSPACE, root: vm.diskPath });
  }

  drop(vmId: string): void {
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
