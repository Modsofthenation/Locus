import type { Port, Skill, SkillChain, Workflow, WorkflowNode } from './schema/index.js';

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Fill arrays omitted by legacy IndexedDB / imported skill records. */
export function normalizeSkill(raw: Skill | Partial<Skill> | Record<string, unknown> | null | undefined): Skill {
  const obj = asRecord(raw);
  const now = new Date().toISOString();
  const role = obj.role === 'supervisor' ? 'supervisor' : 'member';
  const status =
    obj.status === 'published' || obj.status === 'deprecated' || obj.status === 'draft'
      ? obj.status
      : 'draft';
  return {
    ...(obj as object),
    id: String(obj.id ?? 'unknown-skill'),
    name: String(obj.name ?? 'Untitled skill'),
    description: obj.description == null ? undefined : String(obj.description),
    slug: obj.slug == null ? undefined : String(obj.slug),
    version: String(obj.version ?? '1.0.0'),
    author: obj.author == null ? undefined : String(obj.author),
    tags: asArray<string>(obj.tags),
    role,
    inputs: asArray<Port>(obj.inputs),
    outputs: asArray<Port>(obj.outputs),
    instructions: obj.instructions == null ? undefined : String(obj.instructions),
    tools: asArray<string>(obj.tools),
    toolPermissions:
      obj.toolPermissions && typeof obj.toolPermissions === 'object'
        ? (obj.toolPermissions as Skill['toolPermissions'])
        : undefined,
    executionConfig: (obj.executionConfig as Skill['executionConfig']) ?? undefined,
    dependencies: asArray<string>(obj.dependencies),
    gates: asArray<NonNullable<Skill['gates']>[number]>(obj.gates),
    outputContracts: asArray<NonNullable<Skill['outputContracts']>[number]>(obj.outputContracts),
    scripts: asArray<NonNullable<Skill['scripts']>[number]>(obj.scripts),
    privilegedTools: asArray<NonNullable<Skill['privilegedTools']>[number]>(obj.privilegedTools),
    internalWorkflow: (obj.internalWorkflow as Skill['internalWorkflow']) ?? undefined,
    status,
    usageCount: Number.isFinite(Number(obj.usageCount)) ? Number(obj.usageCount) : 0,
    createdAt: String(obj.createdAt ?? now),
    updatedAt: String(obj.updatedAt ?? now),
  };
}

/** Fill arrays omitted by legacy IndexedDB / imported chain records. */
export function normalizeSkillChain(
  raw: SkillChain | Partial<SkillChain> | Record<string, unknown> | null | undefined,
): SkillChain {
  const obj = asRecord(raw);
  const now = new Date().toISOString();
  return {
    ...(obj as object),
    id: String(obj.id ?? 'unknown-chain'),
    name: String(obj.name ?? 'Untitled chain'),
    description: obj.description == null ? undefined : String(obj.description),
    slug: obj.slug == null ? undefined : String(obj.slug),
    version: String(obj.version ?? '1.0.0'),
    skills: asArray<SkillChain['skills'][number]>(obj.skills),
    supervisorSkillId: obj.supervisorSkillId == null ? undefined : String(obj.supervisorSkillId),
    links: asArray<SkillChain['links'][number]>(obj.links),
    variables: asArray<SkillChain['variables'][number]>(obj.variables),
    executionPolicy: (obj.executionPolicy as SkillChain['executionPolicy']) ?? undefined,
    evalCases: asArray<SkillChain['evalCases'][number]>(obj.evalCases),
    createdAt: String(obj.createdAt ?? now),
    updatedAt: String(obj.updatedAt ?? now),
  };
}

function normalizeNodePorts(node: WorkflowNode): WorkflowNode {
  return {
    ...node,
    data: {
      ...node.data,
      inputs: node.data?.inputs ?? [],
      outputs: node.data?.outputs ?? [],
      validationErrors: node.data?.validationErrors ?? [],
    },
  };
}

/** Keep canvas nodes renderable when persisted data omitted ports. */
export function normalizeWorkflowPorts(workflow: Workflow): Workflow {
  return {
    ...workflow,
    nodes: (workflow.nodes ?? []).map(normalizeNodePorts),
    edges: workflow.edges ?? [],
    variables: workflow.variables ?? [],
    tags: workflow.tags ?? [],
  };
}
