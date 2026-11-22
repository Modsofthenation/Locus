import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ProviderUsage } from "@locus/shared";
import { api } from "@/lib/api";

/**
 * One shared copy of plan usage for every agent CLI, so the composer meter, the model
 * menu, the usage dialog and Settings → Providers show the same numbers from one fetch.
 * The control plane caches for a minute too; `force` asks it to re-read the vendor.
 */
export type ProviderUsageSnapshot = {
  rows: ProviderUsage[] | null;
  busy: boolean;
  error: string | null;
  /** Client time of the last successful load, 0 before the first. */
  loadedAt: number;
};

type Loader = typeof api.providerUsage;

/** Re-read after this long when something showing usage mounts or the window regains focus. */
export const PROVIDER_USAGE_STALE_MS = 60_000;
/** Background refresh while a meter is on screen. */
export const PROVIDER_USAGE_POLL_MS = 5 * 60_000;

const EMPTY: ProviderUsageSnapshot = { rows: null, busy: false, error: null, loadedAt: 0 };
let snapshot: ProviderUsageSnapshot = EMPTY;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: ProviderUsageSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function providerUsageSnapshot(): ProviderUsageSnapshot {
  return snapshot;
}

export async function refreshProviderUsage(
  opts: { force?: boolean; maxAgeMs?: number; load?: Loader; now?: number } = {},
): Promise<void> {
  const now = opts.now ?? Date.now();
  const maxAge = opts.maxAgeMs ?? PROVIDER_USAGE_STALE_MS;
  if (!opts.force && snapshot.loadedAt && now - snapshot.loadedAt < maxAge) return;
  if (inflight && !opts.force) return inflight;
  const load = opts.load ?? api.providerUsage;
  emit({ ...snapshot, busy: true, error: null });
  const run = load(opts.force ? { refresh: true } : {}).then(
    (result) => {
      emit({ rows: result.usage, busy: false, error: null, loadedAt: Date.now() });
    },
    (err: unknown) => {
      emit({
        ...snapshot,
        busy: false,
        error: err instanceof Error ? err.message : "Could not load usage",
      });
    },
  );
  inflight = run;
  void run.finally(() => {
    if (inflight === run) inflight = null;
  });
  return run;
}

/** Tests only: forget cached rows between cases. */
export function resetProviderUsageStore() {
  inflight = null;
  snapshot = EMPTY;
  for (const listener of listeners) listener();
}

/**
 * Subscribe to shared plan usage. Loads when stale on mount, on window focus, and every
 * few minutes while mounted. `revalidate` re-reads on mount even if the copy is fresh.
 */
export function useProviderUsage(
  opts: { load?: Loader; revalidate?: boolean; enabled?: boolean } = {},
) {
  const current = useSyncExternalStore(subscribe, providerUsageSnapshot, providerUsageSnapshot);
  const { load, revalidate, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    void refreshProviderUsage({ load, maxAgeMs: revalidate ? 0 : undefined });
    const onFocus = () => void refreshProviderUsage({ load });
    const timer = window.setInterval(
      () => void refreshProviderUsage({ load, maxAgeMs: PROVIDER_USAGE_POLL_MS - 1_000 }),
      PROVIDER_USAGE_POLL_MS,
    );
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, revalidate, enabled]);
  const refresh = useCallback(
    (force = true) => refreshProviderUsage({ force, load, maxAgeMs: 0 }),
    [load],
  );
  return { ...current, refresh };
}

export type UsageLevel = "ok" | "mid" | "high";

export function usageLevel(percent: number | undefined): UsageLevel {
  if (percent == null) return "ok";
  return percent >= 90 ? "high" : percent >= 70 ? "mid" : "ok";
}

/** A row worth a meter: the CLI reported at least one window with a percentage. */
export function usageRowFor(
  rows: ProviderUsage[] | null | undefined,
  providerId: string,
): ProviderUsage | undefined {
  return rows?.find((row) => row.providerId === providerId);
}
