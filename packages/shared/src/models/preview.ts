import { withAssetChromeHook } from "./assetCanvas.js";
import { withGameChromeHook, withGameFeelCss } from "./gameCanvas.js";
import { withPlayBooth } from "./gameStudio.js";
import type { DesignTune } from "./designTune.js";
import type { DesignComment } from "./designComment.js";

export const PREFERRED_PREVIEW_PORTS = [
  5173, 4173, 3000, 3001, 8080, 8000, 5000, 4321, 4000, 80, 443,
];

/** SSH, Docker, the Locus control plane, and other non-HTTP listeners. */
export const BLOCKED_PREVIEW_PORTS = new Set([
  22, 53, 111, 139, 445, 2375, 2376, 3999, 5353, 5900, 5901, 7420, 9222,
]);

export interface SessionPreview {
  port: number;
  path?: string;
}

export interface SessionPreviewStatus {
  ports: number[];
  active?: {
    port: number;
    path: string;
    url: string;
  };
}

export function parsePreviewPort(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 65535) return undefined;
  if (BLOCKED_PREVIEW_PORTS.has(n)) return undefined;
  return n;
}

export function sanitizePreviewPath(raw?: string): string {
  let path = (raw ?? "/").trim() || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (path.includes("..")) return "/";
  return path.slice(0, 512);
}

export function parseSessionPreview(value: unknown): SessionPreview | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const port = parsePreviewPort(raw.port);
  if (!port) return undefined;
  const path = typeof raw.path === "string" ? sanitizePreviewPath(raw.path) : undefined;
  return path && path !== "/" ? { port, path } : { port };
}

export function pickPreviewPort(ports: readonly number[], preferred?: number): number | undefined {
  if (preferred && ports.includes(preferred)) return preferred;
  for (const port of PREFERRED_PREVIEW_PORTS) {
    if (ports.includes(port)) return port;
  }
  return ports.slice().sort((a, b) => a - b)[0];
}

export function uniquePreviewPorts(ports: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const port of ports) {
    const parsed = parsePreviewPort(port);
    if (!parsed || seen.has(parsed)) continue;
    seen.add(parsed);
    out.push(parsed);
  }
  return out.sort((a, b) => a - b);
}

/** Parse `/proc/net/tcp` or `/proc/net/tcp6` and return LISTEN ports (state 0A). */
export function parseProcNetTcp(text: string): number[] {
  const ports: number[] = [];
  for (const line of text.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || cols[0] === "sl") continue;
    if (cols[3] !== "0A") continue;
    const local = cols[1] ?? "";
    const hex = local.split(":")[1];
    if (!hex) continue;
    const port = Number.parseInt(hex, 16);
    if (Number.isInteger(port)) ports.push(port);
  }
  return uniquePreviewPorts(ports);
}

const PORT_FLAG = /(?:--port|-p|port)\s*=?\s*(\d{2,5})\b/i;
const HOST_PORT = /(?:https?:\/\/)?(?:0\.0\.0\.0|127\.0\.0\.1|localhost):(\d{2,5})\b/i;
const HTTP_SERVER = /http\.server(?:\s+(\d{2,5}))?/i;
const ENV_PORT = /\bPORT=(\d{2,5})\b/;

export function guessListenPorts(command: string): number[] {
  const text = command.trim();
  if (!text) return [];
  const found: number[] = [];
  const flag = text.match(PORT_FLAG);
  if (flag?.[1]) found.push(Number(flag[1]));
  const host = text.match(HOST_PORT);
  if (host?.[1]) found.push(Number(host[1]));
  const env = text.match(ENV_PORT);
  if (env?.[1]) found.push(Number(env[1]));
  const http = text.match(HTTP_SERVER);
  if (http) found.push(http[1] ? Number(http[1]) : 8000);
  if (/\bvite\b/.test(text) && !found.length) found.push(5173);
  if (/\bnext(\s+dev)?\b/.test(text) && !found.length) found.push(3000);
  return uniquePreviewPorts(found);
}

