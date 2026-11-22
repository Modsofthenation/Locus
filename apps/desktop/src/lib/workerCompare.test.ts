import { describe, expect, it } from "vitest";
import type { WorkerBoardRow } from "@locus/shared";
import {
  compareCostLabel,
  compareTestsLabel,
  discardOthersTitle,
  orderByRank,
  otherAttempts,
} from "./workerCompare";

const row = (id: string): WorkerBoardRow => ({
  id,
  title: id,
  role: id,
  status: "idle",
  providerId: "p",
  model: "m",
  stat: { files: 1, insertions: 1, deletions: 0 },
  commits: 0,
  dirty: 0,
});

describe("workerCompare", () => {
  it("labels test state", () => {
    expect(compareTestsLabel({ tests: "pass" })).toEqual({ text: "Tests pass", tone: "ok" });
    expect(compareTestsLabel({ tests: "fail" })).toEqual({ text: "Tests fail", tone: "danger" });
    expect(compareTestsLabel({})).toEqual({ text: "Tests not run", tone: "muted" });
  });

  it("labels cost", () => {
    expect(compareCostLabel({ usd: 0.123 })).toBe("$0.12");
    expect(compareCostLabel({})).toBe("—");
  });

  it("orders by rank and leaves unranked last", () => {
    const rows = [row("a"), row("b"), row("c")];
    expect(orderByRank(rows, null)).toBe(rows);
    const ordered = orderByRank(rows, {
      source: "model",
      entries: [
        { id: "c", rank: 1, reason: "" },
        { id: "a", rank: 2, reason: "" },
      ],
    });
    expect(ordered.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("lists the others and titles the discard confirm", () => {
    expect(otherAttempts([row("a"), row("b"), row("c")], "b").map((r) => r.id)).toEqual(["a", "c"]);
    expect(discardOthersTitle(3)).toBe("Discard 3 other attempts?");
    expect(discardOthersTitle(1)).toBe("Discard the other attempt?");
  });
});
