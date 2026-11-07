import { describe, expect, it } from "vitest";
import { extractLogSignals, grafanaDisplayMessage, heuristicGrafanaBriefing } from "@locus/shared";
import {
  buildExploreUrl,
  buildMsearchBody,
  esUsesFixedInterval,
  grafanaUsesBackendEsQuery,
  histogramInterval,
  parseDatasourceList,
  parseGrafanaQueryArgs,
  parseGrafanaTime,
  parseMsearchResponse,
  pickElasticsearchDatasource,
  queryGrafanaLogs,
  resolveIndex,
  shouldFallBackToProxy,
} from "./grafanaQuery.js";

const LUCENE = "logger.level:error AND message:timeout";

const grafanaAccount = {
  id: "g1",
  kind: "grafana" as const,
  name: "Grafana",
  enabled: true,
  baseUrl: "https://grafana.example.com",
  token: "glsa_test",
};

const elasticDs = {
  id: 2,
  uid: "es-logs",
  name: "logs",
  type: "elasticsearch",
  database: "filebeat-*",
  isDefault: true,
  jsonData: { timeField: "@timestamp", esVersion: "7.10.0", logMessageField: "message" },
};

describe("Grafana Lucene query", () => {
  it("requires a Lucene query from the caller", () => {
    expect(() => parseGrafanaQueryArgs({})).toThrow(/query is required/);
    expect(parseGrafanaQueryArgs({ query: LUCENE, from: "now-6h" })).toMatchObject({
      query: LUCENE,
      from: "now-6h",
      to: "now",
      mode: "both",
    });
    expect(parseGrafanaQueryArgs({ q: "status:500" }).query).toBe("status:500");
  });
});

describe("Grafana time and Explore URL", () => {
  it("parses now-relative ranges and ISO-8601", () => {
    const now = Date.parse("2026-08-26T12:00:00.000Z");
    expect(parseGrafanaTime("now", now)).toBe(now);
    expect(parseGrafanaTime("now-1h", now)).toBe(now - 3_600_000);
    expect(parseGrafanaTime("now-15m", now)).toBe(now - 15 * 60_000);
    expect(parseGrafanaTime("now-7d", now)).toBe(now - 7 * 86_400_000);
    expect(parseGrafanaTime("2026-08-26T00:00:00.000Z", now)).toBe(
      Date.parse("2026-08-26T00:00:00.000Z"),
    );
  });

  it("picks histogram buckets from the range length", () => {
    expect(histogramInterval(0, 3_600_000)).toBe("1m");
    expect(histogramInterval(0, 6 * 3_600_000)).toBe("5m");
    expect(histogramInterval(0, 24 * 3_600_000)).toBe("15m");
  });

  it("builds a Grafana 8.5 compact Explore URL", () => {
    const url = buildExploreUrl({
      baseUrl: "https://grafana.example.com",
      from: "now-1h",
      to: "now",
      lucene: LUCENE,
      datasourceName: "logs",
    });
    expect(url).toContain("https://grafana.example.com/explore?orgId=1&left=");
    const left = JSON.parse(decodeURIComponent(url.split("left=")[1]!)) as unknown[];
    expect(left[0]).toBe("now-1h");
    expect(left[1]).toBe("now");
    expect(left[2]).toBe("logs");
    expect(left[3]).toMatchObject({
      query: LUCENE,
      metrics: [{ id: "1", type: "logs" }],
    });
  });
});

