import type { Workflow, WorkflowNode } from './schema/index.js';
import { evaluatePredicate } from './expressions/index.js';

/** Side-effect nodes that must sit behind a hard gate. */
export const PRIVILEGED_NODE_TYPES = [
  'http_request',
  'file_operation',
  'database',
  'code_execution',
  'custom_tool',
  'tool_call',
  'web_search',
] as const;

export type PrivilegedNodeType = (typeof PRIVILEGED_NODE_TYPES)[number];

/** Deterministic / authority gates — never LLM-decided. */
export const HARD_GATE_NODE_TYPES = ['schema_gate', 'policy_gate', 'human_approval'] as const;

export type HardGateNodeType = (typeof HARD_GATE_NODE_TYPES)[number];

export const GATE_PASS_HANDLES = new Set([
  'pass',
  'approved',
  'true',
  'success',
  'sufficient',
  'valid',
]);

export const GATE_FAIL_HANDLES = new Set([
  'fail',
  'rejected',
  'false',
  'failure',
  'insufficient',
  'invalid',
]);

export function normalizeGateHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

export function isGatePassHandle(handle: string): boolean {
  return GATE_PASS_HANDLES.has(normalizeGateHandle(handle));
}

export function isGateFailHandle(handle: string): boolean {
  return GATE_FAIL_HANDLES.has(normalizeGateHandle(handle));
}

export function isPrivilegedNodeType(type: string): type is PrivilegedNodeType {
  return (PRIVILEGED_NODE_TYPES as readonly string[]).includes(type);
}

export function isHardGateNodeType(type: string): type is HardGateNodeType {
  return (HARD_GATE_NODE_TYPES as readonly string[]).includes(type);
}

export function gateKindForNodeType(
  type: string,
): 'schema' | 'policy' | 'authority' | null {
  if (type === 'schema_gate') return 'schema';
  if (type === 'policy_gate') return 'policy';
  if (type === 'human_approval') return 'authority';
  return null;
}

export interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchemaObject;
  additionalProperties?: boolean;
}

export interface SchemaIssue {
  path: string;
  message: string;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonSchema(raw: unknown): JsonSchemaObject | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return isPlainObject(parsed) ? (parsed as JsonSchemaObject) : null;
    } catch {
      return null;
    }
  }
  if (isPlainObject(raw)) return raw as JsonSchemaObject;
  return null;
}

/** Empty `{}` is not a contract — require at least one constraint keyword. */
export function schemaHasConstraints(schema: JsonSchemaObject): boolean {
  if (schema.type === 'array') {
    // `items` only constrains arrays, and empty `items: {}` adds nothing.
    if (schema.items && schemaHasConstraints(schema.items)) return true;
    return true;
  }
  if (schema.type) return true;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return true;
  if (Array.isArray(schema.required) && schema.required.length > 0) return true;
  if (schema.properties && Object.keys(schema.properties).length > 0) return true;
  return false;
}

