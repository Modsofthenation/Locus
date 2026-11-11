import { parsePrCard } from "@locus/shared";
import { highlightSource } from "./highlight";

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;
const MAX_NEST = 16;

// NUL-byte sentinels stash generated HTML while later passes run over the
// markup. Held as data instead of regex literals so ESLint's
// no-control-regex rule does not flag the intentional control characters.
const SENTINEL_END = "\u0000";
const SENTINEL_I = `${SENTINEL_END}I`;
const SENTINEL_F = `${SENTINEL_END}F`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function safeHttpUrl(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/^<|>$/g, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  if (parsed.username || parsed.password) return undefined;
  return trimmed;
}

function inline(text: string): string {
  const slots: string[] = [];
  const stash = (html: string): string => {
    slots.push(html);
    return `${SENTINEL_I}${slots.length - 1}${SENTINEL_END}`;
  };
  const withCode = text.replace(/`([^`]+)`/g, (_m, code: string) =>
    stash(`<code>${escapeHtml(code)}</code>`),
  );
  let html = escapeHtml(withCode);
  html = html.replace(/\[\[paste:([^\]]+)\]\]/g, (_m, name: string) =>
    stash(`<span class="md-paste-chip">${escapeHtml(name)}</span>`),
  );
  html = html.replace(
    /([^\s<]+) at \/workspace\/\.locus-attachments\/([^\s<]+)/g,
    (_m, name: string) => stash(`<span class="md-paste-chip">${name}</span>`),
  );
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt: string, url: string) => {
    const href = safeHttpUrl(url.replace(/&amp;/g, "&"));
    if (!href) return m;
    return stash(
      `<img class="md-img" src="${escapeAttr(href)}" alt="${alt.replace(/"/g, "&quot;")}">`,
    );
  });
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label: string, url: string) => {
    const href = safeHttpUrl(url.replace(/&amp;/g, "&"));
    if (!href) return m;
    return stash(`<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer">${label}</a>`);
  });
  html = html
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(URL_RE, (url) => {
      const href = url.replace(/[).,]+$/, "");
      const trailing = url.slice(href.length);
      return stash(`<a href="${href}" target="_blank" rel="noreferrer">${href}</a>`) + trailing;
    });
  html = html.replace(
    /(^|[\s(,])@([A-Za-z](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?)/g,
    (full, prefix: string, name: string, offset: number) => {
      const after = html.charAt(offset + full.length);
      if (after === "/") return full;
      return `${prefix}<span class="md-mention">@${name}</span>`;
    },
  );
  // Slots can hold other slots (a badge image inside a link label), so restore recursively.
  const restore = (value: string, depth: number): string =>
    value.replace(new RegExp(`${SENTINEL_I}(\\d+)${SENTINEL_END}`, "g"), (_m, i: string) =>
      depth > 0 ? restore(slots[Number(i)] ?? "", depth - 1) : "",
    );
  return restore(html, 4);
}

function isTableSep(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]+\|?\s*$/.test(line) && /---/.test(line);
}

function isTableRow(line: string): boolean {
  return line.includes("|") && !isTableSep(line);
}

function splitCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function renderTable(lines: string[]): string {
  const rows = lines.filter((line) => !isTableSep(line)).map(splitCells);
  if (!rows.length) return lines.map((line) => inline(line)).join("\n");
  const [head, ...body] = rows;
  const thead = `<thead><tr>${head!.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>`;
  const tbody = body.length
    ? `<tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`
    : "";
  return `<table class="md-table">${thead}${tbody}</table>`;
}

