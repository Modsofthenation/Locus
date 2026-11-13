import { describe, expect, it } from "vitest";
import type { AgentSession, ChatMessage, ToolCall } from "@locus/shared";
import {
  approvalPreview,
  approvalRisk,
  pendingActionLabel,
  sameToolRows,
  stepInboxFocus,
} from "./inboxDecision";
import { buildInboxRows } from "./inboxList";

const at = "2026-11-12T10:00:00.000Z";

function pending(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, name, arguments: args, startedAt: at, approval: "needed" };
}

function session(
  id: string,
  messages: ChatMessage[],
  extra: Partial<AgentSession> = {},
): AgentSession {
  return {
    id,
    title: `Chat ${id}`,
    status: "idle",
    messages,
    createdAt: at,
    updatedAt: at,
    ...extra,
  } as AgentSession;
}

const execSession = session(
  "s1",
  [
    { id: "u", role: "user", content: "run the tests", createdAt: at },
    {
      id: "a",
      role: "assistant",
      content: "I'll run the unit tests to confirm the fix.",
      createdAt: at,
      toolCalls: [pending("c1", "exec", { command: "npm test -- --run" })],
    },
  ] as ChatMessage[],
  { runtime: "host", hostDir: "/home/me/app" },
);

describe("approvalPreview", () => {
  it("shows the command, the agent's reason and where it runs", () => {
    const preview = approvalPreview(execSession, "c1");
    expect(preview).toBeDefined();
    expect(preview!.tool).toBe("exec");
    expect(preview!.command).toBe("npm test -- --run");
    expect(preview!.label.startsWith("Ran")).toBe(false);
    expect(preview!.why).toBe("I'll run the unit tests to confirm the fix.");
    expect(preview!.where).toBe("This machine · /home/me/app");
    expect(preview!.risk).toBe("medium");
    expect(preview!.batchable).toBe(true);
  });

  it("is undefined once the call is decided", () => {
    const done = session("s2", [
      {
        id: "a",
        role: "assistant",
        content: "",
        createdAt: at,
        toolCalls: [{ ...pending("c1", "exec", { command: "ls" }), finishedAt: at }],
      },
    ] as ChatMessage[]);
    expect(approvalPreview(done, "c1")).toBeUndefined();
  });

  it("lists files for a patch", () => {
    const patch = ["--- a/src/x.ts", "+++ b/src/x.ts", "@@ -1 +1 @@", "-a", "+b"].join("\n");
    const s = session(
      "s3",
      [
        {
          id: "a",
          role: "assistant",
          content: "",
          createdAt: at,
          toolCalls: [pending("p1", "apply_patch", { patch })],
        },
      ] as ChatMessage[],
      { runtime: "docker" },
    );
    const preview = approvalPreview(s, "p1");
    expect(preview!.files).toEqual(["src/x.ts"]);
    expect(preview!.where).toBe("Docker container");
    expect(preview!.risk).toBe("low");
  });
});

describe("approvalRisk", () => {
  it("flags destructive commands and outward actions", () => {
    expect(approvalRisk("exec", { command: "rm -rf build" }, "docker").risk).toBe("high");
    expect(approvalRisk("exec", { command: "git push --force origin main" }, "docker").risk).toBe(
      "high",
    );
    expect(approvalRisk("git_pr_merge", {}, "docker").risk).toBe("high");
    expect(approvalRisk("git_push", { branch: "fix" }, "docker").risk).toBe("medium");
    expect(approvalRisk("exec", { command: "ls" }, "docker").risk).toBe("low");
  });
});

describe("sameToolRows / stepInboxFocus", () => {
  const second = session("s4", [
    {
      id: "a",
      role: "assistant",
      content: "",
      createdAt: at,
      toolCalls: [pending("c2", "exec", { command: "npm run lint" })],
    },
  ] as ChatMessage[]);
  const pushSession = session("s5", [
    {
      id: "a",
      role: "assistant",
      content: "",
      createdAt: at,
      toolCalls: [pending("c3", "git_push", { branch: "x" })],
    },
  ] as ChatMessage[]);
  const sessions = [execSession, second, pushSession];
  const rows = buildInboxRows({ sessions });

  it("groups pending approvals of the same tool across chats", () => {
    const same = sameToolRows(rows, sessions, rows[0]!);
    expect(same.map((row) => row.callId)).toEqual(["c1", "c2"]);
  });

  it("steps focus within range", () => {
    expect(stepInboxFocus(rows, null, 1)).toBe(rows[1]!.key);
    expect(stepInboxFocus(rows, rows[2]!.key, 1)).toBe(rows[2]!.key);
    expect(stepInboxFocus(rows, rows[0]!.key, -1)).toBe(rows[0]!.key);
    expect(stepInboxFocus([], null, 1)).toBeNull();
  });
});

describe("pendingActionLabel", () => {
  it("asks in the present tense", () => {
    expect(pendingActionLabel("Ran npm test")).toBe("Run npm test");
    expect(pendingActionLabel("Edited app.ts")).toBe("Edit app.ts");
    expect(pendingActionLabel("Pushed")).toBe("Pushed");
  });
});
