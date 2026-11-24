import { nanoid } from 'nanoid';
import type {
  NodeTrace,
  RunStatus,
  Skill,
  SkillChain,
  Workflow,
  WorkflowNode,
  WorkflowRun,
} from '../schema/index.js';
import { validateWorkflow } from '../validation/index.js';
import {
  isPrivilegedNodeType,
  isHardGateNodeType,
  isGateFailHandle,
  isGatePassHandle,
  normalizeGateHandle,
  privilegedPathAuthorized,
  captureGateTrace,
  GATE_FAIL_HANDLES,
  GATE_PASS_HANDLES,
} from '../gates.js';
import {
  consumeToolCall,
  evaluateStructuredOutput,
  structuredOutputEnabled,
} from '../contracts.js';
import { hashPayload } from '../approval.js';
import { applySkillConfiguration, withSkillEntry } from '../skills/index.js';
import { measureChainRun, SIDE_EFFECT_BLOCKED_CODE } from '../effectiveness/measure.js';
import { detectFeedbackEdgeIds, nodeIterationLimit } from '../graph.js';
import { normalizeSkill, normalizeSkillChain } from '../normalize.js';
import { asRecord } from './helpers.js';
import { defaultNodeExecutor } from './nodeExecutor.js';
import type { ExecutionContext, ExecutionEvent, RunOptions } from './types.js';

export type {
  ExecutionContext,
  ExecutionEvent,
  ExecutionMode,
  NodeExecutor,
  RunOptions,
} from './types.js';
export { defaultNodeExecutor } from './nodeExecutor.js';

const BRANCHING_NODE_TYPES = new Set([
  'condition',
  'evaluator',
  'human_approval',
  'schema_gate',
  'policy_gate',
  'switch',
  'router',
  'classifier',
]);

function isBranchingNodeType(type: string): boolean {
  return BRANCHING_NODE_TYPES.has(type);
}

function isBranchingEdge(
  edge: { kind?: string; sourceHandle?: string },
  sourceNodeType: string,
): boolean {
  return (
    isBranchingNodeType(sourceNodeType) ||
    edge.kind === 'conditional' ||
    Boolean(edge.sourceHandle)
  );
}

function isRecoverableFailureHandle(handle: string | undefined): boolean {
  const h = normalizeGateHandle(handle ?? '');
  return h === 'error' || h === 'retry' || h === 'fail' || h === 'failure';
}

function isFatalExecutionError(message: string): boolean {
  return (
    message.startsWith(`${SIDE_EFFECT_BLOCKED_CODE}:`) ||
    /payload hash mismatch/i.test(message) ||
    /token budget exceeded/i.test(message) ||
    /timed out/i.test(message)
  );
}

/** Handles that activate gates / conditions — never inject these from model JSON. */
export const RESERVED_PROMOTION_HANDLES = new Set<string>([
  ...GATE_PASS_HANDLES,
  ...GATE_FAIL_HANDLES,
  'error',
  'retry',
]);

function promotionHandlesFor(node: WorkflowNode): string[] {
  const config = node.data.config;
  const fromRoutes = Array.isArray(config.routes)
    ? config.routes.map((r) => String(r).trim()).filter(Boolean)
    : [];
  const fromLabels = Array.isArray(config.labels)
    ? config.labels.map((l) => String(l).trim()).filter(Boolean)
    : [];
  return [...new Set([...fromRoutes, ...fromLabels])];
}

function canPromoteHandle(name: string, allowed: Iterable<string> | undefined): boolean {
  if (!name || RESERVED_PROMOTION_HANDLES.has(name)) return false;
  const allow = allowed ? [...allowed].map((h) => String(h).trim()).filter(Boolean) : [];
  return allow.includes(name);
}

/** Copy action/route fields out of structured JSON so graph branches can fire. */
export function promoteStructuredFields(
  output: Record<string, unknown>,
  allowedHandles?: Iterable<string>,
): void {
  let rec = asRecord(output.payload) ?? asRecord(output.result) ?? asRecord(output.completion);
  if (!rec && typeof output.result === 'string') {
    const trimmed = output.result.trim();
    if (trimmed.startsWith('{')) {
      try {
        rec = asRecord(JSON.parse(trimmed));
      } catch {
        rec = undefined;
      }
    }
  }
  if (!rec) return;
  if (output.payload === undefined) output.payload = rec;
  if (typeof rec.action === 'string' && output.action === undefined) {
    const action = rec.action;
    output.action = action;
    output.finish = action === 'finish' || action === 'none';
    output.search = action === 'search';
    output.act = action !== 'finish' && action !== 'none';
    if (rec.query !== undefined) output.query = rec.query;
  }
  if (typeof rec.route === 'string' || typeof rec.label === 'string') {
    const selected = String(rec.route ?? rec.label).trim();
    if (!canPromoteHandle(selected, allowedHandles)) return;
    if (output.route === undefined) output.route = selected;
    if (output.label === undefined) output.label = selected;
    if (output[selected] === undefined) output[selected] = true;
    if (output.default === undefined) output.default = false;
  }
}

