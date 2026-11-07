/**
 * Expression engine for {{path.to.value}} templates and simple predicates.
 * Safe by design: no arbitrary JS eval — only path resolution and comparisons.
 */

export type ExpressionContext = Record<string, unknown>;

const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function getPath(ctx: ExpressionContext, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = ctx;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Resolve a single path like `research.output` against context */
export function resolvePath(ctx: ExpressionContext, path: string): unknown {
  return getPath(ctx, path);
}

/** Interpolate {{var}} templates in a string */
export function interpolate(template: string, ctx: ExpressionContext): string {
  return template.replace(TEMPLATE_RE, (_match, path: string) => {
    const value = getPath(ctx, path);
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  });
}

/** Extract referenced variable paths from a template */
export function extractReferences(template: string): string[] {
  const refs: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(TEMPLATE_RE.source, 'g');
  while ((match = re.exec(template)) !== null) {
    if (match[1]) refs.push(match[1]);
  }
  return [...new Set(refs)];
}

export type ComparisonOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'truthy' | 'falsy';

export interface SimplePredicate {
  path: string;
  op: ComparisonOp;
  value?: unknown;
}

const PREDICATE_RE =
  /^\s*([a-zA-Z0-9_.]+)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$|^\s*(!?)\s*([a-zA-Z0-9_.]+)\s*$/;

function parseLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parse a simple predicate expression into a structured form */
export function parsePredicate(expression: string): SimplePredicate | null {
  const match = expression.trim().match(PREDICATE_RE);
  if (!match) return null;

  if (match[4] !== undefined && match[5]) {
    return {
      path: match[5],
      op: match[4] === '!' ? 'falsy' : 'truthy',
    };
  }

  const path = match[1];
  const opRaw = match[2];
  const valueRaw = match[3];
  if (!path || !opRaw || valueRaw === undefined) return null;

  const opMap: Record<string, ComparisonOp> = {
    '==': 'eq',
    '!=': 'neq',
    '>': 'gt',
    '>=': 'gte',
    '<': 'lt',
    '<=': 'lte',
  };
  const op = opMap[opRaw];
  if (!op) return null;

  return { path, op, value: parseLiteral(valueRaw) };
}

export function evaluatePredicate(expression: string, ctx: ExpressionContext): boolean {
  const trimmed = expression.trim();
  if (trimmed === '' || trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Template-only expressions: truthy if interpolated non-empty
  if (trimmed.includes('{{')) {
    const result = interpolate(trimmed, ctx).trim();
    return result !== '' && result !== 'false' && result !== '0' && result !== 'null';
  }

  const pred = parsePredicate(trimmed);
  if (!pred) {
    // Bare path
    const value = getPath(ctx, trimmed);
    return Boolean(value);
  }

  const left = getPath(ctx, pred.path);
  switch (pred.op) {
    case 'truthy':
      return Boolean(left);
    case 'falsy':
      return !left;
    case 'eq':
      return left === pred.value;
    case 'neq':
      return left !== pred.value;
    case 'gt':
      return Number(left) > Number(pred.value);
    case 'gte':
      return Number(left) >= Number(pred.value);
    case 'lt':
      return Number(left) < Number(pred.value);
    case 'lte':
      return Number(left) <= Number(pred.value);
    default:
      return false;
  }
}

export function previewExpression(expression: string, ctx: ExpressionContext): {
  ok: boolean;
  result?: unknown;
  error?: string;
} {
  try {
    if (expression.includes('{{')) {
      return { ok: true, result: interpolate(expression, ctx) };
    }
    if (parsePredicate(expression) || expression === 'true' || expression === 'false') {
      return { ok: true, result: evaluatePredicate(expression, ctx) };
    }
    return { ok: true, result: resolvePath(ctx, expression) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
