import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@locus/shared";
import { chatFindHits, stepChatFindIndex } from "./chatFind";

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">): ChatMessage {
  return { content: "", createdAt: "2020-01-01T00:00:00.000Z", ...partial };
}

describe("chatFindHits", () => {
  it("returns clustered message ids whose visible text matches", () => {
    const user = msg({ id: "u", role: "user", content: "Fix the login form" });
    const assistant = msg({
      id: "a",
      role: "assistant",
      content: "Looking at auth.ts",
      toolCalls: [{ id: "c1", name: "grep", arguments: { pattern: "login" }, startedAt: "t" }],
    });
    const tool = msg({ id: "t", role: "tool", toolCallId: "c1", content: "auth.ts:12 login()" });
    expect(chatFindHits([user, assistant, tool], "login form")).toEqual(["u"]);
    expect(chatFindHits([user, assistant, tool], "auth.ts")).toEqual(["a"]);
    expect(chatFindHits([user, assistant, tool], "missing")).toEqual([]);
  });

  it("recomputes when the messages array identity changes", () => {
    const first = [msg({ id: "u", role: "user", content: "alpha" })];
    expect(chatFindHits(first, "alpha")).toEqual(["u"]);
    const second = [msg({ id: "u", role: "user", content: "beta" })];
    expect(chatFindHits(second, "alpha")).toEqual([]);
    expect(chatFindHits(second, "beta")).toEqual(["u"]);
    expect(chatFindHits(second, "beta")).toEqual(["u"]);
  });
});

describe("stepChatFindIndex", () => {
  it("wraps next and previous", () => {
    expect(stepChatFindIndex(3, 2, 1)).toBe(0);
    expect(stepChatFindIndex(3, 0, -1)).toBe(2);
    expect(stepChatFindIndex(0, 0, 1)).toBe(0);
  });
});
