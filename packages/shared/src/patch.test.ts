import { describe, expect, it } from "vitest";
import { applyUnifiedDiff, parseUnifiedDiff, resolvePatchPath } from "./patch.js";

describe("applyUnifiedDiff", () => {
  it("updates, adds, and deletes files from a git unified diff", () => {
    const files = new Map([
      ["/home/locus/workspace/a.ts", "one\ntwo\nthree\n"],
      ["/home/locus/workspace/gone.ts", "bye\n"],
    ]);
    const patch = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,2 @@",
      "+hello",
      "+world",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n");
    const result = applyUnifiedDiff(files, patch, "/home/locus/workspace");
    expect(result.files.get("/home/locus/workspace/a.ts")).toBe("one\nTWO\nthree\n");
    expect(result.files.get("/home/locus/workspace/new.ts")).toBe("hello\nworld\n");
    expect(result.files.has("/home/locus/workspace/gone.ts")).toBe(false);
    expect(result.output).toMatch(/updated/);
    expect(result.output).toMatch(/added/);
    expect(result.output).toMatch(/deleted/);
  });

  it("applies a *** Begin Patch update and finds a hunk that drifted", () => {
    const files = new Map([["/ws/app.ts", "keep\nalpha\nbeta\n"]]);
    const patch = [
      "*** Begin Patch",
      "*** Update File: app.ts",
      "@@ -10,2 +10,2 @@",
      "-alpha",
      "+ALPHA",
      " beta",
      "*** End Patch",
    ].join("\n");
    const result = applyUnifiedDiff(files, patch, "/ws");
    expect(result.files.get("/ws/app.ts")).toBe("keep\nALPHA\nbeta\n");
  });

  it("parses *** Add File without an @@ header", () => {
    const files = parseUnifiedDiff("*** Add File: notes.md\n+hi\n+there\n");
    expect(files).toEqual([
      {
        path: "notes.md",
        kind: "add",
        hunks: [
          {
            oldStart: 1,
            newStart: 1,
            oldLines: [],
            newLines: ["hi", "there"],
            rows: [
              { kind: "add", text: "hi" },
              { kind: "add", text: "there" },
            ],
          },
        ],
      },
    ]);
  });

  it("applies *** Begin Patch hunks that use @@ without line numbers", () => {
    const files = new Map([
      [
        "/workspace/index.html",
        [
          '      <span class="count" id="count"></span>',
          '      <button data-filter="all" aria-pressed="true">All</button>',
          '      <button data-filter="active" aria-pressed="false">Open</button>',
          '      <button data-filter="done" aria-pressed="false">Done</button>',
        ].join("\n"),
      ],
    ]);
    const patch = [
      "*** Begin Patch",
      "*** Update File: /workspace/index.html",
      "@@",
      '-      <button data-filter="active" aria-pressed="false">Open</button>',
      '+      <button data-filter="active" aria-pressed="false">Active</button>',
      "*** End Patch",
    ].join("\n");
    const result = applyUnifiedDiff(files, patch, "/workspace");
    expect(result.files.get("/workspace/index.html")).toContain(">Active</button>");
    expect(result.files.get("/workspace/index.html")).not.toContain(">Open</button>");
  });

  it("applies a unified diff with bare @@ hunks and *** path cwd", () => {
    const files = new Map([
      [
        "/workspace/index.html",
        "if(!Array.isArray(todos)) todos=[];\nfunction setFilter(f){\n  filter=f;\n}\n",
      ],
    ]);
    const patch = [
      "--- a/index.html",
      "+++ b/index.html",
      "@@",
      "-if(!Array.isArray(todos)) todos=[];",
      "+if(!Array.isArray(todos)) todos=[];",
      '+try{ filter=localStorage.getItem(KEY+".filter")||filter; }catch(e){}',
      "@@",
      " function setFilter(f){",
      "   filter=f;",
      '+  try{ localStorage.setItem(KEY+".filter",f); }catch(e){}',
      "*** path: /workspace",
    ].join("\n");
    const result = applyUnifiedDiff(files, patch, "/workspace");
    expect(result.files.get("/workspace/index.html")).toContain('KEY+".filter"');
    expect(result.files.get("/workspace/index.html")).toContain("localStorage.setItem");
  });

  it("rejects a hunk that does not match", () => {
    const files = new Map([["/ws/a.ts", "only\n"]]);
    expect(() =>
      applyUnifiedDiff(files, "--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-missing\n+x\n", "/ws"),
    ).toThrow(/did not apply in \/ws\/a\.ts \(old line 1\): missing/);
  });

  it("appends leftover context after a matching EOF prefix", () => {
    const files = new Map([
      ["/workspace/index.html", "function findPath(from, to) {\n  return smoothPath(pts);\n}\n"],
    ]);
    const patch = [
      "*** Begin Patch",
      "*** Update File: index.html",
      "@@",
      " function findPath(from, to) {",
      "   return smoothPath(pts);",
      " }",
      " function lineBlocked(a, b, pad = 0.5) {",
      "+  return false;",
      "+}",
      "*** End Patch",
    ].join("\n");
    const result = applyUnifiedDiff(files, patch, "/workspace");
    expect(result.files.get("/workspace/index.html")).toContain("function lineBlocked");
    expect(result.files.get("/workspace/index.html")).toContain("return false;");
    expect(result.files.get("/workspace/index.html")).toContain("return smoothPath(pts);");
  });
});

