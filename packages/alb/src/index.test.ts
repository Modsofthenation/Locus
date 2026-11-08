import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  createEmptyWorkflow,
  createNode,
  createEdge,
  createResearchAgentTemplate,
  validateWorkflow,
  executeWorkflow,
  resumeWorkflow,
  hashScriptSource,
  interpolate,
  evaluatePredicate,
  extractReferences,
  previewExpression,
  detectSkillBoundary,
  createSkillFromBoundary,
  exportLinkedSkillChain,
  exportWorkflow,
  importBundle,
  WORKFLOW_TEMPLATES,
  autoLayoutWorkflow,
  resolveVersion,
  resolveSkillRef,
  toCaretRange,
  isValidVersionRange,
  evaluateSchemaGate,
  evaluatePolicyGate,
  findUngatedSideEffects,
  exportSkillChain,
  executeSkillChain,
  evaluateStructuredOutput,
  assertAgentToolAllowed,
  resolveHttpUrl,
  replayGateTrace,
  runPinnedScript,
  schemaHasConstraints,
  DEFAULT_EXECUTION_LIMITS,
  WorkflowSchema,
} from './index.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    return new Response(JSON.stringify({ ok: true, url }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('WorkflowSchema', () => {
  it('fills default execution limits when omitted', () => {
    const wf = WorkflowSchema.parse({
      id: 'w',
      name: 'W',
      createdAt: 't',
      updatedAt: 't',
    });
    expect(wf.limits).toEqual(DEFAULT_EXECUTION_LIMITS);
  });
});

describe('expressions', () => {
  it('interpolates templates', () => {
    expect(interpolate('Hello {{user.name}}', { user: { name: 'Ada' } })).toBe('Hello Ada');
  });

  it('extracts references', () => {
    expect(extractReferences('{{a}} and {{b.c}}')).toEqual(['a', 'b.c']);
  });

  it('evaluates predicates', () => {
    expect(evaluatePredicate('score >= 0.7', { score: 0.9 })).toBe(true);
    expect(evaluatePredicate('status == "ok"', { status: 'ok' })).toBe(true);
    expect(evaluatePredicate('!flag', { flag: false })).toBe(true);
  });

  it('previews expressions', () => {
    const result = previewExpression('{{x}}', { x: 1 });
    expect(result.ok).toBe(true);
    expect(result.result).toBe('1');
  });
});

describe('validation', () => {
  it('warns on empty workflow', () => {
    const wf = createEmptyWorkflow();
    const issues = validateWorkflow(wf);
    expect(issues.some((i) => i.code === 'EMPTY_WORKFLOW')).toBe(true);
  });

  it('flags missing model on agent', () => {
    const wf = createEmptyWorkflow();
    const agent = createNode('agent', { x: 0, y: 0 });
    agent.data.config = { model: { provider: 'openai' } };
    wf.nodes = [agent];
    const issues = validateWorkflow(wf);
    expect(issues.some((i) => i.code === 'MISSING_MODEL')).toBe(true);
  });

  it('validates research template without hard errors', () => {
    const wf = createResearchAgentTemplate();
    const errors = validateWorkflow(wf).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });
});

describe('execution', () => {
  it('runs a simple input → transform → output workflow', async () => {
    const wf = createEmptyWorkflow('Simple');
    const input = createNode('input', { x: 0, y: 0 });
    const transform = createNode('transform', { x: 0, y: 100 });
    transform.data.config = { expression: 'Hello {{input.message}}' };
    const output = createNode('output', { x: 0, y: 200 });
    wf.nodes = [input, transform, output];
    wf.edges = [createEdge(input.id, transform.id), createEdge(transform.id, output.id)];

    const run = await executeWorkflow(wf, { input: { message: 'World' } });
    expect(run.status).toBe('success');
    expect(run.traces).toHaveLength(3);
  });

  it('runs the research agent template in mock mode', async () => {
    const wf = createResearchAgentTemplate();
    const run = await executeWorkflow(wf, {
      input: { message: 'What is an agent loop?' },
    });
    expect(run.status).toBe('success');
    expect(run.tokenUsage?.total).toBeGreaterThan(0);
    expect(run.traces.some((t) => t.nodeId === wf.nodes[1]!.id)).toBe(true);
  });

  it('rejects invalid workflows before running', async () => {
    const wf = createEmptyWorkflow();
    const agent = createNode('agent', { x: 0, y: 0 });
    agent.data.config = {};
    wf.nodes = [agent];
    const run = await executeWorkflow(wf);
    expect(run.status).toBe('error');
    expect(run.error).toContain('Validation failed');
  });
});

