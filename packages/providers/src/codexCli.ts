import {
  CODEX_CLI_BASE_URL,
  CODEX_CLI_MODELS,
  codexCliReasoningEfforts,
  isCodexCliBase,
  normalizeCodexCliModel,
  type CodexReasoningEffort,
  type AiProvider,
} from "@locus/shared";
import { cursorCliSpawnFailureMessage } from "@locus/shared/windowsCliSpawn";
import {
  spawnCursorCli,
  type CursorCliSpawnHandle,
  type CursorCliSpawnRequest,
  type CursorCliSpawner,
} from "./cursorCli.js";
import { ProviderError, readTokenUsage, type TokenUsageEvent } from "./types.js";

export type CodexCliEvent =
  | { type: "session"; sessionId: string }
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      status: "running" | "completed";
      arguments: Record<string, unknown>;
      result?: string;
    }
  | ({ type: "usage" } & TokenUsageEvent)
  | {
      type: "result";
      status: string;
      text?: string;
      usage?: TokenUsageEvent;
    }
  | { type: "error"; message: string; terminal?: boolean }
  | { type: "done" };

export type CodexCliSpawner = CursorCliSpawner;
export type CodexCliSpawnRequest = CursorCliSpawnRequest;
export type CodexCliSpawnHandle = CursorCliSpawnHandle;

export interface CodexCliArgv {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export type CodexCliAuthMode = "chatgpt" | "api-key" | "missing";

export type CodexMcpKind = "git" | "canvas" | "review";

export const CODEX_GIT_MCP_TOOLS = [
  "git_status",
  "git_diff",
  "git_log",
  "git_branch",
  "git_commit",
  "git_fetch",
  "git_push",
  "git_pr",
] as const;

export const CODEX_REVIEW_MCP_TOOLS = [
  "git_pr_list",
  "git_pr_get",
  "git_pr_loadpath",
  "git_pr_comment",
  "git_pr_review",
  "git_pr_checks",
] as const;

export function codexMcpEnabledTools(kind: CodexMcpKind = "git"): string[] {
  if (kind === "canvas") return ["playwright", ...CODEX_GIT_MCP_TOOLS];
  if (kind === "review") return [...CODEX_REVIEW_MCP_TOOLS];
  return [...CODEX_GIT_MCP_TOOLS];
}

export type CodexCliHealth = {
  ok: boolean;
  command: string;
  version?: string;
  authenticated: boolean;
  authMode: CodexCliAuthMode;
  message?: string;
};

const CODEX_HEALTH_TIMEOUT_MS = 5_000;

export function resolveCodexCliCommand(
  provider: Pick<AiProvider, "baseUrl">,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; prefixArgs: string[] } {
  const explicit = provider.baseUrl?.trim();
  if (explicit && isCodexCliBinaryPath(explicit)) {
    return { command: explicit, prefixArgs: [] };
  }
  const fromEnv = (env.LOCUS_CODEX_CLI ?? env.CODEX_CLI ?? "").trim();
  if (fromEnv) return { command: fromEnv, prefixArgs: [] };
  return { command: "codex", prefixArgs: [] };
}

function isCodexCliBinaryPath(value: string): boolean {
  if (!value || isCodexCliBase(value) || value === CODEX_CLI_BASE_URL) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.includes("://")) return false;
  return Boolean(value);
}

