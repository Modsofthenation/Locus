import type { ChatMessage, VisionMode } from "./models/session.js";
import type { AgentWorkingState } from "./models/workingState.js";
import { formatWorkingState } from "./models/workingState.js";
import { fileReadPaths } from "./models/tools.js";
import { toolChipLabel } from "./models/toolChip.js";
import { DEFAULT_CHARS_PER_TOKEN, estimateTokensFromChars } from "./contextWindow.js";

export const DEFAULT_TOOL_CHARS = 8_000;
/** Completed file_write / apply_patch arguments above this are stubbed so the next turn is not a 13k HTML echo. */
export const LARGE_TOOL_ARG_CHARS = 2_000;
/** Cursor CLI write/edit bodies land here instead of `content` / `patch`. */
export const WRITE_BODY_ARG_KEYS = [
  "content",
  "contents",
  "html",
  "fileText",
  "streamContent",
  "patch",
  "new_string",
  "old_string",
  "new_str",
  "old_str",
  "replacement",
] as const;
/** Older tool results in the current turn keep a short snippet so re-reads do not stack. */
export const STALE_TOOL_CHARS = 1_200;
/** Newest tool results keep the full DEFAULT_TOOL_CHARS (or caller cap). */
export const RECENT_FULL_TOOL_RESULTS = 4;
/** Completed assistant+tool rounds kept at the tail when a single user turn is over budget. */
export const KEEP_RECENT_ROUNDS = 3;
export const DEFAULT_CONTEXT_TOKENS = 24_000;
/** 0 = no round cap. Turns stop on spend/time, abort, or the model finishing. */
export const DEFAULT_MAX_AGENT_ROUNDS = 0;
/** Upper clamp when an operator sets a positive round cap. */
export const MAX_AGENT_ROUNDS = 128;
/** Old built-in stop that paused unattended turns. Treated as unset. */
export const LEGACY_DEFAULT_MAX_AGENT_ROUNDS = 48;
export const MAX_CHECKPOINTS = 8;

/** Positive cap clamped to 4–128. 0 / unset / the legacy default of 48 means no cap. */
export function agentRoundLimit(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  if (value === LEGACY_DEFAULT_MAX_AGENT_ROUNDS) return undefined;
  return Math.min(MAX_AGENT_ROUNDS, Math.max(4, Math.round(value)));
}

export function messageChars(message: ChatMessage): number {
  return (
    (message.content ?? "").length +
    (message.screenshotBase64 ?? "").length +
    JSON.stringify(message.toolCalls ?? []).length
  );
}

export function compactMessages(
  messages: ChatMessage[],
  opts: { vision?: VisionMode; maxToolChars?: number; maxShots?: number } = {},
): ChatMessage[] {
  const vision = opts.vision ?? "latest";
  const maxToolChars = opts.maxToolChars ?? DEFAULT_TOOL_CHARS;
  const maxShots = vision === "off" ? 0 : Math.min(8, Math.max(1, Math.round(opts.maxShots ?? 1)));
  const keep = new Set<number>();
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.role === "user" && messages[i]?.screenshotBase64) keep.add(i);
  }
  if (maxShots > 0) {
    let added = 0;
    for (let i = messages.length - 1; i >= 0 && added < maxShots; i -= 1) {
      if (messages[i]?.screenshotBase64 && !keep.has(i)) {
        keep.add(i);
        added += 1;
      }
    }
  }
  const toolIndexes: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.role === "tool") toolIndexes.push(i);
  }
  const recentTools = new Set(toolIndexes.slice(-RECENT_FULL_TOOL_RESULTS));
  const next = messages.map((message, index) => {
    let row = message;
    if (message.screenshotBase64 && !keep.has(index)) {
      const { screenshotBase64: _drop, screenshotMime: _mime, ...rest } = message;
      row = rest;
    }
    if (row.role === "tool") {
      const cap = recentTools.has(index) ? maxToolChars : Math.min(maxToolChars, STALE_TOOL_CHARS);
      if (row.content.length > cap) {
        row = { ...row, content: truncateToolContent(row.content, cap) };
      }
    }
    return row;
  });
  return compactToolCallArguments(next);
}

