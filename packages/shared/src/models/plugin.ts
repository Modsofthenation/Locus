import type { ExtraToolDef } from "./mcp.js";

export const PLUGIN_TOOL_PREFIX = "plugin_";
export const MANAGE_INTEGRATION_PLUGIN_NAME = "manage_integration_plugin";

export const PLUGIN_CONFIG_FIELD_TYPES = ["string", "secret", "url", "boolean"] as const;
export type PluginConfigFieldType = (typeof PLUGIN_CONFIG_FIELD_TYPES)[number];

export const PLUGIN_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type PluginHttpMethod = (typeof PLUGIN_HTTP_METHODS)[number];

export const MAX_INTEGRATION_PLUGINS = 32;
export const MAX_PLUGIN_TOOLS = 16;
export const MAX_PLUGIN_FIELDS = 12;

const SLUG_RE = /^[a-z][a-z0-9-]{0,23}$/;
const FIELD_KEY_RE = /^[a-z][a-zA-Z0-9_]{0,31}$/;
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;

const RESERVED_SLUGS = new Set([
  "bitbucket",
  "git",
  "github",
  "gitlab",
  "gmail",
  "gcal",
  "gdrive",
  "google",
  "grafana",
  "jira",
  "locus",
  "manage",
  "mcp",
  "miro",
  "plugin",
  "portainer",
  "slack",
  "websearch",
]);

export interface PluginConfigField {
  key: string;
  label: string;
  type: PluginConfigFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
}

export interface PluginHttpRequest {
  method: PluginHttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: string | Record<string, unknown>;
}

export interface PluginTool {
  name: string;
  description: string;
  parameters: ExtraToolDef["parameters"];
  /** Extra write flag for GET tools. Non-GET is always a write, even if this is false. */
  write?: boolean;
  http: PluginHttpRequest;
}

export interface IntegrationPlugin {
  id: string;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  configFields: PluginConfigField[];
  config?: Record<string, string>;
  tools: PluginTool[];
}

export function isPluginConfigFieldType(value: unknown): value is PluginConfigFieldType {
  return value === "string" || value === "secret" || value === "url" || value === "boolean";
}

export function isPluginHttpMethod(value: unknown): value is PluginHttpMethod {
  return (
    value === "GET" ||
    value === "POST" ||
    value === "PUT" ||
    value === "PATCH" ||
    value === "DELETE"
  );
}

export function pluginSlug(raw: string): string | undefined {
  const slug = raw.trim().toLowerCase();
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) return undefined;
  return slug;
}

export function isPluginToolName(name: string): boolean {
  return name.startsWith(PLUGIN_TOOL_PREFIX);
}

export function isManageIntegrationPluginName(name: string): boolean {
  return name === MANAGE_INTEGRATION_PLUGIN_NAME;
}

export function isPluginFamilyToolName(name: string): boolean {
  return isPluginToolName(name) || isManageIntegrationPluginName(name);
}

export function pluginFunctionName(slug: string, toolName: string): string {
  const left = sanitizePluginToken(slug, 20);
  const right = sanitizePluginToken(toolName, 32);
  return `${PLUGIN_TOOL_PREFIX}${left}_${right}`.slice(0, 64);
}

export function sanitizePluginToken(raw: string, max: number): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "tool").slice(0, max);
}

export function pluginFieldIsSecret(field: Pick<PluginConfigField, "type">): boolean {
  return field.type === "secret";
}

export function pluginFieldRequired(field: PluginConfigField): boolean {
  if (field.required === false) return false;
  if (field.required === true) return true;
  return field.type === "secret" || field.type === "url";
}

export function pluginToolIsWrite(tool: Pick<PluginTool, "write" | "http">): boolean {
  if (tool.http.method !== "GET") return true;
  return tool.write === true;
}

export function pluginReady(plugin: IntegrationPlugin): boolean {
  if (plugin.enabled === false || !plugin.tools.length) return false;
  return plugin.configFields.every((field) => {
    if (!pluginFieldRequired(field)) return true;
    return Boolean(plugin.config?.[field.key]?.trim());
  });
}

