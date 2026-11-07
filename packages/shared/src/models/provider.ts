import { isLoopbackHost } from "../security.js";

export type ProviderKind =
  | "openai"
  | "anthropic"
  | "xai"
  | "deepseek"
  | "cursor"
  | "cursor-cli"
  | "claude-code"
  | "codex-cli"
  | "kiro-cli"
  | "opencode"
  | "openrouter"
  | "openai-compatible";

export interface AiProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  defaultModel: string;
  enabled: boolean;
  extraHeaders: Record<string, string>;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  /** AWS access key id when the base URL needs SigV4 (Bedrock / API Gateway). Secret is `apiKey`. */
  accessKeyId?: string;
}

export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const OPENCODE_FREE_MODELS = [
  "big-pickle",
  "x-preview-f-free",
  "deepseek-v4-flash-free",
  "muse-spark-1.2-contributor-free",
  "mimo-v2.5-free",
  "hy3-free",
  "laguna-s-2.1-free",
  "nemotron-3.5-lightning-free",
  "nemotron-3-ultra-free",
];
export const OPENCODE_DEFAULT_MODEL = "big-pickle";
export const CURSOR_CLOUD_BASE_URL = "https://api.cursor.com/v1";
export const CURSOR_CLI_BASE_URL = "cursor-cli://local";
export const CLAUDE_CODE_BASE_URL = "claude-code://local";
export const CODEX_CLI_BASE_URL = "codex-cli://local";
export const KIRO_CLI_BASE_URL = "kiro-cli://local";
/** Models Kiro CLI currently exposes for Auto and the active Claude catalog. */
export const KIRO_CLI_MODELS = [
  "auto",
  "claude-sonnet-5.5",
  "claude-opus-5.5",
  "claude-sonnet-4.5",
];
export const KIRO_CLI_DEFAULT_MODEL = "auto";
/** Models currently exposed by Codex CLI to ChatGPT-account sessions. */
export const CODEX_CLI_MODELS = [
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
];
export const CODEX_CLI_DEFAULT_MODEL = "gpt-6-astra";
export type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export const CODEX_REASONING_EFFORTS: CodexReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

const LEGACY_CODEX_CLI_MODELS = new Set(["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex"]);

export function normalizeCodexCliModel(model: string): string {
  const normalized = model.trim().toLowerCase();
  return LEGACY_CODEX_CLI_MODELS.has(normalized) ? CODEX_CLI_MODELS[0]! : model.trim();
}

export function codexCliReasoningEfforts(model: string): CodexReasoningEffort[] {
  const normalized = normalizeCodexCliModel(model).toLowerCase();
  if (normalized === "gpt-5.5") return ["low", "medium", "high", "xhigh"];
  if (normalized === "gpt-5.6-luna") return ["low", "medium", "high", "xhigh", "max"];
  if (CODEX_CLI_MODELS.includes(normalized)) return [...CODEX_REASONING_EFFORTS];
  return [];
}

export function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return (
    typeof value === "string" && CODEX_REASONING_EFFORTS.includes(value as CodexReasoningEffort)
  );
}
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_APP_URL = "https://github.com/Modsofthenation/Locus";
export const OPENROUTER_APP_TITLE = "Locus";
const OPENCODE_STOCK_LOCAL_BASE = "http://127.0.0.1:4096/v1";

const OPENCODE_PROVIDER: Omit<AiProvider, "id" | "apiKey"> = {
  name: "OpenCode",
  kind: "opencode",
  baseUrl: OPENCODE_ZEN_BASE_URL,
  models: [...OPENCODE_FREE_MODELS],
  defaultModel: OPENCODE_DEFAULT_MODEL,
  enabled: false,
  extraHeaders: {},
  inputUsdPerMillion: 0,
  outputUsdPerMillion: 0,
};

