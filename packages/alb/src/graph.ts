import type { WorkflowEdge, WorkflowNode } from './schema/index.js';

/** Ports that typically feed a retry / loop-back edge rather than the forward path. */
export const LOOP_BACK_HANDLES = new Set([
  'insufficient',
  'invalid',
  'fail',
  'failure',
  'rejected',
  'false',
  'retry',
  'continue',
  'revise',
  'search',
  'act',
]);

export function isLoopBackHandle(handle: string | undefined): boolean {
  return Boolean(handle && LOOP_BACK_HANDLES.has(handle));
}

/** Self-loops and DFS back-edges. Forward `false`/`search` branches are not feedback. */
export function detectFeedbackEdgeIds(
  edges: Pick<WorkflowEdge, 'id' | 'source' | 'target' | 'sourceHandle' | 'kind'>[],
): Set<string> {
  const ids = new Set<string>();
  const adj = new Map<string, { id: string; target: string }[]>();
  const nodes = new Set<string>();

  for (const edge of edges) {
    nodes.add(edge.source);
    nodes.add(edge.target);
    const list = adj.get(edge.source);
    if (list) list.push({ id: edge.id, target: edge.target });
    else adj.set(edge.source, [{ id: edge.id, target: edge.target }]);
    if (edge.source === edge.target) ids.add(edge.id);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of nodes) color.set(id, WHITE);

  function dfs(nodeId: string) {
    color.set(nodeId, GRAY);
    for (const edge of adj.get(nodeId) ?? []) {
      const next = color.get(edge.target) ?? WHITE;
      if (next === GRAY) ids.add(edge.id);
      else if (next === WHITE) dfs(edge.target);
    }
    color.set(nodeId, BLACK);
  }

  for (const id of nodes) {
    if (color.get(id) === WHITE) dfs(id);
  }
  return ids;
}

export function nodeIterationLimit(
  node: Pick<WorkflowNode, 'data'>,
  workflowLimit: number,
): number {
  const workflowCap = Math.max(1, Math.floor(Number(workflowLimit)) || 1);
  const configured = Number(node.data.config.maxIterations ?? workflowLimit);
  const n =
    Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : workflowCap;
  return Math.min(Math.max(1, n), workflowCap);
}