describe("Grafana 8.5 Elasticsearch query body", () => {
  it("uses interval (not fixed_interval) on ES 7 and dated index lists", () => {
    expect(esUsesFixedInterval("7.10.0")).toBe(false);
    expect(esUsesFixedInterval("8.8.1")).toBe(true);
    expect(esUsesFixedInterval(70)).toBe(false);
    const indexes = resolveIndex(
      {
        name: "logs",
        type: "elasticsearch",
        database: "[filebeat-]YYYY.MM.DD",
        jsonData: { interval: "Daily" },
      },
      Date.parse("2026-08-25T12:00:00.000Z"),
      Date.parse("2026-08-26T12:00:00.000Z"),
    );
    expect(indexes).toEqual(["filebeat-2026.08.25", "filebeat-2026.08.26"]);
  });

  it("builds an _msearch body with Lucene query_string and a date_histogram", () => {
    const ndjson = buildMsearchBody({
      lucene: LUCENE,
      fromMs: 1_000,
      toMs: 2_000,
      timeField: "@timestamp",
      index: "filebeat-*",
      mode: "both",
      limit: 25,
      esVersion: "7.10.0",
    });
    const lines = ndjson
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const header = lines[0];
    const body = lines[1];
    if (!header || !body) throw new Error("expected _msearch header and body");
    expect(header).toMatchObject({
      search_type: "query_then_fetch",
      ignore_unavailable: true,
      index: "filebeat-*",
    });
    expect(body.size).toBe(25);
    expect(JSON.stringify(body.query)).toContain(LUCENE);
    expect(JSON.stringify(body.aggs)).toContain("date_histogram");
    expect(JSON.stringify(body.aggs)).toContain('"interval":"1m"');
  });

  it("parses hits.total and histogram buckets from _msearch", () => {
    const parsed = parseMsearchResponse(
      {
        responses: [
          {
            hits: {
              total: { value: 3, relation: "eq" },
              hits: [
                {
                  _source: {
                    "@timestamp": "2026-08-26T11:00:00.000Z",
                    message: "request failed",
                    logger: { level: "error" },
                  },
                },
              ],
            },
            aggregations: {
              "2": { buckets: [{ key: 1_000, doc_count: 3 }] },
            },
          },
        ],
      },
      elasticDs,
    );
    expect(parsed.count).toBe(3);
    expect(parsed.histogram).toEqual([{ t: 1_000, count: 3 }]);
    expect(parsed.logs?.[0]).toMatchObject({
      message: "request failed",
      level: "error",
    });
  });

  it("does not use a highlighted logger.level as the log line", () => {
    const parsed = parseMsearchResponse(
      {
        responses: [
          {
            hits: {
              total: { value: 1, relation: "eq" },
              hits: [
                {
                  _source: {
                    "@timestamp": "2026-10-20T07:37:12.000Z",
                    logger: { level: "error" },
                    task_name: "workers.tasks.queue.flush.flush_a",
                    hostname: "e7c182fc85e0",
                    task_id: "7d8a8226f1cbec3818b4478557a981ed",
                  },
                  highlight: {
                    "logger.level": ["@HIGHLIGHT@error@/HIGHLIGHT@"],
                  },
                },
                {
                  _source: {
                    "@timestamp": "2026-10-20T07:37:11.000Z",
                    message: "payment timeout",
                    logger: { level: "error" },
                  },
                  highlight: {
                    message: ["payment @HIGHLIGHT@timeout@/HIGHLIGHT@"],
                    "logger.level": ["@HIGHLIGHT@error@/HIGHLIGHT@"],
                  },
                },
              ],
            },
          },
        ],
      },
      elasticDs,
    );
    const filebeat = parsed.logs?.[0];
    expect(filebeat?.message).toBeUndefined();
    const preview = grafanaDisplayMessage(filebeat!);
    expect(preview).toContain("workers.tasks.queue.flush.flush_a");
    expect(preview).not.toContain("HIGHLIGHT");
    expect(parsed.logs?.[1]?.message).toBe("payment @HIGHLIGHT@timeout@/HIGHLIGHT@");
    expect(
      extractLogSignals([filebeat!]).some((row) => row.kind === "sha" || row.kind === "error"),
    ).toBe(false);
    expect(heuristicGrafanaBriefing([filebeat!]).hypotheses.join(" ")).not.toMatch(/hostname=/);
  });
});