export interface FoldTurnsOptions {
  workingState?: AgentWorkingState;
  /** When true, compact even if a tool call is still open. Default never mid-operation. */
  force?: boolean;
  /** Calibrated characters per token. Defaults to 4. */
  charsPerToken?: number;
  /** Tokens already taken by system / repo map / working state. */
  prefixTokens?: number;
  /** Last provider-reported prompt tokens. Preferred over the character estimate. */
  measuredInputTokens?: number;
  /** Durable deny-reread paths from earlier folds on this session. */
  inspectedFiles?: string[];
}

export function openToolCallIds(messages: ChatMessage[]): Set<string> {
  const open = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      // A later assistant round means earlier tools already finished or were abandoned.
      open.clear();
      for (const call of message.toolCalls ?? []) {
        if (call.id) open.add(call.id);
      }
    }
    if (message.role === "tool" && message.toolCallId) open.delete(message.toolCallId);
  }
  return open;
}

/** Index of the assistant message that opened an unfinished tool call, or -1. */
export function openOperationStart(messages: ChatMessage[]): number {
  const open = openToolCallIds(messages);
  if (!open.size) return -1;
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    if ((message.toolCalls ?? []).some((call) => open.has(call.id))) {
      let start = i;
      if (i > 0 && messages[i - 1]?.role === "user") start = i - 1;
      return start;
    }
  }
  return -1;
}

export interface FoldTurnsResult {
  messages: ChatMessage[];
  note?: string;
  dropped?: ChatMessage[];
  beforeTokens: number;
  afterTokens: number;
  /** Union of persisted + newly dropped inspected paths (capped). */
  inspectedFiles?: string[];
}

/** Tools whose `path` / `paths` should survive a later compact. Not `exec`. */
const INSPECTED_PATH_TOOLS = new Set([
  "file_read",
  "file_write",
  "apply_patch",
  "grep",
  "glob",
  "file_list",
]);

export const MAX_INSPECTED_FILES = 48;

export function inspectedPathsFromMessages(messages: ChatMessage[]): string[] {
  const out: string[] = [];
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      if (!INSPECTED_PATH_TOOLS.has(call.name)) continue;
      for (const path of fileReadPaths(call.arguments ?? {})) {
        if (!out.includes(path)) out.push(path);
      }
    }
  }
  return out;
}

export function mergeInspectedFiles(...groups: Array<readonly string[] | undefined>): string[] {
  const out: string[] = [];
  for (const group of groups) {
    for (const raw of group ?? []) {
      const path = raw.trim();
      if (path && !out.includes(path)) out.push(path);
    }
  }
  return out.slice(0, MAX_INSPECTED_FILES);
}

function formatInspectedFilesNote(paths: string[]): string {
  if (!paths.length) return "";
  return `Already inspected (do not re-read whole files; use offset/limit only for a specific span):\n${paths
    .slice(0, 24)
    .map((path) => `- ${path}`)
    .join("\n")}`;
}

export function foldOldTurns(
  messages: ChatMessage[],
  maxTokens = DEFAULT_CONTEXT_TOKENS,
  opts: FoldTurnsOptions = {},
): FoldTurnsResult {
  const charsPerToken = opts.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  const prefix = Math.max(0, opts.prefixTokens ?? 0);
  const estimatedConv = sumTokens(messages, 0, messages.length, charsPerToken);
  const estimatedTotal = estimatedConv + prefix;
  const measured =
    typeof opts.measuredInputTokens === "number" &&
    Number.isFinite(opts.measuredInputTokens) &&
    opts.measuredInputTokens > 0
      ? opts.measuredInputTokens
      : undefined;
  const used = measured ?? estimatedTotal;
  const inspectedFiles = mergeInspectedFiles(opts.inspectedFiles);
  if (used <= maxTokens) {
    return {
      messages,
      beforeTokens: used,
      afterTokens: used,
      inspectedFiles: inspectedFiles.length ? inspectedFiles : undefined,
    };
  }
  let convBudget = Math.max(1, maxTokens - prefix);
  if (estimatedConv <= convBudget && used > maxTokens) {
    convBudget = Math.max(1, Math.floor(estimatedConv * 0.8));
  }
  const nextOpts = { ...opts, charsPerToken };
  const foldedUsers = foldUserTurns(messages, convBudget, nextOpts);
  const foldedRounds = foldStaleRounds(foldedUsers.messages, convBudget, nextOpts);
  const dropped = [...(foldedUsers.dropped ?? []), ...(foldedRounds.dropped ?? [])];
  const afterConv = sumTokens(
    foldedRounds.messages,
    0,
    foldedRounds.messages.length,
    charsPerToken,
  );
  const afterTokens = afterConv + prefix;
  const nextInspected = mergeInspectedFiles(
    opts.inspectedFiles,
    inspectedPathsFromMessages(dropped),
  );
  const body = [foldedUsers.note, foldedRounds.note].filter(Boolean).join("\n\n");
  if (!body) {
    return {
      messages: foldedRounds.messages,
      dropped: dropped.length ? dropped : undefined,
      beforeTokens: used,
      afterTokens,
      inspectedFiles: nextInspected.length ? nextInspected : undefined,
    };
  }
  return {
    messages: foldedRounds.messages,
    note: [body, compactContinueNote(opts.workingState, nextInspected)].filter(Boolean).join("\n"),
    dropped: dropped.length ? dropped : undefined,
    beforeTokens: used,
    afterTokens,
    inspectedFiles: nextInspected.length ? nextInspected : undefined,
  };
}

