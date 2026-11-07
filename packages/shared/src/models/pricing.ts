import {
  builtinProviderKey,
  isLocalOpenAiBase,
  OPENCODE_FREE_MODELS,
  type AiProvider,
} from "./provider.js";
import { estimateUsd, type TokenUsage, type UsageRates } from "./session.js";

/** Approximate published list prices; not a live quote. */
export const PRICING_AS_OF = "2026-08";

export type CostSource = "override" | "published" | "local" | "unknown";

export interface ProjectedModelCost {
  providerId: string;
  providerName: string;
  model: string;
  current: boolean;
  rates?: UsageRates;
  source: CostSource;
}

interface CatalogRow {
  providers: string[];
  models: string[];
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

/**
 * Approximate USD per 1M tokens from vendor list prices (Aug 2026).
 * Scoped to shipped builtin model ids. OpenRouter uses first-party list as a stand-in.
 */
const CATALOG: CatalogRow[] = [
  {
    providers: ["openai", "openrouter"],
    models: ["gpt-4.1", "openai/gpt-4.1"],
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 8,
  },
  {
    providers: ["openai"],
    models: ["gpt-4.1-mini"],
    inputUsdPerMillion: 0.4,
    outputUsdPerMillion: 1.6,
  },
  { providers: ["openai"], models: ["o4-mini"], inputUsdPerMillion: 1.1, outputUsdPerMillion: 4.4 },
  { providers: ["openai"], models: ["gpt-5"], inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  {
    providers: ["anthropic", "openrouter"],
    models: ["claude-sonnet-4-5", "anthropic/claude-sonnet-4.5"],
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
  },
  {
    providers: ["anthropic"],
    models: ["claude-opus-4-5"],
    inputUsdPerMillion: 5,
    outputUsdPerMillion: 25,
  },
  {
    providers: ["anthropic"],
    models: ["claude-haiku-4-5"],
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 5,
  },
  { providers: ["xai"], models: ["grok-4"], inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  { providers: ["xai"], models: ["grok-3"], inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  {
    providers: ["xai"],
    models: ["grok-3-mini"],
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 0.5,
  },
  {
    providers: ["deepseek"],
    models: ["deepseek-chat"],
    inputUsdPerMillion: 0.14,
    outputUsdPerMillion: 0.28,
  },
  {
    providers: ["deepseek"],
    models: ["deepseek-reasoner"],
    inputUsdPerMillion: 0.435,
    outputUsdPerMillion: 0.87,
  },
  {
    providers: ["openai-compatible:Gemini", "openrouter"],
    models: ["gemini-2.5-flash", "google/gemini-2.5-flash"],
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 2.5,
  },
  {
    providers: ["openai-compatible:Gemini"],
    models: ["gemini-2.5-pro"],
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
  },
  {
    providers: ["openai-compatible:Groq"],
    models: ["llama-3.3-70b-versatile"],
    inputUsdPerMillion: 0.59,
    outputUsdPerMillion: 0.79,
  },
  {
    providers: ["openai-compatible:Groq"],
    models: ["openai/gpt-oss-120b", "gpt-oss-120b"],
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
  },
  {
    providers: ["openai-compatible:Mistral"],
    models: ["mistral-large-latest"],
    inputUsdPerMillion: 0.5,
    outputUsdPerMillion: 1.5,
  },
  {
    providers: ["openai-compatible:Mistral"],
    models: ["mistral-small-latest"],
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
  },
  {
    providers: ["openai-compatible:Together"],
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
    inputUsdPerMillion: 1.04,
    outputUsdPerMillion: 1.04,
  },
  {
    providers: ["openai-compatible:Together"],
    models: ["Qwen/Qwen2.5-72B-Instruct-Turbo"],
    inputUsdPerMillion: 1.2,
    outputUsdPerMillion: 1.2,
  },
  {
    providers: ["openai-compatible:Fireworks"],
    models: ["accounts/fireworks/models/llama-v3p3-70b-instruct"],
    inputUsdPerMillion: 0.9,
    outputUsdPerMillion: 0.9,
  },
  {
    providers: ["openai-compatible:Fireworks"],
    models: ["accounts/fireworks/models/kimi-k2-instruct"],
    inputUsdPerMillion: 0.6,
    outputUsdPerMillion: 2.5,
  },
];

const FAMILY_ALIASES: Record<string, string> = {
  "llama-3-3-70b-versatile": "llama-3-3-70b",
  "llama-3-3-70b-instruct-turbo": "llama-3-3-70b",
  "llama-v3p3-70b-instruct": "llama-3-3-70b",
  "kimi-k2-instruct": "kimi-k2",
};

export function normalizeModelId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/^accounts\/[^/]+\/models\//, "")
    .replace(/^[^/]+\/(?=[^/]+$)/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function modelFamilyKey(id: string): string {
  const normalized = normalizeModelId(id);
  return FAMILY_ALIASES[normalized] ?? normalized;
}

export function formatUsdPerMillion(amount: number): string {
  if (amount === 0) return "$0";
  if (Number.isInteger(amount)) return `$${amount}`;
  if (Math.round(amount * 100) / 100 === amount) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(3).replace(/0+$/, "")}`;
}

export function formatRatePair(rates?: UsageRates): string | undefined {
  const input = finiteRate(rates?.inputUsdPerMillion);
  const output = finiteRate(rates?.outputUsdPerMillion);
  if (input == null && output == null) return undefined;
  return `${formatUsdPerMillion(input ?? 0)} in · ${formatUsdPerMillion(output ?? 0)} out /1M`;
}

export function publishedRates(
  provider?: Pick<AiProvider, "kind" | "name" | "baseUrl" | "models">,
  model?: string,
): UsageRates | undefined {
  if (!provider) return undefined;
  if (isLocalOpenAiBase(provider.baseUrl)) return { inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
  if (provider.kind === "opencode" && isOpenCodeFreeModel(model)) {
    return { inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
  }
  if (!model?.trim()) return undefined;
  const key = builtinProviderKey(provider);
  const family = modelFamilyKey(model);
  for (const row of CATALOG) {
    if (!row.providers.includes(key)) continue;
    if (row.models.some((id) => modelFamilyKey(id) === family)) {
      return {
        inputUsdPerMillion: row.inputUsdPerMillion,
        outputUsdPerMillion: row.outputUsdPerMillion,
      };
    }
  }
  return undefined;
}

/** User Settings rates win; otherwise approximate published (or $0 local / OpenCode free). */
export function resolveUsageRates(
  provider?: Pick<
    AiProvider,
    "kind" | "name" | "baseUrl" | "inputUsdPerMillion" | "outputUsdPerMillion" | "models"
  >,
  model?: string,
): UsageRates | undefined {
  if (!provider) return undefined;
  const input = finiteRate(provider.inputUsdPerMillion);
  const output = finiteRate(provider.outputUsdPerMillion);
  if (input != null || output != null) {
    return { inputUsdPerMillion: input, outputUsdPerMillion: output };
  }
  return publishedRates(provider, model);
}

/** Stamped spend wins. Otherwise estimate from the session's token usage. */
export function automationRunUsd(input: {
  spendUsd?: number;
  usage?: TokenUsage;
  provider?: Parameters<typeof resolveUsageRates>[0];
  model?: string;
}): number | undefined {
  if (typeof input.spendUsd === "number" && Number.isFinite(input.spendUsd)) return input.spendUsd;
  if (!input.usage) return undefined;
  return estimateUsd(input.usage, resolveUsageRates(input.provider, input.model));
}

export function projectedModelCosts(
  providers: AiProvider[],
  providerId: string,
  model: string,
): ProjectedModelCost[] {
  const current = providers.find((p) => p.id === providerId);
  const family = modelFamilyKey(model);
  const rows: ProjectedModelCost[] = [];
  for (const provider of providers) {
    const match = matchingModel(provider, family, provider.id === providerId ? model : undefined);
    if (!match) continue;
    const source = costSource(provider, match);
    rows.push({
      providerId: provider.id,
      providerName: provider.name,
      model: match,
      current: provider.id === providerId,
      rates: resolveUsageRates(provider, match),
      source,
    });
  }
  if (current && !rows.some((row) => row.current)) {
    const source = costSource(current, model);
    rows.unshift({
      providerId: current.id,
      providerName: current.name,
      model,
      current: true,
      rates: resolveUsageRates(current, model),
      source,
    });
  }
  return rows.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    const aKnown = blended(a.rates);
    const bKnown = blended(b.rates);
    if (aKnown == null && bKnown == null) return a.providerName.localeCompare(b.providerName);
    if (aKnown == null) return 1;
    if (bKnown == null) return -1;
    return aKnown - bKnown || a.providerName.localeCompare(b.providerName);
  });
}

function matchingModel(
  provider: AiProvider,
  family: string,
  preferred?: string,
): string | undefined {
  if (preferred && modelFamilyKey(preferred) === family) return preferred;
  const listed = [...provider.models];
  if (provider.defaultModel && !listed.includes(provider.defaultModel))
    listed.unshift(provider.defaultModel);
  return listed.find((id) => modelFamilyKey(id) === family);
}

function costSource(provider: AiProvider, model: string): CostSource {
  const input = finiteRate(provider.inputUsdPerMillion);
  const output = finiteRate(provider.outputUsdPerMillion);
  if (input != null || output != null) return "override";
  if (isLocalOpenAiBase(provider.baseUrl)) return "local";
  if (publishedRates(provider, model)) return "published";
  return "unknown";
}

function isOpenCodeFreeModel(model?: string): boolean {
  const id = model?.trim() ?? "";
  if (!id) return true;
  if (OPENCODE_FREE_MODELS.includes(id)) return true;
  return /(?:^|[-_/])free$/i.test(id);
}

function blended(rates?: UsageRates): number | undefined {
  const input = finiteRate(rates?.inputUsdPerMillion);
  const output = finiteRate(rates?.outputUsdPerMillion);
  if (input == null && output == null) return undefined;
  return (input ?? 0) + (output ?? 0);
}

function finiteRate(value?: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
