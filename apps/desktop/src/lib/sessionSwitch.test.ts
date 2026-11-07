import { describe, expect, it } from "vitest";
import type { AgentSession } from "@locus/shared";
import { filterSessions, sessionForDigit, switchableSessions } from "./sessionSwitch";

function session(id: string, title: string, archived = false): AgentSession {
  return {
    id,
    title,
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "p",
    model: "grok-4",
    archived,
    status: "idle",
    messages: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
}

describe("session switcher", () => {
  const rows = [session("a", "Alpha"), session("b", "Beta", true), session("c", "Gamma")];

  it("skips archived sessions and maps Cmd+1..9", () => {
    expect(switchableSessions(rows).map((s) => s.id)).toEqual(["a", "c"]);
    expect(sessionForDigit(rows, "1")?.id).toBe("a");
    expect(sessionForDigit(rows, "2")?.id).toBe("c");
    expect(sessionForDigit(rows, "9")).toBeUndefined();
  });

  it("filters by title", () => {
    expect(filterSessions(rows, "gam").map((s) => s.id)).toEqual(["c"]);
  });
});
