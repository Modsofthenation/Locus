import { afterEach, describe, expect, it, vi } from "vitest";
import { api, connectEvents, retryEvents } from "./api";
import {
  CHAT_POST_TIMEOUT_MS,
  HttpError,
  isRetryableGetFailure,
  isUnreachableError,
  reconnectDelayMs,
} from "./net";
import { clearPullCaches } from "./pullCache";
import { clearPhoneAuth, initPhoneAuth } from "./phoneAuth";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearPullCaches();
  clearPhoneAuth();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  } as Response;
}

class MockSocket {
  static instances: MockSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readyState = 0;
  url: string;

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("reconnectDelayMs", () => {
  it("grows from 500ms and caps", () => {
    expect(reconnectDelayMs(0)).toBe(500);
    expect(reconnectDelayMs(1)).toBe(1_000);
    expect(reconnectDelayMs(2)).toBe(2_000);
    expect(reconnectDelayMs(10)).toBe(15_000);
  });
});

describe("isUnreachableError", () => {
  it("treats dropped fetches and exhausted files as unreachable", () => {
    expect(isUnreachableError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isUnreachableError(new DOMException("The operation was aborted.", "AbortError"))).toBe(
      true,
    );
    expect(isUnreachableError(new HttpError("EMFILE: too many open files", 503))).toBe(true);
    expect(isUnreachableError(new HttpError("File not found", 404))).toBe(false);
  });
});

describe("isRetryableGetFailure", () => {
  it("retries GET network and 503, not POST or 400", () => {
    expect(isRetryableGetFailure("GET", new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableGetFailure("GET", new HttpError("busy", 503))).toBe(true);
    expect(isRetryableGetFailure("GET", new HttpError("nope", 400))).toBe(false);
    expect(isRetryableGetFailure("POST", new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("json GET retry", () => {
  it("retries a failed GET then succeeds", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse([{ id: "s1" }]));
    vi.stubGlobal("fetch", fetchFn);
    const pending = api.sessions();
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toEqual([{ id: "s1" }]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry POST chat", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: "busy" }, 503));
    vi.stubGlobal("fetch", fetchFn);
    await expect(api.chat("s1", "hello")).rejects.toThrow("busy");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("aborts a hung chat POST", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchFn);
    await api.chat("s1", "hello");
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(CHAT_POST_TIMEOUT_MS).toBe(20_000);
  });

  it("unwraps a JSON forge error envelope", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error:
            '{"type": "error", "error": {"message": "Token is invalid, expired, or not supported for this endpoint."}}',
        },
        401,
      ),
    );
    vi.stubGlobal("fetch", fetchFn);
    await expect(api.repoPulls("r1")).rejects.toThrow(
      "Token is invalid, expired, or not supported for this endpoint.",
    );
  });
});

describe("phone bearer", () => {
  it("sends Authorization and credentials after capturing ?token=", async () => {
    initPhoneAuth(
      { pathname: "/", search: "?token=ph_from_qr", hash: "" },
      { replaceState: vi.fn() },
    );
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchFn);
    await api.sessions();
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer ph_from_qr");
  });
});

describe("importDesignSystem", () => {
  it("uploads a File as multipart instead of JSON base64", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ id: "sys1", name: "Harbor" }, 201));
    vi.stubGlobal("fetch", fetchFn);
    const file = new File(["pk"], "Harbor_Design_System.zip", { type: "application/zip" });
    await expect(api.importDesignSystem({ file })).resolves.toEqual({
      id: "sys1",
      name: "Harbor",
    });
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect(
      String((init.headers as Record<string, string> | undefined)?.["content-type"] ?? ""),
    ).not.toContain("application/json");
    const form = init.body as FormData;
    expect((form.get("file") as File).name).toBe("Harbor_Design_System.zip");
  });
});

