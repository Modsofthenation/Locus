import { riskGateRefusal } from "@locus/shared";
import { registerAndroidRoutes } from "./androidRoutes.js";
import { workerMergeGate } from "../session/riskGate.js";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { stream } from "hono/streaming";
import type { Hono } from "hono";
import type { CreateSessionInput, LocusConfig, PatchSessionInput } from "@locus/shared";
import {
  isLoopbackOrigin,
  sessionOffersAgentCanvas,
  slugAgentCanvasId,
  sessionListViews,
  clipNamedEnvName,
  namedEnvironmentById,
  sessionRuntime,
  sanitizePreviewPath,
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
import { VisualReview } from "../media/visualReview.js";
import { screenshotDest } from "../media/screenshots.js";
import { attachmentFilename } from "../media/share.js";
import type { ProjectService } from "../projects/projects.js";
import { servePreview, serveStaticPreview } from "../runtime/preview.js";
import type { SessionService } from "../session/sessions.js";
import { errorJson } from "./sessionJson.js";
import { SessionTraceLog } from "../session/traces.js";
import {
  isUnityAction,
  startUnityJob,
  unityJob,
  latestUnityJob,
  latestUnityWebglJob,
  unityScreenshot,
  unityWebglAsset,
  restoreUnityJobs,
} from "../unity/runner.js";
import {
  godotJob,
  godotWebAsset,
  isGodotAction,
  latestGodotJob,
  latestGodotWebJob,
  restoreGodotJobs,
  startGodotJob,
} from "../godot/runner.js";
import {
  isUnrealAction,
  latestUnrealJob,
  restoreUnrealJobs,
  startUnrealJob,
  unrealJob,
} from "../unreal/runner.js";
import {
  blenderExport,
  blenderImage,
  blenderJob,
  isBlenderAction,
  latestBlenderJob,
  restoreBlenderJobs,
  startBlenderJob,
} from "../blender/runner.js";

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
  registerAndroidRoutes(app, opts);
  app.get("/api/sessions", async (c) => c.json(sessionListViews(await opts.sessions.list())));

  // A loopback TCP connection can still originate from a malicious web page.
  // Accept the local app's browser origin, but reject arbitrary remote origins.
  const unityOriginAllowed = (c: import("hono").Context, allowOpaque = false): boolean => {
    const origin = c.req.header("origin");
    return !origin || isLoopbackOrigin(origin) || (allowOpaque && origin === "null");
  };

  // Unity Editor automation is restricted to the selected host workspace of a
  // Unity session. The client cannot supply arbitrary filesystem project roots.
  app.post("/api/sessions/:id/unity/jobs", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Unity Editor operations and assets are local-only" }, 403);
    if (!unityOriginAllowed(c)) return c.json({ error: "Origin not allowed" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      action?: unknown;
      scene?: string;
      target?: "linux" | "windows" | "macos" | "webgl";
    };
    if (!isUnityAction(body.action)) return c.json({ error: "Invalid Unity action" }, 400);
    try {
      const sessionId = c.req.param("id");
      const root = await opts.sessions.unityProjectRoot(sessionId);
      await restoreUnityJobs(root, sessionId);
      const job = await startUnityJob({
        sessionId,
        root,
        action: body.action,
        scene: body.scene,
        target: body.target,
      });
      return c.json(job, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/sessions/:id/unity/latest", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Unity Editor operations and assets are local-only" }, 403);
    if (!unityOriginAllowed(c)) return c.json({ error: "Origin not allowed" }, 403);
    try {
      const root = await opts.sessions.unityProjectRoot(c.req.param("id"));
      await restoreUnityJobs(root, c.req.param("id"));
      return c.json({
        job: latestUnityJob(c.req.param("id")) ?? null,
        preview: latestUnityWebglJob(c.req.param("id")) ?? null,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/sessions/:id/unity/jobs/:jobId", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Unity Editor operations and assets are local-only" }, 403);
    if (!unityOriginAllowed(c)) return c.json({ error: "Origin not allowed" }, 403);
    try {
      const root = await opts.sessions.unityProjectRoot(c.req.param("id"));
      await restoreUnityJobs(root, c.req.param("id"));
      const job = unityJob(c.req.param("jobId"), c.req.param("id"));
      return job ? c.json(job) : c.json({ error: "Unity job not found" }, 404);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/sessions/:id/unity/jobs/:jobId/screenshot", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Unity Editor operations and assets are local-only" }, 403);
    if (!unityOriginAllowed(c)) return c.json({ error: "Origin not allowed" }, 403);
    try {
      const root = await opts.sessions.unityProjectRoot(c.req.param("id"));
      await restoreUnityJobs(root, c.req.param("id"));
      const png = await unityScreenshot(c.req.param("jobId"), c.req.param("id"));
      return png
        ? c.body(Uint8Array.from(png), 200, {
            "content-type": "image/png",
            "cache-control": "no-store",
          })
        : c.json({ error: "Screenshot unavailable" }, 404);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Unity's generated WebGL player runs in a sandboxed iframe, with an opaque
  // origin and cross-origin-readable static assets. Do not enable same-origin.
  app.get("/api/sessions/:id/unity/jobs/:jobId/webgl/*", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Unity Editor operations and assets are local-only" }, 403);
    if (!unityOriginAllowed(c, true)) return c.json({ error: "Origin not allowed" }, 403);
    try {
      const sessionId = c.req.param("id");
      const root = await opts.sessions.unityProjectRoot(sessionId);
      await restoreUnityJobs(root, sessionId);
      const suffix = c.req.path.split("/webgl/").slice(1).join("/webgl/");
      const asset = await unityWebglAsset(
        c.req.param("jobId"),
        sessionId,
        decodeURIComponent(suffix),
      );
      if (!asset) return c.json({ error: "WebGL player asset unavailable" }, 404);
      const localOrigin = new URL(c.req.url).origin;
      const webglBase = `${localOrigin}/api/sessions/${encodeURIComponent(sessionId)}/unity/jobs/${encodeURIComponent(c.req.param("jobId"))}/webgl/`;
      // Sandboxed frames have an opaque origin. Permit their generated Unity
      // loader to fetch only this server's static WebGL build assets.
      // Stream large Unity .data/.wasm files with backpressure to avoid
      // buffering hundreds of megabytes per concurrent preview request.
      const headers: Record<string, string> = {
        "content-type": asset.mime,
        "cache-control": "no-store",
        "access-control-allow-origin": c.req.header("origin") ?? new URL(c.req.url).origin,
        vary: "Origin",
        "cross-origin-resource-policy": "cross-origin",
        "x-content-type-options": "nosniff",
        "content-security-policy": `default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; script-src ${webglBase} 'unsafe-inline' 'unsafe-eval' blob:; connect-src ${webglBase} data: blob:; worker-src ${webglBase} blob:; style-src ${webglBase} 'unsafe-inline'; img-src ${webglBase} data: blob:; font-src ${webglBase} data:; frame-ancestors ${localOrigin} http://localhost:* http://127.0.0.1:*`,
        "referrer-policy": "no-referrer",
      };
      for (const [key, value] of Object.entries(headers)) c.header(key, value);
      c.header("content-length", String(asset.size));
      return stream(c, async (writer) => {
        await writer.pipe(
          Readable.toWeb(createReadStream(asset.path)) as ReadableStream<Uint8Array>,
        );
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Blender jobs execute native local code. No user-provided absolute paths or remote callers.
  app.post("/api/sessions/:id/blender/jobs", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress) || !unityOriginAllowed(c))
      return c.json({ error: "Blender jobs are local-operator only" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      action?: unknown;
      file?: string;
      script?: string;
      format?: "glb" | "fbx" | "obj" | "stl";
    };
    if (!isBlenderAction(body.action)) return c.json({ error: "Invalid Blender action" }, 400);
    try {
      const sessionId = c.req.param("id");
      const root = await opts.sessions.blenderProjectRoot(sessionId);
      await restoreBlenderJobs(root, sessionId);
      return c.json(
        await startBlenderJob({
          root,
          sessionId,
          action: body.action,
          file: body.file,
          script: body.script,
          format: body.format,
        }),
        202,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/sessions/:id/blender/latest", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress) || !unityOriginAllowed(c))
      return c.json({ error: "Blender jobs are local-operator only" }, 403);
    try {
      const id = c.req.param("id");
      await restoreBlenderJobs(await opts.sessions.blenderProjectRoot(id), id);
      return c.json({ job: latestBlenderJob(id) ?? null });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/sessions/:id/blender/jobs/:jobId", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress) || !unityOriginAllowed(c))
      return c.json({ error: "Blender jobs are local-operator only" }, 403);
    try {
      const id = c.req.param("id");
      await restoreBlenderJobs(await opts.sessions.blenderProjectRoot(id), id);
      const job = blenderJob(c.req.param("jobId"), id);
      return job ? c.json(job) : c.json({ error: "Blender job not found" }, 404);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/sessions/:id/blender/jobs/:jobId/image", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress) || !unityOriginAllowed(c))
      return c.json({ error: "Blender image is local-operator only" }, 403);
    try {
      const id = c.req.param("id");
      await restoreBlenderJobs(await opts.sessions.blenderProjectRoot(id), id);
      const image = await blenderImage(c.req.param("jobId"), id);
      return image
        ? c.body(Uint8Array.from(image), 200, {
            "content-type": "image/png",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          })
        : c.json({ error: "Blender image not found" }, 404);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/sessions/:id/blender/jobs/:jobId/export", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress) || !unityOriginAllowed(c))
      return c.json({ error: "Blender export is local-operator only" }, 403);
    try {
      const id = c.req.param("id");
      await restoreBlenderJobs(await opts.sessions.blenderProjectRoot(id), id);
      const asset = await blenderExport(c.req.param("jobId"), id);
      if (!asset) return c.json({ error: "Blender export not found" }, 404);
      c.header("content-type", asset.mime);
      c.header("content-disposition", 'attachment; filename="' + asset.name + '"');
      c.header("cache-control", "no-store");
      c.header("x-content-type-options", "nosniff");
      c.header("content-length", String(asset.size));
      return stream(c, async (writer) => {
        await writer.pipe(
          Readable.toWeb(createReadStream(asset.file)) as ReadableStream<Uint8Array>,
        );
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Unreal builds, commandlets and project Python run native code on the Host.
  // Only the local operator may start them, and only against the session folder.
  app.post("/api/sessions/:id/unreal/jobs", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress) || !unityOriginAllowed(c))
      return c.json({ error: "Unreal Engine operations are local-operator only" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      action?: unknown;
      target?: "windows" | "linux" | "macos";
      filter?: string;
      script?: string;
    };
    if (!isUnrealAction(body.action)) return c.json({ error: "Invalid Unreal action" }, 400);
    try {
      const sessionId = c.req.param("id");
      const root = await opts.sessions.unrealProjectRoot(sessionId);
      await restoreUnrealJobs(root, sessionId);
      const job = await startUnrealJob({
        sessionId,
        root,
        action: body.action,
        ...(body.target ? { target: body.target } : {}),
        ...(typeof body.filter === "string" && body.filter.trim()
          ? { filter: body.filter.trim() }
          : {}),
        ...(typeof body.script === "string" ? { script: body.script } : {}),
      });
      return c.json(job, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/sessions/:id/unreal/latest", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress) || !unityOriginAllowed(c))
      return c.json({ error: "Unreal Engine operations are local-operator only" }, 403);
    try {
      const sessionId = c.req.param("id");
      await restoreUnrealJobs(await opts.sessions.unrealProjectRoot(sessionId), sessionId);
      return c.json({ job: latestUnrealJob(sessionId) ?? null });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/sessions/:id/unreal/jobs/:jobId", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress) || !unityOriginAllowed(c))
      return c.json({ error: "Unreal Engine operations are local-operator only" }, 403);
    try {
      const sessionId = c.req.param("id");
      await restoreUnrealJobs(await opts.sessions.unrealProjectRoot(sessionId), sessionId);
      const job = unrealJob(c.req.param("jobId"), sessionId);
      return job ? c.json(job) : c.json({ error: "Unreal job not found" }, 404);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Godot operations run native code and project plugins on the Host. Never
  // accept arbitrary project paths, remote callers or foreign browser origins.
  app.post("/api/sessions/:id/godot/jobs", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress) || !unityOriginAllowed(c))
      return c.json({ error: "Godot Editor is local-operator only" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      action?: unknown;
      scene?: string;
      target?: "web" | "linux" | "windows" | "macos";
    };
    if (!isGodotAction(body.action)) return c.json({ error: "Invalid Godot action" }, 400);
    try {
      const sessionId = c.req.param("id");
      const root = await opts.sessions.godotProjectRoot(sessionId);
      await restoreGodotJobs(root, sessionId);
      const job = await startGodotJob({
        sessionId,
        root,
        action: body.action,
        scene: body.scene,
        target: body.target,
      });
      return c.json(job, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/sessions/:id/godot/latest", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress) || !unityOriginAllowed(c))
      return c.json({ error: "Godot Editor is local-operator only" }, 403);
    try {
      const sessionId = c.req.param("id");
      await restoreGodotJobs(await opts.sessions.godotProjectRoot(sessionId), sessionId);
      return c.json({
        job: latestGodotJob(sessionId) ?? null,
        preview: latestGodotWebJob(sessionId) ?? null,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/sessions/:id/godot/jobs/:jobId", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress) || !unityOriginAllowed(c))
      return c.json({ error: "Godot Editor is local-operator only" }, 403);
    try {
      const sessionId = c.req.param("id");
      await restoreGodotJobs(await opts.sessions.godotProjectRoot(sessionId), sessionId);
      const job = godotJob(c.req.param("jobId"), sessionId);
      return job ? c.json(job) : c.json({ error: "Godot job not found" }, 404);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/sessions/:id/godot/jobs/:jobId/web/*", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress) || !unityOriginAllowed(c, true))
      return c.json({ error: "Godot preview is local-only" }, 403);
    try {
      const sessionId = c.req.param("id");
      await restoreGodotJobs(await opts.sessions.godotProjectRoot(sessionId), sessionId);
      const relative = c.req.path.split("/web/").slice(1).join("/web/");
      const asset = await godotWebAsset(
        c.req.param("jobId"),
        sessionId,
        decodeURIComponent(relative),
      );
      if (!asset) return c.json({ error: "Godot Web export not found" }, 404);
      const origin = new URL(c.req.url).origin;
      const base = `${origin}/api/sessions/${encodeURIComponent(sessionId)}/godot/jobs/${encodeURIComponent(c.req.param("jobId"))}/web/`;
      const headers: Record<string, string> = {
        "content-type": asset.mime,
        "cache-control": "no-store",
        "access-control-allow-origin": c.req.header("origin") ?? origin,
        vary: "Origin",
        "cross-origin-resource-policy": "cross-origin",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": `default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; script-src ${base} 'unsafe-inline' 'unsafe-eval' blob:; connect-src ${base} data: blob:; worker-src ${base} blob:; style-src ${base} 'unsafe-inline'; img-src ${base} data: blob:; font-src ${base} data:; frame-ancestors ${origin} http://localhost:* http://127.0.0.1:*`,
      };
      for (const [key, value] of Object.entries(headers)) c.header(key, value);
      c.header("content-length", String(asset.size));
      return stream(c, async (writer) => {
        await writer.pipe(
          Readable.toWeb(createReadStream(asset.file)) as ReadableStream<Uint8Array>,
        );
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/sessions", async (c) => {
    const input = (await c.req.json()) as CreateSessionInput;
    try {
      const session = await opts.sessions.create(input, { waitUntilStarted: false });
      return c.json(session, 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  /** One prompt → N agents (mixed providers / CLIs), each in its own worktree or container. */
  app.post("/api/sessions/fanout", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      create?: CreateSessionInput;
      agents?: unknown;
      prompt?: string;
    };
    if (!body.create || typeof body.create !== "object") {
      return c.json({ error: "create is required" }, 400);
    }
    try {
      const out = await opts.sessions.fanout({
        create: body.create,
        agents: body.agents,
        prompt: body.prompt ?? "",
      });
      return c.json(out, 201);
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

  const visualReview = new VisualReview(opts.store.dataDir);
  const visualPath = "/api/sessions/:id/visual-review";
  app.get(visualPath, async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Visual review is desktop-only" }, 403);
    if (!(await opts.sessions.get(c.req.param("id"))))
      return c.json({ error: "Session not found" }, 404);
    return c.json(await visualReview.list(c.req.param("id")));
  });
  app.get(`${visualPath}/:baseline/:image`, async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Visual review is desktop-only" }, 403);
    try {
      const image = await visualReview.image(
        c.req.param("id"),
        c.req.param("baseline"),
        c.req.param("image"),
      );
      return new Response(new Uint8Array(image), {
        headers: { "content-type": "image/png", "cache-control": "no-store" },
      });
    } catch {
      return c.json({ error: "Visual review image not found" }, 404);
    }
  });
  app.post(visualPath, async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Visual review is desktop-only" }, 403);
    const sessionId = c.req.param("id");
    try {
      const body = await c.req.json<{ name?: string; baselineId?: string; path?: string }>();
      const { active } = await opts.sessions.previewStatus(sessionId);
      if (!active) throw new Error("Start the session's web preview first");
      const target = await opts.sessions.previewTarget(sessionId, active.port);
      const bindPort = Number(
        process.env.PORT ?? (await opts.store.loadConfig()).advanced.bindPort ?? 7420,
      );
      if (target.kind === "http" && target.port === bindPort && target.host === "127.0.0.1") {
        throw new Error("Choose the web application's preview port");
      }
      const prefix = `/api/sessions/${encodeURIComponent(sessionId)}/preview-http/${active.port}`;
      const path = sanitizePreviewPath(body.path || active.path);
      return c.json(
        await visualReview.run(sessionId, { ...body, path }, (url, signal) => {
          const pathname = url.pathname.startsWith(prefix + "/")
            ? url.pathname.slice(prefix.length)
            : url.pathname;
          if (target.kind === "static")
            return serveStaticPreview(target.root, sanitizePreviewPath(pathname));
          if (target.kind === "http") {
            const upstream = new URL(`http://${target.host}:${target.port}`);
            upstream.pathname = pathname;
            upstream.search = url.search;
            return fetch(upstream, { redirect: "manual", signal });
          }
          const proxied = new URL(prefix + pathname + url.search, url.origin);
          return opts.sessions.proxyWorkerPreview(sessionId, String(active.port), {
            path: proxied.pathname,
            url: proxied.href,
            method: "GET",
            headers: new Headers(),
            arrayBuffer: async () => new ArrayBuffer(0),
          });
        }),
      );
    } catch (err) {
      return errorJson(c, err);
    }
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
      agents?: unknown;
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
    const body = (await c.req.json().catch(() => ({}))) as {
      workerId?: string;
      approveRisk?: boolean;
      requestApproval?: boolean;
    };
    try {
      if (!body.workerId?.trim()) return c.json({ error: "workerId is required" }, 400);
      const parentId = c.req.param("id");
      const workerId = body.workerId.trim();
      if (body.approveRisk !== true) {
        const worker = await opts.sessions.get(workerId);
        const [sessions, config] = await Promise.all([
          opts.store.loadSessions(),
          opts.store.loadConfig(),
        ]);
        const gate = worker ? workerMergeGate(worker, sessions, config) : undefined;
        if (gate?.gated) {
          if (body.requestApproval !== true) return c.json(riskGateRefusal(gate), 409);
          const { toolCallId } = await opts.sessions.requestOperatorApproval(
            workerId,
            {
              name: "worker_merge",
              arguments: { parentId, workerId, riskGate: gate.reason ?? "" },
            },
            async () => {
              const parent = await opts.sessions.mergeWorker(parentId, workerId);
              return { ok: true, output: `Merged into ${parent.title}` };
            },
          );
          return c.json(
            { pending: true, sessionId: workerId, toolCallId, ...riskGateRefusal(gate) },
            202,
          );
        }
      }
      return c.json(await opts.sessions.mergeWorker(parentId, workerId));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/worker-connection", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Worker recovery is desktop-only" }, 403);
    try {
      return c.json(await opts.sessions.workerConnection(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/worker-connection/resume", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Worker recovery is desktop-only" }, 403);
    try {
      return c.json(await opts.sessions.resumeWorkerCheckpoint(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workers/board", async (c) => {
    try {
      return c.json(await opts.sessions.workerBoard(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workers/verify", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Verification is desktop-only" }, 403);
    try {
      return c.json(await opts.sessions.verifyWorkers(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  /** Order the group's attempts best-first (model judge, or a heuristic when none is set up). */
  app.post("/api/sessions/:id/workers/rank", async (c) => {
    try {
      return c.json(await opts.sessions.rankWorkers(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  /** Stop one parallel agent and delete its worktree + branch. */
  app.post("/api/sessions/:id/workers/discard", async (c) => {
    try {
      await opts.sessions.discardWorker(c.req.param("id"));
      return c.json({ ok: true });
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
