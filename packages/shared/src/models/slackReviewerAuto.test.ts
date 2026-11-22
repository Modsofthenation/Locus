import { describe, expect, it } from "vitest";
import { parseSlackReviewer } from "./slackReviewer.js";
import {
  expandSlackAutoReviewGlobs,
  formatSlackAutoReviewPost,
  isSlackPrReviewCommand,
  planSlackAutoReview,
  slackAutoReviewRepos,
  slackPrReviewCommand,
} from "./slackReviewerAuto.js";

describe("auto review config", () => {
  it("defaults the new triggers off and one review at a time, and clamps concurrency", () => {
    const base = parseSlackReviewer({ id: "r", channelId: "C1" })!;
    expect(base).toMatchObject({
      autoReview: false,
      reviewOnPrComment: false,
      maxConcurrentReviews: 1,
    });
    const on = parseSlackReviewer({
      id: "r",
      channelId: "C1",
      autoReview: true,
      reviewOnPrComment: true,
      maxConcurrentReviews: 3,
    })!;
    expect(on).toMatchObject({
      autoReview: true,
      reviewOnPrComment: true,
      maxConcurrentReviews: 3,
    });
    expect(parseSlackReviewer({ id: "r", maxConcurrentReviews: 99 })!.maxConcurrentReviews).toBe(4);
    expect(parseSlackReviewer({ id: "r", maxConcurrentReviews: 0 })!.maxConcurrentReviews).toBe(1);
    expect(parseSlackReviewer({ id: "r", maxConcurrentReviews: "x" })!.maxConcurrentReviews).toBe(
      1,
    );
  });

  it("polls exact repos, expands globs in the repo name, and never an owner glob", () => {
    const repos = slackAutoReviewRepos({
      repos: ["acme/api", "acme/web-*", "*/infra", "acme/api", "bad", "acme/"],
    });
    expect(repos.exact).toEqual(["acme/api"]);
    expect(repos.globs).toEqual([{ owner: "acme", pattern: "acme/web-*" }]);
    expect(
      expandSlackAutoReviewGlobs(repos.globs, ["acme/web-app", "acme/api", "other/web-app"]),
    ).toEqual(["acme/web-app"]);
  });
});

describe("planSlackAutoReview", () => {
  const now = "2026-11-22T10:00:00.000Z";

  it("only remembers on the first poll, then reviews new and newly ready PRs", () => {
    const first = planSlackAutoReview({
      primed: false,
      seen: {},
      pulls: [{ key: "a#1" }, { key: "a#2", draft: true }],
      skipDrafts: true,
      now,
    });
    expect(first.review).toEqual([]);
    expect(first.seen["a#2"]).toEqual({ ready: false, since: now });

    const later = "2026-11-22T10:05:00.000Z";
    const second = planSlackAutoReview({
      primed: true,
      seen: first.seen,
      pulls: [{ key: "a#1", updatedAt: "u2" }, { key: "a#2" }, { key: "a#3" }],
      skipDrafts: true,
      now: later,
    });
    expect(second.review).toEqual(["a#2", "a#3"]);
    expect(second.changed).toEqual(["a#1"]);
    expect(second.seen["a#2"]!.since).toBe(now);
    expect(second.seen["a#3"]!.since).toBe(later);

    // A closed PR drops out; a draft counts as ready when drafts aren't skipped.
    const third = planSlackAutoReview({
      primed: true,
      seen: second.seen,
      pulls: [{ key: "a#4", draft: true }],
      skipDrafts: false,
      now,
    });
    expect(third.review).toEqual(["a#4"]);
    expect(Object.keys(third.seen)).toEqual(["a#4"]);
  });
});

describe("@locus review on the PR", () => {
  it("matches only the locus review forms", () => {
    for (const ok of [
      "@locus review",
      "locus re-review please",
      "@Locus rereview",
      " locus review",
    ])
      expect(isSlackPrReviewCommand(ok)).toBe(true);
    for (const no of ["/review", "@coderabbit review", "please locus review", "locus reviewer"])
      expect(isSlackPrReviewCommand(no)).toBe(false);
  });

  it("takes the newest request after the cursor, not from itself or bots", () => {
    const at = (min: number) => new Date(Date.UTC(2026, 10, 22, 10, min)).toISOString();
    const comments = [
      { id: "1", body: "@locus review", author: "bob", createdAt: at(1) },
      { id: "2", body: "@locus review", author: "locus-bot", createdAt: at(3) },
      { id: "3", body: "@locus review", author: "renovate[bot]", createdAt: at(4) },
      { id: "4", body: "looks fine", author: "carol", createdAt: at(5) },
    ];
    const found = slackPrReviewCommand(comments, at(0), ["Locus-Bot"]);
    expect(found.request).toEqual({ author: "bob", createdAt: at(1), id: "1" });
    expect(found.newest).toBe(at(5));
    expect(slackPrReviewCommand(comments, at(2), ["locus-bot"]).request).toBeUndefined();
  });

  it("formats the channel post with an escaped title", () => {
    expect(
      formatSlackAutoReviewPost({
        url: "https://github.com/acme/api/pull/12",
        label: "acme/api#12",
        author: "alice",
        title: "Use <T> & co",
      }),
    ).toBe(
      ":mag: New PR <https://github.com/acme/api/pull/12|acme/api#12> by alice: Use &lt;T&gt; &amp; co",
    );
  });
});