export function enabledPlugins(plugins: IntegrationPlugin[] | undefined): IntegrationPlugin[] {
  return (plugins ?? []).filter((plugin) => plugin.enabled !== false);
}

export function readyPlugins(plugins: IntegrationPlugin[] | undefined): IntegrationPlugin[] {
  return (plugins ?? []).filter(pluginReady);
}

export function pluginExtraTools(plugins: IntegrationPlugin[] | undefined): ExtraToolDef[] {
  const out: ExtraToolDef[] = [];
  for (const plugin of readyPlugins(plugins)) {
    for (const tool of plugin.tools) {
      out.push({
        name: pluginFunctionName(plugin.slug, tool.name),
        description: `${plugin.name}: ${tool.description}`,
        parameters: tool.parameters,
      });
    }
  }
  return out;
}

export function findPluginTool(
  plugins: IntegrationPlugin[] | undefined,
  functionName: string,
): { plugin: IntegrationPlugin; tool: PluginTool } | undefined {
  for (const plugin of plugins ?? []) {
    for (const tool of plugin.tools) {
      if (pluginFunctionName(plugin.slug, tool.name) === functionName) return { plugin, tool };
    }
  }
  return undefined;
}

export function pluginReadToolNames(plugins: IntegrationPlugin[] | undefined): string[] {
  const names: string[] = [];
  for (const plugin of plugins ?? []) {
    for (const tool of plugin.tools) {
      if (!pluginToolIsWrite(tool)) names.push(pluginFunctionName(plugin.slug, tool.name));
    }
  }
  return names;
}

export function pluginWriteToolNames(plugins: IntegrationPlugin[] | undefined): string[] {
  const names: string[] = [];
  for (const plugin of plugins ?? []) {
    for (const tool of plugin.tools) {
      if (pluginToolIsWrite(tool)) names.push(pluginFunctionName(plugin.slug, tool.name));
    }
  }
  return names;
}

/** Automations only see plugin tools the operator listed. */
export function automationAllowsPlugin(
  session: { automationId?: string; allowedMcpTools?: string[]; allowedTools?: string[] },
  name: string,
): boolean {
  if (!isPluginFamilyToolName(name)) return true;
  if (!session.automationId) return true;
  return (
    (session.allowedMcpTools ?? []).includes(name) || (session.allowedTools ?? []).includes(name)
  );
}

export function formatPluginCatalog(plugins: IntegrationPlugin[] | undefined): string {
  const rows = plugins ?? [];
  const lines = [
    "Integration plugins: host-side HTTP APIs. Call manage_integration_plugin to add or update one. Never put tokens in that tool — the operator pastes secrets in Settings → Integrations.",
  ];
  if (!rows.length) {
    lines.push(
      "None yet. When the operator wants a bespoke service, create a plugin with config_fields (url/secret/string) and tools (HTTP templates).",
    );
    return lines.join("\n");
  }
  for (const plugin of rows) {
    const tools =
      plugin.tools.map((tool) => pluginFunctionName(plugin.slug, tool.name)).join(", ") ||
      "(no tools)";
    const state = pluginReady(plugin) ? "ready" : "needs Settings values";
    lines.push(`- ${plugin.name} (${plugin.slug}, ${state}): ${tools}`);
  }
  return lines.join("\n");
}

export const MANAGE_INTEGRATION_PLUGIN_TOOL: ExtraToolDef = {
  name: MANAGE_INTEGRATION_PLUGIN_NAME,
  description:
    "Create, update, list, or delete an integration plugin. Plugins expose Settings fields and host-side HTTP tools (plugin_<slug>_<tool>). Never include tokens or secrets. After create, tell the operator to paste secrets in Settings → Integrations.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "delete", "list"],
        description: "create / update / delete / list",
      },
      id: { type: "string", description: "Plugin id (update/delete). Slug also works." },
      slug: {
        type: "string",
        description: "Short id: letters, numbers, dashes. Tools become plugin_<slug>_<name>.",
      },
      name: { type: "string", description: "Display name in Settings" },
      description: { type: "string", description: "What this plugin talks to" },
      config_fields: {
        type: "string",
        description:
          'JSON array of {key,label,type,required?,placeholder?,help?}. Types: string, secret, url, boolean. Example: [{"key":"baseUrl","label":"Base URL","type":"url"},{"key":"token","label":"API token","type":"secret"}]',
      },
      tools: {
        type: "string",
        description:
          "JSON array of {name,description,parameters,write?,http}. http: {method,url,headers?,query?,body?}. Templates: {{config.key}} and {{args.key}}. URL host must come from a url field or a hardcoded https host — not from args.",
      },
      config: {
        type: "string",
        description:
          'JSON object of non-secret default values, e.g. {"baseUrl":"https://api.example.com"}',
      },
    },
    required: ["action"],
  },
};

