import { describe, expect, it } from 'vitest';
import {
  createEmptyWorkflow,
  createNode,
  createEdge,
  createResearchAgentTemplate,
  exportLinkedSkillChain,
  exportSkillPack,
  exportSkillPackBundle,
  importBundle,
  toSkillSlug,
  uniqueSlugs,
  portablePortKey,
  evaluateSkillChain,
  measureChainRun,
  applySkillConfiguration,
  executeSkillChain,
  assertionContext,
} from '../index.js';

describe('ids', () => {
  it('slugifies names', () => {
    expect(toSkillSlug('Research Agent Supervisor')).toBe('research-agent-supervisor');
    expect(uniqueSlugs(['Inc', 'Inc', 'Inc Group'])).toEqual(['inc', 'inc-2', 'inc-group']);
  });

  it('replaces opaque port ids with names', () => {
    expect(portablePortKey({ id: 'input', name: 'Input' })).toBe('input');
    expect(portablePortKey({ id: 'Ww7GGV', name: 'Output' })).toBe('output');
    expect(portablePortKey({ id: 'E5DV-v', name: 'Content' })).toBe('content');
  });
});

describe('skill packs', () => {
  it('exports slugs, eval cases, and Cursor SKILL.md files', () => {
    const wf = createResearchAgentTemplate();
    const { chain, skills } = exportLinkedSkillChain(wf);
    expect(chain.slug).toBe('research-agent-skill-chain');
    expect(chain.evalCases.length).toBeGreaterThan(0);
    expect(skills.every((s) => s.slug)).toBe(true);
    expect(skills.some((s) => s.instructions?.includes('thorough research'))).toBe(true);

    const pack = exportSkillPack(chain, skills);
    expect(pack.manifest.kind).toBe('alb.skill_pack');
    expect(pack.manifest.supervisorSlug).toMatch(/supervisor/);
    expect(pack.files['runtime/chain.json']).toContain('alb.skill_chain');
    expect(pack.files['eval/cases.json']).toContain('Happy path');
    const mdPath = Object.keys(pack.files).find((p) => p.endsWith('/SKILL.md') && p.includes('research'));
    expect(mdPath).toBeTruthy();
    expect(pack.files[mdPath!]).toMatch(/^---\nname:/);
    expect(pack.manifest.links.every((l) => !/[A-Z]/.test(l.source))).toBe(true);
    expect(
      pack.manifest.links.every((l) =>
        l.mappings.every((m) => !/[A-Z]/.test(m.from) && !/[A-Z]/.test(m.to)),
      ),
    ).toBe(true);
  });

  it('round-trips a pack bundle through importBundle', () => {
    const wf = createResearchAgentTemplate();
    const { chain, skills } = exportLinkedSkillChain(wf);
    const bundle = exportSkillPackBundle(chain, skills);
    expect(bundle.filename).toMatch(/\.skill-pack\.json$/);
    const result = importBundle(bundle.content);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('skill_chain');
    expect(result.chain?.supervisorSkillId).toBe(chain.supervisorSkillId);
    expect(result.skills?.some((s) => s.role === 'supervisor')).toBe(true);
  });
});

