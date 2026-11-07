import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { detectFeedbackEdgeIds, nodeIterationLimit } from '../graph.js';
import {
  createEdge,
  createEmptyWorkflow,
  createNode,
  createReactAgentNodeTemplate,
  createResearchAgentTemplate,
  createSupervisorHandoffTemplate,
  createMultiAgentDebateTemplate,
  executeWorkflow,
  resumeWorkflow,
  validateWorkflow,
  promoteStructuredFields,
  defaultNodeExecutor,
  WORKFLOW_TEMPLATES,
} from '../index.js';

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

describe('feedback edge detection', () => {
  it('marks the research insufficient edge as feedback', () => {
    const wf = createResearchAgentTemplate();
    const ids = detectFeedbackEdgeIds(wf.edges);
    const loop = wf.edges.find((e) => e.sourceHandle === 'insufficient');
    expect(loop).toBeTruthy();
    expect(ids.has(loop!.id)).toBe(true);
  });

  it('does not treat an if/else false branch as a loop-back', () => {
    const wf = createEmptyWorkflow('If else');
    const input = createNode('input', { x: 0, y: 0 });
    const cond = createNode('condition', { x: 100, y: 0 });
    cond.data.config = { expression: 'false' };
    const yes = createNode('output', { x: 200, y: 0 }, 'Yes');
    const no = createNode('transform', { x: 200, y: 80 }, 'No');
    const end = createNode('output', { x: 300, y: 80 }, 'End');
    wf.nodes = [input, cond, yes, no, end];
    wf.edges = [
      createEdge(input.id, cond.id),
      createEdge(cond.id, yes.id, { kind: 'conditional', sourceHandle: 'true', label: 'true' }),
      createEdge(cond.id, no.id, { kind: 'conditional', sourceHandle: 'false', label: 'false' }),
      createEdge(no.id, end.id),
    ];
    const ids = detectFeedbackEdgeIds(wf.edges);
    const falseEdge = wf.edges.find((e) => e.sourceHandle === 'false');
    expect(ids.has(falseEdge!.id)).toBe(false);
  });
});

describe('graph cycle execution', () => {
  it('re-runs research until the evaluator passes', async () => {
    const wf = createResearchAgentTemplate();
    const research = wf.nodes.find((n) => n.data.label === 'Research Agent')!;
    const evaluate = wf.nodes.find((n) => n.data.label === 'Evaluate Research')!;
    evaluate.data.config = { ...evaluate.data.config, mockFailUntil: 1 };
    const run = await executeWorkflow(wf, { input: { message: 'What is an agent loop?' } });
    expect(run.status).toBe('success');
    const researchRuns = run.traces.filter((t) => t.nodeId === research.id && t.status === 'success');
    const evalRuns = run.traces.filter((t) => t.nodeId === evaluate.id && t.status === 'success');
    expect(researchRuns.length).toBe(2);
    expect(evalRuns.length).toBe(2);
    expect(evalRuns[0]?.output).toMatchObject({ insufficient: true });
    expect(evalRuns[1]?.output).toMatchObject({ sufficient: true });
  });

  it('errors when a loop never reaches an output', async () => {
    const wf = createEmptyWorkflow('Stuck loop');
    wf.limits.maxIterations = 3;
    const input = createNode('input', { x: 0, y: 0 });
    const agent = createNode('agent', { x: 100, y: 0 });
    agent.data.config = { ...agent.data.config, maxIterations: 3 };
    const evaluate = createNode('evaluator', { x: 200, y: 0 });
    evaluate.data.config = { threshold: 0.7, mockFailUntil: 99 };
    const output = createNode('output', { x: 300, y: 0 });
    wf.nodes = [input, agent, evaluate, output];
    wf.edges = [
      createEdge(input.id, agent.id),
      createEdge(agent.id, evaluate.id),
      createEdge(evaluate.id, agent.id, {
        kind: 'conditional',
        sourceHandle: 'insufficient',
        label: 'insufficient',
      }),
      createEdge(evaluate.id, output.id, {
        kind: 'conditional',
        sourceHandle: 'sufficient',
        label: 'sufficient',
      }),
    ];
    const run = await executeWorkflow(wf, { input: { message: 'never enough' } });
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/maxIterations/i);
  });

  it('runs parallel debate arms before the synthesizer', async () => {
    const wf = createMultiAgentDebateTemplate();
    const run = await executeWorkflow(wf, { input: { message: 'Debate topic' } });
    expect(run.status).toBe('success');
    const labels = run.traces.map((t) => wf.nodes.find((n) => n.id === t.nodeId)?.data.label);
    const propose = labels.indexOf('Proposer');
    const critic = labels.indexOf('Critic');
    const synth = labels.indexOf('Synthesizer');
    expect(propose).toBeGreaterThanOrEqual(0);
    expect(critic).toBeGreaterThanOrEqual(0);
    expect(synth).toBeGreaterThan(propose);
    expect(synth).toBeGreaterThan(critic);
  });

  it('takes a false branch under maxIterations=1 without treating it as a loop', async () => {
    const wf = createEmptyWorkflow('Else path');
    wf.limits.maxIterations = 1;
    const input = createNode('input', { x: 0, y: 0 });
    const cond = createNode('condition', { x: 100, y: 0 });
    cond.data.config = { expression: 'false' };
    const no = createNode('transform', { x: 200, y: 0 }, 'No');
    no.data.config = { expression: 'else' };
    const end = createNode('output', { x: 300, y: 0 });
    wf.nodes = [input, cond, no, end];
    wf.edges = [
      createEdge(input.id, cond.id),
      createEdge(cond.id, no.id, { kind: 'conditional', sourceHandle: 'false', label: 'false' }),
      createEdge(no.id, end.id),
    ];
    const run = await executeWorkflow(wf, { input: { flag: false } });
    expect(run.status).toBe('success');
    expect(run.traces.some((t) => t.nodeId === no.id)).toBe(true);
    expect(run.traces.some((t) => t.nodeId === end.id)).toBe(true);
  });
});

