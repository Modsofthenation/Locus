import { describe, expect, it } from "vitest";
import type { AgentSession, Automation, AutomationRun, SlackReviewRun } from "@locus/shared";
import {
  activeAgents,
  automationActivity,
  nextScheduledRuns,
  recentSessions,
  reviewSessions,
  slackReviewActivity,
} from "./dashboard";

function session(over: Partial<AgentSession>): AgentSession {
  return {
    id: "s",
    title: "t",
    status: "idle",
    messages: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as AgentSession;
}

describe("dashboard", () => {
  const sessions = [
    session({ id: "a", status: "running", updatedAt: "2026-01-01T00:01:00.000Z" }),
    session({
      id: "b",
      status: "provisioning",
      updatedAt: "2026-01-01T00:05:00.000Z",
      subagents: [
        { id: "x", task: "t", status: "running" },
        { id: "y", task: "t", status: "done" },
      ],
    }),
    session({ id: "r1", kind: "review", status: "idle", updatedAt: "2026-01-01T00:09:00.000Z" }),
    session({ id: "r2", kind: "review", status: "running" }),
    session({ id: "c", status: "idle", updatedAt: "2026-01-01T00:08:00.000Z" }),
    session({ id: "d", status: "draft" }),
    session({ id: "z", status: "running", archived: true }),
  ];

  it("lists working non-review agents newest first with running subagents", () => {
    expect(activeAgents(sessions).map((row) => [row.session.id, row.subagents])).toEqual([
      ["b", 1],
      ["a", 0],
    ]);
  });

  it("puts running review chats first", () => {
    expect(reviewSessions(sessions).map((row) => row.id)).toEqual(["r2", "r1"]);
  });

  it("lists recent idle chats without drafts or archived", () => {
    expect(recentSessions(sessions).map((row) => row.id)).toEqual(["r1", "c"]);
  });

  it("splits job runs into live and recent with names", () => {
    const automations = [
      { id: "j1", name: "Nightly", enabled: true, nextRunAt: "2026-01-02T00:00:00.000Z" },
      { id: "j2", name: "Hourly", enabled: true, nextRunAt: "2026-01-01T01:00:00.000Z" },
      { id: "j3", name: "Off", enabled: false, nextRunAt: "2025-01-01T00:00:00.000Z" },
    ] as Automation[];
    const runs = [
      { id: "1", automationId: "j1", status: "succeeded", startedAt: "2026-01-01T00:00:00.000Z" },
      { id: "2", automationId: "j2", status: "running", startedAt: "2026-01-01T00:02:00.000Z" },
      { id: "3", automationId: "gone", status: "failed", startedAt: "2026-01-01T00:03:00.000Z" },
    ] as AutomationRun[];
    const { live, recent } = automationActivity(automations, runs);
    expect(live.map((row) => row.name)).toEqual(["Hourly"]);
    expect(recent.map((row) => [row.run.id, row.name])).toEqual([
      ["3", "Job"],
      ["1", "Nightly"],
    ]);
    expect(nextScheduledRuns(automations)[0]?.id).toBe("j2");
  });

  it("drops dry-run Slack reviews from recent", () => {
    const runs = [
      { reviewerId: "r", pr: "a#1", url: "u1", outcome: "approved", at: "2026-01-01T00:00:00Z" },
      {
        reviewerId: "r",
        pr: "a#2",
        url: "u2",
        outcome: "commented",
        at: "2026-01-01T00:05:00Z",
        dryRun: true,
      },
    ] as SlackReviewRun[];
    expect(slackReviewActivity(runs, []).recent.map((row) => row.pr)).toEqual(["a#1"]);
  });
});