describe('skills', () => {
  it('detects skill boundaries and creates a skill', () => {
    const wf = createResearchAgentTemplate();
    const research = wf.nodes.find((n) => n.data.label === 'Research Agent')!;
    const evaluate = wf.nodes.find((n) => n.data.label === 'Evaluate Research')!;
    const proposal = detectSkillBoundary(wf, [research.id, evaluate.id], 'Research+Eval');
    expect(proposal.internalNodeIds).toHaveLength(2);
    const skill = createSkillFromBoundary(wf, proposal);
    expect(skill.name).toBe('Research+Eval');
    expect(skill.internalWorkflow?.nodes.some((n) => n.data.nodeType === 'input')).toBe(true);
    expect(skill.internalWorkflow?.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('exports a linked skill chain', () => {
    const wf = createResearchAgentTemplate();
    const { chain, skills } = exportLinkedSkillChain(wf);
    expect(skills.length).toBeGreaterThanOrEqual(2);
    const supervisor = skills.find((s) => s.role === 'supervisor');
    expect(chain.links.some((l) => l.source === supervisor?.id)).toBe(true);
  });

  it('exports a supervisor skill as the chain entry point', () => {
    const wf = createResearchAgentTemplate();
    const { chain, skills } = exportLinkedSkillChain(wf);
    const supervisor = skills.find((s) => s.role === 'supervisor');
    expect(supervisor).toBeTruthy();
    expect(chain.supervisorSkillId).toBe(supervisor!.id);
    expect(chain.skills[0]?.skillId).toBe(supervisor!.id);
    expect(supervisor!.gates).toEqual([]);
    expect(supervisor!.scripts).toEqual([]);
    expect(supervisor!.privilegedTools).toEqual([]);
    const invoked = supervisor!.internalWorkflow?.nodes.filter(
      (n) => n.data.nodeType === 'published_skill',
    );
    const members = skills.filter((s) => s.role !== 'supervisor');
    expect(invoked).toHaveLength(members.length);
    expect(
      invoked?.every((n) => members.some((m) => m.id === n.data.config.skillId)),
    ).toBe(true);
    const graph = supervisor!.internalWorkflow!;
    expect(
      graph.edges.some((e) => (e.sourceHandle ?? e.label) === 'insufficient'),
    ).toBe(true);
    expect(
      graph.edges.some((e) => (e.sourceHandle ?? e.label) === 'sufficient'),
    ).toBe(true);
    const bundle = exportSkillChain(chain, skills);
    const result = importBundle(bundle.content);
    expect(result.ok).toBe(true);
    expect(result.chain?.supervisorSkillId).toBe(supervisor!.id);
  });

  it('runs a chain through the supervisor skill', async () => {
    const wf = createEmptyWorkflow('Pipe');
    const input = createNode('input', { x: 0, y: 0 });
    const transform = createNode('transform', { x: 0, y: 80 }, 'Inc');
    transform.data.config = { expression: '{{input}}' };
    const output = createNode('output', { x: 0, y: 160 });
    wf.nodes = [input, transform, output];
    wf.edges = [createEdge(input.id, transform.id), createEdge(transform.id, output.id)];
    const { chain, skills } = exportLinkedSkillChain(wf);
    const supervisor = skills.find((s) => s.role === 'supervisor')!;
    const memberNodes = supervisor.internalWorkflow!.nodes.filter(
      (n) => n.data.nodeType === 'published_skill',
    );
    const run = await executeSkillChain(chain, skills, { input: { n: 1 } });
    expect(run.status).toBe('success');
    expect(
      memberNodes.some((n) => run.traces.some((t) => t.nodeId === n.id && t.status === 'success')),
    ).toBe(true);
  });

  it('rejects a chain whose supervisor does not invoke its members', () => {
    const wf = createResearchAgentTemplate();
    const { chain, skills } = exportLinkedSkillChain(wf);
    const supervisor = skills.find((s) => s.role === 'supervisor')!;
    supervisor.internalWorkflow = {
      ...supervisor.internalWorkflow!,
      nodes: supervisor.internalWorkflow!.nodes.filter((n) => n.data.nodeType !== 'published_skill'),
      edges: [],
    };
    const bundle = exportSkillChain(chain, skills);
    const result = importBundle(bundle.content);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/supervisor/);
  });

  it('rejects a chain bundle that hides an extra skill', () => {
    const wf = createResearchAgentTemplate();
    const { chain, skills } = exportLinkedSkillChain(wf);
    const extra = {
      ...skills.find((s) => s.role !== 'supervisor')!,
      id: 'hidden-skill',
      name: 'Hidden',
    };
    const result = importBundle(
      JSON.stringify({ kind: 'alb.skill_chain', version: 1, chain, skills: [...skills, extra] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/not listed on the chain/);
  });

  it('runs a gated privileged member through the supervisor pass edge', async () => {
    const wf = createEmptyWorkflow('GatedHttp');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('schema_gate', { x: 0, y: 80 });
    gate.data.config = {
      jsonSchema: JSON.stringify({ type: 'object', required: ['action'] }),
    };
    const http = createNode('http_request', { x: 0, y: 160 }, 'Publish');
    const output = createNode('output', { x: 0, y: 240 });
    wf.nodes = [input, gate, http, output];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, http.id, { sourceHandle: 'pass', kind: 'conditional', label: 'pass' }),
      createEdge(http.id, output.id),
    ];
    const { chain, skills } = exportLinkedSkillChain(wf);
    const run = await executeSkillChain(chain, skills, { input: { action: 'publish' } });
    expect(run.status).toBe('success');
    const httpSkill = skills.find((s) => s.name === 'Publish');
    const httpNode = skills
      .find((s) => s.role === 'supervisor')
      ?.internalWorkflow?.nodes.find((n) => n.data.config.skillId === httpSkill?.id);
    expect(httpNode).toBeTruthy();
    expect(run.traces.some((t) => t.nodeId === httpNode?.id && t.status === 'success')).toBe(true);
  });
});

describe('branching edges', () => {
  it('activates sufficient evaluator handles', async () => {
    const { isEdgeActive } = await import('./execution/index');
    expect(
      isEdgeActive({ sourceHandle: 'sufficient' }, 'evaluator', {
        sufficient: true,
        insufficient: false,
      }),
    ).toBe(true);
    expect(
      isEdgeActive({ sourceHandle: 'insufficient' }, 'evaluator', {
        sufficient: true,
        insufficient: false,
      }),
    ).toBe(false);
  });
});

describe('import/export', () => {
  it('round-trips a workflow as JSON', () => {
    const wf = createResearchAgentTemplate();
    const bundle = exportWorkflow(wf, 'json');
    const result = importBundle(bundle.content);
    expect(result.ok).toBe(true);
    expect(result.workflow?.name).toBe(wf.name);
  });

  it('redacts secret variable defaults on export', () => {
    const wf = createEmptyWorkflow('Secrets');
    wf.variables = [
      {
        id: '1',
        name: 'api_key',
        type: 'string',
        secret: true,
        required: false,
        scope: 'workflow',
        defaultValue: 'sk-secret-value',
      },
    ];
    const bundle = exportWorkflow(wf, 'json');
    expect(bundle.content).not.toContain('sk-secret-value');
  });
});

describe('templates', () => {
  it('exposes curated templates', () => {
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const t of WORKFLOW_TEMPLATES) {
      const wf = t.create();
      expect(wf.nodes.length).toBeGreaterThan(0);
    }
  });

  it('places the research template left to right', () => {
    const wf = createResearchAgentTemplate();
    const x = Object.fromEntries(wf.nodes.map((n) => [n.data.label, n.position.x]));
    expect(x['Receive Question']).toBeLessThan(x['Research Agent']!);
    expect(x['Research Agent']).toBeLessThan(x['Evaluate Research']!);
    expect(x['Evaluate Research']).toBeLessThan(x['Generate Report']!);
    expect(x['Generate Report']).toBeLessThan(x['END']!);
  });
});

describe('auto-layout', () => {
  it('assigns non-overlapping positions left-to-right', () => {
    const wf = createResearchAgentTemplate();
    const laid = autoLayoutWorkflow(wf, { direction: 'LR' });
    expect(laid).toHaveLength(wf.nodes.length);
    const xs = laid.map((n) => n.position.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100);
    // Source-ish nodes should tend left of sink-ish nodes for LR.
    const byId = new Map(laid.map((n) => [n.id, n]));
    const input = wf.nodes.find((n) => n.data.nodeType === 'input');
    const output = wf.nodes.find((n) => n.data.nodeType === 'output');
    if (input && output) {
      expect(byId.get(input.id)!.position.x).toBeLessThan(byId.get(output.id)!.position.x);
    }
    const research = wf.nodes.find((n) => n.data.label === 'Research Agent');
    const evaluate = wf.nodes.find((n) => n.data.label === 'Evaluate Research');
    if (research && evaluate) {
      expect(byId.get(research.id)!.position.x).toBeLessThan(byId.get(evaluate.id)!.position.x);
    }
  });

  it('ranks the research loop left-to-right even if the back-edge is listed first', () => {
    const wf = createResearchAgentTemplate();
    const loop = wf.edges.find((e) => e.sourceHandle === 'insufficient');
    expect(loop).toBeTruthy();
    wf.edges = [loop!, ...wf.edges.filter((e) => e.id !== loop!.id)];
    const laid = autoLayoutWorkflow(wf, { direction: 'LR' });
    const byId = new Map(laid.map((n) => [n.id, n]));
    const research = wf.nodes.find((n) => n.data.label === 'Research Agent')!;
    const evaluate = wf.nodes.find((n) => n.data.label === 'Evaluate Research')!;
    expect(byId.get(research.id)!.position.x).toBeLessThan(byId.get(evaluate.id)!.position.x);
  });

  it('supports top-to-bottom direction', () => {
    const wf = createResearchAgentTemplate();
    const laid = autoLayoutWorkflow(wf, { direction: 'TB' });
    const ys = laid.map((n) => n.position.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(100);
  });

  it('separates disconnected components', () => {
    const wf = createEmptyWorkflow('Disconnected');
    const a = createNode('input', { x: 0, y: 0 });
    const b = createNode('output', { x: 0, y: 0 });
    const c = createNode('agent', { x: 0, y: 0 });
    wf.nodes = [a, b, c];
    wf.edges = [createEdge(a.id, b.id)];
    const laid = autoLayoutWorkflow(wf, { direction: 'LR' });
    const orphan = laid.find((n) => n.id === c.id)!;
    const chain = laid.filter((n) => n.id !== c.id);
    const chainMaxY = Math.max(...chain.map((n) => n.position.y));
    expect(orphan.position.y).toBeGreaterThan(chainMaxY + 40);
  });
});

describe('skill version ranges', () => {
  it('resolves the highest satisfying version', () => {
    expect(resolveVersion(['1.0.0', '1.2.0', '1.2.5', '2.0.0'], '^1.2.0')).toBe('1.2.5');
    expect(resolveVersion(['1.0.0', '2.0.0'], '^1.0.0')).toBe('1.0.0');
    expect(resolveVersion(['1.0.0'], '^2.0.0')).toBeNull();
  });

  it('validates ranges and pins', () => {
    expect(isValidVersionRange('^1.2.0')).toBe(true);
    expect(isValidVersionRange('not-a-range')).toBe(false);
    expect(toCaretRange('1.2.3')).toBe('^1.2.3');
    const ok = resolveSkillRef(
      { skillId: 'x', versionRange: '^1.0.0', pinnedVersion: '1.1.0' },
      ['1.0.0', '1.1.0', '2.0.0'],
    );
    expect(ok).toEqual({ ok: true, version: '1.1.0' });
  });

  it('flags invalid version ranges on skill nodes', () => {
    const wf = createEmptyWorkflow('Ranges');
    const skill = createNode('published_skill', { x: 0, y: 0 });
    skill.data.config = { skillId: 'research', versionRange: '>>>' };
    wf.nodes = [skill];
    const issues = validateWorkflow(wf);
    expect(issues.some((i) => i.code === 'INVALID_VERSION_RANGE')).toBe(true);
  });

  it('exports skill chains with caret version ranges', () => {
    const wf = createResearchAgentTemplate();
    const { chain } = exportLinkedSkillChain(wf);
    expect(chain.skills.length).toBeGreaterThan(0);
    expect(chain.skills.every((s) => (s.versionRange ?? '').startsWith('^'))).toBe(true);
  });
});

describe('hard gates', () => {
  it('validates JSON schema fail-closed', () => {
    const schema = { type: 'object', required: ['action'], properties: { action: { type: 'string' } } };
    const pass = evaluateSchemaGate({ jsonSchema: schema }, { value: { action: 'publish' } });
    expect(pass.pass).toBe(true);
    const fail = evaluateSchemaGate({ jsonSchema: schema }, { value: { nope: true } });
    expect(fail.pass).toBe(false);
    const invalid = evaluateSchemaGate({ jsonSchema: '{not json' }, { value: {} });
    expect(invalid.pass).toBe(false);
    const empty = evaluateSchemaGate({ jsonSchema: {} }, { value: { anything: true } });
    expect(empty.pass).toBe(false);
    expect(empty.reason).toMatch(/no constraints/);
    expect(schemaHasConstraints({ items: {} })).toBe(false);
    expect(schemaHasConstraints({ type: 'array', items: {} })).toBe(true);
    const itemsOnly = evaluateSchemaGate({ jsonSchema: { items: {} } }, { value: [1, 2, 3] });
    expect(itemsOnly.pass).toBe(false);
    expect(itemsOnly.reason).toMatch(/no constraints/);
  });

  it('enforces policy expressions and allowlists', () => {
    const expr = evaluatePolicyGate({ expression: 'score >= 0.8' }, { value: { score: 0.9 } });
    expect(expr.pass).toBe(true);
    const deny = evaluatePolicyGate({ expression: 'score >= 0.8' }, { value: { score: 0.2 } });
    expect(deny.pass).toBe(false);
    const allow = evaluatePolicyGate(
      { allowlistPath: 'path', allowlist: ['src/', 'docs/'], allowlistMode: 'prefix' },
      { value: { path: 'src/app.ts' } },
    );
    expect(allow.pass).toBe(true);
    const blocked = evaluatePolicyGate(
      { allowlistPath: 'path', allowlist: ['src/'], allowlistMode: 'prefix' },
      { value: { path: '/etc/passwd' } },
    );
    expect(blocked.pass).toBe(false);
    const traversal = evaluatePolicyGate(
      { allowlistPath: 'path', allowlist: ['src/'], allowlistMode: 'prefix' },
      { value: { path: 'src/../etc/passwd' } },
    );
    expect(traversal.pass).toBe(false);
    const sibling = evaluatePolicyGate(
      { allowlistPath: 'path', allowlist: ['src/'], allowlistMode: 'prefix' },
      { value: { path: 'srcfoo/app.ts' } },
    );
    expect(sibling.pass).toBe(false);
  });

  it('flags privileged nodes without an upstream hard gate', () => {
    const wf = createEmptyWorkflow('Ungated');
    const input = createNode('input', { x: 0, y: 0 });
    const http = createNode('http_request', { x: 0, y: 80 }, 'Publish');
    wf.nodes = [input, http];
    wf.edges = [createEdge(input.id, http.id)];
    expect(findUngatedSideEffects(wf).some((i) => i.code === 'UNGATED_SIDE_EFFECT')).toBe(true);
    const issues = validateWorkflow(wf);
    expect(issues.some((i) => i.code === 'UNGATED_SIDE_EFFECT')).toBe(true);
  });

  it('allows privileged nodes behind a passing schema gate', async () => {
    const wf = createEmptyWorkflow('Gated');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('schema_gate', { x: 0, y: 80 });
    gate.data.config = {
      jsonSchema: JSON.stringify({ type: 'object', required: ['action'] }),
    };
    const http = createNode('http_request', { x: 0, y: 160 }, 'Publish');
    const output = createNode('output', { x: 0, y: 240 });
    wf.nodes = [input, gate, http, output];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, http.id, { sourceHandle: 'pass', kind: 'conditional', label: 'pass' }),
      createEdge(http.id, output.id),
    ];
    const errors = validateWorkflow(wf).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
    const run = await executeWorkflow(wf, { input: { action: 'publish' } });
    expect(run.status).toBe('success');
    expect(run.traces.some((t) => t.nodeId === http.id && t.status === 'success')).toBe(true);
  });

  it('does not execute side effects on the fail branch', async () => {
    const wf = createEmptyWorkflow('FailBranch');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('policy_gate', { x: 0, y: 80 });
    gate.data.config = { expression: 'score >= 0.9' };
    const http = createNode('http_request', { x: 0, y: 160 }, 'Publish');
    wf.nodes = [input, gate, http];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, http.id, { sourceHandle: 'pass', kind: 'conditional', label: 'pass' }),
    ];
    const run = await executeWorkflow(wf, { input: { score: 0.1 } });
    expect(run.status).toBe('success');
    expect(run.traces.some((t) => t.nodeId === http.id)).toBe(false);
  });

  it('exports gates onto skill chain skills and pass links', () => {
    const wf = createEmptyWorkflow('ExportGates');
    const input = createNode('input', { x: 0, y: 0 });
    const agent = createNode('llm', { x: 0, y: 80 }, 'Draft');
    const gate = createNode('policy_gate', { x: 0, y: 160 }, 'Policy');
    gate.data.config = { expression: 'true' };
    const http = createNode('http_request', { x: 0, y: 240 }, 'Publish');
    const output = createNode('output', { x: 0, y: 320 });
    wf.nodes = [input, agent, gate, http, output];
    wf.edges = [
      createEdge(input.id, agent.id),
      createEdge(agent.id, gate.id),
      createEdge(gate.id, http.id, { sourceHandle: 'pass', kind: 'conditional' }),
      createEdge(http.id, output.id),
    ];
    const { chain, skills } = exportLinkedSkillChain(wf);
    expect(skills.some((s) => s.gates.some((g) => g.kind === 'policy'))).toBe(true);
    expect(chain.links.some((l) => l.condition === 'pass')).toBe(true);
    const bundle = exportSkillChain(chain, skills);
    const parsed = JSON.parse(bundle.content) as { skills: typeof skills };
    expect(parsed.skills.some((s) => s.gates.length > 0)).toBe(true);
  });

  it('flags a parallel ungated path into a privileged node', () => {
    const wf = createEmptyWorkflow('Bypass');
    const input = createNode('input', { x: 0, y: 0 });
    const llm = createNode('llm', { x: 0, y: 80 }, 'Draft');
    const gate = createNode('schema_gate', { x: 160, y: 80 });
    gate.data.config = {
      jsonSchema: JSON.stringify({ type: 'object', required: ['action'] }),
    };
    const http = createNode('http_request', { x: 0, y: 160 }, 'Publish');
    wf.nodes = [input, llm, gate, http];
    wf.edges = [
      createEdge(input.id, llm.id),
      createEdge(input.id, gate.id),
      createEdge(llm.id, http.id),
      createEdge(gate.id, http.id, { sourceHandle: 'pass', kind: 'conditional', label: 'pass' }),
    ];
    expect(findUngatedSideEffects(wf).some((i) => i.code === 'UNGATED_SIDE_EFFECT')).toBe(true);
  });

  it('treats tool_call and web_search as privileged', () => {
    const wf = createEmptyWorkflow('Tools');
    const input = createNode('input', { x: 0, y: 0 });
    const search = createNode('web_search', { x: 0, y: 80 }, 'Search');
    wf.nodes = [input, search];
    wf.edges = [createEdge(input.id, search.id)];
    expect(findUngatedSideEffects(wf).some((i) => i.nodeId === search.id)).toBe(true);
  });

  it('pauses human approval instead of auto-approving side effects', async () => {
    const wf = createEmptyWorkflow('AutoApprove');
    wf.limits.requireHumanApproval = false;
    const input = createNode('input', { x: 0, y: 0 });
    const approve = createNode('human_approval', { x: 0, y: 80 }, 'Approve');
    const http = createNode('http_request', { x: 0, y: 160 }, 'Publish');
    wf.nodes = [input, approve, http];
    wf.edges = [
      createEdge(input.id, approve.id),
      createEdge(approve.id, http.id, {
        sourceHandle: 'approved',
        kind: 'conditional',
        label: 'approved',
      }),
    ];
    expect(validateWorkflow(wf).filter((i) => i.severity === 'error')).toEqual([]);
    const run = await executeWorkflow(wf, { input: { action: 'publish' } });
    expect(run.status).toBe('waiting_approval');
    expect(run.pendingApproval?.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(run.traces.some((t) => t.nodeId === http.id && t.status === 'success')).toBe(false);
  });

  it('resumes human approval with payload hash binding', async () => {
    const wf = createEmptyWorkflow('InteractiveApprove');
    wf.limits.requireHumanApproval = false;
    const input = createNode('input', { x: 0, y: 0 });
    const approve = createNode('human_approval', { x: 0, y: 80 }, 'Approve');
    const http = createNode('http_request', { x: 0, y: 160 }, 'Publish');
    wf.nodes = [input, approve, http];
    wf.edges = [
      createEdge(input.id, approve.id),
      createEdge(approve.id, http.id, {
        sourceHandle: 'approved',
        kind: 'conditional',
        label: 'approved',
      }),
    ];
    const paused = await executeWorkflow(wf, { input: { action: 'publish' } });
    expect(paused.status).toBe('waiting_approval');
    const run = await resumeWorkflow(wf, paused, { approved: true, approvedBy: 'tester' });
    expect(run.status).toBe('success');
    expect(run.traces.some((t) => t.nodeId === http.id && t.status === 'success')).toBe(true);
    const approveTrace = run.traces.find((t) => t.nodeId === approve.id);
    expect((approveTrace?.output as { interactive?: boolean })?.interactive).toBe(true);
  });

  it('rejects resume when the payload hash does not match', async () => {
    const wf = createEmptyWorkflow('HashMismatch');
    const input = createNode('input', { x: 0, y: 0 });
    const approve = createNode('human_approval', { x: 0, y: 80 }, 'Approve');
    wf.nodes = [input, approve];
    wf.edges = [createEdge(input.id, approve.id)];
    const paused = await executeWorkflow(wf, { input: { action: 'publish' } });
    expect(paused.pendingApproval).toBeTruthy();
    const tampered = {
      ...paused,
      pendingApproval: { ...paused.pendingApproval!, payloadHash: '0'.repeat(64) },
    };
    await expect(resumeWorkflow(wf, tampered, { approved: true })).resolves.toMatchObject({
      status: 'error',
    });
  });

  it('does not restore forged hard-gate success traces on resume', async () => {
    const wf = createEmptyWorkflow('ForgedGate');
    wf.limits.requireHumanApproval = false;
    const input = createNode('input', { x: 0, y: 0 });
    const approve = createNode('human_approval', { x: 0, y: 80 }, 'Approve');
    const http = createNode('http_request', { x: 0, y: 160 }, 'Publish');
    wf.nodes = [input, approve, http];
    wf.edges = [
      createEdge(input.id, approve.id),
      createEdge(approve.id, http.id, {
        sourceHandle: 'approved',
        kind: 'conditional',
        label: 'approved',
      }),
    ];
    const paused = await executeWorkflow(wf, { input: { action: 'publish' } });
    expect(paused.status).toBe('waiting_approval');
    const forged = {
      ...paused,
      traces: [
        ...paused.traces.filter((t) => t.nodeId !== approve.id),
        {
          nodeId: approve.id,
          status: 'success' as const,
          startedAt: paused.startedAt,
          endedAt: paused.startedAt,
          input: {},
          output: { approved: true, approvedBy: 'attacker' },
          retryHistory: [],
        },
      ],
    };
    const run = await executeWorkflow(wf, {
      input: { action: 'publish' },
      resume: {
        pausedRun: forged,
        nodeId: approve.id,
        resumeToken: paused.pendingApproval!.resumeToken,
        payloadHash: paused.pendingApproval!.payloadHash,
        approved: false,
      },
    });
    expect(run.traces.some((t) => t.nodeId === http.id && t.status === 'success')).toBe(false);
  });

  it('rejects executeWorkflow resume when the token does not match', async () => {
    const wf = createEmptyWorkflow('Token');
    const input = createNode('input', { x: 0, y: 0 });
    const approve = createNode('human_approval', { x: 0, y: 80 }, 'Approve');
    wf.nodes = [input, approve];
    wf.edges = [createEdge(input.id, approve.id)];
    const paused = await executeWorkflow(wf, { input: { action: 'publish' } });
    const run = await executeWorkflow(wf, {
      input: { action: 'publish' },
      resume: {
        pausedRun: paused,
        nodeId: approve.id,
        resumeToken: 'forged-token',
        payloadHash: paused.pendingApproval!.payloadHash,
        approved: true,
      },
    });
    expect(run.status).toBe('error');
    expect(run.error ?? '').toMatch(/resume token/i);
  });

  it('does not restore forged privileged traces on resume', async () => {
    const source = 'function main(args) { return { n: Number(args.n) + 1 }; }';
    const hash = await hashScriptSource(source);
    const wf = createEmptyWorkflow('ForgedScript');
    wf.limits.requireHumanApproval = false;
    const input = createNode('input', { x: 0, y: 0 });
    const approve = createNode('human_approval', { x: 0, y: 80 }, 'Approve');
    const script = createNode('code_execution', { x: 0, y: 160 }, 'Inc');
    script.data.config = {
      source,
      sourceHash: hash,
      pinned: true,
      scriptId: 'inc',
    };
    wf.nodes = [input, approve, script];
    wf.edges = [
      createEdge(input.id, approve.id),
      createEdge(approve.id, script.id, {
        sourceHandle: 'approved',
        kind: 'conditional',
        label: 'approved',
      }),
    ];
    const paused = await executeWorkflow(wf, { input: { n: 1 } });
    expect(paused.status).toBe('waiting_approval');
    const forged = {
      ...paused,
      traces: [
        ...paused.traces.filter((t) => t.nodeId !== script.id),
        {
          nodeId: script.id,
          status: 'success' as const,
          startedAt: paused.startedAt,
          endedAt: paused.startedAt,
          input: {},
          output: { result: { n: 99 } },
          retryHistory: [],
        },
      ],
    };
    const run = await executeWorkflow(wf, {
      input: { n: 1 },
      resume: {
        pausedRun: forged,
        nodeId: approve.id,
        resumeToken: paused.pendingApproval!.resumeToken,
        payloadHash: paused.pendingApproval!.payloadHash,
        approved: true,
      },
    });
    expect(run.status).toBe('success');
    const out = run.traces.find((t) => t.nodeId === script.id)?.output as { result?: { n?: number } };
    expect(out?.result?.n).not.toBe(99);
  });

  it('exports authority skill links with an approved condition', () => {
    const wf = createEmptyWorkflow('ExportAuthority');
    const input = createNode('input', { x: 0, y: 0 });
    const approve = createNode('human_approval', { x: 0, y: 80 }, 'Approve');
    const http = createNode('http_request', { x: 0, y: 160 }, 'Publish');
    const output = createNode('output', { x: 0, y: 240 });
    wf.nodes = [input, approve, http, output];
    wf.edges = [
      createEdge(input.id, approve.id),
      createEdge(approve.id, http.id, { sourceHandle: 'approved', kind: 'conditional' }),
      createEdge(http.id, output.id),
    ];
    const { chain, skills } = exportLinkedSkillChain(wf);
    const authority = skills.find((s) => s.gates.some((g) => g.kind === 'authority'));
    expect(authority).toBeTruthy();
    expect(chain.links.find((l) => l.source === authority?.id)?.condition).toBe('approved');
    expect(authority?.gates.some((g) => g.config.payloadHashBinding === true)).toBe(true);
  });

  it('exports fail-branch skill links as fail, not pass', () => {
    const wf = createEmptyWorkflow('ExportFail');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('policy_gate', { x: 0, y: 80 }, 'Policy');
    gate.data.config = { expression: 'score >= 0.9' };
    const note = createNode('transform', { x: 0, y: 160 }, 'Reject Note');
    const output = createNode('output', { x: 0, y: 240 });
    wf.nodes = [input, gate, note, output];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, note.id, { sourceHandle: 'fail', kind: 'conditional', label: 'fail' }),
      createEdge(note.id, output.id),
    ];
    const { chain, skills } = exportLinkedSkillChain(wf);
    const policy = skills.find((s) => s.gates.some((g) => g.kind === 'policy'));
    const link = chain.links.find((l) => l.source === policy?.id);
    expect(link?.condition).toBe('fail');
    expect(link?.mappings.some((m) => m.sourcePort === 'fail')).toBe(true);
  });

  it('treats catalog Pass/Fail labels as fail-only when exporting', () => {
    const wf = createEmptyWorkflow('ExportFailLabel');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('policy_gate', { x: 0, y: 80 }, 'Policy');
    gate.data.config = { expression: 'score >= 0.9' };
    const note = createNode('transform', { x: 0, y: 160 }, 'Reject Note');
    const output = createNode('output', { x: 0, y: 240 });
    wf.nodes = [input, gate, note, output];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, note.id, { sourceHandle: 'Fail', kind: 'conditional', label: 'Fail' }),
      createEdge(note.id, output.id),
    ];
    const { chain, skills } = exportLinkedSkillChain(wf);
    const policy = skills.find((s) => s.gates.some((g) => g.kind === 'policy'));
    expect(chain.links.find((l) => l.source === policy?.id)?.condition).toBe('fail');
  });
});

