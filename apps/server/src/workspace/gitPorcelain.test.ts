import { describe, expect, it } from "vitest";
import { parsePorcelainV2, porcelainPathSets } from "./gitPorcelain.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("parsePorcelainV2", () => {
  it("reads branch headers and every entry kind", () => {
    const out = [
      `# branch.oid ${SHA}`,
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      `1 .M N... 100644 100644 100644 ${SHA} ${SHA} src/a file.ts`,
      `1 D. N... 100644 000000 000000 ${SHA} ${SHA} gone.ts`,
      `2 R. N... 100644 100644 100644 ${SHA} ${SHA} R100 src/new.ts`,
      "src/old.ts",
      `u UU N... 100644 100644 100644 100644 ${SHA} ${SHA} ${SHA} both.ts`,
      "? fresh.ts",
      "",
    ].join("\0");
    const status = parsePorcelainV2(out);
    expect(status).toMatchObject({
      head: SHA,
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
    expect(status.entries).toEqual([
      { path: "src/a file.ts", index: " ", worktree: "M" },
      { path: "gone.ts", index: "D", worktree: " " },
      { path: "src/new.ts", index: "R", worktree: " ", from: "src/old.ts" },
      { path: "both.ts", index: "U", worktree: "U", unmerged: true },
      { path: "fresh.ts", index: "?", worktree: "?", untracked: true },
    ]);
    expect(porcelainPathSets(status)).toEqual({
      present: ["src/a file.ts", "src/new.ts", "both.ts", "fresh.ts"],
      gone: ["gone.ts", "src/old.ts"],
    });
  });

  it("handles a fresh repo and a detached HEAD", () => {
    expect(parsePorcelainV2("# branch.oid (initial)\0# branch.head main\0")).toMatchObject({
      head: undefined,
      branch: "main",
    });
    expect(parsePorcelainV2(`# branch.oid ${SHA}\0# branch.head (detached)\0`).branch).toBe(
      "detached",
    );
  });
});
