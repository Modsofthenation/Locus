import {
  clusterChatThread,
  guestLabel,
  isHiddenChatMessage,
  operatorVisibleText,
  sessionRuntime,
  showThoughtTraces,
  toolChipLabel,
  toolChipStatus,
  turnToolCalls,
  type AgentSession,
  type ChatMessage,
} from "@locus/shared";
import { formatMarkdown } from "./markdown";

export type ChatExportFormat = "html" | "pdf";

const EXPORT_STYLES = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px 28px 48px;
  font: 15px/1.5 ui-sans-serif, system-ui, sans-serif;
  color: #1a1d21;
  background: #f6f4ef;
}
header { margin: 0 auto 28px; max-width: 760px; }
h1 { margin: 0 0 6px; font-size: 1.6rem; letter-spacing: -0.02em; }
.meta { margin: 0; color: #5c6570; font-size: 0.88rem; }
.thread { margin: 0 auto; max-width: 760px; display: grid; gap: 16px; }
.msg {
  background: #fff;
  border: 1px solid #e4e0d8;
  border-radius: 12px;
  padding: 14px 16px 16px;
}
.msg.user { border-left: 3px solid #3b6d9a; }
.msg.assistant { border-left: 3px solid #c47b2b; }
.msg.system { border-left: 3px solid #6b7280; }
.who {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.78rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #5c6570;
}
.who time { font-weight: 500; text-transform: none; letter-spacing: 0; }
.steer {
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8a4b12;
}
.bubble :first-child { margin-top: 0; }
.bubble :last-child { margin-bottom: 0; }
.bubble p, .bubble ul, .bubble ol, .bubble pre, .bubble table { margin: 0.65em 0; }
.bubble pre, .md-code {
  overflow: auto;
  padding: 10px 12px;
  border-radius: 8px;
  background: #1a1d21;
  color: #f4efe6;
  font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.bubble code {
  font: 0.92em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.bubble a { color: #1d4f7a; }
.md-mention {
  color: #1d4f7a;
  font-weight: 650;
  background: #d9e7f3;
  border-radius: 6px;
  padding: 0.08em 0.4em;
}
.md-paste-chip {
  color: #1d4f7a;
  font-weight: 650;
  background: #d9e7f3;
  border-radius: 6px;
  padding: 0.08em 0.4em;
}
.tools { margin: 10px 0 0; padding: 0; list-style: none; }
.tools li {
  margin: 4px 0 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: #f3efe6;
  font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #3a414a;
}
.thinking { margin: 8px 0 0; color: #5c6570; font-size: 0.88rem; }
.thinking summary { cursor: pointer; }
.thinking pre {
  margin: 6px 0 0;
  padding: 8px 10px;
  border-left: 2px solid #e4e0d8;
  white-space: pre-wrap;
  font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #5c6570;
}
.meta-line { margin: 8px 0 0; color: #5c6570; font-size: 0.85rem; }
.shot { display: block; max-width: 100%; margin-top: 10px; border-radius: 8px; }
.empty { margin: 0 auto; max-width: 760px; color: #5c6570; }
@page { margin: 16mm; }
@media print {
  body { background: #fff; padding: 0; }
  .msg { break-inside: avoid; box-shadow: none; }
}
`.trim();

export function chatExportFileName(title: string, ext: ChatExportFormat): string {
  const base = title.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "chat";
  return `${base}.${ext}`;
}

export function canExportChat(messages: ChatMessage[] | undefined): boolean {
  return (messages ?? []).some((message) => !isHiddenChatMessage(message));
}

export function formatExportStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

const SAFE_DATA_BASE64 = /^[A-Za-z0-9+/]+=*$/;
const SAFE_IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/i;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function whoLabel(role: ChatMessage["role"]): string {
  if (role === "user") return "You";
  if (role === "system") return "Locus";
  return "Agent";
}

function sessionMeta(
  session: Pick<AgentSession, "os" | "runtime" | "dockerImage" | "model">,
): string {
  const runtime = sessionRuntime(session);
  const place =
    runtime === "host"
      ? "Host"
      : runtime === "docker"
        ? (session.dockerImage ?? "Docker")
        : guestLabel(session.os);
  return [session.model.trim(), place].filter(Boolean).join(" · ");
}

function isBlankAssistant(message: ChatMessage, tools: ChatMessage[], traces = true): boolean {
  return (
    message.role === "assistant" &&
    !message.content.trim() &&
    (!traces || !message.thinking?.trim()) &&
    !turnToolCalls(message, tools).length &&
    !message.attachments?.length &&
    !message.screenshotBase64 &&
    !message.screenshotName &&
    !message.artifactName &&
    !message.recordingName
  );
}

function renderThinking(message: ChatMessage): string {
  const text = message.thinking?.trim();
  if (!text) return "";
  return `<details class="thinking"><summary>Thought</summary><pre>${escapeHtml(text)}</pre></details>`;
}

function renderTools(assistant: ChatMessage, tools: ChatMessage[]): string {
  const calls = turnToolCalls(assistant, tools);
  if (!calls.length) return "";
  const items = calls.map((call) => {
    const label = toolChipLabel(call.name, call.arguments ?? {}, call.result, call.error);
    const status = toolChipStatus(call);
    return `<li>${escapeHtml(label)}${status ? ` · ${escapeHtml(status)}` : ""}</li>`;
  });
  return `<ul class="tools">${items.join("")}</ul>`;
}

function renderExtras(message: ChatMessage): string {
  const out: string[] = [];
  if (message.screenshotBase64) {
    const mime = message.screenshotMime || "image/png";
    const raw = message.screenshotBase64.replace(/\s/g, "");
    if (SAFE_IMAGE_MIME.test(mime) && SAFE_DATA_BASE64.test(raw)) {
      out.push(
        `<img class="shot" alt="${escapeHtml(message.screenshotName ?? "Screenshot")}" src="data:${mime};base64,${raw}">`,
      );
    } else if (message.screenshotName) {
      out.push(`<p class="meta-line">Screenshot · ${escapeHtml(message.screenshotName)}</p>`);
    }
  } else if (message.screenshotName) {
    out.push(`<p class="meta-line">Screenshot · ${escapeHtml(message.screenshotName)}</p>`);
  }
  if (message.attachments?.length) {
    out.push(
      `<p class="meta-line">Attached · ${message.attachments.map((item) => escapeHtml(item.name)).join(", ")}</p>`,
    );
  }
  if (message.artifactName) {
    out.push(`<p class="meta-line">Artifact · ${escapeHtml(message.artifactName)}</p>`);
  }
  if (message.recordingName) {
    out.push(`<p class="meta-line">Recording · ${escapeHtml(message.recordingName)}</p>`);
  }
  return out.join("");
}

export function exportChatHtml(
  session: Pick<
    AgentSession,
    "title" | "model" | "os" | "runtime" | "dockerImage" | "messages" | "createdAt" | "surface"
  >,
  opts?: { renderMarkdown?: (text: string) => string; exportedAt?: string },
): string {
  const traces = showThoughtTraces({ surface: session.surface });
  const renderMarkdown = opts?.renderMarkdown ?? formatMarkdown;
  const exportedAt = opts?.exportedAt ?? new Date().toISOString();
  const title = session.title.trim() || "Chat";
  const blocks = clusterChatThread(session.messages.filter((row) => !isHiddenChatMessage(row)));
  const body = blocks
    .map((block) => {
      const message = block.message;
      const tools = block.kind === "turn" ? block.tools : [];
      if (isBlankAssistant(message, tools, traces)) return "";
      const role = message.role === "tool" ? "assistant" : message.role;
      const visible = operatorVisibleText(message.role, message.content);
      const bubble = visible.trim() ? `<div class="bubble">${renderMarkdown(visible)}</div>` : "";
      const steer = message.steer ? `<span class="steer">Steer</span>` : "";
      return `<section class="msg ${role}">
  <div class="who">${escapeHtml(whoLabel(message.role))}${steer}<time datetime="${escapeHtml(message.createdAt)}">${escapeHtml(formatExportStamp(message.createdAt))}</time></div>
  ${traces ? renderThinking(message) : ""}
  ${bubble}
  ${renderTools(message, tools)}
  ${renderExtras(message)}
</section>`;
    })
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none';">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_STYLES}</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${escapeHtml(sessionMeta(session))} · Started ${escapeHtml(formatExportStamp(session.createdAt))} · Exported ${escapeHtml(formatExportStamp(exportedAt))}</p>
</header>
${body ? `<div class="thread">\n${body}\n</div>` : `<p class="empty">No messages in this chat.</p>`}
</body>
</html>
`;
}

export function downloadTextFile(contents: string, filename: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function printHtmlDocument(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => iframe.remove();
  win.addEventListener("afterprint", cleanup);
  try {
    win.focus();
    win.print();
  } catch {
    cleanup();
  }
}

export function exportSessionChat(session: AgentSession, format: ChatExportFormat): void {
  const html = exportChatHtml(session);
  if (format === "html") {
    downloadTextFile(html, chatExportFileName(session.title, "html"), "text/html;charset=utf-8");
    return;
  }
  printHtmlDocument(html);
}