describe('chain effectiveness', () => {
  it('scores a successful supervisor run with member coverage', async () => {
    const wf = createEmptyWorkflow('Pipe');
    const input = createNode('input', { x: 0, y: 0 });
    const transform = createNode('transform', { x: 0, y: 80 }, 'Inc');
    transform.data.config = { expression: '{{input}}' };
    const output = createNode('output', { x: 0, y: 160 });
    wf.nodes = [input, transform, output];
    wf.edges = [createEdge(input.id, transform.id), createEdge(transform.id, output.id)];
    const { chain, skills } = exportLinkedSkillChain(wf);
    const run = await executeSkillChain(chain, skills, { input: { n: 1 } });
    expect(run.status).toBe('success');
    expect(run.chainId).toBe(chain.id);
    expect(run.skillInvocations.length).toBeGreaterThan(0);
    expect(run.effectiveness?.coverage).toBeGreaterThan(0);
    expect(run.effectiveness?.score).toBeGreaterThanOrEqual(50);
    const measured = measureChainRun(run, chain, skills);
    expect(measured.score).toBe(run.effectiveness?.score);
  });

  it('evaluates golden cases shipped on the chain', async () => {
    const wf = createResearchAgentTemplate();
    const { chain, skills } = exportLinkedSkillChain(wf);
    const suite = await evaluateSkillChain(chain, skills, {
      input: { message: 'What is an agent loop?' },
    });
    expect(suite.cases.length).toBeGreaterThan(0);
    expect(suite.passed).toBe(true);
    expect(suite.score).toBeGreaterThanOrEqual(50);
    expect(suite.cases[0]?.report.invocations.some((i) => i.role === 'member')).toBe(true);
  });

  it('fails an eval case when an assertion does not hold', async () => {
    const wf = createEmptyWorkflow('Pipe');
    const input = createNode('input', { x: 0, y: 0 });
    const transform = createNode('transform', { x: 0, y: 80 }, 'Inc');
    transform.data.config = { expression: '{{input}}' };
    const output = createNode('output', { x: 0, y: 160 });
    wf.nodes = [input, transform, output];
    wf.edges = [createEdge(input.id, transform.id), createEdge(transform.id, output.id)];
    const { chain, skills } = exportLinkedSkillChain(wf);
    const suite = await evaluateSkillChain(chain, skills, {
      cases: [
        {
          id: 'bad',
          name: 'Impossible',
          input: { n: 1 },
          expectStatus: 'success',
          assertions: [{ expression: 'status == "error"', message: 'should fail' }],
        },
      ],
    });
    expect(suite.passed).toBe(false);
    expect(suite.cases[0]?.failures.join(' ')).toMatch(/should fail/);
  });

  it('applies chain configuration overlays to member agent models', async () => {
    const wf = createResearchAgentTemplate();
    const { chain, skills } = exportLinkedSkillChain(wf);
    const member = skills.find((s) => s.name === 'Research Agent')!;
    const ref = chain.skills.find((r) => r.skillId === member.id)!;
    ref.configuration = { model: { provider: 'ollama', model: 'llama3' } };
    const overlaid = applySkillConfiguration(member, ref.configuration);
    const agent = overlaid.internalWorkflow?.nodes.find((n) => n.data.nodeType === 'agent');
    const model = agent?.data.config.model as { provider?: string; model?: string };
    expect(model.provider).toBe('ollama');
    expect(model.model).toBe('llama3');
  });

  it('treats an empty eval suite as failed', async () => {
    const wf = createEmptyWorkflow('Pipe');
    const input = createNode('input', { x: 0, y: 0 });
    const output = createNode('output', { x: 0, y: 80 });
    wf.nodes = [input, output];
    wf.edges = [createEdge(input.id, output.id)];
    const { chain, skills } = exportLinkedSkillChain(wf);
    const suite = await evaluateSkillChain(chain, skills, { cases: [] });
    expect(suite.passed).toBe(false);
    expect(suite.score).toBe(0);
    expect(suite.cases).toEqual([]);
  });

  it('keeps coverage within 0..1 when extra invocations appear', () => {
    const wf = createEmptyWorkflow('Pipe');
    const input = createNode('input', { x: 0, y: 0 });
    const output = createNode('output', { x: 0, y: 80 });
    wf.nodes = [input, output];
    wf.edges = [createEdge(input.id, output.id)];
    const { chain, skills } = exportLinkedSkillChain(wf);
    const run = {
      id: 'run',
      workflowId: wf.id,
      workflowVersion: wf.version,
      status: 'success' as const,
      environment: 'development' as const,
      traces: [],
      logs: [],
      skillInvocations: [
        {
          skillId: chain.skills[0]?.skillId ?? 'a',
          name: 'A',
          role: 'member' as const,
          status: 'success' as const,
          skipped: false,
          gatesEvaluated: 0,
          gatesPassed: 0,
        },
        {
          skillId: 'nested-outside-chain',
          name: 'Nested',
          role: 'member' as const,
          status: 'success' as const,
          skipped: false,
          gatesEvaluated: 0,
          gatesPassed: 0,
        },
      ],
    };
    const report = measureChainRun(run, chain, skills);
    expect(report.coverage).toBeLessThanOrEqual(1);
    expect(report.coverage).toBeGreaterThanOrEqual(0);
  });

  it('does not let workflow output shadow assertion status', () => {
    const ctx = assertionContext(
      {
        id: 'run',
        workflowId: 'wf',
        workflowVersion: '1',
        status: 'error',
        environment: 'development',
        traces: [],
        logs: [],
        skillInvocations: [],
        output: { status: 'success', coverage: 99 },
      },
      { coverage: 0.2, gateIntegrity: 1, budgetAdherence: 1, score: 10 },
    );
    expect(ctx.status).toBe('error');
    expect(ctx.coverage).toBe(0.2);
  });
});

describe('pack safety', () => {
  it('assigns unique file slugs when names collide', () => {
    const wf = createResearchAgentTemplate();
    const { chain, skills } = exportLinkedSkillChain(wf);
    const clone = {
      ...skills[0]!,
      id: `${skills[0]!.id}-dup`,
      slug: skills[0]!.slug,
      name: skills[0]!.name,
    };
    const pack = exportSkillPack(chain, [...skills, clone]);
    const mdFiles = Object.keys(pack.files).filter((p) => p.endsWith('/SKILL.md'));
    expect(mdFiles.length).toBe(skills.length + 1);
    expect(new Set(mdFiles).size).toBe(mdFiles.length);
  });

  it('strips secret variable defaults from pack runtime', () => {
    const wf = createResearchAgentTemplate();
    wf.variables.push({ name: 'API_KEY', secret: true, defaultValue: 'sk-live-secret' });
    const { chain, skills } = exportLinkedSkillChain(wf);
    const pack = exportSkillPack(chain, skills);
    expect(pack.files['runtime/chain.json']).not.toContain('sk-live-secret');
    expect(pack.files['README.md']).toContain('skills/<slug>/SKILL.md');
    expect(pack.files['README.md']).toContain('<slug>.skill-pack.json');
  });
});
