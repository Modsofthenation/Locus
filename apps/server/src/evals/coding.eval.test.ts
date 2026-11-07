import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { scoreCodingEval } from "@locus/shared";
import type { CompleteRequest } from "@locus/providers";
import { Hub } from "../core/hub.js";
import { runWorkspaceNpmScript } from "../core/hooks.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";

const FIX_ADD = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/coding-eval/fix-add");

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
  const deadline = Date.now() + 15_000;
  let fresh = await sessions.get(id);
  while (Date.now() < deadline) {
    fresh = await sessions.get(id);
    if (fresh && pred(fresh)) return fresh;
    await new Promise((r) => setTimeout(r, 20));
  }
  return fresh;
}

describe("coding harness smoke", () => {
  it("fix-add: a failing test in, a patched function out, tests pass", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-coding-eval-"));
    const hostRoot = await mkdtemp(join(tmpdir(), "locus-coding-eval-ws-"));
    const workspace = join(hostRoot, "fix-add");
    cleanup.push(dir, hostRoot);
    await cp(FIX_ADD, workspace, { recursive: true });
    const before = await runWorkspaceNpmScript(workspace, "test", 15_000);
    expect(before.ran).toBe(true);
    expect(before.ok).toBe(false);

    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let round = 0;
    async function* engine(_req: CompleteRequest) {
      round += 1;
      if (round === 1) {
        yield {
          type: "tool_call" as const,
          id: "r1",
          name: "file_read",
          arguments: { path: "/workspace/src/add.js" },
        };
        yield {
          type: "tool_call" as const,
          id: "r2",
          name: "file_read",
          arguments: { path: "/workspace/src/add.test.js" },
        };
        return;
      }
      if (round === 2) {
        yield {
          type: "tool_call" as const,
          id: "p1",
          name: "apply_patch",
          arguments: {
            patch: [
              "--- a/src/add.js",
              "+++ b/src/add.js",
              "@@ -1,3 +1,3 @@",
              " export function add(a, b) {",
              "-  return a;",
              "+  return a + b;",
              " }",
              "",
            ].join("\n"),
          },
        };
        return;
      }
      if (round === 3) {
        yield {
          type: "tool_call" as const,
          id: "t1",
          name: "exec",
          arguments: { command: "npm test" },
        };
        return;
      }
      yield { type: "text" as const, text: "add(2, 3) now returns 5." };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      hostDir: workspace,
      providerId: provider.id,
      model: provider.defaultModel,
      autonomy: "autonomous",
      startVm: false,
    });
    const caseJson = JSON.parse(await readFile(join(FIX_ADD, "case.json"), "utf8")) as {
      id: string;
      prompt: string;
      expectSource: string;
    };
    await sessions.sendChat(created.id, caseJson.prompt);
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((m) => m.content.includes("now returns 5")),
    );
    expect(fresh?.needsHuman).toBeUndefined();
    hypervisor.shutdown();

    const after = await runWorkspaceNpmScript(workspace, "test", 15_000);
    const source = await readFile(join(workspace, "src/add.js"), "utf8");
    const score = scoreCodingEval({
      id: caseJson.id,
      testsRan: after.ran,
      testsOk: after.ok,
      source,
      expectSource: caseJson.expectSource,
    });
    expect(score, score.reason).toEqual({
      id: "fix-add",
      passed: true,
      testsRan: true,
      testsOk: true,
      reason: "tests passed",
    });
    expect(source).toContain("a + b");
  }, 30_000);

  it("fix-add-stuck: a failing test in, a no-op patch, tests still fail, needs a human", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-coding-eval-stuck-"));
    const hostRoot = await mkdtemp(join(tmpdir(), "locus-coding-eval-stuck-ws-"));
    const workspace = join(hostRoot, "fix-add");
    cleanup.push(dir, hostRoot);
    await cp(FIX_ADD, workspace, { recursive: true });

    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    let round = 0;
    async function* engine(_req: CompleteRequest) {
      round += 1;
      if (round === 1) {
        yield {
          type: "tool_call" as const,
          id: "p1",
          name: "apply_patch",
          arguments: {
            patch: [
              "--- a/src/add.js",
              "+++ b/src/add.js",
              "@@ -1,3 +1,3 @@",
              " export function add(a, b) {",
              "-  return a;",
              "+  return a + 0;",
              " }",
              "",
            ].join("\n"),
          },
        };
        return;
      }
      if (round === 2) {
        yield {
          type: "tool_call" as const,
          id: "t1",
          name: "exec",
          arguments: { command: "npm test" },
        };
        return;
      }
      yield { type: "text" as const, text: "patched add; tests still fail but I am done." };
    }
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      hostDir: workspace,
      providerId: provider.id,
      model: provider.defaultModel,
      autonomy: "autonomous",
      startVm: false,
    });
    const caseJson = JSON.parse(await readFile(join(FIX_ADD, "case.json"), "utf8")) as {
      prompt: string;
    };
    await sessions.sendChat(created.id, caseJson.prompt);
    const fresh = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((m) => m.content.includes("I am done")),
    );
    expect(fresh?.needsHuman).toMatch(/never passed|tests failed/);
    hypervisor.shutdown();

    const after = await runWorkspaceNpmScript(workspace, "test", 15_000);
    expect(after.ok).toBe(false);
  }, 30_000);
});
