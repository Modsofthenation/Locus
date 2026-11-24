import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor, sessionHostWorkspace } from "@locus/hypervisor";
import { TEST_GATE_PROMPT_TOOL, testGateAnswer, type ToolCall } from "@locus/shared";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "../session/sessions.js";

const cleanup: string[] = [];
const isWin = process.platform === "win32";

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

/**
 * Host session whose `npm run test` writes a marker and fails, with a recorded
 * 45-minute last run so the gate counts as slow.
 */
async function setup(opts: { slowHistory?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "locus-test-gate-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const config = await store.loadConfig();
  const hypervisor = new MockHypervisor(dir);
  const sessions = new SessionService(store, hypervisor, new Hub());
  const session = await sessions.create({
    os: "ubuntu",
    templateId: config.templates[0]!.id,
    runtime: "host",
    providerId: config.providers[0]!.id,
    model: config.providers[0]!.defaultModel,
    startVm: false,
  });
  const root = sessionHostWorkspace(dir, session);
  const marker = join(root, "tests-ran.txt");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "gate",
      scripts: {
        test: `node -e "require('fs').writeFileSync('tests-ran.txt','1'); console.log('FAIL  src/a.test.ts'); process.exit(1)"`,
      },
    }),
    "utf8",
  );
  if (opts.slowHistory !== false) {
    await writeFile(
      join(dir, "test-gate-history.json"),
      JSON.stringify({ [root]: { ms: 45 * 60_000, at: new Date().toISOString() } }),
      "utf8",
    );
  }
  return { dir, store, sessions, session, marker, hypervisor };
}

async function waitForPrompt(sessions: SessionService, id: string): Promise<ToolCall> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const fresh = await sessions.get(id);
    const call = fresh?.messages
      .flatMap((m) => m.toolCalls ?? [])
      .find((c) => c.name === TEST_GATE_PROMPT_TOOL && c.approval === "needed" && !c.finishedAt);
    if (call) return call;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("test gate prompt never appeared");
}

const push = { name: "git_push" as const, args: { branch: "feature/x" } };

