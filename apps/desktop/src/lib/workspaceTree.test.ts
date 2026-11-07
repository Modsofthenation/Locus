import { describe, expect, it } from "vitest";
import {
  buildWorkspaceTree,
  changeStatsForPath,
  countWorkspaceTreeNodes,
  flattenVisibleWorkspaceRows,
  dockerRuntimeLabel,
  filterWorkspaceTree,
  languageLabel,
  MAX_HOT_WORKSPACE_DOCS,
  pruneHotWorkspaceDocs,
  WORKSPACE_FILTER_MAX_NODES,
  workspaceTreeQueryHits,
  rollupChangeStats,
  sameWorkspaceChanges,
  sameWorkspaceEntries,
  dirsNeedingWorkspaceListing,
  mergeWorkspaceEntries,
  withExpandedWorkspaceListings,
  workspaceEntriesForMode,
} from "./workspaceTree";

describe("buildWorkspaceTree", () => {
  it("nests files under directories and sorts dirs first", () => {
    const tree = buildWorkspaceTree([
      { name: "app.ts", path: "apps/desktop/src/app.ts", type: "file" },
      { name: "src", path: "apps/desktop/src", type: "dir" },
      { name: "desktop", path: "apps/desktop", type: "dir" },
      { name: "apps", path: "apps", type: "dir" },
      { name: "package.json", path: "apps/desktop/package.json", type: "file" },
      { name: "README.md", path: "README.md", type: "file" },
    ]);
    expect(tree.map((n) => n.name)).toEqual(["apps", "README.md"]);
    expect(tree[0]?.children.map((n) => n.name)).toEqual(["desktop"]);
    expect(tree[0]?.children[0]?.children.map((n) => n.name)).toEqual(["src", "package.json"]);
    expect(tree[0]?.children[0]?.children[0]?.children.map((n) => n.path)).toEqual([
      "apps/desktop/src/app.ts",
    ]);
  });

  it("creates missing parent dirs from file paths", () => {
    const tree = buildWorkspaceTree([{ name: "app.ts", path: "src/app.ts", type: "file" }]);
    expect(tree).toEqual([
      {
        name: "src",
        path: "src",
        type: "dir",
        children: [{ name: "app.ts", path: "src/app.ts", type: "file", children: [] }],
      },
    ]);
  });
});

