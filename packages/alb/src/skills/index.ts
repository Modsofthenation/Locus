import { nanoid } from 'nanoid';
import type {
  Port,
  Skill,
  SkillChain,
  SkillLink,
  Workflow,
  WorkflowNode,
} from '../schema/index.js';
import { toCaretRange } from '../versions.js';
import {
  extractSkillGates,
  isGateFailHandle,
  isHardGateNodeType,
} from '../gates.js';
import { extractSkillOutputContracts, extractSkillToolPermissions } from '../contracts.js';
import { extractSkillScripts } from '../scripts.js';
import { extractSkillPrivilegedTools } from '../privileged.js';
import { createEdge, createEmptyWorkflow, createNode } from '../workflow.js';
import { autoLayoutWorkflow } from '../layout.js';
import { toSkillSlug, uniqueSlugs } from '../ids.js';
import { suggestEvalCases } from '../effectiveness/cases.js';

export interface SkillBoundaryProposal {
  name: string;
  description: string;
  inputs: Port[];
  outputs: Port[];
  internalNodeIds: string[];
  tools: string[];
  dependencies: string[];
}

function uniquePorts(ports: Port[]): Port[] {
  const seen = new Set<string>();
  return ports.filter((p) => {
    const key = `${p.name}:${p.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Detect a skill contract from a selection of workflow nodes */
export function detectSkillBoundary(
  workflow: Workflow,
  nodeIds: string[],
  name = 'Extracted Skill',
): SkillBoundaryProposal {
  const idSet = new Set(nodeIds);
  const internal = workflow.nodes.filter((n) => idSet.has(n.id));
  const externalIncoming = workflow.edges.filter(
    (e) => idSet.has(e.target) && !idSet.has(e.source),
  );
  const externalOutgoing = workflow.edges.filter(
    (e) => idSet.has(e.source) && !idSet.has(e.target),
  );

  const inputs: Port[] = [];
  for (const edge of externalIncoming) {
    const target = internal.find((n) => n.id === edge.target);
    const port = target?.data.inputs?.find((p) => p.id === edge.targetHandle) ?? {
      id: edge.targetHandle ?? nanoid(6),
      name: edge.targetHandle ?? 'input',
      type: 'any' as const,
      required: true,
    };
    inputs.push({ ...port, id: port.id || nanoid(6) });
  }

  // Also surface required inputs with no internal source
  for (const node of internal) {
    for (const inp of node.data.inputs ?? []) {
      if (!inp.required) continue;
      const hasInternal = workflow.edges.some(
        (e) => e.target === node.id && idSet.has(e.source) && (!e.targetHandle || e.targetHandle === inp.id),
      );
      const hasExternal = externalIncoming.some(
        (e) => e.target === node.id && (!e.targetHandle || e.targetHandle === inp.id),
      );
      if (!hasInternal && !hasExternal) {
        inputs.push(inp);
      }
    }
  }

  const outputs: Port[] = [];
  for (const edge of externalOutgoing) {
    const source = internal.find((n) => n.id === edge.source);
    const port = source?.data.outputs?.find((p) => p.id === edge.sourceHandle) ?? {
      id: edge.sourceHandle ?? nanoid(6),
      name: edge.sourceHandle ?? 'output',
      type: 'any' as const,
      required: false,
    };
    outputs.push({ ...port, id: port.id || nanoid(6) });
  }

  if (outputs.length === 0) {
    const last = internal.at(-1);
    if (last?.data.outputs?.length) {
      outputs.push(...last.data.outputs);
    } else {
      outputs.push({ id: 'output', name: 'output', type: 'any', required: false });
    }
  }

  const tools = [
    ...internal
      .filter((n) => n.data.category === 'tool' || n.data.nodeType === 'tool_call')
      .map((n) => String(n.data.config.toolId ?? n.data.label)),
    ...internal.flatMap((n) =>
      Array.isArray(n.data.config.tools) ? n.data.config.tools.map((t) => String(t)) : [],
    ),
  ].filter(Boolean);

  return {
    name,
    description: `Skill extracted from ${internal.map((n) => n.data.label).join(' → ')}`,
    inputs: uniquePorts(inputs),
    outputs: uniquePorts(outputs),
    internalNodeIds: nodeIds,
    tools: [...new Set(tools)],
    dependencies: [],
  };
}

export function createSkillFromBoundary(
  workflow: Workflow,
  proposal: SkillBoundaryProposal,
): Skill {
  const now = new Date().toISOString();
  const idSet = new Set(proposal.internalNodeIds);
  const nodes = workflow.nodes.filter((n) => idSet.has(n.id));
  const edges = workflow.edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
  const instructions = extractSkillInstructions(nodes);

  const internalWorkflow: Workflow = {
    ...workflow,
    id: nanoid(),
    name: `${proposal.name} (internal)`,
    status: 'draft',
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
  };

  return {
    id: nanoid(),
    name: proposal.name,
    description: proposal.description,
    slug: toSkillSlug(proposal.name),
    version: '1.0.0',
    tags: ['extracted'],
    role: 'member',
    inputs: proposal.inputs,
    outputs: proposal.outputs,
    instructions,
    tools: proposal.tools,
    toolPermissions: extractSkillToolPermissions(nodes),
    dependencies: proposal.dependencies,
    gates: extractSkillGates(nodes),
    outputContracts: extractSkillOutputContracts(nodes),
    scripts: extractSkillScripts(nodes),
    privilegedTools: extractSkillPrivilegedTools(nodes),
    internalWorkflow: withSkillEntry(internalWorkflow),
    status: 'draft',
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Convert a linear(ish) workflow into a linked skill chain proposal */
export function exportLinkedSkillChain(
  workflow: Workflow,
  options: { groupBy?: 'node' | 'agent_boundaries' } = {},
): { chain: SkillChain; skills: Skill[] } {
  const mode = options.groupBy ?? 'agent_boundaries';
  const now = new Date().toISOString();

  let groups: WorkflowNode[][];

  if (mode === 'node') {
    groups = workflow.nodes
      .filter((n) => n.data.nodeType !== 'input' && n.data.nodeType !== 'output')
      .map((n) => [n]);
  } else {
    // Group consecutive non-boundary nodes; split on agent/skill/human nodes
    const ordered = orderNodes(workflow);
    groups = [];
    let current: WorkflowNode[] = [];
    for (const node of ordered) {
      if (node.data.nodeType === 'input' || node.data.nodeType === 'output') continue;
      const isBoundary =
        node.data.category === 'agent' ||
        node.data.category === 'skill' ||
        node.data.category === 'human' ||
        isHardGateNodeType(node.data.nodeType);
      if (isBoundary) {
        if (current.length) {
          groups.push(current);
          current = [];
        }
        groups.push([node]);
      } else {
        current.push(node);
      }
    }
    if (current.length) groups.push(current);
  }

  const skills: Skill[] = [];
  const skillRefs: SkillChain['skills'] = [];

  for (const group of groups) {
    const proposal = detectSkillBoundary(
      workflow,
      group.map((n) => n.id),
      group.length === 1 ? group[0]!.data.label : `${group[0]!.data.label} Group`,
    );
    const skill = createSkillFromBoundary(workflow, proposal);
    skills.push(skill);
    skillRefs.push({
      skillId: skill.id,
      version: skill.version,
      versionRange: toCaretRange(skill.version),
      configuration: {},
      alias: skill.name,
    });
  }

  const links = memberLinksFromWorkflow(workflow, groups, skills);

  if (skills.length === 0) {
    const chain: SkillChain = {
      id: nanoid(),
      name: `${workflow.name} Skill Chain`,
      description: `Exported from workflow ${workflow.name}`,
      slug: toSkillSlug(`${workflow.name} Skill Chain`),
      version: '1.0.0',
      skills: [],
      links: [],
      variables: workflow.variables,
      executionPolicy: workflow.limits,
      evalCases: suggestEvalCases(workflow),
      createdAt: now,
      updatedAt: now,
    };
    return { chain, skills };
  }

  const supervisor = createSupervisorSkill(workflow, skills, groups, links);
  const groupedIds = new Set(groups.flatMap((g) => g.map((n) => n.id)));
  const roots = skills.filter((s, i) => {
    const ids = new Set((groups[i] ?? []).map((n) => n.id));
    return workflow.edges.some((e) => ids.has(e.target) && !groupedIds.has(e.source));
  });
  const entryRoots = roots.length ? roots : skills.slice(0, 1);
  const entryLinks: SkillLink[] = entryRoots.map((root) => {
    const preferredIn =
      root.inputs?.find((p) =>
        ['input', 'value', 'result', 'content', 'context', 'goal', 'prompt'].includes(p.id),
      ) ?? root.inputs?.[0];
    const preferredOut =
      supervisor.outputs?.find((p) => p.id === 'output') ?? supervisor.outputs?.[0];
    return {
      id: nanoid(),
      source: supervisor.id,
      target: root.id,
      mappings:
        preferredOut && preferredIn
          ? [{ sourcePort: preferredOut.id, targetPort: preferredIn.id }]
          : [],
    };
  });

  const allSkills = assignUniqueSlugs([supervisor, ...skills]);

  const chain: SkillChain = {
    id: nanoid(),
    name: `${workflow.name} Skill Chain`,
    description: `Exported from workflow ${workflow.name}`,
    slug: toSkillSlug(`${workflow.name} Skill Chain`),
    version: '1.0.0',
    supervisorSkillId: supervisor.id,
    skills: [
      {
        skillId: supervisor.id,
        version: supervisor.version,
        versionRange: toCaretRange(supervisor.version),
        configuration: {},
        alias: supervisor.name,
      },
      ...skillRefs,
    ],
    links: [...entryLinks, ...links],
    variables: workflow.variables,
    executionPolicy: workflow.limits,
    evalCases: suggestEvalCases(workflow),
    createdAt: now,
    updatedAt: now,
  };

  return { chain, skills: allSkills };
}

export function isSupervisorSkill(skill: Pick<Skill, 'role' | 'tags'>): boolean {
  return skill.role === 'supervisor' || Boolean(skill.tags?.includes('supervisor'));
}

/** Bind run input onto extracted skills that have no input node. */
export function withSkillEntry(workflow: Workflow): Workflow {
  if (workflow.nodes.some((n) => n.data.nodeType === 'input')) return workflow;
  const input = createNode('input', { x: 0, y: 0 }, 'Skill Input');
  const incoming = new Set(workflow.edges.map((e) => e.target));
  const roots = workflow.nodes.filter((n) => !incoming.has(n.id));
  return {
    ...workflow,
    nodes: [input, ...workflow.nodes],
    edges: [...workflow.edges, ...roots.map((root) => createEdge(input.id, root.id))],
  };
}

export function supervisorChainError(chain: SkillChain, skills: Skill[]): string | null {
  if (!chain.supervisorSkillId) {
    if (skills.some((s) => isSupervisorSkill(s))) {
      return 'legacy chain cannot include a supervisor skill without supervisorSkillId';
    }
    return null;
  }
  const supervisor = skills.find((s) => s.id === chain.supervisorSkillId);
  if (!supervisor) return 'chain supervisorSkillId does not match a skill in the bundle';
  if (!isSupervisorSkill(supervisor)) return 'supervisor skill is missing role=supervisor';
  const declared = new Set((chain.skills ?? []).map((ref) => ref.skillId));
  if (!declared.has(chain.supervisorSkillId)) {
    return 'supervisorSkillId is not listed in chain.skills';
  }
  for (const skill of skills) {
    if (!declared.has(skill.id)) return `bundle skill ${skill.id} is not listed on the chain`;
  }
  for (const ref of chain.skills ?? []) {
    if (!skills.some((s) => s.id === ref.skillId)) {
      return `chain skill ${ref.skillId} is missing from the bundle`;
    }
  }
  const memberIds = new Set(
    (chain.skills ?? []).map((ref) => ref.skillId).filter((id) => id !== chain.supervisorSkillId),
  );
  const graph = supervisor.internalWorkflow;
  if (!graph) return 'supervisor is missing an internal workflow';
  if (graph.nodes.some((n) => n.data.nodeType === 'skill_chain')) {
    return 'supervisor cannot embed skill_chain nodes';
  }
  const invokedNodes = graph.nodes.filter(
    (n) => n.data.nodeType === 'published_skill' || n.data.nodeType === 'skill',
  );
  const invoked = new Set(
    invokedNodes.map((n) => String(n.data.config.skillId ?? n.data.skillId ?? '')).filter(Boolean),
  );
  for (const id of memberIds) {
    if (!invoked.has(id)) return `supervisor does not invoke member skill ${id}`;
  }
  for (const id of invoked) {
    if (!memberIds.has(id)) return `supervisor invokes undeclared skill ${id}`;
  }
  const input = graph.nodes.find((n) => n.data.nodeType === 'input');
  if (!input) return 'supervisor is missing an input node';
  const reachable = new Set<string>([input.id]);
  const queue = [input.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const edge of graph.edges.filter((e) => e.source === id)) {
      if (reachable.has(edge.target)) continue;
      reachable.add(edge.target);
      queue.push(edge.target);
    }
  }
  for (const node of invokedNodes) {
    if (!reachable.has(node.id)) {
      return `supervisor member "${node.data.label}" is not reachable from input`;
    }
  }
  const nodeByMember = new Map(
    invokedNodes.map((n) => [String(n.data.config.skillId ?? n.data.skillId ?? ''), n.id] as const),
  );
  const memberLinks = (chain.links ?? []).filter(
    (l) => l.source !== chain.supervisorSkillId && l.target !== chain.supervisorSkillId,
  );
  for (const link of memberLinks) {
    const sourceId = nodeByMember.get(link.source);
    const targetId = nodeByMember.get(link.target);
    if (!sourceId || !targetId) {
      return `supervisor is missing nodes for link ${link.source} → ${link.target}`;
    }
    const handle = link.sourceHandle ?? link.condition ?? '';
    const hasEdge = graph.edges.some(
      (e) =>
        e.source === sourceId &&
        e.target === targetId &&
        (e.sourceHandle ?? e.label ?? '') === handle,
    );
    if (!hasEdge) return `supervisor is missing link ${link.source} → ${link.target}`;
  }
  return null;
}

function memberLinksFromWorkflow(
  workflow: Workflow,
  groups: WorkflowNode[][],
  skills: Skill[],
): SkillLink[] {
  const nodeSkill = new Map<string, Skill>();
  groups.forEach((group, i) => {
    const skill = skills[i];
    if (!skill) return;
    for (const node of group) nodeSkill.set(node.id, skill);
  });
  const links: SkillLink[] = [];
  for (const edge of workflow.edges) {
    const source = nodeSkill.get(edge.source);
    const target = nodeSkill.get(edge.target);
    if (!source || !target || source.id === target.id) continue;
    links.push(linkFromEdge(source, target, edge));
  }
  return links;
}

function linkFromEdge(source: Skill, target: Skill, edge: { sourceHandle?: string; label?: string; dataMapping?: SkillLink['mappings'][number] }): SkillLink {
  const handle = edge.sourceHandle ?? edge.label ?? '';
  const failOnly = isGateFailHandle(handle);
  const condition = source.gates.length
    ? source.gates.some((g) => g.kind === 'authority')
      ? failOnly
        ? 'rejected'
        : 'approved'
      : failOnly
        ? 'fail'
        : 'pass'
    : handle || undefined;
  const preferredOutIds = failOnly
    ? ['fail', 'rejected', 'false', 'failure', 'insufficient', 'invalid']
    : ['pass', 'approved', 'result', 'output', 'value', 'summary', 'sufficient', 'completion', 'valid'];
  const preferredOut =
    (handle ? source.outputs?.find((p) => p.id === handle) : undefined) ??
    source.outputs?.find((p) => preferredOutIds.includes(p.id)) ??
    source.outputs?.find((p) =>
      failOnly ? isGateFailHandle(p.id) : !isGateFailHandle(p.id),
    ) ??
    source.outputs?.[0];
  const preferredIn =
    target.inputs?.find((p) =>
      ['input', 'value', 'result', 'content', 'context', 'goal', 'prompt'].includes(p.id),
    ) ?? target.inputs?.[0];
  const mappings = edge.dataMapping
    ? [edge.dataMapping]
    : preferredOut && preferredIn
      ? [{ sourcePort: preferredOut.id, targetPort: preferredIn.id }]
      : [];
  return {
    id: nanoid(),
    source: source.id,
    target: target.id,
    mappings,
    condition,
    sourceHandle: handle || undefined,
  };
}

function createSupervisorSkill(
  workflow: Workflow,
  members: Skill[],
  groups: WorkflowNode[][],
  memberLinks: SkillLink[],
): Skill {
  const now = new Date().toISOString();
  const groupedIds = new Set(groups.flatMap((g) => g.map((n) => n.id)));
  const roots = members.filter((s, i) => {
    const ids = new Set((groups[i] ?? []).map((n) => n.id));
    return workflow.edges.some((e) => ids.has(e.target) && !groupedIds.has(e.source));
  });
  const leaves = members.filter((s, i) => {
    const ids = new Set((groups[i] ?? []).map((n) => n.id));
    return workflow.edges.some((e) => ids.has(e.source) && !groupedIds.has(e.target));
  });
  const entryRoots = roots.length ? roots : members.slice(0, 1);
  const exitLeaves = leaves.length ? leaves : members.slice(-1);

  const graph = createEmptyWorkflow(`${workflow.name} Supervisor`);
  graph.limits = { ...workflow.limits };
  graph.variables = workflow.variables;
  graph.description = `Deterministic supervisor for ${workflow.name} — invokes member skills; does not authorize side effects`;

  const inputNode = createNode('input', { x: 0, y: 0 }, 'Chain Input');
  const outputNode = createNode('output', { x: 0, y: 0 }, 'Chain Output');
  const byMemberId = new Map<string, WorkflowNode>();

  for (const member of members) {
    const node = createNode('published_skill', { x: 0, y: 0 }, member.name);
    node.data.skillId = member.id;
    node.data.skillVersion = member.version;
    node.data.inputs = member.inputs?.length ? member.inputs : node.data.inputs;
    node.data.outputs = member.outputs?.length ? member.outputs : node.data.outputs;
    node.data.config = {
      ...node.data.config,
      skillId: member.id,
      skillVersion: member.version,
      versionRange: toCaretRange(member.version),
    };
    node.data.configSummary = `Skill: ${member.name}`;
    byMemberId.set(member.id, node);
  }

  const skillNodes = [...byMemberId.values()];
  const edges = [
    ...entryRoots.flatMap((root) => {
      const target = byMemberId.get(root.id);
      return target ? [createEdge(inputNode.id, target.id)] : [];
    }),
    ...memberLinks.flatMap((link) => {
      const sourceNode = byMemberId.get(link.source);
      const targetNode = byMemberId.get(link.target);
      if (!sourceNode || !targetNode) return [];
      const handle = link.sourceHandle ?? link.condition;
      const mapping = link.mappings[0];
      return [
        createEdge(sourceNode.id, targetNode.id, {
          sourceHandle: handle,
          kind: handle ? 'conditional' : 'control',
          label: handle,
          dataMapping: mapping,
        }),
      ];
    }),
    ...exitLeaves.flatMap((leaf) => {
      const source = byMemberId.get(leaf.id);
      return source ? [createEdge(source.id, outputNode.id)] : [];
    }),
  ];

  graph.nodes = [inputNode, ...skillNodes, outputNode];
  graph.edges = edges;
  graph.nodes = autoLayoutWorkflow(graph, { direction: 'LR' });

  const inputs =
    uniquePorts(entryRoots.flatMap((s) => s.inputs)).length > 0
      ? uniquePorts(entryRoots.flatMap((s) => s.inputs))
      : [{ id: 'input', name: 'Input', type: 'any' as const, required: true }];
  const outputs = uniquePorts([
    { id: 'output', name: 'Output', type: 'any' as const, required: false },
    ...exitLeaves.flatMap((s) => s.outputs),
  ]);

  return {
    id: nanoid(),
    name: `${workflow.name} Supervisor`,
    description: `Entry point for the ${workflow.name} skill chain. Invokes member skills in graph order; member gates still authorize side effects.`,
    slug: toSkillSlug(`${workflow.name} Supervisor`),
    version: '1.0.0',
    tags: ['supervisor', 'extracted'],
    role: 'supervisor',
    inputs,
    outputs,
    tools: [],
    toolPermissions: {},
    executionConfig: workflow.limits,
    dependencies: members.map((s) => s.id),
    gates: [],
    outputContracts: [],
    scripts: [],
    privilegedTools: [],
    internalWorkflow: graph,
    status: 'draft',
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function orderNodes(workflow: Workflow): WorkflowNode[] {
  const indegree = new Map<string, number>();
  const outs = new Map<string, string[]>();
  for (const n of workflow.nodes) {
    indegree.set(n.id, 0);
    outs.set(n.id, []);
  }
  for (const e of workflow.edges) {
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    outs.get(e.source)?.push(e.target);
  }
  const queue = workflow.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outs.get(id) ?? []) {
      const d = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  for (const n of workflow.nodes) {
    if (!order.includes(n.id)) order.push(n.id);
  }
  return order.map((id) => workflow.nodes.find((n) => n.id === id)!).filter(Boolean);
}

function extractSkillInstructions(nodes: WorkflowNode[]): string | undefined {
  const prompts = nodes
    .map((n) => n.data.config.systemPrompt)
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  return prompts.length ? prompts.join('\n\n') : undefined;
}

function assignUniqueSlugs(skills: Skill[]): Skill[] {
  const slugs = uniqueSlugs(skills.map((s) => s.name));
  return skills.map((skill, i) => ({ ...skill, slug: slugs[i] }));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Overlay chain-ref configuration onto a skill's agent nodes (provider/model remap). */
export function applySkillConfiguration(
  skill: Skill,
  configuration: Record<string, unknown> | undefined,
): Skill {
  if (!configuration || Object.keys(configuration).length === 0) return skill;
  const workflow = skill.internalWorkflow;
  if (!workflow) return skill;
  const nodes = workflow.nodes.map((node) => {
    if (node.data.category !== 'agent') return node;
    const config = { ...node.data.config };
    if (isPlainObject(configuration.model)) {
      const existing = isPlainObject(config.model) ? config.model : {};
      config.model = { ...existing, ...configuration.model };
    }
    if (typeof configuration.systemPrompt === 'string') {
      config.systemPrompt = configuration.systemPrompt;
    }
    if (Array.isArray(configuration.tools)) {
      config.tools = configuration.tools.map((t) => String(t));
    }
    if (typeof configuration.tokenBudget === 'number') {
      config.tokenBudget = configuration.tokenBudget;
    }
    return { ...node, data: { ...node.data, config } };
  });
  return { ...skill, internalWorkflow: { ...workflow, nodes } };
}

