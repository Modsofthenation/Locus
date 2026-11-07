import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { api } from "./api";
import { pickCompareWinner, startModelCompare, startWorkers } from "./compare";

vi.mock("./api", () => ({
  api: {
    fork: vi.fn(),
    spawnWorkers: vi.fn(),
    patchSession: vi.fn(),
    abortChat: vi.fn(async () => ({ ok: true })),
    stopVm: vi.fn(async () => ({})),
    startVm: vi.fn(),
    chat: vi.fn(),
  },
}));

const session = (id: string, extra: Partial<AgentSession> = {}): AgentSession => ({
  id,
  title: "Fix login",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p1",
  model: "grok-4",
  status: "idle",
  messages: [
    { id: "m1", role: "user", content: "fix the login", createdAt: "2020-01-01T00:00:00.000Z" },
  ],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  ...extra,
});

describe("startModelCompare", () => {
  it("forks, retargets the model, and replays the last prompt", async () => {
    const a0 = session("a");
    const forked = session("b", { title: "Fix login fork", messages: [] });
    vi.mocked(api.fork).mockResolvedValue(forked);
    vi.mocked(api.patchSession).mockImplementation(async (id, patch) => {
      const base = id === "b" ? forked : a0;
      return {
        ...base,
        title: patch.title ?? base.title,
        providerId: patch.providerId ?? base.providerId,
        model: patch.model ?? base.model,
        compare: patch.compare === null ? undefined : (patch.compare ?? base.compare),
      };
    });
    vi.mocked(api.startVm).mockResolvedValue({} as never);
    vi.mocked(api.chat).mockResolvedValue({ ok: true });

    const { a, b } = await startModelCompare(a0, { providerId: "p2", model: "gpt-4.1" });
    expect(api.fork).toHaveBeenCalledWith("a");
    expect(b.model).toBe("gpt-4.1");
    expect(b.compare?.role).toBe("B");
    expect(a.compare?.peerId).toBe("b");
    expect(api.chat).toHaveBeenCalledWith("b", "fix the login");
    expect(api.startVm).toHaveBeenCalledWith("b");
  });

  it("archives the loser and clears the link", async () => {
    const winner = session("a", { compare: { groupId: "g", role: "A", peerId: "b" } });
    const loser = session("b", { compare: { groupId: "g", role: "B", peerId: "a" } });
    vi.mocked(api.patchSession).mockImplementation(async (id, patch) => {
      const base = id === "a" ? winner : loser;
      return {
        ...base,
        archived: patch.archived ?? base.archived,
        compare: patch.compare === null ? undefined : (patch.compare ?? base.compare),
      };
    });
    const kept = await pickCompareWinner(winner, loser);
    expect(api.abortChat).toHaveBeenCalledWith("b");
    expect(api.stopVm).toHaveBeenCalledWith("b");
    expect(api.patchSession).toHaveBeenCalledWith("b", { archived: true, compare: null });
    expect(api.patchSession).toHaveBeenCalledWith("a", { compare: null });
    expect(kept.compare).toBeUndefined();
  });

  it("spawns Docker workers from the last prompt", async () => {
    const source = session("a", { runtime: "docker", dockerImage: "ubuntu:24.04" });
    const workers = [
      session("w1", {
        title: "Fix login · 1",
        compare: { groupId: "g", kind: "workers", role: "1", memberIds: ["w1", "w2"] },
      }),
      session("w2", {
        title: "Fix login · 2",
        compare: { groupId: "g", kind: "workers", role: "2", memberIds: ["w1", "w2"] },
      }),
    ];
    vi.mocked(api.spawnWorkers).mockResolvedValue(workers);
    const result = await startWorkers(source, 2);
    expect(api.spawnWorkers).toHaveBeenCalledWith("a", { count: 2, prompt: "fix the login" });
    expect(result).toHaveLength(2);
  });
});
