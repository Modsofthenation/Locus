import { describe, expect, it } from "vitest";
import type { ChatMessage, ToolCall } from "./models/session.js";
import {
  collapseLineDiff,
  lineChangeMarks,
  lineChangeMarksFromText,
  isWorkspaceBinaryPreviewPath,
  isWorkspaceRawBytesPath,
  isWorkspaceHtmlPath,
  isWorkspaceImagePath,
  isWorkspacePdfPath,
  revertNthChangeHunk,
  changeHunkCount,
  isWorkspaceMarkdownPath,
  isWorkspaceSvgPath,
  lineDiff,
  lineDiffStats,
  mergeWorkspaceChanges,
  sumWorkspaceChanges,
  workspaceChangesFromMessages,
  workspaceImageMime,
  workspaceRawMime,
  workspaceRelFromToolPath,
  patchPathLabel,
} from "./workspaceChanges.js";

function message(calls: ToolCall[]): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "",
    createdAt: "t",
    toolCalls: calls,
  };
}

function call(partial: Partial<ToolCall> & Pick<ToolCall, "name">): ToolCall {
  return {
    id: partial.id ?? "c1",
    name: partial.name,
    arguments: partial.arguments ?? {},
    result: partial.result,
    error: partial.error,
    approval: partial.approval,
    startedAt: partial.startedAt ?? "t",
    finishedAt: partial.finishedAt ?? "t",
  };
}

describe("workspaceRelFromToolPath", () => {
  it("strips the guest workspace prefix and rejects escapes", () => {
    expect(workspaceRelFromToolPath("/workspace/src/app.ts")).toBe("src/app.ts");
    expect(workspaceRelFromToolPath("src/app.ts")).toBe("src/app.ts");
    expect(workspaceRelFromToolPath("/workspace/../etc/passwd")).toBe("");
    expect(workspaceRelFromToolPath("/workspace")).toBe("");
    expect(workspaceRelFromToolPath("src/app.ts/")).toBe("src/app.ts");
    expect(workspaceRelFromToolPath("src/app.ts\0hidden")).toBe("");
  });

  it("relativizes host-absolute Cursor CLI / host-agent paths", () => {
    expect(workspaceRelFromToolPath("/home/locus/.locus/host-workspaces/ee26bc7e/src/app.ts")).toBe(
      "src/app.ts",
    );
    expect(
      workspaceRelFromToolPath(
        "C:\\Users\\locus\\.locus\\host-workspaces\\712f0b2e-8dd8-4557-914b-e5a38cb4d9c8\\index.js",
      ),
    ).toBe("index.js");
    expect(workspaceRelFromToolPath("/tmp/my-project/src/app.ts", "/tmp/my-project")).toBe(
      "src/app.ts",
    );
    expect(
      workspaceRelFromToolPath(
        "C:\\Users\\locus\\project\\src\\app.ts",
        "C:\\Users\\locus\\project",
      ),
    ).toBe("src/app.ts");
    expect(workspaceRelFromToolPath("/etc/passwd", "/tmp/my-project")).toBe("");
  });
});

describe("patchPathLabel", () => {
  it("keeps the basename visible for posix and Windows host paths", () => {
    expect(patchPathLabel("src/app.ts")).toEqual({ name: "app.ts", dir: "src" });
    expect(patchPathLabel("/workspace/src/app.ts")).toEqual({
      name: "app.ts",
      dir: "/workspace/src",
    });
    expect(patchPathLabel("app.ts")).toEqual({ name: "app.ts", dir: "" });
    expect(
      patchPathLabel(
        "C:\\Users\\locus\\.locus\\host-workspaces\\712f0b2e-8dd8-4557-914b-e5a38cb4d9c8\\index.js",
      ),
    ).toEqual({
      name: "index.js",
      dir: "C:\\Users\\locus\\.locus\\host-workspaces\\712f0b2e-8dd8-4557-914b-e5a38cb4d9c8",
    });
  });
});

