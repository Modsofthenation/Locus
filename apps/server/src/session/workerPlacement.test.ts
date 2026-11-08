import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockComputeBackend } from "@locus/compute";
import { MockDockerEngine, MockHypervisor } from "@locus/hypervisor";
import type { WorkerBackend } from "@locus/shared";
import { CURSOR_CODING_ROUTING_CARD, formatWorkerAddBlob } from "@locus/shared";
import { createWorkerApp } from "@locus/worker";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { SessionService } from "./sessions.js";
import { JsonStore } from "../core/store.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

function workerFetch(app: ReturnType<typeof createWorkerApp>): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+/, "") || "/";
    return app.request(path, init);
  }) as typeof fetch;
}

async function setupWorkerPlane(opts?: {
  workers?: WorkerBackend[];
  compute?: MockComputeBackend;
}) {
  const dir = await mkdtemp(join(tmpdir(), "locus-worker-plane-"));
  const workerDir = await mkdtemp(join(tmpdir(), "locus-worker-engine-"));
  cleanup.push(dir, workerDir);
  const store = new JsonStore(dir);
  await store.init();
  const config = await store.loadConfig();
  config.workers = opts?.workers ?? [
    { id: "w1", name: "Studio", url: "http://127.0.0.1:7421", token: "secret" },
  ];
  await store.saveConfig(config);
  const workerEngine = new MockDockerEngine(workerDir);
  const workerHypervisor = new MockHypervisor(workerDir);
  const workerApp = createWorkerApp({
    engine: workerEngine,
    hypervisor: workerHypervisor,
    token: "secret",
    name: "studio",
    dataDir: workerDir,
    allowHostRuntime: true,
  });
  const localDocker = new MockDockerEngine(dir);
  const hypervisor = new MockHypervisor(dir);
  const sessions = new SessionService(
    store,
    hypervisor,
    new Hub(),
    undefined,
    undefined,
    localDocker,
    opts?.compute,
  );
  sessions.fetchFn = workerFetch(workerApp);
  const app = createApp({ store, sessions, hypervisor });
  return {
    store,
    sessions,
    app,
    workerEngine,
    workerHypervisor,
    localDocker,
    compute: opts?.compute,
    config: await store.loadConfig(),
  };
}

