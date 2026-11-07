import type { Hono } from "hono";
import type { WorkflowService } from "../workflows/service.js";
import { errorJson } from "./sessionJson.js";

export function registerWorkflowRoutes(app: Hono, workflows: WorkflowService | undefined): void {
  app.get("/api/workflows", async (c) => {
    if (!workflows) return c.json({ error: "Workflows unavailable" }, 503);
    return c.json(await workflows.list());
  });

  app.get("/api/workflow-templates", (c) => {
    if (!workflows) return c.json({ error: "Workflows unavailable" }, 503);
    return c.json(workflows.listTemplates());
  });

  app.post("/api/workflows", async (c) => {
    if (!workflows) return c.json({ error: "Workflows unavailable" }, 503);
    try {
      const body = await c.req.json();
      return c.json(await workflows.importDocument(body), 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/workflow-templates/:id", async (c) => {
    if (!workflows) return c.json({ error: "Workflows unavailable" }, 503);
    try {
      return c.json(await workflows.addTemplate(c.req.param("id")), 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/workflows/:id", async (c) => {
    if (!workflows) return c.json({ error: "Workflows unavailable" }, 503);
    const item = await workflows.resolve(c.req.param("id"));
    if (!item) return c.json({ error: "Workflow not found" }, 404);
    return c.json({ ...item, nodeCount: item.document.nodes.length });
  });

  app.delete("/api/workflows/:id", async (c) => {
    if (!workflows) return c.json({ error: "Workflows unavailable" }, 503);
    const item = await workflows.resolve(c.req.param("id"));
    if (!item) return c.json({ error: "Workflow not found" }, 404);
    await workflows.remove(item.id);
    return c.json({ ok: true });
  });

  app.get("/api/workflows/:id/runs", async (c) => {
    if (!workflows) return c.json({ error: "Workflows unavailable" }, 503);
    const item = await workflows.resolve(c.req.param("id"));
    if (!item) return c.json({ error: "Workflow not found" }, 404);
    return c.json(await workflows.listRuns(item.id));
  });

  app.post("/api/workflows/:id/run", async (c) => {
    if (!workflows) return c.json({ error: "Workflows unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        sessionId?: string;
        input?: Record<string, unknown>;
      };
      if (!body.sessionId) return c.json({ error: "sessionId is required" }, 400);
      const input =
        body.input && typeof body.input === "object" && !Array.isArray(body.input)
          ? body.input
          : {};
      return c.json(await workflows.run(body.sessionId, c.req.param("id"), input));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/workflows/:id/resume", async (c) => {
    if (!workflows) return c.json({ error: "Workflows unavailable" }, 503);
    try {
      const body = (await c.req.json()) as {
        sessionId?: string;
        runId?: string;
        approved?: boolean;
        resumeToken?: string;
      };
      if (!body.sessionId || !body.runId) {
        return c.json({ error: "sessionId and runId are required" }, 400);
      }
      return c.json(
        await workflows.resume(body.sessionId, c.req.param("id"), body.runId, {
          approved: body.approved === true,
          ...(body.resumeToken ? { resumeToken: body.resumeToken } : {}),
        }),
      );
    } catch (err) {
      return errorJson(c, err);
    }
  });
}
