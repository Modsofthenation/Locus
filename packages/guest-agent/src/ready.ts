import type { GuestOs } from "@locus/shared";
import { isWindows } from "@locus/shared";
import { powershellEncodedCommand, probeWinRm, type WinRmPost, type WinRmTarget } from "./winrm.js";
import { waitForSsh, type SshExec, type SshTarget } from "./ssh.js";

export const READY_TOKEN = "LOCUS_READY";

const LINUX_PROBE = `(command -v cloud-init >/dev/null 2>&1 && cloud-init status --wait || true) && echo ${READY_TOKEN}`;

export function guestReadyTimeoutMs(os: GuestOs): number {
  if (isWindows(os) || os === "omarchy") return 2_400_000;
  return 1_800_000;
}

export interface GuestWaitTarget {
  os: GuestOs;
  ssh?: SshTarget;
  winrm?: WinRmTarget;
}

export async function waitForGuest(
  guest: GuestWaitTarget,
  opts: {
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
    sshExec?: SshExec;
    winrmPost?: WinRmPost;
  } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? guestReadyTimeoutMs(guest.os);
  const intervalMs = opts.intervalMs ?? 2000;
  if (!isWindows(guest.os)) {
    if (!guest.ssh) return false;
    return waitForSsh(guest.ssh, {
      timeoutMs,
      intervalMs,
      signal: opts.signal,
      exec: opts.sshExec,
      probe: LINUX_PROBE,
    });
  }

  const deadline = Date.now() + timeoutMs;
  const sshProbe = powershellEncodedCommand(`Write-Output ${READY_TOKEN}`);

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return false;
    if (guest.ssh) {
      const ok = await waitForSsh(guest.ssh, {
        timeoutMs: Math.min(8_000, Math.max(intervalMs, 250)),
        intervalMs: Math.min(400, intervalMs),
        signal: opts.signal,
        exec: opts.sshExec,
        probe: sshProbe,
      });
      if (ok) return true;
    }
    if (guest.winrm) {
      const ok = await probeWinRm(guest.winrm, { post: opts.winrmPost, signal: opts.signal });
      if (ok) return true;
    }
    await sleep(intervalMs, opts.signal);
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
