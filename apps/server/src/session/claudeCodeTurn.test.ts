import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import type { ClaudeCodeSpawner } from "@locus/providers";
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

function linesSpawner(
  captured: Array<{ args: string[]; cwd: string }>,
  lines: string[],
): ClaudeCodeSpawner {
  return (req) => {
    captured.push({ args: req.args, cwd: req.cwd });
    return {
      lines: (async function* () {
        for (const line of lines) yield line;
      })(),
      wait: async () => ({ code: 0, stderr: "" }),
    };
  };
}

describe("claude code chat loop", () => {
  it("runs claude -p against the host workspace and resumes the CLI session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-claude-code-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const claude = config.providers.find((p) => p.kind === "claude-code")!;
    claude.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    sessions.fetchFn = async () => {
      throw new Error("Claude Code must not call chat completions");
    };
    sessions.claudeCodeSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "cc-sess-1" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Updated README.md." },
            { type: "tool_use", id: "t1", name: "Read", input: { file_path: "README.md" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "t1", content: "# app" }],
        },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "Updated README.md." }),
    ]);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: claude.id,
      model: "claude-sonnet-4-5",
      startVm: false,
    });
    await sessions.sendChat(created.id, "Add a README");
    const fresh = await waitFor(sessions, created.id, (session) =>
      Boolean(session.claudeCode?.sessionId && session.status !== "running"),
    );
    expect(fresh?.claudeCode).toEqual({ sessionId: "cc-sess-1" });
    const assistant = fresh?.messages.find((m) => m.role === "assistant");
    expect(assistant?.content).toContain("Updated README.md.");
    expect(assistant?.toolCalls?.some((call) => call.name === "file_read")).toBe(true);
    expect(captured[0]?.cwd).toContain("host-workspaces");
    expect(captured[0]?.args).toEqual(
      expect.arrayContaining([
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--dangerously-skip-permissions",
        "--mcp-config",
        ".mcp.json",
        "Add a README",
      ]),
    );
    expect(captured[0]?.args).not.toContain("--resume");
    const mcp = JSON.parse(await readFile(join(captured[0]!.cwd, ".mcp.json"), "utf8")) as {
      mcpServers: { locus?: { type?: string; url?: string } };
    };
    expect(mcp.mcpServers.locus?.type).toBe("http");
    expect(mcp.mcpServers.locus?.url).toMatch(
      new RegExp(`^http://127\\.0\\.0\\.1:\\d+/mcp/sessions/${created.id}$`),
    );
    expect(JSON.stringify(mcp)).not.toMatch(/secret|glsa_|token/i);
    expect(captured[0]?.args).toEqual(
      expect.arrayContaining(["--disallowedTools", "WebSearch,WebFetch"]),
    );

    sessions.claudeCodeSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "cc-sess-1" }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "ok" }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "ok" }),
    ]);
    await sessions.sendChat(created.id, "also tests");
    await waitFor(
      sessions,
      created.id,
      (session) =>
        session.messages.filter((m) => m.role === "user").length >= 2 &&
        session.status !== "running",
    );
    expect(captured[1]?.args).toEqual(expect.arrayContaining(["--resume", "cc-sess-1"]));
  });

  it("rejects a VM runtime for Claude Code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-claude-vm-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const claude = config.providers.find((p) => p.kind === "claude-code")!;
    claude.enabled = true;
    await store.saveConfig(config);
    const sessions = new SessionService(store, new MockHypervisor(dir), new Hub());
    await expect(
      sessions.create({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "vm",
        providerId: claude.id,
        model: "claude-sonnet-4-5",
        startVm: false,
      }),
    ).rejects.toThrow(/Docker or Host/);
  });
});