describe("lineDiffStats", () => {
  it("counts bag differences of lines", () => {
    expect(lineDiffStats("a\nb\n", "a\nc\n")).toEqual({ additions: 1, deletions: 1 });
    expect(lineDiffStats("", "one\ntwo\n")).toEqual({ additions: 2, deletions: 0 });
    expect(lineDiffStats("keep\n", "keep\n")).toEqual({ additions: 0, deletions: 0 });
    expect(lineDiffStats("keep\r\n", "keep\n")).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("lineDiff", () => {
  it("marks added and removed lines with positions", () => {
    expect(lineDiff("keep\nold\n", "keep\nnew\n")).toEqual([
      { kind: "eq", text: "keep", oldLine: 1, newLine: 1 },
      { kind: "del", text: "old", oldLine: 2 },
      { kind: "add", text: "new", newLine: 2 },
    ]);
  });

  it("treats CRLF and LF as the same file", () => {
    const lf = "keep\nold\n";
    const crlf = "keep\r\nold\r\n";
    expect(lineDiffStats(lf, crlf)).toEqual({ additions: 0, deletions: 0 });
    expect(lineDiff(lf, crlf).every((row) => row.kind === "eq")).toBe(true);
  });

  it("treats a new file as all additions", () => {
    expect(lineDiff("", "one\ntwo\n")).toEqual([
      { kind: "add", text: "one", newLine: 1 },
      { kind: "add", text: "two", newLine: 2 },
    ]);
  });

  it("keeps matching lines on a large file with a local edit", () => {
    const before = Array.from({ length: 800 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const after = before.replace("line 400", "line 400 changed");
    const started = performance.now();
    const rows = lineDiff(before, after);
    expect(performance.now() - started).toBeLessThan(100);
    expect(rows.filter((row) => row.kind === "eq")).toHaveLength(799);
    expect(rows.filter((row) => row.kind === "del")).toEqual([
      { kind: "del", text: "line 400", oldLine: 401 },
    ]);
    expect(rows.filter((row) => row.kind === "add")).toEqual([
      { kind: "add", text: "line 400 changed", newLine: 401 },
    ]);
  });
});

describe("lineChangeMarks", () => {
  it("marks pure additions, replacements, and deletions", () => {
    expect(lineChangeMarks(lineDiff("keep\n", "keep\nnew\n"))).toEqual([
      { kind: "add", startLine: 2, lineCount: 1 },
    ]);
    expect(lineChangeMarks(lineDiff("keep\nold\n", "keep\nnew\n"))).toEqual([
      { kind: "mod", startLine: 2, lineCount: 1 },
    ]);
    expect(lineChangeMarks(lineDiff("keep\ngone\n", "keep\n"))).toEqual([
      { kind: "del", startLine: 1, lineCount: 1 },
    ]);
  });

  it("treats a new file as one added run", () => {
    expect(lineChangeMarks(lineDiff("", "one\ntwo\nthree\n"))).toEqual([
      { kind: "add", startLine: 1, lineCount: 3 },
    ]);
  });
});

describe("lineChangeMarksFromText", () => {
  it("matches a full line diff on typical editor edits", () => {
    const cases: Array<[string, string]> = [
      ["keep\n", "keep\nnew\n"],
      ["keep\nold\n", "keep\nnew\n"],
      ["keep\ngone\n", "keep\n"],
      ["", "one\ntwo\nthree\n"],
      ["a\nb\nc\n", "a\nb\nc\n"],
      ["a\r\nb\r\n", "a\nb\n"],
      ['const x = "hi";\r\n', 'const x = "hi";\n'],
      ["a\nc\n", "a\nb\nc\n"],
      ["l0\nl1\nl2\nl3\nl4\n", "l0\nX\nl2\nY\nl4\n"],
      ["one\n", ""],
    ];
    for (const [before, after] of cases) {
      expect(lineChangeMarksFromText(before, after)).toEqual(
        lineChangeMarks(lineDiff(before, after)),
      );
    }
  });

  it("stays cheaper than materializing unchanged rows on a large file", () => {
    const before = Array.from({ length: 4_000 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const after = before.replace("line 2000", "line 2000 changed");
    const fullStart = performance.now();
    const full = lineChangeMarks(lineDiff(before, after));
    const fullMs = performance.now() - fullStart;
    const cheapStart = performance.now();
    let cheap = lineChangeMarksFromText(before, after);
    for (let i = 0; i < 8; i += 1) {
      cheap = lineChangeMarksFromText(before, `${after}${"x".repeat(i + 1)}`);
    }
    const cheapMs = performance.now() - cheapStart;
    expect(lineChangeMarksFromText(before, after)).toEqual(full);
    expect(cheap.at(-1)?.kind).toBe("add");
    expect(cheapMs, "gutter marks typing budget").toBeLessThan(Math.max(fullMs * 0.8, 50));
  });
});

describe("collapseLineDiff", () => {
  it("hides unchanged runs beyond the context window", () => {
    const rows = lineDiff(
      Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n") + "\n",
      Array.from({ length: 20 }, (_, i) => (i === 10 ? "changed" : `l${i}`)).join("\n") + "\n",
    );
    const view = collapseLineDiff(rows, 2);
    expect(view[0]).toMatchObject({ kind: "omit" });
    expect(view.some((row) => row.kind === "del" && row.text === "l10")).toBe(true);
    expect(view.some((row) => row.kind === "add" && row.text === "changed")).toBe(true);
    expect(view.at(-1)).toMatchObject({ kind: "omit" });
    const visibleEq = view.filter((row) => row.kind === "eq");
    expect(visibleEq).toHaveLength(4);
  });
});

describe("isWorkspaceImagePath", () => {
  it("detects screenshot extensions and mime types", () => {
    expect(isWorkspaceImagePath("shots/t1.png")).toBe(true);
    expect(isWorkspaceImagePath("shots/t1.PNG")).toBe(true);
    expect(isWorkspaceImagePath("src/app.ts")).toBe(false);
    expect(workspaceImageMime("hero.jpg")).toBe("image/jpeg");
    expect(workspaceImageMime("shot.png")).toBe("image/png");
  });
});

describe("workspace preview paths", () => {
  it("detects html, pdf, and binary preview files", () => {
    expect(isWorkspaceHtmlPath("docs/page.html")).toBe(true);
    expect(isWorkspaceHtmlPath("index.HTM")).toBe(true);
    expect(isWorkspaceHtmlPath("page.html.bak")).toBe(false);
    expect(isWorkspacePdfPath("uploads/invoice.pdf")).toBe(true);
    expect(isWorkspacePdfPath("uploads/invoice.PDF")).toBe(true);
    expect(isWorkspacePdfPath("src/app.ts")).toBe(false);
    expect(isWorkspaceBinaryPreviewPath("shot.png")).toBe(true);
    expect(isWorkspaceBinaryPreviewPath("brief.pdf")).toBe(true);
    expect(isWorkspaceBinaryPreviewPath("index.html")).toBe(false);
    expect(isWorkspaceRawBytesPath("export.glb")).toBe(true);
    expect(isWorkspaceRawBytesPath("export.stl")).toBe(true);
    expect(isWorkspaceBinaryPreviewPath("export.glb")).toBe(false);
    expect(workspaceRawMime("brief.pdf")).toBe("application/pdf");
    expect(workspaceRawMime("export.glb")).toBe("model/gltf-binary");
    expect(workspaceRawMime("hero.jpg")).toBe("image/jpeg");
  });
});

describe("workspaceChangesFromMessages", () => {
  it("counts file_write lines against the previous write to that path", () => {
    const changes = workspaceChangesFromMessages([
      message([
        call({
          name: "file_write",
          arguments: { path: "/workspace/src/app.ts", content: "one\ntwo\n" },
          result: "wrote",
        }),
      ]),
      message([
        call({
          id: "c2",
          name: "file_write",
          arguments: { path: "/workspace/src/app.ts", content: "one\nTWO\nthree\n" },
          result: "wrote",
        }),
      ]),
    ]);
    expect(changes).toEqual([{ path: "src/app.ts", additions: 2, deletions: 1 }]);
  });

  it("counts Cursor write_file calls using target_file", () => {
    const changes = workspaceChangesFromMessages([
      message([
        call({
          name: "write_file",
          arguments: { target_file: "/workspace/src/app.ts", content: "one\n" },
          result: "ok",
        }),
      ]),
    ]);
    expect(changes).toEqual([{ path: "src/app.ts", additions: 1, deletions: 0 }]);
  });

  it("reads apply_patch files and skips failed or gated calls", () => {
    const changes = workspaceChangesFromMessages([
      message([
        call({
          name: "apply_patch",
          arguments: { patch: "*** Add File: notes.md\n+hi\n+there\n" },
          result: "patched",
        }),
        call({
          id: "denied",
          name: "file_write",
          arguments: { path: "/workspace/secret.ts", content: "nope\n" },
          approval: "denied",
        }),
        call({
          id: "failed",
          name: "file_write",
          arguments: { path: "/workspace/broken.ts", content: "x\n" },
          error: "EACCES",
        }),
      ]),
    ]);
    expect(changes).toEqual([{ path: "notes.md", additions: 2, deletions: 0 }]);
  });

  it("counts Cursor CLI strReplace edits mapped to apply_patch", () => {
    const changes = workspaceChangesFromMessages([
      message([
        call({
          name: "apply_patch",
          arguments: {
            path: "/workspace/src/app.ts",
            strReplace: { oldText: "old\n", newText: "new\nextra\n" },
          },
          result: "ok",
        }),
      ]),
    ]);
    expect(changes).toEqual([{ path: "src/app.ts", additions: 2, deletions: 1 }]);
  });
});

describe("mergeWorkspaceChanges", () => {
  it("lets git stats replace tool stats for the same path", () => {
    const merged = mergeWorkspaceChanges(
      [{ path: "src/app.ts", additions: 10, deletions: 2 }],
      [
        { path: "src/app.ts", additions: 3, deletions: 1 },
        { path: "README.md", additions: 4, deletions: 0 },
      ],
    );
    expect(merged).toEqual([
      { path: "README.md", additions: 4, deletions: 0 },
      { path: "src/app.ts", additions: 3, deletions: 1 },
    ]);
    expect(sumWorkspaceChanges(merged)).toEqual({ additions: 7, deletions: 1 });
  });
});

describe("markdown path and hunk revert", () => {
  it("detects markdown files", () => {
    expect(isWorkspaceMarkdownPath("README.md")).toBe(true);
    expect(isWorkspaceMarkdownPath("notes.markdown")).toBe(true);
    expect(isWorkspaceMarkdownPath("src/app.ts")).toBe(false);
  });

  it("detects svg files", () => {
    expect(isWorkspaceSvgPath("assets/logo.svg")).toBe(true);
    expect(isWorkspaceSvgPath("icon.SVG")).toBe(true);
    expect(isWorkspaceSvgPath("src/app.ts")).toBe(false);
    expect(isWorkspaceBinaryPreviewPath("assets/logo.svg")).toBe(false);
  });

  it("reverts one change hunk and keeps the rest", () => {
    const baseline = "a\nb\nc\n";
    const current = "a\nB\nc\nD\n";
    const rows = lineDiff(baseline, current);
    expect(changeHunkCount(rows)).toBe(2);
    expect(revertNthChangeHunk(baseline, current, 0)).toBe("a\nb\nc\nD\n");
  });
});
