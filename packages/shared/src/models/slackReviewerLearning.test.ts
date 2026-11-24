import { describe, expect, it } from "vitest";
import {
  buildSlackReviewDiscussion,
  buildSlackReviewRepoNotes,
  isLocusReviewComment,
  isSlackFullRereviewRequest,
  isSlackRereviewRequest,
  isSlackRetryRequest,
  isTransientReviewError,
  matchesDismissedFinding,
  mergeSlackRepoNotes,
  mergeSlackReviewResults,
  parseSlackReviewer,
  planSlackReviewParts,
  slackReviewCommentCap,
  slackReviewModuleKey,
  slackDiffAnchors,
  slackDismissReason,
  slackFindingSimilarity,
  slackForgeDismissals,
  slackPriorFindings,
  slackResolvedThreadPicker,
  type SlackRepoNote,
} from "./slackReviewer.js";

const budget = { ignorePaths: [], maxDiffChars: 2_500, maxFileChars: 2_400, contextLines: 2 };

describe("full re-review", () => {
  it("matches explicit commands, including a mention of the reviewer", () => {
    expect(isSlackFullRereviewRequest("full re-review", [])).toBe(true);
    expect(isSlackFullRereviewRequest("<@ULOCUS> please force re-review!", ["ULOCUS"])).toBe(true);
    expect(isSlackFullRereviewRequest("<@UOTHER> full re-review", ["ULOCUS"])).toBe(false);
    expect(isSlackFullRereviewRequest("re-review", [])).toBe(false);
    expect(isSlackFullRereviewRequest("Thanks for the full review", [])).toBe(false);
  });
});

describe("new reviewer settings", () => {
  it("defaults the new toggles", () => {
    const reviewer = parseSlackReviewer({ id: "r", channelId: "C1" })!;
    expect(reviewer).toMatchObject({
      prDiscussion: true,
      ciLogs: true,
      resolveFixedThreads: true,
      dismissOnPr: true,
      learnFromDismissals: true,
      splitLargePrs: false,
    });
    expect(
      parseSlackReviewer({ id: "r", channelId: "C1", splitLargePrs: true, ciLogs: false }),
    ).toMatchObject({ splitLargePrs: true, ciLogs: false });
  });
});

describe("retry", () => {
  it("matches retry words but not re-review requests or other words", () => {
    expect(isSlackRetryRequest("retry")).toBe(true);
    expect(isSlackRetryRequest("can you try again?")).toBe(true);
    expect(isSlackRetryRequest("run it again please")).toBe(true);
    expect(isSlackRetryRequest("retrying the build")).toBe(false);
    expect(isSlackRetryRequest("review again")).toBe(false);
    expect(isSlackRereviewRequest("review again")).toBe(true);
  });

  it("tells passing errors from lasting ones", () => {
    expect(isTransientReviewError("529 overloaded_error")).toBe(true);
    expect(isTransientReviewError("429 rate_limit_error")).toBe(true);
    expect(isTransientReviewError("fetch failed: ECONNRESET")).toBe(true);
    expect(isTransientReviewError("The operation was aborted due to timeout")).toBe(true);
    expect(isTransientReviewError("401 invalid x-api-key")).toBe(false);
    expect(isTransientReviewError("prompt is too long: 250000 tokens > 200000 maximum")).toBe(
      false,
    );
    expect(isTransientReviewError("model not found")).toBe(false);
  });
});

describe("dismissal matching", () => {
  const files = [
    {
      path: "src/a.ts",
      status: "modified" as const,
      patch: ["@@ -1,3 +1,4 @@", " const x = 1;", "+const token = readToken(req);", " d"].join(
        "\n",
      ),
    },
  ];

  it("follows the code line after it moves", () => {
    const anchors = slackDiffAnchors(files);
    expect(anchors("src/a.ts", 2)).toBe("const token = readToken(req);");
    expect(anchors("src/a.ts", 3)).toBeUndefined(); // "d" is too short to anchor on
    const [old] = slackPriorFindings(
      [{ path: "src/a.ts", line: 2, severity: "major", body: "Token read without a check" }],
      anchors,
    );
    expect(old!.anchor).toBe("const token = readToken(req);");
    // Edits above it moved the line from 2 to 40; same code, same severity, new wording.
    const moved = slackDiffAnchors([
      {
        path: "src/a.ts",
        status: "modified",
        patch: ["@@ -38,2 +38,3 @@", " x", " y", "+const token =   readToken(req);"].join("\n"),
      },
    ]);
    expect(
      matchesDismissedFinding(
        { path: "src/a.ts", line: 40, severity: "major", body: "Unchecked token" },
        [old!],
        moved,
      ),
    ).toBe(true);
  });

  it("matches similar wording nearby, not unrelated findings", () => {
    const old = {
      path: "src/a.ts",
      line: 10,
      severity: "minor" as const,
      body: "Retries 401 responses with no backoff between attempts",
    };
    expect(
      matchesDismissedFinding(
        {
          path: "src/a.ts",
          line: 14,
          severity: "major",
          body: "This retries 401 responses without any backoff between the attempts",
        },
        [old],
      ),
    ).toBe(true);
    expect(
      matchesDismissedFinding(
        { path: "src/a.ts", line: 14, severity: "minor", body: "SQL is built from user input" },
        [old],
      ),
    ).toBe(false);
    expect(matchesDismissedFinding({ ...old, path: "src/b.ts" }, [old])).toBe(false);
    expect(slackFindingSimilarity("a b", "a b")).toBe(0); // too few words to judge
  });
});

