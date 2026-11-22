import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffDelays, retry } from "../src/retry.ts";

const noSleep = async () => {};

test("returns the first success", async () => {
  let calls = 0;
  const value = await retry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("flaky");
      return "ok";
    },
    5,
    { baseMs: 10, maxMs: 100 },
    noSleep,
  );
  assert.equal(value, "ok");
  assert.equal(calls, 3);
});

test("rethrows after the last retry", async () => {
  let calls = 0;
  await assert.rejects(
    retry(
      async () => {
        calls += 1;
        throw new Error(`boom ${calls}`);
      },
      2,
      { baseMs: 10, maxMs: 100 },
      noSleep,
    ),
    /boom 3/,
  );
});

test("delays grow geometrically from baseMs", () => {
  assert.deepEqual(backoffDelays(4, { baseMs: 100, maxMs: 10_000 }), [100, 200, 400, 800]);
  assert.deepEqual(backoffDelays(3, { baseMs: 50, maxMs: 10_000, factor: 3 }), [50, 150, 450]);
});

test("delays never exceed maxMs", () => {
  assert.deepEqual(
    backoffDelays(6, { baseMs: 200, maxMs: 1000 }),
    [200, 400, 800, 1000, 1000, 1000],
  );
});

test("waits the backoff delays between tries", async () => {
  const waits: number[] = [];
  await assert.rejects(
    retry(
      async () => {
        throw new Error("down");
      },
      3,
      { baseMs: 100, maxMs: 250 },
      async (ms) => {
        waits.push(ms);
      },
    ),
  );
  assert.deepEqual(waits, [100, 200, 250]);
});
