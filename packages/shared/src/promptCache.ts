import type { ChatMessage } from "./models/session.js";

export const PROMPT_CACHE_CONTROL = { type: "ephemeral" as const };

export interface PromptCacheBlock {
  text: string;
  /** True when this prefix should be cached (system, tools, repo map). */
  cache?: boolean;
}

export interface AssembledPrompt {
  /** Stable system text (persona, instructions, tool list). */
  system: string;
  /** Stable extra prefixes such as the repo map. Cached when the provider supports it. */
  cacheBlocks: string[];
  /** Volatile prefix: compaction summary, scratchpad, task list. Never part of the cache prefix. */
  volatilePrefix?: string;
  messages: ChatMessage[];
}

export function assemblePrompt(input: {
  system: string;
  repoMap?: string;
  workingState?: string;
  compactNote?: string;
  brain?: string;
  messages: ChatMessage[];
}): AssembledPrompt {
  const cacheBlocks: string[] = [];
  const repoMap = input.repoMap?.trim();
  if (repoMap) cacheBlocks.push(repoMap);
  const volatile = [input.compactNote?.trim(), input.workingState?.trim(), input.brain?.trim()]
    .filter(Boolean)
    .join("\n\n");
  return {
    system: input.system,
    cacheBlocks,
    volatilePrefix: volatile || undefined,
    messages: input.messages.filter((message) => !message.compact),
  };
}

export function promptCacheBlocks(assembled: AssembledPrompt): PromptCacheBlock[] {
  const blocks: PromptCacheBlock[] = [{ text: assembled.system, cache: true }];
  for (const text of assembled.cacheBlocks) {
    if (text.trim()) blocks.push({ text, cache: true });
  }
  if (assembled.volatilePrefix?.trim())
    blocks.push({ text: assembled.volatilePrefix, cache: false });
  return blocks.filter((block) => block.text.trim());
}

export function joinCachedSystem(assembled: AssembledPrompt): string {
  return [assembled.system, ...assembled.cacheBlocks].filter((text) => text.trim()).join("\n\n");
}

export function cachedPromptBlocks(
  assembled: Pick<AssembledPrompt, "system" | "cacheBlocks">,
): PromptCacheBlock[] {
  return promptCacheBlocks({
    system: assembled.system,
    cacheBlocks: assembled.cacheBlocks,
    messages: [],
  }).filter((block) => block.cache);
}

export function asPromptContentBlocks(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content || " " }];
  if (Array.isArray(content)) {
    return content.map((block) =>
      typeof block === "string"
        ? { type: "text", text: block }
        : { ...(block as Record<string, unknown>) },
    );
  }
  return [{ type: "text", text: " " }];
}

/** Mark the last user block so the next round can reuse the conversation prefix. */
export function markLastPromptCacheBreakpoint(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const out = messages.map((message) => ({ ...message }));
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const message = out[i]!;
    if (message.role !== "user") continue;
    const blocks = asPromptContentBlocks(message.content);
    if (!blocks.length) continue;
    const last = { ...blocks[blocks.length - 1]!, cache_control: PROMPT_CACHE_CONTROL };
    out[i] = { ...message, content: [...blocks.slice(0, -1), last] };
    return out;
  }
  return out;
}

/**
 * Append request-scoped notes after the conversation. Putting them in the system
 * array sits between cached system/tools and messages and busts those prefixes.
 */
export function appendVolatileConversationTail(
  messages: Array<Record<string, unknown>>,
  volatile?: string,
): Array<Record<string, unknown>> {
  const text = volatile?.trim();
  if (!text) return messages;
  const block = { type: "text" as const, text };
  if (!messages.length) return [{ role: "user", content: [block] }];
  const out = messages.map((message) => ({ ...message }));
  const last = out[out.length - 1]!;
  if (last.role === "user") {
    out[out.length - 1] = {
      ...last,
      content: [...asPromptContentBlocks(last.content), block],
    };
    return out;
  }
  out.push({ role: "user", content: [block] });
  return out;
}
