import { describe, expect, it } from "vitest";
import { SELF_CORRECT_NUDGE, type ChatMessage } from "@locus/shared";
import { firstNewClusterMessageId, lastVisibleMessageId, visitMarkerId } from "./chatNewMarker";

function msg(
  id: string,
  role: ChatMessage["role"],
  content: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return { id, role, content, createdAt: "2020-01-01T00:00:00.000Z", ...extra };
}

describe("chat new marker", () => {
  it("uses the last visible cluster id, including folded tools", () => {
    expect(lastVisibleMessageId([])).toBeUndefined();
    expect(lastVisibleMessageId([msg("u1", "user", "hi")])).toBe("u1");
    expect(
      lastVisibleMessageId([
        msg("u1", "user", "hi"),
        msg("a1", "assistant", "on it"),
        msg("t1", "tool", "ok"),
      ]),
    ).toBe("t1");
  });

  it("skips hidden system nudges when snapshotting last seen", () => {
    expect(
      lastVisibleMessageId([msg("u1", "user", "hi"), msg("n1", "system", SELF_CORRECT_NUDGE)]),
    ).toBe("u1");
  });

  it("returns the next cluster after the last-seen turn", () => {
    const messages = [
      msg("u1", "user", "go"),
      msg("a1", "assistant", "working"),
      msg("t1", "tool", "ok"),
      msg("a2", "assistant", "done"),
    ];
    expect(firstNewClusterMessageId(messages, undefined)).toBeUndefined();
    expect(firstNewClusterMessageId(messages, "a1")).toBe("a2");
    expect(firstNewClusterMessageId(messages, "t1")).toBe("a2");
    expect(firstNewClusterMessageId(messages, "a2")).toBeUndefined();
    expect(firstNewClusterMessageId(messages, "missing")).toBeUndefined();
  });

  it("does not mark the first visit as new", () => {
    expect(
      firstNewClusterMessageId(
        [msg("u1", "user", "hello"), msg("a1", "assistant", "hi")],
        undefined,
      ),
    ).toBeUndefined();
  });

  it("only yields a marker for the matching visit", () => {
    expect(visitMarkerId(null, "s1")).toBeUndefined();
    expect(visitMarkerId({ sessionId: "s1" }, "s1")).toBeUndefined();
    expect(visitMarkerId({ sessionId: "s1", markerId: "a2" }, "s1")).toBe("a2");
    expect(visitMarkerId({ sessionId: "s1", markerId: "a2" }, "s2")).toBeUndefined();
  });
});
