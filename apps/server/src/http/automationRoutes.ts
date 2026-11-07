import type { Hono } from "hono";
import type { CreateAutomationInput, PatchAutomationInput } from "@locus/shared";
import { MAX_WEBHOOK_BYTES, unwrapAwsApiGatewayWebhook } from "@locus/shared";
import { redactAutomation } from "../core/redact.js";
import type { AutomationService } from "../automations/automations.js";
import { peerFromContext } from "../core/localguard.js";
import { errorJson } from "./sessionJson.js";

export function registerAutomationRoutes(
  app: Hono,
  automations: AutomationService | undefined,
): void {
  app.get("/api/automations", async (c) => {
    if (!automations) return c.json({ error: "Automations unavailable" }, 503);
    return c.json((await automations.list()).map(redactAutomation));
  });

  app.get("/api/automation-runs", async (c) => {
    if (!automations) return c.json({ error: "Automations unavailable" }, 503);
    return c.json(
      await automations.listRuns(
        undefined,
        listRunOpts(c.req.query("limit"), c.req.query("offset")),
      ),
    );
  });

  app.post("/api/automations", async (c) => {
    if (!automations) return c.json({ error: "Automations unavailable" }, 503);
    try {
      const input = (await c.req.json()) as CreateAutomationInput;
      return c.json(await automations.create(input), 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/automations/:id", async (c) => {
    if (!automations) return c.json({ error: "Automations unavailable" }, 503);
    const item = await automations.get(c.req.param("id"));
    if (!item) return c.json({ error: "Not found" }, 404);
    return c.json(redactAutomation(item));
  });

  app.put("/api/automations/:id", async (c) => {
    if (!automations) return c.json({ error: "Automations unavailable" }, 503);
    try {
      const input = (await c.req.json()) as PatchAutomationInput;
      return c.json(await automations.patch(c.req.param("id"), input));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.delete("/api/automations/:id", async (c) => {
    if (!automations) return c.json({ error: "Automations unavailable" }, 503);
    await automations.remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/api/automations/:id/runs", async (c) => {
    if (!automations) return c.json({ error: "Automations unavailable" }, 503);
    return c.json(
      await automations.listRuns(
        c.req.param("id"),
        listRunOpts(c.req.query("limit"), c.req.query("offset")),
      ),
    );
  });

  app.post("/api/automations/:id/run", async (c) => {
    if (!automations) return c.json({ error: "Automations unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as { runId?: unknown };
      const id = c.req.param("id");
      if (typeof body.runId === "string" && body.runId.trim()) {
        return c.json(await automations.replay(id, body.runId.trim()));
      }
      return c.json(await automations.execute(id, "manual", undefined, { wait: false }));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  });

  app.post("/api/automations/:id/stop", async (c) => {
    if (!automations) return c.json({ error: "Automations unavailable" }, 503);
    try {
      const run = await automations.abort(c.req.param("id"));
      return c.json({ ok: true, run });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/automations/:id/clone", async (c) => {
    if (!automations) return c.json({ error: "Automations unavailable" }, 503);
    try {
      return c.json(await automations.clone(c.req.param("id")), 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/automations/:id/test-webhook", async (c) => {
    if (!automations) return c.json({ error: "Automations unavailable" }, 503);
    try {
      return c.json(await automations.testWebhook(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/hooks/automations/:id", async (c) => {
    if (!automations) return c.json({ error: "Automations unavailable" }, 503);
    const lengthHeader = c.req.header("content-length");
    const declared = lengthHeader ? Number(lengthHeader) : NaN;
    if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
      return c.json({ error: "Webhook payload is too large" }, 413);
    }
    const raw = await readCappedText(c.req.raw, MAX_WEBHOOK_BYTES);
    if (raw === undefined) return c.json({ error: "Webhook payload is too large" }, 413);
    const authorization = c.req.header("authorization") ?? "";
    const bearer = authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : undefined;
    const gateway = unwrapAwsApiGatewayWebhook(raw, c.req.header("content-type"));
    try {
      return c.json(
        await automations.handleWebhook(c.req.param("id"), {
          secret:
            c.req.header("x-locus-secret") ??
            bearer ??
            c.req.header("x-api-key") ??
            gateway.headers["x-locus-secret"] ??
            gateway.headers["x-api-key"],
          signature: c.req.header("x-hub-signature-256") ?? gateway.headers["x-hub-signature-256"],
          timestamp: c.req.header("x-locus-timestamp"),
          event:
            c.req.header("x-github-event") ??
            c.req.header("x-event-key") ??
            gateway.headers["x-github-event"] ??
            gateway.headers["x-event-key"],
          raw: gateway.raw,
          contentType: gateway.contentType,
          slackSignature: c.req.header("x-slack-signature") ?? gateway.headers["x-slack-signature"],
          slackTimestamp:
            c.req.header("x-slack-request-timestamp") ??
            gateway.headers["x-slack-request-timestamp"],
          slackRetry: c.req.header("x-slack-retry-num") ?? gateway.headers["x-slack-retry-num"],
          peer: peerFromContext(c),
        }),
      );
    } catch (err) {
      return errorJson(c, err);
    }
  });
}

async function readCappedText(req: Request, maxBytes: number): Promise<string | undefined> {
  const body = req.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function listRunOpts(
  limitRaw: string | undefined,
  offsetRaw: string | undefined,
): { limit?: number; offset?: number } | undefined {
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const offset = offsetRaw ? Number(offsetRaw) : undefined;
  const opts: { limit?: number; offset?: number } = {};
  if (Number.isFinite(limit) && (limit as number) > 0) opts.limit = limit as number;
  if (Number.isFinite(offset) && (offset as number) > 0) opts.offset = offset as number;
  return opts.limit != null || opts.offset != null ? opts : undefined;
}
