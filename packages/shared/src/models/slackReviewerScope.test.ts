import { describe, expect, it } from "vitest";
import {
  buildSlackReviewConventions,
  buildSlackReviewPathPrompts,
  buildSlackReviewSystem,
  buildSlackReviewUserMessage,
  compactPullDiff,
  parseSlackRepoNotesKey,
  parseSlackReviewer,
  slackReviewConventionLine,
  slackReviewConventionsBranch,
  slackReviewerAuthorExcluded,
  slackReviewerBaseAllowed,
  slackReviewerRequesterAllowed,
  slackReviewOptOut,
  slackReviewPathPrompts,
  slackReviewProposeSupported,
  SLACK_REVIEW_CONVENTIONS_HEADING,
  SLACK_REVIEWER_PATH_PROMPT_MAX,
  SLACK_REVIEWER_PATH_PROMPTS_MAX,
  type SlackRepoNote,
} from "./slackReviewer.js";
import type { AgentSkill } from "./skill.js";

const base = (raw: Record<string, unknown> = {}) =>
  parseSlackReviewer({ id: "r", channelId: "C1", ...raw })!;

describe("opt-out and scoping settings", () => {
  it("parses defaults and cleans values", () => {
    const reviewer = base();
    expect(reviewer.skipLabels).toEqual(["no-review", "skip-review"]);
    expect(reviewer.baseBranches).toEqual([]);
    expect(reviewer.allowedRequesters).toEqual([]);
    expect(reviewer.pathPrompts).toEqual([]);

    const custom = base({
      skipLabels: [],
      baseBranches: [" main ", "release/*"],
      allowedRequesters: ["u0123abcd", "<@U0456EFGH|bob>", "not an id", "U0123ABCD"],
      pathPrompts: [
        { glob: " migrations/** ", prompt: " Check locks. " },
        { glob: "", prompt: "no glob" },
        { glob: "a/**", prompt: "" },
        { glob: "big/**", prompt: "x".repeat(SLACK_REVIEWER_PATH_PROMPT_MAX + 50) },
      ],
    });
    expect(custom.skipLabels).toEqual([]);
    expect(custom.baseBranches).toEqual(["main", "release/*"]);
    expect(custom.allowedRequesters).toEqual(["U0123ABCD", "U0456EFGH"]);
    expect(custom.pathPrompts[0]).toEqual({ glob: "migrations/**", prompt: "Check locks." });
    expect(custom.pathPrompts).toHaveLength(2);
    expect(custom.pathPrompts[1]!.prompt).toHaveLength(SLACK_REVIEWER_PATH_PROMPT_MAX);

    const many = base({
      pathPrompts: Array.from({ length: 30 }, (_, i) => ({ glob: `d${i}/**`, prompt: "p" })),
    });
    expect(many.pathPrompts).toHaveLength(SLACK_REVIEWER_PATH_PROMPTS_MAX);
  });

  it("skips on a skip label (any case) or a title marker", () => {
    const reviewer = base();
    expect(slackReviewOptOut(reviewer, { title: "Add B", labels: ["bug"] })).toBeUndefined();
    expect(slackReviewOptOut(reviewer, { title: "Add B", labels: ["No-Review"] })).toBe(
      "it has the `No-Review` label",
    );
    expect(slackReviewOptOut(reviewer, { title: "[skip review] Bump deps" })).toBe(
      "its title says [skip review]",
    );
    expect(slackReviewOptOut(reviewer, { title: "WIP [No Review]" })).toContain("[No Review]");
    expect(slackReviewOptOut(reviewer, { title: "Review the skip logic" })).toBeUndefined();
    // No labels configured: labels don't opt out, the title marker still does.
    const none = base({ skipLabels: [] });
    expect(slackReviewOptOut(none, { title: "x", labels: ["no-review"] })).toBeUndefined();
    expect(slackReviewOptOut(none, { title: "x [no-review]" })).toBeDefined();
  });

  it("filters by base branch glob", () => {
    expect(slackReviewerBaseAllowed(base(), "anything")).toBe(true);
    const reviewer = base({ baseBranches: ["main", "release/*"] });
    expect(slackReviewerBaseAllowed(reviewer, "main")).toBe(true);
    expect(slackReviewerBaseAllowed(reviewer, "refs/heads/main")).toBe(true);
    expect(slackReviewerBaseAllowed(reviewer, "release/1.2")).toBe(true);
    expect(slackReviewerBaseAllowed(reviewer, "release/1.2/hotfix")).toBe(false);
    expect(slackReviewerBaseAllowed(reviewer, "develop")).toBe(false);
    expect(slackReviewerBaseAllowed(base({ baseBranches: ["release/**"] }), "release/1/x")).toBe(
      true,
    );
  });

  it("lets anyone ask with an empty list, otherwise only listed members", () => {
    expect(slackReviewerRequesterAllowed(base(), undefined)).toBe(true);
    const reviewer = base({ allowedRequesters: ["U0123ABCD"] });
    expect(slackReviewerRequesterAllowed(reviewer, "U0123ABCD")).toBe(true);
    expect(slackReviewerRequesterAllowed(reviewer, "U0999ZZZZ")).toBe(false);
    expect(slackReviewerRequesterAllowed(reviewer, undefined)).toBe(false);
  });

  it("parses excluded users and never lets them ask, even when also allowed", () => {
    expect(base().excludedUsers).toEqual([]);
    const reviewer = base({
      excludedUsers: ["u0123abcd", "<@U0456EFGH|bob>", "nope", "U0123ABCD"],
    });
    expect(reviewer.excludedUsers).toEqual(["U0123ABCD", "U0456EFGH"]);
    expect(slackReviewerRequesterAllowed(reviewer, "U0123ABCD")).toBe(false);
    expect(slackReviewerRequesterAllowed(reviewer, "u0456efgh")).toBe(false);
    expect(slackReviewerRequesterAllowed(reviewer, "U0999ZZZZ")).toBe(true);
    expect(slackReviewerRequesterAllowed(reviewer, undefined)).toBe(true);
    const both = base({ allowedRequesters: ["U0123ABCD"], excludedUsers: ["U0123ABCD"] });
    expect(slackReviewerRequesterAllowed(both, "U0123ABCD")).toBe(false);
  });

  it("excludes PR authors mapped to an excluded Slack member", () => {
    const reviewer = base({
      excludedUsers: ["U0123ABCD"],
      authorSlackIds: { alice: "U0123ABCD", bob: "U0456EFGH" },
    });
    expect(slackReviewerAuthorExcluded(reviewer, "Alice")).toBe(true);
    expect(slackReviewerAuthorExcluded(reviewer, "@alice")).toBe(true);
    expect(slackReviewerAuthorExcluded(reviewer, "bob")).toBe(false);
    expect(slackReviewerAuthorExcluded(reviewer, "carol")).toBe(false);
    expect(slackReviewerAuthorExcluded(reviewer, undefined)).toBe(false);
    expect(
      slackReviewerAuthorExcluded(base({ authorSlackIds: { alice: "U0123ABCD" } }), "alice"),
    ).toBe(false);
  });
});

