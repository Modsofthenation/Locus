import { spawn } from "node:child_process";
import {
  CURSOR_CLI_BASE_URL,
  isCursorCliBase,
  normalizeCursorModelId,
  recoverPatchText,
  stripAppImageMountsFromPath,
  type AiProvider,
} from "@locus/shared";
import {
  cursorCliSpawnFailureMessage,
  resolveWindowsCliSpawn,
} from "@locus/shared/windowsCliSpawn";
import { readCursorUsagePayload, type CursorCloudEvent } from "./cursor.js";
import { ProviderError, type TokenUsageEvent } from "./types.js";

const CLI_TOOL_NAMES: Record<string, string> = {
  read: "file_read",
  write: "file_write",
  edit: "apply_patch",
  searchReplace: "apply_patch",
  shell: "exec",
  bash: "exec",
  terminal: "exec",
  grep: "grep",
  glob: "glob",
  ls: "file_list",
  delete: "file_write",
  webSearch: "websearch",
  webFetch: "webfetch",
};

/** Proto ToolCall oneof names Cursor CLI accepts on hidden `--exclude-tools`. */
export const CURSOR_CLI_WEB_EXCLUDE_TOOLS = "web_search_tool_call,web_fetch_tool_call";

/** Write/shell tools Cursor CLI would otherwise offer on a review session. */
export const CURSOR_CLI_REVIEW_EXCLUDE_TOOLS = [
  "write_tool_call",
  "edit_tool_call",
  "search_replace_tool_call",
  "delete_tool_call",
  "shell_tool_call",
  "bash_tool_call",
  "terminal_tool_call",
].join(",");

export function cursorCliExcludeTools(input: {
  webSearch?: boolean;
  review?: boolean;
}): string | undefined {
  const parts: string[] = [];
  if (input.review) parts.push(CURSOR_CLI_REVIEW_EXCLUDE_TOOLS);
  if (input.webSearch !== true) parts.push(CURSOR_CLI_WEB_EXCLUDE_TOOLS);
  return parts.length ? parts.join(",") : undefined;
}

/** Pin `--exclude-tools` for a resumed CLI thread. Empty means no exclude flag. */
export function frozenCursorCliExcludeTools(input: {
  frozen?: string;
  webSearch?: boolean;
  review?: boolean;
}): string {
  if (input.frozen !== undefined) return input.frozen;
  return cursorCliExcludeTools({ webSearch: input.webSearch, review: input.review }) ?? "";
}

export type CursorCliEvent = CursorCloudEvent | { type: "session"; sessionId: string };

