import { describe, expect, it } from "vitest";
import type { SlackReviewRun } from "./slackReviewer.js";
import {
  addSlackReviewStats,
  slackReviewStatsDay,
  slackReviewStatsFromRun,
  summarizeSlackReviewStats,
} from "./slackReviewStats.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-22T12:00:00Z");

const run = (extra: Partial<SlackReviewRun>): SlackReviewRun => ({
  reviewerId: "r1",
  pr: "acme/api#7",
  url: "https://github.com/acme/api/pull/7",
  outcome: "commented",
  at: new Date(NOW).toISOString(),
  ...extra,
});

describe("addSlackReviewStats", () => {
  it("adds into today's bucket, nested counts included, without changing the input", () => {
    const first = addSlackReviewStats(undefined, { reviews: 1, posted: { major: 2 } }, NOW);
    const second = addSlackReviewStats(
      first,
      { reviews: 1, posted: { major: 1, nit: 1 }, dismissed: { "by-design": { nit: 1 } } },
      NOW,
    );
    expect(first).toEqual([{ day: "2026-11-22", reviews: 1, posted: { major: 2 } }]);
    expect(second).toEqual([
      {
        day: "2026-11-22",
        reviews: 2,
        posted: { major: 3, nit: 1 },
        dismissed: { "by-design": { nit: 1 } },
      },
    ]);
  });

  it("starts a new bucket each day and drops buckets past the window", () => {
    let rows = addSlackReviewStats(undefined, { reviews: 1 }, NOW - 95 * DAY);
    rows = addSlackReviewStats(rows, { reviews: 1 }, NOW - 10 * DAY);
    rows = addSlackReviewStats(rows, { up: 1 }, NOW);
    expect(rows.map((row) => row.day)).toEqual(["2026-11-12", "2026-11-22"]);
  });

  it("drops counts that net to zero", () => {
    const rows = addSlackReviewStats(
      addSlackReviewStats(undefined, { up: 1 }, NOW),
      { up: -1 },
      NOW,
    );
    expect(rows).toEqual([{ day: "2026-11-22" }]);
  });
});

describe("slackReviewStatsFromRun", () => {
  it("counts a finished review's findings, verification, resolutions and spend", () => {
    expect(
      slackReviewStatsFromRun(
        run({
          findings: [
            { id: 1, path: "a", line: 1, severity: "major", body: "x" },
            { id: 2, path: "a", line: 2, severity: "nit", body: "y" },
          ],
          verification: { checked: 2, rejected: { major: 1 }, downgraded: 0 },
          resolved: 1,
          usage: { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 400 },
          usd: 0.02,
        }),
      ),
    ).toEqual({
      reviews: 1,
      posted: { major: 1, nit: 1 },
      resolved: 1,
      verified: 2,
      rejected: { major: 1 },
      downgraded: 0,
      inputTokens: 1000,
      outputTokens: 50,
      cachedInputTokens: 400,
      usd: 0.02,
    });
  });

  it("counts failures and answers, and ignores dry runs and free skips", () => {
    expect(slackReviewStatsFromRun(run({ outcome: "failed" }))).toEqual({ failed: 1 });
    expect(
      slackReviewStatsFromRun(
        run({ outcome: "answered", usage: { inputTokens: 5, outputTokens: 1 } }),
      ),
    ).toEqual({ answers: 1, inputTokens: 5, outputTokens: 1 });
    expect(slackReviewStatsFromRun(run({ dryRun: true }))).toBeUndefined();
    expect(slackReviewStatsFromRun(run({ outcome: "skipped" }))).toBeUndefined();
  });
});

describe("summarizeSlackReviewStats", () => {
  const buckets = [
    { day: slackReviewStatsDay(NOW - 40 * DAY), reviews: 9, posted: { major: 9 }, usd: 9 },
    {
      day: slackReviewStatsDay(NOW - 13 * DAY),
      reviews: 3,
      posted: { blocker: 1, major: 4, minor: 5 },
      dismissed: { "false-positive": { major: 1, minor: 2 }, "wont-fix": { minor: 1 } },
      resolved: 3,
      verified: 4,
      rejected: { major: 2 },
      downgraded: 1,
      up: 2,
      inputTokens: 10_000,
      outputTokens: 500,
      usd: 1.4,
    },
    {
      day: slackReviewStatsDay(NOW),
      reviews: 1,
      posted: { major: 1 },
      dismissed: { "by-design": { major: 1 } },
      down: 1,
      usd: 0.7,
    },
  ];

  it("derives precision per severity, resolve rate and spend per week over the window", () => {
    const stats = summarizeSlackReviewStats(buckets, { days: 30, now: NOW });
    expect(stats).toMatchObject({
      days: 30,
      since: "2026-10-24",
      reviews: 4,
      posted: { blocker: 1, major: 5, minor: 5 },
      postedTotal: 11,
      dismissed: { "false-positive": 3, "by-design": 1, "wont-fix": 1 },
      falsePositives: { major: 1, minor: 2 },
      precision: { blocker: 1, major: 0.8, minor: 0.6 },
      resolved: 3,
      verified: 4,
      rejected: 2,
      downgraded: 1,
      votes: { up: 2, down: 1 },
      tokens: { input: 10_000, output: 500, cached: 0 },
      usd: 2.1,
    });
    expect(stats.precisionAll).toBeCloseTo(1 - 3 / 11);
    expect(stats.resolveRate).toBeCloseTo(3 / 11);
    // Data spans 14 days of the window: $2.10 over two weeks.
    expect(stats.usdPerWeek).toBeCloseTo(1.05);
  });

  it("doesn't stretch less than a week of data into a week", () => {
    const stats = summarizeSlackReviewStats(buckets.slice(2), { days: 30, now: NOW });
    expect(stats.usdPerWeek).toBeCloseTo(0.7);
  });

  it("is empty but well formed with no data", () => {
    const stats = summarizeSlackReviewStats(undefined, { now: NOW });
    expect(stats).toMatchObject({ days: 30, reviews: 0, postedTotal: 0, precision: {} });
    expect(stats.precisionAll).toBeUndefined();
    expect(stats.resolveRate).toBeUndefined();
    expect(stats.usd).toBeUndefined();
  });

  it("clamps the window to 1–90 days", () => {
    expect(summarizeSlackReviewStats(buckets, { days: 500, now: NOW }).reviews).toBe(13);
    expect(summarizeSlackReviewStats(buckets, { days: 0, now: NOW }).reviews).toBe(1);
  });
});
