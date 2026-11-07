import { describe, expect, it, vi } from "vitest";
import { ProviderError, unknownStopError } from "./types.js";
import {
  decideTurnRetry,
  resolveStreamBudget,
  runChatTurn,
  STREAM_RETRY_HINTS,
  DEFAULT_PROVIDER_DEADLINE_MS,
  DEFAULT_PROVIDER_IDLE_MS,
  LOCAL_PROVIDER_IDLE_MS,
} from "./loop.js";
import { isTimeoutError, providerTimeoutError, sleep } from "./retry.js";
import type { ChatEvent, CompleteRequest } from "./types.js";
import type { AiProvider } from "@locus/shared";

const provider: AiProvider = {
  id: "p1",
  name: "OpenAI",
  kind: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  models: ["gpt-4.1"],
  defaultModel: "gpt-4.1",
  enabled: true,
  extraHeaders: {},
};

const req: CompleteRequest = {
  provider,
  model: "gpt-4.1",
  system: "sys",
  messages: [{ id: "u", role: "user", content: "hi", createdAt: "" }],
};

async function collect(
  engine: Parameters<typeof runChatTurn>[0],
  opts?: Parameters<typeof runChatTurn>[2],
) {
  const events: ChatEvent[] = [];
  for await (const ev of runChatTurn(engine, req, { idleMs: 0, delaysMs: [0], ...opts }))
    events.push(ev);
  return events;
}

function formatMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

