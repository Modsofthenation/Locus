import type { VmInstance } from "@locus/shared";
import { DOCKER_WORKSPACE, isWindows } from "@locus/shared";
import type { ChromiumDriver } from "./chromium.js";
import { DockerGuestRuntime } from "./docker.js";
import { HostGuestRuntime } from "./host.js";
import { MockGuestRuntime } from "./mock.js";
import { SshGuestRuntime } from "./ssh.js";
import { sshTargetFromInstance } from "./sshCli.js";
import type { GuestRuntime } from "./types.js";
import { WindowsGuestRuntime } from "./windows.js";

export type GuestFactoryOpts = {
  liveDocker?: boolean;
  liveQemu?: boolean;
  identityFile?: string;
  hostChromeProfileDir?: string;
  liveBrowser?: () => ChromiumDriver | undefined;
};

/**
 * Guest runtime factory: Docker, Host, Windows (SSH+WinRM), SSH, or mock.
 * Control-plane GuestHub and worker WorkerGuestHub are adapters on this seam.
 */
export function createGuestRuntime(vm: VmInstance, opts: GuestFactoryOpts = {}): GuestRuntime {
  if (vm.runtime === "host") {
    return new HostGuestRuntime(
      vm.os,
      vm.diskPath,
      undefined,
      opts.hostChromeProfileDir,
      opts.liveBrowser,
    );
  }
  if (vm.runtime === "docker") {
    if (opts.liveDocker) return new DockerGuestRuntime(vm);
    return new MockGuestRuntime(vm.os, { cwd: DOCKER_WORKSPACE, root: vm.diskPath });
  }
  const ssh = sshTargetFromInstance(vm);
  const sshWithIdentity = ssh
    ? { ...ssh, identityFile: ssh.identityFile ?? opts.identityFile }
    : undefined;
  if (opts.liveQemu && isWindows(vm.os) && (sshWithIdentity || vm.winrm)) {
    return new WindowsGuestRuntime({
      os: vm.os,
      ssh: sshWithIdentity,
      winrm: vm.winrm,
    });
  }
  if (opts.liveQemu && sshWithIdentity) {
    return new SshGuestRuntime(vm.os, sshWithIdentity);
  }
  return new MockGuestRuntime(vm.os);
}
