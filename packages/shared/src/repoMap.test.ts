import { describe, expect, it } from "vitest";
import { formatRepoMap, searchRepoMap, type RepoMap } from "./repoMap.js";

function sampleMap(): RepoMap {
  const files = [];
  for (let i = 0; i < 300; i += 1) {
    files.push({
      path: `src/module${i}/handler${i % 7}.ts`,
      bytes: 100,
      symbols: [`handle${i}`, `ConfigLoader${i % 5}`],
    });
  }
  files.push({ path: "src/workspaceGrep.ts", bytes: 10, symbols: ["grepWorkspace"] });
  files.push({ path: "README.md", bytes: 10, symbols: [] });
  return { files };
}

describe("searchRepoMap", () => {
  it("returns the same hits when narrowing from the previous keystroke", () => {
    const query = "hndlr3cfg";
    const typed = sampleMap();
    let narrowed = searchRepoMap(typed, "");
    for (let k = 1; k <= query.length; k += 1) narrowed = searchRepoMap(typed, query.slice(0, k));
    const fresh = searchRepoMap(sampleMap(), query);
    expect(narrowed).toEqual(fresh);

    // Backspacing then typing a different letter must not reuse the narrowed pool.
    searchRepoMap(typed, "wg");
    expect(searchRepoMap(typed, "wgr")).toEqual(searchRepoMap(sampleMap(), "wgr"));
    expect(searchRepoMap(typed, "rea")).toEqual(searchRepoMap(sampleMap(), "rea"));
  });
});

describe("formatRepoMap", () => {
  it("lists query matches first and stays within the character budget", () => {
    const text = formatRepoMap(sampleMap(), {
      query: "workspace grep",
      rank: true,
      maxChars: 2_000,
    });
    const lines = text.split("\n");
    expect(lines[1]).toMatch(/^src\/workspaceGrep\.ts/);
    expect(lines.at(-1)).toBe("…[repo map truncated]");
    expect(lines.slice(0, -1).join("\n").length).toBeLessThanOrEqual(2_000);
  });

  it("does not truncate when everything fits", () => {
    const map: RepoMap = { files: [{ path: "a.ts", symbols: ["alpha"] }] };
    expect(formatRepoMap(map)).toBe(
      "Repo map (1 files). Prefer grep/file_read on these paths instead of dumping files.\na.ts  alpha",
    );
  });
});
