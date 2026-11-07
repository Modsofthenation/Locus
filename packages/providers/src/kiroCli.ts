import { KIRO_CLI_BASE_URL, KIRO_CLI_MODELS, isKiroCliBase, type AiProvider } from "@locus/shared";
import { cursorCliSpawnFailureMessage } from "@locus/shared/windowsCliSpawn";
import { ProviderError, type TokenUsageEvent } from "./types.js";
import type { CursorCliEvent, CursorCliSpawner } from "./cursorCli.js";
import { spawnCursorCli } from "./cursorCli.js";

const CLI_TOOL_NAMES: Record<string, string> = {
  Read: "file_read",
  read: "file_read",
  read_file: "file_read",
  fsRead: "file_read",
  fs_read: "file_read",
  Write: "file_write",
  write: "file_write",
  write_file: "file_write",
  fsWrite: "file_write",
  fs_write: "file_write",
  Edit: "apply_patch",
  edit: "apply_patch",
  strReplace: "apply_patch",
  str_replace: "apply_patch",
  MultiEdit: "apply_patch",
  NotebookEdit: "apply_patch",
  Bash: "exec",
  bash: "exec",
  execute_bash: "exec",
  shell: "exec",
  executeCommand: "exec",
  execute_command: "exec",
  execute: "exec",
  Grep: "grep",
  grep: "grep",
  grep_search: "grep",
  Glob: "glob",
  glob: "glob",
  glob_search: "glob",
  LS: "file_list",
  ls: "file_list",
  list_dir: "file_list",
  Delete: "file_write",
  WebSearch: "websearch",
  web_search: "websearch",
  WebFetch: "webfetch",
  web_fetch: "webfetch",
  TodoWrite: "task_list",
  todo_write: "task_list",
};

export type KiroCliSpawner = CursorCliSpawner;
export type KiroCliEvent = CursorCliEvent;

export type KiroCliAuthMode = "account" | "api-key" | "missing";

export type KiroCliHealth = {
  ok: boolean;
  command: string;
  version?: string;
  authenticated: boolean;
  authMode: KiroCliAuthMode;
  message?: string;
};

type ParsedKiroCliEvent = KiroCliEvent & { partial?: boolean };

export interface KiroCliArgv {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

const KIRO_HEALTH_TIMEOUT_MS = 5_000;

export function resolveKiroCliCommand(
  provider: Pick<AiProvider, "baseUrl">,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; prefixArgs: string[] } {
  const explicit = provider.baseUrl?.trim();
  if (explicit && isKiroCliBinaryPath(explicit)) {
    return { command: explicit, prefixArgs: [] };
  }
  const fromEnv = (env.LOCUS_KIRO_CLI ?? env.KIRO_CLI ?? "").trim();
  if (fromEnv) return { command: fromEnv, prefixArgs: [] };
  return { command: "kiro-cli", prefixArgs: [] };
}

function isKiroCliBinaryPath(value: string): boolean {
  if (!value || isKiroCliBase(value) || value === KIRO_CLI_BASE_URL) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.includes("://")) return false;
  return Boolean(value);
}

export function buildKiroCliArgv(input: {
  provider: Pick<AiProvider, "baseUrl" | "apiKey" | "extraHeaders">;
  prompt: string;
  workspace: string;
  model?: string;
  resume?: string;
  env?: NodeJS.ProcessEnv;
}): KiroCliArgv {
  const env = input.env ?? process.env;
  const { command, prefixArgs } = resolveKiroCliCommand(input.provider, env);
  // `--v3` is a global harness flag (`kiro-cli --v3 chat …`). Putting it after
  // `chat` is accepted on some builds and ignored on others. Do not pass
  // `--require-mcp-startup`: Locus MCP is POST JSON-RPC and Kiro V3 may wait
  // 30s then exit with no stream-json after KAS boots.
  const args = [
    ...prefixArgs,
    "--v3",
    "chat",
    "--no-interactive",
    "--trust-all-tools",
    "--output-format",
    "stream-json",
  ];
  const model = input.model?.trim();
  // V3 treats `auto` as "no override" and warns if `--model auto` is not a real id.
  if (model && model !== "auto") args.push("--model", model);
  const resume = input.resume?.trim();
  if (resume) args.push("--resume-id", resume);
  args.push(input.prompt);
  const apiKey = input.provider.apiKey?.trim();
  return {
    command,
    args,
    cwd: input.workspace,
    env: {
      ...env,
      ...(apiKey && !apiKey.includes("•") ? { KIRO_API_KEY: apiKey } : {}),
    },
  };
}

