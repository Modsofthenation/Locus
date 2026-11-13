import { useEffect } from "react";
import { parseCheckForUpdates } from "@locus/shared";
import { api } from "./api";
import { APP_VERSION } from "./appInfo";
import { desktopBridge, type LocusDesktopBridge } from "./closeGuard";
import { showNotice } from "./notice";

export type AppUpdateInfo = Awaited<ReturnType<typeof api.checkUpdates>>;

/** localStorage key holding the last version we announced, so each release prompts once. */
export const UPDATE_ANNOUNCED_KEY = "locus-update-announced";
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function updateVersionLabel(update: Pick<AppUpdateInfo, "latest">): string {
  return (update.latest ?? "").replace(/^v/i, "");
}

export function shouldAnnounceUpdate(
  update: Pick<AppUpdateInfo, "status" | "latest">,
  lastAnnounced: string | null | undefined,
): boolean {
  if (update.status !== "available" || !update.latest) return false;
  return updateVersionLabel(update) !== (lastAnnounced ?? "").replace(/^v/i, "");
}

export type InstallOutcome =
  | { action: "relaunching" | "installer" | "opened"; path: string }
  | { action: "download-only"; url: string };

/**
 * Download the release asset, check it against SHA256SUMS, then hand it to the desktop
 * shell: AppImage builds swap in place and relaunch, Windows runs the installer, others open
 * the file. Without a verified download path we fall back to the release asset URL.
 */
export async function installAppUpdate(
  update: AppUpdateInfo,
  deps: {
    download?: typeof api.downloadUpdate;
    open?: typeof api.openUpdate;
    bridge?: LocusDesktopBridge;
  } = {},
): Promise<InstallOutcome> {
  if (!update.asset) throw new Error("This release has no installer for this platform.");
  if (!update.checksums) return { action: "download-only", url: update.asset.url };
  const download = deps.download ?? api.downloadUpdate;
  const open = deps.open ?? api.openUpdate;
  const bridge = deps.bridge ?? desktopBridge();
  const verified = await download(update.asset, update.checksums);
  if (bridge?.installUpdate) {
    const result = await bridge.installUpdate(verified.path);
    if (!result.ok) throw new Error(result.error || "Could not install the update.");
    return { action: result.action ?? "opened", path: verified.path };
  }
  await open(verified.path);
  return { action: "opened", path: verified.path };
}

export function installOutcomeMessage(outcome: InstallOutcome, version: string): string {
  if (outcome.action === "relaunching") return `Installing Locus ${version}. Locus will restart.`;
  if (outcome.action === "installer") return `Running the Locus ${version} installer.`;
  if (outcome.action === "download-only") return `Download Locus ${version} from GitHub releases.`;
  return `Opened the verified Locus ${version} installer.`;
}

function readAnnounced(): string | null {
  try {
    return globalThis.localStorage?.getItem(UPDATE_ANNOUNCED_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeAnnounced(version: string): void {
  try {
    globalThis.localStorage?.setItem(UPDATE_ANNOUNCED_KEY, version);
  } catch {
    /* private mode */
  }
}

export function announceUpdate(update: AppUpdateInfo): void {
  const version = updateVersionLabel(update);
  writeAnnounced(version);
  showNotice(`Locus ${version} is available.`, {
    actionLabel: update.asset ? "Install" : "View release",
    durationMs: 30_000,
    onAction: () => {
      if (!update.asset) {
        if (update.htmlUrl) window.open(update.htmlUrl, "_blank", "noreferrer");
        return;
      }
      showNotice(`Downloading Locus ${version}…`, { durationMs: 60_000 });
      void installAppUpdate(update)
        .then((outcome) => {
          if (outcome.action === "download-only") window.open(outcome.url, "_blank", "noreferrer");
          showNotice(installOutcomeMessage(outcome, version), { durationMs: 10_000 });
        })
        .catch((err: unknown) => {
          showNotice(err instanceof Error ? err.message : "Update failed", { durationMs: 10_000 });
        });
    },
  });
}

/**
 * Check GitHub Releases shortly after launch and every six hours while Locus is open.
 * Off when Settings → About → Check automatically is off, or on a paired phone.
 */
export function useBackgroundUpdateCheck(opts: {
  enabled: boolean;
  checkForUpdates: unknown;
}): void {
  const on = opts.enabled && parseCheckForUpdates(opts.checkForUpdates);
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    const run = () => {
      void api
        .checkUpdates(APP_VERSION)
        .then((update) => {
          if (cancelled || !shouldAnnounceUpdate(update, readAnnounced())) return;
          announceUpdate(update);
        })
        .catch(() => undefined);
    };
    const first = setTimeout(run, FIRST_CHECK_DELAY_MS);
    const every = setInterval(run, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(every);
    };
  }, [on]);
}
