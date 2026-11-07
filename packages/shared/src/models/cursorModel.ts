import { isCursorCliProvider, isCursorProvider, type AiProvider } from "./provider.js";

export const CURSOR_THINKING_LEVELS = [
  "off",
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "thinking",
] as const;

export type CursorThinkingLevel = (typeof CURSOR_THINKING_LEVELS)[number];

export type CursorModelFamily = "composer" | "gpt" | "claude" | "grok" | "other";

export interface ParsedCursorModel {
  base: string;
  fast: boolean;
  thinking: CursorThinkingLevel;
}

export interface CursorThinkingChoice {
  value: CursorThinkingLevel;
  label: string;
}

export interface CursorModelCapabilities {
  family: CursorModelFamily;
  supportsFast: boolean;
  thinkingLevels: CursorThinkingChoice[];
  defaultThinking: CursorThinkingLevel;
}

const CLAUDE_THINKING: CursorThinkingChoice[] = [
  { value: "off", label: "Off" },
  { value: "thinking", label: "Thinking" },
  { value: "high", label: "High" },
];

const GROK_THINKING: CursorThinkingChoice[] = [
  { value: "off", label: "Off" },
  { value: "thinking", label: "Thinking" },
];

/** Cursor Grok 4.5/4.6 CLI slugs are effort suffixes (`cursor-grok-4.6-high`), not `-thinking`. */
const GROK_EFFORT: CursorThinkingChoice[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra-high" },
];

const GPT_THINKING: CursorThinkingChoice[] = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra-high" },
];

/** Cursor CLI and Cloud share the same slug catalog (`composer-2-fast`, `gpt-5.2-high`). */
export function usesCursorModelIds(provider?: { kind?: string; baseUrl?: string }): boolean {
  const row = provider ?? {};
  return isCursorProvider(row) || isCursorCliProvider(row);
}

export function providerKnowsModel(
  provider: Pick<AiProvider, "kind" | "baseUrl" | "models" | "defaultModel"> | undefined,
  model: string,
): boolean {
  if (!provider || !model) return false;
  if (provider.models.includes(model) || provider.defaultModel === model) return true;
  if (!usesCursorModelIds(provider)) return false;
  const base = parseCursorModelId(model).base;
  if (parseCursorModelId(provider.defaultModel).base === base) return true;
  return provider.models.some((id) => parseCursorModelId(id).base === base);
}

export function cursorModelFamily(id: string): CursorModelFamily {
  return familyFromBase(parseCursorModelId(id).base);
}

export function parseCursorModelId(id: string): ParsedCursorModel {
  let rest = id.trim();
  if (!rest) return { base: "", fast: false, thinking: "off" };

  let fast = false;
  if (rest.toLowerCase().endsWith("-fast")) {
    fast = true;
    rest = rest.slice(0, -"-fast".length);
  }

  let thinking: CursorThinkingLevel = "off";
  const lower = rest.toLowerCase();
  if (lower.endsWith("-thinking-high")) {
    thinking = "high";
    rest = rest.slice(0, -"-thinking-high".length);
  } else if (lower.endsWith("-thinking")) {
    thinking = "thinking";
    rest = rest.slice(0, -"-thinking".length);
  } else if (lower.endsWith("-extra-high")) {
    thinking = "xhigh";
    rest = rest.slice(0, -"-extra-high".length);
  } else {
    const effort = rest.match(/-(none|low|medium|high|xhigh)$/i);
    if (effort) {
      thinking = effort[1]!.toLowerCase() as CursorThinkingLevel;
      rest = rest.slice(0, -effort[0].length);
    }
  }

  if (familyFromBase(rest) === "gpt" && thinking === "off") thinking = "medium";
  if (grokUsesEffortSuffix(rest) && thinking === "off") thinking = "high";
  return { base: rest, fast, thinking };
}

export function formatCursorModelId(input: {
  base: string;
  fast?: boolean;
  thinking?: CursorThinkingLevel;
}): string {
  const parsed = parseCursorModelId(input.base);
  const base = parsed.base;
  if (!base) return "";
  const caps = cursorModelCapabilities(base);
  const fast = (input.fast ?? parsed.fast) && caps.supportsFast;
  const thinking = input.thinking ?? parsed.thinking;

  let id = base;
  if (caps.family === "claude") {
    if (thinking === "high") id = `${base}-thinking-high`;
    else if (thinking === "thinking") id = `${base}-thinking`;
  } else if (caps.family === "grok" && grokUsesEffortSuffix(base)) {
    const allowed = new Set(caps.thinkingLevels.map((row) => row.value));
    const level = allowed.has(thinking) ? thinking : caps.defaultThinking;
    id = `${base}-${level}`;
  } else if (caps.family === "grok") {
    if (thinking === "thinking" || thinking === "high" || thinking === "xhigh") {
      id = `${base}-thinking`;
    }
  } else if (caps.family === "gpt" && caps.thinkingLevels.length) {
    if (thinking === "none" || thinking === "low" || thinking === "high")
      id = `${base}-${thinking}`;
    else if (thinking === "xhigh") id = `${base}-xhigh`;
    else if (thinking === "medium" && gptUsesExplicitMedium(base)) id = `${base}-medium`;
  }
  if (fast) id = `${id}-fast`;
  return id;
}