describe("runChatTurn", () => {
  it("retries a transient error before any tokens, then streams", async () => {
    let calls = 0;
    async function* engine(): AsyncGenerator<ChatEvent> {
      calls += 1;
      if (calls === 1) throw new ProviderError("busy", 429);
      yield { type: "text", text: "ok" };
    }
    const events = await collect(engine);
    expect(calls).toBe(2);
    expect(events).toEqual([{ type: "text", text: "ok" }]);
  });

  it("retries an unknown stop before any tokens, then streams", async () => {
    let calls = 0;
    async function* engine(): AsyncGenerator<ChatEvent> {
      calls += 1;
      if (calls === 1) {
        yield { type: "activity" };
        throw unknownStopError();
      }
      yield { type: "text", text: "ok" };
    }
    const events = await collect(engine);
    expect(calls).toBe(2);
    expect(events).toEqual([{ type: "text", text: "ok" }]);
  });

  it("forwards reasoning without treating it as a streamed reply", async () => {
    let calls = 0;
    async function* engine(): AsyncGenerator<ChatEvent> {
      calls += 1;
      if (calls === 1) {
        yield { type: "reasoning", text: "plan the page" };
        throw unknownStopError();
      }
      yield { type: "text", text: "ok" };
    }
    const events = await collect(engine);
    expect(calls).toBe(2);
    expect(events.filter((ev) => ev.type === "reasoning")).toEqual([
      { type: "reasoning", text: "plan the page" },
    ]);
    expect(events.filter((ev) => ev.type === "text")).toEqual([{ type: "text", text: "ok" }]);
  });

  it("forwards loading status without treating it as a streamed reply", async () => {
    let calls = 0;
    async function* engine(): AsyncGenerator<ChatEvent> {
      calls += 1;
      if (calls === 1) {
        yield { type: "status", phase: "loading" };
        throw unknownStopError();
      }
      yield { type: "text", text: "ok" };
    }
    const events = await collect(engine);
    expect(calls).toBe(2);
    expect(events.filter((ev) => ev.type === "status")).toEqual([
      { type: "status", phase: "loading" },
    ]);
    expect(events.filter((ev) => ev.type === "text")).toEqual([{ type: "text", text: "ok" }]);
  });

  it("retries a local unknown stop as another stream, not a JSON completion", async () => {
    const localReq: CompleteRequest = {
      ...req,
      provider: {
        ...req.provider,
        kind: "openai-compatible",
        name: "Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
    };
    const streams: Array<boolean | undefined> = [];
    let calls = 0;
    async function* engine(request: CompleteRequest): AsyncGenerator<ChatEvent> {
      calls += 1;
      streams.push(request.stream);
      if (calls === 1) throw unknownStopError();
      yield { type: "text", text: "ok" };
    }
    const events: ChatEvent[] = [];
    for await (const ev of runChatTurn(engine, localReq, { delaysMs: [0], idleMs: 0 })) {
      events.push(ev);
    }
    expect(calls).toBe(2);
    expect(streams).toEqual([undefined, undefined]);
    expect(events).toEqual([{ type: "text", text: "ok" }]);
  });

  it("does not retry after tokens have already streamed", async () => {
    let calls = 0;
    async function* engine(): AsyncGenerator<ChatEvent> {
      calls += 1;
      yield { type: "text", text: "partial" };
      throw new ProviderError("drop", 503);
    }
    const events: ChatEvent[] = [];
    await expect(async () => {
      for await (const ev of runChatTurn(engine, req, { delaysMs: [0, 0], idleMs: 0 }))
        events.push(ev);
    }).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(1);
    expect(events).toEqual([{ type: "text", text: "partial" }]);
  });

  it("does not retry when backoff would exceed the remaining timeout", async () => {
    let calls = 0;
    async function* engine(): AsyncGenerator<ChatEvent> {
      calls += 1;
      throw new ProviderError("busy", 429);
    }
    await expect(async () => {
      for await (const _ev of runChatTurn(engine, req, {
        timeoutMs: 40,
        delaysMs: [200],
        idleMs: 0,
      })) {
        /* drain */
      }
    }).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(1);
  });

  it("keeps a long stream alive when activity continues past the idle window", async () => {
    async function* engine(): AsyncGenerator<ChatEvent> {
      for (let i = 0; i < 4; i++) {
        yield { type: "activity" };
        await new Promise((r) => setTimeout(r, 20));
      }
      yield { type: "text", text: "ok" };
    }
    const events = await collect(engine, { idleMs: 80, delaysMs: [] });
    expect(events).toEqual([{ type: "text", text: "ok" }]);
  });

  it("aborts after silence longer than the idle window", async () => {
    async function* engine(request: CompleteRequest): AsyncGenerator<ChatEvent> {
      await sleep(120, request.signal);
      yield { type: "text", text: "late" };
    }
    await expect(collect(engine, { idleMs: 40, delaysMs: [] })).rejects.toSatisfy(
      (err: unknown) => {
        return isTimeoutError(err) && formatMessage(err).includes("timed out");
      },
    );
  });

  it("retries one TimeoutError before any tokens, then streams", async () => {
    let calls = 0;
    async function* engine(): AsyncGenerator<ChatEvent> {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        });
      }
      yield { type: "text", text: "ok" };
    }
    const events = await collect(engine, { delaysMs: [0] });
    expect(calls).toBe(2);
    expect(events).toEqual([{ type: "text", text: "ok" }]);
  });

  it("does not retry a second TimeoutError", async () => {
    let calls = 0;
    async function* engine(): AsyncGenerator<ChatEvent> {
      calls += 1;
      throw Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      });
    }
    await expect(collect(engine, { delaysMs: [0, 0] })).rejects.toSatisfy((err: unknown) => {
      return isTimeoutError(err) && formatMessage(err).includes("timed out");
    });
    expect(calls).toBe(2);
  });

  it("retries a hang after activity-only frames", async () => {
    let calls = 0;
    async function* engine(): AsyncGenerator<ChatEvent> {
      calls += 1;
      yield { type: "activity" };
      if (calls === 1) {
        throw Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        });
      }
      yield { type: "text", text: "ok" };
    }
    const events = await collect(engine, { delaysMs: [0] });
    expect(calls).toBe(2);
    expect(events).toEqual([{ type: "text", text: "ok" }]);
  });

  it("still honors timeoutMs while activity continues", async () => {
    async function* engine(request: CompleteRequest): AsyncGenerator<ChatEvent> {
      for (let i = 0; i < 20; i++) {
        yield { type: "activity" };
        await sleep(20, request.signal);
      }
      yield { type: "text", text: "late" };
    }
    await expect(collect(engine, { idleMs: 500, timeoutMs: 50, delaysMs: [] })).rejects.toSatisfy(
      (err: unknown) => {
        return isTimeoutError(err) && formatMessage(err).includes("timed out after");
      },
    );
  });

  it("does not kill a live stream at a 180s wall clock", async () => {
    vi.useFakeTimers();
    try {
      async function* engine(request: CompleteRequest): AsyncGenerator<ChatEvent> {
        for (let i = 0; i < 3; i++) {
          yield { type: "activity" };
          await sleep(90_000, request.signal);
        }
        yield { type: "text", text: "ok" };
      }
      const pending = collect(engine, { idleMs: 180_000, timeoutMs: 0, delaysMs: [] });
      await vi.advanceTimersByTimeAsync(270_000);
      await expect(pending).resolves.toEqual([{ type: "text", text: "ok" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards the completion budget onto the engine request", async () => {
    let seen: number | undefined;
    async function* engine(request: CompleteRequest): AsyncGenerator<ChatEvent> {
      seen = request.maxTokens;
      yield { type: "text", text: "ok" };
    }
    const events = await collect(engine, { maxTokens: 4096, delaysMs: [] });
    expect(seen).toBe(4096);
    expect(events).toEqual([{ type: "text", text: "ok" }]);
  });

  it("injects a continue hint into volatilePrefix on idle retry", async () => {
    let second: CompleteRequest | undefined;
    let calls = 0;
    async function* engine(request: CompleteRequest): AsyncGenerator<ChatEvent> {
      calls += 1;
      if (calls === 1) throw providerTimeoutError(1_000);
      second = request;
      yield { type: "text", text: "ok" };
    }
    const events = await collect(engine, { delaysMs: [0], idleMs: 0 });
    expect(calls).toBe(2);
    expect(events).toEqual([{ type: "text", text: "ok" }]);
    expect(second?.volatilePrefix).toMatch(/went silent/i);
    expect(second?.volatilePrefix).toMatch(/do not restart/i);
  });

  it("does not stack the retry hint on a second transient retry", async () => {
    let third: CompleteRequest | undefined;
    let calls = 0;
    async function* engine(request: CompleteRequest): AsyncGenerator<ChatEvent> {
      calls += 1;
      if (calls < 3) throw unknownStopError();
      third = request;
      yield { type: "text", text: "ok" };
    }
    await collect(engine, { delaysMs: [0, 0], idleMs: 0 });
    const hint = STREAM_RETRY_HINTS.transient;
    const count = third?.volatilePrefix?.split(hint).length ?? 0;
    expect(count).toBe(2);
  });
});

describe("resolveStreamBudget", () => {
  it("defaults idle and deadline, and forwards an explicit completion budget", () => {
    expect(resolveStreamBudget(req, {})).toEqual({
      idleMs: DEFAULT_PROVIDER_IDLE_MS,
      deadlineMs: DEFAULT_PROVIDER_DEADLINE_MS,
    });
    expect(resolveStreamBudget({ ...req, maxTokens: 1024 }, { timeoutMs: 0, idleMs: 50 })).toEqual({
      idleMs: 50,
      deadlineMs: 0,
      maxTokens: 1024,
    });
    expect(resolveStreamBudget(req, { maxTokens: 2048, timeoutMs: 5_000 })).toEqual({
      idleMs: DEFAULT_PROVIDER_IDLE_MS,
      deadlineMs: 5_000,
      maxTokens: 2048,
    });
    expect(
      resolveStreamBudget(
        {
          ...req,
          provider: { ...req.provider, kind: "opencode", baseUrl: "https://opencode.ai/zen/v1" },
        },
        {},
      ),
    ).toEqual({
      idleMs: DEFAULT_PROVIDER_IDLE_MS,
      deadlineMs: DEFAULT_PROVIDER_DEADLINE_MS,
      maxTokens: 32_768,
    });
    expect(
      resolveStreamBudget(
        {
          ...req,
          provider: {
            ...req.provider,
            kind: "openrouter",
            baseUrl: "https://openrouter.ai/api/v1",
          },
        },
        {},
      ),
    ).toEqual({
      idleMs: DEFAULT_PROVIDER_IDLE_MS,
      deadlineMs: DEFAULT_PROVIDER_DEADLINE_MS,
      maxTokens: 32_768,
    });
  });

  it("stretches idle when the prompt already fills most of the window", () => {
    expect(resolveStreamBudget(req, { promptTokens: 10_000, contextWindow: 100_000 }).idleMs).toBe(
      DEFAULT_PROVIDER_IDLE_MS,
    );
    expect(resolveStreamBudget(req, { promptTokens: 90_000, contextWindow: 100_000 }).idleMs).toBe(
      Math.round(DEFAULT_PROVIDER_IDLE_MS * 1.5),
    );
    expect(resolveStreamBudget(req, { hasImages: true }).idleMs).toBe(
      Math.round(DEFAULT_PROVIDER_IDLE_MS * 1.5),
    );
  });

  it("uses a longer idle window for local Ollama-style bases", () => {
    expect(
      resolveStreamBudget({
        ...req,
        provider: {
          ...req.provider,
          kind: "openai-compatible",
          baseUrl: "http://127.0.0.1:11434/v1",
        },
      }).idleMs,
    ).toBe(LOCAL_PROVIDER_IDLE_MS);
    expect(
      resolveStreamBudget(
        {
          ...req,
          provider: {
            ...req.provider,
            kind: "openai-compatible",
            baseUrl: "http://127.0.0.1:11434/v1",
          },
        },
        { idleMs: 0 },
      ).idleMs,
    ).toBe(0);
  });
});

describe("decideTurnRetry", () => {
  const base = {
    userAborted: false,
    yielded: false,
    idleTimeouts: 0,
    attempt: 0,
    delaysMs: [0, 0],
    remainingMs: 10_000,
  };

  it.each([
    {
      name: "retries a 429 before any tokens",
      ctx: { error: new ProviderError("busy", 429) },
      retry: true,
      reason: "transient" as const,
    },
    {
      name: "retries an empty unknown finish",
      ctx: { error: unknownStopError() },
      retry: true,
      reason: "transient" as const,
    },
    {
      name: "retries one idle hang",
      ctx: { error: providerTimeoutError(1_000) },
      retry: true,
      reason: "idle" as const,
    },
    {
      name: "does not retry a second idle hang",
      ctx: { error: providerTimeoutError(1_000), idleTimeouts: 1 },
      retry: false,
    },
    {
      name: "does not retry a deadline",
      ctx: { error: providerTimeoutError(5_000, "deadline") },
      retry: false,
    },
    {
      name: "does not retry after tokens have streamed",
      ctx: { error: new ProviderError("drop", 503), yielded: true },
      retry: false,
    },
    {
      name: "does not retry a user abort",
      ctx: { error: new Error("Aborted"), userAborted: true },
      retry: false,
    },
    {
      name: "does not retry a 400",
      ctx: { error: new ProviderError("bad request", 400) },
      retry: false,
    },
    {
      name: "does not retry when backoff would exceed the remaining deadline",
      ctx: { error: new ProviderError("busy", 429), delaysMs: [200], remainingMs: 40 },
      retry: false,
    },
    {
      name: "does not retry when the deadline is already exhausted",
      ctx: { error: new ProviderError("busy", 429), remainingMs: 0 },
      retry: false,
    },
  ])("$name", ({ ctx, retry, reason }) => {
    const decision = decideTurnRetry({ ...base, ...ctx });
    expect(decision.retry).toBe(retry);
    if (retry && decision.retry) expect(decision.reason).toBe(reason);
  });
});
