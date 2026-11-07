import {
  agentToolPermissions,
  agentToolsAllowlist,
  consumeToolCall,
  defaultNodeExecutor,
  executeWorkflow,
  nodeIterationLimit,
  resolveSandboxPath,
  resumeWorkflow,
  type ExecutionContext,
  type NodeExecutor,
  type Workflow,
  type WorkflowNode,
  type WorkflowRun,
} from "@locus/alb";
import { isWorkflowToolName } from "@locus/shared";

const MODEL_NODE_TYPES = new Set([
  "agent",
  "llm",
  "planner",
  "react_agent",
  "critic",
  "evaluator",
  "summarizer",
  "router",
  "classifier",
]);

const TOOL_OUTPUT_CAP = 24_000;

export interface WorkflowToolResult {
  ok: boolean;
  output: string;
}

export interface WorkflowToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface WorkflowCompletion {
  text: string;
  toolCalls: WorkflowToolCall[];
}

export type WorkflowCompleter = (input: {
  system: string;
  user: string;
  tools: string[];
}) => Promise<WorkflowCompletion | undefined>;

export interface LocusWorkflowRunOptions {
  input?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Tool names this session may call. An empty node allowlist means this list. */
  toolCatalog: string[];
  invokeTool: (name: string, args: Record<string, unknown>) => Promise<WorkflowToolResult>;
  /** When omitted, model nodes stay on the deterministic mock executor. */
  complete?: WorkflowCompleter;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function nested(input: Record<string, unknown>, key: string): unknown {
  if (input[key] !== undefined) return input[key];
  for (const bag of [input.payload, input.value, input.result, input.input, input.args]) {
    const rec = asRecord(bag);
    if (rec && rec[key] !== undefined) return rec[key];
  }
  return undefined;
}

function clip(text: string): string {
  if (text.length <= TOOL_OUTPUT_CAP) return text;
  return `${text.slice(0, TOOL_OUTPUT_CAP)}\n…[truncated]`;
}

function toolResultOutput(result: WorkflowToolResult): Record<string, unknown> {
  const output = clip(result.output);
  return {
    result: output,
    stdout: output,
    content: output,
    success: result.ok,
    fail: !result.ok,
    error: !result.ok,
    reason: result.ok ? "" : output,
  };
}

function assertModelTool(
  node: WorkflowNode,
  ctx: ExecutionContext,
  toolId: string,
  catalog: string[],
): void {
  const id = toolId.trim();
  if (!id) throw new Error("Tool call is missing a tool id");
  if (isWorkflowToolName(id)) {
    throw new Error("Workflows cannot start or resume another workflow");
  }
  const authored = agentToolsAllowlist(node.data.config);
  const allow = authored.length ? authored : catalog;
  if (!allow.includes(id) && !allow.includes("*")) {
    throw new Error(`Tool "${id}" is not available to this workflow node`);
  }
  const perms = agentToolPermissions(node.data.config);
  if (id in perms && perms[id] === false) {
    throw new Error(`Tool "${id}" is denied by toolPermissions`);
  }
  consumeToolCall(ctx);
}

async function callLocusTool(
  name: string,
  args: Record<string, unknown>,
  invokeTool: LocusWorkflowRunOptions["invokeTool"],
): Promise<Record<string, unknown>> {
  if (isWorkflowToolName(name)) {
    throw new Error("Workflows cannot start or resume another workflow");
  }
  try {
    const result = await invokeTool(name, args);
    return toolResultOutput(result);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return toolResultOutput({ ok: false, output: reason });
  }
}

function toolArgs(node: WorkflowNode, input: Record<string, unknown>): Record<string, unknown> {
  const configArgs = asRecord(node.data.config.args) ?? {};
  const inputArgs = asRecord(nested(input, "args")) ?? {};
  const payload = asRecord(nested(input, "payload")) ?? {};
  const value = asRecord(nested(input, "value")) ?? {};
  const path = nested(input, "path") ?? node.data.config.path;
  const content = nested(input, "content");
  const query = nested(input, "query");
  return {
    ...payload,
    ...value,
    ...inputArgs,
    ...configArgs,
    ...(typeof path === "string" && path ? { path } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(typeof query === "string" && query ? { query } : {}),
  };
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? trimmed).trim();
  if (!raw.startsWith("{")) return undefined;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function modelFields(
  type: string,
  text: string,
  observations: { step: number; tool: string; observation: string }[],
): Record<string, unknown> {
  const parsed = parseJsonObject(text);
  const result =
    typeof parsed?.result === "string"
      ? parsed.result
      : parsed?.result !== undefined
        ? JSON.stringify(parsed.result)
        : text;
  const base: Record<string, unknown> = {
    result,
    completion: result,
    observations,
    finish: true,
    summary: result,
    critique: result,
    plan: Array.isArray(parsed?.plan) ? parsed.plan : [result],
    trace: { provider: "locus", steps: observations.length },
  };
  if (type === "evaluator") {
    const score = Number(parsed?.score ?? 0.85);
    const sufficient =
      typeof parsed?.sufficient === "boolean" ? parsed.sufficient : score >= Number(0.7);
    return {
      ...base,
      score,
      sufficient,
      insufficient: !sufficient,
      feedback: String(parsed?.feedback ?? result),
    };
  }
  if (type === "router" || type === "classifier") {
    const selected = String(parsed?.route ?? parsed?.label ?? "default");
    return {
      ...base,
      route: selected,
      label: selected,
      confidence: Number(parsed?.confidence ?? 0.9),
      [selected]: true,
      default: selected === "default",
    };
  }
  return base;
}

async function runModelNode(
  node: WorkflowNode,
  input: Record<string, unknown>,
  ctx: ExecutionContext,
  options: LocusWorkflowRunOptions,
): Promise<Record<string, unknown>> {
  if (!options.complete) return defaultNodeExecutor(node, input, ctx);
  const authored = agentToolsAllowlist(node.data.config);
  const tools = (authored.length ? authored : options.toolCatalog).filter(
    (name) => !isWorkflowToolName(name),
  );
  const max = nodeIterationLimit(node, ctx.limits.maxIterations);
  const system = [
    String(node.data.config.systemPrompt ?? "You are a Locus workflow agent."),
    "You are running inside a Locus session and may call that session's tools.",
    tools.length ? `Tools: ${tools.join(", ")}` : "No tools are allowlisted.",
    'When you are done, reply with JSON {"action":"finish","result":"..."}.',
    'Evaluators include "sufficient", "score", and "feedback". Routers include "route".',
  ].join("\n");
  let user = `Node: ${node.data.label} (${node.data.nodeType})\nInput:\n${JSON.stringify(input)}`;
  const observations: { step: number; tool: string; observation: string }[] = [];
  for (let step = 0; step < max; step++) {
    const turn = await options.complete({ system, user, tools });
    if (!turn) return defaultNodeExecutor(node, input, ctx);
    const calls =
      turn.toolCalls.length > 0
        ? turn.toolCalls
        : (() => {
            const parsed = parseJsonObject(turn.text);
            if (parsed?.action !== "tool" || typeof parsed.tool !== "string") return [];
            return [
              {
                name: parsed.tool,
                arguments: asRecord(parsed.args) ?? {},
              },
            ];
          })();
    if (!calls.length) return modelFields(node.data.nodeType, turn.text, observations);
    for (const call of calls) {
      assertModelTool(node, ctx, call.name, options.toolCatalog);
      const result = await callLocusTool(call.name, call.arguments, options.invokeTool);
      const observation = clip(String(result.result ?? ""));
      observations.push({ step: step + 1, tool: call.name, observation });
      user += `\n\nTool ${call.name} => ${observation}`;
    }
  }
  return {
    result: "Stopped at maxIterations",
    observations,
    finish: false,
  };
}

async function runFileNode(
  node: WorkflowNode,
  input: Record<string, unknown>,
  invokeTool: LocusWorkflowRunOptions["invokeTool"],
): Promise<Record<string, unknown>> {
  const path = resolveSandboxPath(node.data.config, input);
  const op = String(node.data.config.operation ?? "read");
  if (op === "write") {
    const content = String(nested(input, "content") ?? nested(input, "value") ?? "");
    const result = await callLocusTool("file_write", { path, content }, invokeTool);
    return { ...result, path };
  }
  if (op === "list") {
    const result = await callLocusTool("file_list", { path }, invokeTool);
    return { ...result, path, rows: result.result };
  }
  const result = await callLocusTool("file_read", { path }, invokeTool);
  return { ...result, path };
}

function locusExecutor(options: LocusWorkflowRunOptions): NodeExecutor {
  return async (node, input, ctx) => {
    const type = node.data.nodeType;
    if (type === "tool_call" || type === "custom_tool") {
      const name = String(node.data.config.toolId ?? node.data.config.tool ?? "").trim();
      if (!name) throw new Error(`Tool node "${node.data.label}" is missing toolId`);
      return callLocusTool(name, toolArgs(node, input), options.invokeTool);
    }
    if (type === "database") {
      const name = String(node.data.config.toolId ?? "").trim();
      if (name) return callLocusTool(name, toolArgs(node, input), options.invokeTool);
    }
    if (type === "file_operation") return runFileNode(node, input, options.invokeTool);
    if (type === "web_search") {
      const query = String(nested(input, "query") ?? nested(input, "message") ?? "").trim();
      const maxResults = Number(node.data.config.maxResults ?? 5);
      return callLocusTool("websearch", { query, num_results: maxResults }, options.invokeTool);
    }
    if (MODEL_NODE_TYPES.has(type)) return runModelNode(node, input, ctx, options);
    return defaultNodeExecutor(node, input, ctx);
  };
}

export function runLocusWorkflow(
  workflow: Workflow,
  options: LocusWorkflowRunOptions,
): Promise<WorkflowRun> {
  return executeWorkflow(workflow, {
    input: options.input,
    signal: options.signal,
    executor: locusExecutor(options),
  });
}

export function resumeLocusWorkflow(
  workflow: Workflow,
  paused: WorkflowRun,
  decision: { approved: boolean; approvedBy?: string; resumeToken?: string },
  options: LocusWorkflowRunOptions,
): Promise<WorkflowRun> {
  return resumeWorkflow(workflow, paused, decision, {
    signal: options.signal,
    executor: locusExecutor(options),
  });
}
