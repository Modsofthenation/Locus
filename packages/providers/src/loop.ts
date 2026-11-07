import { isLocalOpenAiBase } from "@locus/shared";
import { isUnknownStopError, type ChatEvent, type CompleteRequest } from "./types.js";
import {
  isAbortError,
  isRetryableProviderError,
  isTimeoutError,
  PROVIDER_RETRY_DELAYS_MS,
  providerTimeoutError,
  sleep,
  timeoutClock,
} from "./retry.js";
import { defaultCompletionBudget } from "./openai.js";

/** Silence limit: abort only when the provider sends nothing, not when a long stream is still alive. */
export const DEFAULT_PROVIDER_IDLE_MS = 180_000;
/**
 * Local Ollama / LM Studio loads and Qwen-style thinking can sit on HTTP with no SSE
 * for several minutes. Explicit `idleMs` (including 0) still wins.
 */
export const LOCAL_PROVIDER_IDLE_MS = 600_000;
/** Safety wall when the session has no time budget. Pass `timeoutMs: 0` to disable. */
export const DEFAULT_PROVIDER_DEADLINE_MS = 30 * 60 * 1000;
/** @deprecated Same value as DEFAULT_PROVIDER_IDLE_MS; kept for callers that imported the old name. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = DEFAULT_PROVIDER_IDLE_MS;
/** Idle / hang retries before any tokens. Transient errors use delaysMs.length instead. */
export const IDLE_RETRY_LIMIT = 1;

export interface ChatTurnOptions {
  /** Hard deadline from the start of this turn. Omitted uses DEFAULT_PROVIDER_DEADLINE_MS; 0 means no wall-clock cap. */
  timeoutMs?: number;
  /** Abort if no stream activity for this long. Defaults to DEFAULT_PROVIDER_IDLE_MS. */
  idleMs?: number;
  /** Completion token cap. Defaults to the provider budget (32k OpenCode, 4096 Anthropic). */
  maxTokens?: number;
  /** Prompt size for this call. Stretches idle when the window is already hot. */
  promptTokens?: number;
  contextWindow?: number;
  /** User/tool screenshots in this prompt; first-token latency is higher. */
  hasImages?: boolean;
  delaysMs?: number[];
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    error: unknown;
    reason: TurnRetryReason;
  }) => void;
}

export type ChatEngine = (req: CompleteRequest) => AsyncGenerator<ChatEvent>;

/** Three budgets for one provider turn: silence, wall clock, and completion tokens. */
export interface StreamBudget {
  idleMs: number;
  deadlineMs: number;
  maxTokens?: number;
}

export type TurnRetryReason = "idle" | "transient";

/** Fill ratio at which first-token latency is treated as context-rot, not a hang. */
export const HOT_CONTEXT_FILL = 0.7;
export const HOT_CONTEXT_IDLE_MULT = 1.5;

export const STREAM_RETRY_HINTS: Record<TurnRetryReason, string> = {
  idle: "The provider went silent before a reply. Continue from the scratchpad and last tool result. Call a tool or write a short status now — do not restart the investigation.",
  transient:
    "The previous attempt produced no reply. Call a tool or write a short operator-facing status now. Do not restart the investigation.",
};

export function contextAwareIdleMs(
  baseMs: number,
  opts: { promptTokens?: number; contextWindow?: number; hasImages?: boolean } = {},
): number {
  let ms = baseMs;
  if (opts.hasImages) ms = Math.round(ms * 1.5);
  const window = opts.contextWindow;
  const used = opts.promptTokens;
  if (
    window == null ||
    used == null ||
    !Number.isFinite(window) ||
    !Number.isFinite(used) ||
    window <= 0 ||
    used <= 0 ||
    used / window < HOT_CONTEXT_FILL
  ) {
    return ms;
  }
  return Math.round(ms * HOT_CONTEXT_IDLE_MULT);
}

export function withStreamRetryHint(
  req: CompleteRequest,
  reason: TurnRetryReason,
): CompleteRequest {
  const hint = STREAM_RETRY_HINTS[reason];
  if (req.volatilePrefix?.includes(hint)) return req;
  return {
    ...req,
    volatilePrefix: [req.volatilePrefix, hint].filter(Boolean).join("\n\n"),
  };
}

export type TurnRetryDecision =
  { retry: false } | { retry: true; delayMs: number; reason: TurnRetryReason };

export interface TurnRetryContext {
  error: unknown;
  userAborted: boolean;
  yielded: boolean;
  idleTimeouts: number;
  attempt: number;
  delaysMs: number[];
  remainingMs: number;
}

export function resolveStreamBudget(
  req: Pick<CompleteRequest, "maxTokens" | "provider">,
  opts: ChatTurnOptions = {},
): StreamBudget {
  const maxTokens = opts.maxTokens ?? req.maxTokens ?? defaultCompletionBudget(req.provider);
  const idleBase = opts.idleMs ?? DEFAULT_PROVIDER_IDLE_MS;
  let idleMs = contextAwareIdleMs(idleBase, opts);
  if (opts.idleMs == null && isLocalOpenAiBase(req.provider.baseUrl)) {
    idleMs = Math.max(idleMs, LOCAL_PROVIDER_IDLE_MS);
  }
  return {
    idleMs,
    deadlineMs: opts.timeoutMs === undefined ? DEFAULT_PROVIDER_DEADLINE_MS : opts.timeoutMs,
    ...(maxTokens != null ? { maxTokens } : {}),
  };
}

