import { createConnection } from "node:net";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockDockerEngine } from "@locus/hypervisor";
import { createWorkerApp } from "./app.js";
import { WorkerClient } from "./client.js";
import { parseWorkerCliMcpLine } from "./loopbackMcp.js";
import { loadOrCreateWorkerToken, workerTokenMatches } from "./token.js";

async function writeFakeCli(dir: string, name: string, source: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `#!/usr/bin/env node\n${source}`);
  await chmod(path, 0o755);
  return path;
}

describe("worker token", () => {
  it("compares bearer tokens without leaking length on match", () => {
    expect(workerTokenMatches("abc", "abc")).toBe(true);
    expect(workerTokenMatches("abc", "abd")).toBe(false);
    expect(workerTokenMatches(undefined, "abc")).toBe(false);
  });

  it("prints a new file token only on first create", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-token-"));
    const prev = process.env.LOCUS_WORKER_TOKEN;
    delete process.env.LOCUS_WORKER_TOKEN;
    try {
      const first = await loadOrCreateWorkerToken(dir);
      expect(first.created).toBe(true);
      expect(first.token.length).toBeGreaterThan(8);
      const again = await loadOrCreateWorkerToken(dir);
      expect(again.created).toBe(false);
      expect(again.token).toBe(first.token);
    } finally {
      if (prev === undefined) delete process.env.LOCUS_WORKER_TOKEN;
      else process.env.LOCUS_WORKER_TOKEN = prev;
    }
  });
});

