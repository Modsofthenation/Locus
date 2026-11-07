import { describe, expect, it } from "vitest";
import {
  composeReviewPlaybook,
  CURSOR_REVIEW_FOLLOWUP_CARD,
  CURSOR_REVIEW_ROUTING_CARD,
  MAX_REPO_REVIEW_PROMPT,
  normalizeRepoReviewPrompt,
  STANDARD_REVIEW_LENS,
} from "./reviewPrompt.js";

describe("standard review lens", () => {
  it("covers zoom-out, architecture depth, and the thermo-nuclear quality bar", () => {
    expect(STANDARD_REVIEW_LENS).toMatch(/Locus\.md \/ CONTEXT\.md/);
    expect(STANDARD_REVIEW_LENS).toMatch(/Zoom out/);
    expect(STANDARD_REVIEW_LENS).toMatch(/deep modules/);
    expect(STANDARD_REVIEW_LENS).toMatch(/deletion test/);
    expect(STANDARD_REVIEW_LENS).toMatch(/1000 lines/);
    expect(STANDARD_REVIEW_LENS).toMatch(/code-judo/);
    expect(STANDARD_REVIEW_LENS).toMatch(/FAIL/);
    expect(STANDARD_REVIEW_LENS).toMatch(/untrusted-data/);
    expect(STANDARD_REVIEW_LENS).toMatch(/Do not spawn a zoom-out subagent/);
    expect(STANDARD_REVIEW_LENS).toMatch(/do not re-fetch them/);
    expect(STANDARD_REVIEW_LENS).toMatch(/same round/);
  });
});

describe("cursor review routing card", () => {
  it("points Cursor CLI at locus MCP git_pr tools", () => {
    expect(CURSOR_REVIEW_ROUTING_CARD).toMatch(/locus MCP server/);
    expect(CURSOR_REVIEW_ROUTING_CARD).toMatch(/git_pr_get/);
    expect(CURSOR_REVIEW_ROUTING_CARD).toMatch(/include=\["files"\]/);
    expect(CURSOR_REVIEW_ROUTING_CARD).toMatch(/Do not list MCP tools/);
    expect(CURSOR_REVIEW_ROUTING_CARD).toMatch(/REQUEST_CHANGES/);
    expect(CURSOR_REVIEW_ROUTING_CARD).toMatch(/own PR/);
    expect(CURSOR_REVIEW_ROUTING_CARD).toMatch(/Do not re-post/);
    expect(CURSOR_REVIEW_ROUTING_CARD).toMatch(/Fix with agent/);
    expect(CURSOR_REVIEW_FOLLOWUP_CARD).toMatch(/still a review session/);
    expect(CURSOR_REVIEW_FOLLOWUP_CARD).toMatch(/Fix with agent/);
    expect(CURSOR_REVIEW_FOLLOWUP_CARD).toMatch(/UI hides it/);
    expect(CURSOR_REVIEW_FOLLOWUP_CARD).toMatch(/only answering a follow-up/);
    expect(CURSOR_REVIEW_FOLLOWUP_CARD).toMatch(/Do not emit a new verdict unless you re-reviewed/);
  });
});

describe("composeReviewPlaybook", () => {
  it("returns undefined when both sides are empty", () => {
    expect(composeReviewPlaybook()).toBeUndefined();
    expect(composeReviewPlaybook("  ", "  ")).toBeUndefined();
  });

  it("keeps the recipe playbook when the repo has no extra prompt", () => {
    expect(composeReviewPlaybook("Read the diff.")).toBe("Read the diff.");
  });

  it("prefixes a repo-only prompt", () => {
    expect(composeReviewPlaybook(undefined, "No new public APIs.")).toBe(
      "Repo review prompt:\nNo new public APIs.",
    );
  });

  it("appends a repo prompt under the recipe playbook", () => {
    expect(composeReviewPlaybook("Read the diff.", "No new public APIs.")).toBe(
      "Read the diff.\n\nRepo review prompt:\nNo new public APIs.",
    );
  });

  it("does not duplicate a prompt already in the playbook", () => {
    const once = composeReviewPlaybook("Read the diff.", "Keep public APIs stable.");
    expect(composeReviewPlaybook(once, "Keep public APIs stable.")).toBe(once);
  });

  it("clips oversized repo prompts", () => {
    const huge = "x".repeat(MAX_REPO_REVIEW_PROMPT + 50);
    expect(normalizeRepoReviewPrompt(huge)).toBe("x".repeat(MAX_REPO_REVIEW_PROMPT));
    expect(composeReviewPlaybook("base", huge)).toBe(
      `base\n\nRepo review prompt:\n${"x".repeat(MAX_REPO_REVIEW_PROMPT)}`,
    );
  });
});
