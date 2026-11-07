import type { Hono } from "hono";
import type { SessionWorkspace } from "../workspace/sessionWorkspace.js";
import { notFoundErrorJson } from "./sessionJson.js";

export function registerWorkspaceRoutes(app: Hono, workspace: SessionWorkspace): void {
  app.get("/api/sessions/:id/workspace", async (c) => {
    try {
      return c.json(
        await workspace.listWorkspace(c.req.param("id"), c.req.query("path"), c.req.query("depth")),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/file", async (c) => {
    try {
      return c.json(await workspace.readWorkspace(c.req.param("id"), c.req.query("path") ?? ""));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/raw", async (c) => {
    try {
      const file = await workspace.readWorkspaceRaw(c.req.param("id"), c.req.query("path") ?? "");
      return c.body(Uint8Array.from(file.bytes), 200, {
        "content-type": file.mime,
        "content-disposition": `inline; filename="${file.path.split("/").pop() ?? "file"}"`,
        "cache-control": "no-store",
      });
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.put("/api/sessions/:id/workspace/file", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: string; content?: string };
    try {
      return c.json(
        await workspace.writeWorkspace(c.req.param("id"), body.path ?? "", body.content ?? ""),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/mkdir", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: string };
    try {
      return c.json(await workspace.mkdirWorkspace(c.req.param("id"), body.path ?? ""), 201);
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/reveal", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: string };
    try {
      return c.json(await workspace.revealWorkspace(c.req.param("id"), body.path ?? ""));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/rename-path", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { from?: string; to?: string };
    try {
      return c.json(
        await workspace.renameWorkspacePath(c.req.param("id"), body.from ?? "", body.to ?? ""),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/complete", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      path?: string;
      content?: string;
      line?: number;
      character?: number;
    };
    try {
      return c.json(
        await workspace.completeWorkspace(
          c.req.param("id"),
          body.path ?? "",
          body.content ?? "",
          body.line ?? 0,
          body.character ?? 0,
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/inline-edit", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      path?: string;
      content?: string;
      instruction?: string;
      start?: number;
      end?: number;
    };
    try {
      return c.json(
        await workspace.inlineEditWorkspace(c.req.param("id"), {
          path: body.path ?? "",
          content: body.content ?? "",
          instruction: body.instruction ?? "",
          start: typeof body.start === "number" ? body.start : 0,
          end: typeof body.end === "number" ? body.end : 0,
        }),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/search", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { query?: string; limit?: number };
    try {
      return c.json(
        await workspace.searchWorkspace(
          c.req.param("id"),
          body.query ?? "",
          typeof body.limit === "number" ? body.limit : undefined,
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/grep", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      query?: string;
      limit?: number;
      glob?: string;
      exclude?: string;
      regex?: boolean;
      replace?: string;
    };
    try {
      return c.json(
        await workspace.grepWorkspace(
          c.req.param("id"),
          body.query ?? "",
          typeof body.limit === "number" ? body.limit : undefined,
          {
            glob: body.glob,
            exclude: body.exclude,
            regex: body.regex === true,
            replace: typeof body.replace === "string" ? body.replace : undefined,
          },
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/inspect", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      path?: string;
      content?: string;
      line?: number;
      character?: number;
    };
    try {
      return c.json(
        await workspace.inspectWorkspace(
          c.req.param("id"),
          body.path ?? "",
          body.content ?? "",
          body.line ?? 0,
          body.character ?? 0,
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/symbols", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { query?: string; limit?: number };
    try {
      return c.json(
        await workspace.symbolsWorkspace(
          c.req.param("id"),
          body.query ?? "",
          typeof body.limit === "number" ? body.limit : undefined,
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/references", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      path?: string;
      content?: string;
      line?: number;
      character?: number;
    };
    try {
      return c.json(
        await workspace.referencesWorkspace(
          c.req.param("id"),
          body.path ?? "",
          body.content ?? "",
          body.line ?? 0,
          body.character ?? 0,
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/format", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: string; content?: string };
    try {
      return c.json(
        await workspace.formatWorkspace(c.req.param("id"), body.path ?? "", body.content ?? ""),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/organize", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: string; content?: string };
    try {
      return c.json(
        await workspace.organizeWorkspace(c.req.param("id"), body.path ?? "", body.content ?? ""),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/rename", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      path?: string;
      content?: string;
      line?: number;
      character?: number;
      newName?: string;
    };
    try {
      return c.json(
        await workspace.renameWorkspace(
          c.req.param("id"),
          body.path ?? "",
          body.content ?? "",
          body.line ?? 0,
          body.character ?? 0,
          body.newName ?? "",
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/outline", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: string; content?: string };
    try {
      return c.json(
        await workspace.outlineWorkspace(c.req.param("id"), body.path ?? "", body.content),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/git", async (c) => {
    try {
      return c.json(await workspace.gitWorkspace(c.req.param("id"), c.req.query("dest")));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/git/stage", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      paths?: string[];
      unstage?: boolean;
      dest?: string;
    };
    try {
      return c.json(
        await workspace.gitWorkspaceStage(
          c.req.param("id"),
          Array.isArray(body.paths) ? body.paths : [],
          body.unstage === true,
          body.dest,
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/git/commit", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { message?: string; dest?: string };
    try {
      return c.json(
        await workspace.gitWorkspaceCommit(c.req.param("id"), body.message ?? "", body.dest),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/git/blame", async (c) => {
    try {
      return c.json(
        await workspace.gitWorkspaceBlame(
          c.req.param("id"),
          c.req.query("path") ?? "",
          Number(c.req.query("line") ?? "1"),
          c.req.query("dest"),
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/git/blame-file", async (c) => {
    try {
      return c.json({
        items: await workspace.gitWorkspaceBlameFile(
          c.req.param("id"),
          c.req.query("path") ?? "",
          c.req.query("dest"),
        ),
      });
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/git/merge", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      branch?: string;
      action?: "continue" | "abort";
      dest?: string;
    };
    try {
      if (body.action) {
        return c.json(
          await workspace.gitWorkspaceMergeContinue(c.req.param("id"), body.action, body.dest),
        );
      }
      return c.json(
        await workspace.gitWorkspaceMerge(c.req.param("id"), body.branch ?? "", body.dest),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/git/conflict", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      path?: string;
      side?: "ours" | "theirs";
      dest?: string;
    };
    try {
      const side = body.side === "theirs" ? "theirs" : "ours";
      return c.json(
        await workspace.gitWorkspaceConflict(c.req.param("id"), body.path ?? "", side, body.dest),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/git/branches", async (c) => {
    try {
      return c.json(await workspace.gitWorkspaceBranches(c.req.param("id"), c.req.query("dest")));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/git/checkout", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      branch?: string;
      create?: boolean;
      dest?: string;
    };
    try {
      return c.json(
        await workspace.gitWorkspaceCheckout(
          c.req.param("id"),
          body.branch ?? "",
          body.create === true,
          body.dest,
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/git/pull", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { dest?: string };
    try {
      return c.json(await workspace.gitWorkspacePull(c.req.param("id"), body.dest));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/git/fetch", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { dest?: string };
    try {
      return c.json(await workspace.gitWorkspaceFetch(c.req.param("id"), body.dest));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/git/discard", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { paths?: string[]; dest?: string };
    try {
      return c.json(
        await workspace.gitWorkspaceDiscard(
          c.req.param("id"),
          Array.isArray(body.paths) ? body.paths : [],
          body.dest,
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/git/stash", async (c) => {
    try {
      return c.json({
        items: await workspace.gitWorkspaceStashList(c.req.param("id"), c.req.query("dest")),
      });
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/git/stash", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      action?: "push" | "pop" | "apply" | "drop";
      message?: string;
      index?: number;
      dest?: string;
    };
    try {
      return c.json(
        await workspace.gitWorkspaceStash(
          c.req.param("id"),
          body.action ?? "push",
          body.message,
          typeof body.index === "number" ? body.index : undefined,
          body.dest,
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/git/hunks", async (c) => {
    try {
      return c.json({
        items: await workspace.gitWorkspaceHunks(
          c.req.param("id"),
          c.req.query("path"),
          c.req.query("dest"),
        ),
      });
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/git/hunk", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      patch?: string;
      unstage?: boolean;
      dest?: string;
    };
    try {
      return c.json(
        await workspace.gitWorkspaceStageHunk(
          c.req.param("id"),
          body.patch ?? "",
          body.unstage === true,
          body.dest,
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/git/rebase", async (c) => {
    try {
      return c.json(
        await workspace.gitWorkspaceRebasePreview(c.req.param("id"), c.req.query("dest")),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/git/rebase", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      onto?: string;
      todos?: Array<{
        action: "pick" | "reword" | "squash" | "fixup" | "drop";
        sha: string;
        message: string;
      }>;
      action?: "continue" | "abort" | "skip";
      dest?: string;
    };
    try {
      if (body.action) {
        return c.json(
          await workspace.gitWorkspaceRebaseContinue(c.req.param("id"), body.action, body.dest),
        );
      }
      return c.json(
        await workspace.gitWorkspaceRebase(
          c.req.param("id"),
          {
            onto: body.onto,
            todos: Array.isArray(body.todos) ? body.todos : [],
          },
          body.dest,
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/git/pr", async (c) => {
    try {
      return c.json(await workspace.gitWorkspacePullInfo(c.req.param("id"), c.req.query("dest")));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/fix", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      path?: string;
      content?: string;
      line?: number;
      character?: number;
    };
    try {
      return c.json(
        await workspace.fixWorkspace(
          c.req.param("id"),
          body.path ?? "",
          body.content ?? "",
          body.line ?? 0,
          body.character ?? 0,
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/problems", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      files?: Array<{ path?: string; content?: string }>;
    };
    try {
      return c.json(
        await workspace.problemsWorkspace(
          c.req.param("id"),
          Array.isArray(body.files)
            ? body.files.map((file) => ({ path: file.path ?? "", content: file.content ?? "" }))
            : [],
        ),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/debug", async (c) => {
    try {
      return c.json(await workspace.debugWorkspace(c.req.param("id")));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/debug/breakpoints", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      path?: string;
      line?: number;
      breakpoints?: Array<{ path?: string; line?: number }>;
    };
    try {
      return c.json(
        await workspace.debugWorkspaceBreakpoints(c.req.param("id"), {
          path: body.path,
          line: body.line,
          breakpoints: Array.isArray(body.breakpoints)
            ? body.breakpoints.map((row) => ({ path: row.path ?? "", line: row.line ?? 0 }))
            : undefined,
        }),
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/debug/start", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { program?: string };
    try {
      return c.json(await workspace.debugWorkspaceStart(c.req.param("id"), body.program ?? ""));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/debug/command", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { action?: string };
    const action = body.action;
    if (
      action !== "continue" &&
      action !== "stepOver" &&
      action !== "stepInto" &&
      action !== "stepOut" &&
      action !== "stop"
    ) {
      return c.json({ error: "Unknown debug command" }, 400);
    }
    try {
      return c.json(await workspace.debugWorkspaceCommand(c.req.param("id"), action));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/debug/stop", async (c) => {
    try {
      return c.json(await workspace.debugWorkspaceStop(c.req.param("id")));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/indent", async (c) => {
    try {
      return c.json(
        (await workspace.indentWorkspace(c.req.param("id"), c.req.query("path") ?? "")) ?? {
          indent: null,
        },
      );
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.get("/api/sessions/:id/workspace/index", async (c) => {
    try {
      return c.json(await workspace.peekWorkspaceIndex(c.req.param("id")));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.post("/api/sessions/:id/workspace/index", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { force?: boolean };
    try {
      return c.json(await workspace.ensureWorkspaceIndex(c.req.param("id"), Boolean(body.force)));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });

  app.delete("/api/sessions/:id/workspace/file", async (c) => {
    try {
      return c.json(await workspace.deleteWorkspace(c.req.param("id"), c.req.query("path") ?? ""));
    } catch (err) {
      return notFoundErrorJson(c, err);
    }
  });
}
