import { isIntegrationToolName } from "./integration.js";

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** HTTP/SSE MCP endpoint. When set, command is unused. */
  url?: string;
  /** Native tool names to expose. Empty means all. */
  allowedTools?: string[];
  /** When set, only tools whose description pin matches may be exposed. */
  toolHashes?: Record<string, string>;
  /** Operator-supplied version pin for this MCP server. */
  version?: string;
  /** host (default) runs on the operator machine; guest runs inside the container. */
  runtime?: "host" | "guest";
  /**
   * When true, every allowed tool schema is placed in the model prompt.
   * Default false: the model sees the server card and discovers schemas via mcp_list_tools / mcp_get_tool_info.
   */
  preload?: boolean;
  /** Native tool names to preload even when `preload` is false. */
  preloadTools?: string[];
  /** Injected by a managed policy profile; operators cannot remove it. */
  managed?: boolean;
}

export interface ExtraToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

const MCP_PREFIX = "mcp_";

export const MCP_LIST_TOOLS_NAME = "mcp_list_tools";
export const MCP_GET_TOOL_INFO_NAME = "mcp_get_tool_info";
export const MCP_CALL_NAME = "mcp_call";
export const MCP_CODE_NAME = "mcp_code";

const MCP_META_NAMES = new Set([
  MCP_LIST_TOOLS_NAME,
  MCP_GET_TOOL_INFO_NAME,
  MCP_CALL_NAME,
  MCP_CODE_NAME,
]);

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_PREFIX);
}

export function isMcpMetaToolName(name: string): boolean {
  return MCP_META_NAMES.has(name);
}

/** Flattened per-server tools (`mcp_github_list_issues`). Meta tools are not included. */
export function isMcpServerToolName(name: string): boolean {
  return isMcpToolName(name) && !isMcpMetaToolName(name);
}

/** Discovery tools do not wait for chat approval. `mcp_call` / `mcp_code` do. */
export function isMcpDiscoveryToolName(name: string): boolean {
  return name === MCP_LIST_TOOLS_NAME || name === MCP_GET_TOOL_INFO_NAME;
}

export function mcpServerPreload(server: Pick<McpServerConfig, "preload">): boolean {
  return server.preload === true;
}

export function parseMcpToolNames(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
  const names: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") continue;
    const name = part.trim();
    if (
      (!isMcpToolName(name) &&
        !isIntegrationToolName(name) &&
        !name.startsWith("plugin_") &&
        name !== "manage_integration_plugin") ||
      name.length > 64
    )
      continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Automations only call MCP tools the operator listed. Empty name is a no-op (resolver miss). */
export function automationAllowsMcpTool(
  session: { automationId?: string; allowedMcpTools?: string[] },
  name: string | undefined,
): boolean {
  if (!session.automationId || !name) return true;
  return (session.allowedMcpTools ?? []).includes(name);
}

export const WEBSEARCH_TOOL_NAME = "websearch";

export function isWebSearchToolName(name: string): boolean {
  return name === WEBSEARCH_TOOL_NAME;
}

export const WEBSEARCH_TOOL: ExtraToolDef = {
  name: WEBSEARCH_TOOL_NAME,
  description:
    "Search the public web from the host. Returns titles, URLs, and snippets. Use for current events and docs outside the guest.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      num_results: { type: "number", description: "How many results to return (1-8). Default 5." },
    },
    required: ["query"],
  },
};

export function mcpFunctionName(serverId: string, toolName: string): string {
  const server = sanitizeMcpToken(serverId, 24);
  const tool = sanitizeMcpToken(toolName, 32);
  return `${MCP_PREFIX}${server}_${tool}`.slice(0, 64);
}

export function parseMcpFunctionName(name: string): { serverId: string; rest: string } | undefined {
  if (!isMcpToolName(name)) return undefined;
  const body = name.slice(MCP_PREFIX.length);
  const idx = body.indexOf("_");
  if (idx <= 0) return undefined;
  return { serverId: body.slice(0, idx), rest: body.slice(idx + 1) };
}

