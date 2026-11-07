import {
  awsSigningRegion,
  emptyThinkTagState,
  flushThinkTaggedText,
  isLocalOpenAiBase,
  isOllamaProvider,
  isOpenRouterProvider,
  openaiToolDefs,
  cachedPromptBlocks,
  markLastPromptCacheBreakpoint,
  PROMPT_CACHE_CONTROL,
  providerAwsService,
  providerUsesAwsSigV4,
  splitThinkTaggedText,
  OLLAMA_KEEP_ALIVE,
  OPENROUTER_APP_TITLE,
  OPENROUTER_APP_URL,
  type AiProvider,
  chatMessageImages,
  type ChatMessage,
  type ExtraToolDef,
  type GuestOs,
} from "@locus/shared";
import { applyAwsSigV4Headers } from "@locus/shared/awsSign";
import {
  assembleToolArguments,
  mergeTokenUsage,
  readTokenUsage,
  shouldEmitFileWriteDelta,
  unknownStopError,
  type ChatEvent,
  type CompleteRequest,
  type FetchFn,
} from "./types.js";
import { fetchProvider, sleep } from "./retry.js";
import { closeUnansweredToolCalls } from "./toolMessages.js";

/** While a local server has not sent HTTP headers yet, poke the idle timer this often. */
export const LOCAL_FETCH_POLL_MS = 2_000;

/** Reasoning models (OpenCode Ox Alpha / x-preview-f-free) spend this on thinking before tools. */
export const DEFAULT_OPENAI_MAX_TOKENS = 32_768;
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;

/** Provider completion cap when the turn does not set maxTokens. Local OpenAI-compatible servers stay uncapped. */
export function defaultCompletionBudget(
  provider: Pick<AiProvider, "kind" | "baseUrl">,
): number | undefined {
  if (provider.kind === "anthropic") return DEFAULT_ANTHROPIC_MAX_TOKENS;
  if (isLocalOpenAiBase(provider.baseUrl)) return undefined;
  if (
    provider.kind === "opencode" ||
    isOpenRouterProvider(provider) ||
    provider.kind === "cursor"
  ) {
    return DEFAULT_OPENAI_MAX_TOKENS;
  }
  return undefined;
}

type OpenAiToolPiece = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: unknown };
};

type OpenAiFunctionCall = { name?: string; arguments?: unknown };

type OpenAiChoice = {
  finish_reason?: unknown;
  finishReason?: unknown;
  delta?: {
    content?: unknown;
    reasoning_content?: unknown;
    reasoning?: unknown;
    thinking?: unknown;
    tool_calls?: OpenAiToolPiece[];
    function_call?: OpenAiFunctionCall;
  };
  message?: {
    content?: unknown;
    reasoning_content?: unknown;
    reasoning?: unknown;
    thinking?: unknown;
    tool_calls?: OpenAiToolPiece[];
    function_call?: OpenAiFunctionCall;
  };
};

function headerName(headers: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === want);
}

/** OpenRouter ranks apps that send HTTP-Referer and X-Title; extraHeaders win when set. */
export function applyOpenRouterHeaders(
  headers: Record<string, string>,
  provider: Pick<AiProvider, "kind" | "baseUrl">,
): Record<string, string> {
  if (!isOpenRouterProvider(provider)) return headers;
  if (!headerName(headers, "HTTP-Referer") && !headerName(headers, "Referer")) {
    headers["HTTP-Referer"] = OPENROUTER_APP_URL;
  }
  if (!headerName(headers, "X-Title") && !headerName(headers, "X-OpenRouter-Title")) {
    headers["X-Title"] = OPENROUTER_APP_TITLE;
  }
  return headers;
}

export function openAiCompatibleHeaders(provider: AiProvider): Record<string, string> {
  return applyOpenRouterHeaders(
    {
      authorization: `Bearer ${provider.apiKey ?? ""}`,
      ...provider.extraHeaders,
    },
    provider,
  );
}

export function openAiSignedHeaders(
  provider: AiProvider,
  url: string,
  init: { method?: string; body?: string },
): Record<string, string> {
  const headers: Record<string, string> = {
    ...(init.method && init.method.toUpperCase() !== "GET"
      ? { "content-type": "application/json" }
      : {}),
    ...openAiCompatibleHeaders(provider),
  };
  if (!providerUsesAwsSigV4(provider)) return headers;
  const accessKeyId = provider.accessKeyId?.trim();
  const secret = provider.apiKey?.trim();
  if (!accessKeyId || !secret) return headers;
  const sessionToken = headerValue(provider.extraHeaders, "x-amz-security-token") || undefined;
  const native = providerAwsService(provider);
  return applyAwsSigV4Headers(
    url,
    { method: init.method ?? "POST", headers, body: init.body },
    {
      accessKeyId,
      secretAccessKey: secret,
      sessionToken,
      region: awsSigningRegion(url, native, "us-east-1"),
    },
    native,
  );
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase();
  const key = Object.keys(headers).find((row) => row.toLowerCase() === want);
  const value = key ? headers[key]?.trim() : "";
  return value || undefined;
}

