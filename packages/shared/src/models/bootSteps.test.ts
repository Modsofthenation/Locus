import { describe, expect, it } from "vitest";
import {
  activeBootStep,
  advanceBootProgress,
  beginBootProgress,
  bootHistoryKey,
  bootProgressTitle,
  bootStepElapsedMs,
  bootStepMeta,
  bootStepPlan,
  estimateBootStepMs,
  failBootProgress,
  finishBootProgress,
  formatBootDuration,
  formatBootEstimate,
  medianMs,
  parseBootHistory,
  recordBootHistory,
  type BootHistory,
} from "./bootSteps.js";

describe("bootStepPlan", () => {
  it("orders Docker, VM, and Host steps", () => {
    expect(bootStepPlan("docker")).toEqual(["pull", "start", "setup", "ready"]);
    expect(bootStepPlan("docker", { repo: true })).toEqual([
      "pull",
      "start",
      "clone",
      "setup",
      "ready",
    ]);
    expect(bootStepPlan("vm")).toEqual(["disk", "boot", "connect", "ready"]);
    expect(bootStepPlan("cloud", { repo: true })).toEqual([
      "provision",
      "connect",
      "clone",
      "ready",
    ]);
    expect(bootStepPlan("host", { repo: true })).toEqual(["clone", "ready"]);
    expect(bootStepPlan("host", { worktree: true, setup: true })).toEqual([
      "worktree",
      "setup",
      "ready",
    ]);
  });

  it("keys history by kind and image", () => {
    expect(bootHistoryKey("docker", " ubuntu:24.04 ")).toBe("docker:ubuntu:24.04");
    expect(bootHistoryKey("host")).toBe("host");
  });
});

describe("medianMs / estimateBootStepMs", () => {
  it("takes the median of the last N runs", () => {
    expect(medianMs([])).toBeUndefined();
    expect(medianMs([30, 10, 20])).toBe(20);
    expect(medianMs([10, 20, 30, 40])).toBe(25);
    const history: BootHistory = { "docker:x": { pull: [1000, 1000, 9000, 9000, 9000] } };
    expect(estimateBootStepMs(history, "docker:x", "pull", 3)).toBe(9000);
    expect(estimateBootStepMs(history, "docker:x", "pull")).toBe(9000);
    expect(estimateBootStepMs(history, "docker:x", "start")).toBeUndefined();
    expect(estimateBootStepMs(history, "docker:y", "pull")).toBeUndefined();
  });
});

describe("boot progress transitions", () => {
  const history: BootHistory = { "docker:img": { pull: [40_000], start: [2_000] } };

  it("starts on the first step with estimates", () => {
    const p = beginBootProgress({ kind: "docker", key: "docker:img", at: 0, history });
    expect(p.steps[0]).toMatchObject({
      id: "pull",
      state: "active",
      startedAt: 0,
      estimateMs: 40_000,
    });
    expect(p.steps[1]).toMatchObject({ id: "start", state: "pending", estimateMs: 2_000 });
    expect(p.steps.at(-1)?.estimateMs).toBeUndefined();
    expect(activeBootStep(p)?.id).toBe("pull");
  });

  it("advances, skips passed steps, and ignores going backwards", () => {
    let p = beginBootProgress({ kind: "docker", key: "k", at: 0, repo: true });
    p = advanceBootProgress(p, "start", 100);
    p = advanceBootProgress(p, "setup", 300);
    expect(p.steps.map((s) => s.state)).toEqual(["done", "done", "skipped", "active", "pending"]);
    expect(p.steps[1]).toMatchObject({ startedAt: 100, endedAt: 300 });
    expect(advanceBootProgress(p, "start", 400)).toBe(p);
    expect(advanceBootProgress(p, "disk", 400)).toBe(p);
  });

  it("finishes and records durations for done steps only", () => {
    let p = beginBootProgress({ kind: "docker", key: "k", at: 0 });
    p = advanceBootProgress(p, "start", 1_000);
    p = finishBootProgress(p, 1_500);
    expect(p.done).toBe(true);
    expect(p.steps.map((s) => s.state)).toEqual(["done", "done", "skipped", "done"]);
    const next = recordBootHistory({}, p);
    expect(next).toEqual({ k: { pull: [1_000], start: [500] } });
    expect(advanceBootProgress(p, "setup", 2_000)).toBe(p);
  });

  it("caps history at maxRuns", () => {
    let history: BootHistory = {};
    for (let i = 0; i < 5; i += 1) {
      const p = finishBootProgress(
        beginBootProgress({ kind: "host", key: "h", at: 0, repo: true }),
        i,
      );
      history = recordBootHistory(history, p, 3);
    }
    expect(history.h?.clone).toEqual([2, 3, 4]);
  });

  it("marks the active step failed and does not record it", () => {
    let p = beginBootProgress({ kind: "vm", key: "vm", at: 0 });
    p = advanceBootProgress(p, "boot", 10);
    p = failBootProgress(p, "QEMU exited", 20);
    expect(p.error).toBe("QEMU exited");
    expect(p.steps[1]).toMatchObject({ id: "boot", state: "error", error: "QEMU exited" });
    expect(activeBootStep(p)?.id).toBe("boot");
    expect(recordBootHistory({}, p)).toEqual({});
    expect(finishBootProgress(p, 30)).toBe(p);
  });
});

