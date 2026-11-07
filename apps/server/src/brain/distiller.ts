import {
  distillSessionText,
  hasUsableKey,
  isBrainMemoryKind,
  isClaudeCodeProvider,
  isKiroCliProvider,
  isCursorCliProvider,
  isCursorProvider,
  pickPolicyDistiller,
  providerAllowedByPolicy,
  type AiProvider,
  type BrainMemoryKind,
  type LocusConfig,
} from "@locus/shared";
import { collectText, completeChat, type ChatEvent, type CompleteRequest } from "@locus/providers";

export type DistillerComplete = (req: CompleteRequest) => AsyncIterable<ChatEvent>;

export const BRAIN_DISTILL_TIMEOUT_MS = 45_000;
export const BRAIN_DISTILL_IDLE_MS = 120_000;

export interface DistilledObservation {
  text: string;
  kind: BrainMemoryKind;
  ambient: boolean;
  source: "user_stated" | "agent" | "session" | "indexer";
  contradictId?: string;
}

export function brainDistillerProvider(
  config: Pick<LocusConfig, "providers" | "brain" | "managedPolicy">,
): { provider: AiProvider; model: string } | undefined {
  const preferredId = config.brain?.distillerProviderId?.trim();
  const preferredModel = config.brain?.distillerModel?.trim();
  const policy = config.managedPolicy;
  if (policy?.active) {
    const pinned = pickPolicyDistiller(config.providers, policy.policy, true);
    if (!pinned) return undefined;
    const provider = config.providers.find((row) => row.id === pinned.providerId);
    if (!provider) return undefined;
    const model =
      preferredModel || pinned.model || provider.defaultModel || provider.models[0] || "";
    if (!model) return undefined;
    return { provider, model };
  }
  const candidates = config.providers.filter((provider) => {
    if (!provider.enabled) return false;
    if (
      isCursorProvider(provider) ||
      isCursorCliProvider(provider) ||
      isClaudeCodeProvider(provider) ||
      isKiroCliProvider(provider)
    ) {
      return false;
    }
    if (policy?.active && !providerAllowedByPolicy(provider, policy.policy)) return false;
    return hasUsableKey(provider.apiKey, provider.baseUrl, provider.kind);
  });
  const provider =
    (preferredId ? candidates.find((row) => row.id === preferredId) : undefined) ?? candidates[0];
  if (!provider) return undefined;
  const model = preferredModel || provider.defaultModel || provider.models[0] || "";
  if (!model) return undefined;
  return { provider, model };
}

export function formatDistillPrompt(blob: string): string {
  return [
    "Extract durable observations from this coding session tail.",
    'Return JSON only: {"observations":[{"text":"...","kind":"decision|gotcha|convention|note","ambient":true,"contradictId":null}]}',
    "Rules:",
    "- Only keep decisions, gotchas, conventions, and durable notes.",
    "- Prefer short factual lines the next agent needs.",
    "- ambient=true only if it should appear in the orient doc.",
    "- Never invent APIs or file paths.",
    '- If nothing durable, return {"observations":[]}.',
    "",
    "Session tail:",
    blob.slice(0, 12_000),
  ].join("\n");
}

export function parseDistillerResponse(text: string): DistilledObservation[] {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      observations?: unknown;
    };
    if (!Array.isArray(parsed.observations)) return [];
    const out: DistilledObservation[] = [];
    for (const row of parsed.observations) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const claim = typeof item.text === "string" ? item.text.trim() : "";
      if (claim.length < 12) continue;
      const kind = isBrainMemoryKind(item.kind) ? item.kind : "note";
      out.push({
        text: claim.slice(0, 800),
        kind,
        ambient: item.ambient === true || kind === "gotcha" || kind === "convention",
        source: "session",
        contradictId: typeof item.contradictId === "string" ? item.contradictId : undefined,
      });
    }
    return out.slice(0, 12);
  } catch {
    return [];
  }
}

export async function distillSessionBlob(input: {
  text: string;
  config: LocusConfig;
  complete?: DistillerComplete;
  signal?: AbortSignal;
}): Promise<DistilledObservation[]> {
  const blob = input.text.trim();
  if (!blob) return [];
  const picked = brainDistillerProvider(input.config);
  if (!picked) return distillSessionText(blob).map((row) => ({ ...row }));
  try {
    const complete = input.complete ?? completeChat;
    const text = await collectText(
      complete({
        provider: picked.provider,
        model: picked.model,
        system: "You distill durable engineering memory. Reply with JSON only.",
        messages: [
          {
            id: "brain-distill",
            role: "user",
            content: formatDistillPrompt(blob),
            createdAt: new Date().toISOString(),
          },
        ],
        allowedTools: [],
        stream: false,
        maxTokens: 1024,
        signal: input.signal ?? AbortSignal.timeout(BRAIN_DISTILL_TIMEOUT_MS),
      }),
    );
    const parsed = parseDistillerResponse(text);
    if (parsed.length) return parsed;
  } catch {
    /* fall open to heuristics */
  }
  return distillSessionText(blob).map((row) => ({ ...row }));
}
