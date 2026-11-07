import { describe, expect, it } from "vitest";
import { boundPeerIds, findBoundAgent, isLiveBoundSession, isWorkerSession } from "./bind.js";
import { parseSessionPull, type AgentSession } from "./session.js";

function session(partial: Partial<AgentSession> & Pick<AgentSession, "id">): AgentSession {
  return {
    title: partial.title ?? partial.id,
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "openai",
    model: "gpt-4.1",
    status: "idle",
    messages: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("bound work item", () => {
  it("parses a session pull", () => {
    expect(
      parseSessionPull({ number: 12, url: "https://github.com/acme/app/pull/12", title: "Fix" }),
    ).toEqual({
      number: 12,
      url: "https://github.com/acme/app/pull/12",
      title: "Fix",
      state: undefined,
      headRef: undefined,
      baseRef: undefined,
    });
    expect(parseSessionPull({ number: 0, url: "https://example.com" })).toBeUndefined();
  });

  it("finds the promoted agent, then the PR, then the repo coding session", () => {
    const design = session({ id: "d1", kind: "design", promotedAgentId: "a1" });
    const agent = session({
      id: "a1",
      sourceDesignId: "d1",
      repoId: "r1",
      pull: { number: 9, url: "https://x/pull/9", title: "PR" },
    });
    const other = session({ id: "a2", repoId: "r1" });
    const worker = session({
      id: "w1",
      repoId: "r1",
      compare: { kind: "workers", groupId: "g", role: "1" },
    });
    const sessions = [design, agent, other, worker];
    expect(findBoundAgent(sessions, { promotedAgentId: "a1" })?.id).toBe("a1");
    expect(findBoundAgent(sessions, { sourceDesignId: "d1" })?.id).toBe("a1");
    expect(findBoundAgent(sessions, { repoId: "r1", pullNumber: 9 })?.id).toBe("a1");
    expect(findBoundAgent(sessions, { repoId: "r1" })?.id).toBe("a1");
    expect(findBoundAgent(sessions, { repoId: "r1", pullNumber: 99 })).toBeUndefined();
    expect(isLiveBoundSession(worker)).toBe(false);
    expect(isLiveBoundSession(design)).toBe(false);
    expect(boundPeerIds(agent, sessions).sort()).toEqual(["a1", "d1"]);
  });

  it("does not bind a PR review session to the repo coding agent", () => {
    const coding = session({ id: "a1", repoId: "r1" });
    const review = session({
      id: "rev",
      kind: "review",
      repoId: "r1",
      pull: { number: 9, url: "https://x/pull/9", title: "PR" },
    });
    expect(isLiveBoundSession(review)).toBe(false);
    expect(findBoundAgent([review], { repoId: "r1" })).toBeUndefined();
    expect(findBoundAgent([review], { repoId: "r1", pullNumber: 9 })).toBeUndefined();
    expect(findBoundAgent([review, coding], { repoId: "r1" })?.id).toBe("a1");
    expect(findBoundAgent([review, coding], { repoId: "r1", pullNumber: 9 })).toBeUndefined();
  });

  it("does not bind a setup-environment session to the repo coding agent", () => {
    const coding = session({ id: "a1", repoId: "r1" });
    const setup = session({
      id: "setup",
      kind: "setup",
      repoId: "r1",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    expect(isLiveBoundSession(setup)).toBe(false);
    expect(findBoundAgent([setup], { repoId: "r1" })).toBeUndefined();
    expect(findBoundAgent([setup, coding], { repoId: "r1" })?.id).toBe("a1");
  });

  it("keeps a worker parent live-bound and prefers the newest repo agent", () => {
    const parent = session({
      id: "p1",
      repoId: "r1",
      compare: { kind: "workers", groupId: "g", role: "parent", memberIds: ["w1", "w2"] },
    });
    const child = session({
      id: "w1",
      repoId: "r1",
      compare: {
        kind: "workers",
        groupId: "g",
        role: "1",
        memberIds: ["w1", "w2"],
        parentId: "p1",
      },
    });
    expect(isWorkerSession(parent)).toBe(false);
    expect(isWorkerSession(child)).toBe(true);
    expect(isLiveBoundSession(parent)).toBe(true);
    expect(isLiveBoundSession(child)).toBe(false);
    expect(findBoundAgent([child, parent], { repoId: "r1" })?.id).toBe("p1");

    const older = session({
      id: "a1",
      repoId: "r1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = session({
      id: "a2",
      repoId: "r1",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(findBoundAgent([older, newer], { repoId: "r1" })?.id).toBe("a2");
  });

  it("does not treat a parallel repo agent as the same bound object", () => {
    const agent = session({
      id: "a1",
      repoId: "r1",
      pull: { number: 9, url: "https://x/pull/9", title: "PR" },
    });
    const other = session({ id: "a2", repoId: "r1" });
    expect(boundPeerIds(agent, [agent, other])).toEqual(["a1"]);
  });
});
