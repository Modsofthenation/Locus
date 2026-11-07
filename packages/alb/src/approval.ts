import type { WorkflowRun } from './schema/index.js';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

export async function hashPayload(payload: unknown): Promise<string> {
  const text = canonicalJson(payload);
  const bytes = new TextEncoder().encode(text);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('SHA-256 is unavailable in this runtime');
  }
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ApprovalResume {
  pausedRun: WorkflowRun;
  nodeId: string;
  resumeToken: string;
  payloadHash: string;
  approved: boolean;
  approvedBy?: string;
}

export interface PendingApproval {
  nodeId: string;
  resumeToken: string;
  payloadHash: string;
  payload: unknown;
  message?: string;
}
