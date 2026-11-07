import {
  applyChangeStackSummaries,
  formatChangeStackSummaryPrompt,
  hasUsableKey,
  isClaudeCodeProvider,
  isKiroCliProvider,
  isCursorCliProvider,
  isCursorProvider,
  parseChangeStackSummaryResponse,
  type AiProvider,
  type ChangeStack,
  type LocusConfig,
  type PullFile,
} from "@locus/shared";
import { collectText, completeChat, type ChatEvent, type CompleteRequest } from "@locus/providers";

export type ChangeStackComplete = (req: CompleteRequest) => AsyncIterable<ChatEvent>;

export type ChangeStackSummarizer = (input: {
  stack: ChangeStack;
  files: Array<Pick<PullFile, "path" | "patch">>;
  config: LocusConfig;
}) => Promise<ChangeStack>;

export const CHANGE_STACK_SUMMARY_TIMEOUT_MS = 60_000;

export function changeStackCompletionProvider(
  config: Pick<LocusConfig, "providers">,
): AiProvider | undefined {
  return config.providers.find((provider) => {
    if (!provider.enabled) return false;
    if (
      isCursorProvider(provider) ||
      isCursorCliProvider(provider) ||
      isClaudeCodeProvider(provider) ||
      isKiroCliProvider(provider)
    ) {
      return false;
    }
    return hasUsableKey(provider.apiKey, provider.baseUrl, provider.kind);
  });
}

export async function summarizeChangeStack(input: {
  stack: ChangeStack;
  files: Array<Pick<PullFile, "path" | "patch">>;
  config: LocusConfig;
  complete?: ChangeStackComplete;
  signal?: AbortSignal;
}): Promise<ChangeStack> {
  const provider = changeStackCompletionProvider(input.config);
  if (!provider) return input.stack;
  try {
    const complete = input.complete ?? completeChat;
    const text = await collectText(
      complete({
        provider,
        model: provider.defaultModel || provider.models[0] || "",
        system:
          "You write concise Change Stack walkthroughs for code review. Reply with JSON only.",
        messages: [
          {
            id: "changestack-summary",
            role: "user",
            content: formatChangeStackSummaryPrompt(input.stack, input.files),
            createdAt: new Date().toISOString(),
          },
        ],
        allowedTools: [],
        stream: false,
        maxTokens: 2048,
        signal: input.signal ?? AbortSignal.timeout(CHANGE_STACK_SUMMARY_TIMEOUT_MS),
      }),
    );
    return applyChangeStackSummaries(input.stack, parseChangeStackSummaryResponse(text));
  } catch {
    return input.stack;
  }
}
