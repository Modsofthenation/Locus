import type { WorkflowNode } from '../schema/index.js';
import type { ExecutionContext } from './types.js';

export function nodeRunIndex(ctx: ExecutionContext, nodeId: string): number {
  return Math.max(0, (ctx.nodeRunCounts[nodeId] ?? 1) - 1);
}

export function mockSoftFailure(
  node: WorkflowNode,
  ctx: ExecutionContext,
): Record<string, unknown> | undefined {
  const failUntil = Number(node.data.config.mockFailUntil ?? 0);
  if (!Number.isFinite(failUntil) || failUntil <= 0) return undefined;
  const runIndex = nodeRunIndex(ctx, node.id);
  if (runIndex >= failUntil) return undefined;
  const reason = `mock failure (iteration ${runIndex + 1})`;
  return {
    fail: true,
    error: true,
    retry: true,
    success: false,
    reason,
    result: { error: reason },
  };
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function flattenOutputs(
  nodeOutputs: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [nodeId, outs] of Object.entries(nodeOutputs)) {
    flat[nodeId] = outs;
    for (const [k, v] of Object.entries(outs)) {
      flat[`${nodeId}.${k}`] = v;
    }
  }
  return flat;
}

export function pickQuery(input: Record<string, unknown>): string {
  const payload =
    asRecord(input.payload) ??
    asRecord(input.value) ??
    asRecord(input.result) ??
    asRecord(input.query);
  const raw =
    (typeof input.query === 'string' ? input.query : undefined) ??
    input.message ??
    payload?.query ??
    payload?.message ??
    (typeof input.value === 'string' ? input.value : undefined);
  if (raw !== undefined && raw !== null && typeof raw !== 'object') return String(raw);
  return '';
}
