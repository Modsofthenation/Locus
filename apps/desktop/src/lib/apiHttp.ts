import { formatRemoteError } from "@locus/shared";
import { GET_RETRY_DELAYS_MS, HttpError, isRetryableGetFailure, sleep } from "./net";
import { phoneAuthHeaders } from "./phoneAuth";

export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    credentials: "include",
    ...init,
    headers: { ...phoneAuthHeaders(), ...(init?.headers ?? {}) },
  });
}

export async function errorMessageFromResponse(res: Response): Promise<string> {
  try {
    return formatRemoteError(await res.json(), res.statusText || `HTTP ${res.status}`);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

export type JsonInit = RequestInit & { timeoutMs?: number };

function withTimeout(init?: JsonInit): RequestInit {
  const { timeoutMs, ...rest } = init ?? {};
  if (timeoutMs == null) return rest;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = rest.signal ? AbortSignal.any([rest.signal, timeout]) : timeout;
  return { ...rest, signal };
}

async function jsonOnce<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...phoneAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new HttpError(await errorMessageFromResponse(res), res.status);
  return (await res.json()) as T;
}

export async function json<T>(input: RequestInfo, init?: JsonInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const retries = method === "GET" ? GET_RETRY_DELAYS_MS : [];
  const request = withTimeout(init);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries.length; attempt++) {
    try {
      return await jsonOnce<T>(input, request);
    } catch (err) {
      lastError = err;
      if (attempt >= retries.length || !isRetryableGetFailure(method, err)) throw err;
      await sleep(retries[attempt]!);
    }
  }
  throw lastError;
}

export function withQuery(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    qs.set(key, String(value));
  }
  const q = qs.toString();
  return q ? `${path}?${q}` : path;
}
