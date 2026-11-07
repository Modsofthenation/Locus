import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { detectCapabilities } from "./detect.js";
import { describeHost, installArgv, installQemu } from "./install.js";
import type { CommandRunner, ExecResult, SpawnedProcess } from "./runner.js";

function runner(opts: {
  bins?: Record<string, string>;
  files?: string[];
  exec?: (command: string, args: string[]) => ExecResult;
  spawnCode?: number;
  spawnStdout?: string;
}): CommandRunner {
  const spawned: string[][] = [];
  return {
    which: async (bin) => opts.bins?.[bin] ?? null,
    exists: async (path) => Boolean(opts.files?.includes(path)),
    exec: async (command, args) =>
      opts.exec?.(command, args) ?? { stdout: "", stderr: "", code: 1 },
    spawn: (command, args): SpawnedProcess => {
      spawned.push([command, ...args]);
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      return {
        stdout: stdout as unknown as NodeJS.ReadableStream,
        stderr: stderr as unknown as NodeJS.ReadableStream,
        kill: () => true,
        on: (event, listener) => {
          if (event === "exit") {
            queueMicrotask(() => {
              if (opts.spawnStdout) stdout.emit("data", Buffer.from(opts.spawnStdout));
              (listener as (code: number | null, signal: NodeJS.Signals | null) => void)(
                opts.spawnCode ?? 0,
                null,
              );
            });
          }
        },
      };
    },
    _spawned: spawned,
  } as CommandRunner & { _spawned: string[][] };
}

describe("describeHost", () => {
  it("detects Ubuntu and apt", async () => {
    const host = await describeHost(runner({ bins: { "apt-get": "/usr/bin/apt-get" } }), {
      platform: "linux",
      osRelease: 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04 LTS"\n',
    });
    expect(host.os).toEqual({
      platform: "linux",
      label: "Linux (Ubuntu 24.04 LTS)",
      distro: "Ubuntu 24.04 LTS",
    });
    expect(host.packageManager).toBe("apt");
    expect(host.install.canInstall).toBe(true);
    expect(host.install.displayCommand).toContain("apt install");
  });

  it("detects Windows winget for one-click QEMU", async () => {
    const host = await describeHost(runner({ bins: { winget: "C:\\\\winget.exe" } }), {
      platform: "win32",
    });
    expect(host.os.label).toBe("Windows");
    expect(host.packageManager).toBe("winget");
    expect(host.install.canInstall).toBe(true);
    expect(host.install.displayCommand).toContain("SoftwareFreedomConservancy.QEMU");
  });

  it("falls back to a manual hint when no package manager is present", async () => {
    const host = await describeHost(runner({ bins: {} }), { platform: "win32" });
    expect(host.install.canInstall).toBe(false);
    expect(host.install.manualHint).toContain("qemu.org/download/#windows");
  });
});

describe("installArgv", () => {
  it("uses pkexec then sudo -n on Linux when not root", () => {
    const recipe = {
      method: "apt" as const,
      displayCommand: "sudo apt install qemu-system-x86",
      canInstall: true,
      packages: ["qemu-system-x86", "qemu-utils"],
      manualHint: "",
    };
    expect(installArgv(recipe, { uid: 0 })).toMatchObject({
      command: "apt-get",
      args: ["install", "-y", "qemu-system-x86", "qemu-utils"],
    });
    expect(installArgv(recipe, { uid: 1000, pkexec: true }).command).toBe("pkexec");
    expect(installArgv(recipe, { uid: 1000, pkexec: false })).toMatchObject({
      command: "sudo",
      args: ["-n", "apt-get", "install", "-y", "qemu-system-x86", "qemu-utils"],
    });
  });
});

describe("installQemu", () => {
  it("runs winget on Windows", async () => {
    const fake = runner({
      bins: { winget: "C:\\\\winget.exe" },
      spawnCode: 0,
      spawnStdout: "Successfully installed",
    });
    const result = await installQemu(fake, { platform: "win32", timeoutMs: 1000 });
    expect(result.ok).toBe(true);
    expect((fake as CommandRunner & { _spawned: string[][] })._spawned[0]?.[0]).toBe("winget");
    expect((fake as CommandRunner & { _spawned: string[][] })._spawned[0]).toContain(
      "SoftwareFreedomConservancy.QEMU",
    );
  });

  it("streams installer output", async () => {
    const chunks: string[] = [];
    const fake = runner({
      bins: { winget: "C:\\\\winget.exe" },
      spawnCode: 0,
      spawnStdout: "Successfully installed",
    });
    const result = await installQemu(fake, {
      platform: "win32",
      timeoutMs: 1000,
      onOutput: (chunk) => chunks.push(chunk),
    });
    expect(result.ok).toBe(true);
    expect(chunks.join("")).toContain("Successfully installed");
  });

  it("returns the manual hint when install is not available", async () => {
    const result = await installQemu(runner({ bins: {} }), { platform: "win32" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("qemu.org/download/#windows");
  });

  it("runs apt-get update before installing packages", async () => {
    const fake = runner({
      bins: { "apt-get": "/usr/bin/apt-get" },
      spawnCode: 0,
      spawnStdout: "ok",
    });
    const result = await installQemu(fake, {
      platform: "linux",
      osRelease: 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04 LTS"\n',
      uid: 0,
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(true);
    const spawned = (fake as CommandRunner & { _spawned: string[][] })._spawned;
    expect(spawned[0]).toEqual(["apt-get", "update"]);
    expect(spawned[1]?.slice(0, 3)).toEqual(["apt-get", "install", "-y"]);
  });
});

describe("detectCapabilities", () => {
  it("finds QEMU in the Windows Program Files install dir", async () => {
    const qemu = "C:\\Program Files\\qemu\\qemu-system-x86_64.exe";
    const img = "C:\\Program Files\\qemu\\qemu-img.exe";
    const caps = await detectCapabilities(runner({ files: [qemu, img] }), {
      qemuBinary: "qemu-system-x86_64",
      swtpmBinary: "swtpm",
      probeKvm: false,
      platform: "win32",
    });
    expect(caps.qemuBinary).toBe(qemu);
    expect(caps.qemuImgBinary).toBe(img);
    expect(caps.accelerator).toBe("whpx");
    expect(caps.hasVirtfs).toBe(false);
  });

  it("detects Windows QEMU builds that ship without fsdev/9p", async () => {
    const qemu = "C:\\Program Files\\qemu\\qemu-system-x86_64.exe";
    const img = "C:\\Program Files\\qemu\\qemu-img.exe";
    const caps = await detectCapabilities(
      runner({
        files: [qemu, img],
        exec: (command, args) => {
          if (command === qemu && args[0] === "-fsdev") {
            return {
              stdout: "",
              stderr:
                "qemu-system-x86_64.exe: -fsdev help: There is no option group 'fsdev'\n" +
                "qemu-system-x86_64.exe: -fsdev help: fsdev support is disabled\n",
              code: 1,
            };
          }
          return { stdout: "", stderr: "", code: 1 };
        },
      }),
      {
        qemuBinary: "qemu-system-x86_64",
        swtpmBinary: "swtpm",
        probeKvm: false,
        platform: "win32",
      },
    );
    expect(caps.hasVirtfs).toBe(false);
  });
});
