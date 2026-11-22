import { describe, expect, it } from "vitest";
import type { AgentSession, ChatMessage, ToolCall } from "@locus/shared";
import {
  formatTurnDuration,
  isTestCommand,
  latestTurnOutcome,
  turnOutcomeHeadline,
  turnTestsLabel,
  worktreeMergeParent,
} from "./turnOutcome";

const at = "2026-11-12T10:00:00.000Z";

function call(
  id: string,
  name: string,
  args: Record<string, unknown>,
  extra: Partial<ToolCall> = {},
): ToolCall {
  return { id, name, arguments: args, startedAt: at, finishedAt: at, result: "ok", ...extra };
}

function msg(
  id: string,
  role: ChatMessage["role"],
  content = "",
  toolCalls?: ToolCall[],
): ChatMessage {
  return { id, role, content, createdAt: at, toolCalls } as ChatMessage;
}

const PATCH = [
  "--- a/src/add.ts",
  "+++ b/src/add.ts",
  "@@ -1,1 +1,1 @@",
  "-export const add = (a, b) => a - b;",
  "+export const add = (a, b) => a + b;",
].join("\n");

function session(messages: ChatMessage[], extra: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Fix add",
    status: "idle",
    messages,
    createdAt: at,
    updatedAt: at,
    ...extra,
  } as AgentSession;
}

describe("isTestCommand", () => {
  it("recognises common test runners", () => {
    for (const cmd of [
      "npm test",
      "npm run test",
      "pnpm test:unit",
      "npx vitest run src",
      "pytest -q",
      "go test ./...",
      "cargo test",
      "./gradlew test",
      "make check",
    ]) {
      expect(isTestCommand(cmd), cmd).toBe(true);
    }
  });

  it("ignores non-test commands", () => {
    for (const cmd of ["ls -la", "npm install", "git status", "cat test.txt"]) {
      expect(isTestCommand(cmd), cmd).toBe(false);
    }
  });
});

describe("latestTurnOutcome", () => {
  const turn = [
    msg("u1", "user", "fix add"),
    msg("a1", "assistant", "", [
      call("c1", "apply_patch", { patch: PATCH }),
      call("c2", "exec", { command: "npm test" }, { result: "1 failed (exit 1)" }),
      call("c3", "exec", { command: "npm test" }, { result: "all passed (exit 0)" }),
      call("c4", "exec", { command: "ls" }),
    ]),
    msg("a2", "assistant", "Fixed the sign in add()."),
  ];

  it("summarises files, commands, tests and the undo checkpoint", () => {
    const outcome = latestTurnOutcome(
      session(turn, {
        checkpoints: [{ id: "cp0", messageCount: 0, createdAt: at }],
      }),
    );
    expect(outcome).toBeDefined();
    expect(outcome!.assistantId).toBe("a2");
    expect(outcome!.files.map((f) => f.path)).toEqual(["src/add.ts"]);
    expect(outcome!.patches).toHaveLength(1);
    expect(outcome!.commands).toBe(3);
    expect(outcome!.tests).toEqual([
      { command: "npm test", passed: false },
      { command: "npm test", passed: true },
    ]);
    expect(outcome!.undoCheckpointId).toBe("cp0");
    expect(turnOutcomeHeadline(outcome!)).toBe("1 file changed · +1 −1");
    // The re-run after the fix is what counts.
    expect(turnTestsLabel(outcome!.tests)).toEqual({ text: "Tests passed", ok: true });
  });

  it("sums token usage over the turn and measures wall time", () => {
    const user = { ...msg("u1", "user", "fix add"), createdAt: "2026-11-12T10:00:00.000Z" };
    const a1 = {
      ...msg("a1", "assistant", "", [
        call("c1", "apply_patch", { patch: PATCH }, { finishedAt: "2026-11-12T10:01:10.000Z" }),
      ]),
      createdAt: "2026-11-12T10:00:05.000Z",
      usage: { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 400 },
    };
    const a2 = {
      ...msg("a2", "assistant", "Done."),
      createdAt: "2026-11-12T10:01:05.000Z",
      usage: { inputTokens: 1200, outputTokens: 30 },
    };
    const outcome = latestTurnOutcome(session([user, a1, a2]));
    expect(outcome!.usage).toEqual({
      inputTokens: 2200,
      outputTokens: 80,
      cachedInputTokens: 400,
    });
    expect(outcome!.durationMs).toBe(70_000);
    expect(formatTurnDuration(outcome!.durationMs)).toBe("1m 10s");
  });

  it("counts each call once when tool-result messages repeat it", () => {
    const patch = call("p1", "apply_patch", { patch: PATCH });
    const test = call("t1", "exec", { command: "npm test" }, { result: "ok (exit 0)" });
    const outcome = latestTurnOutcome(
      session([
        msg("u1", "user", "fix"),
        msg("a1", "assistant", "", [patch]),
        { ...msg("r1", "tool", "updated", [patch]), toolCallId: "p1" },
        msg("a2", "assistant", "", [test]),
        { ...msg("r2", "tool", "ok", [test]), toolCallId: "t1" },
        msg("a3", "assistant", "Done."),
      ]),
    );
    expect(outcome!.commands).toBe(1);
    expect(outcome!.tests).toHaveLength(1);
    expect(outcome!.patches).toHaveLength(1);
    expect(turnOutcomeHeadline(outcome!)).toBe("1 file changed · +1 −1");
  });

  it("leaves usage and time out when the turn has none", () => {
    const outcome = latestTurnOutcome(session(turn));
    expect(outcome!.usage).toBeUndefined();
    expect(outcome!.durationMs).toBeUndefined();
  });

  it("only offers undo for the checkpoint taken right before this turn", () => {
    const outcome = latestTurnOutcome(
      session(turn, { checkpoints: [{ id: "old", messageCount: 5, createdAt: at }] }),
    );
    expect(outcome!.undoCheckpointId).toBeUndefined();
  });

  it("stays hidden while the turn runs or waits on approval", () => {
    expect(latestTurnOutcome(session(turn, { status: "running" }))).toBeUndefined();
    const waiting = [
      msg("u1", "user", "push it"),
      msg("a1", "assistant", "", [
        { id: "c9", name: "git_push", arguments: {}, startedAt: at, approval: "needed" },
      ]),
    ];
    expect(latestTurnOutcome(session(waiting))).toBeUndefined();
  });

  it("stays hidden for a turn that only talked", () => {
    expect(
      latestTurnOutcome(session([msg("u1", "user", "hi"), msg("a1", "assistant", "Hello!")])),
    ).toBeUndefined();
  });

  it("picks up a PR link", () => {
    const outcome = latestTurnOutcome(
      session([
        msg("u1", "user", "open a pr"),
        msg("a1", "assistant", "", [
          call("p1", "git_pr", {}, { result: "Opened https://github.com/acme/app/pull/12" }),
        ]),
      ]),
    );
    expect(outcome?.prUrl).toBe("https://github.com/acme/app/pull/12");
  });
});

