import type { Context } from "hono";

export type RouteHttpStatus = 400 | 401 | 404 | 409 | 413 | 422 | 429 | 500 | 503;

/** @deprecated Use RouteHttpStatus. */
export type SessionHttpStatus = RouteHttpStatus;

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return "Something went wrong";
}

/** Map domain Error messages to HTTP status. One interface for every route catch. */
export function routeErrorStatus(message: string): RouteHttpStatus {
  const lower = message.toLowerCase();
  if (lower.startsWith("invalid webhook") || lower.includes("invalid webhook")) return 401;
  if (lower.startsWith("too many webhook") || lower.includes("too many webhook")) return 429;
  if (lower.includes("webhook payload is too large")) return 413;
  if (lower.includes("not found")) return 404;
  if (
    lower.includes("already") ||
    lower.includes("conflict") ||
    lower.includes("in use") ||
    lower.includes("max concurrent")
  ) {
    return 409;
  }
  if (
    lower.includes("queue is full") ||
    lower.includes("too large") ||
    lower.includes("empty message")
  ) {
    return 422;
  }
  if (lower.includes("enoent")) return 404;
  if (
    lower.includes("emfile") ||
    lower.includes("enfile") ||
    lower.includes("too many open files") ||
    lower.includes("eagain") ||
    lower.includes("enospc")
  ) {
    return 503;
  }
  if (lower.includes("fts5") || lower.includes("sqlite") || lower.includes("internal")) {
    return 500;
  }
  return 400;
}

/** @deprecated Use routeErrorStatus. */
export function sessionErrorStatus(message: string): RouteHttpStatus {
  return routeErrorStatus(message);
}

export function notFoundErrorStatus(message: string): 400 | 404 {
  return message.toLowerCase().includes("not found") ? 404 : 400;
}

export function errorJson(c: Context, err: unknown) {
  if (err && typeof err === "object" && "code" in err) {
    const code = String(err.code);
    if (code === "ENOENT") return c.json({ error: errorMessage(err) }, 404);
    if (code === "EMFILE" || code === "ENFILE") {
      return c.json({ error: errorMessage(err) }, 503);
    }
  }
  const message = errorMessage(err);
  return c.json({ error: message }, routeErrorStatus(message));
}

/** Workspace-style seam: missing resource vs bad request. No 409/422/500 guesswork. */
export function notFoundErrorJson(c: Context, err: unknown) {
  if (err && typeof err === "object" && "code" in err) {
    const code = String(err.code);
    if (code === "ENOENT") return c.json({ error: errorMessage(err) }, 404);
    if (code === "EMFILE" || code === "ENFILE") {
      return c.json({ error: errorMessage(err) }, 503);
    }
  }
  const message = errorMessage(err);
  const status = routeErrorStatus(message);
  if (status === 503) return c.json({ error: message }, status);
  return c.json({ error: message }, notFoundErrorStatus(message));
}

/** Map domain errors to JSON. Preserves the message; status follows the wording. */
export async function sessionJson(
  c: Context,
  run: () => Promise<unknown>,
  status: 200 | 201 = 200,
) {
  try {
    return c.json(await run(), status);
  } catch (err) {
    return errorJson(c, err);
  }
}

/** @deprecated Use sessionJson. */
export const routeJson = sessionJson;