function collectNodeInput(
  node: WorkflowNode,
  workflow: Workflow,
  ctx: ExecutionContext,
  runInput: Record<string, unknown>,
  feedbackEdgeIds: Set<string> = new Set(),
): Record<string, unknown> {
  const incoming = workflow.edges.filter((e) => e.target === node.id);
  const input: Record<string, unknown> = {};

  if (node.data.nodeType === 'input') {
    return { ...runInput, value: runInput };
  }

  for (const edge of incoming) {
    // Unmapped feedback edges are control-only; they must not clobber the original payload.
    if (feedbackEdgeIds.has(edge.id) && !edge.dataMapping) continue;
    const sourceOut = ctx.nodeOutputs[edge.source] ?? {};
    const value =
      edge.dataMapping?.sourcePort && edge.dataMapping.sourcePort in sourceOut
        ? sourceOut[edge.dataMapping.sourcePort]
        : edge.sourceHandle && edge.sourceHandle in sourceOut
          ? sourceOut[edge.sourceHandle]
          : (sourceOut.result ?? sourceOut.value ?? sourceOut.output ?? sourceOut.completion ?? sourceOut);
    const key = edge.targetHandle ?? edge.dataMapping?.targetPort ?? 'value';
    input[key] = value;
    // Also expose common aliases
    if (!('value' in input)) input.value = value;
    if (!('input' in input)) input.input = value;
    if (sourceOut.payload !== undefined && input.payload === undefined) {
      input.payload = sourceOut.payload;
    }
  }

  return input;
}

/** Decide whether a conditional/data edge is active given source node outputs */
export function isEdgeActive(
  edge: { sourceHandle?: string; label?: string; kind?: string },
  sourceNodeType: string,
  output: Record<string, unknown> | undefined,
): boolean {
  if (!output) return false;
  const handle = normalizeGateHandle(edge.sourceHandle ?? edge.label ?? '');
  if (output.structuredOutputFailed === true) {
    return isGateFailHandle(handle);
  }
  if (!handle) return true;

  if (sourceNodeType === 'schema_gate' || sourceNodeType === 'policy_gate') {
    if (isGatePassHandle(handle)) return Boolean(output.pass);
    if (isGateFailHandle(handle)) return Boolean(output.fail);
  }

  if (sourceNodeType === 'condition') {
    if (handle === 'true' || handle === 'True') return Boolean(output.true ?? output.value);
    if (handle === 'false' || handle === 'False') return Boolean(output.false ?? !output.value);
  }

  if (
    sourceNodeType === 'switch' ||
    sourceNodeType === 'router' ||
    sourceNodeType === 'classifier'
  ) {
    if (handle in output) {
      const value = output[handle];
      if (typeof value === 'boolean') return value;
      return value !== undefined && value !== null && value !== false;
    }
    const selected = String(output.route ?? output.label ?? output.value ?? '');
    if (handle === 'default') {
      return output.default === true || selected === 'default' || selected === '';
    }
    return handle === selected;
  }

  // Generic handle activation: prefer explicit boolean port, else truthiness of named output
  if (handle in output) {
    const value = output[handle];
    if (typeof value === 'boolean') return value;
    return value !== undefined && value !== null && value !== false;
  }

  // Common aliases for evaluator / human gates / structured output
  if (handle === 'sufficient' || handle === 'approved' || handle === 'success' || handle === 'valid') {
    return Boolean(output.sufficient ?? output.approved ?? output.success ?? output.valid ?? output.true ?? output.value);
  }
  if (handle === 'insufficient' || handle === 'rejected' || handle === 'failure' || handle === 'invalid') {
    return Boolean(
      output.insufficient ??
        output.rejected ??
        output.failure ??
        output.invalid ??
        output.false ??
        !(output.sufficient ?? output.approved ?? output.success ?? output.valid ?? output.value),
    );
  }
  if (handle === 'error' || handle === 'retry' || handle === 'fail' || handle === 'failure') {
    return Boolean(output.error ?? output.retry ?? output.fail ?? output.failure);
  }

  return true;
}

