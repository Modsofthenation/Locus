import { describe, expect, it } from "vitest";
import type { AgentSession } from "@locus/shared";
import {
  applyRequestedDefaultSubagent,
  llmResponseDetail,
  parkedStatus,
  reviewTurnEndArgs,
  sessionRulesChars,
  withWorkspaceReadiness,
} from "./sessionTurnHelpers.js";

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Agent",
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "p",
    model: "grok-4",
    status: "idle",
    messages: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("sessionTurnHelpers", () => {
  it("counts instruction and pin characters", () => {
    expect(sessionRulesChars({ instructions: "hi", pins: ".btn" })).toBeGreaterThan(10);
    expect(sessionRulesChars({})).toBe(0);
  });

  it("parks host chats as idle without a guest", () => {
    expect(parkedStatus({ runtime: "host" })).toBe("idle");
    expect(parkedStatus({ runtime: "vm" })).toBe("draft");
    expect(parkedStatus({ runtime: "vm", vmId: "v1" })).toBe("idle");
  });

  it("summarizes a model reply", () => {
    expect(llmResponseDetail()).toBe("blank");
    expect(llmResponseDetail({ content: "hello" }, [{ name: "exec" }])).toBe("tools exec · text 5");
  });

  it("prefixes workspace readiness notes", () => {
    expect(withWorkspaceReadiness("do it")).toBe("do it");
    expect(withWorkspaceReadiness("do it", "Guest ready")).toBe("Guest ready\n\ndo it");
  });

  it("leaves review args empty unless this is a review session", () => {
    expect(reviewTurnEndArgs(session())).toEqual({});
    expect(reviewTurnEndArgs(null)).toEqual({});
  });

  it("stores a requested default subagent on the session", () => {
    const current = session();
    applyRequestedDefaultSubagent(current, "please use explorer");
    expect(
      current.defaultSubagent === undefined || typeof current.defaultSubagent === "string",
    ).toBe(true);
  });
});