export function buildCodexCliArgv(input: {
  provider: Pick<AiProvider, "baseUrl" | "apiKey" | "extraHeaders">;
  prompt: string;
  workspace: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  resume?: string;
  mode?: "agent" | "plan";
  webSearch?: boolean;
  review?: boolean;
  /** Session-scoped Locus Git/canvas/review bridge; credentials remain in the control plane. */
  gitMcpUrl?: string;
  /** Design/Games/Assets get playwright; review gets git_pr_*; coding stays git-only. */
  mcpKind?: CodexMcpKind;
  env?: NodeJS.ProcessEnv;
}): CodexCliArgv {
  const env = input.env ?? process.env;
  const { command, prefixArgs } = resolveCodexCliCommand(input.provider, env);
  const resume = input.resume?.trim();
  const args = [...prefixArgs, "--cd", input.workspace];
  const mcpKind = input.mcpKind ?? (input.review ? "review" : "git");
  const gitMcpUrl = input.mode !== "plan" ? input.gitMcpUrl : undefined;
  if (gitMcpUrl) {
    args.push(
      "--config",
      `mcp_servers.locus_git.url=${JSON.stringify(gitMcpUrl)}`,
      "--config",
      "mcp_servers.locus_git.enabled=true",
      // The host turn runs non-interactively, while Locus still enforces its
      // own authorization, branch, and test gates for every Git operation.
      "--config",
      'mcp_servers.locus_git.default_tools_approval_mode="approve"',
      "--config",
      "mcp_servers.locus_git.required=true",
      "--config",
      `mcp_servers.locus_git.enabled_tools=${JSON.stringify(codexMcpEnabledTools(mcpKind))}`,
      // Push/PR includes the Locus test gate, which may take ten minutes.
      "--config",
      "mcp_servers.locus_git.tool_timeout_sec=900",
    );
  }
  if (input.webSearch === true && input.mode !== "plan") args.push("--search");
  if (input.mode === "plan" || input.review) {
    args.push("--sandbox", "read-only");
  } else {
    args.push("--sandbox", "workspace-write");
  }
  args.push("--ask-for-approval", "never", "exec");
  if (resume) args.push("resume", resume);
  args.push("--json", "--skip-git-repo-check");
  const model = input.model?.trim() ? normalizeCodexCliModel(input.model) : undefined;
  if (model) args.push("--model", model);
  const reasoningEffort = input.reasoningEffort;
  if (reasoningEffort && codexCliReasoningEfforts(model ?? "").includes(reasoningEffort)) {
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
  }
  const apiKey = input.provider.apiKey?.trim();
  args.push("--", input.prompt);
  return {
    command,
    args,
    cwd: input.workspace,
    env: {
      ...env,
      ...(apiKey && !apiKey.includes("•") ? { OPENAI_API_KEY: apiKey } : {}),
      // GPT-5.6 Codex CLI releases can omit dynamically registered MCP tools
      // from the callable namespace. The prompt uses this turn-scoped URL as
      // a JSON-RPC transport fallback while Locus still enforces every gate.
      ...(gitMcpUrl ? { LOCUS_GIT_MCP_URL: gitMcpUrl } : {}),
    },
  };
}

export async function checkCodexCli(
  provider: Pick<AiProvider, "baseUrl" | "apiKey">,
  spawnFn: CodexCliSpawner = spawnCodexCli,
): Promise<CodexCliHealth> {
  const { command, prefixArgs } = resolveCodexCliCommand(provider);
  // Health checks run an executable selected by configuration. Never expose a
  // provider secret to that executable, even when it is a custom wrapper.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.OPENAI_API_KEY;
  const versionProbe = await runCodexProbe(spawnFn, {
    command,
    args: [...prefixArgs, "--version"],
    cwd: process.cwd(),
    env,
  });
  const version = parseCodexVersion(versionProbe.stdout) ?? parseCodexVersion(versionProbe.stderr);
  if (versionProbe.code !== 0) {
    return {
      ok: false,
      command,
      ...(version ? { version } : {}),
      authenticated: false,
      authMode: "missing",
      message: `Codex CLI is unavailable or failed its version check. Install Codex CLI and ensure \`${command}\` is on PATH.`,
    };
  }

  const hasApiKey = Boolean(provider.apiKey?.trim() && !provider.apiKey.includes("•"));
  const loginProbe = await runCodexProbe(spawnFn, {
    command,
    args: [...prefixArgs, "login", "status"],
    cwd: process.cwd(),
    env,
  });
  if (hasApiKey) {
    return {
      ok: true,
      command,
      ...(version ? { version } : {}),
      // Presence of a key is configuration, not proof that the key is valid.
      authenticated: false,
      authMode: "api-key",
    };
  }
  const loginOutput = `${loginProbe.stdout}\n${loginProbe.stderr}`;
  if (loginProbe.code === 0 && isPositiveCodexLoginStatus(loginOutput)) {
    return {
      ok: true,
      command,
      ...(version ? { version } : {}),
      authenticated: true,
      authMode: "chatgpt",
    };
  }
  return {
    ok: false,
    command,
    ...(version ? { version } : {}),
    authenticated: false,
    authMode: "missing",
    message: "Codex CLI is not authenticated. Run `codex login` or configure an API key.",
  };
}

