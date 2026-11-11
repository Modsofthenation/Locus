import { describe, expect, it } from "vitest";
import type { AgentSession, Automation, AutomationRun } from "@locus/shared";
import { buildInboxRows, inboxRowMatchesQuery } from "./inboxList";

const session: AgentSession = {
  id: "s1",
  title: "Fix login",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  vmId: "v1",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  needsHuman: "Approve git_push",
};

const job: Automation = {
  id: "a1",
  name: "Nightly QA",
  enabled: true,
  prompt: "x",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "grok-4",
  startVm: false,
  schedule: { kind: "interval", everyMinutes: 60 },
  createdAt: "2026-08-17T12:00:00.000Z",
  updatedAt: "2026-08-17T12:00:00.000Z",
};

const failedRun: AutomationRun = {
  id: "r1",
  automationId: "a1",
  status: "failed",
  trigger: "schedule",
  startedAt: "2026-08-17T12:00:00.000Z",
};

describe("inboxList", () => {
  it("collects gated sessions, board comments, Brain, and failing automations", () => {
    const rows = buildInboxRows({
      sessions: [session],
      boards: [
        {
          id: "b1",
          title: "Retro",
          createdAt: "t",
          updatedAt: "t",
          objectCount: 1,
          frameCount: 0,
          pendingComments: [{ id: "c9", objectId: "s1", body: "Name the owner", author: "agent" }],
        },
      ],
      brain: { inboxCount: 2 },
      automations: [job],
      runs: [failedRun],
    });
    expect(rows.map((row) => row.kind)).toEqual(["session", "board", "brain", "automation"]);
    expect(rows[0]).toMatchObject({ kind: "session", sessionId: "s1" });
    expect(rows.at(-1)).toMatchObject({
      title: "Nightly QA",
      detail: "Failing",
      automationId: "a1",
    });
  });

  it("filters inbox rows by title or detail", () => {
    expect(inboxRowMatchesQuery({ title: "Fix login", detail: "Approve git_push" }, "git")).toBe(
      true,
    );
    expect(inboxRowMatchesQuery({ title: "Fix login", detail: "Approve git_push" }, "docker")).toBe(
      false,
    );
  });
});
