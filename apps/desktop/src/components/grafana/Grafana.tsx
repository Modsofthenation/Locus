import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  GRAFANA_RANGES,
  grafanaAlertLucene,
  grafanaAlertRange,
  grafanaDashboardOpenUrl,
  grafanaDisplayMessage,
  grafanaLogPreview,
  grafanaPanelHeadline,
  heuristicGrafanaBriefing,
  normalizeGrafanaLevel,
  splitGrafanaHighlights,
  type GrafanaAlert,
  type GrafanaAnnotation,
  type GrafanaBriefing,
  type GrafanaDashboardHit,
  type GrafanaDashboardQueryResult,
  type GrafanaDashboardVariable,
  type GrafanaExplorerStatus,
  type GrafanaLogHitLite,
  type GrafanaPanelResult,
  type GrafanaPin,
  type GrafanaRecentQuery,
  type GrafanaRepoLink,
  type GrafanaTraceHop,
  type GrafanaTraceResult,
} from "@locus/shared";
import { api } from "@/lib/api";
import { loadLastAgent, pickProvider } from "@/lib/lastAgent";
import { SECTION_FEATURE_HINTS } from "@/lib/discoverability";
import { FeatureHintRow } from "@/components/layout/FeatureHint";
import { Mascot } from "@/components/layout/Mascot";
import { openSettings, sectionQuery, useStore } from "@/state/store";

const DEFAULT_QUERY = "logger.level:error";
const RANGE_LABEL: Record<(typeof GRAFANA_RANGES)[number], string> = {
  "now-15m": "15m",
  "now-1h": "1h",
  "now-6h": "6h",
  "now-24h": "24h",
  "now-7d": "7d",
};

type QueryResult = {
  lucene: string;
  explore_url: string;
  from: string;
  to: string;
  count?: number;
  histogram?: Array<{ t: number; count: number }>;
  logs?: Array<GrafanaLogHitLite & { source?: Record<string, unknown> }>;
  datasource?: { name?: string };
};