function foldUserTurns(
  messages: ChatMessage[],
  maxTokens: number,
  opts: FoldTurnsOptions,
): { messages: ChatMessage[]; note?: string; dropped?: ChatMessage[] } {
  const charsPerToken = opts.charsPerToken;
  const total = sumTokens(messages, 0, messages.length, charsPerToken);
  if (total <= maxTokens) return { messages };
  const openStart = opts.force ? -1 : openOperationStart(messages);
  if (openStart === 0) return { messages };
  const starts: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.role === "user") starts.push(i);
  }
  if (starts.length <= 1) return { messages };
  const lastStart = starts[starts.length - 1]!;
  let keepFrom = lastStart;
  let kept = sumTokens(messages, lastStart, messages.length, charsPerToken);
  const budget = Math.max(Math.floor(maxTokens * 0.6), kept);
  for (let t = starts.length - 2; t >= 0; t -= 1) {
    const from = starts[t]!;
    const to = starts[t + 1]!;
    if (openStart >= 0 && from < openStart && to > openStart) break;
    const size = sumTokens(messages, from, to, charsPerToken);
    if (kept + size > budget) break;
    kept += size;
    keepFrom = from;
  }
  if (openStart >= 0 && keepFrom > openStart) keepFrom = openStart;
  keepFrom = toolPairKeepFrom(messages, keepFrom);
  if (keepFrom <= 0) return { messages };
  const dropped = messages.slice(0, keepFrom);
  return {
    messages: messages.slice(keepFrom),
    dropped,
    note: summarizeAndPruneNote(dropped),
  };
}

/** Collapse older completed tool rounds inside the current user turn. */
function foldStaleRounds(
  messages: ChatMessage[],
  maxTokens: number,
  opts: FoldTurnsOptions,
): { messages: ChatMessage[]; note?: string; dropped?: ChatMessage[] } {
  const charsPerToken = opts.charsPerToken;
  const total = sumTokens(messages, 0, messages.length, charsPerToken);
  if (total <= maxTokens) return { messages };
  const { head, rounds } = splitAssistantRounds(messages);
  if (rounds.length <= KEEP_RECENT_ROUNDS) return { messages };
  const headTokens = head.reduce((n, message) => n + messageTokens(message, charsPerToken), 0);
  const roundTokens = rounds.map((round) =>
    round.reduce((n, message) => n + messageTokens(message, charsPerToken), 0),
  );
  let keepFrom = rounds.length - KEEP_RECENT_ROUNDS;
  let kept = headTokens + roundTokens.slice(keepFrom).reduce((n, size) => n + size, 0);
  while (keepFrom > 0) {
    const size = roundTokens[keepFrom - 1]!;
    if (kept + size > maxTokens) break;
    kept += size;
    keepFrom -= 1;
  }
  if (!opts.force) {
    const open = openToolCallIds(messages);
    if (open.size) {
      for (let r = 0; r < rounds.length; r += 1) {
        const hasOpen = rounds[r]!.some(
          (message) =>
            message.role === "assistant" &&
            (message.toolCalls ?? []).some((call) => open.has(call.id)),
        );
        if (hasOpen) {
          keepFrom = Math.min(keepFrom, r);
          break;
        }
      }
    }
  }
  if (keepFrom <= 0) return { messages };
  const dropped = rounds.slice(0, keepFrom).flat();
  if (!dropped.length) return { messages };
  return {
    messages: [...head, ...rounds.slice(keepFrom).flat()],
    dropped,
    note: summarizeDroppedRounds(dropped),
  };
}