function markInactiveBranch(
  startTarget: string,
  sourceId: string,
  edges: { source: string; target: string }[],
  skipped: Set<string>,
  queued?: Set<string>,
  queue?: string[],
) {
  const q = [startTarget];
  while (q.length) {
    const id = q.shift()!;
    const otherIns = edges.filter((x) => x.target === id && x.source !== sourceId && !skipped.has(x.source));
    if (otherIns.length > 0) continue;
    if (skipped.has(id)) continue;
    skipped.add(id);
    queued?.delete(id);
    if (queue) {
      const idx = queue.indexOf(id);
      if (idx >= 0) queue.splice(idx, 1);
    }
    for (const out of edges.filter((x) => x.source === id)) q.push(out.target);
  }
}

function unskipDescendants(
  sourceId: string,
  edges: { id?: string; source: string; target: string }[],
  skipped: Set<string>,
  feedbackEdgeIds: Set<string> = new Set(),
) {
  const q = edges
    .filter((e) => e.source === sourceId && !(e.id && feedbackEdgeIds.has(e.id)))
    .map((e) => e.target);
  const seen = new Set<string>();
  while (q.length) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    skipped.delete(id);
    for (const out of edges.filter((e) => e.source === id && !(e.id && feedbackEdgeIds.has(e.id)))) {
      q.push(out.target);
    }
  }
}

function selectNodes(workflow: Workflow, options: RunOptions): WorkflowNode[] {
  if (options.mode === 'node' && options.nodeId) {
    return workflow.nodes.filter((n) => n.id === options.nodeId);
  }
  if (options.mode === 'subgraph' && options.nodeIds?.length) {
    const set = new Set(options.nodeIds);
    return workflow.nodes.filter((n) => set.has(n.id));
  }
  if (options.mode === 'from_node' && options.nodeId) {
    const reachable = new Set<string>();
    const queue = [options.nodeId];
    while (queue.length) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const e of workflow.edges) {
        if (e.source === id) queue.push(e.target);
      }
    }
    return workflow.nodes.filter((n) => reachable.has(n.id));
  }
  return workflow.nodes.filter((n) => !n.data.disabled);
}

