import {
  cliAgentModelArg,
  cliAgentPromptInArgs,
  stripAppImageMountsFromPath,
  type AiProvider,
  type CliAgentConfig,
} from "@locus/shared";
import { parseClaudeCodeEventsRaw } from "./claudeCode.js";
import {
  spawnCursorCli,
  type CursorCliEvent,
  type CursorCliSpawnHandle,
  type CursorCliSpawner,
  type CursorCliSpawnRequest,
} from "./cursorCli.js";
import { ProviderError, type TokenUsageEvent } from "./types.js";

/**
 * Custom CLI agent adapter (provider kind `cli-agent`). One argv template plus one of four
 * output parsers turns any coding-agent CLI into the same event union the Cursor / Claude /
 * Codex / Kiro adapters yield:
 *
 * - `text`: stdout lines are streamed as text deltas.
 * - `jsonl`: best-effort map of common JSONL shapes (Gemini stream-json, generic message /
 *   tool rows, `session_id`).
 * - `claude-stream-json`: Claude Code's `--output-format stream-json` parser.
 * - `acp`: a minimal Agent Client Protocol client (JSON-RPC 2.0 over stdio).
 */

export type GenericCliEvent = CursorCliEvent;
export type GenericCliSpawner = CursorCliSpawner;

type ParsedEvent = GenericCliEvent & { partial?: boolean };

export type GenericCliHealth = {
  ok: boolean;
  command: string;
  version?: string;
  message?: string;
};

/** Stored as the resume id when resumeArgs need no id (e.g. `--continue`). */
export const GENERIC_CLI_CONTINUE = "continue";

const HEALTH_TIMEOUT_MS = 5_000;
const EXIT_GRACE_MS = 5_000;
const ACP_PROTOCOL_VERSION = 1;

export interface GenericCliArgv {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Written to stdin (then closed) when `{prompt}` is not in argv. Never set for ACP. */
  stdin?: string;
}

export type CliTemplateVars = {
  prompt?: string;
  model?: string;
  workspace?: string;
  resume?: string;
};

const TEMPLATE_RE = /\{(prompt|model|workspace|resume)\}/g;

/**
 * Expand `{prompt}` / `{model}` / `{workspace}` / `{resume}`. An arg whose placeholder has no
 * value (no model, no resume id) is dropped, along with a bare preceding flag such as `-m`
 * that only existed to carry it. `{prompt}` is always kept (an empty prompt is still a prompt).
 */
export function expandCliArgs(template: string[], vars: CliTemplateVars): string[] {
  const out: string[] = [];
  let prevLiteral: string | undefined;
  for (const arg of template) {
    const names = [...arg.matchAll(TEMPLATE_RE)].map((m) => m[1] as keyof CliTemplateVars);
    const missing = names.some((name) => name !== "prompt" && !vars[name]?.trim());
    if (missing) {
      const alone = /^\{(model|workspace|resume)\}$/.test(arg);
      if (
        alone &&
        prevLiteral !== undefined &&
        out[out.length - 1] === prevLiteral &&
        /^-/.test(prevLiteral) &&
        !prevLiteral.includes("=")
      ) {
        out.pop();
      }
      prevLiteral = undefined;
      continue;
    }
    const value = arg.replace(TEMPLATE_RE, (_, name: keyof CliTemplateVars) =>
      name === "prompt" ? (vars.prompt ?? "") : (vars[name]?.trim() ?? ""),
    );
    out.push(value);
    prevLiteral = names.length ? undefined : arg;
  }
  return out;
}

export function genericCliConfig(provider: Pick<AiProvider, "name" | "cli">): CliAgentConfig {
  const cli = provider.cli;
  if (!cli?.command?.trim()) {
    throw new ProviderError(
      `${provider.name || "Custom CLI agent"} has no command. Pick a preset or set a command in Settings → Providers.`,
    );
  }
  return cli;
}