export function parseCodexCliLine(line: string): CodexCliEvent | undefined {
  return parseCodexCliEvents(line)[0];
}

export function parseCodexCliEvents(line: string): CodexCliEvent[] {
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
  if (type === "thread.started") {
    const sessionId = stringValue(row.thread_id) ?? stringValue(row.threadId);
    return sessionId ? [{ type: "session", sessionId }] : [];
  }
  if (type === "turn.failed" || type === "error") {
    return [{ type: "error", message: errorMessage(row, "Codex CLI failed"), terminal: true }];
  }
  if (type === "turn.completed") {
    const usage = readTokenUsage(row.usage);
    return [
      ...(usage ? [{ type: "usage" as const, ...usage }] : []),
      { type: "result", status: "FINISHED", ...(usage ? { usage } : {}) },
    ];
  }
  if (type !== "item.started" && type !== "item.updated" && type !== "item.completed") return [];
  const item = asRecord(row.item);
  if (!item) return [];
  const itemType = stringValue(item.type) ?? "";
  if (itemType === "agent_message") {
    if (type !== "item.completed") return [];
    const text = itemText(item);
    return text ? [{ type: "text", text }] : [];
  }
  if (itemType === "reasoning") {
    const text = itemText(item);
    return text ? [{ type: "reasoning", text }] : [];
  }
  const tool = codexToolCall(item, type === "item.completed");
  return tool ? [tool] : [];
}

function codexToolCall(
  item: Record<string, unknown>,
  completed: boolean,
): CodexCliEvent | undefined {
  const itemType = stringValue(item.type) ?? "";
  const name = codexToolName(itemType, item);
  if (!name) return undefined;
  const id = stringValue(item.id) ?? stringValue(item.call_id) ?? `${itemType}:${name}`;
  const argumentsValue =
    itemType === "command_execution"
      ? { command: stringValue(item.command) ?? "" }
      : asObject(parseMaybeJson(item.arguments ?? item.input ?? item.params ?? item.changes));
  const result = completed ? codexToolResult(item) : undefined;
  return {
    type: "tool_call",
    id,
    name,
    status: completed ? "completed" : "running",
    arguments: argumentsValue,
    ...(result !== undefined ? { result } : {}),
  };
}

function codexToolName(itemType: string, item: Record<string, unknown>): string | undefined {
  if (itemType === "command_execution") return "exec";
  if (itemType === "file_change") return "apply_patch";
  if (itemType === "mcp_tool_call") {
    return stringValue(item.tool) ?? stringValue(item.name) ?? "tool";
  }
  if (itemType === "web_search") return "websearch";
  if (itemType === "todo_list") return "task_list";
  return undefined;
}

function codexToolResult(item: Record<string, unknown>): string | undefined {
  const value =
    item.type === "command_execution"
      ? {
          output: item.aggregated_output ?? item.output,
          exit_code: item.exit_code ?? item.exitCode,
        }
      : (item.result ?? item.output ?? item.error);
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  return stringify(value);
}

function itemText(item: Record<string, unknown>): string {
  const direct = stringValue(item.text);
  if (direct) return direct;
  const summary = item.summary;
  if (Array.isArray(summary)) {
    return summary
      .map((part) => (typeof part === "string" ? part : (stringValue(asRecord(part)?.text) ?? "")))
      .join("");
  }
  const content = item.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (stringValue(asRecord(part)?.text) ?? "")))
      .join("");
  }
  return "";
}

