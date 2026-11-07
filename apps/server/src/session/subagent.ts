import { randomUUID } from "node:crypto";
import type { AgentRuntime, ChatMessage, ExtraToolDef, SubagentKind } from "@locus/shared";
import {
  REPO_MAP_TOOL,
  WEBSEARCH_TOOL,
  execCommandsFromArgs,
  subagentSystemPrompt,
  toolChipLabel,
} from "@locus/shared";
import {
  runChatTurn,
  type ChatEngine,
  type ChatEvent,
  type CompleteRequest,
} from "@locus/providers";
import type { ToolResult } from "@locus/guest-agent";

const SUBAGENT_ROUNDS = 8;
const IMPLEMENT_ROUNDS = 12;
export const SUBAGENT_TIMEOUT_MS = 45_000;
const IMPLEMENT_TIMEOUT_MS = 90_000;
const SUMMARY_CHARS = 3_000;

const READ_TOOLS = new Set([
  "file_read",
  "file_list",
  "grep",
  "glob",
  "git_status",
  "git_diff",
  "git_log",
  "git_pr_list",
  "git_pr_get",
  "git_pr_loadpath",
  "git_pr_checks",
  "git_issue_list",
  "git_issue_get",
  "repo_map",
  "websearch",
]);

const IMPLEMENT_TOOLS = new Set([...READ_TOOLS, "apply_patch", "file_write", "exec"]);

export function subagentToolSet(kind?: SubagentKind): Set<string> {
  return kind === "implement" ? IMPLEMENT_TOOLS : READ_TOOLS;
}

export function subagentAllowedTools(
  parent?: string[],
  _runtime?: AgentRuntime,
  kind?: SubagentKind,
): string[] {
  const allowed = subagentToolSet(kind);
  const source = parent?.length ? parent : [...allowed];
  return source.filter((name) => allowed.has(name));
}

export function subagentRoundLimit(kind?: SubagentKind): number {
  return kind === "implement" ? IMPLEMENT_ROUNDS : SUBAGENT_ROUNDS;
}

export function subagentTimeoutMs(kind?: SubagentKind, remaining?: number): number {
  const cap = kind === "implement" ? IMPLEMENT_TIMEOUT_MS : SUBAGENT_TIMEOUT_MS;
  if (remaining == null) return cap;
  return Math.max(1, Math.min(cap, remaining));
}

/** Implement children may patch and test; they cannot push, even via exec. */
export function subagentRefuseTool(
  kind: SubagentKind | undefined,
  name: string,
  args: Record<string, unknown>,
): string | undefined {
  if (kind !== "implement") return undefined;
  if (name === "git_push" || name === "git_pr" || name === "git_pr_merge") {
    return "Implement sub-agents cannot push or open a PR. Return the patch; the parent can push.";
  }
  if (name !== "exec" && name !== "powershell") return undefined;
  for (const command of execCommandsFromArgs(args)) {
    if (/\bgit\s+push\b/i.test(command) || /\bgh\s+pr\s+(create|merge)\b/i.test(command)) {
      return "Implement sub-agents cannot git push or open a PR. Return the patch; the parent can push.";
    }
  }
  return undefined;
}

export interface SubagentContext {
  chatEngine: ChatEngine;
  complete: CompleteRequest;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  webSearch?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  onUsage?: (ev: { inputTokens: number; outputTokens: number }) => Promise<void> | void;
  onEvent?: (kind: "start" | "tool" | "end", detail: string) => Promise<void> | void;
  onTranscript?: (messages: ChatMessage[]) => Promise<void> | void;
  kind?: SubagentKind;
}