function splitAssistantRounds(messages: ChatMessage[]): {
  head: ChatMessage[];
  rounds: ChatMessage[][];
} {
  const first = messages.findIndex((message) => message.role === "assistant");
  if (first < 0) return { head: messages, rounds: [] };
  const head = messages.slice(0, first);
  const rounds: ChatMessage[][] = [];
  const callRound = new Map<string, number>();
  let current = -1;
  for (let i = first; i < messages.length; i += 1) {
    const message = messages[i]!;
    if (message.role === "assistant") {
      rounds.push([message]);
      current = rounds.length - 1;
      for (const call of message.toolCalls ?? []) {
        if (call.id) callRound.set(call.id, current);
      }
      continue;
    }
    if (message.role === "tool") {
      const owner = message.toolCallId ? callRound.get(message.toolCallId) : undefined;
      if (owner != null) {
        rounds[owner]!.push(message);
        continue;
      }
    }
    if (current >= 0) rounds[current]!.push(message);
    else head.push(message);
  }
  return { head, rounds };
}

/** If a cut lands on a tool result, rewind to the assistant that opened that call. */
function toolPairKeepFrom(messages: ChatMessage[], keepFrom: number): number {
  let from = keepFrom;
  while (from > 0 && from < messages.length) {
    const message = messages[from];
    if (message?.role !== "tool") break;
    const id = message.toolCallId;
    if (!id) break;
    let owner = -1;
    for (let i = from - 1; i >= 0; i -= 1) {
      const row = messages[i];
      if (row?.role === "assistant" && (row.toolCalls ?? []).some((call) => call.id === id)) {
        owner = i;
        break;
      }
    }
    if (owner < 0) break;
    from = owner;
  }
  return from;
}

function messageTokens(message: ChatMessage, charsPerToken?: number): number {
  return estimateTokensFromChars(messageChars(message), charsPerToken);
}

function sumTokens(
  messages: ChatMessage[],
  from: number,
  to: number,
  charsPerToken?: number,
): number {
  let n = 0;
  for (let i = from; i < to; i += 1) n += messageTokens(messages[i]!, charsPerToken);
  return n;
}

function truncateToolContent(content: string, maxChars: number): string {
  const keepText = Math.max(500, maxChars - 80);
  return `${content.slice(0, keepText)}\n…[truncated ${content.length - keepText} chars]`;
}

function compactToolCallArguments(messages: ChatMessage[]): ChatMessage[] {
  const completed = new Set(
    messages
      .filter((message) => message.role === "tool" && message.toolCallId)
      .map((message) => message.toolCallId),
  );
  if (!completed.size) return messages;
  return messages.map((message) => {
    if (message.role !== "assistant" || !message.toolCalls?.length) return message;
    let changed = false;
    const toolCalls = message.toolCalls.map((call) => {
      if (!call.id || !completed.has(call.id) || call.error) return call;
      const next = stubLargeToolArgs(call);
      if (next !== call) changed = true;
      return next;
    });
    return changed ? { ...message, toolCalls } : message;
  });
}

function stubLargeToolArgs(call: NonNullable<ChatMessage["toolCalls"]>[number]) {
  const args = call.arguments ?? {};
  const next = stubLargeWriteArgs(args);
  return next === args ? call : { ...call, arguments: next };
}

/** Replace huge write bodies so transcripts/traces are not a second copy of the file. */
export function stubLargeWriteArgs(
  args: Record<string, unknown>,
  opts?: { keepKeys?: readonly string[] },
): Record<string, unknown> {
  const path =
    (typeof args.path === "string" && args.path.trim()) ||
    (typeof args.target_file === "string" && args.target_file.trim()) ||
    "the path";
  let changed = false;
  const next = { ...args };
  for (const key of WRITE_BODY_ARG_KEYS) {
    if (opts?.keepKeys?.includes(key)) continue;
    const value = next[key];
    if (typeof value !== "string" || value.length <= LARGE_TOOL_ARG_CHARS) continue;
    next[key] = stubWriteBody(key, value.length, path);
    changed = true;
  }
  return changed ? next : args;
}

function stubWriteBody(key: string, chars: number, path: string): string {
  if (key === "content" || key === "contents" || key === "fileText" || key === "streamContent") {
    return `…[already written, ${chars} chars. file_read ${path} if you need the current file]`;
  }
  return `…[already applied, ${chars} chars. file_read the file if you need the current contents]`;
}

