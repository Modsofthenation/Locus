import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor, sessionHostWorkspace } from "@locus/hypervisor";
import {
  REVIEW_PASS_NEEDS_INSPECT,
  REVIEW_TOOLS,
  isGuestReady,
  mcpDescriptionPin,
  turnCalledReviewTools,
} from "@locus/shared";
import { Hub } from "../core/hub.js";
import { McpHub } from "../integrations/mcp.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";
import {
  runWorkspaceNpmScript,
  runRepoHook,
  formatNpmTestGateFailure,
  lintOutputLooksLikeMissingDeps,
  summarizeNpmTestFailure,
  testCwdFromChangedFiles,
} from "../core/hooks.js";
import { loadWorkspaceRules } from "../workspace/workspaceMeta.js";
import type { ToolRequest } from "@locus/guest-agent";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

async function waitFor(
  sessions: SessionService,
  id: string,
  pred: (session: NonNullable<Awaited<ReturnType<SessionService["get"]>>>) => boolean,
) {
  const deadline = Date.now() + 4000;
  let fresh = await sessions.get(id);
  while (Date.now() < deadline) {
    fresh = await sessions.get(id);
    if (fresh && pred(fresh)) return fresh;
    await new Promise((r) => setTimeout(r, 20));
  }
  return fresh;
}

