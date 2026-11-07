import type { Hono } from "hono";
import {
  gifLookupAllowed,
  parseSlackPostAs,
  slackMediaResponseHeaders,
  SLACK_UPLOAD_MAX_BYTES,
} from "@locus/shared";
import { redactConfig } from "../core/redact.js";
import type { JsonStore } from "../core/store.js";
import type { SlackGateway } from "../slack/slackGateway.js";
import type { SlackOauth } from "../slack/slackOauth.js";
import { errorMessage } from "./sessionJson.js";

export function registerSlackRoutes(
  app: Hono,
  slack: SlackGateway,
  slackOauth: SlackOauth,
  store: JsonStore,
): void {
  app.post("/api/slack/oauth/start", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        accountId?: string;
        oauthClientId?: string;
        oauthClientSecret?: string;
      };
      const config = await store.loadConfig();
      const accountId =
        body.accountId?.trim() ||
        (config.integrations ?? []).find((row) => row.kind === "slack")?.id;
      if (!accountId)
        return c.json({ error: "Add a Slack account in Settings → Integrations" }, 400);
      return c.json(await slackOauth.start(accountId, body));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Slack sign-in failed" }, 400);
    }
  });

  app.get("/api/slack/oauth/status", async (c) => {
    const accountId = c.req.query("accountId")?.trim();
    const config = await store.loadConfig();
    const id = accountId || (config.integrations ?? []).find((row) => row.kind === "slack")?.id;
    if (!id) return c.json({ status: "idle" });
    return c.json(await slackOauth.status(id));
  });

  app.post("/api/slack/oauth/disconnect", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { accountId?: string };
      const config = await store.loadConfig();
      const id =
        body.accountId?.trim() ||
        (config.integrations ?? []).find((row) => row.kind === "slack")?.id;
      if (!id) return c.json({ error: "Unknown Slack account" }, 400);
      await slackOauth.disconnect(id);
      void slack.restart();
      return c.json({ ok: true, config: redactConfig(await store.loadConfig()) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Disconnect failed" }, 400);
    }
  });

  app.get("/api/slack/status", async (c) => {
    try {
      await slack.start();
    } catch {
      /* status still useful */
    }
    return c.json(slack.status());
  });

  app.get("/api/slack/conversations", async (c) => {
    try {
      return c.json(await slack.listConversations(c.req.query("refresh") === "1"));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/slack/conversations/:id/star", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { starred?: boolean };
    try {
      return c.json(await slack.setStarred(c.req.param("id"), body.starred !== false));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/slack/emoji", async (c) => {
    try {
      return c.json(await slack.listEmoji(c.req.query("refresh") === "1"));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/slack/unwatch", async (c) => {
    slack.unwatch();
    return c.json({ ok: true });
  });

  app.get("/api/slack/conversations/:id/history", async (c) => {
    try {
      return c.json(
        await slack.history(c.req.param("id"), {
          oldest: c.req.query("oldest") ?? undefined,
          latest: c.req.query("latest") ?? undefined,
        }),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/slack/conversations/:id/replies", async (c) => {
    const ts = c.req.query("ts")?.trim();
    if (!ts) return c.json({ error: "ts is required" }, 400);
    try {
      return c.json(await slack.replies(c.req.param("id"), ts));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/slack/search", async (c) => {
    try {
      return c.json(await slack.search(c.req.query("q") ?? ""));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/slack/activity", async (c) => {
    try {
      return c.json(await slack.activity());
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/slack/giphy", async (c) => {
    try {
      const config = await store.loadConfig();
      const live = gifLookupAllowed(config.managedPolicy);
      return c.json(await slack.searchGiphy(c.req.query("q") ?? "", { live }));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/slack/media", async (c) => {
    const url = c.req.query("url")?.trim() ?? "";
    if (!url) return c.json({ error: "url is required" }, 400);
    try {
      const file = await slack.fetchMedia(url);
      return new Response(file.bytes, {
        headers: slackMediaResponseHeaders(file.mime, {
          preview: c.req.query("preview") === "1",
        }),
      });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/slack/conversations/:id/messages", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      text?: string;
      threadTs?: string;
      thread_ts?: string;
      gif?: { url?: string; title?: string };
      as?: string;
      replyBroadcast?: boolean;
      reply_broadcast?: boolean;
    };
    const text = body.text?.trim() ?? "";
    const gifUrl = body.gif?.url?.trim();
    const gif = gifUrl ? { url: gifUrl, title: body.gif?.title?.trim() } : undefined;
    if (!text && !gif) return c.json({ error: "text is required" }, 400);
    try {
      return c.json(
        await slack.post(
          c.req.param("id"),
          text,
          body.threadTs?.trim() || body.thread_ts?.trim() || undefined,
          gif,
          body.as === "bot" ? "bot" : "user",
          body.replyBroadcast === true || body.reply_broadcast === true,
        ),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/slack/conversations/:id/read", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ts?: string };
    try {
      return c.json(await slack.markRead(c.req.param("id"), body.ts?.trim() || undefined));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.patch("/api/slack/conversations/:id/messages", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      ts?: string;
      text?: string;
      as?: string;
    };
    const ts = body.ts?.trim() ?? "";
    const text = body.text?.trim() ?? "";
    if (!ts || !text) return c.json({ error: "ts and text are required" }, 400);
    try {
      return c.json(
        await slack.update(c.req.param("id"), ts, text, body.as === "bot" ? "bot" : "user"),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.delete("/api/slack/conversations/:id/messages", async (c) => {
    const ts = c.req.query("ts")?.trim() ?? "";
    if (!ts) return c.json({ error: "ts is required" }, 400);
    try {
      return c.json(
        await slack.deleteMessage(
          c.req.param("id"),
          ts,
          c.req.query("as") === "bot" ? "bot" : "user",
        ),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/slack/conversations/:id/files", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return c.json({ error: "file is required" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.byteLength) return c.json({ error: "file is empty" }, 400);
    if (bytes.byteLength > SLACK_UPLOAD_MAX_BYTES) {
      return c.json({ error: "file is larger than 20 MiB" }, 400);
    }
    const filenameField = form?.get("filename");
    const filename =
      (typeof filenameField === "string" && filenameField.trim()) || file.name || "upload";
    const commentField = form?.get("comment");
    const comment = typeof commentField === "string" ? commentField : "";
    const threadField = form?.get("threadTs") ?? form?.get("thread_ts");
    const asField = form?.get("as");
    try {
      return c.json(
        await slack.upload(c.req.param("id"), {
          filename,
          bytes,
          mime: file.type || undefined,
          comment: comment.trim() || undefined,
          threadTs:
            typeof threadField === "string" && threadField.trim() ? threadField.trim() : undefined,
          as: parseSlackPostAs(typeof asField === "string" ? asField : undefined),
        }),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/slack/conversations/:id/reactions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      ts?: string;
      name?: string;
      remove?: boolean;
      threadTs?: string;
      thread_ts?: string;
    };
    const ts = body.ts?.trim() ?? "";
    const name = body.name?.trim() ?? "";
    if (!ts || !name) return c.json({ error: "ts and name are required" }, 400);
    try {
      return c.json(
        await slack.react(c.req.param("id"), ts, name, {
          remove: body.remove,
          threadTs: body.threadTs?.trim() || body.thread_ts?.trim() || undefined,
        }),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/slack/run", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      channelId?: string;
      threadTs?: string;
      messageTs?: string;
      text?: string;
      userId?: string;
      providerId?: string;
      model?: string;
      recipeId?: string;
      sinceTs?: string;
    };
    if (!body.channelId?.trim() || !body.text?.trim()) {
      return c.json({ error: "channelId and text are required" }, 400);
    }
    try {
      return c.json(
        await slack.run({
          channelId: body.channelId.trim(),
          threadTs: body.threadTs,
          messageTs: body.messageTs,
          text: body.text,
          userId: body.userId,
          providerId: body.providerId?.trim() || undefined,
          model: body.model?.trim() || undefined,
          recipeId: body.recipeId?.trim() || undefined,
          sinceTs: body.sinceTs?.trim() || undefined,
        }),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });
}
