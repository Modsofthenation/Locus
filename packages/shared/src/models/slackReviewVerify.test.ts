import { describe, expect, it } from "vitest";
import { parseSlackReviewer, type SlackReviewComment } from "./slackReviewer.js";
import {
  applySlackVerification,
  buildSlackVerifyMessage,
  formatSlackVerifyNote,
  parseSlackVerifyResult,
  slackFindingsToVerify,
  slackReviewVerifyOutputTokens,
  slackVerifyHunk,
  slackVerifyWindow,
  SLACK_REVIEW_VERIFY_MAX,
} from "./slackReviewVerify.js";

const finding = (
  id: number,
  severity: SlackReviewComment["severity"],
  extra: Partial<SlackReviewComment> = {},
): SlackReviewComment => ({
  id,
  path: "src/a.ts",
  line: 3,
  severity,
  body: `Finding ${id}`,
  ...extra,
});

describe("verifyFindings config", () => {
  it("is on by default with the review's own model", () => {
    const row = parseSlackReviewer({ id: "r", channelId: "C1" })!;
    expect(row.verifyFindings).toBe(true);
    expect(row.verifyProviderId).toBeUndefined();
    expect(row.verifyModel).toBeUndefined();
  });

  it("keeps an explicit off and a trimmed second-opinion model", () => {
    const row = parseSlackReviewer({
      id: "r",
      channelId: "C1",
      verifyFindings: false,
      verifyProviderId: " openai ",
      verifyModel: " o4 ",
    })!;
    expect(row).toMatchObject({
      verifyFindings: false,
      verifyProviderId: "openai",
      verifyModel: "o4",
    });
  });
});

describe("slackFindingsToVerify", () => {
  it("takes blocker and major findings only, capped", () => {
    const rows = [
      finding(1, "blocker"),
      finding(2, "minor"),
      finding(3, "major"),
      finding(4, "nit"),
    ];
    expect(slackFindingsToVerify(rows).map((row) => row.id)).toEqual([1, 3]);
    const many = Array.from({ length: 15 }, (_, i) => finding(i + 1, "major"));
    expect(slackFindingsToVerify(many)).toHaveLength(SLACK_REVIEW_VERIFY_MAX);
  });

  it("keeps the output cap small", () => {
    expect(slackReviewVerifyOutputTokens(1)).toBe(450);
    expect(slackReviewVerifyOutputTokens(50)).toBe(2_000);
  });
});

describe("slackVerifyWindow", () => {
  const file = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

  it("numbers the lines around the finding and marks its line", () => {
    const window = slackVerifyWindow(file, 50, 2)!;
    expect(window).toMatchObject({ from: 48, to: 52 });
    expect(window.text.split("\n")).toEqual([
      "48  line 48",
      "49  line 49",
      "50> line 50",
      "51  line 51",
      "52  line 52",
    ]);
  });

  it("stops at the file's edges and refuses lines outside it", () => {
    expect(slackVerifyWindow(file, 1, 40)).toMatchObject({ from: 1, to: 41 });
    expect(slackVerifyWindow(file, 100, 40)).toMatchObject({ from: 60, to: 100 });
    expect(slackVerifyWindow(file, 101)).toBeUndefined();
    expect(slackVerifyWindow(file, 0)).toBeUndefined();
  });
});

describe("slackVerifyHunk", () => {
  const patch = [
    "@@ -1,3 +1,4 @@",
    " a",
    "-b",
    "+B",
    "+C",
    " d",
    "@@ -40,2 +41,2 @@",
    " x",
    "-y",
    "+Y",
  ].join("\n");

  it("returns the hunk that shows the line, marked", () => {
    expect(slackVerifyHunk(patch, 3)).toBe(["1  a", "  - b", "2+ B", "3>+ C", "4  d"].join("\n"));
    expect(slackVerifyHunk(patch, 42)).toContain("42>+ Y");
  });

  it("falls back to the nearest hunk, or nothing without a patch", () => {
    expect(slackVerifyHunk(patch, 30)).toContain("41  x");
    expect(slackVerifyHunk(undefined, 3)).toBeUndefined();
  });
});