describe("queryGrafanaLogs", () => {
  it("prints the Explore URL without calling Grafana", async () => {
    const calls: string[] = [];
    const result = await queryGrafanaLogs(
      grafanaAccount,
      { query: LUCENE, explore_url_only: true },
      async (url) => {
        calls.push(String(url));
        return new Response("nope", { status: 500 });
      },
    );
    expect(calls).toEqual([]);
    expect(result.lucene).toBe(LUCENE);
    expect(result.explore_url).toContain("/explore?");
    expect(result.explore_url).toContain("now-1h");
  });

  it("queries Grafana 8.5 through the datasource proxy with a Bearer API key", async () => {
    const calls: Array<{ url: string; auth?: string; method?: string; body?: string }> = [];
    const result = await queryGrafanaLogs(
      grafanaAccount,
      { query: LUCENE, from: "now-1h", mode: "both", limit: 25 },
      async (url, init) => {
        const href = String(url);
        const headers = new Headers(init?.headers);
        calls.push({
          url: href,
          auth: headers.get("Authorization") ?? undefined,
          method: init?.method,
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        if (href.endsWith("/api/health")) {
          return json({ version: "8.5.27", database: "ok" });
        }
        if (href.endsWith("/api/datasources")) {
          return json([elasticDs]);
        }
        if (href.includes("/api/datasources/proxy/2/_msearch")) {
          expect(headers.get("Content-Type")).toBe("application/x-ndjson");
          expect(init?.body).toContain(LUCENE);
          return json({
            responses: [
              {
                hits: {
                  total: { value: 2, relation: "eq" },
                  hits: [
                    {
                      _source: {
                        "@timestamp": "2026-08-26T11:58:00.000Z",
                        message: "payment timeout",
                        logger: { level: "error" },
                      },
                    },
                  ],
                },
                aggregations: {
                  "2": { buckets: [{ key: 1_690, doc_count: 2 }] },
                },
              },
            ],
          });
        }
        return new Response("unexpected", { status: 404 });
      },
    );
    expect(calls.every((call) => call.auth === "Bearer glsa_test")).toBe(true);
    expect(calls.some((call) => call.url.includes("/api/ds/query"))).toBe(false);
    expect(calls.some((call) => call.url.includes("/api/datasources/proxy/2/_msearch"))).toBe(true);
    expect(result.count).toBe(2);
    expect(result.logs?.[0]?.message).toBe("payment timeout");
    expect(result.explore_url).toContain("logs");
    expect(result.lucene).toBe(LUCENE);
  });

  it("uses /api/ds/query on Grafana 9+ and falls back to frontend settings when listing datasources is forbidden", async () => {
    const result = await queryGrafanaLogs(
      grafanaAccount,
      { query: "status:500", from: "now-6h", mode: "count" },
      async (url, init) => {
        const href = String(url);
        if (href.endsWith("/api/health")) return json({ version: "9.5.3" });
        if (href.endsWith("/api/datasources")) {
          return new Response("forbidden", { status: 403 });
        }
        if (href.endsWith("/api/frontend/settings")) {
          return json({
            datasources: {
              "-- Grafana --": { name: "-- Grafana --", type: "datasource" },
              logs: elasticDs,
            },
          });
        }
        if (href.endsWith("/api/ds/query")) {
          const payload = JSON.parse(String(init?.body)) as {
            queries: Array<{ query: string; metrics: Array<{ type: string }> }>;
          };
          expect(payload.queries[0]?.query).toBe("status:500");
          expect(payload.queries[0]?.metrics[0]?.type).toBe("count");
          return json({
            results: {
              A: {
                frames: [
                  {
                    schema: {
                      fields: [{ name: "Time" }, { name: "Value" }],
                    },
                    data: {
                      values: [
                        [1_000, 2_000],
                        [4, 5],
                      ],
                    },
                  },
                ],
              },
            },
          });
        }
        return new Response("unexpected", { status: 404 });
      },
    );
    expect(result.count).toBe(9);
    expect(result.histogram).toEqual([
      { t: 1_000, count: 4 },
      { t: 2_000, count: 5 },
    ]);
    expect(result.logs).toBeUndefined();
  });

  it("picks the default Elasticsearch datasource", () => {
    const rows = parseDatasourceList([
      { id: 1, name: "Prometheus", type: "prometheus" },
      elasticDs,
    ]);
    expect(pickElasticsearchDatasource(rows).name).toBe("logs");
    expect(grafanaUsesBackendEsQuery("8.5.27")).toBe(false);
    expect(grafanaUsesBackendEsQuery("9.5.3")).toBe(true);
  });

  it("falls back to the 8.5 proxy when /api/ds/query is missing, not on query errors", async () => {
    expect(shouldFallBackToProxy(new Error("HTTP 404"))).toBe(true);
    expect(
      shouldFallBackToProxy(new Error("Query data requires a backend datasource plugin")),
    ).toBe(true);
    expect(shouldFallBackToProxy(new Error("parse_exception: failed to parse query"))).toBe(false);

    let msearch = 0;
    await expect(
      queryGrafanaLogs(grafanaAccount, { query: LUCENE, mode: "count" }, async (url) => {
        const href = String(url);
        if (href.endsWith("/api/health")) return json({ version: "9.5.3" });
        if (href.endsWith("/api/datasources")) return json([elasticDs]);
        if (href.endsWith("/api/ds/query")) {
          return new Response("parse_exception: failed to parse query", { status: 400 });
        }
        if (href.includes("/_msearch")) {
          msearch += 1;
          return json({ responses: [{ hits: { total: { value: 0 } } }] });
        }
        return new Response("unexpected", { status: 404 });
      }),
    ).rejects.toThrow(/parse_exception/);
    expect(msearch).toBe(0);

    const fallback = await queryGrafanaLogs(
      grafanaAccount,
      { query: LUCENE, mode: "count" },
      async (url) => {
        const href = String(url);
        if (href.endsWith("/api/health")) return json({ version: "9.5.3" });
        if (href.endsWith("/api/datasources")) return json([elasticDs]);
        if (href.endsWith("/api/ds/query")) return new Response("not found", { status: 404 });
        if (href.includes("/_msearch")) {
          return json({
            responses: [
              {
                hits: { total: { value: 4, relation: "eq" } },
                aggregations: { "2": { buckets: [] } },
              },
            ],
          });
        }
        return new Response("unexpected", { status: 500 });
      },
    );
    expect(fallback.count).toBe(4);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}
