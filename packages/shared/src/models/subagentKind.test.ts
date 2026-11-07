import { describe, expect, it } from "vitest";
import {
  parseSubagentKind,
  requestedDefaultSubagent,
  resolveSubagentKind,
  sessionDefaultSubagent,
  subagentKindFromPrompt,
  subagentSystemPrompt,
} from "./subagentKind.js";
import { turnUserPrompt } from "./compare.js";

describe("subagent kind", () => {
  it("parses known kinds and ignores junk", () => {
    expect(parseSubagentKind("Review")).toBe("review");
    expect(parseSubagentKind(" explore ")).toBe("explore");
    expect(parseSubagentKind(" implement ")).toBe("implement");
    expect(parseSubagentKind("writer")).toBeUndefined();
    expect(sessionDefaultSubagent({})).toBe("explore");
    expect(sessionDefaultSubagent({ defaultSubagent: "review" })).toBe("review");
  });

  it("picks the last kind mention from operator chat", () => {
    expect(subagentKindFromPrompt("use the review subagent to scan auth")).toBe("review");
    expect(subagentKindFromPrompt("spawn an explore sub-agent")).toBe("explore");
    expect(subagentKindFromPrompt("spawn an implement sub-agent")).toBe("implement");
    expect(subagentKindFromPrompt("subagent: review")).toBe("review");
    expect(subagentKindFromPrompt("use the review subagent, then the explore subagent")).toBe(
      "explore",
    );
    expect(subagentKindFromPrompt("review this PR and explore the repo")).toBeUndefined();
  });

  it("only persists explicit default requests", () => {
    expect(requestedDefaultSubagent("set the default subagent to review")).toBe("review");
    expect(requestedDefaultSubagent("default subagent is explore")).toBe("explore");
    expect(requestedDefaultSubagent("always use the review subagent")).toBe("review");
    expect(requestedDefaultSubagent("from now on use the explore sub-agent")).toBe("explore");
    expect(requestedDefaultSubagent("use the review subagent to scan auth")).toBeUndefined();
  });

  it("resolves tool kind, then this-turn chat, then the session default", () => {
    expect(
      resolveSubagentKind({
        toolKind: "explore",
        prompt: "use the review subagent",
        sessionDefault: "review",
      }),
    ).toBe("explore");
    expect(
      resolveSubagentKind({ prompt: "use the review subagent", sessionDefault: "explore" }),
    ).toBe("review");
    expect(
      resolveSubagentKind({
        prompt: turnUserPrompt([
          { role: "user", content: "use the review subagent to scan auth" },
          { role: "user", content: "also check the tests", steer: true },
        ]),
        sessionDefault: "explore",
      }),
    ).toBe("review");
    expect(resolveSubagentKind({ sessionDefault: "review" })).toBe("review");
    expect(resolveSubagentKind({})).toBe("explore");
  });

  it("builds a review-lens child prompt", () => {
    const review = subagentSystemPrompt("review", "apps/server");
    expect(review).toContain("reviewing code for bugs");
    expect(review).toContain("Stay inside: apps/server");
    expect(subagentSystemPrompt("explore")).toContain("bounded research or exploration");
    expect(subagentSystemPrompt("implement")).toContain("apply_patch");
    expect(subagentSystemPrompt("implement")).toContain("Do not git_push");
  });
});