describe('tool contracts', () => {
  it('denies agent tools that are not on the allowlist', () => {
    expect(() => assertAgentToolAllowed({ tools: ['web_search'] }, 'http_request')).toThrow(
      /allowlist/,
    );
    expect(() =>
      assertAgentToolAllowed({ tools: ['web_search'], toolPermissions: { web_search: false } }, 'web_search'),
    ).toThrow(/denied/);
    expect(() => assertAgentToolAllowed({ tools: ['web_search'] }, 'web_search')).not.toThrow();
  });

  it('enforces maxToolCalls on privileged nodes', async () => {
    const wf = createEmptyWorkflow('Budget');
    wf.limits.maxToolCalls = 1;
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('schema_gate', { x: 0, y: 80 });
    gate.data.config = {
      jsonSchema: JSON.stringify({ type: 'object', required: ['action'] }),
    };
    const http1 = createNode('http_request', { x: 0, y: 160 }, 'First');
    const http2 = createNode('http_request', { x: 0, y: 240 }, 'Second');
    wf.nodes = [input, gate, http1, http2];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, http1.id, { sourceHandle: 'pass', kind: 'conditional', label: 'pass' }),
      createEdge(http1.id, http2.id),
    ];
    const run = await executeWorkflow(wf, { input: { action: 'publish' } });
    expect(run.status).toBe('error');
    expect(run.error ?? '').toMatch(/maxToolCalls/);
    expect(run.traces.some((t) => t.nodeId === http1.id && t.status === 'success')).toBe(true);
    expect(run.traces.some((t) => t.nodeId === http2.id && t.status === 'success')).toBe(false);
  });

  it('blocks agent-invented tools not on the allowlist during execution', async () => {
    const wf = createEmptyWorkflow('AgentTools');
    const input = createNode('input', { x: 0, y: 0 });
    const agent = createNode('agent', { x: 0, y: 80 }, 'Research');
    agent.data.config = {
      ...agent.data.config,
      tools: ['web_search'],
      model: { provider: 'openai', model: 'gpt-4o-mini' },
    };
    const output = createNode('output', { x: 0, y: 160 });
    wf.nodes = [input, agent, output];
    wf.edges = [createEdge(input.id, agent.id), createEdge(agent.id, output.id)];
    const denied = await executeWorkflow(wf, { input: { requestedTool: 'http_request' } });
    expect(denied.status).toBe('error');
    expect(denied.error ?? '').toMatch(/allowlist/);
    const allowed = await executeWorkflow(wf, { input: { requestedTool: 'web_search' } });
    expect(allowed.status).toBe('success');
  });

  it('validates structured output fail-closed', () => {
    const schema = { type: 'object', required: ['action'], properties: { action: { type: 'string' } } };
    const pass = evaluateStructuredOutput({ outputSchema: schema }, { action: 'publish' });
    expect(pass.ok).toBe(true);
    const fail = evaluateStructuredOutput({ outputSchema: schema }, { nope: true });
    expect(fail.ok).toBe(false);
    const notJson = evaluateStructuredOutput({ structuredOutput: true, outputSchema: schema }, 'not json');
    expect(notJson.ok).toBe(false);
    const missingSchema = evaluateStructuredOutput({ structuredOutput: true }, { action: 'x' });
    expect(missingSchema.ok).toBe(false);
  });

  it('errors the node when structured output fails without an invalid branch', async () => {
    const wf = createEmptyWorkflow('StructuredFail');
    const input = createNode('input', { x: 0, y: 0 });
    const llm = createNode('llm', { x: 0, y: 80 }, 'Draft');
    llm.data.config = {
      ...llm.data.config,
      outputSchema: { type: 'object', required: ['action'] },
      model: { provider: 'openai', model: 'gpt-4o-mini' },
    };
    const output = createNode('output', { x: 0, y: 160 });
    wf.nodes = [input, llm, output];
    wf.edges = [createEdge(input.id, llm.id), createEdge(llm.id, output.id)];
    const run = await executeWorkflow(wf, { input: { hello: true } });
    expect(run.status).toBe('error');
    expect(run.error ?? '').toMatch(/Structured output failed/);
  });

  it('takes the invalid branch when structured output fails', async () => {
    const wf = createEmptyWorkflow('StructuredInvalid');
    const input = createNode('input', { x: 0, y: 0 });
    const llm = createNode('llm', { x: 0, y: 80 }, 'Draft');
    llm.data.config = {
      ...llm.data.config,
      outputSchema: { type: 'object', required: ['action'] },
      model: { provider: 'openai', model: 'gpt-4o-mini' },
    };
    const note = createNode('transform', { x: 0, y: 160 }, 'Fallback');
    note.data.config = { expression: 'invalid' };
    wf.nodes = [input, llm, note];
    wf.edges = [
      createEdge(input.id, llm.id),
      createEdge(llm.id, note.id, { sourceHandle: 'invalid', kind: 'conditional', label: 'invalid' }),
    ];
    const run = await executeWorkflow(wf, { input: { hello: true } });
    expect(run.status).toBe('success');
    expect(run.traces.some((t) => t.nodeId === note.id && t.status === 'success')).toBe(true);
  });

  it('does not activate unlabeled edges when structured output fails', async () => {
    const wf = createEmptyWorkflow('StructuredUnlabeled');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('schema_gate', { x: 0, y: 80 });
    gate.data.config = {
      jsonSchema: JSON.stringify({ type: 'object', required: ['action'] }),
    };
    const llm = createNode('llm', { x: 0, y: 160 }, 'Draft');
    llm.data.config = {
      ...llm.data.config,
      outputSchema: { type: 'object', required: ['summary'] },
      model: { provider: 'openai', model: 'gpt-4o-mini' },
    };
    const http = createNode('http_request', { x: 0, y: 240 }, 'Publish');
    const note = createNode('transform', { x: 320, y: 240 }, 'Fallback');
    note.data.config = { expression: 'invalid' };
    wf.nodes = [input, gate, llm, http, note];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, llm.id, { sourceHandle: 'pass', kind: 'conditional', label: 'pass' }),
      createEdge(llm.id, http.id),
      createEdge(llm.id, note.id, { sourceHandle: 'invalid', kind: 'conditional', label: 'invalid' }),
    ];
    const run = await executeWorkflow(wf, { input: { action: 'publish' } });
    expect(run.traces.some((t) => t.nodeId === http.id && t.status === 'success')).toBe(false);
    expect(run.traces.some((t) => t.nodeId === note.id && t.status === 'success')).toBe(true);
  });

  it('re-validates structured output even when a custom executor skips the contract', async () => {
    const wf = createEmptyWorkflow('CustomExecutor');
    const input = createNode('input', { x: 0, y: 0 });
    const llm = createNode('llm', { x: 0, y: 80 }, 'Draft');
    llm.data.config = {
      ...llm.data.config,
      outputSchema: { type: 'object', required: ['action'] },
      model: { provider: 'openai', model: 'gpt-4o-mini' },
    };
    wf.nodes = [input, llm];
    wf.edges = [createEdge(input.id, llm.id)];
    const run = await executeWorkflow(wf, {
      input: { action: 'publish' },
      executor: async () => ({ result: 'I am a helpful assistant' }),
    });
    expect(run.status).toBe('error');
    expect(run.error ?? '').toMatch(/Structured output failed/);
  });

  it('exports tool allowlists and output contracts onto skills', () => {
    const wf = createEmptyWorkflow('ExportContracts');
    const input = createNode('input', { x: 0, y: 0 });
    const agent = createNode('agent', { x: 0, y: 80 }, 'Research');
    agent.data.config = {
      ...agent.data.config,
      tools: ['web_search'],
      toolPermissions: { web_search: true, shell: false },
      outputSchema: { type: 'object', required: ['summary'] },
      structuredOutput: true,
      model: { provider: 'openai', model: 'gpt-4o-mini' },
    };
    const output = createNode('output', { x: 0, y: 160 });
    wf.nodes = [input, agent, output];
    wf.edges = [createEdge(input.id, agent.id), createEdge(agent.id, output.id)];
    const { chain, skills } = exportLinkedSkillChain(wf);
    const research = skills.find((s) => s.name === 'Research');
    expect(research?.tools).toContain('web_search');
    expect(research?.toolPermissions?.shell).toBe(false);
    expect(research?.outputContracts.some((c) => c.structuredOutput)).toBe(true);
    const bundle = exportSkillChain(chain, skills);
    const parsed = JSON.parse(bundle.content) as { skills: typeof skills };
    expect(parsed.skills.some((s) => (s.outputContracts?.length ?? 0) > 0)).toBe(true);
    expect(chain.executionPolicy?.maxToolCalls).toBe(wf.limits.maxToolCalls);
  });
});

