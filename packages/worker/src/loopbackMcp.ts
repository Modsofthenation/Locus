import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const WORKER_CLI_MCP_EVENT = "locus_mcp";
export const WORKER_CLI_MCP_REL = ".cursor/mcp.json";
export const WORKER_CLAUDE_MCP_REL = ".mcp.json";
export const WORKER_KIRO_MCP_REL = ".kiro/settings/mcp.json";
export const WORKER_CLI_MCP_TIMEOUT_MS = 45_000;
const LOCUS_MCP_SERVER_NAME = "locus";
const GIT_EXCLUDES = [
  ".cursor/mcp.json",
  ".cursor/rules/locus.mdc",
  ".mcp.json",
  ".kiro/settings/mcp.json",
] as const;
const MAX_MCP_BODY_BYTES = 1_000_000;

export interface WorkerCliMcpRequest {
  type: typeof WORKER_CLI_MCP_EVENT;
  id: string;
  path: string;
  body: unknown;
}

export interface WorkerLoopbackMcpReply {
  status: number;
  body?: unknown;
}

export function workerLoopbackMcpUrls(
  port: number,
  sessionId: string,
): { url: string; sessionUrl: string } {
  const url = `http://127.0.0.1:${port}/mcp`;
  return {
    url,
    sessionUrl: `${url}/sessions/${encodeURIComponent(sessionId)}`,
  };
}

export function parseWorkerCliMcpLine(line: string): WorkerCliMcpRequest | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const row = JSON.parse(trimmed) as Record<string, unknown>;
    if (row.type !== WORKER_CLI_MCP_EVENT) return undefined;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const path = typeof row.path === "string" ? row.path.trim() : "";
    if (!id || !path.startsWith("/mcp")) return undefined;
    return { type: WORKER_CLI_MCP_EVENT, id, path, body: row.body };
  } catch {
    return undefined;
  }
}

function mcpServersOf(existing: unknown): Record<string, unknown> {
  if (
    existing &&
    typeof existing === "object" &&
    !Array.isArray(existing) &&
    (existing as { mcpServers?: unknown }).mcpServers &&
    typeof (existing as { mcpServers?: unknown }).mcpServers === "object" &&
    !Array.isArray((existing as { mcpServers: unknown }).mcpServers)
  ) {
    return { ...(existing as { mcpServers: Record<string, unknown> }).mcpServers };
  }
  return {};
}

export function mergeLocusMcpJson(
  existing: unknown,
  url: string,
): { mcpServers: Record<string, unknown> } {
  const servers = mcpServersOf(existing);
  servers[LOCUS_MCP_SERVER_NAME] = { url };
  return { mcpServers: servers };
}

/** Claude Code project MCP (`type: http`). Cursor keeps `{ url }` in `.cursor/mcp.json`. */
export function mergeClaudeMcpJson(
  existing: unknown,
  url: string,
): { mcpServers: Record<string, unknown> } {
  const servers = mcpServersOf(existing);
  servers[LOCUS_MCP_SERVER_NAME] = { type: "http", url };
  return { mcpServers: servers };
}

export function mergeKiroMcpJson(
  existing: unknown,
  url: string,
): { mcpServers: Record<string, unknown> } {
  const servers = mcpServersOf(existing);
  servers[LOCUS_MCP_SERVER_NAME] = { url, autoApprove: ["*"] };
  return { mcpServers: servers };
}

async function writeMcpFile(
  file: string,
  url: string,
  merge: (existing: unknown, url: string) => { mcpServers: Record<string, unknown> },
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  let existing: unknown;
  try {
    existing = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    existing = undefined;
  }
  const nextText = `${JSON.stringify(merge(existing, url), null, 2)}\n`;
  try {
    if ((await readFile(file, "utf8")) === nextText) return;
  } catch {
    /* missing */
  }
  await writeFile(file, nextText);
}

export async function writeWorkerLocusMcpConfig(workspace: string, url: string): Promise<void> {
  await writeMcpFile(join(workspace, WORKER_CLI_MCP_REL), url, mergeLocusMcpJson);
  await writeMcpFile(join(workspace, WORKER_CLAUDE_MCP_REL), url, mergeClaudeMcpJson);
  await writeMcpFile(join(workspace, WORKER_KIRO_MCP_REL), url, mergeKiroMcpJson);
  await excludeLocusCursorWorkspaceFiles(workspace);
}

export async function startWorkerLoopbackMcp(input: {
  sessionId: string;
  onRequest: (req: WorkerCliMcpRequest) => Promise<WorkerLoopbackMcpReply>;
}): Promise<{
  port: number;
  url: string;
  sessionUrl: string;
  close: () => Promise<void>;
}> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) throw new Error("Worker loopback MCP needs a session id");
  const server = createServer((req, res) => {
    void handleLoopbackMcpRequest(req, res, sessionId, input.onRequest);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("Worker loopback MCP failed to bind");
  }
  const urls = workerLoopbackMcpUrls(addr.port, sessionId);
  return {
    port: addr.port,
    ...urls,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handleLoopbackMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  onRequest: (req: WorkerCliMcpRequest) => Promise<WorkerLoopbackMcpReply>,
): Promise<void> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }
  if (path !== "/mcp" && !path.startsWith("/mcp/sessions/")) {
    json(res, 404, { error: "Not found" });
    return;
  }
  if (path.startsWith("/mcp/sessions/")) {
    const requested = decodeURIComponent(path.slice("/mcp/sessions/".length));
    if (requested !== sessionId) {
      json(res, 404, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32004, message: "Unknown session" },
      });
      return;
    }
  }
  let raw: Buffer;
  try {
    raw = await readBody(req, MAX_MCP_BODY_BYTES);
  } catch {
    json(res, 413, { error: "MCP request too large" });
    return;
  }
  let body: unknown = undefined;
  if (raw.length) {
    try {
      body = JSON.parse(raw.toString("utf8")) as unknown;
    } catch {
      json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
  }
  try {
    const reply = await onRequest({
      type: WORKER_CLI_MCP_EVENT,
      id: randomUUID(),
      path,
      body,
    });
    const status = Number.isInteger(reply.status) ? reply.status : 200;
    if (reply.body === undefined && (status === 202 || status === 204)) {
      res.statusCode = status;
      res.end();
      return;
    }
    json(res, status, reply.body ?? {});
  } catch (err) {
    json(res, 504, {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32000,
        message: err instanceof Error ? err.message : "Control plane MCP reply failed",
      },
    });
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = `${JSON.stringify(body)}\n`;
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(text));
  res.end(text);
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error("too large"));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function excludeLocusCursorWorkspaceFiles(workspace: string): Promise<void> {
  const gitDir = join(workspace, ".git");
  try {
    await stat(gitDir);
  } catch {
    return;
  }
  const exclude = join(gitDir, "info", "exclude");
  try {
    await mkdir(dirname(exclude), { recursive: true });
    let text = "";
    try {
      text = await readFile(exclude, "utf8");
    } catch {
      /* new exclude file */
    }
    let next = text;
    for (const rel of GIT_EXCLUDES) {
      const pattern = new RegExp(`(^|\\n)${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\n|$)`);
      if (pattern.test(next)) continue;
      const prefix = next && !next.endsWith("\n") ? "\n" : "";
      next = `${next}${prefix}${rel}\n`;
    }
    if (next !== text) await writeFile(exclude, next);
  } catch {
    /* ignore */
  }
}