describe('react / router runtime', () => {
  it('runs an inner ReAct tool loop then finishes', async () => {
    const wf = createReactAgentNodeTemplate();
    const agent = wf.nodes.find((n) => n.data.nodeType === 'react_agent')!;
    const run = await executeWorkflow(wf, { input: { message: 'task' } });
    expect(run.status).toBe('success');
    const trace = run.traces.find((t) => t.nodeId === agent.id);
    const output = trace?.output as Record<string, unknown>;
    expect(output.iterations).toBe(2);
    expect(Array.isArray(output.observations)).toBe(true);
    expect((output.observations as unknown[]).length).toBe(1);
    expect(run.traces.filter((t) => t.nodeId === agent.id)).toHaveLength(1);
  });

  it('routes a supervisor handoff to the mock specialist', async () => {
    const wf = createSupervisorHandoffTemplate();
    const run = await executeWorkflow(wf, { input: { message: 'handoff' } });
    expect(run.status).toBe('success');
    const research = wf.nodes.find((n) => n.data.label === 'Research Specialist')!;
    const support = wf.nodes.find((n) => n.data.label === 'Support Specialist')!;
    expect(run.traces.some((t) => t.nodeId === research.id)).toBe(true);
    expect(run.traces.some((t) => t.nodeId === support.id)).toBe(false);
  });

  it('promotes JSON action/route fields from LLM text', () => {
    const output: Record<string, unknown> = { result: '{"action":"finish","query":"q"}' };
    promoteStructuredFields(output);
    expect(output.action).toBe('finish');
    expect(output.finish).toBe(true);
    expect(output.payload).toEqual({ action: 'finish', query: 'q' });
  });

  it('promotes configured route handles and rejects reserved names', () => {
    const research: Record<string, unknown> = { result: '{"route":"research"}' };
    promoteStructuredFields(research, ['research', 'support']);
    expect(research.research).toBe(true);
    expect(research.route).toBe('research');

    const hostile: Record<string, unknown> = { result: '{"route":"pass"}' };
    promoteStructuredFields(hostile, ['research', 'support']);
    expect(hostile.pass).toBeUndefined();
    expect(hostile.route).toBeUndefined();

    const unlisted: Record<string, unknown> = { result: '{"route":"critic"}' };
    promoteStructuredFields(unlisted, ['research', 'support']);
    expect(unlisted.critic).toBeUndefined();
    expect(unlisted.route).toBeUndefined();
  });

  it('does not leak inner ReAct steps into graph-level iteration', async () => {
    const wf = createEmptyWorkflow('ReAct iteration isolation');
    const input = createNode('input', { x: 0, y: 0 });
    const agent = createNode('react_agent', { x: 100, y: 0 });
    agent.data.config = { ...agent.data.config, tools: ['web_search'], mockToolSteps: 1, maxIterations: 6 };
    const cond = createNode('condition', { x: 200, y: 0 });
    cond.data.config = { expression: 'iteration >= 2' };
    const leaked = createNode('output', { x: 300, y: 0 }, 'Leaked');
    const ok = createNode('output', { x: 300, y: 80 }, 'Ok');
    wf.nodes = [input, agent, cond, leaked, ok];
    wf.edges = [
      createEdge(input.id, agent.id),
      createEdge(agent.id, cond.id),
      createEdge(cond.id, leaked.id, { kind: 'conditional', sourceHandle: 'true', label: 'true' }),
      createEdge(cond.id, ok.id, { kind: 'conditional', sourceHandle: 'false', label: 'false' }),
    ];
    const run = await executeWorkflow(wf, { input: { message: 'task' } });
    expect(run.status).toBe('success');
    const agentOut = run.traces.find((t) => t.nodeId === agent.id)?.output as Record<string, unknown>;
    expect(agentOut.iterations).toBe(2);
    expect(run.traces.some((t) => t.nodeId === leaked.id)).toBe(false);
    expect(run.traces.some((t) => t.nodeId === ok.id)).toBe(true);
  });

  it('keeps switch default when a case reuses the reserved handle name', async () => {
    const wf = createEmptyWorkflow('Switch reserved');
    const input = createNode('input', { x: 0, y: 0 });
    const sw = createNode('switch', { x: 100, y: 0 });
    sw.data.config = {
      cases: [
        { value: 'default', handle: 'default' },
        { value: 'a', handle: 'a' },
      ],
    };
    const matched = createNode('output', { x: 200, y: 0 }, 'A');
    const fallback = createNode('output', { x: 200, y: 80 }, 'Fallback');
    wf.nodes = [input, sw, matched, fallback];
    wf.edges = [
      createEdge(input.id, sw.id),
      createEdge(sw.id, matched.id, { kind: 'conditional', sourceHandle: 'a', label: 'a' }),
      createEdge(sw.id, fallback.id, { kind: 'conditional', sourceHandle: 'default', label: 'default' }),
    ];
    const run = await executeWorkflow(wf, { input: { value: 'z' } });
    expect(run.status).toBe('success');
    expect(run.traces.some((t) => t.nodeId === matched.id)).toBe(false);
    expect(run.traces.some((t) => t.nodeId === fallback.id)).toBe(true);
  });
});

