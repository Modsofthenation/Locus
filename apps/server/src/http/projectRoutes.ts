import type { Hono } from "hono";
import {
  isAgentPlacement,
  isAgentRuntime,
  isProjectStarter,
  isSessionSurface,
  isSwarmNeedAction,
  type CreateProjectInput,
  type PatchProjectInput,
} from "@locus/shared";
import type { ProjectService } from "../projects/projects.js";
import { errorJson } from "./sessionJson.js";

export function registerProjectRoutes(app: Hono, projects: ProjectService | undefined): void {
  app.get("/api/projects", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    return c.json(await projects.list());
  });

  app.post("/api/projects", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as CreateProjectInput;
      const starter = isProjectStarter(body.starter) ? body.starter : undefined;
      const placement = isAgentPlacement(body.placement) ? body.placement : undefined;
      const runtime = isAgentRuntime(body.runtime) ? body.runtime : undefined;
      return c.json(
        await projects.create({
          title: typeof body.title === "string" ? body.title : undefined,
          teamName: typeof body.teamName === "string" ? body.teamName : undefined,
          starter,
          prompt: typeof body.prompt === "string" ? body.prompt : undefined,
          repoId: typeof body.repoId === "string" ? body.repoId : undefined,
          placement,
          backendId: typeof body.backendId === "string" ? body.backendId : undefined,
          runtime,
          maxUsd: typeof body.maxUsd === "number" ? body.maxUsd : undefined,
          maxConcurrentMembers:
            typeof body.maxConcurrentMembers === "number" ? body.maxConcurrentMembers : undefined,
          namedEnvId: typeof body.namedEnvId === "string" ? body.namedEnvId : undefined,
          surface: isSessionSurface(body.surface) ? body.surface : undefined,
          groupChat: body.groupChat === true,
          participantIds: Array.isArray(body.participantIds)
            ? body.participantIds.filter((id): id is string => typeof id === "string")
            : undefined,
        }),
        201,
      );
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/projects/keep-alive", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    return c.json({ keepAlive: await projects.keepsControlPlane() });
  });

  app.get("/api/projects/:id", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    const item = await projects.get(c.req.param("id"));
    if (!item) return c.json({ error: "Not found" }, 404);
    return c.json(item);
  });

  app.put("/api/projects/:id", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    try {
      const input = (await c.req.json()) as PatchProjectInput;
      return c.json(await projects.patch(c.req.param("id"), input));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.delete("/api/projects/:id", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    await projects.remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/projects/:id/duplicate", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    try {
      return c.json(await projects.duplicate(c.req.param("id")), 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/projects/:id/chat", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as { prompt?: string };
      const result = await projects.ensureChat(
        c.req.param("id"),
        typeof body.prompt === "string" ? body.prompt : undefined,
      );
      return c.json(result);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/projects/:id/context", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    try {
      return c.json(await projects.listContext(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/projects/:id/context/file", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    const path = c.req.query("path")?.trim();
    if (!path) return c.json({ error: "path is required" }, 400);
    try {
      const content = await projects.readContext(c.req.param("id"), path);
      return c.json({ path, content });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.put("/api/projects/:id/context/file", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        path?: unknown;
        content?: unknown;
      };
      const path = typeof body.path === "string" ? body.path : "";
      const content = typeof body.content === "string" ? body.content : "";
      if (!path) return c.json({ error: "path is required" }, 400);
      const saved = await projects.writeContextFile(c.req.param("id"), path, content);
      return c.json({ path: saved });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/projects/:id/mission-control", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    try {
      return c.json(await projects.missionControl(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/projects/:id/needs/:needId/action", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        action?: unknown;
        response?: unknown;
      };
      if (!isSwarmNeedAction(body.action))
        return c.json({ error: "Unknown Needs-you action" }, 400);
      return c.json(
        await projects.actOnNeed(
          c.req.param("id"),
          c.req.param("needId"),
          body.action,
          typeof body.response === "string" ? body.response : undefined,
        ),
      );
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/projects/:id/handoffs", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    try {
      return c.json(await projects.listHandoffs(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/projects/:id/members", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as { sessionId?: unknown };
      if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
        return c.json({ error: "sessionId is required" }, 400);
      }
      return c.json(await projects.enrollExistingMember(c.req.param("id"), body.sessionId.trim()));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/projects/:id/handoffs", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        targetTeamId?: unknown;
        targetMemberId?: unknown;
        task?: unknown;
      };
      if (typeof body.targetTeamId !== "string" || typeof body.task !== "string") {
        return c.json({ error: "targetTeamId and task are required" }, 400);
      }
      return c.json(
        await projects.handoffToTeam(c.req.param("id"), {
          targetTeamId: body.targetTeamId,
          targetMemberId: typeof body.targetMemberId === "string" ? body.targetMemberId : undefined,
          task: body.task,
        }),
        201,
      );
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/projects/:id/handoffs/:handoffId/action", async (c) => {
    if (!projects) return c.json({ error: "Projects unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        action?: unknown;
        response?: unknown;
      };
      const action = body.action;
      if (action !== "accept" && action !== "decline" && action !== "complete") {
        return c.json({ error: "Unknown team handoff action" }, 400);
      }
      return c.json(
        await projects.actOnHandoff(
          c.req.param("id"),
          c.req.param("handoffId"),
          action,
          typeof body.response === "string" ? body.response : undefined,
        ),
      );
    } catch (err) {
      return errorJson(c, err);
    }
  });
}
