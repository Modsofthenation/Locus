import { nanoid } from 'nanoid';
import type { EvalCase, Workflow } from '../schema/index.js';

/** Derive a default happy-path eval case from workflow variables. */
export function suggestEvalCases(workflow: Workflow): EvalCase[] {
  const input: Record<string, unknown> = {};
  for (const variable of workflow.variables) {
    if (variable.secret || variable.defaultValue === undefined) continue;
    input[variable.name] = variable.defaultValue;
  }
  return [
    {
      id: nanoid(10),
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
