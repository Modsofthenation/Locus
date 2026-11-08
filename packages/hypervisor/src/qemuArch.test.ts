import { describe, expect, it } from "vitest";
import {
  hostQemuArch,
  qemuArchForOs,
  qemuArchFromBinary,
  qemuBinaryCandidates,
  qemuCpuType,
  qemuDisplayDevice,
  qemuMachineType,
  qemuTpmDevice,
} from "./qemuArch.js";

describe("qemu guest arch", () => {
  it("picks aarch64 on arm64 hosts and x86_64 elsewhere", () => {
    expect(hostQemuArch("arm64")).toBe("aarch64");
    expect(hostQemuArch("x64")).toBe("x86_64");
  });

  it("keeps Windows guests on x86_64 even on Apple Silicon", () => {
    expect(qemuArchForOs("windows-11", "aarch64")).toBe("x86_64");
    expect(qemuArchForOs("ubuntu", "aarch64")).toBe("aarch64");
  });

  it("builds virt + HVF-friendly CPU for aarch64 Linux", () => {
    expect(qemuMachineType("aarch64", "ubuntu", false)).toBe("virt,gic-version=max");
    expect(qemuCpuType("aarch64", "ubuntu", "hvf")).toBe("host");
    expect(qemuCpuType("aarch64", "ubuntu", "tcg")).toBe("cortex-a72");
    expect(qemuDisplayDevice("aarch64", false)).toBe("virtio-gpu-pci");
    expect(qemuTpmDevice("aarch64")).toBe("tpm-tis-device,tpmdev=tpm0");
  });

  it("keeps q35 for x86 guests", () => {
    expect(qemuMachineType("x86_64", "ubuntu", false)).toBe("q35");
    expect(qemuMachineType("x86_64", "windows-11", true)).toBe("q35,smm=on");
    expect(qemuArchFromBinary("/opt/homebrew/bin/qemu-system-aarch64")).toBe("aarch64");
  });

  it("prefers the native system emulator when the default x86 binary is configured", () => {
    expect(
      qemuBinaryCandidates("qemu-system-x86_64", { hostArch: "arm64", platform: "darwin" }),
    ).toEqual(["qemu-system-aarch64", "qemu-system-x86_64"]);
    expect(
      qemuBinaryCandidates("qemu-system-x86_64", { hostArch: "x64", platform: "linux" }),
    ).toEqual(["qemu-system-x86_64", "qemu-system-aarch64"]);
  });
});
