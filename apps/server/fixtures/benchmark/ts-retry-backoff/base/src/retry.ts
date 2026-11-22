export interface BackoffOptions {
  /** Delay before the first retry. */
  baseMs: number;
  /** No single delay is longer than this. */
  maxMs: number;
  /** Growth per attempt. Default 2. */
  factor?: number;
}

export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delays to wait before each retry: baseMs, baseMs * factor, baseMs * factor², … */
export function backoffDelays(retries: number, opts: BackoffOptions): number[] {
  const factor = opts.factor ?? 2;
  const delays: number[] = [];
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    delays.push(opts.baseMs * factor * attempt);
  }
  return delays;
}

/** Call `fn` until it resolves, waiting between tries. Rethrows the last error. */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  retries: number,
  opts: BackoffOptions,
  sleep: Sleep = realSleep,
): Promise<T> {
  const delays = backoffDelays(retries, opts);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(delays[attempt]!);
    }
  }
  throw lastError;
}
