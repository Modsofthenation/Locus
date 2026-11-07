import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VmInstance } from "@locus/shared";
import type { SshExec } from "@locus/guest-agent";
import {
  pullWindowsShareToHost,
  pushShareFileToWindows,
  sshTargetFromVm,
  syncHostShareToWindows,
} from "./winshare.js";

function windowsVm(): VmInstance {
  const t = new Date().toISOString();
  return {
    id: "vm-1",
    sessionId: "s-1",
    templateId: "windows-11",
    os: "windows-11",
    name: "win",
    status: "running",
    diskPath: "/tmp/disk.qcow2",
    slot: 0,
    ssh: { host: "127.0.0.1", port: 2201, username: "locus", identityFile: "/tmp/id" },
    createdAt: t,
    updatedAt: t,
  };
}

describe("windows host share", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("ignores Linux guests and Windows guests without SSH", () => {
    const linux = {
      ...windowsVm(),
      os: "ubuntu" as const,
      ssh: { host: "127.0.0.1", port: 2200, username: "locus" },
    };
    expect(sshTargetFromVm(linux)).toBeUndefined();
    expect(sshTargetFromVm({ ...windowsVm(), ssh: undefined })).toBeUndefined();
  });

  it("mkdirs C:\\host and scp-puts each host file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-winshare-"));
    dirs.push(dir);
    await writeFile(join(dir, "a.txt"), "a");
    await mkdir(join(dir, "skip"));
    const argv: string[][] = [];
    const exec: SshExec = async (cmd) => {
      argv.push(cmd);
      return { code: 0, stdout: "", stderr: "" };
    };
    await syncHostShareToWindows(windowsVm(), dir, exec);
    expect(argv[0]?.[0]).toBe("ssh");
    expect(argv[0]?.at(-1)).toContain("-EncodedCommand");
    expect(argv[1]?.[0]).toBe("scp");
    expect(argv[1]).toContain(join(dir, "a.txt"));
    expect(argv[1]?.at(-1)).toBe("locus@127.0.0.1:C:/host/a.txt");
    expect(argv.filter((a) => a[0] === "scp")).toHaveLength(1);
  });

  it("pushes a single dropped file", async () => {
    const captured: string[][] = [];
    const exec: SshExec = async (cmd) => {
      captured.push(cmd);
      return { code: 0, stdout: "", stderr: "" };
    };
    await pushShareFileToWindows(windowsVm(), "/data/share/notes.txt", "notes.txt", exec);
    expect(captured.some((a) => a[0] === "ssh")).toBe(true);
    expect(captured.at(-1)?.at(-1)).toBe("locus@127.0.0.1:C:/host/notes.txt");
  });

  it("pulls guest files whose names stay inside the share root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-winshare-"));
    dirs.push(dir);
    const captured: string[][] = [];
    const exec: SshExec = async (cmd) => {
      captured.push(cmd);
      if (cmd[0] === "ssh") return { code: 0, stdout: "ok.txt\n..\nbad/../x.txt\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    await pullWindowsShareToHost(windowsVm(), dir, exec);
    const gets = captured.filter((a) => a[0] === "scp");
    expect(gets).toHaveLength(1);
    expect(gets[0]?.includes("locus@127.0.0.1:C:/host/ok.txt")).toBe(true);
    expect(gets[0]?.at(-1)).toBe(join(dir, "ok.txt"));
  });
});
