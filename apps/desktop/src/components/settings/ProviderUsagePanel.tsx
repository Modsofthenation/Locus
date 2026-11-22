import type { ReactNode } from "react";
import {
  providerUsageWindowPercent,
  type ProviderUsage,
  type ProviderUsageWindow,
} from "@locus/shared";
import { api } from "@/lib/api";
import { usageLevel, useProviderUsage } from "@/lib/providerUsageStore";
import { BusyButton } from "@/components/layout/Skeleton";

/** Remaining plan quota for each signed-in agent CLI (Settings → Providers and the usage dialog). */
export function ProviderUsagePanel({
  load = api.providerUsage,
  now = () => Date.now(),
  title = "Plan usage",
  empty,
  focusProviderId,
}: {
  load?: typeof api.providerUsage;
  now?: () => number;
  /** Heading; null hides it (a dialog already has one). */
  title?: string | null;
  /** Shown when no CLI reports usage; without it the panel stays out of the way. */
  empty?: ReactNode;
  /** List this provider first (the one the composer is using). */
  focusProviderId?: string;
}) {
  const { rows, busy, error, refresh } = useProviderUsage({ load, revalidate: true });

  // Stay out of the way until at least one signed-in CLI reports something
  // (no CLI providers enabled, or the control plane is unreachable).
  if (!rows?.length) {
    if (!empty) return null;
    return (
      <section className="provider-usage" aria-label="Plan usage" data-testid="provider-usage">
        {error ? <p className="hint error">{error}</p> : null}
        {rows ? empty : <p className="hint">Loading usage…</p>}
      </section>
    );
  }

  const ordered = focusProviderId
    ? [...rows].sort(
        (a, b) =>
          Number(b.providerId === focusProviderId) - Number(a.providerId === focusProviderId),
      )
    : rows;

  return (
    <section className="provider-usage" aria-label="Plan usage" data-testid="provider-usage">
      <div className="provider-usage-head">
        {title ? <h3 className="provider-group-label">{title}</h3> : <span />}
        <BusyButton
          className="btn small ghost"
          busy={busy}
          busyLabel="Refreshing…"
          onClick={() => void refresh(true)}
        >
          Refresh
        </BusyButton>
      </div>
      {error ? <p className="hint error">{error}</p> : null}
      <div className="provider-usage-grid">
        {ordered.map((row) => (
          <UsageCard
            key={row.providerId}
            usage={row}
            now={now()}
            current={row.providerId === focusProviderId}
          />
        ))}
      </div>
    </section>
  );
}

export function UsageCard({
  usage,
  now,
  current,
}: {
  usage: ProviderUsage;
  now: number;
  current?: boolean;
}) {
  return (
    <article
      className={`provider-usage-card${usage.ok ? "" : " unavailable"}${current ? " current" : ""}`}
      data-testid={`provider-usage-${usage.providerId}`}
    >
      <header className="provider-usage-card-head">
        <strong>{usage.providerName}</strong>
        {current ? <span className="provider-usage-current">In use</span> : null}
        {usage.plan ? <span className="provider-usage-plan">{usage.plan}</span> : null}
      </header>
      {usage.windows.map((window) => (
        <UsageBar key={window.id} window={window} now={now} />
      ))}
      {usage.message ? <p className="hint provider-usage-note">{usage.message}</p> : null}
      {usage.ok && !usage.windows.length && !usage.message ? (
        <p className="hint provider-usage-note">No quota reported.</p>
      ) : null}
    </article>
  );
}

function UsageBar({ window, now }: { window: ProviderUsageWindow; now: number }) {
  const pct = providerUsageWindowPercent(window);
  const level = pct == null ? "" : usageLevel(pct) === "ok" ? "" : ` ${usageLevel(pct)}`;
  const amount = formatUsageAmount(window);
  const reset = window.resetsAt ? formatResetsIn(window.resetsAt, now, window.id === "bonus") : "";
  return (
    <div className="provider-usage-window">
      <div className="provider-usage-window-row">
        <span>{window.label}</span>
        <span className="provider-usage-value">
          {pct != null ? `${Math.round(pct)}% used` : amount}
        </span>
      </div>
      {pct != null ? (
        <div
          className={`provider-usage-bar${level}`}
          role="meter"
          aria-label={`${window.label} used`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {(pct != null && amount) || reset ? (
        <div className="provider-usage-meta">
          {pct != null && amount ? <span>{amount}</span> : <span />}
          {reset ? <span>{reset}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function formatUsageAmount(window: ProviderUsageWindow): string {
  const fmt = (value: number) =>
    window.unit === "usd"
      ? `$${value.toFixed(2)}`
      : Number.isInteger(value)
        ? String(value)
        : value.toFixed(2);
  if (window.used != null && window.limit != null) {
    const suffix = window.unit === "usd" ? "" : ` ${window.unit ?? ""}`.trimEnd();
    return `${fmt(window.used)} of ${fmt(window.limit)}${suffix}`;
  }
  if (window.used != null) {
    return window.unit === "credits" ? `${fmt(window.used)} credits` : fmt(window.used);
  }
  return "";
}

export function formatResetsIn(iso: string, now: number, expires = false): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const verb = expires ? "Expires" : "Resets";
  const ms = at - now;
  if (ms <= 0) return `${verb} now`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${verb} in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return `${verb} in ${hours}h${rest ? ` ${rest}m` : ""}`;
  }
  return `${verb} in ${Math.round(hours / 24)}d`;
}
