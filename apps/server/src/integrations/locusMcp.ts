import {
  isBrainMcpToolName,
  isCanvasMcpToolName,
  isForgeMcpToolName,
  isHostSessionsToolName,
  isIntegrationToolName,
} from "@locus/shared";
import { isCliGitTool } from "./cliGitMcp.js";

export interface LocusMcpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface LocusMcpContext {
  tools: LocusMcpTool[];
  instructions?: string;
  call: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{
    ok: boolean;
    output: string;
    screenshotBase64?: string;
    screenshotMime?: string;
    status?: "success" | "failed" | "blocked";
    category?: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  }>;
}

interface JsonRpc {
  jsonrpc: "2.0";
  id?: unknown;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function dispatchLocusMcp(
  raw: unknown,
  ctx: LocusMcpContext,
): Promise<JsonRpc | JsonRpc[] | undefined> {
  if (Array.isArray(raw)) {
    const out: JsonRpc[] = [];
    for (const item of raw) {
      const reply = await handleLocusMcpRpc(item, ctx);
      if (reply) out.push(reply);
    }
    return out.length ? out : undefined;
  }
  return handleLocusMcpRpc(raw, ctx);
}

export async function handleLocusMcpRpc(
  raw: unknown,
  ctx: LocusMcpContext,
): Promise<JsonRpc | undefined> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return rpcError(null, -32600, "Invalid Request");
  }
  const msg = raw as JsonRpc;
  const method = typeof msg.method === "string" ? msg.method : "";
  if (!method) return rpcError(msg.id ?? null, -32600, "Invalid Request");
  if (msg.id === undefined || msg.id === null) return undefined;

  if (method === "initialize") {
    const params = asRecord(msg.params);
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    const result = {
      protocolVersion: requested.trim() || "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "locus", version: "0.18.0" },
      ...(ctx.instructions?.trim() ? { instructions: ctx.instructions.trim() } : {}),
    };
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result,
    };
  }
  if (method === "ping") return { jsonrpc: "2.0", id: msg.id, result: {} };
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id: msg.id, result: { tools: ctx.tools } };
  }
  if (method === "tools/call") {
    const params = asRecord(msg.params);
    const name = typeof params.name === "string" ? params.name.trim() : "";
    const args = asRecord(params.arguments);
    if (
      !isIntegrationToolName(name) &&
      !isForgeMcpToolName(name) &&
      !isBrainMcpToolName(name) &&
      !isCliGitTool(name) &&
      !isCanvasMcpToolName(name) &&
      !isHostSessionsToolName(name)
    ) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: `Unknown Locus tool: ${name || "(none)"}` }],
          isError: true,
          structuredContent: {
            ok: false,
            status: "failed",
            category: "unknown-tool",
            retryable: false,
          },
        },
      };
    }
    const result = await ctx.call(name, args);
    const structuredContent = {
      ok: result.ok,
      status: result.status ?? (result.ok ? "success" : "failed"),
      ...(result.category ? { category: result.category } : {}),
      ...(result.retryable !== undefined ? { retryable: result.retryable } : {}),
      ...(result.details ? { details: result.details } : {}),
    };
    const content: Array<
      { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
    > = [{ type: "text", text: result.output }];
    const image = result.screenshotBase64?.replace(/\s/g, "");
    if (image) {
      content.push({
        type: "image",
        data: image,
        mimeType: result.screenshotMime?.trim() || "image/png",
      });
    }
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content,
        isError: !result.ok,
        ...(!result.ok ? { structuredContent } : {}),
      },
    };
  }
  if (method === "prompts/list") {
    return { jsonrpc: "2.0", id: msg.id, result: { prompts: [] } };
  }
  if (method === "resources/list") {
    return { jsonrpc: "2.0", id: msg.id, result: { resources: [] } };
  }
  return rpcError(msg.id, -32601, `Method not found: ${method}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function rpcError(id: unknown, code: number, message: string): JsonRpc {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
