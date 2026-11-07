import { CLAUDE_CODE_BASE_URL, isClaudeCodeBase, type AiProvider } from "@locus/shared";
import { cursorCliSpawnFailureMessage } from "@locus/shared/windowsCliSpawn";
import { ProviderError, type TokenUsageEvent } from "./types.js";
import type { CursorCliEvent, CursorCliSpawner } from "./cursorCli.js";
import { spawnCursorCli } from "./cursorCli.js";

const CLI_TOOL_NAMES: Record<string, string> = {
  Read: "file_read",
  Write: "file_write",
  Edit: "apply_patch",
  MultiEdit: "apply_patch",
  NotebookEdit: "apply_patch",
  Bash: "exec",
  Grep: "grep",
  Glob: "glob",
  LS: "file_list",
  Delete: "file_write",
  WebSearch: "websearch",
  WebFetch: "webfetch",
  TodoWrite: "task_list",
};

export const CLAUDE_CODE_WEB_TOOLS = "WebSearch,WebFetch";
/** Project MCP file Claude Code loads (`type: http` Locus session server). */
export const CLAUDE_CODE_MCP_CONFIG = ".mcp.json";

export type ClaudeCodeSpawner = CursorCliSpawner;
export type ClaudeCodeEvent = CursorCliEvent;

export type ClaudeCodeAuthMode = "claude.ai" | "api-key" | "missing";

export type ClaudeCodeHealth = {
  ok: boolean;
  command: string;
  version?: string;
  authenticated: boolean;
  authMode: ClaudeCodeAuthMode;
  message?: string;
};

type ParsedClaudeCodeEvent = ClaudeCodeEvent & { partial?: boolean };

export interface ClaudeCodeArgv {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

const CLAUDE_HEALTH_TIMEOUT_MS = 5_000;

export function resolveClaudeCodeCommand(
  provider: Pick<AiProvider, "baseUrl">,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; prefixArgs: string[] } {
  const explicit = provider.baseUrl?.trim();
  if (explicit && isClaudeCodeBinaryPath(explicit)) {
    return { command: explicit, prefixArgs: [] };
  }
  const fromEnv = (env.LOCUS_CLAUDE_CODE ?? env.CLAUDE_CODE ?? "").trim();
  if (fromEnv) return { command: fromEnv, prefixArgs: [] };
  return { command: "claude", prefixArgs: [] };
}

function isClaudeCodeBinaryPath(value: string): boolean {
  if (!value || isClaudeCodeBase(value) || value === CLAUDE_CODE_BASE_URL) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.includes("://")) return false;
  return Boolean(value);
}

export function claudeCodeDisallowedTools(input: {
  webSearch?: boolean;
  review?: boolean;
}): string | undefined {
  const parts: string[] = [];
  if (input.webSearch !== true) parts.push(CLAUDE_CODE_WEB_TOOLS);
  if (input.review) parts.push("Write,Edit,MultiEdit,Bash");
  return parts.length ? parts.join(",") : undefined;
}

export function buildClaudeCodeArgv(input: {
  provider: Pick<AiProvider, "baseUrl" | "apiKey" | "extraHeaders">;
  prompt: string;
  workspace: string;
  model?: string;
  resume?: string;
  mode?: "agent" | "plan";
  webSearch?: boolean;
  review?: boolean;
  env?: NodeJS.ProcessEnv;
}): ClaudeCodeArgv {
  const env = input.env ?? process.env;
  const { command, prefixArgs } = resolveClaudeCodeCommand(input.provider, env);
  const args = [
    ...prefixArgs,
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--dangerously-skip-permissions",
    "--mcp-config",
    CLAUDE_CODE_MCP_CONFIG,
  ];
  const model = input.model?.trim();
  if (model) args.push("--model", model);
  if (input.mode === "plan") args.push("--permission-mode", "plan");
  const disallowed = claudeCodeDisallowedTools({
    webSearch: input.webSearch,
    review: input.review,
  });
  if (disallowed) args.push("--disallowedTools", disallowed);
  const resume = input.resume?.trim();
  if (resume) args.push("--resume", resume);
  args.push(input.prompt);
  const apiKey = input.provider.apiKey?.trim();
  return {
    command,
    args,
    cwd: input.workspace,
    env: {
      ...env,
      ...(apiKey && !apiKey.includes("•")
        ? { ANTHROPIC_API_KEY: apiKey, CLAUDE_API_KEY: apiKey }
        : {}),
    },
  };
}

