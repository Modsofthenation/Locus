import {
  hasUsableKey,
  isClaudeCodeProvider,
  isCodexCliProvider,
  isCursorCliProvider,
  isCursorProvider,
  isKiroCliProvider,
  type AiProvider,
} from "@locus/shared";
import { checkClaudeCode, listClaudeCodeModels } from "./claudeCode.js";
import { checkCodexCli, listCodexCliModels } from "./codexCli.js";
import { checkKiroCli, listKiroCliModels } from "./kiroCli.js";
import { listCursorCliModels, type CursorCliSpawner } from "./cursorCli.js";
import { openAiSignedHeaders } from "./openai.js";
import { ProviderError, type FetchFn } from "./types.js";

export async function listProviderModels(
  provider: AiProvider,
  fetchFn: FetchFn = fetch,
  spawnFn?: CursorCliSpawner,
): Promise<string[]> {
  if (isCursorCliProvider(provider)) {
    return listCursorCliModels(provider, spawnFn);
  }
  if (isClaudeCodeProvider(provider)) {
    return listClaudeCodeModels(provider);
  }
  if (isCodexCliProvider(provider)) {
    return listCodexCliModels(provider);
  }
  if (isKiroCliProvider(provider)) {
    return listKiroCliModels(provider);
  }
  if (!hasUsableKey(provider.apiKey, provider.baseUrl, provider.kind)) {
    throw new ProviderError("Provider API key is not set");
  }
  const base = provider.baseUrl.replace(/\/+$/, "");
  const anthropic = provider.kind === "anthropic";
  const url = anthropic ? `${base}/v1/models` : `${base}/models`;
  const res = await fetchFn(url, {
    headers: anthropic
      ? {
          "x-api-key": provider.apiKey ?? "",
          "anthropic-version": "2023-06-01",
          ...provider.extraHeaders,
        }
      : openAiSignedHeaders(provider, url, { method: "GET" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderError(text || `Provider HTTP ${res.status}`, res.status);
  }
  const json = (await res.json()) as unknown;
  return parseModelIds(json);
}

export function parseModelIds(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const obj = json as { data?: unknown; items?: unknown };
  const rows = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.items) ? obj.items : [];
  return [
    ...new Set(
      rows
        .map((row) =>
          row && typeof row === "object" && "id" in row && typeof row.id === "string"
            ? row.id
            : undefined,
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ].sort();
}

export function cursorMissingCompletionsError(kind?: string): ProviderError {
  if (kind === "cursor-cli") {
    return new ProviderError(
      "Cursor CLI has no OpenAI-compatible POST /v1/chat/completions. Chat turns spawn the local `agent` CLI (`agent -p`). Refresh models uses `agent models`.",
      404,
    );
  }
  if (kind === "claude-code") {
    return new ProviderError(
      "Claude Code has no OpenAI-compatible POST /v1/chat/completions. Chat turns spawn the local `claude` CLI (`claude -p` print / headless mode). Test connection uses `claude --version` and `claude auth status`.",
      404,
    );
  }
  if (kind === "codex-cli") {
    return new ProviderError(
      "Codex CLI has no OpenAI-compatible POST /v1/chat/completions. Chat turns spawn the local `codex exec --json` CLI.",
      404,
    );
  }
  if (kind === "kiro-cli") {
    return new ProviderError(
      "Kiro CLI has no OpenAI-compatible POST /v1/chat/completions. Chat turns spawn the local `kiro-cli chat --no-interactive --output-format stream-json` CLI. Test connection uses `kiro-cli --version` and `kiro-cli whoami`.",
      404,
    );
  }
  return new ProviderError(
    "Cursor Cloud has no OpenAI-compatible POST /v1/chat/completions. Chat turns use the Cloud Agents API (POST /v1/agents). Refresh models uses GET /v1/models.",
    404,
  );
}

export function rewriteCursorCompletionsError(
  provider: Pick<AiProvider, "kind" | "baseUrl">,
  err: unknown,
): unknown {
  if (!isCursorProvider(provider)) return err;
  if (!(err instanceof ProviderError) || err.status !== 404) return err;
  if (!/chat\/completions|Route POST:/i.test(err.message)) return err;
  return cursorMissingCompletionsError();
}

export async function testProvider(
  provider: AiProvider,
  fetchFn: FetchFn = fetch,
  spawnFn?: CursorCliSpawner,
): Promise<{
  ok: true;
  models: number;
  version?: string;
  authMode?: string;
  command?: string;
  scope?: "control-plane";
}> {
  if (isCodexCliProvider(provider)) {
    const health = await checkCodexCli(provider, spawnFn);
    if (!health.ok) throw new ProviderError(health.message ?? "Codex CLI health check failed");
    return {
      ok: true,
      models: (await listCodexCliModels(provider)).length,
      ...(health.version ? { version: health.version } : {}),
      authMode: health.authMode,
      command: health.command,
      scope: "control-plane",
    };
  }
  if (isClaudeCodeProvider(provider)) {
    const health = await checkClaudeCode(provider, spawnFn);
    if (!health.ok) throw new ProviderError(health.message ?? "Claude Code health check failed");
    return {
      ok: true,
      models: (await listClaudeCodeModels(provider)).length,
      ...(health.version ? { version: health.version } : {}),
      authMode: health.authMode,
      command: health.command,
      scope: "control-plane",
    };
  }
  if (isKiroCliProvider(provider)) {
    const health = await checkKiroCli(provider, spawnFn);
    if (!health.ok) throw new ProviderError(health.message ?? "Kiro CLI health check failed");
    return {
      ok: true,
      models: (await listKiroCliModels(provider)).length,
      ...(health.version ? { version: health.version } : {}),
      authMode: health.authMode,
      command: health.command,
      scope: "control-plane",
    };
  }
  const models = await listProviderModels(provider, fetchFn);
  return { ok: true, models: models.length };
}
