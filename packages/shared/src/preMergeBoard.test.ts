import { describe, expect, it } from "vitest";
import { buildPreMergeBoard, preMergeAttention } from "./preMergeBoard.js";
import type { ChangeStack } from "./changeStack.js";

const stack: ChangeStack = {
  repoId: "r1",
  number: 1,
  headSha: "abc",
  generatedAt: "2020-01-01T00:00:00.000Z",
  source: "heuristic",
  cohorts: [
    {
      id: "c1",
      title: "Code",
      summary: "",
      layers: [
        {
          id: "c1-l1",
          title: "Code",
          intent: "",
          fileCount: 1,
          commentCount: 0,
          ranges: [],
        },
      ],
    },
  ],
  files: [{ path: "src/app.ts", cohortId: "c1", layerId: "c1-l1" }],
  markdown: "",
};

describe("buildPreMergeBoard", () => {
  it("collects failing checks, open comments, conflicts, and high-risk files", () => {
    const board = buildPreMergeBoard({
      checks: [
        { name: "ci", status: "failure" },
        { name: "lint", status: "success" },
      ],
      comments: [
        {
          id: "sum",
          body: "### Review PR\nlooks fine",
          author: "bot",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        {
          id: "c1",
          body: "nit: rename",
          author: "sam",
          path: "src/app.ts",
          line: 4,
          side: "RIGHT",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
      files: [
        {
          path: "src/app.ts",
          patch: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n",
        },
      ],
      loadPath: {
        risk: "high",
        reasons: [],
        headline: "",
        changeKinds: ["auth"],
        layers: ["permissions"],
        nodes: [],
        traces: [],
        hops: [],
        untestedSinks: [{ path: "src/app.ts", layer: "permissions", kind: "auth" }],
        readOrder: [],
        markdown: "",
      },
      stack,
    });
    expect(board.failingChecks.map((row) => row.title)).toEqual(["ci"]);
    expect(board.openComments).toHaveLength(1);
    expect(board.openComments[0]?.layerId).toBe("c1-l1");
    expect(board.conflicts[0]?.layerId).toBe("c1-l1");
    expect(board.highRiskFiles[0]?.detail).toMatch(/Untested permissions/);
    expect(preMergeAttention(board)).toBe(4);
  });
});