const PICK_HOOK = `<script data-locus-pick-hook>
(function(){
  document.addEventListener("click", function(e){
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    if (!el || !el.tagName) return;
    parent.postMessage({
      type: "locus-design-pick",
      tag: String(el.tagName).toLowerCase(),
      text: String(el.innerText || "").trim().slice(0, 80),
      id: el.id || "",
      className: typeof el.className === "string" ? el.className : ""
    }, "*");
  }, true);
})();
</script>`;

const EDIT_HOOK = `<script data-locus-edit-hook>
(function(){
  var allow = /^(H[1-6]|P|SPAN|A|BUTTON|LABEL|LI|TD|TH|FIGCAPTION|DT|DD|STRONG|EM|SMALL|LEGEND)$/;
  document.addEventListener("click", function(e){
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    if (!el || !el.tagName || el.isContentEditable) return;
    if (!allow.test(el.tagName)) return;
    if (el.closest("script,style,textarea")) return;
    el.contentEditable = "true";
    el.focus();
    function done(){
      el.removeEventListener("blur", done);
      el.contentEditable = "false";
      parent.postMessage({
        type: "locus-design-edit",
        tag: String(el.tagName).toLowerCase(),
        text: String(el.innerText || "").trim().slice(0, 4000),
        id: el.id || "",
        className: typeof el.className === "string" ? el.className : ""
      }, "*");
    }
    el.addEventListener("blur", done);
  }, true);
})();
</script>`;

export function withPickHook(html: string): string {
  if (html.includes("data-locus-pick-hook")) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${PICK_HOOK}</body>`);
  return `${html}${PICK_HOOK}`;
}

export function withEditHook(html: string): string {
  if (html.includes("data-locus-edit-hook")) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${EDIT_HOOK}</body>`);
  return `${html}${EDIT_HOOK}`;
}

export function withPinHook(html: string, pins: DesignComment[] = []): string {
  const rows = pins
    .filter((pin) => pin.selector.trim())
    .slice(0, 24)
    .map((pin, index) => ({
      id: pin.id || String(index + 1),
      selector: pin.selector.slice(0, 200),
      text: (pin.text ?? "").slice(0, 80),
      n: index + 1,
    }));
  if (!rows.length) return html;
  if (html.includes("data-locus-pin-hook")) return html;
  const payload = JSON.stringify(rows).replace(/</g, "\\u003c");
  const hook = `<script data-locus-pin-hook>
(function(){
  var pins = ${payload};
  function place(){
    pins.forEach(function(pin){
      try {
        var el = document.querySelector(pin.selector);
        if (!el || el.querySelector("[data-locus-pin]")) return;
        var cs = window.getComputedStyle(el);
        if (cs.position === "static") el.style.position = "relative";
        var mark = document.createElement("span");
        mark.setAttribute("data-locus-pin", pin.id);
        mark.textContent = String(pin.n);
        mark.title = pin.text || pin.selector;
        mark.style.cssText = "position:absolute;top:-8px;right:-8px;z-index:2147483646;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#e08a4c;color:#1a120c;font:600 11px/18px ui-sans-serif,system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 0 0 2px #fff";
        el.appendChild(mark);
      } catch (err) {}
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", place);
  else place();
})();
</script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${hook}</body>`);
  return `${html}${hook}`;
}

export const CANVAS_SEQ_ATTR = "data-locus-canvas-seq";

const PREVIEW_GUARD = `<script data-locus-preview-guard>
(function(){
  var tag = document.currentScript;
  var live = tag && tag.getAttribute("data-locus-live-pointers") === "1";
  if (!live) {
    function stop(e){ e.stopImmediatePropagation(); }
    var types = ["mousemove", "pointermove", "touchmove", "deviceorientation"];
    for (var i = 0; i < types.length; i++) {
      window.addEventListener(types[i], stop, true);
      document.addEventListener(types[i], stop, true);
    }
  }
  try { void window.localStorage.getItem("locus-probe"); }
  catch (err) {
    function storage(){
      var mem = {};
      return {
        getItem: function(k){ return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function(k, v){ mem[k] = String(v); },
        removeItem: function(k){ delete mem[k]; },
        clear: function(){ mem = {}; },
        key: function(i){ return Object.keys(mem)[i] || null; },
        get length(){ return Object.keys(mem).length; }
      };
    }
    try {
      Object.defineProperty(window, "localStorage", { value: storage(), configurable: true });
      Object.defineProperty(window, "sessionStorage", { value: storage(), configurable: true });
    } catch (e2) {}
  }
  var seq = tag && tag.getAttribute("${CANVAS_SEQ_ATTR}");
  function ping(){
    try {
      parent.postMessage({ type: "locus-canvas-ready", seq: seq ? Number(seq) : 0 }, "*");
    } catch (err) {}
  }
  ping();
  setTimeout(ping, 0);
  setTimeout(ping, 32);
})();
</script>`;

