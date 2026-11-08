import { wrapUntrusted } from "@locus/shared";

const MAX_QUERY = 400;
const MAX_RESULTS = 8;
const DEFAULT_RESULTS = 5;
const FETCH_MS = 12_000;
const MAX_BODY = 512_000;
const USER_AGENT = "Mozilla/5.0 (compatible; Locus/0.1; +https://github.com/Modsofthenation/Locus)";

const FETCH_HOSTS = new Set([
  "html.duckduckgo.com",
  "lite.duckduckgo.com",
  "api.duckduckgo.com",
  "en.wikipedia.org",
]);

export interface WebSearchHit {
  title: string;
  url: string;
  snippet?: string;
}

export async function runWebSearch(
  query: string,
  opts: { fetchFn?: typeof fetch; maxResults?: number } = {},
): Promise<{ ok: boolean; output: string }> {
  const q = query.trim().slice(0, MAX_QUERY);
  if (!q) return { ok: false, output: "query is required" };
  const limit = clampResults(opts.maxResults);
  const fetchFn = opts.fetchFn ?? fetch;
  const hits =
    (await searchDuckDuckGoHtml(q, fetchFn, limit)) ??
    (await searchDuckDuckGoLite(q, fetchFn, limit)) ??
    (await searchDuckDuckGoInstant(q, fetchFn, limit)) ??
    (await searchWikipedia(q, fetchFn, limit));
  if (!hits?.length) return { ok: false, output: `No web results for ${q}` };
  return {
    ok: true,
    output: wrapUntrusted({
      kind: "web-search",
      source: "websearch",
      text: formatHits(q, hits.slice(0, limit)),
    }),
  };
}

function clampResults(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_RESULTS;
  return Math.min(MAX_RESULTS, Math.max(1, Math.round(value)));
}

function formatHits(query: string, hits: WebSearchHit[]): string {
  const lines = [`Web search: ${query}`];
  hits.forEach((hit, index) => {
    lines.push(`${index + 1}. ${hit.title}`);
    lines.push(`   ${hit.url}`);
    if (hit.snippet) lines.push(`   ${hit.snippet}`);
  });
  return lines.join("\n");
}

async function searchDuckDuckGoHtml(
  query: string,
  fetchFn: typeof fetch,
  limit: number,
): Promise<WebSearchHit[] | undefined> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await getText(fetchFn, url);
  if (!html) return undefined;
  const hits = parseDuckDuckGoHtml(html, limit);
  return hits.length ? hits : undefined;
}

async function searchDuckDuckGoLite(
  query: string,
  fetchFn: typeof fetch,
  limit: number,
): Promise<WebSearchHit[] | undefined> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const html = await getText(fetchFn, url);
  if (!html) return undefined;
  const hits = parseDuckDuckGoLite(html, limit);
  return hits.length ? hits : undefined;
}

