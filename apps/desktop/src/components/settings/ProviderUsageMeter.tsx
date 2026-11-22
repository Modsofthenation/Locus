import { useContext } from "react";
import { providerUsageWindowPercent, type AiProvider, type ProviderUsage } from "@locus/shared";
import { isUsageCapableProvider, providerUsagePeak } from "@locus/shared";
import { Store } from "@/state/store";
import { usageLevel, usageRowFor, useProviderUsage } from "@/lib/providerUsageStore";
import { formatResetsIn } from "./ProviderUsagePanel";

/** Busiest window of a usage row, for the meter's label and tooltip. */
function busiestWindow(row: ProviderUsage) {
  let best: { label: string; pct: number; resetsAt?: string; id: string } | undefined;
  for (const window of row.windows) {
    const pct = providerUsageWindowPercent(window);
    if (pct == null) continue;
    if (!best || pct > best.pct)
      best = { label: window.label, pct, resetsAt: window.resetsAt, id: window.id };
  }
  return best;
}

export function usageMeterTitle(row: ProviderUsage, now: number): string {
  const lines = [`${row.providerName}${row.plan ? ` · ${row.plan}` : ""} plan usage`];
  for (const window of row.windows) {
    const pct = providerUsageWindowPercent(window);
    if (pct == null) continue;
    const reset = window.resetsAt
      ? formatResetsIn(window.resetsAt, now, window.id === "bonus")
      : "";
    lines.push(
      `${window.label}: ${Math.round(pct)}% used${reset ? ` · ${reset.toLowerCase()}` : ""}`,
    );
  }
  lines.push("Click for details");
  return lines.join("\n");
}

/**
 * Small "5-hour 42%" meter next to the composer's model picker for agent CLIs that
 * report plan usage. Click opens the plan usage dialog. Hidden for API-key providers.
 */
export function ProviderUsageMeter({
  provider,
  now = () => Date.now(),
}: {
  provider: AiProvider | undefined;
  now?: () => number;
}) {
  const store = useContext(Store);
  const capable = Boolean(provider && isUsageCapableProvider(provider));
  const { rows } = useProviderUsage({ enabled: capable });
  if (!provider || !capable) return null;
  const row = usageRowFor(rows, provider.id);
  if (!row?.ok) return null;
  const busiest = busiestWindow(row);
  const peak = providerUsagePeak(row);
  if (!busiest || peak == null) return null;
  const level = usageLevel(peak);
  const pct = Math.round(peak);
  return (
    <button
      type="button"
      className={`btn small ghost usage-meter ${level}`}
      data-testid="usage-meter"
      title={usageMeterTitle(row, now())}
      aria-label={`${provider.name} plan: ${busiest.label} ${pct}% used. Show plan usage`}
      onClick={() => store?.dispatch({ type: "planUsage", open: true, providerId: provider.id })}
    >
      <span
        className="usage-meter-ring"
        style={{ ["--usage-pct" as string]: `${peak}%` }}
        aria-hidden="true"
      />
      <span className="usage-meter-label">{busiest.label}</span>
      <span className="usage-meter-value">{pct}%</span>
    </button>
  );
}

/** "42% used" for a provider row in the model menu, when that CLI reports usage. */
export function useProviderUsageLabels(providers: AiProvider[], enabled: boolean) {
  const capable = enabled && providers.some((row) => row.enabled && isUsageCapableProvider(row));
  const { rows } = useProviderUsage({ enabled: capable });
  return (providerId: string): string | undefined => {
    if (!capable) return undefined;
    const row = usageRowFor(rows, providerId);
    if (!row?.ok) return undefined;
    const peak = providerUsagePeak(row);
    return peak == null ? undefined : `${Math.round(peak)}% used`;
  };
}