export function pluginAllowedHosts(plugin: IntegrationPlugin): string[] {
  const hosts = new Set<string>();
  for (const field of plugin.configFields) {
    if (field.type !== "url") continue;
    const host = hostnameOf(plugin.config?.[field.key]);
    if (host) hosts.add(host);
  }
  for (const tool of plugin.tools) {
    for (const host of staticHostsFromUrlTemplate(tool.http.url)) hosts.add(host);
  }
  return [...hosts];
}

export function staticHostsFromUrlTemplate(url: string): string[] {
  const stripped = url.replace(/\{\{[^}]+\}\}/g, "placeholder");
  const host = hostnameOf(stripped);
  if (!host || host === "placeholder") return [];
  return [host];
}

export function validatePlugin(
  plugin: IntegrationPlugin,
  others: IntegrationPlugin[],
): string | undefined {
  if (!plugin.id.trim()) return "Plugin id is required";
  if (!pluginSlug(plugin.slug)) {
    return "Plugin slug must be a short lowercase name (letters, numbers, dashes) and not a reserved service";
  }
  if (!plugin.name.trim()) return "Plugin name is required";
  if (plugin.description.length > 2_048) return "Plugin description is too long";
  if (plugin.configFields.length > MAX_PLUGIN_FIELDS) return "Too many plugin config fields";
  if (plugin.tools.length > MAX_PLUGIN_TOOLS) return "Too many plugin tools";
  if (plugin.tools.length < 1) return "Plugin needs at least one tool";
  if (others.some((row) => row.id !== plugin.id && row.slug === plugin.slug)) {
    return `Plugin slug ${plugin.slug} is already used`;
  }
  const keys = new Set<string>();
  for (const field of plugin.configFields) {
    if (!FIELD_KEY_RE.test(field.key)) return `Invalid config field key: ${field.key || "(empty)"}`;
    if (keys.has(field.key)) return `Duplicate config field: ${field.key}`;
    keys.add(field.key);
    if (!field.label.trim()) return `Config field ${field.key} needs a label`;
    if (!isPluginConfigFieldType(field.type)) return `Unknown config field type: ${field.key}`;
  }
  const names = new Set<string>();
  for (const tool of plugin.tools) {
    if (!TOOL_NAME_RE.test(tool.name)) return `Invalid tool name: ${tool.name || "(empty)"}`;
    if (names.has(tool.name)) return `Duplicate tool name: ${tool.name}`;
    names.add(tool.name);
    if (!tool.description.trim()) return `Tool ${tool.name} needs a description`;
    if (!isPluginHttpMethod(tool.http.method)) return `Tool ${tool.name} needs an HTTP method`;
    if (!tool.http.url.trim()) return `Tool ${tool.name} needs a URL template`;
    if (tool.http.url.length > 2_048) return `Tool ${tool.name} URL is too long`;
    const hostError = pluginUrlHostError(tool.http.url, plugin);
    if (hostError) return `Tool ${tool.name}: ${hostError}`;
  }
  return undefined;
}

/** Args must not choose the request host. */
export function pluginUrlHostError(url: string, plugin: IntegrationPlugin): string | undefined {
  if (/\{\{\s*args\./i.test(hostTemplatePart(url))) {
    return "URL host cannot use {{args.*}}";
  }
  const afterConfig = url.replace(/\{\{\s*config\.[a-zA-Z0-9_]+\s*\}\}/g, "https://config.invalid");
  if (afterConfig.startsWith("/") || afterConfig.startsWith("{{")) {
    if (!plugin.configFields.some((field) => field.type === "url")) {
      return "Relative URL needs a config field of type url";
    }
    return undefined;
  }
  try {
    const parsed = new URL(afterConfig.replace(/\{\{[^}]+\}\}/g, "x"));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "URL must be http(s)";
    }
  } catch {
    return "URL template is invalid";
  }
  return undefined;
}