describe('pinned scripts', () => {
  const source = 'function main(args) { return { n: Number(args.n) + 1 }; }';

  it('flags unpinned code_execution nodes', () => {
    const wf = createEmptyWorkflow('Unpinned');
    const script = createNode('code_execution', { x: 0, y: 0 }, 'Script');
    wf.nodes = [script];
    expect(validateWorkflow(wf).some((i) => i.code === 'INVALID_SCRIPT')).toBe(true);
  });

  it('runs a pinned script behind a hard gate and ignores injected code', async () => {
    const hash = await hashScriptSource(source);
    const wf = createEmptyWorkflow('Pinned');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('schema_gate', { x: 0, y: 80 });
    gate.data.config = {
      jsonSchema: JSON.stringify({ type: 'object', required: ['n'] }),
    };
    const script = createNode('code_execution', { x: 0, y: 160 }, 'Inc');
    script.data.config = {
      ...script.data.config,
      source,
      sourceHash: hash,
      pinned: true,
      scriptId: 'inc',
    };
    wf.nodes = [input, gate, script];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, script.id, { sourceHandle: 'pass', kind: 'conditional', label: 'pass' }),
    ];
    const run = await executeWorkflow(wf, {
      input: { n: 1, code: 'function main() { return { n: 99 }; }' },
    });
    expect(run.status).toBe('success');
    const out = run.traces.find((t) => t.nodeId === script.id)?.output as { result?: { n?: number } };
    expect(out?.result?.n).toBe(2);
  });

  it('fails closed when the source hash does not match', async () => {
    const wf = createEmptyWorkflow('Tamper');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('schema_gate', { x: 0, y: 80 });
    gate.data.config = {
      jsonSchema: JSON.stringify({ type: 'object', required: ['n'] }),
    };
    const script = createNode('code_execution', { x: 0, y: 160 }, 'Inc');
    script.data.config = {
      source,
      sourceHash: '0'.repeat(64),
      pinned: true,
    };
    wf.nodes = [input, gate, script];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, script.id, { sourceHandle: 'pass', kind: 'conditional', label: 'pass' }),
    ];
    const run = await executeWorkflow(wf, { input: { n: 1 } });
    expect(run.status).toBe('error');
    expect(run.error ?? '').toMatch(/sourceHash/);
  });

  it('exports pinned scripts onto skill chains', async () => {
    const hash = await hashScriptSource(source);
    const wf = createEmptyWorkflow('ExportScript');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('policy_gate', { x: 0, y: 80 }, 'Policy');
    gate.data.config = { expression: 'true' };
    const script = createNode('code_execution', { x: 0, y: 160 }, 'Inc');
    script.data.config = { source, sourceHash: hash, pinned: true, scriptId: 'inc' };
    const output = createNode('output', { x: 0, y: 240 });
    wf.nodes = [input, gate, script, output];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, script.id, { sourceHandle: 'pass', kind: 'conditional' }),
      createEdge(script.id, output.id),
    ];
    const { chain, skills } = exportLinkedSkillChain(wf);
    expect(skills.some((s) => s.scripts.some((sc) => sc.scriptId === 'inc' && sc.pinned))).toBe(
      true,
    );
    const bundle = exportSkillChain(chain, skills);
    const parsed = JSON.parse(bundle.content) as { skills: typeof skills };
    expect(parsed.skills.some((s) => s.scripts.some((sc) => sc.sourceHash === hash))).toBe(true);
  });

  it('rejects constructor escapes instead of running host code', () => {
    expect(() =>
      runPinnedScript(
        "function main(args) { return [].constructor.constructor('return 1')(); }",
        {},
      ),
    ).toThrow(/forbidden/i);
    expect(() =>
      runPinnedScript(
        'function main(args) { return args; }\n; 1',
        {},
      ),
    ).toThrow(/function main/);
  });

  it('returns primitive and array args from `return args`', () => {
    expect(runPinnedScript('function main(args) { return args; }', 3)).toBe(3);
    expect(runPinnedScript('function main(args) { return args; }', 'ok')).toBe('ok');
    expect(runPinnedScript('function main(args) { return args; }', [1, 2])).toEqual([1, 2]);
    expect(runPinnedScript('function main(args) { return Number(args.n) + 1; }', { n: 1 })).toBe(2);
  });

  it('rejects skill chains whose scripts[] do not match internalWorkflow', async () => {
    const hash = await hashScriptSource(source);
    const wf = createEmptyWorkflow('ScriptIntegrity');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('policy_gate', { x: 0, y: 80 }, 'Policy');
    gate.data.config = { expression: 'true' };
    const script = createNode('code_execution', { x: 0, y: 160 }, 'Inc');
    script.data.config = { source, sourceHash: hash, pinned: true, scriptId: 'inc' };
    const output = createNode('output', { x: 0, y: 240 });
    wf.nodes = [input, gate, script, output];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, script.id, { sourceHandle: 'pass', kind: 'conditional' }),
      createEdge(script.id, output.id),
    ];
    const { chain, skills } = exportLinkedSkillChain(wf);
    const bundle = JSON.parse(exportSkillChain(chain, skills).content) as {
      skills: typeof skills;
    };
    const target = bundle.skills.find((s) => s.scripts.some((sc) => sc.scriptId === 'inc'));
    expect(target).toBeTruthy();
    target!.scripts = target!.scripts.map((sc) =>
      sc.scriptId === 'inc'
        ? { ...sc, source: 'function main(args) { return { n: 99 }; }', sourceHash: '0'.repeat(64) }
        : sc,
    );
    const result = importBundle(JSON.stringify({ kind: 'alb.skill_chain', version: 1, chain, skills: bundle.skills }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/scripts\[\]/);
  });
});