export function parseClaudeCodeEvents(line: string): ClaudeCodeEvent[] {
  return parseClaudeCodeEventsRaw(line).map(publicClaudeCodeEvent);
}

function parseClaudeCodeEventsRaw(line: string): ParsedClaudeCodeEvent[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return [];
  let data: unknown;
  try {
    data = JSON.parse(trimmed) as unknown;
  } catch {
    return [];
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const row = data as Record<string, unknown>;
  const type = typeof row.type === "string" ? row.type : "";
  if (type === "stream_event") {
    return parseStreamEvent(row);
  }
  if (type === "system") {
    const sessionId = sessionIdFromRow(row);
    return sessionId ? [{ type: "session", sessionId }] : [];
  }
  if (type === "assistant") {
    const events: ClaudeCodeEvent[] = [];
    const message = asRecord(row.message);
    const parts = Array.isArray(message?.content) ? message.content : [];
    const thinking = parts
      .map((part) => {
        const rec = asRecord(part);
        return rec && typeof rec.thinking === "string" ? rec.thinking : "";
      })
      .join("");
    if (thinking) events.push({ type: "reasoning", text: thinking });
    const text = parts
      .map((part) => {
        const rec = asRecord(part);
        return rec && rec.type === "text" && typeof rec.text === "string" ? rec.text : "";
      })
      .join("");
    if (text) events.push({ type: "text", text });
    for (const part of parts) {
      const rec = asRecord(part);
      if (!rec || rec.type !== "tool_use") continue;
      const id = typeof rec.id === "string" ? rec.id : "";
      const name = typeof rec.name === "string" ? rec.name : "tool";
      events.push({
        type: "tool_call",
        id: id || name,
        name: CLI_TOOL_NAMES[name] ?? name,
        status: "running",
        arguments: mapClaudeToolArgs(name, asObject(rec.input)),
      });
    }
    return events;
  }
  if (type === "user") {
    const events: ClaudeCodeEvent[] = [];
    const message = asRecord(row.message);
    const parts = Array.isArray(message?.content) ? message.content : [];
    for (const part of parts) {
      const rec = asRecord(part);
      if (!rec || rec.type !== "tool_result") continue;
      const id = typeof rec.tool_use_id === "string" ? rec.tool_use_id : "";
      if (!id) continue;
      events.push({
        type: "tool_call",
        id,
        name: "tool",
        status: "completed",
        arguments: {},
        result: stringifyResult(rec.content),
      });
    }
    return events;
  }
  if (type === "result") {
    const text = typeof row.result === "string" ? row.result : undefined;
    const error =
      row.is_error === true || row.subtype === "error"
        ? text?.trim() || "Claude Code failed"
        : undefined;
    if (error) return [{ type: "error", message: error }];
    const usage = readUsage(row);
    return [
      {
        type: "result",
        status: "FINISHED",
        text,
        durationMs:
          typeof row.duration_ms === "number" && Number.isFinite(row.duration_ms)
            ? row.duration_ms
            : undefined,
        ...(usage ? { usage } : {}),
      },
    ];
  }
  if (type === "error") {
    const message =
      (typeof row.message === "string" && row.message.trim()) ||
      (typeof row.result === "string" && row.result.trim()) ||
      "Claude Code stream error";
    return [{ type: "error", message }];
  }
  return [];
}

function parseStreamEvent(row: Record<string, unknown>): ParsedClaudeCodeEvent[] {
  const event = asRecord(row.event);
  const delta = asRecord(event?.delta) ?? asRecord(row.delta);
  if (!delta) return [];
  const deltaType = typeof delta.type === "string" ? delta.type : "";
  if (deltaType === "text_delta" && typeof delta.text === "string" && delta.text) {
    return [{ type: "text", text: delta.text, partial: true }];
  }
  const thinking =
    (typeof delta.thinking === "string" && delta.thinking) ||
    (deltaType === "thinking_delta" && typeof delta.text === "string" && delta.text) ||
    "";
  if (deltaType === "thinking_delta" && thinking) {
    return [{ type: "reasoning", text: thinking, partial: true }];
  }
  return [];
}

function publicClaudeCodeEvent(event: ParsedClaudeCodeEvent): ClaudeCodeEvent {
  const rest = { ...event };
  delete rest.partial;
  return rest;
}

export function parseClaudeCodeLine(line: string): ClaudeCodeEvent | undefined {
  return parseClaudeCodeEvents(line)[0];
}

export async function* streamClaudeCode(input: {
  provider: AiProvider;
  prompt: string;
  workspace: string;
  model?: string;
  resume?: string;
  mode?: "agent" | "plan";
  webSearch?: boolean;
  review?: boolean;
  signal?: AbortSignal;
  spawnFn?: ClaudeCodeSpawner;
}): AsyncGenerator<ClaudeCodeEvent> {
  const argv = buildClaudeCodeArgv(input);
  const spawnFn = input.spawnFn ?? spawnClaudeCode;
  let handle;
  try {
    handle = spawnFn({
      command: argv.command,
      args: argv.args,
      cwd: argv.cwd,
      env: argv.env,
      signal: input.signal,
    });
  } catch (err) {
    throw rewriteSpawnError(err, argv.command);
  }
  let streamedText = false;
  let streamedReasoning = false;
  let sawTerminal = false;
  const toolNames = new Map<string, string>();
  try {
    for await (const line of handle.lines) {
      if (input.signal?.aborted) break;
      const events = parseClaudeCodeEventsRaw(line);
      for (const event of events) {
        if (event.type === "tool_call" && event.id) {
          if (event.status === "running" && event.name && event.name !== "tool") {
            toolNames.set(event.id, event.name);
          } else if (event.status === "completed") {
            event.name = toolNames.get(event.id) ?? event.name;
          }
        }
        if (event.type === "text" && !event.partial && streamedText) continue;
        if (event.type === "reasoning" && !event.partial && streamedReasoning) continue;
        if (event.type === "text") streamedText = true;
        if (event.type === "reasoning") streamedReasoning = true;
        const published = publicClaudeCodeEvent(event);
        if (published.type === "result" && published.text && streamedText) {
          yield { ...published, text: undefined };
        } else {
          yield published;
        }
        if (published.type === "result" || published.type === "error") {
          sawTerminal = true;
        }
      }
      if (sawTerminal) break;
    }
    const done = await handle.wait();
    if (!sawTerminal && !input.signal?.aborted && done.code !== 0) {
      const detail = done.stderr.trim() || `exit ${done.code}`;
      yield { type: "error", message: `Claude Code failed: ${detail}` };
    }
    yield { type: "done" };
  } catch (err) {
    throw rewriteSpawnError(err, argv.command);
  } finally {
    handle.kill?.();
  }
}

export function spawnClaudeCode(req: Parameters<ClaudeCodeSpawner>[0]) {
  return spawnCursorCli(req);
}

export async function listClaudeCodeModels(provider: AiProvider): Promise<string[]> {
  const models = provider.models.filter((id) => id.trim());
  return models.length ? [...models] : ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"];
}

export async function checkClaudeCode(
  provider: Pick<AiProvider, "baseUrl" | "apiKey">,
  spawnFn: ClaudeCodeSpawner = spawnClaudeCode,
): Promise<ClaudeCodeHealth> {
  const { command, prefixArgs } = resolveClaudeCodeCommand(provider);
  // Health checks run an executable selected by configuration. Never expose a
  // provider secret to that executable, even when it is a custom wrapper.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDE_API_KEY;
  const versionProbe = await runClaudeProbe(spawnFn, {
    command,
    args: [...prefixArgs, "--version"],
    cwd: process.cwd(),
    env,
  });
  const version =
    parseClaudeVersion(versionProbe.stdout) ?? parseClaudeVersion(versionProbe.stderr);
  if (versionProbe.code !== 0) {
    return {
      ok: false,
      command,
      ...(version ? { version } : {}),
      authenticated: false,
      authMode: "missing",
      message: `Claude Code is unavailable or failed its version check. Install from code.claude.com and ensure \`${command}\` is on PATH.`,
    };
  }

  const hasApiKey = Boolean(provider.apiKey?.trim() && !provider.apiKey.includes("•"));
  if (hasApiKey) {
    return {
      ok: true,
      command,
      ...(version ? { version } : {}),
      authenticated: false,
      authMode: "api-key",
    };
  }

  const loginProbe = await runClaudeProbe(spawnFn, {
    command,
    args: [...prefixArgs, "auth", "status"],
    cwd: process.cwd(),
    env,
  });
  if (loginProbe.code === 0) {
    const authMode = parseClaudeAuthMethod(`${loginProbe.stdout}\n${loginProbe.stderr}`);
    return {
      ok: true,
      command,
      ...(version ? { version } : {}),
      authenticated: true,
      authMode: authMode === "missing" ? "claude.ai" : authMode,
    };
  }
  return {
    ok: false,
    command,
    ...(version ? { version } : {}),
    authenticated: false,
    authMode: "missing",
    message: "Claude Code is not authenticated. Run `claude auth login` or paste an API key.",
  };
}

async function runClaudeProbe(
  spawnFn: ClaudeCodeSpawner,
  req: Parameters<ClaudeCodeSpawner>[0],
): Promise<{ code: number; stdout: string; stderr: string }> {
  let handle;
  try {
    handle = spawnFn(req);
  } catch (err) {
    throw rewriteSpawnError(err, req.command);
  }
  try {
    const lines: string[] = [];
    const collect = (async () => {
      for await (const line of handle.lines) lines.push(line);
      return handle.wait();
    })();
    const result = await Promise.race([
      collect,
      delay(CLAUDE_HEALTH_TIMEOUT_MS).then(() => {
        throw new ProviderError("Claude Code health check timed out.");
      }),
    ]);
    return { code: result.code, stdout: lines.join("\n"), stderr: result.stderr };
  } catch (err) {
    throw rewriteSpawnError(err, req.command);
  } finally {
    handle.kill?.();
  }
}

function parseClaudeVersion(text: string): string | undefined {
  const match = text.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/);
  return match?.[1];
}