export async function runIsolatedSubagent(
  task: string,
  focus: string | undefined,
  ctx: SubagentContext,
): Promise<string> {
  const goal = task.trim();
  if (!goal) return "task is required";
  const extraTools: ExtraToolDef[] = [REPO_MAP_TOOL, ...(ctx.webSearch ? [WEBSEARCH_TOOL] : [])];
  const system = subagentSystemPrompt(ctx.kind ?? "explore", focus);
  const allowed = subagentToolSet(ctx.kind);
  const messages: ChatMessage[] = [
    {
      id: randomUUID(),
      role: "user",
      content: goal,
      createdAt: new Date().toISOString(),
    },
  ];
  await ctx.onEvent?.("start", goal);
  await ctx.onTranscript?.(messages);
  const timeoutMs = Math.max(1, ctx.timeoutMs ?? subagentTimeoutMs(ctx.kind));
  const deadline = Date.now() + timeoutMs;
  let summary = "";
  for (let round = 0; round < subagentRoundLimit(ctx.kind); round++) {
    if (ctx.signal?.aborted) break;
    const left = deadline - Date.now();
    if (left <= 0) break;
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    let text = "";
    const stream = runChatTurn(
      ctx.chatEngine,
      {
        ...ctx.complete,
        system,
        messages,
        extraTools,
        allowedTools: subagentAllowedTools(
          ctx.complete.allowedTools,
          ctx.complete.runtime,
          ctx.kind,
        ),
        cacheBlocks: undefined,
        volatilePrefix: undefined,
        signal: ctx.signal,
      },
      { timeoutMs: Math.min(subagentTimeoutMs(ctx.kind), left), delaysMs: [200, 800] },
    );
    try {
      for await (const ev of stream as AsyncIterable<ChatEvent>) {
        if (ev.type === "text") text += ev.text;
        if (ev.type === "tool_call")
          toolCalls.push({ id: ev.id, name: ev.name, arguments: ev.arguments });
        if (ev.type === "usage") await ctx.onUsage?.(ev);
      }
    } catch (err) {
      if (summary.trim()) break;
      throw err;
    }
    if (text.trim()) summary = text.trim();
    messages.push({
      id: randomUUID(),
      role: "assistant",
      content: text,
      toolCalls: toolCalls.length
        ? toolCalls.map((call) => ({ ...call, startedAt: new Date().toISOString() }))
        : undefined,
      createdAt: new Date().toISOString(),
    });
    await ctx.onTranscript?.(messages);
    if (!toolCalls.length) break;
    const assistant = messages[messages.length - 1]!;
    for (const call of toolCalls) {
      if (ctx.signal?.aborted) break;
      const stamp = new Date().toISOString();
      if (!allowed.has(call.name)) {
        const denied = `Tool ${call.name} is not available to the child agent.`;
        const recorded = assistant.toolCalls?.find((row) => row.id === call.id);
        if (recorded) {
          recorded.error = denied;
          recorded.finishedAt = stamp;
        }
        messages.push({
          id: randomUUID(),
          role: "tool",
          toolCallId: call.id,
          content: denied,
          createdAt: stamp,
        });
        await ctx.onTranscript?.(messages);
        continue;
      }
      const refused = subagentRefuseTool(ctx.kind, call.name, call.arguments);
      if (refused) {
        const recorded = assistant.toolCalls?.find((row) => row.id === call.id);
        if (recorded) {
          recorded.error = refused;
          recorded.finishedAt = stamp;
        }
        messages.push({
          id: randomUUID(),
          role: "tool",
          toolCallId: call.id,
          content: refused,
          createdAt: stamp,
        });
        await ctx.onTranscript?.(messages);
        continue;
      }
      let result: ToolResult;
      try {
        result = await ctx.executeTool(call.name, call.arguments);
      } catch (err) {
        result = { ok: false, output: err instanceof Error ? err.message : "tool failed" };
      }
      const output = (result.output || "").slice(0, 8_000);
      const recorded = assistant.toolCalls?.find((row) => row.id === call.id);
      if (recorded) {
        recorded.result = output;
        recorded.finishedAt = stamp;
        if (!result.ok) recorded.error = output;
      }
      await ctx.onEvent?.("tool", toolChipLabel(call.name, call.arguments) || call.name);
      messages.push({
        id: randomUUID(),
        role: "tool",
        toolCallId: call.id,
        content: output,
        createdAt: stamp,
      });
      await ctx.onTranscript?.(messages);
    }
  }
  const timedOut = Date.now() >= deadline;
  const cancelled = Boolean(ctx.signal?.aborted);
  const out =
    summary.trim() ||
    (cancelled
      ? "Subagent was cancelled."
      : timedOut
        ? `Subagent timed out after ${Math.round(timeoutMs / 1000)}s.`
        : "(child agent returned no summary)");
  await ctx.onEvent?.("end", out);
  return out.length <= SUMMARY_CHARS ? out : `${out.slice(0, SUMMARY_CHARS - 1)}…`;
}