export function sanitizeMcpCommand(raw: string): string | undefined {
  const command = raw.trim();
  if (!command || command.length > 256) return undefined;
  // `spawn()` receives the executable separately from its args, so spaces are
  // safe here and are required for common Windows installs (for example,
  // `C:\\Program Files\\nodejs\\node.exe`).
  if (/[;|&$<>`]/.test(command)) return undefined;
  return command;
}

export function sanitizeMcpToken(raw: string, max: number): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "tool").slice(0, max);
}

export function looksLikeSecretName(key: string): boolean {
  return /key|token|secret|password|passwd|auth|credential|bearer/i.test(key);
}

export const MCP_LIST_TOOLS: ExtraToolDef = {
  name: MCP_LIST_TOOLS_NAME,
  description:
    "List MCP servers and their tool names. Schemas are omitted until mcp_get_tool_info. Pass server to list one connector.",
  parameters: {
    type: "object",
    properties: {
      server: {
        type: "string",
        description: "Optional MCP server id or name. Omit to list every connected server.",
      },
    },
  },
};

export const MCP_GET_TOOL_INFO: ExtraToolDef = {
  name: MCP_GET_TOOL_INFO_NAME,
  description: "Fetch one MCP tool's description and JSON schema so you can call it with mcp_call.",
  parameters: {
    type: "object",
    properties: {
      server: { type: "string", description: "MCP server id or name" },
      tool: { type: "string", description: "Native tool name from mcp_list_tools" },
    },
    required: ["server", "tool"],
  },
};

export const MCP_CALL: ExtraToolDef = {
  name: MCP_CALL_NAME,
  description:
    "Invoke an MCP tool by server + native name. Waits for Approve / Deny like other MCP tools. Prefer mcp_code when aggregating or chaining several calls.",
  parameters: {
    type: "object",
    properties: {
      server: { type: "string", description: "MCP server id or name" },
      tool: { type: "string", description: "Native tool name" },
      args: { type: "object", description: "Tool arguments object" },
    },
    required: ["server", "tool"],
  },
};

export const MCP_CODE: ExtraToolDef = {
  name: MCP_CODE_NAME,
  description:
    "Run a short Python script with mcp_client.call_tool(server, name, arguments). Approving this tool covers inner MCP calls the script makes; only printed stdout returns. Use for counts, filters, and chaining IDs. Credentials never enter the script.",
  parameters: {
    type: "object",
    properties: {
      code: { type: "string", description: "Python source. Print the summary the operator needs." },
    },
    required: ["code"],
  },
};

export const MCP_META_TOOLS: ExtraToolDef[] = [
  MCP_LIST_TOOLS,
  MCP_GET_TOOL_INFO,
  MCP_CALL,
  MCP_CODE,
];

export type McpPromptServer = {
  id: string;
  name: string;
  preload: boolean;
  preloadTools?: string[];
  tools: ExtraToolDef[];
  nativeNames: Map<string, string>;
};

/** Flattened schemas for preloaded servers, plus meta tools when any server is deferred. */
export function selectMcpPromptTools(servers: McpPromptServer[]): ExtraToolDef[] {
  const out: ExtraToolDef[] = [];
  let deferred = false;
  for (const server of servers) {
    if (server.preload) {
      out.push(...server.tools);
      continue;
    }
    deferred = true;
    const allow = new Set(server.preloadTools ?? []);
    if (!allow.size) continue;
    for (const tool of server.tools) {
      const native = server.nativeNames.get(tool.name);
      if (allow.has(tool.name) || (native && allow.has(native))) out.push(tool);
    }
  }
  if (deferred) {
    const names = new Set(out.map((tool) => tool.name));
    for (const meta of MCP_META_TOOLS) {
      if (!names.has(meta.name)) out.push(meta);
    }
  }
  return out;
}

export function formatMcpConnectorCards(
  servers: Array<{ id: string; name: string; toolCount: number; preload: boolean }>,
): string {
  if (!servers.length) return "";
  return [
    "MCP connectors:",
    ...servers.map((server) =>
      server.preload
        ? `- ${server.name} (${server.id}): ${server.toolCount} tools preloaded as mcp_* functions`
        : `- ${server.name} (${server.id}): ${server.toolCount} tools. Call mcp_list_tools / mcp_get_tool_info, then mcp_call or mcp_code.`,
    ),
  ].join("\n");
}

export function parseMcpCallArguments(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { _raw: text };
    }
  }
  return {};
}

export function validateMcpServer(server: McpServerConfig): string | undefined {
  if (!server.name.trim()) return "MCP server name is required";
  if (server.runtime === "guest" && server.url?.trim()) {
    return "Guest MCP is stdio inside the container — HTTP/SSE stays on the host";
  }
  if (server.url?.trim()) {
    try {
      const parsed = new URL(server.url.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return "MCP URL must be http(s)";
    } catch {
      return "MCP URL is invalid";
    }
    return undefined;
  }
  if (!sanitizeMcpCommand(server.command)) {
    return "MCP command must be a single executable path — no shell characters";
  }
  for (const arg of server.args) {
    if (typeof arg !== "string") return "MCP args must be strings";
  }
  return undefined;
}
