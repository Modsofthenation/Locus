import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetWorkspaceFiles,
  loadWorkspaceFile,
  peekWorkspaceFile,
  rememberWorkspaceFile,
  resetWorkspaceFileCache,
} from "./workspaceFileCache";

afterEach(() => {
  resetWorkspaceFileCache();
});

describe("workspaceFileCache", () => {
  it("returns a remembered file and forgets one session", () => {
    rememberWorkspaceFile("s1", { path: "a.ts", content: "a", mtime: "t" });
    rememberWorkspaceFile("s2", { path: "b.ts", content: "b", mtime: "t" });
    expect(peekWorkspaceFile("s1", "a.ts")?.content).toBe("a");
    forgetWorkspaceFiles("s1");
    expect(peekWorkspaceFile("s1", "a.ts")).toBeUndefined();
    expect(peekWorkspaceFile("s2", "b.ts")?.content).toBe("b");
  });

  it("dedupes in-flight reads and serves the cache on the next open", async () => {
    let calls = 0;
    let release!: (value: { path: string; content: string; mtime: string }) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<{ path: string; content: string; mtime: string }>((resolve) => {
          calls += 1;
          release = resolve;
        }),
    );
    const first = loadWorkspaceFile("s1", "a.ts", fetcher);
    const second = loadWorkspaceFile("s1", "a.ts", fetcher);
    expect(calls).toBe(1);
    release({ path: "a.ts", content: "hi", mtime: "t" });
    expect(await first).toEqual({ path: "a.ts", content: "hi", mtime: "t" });
    expect(await second).toEqual({ path: "a.ts", content: "hi", mtime: "t" });
    expect(await loadWorkspaceFile("s1", "a.ts", fetcher)).toEqual({
      path: "a.ts",
      content: "hi",
      mtime: "t",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reloads past the cache when asked", async () => {
    rememberWorkspaceFile("s1", { path: "a.ts", content: "old", mtime: "t" });
    const next = await loadWorkspaceFile(
      "s1",
      "a.ts",
      async () => ({ path: "a.ts", content: "new", mtime: "t2" }),
      { reload: true },
    );
    expect(next.content).toBe("new");
    expect(peekWorkspaceFile("s1", "a.ts")?.content).toBe("new");
  });

  it("does not remember a fetch that finished after the path was forgotten", async () => {
    let release!: (value: { path: string; content: string; mtime: string }) => void;
    const pending = loadWorkspaceFile(
      "s1",
      "a.ts",
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    forgetWorkspaceFiles("s1", ["a.ts"]);
    release({ path: "a.ts", content: "stale", mtime: "t" });
    expect(await pending).toEqual({ path: "a.ts", content: "stale", mtime: "t" });
    expect(peekWorkspaceFile("s1", "a.ts")).toBeUndefined();
  });
});