async function searchDuckDuckGoInstant(
  query: string,
  fetchFn: typeof fetch,
  limit: number,
): Promise<WebSearchHit[] | undefined> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&skip_disambig=1`;
  const json = await getJson(fetchFn, url);
  if (!json || typeof json !== "object") return undefined;
  const hits: WebSearchHit[] = [];
  const row = json as Record<string, unknown>;
  const abstract = typeof row.AbstractText === "string" ? row.AbstractText.trim() : "";
  const heading = typeof row.Heading === "string" ? row.Heading.trim() : "";
  const abstractUrl = unwrapUrl(typeof row.AbstractURL === "string" ? row.AbstractURL : "");
  if (abstract && abstractUrl) {
    hits.push({ title: heading || abstract.slice(0, 80), url: abstractUrl, snippet: abstract });
  }
  const topics = Array.isArray(row.RelatedTopics) ? row.RelatedTopics : [];
  for (const topic of topics) {
    if (hits.length >= limit) break;
    collectRelated(topic, hits, limit);
  }
  return hits.length ? hits : undefined;
}

function collectRelated(topic: unknown, hits: WebSearchHit[], limit: number): void {
  if (!topic || typeof topic !== "object") return;
  const row = topic as Record<string, unknown>;
  if (Array.isArray(row.Topics)) {
    for (const nested of row.Topics) {
      if (hits.length >= limit) return;
      collectRelated(nested, hits, limit);
    }
    return;
  }
  const url = unwrapUrl(typeof row.FirstURL === "string" ? row.FirstURL : "");
  const text = typeof row.Text === "string" ? decodeEntities(row.Text).trim() : "";
  if (!url || !text) return;
  if (hits.some((hit) => hit.url === url)) return;
  hits.push({ title: text.split(" - ")[0] || text, url, snippet: text });
}

async function searchWikipedia(
  query: string,
  fetchFn: typeof fetch,
  limit: number,
): Promise<WebSearchHit[] | undefined> {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${limit}&namespace=0&format=json`;
  const json = await getJson(fetchFn, url);
  if (!Array.isArray(json) || json.length < 4) return undefined;
  const titles = Array.isArray(json[1]) ? json[1] : [];
  const snippets = Array.isArray(json[2]) ? json[2] : [];
  const urls = Array.isArray(json[3]) ? json[3] : [];
  const hits: WebSearchHit[] = [];
  for (let i = 0; i < titles.length && hits.length < limit; i += 1) {
    const title = typeof titles[i] === "string" ? titles[i] : "";
    const href = unwrapUrl(typeof urls[i] === "string" ? urls[i] : "");
    if (!title || !href) continue;
    const snippet = typeof snippets[i] === "string" ? snippets[i].trim() : "";
    hits.push({ title, url: href, snippet: snippet || undefined });
  }
  return hits.length ? hits : undefined;
}

export function parseDuckDuckGoHtml(html: string, limit = DEFAULT_RESULTS): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const re =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|span|div)>|(?=<(?:a|div)[^>]*class="[^"]*result__a))/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && hits.length < limit) {
    pushHit(hits, match[1], match[2], match[3]);
  }
  if (hits.length) return hits;
  return parseGenericResultLinks(html, limit);
}

export function parseDuckDuckGoLite(html: string, limit = DEFAULT_RESULTS): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const re =
    /<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,800})/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && hits.length < limit) {
    const snippet = /class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/i.exec(
      match[3] ?? "",
    )?.[1];
    pushHit(hits, match[1], match[2], snippet);
  }
  if (hits.length) return hits;
  return parseGenericResultLinks(html, limit);
}

function parseGenericResultLinks(html: string, limit: number): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const re = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && hits.length < limit) {
    const href = match[1] ?? "";
    if (!/uddg=/i.test(href)) continue;
    if (/duckduckgo\.com\/(?:html|lite)?\/?$/i.test(href)) continue;
    pushHit(hits, href, match[2], undefined);
  }
  return hits;
}

function pushHit(
  hits: WebSearchHit[],
  rawHref?: string,
  rawTitle?: string,
  rawSnippet?: string,
): void {
  const url = unwrapUrl(rawHref ?? "");
  const title = stripTags(rawTitle ?? "").trim();
  if (!url || !title) return;
  if (hits.some((hit) => hit.url === url)) return;
  const snippet = stripTags(rawSnippet ?? "").trim();
  hits.push({ title, url, snippet: snippet || undefined });
}

export function unwrapUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg) return unwrapUrl(uddg);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.hostname === "duckduckgo.com" || url.hostname.endsWith(".duckduckgo.com"))
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function fetchHostAllowed(url: string): boolean {
  try {
    return FETCH_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function getText(fetchFn: typeof fetch, url: string): Promise<string | undefined> {
  if (!fetchHostAllowed(url)) return undefined;
  try {
    const res = await fetchFn(url, {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (!res.ok) return undefined;
    return (await res.text()).slice(0, MAX_BODY);
  } catch {
    return undefined;
  }
}

async function getJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  if (!fetchHostAllowed(url)) return undefined;
  try {
    const res = await fetchFn(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (!res.ok) return undefined;
    const text = (await res.text()).slice(0, MAX_BODY);
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
