import { nanoid } from 'nanoid';
import { DEFAULT_EXECUTION_LIMITS, type Workflow, type WorkflowEdge, type WorkflowNode } from './schema/index.js';
import { createNodeData } from './catalog.js';

export function createEmptyWorkflow(name = 'Untitled Workflow'): Workflow {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    name,
    description: '',
    version: '0.1.0',
    status: 'draft',
    environment: 'development',
    nodes: [],
    edges: [],
    variables: [],
    limits: { ...DEFAULT_EXECUTION_LIMITS },
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createNode(
  type: Parameters<typeof createNodeData>[0],
  position: { x: number; y: number },
  label?: string,
): WorkflowNode {
  return {
    id: nanoid(),
    type: 'workflowNode',
    position,
    data: createNodeData(type, label),
  };
}

export function createEdge(
  source: string,
  target: string,
  opts: Partial<Omit<WorkflowEdge, 'id' | 'source' | 'target'>> = {},
): WorkflowEdge {
  return {
    id: `e-${source}-${target}-${nanoid(4)}`,
    source,
    target,
    kind: opts.kind ?? 'control',
    label: opts.label,
    sourceHandle: opts.sourceHandle,
    targetHandle: opts.targetHandle,
    dataMapping: opts.dataMapping,
  };
}

/** Horizontal template spacing that matches left/right handles and leaves room for loop-back edges. */
export const TEMPLATE_COL = 280;
export const TEMPLATE_ROW = 176;
const TEMPLATE_ORIGIN = { x: 48, y: 88 };

export function templateAt(col: number, row = 0): { x: number; y: number } {
  return {
    x: TEMPLATE_ORIGIN.x + col * TEMPLATE_COL,
    y: TEMPLATE_ORIGIN.y + row * TEMPLATE_ROW,
  };
}

