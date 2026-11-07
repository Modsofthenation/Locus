import { executeSkillChain, type RunOptions } from '../execution/index.js';
import type { EvalCase, Skill, SkillChain, WorkflowRun } from '../schema/index.js';
import { assertionContext, evaluateAssertions, measureChainRun } from './measure.js';
import type { AssertionResult } from './measure.js';
import type { ChainEffectiveness } from '../schema/index.js';
import { normalizeSkill, normalizeSkillChain } from '../normalize.js';

export interface EvalCaseResult {
  caseId: string;
  name: string;
  passed: boolean;
  run: WorkflowRun;
  report: ChainEffectiveness;
  failures: string[];
  assertions: AssertionResult[];
}

export interface SkillChainEvalSuite {
  chainId: string;
  chainSlug?: string;
  passed: boolean;
  score: number;
  cases: EvalCaseResult[];
}

function defaultCases(chain: SkillChain): EvalCase[] {
  if (chain.evalCases?.length) return chain.evalCases;
  const input: Record<string, unknown> = {};
  for (const variable of chain.variables ?? []) {
    if (variable.secret || variable.defaultValue === undefined) continue;
    input[variable.name] = variable.defaultValue;
  }
  return [
    {
      id: 'default-happy-path',
      name: 'Happy path',
      input,
      expectStatus: 'success',
      assertions: [
        { expression: 'status == "success"', message: 'Chain should succeed' },
        { expression: 'coverage > 0', message: 'At least one member skill should run' },
      ],
    },
  ];
}

/** Run golden eval cases and score chain effectiveness. */
export async function evaluateSkillChain(
  chain: SkillChain,
  skills: Skill[],
  options: RunOptions & { cases?: EvalCase[] } = {},
): Promise<SkillChainEvalSuite> {
  const { cases: overrideCases, ...runOptions } = options;
  const safeChain = normalizeSkillChain(chain);
  const safeSkills = skills.map((skill) => normalizeSkill(skill));
  const cases = overrideCases ?? defaultCases(safeChain);
  const results: EvalCaseResult[] = [];

  for (const testCase of cases) {
    const run = await executeSkillChain(safeChain, safeSkills, {
      ...runOptions,
      input: { ...(runOptions.input ?? {}), ...testCase.input },
    });
    const preliminary = measureChainRun(run, safeChain, safeSkills);
    const assertions = evaluateAssertions(
      testCase.assertions,
      assertionContext(run, preliminary),
    );
    const assertionPassRate = assertions.length
      ? assertions.filter((a) => a.passed).length / assertions.length
      : 1;
    const report = measureChainRun(run, safeChain, safeSkills, assertionPassRate);
    run.effectiveness = report;

    const failures: string[] = [];
    if (testCase.expectStatus && run.status !== testCase.expectStatus) {
      failures.push(
        `expected status ${testCase.expectStatus}, got ${run.status}${run.error ? `: ${run.error}` : ''}`,
      );
    }
    for (const assertion of assertions) {
      if (!assertion.passed) {
        failures.push(assertion.message ?? `assertion failed: ${assertion.expression}`);
      }
    }

    results.push({
      caseId: testCase.id,
      name: testCase.name,
      passed: failures.length === 0,
      run,
      report,
      failures,
      assertions,
    });
  }

  const score =
    results.length === 0
      ? 0
      : Math.round(results.reduce((sum, r) => sum + r.report.score, 0) / results.length);

  return {
    chainId: safeChain.id,
    chainSlug: safeChain.slug,
    passed: results.length > 0 && results.every((r) => r.passed),
    score,
    cases: results,
  };
}
