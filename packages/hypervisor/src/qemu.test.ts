import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WINDOWS_10_DEFAULT_HARDWARE,
  WINDOWS_11_DEFAULT_HARDWARE,
  OMARCHY_DEFAULT_HARDWARE,
  UBUNTU_DEFAULT_HARDWARE,
  DEFAULT_ADVANCED,
  defaultNetworking,
  type VmTemplate,
} from "@locus/shared";
import { buildQemuArgv } from "./args.js";
import { renderCloudInit } from "./cloudinit.js";
import { detectCapabilities, resolveAccelerator } from "./detect.js";
import { createHypervisor } from "./factory.js";
import { readJolietFiles } from "./iso.js";
import { isGuestDiskImage } from "./media.js";
import { executeQmp, QemuHypervisor, qemuHoldsDisk, type QemuHypervisorOptions } from "./qemu.js";
import { renderUnattend } from "./unattend.js";
import type { CommandRunner, ExecResult, SpawnedProcess } from "./runner.js";

function ubuntuTemplate(): VmTemplate {
  const t = new Date().toISOString();
  return {
    id: "ubuntu-24.04",
    name: "Ubuntu",
    os: "ubuntu",
    description: "",
    isoPath: "/isos/ubuntu.iso",
    hardware: { ...UBUNTU_DEFAULT_HARDWARE },
    networking: defaultNetworking("ubuntu", 0),
    cloudInit: {
      hostname: "locus-ubuntu",
      username: "locus",
      password: "locus",
      sshAuthorizedKeys: ["ssh-ed25519 AAAAC3"],
      packages: ["git"],
      runcmd: ["echo hi"],
    },
    createdAt: t,
    updatedAt: t,
  };
}

function windowsTemplate(): VmTemplate {
  const t = new Date().toISOString();
  return {
    id: "windows-11",
    name: "Windows 11",
    os: "windows-11",
    description: "",
    isoPath: "/isos/win11.iso",
    virtioIsoPath: "/isos/virtio.iso",
    hardware: { ...WINDOWS_11_DEFAULT_HARDWARE },
    networking: defaultNetworking("windows-11", 0),
    unattend: {
      hostname: "LOCUS-WIN",
      username: "locus",
      password: "Locus!dev1",
      locale: "en-US",
      skipOobe: true,
      enableRdp: true,
      enableWinRm: true,
      autologon: true,
    },
    createdAt: t,
    updatedAt: t,
  };
}

function omarchyTemplate(): VmTemplate {
  const t = new Date().toISOString();
  return {
    id: "omarchy-4",
    name: "Omarchy 4",
    os: "omarchy",
    description: "",
    isoPath: "/isos/omarchy.iso",
    hardware: { ...OMARCHY_DEFAULT_HARDWARE },
    networking: defaultNetworking("omarchy", 0),
    cloudInit: {
      hostname: "locus-omarchy",
      username: "locus",
      password: "locus",
      sshAuthorizedKeys: ["ssh-ed25519 AAAAC3"],
      packages: [],
      runcmd: [],
    },
    createdAt: t,
    updatedAt: t,
  };
}

