import { readFile } from "node:fs/promises";
import {
  describeHostOs,
  packageManagerForDistro,
  parseOsRelease,
  qemuInstallRecipe,
  type HostOsInfo,
  type PackageManager,
  type QemuInstallRecipe,
} from "@locus/shared";
import type { CommandRunner, ExecResult } from "./runner.js";

export interface HostSetupInfo {
  os: HostOsInfo;
  packageManager: PackageManager | null;
  install: QemuInstallRecipe;
}

export interface QemuInstallResult {
  ok: boolean;
  log: string;
  error?: string;
}

export async function describeHost(
  runner: CommandRunner,
  opts: { platform?: string; osRelease?: string } = {},
): Promise<HostSetupInfo> {
  const platform = opts.platform ?? process.platform;
  let distro: string | undefined;
  let fromRelease: PackageManager | null = null;
  if (platform === "linux") {
    const text = opts.osRelease ?? (await readOsRelease());
    if (text) {
      const parsed = parseOsRelease(text);
      distro = parsed.prettyName ?? parsed.id;
      fromRelease = packageManagerForDistro(parsed.id, parsed.idLike);
    }
  }
  const packageManager = await detectPackageManager(runner, platform, fromRelease);
  return {
    os: describeHostOs(platform, distro),
    packageManager,
    install: qemuInstallRecipe(platform, packageManager),
  };
}

export async function installQemu(
  runner: CommandRunner,
  opts: {
    platform?: string;
    osRelease?: string;
    uid?: number;
    timeoutMs?: number;
    onOutput?: (chunk: string) => void;
  } = {},
): Promise<QemuInstallResult> {
  const host = await describeHost(runner, opts);
  if (!host.install.canInstall) {
    return {
      ok: false,
      log: "",
      error: `No one-click installer for ${host.os.label}. ${host.install.manualHint}`,
    };
  }
  const pkexec = Boolean(await runner.which("pkexec"));
  const elevateOpts = {
    uid: opts.uid ?? process.getuid?.() ?? 1,
    pkexec,
    shell: (opts.platform ?? process.platform) === "win32",
  };
  try {
    if (host.install.method === "apt") {
      const update = elevate("apt-get", ["update"], elevateOpts);
      const updated = await runTimed(runner, update.command, update.args, {
        timeoutMs: Math.min(opts.timeoutMs ?? 600_000, 180_000),
        shell: update.shell,
        onOutput: opts.onOutput,
      });
      if (updated.code !== 0) {
        const log = [updated.stdout, updated.stderr].filter(Boolean).join("\n").trim();
        return {
          ok: false,
          log,
          error:
            tail(log) ||
            `apt-get update failed with code ${updated.code}. ${host.install.manualHint}`,
        };
      }
    }
    const argv = installArgv(host.install, elevateOpts);
    const result = await runTimed(runner, argv.command, argv.args, {
      timeoutMs: opts.timeoutMs ?? 600_000,
      shell: argv.shell,
      onOutput: opts.onOutput,
    });
    const log = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    if (result.code !== 0) {
      return {
        ok: false,
        log,
        error: tail(log) || `Install failed with code ${result.code}. ${host.install.manualHint}`,
      };
    }
    return { ok: true, log };
  } catch (err) {
    return {
      ok: false,
      log: "",
      error: err instanceof Error ? err.message : "Install failed",
    };
  }
}

export function installArgv(
  recipe: QemuInstallRecipe,
  opts: { uid?: number; pkexec?: boolean; shell?: boolean } = {},
): { command: string; args: string[]; shell: boolean } {
  const shell = Boolean(opts.shell);
  const uid = opts.uid ?? 1;
  switch (recipe.method) {
    case "winget":
      return {
        command: "winget",
        args: [
          "install",
          "--id",
          "SoftwareFreedomConservancy.QEMU",
          "-e",
          "--accept-package-agreements",
          "--accept-source-agreements",
          "--disable-interactivity",
        ],
        shell,
      };
    case "choco":
      return { command: "choco", args: ["install", "qemu", "-y"], shell };
    case "scoop":
      return { command: "scoop", args: ["install", "qemu"], shell };
    case "brew":
      return { command: "brew", args: ["install", "qemu"], shell: false };
    case "apt":
      return elevate("apt-get", ["install", "-y", ...recipe.packages], {
        uid,
        pkexec: opts.pkexec,
      });
    case "dnf":
      return elevate("dnf", ["install", "-y", ...recipe.packages], { uid, pkexec: opts.pkexec });
    case "pacman":
      return elevate("pacman", ["-S", "--noconfirm", ...recipe.packages], {
        uid,
        pkexec: opts.pkexec,
      });
    case "zypper":
      return elevate("zypper", ["--non-interactive", "install", ...recipe.packages], {
        uid,
        pkexec: opts.pkexec,
      });
    default:
      return { command: "false", args: [], shell: false };
  }
}

async function detectPackageManager(
  runner: CommandRunner,
  platform: string,
  hinted: PackageManager | null,
): Promise<PackageManager | null> {
  const available = new Set<PackageManager>();
  const checks: Array<[PackageManager, string[]]> =
    platform === "darwin"
      ? [["brew", ["brew"]]]
      : platform === "win32"
        ? [
            ["winget", ["winget", "winget.exe"]],
            ["choco", ["choco", "choco.exe"]],
            ["scoop", ["scoop", "scoop.cmd"]],
          ]
        : [
            ["apt", ["apt-get", "apt"]],
            ["dnf", ["dnf"]],
            ["pacman", ["pacman"]],
            ["zypper", ["zypper"]],
          ];
  for (const [mgr, bins] of checks) {
    for (const bin of bins) {
      if (await runner.which(bin)) {
        available.add(mgr);
        break;
      }
    }
  }
  if (hinted && available.has(hinted)) return hinted;
  if (platform === "win32") {
    if (available.has("winget")) return "winget";
    if (available.has("choco")) return "choco";
    if (available.has("scoop")) return "scoop";
    return null;
  }
  if (platform === "darwin") return available.has("brew") ? "brew" : null;
  for (const mgr of ["apt", "dnf", "pacman", "zypper"] as const) {
    if (available.has(mgr)) return mgr;
  }
  return null;
}

function elevate(
  command: string,
  args: string[],
  opts: { uid: number; pkexec?: boolean },
): { command: string; args: string[]; shell: boolean } {
  if (opts.uid === 0) return { command, args, shell: false };
  if (opts.pkexec) return { command: "pkexec", args: [command, ...args], shell: false };
  return { command: "sudo", args: ["-n", command, ...args], shell: false };
}

async function runTimed(
  runner: CommandRunner,
  command: string,
  args: string[],
  opts: { timeoutMs: number; shell?: boolean; onOutput?: (chunk: string) => void },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = runner.spawn(command, args, { shell: opts.shell });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ stdout, stderr: stderr || `Timed out after ${opts.timeoutMs}ms`, code: 1 });
    }, opts.timeoutMs);
    const take = (d: Buffer | string, sink: "stdout" | "stderr") => {
      const chunk = d.toString();
      if (sink === "stdout") stdout += chunk;
      else stderr += chunk;
      opts.onOutput?.(chunk);
    };
    child.stdout?.on("data", (d: Buffer | string) => {
      take(d, "stdout");
    });
    child.stderr?.on("data", (d: Buffer | string) => {
      take(d, "stderr");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

async function readOsRelease(): Promise<string | null> {
  try {
    return await readFile("/etc/os-release", "utf8");
  } catch {
    return null;
  }
}

function tail(text: string, n = 2000): string {
  return text.length <= n ? text : text.slice(-n);
}