function insertAfterOpenTag(html: string, tag: RegExp, snippet: string): string | undefined {
  const match = html.match(tag);
  if (!match || match.index == null) return undefined;
  const at = match.index + match[0].length;
  return `${html.slice(0, at)}${snippet}${html.slice(at)}`;
}

function stampCanvasSeqAttr(html: string, seq: number): string {
  const stamped = `data-locus-preview-guard ${CANVAS_SEQ_ATTR}="${seq}"`;
  if (html.includes(`${CANVAS_SEQ_ATTR}=`)) {
    return html.replace(new RegExp(`${CANVAS_SEQ_ATTR}="\\d+"`), `${CANVAS_SEQ_ATTR}="${seq}"`);
  }
  if (html.includes("data-locus-preview-guard")) {
    return html.replace("data-locus-preview-guard", stamped);
  }
  return html;
}

/** Stop mouse-follow scripts and post locus-canvas-ready. Injected on srcdoc and HTTP canvas-files. */
export function withCanvasPreviewGuard(
  html: string,
  seq?: number,
  opts?: { livePointers?: boolean },
): string {
  if (!html.trim()) return html;
  let out = html;
  if (!out.includes("data-locus-preview-guard")) {
    out =
      insertAfterOpenTag(out, /<html\b[^>]*>/i, PREVIEW_GUARD) ??
      insertAfterOpenTag(out, /<head\b[^>]*>/i, PREVIEW_GUARD) ??
      `${PREVIEW_GUARD}${out}`;
  }
  if (opts?.livePointers && !out.includes("data-locus-live-pointers=")) {
    out = out.replace(
      "data-locus-preview-guard",
      'data-locus-preview-guard data-locus-live-pointers="1"',
    );
  }
  if (seq != null && Number.isFinite(seq))
    out = stampCanvasSeqAttr(out, Math.max(0, Math.floor(seq)));
  return out;
}

export type CanvasFileDecorate = {
  pick?: boolean;
  edit?: boolean;
  seq?: number;
  /** Inject the mousemove guard (default true). Coding preview-http should pass false. */
  guard?: boolean;
  game?: boolean;
  assets?: boolean;
  tune?: DesignTune;
  pins?: DesignComment[];
  /** When set, the play-link page gets a note form that posts back to /play/:token/booth. */
  playToken?: string;
};

export function decorateCanvasHtml(html: string, opts?: CanvasFileDecorate): string {
  let out =
    opts?.guard === false
      ? html
      : withCanvasPreviewGuard(html, opts?.seq, {
          livePointers: Boolean(opts?.game || opts?.assets),
        });
  if (opts?.game) {
    out = withGameFeelCss(out, opts.tune);
    out = withGameChromeHook(out);
  }
  if (opts?.playToken) out = withPlayBooth(out, opts.playToken);
  if (opts?.assets) out = withAssetChromeHook(out);
  if (opts?.pins?.length) out = withPinHook(out, opts.pins);
  if (opts?.edit) return withEditHook(out);
  if (opts?.pick) return withPickHook(out);
  return out;
}

export function isPreviewTargetHost(host: string): boolean {
  const hostname = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "::1") return true;
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return false;
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  if (hostname.startsWith("fd") || hostname.startsWith("fe80:")) return true;
  return false;
}

export function previewProxyPath(sessionId: string, port: number, path = "/"): string {
  const suffix = sanitizePreviewPath(path);
  return `/api/sessions/${encodeURIComponent(sessionId)}/preview-http/${port}${suffix === "/" ? "/" : suffix}`;
}