export function decideTurnRetry(ctx: TurnRetryContext): TurnRetryDecision {
  if (ctx.userAborted || ctx.yielded) return { retry: false };
  if (ctx.remainingMs <= 0) return { retry: false };
  if (ctx.attempt >= ctx.delaysMs.length) return { retry: false };
  const clock = timeoutClock(ctx.error);
  if (clock === "deadline") return { retry: false };
  const idle = clock === "idle" || isTimeoutError(ctx.error);
  const transient = !idle && isRetryableProviderError(ctx.error);
  if (!idle && !transient) return { retry: false };
  if (idle && ctx.idleTimeouts >= IDLE_RETRY_LIMIT) return { retry: false };
  const delayMs = ctx.delaysMs[ctx.attempt]!;
  if (delayMs >= ctx.remainingMs) return { retry: false };
  return { retry: true, delayMs, reason: idle ? "idle" : "transient" };
}

function mergeSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const listed = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (!listed.length) return undefined;
  if (listed.length === 1) return listed[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(listed);
  const ctrl = new AbortController();
  for (const signal of listed) {
    if (signal.aborted) {
      ctrl.abort(signal.reason);
      return ctrl.signal;
    }
    signal.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true });
  }
  return ctrl.signal;
}

function createIdleController(
  idleMs: number,
  parent?: AbortSignal,
): { signal: AbortSignal; poke: () => void; dispose: () => void } {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = (reason: unknown) => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!ctrl.signal.aborted) ctrl.abort(reason);
  };
  const arm = () => {
    if (ctrl.signal.aborted) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => abort(providerTimeoutError(idleMs)), idleMs);
  };
  const onParent = () => abort(parent?.reason);
  if (parent?.aborted) {
    abort(parent.reason);
  } else {
    parent?.addEventListener("abort", onParent, { once: true });
    arm();
  }
  return {
    signal: ctrl.signal,
    poke: arm,
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      parent?.removeEventListener("abort", onParent);
    },
  };
}

function remainingMs(budget: StreamBudget, started: number, now = Date.now()): number {
  return budget.deadlineMs > 0 ? budget.deadlineMs - (now - started) : Number.POSITIVE_INFINITY;
}

function asTurnError(err: unknown, budget: StreamBudget, deadline?: AbortSignal): unknown {
  if (timeoutClock(err)) return err;
  if (deadline?.aborted && (isTimeoutError(err) || isAbortError(err))) {
    return providerTimeoutError(budget.deadlineMs, "deadline");
  }
  if (isTimeoutError(err)) {
    return providerTimeoutError(budget.idleMs > 0 ? budget.idleMs : DEFAULT_PROVIDER_IDLE_MS);
  }
  return err;
}

function withBudget(req: CompleteRequest, budget: StreamBudget): CompleteRequest {
  if (budget.maxTokens == null || req.maxTokens === budget.maxTokens) return req;
  return { ...req, maxTokens: budget.maxTokens };
}

/** Async turn helper: idle timeout, optional deadline, backoff on transient errors, no retry after tokens have streamed. */
export async function* runChatTurn(
  engine: ChatEngine,
  req: CompleteRequest,
  opts: ChatTurnOptions = {},
): AsyncGenerator<ChatEvent> {
  const budget = resolveStreamBudget(req, opts);
  const delaysMs = opts.delaysMs ?? PROVIDER_RETRY_DELAYS_MS;
  let request = withBudget(req, budget);
  const started = Date.now();
  let lastError: unknown;
  let idleTimeouts = 0;
  let usedNostreamFallback = false;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    if (request.signal?.aborted) throw request.signal.reason ?? new Error("Aborted");
    const left = remainingMs(budget, started);
    if (budget.deadlineMs > 0 && left <= 0) {
      throw lastError instanceof Error
        ? lastError
        : providerTimeoutError(budget.deadlineMs, "deadline");
    }
    const attemptReq = usedNostreamFallback ? { ...request, stream: false as const } : request;
    const deadline = budget.deadlineMs > 0 ? AbortSignal.timeout(Math.max(1, left)) : undefined;
    const parent = mergeSignals([attemptReq.signal, deadline]);
    const idle =
      attemptReq.stream === false || budget.idleMs <= 0
        ? undefined
        : createIdleController(budget.idleMs, parent);
    const signal = idle?.signal ?? parent;
    let yielded = false;
    try {
      for await (const ev of engine({ ...attemptReq, signal })) {
        idle?.poke();
        if (ev.type === "activity") continue;
        if (ev.type === "reasoning" || ev.type === "status") {
          yield ev;
          continue;
        }
        yielded = true;
        yield ev;
      }
      return;
    } catch (err) {
      lastError = asTurnError(err, budget, deadline);
      const local = isLocalOpenAiBase(request.provider.baseUrl);
      if (
        !yielded &&
        isUnknownStopError(lastError) &&
        request.stream !== false &&
        !usedNostreamFallback &&
        !local
      ) {
        usedNostreamFallback = true;
        request = withStreamRetryHint(request, "transient");
        opts.onRetry?.({
          attempt: attempt + 1,
          delayMs: 0,
          error: lastError,
          reason: "transient",
        });
        attempt -= 1;
        continue;
      }
      const decision = decideTurnRetry({
        error: lastError,
        userAborted: Boolean(request.signal?.aborted),
        yielded,
        idleTimeouts,
        attempt,
        delaysMs,
        remainingMs: remainingMs(budget, started),
      });
      if (!decision.retry) {
        throw request.signal?.aborted ? err : lastError;
      }
      if (decision.reason === "idle") idleTimeouts += 1;
      request = withStreamRetryHint(request, decision.reason);
      opts.onRetry?.({
        attempt: attempt + 1,
        delayMs: decision.delayMs,
        error: err,
        reason: decision.reason,
      });
      await sleep(decision.delayMs, request.signal);
    } finally {
      idle?.dispose();
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Provider request failed");
}
