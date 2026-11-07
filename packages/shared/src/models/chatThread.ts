import { parseSessionSurface, type ChatMessage, type ToolCall } from "./session.js";
import { parseProductMode } from "./config.js";
import { isLocalOpenAiBase, isOllamaProvider } from "./provider.js";

export type ChatCluster =
  | { kind: "turn"; message: ChatMessage; tools: ChatMessage[] }
  | { kind: "single"; message: ChatMessage };

/** Fold tool results under the assistant message that issued them. */
export function clusterChatThread(messages: ChatMessage[]): ChatCluster[] {
  const out: ChatCluster[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      out.push({ kind: "turn", message, tools: [] });
      continue;
    }
    if (message.role === "tool") {
      const last = out[out.length - 1];
      if (last?.kind === "turn") {
        last.tools.push(message);
        continue;
      }
    }
    out.push({ kind: "single", message });
  }
  return out;
}

/** Tool calls for a turn, including results that only exist on the tool message. */
export function turnToolCalls(assistant: ChatMessage, tools: ChatMessage[] = []): ToolCall[] {
  const out: ToolCall[] = [];
  const seen = new Set<string>();
  for (const call of assistant.toolCalls ?? []) {
    out.push(call);
    seen.add(call.id);
  }
  for (const tool of tools) {
    for (const call of tool.toolCalls ?? []) {
      if (seen.has(call.id)) continue;
      out.push(call);
      seen.add(call.id);
    }
  }
  return out;
}

/** Last ~max chars of model reasoning, for the live working chip. */
export function formatThinkingSnippet(text: string, max = 280): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= max) return compact;
  return `…${compact.slice(-(max - 1))}`;
}

/** Persisted operator-visible reasoning on an assistant message. Not sent back to the model. */
export const MAX_THINKING_CHARS = 16_000;

export function appendThinkingText(
  existing: string | undefined,
  delta: string,
  max = MAX_THINKING_CHARS,
): string {
  if (!delta) return existing ?? "";
  const current = existing ?? "";
  if (current.length >= max) return current;
  const next = `${current}${delta}`;
  return next.length <= max ? next : next.slice(0, max);
}

export function thinkingTraceText(message: { thinking?: string }): string {
  return message.thinking?.trim() ?? "";
}

/**
 * Thought folds and live reasoning snippets belong in Developer chat.
 * Swarm threads should read like a messaging app.
 */
export function showThoughtTraces(opts?: {
  surface?: string | null;
  productMode?: string | null;
}): boolean {
  if (parseProductMode(opts?.productMode) === "swarm") return false;
  if (parseSessionSurface(opts?.surface) === "swarm") return false;
  return true;
}

export const OLLAMA_LOAD_HINT =
  "The model may still be loading into memory. First token can take a while.";
export const LOCAL_MODEL_LOAD_HINT = "Waiting for the first token from the local server.";

/** Shown while a local / Ollama turn has no tokens and no reasoning yet. */
export function localModelWaitLabel(provider?: {
  name?: string;
  baseUrl?: string;
}): string | undefined {
  if (!provider || !isLocalOpenAiBase(provider.baseUrl)) return undefined;
  return isOllamaProvider(provider) ? "Waiting for Ollama…" : "Loading local model…";
}

export function localModelWaitHint(provider?: {
  name?: string;
  baseUrl?: string;
}): string | undefined {
  if (!provider || !isLocalOpenAiBase(provider.baseUrl)) return undefined;
  return isOllamaProvider(provider) ? OLLAMA_LOAD_HINT : LOCAL_MODEL_LOAD_HINT;
}

export function formatWaitElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s";
  const whole = Math.floor(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

export type ThinkTagState = { buf: string; inThink: boolean };

export function emptyThinkTagState(): ThinkTagState {
  return { buf: "", inThink: false };
}

/**
 * Split DeepSeek-R1 / Ollama `<think>` wrappers out of streamed assistant text.
 * Holds a partial tag at the chunk boundary so `<thi` + `nk>` still parses.
 */
export function splitThinkTaggedText(
  chunk: string,
  state: ThinkTagState = emptyThinkTagState(),
): { reasoning: string; text: string; state: ThinkTagState } {
  const data = state.buf + chunk;
  let reasoning = "";
  let text = "";
  let inThink = state.inThink;
  let i = 0;
  while (i < data.length) {
    if (inThink) {
      const close = data.indexOf(THINK_CLOSE, i);
      if (close < 0) {
        const hold = holdPartialTag(data.slice(i), THINK_CLOSE);
        reasoning += hold.emit;
        return { reasoning, text, state: { buf: hold.keep, inThink: true } };
      }
      reasoning += data.slice(i, close);
      i = close + THINK_CLOSE.length;
      inThink = false;
      continue;
    }
    const open = data.indexOf(THINK_OPEN, i);
    if (open < 0) {
      const hold = holdPartialTag(data.slice(i), THINK_OPEN);
      text += hold.emit;
      return { reasoning, text, state: { buf: hold.keep, inThink: false } };
    }
    text += data.slice(i, open);
    i = open + THINK_OPEN.length;
    inThink = true;
  }
  return { reasoning, text, state: { buf: "", inThink } };
}

export function flushThinkTaggedText(state: ThinkTagState): { reasoning: string; text: string } {
  if (!state.buf) return { reasoning: "", text: "" };
  if (state.inThink) {
    if (THINK_CLOSE.startsWith(state.buf)) return { reasoning: "", text: "" };
    return { reasoning: state.buf, text: "" };
  }
  return { reasoning: "", text: state.buf };
}

function holdPartialTag(value: string, tag: string): { emit: string; keep: string } {
  const max = Math.min(value.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (tag.startsWith(value.slice(-n))) return { emit: value.slice(0, -n), keep: value.slice(-n) };
  }
  return { emit: value, keep: "" };
}
