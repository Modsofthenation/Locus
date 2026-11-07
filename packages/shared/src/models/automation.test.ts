import { describe, expect, it } from "vitest";
import {
  AUTOMATION_STARTERS,
  MAX_AUTOMATION_CHATS,
  TEST_WEBHOOK_SKIP_REASON,
  automationChatIdsToPrune,
  buildAutomationSchedule,
  automationMatchesQuery,
  automationStarterById,
  cloneAutomationInput,
  computeNextRunAt,
  formatClockTime,
  parseClockTime,
  formatLocalTimezone,
  formatRunDuration,
  formatSchedule,
  isAgentAutomationRun,
  isClockSchedule,
  isTestWebhookSkip,
  localTimezoneLabel,
  nextCloneName,
  routinesForTeammate,
  runHistoryStatusLabel,
  shouldNotifyAutomationOutcome,
  validateSchedule,
  type Automation,
  type AutomationChatRef,
  type AutomationSchedule,
} from "./automation.js";

function local(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month, day, hour, minute, 0, 0);
}

const peakHours: AutomationSchedule = {
  kind: "adaptive",
  startHour: 9,
  startMinute: 0,
  endHour: 17,
  endMinute: 0,
  everyMinutes: 60,
  otherwiseEveryMinutes: 180,
};

const overnight: AutomationSchedule = {
  kind: "adaptive",
  startHour: 22,
  startMinute: 0,
  endHour: 6,
  endMinute: 0,
  everyMinutes: 60,
  otherwiseEveryMinutes: 180,
};

function chat(
  id: string,
  createdAt: string,
  extra: Partial<AutomationChatRef> = {},
): AutomationChatRef {
  return { id, automationId: "job-1", status: "idle", createdAt, ...extra };
}

describe("automationChatIdsToPrune", () => {
  it("caps each automation at 60 chats", () => {
    expect(MAX_AUTOMATION_CHATS).toBe(60);
    const sessions = Array.from({ length: 62 }, (_, i) =>
      chat(
        `c${String(i).padStart(2, "0")}`,
        new Date(Date.parse("2026-08-17T12:00:00.000Z") + i * 1000).toISOString(),
      ),
    );
    expect(automationChatIdsToPrune(sessions, "job-1", "c61")).toEqual(["c00", "c01"]);
  });

  it("does not delete chats from other automations or manual agents", () => {
    const sessions = [
      chat("old", "2026-08-17T12:00:00.000Z"),
      chat("keep", "2026-08-17T12:01:00.000Z"),
      chat("other", "2026-08-17T11:00:00.000Z", { automationId: "job-2" }),
      { id: "manual", status: "idle", createdAt: "2026-08-17T10:00:00.000Z" },
    ];
    expect(automationChatIdsToPrune(sessions, "job-1", "keep", 2)).toEqual([]);
    expect(automationChatIdsToPrune(sessions, "job-1", "keep", 1)).toEqual(["old"]);
  });

  it("skips pinned and in-flight chats", () => {
    const sessions = [
      chat("pinned", "2026-08-17T12:00:00.000Z", { pinned: true }),
      chat("running", "2026-08-17T12:01:00.000Z", { status: "running" }),
      chat("booting", "2026-08-17T12:02:00.000Z", { status: "provisioning" }),
      chat("old", "2026-08-17T12:03:00.000Z"),
      chat("keep", "2026-08-17T12:04:00.000Z"),
    ];
    expect(automationChatIdsToPrune(sessions, "job-1", "keep", 3)).toEqual(["old"]);
  });
});

