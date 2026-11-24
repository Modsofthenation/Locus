import type {
  RunStatus,
  Skill,
  SkillChain,
  SkillInvocation,
  Workflow,
  WorkflowNode,
} from '../schema/index.js';
import type { ApprovalResume } from '../approval.js';

export type ExecutionMode = 'full' | 'node' | 'subgraph' | 'from_node';

export interface RunOptions {
  mode?: ExecutionMode;
  nodeId?: string;
  nodeIds?: string[];
  input?: Record<string, unknown>;
  /** Inject a mock LLM/tool handler for tests and local dry-runs */
  executor?: NodeExecutor;
  signal?: AbortSignal;
  onEvent?: (event: ExecutionEvent) => void;
  /** Resume a run paused on a human-approval node. */
  resume?: ApprovalResume;
  /** Registry used to resolve nested skill / published_skill / skill_chain nodes. */
  skills?: Skill[];
  skillChains?: SkillChain[];
  /** Nesting depth for supervisor → member invocation. */
  skillDepth?: number;
  /** When set, nested skill ids must be in this list (chain execution). */
  allowedSkillIds?: string[];
  /**
   * Nested member runs: supervisor already routed this invocation through a
   * hard-gate pass/approved edge, so the member graph may contain privileged nodes.
   */
  privilegedPathPreauthorized?: boolean;
}

export type ExecutionEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'node_started'; nodeId: string; iteration?: number }
  | { type: 'node_completed'; nodeId: string; status: RunStatus; output?: unknown }
  | { type: 'node_failed'; nodeId: string; error: string }
  | { type: 'edge_activated'; edgeId: string }
  | { type: 'log'; message: string }
  | { type: 'waiting_approval'; nodeId: string; resumeToken: string; payloadHash: string }
  | { type: 'run_completed'; status: RunStatus };

export type NodeExecutor = (
  node: WorkflowNode,
  input: Record<string, unknown>,
  ctx: ExecutionContext,
) => Promise<Record<string, unknown>>;

export interface ExecutionContext {
  variables: Record<string, unknown>;
  nodeOutputs: Record<string, Record<string, unknown>>;
  iteration: number;
  tokenUsage: { prompt: number; completion: number; total: number };
  toolCallCount: number;
  fileSandbox: Map<string, string>;
  limits: Workflow['limits'];
  emit: (event: ExecutionEvent) => void;
  skills: Skill[];
  skillChains: SkillChain[];
  skillDepth: number;
  allowedSkillIds?: string[];
  skillInvocations: SkillInvocation[];
  /** Times each node has started in this run (1-based after increment). */
  nodeRunCounts: Record<string, number>;
}
