import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtraToolDef, McpServerConfig } from "@locus/shared";
import {
  awsCredentialsFromEnv,
  formatMcpConnectorCards,
  mcpAwsService,
  mcpFunctionName,
  mcpServerPreload,
  mcpToolDescriptionAllowed,
  sanitizeMcpCommand,
  selectMcpPromptTools,
  validateMcpServer,
} from "@locus/shared";
import { applyAwsSigV4Headers } from "@locus/shared/awsSign";

interface JsonRpc {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
}

interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: ExtraToolDef["parameters"];
}

interface LiveServer {
  id: string;
  config: McpServerConfig;
  child?: ChildProcessWithoutNullStreams;
  httpUrl?: string;
  httpHeaders?: Record<string, string>;
  nextId: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>;
  buffer: Buffer;
  tools: ExtraToolDef[];
  nativeNames: Map<string, string>;
}

export class McpHub {
  private servers = new Map<string, LiveServer>();
  private guests = new Map<string, Map<string, LiveServer>>();

  constructor(
    private readonly opts: {
      dockerBin?: string;
      spawnGuest?: (
        containerId: string,
        command: string,
        args: string[],
        env: Record<string, string>,
      ) => ChildProcessWithoutNullStreams;
    } = {},
  ) {}

  async setServers(configs: McpServerConfig[]): Promise<void> {
    const wanted = configs.filter(
      (s) =>
        s.enabled &&
        s.runtime !== "guest" &&
        !validateMcpServer(s) &&
        (Boolean(s.url?.trim()) || Boolean(sanitizeMcpCommand(s.command))),
    );
    const wantedIds = new Set(wanted.map((s) => s.id));
    for (const [id, live] of this.servers) {
      if (!wantedIds.has(id)) this.stop(live);
    }
    for (const config of wanted) {
      const existing = this.servers.get(config.id);
      if (existing && sameLaunch(existing.config, config)) {
        existing.config = config;
        continue;
      }
      if (existing) this.stop(existing);
      try {
        const live = await bootServer(config);
        live.child?.on("exit", () => {
          if (this.servers.get(config.id) === live) this.servers.delete(config.id);
        });
        this.servers.set(config.id, live);
      } catch (err) {
        console.error(`MCP ${config.name}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  listTools(sessionId?: string): ExtraToolDef[] {
    return this.lives(sessionId).flatMap((live) => this.allowedTools(live));
  }

  promptTools(sessionId?: string): ExtraToolDef[] {
    return selectMcpPromptTools(
      this.lives(sessionId).map((live) => ({
        id: live.id,
        name: live.config.name,
        preload: mcpServerPreload(live.config),
        preloadTools: live.config.preloadTools,
        tools: this.allowedTools(live),
        nativeNames: live.nativeNames,
      })),
    );
  }

  connectorCards(sessionId?: string): string {
    return formatMcpConnectorCards(
      this.lives(sessionId).map((live) => ({
        id: live.config.id,
        name: live.config.name,
        toolCount: this.allowedTools(live).length,
        preload: mcpServerPreload(live.config),
      })),
    );
  }

  listCatalog(sessionId?: string, serverRef?: string): string {
    const lives = this.filterLives(sessionId, serverRef);
    if (serverRef && !lives.length) return `Unknown MCP server: ${serverRef}`;
    const payload = lives.map((live) => ({
      id: live.config.id,
      name: live.config.name,
      tools: this.allowedTools(live).map((tool) => ({
        nativeName: live.nativeNames.get(tool.name) ?? tool.name,
        functionName: tool.name,
        description: tool.description,
      })),
    }));
    return JSON.stringify(payload, null, 2);
  }

  getToolInfo(sessionId: string | undefined, serverRef: string, tool: string): string {
    const live = this.findLive(sessionId, serverRef);
    if (!live) return `Unknown MCP server: ${serverRef}`;
    const allowed = this.allowedTools(live);
    const match = allowed.find((item) => {
      const native = live.nativeNames.get(item.name);
      return item.name === tool || native === tool;
    });
    if (!match) return `Unknown MCP tool ${tool} on ${live.config.name}`;
    return JSON.stringify(
      {
        server: live.config.id,
        name: live.config.name,
        tool: live.nativeNames.get(match.name) ?? match.name,
        functionName: match.name,
        description: match.description,
        parameters: match.parameters,
      },
      null,
      2,
    );
  }

  async callNative(
    sessionId: string | undefined,
    serverRef: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; output: string }> {
    const live = this.findLive(sessionId, serverRef);
    if (!live) return { ok: false, output: `Unknown MCP server: ${serverRef}` };
    const allowed = this.allowedTools(live);
    const match = allowed.find((item) => {
      const native = live.nativeNames.get(item.name);
      return item.name === tool || native === tool;
    });
    const functionName = match?.name ?? mcpFunctionName(live.config.id, tool);
    return this.call(functionName, args, sessionId);
  }

  resolveFunctionName(
    sessionId: string | undefined,
    serverRef: string,
    tool: string,
  ): string | undefined {
    const live = this.findLive(sessionId, serverRef);
    if (!live) return undefined;
    const match = this.allowedTools(live).find((item) => {
      const native = live.nativeNames.get(item.name);
      return item.name === tool || native === tool;
    });
    return match?.name ?? mcpFunctionName(live.config.id, tool);
  }

  private lives(sessionId?: string): LiveServer[] {
    const lives = [...this.servers.values()];
    if (sessionId) lives.push(...(this.guests.get(sessionId)?.values() ?? []));
    return lives;
  }

  private allowedTools(live: LiveServer): ExtraToolDef[] {
    if (!live.config.allowedTools?.length) return live.tools;
    const allow = new Set(live.config.allowedTools);
    return live.tools.filter((tool) => {
      const native = live.nativeNames.get(tool.name);
      return allow.has(tool.name) || (native ? allow.has(native) : false);
    });
  }

  private findLive(sessionId: string | undefined, ref: string): LiveServer | undefined {
    const needle = ref.trim();
    return this.lives(sessionId).find(
      (live) => live.id === needle || live.config.id === needle || live.config.name === needle,
    );
  }

  private filterLives(sessionId: string | undefined, serverRef?: string): LiveServer[] {
    const lives = this.lives(sessionId);
    if (!serverRef?.trim()) return lives;
    const live = this.findLive(sessionId, serverRef);
    return live ? [live] : [];
  }

  async call(
    name: string,
    args: Record<string, unknown>,
    sessionId?: string,
  ): Promise<{ ok: boolean; output: string }> {
    const lives = [...this.servers.values()];
    if (sessionId) lives.push(...(this.guests.get(sessionId)?.values() ?? []));
    for (const live of lives) {
      const native = live.nativeNames.get(name);
      if (!native) continue;
      try {
        const result = (await rpc(live, "tools/call", { name: native, arguments: args })) as {
          content?: Array<{ type?: string; text?: string }>;
          isError?: boolean;
        };
        const text = (result.content ?? [])
          .map((part) => (typeof part.text === "string" ? part.text : JSON.stringify(part)))
          .join("\n")
          .trim();
        return { ok: !result.isError, output: text || "(empty MCP result)" };
      } catch (err) {
        return { ok: false, output: err instanceof Error ? err.message : "MCP tool failed" };
      }
    }
    return { ok: false, output: `Unknown MCP tool: ${name}` };
  }

  async attachGuest(
    sessionId: string,
    containerId: string,
    configs: McpServerConfig[],
  ): Promise<void> {
    this.detachGuest(sessionId);
    if (!CONTAINER_ID.test(containerId)) return;
    const wanted = configs.filter(
      (s) =>
        s.enabled &&
        s.runtime === "guest" &&
        !s.url?.trim() &&
        !validateMcpServer(s) &&
        Boolean(sanitizeMcpCommand(s.command)),
    );
    if (!wanted.length) return;
    const map = new Map<string, LiveServer>();
    this.guests.set(sessionId, map);
    for (const config of wanted) {
      try {
        const live = await bootGuestServer(config, containerId, this.opts);
        live.child?.on("exit", () => {
          map.delete(config.id);
        });
        map.set(config.id, live);
      } catch (err) {
        console.error(`Guest MCP ${config.name}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  detachGuest(sessionId: string): void {
    const map = this.guests.get(sessionId);
    if (!map) return;
    this.guests.delete(sessionId);
    for (const live of map.values()) this.stopLive(live);
  }

  close(): void {
    for (const live of this.servers.values()) this.stopLive(live);
    this.servers.clear();
    for (const sessionId of [...this.guests.keys()]) this.detachGuest(sessionId);
  }

  private stop(live: LiveServer): void {
    this.servers.delete(live.config.id);
    this.stopLive(live);
  }

  private stopLive(live: LiveServer): void {
    for (const pending of live.pending.values()) pending.reject(new Error("MCP server stopped"));
    live.pending.clear();
    live.child?.kill("SIGTERM");
  }
}

function sameLaunch(a: McpServerConfig, b: McpServerConfig): boolean {
  return (
    a.command === b.command &&
    a.url === b.url &&
    JSON.stringify(a.args) === JSON.stringify(b.args) &&
    JSON.stringify(a.env) === JSON.stringify(b.env) &&
    JSON.stringify(a.allowedTools ?? []) === JSON.stringify(b.allowedTools ?? []) &&
    JSON.stringify(a.toolHashes ?? {}) === JSON.stringify(b.toolHashes ?? {}) &&
    (a.version ?? "") === (b.version ?? "") &&
    (a.runtime ?? "host") === (b.runtime ?? "host")
  );
}

const CONTAINER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const MCP_ENV_ALLOW = new Set([
  "PATH",
  "PATHEXT",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "OS",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERPROFILE",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
]);

/** Host env for MCP children: PATH/locale/temp only — never LOCUS_MASTER_KEY or other secrets. */
export function mcpChildEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    const upper = key.toUpperCase();
    if (upper.startsWith("LOCUS_")) continue;
    if (MCP_ENV_ALLOW.has(upper) || upper.startsWith("LC_")) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (key.toUpperCase().startsWith("LOCUS_")) continue;
    env[key] = value;
  }
  return env;
}

async function bootServer(config: McpServerConfig): Promise<LiveServer> {
  if (config.url?.trim()) return bootHttpServer(config);
  const command = sanitizeMcpCommand(config.command);
  if (!command) throw new Error("Invalid MCP command");
  const child = spawn(command, config.args ?? [], {
    env: mcpChildEnv(config.env),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  return handshakeStdio(config, child);
}

async function bootGuestServer(
  config: McpServerConfig,
  containerId: string,
  opts: {
    dockerBin?: string;
    spawnGuest?: (
      containerId: string,
      command: string,
      args: string[],
      env: Record<string, string>,
    ) => ChildProcessWithoutNullStreams;
  },
): Promise<LiveServer> {
  const command = sanitizeMcpCommand(config.command);
  if (!command) throw new Error("Invalid MCP command");
  let envFile: string | undefined;
  const child = opts.spawnGuest
    ? opts.spawnGuest(containerId, command, config.args ?? [], config.env ?? {})
    : spawn(
        opts.dockerBin ?? "docker",
        [
          "exec",
          "-i",
          "-w",
          "/workspace",
          ...(await (async () => {
            const env: Record<string, string> = {};
            for (const [key, value] of Object.entries(config.env ?? {})) {
              if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !key.toUpperCase().startsWith("LOCUS_")) {
                env[key] = value;
              }
            }
            if (!Object.keys(env).length) return [];
            envFile = join(tmpdir(), `locus-mcp-env-${randomUUID()}.env`);
            await writeFile(
              envFile,
              `${Object.entries(env)
                .map(([key, value]) => `${key}=${value.replace(/\r?\n/g, " ")}`)
                .join("\n")}\n`,
              { encoding: "utf8", mode: 0o600 },
            );
            return ["--env-file", envFile];
          })()),
          containerId,
          command,
          ...(config.args ?? []),
        ],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      );
  if (envFile) {
    const path = envFile;
    const cleanup = () => rm(path, { force: true }).catch(() => undefined);
    child.once("exit", cleanup);
    child.once("error", cleanup);
  }
  const live = await handshakeStdio({ ...config, name: `${config.name} (guest)` }, child);
  live.config = config;
  for (const tool of live.tools) {
    tool.description = tool.description.replace(
      `[MCP:${config.name} (guest)]`,
      `[MCP:${config.name}/guest]`,
    );
  }
  return live;
}

async function handshakeStdio(
  config: McpServerConfig,
  child: ChildProcessWithoutNullStreams,
): Promise<LiveServer> {
  const live: LiveServer = {
    id: config.id,
    config,
    child,
    nextId: 1,
    pending: new Map(),
    buffer: Buffer.alloc(0),
    tools: [],
    nativeNames: new Map(),
  };
  child.stdout.on("data", (chunk: Buffer) => {
    live.buffer = Buffer.concat([live.buffer, chunk]);
    drain(live);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim();
    if (text) console.error(`MCP ${config.name}: ${text}`);
  });
  child.on("exit", () => {
    for (const pending of live.pending.values())
      pending.reject(new Error(`MCP ${config.name} exited`));
    live.pending.clear();
  });
  await rpc(live, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "locus", version: "0.17.0" },
  });
  notify(live, "notifications/initialized");
  const listed = (await rpc(live, "tools/list", {})) as { tools?: ListedTool[] };
  addListedTools(live, listed.tools, live.config.name);
  return live;
}

function addListedTools(live: LiveServer, tools: ListedTool[] | undefined, label: string): void {
  for (const tool of tools ?? []) {
    const description = tool.description || tool.name;
    if (!mcpToolDescriptionAllowed(description, live.config.toolHashes, tool.name)) continue;
    const fn = mcpFunctionName(live.config.id, tool.name);
    live.nativeNames.set(fn, tool.name);
    live.tools.push({
      name: fn,
      description: `[MCP:${label}] ${description}`,
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    });
  }
}

function notify(live: LiveServer, method: string, params?: unknown): void {
  write(live, { jsonrpc: "2.0", method, params });
}

function rpc(live: LiveServer, method: string, params: unknown): Promise<unknown> {
  if (live.httpUrl) return rpcHttp(live, method, params);
  const id = live.nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      live.pending.delete(id);
      reject(new Error(`MCP ${method} timed out`));
    }, 15_000);
    live.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    write(live, { jsonrpc: "2.0", id, method, params });
  });
}