describe("turnTestsLabel", () => {
  it("reports failures across distinct commands", () => {
    expect(
      turnTestsLabel([
        { command: "npm test", passed: true },
        { command: "pytest", passed: false },
      ]),
    ).toEqual({ text: "1 of 2 test runs failed", ok: false });
    expect(turnTestsLabel([])).toBeUndefined();
  });
});

describe("formatTurnDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatTurnDuration(undefined)).toBeUndefined();
    expect(formatTurnDuration(400)).toBeUndefined();
    expect(formatTurnDuration(42_000)).toBe("42s");
    expect(formatTurnDuration(185_000)).toBe("3m 05s");
    expect(formatTurnDuration(3_720_000)).toBe("1h 02m");
  });
});

describe("worktreeMergeParent", () => {
  const worktree = { path: "/w", branch: "locus/a", source: "/s", baseSha: "abc" } as never;
  it("returns the parent of a worktree worker", () => {
    expect(
      worktreeMergeParent({
        worktree,
        compare: { groupId: "g", kind: "workers", role: "2", parentId: "p1" },
      }),
    ).toBe("p1");
  });
  it("is undefined for the parent, model compares, and agents without a worktree", () => {
    expect(
      worktreeMergeParent({ worktree, compare: { groupId: "g", kind: "workers", role: "parent" } }),
    ).toBeUndefined();
    expect(
      worktreeMergeParent({ worktree, compare: { groupId: "g", role: "b", parentId: "p1" } }),
    ).toBeUndefined();
    expect(
      worktreeMergeParent({
        compare: { groupId: "g", kind: "workers", role: "1", parentId: "p1" },
      }),
    ).toBeUndefined();
  });
});

describe("turn verdict", () => {
  it("carries a review verdict with its risk into the turn summary", () => {
    const outcome = latestTurnOutcome(
      session([
        msg("u1", "user", "review #12"),
        msg(
          "a1",
          "assistant",
          'Looks risky. {"verdict":"PASS","reasons":["auth change"],"risk":"high"}',
        ),
      ]),
    );
    expect(outcome?.verdict).toEqual({ verdict: "PASS", reasons: ["auth change"], risk: "high" });
    expect(turnOutcomeHeadline(outcome!)).toBe("Review");
  });
});
