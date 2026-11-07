import { isLevelToken, stripGrafanaHighlights, type IntegrationAccount } from "@locus/shared";

export type GrafanaQueryMode = "count" | "logs" | "both";

export interface GrafanaDatasource {
  id?: number;
  uid?: string;
  name: string;
  type: string;
  database?: string;
  isDefault?: boolean;
  jsonData?: {
    index?: string;
    timeField?: string;
    esVersion?: string | number;
    interval?: string;
    logMessageField?: string;
    logLevelField?: string;
  };
}

export interface GrafanaLogHit {
  timestamp?: string;
  level?: string;
  message?: string;
  source: Record<string, unknown>;
}

export interface GrafanaHistogramBucket {
  t: number;
  count: number;
}

export interface GrafanaQueryResult {
  lucene: string;
  explore_url: string;
  from: string;
  to: string;
  datasource?: { id?: number; uid?: string; name: string; type: string };
  mode: GrafanaQueryMode;
  count?: number;
  histogram?: GrafanaHistogramBucket[];
  logs?: GrafanaLogHit[];
}

export interface GrafanaQueryInput {
  query: string;
  from: string;
  to: string;
  mode: GrafanaQueryMode;
  limit: number;
  datasource?: string;
  exploreUrlOnly: boolean;
}

const DEFAULT_FROM = "now-1h";
const DEFAULT_TO = "now";
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;

export function parseGrafanaQueryArgs(args: Record<string, unknown>): GrafanaQueryInput {
  const query = str(args, "query") || str(args, "q") || str(args, "lucene");
  if (!query) throw new Error("query is required");
  return {
    query,
    from: str(args, "from") || DEFAULT_FROM,
    to: str(args, "to") || DEFAULT_TO,
    mode: parseMode(args.mode),
    limit: parseLimit(args.limit),
    datasource: str(args, "datasource"),
    exploreUrlOnly: bool(args.explore_url_only) || bool(args.exploreUrlOnly),
  };
}

export function parseGrafanaTime(value: string, now = Date.now()): number {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "now") return now;
  const rel = /^now-(\d+)([smhdw])$/i.exec(trimmed);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!.toLowerCase();
    const ms =
      unit === "s"
        ? 1_000
        : unit === "m"
          ? 60_000
          : unit === "h"
            ? 3_600_000
            : unit === "d"
              ? 86_400_000
              : 604_800_000;
    return now - n * ms;
  }
  if (/^\d{13}$/.test(trimmed)) return Number(trimmed);
  if (/^\d{10}$/.test(trimmed)) return Number(trimmed) * 1_000;
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return parsed;
  throw new Error(`Invalid Grafana time: ${value}`);
}

export function histogramInterval(fromMs: number, toMs: number): string {
  const span = Math.max(1, toMs - fromMs);
  if (span <= 2 * 3_600_000) return "1m";
  if (span <= 12 * 3_600_000) return "5m";
  if (span <= 2 * 86_400_000) return "15m";
  if (span <= 7 * 86_400_000) return "1h";
  if (span <= 30 * 86_400_000) return "6h";
  return "1d";
}

export function buildExploreUrl(input: {
  baseUrl: string;
  from: string;
  to: string;
  lucene: string;
  datasourceName: string;
  timeField?: string;
  orgId?: number;
}): string {
  const query = {
    refId: "A",
    query: input.lucene,
    alias: "",
    metrics: [{ id: "1", type: "logs" }],
    bucketAggs: [] as unknown[],
    timeField: input.timeField || "@timestamp",
  };
  // Grafana 8.5 compact Explore state: [from, to, datasourceName, query]
  const left = JSON.stringify([input.from, input.to, input.datasourceName, query]);
  const org = input.orgId ?? 1;
  return `${input.baseUrl.replace(/\/+$/, "")}/explore?orgId=${org}&left=${encodeURIComponent(left)}`;
}

export function grafanaUsesBackendEsQuery(version: string): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return false;
  const major = Number(match[1]);
  return major >= 9;
}