function summarizeAndPruneNote(dropped: ChatMessage[]): string {
  const decisions = extractDecisions(dropped);
  const threads = extractOpenThreads(dropped);
  const lines: string[] = [];
  let user = "";
  let tools: string[] = [];
  let reply = "";
  const flush = () => {
    if (!user && !tools.length && !reply) return;
    const toolBit = tools.length ? ` Tools: ${[...new Set(tools)].join(", ")}.` : "";
    const agentBit = reply ? ` Agent: ${clip(reply, 120)}` : "";
    lines.push(`- User: ${clip(user || "(no text)", 160)}${agentBit}${toolBit}`);
    user = "";
    tools = [];
    reply = "";
  };
  for (const message of dropped) {
    if (message.role === "user") {
      flush();
      user = message.content;
      continue;
    }
    if (message.role === "assistant") {
      if (!reply && message.content.trim()) reply = message.content.trim();
      tools.push(...toolLabels(message));
    } else if (message.role === "tool") {
      tools.push(...toolLabels(message));
    }
  }
  flush();
  const body = lines.slice(0, 40).join("\n");
  const parts = [
    `Earlier in this session (${dropped.length} messages omitted to save context):`,
    body,
  ];
  if (decisions.length)
    parts.push(`Decisions made:\n${decisions.map((item) => `- ${item}`).join("\n")}`);
  if (threads.length) parts.push(`Open threads:\n${threads.map((item) => `- ${item}`).join("\n")}`);
  const inspected = uniqueToolLabels(dropped).filter(isInspectedLabel);
  if (inspected.length) {
    parts.push(
      `Already inspected (do not re-read whole files; use offset/limit only for a specific span):\n${inspected
        .slice(0, 24)
        .map((label) => `- ${label}`)
        .join("\n")}`,
    );
  }
  return parts.filter(Boolean).join("\n");
}

function summarizeDroppedRounds(dropped: ChatMessage[]): string {
  const labels = uniqueToolLabels(dropped);
  const inspected = labels.filter(isInspectedLabel);
  const parts = [
    `Earlier tool rounds this turn (${dropped.length} messages omitted to save context):`,
    labels
      .slice(0, 40)
      .map((label) => `- ${label}`)
      .join("\n"),
  ];
  if (inspected.length) {
    parts.push(
      `Already inspected (do not re-read whole files; use offset/limit only for a specific span):\n${inspected
        .slice(0, 24)
        .map((label) => `- ${label}`)
        .join("\n")}`,
    );
  }
  return parts.filter(Boolean).join("\n");
}

export const LLM_COMPACT_SYSTEM = [
  "Summarize omitted coding-agent conversation for the next round.",
  "Output markdown with these headings only:",
  "## Goal",
  "## Decisions",
  "## Already inspected (do not re-read whole files)",
  "## In progress",
  "## Open questions",
  "Be concise. Do not invent files, decisions, or tasks that are not in the omitted messages.",
  "Bullet lists under each heading. Use '(none)' when a section is empty.",
  "If a test, patch, or typecheck failed, put the exact error under Open questions. The next round must retry that failure, not restart.",
].join("\n");

/** Skip the extra model call for tiny folds; heuristic chips are enough. */
export const LLM_COMPACT_MIN_DROPPED = 8;

export function shouldAttemptLlmCompact(dropped?: ChatMessage[]): boolean {
  return (dropped?.length ?? 0) >= LLM_COMPACT_MIN_DROPPED;
}

export function buildLlmCompactUserPrompt(input: {
  dropped: ChatMessage[];
  workingState?: AgentWorkingState;
  inspectedFiles?: string[];
}): string {
  const parts = [formatDroppedForCompact(input.dropped)];
  const inspected = mergeInspectedFiles(
    input.inspectedFiles,
    inspectedPathsFromMessages(input.dropped),
  );
  if (inspected.length) {
    parts.push(`Known inspected files:\n${inspected.map((path) => `- ${path}`).join("\n")}`);
  }
  const working = formatWorkingState(input.workingState).trim();
  if (working) parts.push(`Current working state:\n${working}`);
  return parts.join("\n\n");
}

export function looksLikeLlmCompactNote(text: string): boolean {
  const body = text.trim();
  if (body.length < 24) return false;
  return /##\s*(Goal|Decisions|Already inspected|In progress|Open questions)\b/i.test(body);
}

