/**
 * Plan / quota usage read from a local agent CLI's own account (Codex,
 * Claude Code, Cursor CLI, Kiro CLI). Credentials never leave the control
 * plane; only these numbers reach the operator UI.
 */
import {
  isClaudeCodeProvider,
  isCodexCliProvider,
  isCursorCliProvider,
  isKiroCliProvider,
} from "./provider.js";

export type ProviderUsageSource = "oauth" | "session-log" | "cli" | "web" | "none";

export type ProviderUsageUnit = "percent" | "credits" | "usd" | "requests";

export interface ProviderUsageWindow {
  /** Stable key, e.g. `five_hour`, `weekly`, `monthly`, `bonus`, `on_demand`. */
  id: string;
  label: string;
  /** 0–100 share of the window already spent, when the vendor reports one. */
  usedPercent?: number;
  used?: number;
  limit?: number;
  unit?: ProviderUsageUnit;
  /** ISO timestamp when the window resets or the bonus expires. */
  resetsAt?: string;
  windowMinutes?: number;
}

export interface ProviderUsage {
  providerId: string;
  providerName: string;
  kind: string;
  ok: boolean;
  source: ProviderUsageSource;
  plan?: string;
  windows: ProviderUsageWindow[];
  /** Why usage is unavailable, or a caveat (e.g. API-key billing has no plan quota). */
  message?: string;
  fetchedAt: string;
}

/** Highest used percent across a usage row, for "nearly out" badges. */
export function providerUsagePeak(usage: Pick<ProviderUsage, "windows">): number | undefined {
  let peak: number | undefined;
  for (const window of usage.windows) {
    const pct = providerUsageWindowPercent(window);
    if (pct == null) continue;
    peak = peak == null ? pct : Math.max(peak, pct);
  }
  return peak;
}

export function providerUsageWindowPercent(window: ProviderUsageWindow): number | undefined {
  if (typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent)) {
    return clampPercent(window.usedPercent);
  }
  if (
    typeof window.used === "number" &&
    typeof window.limit === "number" &&
    Number.isFinite(window.used) &&
    window.limit > 0
  ) {
    return clampPercent((window.used / window.limit) * 100);
  }
  return undefined;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** Agent CLIs whose own sign-in reports plan usage (Codex, Claude Code, Cursor CLI, Kiro CLI). */
export function isUsageCapableProvider(provider: { kind?: string; baseUrl?: string }): boolean {
  return (
    isCodexCliProvider(provider) ||
    isClaudeCodeProvider(provider) ||
    isCursorCliProvider(provider) ||
    isKiroCliProvider(provider)
  );
}

function formatUsageNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatResetIn(resetsAt: string | undefined, now: Date): string | undefined {
  if (!resetsAt) return undefined;
  const ms = Date.parse(resetsAt) - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `resets in ${hours}h`;
  return `resets in ${Math.round(hours / 24)}d`;
}

/**
 * One short line of plan usage for a status message, e.g.
 * "Claude Code: 5-hour 23%, Weekly 61% (resets in 3h)" or
 * "Kiro: Monthly credits 212/1,000 (21%) (resets in 9d)". Undefined when nothing usable was read.
 * The reset shown is the busiest window's. At most `maxWindows` windows, busiest first.
 */
export function formatProviderUsageBrief(
  usage: Pick<ProviderUsage, "ok" | "providerName" | "windows">,
  opts: { now?: Date; maxWindows?: number } = {},
): string | undefined {
  if (!usage.ok) return undefined;
  const now = opts.now ?? new Date();
  const rows = usage.windows
    .map((window) => {
      const pct = providerUsageWindowPercent(window);
      const unit = window.unit === "percent" || !window.unit ? "" : ` ${window.unit}`;
      let value: string | undefined;
      if (typeof window.used === "number" && typeof window.limit === "number" && window.limit > 0) {
        value = `${formatUsageNumber(window.used)}/${formatUsageNumber(window.limit)}${unit}`;
        if (pct != null) value += ` (${Math.round(pct)}%)`;
      } else if (pct != null) {
        value = `${Math.round(pct)}%`;
      } else if (typeof window.used === "number") {
        value = `${formatUsageNumber(window.used)}${unit}`;
      }
      return value ? { window, pct, text: `${window.label} ${value}` } : undefined;
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (!rows.length) return undefined;
  const busiest = [...rows].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  const shown = busiest.slice(0, Math.max(1, opts.maxWindows ?? 3));
  // Keep the vendor's window order for the ones shown.
  const ordered = rows.filter((row) => shown.includes(row));
  const reset = formatResetIn(busiest[0]!.window.resetsAt, now);
  const name = usage.providerName.trim() || "Plan";
  return `${name}: ${ordered.map((row) => row.text).join(", ")}${reset ? ` (${reset})` : ""}`;
}
