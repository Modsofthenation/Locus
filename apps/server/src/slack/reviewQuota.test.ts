import { describe, expect, it } from "vitest";
import type { AiProvider, DailyBudgetStatus, LocusConfig, ProviderUsage } from "@locus/shared";
import { ReviewQuotaReader, formatLocusSpendToday } from "./reviewQuota.js";

const config = {} as LocusConfig;
const cli = { id: "kiro", name: "Kiro", kind: "kiro-cli" } as AiProvider;
const api = { id: "anthropic", name: "Anthropic", kind: "anthropic" } as AiProvider;
const status = (extra: Partial<DailyBudgetStatus> = {}): DailyBudgetStatus => ({
  day: "2026-11-22",
  spentUsd: 1.2,
  spentTokens: 100,
  overridden: false,
  automations: [],
  projects: [],
  ...extra,
});
const usage: ProviderUsage = {
  providerId: "kiro",
  providerName: "Kiro",
  kind: "kiro-cli",
  ok: true,
  source: "cli",
  windows: [{ id: "monthly", label: "Monthly credits", usedPercent: 40 }],
  fetchedAt: "2026-11-22T00:00:00Z",
};

describe("ReviewQuotaReader", () => {
  it("reads plan usage for agent CLIs and caches it for a minute", async () => {
    let t = 0;
    let reads = 0;
    const reader = new ReviewQuotaReader({
      readUsage: async () => {
        reads += 1;
        return usage;
      },
      now: () => t,
    });
    expect(await reader.line(cli, config)).toBe("Kiro: Monthly credits 40%");
    t = 30_000;
    await reader.line(cli, config);
    expect(reads).toBe(1);
    t = 61_000;
    await reader.line(cli, config);
    expect(reads).toBe(2);
  });

  it("uses today's Locus spend for API providers", async () => {
    const reader = new ReviewQuotaReader({
      readUsage: async () => usage,
      budgetStatus: async () => status({ capUsd: 5 }),
    });
    expect(await reader.line(api, config)).toBe("Locus today: $1.20 / $5.00");
  });

  it("gives up quietly on errors and slow reads", async () => {
    const failing = new ReviewQuotaReader({
      readUsage: async () => {
        throw new Error("offline");
      },
    });
    expect(await failing.line(cli, config)).toBeUndefined();
    const slow = new ReviewQuotaReader({
      readUsage: () => new Promise(() => undefined),
      timeoutMs: 10,
    });
    expect(await slow.line(cli, config)).toBeUndefined();
    expect(await new ReviewQuotaReader({}).line(api, config)).toBeUndefined();
  });
});

describe("formatLocusSpendToday", () => {
  it("shows spend with and without a cap", () => {
    expect(formatLocusSpendToday(status())).toBe("Locus today: $1.20");
    expect(formatLocusSpendToday(status({ spentUsd: 0 }))).toBeUndefined();
    expect(formatLocusSpendToday(status({ capUsd: 5, overridden: true }))).toBe(
      "Locus today: $1.20 / $5.00 (override)",
    );
  });
});
