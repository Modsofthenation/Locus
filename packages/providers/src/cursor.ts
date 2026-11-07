import { hasUsableKey, normalizeCursorModelId, type AiProvider } from "@locus/shared";
import { fetchProvider, isAbortError, sleep } from "./retry.js";
import { ProviderError, readTokenUsage, type FetchFn, type TokenUsageEvent } from "./types.js";

export const CURSOR_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export interface CursorPromptImage {
  data: string;
  mimeType: string;
}

export interface CursorPrompt {
  text: string;
  images?: CursorPromptImage[];
}

export interface CursorRepoInput {
  url: string;
  startingRef?: string;
}

export interface CursorGitBranch {
  repoUrl?: string;
  branch?: string;
  prUrl?: string;
}

export interface CursorGitSnapshot {
  branches?: CursorGitBranch[];
}

export type CursorCloudEvent =
  | { type: "status"; runId?: string; status: string }
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      status: "running" | "completed";
      arguments: Record<string, unknown>;
      result?: string;
    }
  | {
      type: "result";
      status: string;
      text?: string;
      durationMs?: number;
      git?: CursorGitSnapshot;
      usage?: TokenUsageEvent & { window?: number };
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
      cacheWriteTokens?: number;
      window?: number;
    }
  | { type: "reasoning"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface CursorRunHandle {
  agentId: string;
  runId: string;
  url?: string;
}

export function cursorCloudApiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function isCursorImageMime(mime?: string): boolean {
  return Boolean(mime && CURSOR_IMAGE_MIMES.has(mime.toLowerCase()));
}

export function cursorAuthHeaders(
  provider: Pick<AiProvider, "apiKey" | "extraHeaders">,
): Record<string, string> {
  return {
    authorization: `Bearer ${provider.apiKey ?? ""}`,
    ...provider.extraHeaders,
  };
}

export function cursorCreateAgentBody(input: {
  prompt: CursorPrompt;
  model?: string;
  name?: string;
  repos?: CursorRepoInput[];
  mode?: "agent" | "plan";
  autoCreatePr?: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: cursorPromptBody(input.prompt),
  };
  const model = input.model?.trim();
  if (model) body.model = { id: normalizeCursorModelId(model) };
  const name = input.name?.trim().slice(0, 100);
  if (name) body.name = name;
  if (input.repos?.length) body.repos = input.repos;
  if (input.mode) body.mode = input.mode;
  if (input.autoCreatePr != null) body.autoCreatePR = input.autoCreatePr;
  return body;
}

export function cursorCreateRunBody(input: {
  prompt: CursorPrompt;
  mode?: "agent" | "plan";
}): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt: cursorPromptBody(input.prompt) };
  if (input.mode) body.mode = input.mode;
  return body;
}

function cursorPromptBody(prompt: CursorPrompt): Record<string, unknown> {
  const images = (prompt.images ?? []).filter(
    (image) => image.data.trim() && isCursorImageMime(image.mimeType),
  );
  return images.length
    ? {
        text: prompt.text,
        images: images.map((image) => ({ data: image.data, mimeType: image.mimeType })),
      }
    : { text: prompt.text };
}

export function parseCursorSseBlock(block: string): CursorCloudEvent | undefined {
  const trimmed = block.trim();
  if (!trimmed || trimmed.startsWith(":")) return undefined;
  let event = "message";
  const dataLines: string[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim() || event;
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return undefined;
  const raw = dataLines.join("\n");
  let data: unknown = raw;
  if (raw) {
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      data = raw;
    }
  }
  return cursorEventFromSse(event, data);
}

export function readCursorUsagePayload(data: unknown): TokenUsageEvent | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const row = data as Record<string, unknown>;
  const direct = readTokenUsage(row.usage ?? row);
  if (direct) return direct;
  for (const key of ["interaction_update", "update", "message"]) {
    const nested = row[key];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const found = readTokenUsage((nested as Record<string, unknown>).usage ?? nested);
    if (found) return found;
  }
  return undefined;
}

export function cursorEventFromSse(event: string, data: unknown): CursorCloudEvent | undefined {
  const row =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  if (event === "heartbeat" || event === "interaction_update") return undefined;
  if (event === "thinking") {
    const text =
      (typeof row.text === "string" && row.text) ||
      (typeof row.delta === "string" && row.delta) ||
      (typeof data === "string" ? data : "");
    return text ? { type: "reasoning", text } : undefined;
  }
  if (event === "status") {
    return {
      type: "status",
      runId: typeof row.runId === "string" ? row.runId : undefined,
      status: typeof row.status === "string" ? row.status : "RUNNING",
    };
  }
  if (event === "assistant") {
    const text = typeof row.text === "string" ? row.text : typeof data === "string" ? data : "";
    return text ? { type: "text", text } : undefined;
  }
  if (event === "tool_call") {
    const id = typeof row.callId === "string" && row.callId.trim() ? row.callId.trim() : "";
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "tool";
    if (!id) return undefined;
    const status = row.status === "completed" ? "completed" : "running";
    return {
      type: "tool_call",
      id,
      name,
      status,
      arguments: jsonObject(row.args),
      result: status === "completed" ? stringifyCursorValue(row.result) : undefined,
    };
  }
  if (event === "result") {
    return {
      type: "result",
      status: typeof row.status === "string" ? row.status : "FINISHED",
      text: typeof row.text === "string" ? row.text : undefined,
      durationMs:
        typeof row.durationMs === "number" && Number.isFinite(row.durationMs)
          ? row.durationMs
          : undefined,
      git: parseCursorGit(row.git),
    };
  }
  if (event === "error") {
    const message =
      (typeof row.message === "string" && row.message.trim() && row.message) ||
      (typeof row.code === "string" && row.code) ||
      "Cursor Cloud stream error";
    return { type: "error", message };
  }
  if (event === "done") return { type: "done" };
  return undefined;
}

