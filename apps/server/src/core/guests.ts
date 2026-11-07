import type { AgentRuntime, GuestOs, VmInstance } from "@locus/shared";
import {
  DOCKER_WORKSPACE,
  LINUX_WORKSPACE,
  WINDOWS_WORKSPACE,
  isWindows,
  sessionRuntime,
} from "@locus/shared";
import {
  DockerGuestRuntime,
  HostGuestRuntime,
  MockGuestRuntime,
  SshGuestRuntime,
  WindowsGuestRuntime,
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
    if (vm.runtime === "docker") {
      if (this.liveDocker) {
        return new DockerGuestRuntime(vm);
      }
      return new MockGuestRuntime(vm.os, { cwd: DOCKER_WORKSPACE, root: vm.diskPath });
    }
    if (this.liveQemu && isWindows(vm.os) && (vm.ssh || vm.winrm)) {
      return new WindowsGuestRuntime({
        os: vm.os,
        ssh: vm.ssh
          ? {
              host: vm.ssh.host,
              port: vm.ssh.port,
              username: vm.ssh.username,
              identityFile: vm.ssh.identityFile ?? this.identityFile,
            }
          : undefined,
        winrm: vm.winrm,
      });
    }
    if (this.liveQemu && vm.ssh) {
      return new SshGuestRuntime(vm.os, {
        host: vm.ssh.host,
        port: vm.ssh.port,
        username: vm.ssh.username,
        identityFile: vm.ssh.identityFile ?? this.identityFile,
      });
    }
    return new MockGuestRuntime(vm.os);
  }
}

export function workspacePath(os: GuestOs, runtime: AgentRuntime = "vm"): string {
  if (sessionRuntime({ runtime }) === "docker" || sessionRuntime({ runtime }) === "host")
    return DOCKER_WORKSPACE;
  return isWindows(os) ? WINDOWS_WORKSPACE : LINUX_WORKSPACE;
}