function write(live: LiveServer, msg: JsonRpc): void {
  if (!live.child) return;
  const json = JSON.stringify(msg);
  live.child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

async function bootHttpServer(config: McpServerConfig): Promise<LiveServer> {
  const httpUrl = config.url!.trim();
  const httpHeaders: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (config.env.AUTHORIZATION) httpHeaders.authorization = config.env.AUTHORIZATION;
  else if (config.env.TOKEN) httpHeaders.authorization = `Bearer ${config.env.TOKEN}`;
  const live: LiveServer = {
    id: config.id,
    config,
    httpUrl,
    httpHeaders,
    nextId: 1,
    pending: new Map(),
    buffer: Buffer.alloc(0),
    tools: [],
    nativeNames: new Map(),
  };
  await rpc(live, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "locus", version: "0.17.0" },
  });
  const listed = (await rpc(live, "tools/list", {})) as { tools?: ListedTool[] };
  addListedTools(live, listed.tools, live.config.name);
  return live;
}

async function rpcHttp(live: LiveServer, method: string, params: unknown): Promise<unknown> {
  const id = live.nextId++;
  const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  const creds = awsCredentialsFromEnv(live.config.env);
  const headers = creds
    ? applyAwsSigV4Headers(
        live.httpUrl!,
        { method: "POST", headers: live.httpHeaders, body: payload },
        creds,
        mcpAwsService(live.httpUrl!, live.config.env),
      )
    : live.httpHeaders;
  const res = await fetch(live.httpUrl!, {
    method: "POST",
    headers,
    body: payload,
  });
  const ctype = res.headers.get("content-type") ?? "";
  let body: JsonRpc;
  if (ctype.includes("text/event-stream")) {
    const text = await res.text();
    const line = text.split(/\r?\n/).find((row) => row.startsWith("data:"));
    body = JSON.parse((line?.slice(5).trim() || "{}") as string) as JsonRpc;
  } else {
    body = (await res.json()) as JsonRpc;
  }
  if (body.error) throw new Error(body.error.message || "MCP error");
  return body.result;
}

