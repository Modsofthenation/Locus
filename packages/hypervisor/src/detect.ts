import { createConnection } from "node:net";
import { join } from "node:path";
import type { Accelerator, AdvancedSettings } from "@locus/shared";
import type { CommandRunner } from "./runner.js";

export interface HostCapabilities {
  qemuBinary: string | null;
  qemuImgBinary: string | null;
  swtpmBinary: string | null;
  xorrisoBinary: string | null;
  accelerator: Accelerator;
  ovmfCodePath: string | null;
  ovmfVarsPath: string | null;
  hasKvm: boolean;
  kvmUsable: boolean;
  hasVirtfs: boolean;
}

const OVMF_CODE_CANDIDATES = [
  "/usr/share/OVMF/OVMF_CODE.fd",
  "/usr/share/OVMF/OVMF_CODE_4M.fd",
  "/usr/share/edk2/ovmf/OVMF_CODE.fd",
  "/usr/share/edk2/x64/OVMF_CODE.4m.fd",
  "/usr/share/edk2-ovmf/x64/OVMF_CODE.fd",
  "/usr/share/edk2-ovmf/x64/OVMF_CODE.4m.fd",
  "/usr/share/qemu/OVMF_CODE.fd",
  "/opt/homebrew/share/qemu/edk2-x86_64-code.fd",
  "/usr/local/share/qemu/edk2-x86_64-code.fd",
];

const OVMF_VARS_CANDIDATES = [
  "/usr/share/OVMF/OVMF_VARS.fd",
  "/usr/share/OVMF/OVMF_VARS_4M.fd",
  "/usr/share/edk2/ovmf/OVMF_VARS.fd",
  "/usr/share/edk2/x64/OVMF_VARS.4m.fd",
  "/usr/share/edk2-ovmf/x64/OVMF_VARS.fd",
  "/usr/share/edk2-ovmf/x64/OVMF_VARS.4m.fd",
  "/usr/share/qemu/OVMF_VARS.fd",
  "/opt/homebrew/share/qemu/edk2-i386-vars.fd",
  "/usr/local/share/qemu/edk2-i386-vars.fd",
];

export function knownQemuDirs(platform: string = process.platform): string[] {
  if (platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA;
    return [`${pf}\\qemu`, `${pf86}\\qemu`, local ? `${local}\\Programs\\qemu` : ""].filter(
      Boolean,
    );
  }
  if (platform === "darwin") return ["/opt/homebrew/bin", "/usr/local/bin"];
  return ["/usr/bin", "/usr/local/bin"];
}

export function prependPath(dir: string, platform: string = process.platform): void {
  const sep = platform === "win32" ? ";" : ":";
  const current = process.env.PATH ?? "";
  if (current.split(sep).includes(dir)) return;
  process.env.PATH = current ? `${dir}${sep}${current}` : dir;
}

function joinBin(dir: string, name: string, platform: string): string {
  if (platform === "win32") {
    return `${dir.replace(/[\\/]+$/, "")}\\${name}`;
  }
  return join(dir, name);
}

async function firstExisting(paths: string[], runner: CommandRunner): Promise<string | null> {
  for (const path of paths) {
    if (await runner.exists(path)) return path;
  }
  return null;
}

async function resolveBinary(
  runner: CommandRunner,
  names: string[],
  dirs: string[],
  platform: string = process.platform,
): Promise<string | null> {
  for (const name of names) {
    const found = await runner.which(name);
    if (found) return found;
  }
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = joinBin(dir, name, platform);
      if (await runner.exists(candidate)) {
        prependPath(dir, platform);
        return candidate;
      }
    }
  }
  return null;
}

function firmwareCandidates(platform: string = process.platform): {
  code: string[];
  vars: string[];
} {
  const extraCode: string[] = [];
  const extraVars: string[] = [];
  for (const dir of knownQemuDirs(platform)) {
    extraCode.push(
      joinBin(
        dir,
        platform === "win32" ? "share\\edk2-x86_64-code.fd" : "share/edk2-x86_64-code.fd",
        platform,
      ),
      joinBin(
        dir,
        platform === "win32"
          ? "share\\qemu\\edk2-x86_64-code.fd"
          : "share/qemu/edk2-x86_64-code.fd",
        platform,
      ),
    );
    extraVars.push(
      joinBin(
        dir,
        platform === "win32" ? "share\\edk2-i386-vars.fd" : "share/edk2-i386-vars.fd",
        platform,
      ),
      joinBin(
        dir,
        platform === "win32" ? "share\\qemu\\edk2-i386-vars.fd" : "share/qemu/edk2-i386-vars.fd",
        platform,
      ),
    );
  }
  return {
    code: [...OVMF_CODE_CANDIDATES, ...extraCode],
    vars: [...OVMF_VARS_CANDIDATES, ...extraVars],
  };
}