export function parseCursorGit(raw: unknown): CursorGitSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const branches = Array.isArray((raw as { branches?: unknown }).branches)
    ? (raw as { branches: unknown[] }).branches
        .map((row) => {
          if (!row || typeof row !== "object") return undefined;
          const item = row as Record<string, unknown>;
          const branch: CursorGitBranch = {
            repoUrl: typeof item.repoUrl === "string" ? item.repoUrl : undefined,
            branch: typeof item.branch === "string" ? item.branch : undefined,
            prUrl: typeof item.prUrl === "string" ? item.prUrl : undefined,
          };
          return branch.repoUrl || branch.branch || branch.prUrl ? branch : undefined;
        })
        .filter((row): row is CursorGitBranch => Boolean(row))
    : [];
  return branches.length ? { branches } : undefined;
}

export async function startCursorCloudRun(input: {
  provider: AiProvider;
  agentId?: string;
  prompt: CursorPrompt;
  model?: string;
  name?: string;
  repos?: CursorRepoInput[];
  mode?: "agent" | "plan";
  autoCreatePr?: boolean;
  signal?: AbortSignal;
  fetchFn?: FetchFn;
}): Promise<CursorRunHandle> {
  requireCursorKey(input.provider);
  const fetchFn = input.fetchFn ?? fetch;
  if (input.agentId) {
    try {
      return await createCursorRun(input.provider, input.agentId, input, fetchFn);
    } catch (err) {
      if (err instanceof ProviderError && err.status === 409) {
        await cancelLatestCursorRun(input.provider, input.agentId, fetchFn, input.signal);
        return await createCursorRun(input.provider, input.agentId, input, fetchFn);
      }
      if (err instanceof ProviderError && err.status === 404) {
        return createCursorAgent(input.provider, input, fetchFn);
      }
      throw err;
    }
  }
  return createCursorAgent(input.provider, input, fetchFn);
}

export async function* streamCursorRun(
  provider: AiProvider,
  handle: CursorRunHandle,
  opts: { signal?: AbortSignal; fetchFn?: FetchFn } = {},
): AsyncGenerator<CursorCloudEvent> {
  requireCursorKey(provider);
  const fetchFn = opts.fetchFn ?? fetch;
  const url = cursorCloudApiUrl(
    provider.baseUrl,
    `/agents/${encodeURIComponent(handle.agentId)}/runs/${encodeURIComponent(handle.runId)}/stream`,
  );
  yield* readCursorStream(url, provider, handle, { signal: opts.signal, fetchFn });
}

export async function cancelCursorRun(
  provider: AiProvider,
  handle: Pick<CursorRunHandle, "agentId" | "runId">,
  opts: { fetchFn?: FetchFn } = {},
): Promise<void> {
  if (!handle.agentId || !handle.runId) return;
  const fetchFn = opts.fetchFn ?? fetch;
  const url = cursorCloudApiUrl(
    provider.baseUrl,
    `/agents/${encodeURIComponent(handle.agentId)}/runs/${encodeURIComponent(handle.runId)}/cancel`,
  );
  try {
    await fetchProvider(
      fetchFn,
      url,
      {
        method: "POST",
        headers: cursorAuthHeaders(provider),
      },
      [],
    );
  } catch (err) {
    if (err instanceof ProviderError && (err.status === 404 || err.status === 409)) return;
    throw err;
  }
}

export async function getCursorRun(
  provider: AiProvider,
  handle: Pick<CursorRunHandle, "agentId" | "runId">,
  opts: { signal?: AbortSignal; fetchFn?: FetchFn } = {},
): Promise<CursorCloudEvent & { type: "result" }> {
  requireCursorKey(provider);
  const fetchFn = opts.fetchFn ?? fetch;
  const url = cursorCloudApiUrl(
    provider.baseUrl,
    `/agents/${encodeURIComponent(handle.agentId)}/runs/${encodeURIComponent(handle.runId)}`,
  );
  const res = await fetchProvider(fetchFn, url, {
    headers: cursorAuthHeaders(provider),
    signal: opts.signal,
  });
  const json = (await res.json()) as Record<string, unknown>;
  return {
    type: "result",
    status: typeof json.status === "string" ? json.status : "FINISHED",
    text: typeof json.result === "string" ? json.result : undefined,
    durationMs:
      typeof json.durationMs === "number" && Number.isFinite(json.durationMs)
        ? json.durationMs
        : undefined,
    git: parseCursorGit(json.git),
  };
}