export async function executeWorkflow(
  workflow: Workflow,
  options: RunOptions = {},
): Promise<WorkflowRun> {
  const resume = options.resume;
  const runId = resume?.pausedRun.id ?? nanoid();
  const startedAt = resume?.pausedRun.startedAt ?? new Date().toISOString();
  const emit = (event: ExecutionEvent) => options.onEvent?.(event);
  const executor = options.executor ?? defaultNodeExecutor;

  if (resume) {
    const pending = resume.pausedRun.pendingApproval;
    if (resume.pausedRun.status !== 'waiting_approval' || !pending?.resumeToken) {
      const run: WorkflowRun = {
        id: runId,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        status: 'error',
        environment: workflow.environment,
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: 0,
        traces: [],
        logs: ['Run is not waiting for approval'],
        error: 'Run is not waiting for approval',
        input: options.input ?? resume.pausedRun.input,
        skillInvocations: [],
      };
      emit({ type: 'run_started', runId });
      emit({ type: 'run_completed', status: 'error' });
      return run;
    }
    if (resume.resumeToken !== pending.resumeToken) {
      const run: WorkflowRun = {
        id: runId,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        status: 'error',
        environment: workflow.environment,
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: 0,
        traces: [],
        logs: ['Invalid resume token'],
        error: 'Invalid resume token',
        input: options.input ?? resume.pausedRun.input,
        skillInvocations: [],
      };
      emit({ type: 'run_started', runId });
      emit({ type: 'run_completed', status: 'error' });
      return run;
    }
    if (resume.nodeId !== pending.nodeId) {
      const run: WorkflowRun = {
        id: runId,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        status: 'error',
        environment: workflow.environment,
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: 0,
        traces: [],
        logs: ['Resume node mismatch'],
        error: 'Resume node mismatch',
        input: options.input ?? resume.pausedRun.input,
        skillInvocations: [],
      };
      emit({ type: 'run_started', runId });
      emit({ type: 'run_completed', status: 'error' });
      return run;
    }
  }

  const errors = validateWorkflow(workflow)
    .filter((i) => i.severity === 'error')
    .filter((i) =>
      options.privilegedPathPreauthorized
        ? i.code !== 'UNGATED_SIDE_EFFECT' && i.code !== 'SIDE_EFFECT_ON_FAIL_BRANCH'
        : true,
    );
  if (errors.length > 0) {
    const run: WorkflowRun = {
      id: runId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      status: 'error',
      environment: workflow.environment,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: 0,
      traces: [],
      logs: errors.map((e) => e.message),
      error: `Validation failed: ${errors.map((e) => e.message).join('; ')}`,
      input: options.input,
      skillInvocations: [],
    };
    emit({ type: 'run_started', runId });
    emit({ type: 'run_completed', status: 'error' });
    return run;
  }

  const nodes = selectNodes(workflow, options);
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const edges = workflow.edges.filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));

  const ctx: ExecutionContext = {
    variables: {
      input: options.input ?? {},
      ...Object.fromEntries(
        workflow.variables.map((v) => [v.name, v.defaultValue]),
      ),
    },
    nodeOutputs: {},
    iteration: 0,
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    toolCallCount: 0,
    fileSandbox: new Map(),
    limits: workflow.limits,
    emit,
    skills: options.skills ?? [],
    skillChains: options.skillChains ?? [],
    skillDepth: options.skillDepth ?? 0,
    allowedSkillIds: options.allowedSkillIds,
    skillInvocations: resume?.pausedRun.skillInvocations
      ? [...resume.pausedRun.skillInvocations]
      : [],
    nodeRunCounts: {},
  };

  const restoredTraces =
    resume?.pausedRun.traces.filter((t) => {
      if (t.status !== 'success') return false;
      const n = nodes.find((node) => node.id === t.nodeId);
      return n ? !isHardGateNodeType(n.data.nodeType) && !isPrivilegedNodeType(n.data.nodeType) : false;
    }) ?? [];
  for (const trace of restoredTraces) {
    if (trace.output && typeof trace.output === 'object' && !Array.isArray(trace.output)) {
      ctx.nodeOutputs[trace.nodeId] = trace.output as Record<string, unknown>;
    }
    ctx.nodeRunCounts[trace.nodeId] = (ctx.nodeRunCounts[trace.nodeId] ?? 0) + 1;
  }
  if (resume?.pausedRun.tokenUsage) {
    ctx.tokenUsage = { ...resume.pausedRun.tokenUsage };
  }
  ctx.toolCallCount = restoredTraces.filter((t) => {
    const n = nodes.find((node) => node.id === t.nodeId);
    return n ? isPrivilegedNodeType(n.data.nodeType) : false;
  }).length;
  const completedIds = new Set(restoredTraces.map((t) => t.nodeId));

  const traces: NodeTrace[] = [...restoredTraces];
  const logs: string[] = resume ? [...(resume.pausedRun.logs ?? [])] : [];
  let status: RunStatus = 'running';
  let pendingApproval: WorkflowRun['pendingApproval'];

  emit({ type: 'run_started', runId });
  logs.push(`Run ${runId} started`);

  const deadline = Date.now() + workflow.limits.maxExecutionTimeMs;
  const feedbackEdgeIds = detectFeedbackEdgeIds(edges);
  const skipped = new Set<string>();
  const queued = new Set<string>();
  const queue: string[] = [];
  let loopExhausted = false;
  let graphLoopCount = 0;

  const byId = new Map(nodes.map((n) => [n.id, n]));

  function incomingEdges(nodeId: string) {
    return edges.filter((e) => e.target === nodeId);
  }

  function isReady(nodeId: string): boolean {
    if (skipped.has(nodeId)) return false;
    const incoming = incomingEdges(nodeId);
    if (incoming.length === 0) return true;
    const required = incoming.filter((e) => !feedbackEdgeIds.has(e.id));
    const waitFor = required.length > 0 ? required : incoming;
    let hasActive = false;
    for (const edge of waitFor) {
      if (skipped.has(edge.source)) continue;
      if (ctx.nodeOutputs[edge.source] === undefined) return false;
      const sourceNode = byId.get(edge.source);
      if (!sourceNode) continue;
      if (!isBranchingEdge(edge, sourceNode.data.nodeType)) {
        hasActive = true;
        continue;
      }
      if (isEdgeActive(edge, sourceNode.data.nodeType, ctx.nodeOutputs[edge.source])) {
        hasActive = true;
      }
    }
    if (hasActive) return true;
    return false;
  }

  function canReenter(node: WorkflowNode): boolean {
    const runs = ctx.nodeRunCounts[node.id] ?? 0;
    return runs < nodeIterationLimit(node, workflow.limits.maxIterations);
  }

  function enqueue(nodeId: string, viaFeedback: boolean) {
    if (skipped.has(nodeId) || queued.has(nodeId)) return;
    const node = byId.get(nodeId);
    if (!node || node.data.disabled) return;
    if (!isReady(nodeId)) return;
    const ran = (ctx.nodeRunCounts[nodeId] ?? 0) > 0 || completedIds.has(nodeId);
    if (ran && !canReenter(node)) {
      loopExhausted = true;
      logs.push(`Loop cap reached on "${node.data.label}" (maxIterations)`);
      return;
    }
    if (viaFeedback) {
      if (graphLoopCount >= workflow.limits.maxIterations) {
        loopExhausted = true;
        logs.push(`Workflow loop cap reached (maxIterations=${workflow.limits.maxIterations})`);
        return;
      }
      graphLoopCount += 1;
      ctx.iteration = graphLoopCount;
      ctx.variables.iteration = ctx.iteration;
    }
    queued.add(nodeId);
    queue.push(nodeId);
  }

  function fanOut(node: WorkflowNode, output: Record<string, unknown>, failed = false) {
    const outgoing = edges.filter((x) => x.source === node.id);
    const branching =
      isBranchingNodeType(node.data.nodeType) ||
      outgoing.some((e) => e.kind === 'conditional' || e.sourceHandle);
    for (const e of outgoing) {
      const autoActivateUnlabeled =
        !failed &&
        output.structuredOutputFailed !== true &&
        !e.sourceHandle &&
        e.kind !== 'conditional' &&
        node.data.nodeType !== 'condition';
      const handle = e.sourceHandle ?? e.label;
      const active =
        autoActivateUnlabeled ||
        (failed
          ? isRecoverableFailureHandle(handle) && isEdgeActive(e, node.data.nodeType, output)
          : isEdgeActive(e, node.data.nodeType, output));
      if (active) {
        emit({ type: 'edge_activated', edgeId: e.id });
        skipped.delete(e.target);
        enqueue(e.target, feedbackEdgeIds.has(e.id));
      } else if (branching || failed) {
        markInactiveBranch(e.target, node.id, edges, skipped, queued, queue);
      }
    }
  }

  for (const node of nodes) {
    if (completedIds.has(node.id) || node.data.disabled) continue;
    if (isReady(node.id)) enqueue(node.id, false);
  }

  try {
    const maxSteps = nodes.length * Math.max(1, workflow.limits.maxIterations) + nodes.length;
    let steps = 0;
    while (queue.length) {
      if (options.signal?.aborted) {
        status = 'cancelled';
        break;
      }
      if (Date.now() > deadline) {
        throw new Error('Execution timed out (maxExecutionTimeMs exceeded)');
      }
      if (ctx.tokenUsage.total > workflow.limits.maxTokenBudget) {
        throw new Error('Token budget exceeded');
      }
      if (++steps > maxSteps) {
        throw new Error('Execution exceeded the iteration work limit');
      }

      const nodeId = queue.shift()!;
      queued.delete(nodeId);
      if (skipped.has(nodeId)) continue;

      const node = byId.get(nodeId);
      if (!node || node.data.disabled) continue;
      if (!isReady(nodeId)) continue;

      if ((ctx.nodeRunCounts[nodeId] ?? 0) > 0) {
        unskipDescendants(nodeId, edges, skipped, feedbackEdgeIds);
      }

      const incoming = incomingEdges(nodeId);
      ctx.nodeRunCounts[nodeId] = (ctx.nodeRunCounts[nodeId] ?? 0) + 1;
      ctx.iteration = Math.max(ctx.iteration, ctx.nodeRunCounts[nodeId] ?? 1);
      ctx.variables.iteration = ctx.iteration;

      const started = new Date().toISOString();
      emit({ type: 'node_started', nodeId, iteration: ctx.nodeRunCounts[nodeId] });
      logs.push(`Node ${node.data.label} started (iteration ${ctx.nodeRunCounts[nodeId]})`);

      const input = collectNodeInput(node, { ...workflow, nodes, edges }, ctx, options.input ?? {}, feedbackEdgeIds);

      if (node.data.nodeType === 'human_approval') {
        const payloadHash = await hashPayload(input);
        if (resume && resume.nodeId === node.id) {
          if (resume.payloadHash !== payloadHash) {
            throw new Error(
              'Approval payload hash mismatch — the proposal changed and cannot be resumed',
            );
          }
        } else {
          const token = nanoid();
          pendingApproval = {
            nodeId,
            resumeToken: token,
            payloadHash,
            payload: input,
            message: String(node.data.config.message ?? 'Please approve to continue'),
          };
          status = 'waiting_approval';
          const pauseTrace: NodeTrace = {
            nodeId,
            status: 'waiting_approval',
            startedAt: started,
            endedAt: new Date().toISOString(),
            iteration: ctx.nodeRunCounts[nodeId],
            input,
            retryHistory: [],
            gateTrace: {
              kind: 'authority',
              input,
              approved: false,
              branch: 'waiting',
              payloadHash,
              reason: String(node.data.config.message ?? 'Please approve to continue'),
            },
          };
          traces.push(pauseTrace);
          emit({ type: 'waiting_approval', nodeId, resumeToken: token, payloadHash });
          logs.push(`Node ${node.data.label} waiting for approval (${payloadHash.slice(0, 8)}…)`);
          break;
        }
      }

      if (
        workflow.limits.requireGateBeforeSideEffects !== false &&
        !options.privilegedPathPreauthorized &&
        isPrivilegedNodeType(node.data.nodeType)
      ) {
        const authorized = privilegedPathAuthorized(
          node.id,
          nodes,
          edges,
          ctx.nodeOutputs,
          (edge) => {
            if (skipped.has(edge.source)) return false;
            const sourceNode = nodes.find((n) => n.id === edge.source);
            if (!sourceNode) return false;
            const output = ctx.nodeOutputs[edge.source];
            if (output === undefined) return false;
            const isBranching = isBranchingEdge(edge, sourceNode.data.nodeType);
            if (!isBranching) return true;
            return isEdgeActive(edge, sourceNode.data.nodeType, output);
          },
        );
        if (!authorized) {
          throw new Error(
            `${SIDE_EFFECT_BLOCKED_CODE}: Side effect "${node.data.label}" blocked: every active incoming path must come through a hard gate that authorized this run`,
          );
        }
      }
      if (isPrivilegedNodeType(node.data.nodeType)) {
        consumeToolCall(ctx);
      }
      const trace: NodeTrace = {
        nodeId,
        status: 'running',
        startedAt: started,
        iteration: ctx.nodeRunCounts[nodeId],
        input,
        retryHistory: [],
      };

      try {
        const output =
          node.data.nodeType === 'human_approval' && resume && resume.nodeId === node.id
            ? {
                approved: resume.approved,
                rejected: !resume.approved,
                interactive: true,
                authority: resume.approved,
                payloadHash: resume.payloadHash,
                resumeToken: resume.resumeToken,
                approvedBy: resume.approvedBy ?? 'operator',
                payload: input,
              }
            : isSkillInvocationNode(node.data.nodeType)
              ? await invokeNestedSkill(
                  node,
                  input,
                  ctx,
                  options,
                  incoming.some((e) => {
                    if (skipped.has(e.source)) return false;
                    const sourceNode = nodes.find((n) => n.id === e.source);
                    if (!sourceNode) return false;
                    const output = ctx.nodeOutputs[e.source];
                    if (!output) return false;
                    const handle = (e.sourceHandle ?? e.label ?? '').toLowerCase();
                    if (handle !== 'pass' && handle !== 'approved') return false;
                    return isEdgeActive(e, sourceNode.data.nodeType, output);
                  }),
                )
              : await executor(node, input, ctx);
        if (structuredOutputEnabled(node.data.config)) {
          const raw = output.result ?? output.completion ?? output.json ?? output;
          const structured = evaluateStructuredOutput(node.data.config, raw);
          output.valid = structured.ok;
          output.invalid = !structured.ok;
          output.structuredOutputFailed = !structured.ok;
          output.reason = structured.reason;
          if (structured.ok) {
            output.result = structured.value;
            if ('completion' in output) output.completion = structured.value;
          }
        }
        if (output.structuredOutputFailed === true) {
          const hasInvalidEdge = edges.some(
            (e) => e.source === nodeId && isGateFailHandle(e.sourceHandle ?? e.label ?? ''),
          );
          if (!hasInvalidEdge) {
            throw new Error(
              `Structured output failed on "${node.data.label}": ${String(output.reason ?? 'schema mismatch')}`,
            );
          }
        }
        promoteStructuredFields(output, promotionHandlesFor(node));
        ctx.nodeOutputs[nodeId] = output;

        // Also index by label for expression convenience
        const labelKey = node.data.label.replace(/\s+/g, '_').toLowerCase();
        ctx.variables[labelKey] = output;
        if (output.result !== undefined) ctx.variables[`${labelKey}.output`] = output.result;
        if (output.value !== undefined) ctx.variables[`${labelKey}.output`] = output.value;

        const ended = new Date().toISOString();
        trace.status = 'success';
        trace.endedAt = ended;
        trace.durationMs = new Date(ended).getTime() - new Date(started).getTime();
        trace.output = output;
        trace.gateTrace = captureGateTrace(node.data.nodeType, input, output);
        if (isSkillInvocationNode(node.data.nodeType) && node.data.nodeType !== 'skill_chain') {
          const skillId = String(node.data.config.skillId ?? node.data.skillId ?? '');
          if (skillId) {
            trace.skillId = skillId;
            trace.skillSlug = ctx.skills.find((s) => s.id === skillId)?.slug;
            const invocation = [...ctx.skillInvocations].reverse().find((i) => i.skillId === skillId);
            if (invocation?.tokenUsage) {
              trace.aiDetails = {
                ...(trace.aiDetails ?? {}),
                tokenUsage: invocation.tokenUsage,
              };
            }
          }
        }
        if (node.data.category === 'agent') {
          trace.aiDetails = {
            model: (node.data.config.model as { model?: string } | undefined)?.model,
            response: String(output.result ?? output.completion ?? ''),
            tokenUsage: { ...ctx.tokenUsage },
          };
        }
        emit({ type: 'node_completed', nodeId, status: 'success', output });
        logs.push(`Node ${node.data.label} completed`);
        fanOut(node, output);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const recoverable =
          !isFatalExecutionError(message) &&
          edges.some(
            (e) => e.source === nodeId && isRecoverableFailureHandle(e.sourceHandle ?? e.label),
          );
        trace.status = 'error';
        trace.endedAt = new Date().toISOString();
        trace.error = { message, type: 'ExecutionError' };
        trace.retryHistory = [...(trace.retryHistory ?? []), { message, recovered: recoverable }];
        emit({ type: 'node_failed', nodeId, error: message });
        if (!recoverable) {
          logs.push(`Node ${node.data.label} failed: ${message}`);
          traces.push(trace);
          status = 'error';
          throw err;
        }
        const output = {
          fail: true,
          error: true,
          retry: true,
          success: false,
          reason: message,
          result: { error: message },
        };
        ctx.nodeOutputs[nodeId] = output;
        trace.output = output;
        logs.push(`Node ${node.data.label} failed (recoverable): ${message}`);
        traces.push(trace);
        fanOut(node, output, true);
        continue;
      }

      traces.push(trace);
    }

    if (status === 'running') {
      const outputRan = nodes.some(
        (n) => n.data.nodeType === 'output' && ctx.nodeOutputs[n.id] !== undefined,
      );
      if (loopExhausted && !outputRan) {
        throw new Error('Loop exceeded maxIterations without reaching an output');
      }
      status = 'success';
    }
  } catch (err) {
    status = 'error';
    logs.push(err instanceof Error ? err.message : String(err));
  }

  const endedAt = new Date().toISOString();
  const outputNode = nodes.find((n) => n.data.nodeType === 'output');
  const output = outputNode
    ? ctx.nodeOutputs[outputNode.id]
    : Object.values(ctx.nodeOutputs).at(-1);

  const run: WorkflowRun = {
    id: runId,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    status,
    environment: workflow.environment,
    startedAt,
    endedAt,
    durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
    tokenUsage: ctx.tokenUsage,
    traces,
    logs,
    input: options.input ?? resume?.pausedRun.input,
    output,
    error: status === 'error' ? logs.at(-1) : undefined,
    pendingApproval: status === 'waiting_approval' ? pendingApproval : undefined,
    skillInvocations: ctx.skillInvocations,
  };

  emit({ type: 'run_completed', status });
  return run;
}