export interface CursorCliSpawnRequest {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface CursorCliSpawnHandle {
  lines: AsyncIterable<string>;
  wait(): Promise<{ code: number; stderr: string }>;
  kill?: () => void;
}

/** After a terminal `result` event, wait this long for the CLI process to exit before killing it. */
const CLI_EXIT_GRACE_MS = 5_000;

export type CursorCliSpawner = (req: CursorCliSpawnRequest) => CursorCliSpawnHandle;

export interface CursorCliArgv {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export function resolveCursorCliCommand(
  provider: Pick<AiProvider, "baseUrl">,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; prefixArgs: string[] } {
  const explicit = provider.baseUrl?.trim();
  if (explicit && isCursorCliBinaryPath(explicit)) {
    return { command: explicit, prefixArgs: [] };
  }
  const fromEnv = (env.LOCUS_CURSOR_CLI ?? env.CURSOR_CLI ?? "").trim();
  if (fromEnv) return { command: fromEnv, prefixArgs: [] };
  return { command: "agent", prefixArgs: [] };
}

function isCursorCliBinaryPath(value: string): boolean {
  if (!value || isCursorCliBase(value) || value === CURSOR_CLI_BASE_URL) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.includes("://")) return false;
  return Boolean(value);
}

export function buildCursorCliArgv(input: {
  provider: Pick<AiProvider, "baseUrl" | "apiKey" | "extraHeaders">;
  prompt: string;
  workspace: string;
  model?: string;
  resume?: string;
  mode?: "agent" | "plan";
  webSearch?: boolean;
  review?: boolean;
  /** Frozen `--exclude-tools` for this thread. Empty/undefined with no web/review flags means none. */
  excludeTools?: string;
  env?: NodeJS.ProcessEnv;
}): CursorCliArgv {
  const env = input.env ?? process.env;
  const { command, prefixArgs } = resolveCursorCliCommand(input.provider, env);
  const args = [
    ...prefixArgs,
    "-p",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--force",
    "--approve-mcps",
    "--trust",
    "--sandbox",
    "disabled",
    "--workspace",
    input.workspace,
  ];
  const model = input.model?.trim();
  if (model) args.push("--model", normalizeCursorModelId(model));
  if (input.mode === "plan") args.push("--mode", "plan");
  // Cursor CLI owns its tool loop. `--force` auto-approves its built-in
  // webSearch / webFetch unless we strip them. Locus Web-off is the default.
  // Review sessions also strip write/shell so "continue" cannot wander into ship-it.
  const exclude =
    input.excludeTools !== undefined
      ? input.excludeTools || undefined
      : cursorCliExcludeTools({
          webSearch: input.webSearch,
          review: input.review,
        });
  if (exclude) args.push("--exclude-tools", exclude);
  const resume = input.resume?.trim();
  if (resume) args.push("--resume", resume);
  const apiKey = input.provider.apiKey?.trim();
  for (const [name, value] of Object.entries(input.provider.extraHeaders ?? {})) {
    if (!name.trim() || value == null) continue;
    args.push("-H", `${name}: ${value}`);
  }
  args.push("--", input.prompt);
  const pathSep = process.platform === "win32" ? ";" : ":";
  const pathValue = stripAppImageMountsFromPath(env.PATH ?? env.Path, pathSep, env.APPDIR);
  return {
    command,
    args,
    cwd: input.workspace,
    env: {
      ...env,
      PATH: pathValue,
      ...(apiKey && !apiKey.includes("•") ? { CURSOR_API_KEY: apiKey } : {}),
    },
  };
}

export function parseCursorCliLine(line: string): CursorCliEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const row = data as Record<string, unknown>;
  const type = typeof row.type === "string" ? row.type : "";
  if (type === "system") {
    const sessionId = sessionIdFromRow(row);
    return sessionId ? { type: "session", sessionId } : undefined;
  }
  if (type === "thinking") {
    const text =
      (typeof row.text === "string" && row.text) ||
      (typeof row.delta === "string" && row.delta) ||
      assistantText(row);
    return text ? { type: "reasoning", text } : undefined;
  }
  if (type === "assistant") {
    if ("model_call_id" in row || !("timestamp_ms" in row)) return undefined;
    const text = assistantText(row);
    return text ? { type: "text", text } : undefined;
  }
  if (type === "tool_call") {
    const id =
      (typeof row.call_id === "string" && row.call_id.trim()) ||
      (typeof row.callId === "string" && row.callId.trim()) ||
      "";
    if (!id) return undefined;
    const parsed = parseCliToolCall(row.tool_call);
    const status = row.subtype === "completed" ? "completed" : "running";
    return {
      type: "tool_call",
      id,
      name: parsed.name,
      status,
      arguments: parsed.arguments,
      result: status === "completed" ? parsed.result : undefined,
    };
  }
  if (type === "usage") {
    const usage = readCursorCliUsage(row);
    return usage ? { type: "usage", ...usage } : undefined;
  }
  if (type === "result") {
    const text = typeof row.result === "string" ? row.result : undefined;
    const error =
      row.is_error === true || row.subtype === "error"
        ? text?.trim() || "Cursor CLI failed"
        : undefined;
    if (error) return { type: "error", message: error };
    const usage = readCursorCliUsage(row);
    return {
      type: "result",
      status: "FINISHED",
      text,
      durationMs:
        typeof row.duration_ms === "number" && Number.isFinite(row.duration_ms)
          ? row.duration_ms
          : undefined,
      ...(usage ? { usage } : {}),
    };
  }
  if (type === "error") {
    const message =
      (typeof row.message === "string" && row.message.trim()) ||
      (typeof row.result === "string" && row.result.trim()) ||
      "Cursor CLI stream error";
    return { type: "error", message };
  }
  return undefined;
}

