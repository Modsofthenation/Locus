import { describe, expect, it } from "vitest";
import {
  CLONE_WAIT_HINT,
  cloneDoneProgress,
  cloneStartProgress,
  formatCloneProgressPhase,
  isCloneWaiting,
  latestCloneStartMessageId,
  parseGitCloneProgress,
  sameCloneProgressDetail,
} from "./cloneProgress.js";

describe("parseGitCloneProgress", () => {
  it("reads receiving-objects percent, counts, and throughput from CR-updated git output", () => {
    const parsed = parseGitCloneProgress(
      "Cloning into '/workspace'...\rReceiving objects:  12% (24/200)\rReceiving objects:  45% (90/200), 1.20 MiB | 800.00 KiB/s",
    );
    expect(parsed).toEqual({
      percent: 36,
      phase: "Receiving objects",
      phasePercent: 45,
      received: 90,
      total: 200,
      size: "1.20 MiB",
      rate: "800.00 KiB/s",
    });
  });

  it("maps checkout to the last slice of the bar", () => {
    expect(parseGitCloneProgress("Checking out files:  50% (100/200)\n")).toEqual({
      percent: 95,
      phase: "Checking out files",
      phasePercent: 50,
      received: 100,
      total: 200,
    });
  });

  it("uses the last progress line in a chunk", () => {
    const parsed = parseGitCloneProgress(
      "Receiving objects: 100% (200/200), done.\nResolving deltas:  20% (10/50)\n",
    );
    expect(parsed).toEqual({
      percent: 82,
      phase: "Resolving deltas",
      phasePercent: 20,
      received: 10,
      total: 50,
    });
  });

  it("keeps counts when overall percent is unchanged across delta ticks", () => {
    const parsed = parseGitCloneProgress(
      "Resolving deltas:  96% (480/500)\rResolving deltas:  97% (485/500)\r",
    );
    expect(parsed?.percent).toBe(90);
    expect(parsed?.phasePercent).toBe(97);
    expect(parsed?.received).toBe(485);
    expect(parsed?.total).toBe(500);
  });

  it("reads remote counting and enumerating before objects arrive", () => {
    expect(parseGitCloneProgress("remote: Enumerating objects: 12345, done.\n")).toEqual({
      percent: 1,
      phase: "Enumerating objects",
      total: 12345,
    });
    expect(parseGitCloneProgress("remote: Counting objects:  40% (80/200)\n")).toEqual({
      percent: 6,
      phase: "Counting objects",
      phasePercent: 40,
      received: 80,
      total: 200,
    });
  });

  it("joins a progress line split across chunks", () => {
    const parsed = parseGitCloneProgress(
      "Receiving objects:  4" + "5% (90/200), 1.20 MiB | 800.00 KiB/s\r",
    );
    expect(parsed).toMatchObject({
      phase: "Receiving objects",
      phasePercent: 45,
      received: 90,
      total: 200,
      rate: "800.00 KiB/s",
    });
  });

  it("ignores noise without a percent", () => {
    expect(parseGitCloneProgress("Cloning into '/workspace'...\n")).toBeUndefined();
  });

  it("does not jump backwards from compressing into receiving", () => {
    expect(
      parseGitCloneProgress("Compressing objects: 100% (10/10)\rReceiving objects:   0% (0/200)\r"),
    ).toEqual({
      percent: 10,
      phase: "Receiving objects",
      phasePercent: 0,
      received: 0,
      total: 200,
    });
  });
});

describe("formatCloneProgressPhase", () => {
  it("shows git-native percent, counts, and rate", () => {
    expect(
      formatCloneProgressPhase({
        percent: 82,
        phase: "Resolving deltas",
        phasePercent: 20,
        received: 10,
        total: 50,
      }),
    ).toBe("Resolving deltas 20% · 10/50");
    expect(
      formatCloneProgressPhase({
        percent: 36,
        phase: "Receiving objects",
        phasePercent: 45,
        received: 90,
        total: 200,
        size: "1.20 MiB",
        rate: "800.00 KiB/s",
      }),
    ).toBe("Receiving objects 45% · 90/200 · 1.20 MiB · 800.00 KiB/s");
    expect(formatCloneProgressPhase(cloneDoneProgress())).toBe("Done");
  });
});

describe("latestCloneStartMessageId", () => {
  it("returns the latest Cloning system note", () => {
    expect(
      latestCloneStartMessageId([
        { id: "a", role: "system", content: "Cloning https://a.git into the guest at /workspace" },
        { id: "b", role: "system", content: "Clone failed: timed out" },
        { id: "c", role: "system", content: "Cloning https://a.git into the guest at /workspace" },
      ]),
    ).toBe("c");
  });
});

describe("sameCloneProgressDetail", () => {
  it("treats phasePercent and throughput as detail even when counts are unchanged", () => {
    const prev = {
      percent: 90,
      phase: "Resolving deltas",
      phasePercent: 96,
      received: 480,
      total: 500,
    };
    expect(sameCloneProgressDetail(prev, { ...prev, phasePercent: 97 })).toBe(false);
    expect(sameCloneProgressDetail(prev, { ...prev, size: "12.34 MiB" })).toBe(false);
    expect(sameCloneProgressDetail(prev, { ...prev, total: 501 })).toBe(false);
    expect(sameCloneProgressDetail(prev, { ...prev })).toBe(true);
  });
});

describe("clone progress sentinels", () => {
  it("starts at 0 and finishes at 100", () => {
    expect(cloneStartProgress()).toEqual({ percent: 0, phase: "Starting" });
    expect(cloneDoneProgress()).toEqual({ percent: 100, phase: "Done", done: true });
    expect(isCloneWaiting(cloneStartProgress())).toBe(true);
    expect(isCloneWaiting(cloneDoneProgress())).toBe(false);
    expect(CLONE_WAIT_HINT).toMatch(/waiting for this clone/i);
  });
});
