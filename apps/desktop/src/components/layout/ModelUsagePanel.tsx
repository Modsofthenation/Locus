import { useEffect, useState } from "react";
import { formatUsd, type LocusConfig, type ModelUsageSummary } from "@locus/shared";
import { api } from "@/lib/api";

const numbers = new Intl.NumberFormat();

export function ModelUsagePanel({ providers }: { providers?: LocusConfig["providers"] }) {
  const [usage, setUsage] = useState<ModelUsageSummary>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let refresh: number;
    async function load() {
      try {
        const next = await api.modelUsage();
        if (active) {
          setUsage(next);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) refresh = window.setTimeout(() => void load(), 15_000);
      }
    }
    void load();
    return () => {
      active = false;
      window.clearTimeout(refresh);
    };
  }, []);

  const models = [...(usage?.models ?? [])].sort(
    (a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
  );
  const totals = models.reduce(
    (total, row) => ({
      tokens: total.tokens + row.inputTokens + row.outputTokens,
      estimated: total.estimated + row.estimatedTokens,
      unpriced: total.unpriced + row.unpricedTokens,
      usd: row.usd === undefined ? total.usd : (total.usd ?? 0) + row.usd,
    }),
    { tokens: 0, estimated: 0, unpriced: 0, usd: undefined as number | undefined },
  );
  const since = usage?.since ? new Date(usage.since).toLocaleDateString() : undefined;

  return (
    <section className="dash-panel dash-usage" aria-labelledby="dash-usage-title">
      <header className="dash-panel-head">
        <h3 id="dash-usage-title">Provider &amp; model usage</h3>
        {since ? <span className="dash-stat-hint">Since {since}</span> : null}
      </header>
      {failed ? (
        <p className="dash-note" role="status">
          {usage ? "Showing last available usage. Refresh failed." : "Usage is unavailable."}
        </p>
      ) : null}
      {!usage && !failed ? <p className="dash-note">Loading usage…</p> : null}
      {usage && !models.length ? <p className="dash-note">No model usage recorded yet.</p> : null}
      {models.length ? (
        <>
          <p className="dash-note">
            {numbers.format(totals.tokens)} tokens
            {totals.estimated ? ` · ${numbers.format(totals.estimated)} estimated` : ""}
            {totals.usd === undefined ? "" : ` · ${formatUsd(totals.usd)} estimated spend`}
            {totals.unpriced ? ` · ${numbers.format(totals.unpriced)} unpriced tokens` : ""}
          </p>
          <div className="dash-usage-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Provider / model</th>
                  <th scope="col">Input</th>
                  <th scope="col">Output</th>
                  <th scope="col">Est. spend</th>
                </tr>
              </thead>
              <tbody>
                {models.map((row) => (
                  <tr key={JSON.stringify([row.providerId, row.model])}>
                    <th scope="row">
                      <span>
                        {providers?.find((provider) => provider.id === row.providerId)?.name ??
                          row.providerName ??
                          row.providerId}
                      </span>
                      <small>{row.model || "Provider default"}</small>
                    </th>
                    <td>{numbers.format(row.inputTokens)}</td>
                    <td>{numbers.format(row.outputTokens)}</td>
                    <td>
                      {row.usd === undefined ? "Unpriced" : formatUsd(row.usd)}
                      {row.usd !== undefined && row.unpricedTokens ? <small>Partial</small> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dash-note">
            Usage recorded by this Locus server across Developer and Swarm.
          </p>
        </>
      ) : null}
    </section>
  );
}
