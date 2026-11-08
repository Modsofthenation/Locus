import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { api } from "./api";
import { subscribeNotices } from "./notice";
import { archiveOne, deleteSessionWithUndo } from "./sessionUndo";

vi.mock("./api", () => ({
  api: {
    patchSession: vi.fn(async (id: string, patch: { archived?: boolean }) => ({
      id,
      title: "Fix login",
      archived: patch.archived,
    })),
    deleteSession: vi.fn(async () => ({ ok: true })),
  },
}));

function session(archived = false): AgentSession {
  return {
    id: "s1",
    title: "Fix login",
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "p",
    model: "grok-4",
    status: "idle",
    vmId: "v1",
    messages: [],
    archived,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
}

describe("sessionUndo", () => {
  it("archives a live session and offers undo", async () => {
    const dispatch = vi.fn();
    const notices: string[] = [];
    const stop = subscribeNotices((rows) => {
      notices.splice(0, notices.length, ...rows.map((row) => row.message));
    });
    archiveOne(session(), dispatch, "Deleted Fix login");
    await vi.waitFor(() => expect(api.patchSession).toHaveBeenCalledWith("s1", { archived: true }));
    expect(notices).toContain("Deleted Fix login");
    stop();
  });

  it("hard-deletes an already archived session after confirm", async () => {
    const dispatch = vi.fn();
    const ask = vi.fn(async () => true);
    await deleteSessionWithUndo(session(true), dispatch, ask);
    expect(ask).toHaveBeenCalled();
    expect(api.deleteSession).toHaveBeenCalledWith("s1");
    expect(dispatch).toHaveBeenCalledWith({ type: "deleted", id: "s1" });
  });
});
