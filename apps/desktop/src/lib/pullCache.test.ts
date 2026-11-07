import { afterEach, describe, expect, it } from "vitest";
import type { PullRequestRef } from "@locus/shared";
import {
  clearPullCaches,
  invalidatePullLists,
  peekPullDetail,
  peekPullList,
  rememberPullDetail,
  rememberPullList,
} from "./pullCache";

const row: PullRequestRef = {
  repoId: "r1",
  forge: "github",
  number: 12,
  title: "Fix",
  state: "open",
  headRef: "feat",
  baseRef: "main",
  headSha: "abc",
  url: "https://github.com/acme/app/pull/12",
  updatedAt: "2026-08-22T00:00:00.000Z",
};

afterEach(() => {
  clearPullCaches();
});

describe("pullCache", () => {
  it("returns a fresh list peek and drops lists on invalidate", () => {
    rememberPullList("r1", "open", [row]);
    expect(peekPullList("r1", "open")?.fresh).toBe(true);
    expect(peekPullList("r1", "draft")).toBeUndefined();
    invalidatePullLists("r1");
    expect(peekPullList("r1", "open")).toBeUndefined();
  });

  it("keeps details when lists are invalidated and clears one repo", () => {
    rememberPullList("r1", "open", [row]);
    rememberPullDetail("r1", 12, { ...row, files: [], comments: [], commits: [], checks: [] });
    rememberPullList("r2", "open", [{ ...row, repoId: "r2", number: 1 }]);
    invalidatePullLists("r1");
    expect(peekPullList("r1", "open")).toBeUndefined();
    expect(peekPullDetail("r1", 12)?.pull.number).toBe(12);
    clearPullCaches("r1");
    expect(peekPullDetail("r1", 12)).toBeUndefined();
    expect(peekPullList("r2", "open")?.rows).toHaveLength(1);
  });
});
