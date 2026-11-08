import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRetryEnv, retryCommand } from "./retry-cmd.mjs";

describe("parseRetryEnv", () => {
  it("defaults to three attempts and a 30s delay", () => {
    assert.deepEqual(parseRetryEnv({}), { attempts: 3, delayMs: 30_000 });
  });

  it("reads RETRY_ATTEMPTS and RETRY_DELAY_MS", () => {
    assert.deepEqual(parseRetryEnv({ RETRY_ATTEMPTS: "5", RETRY_DELAY_MS: "0" }), {
      attempts: 5,
      delayMs: 0,
    });
  });

  it("falls back when the env is not a positive number", () => {
    assert.deepEqual(parseRetryEnv({ RETRY_ATTEMPTS: "0", RETRY_DELAY_MS: "-1" }), {
      attempts: 3,
      delayMs: 30_000,
    });
  });
});

describe("retryCommand", () => {
  it("returns on the first success", async () => {
    const calls = [];
    const last = await retryCommand("npm", ["run", "dist"], {
      attempts: 3,
      delayMs: 0,
      sleep: async () => {
        throw new Error("should not sleep on success");
      },
      run: async (command, args) => {
        calls.push([command, ...args]);
        return { code: 0 };
      },
    });
    assert.equal(last.code, 0);
    assert.deepEqual(calls, [["npm", "run", "dist"]]);
  });

  it("retries after a failure then succeeds", async () => {
    const sleeps = [];
    let n = 0;
    const last = await retryCommand("npm", ["run", "dist"], {
      attempts: 3,
      delayMs: 40,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      run: async () => {
        n += 1;
        return { code: n === 2 ? 0 : 1 };
      },
    });
    assert.equal(last.code, 0);
    assert.equal(n, 2);
    assert.deepEqual(sleeps, [40]);
  });

  it("exhausts attempts and returns the last failure", async () => {
    const sleeps = [];
    let n = 0;
    const last = await retryCommand("npm", ["run", "dist"], {
      attempts: 3,
      delayMs: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      run: async () => {
        n += 1;
        return { code: 1 };
      },
    });
    assert.equal(last.code, 1);
    assert.equal(n, 3);
    assert.deepEqual(sleeps, [10, 10]);
  });
});
