import {
  formatGrafanaNumber,
  grafanaPanelIsStatic,
  grafanaVariableValues,
  parseGrafanaAnnotations,
  parseGrafanaVariables,
  parseLabelValuesQuery,
  substituteGrafanaDeep,
  substituteGrafanaVariables,
  type GrafanaAnnotation,
  type GrafanaDashboardPanel,
  type GrafanaDashboardQueryResult,
  type GrafanaDashboardVariable,
  type GrafanaDashboardView,
  type GrafanaGridPos,
  type GrafanaLogHitLite,
  type GrafanaPanelResult,
  type GrafanaPanelSeries,
  type GrafanaPanelTable,
  type IntegrationAccount,
} from "@locus/shared";
import {
  grafanaJson,
  grafanaUsesBackendEsQuery,
  grafanaVersion,
  listDatasources,
  parseGrafanaTime,
  queryGrafanaLogs,
  shouldFallBackToProxy,
  type GrafanaDatasource,
} from "./grafanaQuery.js";

const MAX_PANELS = 32;
const MAX_SERIES = 24;
const MAX_POINTS = 400;
const MAX_LOGS = 25;
const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLS = 12;
const QUERY_BATCH = 6;

export async function loadGrafanaDashboard(
  account: IntegrationAccount,
  uid: string,
  fetchFn: typeof fetch,
): Promise<GrafanaDashboardView> {
  const body = await grafanaJson(
    account,
    fetchFn,
    `/api/dashboards/uid/${encodeURIComponent(uid)}`,
  );
  return parseGrafanaDashboard(body, account.baseUrl, uid);
}

export async function queryGrafanaDashboard(
  account: IntegrationAccount,
  uid: string,
  input: { from?: string; to?: string; panelId?: number; variables?: Record<string, string> },
  fetchFn: typeof fetch,
): Promise<GrafanaDashboardQueryResult> {
  const raw = await grafanaJson(account, fetchFn, `/api/dashboards/uid/${encodeURIComponent(uid)}`);
  const view = parseGrafanaDashboard(raw, account.baseUrl, uid);
  const from = input.from?.trim() || view.from;
  const to = input.to?.trim() || view.to;
  const dash = asRecord(asRecord(raw).dashboard);
  const datasources = await listDatasources(account, fetchFn).catch(() => []);
  const variables = await resolveQueryVariables(
    account,
    applyVariableOverrides(view.variables ?? [], input.variables),
    datasources,
    fetchFn,
  );
  const values = grafanaVariableValues(variables, input.variables);
  const withCurrent = variables.map((row) => ({
    ...row,
    current: values[row.name] ?? row.current,
  }));
  const wantedSource =
    input.panelId != null
      ? view.panels.filter((row) => row.id === input.panelId)
      : view.panels.slice(0, MAX_PANELS);
  const wanted = wantedSource.map((meta) => substitutePanelMeta(meta, values));
  const version = await grafanaVersion(account, fetchFn);
  const now = Date.now();
  const fromMs = parseGrafanaTime(from, now);
  const toMs = parseGrafanaTime(to, now);
  const intervalMs = Math.max(1_000, Math.round((toMs - fromMs) / MAX_POINTS));
  const rawPanels = flattenGrafanaPanels(dashboardPanels(dash));
  const [panels, annotations] = await Promise.all([
    mapPool(wanted, QUERY_BATCH, async (meta) => {
      const rec =
        rawPanels.find((row) => Number(row.id) === meta.id) ??
        rawPanels.find((row) => String(row.title ?? "") === meta.title);
      return queryOnePanel({
        account,
        fetchFn,
        version,
        datasources,
        dash,
        panel: rec ?? {},
        meta,
        values,
        from,
        to,
        fromMs,
        toMs,
        intervalMs,
      });
    }),
    loadGrafanaAnnotations(account, fetchFn, uid, fromMs, toMs),
  ]);
  return { ...view, from, to, variables: withCurrent, annotations, panels };
}

