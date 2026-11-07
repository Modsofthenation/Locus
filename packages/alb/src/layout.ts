import dagre from '@dagrejs/dagre';
import { LOOP_BACK_HANDLES } from './graph.js';
import type { Workflow, WorkflowNode } from './schema/index.js';

export type LayoutDirection = 'LR' | 'TB';

export interface LayoutOptions {
  direction?: LayoutDirection;
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
  /** Horizontal gap between disconnected components. */
  componentSep?: number;
}

const DEFAULTS = {
  direction: 'LR' as LayoutDirection,
  nodeWidth: 220,
  nodeHeight: 96,
  rankSep: 140,
  nodeSep: 72,
  componentSep: 96,
};

/** Keep a DAG for ranking so feedback loops don't collapse two nodes onto the same rank. */
function acyclicEdges(edges: Workflow['edges']): Workflow['edges'] {
  const adj = new Map<string, Set<string>>();

  function reaches(from: string, to: string): boolean {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === to) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of adj.get(cur) ?? []) stack.push(next);
    }
    return false;
  }

  function rank(edge: Workflow['edges'][number]): number {
    if (edge.kind === 'conditional' && edge.sourceHandle && LOOP_BACK_HANDLES.has(edge.sourceHandle)) {
      return 2;
    }
    if (edge.kind === 'conditional') return 1;
    return 0;
  }

  const kept: Workflow['edges'] = [];
  const ordered = [...edges].sort((a, b) => rank(a) - rank(b));
  for (const edge of ordered) {
    if (edge.source === edge.target) continue;
    if (reaches(edge.target, edge.source)) continue;
    if (!adj.has(edge.source)) adj.set(edge.source, new Set());
    adj.get(edge.source)!.add(edge.target);
    kept.push(edge);
  }
  return kept;
}

function connectedComponents(workflow: Workflow): string[][] {
  const ids = workflow.nodes.map((n) => n.id);
  const adj = new Map<string, Set<string>>();
  for (const id of ids) adj.set(id, new Set());
  for (const edge of workflow.edges) {
    if (!adj.has(edge.source) || !adj.has(edge.target)) continue;
    adj.get(edge.source)!.add(edge.target);
    adj.get(edge.target)!.add(edge.source);
  }

  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const stack = [id];
    const component: string[] = [];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      component.push(cur);
      for (const next of adj.get(cur) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

function layoutComponent(
  nodes: WorkflowNode[],
  edges: Workflow['edges'],
  options: Required<LayoutOptions>,
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: options.direction,
    ranksep: options.rankSep,
    nodesep: options.nodeSep,
    marginx: 24,
    marginy: 24,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: options.nodeWidth, height: options.nodeHeight });
  }
  for (const edge of acyclicEdges(edges)) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const laid = g.node(node.id);
    if (!laid) continue;
    positions.set(node.id, {
      x: laid.x - options.nodeWidth / 2,
      y: laid.y - options.nodeHeight / 2,
    });
  }
  return positions;
}

/** Compute dagre positions for workflow nodes (does not mutate input). */
export function autoLayoutWorkflow(
  workflow: Workflow,
  options: LayoutOptions = {},
): WorkflowNode[] {
  const opts: Required<LayoutOptions> = {
    direction: options.direction ?? DEFAULTS.direction,
    nodeWidth: options.nodeWidth ?? DEFAULTS.nodeWidth,
    nodeHeight: options.nodeHeight ?? DEFAULTS.nodeHeight,
    rankSep: options.rankSep ?? DEFAULTS.rankSep,
    nodeSep: options.nodeSep ?? DEFAULTS.nodeSep,
    componentSep: options.componentSep ?? DEFAULTS.componentSep,
  };

  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  const components = connectedComponents(workflow);
  const finalPositions = new Map<string, { x: number; y: number }>();

  let offsetX = 0;
  let offsetY = 0;

  for (const component of components) {
    const nodes = component.map((id) => byId.get(id)!);
    const idSet = new Set(component);
    const edges = workflow.edges.filter(
      (e) => idSet.has(e.source) && idSet.has(e.target),
    );
    const positions = layoutComponent(nodes, edges, opts);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pos of positions.values()) {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + opts.nodeWidth);
      maxY = Math.max(maxY, pos.y + opts.nodeHeight);
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = opts.nodeWidth;
      maxY = opts.nodeHeight;
    }

    for (const [id, pos] of positions) {
      finalPositions.set(id, {
        x: pos.x - minX + offsetX,
        y: pos.y - minY + offsetY,
      });
    }

    if (opts.direction === 'LR') {
      offsetY += maxY - minY + opts.componentSep;
    } else {
      offsetX += maxX - minX + opts.componentSep;
    }
  }

  return workflow.nodes.map((node) => {
    const position = finalPositions.get(node.id);
    if (!position) return node;
    return { ...node, position };
  });
}