describe("slackUpload", () => {
  it("posts the file as multipart without a JSON content-type", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        ts: "1.2",
        channelId: "C_ENG",
        text: "notes.txt",
        files: [{ url: "slack-file://notes.txt", title: "notes.txt" }],
      }),
    );
    vi.stubGlobal("fetch", fetchFn);
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await expect(api.slackUpload("C_ENG", file, { comment: "patch", as: "user" })).resolves.toEqual(
      expect.objectContaining({ channelId: "C_ENG" }),
    );
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect(
      String((init.headers as Record<string, string> | undefined)?.["content-type"] ?? ""),
    ).not.toContain("application/json");
    const form = init.body as FormData;
    expect((form.get("file") as File).name).toBe("notes.txt");
    expect(form.get("comment")).toBe("patch");
    expect(form.get("as")).toBe("user");
  });
});

describe("repo pull cache", () => {
  it("reuses a fresh PR list instead of refetching", async () => {
    const rows = [
      {
        repoId: "r1",
        forge: "github",
        number: 3,
        title: "Fix",
        state: "open",
        headRef: "feat",
        baseRef: "main",
        headSha: "abc",
        url: "https://github.com/acme/app/pull/3",
        updatedAt: "2026-08-22T00:00:00.000Z",
      },
    ];
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(rows));
    vi.stubGlobal("fetch", fetchFn);
    await expect(api.repoPulls("r1", "open")).resolves.toEqual(rows);
    await expect(api.repoPulls("r1", "open")).resolves.toEqual(rows);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await expect(api.repoPulls("r1", "open", { fresh: true })).resolves.toEqual(rows);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(String(fetchFn.mock.calls[1]?.[0])).toContain("fresh=1");
  });

  it("does not let a slower list fetch overwrite a fresher one", async () => {
    const stale = [
      {
        repoId: "r1",
        forge: "github",
        number: 1,
        title: "Stale",
        state: "open",
        headRef: "a",
        baseRef: "main",
        headSha: "a",
        url: "https://github.com/acme/app/pull/1",
        updatedAt: "2026-08-22T00:00:00.000Z",
      },
    ];
    const fresh = [
      { ...stale[0]!, number: 2, title: "Fresh", url: "https://github.com/acme/app/pull/2" },
    ];
    let releaseStale: (value: Response) => void = () => undefined;
    const staleGate = new Promise<Response>((resolve) => {
      releaseStale = resolve;
    });
    const fetchFn = vi.fn((input: RequestInfo) => {
      if (String(input).includes("fresh=1")) return Promise.resolve(jsonResponse(fresh));
      return staleGate;
    });
    vi.stubGlobal("fetch", fetchFn);
    const first = api.repoPulls("r1", "open");
    await Promise.resolve();
    await expect(api.repoPulls("r1", "open", { fresh: true })).resolves.toEqual(fresh);
    releaseStale(jsonResponse(stale));
    await expect(first).resolves.toEqual(stale);
    await expect(api.repoPulls("r1", "open")).resolves.toEqual(fresh);
  });
});

