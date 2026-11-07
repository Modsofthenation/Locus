import { describe, expect, it } from "vitest";
import type { AgentSession, ToolCall } from "@locus/shared";
import {
  batchableApprovals,
  isBatchableApproval,
  needsYouCount,
  needsYouHumanItems,
  needsYouItems,
  needsYouKeys,
  needsYouSessions,
  sessionHasNeedsYou,
} from "./needsYou";

const call = (partial: Partial<ToolCall> = {}): ToolCall => ({
  id: "c1",
  name: "git_push",
  arguments: { branch: "main" },
  startedAt: "t",
  approval: "needed",
  ...partial,
});

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Fix checkout",
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "p",
    model: "grok-4",
    status: "idle",
    messages: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("needsYou", () => {
  it("keys pending approvals and needsHuman gates", () => {
    const gated = session({
      needsHuman: "Protected branch main",
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "",
          createdAt: "t",
          toolCalls: [call()],
        },
      ],
    });
    expect(needsYouKeys(gated)).toEqual(["a:c1", "h:s1"]);
    expect(sessionHasNeedsYou(gated)).toBe(true);
    expect(sessionHasNeedsYou(session())).toBe(false);
    expect(sessionHasNeedsYou(session({ archived: true, needsHuman: "x" }))).toBe(false);
  });

  it("lists waiting sessions with tool and human details", () => {
    const rows = needsYouItems([
      session({ archived: true, needsHuman: "skip" }),
      session({
        id: "s2",
        title: "Landing",
        kind: "design",
        needsHuman: "Pick a tone",
      }),
      session({
        id: "s3",
        title: "Ship",
        messages: [
          {
            id: "m1",
            role: "assistant",
            content: "",
            createdAt: "t",
            toolCalls: [call({ name: "git_pr" })],
          },
        ],
      }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(["h:s2", "a:c1"]);
    expect(rows[0]?.detail).toBe("Pick a tone");
    expect(rows[1]?.detail).toBe("git pr");
    expect(
      needsYouSessions([session(), session({ id: "s2", needsHuman: "now" })]).map((row) => row.id),
    ).toEqual(["s2"]);
  });

  it("batches tool approvals and keeps ask_user / human gates out", () => {
    expect(isBatchableApproval("git_push")).toBe(true);
    expect(isBatchableApproval("ask_user")).toBe(false);
    expect(
      batchableApprovals([
        { call: { name: "git_push" } },
        { call: { name: "ask_user" } },
        { call: { name: "git_pr" } },
      ]).map((row) => row.call.name),
    ).toEqual(["git_push", "git_pr"]);
    expect(
      needsYouHumanItems([
        session({
          id: "s2",
          needsHuman: "Protected branch main",
          messages: [
            { id: "m1", role: "assistant", content: "", createdAt: "t", toolCalls: [call()] },
          ],
        }),
      ]).map((row) => row.key),
    ).toEqual(["h:s2"]);
  });

  it("includes unresolved board comments in the inbox", () => {
    const rows = needsYouItems(
      [],
      [
        {
          id: "b1",
          title: "Retro",
          createdAt: "t",
          updatedAt: "t",
          objectCount: 2,
          frameCount: 1,
          pendingComments: [{ id: "c9", objectId: "s1", body: "Name the owner", author: "agent" }],
        },
      ],
    );
    expect(rows).toEqual([
      {
        key: "b:b1:c9",
        boardId: "b1",
        objectId: "s1",
        commentId: "c9",
        title: "Retro",
        detail: "Name the owner",
      },
    ]);
    expect(
      needsYouCount(
        [],
        [
          {
            id: "b1",
            title: "Retro",
            createdAt: "t",
            updatedAt: "t",
            objectCount: 2,
            frameCount: 1,
            pendingComments: [
              { id: "c9", objectId: "s1", body: "Name the owner", author: "agent" },
            ],
          },
        ],
      ),
    ).toBe(1);
  });

  it("includes open brain corrections in the inbox", () => {
    const rows = needsYouItems([], [], { inboxCount: 2 });
    expect(rows).toEqual([
      {
        key: "brain:inbox",
        section: "brain",
        title: "Brain",
        detail: "2 graph corrections",
      },
    ]);
    expect(needsYouCount([], [], { inboxCount: 2 })).toBe(2);
    expect(needsYouCount([], [], { inboxCount: 0 })).toBe(0);
  });
});
