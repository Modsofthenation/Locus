import type { WorkflowNode } from './schema/index.js';
import { evaluateSchemaGate } from './gates.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function agentToolsAllowlist(config: Record<string, unknown>): string[] {
  return Array.isArray(config.tools) ? config.tools.map((t) => String(t)).filter(Boolean) : [];
}

export function agentToolPermissions(config: Record<string, unknown>): Record<string, boolean> {
  return isPlainObject(config.toolPermissions)
    ? Object.fromEntries(
        Object.entries(config.toolPermissions).map(([k, v]) => [k, v === true]),
      )
    : {};
}

/** Agent-invented tool use: must be on `tools` and not denied by `toolPermissions`. */
export function assertAgentToolAllowed(config: Record<string, unknown>, toolId: string): void {
  const id = String(toolId ?? '').trim();
  if (!id) throw new Error('Tool call is missing a tool id');
  const allow = agentToolsAllowlist(config);
  if (!allow.includes(id)) {
    throw new Error(`Tool "${id}" is not on the agent allowlist`);
  }
  const perms = agentToolPermissions(config);
  if (id in perms && perms[id] === false) {
    throw new Error(`Tool "${id}" is denied by toolPermissions`);
  }
}

export interface ToolBudget {
  toolCallCount: number;
  limits: { maxToolCalls: number };
}

export function consumeToolCall(ctx: ToolBudget): void {
  ctx.toolCallCount += 1;
  if (ctx.toolCallCount > ctx.limits.maxToolCalls) {
    throw new Error(`Tool call budget exceeded (maxToolCalls=${ctx.limits.maxToolCalls})`);
  }
}

/** Allowlist + budget for a tool the model asked to invoke (not an author-placed graph node). */
export function invokeAgentTool(ctx: ToolBudget, node: WorkflowNode, toolId: string): void {
  assertAgentToolAllowed(node.data.config, toolId);
  consumeToolCall(ctx);
}

export function structuredOutputSchema(config: Record<string, unknown>): unknown {
  const model = isPlainObject(config.model) ? config.model : {};
  return config.outputSchema ?? model.outputSchema;
}

export function structuredOutputEnabled(config: Record<string, unknown>): boolean {
  const model = isPlainObject(config.model) ? config.model : {};
  if (config.structuredOutput === true || model.structuredOutput === true) return true;
  const schema = structuredOutputSchema(config);
  if (schema === undefined || schema === null || schema === '') return false;
  return true;
}

export interface StructuredOutputResult {
  ok: boolean;
  value: unknown;
  reason: string;
}

/** Fail-closed JSON contract for agent/LLM outputs. No-op when neither flag nor schema is set. */
export function evaluateStructuredOutput(
  config: Record<string, unknown>,
  raw: unknown,
): StructuredOutputResult {
  if (!structuredOutputEnabled(config)) {
    return { ok: true, value: raw, reason: '' };
  }
  const schema = structuredOutputSchema(config);
  if (schema === undefined || schema === null || schema === '') {
    return { ok: false, value: raw, reason: 'structuredOutput requires an outputSchema' };
  }
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, value: raw, reason: 'Output is not valid JSON' };
    }
  }
  const result = evaluateSchemaGate({ jsonSchema: schema }, { value: parsed });
  return { ok: result.pass, value: parsed, reason: result.reason };
}

export function extractSkillToolPermissions(nodes: WorkflowNode[]): Record<string, boolean> {
  const merged: Record<string, boolean> = {};
  for (const node of nodes) {
    const perms = agentToolPermissions(node.data.config);
    for (const [id, allowed] of Object.entries(perms)) {
      if (allowed === false) merged[id] = false;
      else if (merged[id] !== false) merged[id] = true;
    }
  }
  return merged;
}

export function extractSkillOutputContracts(nodes: WorkflowNode[]) {
  return nodes
    .filter((n) => structuredOutputEnabled(n.data.config))
    .map((n) => ({
      nodeType: n.data.nodeType,
      label: n.data.label,
      outputSchema: structuredOutputSchema(n.data.config) ?? null,
      structuredOutput: true,
    }));
}