describe("connectEvents", () => {
  it("reconnects after the socket closes and resyncs status", async () => {
    vi.useFakeTimers();
    MockSocket.instances = [];
    const statuses: boolean[] = [];
    const events: Array<{ type: string }> = [];
    const stop = connectEvents(
      (event) => events.push(event),
      (connected) => statuses.push(connected),
      {
        WebSocketImpl: MockSocket as unknown as typeof WebSocket,
        retryDelayMs: () => 100,
        loc: { protocol: "http:", host: "127.0.0.1:7420" },
        subscribeNetwork: false,
      },
    );
    expect(MockSocket.instances).toHaveLength(1);
    expect(MockSocket.instances[0]?.url).toBe("ws://127.0.0.1:7420/ws");
    MockSocket.instances[0]!.open();
    expect(statuses).toEqual([true]);
    MockSocket.instances[0]!.onmessage?.({
      data: JSON.stringify({ type: "chat.done", sessionId: "s1" }),
    });
    MockSocket.instances[0]!.close();
    expect(statuses).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(100);
    expect(MockSocket.instances).toHaveLength(2);
    MockSocket.instances[1]!.open();
    expect(statuses).toEqual([true, false, true]);
    MockSocket.instances[1]!.onmessage?.({
      data: JSON.stringify({ type: "chat.done", sessionId: "s1" }),
    });
    expect(events).toEqual([
      { type: "chat.done", sessionId: "s1" },
      { type: "chat.done", sessionId: "s1" },
    ]);
    stop();
  });

  it("retryEvents opens immediately instead of waiting for backoff", async () => {
    vi.useFakeTimers();
    MockSocket.instances = [];
    const stop = connectEvents(() => undefined, undefined, {
      WebSocketImpl: MockSocket as unknown as typeof WebSocket,
      retryDelayMs: () => 5_000,
      loc: { protocol: "http:", host: "127.0.0.1:7420" },
      subscribeNetwork: false,
    });
    MockSocket.instances[0]!.open();
    MockSocket.instances[0]!.close();
    expect(MockSocket.instances).toHaveLength(1);
    retryEvents();
    expect(MockSocket.instances).toHaveLength(2);
    stop();
  });

  it("ignores a stale socket close after reconnect", async () => {
    vi.useFakeTimers();
    MockSocket.instances = [];
    const statuses: boolean[] = [];
    const stop = connectEvents(
      () => undefined,
      (connected) => statuses.push(connected),
      {
        WebSocketImpl: MockSocket as unknown as typeof WebSocket,
        retryDelayMs: () => 100,
        loc: { protocol: "http:", host: "127.0.0.1:7420" },
        subscribeNetwork: false,
      },
    );
    MockSocket.instances[0]!.open();
    MockSocket.instances[0]!.close();
    await vi.advanceTimersByTimeAsync(100);
    MockSocket.instances[1]!.open();
    expect(statuses).toEqual([true, false, true]);
    MockSocket.instances[0]!.onclose?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(statuses).toEqual([true, false, true]);
    expect(MockSocket.instances).toHaveLength(2);
    stop();
  });

  it("stops reconnecting after close", async () => {
    vi.useFakeTimers();
    MockSocket.instances = [];
    const stop = connectEvents(() => undefined, undefined, {
      WebSocketImpl: MockSocket as unknown as typeof WebSocket,
      retryDelayMs: () => 50,
      loc: { protocol: "http:", host: "127.0.0.1:7420" },
      subscribeNetwork: false,
    });
    MockSocket.instances[0]!.open();
    stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(MockSocket.instances).toHaveLength(1);
  });

  it("abandons a CONNECTING socket so Retry now can open a new one", () => {
    MockSocket.instances = [];
    const stop = connectEvents(() => undefined, undefined, {
      WebSocketImpl: MockSocket as unknown as typeof WebSocket,
      retryDelayMs: () => 5_000,
      loc: { protocol: "http:", host: "127.0.0.1:7420" },
      subscribeNetwork: false,
    });
    expect(MockSocket.instances).toHaveLength(1);
    expect(MockSocket.instances[0]!.readyState).toBe(0);
    retryEvents();
    expect(MockSocket.instances).toHaveLength(2);
    stop();
  });

  it("times out a CONNECTING socket and reconnects", async () => {
    vi.useFakeTimers();
    MockSocket.instances = [];
    const stop = connectEvents(() => undefined, undefined, {
      WebSocketImpl: MockSocket as unknown as typeof WebSocket,
      retryDelayMs: () => 100,
      connectTimeoutMs: 1_000,
      loc: { protocol: "http:", host: "127.0.0.1:7420" },
      subscribeNetwork: false,
    });
    expect(MockSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(MockSocket.instances[0]!.readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(MockSocket.instances).toHaveLength(2);
    stop();
  });
});
