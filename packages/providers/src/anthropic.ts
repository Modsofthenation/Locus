import {
  anthropicToolDefs,
  appendVolatileConversationTail,
  cachedPromptBlocks,
  markLastPromptCacheBreakpoint,
  PROMPT_CACHE_CONTROL,
  chatMessageImages,
  type ChatMessage,
  type ExtraToolDef,
} from "@locus/shared";
import { DEFAULT_ANTHROPIC_MAX_TOKENS, readSseFrames, screenshotMediaType } from "./openai.js";
import {
  parseToolArgs,
  mergeTokenUsage,
  readTokenUsage,
  shouldEmitFileWriteDelta,
  type ChatEvent,
  type CompleteRequest,
  type FetchFn,
} from "./types.js";
import { fetchProvider } from "./retry.js";
import { closeUnansweredToolCalls } from "./toolMessages.js";

const CACHE_CONTROL = PROMPT_CACHE_CONTROL;

export async function* streamAnthropic(
  req: CompleteRequest,
  fetchFn: FetchFn = fetch,
): AsyncGenerator<ChatEvent> {
  const url = `${req.provider.baseUrl.replace(/\/+$/, "")}/v1/messages`;
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
    stream: true,
    system: toAnthropicSystem(req),
    messages: toAnthropic(req.messages, req.volatilePrefix),
  };
  const tools = [
    ...(req.guestOs ? anthropicToolDefs(req.guestOs, req.allowedTools, req.runtime) : []),
    ...(req.extraTools ?? []).map(extraAnthropicTool),
  ];
  if (tools.length) {
    const last = tools[tools.length - 1]!;
    body.tools = [...tools.slice(0, -1), { ...last, cache_control: CACHE_CONTROL }];
  }

  const res = await fetchProvider(fetchFn, url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": req.provider.apiKey ?? "",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      ...req.provider.extraHeaders,
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });

  const pending = new Map<number, { id: string; name: string; args: string }>();
  const deltaAt = new Map<number, number>();
  const deltaLen = new Map<number, number>();
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  for await (const data of readSseFrames(res)) {
    yield { type: "activity" };
    const json = JSON.parse(data) as {
      type?: string;
      index?: number;
      content_block?: { type?: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string };
      usage?: unknown;
      message?: { usage?: unknown };
    };
    usage = mergeTokenUsage(usage, readTokenUsage(json.usage));
    usage = mergeTokenUsage(usage, readTokenUsage(json.message?.usage));
    if (json.type === "content_block_delta" && json.delta?.text) {
      yield { type: "text", text: json.delta.text };
    }
    if (json.type === "content_block_start" && json.content_block?.type === "tool_use") {
      pending.set(json.index ?? pending.size, {
        id: json.content_block.id ?? "",
        name: json.content_block.name ?? "",
        args: "",
      });
    }
    if (json.type === "content_block_delta" && json.delta?.partial_json != null) {
      const index = json.index ?? 0;
      const acc = pending.get(index);
      if (acc) {
        acc.args += json.delta.partial_json;
        if (
          shouldEmitFileWriteDelta(
            deltaLen.get(index) ?? 0,
            deltaAt.get(index) ?? 0,
            acc.name,
            acc.args,
          )
        ) {
          deltaAt.set(index, Date.now());
          deltaLen.set(index, acc.args.length);
          yield {
            type: "tool_call_delta",
            id: acc.id || acc.name,
            name: acc.name,
            argumentsRaw: acc.args,
          };
        }
      }
    }
  }
  for (const acc of pending.values()) {
    if (!acc.name) continue;
    yield {
      type: "tool_call",
      id: acc.id || acc.name,
      name: acc.name,
      arguments: parseToolArgs(acc.args),
    };
  }
  if (usage) yield { type: "usage", ...usage };
}

export function toAnthropic(
  messages: ChatMessage[],
  volatilePrefix?: string,
): Array<Record<string, unknown>> {
  const closed = closeUnansweredToolCalls(messages);
  const out: Array<Record<string, unknown>> = [];
  let i = 0;
  while (i < closed.length) {
    const m = closed[i]!;
    if (m.role === "user") {
      const images = chatMessageImages(m).filter((img) => img.base64);
      if (images.length) {
        out.push({
          role: "user",
          content: [
            { type: "text", text: m.content || " " },
            ...images.map((img) => ({
              type: "image",
              source: {
                type: "base64",
                media_type: screenshotMediaType({ screenshotMime: img.mime }),
                data: img.base64,
              },
            })),
          ],
        });
      } else {
        out.push({ role: "user", content: m.content || " " });
      }
      i += 1;
      continue;
    }
    if (m.role === "assistant") {
      if (!m.content.trim() && !m.toolCalls?.length) {
        i += 1;
        continue;
      }
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content.trim()) blocks.push({ type: "text", text: m.content });
      for (const t of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.arguments ?? {} });
      }
      out.push({
        role: "assistant",
        content: blocks.length ? blocks : [{ type: "text", text: " " }],
      });
      i += 1;
      continue;
    }
    if (m.role === "tool") {
      const results: Array<Record<string, unknown>> = [];
      while (i < closed.length && closed[i]?.role === "tool") {
        const tool = closed[i]!;
        results.push({
          type: "tool_result",
          tool_use_id: tool.toolCallId ?? tool.id,
          content: tool.screenshotBase64
            ? [
                { type: "text", text: tool.content || "ok" },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: screenshotMediaType(tool),
                    data: tool.screenshotBase64,
                  },
                },
              ]
            : tool.content || "",
        });
        i += 1;
      }
      out.push({ role: "user", content: results });
      continue;
    }
    i += 1;
  }
  const merged = mergeAdjacentUsers(out);
  if (merged[0]?.role === "assistant") merged.unshift({ role: "user", content: "(start)" });
  return appendVolatileConversationTail(markLastPromptCacheBreakpoint(merged), volatilePrefix);
}

/** Anthropic alternates roles. A tool_result user followed by the next prompt must be one user turn. */
function mergeAdjacentUsers(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    const prev = merged[merged.length - 1];
    if (message.role === "user" && prev?.role === "user") {
      prev.content = [...anthropicBlocks(prev.content), ...anthropicBlocks(message.content)];
      continue;
    }
    merged.push({ ...message });
  }
  return merged;
}

function anthropicBlocks(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content as Array<Record<string, unknown>>;
  return [{ type: "text", text: " " }];
}

export function toAnthropicSystem(
  req: Pick<CompleteRequest, "system" | "cacheBlocks" | "volatilePrefix">,
): unknown {
  const blocks = cachedPromptBlocks({
    system: req.system,
    cacheBlocks: req.cacheBlocks ?? [],
  }).map((block) => ({
    type: "text" as const,
    text: block.text,
    cache_control: CACHE_CONTROL,
  }));
  if (blocks.length <= 1 && !req.cacheBlocks?.length) return req.system;
  return blocks;
}

function extraAnthropicTool(tool: ExtraToolDef) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}
