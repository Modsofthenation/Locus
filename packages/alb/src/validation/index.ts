import type { Workflow, WorkflowEdge, WorkflowNode } from '../schema/index.js';
import { extractReferences, parsePredicate } from '../expressions/index.js';
import { isValidVersionRange } from '../versions.js';
import { findUngatedSideEffects, schemaGateConfigError } from '../gates.js';
import { structuredOutputEnabled, structuredOutputSchema } from '../contracts.js';
import { pinnedScriptConfigError } from '../scripts.js';
import { filePathAllowlist, httpUrlAllowlist } from '../privileged.js';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

function buildAdjacency(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  const outs = new Map<string, string[]>();
  const ins = new Map<string, string[]>();
  for (const n of nodes) {
    outs.set(n.id, []);
    ins.set(n.id, []);
  }
  for (const e of edges) {
    outs.get(e.source)?.push(e.target);
    ins.get(e.target)?.push(e.source);
  }
  return { outs, ins };
}

function detectCycles(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[][] {
  const { outs } = buildAdjacency(nodes, edges);
  const visited = new Set<string>();
  const stack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(nodeId: string, path: string[]) {
    if (stack.has(nodeId)) {
      const idx = path.indexOf(nodeId);
      cycles.push(path.slice(idx));
      return;
    }
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    stack.add(nodeId);
    for (const next of outs.get(nodeId) ?? []) {
      dfs(next, [...path, next]);
    }
    stack.delete(nodeId);
  }

  for (const n of nodes) {
    dfs(n.id, [n.id]);
  }
  return cycles;
}

export function validateWorkflow(workflow: Workflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(workflow.nodes.map((n) => n.id));

  if (workflow.nodes.length === 0) {
    issues.push({
      id: 'empty-workflow',
      severity: 'warning',
      code: 'EMPTY_WORKFLOW',
      message: 'Workflow has no nodes',
    });
  }

  const inputNodes = workflow.nodes.filter((n) => n.data.nodeType === 'input');
  const outputNodes = workflow.nodes.filter((n) => n.data.nodeType === 'output');

  if (workflow.nodes.length > 0 && inputNodes.length === 0) {
    issues.push({
      id: 'missing-input',
      severity: 'warning',
      code: 'MISSING_INPUT',
      message: 'Workflow has no Input node',
    });
  }
  if (workflow.nodes.length > 0 && outputNodes.length === 0) {
    issues.push({
      id: 'missing-output',
      severity: 'warning',
      code: 'MISSING_OUTPUT',
      message: 'Workflow has no Output node',
    });
  }

  for (const node of workflow.nodes) {
    const { data } = node;

    if (data.disabled) continue;

    for (const input of data.inputs) {
      if (!input.required) continue;
      const connected = workflow.edges.some(
        (e) => e.target === node.id && (!e.targetHandle || e.targetHandle === input.id),
      );
      if (!connected && data.nodeType !== 'input') {
        issues.push({
          id: `missing-conn-${node.id}-${input.id}`,
          severity: 'error',
          code: 'MISSING_CONNECTION',
          message: `Required input "${input.name}" on "${data.label}" is not connected`,
          nodeId: node.id,
        });
      }
    }

    if (
      (data.nodeType === 'agent' || data.nodeType === 'llm' || data.nodeType === 'react_agent') &&
      !(data.config.model as { model?: string } | undefined)?.model
    ) {
      issues.push({
        id: `missing-model-${node.id}`,
        severity: 'error',
        code: 'MISSING_MODEL',
        message: `"${data.label}" requires a model`,
        nodeId: node.id,
      });
    }

    if (data.nodeType === 'tool_call' && !data.config.toolId) {
      issues.push({
        id: `missing-tool-${node.id}`,
        severity: 'error',
        code: 'MISSING_TOOL',
        message: `"${data.label}" requires a tool`,
        nodeId: node.id,
      });
    }

    if (data.nodeType === 'code_execution') {
      const scriptError = pinnedScriptConfigError(data.config);
      if (scriptError) {
        issues.push({
          id: `pinned-script-${node.id}`,
          severity: 'error',
          code: 'INVALID_SCRIPT',
          message: `"${data.label}" ${scriptError}`,
          nodeId: node.id,
        });
      }
    }

    if (data.nodeType === 'http_request' && httpUrlAllowlist(data.config).length === 0) {
      issues.push({
        id: `http-url-${node.id}`,
        severity: 'error',
        code: 'INVALID_HTTP',
        message: `"${data.label}" requires a pinned URL or urlAllowlist`,
        nodeId: node.id,
      });
    }

    if (data.nodeType === 'file_operation' && filePathAllowlist(data.config).length === 0) {
      issues.push({
        id: `file-allow-${node.id}`,
        severity: 'error',
        code: 'INVALID_FILE',
        message: `"${data.label}" requires a path allowlist`,
        nodeId: node.id,
      });
    }

    if (structuredOutputEnabled(data.config)) {
      const schemaError = schemaGateConfigError({
        jsonSchema: structuredOutputSchema(data.config),
      });
      if (schemaError) {
        issues.push({
          id: `structured-output-${node.id}`,
          severity: 'error',
          code: 'INVALID_STRUCTURED_OUTPUT',
          message: `"${data.label}" ${schemaError.replace('JSON schema', 'output schema')}`,
          nodeId: node.id,
        });
      }
    }

    if (data.nodeType === 'condition') {
      const expr = String(data.config.expression ?? '');
      if (!expr.trim()) {
        issues.push({
          id: `invalid-expr-${node.id}`,
          severity: 'error',
          code: 'INVALID_EXPRESSION',
          message: `"${data.label}" has an empty condition expression`,
          nodeId: node.id,
        });
      } else if (!expr.includes('{{') && expr !== 'true' && expr !== 'false' && !parsePredicate(expr)) {
        // Allow bare paths
        const refs = extractReferences(`{{${expr}}}`);
        if (refs.length === 0 && !/^[a-zA-Z0-9_.]+$/.test(expr)) {
          issues.push({
            id: `invalid-expr-${node.id}`,
            severity: 'error',
            code: 'INVALID_EXPRESSION',
            message: `"${data.label}" has an invalid condition expression`,
            nodeId: node.id,
          });
        }
      }
    }

    if (data.nodeType === 'loop' || data.nodeType === 'react_agent' || data.nodeType === 'agent') {
      const maxIter =
        Number(data.config.maxIterations ?? workflow.limits.maxIterations) || 0;
      if (maxIter <= 0) {
        issues.push({
          id: `infinite-loop-${node.id}`,
          severity: 'error',
          code: 'INFINITE_LOOP_RISK',
          message: `"${data.label}" must have a bounded maxIterations`,
          nodeId: node.id,
        });
      } else if (maxIter > 100) {
        issues.push({
          id: `high-iter-${node.id}`,
          severity: 'warning',
          code: 'INFINITE_LOOP_RISK',
          message: `"${data.label}" has a very high iteration limit (${maxIter})`,
          nodeId: node.id,
        });
      }
    }

    if (
      (data.nodeType === 'skill' || data.nodeType === 'published_skill') &&
      !data.config.skillId &&
      !data.skillId
    ) {
      issues.push({
        id: `missing-skill-${node.id}`,
        severity: 'error',
        code: 'MISSING_SKILL_INPUT',
        message: `"${data.label}" requires a skill reference`,
        nodeId: node.id,
      });
    }

    if (data.nodeType === 'schema_gate') {
      const gateError = schemaGateConfigError(data.config);
      if (gateError) {
        issues.push({
          id: `missing-schema-${node.id}`,
          severity: 'error',
          code: 'INVALID_GATE',
          message: `"${data.label}" ${gateError}`,
          nodeId: node.id,
        });
      }
    }

    if (data.nodeType === 'policy_gate') {
      const expr = String(data.config.expression ?? '').trim();
      const allowlist = String(
        Array.isArray(data.config.allowlist)
          ? data.config.allowlist.join(',')
          : (data.config.allowlist ?? ''),
      ).trim();
      if (!expr && !allowlist) {
        issues.push({
          id: `empty-policy-${node.id}`,
          severity: 'error',
          code: 'INVALID_GATE',
          message: `"${data.label}" requires an expression or allowlist`,
          nodeId: node.id,
        });
      }
    }

    if (
      data.nodeType === 'skill' ||
      data.nodeType === 'published_skill' ||
      data.nodeType === 'sub_workflow'
    ) {
      const rawRange = String(data.config.versionRange ?? '').trim();
      const pinned = String(data.config.skillVersion ?? data.config.pinnedVersion ?? '').trim();
      const range = rawRange || (pinned ? pinned : '');
      if (range && !isValidVersionRange(range)) {
        issues.push({
          id: `bad-range-${node.id}`,
          severity: 'error',
          code: 'INVALID_VERSION_RANGE',
          message: `"${data.label}" has an invalid version range "${range}"`,
          nodeId: node.id,
        });
      }
    }
  }

  if (workflow.limits.requireGateBeforeSideEffects !== false) {
    for (const issue of findUngatedSideEffects(workflow)) {
      issues.push({
        id: `${issue.code}-${issue.nodeId}`,
        severity: 'error',
        code: issue.code,
        message: issue.message,
        nodeId: issue.nodeId,
      });
    }
  }

  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        id: `dangling-edge-${edge.id}`,
        severity: 'error',
        code: 'MISSING_CONNECTION',
        message: `Edge ${edge.id} references a missing node`,
        edgeId: edge.id,
      });
    }
  }

  // Unreachable nodes (no path from any input)
  if (inputNodes.length > 0) {
    const { outs } = buildAdjacency(workflow.nodes, workflow.edges);
    const reachable = new Set<string>();
    const queue = inputNodes.map((n) => n.id);
    while (queue.length) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const next of outs.get(id) ?? []) queue.push(next);
    }
    for (const node of workflow.nodes) {
      if (!reachable.has(node.id) && node.data.nodeType !== 'input') {
        issues.push({
          id: `unreachable-${node.id}`,
          severity: 'warning',
          code: 'UNREACHABLE_NODE',
          message: `"${node.data.label}" is unreachable from an Input node`,
          nodeId: node.id,
        });
      }
    }
  }

  // Cycles — allowed for intentional loops, but flag when no loop/agent node involved
  const cycles = detectCycles(workflow.nodes, workflow.edges);
  for (const cycle of cycles) {
    const involvesLoop = cycle.some((id) => {
      const n = workflow.nodes.find((x) => x.id === id);
      if (!n) return false;
      return (
        n.data.category === 'agent' ||
        n.data.category === 'skill' ||
        n.data.nodeType === 'loop' ||
        n.data.nodeType === 'retry' ||
        n.data.nodeType === 'condition' ||
        n.data.nodeType === 'switch' ||
        n.data.nodeType === 'schema_gate' ||
        n.data.nodeType === 'policy_gate' ||
        n.data.nodeType === 'web_search' ||
        n.data.nodeType === 'tool_call'
      );
    });
    if (!involvesLoop) {
      issues.push({
        id: `cycle-${cycle.join('-')}`,
        severity: 'error',
        code: 'CIRCULAR_DEPENDENCY',
        message: `Circular dependency detected: ${cycle.join(' → ')}`,
        nodeId: cycle[0],
      });
    } else {
      issues.push({
        id: `loop-cycle-${cycle.join('-')}`,
        severity: 'warning',
        code: 'INFINITE_LOOP_RISK',
        message: `Loop cycle detected (${cycle.length} nodes). Ensure maxIterations is bounded.`,
        nodeId: cycle[0],
      });
    }
  }

  if (!workflow.limits.maxIterations || workflow.limits.maxIterations < 1) {
    issues.push({
      id: 'limits-iter',
      severity: 'error',
      code: 'INFINITE_LOOP_RISK',
      message: 'Workflow must define a positive maxIterations limit',
    });
  }

  return issues;
}

export function attachValidationToNodes(
  workflow: Workflow,
  issues: ValidationIssue[],
): Workflow {
  const byNode = new Map<string, string[]>();
  for (const issue of issues) {
    if (!issue.nodeId) continue;
    const list = byNode.get(issue.nodeId) ?? [];
    list.push(issue.message);
    byNode.set(issue.nodeId, list);
  }
  return {
    ...workflow,
    nodes: workflow.nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        validationErrors: byNode.get(n.id) ?? [],
        status: byNode.has(n.id) ? 'warning' : n.data.status === 'warning' ? 'default' : n.data.status,
      },
    })),
  };
}
