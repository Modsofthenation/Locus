import {
  recoverFileWriteArgs,
  isDesignCanvasPath,
  looksLikeHtml,
  type AgentRuntime,
  type AiProvider,
  type ChatMessage,
  type ExtraToolDef,
  type GuestOs,
} from "@locus/shared";

export interface CompleteRequest {
  provider: AiProvider;
  model: string;
  system: string;
  messages: ChatMessage[];
  guestOs?: GuestOs;
  runtime?: AgentRuntime;
  allowedTools?: string[];
  extraTools?: ExtraToolDef[];
  signal?: AbortSignal;
  /** Stable prefixes after system (repo map). Cached when the provider supports it. */
  cacheBlocks?: string[];
  /** Compaction / working-state / guest-status text. Serialized after the conversation so it does not bust the tools cache. */
  volatilePrefix?: string;
  /** Completion budget. Remote OpenAI-compatible providers default this so reasoning models still have tokens left for tools. */
  maxTokens?: number;
  /** Default streams. Set false to wait for a full JSON completion (OpenCode reasoning-only SSE often drops). */
  stream?: boolean;
  /** OpenAI-compatible tool_choice. Default auto. */
  toolChoice?: "auto" | "required";
}

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_call_delta"; id: string; name: string; argumentsRaw: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
      cacheWriteTokens?: number;
    }
  /** SSE keepalive; runChatTurn treats this as activity and does not forward it. */
  | { type: "activity" }
  /** Model reasoning (OpenCode / DeepSeek / Ollama). Forwarded but does not count as a streamed reply. */
  | { type: "reasoning"; text: string }
  /** Local-model wait (Ollama load). Forwards like reasoning and keeps the idle timer alive. */
  | { type: "status"; phase: "loading" };

export function shouldEmitFileWriteDelta(
  prevLen: number,
  prevAt: number,
  name: string,
  args: string,
  now = Date.now(),
): boolean {
  if (name !== "file_write") return false;
  if (args.length - prevLen < 64 && now - prevAt < 75) return false;
  return args.length > prevLen;
}

export type TokenUsageEvent = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
};

export function readTokenUsage(raw: unknown): TokenUsageEvent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const input = asFiniteNumber(u.prompt_tokens ?? u.input_tokens ?? u.inputTokens);
  const output = asFiniteNumber(u.completion_tokens ?? u.output_tokens ?? u.outputTokens);
  if (input == null && output == null) return undefined;
  const details =
    u.prompt_tokens_details && typeof u.prompt_tokens_details === "object"
      ? (u.prompt_tokens_details as Record<string, unknown>)
      : undefined;
  const cached = asFiniteNumber(
    u.cache_read_input_tokens ??
      u.cached_input_tokens ??
      u.cachedInputTokens ??
      u.cached_tokens ??
      u.cacheReadTokens ??
      details?.cached_tokens,
  );
  const cacheWrite = asFiniteNumber(
    u.cache_creation_input_tokens ?? u.cacheWriteTokens ?? u.cache_write_tokens,
  );
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    ...(cached != null && cached > 0 ? { cachedInputTokens: cached } : {}),
    ...(cacheWrite != null && cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
  };
}

export function mergeTokenUsage(
  prev: TokenUsageEvent | undefined,
  next: TokenUsageEvent | undefined,
): TokenUsageEvent | undefined {
  if (!next) return prev;
  if (!prev) return next;
  const cached = next.cachedInputTokens || prev.cachedInputTokens;
  const cacheWrite = next.cacheWriteTokens || prev.cacheWriteTokens;
  return {
    inputTokens: next.inputTokens || prev.inputTokens,
    outputTokens: next.outputTokens || prev.outputTokens,
    ...(cached ? { cachedInputTokens: cached } : {}),
    ...(cacheWrite ? { cacheWriteTokens: cacheWrite } : {}),
  };
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export type FetchFn = typeof fetch;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** OpenCode / Ox Alpha often closes an empty SSE stream with finish_reason "unknown". */
export const UNKNOWN_STOP_MESSAGE =
  "The model stopped before sending a reply (unknown finish). Retry the prompt, or switch models.";

export function unknownStopError(): ProviderError {
  return new ProviderError(UNKNOWN_STOP_MESSAGE, undefined, true);
}

export function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return { value };
  } catch {
    return { _raw: raw };
  }
}

/** Prefer parsed JSON; recover truncated file_write path/content instead of `_raw`. */
export function assembleToolArguments(name: string, raw: string): Record<string, unknown> {
  const parsed = parseToolArgs(raw);
  let args = parsed;
  if (parsed._raw && name === "file_write") {
    const recovered = recoverFileWriteArgs(raw);
    if (recovered && (isDesignCanvasPath(recovered.path) || looksLikeHtml(recovered.content))) {
      args = recovered;
    }
  }
  return args;
}

export function isUnknownStopError(err: unknown): boolean {
  return err instanceof ProviderError && err.retryable && err.message === UNKNOWN_STOP_MESSAGE;
}

/** Recover tool calls that a model put in chat instead of native `tool_calls`. */
export function extractEmbeddedToolCalls(
  text: string,
): Array<{ name: string; arguments: Record<string, unknown> }> {
  if (!text.trim()) return [];
  const blocks: string[] = [];
  for (const match of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)) {
    if (match[1]) blocks.push(match[1]);
  }
  for (const match of text.matchAll(/```(?:json|tool[_-]?call)\s*(\{[\s\S]*?\})\s*```/gi)) {
    if (match[1]) blocks.push(match[1]);
  }
  const out: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  for (const raw of blocks) {
    const parsed = parseEmbeddedTool(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseEmbeddedTool(
  raw: string,
): { name: string; arguments: Record<string, unknown> } | undefined {
  try {
    const value = JSON.parse(raw.trim()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const row = value as { name?: unknown; arguments?: unknown; args?: unknown };
    if (typeof row.name !== "string" || !row.name.trim()) return undefined;
    const args = row.arguments ?? row.args ?? {};
    return {
      name: row.name.trim(),
      arguments:
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : parseToolArgs(String(args)),
    };
  } catch {
    return undefined;
  }
}