describe.skipIf(process.platform === "win32")("LAN worker placement", () => {
  it("boots a docker guest on the worker and runs tools without local docker", async () => {
    const { sessions, workerEngine, localDocker, config } = await setupWorkerPlane();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.placement).toBe("worker");
    expect(created.backendId).toBe("w1");
    expect(created.vmId).toBeTruthy();
    expect(localDocker.list()).toHaveLength(0);
    expect(workerEngine.list()).toHaveLength(1);
    expect(sessions.getMachine(created.vmId!)?.backendId).toBe("w1");

    const exec = await sessions.executeTool(created.id, {
      name: "exec",
      args: { command: "echo hi" },
    });
    expect(exec.ok).toBe(true);
    expect(exec.output).toMatch(/hi|ok|mock/i);

    await sessions.stopVm(created.id);
    expect(workerEngine.get(created.vmId!)).toBeUndefined();
    expect((await sessions.get(created.id))?.vmId).toBeUndefined();
    expect((await sessions.get(created.id))?.status).toBe("stopped");
    await sessions.remove(created.id);
    expect(workerEngine.list()).toHaveLength(0);
  });

  it("edits the worker bind-mount and opens preview through the worker proxy", async () => {
    const { sessions, app, workerEngine, config } = await setupWorkerPlane();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const vm = sessions.getMachine(created.vmId!);
      if (vm && (vm.status === "ready" || vm.status === "running")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await sessions.workspace.writeWorkspace(
      created.id,
      "index.html",
      "<html><body>worker-preview</body></html>",
    );
    const listed = await sessions.workspace.listWorkspace(created.id);
    expect(listed.entries.some((row) => row.path === "index.html")).toBe(true);
    const file = await sessions.workspace.readWorkspace(created.id, "index.html");
    expect(file.content).toContain("worker-preview");
    const preview = await sessions.executeTool(created.id, {
      name: "preview",
      args: { port: 5173 },
    });
    expect(preview.ok).toBe(true);
    const status = await sessions.previewStatus(created.id);
    expect(status.ports).toContain(5173);
    expect(status.active?.port).toBe(5173);
    const proxied = await app.request(`/api/sessions/${created.id}/preview-http/5173/`);
    expect(proxied.status).toBe(200);
    expect(proxied.headers.get("content-length")).toBeNull();
    const html = await proxied.text();
    expect(html).toContain("worker-preview");
    expect(html).toContain("<base href=");
    expect(workerEngine.get(created.vmId!)?.diskPath).toBeTruthy();
  });

  it("uploads a docker golden workspace and host share onto the worker", async () => {
    const { sessions, store, workerEngine, config } = await setupWorkerPlane();
    const seed = await mkdtemp(join(tmpdir(), "locus-docker-seed-"));
    cleanup.push(seed);
    await writeFile(join(seed, "from-seed.txt"), "golden\n");
    await mkdir(join(seed, ".locus"), { recursive: true });
    await writeFile(
      join(seed, ".locus", "environment.json"),
      JSON.stringify({ env: { LOCUS_SEED: "yes" } }),
    );
    const image = {
      id: "img1",
      name: "node workspace",
      os: "ubuntu" as const,
      path: seed,
      runtime: "docker" as const,
      dockerImage: "node:22-bookworm",
      createdAt: new Date().toISOString(),
    };
    await store.replaceImage(image);
    const next = await store.loadConfig();
    const share = join(store.dataDir, "share");
    await mkdir(share, { recursive: true });
    await writeFile(join(share, "installer.sh"), "echo hi\n");
    next.advanced.hostSharePath = share;
    await store.saveConfig(next);

    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
      imageId: image.id,
    });
    const disk = workerEngine.get(created.vmId!)?.diskPath;
    expect(disk).toBeTruthy();
    expect(await readFile(join(disk!, "from-seed.txt"), "utf8")).toBe("golden\n");
    const shareDest = join(disk!, "..", "..", "host-shares", created.id);
    expect(await readFile(join(shareDest, "installer.sh"), "utf8")).toBe("echo hi\n");
  });

  it("runs Cursor CLI against the worker bind-mount", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-agent-"));
    cleanup.push(dir);
    const script = join(dir, "fake-agent.mjs");
    const { chmod, writeFile } = await import("node:fs/promises");
    await writeFile(
      script,
      `#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const mcp = JSON.parse(await readFile(join(process.cwd(), ".cursor", "mcp.json"), "utf8"));
const url = mcp.mcpServers?.locus?.url;
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
const name = json?.result?.serverInfo?.name ?? json?.error?.message ?? "missing";
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "worker-cli" }));
console.log(JSON.stringify({ type: "assistant", timestamp_ms: 1, message: { content: [{ type: "text", text: "from-worker locus-mcp:" + name }] } }));
console.log(JSON.stringify({ type: "result", subtype: "success", result: "from-worker" }));
`,
    );
    await chmod(script, 0o755);
    const { sessions, store, config, workerEngine } = await setupWorkerPlane();
    const next = await store.loadConfig();
    const cursor = next.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    cursor.baseUrl = script;
    await store.saveConfig(next);
    sessions.cursorCliSpawner = () => {
      throw new Error("Cursor CLI on a worker must spawn on the worker host");
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: cursor.id,
      model: "composer-2",
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.placement).toBe("worker");
    await sessions.sendChat(created.id, "hi from worker");
    const deadline = Date.now() + 8000;
    let fresh = await sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await sessions.get(created.id);
      if (fresh && fresh.status !== "running" && fresh.cursorCli?.sessionId) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(fresh?.cursorCli?.sessionId).toBe("worker-cli");
    expect(
      fresh?.messages.some(
        (m) => m.role === "assistant" && m.content.includes("from-worker locus-mcp:locus"),
      ),
    ).toBe(true);
    const disk = workerEngine.get(created.vmId!)?.diskPath;
    expect(disk).toBeTruthy();
    const rule = await readFile(join(disk!, ".cursor", "rules", "locus.mdc"), "utf8");
    expect(rule).toContain("alwaysApply: true");
    expect(rule).toContain(CURSOR_CODING_ROUTING_CARD);
    const mcp = JSON.parse(await readFile(join(disk!, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: { locus?: { url?: string } };
    };
    expect(mcp.mcpServers.locus?.url).toMatch(
      new RegExp(`^http://127\\.0\\.0\\.1:\\d+/mcp/sessions/${created.id}$`),
    );
    expect(mcp.mcpServers.locus?.url).not.toBe(`http://127.0.0.1:7420/mcp/sessions/${created.id}`);
    expect(JSON.stringify(mcp)).not.toMatch(/secret|glsa_|token/i);
  });

  it("runs Codex CLI git MCP against the worker loopback proxy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-codex-"));
    cleanup.push(dir);
    const script = join(dir, "fake-codex.mjs");
    const { chmod, writeFile } = await import("node:fs/promises");
    await writeFile(
      script,
      `#!/usr/bin/env node
const url = process.env.LOCUS_GIT_MCP_URL;
if (!url || url.includes(":7420/")) {
  console.log(JSON.stringify({ type: "thread.started", thread_id: "worker-codex" }));
  console.log(JSON.stringify({
    type: "item.completed",
    item: { id: "msg-1", type: "agent_message", text: "from-worker locus-git:laptop-url" },
  }));
  console.log(JSON.stringify({ type: "turn.completed", usage: {} }));
  process.exit(0);
}
const init = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  }),
});
const listed = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
});
const tools = (await listed.json())?.result?.tools ?? [];
const git = tools.some((row) => row.name === "git_status") ? "git_status" : "missing";
const name = (await init.json())?.result?.serverInfo?.name ?? "missing";
console.log(JSON.stringify({ type: "thread.started", thread_id: "worker-codex" }));
console.log(JSON.stringify({
  type: "item.completed",
  item: { id: "msg-1", type: "agent_message", text: "from-worker locus-git:" + name + ":" + git },
}));
console.log(JSON.stringify({ type: "turn.completed", usage: {} }));
`,
    );
    await chmod(script, 0o755);
    const { sessions, store, config } = await setupWorkerPlane();
    const next = await store.loadConfig();
    const codex = next.providers.find((p) => p.kind === "codex-cli")!;
    codex.enabled = true;
    codex.baseUrl = script;
    await store.saveConfig(next);
    sessions.codexCliSpawner = () => {
      throw new Error("Codex CLI on a worker must spawn on the worker host");
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: codex.id,
      model: codex.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.placement).toBe("worker");
    await sessions.sendChat(created.id, "commit the fix");
    const deadline = Date.now() + 8000;
    let fresh = await sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await sessions.get(created.id);
      if (fresh && fresh.status !== "running" && fresh.codexCli?.sessionId) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(fresh?.codexCli?.sessionId).toBe("worker-codex");
    expect(
      fresh?.messages.some(
        (m) =>
          m.role === "assistant" && m.content.includes("from-worker locus-git:locus:git_status"),
      ),
    ).toBe(true);
  });

  it.each(["game", "design"] as const)(
    "runs Codex CLI %s playwright against the worker loopback proxy",
    async (kind) => {
      const dir = await mkdtemp(join(tmpdir(), `locus-worker-codex-${kind}-`));
      cleanup.push(dir);
      const script = join(dir, `fake-codex-${kind}.mjs`);
      const { chmod, writeFile } = await import("node:fs/promises");
      await writeFile(
        script,
        `#!/usr/bin/env node
const url = process.env.LOCUS_GIT_MCP_URL;
const toolsArg = process.argv.find((arg) => arg.includes("enabled_tools"));
const enabled = toolsArg?.includes("playwright") ? "playwright" : "missing";
if (!url || url.includes(":7420/")) {
  console.log(JSON.stringify({ type: "thread.started", thread_id: "worker-codex-canvas" }));
  console.log(JSON.stringify({
    type: "item.completed",
    item: { id: "msg-1", type: "agent_message", text: "from-worker canvas:" + enabled + ":laptop-url" },
  }));
  console.log(JSON.stringify({ type: "turn.completed", usage: {} }));
  process.exit(0);
}
const listed = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
});
const tools = (await listed.json())?.result?.tools ?? [];
const play = tools.some((row) => row.name === "playwright") ? "playwright" : "missing";
console.log(JSON.stringify({ type: "thread.started", thread_id: "worker-codex-canvas" }));
console.log(JSON.stringify({
  type: "item.completed",
  item: { id: "msg-1", type: "agent_message", text: "from-worker canvas:" + enabled + ":" + play },
}));
console.log(JSON.stringify({ type: "turn.completed", usage: {} }));
`,
      );
      await chmod(script, 0o755);
      const { sessions, store, config } = await setupWorkerPlane();
      const next = await store.loadConfig();
      const codex = next.providers.find((p) => p.kind === "codex-cli")!;
      codex.enabled = true;
      codex.baseUrl = script;
      await store.saveConfig(next);
      sessions.codexCliSpawner = () => {
        throw new Error("Codex CLI on a worker must spawn on the worker host");
      };
      const created = await sessions.create({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        kind,
        runtime: "docker",
        dockerImage: "locus/design",
        providerId: codex.id,
        model: codex.defaultModel,
        startVm: true,
        placement: "worker",
        backendId: "w1",
      });
      await sessions.sendChat(created.id, "look at the canvas");
      const deadline = Date.now() + 8000;
      let fresh = await sessions.get(created.id);
      while (Date.now() < deadline) {
        fresh = await sessions.get(created.id);
        if (fresh && fresh.status !== "running" && fresh.codexCli?.sessionId) break;
        await new Promise((r) => setTimeout(r, 30));
      }
      expect(fresh?.codexCli?.sessionId).toBe("worker-codex-canvas");
      expect(
        fresh?.messages.some(
          (m) =>
            m.role === "assistant" &&
            m.content.includes("from-worker canvas:playwright:playwright"),
        ),
      ).toBe(true);
    },
  );

  it("runs Claude Code MCP against the worker loopback proxy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-claude-"));
    cleanup.push(dir);
    const script = join(dir, "fake-claude.mjs");
    const { chmod, writeFile } = await import("node:fs/promises");
    await writeFile(
      script,
      `#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const mcp = JSON.parse(await readFile(join(process.cwd(), ".mcp.json"), "utf8"));
const url = mcp.mcpServers?.locus?.url;
const type = mcp.mcpServers?.locus?.type;
if (!url || type !== "http" || url.includes(":7420/")) {
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "worker-claude" }));
  console.log(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "from-worker locus-mcp:laptop-url" }] },
  }));
  console.log(JSON.stringify({ type: "result", subtype: "success", result: "from-worker" }));
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
const name = json?.result?.serverInfo?.name ?? json?.error?.message ?? "missing";
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "worker-claude" }));
console.log(JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "text", text: "from-worker locus-mcp:" + name }] },
}));
console.log(JSON.stringify({ type: "result", subtype: "success", result: "from-worker" }));
`,
    );
    await chmod(script, 0o755);
    const { sessions, store, config, workerEngine } = await setupWorkerPlane();
    const next = await store.loadConfig();
    const claude = next.providers.find((p) => p.kind === "claude-code")!;
    claude.enabled = true;
    claude.baseUrl = script;
    await store.saveConfig(next);
    sessions.claudeCodeSpawner = () => {
      throw new Error("Claude Code on a worker must spawn on the worker host");
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: claude.id,
      model: claude.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.placement).toBe("worker");
    await sessions.sendChat(created.id, "look at the canvas");
    const deadline = Date.now() + 8000;
    let fresh = await sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await sessions.get(created.id);
      if (fresh && fresh.status !== "running" && fresh.claudeCode?.sessionId) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(fresh?.claudeCode?.sessionId).toBe("worker-claude");
    expect(
      fresh?.messages.some(
        (m) => m.role === "assistant" && m.content.includes("from-worker locus-mcp:locus"),
      ),
    ).toBe(true);
    const disk = workerEngine.get(created.vmId!)?.diskPath;
    expect(disk).toBeTruthy();
    const mcp = JSON.parse(await readFile(join(disk!, ".mcp.json"), "utf8")) as {
      mcpServers: { locus?: { type?: string; url?: string } };
    };
    expect(mcp.mcpServers.locus?.type).toBe("http");
    expect(mcp.mcpServers.locus?.url).toMatch(
      new RegExp(`^http://127\\.0\\.0\\.1:\\d+/mcp/sessions/${created.id}$`),
    );
    expect(mcp.mcpServers.locus?.url).not.toBe(`http://127.0.0.1:7420/mcp/sessions/${created.id}`);
    expect(JSON.stringify(mcp)).not.toMatch(/secret|glsa_|token/i);
  });

  it("lands chat attachments onto the worker workspace for CLI turns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-attach-"));
    cleanup.push(dir);
    const script = join(dir, "fake-agent.mjs");
    const { chmod, writeFile } = await import("node:fs/promises");
    await writeFile(
      script,
      `#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const shot = await readFile(join(process.cwd(), ".locus-attachments", "hero.png"));
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "worker-attach" }));
console.log(JSON.stringify({
  type: "assistant",
  timestamp_ms: 1,
  message: { content: [{ type: "text", text: "from-worker attach:" + shot.toString() }] },
}));
console.log(JSON.stringify({ type: "result", subtype: "success", result: "from-worker" }));
`,
    );
    await chmod(script, 0o755);
    const { sessions, store, config, workerEngine } = await setupWorkerPlane();
    const next = await store.loadConfig();
    const cursor = next.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    cursor.baseUrl = script;
    await store.saveConfig(next);
    sessions.cursorCliSpawner = () => {
      throw new Error("Cursor CLI on a worker must spawn on the worker host");
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: cursor.id,
      model: "composer-2",
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.placement).toBe("worker");
    await sessions.sendChat(created.id, "use the attached photo", {
      attachments: [
        {
          name: "hero.png",
          mime: "image/png",
          contentBase64: Buffer.from("hero-bytes").toString("base64"),
        },
      ],
    });
    const deadline = Date.now() + 8000;
    let fresh = await sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await sessions.get(created.id);
      if (fresh && fresh.status !== "running" && fresh.cursorCli?.sessionId) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(fresh?.cursorCli?.sessionId).toBe("worker-attach");
    expect(
      fresh?.messages.some(
        (m) => m.role === "assistant" && m.content.includes("from-worker attach:hero-bytes"),
      ),
    ).toBe(true);
    const disk = workerEngine.get(created.vmId!)?.diskPath;
    expect(disk).toBeTruthy();
    expect(await readFile(join(disk!, ".locus-attachments", "hero.png"))).toEqual(
      Buffer.from("hero-bytes"),
    );
  });

  it("creates a host workspace on a worker", async () => {
    const { sessions, workerEngine, localDocker, config } = await setupWorkerPlane();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
      runtime: "host",
    });
    expect(created.placement).toBe("worker");
    expect(created.runtime).toBe("host");
    expect(created.vmId).toBeTruthy();
    expect(localDocker.list()).toHaveLength(0);
    expect(workerEngine.list()).toHaveLength(0);
    const write = await sessions.executeTool(created.id, {
      name: "file_write",
      args: { path: "/workspace/hello.txt", content: "from worker host" },
    });
    expect(write.ok).toBe(true);
  });

  it("rejects a missing worker", async () => {
    const { sessions, config } = await setupWorkerPlane();
    const base = {
      os: "ubuntu" as const,
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      placement: "worker" as const,
      backendId: "w1",
    };
    await expect(
      sessions.create({
        ...base,
        runtime: "docker",
        dockerImage: "node:22-bookworm",
        backendId: "missing",
      }),
    ).rejects.toThrow(/Settings → Workers/);
    const vm = await sessions.create({
      ...base,
      runtime: "vm",
      backendId: "w1",
    });
    expect(vm.runtime).toBe("vm");
    expect(vm.placement).toBe("worker");
  });

  it("boots a QEMU guest on the worker", async () => {
    const { sessions, workerEngine, workerHypervisor, localDocker, config } =
      await setupWorkerPlane();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "vm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.placement).toBe("worker");
    expect(created.runtime).toBe("vm");
    expect(created.vmId).toBeTruthy();
    expect(localDocker.list()).toHaveLength(0);
    expect(workerEngine.list()).toHaveLength(0);
    expect(workerHypervisor.get(created.vmId!)?.runtime).toBe("vm");
    const write = await sessions.executeTool(created.id, {
      name: "file_write",
      args: { path: "/home/locus/workspace/hello.txt", content: "from worker vm" },
    });
    expect(write.ok).toBe(true);
  });

  it("starts a restricted-jail CONNECT proxy on the worker", async () => {
    const { sessions, workerEngine, localDocker, config } = await setupWorkerPlane();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
      network: "restricted",
    });
    expect(created.network).toBe("restricted");
    expect(localDocker.list()).toHaveLength(0);
    const net = workerEngine.networkFor(created.vmId!);
    expect(net?.jail).toBe("restricted");
    expect(net?.proxyPort).toBeGreaterThan(0);
    const { createConnection } = await import("node:net");
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
    await sessions.remove(created.id);
    expect(workerEngine.list()).toHaveLength(0);
  });

  it("creates a design session on a worker and serves /workspace/index.html", async () => {
    const { sessions, app, workerEngine, localDocker, config } = await setupWorkerPlane();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      dockerImage: "locus/design",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.kind).toBe("design");
    expect(created.placement).toBe("worker");
    expect(created.vmId).toBeTruthy();
    expect(localDocker.list()).toHaveLength(0);
    expect(workerEngine.list()).toHaveLength(1);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const vm = sessions.getMachine(created.vmId!);
      if (vm && (vm.status === "ready" || vm.status === "running")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await sessions.workspace.writeWorkspace(created.id, "index.html", "<h1>worker canvas</h1>");
    await sessions.workspace.writeWorkspace(created.id, "theme.css", "body{color:#111}");
    const canvas = await sessions.design.readCanvas(created.id);
    expect(canvas.html).toContain("worker canvas");
    const page = await app.request(`/api/sessions/${created.id}/canvas-files/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("worker canvas");
    const css = await app.request(`/api/sessions/${created.id}/canvas-files/theme.css`);
    expect(css.status).toBe(200);
    expect(await css.text()).toContain("color:#111");
    const variant = await sessions.design.createDesignVariant(created.id, "Hero");
    expect(variant.designVariants?.[0]?.name).toBe("Hero");
    const image = await sessions.captureImage(created.id, "worker design");
    expect(await readFile(join(image.path, "index.html"), "utf8")).toContain("worker canvas");
    expect(await readFile(join(image.path, "theme.css"), "utf8")).toContain("color:#111");
  });

  it("lands Assets kit files on the worker after the guest is running", async () => {
    const { sessions, store, workerEngine, localDocker, config } = await setupWorkerPlane();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "assets",
      runtime: "docker",
      dockerImage: "locus/design",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.kind).toBe("assets");
    expect(created.placement).toBe("worker");
    expect(created.vmId).toBeTruthy();
    expect(localDocker.list()).toHaveLength(0);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const vm = sessions.getMachine(created.vmId!);
      if (vm && (vm.status === "ready" || vm.status === "running")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const disk = workerEngine.get(created.vmId!)?.diskPath;
    expect(disk).toBeTruthy();
    expect(await readFile(join(disk!, "ASSET.md"), "utf8")).toMatch(/## Build/);
    expect(await readFile(join(disk!, "vendor", "reconstruct.js"), "utf8")).toMatch(
      /reconstructFromPhoto/,
    );
    await expect(
      readFile(join(store.dataDir, "docker-workspaces", created.id, "ASSET.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("lands Assets kit files on a worker host workspace after the guest is running", async () => {
    const { sessions, config } = await setupWorkerPlane();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "assets",
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.kind).toBe("assets");
    expect(created.runtime).toBe("host");
    expect(created.placement).toBe("worker");
    expect(created.vmId).toBeTruthy();
    const brief = await sessions.workspace.readWorkspace(created.id, "ASSET.md");
    expect(brief.content).toMatch(/## Build/);
    const reconstruct = await sessions.workspace.readWorkspace(created.id, "vendor/reconstruct.js");
    expect(reconstruct.content).toMatch(/reconstructFromPhoto/);
  });

  it("lands Games kit files on the worker after the guest is running", async () => {
    const { sessions, store, workerEngine, config } = await setupWorkerPlane();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "game",
      runtime: "docker",
      dockerImage: "locus/design",
      designSystemId: "pixel-pack",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.kind).toBe("game");
    expect(created.vmId).toBeTruthy();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const vm = sessions.getMachine(created.vmId!);
      if (vm && (vm.status === "ready" || vm.status === "running")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const disk = workerEngine.get(created.vmId!)?.diskPath;
    expect(disk).toBeTruthy();
    expect(await readFile(join(disk!, "GAME.md"), "utf8")).toMatch(/## Kit/);
    expect(await readFile(join(disk!, "GAME.md"), "utf8")).toMatch(/16px/);
    expect(await readFile(join(disk!, "vendor", "sfx.js"), "utf8")).toMatch(/function beep/);
    await expect(
      readFile(join(store.dataDir, "docker-workspaces", created.id, "GAME.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("links create-time asset packs onto a worker Games guest without a first prompt", async () => {
    const { sessions, workerEngine, config } = await setupWorkerPlane();
    const asset = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "assets",
      title: "Knight",
      runtime: "docker",
      dockerImage: "locus/design",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    await sessions.workspace.writeWorkspace(
      asset.id,
      "index.html",
      "<html><body><img src='source.png'></body></html>",
    );
    await sessions.workspace.writeWorkspaceBytes(asset.id, "source.png", Buffer.from("png"));
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "game",
      runtime: "docker",
      dockerImage: "locus/design",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
      assetIds: [asset.id],
    });
    expect(created.kind).toBe("game");
    expect(created.vmId).toBeTruthy();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const vm = sessions.getMachine(created.vmId!);
      if (vm && (vm.status === "ready" || vm.status === "running")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const disk = workerEngine.get(created.vmId!)?.diskPath;
    expect(disk).toBeTruthy();
    expect(await readFile(join(disk!, "vendor", "assets", "index.json"), "utf8")).toMatch(
      /knight/i,
    );
    expect(await readFile(join(disk!, "vendor", "assets", "knight", "source.png"))).toEqual(
      Buffer.from("png"),
    );
    expect(
      (await sessions.get(created.id))?.assetRefs?.some((row) => row.sessionId === asset.id),
    ).toBe(true);
  });

  it("tests a worker URL and validates workers on save", async () => {
    const { app, sessions, store } = await setupWorkerPlane();
    const health = await app.request("/api/workers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:7421", token: "secret" }),
    });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: "locus-worker" });

    const denied = await app.request("/api/workers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:7421", token: "wrong" }),
    });
    expect(denied.status).toBe(400);
    expect(((await denied.json()) as { error: string }).error).toMatch(/Unreachable/);

    const current = await store.loadConfig();
    const bad = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current,
        workers: [{ id: "w", name: "Broken", url: "" }],
      }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/name and http/i);

    const dup = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current,
        workers: [
          { id: "w1", name: "Studio", url: "http://127.0.0.1:7421", token: "secret" },
          { id: "w1", name: "Clone", url: "http://127.0.0.1:7422", token: "other" },
        ],
      }),
    });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: string }).error).toMatch(/duplicate worker id/i);

    const cleartext = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current,
        workers: [{ id: "w2", name: "Studio", url: "http://192.168.1.8:7421", token: "secret" }],
      }),
    });
    expect(cleartext.status).toBe(400);
    expect(((await cleartext.json()) as { error: string }).error).toMatch(/https/i);
    void sessions;
  });

  it("adds a worker from a pasteable blob, pins TLS, and reports live status", async () => {
    const { app, store } = await setupWorkerPlane({ workers: [] });
    const missing = await app.request("/api/workers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blob: formatWorkerAddBlob({ url: "http://127.0.0.1:7421" }) }),
    });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toMatch(/token/i);

    const blob = formatWorkerAddBlob({
      url: "http://127.0.0.1:7421",
      token: "secret",
      name: "studio",
    });
    const added = await app.request("/api/workers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blob }),
    });
    expect(added.status).toBe(200);
    const body = (await added.json()) as {
      worker: { id: string; name: string; url: string; token?: string };
      config: { workers: Array<{ id: string; name: string }> };
    };
    expect(body.worker.name).toBe("studio");
    expect(body.worker.url).toBe("http://127.0.0.1:7421");
    expect(body.worker.token).toBe("••••••••");
    expect(body.config.workers).toHaveLength(1);
    const saved = await store.loadConfig();
    expect(saved.workers?.[0]?.token).toBe("secret");

    const again = await app.request("/api/workers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        blob: formatWorkerAddBlob({ url: "http://127.0.0.1:7421", name: "studio" }),
      }),
    });
    expect(again.status).toBe(200);
    expect(
      ((await again.json()) as { config: { workers: unknown[] } }).config.workers,
    ).toHaveLength(1);

    const status = await app.request("/api/workers/status");
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual([
      expect.objectContaining({ id: body.worker.id, live: true, name: "studio" }),
    ]);
  });

  it("starts a worker guest that is still booting", async () => {
    const { sessions, workerEngine, store, config } = await setupWorkerPlane();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      placement: "worker",
      backendId: "w1",
    });
    const vm = await workerEngine.create({
      sessionId: created.id,
      name: "agent",
      image: "node:22-bookworm",
    });
    const row = workerEngine.get(vm.id);
    if (row) row.status = "booting";
    expect(workerEngine.get(vm.id)?.status).toBe("booting");
    await store.mutateSession(created.id, (current) => {
      current.vmId = vm.id;
    });
    const started = await sessions.startVm(created.id);
    expect(["ready", "running"]).toContain(started.status);
  });

  it("keeps a stopped guest when destroyOnStop is false", async () => {
    const { sessions, workerEngine, store, config } = await setupWorkerPlane();
    const next = await store.loadConfig();
    next.workers = [{ ...next.workers![0]!, destroyOnStop: false }];
    await store.saveConfig(next);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.computeStartedAt).toBeTruthy();
    await store.mutateSession(created.id, (current) => {
      current.computeStartedAt = new Date(Date.now() - 60_000).toISOString();
    });
    await sessions.stopVm(created.id);
    expect(workerEngine.get(created.vmId!)?.status).toBe("stopped");
    expect((await sessions.get(created.id))?.vmId).toBe(created.vmId);
    expect((await sessions.get(created.id))?.computeStartedAt).toBeUndefined();
    expect((await sessions.get(created.id))?.computeMs ?? 0).toBeGreaterThan(50_000);
  });

  it("caps live guests on a cloud worker", async () => {
    const { sessions, store, config } = await setupWorkerPlane();
    const next = await store.loadConfig();
    next.workers = [{ ...next.workers![0]!, kind: "cloud", allowedImages: ["node:22-bookworm"] }];
    await store.saveConfig(next);
    const base = {
      os: "ubuntu" as const,
      templateId: config.templates[0]!.id,
      runtime: "docker" as const,
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker" as const,
      backendId: "w1",
    };
    await sessions.create(base);
    await expect(sessions.create(base)).rejects.toThrow(/maxConcurrent/i);
  });

  it("destroys idle worker guests after the TTL", async () => {
    const { sessions, workerEngine, config } = await setupWorkerPlane();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(workerEngine.list()).toHaveLength(1);
    const reaped = await sessions.reapIdleWorkerGuests(Date.now() + 20 * 60 * 1000);
    expect(reaped).toBe(1);
    expect(workerEngine.list()).toHaveLength(0);
    expect((await sessions.get(created.id))?.vmId).toBeUndefined();
  });

  it("rejects a cloud worker with idle TTL disabled", async () => {
    const { app, store } = await setupWorkerPlane();
    const current = await store.loadConfig();
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current,
        workers: [
          {
            id: "w1",
            name: "Box",
            url: "http://127.0.0.1:7421",
            token: "secret",
            kind: "cloud",
            idleTtlMs: 0,
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/idle TTL/i);
  });

  it("accrues compute time while a worker guest is live", async () => {
    const { sessions, store, config } = await setupWorkerPlane();
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.computeStartedAt).toBeTruthy();
    await store.mutateSession(created.id, (current) => {
      current.computeStartedAt = new Date(Date.now() - 60_000).toISOString();
    });
    await sessions.stopVm(created.id);
    const stopped = await sessions.get(created.id);
    expect(stopped?.computeStartedAt).toBeUndefined();
    expect(stopped?.computeMs ?? 0).toBeGreaterThan(50_000);
  });

  it("rejects a cloud worker without hourly USD", async () => {
    const { app, store } = await setupWorkerPlane();
    const current = await store.loadConfig();
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current,
        workers: [
          {
            id: "w1",
            name: "Box",
            url: "http://127.0.0.1:7421",
            token: "secret",
            kind: "cloud",
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/hourly USD/i);
  });

  it("rejects a cloud worker with no image allowlist", async () => {
    const { app, store } = await setupWorkerPlane();
    const current = await store.loadConfig();
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current,
        workers: [
          {
            id: "w1",
            name: "Box",
            url: "http://127.0.0.1:7421",
            token: "secret",
            kind: "cloud",
            hourlyUsd: 1,
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/image allowlist/i);
  });

  it("rejects creating a guest when the worker does not allow the image", async () => {
    const { sessions, store, config } = await setupWorkerPlane();
    const next = await store.loadConfig();
    next.workers = [{ ...next.workers![0]!, allowedImages: ["locus/agent"] }];
    await store.saveConfig(next);
    await expect(
      sessions.create({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "node:22-bookworm",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
        placement: "worker",
        backendId: "w1",
      }),
    ).rejects.toThrow(/does not allow image/i);
  });

  it("creates a guest when the image is on the allowlist", async () => {
    const { sessions, workerEngine, store, config } = await setupWorkerPlane();
    const next = await store.loadConfig();
    next.workers = [{ ...next.workers![0]!, allowedImages: ["node:22-bookworm"] }];
    await store.saveConfig(next);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(created.vmId).toBeTruthy();
    expect(workerEngine.list()).toHaveLength(1);
  });
});

describe("Fargate compute adapter", () => {
  const fargateWorker: WorkerBackend = {
    id: "w1",
    name: "Fargate",
    url: "",
    kind: "fargate",
    token: "secret",
    region: "us-east-1",
    taskDefinition: "locus-worker",
    allowedImages: ["node:22-bookworm"],
    allowedSizes: ["0.25-0.5"],
  };

  it("rejects a fargate worker without a task definition", async () => {
    const { app, store } = await setupWorkerPlane();
    const current = await store.loadConfig();
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current,
        workers: [
          {
            id: "w1",
            name: "Fargate",
            kind: "fargate",
            token: "secret",
            region: "us-east-1",
            allowedImages: ["locus/agent"],
            allowedSizes: ["0.25-0.5"],
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/task definition/);
  });

  it("rejects a fargate worker with an empty size allowlist", async () => {
    const { app, store } = await setupWorkerPlane();
    const current = await store.loadConfig();
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current,
        workers: [
          {
            id: "w1",
            name: "Fargate",
            kind: "fargate",
            token: "secret",
            region: "us-east-1",
            taskDefinition: "locus-worker",
            accessKeyId: "AKIATEST",
            allowedImages: ["locus/agent"],
            allowedSizes: [],
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/size allowlist/);
  });

  it("rejects a fargate worker without an access key id", async () => {
    const { app, store } = await setupWorkerPlane();
    const current = await store.loadConfig();
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current,
        workers: [
          {
            id: "w1",
            name: "Fargate",
            kind: "fargate",
            token: "secret",
            region: "us-east-1",
            taskDefinition: "locus-worker",
            allowedImages: ["locus/agent"],
            allowedSizes: ["0.25-0.5"],
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/access key/);
  });

  it("provisions an allowed size then creates a guest on that worker", async () => {
    const compute = new MockComputeBackend({ url: "http://127.0.0.1:7421", token: "secret" });
    const { sessions, workerEngine, localDocker, config } = await setupWorkerPlane({
      workers: [fargateWorker],
      compute,
    });
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      placement: "worker",
      backendId: "w1",
    });
    expect(compute.provisions).toHaveLength(1);
    expect(compute.provisions[0]?.size).toBe("0.25-0.5");
    expect(created.remoteGuestId).toMatch(/task\/locus\//);
    expect(created.instanceSize).toBe("0.25-0.5");
    expect(created.quotedUsdPerHour).toBeGreaterThan(0);
    expect(localDocker.list()).toHaveLength(0);
    expect(workerEngine.list()).toHaveLength(1);

    const remoteId = created.remoteGuestId;
    await sessions.stopVm(created.id);
    expect(compute.destroyed).toEqual([remoteId]);
    expect(workerEngine.list()).toHaveLength(0);
    expect((await sessions.get(created.id))?.remoteGuestId).toBeUndefined();
  });

  it("does not provision when the size allowlist is empty", async () => {
    const compute = new MockComputeBackend({ url: "http://127.0.0.1:7421", token: "secret" });
    const { sessions, config } = await setupWorkerPlane({
      workers: [{ ...fargateWorker, allowedSizes: [] }],
      compute,
    });
    await expect(
      sessions.create({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "node:22-bookworm",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
        placement: "worker",
        backendId: "w1",
      }),
    ).rejects.toThrow(/size allowlist/);
    expect(compute.provisions).toHaveLength(0);
  });

  it("stops the Fargate task when the worker guest cannot be created", async () => {
    const compute = new MockComputeBackend({ url: "http://127.0.0.1:7421", token: "wrong" });
    const { sessions, config } = await setupWorkerPlane({
      workers: [fargateWorker],
      compute,
    });
    await expect(
      sessions.create({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "node:22-bookworm",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
        placement: "worker",
        backendId: "w1",
      }),
    ).rejects.toThrow();
    expect(compute.provisions).toHaveLength(1);
    expect(compute.destroyed).toHaveLength(1);
    expect((await sessions.get(compute.provisions[0]!.sessionId))?.remoteGuestId).toBeUndefined();
  });

  it("reaps persisted Fargate ARNs after a control-plane restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-fargate-reap-"));
    cleanup.push(dir);
    const registryPath = join(dir, "compute-tasks.json");
    const first = new MockComputeBackend(
      { url: "http://127.0.0.1:7421", token: "secret" },
      registryPath,
    );
    const handle = await first.provision({
      backend: fargateWorker,
      sessionId: "ghost",
      size: "0.25-0.5",
    });
    const restarted = new MockComputeBackend(
      { url: "http://127.0.0.1:7421", token: "secret" },
      registryPath,
    );
    const { sessions } = await setupWorkerPlane({
      workers: [fargateWorker],
      compute: restarted,
    });
    expect(await restarted.listOrphans(new Set())).toEqual([{ id: handle.id, backendId: "w1" }]);
    expect(await sessions.reapOrphanCompute()).toBe(1);
    expect(restarted.destroyed).toEqual([handle.id]);
    expect(await restarted.listOrphans(new Set())).toEqual([]);
  });
});
