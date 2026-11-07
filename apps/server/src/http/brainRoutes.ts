import type { Hono } from "hono";
import type { BrainService } from "../brain/brain.js";
import { draftBrainIssueBrief, postBrainIssueBrief } from "../brain/issueBrief.js";
import { isLocalOperator } from "../core/localguard.js";
import type { JsonStore } from "../core/store.js";
import { IntegrationsClient } from "../integrations/integrations.js";
import { errorMessage } from "./sessionJson.js";

export function registerBrainRoutes(
  app: Hono,
  brain: BrainService | undefined,
  deps?: {
    store: JsonStore;
    fetchFn?: typeof fetch;
    peerAddress?: (c: import("hono").Context) => string | undefined;
  },
): void {
  app.get("/api/brain", async (c) => {
    if (!brain) return c.json({ error: "Brain unavailable" }, 503);
    const doc = await brain.get();
    return c.json(doc);
  });

  app.get("/api/brain/status", async (c) => {
    if (!brain) return c.json({ error: "Brain unavailable" }, 503);
    return c.json(await brain.summary());
  });

  app.post("/api/brain/build", async (c) => {
    if (!brain) return c.json({ error: "Brain unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        path?: string;
        repo?: string;
      };
      if (typeof body.repo === "string" && body.repo.trim() && !body.path?.trim()) {
        const result = await brain.buildForRepo(body.repo.trim());
        if (!result.ok) return c.json({ error: result.output, ...(await brain.get()) }, 400);
        return c.json({ ...(await brain.get()), output: result.output });
      }
      if (typeof body.path === "string" && body.path.trim()) {
        if (!isLocalOperator(c, deps?.peerAddress)) {
          return c.json({ error: "Indexing an arbitrary path is desktop-only" }, 403);
        }
        const result = await brain.indexPath(body.path.trim(), {
          repo: body.repo,
          actor: "indexer:build",
        });
        return c.json({ ...(await brain.get()), output: result.output });
      }
      const result = await brain.buildCwd();
      return c.json({ ...(await brain.get()), output: result.output });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/brain/remember", async (c) => {
    if (!brain) return c.json({ error: "Brain unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as { text?: string; repo?: string };
      const repo = typeof body.repo === "string" ? body.repo.trim() : "";
      const result = await brain.remember({
        text: typeof body.text === "string" ? body.text : "",
        ...(repo ? { repo } : {}),
      });
      if (!result.ok) return c.json({ error: result.output }, 400);
      return c.json({ ...(await brain.get()), output: result.output });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/brain/brief", async (c) => {
    if (!brain || !deps) return c.json({ error: "Brain unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        issue?: string;
        target?: string;
        title?: string;
        summary?: string;
        body?: string;
        post?: boolean;
      };
      const config = await deps.store.loadConfig();
      const client = new IntegrationsClient(deps.fetchFn ?? fetch);
      const draft = await draftBrainIssueBrief({
        doc: await brain.get(),
        issue: typeof body.issue === "string" ? body.issue : "",
        target: typeof body.target === "string" ? body.target : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
        summary: typeof body.summary === "string" ? body.summary : undefined,
        body: typeof body.body === "string" ? body.body : undefined,
        integrations: config.integrations,
        client,
      });
      if (!draft.ok) return c.json({ error: draft.output }, 400);
      if (body.post !== true) return c.json(draft);
      const posted = await postBrainIssueBrief(client, draft, config.integrations);
      if (!posted.ok) return c.json({ error: posted.output, ...draft }, 400);
      return c.json({ ...draft, output: posted.output });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/brain/search", async (c) => {
    if (!brain) return c.json({ error: "Brain unavailable" }, 503);
    const body = (await c.req.json().catch(() => ({}))) as { q?: string };
    return c.json({ output: await brain.search(typeof body.q === "string" ? body.q : "") });
  });

  app.post("/api/brain/export", async (c) => {
    if (!brain) return c.json({ error: "Brain unavailable" }, 503);
    try {
      const path = await brain.exportJson();
      return c.json({ path, ...(await brain.get()) });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/brain/transcript", async (c) => {
    if (!brain) return c.json({ error: "Brain unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        text?: string;
        source?: string;
        repo?: string;
      };
      const result = await brain.ingestTranscript({
        text: typeof body.text === "string" ? body.text : "",
        source: typeof body.source === "string" ? body.source : undefined,
        repo: typeof body.repo === "string" ? body.repo : undefined,
      });
      if (!result.ok) return c.json({ error: result.output, count: result.count }, 400);
      return c.json({ ...(await brain.get()), output: result.output, count: result.count });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/brain/ingest", async (c) => {
    if (!brain) return c.json({ error: "Brain unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as { paused?: boolean };
      const config = await brain.setIngestPaused(body.paused === true);
      return c.json({ brain: config.brain, ...(await brain.get()) });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/brain/correct", async (c) => {
    if (!brain) return c.json({ error: "Brain unavailable" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        nodeId?: string;
        memoryId?: string;
        reason?: string;
        claim?: string;
        id?: string;
        action?: "accepted" | "dismissed";
      };
      if (body.id && (body.action === "accepted" || body.action === "dismissed")) {
        const result = await brain.resolveCorrection(body.id, body.action);
        if (!result.ok) return c.json({ error: result.output, ...(await brain.get()) }, 400);
        return c.json({ ...(await brain.get()), output: result.output });
      }
      const result = await brain.correct({
        nodeId: body.nodeId,
        memoryId: body.memoryId,
        reason: typeof body.reason === "string" ? body.reason : "",
        claim: body.claim,
        actor: "operator",
      });
      if (!result.ok) return c.json({ error: result.output, ...(await brain.get()) }, 400);
      return c.json({ ...(await brain.get()), output: result.output });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/brain/corpus", async (c) => {
    if (!brain) return c.json({ error: "Brain unavailable" }, 503);
    try {
      const result = await brain.ingestCorpus();
      return c.json({ ...(await brain.get()), output: result.output, added: result.added });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });
}
