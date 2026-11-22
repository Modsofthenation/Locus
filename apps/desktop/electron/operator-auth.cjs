const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// Keep in sync with OPERATOR_* in packages/shared/src/security.ts.
const OPERATOR_COOKIE = "locus_operator";
const OPERATOR_HEADER = "x-locus-operator";
const OPERATOR_TOKEN_FILE = "operator.token";

/** The control plane's operator token (env, else `<home>/operator.token`). */
function readOperatorToken(home, env = process.env, readFile = readFileSync) {
  const fromEnv = env.LOCUS_OPERATOR_TOKEN && env.LOCUS_OPERATOR_TOKEN.trim();
  if (fromEnv) return fromEnv;
  try {
    return readFile(join(home, OPERATOR_TOKEN_FILE), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cookie details for `session.cookies.set`, one per loopback host the UI uses.
 * Cookies ignore the port, so one cookie on 127.0.0.1 covers Vite (5173) and
 * the control plane (7420).
 */
function operatorCookies(token, urls) {
  const hosts = new Set();
  for (const raw of urls) {
    try {
      const { hostname } = new URL(raw);
      if (hostname === "127.0.0.1" || hostname === "localhost") hosts.add(hostname);
    } catch {
      /* skip */
    }
  }
  return [...hosts].map((host) => ({
    url: `http://${host}/`,
    name: OPERATOR_COOKIE,
    value: token,
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    // Session cookie lifetime is fine: the desktop sets it on every start.
  }));
}

/** Headers for main-process fetches to the control plane. */
function operatorHeaders(token) {
  return token ? { [OPERATOR_HEADER]: token } : {};
}

/**
 * A control-plane `/api` URL (artifact, recording or export download). The
 * system browser has no operator cookie, so these are downloaded in-app instead
 * of handed to `shell.openExternal`.
 */
function isControlPlaneApiUrl(url, controlPlaneOrigins) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (!controlPlaneOrigins.includes(parsed.origin)) return false;
    return parsed.pathname === "/api" || parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

module.exports = {
  OPERATOR_COOKIE,
  OPERATOR_HEADER,
  isControlPlaneApiUrl,
  operatorCookies,
  operatorHeaders,
  readOperatorToken,
};
