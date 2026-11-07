import { DESIGN_CANVAS_PATH } from "./recipes.js";
import { withPaletteCss, type DesignPalette } from "./designPalette.js";
import { stripHtmlComments } from "./htmlMarkup.js";
import { canonicalToolName } from "./toolChip.js";
import { ASSET_POSE_PRESETS } from "./assetCanvas.js";
import { HOST_FALLBACK_ATTR } from "./hostFallback.js";

export { HOST_FALLBACK_ATTR, looksHostFallbackCanvas } from "./hostFallback.js";

const CANVAS_NAMES = new Set(["index.html", "index.htm"]);
const CANVAS_CHAT_HTML_MIN = 400;
const WRITE_BODY_KEYS = ["content", "contents", "fileText", "streamContent"] as const;

export function isDesignCanvasPath(path?: string): boolean {
  if (!path?.trim()) return false;
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const base = normalized.split("/").pop()?.toLowerCase() ?? "";
  return CANVAS_NAMES.has(base);
}

/** Cursor CLI often writes `{workspaceRoot}/workspace/index.html` instead of the canvas root. */
export const MISPLACED_DESIGN_CANVAS_RELS = [
  "workspace/index.html",
  "workspace/index.htm",
] as const;

export function isMisplacedDesignCanvasRel(rel?: string): boolean {
  if (!rel?.trim()) return false;
  const normalized = rel.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return MISPLACED_DESIGN_CANVAS_RELS.some(
    (row) => normalized === row || normalized.endsWith(`/${row}`),
  );
}

function htmlTagBalance(html: string, tag: string): number {
  const open = html.match(new RegExp(`<${tag}\\b[^>]*>`, "gi"))?.length ?? 0;
  const close = html.match(new RegExp(`</${tag}\\s*>`, "gi"))?.length ?? 0;
  return open - close;
}

/**
 * True when /workspace/index.html looks like a finished document.
 * Truncated 32k file_write payloads often stop mid-<script> with no </html>.
 */
export function isCompleteHtmlDocument(html: string): boolean {
  const text = stripHtmlComments(html.trim());
  if (!text) return false;
  if (htmlTagBalance(text, "script") > 0) return false;
  if (htmlTagBalance(text, "style") > 0) return false;
  if (/<!doctype\s+html|<html\b/i.test(text)) return /<\/html>/i.test(text);
  return true;
}

const CANVAS_PLACEHOLDER_RE = /\/\*(?:__GAME__|__C\d+__)\*\//;

function scriptInnerText(html: string): string {
  const bodies: string[] = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) bodies.push(match[1] ?? "");
  return bodies.join("\n");
}

function canvasScriptIsStub(html: string): boolean {
  if (!/<canvas\b/i.test(html)) return false;
  const inner = scriptInnerText(html);
  if (CANVAS_PLACEHOLDER_RE.test(html)) return true;
  const code = inner
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .trim();
  return code.length < 24;
}

