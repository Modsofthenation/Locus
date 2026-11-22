import assert from "node:assert/strict";
import { test } from "node:test";
import { retry } from "../src/retry.ts";

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
