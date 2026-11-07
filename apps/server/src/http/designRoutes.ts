import type { Hono } from "hono";
import {
  MAX_DESIGN_IMPORT_BYTES,
  MAX_DESIGN_IMPORT_JSON_BYTES,
  CANVAS_FRAME_CSP,
  canvasFrameHtml,
  formatDesignImportBytes,
  resolveDesignSystem,
  resolveAssetStyle,
  resolveGameStyle,
  sanitizePreviewPath,
  isAssetExportFormat,
  parseAssetRefIds,
} from "@locus/shared";
import {
  addDesignSystem,
  importDesignSystem,
  listDesignSystemCatalog,
  removeDesignSystem,
  updateDesignSystem,
} from "../design/designSystems.js";
import {
  addAssetStyle,
  importAssetStyle,
  listAssetStyleCatalog,
  removeAssetStyle,
  updateAssetStyle,
} from "../design/assetStyles.js";
import {
  addGameStyle,
  importGameStyle,
  listGameStyleCatalog,
  removeGameStyle,
  updateGameStyle,
} from "../design/gameStyles.js";
import type { JsonStore } from "../core/store.js";
import type { DesignCanvas } from "../design/designCanvas.js";
import { errorJson } from "./sessionJson.js";

function looksLikeZip(_filename: string, _type: string, buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
}

