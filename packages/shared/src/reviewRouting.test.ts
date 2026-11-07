import { describe, expect, it } from "vitest";
import {
  REVIEW_ROUTING_NUDGE,
  REVIEW_ROUTING_SEARCH_ROUNDS,
  shouldNudgeReviewRouting,
} from "./reviewRouting.js";

describe("review routing", () => {
  it("nudges after a search streak without git_pr_get", () => {
    const base = {
      isReview: true,
      calledReview: false,
      searchRounds: REVIEW_ROUTING_SEARCH_ROUNDS,
      nudges: 0,
    };
    expect(shouldNudgeReviewRouting(base)).toBe(true);
    expect(shouldNudgeReviewRouting({ ...base, searchRounds: 1 })).toBe(false);
    expect(shouldNudgeReviewRouting({ ...base, calledReview: true })).toBe(false);
    expect(shouldNudgeReviewRouting({ ...base, nudges: 1 })).toBe(true);
    expect(shouldNudgeReviewRouting({ ...base, nudges: 2 })).toBe(false);
    expect(shouldNudgeReviewRouting({ ...base, isReview: false })).toBe(false);
    expect(
      shouldNudgeReviewRouting({
        ...base,
        searchRounds: 0,
        applyThisTurn: true,
        toolCallCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldNudgeReviewRouting({
        ...base,
        searchRounds: 0,
        applyThisTurn: true,
        toolCallCount: 1,
      }),
    ).toBe(true);
    expect(REVIEW_ROUTING_NUDGE).toMatch(/git_pr_get/);
    expect(REVIEW_ROUTING_NUDGE).toMatch(/include=\["files"\]/);
    expect(REVIEW_ROUTING_NUDGE).toMatch(/Listing MCP tools is not enough/);
  });
});