export function normalizePlugin(raw: unknown): IntegrationPlugin | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : undefined;
  const slug = typeof value.slug === "string" ? pluginSlug(value.slug) : undefined;
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : slug;
  if (!id || !slug || !name) return undefined;
  const fields = Array.isArray(value.configFields)
    ? value.configFields
    : Array.isArray(value.config_fields)
      ? value.config_fields
      : [];
  const tools = Array.isArray(value.tools) ? value.tools : [];
  const configFields: PluginConfigField[] = [];
  const seenFields = new Set<string>();
  for (const row of fields) {
    const field = normalizeConfigField(row);
    if (!field || seenFields.has(field.key)) continue;
    seenFields.add(field.key);
    configFields.push(field);
    if (configFields.length >= MAX_PLUGIN_FIELDS) break;
  }
  const pluginTools: PluginTool[] = [];
  const seenTools = new Set<string>();
  for (const row of tools) {
    const tool = normalizePluginTool(row);
    if (!tool || seenTools.has(tool.name)) continue;
    seenTools.add(tool.name);
    pluginTools.push(tool);
    if (pluginTools.length >= MAX_PLUGIN_TOOLS) break;
  }
  if (!pluginTools.length) return undefined;
  const config = normalizeConfigValues(value.config, configFields);
  return {
    id,
    slug,
    name,
    description:
      typeof value.description === "string" ? value.description.trim().slice(0, 2_048) : "",
    enabled: value.enabled === false ? false : true,
    configFields,
    config: Object.keys(config).length ? config : undefined,
    tools: pluginTools,
  };
}

export function normalizePlugins(raw: unknown): IntegrationPlugin[] {
  if (!Array.isArray(raw)) return [];
  const out: IntegrationPlugin[] = [];
  const seen = new Set<string>();
  const slugs = new Set<string>();
  for (const row of raw) {
    const plugin = normalizePlugin(row);
    if (!plugin || seen.has(plugin.id) || slugs.has(plugin.slug)) continue;
    if (validatePlugin(plugin, out)) continue;
    seen.add(plugin.id);
    slugs.add(plugin.slug);
    out.push(plugin);
    if (out.length >= MAX_INTEGRATION_PLUGINS) break;
  }
  return out;
}

export function applyPluginManageAction(
  plugins: IntegrationPlugin[],
  args: Record<string, unknown>,
  newId: () => string,
): { ok: boolean; plugins: IntegrationPlugin[]; output: string } {
  const action = strArg(args, "action").toLowerCase();
  if (action === "list") {
    return { ok: true, plugins, output: formatPluginManageList(plugins) };
  }
  if (action === "delete") {
    const found = findPlugin(plugins, args);
    if (!found) return { ok: false, plugins, output: "Unknown plugin. Pass id or slug." };
    return {
      ok: true,
      plugins: plugins.filter((row) => row.id !== found.id),
      output: `Removed plugin ${found.name} (${found.slug})`,
    };
  }
  if (action !== "create" && action !== "update") {
    return { ok: false, plugins, output: "action must be create, update, delete, or list" };
  }
  const current = action === "update" ? findPlugin(plugins, args) : undefined;
  if (action === "update" && !current) {
    return { ok: false, plugins, output: "Unknown plugin. Pass id or slug." };
  }
  const fieldsRaw = parseJsonArg(args.config_fields ?? args.configFields);
  const toolsRaw = parseJsonArg(args.tools);
  const configRaw = parseJsonArg(args.config);
  const next = normalizePlugin({
    id: current?.id ?? (typeof args.id === "string" && args.id.trim() ? args.id.trim() : newId()),
    slug: strArg(args, "slug") || current?.slug,
    name: strArg(args, "name") || current?.name,
    description:
      typeof args.description === "string" ? args.description : (current?.description ?? ""),
    enabled: current?.enabled !== false,
    configFields: Array.isArray(fieldsRaw) ? fieldsRaw : current?.configFields,
    tools: Array.isArray(toolsRaw) ? toolsRaw : current?.tools,
    config: {
      ...(current?.config ?? {}),
      ...(configRaw && typeof configRaw === "object" && !Array.isArray(configRaw)
        ? (configRaw as Record<string, unknown>)
        : {}),
    },
  });
  if (!next) {
    return {
      ok: false,
      plugins,
      output: "Plugin needs a slug, a name, and at least one valid tool",
    };
  }
  next.config = applyManagedPluginConfig(next, current);
  const others = plugins.filter((row) => row.id !== next.id);
  const error = validatePlugin(next, others);
  if (error) return { ok: false, plugins, output: error };
  if (plugins.length >= MAX_INTEGRATION_PLUGINS && !current) {
    return { ok: false, plugins, output: `At most ${MAX_INTEGRATION_PLUGINS} plugins` };
  }
  const out = current
    ? plugins.map((row) => (row.id === next.id ? next : row))
    : [...plugins, next];
  const tools = next.tools.map((tool) => pluginFunctionName(next.slug, tool.name)).join(", ");
  return {
    ok: true,
    plugins: out,
    output: current
      ? `Updated plugin ${next.name} (${next.slug}). Tools: ${tools}. Paste secrets in Settings → Integrations.`
      : `Created plugin ${next.name} (${next.slug}). Tools: ${tools}. Paste secrets in Settings → Integrations, then the tools become available.`,
  };
}