function drain(live: LiveServer): void {
  while (true) {
    const msg = takeMessage(live);
    if (!msg) return;
    if (typeof msg.id !== "number") continue;
    const pending = live.pending.get(msg.id);
    if (!pending) continue;
    live.pending.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error.message || "MCP error"));
    else pending.resolve(msg.result);
  }
}

function takeMessage(live: LiveServer): JsonRpc | undefined {
  const headerEnd = live.buffer.indexOf("\r\n\r\n");
  if (headerEnd >= 0) {
    const header = live.buffer.subarray(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      live.buffer = live.buffer.subarray(headerEnd + 4);
      return undefined;
    }
    const len = Number(match[1]);
    const start = headerEnd + 4;
    if (live.buffer.length < start + len) return undefined;
    const body = live.buffer.subarray(start, start + len).toString("utf8");
    live.buffer = live.buffer.subarray(start + len);
    try {
      return JSON.parse(body) as JsonRpc;
    } catch {
      return undefined;
    }
  }
  const nl = live.buffer.indexOf(0x0a);
  if (nl > 0 && live.buffer[0] === 0x7b) {
    const line = live.buffer.subarray(0, nl).toString("utf8").trim();
    live.buffer = live.buffer.subarray(nl + 1);
    if (!line) return undefined;
    try {
      return JSON.parse(line) as JsonRpc;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