describe("resolvePatchPath", () => {
  it("joins relative paths onto the workspace", () => {
    expect(resolvePatchPath("/home/locus/workspace", "src/a.ts")).toBe(
      "/home/locus/workspace/src/a.ts",
    );
    expect(resolvePatchPath("C:\\Users\\locus\\workspace", "a.ts")).toBe(
      "C:\\Users\\locus\\workspace\\a.ts",
    );
    expect(resolvePatchPath("/ws", "/abs/a.ts")).toBe("/abs/a.ts");
  });
});

describe("normalizePatchCwd", () => {
  it("treats a file path as its parent directory", async () => {
    const { normalizePatchCwd } = await import("./patch.js");
    expect(normalizePatchCwd("/workspace/index.html", "/workspace")).toBe("/workspace");
    expect(normalizePatchCwd("/workspace", "/workspace")).toBe("/workspace");
    expect(
      normalizePatchCwd("C:\\Users\\locus\\workspace\\app.ts", "C:\\Users\\locus\\workspace"),
    ).toBe("C:\\Users\\locus\\workspace");
    expect(normalizePatchCwd("/workspace/src", "/workspace")).toBe("/workspace/src");
    expect(normalizePatchCwd("/workspace/notes.md", "/fallback", () => true)).toBe("/workspace");
    expect(normalizePatchCwd("/home/locus/workspace/Makefile", "/home/locus/workspace")).toBe(
      "/home/locus/workspace/Makefile",
    );
    expect(
      normalizePatchCwd(
        "/home/locus/workspace/Makefile",
        "/home/locus/workspace",
        (p) => p === "/home/locus/workspace/Makefile",
      ),
    ).toBe("/home/locus/workspace");
    expect(
      normalizePatchCwd("/workspace/LICENSE", "/workspace", (p) => p.endsWith("LICENSE")),
    ).toBe("/workspace");
  });
});