describe("path prompts", () => {
  const skills: AgentSkill[] = [
    { id: "s1", name: "sql", title: "SQL", hint: "", body: "Use bind params." },
    { id: "s2", name: "house", title: "House", hint: "", body: "House rules." },
  ];

  it("matches changed files after the ignore list, in config order", () => {
    const reviewer = base({
      ignorePaths: ["migrations/generated/**"],
      pathPrompts: [
        { glob: "migrations/**", prompt: "Check locks." },
        { glob: "*.sql", prompt: "Check indexes." },
        { glob: "web/**", prompt: "Unused." },
      ],
    });
    expect(slackReviewPathPrompts(reviewer, ["src/a.ts"])).toEqual([]);
    expect(
      slackReviewPathPrompts(reviewer, ["migrations/001.sql"]).map((row) => row.prompt),
    ).toEqual(["Check locks.", "Check indexes."]);
    // Only an ignored file matches: nothing is sent.
    expect(slackReviewPathPrompts(reviewer, ["migrations/generated/x.ts"])).toEqual([]);
    expect(slackReviewPathPrompts(reviewer, ["package-lock.json"])).toEqual([]);
  });

  it("goes in the user message, unfenced, and leaves the system prompt alone", () => {
    const reviewer = base({
      prompt: "Follow /house.",
      pathPrompts: [{ glob: "migrations/**", prompt: "Check locks. Follow /sql and /house." }],
    });
    const files = [
      { path: "migrations/001.sql", status: "added" as const, patch: "@@ -0,0 +1 @@\n+x" },
    ];
    const text = buildSlackReviewPathPrompts(
      slackReviewPathPrompts(reviewer, ["migrations/001.sql"]),
      {
        skills,
        reviewerPrompt: reviewer.prompt,
      },
    );
    expect(text).toContain(
      "Extra instructions for files matching `migrations/**`: Check locks. Follow /sql and /house.",
    );
    // /sql is expanded here; /house is already in the system prompt.
    expect(text).toContain("### /sql: SQL\nUse bind params.");
    expect(text).not.toContain("House rules.");

    const pull = {
      owner: "acme",
      repo: "api",
      number: 1,
      title: "t",
      baseRef: "main",
      headRef: "f",
    };
    const diff = compactPullDiff(files, reviewer);
    const user = buildSlackReviewUserMessage(pull, diff, { pathPrompts: text });
    expect(user).toContain("Extra instructions for files matching `migrations/**`");
    const instructions = user.indexOf("Extra instructions");
    // Not inside a fence: every fence opened before it is closed before it, and the diff follows.
    const before = user.slice(0, instructions);
    expect(before.split("<untrusted-data").length).toBe(before.split("</untrusted-data>").length);
    expect(user.indexOf('source="diff"', instructions)).toBeGreaterThan(instructions);
    const system = buildSlackReviewSystem(reviewer, skills);
    const without: typeof reviewer = { ...reviewer, pathPrompts: [] };
    expect(system).toBe(buildSlackReviewSystem(without, skills));
    expect(system).not.toContain("Check locks");
    expect(buildSlackReviewPathPrompts([])).toBe("");
  });
});

