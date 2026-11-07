import { describe, expect, it } from "vitest";
import {
  flattenGrafanaPanels,
  parseGrafanaDashboard,
  parseGrafanaPanelFrames,
  queryGrafanaDashboard,
  summarizeTargetQuery,
} from "./grafanaDashboard.js";

const account = {
  id: "g1",
  kind: "grafana" as const,
  name: "Grafana",
  enabled: true,
  baseUrl: "https://grafana.example.com",
  token: "glsa_test",
};

const dashboardJson = {
  meta: { url: "/d/check/checkout", uid: "check" },
  dashboard: {
    uid: "check",
    title: "Checkout",
    tags: ["prod"],
    time: { from: "now-6h", to: "now" },
    panels: [
      {
        type: "row",
        title: "Errors",
        collapsed: true,
        panels: [
          {
            id: 2,
            title: "Error rate",
            type: "timeseries",
            gridPos: { h: 8, w: 12, x: 0, y: 0 },
            datasource: { type: "prometheus", uid: "prom" },
            targets: [{ refId: "A", expr: "rate(http_errors[5m])", datasource: { uid: "prom" } }],
          },
        ],
      },
      {
        id: 3,
        title: "Notes",
        type: "text",
        gridPos: { h: 4, w: 12, x: 12, y: 0 },
        options: { content: "Watch checkout timeouts." },
      },
      {
        id: 4,
        title: "Error logs",
        type: "logs",
        gridPos: { h: 8, w: 24, x: 0, y: 8 },
        datasource: { type: "elasticsearch", uid: "es-logs" },
        targets: [{ refId: "A", query: "logger.level:error", hide: false }],
      },
    ],
  },
};

describe("Grafana dashboard parse", () => {
  it("flattens collapsed rows and keeps text panels", () => {
    const view = parseGrafanaDashboard(dashboardJson, "https://grafana.example.com", "check");
    expect(view).toMatchObject({
      uid: "check",
      title: "Checkout",
      from: "now-6h",
      url: "https://grafana.example.com/d/check/checkout",
    });
    expect(view.panels.map((row) => row.title)).toEqual(["Error rate", "Notes", "Error logs"]);
    expect(view.panels[0]?.queries).toEqual(["rate(http_errors[5m])"]);
    expect(view.panels[1]?.text).toMatch(/timeouts/);
    expect(
      flattenGrafanaPanels([{ type: "row", panels: [{ id: 1, title: "A", type: "stat" }] }]),
    ).toHaveLength(1);
    expect(summarizeTargetQuery({ rawSql: "select 1" })).toBe("select 1");
  });

  it("parses timeseries, logs, and table frames", () => {
    const series = parseGrafanaPanelFrames(
      {
        results: {
          A: {
            frames: [
              {
                schema: {
                  name: "errors",
                  fields: [
                    { name: "Time", type: "time" },
                    {
                      name: "Value",
                      type: "number",
                      labels: { instance: "checkout:80" },
                      config: { displayNameFromDS: "checkout" },
                    },
                  ],
                },
                data: {
                  values: [
                    [1_000, 2_000],
                    [4, 9],
                  ],
                },
              },
            ],
          },
        },
      },
      "timeseries",
    );
    expect(series.series?.[0]).toEqual({
      name: "checkout",
      points: [
        { t: 1_000, value: 4 },
        { t: 2_000, value: 9 },
      ],
    });

    const logs = parseGrafanaPanelFrames(
      {
        results: {
          A: {
            frames: [
              {
                schema: {
                  meta: { preferredVisualisationType: "logs" },
                  fields: [
                    { name: "Time", type: "time" },
                    { name: "Line", type: "string" },
                  ],
                },
                data: { values: [[1_700_000_000_000], ["TimeoutError"]] },
              },
            ],
          },
        },
      },
      "logs",
    );
    expect(logs.logs?.[0]?.message).toBe("TimeoutError");

    const table = parseGrafanaPanelFrames(
      {
        results: {
          A: {
            frames: [
              {
                schema: { fields: [{ name: "path" }, { name: "count", type: "number" }] },
                data: { values: [["/pay"], [3]] },
              },
            ],
          },
        },
      },
      "table",
    );
    expect(table.table).toEqual({ columns: ["path", "count"], rows: [["/pay", "3"]] });
  });
});