describe("buildSlackVerifyMessage", () => {
  it("fences each claim and its code as untrusted data", () => {
    const text = buildSlackVerifyMessage(
      [
        { finding: finding(1, "major"), code: "3> danger()", source: "checkout" },
        { finding: finding(2, "blocker", { line: 0 }), code: "", source: "none" },
      ],
      { owner: "acme", repo: "api", number: 7, title: "Add B" },
    );
    expect(text).toContain("acme/api#7");
    expect(text).toContain("Finding id 1 [major] at src/a.ts:3");
    expect(text).toContain('source="finding-1"');
    expect(text).toContain('source="code-1"');
    expect(text).toContain("3> danger()");
    expect(text).toContain("the file at the PR head");
    expect(text).toContain("Code around it: not available");
    expect(text).toContain("Answer for ids 1, 2.");
    expect((text.match(/<untrusted-data kind="pr-text"/g) ?? []).length).toBe(3);
  });
});

describe("parseSlackVerifyResult", () => {
  it("reads confirmed, downgrade and reject, skipping bad rows", () => {
    const rows = parseSlackVerifyResult(
      'Sure. {"findings":[{"id":1,"status":"confirmed","quote":"a()"},{"id":2,"status":"downgrade","severity":"minor"},{"id":3,"status":"reject","quote":" if (x) return; "},{"id":3,"status":"confirmed"},{"id":4,"status":"maybe"},{"id":5,"status":"downgrade","severity":"huge"}]}',
    );
    expect(rows).toEqual([
      { id: 1, status: "confirmed", quote: "a()" },
      { id: 2, status: "downgrade", severity: "minor" },
      { id: 3, status: "reject", quote: "if (x) return;" },
    ]);
  });

  it("throws on a reply it can't use", () => {
    expect(() => parseSlackVerifyResult("no json here")).toThrow(/no JSON/);
    expect(() => parseSlackVerifyResult('{"verdict":"comment"}')).toThrow(/findings/);
    expect(() => parseSlackVerifyResult("{nope}")).toThrow(/valid JSON/);
  });
});

describe("applySlackVerification", () => {
  const rows = [
    finding(1, "blocker"),
    finding(2, "major"),
    finding(3, "major"),
    finding(4, "minor"),
  ];

  it("drops rejected findings, applies downgrades, and keeps the rest", () => {
    const out = applySlackVerification(
      rows,
      [1, 2, 3],
      [
        { id: 1, status: "downgrade", severity: "major" },
        { id: 2, status: "reject" },
        { id: 4, status: "reject" },
      ],
    );
    // #3 had no answer and stays; #4 wasn't sent, so its "reject" is ignored.
    expect(out.comments.map((row) => [row.id, row.severity])).toEqual([
      [1, "major"],
      [3, "major"],
      [4, "minor"],
    ]);
    expect(out.verification).toEqual({ checked: 3, rejected: { major: 1 }, downgraded: 1 });
  });

  it("treats a downgrade to the same or a higher severity as confirmed", () => {
    const out = applySlackVerification(
      rows,
      [2],
      [{ id: 2, status: "downgrade", severity: "blocker" }],
    );
    expect(out.comments[1]!.severity).toBe("major");
    expect(out.verification.downgraded).toBe(0);
  });
});

describe("formatSlackVerifyNote", () => {
  it("says what the check did", () => {
    expect(formatSlackVerifyNote({ checked: 3, rejected: { major: 1 }, downgraded: 0 })).toBe(
      "verified 3, dropped 1",
    );
    expect(formatSlackVerifyNote({ checked: 2, rejected: {}, downgraded: 1 })).toBe(
      "verified 2, downgraded 1",
    );
    expect(formatSlackVerifyNote({ checked: 2, rejected: {}, downgraded: 0, failed: true })).toBe(
      "couldn't verify findings, posted unchecked",
    );
  });
});
