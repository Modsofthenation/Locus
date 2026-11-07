import type { Hono } from "hono";
import {
  isBoardRunTarget,
  isBoardStarter,
  type CreateBoardInput,
  type PatchBoardInput,
} from "@locus/shared";
import type { BoardService } from "../boards/boards.js";
import { errorMessage } from "./sessionJson.js";

export function registerBoardRoutes(app: Hono, boards: BoardService | undefined): void {
  app.get("/api/boards", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    return c.json(await boards.list());
  });

  app.post("/api/boards", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as CreateBoardInput;
      const starter = isBoardStarter(body.starter) ? body.starter : undefined;
      return c.json(
        await boards.create({
          title: typeof body.title === "string" ? body.title : undefined,
          starter,
          prompt: typeof body.prompt === "string" ? body.prompt : undefined,
        }),
        201,
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/boards/:id", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    const item = await boards.get(c.req.param("id"));
    if (!item) return c.json({ error: "Not found" }, 404);
    return c.json(item);
  });

  app.put("/api/boards/:id", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    try {
      const input = (await c.req.json()) as PatchBoardInput;
      return c.json(await boards.patch(c.req.param("id"), input));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.delete("/api/boards/:id", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    await boards.remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/boards/:id/duplicate", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    try {
      return c.json(await boards.duplicate(c.req.param("id")), 201);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/boards/:id/objects", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    try {
      const body = (await c.req.json()) as { objects?: unknown[] };
      return c.json(await boards.upsertObjects(c.req.param("id"), body.objects ?? []));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.delete("/api/boards/:id/objects/:objectId", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    try {
      return c.json(await boards.deleteObjects(c.req.param("id"), [c.req.param("objectId")]));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/boards/:id/comments", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    try {
      const body = (await c.req.json()) as { objectId?: string; body?: string };
      return c.json(
        await boards.addComment(c.req.param("id"), {
          objectId: body.objectId ?? "",
          body: body.body ?? "",
          author: "operator",
        }),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/boards/:id/comments/:commentId/resolve", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    try {
      return c.json(await boards.resolveComment(c.req.param("id"), c.req.param("commentId")));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/boards/:id/chat", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as { prompt?: string };
      const result = await boards.ensureChat(
        c.req.param("id"),
        typeof body.prompt === "string" ? body.prompt : undefined,
      );
      return c.json(result);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/boards/:id/run-frame", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    try {
      const body = (await c.req.json()) as { frameId?: string; target?: string };
      const target = isBoardRunTarget(body.target) ? body.target : undefined;
      if (!body.frameId?.trim() || !target) {
        return c.json({ error: "frameId and target are required" }, 400);
      }
      return c.json(await boards.runFrame(c.req.param("id"), { frameId: body.frameId, target }));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/boards/:id/pin-plan", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    try {
      const body = (await c.req.json()) as { frameId?: string; sessionId?: string };
      if (!body.frameId?.trim() || !body.sessionId?.trim()) {
        return c.json({ error: "frameId and sessionId are required" }, 400);
      }
      return c.json(
        await boards.pinPlan(c.req.param("id"), {
          frameId: body.frameId,
          sessionId: body.sessionId,
        }),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/boards/:id/export", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    const item = await boards.get(c.req.param("id"));
    if (!item) return c.json({ error: "Not found" }, 404);
    return c.json(item);
  });

  app.post("/api/boards/:id/assets", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return c.json({ error: "file is required" }, 400);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return c.json(
        await boards.putAsset(c.req.param("id"), {
          bytes,
          mime: file.type,
          name: file.name,
        }),
        201,
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/boards/:id/assets/:assetId", async (c) => {
    if (!boards) return c.json({ error: "Boards unavailable" }, 503);
    try {
      const asset = await boards.getAsset(c.req.param("id"), c.req.param("assetId"));
      return c.body(Uint8Array.from(asset.bytes), 200, { "content-type": asset.mime });
    } catch (err) {
      const missing = err instanceof Error && err.message === "Not found";
      return c.json({ error: errorMessage(err) }, missing ? 404 : 400);
    }
  });
}