const MAX_SKILL_DEPTH = 8;

function isSkillInvocationNode(type: string): boolean {
  return type === 'skill' || type === 'published_skill' || type === 'skill_chain';
}

function nestedSkillInput(input: Record<string, unknown>): Record<string, unknown> {
  if (input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)) {
    return input.payload as Record<string, unknown>;
  }
  if (input.value && typeof input.value === 'object' && !Array.isArray(input.value)) {
    return input.value as Record<string, unknown>;
  }
  if (input.input && typeof input.input === 'object' && !Array.isArray(input.input)) {
    return input.input as Record<string, unknown>;
  }
  return input;
}

function skillRunOutput(run: WorkflowRun, label: string): Record<string, unknown> {
  if (run.status === 'waiting_approval') {
    throw new Error(`Nested skill "${label}" is waiting for approval`);
  }
  if (run.status !== 'success') {
    throw new Error(run.error ?? `Nested skill "${label}" failed`);
  }
  const out = run.output;
  if (out && typeof out === 'object' && !Array.isArray(out)) {
    return out as Record<string, unknown>;
  }
  return { output: out, result: out };
}

async function invokeNestedSkill(
  node: WorkflowNode,
  input: Record<string, unknown>,
  ctx: ExecutionContext,
  options: RunOptions,
  privilegedPathPreauthorized: boolean,
): Promise<Record<string, unknown>> {
  if (ctx.skillDepth >= MAX_SKILL_DEPTH) {
    throw new Error('Skill nesting exceeded');
  }
  const nestedInput = nestedSkillInput(input);
  const nestedOptions: RunOptions = {
    ...options,
    input: nestedInput,
    resume: undefined,
    skills: ctx.skills,
    skillChains: ctx.skillChains,
    skillDepth: ctx.skillDepth + 1,
    allowedSkillIds: ctx.allowedSkillIds,
    privilegedPathPreauthorized,
  };

  if (node.data.nodeType === 'skill_chain') {
    const chainId = String(node.data.config.chainId ?? '');
    const chain = ctx.skillChains.find((c) => c.id === chainId);
    if (!chain) throw new Error(`Skill chain "${chainId || node.data.label}" was not found`);
    const run = await executeSkillChain(chain, ctx.skills, nestedOptions);
    rollupNestedUsage(ctx, run);
    return skillRunOutput(run, node.data.label);
  }

  const skillId = String(node.data.config.skillId ?? node.data.skillId ?? '').trim();
  if (!skillId) throw new Error(`"${node.data.label}" requires a skill reference`);
  if (ctx.allowedSkillIds && !ctx.allowedSkillIds.includes(skillId)) {
    throw new Error(`Skill "${skillId}" is not on the chain allowlist`);
  }
  const skill = ctx.skills.find((s) => s.id === skillId);
  if (!skill) throw new Error(`Skill "${skillId}" was not found`);
  if (!skill.internalWorkflow) {
    throw new Error(`Skill "${skill.name}" has no internal workflow`);
  }
  const overlay = ctx.allowedSkillIds
    ? ctx.skillChains[0]?.skills.find((ref) => ref.skillId === skillId)?.configuration
    : undefined;
  const resolved = applySkillConfiguration(skill, overlay);
  const run = await executeWorkflow(withSkillEntry(resolved.internalWorkflow!), nestedOptions);
  rollupNestedUsage(ctx, run);
  const gates = run.traces.filter((t) => t.gateTrace);
  ctx.skillInvocations.push({
    skillId: skill.id,
    skillSlug: skill.slug,
    name: skill.name,
    role: skill.role ?? 'member',
    status: run.status,
    durationMs: run.durationMs,
    tokenUsage: run.tokenUsage,
    skipped: false,
    gatesEvaluated: gates.length,
    gatesPassed: gates.filter(
      (t) =>
        t.gateTrace?.pass === true ||
        t.gateTrace?.approved === true ||
        t.gateTrace?.branch === 'pass' ||
        t.gateTrace?.branch === 'approved',
    ).length,
  });
  return skillRunOutput(run, skill.name);
}

