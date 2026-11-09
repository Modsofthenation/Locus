import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PatchCard, ToolPatch } from "./PatchCard";
import type { PatchFile } from "@locus/shared";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    revealWorkspace: vi.fn(async () => ({ path: "/tmp" })),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PatchCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  function expandFiles() {
    act(() => {
      for (const btn of host.querySelectorAll<HTMLButtonElement>(".patch-file-toggle")) {
        if (btn.getAttribute("aria-expanded") === "false") btn.click();
      }
    });
  }

  it("starts chat file cards collapsed", () => {
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    render(<ToolPatch name="apply_patch" args={{ patch }} />);
    const file = host.querySelector(".patch-file");
    expect(file?.classList.contains("collapsed")).toBe(true);
    expect(host.querySelector(".patch-file-toggle")?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".patch-hunk")).toBeNull();
    expandFiles();
    expect(file?.classList.contains("collapsed")).toBe(false);
    expect(host.querySelector(".patch-line.add")?.textContent).toContain("new");
  });

  it("renders file headers and add/del lines for apply_patch", () => {
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      " keep",
      "-old",
      "+new",
      " keep",
    ].join("\n");
    render(<ToolPatch name="apply_patch" args={{ patch }} />);
    expandFiles();
    const card = host.querySelector("[data-testid='patch-card']");
    expect(card?.querySelector(".patch-path-name")?.textContent).toBe("app.ts");
    expect(card?.querySelector(".patch-path-dir")?.textContent).toBe("src");
    expect(card?.textContent).toContain("update");
    expect(card?.querySelector(".patch-line.del")?.textContent).toContain("old");
    expect(card?.querySelector(".patch-line.add")?.textContent).toContain("new");
    expect(card?.querySelector(".patch-ln.old")?.textContent).toBe("1");
    expect(card?.querySelector(".patch-stats .add")?.textContent).toBe("+1");
    expect(card?.querySelector(".patch-hunk-head")?.textContent).toContain("@@");
  });

  it("opens a patch path in Files when onOpenPath is set", () => {
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      " keep",
      "-old",
      "+new",
      " keep",
    ].join("\n");
    const onOpenPath = vi.fn();
    render(<ToolPatch name="apply_patch" args={{ patch }} onOpenPath={onOpenPath} />);
    const path = host.querySelector(".patch-path-open") as HTMLButtonElement;
    expect(path?.querySelector(".patch-path-name")?.textContent).toBe("app.ts");
    expect(path?.querySelector(".patch-path-dir")?.textContent).toBe("src");
    act(() => {
      path.click();
    });
    expect(onOpenPath).toHaveBeenCalledWith("src/app.ts", 1);
  });

  it("highlights TypeScript in review diffs", () => {
    render(
      <ToolPatch
        name="git_diff"
        result={
          "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-const old = 1\n+const next = 2\n"
        }
      />,
    );
    expandFiles();
    expect(host.querySelector(".patch-line.del .tok-kw")?.textContent).toBe("const");
    expect(host.querySelector(".patch-line.add .tok-num")?.textContent).toBe("2");
  });

  it("highlights Python types and decorators in review diffs", () => {
    render(
      <ToolPatch
        name="git_diff"
        result={[
          "--- a/app/mcp/tests/test_tool_forensics.py",
          "+++ b/app/mcp/tests/test_tool_forensics.py",
          "@@ -0,0 +1,3 @@",
          "+class McpForensicsToolTests(TestCase):",
          "+    @classmethod",
          "+    def setUpTestData(cls):",
        ].join("\n")}
      />,
    );
    expandFiles();
    expect(host.querySelector(".tok-type")?.textContent).toBe("McpForensicsToolTests");
    expect(host.querySelector(".tok-dec")?.textContent).toBe("@classmethod");
    expect(host.querySelector(".tok-fn")?.textContent).toBe("setUpTestData");
    expect(host.querySelector(".tok-bi")?.textContent).toBe("cls");
  });

  it("renders git_diff output and ignores non-patch tools", () => {
    render(
      <ToolPatch name="git_diff" result={"--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n"} />,
    );
    expect(host.querySelector("[data-testid='patch-card']")).toBeTruthy();
    act(() => {
      root.render(<ToolPatch name="exec" args={{ command: "ls" }} result="ok" />);
    });
    expect(host.querySelector("[data-testid='patch-card']")).toBeNull();
  });

  it("renders Cursor CLI editToolCall args as a file card", () => {
    render(
      <ToolPatch
        name="apply_patch"
        args={{
          path: "src/app.ts",
          strReplace: { oldText: "old", newText: "new" },
        }}
      />,
    );
    const card = host.querySelector("[data-testid='patch-card']");
    expect(card?.querySelector(".patch-path-name")?.textContent).toBe("app.ts");
    expect(card?.querySelector(".patch-file")?.classList.contains("collapsed")).toBe(true);
    expandFiles();
    expect(card?.querySelector(".patch-line.del")?.textContent).toContain("old");
    expect(card?.querySelector(".patch-line.add")?.textContent).toContain("new");
  });

  it("returns nothing when there are no files", () => {
    render(<PatchCard files={[]} />);
    expect(host.querySelector("[data-testid='patch-card']")).toBeNull();
  });

  it("collapses a file and reports a line click", () => {
    const files: PatchFile[] = [
      {
        path: "src/app.ts",
        kind: "update",
        hunks: [
          {
            oldStart: 4,
            newStart: 4,
            oldLines: ["old"],
            newLines: ["new"],
            rows: [
              { kind: "del", text: "old" },
              { kind: "add", text: "new" },
            ],
          },
        ],
      },
    ];
    const clicks: Array<{ path: string; line: number; side: string }> = [];
    render(
      <PatchCard
        files={files}
        density="review"
        onLineSelect={(ref) => {
          clicks.push(ref);
        }}
      />,
    );
    expect(host.querySelector(".patch-hunk")).toBeTruthy();
    act(() => {
      (host.querySelector(".patch-file-toggle") as HTMLButtonElement).click();
    });
    expect(host.querySelector(".patch-hunk")).toBeNull();
    act(() => {
      (host.querySelector(".patch-file-toggle") as HTMLButtonElement).click();
    });
    act(() => {
      (host.querySelector(".patch-line.del") as HTMLButtonElement).click();
    });
    expect(clicks).toEqual([{ path: "src/app.ts", line: 4, side: "LEFT" }]);
    act(() => {
      (host.querySelector(".patch-line.add") as HTMLButtonElement).click();
    });
    expect(clicks).toEqual([
      { path: "src/app.ts", line: 4, side: "LEFT" },
      { path: "src/app.ts", line: 4, side: "RIGHT" },
    ]);
  });

  it("keeps unfocused review files collapsed and paints the selected line", () => {
    const files: PatchFile[] = [
      {
        path: "src/a.ts",
        kind: "update",
        hunks: [
          {
            oldStart: 1,
            newStart: 1,
            oldLines: ["a"],
            newLines: ["A"],
            rows: [
              { kind: "del", text: "a" },
              { kind: "add", text: "A" },
            ],
          },
        ],
      },
      {
        path: "src/b.ts",
        kind: "add",
        hunks: [
          {
            oldStart: 0,
            newStart: 1,
            oldLines: [],
            newLines: ["b"],
            rows: [{ kind: "add", text: "b" }],
          },
        ],
      },
    ];
    render(
      <PatchCard
        files={files}
        density="review"
        focusPath="src/a.ts"
        selected={{ path: "src/a.ts", line: 1, side: "RIGHT" }}
        onLineSelect={() => undefined}
      />,
    );
    expect(host.querySelectorAll(".patch-file").length).toBe(2);
    expect(host.querySelectorAll(".patch-file.collapsed").length).toBe(1);
    expect(host.querySelector("[data-patch-path='src/b.ts'] .patch-hunk")).toBeNull();
    expect(
      host.querySelector("[data-patch-path='src/a.ts'] .patch-line.add")?.textContent,
    ).toContain("A");
    expect(host.querySelector(".patch-line.selected")?.textContent).toContain("A");
    act(() => {
      root.render(
        <PatchCard
          files={files}
          density="review"
          focusPath="src/b.ts"
          onLineSelect={() => undefined}
        />,
      );
    });
    expect(host.querySelector("[data-patch-path='src/a.ts'] .patch-hunk")).toBeNull();
    expect(
      host.querySelector("[data-patch-path='src/b.ts'] .patch-line.add")?.textContent,
    ).toContain("b");
  });

  it("truncates huge files until Show more", () => {
    const rows = Array.from({ length: 401 }, (_, i) => ({
      kind: "add" as const,
      text: `const n${i} = ${i};`,
    }));
    render(
      <PatchCard
        files={[
          {
            path: "src/big.ts",
            kind: "add",
            hunks: [
              { oldStart: 0, newStart: 1, oldLines: [], newLines: rows.map((r) => r.text), rows },
            ],
          },
        ]}
      />,
    );
    expandFiles();
    expect(host.querySelectorAll(".patch-line").length).toBe(400);
    expect(host.querySelector(".patch-more")?.textContent).toMatch(/Show 1 more line/);
    act(() => {
      (host.querySelector(".patch-more") as HTMLButtonElement).click();
    });
    expect(host.querySelectorAll(".patch-line").length).toBe(401);
    expect(host.querySelector(".patch-more")).toBeNull();
  });

  it("shows a Windows host-workspace filename and reveals the folder on click", () => {
    const winPath =
      "C:\\Users\\locus\\.locus\\host-workspaces\\712f0b2e-8dd8-4557-914b-e5a38cb4d9c8\\index.js";
    const onRevealFolder = vi.fn();
    const onOpenPath = vi.fn();
    render(
      <PatchCard
        files={[
          {
            path: winPath,
            kind: "add",
            hunks: [
              {
                oldStart: 0,
                newStart: 1,
                oldLines: [],
                newLines: ["const n = 1;"],
                rows: [{ kind: "add", text: "const n = 1;" }],
              },
            ],
          },
        ]}
        onOpenPath={onOpenPath}
        onRevealFolder={onRevealFolder}
      />,
    );
    const path = host.querySelector(".patch-path-open") as HTMLButtonElement;
    expect(path?.querySelector(".patch-path-name")?.textContent).toBe("index.js");
    expect(path?.querySelector(".patch-path-dir")?.textContent).toContain("host-workspaces");
    expect(path?.title).toMatch(/File Explorer|Finder|file manager/);
    act(() => {
      path.click();
    });
    expect(onRevealFolder).toHaveBeenCalledWith(winPath);
    expect(onOpenPath).not.toHaveBeenCalled();
  });

  it("asks the session API to reveal a folder when sessionId is set", () => {
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    render(<ToolPatch name="apply_patch" args={{ patch }} sessionId="sess-1" />);
    act(() => {
      (host.querySelector(".patch-path-open") as HTMLButtonElement).click();
    });
    expect(api.revealWorkspace).toHaveBeenCalledWith("sess-1", "src/app.ts");
  });
});
