import type { WorkflowNode } from './schema/index.js';

const FORBIDDEN =
  /\b(fetch|XMLHttpRequest|WebSocket|import(?:\s|\()|require\s*\(|process|globalThis|Function|eval|Worker|document|window|Deno|Bun)\b/;

const FORBIDDEN_PROPS = new Set(['constructor', 'prototype', '__proto__']);

const MAIN_RE = /^\s*function\s+main\s*\(\s*args\s*\)\s*\{([\s\S]*)\}\s*$/;
const RETURN_RE = /^\s*return\s+([\s\S]*?);?\s*$/;

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'sym'; v: string }
  | { t: 'eof' };

const MATH: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  max: Math.max,
  min: Math.min,
};

const BUILTINS: Record<string, (...args: unknown[]) => unknown> = {
  Number: (value) => Number(value),
  String: (value) => String(value),
  Boolean: (value) => Boolean(value),
};

export async function hashScriptSource(source: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('SHA-256 is unavailable in this runtime');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function pinnedScriptConfigError(config: Record<string, unknown>): string | null {
  const source = String(config.source ?? '');
  if (!source.trim()) return 'requires pinned source';
  if (config.pinned !== true) return 'must be pinned before it can run';
  const hash = String(config.sourceHash ?? '').trim();
  if (!hash) return 'requires a sourceHash pin';
  if (FORBIDDEN.test(source)) return 'source uses a forbidden API';
  try {
    parsePinnedMain(source);
  } catch (err) {
    return err instanceof Error ? err.message : 'source is not a valid pinned script';
  }
  return null;
}

export async function assertPinnedScript(config: Record<string, unknown>): Promise<string> {
  const staticError = pinnedScriptConfigError(config);
  if (staticError) throw new Error(`Pinned script ${staticError}`);
  const source = String(config.source);
  const expected = String(config.sourceHash);
  const actual = await hashScriptSource(source);
  if (actual !== expected) {
    throw new Error('Pinned script sourceHash does not match source');
  }
  return source;
}

/**
 * Restricted interpreter: `function main(args) { return <expr>; }` only.
 * No `new Function` / eval — host APIs are unreachable from the grammar.
 */
export function runPinnedScript(source: string, args: unknown): unknown {
  if (FORBIDDEN.test(source)) {
    throw new Error('Pinned script uses a forbidden API');
  }
  const expr = parsePinnedMain(source);
  return evaluate(expr, args);
}

export function extractSkillScripts(nodes: WorkflowNode[]) {
  return nodes
    .filter((n) => n.data.nodeType === 'code_execution')
    .map((n) => ({
      scriptId: String(n.data.config.scriptId ?? n.id),
      label: n.data.label,
      language: String(n.data.config.language ?? 'javascript'),
      source: String(n.data.config.source ?? ''),
      sourceHash: String(n.data.config.sourceHash ?? ''),
      pinned: n.data.config.pinned === true,
    }));
}

export function skillScriptsIntegrityError(skill: {
  scripts?: Array<{ scriptId: string; source: string; sourceHash: string; pinned: boolean }>;
  internalWorkflow?: { nodes: WorkflowNode[] };
}): string | null {
  const declared = [...(skill.scripts ?? [])].sort((a, b) => a.scriptId.localeCompare(b.scriptId));
  const derived = extractSkillScripts(skill.internalWorkflow?.nodes ?? []).sort((a, b) =>
    a.scriptId.localeCompare(b.scriptId),
  );
  if (!skill.internalWorkflow) {
    if (declared.length === 0) return null;
    return 'scripts[] must match internalWorkflow code_execution nodes';
  }
  if (declared.length !== derived.length) {
    return 'scripts[] must match internalWorkflow code_execution nodes';
  }
  for (let i = 0; i < declared.length; i++) {
    const meta = declared[i]!;
    const node = derived[i]!;
    if (
      meta.scriptId !== node.scriptId ||
      meta.source !== node.source ||
      meta.sourceHash !== node.sourceHash ||
      meta.pinned !== node.pinned
    ) {
      return `scripts[] does not match internalWorkflow for ${meta.scriptId}`;
    }
  }
  return null;
}

function parsePinnedMain(source: string): Expr {
  const wrapped = source.match(MAIN_RE);
  if (!wrapped) {
    throw new Error('must define function main(args) { return <expression>; }');
  }
  const body = wrapped[1] ?? '';
  const returned = body.match(RETURN_RE);
  if (!returned) {
    throw new Error('main() may only contain a single return expression');
  }
  const expr = parseExpression((returned[1] ?? '').trim());
  assertSafeExpr(expr);
  return expr;
}

function assertSafeExpr(expr: Expr): void {
  switch (expr.k) {
    case 'lit':
      return;
    case 'id':
      if (FORBIDDEN_PROPS.has(expr.n) || FORBIDDEN.test(expr.n)) {
        throw new Error('source uses a forbidden API');
      }
      return;
    case 'member':
      if (FORBIDDEN_PROPS.has(expr.p)) throw new Error('source uses a forbidden API');
      assertSafeExpr(expr.o);
      return;
    case 'call':
      assertSafeExpr(expr.c);
      for (const a of expr.a) assertSafeExpr(a);
      return;
    case 'obj':
      for (const field of expr.e) {
        if (FORBIDDEN_PROPS.has(field.key)) throw new Error('source uses a forbidden API');
        assertSafeExpr(field.value);
      }
      return;
    case 'arr':
      for (const item of expr.e) assertSafeExpr(item);
      return;
    case 'unary':
      assertSafeExpr(expr.x);
      return;
    case 'bin':
      assertSafeExpr(expr.l);
      assertSafeExpr(expr.r);
      return;
    case 'ternary':
      assertSafeExpr(expr.c);
      assertSafeExpr(expr.t);
      assertSafeExpr(expr.f);
  }
}

type Expr =
  | { k: 'lit'; v: unknown }
  | { k: 'id'; n: string }
  | { k: 'member'; o: Expr; p: string }
  | { k: 'call'; c: Expr; a: Expr[] }
  | { k: 'obj'; e: Array<{ key: string; value: Expr }> }
  | { k: 'arr'; e: Expr[] }
  | { k: 'unary'; op: '+' | '-'; x: Expr }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'ternary'; c: Expr; t: Expr; f: Expr };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      i += 1;
      let s = '';
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') {
          i += 1;
          const n = src[i] ?? '';
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          i += 1;
        } else {
          s += src[i]!;
          i += 1;
        }
      }
      if (src[i] !== q) throw new Error('Unterminated string in pinned script');
      i += 1;
      tokens.push({ t: 'str', v: s });
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = src.slice(i).match(/^\d+(\.\d+)?/);
      if (!m) throw new Error('Invalid number in pinned script');
      tokens.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
      tokens.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      tokens.push({ t: 'sym', v: two });
      i += 2;
      continue;
    }
    if ('+-*/%()[]{}:,.?:'.includes(c)) {
      tokens.push({ t: 'sym', v: c });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character in pinned script: ${c}`);
  }
  tokens.push({ t: 'eof' });
  return tokens;
}

function parseExpression(src: string): Expr {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i]!;
  const eat = () => tokens[i++]!;
  const peekSym = (): string | undefined => {
    const tok = peek();
    return tok.t === 'sym' ? tok.v : undefined;
  };
  const eatSym = (): string => {
    const tok = eat();
    if (tok.t !== 'sym') throw new Error('Expected symbol in pinned script');
    return tok.v;
  };
  const expect = (sym: string) => {
    if (eatSym() !== sym) throw new Error(`Expected ${sym} in pinned script`);
  };

  const parseTernary = (): Expr => {
    const cond = parseOr();
    if (peekSym() === '?') {
      eat();
      const t = parseTernary();
      expect(':');
      return { k: 'ternary', c: cond, t, f: parseTernary() };
    }
    return cond;
  };
  const parseOr = (): Expr => {
    let left = parseAnd();
    while (peekSym() === '||') {
      eat();
      left = { k: 'bin', op: '||', l: left, r: parseAnd() };
    }
    return left;
  };
  const parseAnd = (): Expr => {
    let left = parseEq();
    while (peekSym() === '&&') {
      eat();
      left = { k: 'bin', op: '&&', l: left, r: parseEq() };
    }
    return left;
  };
  const parseEq = (): Expr => {
    let left = parseCmp();
    while (peekSym() === '==' || peekSym() === '!=') {
      const op = eatSym();
      left = { k: 'bin', op, l: left, r: parseCmp() };
    }
    return left;
  };
  const parseCmp = (): Expr => {
    let left = parseAdd();
    while (
      peekSym() === '<' ||
      peekSym() === '>' ||
      peekSym() === '<=' ||
      peekSym() === '>='
    ) {
      const op = eatSym();
      left = { k: 'bin', op, l: left, r: parseAdd() };
    }
    return left;
  };
  const parseAdd = (): Expr => {
    let left = parseMul();
    while (peekSym() === '+' || peekSym() === '-') {
      const op = eatSym();
      left = { k: 'bin', op, l: left, r: parseMul() };
    }
    return left;
  };
  const parseMul = (): Expr => {
    let left = parseUnary();
    while (peekSym() === '*' || peekSym() === '/' || peekSym() === '%') {
      const op = eatSym();
      left = { k: 'bin', op, l: left, r: parseUnary() };
    }
    return left;
  };
  const parseUnary = (): Expr => {
    if (peekSym() === '+' || peekSym() === '-') {
      const op = eatSym() as '+' | '-';
      return { k: 'unary', op, x: parseUnary() };
    }
    return parsePostfix();
  };
  const parsePostfix = (): Expr => {
    let expr = parsePrimary();
    for (;;) {
      if (peekSym() === '.') {
        eat();
        const id = eat();
        if (id.t !== 'id') throw new Error('Expected property name in pinned script');
        expr = { k: 'member', o: expr, p: id.v };
        continue;
      }
      if (peekSym() === '[') {
        eat();
        const key = parseTernary();
        expect(']');
        if (key.k !== 'lit' || typeof key.v !== 'string') {
          throw new Error('Pinned script index must be a string literal');
        }
        expr = { k: 'member', o: expr, p: key.v };
        continue;
      }
      if (peekSym() === '(') {
        eat();
        const args: Expr[] = [];
        if (peekSym() !== ')') {
          args.push(parseTernary());
          while (peekSym() === ',') {
            eat();
            args.push(parseTernary());
          }
        }
        expect(')');
        expr = { k: 'call', c: expr, a: args };
        continue;
      }
      return expr;
    }
  };
  const parsePrimary = (): Expr => {
    const tok = eat();
    if (tok.t === 'num') return { k: 'lit', v: tok.v };
    if (tok.t === 'str') return { k: 'lit', v: tok.v };
    if (tok.t === 'id') {
      if (tok.v === 'true') return { k: 'lit', v: true };
      if (tok.v === 'false') return { k: 'lit', v: false };
      if (tok.v === 'null') return { k: 'lit', v: null };
      return { k: 'id', n: tok.v };
    }
    if (tok.t === 'sym' && tok.v === '(') {
      const inner = parseTernary();
      expect(')');
      return inner;
    }
    if (tok.t === 'sym' && tok.v === '[') {
      const e: Expr[] = [];
      if (peekSym() !== ']') {
        e.push(parseTernary());
        while (peekSym() === ',') {
          eat();
          e.push(parseTernary());
        }
      }
      expect(']');
      return { k: 'arr', e };
    }
    if (tok.t === 'sym' && tok.v === '{') {
      const e: Array<{ key: string; value: Expr }> = [];
      if (peekSym() !== '}') {
        e.push(parseField());
        while (peekSym() === ',') {
          eat();
          e.push(parseField());
        }
      }
      expect('}');
      return { k: 'obj', e };
    }
    throw new Error('Invalid expression in pinned script');
  };
  const parseField = (): { key: string; value: Expr } => {
    const tok = eat();
    let key: string;
    if (tok.t === 'id') key = tok.v;
    else if (tok.t === 'str') key = tok.v;
    else throw new Error('Invalid object key in pinned script');
    if (FORBIDDEN_PROPS.has(key)) throw new Error('Pinned script uses a forbidden property');
    expect(':');
    return { key, value: parseTernary() };
  };

  const expr = parseTernary();
  if (peek().t !== 'eof') throw new Error('Unexpected tokens after pinned script expression');
  return expr;
}

function evaluate(expr: Expr, args: unknown): unknown {
  switch (expr.k) {
    case 'lit':
      return expr.v;
    case 'id':
      return resolveIdent(expr.n, args);
    case 'member':
      return readProp(evaluate(expr.o, args), expr.p);
    case 'call':
      return callFn(evaluate(expr.c, args), expr.a.map((a) => evaluate(a, args)));
    case 'obj': {
      const obj = Object.create(null) as Record<string, unknown>;
      for (const field of expr.e) obj[field.key] = evaluate(field.value, args);
      return obj;
    }
    case 'arr':
      return expr.e.map((item) => evaluate(item, args));
    case 'unary': {
      const v = Number(evaluate(expr.x, args));
      return expr.op === '-' ? -v : v;
    }
    case 'bin':
      return evalBin(expr.op, evaluate(expr.l, args), evaluate(expr.r, args));
    case 'ternary':
      return evaluate(expr.c, args) ? evaluate(expr.t, args) : evaluate(expr.f, args);
  }
}

function resolveIdent(name: string, args: unknown): unknown {
  if (name === 'args') return args;
  if (name === 'Math') return MATH;
  if (name in BUILTINS) return BUILTINS[name];
  if (FORBIDDEN_PROPS.has(name) || FORBIDDEN.test(name)) {
    throw new Error('Pinned script uses a forbidden identifier');
  }
  throw new Error(`Unknown identifier in pinned script: ${name}`);
}

function readProp(obj: unknown, key: string): unknown {
  if (FORBIDDEN_PROPS.has(key)) {
    throw new Error('Pinned script uses a forbidden property');
  }
  if (obj === MATH) {
    if (key in MATH) return MATH[key];
    throw new Error(`Unknown Math.${key} in pinned script`);
  }
  if (obj == null || typeof obj !== 'object') {
    throw new Error('Pinned script cannot read that property');
  }
  if (!Object.hasOwn(obj, key)) return undefined;
  return (obj as Record<string, unknown>)[key];
}

function callFn(callee: unknown, args: unknown[]): unknown {
  if (typeof callee !== 'function') {
    throw new Error('Pinned script can only call Number/String/Boolean/Math.*');
  }
  const allowed =
    Object.values(BUILTINS).includes(callee as (typeof BUILTINS)[string]) ||
    Object.values(MATH).includes(callee as (typeof MATH)[string]);
  if (!allowed) {
    throw new Error('Pinned script can only call Number/String/Boolean/Math.*');
  }
  return (callee as (...fnArgs: unknown[]) => unknown)(...args);
}

function evalBin(op: string, left: unknown, right: unknown): unknown {
  switch (op) {
    case '+':
      if (typeof left === 'string' || typeof right === 'string') return String(left) + String(right);
      return Number(left) + Number(right);
    case '-':
      return Number(left) - Number(right);
    case '*':
      return Number(left) * Number(right);
    case '/':
      return Number(left) / Number(right);
    case '%':
      return Number(left) % Number(right);
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
      return Number(left) < Number(right);
    case '>':
      return Number(left) > Number(right);
    case '<=':
      return Number(left) <= Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '&&':
      return left && right;
    case '||':
      return left || right;
    default:
      throw new Error(`Unsupported operator in pinned script: ${op}`);
  }
}