export function parseGrafanaDashboard(
  body: unknown,
  baseUrl: string,
  fallbackUid: string,
): GrafanaDashboardView {
  const root = asRecord(body);
  const dash = asRecord(root.dashboard);
  const meta = asRecord(root.meta);
  const uid =
    (typeof dash.uid === "string" && dash.uid) ||
    (typeof meta.uid === "string" && meta.uid) ||
    fallbackUid;
  const origin = baseUrl.replace(/\/+$/, "");
  const url = absoluteGrafanaUrl(
    (typeof meta.url === "string" && meta.url) || `/d/${encodeURIComponent(uid)}`,
    origin,
  );
  const time = asRecord(dash.time);
  const tags = Array.isArray(dash.tags)
    ? dash.tags.filter((tag): tag is string => typeof tag === "string")
    : undefined;
  const flattened = flattenGrafanaPanels(dashboardPanels(dash));
  return {
    uid,
    title: typeof dash.title === "string" && dash.title.trim() ? dash.title.trim() : uid,
    url,
    tags,
    description: typeof dash.description === "string" ? dash.description : undefined,
    from: typeof time.from === "string" && time.from.trim() ? time.from.trim() : "now-1h",
    to: typeof time.to === "string" && time.to.trim() ? time.to.trim() : "now",
    variables: parseGrafanaVariables(dash),
    panels: flattened.slice(0, MAX_PANELS).map((row, index) => toDashboardPanel(row, index)),
  };
}

export function flattenGrafanaPanels(
  panels: unknown[],
  out: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  for (const panel of panels) {
    const rec = asRecord(panel);
    const type = typeof rec.type === "string" ? rec.type : "";
    const nested = Array.isArray(rec.panels) ? rec.panels : [];
    if (type === "row") {
      flattenGrafanaPanels(nested, out);
      continue;
    }
    if (Object.keys(rec).length) out.push(rec);
    if (nested.length) flattenGrafanaPanels(nested, out);
  }
  return out;
}

export function parseGrafanaPanelFrames(
  body: unknown,
  panelType: string,
): Pick<GrafanaPanelResult, "series" | "table" | "logs" | "stat" | "error"> {
  const root = asRecord(body);
  if (root.message && !root.results) return { error: String(root.message) };
  const results = asRecord(root.results);
  const series: GrafanaPanelSeries[] = [];
  const logs: GrafanaLogHitLite[] = [];
  let table: GrafanaPanelTable | undefined;
  const errors: string[] = [];
  for (const entry of Object.values(results)) {
    const rec = asRecord(entry);
    if (typeof rec.error === "string" && rec.error.trim()) errors.push(rec.error.trim());
    const frames = Array.isArray(rec.frames) ? rec.frames : [];
    for (const frame of frames) {
      const parsed = parseOneFrame(frame, panelType);
      if (parsed.series) series.push(...parsed.series);
      if (parsed.logs) logs.push(...parsed.logs);
      if (parsed.table && !table) table = parsed.table;
    }
  }
  const trimmed = series
    .map((row) => ({ ...row, points: row.points.slice(-MAX_POINTS) }))
    .slice(0, MAX_SERIES);
  return {
    error: errors[0],
    series: trimmed.length ? trimmed : undefined,
    logs: logs.length ? logs.slice(0, MAX_LOGS) : undefined,
    table,
    stat: pickStat(panelType, trimmed, table),
  };
}

