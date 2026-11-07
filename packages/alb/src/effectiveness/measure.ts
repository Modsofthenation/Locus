import type {
  ChainEffectiveness,
  EvalAssertion,
  Skill,
  SkillChain,
  SkillInvocation,
  WorkflowRun,
} from '../schema/index.js';
import { evaluatePredicate } from '../expressions/index.js';

/** Stable marker so gate scoring does not depend on prose wording alone. */
export const SIDE_EFFECT_BLOCKED_CODE = 'SIDE_EFFECT_BLOCKED';
const SIDE_EFFECT_BLOCKED = new RegExp(SIDE_EFFECT_BLOCKED_CODE);

export interface AssertionResult {
  expression: string;
  message?: string;
  passed: boolean;
}

export function assertionContext(
  run: WorkflowRun,
  report: Pick<ChainEffectiveness, 'coverage' | 'gateIntegrity' | 'budgetAdherence' | 'score'>,
): Record<string, unknown> {
  const output =
    run.output && typeof run.output === 'object' && !Array.isArray(run.output)
      ? (run.output as Record<string, unknown>)
      : { value: run.output };
  return {
    ...output,
    status: run.status,
    coverage: report.coverage,
    gateIntegrity: report.gateIntegrity,
    budgetAdherence: report.budgetAdherence,
    score: report.score,
    durationMs: run.durationMs ?? 0,
    tokens: run.tokenUsage?.total ?? 0,
    output: run.output,
  };
}

export function evaluateAssertions(
  assertions: EvalAssertion[],
  ctx: Record<string, unknown>,
): AssertionResult[] {
  return assertions.map((assertion) => ({
    expression: assertion.expression,
    message: assertion.message,
    passed: evaluatePredicate(assertion.expression, ctx),
  }));
}

function invocationsFromRun(run: WorkflowRun, skills: Skill[]): SkillInvocation[] {
  if (run.skillInvocations.length) return run.skillInvocations;
  const byId = new Map(skills.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const invocations: SkillInvocation[] = [];
  for (const trace of run.traces) {
    const skillId = trace.skillId;
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);
    const skill = byId.get(skillId);
    invocations.push({
      skillId,
      skillSlug: trace.skillSlug ?? skill?.slug,
      name: skill?.name ?? skillId,
      role: skill?.role ?? 'member',
      status: trace.status,
      durationMs: trace.durationMs,
      tokenUsage: trace.aiDetails?.tokenUsage,
      skipped: false,
      gatesEvaluated: 0,
      gatesPassed: 0,
    });
  }
  return invocations;
}

/** Score a completed (or failed) chain run without re-executing it. */
export function measureChainRun(
  run: WorkflowRun,
  chain: SkillChain,
  skills: Skill[],
  assertionPassRate?: number,
): ChainEffectiveness {
  const supervisorId = chain.supervisorSkillId;
  const memberIds = new Set(
    (chain.skills ?? []).map((ref) => ref.skillId).filter((id) => id !== supervisorId),
  );
  const invocations = invocationsFromRun(run, skills);
  const ranMembers = new Set(
    invocations
      .filter((inv) => inv.role !== 'supervisor' && !inv.skipped && inv.status !== 'pending')
      .map((inv) => inv.skillId)
      .filter((id) => memberIds.has(id)),
  );
  const coverage = memberIds.size === 0 ? 1 : Math.min(1, ranMembers.size / memberIds.size);

  const blocked =
    SIDE_EFFECT_BLOCKED.test(run.error ?? '') ||
    run.traces.some((t) => SIDE_EFFECT_BLOCKED.test(t.error?.message ?? ''));
  const gateIntegrity = blocked ? 0 : 1;

  const policy = chain.executionPolicy;
  const duration = run.durationMs ?? 0;
  const tokens = run.tokenUsage?.total ?? 0;
  const timeOk = !policy?.maxExecutionTimeMs || duration <= policy.maxExecutionTimeMs;
  const tokenOk = !policy?.maxTokenBudget || tokens <= policy.maxTokenBudget;
  const budgetAdherence = timeOk && tokenOk ? 1 : timeOk || tokenOk ? 0.5 : 0;

  const success =
    run.status === 'success' ? 1 : run.status === 'waiting_approval' ? 0.5 : 0;

  const hasAssertions = assertionPassRate !== undefined;
  const successW = hasAssertions ? 0.4 : 0.45;
  const coverageW = hasAssertions ? 0.2 : 0.25;
  const gateW = 0.2;
  const budgetW = 0.1;
  const assertW = hasAssertions ? 0.1 : 0;
  const score = Math.round(
    100 *
      (successW * success +
        coverageW * coverage +
        gateW * gateIntegrity +
        budgetW * budgetAdherence +
        assertW * (assertionPassRate ?? 0)),
  );

  return {
    chainId: chain.id,
    chainSlug: chain.slug,
    runId: run.id,
    status: run.status,
    durationMs: run.durationMs,
    tokenUsage: run.tokenUsage,
    invocations,
    coverage,
    gateIntegrity,
    budgetAdherence,
    assertionPassRate,
    score,
  };
}