/** Relative raster / attachment URLs that resolve via canvas-files, not data: or https. */
export function canvasLoadsRelativeRaster(html?: string | null): boolean {
  const text = html ?? "";
  if (!text.trim()) return false;
  if (/\.locus-attachments\//i.test(text)) return true;
  if (/<img\b[^>]*\bsrc\s*=\s*["'](?:\.\/|\.\.\/|\/)?(?!https?:|data:|blob:)[^"']+/i.test(text)) {
    return true;
  }
  return /["'](?:\.\/|\.\.\/)?(?!https?:|data:|blob:)[^"']+\.(?:png|jpe?g|gif|webp|bmp|svg)["']/i.test(
    text,
  );
}

/** Pixel reads that throw when the source image is cross-origin (unique-origin srcdoc). */
export function canvasReadsPixels(html?: string | null): boolean {
  return /\b(?:getImageData|toDataURL|toBlob|readPixels|texImage2D)\s*\(/.test(html ?? "");
}

/**
 * Vendored ES modules and relative scripts cannot run in a srcdoc iframe
 * (opaque origin + canvas-frame CSP has no 'self'). Relative photos also
 * taint canvas getImageData there. Serve those pages over HTTP.
 */
export function canvasNeedsHttp(html?: string | null): boolean {
  const text = html ?? "";
  if (!text.trim()) return false;
  if (/<script\b[^>]*\btype\s*=\s*["']?module\b/i.test(text)) return true;
  if (/<script\b[^>]*\btype\s*=\s*["']importmap["']/i.test(text)) return true;
  if (/\bimport\s*(?:[\w*{]|['"]\.\.?\/)/.test(text)) return true;
  if (/<script\b[^>]*\bsrc\s*=\s*["'](?:\.\/|\.\.\/|\/)?(?!https?:|data:|blob:)[^"']+/i.test(text))
    return true;
  if (/<link\b[^>]*\bhref\s*=\s*["'](?:\.\/|\.\.\/)[^"']+/i.test(text)) return true;
  if (canvasLoadsRelativeRaster(text)) return true;
  return false;
}

export function canvasFilesPreviewUrl(
  sessionId: string,
  opts?: { seq?: number; pick?: boolean; edit?: boolean },
): string {
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/canvas-files/`;
  const q: string[] = [];
  if (opts?.seq != null && Number.isFinite(opts.seq))
    q.push(`c=${Math.max(0, Math.floor(opts.seq))}`);
  if (opts?.pick) q.push("locus_pick=1");
  if (opts?.edit) q.push("locus_edit=1");
  return q.length ? `${url}?${q.join("&")}` : url;
}

/** Complete canvas that vendors ES modules / relative scripts — serve over HTTP, not srcdoc. */
export function canvasShouldServeHttp(html?: string | null): boolean {
  if (!html?.trim() || canvasHtmlIncomplete(html)) return false;
  return canvasNeedsHttp(html);
}

/** Non-empty canvas HTML that is truncated, unclosed, or a stub. Empty is not incomplete. */
export function canvasHtmlIncomplete(html?: string | null): boolean {
  const text = html?.trim();
  if (!text) return false;
  if (!isCompleteHtmlDocument(text)) return true;
  return canvasScriptIsStub(text);
}

/** Prefer a complete document over a truncated stream paint. */
export function shouldReplaceCanvasHtml(current: string | undefined, candidate: string): boolean {
  const next = candidate.trim();
  if (!next || !looksLikeHtml(next)) return false;
  const cur = current?.trim() ?? "";
  if (!cur) return true;
  const nextDone = isCompleteHtmlDocument(next);
  const curDone = isCompleteHtmlDocument(cur);
  if (nextDone && !curDone) return true;
  if (nextDone === curDone && next.length > cur.length) return true;
  return false;
}

export function looksLikeHtml(text: string): boolean {
  return /<!doctype\s+html|<html\b|<head\b|<body\b|<style\b|<div\b|<section\b|<main\b/i.test(text);
}

/** True when text is (or is streaming) a full HTML document, not a StrReplace fragment. */
export function looksLikeHtmlDocumentDraft(text: string): boolean {
  const stripped = text
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^(?:<!--[\s\S]*?-->\s*)+/, "");
  return /^(?:<!doctype\s+html|<html\b)/i.test(stripped);
}

/** Pull a complete HTML document out of chat text (fenced or raw) when the model skipped file_write. */
export function htmlDocumentFromText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const fenced = trimmed.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.search(/<!doctype\s+html|<html\b/i);
  if (start < 0) return undefined;
  let html = candidate.slice(start).trim();
  const end = html.toLowerCase().lastIndexOf("</html>");
  if (end >= 0) html = html.slice(0, end + 7);
  if (!looksLikeHtml(html) || html.length < 24) return undefined;
  return html;
}

/** If a Design file_write has a full HTML document and no path, send it to the live canvas. */
export function fillCanvasFileWritePath(
  args: Record<string, unknown>,
  opts?: { design?: boolean },
): Record<string, unknown> {
  if (!opts?.design) return args;
  const path = typeof args.path === "string" ? args.path.trim() : "";
  const content = typeof args.content === "string" ? args.content : "";
  if (path || !htmlDocumentFromText(content)) return args;
  return { ...args, path: DESIGN_CANVAS_PATH };
}

/**
 * Hide a full HTML document the model pasted into chat (keep surrounding prose).
 * Small `<html>` mentions in coding replies stay visible.
 */
export function stripHtmlDocumentFromChat(text: string): string {
  const html = htmlDocumentFromText(text);
  if (!html) return text;
  const trimmed = text.trim();
  const mostlyHtml =
    html.length >= CANVAS_CHAT_HTML_MIN && html.length / Math.max(trimmed.length, 1) >= 0.5;
  const startsAsDocument = /^(?:```(?:html)?\s*)?(?:<!doctype\s+html|<html\b)/i.test(trimmed);
  if (!mostlyHtml && !startsAsDocument) return text;
  let out = text;
  const fence = out.match(/```(?:html)?\s*[\s\S]*?```/i);
  if (fence?.[0] && htmlDocumentFromText(fence[0])) {
    out = out.replace(fence[0], "");
  } else {
    const start = out.search(/<!doctype\s+html|<html\b/i);
    if (start >= 0) {
      const close = out.toLowerCase().lastIndexOf("</html>");
      out = out.slice(0, start) + (close >= start ? out.slice(close + 7) : "");
    }
  }
  return out
    .replace(/```(?:html)?\s*```/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** File body from Write / Cursor CLI writeToolCall / editToolCall args. */
export function writeBodyFromToolArgs(args: Record<string, unknown>): string | undefined {
  for (const key of WRITE_BODY_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function looksLikeUnifiedDiff(text: string): boolean {
  return /^--- /m.test(text) && /^\+\+\+ /m.test(text);
}

/** HTML destined for the live canvas, including Cursor CLI fileText / streamContent. */
export function canvasHtmlFromToolCall(input: {
  name: string;
  arguments?: Record<string, unknown>;
  result?: string;
}): string | undefined {
  const name = canonicalToolName(input.name);
  if (name !== "file_write" && name !== "apply_patch") return undefined;
  const args = input.arguments ?? {};
  const path =
    (typeof args.path === "string" && args.path) ||
    (typeof args.target_file === "string" && args.target_file) ||
    "";
  if (path && !isDesignCanvasPath(path)) return undefined;
  const body = writeBodyFromToolArgs(args);
  const candidate = body || (typeof input.result === "string" ? input.result : "");
  if (!candidate.trim() || looksLikeUnifiedDiff(candidate)) return undefined;
  return (
    htmlDocumentFromText(candidate) ??
    (looksLikeHtmlDocumentDraft(candidate) && candidate.length >= 24 ? candidate : undefined)
  );
}

/** Recover path/content from a file_write argument blob, including truncated JSON. */
export function recoverFileWriteArgs(raw: string): { path?: string; content: string } | undefined {
  if (!raw.trim()) return undefined;
  const parsed = parseObject(raw);
  if (parsed) {
    const content = writeBodyFromToolArgs(parsed);
    if (content == null) return undefined;
    const path =
      typeof parsed.path === "string"
        ? parsed.path
        : typeof parsed.target_file === "string"
          ? parsed.target_file
          : undefined;
    return path ? { path, content } : { content };
  }
  const path = readJsonString(raw, "path", false) ?? readJsonString(raw, "target_file", false);
  let content: string | undefined;
  for (const key of WRITE_BODY_KEYS) {
    content = readJsonString(raw, key, true);
    if (content) break;
  }
  if (!content) return undefined;
  return path ? { path, content } : { content };
}

/** Pull HTML out of a streaming file_write tool-call JSON blob, even when the JSON is still incomplete. */
export function htmlFromStreamingToolArgs(name: string, raw: string): string | undefined {
  const canonical = canonicalToolName(name);
  if ((canonical !== "file_write" && canonical !== "apply_patch") || !raw.trim()) return undefined;
  const recovered = recoverFileWriteArgs(raw);
  if (!recovered) return undefined;
  if (recovered.path && !isDesignCanvasPath(recovered.path)) return undefined;
  if (looksLikeUnifiedDiff(recovered.content)) return undefined;
  if (!looksLikeHtmlDocumentDraft(recovered.content)) return undefined;
  return recovered.content;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Last-resort first draft so a Design turn never leaves the canvas blank. */
export function fallbackDesignCanvasHtml(brief: string, palette: DesignPalette): string {
  const trimmed = brief.trim().replace(/\s+/g, " ").slice(0, 400);
  const title = trimmed.split(/[.!?]/)[0]?.trim().slice(0, 72) || "First draft";
  const html = `<!doctype html>
<html lang="en" ${HOST_FALLBACK_ATTR}="design">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --font-sans: ui-sans-serif, system-ui, sans-serif; --font-size: 16px; --radius: 12px; --space: 8px; --line: color-mix(in srgb, var(--text) 14%, var(--bg)); }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: var(--font-sans); font-size: var(--font-size); background: var(--bg); color: var(--text); }
    main { max-width: 40rem; margin: 0 auto; padding: calc(var(--space) * 8); }
    .kicker { margin: 0 0 calc(var(--space) * 2); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.75rem; color: var(--muted); }
    h1 { margin: 0 0 calc(var(--space) * 3); font-size: 2rem; line-height: 1.15; }
    .lede { margin: 0 0 calc(var(--space) * 6); color: var(--muted); line-height: 1.5; }
    .cta { display: inline-block; padding: calc(var(--space) * 1.5) calc(var(--space) * 3); border-radius: var(--radius); background: var(--primary); color: var(--bg); text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <main>
    <p class="kicker">First draft</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="lede">${escapeHtml(trimmed || "A first canvas so you can iterate in chat.")}</p>
    <a class="cta" href="#next">Continue</a>
  </main>
</body>
</html>`;
  return withPaletteCss(html, palette);
}

/** Last-resort playable loop so a Games turn never leaves a splash page. */
export function fallbackGameCanvasHtml(brief: string, palette: DesignPalette): string {
  const trimmed = brief.trim().replace(/\s+/g, " ").slice(0, 160);
  const title = trimmed.split(/[.!?]/)[0]?.trim().slice(0, 48) || "Playable draft";
  const html = `<!doctype html>
<html lang="en" ${HOST_FALLBACK_ATTR}="game" data-controls="Arrows: move · Space: jump · R: restart" data-tune="gravity:20-160,jump:4-32,volume:0-100">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --font-sans: ui-sans-serif, system-ui, sans-serif; --gravity: 80; --jump: 16; --volume: 80; }
    html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font-family: var(--font-sans); overflow: hidden; }
    canvas { display: block; width: 100%; height: 100%; }
    #hud { position: fixed; left: 12px; top: 12px; font: 600 14px/1.3 var(--font-sans); }
    #hint { position: fixed; left: 12px; bottom: 12px; color: var(--muted); font-size: 12px; }
  </style>
</head>
<body>
  <div id="hud">Score <span id="score">0</span></div>
  <div id="hint">${escapeHtml(trimmed || "Arrows move · Space jump · R restart")}</div>
  <canvas id="c"></canvas>
  <script>
    const canvas = document.getElementById("c");
    const ctx = canvas.getContext("2d");
    const keys = {};
    let score = 0, dead = false, x = 80, y = 0, vy = 0, t = 0;
    const hazards = [{x: 420, y: 0}];
    function feel(){ return {
      g: Number(getComputedStyle(document.documentElement).getPropertyValue("--gravity")) || 80,
      j: Number(getComputedStyle(document.documentElement).getPropertyValue("--jump")) || 16,
    }; }
    function resize(){ canvas.width = innerWidth; canvas.height = innerHeight; y = canvas.height - 64; }
    function reset(){ score = 0; dead = false; x = 80; vy = 0; t = 0; hazards.splice(0, hazards.length, {x: 420, y: 0}); resize(); document.getElementById("score").textContent = "0"; }
    function stats(){ return { score, deaths: dead ? 1 : 0, time: Math.round(t / 60) }; }
    window.__locusGame = { reset, pause(){ dead = true; }, resume(){ if (dead) reset(); }, debug(){}, stats, mute(){}, seed(){}, replay(list){ (list||[]).forEach((code)=>keys[code]=true); } };
    addEventListener("keydown", (e)=>{ keys[e.code]=true; if (e.code==="KeyR") reset(); });
    addEventListener("keyup", (e)=>{ keys[e.code]=false; });
    addEventListener("resize", resize);
    reset();
    function tick(){
      const f = feel();
      t += 1;
      if (!dead) {
        if (keys.ArrowLeft) x -= 4;
        if (keys.ArrowRight) x += 4;
        if (keys.Space && y >= canvas.height - 64) vy = -f.j * 0.7;
        vy += f.g / 400;
        y += vy;
        if (y > canvas.height - 64) { y = canvas.height - 64; vy = 0; }
        x = Math.max(16, Math.min(canvas.width - 16, x));
        for (const h of hazards) {
          h.x -= 3 + score * 0.05;
          if (h.x < -20) { h.x = canvas.width + 40; score += 1; document.getElementById("score").textContent = String(score); }
          if (Math.abs(h.x - x) < 22 && Math.abs((canvas.height - 48) - y) < 28) dead = true;
        }
      }
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg") || "#111";
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--primary") || "#e08a4c";
      ctx.fillRect(x-12, y-24, 24, 24);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#d4c4a8";
      for (const h of hazards) ctx.fillRect(h.x-10, canvas.height-48, 20, 20);
      if (dead) { ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text") || "#fff"; ctx.font = "24px sans-serif"; ctx.fillText("Game over — R restart", 24, 80); }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  </script>
</body>
</html>`;
  return withPaletteCss(html, palette);
}

/** Last-resort studio so an Assets turn never leaves a blank canvas. */
export function fallbackAssetCanvasHtml(brief: string, palette: DesignPalette): string {
  const trimmed = brief.trim().replace(/\s+/g, " ").slice(0, 160);
  const title = trimmed.split(/[.!?]/)[0]?.trim().slice(0, 48) || "Asset studio";
  const html = `<!doctype html>
<html lang="en" ${HOST_FALLBACK_ATTR}="asset" data-tune="head:-45-45,arms:-80-80,legs:-60-60,twist:-45-45">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --font-sans: ui-sans-serif, system-ui, sans-serif; --head: 0; --arms: 0; --legs: 0; --twist: 0; --zoom: 1; }
    html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font-family: var(--font-sans); overflow: hidden; }
    #hud { position: fixed; left: 12px; top: 12px; font: 600 14px/1.3 var(--font-sans); z-index: 2; pointer-events: none; }
    #hint { position: fixed; left: 12px; bottom: 12px; color: var(--muted); font-size: 12px; z-index: 2; max-width: 70%; pointer-events: none; }
    canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
    #rig { position: absolute; width: 0; height: 0; }
  </style>
</head>
<body>
  <canvas id="stage" data-locus-asset-stage></canvas>
  <div id="rig" data-locus-asset-model></div>
  <div id="hud">Studio · <span id="clip">idle</span></div>
  <div id="hint">${escapeHtml(trimmed || "Orbit · pose sliders · attach a photo to reconstruct")}</div>
  <script>
    const PRESETS = ${JSON.stringify(ASSET_POSE_PRESETS)};
    const canvas = document.getElementById("stage");
    const ctx = canvas.getContext("2d");
    const studio = {
      clip: "idle", playing: true, yaw: 0.4,
      hull: { verts: new Array(24), faces: new Array(12) },
      paint: null
    };
    window.__assetStudio = studio;
    function resize(){ canvas.width = innerWidth; canvas.height = innerHeight; }
    function pose(p){
      const root = document.documentElement.style;
      if (p.head != null) root.setProperty("--head", String(p.head));
      if (p.arms != null) root.setProperty("--arms", String(p.arms));
      if (p.legs != null) root.setProperty("--legs", String(p.legs));
      if (p.twist != null) root.setProperty("--twist", String(p.twist));
    }
    function play(name){
      studio.clip = name || "idle";
      studio.playing = true;
      document.getElementById("clip").textContent = studio.clip;
      document.documentElement.setAttribute("data-clip", studio.clip);
      const p = PRESETS[studio.clip];
      if (p) pose(p);
    }
    function cam(){
      const s = getComputedStyle(document.documentElement);
      return {
        yaw: studio.yaw + (Number(s.getPropertyValue("--twist")) || 0) * Math.PI / 180,
        pitch: (Number(s.getPropertyValue("--head")) || 0) * Math.PI / 220,
        zoom: Number(s.getPropertyValue("--zoom")) || 1,
        wireframe: document.documentElement.classList.contains("locus-wireframe")
      };
    }
    studio.cam = cam;
    studio.ctx = ctx;
    studio.resize = resize;
    function drawPlaceholder(){
      resize();
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg") || "#1c1916";
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w/2, h/2);
      ctx.scale(cam().zoom, cam().zoom * 0.92);
      ctx.rotate(cam().yaw * 0.25);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--primary") || "#c4b8a4";
      ctx.beginPath(); ctx.ellipse(0, 8, 72, 118, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    studio.paint = drawPlaceholder;
    function tick(){
      if (studio.playing) studio.yaw += 0.012;
      studio.paint();
      requestAnimationFrame(tick);
    }
    window.__locusAsset = {
      mode(m){ document.documentElement.setAttribute("data-locus-asset-mode", m || "3d"); },
      wireframe(on){ document.documentElement.classList.toggle("locus-wireframe", !!on); },
      orbit(on){ studio.playing = on !== false; },
      zoom(z){ document.documentElement.style.setProperty("--zoom", String(z)); },
      pose, play, pause(){ studio.playing = false; },
      exportGlb(){ console.log("glb"); }, exportPng(){ console.log("png"); },
      exportStl(){ console.log("stl"); }, exportTextures(){ console.log("tex"); },
      stats(){ return { mode: "3d", topology: "triangle", verts: studio.hull.verts.length, tris: studio.hull.faces.length, faces: studio.hull.faces.length, printable: false, units: "m", clip: studio.clip, playing: studio.playing }; }
    };
    addEventListener("resize", resize);
    canvas.addEventListener("pointermove", function(e){ if (e.buttons) studio.yaw += e.movementX * 0.01; });
    document.documentElement.classList.add("locus-orbit");
    resize(); tick();
  </script>
  <script type="module">
    import { reconstructFromPhoto, paintPhotoHull } from ${JSON.stringify("./vendor/reconstruct.js")};
    const studio = window.__assetStudio;
    try {
      const next = await reconstructFromPhoto("./source.png");
      if (next && next.verts && next.verts.length) {
        studio.hull = next;
        studio.paint = function(){
          studio.resize();
          paintPhotoHull(studio.ctx, studio.hull, studio.cam());
        };
      }
    } catch (err) { /* keep the placeholder hull until a photo lands */ }
  </script>
</body>
</html>`;
  return withPaletteCss(html, palette);
}

function parseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    /* incomplete */
  }
  return undefined;
}

function readJsonString(raw: string, key: string, partial: boolean): string | undefined {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"`));
  if (!match || match.index == null) return undefined;
  const start = match.index + match[0].length;
  let escaped = "";
  let complete = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next == null) break;
      escaped += ch + next;
      i += 1;
      continue;
    }
    if (ch === '"') {
      complete = true;
      break;
    }
    escaped += ch;
  }
  if (!complete && !partial) return undefined;
  return unescapeJsonFragment(escaped);
}

function unescapeJsonFragment(escaped: string): string {
  let out = "";
  for (let i = 0; i < escaped.length; i++) {
    const ch = escaped[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = escaped[i + 1];
    if (next == null) break;
    i += 1;
    switch (next) {
      case '"':
      case "\\":
      case "/":
        out += next;
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "u": {
        const hex = escaped.slice(i + 1, i + 5);
        if (hex.length < 4 || /[^0-9a-fA-F]/.test(hex)) return out;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
        break;
      }
      default:
        out += next;
    }
  }
  return out;
}
