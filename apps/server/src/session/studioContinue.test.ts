import { describe, expect, it } from "vitest";
import { MAX_CANVAS_NUDGES } from "@locus/shared";
import {
  incompleteBlocksLook,
  leftoverCanvasRepair,
  lookedOrLookBudgetSpent,
  wantsCanvasQuality,
  wantsStudioFollowUpMutate,
} from "./studioContinue.js";

describe("studio continue predicates", () => {
  it("treats a look, this-turn look, or a spent look budget as looked", () => {
    expect(lookedOrLookBudgetSpent({ calledPlaywright: true })).toBe(true);
    expect(lookedOrLookBudgetSpent({ calledPlaywrightThisTurn: true })).toBe(true);
    expect(lookedOrLookBudgetSpent({ gamePlaywrightNudges: MAX_CANVAS_NUDGES })).toBe(true);
    expect(lookedOrLookBudgetSpent({})).toBe(false);
  });

  it("blocks look while the incomplete canvas budget is open", () => {
    expect(incompleteBlocksLook({ canvasIncomplete: true, canvasIncompleteNudges: 0 })).toBe(true);
    expect(
      incompleteBlocksLook({ canvasIncomplete: true, canvasIncompleteNudges: MAX_CANVAS_NUDGES }),
    ).toBe(false);
    expect(incompleteBlocksLook({ canvasIncomplete: false })).toBe(false);
  });

  it("wants quality on host-fallback or generic Design (not Game/Asset)", () => {
    expect(wantsCanvasQuality({ hostFallback: true })).toBe(true);
    expect(wantsCanvasQuality({ genericDesign: true })).toBe(true);
    expect(wantsCanvasQuality({ genericDesign: true, isGame: true })).toBe(false);
    expect(wantsCanvasQuality({})).toBe(false);
  });

  it("repairs leftover Game/Asset/Design walls without a write this round", () => {
    expect(leftoverCanvasRepair({ isGame: true, dryGame: true })).toBe(true);
    expect(leftoverCanvasRepair({ isAsset: true, assetUnwired: true })).toBe(true);
    expect(leftoverCanvasRepair({ isDesign: true, adherenceIssues: true })).toBe(true);
    expect(leftoverCanvasRepair({ isDesign: true })).toBe(false);
  });

  it("follows up Game/Asset mutate when the brief is missing or iterate did not land", () => {
    expect(wantsStudioFollowUpMutate({ isGame: true, followUpMissing: true })).toBe(true);
    expect(wantsStudioFollowUpMutate({ isAsset: true, iterateUnchanged: true })).toBe(true);
    expect(wantsStudioFollowUpMutate({ isGame: true })).toBe(false);
    expect(wantsStudioFollowUpMutate({ followUpMissing: true })).toBe(false);
  });
});
