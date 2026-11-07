import type { Hono } from "hono";
import type { GrafanaLogHitLite, GrafanaRepoLink } from "@locus/shared";
import { errorMessage } from "./sessionJson.js";
import type { GrafanaExplorer } from "../integrations/grafanaExplorer.js";

function asLogs(value: unknown): GrafanaLogHitLite[] | undefined {
  return Array.isArray(value) ? (value as GrafanaLogHitLite[]) : undefined;
}

function asLinks(value: unknown): GrafanaRepoLink[] | undefined {
  return Array.isArray(value) ? (value as GrafanaRepoLink[]) : undefined;
}

export function registerGrafanaRoutes(app: Hono, grafana: GrafanaExplorer): void {
  app.get("/api/grafana/status", async (c) => c.json(await grafana.status()));

  app.get("/api/grafana/recents", async (c) => c.json(await grafana.recents()));

  app.get("/api/grafana/dashboards", async (c) => {
    try {
      return c.json(await grafana.dashboards(c.req.query("q") ?? ""));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/grafana/dashboards/:uid", async (c) => {
    try {
      return c.json(await grafana.dashboard(c.req.param("uid")));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/grafana/dashboards/:uid/query", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        from?: string;
        to?: string;
        panelId?: number;
        variables?: Record<string, string>;
      };
      return c.json(await grafana.queryDashboard(c.req.param("uid"), body));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/grafana/query", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        query?: string;
        from?: string;
        to?: string;
        mode?: string;
        limit?: number;
        datasource?: string;
        explore_url_only?: boolean;
        enrich?: boolean;
      };
      return c.json(await grafana.query(body));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/grafana/trace", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        logs?: unknown;
        query?: string;
      };
      return c.json(await grafana.trace({ logs: asLogs(body.logs), query: body.query }));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/grafana/brief", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        logs?: unknown;
        query?: string;
        from?: string;
        to?: string;
      };
      return c.json(
        await grafana.brief({
          logs: asLogs(body.logs),
          query: body.query,
          from: body.from,
          to: body.to,
        }),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/grafana/alerts", async (c) => {
    try {
      return c.json(await grafana.alerts());
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/grafana/pins", async (c) => c.json(await grafana.pins()));

  app.post("/api/grafana/pins", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { uid?: string; title?: string };
      return c.json(await grafana.pin(body.uid ?? "", body.title));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.delete("/api/grafana/pins/:uid", async (c) => {
    try {
      return c.json(await grafana.unpin(c.req.param("uid")));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/grafana/trace-hop", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { traceId?: string };
      return c.json(await grafana.traceHop(body.traceId ?? ""));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/grafana/investigate", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        query?: string;
        from?: string;
        to?: string;
        note?: string;
        logs?: unknown;
        links?: unknown;
        exploreUrl?: string;
        repoId?: string;
        providerId?: string;
        model?: string;
        asLucene?: boolean;
        panelType?: string;
      };
      return c.json(
        await grafana.investigate({
          query: body.query,
          from: body.from,
          to: body.to,
          note: body.note,
          logs: asLogs(body.logs),
          links: asLinks(body.links),
          exploreUrl: body.exploreUrl,
          repoId: body.repoId,
          providerId: body.providerId,
          model: body.model,
          asLucene: body.asLucene,
          panelType: body.panelType,
        }),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });
}