describe('privileged tools', () => {
  it('rejects HTTP URL overrides and credentialed URLs', () => {
    expect(() =>
      resolveHttpUrl({ url: 'https://example.com/a' }, { url: 'https://evil.example' }),
    ).toThrow(/cannot be overridden/);
    expect(() => resolveHttpUrl({ url: 'file:///etc/passwd' }, {})).toThrow(/scheme/);
    expect(() => resolveHttpUrl({ url: 'https://user:pass@example.com' }, {})).toThrow(/credentials/);
  });

  it('writes and reads files only inside the path allowlist', async () => {
    const wf = createEmptyWorkflow('Files');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('policy_gate', { x: 0, y: 80 });
    gate.data.config = { expression: 'true' };
    const write = createNode('file_operation', { x: 0, y: 160 }, 'Write');
    write.data.config = { operation: 'write', pathAllowlist: 'workspace/' };
    const read = createNode('file_operation', { x: 0, y: 240 }, 'Read');
    read.data.config = { operation: 'read', pathAllowlist: 'workspace/' };
    wf.nodes = [input, gate, write, read];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, write.id, { sourceHandle: 'pass', kind: 'conditional', label: 'pass' }),
      createEdge(write.id, read.id),
    ];
    const run = await executeWorkflow(wf, {
      input: { path: 'workspace/note.txt', content: 'hello' },
    });
    expect(run.status).toBe('success');
    const out = run.traces.find((t) => t.nodeId === read.id)?.output as {
      result?: { content?: string };
    };
    expect(out?.result?.content).toBe('hello');
  });

  it('blocks file path traversal', async () => {
    const wf = createEmptyWorkflow('Traversal');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('policy_gate', { x: 0, y: 80 });
    gate.data.config = { expression: 'true' };
    const file = createNode('file_operation', { x: 0, y: 160 }, 'Read');
    file.data.config = { operation: 'read', pathAllowlist: 'workspace/' };
    wf.nodes = [input, gate, file];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, file.id, { sourceHandle: 'pass', kind: 'conditional', label: 'pass' }),
    ];
    const run = await executeWorkflow(wf, { input: { path: 'workspace/../etc/passwd' } });
    expect(run.status).toBe('error');
    expect(run.error ?? '').toMatch(/allowlist|not on the file/i);
  });

  it('exports HTTP and file allowlists onto skills', () => {
    const wf = createEmptyWorkflow('ExportTools');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('policy_gate', { x: 0, y: 80 }, 'Policy');
    gate.data.config = { expression: 'true' };
    const http = createNode('http_request', { x: 0, y: 160 }, 'Publish');
    http.data.config = { ...http.data.config, url: 'https://example.com/publish' };
    const output = createNode('output', { x: 0, y: 240 });
    wf.nodes = [input, gate, http, output];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, http.id, { sourceHandle: 'pass', kind: 'conditional' }),
      createEdge(http.id, output.id),
    ];
    const { chain, skills } = exportLinkedSkillChain(wf);
    expect(skills.some((s) => s.privilegedTools.some((t) => t.url === 'https://example.com/publish'))).toBe(
      true,
    );
    const bundle = exportSkillChain(chain, skills);
    const parsed = JSON.parse(bundle.content) as { skills: typeof skills };
    expect(parsed.skills.some((s) => (s.privilegedTools?.length ?? 0) > 0)).toBe(true);
  });
});

describe('gate traces', () => {
  it('records and replays schema gate decisions', async () => {
    const wf = createEmptyWorkflow('Trace');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('schema_gate', { x: 0, y: 80 });
    gate.data.config = {
      jsonSchema: JSON.stringify({ type: 'object', required: ['action'] }),
    };
    wf.nodes = [input, gate];
    wf.edges = [createEdge(input.id, gate.id)];
    const run = await executeWorkflow(wf, { input: { action: 'publish' } });
    const trace = run.traces.find((t) => t.nodeId === gate.id);
    expect(trace?.gateTrace?.kind).toBe('schema');
    expect(trace?.gateTrace?.branch).toBe('pass');
    const replay = replayGateTrace(trace!.gateTrace!, gate.data.config);
    expect(replay.ok).toBe(true);
    const tampered = { ...trace!.gateTrace!, input: { nope: true } };
    expect(replayGateTrace(tampered, gate.data.config).ok).toBe(false);
  });
});