describe("buildQemuArgv", () => {
  it("forwards SSH and uses VNC for Ubuntu", () => {
    const argv = buildQemuArgv(ubuntuTemplate(), {
      vmId: "abc",
      diskPath: "/data/disk.qcow2",
      isoPath: "/isos/ubuntu.iso",
      seedDir: "/data/cidata",
      qmpPort: 7100,
      serialPort: 7101,
      accelerator: "kvm",
    });
    expect(argv).toContain("-accel");
    expect(argv).toContain("kvm");
    expect(argv.join(" ")).not.toContain("accel=kvm");
    expect(argv[argv.indexOf("-machine") + 1]).toBe("q35");
    expect(argv.join(" ")).toContain("hostfwd=tcp:127.0.0.1:2200-:22");
    expect(argv.join(" ")).toContain("once=d");
    expect(argv.join(" ")).toContain("-vnc 127.0.0.1:10");
    expect(argv.join(" ")).toContain("-display none");
    expect(argv.join(" ")).toContain("qemu-xhci,id=usb");
    expect(argv.join(" ")).toContain("usb-kbd");
    expect(argv.join(" ")).toContain("usb-tablet");
    expect(argv.join(" ")).toContain("mount_tag=cidata");
    expect(argv.join(" ")).toContain("-smp 4");
    expect(argv.join(" ")).toContain("-m 4096");
  });

  it("uses virt + virtio-gpu for aarch64 Linux guests", () => {
    const argv = buildQemuArgv(ubuntuTemplate(), {
      vmId: "abc",
      diskPath: "/data/disk.qcow2",
      seedDir: "/data/cidata",
      qmpPort: 7100,
      serialPort: 7101,
      accelerator: "hvf",
      arch: "aarch64",
      ovmfCodePath: "/opt/homebrew/share/qemu/edk2-aarch64-code.fd",
      ovmfVarsCopyPath: "/data/OVMF_VARS.fd",
    });
    expect(argv[argv.indexOf("-machine") + 1]).toBe("virt,gic-version=max");
    expect(argv[argv.indexOf("-cpu") + 1]).toBe("host");
    expect(argv).toContain("virtio-gpu-pci");
    expect(argv.join(" ")).toContain("edk2-aarch64-code.fd");
  });

  it("attaches a seed ISO instead of 9p when virtfs is unavailable", () => {
    const argv = buildQemuArgv(ubuntuTemplate(), {
      vmId: "abc",
      diskPath: "/data/disk.qcow2",
      seedDir: "/data/cidata",
      seedIsoPath: "/data/cidata.iso",
      qmpPort: 7100,
      serialPort: 7101,
      accelerator: "tcg",
      hostSharePath: "/data/share",
      virtfs: false,
    });
    expect(argv.join(" ")).toContain("cidata.iso");
    expect(argv.join(" ")).not.toContain("-fsdev");
    expect(argv.join(" ")).not.toContain("mount_tag=cidata");
    expect(argv.join(" ")).not.toContain("hostshare");
  });

  it("shares a host folder over 9p", () => {
    const argv = buildQemuArgv(ubuntuTemplate(), {
      vmId: "abc",
      diskPath: "/data/disk.qcow2",
      qmpPort: 7100,
      serialPort: 7101,
      accelerator: "kvm",
      hostSharePath: "/data/share",
    });
    expect(argv.join(" ")).toContain("id=hostshare");
    expect(argv.join(" ")).toContain("mount_tag=hostshare");
    expect(argv.join(" ")).toContain("path=/data/share");
  });

  it("does not attach 9p share to Windows guests", () => {
    const argv = buildQemuArgv(windowsTemplate(), {
      vmId: "w",
      diskPath: "/data/disk.qcow2",
      isoPath: "/isos/win11.iso",
      ovmfCodePath: "/fw/CODE.fd",
      ovmfVarsCopyPath: "/fw/VARS.fd",
      swtpmSocket: "/tmp/tpm.sock",
      qmpPort: 7110,
      serialPort: 7111,
      accelerator: "kvm",
      hostSharePath: "/data/share",
    });
    expect(argv.join(" ")).not.toContain("hostshare");
    expect(argv.join(" ")).not.toContain("virtio-9p-pci,fsdev=hostshare");
  });

  it("requires OVMF for Omarchy and keeps q35 without SMM", () => {
    expect(() =>
      buildQemuArgv(omarchyTemplate(), {
        vmId: "o",
        diskPath: "/data/disk.qcow2",
        isoPath: "/isos/omarchy.iso",
        qmpPort: 7100,
        serialPort: 7101,
        accelerator: "kvm",
      }),
    ).toThrow(/OVMF firmware/);
    const argv = buildQemuArgv(omarchyTemplate(), {
      vmId: "o",
      diskPath: "/data/disk.qcow2",
      isoPath: "/isos/omarchy.iso",
      seedIsoPath: "/data/cidata.iso",
      ovmfCodePath: "/fw/CODE.fd",
      ovmfVarsCopyPath: "/fw/VARS.fd",
      qmpPort: 7100,
      serialPort: 7101,
      accelerator: "kvm",
    });
    expect(argv[argv.indexOf("-machine") + 1]).toBe("q35");
    expect(argv.join(" ")).toContain("if=pflash");
    expect(argv.join(" ")).toContain("cidata.iso");
    expect(argv.join(" ")).toContain("once=d");
    expect(argv.join(" ")).toContain("-m 8192");
  });

  it("boots Windows 10 without OVMF and still forwards RDP", () => {
    const t = new Date().toISOString();
    const template: VmTemplate = {
      id: "windows-10",
      name: "Windows 10",
      os: "windows-10",
      description: "",
      isoPath: "/isos/win10.iso",
      hardware: { ...WINDOWS_10_DEFAULT_HARDWARE },
      networking: defaultNetworking("windows-10", 0),
      unattend: {
        hostname: "LOCUS-WIN10",
        username: "locus",
        password: "Locus!dev1",
        locale: "en-US",
        skipOobe: true,
        enableRdp: true,
        enableWinRm: true,
        autologon: true,
      },
      createdAt: t,
      updatedAt: t,
    };
    const argv = buildQemuArgv(template, {
      vmId: "w10",
      diskPath: "/data/disk.qcow2",
      isoPath: "/isos/win10.iso",
      qmpPort: 7110,
      serialPort: 7111,
      accelerator: "kvm",
    });
    expect(argv.join(" ")).not.toContain("if=pflash");
    expect(argv.join(" ")).not.toContain("tpm-tis");
    expect(argv.join(" ")).toContain("hv-relaxed");
    expect(argv.join(" ")).toContain("hostfwd=tcp:127.0.0.1:2202-:3389");
  });

  it("honors CPU and memory overrides on the template", () => {
    const template = ubuntuTemplate();
    template.hardware = { ...template.hardware, cpuCores: 2, memoryMb: 2048 };
    const argv = buildQemuArgv(template, {
      vmId: "abc",
      diskPath: "/data/disk.qcow2",
      isoPath: "/isos/ubuntu.iso",
      seedDir: "/data/cidata",
      qmpPort: 7100,
      serialPort: 7101,
      accelerator: "kvm",
    });
    expect(argv.join(" ")).toContain("-smp 2");
    expect(argv.join(" ")).toContain("-m 2048");
  });

  it("requires OVMF and TPM for Windows 11", () => {
    expect(() =>
      buildQemuArgv(windowsTemplate(), {
        vmId: "w",
        diskPath: "/data/disk.qcow2",
        isoPath: "/isos/win11.iso",
        qmpPort: 7110,
        serialPort: 7111,
        accelerator: "kvm",
      }),
    ).toThrow(/OVMF/);

    const argv = buildQemuArgv(windowsTemplate(), {
      vmId: "w",
      diskPath: "/data/disk.qcow2",
      isoPath: "/isos/win11.iso",
      ovmfCodePath: "/fw/CODE.fd",
      ovmfVarsCopyPath: "/fw/VARS.fd",
      swtpmSocket: "/tmp/tpm.sock",
      virtioIsoPath: "/isos/virtio.iso",
      qmpPort: 7110,
      serialPort: 7111,
      accelerator: "kvm",
    });
    expect(argv[argv.indexOf("-machine") + 1]).toBe("q35,smm=on");
    expect(argv.join(" ")).not.toContain("accel=kvm");
    expect(argv.join(" ")).toContain("if=pflash");
    expect(argv.join(" ")).toContain("tpm-tis");
    expect(argv.join(" ")).toContain("hostfwd=tcp:127.0.0.1:2201-:22");
    expect(argv.join(" ")).toContain("hostfwd=tcp:127.0.0.1:2202-:3389");
    expect(argv.join(" ")).toContain("hostfwd=tcp:127.0.0.1:2203-:5985");
    expect(argv.join(" ")).toContain("virtio.iso");
    expect(argv.join(" ")).toContain("hv-relaxed");
    expect(argv.join(" ")).toContain("-vnc 127.0.0.1:10");
    expect(argv.join(" ")).toContain("-display none");
    expect(argv.join(" ")).toContain("qemu-xhci,id=usb");
    expect(argv.join(" ")).toContain("usb-kbd");
    expect(argv.join(" ")).toContain("usb-tablet");
    expect(argv.join(" ")).toContain("port=6010");
  });

  it("rejects QEMU drive paths that contain option separators", () => {
    expect(() =>
      buildQemuArgv(ubuntuTemplate(), {
        vmId: "abc",
        diskPath: "/data/disk.qcow2",
        isoPath: "/isos/ubuntu.iso,format=raw",
        qmpPort: 7100,
        serialPort: 7101,
        accelerator: "kvm",
      }),
    ).toThrow(/cannot be passed to QEMU/);
  });

  it("uses launch-context networking instead of the template VNC display", () => {
    const template = ubuntuTemplate();
    template.networking = { ...template.networking, vncDisplay: 1 };
    const argv = buildQemuArgv(template, {
      vmId: "abc",
      diskPath: "/data/disk.qcow2",
      isoPath: "/isos/ubuntu.iso",
      seedDir: "/data/cidata",
      qmpPort: 7100,
      serialPort: 7101,
      accelerator: "tcg",
      networking: defaultNetworking("ubuntu", 2),
    });
    expect(argv.join(" ")).toContain("-vnc 127.0.0.1:12");
    expect(argv.join(" ")).toContain("hostfwd=tcp:127.0.0.1:2220-:22");
  });

  it("restricts user-net and forwards the allowlist proxy", () => {
    const networking = { ...defaultNetworking("ubuntu", 0), restrict: true, proxyPort: 3128 };
    const argv = buildQemuArgv(ubuntuTemplate(), {
      vmId: "abc",
      diskPath: "/data/disk.qcow2",
      qmpPort: 7100,
      serialPort: 7101,
      accelerator: "tcg",
      networking,
    });
    expect(argv.join(" ")).toContain("restrict=on");
    expect(argv.join(" ")).toContain("guestfwd=tcp:10.0.2.2:3128-tcp:127.0.0.1:3128");
  });

  it("does not attach an installer CD when isoPath is omitted", () => {
    const argv = buildQemuArgv(ubuntuTemplate(), {
      vmId: "abc",
      diskPath: "/data/disk.qcow2",
      seedDir: "/data/cidata",
      qmpPort: 7100,
      serialPort: 7101,
      accelerator: "tcg",
    });
    expect(argv.join(" ")).not.toContain("once=d");
    expect(argv.join(" ")).not.toContain("media=cdrom");
  });
});

