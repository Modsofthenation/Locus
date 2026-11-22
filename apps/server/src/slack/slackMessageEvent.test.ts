import { describe, expect, it } from "vitest";
import { parseSlackMessageEvent } from "./slackGateway.js";

describe("parseSlackMessageEvent", () => {
  it("reads channel posts, thread replies and edits", () => {
    expect(parseSlackMessageEvent({ type: "message", channel: "C1", ts: "1.0" })).toEqual({
      channelId: "C1",
      ts: "1.0",
    });
    expect(
      parseSlackMessageEvent({ type: "message", channel: "C1", ts: "2.0", thread_ts: "1.0" }),
    ).toEqual({ channelId: "C1", ts: "2.0", threadTs: "1.0" });
    expect(
      parseSlackMessageEvent({
        type: "message",
        subtype: "message_changed",
        channel: "C1",
        message: { ts: "3.0", thread_ts: "1.0" },
      }),
    ).toEqual({ channelId: "C1", ts: "3.0", threadTs: "1.0" });
  });

  it("carries the text and reads app_mention events", () => {
    expect(
      parseSlackMessageEvent({
        type: "app_mention",
        channel: "C1",
        ts: "2.0",
        thread_ts: "1.0",
        text: "<@UBOT> review this",
      }),
    ).toEqual({ channelId: "C1", ts: "2.0", threadTs: "1.0", text: "<@UBOT> review this" });
  });

  it("ignores other events and malformed ones", () => {
    expect(parseSlackMessageEvent({ type: "reaction_added", channel: "C1", ts: "1.0" })).toBe(
      undefined,
    );
    expect(parseSlackMessageEvent({ type: "message", ts: "1.0" })).toBe(undefined);
    expect(parseSlackMessageEvent(null)).toBe(undefined);
  });
});
