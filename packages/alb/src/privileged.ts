import { pathMatchesAllowlist } from './gates.js';
import type { WorkflowNode } from './schema/index.js';

function listFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function httpUrlAllowlist(config: Record<string, unknown>): string[] {
  const pinned = String(config.url ?? '').trim();
  const extra = listFrom(config.urlAllowlist);
  return [...new Set([pinned, ...extra].filter(Boolean))];
}

export function resolveHttpUrl(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
): string {
  const allow = httpUrlAllowlist(config);
  if (allow.length === 0) {
    throw new Error('HTTP request has no pinned URL or urlAllowlist');
  }
  let url = String(config.url ?? '').trim();
  const requested = String(input.url ?? '').trim();
  if (config.allowInputUrl === true && requested) {
    url = requested;
  } else if (requested && requested !== url) {
    throw new Error('HTTP request URL cannot be overridden by input');
  }
  if (!allow.includes(url) && !pathMatchesAllowlist(url, allow, 'prefix')) {
    throw new Error(`HTTP URL "${url}" is not on the allowlist`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`HTTP URL "${url}" is invalid`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`HTTP URL scheme "${parsed.protocol}" is not allowed`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('HTTP URLs with credentials are not allowed');
  }
  return parsed.toString();
}

export function filePathAllowlist(config: Record<string, unknown>): string[] {
  return listFrom(config.pathAllowlist ?? config.allowlist);
}

function nested(input: Record<string, unknown>, key: string): unknown {
  if (input[key] !== undefined) return input[key];
  for (const bag of [input.payload, input.value, input.result, input.input]) {
    if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
      const value = (bag as Record<string, unknown>)[key];
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

export function resolveSandboxPath(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
): string {
  const allow = filePathAllowlist(config);
  if (allow.length === 0) {
    throw new Error('File operation has no path allowlist');
  }
  const path = String(nested(input, 'path') ?? config.path ?? '').trim();
  if (!path) throw new Error('File operation is missing a path');
  if (!pathMatchesAllowlist(path, allow, 'prefix')) {
    throw new Error(`Path "${path}" is not on the file allowlist`);
  }
  return path;
}

export function extractSkillPrivilegedTools(nodes: WorkflowNode[]) {
  return nodes
    .filter(
      (n) =>
        n.data.nodeType === 'http_request' ||
        n.data.nodeType === 'file_operation' ||
        n.data.nodeType === 'web_search',
    )
    .map((n) => ({
      nodeType: n.data.nodeType,
      label: n.data.label,
      url: n.data.config.url ? String(n.data.config.url) : undefined,
      urlAllowlist: httpUrlAllowlist(n.data.config),
      pathAllowlist: filePathAllowlist(n.data.config),
    }));
}
