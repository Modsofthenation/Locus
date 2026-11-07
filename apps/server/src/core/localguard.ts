import type { Context, Next } from "hono";
import {
  isCanvasFilesPath,
  isCanvasPreviewHost,
  isChromeExtensionApiPath,
  isChromeExtensionOrigin,
  isLanOrigin,
  isLoopbackHost,
  isLoopbackOrigin,
  type ChromeExtensionSettings,
  type PhoneRemote,
} from "@locus/shared";
import {
  allowPhoneAccess,
  isPhoneUiRequest,
  normalizePeer,
  phoneCookie,
  tokenFromHeaders,
  tokensMatch,
} from "../runtime/phoneRemote.js";
import { phoneAuthLimiter } from "./rateLimit.js";

export type PhoneGate = {
  remote: () => PhoneRemote | Promise<PhoneRemote | undefined> | undefined;
  chromeExtension?: () =>
    ChromeExtensionSettings | Promise<ChromeExtensionSettings | undefined> | undefined;
  peer?: (c: Context) => string | undefined;
};

export function loopbackCorsOrigin(origin: string): string | undefined {
  return isLoopbackOrigin(origin) ? origin : undefined;
}

export function controlPlaneCorsOrigin(origin: string): string | undefined {
  try {
    if (isCanvasPreviewHost(new URL(origin).hostname)) return undefined;
  } catch {
    return undefined;
  }
  if (isLoopbackOrigin(origin) || isLanOrigin(origin) || isChromeExtensionOrigin(origin)) {
    return origin;
  }
  return undefined;
}

/** locus-canvas.localhost may only fetch canvas-files, never the rest of /api. */
export function attachCanvasPreviewHostGate() {
  return async (c: Context, next: Next) => {
    if (!isCanvasPreviewHost(c.req.header("host"))) return next();
    if (isCanvasFilesPath(c.req.path)) return next();
    return c.json({ error: "Not found" }, 404);
  };
}

export function attachPhoneGate(gate: PhoneGate) {
  return async (c: Context, next: Next) => {
    const remote = await gate.remote();
    const origin = c.req.header("origin");
    const url = c.req.url;
    const queryToken = c.req.query("token")?.trim();
    const token = tokenFromHeaders(c.req.raw.headers, url) ?? queryToken;
    const peer = gate.peer?.(c) ?? peerFromContext(c);
    if (isChromeExtensionOrigin(origin)) {
      const loopbackPeer = !peer || isLoopbackHost(peer);
      if (!loopbackPeer || !isChromeExtensionApiPath(c.req.path)) {
        return c.json({ error: "Origin not allowed" }, 403);
      }
      const chrome = await gate.chromeExtension?.();
      if (!chrome?.enabled || !chrome.token || !tokensMatch(token, chrome.token)) {
        return c.json({ error: "Origin not allowed" }, 403);
      }
      await next();
      return;
    }
    const allowed = allowPhoneAccess({
      peer,
      origin,
      token,
      remote,
      method: c.req.method,
      path: c.req.path,
    });
    if (!allowed) {
      const loopbackPeer = !peer || isLoopbackHost(peer);
      if (
        !loopbackPeer &&
        !isPhoneUiRequest(c.req.method, c.req.path) &&
        !phoneAuthLimiter.allow(peer || `unknown:${c.req.path}`)
      ) {
        return c.json({ error: "Too many requests" }, 429);
      }
      return c.json({ error: "Origin not allowed" }, 403);
    }
    if (
      queryToken &&
      remote?.enabled &&
      remote.token &&
      tokensMatch(queryToken, remote.token) &&
      c.req.method === "GET" &&
      !c.req.path.startsWith("/api")
    ) {
      c.header("set-cookie", phoneCookie(queryToken, requestIsTls(c)));
      c.header("referrer-policy", "no-referrer");
    }
    await next();
  };
}

export function peerFromContext(c: Context): string | undefined {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress;
}

export function isLocalOperator(
  c: Context,
  peerAddress?: (c: Context) => string | undefined,
): boolean {
  const peer = normalizePeer(peerAddress?.(c) ?? peerFromContext(c));
  return !peer || isLoopbackHost(peer);
}

function requestIsTls(c: Context): boolean {
  const env = c.env as { incoming?: { socket?: { encrypted?: boolean } } } | undefined;
  return Boolean(env?.incoming?.socket?.encrypted);
}
