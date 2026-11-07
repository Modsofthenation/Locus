import { afterEach, describe, expect, it } from "vitest";
import {
  consumeWorkspaceOpenPr,
  firstHunkLine,
  prCommentMarks,
  requestWorkspaceOpenPr,
} from "./workspaceOpenPr";

describe("firstHunkLine", () => {
  it("reads the first new-file line from a unified hunk header", () => {
    expect(firstHunkLine("@@ -1,2 +10,4 @@\n keep")).toBe(10);
    expect(firstHunkLine("@@ -3 +1 @@")).toBe(1);
    expect(firstHunkLine("no hunk")).toBeUndefined();
    expect(firstHunkLine()).toBeUndefined();
  });
});

describe("prCommentMarks", () => {
  it("keeps review comments that have a path and line", () => {
    expect(
      prCommentMarks([
        { body: "nit", path: "src/app.ts", line: 2, author: "sam", side: "LEFT" },
        { body: "ok", path: "src/app.ts", line: 4, author: "sam", side: "RIGHT" },
        { body: "thread" },
        { body: "missing line", path: "src/app.ts" },
      ]),
    ).toEqual([{ path: "src/app.ts", line: 4, body: "ok", author: "sam", side: "RIGHT" }]);
  });
});

describe("requestWorkspaceOpenPr", () => {
  afterEach(() => {
    consumeWorkspaceOpenPr("s1");
    consumeWorkspaceOpenPr("s2");
  });

  it("keeps a pending payload until the IDE session consumes it", () => {
    const seen: unknown[] = [];
    const onOpen = (event: Event) => {
      seen.push((event as CustomEvent).detail);
    };
    window.addEventListener("locus:workspace-open-pr", onOpen);
    const detail = {
      sessionId: "s1",
      files: ["src/app.ts"],
      comments: [],
      focus: { path: "src/app.ts", line: 4 },
    };
    requestWorkspaceOpenPr(detail);
    expect(seen).toEqual([detail]);
    expect(consumeWorkspaceOpenPr("s2")).toBeNull();
    expect(consumeWorkspaceOpenPr("s1")).toEqual(detail);
    expect(consumeWorkspaceOpenPr("s1")).toBeNull();
    window.removeEventListener("locus:workspace-open-pr", onOpen);
  });
});
