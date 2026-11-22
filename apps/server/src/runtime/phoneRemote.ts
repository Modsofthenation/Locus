import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import type { IncomingMessage } from "node:http";
import {
  OPERATOR_COOKIE,
  OPERATOR_HEADER,
  OPERATOR_QUERY,
  PHONE_COOKIE,
  operatorTokenExempt,
  isLanOrigin,
  isLanPeerHost,
  isLoopbackHost,
  isLoopbackOrigin,
  pairingAppUrl,
  pairingHttpsUrl,
  type PhoneRemote,
} from "@locus/shared";

export function generatePhoneToken(): string {
  return `ph_${randomBytes(16).toString("hex")}`;
}

export function allowPhoneAccess(input: {
  peer?: string;
  origin?: string;
  token?: string;
  remote?: PhoneRemote;
  method?: string;
  path?: string;
  /** Expected operator token. Unset turns the operator check off (tests, `LOCUS_OPERATOR_AUTH=off`). */
  operatorToken?: string;
  /** Operator credential the request carried (see `operatorCredentialFromHeaders`). */
  operatorCredential?: string;
  /** Host header is the isolated canvas preview origin. */
  canvasPreviewHost?: boolean;
}): boolean {
  const peer = normalizePeer(input.peer);
  const loopbackPeer = !peer || isLoopbackHost(peer);
  const origin = input.origin;
  if (origin && !isLoopbackOrigin(origin) && !isLanOrigin(origin)) return false;
  if (loopbackPeer && isLoopbackOrigin(origin)) {
    // Loopback alone is not the operator: sandboxed CLIs, guest forwards and
    // any local process share it. /api and /ws need the operator token.
    if (!input.operatorToken) return true;
    if (tokensMatch(input.operatorCredential, input.operatorToken)) return true;
    if (
      input.path !== undefined &&
      operatorTokenExempt(input.path, { canvasPreviewHost: input.canvasPreviewHost })
    ) {
      return true;
    }
    // Fall through: a paired phone token still works from loopback.
  }
  if (!input.remote?.enabled || !input.remote.token) return false;
  if (peer && !isLoopbackHost(peer) && !isLanPeerHost(peer)) return false;
  if (tokensMatch(input.token, input.remote.token)) return true;
  // HTML/JS/CSS are not secret. Chrome on HTTP IP origins often drops the pairing cookie.
  return isPhoneUiRequest(input.method, input.path);
}

/** GET/HEAD of the desktop UI (not /api or /ws). `path` must be passed explicitly. */
export function isPhoneUiRequest(method?: string, path?: string): boolean {
  if (path === undefined) return false;
  const m = (method ?? "GET").toUpperCase();
  if (m !== "GET" && m !== "HEAD") return false;
  if (path === "/api" || path.startsWith("/api/")) return false;
  if (path === "/ws" || path.startsWith("/ws/")) return false;
  return true;
}

export function tokenFromHeaders(
  headers: Headers | IncomingMessage["headers"],
  url?: string,
): string | undefined {
  const cookie = headerValue(headers, "cookie");
  const fromCookie = tokenFromCookie(cookie);
  if (fromCookie) return fromCookie;
  const auth = headerValue(headers, "authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const bearer = auth.slice(7).trim();
    if (bearer) return bearer;
  }
  if (url) {
    try {
      const parsed = new URL(url, "http://127.0.0.1");
      const token = parsed.searchParams.get("token")?.trim();
      if (token) return token;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** Operator token from the cookie, `x-locus-operator`, a bearer header, or `?operator=`. */
export function operatorCredentialFromHeaders(
  headers: Headers | IncomingMessage["headers"],
  url?: string,
): string | undefined {
  const cookie = cookieValue(headerValue(headers, "cookie"), OPERATOR_COOKIE);
  if (cookie) return cookie;
  const header = headerValue(headers, OPERATOR_HEADER)?.trim();
  if (header) return header;
  const auth = headerValue(headers, "authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const bearer = auth.slice(7).trim();
    if (bearer) return bearer;
  }
  if (url) {
    try {
      const value = new URL(url, "http://127.0.0.1").searchParams.get(OPERATOR_QUERY)?.trim();
      if (value) return value;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** Set-Cookie for the operator token: HttpOnly, SameSite=Strict, whole site. */
export function operatorCookie(token: string): string {
  return `${OPERATOR_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`;
}

function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key?.trim() !== name) continue;
    const value = rest.join("=").trim();
    if (!value) return undefined;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

export function tokenFromCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.split("=");
    if (name?.trim() !== PHONE_COOKIE) continue;
    const value = rest.join("=").trim();
    return value ? decodeURIComponent(value) : undefined;
  }
  return undefined;
}

export function phoneCookie(token: string, secure = false): string {
  const flags = secure ? "; Secure" : "";
  return `${PHONE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${flags}`;
}

export function listLanAddresses(): string[] {
  const out: string[] = [];
  const nets = networkInterfaces();
  for (const rows of Object.values(nets)) {
    for (const row of rows ?? []) {
      if (row.internal) continue;
      const address = row.address;
      if (address.toLowerCase().startsWith("fe80:")) continue;
      if (!isLanPeerHost(address)) continue;
      if (!out.includes(address)) out.push(address);
    }
  }
  return out;
}

export function pairingLinks(
  port: number,
  token: string,
  fingerprint?: string,
): Array<{ address: string; http: string; app: string }> {
  return listLanAddresses().map((address) => ({
    address,
    http: pairingHttpsUrl(address, port, token, fingerprint),
    app: pairingAppUrl(address, port, token, fingerprint),
  }));
}

export function normalizePeer(peer: string | undefined): string | undefined {
  if (!peer?.trim()) return undefined;
  const host = peer
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (host.startsWith("::ffff:")) return host.slice("::ffff:".length);
  return host;
}

export function tokensMatch(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(createHash("sha256").update(given).digest());
  const b = Buffer.from(createHash("sha256").update(expected).digest());
  return a.length === b.length && timingSafeEqual(a, b);
}

function headerValue(
  headers: Headers | IncomingMessage["headers"],
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const raw = headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}
