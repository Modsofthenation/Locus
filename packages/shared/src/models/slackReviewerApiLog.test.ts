import { describe, expect, it } from "vitest";
import {
  formatSlackReviewerApiLogValue,
  summarizeSlackReviewerApiResult,
} from "./slackReviewerApiLog.js";

describe("formatSlackReviewerApiLogValue", () => {
  it("redacts credential-looking keys at any depth", () => {
    const { text } = formatSlackReviewerApiLogValue([
      { host: "github.com", username: "me", token: "ghp_secret", refreshToken: "r" },
      "acme",
      { headers: { Authorization: "Bearer x" } },
    ]);
    expect(text).not.toContain("ghp_secret");
    expect(text).not.toContain("Bearer x");
    expect(text).toContain('"token": "[redacted]"');
    expect(text).toContain('"username": "me"');
  });

  it("trims long strings and the whole text", () => {
    const long = formatSlackReviewerApiLogValue({ diff: "x".repeat(2_000) });
    expect(long.truncated).toBe(true);
    expect(long.text).toContain("2,000 chars");
    const big = formatSlackReviewerApiLogValue(
      Array.from({ length: 200 }, (_, i) => ({ i })),
      100,
    );
    expect(big.truncated).toBe(true);
    expect(big.text.length).toBeLessThan(130);
  });

  it("survives circular values", () => {
    const row: Record<string, unknown> = { a: 1 };
    row.self = row;
    expect(formatSlackReviewerApiLogValue(row).text).toContain("[circular]");
  });
});

describe("summarizeSlackReviewerApiResult", () => {
  it("counts arrays and picks a few fields from objects", () => {
    expect(summarizeSlackReviewerApiResult([1, 2, 3])).toBe("3 items");
    expect(summarizeSlackReviewerApiResult([1])).toBe("1 item");
    expect(summarizeSlackReviewerApiResult(undefined)).toBe("ok");
    expect(summarizeSlackReviewerApiResult({ state: "open", title: "Fix", body: "…" })).toBe(
      "state: open · title: Fix",
    );
  });
});
