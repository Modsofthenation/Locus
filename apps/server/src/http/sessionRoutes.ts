import { readFile, stat } from "node:fs/promises";
import type { Hono } from "hono";
import type { CreateSessionInput, LocusConfig, PatchSessionInput } from "@locus/shared";
import {
  sessionOffersAgentCanvas,
  slugAgentCanvasId,
  sessionListViews,
  clipNamedEnvName,
  namedEnvironmentById,
  sessionRuntime,
  snapshotNamedEnvironment,
  upsertNamedEnvironment,
  exportApprovals,
  summarizeSessionEgress,
} from "@locus/shared";
import { isLocalOperator } from "../core/localguard.js";
import { redactConfig, redactVm } from "../core/redact.js";
import type { JsonStore } from "../core/store.js";
import type { RepoService } from "../git/repos.js";
import { parseIncomingAttachments } from "../media/attachments.js";
import { artifactContentType, artifactDest } from "../media/artifacts.js";
import { recordingDest } from "../media/recordings.js";
import { screenshotDest } from "../media/screenshots.js";
import { attachmentFilename } from "../media/share.js";
import type { ProjectService } from "../projects/projects.js";
import { servePreview } from "../runtime/preview.js";
import type { SessionService } from "../session/sessions.js";
import { errorJson } from "./sessionJson.js";
import { SessionTraceLog } from "../session/traces.js";