describe("patchTextFromTool", () => {
  it("reads apply_patch arguments and git_diff results", async () => {
    const { parseUnifiedDiff, patchTextFromTool } = await import("./patch.js");
    const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n";
    expect(patchTextFromTool("apply_patch", { patch })).toBe(patch);
    expect(patchTextFromTool("git_diff", {}, patch)).toBe(patch);
    expect(patchTextFromTool("git_push", {}, patch)).toBe(patch);
    expect(patchTextFromTool("exec", { command: "ls" }, "ok")).toBeUndefined();
    expect(parseUnifiedDiff(patch)[0]?.hunks[0]?.rows).toEqual([
      { kind: "del", text: "old" },
      { kind: "add", text: "new" },
    ]);
    expect(parseUnifiedDiff(patch)[0]?.hunks[0]?.newStart).toBe(1);
  });

  it("recovers Cursor CLI editToolCall shapes onto patch files", async () => {
    const { patchFilesFromTool, patchTextFromTool } = await import("./patch.js");
    const hunk = "@@ -1,3 +1,3 @@\n keep\n-old\n+new\n keep";
    const fromApplyPatch = patchFilesFromTool("apply_patch", {
      path: "src/app.ts",
      applyPatch: { patchContent: hunk },
    });
    expect(fromApplyPatch[0]).toMatchObject({ path: "src/app.ts", kind: "update" });
    expect(fromApplyPatch[0]?.hunks[0]?.rows).toEqual([
      { kind: "ctx", text: "keep" },
      { kind: "del", text: "old" },
      { kind: "add", text: "new" },
      { kind: "ctx", text: "keep" },
    ]);

    const fromReplace = patchFilesFromTool("apply_patch", {
      path: "src/app.ts",
      strReplace: { oldText: "old\nline", newText: "new\nline" },
    });
    expect(fromReplace[0]?.path).toBe("src/app.ts");
    expect(fromReplace[0]?.hunks[0]?.rows).toEqual([
      { kind: "del", text: "old" },
      { kind: "del", text: "line" },
      { kind: "add", text: "new" },
      { kind: "add", text: "line" },
    ]);

    const fromMulti = patchFilesFromTool("apply_patch", {
      path: "src/app.ts",
      multiStrReplace: {
        edits: [
          { oldText: "foo", newText: "bar" },
          { oldText: "baz", newText: "qux" },
        ],
      },
    });
    expect(fromMulti[0]?.hunks).toHaveLength(2);

    const fromStream = patchFilesFromTool("apply_patch", {
      path: "/workspace/notes.md",
      streamContent: "hello\nworld\n",
    });
    expect(fromStream[0]).toMatchObject({ path: "/workspace/notes.md", kind: "add" });
    expect(fromStream[0]?.hunks[0]?.rows).toEqual([
      { kind: "add", text: "hello" },
      { kind: "add", text: "world" },
    ]);

    expect(
      patchTextFromTool("file_write", { path: "README.md", fileText: "# app" }),
    ).toBeUndefined();
    expect(
      patchFilesFromTool("file_write", {
        path: "README.md",
        fileText: "# app",
        patch: "*** Add File: README.md\n+# app",
      })[0]?.path,
    ).toBe("README.md");
    expect(
      patchTextFromTool("apply_patch", {
        path: "src/app.ts",
        old_string:
          "…[already applied, 4000 chars. file_read the file if you need the current contents]",
        new_string: "nope",
      }),
    ).toBeUndefined();
  });
});

describe("diff helpers", () => {
  it("parses GitHub-style file patches and numbers lines", async () => {
    const { parseFilePatch, enumerateDiffRows, diffStats, hunkHeader } = await import("./patch.js");
    const file = parseFilePatch("src/app.ts", "@@ -10,3 +10,3 @@\n keep\n-old\n+new\n keep");
    expect(file.path).toBe("src/app.ts");
    expect(file.kind).toBe("update");
    expect(file.hunks[0]?.oldStart).toBe(10);
    expect(file.hunks[0]?.newStart).toBe(10);
    expect(hunkHeader(file.hunks[0]!)).toBe("@@ -10,3 +10,3 @@");
    expect(enumerateDiffRows(file.hunks[0]!)).toEqual([
      { kind: "ctx", text: "keep", oldLine: 10, newLine: 10 },
      { kind: "del", text: "old", oldLine: 11 },
      { kind: "add", text: "new", newLine: 11 },
      { kind: "ctx", text: "keep", oldLine: 12, newLine: 12 },
    ]);
    expect(diffStats([file])).toEqual({ additions: 1, deletions: 1 });
  });

  it("keeps status when a pull file has no patch text", async () => {
    const { parseFilePatch } = await import("./patch.js");
    expect(parseFilePatch("gone.ts", undefined, "delete")).toEqual({
      path: "gone.ts",
      kind: "delete",
      hunks: [],
    });
  });
});