/** Fold Fast / thinking suffixes into the slug Cursor CLI and Cloud actually accept. */
export function normalizeCursorModelId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return "";
  return formatCursorModelId(parseCursorModelId(trimmed));
}

export function retargetCursorModel(current: string, nextBase: string): string {
  const cur = parseCursorModelId(current);
  const next = parseCursorModelId(nextBase);
  const caps = cursorModelCapabilities(next.base);
  const thinking = caps.thinkingLevels.some((row) => row.value === cur.thinking)
    ? cur.thinking
    : caps.defaultThinking;
  return formatCursorModelId({
    base: next.base,
    fast: cur.fast,
    thinking,
  });
}

export function cursorModelPickerIds(models: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const model of models) {
    const base = parseCursorModelId(model).base;
    if (!base || seen.has(base)) continue;
    seen.add(base);
    out.push(base);
  }
  return out;
}

export function cursorModelSelectValue(models: string[], current: string): string {
  const ids = cursorModelPickerIds(current ? [current, ...models] : models);
  const base = parseCursorModelId(current).base;
  return ids.includes(base) ? base : (ids[0] ?? "");
}

export function cursorModelCapabilities(id: string): CursorModelCapabilities {
  const base = parseCursorModelId(id).base;
  const family = familyFromBase(base);
  const supportsFast = cursorModelSupportsFast(base);
  if (family === "claude") {
    return {
      family,
      supportsFast: false,
      thinkingLevels: CLAUDE_THINKING,
      defaultThinking: "off",
    };
  }
  if (family === "grok") {
    if (grokUsesEffortSuffix(base)) {
      return {
        family,
        supportsFast: true,
        thinkingLevels: grokHasXhigh(base)
          ? GROK_EFFORT
          : GROK_EFFORT.filter((row) => row.value !== "xhigh"),
        defaultThinking: "high",
      };
    }
    return {
      family,
      supportsFast: false,
      thinkingLevels: GROK_THINKING,
      defaultThinking: "off",
    };
  }
  if (family === "gpt" && gptHasThinkingLevels(base)) {
    return { family, supportsFast, thinkingLevels: GPT_THINKING, defaultThinking: "medium" };
  }
  return { family, supportsFast, thinkingLevels: [], defaultThinking: "off" };
}

export function cursorModelSupportsFast(id: string): boolean {
  const base = parseCursorModelId(id).base.toLowerCase();
  if (base.startsWith("composer-2")) return true;
  if (grokUsesEffortSuffix(base)) return true;
  if (!base.includes("gpt-5")) return false;
  if (/(^|-)(mini|nano)($|-)/.test(base) || base.includes("spark")) return false;
  if (/gpt-5\.1/.test(base) && !base.includes("codex-max")) return false;
  return true;
}

/** Cursor CLI lists `cursor-grok-4.6-high` / `-high-fast`; a bare `cursor-grok-4.6` is rejected. */
function grokUsesEffortSuffix(base: string): boolean {
  const id = base.trim().toLowerCase();
  return id.includes("cursor-grok") || /grok-4\.\d+/.test(id);
}

function grokHasXhigh(base: string): boolean {
  return !/grok-4\.5\b/.test(base.trim().toLowerCase());
}

function familyFromBase(base: string): CursorModelFamily {
  const id = base.trim().toLowerCase();
  if (id.startsWith("composer")) return "composer";
  if (id.includes("gpt-5") || /(^|\/)gpt-/.test(id)) return "gpt";
  if (
    id.includes("claude") ||
    id.startsWith("sonnet-") ||
    id.startsWith("opus-") ||
    id.startsWith("haiku-")
  ) {
    return "claude";
  }
  if (id.includes("grok")) return "grok";
  return "other";
}

function gptHasThinkingLevels(base: string): boolean {
  const id = base.toLowerCase();
  if (!id.includes("gpt-5")) return false;
  if (id === "gpt-5-mini" || id.startsWith("gpt-5-mini-")) return false;
  return true;
}

function gptUsesExplicitMedium(base: string): boolean {
  const id = base.toLowerCase();
  return /gpt-5\.4/.test(id) || id.includes("codex-max");
}