export function registerDesignRoutes(app: Hono, design: DesignCanvas, store: JsonStore): void {
  app.get("/api/canvas-frame", (c) =>
    c.html(canvasFrameHtml(), 200, {
      "content-security-policy": CANVAS_FRAME_CSP,
      "cache-control": "no-store",
    }),
  );

  app.get("/api/design-systems", async (c) => {
    const [systems, config] = await Promise.all([store.loadDesignSystems(), store.loadConfig()]);
    return c.json({ ...listDesignSystemCatalog(systems), defaultId: config.defaultDesignSystemId });
  });

  app.post("/api/design-systems", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const system = await addDesignSystem(store, body);
      return c.json(system, 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/design-systems/import", async (c) => {
    try {
      const contentType = c.req.header("content-type") ?? "";
      const length = Number(c.req.header("content-length") ?? 0);
      if (contentType.includes("multipart/form-data")) {
        if (Number.isFinite(length) && length > MAX_DESIGN_IMPORT_BYTES + 1024 * 1024) {
          return c.json(
            {
              error: `Zip is too large (${formatDesignImportBytes(length)}; max ${formatDesignImportBytes(MAX_DESIGN_IMPORT_BYTES)}). Remove source uploads or nested archives and try again.`,
            },
            400,
          );
        }
        const form = await c.req.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File)) return c.json({ error: "file is required" }, 400);
        const filenameField = form?.get("filename");
        const filename =
          (typeof filenameField === "string" && filenameField.trim()) || file.name || "";
        const buf = Buffer.from(await file.arrayBuffer());
        if (buf.length > MAX_DESIGN_IMPORT_BYTES) {
          return c.json(
            {
              error: `Zip is too large (${formatDesignImportBytes(buf.length)}; max ${formatDesignImportBytes(MAX_DESIGN_IMPORT_BYTES)}). Remove source uploads or nested archives and try again.`,
            },
            400,
          );
        }
        const zip = looksLikeZip(filename, file.type, buf);
        const system = await importDesignSystem(store, {
          filename,
          zipBytes: zip ? buf : undefined,
          text: zip ? undefined : buf.toString("utf8"),
        });
        return c.json(system, 201);
      }
      const raw = await c.req.text().catch(() => "");
      if (raw.length > MAX_DESIGN_IMPORT_JSON_BYTES) {
        return c.json(
          {
            error: "Import is too large. Upload the .zip as a file instead of encoding it as JSON.",
          },
          400,
        );
      }
      let body: { text?: string; filename?: string; zipBase64?: string } = {};
      try {
        body = JSON.parse(raw) as { text?: string; filename?: string; zipBase64?: string };
      } catch {
        body = {};
      }
      if (
        (typeof body.text === "string" && body.text.length > MAX_DESIGN_IMPORT_JSON_BYTES) ||
        (typeof body.zipBase64 === "string" && body.zipBase64.length > MAX_DESIGN_IMPORT_JSON_BYTES)
      ) {
        return c.json(
          {
            error: "Import is too large. Upload the .zip as a file instead of encoding it as JSON.",
          },
          400,
        );
      }
      const system = await importDesignSystem(store, {
        text: typeof body.text === "string" ? body.text : undefined,
        filename: typeof body.filename === "string" ? body.filename : undefined,
        zipBase64: typeof body.zipBase64 === "string" ? body.zipBase64 : undefined,
        body,
      });
      return c.json(system, 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.patch("/api/design-systems/:id", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      return c.json(await updateDesignSystem(store, c.req.param("id"), body));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.delete("/api/design-systems/:id", async (c) => {
    try {
      await removeDesignSystem(store, c.req.param("id"));
      const [systems, config] = await Promise.all([store.loadDesignSystems(), store.loadConfig()]);
      return c.json({
        ok: true,
        ...listDesignSystemCatalog(systems),
        defaultId: config.defaultDesignSystemId,
      });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/design-systems/:id/default", async (c) => {
    const id = c.req.param("id");
    const config = await store.loadConfig();
    const stored = await store.loadDesignSystems();
    if (id !== "none" && !resolveDesignSystem(id, stored)) {
      return c.json({ error: "Design system not found" }, 404);
    }
    config.defaultDesignSystemId = id === "none" ? undefined : id;
    await store.saveConfig(config);
    return c.json({ ...listDesignSystemCatalog(stored), defaultId: config.defaultDesignSystemId });
  });

  app.get("/api/asset-styles", async (c) => {
    const [styles, config] = await Promise.all([store.loadAssetStyles(), store.loadConfig()]);
    return c.json({ ...listAssetStyleCatalog(styles), defaultId: config.defaultAssetStyleId });
  });

  app.post("/api/asset-styles", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const style = await addAssetStyle(store, body);
      return c.json(style, 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/asset-styles/import", async (c) => {
    try {
      const raw = await c.req.text().catch(() => "");
      if (raw.length > MAX_DESIGN_IMPORT_JSON_BYTES) {
        return c.json(
          {
            error: "Import is too large. Upload a smaller JSON file.",
          },
          400,
        );
      }
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = {};
      }
      if (typeof body.text === "string" && body.text.length > MAX_DESIGN_IMPORT_JSON_BYTES) {
        return c.json({ error: "Import is too large. Upload a smaller JSON file." }, 400);
      }
      const style = await importAssetStyle(store, {
        text: typeof body.text === "string" ? body.text : undefined,
        filename: typeof body.filename === "string" ? body.filename : undefined,
        body,
      });
      return c.json(style, 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.patch("/api/asset-styles/:id", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      return c.json(await updateAssetStyle(store, c.req.param("id"), body));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.delete("/api/asset-styles/:id", async (c) => {
    try {
      await removeAssetStyle(store, c.req.param("id"));
      const [styles, config] = await Promise.all([store.loadAssetStyles(), store.loadConfig()]);
      return c.json({
        ok: true,
        ...listAssetStyleCatalog(styles),
        defaultId: config.defaultAssetStyleId,
      });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/asset-styles/:id/default", async (c) => {
    const id = c.req.param("id");
    const config = await store.loadConfig();
    const stored = await store.loadAssetStyles();
    if (id !== "none" && !resolveAssetStyle(id, stored)) {
      return c.json({ error: "Asset style not found" }, 404);
    }
    config.defaultAssetStyleId = id === "none" ? undefined : id;
    await store.saveConfig(config);
    return c.json({ ...listAssetStyleCatalog(stored), defaultId: config.defaultAssetStyleId });
  });

  app.get("/api/game-styles", async (c) => {
    const [styles, config] = await Promise.all([store.loadGameStyles(), store.loadConfig()]);
    return c.json({ ...listGameStyleCatalog(styles), defaultId: config.defaultGameStyleId });
  });

  app.post("/api/game-styles", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const style = await addGameStyle(store, body);
      return c.json(style, 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/game-styles/import", async (c) => {
    try {
      const raw = await c.req.text().catch(() => "");
      if (raw.length > MAX_DESIGN_IMPORT_JSON_BYTES) {
        return c.json({ error: "Import is too large. Upload a smaller JSON file." }, 400);
      }
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = {};
      }
      const style = await importGameStyle(store, {
        text: typeof body.text === "string" ? body.text : undefined,
        filename: typeof body.filename === "string" ? body.filename : undefined,
        body,
      });
      return c.json(style, 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.patch("/api/game-styles/:id", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      return c.json(await updateGameStyle(store, c.req.param("id"), body));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.delete("/api/game-styles/:id", async (c) => {
    try {
      await removeGameStyle(store, c.req.param("id"));
      const [styles, config] = await Promise.all([store.loadGameStyles(), store.loadConfig()]);
      return c.json({
        ok: true,
        ...listGameStyleCatalog(styles),
        defaultId: config.defaultGameStyleId,
      });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/game-styles/:id/default", async (c) => {
    const id = c.req.param("id");
    const config = await store.loadConfig();
    const stored = await store.loadGameStyles();
    if (id !== "none" && !resolveGameStyle(id, stored)) {
      return c.json({ error: "Game style not found" }, 404);
    }
    config.defaultGameStyleId = id === "none" ? undefined : id;
    await store.saveConfig(config);
    return c.json({ ...listGameStyleCatalog(stored), defaultId: config.defaultGameStyleId });
  });

  app.post("/api/sessions/:id/game-style", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        name?: string;
        summary?: string;
        guidelines?: string;
      };
      const style = await design.saveGameStyleFromSession(c.req.param("id"), body);
      return c.json(style, 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/play-link", async (c) => {
    try {
      return c.json(await design.playLink(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/game/split", async (c) => {
    try {
      return c.json(await design.splitLiveGame(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/generate-asset", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown };
    try {
      return c.json(await design.generateGameAsset(c.req.param("id"), body.kind), 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/play/:token/booth", async (c) => {
    const token = c.req.param("token") ?? "";
    const sessionId = await design.sessionIdForPlayToken(token);
    if (!sessionId) return c.json({ error: "Play link not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    try {
      const note = await design.appendPlayBooth(sessionId, body);
      const scores = await design.playScores(token);
      return c.json({ ok: true, note, scores: scores.scores });
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/play/:token/scores", async (c) => {
    const token = c.req.param("token") ?? "";
    try {
      return c.json(await design.playScores(token));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  const servePlay = async (c: import("hono").Context) => {
    const token = c.req.param("token") ?? "";
    const sessionId = await design.sessionIdForPlayToken(token);
    if (!sessionId) return c.json({ error: "Play link not found" }, 404);
    const prefix = `/play/${encodeURIComponent(token)}`;
    const raw = c.req.path;
    const idx = raw.indexOf(prefix);
    const rest = idx >= 0 ? raw.slice(idx + prefix.length) : "";
    return design.serveCanvasFile(sessionId, sanitizePreviewPath(rest || "/"), `${prefix}/`, {
      playToken: token,
    });
  };
  app.all("/play/:token", servePlay);
  app.all("/play/:token/*", servePlay);

  app.post("/api/sessions/:id/asset-style", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        name?: string;
        summary?: string;
        guidelines?: string;
      };
      const style = await design.saveAssetStyleFromSession(c.req.param("id"), body);
      return c.json(style, 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/canvas", async (c) => {
    try {
      return c.json(await design.readCanvas(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  const serveCanvasFiles = async (c: import("hono").Context) => {
    const id = c.req.param("id") ?? "";
    try {
      await design.readCanvas(id);
    } catch (err) {
      return errorJson(c, err);
    }
    const prefix = `/api/sessions/${encodeURIComponent(id)}/canvas-files`;
    const raw = c.req.path;
    const idx = raw.indexOf("/canvas-files");
    const rest = idx >= 0 ? raw.slice(idx + "/canvas-files".length) : "";
    const url = new URL(c.req.url);
    const pick = url.searchParams.get("locus_pick") === "1";
    const edit = url.searchParams.get("locus_edit") === "1";
    const seqRaw = url.searchParams.get("c");
    const seq = seqRaw != null && seqRaw !== "" ? Number(seqRaw) : undefined;
    return design.serveCanvasFile(id, sanitizePreviewPath(rest || "/"), `${prefix}/`, {
      pick,
      edit,
      seq: seq != null && Number.isFinite(seq) ? seq : undefined,
    });
  };
  app.all("/api/sessions/:id/canvas-files", serveCanvasFiles);
  app.all("/api/sessions/:id/canvas-files/*", serveCanvasFiles);

  app.post("/api/sessions/:id/design-comment", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(await design.addDesignComment(c.req.param("id"), body));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/design/edit", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { selector?: string; text?: string };
    try {
      return c.json(await design.editCanvasText(c.req.param("id"), body));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/design/explore", async (c) => {
    try {
      return c.json(await design.exploreDesignDirections(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/design/variants", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      id?: string;
      keepActive?: boolean;
    };
    try {
      return c.json(
        await design.createDesignVariant(c.req.param("id"), body.name, {
          id: body.id,
          keepActive: body.keepActive,
        }),
        201,
      );
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/design/variants/:vid/activate", async (c) => {
    try {
      return c.json(await design.activateDesignVariant(c.req.param("id"), c.req.param("vid")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.patch("/api/sessions/:id/design/variants/:vid", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    try {
      return c.json(
        await design.renameDesignVariant(c.req.param("id"), c.req.param("vid"), body.name ?? ""),
      );
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.delete("/api/sessions/:id/design/variants/:vid", async (c) => {
    try {
      return c.json(await design.deleteDesignVariant(c.req.param("id"), c.req.param("vid")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/asset-pack", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      format?: unknown;
      mime?: unknown;
      filename?: unknown;
      contentBase64?: unknown;
    };
    const format = typeof body.format === "string" ? body.format : "";
    const contentBase64 = typeof body.contentBase64 === "string" ? body.contentBase64 : "";
    try {
      if (!contentBase64.trim()) {
        const pack = await design.buildAssetPack(c.req.param("id"));
        if (!pack) return c.json({ error: "Could not build asset pack" }, 400);
        return c.json(pack);
      }
      if (!isAssetExportFormat(format)) {
        return c.json({ error: "format is required" }, 400);
      }
      return c.json(
        await design.ingestAssetExport(c.req.param("id"), {
          format,
          mime: typeof body.mime === "string" ? body.mime : undefined,
          filename: typeof body.filename === "string" ? body.filename : undefined,
          contentBase64,
        }),
      );
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/linked-assets", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { assetIds?: unknown };
    const ids = parseAssetRefIds(body.assetIds);
    if (!ids.length) return c.json({ error: "assetIds is required" }, 400);
    try {
      return c.json(
        await design.linkAssetPacks(
          c.req.param("id"),
          ids.map((sessionId) => ({ sessionId })),
        ),
      );
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/game-export", async (c) => {
    try {
      return c.json(await design.exportGameZip(c.req.param("id")));
    } catch (err) {
      return errorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/promote", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { scaffold?: unknown };
    try {
      return c.json(await design.promote(c.req.param("id"), body), 201);
    } catch (err) {
      return errorJson(c, err);
    }
  });
}