describe("seed rendering", () => {
  it("renders cloud-init with the locus user and packages", () => {
    const { userData, metaData } = renderCloudInit(ubuntuTemplate().cloudInit!);
    expect(userData).toContain('name: "locus"');
    expect(userData).toContain("git");
    expect(userData).toContain("ssh-ed25519");
    expect(userData).toContain("ssh_pwauth: false");
    expect(userData).toMatch(/passwd: "\$6\$/);
    expect(userData).not.toContain("plain_text_passwd");
    expect(userData).not.toContain('passwd: "locus"');
    expect(metaData).toContain("locus-ubuntu");
  });

  it("wraps Ubuntu ISO seeds in Subiquity autoinstall", () => {
    const { userData } = renderCloudInit(ubuntuTemplate().cloudInit!, {
      os: "ubuntu",
      autoinstall: true,
    });
    expect(userData).toContain("autoinstall:");
    expect(userData).toContain("install-server: true");
    expect(userData).toContain('username: "locus"');
    expect(userData).toMatch(/password: "\$6\$/);
    expect(userData).not.toContain(
      "$6$locussalt$5W5eQmmkWTs2oPVIAOZz/jYD4kZD9zh4QgLVO6Aq575FiNSwPuzPj81Dyq6CFGggWOcAHmnkViEqWWiYNnx.50",
    );
    expect(userData).toContain("user-data: |");
    expect(userData).toContain('name: "locus"');
    expect(userData).toContain("git");
  });

  it("does not wrap Debian or non-autoinstall Ubuntu seeds", () => {
    const debian = renderCloudInit(ubuntuTemplate().cloudInit!, {
      os: "debian",
      autoinstall: true,
    }).userData;
    expect(debian).not.toContain("autoinstall:");
    const cloudImage = renderCloudInit(ubuntuTemplate().cloudInit!, {
      os: "ubuntu",
      autoinstall: false,
    }).userData;
    expect(cloudImage).not.toContain("autoinstall:");
    const withDesktop = renderCloudInit(
      { ...ubuntuTemplate().cloudInit!, packages: ["ubuntu-desktop-minimal", "xclip"] },
      { os: "ubuntu", autoinstall: true },
    ).userData;
    expect(withDesktop).toContain("ubuntu-desktop-minimal");
    expect(withDesktop).toContain("xclip");
  });

  it("YAML-escapes cloud-init passwords so they cannot inject runcmd", () => {
    const { userData } = renderCloudInit({
      hostname: "box",
      username: "locus",
      password: 'x"\nruncmd:\n  - evil',
      sshAuthorizedKeys: [],
      packages: [],
      runcmd: [],
    });
    expect(userData).toContain("ssh_pwauth: true");
    expect(userData).toMatch(/passwd: "\$6\$/);
    expect(userData).not.toMatch(/\nruncmd:\n {2}- evil/);
    expect(userData.split("\nruncmd:").length).toBe(1);
  });

  it("renders Windows unattend with RDP, WinRM, and OpenSSH in one FirstLogonCommands block", () => {
    const xml = renderUnattend(
      {
        hostname: "BOX",
        username: "admin",
        password: 'a<b&c>"',
        locale: "en-US",
        skipOobe: true,
        enableRdp: true,
        enableWinRm: true,
        autologon: true,
      },
      "ssh-ed25519 AAAAINJECT locus@host",
    );
    expect(xml).toContain("<unattend");
    expect(xml).toContain("a&lt;b&amp;c&gt;&quot;");
    expect(xml).toContain("fDenyTSConnections");
    expect(xml).toContain("Enable-PSRemoting");
    expect(xml).toContain("AllowUnencrypted");
    expect(xml).toContain("OpenSSH.Server");
    expect(xml).toContain("ssh-ed25519 AAAAINJECT locus@host");
    expect(xml).toContain("administrators_authorized_keys");
    expect(xml).toContain("C:\\Users\\admin\\workspace");
    expect(xml).toContain("C:\\host");
    expect(xml).toContain("Git.Git");
    expect(xml).toContain("Gyan.FFmpeg");
    expect(xml).toContain("-Command &quot;");
    expect(xml).not.toContain("DefaultShell");
    expect(xml.match(/<FirstLogonCommands>/g)?.length).toBe(1);
    const start = xml.indexOf("<FirstLogonCommands>");
    const end = xml.indexOf("</FirstLogonCommands>");
    expect(xml.slice(start, end)).toContain("Enable-PSRemoting");
  });
});

describe("createHypervisor", () => {
  it("falls back to mock when qemu-img is missing", async () => {
    const runner: CommandRunner = {
      which: async () => null,
      exists: async () => false,
      exec: async () => ({ stdout: "", stderr: "", code: 1 }),
      spawn: () => {
        throw new Error("should not spawn");
      },
    };
    const bundle = await createHypervisor(
      {
        dataDir: "/tmp/locus",
        qemuBinary: "qemu-system-x86_64",
        swtpmBinary: "swtpm",
        ovmfCodePath: "",
        ovmfVarsPath: "",
        maxConcurrentVms: 4,
        defaultAcceleratorAuto: true,
        logLevel: "info",
        bindHost: "127.0.0.1",
        bindPort: 7420,
        openBrowserOnStart: true,
        hostSharePath: "",
      },
      runner,
    );
    expect(bundle.hypervisor.kind).toBe("mock");
  });
});

function fakeRunner(state: {
  spawned: string[][];
  disks: Set<string>;
  creates?: string[][];
  converts?: string[][];
  kvm?: boolean;
}): CommandRunner {
  return {
    which: async (bin) => (bin.includes("qemu") || bin === "swtpm" ? `/usr/bin/${bin}` : null),
    exists: async (path) =>
      path.endsWith(".iso") ||
      path.endsWith(".fd") ||
      path.endsWith(".img") ||
      path.endsWith(".raw") ||
      path.endsWith(".vmdk") ||
      (Boolean(state.kvm) && path === "/dev/kvm") ||
      state.disks.has(path),
    exec: async (command, args): Promise<ExecResult> => {
      if (command.includes("qemu-img") && args[0] === "create") {
        state.creates?.push(args);
        const disk = args[args.length - 2];
        if (disk) state.disks.add(disk);
        return { stdout: "", stderr: "", code: 0 };
      }
      if (command.includes("qemu-img") && args[0] === "convert") {
        state.converts?.push(args);
        return { stdout: "", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    spawn: (command, args): SpawnedProcess => {
      state.spawned.push([command, ...args]);
      const listeners: Record<string, Array<(...args: never[]) => void>> = { exit: [], error: [] };
      const stderr = new EventEmitter();
      queueMicrotask(() => stderr.emit("data", Buffer.from("QEMU: serial tcp ready\n")));
      return {
        pid: 4242,
        stderr,
        kill: () => true,
        on: (event, listener) => {
          listeners[event]?.push(listener);
        },
      } as SpawnedProcess;
    },
  };
}

async function qemuOpts(dir: string, runner: CommandRunner): Promise<QemuHypervisorOptions> {
  const caps = await detectCapabilities(runner, {
    qemuBinary: "qemu-system-x86_64",
    swtpmBinary: "swtpm",
    probeKvm: false,
  });
  return {
    dataDir: dir,
    runner,
    caps: {
      ...caps,
      qemuBinary: "/usr/bin/qemu-system-x86_64",
      qemuImgBinary: "/usr/bin/qemu-img",
    },
    qemuBinary: "/usr/bin/qemu-system-x86_64",
    qemuImgBinary: "/usr/bin/qemu-img",
    swtpmBinary: "swtpm",
    autoAccelerator: true,
  };
}

async function waitStatus(
  hv: QemuHypervisor,
  id: string,
  status: string,
  ms = 2000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (hv.get(id)?.status === status) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${status}, got ${hv.get(id)?.status}`);
}

describe("QemuHypervisor", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("creates a disk and launches QEMU for Ubuntu", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "ubuntu.iso");
    await writeFile(iso, "iso");
    const state = { spawned: [] as string[][], disks: new Set<string>() };
    const hv = new QemuHypervisor(await qemuOpts(dir, fakeRunner(state)));
    const template = ubuntuTemplate();
    template.isoPath = iso;
    const vm = await hv.create({ sessionId: "s", name: "u", template, slot: 0 });
    const started = await hv.start(vm.id);
    expect(started.pid).toBe(4242);
    expect(started.display?.port).toBe(5910);
    expect(state.spawned[0]?.[0]).toContain("qemu-system");
    expect(state.spawned[0]?.join(" ")).toContain(iso);
    expect(state.spawned[0]?.join(" ")).toContain("cidata.iso");
    expect(state.spawned[0]?.join(" ")).not.toContain("-fsdev");
    expect(state.spawned[0]?.join(" ")).toContain("once=d");
    expect(state.spawned[0]?.join(" ")).toContain(
      `-accel ${process.platform === "win32" ? "whpx" : "tcg"}`,
    );
    expect(started.ssh?.username).toBe("locus");
    const userData = await readFile(join(dir, "vms", vm.id, "cidata", "user-data"), "utf8");
    expect(userData).toContain("autoinstall:");
    const seedIso = await readFile(join(dir, "vms", vm.id, "cidata.iso"));
    expect(readJolietFiles(seedIso).files.map((f) => f.name)).toContain("user-data");
    await new Promise((r) => setTimeout(r, 20));
    expect(hv.logs(vm.id)).toMatch(/creating/);
    expect(hv.logs(vm.id)).toMatch(/booting/);
    expect(hv.logs(vm.id)).toContain("QEMU: serial tcp ready");
    const diskLog = await readFile(join(dir, "vms", vm.id, "qemu.log"), "utf8");
    expect(diskLog).toContain("booting");
    await hv.destroy(vm.id);
  });

  it("writes Omarchy cidata instead of cloud-init and attaches OVMF", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "omarchy.iso");
    const ovmfCode = join(dir, "OVMF_CODE.fd");
    const ovmfVars = join(dir, "OVMF_VARS.fd");
    await writeFile(iso, "iso");
    await writeFile(ovmfCode, "fd");
    await writeFile(ovmfVars, "fd");
    const state = { spawned: [] as string[][], disks: new Set<string>() };
    const base = await qemuOpts(dir, fakeRunner(state));
    const hv = new QemuHypervisor({
      ...base,
      caps: { ...base.caps, ovmfCodePath: ovmfCode, ovmfVarsPath: ovmfVars },
      sshPublicKey: "ssh-ed25519 AAAOMARCHY locus@host",
    });
    const template = omarchyTemplate();
    template.isoPath = iso;
    const vm = await hv.create({ sessionId: "s", name: "o", template, slot: 0 });
    const started = await hv.start(vm.id);
    expect(started.pid).toBe(4242);
    expect(state.spawned[0]?.join(" ")).toContain(iso);
    expect(state.spawned[0]?.join(" ")).toContain("cidata.iso");
    expect(state.spawned[0]?.join(" ")).toContain("if=pflash");
    expect(state.spawned[0]?.join(" ")).not.toContain("smm=on");
    const config = await readFile(
      join(dir, "vms", vm.id, "cidata", "user_configuration.json"),
      "utf8",
    );
    expect(config).toContain("full_disk");
    expect(config).not.toContain("autoinstall:");
    const keys = await readFile(join(dir, "vms", vm.id, "cidata", "authorized_keys"), "utf8");
    expect(keys).toContain("ssh-ed25519 AAAOMARCHY locus@host");
    const seedIso = await readFile(join(dir, "vms", vm.id, "cidata.iso"));
    expect(readJolietFiles(seedIso).files.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        "user_configuration.json",
        "user_credentials.json",
        "authorized_keys",
      ]),
    );
    await hv.destroy(vm.id);
  });

  it("does not pass -fsdev when the host QEMU build has virtfs disabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "ubuntu.iso");
    await writeFile(iso, "iso");
    const state = { spawned: [] as string[][], disks: new Set<string>() };
    const base = await qemuOpts(dir, fakeRunner(state));
    const hv = new QemuHypervisor({
      ...base,
      caps: { ...base.caps, hasVirtfs: false, xorrisoBinary: null },
    });
    const template = ubuntuTemplate();
    template.isoPath = iso;
    const vm = await hv.create({
      sessionId: "s",
      name: "u",
      template,
      slot: 0,
      hostSharePath: join(dir, "share"),
    });
    await hv.start(vm.id);
    const qemuArgs = state.spawned[0]?.join(" ") ?? "";
    expect(qemuArgs).toContain("cidata.iso");
    expect(qemuArgs).not.toContain("-fsdev");
    expect(qemuArgs).not.toContain("mapped-xattr");
    expect(hv.logs(vm.id)).toMatch(/Host share skipped/);
    await hv.destroy(vm.id);
  });

  it("captures guest serial into the boot log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "ubuntu.iso");
    await writeFile(iso, "iso");
    const slot = 3;
    const serialPort = 7101 + slot * 10;
    const clients: import("node:net").Socket[] = [];
    const server = createServer((sock) => clients.push(sock));
    await new Promise<void>((resolve, reject) => {
      server.listen(serialPort, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });
    try {
      const hv = new QemuHypervisor(
        await qemuOpts(dir, fakeRunner({ spawned: [], disks: new Set() })),
      );
      const template = ubuntuTemplate();
      template.isoPath = iso;
      const vm = await hv.create({ sessionId: "s", name: "u", template, slot });
      await hv.start(vm.id);
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline && clients.length === 0) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(clients.length).toBeGreaterThan(0);
      for (const c of clients) c.write("cloud-init: guest serial\n");
      const logDeadline = Date.now() + 1000;
      while (Date.now() < logDeadline && !hv.logs(vm.id).includes("guest serial")) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(hv.logs(vm.id)).toContain("cloud-init: guest serial");
      await hv.destroy(vm.id);
    } finally {
      for (const c of clients) c.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses to start without an ISO path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const hv = new QemuHypervisor(
      await qemuOpts(dir, fakeRunner({ spawned: [], disks: new Set() })),
    );
    const template = ubuntuTemplate();
    template.isoPath = "";
    const vm = await hv.create({ sessionId: "s", name: "u", template, slot: 0 });
    await expect(hv.start(vm.id)).rejects.toThrow(
      /ISO, cloud image, or golden image path is not set/,
    );
    expect(hv.get(vm.id)?.status).toBe("error");
  });

  it("injects the host SSH public key into cloud-init", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "ubuntu.iso");
    await writeFile(iso, "iso");
    const state = { spawned: [] as string[][], disks: new Set<string>() };
    const hv = new QemuHypervisor({
      ...(await qemuOpts(dir, fakeRunner(state))),
      sshPublicKey: "ssh-ed25519 AAAAINJECT locus@host",
      sshIdentityFile: "/data/ssh/id_ed25519",
    });
    const template = ubuntuTemplate();
    template.isoPath = iso;
    const vm = await hv.create({ sessionId: "s", name: "u", template, slot: 0 });
    expect(vm.ssh?.identityFile).toBe("/data/ssh/id_ed25519");
    await hv.start(vm.id);
    const userData = await readFile(join(dir, "vms", vm.id, "cidata", "user-data"), "utf8");
    expect(userData).toContain("ssh-ed25519 AAAAINJECT locus@host");
    await hv.destroy(vm.id);
  });

  it("marks the VM running when waitGuest succeeds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "ubuntu.iso");
    await writeFile(iso, "iso");
    const hv = new QemuHypervisor({
      ...(await qemuOpts(dir, fakeRunner({ spawned: [], disks: new Set() }))),
      waitGuest: async () => true,
    });
    const template = ubuntuTemplate();
    template.isoPath = iso;
    const vm = await hv.create({ sessionId: "s", name: "u", template, slot: 0 });
    await hv.start(vm.id);
    await waitStatus(hv, vm.id, "running");
    await hv.destroy(vm.id);
  });

  it("errors when waitGuest fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "ubuntu.iso");
    await writeFile(iso, "iso");
    const hv = new QemuHypervisor({
      ...(await qemuOpts(dir, fakeRunner({ spawned: [], disks: new Set() }))),
      waitGuest: async () => false,
    });
    const template = ubuntuTemplate();
    template.isoPath = iso;
    const vm = await hv.create({ sessionId: "s", name: "u", template, slot: 0 });
    await hv.start(vm.id);
    await waitStatus(hv, vm.id, "error");
    expect(hv.get(vm.id)?.error).toMatch(/did not become ready/);
    await hv.destroy(vm.id);
  });

  it("starts Windows 11 with SSH and WinRM endpoints and injects the host key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "win11.iso");
    const ovmfCode = join(dir, "OVMF_CODE.fd");
    const ovmfVars = join(dir, "OVMF_VARS.fd");
    await writeFile(iso, "iso");
    await writeFile(ovmfCode, "fd");
    await writeFile(ovmfVars, "fd");
    const state = { spawned: [] as string[][], disks: new Set<string>() };
    const base = await qemuOpts(dir, fakeRunner(state));
    const hv = new QemuHypervisor({
      ...base,
      caps: { ...base.caps, ovmfCodePath: ovmfCode, ovmfVarsPath: ovmfVars },
      sshPublicKey: "ssh-ed25519 AAAWIN locus@host",
      sshIdentityFile: "/data/ssh/id_ed25519",
      waitGuest: async (guest) => Boolean(guest.ssh && guest.winrm),
    });
    const template = windowsTemplate();
    template.isoPath = iso;
    const vm = await hv.create({ sessionId: "s", name: "w", template, slot: 0 });
    expect(vm.ssh?.port).toBe(2201);
    expect(vm.ssh?.identityFile).toBe("/data/ssh/id_ed25519");
    expect(vm.winrm?.port).toBe(2203);
    expect(vm.winrm?.username).toBe("locus");
    const started = await hv.start(vm.id);
    expect(started.pid).toBe(4242);
    const xml = await readFile(join(dir, "vms", vm.id, "unattend", "Autounattend.xml"), "utf8");
    expect(xml).toContain("ssh-ed25519 AAAWIN locus@host");
    expect(xml).toContain("OpenSSH.Server");
    await waitStatus(hv, vm.id, "running");
    await hv.destroy(vm.id);
  });

  it("boots a cloud image as a disk without an installer CD", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const image = join(dir, "ubuntu.img");
    await writeFile(image, "img");
    const state = {
      spawned: [] as string[][],
      disks: new Set<string>(),
      creates: [] as string[][],
    };
    const hv = new QemuHypervisor(await qemuOpts(dir, fakeRunner(state)));
    const template = ubuntuTemplate();
    template.isoPath = image;
    const vm = await hv.create({ sessionId: "s", name: "cloud", template, slot: 0 });
    await hv.start(vm.id);
    const qemuArgs = state.spawned[0]?.join(" ") ?? "";
    expect(qemuArgs).not.toContain("once=d");
    expect(qemuArgs).not.toContain(image);
    expect(state.creates[0]).toContain("-b");
    expect(state.creates[0]).toContain(image);
    const userData = await readFile(join(dir, "vms", vm.id, "cidata", "user-data"), "utf8");
    expect(userData).not.toContain("autoinstall:");
    await hv.destroy(vm.id);
  });

  it("boots from a golden image without an installer CD", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const golden = join(dir, "golden.qcow2");
    await writeFile(golden, "qcow");
    const state = {
      spawned: [] as string[][],
      disks: new Set<string>([golden]),
      creates: [] as string[][],
    };
    const hv = new QemuHypervisor(await qemuOpts(dir, fakeRunner(state)));
    const template = ubuntuTemplate();
    template.isoPath = "";
    const vm = await hv.create({
      sessionId: "s",
      name: "gold",
      template,
      slot: 0,
      imagePath: golden,
    });
    await hv.start(vm.id);
    const qemuArgs = state.spawned[0]?.join(" ") ?? "";
    expect(qemuArgs).not.toContain("once=d");
    expect(state.creates[0]).toContain("-b");
    expect(state.creates[0]).toContain(golden);
    await hv.destroy(vm.id);
  });

  it("adopts a persisted VM and snapshots its disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "ubuntu.iso");
    await writeFile(iso, "iso");
    const state = {
      spawned: [] as string[][],
      disks: new Set<string>(),
      creates: [] as string[][],
      converts: [] as string[][],
    };
    const hv = new QemuHypervisor(await qemuOpts(dir, fakeRunner(state)));
    const template = ubuntuTemplate();
    template.isoPath = iso;
    const vm = await hv.create({
      sessionId: "s",
      name: "u",
      template,
      slot: 0,
      hostSharePath: join(dir, "share"),
    });
    await hv.start(vm.id);
    const snapshot = join(dir, "images", "gold.qcow2");
    await hv.snapshotDisk(vm.id, snapshot);
    expect(state.converts[0]).toEqual([
      "convert",
      "-U",
      "-O",
      "qcow2",
      hv.get(vm.id)!.diskPath,
      snapshot,
    ]);
    const persisted = { ...hv.get(vm.id)! };
    const hv2 = new QemuHypervisor(await qemuOpts(dir, fakeRunner(state)));
    const restored = hv2.adopt(persisted, template, { hostSharePath: join(dir, "share") });
    expect(restored.status).toBe("stopped");
    expect(restored.slot).toBe(0);
    expect(hv2.get(restored.id)?.id).toBe(vm.id);
    await hv.destroy(vm.id);
  });

  it("does not force-share qemu-img convert after the guest stops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "ubuntu.iso");
    await writeFile(iso, "iso");
    const state = {
      spawned: [] as string[][],
      disks: new Set<string>(),
      converts: [] as string[][],
    };
    const hv = new QemuHypervisor(await qemuOpts(dir, fakeRunner(state)));
    const template = ubuntuTemplate();
    template.isoPath = iso;
    const vm = await hv.create({ sessionId: "s", name: "u", template, slot: 0 });
    await hv.start(vm.id);
    await hv.stop(vm.id);
    const snapshot = join(dir, "images", "stopped.qcow2");
    await hv.snapshotDisk(vm.id, snapshot);
    expect(state.converts[0]).toEqual([
      "convert",
      "-O",
      "qcow2",
      hv.get(vm.id)!.diskPath,
      snapshot,
    ]);
    await hv.destroy(vm.id);
  });

  it("restores a snapshot over a stopped guest disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "ubuntu.iso");
    await writeFile(iso, "iso");
    const state = {
      spawned: [] as string[][],
      disks: new Set<string>(),
      creates: [] as string[][],
    };
    const hv = new QemuHypervisor(await qemuOpts(dir, fakeRunner(state)));
    const template = ubuntuTemplate();
    template.isoPath = iso;
    const vm = await hv.create({ sessionId: "s", name: "u", template, slot: 0 });
    await hv.start(vm.id);
    const snap = join(dir, "checkpoint.qcow2");
    await writeFile(snap, "checkpoint");
    await expect(hv.restoreDisk(vm.id, snap)).rejects.toThrow(/Stop the VM/);
    await hv.stop(vm.id);
    await hv.restoreDisk(vm.id, snap);
    expect(await readFile(vm.diskPath, "utf8")).toBe("checkpoint");
    await hv.destroy(vm.id);
  });

  it("reuses an existing qcow2 and frees slots after destroy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "ubuntu.iso");
    await writeFile(iso, "iso");
    const state = {
      spawned: [] as string[][],
      disks: new Set<string>(),
      creates: [] as string[][],
    };
    const hv = new QemuHypervisor(await qemuOpts(dir, fakeRunner(state)));
    expect(hv.nextSlot()).toBe(0);
    const template = ubuntuTemplate();
    template.isoPath = iso;
    const first = await hv.create({ sessionId: "s", name: "a", template });
    expect(first.display?.port).toBe(5910);
    expect(hv.nextSlot()).toBe(1);
    const second = await hv.create({ sessionId: "s", name: "b", template });
    expect(second.display?.port).toBe(5911);
    expect(hv.nextSlot()).toBe(2);
    await hv.start(first.id);
    expect(state.creates).toHaveLength(1);
    expect(state.spawned[0]?.join(" ")).toContain("once=d");
    expect(state.spawned[0]?.join(" ")).toContain(iso);
    await hv.stop(first.id);
    await hv.start(first.id);
    expect(state.creates).toHaveLength(1);
    expect(state.spawned[1]?.join(" ")).not.toContain("once=d");
    expect(state.spawned[1]?.join(" ")).not.toContain(iso);
    const userData = await readFile(join(dir, "vms", first.id, "cidata", "user-data"), "utf8");
    expect(userData).not.toContain("autoinstall:");
    await hv.destroy(first.id);
    expect(hv.nextSlot()).toBe(0);
    await hv.destroy(second.id);
  });

  it("falls back to TCG when KVM is requested but unusable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const iso = join(dir, "ubuntu.iso");
    await writeFile(iso, "iso");
    const state = { spawned: [] as string[][], disks: new Set<string>() };
    const base = await qemuOpts(dir, fakeRunner({ ...state, kvm: true }));
    const hv = new QemuHypervisor({
      ...base,
      autoAccelerator: false,
      caps: { ...base.caps, hasKvm: true, kvmUsable: false, accelerator: "tcg" },
    });
    const template = ubuntuTemplate();
    template.isoPath = iso;
    template.hardware = { ...template.hardware, accelerator: "kvm" };
    const vm = await hv.create({ sessionId: "s", name: "u", template, slot: 0 });
    await hv.start(vm.id);
    expect(state.spawned[0]?.join(" ")).toContain("-accel tcg");
    expect(state.spawned[0]?.join(" ")).not.toContain("-accel kvm");
    await hv.destroy(vm.id);
  });

  it("refresh updates capabilities from advanced settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-qemu-"));
    dirs.push(dir);
    const hv = new QemuHypervisor(
      await qemuOpts(dir, fakeRunner({ spawned: [], disks: new Set() })),
    );
    const caps = await hv.refresh({
      ...DEFAULT_ADVANCED,
      dataDir: dir,
      defaultAcceleratorAuto: false,
    });
    expect(caps.qemuBinary).toBe("/usr/bin/qemu-system-x86_64");
    expect(caps.hasKvm).toBe(false);
    expect(caps.accelerator).toBe(process.platform === "win32" ? "whpx" : "tcg");
  });
});

describe("qemuHoldsDisk", () => {
  it("is true while QEMU still has the qcow2 open", () => {
    expect(qemuHoldsDisk("running")).toBe(true);
    expect(qemuHoldsDisk("ready")).toBe(true);
    expect(qemuHoldsDisk("paused")).toBe(true);
    expect(qemuHoldsDisk("booting")).toBe(true);
    expect(qemuHoldsDisk("installing")).toBe(true);
    expect(qemuHoldsDisk("stopped")).toBe(false);
    expect(qemuHoldsDisk("error")).toBe(false);
    expect(qemuHoldsDisk("creating")).toBe(false);
  });
});

describe("executeQmp", () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
  });

  function serveQmp(
    onCommand: (text: string, write: (line: string) => void) => void,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((sock) => {
        sock.write('{"QMP":{"version":{"qemu":{"major":8}}}}\r\n');
        sock.on("data", (buf) => {
          const text = buf.toString();
          onCommand(text, (line) => sock.write(line));
        });
      });
      servers.push(server);
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("expected TCP address"));
          return;
        }
        resolve(addr.port);
      });
    });
  }

  it("waits for the command return after negotiating capabilities", async () => {
    const received: string[] = [];
    const port = await serveQmp((text, write) => {
      received.push(text);
      if (text.includes("qmp_capabilities")) write('{"return":{}}\r\n');
      if (text.includes('"execute":"stop"')) write('{"return":{}}\r\n');
    });
    await executeQmp(port, { execute: "stop" });
    expect(received.join("")).toContain("qmp_capabilities");
    expect(received.join("")).toContain('"execute":"stop"');
  });

  it("rejects a QMP error instead of resolving early", async () => {
    const port = await serveQmp((text, write) => {
      if (text.includes("qmp_capabilities")) write('{"return":{}}\r\n');
      if (text.includes("stop"))
        write('{"error":{"class":"GenericError","desc":"Device is locked"}}\r\n');
    });
    await expect(executeQmp(port, { execute: "stop" }, 1000)).rejects.toThrow(/Device is locked/);
  });
});

describe("guest disk images and accelerators", () => {
  it("recognizes cloud disk extensions", () => {
    expect(isGuestDiskImage("/isos/ubuntu-24.04.img")).toBe(true);
    expect(isGuestDiskImage("disk.qcow2")).toBe(true);
    expect(isGuestDiskImage("disk.qcow")).toBe(true);
    expect(isGuestDiskImage("n.raw")).toBe(true);
    expect(isGuestDiskImage("g.vmdk")).toBe(true);
    expect(isGuestDiskImage("/isos/ubuntu.iso")).toBe(false);
    expect(isGuestDiskImage("")).toBe(false);
  });

  it("falls back from KVM to TCG when the device is unusable", () => {
    const caps = {
      qemuBinary: "/usr/bin/qemu-system-x86_64",
      qemuImgBinary: "/usr/bin/qemu-img",
      swtpmBinary: null,
      xorrisoBinary: null,
      accelerator: "tcg" as const,
      ovmfCodePath: null,
      ovmfVarsPath: null,
      hasKvm: true,
      kvmUsable: false,
      hasVirtfs: true,
    };
    expect(resolveAccelerator("kvm", false, caps)).toBe("tcg");
    expect(resolveAccelerator("kvm", true, caps)).toBe("tcg");
    expect(resolveAccelerator("tcg", false, { ...caps, kvmUsable: true, accelerator: "kvm" })).toBe(
      "tcg",
    );
    expect(resolveAccelerator("kvm", true, { ...caps, kvmUsable: true, accelerator: "kvm" })).toBe(
      "kvm",
    );
  });
});
