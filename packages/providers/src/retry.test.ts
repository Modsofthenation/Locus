import { describe, expect, it } from "vitest";
import {
  fetchProvider,
  formatProviderError,
  isRetryableProviderError,
  isTimeoutError,
  providerTimeoutError,
  timeoutClock,
} from "./retry.js";
import { ProviderError, unknownStopError } from "./types.js";

function jsonResponse(status: number, body = ""): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("fetchProvider", () => {
  it("retries a 503 then streams the success", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(503, "busy");
      return jsonResponse(200, "ok");
    };
    const res = await fetchProvider(fetchFn, "https://api.example/v1", { method: "POST" }, [0, 0]);
    expect(calls).toBe(2);
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe("ok");
  });

  it("retries a dropped connection then succeeds", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return jsonResponse(200, "ok");
    };
    const res = await fetchProvider(fetchFn, "https://api.example/v1", { method: "POST" }, [0]);
    expect(calls).toBe(2);
    expect(await res.text()).toBe("ok");
  });

  it("backs off on 429 using Retry-After", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      }
      return jsonResponse(200, "ok");
    };
    const res = await fetchProvider(fetchFn, "https://api.example/v1", { method: "POST" }, [0]);
    expect(calls).toBe(2);
    expect(await res.text()).toBe("ok");
  });

  it("does not retry a TimeoutError", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      throw Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      });
    };
    await expect(
      fetchProvider(fetchFn, "https://api.example/v1", { method: "POST" }, [0, 0]),
    ).rejects.toSatisfy((err: unknown) => isTimeoutError(err));
    expect(calls).toBe(1);
  });
});

describe("provider timeout errors", () => {
  it("recognizes AbortSignal timeout messages and nested causes", () => {
    const nested = {
      name: "AbortError",
      message: "This operation was aborted",
      cause: { name: "TimeoutError", message: "The operation was aborted due to timeout" },
    };
    expect(isTimeoutError(nested)).toBe(true);
    expect(isTimeoutError(new Error("nope"))).toBe(false);
  });

  it("rewrites the DOM abort message for chat", () => {
    const raw = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    expect(formatProviderError(raw)).toBe(
      "Provider timed out waiting for the model. Retry the prompt, or switch to a faster model.",
    );
    expect(formatProviderError(providerTimeoutError(180_000))).toBe(
      "Provider timed out after 180s with no response.",
    );
    expect(formatProviderError(providerTimeoutError(60_000, "deadline"))).toBe(
      "Provider timed out after 60s.",
    );
  });

  it("stamps idle vs deadline clocks on timeout errors", () => {
    expect(timeoutClock(providerTimeoutError(1_000))).toBe("idle");
    expect(timeoutClock(providerTimeoutError(1_000, "deadline"))).toBe("deadline");
    expect(timeoutClock(new Error("nope"))).toBeUndefined();
    expect(
      timeoutClock(
        Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        }),
      ),
    ).toBeUndefined();
    expect(timeoutClock(Object.assign(new ProviderError("busy", 429), { clock: "idle" }))).toBe(
      undefined,
    );
  });
});

describe("retryable provider errors", () => {
  it("retries unknown-stop errors without an HTTP status", () => {
    expect(isRetryableProviderError(unknownStopError())).toBe(true);
    expect(isRetryableProviderError(new ProviderError("bad request", 400))).toBe(false);
    expect(isRetryableProviderError(new ProviderError("busy", 503))).toBe(true);
  });
});
