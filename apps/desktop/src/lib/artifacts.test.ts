import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@locus/shared";
import {
  artifactSummary,
  countChangedFiles,
  filesChangedLabel,
  sessionArtifacts,
  turnDiffByAssistantId,
  turnDiffCheckpoints,
} from "./artifacts";

const patch = [
  "diff --git a/a.ts b/a.ts",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
].join("\n");

describe("sessionArtifacts", () => {
  it("collects shots, recordings, patches, and PR links", () => {
    const messages: ChatMessage[] = [
      {
        id: "t1",
        role: "tool",
        content: "clicked",
        createdAt: "2020-01-01T00:00:00.000Z",
        screenshotName: "t1.png",
        toolCalls: [
          { id: "c1", name: "screenshot", arguments: {}, startedAt: "2020-01-01T00:00:00.000Z" },
        ],
      },
      {
        id: "t2",
        role: "tool",
        content: "saved",
        createdAt: "2020-01-01T00:00:01.000Z",
        recordingName: "walk.mp4",
        toolCalls: [
          { id: "c2", name: "record_screen", arguments: {}, startedAt: "2020-01-01T00:00:01.000Z" },
        ],
      },
      {
        id: "t5",
        role: "tool",
        content: "pdf saved",
        createdAt: "2020-01-01T00:00:01.500Z",
        artifactName: "page.pdf",
        artifactKind: "pdf",
      },
      {
        id: "t3",
        role: "tool",
        content: "patched",
        createdAt: "2020-01-01T00:00:02.000Z",
        toolCalls: [
          {
            id: "c3",
            name: "apply_patch",
            arguments: { patch },
            result: "ok",
            startedAt: "2020-01-01T00:00:02.000Z",
          },
        ],
      },
      {
        id: "t4",
        role: "tool",
        content: JSON.stringify({ html_url: "https://github.com/a/b/pull/3" }),
        createdAt: "2020-01-01T00:00:03.000Z",
        toolCalls: [
          {
            id: "c4",
            name: "git_pr",
            arguments: { title: "Fix" },
            startedAt: "2020-01-01T00:00:03.000Z",
          },
        ],
      },
    ];
    const items = sessionArtifacts(messages);
    expect(items.map((i) => i.kind)).toEqual(["screenshot", "recording", "pdf", "patch", "pr"]);
    expect(artifactSummary(items)).toBe("1 shot · 1 recording · 1 PDF · 1 patch · 1 PR");
    expect(
      items.find((i) => i.kind === "pr")?.kind === "pr" && items.find((i) => i.kind === "pr"),
    ).toMatchObject({
      url: "https://github.com/a/b/pull/3",
    });
  });

  it("is empty when the thread has no media", () => {
    expect(
      sessionArtifacts([
        { id: "u", role: "user", content: "hi", createdAt: "2020-01-01T00:00:00.000Z" },
      ]),
    ).toEqual([]);
    expect(artifactSummary([])).toBe("No artifacts");
  });
});

describe("turn diffs", () => {
  it("counts files from git --stat and unified paths", () => {
    expect(countChangedFiles(" 3 files changed, 3 insertions(+)\n")).toBe(3);
    expect(countChangedFiles(" 1 file changed, 1 insertion(+)\n")).toBe(1);
    expect(countChangedFiles("diff --git a/a.ts b/a.ts\ndiff --git a/b.ts b/b.ts\n")).toBe(2);
    expect(filesChangedLabel(0)).toBe("Files changed");
    expect(filesChangedLabel(1)).toBe("1 file changed");
    expect(filesChangedLabel(3)).toBe("3 files changed");
  });

  it("maps a paired git checkpoint onto the assistant turn", () => {
    const session = {
      messages: [
        { id: "u1", role: "user" as const, content: "hi", createdAt: "t0" },
        { id: "a1", role: "assistant" as const, content: "hello", createdAt: "t1" },
        { id: "u2", role: "user" as const, content: "edit", createdAt: "t2" },
        {
          id: "a2",
          role: "assistant" as const,
          content: "done",
          createdAt: "t3",
          toolCalls: [
            {
              id: "w1",
              name: "file_write",
              arguments: { path: "/workspace/a.ts", content: "a" },
              result: "ok",
              startedAt: "t3",
              finishedAt: "t3",
            },
            {
              id: "w2",
              name: "file_write",
              arguments: { path: "/workspace/b.ts", content: "b" },
              result: "ok",
              startedAt: "t3",
              finishedAt: "t3",
            },
            {
              id: "w3",
              name: "file_write",
              arguments: { path: "/workspace/c.ts", content: "c" },
              result: "ok",
              startedAt: "t3",
              finishedAt: "t3",
            },
          ],
        },
      ],
      checkpoints: [
        { id: "cp0", messageCount: 2, createdAt: "t1", gitRef: "refs/locus/checkpoints/cp0" },
        { id: "cp1", messageCount: 4, createdAt: "t3", gitRef: "refs/locus/checkpoints/cp1" },
      ],
    };
    expect(turnDiffCheckpoints(session).map((row) => row.id)).toEqual(["cp1"]);
    expect(turnDiffByAssistantId(session).get("a2")).toEqual({
      checkpointId: "cp1",
      fileCount: 3,
      path: "a.ts",
      line: 1,
    });
    expect(turnDiffByAssistantId(session).has("a1")).toBe(false);
  });

  it("does not crash when a git turn has tools but no workspace file path", () => {
    // Both follow and changed[0] are missing → `undefined === undefined` must not
    // enter the branch that reads follow.line (UI crash: reading 'line' of undefined).
    const session = {
      messages: [
        { id: "u1", role: "user" as const, content: "hi", createdAt: "t0" },
        { id: "a1", role: "assistant" as const, content: "hello", createdAt: "t1" },
        { id: "u2", role: "user" as const, content: "run ls", createdAt: "t2" },
        {
          id: "a2",
          role: "assistant" as const,
          content: "done",
          createdAt: "t3",
          toolCalls: [
            {
              id: "c1",
              name: "exec",
              arguments: { command: "ls" },
              result: "ok",
              startedAt: "t3",
              finishedAt: "t3",
            },
          ],
        },
      ],
      checkpoints: [
        { id: "cp0", messageCount: 2, createdAt: "t1", gitRef: "refs/locus/checkpoints/cp0" },
        { id: "cp1", messageCount: 4, createdAt: "t3", gitRef: "refs/locus/checkpoints/cp1" },
      ],
    };
    expect(() => turnDiffByAssistantId(session)).not.toThrow();
    expect(turnDiffByAssistantId(session).get("a2")).toEqual({
      checkpointId: "cp1",
      fileCount: 0,
      path: undefined,
      line: undefined,
    });
  });
});
