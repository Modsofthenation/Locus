import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  mergeClaudeMcpJson,
  mergeKiroMcpJson,
  mergeLocusMcpJson,
  parseWorkerCliMcpLine,
  startWorkerLoopbackMcp,
  workerLoopbackMcpUrls,
  writeWorkerLocusMcpConfig,
  WORKER_CLI_MCP_EVENT,
} from "./loopbackMcp.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) {
    const close = cleanup.pop();
    if (close) await close().catch(() => undefined);
  }
});

describe("worker loopback MCP", () => {
  it("parses multiplexed CLI MCP frames and ignores Cursor events", () => {
    expect(parseWorkerCliMcpLine("not json")).toBeUndefined();
    expect(
      parseWorkerCliMcpLine(
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
      ),
    ).toBeUndefined();
    expect(
      parseWorkerCliMcpLine(
        JSON.stringify({
          type: WORKER_CLI_MCP_EVENT,
          id: "req-1",
          path: "/mcp/sessions/sess-1",
          body: { jsonrpc: "2.0", id: 1, method: "initialize" },
        }),
      ),
    ).toEqual({
      type: WORKER_CLI_MCP_EVENT,
      id: "req-1",
      path: "/mcp/sessions/sess-1",
      body: { jsonrpc: "2.0", id: 1, method: "initialize" },
    });
  });

  it("binds loopback only and scopes session URLs", async () => {
    const mcp = await startWorkerLoopbackMcp({
      sessionId: "sess-1",
      onRequest: async (req) => ({
        status: 200,
        body: { ok: true, path: req.path, method: (req.body as { method?: string })?.method },
      }),
    });
    cleanup.push(mcp.close);
    expect(mcp.url).toBe(`http://127.0.0.1:${mcp.port}/mcp`);
    expect(mcp.sessionUrl).toBe(`http://127.0.0.1:${mcp.port}/mcp/sessions/sess-1`);
    expect(workerLoopbackMcpUrls(mcp.port, "sess-1")).toEqual({
      url: mcp.url,
      sessionUrl: mcp.sessionUrl,
    });

    const initialized = await fetch(mcp.sessionUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(initialized.status).toBe(200);
    expect(await initialized.json()).toEqual({
      ok: true,
      path: "/mcp/sessions/sess-1",
      method: "initialize",
    });

    const other = await fetch(`http://127.0.0.1:${mcp.port}/mcp/sessions/other`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize" }),
    });
    expect(other.status).toBe(404);
  });

  it("writes session MCP json without secrets and keeps other servers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-mcp-"));
    await mkdir(join(dir, ".cursor"), { recursive: true });
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(
      join(dir, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "echo" } } }),
    );
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "echo" } } }),
    );
    const url = "http://127.0.0.1:17420/mcp/sessions/sess-1";
    await writeWorkerLocusMcpConfig(dir, url);
    const written = JSON.parse(await readFile(join(dir, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, { url?: string; command?: string }>;
    };
    expect(written.mcpServers.other).toEqual({ command: "echo" });
    expect(written.mcpServers.locus).toEqual({ url });
    expect(JSON.stringify(written)).not.toMatch(/token|secret|glsa_/i);
    expect(url).not.toBe("http://127.0.0.1:7420/mcp");
    const exclude = await readFile(join(dir, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain(".cursor/mcp.json");
    expect(exclude).toContain(".mcp.json");
    expect(mergeLocusMcpJson({}, url).mcpServers.locus).toEqual({ url });
    const claude = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { type?: string; url?: string; command?: string }>;
    };
    expect(claude.mcpServers.other).toEqual({ command: "echo" });
    expect(claude.mcpServers.locus).toEqual({ type: "http", url });
    expect(mergeClaudeMcpJson({}, url).mcpServers.locus).toEqual({ type: "http", url });
    const kiro = JSON.parse(await readFile(join(dir, ".kiro", "settings", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, { url?: string; autoApprove?: string[] }>;
    };
    expect(kiro.mcpServers.locus).toEqual({ url, autoApprove: ["*"] });
    expect(mergeKiroMcpJson({}, url).mcpServers.locus).toEqual({ url, autoApprove: ["*"] });
    expect(exclude).toContain(".kiro/settings/mcp.json");
  });
});