describe.skipIf(isWin)("git_push test gate choice", () => {
  it("runs and blocks on failure when an operator approved without a choice", async () => {
    const { sessions, session, marker, hypervisor } = await setup();
    const result = await sessions.executeTool(session.id, push, { testGate: "run" });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Harness blocked git_push: tests failed/);
    expect(existsSync(marker)).toBe(true);
    hypervisor.shutdown();
  }, 30_000);

  it("skips the tests when the operator chose skip on the approval card", async () => {
    const { sessions, session, marker, hypervisor } = await setup();
    const result = await sessions.executeTool(session.id, push, { testGate: "skip" });
    expect(result.output).not.toMatch(/Harness blocked/);
    expect(existsSync(marker)).toBe(false);
    hypervisor.shutdown();
  }, 30_000);

  it("asks before a slow gate when no approval card was shown, and honors skip", async () => {
    const { sessions, session, marker, hypervisor } = await setup();
    const pending = sessions.executeTool(session.id, {
      name: "git_push",
      args: { branch: "feature/x", skipTests: true, skipTestsReason: "user: push without tests" },
    });
    const prompt = await waitForPrompt(sessions, session.id);
    expect(prompt.arguments).toMatchObject({
      tool: "git_push",
      skipRequested: true,
      reason: "user: push without tests",
      lastDurationMs: 45 * 60_000,
    });
    await sessions.resolveApproval(session.id, prompt.id, "approved", testGateAnswer("skip"));
    const result = await pending;
    expect(result.output).not.toMatch(/Harness blocked/);
    expect(existsSync(marker)).toBe(false);
    const row = (await sessions.get(session.id))?.messages
      .flatMap((m) => m.toolCalls ?? [])
      .find((c) => c.id === prompt.id);
    expect(row?.finishedAt).toBeTruthy();
    expect(row?.result).toMatch(/Skip tests/);
    hypervisor.shutdown();
  }, 30_000);

  it("a plain approve on the prompt runs the tests", async () => {
    const { sessions, session, marker, hypervisor } = await setup();
    const pending = sessions.executeTool(session.id, push);
    const prompt = await waitForPrompt(sessions, session.id);
    await sessions.resolveApproval(session.id, prompt.id, "approved");
    expect((await pending).output).toMatch(/Harness blocked git_push: tests failed/);
    expect(existsSync(marker)).toBe(true);
    hypervisor.shutdown();
  }, 30_000);

  it("deny on the prompt declines the publish without running tests", async () => {
    const { sessions, session, marker, hypervisor } = await setup();
    const pending = sessions.executeTool(session.id, push);
    const prompt = await waitForPrompt(sessions, session.id);
    await sessions.resolveApproval(session.id, prompt.id, "denied");
    expect((await pending).output).toMatch(/Operator declined git_push/);
    expect(existsSync(marker)).toBe(false);
    hypervisor.shutdown();
  }, 30_000);

  it("defer publishes first, then runs the tests and posts the verdict", async () => {
    const { dir, sessions, session, marker, hypervisor } = await setup();
    const root = sessionHostWorkspace(dir, session);
    const remote = join(dir, "remote.git");
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, stdio: "ignore" });
    git(dir, "init", "--bare", "-q", remote);
    git(root, "init", "-q", "-b", "feature/x");
    git(root, "-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A");
    git(root, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init");
    git(root, "remote", "add", "origin", remote);
    // Host-inherited GIT_CONFIG_* (some CI sandboxes set them) confuse the push path.
    const saved = Object.entries(process.env).filter(([key]) => key.startsWith("GIT_CONFIG_"));
    for (const [key] of saved) delete process.env[key];
    let result;
    try {
      result = await sessions.executeTool(session.id, push, { testGate: "defer" });
    } finally {
      for (const [key, value] of saved) process.env[key] = value;
    }
    expect(result.output).not.toMatch(/Harness blocked/);
    expect(result.ok).toBe(true);
    expect(existsSync(join(remote, "refs", "heads", "feature", "x"))).toBe(true);
    expect(result.output).toMatch(/Tests deferred/);
    const deadline = Date.now() + 15_000;
    let note: string | undefined;
    while (Date.now() < deadline && !note) {
      note = (await sessions.get(session.id))?.messages.find((m) =>
        m.content.startsWith("Deferred tests after git_push"),
      )?.content;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(note).toMatch(/failed/);
    expect(existsSync(marker)).toBe(true);
    hypervisor.shutdown();
  }, 30_000);

  it("runs the tests when nobody answers the prompt in time", async () => {
    const { store, sessions, session, marker, hypervisor } = await setup();
    const config = await store.loadConfig();
    config.advanced.testGatePromptMs = 15_000;
    await store.saveConfig(config);
    const started = Date.now();
    const result = await sessions.executeTool(session.id, {
      name: "git_push",
      args: { branch: "feature/x", skipTests: true },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(14_000);
    expect(result.output).toMatch(/Harness blocked git_push: tests failed/);
    expect(existsSync(marker)).toBe(true);
    const row = (await sessions.get(session.id))?.messages
      .flatMap((m) => m.toolCalls ?? [])
      .find((c) => c.name === TEST_GATE_PROMPT_TOOL);
    expect(row?.result).toMatch(/No answer .*running the tests/);
    hypervisor.shutdown();
  }, 45_000);

  it("does not prompt for a fast suite with no skip request", async () => {
    const { sessions, session, marker, hypervisor } = await setup({ slowHistory: false });
    const result = await sessions.executeTool(session.id, push);
    expect(result.output).toMatch(/Harness blocked git_push: tests failed/);
    expect(existsSync(marker)).toBe(true);
    const prompts = (await sessions.get(session.id))?.messages
      .flatMap((m) => m.toolCalls ?? [])
      .filter((c) => c.name === TEST_GATE_PROMPT_TOOL);
    expect(prompts).toEqual([]);
    hypervisor.shutdown();
  }, 30_000);
});
