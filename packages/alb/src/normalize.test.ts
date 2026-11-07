import { describe, expect, it } from 'vitest';
import {
  exportLinkedSkillChain,
  evaluateSkillChain,
  exportSkillPack,
  WORKFLOW_TEMPLATES,
} from './index.js';
import { normalizeSkill, normalizeSkillChain, normalizeWorkflowPorts } from './normalize.js';

describe('normalizeSkill', () => {
  it('fills omitted arrays so registry UI can read .length', () => {
    const skill = normalizeSkill({
      id: 's1',
      name: 'Broken',
      createdAt: 't',
      updatedAt: 't',
    });
    expect(skill.inputs).toEqual([]);
    expect(skill.outputs).toEqual([]);
    expect(skill.tags).toEqual([]);
    expect(skill.usageCount).toBe(0);
    expect(skill.inputs.length).toBe(0);
  });
});

describe('normalizeSkillChain', () => {
  it('fills omitted skills/links/evalCases', () => {
    const chain = normalizeSkillChain({
      id: 'c1',
      name: 'Broken chain',
      createdAt: 't',
      updatedAt: 't',
    });
    expect(chain.skills.length).toBe(0);
    expect(chain.links.length).toBe(0);
    expect(chain.evalCases.length).toBe(0);
    expect(chain.variables.length).toBe(0);
  });
});

describe('normalizeWorkflowPorts', () => {
  it('fills omitted node ports', () => {
    const wf = normalizeWorkflowPorts({
      id: 'w',
      name: 'W',
      version: '0.1.0',
      status: 'draft',
      environment: 'development',
      nodes: [
        {
          id: 'n1',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'Bare',
            nodeType: 'agent',
            category: 'agent',
            status: 'default',
            config: {},
          },
        },
      ],
      createdAt: 't',
      updatedAt: 't',
    } as never);
    expect(wf.nodes[0]?.data.inputs).toEqual([]);
    expect(wf.nodes[0]?.data.outputs).toEqual([]);
    expect(wf.edges).toEqual([]);
  });
});

describe('template skill-chain export', () => {
  it.each(WORKFLOW_TEMPLATES)('$id exports a chain the Skills tab can render', (template) => {
    const { chain, skills } = exportLinkedSkillChain(template.create());
    expect(chain.skills.length).toBeGreaterThan(0);
    expect(Array.isArray(chain.links)).toBe(true);
    expect(Array.isArray(chain.evalCases)).toBe(true);
    for (const skill of skills) {
      expect(Array.isArray(skill.inputs)).toBe(true);
      expect(Array.isArray(skill.outputs)).toBe(true);
      expect(Array.isArray(skill.tags)).toBe(true);
    }
  });

  it('evaluates and packs a chain that omitted evalCases', async () => {
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === 'research-agent')!;
    const { chain, skills } = exportLinkedSkillChain(template.create());
    const stripped = {
      ...chain,
      evalCases: undefined,
      variables: undefined,
    } as unknown as typeof chain;
    const suite = await evaluateSkillChain(stripped, skills);
    expect(suite.cases.length).toBeGreaterThan(0);
    expect(() =>
      exportSkillPack({ ...chain, evalCases: undefined } as unknown as typeof chain, skills),
    ).not.toThrow();
  });
});
