import {
  hasUsableKey,
  isClaudeCodeProvider,
  isCodexCliProvider,
  isCursorCliProvider,
  isCursorProvider,
  isKiroCliProvider,
} from "@locus/shared";
import { streamAnthropic } from "./anthropic.js";
import { cursorMissingCompletionsError, rewriteCursorCompletionsError } from "./models.js";
import { streamOpenAiCompatible } from "./openai.js";
import type { ChatEvent, CompleteRequest, FetchFn } from "./types.js";

export async function* completeChat(
  req: CompleteRequest,
  fetchFn: FetchFn = fetch,
): AsyncGenerator<ChatEvent> {
  if (!hasUsableKey(req.provider.apiKey, req.provider.baseUrl, req.provider.kind)) {
    throw new Error("Provider API key is not set");
  }
  if (
    isCursorProvider(req.provider) ||
    isCursorCliProvider(req.provider) ||
    isClaudeCodeProvider(req.provider) ||
    isCodexCliProvider(req.provider) ||
    isKiroCliProvider(req.provider)
  ) {
    throw cursorMissingCompletionsError(req.provider.kind);
  }
  if (req.provider.kind === "anthropic") {
    yield* streamAnthropic(req, fetchFn);
    return;
  }
  try {
    yield* streamOpenAiCompatible(req, fetchFn);
  } catch (err) {
    throw rewriteCursorCompletionsError(req.provider, err);
  }
}

export { hasUsableKey };

export async function collectText(events: AsyncIterable<ChatEvent>): Promise<string> {
  let out = "";
  for await (const ev of events) {
    if (ev.type === "text") out += ev.text;
  }
  return out;
}
