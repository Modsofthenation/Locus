import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "../session/sessions.js";
import { bestFileMatch, linkSignalsToRepos, listRepoFiles } from "./grafanaExplorer.js";

const elasticDs = {
  id: 2,
  uid: "es-logs",
  name: "logs",
  type: "elasticsearch",
  database: "filebeat-*",
  isDefault: true,
  jsonData: { timeField: "@timestamp", logMessageField: "message" },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function setup(fetchFn: typeof fetch) {
  const dir = await mkdtemp(join(tmpdir(), "locus-grafana-"));
  const store = new JsonStore(dir);
  await store.init();
  const hypervisor = new MockHypervisor(dir);
  const hub = new Hub();
  const sessions = new SessionService(store, hypervisor, hub);
  const app = createApp({ store, sessions, hypervisor, fetchFn });
  const config = await store.loadConfig();
  await store.saveConfig({
    ...config,
    integrations: [
      {
        id: "g1",
        kind: "grafana",
        name: "Grafana",
        enabled: true,
        baseUrl: "https://grafana.example.com",
        token: "glsa_test",
      },
    ],
  });
  return { dir, store, hypervisor, sessions, app };
}

describe("Grafana explorer HTTP", () => {
  it("returns disconnected status without a token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-grafana-"));
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const app = createApp({ store, sessions, hypervisor });
    const res = await app.request("/api/grafana/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: false });
    hypervisor.shutdown();
  });

  it("queries logs, lists dashboards, traces into a linked repo, and briefs", async () => {
    const dest = await mkdtemp(join(tmpdir(), "billing-"));
    await mkdir(join(dest, "src"), { recursive: true });
    await writeFile(join(dest, "src", "charge.ts"), "export function charge() {}\n");
    const ctx = await setup(async (url) => {
      const href = String(url);
      if (href.endsWith("/api/health")) return json({ version: "8.5.27" });
      if (href.endsWith("/api/datasources")) return json([elasticDs]);
      if (href.includes("/api/search")) {
        return json([{ uid: "check", title: "Checkout", url: "/d/check", tags: ["prod"] }]);
      }
      if (href.includes("/api/dashboards/uid/check")) {
        return json({
          meta: { url: "/d/check/checkout" },
          dashboard: {
            uid: "check",
            title: "Checkout",
            time: { from: "now-6h", to: "now" },
            panels: [
              {
                id: 2,
                title: "Error rate",
                type: "timeseries",
                targets: [{ expr: "rate(http_errors[5m])" }],
                datasource: { type: "prometheus", uid: "prom" },
              },
              {
                id: 3,
                title: "Notes",
                type: "text",
                options: { content: "Watch checkout." },
              },
            ],
          },
        });
      }
      if (href.endsWith("/api/ds/query")) {
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
                  data: { values: [[1_000], [4]] },
                },
              ],
            },
          },
        });
      }
      if (href.includes("/_msearch")) {
        return json({
          responses: [
            {
              hits: {
                total: { value: 1, relation: "eq" },
                hits: [
                  {
                    _source: {
                      "@timestamp": "2026-10-20T09:00:00.000Z",
                      message: "TimeoutError at src/charge.ts:12 service billing",
                      logger: { level: "error" },
                      service: "billing",
                    },
                  },
                ],
              },
              aggregations: { "2": { buckets: [{ key: 1, doc_count: 1 }] } },
            },
          ],
        });
      }
      return new Response("unexpected", { status: 404 });
    });
    await ctx.store.saveRepos([
      {
        id: "r1",
        name: "billing",
        checkout: { forge: "github", url: "https://github.com/acme/billing", dest },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const status = await ctx.app.request("/api/grafana/status");
    expect(await status.json()).toMatchObject({
      connected: true,
      version: "8.5.27",
      datasources: [expect.objectContaining({ name: "logs", type: "elasticsearch" })],
    });

    const queried = await ctx.app.request("/api/grafana/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "logger.level:error" }),
    });
    expect(queried.status).toBe(200);
    const result = (await queried.json()) as {
      lucene: string;
      count: number;
      logs: Array<{ message?: string }>;
    };
    expect(result.lucene).toBe("logger.level:error");
    expect(result.count).toBe(1);
    expect(result.logs[0]?.message).toMatch(/TimeoutError/);

    const enriched = await ctx.app.request("/api/grafana/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "logger.level:error", enrich: true }),
    });
    expect(enriched.status).toBe(200);
    const exploration = (await enriched.json()) as {
      trace?: { links: Array<{ path?: string }> };
      links?: Array<{ path?: string }>;
    };
    expect(exploration.trace?.links.some((row) => row.path === "src/charge.ts")).toBe(true);
    expect(exploration.links?.some((row) => row.path === "src/charge.ts")).toBe(true);

    const recents = await (await ctx.app.request("/api/grafana/recents")).json();
    expect(recents).toEqual([expect.objectContaining({ query: "logger.level:error" })]);

    const dashboards = await (await ctx.app.request("/api/grafana/dashboards?q=check")).json();
    expect(dashboards).toEqual([expect.objectContaining({ uid: "check", title: "Checkout" })]);

    const dash = (await (await ctx.app.request("/api/grafana/dashboards/check")).json()) as {
      title: string;
      panels: Array<{ title: string }>;
    };
    expect(dash.title).toBe("Checkout");
    expect(dash.panels.map((row) => row.title)).toContain("Error rate");

    const live = (await (
      await ctx.app.request("/api/grafana/dashboards/check/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "now-1h" }),
      })
    ).json()) as {
      panels: Array<{ title: string; series?: Array<{ points: unknown[] }>; text?: string }>;
    };
    expect(live.panels.find((row) => row.title === "Error rate")?.series?.[0]?.points).toEqual([
      { t: 1_000, value: 4 },
    ]);
    expect(live.panels.find((row) => row.title === "Notes")?.text).toMatch(/checkout/);

    const traced = await ctx.app.request("/api/grafana/trace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        logs: [
          {
            level: "error",
            message: "TimeoutError at src/charge.ts:12",
            source: { service: "billing" },
          },
        ],
      }),
    });
    const trace = (await traced.json()) as {
      links: Array<{ repoId: string; path?: string }>;
      suggestedQueries: string[];
    };
    expect(trace.links.some((row) => row.repoId === "r1" && row.path === "src/charge.ts")).toBe(
      true,
    );
    expect(trace.suggestedQueries).toContain("logger.level:error");

    const briefed = await ctx.app.request("/api/grafana/brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "logger.level:error",
        logs: [{ level: "error", message: "TimeoutError at src/charge.ts:12" }],
      }),
    });
    const brief = (await briefed.json()) as { summary: string; severity: string };
    expect(brief.severity).toBe("error");
    expect(brief.summary).toMatch(/TimeoutError|log/i);

    const config = await ctx.store.loadConfig();
    const investigated = await ctx.app.request("/api/grafana/investigate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "logger.level:error",
        from: "now-1h",
        note: "Checkout timeouts",
        logs: [{ level: "error", message: "TimeoutError at src/charge.ts:12" }],
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
      }),
    });
    expect(investigated.status).toBe(200);
    const created = (await investigated.json()) as { sessionId: string; created: boolean };
    expect(created.created).toBe(true);
    const session = await ctx.sessions.get(created.sessionId);
    expect(session?.title).toMatch(/Grafana/);
    expect(session?.repoId).toBe("r1");
    expect(session?.playbook).toMatch(/grafana_query/);
    const prompt = session?.messages.find((row) => row.role === "user")?.content ?? "";
    expect(prompt).toContain("Checkout timeouts");
    expect(prompt).toContain("logger.level:error");
    expect(prompt).toContain("charge.ts");
    expect(prompt).toContain('<untrusted-data kind="tool-output" source="grafana"');
    expect(session?.runtime).toBe("docker");

    const panel = await ctx.app.request("/api/grafana/investigate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "rate(http_errors[5m])",
        panelType: "timeseries",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
      }),
    });
    expect(panel.status).toBe(200);
    const panelSession = await ctx.sessions.get(
      ((await panel.json()) as { sessionId: string }).sessionId,
    );
    const panelPrompt = panelSession?.messages.find((row) => row.role === "user")?.content ?? "";
    expect(panelPrompt).toContain("not Lucene");
    expect(panelPrompt).toContain("Panel query: rate(http_errors[5m])");

    ctx.hypervisor.shutdown();
  });

  it("lists firing alerts, pins a dashboard, and hops a trace into a repo", async () => {
    const dest = await mkdtemp(join(tmpdir(), "billing-trace-"));
    await mkdir(join(dest, "src"), { recursive: true });
    await writeFile(join(dest, "src", "charge.ts"), "export {}\n");
    const ctx = await setup(async (url, init) => {
      const href = String(url);
      if (href.endsWith("/api/health")) return json({ version: "10.4.0" });
      if (href.endsWith("/api/datasources")) {
        return json([elasticDs, { id: 3, uid: "tempo", name: "Tempo", type: "tempo" }]);
      }
      if (href.includes("/api/alertmanager/grafana/api/v2/alerts")) {
        return json([
          {
            fingerprint: "abc",
            startsAt: "2026-10-21T12:00:00.000Z",
            status: { state: "active" },
            labels: { alertname: "HighErrorRate", service: "billing" },
            annotations: { summary: "errors up", __dashboardUid__: "check" },
          },
        ]);
      }
      if (href.endsWith("/api/ds/query")) {
        const payload = JSON.parse(String(init?.body)) as {
          queries?: Array<{ queryType?: string; query?: string }>;
        };
        expect(payload.queries?.[0]?.queryType).toBe("traceId");
        return json({ results: {} });
      }
      if (href.includes("/api/traces/abc123def456")) {
        return json({
          data: [
            {
              traceID: "abc123def456",
              processes: { p1: { serviceName: "billing" } },
              spans: [
                {
                  spanID: "s1",
                  operationName: "src/charge.ts",
                  processID: "p1",
                  duration: 4_000,
                },
              ],
            },
          ],
        });
      }
      return new Response("unexpected", { status: 404 });
    });
    await ctx.store.saveRepos([
      {
        id: "r1",
        name: "billing",
        checkout: { forge: "github", url: "https://github.com/acme/billing", dest },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const alerts = (await (await ctx.app.request("/api/grafana/alerts")).json()) as Array<{
      name: string;
      dashboardUid?: string;
    }>;
    expect(alerts.map((row) => row.name)).toEqual(["HighErrorRate"]);
    expect(alerts[0]?.dashboardUid).toBe("check");

    const pinned = await ctx.app.request("/api/grafana/pins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid: "check", title: "Checkout" }),
    });
    expect(await pinned.json()).toEqual([
      expect.objectContaining({ uid: "check", title: "Checkout" }),
    ]);
    const unpinned = await ctx.app.request("/api/grafana/pins/check", { method: "DELETE" });
    expect(await unpinned.json()).toEqual([]);

    const hop = (await (
      await ctx.app.request("/api/grafana/trace-hop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ traceId: "abc123def456" }),
      })
    ).json()) as { spans: Array<{ service?: string }>; links: Array<{ path?: string }> };
    expect(hop.spans[0]?.service).toBe("billing");
    expect(hop.links.some((row) => row.path === "src/charge.ts")).toBe(true);
    ctx.hypervisor.shutdown();
  });

  it("matches a repo file by suffix", async () => {
    const dest = await mkdtemp(join(tmpdir(), "repo-"));
    await mkdir(join(dest, "apps", "server", "src"), { recursive: true });
    await writeFile(join(dest, "apps", "server", "src", "app.ts"), "export {}\n");
    const files = await listRepoFiles(dest);
    expect(bestFileMatch(files, dest, "apps/server/src/app.ts")).toBe("apps/server/src/app.ts");
    expect(bestFileMatch(files, dest, "src/app.ts")).toBe("apps/server/src/app.ts");
    const links = await linkSignalsToRepos(
      [{ kind: "file", value: "src/app.ts", line: 4 }],
      [
        {
          id: "r1",
          name: "billing",
          checkout: { forge: "github", url: "https://github.com/acme/billing", dest },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    );
    expect(links[0]).toMatchObject({ repoId: "r1", path: "apps/server/src/app.ts", line: 4 });
  });
});
