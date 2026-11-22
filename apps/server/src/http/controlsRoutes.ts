import type { Context, Hono } from "hono";
import { parseTelemetrySettings, type BudgetScope } from "@locus/shared";
import { parseAuditSince } from "@locus/shared/auditChain";
import { isLocalOperator } from "../core/localguard.js";
import type { JsonStore } from "../core/store.js";
import type { TelemetryExporter } from "../core/telemetry.js";
import type { SessionService } from "../session/sessions.js";

/** Audit log, daily budgets, and telemetry status. Loopback-only like `/api/audit/approvals`. */
export function registerControlsRoutes(
  app: Hono,
  opts: {
    store: JsonStore;
    sessions: SessionService;
    telemetry?: TelemetryExporter;
    peerAddress?: (c: Context) => string | undefined;
  },
): void {
  const local = (c: Context) => isLocalOperator(c, opts.peerAddress);
  const denied = (c: Context) =>
    c.json({ error: "Audit and budget controls are desktop-only" }, 403);

  app.get("/api/audit/log", async (c) => {
    if (!local(c)) return denied(c);
    let since: string | undefined;
    try {
      since = parseAuditSince(c.req.query("since"));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Bad since" }, 400);
    }
    const format = c.req.query("format") === "csv" ? "csv" : "jsonl";
    const body = await opts.sessions.audit.export(since, format);
    return c.body(body, 200, {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson",
    });
  });

  app.get("/api/audit/verify", async (c) => {
    if (!local(c)) return denied(c);
    return c.json(await opts.sessions.audit.verify());
  });

  app.get("/api/budgets", async (c) => {
    if (!local(c)) return denied(c);
    const config = await opts.store.loadConfig();
    return c.json({
      status: await opts.sessions.budgets.status(config),
      overrides: await opts.sessions.budgets.listOverrides(),
    });
  });

  app.post("/api/budgets/override", async (c) => {
    if (!local(c)) return denied(c);
    const body = (await c.req.json().catch(() => ({}))) as {
      scope?: string;
      id?: string;
      reason?: string;
      by?: string;
    };
    const scope: BudgetScope | undefined =
      body.scope === "global" || body.scope === "automation" || body.scope === "project"
        ? body.scope
        : undefined;
    if (!scope) return c.json({ error: "scope must be global, automation, or project" }, 400);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (scope !== "global" && !id) return c.json({ error: `${scope} override needs an id` }, 400);
    const by =
      typeof body.by === "string" && body.by.trim() ? body.by.trim().slice(0, 60) : "operator";
    const row = await opts.sessions.budgets.override({ scope, id, by, reason: body.reason });
    await opts.sessions.audit.append({
      type: "budget_override",
      actor: by,
      decision: "override",
      summary: `Override ${scope}${row.id ? ` ${row.id}` : ""} daily cap for ${row.day}${row.reason ? `: ${row.reason}` : ""}`,
      data: { scope, id: row.id, day: row.day },
    });
    const config = await opts.store.loadConfig();
    return c.json({ override: row, status: await opts.sessions.budgets.status(config) });
  });

  app.get("/api/telemetry/status", (c) => {
    if (!local(c)) return denied(c);
    return c.json(
      opts.telemetry?.status() ?? {
        enabled: false,
        exportedSpans: 0,
        exportedMetricBatches: 0,
        droppedSpans: 0,
        failedRequests: 0,
      },
    );
  });

  app.post("/api/telemetry/test", async (c) => {
    if (!local(c)) return denied(c);
    if (!opts.telemetry) return c.json({ ok: false, error: "Telemetry exporter unavailable" });
    const body = (await c.req.json().catch(() => ({}))) as { telemetry?: unknown };
    const config = await opts.store.loadConfig();
    const incoming = parseTelemetrySettings(body.telemetry);
    // Masked header values from Settings fall back to the vaulted ones.
    const headers = { ...(config.telemetry?.headers ?? {}) };
    for (const [key, value] of Object.entries(incoming?.headers ?? {})) {
      if (!/^•+$/.test(value)) headers[key] = value;
    }
    return c.json(await opts.telemetry.test({ ...(incoming ?? config.telemetry), headers }));
  });
}