describe("Grafana dashboard query", () => {
  it("queries live panel targets and keeps text panels local", async () => {
    const calls: string[] = [];
    const result = await queryGrafanaDashboard(
      account,
      "check",
      { from: "now-1h" },
      async (url, init) => {
        const href = String(url);
        calls.push(`${init?.method ?? "GET"} ${href}`);
        if (href.endsWith("/api/dashboards/uid/check")) return json(dashboardJson);
        if (href.endsWith("/api/datasources")) {
          return json([
            { id: 1, uid: "prom", name: "Prometheus", type: "prometheus" },
            { id: 2, uid: "es-logs", name: "logs", type: "elasticsearch" },
          ]);
        }
        if (href.endsWith("/api/health")) return json({ version: "9.5.3" });
        if (href.endsWith("/api/ds/query")) {
          const payload = JSON.parse(String(init?.body)) as {
            queries: Array<{ expr?: string; query?: string; refId?: string }>;
          };
          const expr = payload.queries[0]?.expr;
          const lucene = payload.queries[0]?.query;
          if (expr) {
            return json({
              results: {
                A: {
                  frames: [
                    {
                      schema: {
                        fields: [
                          { name: "Time", type: "time" },
                          { name: "Value", type: "number" },
                        ],
                      },
                      data: {
                        values: [
                          [1_000, 2_000],
                          [1, 2],
                        ],
                      },
                    },
                  ],
                },
              },
            });
          }
          if (lucene === "logger.level:error") {
            return json({
              results: {
                A: {
                  frames: [
                    {
                      schema: {
                        meta: { preferredVisualisationType: "logs" },
                        fields: [{ name: "Time", type: "time" }, { name: "Line" }],
                      },
                      data: { values: [[1_700_000_000_000], ["TimeoutError"]] },
                    },
                  ],
                },
              },
            });
          }
          return json({ results: {} });
        }
        return new Response("unexpected", { status: 404 });
      },
    );
    expect(result.title).toBe("Checkout");
    expect(result.from).toBe("now-1h");
    const rate = result.panels.find((row) => row.title === "Error rate");
    expect(rate?.series?.[0]?.points).toEqual([
      { t: 1_000, value: 1 },
      { t: 2_000, value: 2 },
    ]);
    expect(result.panels.find((row) => row.title === "Notes")?.text).toMatch(/timeouts/);
    expect(result.panels.find((row) => row.title === "Error logs")?.logs?.[0]?.message).toBe(
      "TimeoutError",
    );
    expect(calls.some((row) => row.includes("/api/ds/query"))).toBe(true);
  });

  it("falls back to Elasticsearch logs when /api/ds/query is missing", async () => {
    const result = await queryGrafanaDashboard(account, "check", {}, async (url) => {
      const href = String(url);
      if (href.endsWith("/api/dashboards/uid/check")) {
        return json({
          meta: { url: "/d/check" },
          dashboard: {
            uid: "check",
            title: "Checkout",
            time: { from: "now-1h", to: "now" },
            panels: [
              {
                id: 4,
                title: "Error logs",
                type: "logs",
                targets: [{ query: "logger.level:error" }],
                datasource: { type: "elasticsearch", uid: "es-logs" },
              },
            ],
          },
        });
      }
      if (href.endsWith("/api/health")) return json({ version: "8.5.27" });
      if (href.endsWith("/api/datasources")) {
        return json([
          {
            id: 2,
            uid: "es-logs",
            name: "logs",
            type: "elasticsearch",
            database: "filebeat-*",
            jsonData: { timeField: "@timestamp", logMessageField: "message" },
          },
        ]);
      }
      if (href.endsWith("/api/ds/query")) return new Response("not found", { status: 404 });
      if (href.includes("/_msearch")) {
        return json({
          responses: [
            {
              hits: {
                total: { value: 1 },
                hits: [
                  {
                    _source: {
                      "@timestamp": "2026-10-20T09:00:00.000Z",
                      message: "TimeoutError",
                      logger: { level: "error" },
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    expect(result.panels[0]?.logs?.[0]?.message).toBe("TimeoutError");
  });

  it("substitutes dashboard variables, loads annotations, and fills label_values", async () => {
    const calls: string[] = [];
    const result = await queryGrafanaDashboard(
      account,
      "check",
      { from: "now-1h", variables: { service: "billing" } },
      async (url, init) => {
        const href = String(url);
        calls.push(href);
        if (href.endsWith("/api/dashboards/uid/check")) {
          return json({
            dashboard: {
              uid: "check",
              title: "Checkout",
              time: { from: "now-1h", to: "now" },
              templating: {
                list: [
                  {
                    name: "service",
                    type: "custom",
                    current: { value: "api" },
                    options: [
                      { text: "api", value: "api" },
                      { text: "billing", value: "billing" },
                    ],
                  },
                  {
                    name: "job",
                    type: "query",
                    datasource: { type: "prometheus", uid: "prom" },
                    query: "label_values(job)",
                    current: { value: "" },
                  },
                ],
              },
              panels: [
                {
                  id: 2,
                  title: "$service errors",
                  type: "timeseries",
                  datasource: { type: "prometheus", uid: "prom" },
                  targets: [{ refId: "A", expr: 'rate(http_errors{service="$service"}[5m])' }],
                },
              ],
            },
          });
        }
        if (href.endsWith("/api/datasources")) {
          return json([{ id: 1, uid: "prom", name: "Prometheus", type: "prometheus" }]);
        }
        if (href.endsWith("/api/health")) return json({ version: "10.0.0" });
        if (href.includes("/resources/api/v1/label/job/values")) {
          return json({ data: ["checkout", "api"] });
        }
        if (href.includes("/api/annotations")) {
          return json([
            {
              id: 9,
              time: 1_700_000_000_000,
              text: "deploy 9f3c1ab",
              tags: ["deploy"],
              panelId: 2,
            },
          ]);
        }
        if (href.endsWith("/api/ds/query")) {
          const payload = JSON.parse(String(init?.body)) as { queries: Array<{ expr?: string }> };
          expect(payload.queries[0]?.expr).toBe('rate(http_errors{service="billing"}[5m])');
          return json({ results: {} });
        }
        return new Response("unexpected", { status: 404 });
      },
    );
    expect(result.panels[0]?.title).toBe("billing errors");
    expect(result.panels[0]?.queries[0]).toContain("billing");
    expect(result.variables?.find((row) => row.name === "service")?.current).toBe("billing");
    expect(
      result.variables?.find((row) => row.name === "job")?.options.map((row) => row.value),
    ).toEqual(["checkout", "api"]);
    expect(result.annotations?.[0]?.text).toMatch(/9f3c1ab/);
    expect(result.annotations?.[0]?.signals.some((row) => row.kind === "sha")).toBe(true);
    expect(calls.some((row) => row.includes("/api/annotations"))).toBe(true);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