function openAiRequestBody(req: CompleteRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    stream,
    messages: toOpenAi(req.messages, req.system, req),
  };
  if (!isLocalOpenAiBase(req.provider.baseUrl)) {
    if (stream) body.stream_options = { include_usage: true };
    const maxTokens = req.maxTokens ?? defaultCompletionBudget(req.provider);
    if (maxTokens) body.max_tokens = maxTokens;
  }
  const tools = [
    ...(req.guestOs ? openaiToolDefs(req.guestOs, req.allowedTools, req.runtime) : []),
    ...(req.extraTools ?? []).map(extraOpenAiTool),
  ];
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = req.toolChoice === "required" ? "required" : "auto";
  }
  if (isOllamaProvider(req.provider)) {
    body.think = true;
    body.keep_alive = OLLAMA_KEEP_ALIVE;
  }
  return body;
}

async function* waitForProviderResponse(
  pending: Promise<Response>,
  wait: ChatEvent,
  signal: AbortSignal | undefined,
  intervalMs = LOCAL_FETCH_POLL_MS,
): AsyncGenerator<ChatEvent, Response> {
  const poll = new AbortController();
  const stop = () => {
    if (!poll.signal.aborted) poll.abort();
  };
  pending.finally(stop);
  const onUserAbort = () => poll.abort(signal?.reason);
  signal?.addEventListener("abort", onUserAbort, { once: true });
  try {
    while (true) {
      const raced = await Promise.race([
        pending.then(
          (res) => ({ t: "res" as const, res }),
          (err: unknown) => ({ t: "err" as const, err }),
        ),
        sleep(intervalMs, poll.signal).then(
          () => ({ t: "tick" as const }),
          () => ({ t: "cancelled" as const }),
        ),
      ]);
      if (raced.t === "res") return raced.res;
      if (raced.t === "err") throw raced.err;
      if (raced.t === "cancelled") {
        if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
        continue;
      }
      yield wait;
    }
  } finally {
    signal?.removeEventListener("abort", onUserAbort);
    stop();
  }
}

