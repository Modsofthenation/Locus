import { describe, expect, it } from "vitest";
import { ReviewerApiLog } from "./reviewerApiLog.js";

describe("ReviewerApiLog", () => {
  it("records calls with phase, reviewer, redacted request and summary", async () => {
    let t = 1_000;
    const log = new ReviewerApiLog(() => t);
    const slack = log.wrap("slack", {
      async peekHistory(channel: string) {
        t += 25;
        return [{ ts: "1.0", text: channel }];
      },
      onChannelMessage: () => () => undefined,
    });
    await log.scope("channel", "r1", () => slack.peekHistory("C1"));
    await slack.peekHistory("C2");
    const { entries, lastSeq } = log.list();
    expect(lastSeq).toBe(2);
    expect(entries[0]).toMatchObject({
      seq: 1,
      service: "slack",
      method: "peekHistory",
      endpoint: "conversations.history",
      phase: "channel",
      reviewerId: "r1",
      ok: true,
      durationMs: 25,
      summary: "1 item",
    });
    expect(entries[1]!.phase).toBe("review");
    expect(log.list(1).entries.map((row) => row.seq)).toEqual([2]);
    // Subscriptions pass through unrecorded.
    slack.onChannelMessage();
    expect(log.list().lastSeq).toBe(2);
  });

  it("records failures, rethrows them, and never logs a token", async () => {
    const log = new ReviewerApiLog();
    const forge = log.wrap("forge", {
      async listPulls(_account: { token: string }, owner: string) {
        throw new Error(`no access to ${owner}`);
      },
    });
    await expect(
      log.scope("autoReview", "r1", () => forge.listPulls({ token: "ghp_secret" }, "acme")),
    ).rejects.toThrow("no access to acme");
    const [row] = log.list().entries;
    expect(row).toMatchObject({ ok: false, phase: "autoReview", summary: "no access to acme" });
    expect(row!.response).toBeUndefined();
    expect(row!.request).not.toContain("ghp_secret");
  });

  it("keeps only the newest entries", async () => {
    const log = new ReviewerApiLog(Date.now, 3);
    const api = log.wrap("slack", { react: async () => undefined });
    for (let i = 0; i < 5; i++) await api.react();
    expect(log.list().entries.map((row) => row.seq)).toEqual([3, 4, 5]);
  });
});