export async function* streamCursorCli(input: {
  provider: AiProvider;
  prompt: string;
  workspace: string;
  model?: string;
  resume?: string;
  mode?: "agent" | "plan";
  webSearch?: boolean;
  review?: boolean;
  excludeTools?: string;
  signal?: AbortSignal;
  spawnFn?: CursorCliSpawner;
}): AsyncGenerator<CursorCliEvent> {
  const argv = buildCursorCliArgv(input);
  const spawnFn = input.spawnFn ?? spawnCursorCli;
  let handle: CursorCliSpawnHandle;
  try {
    handle = spawnFn({
      command: argv.command,
      args: argv.args,
      cwd: argv.cwd,
      env: argv.env,
      signal: input.signal,
    });
  } catch (err) {
    throw rewriteCliSpawnError(err, argv.command);
  }
  let streamedText = false;
  let sawTerminal = false;
  try {
    for await (const line of handle.lines) {
      if (input.signal?.aborted) break;
      const terminal = isCursorCliTerminalLine(line);
      const sessionId = sessionIdFromCliLine(line);
      const event = parseCursorCliLine(line);
      if (sessionId && event?.type !== "session") {
        yield { type: "session", sessionId };
      }
      if (event) {
        if (event.type === "text") streamedText = true;
        if (event.type === "result" && event.text && streamedText) {
          yield { ...event, text: undefined };
        } else {
          yield event;
        }
      }
      if (terminal) {
        sawTerminal = true;
        break;
      }
    }
    const done = await reapCursorCli(handle, CLI_EXIT_GRACE_MS);
    if (!sawTerminal && !input.signal?.aborted && done.code !== 0) {
      const detail = done.stderr.trim() || `exit ${done.code}`;
      yield { type: "error", message: `Cursor CLI failed: ${detail}` };
    }
    yield { type: "done" };
  } catch (err) {
    throw rewriteCliSpawnError(err, argv.command);
  } finally {
    handle.kill?.();
  }
}

export async function listCursorCliModels(
  provider: AiProvider,
  spawnFn?: CursorCliSpawner,
): Promise<string[]> {
  const run = spawnFn ?? spawnCursorCli;
  const { command, prefixArgs } = resolveCursorCliCommand(provider);
  const apiKey = provider.apiKey?.trim();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    ...(apiKey && !apiKey.includes("•") ? { CURSOR_API_KEY: apiKey } : {}),
  };
  const attempts = [
    [...prefixArgs, "models", "--format", "json"],
    [...prefixArgs, "--list-models"],
  ];
  let lastError = "";
  for (const args of attempts) {
    let handle: CursorCliSpawnHandle;
    try {
      handle = run({ command, args, cwd: process.cwd(), env });
    } catch (err) {
      throw rewriteCliSpawnError(err, command);
    }
    const lines: string[] = [];
    try {
      for await (const line of handle.lines) lines.push(line);
    } catch (err) {
      throw rewriteCliSpawnError(err, command);
    }
    const { code, stderr } = await handle.wait();
    const stdout = lines.join("\n");
    if (code !== 0) {
      lastError = clipCliError(stderr) || clipCliError(stdout) || `exit ${code}`;
      continue;
    }
    const models = parseCursorCliModelIds(stdout);
    if (models.length) return models;
    lastError = clipCliError(stdout) || "no models listed";
  }
  throw new ProviderError(
    lastError
      ? `Cursor CLI did not list models: ${lastError}`
      : "Cursor CLI did not list models. Install from cursor.com/install and run `agent login`, or paste a key.",
  );
}

export function parseCursorCliModelIds(text: string): string[] {
  const trimmed = stripAnsi(text).trim();
  if (!trimmed) return [];
  try {
    const json = JSON.parse(trimmed) as unknown;
    const fromJson = modelIdsFromUnknown(json);
    if (fromJson.length) return fromJson;
  } catch {
    /* fall through to text scan */
  }
  const fromLabels = modelIdsFromLabeledText(trimmed);
  if (fromLabels.length) return fromLabels;
  const ids: string[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    let raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    raw = raw.replace(/^available models\s*/i, "").trim();
    if (!raw || /^tip:/i.test(raw)) continue;
    const token = raw.split(/\s+/)[0] ?? "";
    pushModelId(ids, token);
  }
  return ids.sort();
}

