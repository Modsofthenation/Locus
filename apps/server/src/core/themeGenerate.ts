import {
  CUSTOM_THEME_SYSTEM_PROMPT,
  customThemeFromInput,
  parseCustomThemeJson,
  supportsOneShotCompletion,
  supportsPromptCompletion,
  type AiProvider,
  type CustomTheme,
  type LocusConfig,
} from "@locus/shared";
import {
  collectText,
  completeOneShot,
  hasUsableKey,
  type ChatEvent,
  type CompleteRequest,
} from "@locus/providers";
import { changeStackCompletionProvider } from "../git/changeStackSummaries.js";

export const THEME_GENERATE_TIMEOUT_MS = 90_000;
/** Local CLI agents start a whole agent process, so they get longer. */
export const THEME_GENERATE_CLI_TIMEOUT_MS = 180_000;
const MAX_PROMPT = 2_000;

export type ThemeComplete = (req: CompleteRequest) => AsyncIterable<ChatEvent>;

export type ThemeGenerateResult =
  { ok: true; theme: CustomTheme } | { ok: false; error: string; status: 400 | 422 | 503 };

/**
 * Asks the picked provider (API or local CLI agent) for a theme spec and normalizes it.
 * The theme is returned, not saved: the Appearance editor previews it first.
 */
export async function generateCustomTheme(input: {
  config: LocusConfig;
  prompt: string;
  /** Optional theme to revise ("make this warmer"). */
  current?: unknown;
  /** Provider picked in the composer; default is the first usable API provider. */
  providerId?: string;
  /** Model picked in the composer; default is the provider's default model. */
  model?: string;
  complete?: ThemeComplete;
  signal?: AbortSignal;
}): Promise<ThemeGenerateResult> {
  const prompt = input.prompt.trim().slice(0, MAX_PROMPT);
  if (!prompt) return { ok: false, error: "Describe the theme you want", status: 400 };
  const picked = pickThemeProvider(input.config, input.providerId);
  if ("error" in picked) return { ok: false, error: picked.error, status: 400 };
  const provider = picked.provider;
  if (!provider) {
    return {
      ok: false,
      error: "Generating themes needs a provider in Settings → Providers",
      status: 503,
    };
  }
  const user = input.current
    ? `Revise this theme. Keep what the request does not mention.\nCurrent theme:\n${JSON.stringify(input.current).slice(0, 6_000)}\n\nRequest: ${prompt}`
    : `Request: ${prompt}`;
  let text: string;
  try {
    text = await collectText(
      (input.complete ?? completeOneShot)({
        provider,
        model: pickThemeModel(provider, input.model),
        system: CUSTOM_THEME_SYSTEM_PROMPT,
        messages: [
          {
            id: "theme-generate",
            role: "user",
            content: user,
            createdAt: new Date().toISOString(),
          },
        ],
        allowedTools: [],
        stream: false,
        maxTokens: 4096,
        signal:
          input.signal ??
          AbortSignal.timeout(
            supportsOneShotCompletion(provider)
              ? THEME_GENERATE_TIMEOUT_MS
              : THEME_GENERATE_CLI_TIMEOUT_MS,
          ),
      }),
    );
  } catch (err) {
    return {
      ok: false,
      error: `The model call failed: ${err instanceof Error ? err.message : String(err)}`,
      status: 503,
    };
  }
  try {
    const spec = parseCustomThemeJson(text);
    const taken = (input.config.customThemes ?? []).map((t) => t.id);
    return { ok: true, theme: customThemeFromInput(spec, { taken, origin: "ai" }) };
  } catch {
    return { ok: false, error: "The model did not return a usable theme. Try again.", status: 422 };
  }
}

function pickThemeProvider(
  config: LocusConfig,
  providerId: string | undefined,
): { provider: AiProvider | undefined } | { error: string } {
  if (!providerId) {
    // Prefer a fast API provider; fall back to any enabled local CLI agent.
    const fallback =
      changeStackCompletionProvider(config) ??
      config.providers.find(
        (row) =>
          row.enabled &&
          supportsPromptCompletion(row) &&
          hasUsableKey(row.apiKey, row.baseUrl, row.kind),
      );
    return { provider: fallback };
  }
  const provider = config.providers.find((row) => row.id === providerId);
  if (!provider) return { error: "That provider is no longer in Settings → Providers" };
  if (!provider.enabled) return { error: `${provider.name} is turned off in Settings → Providers` };
  if (!supportsPromptCompletion(provider)) {
    return {
      error: `${provider.name} needs a repository to run and can't generate themes. Pick another provider.`,
    };
  }
  if (!hasUsableKey(provider.apiKey, provider.baseUrl, provider.kind)) {
    return { error: `${provider.name} needs an API key in Settings → Providers` };
  }
  return { provider };
}

function pickThemeModel(provider: AiProvider, model: string | undefined): string {
  const wanted = model?.trim().slice(0, 200);
  return wanted || provider.defaultModel || provider.models[0] || "";
}
