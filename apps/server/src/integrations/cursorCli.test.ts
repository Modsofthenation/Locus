import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CURSOR_CODING_ROUTING_CARD,
  formatContextPercent,
  formatContextUsage,
  PROCESS_DONE_NUDGE,
  SEARCH_WANDER_NUDGE,
  SELF_CORRECT_PATCH_NUDGE,
  SELF_CORRECT_TEST_NUDGE,
  DESIGN_QUALITY_NUDGE,
  HOST_FALLBACK_NUDGE,
  DESIGN_LOOK_NUDGE,
  VERIFY_NUDGE,
} from "@locus/shared";
import { dockerWorkspaceDir, MockHypervisor } from "@locus/hypervisor";
import type { CursorCliSpawner } from "@locus/providers";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import {
  SessionService,
  cursorCliToolCallOk,
  isStartPromptResumeTail,
} from "../session/sessions.js";
import { JsonStore } from "../core/store.js";
import { SessionTraceLog } from "../session/traces.js";

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
): CursorCliSpawner {
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

describe("cursor cli chat loop", () => {
  it("runs agent -p against the host workspace and resumes the CLI session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    sessions.fetchFn = async () => {
      throw new Error("Cursor CLI must not call the Cloud Agents API");
    };
    sessions.cursorCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "cli-sess-1" }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 1,
        message: { content: [{ type: "text", text: "Updated README.md." }] },
      }),
      JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        call_id: "t1",
        tool_call: { readToolCall: { args: { path: "README.md" }, result: { success: "# app" } } },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "Updated README.md." }),
    ]);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    expect(created.vmId).toBeUndefined();
    await sessions.sendChat(created.id, "Add a README");
    const fresh = await waitFor(sessions, created.id, (session) =>
      Boolean(session.cursorCli?.sessionId && session.status !== "running"),
    );
    expect(fresh?.cursorCli).toEqual({
      sessionId: "cli-sess-1",
      excludeTools: "web_search_tool_call,web_fetch_tool_call",
    });
    const assistant = fresh?.messages.find((m) => m.role === "assistant");
    expect(assistant?.content).toContain("Updated README.md.");
    expect(assistant?.toolCalls?.some((call) => call.name === "file_read")).toBe(true);
    expect(captured[0]?.cwd).toContain("host-workspaces");
    expect(captured[0]?.args).toEqual(
      expect.arrayContaining([
        "-p",
        "--output-format",
        "stream-json",
        "--force",
        "--workspace",
        captured[0]!.cwd,
        "Add a README",
      ]),
    );
    expect(captured[0]?.args).not.toContain("--resume");
    expect(captured[0]?.args).toEqual(
      expect.arrayContaining(["--exclude-tools", "web_search_tool_call,web_fetch_tool_call"]),
    );
    const rule = await readFile(join(captured[0]!.cwd, ".cursor", "rules", "locus.mdc"), "utf8");
    expect(rule).toContain("alwaysApply: true");
    expect(rule).toContain(CURSOR_CODING_ROUTING_CARD);

    sessions.cursorCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "cli-sess-1" }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 1,
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
    expect(captured[1]?.args).toEqual(
      expect.arrayContaining(["--resume", "cli-sess-1", "also tests"]),
    );
    hypervisor.shutdown();
  });

  it("nudges a Cursor CLI coding turn that only greps, then one that edits without tests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-coding-loop-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    let calls = 0;
    const grepLine = (id: string) =>
      JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        call_id: id,
        tool_call: {
          grepToolCall: { args: { pattern: "TODO" }, result: { success: "src/a.ts:1: TODO" } },
        },
      });
    sessions.cursorCliSpawner = (req) => {
      calls += 1;
      captured.push({ args: req.args, cwd: req.cwd });
      const lines =
        calls === 1
          ? [
              JSON.stringify({ type: "system", subtype: "init", session_id: "cli-wander" }),
              grepLine("g1"),
              grepLine("g2"),
              grepLine("g3"),
              JSON.stringify({
                type: "assistant",
                timestamp_ms: 1,
                message: { content: [{ type: "text", text: "still looking" }] },
              }),
              JSON.stringify({ type: "result", subtype: "success", result: "still looking" }),
            ]
          : calls === 2
            ? [
                JSON.stringify({ type: "system", subtype: "init", session_id: "cli-wander" }),
                JSON.stringify({
                  type: "assistant",
                  timestamp_ms: 1,
                  message: { content: [{ type: "text", text: "still looking" }] },
                }),
                JSON.stringify({ type: "result", subtype: "success", result: "still looking" }),
              ]
            : calls === 3
              ? [
                  JSON.stringify({ type: "system", subtype: "init", session_id: "cli-wander" }),
                  JSON.stringify({
                    type: "tool_call",
                    subtype: "completed",
                    call_id: "w1",
                    tool_call: {
                      writeToolCall: {
                        args: { path: "src/nudge.js", fileText: "export const n = 1;\n" },
                        result: { success: true },
                      },
                    },
                  }),
                  JSON.stringify({
                    type: "assistant",
                    timestamp_ms: 1,
                    message: { content: [{ type: "text", text: "patched" }] },
                  }),
                  JSON.stringify({ type: "result", subtype: "success", result: "patched" }),
                ]
              : [
                  JSON.stringify({ type: "system", subtype: "init", session_id: "cli-wander" }),
                  JSON.stringify({
                    type: "tool_call",
                    subtype: "completed",
                    call_id: "t1",
                    tool_call: {
                      shellToolCall: {
                        args: { command: "npm test" },
                        result: { success: { exitCode: 0, stdout: "ok" } },
                      },
                    },
                  }),
                  JSON.stringify({
                    type: "assistant",
                    timestamp_ms: 1,
                    message: { content: [{ type: "text", text: "tests pass" }] },
                  }),
                  JSON.stringify({ type: "result", subtype: "success", result: "tests pass" }),
                ];
      return {
        lines: (async function* () {
          for (const line of lines) yield line;
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      };
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(created.id, "clean up TODOs");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((m) => m.content === VERIFY_NUDGE) &&
        session.messages.some((m) => m.content === "tests pass"),
    );
    expect(calls).toBe(4);
    expect(fresh?.messages.some((m) => m.content === SEARCH_WANDER_NUDGE)).toBe(true);
    expect(fresh?.messages.some((m) => m.content === VERIFY_NUDGE)).toBe(true);
    expect(captured[1]?.args.at(-1)).toBe(SEARCH_WANDER_NUDGE);
    expect(captured[2]?.args.at(-1)).toBe(SEARCH_WANDER_NUDGE);
    expect(captured[3]?.args.at(-1)).toBe(VERIFY_NUDGE);
    expect(fresh?.needsHuman).toBeUndefined();
    hypervisor.shutdown();
  });

  it("resumes a Cursor CLI coding turn when a patch fails to apply", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-self-correct-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    let calls = 0;
    sessions.cursorCliSpawner = (req) => {
      calls += 1;
      captured.push({ args: req.args, cwd: req.cwd });
      const lines =
        calls === 1
          ? [
              JSON.stringify({ type: "system", subtype: "init", session_id: "cli-patch" }),
              JSON.stringify({
                type: "tool_call",
                subtype: "completed",
                call_id: "p1",
                tool_call: {
                  searchReplaceToolCall: {
                    args: { path: "src/app.ts", old_string: "old", new_string: "new" },
                    result: { error: "failed to apply patch" },
                  },
                },
              }),
              JSON.stringify({
                type: "assistant",
                timestamp_ms: 1,
                message: { content: [{ type: "text", text: "could not patch" }] },
              }),
              JSON.stringify({ type: "result", subtype: "success", result: "could not patch" }),
            ]
          : calls === 2
            ? [
                JSON.stringify({ type: "system", subtype: "init", session_id: "cli-patch" }),
                JSON.stringify({
                  type: "assistant",
                  timestamp_ms: 1,
                  message: { content: [{ type: "text", text: "retried the patch" }] },
                }),
                JSON.stringify({ type: "result", subtype: "success", result: "retried the patch" }),
              ]
            : [
                JSON.stringify({ type: "system", subtype: "init", session_id: "cli-patch" }),
                JSON.stringify({
                  type: "tool_call",
                  subtype: "completed",
                  call_id: "t1",
                  tool_call: {
                    shellToolCall: {
                      args: { command: "npm test" },
                      result: { success: { exitCode: 0, stdout: "ok" } },
                    },
                  },
                }),
                JSON.stringify({
                  type: "assistant",
                  timestamp_ms: 1,
                  message: { content: [{ type: "text", text: "tests pass" }] },
                }),
                JSON.stringify({ type: "result", subtype: "success", result: "tests pass" }),
              ];
      return {
        lines: (async function* () {
          for (const line of lines) yield line;
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      };
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(created.id, "rename old to new");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((m) => m.content === SELF_CORRECT_PATCH_NUDGE) &&
        session.messages.some((m) => m.content === VERIFY_NUDGE) &&
        session.messages.some((m) => m.content === "tests pass"),
    );
    expect(calls).toBe(3);
    expect(fresh?.messages.some((m) => m.content === SELF_CORRECT_PATCH_NUDGE)).toBe(true);
    expect(fresh?.messages.some((m) => m.content === VERIFY_NUDGE)).toBe(true);
    expect(captured[1]?.args.at(-1)).toBe(SELF_CORRECT_PATCH_NUDGE);
    expect(captured[2]?.args.at(-1)).toBe(VERIFY_NUDGE);
    const failed = fresh?.messages
      .find((m) => m.role === "assistant")
      ?.toolCalls?.find((call) => call.name === "apply_patch");
    expect(failed?.error).toMatch(/failed to apply patch/);
    hypervisor.shutdown();
  });

  it("does not ship a Cursor CLI coding turn whose last tests failed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-failed-verify-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    let calls = 0;
    sessions.cursorCliSpawner = (req) => {
      calls += 1;
      captured.push({ args: req.args, cwd: req.cwd });
      const lines =
        calls === 1
          ? [
              JSON.stringify({ type: "system", subtype: "init", session_id: "cli-fail-test" }),
              JSON.stringify({
                type: "tool_call",
                subtype: "completed",
                call_id: "w1",
                tool_call: {
                  writeToolCall: {
                    args: { path: "src/nudge.js", fileText: "export const n = 1;\n" },
                    result: { success: true },
                  },
                },
              }),
              JSON.stringify({
                type: "tool_call",
                subtype: "completed",
                call_id: "t1",
                tool_call: {
                  shellToolCall: {
                    args: { command: "npm test" },
                    result: {
                      error: "FAIL src/add.test.js\ntests failed\n(exit 1)",
                    },
                  },
                },
              }),
              JSON.stringify({
                type: "assistant",
                timestamp_ms: 1,
                message: { content: [{ type: "text", text: "tests failed" }] },
              }),
              JSON.stringify({ type: "result", subtype: "success", result: "tests failed" }),
            ]
          : [
              JSON.stringify({ type: "system", subtype: "init", session_id: "cli-fail-test" }),
              JSON.stringify({
                type: "assistant",
                timestamp_ms: 1,
                message: { content: [{ type: "text", text: "tests failed but I am done" }] },
              }),
              JSON.stringify({
                type: "result",
                subtype: "success",
                result: "tests failed but I am done",
              }),
            ];
      return {
        lines: (async function* () {
          for (const line of lines) yield line;
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      };
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(created.id, "clean up TODOs");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        Boolean(session.needsHuman) &&
        session.messages.some((m) => m.content === "tests failed but I am done"),
    );
    expect(calls).toBe(2);
    expect(fresh?.messages.some((m) => m.content === SELF_CORRECT_TEST_NUDGE)).toBe(true);
    expect(captured[1]?.args.at(-1)).toBe(SELF_CORRECT_TEST_NUDGE);
    expect(fresh?.needsHuman).toMatch(/never passed/);
    hypervisor.shutdown();
  });

  it("resumes a Cursor CLI design turn when the canvas is a generic template", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-design-quality-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const slop = `<!doctype html><html><head><style>body{font-family:Inter,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2)}</style></head><body><h1>Unlock your potential</h1></body></html>`;
    const distinctive = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:Georgia,serif;background:var(--bg);color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
    const captured: Array<{ args: string[]; cwd: string }> = [];
    let calls = 0;
    sessions.cursorCliSpawner = (req) => {
      calls += 1;
      captured.push({ args: req.args, cwd: req.cwd });
      const html = calls === 1 ? slop : distinctive;
      const lines = [
        JSON.stringify({ type: "system", subtype: "init", session_id: "cli-quality" }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "w1",
          tool_call: {
            writeToolCall: {
              args: { path: "/workspace/index.html", fileText: html },
              result: { success: html },
            },
          },
        }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "p1",
          tool_call: {
            mcpToolCall: {
              args: { name: "playwright" },
              result: { success: { ok: true } },
            },
          },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: {
            content: [{ type: "text", text: calls === 1 ? "first paint" : "patched the type" }],
          },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: calls === 1 ? "first paint" : "patched the type",
        }),
      ];
      return {
        lines: (async function* () {
          for (const line of lines) yield line;
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      };
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(created.id, "Design a product page");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((m) => m.content === DESIGN_QUALITY_NUDGE) &&
        session.messages.some((m) => m.content === "patched the type"),
    );
    expect(calls).toBe(2);
    expect(fresh?.messages.some((m) => m.content === DESIGN_QUALITY_NUDGE)).toBe(true);
    expect(captured[1]?.args.at(-1)).toMatch(/Design canvas snapshot/);
    expect(captured[1]?.args.at(-1)).toContain(DESIGN_QUALITY_NUDGE);
    expect(captured[1]?.args.at(-1)).toMatch(/Unlock your potential|generic template: yes/);
    const canvas = await sessions.design.readCanvas(created.id);
    expect(canvas.html).toContain("Press ledger");
    hypervisor.shutdown();
  });

  it("resumes a Cursor CLI design turn when the canvas is a host fallback stub", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-host-fallback-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const stub = `<!doctype html><html lang="en" data-locus-host-fallback="design"><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:ui-sans-serif,system-ui,sans-serif}</style></head><body><h1>First draft</h1></body></html>`;
    const distinctive = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:Georgia,serif;background:var(--bg);color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
    const captured: Array<{ args: string[]; cwd: string }> = [];
    let calls = 0;
    sessions.cursorCliSpawner = (req) => {
      calls += 1;
      captured.push({ args: req.args, cwd: req.cwd });
      const html = calls === 1 ? stub : distinctive;
      const lines = [
        JSON.stringify({ type: "system", subtype: "init", session_id: "cli-fallback" }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "w1",
          tool_call: {
            writeToolCall: {
              args: { path: "/workspace/index.html", fileText: html },
              result: { success: html },
            },
          },
        }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "p1",
          tool_call: {
            mcpToolCall: {
              args: { name: "playwright" },
              result: { success: { ok: true } },
            },
          },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: {
            content: [{ type: "text", text: calls === 1 ? "first paint" : "rewrote the stub" }],
          },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: calls === 1 ? "first paint" : "rewrote the stub",
        }),
      ];
      return {
        lines: (async function* () {
          for (const line of lines) yield line;
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      };
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(created.id, "Design a product page");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((m) => m.content === HOST_FALLBACK_NUDGE) &&
        session.messages.some((m) => m.content === "rewrote the stub"),
    );
    expect(calls).toBe(2);
    expect(fresh?.messages.some((m) => m.content === HOST_FALLBACK_NUDGE)).toBe(true);
    expect(fresh?.messages.some((m) => m.content === DESIGN_QUALITY_NUDGE)).toBe(false);
    expect(captured[1]?.args.at(-1)).toMatch(/Design canvas snapshot/);
    expect(captured[1]?.args.at(-1)).toContain(HOST_FALLBACK_NUDGE);
    expect(captured[1]?.args.at(-1)).toMatch(/host fallback: yes/);
    const canvas = await sessions.design.readCanvas(created.id);
    expect(canvas.html).toContain("Press ledger");
    expect(canvas.html).not.toContain("data-locus-host-fallback");
    hypervisor.shutdown();
  });

  it("turns Cursor CLI createPlan into a Locus plan card without /plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-plan-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    sessions.cursorCliSpawner = linesSpawner(
      [],
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "cli-plan" }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "mode",
          tool_call: {
            switchModeToolCall: {
              args: { targetModeId: "plan", explanation: "Product-base change" },
              result: { success: { fromModeId: "", toModeId: "plan" } },
            },
          },
        }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "ask",
          tool_call: {
            askQuestionToolCall: {
              args: {
                title: "Ubuntu 26.04.1 base — scope",
                questions: [
                  {
                    id: "ubuntu_scope",
                    prompt: "What should become Ubuntu in this change?",
                    options: [
                      { id: "iso_host", label: "ISO + host installer/desktop only (recommended)." },
                      { id: "everything", label: "Everything, including Docker guests." },
                    ],
                  },
                ],
              },
              result: {
                success: {
                  rejected: {
                    reason:
                      "Questions skipped by the user, continue with the information you already have",
                  },
                },
              },
            },
          },
        }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "plan",
          tool_call: {
            createPlanToolCall: {
              args: {
                name: "Ubuntu 26.04 ISO",
                overview: "Retarget the live ISO from Arch to Ubuntu 26.04.1",
                plan: "# Ubuntu 26.04.1\n\nFiles:\n- scripts/build-iso.sh\nRisks:\n- Docker guests stay Arch",
                todos: [
                  {
                    id: "iso-builder",
                    content: "Rewrite scripts/build-iso.sh",
                    status: "TODO_STATUS_PENDING",
                  },
                  {
                    id: "apt-packages",
                    content: "Convert package lists to Ubuntu names",
                    status: "TODO_STATUS_PENDING",
                  },
                ],
              },
              result: { success: {} },
            },
          },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: { content: [{ type: "text", text: "Drafted the Ubuntu 26.04.1 ISO plan." }] },
        }),
        JSON.stringify({ type: "result", subtype: "success", result: "Drafted the plan." }),
      ],
    );
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(
      created.id,
      "Can we make this ubuntu ( 26.04.1) based instead of arch.",
    );
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) => Boolean(session.plan?.items.length) && session.status !== "running",
    );
    expect(fresh?.plan?.phase).toBe("proposed");
    expect(fresh?.plan?.items.map((item) => item.text)).toEqual([
      "Rewrite scripts/build-iso.sh",
      "Convert package lists to Ubuntu names",
    ]);
    expect(fresh?.plan?.files).toEqual(["scripts/build-iso.sh"]);
    expect(fresh?.taskList?.map((item) => item.text)).toEqual([
      "Rewrite scripts/build-iso.sh",
      "Convert package lists to Ubuntu names",
    ]);
    const assistant = fresh?.messages.find((message) => message.role === "assistant");
    expect(assistant?.toolCalls?.some((call) => call.name === "ask_user")).toBe(true);
    expect(assistant?.toolCalls?.find((call) => call.name === "ask_user")?.arguments).toMatchObject(
      {
        question: "Ubuntu 26.04.1 base — scope",
      },
    );
    expect(assistant?.toolCalls?.some((call) => call.name === "createPlan")).toBe(true);
    hypervisor.shutdown();
  });

  it("stubs completed Cursor CLI write bodies so session JSON is not a second canvas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-write-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const html = `<!DOCTYPE html>${"x".repeat(4_000)}`;
    sessions.cursorCliSpawner = linesSpawner(
      [],
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "cli-write" }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "t1",
          tool_call: {
            editToolCall: {
              args: { path: "/workspace/.locus-variants/direction-1.html", streamContent: html },
              result: { success: html },
            },
          },
        }),
        JSON.stringify({ type: "result", subtype: "success", result: "wrote" }),
      ],
    );
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(created.id, "three variants");
    const fresh = await waitFor(sessions, created.id, (session) => session.status !== "running");
    const write = fresh?.messages
      .find((message) => message.role === "assistant")
      ?.toolCalls?.find((call) => call.name === "apply_patch");
    expect(String(write?.arguments?.streamContent)).toContain("already written");
    expect(String(write?.arguments?.streamContent).length).toBeLessThan(html.length);
    expect(String(write?.result ?? "").length).toBeLessThan(html.length);
    const events = await new SessionTraceLog(dir).read(created.id);
    const traced = events.find(
      (event) => event.name === "apply_patch" && event.args?.streamContent,
    );
    expect(String(traced?.args?.streamContent ?? "").length).toBeLessThan(html.length);
    hypervisor.shutdown();
  });

  it("stubs completed Cursor CLI writeToolCall fileText so session JSON is not a second canvas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-filetext-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const html = `<!DOCTYPE html>${"x".repeat(4_000)}`;
    sessions.cursorCliSpawner = linesSpawner(
      [],
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "cli-filetext" }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "t1",
          tool_call: {
            writeToolCall: {
              args: { path: "/workspace/index.html", fileText: html },
              result: { success: html },
            },
          },
        }),
        JSON.stringify({ type: "result", subtype: "success", result: "wrote" }),
      ],
    );
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(created.id, "write the canvas");
    const fresh = await waitFor(sessions, created.id, (session) => session.status !== "running");
    const write = fresh?.messages
      .find((message) => message.role === "assistant")
      ?.toolCalls?.find((call) => call.name === "file_write");
    expect(String(write?.arguments?.fileText)).toContain("already written");
    expect(String(write?.arguments?.fileText).length).toBeLessThan(html.length);
    expect(String(write?.result ?? "").length).toBeLessThan(html.length);
    hypervisor.shutdown();
  });

  it.skipIf(process.platform === "win32")(
    "paints Cursor CLI fileText onto a design canvas even when the CLI did not write the file",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-canvas-write-"));
      cleanup.push(dir);
      const store = new JsonStore(dir);
      await store.init();
      const config = await store.loadConfig();
      const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
      cursor.enabled = true;
      await store.saveConfig(config);
      const hypervisor = new MockHypervisor(dir);
      const sessions = new SessionService(store, hypervisor, new Hub());
      const html = `<!DOCTYPE html><html><body><h1>Paws & Petite</h1></body></html>`;
      const captured: Array<{ args: string[]; cwd: string }> = [];
      sessions.cursorCliSpawner = linesSpawner(captured, [
        JSON.stringify({ type: "system", subtype: "init", session_id: "cli-canvas" }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "t1",
          tool_call: {
            writeToolCall: {
              args: { path: "/workspace/index.html", fileText: html },
              result: { success: html },
            },
          },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: {
            content: [{ type: "text", text: "Your walking page is live in the canvas." }],
          },
        }),
        JSON.stringify({ type: "result", subtype: "success", result: "live" }),
      ]);
      const created = await sessions.create({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        kind: "design",
        runtime: "docker",
        providerId: cursor.id,
        model: "composer-2",
        startVm: false,
      });
      await sessions.sendChat(created.id, "Chihuahua walking business");
      await waitFor(sessions, created.id, (session) => session.status !== "running");
      const canvas = await sessions.design.readCanvas(created.id);
      expect(canvas.html).toContain("Paws & Petite");
      expect(captured[0]?.args.at(-1)).toMatch(/Design canvas snapshot/);
      expect(captured[0]?.args.at(-1)).toMatch(/Chihuahua walking business/);
      const rule = await readFile(join(captured[0]!.cwd, ".cursor", "rules", "locus.mdc"), "utf8");
      expect(rule).toMatch(/relative path index\.html/);
      expect(rule).toMatch(/Do not write \/workspace\/index\.html/);
      hypervisor.shutdown();
    },
  );

  it("retries a Cursor CLI design turn that only talks, then paints a first draft", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-empty-canvas-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[] }> = [];
    let calls = 0;
    sessions.cursorCliSpawner = (req) => {
      calls += 1;
      captured.push({ args: req.args });
      return {
        lines: (async function* () {
          yield JSON.stringify({ type: "system", subtype: "init", session_id: "cli-empty" });
          yield JSON.stringify({
            type: "assistant",
            timestamp_ms: 1,
            message: {
              content: [
                { type: "text", text: "Your chihuahua walking page is live in the canvas." },
              ],
            },
          });
          yield JSON.stringify({
            type: "result",
            subtype: "success",
            result: "Your chihuahua walking page is live in the canvas.",
          });
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      };
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(created.id, "Build a chihuahua walking site");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) => session.status !== "running" && Boolean(session.cursorCli?.sessionId),
    );
    expect(calls).toBe(3);
    expect(
      fresh?.messages.some((m) => m.role === "system" && m.content.includes("still empty")),
    ).toBe(true);
    const canvas = await sessions.design.readCanvas(created.id);
    expect(canvas.html).toContain("chihuahua walking");
    expect(canvas.html).toContain("First draft");
    expect(canvas.html).toContain("data-locus-host-fallback");
    expect(fresh?.needsHuman).toMatch(/starter draft on this canvas/);
    expect(captured[1]?.args.at(-1)).toMatch(/Design canvas snapshot/);
    expect(captured[1]?.args.at(-1)).toMatch(/file_write now/);
    hypervisor.shutdown();
  });

  it("harvests HTML dumped in a Cursor CLI design reply onto the canvas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-harvest-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    sessions.cursorCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "cli-harvest" }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 1,
        message: {
          content: [
            {
              type: "text",
              text: "```html\n<html><body><h1>Harvested</h1></body></html>\n```",
            },
          ],
        },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "done" }),
    ]);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(created.id, "Make a page");
    await waitFor(sessions, created.id, (session) => session.status !== "running");
    const canvas = await sessions.design.readCanvas(created.id);
    expect(canvas.html).toContain("Harvested");
    expect(captured[1]?.args.at(-1)).toMatch(/Design canvas snapshot/);
    expect(captured[1]?.args.at(-1)).toContain(DESIGN_LOOK_NUDGE);
    hypervisor.shutdown();
  });

  it("promotes a nested workspace/index.html onto the live canvas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-nested-canvas-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const full = `<!DOCTYPE html>\n<html lang="en"><body><h1>Paws & Petite</h1><p>Chihuahua walking specialists.</p></body></html>\n`;
    const truncated = '<!DOCTYPE html>\n<html lang="en"><head><title>Paws';
    sessions.cursorCliSpawner = linesSpawner(
      [],
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "cli-nested" }),
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "t1",
          tool_call: {
            editToolCall: {
              args: {
                path: "/home/locus/.locus/docker-workspaces/sess/workspace/index.html",
                streamContent: truncated,
              },
              result: { success: true },
            },
          },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: {
            content: [{ type: "text", text: "Your walking page is live in the canvas." }],
          },
        }),
        JSON.stringify({ type: "result", subtype: "success", result: "live" }),
      ],
    );
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    const ws = dockerWorkspaceDir(dir, created.id);
    await mkdir(join(ws, "workspace"), { recursive: true });
    await writeFile(join(ws, "workspace", "index.html"), full);
    await sessions.sendChat(
      created.id,
      "can you make a small webpage for my chihuahua walking business",
    );
    await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((message) => message.content.includes("walking page")),
    );
    const deadline = Date.now() + 4000;
    let canvas = await sessions.design.readCanvas(created.id);
    while (!canvas.html?.includes("Paws & Petite") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      canvas = await sessions.design.readCanvas(created.id);
    }
    expect(canvas.html ?? "", "promoted nested workspace/index.html").toContain("Paws & Petite");
    expect(canvas.html).toContain("Chihuahua walking specialists");
    expect(canvas.html).not.toBe(truncated);
    hypervisor.shutdown();
  });

  it("does not exclude Cursor webSearch when the session Web toggle is on", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-web-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    sessions.cursorCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "cli-web" }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 1,
        message: { content: [{ type: "text", text: "ok" }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "ok" }),
    ]);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      webSearch: true,
      startVm: false,
    });
    await sessions.sendChat(created.id, "search the web");
    await waitFor(sessions, created.id, (session) => session.status !== "running");
    expect(captured[0]?.args).not.toContain("--exclude-tools");
    hypervisor.shutdown();
  });

  it("parks the session when the CLI result arrives even if stdout stays open", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    sessions.cursorCliSpawner = () => ({
      lines: (async function* () {
        yield JSON.stringify({ type: "system", subtype: "init", session_id: "cli-hang" });
        yield JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: { content: [{ type: "text", text: "done" }] },
        });
        yield JSON.stringify({
          type: "result",
          subtype: "success",
          result: "done",
          usage: { inputTokens: 20_000, outputTokens: 40, contextWindow: 200_000 },
        });
        await new Promise(() => {});
      })(),
      wait: async () => ({ code: 0, stderr: "" }),
    });
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(created.id, "finish please");
    const fresh = await waitFor(sessions, created.id, (session) => session.status !== "running");
    expect(fresh?.status).toBe("idle");
    expect(fresh?.cursorCli?.sessionId).toBe("cli-hang");
    expect(fresh?.messages.some((m) => m.role === "assistant" && m.content.includes("done"))).toBe(
      true,
    );
    expect(fresh?.context?.used).toBe(20_000);
    expect(fresh?.context?.window).toBe(200_000);
    expect(formatContextPercent(fresh!.context!.used, fresh!.context!.window)).toBe("10%");
    hypervisor.shutdown();
  });

  it("prepends an ops routing card on Grafana/Slack prompts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-ops-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    config.integrations = [
      {
        id: "g1",
        kind: "grafana",
        name: "Grafana",
        enabled: true,
        baseUrl: "https://grafana.example.com",
        token: "glsa_test",
      },
    ];
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    sessions.cursorCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "cli-ops" }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 1,
        message: { content: [{ type: "text", text: "ok" }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "ok" }),
    ]);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(
      created.id,
      "Pull Grafana error logs for the last hour and post them to Slack",
    );
    await waitFor(sessions, created.id, (session) =>
      Boolean(session.cursorCli?.sessionId && session.status !== "running"),
    );
    const prompt = captured[0]?.args.at(-1) ?? "";
    expect(prompt).toContain("grafana_query");
    expect(prompt).toContain("locus MCP server");
    expect(prompt).toContain("Do not write a scrape script or curl");
    expect(prompt).toContain("Pull Grafana error logs");
    expect(prompt).not.toContain("are not in this catalog");
    expect(captured[0]?.args).toContain("--approve-mcps");
    const mcp = JSON.parse(
      await readFile(join(captured[0]!.cwd, ".cursor", "mcp.json"), "utf8"),
    ) as {
      mcpServers: { locus?: { url?: string } };
    };
    expect(mcp.mcpServers.locus?.url).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/mcp\/sessions\/[0-9a-f-]+$/,
    );
    expect(JSON.stringify(mcp)).not.toContain("glsa_test");
    hypervisor.shutdown();
  });

  it("boots a Docker guest and refuses VM sessions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    sessions.cursorCliSpawner = linesSpawner(
      [],
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "cli-docker" }),
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: { content: [{ type: "text", text: "hi" }] },
        }),
        JSON.stringify({ type: "result", subtype: "success", result: "hi" }),
      ],
    );
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "ubuntu:24.04",
      providerId: cursor.id,
      model: "composer-2",
      startVm: true,
    });
    expect(created.vmId).toBeTruthy();
    await sessions.sendChat(created.id, "hi");
    const fresh = await waitFor(sessions, created.id, (session) =>
      Boolean(session.cursorCli?.sessionId && session.status !== "running"),
    );
    expect(fresh?.cursorCli?.sessionId).toBe("cli-docker");
    expect(fresh?.vmId).toBeTruthy();

    const vmCli = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "vm",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    expect(vmCli.runtime).toBe("vm");
    expect(vmCli.providerId).toBe(cursor.id);
    hypervisor.shutdown();
  });

  it("registers Explore 3 direction files as named variants after the turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-explore-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    sessions.cursorCliSpawner = linesSpawner(
      [],
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "cli-explore" }),
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: { content: [{ type: "text", text: "Three directions are on the canvas." }] },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "Three directions are on the canvas.",
        }),
      ],
    );
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      providerId: cursor.id,
      model: "composer-2",
      startVm: true,
    });
    const ws = dockerWorkspaceDir(dir, created.id);
    await mkdir(join(ws, ".locus-variants"), { recursive: true });
    await writeFile(join(ws, ".locus-variants", "direction-1.html"), "<html>one</html>\n");
    await writeFile(join(ws, ".locus-variants", "direction-2.html"), "<html>two</html>\n");
    await writeFile(join(ws, ".locus-variants", "direction-3.html"), "<html>three</html>\n");
    await writeFile(join(ws, "index.html"), "<html>one</html>\n");
    await sessions.sendChat(created.id, "Explore three directions");
    const fresh = await waitFor(sessions, created.id, (session) =>
      Boolean(session.designVariants?.length === 3 && session.status !== "running"),
    );
    expect(fresh?.designVariants).toEqual([
      { id: "direction-1", name: "Direction 1" },
      { id: "direction-2", name: "Direction 2" },
      { id: "direction-3", name: "Direction 3" },
    ]);
    expect(fresh?.activeVariantId).toBe("direction-1");
    hypervisor.shutdown();
  });

  it("registers explored direction files when the canvas is read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-canvas-explore-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "docker",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    const ws = dockerWorkspaceDir(dir, created.id);
    await mkdir(join(ws, ".locus-variants"), { recursive: true });
    await writeFile(join(ws, ".locus-variants", "direction-1.html"), "<html>one</html>\n");
    await writeFile(join(ws, ".locus-variants", "direction-2.html"), "<html>two</html>\n");
    await writeFile(join(ws, ".locus-variants", "direction-3.html"), "<html>three</html>\n");
    await writeFile(join(ws, "index.html"), "<html>two</html>\n");
    const canvas = await sessions.design.readCanvas(created.id);
    expect(canvas.html).toContain("two");
    const fresh = await sessions.get(created.id);
    expect(fresh?.designVariants).toEqual([
      { id: "direction-1", name: "Direction 1" },
      { id: "direction-2", name: "Direction 2" },
      { id: "direction-3", name: "Direction 3" },
    ]);
    expect(fresh?.activeVariantId).toBe("direction-2");
    hypervisor.shutdown();
  });

  it("updates the context meter from Cursor CLI result usage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    sessions.cursorCliSpawner = linesSpawner(
      [],
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "cli-ctx" }),
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: { content: [{ type: "text", text: "Working." }] },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "Working.",
          usage: {
            inputTokens: 20_000,
            outputTokens: 80,
            cacheReadTokens: 10_624,
            contextWindow: 200_000,
          },
        }),
      ],
    );
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    await sessions.sendChat(created.id, "Add a README");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) => session.context?.measured === true && session.status !== "running",
    );
    expect(fresh?.context?.used).toBe(30_624);
    expect(fresh?.context?.window).toBe(200_000);
    expect(formatContextPercent(fresh!.context!.used, fresh!.context!.window)).toBe("15%");
    expect(fresh?.context?.cachedInputTokens).toBe(10_624);
    hypervisor.shutdown();
  });

  it("does not let Cursor CLI turn totals exceed the model window", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-over-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    sessions.cursorCliSpawner = linesSpawner(
      [],
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "cli-over" }),
        JSON.stringify({
          type: "assistant",
          timestamp_ms: 1,
          message: { content: [{ type: "text", text: "Working." }] },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "Working.",
          usage: {
            inputTokens: 275_312,
            outputTokens: 17_676,
            cacheReadTokens: 636_000,
            cacheWriteTokens: 40_000,
            contextWindow: 256_000,
          },
        }),
      ],
    );
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "cursor-grok-4.6",
      startVm: false,
    });
    await sessions.sendChat(created.id, "Continue");
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) => session.context?.measured === true && session.status !== "running",
    );
    expect(fresh?.context?.window).toBe(256_000);
    expect(fresh?.context?.used).toBe(256_000);
    expect(fresh?.context?.used).toBeLessThanOrEqual(fresh!.context!.window);
    expect(fresh?.context?.cachedInputTokens).toBe(256_000);
    expect(formatContextPercent(fresh!.context!.used, fresh!.context!.window)).toBe("100%");
    expect(
      formatContextUsage(fresh!.context!.used, fresh!.context!.window, { measured: true }),
    ).toBe("256k / 256k");
    expect(fresh?.usage?.inputTokens).toBe(275_312);
    hypervisor.shutdown();
  });

  it("saves config that includes the Cursor CLI sentinel URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const sessions = new SessionService(store, hypervisor, hub);
    const app = createApp({ store, sessions, hypervisor, hub });
    const config = await store.loadConfig();
    expect(config.providers.some((p) => p.kind === "cursor-cli")).toBe(true);
    const saved = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    expect(saved.status).toBe(200);
    hypervisor.shutdown();
  });

  it("steers a running Cursor CLI turn by interrupting agent -p and resuming", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-steer-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[] }> = [];
    let first = true;
    sessions.cursorCliSpawner = (req) => {
      captured.push({ args: req.args });
      if (first) {
        first = false;
        let done = false;
        req.signal?.addEventListener("abort", () => {
          done = true;
        });
        return {
          lines: (async function* () {
            yield JSON.stringify({ type: "system", subtype: "init", session_id: "cli-steer" });
            yield JSON.stringify({
              type: "assistant",
              timestamp_ms: 1,
              message: { content: [{ type: "text", text: "working" }] },
            });
            while (!done && !req.signal?.aborted) {
              await new Promise((r) => setTimeout(r, 15));
            }
          })(),
          wait: async () => ({ code: 0, stderr: "" }),
          kill: () => {
            done = true;
          },
        };
      }
      return {
        lines: (async function* () {
          yield JSON.stringify({ type: "system", subtype: "init", session_id: "cli-steer" });
          yield JSON.stringify({
            type: "assistant",
            timestamp_ms: 1,
            message: { content: [{ type: "text", text: "steered" }] },
          });
          yield JSON.stringify({ type: "result", subtype: "success", result: "steered" });
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
      };
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    const pending = sessions.sendChat(created.id, "start the work");
    await waitFor(sessions, created.id, (session) =>
      Boolean(
        session.messages.some((m) => m.role === "assistant" && m.content.includes("working")),
      ),
    );
    await sessions.sendChat(created.id, "do this instead", { steer: true });
    await pending.catch(() => undefined);
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((m) => m.role === "assistant" && m.content.includes("steered")),
    );
    expect(
      fresh?.messages.some(
        (m) => m.role === "user" && m.steer && m.content.includes("do this instead"),
      ),
    ).toBe(true);
    expect(captured).toHaveLength(2);
    expect(captured[1]?.args).toEqual(
      expect.arrayContaining(["--resume", "cli-steer", "do this instead"]),
    );
    hypervisor.shutdown();
  });

  it("writes review routing into a Cursor CLI alwaysApply rule", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-review-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    sessions.cursorCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "cli-review" }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 1,
        message: { content: [{ type: "text", text: "reviewed" }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "reviewed" }),
    ]);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "review",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: cursor.id,
      model: "composer-2",
      startVm: true,
    });
    await sessions.sendChat(created.id, "review this");
    await waitFor(sessions, created.id, (session) =>
      Boolean(session.cursorCli?.sessionId && session.status !== "running"),
    );
    const prompt = captured[0]?.args.at(-1) ?? "";
    expect(prompt).toBe("review this");
    expect(captured[0]?.args.join(" ")).toMatch(/write_tool_call/);
    const rule = await readFile(join(captured[0]!.cwd, ".cursor", "rules", "locus.mdc"), "utf8");
    expect(rule).toContain("alwaysApply: true");
    expect(rule).toContain("git_pr_get");
    expect(rule).toContain("still a review session");
    hypervisor.shutdown();
  });

  it("does not ship a Cursor CLI guessed PASS without git_pr_get", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-review-pass-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    sessions.cursorCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "cli-review-pass" }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 1,
        message: {
          content: [
            {
              type: "text",
              text: '{"verdict":"PASS","reasons":[],"risk":"low"}',
            },
          ],
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: '{"verdict":"PASS","reasons":[],"risk":"low"}',
      }),
    ]);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "review",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: cursor.id,
      model: "composer-2",
      startVm: true,
    });
    await sessions.sendChat(created.id, "review this");
    const fresh = await waitFor(sessions, created.id, (session) =>
      Boolean(session.needsHuman && session.status !== "running"),
    );
    expect(captured.length).toBeGreaterThan(1);
    expect(fresh?.needsHuman).toMatch(/git_pr_get include=\["files"\]/);
    hypervisor.shutdown();
  });

  it("resumes Cursor CLI review once when the JSON verdict is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-review-nudge-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    sessions.cursorCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "cli-review-nudge" }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 1,
        message: { content: [{ type: "text", text: "Looks fine" }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "Looks fine" }),
    ]);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "review",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: cursor.id,
      model: "composer-2",
      startVm: true,
    });
    await sessions.sendChat(created.id, "review this");
    const fresh = await waitFor(sessions, created.id, (session) =>
      Boolean(session.needsHuman && session.status !== "running"),
    );
    const prompts = captured.map((row) => row.args.at(-1));
    expect(prompts[0]).toBe("review this");
    expect(prompts.some((prompt) => typeof prompt === "string" && /JSON object/.test(prompt))).toBe(
      true,
    );
    expect(captured[1]?.args).toEqual(expect.arrayContaining(["--resume", "cli-review-nudge"]));
    expect(fresh?.needsHuman).toMatch(/not valid JSON/i);
    hypervisor.shutdown();
  });

  it("keeps later Cursor CLI review turns as the user text only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-review-followup-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[]; cwd: string }> = [];
    sessions.cursorCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "cli-review-follow" }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 1,
        message: {
          content: [
            {
              type: "text",
              text: '{"verdict":"FAIL","reasons":["stale rows"],"risk":"high"}',
            },
          ],
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: '{"verdict":"FAIL","reasons":["stale rows"],"risk":"high"}',
      }),
    ]);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "review",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: cursor.id,
      model: "composer-2",
      startVm: true,
    });
    await sessions.sendChat(created.id, "review this");
    await waitFor(sessions, created.id, (session) =>
      Boolean(session.needsHuman && session.status !== "running"),
    );
    const firstTurnSpawns = captured.length;
    sessions.cursorCliSpawner = linesSpawner(captured, [
      JSON.stringify({ type: "system", subtype: "init", session_id: "cli-review-follow" }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 1,
        message: { content: [{ type: "text", text: "still looking" }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "still looking" }),
    ]);
    await sessions.sendChat(created.id, "Can you continue on?");
    const fresh = await waitFor(sessions, created.id, (session) => session.status !== "running");
    expect(captured[firstTurnSpawns]?.args.at(-1)).toBe("Can you continue on?");
    expect(captured[firstTurnSpawns]?.args.at(-1)).not.toMatch(/still a review session/);
    expect(fresh?.needsHuman).toBeUndefined();
    hypervisor.shutdown();
  });

  it("does not enqueue a duplicate in-flight Cursor CLI prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cursor-cli-dup-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const cursor = config.providers.find((p) => p.kind === "cursor-cli")!;
    cursor.enabled = true;
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const captured: Array<{ args: string[] }> = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    sessions.cursorCliSpawner = (req) => {
      captured.push({ args: req.args });
      return {
        lines: (async function* () {
          yield JSON.stringify({ type: "system", subtype: "init", session_id: "cli-dup" });
          await gate;
          yield JSON.stringify({
            type: "assistant",
            timestamp_ms: 1,
            message: { content: [{ type: "text", text: "done" }] },
          });
          yield JSON.stringify({ type: "result", subtype: "success", result: "done" });
        })(),
        wait: async () => {
          await gate;
          return { code: 0, stderr: "" };
        },
      };
    };
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: cursor.id,
      model: "composer-2",
      startVm: false,
    });
    const pending = sessions.sendChat(created.id, "review this");
    await waitFor(sessions, created.id, (session) =>
      Boolean(
        session.status === "running" &&
        session.messages.some((m) => m.role === "user" && m.content === "review this"),
      ),
    );
    const spawnDeadline = Date.now() + 4000;
    while (!captured.length && Date.now() < spawnDeadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await sessions.sendChat(created.id, "review this");
    expect((await sessions.get(created.id))?.queue ?? []).toEqual([]);
    expect(captured).toHaveLength(1);
    release();
    await pending;
    hypervisor.shutdown();
  });
});