export function parseKiroCliEvents(line: string): KiroCliEvent[] {
  return parseKiroCliEventsRaw(line).map(publicKiroCliEvent);
}

function normalizeKind(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, "");
}

function rowKind(row: Record<string, unknown>): string {
  if (typeof row.type === "string" && row.type.trim()) return normalizeKind(row.type);
  if (typeof row.kind === "string" && row.kind.trim()) return normalizeKind(row.kind);
  return "";
}

function parseKiroCliEventsRaw(line: string): ParsedKiroCliEvent[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return [];
  const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!payload) return [];
  let data: unknown;
  try {
    data = JSON.parse(payload) as unknown;
  } catch {
    return [];
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const row = data as Record<string, unknown>;
  if (typeof row.jsonrpc === "string" || typeof row.method === "string") {
    return parseAcpRow(row);
  }
  const type = rowKind(row);
  if (type === "streamevent" || type === "contentblockdelta") {
    return parseStreamEvent(row);
  }
  if (typeof row.sessionUpdate === "string" || isV3SessionUpdate(type)) {
    return parseSessionUpdate(row, sessionIdFromRow(row));
  }
  const sessionId = sessionIdFromRow(row);
  const sessionEvent: ParsedKiroCliEvent[] = sessionId ? [{ type: "session", sessionId }] : [];
  if (type === "system" || type === "init" || type === "session") {
    return sessionEvent;
  }
  if (type === "text" || type === "messagedelta") {
    const text = textFromUpdate(row);
    return text
      ? [...sessionEvent, { type: "text", text, partial: type === "messagedelta" }]
      : sessionEvent;
  }
  if (
    type === "assistant" ||
    type === "assistantmessage" ||
    type === "assistantresponse" ||
    type === "assistantresponseevent"
  ) {
    return [...sessionEvent, ...parseAssistantRow(row)];
  }
  if (type === "user" || type === "toolresults") {
    return [...sessionEvent, ...parseUserRow(row)];
  }
  if (type === "prompt") return sessionEvent;
  if (type === "tooluse") {
    const tool = parseStandaloneToolUse(asRecord(row.data) ?? row);
    return tool ? [...sessionEvent, tool] : sessionEvent;
  }
  if (type === "toolresult") {
    const tool = parseStandaloneToolResult(asRecord(row.data) ?? row);
    return tool ? [...sessionEvent, tool] : sessionEvent;
  }
  if (type === "result" || type === "turncomplete" || type === "turncompleted") {
    const text = typeof row.result === "string" ? row.result : undefined;
    const error =
      row.is_error === true || row.subtype === "error"
        ? text?.trim() || "Kiro CLI failed"
        : undefined;
    if (error) return [...sessionEvent, { type: "error", message: error }];
    const usage = readUsage(row);
    return [
      ...sessionEvent,
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
  if (type === "error" || type === "interruption" || type === "interrupted") {
    const message =
      (typeof row.message === "string" && row.message.trim()) ||
      (typeof row.result === "string" && row.result.trim()) ||
      (typeof row.reason === "string" && row.reason.trim()) ||
      "Kiro CLI stream error";
    return [...sessionEvent, { type: "error", message }];
  }
  return sessionEvent;
}

function isV3SessionUpdate(type: string): boolean {
  return (
    type === "agentmessagechunk" ||
    type === "agentthoughtchunk" ||
    type === "usermessagechunk" ||
    type === "toolcall" ||
    type === "toolcallupdate" ||
    type === "sessioninfoupdate" ||
    type === "availablecommandsupdate" ||
    type === "currentmodeupdate" ||
    type === "configoptionupdate"
  );
}

function parseAcpRow(row: Record<string, unknown>): ParsedKiroCliEvent[] {
  const method = typeof row.method === "string" ? row.method : "";
  const params = asRecord(row.params);
  const result = asRecord(row.result);
  const error = asRecord(row.error);
  const sessionId =
    sessionIdFromRow(row) ||
    (params ? sessionIdFromRow(params) : undefined) ||
    (result ? sessionIdFromRow(result) : undefined);
  const sessionEvent: ParsedKiroCliEvent[] = sessionId ? [{ type: "session", sessionId }] : [];
  if (error) {
    const message =
      (typeof error.message === "string" && error.message.trim()) || "Kiro CLI stream error";
    return [...sessionEvent, { type: "error", message }];
  }
  if (isKiroAcpAuthMethod(method)) {
    return [
      ...sessionEvent,
      {
        type: "error",
        message:
          "Kiro CLI requested host-mediated ACP auth (`_kiro/auth/getAccessToken`). Headless chat cannot answer that handshake. Run `kiro-cli login` or paste a KIRO_API_KEY.",
      },
    ];
  }
  if (method !== "session/update" && method !== "session/notification") return sessionEvent;
  const update = asRecord(params?.update) ?? params;
  if (!update) return sessionEvent;
  return parseSessionUpdate(update, sessionId);
}

function parseSessionUpdate(
  update: Record<string, unknown>,
  sessionId?: string,
): ParsedKiroCliEvent[] {
  const sessionEvent: ParsedKiroCliEvent[] = sessionId ? [{ type: "session", sessionId }] : [];
  const kind = normalizeKind(
    (typeof update.sessionUpdate === "string" && update.sessionUpdate) ||
      (typeof update.type === "string" && update.type) ||
      "",
  );
  if (
    kind === "agentmessagechunk" ||
    kind === "agentmessage" ||
    kind === "messagechunk" ||
    kind === "usermessagechunk"
  ) {
    if (kind === "usermessagechunk") return sessionEvent;
    const text = textFromUpdate(update);
    return text ? [...sessionEvent, { type: "text", text, partial: true }] : sessionEvent;
  }
  if (kind === "agentthoughtchunk" || kind === "thoughtchunk" || kind === "reasoning") {
    const text = textFromUpdate(update);
    return text ? [...sessionEvent, { type: "reasoning", text, partial: true }] : sessionEvent;
  }
  if (kind === "toolcall" || kind === "toolcallupdate") {
    const tool = parseV3ToolCall(update, kind === "toolcallupdate");
    return tool ? [...sessionEvent, tool] : sessionEvent;
  }
  if (kind === "sessioninfoupdate") {
    return [...sessionEvent, ...parseSessionInfoUpdate(update)];
  }
  return sessionEvent;
}

function parseV3ToolCall(
  update: Record<string, unknown>,
  isUpdate: boolean,
): ParsedKiroCliEvent | undefined {
  const statusRaw = typeof update.status === "string" ? update.status.toLowerCase() : "";
  const completed =
    statusRaw === "completed" ||
    statusRaw === "success" ||
    statusRaw === "done" ||
    (isUpdate &&
      Boolean(update.content ?? update.result ?? update.output) &&
      statusRaw !== "pending" &&
      statusRaw !== "inprogress" &&
      statusRaw !== "running");
  const name =
    (typeof update.kind === "string" && update.kind) ||
    (typeof update.name === "string" && update.name) ||
    "tool";
  const id =
    (typeof update.toolCallId === "string" && update.toolCallId) ||
    (typeof update.tool_call_id === "string" && update.tool_call_id) ||
    (typeof update.id === "string" && update.id) ||
    name;
  return {
    type: "tool_call",
    id,
    name: CLI_TOOL_NAMES[name] ?? name,
    status: completed ? "completed" : "running",
    arguments: asObject(update.rawInput ?? update.input ?? update.arguments),
    ...(completed
      ? { result: stringifyResult(update.content ?? update.result ?? update.output) }
      : {}),
  };
}

function parseSessionInfoUpdate(update: Record<string, unknown>): ParsedKiroCliEvent[] {
  const meta = asRecord(asRecord(update._meta)?.kiro) ?? asRecord(update._meta);
  const displayError = asRecord(meta?.displayError) ?? asRecord(update.displayError);
  const kind = normalizeKind(
    (typeof meta?.kind === "string" && meta.kind) ||
      (typeof update.kind === "string" && update.kind) ||
      "",
  );
  if (kind === "displayerror" || displayError) {
    const message =
      (displayError && typeof displayError.message === "string" && displayError.message.trim()) ||
      (typeof meta?.message === "string" && meta.message.trim()) ||
      "Kiro CLI stream error";
    return [{ type: "error", message }];
  }
  return [];
}

function textFromUpdate(update: Record<string, unknown>): string {
  if (typeof update.text === "string" && update.text) return update.text;
  const content = update.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(textFromPart).join("");
  const rec = asRecord(content);
  if (!rec) return "";
  if (typeof rec.text === "string") return rec.text;
  if (typeof rec.data === "string") return rec.data;
  return "";
}

function parseAssistantRow(row: Record<string, unknown>): ParsedKiroCliEvent[] {
  const events: ParsedKiroCliEvent[] = [];
  const payload = asRecord(row.message) ?? asRecord(row.data) ?? row;
  const rawContent = payload.content ?? row.content;
  if (typeof rawContent === "string" && rawContent) {
    events.push({ type: "text", text: rawContent });
  } else if (typeof row.text === "string" && row.text) {
    events.push({ type: "text", text: row.text });
  }
  const parts = Array.isArray(rawContent) ? rawContent : [];
  const thinking = parts.map(thinkingFromPart).join("");
  if (thinking) events.push({ type: "reasoning", text: thinking });
  const text = parts.map(textFromPart).join("");
  if (text) events.push({ type: "text", text });
  for (const part of parts) {
    const rec = asRecord(part);
    if (!rec) continue;
    const kind = partKind(rec);
    if (kind !== "tooluse") continue;
    const mapped = parseStandaloneToolUse(asRecord(rec.data) ?? rec);
    if (mapped) events.push(mapped);
  }
  return events;
}

function parseUserRow(row: Record<string, unknown>): ParsedKiroCliEvent[] {
  const events: ParsedKiroCliEvent[] = [];
  const payload = asRecord(row.message) ?? asRecord(row.data) ?? row;
  const parts = Array.isArray(payload.content)
    ? payload.content
    : Array.isArray(row.content)
      ? row.content
      : [];
  for (const part of parts) {
    const rec = asRecord(part);
    if (!rec) continue;
    const kind = partKind(rec);
    if (kind && kind !== "toolresult") continue;
    const mapped = parseStandaloneToolResult(asRecord(rec.data) ?? rec);
    if (mapped) events.push(mapped);
  }
  return events;
}

function partKind(rec: Record<string, unknown>): string {
  if (typeof rec.type === "string" && rec.type.trim()) return normalizeKind(rec.type);
  if (typeof rec.kind === "string" && rec.kind.trim()) return normalizeKind(rec.kind);
  return "";
}

function textFromPart(part: unknown): string {
  if (typeof part === "string") return part;
  const rec = asRecord(part);
  if (!rec) return "";
  const kind = partKind(rec);
  if (kind && kind !== "text" && kind !== "outputtext") return "";
  if (typeof rec.text === "string") return rec.text;
  if (typeof rec.data === "string") return rec.data;
  const nested = asRecord(rec.data);
  return nested && typeof nested.text === "string" ? nested.text : "";
}

function thinkingFromPart(part: unknown): string {
  const rec = asRecord(part);
  if (!rec) return "";
  if (typeof rec.thinking === "string") return rec.thinking;
  const kind = partKind(rec);
  if (kind !== "thinking" && kind !== "reasoning" && kind !== "thinkingdelta") return "";
  if (typeof rec.text === "string") return rec.text;
  return typeof rec.data === "string" ? rec.data : "";
}

function parseStandaloneToolUse(rec: Record<string, unknown>): ParsedKiroCliEvent | undefined {
  const id =
    (typeof rec.id === "string" && rec.id) ||
    (typeof rec.toolUseId === "string" && rec.toolUseId) ||
    (typeof rec.tool_use_id === "string" && rec.tool_use_id) ||
    "";
  const name = typeof rec.name === "string" ? rec.name : "tool";
  return {
    type: "tool_call",
    id: id || name,
    name: CLI_TOOL_NAMES[name] ?? name,
    status: "running",
    arguments: mapKiroToolArgs(name, asObject(rec.input ?? rec.arguments ?? rec.params)),
  };
}

function parseStandaloneToolResult(rec: Record<string, unknown>): ParsedKiroCliEvent | undefined {
  const id =
    (typeof rec.tool_use_id === "string" && rec.tool_use_id) ||
    (typeof rec.toolUseId === "string" && rec.toolUseId) ||
    (typeof rec.id === "string" && rec.id) ||
    "";
  if (!id) return undefined;
  return {
    type: "tool_call",
    id,
    name: "tool",
    status: "completed",
    arguments: {},
    result: stringifyResult(rec.content ?? rec.result ?? rec.output),
  };
}

function parseStreamEvent(row: Record<string, unknown>): ParsedKiroCliEvent[] {
  const event = asRecord(row.event);
  const delta = asRecord(event?.delta) ?? asRecord(row.delta);
  if (!delta) return [];
  const deltaType = partKind(delta);
  if (
    (deltaType === "textdelta" || deltaType === "text") &&
    typeof delta.text === "string" &&
    delta.text
  ) {
    return [{ type: "text", text: delta.text, partial: true }];
  }
  if (deltaType === "text" && typeof delta.data === "string" && delta.data) {
    return [{ type: "text", text: delta.data, partial: true }];
  }
  const thinking =
    (typeof delta.thinking === "string" && delta.thinking) ||
    (deltaType === "thinkingdelta" && typeof delta.text === "string" && delta.text) ||
    (deltaType === "thinkingdelta" && typeof delta.data === "string" && delta.data) ||
    "";
  if ((deltaType === "thinkingdelta" || deltaType === "thinking") && thinking) {
    return [{ type: "reasoning", text: thinking, partial: true }];
  }
  return [];
}

function publicKiroCliEvent(event: ParsedKiroCliEvent): KiroCliEvent {
  const rest = { ...event };
  delete rest.partial;
  return rest;
}

export function parseKiroCliLine(line: string): KiroCliEvent | undefined {
  return parseKiroCliEvents(line)[0];
}

export async function* streamKiroCli(input: {
  provider: AiProvider;
  prompt: string;
  workspace: string;
  model?: string;
  resume?: string;
  mode?: "agent" | "plan";
  webSearch?: boolean;
  review?: boolean;
  signal?: AbortSignal;
  spawnFn?: KiroCliSpawner;
}): AsyncGenerator<KiroCliEvent> {
  const argv = buildKiroCliArgv(input);
  const spawnFn = input.spawnFn ?? spawnKiroCli;
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
  let streamedTools = false;
  let sawTerminal = false;
  const toolNames = new Map<string, string>();
  const publish = (event: ParsedKiroCliEvent): KiroCliEvent | undefined => {
    if (event.type === "tool_call" && event.id) {
      streamedTools = true;
      if (event.status === "running" && event.name && event.name !== "tool") {
        toolNames.set(event.id, event.name);
      } else if (event.status === "completed") {
        event.name = toolNames.get(event.id) ?? event.name;
      }
    }
    if (event.type === "text" && !event.partial && streamedText) return undefined;
    if (event.type === "reasoning" && !event.partial && streamedReasoning) return undefined;
    if (event.type === "text") streamedText = true;
    if (event.type === "reasoning") streamedReasoning = true;
    const published = publicKiroCliEvent(event);
    if (published.type === "result" || published.type === "error") sawTerminal = true;
    if (published.type === "result" && published.text && streamedText) {
      return { ...published, text: undefined };
    }
    return published;
  };
  try {
    for await (const line of handle.lines) {
      if (input.signal?.aborted) break;
      for (const event of parseKiroCliEventsRaw(line)) {
        const published = publish(event);
        if (published) yield published;
      }
      if (sawTerminal) break;
    }
    const done = await handle.wait();
    if (!sawTerminal && !input.signal?.aborted) {
      if (!streamedText && !streamedTools) {
        for (const line of done.stderr.split(/\r?\n/)) {
          for (const event of parseKiroCliEventsRaw(line)) {
            const published = publish(event);
            if (published) yield published;
          }
        }
      }
      if (!sawTerminal && !streamedText && !streamedTools) {
        yield { type: "error", message: kiroEmptyReplyMessage(done.stderr, done.code) };
      }
    }
    yield { type: "done" };
  } catch (err) {
    throw rewriteSpawnError(err, argv.command);
  } finally {
    handle.kill?.();
  }
}

export function spawnKiroCli(req: Parameters<KiroCliSpawner>[0]) {
  return spawnCursorCli(req);
}

export async function listKiroCliModels(provider: AiProvider): Promise<string[]> {
  const models = provider.models.filter((id) => id.trim());
  return models.length ? [...models] : [...KIRO_CLI_MODELS];
}

export async function checkKiroCli(
  provider: Pick<AiProvider, "baseUrl" | "apiKey">,
  spawnFn: KiroCliSpawner = spawnKiroCli,
): Promise<KiroCliHealth> {
  const { command, prefixArgs } = resolveKiroCliCommand(provider);
  // Health checks run an executable selected by configuration. Never expose a
  // provider secret to that executable, even when it is a custom wrapper.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.KIRO_API_KEY;
  const versionProbe = await runKiroProbe(spawnFn, {
    command,
    args: [...prefixArgs, "--version"],
    cwd: process.cwd(),
    env,
  });
  const version = parseKiroVersion(versionProbe.stdout) ?? parseKiroVersion(versionProbe.stderr);
  if (versionProbe.code !== 0) {
    return {
      ok: false,
      command,
      ...(version ? { version } : {}),
      authenticated: false,
      authMode: "missing",
      message: `Kiro CLI is unavailable or failed its version check. Install from cli.kiro.dev and ensure \`${command}\` is on PATH.`,
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

  const loginProbe = await runKiroProbe(spawnFn, {
    command,
    args: [...prefixArgs, "whoami", "--format", "json"],
    cwd: process.cwd(),
    env,
  });
  if (loginProbe.code === 0) {
    const authMode = parseKiroAuthMethod(`${loginProbe.stdout}\n${loginProbe.stderr}`);
    return {
      ok: true,
      command,
      ...(version ? { version } : {}),
      authenticated: true,
      authMode: authMode === "missing" ? "account" : authMode,
    };
  }
  return {
    ok: false,
    command,
    ...(version ? { version } : {}),
    authenticated: false,
    authMode: "missing",
    message: "Kiro CLI is not authenticated. Run `kiro-cli login` or paste a KIRO_API_KEY.",
  };
}

async function runKiroProbe(
  spawnFn: KiroCliSpawner,
  req: Parameters<KiroCliSpawner>[0],
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
      delay(KIRO_HEALTH_TIMEOUT_MS).then(() => {
        throw new ProviderError("Kiro CLI health check timed out.");
      }),
    ]);
    return { code: result.code, stdout: lines.join("\n"), stderr: result.stderr };
  } catch (err) {
    throw rewriteSpawnError(err, req.command);
  } finally {
    handle.kill?.();
  }
}

function parseKiroVersion(text: string): string | undefined {
  const match = text.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/);
  return match?.[1];
}

