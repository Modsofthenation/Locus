import { describe, expect, it, vi } from "vitest";
import type { AgentSession, ChatMessage } from "@locus/shared";
import { ambientCounts, needsYouNotice, runAmbientAction, showNeedsYouNotice } from "./ambient";

const at = "2026-11-12T10:00:00.000Z";

function session(id: string, extra: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    title: `Chat ${id}`,
    status: "idle",
    messages: [],
    createdAt: at,
    updatedAt: at,
    ...extra,
  } as AgentSession;
}

const approval = session("s1", {
  messages: [
    {
      id: "a",
      role: "assistant",
      content: "",
      createdAt: at,
      toolCalls: [
        {
          id: "c1",
          name: "exec",
          arguments: { command: "npm test" },
          startedAt: at,
          approval: "needed",
        },
      ],
    },
  ] as ChatMessage[],
});

describe("ambientCounts", () => {
  it("counts running agents and items that need you, skipping archived chats", () => {
    expect(
      ambientCounts([
        session("r", { status: "running" }),
        session("x", { status: "running", archived: true }),
        approval,
        session("h", { needsHuman: "Which branch?" }),
      ]),
    ).toEqual({ running: 1, needsYou: 2 });
  });
});

describe("needsYouNotice", () => {
  it("names the tool and command for an approval", () => {
    const notice = needsYouNotice(approval, ["a:c1"]);
    expect(notice.title).toBe("Chat s1 needs approval");
    expect(notice.body).toContain("npm test");
    expect(notice.callId).toBe("c1");
    expect(notice.approvable).toBe(true);
  });

  it("uses the agent's question otherwise", () => {
    const notice = needsYouNotice(session("s2", { needsHuman: "Which branch?" }), ["h:s2"]);
    expect(notice).toMatchObject({ title: "Chat s2", body: "Which branch?", approvable: false });
  });
});

describe("showNeedsYouNotice", () => {
  it("prefers the desktop bridge", () => {
    const notify = vi.fn();
    const notice = needsYouNotice(approval, ["a:c1"]);
    showNeedsYouNotice(notice, true, vi.fn(), {
      setCloseGuard: vi.fn(),
      onCloseRequested: vi.fn(),
      ackClosePrompt: vi.fn(),
      confirmClose: vi.fn(),
      notify,
    });
    expect(notify).toHaveBeenCalledWith(notice);
  });

  it("does nothing when notifications are off", () => {
    const notify = vi.fn();
    showNeedsYouNotice(needsYouNotice(approval, ["a:c1"]), false, vi.fn(), {
      setCloseGuard: vi.fn(),
      onCloseRequested: vi.fn(),
      ackClosePrompt: vi.fn(),
      confirmClose: vi.fn(),
      notify,
    });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("runAmbientAction", () => {
  it("opens the chat or the inbox", async () => {
    const dispatch = vi.fn();
    const resolveApproval = vi.fn();
    await runAmbientAction({ action: "open", sessionId: "s1" }, { dispatch, resolveApproval });
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "s1" });
    await runAmbientAction({ action: "inbox" }, { dispatch, resolveApproval });
    expect(dispatch).toHaveBeenCalledWith({ type: "inbox", open: true });
    expect(resolveApproval).not.toHaveBeenCalled();
  });

  it("approves in the background and falls back to the chat on error", async () => {
    const dispatch = vi.fn();
    const updated = session("s1");
    const resolveApproval = vi.fn().mockResolvedValueOnce(updated);
    await runAmbientAction(
      { action: "approve", sessionId: "s1", callId: "c1" },
      { dispatch, resolveApproval },
    );
    expect(resolveApproval).toHaveBeenCalledWith("s1", "c1", "approved");
    expect(dispatch).toHaveBeenCalledWith({ type: "session", session: updated });

    const onError = vi.fn();
    resolveApproval.mockRejectedValueOnce(new Error("gone"));
    await runAmbientAction(
      { action: "deny", sessionId: "s1", callId: "c1" },
      { dispatch, resolveApproval, onError },
    );
    expect(onError).toHaveBeenCalled();
    expect(dispatch).toHaveBeenLastCalledWith({ type: "select", id: "s1" });
  });
});