export async function detectCapabilities(
  runner: CommandRunner,
  opts: {
    qemuBinary: string;
    swtpmBinary: string;
    ovmfCodePath?: string;
    ovmfVarsPath?: string;
    probeKvm?: boolean;
    platform?: string;
  },
): Promise<HostCapabilities> {
  const platform = opts.platform ?? process.platform;
  const dirs = knownQemuDirs(platform);
  const qemuNames =
    platform === "win32"
      ? [opts.qemuBinary, `${opts.qemuBinary}.exe`, "qemu-system-x86_64.exe"]
      : [opts.qemuBinary];
  const qemuBinary = await resolveBinary(runner, qemuNames, dirs, platform);
  const qemuImgBinary = await resolveBinary(
    runner,
    platform === "win32" ? ["qemu-img", "qemu-img.exe"] : ["qemu-img"],
    dirs,
    platform,
  );
  const swtpmBinary = await resolveBinary(
    runner,
    platform === "win32" ? [opts.swtpmBinary, `${opts.swtpmBinary}.exe`] : [opts.swtpmBinary],
    dirs,
    platform,
  );
  const xorrisoBinary =
    (await runner.which("xorriso")) ??
    (await runner.which("genisoimage")) ??
    (await runner.which("mkisofs"));

  const hasKvm = await runner.exists("/dev/kvm");
  const kvmUsable =
    hasKvm && qemuBinary && opts.probeKvm !== false
      ? await probeKvm(runner, qemuBinary)
      : hasKvm && Boolean(qemuBinary);
  const hasVirtfs = qemuBinary ? await probeVirtfs(runner, qemuBinary) : false;

  const accelerator: Accelerator = optsPreferred(hasKvm && kvmUsable, platform);
  const firmware = firmwareCandidates(platform);

  const ovmfCodePath =
    (opts.ovmfCodePath && (await runner.exists(opts.ovmfCodePath)) ? opts.ovmfCodePath : null) ??
    (await firstExisting(firmware.code, runner));
  const ovmfVarsPath =
    (opts.ovmfVarsPath && (await runner.exists(opts.ovmfVarsPath)) ? opts.ovmfVarsPath : null) ??
    (await firstExisting(firmware.vars, runner));

  return {
    qemuBinary,
    qemuImgBinary,
    swtpmBinary,
    xorrisoBinary,
    accelerator,
    ovmfCodePath,
    ovmfVarsPath,
    hasKvm,
    kvmUsable: Boolean(kvmUsable),
    hasVirtfs,
  };
}

export async function detectFromAdvanced(
  runner: CommandRunner,
  advanced: AdvancedSettings,
): Promise<HostCapabilities> {
  return detectCapabilities(runner, {
    qemuBinary: advanced.qemuBinary,
    swtpmBinary: advanced.swtpmBinary,
    ovmfCodePath: advanced.ovmfCodePath || undefined,
    ovmfVarsPath: advanced.ovmfVarsPath || undefined,
    probeKvm: true,
  });
}

function optsPreferred(kvmOk: boolean, platform: string = process.platform): Accelerator {
  if (platform === "linux" && kvmOk) return "kvm";
  if (platform === "win32") return "whpx";
  if (platform === "darwin") return "hvf";
  return "tcg";
}

export function resolveAccelerator(
  requested: Accelerator,
  auto: boolean,
  caps: HostCapabilities,
): Accelerator {
  if (!auto) {
    if (requested === "kvm" && !caps.kvmUsable) return "tcg";
    return requested;
  }
  return caps.accelerator;
}

export async function probeVirtfs(runner: CommandRunner, qemuBinary: string): Promise<boolean> {
  try {
    const result = await runner.exec(qemuBinary, ["-fsdev", "help"]);
    const text = `${result.stdout}\n${result.stderr}`;
    if (/no option group ['"]fsdev['"]/i.test(text) || /fsdev support is disabled/i.test(text)) {
      return false;
    }
    if (/\blocal\b/.test(text) || /virtfs|fsdev/i.test(text)) return true;
    return result.code === 0;
  } catch {
    return false;
  }
}

async function probeKvm(runner: CommandRunner, qemuBinary: string): Promise<boolean> {
  const port = 7010 + Math.floor(Math.random() * 80);
  let child: ReturnType<CommandRunner["spawn"]> | undefined;
  try {
    child = runner.spawn(qemuBinary, [
      "-name",
      "locus-kvm-probe",
      "-machine",
      "q35",
      "-accel",
      "kvm",
      "-cpu",
      "host",
      "-smp",
      "1",
      "-m",
      "32",
      "-display",
      "none",
      "-nodefaults",
      "-S",
      "-qmp",
      `tcp:127.0.0.1:${port},server,nowait`,
    ]);
    return await qmpReady(port, 5000);
  } catch {
    return false;
  } finally {
    child?.kill("SIGKILL");
  }
}

/** True when QMP answered `qmp_capabilities`. A greeting alone is not enough: nested KVM can
 * listen and then hang inside `kvm_vm_ioctl_create_vcpu`. */
export function qmpReady(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      const sock = createConnection({ host: "127.0.0.1", port });
      const timer = setTimeout(() => {
        sock.destroy();
        setTimeout(tryOnce, 150);
      }, 800);
      sock.on("connect", () => {
        sock.write(`${JSON.stringify({ execute: "qmp_capabilities" })}\r\n`);
      });
      sock.on("data", (buf) => {
        const text = buf.toString();
        if (text.includes('"return"')) {
          clearTimeout(timer);
          sock.end();
          resolve(true);
        }
      });
      sock.on("error", () => {
        clearTimeout(timer);
        sock.destroy();
        setTimeout(tryOnce, 150);
      });
    };
    tryOnce();
  });
}
