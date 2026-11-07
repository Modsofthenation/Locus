import type { Hono } from "hono";
import { evalCaseFromTrace } from "@locus/shared";
import { isLocalOperator } from "../core/localguard.js";
import { listDebugLogs, readDebugLog } from "../core/debugLogs.js";
import { SessionTraceLog, writeEvalFixture } from "../session/traces.js";
import type { JsonStore } from "../core/store.js";
import type { SessionService } from "../session/sessions.js";
import { errorMessage } from "./sessionJson.js";

export function registerDebugRoutes(
  app: Hono,
  opts: {
    store: JsonStore;
    sessions: SessionService;
    peerAddress?: (c: import("hono").Context) => string | undefined;
  },
): void {
  app.get("/api/debug/logs", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Debug logs are desktop-only" }, 403);
    return c.json({ sources: await listDebugLogs(opts.store.dataDir, opts.sessions) });
  });

  app.get("/api/debug/logs/:kind/:key", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Debug logs are desktop-only" }, 403);
    try {
      const detail = await readDebugLog(
        opts.store.dataDir,
        opts.sessions,
        `${c.req.param("kind")}:${c.req.param("key")}`,
      );
      if (!detail) return c.json({ error: "Not found" }, 404);
      return c.json(detail);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/debug/logs/:kind/:key/eval", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Debug logs are desktop-only" }, 403);
    try {
      if (c.req.param("kind") !== "trace")
        return c.json({ error: "Eval fixtures come from traces" }, 400);
      const events = await new SessionTraceLog(opts.store.dataDir).read(c.req.param("key"));
      if (!events.length) return c.json({ error: "Not found" }, 404);
      return c.json({ fixture: evalCaseFromTrace(events) });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/debug/logs/:kind/:key/eval", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress))
      return c.json({ error: "Debug logs are desktop-only" }, 403);
    try {
      if (c.req.param("kind") !== "trace")
        return c.json({ error: "Eval fixtures come from traces" }, 400);
      const events = await new SessionTraceLog(opts.store.dataDir).read(c.req.param("key"));
      if (!events.length) return c.json({ error: "Not found" }, 404);
      const saved = await writeEvalFixture(opts.store.dataDir, events);
      return c.json(saved, 201);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });
}
