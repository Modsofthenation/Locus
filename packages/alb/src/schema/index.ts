import { z } from 'zod';

/** Supported primitive & structured variable types */
export const VariableTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'json',
  'file',
]);
export type VariableType = z.infer<typeof VariableTypeSchema>;

export const VariableScopeSchema = z.enum([
  'global',
  'workflow',
  'subgraph',
  'loop',
  'skill',
]);
export type VariableScope = z.infer<typeof VariableScopeSchema>;

export const WorkflowVariableSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: VariableTypeSchema,
  defaultValue: z.unknown().optional(),
  required: z.boolean().default(false),
  secret: z.boolean().default(false),
  description: z.string().optional(),
  scope: VariableScopeSchema.default('workflow'),
});
export type WorkflowVariable = z.infer<typeof WorkflowVariableSchema>;

export const PortSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: VariableTypeSchema.or(z.literal('any')).default('any'),
  required: z.boolean().default(false),
  description: z.string().optional(),
});
export type Port = z.infer<typeof PortSchema>;

export const NodeCategorySchema = z.enum([
  'agent',
  'tool',
  'logic',
  'data',
  'human',
  'skill',
]);
export type NodeCategory = z.infer<typeof NodeCategorySchema>;

export const NodeTypeSchema = z.enum([
  // Agent
  'agent',
  'llm',
  'planner',
  'react_agent',
  'critic',
  'evaluator',
  'summarizer',
  'router',
  'classifier',
  // Tools
  'tool_call',
  'http_request',
  'web_search',
  'database',
  'file_operation',
  'code_execution',
  'custom_tool',
  // Logic
  'condition',
  'switch',
  'loop',
  'for_each',
  'parallel',
  'merge',
  'retry',
  'delay',
  'schema_gate',
  'policy_gate',
  // Data
  'input',
  'output',
  'variable',
  'set_variable',
  'transform',
  'json_parse',
  'template',
  'formatter',
  // Human
  'human_approval',
  'human_input',
  'escalation',
  'review',
  // Skills
  'skill',
  'skill_chain',
  'published_skill',
  'sub_workflow',
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const NodeStatusSchema = z.enum([
  'default',
  'selected',
  'running',
  'success',
  'warning',
  'error',
  'disabled',
  'waiting',
  'paused',
]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const RetryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).default(0),
  backoffMs: z.number().int().min(0).default(1000),
  backoffMultiplier: z.number().min(1).default(2),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const ExecutionLimitsSchema = z.object({
  maxIterations: z.number().int().min(1).default(10),
  maxExecutionTimeMs: z.number().int().min(1000).default(300_000),
  maxTokenBudget: z.number().int().min(1).default(100_000),
  maxToolCalls: z.number().int().min(0).default(50),
  maxRetries: z.number().int().min(0).default(3),
  concurrencyLimit: z.number().int().min(1).default(5),
  requireHumanApproval: z.boolean().default(false),
  /** Privileged side-effect nodes must sit behind a hard gate. */
  requireGateBeforeSideEffects: z.boolean().default(true),
});
export type ExecutionLimits = z.infer<typeof ExecutionLimitsSchema>;

export const ModelConfigSchema = z.object({
  provider: z.string().default('openai'),
  model: z.string().default('gpt-4o-mini'),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  structuredOutput: z.boolean().default(false),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const AgentNodeConfigSchema = z.object({
  model: ModelConfigSchema.optional(),
  systemPrompt: z.string().optional(),
  goal: z.string().optional(),
  context: z.string().optional(),
  outputInstructions: z.string().optional(),
  tools: z.array(z.string()).default([]),
  toolPermissions: z.record(z.string(), z.boolean()).optional(),
  maxIterations: z.number().int().min(1).default(8),
  timeoutMs: z.number().int().min(1000).default(60_000),
  tokenBudget: z.number().int().min(1).default(16_000),
  /** JSON Schema contract for the node's output when structuredOutput is on. */
  outputSchema: z.unknown().optional(),
  structuredOutput: z.boolean().optional(),
  memoryStrategy: z
    .enum(['none', 'conversation', 'short_term', 'long_term', 'retrieved'])
    .default('conversation'),
  stopConditions: z.array(z.string()).default([]),
  retry: RetryPolicySchema.optional(),
});
export type AgentNodeConfig = z.infer<typeof AgentNodeConfigSchema>;

export const ConditionNodeConfigSchema = z.object({
  expression: z.string().min(1),
  trueLabel: z.string().default('true'),
  falseLabel: z.string().default('false'),
});
export type ConditionNodeConfig = z.infer<typeof ConditionNodeConfigSchema>;

export const LoopNodeConfigSchema = z.object({
  condition: z.string().optional(),
  maxIterations: z.number().int().min(1).default(10),
  terminationCondition: z.string().optional(),
  successCondition: z.string().optional(),
  failureCondition: z.string().optional(),
});
export type LoopNodeConfig = z.infer<typeof LoopNodeConfigSchema>;

export const ToolNodeConfigSchema = z.object({
  toolId: z.string().optional(),
  url: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  timeoutMs: z.number().int().min(100).default(30_000),
});
export type ToolNodeConfig = z.infer<typeof ToolNodeConfigSchema>;

export const WorkflowNodeDataSchema = z.object({
  label: z.string(),
  nodeType: NodeTypeSchema,
  category: NodeCategorySchema,
  description: z.string().optional(),
  status: NodeStatusSchema.default('default'),
  inputs: z.array(PortSchema).default([]),
  outputs: z.array(PortSchema).default([]),
  config: z.record(z.string(), z.unknown()).default({}),
  configSummary: z.string().optional(),
  disabled: z.boolean().default(false),
  skillId: z.string().optional(),
  skillVersion: z.string().optional(),
  validationErrors: z.array(z.string()).default([]),
});
export type WorkflowNodeData = z.infer<typeof WorkflowNodeDataSchema>;

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.literal('workflowNode').default('workflowNode'),
  position: z.object({ x: z.number(), y: z.number() }),
  data: WorkflowNodeDataSchema,
  parentId: z.string().optional(),
  extent: z.literal('parent').optional(),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const EdgeKindSchema = z.enum(['control', 'data', 'conditional']);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  label: z.string().optional(),
  kind: EdgeKindSchema.default('control'),
  dataMapping: z
    .object({
      sourcePort: z.string(),
      targetPort: z.string(),
    })
    .optional(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowStatusSchema = z.enum(['draft', 'saved', 'published']);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const EnvironmentSchema = z.enum(['development', 'staging', 'production']);
export type Environment = z.infer<typeof EnvironmentSchema>;

export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default('0.1.0'),
  status: WorkflowStatusSchema.default('draft'),
  environment: EnvironmentSchema.default('development'),
  nodes: z.array(WorkflowNodeSchema).default([]),
  edges: z.array(WorkflowEdgeSchema).default([]),
  variables: z.array(WorkflowVariableSchema).default([]),
  limits: ExecutionLimitsSchema.prefault({}),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().optional(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export const EvalAssertionSchema = z.object({
  expression: z.string().min(1),
  message: z.string().optional(),
});
export type EvalAssertion = z.infer<typeof EvalAssertionSchema>;

export const EvalCaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
  expectStatus: z
    .enum(['success', 'error', 'cancelled', 'paused', 'waiting_approval'])
    .optional(),
  assertions: z.array(EvalAssertionSchema).default([]),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  /** Stable kebab-case id for other repos / Cursor skill folders. */
  slug: z.string().optional(),
  version: z.string().default('1.0.0'),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** `supervisor` is the chain entry skill; members are invoked by it. */
  role: z.enum(['member', 'supervisor']).default('member'),
  inputs: z.array(PortSchema).default([]),
  outputs: z.array(PortSchema).default([]),
  instructions: z.string().optional(),
  tools: z.array(z.string()).default([]),
  toolPermissions: z.record(z.string(), z.boolean()).optional(),
  executionConfig: ExecutionLimitsSchema.optional(),
  dependencies: z.array(z.string()).default([]),
  /** Hard gates captured from the skill's internal workflow for chain export. */
  gates: z
    .array(
      z.object({
        kind: z.enum(['schema', 'policy', 'authority']),
        nodeType: z.string(),
        label: z.string(),
        config: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .default([]),
  /** Structured-output contracts captured from agent/LLM nodes. */
  outputContracts: z
    .array(
      z.object({
        nodeType: z.string(),
        label: z.string(),
        outputSchema: z.unknown().optional(),
        structuredOutput: z.boolean().default(true),
      }),
    )
    .default([]),
  /** Pinned sandboxed scripts captured from code_execution nodes. */
  scripts: z
    .array(
      z.object({
        scriptId: z.string(),
        label: z.string(),
        language: z.string().default('javascript'),
        source: z.string().default(''),
        sourceHash: z.string().default(''),
        pinned: z.boolean().default(false),
      }),
    )
    .default([]),
  /** Privileged HTTP/file tool contracts captured for chain export. */
  privilegedTools: z
    .array(
      z.object({
        nodeType: z.string(),
        label: z.string(),
        url: z.string().optional(),
        urlAllowlist: z.array(z.string()).default([]),
        pathAllowlist: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  internalWorkflow: WorkflowSchema.optional(),
  status: z.enum(['draft', 'published', 'deprecated']).default('draft'),
  usageCount: z.number().int().min(0).default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Skill = z.infer<typeof SkillSchema>;

export const SkillLinkMappingSchema = z.object({
  sourcePort: z.string(),
  targetPort: z.string(),
});
export type SkillLinkMapping = z.infer<typeof SkillLinkMappingSchema>;

export const SkillLinkSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  mappings: z.array(SkillLinkMappingSchema).default([]),
  condition: z.string().optional(),
  sourceHandle: z.string().optional(),
});
export type SkillLink = z.infer<typeof SkillLinkSchema>;

export const SkillChainSkillRefSchema = z.object({
  skillId: z.string(),
  /** Exact pinned version used when the chain was last resolved. */
  version: z.string().default('1.0.0'),
  /**
   * Optional semver range for nested skill resolution (`^1.2.0`).
   * Omitted on legacy chains — callers should treat `version` as an exact pin.
   */
  versionRange: z.string().optional(),
  configuration: z.record(z.string(), z.unknown()).default({}),
  alias: z.string().optional(),
});
export type SkillChainSkillRef = z.infer<typeof SkillChainSkillRefSchema>;

export const SkillChainSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  /** Stable kebab-case id for pack folders and other-repo imports. */
  slug: z.string().optional(),
  version: z.string().default('1.0.0'),
  skills: z.array(SkillChainSkillRefSchema).default([]),
  /** Entry skill that orchestrates member skills. Omitted on legacy chains. */
  supervisorSkillId: z.string().optional(),
  links: z.array(SkillLinkSchema).default([]),
  variables: z.array(WorkflowVariableSchema).default([]),
  executionPolicy: ExecutionLimitsSchema.optional(),
  /** Golden inputs used to measure chain effectiveness in this or another repo. */
  evalCases: z.array(EvalCaseSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SkillChain = z.infer<typeof SkillChainSchema>;

export const RunStatusSchema = z.enum([
  'pending',
  'running',
  'success',
  'error',
  'cancelled',
  'paused',
  'waiting_approval',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const NodeTraceSchema = z.object({
  nodeId: z.string(),
  status: RunStatusSchema,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  durationMs: z.number().optional(),
  iteration: z.number().int().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z
    .object({
      message: z.string(),
      type: z.string().optional(),
      details: z.unknown().optional(),
    })
    .optional(),
  aiDetails: z
    .object({
      model: z.string().optional(),
      prompt: z.string().optional(),
      response: z.string().optional(),
      tokenUsage: z
        .object({
          prompt: z.number(),
          completion: z.number(),
          total: z.number(),
        })
        .optional(),
      toolCalls: z.array(z.unknown()).optional(),
    })
    .optional(),
  retryHistory: z.array(z.unknown()).default([]),
  gateTrace: z
    .object({
      kind: z.enum(['schema', 'policy', 'authority']),
      input: z.unknown().optional(),
      pass: z.boolean().optional(),
      approved: z.boolean().optional(),
      reason: z.string().optional(),
      branch: z.string().optional(),
      payloadHash: z.string().optional(),
    })
    .optional(),
  /** Set when this node invoked a nested skill. */
  skillId: z.string().optional(),
  skillSlug: z.string().optional(),
});
export type NodeTrace = z.infer<typeof NodeTraceSchema>;

export const SkillInvocationSchema = z.object({
  skillId: z.string(),
  skillSlug: z.string().optional(),
  name: z.string(),
  role: z.enum(['member', 'supervisor']).default('member'),
  status: RunStatusSchema,
  durationMs: z.number().optional(),
  tokenUsage: z
    .object({
      prompt: z.number(),
      completion: z.number(),
      total: z.number(),
    })
    .optional(),
  skipped: z.boolean().default(false),
  gatesEvaluated: z.number().int().min(0).default(0),
  gatesPassed: z.number().int().min(0).default(0),
});
export type SkillInvocation = z.infer<typeof SkillInvocationSchema>;

export const ChainEffectivenessSchema = z.object({
  chainId: z.string(),
  chainSlug: z.string().optional(),
  runId: z.string().optional(),
  status: RunStatusSchema,
  durationMs: z.number().optional(),
  tokenUsage: z
    .object({
      prompt: z.number(),
      completion: z.number(),
      total: z.number(),
    })
    .optional(),
  invocations: z.array(SkillInvocationSchema).default([]),
  /** Member skills that ran / member skills in the chain. */
  coverage: z.number().min(0).max(1),
  /** 0 when a side effect ran without an authorizing gate; otherwise 1. */
  gateIntegrity: z.number().min(0).max(1),
  /** 1 when duration and tokens stay within the chain execution policy. */
  budgetAdherence: z.number().min(0).max(1),
  assertionPassRate: z.number().min(0).max(1).optional(),
  /** Weighted 0–100 score. */
  score: z.number().min(0).max(100),
});
export type ChainEffectiveness = z.infer<typeof ChainEffectivenessSchema>;

export const WorkflowRunSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  workflowVersion: z.string(),
  status: RunStatusSchema.default('pending'),
  environment: EnvironmentSchema.default('development'),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  durationMs: z.number().optional(),
  tokenUsage: z
    .object({
      prompt: z.number(),
      completion: z.number(),
      total: z.number(),
    })
    .optional(),
  estimatedCostUsd: z.number().optional(),
  traces: z.array(NodeTraceSchema).default([]),
  logs: z.array(z.string()).default([]),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  pendingApproval: z
    .object({
      nodeId: z.string(),
      resumeToken: z.string(),
      payloadHash: z.string(),
      payload: z.unknown(),
      message: z.string().optional(),
    })
    .optional(),
  chainId: z.string().optional(),
  chainSlug: z.string().optional(),
  skillInvocations: z.array(SkillInvocationSchema).default([]),
  effectiveness: ChainEffectivenessSchema.optional(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const WorkspaceRoleSchema = z.enum([
  'viewer',
  'editor',
  'runner',
  'publisher',
  'admin',
]);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const SecretRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  connected: z.boolean().default(false),
  lastUsedAt: z.string().optional(),
});
export type SecretRef = z.infer<typeof SecretRefSchema>;