export function formatLlmCompactNote(
  text: string,
  workingState?: AgentWorkingState,
  inspectedFiles?: string[],
): string | undefined {
  if (!looksLikeLlmCompactNote(text)) return undefined;
  return [
    "Earlier in this session (summarized to save context):",
    text.trim(),
    compactContinueNote(workingState, inspectedFiles),
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatDroppedForCompact(dropped: ChatMessage[], maxChars = 24_000): string {
  const lines: string[] = [];
  for (const message of dropped) {
    if (message.role === "user") {
      lines.push(`User: ${clip(message.content || "(no text)", 400)}`);
      continue;
    }
    if (message.role === "assistant") {
      const tools = toolLabels(message);
      const reply = message.content.trim();
      lines.push(
        `Agent: ${clip(reply || "(tools)", 240)}${tools.length ? ` Tools: ${[...new Set(tools)].join(", ")}` : ""}`,
      );
      continue;
    }
    if (message.role === "tool") {
      lines.push(`Tool: ${clip(message.content, 160)}`);
    }
  }
  let body = lines.join("\n");
  if (body.length > maxChars) body = `${body.slice(0, maxChars - 1)}…`;
  return body;
}

/** Persist a short tool body in session JSON. Full output stays on the trace. */
export const PERSIST_TOOL_CHARS = 4_000;

export function slimToolContent(content: string, maxChars = PERSIST_TOOL_CHARS): string {
  if (content.length <= maxChars) return content;
  return truncateToolContent(content, maxChars);
}

export function compactContinueNote(
  workingState?: AgentWorkingState,
  inspectedFiles?: string[],
): string {
  const parts: string[] = [];
  const inspected = formatInspectedFilesNote(mergeInspectedFiles(inspectedFiles));
  if (inspected) parts.push(inspected);
  parts.push(
    "Continue from the scratchpad and task list. Do not re-read whole files listed above unless you need a specific line range. Do not spend a round only updating task_list. If the next step is an edit, call apply_patch or file_write now — do not grep, sed, or cat the same files again. If tests failed in omitted rounds, re-run the same command after the next patch — do not switch test runners.",
  );
  const open = [
    ...(workingState?.plan ?? []).filter(
      (item) => item.status === "running" || item.status === "pending",
    ),
    ...(workingState?.tasks ?? []).filter(
      (item) => item.status === "in_progress" || item.status === "pending",
    ),
  ];
  if (open.length) {
    parts.push(
      `In-progress (do not drop):\n${open.map((item) => `- [${item.status ?? "pending"}] ${item.id}: ${item.text}`).join("\n")}`,
    );
  }
  return parts.join("\n");
}

function isInspectedLabel(label: string): boolean {
  return /^(?:file_read|file_write|grep|glob|repo map|git_pr_get|git_pr_list|git_issue_get|git_issue_list|exec|powershell)\b/.test(
    label,
  );
}

function toolLabels(message: ChatMessage): string[] {
  const out: string[] = [];
  for (const call of message.toolCalls ?? []) {
    const label = toolChipLabel(call.name, call.arguments ?? {}, call.result, call.error);
    if (label) out.push(label);
  }
  return out;
}

function uniqueToolLabels(messages: ChatMessage[]): string[] {
  const out: string[] = [];
  for (const message of messages) {
    for (const label of toolLabels(message)) {
      if (!out.includes(label)) out.push(label);
    }
  }
  return out;
}

function extractDecisions(messages: ChatMessage[]): string[] {
  const out: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const line of message.content.split(/\r?\n/)) {
      const trimmed = line.trim().replace(/^[-*]\s+/, "");
      if (/^(?:decision|decided|going with|chose|will (?:use|keep|treat))\b/i.test(trimmed)) {
        const item = clip(trimmed, 180);
        if (item && !out.includes(item)) out.push(item);
      }
    }
    if (out.length >= 12) break;
  }
  return out;
}

function extractOpenThreads(messages: ChatMessage[]): string[] {
  const out: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.content.replace(/\s+/g, " ").trim();
    if (text.endsWith("?") || /^(?:also|still|please|can you|what about)\b/i.test(text)) {
      const item = clip(text, 180);
      if (item && !out.includes(item)) out.push(item);
    }
    if (out.length >= 8) break;
  }
  return out;
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}
