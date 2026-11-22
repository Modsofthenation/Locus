import { useEffect, useMemo, useState } from "react";
import {
  benchmarkTargetKey,
  formatUsd,
  type AiProvider,
  type BenchmarkComparison,
  type BenchmarkHistoryRow,
  type BenchmarkTarget,
} from "@locus/shared";
import { api, type BenchmarkRunView } from "@/lib/api";
import { HowItWorks } from "./SettingsBits";

type Case = { id: string; title: string; kind?: "toy" | "spec"; language?: string };

function percent(rate?: number): string {
  return rate === undefined ? "–" : `${Math.round(rate * 100)}%`;
}

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
  const [history, setHistory] = useState<BenchmarkHistoryRow[]>([]);
  const [compareIds, setCompareIds] = useState<{ a: string; b: string }>({ a: "", b: "" });
  const [comparison, setComparison] = useState<BenchmarkComparison | null>(null);

  const running = runs.find((run) => run.status === "running");
  const runningId = running?.id;
  const finished = runs.filter((run) => run.status !== "running");

  // History refreshes on mount and whenever a run stops.
  useEffect(() => {
    if (runningId) return;
    let cancelled = false;
    void api
      .benchmarkHistory()
      .then((r) => {
        if (!cancelled) setHistory(r.rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runningId]);

  async function compare() {
    setError(null);
    try {
      setComparison(await api.compareBenchmarks(compareIds.a, compareIds.b));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not compare the runs");
    }
  }

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
          Toy cases are tiny JavaScript projects with failing tests; bug-fix cases (TypeScript,
          Python, Go) start from a real-shaped repo at the commit before a fix and are scored with
          the fix’s hidden tests. Locus starts an autonomous Host agent on a fresh copy, sends the
          task, then runs the tests itself. A case passes only when the required tests pass and the
          test files are unchanged; a case whose toolchain is missing is skipped. Cost is estimated
          from the provider’s rates. Benchmark chats are archived so you can open a failure and read
          it. Runs execute one case at a time and use your provider quota. Results are saved under{" "}
          <code>~/.locus/benchmarks</code>. CLI: <code>locus bench run --model provider/model</code>
          , <code>locus bench mine &lt;repo&gt;</code> drafts cases from git history.
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
                <span className="hint">
                  {row.id}
                  {row.language ? ` · ${row.language}` : ""}
                </span>
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

      {history.length ? (
        <section className="notify-card" data-testid="benchmark-history">
          <h4>History</h4>
          <table className="benchmark-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Harness</th>
                <th>Runs</th>
                <th>Passed</th>
                <th>Cost / case</th>
                <th>Median time</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={`${row.providerId}/${row.model}/${row.harnessVersion}`}>
                  <td>
                    {row.providerId}/{row.model}
                  </td>
                  <td>
                    <code>{row.harnessVersion}</code>
                  </td>
                  <td>{row.runs}</td>
                  <td>
                    {row.passed}/{row.cases} · {percent(row.passRate)}
                  </td>
                  <td>{row.usdPerCase != null ? formatUsd(row.usdPerCase) : "–"}</td>
                  <td>{seconds(row.medianMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {finished.length >= 2 ? (
        <section className="notify-card" data-testid="benchmark-compare">
          <h4>Compare runs</h4>
          <div className="benchmark-compare-pick">
            {(["a", "b"] as const).map((side) => (
              <label key={side}>
                {side === "a" ? "Before" : "After"}
                <select
                  aria-label={side === "a" ? "Before run" : "After run"}
                  value={compareIds[side]}
                  onChange={(event) =>
                    setCompareIds((cur) => ({ ...cur, [side]: event.target.value }))
                  }
                >
                  <option value="">Pick a run</option>
                  {finished.map((run) => (
                    <option key={run.id} value={run.id}>
                      {new Date(run.createdAt).toLocaleString()} ·{" "}
                      {run.targets.map((t) => t.model).join(", ")}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button
              type="button"
              className="btn small"
              data-testid="benchmark-compare-go"
              disabled={!compareIds.a || !compareIds.b || compareIds.a === compareIds.b}
              onClick={() => void compare()}
            >
              Compare
            </button>
          </div>
          {comparison ? (
            <>
              <p className="hint">
                {percent(comparison.a.passRate)} → {percent(comparison.b.passRate)} ·{" "}
                {comparison.fixed} fixed · {comparison.broke} broke
              </p>
              <table className="benchmark-table benchmark-flips">
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Model</th>
                    <th>Before</th>
                    <th>After</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows
                    .filter((row) => !row.change.startsWith("still-"))
                    .map((row) => (
                      <tr key={`${row.caseId}/${row.target}`} data-change={row.change}>
                        <td>{row.caseId}</td>
                        <td>{row.target}</td>
                        <td>{percent(row.before)}</td>
                        <td>{percent(row.after)}</td>
                        <td>{row.change}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          ) : null}
        </section>
      ) : null}

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
              {run.harness ? <code className="hint">{run.harness.key}</code> : null}
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
                        {row.failingTests?.length ? ` (${row.failingTests.join(", ")})` : ""}
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
