import {
  findPluginTool,
  pluginAllowedHosts,
  pluginReady,
  type IntegrationPlugin,
} from "@locus/shared";

export type PluginFetcher = typeof fetch;

const MAX_OUTPUT = 8_000;
const MAX_BYTES = 64_000;

export async function callPluginTool(
  name: string,
  args: Record<string, unknown>,
  plugins: IntegrationPlugin[] | undefined,
  fetchFn: PluginFetcher = fetch,
): Promise<{ ok: boolean; output: string }> {
  const hit = findPluginTool(plugins, name);
  if (!hit) return { ok: false, output: `Unknown plugin tool ${name}` };
  if (!pluginReady(hit.plugin)) {
    return {
      ok: false,
      output: `Add required values for ${hit.plugin.name} in Settings → Integrations`,
    };
  }
  try {
    const request = buildPluginRequest(hit.plugin, hit.tool.http, args);
    const res = await fetchFn(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await readBody(res);
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, output: `Refusing redirect (${res.status})` };
    }
    const text = formatBody(raw).slice(0, MAX_OUTPUT);
    if (!res.ok) return { ok: false, output: `${res.status} ${res.statusText}\n${text}`.trim() };
    return { ok: true, output: text || `${res.status} ${res.statusText}` };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "Plugin request failed" };
  }
}

export function buildPluginRequest(
  plugin: IntegrationPlugin,
  http: IntegrationPlugin["tools"][number]["http"],
  args: Record<string, unknown>,
): { method: string; url: string; headers: Record<string, string>; body?: string } {
  const ctx = { config: plugin.config ?? {}, args };
  const url = resolvePluginUrl(renderTemplate(http.url, ctx, { encodePath: true }), plugin, ctx);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(http.headers ?? {})) {
    const rendered = renderTemplate(value, ctx);
    if (rendered) headers[key] = rendered;
  }
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(http.query ?? {})) {
    const rendered = renderTemplate(value, ctx, { encodePath: false });
    if (rendered) parsed.searchParams.set(key, rendered);
  }
  let body: string | undefined;
  if (http.body != null && http.method !== "GET") {
    if (typeof http.body === "string") body = renderTemplate(http.body, ctx);
    else body = JSON.stringify(renderJson(http.body, ctx));
    if (body && !headerHas(headers, "content-type")) {
      headers["Content-Type"] = "application/json";
    }
  }
  return { method: http.method, url: parsed.toString(), headers, body };
}

function resolvePluginUrl(
  rendered: string,
  plugin: IntegrationPlugin,
  ctx: TemplateContext,
): string {
  let url = rendered.trim();
  if (!url) throw new Error("Plugin URL is empty");
  if (url.startsWith("/")) {
    const base = firstUrlConfig(plugin);
    if (!base) throw new Error("Plugin URL is relative but no url config field is set");
    url = `${base.replace(/\/+$/, "")}${url}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Plugin URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Plugin URL must be http(s)");
  }
  const allowed = new Set(pluginAllowedHosts({ ...plugin, config: ctx.config }));
  if (!allowed.has(parsed.hostname.toLowerCase())) {
    throw new Error(`Plugin host ${parsed.hostname} is not in this plugin's URL fields`);
  }
  return parsed.toString();
}

function firstUrlConfig(plugin: IntegrationPlugin): string | undefined {
  for (const field of plugin.configFields) {
    if (field.type !== "url") continue;
    const value = plugin.config?.[field.key]?.trim();
    if (value) return value.replace(/\/+$/, "");
  }
  return undefined;
}

type TemplateContext = {
  config: Record<string, string>;
  args: Record<string, unknown>;
};

function renderTemplate(
  template: string,
  ctx: TemplateContext,
  opts?: { encodePath?: boolean },
): string {
  return template.replace(/\{\{\s*(config|args)\.([a-zA-Z0-9_]+)\s*\}\}/g, (_all, scope, key) => {
    const value = scope === "config" ? (ctx.config[key] ?? "") : stringifyArg(ctx.args[key]);
    if (opts?.encodePath && scope === "args") return encodeURIComponent(value);
    return value;
  });
}

function renderJson(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === "string") return renderTemplate(value, ctx);
  if (Array.isArray(value)) return value.map((item) => renderJson(item, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = renderJson(item, ctx);
    }
    return out;
  }
  return value;
}

function stringifyArg(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function headerHas(headers: Record<string, string>, name: string): boolean {
  const want = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === want);
}

async function readBody(res: Response): Promise<string> {
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.subarray(0, MAX_BYTES).toString("utf8");
}

function formatBody(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