describe("PR discussion", () => {
  it("leaves out the reviewer's own comments and fences the rest", () => {
    expect(isLocusReviewComment("**#2 · minor**: Name the limit.")).toBe(true);
    expect(isLocusReviewComment("Looks fine.\n\n<sub>Automated review by Locus (x)</sub>")).toBe(
      true,
    );
    expect(isLocusReviewComment("I think **major** issue")).toBe(false);
    const text = buildSlackReviewDiscussion([
      { id: "1", body: "**#1 · major**: B is wrong", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "2",
        body: "Please add a test",
        author: "bob",
        path: "src/a.ts",
        line: 3,
        createdAt: "2026-01-01T00:01:00Z",
      },
    ]);
    expect(text).toContain("bob on src/a.ts:3: Please add a test");
    expect(text).not.toContain("B is wrong");
    expect(text).toContain("untrusted");
    expect(buildSlackReviewDiscussion([])).toBe("");
  });
});

describe("dismissals on the PR", () => {
  const findings = [
    { path: "src/a.ts", line: 2, severity: "major" as const, body: "B is wrong" },
    { path: "src/b.ts", line: 9, severity: "minor" as const, body: "Name the limit" },
  ];

  it("reads numbered dismissals and inline replies after the cursor only", () => {
    const found = slackForgeDismissals(
      [
        { id: "1", body: "won't fix #2", createdAt: "2026-01-02T00:00:00Z" },
        {
          id: "2",
          body: "false positive",
          path: "src/a.ts",
          line: 2,
          createdAt: "2026-01-02T00:01:00Z",
        },
        { id: "3", body: "won't fix #1", createdAt: "2025-12-31T00:00:00Z" }, // before the cursor
        { id: "4", body: "**#1 · major**: dismiss all", createdAt: "2026-01-02T00:02:00Z" }, // own
      ],
      findings,
      "2026-01-01T00:00:00Z",
    );
    expect(found.ids).toEqual([1, 2]);
    expect(found.reasons[1]).toBe("false positive");
    expect(found.newest).toBe("2026-01-02T00:02:00Z");
    expect(slackForgeDismissals([], findings, undefined)).toEqual({ ids: [], reasons: {} });
  });

  it("classifies why", () => {
    expect(slackDismissReason("#1 is a false positive")).toBe("false-positive");
    expect(slackDismissReason("that's by design")).toBe("by-design");
    expect(slackDismissReason("won't fix #2")).toBe("wont-fix");
  });

  it("picks only the reviewer's threads for resolved findings", () => {
    const pick = slackResolvedThreadPicker([findings[0]!]);
    expect(pick({ path: "src/a.ts", body: "**#1 · major**: B is wrong" })).toBe(true);
    expect(pick({ path: "src/a.ts", body: "B is wrong" })).toBe(false);
    expect(pick({ path: "src/b.ts", body: "**#2 · minor**: Name the limit" })).toBe(false);
  });
});

describe("repo notes", () => {
  const note = (body: string, path = "src/a.ts"): SlackRepoNote => ({
    path,
    severity: "minor",
    body,
    reason: "by-design",
    pr: "acme/api#1",
    at: "2026-01-01T00:00:00Z",
  });

  it("drops near-duplicates and caps the list", () => {
    const merged = mergeSlackRepoNotes(
      [note("Retries 401 responses with no backoff between attempts")],
      [note("Retries 401 responses with no backoff between the attempts")],
    );
    expect(merged).toHaveLength(1);
    const many = mergeSlackRepoNotes(
      [],
      Array.from({ length: 50 }, (_, i) => note(`finding number ${i}`, `src/${i}.ts`)),
    );
    expect(many).toHaveLength(40);
    expect(many.at(-1)!.path).toBe("src/49.ts");
  });

  it("puts notes on files the PR touches first", () => {
    const text = buildSlackReviewRepoNotes(
      [note("Old note in another file", "src/z.ts"), note("Note on a touched file", "src/a.ts")],
      ["src/a.ts"],
    );
    expect(text.indexOf("Note on a touched file")).toBeLessThan(
      text.indexOf("Old note in another file"),
    );
    expect(text).toContain("by design, acme/api#1");
    expect(buildSlackReviewRepoNotes([], [])).toBe("");
  });
});

