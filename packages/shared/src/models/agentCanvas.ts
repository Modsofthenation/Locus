import { canonicalToolName } from "./toolChip.js";
import { isBoardSession, isCanvasSession, isProjectSession, type AgentSession } from "./session.js";

/** Metadata stored on the session. HTML lives beside the session, not in the repo. */
export interface AgentCanvasRef {
  id: string;
  title: string;
  updatedAt: string;
}

export const AGENT_CANVAS_HTML_MAX = 120_000;
export const AGENT_CANVAS_MAX = 8;
export const AGENT_CANVAS_TITLE_MAX = 80;

export const AGENT_CANVAS_TOOLS = ["canvas_write", "canvas_read"] as const;
export type AgentCanvasToolName = (typeof AGENT_CANVAS_TOOLS)[number];

export function isAgentCanvasToolName(name: string): name is AgentCanvasToolName {
  const canon = canonicalToolName(name);
  return (AGENT_CANVAS_TOOLS as readonly string[]).includes(canon);
}

/**
 * Coding and review chats can leave a durable HTML canvas beside the thread.
 * Design, Games, and Assets already paint `/workspace/index.html`. Board and
 * Project chats have their own documents.
 */
export function sessionOffersAgentCanvas(session: { kind?: AgentSession["kind"] }): boolean {
  return !isCanvasSession(session) && !isBoardSession(session) && !isProjectSession(session);
}

/** Empty allowlist means the full catalog. A custom list must name canvas_write. */
export function sessionAdvertisesAgentCanvas(session: {
  kind?: AgentSession["kind"];
  allowedTools?: string[];
}): boolean {
  if (!sessionOffersAgentCanvas(session)) return false;
  const allow = session.allowedTools;
  if (!allow?.length) return true;
  return allow.includes("canvas_write");
}

export const AGENT_CANVAS_PROMPT = [
  "You can build a canvas beside the chat with canvas_write. It is a durable HTML document the operator reopens — a report, table, or dashboard — not a code fix, a drafted message, or a file in the repo.",
  "html is one self-contained document: inline CSS and script only. No fetch, WebSocket, remote scripts, styles, images, or fonts. Embed data in the document.",
  "Pass title and html. Pass id to replace a canvas you already wrote; omit id to create one. canvas_read returns the current html.",
  "After it lands, name the canvas title in chat so the operator knows it is open beside the thread.",
].join(" ");

const CANVAS_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:;";

/** Document served in the operator iframe. Stored HTML stays free of this tag. */
export function agentCanvasDocument(html: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${CANVAS_CSP}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (head) => `${head}${csp}`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${csp}</head><body>${html}</body></html>`;
}

export function slugAgentCanvasId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function newestAgentCanvas(rows: AgentCanvasRef[] | undefined): AgentCanvasRef | undefined {
  const list = rows ?? [];
  if (!list.length) return undefined;
  return [...list]
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
    .at(-1);
}

function externalCanvasUse(html: string): string | undefined {
  if (
    /\bfetch\s*\(/.test(html) ||
    /\bXMLHttpRequest\b/.test(html) ||
    /\bnew\s+WebSocket\b/.test(html) ||
    /\bEventSource\s*\(/.test(html)
  ) {
    return "Canvases cannot use fetch, XHR, WebSocket, or EventSource. Embed the data in the document.";
  }
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) {
    return "Inline scripts only. Do not set a script src.";
  }
  if (/<iframe\b/i.test(html)) return "Do not embed iframes.";
  if (/@import\b/i.test(html)) return "Do not use CSS @import. Inline the CSS.";
  if (/<(?:link|img|video|audio|source)\b[^>]*(?:href|src)\s*=\s*["'](?!data:|blob:)/i.test(html)) {
    return "Images, fonts, and styles must be inline or data URLs. No remote or relative loads.";
  }
  return undefined;
}

function ensureCanvasDocument(html: string, title: string): string {
  if (/<html\b/i.test(html)) return html;
  const safe = title.replace(/[<>&"]/g, "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safe}</title></head><body>\n${html}\n</body></html>`;
}

export type PreparedAgentCanvas =
  { ok: true; id: string; title: string; html: string } | { ok: false; error: string };

export function prepareAgentCanvasWrite(args: Record<string, unknown>): PreparedAgentCanvas {
  const titleRaw = typeof args.title === "string" ? args.title.trim().replace(/\s+/g, " ") : "";
  if (!titleRaw) return { ok: false, error: "canvas_write needs a title." };
  const title = titleRaw.slice(0, AGENT_CANVAS_TITLE_MAX);
  const htmlRaw = typeof args.html === "string" ? args.html.trim() : "";
  if (!htmlRaw)
    return { ok: false, error: "canvas_write needs html — the full document, not a description." };
  if (htmlRaw.length > AGENT_CANVAS_HTML_MAX) {
    return {
      ok: false,
      error: `Canvas html is ${htmlRaw.length} characters. Keep it under ${AGENT_CANVAS_HTML_MAX}.`,
    };
  }
  const blocked = externalCanvasUse(htmlRaw);
  if (blocked) return { ok: false, error: blocked };
  const requested = typeof args.id === "string" ? slugAgentCanvasId(args.id) : "";
  const id = requested || slugAgentCanvasId(title) || "canvas";
  return { ok: true, id, title, html: ensureCanvasDocument(htmlRaw, title) };
}

export function upsertAgentCanvas(
  rows: AgentCanvasRef[] | undefined,
  next: AgentCanvasRef,
): { ok: true; canvases: AgentCanvasRef[] } | { ok: false; error: string } {
  const canvases = [...(rows ?? [])];
  const index = canvases.findIndex((row) => row.id === next.id);
  if (index >= 0) {
    canvases[index] = next;
    return { ok: true, canvases };
  }
  if (canvases.length >= AGENT_CANVAS_MAX) {
    return {
      ok: false,
      error: `This chat already has ${AGENT_CANVAS_MAX} canvases. Pass id to update one.`,
    };
  }
  canvases.push(next);
  return { ok: true, canvases };
}

export function resolveAgentCanvasId(
  rows: AgentCanvasRef[] | undefined,
  raw: unknown,
): AgentCanvasRef | undefined {
  const list = rows ?? [];
  if (typeof raw === "string" && raw.trim()) {
    const id = slugAgentCanvasId(raw);
    return list.find((row) => row.id === id || row.id === raw.trim());
  }
  return newestAgentCanvas(list);
}