function parseClaudeAuthMethod(text: string): ClaudeCodeAuthMode {
  const json = parseJsonObject(text);
  const method =
    (typeof json?.authMethod === "string" && json.authMethod) ||
    (typeof json?.auth_method === "string" && json.auth_method) ||
    "";
  if (method === "api_key" || method === "api_key_helper") return "api-key";
  if (method === "claude.ai" || method === "oauth_token" || method === "third_party") {
    return "claude.ai";
  }
  if (method === "none") return "missing";
  if (/(?:not|no)\s+(?:logged|auth)|logged\s+out|authentication\s+required/i.test(text)) {
    return "missing";
  }
  if (/logged\s+in|authenticated|claude\.ai/i.test(text)) return "claude.ai";
  return "missing";
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  for (const chunk of text.split(/\n+/)) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* keep scanning */
    }
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function sessionIdFromRow(row: Record<string, unknown>): string | undefined {
  const id =
    (typeof row.session_id === "string" && row.session_id.trim()) ||
    (typeof row.sessionId === "string" && row.sessionId.trim()) ||
    "";
  return id || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

function mapClaudeToolArgs(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const path =
    (typeof input.file_path === "string" && input.file_path) ||
    (typeof input.path === "string" && input.path) ||
    undefined;
  if (name === "Read" || name === "Write" || name === "LS" || name === "Delete") {
    return path ? { ...input, path } : input;
  }
  if (name === "Grep") {
    return {
      pattern: input.pattern ?? input.query,
      path: input.path,
      glob: input.glob,
    };
  }
  return input;
}

function stringifyResult(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readUsage(row: Record<string, unknown>): TokenUsageEvent | undefined {
  const usage = asRecord(row.usage);
  if (!usage) return undefined;
  const input = num(usage.input_tokens) ?? num(usage.inputTokens) ?? num(row.input_tokens);
  const output = num(usage.output_tokens) ?? num(usage.outputTokens) ?? num(row.output_tokens);
  if (input == null && output == null) return undefined;
  return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function rewriteSpawnError(err: unknown, command: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const message = cursorCliSpawnFailureMessage(err, command)
    .replace(/Cursor CLI/g, "Claude Code")
    .replace("cursor.com/install", "code.claude.com")
    .replace("cursor-agent.cmd", "claude");
  return new ProviderError(message);
}