function rollupNestedUsage(ctx: ExecutionContext, run: WorkflowRun): void {
  if (run.tokenUsage) {
    ctx.tokenUsage.prompt += run.tokenUsage.prompt;
    ctx.tokenUsage.completion += run.tokenUsage.completion;
    ctx.tokenUsage.total += run.tokenUsage.total;
  }
  ctx.skillInvocations.push(...run.skillInvocations);
}

/** Run a chain through its supervisor skill (legacy chains fall back to the first member). */
export async function executeSkillChain(
  chain: SkillChain,
  skills: Skill[],
  options: RunOptions = {},
): Promise<WorkflowRun> {
  const safeChain = normalizeSkillChain(chain);
  const safeSkills = skills.map((skill) => normalizeSkill(skill));
  const allowedSkillIds = safeChain.skills.map((ref) => ref.skillId);
  const supervisor = safeChain.supervisorSkillId
    ? safeSkills.find((s) => s.id === safeChain.supervisorSkillId)
    : undefined;
  const run = supervisor?.internalWorkflow
    ? await executeWorkflow(supervisor.internalWorkflow, {
        ...options,
        skills: safeSkills,
        skillChains: [safeChain, ...(options.skillChains ?? [])],
        allowedSkillIds,
      })
    : await (async () => {
        const first = safeSkills.find((s) => s.id === safeChain.skills[0]?.skillId);
        if (!first?.internalWorkflow) {
          throw new Error('Skill chain has no supervisor or executable member skill');
        }
        return executeWorkflow(withSkillEntry(first.internalWorkflow), {
          ...options,
          skills: safeSkills,
          skillChains: [safeChain, ...(options.skillChains ?? [])],
          allowedSkillIds,
        });
      })();
  run.chainId = safeChain.id;
  run.chainSlug = safeChain.slug;
  run.effectiveness = measureChainRun(run, safeChain, safeSkills);
  return run;
}

export async function resumeWorkflow(
  workflow: Workflow,
  pausedRun: WorkflowRun,
  decision: { approved: boolean; approvedBy?: string; resumeToken?: string },
  options: Omit<RunOptions, 'resume' | 'input'> = {},
): Promise<WorkflowRun> {
  const pending = pausedRun.pendingApproval;
  if (pausedRun.status !== 'waiting_approval' || !pending) {
    throw new Error('Run is not waiting for approval');
  }
  const token = decision.resumeToken ?? pending.resumeToken;
  if (token !== pending.resumeToken) {
    throw new Error('Invalid resume token');
  }
  const input =
    pausedRun.input && typeof pausedRun.input === 'object' && !Array.isArray(pausedRun.input)
      ? (pausedRun.input as Record<string, unknown>)
      : {};
  return executeWorkflow(workflow, {
    ...options,
    input,
    resume: {
      pausedRun,
      nodeId: pending.nodeId,
      resumeToken: token,
      payloadHash: pending.payloadHash,
      approved: decision.approved,
      approvedBy: decision.approvedBy,
    },
  });
}
