import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockHypervisor, sessionHostWorkspace } from "@locus/hypervisor";
import type { CodexCliSpawner } from "@locus/providers";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionTraceLog } from "./traces.js";
import { cursorCliToolCallOk, SessionService } from "./sessions.js";
import { createApp } from "../app.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

async function waitFor(sessions: SessionService, id: string) {
  const deadline = Date.now() + 4000;
  let fresh = await sessions.get(id);
  while (Date.now() < deadline) {
    fresh = await sessions.get(id);
    if (fresh && fresh.status !== "running") return fresh;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return fresh;
}

function linesSpawner(
  captured: Array<{ args: string[]; cwd: string; env?: NodeJS.ProcessEnv }>,
  lines: string[],
): CodexCliSpawner {
  return (req) => {
    captured.push({ args: req.args, cwd: req.cwd, env: req.env });
    return {
      lines: (async function* () {
        for (const line of lines) yield line;
      })(),
      wait: async () => ({ code: 0, stderr: "" }),
    };
  };
}

describe("codex CLI chat loop", () => {
  it("marks failed Locus MCP envelopes as failed tool calls", () => {
    expect(
      cursorCliToolCallOk(
        "completed",
        JSON.stringify({
          content: [{ type: "text", text: "Harness blocked git_push: tests failed." }],
          structured_content: null,
        }),
      ),
    ).toBe(false);
    expect(
      cursorCliToolCallOk(
        "completed",
        JSON.stringify({
          content: [{ type: "text", text: "published" }],
          structured_content: null,
        }),
      ),
    ).toBe(true);
    expect(
      cursorCliToolCallOk(
        "completed",
        JSON.stringify({
          content: [{ type: "text", text: "blocked" }],
          structured_content: { ok: false, status: "blocked" },
        }),
      ),
    ).toBe(false);
  });

  it.each(["approved", "denied"] as const)(
    "routes session Git MCP through turn and policy gates (%s)",
    async (decision) => {
      const dir = await mkdtemp(join(tmpdir(), "locus-codex-git-"));
      cleanup.push(dir);
      const store = new JsonStore(dir);
      await store.init();
      const config = await store.loadConfig();
      const codex = config.providers.find((p) => p.kind === "codex-cli")!;
      codex.enabled = true;
      await store.saveConfig(config);
      const hypervisor = new MockHypervisor(dir);
      const sessions = new SessionService(store, hypervisor, new Hub());
      const app = createApp({ store, sessions, hypervisor });
      const created = await sessions.create({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "host",
        providerId: codex.id,
        model: codex.defaultModel,
        startVm: false,
      });
      await store.mutateSession(created.id, (s) => {
        s.autoAllow = ["git_push", "git_pr"];
      });
      const execute = vi
        .spyOn(sessions, "executeTool")
        .mockResolvedValue({ ok: true, output: "published" });
      const rpc = async (method: string, name?: string, args = {}) => {
        const response = await app.request(`/mcp/sessions/${created.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method,
            params: { name, arguments: args },
          }),
        });
        return response.json() as Promise<{
          result: {
            tools?: Array<{ name: string }>;
            isError?: boolean;
            content?: Array<{ text: string }>;
          };
        }>;
      };
      expect((await rpc("tools/call", "git_push")).result.isError).toBe(true);
      const results: unknown[] = [];
      sessions.codexCliSpawner = () => ({
        lines: (async function* () {
          results.push(await rpc("initialize"));
          results.push(await rpc("tools/list"));
          results.push(await rpc("tools/call", "git_push", { branch: "codex/fix" }));
          results.push(await rpc("tools/call", "git_pr", { title: "Fix", body: "Tests passed" }));
          results.push(await rpc("tools/call", "git_push", { force: true }));
          results.push(await rpc("tools/call", "git_push", { branch: "main" }));
          await store.mutateSession(created.id, (s) => {
            s.allowedTools = ["git_status"];
          });
          results.push(await rpc("tools/call", "git_push", { branch: "codex/fix" }));
          await store.mutateSession(created.id, (s) => {
            s.allowedTools = [];
            s.autoAllow = [];
          });
          const pending = rpc("tools/call", "git_push", { branch: "codex/fix" });
          let approvalId: string | undefined;
          for (let attempt = 0; attempt < 100 && !approvalId; attempt++) {
            const s = await sessions.get(created.id);
            approvalId = s?.messages
              .flatMap((m) => m.toolCalls ?? [])
              .find((t) => t.approval === "needed")?.id;
            if (!approvalId) await new Promise((resolve) => setTimeout(resolve, 10));
          }
          if (approvalId) await sessions.resolveApproval(created.id, approvalId, decision);
          results.push(await pending);
          yield JSON.stringify({ type: "turn.completed", usage: {} });
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      });
      await sessions.sendChat(created.id, "Push and open a PR");
      await waitFor(sessions, created.id);
      expect(results[0]).toMatchObject({
        result: { instructions: expect.stringContaining("call git_status") },
      });
      expect(results[1]).toMatchObject({
        result: {
          tools: expect.arrayContaining([
            { name: "git_push", description: expect.any(String), inputSchema: expect.any(Object) },
          ]),
        },
      });
      expect(results.slice(2)).toMatchObject([
        { result: { isError: false } },
        { result: { isError: false } },
        { result: { isError: true } },
        { result: { isError: true } },
        { result: { isError: true } },
        { result: { isError: decision !== "approved" } },
      ]);
      expect(execute).toHaveBeenCalledTimes(decision === "approved" ? 3 : 2);
      const finished = await sessions.get(created.id);
      expect(
        finished?.messages.flatMap((m) => m.toolCalls ?? []).find((t) => t.approval === decision),
      ).toMatchObject({ finishedAt: expect.any(String), result: expect.any(String) });
      expect(execute).toHaveBeenCalledWith(created.id, {
        name: "git_push",
        args: { branch: "codex/fix" },
      });
      expect((await rpc("tools/call", "git_push")).result.isError).toBe(true);
      expect(sessions.cliGitTools(created.id)).toEqual([]);
      results.length = 0;
      sessions.codexCliSpawner = (req) => ({
        lines: (async function* () {
          results.push(req.args, await rpc("tools/list"), await rpc("tools/call", "git_push"));
          yield JSON.stringify({ type: "turn.completed", usage: {} });
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      });
      await sessions.sendChat(created.id, "Plan only", { plan: true });
      await waitFor(sessions, created.id);
      expect((results[0] as string[]).join(" ")).not.toContain("mcp_servers.locus_git");
      expect(results[1]).not.toMatchObject({
        result: { tools: expect.arrayContaining([expect.objectContaining({ name: "git_push" })]) },
      });
      expect(results[2]).toMatchObject({ result: { isError: true } });
      hypervisor.shutdown();
    },
  );
  it("runs codex exec against the host workspace and resumes the CLI session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-codex-cli-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const codex = config.providers.find((provider) => provider.kind === "codex-cli")!;
    codex.enabled = true;
    await store.saveConfig(config);
    const sessions = new SessionService(store, new MockHypervisor(dir), new Hub());
    const captured: Array<{ args: string[]; cwd: string; env?: NodeJS.ProcessEnv }> = [];
    sessions.fetchFn = async () => {
      throw new Error("Codex CLI must not call chat completions");
    };
    sessions.codexCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "thread.started", thread_id: "cx-sess-1" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "msg-1", type: "agent_message", text: "Updated README.md." },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "cmd-1",
          type: "command_execution",
          command: "git status --short",
          aggregated_output: " M README.md",
          exit_code: 0,
        },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 12, output_tokens: 7 },
      }),
    ]);

    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: codex.id,
      model: "gpt-6-astra",
      reasoningEffort: "high",
      startVm: false,
    });
    await writeFile(
      join(sessionHostWorkspace(dir, created), "package.json"),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
    );
    await sessions.sendChat(created.id, "Add a README");
    const fresh = await waitFor(sessions, created.id);

    expect(fresh?.codexCli).toEqual({ sessionId: "cx-sess-1" });
    expect(fresh?.messages.find((message) => message.role === "assistant")?.content).toContain(
      "Updated README.md.",
    );
    expect(
      fresh?.messages.some((message) => message.toolCalls?.some((call) => call.name === "exec")),
    ).toBe(true);
    expect(captured[0]?.cwd).toContain("host-workspaces");
    expect(captured[0]?.args).toEqual(
      expect.arrayContaining([
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "never",
        "--config",
        'model_reasoning_effort="high"',
        expect.stringContaining("Add a README"),
      ]),
    );
    expect(captured[0]?.args).not.toContain("resume");
    expect(captured[0]?.args.at(-1)).toContain("Workspace preflight: node_modules is missing");
    expect(captured[0]?.args).toContain(
      `mcp_servers.locus_git.url="http://127.0.0.1:7420/mcp/sessions/${created.id}"`,
    );
    expect(captured[0]?.env?.LOCUS_GIT_MCP_URL).toBe(
      `http://127.0.0.1:7420/mcp/sessions/${created.id}`,
    );
    expect(captured[0]?.args.at(-1)).toContain("git_push");

    sessions.codexCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "thread.started", thread_id: "cx-sess-1" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "msg-2", type: "agent_message", text: "ok" },
      }),
      JSON.stringify({ type: "turn.completed", usage: {} }),
    ]);
    await sessions.sendChat(created.id, "also tests");
    await waitFor(sessions, created.id);
    expect(captured[1]?.args).toEqual(expect.arrayContaining(["resume", "cx-sess-1"]));
    expect(captured[1]?.args).toContain(
      `mcp_servers.locus_git.url="http://127.0.0.1:7420/mcp/sessions/${created.id}"`,
    );
    const trace = await new SessionTraceLog(dir).read(created.id);
    const requests = trace.filter((event) => event.kind === "llm.request");
    expect(requests[0]?.args).toMatchObject({
      mode: "agent",
      reasoningEffort: "high",
      resumed: false,
      locusGit: true,
    });
    expect(requests[1]?.args).toMatchObject({ resumed: true, locusGit: true });
    expect(trace.find((event) => event.kind === "llm.response")).toMatchObject({
      inputTokens: 12,
      outputTokens: 7,
      args: { reasoningEffort: "high" },
    });
  });

  it("rejects a VM runtime for Codex CLI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-codex-vm-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const codex = config.providers.find((provider) => provider.kind === "codex-cli")!;
    codex.enabled = true;
    await store.saveConfig(config);
    const sessions = new SessionService(store, new MockHypervisor(dir), new Hub());
    await expect(
      sessions.create({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "vm",
        providerId: codex.id,
        model: "gpt-6-astra",
        startVm: false,
      }),
    ).rejects.toThrow(/Docker or Host/);
  });

  it("persists the canonical model when a legacy Codex session sends a turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-codex-legacy-model-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const codex = config.providers.find((provider) => provider.kind === "codex-cli")!;
    codex.enabled = true;
    await store.saveConfig(config);
    const sessions = new SessionService(store, new MockHypervisor(dir), new Hub());
    const captured: Array<{ args: string[]; cwd: string; env?: NodeJS.ProcessEnv }> = [];
    sessions.codexCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "thread.started", thread_id: "legacy-session" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "legacy-message", type: "agent_message", text: "Recovered" },
      }),
      JSON.stringify({ type: "turn.completed", usage: {} }),
    ]);

    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: codex.id,
      model: "gpt-5.3-codex",
      startVm: false,
    });
    expect(created.model).toBe("gpt-6-astra");
    await store.replaceSession({ ...created, model: "gpt-5.3-codex" });
    const patched = await sessions.patchMeta(created.id, { providerId: codex.id });
    expect(patched.model).toBe("gpt-6-astra");
    await sessions.sendChat(created.id, "Continue");
    const fresh = await waitFor(sessions, created.id);

    expect(fresh?.model).toBe("gpt-6-astra");
    expect(captured[0]?.args).toEqual(expect.arrayContaining(["--model", "gpt-6-astra"]));
  });

  it.each(["game", "design"] as const)("enables playwright on %s Codex MCP", async (kind) => {
    const dir = await mkdtemp(join(tmpdir(), `locus-codex-${kind}-`));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const codex = config.providers.find((provider) => provider.kind === "codex-cli")!;
    codex.enabled = true;
    await store.saveConfig(config);
    const sessions = new SessionService(store, new MockHypervisor(dir), new Hub());
    const captured: Array<{ args: string[]; cwd: string; env?: NodeJS.ProcessEnv }> = [];
    sessions.codexCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "thread.started", thread_id: `cx-${kind}` }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "msg-1", type: "agent_message", text: "looked" },
      }),
      JSON.stringify({ type: "turn.completed", usage: {} }),
    ]);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind,
      runtime: "host",
      providerId: codex.id,
      model: "gpt-6-astra",
      startVm: false,
    });
    await sessions.sendChat(created.id, "look at the canvas");
    await waitFor(sessions, created.id);
    const joined = captured[0]?.args.join(" ") ?? "";
    expect(joined).toContain("playwright");
    expect(joined).toContain("mcp_servers.locus_git");
    expect(captured[0]?.args.at(-1)).toMatch(/playwright/i);
    expect(captured[0]?.args.at(-1)).toMatch(
      kind === "design" ? /Design canvas snapshot/ : /Game canvas snapshot/,
    );
    expect(captured[0]?.env?.LOCUS_GIT_MCP_URL).toBe(
      `http://127.0.0.1:7420/mcp/sessions/${created.id}`,
    );
  });

  it("enables git_pr inspect tools on review Codex MCP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-codex-review-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const codex = config.providers.find((provider) => provider.kind === "codex-cli")!;
    codex.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string; env?: NodeJS.ProcessEnv }> = [];
    sessions.codexCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "thread.started", thread_id: "cx-review" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "msg-1", type: "agent_message", text: "need git_pr_get" },
      }),
      JSON.stringify({ type: "turn.completed", usage: {} }),
    ]);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "review",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: codex.id,
      model: "gpt-6-astra",
      startVm: true,
    });
    await sessions.sendChat(created.id, "review this");
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !captured[0]?.args) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const joined = captured[0]?.args.join(" ") ?? "";
    const toolsArg = captured[0]?.args.find((arg) => arg.includes("enabled_tools")) ?? "";
    expect(joined).toContain("read-only");
    expect(toolsArg).toContain("git_pr_get");
    expect(toolsArg).not.toContain("git_push");
    expect(captured[0]?.args.at(-1)).toMatch(/git_pr_get/);
    expect(captured[0]?.args.at(-1)).toMatch(/do not git_push/);
    expect(captured[0]?.env?.LOCUS_GIT_MCP_URL).toBe(
      `http://127.0.0.1:7420/mcp/sessions/${created.id}`,
    );
    expect(sessions.cliGitTools(created.id)).toEqual([]);
    hypervisor.shutdown();
  });
});