export function pickElasticsearchDatasource(
  rows: GrafanaDatasource[],
  want?: string,
): GrafanaDatasource {
  const elastic = rows.filter((row) => row.type === "elasticsearch");
  if (want) {
    const needle = want.trim();
    const match = elastic.find(matchesDatasource(needle)) ?? rows.find(matchesDatasource(needle));
    if (!match) throw new Error(`Grafana datasource not found: ${want}`);
    return match;
  }
  const preferred = elastic.find((row) => row.isDefault) ?? elastic[0];
  if (!preferred) {
    throw new Error("No Elasticsearch datasource. Pass datasource (name or uid).");
  }
  return preferred;
}

export function parseDatasourceList(body: unknown): GrafanaDatasource[] {
  if (Array.isArray(body)) {
    return body.filter(isDatasource).map(normalizeDatasource);
  }
  if (body && typeof body === "object") {
    const map = (body as { datasources?: Record<string, unknown> }).datasources;
    if (map && typeof map === "object") {
      return Object.values(map)
        .filter(isDatasource)
        .filter((row) => !row.name.startsWith("--"))
        .map(normalizeDatasource);
    }
  }
  return [];
}

export function esUsesFixedInterval(esVersion: unknown): boolean {
  if (typeof esVersion === "number") {
    if (esVersion >= 8 && esVersion < 56) return true;
    if (esVersion >= 80 && esVersion < 90) return true;
    return false;
  }
  const match = /^(\d+)/.exec(String(esVersion ?? "").trim());
  if (!match) return false;
  const major = Number(match[1]);
  return major >= 8 && major < 56;
}

export function resolveIndex(
  ds: GrafanaDatasource,
  fromMs: number,
  toMs: number,
): string | string[] {
  const pattern = ds.database?.trim() || ds.jsonData?.index?.trim() || "";
  if (!pattern) return "*";
  if (!pattern.includes("[")) return pattern;
  return expandDatedIndex(pattern, ds.jsonData?.interval || "Daily", fromMs, toMs);
}

export function buildMsearchBody(input: {
  lucene: string;
  fromMs: number;
  toMs: number;
  timeField: string;
  index: string | string[];
  mode: GrafanaQueryMode;
  limit: number;
  esVersion?: string | number;
}): string {
  const header = {
    search_type: "query_then_fetch",
    ignore_unavailable: true,
    index: input.index,
  };
  const range: Record<string, unknown> = {
    [input.timeField]: {
      gte: input.fromMs,
      lte: input.toMs,
      format: "epoch_millis",
    },
  };
  const query = {
    bool: {
      filter: [
        { range },
        {
          query_string: {
            analyze_wildcard: true,
            query: input.lucene,
          },
        },
      ],
    },
  };
  const intervalField = esUsesFixedInterval(input.esVersion) ? "fixed_interval" : "interval";
  const histogram = {
    date_histogram: {
      field: input.timeField,
      min_doc_count: 0,
      extended_bounds: { min: input.fromMs, max: input.toMs },
      format: "epoch_millis",
      [intervalField]: histogramInterval(input.fromMs, input.toMs),
    },
  };
  const body: Record<string, unknown> = {
    size: input.mode === "count" ? 0 : input.limit,
    query,
    sort:
      input.mode === "count"
        ? undefined
        : [
            { [input.timeField]: { order: "desc", unmapped_type: "boolean" } },
            { _doc: { order: "desc" } },
          ],
    aggs: input.mode === "logs" ? undefined : { "2": histogram },
    highlight:
      input.mode === "count"
        ? undefined
        : {
            fields: { "*": {} },
            pre_tags: ["@HIGHLIGHT@"],
            post_tags: ["@/HIGHLIGHT@"],
            fragment_size: 2147483647,
          },
  };
  if (!body.sort) delete body.sort;
  if (!body.aggs) delete body.aggs;
  if (!body.highlight) delete body.highlight;
  return `${JSON.stringify(header)}\n${JSON.stringify(body)}\n`;
}

