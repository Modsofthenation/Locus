import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import type { CompleteRequest } from "@locus/providers";
import { summarizeBenchmark } from "@locus/shared";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "../session/sessions.js";
import { BenchmarkService } from "./benchmark.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function setup(engine: (req: CompleteRequest) => AsyncGenerator<unknown>) {
  const dir = await mkdtemp(join(tmpdir(), "locus-bench-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const config = await store.loadConfig();
  const provider = config.providers[0]!;
  provider.apiKey = "sk-test";
  provider.enabled = true;
  await store.saveConfig(config);
  const hypervisor = new MockHypervisor(dir);
  const sessions = new SessionService(
    store,
    hypervisor,
    new Hub(),
    engine as ConstructorParameters<typeof SessionService>[3],
  );
  const workRoot = await mkdtemp(join(tmpdir(), "locus-bench-work-"));
  cleanup.push(workRoot);
  const bench = new BenchmarkService(store, sessions, { pollMs: 20, workRoot });
  return { bench, provider, hypervisor, sessions };
}

describe("model benchmark", () => {
  it("scores a real Host turn: a fixing model passes, cost and tools recorded", async () => {
    let round = 0;
    async function* engine() {
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
              "+  return a + b;",
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
      yield { type: "text" as const, text: "Fixed add." };
    }
    const { bench, provider, hypervisor, sessions } = await setup(engine);
    const run = await bench.start({
      targets: [{ providerId: provider.id, model: provider.defaultModel }],
      caseIds: ["fix-add"],
    });
    await bench.idle();
    hypervisor.shutdown();
    const done = (await bench.get(run.id))!;
    expect(done.status).toBe("done");
    const row = done.results[0]!;
    expect(row.status, `${row.reason}\n${row.testOutput}`).toBe("passed");
    expect(row.toolCalls).toBeGreaterThanOrEqual(2);
    expect(row.durationMs).toBeGreaterThan(0);
    expect(summarizeBenchmark(done)[0]).toMatchObject({ passed: 1, total: 1, passRate: 1 });
    // The session is kept for reading, but archived out of the sidebar.
    expect((await sessions.get(row.sessionId!))?.archived).toBe(true);
    expect((await bench.list()).map((r) => r.id)).toContain(run.id);
  }, 60_000);

  it("fails a model that edits the tests to make them pass", async () => {
    let round = 0;
    async function* engine() {
      round += 1;
      if (round === 1) {
        yield {
          type: "tool_call" as const,
          id: "w1",
          name: "file_write",
          arguments: {
            path: "/workspace/src/add.test.js",
            content: 'import { test } from "node:test";\ntest("ok", () => {});\n',
          },
        };
        return;
      }
      yield { type: "text" as const, text: "Tests pass now." };
    }
    const { bench, provider, hypervisor } = await setup(engine);
    const run = await bench.start({
      targets: [{ providerId: provider.id, model: provider.defaultModel }],
      caseIds: ["fix-add"],
    });
    await bench.idle();
    hypervisor.shutdown();
    const row = (await bench.get(run.id))!.results[0]!;
    expect(row.status).toBe("failed");
    expect(row.reason).toMatch(/tests edited/);
  }, 60_000);

  it("rejects unknown providers, unknown cases and a second concurrent run", async () => {
    async function* idleEngine() {
      await new Promise((r) => setTimeout(r, 200));
      yield { type: "text" as const, text: "thinking" };
    }
    const { bench, provider, hypervisor } = await setup(idleEngine);
    await expect(bench.start({ targets: [{ providerId: "nope", model: "x" }] })).rejects.toThrow(
      /Unknown provider/,
    );
    await expect(
      bench.start({ targets: [{ providerId: provider.id, model: "m" }], caseIds: ["nope"] }),
    ).rejects.toThrow(/Unknown case/);
    const run = await bench.start({
      targets: [{ providerId: provider.id, model: provider.defaultModel }],
      caseIds: ["fix-add", "off-by-one"],
    });
    await expect(
      bench.start({ targets: [{ providerId: provider.id, model: provider.defaultModel }] }),
    ).rejects.toThrow(/already running/);
    await bench.cancel(run.id);
    await bench.idle();
    hypervisor.shutdown();
    const done = (await bench.get(run.id))!;
    expect(done.status).toBe("cancelled");
    expect(done.results.some((r) => r.reason === "cancelled")).toBe(true);
  }, 60_000);
});