export function summarizeTargetQuery(target: Record<string, unknown>): string | undefined {
  for (const key of ["expr", "query", "rawSql", "instantQuery", "luceneQuery"]) {
    const value = target[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function dashboardPanels(dash: Record<string, unknown>): unknown[] {
  if (Array.isArray(dash.panels)) return dash.panels;
  if (Array.isArray(dash.rows)) {
    return dash.rows.flatMap((row) => {
      const rec = asRecord(row);
      return Array.isArray(rec.panels) ? rec.panels : [];
    });
  }
  return [];
}

function toDashboardPanel(rec: Record<string, unknown>, index: number): GrafanaDashboardPanel {
  const grid = asRecord(rec.gridPos);
  const targets = Array.isArray(rec.targets) ? rec.targets.map(asRecord) : [];
  const options = asRecord(rec.options);
  const text =
    (typeof options.content === "string" && options.content) ||
    (typeof rec.content === "string" && rec.content) ||
    undefined;
  const queries = targets
    .filter((row) => row.hide !== true)
    .map(summarizeTargetQuery)
    .filter((row): row is string => Boolean(row));
  return {
    id: typeof rec.id === "number" ? rec.id : index + 1,
    title:
      typeof rec.title === "string" && rec.title.trim()
        ? rec.title.trim()
        : typeof rec.type === "string"
          ? rec.type
          : `Panel ${index + 1}`,
    type: typeof rec.type === "string" && rec.type.trim() ? rec.type.trim() : "graph",
    description: typeof rec.description === "string" ? rec.description : undefined,
    gridPos: parseGridPos(grid, index),
    datasource: datasourceLabel(rec.datasource ?? targets[0]?.datasource),
    queries,
    text,
  };
}

function parseGridPos(grid: Record<string, unknown>, index: number): GrafanaGridPos {
  return {
    x: intOr(grid.x, 0),
    y: intOr(grid.y, index * 8),
    w: Math.max(1, intOr(grid.w, 24)),
    h: Math.max(2, intOr(grid.h, 8)),
  };
}

async function queryOnePanel(input: {
  account: IntegrationAccount;
  fetchFn: typeof fetch;
  version: string;
  datasources: GrafanaDatasource[];
  dash: Record<string, unknown>;
  panel: Record<string, unknown>;
  meta: GrafanaDashboardPanel;
  values: Record<string, string>;
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
  intervalMs: number;
}): Promise<GrafanaPanelResult> {
  const base: GrafanaPanelResult = { ...input.meta };
  if (input.meta.text?.trim() && grafanaPanelIsStatic(input.meta.type)) {
    return { ...base, text: input.meta.text };
  }
  if (grafanaPanelIsStatic(input.meta.type)) return base;
  const targets = (Array.isArray(input.panel.targets) ? input.panel.targets : [])
    .map(asRecord)
    .filter((row) => row.hide !== true)
    .map((row) => substituteGrafanaDeep(row, input.values));
  if (!targets.length) return { ...base, text: input.meta.text };
  const queries = targets.map((target) =>
    buildQuery(target, input.panel, input.dash, input.datasources, input.intervalMs),
  );
  try {
    const body = await grafanaJson(input.account, input.fetchFn, "/api/ds/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: input.from, to: input.to, queries }),
    });
    return { ...base, ...parseGrafanaPanelFrames(body, input.meta.type) };
  } catch (err) {
    if (shouldFallBackToProxy(err) || !grafanaUsesBackendEsQuery(input.version)) {
      const fallback = await elasticsearchFallback(input, targets);
      if (fallback) return { ...base, ...fallback };
    }
    return {
      ...base,
      error: err instanceof Error ? err.message : "Panel query failed",
    };
  }
}

function buildQuery(
  target: Record<string, unknown>,
  panel: Record<string, unknown>,
  dash: Record<string, unknown>,
  datasources: GrafanaDatasource[],
  intervalMs: number,
): Record<string, unknown> {
  const ds = resolveDatasourceRef(
    target.datasource ?? panel.datasource ?? dash.datasource,
    datasources,
  );
  const query: Record<string, unknown> = { ...target };
  delete query.hide;
  if (ds?.uid) query.datasource = { type: ds.type, uid: ds.uid };
  if (ds?.id != null) query.datasourceId = ds.id;
  query.intervalMs = intervalMs;
  query.maxDataPoints = MAX_POINTS;
  if (typeof query.refId !== "string" || !query.refId) query.refId = "A";
  return query;
}

async function elasticsearchFallback(
  input: {
    account: IntegrationAccount;
    fetchFn: typeof fetch;
    datasources: GrafanaDatasource[];
    panel: Record<string, unknown>;
    meta: GrafanaDashboardPanel;
    from: string;
    to: string;
  },
  targets: Record<string, unknown>[],
): Promise<Pick<GrafanaPanelResult, "series" | "logs" | "stat"> | undefined> {
  const lucene = targets.map(summarizeTargetQuery).find(Boolean);
  const ds = resolveDatasourceRef(
    targets[0]?.datasource ?? input.panel.datasource,
    input.datasources,
  );
  if (!lucene) return undefined;
  if (ds?.type && ds.type !== "elasticsearch") return undefined;
  try {
    const mode =
      input.meta.type === "logs" ? "logs" : input.meta.type === "stat" ? "count" : "both";
    const result = await queryGrafanaLogs(
      input.account,
      {
        query: lucene,
        from: input.from,
        to: input.to,
        mode,
        datasource: ds?.name || ds?.uid,
      },
      input.fetchFn,
    );
    const series = result.histogram?.length
      ? [
          {
            name: "count",
            points: result.histogram.map((row) => ({ t: row.t, value: row.count })),
          },
        ]
      : undefined;
    return {
      series,
      logs: result.logs,
      stat:
        result.count != null
          ? { value: formatGrafanaNumber(result.count) }
          : pickStat(input.meta.type, series ?? [], undefined),
    };
  } catch {
    return undefined;
  }
}

function resolveDatasourceRef(
  raw: unknown,
  datasources: GrafanaDatasource[],
): GrafanaDatasource | undefined {
  if (typeof raw === "string" && raw.trim() && !raw.startsWith("--")) {
    return datasources.find(matchesDatasource(raw.trim()));
  }
  const rec = asRecord(raw);
  const uid = typeof rec.uid === "string" ? rec.uid : "";
  const name = typeof rec.name === "string" ? rec.name : "";
  if (uid && !uid.startsWith("--")) {
    return datasources.find(matchesDatasource(uid)) ?? { name: uid, type: String(rec.type ?? "") };
  }
  if (name && !name.startsWith("--")) return datasources.find(matchesDatasource(name));
  return undefined;
}

function matchesDatasource(needle: string): (row: GrafanaDatasource) => boolean {
  return (row) =>
    row.uid === needle || row.name === needle || (row.id != null && String(row.id) === needle);
}

function parseOneFrame(
  frame: unknown,
  panelType: string,
): Pick<GrafanaPanelResult, "series" | "table" | "logs"> {
  const root = asRecord(frame);
  const schema = asRecord(root.schema);
  const fields = Array.isArray(schema.fields) ? schema.fields.map(asRecord) : [];
  const data = asRecord(root.data);
  const values = Array.isArray(data.values) ? data.values : [];
  const meta = asRecord(schema.meta);
  const vis = String(
    meta.preferredVisualisationType ?? asRecord(meta.custom).preferredVisualisationType ?? "",
  );
  const n = Math.max(0, ...values.map((col) => (Array.isArray(col) ? col.length : 0)));
  const timeIdx = fields.findIndex(
    (field) => field.type === "time" || /time/i.test(String(field.name ?? "")),
  );
  const lineIdx = fields.findIndex((field) => /^(?:line|message)$/i.test(String(field.name ?? "")));
  const numberIdxs = numberFieldIndexes(fields, values, timeIdx);
  const isLogs =
    vis === "logs" || panelType === "logs" || (lineIdx >= 0 && (timeIdx >= 0 || vis === "logs"));
  if (isLogs) {
    const times = asArray(values[timeIdx >= 0 ? timeIdx : 0]);
    const lines = asArray(values[lineIdx >= 0 ? lineIdx : (numberIdxs[0] ?? 0)]);
    const logs: GrafanaLogHitLite[] = [];
    const count = Math.min(MAX_LOGS, Math.max(times.length, lines.length, n));
    for (let i = 0; i < count; i++) {
      const ts = times[i];
      logs.push({
        timestamp: formatTime(ts),
        message: lines[i] != null ? String(lines[i]) : undefined,
        source: Object.fromEntries(
          fields.map((field, idx) => [String(field.name ?? idx), asArray(values[idx])[i]]),
        ),
      });
    }
    return { logs: logs.length ? logs : undefined };
  }
  if (timeIdx >= 0 && numberIdxs.length && panelType !== "table" && panelType !== "table-old") {
    const times = asArray(values[timeIdx]).map(Number);
    const series: GrafanaPanelSeries[] = [];
    for (const idx of numberIdxs) {
      const points: Array<{ t: number; value: number }> = [];
      const col = asArray(values[idx]);
      for (let i = 0; i < times.length; i++) {
        const t = times[i]!;
        const value = Number(col[i]);
        if (Number.isFinite(t) && Number.isFinite(value)) points.push({ t, value });
      }
      if (points.length) {
        series.push({
          name: fieldName(fields[idx]!, schema.name),
          points: points.slice(-MAX_POINTS),
        });
      }
      if (series.length >= MAX_SERIES) break;
    }
    if (series.length) return { series };
  }
  if (!n || !fields.length) return {};
  const columns = fields.slice(0, MAX_TABLE_COLS).map((field) => String(field.name || "Value"));
  const rows: string[][] = [];
  for (let i = 0; i < Math.min(n, MAX_TABLE_ROWS); i++) {
    rows.push(columns.map((_, col) => formatCell(fields[col], asArray(values[col])[i])));
  }
  return { table: { columns, rows } };
}

function numberFieldIndexes(
  fields: Record<string, unknown>[],
  values: unknown[],
  timeIdx: number,
): number[] {
  const typed = fields
    .map((field, idx) =>
      idx !== timeIdx && (field.type === "number" || field.type === "int" || field.type === "float")
        ? idx
        : -1,
    )
    .filter((idx) => idx >= 0);
  if (typed.length) return typed;
  const guessed: number[] = [];
  fields.forEach((_, idx) => {
    if (idx === timeIdx) return;
    const col = asArray(values[idx]);
    if (col.length && col.every((value) => value == null || typeof value === "number")) {
      guessed.push(idx);
    }
  });
  return guessed;
}

function pickStat(
  panelType: string,
  series: GrafanaPanelSeries[],
  table: GrafanaPanelTable | undefined,
): { value: string; unit?: string } | undefined {
  const last = series[0]?.points.at(-1);
  if (
    last &&
    (panelType === "stat" ||
      panelType === "gauge" ||
      panelType === "bargauge" ||
      panelType === "piechart" ||
      (series.length === 1 && series[0]!.points.length === 1))
  ) {
    return { value: formatGrafanaNumber(last.value) };
  }
  if (panelType === "stat" && table?.rows[0]?.[0]) return { value: table.rows[0][0]! };
  return undefined;
}

function fieldName(field: Record<string, unknown>, schemaName: unknown): string {
  const config = asRecord(field.config);
  if (typeof config.displayNameFromDS === "string" && config.displayNameFromDS.trim()) {
    return config.displayNameFromDS.trim();
  }
  if (typeof config.displayName === "string" && config.displayName.trim()) {
    return config.displayName.trim();
  }
  const labels = asRecord(field.labels);
  const values = Object.values(labels).filter((row): row is string => typeof row === "string");
  if (values.length) return values.join(" ");
  if (typeof field.name === "string" && field.name && field.name !== "Value") return field.name;
  if (typeof schemaName === "string" && schemaName.trim()) return schemaName.trim();
  return typeof field.name === "string" ? field.name : "Value";
}

function formatCell(field: Record<string, unknown> | undefined, value: unknown): string {
  if (value == null) return "";
  if (field?.type === "time") return formatTime(value) ?? String(value);
  if (typeof value === "number") return formatGrafanaNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function formatTime(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function datasourceLabel(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() && !value.startsWith("--")) return value.trim();
  const rec = asRecord(value);
  if (typeof rec.name === "string" && rec.name.trim() && !rec.name.startsWith("--")) {
    return rec.name.trim();
  }
  if (typeof rec.uid === "string" && rec.uid.trim() && !rec.uid.startsWith("--"))
    return rec.uid.trim();
  return undefined;
}

function absoluteGrafanaUrl(url: string, origin: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${origin}${url.startsWith("/") ? url : `/${url}`}`;
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

function substitutePanelMeta(
  meta: GrafanaDashboardPanel,
  values: Record<string, string>,
): GrafanaDashboardPanel {
  if (!Object.keys(values).length) return meta;
  return {
    ...meta,
    title: substituteGrafanaVariables(meta.title, values),
    queries: meta.queries.map((query) => substituteGrafanaVariables(query, values)),
    text: meta.text ? substituteGrafanaVariables(meta.text, values) : meta.text,
  };
}

function applyVariableOverrides(
  variables: GrafanaDashboardVariable[],
  override?: Record<string, string>,
): GrafanaDashboardVariable[] {
  if (!override) return variables;
  return variables.map((row) =>
    Object.prototype.hasOwnProperty.call(override, row.name)
      ? { ...row, current: override[row.name] ?? "" }
      : row,
  );
}

async function resolveQueryVariables(
  account: IntegrationAccount,
  variables: GrafanaDashboardVariable[],
  datasources: GrafanaDatasource[],
  fetchFn: typeof fetch,
): Promise<GrafanaDashboardVariable[]> {
  const out: GrafanaDashboardVariable[] = [];
  for (const variable of variables) {
    if (variable.type !== "query" || variable.options.length || !variable.query) {
      out.push(variable);
      continue;
    }
    const known = grafanaVariableValues([...out, variable]);
    const query = substituteGrafanaVariables(variable.query, known);
    const parsed = parseLabelValuesQuery(query);
    const ds = datasources.find(
      (row) =>
        row.uid === variable.datasourceUid ||
        row.name === variable.datasource ||
        row.uid === variable.datasource,
    );
    if (!parsed || !ds?.uid || (ds.type !== "prometheus" && ds.type !== "loki")) {
      out.push({ ...variable, query });
      continue;
    }
    try {
      const values = await prometheusLabelValues(account, fetchFn, ds.uid, parsed);
      const options = values.map((value) => ({ text: value, value }));
      const current =
        variable.current &&
        (variable.current === "$__all" || values.includes(variable.current) || !values.length)
          ? variable.current
          : (options[0]?.value ?? variable.current);
      out.push({ ...variable, query, options, current });
    } catch {
      out.push({ ...variable, query });
    }
  }
  return out;
}

async function prometheusLabelValues(
  account: IntegrationAccount,
  fetchFn: typeof fetch,
  uid: string,
  parsed: { metric?: string; label: string },
): Promise<string[]> {
  if (parsed.metric) {
    const body = await grafanaJson(
      account,
      fetchFn,
      `/api/datasources/uid/${encodeURIComponent(uid)}/resources/api/v1/series?match[]=${encodeURIComponent(parsed.metric)}`,
    );
    const data = asRecord(body).data;
    if (!Array.isArray(data)) return [];
    const values = new Set<string>();
    for (const row of data) {
      const value = asRecord(row)[parsed.label];
      if (typeof value === "string" && value.trim()) values.add(value.trim());
    }
    return [...values].slice(0, 200);
  }
  const body = await grafanaJson(
    account,
    fetchFn,
    `/api/datasources/uid/${encodeURIComponent(uid)}/resources/api/v1/label/${encodeURIComponent(parsed.label)}/values`,
  );
  const data = asRecord(body).data;
  return Array.isArray(data)
    ? data
        .filter((row): row is string => typeof row === "string" && Boolean(row.trim()))
        .slice(0, 200)
    : [];
}

async function loadGrafanaAnnotations(
  account: IntegrationAccount,
  fetchFn: typeof fetch,
  uid: string,
  fromMs: number,
  toMs: number,
): Promise<GrafanaAnnotation[]> {
  try {
    const body = await grafanaJson(
      account,
      fetchFn,
      `/api/annotations?from=${fromMs}&to=${toMs}&dashboardUID=${encodeURIComponent(uid)}&limit=100`,
    );
    return parseGrafanaAnnotations(body);
  } catch {
    return [];
  }
}

function intOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
