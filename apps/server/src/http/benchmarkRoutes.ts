import type { Hono } from "hono";
import { summarizeBenchmark, type BenchmarkRun } from "@locus/shared";
import type { BenchmarkService, StartBenchmarkInput } from "../evals/benchmark.js";

function withSummary(run: BenchmarkRun) {
  return { ...run, summary: summarizeBenchmark(run) };
}

export function registerBenchmarkRoutes(app: Hono, benchmarks: BenchmarkService): void {
  app.get("/api/benchmarks/cases", (c) => c.json({ cases: benchmarks.cases() }));

  app.get("/api/benchmarks", async (c) =>
    c.json({ runs: (await benchmarks.list()).map(withSummary) }),
  );

  app.post("/api/benchmarks", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as StartBenchmarkInput;
    try {
      return c.json(withSummary(await benchmarks.start(body)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start the benchmark";
      return c.json({ error: message }, message.includes("already running") ? 409 : 400);
    }
  });

  app.get("/api/benchmarks/:id", async (c) => {
    const run = await benchmarks.get(c.req.param("id"));
    return run ? c.json(withSummary(run)) : c.json({ error: "Not found" }, 404);
  });

  app.post("/api/benchmarks/:id/cancel", async (c) => {
    const run = await benchmarks.cancel(c.req.param("id"));
    return run ? c.json(withSummary(run)) : c.json({ error: "Not found" }, 404);
  });
}