function formatPluginManageList(plugins: IntegrationPlugin[]): string {
  if (!plugins.length) return "No integration plugins.";
  return plugins
    .map((plugin) => {
      const tools = plugin.tools
        .map((tool) => pluginFunctionName(plugin.slug, tool.name))
        .join(", ");
      const fields = plugin.configFields
        .map(
          (field) =>
            `${field.key} (${field.type}${pluginFieldRequired(field) ? "" : ", optional"})`,
        )
        .join(", ");
      return [
        `${plugin.name} [${plugin.slug}] id=${plugin.id} ${pluginReady(plugin) ? "ready" : "needs Settings"}`,
        `  fields: ${fields || "(none)"}`,
        `  tools: ${tools}`,
      ].join("\n");
    })
    .join("\n");
}

function findPlugin(
  plugins: IntegrationPlugin[],
  args: Record<string, unknown>,
): IntegrationPlugin | undefined {
  const id = strArg(args, "id");
  const slug = strArg(args, "slug").toLowerCase();
  return plugins.find(
    (row) => (id && row.id === id) || (slug && row.slug === slug) || (id && row.slug === id),
  );
}

/**
 * Agent-managed config never stores tokens from the tool call.
 * Existing vaulted secrets stay on fields that remain type secret.
 * A field changed from secret → string drops the value instead of writing it to config.json.
 */
function applyManagedPluginConfig(
  plugin: IntegrationPlugin,
  previous: IntegrationPlugin | undefined,
): Record<string, string> | undefined {
  const next: Record<string, string> = {};
  for (const field of plugin.configFields) {
    if (pluginFieldIsSecret(field)) {
      const prevField = previous?.configFields.find((row) => row.key === field.key);
      const prevValue = previous?.config?.[field.key]?.trim();
      if (prevField && pluginFieldIsSecret(prevField) && prevValue) next[field.key] = prevValue;
      continue;
    }
    const prevField = previous?.configFields.find((row) => row.key === field.key);
    if (prevField && pluginFieldIsSecret(prevField)) continue;
    const value = plugin.config?.[field.key]?.trim();
    if (value) next[field.key] = value;
  }
  return Object.keys(next).length ? next : undefined;
}

function normalizeConfigField(raw: unknown): PluginConfigField | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const key = typeof value.key === "string" ? value.key.trim() : "";
  if (!FIELD_KEY_RE.test(key) || !isPluginConfigFieldType(value.type)) return undefined;
  const label = typeof value.label === "string" && value.label.trim() ? value.label.trim() : key;
  return {
    key,
    label: label.slice(0, 64),
    type: value.type,
    required: value.required === false ? false : value.required === true ? true : undefined,
    placeholder:
      typeof value.placeholder === "string" && value.placeholder.trim()
        ? value.placeholder.trim().slice(0, 128)
        : undefined,
    help:
      typeof value.help === "string" && value.help.trim()
        ? value.help.trim().slice(0, 256)
        : undefined,
  };
}