describe("clock time helpers", () => {
  it("pads and parses local clock fields", () => {
    expect(formatClockTime(9, 5)).toBe("09:05");
    expect(parseClockTime("17:30")).toEqual({ hour: 17, minute: 30 });
    expect(parseClockTime("nope")).toEqual({ hour: 9, minute: 0 });
  });

  it("builds one schedule from either editor's fields", () => {
    expect(
      buildAutomationSchedule({
        kind: "adaptive",
        everyMinutes: 60,
        otherwiseEveryMinutes: 180,
        windowStart: "09:00",
        windowEnd: "17:00",
        weekdays: [1, 1, 5],
      }),
    ).toEqual({
      kind: "adaptive",
      startHour: 9,
      startMinute: 0,
      endHour: 17,
      endMinute: 0,
      everyMinutes: 60,
      otherwiseEveryMinutes: 180,
      weekdays: [1, 5],
    });
    const everyDay = buildAutomationSchedule({
      kind: "adaptive",
      everyMinutes: 60,
      otherwiseEveryMinutes: 180,
      windowStart: "09:00",
      windowEnd: "17:00",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(everyDay.kind === "adaptive" && everyDay.weekdays).toBeUndefined();
    expect(buildAutomationSchedule({ kind: "weekly", weekday: 2, time: "08:15" })).toEqual({
      kind: "weekly",
      weekday: 2,
      hour: 8,
      minute: 15,
    });
    expect(buildAutomationSchedule({ kind: "forge" })).toEqual({ kind: "forge" });
    expect(buildAutomationSchedule({ kind: "cron", cronExpr: "0 9 * * *" })).toEqual({
      kind: "cron",
      expr: "0 9 * * *",
    });
  });
});

describe("adaptive schedule", () => {
  it("validates window and intervals", () => {
    expect(validateSchedule(peakHours)).toBeUndefined();
    expect(validateSchedule({ ...peakHours, startHour: 9, endHour: 9, endMinute: 0 })).toBe(
      "Window start and end must differ",
    );
    expect(validateSchedule({ ...peakHours, everyMinutes: 0 })).toBe(
      "Window interval must be at least 1 minute",
    );
    expect(validateSchedule({ ...peakHours, otherwiseEveryMinutes: 0 })).toBe(
      "Otherwise interval must be at least 1 minute",
    );
    expect(validateSchedule({ ...peakHours, startHour: 24 })).toBe(
      "Window start must be a valid hour and minute",
    );
  });

  it("formats the daily window and fallback cadence", () => {
    expect(formatSchedule(peakHours)).toBe("Every hour 09:00–17:00, otherwise every 3 hours");
    expect(
      formatSchedule({
        ...peakHours,
        everyMinutes: 15,
        otherwiseEveryMinutes: 90,
      }),
    ).toBe("Every 15 minutes 09:00–17:00, otherwise every 90 minutes");
  });

  it("runs hourly inside the window", () => {
    const from = local(2026, 7, 17, 10, 0);
    expect(computeNextRunAt(peakHours, from)).toEqual(local(2026, 7, 17, 11, 0));
  });

  it("snaps to the window start instead of waiting out the slow cadence", () => {
    const from = local(2026, 7, 17, 8, 0);
    expect(computeNextRunAt(peakHours, from)).toEqual(local(2026, 7, 17, 9, 0));
  });

  it("uses the otherwise interval outside the window", () => {
    const from = local(2026, 7, 17, 18, 0);
    expect(computeNextRunAt(peakHours, from)).toEqual(local(2026, 7, 17, 21, 0));
  });

  it("keeps the window interval when the next tick lands on the window end", () => {
    const from = local(2026, 7, 17, 16, 0);
    expect(computeNextRunAt(peakHours, from)).toEqual(local(2026, 7, 17, 17, 0));
  });

  it("treats the window end as exclusive", () => {
    const from = local(2026, 7, 17, 17, 0);
    expect(computeNextRunAt(peakHours, from)).toEqual(local(2026, 7, 17, 20, 0));
  });

  it("does not schedule past the exclusive window end from inside the last minute", () => {
    const from = new Date(2026, 7, 17, 16, 59, 42, 0);
    expect(computeNextRunAt(peakHours, from)).toEqual(local(2026, 7, 17, 17, 0));
    const overnightFrom = new Date(2026, 7, 18, 5, 59, 42, 0);
    expect(computeNextRunAt(overnight, overnightFrom)).toEqual(local(2026, 7, 18, 6, 0));
  });

  it("rejects fractional hours and intervals", () => {
    expect(validateSchedule({ ...peakHours, startHour: 9.5 })).toBe(
      "Window start must be a valid hour and minute",
    );
    expect(validateSchedule({ ...peakHours, everyMinutes: 60.5 })).toBe(
      "Window interval must be at least 1 minute",
    );
  });

  it("wraps midnight windows", () => {
    expect(computeNextRunAt(overnight, local(2026, 7, 17, 21, 0))).toEqual(
      local(2026, 7, 17, 22, 0),
    );
    expect(computeNextRunAt(overnight, local(2026, 7, 17, 23, 0))).toEqual(
      local(2026, 7, 18, 0, 0),
    );
    expect(computeNextRunAt(overnight, local(2026, 7, 18, 2, 0))).toEqual(local(2026, 7, 18, 3, 0));
    expect(computeNextRunAt(overnight, local(2026, 7, 18, 7, 0))).toEqual(
      local(2026, 7, 18, 10, 0),
    );
  });
});

describe("cron and timezone", () => {
  it("fires an hourly cron on the next hour, not at midnight", () => {
    const from = new Date(2026, 7, 17, 10, 15, 0, 0);
    const next = computeNextRunAt({ kind: "cron", expr: "0 * * * *" }, from);
    expect(next.getHours()).toBe(11);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(17);
  });

  it("honors day-of-month and steps", () => {
    const from = new Date(2026, 0, 1, 0, 0, 0, 0);
    const next = computeNextRunAt({ kind: "cron", expr: "*/15 9 1 * *" }, from);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    const later = computeNextRunAt({ kind: "cron", expr: "*/15 9 1 * *" }, next);
    expect(later.getMinutes()).toBe(15);
    expect(later.getDate()).toBe(1);
  });

  it("skips blackout dates and limits adaptive jobs to weekdays", () => {
    const from = new Date(2026, 7, 17, 8, 0, 0, 0);
    expect(from.getDay()).toBe(1);
    const weekend = computeNextRunAt(
      { ...peakHours, weekdays: [1, 2, 3, 4, 5] },
      new Date(2026, 7, 22, 10, 0, 0, 0),
    );
    expect(weekend.getDay()).toBe(1);
    expect(weekend.getHours()).toBe(9);
    const blocked = computeNextRunAt(
      { kind: "daily", hour: 9, minute: 0 },
      new Date(2026, 7, 17, 10, 0, 0, 0),
      { blackoutDates: ["2026-08-18"] },
    );
    expect(blocked.getDate()).toBe(19);
    expect(blocked.getHours()).toBe(9);
  });

  it("computes a daily fire in a named timezone", () => {
    const from = new Date("2026-01-15T18:00:00.000Z");
    const next = computeNextRunAt({ kind: "daily", hour: 9, minute: 0 }, from, {
      timeZone: "America/Los_Angeles",
    });
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(next);
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    expect(`${hour}:${minute}`).toBe("09:00");
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe("formatRunDuration", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatRunDuration("2026-08-29T02:00:00.000Z", "2026-08-29T02:00:08.000Z")).toBe("8s");
    expect(formatRunDuration("2026-08-29T02:00:00.000Z", "2026-08-29T02:05:00.000Z")).toBe("5m");
    expect(formatRunDuration("2026-08-29T02:00:00.000Z", "2026-08-29T03:07:00.000Z")).toBe("1h 7m");
  });
});

describe("automationMatchesQuery", () => {
  const job = {
    name: "Nightly tests",
    prompt: "run the suite",
    schedule: { kind: "daily" as const, hour: 9, minute: 0 },
    repo: { forge: "github" as const, url: "https://github.com/acme/app.git" },
  };

  it("matches name, prompt, schedule, and repo", () => {
    expect(automationMatchesQuery(job, "nightly")).toBe(true);
    expect(automationMatchesQuery(job, "suite")).toBe(true);
    expect(automationMatchesQuery(job, "daily")).toBe(true);
    expect(automationMatchesQuery(job, "acme/app")).toBe(true);
    expect(automationMatchesQuery(job, "webhook")).toBe(false);
  });
});

describe("automation starters and clone", () => {
  it("lists four starters and looks them up", () => {
    expect(AUTOMATION_STARTERS.map((row) => row.id)).toEqual([
      "nightly",
      "git-push",
      "slack-ops",
      "digest",
    ]);
    expect(automationStarterById("nightly")?.schedule).toEqual({
      kind: "daily",
      hour: 2,
      minute: 0,
    });
    expect(automationStarterById("missing")).toBeUndefined();
  });

  it("names clones without colliding", () => {
    expect(nextCloneName("Nightly tests", [])).toBe("Nightly tests copy");
    expect(nextCloneName("Nightly tests", ["Nightly tests copy"])).toBe("Nightly tests copy 2");
    expect(nextCloneName("  ", ["Automation copy"])).toBe("Automation copy 2");
  });

  it("copies create fields and drops run history", () => {
    const item: Automation = {
      id: "auto-1",
      name: "Nightly tests",
      enabled: false,
      prompt: "run the suite",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      runtime: "docker",
      dockerImage: "locus/agent",
      providerId: "p1",
      model: "gpt-4.1",
      startVm: true,
      persistMemory: true,
      memories: [{ id: "m1", text: "secret-ish", createdAt: "2026-09-01T00:00:00.000Z" }],
      repo: { forge: "github", url: "https://github.com/acme/app.git" },
      schedule: { kind: "daily", hour: 2, minute: 0 },
      webhookSecret: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      lastForgeSha: "abc",
      lastRunAt: "2026-09-01T02:00:00.000Z",
      nextRunAt: "2026-09-02T02:00:00.000Z",
      notifyChannel: "C_OPS",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const input = cloneAutomationInput(item, "Nightly tests copy");
    expect(input).toMatchObject({
      name: "Nightly tests copy",
      prompt: "run the suite",
      enabled: false,
      persistMemory: true,
      notifyChannel: "C_OPS",
      schedule: { kind: "daily", hour: 2, minute: 0 },
      repo: { forge: "github", url: "https://github.com/acme/app.git" },
    });
    expect(input).not.toHaveProperty("memories");
    expect(input).not.toHaveProperty("webhookSecret");
    expect(input).not.toHaveProperty("lastForgeSha");
  });

  it("lists teammate-owned routines before unassigned ones", () => {
    const rows: Automation[] = [
      {
        id: "a1",
        name: "Global",
        enabled: true,
        prompt: "x",
        os: "ubuntu",
        templateId: "ubuntu-24.04",
        providerId: "p1",
        model: "m",
        startVm: true,
        schedule: { kind: "daily", hour: 9, minute: 0 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "a2",
        name: "Nova daily",
        enabled: true,
        prompt: "y",
        os: "ubuntu",
        templateId: "ubuntu-24.04",
        providerId: "p1",
        model: "m",
        startVm: true,
        ownerSessionId: "nova",
        schedule: { kind: "daily", hour: 8, minute: 0 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "a3",
        name: "Other",
        enabled: true,
        prompt: "z",
        os: "ubuntu",
        templateId: "ubuntu-24.04",
        providerId: "p1",
        model: "m",
        startVm: true,
        ownerSessionId: "other",
        schedule: { kind: "daily", hour: 7, minute: 0 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(routinesForTeammate(rows, "nova", 8).map((row) => row.id)).toEqual(["a2", "a1"]);
  });
});

describe("clock timezone labels", () => {
  it("labels Pacific time with a short chip", () => {
    const label = localTimezoneLabel(new Date("2026-09-07T12:00:00Z"), "America/Los_Angeles");
    expect(label.iana).toBe("America/Los_Angeles");
    expect(label.short).toMatch(/^P[DS]T$/);
    expect(label.chip).toBe(`Local time (${label.short})`);
    expect(formatLocalTimezone(new Date("2026-09-07T12:00:00Z"), "America/Los_Angeles")).toBe(
      `${label.short} · America/Los_Angeles`,
    );
    expect(isClockSchedule({ kind: "daily", hour: 2, minute: 0 })).toBe(true);
    expect(isClockSchedule({ kind: "webhook" })).toBe(false);
    expect(TEST_WEBHOOK_SKIP_REASON).toMatch(/No agent run/);
  });
});

describe("agent-run vs test skip", () => {
  const testSkip = {
    status: "skipped" as const,
    error: TEST_WEBHOOK_SKIP_REASON,
  };
  const failed = { status: "failed" as const, error: "boom", sessionId: "s1" };
  const overlap = { status: "skipped" as const, error: "A run is already in progress" };

  it("does not treat a simulated webhook trigger as an agent outcome", () => {
    expect(isTestWebhookSkip(testSkip)).toBe(true);
    expect(isAgentAutomationRun(testSkip)).toBe(false);
    expect(isAgentAutomationRun(failed)).toBe(true);
    expect(isAgentAutomationRun(overlap)).toBe(false);
    expect(runHistoryStatusLabel(testSkip)).toBe("test");
    expect(runHistoryStatusLabel(failed)).toBe("failed");
  });

  it("notifies failures, and successes only when failed-only is off", () => {
    expect(shouldNotifyAutomationOutcome(testSkip, false)).toBe(false);
    expect(shouldNotifyAutomationOutcome(testSkip, true)).toBe(false);
    expect(shouldNotifyAutomationOutcome(failed, true)).toBe(true);
    expect(shouldNotifyAutomationOutcome({ status: "succeeded" }, true)).toBe(false);
    expect(shouldNotifyAutomationOutcome({ status: "succeeded" }, false)).toBe(true);
    expect(shouldNotifyAutomationOutcome(overlap, false)).toBe(false);
    expect(shouldNotifyAutomationOutcome({ status: "needs_you" }, true)).toBe(true);
    expect(
      shouldNotifyAutomationOutcome({ status: "succeeded" }, false, {
        success: false,
        failure: true,
        needsYou: true,
      }),
    ).toBe(false);
    expect(
      shouldNotifyAutomationOutcome({ status: "needs_you" }, false, {
        success: true,
        failure: true,
        needsYou: false,
      }),
    ).toBe(false);
  });
});
