import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Hono } from "hono";
import { guestSharePath, isWindows } from "@locus/shared";
import { attachmentFilename, listShareFiles, shareDest } from "../media/share.js";
import { pullWindowsShareToHost, pushShareFileToWindows } from "../media/winshare.js";
import type { JsonStore } from "../core/store.js";
import type { SessionService } from "../session/sessions.js";
import type { Hypervisor } from "@locus/hypervisor";
import { errorMessage } from "./sessionJson.js";

export function registerShareRoutes(
  app: Hono,
  opts: {
    store: JsonStore;
    sessions: SessionService;
    getHypervisor: () => Hypervisor;
  },
): void {
  app.post("/api/share/upload", async (c) => {
    const share = (await opts.store.loadConfig()).advanced.hostSharePath?.trim();
    if (!share) return c.json({ error: "Host share is not configured" }, 400);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return c.json({ error: "file is required" }, 400);
    try {
      const dest = shareDest(share, file.name);
      await mkdir(share, { recursive: true });
      await writeFile(dest, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
      const sessionId = c.req.query("sessionId");
      const session = sessionId ? await opts.sessions.get(sessionId) : undefined;
      const os = session?.os ?? "ubuntu";
      const vm = session?.vmId ? opts.getHypervisor().get(session.vmId) : undefined;
      if (vm && isWindows(os)) {
        await pushShareFileToWindows(vm, dest, basename(dest)).catch(() => undefined);
      }
      return c.json({ path: dest, guestPath: guestSharePath(os, basename(dest)) }, 201);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/share", async (c) => {
    const share = (await opts.store.loadConfig()).advanced.hostSharePath?.trim();
    if (!share) return c.json({ files: [] });
    try {
      const sessionId = c.req.query("sessionId");
      const session = sessionId ? await opts.sessions.get(sessionId) : undefined;
      const os = session?.os ?? "ubuntu";
      const vm = session?.vmId ? opts.getHypervisor().get(session.vmId) : undefined;
      if (vm && isWindows(os)) {
        await pullWindowsShareToHost(vm, share).catch(() => undefined);
      }
      return c.json({ files: await listShareFiles(share, os) });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/share/files/:name", async (c) => {
    const share = (await opts.store.loadConfig()).advanced.hostSharePath?.trim();
    if (!share) return c.json({ error: "Host share is not configured" }, 400);
    try {
      const dest = shareDest(share, c.req.param("name"));
      await stat(dest);
      const data = await readFile(dest);
      const filename = attachmentFilename(dest);
      return c.body(data, 200, {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${filename}"`,
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
      return c.json({ error: errorMessage(err) }, code);
    }
  });
}