function treePaths(nodes: ReturnType<typeof buildWorkspaceTree>): string[] {
  const out: string[] = [];
  const walk = (node: (typeof nodes)[number]) => {
    out.push(node.path);
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return out;
}

describe("flattenVisibleWorkspaceRows", () => {
  const tree = buildWorkspaceTree([
    { name: "app.ts", path: "apps/desktop/src/app.ts", type: "file" },
    { name: "src", path: "apps/desktop/src", type: "dir" },
    { name: "desktop", path: "apps/desktop", type: "dir" },
    { name: "apps", path: "apps", type: "dir" },
    { name: "README.md", path: "README.md", type: "file" },
  ]);

  it("hides nested files until a folder is expanded", () => {
    const rows = flattenVisibleWorkspaceRows(tree, new Set(), false);
    expect(rows.map((row) => row.path)).toEqual(["apps", "README.md"]);
    expect(rows[0]).toMatchObject({ type: "dir", depth: 0, hasChildren: true });
  });

  it("walks open folders and records depth", () => {
    const rows = flattenVisibleWorkspaceRows(tree, new Set(["apps", "apps/desktop"]), false);
    expect(rows.map((row) => `${row.depth}:${row.path}`)).toEqual([
      "0:apps",
      "1:apps/desktop",
      "2:apps/desktop/src",
      "0:README.md",
    ]);
  });
});

describe("filterWorkspaceTree", () => {
  const tree = buildWorkspaceTree([
    { name: "package.json", path: "apps/desktop/package.json", type: "file" },
    { name: "app.ts", path: "src/app.ts", type: "file" },
    { name: "noise.ts", path: "apps/desktop/noise.ts", type: "file" },
  ]);

  it("keeps ancestors of matching files", () => {
    const filtered = filterWorkspaceTree(tree, "package");
    expect(filtered.map((n) => n.path)).toEqual(["apps"]);
    expect(filtered[0]?.children[0]?.children.map((n) => n.name)).toEqual(["package.json"]);
  });

  it("returns the full subtree when a folder name matches exactly", () => {
    const filtered = filterWorkspaceTree(tree, "src");
    expect(filtered.map((n) => n.path)).toEqual(["src"]);
    expect(filtered[0]?.children.map((n) => n.name)).toEqual(["app.ts"]);
  });

  it("does not dump a parent folder whose name merely contains the query", () => {
    const filtered = filterWorkspaceTree(tree, "app");
    expect(treePaths(filtered)).toEqual(["src", "src/app.ts"]);
    expect(treePaths(filtered)).not.toContain("apps/desktop/noise.ts");
  });

  it("matches path queries that contain a slash", () => {
    const filtered = filterWorkspaceTree(tree, "desktop/package");
    expect(treePaths(filtered)).toEqual(["apps", "apps/desktop", "apps/desktop/package.json"]);
  });

  it("caps expanded hits so a broad query cannot mount the whole workspace", () => {
    const entries = Array.from({ length: 3_000 }, (_, i) => ({
      name: `file${i}.ts`,
      path: `src/mod${i % 40}/file${i}.ts`,
      type: "file" as const,
    }));
    const big = buildWorkspaceTree(entries);
    const start = performance.now();
    const filtered = filterWorkspaceTree(big, "file");
    const elapsed = performance.now() - start;
    expect(countWorkspaceTreeNodes(filtered)).toBeGreaterThan(300);
    expect(countWorkspaceTreeNodes(filtered)).toBeLessThanOrEqual(WORKSPACE_FILTER_MAX_NODES + 8);
    expect(elapsed).toBeLessThan(80);
  });

  it("keeps the best basename match inside the filter cap", () => {
    const entries = [
      ...Array.from({ length: 500 }, (_, i) => ({
        name: `editor${i}.ts`,
        path: `src/editor${i}.ts`,
        type: "file" as const,
      })),
      { name: "WorkspaceEditor.tsx", path: "z/WorkspaceEditor.tsx", type: "file" as const },
    ];
    const filtered = filterWorkspaceTree(buildWorkspaceTree(entries), "WorkspaceEditor");
    expect(treePaths(filtered)).toContain("z/WorkspaceEditor.tsx");
    expect(countWorkspaceTreeNodes(filtered)).toBeLessThan(8);
  });

  it("matches camelCase word-starts on the basename", () => {
    const tree = buildWorkspaceTree([
      { name: "WorkspaceEditor.tsx", path: "apps/desktop/WorkspaceEditor.tsx", type: "file" },
      { name: "noise.ts", path: "src/noise.ts", type: "file" },
    ]);
    expect(treePaths(filterWorkspaceTree(tree, "WE"))).toEqual([
      "apps",
      "apps/desktop",
      "apps/desktop/WorkspaceEditor.tsx",
    ]);
  });
});

describe("workspaceTreeQueryHits", () => {
  it("matches basename substrings and exact ancestor folders, not parent-path substrings", () => {
    expect(workspaceTreeQueryHits("app.ts", "src/app.ts", "app")).toBe(true);
    expect(workspaceTreeQueryHits("noise.ts", "apps/desktop/noise.ts", "app")).toBe(false);
    expect(workspaceTreeQueryHits("app.ts", "src/app.ts", "src")).toBe(true);
    expect(
      workspaceTreeQueryHits("package.json", "apps/desktop/package.json", "desktop/pack"),
    ).toBe(true);
    expect(workspaceTreeQueryHits("WorkspaceEditor.tsx", "src/WorkspaceEditor.tsx", "we")).toBe(
      true,
    );
  });
});

describe("workspaceEntriesForMode", () => {
  const entries = [
    { name: "src", path: "src", type: "dir" as const },
    { name: "app.ts", path: "src/app.ts", type: "file" as const },
    { name: "package.json", path: "package.json", type: "file" as const },
  ];
  const changes = [
    { path: "src/app.ts", additions: 4, deletions: 1 },
    { path: "gone.ts", additions: 0, deletions: 3 },
  ];

  it("keeps the full tree in all mode", () => {
    expect(workspaceEntriesForMode(entries, changes, "all")).toEqual(entries);
  });

  it("keeps changed files, ancestors, and missing deleted paths", () => {
    const next = workspaceEntriesForMode(entries, changes, "updated");
    expect(next.map((row) => row.path)).toEqual(["src", "src/app.ts", "gone.ts"]);
  });
});

describe("changeStatsForPath", () => {
  it("sums nested file stats onto directories", () => {
    const byPath = new Map([
      ["src/app.ts", { path: "src/app.ts", additions: 4, deletions: 1 }],
      ["src/lib.ts", { path: "src/lib.ts", additions: 2, deletions: 0 }],
    ]);
    expect(changeStatsForPath("src/app.ts", "file", byPath)).toEqual({
      path: "src/app.ts",
      additions: 4,
      deletions: 1,
    });
    expect(changeStatsForPath("src", "dir", byPath)).toEqual({
      path: "src",
      additions: 6,
      deletions: 1,
    });
  });

  it("rolls directory stats once for O(1) lookups", () => {
    const rolled = rollupChangeStats([
      { path: "src/app.ts", additions: 4, deletions: 1 },
      { path: "src/lib.ts", additions: 2, deletions: 0 },
    ]);
    expect(rolled.get("src")).toEqual({ path: "src", additions: 6, deletions: 1 });
    expect(rolled.get("src/app.ts")).toEqual({ path: "src/app.ts", additions: 4, deletions: 1 });
  });
});

describe("expanded hidden folder listings", () => {
  const root = [
    { name: ".cursor", path: ".cursor", type: "dir" as const },
    { name: "src", path: "src", type: "dir" as const },
    { name: "app.ts", path: "src/app.ts", type: "file" as const },
  ];

  it("asks only for expanded folders whose children are missing", () => {
    expect(dirsNeedingWorkspaceListing(root, new Set([".cursor", "src"]))).toEqual([".cursor"]);
    expect(dirsNeedingWorkspaceListing(root, new Set(["src"]))).toEqual([]);
  });

  it("merges a hidden-folder listing into the root snapshot", () => {
    const merged = mergeWorkspaceEntries(root, [
      { name: "mcp.json", path: ".cursor/mcp.json", type: "file" },
      { name: "rules", path: ".cursor/rules", type: "dir" },
    ]);
    expect(merged.map((row) => row.path)).toEqual([
      ".cursor",
      ".cursor/rules",
      "src",
      ".cursor/mcp.json",
      "src/app.ts",
    ]);
  });

  it("loads nested expanded hidden folders without refetching filled ones", async () => {
    const listed: string[] = [];
    const entries = await withExpandedWorkspaceListings(
      root,
      new Set([".cursor", ".cursor/rules"]),
      async (path) => {
        listed.push(path);
        if (path === ".cursor") {
          return [
            { name: "mcp.json", path: ".cursor/mcp.json", type: "file" },
            { name: "rules", path: ".cursor/rules", type: "dir" },
          ];
        }
        return [{ name: "locus.mdc", path: ".cursor/rules/locus.mdc", type: "file" }];
      },
    );
    expect(listed).toEqual([".cursor", ".cursor/rules"]);
    expect(entries.map((row) => row.path)).toContain(".cursor/rules/locus.mdc");
    const again = await withExpandedWorkspaceListings(
      entries,
      new Set([".cursor", ".cursor/rules"]),
      async () => {
        throw new Error("should not refetch");
      },
    );
    expect(again).toEqual(entries);
  });
});

describe("sameWorkspace snapshot", () => {
  it("detects identical entry and change lists", () => {
    const entries = [{ name: "a.ts", path: "a.ts", type: "file" as const }];
    expect(sameWorkspaceEntries(entries, [{ ...entries[0]! }])).toBe(true);
    expect(sameWorkspaceEntries(entries, [{ ...entries[0]!, name: "b.ts" }])).toBe(false);
    expect(
      sameWorkspaceChanges(
        [{ path: "a.ts", additions: 1, deletions: 0 }],
        [{ path: "a.ts", additions: 1, deletions: 0 }],
      ),
    ).toBe(true);
    expect(
      sameWorkspaceChanges(
        [{ path: "a.ts", additions: 1, deletions: 0 }],
        [{ path: "a.ts", additions: 2, deletions: 0 }],
      ),
    ).toBe(false);
  });
});

describe("pruneHotWorkspaceDocs", () => {
  function doc(
    path: string,
    extra: Partial<{ content: string; original: string; cold: boolean }> = {},
  ) {
    return {
      path,
      content: extra.content ?? "ok",
      original: extra.original ?? extra.content ?? "ok",
      kind: "text" as const,
      cold: extra.cold,
    };
  }

  it("evicts idle saved buffers past the hot cap", () => {
    const docs = Array.from({ length: MAX_HOT_WORKSPACE_DOCS + 4 }, (_, i) => doc(`f${i}.ts`));
    const next = pruneHotWorkspaceDocs(docs, `f${docs.length - 1}.ts`);
    const cold = next.filter((row) => row.cold);
    const hot = next.filter((row) => !row.cold && row.content);
    expect(cold).toHaveLength(4);
    expect(hot).toHaveLength(MAX_HOT_WORKSPACE_DOCS);
    expect(next.at(-1)?.cold).toBeUndefined();
    expect(next.at(-1)?.content).toBe("ok");
    expect(cold[0]?.content).toBe("");
    expect(cold[0]?.original).toBe("");
  });

  it("never evicts the active file or an unsaved buffer", () => {
    const docs = [
      doc("dirty.ts", { content: "new", original: "old" }),
      ...Array.from({ length: MAX_HOT_WORKSPACE_DOCS }, (_, i) => doc(`f${i}.ts`)),
    ];
    const next = pruneHotWorkspaceDocs(docs, "f0.ts");
    expect(next.find((row) => row.path === "dirty.ts")).toEqual(
      expect.objectContaining({ content: "new", original: "old", cold: undefined }),
    );
    expect(next.find((row) => row.path === "f0.ts")?.cold).toBeUndefined();
    expect(next.filter((row) => row.cold).length).toBeGreaterThan(0);
  });

  it("never evicts a split pane's file", () => {
    const docs = [
      doc("side.ts"),
      ...Array.from({ length: MAX_HOT_WORKSPACE_DOCS }, (_, i) => doc(`f${i}.ts`)),
    ];
    const next = pruneHotWorkspaceDocs(docs, "f0.ts", "side.ts");
    expect(next.find((row) => row.path === "side.ts")?.cold).toBeUndefined();
    expect(next.find((row) => row.path === "side.ts")?.content).toBe("ok");
  });
});

describe("labels", () => {
  it("maps highlight languages and node image tags", () => {
    expect(languageLabel("css")).toBe("CSS");
    expect(languageLabel("scss")).toBe("SCSS");
    expect(languageLabel("less")).toBe("Less");
    expect(languageLabel("docker")).toBe("Dockerfile");
    expect(languageLabel("xml")).toBe("XML");
    expect(languageLabel("graphql")).toBe("GraphQL");
    expect(languageLabel("ini")).toBe("INI");
    expect(languageLabel("jenkins")).toBe("Jenkinsfile");
    expect(languageLabel("bash")).toBe("Shell");
    expect(languageLabel("yaml")).toBe("YAML");
    expect(languageLabel("c")).toBe("C");
    expect(languageLabel("rust")).toBe("Rust");
    expect(dockerRuntimeLabel("node:22-bookworm")).toBe("node 22");
    expect(dockerRuntimeLabel("node:20.11-alpine")).toBe("node 20.11");
    expect(dockerRuntimeLabel("locus/agent")).toBeUndefined();
  });
});
