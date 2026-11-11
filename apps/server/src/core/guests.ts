import type { AgentRuntime, GuestOs, VmInstance } from "@locus/shared";
import {
  DOCKER_WORKSPACE,
  LINUX_WORKSPACE,
  WINDOWS_WORKSPACE,
  isWindows,
  sessionRuntime,
} from "@locus/shared";
import {
  createGuestRuntime,
  HostGuestRuntime,
  type ChromiumDriver,
  type GuestRuntime,
} from "@locus/guest-agent";

export interface GuestHubOpts {
  liveQemu?: boolean;
  liveDocker?: boolean;
  identityFile?: string;
}

export class GuestHub {
  private runtimes = new Map<string, GuestRuntime>();
  private liveQemu: boolean;
  private liveDocker: boolean;
  private readonly identityFile?: string;
  private liveBrowser?: (sessionId: string) => ChromiumDriver | undefined;

  constructor(opts: GuestHubOpts = {}) {
    this.liveQemu = Boolean(opts.liveQemu);
    this.liveDocker = Boolean(opts.liveDocker);
    this.identityFile = opts.identityFile;
  }

  setLiveQemu(live: boolean): void {
    if (this.liveQemu === live) return;
    this.liveQemu = live;
    this.dropEngineRuntimes();
  }

  setLiveDocker(live: boolean): void {
    if (this.liveDocker === live) return;
    this.liveDocker = live;
    this.dropEngineRuntimes();
  }

  setLiveBrowser(factory: (sessionId: string) => ChromiumDriver | undefined): void {
    this.liveBrowser = factory;
  }

  forVm(vm: VmInstance): GuestRuntime {
    const existing = this.runtimes.get(vm.id);
    if (existing) return existing;
    const runtime = this.create(vm);
    this.runtimes.set(vm.id, runtime);
    return runtime;
  }

  forHost(
    sessionId: string,
    os: GuestOs,
    hostRoot: string,
    chromeProfileDir?: string,
  ): GuestRuntime {
    const key = `host:${sessionId}`;
    const existing = this.runtimes.get(key);
    if (existing) return existing;
    const runtime = new HostGuestRuntime(os, hostRoot, undefined, chromeProfileDir, () =>
      this.liveBrowser?.(sessionId),
    );
    this.runtimes.set(key, runtime);
    return runtime;
  }

  drop(vmId: string): void {
    this.runtimes.delete(vmId);
  }

  /** Bind a remote (LAN worker) runtime so forVm does not use local docker. */
  setRemote(vmId: string, runtime: GuestRuntime): void {
    this.runtimes.set(vmId, runtime);
  }

  private dropEngineRuntimes(): void {
    for (const id of [...this.runtimes.keys()]) {
      if (!id.startsWith("host:")) this.runtimes.delete(id);
    }
  }

  private create(vm: VmInstance): GuestRuntime {
    return createGuestRuntime(vm, {
      liveDocker: this.liveDocker,
      liveQemu: this.liveQemu,
      identityFile: this.identityFile,
    });
  }
}

export function workspacePath(os: GuestOs, runtime: AgentRuntime = "vm"): string {
  if (sessionRuntime({ runtime }) === "docker" || sessionRuntime({ runtime }) === "host")
    return DOCKER_WORKSPACE;
  return isWindows(os) ? WINDOWS_WORKSPACE : LINUX_WORKSPACE;
}
