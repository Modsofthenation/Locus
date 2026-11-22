import { describe, expect, it } from "vitest";
import { toolNeedsApproval } from "./tools.js";
import { approvalPolicyForTier } from "./autonomy.js";
import {
  latestPullVerdict,
  latestWorkerVerdict,
  parseReviewRiskThreshold,
  parseReviewSettings,
  reviewRiskGate,
  riskGateRefusal,
  verdictNeedsMergeApproval,
  withRiskGate,
} from "./reviewGate.js";

const verdictMsg = (json: string) => ({ role: "assistant", content: json });

function review(
  id: string,
  number: number,
  updatedAt: string,
  content: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    kind: "review",
    repoId: "r1",
    pull: { number },
    updatedAt,
    messages: [verdictMsg(content)],
    ...extra,
  };
}

describe("verdictNeedsMergeApproval", () => {
  const high = { verdict: "PASS" as const, risk: "high" as const };
  const low = { verdict: "PASS" as const, risk: "low" as const };
  const failLow = { verdict: "FAIL" as const, risk: "low" as const };

  it("gates high risk and FAIL at the default threshold", () => {
    expect(verdictNeedsMergeApproval(high)).toBe(true);
    expect(verdictNeedsMergeApproval(failLow)).toBe(true);
    expect(verdictNeedsMergeApproval(low)).toBe(false);
    expect(verdictNeedsMergeApproval(undefined)).toBe(false);
  });

  it("gates every verdict at low and none at never", () => {
    expect(verdictNeedsMergeApproval(low, "low")).toBe(true);
    expect(verdictNeedsMergeApproval(high, "never")).toBe(false);
  });

  it("parses thresholds with aliases and a high default", () => {
    expect(parseReviewRiskThreshold("medium")).toBe("high");
    expect(parseReviewRiskThreshold("off")).toBe("never");
    expect(parseReviewRiskThreshold("LOW")).toBe("low");
    expect(parseReviewRiskThreshold(undefined)).toBe("high");
    expect(parseReviewSettings({ ciFixMaxAttempts: 0 })).toEqual({
      requireApprovalAtRisk: "high",
      ciFixMaxAttempts: 2,
    });
  });
});

describe("latestPullVerdict", () => {
  it("uses the newest review session of that repo and PR with a verdict", () => {
    const sessions = [
      review("old", 7, "2026-01-01", '{"verdict":"FAIL","reasons":["bug"],"risk":"high"}'),
      review("new", 7, "2026-01-03", '{"verdict":"PASS","reasons":[],"risk":"low"}'),
      review("noverdict", 7, "2026-01-04", "still looking"),
      review("other-pr", 8, "2026-01-05", '{"verdict":"FAIL","reasons":[],"risk":"high"}'),
      review("archived", 7, "2026-01-06", '{"verdict":"FAIL","reasons":[],"risk":"high"}', {
        archived: true,
      }),
    ];
    expect(latestPullVerdict(sessions, { repoId: "r1", number: 7 })).toEqual({
      sessionId: "new",
      verdict: { verdict: "PASS", reasons: [], risk: "low" },
    });
    expect(latestPullVerdict(sessions, { repoId: "r2", number: 7 })).toBeUndefined();
  });

  it("matches by repo URL when there is no catalog id", () => {
    const sessions = [
      review("a", 3, "2026-01-01", '{"verdict":"PASS","reasons":[],"risk":"high"}', {
        repoId: undefined,
        repo: { url: "https://github.com/acme/app.git" },
      }),
    ];
    const got = latestPullVerdict(sessions, { repoUrl: "https://github.com/acme/app", number: 3 });
    expect(got?.verdict.risk).toBe("high");
  });

  it("falls back to a worker's own transcript verdict", () => {
    const worker = {
      id: "w",
      updatedAt: "x",
      messages: [verdictMsg('Done. {"verdict":"FAIL","reasons":["no tests"],"risk":"high"}')],
    };
    expect(latestWorkerVerdict(worker, [])?.verdict.reasons).toEqual(["no tests"]);
  });
});

describe("reviewRiskGate / withRiskGate", () => {
  it("explains the gate and builds a 409 body", () => {
    const gate = reviewRiskGate({ verdict: "FAIL", reasons: ["breaks login"], risk: "high" });
    expect(gate.gated).toBe(true);
    expect(gate.reason).toBe("Review FAIL (risk high): breaks login. Merge needs your approval.");
    expect(riskGateRefusal(gate).riskGate.threshold).toBe("high");
  });

  it("forces approval for git_pr_merge even in autonomous mode with a sticky allow", () => {
    const autonomous = approvalPolicyForTier("autonomous");
    const sticky = { ...autonomous, autoAllow: [...(autonomous.autoAllow ?? []), "git_pr_merge"] };
    expect(toolNeedsApproval("git_pr_merge", sticky, {})).toBe(false);
    const gated = withRiskGate(sticky, { pullNumbers: [7], sessionPull: true });
    expect(toolNeedsApproval("git_pr_merge", gated, {})).toBe(true);
  });

  it("scopes the ask to gated PR numbers when the session PR is not gated", () => {
    const policy = withRiskGate({ autoAllow: ["git_pr_merge"] }, { pullNumbers: [7] });
    expect(toolNeedsApproval("git_pr_merge", policy, { pull_number: 7 })).toBe(true);
    expect(toolNeedsApproval("git_pr_merge", policy, { pull_number: 8 })).toBe(false);
    expect(withRiskGate(policy, { pullNumbers: [] })).toBe(policy);
  });
});