function errorMessage(row: Record<string, unknown>, fallback: string): string {
  const error = asRecord(row.error);
  return stringValue(error?.message) ?? stringValue(row.message) ?? fallback;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? (value == null ? {} : { value });
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function* streamCodexCli(input: {
  provider: AiProvider;
  prompt: string;
  workspace: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  resume?: string;
  mode?: "agent" | "plan";
  webSearch?: boolean;
  review?: boolean;
  gitMcpUrl?: string;
  mcpKind?: CodexMcpKind;
  signal?: AbortSignal;
  spawnFn?: CodexCliSpawner;
}): AsyncGenerator<CodexCliEvent> {
  const argv = buildCodexCliArgv(input);
  const spawnFn = input.spawnFn ?? spawnCodexCli;
  let handle: CodexCliSpawnHandle;
  try {
    handle = spawnFn({
      command: argv.command,
      args: argv.args,
      cwd: argv.cwd,
      env: argv.env,
      signal: input.signal,
    });
  } catch (err) {
    throw rewriteCodexSpawnError(err, argv.command);
  }
  let sawTerminal = false;
  try {
    for await (const line of handle.lines) {
      if (input.signal?.aborted) break;
      for (const event of parseCodexCliEvents(line)) {
        if (event.type === "result" || (event.type === "error" && event.terminal)) {
          sawTerminal = true;
        }
        yield event;
      }
      if (sawTerminal) break;
    }
    const done = await reapCodexCli(handle, 5_000);
    if (!sawTerminal && !input.signal?.aborted && done.code !== 0) {
      const detail = done.stderr.trim() || `exit ${done.code}`;
      yield { type: "error", message: `Codex CLI failed: ${detail}` };
    }
    yield { type: "done" };
  } catch (err) {
    throw rewriteCodexSpawnError(err, argv.command);
  } finally {
    handle.kill?.();
  }
}

export function spawnCodexCli(req: CodexCliSpawnRequest): CodexCliSpawnHandle {
  return spawnCursorCli(req);
}

export async function listCodexCliModels(provider: AiProvider): Promise<string[]> {
  const models = provider.models.filter((id) => id.trim());
  return models.length ? [...models] : [...CODEX_CLI_MODELS];
}

async function runCodexProbe(
  spawnFn: CodexCliSpawner,
  req: CursorCliSpawnRequest,
): Promise<{ code: number; stdout: string; stderr: string }> {
  let handle: CodexCliSpawnHandle;
  try {
    handle = spawnFn(req);
  } catch (err) {
    throw rewriteCodexSpawnError(err, req.command);
  }
  try {
    const lines: string[] = [];
    const collect = (async () => {
      for await (const line of handle.lines) lines.push(line);
      return handle.wait();
    })();
    const result = await Promise.race([
      collect,
      delay(CODEX_HEALTH_TIMEOUT_MS).then(() => {
        throw new ProviderError("Codex CLI health check timed out.");
      }),
    ]);
    return { code: result.code, stdout: lines.join("\n"), stderr: result.stderr };
  } catch (err) {
    throw rewriteCodexSpawnError(err, req.command);
  } finally {
    handle.kill?.();
  }
}

function parseCodexVersion(text: string): string | undefined {
  const match = text.match(/codex(?:-cli)?\s+v?(\d+(?:\.\d+){1,3})/i);
  return match?.[1];
}

function isPositiveCodexLoginStatus(text: string): boolean {
  if (/(?:not|no)\s+(?:logged|auth)|logged\s+out|authentication\s+required/i.test(text)) {
    return false;
  }
  return /logged\s+in|authenticated|using\s+ChatGPT/i.test(text);
}

function rewriteCodexSpawnError(err: unknown, command: string): ProviderError {
  if (err instanceof ProviderError) return err;
  return new ProviderError(
    cursorCliSpawnFailureMessage(err, command).replace(/Cursor CLI/g, "Codex CLI"),
  );
}

async function reapCodexCli(
  handle: CodexCliSpawnHandle,
  killAfterMs: number,
): Promise<{ code: number; stderr: string }> {
  const exited = handle.wait();
  const winner = await Promise.race([exited, delay(killAfterMs).then(() => "timeout" as const)]);
  if (winner !== "timeout") return winner;
  handle.kill?.();
  return Promise.race([
    exited,
    delay(2_000).then(() => ({ code: 1, stderr: "Codex CLI did not exit" })),
  ]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
