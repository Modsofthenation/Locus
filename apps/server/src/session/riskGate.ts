import {
  latestPullVerdict,
  latestWorkerVerdict,
  parseReviewSettings,
  reviewRiskGate,
  withRiskGate,
  type AgentSession,
  type ApprovalPolicy,
  type LocusConfig,
  type RiskGate,
} from "@locus/shared";

type SessionsSource = { loadSessions(): Promise<AgentSession[]> };

/**
 * Pull numbers on this session's repo whose latest review verdict is at or above the
 * configured risk (`review.requireApprovalAtRisk`).
 */
export function gatedPullNumbers(
  session: Pick<AgentSession, "repoId" | "repo">,
  sessions: AgentSession[],
  config: Pick<LocusConfig, "review">,
): number[] {
  const settings = parseReviewSettings(config.review);
  if (settings.requireApprovalAtRisk === "never") return [];
  if (!session.repoId && !session.repo?.url) return [];
  const numbers = new Set<number>();
  for (const row of sessions) {
    if (row.kind === "review" && row.pull?.number) numbers.add(row.pull.number);
  }
  const out: number[] = [];
  for (const number of numbers) {
    const latest = latestPullVerdict(sessions, {
      repoId: session.repoId,
      repoUrl: session.repo?.url,
      number,
    });
    if (reviewRiskGate(latest?.verdict, settings).gated) out.push(number);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Approval policy for a turn with the risk gate applied: `git_pr_merge` on a gated PR is
 * forced into `alwaysAsk` after autonomy, `autoAllow`, and sticky Always allow.
 */
export async function riskGatedPolicy(
  store: SessionsSource,
  session: AgentSession,
  config: LocusConfig,
  policy: ApprovalPolicy,
): Promise<ApprovalPolicy> {
  if (parseReviewSettings(config.review).requireApprovalAtRisk === "never") return policy;
  if (!session.repoId && !session.repo?.url) return policy;
  const sessions = await store.loadSessions().catch(() => [] as AgentSession[]);
  const pullNumbers = gatedPullNumbers(session, sessions, config);
  if (!pullNumbers.length) return policy;
  return withRiskGate(policy, {
    pullNumbers,
    sessionPull: Boolean(session.pull?.number && pullNumbers.includes(session.pull.number)),
  });
}

/** Gate for an HTTP merge of a linked repo's pull (Codebase Merge, `locus repo merge`). */
export function pullMergeGate(
  sessions: AgentSession[],
  config: Pick<LocusConfig, "review">,
  target: { repoId: string; repoUrl?: string; number: number },
): RiskGate {
  const latest = latestPullVerdict(sessions, target);
  return reviewRiskGate(latest?.verdict, parseReviewSettings(config.review), latest?.sessionId);
}

/** Gate for merging a parallel worker into its parent (Pick this one / Merge into parent). */
export function workerMergeGate(
  worker: AgentSession,
  sessions: AgentSession[],
  config: Pick<LocusConfig, "review">,
): RiskGate {
  const latest = latestWorkerVerdict(worker, sessions);
  return reviewRiskGate(latest?.verdict, parseReviewSettings(config.review), latest?.sessionId);
}

/** Thrown when a merge needs an explicit human approval; HTTP maps it to 409. */
export class RiskGateError extends Error {
  constructor(readonly gate: RiskGate) {
    super(gate.reason ?? "Merge needs your approval.");
    this.name = "RiskGateError";
  }
}