function parseKiroAuthMethod(text: string): KiroCliAuthMode {
  const json = parseJsonObject(text);
  const method =
    (typeof json?.authMethod === "string" && json.authMethod) ||
    (typeof json?.auth_method === "string" && json.auth_method) ||
    (typeof json?.authType === "string" && json.authType) ||
    (typeof json?.auth_type === "string" && json.auth_type) ||
    "";
  if (method === "api_key" || method === "api-key" || method === "apiKey") return "api-key";
  if (
    method === "builder_id" ||
    method === "builder-id" ||
    method === "identity_center" ||
    method === "sso" ||
    method === "social" ||
    method === "google" ||
    method === "github"
  ) {
    return "account";
  }
  if (json?.loggedIn === true || json?.authenticated === true) return "account";
  if (/(?:not|no)\s+(?:logged|auth)|logged\s+out|authentication\s+required/i.test(text)) {
    return "missing";
  }
  if (/logged\s+in|authenticated|builder id|identity center/i.test(text)) return "account";
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
  const nested = [row, asRecord(row.data), asRecord(row.params), asRecord(row.result)];
  for (const rec of nested) {
    if (!rec) continue;
    const id =
      (typeof rec.session_id === "string" && rec.session_id.trim()) ||
      (typeof rec.sessionId === "string" && rec.sessionId.trim()) ||
      (typeof rec.conversation_id === "string" && rec.conversation_id.trim()) ||
      (typeof rec.conversationId === "string" && rec.conversationId.trim()) ||
      (typeof rec.resume_id === "string" && rec.resume_id.trim()) ||
      "";
    if (id) return id;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

function mapKiroToolArgs(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const path =
    (typeof input.file_path === "string" && input.file_path) ||
    (typeof input.path === "string" && input.path) ||
    (typeof input.target_file === "string" && input.target_file) ||
    undefined;
  const mappedName = CLI_TOOL_NAMES[name] ?? name;
  if (
    mappedName === "file_read" ||
    mappedName === "file_write" ||
    mappedName === "file_list" ||
    name === "Read" ||
    name === "Write" ||
    name === "LS" ||
    name === "Delete"
  ) {
    return path ? { ...input, path } : input;
  }
  if (mappedName === "grep" || name === "Grep") {
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
  if (Array.isArray(value)) {
    const texts = value
      .map((part) => {
        const direct = textFromPart(part);
        if (direct) return direct;
        const rec = asRecord(part);
        if (!rec) return "";
        const kind = partKind(rec);
        if (kind === "toolresult") return stringifyResult(rec.data) ?? "";
        if (Array.isArray(rec.content)) return stringifyResult(rec.content) ?? "";
        return "";
      })
      .filter(Boolean);
    if (texts.length) return texts.join("\n");
  }
  const rec = asRecord(value);
  if (rec && Array.isArray(rec.content)) {
    const nested = stringifyResult(rec.content);
    if (nested) return nested;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isKiroAcpAuthMethod(method: string): boolean {
  const normalized = normalizeKind(method);
  return (
    method === "_kiro/auth/getAccessToken" ||
    normalized === "kiroauthgetaccesstoken" ||
    normalized === "authgetaccesstoken"
  );
}

function stripKiroAnsi(text: string): string {
  // ESC is data, not a regex literal, so no-control-regex does not flag it.
  return text.replace(new RegExp(`${"\u001b"}\\[[0-9;]*m`, "g"), "");
}

function isKiroDiagnosticLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^\[(?:INFO|DEBUG|TRACE|LOG)\]/i.test(trimmed)) return true;
  if (/\bkas\.server\.starting\b/i.test(trimmed)) return true;
  if (/\bacp\.(?:content_collection|remote_sessions)\b/i.test(trimmed)) return true;
  return false;
}

function clipKiroError(text: string, max = 280): string {
  const useful = stripKiroAnsi(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isKiroDiagnosticLine(line));
  const trimmed = useful.join("\n").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

function kiroEmptyReplyMessage(stderr: string, code: number): string {
  const detail = clipKiroError(stderr);
  if (code !== 0) return `Kiro CLI failed: ${detail || `exit ${code}`}`;
  if (detail) return `Kiro CLI finished without a reply: ${detail}`;
  if (/acp-callback|_kiro\/auth\/getAccessToken/i.test(stderr)) {
    return "Kiro CLI finished without a reply. V3 started KAS with host-mediated ACP auth but emitted no stream-json. Run `kiro-cli login` or paste a KIRO_API_KEY.";
  }
  if (/kas\.server\.starting/i.test(stderr)) {
    return "Kiro CLI finished without a reply. V3 started KAS but emitted no stream-json. Run `kiro-cli login` or paste a KIRO_API_KEY.";
  }
  return "Kiro CLI finished without a reply.";
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
    .replace(/Cursor CLI/g, "Kiro CLI")
    .replace("cursor.com/install", "cli.kiro.dev")
    .replace("cursor-agent.cmd", "kiro-cli");
  return new ProviderError(message);
}
