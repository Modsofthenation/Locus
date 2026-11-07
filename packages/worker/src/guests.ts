import type { GuestOs, VmInstance } from "@locus/shared";
import { DOCKER_WORKSPACE, hostChromeProfileDir } from "@locus/shared";
import {
  DockerGuestRuntime,
  HostGuestRuntime,
  MockGuestRuntime,
  type GuestRuntime,
} from "@locus/guest-agent";

export interface WorkerGuestHubOpts {
  liveDocker?: boolean;
  dataDir?: string;
}

/** Docker plus host-folder guests for locus-worker. No QEMU. */
export class WorkerGuestHub {
  private runtimes = new Map<string, GuestRuntime>();
  private liveDocker: boolean;
  private readonly dataDir?: string;

  constructor(opts: WorkerGuestHubOpts = {}) {
    this.liveDocker = Boolean(opts.liveDocker);
    this.dataDir = opts.dataDir;
  }

  setLiveDocker(live: boolean): void {
    if (this.liveDocker === live) return;
    this.liveDocker = live;
    this.runtimes.clear();
  }

  forVm(vm: VmInstance): GuestRuntime {
    const existing = this.runtimes.get(vm.id);
    if (existing) return existing;
    const runtime =
      vm.runtime === "host"
        ? new HostGuestRuntime(
            vm.os,
            vm.diskPath,
            undefined,
            this.dataDir ? hostChromeProfileDir(this.dataDir, vm.sessionId) : undefined,
          )
        : this.liveDocker
          ? new DockerGuestRuntime(vm)
          : new MockGuestRuntime(vm.os, { cwd: DOCKER_WORKSPACE, root: vm.diskPath });
    this.runtimes.set(vm.id, runtime);
    return runtime;
  }

  drop(vmId: string): void {
    this.runtimes.delete(vmId);
  }

  osOf(vm: VmInstance): GuestOs {
    return vm.os;
  }
}
