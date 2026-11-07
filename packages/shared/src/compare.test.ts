import { describe, expect, it } from "vitest";
import {
  compareGroup,
  comparePeer,
  lastUserPrompt,
  turnUserPrompt,
  otherCompareModel,
  parseSessionCompare,
  parseWorkerCount,
} from "./models/compare.js";

describe("compare helpers", () => {
  it("reads the last non-empty user prompt", () => {
    expect(lastUserPrompt([])).toBeUndefined();
    expect(
      lastUserPrompt([
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "  second  " },
      ]),
    ).toBe("second");
  });

  it("joins the current turn's user prompt with later steers", () => {
    expect(
      turnUserPrompt([
        { role: "user", content: "use the review subagent to scan auth" },
        { role: "assistant", content: "looking" },
        { role: "user", content: "also check the tests", steer: true },
      ]),
    ).toBe("use the review subagent to scan auth\nalso check the tests");
    expect(turnUserPrompt([{ role: "user", content: "hello" }])).toBe("hello");
    const steered = [
      { role: "user", content: "add #bMode for race" },
      { role: "user", content: "do it", steer: true },
    ];
    expect(lastUserPrompt(steered)).toBe("do it");
    expect(turnUserPrompt(steered)).toBe("add #bMode for race\ndo it");
  });

  it("parses a compare link and finds the peer", () => {
    expect(parseSessionCompare({ groupId: "g", role: "C", peerId: "b" })).toBeUndefined();
    const link = parseSessionCompare({ groupId: " g ", role: "A", peerId: "b" });
    expect(link).toEqual({ groupId: "g", role: "A", peerId: "b" });
    const a = { id: "a", compare: { groupId: "g", role: "A" as const, peerId: "b" } };
    const b = { id: "b", compare: { groupId: "g", role: "B" as const, peerId: "a" } };
    expect(comparePeer(a, [a, b])?.id).toBe("b");
    expect(comparePeer(a, [a])).toBeUndefined();
  });

  it("parses a worker group and lists members", () => {
    expect(parseWorkerCount(3)).toBe(3);
    expect(parseWorkerCount(1)).toBeUndefined();
    expect(parseWorkerCount(9)).toBeUndefined();
    expect(parseSessionCompare({ groupId: "g", kind: "workers", role: "1" })).toBeUndefined();
    const link = parseSessionCompare({
      groupId: "g",
      kind: "workers",
      role: "2",
      memberIds: ["w1", "w2", "w2", "w3"],
    });
    expect(link).toEqual({
      groupId: "g",
      kind: "workers",
      role: "2",
      memberIds: ["w1", "w2", "w3"],
    });
    const w1 = { id: "w1", compare: link };
    const w2 = { id: "w2", compare: { ...link!, role: "2" } };
    const w3 = { id: "w3", compare: { ...link!, role: "3" } };
    expect(compareGroup(w2, [w1, w2, w3]).map((row) => row.id)).toEqual(["w1", "w2", "w3"]);
    expect(comparePeer(w1, [w1, w2, w3])).toBeUndefined();
  });

  it("names worker branches and lockfiles", async () => {
    const { workerBranchName, isWorkerLockPath, parseSessionCompare } =
      await import("./models/compare.js");
    expect(workerBranchName("2")).toBe("locus/worker-2");
    expect(isWorkerLockPath("/workspace/package-lock.json")).toBe(true);
    expect(isWorkerLockPath("/workspace/src/app.ts")).toBe(false);
    expect(
      parseSessionCompare({
        groupId: "g",
        kind: "workers",
        role: "1",
        memberIds: ["w1", "w2"],
        parentId: "p",
        branch: "locus/worker-1",
      }),
    ).toMatchObject({ parentId: "p", branch: "locus/worker-1" });
  });

  it("picks another model when one exists", () => {
    const providers = [
      {
        id: "p1",
        name: "One",
        kind: "openai" as const,
        baseUrl: "",
        models: ["a", "b"],
        defaultModel: "a",
        enabled: true,
        extraHeaders: {},
      },
      {
        id: "p2",
        name: "Two",
        kind: "openai" as const,
        baseUrl: "",
        models: ["c"],
        defaultModel: "c",
        enabled: true,
        extraHeaders: {},
      },
    ];
    expect(otherCompareModel(providers, "p1", "a")).toEqual({ providerId: "p1", model: "b" });
    expect(otherCompareModel(providers, "p1", "b")).toEqual({ providerId: "p1", model: "a" });
    expect(otherCompareModel([{ ...providers[0]!, models: ["a"] }], "p1", "a")).toEqual({
      providerId: "p1",
      model: "a",
    });
  });
});
