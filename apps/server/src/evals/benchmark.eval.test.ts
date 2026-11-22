import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import type { CompleteRequest } from "@locus/providers";
import { summarizeBenchmark } from "@locus/shared";
import { builtinSuiteDir } from "./benchmarkSuite.js";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "../session/sessions.js";
import { BenchmarkService } from "./benchmark.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function setup(
  engine: (req: CompleteRequest) => AsyncGenerator<unknown>,
  extra: Partial<ConstructorParameters<typeof BenchmarkService>[2]> = {},
) {
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
  const repoRoot = await mkdtemp(join(tmpdir(), "locus-bench-repos-"));
  cleanup.push(repoRoot);
  const bench = new BenchmarkService(store, sessions, { pollMs: 20, workRoot, repoRoot, ...extra });
  return { bench, provider, hypervisor, sessions, workRoot };
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

const FIXTURES = builtinSuiteDir()!;
const FIXED_RETRY = readFileSync(
  join(FIXTURES, "ts-retry-backoff", "fix", "src", "retry.ts"),
  "utf8",
);

/** The case folder the runner made for `caseId` (`<workRoot>/<run>/<n>-<caseId>`). */
function caseDir(workRoot: string, runId: string, caseId: string): string {
  const name = readdirSync(join(workRoot, runId)).find((n) => n.endsWith(`-${caseId}`))!;
  return join(workRoot, runId, name);
}

describe("spec benchmark cases", () => {
  it("hides the fix's tests from the agent, then scores with them; history and compare track it", async () => {
    let mode: "fix" | "edit-tests" = "fix";
    let round = 0;
    const seen: string[] = [];
    let workRoot = "";
    async function* engine() {
      round += 1;
      if (round % 2 === 1) {
        // What the agent can see: the base test file only, and a single-commit history.
        for (const run of readdirSync(workRoot)) {
          for (const dir of readdirSync(join(workRoot, run))) {
            const test = join(workRoot, run, dir, "test", "retry.test.ts");
            try {
              seen.push(readFileSync(test, "utf8"));
              seen.push(
                execFileSync("git", ["log", "--oneline"], {
                  cwd: join(workRoot, run, dir),
                }).toString(),
              );
            } catch {
              /* not this one */
            }
          }
        }
        yield mode === "fix"
          ? {
              type: "tool_call" as const,
              id: `w${round}`,
              name: "file_write",
              arguments: { path: "/workspace/src/retry.ts", content: FIXED_RETRY },
            }
          : {
              type: "tool_call" as const,
              id: `w${round}`,
              name: "file_write",
              arguments: {
                path: "/workspace/test/retry.test.ts",
                content: 'import { test } from "node:test";\ntest("ok", () => {});\n',
              },
            };
        return;
      }
      yield { type: "text" as const, text: "Done." };
    }
    const env = await setup(engine);
    workRoot = env.workRoot;
    const { bench, provider, hypervisor } = env;
    const target = { providerId: provider.id, model: provider.defaultModel };

    const first = await bench.start({ targets: [target], caseIds: ["ts-retry-backoff"] });
    await bench.idle();
    const passed = (await bench.get(first.id))!;
    const row = passed.results[0]!;
    expect(row.status, `${row.reason}\n${row.testOutput}`).toBe("passed");
    expect(row.reason).toMatch(/all required tests pass/);
    expect(row.language).toBe("typescript");
    expect(row.harnessVersion).toBe(passed.harness!.key);
    expect(passed.harness!.configHash).toMatch(/^[0-9a-f]{12}$/);
    expect(seen.some((text) => text.includes("delays never exceed maxMs"))).toBe(false);
    expect(
      seen
        .find((text) => /Base \(ts-retry-backoff\)/.test(text))
        ?.trim()
        .split("\n"),
    ).toHaveLength(1);
    // Scoring copied the hidden tests in.
    expect(
      readFileSync(
        join(caseDir(workRoot, first.id, "ts-retry-backoff"), "test", "retry.test.ts"),
        "utf8",
      ),
    ).toMatch(/delays never exceed maxMs/);

    mode = "edit-tests";
    const second = await bench.start({ targets: [target], caseIds: ["ts-retry-backoff"] });
    await bench.idle();
    hypervisor.shutdown();
    const failed = (await bench.get(second.id))!.results[0]!;
    expect(failed.status).toBe("failed");
    expect(failed.reason).toMatch(/protected paths edited: test\/retry\.test\.ts/);

    const history = await bench.history();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ runs: 2, cases: 2, passed: 1, passRate: 0.5 });
    const cmp = await bench.compare(first.id, second.id);
    expect(cmp).toMatchObject({ broke: 1, fixed: 0 });
    expect(cmp.rows[0]).toMatchObject({ caseId: "ts-retry-backoff", change: "broke" });
    await expect(bench.compare(first.id, "nope")).rejects.toThrow(/not found/);
  }, 120_000);

  it("skips a case whose toolchain is missing and leaves it out of the score", async () => {
    async function* engine() {
      yield { type: "text" as const, text: "never asked" };
    }
    const { bench, provider, hypervisor } = await setup(engine, {
      missingToolchain: (language) => (language === "go" ? "go" : undefined),
    });
    const cases = await bench.cases();
    expect(cases.cases.map((c) => c.id)).toEqual(
      expect.arrayContaining(["fix-add", "ts-retry-backoff", "py-semver-compare", "go-wordwrap"]),
    );
    const run = await bench.start({
      targets: [{ providerId: provider.id, model: provider.defaultModel }],
      caseIds: ["go-wordwrap"],
    });
    await bench.idle();
    hypervisor.shutdown();
    const done = (await bench.get(run.id))!;
    expect(done.results[0]).toMatchObject({ status: "skipped", reason: "toolchain missing: go" });
    expect(summarizeBenchmark(done)[0]).toMatchObject({ total: 0 });
  }, 60_000);

  it("runs a user suite folder and rejects one with no valid cases", async () => {
    async function* engine() {
      yield { type: "text" as const, text: "idle" };
    }
    const { bench, provider, hypervisor } = await setup(engine);
    const target = { providerId: provider.id, model: provider.defaultModel };
    const empty = await mkdtemp(join(tmpdir(), "locus-bench-suite-"));
    cleanup.push(empty);
    await expect(bench.start({ targets: [target], suite: empty })).rejects.toThrow(
      /No valid cases/,
    );
    const listed = await bench.cases(join(FIXTURES, "py-semver-compare"));
    expect(listed.cases.map((c) => c.id)).toEqual(["py-semver-compare"]);
    hypervisor.shutdown();
  });
});
