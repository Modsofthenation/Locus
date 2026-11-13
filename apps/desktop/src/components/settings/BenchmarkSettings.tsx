import { useEffect, useMemo, useState } from "react";
import {
  benchmarkTargetKey,
  formatUsd,
  type AiProvider,
  type BenchmarkTarget,
} from "@locus/shared";
import { api, type BenchmarkRunView } from "@/lib/api";
import { HowItWorks } from "./SettingsBits";

type Case = { id: string; title: string };

function seconds(ms?: number): string {
  return ms ? `${Math.max(1, Math.round(ms / 1000))}s` : "–";
}

/**
 * Settings → Benchmark. Runs the built-in coding cases as real Host agent turns against the
 * models you pick, then compares pass rate, cost and time.
 */
export function BenchmarkSettings(props: {
  providers: AiProvider[];
  onOpenSession?: (id: string) => void;
}) {
  const enabled = useMemo(() => props.providers.filter((p) => p.enabled), [props.providers]);
  const [cases, setCases] = useState<Case[]>([]);
  const [runs, setRuns] = useState<BenchmarkRunView[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [caseIds, setCaseIds] = useState<string[] | null>(null);
  const [repeat, setRepeat] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const running = runs.find((run) => run.status === "running");
  const runningId = running?.id;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.benchmarkCases(), api.benchmarkRuns()])
      .then(([c, r]) => {
        if (cancelled) return;
        setCases(c.cases);
        setRuns(r.runs);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load benchmarks");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!runningId) return;
    const timer = setInterval(() => {
      void api
        .benchmarkRuns()
        .then((r) => setRuns(r.runs))
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [runningId]);

  const targets: BenchmarkTarget[] = Object.entries(picked)
    .filter(([, model]) => model)
    .map(([providerId, model]) => ({ providerId, model }));
  const selectedCases = caseIds ?? cases.map((c) => c.id);
  const caseRuns = targets.length * selectedCases.length * repeat;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const run = await api.startBenchmark({ targets, caseIds: selectedCases, repeat });
      setRuns((rows) => [run, ...rows.filter((row) => row.id !== run.id)]);
      setOpen(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the benchmark");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="benchmark-settings" data-testid="benchmark-settings">
      <HowItWorks lead="Run the same small coding tasks against several models and compare pass rate, cost and time.">
        <p>
          Each case is a tiny JavaScript project with failing tests. Locus starts an autonomous Host
          agent on a fresh copy, sends the task, then runs <code>npm test</code> itself. A case
          passes only when the tests pass and the test files are unchanged. Cost is estimated from
          the provider’s rates. Benchmark chats are archived so you can open a failure and read it.
          Runs execute one case at a time and use your provider quota. Results are saved under{" "}
          <code>~/.locus/benchmarks</code>. CLI: <code>locus eval run --model provider/model</code>.
        </p>
      </HowItWorks>

      <section className="notify-card">
        <h4>Models</h4>
        {enabled.length ? (
          <ul className="notify-sources">
            {enabled.map((provider) => {
              const models = provider.models.length ? provider.models : [provider.defaultModel];
              const on = Boolean(picked[provider.id]);
              return (
                <li key={provider.id} className="notify-row">
                  <label className="benchmark-pick">
                    <input
                      type="checkbox"
                      checked={on}
                      data-testid={`benchmark-provider-${provider.id}`}
                      onChange={(event) =>
                        setPicked((cur) => {
                          const next = { ...cur };
                          if (event.target.checked) next[provider.id] = provider.defaultModel;
                          else delete next[provider.id];
                          return next;
                        })
                      }
                    />
                    <strong>{provider.name}</strong>
                  </label>
                  <select
                    aria-label={`${provider.name} model`}
                    disabled={!on}
                    value={picked[provider.id] ?? provider.defaultModel}
                    onChange={(event) =>
                      setPicked((cur) => ({ ...cur, [provider.id]: event.target.value }))
                    }
                  >
                    {[...new Set([provider.defaultModel, ...models])].map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hint">Enable a provider in Settings → Providers first.</p>
        )}
      </section>

      <section className="notify-card">
        <h4>Cases</h4>
        <ul className="notify-sources">
          {cases.map((row) => (
            <li key={row.id} className="notify-row">
              <label className="benchmark-pick">
                <input
                  type="checkbox"
                  checked={selectedCases.includes(row.id)}
                  onChange={(event) =>
                    setCaseIds(
                      event.target.checked
                        ? [...selectedCases, row.id]
                        : selectedCases.filter((id) => id !== row.id),
                    )
                  }
                />
                <strong>{row.title}</strong>
                <span className="hint">{row.id}</span>
              </label>
            </li>
          ))}
        </ul>
        <label className="benchmark-repeat">
          Runs per case
          <select value={repeat} onChange={(event) => setRepeat(Number(event.target.value))}>
            {[1, 2, 3, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="about-updates-actions">
          <button
            type="button"
            className="btn small primary"
            data-testid="benchmark-start"
            disabled={busy || Boolean(running) || !targets.length || !selectedCases.length}
            onClick={() => void start()}
          >
            {running
              ? "Benchmark running…"
              : `Run ${caseRuns || ""} case${caseRuns === 1 ? "" : "s"}`}
          </button>
          {running ? (
            <button
              type="button"
              className="btn small"
              onClick={() =>
                void api
                  .cancelBenchmark(running.id)
                  .then((run) => setRuns((rows) => rows.map((r) => (r.id === run.id ? run : r))))
              }
            >
              Cancel
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="hint" role="alert" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}
      </section>

      {runs.map((run) => {
        const done = run.results.filter((r) => r.status !== "pending" && r.status !== "running");
        return (
          <section key={run.id} className="notify-card benchmark-run" data-testid="benchmark-run">
            <button
              type="button"
              className="benchmark-run-head"
              aria-expanded={open === run.id}
              onClick={() => setOpen(open === run.id ? null : run.id)}
            >
              <strong>{new Date(run.createdAt).toLocaleString()}</strong>
              <span className="hint">
                {run.status === "running"
                  ? `Running · ${done.length}/${run.results.length}`
                  : run.status === "done"
                    ? "Done"
                    : run.status === "cancelled"
                      ? "Cancelled"
                      : `Error${run.error ? ` · ${run.error}` : ""}`}
              </span>
            </button>
            <table className="benchmark-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Passed</th>
                  <th>Cost</th>
                  <th>Median time</th>
                </tr>
              </thead>
              <tbody>
                {run.summary.map((row) => (
                  <tr key={benchmarkTargetKey(row.target)}>
                    <td>{benchmarkTargetKey(row.target)}</td>
                    <td>
                      {row.passed}/{row.total}
                      {row.total ? ` · ${Math.round(row.passRate * 100)}%` : ""}
                    </td>
                    <td>{row.usd != null ? formatUsd(row.usd) : "–"}</td>
                    <td>{seconds(row.medianMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {open === run.id ? (
              <table className="benchmark-table benchmark-cases">
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Model</th>
                    <th>Result</th>
                    <th>Time</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {run.results.map((row, i) => (
                    <tr key={`${row.caseId}-${i}`} data-status={row.status}>
                      <td>{row.caseId}</td>
                      <td>{benchmarkTargetKey(row.target)}</td>
                      <td title={row.testOutput}>
                        {row.status}
                        {row.reason && row.status !== "passed" ? ` · ${row.reason}` : ""}
                      </td>
                      <td>{seconds(row.durationMs)}</td>
                      <td>
                        {row.sessionId && props.onOpenSession ? (
                          <button
                            type="button"
                            className="btn small ghost"
                            onClick={() => props.onOpenSession?.(row.sessionId!)}
                          >
                            Open chat
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
