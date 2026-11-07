import { isLocalOpenAiBase, isOpenRouterProvider, type ProviderKind } from "./models/provider.js";

export const DEFAULT_CHARS_PER_TOKEN = 4;
export const MIN_CHARS_PER_TOKEN = 1.5;
export const MAX_CHARS_PER_TOKEN = 16;
/** Fallback window when the model is unknown. Compact used 24k; most hosted models are 128k+. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const CONTEXT_SAFETY_RATIO = 0.1;
export const DEFAULT_ANTHROPIC_RESERVED_OUTPUT = 4096;
export const DEFAULT_OPENAI_RESERVED_OUTPUT = 32_768;

export type ContextPart = {
  id: string;
  label: string;
  tokens: number;
};

export const CONTEXT_PART_META: Record<string, { label: string; color: string }> = {
  system: { label: "System prompt", color: "#9aa3af" },
  tools: { label: "Tools", color: "#a78bfa" },
  rules: { label: "Rules", color: "#4ade80" },
  skills: { label: "Skills", color: "#f5c542" },
  mcp: { label: "MCP", color: "#e879f9" },
  subagents: { label: "Subagents", color: "#7dd3fc" },
  repo: { label: "Repo map", color: "#38bdf8" },
  conversation: { label: "Conversation", color: "#f0ab9a" },
  reserved: { label: "Reserved output", color: "#6b7280" },
};

export function contextPartMeta(id: string): { label: string; color: string } {
  return CONTEXT_PART_META[id] ?? { label: id, color: "#9aa3af" };
}

export type ContextBreakdown = {
  window: number;
  /** Prompt tokens (measured last reply, or estimated). Does not include reserved output. */
  used: number;
  reserved: number;
  charsPerToken: number;
  measured: boolean;
  /** Provider-reported prompt-cache hits from the last reply. */
  cachedInputTokens?: number;
  parts: ContextPart[];
};

export function clampCharsPerToken(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_CHARS_PER_TOKEN;
  }
  return Math.min(MAX_CHARS_PER_TOKEN, Math.max(MIN_CHARS_PER_TOKEN, value));
}

export function estimateTokensFromChars(
  chars: number,
  charsPerToken = DEFAULT_CHARS_PER_TOKEN,
): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / clampCharsPerToken(charsPerToken));
}

/** Rough token estimate: calibrated characters per token, default ~4. */
export function estimateTokens(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  if (!text) return 0;
  return estimateTokensFromChars(text.length, charsPerToken);
}

/**
 * Blend the observed chars/token from a provider usage report into the session factor.
 * Clamped so one bad report cannot invert compaction.
 */
export function calibrateCharsPerToken(
  promptChars: number,
  reportedInputTokens: number,
  previous = DEFAULT_CHARS_PER_TOKEN,
): number {
  const prior = clampCharsPerToken(previous);
  if (promptChars <= 0 || reportedInputTokens <= 0) return prior;
  const observed = promptChars / reportedInputTokens;
  return clampCharsPerToken(prior * 0.7 + observed * 0.3);
}

export function reservedOutputTokens(
  model: string,
  provider?: { kind?: string; baseUrl?: string },
): number {
  const kind = provider?.kind;
  if (kind === "anthropic") return DEFAULT_ANTHROPIC_RESERVED_OUTPUT;
  if (kind === "opencode" && !isLocalOpenAiBase(provider?.baseUrl)) {
    return DEFAULT_OPENAI_RESERVED_OUTPUT;
  }
  if (provider && isOpenRouterProvider(provider) && !isLocalOpenAiBase(provider.baseUrl)) {
    return DEFAULT_OPENAI_RESERVED_OUTPUT;
  }
  const name = (model ?? "").toLowerCase();
  if (name.includes("claude")) return DEFAULT_ANTHROPIC_RESERVED_OUTPUT;
  return 0;
}

