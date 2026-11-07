import {
  parseGrafanaAlerts,
  parseGrafanaSpans,
  type GrafanaAlert,
  type GrafanaSpan,
  type GrafanaTraceHop,
  type IntegrationAccount,
} from "@locus/shared";
import { grafanaJson, listDatasources, type GrafanaDatasource } from "./grafanaQuery.js";

export async function listGrafanaAlerts(
  account: IntegrationAccount,
  fetchFn: typeof fetch,
): Promise<GrafanaAlert[]> {
  try {
    const body = await grafanaJson(
      account,
      fetchFn,
      "/api/alertmanager/grafana/api/v2/alerts?active=true&silenced=false&inhibited=false",
    );
    return parseGrafanaAlerts(body).filter((row) => row.state === "firing");
  } catch {
    /* Unified alerting is optional. Try the Prometheus-compatible endpoint. */
  }
  try {
    const body = await grafanaJson(account, fetchFn, "/api/prometheus/grafana/api/v1/alerts");
    return parseGrafanaAlerts(body).filter((row) => row.state === "firing");
  } catch {
    return [];
  }
}

export async function queryGrafanaTrace(
  account: IntegrationAccount,
  traceId: string,
  fetchFn: typeof fetch,
): Promise<GrafanaTraceHop> {
  const id = traceId.trim();
  if (!id) return { traceId: id, spans: [], links: [], error: "trace id is required" };
  const datasources = await listDatasources(account, fetchFn).catch(() => []);
  const ds =
    datasources.find((row) => row.type === "tempo") ??
    datasources.find((row) => row.type === "jaeger");
  if (!ds) {
    return { traceId: id, spans: [], links: [], error: "No Tempo or Jaeger datasource" };
  }
  try {
    const spans = await fetchTraceSpans(account, fetchFn, ds, id);
    return { traceId: id, datasource: ds.name, spans, links: [] };
  } catch (err) {
    return {
      traceId: id,
      datasource: ds.name,
      spans: [],
      links: [],
      error: err instanceof Error ? err.message : "Trace lookup failed",
    };
  }
}

async function fetchTraceSpans(
  account: IntegrationAccount,
  fetchFn: typeof fetch,
  ds: GrafanaDatasource,
  traceId: string,
): Promise<GrafanaSpan[]> {
  const queried = await grafanaJson(account, fetchFn, "/api/ds/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queries: [
        {
          refId: "A",
          datasource: { type: ds.type, uid: ds.uid },
          query: traceId,
          queryType: "traceId",
        },
      ],
    }),
  }).catch(() => undefined);
  const fromQuery = queried ? parseGrafanaSpans(queried, traceId) : [];
  if (fromQuery.length || !ds.uid) return fromQuery;
  const proxied = await grafanaJson(
    account,
    fetchFn,
    `/api/datasources/proxy/uid/${encodeURIComponent(ds.uid)}/api/traces/${encodeURIComponent(traceId)}`,
  );
  return parseGrafanaSpans(proxied, traceId);
}
