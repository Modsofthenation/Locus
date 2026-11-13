import type { Context, Hono } from "hono";
import { tmpdir } from "node:os";
import { isLocalOperator } from "../core/localguard.js";
import type { JsonStore } from "../core/store.js";
import {
  cancelPendingRestore,
  createBackup,
  inspectBackup,
  pendingRestore,
  stageRestore,
} from "../core/backup.js";

/**
 * Backup and restore of the data directory. Desktop / CLI on this machine only:
 * a paired phone or LAN peer never gets these routes (they read and write host paths
 * and carry every stored secret).
 */
export function registerBackupRoutes(
  app: Hono,
  opts: {
    store: JsonStore;
    peerAddress?: (c: Context) => string | undefined;
  },
): void {
  let busy: "backup" | "restore" | undefined;

  function denied(c: Context) {
    return c.json({ error: "Backup and restore are only available on this computer." }, 403);
  }

  async function exclusive<T>(
    c: Context,
    kind: "backup" | "restore",
    run: () => Promise<T>,
  ): Promise<Response> {
    if (busy) return c.json({ error: `A ${busy} is already running.` }, 409);
    busy = kind;
    try {
      return c.json(await run());
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : `${kind} failed` }, 400);
    } finally {
      busy = undefined;
    }
  }

  app.post("/api/backup", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress)) return denied(c);
    const body = (await c.req.json().catch(() => ({}))) as {
      passphrase?: string;
      out?: string;
      includeDisks?: boolean;
      appVersion?: string;
    };
    return exclusive(c, "backup", () =>
      createBackup({
        dataDir: opts.store.dataDir,
        passphrase: body.passphrase ?? "",
        outPath: body.out,
        includeDisks: body.includeDisks,
        appVersion: body.appVersion,
      }),
    );
  });

  app.post("/api/backup/inspect", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress)) return denied(c);
    const body = (await c.req.json().catch(() => ({}))) as { path?: string; passphrase?: string };
    const path = body.path?.trim();
    if (!path) return c.json({ error: "Backup path is required" }, 400);
    return exclusive(c, "restore", () =>
      inspectBackup({ path, passphrase: body.passphrase ?? "", scratchDir: tmpdir() }),
    );
  });

  app.get("/api/restore", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress)) return denied(c);
    const pending = await pendingRestore(opts.store.dataDir);
    return c.json({ pending: pending ?? null });
  });

  app.post("/api/restore", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress)) return denied(c);
    const body = (await c.req.json().catch(() => ({}))) as { path?: string; passphrase?: string };
    const path = body.path?.trim();
    if (!path) return c.json({ error: "Backup path is required" }, 400);
    return exclusive(c, "restore", () =>
      stageRestore({ dataDir: opts.store.dataDir, path, passphrase: body.passphrase ?? "" }),
    );
  });

  app.delete("/api/restore", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress)) return denied(c);
    await cancelPendingRestore(opts.store.dataDir);
    return c.json({ ok: true });
  });
}