export function spawnCursorCli(req: CursorCliSpawnRequest): CursorCliSpawnHandle {
  const resolved = resolveWindowsCliSpawn(req.command, req.args, { env: req.env });
  const child = spawn(resolved.command, resolved.args, {
    cwd: req.cwd,
    env: { ...req.env, ...resolved.envPatch },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    windowsVerbatimArguments: resolved.windowsVerbatimArguments === true,
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += String(chunk);
  });
  const kill = () => {
    if (child.exitCode != null || child.signalCode != null) return;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    }, 1500).unref?.();
  };
  if (req.signal) {
    if (req.signal.aborted) kill();
    else req.signal.addEventListener("abort", kill, { once: true });
  }
  const wait = new Promise<{ code: number; stderr: string }>((resolve, reject) => {
    child.on("error", (err) => {
      req.signal?.removeEventListener("abort", kill);
      reject(rewriteCliSpawnError(err, req.command));
    });
    child.on("close", (code) => {
      req.signal?.removeEventListener("abort", kill);
      resolve({ code: code ?? 1, stderr });
    });
  });
  // Spawn ENOENT fires on the next tick, before callers await wait(). Without
  // a handler here that rejection kills the control plane after listen.
  void wait.catch(() => undefined);
  return {
    lines: readStdoutLines(child.stdout),
    wait: () => wait,
    kill,
  };
}

async function reapCursorCli(
  handle: CursorCliSpawnHandle,
  killAfterMs: number,
): Promise<{ code: number; stderr: string }> {
  const exited = handle.wait();
  const winner = await Promise.race([exited, delay(killAfterMs).then(() => "timeout" as const)]);
  if (winner !== "timeout") return winner;
  handle.kill?.();
  const afterKill = await Promise.race([
    exited,
    delay(2_000).then(() => ({ code: 1, stderr: "Cursor CLI did not exit" })),
  ]);
  return afterKill;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function isCursorCliTerminalLine(line: string): boolean {
  const row = jsonObjectFromLine(line);
  return row?.type === "result";
}

function sessionIdFromCliLine(line: string): string | undefined {
  const row = jsonObjectFromLine(line);
  return row ? sessionIdFromRow(row) : undefined;
}

function jsonObjectFromLine(line: string): Record<string, unknown> | undefined {
  try {
    const data = JSON.parse(line.trim()) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
    return data as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function rewriteCliSpawnError(err: unknown, command: string): ProviderError {
  if (err instanceof ProviderError) return err;
  return new ProviderError(cursorCliSpawnFailureMessage(err, command));
}

async function* readStdoutLines(stdout: NodeJS.ReadableStream | null): AsyncGenerator<string> {
  if (!stdout) return;
  let buf = "";
  for await (const chunk of stdout) {
    buf += String(chunk);
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() ?? "";
    for (const line of parts) {
      if (line.trim()) yield line;
    }
  }
  if (buf.trim()) yield buf;
}

function sessionIdFromRow(row: Record<string, unknown>): string | undefined {
  const id =
    (typeof row.session_id === "string" && row.session_id.trim()) ||
    (typeof row.sessionId === "string" && row.sessionId.trim()) ||
    "";
  return id || undefined;
}

function assistantText(row: Record<string, unknown>): string {
  const message = row.message;
  if (message && typeof message === "object") {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) =>
          part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : "",
        )
        .join("");
    }
  }
  return typeof row.text === "string" ? row.text : "";
}

