import { ProviderError, type FetchFn } from "./types.js";

export const PROVIDER_RETRY_DELAYS_MS = [400, 1_200, 3_000];
export const RATE_LIMIT_RETRY_DELAYS_MS = [1_000, 4_000, 16_000];
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

export function isRetryableProviderStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

export function isAbortError(err: unknown): boolean {
  return Boolean(
    err &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name: string }).name === "AbortError",
  );
}

export function isTimeoutError(err: unknown): boolean {
  return timeoutErrorNameOrMessage(err, new Set());
}

function timeoutErrorNameOrMessage(err: unknown, seen: Set<unknown>): boolean {
  if (!err || typeof err !== "object" || seen.has(err)) return false;
  seen.add(err);
  const name = "name" in err ? String((err as { name: unknown }).name) : "";
  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  if (name === "TimeoutError") return true;
  if (/aborted due to timeout/i.test(message)) return true;
  if ("cause" in err && timeoutErrorNameOrMessage((err as { cause: unknown }).cause, seen))
    return true;
  if ("reason" in err && timeoutErrorNameOrMessage((err as { reason: unknown }).reason, seen))
    return true;
  return false;
}

export type TimeoutClock = "idle" | "deadline";

export function providerTimeoutError(ms: number, kind: TimeoutClock = "idle"): Error {
  const seconds = Math.max(1, Math.round(ms / 1000));
  const err = new Error(
    kind === "deadline"
      ? `Provider timed out after ${seconds}s.`
      : `Provider timed out after ${seconds}s with no response.`,
  ) as Error & { clock: TimeoutClock };
  err.name = "TimeoutError";
  err.clock = kind;
  return err;
}

/** Assigned idle vs deadline clock. Unlabeled TimeoutError has no clock until asTurnError stamps one. */
export function timeoutClock(err: unknown): TimeoutClock | undefined {
  if (!isTimeoutError(err) || !err || typeof err !== "object" || !("clock" in err))
    return undefined;
  const clock = (err as { clock: unknown }).clock;
  return clock === "idle" || clock === "deadline" ? clock : undefined;
}

export function formatProviderError(err: unknown): string {
  if (isTimeoutError(err)) {
    return err instanceof Error && !/aborted due to timeout/i.test(err.message)
      ? err.message
      : "Provider timed out waiting for the model. Retry the prompt, or switch to a faster model.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "Provider error";
}

export function isRetryableProviderError(err: unknown): boolean {
  if (isAbortError(err) || isTimeoutError(err)) return false;
  if (err instanceof ProviderError) {
    return err.retryable || (err.status != null && isRetryableProviderStatus(err.status));
  }
  if (err instanceof TypeError) return true;
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|UND_ERR/i.test(code);
}

export function retryAfterDelayMs(res: Response, fallbackMs: number): number {
  const raw = res.headers.get("retry-after");
  if (!raw) return fallbackMs;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(60_000, Math.max(0, seconds * 1000));
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.min(60_000, Math.max(fallbackMs, date - Date.now()));
  return fallbackMs;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Aborted"));
      },
      { once: true },
    );
  });
}

/** Retry the initial provider fetch only. Do not use after bytes have been streamed. */
export async function fetchProvider(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  delaysMs: number[] = PROVIDER_RETRY_DELAYS_MS,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    if (init.signal?.aborted) throw init.signal.reason ?? new Error("Aborted");
    try {
      const res = await fetchFn(url, init);
      if (res.ok) return res;
      const retry = isRetryableProviderStatus(res.status) && attempt < delaysMs.length;
      const waitMs =
        res.status === 429
          ? retryAfterDelayMs(
              res,
              RATE_LIMIT_RETRY_DELAYS_MS[Math.min(attempt, RATE_LIMIT_RETRY_DELAYS_MS.length - 1)]!,
            )
          : delaysMs[attempt]!;
      const text = await res.text().catch(() => "");
      if (!retry) throw new ProviderError(text || `Provider HTTP ${res.status}`, res.status);
      lastError = new ProviderError(text || `Provider HTTP ${res.status}`, res.status);
      await sleep(waitMs, init.signal ?? undefined);
      continue;
    } catch (err) {
      if (
        err instanceof ProviderError &&
        !err.retryable &&
        (err.status == null || !isRetryableProviderStatus(err.status))
      ) {
        throw err;
      }
      if (isAbortError(err) || isTimeoutError(err)) throw err;
      lastError = err;
      if (attempt >= delaysMs.length) throw err;
    }
    await sleep(delaysMs[attempt]!, init.signal ?? undefined);
  }
  throw lastError instanceof Error ? lastError : new Error("Provider request failed");
}