describe("isStartPromptResumeTail", () => {
  const message = (
    content: string,
    extra: { hidden?: boolean; role?: "system" | "assistant" } = {},
  ) => ({
    id: "m1",
    role: extra.role ?? "system",
    content,
    hidden: extra.hidden,
    createdAt: "2020-01-01T00:00:00.000Z",
  });

  it("drops game snapshots and nudges, and keeps other hidden notes", () => {
    expect(
      isStartPromptResumeTail(
        message("Game canvas snapshot\n- index.html 1 bytes", { hidden: true }),
      ),
    ).toBe(true);
    expect(
      isStartPromptResumeTail(
        message("Asset canvas snapshot\n- index.html 1 bytes", { hidden: true }),
      ),
    ).toBe(true);
    expect(
      isStartPromptResumeTail(
        message("Design canvas snapshot\n- index.html 1 bytes", { hidden: true }),
      ),
    ).toBe(true);
    expect(
      isStartPromptResumeTail(message(`${PROCESS_DONE_NUDGE}\n\nnode probe`, { hidden: true })),
    ).toBe(false);
    expect(isStartPromptResumeTail(message("still starting", { role: "assistant" }))).toBe(true);
  });
});

describe("cursorCliToolCallOk", () => {
  it("treats completed plain-text results as ok even when they mention fail", () => {
    expect(cursorCliToolCallOk("completed", "CI failures on main")).toBe(true);
    expect(cursorCliToolCallOk("completed", '{"isError":true}')).toBe(false);
    expect(cursorCliToolCallOk("completed", '{"ok":false}')).toBe(false);
    expect(cursorCliToolCallOk("completed", '{"exitCode":1,"stdout":"fail: keybind"}')).toBe(false);
    expect(cursorCliToolCallOk("completed", '{"exitCode":0}')).toBe(true);
    expect(cursorCliToolCallOk("started")).toBeUndefined();
  });
});
