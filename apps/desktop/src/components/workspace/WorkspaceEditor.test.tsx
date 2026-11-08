import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceEditor } from "./WorkspaceEditor";
import { api } from "@/lib/api";
import { saveEditorOpenFiles } from "@/lib/editorOpenFiles";
import { saveExplorerExpanded } from "@/lib/explorerExpanded";
import { editorSplitColumns } from "@/lib/editorSplit";
import { requestWorkspaceOpenPr } from "@/lib/workspaceOpenPr";
import { resetWorkspaceFileCache } from "@/lib/workspaceFileCache";
import { applyEditorPrefs } from "@/lib/theme";
import { Store, initialState } from "@/state/store";
import { selectValue, setSelectValue } from "@/lib/selectControl";

vi.mock("@/lib/api", () => ({
  api: {
    workspaceTree: vi.fn(async () => ({
      entries: [
        { name: "src", path: "src", type: "dir" as const },
        { name: "app.ts", path: "src/app.ts", type: "file" as const },
        { name: "App.tsx", path: "src/App.tsx", type: "file" as const },
        { name: "package.json", path: "package.json", type: "file" as const },
        { name: "vite.config.ts", path: "vite.config.ts", type: "file" as const },
        { name: "manage.py", path: "manage.py", type: "file" as const },
        { name: "home.html", path: "templates/home.html", type: "file" as const },
        { name: "shot.png", path: "shot.png", type: "file" as const },
        { name: "page.html", path: "page.html", type: "file" as const },
        { name: "README.md", path: "README.md", type: "file" as const },
        { name: "logo.svg", path: "logo.svg", type: "file" as const },
        { name: "brief.pdf", path: "brief.pdf", type: "file" as const },
        { name: "big.ts", path: "src/big.ts", type: "file" as const },
      ],
      changes: [{ path: "src/app.ts", additions: 4, deletions: 1 }],
    })),
    workspaceFile: vi.fn(async (_id: string, path: string) => {
      if (path.endsWith("package.json")) {
        return { path: "package.json", content: '{\n  "name": "desktop"\n}\n', mtime: "t" };
      }
      if (path.endsWith("page.html")) {
        return { path: "page.html", content: "<h1>Hello</h1>\n", mtime: "t" };
      }
      if (path.endsWith("README.md")) {
        return {
          path: "README.md",
          content: "# Hello\n\nSee **docs**.\n\n```ts\nconst x = 1;\n```\n",
          mtime: "t",
        };
      }
      if (path.endsWith("logo.svg")) {
        return {
          path: "logo.svg",
          content:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n  <circle cx="12" cy="12" r="10" fill="gold"/>\n</svg>\n',
          mtime: "t",
        };
      }
      if (path.endsWith("App.tsx")) {
        return {
          path: "src/App.tsx",
          content: "export function App() { return <main>Hi</main>; }\n",
          mtime: "t",
        };
      }
      if (path.endsWith("home.html")) {
        return {
          path: "templates/home.html",
          content: "{% extends 'base.html' %}\n<h1>{{ title }}</h1>\n",
          mtime: "t",
        };
      }
      if (path.endsWith("big.ts")) {
        return {
          path: "src/big.ts",
          content: Array.from({ length: 80 }, (_, i) => `export const n${i} = ${i};`).join("\n"),
          mtime: "t",
        };
      }
      return { path, content: path.endsWith(".ts") ? 'const x = "hi";\n' : "", mtime: "t" };
    }),
    saveWorkspaceFile: vi.fn(),
    mkdirWorkspace: vi.fn(),
    deleteWorkspaceFile: vi.fn(),
    workspaceComplete: vi.fn(async () => ({ items: [], source: "none" })),
    workspaceInlineEdit: vi.fn(async () => ({ text: "const y = 1;" })),
    workspaceIndex: vi.fn(async () => ({
      status: "ready" as const,
      fileCount: 9,
      scanned: 9,
      builtAt: "2020-01-01T00:00:00.000Z",
    })),
    workspaceIndexStatus: vi.fn(async () => ({
      status: "ready" as const,
      fileCount: 9,
      scanned: 9,
      builtAt: "2020-01-01T00:00:00.000Z",
    })),
    workspaceSearch: vi.fn(async () => ({
      items: [
        { path: "src/app.ts", kind: "file" as const, score: 12 },
        { path: "src/app.ts", kind: "symbol" as const, symbol: "foldOldTurns", score: 20 },
      ],
      fileCount: 9,
      builtAt: "2020-01-01T00:00:00.000Z",
    })),
    workspaceGrep: vi.fn(async () => ({
      items: [{ path: "src/app.ts", line: 40, text: "const MATCH_LINE = 40;" }],
    })),
    workspaceInspect: vi.fn(async () => ({
      diagnostics: [],
      hover: null,
      definition: null,
      signature: null,
    })),
    workspaceFormat: vi.fn(async (input: { content: string }) => ({
      content: input.content,
      source: "none",
    })),
    workspaceOrganize: vi.fn(async (input: { content: string }) => ({
      content: input.content,
      source: "none",
    })),
    workspaceRename: vi.fn(async () => ({ files: [] })),
    renameWorkspacePath: vi.fn(async (_id: string, from: string, to: string) => ({
      from,
      path: to,
    })),
    workspaceReferences: vi.fn(async () => ({ items: [] })),
    workspaceOutline: vi.fn(async () => ({ items: [{ name: "App", line: 1 }] })),
    workspaceSymbols: vi.fn(async () => ({ items: [] })),
    workspaceGit: vi.fn(async () => ({ branch: "main", ahead: 0, behind: 0, files: [] })),
    workspaceGitBranches: vi.fn(async () => ({ current: "main", branches: ["main", "dev"] })),
    workspaceGitCheckout: vi.fn(async () => ({ branch: "dev", ahead: 0, behind: 0, files: [] })),
    workspaceGitPull: vi.fn(async () => ({ branch: "main", ahead: 0, behind: 0, files: [] })),
    workspaceGitFetch: vi.fn(async () => ({ branch: "main", ahead: 0, behind: 0, files: [] })),
    workspaceGitDiscard: vi.fn(async () => ({ branch: "main", ahead: 0, behind: 0, files: [] })),
    workspaceGitStage: vi.fn(async () => ({ branch: "main", ahead: 0, behind: 0, files: [] })),
    workspaceGitStashList: vi.fn(async () => ({ items: [] })),
    workspaceGitStash: vi.fn(async () => ({ branch: "main", ahead: 0, behind: 0, files: [] })),
    workspaceGitHunks: vi.fn(async () => ({ items: [] })),
    workspaceGitHunk: vi.fn(async () => ({ branch: "main", ahead: 0, behind: 0, files: [] })),
    workspaceGitRebasePreview: vi.fn(async () => ({
      onto: "main",
      todos: [],
      rebasing: false,
      conflicted: [],
    })),
    workspaceGitRebase: vi.fn(async () => ({ branch: "main", ahead: 0, behind: 0, files: [] })),
    workspaceGitPullInfo: vi.fn(async () => ({ pull: null, repoId: null })),
    workspaceFix: vi.fn(async () => ({ items: [] })),
    workspaceProblems: vi.fn(async () => ({ diagnostics: [] })),
    workspaceDebug: vi.fn(async () => ({
      status: "idle" as const,
      sessionId: "s1",
      breakpoints: [],
      stack: [],
      variables: [],
    })),
    workspaceDebugBreakpoints: vi.fn(async () => ({
      status: "idle" as const,
      sessionId: "s1",
      breakpoints: [],
      stack: [],
      variables: [],
    })),
    workspaceDebugStart: vi.fn(async () => ({
      status: "running" as const,
      sessionId: "s1",
      breakpoints: [],
      stack: [],
      variables: [],
    })),
    workspaceDebugCommand: vi.fn(async () => ({
      status: "paused" as const,
      sessionId: "s1",
      breakpoints: [],
      stack: [],
      variables: [],
    })),
    workspaceDebugStop: vi.fn(async () => ({
      status: "stopped" as const,
      sessionId: "s1",
      breakpoints: [],
      stack: [],
      variables: [],
    })),
    workspaceIndent: vi.fn(async () => ({ indent: "  ", tabSize: 2 })),
    workspaceBlame: vi.fn(async () => null),
    workspaceBlameFile: vi.fn(async () => ({ items: [] })),
    workspaceGitMerge: vi.fn(async () => ({ branch: "main", ahead: 0, behind: 0, files: [] })),
    workspaceGitConflict: vi.fn(async () => ({ branch: "main", ahead: 0, behind: 0, files: [] })),
    promoteIdeToDocker: vi.fn(),
    execTool: vi.fn(),
    dockerContainers: vi.fn(async () => ({ kind: "mock", containers: [] })),
    dockerContainerAction: vi.fn(),
    dockerContainerStats: vi.fn(async () => ({
      id: "c1",
      name: "web",
      cpuPercent: 1,
      memoryPercent: 2,
      memoryUsage: "12MiB",
      memoryLimit: "8GiB",
      networkRx: "0B",
      networkTx: "0B",
      blockRead: "0B",
      blockWrite: "0B",
      pids: 1,
      running: true,
      sampledAt: "2020-01-01T00:00:00.000Z",
    })),
    workspaceRawUrl: (id: string, path: string) =>
      `/api/sessions/${id}/workspace/raw?path=${encodeURIComponent(path)}`,
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.PointerEvent !== "function") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("WorkspaceEditor", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    applyEditorPrefs(12, true, true);
    vi.mocked(api.workspaceGit).mockResolvedValue({
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [],
    });
    vi.mocked(api.workspaceGitHunks).mockResolvedValue({ items: [] });
    vi.mocked(api.workspaceGitCheckout).mockResolvedValue({
      branch: "dev",
      ahead: 0,
      behind: 0,
      files: [],
    });
    vi.mocked(api.workspaceProblems).mockResolvedValue({ diagnostics: [] });
    vi.mocked(api.workspaceFix).mockResolvedValue({ items: [] });
    vi.mocked(api.workspaceGitPullInfo).mockResolvedValue({ pull: null, repoId: null });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
    resetWorkspaceFileCache();
    vi.mocked(api.workspaceInspect).mockReset();
    vi.mocked(api.workspaceInspect).mockResolvedValue({
      diagnostics: [],
      hover: null,
      definition: null,
    });
  });

  function expandDir(path: string) {
    const dir = host.querySelector(`[data-path="${path}"].dir`) as HTMLButtonElement | null;
    expect(dir).toBeTruthy();
    if (dir?.getAttribute("aria-expanded") === "true") return;
    act(() => {
      dir!.click();
    });
  }

  function revealTreePath(path: string) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i += 1) expandDir(parts.slice(0, i).join("/"));
    return host.querySelector(`[data-path="${path}"]`) as HTMLButtonElement;
  }

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  function openCodeMetaMore() {
    const more = host.querySelector(
      ".workspace-code-meta .workspace-editor-more",
    ) as HTMLDetailsElement;
    expect(more).toBeTruthy();
    const trigger = more.querySelector("summary") as HTMLElement;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    return more;
  }

  it("renders a filterable explorer tree with bind-mount footer", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    expect(host.querySelector(".workspace-tree-head")?.textContent).toMatch(/EXPLORER/);
    expect(host.querySelector(".workspace-filter")?.getAttribute("placeholder")).toBe(
      "Filter files...",
    );
    expect(host.querySelector(".workspace-filter-wrap .search-icon svg")).toBeTruthy();
    expect(host.querySelector(".workspace-tree-foot")?.textContent).toMatch(/This folder/);
    expect(host.querySelector(".workspace-tree-foot")?.textContent).not.toMatch(/rw/);
    expect(host.querySelector('[data-path="src"] .workspace-tree-chevron')).toBeTruthy();
    expect(host.querySelector('[data-path="src"] .workspace-tree-name')?.textContent).toBe("src");
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeNull();
    expect(revealTreePath("src/app.ts").querySelector(".workspace-tree-name")?.textContent).toBe(
      "app.ts",
    );
    expect(host.querySelector('[data-path="src/app.ts"] .add')?.textContent).toBe("+4");
    expect(host.querySelector('[data-path="src/app.ts"] .del')?.textContent).toBe("−1");
    expect(host.querySelector('[data-path="package.json"] .workspace-tree-name')?.textContent).toBe(
      "package.json",
    );
    expect(host.querySelector(".workspace-tree-foot .add")?.textContent).toBe("+4");
    const filter = host.querySelector(".workspace-filter") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(filter, "package");
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector('[data-path="package.json"]')).toBeTruthy();
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeNull();
  });

  it("windows a large explorer tree so the DOM stays near the viewport", async () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({
      name: `file${i}.ts`,
      path: `file${i}.ts`,
      type: "file" as const,
    }));
    vi.mocked(api.workspaceTree).mockResolvedValue({ entries, changes: [] });
    try {
      render(<WorkspaceEditor sessionId="s1" />);
      await flush();
      const mounted = host.querySelectorAll("[data-path]").length;
      expect(mounted).toBeGreaterThan(8);
      expect(mounted).toBeLessThan(120);
      expect(host.querySelector(".list-window-spacer")).toBeTruthy();
    } finally {
      vi.mocked(api.workspaceTree).mockReset();
    }
  });

  it("caps a broad explorer filter instead of expanding every matching file", async () => {
    const entries = Array.from({ length: 800 }, (_, i) => ({
      name: `file${i}.ts`,
      path: `src/file${i}.ts`,
      type: "file" as const,
    }));
    vi.mocked(api.workspaceTree).mockResolvedValue({ entries, changes: [] });
    try {
      render(<WorkspaceEditor sessionId="s1" />);
      await flush();
      const filter = host.querySelector(".workspace-filter") as HTMLInputElement;
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(filter, "file");
        filter.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await flush();
      expect(host.querySelectorAll(".workspace-tree-row").length).toBeLessThanOrEqual(410);
      expect(host.textContent).toMatch(/Showing first 400 matches/);
    } finally {
      vi.mocked(api.workspaceTree).mockReset();
    }
  });

  it("shows a loading state instead of empty while the tree is in flight", async () => {
    let resolveTree!: (value: { entries: []; changes: [] }) => void;
    vi.mocked(api.workspaceTree).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTree = resolve;
      }),
    );
    vi.mocked(api.workspaceTree).mockResolvedValueOnce({ entries: [], changes: [] });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    expect(host.querySelector(".workspace-tree-loading")?.textContent).toMatch(/Loading files/);
    expect(host.textContent).not.toMatch(/Empty workspace/);
    await act(async () => {
      resolveTree({ entries: [], changes: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/Empty workspace/);
    expect(host.querySelector(".workspace-tree-loading")).toBeNull();
  });

  it("shows index progress while the workspace index is still building", async () => {
    vi.mocked(api.workspaceIndexStatus).mockResolvedValue({
      status: "building",
      fileCount: 1240,
      scanned: 1240,
    });
    vi.mocked(api.workspaceIndex).mockImplementation(() => new Promise(() => undefined));
    try {
      render(<WorkspaceEditor sessionId="s1" />);
      await flush();
      await flush();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(host.querySelector(".workspace-tree-index")?.textContent).toMatch(
        /Indexing workspace/,
      );
      expect(host.querySelector(".workspace-tree-index")?.textContent).toMatch(/1,?240/);
      expect(host.querySelector(".workspace-status")?.textContent).toMatch(/Indexing/);
    } finally {
      vi.mocked(api.workspaceIndexStatus).mockResolvedValue({
        status: "ready",
        fileCount: 9,
        scanned: 9,
        builtAt: "2020-01-01T00:00:00.000Z",
      });
      vi.mocked(api.workspaceIndex).mockResolvedValue({
        status: "ready",
        fileCount: 9,
        scanned: 9,
        builtAt: "2020-01-01T00:00:00.000Z",
      });
    }
  });

  it("does not show 0 files while index progress is still starting", async () => {
    vi.mocked(api.workspaceIndexStatus).mockResolvedValue({
      status: "building",
      fileCount: 0,
      scanned: 0,
    });
    vi.mocked(api.workspaceIndex).mockImplementation(() => new Promise(() => undefined));
    try {
      render(<WorkspaceEditor sessionId="s1" />);
      await flush();
      await flush();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const banner = host.querySelector(".workspace-tree-index")?.textContent ?? "";
      expect(banner).toMatch(/Indexing workspace/);
      expect(banner).not.toMatch(/0 files/);
      expect(host.querySelector(".workspace-status")?.textContent).toMatch(/Indexing…/);
    } finally {
      vi.mocked(api.workspaceIndexStatus).mockResolvedValue({
        status: "ready",
        fileCount: 9,
        scanned: 9,
        builtAt: "2020-01-01T00:00:00.000Z",
      });
      vi.mocked(api.workspaceIndex).mockResolvedValue({
        status: "ready",
        fileCount: 9,
        scanned: 9,
        builtAt: "2020-01-01T00:00:00.000Z",
      });
    }
  });

  it("offers Search in files before a file is open", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const more = openCodeMetaMore();
    const search = [...more.querySelectorAll("[role='menuitem']")].find(
      (btn) => btn.textContent === "Search",
    ) as HTMLButtonElement | undefined;
    expect(search).toBeTruthy();
    act(() => {
      search!.click();
    });
    expect(host.querySelector('[role="dialog"][aria-label="Search in files"]')).toBeTruthy();
  });

  it("labels a worker session Files pane as a worker folder", async () => {
    render(<WorkspaceEditor sessionId="s1" remote />);
    await flush();
    expect(host.querySelector(".workspace-tree-foot")?.textContent).toMatch(/Worker folder/);
    expect(host.querySelector(".workspace-tree-foot")?.textContent).not.toMatch(/This folder/);
  });

  it("keeps nested explorer files hidden until a folder is expanded", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    expect(host.querySelector('[data-path="package.json"]')).toBeTruthy();
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeNull();
    expect(host.querySelector('[data-path="src/App.tsx"]')).toBeNull();
    expect(host.querySelector('[data-path="templates/home.html"]')).toBeNull();
    expandDir("src");
    expect(host.querySelector('[data-path="src/app.ts"] .workspace-tree-name')?.textContent).toBe(
      "app.ts",
    );
    expect(host.querySelector('[data-path="src/App.tsx"]')).toBeTruthy();
    expect(host.querySelector('[data-path="templates/home.html"]')).toBeNull();
  });

  it("loads hidden folder contents when the explorer expands them", async () => {
    vi.mocked(api.workspaceTree).mockImplementation(async (_id: string, path = "") => {
      if (path === ".cursor") {
        return {
          entries: [
            { name: "mcp.json", path: ".cursor/mcp.json", type: "file" as const },
            { name: "rules", path: ".cursor/rules", type: "dir" as const },
            { name: "locus.mdc", path: ".cursor/rules/locus.mdc", type: "file" as const },
          ],
        };
      }
      return {
        entries: [
          { name: ".cursor", path: ".cursor", type: "dir" as const },
          { name: "src", path: "src", type: "dir" as const },
          { name: "app.ts", path: "src/app.ts", type: "file" as const },
        ],
        changes: [],
      };
    });
    try {
      render(<WorkspaceEditor sessionId="s1" />);
      await flush();
      expect(host.querySelector('[data-path=".cursor"]')).toBeTruthy();
      expect(host.querySelector('[data-path=".cursor/mcp.json"]')).toBeNull();
      expandDir(".cursor");
      await flush();
      await flush();
      expect(api.workspaceTree).toHaveBeenCalledWith("s1", ".cursor");
      expect(
        host.querySelector('[data-path=".cursor/mcp.json"] .workspace-tree-name')?.textContent,
      ).toBe("mcp.json");
      expect(host.querySelector('[data-path=".cursor/rules"]')).toBeTruthy();
      expandDir(".cursor/rules");
      expect(
        host.querySelector('[data-path=".cursor/rules/locus.mdc"] .workspace-tree-name')
          ?.textContent,
      ).toBe("locus.mdc");
      const srcCalls = vi.mocked(api.workspaceTree).mock.calls.filter((call) => call[1] === "src");
      expect(srcCalls).toEqual([]);
    } finally {
      vi.mocked(api.workspaceTree).mockReset();
    }
  });

  it("restores an expanded hidden folder on remount", async () => {
    saveExplorerExpanded("s1", [".cursor"]);
    vi.mocked(api.workspaceTree).mockImplementation(async (_id: string, path = "") => {
      if (path === ".cursor") {
        return {
          entries: [{ name: "mcp.json", path: ".cursor/mcp.json", type: "file" as const }],
        };
      }
      return {
        entries: [{ name: ".cursor", path: ".cursor", type: "dir" as const }],
        changes: [],
      };
    });
    try {
      render(<WorkspaceEditor sessionId="s1" />);
      await flush();
      await flush();
      expect(host.querySelector('[data-path=".cursor"]')?.getAttribute("aria-expanded")).toBe(
        "true",
      );
      expect(
        host.querySelector('[data-path=".cursor/mcp.json"] .workspace-tree-name')?.textContent,
      ).toBe("mcp.json");
    } finally {
      vi.mocked(api.workspaceTree).mockReset();
    }
  });

  it("restores explorer expand state after unmount", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    expandDir("src");
    expect(host.querySelector('[data-path="src"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeTruthy();
    act(() => root.unmount());
    host.remove();
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    expect(host.querySelector('[data-path="src"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[data-path="src/app.ts"] .workspace-tree-name')?.textContent).toBe(
      "app.ts",
    );
    expect(host.querySelector('[data-path="templates/home.html"]')).toBeNull();
  });

  it("keeps explorer expand state per agent when switching sessions", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    expandDir("src");
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeTruthy();
    await act(async () => {
      root.render(<WorkspaceEditor sessionId="s2" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-path="src"]')?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeNull();
    await act(async () => {
      root.render(<WorkspaceEditor sessionId="s1" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-path="src"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeTruthy();
  });

  it("restores open files after unmount", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const app = revealTreePath("src/app.ts");
    await act(async () => {
      app.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const json = host.querySelector('[data-path="package.json"]') as HTMLButtonElement;
    await act(async () => {
      json.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      [...host.querySelectorAll(".workspace-tab")].map((tab) => tab.getAttribute("title")),
    ).toEqual(["src/app.ts", "package.json"]);
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("package.json");
    act(() => root.unmount());
    host.remove();
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    expect(
      [...host.querySelectorAll(".workspace-tab")].map((tab) => tab.getAttribute("title")),
    ).toEqual(["src/app.ts", "package.json"]);
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("package.json");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain(
      '"name": "desktop"',
    );
  });

  it("keeps open files per agent when switching sessions", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const app = revealTreePath("src/app.ts");
    await act(async () => {
      app.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-tab")?.getAttribute("title")).toBe("src/app.ts");
    await act(async () => {
      root.render(<WorkspaceEditor sessionId="s2" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(host.querySelector(".workspace-tab")).toBeNull();
    await act(async () => {
      root.render(<WorkspaceEditor sessionId="s1" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    await flush();
    expect(host.querySelector(".workspace-tab")?.getAttribute("title")).toBe("src/app.ts");
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("src/app.ts");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const x");
  });

  it("drops restored tabs that no longer exist without showing an error", async () => {
    saveEditorOpenFiles("s1", ["gone.ts", "src/app.ts"], "gone.ts");
    vi.mocked(api.workspaceFile).mockImplementationOnce(async () => {
      throw new Error("ENOENT");
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    expect(
      [...host.querySelectorAll(".workspace-tab")].map((tab) => tab.getAttribute("title")),
    ).toEqual(["src/app.ts"]);
    expect(host.querySelector(".workspace-code-error")).toBeNull();
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("src/app.ts");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const x");
  });

  it("highlights an opened workspace file with editor chrome", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    expect(file).toBeTruthy();
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-highlight .tok-kw")?.textContent).toBe("const");
    expect(host.querySelector(".workspace-highlight .tok-str")?.textContent).toBe('"hi"');
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const x");
    expect(host.querySelector(".workspace-tab.on")?.textContent).toMatch(/app\.ts/);
    expect(host.querySelector(".workspace-code-meta")?.textContent).toMatch(/TypeScript/);
    expect(host.querySelector(".workspace-code-meta")?.textContent).not.toMatch(/UTF-8/);
    expect(host.querySelector(".workspace-save")?.textContent).toBe("Saved");
    expect(host.querySelector(".workspace-gutter")?.textContent).toMatch(/^1/);
  });

  it("shows the tab and tree selection before the file body returns", async () => {
    let release!: (value: { path: string; content: string; mtime: string }) => void;
    vi.mocked(api.workspaceFile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    act(() => {
      file.click();
    });
    await flush();
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("src/app.ts");
    expect(host.querySelector(".workspace-tree-row.on [data-path='src/app.ts']")).toBeTruthy();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
    await act(async () => {
      release({ path: "src/app.ts", content: 'const x = "hi";\n', mtime: "t" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const x");
    expect(host.querySelector(".workspace-highlight .tok-kw")?.textContent).toBe("const");
  });

  it("reopens a cached file without another workspace fetch", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const app = revealTreePath("src/app.ts");
    await act(async () => {
      app.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const close = host.querySelector(".workspace-tab-close") as HTMLButtonElement;
    act(() => {
      close.click();
    });
    expect(host.querySelector(".workspace-tab")).toBeNull();
    vi.mocked(api.workspaceFile).mockClear();
    await act(async () => {
      app.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).not.toHaveBeenCalled();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const x");
  });

  it("prefetches a file on pointer enter so click can paint from cache", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    act(() => {
      file.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }),
      );
    });
    await flush();
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "src/app.ts");
    vi.mocked(api.workspaceFile).mockClear();
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).not.toHaveBeenCalled();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const x");
  });

  it("paints the tab far sooner than waiting for a slow file fetch", async () => {
    const DELAY_MS = 80;
    vi.mocked(api.workspaceFile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ path: "src/app.ts", content: 'const x = "hi";\n', mtime: "t" }),
            DELAY_MS,
          );
        }),
    );
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    const clickAt = performance.now();
    act(() => {
      file.click();
    });
    await flush();
    const tabMs = performance.now() - clickAt;
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("src/app.ts");
    expect(tabMs).toBeLessThan(DELAY_MS / 2);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS + 20));
    });
    const contentMs = performance.now() - clickAt;
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const x");
    try {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(
        "/opt/cursor/artifacts/file_open_click_latency.json",
        `${JSON.stringify(
          {
            delayMs: DELAY_MS,
            before: {
              tabMs: DELAY_MS,
              contentMs: DELAY_MS,
              notes: "Tab, tree selection, and editor waited on GET /workspace/file",
            },
            after: {
              tabMs: Number(tabMs.toFixed(2)),
              contentMs: Number(contentMs.toFixed(2)),
              notes: "Tab and tree selection paint before the fetch; body lands when it returns",
            },
          },
          null,
          2,
        )}\n`,
      );
    } catch {
      /* artifacts dir is optional outside the cloud agent */
    }
  });

  it("fills a background tab when a second file is clicked before the first fetch returns", async () => {
    let releaseApp!: (value: { path: string; content: string; mtime: string }) => void;
    const original = vi.mocked(api.workspaceFile).getMockImplementation();
    vi.mocked(api.workspaceFile).mockImplementation((id: string, path: string) => {
      if (path === "src/app.ts") {
        return new Promise((resolve) => {
          releaseApp = resolve;
        });
      }
      return original ? original(id, path) : Promise.resolve({ path, content: "", mtime: "t" });
    });
    try {
      render(<WorkspaceEditor sessionId="s1" />);
      await flush();
      const app = revealTreePath("src/app.ts");
      act(() => {
        app.click();
      });
      await flush();
      const json = host.querySelector('[data-path="package.json"]') as HTMLButtonElement;
      await act(async () => {
        json.click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("package.json");
      expect(
        [...host.querySelectorAll(".workspace-tab")].map((tab) => tab.getAttribute("title")),
      ).toEqual(["src/app.ts", "package.json"]);
      await act(async () => {
        releaseApp({ path: "src/app.ts", content: 'const x = "hi";\n', mtime: "t" });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("package.json");
      const appTab = [...host.querySelectorAll(".workspace-tab")].find(
        (tab) => tab.getAttribute("title") === "src/app.ts",
      ) as HTMLElement;
      act(() => {
        appTab.click();
      });
      await flush();
      expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const x");
    } finally {
      if (original) vi.mocked(api.workspaceFile).mockImplementation(original);
    }
  });

  it("folds tab-bar actions into a More menu", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const meta = host.querySelector(".workspace-code-meta") as HTMLElement;
    expect(meta.querySelector(":scope > .workspace-save")?.textContent).toBe("Saved");
    expect(
      [...meta.querySelectorAll(":scope > button")].map((btn) => btn.textContent?.trim()),
    ).not.toEqual(expect.arrayContaining(["Save all", "Wrap", "Minimap", "Find", "Search"]));
    const more = openCodeMetaMore();
    expect(more.querySelector("summary")?.getAttribute("aria-label")).toBe("More");
    const labels = [...more.querySelectorAll("[role='menuitem']")].map((row) =>
      (row.textContent ?? "").trim(),
    );
    expect(labels).toEqual(
      expect.arrayContaining([
        "Save all",
        "Wrap",
        "Minimap",
        "Close others",
        "Close saved",
        "Find",
        "Split",
        "Search",
      ]),
    );
  });

  it("follows an openPath request and offers Ask agent", async () => {
    const onOpened = vi.fn();
    const onAskAgent = vi.fn();
    render(
      <WorkspaceEditor
        sessionId="s1"
        openPath="src/app.ts"
        openLine={1}
        openAt={1}
        follow
        onOpened={onOpened}
        onAskAgent={onAskAgent}
      />,
    );
    await flush();
    await flush();
    expect(host.querySelector(".workspace-tab.on")?.textContent).toMatch(/app\.ts/);
    expect(host.querySelector('[data-mode="updated"]')?.classList.contains("on")).toBe(true);
    expect(onOpened).toHaveBeenCalled();
    const more = openCodeMetaMore();
    const ask = [...more.querySelectorAll("[role='menuitem']")].find((btn) =>
      btn.textContent?.includes("Ask about file"),
    ) as HTMLButtonElement | undefined;
    expect(ask).toBeTruthy();
    act(() => {
      ask!.click();
    });
    expect(onAskAgent).toHaveBeenCalled();
    expect(String(onAskAgent.mock.calls[0]?.[0])).toMatch(/On src\/app\.ts/);
    expect(String(onAskAgent.mock.calls[0]?.[0])).toContain("untrusted-data");
  });

  it("follows a host-absolute chat tool path without File not found", async () => {
    const onOpened = vi.fn();
    render(
      <WorkspaceEditor
        sessionId="s1"
        openPath="/home/me/.locus/host-workspaces/ee26bc7e/src/app.ts"
        openLine={1}
        openAt={1}
        follow
        onOpened={onOpened}
      />,
    );
    await flush();
    await flush();
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "src/app.ts");
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("src/app.ts");
    expect(host.querySelector(".workspace-code-error")).toBeNull();
    expect(onOpened).toHaveBeenCalled();
  });

  it("opens json tabs with a language glyph", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = host.querySelector('[data-path="package.json"]') as HTMLButtonElement;
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "package.json");
    expect(host.querySelector(".workspace-tab-kind")?.textContent).toBe("{}");
    expect(host.querySelector(".workspace-code-meta")?.textContent).toMatch(/JSON/);
  });

  it("closes an open tab with a real close button", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-tab")?.textContent).toMatch(/app\.ts/);
    expect(host.querySelector(".workspace-tab")?.getAttribute("title")).toBe("src/app.ts");
    const close = host.querySelector(".workspace-tab-close") as HTMLButtonElement;
    expect(close.tagName).toBe("BUTTON");
    act(() => {
      close.click();
    });
    expect(host.querySelector(".workspace-tab")).toBeNull();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("closes the active tab with Ctrl+W and a middle click", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(host.querySelector(".workspace-tab")).toBeNull();
    const json = host.querySelector('[data-path="package.json"]') as HTMLButtonElement;
    await act(async () => {
      json.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const tab = host.querySelector(".workspace-tab") as HTMLElement;
    act(() => {
      tab.dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true }));
    });
    expect(host.querySelector(".workspace-tab")).toBeNull();
  });

  it("splits the editor beside and opens a second file in the focused group", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const app = revealTreePath("src/app.ts");
    await act(async () => {
      app.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const splitBtn = host.querySelector('[data-testid="editor-split-toggle"]') as HTMLButtonElement;
    expect(splitBtn.textContent).toBe("Split");
    act(() => {
      splitBtn.click();
    });
    expect(host.querySelector(".workspace-code")?.classList.contains("is-split")).toBe(true);
    expect(host.querySelector("[data-editor-pane='0']")).toBeTruthy();
    expect(host.querySelector("[data-editor-pane='1']")).toBeTruthy();
    expect(host.querySelector("[data-testid='editor-companion']")).toBeTruthy();
    expect(splitBtn.textContent).toBe("Join");
    const json = host.querySelector('[data-path="package.json"]') as HTMLButtonElement;
    await act(async () => {
      json.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      [...host.querySelectorAll("[data-editor-pane='0'] .workspace-tab")].map((tab) =>
        tab.getAttribute("title"),
      ),
    ).toEqual(["src/app.ts"]);
    expect(
      [...host.querySelectorAll("[data-editor-pane='1'] .workspace-tab")].map((tab) =>
        tab.getAttribute("title"),
      ),
    ).toEqual(["src/app.ts", "package.json"]);
    expect(
      host.querySelector("[data-editor-pane='1'] .workspace-tab.on")?.getAttribute("title"),
    ).toBe("package.json");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain(
      '"name": "desktop"',
    );
    expect(host.querySelector("[data-testid='editor-companion']")?.textContent).toContain("const");
    act(() => {
      splitBtn.click();
    });
    expect(host.querySelector(".workspace-code")?.classList.contains("is-split")).toBe(false);
    expect(host.querySelector("[data-testid='editor-companion']")).toBeNull();
    expect(
      [...host.querySelectorAll(".workspace-tab")].map((tab) => tab.getAttribute("title")),
    ).toEqual(["src/app.ts", "package.json"]);
  });

  it("splits with Ctrl+\\ and Open to the side", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const app = revealTreePath("src/app.ts");
    await act(async () => {
      app.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "\\", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(host.querySelector(".workspace-code")?.classList.contains("is-split")).toBe(true);
    const json = host.querySelector('[data-path="package.json"]') as HTMLButtonElement;
    act(() => {
      json.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }),
      );
    });
    const openSide = [...document.querySelectorAll(".workspace-ctx button")].find((btn) =>
      btn.textContent?.includes("Open to the side"),
    ) as HTMLButtonElement;
    expect(openSide).toBeTruthy();
    await act(async () => {
      openSide.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      host.querySelector("[data-editor-pane='0'] .workspace-tab.on")?.getAttribute("title"),
    ).toBe("package.json");
  });

  it("keeps Split visible on image and PDF previews", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const png = host.querySelector('[data-path="shot.png"]') as HTMLButtonElement;
    await act(async () => {
      png.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const splitBtn = host.querySelector('[data-testid="editor-split-toggle"]') as HTMLButtonElement;
    expect(splitBtn).toBeTruthy();
    expect(splitBtn.textContent).toBe("Split");
    act(() => {
      splitBtn.click();
    });
    expect(host.querySelector(".workspace-code")?.classList.contains("is-split")).toBe(true);
    expect(splitBtn.textContent).toBe("Join");
    const pdf = host.querySelector('[data-path="brief.pdf"]') as HTMLButtonElement;
    await act(async () => {
      pdf.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="editor-split-toggle"]')?.textContent).toBe("Join");
    expect(host.querySelector(".workspace-code")?.classList.contains("is-split")).toBe(true);
  });

  it("resizes split groups by dragging the gutter", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const app = revealTreePath("src/app.ts");
    await act(async () => {
      app.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      (host.querySelector('[data-testid="editor-split-toggle"]') as HTMLButtonElement).click();
    });
    const code = host.querySelector(".workspace-code") as HTMLElement;
    stubRect(code, { left: 0, top: 0, width: 800, height: 400 });
    const gutter = host.querySelector(".workspace-split-gutter") as HTMLElement;
    act(() => {
      gutter.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 400, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 520, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 520, pointerId: 1 }),
      );
    });
    expect(code.style.gridTemplateColumns).toBe(editorSplitColumns(0.65));
  });

  it("does not collapse folders while a filter is active", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const filter = host.querySelector(".workspace-filter") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(filter, "app");
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const dir = [...host.querySelectorAll(".workspace-tree-row.dir")].find((btn) =>
      btn.textContent?.includes("src"),
    ) as HTMLButtonElement | undefined;
    expect(dir).toBeTruthy();
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeTruthy();
    act(() => {
      dir!.click();
    });
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeTruthy();
  });

  it("toggles the explorer to only updated files", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    expect(host.querySelector('[data-path="package.json"]')).toBeTruthy();
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeNull();
    expect(host.querySelector('[data-mode="updated"]')?.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      (host.querySelector('[data-mode="updated"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector('[data-mode="updated"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeTruthy();
    expect(host.querySelector('[data-path="package.json"]')).toBeNull();
  });

  it("highlights added and removed lines in a changed file", async () => {
    vi.mocked(api.workspaceFile).mockResolvedValueOnce({
      path: "src/app.ts",
      content: 'const x = "hi";\nconst y = 2;\n',
      mtime: "t",
      baseline: 'const x = "hi";\nconst z = 1;\n',
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const y");
    expect(host.querySelector(".workspace-diff-row")).toBeNull();
    const toggle = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Diff");
    expect(toggle).toBeTruthy();
    act(() => {
      toggle!.click();
    });
    expect(host.querySelector(".workspace-diff-row.del")?.textContent).toContain("const z");
    expect(host.querySelector(".workspace-diff-row.add")?.textContent).toContain("const y");
    expect(host.querySelector(".workspace-diff-row.eq")?.textContent).toContain("const x");
    expect(host.querySelector("textarea")).toBeNull();
    const edit = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Edit");
    expect(edit).toBeTruthy();
    act(() => {
      edit!.click();
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const y");
    expect(host.querySelector(".workspace-highlight .workspace-line.add")).toBeNull();
    const mark = host.querySelector("[data-gutter-mark]") as HTMLElement;
    expect(mark.getAttribute("data-gutter-mark")).toBe("mod");
    expect(mark.classList.contains("mod")).toBe(true);
  });

  it("paints git additions as a green bar on the line-number gutter", async () => {
    vi.mocked(api.workspaceFile).mockResolvedValueOnce({
      path: "src/app.ts",
      content: 'const x = "hi";\nconst y = 2;\n',
      mtime: "t",
      baseline: 'const x = "hi";\n',
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const mark = host.querySelector('[data-gutter-mark="add"]') as HTMLElement;
    expect(mark).toBeTruthy();
    expect(mark.classList.contains("add")).toBe(true);
    expect(mark.style.height).toBe("18px");
    expect(host.querySelector(".workspace-gutter-col")).toBeTruthy();
    expect(host.querySelector(".workspace-highlight .workspace-line.add")).toBeNull();
  });

  it("keeps the highlight overlay scrolled with the textarea after typing", async () => {
    const lines = Array.from({ length: 80 }, (_, i) => `const n${i} = ${i};`);
    vi.mocked(api.workspaceFile).mockResolvedValueOnce({
      path: "src/app.ts",
      content: `${lines.join("\n")}\n`,
      mtime: "t",
      baseline: "const n0 = 0;\n",
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    const body = host.querySelector(".workspace-code-body") as HTMLElement;
    expect(ta.getAttribute("wrap")).toBe("off");
    body.scrollTop = 240;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(ta, `${ta.value}x`);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(body.scrollTop).toBe(240);
  });

  it("keeps the highlight overlay short while typing in a large TypeScript file", async () => {
    const lines = Array.from(
      { length: 1_600 },
      (_, i) => `export function widget${i}(n: number) { return n + ${i}; }`,
    );
    const source = `${lines.join("\n")}\n`;
    vi.mocked(api.workspaceFile).mockResolvedValueOnce({
      path: "src/app.ts",
      content: source,
      mtime: "t",
      baseline: source,
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const overlay = host.querySelector(".workspace-highlight") as HTMLElement;
    expect(overlay.innerHTML.split("\n").length).toBeLessThan(120);
    expect(host.querySelector(".workspace-gutter")?.textContent?.split("\n").length).toBeLessThan(
      120,
    );
    const sizer = host.querySelector("[data-editor-sizer]") as HTMLElement;
    expect(Number.parseInt(sizer.style.height, 10)).toBeGreaterThan(1_600 * 18);
    expect(host.querySelector(".workspace-editor-window")).toBeTruthy();
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(ta, source.replace("return n + 0", "return n + 99"));
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(overlay.innerHTML.split("\n").length).toBeLessThan(120);
    expect(host.querySelector(".workspace-gutter")?.textContent?.split("\n").length).toBeLessThan(
      120,
    );
    expect(ta.value).toContain("return n + 99");
    expect(host.querySelector("[data-gutter-mark]")).toBeTruthy();
    expect(host.querySelector(".workspace-save")?.textContent).toBe("Save");
  });

  it("keeps the overlay short after scrolling a large file", async () => {
    const lines = Array.from(
      { length: 2_400 },
      (_, i) => `export function widget${i}(n: number) { return n + ${i}; }`,
    );
    const source = `${lines.join("\n")}\n`;
    vi.mocked(api.workspaceFile).mockResolvedValueOnce({
      path: "src/app.ts",
      content: source,
      mtime: "t",
      baseline: source,
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const overlay = host.querySelector(".workspace-highlight") as HTMLElement;
    const body = host.querySelector(".workspace-code-body") as HTMLElement;
    Object.defineProperty(body, "clientHeight", { configurable: true, value: 360 });
    await act(async () => {
      body.scrollTop = 1_200;
      body.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await Promise.resolve();
    });
    expect(overlay.innerHTML.split("\n").length).toBeLessThan(120);
    const gutter = host.querySelector(".workspace-gutter")?.textContent ?? "";
    expect(gutter.split("\n").length).toBeLessThan(120);
    expect(gutter).toMatch(/67/);
    expect(gutter).not.toMatch(/^1\n2\n3/);
    expect(body.scrollTop).toBe(1_200);
    expect(host.querySelector("[data-editor-sizer]")?.getAttribute("style")).toMatch(/height:/);
  });

  it("keeps overlay aligned when a long line scrolls horizontally", async () => {
    const long = `const msg = "${"x".repeat(400)}";\n`;
    vi.mocked(api.workspaceFile).mockResolvedValueOnce({
      path: "src/app.ts",
      content: long,
      mtime: "t",
      baseline: long,
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    const overlay = host.querySelector(".workspace-highlight") as HTMLElement;
    await act(async () => {
      ta.scrollLeft = 240;
      ta.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(ta.scrollLeft).toBe(240);
    expect(overlay.style.transform).toMatch(/translate\(-240px/);
  });

  it("jumps the painted window when going to a distant line", async () => {
    const lines = Array.from(
      { length: 2_400 },
      (_, i) => `export function widget${i}(n: number) { return n + ${i}; }`,
    );
    const source = `${lines.join("\n")}\n`;
    vi.mocked(api.workspaceFile).mockResolvedValueOnce({
      path: "src/app.ts",
      content: source,
      mtime: "t",
      baseline: source,
    });
    vi.mocked(api.workspaceOutline).mockResolvedValue({
      items: [{ name: "widget1999", line: 2000 }],
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    const item = [...host.querySelectorAll(".workspace-outline-item")].find((btn) =>
      btn.textContent?.includes("widget1999"),
    ) as HTMLButtonElement;
    expect(item).toBeTruthy();
    await act(async () => {
      item.click();
      await Promise.resolve();
    });
    const gutter = host.querySelector(".workspace-gutter")?.textContent ?? "";
    expect(gutter).toMatch(/2000/);
    expect(gutter).not.toMatch(/^1\n2\n3/);
  });

  it("types into this repo's WorkspaceEditor source without expanding the overlay", async () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "WorkspaceEditor.tsx"),
      "utf8",
    );
    expect(source.split("\n").length).toBeGreaterThan(800);
    vi.mocked(api.workspaceFile).mockResolvedValueOnce({
      path: "src/app.ts",
      content: source,
      mtime: "t",
      baseline: source,
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const overlay = host.querySelector(".workspace-highlight") as HTMLElement;
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(overlay.innerHTML.split("\n").length).toBeLessThan(120);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    const started = performance.now();
    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        setter?.call(ta, `x${ta.value}`);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    expect(performance.now() - started).toBeLessThan(500);
    expect(overlay.innerHTML.split("\n").length).toBeLessThan(120);
    expect(host.querySelector(".workspace-gutter")?.textContent?.split("\n").length).toBeLessThan(
      120,
    );
    expect(ta.value.startsWith("x".repeat(8))).toBe(true);
    expect(host.querySelector('[data-gutter-mark="add"], [data-gutter-mark="mod"]')).toBeTruthy();
  });

  it("styles git change bars on the line-number gutter", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.workspace-gutter-mark\.add,\n\.workspace-gutter-mark\.mod \{/);
    expect(css).toMatch(/\.workspace-gutter-mark\.add[\s\S]*?background:\s*var\(--ok\)/);
    expect(css).toMatch(/\.workspace-gutter-col \{[\s\S]*?position:\s*sticky/);
    expect(css).toMatch(/\.workspace-gutter-col\.has-blame \{[\s\S]*?flex-basis:\s*88px/);
    expect(css).toMatch(/\.workspace-editor-window \{[\s\S]*?position:\s*sticky/);
    expect(css).toMatch(/\.workspace-gutter-wrap span \{/);
    expect(css).toMatch(/\.workspace-occur \{/);
    expect(css).toMatch(/\.workspace-occur\.inline-ai \{/);
    expect(css).toMatch(
      /\.workspace-code \.workspace-inline-ai textarea\.workspace-inline-ai-prompt \{[\s\S]*?position:\s*relative/,
    );
    expect(css).toMatch(/\.workspace-gutter-comment \{/);
    expect(css).toMatch(/\.workspace-editor-window\.wrap textarea \{/);
  });

  it("does not set -webkit-text-fill-color on the overlay editor textarea", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    const block = css.match(
      /\.workspace-code textarea \{\s*position:\s*absolute;[\s\S]*?appearance:\s*none;\s*\}/,
    )?.[0];
    expect(block).toBeTruthy();
    expect(block).toMatch(/color:\s*transparent/);
    expect(block).not.toMatch(/-webkit-text-fill-color/);
  });

  it("stacks explorer git commit actions so they fit the tree", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.workspace-git-commit \{[\s\S]*?flex-direction:\s*column/);
    expect(css).toMatch(/\.workspace-git-message \{[\s\S]*?width:\s*100%/);
    expect(css).toMatch(/\.workspace-git-actions \{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/\.workspace-git-actions \.btn \{[\s\S]*?flex:\s*1/);
    expect(css).toMatch(/\.workspace-git-branch-row \.workspace-git-branch \{[\s\S]*?padding:\s*0/);
    expect(css).toMatch(/\.workspace-git-select\.workspace-git-dest \{[\s\S]*?max-width:\s*180px/);
  });

  it("keeps the editor status bar on one line and hides secondary items in a narrow pane", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.workspace-live,\n\.workspace-companion-slot \{[\s\S]*?flex:\s*1/);
    expect(css).toMatch(/\.workspace-status \{[\s\S]*?margin-top:\s*auto/);
    expect(css).toMatch(/\.workspace-status \{[\s\S]*?container-type:\s*inline-size/);
    expect(css).toMatch(/\.workspace-status \{[\s\S]*?height:\s*24px/);
    expect(css).toMatch(/\.workspace-status-start,\n\.workspace-status-end \{/);
    expect(css).toMatch(
      /@container workspace-status \(max-width: 900px\) \{[\s\S]*?\.workspace-status-indent/,
    );
    expect(css).toMatch(
      /@container workspace-status \(max-width: 760px\) \{[\s\S]*?\.workspace-status-run/,
    );
    expect(css).toMatch(
      /@container workspace-status \(max-width: 560px\) \{[\s\S]*?\.workspace-status-cursor/,
    );
    expect(css).toMatch(/\.workspace-status-more \{[\s\S]*?flex:\s*0 0 auto/);
    expect(css).toMatch(/\.workspace-editor-more \{[\s\S]*?flex:\s*0 0 auto/);
  });

  it("keeps the status bar after the empty editor pane, not in the tab header", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const code = host.querySelector(".workspace-code") as HTMLElement;
    const live = code.querySelector(":scope > .workspace-live") as HTMLElement;
    const status = code.querySelector(":scope > .workspace-status") as HTMLElement;
    expect(live).toBeTruthy();
    expect(status).toBeTruthy();
    expect(status.previousElementSibling).toBe(live);
    expect(host.querySelector(".workspace-code-head")?.contains(status)).toBe(false);
    expect(status.querySelector(".workspace-status-path")?.textContent).toBe("Open a file to edit");
    expect(host.querySelector(".workspace-code-meta .meta")?.textContent).toBe("Open a file");
  });

  it("renders git files with a full-width commit form and both actions", async () => {
    vi.mocked(api.workspaceGit).mockResolvedValue({
      branch: "main",
      ahead: 1,
      behind: 0,
      files: [
        { path: "apps/cli/bin/locus.mjs", index: " ", worktree: "M", staged: false },
        { path: "package-lock.json", index: " ", worktree: "M", staged: true },
      ],
    });
    try {
      render(<WorkspaceEditor sessionId="s1" />);
      await flush();
      act(() => {
        (host.querySelector('[data-mode="git"]') as HTMLButtonElement).click();
      });
      await flush();
      expect(host.querySelector('[data-mode="git"]')?.textContent).toMatch(/Git 2/);
      expect(host.querySelector('[aria-label="Git branch"]')).toBeTruthy();
      expect(host.querySelector(".workspace-git-branch")?.textContent).toMatch(/↑1/);
      const branchRow = host.querySelector(".workspace-git-branch-row");
      expect(branchRow?.querySelector('[aria-label="Git branch"]')).toBeTruthy();
      expect(branchRow?.querySelector(".workspace-git-branch")?.textContent).toMatch(/↑1/);
      expect(
        [...(branchRow?.querySelectorAll("button") ?? [])].some(
          (btn) => btn.textContent === "Pull",
        ),
      ).toBe(true);
      expect(host.querySelector('[data-path="apps/cli/bin/locus.mjs"]')).toBeTruthy();
      const commit = host.querySelector(".workspace-git-commit");
      expect(commit?.querySelector(".workspace-git-message")?.getAttribute("placeholder")).toBe(
        "Commit message",
      );
      expect(commit?.querySelector(".workspace-find-replace")).toBeNull();
      expect(commit?.querySelector(".workspace-git-actions")?.textContent).toMatch(/Commit/);
      expect(commit?.querySelector(".workspace-git-actions")?.textContent).toMatch(/Push/);
    } finally {
      vi.mocked(api.workspaceGit).mockResolvedValue({
        branch: "main",
        ahead: 0,
        behind: 0,
        files: [],
      });
    }
  });

  it("does not treat CRLF vs LF as a git rewrite", async () => {
    vi.mocked(api.workspaceFile).mockResolvedValueOnce({
      path: "src/app.ts",
      content: 'const x = "hi";\n',
      mtime: "t",
      baseline: 'const x = "hi";\r\n',
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-diff-row")).toBeNull();
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Diff")).toBe(
      false,
    );
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const x");
  });

  it("previews a screenshot in the editor pane", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = host.querySelector('[data-path="shot.png"]') as HTMLButtonElement;
    expect(file).toBeTruthy();
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).not.toHaveBeenCalledWith("s1", "shot.png");
    const img = host.querySelector(".workspace-image img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/api/sessions/s1/workspace/raw?path=shot.png");
    expect(host.querySelector(".workspace-code-meta")?.textContent).toMatch(/PNG/);
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("toggles an HTML file between source and the in-pane browser", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = host.querySelector('[data-path="page.html"]') as HTMLButtonElement;
    expect(file).toBeTruthy();
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "page.html");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain(
      "<h1>Hello</h1>",
    );
    expect(host.querySelector("[data-html-view]")?.textContent).toBe("Browser");
    expect(host.querySelector("[data-html-view]")?.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      (host.querySelector("[data-html-view]") as HTMLButtonElement).click();
    });
    const frame = host.querySelector(".workspace-browser") as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-scripts allow-forms allow-modals allow-pointer-lock",
    );
    expect(frame.getAttribute("src")).toBe("/api/canvas-frame");
    expect(frame.getAttribute("data-srcdoc")).toContain("<h1>Hello</h1>");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector("[data-html-view]")?.textContent).toBe("Source");
    expect(host.querySelector("[data-html-view]")?.getAttribute("aria-pressed")).toBe("true");
    act(() => {
      (host.querySelector("[data-html-view]") as HTMLButtonElement).click();
    });
    expect(host.querySelector(".workspace-browser")).toBeNull();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain(
      "<h1>Hello</h1>",
    );
    expect(host.querySelector("[data-html-view]")?.textContent).toBe("Browser");
  });

  it("opens markdown files in a rendered preview", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = host.querySelector('[data-path="README.md"]') as HTMLButtonElement;
    expect(file).toBeTruthy();
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "README.md");
    const preview = host.querySelector(".workspace-markdown") as HTMLElement;
    expect(preview).toBeTruthy();
    expect(preview.classList.contains("pr-md")).toBe(true);
    expect(preview.querySelector("h1")?.textContent).toBe("Hello");
    expect(preview.querySelector("strong")?.textContent).toBe("docs");
    expect(preview.querySelector(".md-code")?.textContent).toContain("const x = 1");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector("[data-html-view]")?.textContent).toBe("Source");
    expect(host.querySelector("[data-html-view]")?.getAttribute("aria-pressed")).toBe("true");
    act(() => {
      (host.querySelector("[data-html-view]") as HTMLButtonElement).click();
    });
    expect(host.querySelector(".workspace-markdown")).toBeNull();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("# Hello");
    expect(host.querySelector("[data-html-view]")?.textContent).toBe("Preview");
    expect(host.querySelector("[data-html-view]")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens a markdown hit at a line in source instead of preview", async () => {
    render(<WorkspaceEditor sessionId="s1" openPath="README.md" openLine={3} openAt={1} />);
    await flush();
    await flush();
    expect(host.querySelector(".workspace-markdown")).toBeNull();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("See **docs**");
    expect(host.querySelector("[data-html-view]")?.textContent).toBe("Preview");
    expect(host.querySelector("[data-html-view]")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches an open markdown preview to source when jumping to a line", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = host.querySelector('[data-path="README.md"]') as HTMLButtonElement;
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-markdown")).toBeTruthy();
    act(() => {
      root.render(<WorkspaceEditor sessionId="s1" openPath="README.md" openLine={3} openAt={2} />);
    });
    await flush();
    await flush();
    expect(host.querySelector(".workspace-markdown")).toBeNull();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("# Hello");
    expect(host.querySelector("[data-html-view]")?.textContent).toBe("Preview");
    expect(host.querySelector("[data-html-view]")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens svg files in a rendered preview", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = host.querySelector('[data-path="logo.svg"]') as HTMLButtonElement;
    expect(file).toBeTruthy();
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "logo.svg");
    const img = host.querySelector(".workspace-svg img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("alt")).toBe("logo.svg");
    const src = img.getAttribute("src") ?? "";
    expect(src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(src.slice(src.indexOf(",") + 1))).toContain("<circle");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector(".workspace-code-meta")?.textContent).toMatch(/SVG/);
    expect(host.querySelector("[data-html-view]")?.textContent).toBe("Source");
    expect(host.querySelector("[data-html-view]")?.getAttribute("aria-pressed")).toBe("true");
    act(() => {
      (host.querySelector("[data-html-view]") as HTMLButtonElement).click();
    });
    expect(host.querySelector(".workspace-svg")).toBeNull();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("<circle");
    expect(host.querySelector("[data-html-view]")?.textContent).toBe("Preview");
    expect(host.querySelector("[data-html-view]")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens an svg hit at a line in source instead of preview", async () => {
    render(<WorkspaceEditor sessionId="s1" openPath="logo.svg" openLine={2} openAt={1} />);
    await flush();
    await flush();
    expect(host.querySelector(".workspace-svg")).toBeNull();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("<circle");
    expect(host.querySelector("[data-html-view]")?.textContent).toBe("Preview");
    expect(host.querySelector("[data-html-view]")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches an open svg preview to source when jumping to a line", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = host.querySelector('[data-path="logo.svg"]') as HTMLButtonElement;
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-svg")).toBeTruthy();
    act(() => {
      root.render(<WorkspaceEditor sessionId="s1" openPath="logo.svg" openLine={2} openAt={2} />);
    });
    await flush();
    await flush();
    expect(host.querySelector(".workspace-svg")).toBeNull();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain(
      'xmlns="http://www.w3.org/2000/svg"',
    );
    expect(host.querySelector("[data-html-view]")?.textContent).toBe("Preview");
  });

  it("copies a markdown fence from the editor preview", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = host.querySelector('[data-path="README.md"]') as HTMLButtonElement;
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const fenceCopy = host.querySelector(".md-copy") as HTMLButtonElement;
    expect(fenceCopy).toBeTruthy();
    await act(async () => {
      fenceCopy.click();
    });
    expect(writeText).toHaveBeenCalledWith("const x = 1;");
  });

  it("previews a PDF in the editor pane", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = host.querySelector('[data-path="brief.pdf"]') as HTMLButtonElement;
    expect(file).toBeTruthy();
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).not.toHaveBeenCalledWith("s1", "brief.pdf");
    const frame = host.querySelector(".workspace-pdf") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/api/sessions/s1/workspace/raw?path=brief.pdf");
    expect(host.querySelector(".workspace-code-meta")?.textContent).toMatch(/PDF/);
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("creates a file from the explorer and opens it", async () => {
    vi.mocked(api.saveWorkspaceFile).mockResolvedValueOnce({
      path: "src/new.ts",
      mtime: "t",
    });
    vi.stubGlobal("prompt", () => "src/new.ts");
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const create = host.querySelector('[aria-label="New file"]') as HTMLButtonElement;
    await act(async () => {
      create.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.saveWorkspaceFile).toHaveBeenCalledWith("s1", "src/new.ts", "");
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "src/new.ts");
    vi.unstubAllGlobals();
  });

  it("finds text in the open file with Ctrl+F", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(host.querySelector(".workspace-find")).toBeTruthy();
    const find = host.querySelector('[aria-label="Find in file"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(find, "hi");
      find.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector(".workspace-find-count")?.textContent).toMatch(/1 of 1/);
  });

  it("opens inline AI with Ctrl+Shift+K, asks about the selection, and applies an edit", async () => {
    const onAskAgent = vi.fn();
    vi.mocked(api.workspaceInlineEdit).mockResolvedValue({ text: 'const y = "hi";' });
    render(<WorkspaceEditor sessionId="s1" onAskAgent={onAskAgent} />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector(".workspace-code-main textarea") as HTMLTextAreaElement;
    ta.selectionStart = 0;
    ta.selectionEnd = 15;
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const box = host.querySelector("[data-testid='editor-inline-ai']") as HTMLFormElement;
    expect(box).toBeTruthy();
    expect(host.querySelector(".workspace-inline-ai-mode")?.textContent).toMatch(/Edit Selection/);

    const prompt = host.querySelector('[aria-label="Inline AI prompt"]') as HTMLTextAreaElement;
    prompt.value = "What does this do?";
    await act(async () => {
      (host.querySelector('[aria-label="Inline AI mode"]') as HTMLButtonElement).click();
    });
    const ask = [...host.querySelectorAll('[role="option"]')].find(
      (btn) => btn.textContent === "Ask",
    );
    expect(ask).toBeTruthy();
    await act(async () => {
      (ask as HTMLButtonElement).click();
    });
    await act(async () => {
      prompt.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(onAskAgent).toHaveBeenCalled();
    expect(String(onAskAgent.mock.calls[0]?.[0])).toMatch(/On src\/app\.ts/);
    expect(String(onAskAgent.mock.calls[0]?.[0])).toContain("What does this do?");
    expect(host.querySelector("[data-testid='editor-inline-ai']")).toBeNull();

    ta.selectionStart = 0;
    ta.selectionEnd = 15;
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const prompt2 = host.querySelector('[aria-label="Inline AI prompt"]') as HTMLTextAreaElement;
    prompt2.value = "rename x to y";
    await act(async () => {
      (host.querySelector('[aria-label="Submit inline AI"]') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceInlineEdit).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        path: "src/app.ts",
        instruction: "rename x to y",
        start: 0,
        end: 15,
      }),
    );
    expect(
      (host.querySelector(".workspace-code-main textarea") as HTMLTextAreaElement).value,
    ).toContain('const y = "hi";');
    expect(host.querySelector("[data-testid='editor-inline-ai']")).toBeNull();
  });

  it("closes inline AI with Escape", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector(".workspace-code-main textarea") as HTMLTextAreaElement;
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(host.querySelector("[data-testid='editor-inline-ai']")).toBeTruthy();
    await act(async () => {
      host
        .querySelector("[data-testid='editor-inline-ai']")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
    });
    expect(host.querySelector("[data-testid='editor-inline-ai']")).toBeNull();
  });

  it("pins inline AI under the selection, keeps the range, and scrolls with the file", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/big.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector(".workspace-code-main textarea") as HTMLTextAreaElement;
    const firstLine = ta.value.split("\n")[0] ?? "";
    ta.selectionStart = 0;
    ta.selectionEnd = firstLine.length;
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const box = host.querySelector("[data-testid='editor-inline-ai']") as HTMLFormElement;
    expect(box).toBeTruthy();
    expect(box.style.top).toBe(`${12 + 18 + 4}px`);
    expect(host.querySelector("[data-testid='editor-inline-ai-sel']")).toBeTruthy();
    expect(host.querySelector(".workspace-inline-ai-mode")?.textContent).toMatch(/Edit Selection/);
    const head = host.querySelector(".workspace-inline-ai-head") as HTMLElement;
    expect(head.firstElementChild?.getAttribute("aria-label")).toBe("Close inline AI");
    const prompt = host.querySelector('[aria-label="Inline AI prompt"]') as HTMLTextAreaElement;
    expect(prompt.previousElementSibling?.getAttribute("aria-label")).toBe("Close inline AI");

    const body = host.querySelector(".workspace-code-body") as HTMLElement;
    await act(async () => {
      body.scrollTop = 240;
      body.dispatchEvent(new Event("scroll"));
    });
    expect(box.style.transform).toMatch(/translateY\(-240px\)/);

    await act(async () => {
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(host.querySelector("[data-testid='editor-inline-ai']")).toBeNull();
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe(firstLine.length);
  });

  it("indents the current line with Tab", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    ta.selectionStart = 0;
    ta.selectionEnd = 0;
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    expect(ta.value.startsWith("  const") || ta.value.startsWith("    const")).toBe(true);
  });

  it("highlights TSX and labels a React Vite workspace", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    expect(host.querySelector("[data-project]")?.textContent).toMatch(/React/);
    const file = revealTreePath("src/App.tsx");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-tab-kind")?.textContent).toBe("<>");
    expect(host.querySelector(".workspace-highlight .tok-kw")?.textContent).toMatch(
      /export|function|main/,
    );
    expect(host.querySelector(".workspace-code-meta")?.textContent).toMatch(/TypeScript \(TSX\)/);
    expect(host.querySelector(".workspace-run-hint")?.textContent).toBe("npm run dev");
  });

  it("opens completions with Ctrl+Space and Tab inserts the selected item", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    ta.selectionStart = 2;
    ta.selectionEnd = 2;
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const list = host.querySelector('[role="listbox"]');
    expect(list).toBeTruthy();
    expect(list?.textContent).toMatch(/const/);
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(ta.value.startsWith("const")).toBe(true);
    expect(api.workspaceComplete).toHaveBeenCalled();
  });

  it("opens local completions without waiting for the language service", async () => {
    let resolveComplete!: (value: { items: []; source: "none" }) => void;
    vi.mocked(api.workspaceComplete).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveComplete = resolve;
      }),
    );
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    ta.selectionStart = 2;
    ta.selectionEnd = 2;
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.querySelector('[role="listbox"]')?.textContent).toMatch(/const/);
    await act(async () => {
      resolveComplete({ items: [], source: "none" });
      await Promise.resolve();
    });
    expect(host.querySelector('[role="listbox"]')?.textContent).toMatch(/const/);
  });

  it("labels Django templates from the html contents", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("templates/home.html");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-code-meta")?.textContent).toMatch(/Django template/);
    expect(host.querySelector(".workspace-highlight .tok-kw")?.textContent).toMatch(/extends|h1/);
  });

  it("deletes a file from the explorer", async () => {
    vi.stubGlobal("confirm", () => true);
    vi.mocked(api.deleteWorkspaceFile).mockResolvedValueOnce({ path: "src/app.ts" });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    revealTreePath("src/app.ts");
    const del = host.querySelector('[aria-label="Delete app.ts"]') as HTMLButtonElement;
    expect(del).toBeTruthy();
    await act(async () => {
      del.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.deleteWorkspaceFile).toHaveBeenCalledWith("s1", "src/app.ts");
    vi.unstubAllGlobals();
  });

  it("opens Go to file with Ctrl+P and opens a search hit", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    expect(host.querySelector(".workspace-status")?.textContent).toMatch(/Indexed 9/);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(host.querySelector(".workspace-quick-open")).toBeTruthy();
    expect(api.workspaceSearch).toHaveBeenCalledWith("s1", "", 40);
    const hit = host.querySelector(".workspace-quick-open-item") as HTMLButtonElement;
    expect(hit?.textContent).toMatch(/app\.ts/);
    await act(async () => {
      hit.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "src/app.ts");
    expect(host.querySelector(".workspace-quick-open")).toBeNull();
  });

  it("shows Go to file hits without waiting for TypeScript symbols", async () => {
    vi.mocked(api.workspaceSymbols).mockImplementation(() => new Promise(() => undefined));
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const input = host.querySelector(".workspace-quick-open-input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "app");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(api.workspaceSearch).toHaveBeenCalledWith("s1", "app", 40);
    expect(host.querySelector(".workspace-quick-open-item")?.textContent).toMatch(/app\.ts/);
  });

  it("opens Go to symbol with Ctrl+T", async () => {
    vi.mocked(api.workspaceSymbols).mockResolvedValue({
      items: [
        {
          path: "src/app.ts",
          kind: "symbol",
          symbol: "foldOldTurns",
          line: 1,
          score: 20,
        },
      ],
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "t", ctrlKey: true, bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    const dialog = host.querySelector(".workspace-quick-open");
    expect(dialog?.getAttribute("aria-label")).toBe("Go to symbol");
    const input = host.querySelector(".workspace-quick-open-input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "fold");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(api.workspaceSymbols).toHaveBeenCalledWith("s1", "fold", 24);
    const hit = host.querySelector(".workspace-quick-open-item") as HTMLButtonElement;
    expect(hit?.textContent).toMatch(/foldOldTurns/);
    await act(async () => {
      hit.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "src/app.ts");
  });

  it("re-indexes the workspace from the status bar", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    const btn = [...host.querySelectorAll("button")].find((row) =>
      /Indexed 9/.test(row.textContent ?? ""),
    );
    expect(btn).toBeTruthy();
    expect(btn?.getAttribute("aria-label")).toBe("Re-index workspace");
    vi.mocked(api.workspaceIndex).mockClear();
    vi.mocked(api.workspaceIndex).mockImplementation(() => new Promise(() => undefined));
    await act(async () => {
      btn!.click();
      await Promise.resolve();
    });
    expect(api.workspaceIndex).toHaveBeenCalledWith("s1", true);
    expect(host.querySelector(".workspace-tree-index")?.textContent).toMatch(/Indexing workspace/);
    expect(host.querySelector(".workspace-status")?.textContent).toMatch(/Indexing/);
  });

  it("opens Go to file from the compact status overflow menu", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    const status = host.querySelector(".workspace-status") as HTMLElement;
    expect(status.querySelector(".workspace-status-start")).toBeTruthy();
    expect(status.querySelector(".workspace-status-end")).toBeTruthy();
    const more = status.querySelector(".workspace-status-more") as HTMLDetailsElement;
    expect(more).toBeTruthy();
    const trigger = more.querySelector("summary") as HTMLElement;
    expect(trigger.getAttribute("aria-label")).toBe("Editor commands");
    await act(async () => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    expect(more.open).toBe(true);
    const goto = [...more.querySelectorAll('[role="menuitem"]')].find((row) =>
      /Go to file/.test(row.textContent ?? ""),
    ) as HTMLButtonElement;
    expect(goto?.textContent).toMatch(/Ctrl\+P/);
    await act(async () => {
      goto.click();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-quick-open")).toBeTruthy();
  });

  it("re-indexes from the command palette event", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    vi.mocked(api.workspaceIndex).mockClear();
    vi.mocked(api.workspaceIndex).mockResolvedValue({
      status: "ready",
      fileCount: 12,
      scanned: 12,
      builtAt: "2020-01-01T00:00:00.000Z",
    });
    await act(async () => {
      window.dispatchEvent(new Event("locus:workspace-reindex"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceIndex).toHaveBeenCalledWith("s1", true);
    expect(host.querySelector(".workspace-status")?.textContent).toMatch(/Indexed 12/);
  });

  it("searches code in files with Ctrl+Shift+F and opens a hit at its line", async () => {
    vi.mocked(api.workspaceFile).mockImplementation(async (_id: string, path: string) => {
      if (path === "src/app.ts") {
        return {
          path,
          content:
            Array.from({ length: 60 }, (_, i) =>
              i === 39 ? "const MATCH_LINE = 40;" : `const line${i + 1} = ${i};`,
            ).join("\n") + "\n",
          mtime: "2020-01-01T00:00:00.000Z",
        };
      }
      return { path, content: "", mtime: "2020-01-01T00:00:00.000Z" };
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const input = host.querySelector(
      '[role="dialog"][aria-label="Search in files"] .workspace-quick-open-input',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "const");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(api.workspaceGrep).toHaveBeenCalledWith("s1", "const", 80, {
      glob: undefined,
      exclude: undefined,
      regex: false,
    });
    const hit = [...host.querySelectorAll(".workspace-quick-open-item")].find((row) =>
      row.textContent?.includes("src/app.ts"),
    ) as HTMLButtonElement;
    expect(hit).toBeTruthy();
    await act(async () => {
      hit.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "src/app.ts");
    expect(host.querySelector('[role="dialog"][aria-label="Search in files"]')).toBeNull();
    expect((host.querySelector(".workspace-code-body") as HTMLElement).scrollTop).toBe(
      12 + 39 * 18,
    );
    const body = host.querySelector(".workspace-code-body") as HTMLElement;
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(ta, `${ta.value}\n`);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    expect(body.scrollTop).toBe(12 + 39 * 18);
  });

  it("undoes a Tab indent with Ctrl+Z", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    const original = ta.value;
    ta.selectionStart = 0;
    ta.selectionEnd = 0;
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    expect(ta.value).not.toBe(original);
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(ta.value).toBe(original);
  });

  it("undoes the file that was edited, not the tab you switched to", async () => {
    vi.mocked(api.workspaceFile).mockImplementation(async (_id: string, path: string) => {
      if (path === "src/app.ts") return { path, content: 'const x = "hi";\n', mtime: "t" };
      if (path === "package.json") {
        return { path, content: '{\n  "name": "desktop"\n}\n', mtime: "t" };
      }
      return { path, content: "", mtime: "t" };
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const app = revealTreePath("src/app.ts");
    await act(async () => {
      app.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    const originalApp = ta.value;
    ta.selectionStart = 0;
    ta.selectionEnd = 0;
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    const indented = ta.value;
    expect(indented).not.toBe(originalApp);
    const other = host.querySelector('[data-path="package.json"]') as HTMLButtonElement;
    expect(other).toBeTruthy();
    await act(async () => {
      other.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const otherTa = host.querySelector("textarea") as HTMLTextAreaElement;
    const originalOther = otherTa.value;
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("package.json");
    expect(originalOther).toContain('"name": "desktop"');
    await act(async () => {
      otherTa.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    const afterUndo = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("src/app.ts");
    expect(afterUndo.value).toBe(originalApp);
    const otherTab = [...host.querySelectorAll(".workspace-tab")].find(
      (tab) => tab.getAttribute("title") === "package.json",
    ) as HTMLElement;
    await act(async () => {
      otherTab.click();
      await Promise.resolve();
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(originalOther);
  });

  it("keeps undo working after an explorer rename", async () => {
    vi.mocked(api.renameWorkspacePath).mockResolvedValueOnce({
      from: "src/app.ts",
      path: "src/main.ts",
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    const original = ta.value;
    ta.selectionStart = 0;
    ta.selectionEnd = 0;
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    expect(ta.value).not.toBe(original);
    await act(async () => {
      file.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 12,
          clientY: 12,
        }),
      );
    });
    const rename = [...document.querySelectorAll('[role="menuitem"]')].find(
      (btn) => btn.textContent === "Rename",
    ) as HTMLButtonElement;
    await act(async () => {
      rename.click();
    });
    const input = host.querySelector('[aria-label="Rename path"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "src/main.ts");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input
        .closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("src/main.ts");
    const renamedTa = host.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      renamedTa.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(original);
  });

  it("shows git branch switch and pull when the working tree is clean", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const gitTab = host.querySelector('[data-mode="git"]') as HTMLButtonElement;
    await act(async () => {
      gitTab.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[aria-label="Git branch"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Merge branch"]')).toBeNull();
    expect(host.querySelector('[data-testid="workspace-git-stash"]')).toBeNull();
    await act(async () => {
      (host.querySelector('[data-testid="workspace-git-more"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector('[aria-label="Merge branch"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="workspace-git-stash"]')).toBeTruthy();
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Stash")).toBe(
      true,
    );
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Pull")).toBe(
      true,
    );
    expect(host.textContent).toMatch(/Working tree clean/);
  });

  it("renames an explorer path from the context menu", async () => {
    vi.mocked(api.renameWorkspacePath).mockResolvedValueOnce({
      from: "src/app.ts",
      path: "src/main.ts",
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 12,
          clientY: 12,
        }),
      );
    });
    const rename = [...document.querySelectorAll('[role="menuitem"]')].find(
      (btn) => btn.textContent === "Rename",
    ) as HTMLButtonElement;
    expect(rename).toBeTruthy();
    await act(async () => {
      rename.click();
    });
    const input = host.querySelector('[aria-label="Rename path"]') as HTMLInputElement;
    expect(input.value).toBe("src/app.ts");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "src/main.ts");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input
        .closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.renameWorkspacePath).toHaveBeenCalledWith("s1", "src/app.ts", "src/main.ts");
  });

  function stubRect(
    el: Element,
    box: { left: number; top: number; width: number; height: number },
  ) {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: box.left,
      top: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
      width: box.width,
      height: box.height,
      x: box.left,
      y: box.top,
      toJSON() {
        return box;
      },
    } as DOMRect);
  }

  async function openEditorFile(path: string) {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath(path);
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    const body = host.querySelector(".workspace-code-body") as HTMLElement;
    const main = host.querySelector(".workspace-code-main") as HTMLElement;
    expect(ta).toBeTruthy();
    expect(body).toBeTruthy();
    expect(main).toBeTruthy();
    return { ta, body, main };
  }

  function inspectHover(text: string | null, range?: { line: number; character: number }) {
    const line = range?.line ?? 0;
    const character = range?.character ?? 0;
    return {
      diagnostics: [] as [],
      hover: text
        ? {
            text,
            startLine: line,
            startCharacter: character,
            endLine: line,
            endCharacter: character,
          }
        : null,
      definition: null,
    };
  }

  function moveEditorPointer(ta: HTMLTextAreaElement, clientX: number, clientY: number) {
    act(() => {
      ta.dispatchEvent(
        new MouseEvent("mousemove", { clientX, clientY, bubbles: true, cancelable: true }),
      );
    });
  }

  it("paints hover and signature popups with an opaque panel", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    expect(css).not.toContain("var(--panel)");
    expect(css).toMatch(/\.workspace-hover \{[\s\S]*?background:\s*var\(--bg-1\)/);
    expect(css).toMatch(/\.workspace-code\.is-split \{[\s\S]*?grid-template-areas:/);
    expect(css).toMatch(/\.workspace-split-gutter \{[\s\S]*?cursor:\s*col-resize/);
    expect(css).toMatch(/\.workspace-hover \{[\s\S]*?color:\s*var\(--text\)/);
    expect(css).toMatch(/\.workspace-hover \{[\s\S]*?box-shadow:\s*var\(--shadow\)/);
    expect(css).toMatch(/\.workspace-signature \{[\s\S]*?background:\s*var\(--bg-1\)/);
    expect(css).toMatch(/\.workspace-ctx \{[\s\S]*?background:\s*var\(--bg-1\)/);
  });

  it("anchors a hover tooltip in the sticky editor window including scroll offset", async () => {
    vi.mocked(api.workspaceInspect).mockImplementation(async (_id, req) =>
      inspectHover(req.line > 0 ? 'useState(initialState: "desktop" | "mobile")' : null, req),
    );
    const { ta, body, main } = await openEditorFile("src/app.ts");
    stubRect(body, { left: 0, top: 100, width: 800, height: 400 });
    stubRect(main, { left: 48, top: 100, width: 752, height: 400 });
    Object.defineProperty(body, "scrollTop", { configurable: true, writable: true, value: 180 });
    moveEditorPointer(ta, 200, 150);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    const tip = host.querySelector(".workspace-hover") as HTMLElement;
    expect(tip).toBeTruthy();
    expect(tip.textContent).toMatch(/useState/);
    expect(tip.style.left).toBe("148.8px");
    expect(tip.style.top).toBe("72px");
    expect(tip.classList.contains("above")).toBe(false);
  });

  it("places the hover tooltip above the hovered line when there is room", async () => {
    vi.mocked(api.workspaceInspect).mockImplementation(async (_id, req) =>
      inspectHover(req.line > 0 ? 'useState(initialState: "desktop" | "mobile")' : null, req),
    );
    const { ta, body, main } = await openEditorFile("src/app.ts");
    stubRect(body, { left: 0, top: 100, width: 800, height: 400 });
    stubRect(main, { left: 48, top: 100, width: 752, height: 760 });
    moveEditorPointer(ta, 200, 280);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    const tip = host.querySelector(".workspace-hover") as HTMLElement;
    expect(tip).toBeTruthy();
    expect(tip.classList.contains("above")).toBe(true);
    expect(tip.style.left).toBe("148.8px");
    expect(tip.style.top).toBe("168px");
  });

  it("sits above the inspect symbol range rather than the raw pointer", async () => {
    vi.mocked(api.workspaceInspect).mockImplementation(async (_id, req) =>
      req.line > 0
        ? inspectHover('useState(initialState: "desktop" | "mobile")', {
            line: 5,
            character: 8,
          })
        : inspectHover(null),
    );
    const { ta, body, main } = await openEditorFile("src/app.ts");
    stubRect(body, { left: 0, top: 100, width: 800, height: 400 });
    stubRect(main, { left: 48, top: 100, width: 752, height: 760 });
    moveEditorPointer(ta, 200, 280);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    const tip = host.querySelector(".workspace-hover") as HTMLElement;
    expect(tip).toBeTruthy();
    expect(tip.classList.contains("above")).toBe(true);
    expect(tip.style.left).toBe("69.6px");
    expect(tip.style.top).toBe("96px");
  });

  it("does not stick a hover tooltip after the pointer leaves during inspect", async () => {
    let resolveHover: ((value: ReturnType<typeof inspectHover>) => void) | undefined;
    vi.mocked(api.workspaceInspect).mockImplementation((_id, req) => {
      if (req.line > 0) {
        return new Promise((resolve) => {
          resolveHover = resolve;
        });
      }
      return Promise.resolve(inspectHover(null));
    });
    const { ta, body, main } = await openEditorFile("src/app.ts");
    stubRect(body, { left: 0, top: 100, width: 800, height: 400 });
    stubRect(main, { left: 48, top: 100, width: 752, height: 400 });
    moveEditorPointer(ta, 200, 150);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(resolveHover).toBeTruthy();
    act(() => {
      ta.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
      ta.dispatchEvent(
        new MouseEvent("mouseleave", { bubbles: true, relatedTarget: document.body }),
      );
    });
    await act(async () => {
      resolveHover?.(inspectHover("stale hover"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-hover")).toBeNull();
  });

  it("dismisses hover when the editor scrolls or the open file changes", async () => {
    vi.mocked(api.workspaceInspect).mockImplementation(async (_id, req) =>
      inspectHover(req.line > 0 ? "const x: string" : null, req),
    );
    const { ta, body, main } = await openEditorFile("src/app.ts");
    stubRect(body, { left: 0, top: 100, width: 800, height: 400 });
    stubRect(main, { left: 48, top: 100, width: 752, height: 400 });
    moveEditorPointer(ta, 200, 150);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(host.querySelector(".workspace-hover")).toBeTruthy();
    act(() => {
      body.dispatchEvent(new Event("scroll"));
    });
    expect(host.querySelector(".workspace-hover")).toBeNull();
    moveEditorPointer(ta, 200, 150);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(host.querySelector(".workspace-hover")).toBeTruthy();
    const other = revealTreePath("src/App.tsx");
    await act(async () => {
      other.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-hover")).toBeNull();
  });

  it("hides hover as soon as the pointer moves away from the token", async () => {
    vi.mocked(api.workspaceInspect).mockImplementation(async (_id, req) =>
      inspectHover(req.line > 0 ? "const x: string" : null, req),
    );
    const { ta, body, main } = await openEditorFile("src/app.ts");
    stubRect(body, { left: 0, top: 100, width: 800, height: 400 });
    stubRect(main, { left: 48, top: 100, width: 752, height: 400 });
    moveEditorPointer(ta, 200, 150);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(host.querySelector(".workspace-hover")).toBeTruthy();
    moveEditorPointer(ta, 200, 200);
    expect(host.querySelector(".workspace-hover")).toBeNull();
  });

  it("creates a branch, fetches, discards, and stages hunks from the git pane", async () => {
    vi.mocked(api.workspaceGit).mockResolvedValue({
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [{ path: "src/app.ts", index: " ", worktree: "M", staged: false }],
    });
    vi.mocked(api.workspaceGitHunks).mockResolvedValue({
      items: [
        {
          path: "src/app.ts",
          staged: false,
          header: "@@ -1,1 +1,2 @@",
          patch:
            "diff --git a/src/app.ts b/src/app.ts\n@@ -1,1 +1,2 @@\n const x = 1;\n+const y = 2;\n",
          oldStart: 1,
          newStart: 1,
          lines: [
            { kind: "ctx", text: "const x = 1;" },
            { kind: "add", text: "const y = 2;" },
          ],
        },
      ],
    });
    vi.mocked(api.workspaceGitCheckout).mockResolvedValue({
      branch: "topic",
      ahead: 0,
      behind: 0,
      files: [{ path: "src/app.ts", index: " ", worktree: "M", staged: false }],
    });
    vi.mocked(api.workspaceGitFetch).mockResolvedValue({
      branch: "topic",
      ahead: 0,
      behind: 0,
      files: [{ path: "src/app.ts", index: " ", worktree: "M", staged: false }],
    });
    vi.mocked(api.workspaceGitDiscard).mockResolvedValue({
      branch: "topic",
      ahead: 0,
      behind: 0,
      files: [{ path: "src/app.ts", index: " ", worktree: "M", staged: false }],
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    act(() => {
      (host.querySelector('[data-mode="git"]') as HTMLButtonElement).click();
    });
    await flush();
    await act(async () => {
      (host.querySelector('[data-testid="workspace-git-more"]') as HTMLButtonElement).click();
    });
    const name = host.querySelector('[aria-label="New branch"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(name, "topic");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "Create",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(api.workspaceGitCheckout).toHaveBeenCalledWith("s1", "topic", true);
    await act(async () => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "Fetch",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(api.workspaceGitFetch).toHaveBeenCalledWith("s1");
    await act(async () => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "Discard",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(api.workspaceGitDiscard).toHaveBeenCalledWith("s1", ["src/app.ts"]);
    await act(async () => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "1 hunk",
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "Stage hunk",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(api.workspaceGitHunk).toHaveBeenCalled();
    await act(async () => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "Rebase",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(api.workspaceGitRebasePreview).toHaveBeenCalledWith("s1");
    expect(host.querySelector('[data-testid="workspace-git-rebase"]')).toBeTruthy();
  });

  it("opens an existing pull request from the git pane", async () => {
    const onOpenPull = vi.fn();
    vi.mocked(api.workspaceGit).mockResolvedValue({
      branch: "topic",
      ahead: 1,
      behind: 0,
      files: [],
    });
    vi.mocked(api.workspaceGitPullInfo).mockResolvedValue({
      pull: { number: 42, title: "Topic", url: "https://example/p/42", headRef: "topic" },
      repoId: "repo-1",
    });
    render(<WorkspaceEditor sessionId="s1" onOpenPull={onOpenPull} />);
    await flush();
    act(() => {
      (host.querySelector('[data-mode="git"]') as HTMLButtonElement).click();
    });
    await flush();
    await act(async () => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "Open PR",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onOpenPull).toHaveBeenCalledWith({ repoId: "repo-1", number: 42 });
  });

  it("switches the git pane among nested checkout dests", async () => {
    const dests = [
      { dest: "app", name: "app", primary: true as const },
      { dest: "lib", name: "lib" },
    ];
    vi.mocked(api.workspaceGit).mockImplementation(async (_id: string, dest?: string) => ({
      branch: dest === "lib" ? "lib-main" : "app-main",
      ahead: 0,
      behind: 0,
      files:
        dest === "lib"
          ? [{ path: "src/a.ts", index: " ", worktree: "M", staged: false }]
          : [{ path: "src/app.ts", index: " ", worktree: "M", staged: false }],
      dest: dest ?? "app",
      dests,
    }));
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    act(() => {
      (host.querySelector('[data-mode="git"]') as HTMLButtonElement).click();
    });
    await flush();
    expect(host.querySelector('[aria-label="Git repository"]')).toBeTruthy();
    expect(selectValue(host, "Git repository")).toBe("app");
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeTruthy();
    await act(async () => {
      setSelectValue(host, "Git repository", "lib");
      await Promise.resolve();
    });
    await flush();
    expect(api.workspaceGit).toHaveBeenCalledWith("s1", "lib");
    expect(host.querySelector('[aria-label="Git repository"]')).toBeTruthy();
    expect(selectValue(host, "Git repository")).toBe("lib");
    expect(host.querySelector('[data-path="src/a.ts"]')).toBeTruthy();
    await act(async () => {
      (host.querySelector('[data-path="src/a.ts"]') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "lib/src/a.ts");
    vi.mocked(api.workspaceGitPullInfo).mockResolvedValue({ pull: null, repoId: null });
    await act(async () => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "Open PR",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.execTool).toHaveBeenCalledWith(
      "s1",
      "git_pr",
      expect.objectContaining({ path: "lib" }),
    );
  });

  it("saves every dirty tab, wraps the editor, and jumps from breadcrumbs", async () => {
    vi.mocked(api.saveWorkspaceFile).mockImplementation(async (_id: string, path: string) => ({
      path,
      mtime: "2020-01-01T00:00:00.000Z",
    }));
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    const dirtyFile = revealTreePath("src/app.ts");
    expect(dirtyFile).toBeTruthy();
    await act(async () => {
      dirtyFile.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, 'const x = "edited";\n');
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (
        [...host.querySelectorAll(".workspace-editor-more [role='menuitem']")].find(
          (btn) => btn.textContent === "Save all",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(api.saveWorkspaceFile).toHaveBeenCalledWith("s1", "src/app.ts", 'const x = "edited";\n');
    const wrap = [...host.querySelectorAll(".workspace-editor-more [role='menuitem']")].find(
      (btn) => btn.textContent === "Wrap",
    ) as HTMLButtonElement;
    act(() => {
      wrap.click();
    });
    expect(host.querySelector(".workspace-editor-window.wrap")).toBeTruthy();
    expect(host.querySelector("textarea")?.getAttribute("wrap")).toBe("soft");
    expect(host.querySelector(".workspace-gutter-wrap")).toBeTruthy();
    const crumb = [...host.querySelectorAll(".workspace-outline-item")].find(
      (btn) => btn.textContent === "src",
    ) as HTMLButtonElement | undefined;
    if (crumb) {
      act(() => {
        crumb.click();
      });
      expect(host.querySelector('[data-mode="all"]')?.getAttribute("data-mode")).toBe("all");
    }
  });

  it("lists workspace problems and offers a quick fix", async () => {
    vi.mocked(api.workspaceProblems).mockResolvedValue({
      diagnostics: [
        {
          path: "src/app.ts",
          startLine: 0,
          startCharacter: 0,
          endLine: 0,
          endCharacter: 4,
          message: "Type error",
          severity: "error",
        },
      ],
    });
    vi.mocked(api.workspaceFix).mockResolvedValue({
      items: [
        { title: "Add import", files: [{ path: "src/app.ts", content: 'import x from "./x";\n' }] },
      ],
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    const problemFile = revealTreePath("src/app.ts");
    expect(problemFile).toBeTruthy();
    await act(async () => {
      problemFile.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    const errors = [...host.querySelectorAll("button")].find((btn) =>
      /errors/.test(btn.textContent ?? ""),
    );
    expect(errors?.textContent).toMatch(/1\s+errors/);
    act(() => {
      errors!.click();
    });
    expect(host.querySelector('[aria-label="Problems"]')?.textContent).toMatch(/Type error/);
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: ".", ctrlKey: true, bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(api.workspaceFix).toHaveBeenCalled();
    const fix = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Add import",
    ) as HTMLButtonElement;
    expect(fix).toBeTruthy();
    act(() => {
      fix.click();
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toMatch(/import x/);
  });

  it("runs a test from a Problems row", async () => {
    vi.mocked(api.workspaceProblems).mockResolvedValue({
      diagnostics: [
        {
          path: "src/app.ts",
          startLine: 0,
          startCharacter: 0,
          endLine: 0,
          endCharacter: 4,
          message: "vitest failed",
          severity: "error",
        },
      ],
    });
    const runs: string[] = [];
    const onRun = (event: Event) => {
      runs.push((event as CustomEvent<{ command: string }>).detail.command);
    };
    window.addEventListener("locus:workspace-terminal-run", onRun);
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    const problemFile = revealTreePath("src/app.ts");
    await act(async () => {
      problemFile.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    const errors = [...host.querySelectorAll("button")].find((btn) =>
      /errors/.test(btn.textContent ?? ""),
    );
    act(() => {
      errors!.click();
    });
    const run = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Run test",
    ) as HTMLButtonElement;
    expect(run).toBeTruthy();
    act(() => {
      run.click();
    });
    expect(runs).toEqual(["npx vitest run src/app.ts"]);
    window.removeEventListener("locus:workspace-terminal-run", onRun);
  });

  it("labels a combined quick fix as Fix all", async () => {
    vi.mocked(api.workspaceFix).mockResolvedValue({
      items: [
        {
          title: "Delete all unused expressions",
          files: [{ path: "src/app.ts", content: "export const keep = 1;\n" }],
          fixAll: true,
        },
      ],
    });
    const opened = await openEditorFile("src/app.ts");
    await act(async () => {
      opened.ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: ".", ctrlKey: true, bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(
      [...host.querySelectorAll("button")].some((btn) =>
        (btn.textContent ?? "").includes("Fix all · Delete all unused"),
      ),
    ).toBe(true);
  });

  it("opens pull files and review comment marks from an Open PR event", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    await act(async () => {
      requestWorkspaceOpenPr({
        sessionId: "s1",
        files: ["src/app.ts"],
        comments: [{ path: "src/app.ts", line: 1, body: "nit: rename", author: "sam" }],
        focus: { path: "src/app.ts", line: 1 },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "src/app.ts");
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("src/app.ts");
    const mark = host.querySelector(".workspace-gutter-comment") as HTMLButtonElement;
    expect(mark).toBeTruthy();
    act(() => {
      mark.click();
    });
    expect(host.querySelector('[aria-label="Review comment"]')?.textContent).toMatch(/nit: rename/);
  });

  it("reloads already-open files and focuses the hunk file last", async () => {
    await openEditorFile("src/app.ts");
    vi.mocked(api.workspaceFile).mockClear();
    await act(async () => {
      requestWorkspaceOpenPr({
        sessionId: "s1",
        files: ["src/App.tsx", "src/app.ts"],
        comments: [],
        focus: { path: "src/app.ts", line: 1 },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "src/App.tsx");
    expect(api.workspaceFile).toHaveBeenCalledWith("s1", "src/app.ts");
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("src/app.ts");
  });

  it("hints to install pylsp when the Python language server is missing", async () => {
    vi.mocked(api.workspaceInspect).mockResolvedValue({
      diagnostics: [],
      hover: null,
      definition: null,
      pylsp: false,
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    await flush();
    const py = revealTreePath("manage.py");
    await act(async () => {
      py.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(host.querySelector(".workspace-status-pylsp")?.textContent).toMatch(/python-lsp-server/);
  });

  async function openEditorContextMenu(path = "src/app.ts") {
    const opened = await openEditorFile(path);
    stubRect(opened.body, { left: 0, top: 0, width: 800, height: 400 });
    await act(async () => {
      opened.ta.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 80,
          clientY: 20,
        }),
      );
    });
    const menu = document.querySelector('[aria-label="Editor"]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.style.left).toBe("80px");
    expect(menu.style.top).toBe("20px");
    return { ...opened, menu };
  }

  function menuItem(menu: HTMLElement, label: string) {
    return [...menu.querySelectorAll('[role="menuitem"]')].find((btn) =>
      (btn.textContent ?? "").includes(label),
    ) as HTMLButtonElement;
  }

  it("right-clicks the editor for go to definition and find references", async () => {
    vi.mocked(api.workspaceInspect).mockResolvedValue({
      diagnostics: [],
      hover: null,
      definition: { path: "src/App.tsx", line: 0, character: 16 },
    });
    vi.mocked(api.workspaceReferences).mockResolvedValue({
      items: [{ path: "src/App.tsx", line: 0, character: 16 }],
    });
    const { menu } = await openEditorContextMenu();
    expect(menu.textContent).toMatch(/Go to Definition/);
    expect(menu.textContent).toMatch(/Go to Type Definition/);
    expect(menu.textContent).toMatch(/Go to Implementation/);
    expect(menu.textContent).toMatch(/Find All References/);
    expect(menu.textContent).toMatch(/Rename Symbol/);
    expect(menu.textContent).toMatch(/Quick Fix/);
    expect(menu.textContent).toMatch(/Format Document/);
    expect(menu.textContent).not.toMatch(/New file/);
    await act(async () => {
      menuItem(menu, "Go to Definition").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('[aria-label="Editor"]')).toBeNull();
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("src/App.tsx");
    expect(api.workspaceInspect).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ path: "src/app.ts" }),
    );
  });

  it("opens a type definition from the editor context menu", async () => {
    vi.mocked(api.workspaceInspect).mockResolvedValue({
      diagnostics: [],
      hover: null,
      definition: null,
      typeDefinition: { path: "src/App.tsx", line: 0, character: 16 },
    });
    const { menu } = await openEditorContextMenu();
    await act(async () => {
      menuItem(menu, "Go to Type Definition").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("src/App.tsx");
  });

  it("opens an implementation from the editor context menu", async () => {
    vi.mocked(api.workspaceInspect).mockResolvedValue({
      diagnostics: [],
      hover: null,
      definition: null,
      implementation: { path: "src/App.tsx", line: 0, character: 16 },
    });
    const { menu } = await openEditorContextMenu();
    await act(async () => {
      menuItem(menu, "Go to Implementation").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-tab.on")?.getAttribute("title")).toBe("src/App.tsx");
  });

  it("lists references from the editor context menu", async () => {
    vi.mocked(api.workspaceReferences).mockResolvedValue({
      items: [{ path: "src/App.tsx", line: 0, character: 16 }],
    });
    const { menu } = await openEditorContextMenu();
    await act(async () => {
      menuItem(menu, "Find All References").click();
      await Promise.resolve();
    });
    expect(api.workspaceReferences).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ path: "src/app.ts" }),
    );
    expect(host.querySelector('[aria-label="References"]')?.textContent).toMatch(/src\/App\.tsx:1/);
  });

  it("formats from the editor context menu and dismisses on Escape", async () => {
    vi.mocked(api.workspaceFormat).mockResolvedValue({
      content: 'const x = "formatted";\n',
      source: "ts",
    });
    const { ta, body } = await openEditorFile("src/app.ts");
    stubRect(body, { left: 0, top: 0, width: 800, height: 400 });
    await act(async () => {
      ta.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 80,
          clientY: 20,
        }),
      );
    });
    expect(document.querySelector('[aria-label="Editor"]')).toBeTruthy();
    await act(async () => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelector('[aria-label="Editor"]')).toBeNull();
    await act(async () => {
      ta.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 80,
          clientY: 20,
        }),
      );
    });
    const menu = document.querySelector('[aria-label="Editor"]') as HTMLElement;
    await act(async () => {
      menuItem(menu, "Format Document").click();
      await Promise.resolve();
    });
    expect(api.workspaceFormat).toHaveBeenCalled();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      'const x = "formatted";\n',
    );
  });

  it("cuts selected text from the editor context menu", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText, readText: vi.fn(async () => "") } });
    const { ta } = await openEditorFile("src/app.ts");
    ta.selectionStart = 6;
    ta.selectionEnd = 7;
    await act(async () => {
      ta.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 80,
          clientY: 20,
        }),
      );
    });
    const menu = document.querySelector('[aria-label="Editor"]') as HTMLElement;
    await act(async () => {
      menuItem(menu, "Cut").click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("x");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe('const  = "hi";\n');
  });

  it("ctrl-clicks go to definition from the native caret", async () => {
    vi.mocked(api.workspaceInspect).mockResolvedValue({
      diagnostics: [],
      hover: null,
      definition: { path: "src/App.tsx", line: 0, character: 16 },
    });
    const { ta, body } = await openEditorFile("src/app.ts");
    stubRect(body, { left: 0, top: 0, width: 800, height: 400 });
    ta.selectionStart = 6;
    ta.selectionEnd = 6;
    await act(async () => {
      ta.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: 80,
          clientY: 20,
          ctrlKey: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceInspect).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ path: "src/app.ts", line: 0, character: 6 }),
    );
  });

  it("keeps the explorer context menu separate from the editor menu", async () => {
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 12,
          clientY: 12,
        }),
      );
    });
    const menu = document.querySelector('[aria-label="Explorer"]') as HTMLElement;
    expect(menu.textContent).toMatch(/New file/);
    expect(menu.textContent).toMatch(/Rename/);
    expect(menu.textContent).not.toMatch(/Go to Definition/);
  });

  it("places the editor context menu at the click even with a transformed ancestor", async () => {
    const origStyle = window.getComputedStyle;
    window.getComputedStyle = ((el: Element) => {
      const style = origStyle.call(window, el);
      if ((el as HTMLElement).classList?.contains("workspace-editor")) {
        return {
          transform: "translateX(0px)",
          filter: "none",
          perspective: "none",
          backdropFilter: "none",
          contain: "none",
          willChange: "auto",
          getPropertyValue: (name: string) =>
            name === "backdrop-filter" ? "none" : style.getPropertyValue(name),
        } as unknown as CSSStyleDeclaration;
      }
      return style;
    }) as typeof getComputedStyle;
    try {
      const opened = await openEditorFile("src/app.ts");
      stubRect(opened.body, { left: 0, top: 0, width: 800, height: 400 });
      const editor = host.querySelector(".workspace-editor") as HTMLElement;
      editor.getBoundingClientRect = () =>
        ({
          top: 0,
          left: 340,
          width: 900,
          height: 700,
          right: 1240,
          bottom: 700,
          x: 340,
          y: 0,
          toJSON() {
            return {};
          },
        }) as DOMRect;
      await act(async () => {
        opened.ta.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 520,
            clientY: 180,
          }),
        );
      });
      const menu = document.querySelector('[aria-label="Editor"]') as HTMLElement;
      expect(menu.style.left).toBe("520px");
      expect(menu.style.top).toBe("180px");
    } finally {
      window.getComputedStyle = origStyle;
    }
  });

  it("accepts and rejects agent diffs from the Files diff view", async () => {
    vi.mocked(api.workspaceFile).mockResolvedValueOnce({
      path: "src/app.ts",
      content: 'const x = "hi";\nconst y = 2;\n',
      mtime: "t",
      baseline: 'const x = "hi";\nconst z = 1;\n',
    });
    vi.mocked(api.workspaceGitHunks).mockResolvedValue({
      items: [
        {
          path: "src/app.ts",
          staged: false,
          header: "@@ -1,2 +1,2 @@",
          patch: "diff --git a/src/app.ts b/src/app.ts\n",
          oldStart: 1,
          newStart: 1,
          lines: [],
        },
      ],
    });
    vi.mocked(api.workspaceGitStage).mockResolvedValue({
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [{ path: "src/app.ts", index: "M", worktree: " ", staged: true }],
    });
    vi.mocked(api.workspaceGitHunk).mockResolvedValue({
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [{ path: "src/app.ts", index: "M", worktree: " ", staged: true }],
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "Diff",
        ) as HTMLButtonElement
      ).click();
    });
    expect(host.querySelector(".workspace-diff-hunks")).toBeTruthy();
    await act(async () => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "Accept hunk 1",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(api.workspaceGitHunk).toHaveBeenCalled();
    await act(async () => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "Accept all",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(api.workspaceGitStage).toHaveBeenCalledWith("s1", ["src/app.ts"]);
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const y");
  });

  it("rejects every agent diff hunk back to the baseline", async () => {
    vi.mocked(api.workspaceFile).mockResolvedValueOnce({
      path: "src/app.ts",
      content: 'const x = "hi";\nconst y = 2;\n',
      mtime: "t",
      baseline: 'const x = "hi";\nconst z = 1;\n',
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    expect(file).toBeTruthy();
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      const toggle = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Diff");
      expect(toggle).toBeTruthy();
      toggle!.click();
    });
    expect(host.querySelector(".workspace-diff-hunks")).toBeTruthy();
    const rejectAll = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Reject all",
    ) as HTMLButtonElement;
    expect(rejectAll).toBeTruthy();
    act(() => {
      rejectAll.click();
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("const z");
  });

  it("offers Fix with agent on a workspace problem", async () => {
    const onAskAgent = vi.fn();
    vi.mocked(api.workspaceProblems).mockResolvedValue({
      diagnostics: [
        {
          path: "src/app.ts",
          startLine: 0,
          startCharacter: 0,
          endLine: 0,
          endCharacter: 4,
          message: "Type error",
          severity: "error",
        },
      ],
    });
    render(<WorkspaceEditor sessionId="s1" onAskAgent={onAskAgent} />);
    await flush();
    const file = revealTreePath("src/app.ts");
    expect(file).toBeTruthy();
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    const errors = [...host.querySelectorAll("button")].find((btn) =>
      /errors/.test(btn.textContent ?? ""),
    );
    act(() => {
      errors!.click();
    });
    const fix = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Fix with agent",
    ) as HTMLButtonElement;
    expect(fix).toBeTruthy();
    act(() => {
      fix.click();
    });
    expect(onAskAgent).toHaveBeenCalledWith(
      expect.stringMatching(/Fix this error in src\/app\.ts:1: Type error/),
    );
  });

  it("resolves conflict markers from the editor banner", async () => {
    vi.mocked(api.workspaceFile).mockResolvedValueOnce({
      path: "src/app.ts",
      content: "keep\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\n",
      mtime: "t",
    });
    vi.mocked(api.saveWorkspaceFile).mockResolvedValue({
      path: "src/app.ts",
      mtime: "t",
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    expect(file).toBeTruthy();
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".workspace-conflict-bar")?.textContent).toMatch(/Merge conflict/);
    await act(async () => {
      (
        [...host.querySelectorAll(".workspace-conflict-bar button")].find(
          (btn) => btn.textContent === "Take ours",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("keep\nours\n");
  });

  it("paints inline blame in the gutter", async () => {
    vi.mocked(api.workspaceBlameFile).mockResolvedValue({
      items: [
        {
          sha: "abc12345",
          author: "Ada Lovelace",
          date: "2020-01-01",
          line: 1,
          text: 'const x = "hi";',
        },
      ],
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/app.ts");
    expect(file).toBeTruthy();
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(host.querySelector(".workspace-gutter-col.has-blame")).toBeTruthy();
    expect(host.querySelector(".workspace-gutter-blame")?.textContent).toMatch(/Ada/);
  });

  it("merges a branch and takes ours on a conflicted file from the Git tab", async () => {
    vi.mocked(api.workspaceGit).mockResolvedValue({
      branch: "main",
      ahead: 0,
      behind: 0,
      merging: true,
      files: [{ path: "src/app.ts", index: "U", worktree: "U", staged: false, conflicted: true }],
    });
    vi.mocked(api.workspaceGitMerge).mockResolvedValue({
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [],
    });
    vi.mocked(api.workspaceGitConflict).mockResolvedValue({
      branch: "main",
      ahead: 0,
      behind: 0,
      merging: true,
      files: [{ path: "src/app.ts", index: "M", worktree: " ", staged: true }],
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    act(() => {
      (host.querySelector('[data-mode="git"]') as HTMLButtonElement).click();
    });
    await flush();
    expect(host.querySelector('[data-testid="workspace-git-merge"]')?.textContent).toMatch(
      /Merging/,
    );
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Continue")).toBe(
      true,
    );
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Abort")).toBe(
      true,
    );
    expect(host.querySelector('[data-testid="workspace-git-stash"]')).toBeNull();
    expect(host.querySelector('[data-path="src/app.ts"]')?.textContent).toMatch(/C/);
    await act(async () => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "Take ours",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(api.workspaceGitConflict).toHaveBeenCalledWith("s1", "src/app.ts", "ours");
    await act(async () => {
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "Abort",
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(api.workspaceGitMerge).toHaveBeenCalledWith("s1", { action: "abort" });
  });

  it("shows a minimap for a long source file", async () => {
    vi.mocked(api.workspaceFile).mockImplementation(async (_id, path) => {
      if (String(path).endsWith("big.ts")) {
        return {
          path: "src/big.ts",
          content: Array.from({ length: 80 }, (_, i) => `export const n${i} = ${i};`).join("\n"),
          mtime: "2020-01-01T00:00:00.000Z",
        };
      }
      return { path, content: 'const x = "hi";\n', mtime: "2020-01-01T00:00:00.000Z" };
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/big.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta?.value).toContain("export const n79");
    expect(host.querySelector('[data-testid="editor-minimap"]')).toBeTruthy();
  });

  it("toggles the minimap off and on from the editor toolbar", async () => {
    vi.mocked(api.workspaceFile).mockImplementation(async (_id, path) => {
      if (String(path).endsWith("big.ts")) {
        return {
          path: "src/big.ts",
          content: Array.from({ length: 80 }, (_, i) => `export const n${i} = ${i};`).join("\n"),
          mtime: "2020-01-01T00:00:00.000Z",
        };
      }
      return { path, content: 'const x = "hi";\n', mtime: "2020-01-01T00:00:00.000Z" };
    });
    render(<WorkspaceEditor sessionId="s1" />);
    await flush();
    const file = revealTreePath("src/big.ts");
    await act(async () => {
      file.click();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const toggle = host.querySelector('[data-testid="editor-minimap-toggle"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-testid="editor-minimap"]')).toBeTruthy();
    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector('[data-testid="editor-minimap"]')).toBeNull();
    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-testid="editor-minimap"]')).toBeTruthy();
  });

  it("embeds a Docker explorer in the IDE that inspects a container", async () => {
    vi.mocked(api.dockerContainers).mockResolvedValue({
      kind: "mock",
      containers: [
        {
          id: "c1",
          name: "siq8-dev_webpack.abc",
          image: "node:22",
          state: "running",
          status: "Up 2 hours",
          createdAt: "2020-01-01T00:00:00.000Z",
          containerId: "abc123def456",
          locus: false,
        },
      ],
    });
    render(
      <Store.Provider
        value={{
          state: {
            ...initialState,
            section: "ide",
            containers: [
              {
                id: "c1",
                name: "siq8-dev_webpack.abc",
                image: "node:22",
                state: "running",
                status: "Up 2 hours",
                createdAt: "2020-01-01T00:00:00.000Z",
                containerId: "abc123def456",
                locus: false,
              },
            ],
          },
          dispatch: () => undefined,
        }}
      >
        <WorkspaceEditor sessionId="s1" />
      </Store.Provider>,
    );
    await flush();
    expect(host.querySelector('[data-testid="docker-explorer"]')).toBeTruthy();
    expect(host.querySelector(".docker-explorer-name")?.textContent).toBe("siq8-dev_webpack.abc");
    await act(async () => {
      (host.querySelector(".docker-explorer-open") as HTMLButtonElement).click();
    });
    expect(host.querySelector(".workspace-docker-inspect")?.textContent).toMatch(
      /siq8-dev_webpack\.abc/,
    );
    expect(host.querySelector(".workspace-docker-inspect-meta")?.textContent).toMatch(
      /abc123def456/,
    );
  });
});
