import type { Accelerator, GuestOs } from "@locus/shared";
import { isWindows } from "@locus/shared";

export type QemuGuestArch = "x86_64" | "aarch64";

export function hostQemuArch(arch: string = process.arch): QemuGuestArch {
  return arch === "arm64" ? "aarch64" : "x86_64";
}

export function qemuArchFromBinary(binary: string | null | undefined): QemuGuestArch | undefined {
  const name = (binary ?? "").toLowerCase();
  if (name.includes("aarch64") || name.includes("arm64")) return "aarch64";
  if (name.includes("x86_64") || name.includes("amd64")) return "x86_64";
  return undefined;
}

/** Windows installer ISOs in this tree are amd64. Linux guests follow the host. */
export function qemuArchForOs(os: GuestOs, hostArch: QemuGuestArch): QemuGuestArch {
  if (isWindows(os)) return "x86_64";
  return hostArch;
}

export function qemuMachineType(arch: QemuGuestArch, os: GuestOs, secureBoot: boolean): string {
  if (arch === "aarch64") return "virt,gic-version=max";
  if (os === "windows-11" || secureBoot) return "q35,smm=on";
  return "q35";
}

export function qemuCpuType(arch: QemuGuestArch, os: GuestOs, accel: Accelerator): string {
  if (arch === "aarch64") return accel === "tcg" ? "cortex-a72" : "host";
  if (isWindows(os)) {
    const base = accel === "tcg" ? "qemu64" : "host";
    return `${base},hv-relaxed,hv-vapic,hv-spinlocks=0x1fff,hv-time`;
  }
  return accel === "tcg" ? "qemu64" : "host";
}

export function qemuTpmDevice(arch: QemuGuestArch): string {
  return arch === "aarch64" ? "tpm-tis-device,tpmdev=tpm0" : "tpm-tis,tpmdev=tpm0";
}

export function qemuDisplayDevice(arch: QemuGuestArch, spice: boolean): string {
  if (arch === "aarch64") return "virtio-gpu-pci";
  return spice ? "qxl-vga" : "virtio-vga";
}

export function qemuBinaryCandidates(
  preferred: string,
  opts: { platform?: string; hostArch?: string } = {},
): string[] {
  const platform = opts.platform ?? process.platform;
  const hostArch = opts.hostArch ?? process.arch;
  const native = hostArch === "arm64" ? "qemu-system-aarch64" : "qemu-system-x86_64";
  const emulated = native === "qemu-system-aarch64" ? "qemu-system-x86_64" : "qemu-system-aarch64";
  const explicit =
    preferred && preferred !== "qemu-system-x86_64" && preferred !== "qemu-system-aarch64";
  const names = explicit ? [preferred, native, emulated] : [native, emulated];
  if (platform === "win32") {
    return names.flatMap((name) => [name, `${name}.exe`]);
  }
  return names;
}