export function schemaGateConfigError(config: Record<string, unknown>): string | null {
  const raw = config.jsonSchema ?? config.schema;
  if (raw === undefined || raw === null) return 'requires a JSON schema';
  if (typeof raw === 'string' && !raw.trim()) return 'requires a JSON schema';
  const schema = parseJsonSchema(raw);
  if (!schema) return 'has an invalid JSON schema';
  if (!schemaHasConstraints(schema)) return 'has a JSON schema with no constraints';
  return null;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Subset JSON Schema validator (type/properties/required/enum/items). Fail-closed. */
export function validateJsonSchema(
  schema: JsonSchemaObject,
  value: unknown,
  path = '$',
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value) || JSON.stringify(item) === JSON.stringify(value))) {
    issues.push({ path, message: `value is not in enum` });
    return issues;
  }
  if (schema.type) {
    const actual = typeOf(value);
    const expected = schema.type === 'integer' ? 'number' : schema.type;
    if (schema.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        issues.push({ path, message: `expected integer, got ${actual}` });
        return issues;
      }
    } else if (actual !== expected) {
      issues.push({ path, message: `expected ${schema.type}, got ${actual}` });
      return issues;
    }
  }
  if (schema.type === 'object' || schema.properties || schema.required) {
    if (!isPlainObject(value)) {
      issues.push({ path, message: 'expected object' });
      return issues;
    }
    for (const key of Object.keys(value)) {
      if (DANGEROUS_KEYS.has(key)) {
        issues.push({ path: `${path}.${key}`, message: 'forbidden property name' });
      }
    }
    for (const req of schema.required ?? []) {
      if (!(req in value)) {
        issues.push({ path: `${path}.${req}`, message: 'required property missing' });
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(properties)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      if (key in value) {
        issues.push(...validateJsonSchema(child, value[key], `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          issues.push({ path: `${path}.${key}`, message: 'additional property not allowed' });
        }
      }
    }
  }
  if (schema.type === 'array' && schema.items) {
    if (!Array.isArray(value)) {
      issues.push({ path, message: 'expected array' });
      return issues;
    }
    value.forEach((item, i) => {
      issues.push(...validateJsonSchema(schema.items!, item, `${path}[${i}]`));
    });
  }
  return issues;
}

export interface GateResult {
  pass: boolean;
  fail: boolean;
  reason: string;
  payload: unknown;
  issues?: SchemaIssue[];
}

function unwrapPayload(input: Record<string, unknown>): unknown {
  if ('value' in input && input.value !== undefined) return input.value;
  if ('input' in input && input.input !== undefined) return input.input;
  if ('json' in input && input.json !== undefined) return input.json;
  if ('result' in input && input.result !== undefined) return input.result;
  return input;
}

export function evaluateSchemaGate(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
): GateResult {
  const payload = unwrapPayload(input);
  const schema = parseJsonSchema(config.jsonSchema ?? config.schema);
  if (!schema) {
    return {
      pass: false,
      fail: true,
      reason: 'Invalid or missing JSON schema',
      payload,
    };
  }
  if (!schemaHasConstraints(schema)) {
    return {
      pass: false,
      fail: true,
      reason: 'JSON schema has no constraints',
      payload,
    };
  }
  const issues = validateJsonSchema(schema, payload);
  const pass = issues.length === 0;
  return {
    pass,
    fail: !pass,
    reason: pass ? 'Schema valid' : issues.map((i) => `${i.path}: ${i.message}`).join('; '),
    payload,
    issues,
  };
}

function valueAtPath(payload: unknown, path: string): unknown {
  if (!path) return payload;
  const parts = path.split('.').filter(Boolean);
  let current: unknown = payload;
  for (const part of parts) {
    if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Collapse `.`, reject `..`, keep `//` so URL prefixes still round-trip. */
export function normalizePolicyPath(raw: string): string | null {
  const parts = raw.replace(/\\/g, '/').split('/');
  if (parts.includes('..')) return null;
  const normalized = parts.filter((seg) => seg !== '.');
  if (normalized.length === 0 || (normalized.length === 1 && normalized[0] === '')) return null;
  return normalized.join('/');
}

/** Prefix matches a path segment (`src` → `src/a`, not `srcfoo`). `..` always fails. */
export function pathMatchesAllowlist(value: string, allowlist: string[], mode: string): boolean {
  if (mode !== 'prefix') return allowlist.includes(value);
  const path = normalizePolicyPath(value);
  if (path === null) return false;
  return allowlist.some((prefix) => {
    const allowed = normalizePolicyPath(prefix);
    if (allowed === null) return false;
    if (path === allowed) return true;
    const dir = allowed.endsWith('/') ? allowed : `${allowed}/`;
    return path.startsWith(dir);
  });
}

export function evaluatePolicyGate(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  extraCtx: Record<string, unknown> = {},
): GateResult {
  const payload = unwrapPayload(input);
  const ctx: Record<string, unknown> = {
    ...extraCtx,
    input,
    payload,
    value: payload,
    ...(isPlainObject(payload) ? payload : {}),
  };

  const expression = String(config.expression ?? '').trim();
  if (expression) {
    let ok = false;
    try {
      ok = evaluatePredicate(expression, ctx);
    } catch {
      return {
        pass: false,
        fail: true,
        reason: `Policy expression failed to evaluate: ${expression}`,
        payload,
      };
    }
    if (!ok) {
      return {
        pass: false,
        fail: true,
        reason: `Policy expression rejected: ${expression}`,
        payload,
      };
    }
  }

  const allowlistPath = String(config.allowlistPath ?? '').trim();
  const allowlist = Array.isArray(config.allowlist)
    ? config.allowlist.map((v) => String(v))
    : String(config.allowlist ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  if (allowlistPath && allowlist.length) {
    const raw = valueAtPath(payload, allowlistPath);
    const values = Array.isArray(raw) ? raw : [raw];
    const mode = String(config.allowlistMode ?? 'exact');
    for (const item of values) {
      const text = String(item ?? '');
      const allowed = pathMatchesAllowlist(text, allowlist, mode);
      if (!allowed) {
        return {
          pass: false,
          fail: true,
          reason: `Value "${text}" at ${allowlistPath} is not on the allowlist`,
          payload,
        };
      }
    }
  }

  if (!expression && !(allowlistPath && allowlist.length)) {
    return {
      pass: false,
      fail: true,
      reason: 'Policy gate has no expression or allowlist',
      payload,
    };
  }

  return { pass: true, fail: false, reason: 'Policy passed', payload };
}

export interface TopologyIssue {
  nodeId: string;
  code: 'UNGATED_SIDE_EFFECT' | 'SIDE_EFFECT_ON_FAIL_BRANCH';
  message: string;
}

export function gateEdgeHandle(edge: { sourceHandle?: string; label?: string }): string {
  return normalizeGateHandle(edge.sourceHandle ?? edge.label ?? '');
}

/** Pass/approved handles authorize; unlabeled and fail handles do not. */
export function gateEdgeAuthorizes(edge: { sourceHandle?: string; label?: string }): boolean {
  const handle = gateEdgeHandle(edge);
  if (isGateFailHandle(handle)) return false;
  return isGatePassHandle(handle);
}

/**
 * Every incoming path must reach a hard-gate pass/approved handle.
 * A parallel ungated edge (input→llm→http plus input→gate→http) fails this check.
 */
export function allIncomingPathsGated(
  workflow: Workflow,
  nodeId: string,
  visiting: Set<string> = new Set(),
): boolean {
  if (visiting.has(nodeId)) return false;
  visiting.add(nodeId);
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  const incoming = workflow.edges.filter((e) => e.target === nodeId);
  if (incoming.length === 0) {
    visiting.delete(nodeId);
    return false;
  }
  const ok = incoming.every((edge) => {
    const source = byId.get(edge.source);
    if (!source) return false;
    if (isHardGateNodeType(source.data.nodeType)) return gateEdgeAuthorizes(edge);
    return allIncomingPathsGated(workflow, source.id, visiting);
  });
  visiting.delete(nodeId);
  return ok;
}

/** Design-time: every path into a privileged node must go through a hard-gate pass edge. */
export function findUngatedSideEffects(workflow: Workflow): TopologyIssue[] {
  const issues: TopologyIssue[] = [];
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));

  for (const node of workflow.nodes) {
    if (node.data.disabled || !isPrivilegedNodeType(node.data.nodeType)) continue;

    const incoming = workflow.edges.filter((e) => e.target === node.id);
    for (const edge of incoming) {
      const source = byId.get(edge.source);
      if (!source) continue;
      const handle = gateEdgeHandle(edge);
      if (isHardGateNodeType(source.data.nodeType) && isGateFailHandle(handle)) {
        issues.push({
          nodeId: node.id,
          code: 'SIDE_EFFECT_ON_FAIL_BRANCH',
          message: `"${node.data.label}" is wired to the fail branch of "${source.data.label}"`,
        });
      }
    }

    if (!allIncomingPathsGated(workflow, node.id)) {
      issues.push({
        nodeId: node.id,
        code: 'UNGATED_SIDE_EFFECT',
        message: `"${node.data.label}" performs a side effect and every incoming path must sit behind a schema, policy, or human-approval pass/approved edge`,
      });
    }
  }

  return issues;
}

export interface GateWalkEdge {
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

/**
 * Runtime: every *active* incoming path must come from a gate that actually authorized.
 * Auto-approved human gates do not count (see gateAuthorizesSideEffect).
 */
export function privilegedPathAuthorized(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: GateWalkEdge[],
  outputs: Record<string, Record<string, unknown> | undefined>,
  isActive: (edge: GateWalkEdge) => boolean,
  visiting: Set<string> = new Set(),
): boolean {
  if (visiting.has(nodeId)) return false;
  visiting.add(nodeId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = edges.filter((e) => e.target === nodeId && isActive(e));
  if (incoming.length === 0) {
    visiting.delete(nodeId);
    return false;
  }
  const ok = incoming.every((edge) => {
    const source = byId.get(edge.source);
    if (!source) return false;
    if (isHardGateNodeType(source.data.nodeType)) {
      if (!gateEdgeAuthorizes(edge)) return false;
      return gateAuthorizesSideEffect(source.data.nodeType, outputs[source.id]);
    }
    return privilegedPathAuthorized(source.id, nodes, edges, outputs, isActive, visiting);
  });
  visiting.delete(nodeId);
  return ok;
}

export function extractSkillGates(nodes: WorkflowNode[]) {
  return nodes
    .filter((n) => isHardGateNodeType(n.data.nodeType))
    .map((n) => ({
      kind: gateKindForNodeType(n.data.nodeType)!,
      nodeType: n.data.nodeType,
      label: n.data.label,
      config: n.data.config,
    }));
}

/** True when a completed gate output took the pass/approved branch. */
export function gateOutputPassed(output: Record<string, unknown> | undefined): boolean {
  if (!output) return false;
  if (typeof output.pass === 'boolean') return output.pass;
  if (typeof output.approved === 'boolean') return output.approved;
  return false;
}

/**
 * Authority for side effects. Schema/policy must pass.
 * Human approval only counts when an interactive/resumed decision is recorded —
 * auto-approve `{ approved: true }` is not authority.
 */
export function gateAuthorizesSideEffect(
  nodeType: string,
  output: Record<string, unknown> | undefined,
): boolean {
  if (!output) return false;
  if (nodeType === 'schema_gate' || nodeType === 'policy_gate') {
    return output.pass === true;
  }
  if (nodeType === 'human_approval') {
    if (output.approved !== true) return false;
    return (
      output.interactive === true ||
      output.authority === true ||
      Boolean(output.resumeToken)
    );
  }
  return false;
}

export interface GateTraceRecord {
  kind: 'schema' | 'policy' | 'authority';
  input?: unknown;
  pass?: boolean;
  approved?: boolean;
  reason?: string;
  branch?: string;
  payloadHash?: string;
}

export function captureGateTrace(
  nodeType: string,
  input: unknown,
  output: Record<string, unknown> | undefined,
): GateTraceRecord | undefined {
  const kind = gateKindForNodeType(nodeType);
  if (!kind) return undefined;
  const branch =
    output?.approved === true
      ? 'approved'
      : output?.rejected === true
        ? 'rejected'
        : output?.pass === true
          ? 'pass'
          : output?.fail === true
            ? 'fail'
            : undefined;
  return {
    kind,
    input,
    pass: typeof output?.pass === 'boolean' ? output.pass : undefined,
    approved: typeof output?.approved === 'boolean' ? output.approved : undefined,
    reason: typeof output?.reason === 'string' ? output.reason : undefined,
    branch,
    payloadHash: typeof output?.payloadHash === 'string' ? output.payloadHash : undefined,
  };
}

/** Re-evaluate a schema/policy gate from a stored trace. Authority traces are not recomputed. */
export function replayGateTrace(
  record: GateTraceRecord,
  config: Record<string, unknown>,
): { ok: boolean; reason: string; pass?: boolean } {
  if (record.kind === 'authority') {
    return {
      ok: true,
      reason: 'Authority traces are replayed from the recorded decision, not recomputed',
      pass: record.approved === true,
    };
  }
  const input =
    record.input && typeof record.input === 'object' && !Array.isArray(record.input)
      ? (record.input as Record<string, unknown>)
      : { value: record.input };
  const result =
    record.kind === 'schema' ? evaluateSchemaGate(config, input) : evaluatePolicyGate(config, input);
  const recorded = record.pass === true;
  if (result.pass !== recorded) {
    return {
      ok: false,
      reason: `Replay mismatch: recorded ${recorded ? 'pass' : 'fail'}, recomputed ${result.pass ? 'pass' : 'fail'}`,
      pass: result.pass,
    };
  }
  return { ok: true, reason: result.reason, pass: result.pass };
}