describe("REVIEW.md conventions", () => {
  const notes: SlackRepoNote[] = [
    {
      path: "src/http/retry.ts",
      severity: "nit",
      body: "Name the retry limit. A constant reads better than a bare 3.",
      reason: "wont-fix",
      pr: "acme/api#482",
      at: "2026-11-01T00:00:00Z",
    },
    {
      path: "src/auth/refresh.ts",
      severity: "major",
      body: 'Refresh runs after logout clears the "session".',
      reason: "false-positive",
      pr: "acme/api#490",
      at: "2026-11-02T00:00:00Z",
    },
  ];

  it("turns a note into a rule-like bullet", () => {
    expect(slackReviewConventionLine(notes[0]!)).toBe(
      '- `src/http/retry.ts`: don\'t raise "Name the retry limit" again. The team accepted it (acme/api#482).',
    );
    expect(slackReviewConventionLine(notes[1]!)).toBe(
      "- `src/auth/refresh.ts`: don't flag \"Refresh runs after logout clears the 'session'\". It was a false positive (acme/api#490).",
    );
    expect(slackReviewConventionLine({ ...notes[0]!, reason: "by-design" })).toContain(
      "This is intended",
    );
  });

  it("creates the file, appends to existing text, and is idempotent", () => {
    const fresh = buildSlackReviewConventions(notes, undefined);
    expect(fresh.startsWith("# Review guidelines\n\n## Conventions learned")).toBe(true);
    expect(fresh.indexOf("src/auth")).toBeLessThan(fresh.indexOf("src/http"));

    const existing = "# Reviewing\n\nKeep PRs small.\n\n## Style\n\nUse tabs.\n";
    const once = buildSlackReviewConventions(notes, existing);
    expect(once.startsWith(existing.trimEnd())).toBe(true);
    expect(once).toContain(SLACK_REVIEW_CONVENTIONS_HEADING);
    expect(buildSlackReviewConventions(notes, once)).toBe(once);

    // A later run adds new bullets to the same section and keeps what follows it.
    const withTail = `${once}\n## Later\n\nMore text.\n`;
    const more: SlackRepoNote = { ...notes[0]!, path: "src/db.ts", body: "Use a transaction." };
    const twice = buildSlackReviewConventions([...notes, more], withTail);
    expect(twice.match(new RegExp(SLACK_REVIEW_CONVENTIONS_HEADING, "g"))).toHaveLength(1);
    expect(twice).toContain("`src/db.ts`");
    expect(twice).toContain("## Later\n\nMore text.");
    expect(twice.indexOf("`src/db.ts`")).toBeLessThan(twice.indexOf("## Later"));
    expect(buildSlackReviewConventions([...notes, more], twice)).toBe(twice);
  });

  it("names a free branch and parses repo keys", () => {
    const day = new Date("2026-11-22T10:00:00Z");
    expect(slackReviewConventionsBranch(day)).toBe("locus/review-conventions-2026-11-22");
    expect(
      slackReviewConventionsBranch(day, [
        "locus/review-conventions-2026-11-22",
        "locus/review-conventions-2026-11-22-2",
      ]),
    ).toBe("locus/review-conventions-2026-11-22-3");
    expect(parseSlackRepoNotesKey("gitlab.com/group/sub/proj")).toEqual({
      host: "gitlab.com",
      owner: "group/sub",
      repo: "proj",
      repoUrl: "https://gitlab.com/group/sub/proj",
    });
    expect(parseSlackRepoNotesKey("github.com/acme")).toBeUndefined();
    expect(slackReviewProposeSupported("github")).toBe(true);
    expect(slackReviewProposeSupported("gitlab")).toBe(true);
    expect(slackReviewProposeSupported("bitbucket")).toBe(false);
    expect(slackReviewProposeSupported("gitea")).toBe(false);
  });
});
