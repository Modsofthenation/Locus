import { describe, expect, it } from "vitest";
import {
  formatFileComment,
  isWorkspaceWriteTool,
  offsetsToLines,
  workspaceFollowFromTool,
  workspaceRelativePath,
} from "./workspaceFollow.js";

describe("workspace follow", () => {
  it("strips the guest workspace prefix", () => {
    expect(workspaceRelativePath("/workspace/src/app.ts")).toBe("src/app.ts");
    expect(workspaceRelativePath("src/app.ts")).toBe("src/app.ts");
    expect(workspaceRelativePath("/home/me/.locus/host-workspaces/ee26bc7e/src/app.ts")).toBe(
      "src/app.ts",
    );
  });

  it("follows file_write to the written path", () => {
    expect(
      workspaceFollowFromTool("file_write", { path: "/workspace/src/auth.ts", content: "x" }),
    ).toEqual({ path: "src/auth.ts", line: 1 });
    expect(
      workspaceFollowFromTool("Write", {
        file_path: "/home/me/.locus/host-workspaces/ee26bc7e/src/auth.ts",
        content: "x",
      }),
    ).toEqual({ path: "src/auth.ts", line: 1 });
    expect(
      workspaceFollowFromTool(
        "file_write",
        { path: "/tmp/project/src/auth.ts", content: "x" },
        undefined,
        "/tmp/project",
      ),
    ).toEqual({ path: "src/auth.ts", line: 1 });
    expect(isWorkspaceWriteTool("file_write")).toBe(true);
    expect(isWorkspaceWriteTool("Write")).toBe(true);
    expect(isWorkspaceWriteTool("grep")).toBe(false);
  });

  it("follows apply_patch to the first hunk", () => {
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -10,3 +10,3 @@",
      " keep",
      "-old",
      "+new",
      " keep",
    ].join("\n");
    expect(workspaceFollowFromTool("apply_patch", { patch })).toEqual({
      path: "src/app.ts",
      line: 10,
    });
  });

  it("ignores tools that do not touch files", () => {
    expect(workspaceFollowFromTool("exec", { command: "ls" })).toBeUndefined();
  });

  it("pins a file comment with an untrusted fence", () => {
    const note = formatFileComment({
      path: "/workspace/src/auth.ts",
      startLine: 40,
      endLine: 42,
      text: "if (!token) return 401;",
    });
    expect(note).toMatch(/^On src\/auth\.ts:40-42: /);
    expect(note).toContain('kind="operator-notes"');
    expect(note).toContain("if (!token) return 401;");
  });

  it("maps textarea offsets to line numbers", () => {
    expect(offsetsToLines("a\nb\nc\n", 2, 4)).toEqual({
      startLine: 2,
      endLine: 3,
      text: "b\n",
    });
  });
});
