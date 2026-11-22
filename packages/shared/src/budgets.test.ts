import { describe, expect, it } from "vitest";
import {
  SpendBook,
  checkDailyBudgets,
  dailyBudgetStatus,
  formatDailySpendHint,
  localDayKey,
} from "./budgets.js";
import { parseBudgetSettings } from "./models/controls.js";

describe("daily spend accounting", () => {
  it("rolls over at local midnight", () => {
    const late = new Date(2026, 10, 14, 23, 59, 30).getTime();
    const early = new Date(2026, 10, 15, 0, 0, 30).getTime();
    expect(localDayKey(late)).toBe("2026-11-14");
    expect(localDayKey(early)).toBe("2026-11-15");
    const book = new SpendBook();
    book.add({ atMs: late, sessionId: "a", usd: 2, tokens: 100 });
    book.add({ atMs: early, sessionId: "a", usd: 1, tokens: 50 });
    expect(book.day(late).global).toEqual({ usd: 2, tokens: 100 });
    expect(book.day(early).global).toEqual({ usd: 1, tokens: 50 });
  });

  it("sums multiple sessions, automations, and projects", () => {
    const at = new Date(2026, 10, 14, 12).getTime();
    const book = new SpendBook();
    book.add({ atMs: at, sessionId: "s1", automationId: "nightly", usd: 1.5, tokens: 1000 });
    book.add({ atMs: at + 1, sessionId: "s2", automationId: "nightly", usd: 0.5, tokens: 500 });
    book.add({ atMs: at + 2, sessionId: "s3", projectId: "p1", usd: 2, tokens: 10 });
    book.add({ atMs: at + 3, sessionId: "s4", usd: undefined, tokens: 7 });
    const day = book.day(at);
    expect(day.global.usd).toBeCloseTo(4);
    expect(day.global.tokens).toBe(1517);
    expect(day.automations.nightly).toEqual({ usd: 2, tokens: 1500 });
    expect(day.projects.p1).toEqual({ usd: 2, tokens: 10 });
    expect(Object.keys(day.sessions)).toHaveLength(4);
  });

  it("prunes old days", () => {
    const book = new SpendBook();
    for (let d = 1; d <= 5; d++) {
      book.add({ atMs: new Date(2026, 0, d, 12).getTime(), sessionId: "s", usd: 1, tokens: 1 });
    }
    book.prune(2);
    expect(book.all().map((row) => row.day)).toEqual(["2026-01-04", "2026-01-05"]);
  });
});

describe("daily budget enforcement", () => {
  const at = new Date(2026, 10, 14, 9).getTime();

  it("allows when under every cap and stops at the global USD cap", () => {
    const book = new SpendBook();
    book.add({ atMs: at, sessionId: "s1", usd: 3, tokens: 100 });
    const settings = { dailyUsd: 5 };
    expect(checkDailyBudgets({ settings, spend: book.day(at) }).ok).toBe(true);
    book.add({ atMs: at, sessionId: "s2", usd: 2.5, tokens: 100 });
    const verdict = checkDailyBudgets({ settings, spend: book.day(at) });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.scope).toBe("global");
      expect(verdict.message).toMatch(
        /^Budget reached: daily spend cap \(\$5\.50 \/ \$5\.00 today\)/,
      );
    }
  });

  it("warns near the cap", () => {
    const book = new SpendBook();
    book.add({ atMs: at, sessionId: "s1", usd: 4.2, tokens: 0 });
    const verdict = checkDailyBudgets({ settings: { dailyUsd: 5 }, spend: book.day(at) });
    expect(verdict).toMatchObject({ ok: true, warn: expect.stringContaining("daily spend cap") });
  });

  it("enforces per-automation and per-project caps independently", () => {
    const book = new SpendBook();
    book.add({ atMs: at, sessionId: "s1", automationId: "a1", usd: 1, tokens: 900 });
    book.add({ atMs: at, sessionId: "s2", projectId: "p1", usd: 0.2, tokens: 10 });
    const settings = {
      dailyUsd: 100,
      automations: { a1: { dailyTokens: 800 } },
      projects: { p1: { dailyUsd: 0.5 } },
    };
    const auto = checkDailyBudgets({ settings, spend: book.day(at), automationId: "a1" });
    expect(auto).toMatchObject({ ok: false, scope: "automation", id: "a1", reason: "tokens" });
    expect(checkDailyBudgets({ settings, spend: book.day(at), automationId: "a2" }).ok).toBe(true);
    expect(checkDailyBudgets({ settings, spend: book.day(at), projectId: "p1" }).ok).toBe(true);
  });

  it("honours a same-day override and not a stale one", () => {
    const book = new SpendBook();
    book.add({ atMs: at, sessionId: "s1", usd: 10, tokens: 0 });
    const spend = book.day(at);
    const today = {
      day: spend.day,
      scope: "global" as const,
      by: "operator",
      t: new Date(at).toISOString(),
    };
    expect(checkDailyBudgets({ settings: { dailyUsd: 5 }, spend, overrides: [today] }).ok).toBe(
      true,
    );
    const stale = { ...today, day: "2026-11-13" };
    expect(checkDailyBudgets({ settings: { dailyUsd: 5 }, spend, overrides: [stale] }).ok).toBe(
      false,
    );
  });

  it("does nothing without caps", () => {
    expect(parseBudgetSettings({ dailyUsd: 0, automations: {} })).toBeUndefined();
    const book = new SpendBook();
    book.add({ atMs: at, sessionId: "s", usd: 1e6, tokens: 1e9 });
    expect(checkDailyBudgets({ settings: undefined, spend: book.day(at) }).ok).toBe(true);
  });

  it("formats today's spend vs cap", () => {
    const book = new SpendBook();
    book.add({ atMs: at, sessionId: "s", usd: 1.2, tokens: 0 });
    const status = dailyBudgetStatus({ settings: { dailyUsd: 5 }, spend: book.day(at) });
    expect(formatDailySpendHint(status)).toBe("Today $1.20 / $5.00");
    expect(
      formatDailySpendHint(dailyBudgetStatus({ settings: undefined, spend: book.day(at) })),
    ).toBeUndefined();
  });
});
