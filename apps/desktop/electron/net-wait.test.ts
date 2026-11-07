// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const { drainResponse, isTransientLoadError, loadUrlWithRetry, waitForUrl, waitUntilUrlDown } =
  createRequire(import.meta.url)("./net-wait.cjs") as {
    drainResponse: (res: {
      arrayBuffer?: () => Promise<unknown>;
      body?: { cancel?: () => void };
    }) => Promise<void>;
    isTransientLoadError: (err: unknown) => boolean;
    loadUrlWithRetry: (
      win: { loadURL: (url: string) => Promise<void> },
      url: string,
      opts?: { attempts?: number; sleep?: (ms: number) => Promise<void> },
    ) => Promise<void>;
    waitForUrl: (
      url: string,
      opts?: {
        timeoutMs?: number;
        fetch?: (
          url: string,
          init?: { signal?: AbortSignal },
        ) => Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>;
        sleep?: (ms: number) => Promise<void>;
        now?: () => number;
      },
    ) => Promise<void>;
    waitUntilUrlDown: (
      url: string,
      opts?: {
        timeoutMs?: number;
        fetch?: (
          url: string,
          init?: { signal?: AbortSignal },
        ) => Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>;
        sleep?: (ms: number) => Promise<void>;
        now?: () => number;
      },
    ) => Promise<void>;
  };

describe("isTransientLoadError", () => {
  it("retries Windows buffer-space and connection flaps", () => {
    expect(
      isTransientLoadError(
        new Error("ERR_NO_BUFFER_SPACE (-176) loading 'http://127.0.0.1:7420/'"),
      ),
    ).toBe(true);
    expect(isTransientLoadError({ message: "connect failed", errno: 10055 })).toBe(true);
    expect(isTransientLoadError({ code: "ERR_CONNECTION_REFUSED" })).toBe(true);
    expect(isTransientLoadError(new Error("ERR_FILE_NOT_FOUND"))).toBe(false);
  });
});

describe("drainResponse", () => {
  it("reads the body so the socket can close", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    await drainResponse({ arrayBuffer });
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });
});

describe("waitForUrl", () => {
  it("consumes a healthy response and returns", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(2));
    const fetch = vi.fn(async () => ({ ok: true, arrayBuffer }));
    await waitForUrl("http://127.0.0.1:7420/api/health", { fetch, timeoutMs: 1000 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });

  it("backs off on non-OK instead of spinning", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls += 1;
      return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
    });
    let t = 0;
    await expect(
      waitForUrl("http://127.0.0.1:7420/api/health", {
        fetch,
        timeoutMs: 400,
        now: () => t,
        sleep: async (ms) => {
          sleeps.push(ms);
          t += ms;
        },
      }),
    ).rejects.toThrow(/Timed out/);
    expect(calls).toBeGreaterThan(1);
    expect(sleeps[0]).toBe(250);
    expect(sleeps.every((ms) => ms >= 250)).toBe(true);
  });

  it("does not treat a missing-UI 503 as ready", async () => {
    let calls = 0;
    let t = 0;
    const fetch = vi.fn(async () => {
      calls += 1;
      if (calls < 3) return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(2) };
    });
    await waitForUrl("http://127.0.0.1:7420/", {
      fetch,
      timeoutMs: 2000,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    expect(calls).toBe(3);
  });
});

describe("waitUntilUrlDown", () => {
  it("returns once fetch fails", async () => {
    let calls = 0;
    let t = 0;
    const fetch = vi.fn(async () => {
      calls += 1;
      if (calls < 2) return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
      throw new Error("ECONNREFUSED");
    });
    await waitUntilUrlDown("http://127.0.0.1:7420/api/health", {
      fetch,
      timeoutMs: 2000,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    expect(calls).toBe(2);
  });
});

describe("loadUrlWithRetry", () => {
  it("retries ERR_NO_BUFFER_SPACE then loads", async () => {
    const sleeps: number[] = [];
    const loadURL = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("ERR_NO_BUFFER_SPACE (-176) loading 'http://127.0.0.1:7420/'"),
      )
      .mockResolvedValueOnce(undefined);
    await loadUrlWithRetry({ loadURL }, "http://127.0.0.1:7420/", {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(loadURL).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([200]);
  });

  it("does not retry a permanent load failure", async () => {
    const loadURL = vi.fn().mockRejectedValue(new Error("ERR_FILE_NOT_FOUND"));
    await expect(loadUrlWithRetry({ loadURL }, "file:///missing")).rejects.toThrow(
      "ERR_FILE_NOT_FOUND",
    );
    expect(loadURL).toHaveBeenCalledOnce();
  });
});
