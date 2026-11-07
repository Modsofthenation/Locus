export function isLoopbackHost(host: string): boolean {
  const hostname = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!hostname) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") return true;
  if (hostname === "127.0.0.1") return true;
  const ipv4 = hostname.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  return ipv4.slice(1).every((part) => {
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function invalidHttpUrl(value: string, label = "URL"): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${label} is not a valid URL`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `${label} must be http or https`;
  }
  if (parsed.username || parsed.password) {
    return `${label} must not include credentials`;
  }
  return undefined;
}

export function qemuPathUnsafe(path: string): boolean {
  return /[,\n\r\0]/.test(path);
}

export function isMaskedSecret(value: string | undefined): boolean {
  return !value || value.includes("•");
}

export const SENSITIVE_PATH_REFUSAL =
  "Refusing to read a credential file. Secrets stay in environment variables at command runtime, not in model context.";

const SENSITIVE_LEAVES = new Set([
  ".env",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "application_default_credentials.json",
  "service-account.json",
  "gcloud.json",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "master.key",
  "secrets.enc",
]);

const ENV_EXAMPLE = /^(?:\.env|.*)\.(?:example|sample|template)$/;

export function isSensitivePath(path: string): boolean {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  const parts = lower.split("/").filter(Boolean);
  const leaf = parts[parts.length - 1] ?? "";
  if (!leaf) return false;
  if (ENV_EXAMPLE.test(leaf)) return false;
  if (leaf === ".env" || leaf.startsWith(".env.")) return true;
  if (SENSITIVE_LEAVES.has(leaf)) return true;
  const has = (dir: string) => parts.includes(dir);
  if (
    has(".ssh") &&
    !leaf.endsWith(".pub") &&
    leaf !== "known_hosts" &&
    leaf !== "config" &&
    leaf !== "authorized_keys"
  ) {
    return true;
  }
  if (has(".aws") && (leaf === "credentials" || leaf.includes("credential"))) return true;
  if (has(".gnupg")) return true;
  if (has(".kube") && leaf === "config") return true;
  if (
    has(".locus") &&
    (leaf === "secrets.enc" || leaf === "master.key" || leaf === "master.key.safe")
  )
    return true;
  return false;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bph_[a-f0-9]{32}\b/gi,
  /\bcx_[a-f0-9]{32}\b/gi,
  /\bATATT[A-Za-z0-9_\-=]{20,}\b/g,
  /\blin_api_[A-Za-z0-9]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/g,
  /\bsk-proj-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g,
];

/** Control-plane UI CSP. Keep in sync with apps/desktop/electron/main.cjs and index.html. */
export const CONTROL_PLANE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:* ws://[::1]:* wss://127.0.0.1:* wss://localhost:* wss://[::1]:*",
  // HTTP canvases load from locus-canvas.localhost (same port, different origin)
  // so ES modules can use allow-same-origin without sharing the operator origin.
  // Name the host explicitly: `http://*.localhost:*` is not a reliable CSP match.
  "frame-src 'self' blob: http://127.0.0.1:* http://localhost:* http://[::1]:* http://locus-canvas.localhost:*",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
].join("; ");

/**
 * srcdoc iframes inherit the parent CSP, so `script-src 'self'` kills inline
 * canvas scripts (slide decks, comment/edit hooks). Load `/api/canvas-frame`
 * instead; that document has this policy and does not inherit the parent.
 */
export const CANVAS_FRAME_PATH = "/api/canvas-frame";
export const CANVAS_FRAME_HTML_TYPE = "locus-canvas-html";
export const CANVAS_FRAME_READY_TYPE = "locus-canvas-frame-ready";
export const CANVAS_FRAME_SRCDOC_ATTR = "data-srcdoc";

export const CANVAS_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src * data: blob:",
  "font-src * data:",
  "media-src * data: blob:",
  "connect-src 'none'",
  "worker-src blob:",
  "base-uri *",
  "frame-ancestors 'self'",
].join("; ");

/**
 * Dedicated Host for HTTP canvases. Chromium maps *.localhost to loopback, so
 * this origin can run ES modules (allow-same-origin) without sharing the
 * operator UI origin. The control plane only serves canvas-files on this host.
 */
export const CANVAS_PREVIEW_HOST = "locus-canvas.localhost";

/**
 * Unique-origin preview (no allow-same-origin). allow-forms so default
 * `<button>` submits are not swallowed; Playwright loads the same HTML
 * without a sandbox so those clicks already worked there.
 */
export const CANVAS_PREVIEW_SANDBOX = "allow-scripts allow-forms allow-modals allow-pointer-lock";