export const BUILTIN_PROVIDERS: Omit<AiProvider, "id" | "apiKey">[] = [
  OPENCODE_PROVIDER,
  {
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4.1", "gpt-4.1-mini", "o4-mini"],
    defaultModel: "gpt-4.1",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
    defaultModel: "claude-sonnet-4-5",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Grok (xAI)",
    kind: "xai",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-4", "grok-3", "grok-3-mini"],
    defaultModel: "grok-4",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "DeepSeek",
    kind: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Cursor Cloud",
    kind: "cursor",
    baseUrl: CURSOR_CLOUD_BASE_URL,
    models: ["composer-2", "auto-smart", "claude-sonnet-4-5", "gpt-5"],
    defaultModel: "composer-2",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Cursor CLI",
    kind: "cursor-cli",
    baseUrl: CURSOR_CLI_BASE_URL,
    models: ["composer-2", "auto", "claude-sonnet-4-5", "gpt-5"],
    defaultModel: "composer-2",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Claude Code",
    kind: "claude-code",
    baseUrl: CLAUDE_CODE_BASE_URL,
    models: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
    defaultModel: "claude-sonnet-4-5",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Codex CLI",
    kind: "codex-cli",
    baseUrl: CODEX_CLI_BASE_URL,
    models: [...CODEX_CLI_MODELS],
    defaultModel: CODEX_CLI_DEFAULT_MODEL,
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Kiro CLI",
    kind: "kiro-cli",
    baseUrl: KIRO_CLI_BASE_URL,
    models: [...KIRO_CLI_MODELS],
    defaultModel: KIRO_CLI_DEFAULT_MODEL,
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "OpenRouter",
    kind: "openrouter",
    baseUrl: OPENROUTER_BASE_URL,
    models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4.1", "google/gemini-2.5-flash"],
    defaultModel: "anthropic/claude-sonnet-4.5",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Ollama",
    kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: ["llama3.2", "qwen2.5", "mistral"],
    defaultModel: "llama3.2",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Gemini",
    kind: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    defaultModel: "gemini-2.5-flash",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
    defaultModel: "llama-3.3-70b-versatile",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Mistral",
    kind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest"],
    defaultModel: "mistral-small-latest",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Together",
    kind: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Amazon Bedrock",
    kind: "openai-compatible",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
    models: [],
    defaultModel: "",
    enabled: false,
    extraHeaders: {},
  },
  {
    name: "Fireworks",
    kind: "openai-compatible",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    models: [
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/kimi-k2-instruct",
    ],
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    enabled: false,
    extraHeaders: {},
  },
];

export function hasUsableKey(apiKey?: string, baseUrl?: string, kind?: string): boolean {
  if (kind === "cursor-cli" || isCursorCliBase(baseUrl)) return true;
  if (kind === "claude-code" || isClaudeCodeBase(baseUrl)) return true;
  if (kind === "codex-cli" || isCodexCliBase(baseUrl)) return true;
  if (kind === "kiro-cli" || isKiroCliBase(baseUrl)) return true;
  if (isLocalOpenAiBase(baseUrl)) return true;
  return Boolean(apiKey && apiKey.trim() && !apiKey.includes("•"));
}

export function isLocalOpenAiBase(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  try {
    return isLoopbackHost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

/** Default Ollama OpenAI-compatible port. Custom installs still match on provider name. */
export const OLLAMA_DEFAULT_PORT = "11434";
/** Keep the weights resident between turns so the next prompt is not another cold load. */
export const OLLAMA_KEEP_ALIVE = "30m";

export function isOllamaBase(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    if (!isLoopbackHost(url.hostname)) return false;
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return port === OLLAMA_DEFAULT_PORT;
  } catch {
    return false;
  }
}

export function isOllamaProvider(provider: { name?: string; baseUrl?: string }): boolean {
  if (provider.name?.trim().toLowerCase() === "ollama") return true;
  return isOllamaBase(provider.baseUrl);
}

export function isOpenRouterBase(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
}

export function isOpenRouterProvider(provider: { kind?: string; baseUrl?: string }): boolean {
  return provider.kind === "openrouter" || isOpenRouterBase(provider.baseUrl);
}

export function isCursorCloudBase(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "api.cursor.com" || host === "api2.cursor.sh";
  } catch {
    return false;
  }
}

export function isCursorProvider(provider: { kind?: string; baseUrl?: string }): boolean {
  if (isCursorCliProvider(provider)) return false;
  return provider.kind === "cursor" || isCursorCloudBase(provider.baseUrl);
}

export function isCursorCliBase(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  const trimmed = baseUrl.trim();
  if (!trimmed) return false;
  try {
    return new URL(trimmed).protocol === "cursor-cli:";
  } catch {
    return false;
  }
}

export function isCursorCliProvider(provider: { kind?: string; baseUrl?: string }): boolean {
  return provider.kind === "cursor-cli" || isCursorCliBase(provider.baseUrl);
}

export function isClaudeCodeBase(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  const trimmed = baseUrl.trim();
  if (!trimmed) return false;
  try {
    return new URL(trimmed).protocol === "claude-code:";
  } catch {
    return false;
  }
}

export function isClaudeCodeProvider(provider: { kind?: string; baseUrl?: string }): boolean {
  return provider.kind === "claude-code" || isClaudeCodeBase(provider.baseUrl);
}

export function isCodexCliBase(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  const trimmed = baseUrl.trim();
  if (!trimmed) return false;
  try {
    return new URL(trimmed).protocol === "codex-cli:";
  } catch {
    return false;
  }
}

