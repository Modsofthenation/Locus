import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpHub, mcpChildEnv } from "./mcp.js";

const fixture = `#!/usr/bin/env node
let buf = Buffer.alloc(0);
const tools = [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }];
function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write("Content-Length: " + Buffer.byteLength(json) + "\\r\\n\\r\\n" + json);
}
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const idx = buf.indexOf("\\r\\n\\r\\n");
    if (idx < 0) return;
    const header = buf.subarray(0, idx).toString("utf8");
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) return;
    const len = Number(match[1]);
    const start = idx + 4;
    if (buf.length < start + len) return;
    const msg = JSON.parse(buf.subarray(start, start + len).toString("utf8"));
    buf = buf.subarray(start + len);
    if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } });
    else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools } });
    else if (msg.method === "tools/call") {
      const kind = String(msg.params?.arguments?.text ?? "");
      if (kind === "die") process.exit(1);
      const text = kind === "env" ? (process.env.LOCUS_MASTER_KEY ? "leaked" : "no-master") : kind;
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }] } });
    }
  }
});
`;

async function waitUntil(check: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(check()).toBe(true);
}

describe("McpHub", () => {
  const previousKey = process.env.LOCUS_MASTER_KEY;
  afterEach(() => {
    if (previousKey === undefined) delete process.env.LOCUS_MASTER_KEY;
    else process.env.LOCUS_MASTER_KEY = previousKey;
  });

  it.skipIf(process.platform === "win32")("lists and calls a stdio MCP server", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-mcp-"));
    const script = join(dir, "server.mjs");
    await writeFile(script, fixture, { mode: 0o755 });
    const hub = new McpHub();
    await hub.setServers([
      {
        id: "echo",
        name: "Echo",
        enabled: true,
        command: process.execPath,
        args: [script],
        env: {},
      },
    ]);
    const tools = hub.listTools();
    expect(tools.some((t) => t.name === "mcp_echo_echo")).toBe(true);
    expect(hub.promptTools().some((t) => t.name === "mcp_list_tools")).toBe(true);
    expect(hub.promptTools().some((t) => t.name === "mcp_echo_echo")).toBe(false);
    expect(hub.listCatalog()).toMatch(/echo/);
    expect(hub.getToolInfo(undefined, "echo", "echo")).toMatch(/echo/);
    const native = await hub.callNative(undefined, "echo", "echo", { text: "via-native" });
    expect(native.ok).toBe(true);
    expect(native.output).toBe("via-native");
    const result = await hub.call("mcp_echo_echo", { text: "hello-mcp" });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("hello-mcp");
    hub.close();
  });

  it.skipIf(process.platform === "win32")(
    "does not pass LOCUS_MASTER_KEY into MCP children",
    async () => {
      process.env.LOCUS_MASTER_KEY = "should-not-leak";
      expect(mcpChildEnv().LOCUS_MASTER_KEY).toBeUndefined();
      expect(mcpChildEnv({ TOKEN: "from-config", LOCUS_MASTER_KEY: "from-mcp-config" }).TOKEN).toBe(
        "from-config",
      );
      expect(mcpChildEnv({ LOCUS_MASTER_KEY: "from-mcp-config" }).LOCUS_MASTER_KEY).toBeUndefined();
      const dir = await mkdtemp(join(tmpdir(), "locus-mcp-env-"));
      const script = join(dir, "server.mjs");
      await writeFile(script, fixture, { mode: 0o755 });
      const hub = new McpHub();
      await hub.setServers([
        {
          id: "echo",
          name: "Echo",
          enabled: true,
          command: process.execPath,
          args: [script],
          env: {},
        },
      ]);
      const result = await hub.call("mcp_echo_echo", { text: "env" });
      expect(result.output).toBe("no-master");
      hub.close();
    },
  );

  it.skipIf(process.platform === "win32")(
    "drops a server after the child exits so the same config can relaunch",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-mcp-exit-"));
      const script = join(dir, "server.mjs");
      await writeFile(script, fixture, { mode: 0o755 });
      const hub = new McpHub();
      const config = {
        id: "echo",
        name: "Echo",
        enabled: true,
        command: process.execPath,
        args: [script],
        env: {},
      };
      await hub.setServers([config]);
      expect(hub.listTools().some((t) => t.name === "mcp_echo_echo")).toBe(true);
      const died = await hub.call("mcp_echo_echo", { text: "die" });
      expect(died.ok).toBe(false);
      await waitUntil(() => hub.listTools().length === 0);
      await hub.setServers([config]);
      expect(hub.listTools().some((t) => t.name === "mcp_echo_echo")).toBe(true);
      hub.close();
    },
  );

  it("lists and calls an HTTP MCP server", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const msg = JSON.parse(raw || "{}") as {
          id?: number;
          method?: string;
          params?: { arguments?: { text?: string } };
        };
        const result =
          msg.method === "initialize"
            ? {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "http", version: "1" },
              }
            : msg.method === "tools/list"
              ? {
                  tools: [
                    {
                      name: "echo",
                      description: "Echo",
                      inputSchema: { type: "object", properties: { text: { type: "string" } } },
                    },
                  ],
                }
              : { content: [{ type: "text", text: msg.params?.arguments?.text ?? "" }] };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const hub = new McpHub();
    await hub.setServers([
      {
        id: "http",
        name: "HTTP Echo",
        enabled: true,
        command: "mcp",
        args: [],
        env: {},
        url: `http://127.0.0.1:${port}/mcp`,
      },
    ]);
    expect(hub.listTools().some((t) => t.name === "mcp_http_echo")).toBe(true);
    const result = await hub.call("mcp_http_echo", { text: "via-http" });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("via-http");
    hub.close();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("signs HTTP MCP POSTs with SigV4 when AWS keys are in env", async () => {
    const { createServer } = await import("node:http");
    const auths: string[] = [];
    const server = createServer((req, res) => {
      auths.push(String(req.headers.authorization ?? ""));
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const msg = JSON.parse(raw || "{}") as {
          id?: number;
          method?: string;
          params?: { arguments?: { text?: string } };
        };
        const result =
          msg.method === "initialize"
            ? {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "http", version: "1" },
              }
            : msg.method === "tools/list"
              ? {
                  tools: [
                    {
                      name: "echo",
                      description: "Echo",
                      inputSchema: { type: "object", properties: { text: { type: "string" } } },
                    },
                  ],
                }
              : { content: [{ type: "text", text: msg.params?.arguments?.text ?? "" }] };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const hub = new McpHub();
    await hub.setServers([
      {
        id: "http",
        name: "HTTP Echo",
        enabled: true,
        command: "mcp",
        args: [],
        env: {
          AWS_ACCESS_KEY_ID: "AKIATEST",
          AWS_SECRET_ACCESS_KEY: "secret",
          AWS_REGION: "us-east-1",
          AWS_SIGV4: "execute-api",
        },
        url: `http://127.0.0.1:${port}/mcp`,
      },
    ]);
    expect(hub.listTools().some((t) => t.name === "mcp_http_echo")).toBe(true);
    const result = await hub.call("mcp_http_echo", { text: "signed" });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("signed");
    expect(auths.length).toBeGreaterThan(0);
    expect(auths.every((row) => row.startsWith("AWS4-HMAC-SHA256 "))).toBe(true);
    hub.close();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it.skipIf(process.platform === "win32")(
    "attaches guest stdio MCP without listing it on the host hub",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-mcp-guest-"));
      const script = join(dir, "server.mjs");
      await writeFile(script, fixture, { mode: 0o755 });
      const hub = new McpHub({
        spawnGuest: (_containerId, command, args, env) =>
          spawn(command, args, {
            env: { ...process.env, ...env },
            stdio: ["pipe", "pipe", "pipe"],
          }),
      });
      await hub.setServers([
        {
          id: "echo",
          name: "Echo",
          enabled: true,
          runtime: "guest",
          command: process.execPath,
          args: [script],
          env: {},
        },
      ]);
      expect(hub.listTools()).toEqual([]);
      await hub.attachGuest("sess-1", "cid123", [
        {
          id: "echo",
          name: "Echo",
          enabled: true,
          runtime: "guest",
          command: process.execPath,
          args: [script],
          env: {},
        },
      ]);
      expect(hub.listTools().some((t) => t.name === "mcp_echo_echo")).toBe(false);
      expect(hub.listTools("sess-1").some((t) => t.name === "mcp_echo_echo")).toBe(true);
      const result = await hub.call("mcp_echo_echo", { text: "from-guest" }, "sess-1");
      expect(result).toEqual({ ok: true, output: "from-guest" });
      hub.detachGuest("sess-1");
      expect(hub.listTools("sess-1")).toEqual([]);
      hub.close();
    },
  );
});