export function modelContextWindow(model: string, kind?: ProviderKind | string): number {
  const name = (model ?? "").toLowerCase();
  if (name.includes("gpt-4.1")) return 1_047_576;
  if (name.includes("gemini")) return 1_048_576;
  if (name.includes("grok-4")) return 256_000;
  if (name.includes("claude") || /\bo[134]\b/.test(name) || name.includes("o4-")) return 200_000;
  if (name.includes("cursor-composer") || name.includes("composer-2")) return 200_000;
  if (name.includes("grok-3")) return 131_072;
  if (name.includes("qwen2.5") || name.includes("qwen-2.5")) return 32_768;
  if (name.includes("llama3.2") || name.includes("llama-3.2")) return 128_000;
  if (
    kind === "opencode" ||
    kind === "openai" ||
    kind === "deepseek" ||
    kind === "xai" ||
    kind === "openrouter"
  ) {
    return DEFAULT_CONTEXT_WINDOW;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

export function contextBudget(opts: {
  window: number;
  reservedOutput?: number;
  safetyRatio?: number;
}): number {
  const window = Math.max(1, Math.floor(opts.window));
  const reserved = Math.max(0, Math.floor(opts.reservedOutput ?? 0));
  const ratio =
    typeof opts.safetyRatio === "number" && Number.isFinite(opts.safetyRatio)
      ? Math.min(0.4, Math.max(0, opts.safetyRatio))
      : CONTEXT_SAFETY_RATIO;
  const safety = Math.floor(window * ratio);
  return Math.max(1024, window - reserved - safety);
}

export function buildContextBreakdown(input: {
  window: number;
  reserved: number;
  charsPerToken?: number;
  measuredUsed?: number;
  cachedInputTokens?: number;
  parts: { id: string; label: string; chars: number }[];
}): ContextBreakdown {
  const window = Math.max(1, Math.round(input.window));
  const charsPerToken = clampCharsPerToken(input.charsPerToken);
  const estimatedParts = input.parts
    .map((part) => ({
      id: part.id,
      label: part.label,
      tokens: estimateTokensFromChars(part.chars, charsPerToken),
    }))
    .filter((part) => part.tokens > 0);
  const estimated = estimatedParts.reduce((sum, part) => sum + part.tokens, 0);
  const measured =
    typeof input.measuredUsed === "number" &&
    Number.isFinite(input.measuredUsed) &&
    input.measuredUsed > 0;
  const rawUsed = measured ? Math.round(input.measuredUsed!) : estimated;
  const used = Math.min(window, Math.max(0, rawUsed));
  const parts =
    measured || estimated > window ? scalePartsToUsed(estimatedParts, used) : estimatedParts;
  const reserved = Math.max(0, Math.round(input.reserved));
  if (reserved > 0) parts.push({ id: "reserved", label: "Reserved output", tokens: reserved });
  return clampContextToWindow({
    window,
    used,
    reserved,
    charsPerToken,
    measured,
    parts,
    ...(typeof input.cachedInputTokens === "number" &&
    Number.isFinite(input.cachedInputTokens) &&
    input.cachedInputTokens > 0
      ? { cachedInputTokens: Math.round(input.cachedInputTokens) }
      : {}),
  });
}

/**
 * Cursor CLI `usage` is turn-level billing, not live prompt occupancy.
 * `inputTokens` is uncached only; cache reads/writes are disjoint per call but
 * summed across every model call in the turn, so the totals often exceed the
 * model window. Occupancy is that prompt-side sum, capped at the window.
 */
export function occupancyFromCursorCliUsage(input: {
  inputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  window: number;
}): { used: number; cachedInputTokens?: number } {
  const window = Math.max(1, Math.round(input.window));
  const uncached = Math.max(0, Math.round(input.inputTokens));
  const cacheRead = Math.max(0, Math.round(input.cachedInputTokens ?? 0));
  const cacheWrite = Math.max(0, Math.round(input.cacheWriteTokens ?? 0));
  const used = Math.min(window, uncached + cacheRead + cacheWrite);
  const cached = Math.min(cacheRead, used);
  return {
    used,
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
  };
}

/** Occupancy cannot exceed the model window (billing totals and estimates sometimes do). */
export function clampContextToWindow(context: ContextBreakdown): ContextBreakdown {
  const window = Math.max(1, Math.round(context.window));
  const used = Math.min(window, Math.max(0, Math.round(context.used)));
  const cachedRaw = context.cachedInputTokens;
  const cached =
    typeof cachedRaw === "number" && Number.isFinite(cachedRaw) && cachedRaw > 0
      ? Math.min(window, used, Math.round(cachedRaw))
      : undefined;
  const content = context.parts.filter((part) => part.id !== "reserved");
  const reservedPart = context.parts.find((part) => part.id === "reserved");
  const partSum = content.reduce((n, part) => n + part.tokens, 0);
  const parts = partSum > window || used !== partSum ? scalePartsToUsed(content, used) : content;
  if (reservedPart) parts.push(reservedPart);
  return {
    ...context,
    window,
    used,
    parts,
    ...(cached != null ? { cachedInputTokens: cached } : {}),
  };
}

export function scalePartsToUsed(parts: ContextPart[], used: number): ContextPart[] {
  const content = parts.filter((part) => part.id !== "reserved");
  const reserved = parts.find((part) => part.id === "reserved");
  const sum = content.reduce((n, part) => n + part.tokens, 0);
  const target = Math.max(0, Math.round(used));
  if (sum <= 0) {
    return reserved ? [...content, reserved] : content;
  }
  const scaled = content.map((part) => ({
    ...part,
    tokens: Math.round((part.tokens * target) / sum),
  }));
  const drift = target - scaled.reduce((n, part) => n + part.tokens, 0);
  if (drift && scaled[0]) {
    scaled[0] = { ...scaled[0], tokens: Math.max(0, scaled[0].tokens + drift) };
  }
  return reserved ? [...scaled, reserved] : scaled;
}

export function contextSnapshot(input: {
  model: string;
  kind?: string;
  baseUrl?: string;
  context?: ContextBreakdown;
  charsPerToken?: number;
}): ContextBreakdown {
  if (input.context && input.context.window > 0) return clampContextToWindow(input.context);
  const window = modelContextWindow(input.model, input.kind);
  const reserved = reservedOutputTokens(input.model, input);
  return {
    window,
    used: 0,
    reserved,
    charsPerToken: clampCharsPerToken(input.charsPerToken),
    measured: false,
    parts: reserved > 0 ? [{ id: "reserved", label: "Reserved output", tokens: reserved }] : [],
  };
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  const m = n / 1_000_000;
  return `${m.toFixed(m >= 10 ? 0 : 1).replace(/\.0$/, "")}M`;
}

export function formatContextPercent(used: number, window: number): string {
  if (!Number.isFinite(used) || !Number.isFinite(window) || window <= 0 || used <= 0) return "0%";
  return `${Math.min(100, Math.round((used / window) * 100))}%`;
}

export function formatContextUsage(
  used: number,
  window: number,
  opts: { measured?: boolean } = {},
): string {
  const prefix = !opts.measured && used > 0 ? "~" : "";
  return `${prefix}${formatTokenCount(used)} / ${formatTokenCount(window)}`;
}

export function toolCatalogChars(tools: Array<{ name: string; description?: string }>): number {
  if (!tools.length) return 0;
  return tools.map((tool) => `- ${tool.name}: ${tool.description ?? ""}`).join("\n").length;
}

export function collectPromptContextParts(input: {
  systemChars: number;
  toolsChars?: number;
  rulesChars?: number;
  skillsChars?: number;
  mcpChars?: number;
  subagentChars?: number;
  repoChars?: number;
  conversationChars?: number;
}): { id: string; label: string; chars: number }[] {
  const tools = Math.max(0, input.toolsChars ?? 0);
  const rules = Math.max(0, input.rulesChars ?? 0);
  const skills = Math.max(0, input.skillsChars ?? 0);
  const mcp = Math.max(0, input.mcpChars ?? 0);
  const subagents = Math.max(0, input.subagentChars ?? 0);
  const nested = tools + rules + skills + mcp + subagents;
  const rows = [
    { id: "system", chars: Math.max(0, input.systemChars - nested) },
    { id: "tools", chars: tools },
    { id: "rules", chars: rules },
    { id: "skills", chars: skills },
    { id: "mcp", chars: mcp },
    { id: "subagents", chars: subagents },
    { id: "repo", chars: Math.max(0, input.repoChars ?? 0) },
    { id: "conversation", chars: Math.max(0, input.conversationChars ?? 0) },
  ];
  return rows.map((row) => ({
    id: row.id,
    label: contextPartMeta(row.id).label,
    chars: row.chars,
  }));
}

export function visibleContextParts(parts: ContextPart[]): ContextPart[] {
  return parts.filter((part) => part.id !== "reserved" && part.tokens > 0);
}

export function contextFillLevel(used: number, window: number): "ok" | "warn" | "hot" {
  const ratio = window > 0 ? used / window : 0;
  if (ratio >= 0.9) return "hot";
  if (ratio >= 0.7) return "warn";
  return "ok";
}