export async function* streamOpenAiCompatible(
  req: CompleteRequest,
  fetchFn: FetchFn = fetch,
): AsyncGenerator<ChatEvent> {
  if (req.stream === false) {
    yield* completeOpenAiJson(req, fetchFn);
    return;
  }
  const url = `${trimSlash(req.provider.baseUrl)}/chat/completions`;
  const body = JSON.stringify(openAiRequestBody(req, true));
  const pendingFetch = fetchProvider(fetchFn, url, {
    method: "POST",
    headers: openAiSignedHeaders(req.provider, url, { method: "POST", body }),
    body,
    signal: req.signal,
  });
  const localWait = isLocalOpenAiBase(req.provider.baseUrl)
    ? ({ type: "status", phase: "loading" } as const)
    : undefined;
  if (localWait) yield localWait;
  const res = localWait
    ? yield* waitForProviderResponse(pendingFetch, localWait, req.signal)
    : await pendingFetch;

  const pending = new Map<number, { id: string; name: string; args: string }>();
  const deltaAt = new Map<number, number>();
  const deltaLen = new Map<number, number>();
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  let finishReason: string | undefined;
  let sawText = false;
  let think = emptyThinkTagState();
  for await (const data of readSseFrames(res)) {
    yield { type: "activity" };
    let json: { usage?: unknown; choices?: OpenAiChoice[] };
    try {
      json = JSON.parse(data) as typeof json;
    } catch {
      continue;
    }
    usage = mergeTokenUsage(usage, readTokenUsage(json.usage));
    const choice = json.choices?.[0];
    const reason = openaiFinishReason(choice);
    if (reason) finishReason = reason;
    const reasoning = openaiDeltaReasoning(choice);
    if (reasoning) yield { type: "reasoning", text: reasoning };
    const text =
      openaiDeltaText(choice?.delta?.content) ?? openaiDeltaText(choice?.message?.content);
    if (text) {
      const split = splitThinkTaggedText(text, think);
      think = split.state;
      if (split.reasoning) yield { type: "reasoning", text: split.reasoning };
      if (split.text) {
        sawText = true;
        yield { type: "text", text: split.text };
      }
    }
    applyToolCallPieces(pending, choice?.delta?.tool_calls, "delta");
    applyFunctionCall(pending, choice?.delta?.function_call, "delta");
    applyToolCallPieces(pending, choice?.message?.tool_calls, "snapshot");
    applyFunctionCall(pending, choice?.message?.function_call, "snapshot");
    for (const [index, acc] of pending) {
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
  const flushed = flushThinkTaggedText(think);
  if (flushed.reasoning) yield { type: "reasoning", text: flushed.reasoning };
  if (flushed.text) {
    sawText = true;
    yield { type: "text", text: flushed.text };
  }
  yield* finishOpenAiTools(pending, finishReason, sawText, usage);
}

async function* completeOpenAiJson(
  req: CompleteRequest,
  fetchFn: FetchFn,
): AsyncGenerator<ChatEvent> {
  const url = `${trimSlash(req.provider.baseUrl)}/chat/completions`;
  const body = JSON.stringify(openAiRequestBody(req, false));
  const pendingFetch = fetchProvider(fetchFn, url, {
    method: "POST",
    headers: openAiSignedHeaders(req.provider, url, { method: "POST", body }),
    body,
    signal: req.signal,
  });
  const localWait = isLocalOpenAiBase(req.provider.baseUrl)
    ? ({ type: "status", phase: "loading" } as const)
    : undefined;
  if (localWait) yield localWait;
  const res = localWait
    ? yield* waitForProviderResponse(pendingFetch, localWait, req.signal)
    : await pendingFetch;
  let json: { usage?: unknown; choices?: OpenAiChoice[] };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw unknownStopError();
  }
  const pending = new Map<number, { id: string; name: string; args: string }>();
  const choice = json.choices?.[0];
  const reasoning = openaiDeltaReasoning(choice) ?? openaiMessageReasoning(choice);
  if (reasoning) yield { type: "reasoning", text: reasoning };
  const raw = openaiDeltaText(choice?.message?.content) ?? openaiDeltaText(choice?.delta?.content);
  const split = raw ? splitThinkTaggedText(raw) : undefined;
  const flushed = split ? flushThinkTaggedText(split.state) : undefined;
  const thought = `${split?.reasoning ?? ""}${flushed?.reasoning ?? ""}`;
  const text = `${split?.text ?? ""}${flushed?.text ?? ""}`;
  if (thought) yield { type: "reasoning", text: thought };
  if (text) yield { type: "text", text };
  applyToolCallPieces(pending, choice?.message?.tool_calls, "snapshot");
  applyFunctionCall(pending, choice?.message?.function_call, "snapshot");
  applyToolCallPieces(pending, choice?.delta?.tool_calls, "snapshot");
  applyFunctionCall(pending, choice?.delta?.function_call, "snapshot");
  yield* finishOpenAiTools(
    pending,
    openaiFinishReason(choice),
    Boolean(text),
    readTokenUsage(json.usage),
  );
}

function* finishOpenAiTools(
  pending: Map<number, { id: string; name: string; args: string }>,
  finishReason: string | undefined,
  sawText: boolean,
  usage: { inputTokens: number; outputTokens: number } | undefined,
): Generator<ChatEvent> {
  const sawTool = [...pending.values()].some((acc) => acc.name);
  if (isIncompleteOpenAiStop(finishReason, sawText, sawTool)) {
    throw unknownStopError();
  }
  for (const acc of pending.values()) {
    if (!acc.name) continue;
    yield {
      type: "tool_call",
      id: acc.id || acc.name,
      name: acc.name,
      arguments: assembleToolArguments(acc.name, acc.args),
    };
  }
  if (usage) yield { type: "usage", ...usage };
}

function applyToolCallPieces(
  pending: Map<number, { id: string; name: string; args: string }>,
  pieces: OpenAiToolPiece[] | undefined,
  mode: "delta" | "snapshot",
): void {
  if (!pieces?.length) return;
  for (const call of pieces) {
    const index = typeof call.index === "number" && Number.isInteger(call.index) ? call.index : 0;
    const acc =
      mode === "snapshot"
        ? { id: "", name: "", args: "" }
        : (pending.get(index) ?? { id: "", name: "", args: "" });
    if (call.id) acc.id = call.id;
    if (call.function?.name)
      acc.name = mode === "snapshot" ? call.function.name : acc.name + call.function.name;
    const args = openaiToolArgDelta(call.function?.arguments);
    if (args) acc.args = mode === "snapshot" ? args : acc.args + args;
    pending.set(index, acc);
  }
}

function applyFunctionCall(
  pending: Map<number, { id: string; name: string; args: string }>,
  call: OpenAiFunctionCall | undefined,
  mode: "delta" | "snapshot",
): void {
  if (!call?.name && call?.arguments == null) return;
  applyToolCallPieces(pending, [{ index: 0, function: call }], mode);
}

export function toOpenAi(
  messages: ChatMessage[],
  system?: string,
  req?: Pick<CompleteRequest, "cacheBlocks" | "volatilePrefix" | "provider">,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const cached = cachedPromptBlocks({
    system: system ?? "",
    cacheBlocks: req?.cacheBlocks ?? [],
  });
  const openRouter = Boolean(req?.provider && isOpenRouterProvider(req.provider));
  if (cached.length) {
    const text = cached.map((block) => block.text).join("\n\n");
    out.push(
      openRouter
        ? {
            role: "system",
            content: [{ type: "text", text, cache_control: PROMPT_CACHE_CONTROL }],
          }
        : { role: "system", content: text },
    );
  }
  for (const m of closeUnansweredToolCalls(messages)) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId ?? m.id, content: m.content || "" });
      if (m.screenshotBase64) {
        out.push({
          role: "user",
          content: [
            { type: "text", text: "Guest screenshot after this tool." },
            { type: "image_url", image_url: { url: screenshotDataUrl(m) } },
          ],
        });
      }
      continue;
    }
    if (m.role === "assistant") {
      if (!m.content.trim() && !m.toolCalls?.length) continue;
      const msg: Record<string, unknown> = { role: "assistant", content: m.content || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: JSON.stringify(t.arguments ?? {}) },
        }));
      }
      out.push(msg);
      continue;
    }
    if (m.role === "user") {
      const images = userImageParts(m);
      if (images.length) {
        out.push({
          role: "user",
          content: [{ type: "text", text: m.content || " " }, ...images],
        });
      } else {
        out.push({ role: "user", content: m.content });
      }
    }
  }
  const conversation = openRouter ? markLastPromptCacheBreakpoint(out) : out;
  const volatile = req?.volatilePrefix?.trim();
  if (volatile) conversation.push({ role: "system", content: volatile });
  return conversation;
}

