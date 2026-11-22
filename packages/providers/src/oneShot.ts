import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cliPromptCharLimit,
  estimateTokens,
  isClaudeCodeProvider,
  isCodexCliProvider,
  isCursorCliProvider,
  isGenericCliProvider,
  isKiroCliProvider,
} from "@locus/shared";
import { streamClaudeCode } from "./claudeCode.js";
import { streamCodexCli } from "./codexCli.js";
import { streamCursorCli, type CursorCliSpawner } from "./cursorCli.js";
import { streamGenericCli } from "./genericCli.js";
import { scrubCliEnv } from "./cliEnv.js";
import { streamKiroCli } from "./kiroCli.js";
import { completeChat } from "./router.js";
import {
  mergeTokenUsage,
  readTokenUsage,
  type ChatEvent,
  type CompleteRequest,
  type FetchFn,
  type TokenUsageEvent,
} from "./types.js";

/** A CLI agent's stream, as the one-shot path sees it. */
export type OneShotCliStream = (input: {
  provider: CompleteRequest["provider"];
  prompt: string;
  workspace: string;
  model?: string;
  mode: "plan";
  signal?: AbortSignal;
  /** The child's environment; undefined means the stream's default (`process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Spawns the CLI process; undefined means the stream's default spawner. */
  spawnFn?: CursorCliSpawner;
}) => AsyncIterable<{
  type: string;
  text?: string;
  message?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  usage?: unknown;
  id?: string;
  name?: string;
  status?: string;
  arguments?: Record<string, unknown>;
  result?: string;
}>;

/**
 * What a CLI agent did on its way to the reply: reasoning chunks, tool calls as they start, and
 * their results. API providers yield reasoning and tool calls as ordinary events instead.
 */
export type OneShotTraceEvent =
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; output: string };

function cliStreamFor(provider: CompleteRequest["provider"]): OneShotCliStream | undefined {
  if (isClaudeCodeProvider(provider)) return streamClaudeCode;
  if (isCodexCliProvider(provider)) return streamCodexCli;
  if (isCursorCliProvider(provider)) return streamCursorCli;
  if (isKiroCliProvider(provider)) return streamKiroCli;
  if (isGenericCliProvider(provider)) return streamGenericCli;
  return undefined;
}

/**
 * Folds system + messages into one prompt for a CLI that takes a single argument. With
 * `readWorkspace` the CLI runs in a checkout it should read, so it is not told to stay off files.
 */
