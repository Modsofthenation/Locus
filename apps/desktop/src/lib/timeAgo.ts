/** "5m ago" / "3h" (compact) / "Nov 2" for timestamps in lists. */
export function formatAgo(iso?: string, compact = false): string {
  if (!iso) return compact ? "—" : "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return compact ? "—" : "never";
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 45) return compact ? "now" : "just now";
  if (sec < 3600) {
    const value = `${Math.max(1, Math.floor(sec / 60))}m`;
    return compact ? value : `${value} ago`;
  }
  if (sec < 86400) {
    const value = `${Math.floor(sec / 3600)}h`;
    return compact ? value : `${value} ago`;
  }
  if (sec < 86400 * 7) {
    const value = `${Math.floor(sec / 86400)}d`;
    return compact ? value : `${value} ago`;
  }
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "in 5m" / "in 3h" / "Nov 2" for an upcoming timestamp. */
export function formatUntil(iso?: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const sec = Math.round((t - Date.now()) / 1000);
  if (sec < 60) return "now";
  if (sec < 3600) return `in ${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `in ${Math.floor(sec / 3600)}h`;
  if (sec < 86400 * 7) return `in ${Math.floor(sec / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