export function parseMsearchResponse(
  body: unknown,
  ds: GrafanaDatasource,
): Pick<GrafanaQueryResult, "count" | "histogram" | "logs"> {
  const root = asRecord(body);
  const responses = Array.isArray(root.responses) ? root.responses : [body];
  const first = asRecord(responses[0]);
  if (first.error) {
    throw new Error(formatEsError(first.error));
  }
  const hits = asRecord(first.hits);
  const total = hitTotal(hits.total);
  const histogram = parseAggBuckets(first.aggregations);
  const logs = parseEsHits(Array.isArray(hits.hits) ? hits.hits : [], ds);
  return {
    count:
      total ??
      (histogram.length ? histogram.reduce((sum, row) => sum + row.count, 0) : logs.length),
    histogram: histogram.length ? histogram : undefined,
    logs: logs.length ? logs : undefined,
  };
}

export function parseDsQueryResponse(
  body: unknown,
): Pick<GrafanaQueryResult, "count" | "histogram" | "logs"> {
  const root = asRecord(body);
  if (root.message && !root.results) throw new Error(String(root.message));
  const results = asRecord(root.results);
  const histogram: GrafanaHistogramBucket[] = [];
  const logs: GrafanaLogHit[] = [];
  for (const entry of Object.values(results)) {
    const frames = Array.isArray(asRecord(entry).frames)
      ? (asRecord(entry).frames as unknown[])
      : [];
    for (const frame of frames) {
      const parsed = parseDataFrame(frame);
      histogram.push(...parsed.histogram);
      logs.push(...parsed.logs);
    }
  }
  return {
    count: histogram.length ? histogram.reduce((sum, row) => sum + row.count, 0) : logs.length,
    histogram: histogram.length ? histogram : undefined,
    logs: logs.length ? logs : undefined,
  };
}

export function buildDsQueryPayload(input: {
  ds: GrafanaDatasource;
  lucene: string;
  fromMs: number;
  toMs: number;
  mode: GrafanaQueryMode;
  limit: number;
  timeField: string;
}): Record<string, unknown> {
  const datasource = input.ds.uid
    ? { type: input.ds.type || "elasticsearch", uid: input.ds.uid }
    : undefined;
  const queries: Record<string, unknown>[] = [];
  if (input.mode === "count" || input.mode === "both") {
    queries.push({
      refId: "A",
      datasource,
      datasourceId: input.ds.id,
      query: input.lucene,
      metrics: [{ type: "count", id: "1" }],
      bucketAggs: [
        {
          type: "date_histogram",
          id: "2",
          field: input.timeField,
          settings: { interval: "auto", min_doc_count: "0" },
        },
      ],
      timeField: input.timeField,
    });
  }
  if (input.mode === "logs" || input.mode === "both") {
    queries.push({
      refId: input.mode === "both" ? "B" : "A",
      datasource,
      datasourceId: input.ds.id,
      query: input.lucene,
      metrics: [{ type: "logs", id: "1", settings: { limit: String(input.limit) } }],
      bucketAggs: [],
      timeField: input.timeField,
    });
  }
  return {
    from: String(input.fromMs),
    to: String(input.toMs),
    queries,
  };
}

export async function queryGrafanaLogs(
  account: IntegrationAccount,
  args: Record<string, unknown>,
  fetchFn: typeof fetch,
): Promise<GrafanaQueryResult> {
  const input = parseGrafanaQueryArgs(args);
  const lucene = input.query;
  const baseUrl = account.baseUrl.replace(/\/+$/, "");
  if (input.exploreUrlOnly) {
    const name = input.datasource || "Elasticsearch";
    return {
      lucene,
      explore_url: buildExploreUrl({
        baseUrl,
        from: input.from,
        to: input.to,
        lucene,
        datasourceName: name,
      }),
      from: input.from,
      to: input.to,
      mode: input.mode,
    };
  }

  const version = await grafanaVersion(account, fetchFn);
  const datasources = await listDatasources(account, fetchFn);
  const ds = pickElasticsearchDatasource(datasources, input.datasource);
  const timeField = ds.jsonData?.timeField?.trim() || "@timestamp";
  const explore_url = buildExploreUrl({
    baseUrl,
    from: input.from,
    to: input.to,
    lucene,
    datasourceName: ds.name || ds.uid || "Elasticsearch",
    timeField,
  });
  const now = Date.now();
  const fromMs = parseGrafanaTime(input.from, now);
  const toMs = parseGrafanaTime(input.to, now);
  const parsed = await runQuery({
    account,
    fetchFn,
    version,
    ds,
    lucene,
    fromMs,
    toMs,
    mode: input.mode,
    limit: input.limit,
    timeField,
  });
  return {
    lucene,
    explore_url,
    from: input.from,
    to: input.to,
    datasource: { id: ds.id, uid: ds.uid, name: ds.name, type: ds.type },
    mode: input.mode,
    ...selectModeFields(input.mode, parsed),
  };
}