function isHr(line: string): boolean {
  return /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function isFenceToken(line: string): boolean {
  return new RegExp(`^${SENTINEL_F}\\d+${SENTINEL_END}$`).test(line.trim());
}

function quotePrefix(line: string): { depth: number; rest: string } {
  let depth = 0;
  let rest = line;
  while (depth < MAX_NEST) {
    const match = rest.match(/^ {0,3}> ?/);
    if (!match) break;
    rest = rest.slice(match[0].length);
    depth += 1;
  }
  return { depth, rest };
}

function parseAlert(line: string): { kind: string; title: string } | undefined {
  const match = line.trim().match(ALERT_RE);
  if (!match) return undefined;
  return { kind: match[1]!.toLowerCase(), title: match[2]!.trim() };
}

function detailsOpen(line: string): { open: boolean; summary?: string } | undefined {
  const match = line.trim().match(/^<details(\s+[^>]*)?\s*>(.*)$/i);
  if (!match) return undefined;
  const attrs = (match[1] ?? "").trim();
  if (attrs && !/^open(?:\s*=\s*(?:open|"open"|'open'|""|'')?)?$/i.test(attrs)) return undefined;
  const rest = (match[2] ?? "").trim();
  let summary: string | undefined;
  if (rest) {
    const parsed = parseSummary(rest);
    if (parsed?.kind !== "full") return undefined;
    summary = parsed.text;
  }
  return { open: /\bopen\b/i.test(attrs), summary };
}

function detailsClose(line: string): boolean {
  return /^<\/details\s*>$/i.test(line.trim());
}

function parseSummary(
  line: string,
): { kind: "open" | "close" | "full"; text?: string } | undefined {
  const trimmed = line.trim();
  if (/^<summary\s*>$/i.test(trimmed)) return { kind: "open" };
  if (/^<\/summary\s*>$/i.test(trimmed)) return { kind: "close" };
  const full = trimmed.match(/^<summary\s*>([\s\S]*)<\/summary\s*>$/i);
  if (full) return { kind: "full", text: full[1] };
  return undefined;
}

function taskItem(line: string): { checked: boolean; text: string } | undefined {
  const match = line.match(/^[-*]\s+\[([ xX])\](?:\s+(.*))?$/);
  if (!match) return undefined;
  return { checked: match[1] !== " ", text: match[2] ?? "" };
}

function ulItem(line: string): string | undefined {
  const task = taskItem(line);
  if (task) {
    const checked = task.checked ? " checked" : "";
    return `<li class="md-task"><input type="checkbox" disabled${checked}>${inline(task.text)}</li>`;
  }
  const match = line.match(/^[-*]\s+(.+)$/);
  return match ? `<li>${inline(match[1]!)}</li>` : undefined;
}

/** Same-type list items, including blank-line-separated (loose) lists. */
function collectItemLines(
  lines: string[],
  start: number,
  isItem: (line: string) => boolean,
): { rows: string[]; next: number } {
  const rows: string[] = [];
  let i = start;
  while (i < lines.length) {
    let j = i;
    while (j < lines.length && lines[j]!.trim() === "") j += 1;
    if (j >= lines.length || !isItem(lines[j]!)) break;
    rows.push(lines[j]!);
    i = j + 1;
  }
  return { rows, next: i };
}

function renderAlert(kind: string, title: string, body: string): string {
  return `<div class="md-alert md-alert-${kind}" data-alert="${kind}"><p class="md-alert-title">${inline(title || kind)}</p>${body}</div>`;
}

function renderDetails(open: boolean, summary: string, body: string): string {
  const openAttr = open ? " open" : "";
  const label = summary.trim() ? inline(summary) : "Details";
  return `<details class="md-details"${openAttr}><summary>${label}</summary><div class="md-details-body">${body}</div></details>`;
}

function consumeDetails(
  lines: string[],
  start: number,
  nest: number,
): { html: string; next: number } | undefined {
  const opened = detailsOpen(lines[start]!);
  if (!opened || nest >= MAX_NEST) return undefined;
  let i = start + 1;
  let summary = opened.summary ?? "";
  let inSummary = false;
  const summaryParts: string[] = [];
  const inner: string[] = [];
  let depth = 1;
  while (i < lines.length) {
    const line = lines[i]!;
    if (detailsOpen(line) && !inSummary) {
      depth += 1;
      inner.push(line);
      i += 1;
      continue;
    }
    if (detailsClose(line)) {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
      inner.push(line);
      i += 1;
      continue;
    }
    if (depth === 1 && !summary && inner.length === 0) {
      const parsed = parseSummary(line);
      if (parsed?.kind === "full") {
        summary = parsed.text ?? "";
        i += 1;
        continue;
      }
      if (parsed?.kind === "open") {
        inSummary = true;
        i += 1;
        continue;
      }
    }
    if (inSummary) {
      const parsed = parseSummary(line);
      if (parsed?.kind === "close") {
        summary = summaryParts.join("\n");
        inSummary = false;
        i += 1;
        continue;
      }
      summaryParts.push(line);
      i += 1;
      continue;
    }
    inner.push(line);
    i += 1;
  }
  if (inSummary) summary = summaryParts.join("\n");
  return {
    html: renderDetails(opened.open, summary, renderBlocks(inner.join("\n"), nest + 1)),
    next: i,
  };
}

function consumeQuote(
  lines: string[],
  start: number,
  nest: number,
): { html: string; next: number } {
  const inner: string[] = [];
  let i = start;
  while (i < lines.length) {
    const { depth, rest } = quotePrefix(lines[i]!);
    if (depth === 0) break;
    if (inner.some((row) => row.trim()) && parseAlert(rest)) break;
    inner.push(lines[i]!.replace(/^ {0,3}> ?/, ""));
    i += 1;
  }
  const body = renderBlocks(inner.join("\n"), nest + 1);
  const lead = inner.find((row) => row.trim());
  if (lead && parseAlert(lead)) return { html: body, next: i };
  return { html: `<blockquote class="md-quote">${body}</blockquote>`, next: i };
}

function renderBlocks(text: string, nest = 0): string {
  if (nest > MAX_NEST) return inline(text);
  const lines = text.split("\n");
  const out: string[] = [];
  const plain: string[] = [];
  const flushPlain = () => {
    while (plain.length && plain[0] === "") plain.shift();
    while (plain.length && plain[plain.length - 1] === "") plain.pop();
    if (!plain.length) return;
    out.push(`<div class="md-plain">${plain.map((line) => inline(line)).join("\n")}</div>`);
    plain.length = 0;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (quotePrefix(line).depth > 0) {
      flushPlain();
      const quote = consumeQuote(lines, i, nest);
      out.push(quote.html);
      i = quote.next;
      continue;
    }
    const details = consumeDetails(lines, i, nest);
    if (details) {
      flushPlain();
      out.push(details.html);
      i = details.next;
      continue;
    }
    const alert = parseAlert(line);
    if (alert) {
      flushPlain();
      i += 1;
      const bodyLines: string[] = [];
      while (i < lines.length) {
        const next = lines[i]!;
        if (parseAlert(next) || quotePrefix(next).depth > 0) break;
        bodyLines.push(next);
        i += 1;
      }
      out.push(renderAlert(alert.kind, alert.title, renderBlocks(bodyLines.join("\n"), nest + 1)));
      continue;
    }
    if (isFenceToken(line)) {
      flushPlain();
      out.push(line.trim());
      i += 1;
      continue;
    }
    if (isHr(line)) {
      flushPlain();
      out.push("<hr>");
      i += 1;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      flushPlain();
      const block = [line];
      i += 1;
      while (i < lines.length && (isTableRow(lines[i]!) || isTableSep(lines[i]!))) {
        block.push(lines[i]!);
        i += 1;
      }
      out.push(renderTable(block));
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushPlain();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      flushPlain();
      const { rows, next } = collectItemLines(lines, i, (row) => /^\d+[.)]\s+/.test(row));
      out.push(
        `<ol>${rows.map((row) => `<li>${inline(row.replace(/^\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`,
      );
      i = next;
      continue;
    }
    if (ulItem(line)) {
      flushPlain();
      const { rows, next } = collectItemLines(lines, i, (row) => Boolean(ulItem(row)));
      const tasks = rows.some((row) => taskItem(row));
      out.push(
        `<ul${tasks ? ' class="md-task-list"' : ""}>${rows.map((row) => ulItem(row)!).join("")}</ul>`,
      );
      i = next;
      continue;
    }
    if (/^<br\s*\/?>$/i.test(line.trim())) {
      flushPlain();
      out.push("<br>");
      i += 1;
      continue;
    }
    if (/^<hr\s*\/?>$/i.test(line.trim())) {
      flushPlain();
      out.push("<hr>");
      i += 1;
      continue;
    }
    plain.push(line);
    i += 1;
  }
  flushPlain();
  return out.join("\n");
}

const MARKDOWN_CACHE_LIMIT = 128;
const markdownCache = new Map<string, string>();

export function formatMarkdown(text: string): string {
  const cached = markdownCache.get(text);
  if (cached !== undefined) {
    markdownCache.delete(text);
    markdownCache.set(text, cached);
    return cached;
  }
  const html = renderMarkdown(text);
  if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) {
    const oldest = markdownCache.keys().next().value;
    if (oldest !== undefined) markdownCache.delete(oldest);
  }
  markdownCache.set(text, html);
  return html;
}

function renderMarkdown(text: string): string {
  const fences: string[] = [];
  const normalized = text.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  const withBreaks = normalized.replace(/<br\s*\/?>/gi, "\n");
  const withFences = withBreaks.replace(
    /```(\w*)\n?([\s\S]*?)```/g,
    (_m, lang: string, code: string) => {
      const body = highlightSource(code.replace(/\n$/, ""), lang);
      const langAttr = lang ? ` data-lang="${lang}"` : "";
      fences.push(
        `<div class="md-code-wrap"><button type="button" class="md-copy">Copy</button><pre class="md-code"${langAttr}><code>${body}</code></pre></div>`,
      );
      return `${SENTINEL_F}${fences.length - 1}${SENTINEL_END}`;
    },
  );
  let html = renderBlocks(withFences);
  html = html.replace(
    new RegExp(`${SENTINEL_F}(\\d+)${SENTINEL_END}`, "g"),
    (_m, i: string) => fences[Number(i)] ?? "",
  );
  return html;
}

export function prUrlFromToolOutput(output: string): string | undefined {
  try {
    const parsed = JSON.parse(output) as {
      html_url?: string;
      web_url?: string;
      links?: { html?: { href?: string } };
    };
    if (typeof parsed.html_url === "string") return parsed.html_url;
    if (typeof parsed.web_url === "string") return parsed.web_url;
    if (typeof parsed.links?.html?.href === "string") return parsed.links.html.href;
  } catch {
    /* fall through to card / URL scrape */
  }
  const card = parsePrCard(output);
  if (card?.url) return card.url;
  return output.match(
    /https?:\/\/[^\s"'<>]+\/(?:pull|pulls|merge_requests|pullrequests)\/\d+/i,
  )?.[0];
}