export function GrafanaPane() {
  const { state, dispatch } = useStore();
  const [status, setStatus] = useState<GrafanaExplorerStatus | null>(null);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [from, setFrom] = useState("now-1h");
  const [datasource, setDatasource] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [trace, setTrace] = useState<GrafanaTraceResult | null>(null);
  const [briefing, setBriefing] = useState<GrafanaBriefing | null>(null);
  const [recents, setRecents] = useState<GrafanaRecentQuery[]>([]);
  const [dashboards, setDashboards] = useState<GrafanaDashboardHit[]>([]);
  const [alerts, setAlerts] = useState<GrafanaAlert[]>([]);
  const [pins, setPins] = useState<GrafanaPin[]>([]);
  const [tag, setTag] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [refreshMs, setRefreshMs] = useState(0);
  const [to, setTo] = useState("now");
  const [traceHop, setTraceHop] = useState<GrafanaTraceHop | null>(null);
  const [repoLinks, setRepoLinks] = useState<GrafanaRepoLink[]>([]);
  const [dashboardUid, setDashboardUid] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<GrafanaDashboardQueryResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dashReq = useRef(0);
  const filter = sectionQuery(state);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.grafanaStatus(),
      api.grafanaRecents(),
      api.grafanaDashboards().catch(() => []),
      loadRows(() => api.grafanaAlerts()),
      loadRows(() => api.grafanaPins()),
    ])
      .then(([next, recentRows, dashRows, alertRows, pinRows]) => {
        if (cancelled) return;
        setStatus(next);
        setRecents(recentRows);
        setDashboards(dashRows);
        setAlerts(alertRows);
        setPins(pinRows);
        const preferred = next.datasources.find(
          (row) => row.isDefault && row.type === "elasticsearch",
        );
        if (preferred) setDatasource((cur) => cur || preferred.name);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load Grafana");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(kind: string, fn: () => Promise<void>, alive = () => true): Promise<void> {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (!alive()) return;
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      if (alive()) setBusy(null);
    }
  }

  function onQuery(e: FormEvent): void {
    e.preventDefault();
    void runQuery(query);
  }

  async function runQuery(lucene: string, range = from, toArg = to): Promise<void> {
    const next = lucene.trim();
    if (!next) return;
    setDashboardUid(null);
    setDashboard(null);
    await run("query", async () => {
      const body = await api.grafanaQuery({
        query: next,
        from: range,
        to: toArg || "now",
        datasource: datasource || undefined,
        enrich: true,
      });
      setQuery(next);
      setFrom(range);
      setTo(toArg || "now");
      setResult(body);
      setSelected(0);
      setTrace(body.trace ?? null);
      setTraceHop(body.traceHop ?? null);
      setRepoLinks(body.links ?? []);
      setBriefing(null);
      setRecents(await api.grafanaRecents());
    });
  }

  async function openDashboard(
    uid: string,
    range?: string,
    toArg?: string,
    vars?: Record<string, string>,
    quiet = false,
  ): Promise<void> {
    const next = uid.trim();
    if (!next) return;
    const same = next === dashboardUid;
    const chosen = vars ?? (same ? variables : undefined);
    const req = ++dashReq.current;
    setDashboardUid(next);
    if (!same && !quiet) {
      setDashboard(null);
      setVariables({});
    }
    await run(
      quiet ? "refresh" : "dashboard",
      async () => {
        const input: { from?: string; to?: string; variables?: Record<string, string> } = {};
        if (range) input.from = range;
        if (toArg) input.to = toArg;
        if (chosen && Object.keys(chosen).length) input.variables = chosen;
        const body = await api.grafanaDashboardQuery(next, input);
        if (req !== dashReq.current) return;
        setDashboard(body);
        if (body.from) setFrom(body.from);
        if (body.to) setTo(body.to);
        if (!quiet && (!same || vars)) {
          const seeded: Record<string, string> = {};
          for (const row of body.variables ?? [])
            seeded[row.name] = vars?.[row.name] ?? row.current;
          setVariables(seeded);
        }
      },
      () => req === dashReq.current,
    );
  }

  function backToLogs(): void {
    setDashboardUid(null);
    setDashboard(null);
  }

  function onApplyRange(nextFrom: string, nextTo = "now"): void {
    const fromValue = nextFrom.trim();
    const toValue = nextTo.trim() || "now";
    if (!fromValue) return;
    setFrom(fromValue);
    setTo(toValue);
    if (dashboardUid) void openDashboard(dashboardUid, fromValue, toValue, variables);
    else if (result) void runQuery(query, fromValue, toValue);
  }

  function onBucket(start: number, end: number): void {
    onApplyRange(new Date(start).toISOString(), new Date(end).toISOString());
  }

  function onVariable(name: string, value: string): void {
    const next = { ...variables, [name]: value };
    setVariables(next);
    if (dashboardUid) void openDashboard(dashboardUid, from, to, next);
  }

  function onAlert(alert: GrafanaAlert): void {
    const range = grafanaAlertRange(alert);
    setFrom(range.from);
    setTo(range.to);
    if (alert.dashboardUid) void openDashboard(alert.dashboardUid, range.from, range.to);
    else void runQuery(grafanaAlertLucene(alert), range.from, range.to);
  }

  function onOpenLink(link: GrafanaRepoLink): void {
    const matches = state.sessions.filter((row) => row.repoId === link.repoId && !row.archived);
    const session =
      matches.find((row) => row.runtime === "host" || row.kind === "ide") ?? matches[0];
    if (session && link.path) {
      dispatch({ type: "select", id: session.id });
      dispatch({
        type: "openWorkspace",
        open: {
          sessionId: session.id,
          path: link.path,
          line: link.line,
          follow: true,
          at: Date.now(),
        },
      });
      return;
    }
    dispatch({ type: "selectRepo", id: link.repoId });
  }

  async function togglePin(row: GrafanaDashboardHit): Promise<void> {
    if (pins.some((pin) => pin.uid === row.uid)) await api.grafanaUnpin(row.uid);
    else await api.grafanaPin({ uid: row.uid, title: row.title });
    setPins(await loadRows(() => api.grafanaPins()));
  }

  function onInvestigatePanel(panel: GrafanaPanelResult): void {
    const lucene = panel.queries[0]?.trim();
    if (!lucene) return;
    const prefs = loadLastAgent();
    const provider = pickProvider(state.config?.providers ?? [], prefs);
    const links = (dashboard?.annotations ?? [])
      .filter((row) => !row.panelId || row.panelId === panel.id)
      .flatMap((row) => row.links ?? []);
    void run("investigate", async () => {
      const created = await api.grafanaInvestigate({
        query: lucene,
        from: dashboard?.from || from,
        to: dashboard?.to || to,
        note: `${panel.title}: ${grafanaPanelHeadline(panel)}`,
        logs: panel.logs,
        links: links.length ? links : undefined,
        exploreUrl: dashboard?.url,
        repoId: links[0]?.repoId,
        providerId: provider?.id,
        model: prefs.model || provider?.defaultModel,
        panelType: panel.type,
      });
      dispatch({ type: "select", id: created.sessionId });
    });
  }

  function onBrief(): void {
    const logs = result?.logs ?? [];
    void run("brief", async () => {
      const next = await api.grafanaBrief({
        query: result?.lucene || query,
        from,
        to: "now",
        logs,
      });
      setBriefing(next);
    });
  }

  function onInvestigate(e: FormEvent): void {
    e.preventDefault();
    const prefs = loadLastAgent();
    const provider = pickProvider(state.config?.providers ?? [], prefs);
    void run("investigate", async () => {
      const created = await api.grafanaInvestigate({
        query: result?.lucene || query,
        from,
        to,
        note: note.trim() || undefined,
        logs: result?.logs,
        links: trace?.links,
        exploreUrl: result?.explore_url,
        repoId: trace?.links[0]?.repoId,
        providerId: provider?.id,
        model: prefs.model || provider?.defaultModel,
      });
      dispatch({ type: "select", id: created.sessionId });
    });
  }

  const logs = result?.logs ?? [];
  const hit = logs[selected];
  const connected = Boolean(status?.connected);
  const filteredRecents = recents.filter(
    (row) => !filter || row.query.toLowerCase().includes(filter.toLowerCase()),
  );
  const filteredDashboards = dashboards.filter((row) => {
    if (tag && !(row.tags ?? []).includes(tag)) return false;
    if (!filter) return true;
    const hay = `${row.title} ${row.folderTitle ?? ""} ${(row.tags ?? []).join(" ")}`.toLowerCase();
    return hay.includes(filter.toLowerCase());
  });
  const tags = [...new Set(dashboards.flatMap((row) => row.tags ?? []))].slice(0, 12);
  const pinnedHits = pins.map(
    (pin) =>
      dashboards.find((row) => row.uid === pin.uid) ?? {
        uid: pin.uid,
        title: pin.title,
      },
  );
  const linkRows = repoLinks;
  const fallbackBrief = useMemo(() => {
    const rows = result?.logs;
    return rows?.length ? heuristicGrafanaBriefing(rows) : null;
  }, [result?.logs]);
  const shownBrief = briefing ?? fallbackBrief;

  const refreshRef = useRef<() => void>(() => {});
  refreshRef.current = () => {
    if (!dashboardUid) return;
    void openDashboard(dashboardUid, from, to, variables, true);
  };
  useEffect(() => {
    if (!dashboardUid || refreshMs <= 0) return;
    const id = window.setInterval(() => refreshRef.current(), refreshMs);
    return () => window.clearInterval(id);
  }, [dashboardUid, refreshMs]);

  if (!status) {
    return (
      <div className="grafana-pane" data-testid="grafana-booting">
        <div className="grafana-body grafana-body-center">
          <p className="muted">Loading Grafana…</p>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="grafana-pane grafana-empty">
        <div className="grafana-body grafana-body-center">
          <div className="empty-card">
            <Mascot pose="rest" size={48} />
            <h2>Grafana explorer</h2>
            <p>
              Open Grafana dashboards, query Elasticsearch logs, trace stack frames into linked
              repos, and start an Ops loop agent.
            </p>
            <button
              type="button"
              className="btn primary"
              onClick={() => openSettings(dispatch, "integrations")}
            >
              Add Grafana
            </button>
            {SECTION_FEATURE_HINTS.grafana ? (
              <FeatureHintRow hint={SECTION_FEATURE_HINTS.grafana} />
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grafana-pane">
      <div className="grafana-layout">
        <aside className="grafana-rail" aria-label="Grafana catalog">
          <section>
            <h3>Firing</h3>
            {alerts.length === 0 ? (
              <p className="muted">No firing alerts.</p>
            ) : (
              <ul>
                {alerts.map((row) => (
                  <li key={row.fingerprint}>
                    <button type="button" onClick={() => onAlert(row)}>
                      <span className="title-text">{row.name}</span>
                      <span className="muted">{row.summary || row.labels.service || "firing"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {pinnedHits.length ? (
            <section>
              <h3>Pinned</h3>
              <ul>
                {pinnedHits.map((row) => (
                  <li key={row.uid} className="grafana-dash-row">
                    <button
                      type="button"
                      className={dashboardUid === row.uid ? "active" : ""}
                      onClick={() => void openDashboard(row.uid)}
                    >
                      <span className="title-text">{row.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <h3>Recent queries</h3>
            {filteredRecents.length === 0 ? (
              <p className="muted">Run a Lucene query to keep it here.</p>
            ) : (
              <ul>
                {filteredRecents.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={result?.lucene === row.query ? "active" : ""}
                      onClick={() => void runQuery(row.query, (row.from as typeof from) || from)}
                    >
                      <span className="title-text">{row.query}</span>
                      <span className="muted">
                        {RANGE_LABEL[row.from as keyof typeof RANGE_LABEL] ?? row.from}
                        {row.count != null ? ` · ${row.count}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>Dashboards</h3>
            {tags.length ? (
              <div className="grafana-tags" role="group" aria-label="Dashboard tags">
                <button
                  type="button"
                  className={`btn small ghost ${tag ? "" : "on"}`}
                  onClick={() => setTag("")}
                >
                  All
                </button>
                {tags.map((row) => (
                  <button
                    key={row}
                    type="button"
                    className={`btn small ghost ${tag === row ? "on" : ""}`}
                    onClick={() => setTag(tag === row ? "" : row)}
                  >
                    {row}
                  </button>
                ))}
              </div>
            ) : null}
            {filteredDashboards.length === 0 ? (
              <p className="muted">No dashboards from this token yet.</p>
            ) : (
              groupDashboards(filteredDashboards).map((group) => (
                <div key={group.folder}>
                  {group.folder !== "Dashboards" ? <h4>{group.folder}</h4> : null}
                  <ul>
                    {group.rows.map((row) => (
                      <li key={row.uid} className="grafana-dash-row">
                        <button
                          type="button"
                          className={dashboardUid === row.uid ? "active" : ""}
                          onClick={() => void openDashboard(row.uid)}
                        >
                          <span className="title-text">{row.title}</span>
                          {row.tags?.length ? (
                            <span className="muted">{row.tags.slice(0, 3).join(" · ")}</span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className="grafana-pin"
                          aria-pressed={pins.some((pin) => pin.uid === row.uid)}
                          aria-label={
                            pins.some((pin) => pin.uid === row.uid)
                              ? `Unpin ${row.title}`
                              : `Pin ${row.title}`
                          }
                          onClick={() => void togglePin(row)}
                        >
                          {pins.some((pin) => pin.uid === row.uid) ? "Unpin" : "Pin"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        </aside>
        <div className="grafana-main">
          {dashboardUid ? (
            <div className="grafana-toolbar">
              <button type="button" className="btn ghost" onClick={backToLogs}>
                Logs
              </button>
              <h2 className="grafana-dash-title">
                {dashboard?.title ??
                  dashboards.find((row) => row.uid === dashboardUid)?.title ??
                  pinnedHits.find((row) => row.uid === dashboardUid)?.title ??
                  "Dashboard"}
              </h2>
              <GrafanaRanges from={from} onPick={(range) => onApplyRange(range, "now")} />
              <GrafanaCustomRange from={from} to={to} onApply={onApplyRange} />
              <label>
                Refresh
                <select
                  aria-label="Refresh"
                  value={String(refreshMs)}
                  onChange={(e) => setRefreshMs(Number(e.target.value))}
                >
                  <option value="0">Off</option>
                  <option value="15000">15s</option>
                  <option value="30000">30s</option>
                  <option value="60000">1m</option>
                </select>
              </label>
              {dashboard?.url ? (
                <a
                  className="btn ghost"
                  href={grafanaDashboardOpenUrl(dashboard.url, dashboard.from, dashboard.to)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Grafana
                </a>
              ) : null}
            </div>
          ) : (
            <form className="grafana-toolbar" onSubmit={onQuery}>
              <label className="grafana-query">
                Lucene
                <input
                  value={query}
                  spellCheck={false}
                  placeholder="logger.level:error"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <GrafanaRanges from={from} onPick={(range) => onApplyRange(range, "now")} />
              <GrafanaCustomRange from={from} to={to} onApply={onApplyRange} />
              {status.datasources.length > 1 ? (
                <label>
                  Datasource
                  <select value={datasource} onChange={(e) => setDatasource(e.target.value)}>
                    <option value="">Auto</option>
                    {status.datasources.map((row) => (
                      <option key={row.uid || row.name} value={row.name}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button type="submit" className="btn primary" disabled={busy === "query"}>
                {busy === "query" ? "Querying…" : "Run"}
              </button>
              {result?.explore_url ? (
                <a className="btn ghost" href={result.explore_url} target="_blank" rel="noreferrer">
                  Open in Grafana
                </a>
              ) : null}
            </form>
          )}
          {status.error ? <p className="error">{status.error}</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {dashboardUid ? (
            <>
              <GrafanaVariables
                variables={dashboard?.variables ?? []}
                values={variables}
                onChange={onVariable}
              />
              <GrafanaDashboardGrid
                dashboard={dashboard}
                busy={busy === "dashboard"}
                investigating={busy === "investigate"}
                onOpenLogs={(lucene) => void runQuery(lucene, from, to)}
                onInvestigate={onInvestigatePanel}
                onOpenLink={onOpenLink}
              />
            </>
          ) : (
            <>
              <GrafanaHistogram buckets={result?.histogram ?? []} onBucket={onBucket} />
              <div className="grafana-split">
                <section className="grafana-logs" aria-label="Logs">
                  <header>
                    <h3>Logs</h3>
                    <span className="muted">
                      {result
                        ? `${(result.count ?? logs.length).toLocaleString()} hits`
                        : "No query yet"}
                    </span>
                  </header>
                  {logs.length === 0 ? (
                    <p className="muted">
                      {result
                        ? "No documents. Widen the range or loosen the query."
                        : "Default query is logger.level:error over the last hour."}
                    </p>
                  ) : (
                    <ol>
                      {logs.map((row, idx) => (
                        <li key={`${row.timestamp ?? "t"}-${idx}`}>
                          <button
                            type="button"
                            className={idx === selected ? "active" : ""}
                            onClick={() => setSelected(idx)}
                          >
                            <span
                              className={`grafana-level grafana-level-${normalizeGrafanaLevel(row.level)}`}
                            >
                              {normalizeGrafanaLevel(row.level)}
                            </span>
                            <span className="grafana-log-when">{formatWhen(row.timestamp)}</span>
                            <GrafanaLogMessage
                              text={grafanaDisplayMessage(row) || grafanaLogPreview(row.source)}
                            />
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
                <section className="grafana-inspect" aria-label="Investigate">
                  <header>
                    <h3>Trace & AI</h3>
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={onBrief}
                      disabled={!logs.length || busy === "brief"}
                    >
                      {busy === "brief" ? "Reading…" : "AI brief"}
                    </button>
                  </header>
                  {shownBrief ? (
                    <div className="grafana-brief" data-testid="grafana-brief">
                      <p className={`grafana-severity grafana-severity-${shownBrief.severity}`}>
                        {shownBrief.severity}
                      </p>
                      <p>{shownBrief.summary}</p>
                      {shownBrief.hypotheses.length ? (
                        <ul>
                          {shownBrief.hypotheses.map((row) => (
                            <li key={row}>{row}</li>
                          ))}
                        </ul>
                      ) : null}
                      {shownBrief.nextQueries.length ? (
                        <div className="grafana-chips">
                          {shownBrief.nextQueries.map((row) => (
                            <button
                              key={row}
                              type="button"
                              className="btn small ghost"
                              onClick={() => void runQuery(row)}
                            >
                              {row}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="muted">
                      Run a query to extract stack frames and brief the failure.
                    </p>
                  )}
                  {traceHop ? (
                    <div className="grafana-spans" data-testid="grafana-spans">
                      <h4>{traceHop.datasource ? `Trace · ${traceHop.datasource}` : "Trace"}</h4>
                      {traceHop.error ? <p className="error">{traceHop.error}</p> : null}
                      {traceHop.spans.length ? (
                        <ol>
                          {traceHop.spans.slice(0, 12).map((span) => (
                            <li key={span.spanId || `${span.service}-${span.operation}`}>
                              <span className="title-text">
                                {[span.service, span.operation].filter(Boolean).join(" ")}
                              </span>
                              {span.durationMs != null ? (
                                <span className="muted">{Math.round(span.durationMs)}ms</span>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      ) : traceHop.error ? null : (
                        <p className="muted">No spans for {traceHop.traceId}.</p>
                      )}
                    </div>
                  ) : null}
                  <GrafanaLinks links={linkRows} onOpenLink={onOpenLink} />
                  {hit ? <GrafanaSource hit={hit} /> : null}
                  <form className="grafana-investigate" onSubmit={onInvestigate}>
                    <label>
                      Investigate with an Ops loop agent
                      <textarea
                        value={note}
                        placeholder="What failed? Any host, customer, or ticket?"
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      className="btn primary"
                      disabled={busy === "investigate" || !query.trim()}
                    >
                      {busy === "investigate" ? "Starting…" : "Investigate"}
                    </button>
                  </form>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GrafanaRanges({
  from,
  onPick,
}: {
  from: string;
  onPick: (range: (typeof GRAFANA_RANGES)[number]) => void;
}) {
  return (
    <div className="grafana-ranges" role="group" aria-label="Time range">
      {GRAFANA_RANGES.map((row) => (
        <button
          key={row}
          type="button"
          className={`btn small ghost ${from === row ? "on" : ""}`}
          aria-pressed={from === row}
          onClick={() => onPick(row)}
        >
          {RANGE_LABEL[row]}
        </button>
      ))}
    </div>
  );
}

function GrafanaCustomRange({
  from,
  to,
  onApply,
}: {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
}) {
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  useEffect(() => {
    setDraftFrom(from);
    setDraftTo(to);
  }, [from, to]);
  return (
    <>
      <label>
        From
        <input
          aria-label="From"
          value={draftFrom}
          onChange={(e) => setDraftFrom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onApply(draftFrom, draftTo);
            }
          }}
        />
      </label>
      <label>
        To
        <input
          aria-label="To"
          value={draftTo}
          onChange={(e) => setDraftTo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onApply(draftFrom, draftTo);
            }
          }}
        />
      </label>
      <button type="button" className="btn small ghost" onClick={() => onApply(draftFrom, draftTo)}>
        Apply
      </button>
    </>
  );
}

function GrafanaVariables({
  variables,
  values,
  onChange,
}: {
  variables: GrafanaDashboardVariable[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  if (!variables.length) return null;
  return (
    <div className="grafana-vars">
      {variables.map((row) => {
        const value = values[row.name] ?? row.current;
        const label = row.label || row.name;
        return (
          <div key={row.name} className="grafana-var">
            <span className="grafana-var-name">{label}</span>
            {row.type === "textbox" ? (
              <input
                aria-label={label}
                defaultValue={value}
                key={`${row.name}:${value}`}
                onBlur={(e) => {
                  if (e.target.value !== value) onChange(row.name, e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onChange(row.name, (e.target as HTMLInputElement).value);
                }}
              />
            ) : row.multi ? (
              <GrafanaMultiVariable row={row} value={value} onChange={onChange} />
            ) : (
              <select
                aria-label={label}
                value={value}
                onChange={(e) => onChange(row.name, e.target.value)}
              >
                {row.includeAll ? <option value="$__all">All</option> : null}
                {row.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.text}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GrafanaMultiVariable({
  row,
  value,
  onChange,
}: {
  row: GrafanaDashboardVariable;
  value: string;
  onChange: (name: string, value: string) => void;
}) {
  const selected = new Set(splitGrafanaVar(value));
  const allOn = selected.has("$__all") || selected.has("All");
  const summary = grafanaVarSummary(row, selected);
  const label = row.label || row.name;
  return (
    <details className="grafana-var-menu">
      <summary aria-label={label} title={summary}>
        {summary}
      </summary>
      <div className="grafana-var-menu-list" role="group" aria-label={label}>
        {row.includeAll ? (
          <label className="grafana-var-option">
            <input
              type="checkbox"
              checked={allOn}
              onChange={(e) => onChange(row.name, e.target.checked ? "$__all" : "")}
            />
            All
          </label>
        ) : null}
        {row.options.map((opt) => (
          <label key={opt.value} className="grafana-var-option">
            <input
              type="checkbox"
              checked={!allOn && selected.has(opt.value)}
              onChange={(e) =>
                onChange(row.name, toggleGrafanaVar(value, opt.value, e.target.checked))
              }
            />
            {opt.text}
          </label>
        ))}
      </div>
    </details>
  );
}

function splitGrafanaVar(value: string): string[] {
  return value
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function toggleGrafanaVar(value: string, option: string, checked: boolean): string {
  const next = new Set(splitGrafanaVar(value).filter((row) => row !== "$__all" && row !== "All"));
  if (checked) next.add(option);
  else next.delete(option);
  return [...next].join("|");
}

function grafanaVarSummary(row: GrafanaDashboardVariable, selected: Set<string>): string {
  if (selected.has("$__all") || selected.has("All")) return "All";
  const values = [...selected];
  if (!values.length) return "Select…";
  if (values.length === 1) {
    return row.options.find((opt) => opt.value === values[0])?.text ?? values[0]!;
  }
  return `${values.length} selected`;
}

function GrafanaDashboardSkeleton() {
  return (
    <div
      className="grafana-dash-grid grafana-dash-skeleton"
      data-testid="grafana-dashboard"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="grafana-dash-skel-panel" style={{ gridColumn: "span 12", gridRow: "span 8" }}>
        <span className="skeleton line" />
        <span className="skeleton block" />
      </div>
      <div className="grafana-dash-skel-panel" style={{ gridColumn: "span 12", gridRow: "span 8" }}>
        <span className="skeleton line" />
        <span className="skeleton block" />
      </div>
      <div className="grafana-dash-skel-panel" style={{ gridColumn: "span 24", gridRow: "span 6" }}>
        <span className="skeleton line" />
        <span className="skeleton block" />
      </div>
    </div>
  );
}

function GrafanaDashboardGrid({
  dashboard,
  busy,
  investigating,
  onOpenLogs,
  onInvestigate,
  onOpenLink,
}: {
  dashboard: GrafanaDashboardQueryResult | null;
  busy: boolean;
  investigating: boolean;
  onOpenLogs: (lucene: string) => void;
  onInvestigate: (panel: GrafanaPanelResult) => void;
  onOpenLink: (link: GrafanaRepoLink) => void;
}) {
  if (!dashboard && busy) return <GrafanaDashboardSkeleton />;
  if (!dashboard) {
    return (
      <div className="grafana-dash-grid grafana-dash-empty" data-testid="grafana-dashboard">
        <p className="muted">Pick a dashboard from the catalog.</p>
      </div>
    );
  }
  if (!dashboard.panels.length) {
    return (
      <div className="grafana-dash-grid grafana-dash-empty" data-testid="grafana-dashboard">
        <p className="muted">This dashboard has no panels.</p>
      </div>
    );
  }
  return (
    <div className="grafana-dash-grid" data-testid="grafana-dashboard">
      {dashboard.panels.map((panel) => (
        <GrafanaDashboardPanelCard
          key={panel.id}
          panel={panel}
          annotations={dashboard.annotations ?? []}
          investigating={investigating}
          onOpenLogs={onOpenLogs}
          onInvestigate={onInvestigate}
          onOpenLink={onOpenLink}
        />
      ))}
    </div>
  );
}

function GrafanaDashboardPanelCard({
  panel,
  annotations,
  investigating,
  onOpenLogs,
  onInvestigate,
  onOpenLink,
}: {
  panel: GrafanaPanelResult;
  annotations: GrafanaAnnotation[];
  investigating: boolean;
  onOpenLogs: (lucene: string) => void;
  onInvestigate: (panel: GrafanaPanelResult) => void;
  onOpenLink: (link: GrafanaRepoLink) => void;
}) {
  const lucene = panel.queries[0];
  const marks = annotations.filter((row) => !row.panelId || row.panelId === panel.id);
  const pos = panel.gridPos;
  return (
    <article
      className={`grafana-dash-panel grafana-dash-panel-${panel.type}`}
      style={{
        gridColumn: `${pos.x + 1} / span ${pos.w}`,
        gridRow: `${pos.y + 1} / span ${pos.h}`,
      }}
    >
      <header>
        <h3>{panel.title}</h3>
        <span className="muted">{grafanaPanelHeadline(panel)}</span>
      </header>
      <GrafanaDashboardPanelBody panel={panel} annotations={marks} onOpenLink={onOpenLink} />
      {lucene ? (
        <div className="grafana-dash-actions">
          <button type="button" className="btn small ghost" onClick={() => onOpenLogs(lucene)}>
            {panel.type === "logs" ? "Query logs" : "Open query"}
          </button>
          <button
            type="button"
            className="btn small ghost"
            disabled={investigating}
            onClick={() => onInvestigate(panel)}
          >
            Investigate
          </button>
        </div>
      ) : null}
    </article>
  );
}

function GrafanaDashboardPanelBody({
  panel,
  annotations,
  onOpenLink,
}: {
  panel: GrafanaPanelResult;
  annotations: GrafanaAnnotation[];
  onOpenLink: (link: GrafanaRepoLink) => void;
}) {
  if (panel.error) return <p className="error">{panel.error}</p>;
  if (panel.stat) {
    return (
      <p className="grafana-dash-stat">
        {panel.stat.value}
        {panel.stat.unit ? <span className="muted">{panel.stat.unit}</span> : null}
      </p>
    );
  }
  if (panel.series?.length) {
    return (
      <div className="grafana-dash-series">
        {panel.series.slice(0, 3).map((row) => (
          <div key={row.name} className="grafana-dash-spark">
            {panel.series!.length > 1 ? (
              <span className="grafana-dash-spark-name muted">{row.name}</span>
            ) : null}
            <GrafanaHistogram
              buckets={row.points.map((point) => ({ t: point.t, count: point.value }))}
              annotations={annotations}
              onOpenLink={onOpenLink}
            />
          </div>
        ))}
      </div>
    );
  }
  if (panel.table) {
    return (
      <div className="grafana-dash-table-wrap">
        <table className="grafana-dash-table">
          <thead>
            <tr>
              {panel.table.columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {panel.table.rows.map((row, idx) => (
              <tr key={idx}>
                {row.map((cell, cellIdx) => (
                  <td key={cellIdx}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (panel.logs?.length) {
    return (
      <ol className="grafana-dash-logs">
        {panel.logs.slice(0, 8).map((row, idx) => (
          <li key={`${row.timestamp ?? "t"}-${idx}`}>
            <span className="grafana-log-when">{formatWhen(row.timestamp)}</span>
            <GrafanaLogMessage text={grafanaDisplayMessage(row) || grafanaLogPreview(row.source)} />
          </li>
        ))}
      </ol>
    );
  }
  if (panel.text?.trim()) return <div className="grafana-dash-text">{panel.text}</div>;
  return <p className="muted">No data</p>;
}

function GrafanaHistogram({
  buckets,
  annotations = [],
  onBucket,
  onOpenLink,
}: {
  buckets: Array<{ t: number; count: number }>;
  annotations?: GrafanaAnnotation[];
  onBucket?: (start: number, end: number) => void;
  onOpenLink?: (link: GrafanaRepoLink) => void;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (!buckets.length && !annotations.length) {
    return <div className="grafana-histogram grafana-histogram-empty" />;
  }
  const max = Math.max(1, ...buckets.map((row) => row.count));
  const start = buckets[0]?.t ?? annotations[0]?.time ?? 0;
  const end = buckets.at(-1)?.t ?? start + 1;
  const open = annotations.find((row) => row.id === openId);
  return (
    <div className="grafana-histogram-wrap">
      <div className="grafana-histogram" role="img" aria-label="Log volume">
        {buckets.map((row, idx) => {
          const next =
            buckets[idx + 1]?.t ??
            row.t + Math.max(1_000, (end - start) / Math.max(buckets.length, 1));
          const style = { height: `${Math.max(4, Math.round((row.count / max) * 100))}%` };
          const title = `${new Date(row.t).toISOString()} · ${row.count}`;
          if (!onBucket) return <span key={row.t} title={title} style={style} />;
          return (
            <button
              key={row.t}
              type="button"
              title={title}
              style={style}
              onClick={() => onBucket(row.t, next)}
            />
          );
        })}
      </div>
      {annotations.length ? (
        <div className="grafana-annotations">
          {annotations.map((row) => (
            <button
              key={row.id}
              type="button"
              className="grafana-annotation"
              style={{ left: markerLeft(row.time, start, end) }}
              title={row.text}
              aria-label={row.text || "Annotation"}
              onClick={() => setOpenId(openId === row.id ? null : row.id)}
            />
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="grafana-annotation-card">
          <p>{open.text || "Annotation"}</p>
          {open.tags.length ? <p className="muted">{open.tags.join(" · ")}</p> : null}
          {open.signals
            .filter((row) => row.kind === "sha" || row.kind === "pr")
            .map((row) => (
              <p key={`${row.kind}:${row.value}`} className="muted">
                {row.kind === "pr" ? `PR #${row.value}` : row.value}
              </p>
            ))}
          {(open.links ?? []).map((link) => (
            <button
              key={`${link.repoId}:${link.path ?? ""}`}
              type="button"
              onClick={() => onOpenLink?.(link)}
            >
              {link.repoName}
              {link.path ? ` ${link.path}` : ""}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GrafanaLinks({
  links,
  onOpenLink,
}: {
  links: GrafanaRepoLink[];
  onOpenLink: (link: GrafanaRepoLink) => void;
}) {
  if (!links.length) return null;
  return (
    <div className="grafana-links">
      <h4>Repo links</h4>
      <ul>
        {links.map((link) => (
          <li key={`${link.repoId}:${link.path ?? ""}:${link.line ?? ""}`}>
            <button type="button" onClick={() => onOpenLink(link)}>
              <span className="title-text">{link.repoName}</span>
              {link.path ? (
                <span className="grafana-link-path">
                  {link.path}
                  {link.line != null ? `:${link.line}` : ""}
                </span>
              ) : null}
            </button>
            <span className="muted">{link.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function markerLeft(time: number, start: number, end: number): string {
  const span = Math.max(1, end - start);
  const pct = ((time - start) / span) * 100;
  return `${Math.min(98, Math.max(0, pct))}%`;
}

async function loadRows<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    const rows = await fn();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function groupDashboards(
  rows: GrafanaDashboardHit[],
): Array<{ folder: string; rows: GrafanaDashboardHit[] }> {
  const map = new Map<string, GrafanaDashboardHit[]>();
  for (const row of rows) {
    const folder = row.folderTitle?.trim() || "Dashboards";
    const list = map.get(folder) ?? [];
    list.push(row);
    map.set(folder, list);
  }
  return [...map.entries()].map(([folder, items]) => ({ folder, rows: items }));
}

function formatWhen(value?: string): string {
  if (!value) return "";
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return value;
  return new Date(t).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function GrafanaLogMessage({ text }: { text: string }) {
  const parts = splitGrafanaHighlights(text || "(no message)");
  return (
    <span className="grafana-log-msg">
      {parts.map((part, idx) =>
        part.hit ? <mark key={idx}>{part.text}</mark> : <span key={idx}>{part.text}</span>,
      )}
    </span>
  );
}

function GrafanaSource({ hit }: { hit: GrafanaLogHitLite & { source?: Record<string, unknown> } }) {
  const source = hit.source ?? {};
  const fields = flattenGrafanaSource(source);
  return (
    <div className="grafana-source-wrap">
      {fields.length ? (
        <dl className="grafana-fields">
          {fields.map(([key, value]) => (
            <div key={key} className="grafana-field">
              <dt title={key}>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <details className="grafana-source-json">
        <summary>JSON</summary>
        <pre className="grafana-source">{JSON.stringify(source, null, 2)}</pre>
      </details>
    </div>
  );
}

function flattenGrafanaSource(
  value: Record<string, unknown>,
  prefix = "",
  out: Array<[string, string]> = [],
): Array<[string, string]> {
  for (const [key, item] of Object.entries(value)) {
    if (out.length >= 48) break;
    const path = prefix ? `${prefix}.${key}` : key;
    if (item == null) continue;
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      out.push([path, String(item)]);
    } else if (
      Array.isArray(item) &&
      item.every((row) => typeof row === "string" || typeof row === "number")
    ) {
      out.push([path, item.map(String).join(", ")]);
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      flattenGrafanaSource(item as Record<string, unknown>, path, out);
    }
  }
  return out;
}