describe("large PRs in parts", () => {
  const big = (name: string) =>
    ["@@ -1,1 +1,200 @@", ...Array.from({ length: 200 }, (_, i) => `+${name} ${i}`)].join("\n");

  it("splits files the budget leaves out into further parts", () => {
    const parts = planSlackReviewParts(
      [
        { path: "a.ts", status: "added", patch: big("a") },
        { path: "b.ts", status: "added", patch: big("b") },
        { path: "c.ts", status: "added", patch: big("c") },
      ],
      budget,
    );
    expect(parts.map((part) => part.reviewed)).toEqual([["a.ts"], ["b.ts"], ["c.ts"]]);
    expect(
      planSlackReviewParts(
        [
          { path: "a.ts", status: "added", patch: big("a") },
          { path: "b.ts", status: "added", patch: big("b") },
        ],
        budget,
        1,
      ),
    ).toHaveLength(1);
  });

  it("keeps a folder's files, and its tests, in the same part", () => {
    const small = (name: string) =>
      ["@@ -1,1 +1,40 @@", ...Array.from({ length: 40 }, (_, i) => `+${name} ${i}`)].join("\n");
    // Interleaved on purpose: forge order mixes the two folders.
    const parts = planSlackReviewParts(
      [
        { path: "src/auth/login.ts", status: "modified", patch: small("l") },
        { path: "src/billing/invoice.ts", status: "modified", patch: small("i") },
        { path: "src/auth/__tests__/login.test.ts", status: "modified", patch: small("t") },
        { path: "src/billing/tax.ts", status: "modified", patch: small("x") },
        { path: "src/auth/old.ts", status: "removed" },
      ],
      { ...budget, maxDiffChars: 1_200, maxFileChars: 1_200 },
    );
    expect(parts.map((part) => part.reviewed)).toEqual([
      ["src/auth/__tests__/login.test.ts", "src/auth/login.ts"],
      ["src/billing/invoice.ts", "src/billing/tax.ts"],
    ]);
    // Deleted files are noted once, in the first part.
    expect(parts[0]!.text).toContain("deleted: src/auth/old.ts");
    expect(parts[1]!.text).not.toContain("deleted:");
  });

  it("packs tightly when grouping would need too many parts, and lists the rest", () => {
    const parts = planSlackReviewParts(
      ["a", "b", "c", "d", "e"].map((name) => ({
        path: `${name}/x.ts`,
        status: "added" as const,
        patch: big(name),
      })),
      budget,
      2,
    );
    expect(parts).toHaveLength(2);
    expect(parts.flatMap((part) => part.reviewed)).toEqual(["a/x.ts", "b/x.ts"]);
    expect(parts[1]!.omitted).toEqual(["c/x.ts", "d/x.ts", "e/x.ts"]);
  });

  it("caps comments per part, up to the setting's bound", () => {
    expect(slackReviewCommentCap(8, 0)).toBe(8);
    expect(slackReviewCommentCap(8, 1)).toBe(8);
    expect(slackReviewCommentCap(8, 4)).toBe(32);
    expect(slackReviewCommentCap(8, 12)).toBe(50);
    expect(slackReviewCommentCap(0, 4)).toBe(0);
  });

  it("groups test folders with their parent folder", () => {
    expect(slackReviewModuleKey("src/auth/__tests__/login.test.ts")).toBe("src/auth");
    expect(slackReviewModuleKey("src/auth/test/login.ts")).toBe("src/auth");
    expect(slackReviewModuleKey("src/auth/login.ts")).toBe("src/auth");
    expect(slackReviewModuleKey("README.md")).toBe("");
  });

  it("merges results: strictest verdict, all comments, open wins", () => {
    const merged = mergeSlackReviewResults([
      {
        verdict: "comment",
        summary: "One.",
        comments: [{ path: "a.ts", line: 1, severity: "minor", body: "x" }],
        previous: [
          { id: 1, resolved: true },
          { id: 2, resolved: true },
        ],
      },
      {
        verdict: "request_changes",
        summary: "Part 2 of 2: Two.",
        comments: [{ path: "b.ts", line: 1, severity: "major", body: "y" }],
        previous: [{ id: 2, resolved: false }],
      },
    ]);
    expect(merged.verdict).toBe("request_changes");
    expect(merged.summary).toBe("Part 1 of 2: One.\nPart 2 of 2: Two.");
    expect(merged.comments).toHaveLength(2);
    expect(merged.previous).toEqual([
      { id: 1, resolved: true },
      { id: 2, resolved: false },
    ]);
  });
});
