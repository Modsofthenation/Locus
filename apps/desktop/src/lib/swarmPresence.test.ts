import { describe, expect, it } from "vitest";
import type { AgentSession } from "@locus/shared";
import { clipSwarmPreview, swarmComputerStatus, swarmRosterMeta } from "./swarmPresence";

function session(partial: Partial<AgentSession>): AgentSession {
  return {
    id: "s1",
    title: "Teammate",
    os: "ubuntu",
    templateId: "t",
    providerId: "p",
    model: "m",
    status: "idle",
    messages: [],
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...partial,
  } as AgentSession;
}

describe("swarmRosterMeta", () => {
  it("prefers last assistant text, then role, then empty", () => {
    expect(
      swarmRosterMeta(
        session({
          messages: [
            {
              id: "m1",
              role: "assistant",
              content: "Hello from the builder",
              createdAt: "2026-09-21T00:00:00.000Z",
            },
          ],
        }),
      ),
    ).toBe("Hello from the builder");
    expect(swarmRosterMeta(session({ persona: { hubRole: "Ops" } }))).toBe("Ops");
    expect(swarmRosterMeta(session({}))).toBe("No messages yet");
  });
});

describe("swarmComputerStatus", () => {
  it("reports host vs guest copy", () => {
    expect(swarmComputerStatus(session({ runtime: "host", model: "m", status: "idle" }))).toEqual({
      title: "Host workspace",
      detail: "m · idle",
    });
    expect(clipSwarmPreview("abcd", 3)).toBe("ab…");
  });
});
