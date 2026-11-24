import type { WorkflowNode } from '../schema/index.js';
import { evaluatePredicate, interpolate } from '../expressions/index.js';
import {
  evaluatePolicyGate,
  evaluateSchemaGate,
} from '../gates.js';
import {
  invokeAgentTool,
  evaluateStructuredOutput,
  structuredOutputEnabled,
} from '../contracts.js';
import { assertPinnedScript, runPinnedScript } from '../scripts.js';
import { resolveHttpUrl, resolveSandboxPath } from '../privileged.js';
import { nodeIterationLimit } from '../graph.js';
import type { NodeExecutor, ExecutionContext } from './types.js';
import {
  asRecord,
  flattenOutputs,
  mockSoftFailure,
  nodeRunIndex,
  pickQuery,
} from './helpers.js';

async function runReactAgentMock(
  node: WorkflowNode,
  input: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<Record<string, unknown>> {
  const config = node.data.config;
  const max = nodeIterationLimit(node, ctx.limits.maxIterations);
  const tools = Array.isArray(config.tools) ? config.tools.map((t) => String(t)).filter(Boolean) : [];
  const mockToolSteps = Number(
    config.mockToolSteps ?? (tools.length > 0 ? Math.min(1, max - 1) : 0),
  );
  const observations: { step: number; tool: string; observation: string }[] = [];
  let final = '';
  let steps = 0;
  for (let i = 0; i < max; i++) {
    steps = i + 1;
    const useTool = i < mockToolSteps && tools[0];
    if (useTool) {
      invokeAgentTool(ctx, node, tools[0]!);
      observations.push({
        step: steps,
        tool: tools[0]!,
        observation: `mock observation ${steps} for ${String(input.task ?? input.goal ?? 'task').slice(0, 80)}`,
      });
      continue;
    }
    const model = (config.model as { model?: string } | undefined)?.model ?? 'mock';
    final = `[mock:${model}] Finished ReAct loop after ${steps} step(s)`;
    break;
  }
  const prompt = String(config.systemPrompt ?? '') + JSON.stringify(input);
  ctx.tokenUsage.prompt += Math.ceil(prompt.length / 4);
  ctx.tokenUsage.completion += Math.ceil(final.length / 4);
  ctx.tokenUsage.total += Math.ceil(prompt.length / 4) + Math.ceil(final.length / 4);
  return {
    result: final || `[mock:react] Stopped at maxIterations=${max}`,
    observations,
    iterations: steps,
    finish: true,
    action: 'finish',
    trace: { model: (config.model as { model?: string } | undefined)?.model ?? 'mock', steps },
  };
}

export const defaultNodeExecutor: NodeExecutor = async (node, input, ctx) => {
  const type = node.data.nodeType;
  const config = node.data.config;

  switch (type) {
    case 'input':
      return { value: ctx.variables.input ?? input.value ?? input };
    case 'output':
      return { value: input.value ?? input };
    case 'variable': {
      const name = String(config.variableName ?? '');
      return { value: ctx.variables[name] };
    }
    case 'set_variable': {
      const name = String(config.variableName ?? '');
      const value = input.value ?? input;
      if (name) ctx.variables[name] = value;
      return { value };
    }
    case 'transform':
    case 'template': {
      const expr = String(config.expression ?? config.template ?? '{{input}}');
      const merged = { ...ctx.variables, ...ctx.nodeOutputs, input, ...input };
      return { output: interpolate(expr, merged), text: interpolate(expr, merged) };
    }
    case 'json_parse': {
      const text = String(input.text ?? input.value ?? '');
      try {
        return { json: JSON.parse(text) };
      } catch (err) {
        throw new Error(`JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    case 'formatter': {
      const value = input.value ?? input;
      const format = String(config.format ?? 'text');
      if (format === 'json') return { formatted: JSON.stringify(value, null, 2) };
      return { formatted: String(value) };
    }
    case 'condition': {
      const expr = String(config.expression ?? 'true');
      const merged = { ...ctx.variables, ...flattenOutputs(ctx.nodeOutputs), ...input };
      const result = evaluatePredicate(expr, merged);
      const payload = input.payload ?? asRecord(input.value) ?? input;
      return {
        true: result,
        false: !result,
        value: input.value ?? result,
        payload,
        query: input.query ?? asRecord(payload)?.query ?? asRecord(payload)?.message,
      };
    }
    case 'delay': {
      const ms = Math.min(Number(config.delayMs ?? 0), 5000);
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      return { output: input.input ?? input };
    }
    case 'llm':
    case 'agent':
    case 'planner':
    case 'react_agent':
    case 'critic':
    case 'evaluator':
    case 'summarizer':
    case 'router':
    case 'classifier': {
      if (type === 'react_agent') {
        return runReactAgentMock(node, input, ctx);
      }
      // Dry-run mock — real providers plug in via RunOptions.executor
      const requestedTool =
        input.requestedTool ??
        input.tool ??
        (input.value && typeof input.value === 'object' && !Array.isArray(input.value)
          ? (input.value as Record<string, unknown>).requestedTool ??
            (input.value as Record<string, unknown>).tool
          : undefined);
      if (requestedTool !== undefined && requestedTool !== null && requestedTool !== '') {
        invokeAgentTool(ctx, node, String(requestedTool));
      }

      const model = (config.model as { model?: string } | undefined)?.model ?? 'mock';
      const prompt =
        String(config.systemPrompt ?? '') +
        '\n' +
        JSON.stringify(input.goal ?? input.prompt ?? input.task ?? input.content ?? input);
      const mockText = `[mock:${model}] Processed: ${String(input.goal ?? input.prompt ?? input.task ?? input.content ?? 'input').slice(0, 200)}`;
      const structuredRaw = structuredOutputEnabled(config)
        ? (input.json ?? input.value ?? input.result ?? input)
        : mockText;
      const response =
        typeof structuredRaw === 'string' ? structuredRaw : JSON.stringify(structuredRaw);
      const tokens = Math.ceil(prompt.length / 4) + Math.ceil(response.length / 4);
      ctx.tokenUsage.prompt += Math.ceil(prompt.length / 4);
      ctx.tokenUsage.completion += Math.ceil(response.length / 4);
      ctx.tokenUsage.total += tokens;

      const structured = evaluateStructuredOutput(config, structuredRaw);
      const contract = structuredOutputEnabled(config)
        ? {
            valid: structured.ok,
            invalid: !structured.ok,
            structuredOutputFailed: !structured.ok,
            reason: structured.reason,
          }
        : {};
      const runIndex = nodeRunIndex(ctx, node.id);
      const mockActions = Array.isArray(config.mockActions)
        ? config.mockActions.map((a) => String(a))
        : [];
      const action = mockActions.length
        ? (mockActions[Math.min(runIndex, mockActions.length - 1)] ?? 'finish')
        : undefined;
      const actionFlags = action
        ? {
            action,
            finish: action === 'finish' || action === 'none',
            search: action === 'search',
            act: action !== 'finish' && action !== 'none',
            query: String(
              input.query ??
                input.task ??
                input.goal ??
                asRecord(input.value)?.query ??
                'search query',
            ),
          }
        : {};

      if (type === 'evaluator') {
        const failUntil = Number(config.mockFailUntil ?? 0);
        const score = Number(
          config.mockScore ?? (runIndex < failUntil ? 0.2 : 0.85),
        );
        const sufficient = score >= Number(config.threshold ?? 0.7);
        return {
          sufficient,
          insufficient: !sufficient,
          feedback: sufficient
            ? 'Looks good (mock evaluation)'
            : `Needs another pass (mock evaluation, iteration ${runIndex + 1})`,
          result: structured.ok ? structured.value : response,
          score,
          ...contract,
        };
      }
      if (type === 'router' || type === 'classifier') {
        const routes = Array.isArray(config.routes)
          ? config.routes.map((r) => String(r))
          : Array.isArray(config.labels)
            ? config.labels.map((r) => String(r))
            : [];
        const selected = String(
          config.mockRoute ??
            config.mockLabel ??
            input.route ??
            input.label ??
            routes[0] ??
            'default',
        );
        const flags: Record<string, unknown> = {
          route: selected,
          label: selected,
          confidence: 0.9,
          result: structured.ok ? structured.value : response,
          default: routes.length === 0 || !routes.includes(selected),
          ...contract,
        };
        for (const route of routes) flags[route] = route === selected;
        if (routes.includes(selected)) flags.default = false;
        return flags;
      }
      const payload = action
        ? {
            action: actionFlags.action,
            query: actionFlags.query,
            text: structured.ok ? structured.value : response,
          }
        : undefined;
      return {
        result: payload ?? (structured.ok ? structured.value : response),
        completion: structured.ok ? structured.value : response,
        plan: ['step-1', 'step-2'],
        summary: structured.ok ? structured.value : response,
        critique: structured.ok ? structured.value : response,
        payload,
        trace: { model, tokens },
        ...actionFlags,
        ...contract,
      };
    }
    case 'web_search': {
      const query = pickQuery(input);
      return {
        results: [
          { title: `Result for "${query}"`, url: 'https://example.com', snippet: 'Mock search result' },
        ],
        query,
      };
    }
    case 'http_request': {
      const soft = mockSoftFailure(node, ctx);
      if (soft) return soft;
      const url = resolveHttpUrl(config, input);
      const method = String(config.method ?? 'GET').toUpperCase();
      const timeoutMs = Math.min(Number(config.timeoutMs ?? 30_000), 30_000);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const init: RequestInit = { method, signal: controller.signal };
        if (method !== 'GET' && method !== 'HEAD') {
          init.body =
            typeof input.body === 'string' ? input.body : JSON.stringify(input.body ?? input.payload ?? {});
        }
        const res = await fetch(url, init);
        const text = await res.text();
        let response: unknown = text;
        try {
          response = JSON.parse(text);
        } catch {
          /* keep text */
        }
        return { response, status: res.status, url, success: res.ok, fail: !res.ok, error: !res.ok };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          response: null,
          status: 0,
          url,
          success: false,
          fail: true,
          error: true,
          reason,
        };
      } finally {
        clearTimeout(timer);
      }
    }
    case 'file_operation': {
      const path = resolveSandboxPath(config, input);
      const op = String(config.operation ?? 'read');
      if (op === 'write') {
        const payload =
          input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
            ? (input.payload as Record<string, unknown>)
            : {};
        const content = String(input.content ?? payload.content ?? input.value ?? '');
        ctx.fileSandbox.set(path, content);
        return { result: { path, written: true }, path, stdout: '', success: true, fail: false, error: false };
      }
      if (op === 'list') {
        const prefix = path.endsWith('/') ? path : `${path}/`;
        const rows = [...ctx.fileSandbox.keys()].filter((p) => p === path || p.startsWith(prefix));
        return { result: { paths: rows }, rows, success: true, fail: false, error: false };
      }
      const content = ctx.fileSandbox.get(path);
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return { result: { path, content }, stdout: content, success: true, fail: false, error: false };
    }
    case 'tool_call':
    case 'custom_tool':
    case 'database': {
      const soft = mockSoftFailure(node, ctx);
      if (soft) return { ...soft, stdout: '', rows: [] };
      return {
        result: { mock: true, tool: type, input },
        stdout: '',
        rows: [],
        success: true,
        fail: false,
        error: false,
      };
    }
    case 'code_execution': {
      const soft = mockSoftFailure(node, ctx);
      if (soft) return { ...soft, stdout: '', scriptId: config.scriptId ?? node.id };
      const source = await assertPinnedScript(config);
      const args = input.args ?? input.payload ?? (typeof input.value === 'object' ? input.value : input);
      const result = runPinnedScript(source, args);
      return { result, stdout: '', scriptId: config.scriptId ?? node.id, success: true, fail: false, error: false };
    }
    case 'loop': {
      const max = nodeIterationLimit(node, ctx.limits.maxIterations);
      let current = input.input ?? input;
      let i = 0;
      for (; i < max; i++) {
        ctx.iteration = i + 1;
        ctx.variables.iteration = ctx.iteration;
        const cond = String(config.condition ?? config.terminationCondition ?? '');
        if (cond && evaluatePredicate(cond, { ...ctx.variables, current, iteration: i + 1 })) {
          break;
        }
        current = { ...(typeof current === 'object' && current ? current : { value: current }), iteration: i + 1 };
      }
      return { output: current, iterations: i };
    }
    case 'for_each': {
      const items = Array.isArray(input.items)
        ? input.items
        : Array.isArray(input.value)
          ? input.value
          : Array.isArray(input.plan)
            ? input.plan
            : [];
      ctx.variables.items = items;
      return {
        results: items.map((item, index) => ({ item, index })),
        count: items.length,
      };
    }
    case 'parallel':
      return { results: [input.input ?? input] };
    case 'merge':
      return { merged: { ...input } };
    case 'retry':
      return { output: input.input ?? input };
    case 'schema_gate': {
      const result = evaluateSchemaGate(config, input);
      return {
        pass: result.pass,
        fail: result.fail,
        payload: result.payload,
        reason: result.reason,
        issues: result.issues ?? [],
      };
    }
    case 'policy_gate': {
      const result = evaluatePolicyGate(config, input, {
        ...ctx.variables,
        ...flattenOutputs(ctx.nodeOutputs),
      });
      return {
        pass: result.pass,
        fail: result.fail,
        payload: result.payload,
        reason: result.reason,
      };
    }
    case 'human_approval':
      throw new Error(
        'Human approval must pause the run — resume with resumeWorkflow after an interactive decision',
      );
    case 'human_input':
      return { response: String(config.prompt ?? 'acknowledged') };
    case 'escalation':
      return { resolution: 'escalated (mock)' };
    case 'review':
      return { reviewed: input.content ?? input, notes: '' };
    case 'skill':
    case 'skill_chain':
    case 'published_skill':
      throw new Error(`Skill node "${node.data.label}" must be resolved by the executor`);
    case 'sub_workflow':
      return { output: input.input ?? input };
    case 'switch': {
      const raw = input.value ?? input.route ?? input.label ?? input;
      const nested = asRecord(raw);
      const value = String(
        nested?.value ?? nested?.route ?? nested?.label ?? nested?.action ?? raw,
      );
      const cases = Array.isArray(config.cases) ? config.cases : [];
      const reserved = new Set(['value', 'default', 'matched', 'matchedCase']);
      const matched: Record<string, unknown> = { value };
      let anyHit = false;
      for (const entry of cases) {
        const rec: Record<string, unknown> = asRecord(entry) ?? { value: entry };
        const caseValue = String(rec.value ?? rec.match ?? '');
        const handle = String(rec.handle ?? rec.port ?? caseValue);
        const hit = caseValue === value;
        if (hit) anyHit = true;
        if (!reserved.has(handle)) matched[handle] = hit;
      }
      matched.default = !anyHit;
      matched.matched = anyHit;
      matched.matchedCase = anyHit ? value : undefined;
      return matched;
    }
    default:
      return { output: input };
  }
};
