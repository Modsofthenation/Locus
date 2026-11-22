/**
 * Headless benchmark run for CI (`.github/workflows/benchmark.yml`).
 *
 *   LOCUS_BENCH_API_KEY=… npx tsx apps/server/bench/benchmarkCi.ts \
 *     --provider anthropic --model claude-sonnet-4-5 [--case fix-add,go-wordwrap] \
 *     [--out benchmark-run.json] [--baseline apps/server/bench/benchmark-baseline.json] \
 *     [--max-drop 0.1] [--timeout-min 10] [--repeat 1]
 *
 * Boots a throwaway Locus data dir, enables one built-in provider (matched by kind or name;
 * `LOCUS_BENCH_BASE_URL` overrides its base URL), runs the built-in suite (toy cases plus the
 * TS / Python / Go fixtures) as real Host agent turns, writes the run JSON, and exits 1 when
 * the pass rate falls below `baseline.passRate - maxDrop`. Without an API key it prints a
 * notice and exits 0. Exit 2: setup problem.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MockHypervisor } from "@locus/hypervisor";
import {
  benchmarkGate,
  summarizeBenchmark,
  type BenchmarkBaseline,
  type BenchmarkRun,
} from "@locus/shared";
import { Hub } from "../src/core/hub.js";
import { JsonStore } from "../src/core/store.js";
import { BenchmarkService } from "../src/evals/benchmark.js";
import { SessionService } from "../src/session/sessions.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function notice(text: string) {
  console.log(process.env.GITHUB_ACTIONS ? `::notice title=Benchmark::${text}` : text);
}

function summaryMarkdown(run: BenchmarkRun, gate: string): string {
  const rows = run.results.map(
    (r) =>
      `| ${r.caseId} | ${r.status} | ${(r.reason ?? "").replace(/\|/g, "\\|").slice(0, 120)} | ${r.durationMs ? Math.round(r.durationMs / 1000) : "-"}s | ${r.usd != null ? `$${r.usd.toFixed(4)}` : "-"} |`,
  );
  return [
    `### Benchmark ${run.id}`,
    "",
    `Harness \`${run.harness?.key ?? "unknown"}\` · ${gate}`,
    "",
    "| Case | Result | Why | Time | Cost |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

// Same policy as the control plane: a stray rejection in a turn is logged, not fatal.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err instanceof Error ? err.message : err);
});

async function main(): Promise<number> {
  const apiKey = process.env.LOCUS_BENCH_API_KEY?.trim();
  if (!apiKey) {
    notice("LOCUS_BENCH_API_KEY is not set; skipping the model benchmark.");
    return 0;
  }
  const providerName = arg("provider") ?? process.env.LOCUS_BENCH_PROVIDER;
  const model = arg("model") ?? process.env.LOCUS_BENCH_MODEL;
  if (!providerName || !model) {
    console.error(
      "Pass --provider <kind|name> and --model <id> (or LOCUS_BENCH_PROVIDER / _MODEL).",
    );
    return 2;
  }
  const out = resolve(arg("out") ?? "benchmark-run.json");
  const baselinePath = arg("baseline") ?? process.env.LOCUS_BENCH_BASELINE;
  const maxDropRaw = arg("max-drop") ?? process.env.LOCUS_BENCH_MAX_DROP;
  const timeoutMin = Number(arg("timeout-min") ?? 10);
  const repeat = Number(arg("repeat") ?? 1);
  const caseIds = (arg("case") ?? process.env.LOCUS_BENCH_CASES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const dataDir = await mkdtemp(join(tmpdir(), "locus-bench-ci-"));
  const hypervisor = new MockHypervisor(dataDir);
  try {
    const store = new JsonStore(dataDir);
    await store.init();
    const config = await store.loadConfig();
    const wanted = providerName.toLowerCase();
    const matches = config.providers.filter(
      (p) => p.kind.toLowerCase() === wanted || p.name.toLowerCase() === wanted,
    );
    const provider =
      matches.length === 1 ? matches[0] : matches.find((p) => p.name.toLowerCase() === wanted);
    if (!provider) {
      console.error(
        `No single built-in provider matches "${providerName}". Use one of: ${config.providers.map((p) => p.name).join(", ")}`,
      );
      return 2;
    }
    // A stable id, so history groups CI runs together.
    provider.id = wanted.replace(/[^a-z0-9-]+/g, "-");
    provider.apiKey = apiKey;
    provider.enabled = true;
    if (process.env.LOCUS_BENCH_BASE_URL?.trim())
      provider.baseUrl = process.env.LOCUS_BENCH_BASE_URL.trim();
    if (!provider.models.includes(model)) provider.models = [...provider.models, model];
    await store.saveConfig(config);

    const sessions = new SessionService(store, hypervisor, new Hub());
    const bench = new BenchmarkService(store, sessions, { pollMs: 1000 });
    const started = await bench.start({
      targets: [{ providerId: provider.id, model }],
      caseIds: caseIds.length ? caseIds : undefined,
      repeat,
      timeoutMs: timeoutMin * 60_000,
    });
    console.log(
      `Running ${started.id}: ${started.results.length} cases on ${provider.name} ${model}`,
    );
    let reported = 0;
    while ((await bench.get(started.id))?.status === "running") {
      const now = (await bench.get(started.id))!;
      const finished = now.results.filter((r) => r.status !== "pending" && r.status !== "running");
      for (const row of finished.slice(reported)) {
        console.log(`${row.status.padEnd(7)} ${row.caseId} · ${row.reason ?? ""}`);
      }
      reported = finished.length;
      await new Promise((r) => setTimeout(r, 2000));
    }
    await bench.idle();
    const run = (await bench.get(started.id))!;
    for (const row of run.results.slice(reported)) {
      console.log(`${row.status.padEnd(7)} ${row.caseId} · ${row.reason ?? ""}`);
    }
    writeFileSync(
      out,
      `${JSON.stringify({ ...run, summary: summarizeBenchmark(run) }, null, 2)}\n`,
    );
    console.log(`Wrote ${out}`);

    let exit = 0;
    let gateText = "no baseline";
    if (baselinePath) {
      const baseline = JSON.parse(readFileSync(resolve(baselinePath), "utf8")) as BenchmarkBaseline;
      const maxDrop =
        maxDropRaw !== undefined && maxDropRaw !== "" ? Number(maxDropRaw) : undefined;
      const gate = benchmarkGate(run, baseline, Number.isFinite(maxDrop) ? maxDrop : undefined);
      gateText = gate.message;
      console.log(`Gate: ${gate.message}`);
      if (!gate.ok) {
        if (process.env.GITHUB_ACTIONS)
          console.log(`::error title=Benchmark regression::${gate.message}`);
        exit = 1;
      }
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(run, gateText));
    }
    return exit;
  } finally {
    hypervisor.shutdown();
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(2);
  },
);