export function registerSessionRoutes(
  app: Hono,
  opts: {
    sessions: SessionService;
    store: JsonStore;
    projects?: ProjectService;
    repos?: RepoService;
    onConfigSaved?: (config: LocusConfig) => Promise<unknown>;
    peerAddress?: (c: import("hono").Context) => string | undefined;
  },
): void {
  app.get("/api/sessions", async (c) => c.json(sessionListViews(await opts.sessions.list())));

  app.post("/api/sessions", async (c) => {
    const input = (await c.req.json()) as CreateSessionInput;
    try {
      const session = await opts.sessions.create(input, { waitUntilStarted: false });
      return c.json(session, 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/agent-canvases", async (c) => {
    const session = await opts.sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    if (!sessionOffersAgentCanvas(session)) {
      return c.json({ error: "This chat does not build canvases" }, 400);
    }
    return c.json({ canvases: session.agentCanvases ?? [] });
  });

  app.get("/api/sessions/:id/agent-canvases/:canvasId", async (c) => {
    const session = await opts.sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    if (!sessionOffersAgentCanvas(session)) {
      return c.json({ error: "This chat does not build canvases" }, 400);
    }
    const id = slugAgentCanvasId(c.req.param("canvasId") ?? "");
    const ref = (session.agentCanvases ?? []).find((row) => row.id === id);
    if (!ref) return c.json({ error: "Canvas not found" }, 404);
    const html = await opts.sessions.agentCanvases.readHtml(session.id, id);
    if (!html) return c.json({ error: "Canvas not found" }, 404);
    return c.json({ ...ref, html });
  });

  app.get("/api/sessions/:id", async (c) => {
    const session = await opts.sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  });

  app.get("/api/sessions/:id/preview", async (c) => {
    try {
      return c.json(await opts.sessions.previewStatus(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  const proxyPreview = async (c: import("hono").Context) => {
    const id = c.req.param("id") ?? "";
    const port = Number(c.req.param("port"));
    try {
      const target = await opts.sessions.previewTarget(id, port);
      if (target.kind === "worker") {
        return await opts.sessions.proxyWorkerPreview(id, c.req.param("port") ?? String(port), {
          path: c.req.path,
          url: c.req.url,
          method: c.req.method,
          headers: c.req.raw.headers,
          arrayBuffer: () => c.req.arrayBuffer(),
        });
      }
      return await servePreview(c, target, String(c.req.param("port") ?? port));
    } catch (err) {
      return errorJson(c, err);
    }
  };
  app.all("/api/sessions/:id/preview-http/:port", proxyPreview);
  app.all("/api/sessions/:id/preview-http/:port/*", proxyPreview);

  app.get("/api/sessions/:id/ide", async (c) => {
    try {
      return c.json(await opts.sessions.ideUrl(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.patch("/api/sessions/:id", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as PatchSessionInput;
    try {
      return c.json(await opts.sessions.patchMeta(c.req.param("id"), body));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.delete("/api/sessions/:id", async (c) => {
    await opts.sessions.remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/sessions/:id/chat", async (c) => {
    const body = (await c.req.json()) as {
      content?: string;
      plan?: boolean;
      skill?: string;
      steer?: boolean;
      attachments?: unknown;
      focusPath?: string;
      notifySessionId?: string;
      assetRefs?: unknown;
    };
    let attachments;
    try {
      attachments = parseIncomingAttachments(body.attachments);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Invalid attachments" }, 400);
    }
    if (!body.content?.trim() && !attachments.length)
      return c.json({ error: "Empty message" }, 400);
    try {
      const chatOpts = {
        plan: Boolean(body.plan),
        skill: typeof body.skill === "string" ? body.skill : undefined,
        steer: Boolean(body.steer),
        attachments: attachments.length ? attachments : undefined,
        focusPath: typeof body.focusPath === "string" ? body.focusPath : undefined,
        notifySessionId:
          typeof body.notifySessionId === "string" ? body.notifySessionId : undefined,
        assetRefs: Array.isArray(body.assetRefs)
          ? body.assetRefs.filter(
              (id): id is string => typeof id === "string" && Boolean(id.trim()),
            )
          : undefined,
      };
      const groupHandled = await opts.projects?.sendGroupMessage(
        c.req.param("id"),
        body.content ?? "",
        chatOpts,
      );
      if (!groupHandled) {
        await opts.sessions.sendChat(c.req.param("id"), body.content ?? "", chatOpts);
      }
      return c.json({ ok: true });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/chat/abort", async (c) => {
    await opts.sessions.abortChat(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/sessions/:id/queue/:itemId/send", async (c) => {
    try {
      return c.json(await opts.sessions.sendQueuedNow(c.req.param("id"), c.req.param("itemId")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/audit/egress", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress)) {
      return c.json({ error: "Audit exports are desktop-only" }, 403);
    }
    const session = await opts.sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    const events = await new SessionTraceLog(opts.store.dataDir).read(session.id);
    return c.json(summarizeSessionEgress(events, session.id));
  });

  app.get("/api/sessions/:id/audit/approvals", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress)) {
      return c.json({ error: "Audit exports are desktop-only" }, 403);
    }
    const session = await opts.sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    const events = await new SessionTraceLog(opts.store.dataDir).read(session.id);
    return c.json({ approvals: exportApprovals(events, session.id) });
  });

  app.get("/api/audit/approvals", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress)) {
      return c.json({ error: "Audit exports are desktop-only" }, 403);
    }
    const events = await new SessionTraceLog(opts.store.dataDir).readAll();
    return c.json({ approvals: exportApprovals(events) });
  });

  app.post("/api/sessions/:id/approvals", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      toolCallId?: string;
      decision?: string;
      answer?: string;
      persist?: boolean;
    };
    const decision =
      body.decision === "approved" || body.decision === "denied" ? body.decision : undefined;
    if (!body.toolCallId?.trim() || !decision) {
      return c.json({ error: "toolCallId and decision (approved|denied) are required" }, 400);
    }
    try {
      return c.json(
        await opts.sessions.resolveApproval(
          c.req.param("id"),
          body.toolCallId.trim(),
          decision,
          typeof body.answer === "string" ? body.answer : undefined,
          body.persist === true,
        ),
      );
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/rewind", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { checkpointId?: string };
    try {
      return c.json(
        await opts.sessions.rewind(c.req.param("id"), body.checkpointId?.trim() || undefined),
      );
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/clear", async (c) => {
    try {
      return c.json(await opts.sessions.clearChat(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/checkpoints/:checkpointId/diff", async (c) => {
    try {
      const diff = await opts.sessions.checkpointDiff(
        c.req.param("id"),
        c.req.param("checkpointId"),
      );
      return c.json({ diff });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/memories", async (c) => {
    try {
      return c.json({ memories: await opts.sessions.workspaceMemories(c.req.param("id")) });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/memories", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return c.json(await opts.sessions.rememberFacts(c.req.param("id"), body));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/takeover", async (c) => {
    try {
      return c.json(await opts.sessions.takeover(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/handback", async (c) => {
    try {
      return c.json(await opts.sessions.handback(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/browser/takeover", async (c) => {
    try {
      return c.json(await opts.sessions.takeoverBrowser(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/browser/handback", async (c) => {
    try {
      return c.json(await opts.sessions.handbackBrowser(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/fork", async (c) => {
    try {
      return c.json(await opts.sessions.fork(c.req.param("id")), 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workers", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      count?: unknown;
      prompt?: string;
      models?: unknown;
    };
    try {
      return c.json(await opts.sessions.spawnWorkers(c.req.param("id"), body), 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workers/diff", async (c) => {
    try {
      return c.json(await opts.sessions.workerDiffs(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workers/merge", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { workerId?: string };
    try {
      if (!body.workerId?.trim()) return c.json({ error: "workerId is required" }, 400);
      return c.json(await opts.sessions.mergeWorker(c.req.param("id"), body.workerId.trim()));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/undo-file", async (c) => {
    try {
      return c.json(await opts.sessions.undoFile(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/roles", async (c) => {
    try {
      return c.json(await opts.sessions.cycleRole(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/skills", async (c) => {
    try {
      return c.json(await opts.sessions.listSkills(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/promote-docker", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { runtime?: string };
      const runtime = body.runtime === "host" ? "host" : "docker";
      return c.json(await opts.sessions.promoteIdeToDocker(c.req.param("id"), runtime), 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/images", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    try {
      const image = await opts.sessions.captureImage(c.req.param("id"), body.name ?? "");
      return c.json(image, 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/save-environment", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    try {
      const session = await opts.sessions.get(c.req.param("id"));
      if (!session) return c.json({ error: "Not found" }, 404);
      const name = body.name?.trim() || clipNamedEnvName(`${session.title} env`);
      const image = await opts.sessions.captureImage(session.id, name);
      const config = await opts.store.loadConfig();
      const linked =
        session.repoId && opts.repos ? await opts.repos.get(session.repoId) : undefined;
      const existing =
        namedEnvironmentById(config.namedEnvironments, linked?.namedEnvironmentId) ??
        (config.namedEnvironments ?? []).find(
          (row) => row.name.toLowerCase() === name.toLowerCase(),
        );
      const env = snapshotNamedEnvironment({
        id: existing?.id ?? crypto.randomUUID(),
        name,
        existing,
        runtime: sessionRuntime(session),
        os: session.os,
        templateId: session.templateId,
        dockerImage: session.dockerImage,
        imageId: image.id,
        network: session.network,
        recipeId: null,
        maxUsd: session.maxUsd,
        placement: session.placement,
        backendId: session.backendId,
        allowHosts: session.allowHosts,
      });
      if (!env) return c.json({ error: "Could not snapshot this environment" }, 400);
      const nextConfig = {
        ...config,
        namedEnvironments: upsertNamedEnvironment(config.namedEnvironments ?? [], env),
      };
      await opts.store.saveConfig(nextConfig);
      if (opts.onConfigSaved) await opts.onConfigSaved(nextConfig);
      const repo =
        session.repoId && opts.repos
          ? await opts.repos.patch(session.repoId, { namedEnvironmentId: env.id })
          : linked;
      return c.json({ image, environment: env, config: redactConfig(nextConfig), repo }, 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/vm/start", async (c) => {
    try {
      const vm = await opts.sessions.startVm(c.req.param("id"));
      return c.json(redactVm(vm));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/vm/stop", async (c) => {
    await opts.sessions.stopVm(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/sessions/:id/vm/pause", async (c) => {
    try {
      const vm = await opts.sessions.pauseVm(c.req.param("id"));
      return c.json(redactVm(vm));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/vm/resume", async (c) => {
    try {
      const vm = await opts.sessions.resumeVm(c.req.param("id"));
      return c.json(redactVm(vm));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/vm/logs", async (c) => {
    try {
      return c.json({ text: await opts.sessions.vmLogs(c.req.param("id")) });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/tools", async (c) => {
    const req = (await c.req.json()) as { name: string; args?: Record<string, unknown> };
    try {
      const result = await opts.sessions.executeTool(c.req.param("id"), {
        name: req.name as import("@locus/shared").ComputerUseToolName,
        args: req.args ?? {},
      });
      return c.json(result);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/screenshots/:name", async (c) => {
    const session = await opts.sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    try {
      const dest = screenshotDest(opts.store.dataDir, session.id, c.req.param("name"));
      await stat(dest);
      const data = await readFile(dest);
      return c.body(data, 200, {
        "content-type": "image/png",
        "content-disposition": `inline; filename="${attachmentFilename(dest)}"`,
      });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/recordings/:name", async (c) => {
    const session = await opts.sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    try {
      const dest = recordingDest(opts.store.dataDir, session.id, c.req.param("name"));
      await stat(dest);
      const data = await readFile(dest);
      return c.body(data, 200, {
        "content-type": "video/mp4",
        "content-disposition": `inline; filename="${attachmentFilename(dest)}"`,
      });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/artifacts/:name", async (c) => {
    const session = await opts.sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    const kind = c.req.query("kind");
    const guessed =
      kind === "pdf" || kind === "trace" || kind === "download"
        ? kind
        : c.req.param("name").toLowerCase().endsWith(".pdf")
          ? "pdf"
          : c.req.param("name").toLowerCase().endsWith(".json")
            ? "trace"
            : "download";
    try {
      const dest = artifactDest(opts.store.dataDir, session.id, c.req.param("name"), guessed);
      await stat(dest);
      const data = await readFile(dest);
      return c.body(data, 200, {
        "content-type": artifactContentType(dest),
        "content-disposition": `inline; filename="${attachmentFilename(dest)}"`,
      });
    } catch (err) {
      return errorJson(c, err);
    }
  });
}