describe('recoverable tool failures', () => {
  it('repairs SQL after a mock execute failure', async () => {
    const t = WORKFLOW_TEMPLATES.find((x) => x.id === 'sql-repair')!;
    const wf = t.create();
    const exec = wf.nodes.find((n) => n.data.nodeType === 'database')!;
    const writer = wf.nodes.find((n) => n.data.label === 'Write SQL')!;
    const run = await executeWorkflow(wf, { input: { message: 'count loops' } });
    expect(run.status).toBe('success');
    const execTraces = run.traces.filter((tr) => tr.nodeId === exec.id);
    expect(execTraces).toHaveLength(2);
    expect(execTraces[0]?.output).toMatchObject({ fail: true });
    expect(execTraces[1]?.output).toMatchObject({ success: true });
    expect(run.traces.filter((tr) => tr.nodeId === writer.id).length).toBe(2);
  });

  it('follows an error edge when a privileged node throws', async () => {
    const wf = createEmptyWorkflow('Recover throw');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('schema_gate', { x: 100, y: 0 });
    gate.data.config = {
      jsonSchema: '{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}',
      failClosed: true,
    };
    const file = createNode('file_operation', { x: 200, y: 0 });
    file.data.config = { ...file.data.config, operation: 'read', path: 'workspace/missing.txt' };
    const recovered = createNode('output', { x: 300, y: 80 }, 'Recovered');
    const ok = createNode('output', { x: 300, y: 0 }, 'Ok');
    wf.nodes = [input, gate, file, recovered, ok];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, file.id, { kind: 'conditional', sourceHandle: 'pass', label: 'pass' }),
      createEdge(file.id, ok.id, { kind: 'conditional', sourceHandle: 'success', label: 'success' }),
      createEdge(file.id, recovered.id, { kind: 'conditional', sourceHandle: 'fail', label: 'fail' }),
    ];
    const run = await executeWorkflow(wf, { input: { message: 'read me' } });
    expect(run.status).toBe('success');
    expect(run.traces.some((t) => t.nodeId === recovered.id)).toBe(true);
    expect(run.traces.some((t) => t.nodeId === ok.id)).toBe(false);
  });

  it('takes the success edge when a gated file write works', async () => {
    const wf = createEmptyWorkflow('File success');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('schema_gate', { x: 100, y: 0 });
    gate.data.config = {
      jsonSchema: '{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}',
      failClosed: true,
    };
    const write = createNode('file_operation', { x: 200, y: 0 }, 'Write');
    write.data.config = {
      ...write.data.config,
      operation: 'write',
      path: 'workspace/ok.txt',
    };
    const ok = createNode('output', { x: 300, y: 0 }, 'Ok');
    const recovered = createNode('output', { x: 300, y: 80 }, 'Recovered');
    wf.nodes = [input, gate, write, ok, recovered];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, write.id, { kind: 'conditional', sourceHandle: 'pass', label: 'pass' }),
      createEdge(write.id, ok.id, { kind: 'conditional', sourceHandle: 'success', label: 'success' }),
      createEdge(write.id, recovered.id, { kind: 'conditional', sourceHandle: 'fail', label: 'fail' }),
    ];
    const run = await executeWorkflow(wf, { input: { message: 'hello' } });
    expect(run.status).toBe('success');
    expect(run.traces.some((t) => t.nodeId === ok.id)).toBe(true);
    expect(run.traces.some((t) => t.nodeId === recovered.id)).toBe(false);
  });

  it('does not auto-activate unlabeled successors after a recoverable throw', async () => {
    const wf = createEmptyWorkflow('No unlabeled after fail');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('schema_gate', { x: 100, y: 0 });
    gate.data.config = {
      jsonSchema: '{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}',
      failClosed: true,
    };
    const file = createNode('file_operation', { x: 200, y: 0 });
    file.data.config = { ...file.data.config, operation: 'read', path: 'workspace/missing.txt' };
    const recovered = createNode('output', { x: 300, y: 80 }, 'Recovered');
    const leaked = createNode('output', { x: 300, y: 0 }, 'Leaked');
    wf.nodes = [input, gate, file, recovered, leaked];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, file.id, { kind: 'conditional', sourceHandle: 'pass', label: 'pass' }),
      createEdge(file.id, leaked.id),
      createEdge(file.id, recovered.id, { kind: 'conditional', sourceHandle: 'fail', label: 'fail' }),
    ];
    const run = await executeWorkflow(wf, { input: { message: 'read me' } });
    expect(run.status).toBe('success');
    expect(run.traces.some((t) => t.nodeId === recovered.id)).toBe(true);
    expect(run.traces.some((t) => t.nodeId === leaked.id)).toBe(false);
  });

  it('still fails the run when a throw has no error edge', async () => {
    const wf = createEmptyWorkflow('Hard fail');
    const input = createNode('input', { x: 0, y: 0 });
    const gate = createNode('schema_gate', { x: 100, y: 0 });
    gate.data.config = {
      jsonSchema: '{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}',
      failClosed: true,
    };
    const file = createNode('file_operation', { x: 200, y: 0 });
    file.data.config = { ...file.data.config, operation: 'read', path: 'workspace/missing.txt' };
    const end = createNode('output', { x: 300, y: 0 });
    wf.nodes = [input, gate, file, end];
    wf.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, file.id, { kind: 'conditional', sourceHandle: 'pass', label: 'pass' }),
      createEdge(file.id, end.id),
    ];
    const run = await executeWorkflow(wf, { input: { message: 'read me' } });
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/File not found/i);
  });

  it('does not treat an insufficient branch as an exception handler', async () => {
    const wf = createResearchAgentTemplate();
    const evaluate = wf.nodes.find((n) => n.data.label === 'Evaluate Research')!;
    const run = await executeWorkflow(wf, {
      input: { message: 'boom' },
      executor: async (node, input, ctx) => {
        if (node.id === evaluate.id) throw new Error('evaluator crashed');
        return defaultNodeExecutor(node, input, ctx);
      },
    });
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/evaluator crashed/);
  });

  it('does not recover an ungated side effect along a fail edge', async () => {
    const wf = createEmptyWorkflow('Ungated recover');
    const input = createNode('input', { x: 0, y: 0 });
    const search = createNode('web_search', { x: 100, y: 0 });
    const recovered = createNode('output', { x: 200, y: 80 }, 'Recovered');
    wf.nodes = [input, search, recovered];
    wf.edges = [
      createEdge(input.id, search.id),
      createEdge(search.id, recovered.id, { kind: 'conditional', sourceHandle: 'fail', label: 'fail' }),
    ];
    const run = await executeWorkflow(wf, { input: { message: 'secret' } });
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/side effect/i);
    expect(run.traces.some((t) => t.nodeId === recovered.id)).toBe(false);
  });
});

