import type { AdvancedSettings } from "@locus/shared";
import { detectCapabilities, type HostCapabilities } from "./detect.js";
import { MockHypervisor } from "./mock.js";
import { QemuHypervisor, type QemuHypervisorOptions } from "./qemu.js";
import { nodeRunner, type CommandRunner } from "./runner.js";
import type { Hypervisor } from "./types.js";

export interface HypervisorBundle {
  hypervisor: Hypervisor;
  capabilities: HostCapabilities;
}

export async function createHypervisor(
  advanced: AdvancedSettings,
  runner: CommandRunner = nodeRunner,
  ssh?: Pick<QemuHypervisorOptions, "sshPublicKey" | "sshIdentityFile" | "waitGuest">,
): Promise<HypervisorBundle> {
  const caps = await detectCapabilities(runner, {
    qemuBinary: advanced.qemuBinary,
    swtpmBinary: advanced.swtpmBinary,
    ovmfCodePath: advanced.ovmfCodePath || undefined,
    ovmfVarsPath: advanced.ovmfVarsPath || undefined,
    probeKvm: true,
  });
  if (!caps.qemuBinary || !caps.qemuImgBinary) {
    return { hypervisor: new MockHypervisor(advanced.dataDir), capabilities: caps };
  }
  return {
    hypervisor: new QemuHypervisor({
      dataDir: advanced.dataDir,
      runner,
      caps: { ...caps, qemuBinary: caps.qemuBinary, qemuImgBinary: caps.qemuImgBinary },
      qemuBinary: caps.qemuBinary,
      qemuImgBinary: caps.qemuImgBinary,
      swtpmBinary: caps.swtpmBinary ?? advanced.swtpmBinary,
      autoAccelerator: advanced.defaultAcceleratorAuto,
      sshPublicKey: ssh?.sshPublicKey,
      sshIdentityFile: ssh?.sshIdentityFile,
      waitGuest: ssh?.waitGuest,
    }),
    capabilities: caps,
  };
}
