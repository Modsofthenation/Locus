import { relative, resolve } from "node:path";
import { rm } from "node:fs/promises";
import type { Hono } from "hono";
import { isGuestOs, type GuestOs } from "@locus/shared";
import { fetchCloudImage, fetchVirtioIso } from "../media/media.js";
import type { JsonStore } from "../core/store.js";
import { errorMessage } from "./sessionJson.js";

export function registerImageRoutes(app: Hono, store: JsonStore): void {
  app.get("/api/images", async (c) => c.json(await store.loadImages()));

  app.delete("/api/images/:id", async (c) => {
    const found = await store.deleteImage(c.req.param("id"));
    if (!found) return c.json({ error: "Not found" }, 404);
    const root = resolve(store.dataDir, "images");
    const target = resolve(found.path);
    const rel = relative(root, target);
    if (rel && !rel.startsWith("..") && !rel.includes("\\..")) {
      await rm(target, { force: true }).catch(() => undefined);
    }
    return c.json({ ok: true });
  });

  app.post("/api/media/fetch", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { os?: GuestOs; media?: string };
    try {
      if (body.media === "virtio") return c.json(await fetchVirtioIso(store.dataDir));
      if (!body.os || !isGuestOs(body.os)) return c.json({ error: "Unknown OS" }, 400);
      return c.json(await fetchCloudImage(store.dataDir, body.os));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });
}
