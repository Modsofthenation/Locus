import type { Accelerator, GuestOs, VmNetworking, VmTemplate } from "@locus/shared";
import { defaultNetworking, isLinux, isWindows, needsUefi, qemuPathUnsafe } from "@locus/shared";

export interface LaunchContext {
  vmId: string;
  diskPath: string;
  isoPath?: string;
  virtioIsoPath?: string;
  seedIsoPath?: string;
  seedDir?: string;
  ovmfCodePath?: string;
  ovmfVarsCopyPath?: string;
  swtpmSocket?: string;
  swtpmTcpPort?: number;
  qmpPort: number;
  serialPort: number;
  accelerator: Accelerator;
  networking?: VmNetworking;
  hostSharePath?: string;
  virtfs?: boolean;
}

export function buildQemuArgv(template: VmTemplate, ctx: LaunchContext): string[] {
  const hw = template.hardware;
  const net: VmNetworking = ctx.networking ?? {
    ...defaultNetworking(template.os, 0),
    ...template.networking,
  };
  const accel = ctx.accelerator;
  const args: string[] = [
    "-name",
    `locus-${ctx.vmId}`,
    "-machine",
    machineType(template.os, hw.enableSecureBoot),
    "-accel",
    accel,
    "-cpu",
    cpuType(template.os, accel),
    "-smp",
    String(hw.cpuCores),
    "-m",
    String(hw.memoryMb),
    "-device",
    "virtio-balloon",
    "-qmp",
    `tcp:127.0.0.1:${ctx.qmpPort},server,nowait`,
    "-serial",
    `tcp:127.0.0.1:${ctx.serialPort},server,nowait`,
    "-netdev",
    netdev(template.os, net),
    "-device",
    "virtio-net-pci,netdev=net0",
    "-drive",
    `file=${driveFile(ctx.diskPath)},if=virtio,format=qcow2,discard=unmap`,
  ];

  args.push("-display", "none");
  args.push("-vnc", `127.0.0.1:${net.vncDisplay}`);
  if (hw.display === "spice") {
    args.push("-spice", `addr=127.0.0.1,port=${spicePort(net.vncDisplay)},disable-ticketing=on`);
    args.push("-device", "qxl-vga");
  } else {
    args.push("-device", "virtio-vga");
  }
  // -nodefaults drops QEMU's USB tablet. VNC/SPICE need an absolute pointer
  // (and a keyboard) — PS/2 alone is unreliable on Windows guests and WHPX.
  args.push("-device", "qemu-xhci,id=usb", "-device", "usb-kbd", "-device", "usb-tablet");

  if (ctx.isoPath) {
    args.push("-drive", `file=${driveFile(ctx.isoPath)},media=cdrom,readonly=on,index=2`);
    args.push("-boot", "order=cd,once=d,menu=on");
  }

  if (ctx.virtioIsoPath) {
    args.push("-drive", `file=${driveFile(ctx.virtioIsoPath)},media=cdrom,readonly=on,index=3`);
  }

  if (ctx.seedIsoPath) {
    args.push("-drive", `file=${driveFile(ctx.seedIsoPath)},media=cdrom,readonly=on,index=1`);
  } else if (ctx.seedDir && isLinux(template.os) && ctx.virtfs !== false) {
    args.push(
      "-fsdev",
      `local,id=cidata,path=${driveFile(ctx.seedDir)},security_model=${fsdevSecurity()}`,
      "-device",
      "virtio-9p-pci,fsdev=cidata,mount_tag=cidata",
    );
  }

  if (ctx.hostSharePath && isLinux(template.os) && ctx.virtfs !== false) {
    args.push(
      "-fsdev",
      `local,id=hostshare,path=${driveFile(ctx.hostSharePath)},security_model=${fsdevSecurity()}`,
      "-device",
      "virtio-9p-pci,fsdev=hostshare,mount_tag=hostshare",
    );
  }

  if (needsUefi(template.os, template.hardware)) {
    if (!ctx.ovmfCodePath || !ctx.ovmfVarsCopyPath) {
      throw new Error("This guest requires OVMF firmware (code + vars)");
    }
    args.push(
      "-drive",
      `if=pflash,format=raw,readonly=on,file=${driveFile(ctx.ovmfCodePath)}`,
      "-drive",
      `if=pflash,format=raw,file=${driveFile(ctx.ovmfVarsCopyPath)}`,
    );
  }

  if (hw.enableTpm) {
    if (!ctx.swtpmSocket && !ctx.swtpmTcpPort) throw new Error("Windows 11 TPM requires swtpm");
    const chardev = ctx.swtpmTcpPort
      ? `socket,id=chrtpm,host=127.0.0.1,port=${ctx.swtpmTcpPort}`
      : `socket,id=chrtpm,path=${ctx.swtpmSocket}`;
    args.push(
      "-chardev",
      chardev,
      "-tpmdev",
      "emulator,id=tpm0,chardev=chrtpm",
      "-device",
      "tpm-tis,tpmdev=tpm0",
    );
  }

  args.push("-nodefaults");
  return args;
}

function machineType(os: GuestOs, secureBoot: boolean): string {
  if (os === "windows-11" || secureBoot) {
    return "q35,smm=on";
  }
  return "q35";
}

function cpuType(os: GuestOs, accel: Accelerator): string {
  if (isWindows(os)) {
    const base = accel === "tcg" ? "qemu64" : "host";
    return `${base},hv-relaxed,hv-vapic,hv-spinlocks=0x1fff,hv-time`;
  }
  return accel === "tcg" ? "qemu64" : "host";
}

function netdev(os: GuestOs, net: VmNetworking): string {
  const fwds: string[] = [];
  if (net.sshHostPort) fwds.push(hostfwd("tcp", net.sshHostPort, 22));
  if (isWindows(os) && net.rdpHostPort) fwds.push(hostfwd("tcp", net.rdpHostPort, 3389));
  if (isWindows(os) && net.winrmHostPort) fwds.push(hostfwd("tcp", net.winrmHostPort, 5985));
  for (const extra of net.extraForwards) {
    if (extra.proto !== "tcp" && extra.proto !== "udp") continue;
    if (!Number.isInteger(extra.hostPort) || !Number.isInteger(extra.guestPort)) continue;
    if (extra.hostPort < 1 || extra.guestPort < 1) continue;
    fwds.push(hostfwd(extra.proto, extra.hostPort, extra.guestPort));
  }
  const parts = ["user", "id=net0", ...fwds];
  if (net.restrict) parts.push("restrict=on");
  if (net.proxyPort) parts.push(`guestfwd=tcp:10.0.2.2:3128-tcp:127.0.0.1:${net.proxyPort}`);
  return parts.join(",");
}

function hostfwd(proto: "tcp" | "udp", hostPort: number, guestPort: number): string {
  return `hostfwd=${proto}:127.0.0.1:${hostPort}-:${guestPort}`;
}

function fsdevSecurity(): string {
  return process.platform === "win32" ? "mapped-file" : "mapped-xattr";
}

function driveFile(path: string): string {
  if (qemuPathUnsafe(path)) {
    throw new Error("Path contains characters that cannot be passed to QEMU");
  }
  return path;
}

export function displayPort(vncDisplay: number): number {
  return 5900 + vncDisplay;
}

export function spicePort(vncDisplay: number): number {
  return 5900 + vncDisplay + 100;
}
