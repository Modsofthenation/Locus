import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLACK_REVIEWER_POLLING,
  formatSlackPollInterval,
  inSlackReviewerActiveHours,
  nextSlackPollCadence,
  parseSlackReviewerPolling,
  slackPollCeilingMs,
  slackPollDue,
  slackPollWaitMs,
  type SlackReviewerPolling,
} from "./slackReviewerPolling.js";

const policy = (patch: Partial<SlackReviewerPolling> = {}): SlackReviewerPolling => ({
  ...DEFAULT_SLACK_REVIEWER_POLLING,
  ...patch,
});
// Local time, so the active-hours checks don't depend on the test machine's zone.
const weekdayNoon = new Date(2026, 10, 25, 12).getTime(); // Wednesday
const weekdayNight = new Date(2026, 10, 25, 23).getTime();
const saturdayNoon = new Date(2026, 10, 28, 12).getTime();

describe("parseSlackReviewerPolling", () => {
  it("defaults to the old fixed intervals", () => {
    expect(parseSlackReviewerPolling(undefined)).toEqual(DEFAULT_SLACK_REVIEWER_POLLING);
    expect(DEFAULT_SLACK_REVIEWER_POLLING).toMatchObject({
      mode: "fixed",
      channelSec: 20,
      threadSec: 60,
      autoReviewSec: 300,
    });
  });

  it("clamps numbers and drops unknown modes", () => {
    const parsed = parseSlackReviewerPolling({
      mode: "turbo",
      channelSec: 1,
      threadSec: 99_999,
      autoReviewSec: "120",
      maxBackoff: 0,
      activeHours: { start: -3, end: 30, weekdaysOnly: false },
    });
    expect(parsed).toEqual({
      mode: "fixed",
      channelSec: 5,
      threadSec: 1_800,
      autoReviewSec: 120,
      maxBackoff: 1,
      activeHours: { start: 0, end: 24, weekdaysOnly: false },
    });
  });
});

describe("inSlackReviewerActiveHours", () => {
  const hours = { start: 8, end: 19, weekdaysOnly: true };
  it("is on during weekday working hours only", () => {
    expect(inSlackReviewerActiveHours(hours, new Date(weekdayNoon))).toBe(true);
    expect(inSlackReviewerActiveHours(hours, new Date(weekdayNight))).toBe(false);
    expect(inSlackReviewerActiveHours(hours, new Date(saturdayNoon))).toBe(false);
    expect(
      inSlackReviewerActiveHours({ ...hours, weekdaysOnly: false }, new Date(saturdayNoon)),
    ).toBe(true);
  });

  it("wraps past midnight", () => {
    const night = { start: 22, end: 6, weekdaysOnly: false };
    expect(inSlackReviewerActiveHours(night, new Date(weekdayNight))).toBe(true);
    expect(inSlackReviewerActiveHours(night, new Date(weekdayNoon))).toBe(false);
  });
});

describe("fixed", () => {
  it("always waits the base interval", () => {
    const p = policy();
    let cadence = nextSlackPollCadence(p, "channel", undefined, { now: 0, activity: false });
    cadence = nextSlackPollCadence(p, "channel", cadence, { now: 20_000, activity: false });
    expect(cadence).toEqual({ lastAt: 20_000, intervalMs: 20_000 });
    expect(slackPollDue(p, "channel", cadence, { now: 39_999 })).toBe(false);
    expect(slackPollDue(p, "channel", cadence, { now: 40_000 })).toBe(true);
    expect(slackPollDue(p, "channel", undefined, { now: 0 })).toBe(true);
  });
});

describe("adaptive", () => {
  const p = policy({ mode: "adaptive", maxBackoff: 4 });

  it("slows down ×1.5 per quiet poll up to the ceiling, and snaps back on activity", () => {
    let cadence = nextSlackPollCadence(p, "channel", undefined, { now: 0, activity: false });
    const waits = [cadence.intervalMs];
    for (let i = 0; i < 6; i++) {
      cadence = nextSlackPollCadence(p, "channel", cadence, { now: 0, activity: false });
      waits.push(cadence.intervalMs);
    }
    expect(waits).toEqual([20_000, 30_000, 45_000, 67_500, 80_000, 80_000, 80_000]);
    expect(slackPollCeilingMs(p, "channel")).toBe(80_000);
    cadence = nextSlackPollCadence(p, "channel", cadence, { now: 0, activity: true });
    expect(cadence.intervalMs).toBe(20_000);
  });

  it("applies a lowered setting at once", () => {
    const cadence = { lastAt: 0, intervalMs: 80_000 };
    expect(
      slackPollWaitMs(policy({ mode: "adaptive", maxBackoff: 2 }), "channel", cadence, {
        now: 0,
      }),
    ).toBe(40_000);
    expect(slackPollWaitMs(policy(), "channel", cadence, { now: 0 })).toBe(20_000);
  });

  it("uses the override as the base (tests)", () => {
    expect(
      slackPollWaitMs(
        p,
        "threads",
        { lastAt: 0, intervalMs: 90_000 },
        {
          now: 0,
          overrideMs: 0,
        },
      ),
    ).toBe(0);
  });
});

describe("smart", () => {
  const p = policy({ mode: "smart", maxBackoff: 10 });

  it("holds the base while the reviewer is busy", () => {
    const backed = { lastAt: 0, intervalMs: 150_000 };
    expect(slackPollWaitMs(p, "threads", backed, { now: weekdayNoon, busy: true })).toBe(60_000);
    expect(
      nextSlackPollCadence(p, "threads", backed, { now: weekdayNoon, busy: true, activity: false })
        .intervalMs,
    ).toBe(60_000);
  });

  it("goes straight to the slowest interval outside active hours, unless something happens", () => {
    const quiet = nextSlackPollCadence(p, "channel", undefined, {
      now: weekdayNight,
      activity: false,
    });
    expect(quiet).toEqual({ lastAt: weekdayNight, intervalMs: 200_000, offHours: true });
    expect(
      nextSlackPollCadence(p, "channel", quiet, { now: weekdayNight, activity: true }).intervalMs,
    ).toBe(20_000);
    // Morning: back to the base without waiting out the night interval.
    expect(slackPollWaitMs(p, "channel", quiet, { now: weekdayNoon })).toBe(20_000);
  });

  it("backs off like adaptive during active hours", () => {
    const first = nextSlackPollCadence(p, "channel", undefined, {
      now: weekdayNoon,
      activity: false,
    });
    const second = nextSlackPollCadence(p, "channel", first, {
      now: weekdayNoon,
      activity: false,
    });
    expect(second.intervalMs).toBe(30_000);
  });
});

it("formats intervals", () => {
  expect(formatSlackPollInterval(20_000)).toBe("20s");
  expect(formatSlackPollInterval(90_000)).toBe("1m 30s");
  expect(formatSlackPollInterval(300_000)).toBe("5m");
  expect(formatSlackPollInterval(3_600_000)).toBe("1h");
});
