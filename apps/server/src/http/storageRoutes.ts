import type { Context, Hono } from "hono";
import { isLocalOperator } from "../core/localguard.js";
import type { JsonStore } from "../core/store.js";
import { StorageInventoryService } from "../core/storageInventory.js";
import { errorJson } from "./sessionJson.js";

export function registerStorageRoutes(
  app: Hono,
  store: JsonStore,
  peerAddress?: (c: Context) => string | undefined,
) {
  const storage = new StorageInventoryService(store);
  app.use("/api/storage/*", async (c, next) => {
    if (!isLocalOperator(c, peerAddress))
      return c.json({ error: "Storage management is desktop-only" }, 403);
    await next();
  });
  app.get("/api/storage/inventory", async (c) => {
    try {
      return c.json(await storage.inventory());
    } catch (err) {
      return errorJson(c, err);
    }
  });
  app.put("/api/storage/pin", async (c) => {
    try {
      const { id, pinned } = await c.req.json<{ id?: string; pinned?: boolean }>();
      if (typeof id !== "string" || typeof pinned !== "boolean")
        return c.json({ error: "Invalid pin" }, 400);
      await storage.pin(id, pinned);
      return c.json({ ok: true });
    } catch (err) {
      return errorJson(c, err);
    }
  });
  app.post("/api/storage/cleanup", async (c) => {
    try {
      const { ids } = await c.req.json<{ ids?: string[] }>();
      if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== "string")) {
        return c.json({ error: "Select up to 200 storage items" }, 400);
      }
      return c.json(await storage.cleanup(ids));
    } catch (err) {
      return errorJson(c, err);
    }
  });
}