function normalizePluginTool(raw: unknown): PluginTool | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim().toLowerCase() : "";
  if (!TOOL_NAME_RE.test(name)) return undefined;
  const description =
    typeof value.description === "string" && value.description.trim()
      ? value.description.trim().slice(0, 512)
      : "";
  if (!description) return undefined;
  const httpRaw =
    value.http && typeof value.http === "object" ? (value.http as Record<string, unknown>) : {};
  const methodRaw = typeof httpRaw.method === "string" ? httpRaw.method.trim().toUpperCase() : "";
  if (!isPluginHttpMethod(methodRaw)) return undefined;
  const url = typeof httpRaw.url === "string" ? httpRaw.url.trim() : "";
  if (!url) return undefined;
  const headers = stringMap(httpRaw.headers);
  const query = stringMap(httpRaw.query);
  const body = normalizeBody(httpRaw.body);
  return {
    name,
    description,
    parameters: normalizeToolParameters(value.parameters),
    write: value.write === true ? true : value.write === false ? false : undefined,
    http: {
      method: methodRaw,
      url: url.slice(0, 2_048),
      headers: Object.keys(headers).length ? headers : undefined,
      query: Object.keys(query).length ? query : undefined,
      body,
    },
  };
}

function normalizeToolParameters(raw: unknown): ExtraToolDef["parameters"] {
  const empty: ExtraToolDef["parameters"] = { type: "object", properties: {} };
  if (!raw || typeof raw !== "object") return empty;
  const value = raw as Record<string, unknown>;
  const propsIn =
    value.properties && typeof value.properties === "object" && !Array.isArray(value.properties)
      ? (value.properties as Record<string, unknown>)
      : {};
  const properties: ExtraToolDef["parameters"]["properties"] = {};
  for (const [key, spec] of Object.entries(propsIn)) {
    if (!FIELD_KEY_RE.test(key) || !spec || typeof spec !== "object") continue;
    const row = spec as Record<string, unknown>;
    const type = typeof row.type === "string" && row.type.trim() ? row.type.trim() : "string";
    const property: ExtraToolDef["parameters"]["properties"][string] = { type };
    if (typeof row.description === "string" && row.description.trim()) {
      property.description = row.description.trim().slice(0, 256);
    }
    if (Array.isArray(row.enum)) {
      const enums = row.enum
        .filter((item): item is string => typeof item === "string")
        .slice(0, 16);
      if (enums.length) property.enum = enums;
    }
    properties[key] = property;
    if (Object.keys(properties).length >= 16) break;
  }
  const required = Array.isArray(value.required)
    ? value.required
        .filter((item): item is string => typeof item === "string" && item in properties)
        .slice(0, 16)
    : undefined;
  return {
    type: "object",
    properties,
    required: required?.length ? required : undefined,
    additionalProperties: value.additionalProperties === true ? true : false,
  };
}

function normalizeConfigValues(raw: unknown, fields: PluginConfigField[]): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const field of fields) {
    const item = value[field.key];
    if (item === undefined || item === null) continue;
    const text =
      typeof item === "boolean" || typeof item === "number" ? String(item) : String(item);
    if (text.trim()) out[field.key] = text.trim();
  }
  return out;
}

function normalizeBody(raw: unknown): string | Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw.slice(0, 8_192);
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return undefined;
}

function stringMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim() || typeof value !== "string") continue;
    out[key.trim()] = value;
    if (Object.keys(out).length >= 16) break;
  }
  return out;
}

export function parseJsonArg(raw: unknown): unknown {
  if (raw == null) return undefined;
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function strArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function hostnameOf(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    return parsed.hostname ? parsed.hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function hostTemplatePart(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("/")) return "";
  if (trimmed.startsWith("{{")) return /^\{\{\s*args\./i.test(trimmed) ? trimmed : "";
  const match = trimmed.match(/^https?:\/\/([^/]+)/i);
  return match?.[1] ?? "";
}
