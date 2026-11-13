import { describe, expect, it } from "vitest";
import type { AgentSession, ChatMessage, ToolCall } from "@locus/shared";
import {
  isTestCommand,
  latestTurnOutcome,
  turnOutcomeHeadline,
  turnTestsLabel,
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
