import { describe, expect, it } from "vitest";
import {
  CANCELLED_TURN_NOTE,
  completedToolCallIds,
  INTERRUPTED_TURN_NOTE,
  toolResultForCall,
} from "./journal.js";
import type { ChatMessage } from "./models/session.js";

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, "role">): ChatMessage {
  return {
    id: partial.id ?? "m",
    role: partial.role,
    content: partial.content ?? "",
    toolCallId: partial.toolCallId,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("turn journal", () => {
  it("indexes completed tool call ids so retries can skip work already done", () => {
    const messages = [
      msg({ role: "assistant", id: "a1" }),
      msg({ role: "tool", id: "t1", toolCallId: "call-1", content: "ok" }),
      msg({ role: "tool", id: "t2", toolCallId: "call-2", content: "also" }),
    ];
    expect([...completedToolCallIds(messages)]).toEqual(["call-1", "call-2"]);
    expect(toolResultForCall(messages, "call-2")).toBe("also");
    expect(toolResultForCall(messages, "missing")).toBeUndefined();
  });

  it("has recovery copy for crash and cancel", () => {
    expect(INTERRUPTED_TURN_NOTE).toContain("interrupted");
    expect(CANCELLED_TURN_NOTE).toContain("checkpoint");
  });
});
