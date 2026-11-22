import type { Hono } from "hono";
import { summarizeBenchmark, type BenchmarkRun } from "@locus/shared";
import type { BenchmarkService, StartBenchmarkInput, StartMineInput } from "../evals/benchmark.js";

function withSummary(run: BenchmarkRun) {
  return { ...run, summary: summarizeBenchmark(run) };
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function registerBenchmarkRoutes(app: Hono, benchmarks: BenchmarkService): void {
  app.get("/api/benchmarks/cases", async (c) => {
    try {
      return c.json(await benchmarks.cases(c.req.query("suite") || undefined));
    } catch (err) {
      return c.json({ error: message(err, "Could not load the suite") }, 400);
    }
  });

  app.get("/api/benchmarks", async (c) =>
    c.json({ runs: (await benchmarks.list()).map(withSummary) }),
  );

  /** Pass rate / cost / time per (provider, model, harness version). */
  app.get("/api/benchmarks/history", async (c) => c.json({ rows: await benchmarks.history() }));

  app.get("/api/benchmarks/compare", async (c) => {
    const a = c.req.query("a");
    const b = c.req.query("b");
    if (!a || !b) return c.json({ error: "Pass ?a=<run>&b=<run>" }, 400);
    try {
      return c.json(await benchmarks.compare(a, b));
    } catch (err) {
      return c.json({ error: message(err, "Could not compare") }, 404);
    }
  });

  app.post("/api/benchmarks/mine", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as StartMineInput;
    try {
      return c.json(benchmarks.startMine(body));
    } catch (err) {
      return c.json({ error: message(err, "Could not start mining") }, 400);
    }
  });

  app.get("/api/benchmarks/mine/:id", (c) => {
    const job = benchmarks.getMine(c.req.param("id"));
    return job ? c.json(job) : c.json({ error: "Not found" }, 404);
  });

  app.post("/api/benchmarks/mine/:id/cancel", (c) => {
    const job = benchmarks.cancelMine(c.req.param("id"));
    return job ? c.json(job) : c.json({ error: "Not found" }, 404);
  });

  app.post("/api/benchmarks", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as StartBenchmarkInput;
    try {
      return c.json(withSummary(await benchmarks.start(body)));
    } catch (err) {
      const text = message(err, "Could not start the benchmark");
      return c.json({ error: text }, text.includes("already running") ? 409 : 400);
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
