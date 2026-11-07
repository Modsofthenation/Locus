import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit.js";

describe("createRateLimiter", () => {
  it("allows up to max hits then rejects inside the window", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    expect(limiter.allow("peer")).toBe(true);
    expect(limiter.allow("peer")).toBe(true);
    expect(limiter.allow("peer")).toBe(false);
    expect(limiter.allow("other")).toBe(true);
  });
});