function parseCliToolCall(raw: unknown): {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
} {
  if (!raw || typeof raw !== "object") return { name: "tool", arguments: {} };
  const tool = raw as Record<string, unknown>;
  if (tool.function && typeof tool.function === "object") {
    const fn = tool.function as { name?: unknown; arguments?: unknown };
    const rawName = typeof fn.name === "string" && fn.name.trim() ? fn.name.trim() : "tool";
    const name = CLI_TOOL_NAMES[rawName] ?? rawName;
    return {
      name,
      arguments: withRecoveredPatch(name, jsonObject(parseMaybeJson(fn.arguments))),
      result: stringifyCliValue(tool.result),
    };
  }
  for (const [key, value] of Object.entries(tool)) {
    if (!key.endsWith("ToolCall") || !value || typeof value !== "object") continue;
    const body = value as { args?: unknown; result?: unknown };
    const stem = key.slice(0, -"ToolCall".length);
    const args = jsonObject(body.args);
    let name = CLI_TOOL_NAMES[stem] ?? stem;
    if (stem === "mcp") {
      const nested =
        (typeof args.name === "string" && args.name.trim()) ||
        (typeof args.toolName === "string" && args.toolName.trim()) ||
        "";
      if (nested) name = nested;
    }
    return {
      name,
      arguments: withRecoveredPatch(name, args),
      result: stringifyCliResult(body.result),
    };
  }
  return { name: "tool", arguments: jsonObject(tool) };
}

function withRecoveredPatch(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name !== "apply_patch" && name !== "file_write") return args;
  const patch = recoverPatchText(args, true);
  if (!patch || args.patch === patch) return args;
  return { ...args, patch };
}

function cliResultEnvelopeFailed(row: Record<string, unknown>): boolean {
  if (row.isError === true || row.is_error === true || row.ok === false) return true;
  if (row.status === "failed" || row.status === "blocked" || row.status === "error") return true;
  if (typeof row.exitCode === "number" && row.exitCode !== 0) return true;
  if (typeof row.exit_code === "number" && row.exit_code !== 0) return true;
  if (row.success != null) return false;
  return row.error != null || row.failure != null;
}

function stringifyCliResult(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    if (cliResultEnvelopeFailed(row)) return stringifyCliValue(value);
    if (row.success != null) return stringifyCliValue(row.success);
  }
  return stringifyCliValue(value);
}

function stringifyCliValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (value == null) return {};
  return { value };
}

function readCursorCliUsage(
  row: Record<string, unknown>,
): (TokenUsageEvent & { window?: number }) | undefined {
  const usage = readCursorUsagePayload(row);
  if (!usage) return undefined;
  const window = cursorCliWindow(row);
  return window != null ? { ...usage, window } : usage;
}

function cursorCliWindow(row: Record<string, unknown>): number | undefined {
  const nested =
    row.usage && typeof row.usage === "object" && !Array.isArray(row.usage)
      ? (row.usage as Record<string, unknown>)
      : undefined;
  const candidates = [
    row.context_window,
    row.contextWindow,
    nested?.contextWindow,
    nested?.context_window,
  ];
  for (const raw of candidates) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.round(raw);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;
    const size = obj.context_window_size ?? obj.contextWindowSize ?? obj.size;
    if (typeof size === "number" && Number.isFinite(size) && size > 0) return Math.round(size);
  }
  return undefined;
}

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

function stripAnsi(text: string): string {
  const esc = String.fromCharCode(27);
  return text.replace(new RegExp(`${esc}\\[[\\d;]*m`, "g"), "");
}

function clipCliError(text: string, max = 280): string {
  const cleaned = stripAnsi(text).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function pushModelId(ids: string[], token: string): void {
  if (!MODEL_ID_RE.test(token) || token === "-" || token === "id") return;
  if (!ids.includes(token)) ids.push(token);
}

function modelIdsFromLabeledText(text: string): string[] {
  const ids: string[] = [];
  const labeled = /(?:^|\s)([A-Za-z0-9][A-Za-z0-9._:/-]*)\s+-\s+/g;
  for (const match of text.matchAll(labeled)) {
    pushModelId(ids, match[1] ?? "");
  }
  return ids.sort();
}

function modelIdsFromUnknown(json: unknown): string[] {
  if (Array.isArray(json)) {
    return [
      ...new Set(
        json
          .map((row) =>
            typeof row === "string"
              ? row
              : row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
                ? (row as { id: string }).id
                : undefined,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ].sort();
  }
  if (!json || typeof json !== "object") return [];
  const obj = json as { models?: unknown; data?: unknown; items?: unknown };
  for (const key of ["models", "data", "items"] as const) {
    const ids = modelIdsFromUnknown(obj[key]);
    if (ids.length) return ids;
  }
  return [];
}
