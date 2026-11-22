import { describe, expect, it } from "vitest";
import { approvalPolicyForTier, toolNeedsApproval, type AgentSession } from "@locus/shared";
import { gatedPullNumbers, riskGatedPolicy, workerMergeGate } from "./riskGate.js";

function session(patch: Partial<AgentSession>): AgentSession {
  return {
    id: "s",
    title: "t",
    os: "ubuntu",
    templateId: "t",
    providerId: "p",
    model: "m",
    status: "idle",
    messages: [],
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...patch,
  };
}

const reviewOf = (id: string, number: number, json: string) =>
  session({
    id,
    kind: "review",
    repoId: "r1",
    pull: { number, url: "", title: "", state: "open", headRef: "f", baseRef: "main" },
    messages: [{ id: "m", role: "assistant", content: json, createdAt: "2026-01-01" }],
  });

describe("riskGatedPolicy", () => {
  const coding = session({
    id: "agent",
    repoId: "r1",
    pull: { number: 7, url: "", title: "", state: "open", headRef: "f", baseRef: "main" },
  });
  const sessions = [
    coding,
    reviewOf("rv7", 7, '{"verdict":"FAIL","reasons":["x"],"risk":"high"}'),
    reviewOf("rv8", 8, '{"verdict":"PASS","reasons":[],"risk":"low"}'),
  ];
  const store = { loadSessions: async () => sessions };

  it("lists gated PRs on the session's repo", () => {
    expect(gatedPullNumbers(coding, sessions, {})).toEqual([7]);
    expect(
      gatedPullNumbers(coding, sessions, { review: { requireApprovalAtRisk: "low" } }),
    ).toEqual([7, 8]);
    expect(
      gatedPullNumbers(coding, sessions, { review: { requireApprovalAtRisk: "never" } }),
    ).toEqual([]);
  });

  it("autonomous mode still asks before git_pr_merge on a gated PR", async () => {
    const base = approvalPolicyForTier("autonomous");
    const policy = await riskGatedPolicy(store, coding, { review: {} } as never, {
      ...base,
      autoAllow: [...(base.autoAllow ?? []), "git_pr_merge"],
    });
    expect(toolNeedsApproval("git_pr_merge", policy, {})).toBe(true);
  });

  it("gates a worker merge on its transcript verdict", () => {
    const worker = session({
      id: "w",
      messages: [
        {
          id: "m",
          role: "assistant",
          content: '{"verdict":"PASS","reasons":["public API change"],"risk":"high"}',
          createdAt: "x",
        },
      ],
    });
    expect(workerMergeGate(worker, [], {}).gated).toBe(true);
    expect(workerMergeGate(session({ id: "clean" }), [], {}).gated).toBe(false);
  });
});
