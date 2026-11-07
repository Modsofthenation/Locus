/** Delay before the next events-socket reconnect. attempt 0 → 500ms, then 1s, 2s, … capped. */
export function reconnectDelayMs(attempt: number, minMs = 500, maxMs = 15_000): number {
  const exp = Math.min(maxMs, minMs * 2 ** Math.max(0, attempt));
  return Math.round(exp);
}

/** Give up on a CONNECTING events socket so Retry now / visibility can open a new one. */
export const EVENTS_CONNECT_TIMEOUT_MS = 8_000;

/** Chat POST waits on checkpoint snapshot; abort so Send cannot stick forever. */
export const CHAT_POST_TIMEOUT_MS = 20_000;

/** Recover-after-drop session GET. A hung control plane must not hold sending.current. */
export const CHAT_RECOVERY_TIMEOUT_MS = 5_000;

/** Files pane GET. Loopback reads should not hang the tab. */
export const WORKSPACE_FILE_TIMEOUT_MS = 8_000;

export const UNREACHABLE_ERROR = "Can't reach Locus. Retry once the control plane is back.";

export const GET_RETRY_DELAYS_MS = [400, 1_200];

const RETRYABLE_GET_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_GET_STATUS.has(status);
}

export function isRetryableGetFailure(method: string, err: unknown): boolean {
  if (method.toUpperCase() !== "GET") return false;
  if (err instanceof HttpError) return isRetryableHttpStatus(err.status);
  if (err instanceof DOMException && err.name === "AbortError") return false;
  return true;
}

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function isUnreachableError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof HttpError) {
    if (err.status === 502 || err.status === 503 || err.status === 504) return true;
    return /emfile|enfile|too many open files/i.test(err.message);
  }
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /failed to fetch|networkerror|load failed|econnrefused|connection refused|err_connection|the operation was aborted/i.test(
    message,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