export function oneShotCliPrompt(
  req: Pick<CompleteRequest, "system" | "messages">,
  opts: { readWorkspace?: boolean } = {},
): string {
  const turns = req.messages
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter((text) => text.trim());
  return [
    req.system.trim(),
    opts.readWorkspace
      ? "Answer in this reply only. You may read and search files in the current folder; do not edit files or run commands that change anything."
      : "Answer in this reply only. Do not use tools, read files or edit files.",
    ...turns,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A single no-tools completion from any provider that can answer one: API
 * providers go through completeChat; local CLI agents (Claude Code, Codex,
 * Cursor CLI, Kiro, custom CLIs) are spawned read-only in an empty scratch
 * directory and their reply text is passed through, with token usage when the
 * CLI reports it. A prompt longer than the command line allows throws before
 * spawning. Cursor Cloud still throws: it needs a repository to run against.
 *
 * `workspace` runs the CLI (still in plan / read-only mode) in that folder instead of an empty
 * scratch one, and tells it it may read there. The caller owns the folder; it is not deleted.
 * API providers ignore it.
 *
 * `isolateEnv` gives a CLI child a {@link scrubCliEnv} copy of `process.env` (credentials removed;
 * the provider's own configured key is still added). API providers ignore it.
 *
 * `onUsage` receives the running usage snapshot each time the provider reports usage (CLI
 * `usage` / `result` events, API `usage` events), so a caller can abort via `req.signal` once a
 * spend cap is passed. It does not change what is yielded.
 *
 * `onTrace` receives a CLI agent's reasoning and tool activity, which the one-shot stream
 * otherwise drops (only the reply text is yielded). API providers never call it.
 *
 * `spawnFor` is called with the folder the CLI will run in (the caller's `workspace` or the
 * scratch one) before it starts, and returns the spawner to use, e.g. one that wraps the CLI
 * in a sandbox with that folder writable; undefined keeps the default. If it throws, the CLI
 * does not start and the error is thrown from here. API providers never call it.
 */
export async function* completeOneShot(
  req: CompleteRequest,
  opts: {
    fetchFn?: FetchFn;
    cliStream?: OneShotCliStream;
    promptLimit?: number;
    workspace?: string;
    isolateEnv?: boolean;
    onUsage?: (usage: TokenUsageEvent) => void;
    onTrace?: (event: OneShotTraceEvent) => void;
    spawnFor?: (workspace: string) => CursorCliSpawner | undefined;
  } = {},
): AsyncGenerator<ChatEvent> {
  const stream = opts.cliStream ?? cliStreamFor(req.provider);
  if (!stream) {
    let running: TokenUsageEvent | undefined;
    for await (const ev of completeChat(req, opts.fetchFn)) {
      if (ev.type === "usage") {
        const usage = readTokenUsage(ev);
        running = mergeTokenUsage(running, usage);
        if (usage && running) opts.onUsage?.(running);
      }
      yield ev;
    }
    return;
  }
  const prompt = oneShotCliPrompt(req, { readWorkspace: Boolean(opts.workspace) });
  const limit = opts.promptLimit ?? cliPromptCharLimit(process.platform);
  if (prompt.length > limit) {
    throw new Error(
      `prompt is ${prompt.length.toLocaleString("en-US")} characters; CLI agents take it on the command line, which allows ${limit.toLocaleString("en-US")} here`,
    );
  }
  const owned = !opts.workspace;
  const workspace = opts.workspace ?? (await mkdtemp(join(tmpdir(), "locus-oneshot-")));
  const errors: string[] = [];
  let sawText = false;
  let replyChars = 0;
  // Some CLIs report running usage snapshots, some only a final result, some both. Prefer the
  // latest snapshot, like the chat turn path does.
  let eventUsage: TokenUsageEvent | undefined;
  let resultUsage: TokenUsageEvent | undefined;
  try {
    const spawnFn = opts.spawnFor?.(workspace);
    for await (const ev of stream({
      provider: req.provider,
      prompt,
      workspace,
      model: req.model || undefined,
      mode: "plan",
      signal: req.signal,
      ...(opts.isolateEnv ? { env: scrubCliEnv(process.env) } : {}),
      ...(spawnFn ? { spawnFn } : {}),
    })) {
      if (ev.type === "text" && ev.text) {
        sawText = true;
        replyChars += ev.text.length;
        yield { type: "text", text: ev.text };
      } else if (ev.type === "reasoning" && ev.text) {
        opts.onTrace?.({ type: "reasoning", text: ev.text });
      } else if (ev.type === "tool_call" && opts.onTrace) {
        const id = ev.id || ev.name || "tool";
        const name = ev.name || "tool";
        if (ev.status === "completed") {
          opts.onTrace({ type: "tool_result", id, name, output: ev.result ?? "" });
        } else {
          opts.onTrace({ type: "tool_call", id, name, arguments: ev.arguments ?? {} });
        }
      } else if (ev.type === "error" && ev.message) {
        errors.push(ev.message);
      } else if (ev.type === "usage") {
        const usage = readTokenUsage(ev);
        eventUsage = mergeTokenUsage(eventUsage, usage);
        const running = eventUsage ?? resultUsage;
        if (usage && running) opts.onUsage?.(running);
      } else if (ev.type === "result" && ev.usage) {
        const usage = readTokenUsage(ev.usage);
        resultUsage = usage ?? resultUsage;
        const running = eventUsage ?? resultUsage;
        if (usage && running) opts.onUsage?.(running);
      }
    }
  } finally {
    if (owned) await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
  if (!sawText && errors.length) throw new Error(errors.join("\n"));
  const usage = eventUsage ?? resultUsage;
  if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
    yield { type: "usage", ...usage };
  } else if (sawText) {
    // The CLI reported no token counts (Kiro meters in credits and never does): estimate from the
    // prompt and reply so callers don't show 0 / 0. Tool reads the CLI did on its own are missed.
    yield {
      type: "usage",
      inputTokens: estimateTokens(prompt),
      outputTokens: Math.ceil(replyChars / 4),
      estimated: true,
    };
  }
}