export async function* readSseFrames(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    if (done) buffer += decoder.decode();
    while (true) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const data = sseDataPayload(line);
      if (data) yield data;
    }
    if (!done) continue;
    const data = sseDataPayload(buffer);
    if (data) yield data;
    return;
  }
}

function sseDataPayload(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return undefined;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return undefined;
  return data;
}

export function openaiFinishReason(
  choice: { finish_reason?: unknown; finishReason?: unknown } | undefined,
): string | undefined {
  const raw = choice?.finish_reason ?? choice?.finishReason;
  return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : undefined;
}

export function isUnknownFinish(reason: string | undefined): boolean {
  return reason === "unknown";
}

/**
 * Empty completion: reasoning-only EOF, unknown/stop/length, or a dropped OpenCode stream.
 * Text or a tool call is a real stop.
 */
export function isIncompleteOpenAiStop(
  _reason: string | undefined,
  sawText: boolean,
  sawTool: boolean,
): boolean {
  return !sawText && !sawTool;
}

/** Visible assistant text. Reasoning-only deltas (OpenCode / DeepSeek) are ignored. */
export function openaiDeltaText(content: unknown): string | undefined {
  if (typeof content === "string") return content || undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string")
        return part.text;
      return "";
    })
    .join("");
  return text || undefined;
}

export function openaiDeltaReasoning(
  choice: Pick<OpenAiChoice, "delta" | "message"> | undefined,
): string | undefined {
  return openaiReasoningText(
    choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? choice?.delta?.thinking,
  );
}

export function openaiMessageReasoning(
  choice: Pick<OpenAiChoice, "delta" | "message"> | undefined,
): string | undefined {
  return openaiReasoningText(
    choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? choice?.message?.thinking,
  );
}

function openaiReasoningText(raw: unknown): string | undefined {
  return typeof raw === "string" && raw ? raw : undefined;
}

export function openaiToolArgDelta(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (value && typeof value === "object") return JSON.stringify(value);
  return undefined;
}

function extraOpenAiTool(tool: ExtraToolDef) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function screenshotMediaType(message: { screenshotMime?: string; mime?: string }): string {
  const mime = (message.screenshotMime ?? message.mime)?.trim().toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") return "image/jpeg";
  if (mime === "image/webp") return "image/webp";
  if (mime === "image/gif") return "image/gif";
  return "image/png";
}

function screenshotDataUrl(message: {
  screenshotBase64?: string;
  screenshotMime?: string;
  mime?: string;
  base64?: string;
}): string {
  const data = message.screenshotBase64 ?? message.base64 ?? "";
  return `data:${screenshotMediaType(message)};base64,${data}`;
}

function userImageParts(
  message: ChatMessage,
): Array<{ type: "image_url"; image_url: { url: string } }> {
  return chatMessageImages(message)
    .filter((img) => img.base64)
    .map((img) => ({
      type: "image_url" as const,
      image_url: { url: screenshotDataUrl({ base64: img.base64, mime: img.mime }) },
    }));
}

export type { GuestOs };