describe("parseBootHistory", () => {
  it("drops junk", () => {
    expect(parseBootHistory(null)).toEqual({});
    expect(
      parseBootHistory({ a: { pull: [1, "x", -1, 2], nope: [1] }, b: [], c: { start: [] } }),
    ).toEqual({ a: { pull: [1, 2] } });
  });
});

describe("formatting", () => {
  it("formats durations and estimates", () => {
    expect(formatBootDuration(400)).toBe("0s");
    expect(formatBootDuration(40_200)).toBe("40s");
    expect(formatBootDuration(120_000)).toBe("2m");
    expect(formatBootDuration(125_000)).toBe("2m 5s");
    expect(formatBootEstimate(40_000)).toBe("usually ~40s");
    expect(formatBootEstimate(undefined)).toBeUndefined();
  });

  it("computes elapsed for active and finished steps", () => {
    expect(bootStepElapsedMs({ id: "pull", label: "", state: "active", startedAt: 100 }, 600)).toBe(
      500,
    );
    expect(
      bootStepElapsedMs(
        { id: "pull", label: "", state: "done", startedAt: 100, endedAt: 300 },
        600,
      ),
    ).toBe(200);
    expect(bootStepElapsedMs({ id: "pull", label: "", state: "pending" }, 600)).toBeUndefined();
  });
});

describe("bootStepMeta / bootProgressTitle", () => {
  it("shows elapsed plus the estimate only on the active step", () => {
    const active = {
      id: "pull" as const,
      label: "Pull image",
      state: "active" as const,
      startedAt: 0,
      estimateMs: 40_000,
    };
    expect(bootStepMeta(active, 5_000)).toBe("5s · usually ~40s");
    expect(bootStepMeta({ ...active, estimateMs: undefined }, 5_000)).toBe("5s");
    expect(bootStepMeta({ ...active, state: "done", endedAt: 12_000 }, 99_000)).toBe("12s");
    expect(bootStepMeta({ ...active, state: "pending", startedAt: undefined }, 5_000)).toBe("");
  });

  it("titles by kind and failure", () => {
    const p = beginBootProgress({ kind: "vm", key: "vm", at: 0 });
    expect(bootProgressTitle(p)).toBe("Starting VM");
    expect(bootProgressTitle({ ...p, kind: "docker" })).toBe("Starting container");
    expect(bootProgressTitle({ ...p, kind: "host" })).toBe("Preparing workspace");
    expect(bootProgressTitle(failBootProgress(p, "x", 1))).toBe("Start failed");
  });
});