describe('nodeIterationLimit', () => {
  it('floors fractional maxIterations to a whole run count', () => {
    const node = createNode('agent', { x: 0, y: 0 });
    node.data.config.maxIterations = 1.9;
    expect(nodeIterationLimit(node, 10)).toBe(1);
    node.data.config.maxIterations = 0.5;
    expect(nodeIterationLimit(node, 4)).toBe(4);
  });
});

describe('OSS templates', () => {
  it('exposes rebuildable real-world loops', () => {
    expect(WORKFLOW_TEMPLATES.map((t) => t.id)).toEqual(
      expect.arrayContaining([
        'research-agent',
        'react-tool-loop',
        'react-agent-node',
        'plan-and-execute',
        'reflexion',
        'rag-refine',
        'supervisor-handoffs',
        'customer-support',
        'human-in-the-loop',
        'multi-agent-debate',
        'corrective-rag',
        'adaptive-rag',
        'sql-repair',
        'constitutional-ai',
        'camel-roleplay',
        'magentic-one',
        'babyagi-task-list',
        'tree-of-thoughts',
      ]),
    );
    expect(WORKFLOW_TEMPLATES.every((t) => t.source?.url)).toBe(true);
  });

  it.each(WORKFLOW_TEMPLATES.filter((t) => t.id !== 'human-in-the-loop'))(
    '$id validates and executes in mock mode',
    async (template) => {
      const wf = template.create();
      const errors = validateWorkflow(wf).filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
      const run = await executeWorkflow(wf, { input: { message: 'test loop' } });
      expect(run.status).toBe('success');
      expect(wf.nodes.some((n) => n.data.nodeType === 'output')).toBe(true);
      expect(
        run.traces.some((t) => wf.nodes.find((n) => n.id === t.nodeId)?.data.nodeType === 'output'),
      ).toBe(true);
    },
  );

  it('pauses the HITL template for approval', async () => {
    const t = WORKFLOW_TEMPLATES.find((x) => x.id === 'human-in-the-loop')!;
    const wf = t.create();
    const errors = validateWorkflow(wf).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
    const paused = await executeWorkflow(wf, { input: { message: 'publish me' } });
    expect(paused.status).toBe('waiting_approval');
    const resumed = await resumeWorkflow(wf, paused, {
      approved: true,
      resumeToken: paused.pendingApproval?.resumeToken,
    });
    expect(resumed.status).toBe('success');
  });

  it('resumes HITL even when publish fetch is blocked', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const t = WORKFLOW_TEMPLATES.find((x) => x.id === 'human-in-the-loop')!;
    const wf = t.create();
    const paused = await executeWorkflow(wf, { input: { message: 'publish me' } });
    expect(paused.status).toBe('waiting_approval');
    const resumed = await resumeWorkflow(wf, paused, {
      approved: true,
      resumeToken: paused.pendingApproval?.resumeToken,
    });
    expect(resumed.status).toBe('success');
    const publish = wf.nodes.find((n) => n.data.label === 'Publish')!;
    const trace = resumed.traces.find((t) => t.nodeId === publish.id);
    expect(trace?.status).toBe('success');
    expect(trace?.output).toMatchObject({ fail: true, reason: 'Failed to fetch' });
  });
});
