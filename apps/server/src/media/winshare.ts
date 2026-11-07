import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { isWindows, type VmInstance } from "@locus/shared";
import {
  powershellEncodedCommand,
  runSsh,
  scpGetArgv,
  scpPutArgv,
  sshArgv,
  type SshExec,
  type SshTarget,
} from "@locus/guest-agent";
import { shareDest } from "./share.js";

const WINDOWS_SHARE_UNIX = "C:/host";
const MKDIR_SHARE = "New-Item -ItemType Directory -Force -Path 'C:\\host' | Out-Null";
const LIST_SHARE =
  "Get-ChildItem -File -Path 'C:\\host' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name";

export function sshTargetFromVm(vm: VmInstance): SshTarget | undefined {
  if (!isWindows(vm.os) || !vm.ssh) return undefined;
  return {
    host: vm.ssh.host,
    port: vm.ssh.port,
    username: vm.ssh.username,
    identityFile: vm.ssh.identityFile,
  };
}

export async function ensureWindowsShareDir(
  target: SshTarget,
  exec: SshExec = runSsh,
): Promise<void> {
  await exec(sshArgv(target, powershellEncodedCommand(MKDIR_SHARE)));
}

export async function pushShareFileToWindows(
  vm: VmInstance,
  localPath: string,
  filename: string,
  exec: SshExec = runSsh,
): Promise<void> {
  const target = sshTargetFromVm(vm);
  if (!target) return;
  await ensureWindowsShareDir(target, exec);
  await exec(scpPutArgv(target, localPath, `${WINDOWS_SHARE_UNIX}/${filename}`));
}

export async function syncHostShareToWindows(
  vm: VmInstance,
  shareRoot: string,
  exec: SshExec = runSsh,
): Promise<void> {
  const target = sshTargetFromVm(vm);
  if (!target) return;
  await ensureWindowsShareDir(target, exec);
  let entries;
  try {
    entries = await readdir(shareRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    await exec(
      scpPutArgv(target, join(shareRoot, entry.name), `${WINDOWS_SHARE_UNIX}/${entry.name}`),
    );
  }
}

export async function pullWindowsShareToHost(
  vm: VmInstance,
  shareRoot: string,
  exec: SshExec = runSsh,
): Promise<void> {
  const target = sshTargetFromVm(vm);
  if (!target) return;
  const listed = await exec(sshArgv(target, powershellEncodedCommand(LIST_SHARE)));
  if (listed.code !== 0) return;
  const names = listed.stdout
    .split(/\r?\n/)
    .map((n) => n.trim())
    .filter((n) => n && !n.includes("/") && !n.includes("\\") && n !== "." && n !== "..");
  for (const name of names) {
    let dest: string;
    try {
      dest = shareDest(shareRoot, name);
    } catch {
      continue;
    }
    await exec(scpGetArgv(target, `${WINDOWS_SHARE_UNIX}/${name}`, dest));
  }
}