describe("harness eval", () => {
  it("refuses git_push on main, .env reads, force-push, and bad tool args", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-harness-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      autonomy: "autonomous",
    });
    hypervisor.forceRunning(created.vmId!);

    const push = await sessions.executeTool(created.id, { name: "git_push", args: {} });
    expect(push.ok).toBe(false);
    expect(push.output).toMatch(/protected branch main/i);
    expect((await sessions.get(created.id))?.needsHuman).toMatch(/protected branch main/i);

    const env = await sessions.executeTool(created.id, {
      name: "file_read",
      args: { path: "/workspace/.env" },
    });
    expect(env.ok).toBe(false);
    expect(env.output).toMatch(/credential file/i);

    const force = await sessions.executeTool(created.id, {
      name: "exec",
      args: { command: "git push --force origin feat" },
    });
    expect(force.ok).toBe(false);
    expect(force.output).toMatch(/force/i);

    const desktop = await sessions.executeTool(created.id, {
      name: "exec",
      args: { command: "/tmp/.mount_Locus-C1G4Tu/locus --help" },
    });
    expect(desktop.ok).toBe(false);
    expect(desktop.output).toMatch(/desktop app/i);

    const bad = await sessions.executeTool(created.id, {
      name: "file_write",
      args: { path: "/workspace/a.ts" },
    } as unknown as ToolRequest);
    expect(bad.ok).toBe(false);
    expect(bad.output).toMatch(/missing required argument "content"/);

    hypervisor.shutdown();
  });

  it("does not treat git_pr base:main as a protected head", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-harness-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      autonomy: "autonomous",
    });
    hypervisor.forceRunning(created.vmId!);

    const pr = await sessions.executeTool(created.id, {
      name: "git_pr",
      args: { title: "fix css", base: "main" },
    });
    expect(pr.output).not.toMatch(/protected branch/i);

    hypervisor.shutdown();
  });

  it("loads Locus.md into the system prompt as guiding context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-harness-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let system = "";
    async function* engine(req: { system: string }) {
      system = req.system;
      yield { type: "text" as const, text: "ok" };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: false,
    });
    const root = sessionHostWorkspace(dir, created);
    await writeFile(
      join(root, "Locus.md"),
      "Prefer Host runtime for trusted local work.\n",
      "utf8",
    );
    expect(await loadWorkspaceRules(root)).toMatch(/Prefer Host runtime/);
    await sessions.sendChat(created.id, "hi");
    await waitFor(sessions, created.id, (session) => session.status !== "running");
    expect(system).toMatch(/Repository rules/);
    expect(system).toMatch(/Locus\.md/);
    expect(system).toMatch(/Prefer Host runtime/);
    hypervisor.shutdown();
  });

  it("loads AGENTS.md into the system prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-harness-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let system = "";
    async function* engine(req: { system: string }) {
      system = req.system;
      yield { type: "text" as const, text: "ok" };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: false,
    });
    const root = sessionHostWorkspace(dir, created);
    await writeFile(join(root, "AGENTS.md"), "Never commit secrets.\n", "utf8");
    expect(await loadWorkspaceRules(root)).toMatch(/Never commit secrets/);
    await sessions.sendChat(created.id, "hi");
    await waitFor(sessions, created.id, (session) => session.status !== "running");
    expect(system).toMatch(/Repository rules/);
    expect(system).toMatch(/Never commit secrets/);
    hypervisor.shutdown();
  });

  it("parses review verdicts and keeps a failing verdict from counting as done", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-harness-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    async function* engine() {
      yield { type: "text" as const, text: "Looks fine" };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "review",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    expect(created.kind).toBe("review");
    expect(created.allowedTools).toEqual(REVIEW_TOOLS);
    expect(created.allowedTools).not.toContain("file_write");
    expect(created.allowedTools).not.toContain("git_push");
    expect(created.allowedTools).not.toContain("exec");
    await sessions.sendChat(created.id, "review this");
    const fresh = await waitFor(sessions, created.id, (session) => Boolean(session.needsHuman));
    expect(fresh?.needsHuman).toMatch(/Needs a human|not valid JSON/i);
    hypervisor.shutdown();
  });

  it("does not ship a guessed PASS without git_pr_get", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-harness-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    async function* engine() {
      yield {
        type: "text" as const,
        text: '{"verdict":"PASS","reasons":[],"risk":"low"}',
      };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "review",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    await sessions.sendChat(created.id, "review this");
    const fresh = await waitFor(sessions, created.id, (session) =>
      Boolean(session.needsHuman && session.status !== "running"),
    );
    expect(fresh?.needsHuman).toBe(REVIEW_PASS_NEEDS_INSPECT);
    hypervisor.shutdown();
  });

  it("ships a PASS after git_pr_get this turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-harness-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let round = 0;
    async function* engine() {
      round += 1;
      if (round === 1) {
        yield {
          type: "tool_call" as const,
          id: "r1",
          name: "git_pr_get",
          arguments: { include: ["files"] },
        };
        return;
      }
      yield {
        type: "text" as const,
        text: '{"verdict":"PASS","reasons":[],"risk":"low"}',
      };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "review",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    await sessions.sendChat(created.id, "review this");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((message) => message.content.includes('"verdict":"PASS"')),
    );
    expect(fresh?.needsHuman).toBeUndefined();
    expect(turnCalledReviewTools(fresh?.messages ?? [])).toBe(true);
    hypervisor.shutdown();
  });

  it("parses REQUEST_CHANGES JSON in mixed prose as a failing verdict", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-harness-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    async function* engine() {
      yield {
        type: "text" as const,
        text: 'Posted notes.{"verdict":"REQUEST_CHANGES","reasons":["stale rows"],"risk":"HIGH"}',
      };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "review",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    await sessions.sendChat(created.id, "review this");
    const fresh = await waitFor(sessions, created.id, (session) => Boolean(session.needsHuman));
    expect(fresh?.needsHuman).toMatch(/Reviewer FAIL/);
    expect(fresh?.needsHuman).not.toMatch(/not valid JSON/);
    hypervisor.shutdown();
  });

  it("does not re-gate a review follow-up that is not a new review", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-harness-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let turn = 0;
    async function* engine() {
      turn += 1;
      yield {
        type: "text" as const,
        text:
          turn === 1
            ? '{"verdict":"FAIL","reasons":["stale rows"],"risk":"high"}'
            : "Still looking at the hop.",
      };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "review",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    await sessions.sendChat(created.id, "review this");
    const failed = await waitFor(sessions, created.id, (session) =>
      Boolean(session.needsHuman && session.status !== "running"),
    );
    expect(failed?.needsHuman).toMatch(/Reviewer FAIL/);
    await sessions.sendChat(created.id, "Can you continue on?");
    const fresh = await waitFor(sessions, created.id, (session) => session.status !== "running");
    expect(fresh?.needsHuman).toBeUndefined();
    hypervisor.shutdown();
  });

  it("runs lint/test hooks from package.json and skips when missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-harness-"));
    cleanup.push(dir);
    expect(await runWorkspaceNpmScript(dir, "lint")).toEqual({
      ran: false,
      ok: true,
      output: "",
    });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: { lint: 'node -e "process.exit(1)"', test: 'node -e "process.exit(0)"' },
      }),
      "utf8",
    );
    const lint = await runWorkspaceNpmScript(dir, "lint", 10_000);
    expect(lint.ran).toBe(true);
    expect(lint.ok).toBe(false);
    const test = await runWorkspaceNpmScript(dir, "test", 10_000);
    expect(test.ran).toBe(true);
    expect(test.ok).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "runs a repo hook when PATH does not include sh",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-hook-shell-"));
      cleanup.push(dir);
      const origPath = process.env.PATH;
      process.env.PATH = "";
      try {
        const ran = await runRepoHook(dir, {
          event: "PostToolUse",
          matcher: "exec",
          command: "pwd",
        });
        expect(ran.ran).toBe(true);
        expect(ran.ok).toBe(true);
        expect(ran.output).toContain(dir);
      } finally {
        process.env.PATH = origPath;
      }
    },
  );

  it("blocks git_push when a PreToolUse hook fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-harness-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      autonomy: "autonomous",
    });
    const root = sessionHostWorkspace(dir, created);
    await mkdir(join(root, ".locus"), { recursive: true });
    await writeFile(
      join(root, ".locus", "hooks.json"),
      JSON.stringify({
        PreToolUse: [{ matcher: "git_push", command: 'node -e "process.exit(1)"' }],
      }),
      "utf8",
    );
    const push = await sessions.executeTool(created.id, {
      name: "git_push",
      args: { branch: "locus/feat" },
    });
    expect(push.ok).toBe(false);
    expect(push.output).toMatch(/PreToolUse hook failed/i);

    await writeFile(
      join(root, ".locus", "hooks.json"),
      JSON.stringify({
        PreToolUse: [{ matcher: "file_write", command: 'node -e "process.exit(1)"' }],
      }),
      "utf8",
    );
    const write = await sessions.executeTool(created.id, {
      name: "file_write",
      args: { path: "/workspace/a.ts", content: "export const a = 1;\n" },
    });
    expect(write.ok).toBe(false);
    expect(write.output).toMatch(/PreToolUse hook failed/i);
    hypervisor.shutdown();
  });

  it("summarizes npm test dumps and recognizes missing lint deps", () => {
    expect(
      lintOutputLooksLikeMissingDeps(
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@eslint/js'",
      ),
    ).toBe(true);
    expect(lintOutputLooksLikeMissingDeps("✖ 2 problems (2 errors, 0 warnings)")).toBe(false);
    const dumped = "vitest junk\n FAIL  src/agentRuntime.test.ts > spawn_agent budget\nmore";
    const summary = summarizeNpmTestFailure(dumped);
    expect(summary).toMatch(/^Failed tests:\nFAIL {2}src\/agentRuntime/);
    expect(summary.match(/FAIL {2}src\/agentRuntime/g)).toHaveLength(1);
    const ansi = `${String.fromCharCode(27)}[31mFAIL${String.fromCharCode(27)}[39m  src/agentRuntime.test.ts > spawn_agent budget`;
    expect(summarizeNpmTestFailure(ansi)).toMatch(/^Failed tests:\nFAIL {2}src\/agentRuntime/);
    expect(testCwdFromChangedFiles("/repo", ["packages/shared/src/compact.ts"])).toBe(
      join("/repo", "packages/shared"),
    );
    expect(
      testCwdFromChangedFiles("/repo", ["packages/shared/a.ts", "apps/server/b.ts"]),
    ).toBeUndefined();
    expect(
      formatNpmTestGateFailure("git_push", {
        ran: true,
        ok: false,
        output: dumped,
        cwd: "/repo/apps/server",
        command: "npm run test",
        exitCode: 1,
        durationMs: 42,
        failureKind: "test-failure",
        failedTests: ["src/agentRuntime.test.ts"],
        retryable: false,
      }),
    ).toMatch(/Harness blocked git_push: tests failed\.[\s\S]*Failed test count: 1\./);
  });

  it("attaches session.repo after a docker agent git_clones into an empty workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-clone-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: true,
    });
    const readyUntil = Date.now() + 2000;
    while (Date.now() < readyUntil) {
      const vm = created.vmId ? sessions.getMachine(created.vmId) : undefined;
      if (vm && isGuestReady(vm.status)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(created.repo?.url).toBeUndefined();
    const cloned = await sessions.executeTool(created.id, {
      name: "git_clone",
      args: { url: "https://github.com/acme/app.git" },
    });
    expect(cloned.ok).toBe(true);
    const fresh = await sessions.get(created.id);
    expect(fresh?.repo?.url).toMatch(/acme\/app/);
    hypervisor.shutdown();
  });

  it.skipIf(process.platform === "win32")("pins MCP tools by description hash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-mcp-"));
    cleanup.push(dir);
    const fixture = `#!/usr/bin/env node
let buf = Buffer.alloc(0);
const tools = [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } } } }];
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
  }
});
`;
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
        toolHashes: { echo: "deadbeef" },
      },
    ]);
    expect(hub.listTools().some((t) => t.name === "mcp_echo_echo")).toBe(false);
    hub.close();
    const ok = new McpHub();
    await ok.setServers([
      {
        id: "echo",
        name: "Echo",
        enabled: true,
        command: process.execPath,
        args: [script],
        env: {},
        toolHashes: { echo: mcpDescriptionPin("Echo text") },
        version: "1",
      },
    ]);
    expect(ok.listTools().some((t) => t.name === "mcp_echo_echo")).toBe(true);
    ok.close();
  });
});