async function createCursorAgent(
  provider: AiProvider,
  input: {
    prompt: CursorPrompt;
    model?: string;
    name?: string;
    repos?: CursorRepoInput[];
    mode?: "agent" | "plan";
    autoCreatePr?: boolean;
    signal?: AbortSignal;
  },
  fetchFn: FetchFn,
): Promise<CursorRunHandle> {
  const url = cursorCloudApiUrl(provider.baseUrl, "/agents");
  const res = await fetchProvider(fetchFn, url, {
    method: "POST",
    headers: { "content-type": "application/json", ...cursorAuthHeaders(provider) },
    body: JSON.stringify(cursorCreateAgentBody(input)),
    signal: input.signal,
  });
  const json = (await res.json()) as {
    agent?: { id?: unknown; url?: unknown; latestRunId?: unknown };
    run?: { id?: unknown; agentId?: unknown };
  };
  const agentId =
    (typeof json.agent?.id === "string" && json.agent.id) ||
    (typeof json.run?.agentId === "string" && json.run.agentId) ||
    "";
  const runId =
    (typeof json.run?.id === "string" && json.run.id) ||
    (typeof json.agent?.latestRunId === "string" && json.agent.latestRunId) ||
    "";
  if (!agentId || !runId) {
    throw new ProviderError("Cursor Cloud did not return an agent id and run id");
  }
  return {
    agentId,
    runId,
    url: typeof json.agent?.url === "string" ? json.agent.url : undefined,
  };
}

async function createCursorRun(
  provider: AiProvider,
  agentId: string,
  input: { prompt: CursorPrompt; mode?: "agent" | "plan"; signal?: AbortSignal },
  fetchFn: FetchFn,
): Promise<CursorRunHandle> {
  const url = cursorCloudApiUrl(provider.baseUrl, `/agents/${encodeURIComponent(agentId)}/runs`);
  const res = await fetchProvider(
    fetchFn,
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...cursorAuthHeaders(provider) },
      body: JSON.stringify(cursorCreateRunBody(input)),
      signal: input.signal,
    },
    [],
  );
  const json = (await res.json()) as { run?: { id?: unknown; agentId?: unknown } };
  const runId = typeof json.run?.id === "string" ? json.run.id : "";
  if (!runId) throw new ProviderError("Cursor Cloud did not return a run id");
  return { agentId, runId };
}

async function cancelLatestCursorRun(
  provider: AiProvider,
  agentId: string,
  fetchFn: FetchFn,
  signal?: AbortSignal,
): Promise<void> {
  const url = cursorCloudApiUrl(provider.baseUrl, `/agents/${encodeURIComponent(agentId)}`);
  try {
    const res = await fetchProvider(fetchFn, url, {
      headers: cursorAuthHeaders(provider),
      signal,
    });
    const json = (await res.json()) as { latestRunId?: unknown };
    const runId = typeof json.latestRunId === "string" ? json.latestRunId : "";
    if (!runId) return;
    await cancelCursorRun(provider, { agentId, runId }, { fetchFn });
    await sleep(400, signal);
  } catch (err) {
    if (isAbortError(err)) throw err;
  }
}

async function* readCursorStream(
  url: string,
  provider: AiProvider,
  handle: CursorRunHandle,
  opts: { signal?: AbortSignal; fetchFn: FetchFn },
): AsyncGenerator<CursorCloudEvent> {
  let res: Response;
  try {
    res = await fetchProvider(opts.fetchFn, url, {
      headers: { accept: "text/event-stream", ...cursorAuthHeaders(provider) },
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof ProviderError && err.status === 410) {
      yield await getCursorRun(provider, handle, opts);
      yield { type: "done" };
      return;
    }
    throw err;
  }
  if (!res.body) {
    yield await getCursorRun(provider, handle, opts);
    yield { type: "done" };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split(/\r?\n\r?\n/);
      buf = parts.pop() ?? "";
      for (const block of parts) {
        const event = parseCursorSseBlock(block);
        if (event) yield event;
      }
    }
    buf += decoder.decode();
    const tail = parseCursorSseBlock(buf);
    if (tail) yield tail;
  } catch (err) {
    if (isAbortError(err)) return;
    throw err;
  }
}

function requireCursorKey(provider: AiProvider): void {
  if (!hasUsableKey(provider.apiKey, provider.baseUrl)) {
    throw new ProviderError("Cursor Cloud API key is not set");
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (value == null) return {};
  return { value };
}

function stringifyCursorValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
