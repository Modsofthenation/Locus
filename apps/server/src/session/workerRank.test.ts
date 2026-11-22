import { describe, expect, it, vi } from "vitest";
import type { ChatEvent, CompleteRequest } from "@locus/providers";
import type { AiProvider, WorkerAttempt } from "@locus/shared";
import { rankWorkerAttempts } from "./workerRank.js";

const attempts: WorkerAttempt[] = [
  {
    id: "w1",
    role: "1",
    model: "a",
    status: "idle",
    stat: { files: 2, insertions: 40, deletions: 2 },
    tests: "pass",
    diff: "+big",
  },
  {
    id: "w2",
    role: "2",
    model: "b",
    status: "idle",
    stat: { files: 1, insertions: 3, deletions: 1 },
    tests: "pass",
    diff: "+small",
  },
];

const picked = { provider: { id: "p" } as AiProvider, model: "judge" };

function replying(text: string) {
  return vi.fn(async function* (_req: CompleteRequest): AsyncGenerator<ChatEvent> {
    yield { type: "text", text } as ChatEvent;
  });
}

describe("rankWorkerAttempts", () => {
  it("asks the picked model with the task and both diffs", async () => {
    const complete = replying(
      '{"ranking":[{"attempt":"1","reason":"Covers both paths"},{"attempt":"2","reason":"Misses one"}]}',
    );
    const ranking = await rankWorkerAttempts({ task: "Fix login", attempts, picked, complete });
    expect(ranking).toEqual({
      source: "model",
      entries: [
        {
          id: "w1",
          rank: 1,
          reason: "Covers both paths",
          evidence: ["Tests pass", "42 lines"],
        },
        { id: "w2", rank: 2, reason: "Misses one", evidence: ["Tests pass", "4 lines"] },
      ],
    });
    const req = complete.mock.calls[0]![0];
    expect(req.model).toBe("judge");
    expect(req.allowedTools).toEqual([]);
    const prompt = req.messages[0]!.content;
    expect(prompt).toContain("Fix login");
    expect(prompt).toContain("+big");
    expect(prompt).toContain("+small");
  });

  it("falls back to the heuristic without a model", async () => {
    const complete = replying("");
    const ranking = await rankWorkerAttempts({ task: "t", attempts, complete });
    expect(complete).not.toHaveBeenCalled();
    expect(ranking.source).toBe("heuristic");
    expect(ranking.entries.map((e) => e.id)).toEqual(["w2", "w1"]);
  });

  it("falls back when the reply does not parse or the call throws", async () => {
    const junk = await rankWorkerAttempts({
      task: "t",
      attempts,
      picked,
      complete: replying("I like 2"),
    });
    expect(junk.source).toBe("heuristic");
    const thrown = await rankWorkerAttempts({
      task: "t",
      attempts,
      picked,
      complete: async function* () {
        throw new Error("offline");
      },
    });
    expect(thrown.source).toBe("heuristic");
  });

  it("keeps evidence ahead of the model: a failing attempt cannot win a tie-break", async () => {
    const complete = replying(
      '{"ranking":[{"attempt":"2","reason":"Shortest"},{"attempt":"1","reason":"Correct"}]}',
    );
    const ranking = await rankWorkerAttempts({
      task: "Fix login",
      attempts: [attempts[0]!, { ...attempts[1]!, tests: "fail" }],
      picked,
      complete,
    });
    expect(ranking.entries.map((row) => row.id)).toEqual(["w1", "w2"]);
    expect(ranking.entries[1]!.evidence?.[0]).toBe("Tests fail");
  });
});
