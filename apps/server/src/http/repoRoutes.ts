import type { Hono } from "hono";
import type { CreateSessionInput } from "@locus/shared";
import { parseIssueListState, parsePullListState, wantsFreshPulls } from "@locus/shared";
import { parseCreateLinkedRepo, parsePatchLinkedRepo, type RepoService } from "../git/repos.js";
import { errorMessage } from "./sessionJson.js";

function repoError(err: unknown): { message: string; status: 400 | 404 } {
  const message = errorMessage(err);
  return {
    message,
    status:
      message === "Unknown linked repo" || message === "Unknown change stack revision" ? 404 : 400,
  };
}

export function registerRepoRoutes(app: Hono, repos: RepoService | undefined): void {
  app.get("/api/repos", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    return c.json(await repos.list());
  });

  app.post("/api/repos", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    try {
      return c.json(await repos.link(parseCreateLinkedRepo(await c.req.json())), 201);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/repos/import", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    try {
      return c.json({ accounts: await repos.importFromForges() });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/repos/:id", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const repo = await repos.get(c.req.param("id"));
    if (!repo) return c.json({ error: "Not found" }, 404);
    return c.json(repo);
  });

  app.get("/api/repos/:id/about", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    try {
      return c.json(await repos.about(c.req.param("id")));
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.get("/api/repos/:id/branches", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    try {
      return c.json(await repos.listBranches(c.req.param("id")));
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.patch("/api/repos/:id", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    try {
      return c.json(await repos.patch(c.req.param("id"), parsePatchLinkedRepo(await c.req.json())));
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.delete("/api/repos/:id", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    try {
      await repos.delete(c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/repos/:id/refresh", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    try {
      return c.json(await repos.refresh(c.req.param("id")));
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.get("/api/repos/:id/issues", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const state = parseIssueListState(c.req.query("state"));
    try {
      return c.json(
        await repos.listIssues(c.req.param("id"), state, {
          fresh: wantsFreshPulls(c.req.query("fresh")),
        }),
      );
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.get("/api/repos/:id/issues/:number", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid issue number" }, 400);
    try {
      return c.json(
        await repos.getIssue(c.req.param("id"), number, {
          fresh: wantsFreshPulls(c.req.query("fresh")),
        }),
      );
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/repos/:id/issues/:number/comments", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid issue number" }, 400);
    try {
      const body = (await c.req.json()) as { body?: string };
      return c.json(
        await repos.commentIssue(c.req.param("id"), number, {
          body: typeof body.body === "string" ? body.body : "",
        }),
      );
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.get("/api/repos/:id/pulls", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const state = parsePullListState(c.req.query("state"));
    try {
      return c.json(
        await repos.listPulls(c.req.param("id"), state, {
          fresh: wantsFreshPulls(c.req.query("fresh")),
        }),
      );
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.get("/api/repos/:id/pulls/:number", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid pull number" }, 400);
    try {
      return c.json(
        await repos.getPull(c.req.param("id"), number, {
          fresh: wantsFreshPulls(c.req.query("fresh")),
        }),
      );
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/repos/:id/pulls/:number/comments", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid pull number" }, 400);
    try {
      const body = (await c.req.json()) as {
        body?: string;
        path?: string;
        line?: number;
        side?: "LEFT" | "RIGHT";
      };
      return c.json(
        await repos.comment(c.req.param("id"), number, {
          body: typeof body.body === "string" ? body.body : "",
          path: typeof body.path === "string" ? body.path : undefined,
          line: typeof body.line === "number" ? body.line : undefined,
          side: body.side === "LEFT" || body.side === "RIGHT" ? body.side : undefined,
        }),
      );
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/repos/:id/pulls/:number/reviews", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid pull number" }, 400);
    try {
      const body = (await c.req.json()) as {
        body?: string;
        event?: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
      };
      return c.json(
        await repos.review(c.req.param("id"), number, {
          body: typeof body.body === "string" ? body.body : "",
          event: body.event,
        }),
      );
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/repos/:id/pulls/:number/merge", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid pull number" }, 400);
    try {
      return c.json(await repos.merge(c.req.param("id"), number));
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.put("/api/repos/:id/pulls/:number/files/viewed", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid pull number" }, 400);
    try {
      const body = (await c.req.json().catch(() => ({}))) as { path?: unknown; viewed?: unknown };
      const path = typeof body.path === "string" ? body.path : "";
      return c.json(
        await repos.setFileViewed(c.req.param("id"), number, path, body.viewed !== false),
      );
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.get("/api/repos/:id/pulls/:number/loadpath", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid pull number" }, 400);
    try {
      return c.json(await repos.getLoadPath(c.req.param("id"), number));
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.patch("/api/repos/:id/pulls/:number/loadpath", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid pull number" }, 400);
    try {
      const body = (await c.req.json().catch(() => ({}))) as { notes?: string };
      return c.json(
        await repos.patchLoadPathNotes(
          c.req.param("id"),
          number,
          typeof body.notes === "string" ? body.notes : "",
        ),
      );
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.get("/api/repos/:id/pulls/:number/changestack/revisions", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid pull number" }, 400);
    try {
      return c.json({
        revisions: await repos.listChangeStackRevisions(c.req.param("id"), number),
      });
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.get("/api/repos/:id/pulls/:number/changestack", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid pull number" }, 400);
    try {
      return c.json(
        await repos.getChangeStack(c.req.param("id"), number, {
          fresh: wantsFreshPulls(c.req.query("fresh")),
          sha: c.req.query("sha") || undefined,
        }),
      );
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/repos/:id/pulls/:number/changestack", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid pull number" }, 400);
    try {
      const body = (await c.req.json().catch(() => ({}))) as { fresh?: unknown };
      const fresh = body.fresh === false ? false : true;
      return c.json(
        await repos.getChangeStack(c.req.param("id"), number, { fresh, summarize: true }),
      );
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/repos/:id/agents", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    try {
      const input = (await c.req.json().catch(() => ({}))) as Partial<CreateSessionInput> & {
        reuse?: boolean;
      };
      const { session } = await repos.startAgent(c.req.param("id"), input);
      return c.json(session, 201);
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/repos/:id/setup-environment", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    try {
      const { session } = await repos.startSetupSession(c.req.param("id"));
      return c.json(session, 201);
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.get("/api/repos/:id/architecture", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    try {
      return c.json(await repos.architecture(c.req.param("id")));
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/repos/:id/architecture/suggest", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const body = (await c.req.json().catch(() => ({}))) as { scope?: unknown; target?: unknown };
    try {
      const { session } = await repos.startArchitectureSession(c.req.param("id"), body);
      return c.json(session, 201);
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/repos/:id/pulls/:number/review-session", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid pull number" }, 400);
    try {
      const { session } = await repos.startReviewSession(c.req.param("id"), number);
      return c.json(session, 201);
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/repos/:id/pulls/:number/fix-session", async (c) => {
    if (!repos) return c.json({ error: "Repos unavailable" }, 503);
    const number = Number(c.req.param("number"));
    if (!Number.isInteger(number) || number <= 0)
      return c.json({ error: "Invalid pull number" }, 400);
    try {
      const { session } = await repos.startFixSession(c.req.param("id"), number);
      return c.json(session, 201);
    } catch (err) {
      const { message, status } = repoError(err);
      return c.json({ error: message }, status);
    }
  });
}