/**
 * HTTP canvas on CANVAS_PREVIEW_HOST. allow-same-origin is required for
 * `<script type="module">` (Three.js, vendored kits). Only use when the iframe
 * URL origin is that preview host, not the control plane.
 */
export const CANVAS_HTTP_ISOLATED_SANDBOX = `${CANVAS_PREVIEW_SANDBOX} allow-same-origin`;

export function canvasIframeSandbox(isolatedHttp: boolean): string {
  return isolatedHttp ? CANVAS_HTTP_ISOLATED_SANDBOX : CANVAS_PREVIEW_SANDBOX;
}

export function hostnameFromHostHeader(host: string | undefined): string {
  if (!host?.trim()) return "";
  const raw = host.trim().toLowerCase();
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 0 ? raw.slice(1, end) : raw;
  }
  return raw.split(":")[0] ?? "";
}

export function isCanvasPreviewHost(host: string | undefined): boolean {
  return hostnameFromHostHeader(host) === CANVAS_PREVIEW_HOST;
}

/** True when this response is the isolated canvas origin, not the operator UI. */
export function isCanvasPreviewUrl(href: string): boolean {
  try {
    return new URL(href).hostname === CANVAS_PREVIEW_HOST;
  } catch {
    return false;
  }
}

export function isCanvasFilesPath(path: string): boolean {
  return /^\/api\/sessions\/[^/]+\/canvas-files(?:\/|$)/.test(path);
}

/** Token-gated Games play page. GET only; not the rest of /api. */
export function isGamePlayPath(path: string): boolean {
  return /^\/play\/[A-Za-z0-9_-]+(?:\/|$)/.test(path);
}

/**
 * Point HTTP canvases at CANVAS_PREVIEW_HOST so ES modules run without giving
 * the untrusted page the operator origin. LAN / phone origins cannot isolate.
 */
export function isolateCanvasFrameOrigin(parentOrigin: string): string | undefined {
  try {
    const url = new URL(parentOrigin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (!isLoopbackHost(url.hostname)) return undefined;
    if (url.hostname === CANVAS_PREVIEW_HOST) return undefined;
    url.hostname = CANVAS_PREVIEW_HOST;
    return url.origin;
  } catch {
    /* ignore */
  }
  return undefined;
}

export function canvasHttpFrameSrc(
  path: string,
  parentOrigin: string,
): { src: string; isolated: boolean } {
  const origin = isolateCanvasFrameOrigin(parentOrigin);
  if (!origin) return { src: path, isolated: false };
  return { src: `${origin}${path}`, isolated: true };
}

/** Runner that accepts painted canvas HTML via postMessage and assigns it to a nested srcdoc. */
export function canvasFrameHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:transparent}
</style>
</head>
<body>
<iframe id="c" sandbox="${CANVAS_PREVIEW_SANDBOX}" title="Canvas"></iframe>
<script>
(function(){
  var frame = document.getElementById("c");
  window.addEventListener("message", function(e){
    var data = e.data;
    if (data && data.type === "${CANVAS_FRAME_HTML_TYPE}" && typeof data.html === "string") {
      frame.srcdoc = data.html;
      return;
    }
    if (e.source === frame.contentWindow) {
      try { parent.postMessage(data, "*"); } catch (err) {}
      return;
    }
    try { frame.contentWindow.postMessage(data, "*"); } catch (err) {}
  });
  try { parent.postMessage({ type: "${CANVAS_FRAME_READY_TYPE}" }, "*"); } catch (err) {}
})();
</script>
</body>
</html>`;
}

export function redactKnownSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(
      new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`),
      "••••",
    );
  }
  return out;
}

export function redactText(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("••••");
  }
  out = redactKnownSecrets(out);
  return out
    .replace(/https?:\/\/[^/\s"'@]+@/gi, "https://••••@")
    .replace(/AUTHORIZATION:\s*Basic\s+\S+/gi, "AUTHORIZATION: Basic ••••");
}

function listingLinePath(name: string, line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  if (name === "glob") return trimmed;
  if (name === "grep") {
    const match = trimmed.match(/^(.+?)[-:]\d+[-:]/) ?? trimmed.match(/^(.+?)[-:]\d+$/);
    return match?.[1] ?? trimmed;
  }
  if (name === "file_list") {
    const parts = trimmed.split(/\s+/);
    return parts[parts.length - 1];
  }
  return undefined;
}

/** Drop grep/glob/file_list hits whose path is a credential file. */
export function stripSensitiveListing(name: string, output: string): string {
  if (name !== "grep" && name !== "glob" && name !== "file_list") return output;
  return output
    .split(/\r?\n/)
    .filter((line) => {
      if (!line.trim()) return true;
      const path = listingLinePath(name, line);
      return !path || !isSensitivePath(path);
    })
    .join("\n");
}
