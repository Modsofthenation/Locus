import { describe, expect, it } from "vitest";
import {
  keepSubagentsForMessages,
  matchSubagent,
  findLiveSubagent,
  subagentStatusLabel,
  subagentViewMessages,
  type ChatMessage,
  type SubagentLive,
} from "./session.js";

const agent: SubagentLive = {
  id: "c1",
  task: "find compact.ts",
  status: "done",
  toolCallId: "call-1",
  lastLine: "It's in src/compact.ts",
};

describe("subagent helpers", () => {
  it("matches a spawn_agent call by toolCallId, then unique task", () => {
    expect(
      matchSubagent([agent], {
        id: "call-1",
        name: "spawn_agent",
        arguments: { task: "find compact.ts" },
      })?.id,
    ).toBe("c1");
    expect(
      matchSubagent([{ ...agent, toolCallId: undefined }], {
        id: "other",
        name: "spawn_agent",
        arguments: { task: "find compact.ts" },
      })?.id,
    ).toBe("c1");
    expect(
      matchSubagent([agent, { ...agent, id: "c2" }], {
        id: "other",
        name: "spawn_agent",
        arguments: { task: "find compact.ts" },
      }),
    ).toBeUndefined();
    expect(
      matchSubagent([agent], {
        id: "call-1",
        name: "grep",
        arguments: { task: "find compact.ts" },
      }),
    ).toBeUndefined();
  });

  it("finds the live row by id or toolCallId", () => {
    expect(findLiveSubagent([agent], { id: "call-1", toolCallId: "call-1" })?.id).toBe("c1");
    expect(findLiveSubagent([agent], { id: "c1" })?.id).toBe("c1");
    expect(findLiveSubagent([agent], { id: "nope", toolCallId: "call-1" })?.id).toBe("c1");
  });

  it("drops subagents whose spawn_agent call is no longer in the thread", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            name: "spawn_agent",
            arguments: { task: "find compact.ts" },
            startedAt: "2020-01-01T00:00:00.000Z",
          },
        ],
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ];
    expect(keepSubagentsForMessages([agent], messages)?.map((row) => row.id)).toEqual(["c1"]);
    expect(keepSubagentsForMessages([agent], [])).toBeUndefined();
    const sibling: SubagentLive = { ...agent, id: "c2", toolCallId: "call-2" };
    expect(keepSubagentsForMessages([agent, sibling], messages)?.map((row) => row.id)).toEqual([
      "c1",
    ]);
  });

  it("falls back to the task and last line when no transcript was stored", () => {
    const rows = subagentViewMessages(agent);
    expect(rows[0]?.role).toBe("user");
    expect(rows[0]?.content).toBe("find compact.ts");
    expect(rows[1]?.content).toMatch(/compact\.ts/);
    expect(subagentViewMessages({ ...agent, messages: rows }).length).toBe(2);
    expect(subagentStatusLabel("running")).toBe("Running");
    expect(subagentStatusLabel("error")).toBe("Failed");
  });
});
