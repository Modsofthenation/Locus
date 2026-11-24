import { spawn, type ChildProcess } from "node:child_process";

/**
 * Verify commands (`npm run test` → `sh -c playwright test` → browsers) fork
 * grandchildren that inherit the stdout/stderr pipes. Killing only the direct
 * child leaves them running and holding the pipes open, so `close` never fires
 * and a "10 minute" timeout lasts as long as the whole suite. Start the child in
 * its own process group (POSIX) so a timeout can kill every descendant.
 */
export const processTreeSpawnOptions = { detached: process.platform !== "win32" } as const;

/** Kill `child` and its descendants: the process group on POSIX, `taskkill /T` on Windows. */
export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL"): void {
  if (!child.pid) {
    child.kill(signal);
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => child.kill(signal));
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

/** How long to wait for `close` after a timeout kill before settling anyway. */
export const KILL_SETTLE_MS = 5_000;

/**
 * On timeout: kill the tree, then settle after {@link KILL_SETTLE_MS} even if a
 * stray descendant still holds a pipe (destroying our ends so nothing leaks).
 * Returns the fallback timer so `close` can clear it.
 */
export function killTreeOnTimeout(
  child: ChildProcess,
  settle: () => void,
): ReturnType<typeof setTimeout> {
  killProcessTree(child, "SIGKILL");
  const fallback = setTimeout(() => {
    child.stdout?.destroy();
    child.stderr?.destroy();
    settle();
  }, KILL_SETTLE_MS);
  fallback.unref?.();
  return fallback;
}
