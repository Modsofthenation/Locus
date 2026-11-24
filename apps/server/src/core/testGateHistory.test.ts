import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestGateHistory, testGateHistoryKey } from "./testGateHistory.js";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "locus-test-gate-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("TestGateHistory", () => {
  it("persists the last duration per key across instances", async () => {
    const file = join(dir, "test-gate-history.json");
    const first = new TestGateHistory(file);
    expect(await first.lastDurationMs("a")).toBeUndefined();
    await first.record("a", 45 * 60_000);
    await first.record("a", 50 * 60_000);
    const second = new TestGateHistory(file);
    expect(await second.lastDurationMs("a")).toBe(50 * 60_000);
  });

  it("keys by repo and dest so per-session workspaces share history", () => {
    expect(testGateHistoryKey("https://bitbucket.org/x/Repo.git", undefined, "/ws/1")).toBe(
      testGateHistoryKey("https://bitbucket.org/x/repo", undefined, "/ws/2"),
    );
    expect(testGateHistoryKey(undefined, undefined, "/ws/1")).toBe("/ws/1");
  });
});
