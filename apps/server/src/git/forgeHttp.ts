import {
  forgeAccessMessage,
  forgeLabel,
  formatRemoteError,
  type ForgeAccessProblem,
  type GitForgeAccount,
  type PullListState,
  type PullState,
} from "@locus/shared";

export type ForgeFetcher = typeof fetch;

export const MAX_FORGE_JSON = 2_000_000;
export const MAX_PR_COMMENT = 16_384;

/** No token: reads go out unauthenticated (public repos); writes still require one. */
export function hasForgeToken(account: GitForgeAccount): boolean {
  return Boolean(account.token?.trim());
}

/** A tokenless read the forge refused: the repo needs a token, or the anonymous quota ran out. */
export class ForgeAccessError extends Error {
  constructor(
    readonly problem: ForgeAccessProblem,
    forge: string,
  ) {
    super(forgeAccessMessage(forge, problem));
    this.name = "ForgeAccessError";
  }
}

function anonymousRefusal(res: Response, text: string): ForgeAccessProblem | undefined {
  if (res.status === 429) return "rate_limited";
  if (
    res.status === 403 &&
    (res.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(text))
  )
    return "rate_limited";
  if (res.status === 401 || res.status === 403 || res.status === 404) return "needs_token";
  return undefined;
}

export function apiRoot(account: GitForgeAccount): string {
  return account.apiBaseUrl.replace(/\/$/, "");
}

export function gitlabAuthHeaders(
  account: GitForgeAccount,
  extra?: Record<string, string>,
): Record<string, string> {
  if (!hasForgeToken(account)) return { ...(extra ?? {}) };
  return { ...(extra ?? {}), "private-token": account.token ?? "" };
}

export function githubAuthHeaders(
  account: GitForgeAccount,
  extra?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...(extra ?? {}) };
  if (hasForgeToken(account)) out.authorization = `Bearer ${account.token ?? ""}`;
  out.accept = out.accept ?? "application/vnd.github+json";
  return out;
}

export function giteaAuthHeaders(
  account: GitForgeAccount,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    ...(extra ?? {}),
    ...(hasForgeToken(account) ? { authorization: `token ${account.token ?? ""}` } : {}),
    accept: "application/json",
  };
}

export function azureDevOpsAuthHeaders(
  account: GitForgeAccount,
  extra?: Record<string, string>,
): Record<string, string> {
  const token = account.token ?? "";
  return {
    ...(extra ?? {}),
    ...(hasForgeToken(account)
      ? { authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}` }
      : {}),
    accept: "application/json",
  };
}

export function bitbucketAuthHeaders(
  account: GitForgeAccount,
  extra?: Record<string, string>,
): Record<string, string> {
  if (!hasForgeToken(account)) return { ...(extra ?? {}) };
  return { ...(extra ?? {}), authorization: `Bearer ${account.token ?? ""}` };
}

export async function readBody(res: Response): Promise<string> {
  return (await res.text()).slice(0, MAX_FORGE_JSON);
}

export function fail(res: Response, text: string): Error {
  return new Error(formatRemoteError(text, `HTTP ${res.status}`));
}

export function gitlabProject(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

export function normalizeRef(ref?: string): string {
  return (ref ?? "").replace(/^refs\/heads\//, "").trim();
}

export function assertPrComment(body: string): string {
  const text = body.trim();
  if (!text) throw new Error("body is required");
  if (text.length > MAX_PR_COMMENT) throw new Error("Comment is too long");
  return text;
}

function isDraftFlag(value: unknown): boolean {
  return value === true || value === "true";
}

export function pullState(input: {
  state?: string;
  merged?: boolean;
  draft?: unknown;
  workInProgress?: boolean;
  declined?: boolean;
}): PullState {
  const state = (input.state ?? "").toLowerCase();
  if (input.merged || state === "merged") return "merged";
  if (
    input.declined ||
    state === "closed" ||
    state === "declined" ||
    state === "superseded" ||
    state === "locked"
  ) {
    return "closed";
  }
  if (isDraftFlag(input.draft) || input.workInProgress === true || state === "draft")
    return "draft";
  return "open";
}

export function pullFlags(input: Parameters<typeof pullState>[0]): {
  state: PullState;
  draft: boolean;
} {
  const state = pullState(input);
  return { state, draft: state === "draft" };
}

export function filterListedPulls<T extends { state: PullState; draft?: boolean }>(
  rows: T[],
  state: PullListState,
): T[] {
  if (state !== "draft") return rows;
  return rows.filter((row) => row.draft === true || row.state === "draft");
}

export type ForgeAuthHeaders = (
  account: GitForgeAccount,
  extra?: Record<string, string>,
) => Record<string, string>;

export async function forgeJson<T>(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  path: string,
  init: RequestInit | undefined,
  authHeaders: ForgeAuthHeaders,
): Promise<{ ok: boolean; status: number; json: T; text: string }> {
  const res = await fetchFn(`${apiRoot(account)}${path}`, {
    ...init,
    headers: {
      ...authHeaders(account, { "content-type": "application/json" }),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const text = await readBody(res);
  if (!hasForgeToken(account)) {
    const problem = anonymousRefusal(res, text);
    if (problem) throw new ForgeAccessError(problem, forgeLabel(account.kind));
  }
  let json = {} as T;
  try {
    json = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    json = {} as T;
  }
  return { ok: res.ok, status: res.status, json, text };
}