describe("locus worker HTTP", () => {
  it("rejects missing tokens and runs a docker guest over HTTP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-"));
    const engine = new MockDockerEngine(dir);
    const app = createWorkerApp({ engine, token: "secret", name: "studio", hostname: "box" });
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as Record<string, unknown>;
    expect(healthBody).toMatchObject({
      service: "locus-worker",
      ok: true,
    });
    expect(healthBody.hostname).toBeUndefined();
    expect(healthBody.name).toBeUndefined();

    const denied = await app.request("/v1/info");
    expect(denied.status).toBe(401);

    const fetchFn: typeof fetch = async (input, init) =>
      app.request(String(input).replace("http://127.0.0.1:7421", ""), init);
    const client = new WorkerClient(
      { id: "w1", name: "studio", url: "http://127.0.0.1:7421", token: "secret" },
      fetchFn,
    );
    await expect(client.health()).resolves.toMatchObject({ ok: true, docker: "mock" });

    const wrong = new WorkerClient(
      { id: "w1", name: "studio", url: "http://127.0.0.1:7421", token: "nope" },
      fetchFn,
    );
    await expect(wrong.health()).rejects.toThrow(/unauthorized/i);

    const created = await client.create({
      sessionId: "s1",
      name: "agent",
      image: "locus/agent",
    });
    expect(created.runtime).toBe("docker");
    const started = await client.start(created.id);
    expect(["running", "ready", "booting"]).toContain(started.status);

    expect((await client.listGuests()).map((row) => row.id)).toContain(created.id);

    const tool = await client.execute(created.id, {
      name: "exec",
      args: { command: "echo hi" },
    });
    expect(tool.ok).toBe(true);
    expect(tool.output).toMatch(/hi|ok|mock/i);

    await client.destroy(created.id);
    expect(engine.get(created.id)).toBeUndefined();
  });

  it("creates a host-folder guest without Docker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-"));
    const engine = new MockDockerEngine(dir);
    const app = createWorkerApp({
      engine,
      token: "secret",
      name: "studio",
      dataDir: dir,
      allowHostRuntime: true,
    });
    const fetchFn: typeof fetch = async (input, init) =>
      app.request(String(input).replace("http://127.0.0.1:7421", ""), init);
    const client = new WorkerClient(
      { id: "w1", name: "studio", url: "http://127.0.0.1:7421", token: "secret" },
      fetchFn,
    );
    const created = await client.create({
      sessionId: "s-host",
      name: "host-agent",
      image: "host",
      runtime: "host",
    });
    expect(created.runtime).toBe("host");
    expect(engine.list()).toHaveLength(0);
    const write = await client.execute(created.id, {
      name: "file_write",
      args: { path: "/workspace/note.txt", content: "on worker" },
    });
    expect(write.ok).toBe(true);
    const tgz = await client.downloadWorkspace(created.id);
    expect(tgz.length).toBeGreaterThan(20);
    await client.destroy(created.id);
    expect((await client.listGuests()).map((row) => row.id)).not.toContain(created.id);

    await expect(
      client.create({
        sessionId: "s-root",
        name: "host-root",
        image: "host",
        runtime: "host",
        hostDir: "/",
      }),
    ).rejects.toThrow(/filesystem root/);
  });

  it("refuses host-runtime guests unless the worker opted in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-"));
    const engine = new MockDockerEngine(dir);
    const app = createWorkerApp({ engine, token: "secret", name: "studio", dataDir: dir });
    const created = await app.request("/v1/guests", {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "s-host",
        name: "host-agent",
        image: "host",
        runtime: "host",
      }),
    });
    expect(created.status).toBe(400);
    expect(await created.text()).toMatch(/LOCUS_WORKER_ALLOW_HOST/i);
  });

  it("seeds a worker workspace and host share from tar uploads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-"));
    const engine = new MockDockerEngine(dir);
    const app = createWorkerApp({ engine, token: "secret", name: "studio", dataDir: dir });
    const fetchFn: typeof fetch = async (input, init) =>
      app.request(String(input).replace("http://127.0.0.1:7421", ""), init);
    const client = new WorkerClient(
      { id: "w1", name: "studio", url: "http://127.0.0.1:7421", token: "secret" },
      fetchFn,
    );
    const seed = await mkdtemp(join(tmpdir(), "locus-seed-"));
    const share = await mkdtemp(join(tmpdir(), "locus-share-"));
    const { writeFile, readFile } = await import("node:fs/promises");
    await writeFile(join(seed, "app.ts"), "export {}\n");
    await writeFile(join(share, "pkg.deb"), "deb\n");
    const created = await client.create({
      sessionId: "s-seed",
      name: "agent",
      image: "locus/agent",
      hostShare: true,
    });
    await client.uploadTree(created.id, "workspace-seed", seed);
    await client.uploadTree(created.id, "host-share", share);
    const vm = engine.get(created.id);
    expect(await readFile(join(vm!.diskPath!, "app.ts"), "utf8")).toBe("export {}\n");
    expect(await readFile(join(dir, "host-shares", "s-seed", "pkg.deb"), "utf8")).toBe("deb\n");
    await client.destroy(created.id);
    await expect(readFile(join(dir, "host-shares", "s-seed", "pkg.deb"))).rejects.toThrow();
  });

  it("starts a restricted-jail CONNECT proxy and closes it on destroy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-"));
    const engine = new MockDockerEngine(dir);
    const app = createWorkerApp({ engine, token: "secret", name: "studio" });
    const fetchFn: typeof fetch = async (input, init) =>
      app.request(String(input).replace("http://127.0.0.1:7421", ""), init);
    const client = new WorkerClient(
      { id: "w1", name: "studio", url: "http://127.0.0.1:7421", token: "secret" },
      fetchFn,
    );
    const created = await client.create({
      sessionId: "s1",
      name: "agent",
      image: "locus/agent",
      network: "restricted",
      allowHosts: ["127.0.0.1"],
    });
    const net = engine.networkFor(created.id);
    expect(net?.jail).toBe("restricted");
    expect(net?.proxyPort).toBeGreaterThan(0);
    const denied = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: net!.proxyPort! }, () => {
        socket.write("CONNECT evil.example:443 HTTP/1.1\r\n\r\n");
      });
      const chunks: Buffer[] = [];
      socket.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
        const text = Buffer.concat(chunks).toString("utf8");
        if (text.includes("403") || text.includes("407") || text.includes("200")) {
          socket.end();
          resolve(text);
        }
      });
      socket.on("error", reject);
      socket.setTimeout(2000, () => {
        socket.destroy();
        reject(new Error("proxy request timed out"));
      });
    });
    expect(denied).toContain("407");
    await client.destroy(created.id);
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host: "127.0.0.1", port: net!.proxyPort! });
        socket.on("connect", () => {
          socket.destroy();
          reject(new Error("proxy still listening after destroy"));
        });
        socket.on("error", () => resolve());
      }),
    ).resolves.toBeUndefined();
  });

  it("lists and writes the worker bind-mount workspace and serves preview", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-"));
    const engine = new MockDockerEngine(dir);
    const app = createWorkerApp({ engine, token: "secret", name: "studio" });
    const fetchFn: typeof fetch = async (input, init) =>
      app.request(String(input).replace("http://127.0.0.1:7421", ""), init);
    const client = new WorkerClient(
      { id: "w1", name: "studio", url: "http://127.0.0.1:7421", token: "secret" },
      fetchFn,
    );
    const created = await client.create({
      sessionId: "s1",
      name: "agent",
      image: "locus/agent",
    });
    await client.start(created.id);
    await client.writeWorkspace(created.id, "index.html", "<html><body>hi</body></html>");
    await client.writeWorkspace(
      created.id,
      "logo.png",
      Buffer.from("png").toString("base64"),
      "base64",
    );
    const listed = await client.listWorkspace(created.id);
    expect(listed.some((row) => row.path === "index.html")).toBe(true);
    expect(listed.some((row) => row.path === "logo.png")).toBe(true);
    const file = await client.readWorkspace(created.id, "index.html");
    expect(file.content).toContain("hi");
    const raw = await client.readWorkspaceRaw(created.id, "logo.png");
    expect(raw.bytes.toString()).toBe("png");
    await client.writeWorkspace(
      created.id,
      "brief.pdf",
      Buffer.from("%PDF-1.4\n").toString("base64"),
      "base64",
    );
    const pdfRaw = await client.readWorkspaceRaw(created.id, "brief.pdf");
    expect(pdfRaw.mime).toMatch(/application\/pdf/);
    expect(pdfRaw.bytes.toString()).toContain("%PDF-1.4");
    await client.mkdirWorkspace(created.id, "src");
    await client.deleteWorkspace(created.id, "brief.pdf");
    const afterDelete = await client.listWorkspace(created.id);
    expect(afterDelete.some((row) => row.path === "brief.pdf")).toBe(false);
    expect(afterDelete.some((row) => row.path === "src")).toBe(true);
    await client.noteListeningPorts(created.id, [5173]);
    expect(await client.listListeningPorts(created.id)).toContain(5173);
    const preview = await client.proxyPreview({
      id: created.id,
      port: 5173,
      path: "/",
      search: "",
      method: "GET",
      headers: new Headers(),
    });
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain("hi");
  });

  it("streams Cursor CLI NDJSON from the worker bind-mount", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-cli-"));
    const command = await writeFakeCli(
      dir,
      "agent.mjs",
      `console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "w-cli" }));
console.log(JSON.stringify({ type: "result", subtype: "success", result: "ok" }));
`,
    );
    const engine = new MockDockerEngine(dir);
    const app = createWorkerApp({ engine, token: "secret", name: "studio" });
    const fetchFn: typeof fetch = async (input, init) =>
      app.request(String(input).replace("http://127.0.0.1:7421", ""), init);
    const client = new WorkerClient(
      { id: "w1", name: "studio", url: "http://127.0.0.1:7421", token: "secret" },
      fetchFn,
    );
    const created = await client.create({
      sessionId: "s1",
      name: "agent",
      image: "locus/agent",
    });
    const stream = await client.streamCursorCli(created.id, {
      command,
      args: ["--workspace", "/workspace"],
    });
    const text = await new Response(stream).text();
    expect(text).toContain("w-cli");
    expect(text).toContain("ok");
    const disk = engine.get(created.id)?.diskPath;
    expect(disk).toBeTruthy();
    const mcp = JSON.parse(await readFile(join(disk!, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: { locus?: { url?: string } };
    };
    expect(mcp.mcpServers.locus?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/sessions\/s1$/);
    expect(mcp.mcpServers.locus?.url).not.toBe("http://127.0.0.1:7420/mcp/sessions/s1");
    const claudeMcp = JSON.parse(await readFile(join(disk!, ".mcp.json"), "utf8")) as {
      mcpServers: { locus?: { type?: string; url?: string } };
    };
    expect(claudeMcp.mcpServers.locus).toEqual({
      type: "http",
      url: mcp.mcpServers.locus?.url,
    });
    const kiroMcp = JSON.parse(
      await readFile(join(disk!, ".kiro", "settings", "mcp.json"), "utf8"),
    ) as {
      mcpServers: { locus?: { url?: string; autoApprove?: string[] } };
    };
    expect(kiroMcp.mcpServers.locus).toEqual({
      url: mcp.mcpServers.locus?.url,
      autoApprove: ["*"],
    });

    const denied = await app.request(`/v1/guests/${created.id}/cursor-cli`, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ command: "bash", args: ["-c", "echo pwned"] }),
    });
    expect(denied.status).toBe(400);
  });

  it("forwards worker Cursor CLI MCP JSON-RPC to the control plane", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-cli-mcp-"));
    const command = await writeFakeCli(
      dir,
      "agent.mjs",
      `import { readFile } from "node:fs/promises";
import { join } from "node:path";
const mcp = JSON.parse(await readFile(join(process.cwd(), ".cursor", "mcp.json"), "utf8"));
const res = await fetch(mcp.mcpServers.locus.url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  }),
});
const json = await res.json();
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "w-mcp" }));
console.log(JSON.stringify({
  type: "assistant",
  timestamp_ms: 1,
  message: { content: [{ type: "text", text: "locus-mcp:" + (json.result?.serverInfo?.name ?? "missing") }] },
}));
console.log(JSON.stringify({ type: "result", subtype: "success", result: "ok" }));
`,
    );
    const engine = new MockDockerEngine(dir);
    const app = createWorkerApp({ engine, token: "secret", name: "studio" });
    const fetchFn: typeof fetch = async (input, init) =>
      app.request(String(input).replace("http://127.0.0.1:7421", ""), init);
    const client = new WorkerClient(
      { id: "w1", name: "studio", url: "http://127.0.0.1:7421", token: "secret" },
      fetchFn,
    );
    const created = await client.create({
      sessionId: "s-mcp",
      name: "agent",
      image: "locus/agent",
    });
    const stream = await client.streamCursorCli(created.id, {
      command,
      args: ["--workspace", "/workspace"],
    });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    let forwarded = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? "";
      for (const line of parts) {
        text += `${line}\n`;
        const mcp = parseWorkerCliMcpLine(line);
        if (!mcp) continue;
        forwarded = true;
        await client.replyCursorCliMcp(created.id, {
          id: mcp.id,
          status: 200,
          body: { jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "locus" } } },
        });
      }
    }
    expect(forwarded).toBe(true);
    expect(text).toContain("w-mcp");
    expect(text).toContain("locus-mcp:locus");
    expect(text).not.toContain("http://127.0.0.1:7420/mcp");
  });

  it("rewrites Codex locus_git onto worker loopback MCP and forwards JSON-RPC", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-codex-mcp-"));
    const command = await writeFakeCli(
      dir,
      "codex.mjs",
      `const url = process.env.LOCUS_GIT_MCP_URL;
if (!url || url.includes("7420")) {
  console.log(JSON.stringify({ type: "error", message: "bad git mcp " + url }));
  process.exit(0);
}
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  }),
});
const json = await res.json();
console.log(JSON.stringify({ type: "thread.started", thread_id: "w-codex" }));
console.log(JSON.stringify({
  type: "item.completed",
  item: { id: "msg-1", type: "agent_message", text: "locus-git:" + (json.result?.serverInfo?.name ?? "missing") },
}));
console.log(JSON.stringify({ type: "turn.completed", usage: {} }));
`,
    );
    const engine = new MockDockerEngine(dir);
    const app = createWorkerApp({ engine, token: "secret", name: "studio" });
    const fetchFn: typeof fetch = async (input, init) =>
      app.request(String(input).replace("http://127.0.0.1:7421", ""), init);
    const client = new WorkerClient(
      { id: "w1", name: "studio", url: "http://127.0.0.1:7421", token: "secret" },
      fetchFn,
    );
    const created = await client.create({
      sessionId: "s-codex",
      name: "agent",
      image: "locus/agent",
    });
    const stream = await client.streamCursorCli(created.id, {
      command,
      args: [
        "--cd",
        "/workspace",
        "--config",
        'mcp_servers.locus_git.url="http://127.0.0.1:7420/mcp/sessions/s-codex"',
      ],
    });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    let forwarded = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? "";
      for (const line of parts) {
        text += `${line}\n`;
        const mcp = parseWorkerCliMcpLine(line);
        if (!mcp) continue;
        forwarded = true;
        expect(mcp.path).toBe("/mcp/sessions/s-codex");
        await client.replyCursorCliMcp(created.id, {
          id: mcp.id,
          status: 200,
          body: { jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "locus" } } },
        });
      }
    }
    expect(forwarded).toBe(true);
    expect(text).toContain("w-codex");
    expect(text).toContain("locus-git:locus");
    expect(text).not.toContain("bad git mcp");
  });

  it("forwards abort to guest tool fetches and times out health", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-"));
    const engine = new MockDockerEngine(dir);
    const app = createWorkerApp({ engine, token: "secret", name: "studio" });
    let seen: AbortSignal | undefined;
    const fetchFn: typeof fetch = async (input, init) => {
      seen = init?.signal ?? undefined;
      return app.request(String(input).replace("http://127.0.0.1:7421", ""), init);
    };
    const client = new WorkerClient(
      { id: "w1", name: "studio", url: "http://127.0.0.1:7421", token: "secret" },
      fetchFn,
    );
    await client.health();
    expect(seen?.aborted).toBe(false);

    const hung: typeof fetch = async () =>
      new Promise((_, reject) => {
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        reject(err);
      });
    const slow = new WorkerClient(
      { id: "w1", name: "studio", url: "http://127.0.0.1:7421", token: "secret" },
      hung,
    );
    await expect(slow.health()).rejects.toThrow(/8s/);

    const vm = await client.create({ sessionId: "s1", name: "agent", image: "locus/agent" });
    const abort = new AbortController();
    await client.execute(vm.id, { name: "exec", args: { command: "echo hi" } }, abort.signal);
    expect(seen).toBe(abort.signal);
  });
});