export function isCodexCliProvider(provider: { kind?: string; baseUrl?: string }): boolean {
  return provider.kind === "codex-cli" || isCodexCliBase(provider.baseUrl);
}

export function isKiroCliBase(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  const trimmed = baseUrl.trim();
  if (!trimmed) return false;
  try {
    return new URL(trimmed).protocol === "kiro-cli:";
  } catch {
    return false;
  }
}

export function isKiroCliProvider(provider: { kind?: string; baseUrl?: string }): boolean {
  return provider.kind === "kiro-cli" || isKiroCliBase(provider.baseUrl);
}

export function isLocalAgentCliProvider(provider: { kind?: string; baseUrl?: string }): boolean {
  return (
    isCursorCliProvider(provider) ||
    isClaudeCodeProvider(provider) ||
    isCodexCliProvider(provider) ||
    isKiroCliProvider(provider)
  );
}

export function builtinProviderKey(provider: Pick<AiProvider, "kind" | "name">): string {
  return provider.kind === "openai-compatible"
    ? `${provider.kind}:${provider.name}`
    : provider.kind;
}

export function mergeBuiltinProviders(
  existing: AiProvider[],
  builtins: AiProvider[] = BUILTIN_PROVIDERS.map((p) => ({
    ...p,
    id: builtinProviderKey(p),
    apiKey: "",
  })),
): AiProvider[] {
  const next = existing.map((provider) =>
    mergeOpenCodeFreeModels(
      migrateStockCodex(migrateStockOpenCode(migrateStockOpenRouter(migrateStockCursor(provider)))),
    ),
  );
  const unique: AiProvider[] = [];
  const seen = new Set<string>();
  for (const provider of next) {
    const key = builtinProviderKey(provider);
    if (provider.kind !== "openai-compatible" && seen.has(key)) continue;
    seen.add(key);
    unique.push(provider);
  }
  for (const builtin of builtins) {
    const key = builtinProviderKey(builtin);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...builtin, id: key });
  }
  return unique;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function migrateStockCursor(provider: AiProvider): AiProvider {
  if (!isCursorCloudBase(provider.baseUrl)) return provider;
  const base = normalizeBaseUrl(provider.baseUrl);
  if (base === CURSOR_CLOUD_BASE_URL && provider.kind === "cursor") return provider;
  return { ...provider, kind: "cursor", baseUrl: CURSOR_CLOUD_BASE_URL };
}

function migrateStockCodex(provider: AiProvider): AiProvider {
  if (!isCodexCliProvider(provider)) return provider;
  const isLegacyStock =
    LEGACY_CODEX_CLI_MODELS.has(provider.defaultModel) ||
    provider.models.some((model) => LEGACY_CODEX_CLI_MODELS.has(model));
  if (!isLegacyStock) return provider;
  const models = [
    ...provider.models.filter((model) => !LEGACY_CODEX_CLI_MODELS.has(model)),
    ...CODEX_CLI_MODELS.filter((model) => !provider.models.includes(model)),
  ];
  return {
    ...provider,
    models,
    defaultModel: LEGACY_CODEX_CLI_MODELS.has(provider.defaultModel)
      ? CODEX_CLI_DEFAULT_MODEL
      : provider.defaultModel,
  };
}

function migrateStockOpenRouter(provider: AiProvider): AiProvider {
  if (provider.kind === "openrouter") return provider;
  if (provider.kind !== "openai-compatible") return provider;
  if (!isOpenRouterBase(provider.baseUrl)) return provider;
  return { ...provider, kind: "openrouter" };
}

function migrateStockOpenCode(provider: AiProvider): AiProvider {
  if (provider.kind !== "opencode") return provider;
  const unusedStock =
    !provider.enabled &&
    !(provider.apiKey ?? "").trim() &&
    normalizeBaseUrl(provider.baseUrl) === OPENCODE_STOCK_LOCAL_BASE &&
    provider.defaultModel === "opencode";
  if (!unusedStock) return provider;
  return {
    ...provider,
    ...OPENCODE_PROVIDER,
  };
}

function mergeOpenCodeFreeModels(provider: AiProvider): AiProvider {
  if (provider.kind !== "opencode") return provider;
  if (normalizeBaseUrl(provider.baseUrl) !== OPENCODE_ZEN_BASE_URL) return provider;
  const models = [...provider.models];
  for (const model of OPENCODE_FREE_MODELS) {
    if (!models.includes(model)) models.push(model);
  }
  const defaultModel = models.includes(provider.defaultModel)
    ? provider.defaultModel
    : (models[0] ?? provider.defaultModel);
  return { ...provider, models, defaultModel };
}
