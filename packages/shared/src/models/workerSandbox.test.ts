import { describe, expect, it } from "vitest";
import { e2bTemplateSize, parseWorkerBackend, sandboxTemplateStale } from "./worker.js";

describe("Settings-built sandbox templates", () => {
  it("keeps the Locus version that built an E2B template", () => {
    const parsed = parseWorkerBackend({
      id: "e1",
      name: "E2B",
      kind: "e2b",
      token: "key",
      sandbox: {
        template: "tpl",
        maxMinutes: 15,
        maxUsd: 1,
        rateDate: "2026-11-22",
        builtFor: " 0.30.0 ",
      },
    });
    expect(parsed?.sandbox?.builtFor).toBe("0.30.0");
    const pasted = parseWorkerBackend({
      id: "e2",
      name: "E2B",
      kind: "e2b",
      sandbox: { template: "tpl", maxMinutes: 15, maxUsd: 1, rateDate: "2026-11-22" },
    });
    expect(pasted?.sandbox).not.toHaveProperty("builtFor");
  });

  it("flags a template built for another version only when Settings built it", () => {
    const base = { template: "tpl", maxMinutes: 15, maxUsd: 1, rateDate: "2026-11-22" };
    expect(sandboxTemplateStale({ ...base, builtFor: "0.23.0" }, "0.30.0")).toBe(true);
    expect(sandboxTemplateStale({ ...base, builtFor: "0.30.0" }, "0.30.0")).toBe(false);
    expect(sandboxTemplateStale(base, "0.30.0")).toBe(false);
    expect(sandboxTemplateStale(undefined, "0.30.0")).toBe(false);
  });

  it("falls back to the smallest template size", () => {
    expect(e2bTemplateSize("4-4")).toMatchObject({ cpuCount: 4, memoryMB: 4096 });
    expect(e2bTemplateSize("16-64")).toMatchObject({ id: "2-2", cpuCount: 2, memoryMB: 2048 });
  });
});