async function runQuery(input: {
  account: IntegrationAccount;
  fetchFn: typeof fetch;
  version: string;
  ds: GrafanaDatasource;
  lucene: string;
  fromMs: number;
  toMs: number;
  mode: GrafanaQueryMode;
  limit: number;
  timeField: string;
}): Promise<Pick<GrafanaQueryResult, "count" | "histogram" | "logs">> {
  if (grafanaUsesBackendEsQuery(input.version)) {
    try {
      return await queryViaDsQuery(input);
    } catch (err) {
      if (shouldFallBackToProxy(err)) return queryViaMsearch(input);
      throw err;
    }
  }
  return queryViaMsearch(input);
}

/** Grafana 9+ Elasticsearch may still be frontend-only; 404/plugin errors fall back to the 8.5 proxy. */
export function shouldFallBackToProxy(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /HTTP 404\b|not implemented|backend datasource|plugin does not support/i.test(msg);
}

async function queryViaDsQuery(input: {
  account: IntegrationAccount;
  fetchFn: typeof fetch;
  ds: GrafanaDatasource;
  lucene: string;
  fromMs: number;
  toMs: number;
  mode: GrafanaQueryMode;
  limit: number;
  timeField: string;
}): Promise<Pick<GrafanaQueryResult, "count" | "histogram" | "logs">> {
  const payload = buildDsQueryPayload(input);
  const body = await grafanaJson(input.account, input.fetchFn, "/api/ds/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseDsQueryResponse(body);
}

async function queryViaMsearch(input: {
  account: IntegrationAccount;
  fetchFn: typeof fetch;
  ds: GrafanaDatasource;
  lucene: string;
  fromMs: number;
  toMs: number;
  mode: GrafanaQueryMode;
  limit: number;
  timeField: string;
}): Promise<Pick<GrafanaQueryResult, "count" | "histogram" | "logs">> {
  const id = input.ds.id;
  if (id == null && !input.ds.uid) {
    throw new Error(
      "Elasticsearch datasource is missing id (needed for Grafana 8.5 proxy queries)",
    );
  }
  const path =
    id != null
      ? `/api/datasources/proxy/${id}/_msearch`
      : `/api/datasources/proxy/uid/${encodeURIComponent(input.ds.uid!)}/_msearch`;
  const ndjson = buildMsearchBody({
    lucene: input.lucene,
    fromMs: input.fromMs,
    toMs: input.toMs,
    timeField: input.timeField,
    index: resolveIndex(input.ds, input.fromMs, input.toMs),
    mode: input.mode,
    limit: input.limit,
    esVersion: input.ds.jsonData?.esVersion,
  });
  const body = await grafanaJson(input.account, input.fetchFn, path, {
    method: "POST",
    headers: { "Content-Type": "application/x-ndjson" },
    body: ndjson,
  });
  return parseMsearchResponse(body, input.ds);
}

export async function grafanaVersion(
  account: IntegrationAccount,
  fetchFn: typeof fetch,
): Promise<string> {
  try {
    const body = await grafanaJson(account, fetchFn, "/api/health");
    const version = asRecord(body).version;
    return typeof version === "string" ? version : "";
  } catch {
    return "";
  }
}

export async function listDatasources(
  account: IntegrationAccount,
  fetchFn: typeof fetch,
): Promise<GrafanaDatasource[]> {
  try {
    const body = await grafanaJson(account, fetchFn, "/api/datasources");
    const rows = parseDatasourceList(body);
    if (rows.length) return rows;
  } catch {
    // Viewer API keys on Grafana 8.5 cannot always list /api/datasources.
  }
  const settings = await grafanaJson(account, fetchFn, "/api/frontend/settings");
  return parseDatasourceList(settings);
}

export async function grafanaJson(
  account: IntegrationAccount,
  fetchFn: typeof fetch,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const url = `${account.baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetchFn(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${account.token?.trim() ?? ""}`,
      Accept: "application/json",
      ...init?.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}${text.trim() ? `: ${text.slice(0, 400)}` : ""}`);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text: text.slice(0, 2_000) };
  }
}

function selectModeFields(
  mode: GrafanaQueryMode,
  parsed: Pick<GrafanaQueryResult, "count" | "histogram" | "logs">,
): Pick<GrafanaQueryResult, "count" | "histogram" | "logs"> {
  if (mode === "count") return { count: parsed.count, histogram: parsed.histogram };
  if (mode === "logs") return { logs: parsed.logs, count: parsed.count };
  return parsed;
}

function parseMode(value: unknown): GrafanaQueryMode {
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "both";
  if (mode === "count" || mode === "logs" || mode === "both") return mode;
  throw new Error("mode must be count, logs, or both");
}

function parseLimit(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function bool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function matchesDatasource(needle: string): (row: GrafanaDatasource) => boolean {
  return (row) =>
    row.uid === needle || row.name === needle || (row.id != null && String(row.id) === needle);
}

function isDatasource(value: unknown): value is GrafanaDatasource {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === "string" && typeof row.type === "string";
}

function normalizeDatasource(row: GrafanaDatasource): GrafanaDatasource {
  const jsonData = row.jsonData && typeof row.jsonData === "object" ? row.jsonData : undefined;
  return {
    id: typeof row.id === "number" ? row.id : undefined,
    uid: typeof row.uid === "string" ? row.uid : undefined,
    name: row.name,
    type: row.type,
    database: typeof row.database === "string" ? row.database : undefined,
    isDefault: Boolean(row.isDefault),
    jsonData,
  };
}

function expandDatedIndex(
  pattern: string,
  interval: string,
  fromMs: number,
  toMs: number,
): string[] {
  const match = /^\[([^\]]+)\](.*)$/.exec(pattern);
  if (!match) return [pattern];
  const prefix = match[1]!;
  const fmt = match[2]!;
  const step = interval.toLowerCase() === "hourly" ? 3_600_000 : 86_400_000;
  const out: string[] = [];
  let t = fromMs;
  let guard = 0;
  while (t <= toMs && guard++ < 400) {
    const name = prefix + formatIndexDate(new Date(t), fmt);
    if (!out.includes(name)) out.push(name);
    t += step;
  }
  const last = prefix + formatIndexDate(new Date(toMs), fmt);
  if (!out.includes(last)) out.push(last);
  return out.length ? out : [pattern];
}

function formatIndexDate(date: Date, fmt: string): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  return fmt
    .replaceAll("YYYY", String(y))
    .replaceAll("MM", m)
    .replaceAll("DD", d)
    .replaceAll("HH", h);
}

function parseAggBuckets(aggregations: unknown): GrafanaHistogramBucket[] {
  const aggs = asRecord(aggregations);
  const hist = asRecord(aggs["2"] ?? aggs["1"]);
  const buckets = Array.isArray(hist.buckets) ? hist.buckets : [];
  return buckets
    .map((row) => {
      const bucket = asRecord(row);
      const t = typeof bucket.key === "number" ? bucket.key : Number(bucket.key);
      const count = typeof bucket.doc_count === "number" ? bucket.doc_count : 0;
      return Number.isFinite(t) ? { t, count } : undefined;
    })
    .filter((row): row is GrafanaHistogramBucket => Boolean(row));
}

function parseEsHits(hits: unknown[], ds: GrafanaDatasource): GrafanaLogHit[] {
  return hits.map((hit) => {
    const row = asRecord(hit);
    const source = asRecord(row._source);
    const messageField = ds.jsonData?.logMessageField?.trim();
    const levelField = ds.jsonData?.logLevelField?.trim() || "logger.level";
    return {
      timestamp:
        stringPath(source, "@timestamp") || stringPath(source, ds.jsonData?.timeField || ""),
      level:
        stringPath(source, levelField) ||
        stringPath(source, "logger.level") ||
        stringPath(source, "fields.level"),
      message: pickHitMessage(source, row.highlight, messageField),
      source: clipSource(source),
    };
  });
}

function parseDataFrame(frame: unknown): {
  histogram: GrafanaHistogramBucket[];
  logs: GrafanaLogHit[];
} {
  const root = asRecord(frame);
  const schema = asRecord(root.schema);
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  const data = asRecord(root.data);
  const values = Array.isArray(data.values) ? data.values : [];
  const names = fields.map((field) => String(asRecord(field).name ?? ""));
  const timeIdx = names.findIndex((name) => /time/i.test(name));
  const valueIdx = names.findIndex(
    (name) => name === "Value" || name === "count" || name === "doc_count",
  );
  const lineIdx = names.findIndex((name) => /line|message/i.test(name));
  const meta = asRecord(schema.meta);
  const isLogs =
    lineIdx >= 0 ||
    meta.preferredVisualisationType === "logs" ||
    String(asRecord(meta.custom).preferredVisualisationType ?? "") === "logs";
  if (isLogs) {
    const times = Array.isArray(values[timeIdx]) ? (values[timeIdx] as unknown[]) : [];
    const lines = Array.isArray(values[lineIdx]) ? (values[lineIdx] as unknown[]) : [];
    const logs: GrafanaLogHit[] = [];
    const n = Math.max(times.length, lines.length);
    for (let i = 0; i < n; i++) {
      const ts = times[i];
      logs.push({
        timestamp:
          typeof ts === "number" ? new Date(ts).toISOString() : ts != null ? String(ts) : undefined,
        message: lines[i] != null ? String(lines[i]) : undefined,
        source: {
          fields: Object.fromEntries(names.map((name, idx) => [name, asArray(values[idx])[i]])),
        },
      });
    }
    return { histogram: [], logs };
  }
  if (timeIdx >= 0 && valueIdx >= 0) {
    const times = asArray(values[timeIdx]);
    const counts = asArray(values[valueIdx]);
    const histogram: GrafanaHistogramBucket[] = [];
    for (let i = 0; i < times.length; i++) {
      const t = Number(times[i]);
      const count = Number(counts[i] ?? 0);
      if (Number.isFinite(t)) histogram.push({ t, count: Number.isFinite(count) ? count : 0 });
    }
    return { histogram, logs: [] };
  }
  return { histogram: [], logs: [] };
}

const MESSAGE_HIGHLIGHT_FIELDS = [
  "message",
  "msg",
  "log",
  "log.message",
  "event.original",
  "@message",
];

function highlightForField(highlight: unknown, field: string): string | undefined {
  const map = asRecord(highlight);
  const item = map[field];
  if (Array.isArray(item) && item[0] != null) return String(item[0]);
  return undefined;
}

function pickHitMessage(
  source: Record<string, unknown>,
  highlight: unknown,
  messageField?: string,
): string | undefined {
  const fields = [messageField, ...MESSAGE_HIGHLIGHT_FIELDS].filter((row): row is string =>
    Boolean(row),
  );
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field)) continue;
    seen.add(field);
    const marked = highlightForField(highlight, field);
    const stripped = marked ? stripGrafanaHighlights(marked).trim() : "";
    if (marked && stripped && !isLevelToken(stripped)) return marked;
    const raw = stringPath(source, field)?.trim();
    if (raw && !isLevelToken(raw)) return raw;
  }
  return undefined;
}

function stringPath(source: Record<string, unknown>, path: string): string | undefined {
  if (!path) return undefined;
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (current == null) return undefined;
  if (typeof current === "string" || typeof current === "number") return String(current);
  return undefined;
}

function clipSource(source: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(source);
  if (json.length <= 2_000) return source;
  return { _clipped: true, preview: json.slice(0, 1_800) };
}

function hitTotal(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  const rec = asRecord(value);
  return typeof rec.value === "number" ? rec.value : undefined;
}

function formatEsError(error: unknown): string {
  const rec = asRecord(error);
  const reason = asRecord(rec.root_cause ? asArray(rec.root_cause)[0] : rec).reason;
  return String(reason || rec.reason || rec.type || "Elasticsearch query failed");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