export function buildGenericCliArgv(input: {
  provider: Pick<AiProvider, "name" | "cli" | "apiKey">;
  prompt: string;
  workspace: string;
  model?: string;
  resume?: string;
  env?: NodeJS.ProcessEnv;
}): GenericCliArgv {
  const cli = genericCliConfig(input.provider);
  const env = input.env ?? process.env;
  const vars: CliTemplateVars = {
    prompt: input.prompt,
    model: cliAgentModelArg(input.model),
    workspace: input.workspace,
    resume: input.resume,
  };
  const args = expandCliArgs(cli.args, vars);
  const resume = input.resume?.trim();
  if (resume && cli.resumeArgs?.length) args.push(...expandCliArgs(cli.resumeArgs, vars));
  const promptInArgs = cliAgentPromptInArgs(cli);
  const apiKey = input.provider.apiKey?.trim();
  const apiKeyEnv = cli.apiKeyEnv?.trim();
  const pathSep = process.platform === "win32" ? ";" : ":";
  return {
    command: cli.command.trim(),
    args,
    cwd: input.workspace,
    env: {
      ...env,
      PATH: stripAppImageMountsFromPath(env.PATH ?? env.Path, pathSep, env.APPDIR),
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      ...(cli.env ?? {}),
      ...(apiKey && apiKeyEnv && !apiKey.includes("•") ? { [apiKeyEnv]: apiKey } : {}),
    },
    ...(cli.output !== "acp" && !promptInArgs ? { stdin: input.prompt } : {}),
  };
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

const TOOL_NAMES: Record<string, string> = {
  read: "file_read",
  read_file: "file_read",
  readfile: "file_read",
  read_many_files: "file_read",
  view: "file_read",
  write: "file_write",
  write_file: "file_write",
  writefile: "file_write",
  create: "file_write",
  delete: "file_write",
  edit: "apply_patch",
  replace: "apply_patch",
  edit_file: "apply_patch",
  str_replace: "apply_patch",
  multiedit: "apply_patch",
  patch: "apply_patch",
  apply_patch: "apply_patch",
  bash: "exec",
  shell: "exec",
  run_shell_command: "exec",
  execute: "exec",
  exec: "exec",
  terminal: "exec",
  command: "exec",
  grep: "grep",
  search: "grep",
  search_file_content: "grep",
  ripgrep: "grep",
  glob: "glob",
  find: "glob",
  ls: "file_list",
  list: "file_list",
  list_directory: "file_list",
  web_fetch: "webfetch",
  webfetch: "webfetch",
  fetch: "webfetch",
  web_search: "websearch",
  websearch: "websearch",
  google_web_search: "websearch",
  todowrite: "task_list",
  todo_write: "task_list",
};

function mapToolName(raw: string): string {
  const key = raw.trim();
  return TOOL_NAMES[key] ?? TOOL_NAMES[key.toLowerCase()] ?? (key || "tool");
}

function mapToolArgs(input: Record<string, unknown>): Record<string, unknown> {
  const path =
    str(input.path) ?? str(input.file_path) ?? str(input.absolute_path) ?? str(input.filePath);
  const next: Record<string, unknown> = { ...input };
  if (path && typeof next.path !== "string") next.path = path.replace(/^file:\/\//i, "");
  if (typeof next.pattern !== "string" && typeof next.query === "string") {
    next.pattern = next.query;
  }
  return next;
}

/** Best-effort JSONL row → events. Unknown rows yield nothing (or only a session id). */
export function parseGenericJsonlLine(line: string): ParsedEvent[] {
  const row = jsonObject(line);
  if (!row) return [];
  const type = kindOf(row);
  const sessionId = sessionIdOf(row);
  const session: ParsedEvent[] = sessionId ? [{ type: "session", sessionId }] : [];
  const role = str(row.role) ?? str(asRecord(row.message)?.role);
  if (
    type === "init" ||
    type === "system" ||
    type === "session" ||
    type === "start" ||
    type === "sessionstarted" ||
    type === "threadstarted"
  ) {
    return session;
  }
  if (
    type === "text" ||
    type === "message" ||
    type === "assistant" ||
    type === "agentmessage" ||
    type === "assistantmessage" ||
    type === "content" ||
    type === "delta" ||
    type === "messagedelta" ||
    type === "textdelta"
  ) {
    if (role === "user" || role === "system") return session;
    const events: ParsedEvent[] = [...session];
    const thinking = thinkingOf(row);
    if (thinking) events.push({ type: "reasoning", text: thinking });
    const text = textOf(row);
    const partial = row.delta === true || type.endsWith("delta") || row.partial === true;
    if (text) events.push({ type: "text", text, ...(partial ? { partial: true } : {}) });
    events.push(...toolUsesOf(row));
    return events;
  }
  if (
    type === "thinking" ||
    type === "reasoning" ||
    type === "thought" ||
    type === "thoughtdelta"
  ) {
    const text = textOf(row) || thinkingOf(row);
    return text ? [...session, { type: "reasoning", text }] : session;
  }
  if (
    type === "tooluse" ||
    type === "toolcall" ||
    type === "tool" ||
    type === "toolstart" ||
    type === "toolcallstarted"
  ) {
    const tool = toolUseOf(asRecord(row.tool_call) ?? asRecord(row.tool) ?? row);
    return tool ? [...session, tool] : session;
  }
  if (
    type === "toolresult" ||
    type === "toolcallresult" ||
    type === "tooloutput" ||
    type === "toolend" ||
    type === "toolcallcompleted"
  ) {
    const tool = toolResultOf(row);
    return tool ? [...session, tool] : session;
  }
  if (
    type === "result" ||
    type === "done" ||
    type === "complete" ||
    type === "turncomplete" ||
    type === "turncompleted" ||
    type === "final"
  ) {
    const status = (str(row.status) ?? str(row.subtype) ?? "").toLowerCase();
    const errorObj = asRecord(row.error);
    const failed =
      row.is_error === true ||
      row.isError === true ||
      status === "error" ||
      status === "failed" ||
      status === "failure" ||
      Boolean(errorObj);
    const text = str(row.result) ?? str(row.text) ?? str(row.response);
    if (failed) {
      const message =
        str(errorObj?.message) ?? str(row.message) ?? text?.trim() ?? "CLI agent run failed";
      return [...session, { type: "error", message }];
    }
    const usage = usageOf(row);
    const durationMs =
      num(row.duration_ms) ??
      num(row.durationMs) ??
      num(asRecord(row.stats)?.duration_ms) ??
      num(asRecord(row.stats)?.durationMs);
    return [
      ...session,
      {
        type: "result",
        status: "FINISHED",
        ...(text ? { text } : {}),
        ...(durationMs != null ? { durationMs } : {}),
        ...(usage ? { usage } : {}),
      },
    ];
  }
  if (type === "usage" || type === "stats" || type === "tokencount") {
    const usage = usageOf(row);
    return usage ? [...session, { type: "usage", ...usage }] : session;
  }
  if (type === "error") {
    const message =
      str(row.message) ?? str(asRecord(row.error)?.message) ?? str(row.error) ?? "CLI agent error";
    return [...session, { type: "error", message }];
  }
  return session;
}

function toolUsesOf(row: Record<string, unknown>): ParsedEvent[] {
  const parts = contentParts(row);
  const out: ParsedEvent[] = [];
  for (const part of parts) {
    const rec = asRecord(part);
    if (!rec) continue;
    const kind = kindOf(rec);
    if (kind === "tooluse" || kind === "toolcall") {
      const tool = toolUseOf(rec);
      if (tool) out.push(tool);
    }
  }
  return out;
}

function toolUseOf(rec: Record<string, unknown>): ParsedEvent | undefined {
  const name =
    str(rec.tool_name) ?? str(rec.toolName) ?? str(rec.name) ?? str(rec.tool) ?? str(rec.title);
  const id =
    str(rec.tool_id) ??
    str(rec.toolId) ??
    str(rec.tool_call_id) ??
    str(rec.toolCallId) ??
    str(rec.call_id) ??
    str(rec.callId) ??
    str(rec.id) ??
    name;
  if (!id) return undefined;
  const input =
    asRecord(rec.parameters) ??
    asRecord(rec.input) ??
    asRecord(parseMaybeJson(rec.arguments)) ??
    asRecord(rec.args) ??
    {};
  return {
    type: "tool_call",
    id,
    name: mapToolName(name ?? "tool"),
    status: "running",
    arguments: mapToolArgs(input),
  };
}

function toolResultOf(rec: Record<string, unknown>): ParsedEvent | undefined {
  const id =
    str(rec.tool_id) ??
    str(rec.toolId) ??
    str(rec.tool_use_id) ??
    str(rec.tool_call_id) ??
    str(rec.toolCallId) ??
    str(rec.call_id) ??
    str(rec.id);
  if (!id) return undefined;
  const status = (str(rec.status) ?? "").toLowerCase();
  const failed =
    status === "error" || status === "failed" || rec.is_error === true || rec.isError === true;
  const output = stringify(rec.output ?? rec.result ?? rec.content ?? asRecord(rec.error)?.message);
  const name = str(rec.tool_name) ?? str(rec.toolName) ?? str(rec.name);
  return {
    type: "tool_call",
    id,
    name: name ? mapToolName(name) : "tool",
    status: "completed",
    arguments: {},
    result: failed ? JSON.stringify({ isError: true, output: output ?? status }) : output,
  };
}

/** ACP `session/update` payload → events. `toolNames` remembers names across updates. */
export function parseAcpSessionUpdate(
  update: Record<string, unknown>,
  toolNames: Map<string, string> = new Map(),
): ParsedEvent[] {
  const kind = normalizeKind(str(update.sessionUpdate) ?? str(update.type) ?? "");
  if (kind === "agentmessagechunk") {
    const text = acpContentText(update.content);
    return text ? [{ type: "text", text, partial: true }] : [];
  }
  if (kind === "agentthoughtchunk") {
    const text = acpContentText(update.content);
    return text ? [{ type: "reasoning", text, partial: true }] : [];
  }
  if (kind === "toolcall" || kind === "toolcallupdate") {
    const id = str(update.toolCallId) ?? str(update.id);
    if (!id) return [];
    const toolKind = str(update.kind);
    const title = str(update.title);
    const known = toolNames.get(id);
    const name = toolKind ? acpToolName(toolKind, title) : (known ?? (title ? title : "tool"));
    if (!known || (toolKind && name !== known)) toolNames.set(id, name);
    const status = (str(update.status) ?? "").toLowerCase();
    const failed = status === "failed";
    const done = failed || status === "completed";
    const args: Record<string, unknown> = mapToolArgs(asRecord(update.rawInput) ?? {});
    const location = Array.isArray(update.locations) ? asRecord(update.locations[0]) : undefined;
    const locPath = str(location?.path);
    if (locPath && typeof args.path !== "string") args.path = locPath;
    if (title && typeof args.title !== "string") args.title = title;
    const output = acpToolOutput(update);
    return [
      {
        type: "tool_call",
        id,
        name: toolNames.get(id) ?? name,
        status: done ? "completed" : "running",
        arguments: args,
        ...(done
          ? {
              result: failed
                ? JSON.stringify({ isError: true, output: output ?? "failed" })
                : (output ?? ""),
            }
          : {}),
      },
    ];
  }
  return [];
}

function acpToolName(kind: string, title?: string): string {
  switch (kind) {
    case "read":
      return "file_read";
    case "edit":
      return "apply_patch";
    case "delete":
    case "move":
      return "file_write";
    case "search":
      return "grep";
    case "execute":
      return "exec";
    case "fetch":
      return "webfetch";
    case "think":
      return "think";
    default:
      return title ? mapToolName(title) : "tool";
  }
}

function acpContentText(content: unknown): string {
  if (Array.isArray(content)) return content.map(acpContentText).join("");
  const rec = asRecord(content);
  if (!rec) return typeof content === "string" ? content : "";
  if (rec.type === "text" && typeof rec.text === "string") return rec.text;
  if (rec.type === "resource_link") return str(rec.uri) ?? "";
  return "";
}

function acpToolOutput(update: Record<string, unknown>): string | undefined {
  const parts = Array.isArray(update.content) ? update.content : [];
  const texts: string[] = [];
  for (const part of parts) {
    const rec = asRecord(part);
    if (!rec) continue;
    if (rec.type === "content") texts.push(acpContentText(rec.content));
    else if (rec.type === "diff") texts.push(`updated ${str(rec.path) ?? "file"}`);
    else if (rec.type === "terminal") texts.push(`terminal ${str(rec.terminalId) ?? ""}`.trim());
  }
  const joined = texts.filter(Boolean).join("\n");
  if (joined) return joined;
  return update.rawOutput !== undefined ? stringify(update.rawOutput) : undefined;
}

// ---------------------------------------------------------------------------
// ACP client
// ---------------------------------------------------------------------------

type JsonRpcId = number | string;

export class AcpRpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export interface AcpHandlers {
  onNotification(method: string, params: Record<string, unknown>): void;
  /** Agent → client request. Throw AcpRpcError to answer with an error. */
  onRequest(method: string, params: Record<string, unknown>): Promise<unknown> | unknown;
}

/** JSON-RPC 2.0 over newline-delimited stdio, as ACP specifies. */
export class AcpConnection {
  private nextId = 1;
  private readonly pending = new Map<
    JsonRpcId,
    { method: string; resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private closed = false;
  private closeError: Error | undefined;

  constructor(
    private readonly transport: {
      lines: AsyncIterable<string>;
      write: (data: string) => void;
    },
    private readonly handlers: AcpHandlers,
  ) {}

  /** Read until stdout closes. Rejects pending requests with `onClose()`'s error. */
  async run(onClose: () => Promise<Error>): Promise<void> {
    try {
      for await (const line of this.transport.lines) this.dispatch(line);
    } finally {
      this.closed = true;
      if (this.pending.size) {
        const err = await onClose();
        this.closeError = err;
        for (const row of this.pending.values()) row.reject(err);
        this.pending.clear();
      }
    }
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(this.closeError ?? new ProviderError("ACP agent exited"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    if (this.closed) return;
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: Record<string, unknown>): void {
    this.transport.write(`${JSON.stringify(message)}\n`);
  }

  private dispatch(line: string): void {
    const row = jsonObject(line);
    // Agents sometimes log to stdout; anything that is not JSON-RPC is ignored.
    if (!row || row.jsonrpc !== "2.0") return;
    const method = typeof row.method === "string" ? row.method : undefined;
    const hasId = typeof row.id === "number" || typeof row.id === "string";
    const params = asRecord(row.params) ?? {};
    if (method && hasId) {
      void this.answer(row.id as JsonRpcId, method, params);
      return;
    }
    if (method) {
      this.handlers.onNotification(method, params);
      return;
    }
    if (!hasId) return;
    const pending = this.pending.get(row.id as JsonRpcId);
    if (!pending) return;
    this.pending.delete(row.id as JsonRpcId);
    const error = asRecord(row.error);
    if (error) {
      pending.reject(
        new AcpRpcError(
          str(error.message) ?? `ACP ${pending.method} failed`,
          num(error.code) ?? -32603,
          error.data,
        ),
      );
    } else {
      pending.resolve(row.result);
    }
  }

  private async answer(id: JsonRpcId, method: string, params: Record<string, unknown>) {
    try {
      const result = await this.handlers.onRequest(method, params);
      if (!this.closed) this.send({ jsonrpc: "2.0", id, result: result ?? null });
    } catch (err) {
      if (this.closed) return;
      const rpc = err instanceof AcpRpcError ? err : undefined;
      this.send({
        jsonrpc: "2.0",
        id,
        error: {
          code: rpc?.code ?? -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}

/**
 * Answer `session/request_permission` by allowing. Locus does not gate CLI agents per tool
 * here: the session's autonomy / jail / approval gates sit around the Turn (and on Locus MCP
 * tools), the same trust model as Claude Code `-p` or Codex `--full-auto`. Prefer a one-shot
 * allow so the agent keeps asking (and logging) on later calls.
 */
export function pickAcpPermission(params: Record<string, unknown>): Record<string, unknown> {
  const options = (Array.isArray(params.options) ? params.options : [])
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => Boolean(row));
  const pick =
    options.find((row) => row.kind === "allow_once") ??
    options.find((row) => row.kind === "allow_always") ??
    options.find((row) => /allow|yes|approve|proceed/i.test(str(row.name) ?? ""));
  const optionId = str(pick?.optionId);
  return optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" };
}

class EventQueue<T> {
  private readonly items: T[] = [];
  private waiter: (() => void) | undefined;
  private done = false;
  private error: unknown;

  push(item: T): void {
    if (this.done) return;
    this.items.push(item);
    this.wake();
  }

  end(error?: unknown): void {
    if (this.done) return;
    this.done = true;
    this.error = error;
    this.wake();
  }

  private wake(): void {
    const w = this.waiter;
    this.waiter = undefined;
    w?.();
  }

  async *drain(): AsyncGenerator<T> {
    for (;;) {
      if (this.items.length) {
        yield this.items.shift()!;
        continue;
      }
      if (this.done) {
        if (this.error) throw this.error;
        return;
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
  }
}

async function* streamAcp(input: {
  handle: CursorCliSpawnHandle;
  write: (data: string) => void;
  command: string;
  label: string;
  prompt: string;
  workspace: string;
  model?: string;
  resume?: string;
  mcpUrl?: string;
  signal?: AbortSignal;
}): AsyncGenerator<GenericCliEvent> {
  const queue = new EventQueue<GenericCliEvent>();
  const toolNames = new Map<string, string>();
  let replaying = false;
  let sessionId: string | undefined;
  const conn = new AcpConnection(
    { lines: input.handle.lines, write: input.write },
    {
      onNotification: (method, params) => {
        if (method !== "session/update" || replaying) return;
        const update = asRecord(params.update);
        if (!update) return;
        for (const event of parseAcpSessionUpdate(update, toolNames)) {
          queue.push(withoutPartial(event));
        }
      },
      onRequest: (method, params) => {
        if (method === "session/request_permission") {
          return { outcome: pickAcpPermission(params) };
        }
        // We advertise no fs / terminal capabilities, so the agent uses its own tools.
        throw new AcpRpcError(`Method not found: ${method}`, -32601);
      },
    },
  );
  const reader = conn
    .run(async () => {
      let done: { code: number; stderr: string };
      try {
        done = await Promise.race([
          input.handle.wait(),
          delay(2_000).then(() => ({ code: -1, stderr: "" })),
        ]);
      } catch (err) {
        return spawnError(err, input.command, input.label);
      }
      const detail = clip(done.stderr) || `exit ${done.code}`;
      return new ProviderError(`${input.label} (ACP) exited before answering: ${detail}`);
    })
    .catch(() => undefined);
  const onAbort = () => {
    if (sessionId) conn.notify("session/cancel", { sessionId });
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  const drive = (async () => {
    const init = asRecord(
      await conn.request("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: "locus", title: "Locus", version: "1" },
      }),
    );
    const caps = asRecord(init?.agentCapabilities);
    const mcpCaps = asRecord(caps?.mcpCapabilities);
    const mcpServers =
      input.mcpUrl && mcpCaps?.http === true
        ? [{ type: "http", name: "locus", url: input.mcpUrl, headers: [] }]
        : [];
    let created: Record<string, unknown> | undefined;
    const resume = input.resume?.trim();
    if (resume && caps?.loadSession === true) {
      replaying = true;
      try {
        created = asRecord(
          await conn.request("session/load", {
            sessionId: resume,
            cwd: input.workspace,
            mcpServers,
          }),
        );
        sessionId = resume;
      } catch {
        // Stale id (agent restarted, history pruned): start fresh below.
        sessionId = undefined;
      } finally {
        replaying = false;
      }
    }
    if (!sessionId) {
      try {
        created = asRecord(await conn.request("session/new", { cwd: input.workspace, mcpServers }));
      } catch (err) {
        throw acpSessionError(err, input.label);
      }
      sessionId = str(created?.sessionId);
      if (!sessionId) throw new ProviderError(`${input.label} (ACP) returned no sessionId`);
    }
    queue.push({ type: "session", sessionId });
    await maybeSetAcpModel(conn, sessionId, input.model, created);
    if (input.signal?.aborted) return;
    const started = Date.now();
    const result = asRecord(
      await conn.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: input.prompt }],
      }),
    );
    const stopReason = str(result?.stopReason) ?? "end_turn";
    const usage = usageOf(result ?? {});
    if (stopReason === "end_turn" || stopReason === "cancelled") {
      queue.push({
        type: "result",
        status: stopReason === "cancelled" ? "CANCELLED" : "FINISHED",
        durationMs: Date.now() - started,
        ...(usage ? { usage } : {}),
      });
    } else {
      if (usage) queue.push({ type: "usage", ...usage });
      queue.push({ type: "error", message: `${input.label} stopped: ${stopReason}` });
    }
  })();
  drive.then(
    () => queue.end(),
    (err: unknown) => queue.end(err),
  );
  try {
    yield* queue.drain();
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    input.handle.endInput?.();
    void reader;
  }
}

async function maybeSetAcpModel(
  conn: AcpConnection,
  sessionId: string,
  model: string | undefined,
  created: Record<string, unknown> | undefined,
): Promise<void> {
  const wanted = model?.trim();
  if (!wanted) return;
  // `session/set_model` is still marked unstable in ACP; only call it when the agent listed
  // models on session/new and the wanted one is among them.
  const models = asRecord(created?.models);
  const current = str(models?.currentModelId);
  const available = Array.isArray(models?.availableModels) ? models.availableModels : [];
  const listed = available.some((row) => str(asRecord(row)?.modelId) === wanted);
  if (!listed || current === wanted) return;
  try {
    await conn.request("session/set_model", { sessionId, modelId: wanted });
  } catch {
    /* keep the agent's default */
  }
}

function acpSessionError(err: unknown, label: string): Error {
  if (err instanceof AcpRpcError) {
    if (err.code === -32000 || /auth/i.test(err.message)) {
      return new ProviderError(
        `${label} needs to sign in (ACP: ${err.message}). Run the CLI once in a terminal to log in, or set its API key in Settings → Providers.`,
      );
    }
    return new ProviderError(`${label} (ACP) session/new failed: ${err.message}`);
  }
  return err instanceof Error ? err : new ProviderError(String(err));
}

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

export async function* streamGenericCli(input: {
  provider: AiProvider;
  prompt: string;
  workspace: string;
  model?: string;
  resume?: string;
  /** Locus session MCP URL, offered to ACP agents that accept HTTP MCP servers. */
  mcpUrl?: string;
  /** The child's environment before the provider key is added; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  spawnFn?: GenericCliSpawner;
}): AsyncGenerator<GenericCliEvent> {
  const cli = genericCliConfig(input.provider);
  const label = input.provider.name?.trim() || cli.command;
  const argv = buildGenericCliArgv(input);
  const acp = cli.output === "acp";
  const needsStdin = acp || argv.stdin !== undefined;
  const spawnFn = input.spawnFn ?? spawnGenericCli;
  const req: CursorCliSpawnRequest = {
    command: argv.command,
    args: argv.args,
    cwd: argv.cwd,
    env: argv.env,
    signal: input.signal,
    ...(needsStdin ? { interactive: true } : {}),
  };
  let handle: CursorCliSpawnHandle;
  try {
    handle = spawnFn(req);
  } catch (err) {
    throw spawnError(err, argv.command, label);
  }
  try {
    const write = handle.write;
    if (needsStdin && !write) {
      yield {
        type: "error",
        message: acp
          ? `${label}: ACP needs a stdin pipe, which this placement (worker) does not offer yet. Run on this machine or a VM.`
          : `${label}: this placement cannot pipe the prompt to stdin. Put {prompt} in the args.`,
      };
      yield { type: "done" };
      return;
    }
    if (acp && write) {
      yield* streamAcp({
        handle,
        write,
        command: argv.command,
        label,
        prompt: input.prompt,
        workspace: input.workspace,
        model: cliAgentModelArg(input.model),
        resume: input.resume,
        mcpUrl: input.mcpUrl,
        signal: input.signal,
      });
      if (!input.signal?.aborted) await reap(handle, EXIT_GRACE_MS);
      yield { type: "done" };
      return;
    }
    if (argv.stdin !== undefined && write) {
      write(argv.stdin.endsWith("\n") ? argv.stdin : `${argv.stdin}\n`);
      handle.endInput?.();
    }
    let streamedText = false;
    let streamedReasoning = false;
    let sawTerminal = false;
    let sawSession = Boolean(input.resume?.trim());
    let sawAny = false;
    const stray: string[] = [];
    const toolNames = new Map<string, string>();
    let streamedPartialText = false;
    const publish = (event: ParsedEvent): GenericCliEvent | undefined => {
      if (event.type === "text") {
        // A full (non-delta) message after streamed deltas is the final echo: drop it.
        if (!event.partial && streamedPartialText) return undefined;
        if (event.partial) streamedPartialText = true;
        streamedText = true;
      }
      if (event.type === "reasoning") {
        if (!event.partial && streamedReasoning) return undefined;
        streamedReasoning = true;
      }
      if (event.type === "tool_call" && event.id) {
        if (event.status === "running" && event.name !== "tool")
          toolNames.set(event.id, event.name);
        else if (event.name === "tool") event.name = toolNames.get(event.id) ?? event.name;
      }
      const out = withoutPartial(event);
      if (out.type === "session") sawSession = true;
      if (out.type === "result" || out.type === "error") sawTerminal = true;
      if (out.type === "result" && out.text && streamedText) return { ...out, text: undefined };
      return out;
    };
    for await (const line of handle.lines) {
      if (input.signal?.aborted) break;
      let events: ParsedEvent[];
      if (cli.output === "text") {
        events = [{ type: "text", text: `${stripAnsi(line)}\n`, partial: true }];
      } else if (cli.output === "claude-stream-json") {
        events = parseClaudeCodeEventsRaw(line);
      } else {
        events = parseGenericJsonlLine(line);
        if (!events.length && !jsonObject(line)) stray.push(stripAnsi(line));
      }
      for (const event of events) {
        sawAny = true;
        const out = publish(event);
        if (out) yield out;
      }
      if (sawTerminal && cli.output !== "text") break;
    }
    const done = await reap(handle, sawTerminal ? EXIT_GRACE_MS : 30_000);
    if (input.signal?.aborted) {
      yield { type: "done" };
      return;
    }
    if (!sawAny && stray.length) {
      // jsonl configured but the CLI printed plain text: show it rather than nothing.
      yield { type: "text", text: `${stray.join("\n")}\n` };
      streamedText = true;
    }
    if (!sawTerminal) {
      if (done.code !== 0) {
        const detail = clip(done.stderr) || `exit ${done.code}`;
        yield { type: "error", message: `${label} failed: ${detail}` };
        yield { type: "done" };
        return;
      }
      if (!streamedText) {
        const detail = clip(done.stderr);
        yield {
          type: "error",
          message: detail
            ? `${label} finished without a reply: ${detail}`
            : `${label} finished without a reply.`,
        };
      } else {
        yield { type: "result", status: "FINISHED" };
      }
    }
    if (
      !sawSession &&
      cli.resumeArgs?.length &&
      !cli.resumeArgs.some((a) => a.includes("{resume}"))
    ) {
      // resumeArgs such as `--continue` need no id; remember that a thread exists.
      yield { type: "session", sessionId: GENERIC_CLI_CONTINUE };
    }
    yield { type: "done" };
  } catch (err) {
    throw spawnError(err, argv.command, label);
  } finally {
    handle.kill?.();
  }
}

export function spawnGenericCli(req: CursorCliSpawnRequest): CursorCliSpawnHandle {
  return spawnCursorCli(req);
}

export async function listGenericCliModels(
  provider: Pick<AiProvider, "models">,
): Promise<string[]> {
  return provider.models.filter((id) => id.trim());
}

/** `command --version` with a timeout. Never hands provider secrets to the probe. */
export async function checkGenericCli(
  provider: Pick<AiProvider, "name" | "cli">,
  spawnFn: GenericCliSpawner = spawnGenericCli,
): Promise<GenericCliHealth> {
  const label = provider.name?.trim() || "Custom CLI agent";
  const command = provider.cli?.command?.trim() ?? "";
  if (!command) {
    return { ok: false, command, message: `${label} has no command. Pick a preset in Settings.` };
  }
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  const apiKeyEnv = provider.cli?.apiKeyEnv?.trim();
  if (apiKeyEnv) delete env[apiKeyEnv];
  let handle: CursorCliSpawnHandle;
  try {
    handle = spawnFn({ command, args: ["--version"], cwd: process.cwd(), env });
  } catch (err) {
    return { ok: false, command, message: spawnError(err, command, label).message };
  }
  try {
    const lines: string[] = [];
    const collect = (async () => {
      for await (const line of handle.lines) lines.push(line);
      return handle.wait();
    })();
    const result = await Promise.race([
      collect,
      delay(HEALTH_TIMEOUT_MS).then(() => "timeout" as const),
    ]);
    if (result === "timeout") {
      return { ok: false, command, message: `${label}: \`${command} --version\` timed out.` };
    }
    const text = `${lines.join("\n")}\n${result.stderr}`;
    const version = text.match(/(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]+)?)/)?.[1];
    if (result.code !== 0) {
      return {
        ok: false,
        command,
        ...(version ? { version } : {}),
        message:
          `${label}: \`${command} --version\` exited ${result.code}. ${clip(result.stderr)}`.trim(),
      };
    }
    return { ok: true, command, ...(version ? { version } : {}) };
  } catch (err) {
    return { ok: false, command, message: spawnError(err, command, label).message };
  } finally {
    handle.kill?.();
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function spawnError(err: unknown, command: string, label: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
  if (code === "ENOENT" || /ENOENT/.test(message)) {
    return new ProviderError(
      `${label} (${command}) is not on PATH. Install it, or set the full command path in Settings → Providers.`,
    );
  }
  return new ProviderError(message.trim() || `${label} failed`);
}

async function reap(
  handle: CursorCliSpawnHandle,
  graceMs: number,
): Promise<{ code: number; stderr: string }> {
  const exited = handle.wait();
  const winner = await Promise.race([exited, delay(graceMs).then(() => "timeout" as const)]);
  if (winner !== "timeout") return winner;
  handle.kill?.();
  return Promise.race([
    exited,
    delay(2_000).then(() => ({ code: 1, stderr: "CLI agent did not exit" })),
  ]);
}

function withoutPartial(event: ParsedEvent): GenericCliEvent {
  const rest = { ...event };
  delete rest.partial;
  return rest;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function stripAnsi(text: string): string {
  return text.replace(new RegExp(`${"\u001b"}\\[[0-9;?]*[A-Za-z]`, "g"), "");
}

function clip(text: string, max = 400): string {
  const cleaned = stripAnsi(text).trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(-max).trimStart()}`;
}

function jsonObject(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    return asRecord(JSON.parse(trimmed) as unknown);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeKind(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[._\-/]+/g, "");
}

function kindOf(row: Record<string, unknown>): string {
  return normalizeKind(str(row.type) ?? str(row.event) ?? str(row.kind) ?? "");
}

function sessionIdOf(row: Record<string, unknown>): string | undefined {
  for (const rec of [row, asRecord(row.data), asRecord(row.session)]) {
    if (!rec) continue;
    const id =
      str(rec.session_id) ??
      str(rec.sessionId) ??
      str(rec.thread_id) ??
      str(rec.threadId) ??
      str(rec.conversation_id) ??
      str(rec.conversationId);
    if (id) return id.trim();
  }
  return undefined;
}

function contentParts(row: Record<string, unknown>): unknown[] {
  const message = asRecord(row.message);
  const content = message?.content ?? row.content;
  return Array.isArray(content) ? content : [];
}

function partText(part: unknown): string {
  if (typeof part === "string") return part;
  const rec = asRecord(part);
  if (!rec) return "";
  const kind = kindOf(rec);
  if (kind && kind !== "text" && kind !== "outputtext") return "";
  return typeof rec.text === "string" ? rec.text : "";
}

function textOf(row: Record<string, unknown>): string {
  if (typeof row.text === "string") return row.text;
  if (typeof row.delta === "string") return row.delta;
  const message = asRecord(row.message);
  const content = message?.content ?? row.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(partText).join("");
  const rec = asRecord(content);
  if (rec && typeof rec.text === "string") return rec.text;
  if (typeof row.message === "string") return row.message;
  return "";
}

function thinkingOf(row: Record<string, unknown>): string {
  if (typeof row.thinking === "string") return row.thinking;
  if (typeof row.reasoning === "string") return row.reasoning;
  return contentParts(row)
    .map((part) => {
      const rec = asRecord(part);
      if (!rec) return "";
      if (typeof rec.thinking === "string") return rec.thinking;
      const kind = kindOf(rec);
      return (kind === "thinking" || kind === "reasoning") && typeof rec.text === "string"
        ? rec.text
        : "";
    })
    .join("");
}

function usageOf(
  row: Record<string, unknown>,
): (TokenUsageEvent & { window?: number }) | undefined {
  const usage = asRecord(row.usage) ?? asRecord(row.stats) ?? asRecord(row.tokens);
  if (!usage) return undefined;
  const input =
    num(usage.input_tokens) ??
    num(usage.inputTokens) ??
    num(usage.prompt_tokens) ??
    num(usage.promptTokens) ??
    num(usage.input);
  const output =
    num(usage.output_tokens) ??
    num(usage.outputTokens) ??
    num(usage.completion_tokens) ??
    num(usage.candidates_tokens) ??
    num(usage.output);
  if (input == null && output == null) return undefined;
  const cached =
    num(usage.cached_input_tokens) ??
    num(usage.cachedInputTokens) ??
    num(usage.cached) ??
    num(usage.cache_read_input_tokens);
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    ...(cached != null ? { cachedInputTokens: cached } : {}),
  };
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stringify(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const texts = value.map(partText).filter(Boolean);
    if (texts.length) return texts.join("\n");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
