import {
  MAX_ADHERENCE_NUDGES,
  MAX_ASSET_SCULPT_NUDGES,
  MAX_CANVAS_NUDGES,
  MAX_DESIGN_QUALITY_NUDGES,
  MAX_GAME_JUICE_NUDGES,
  MAX_UNUSED_LINKED_ASSET_NUDGES,
} from "@locus/shared";

/** HTML quality walls need a look, or the look budget already spent without a screenshot. */
export function lookedOrLookBudgetSpent(input: {
  calledPlaywright?: boolean;
  calledPlaywrightThisTurn?: boolean;
  gamePlaywrightNudges?: number;
}): boolean {
  return (
    Boolean(input.calledPlaywright) ||
    Boolean(input.calledPlaywrightThisTurn) ||
    (input.gamePlaywrightNudges ?? 0) >= MAX_CANVAS_NUDGES
  );
}

/** Finish-the-document still wins while the incomplete budget is open. After that cap, look can fire. */
export function incompleteBlocksLook(obs: {
  canvasIncomplete?: boolean;
  canvasIncompleteNudges?: number;
}): boolean {
  return Boolean(obs.canvasIncomplete) && (obs.canvasIncompleteNudges ?? 0) < MAX_CANVAS_NUDGES;
}

/** Host-fallback stubs skip generic/placeholder fingerprints; still need a quality rewrite after a look. */
export function wantsCanvasQuality(obs: {
  hostFallback?: boolean;
  genericDesign?: boolean;
  isGame?: boolean;
  isAsset?: boolean;
}): boolean {
  return Boolean(obs.hostFallback) || (Boolean(obs.genericDesign) && !obs.isGame && !obs.isAsset);
}

export type CanvasRepairObservation = {
  hostFallback?: boolean;
  genericDesign?: boolean;
  isGame?: boolean;
  isAsset?: boolean;
  isDesign?: boolean;
  dryGame?: boolean;
  unusedLinkedAssets?: boolean;
  gameUnplayable?: boolean;
  placeholderAsset?: boolean;
  assetUnwired?: boolean;
  adherenceIssues?: boolean;
};

/**
 * Leftover quality/juice/sculpt/adherence/unused/unplayable still need a look
 * (and must not lose to talk-only mutate) even when this round did not write.
 */
export function leftoverCanvasRepair(obs: CanvasRepairObservation): boolean {
  if (wantsCanvasQuality(obs)) return true;
  if (obs.isGame && (obs.dryGame || obs.unusedLinkedAssets || obs.gameUnplayable)) return true;
  if (obs.isAsset && (obs.placeholderAsset || obs.assetUnwired)) return true;
  return Boolean(obs.isDesign && !obs.isGame && !obs.isAsset && obs.adherenceIssues);
}

export function wantsStudioFollowUpMutate(obs: {
  isGame?: boolean;
  isAsset?: boolean;
  followUpMissing?: boolean;
  iterateUnchanged?: boolean;
}): boolean {
  return (
    Boolean(obs.isGame || obs.isAsset) &&
    (Boolean(obs.followUpMissing) || Boolean(obs.iterateUnchanged))
  );
}

export type StudioContinueKind =
  | "canvasNudge"
  | "canvasIncompleteNudge"
  | "canvasRecovered"
  | "gameWipeRestore"
  | "designLookNudge"
  | "gamePlaywrightNudge"
  | "designMutateNudge"
  | "designQualityNudge"
  | "gameUnplayableNudge"
  | "unusedLinkedAssetsNudge"
  | "gameJuiceNudge"
  | "assetSculptNudge"
  | "adherenceNudge";

export type StudioContinueObservation = {
  source: "model" | "tool" | "cli";
  isDesign: boolean;
  isGame?: boolean;
  isAsset?: boolean;
  planTurn?: boolean;
  stopped?: boolean;
  guestReady?: boolean;
  toolCallCount?: number;
  canvasEmpty?: boolean;
  canvasIncomplete?: boolean;
  canvasNudges?: number;
  canvasIncompleteNudges?: number;
  canvasMutatedThisTurn?: boolean;
  canvasWiped?: boolean;
  wroteCanvas?: boolean;
  recoveredCanvas?: boolean;
  calledPlaywright?: boolean;
  calledPlaywrightThisTurn?: boolean;
  fakePlaytest?: boolean;
  playwrightFailed?: boolean;
  gamePlaywrightNudges?: number;
  designMutateNudges?: number;
  designQualityNudges?: number;
  gameUnplayable?: boolean;
  gameUnplayableNudges?: number;
  assetUnwired?: boolean;
  unusedLinkedAssets?: boolean;
  unusedLinkedAssetNudges?: number;
  dryGame?: boolean;
  gameJuiceNudges?: number;
  placeholderAsset?: boolean;
  assetSculptNudges?: number;
  adherenceIssues?: boolean;
  adherenceNudges?: number;
  genericDesign?: boolean;
  hostFallback?: boolean;
  followUpMissing?: boolean;
  iterateUnchanged?: boolean;
  canvasUnchanged?: boolean;
  hasToolError?: boolean;
};

function idle(obs: StudioContinueObservation): boolean {
  return !obs.planTurn && !obs.stopped;
}

function modelIdle(obs: StudioContinueObservation): boolean {
  return obs.toolCallCount === 0 && idle(obs);
}

function studioLoop(obs: StudioContinueObservation): boolean {
  return Boolean((obs.isGame || obs.isAsset) && idle(obs));
}

function pickModelStudio(obs: StudioContinueObservation): StudioContinueKind | null {
  if (!modelIdle(obs) || !obs.isDesign || !obs.guestReady) {
    if (
      modelIdle(obs) &&
      obs.guestReady &&
      lookedOrLookBudgetSpent(obs) &&
      ((Boolean(obs.isGame) && Boolean(obs.gameUnplayable)) ||
        (Boolean(obs.isAsset) && Boolean(obs.assetUnwired))) &&
      (obs.gameUnplayableNudges ?? 0) < MAX_CANVAS_NUDGES
    ) {
      return "gameUnplayableNudge";
    }
    if (
      modelIdle(obs) &&
      Boolean(obs.isGame) &&
      obs.guestReady &&
      lookedOrLookBudgetSpent(obs) &&
      Boolean(obs.unusedLinkedAssets) &&
      (obs.unusedLinkedAssetNudges ?? 0) < MAX_UNUSED_LINKED_ASSET_NUDGES
    ) {
      return "unusedLinkedAssetsNudge";
    }
    if (
      modelIdle(obs) &&
      Boolean(obs.isGame) &&
      obs.guestReady &&
      lookedOrLookBudgetSpent(obs) &&
      Boolean(obs.dryGame) &&
      (obs.gameJuiceNudges ?? 0) < MAX_GAME_JUICE_NUDGES
    ) {
      return "gameJuiceNudge";
    }
    if (
      modelIdle(obs) &&
      Boolean(obs.isAsset) &&
      obs.guestReady &&
      lookedOrLookBudgetSpent(obs) &&
      Boolean(obs.placeholderAsset) &&
      (obs.assetSculptNudges ?? 0) < MAX_ASSET_SCULPT_NUDGES
    ) {
      return "assetSculptNudge";
    }
    return null;
  }
  if ((obs.canvasNudges ?? 0) < MAX_CANVAS_NUDGES && obs.canvasEmpty) return "canvasNudge";
  if (obs.canvasIncomplete && (obs.canvasIncompleteNudges ?? 0) < MAX_CANVAS_NUDGES) {
    return "canvasIncompleteNudge";
  }
  if (
    !obs.canvasEmpty &&
    !incompleteBlocksLook(obs) &&
    (obs.canvasMutatedThisTurn || leftoverCanvasRepair(obs)) &&
    !obs.calledPlaywrightThisTurn &&
    (obs.gamePlaywrightNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "designLookNudge";
  }
  if (
    !obs.canvasEmpty &&
    !obs.canvasIncomplete &&
    !obs.canvasMutatedThisTurn &&
    !leftoverCanvasRepair(obs) &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "designMutateNudge";
  }
  if (
    !obs.canvasEmpty &&
    !obs.canvasIncomplete &&
    wantsCanvasQuality(obs) &&
    lookedOrLookBudgetSpent(obs) &&
    (obs.designQualityNudges ?? 0) < MAX_DESIGN_QUALITY_NUDGES
  ) {
    return "designQualityNudge";
  }
  if (
    lookedOrLookBudgetSpent(obs) &&
    ((Boolean(obs.isGame) && Boolean(obs.gameUnplayable)) ||
      (Boolean(obs.isAsset) && Boolean(obs.assetUnwired))) &&
    (obs.gameUnplayableNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "gameUnplayableNudge";
  }
  if (
    Boolean(obs.isGame) &&
    lookedOrLookBudgetSpent(obs) &&
    Boolean(obs.unusedLinkedAssets) &&
    (obs.unusedLinkedAssetNudges ?? 0) < MAX_UNUSED_LINKED_ASSET_NUDGES
  ) {
    return "unusedLinkedAssetsNudge";
  }
  if (
    Boolean(obs.isGame) &&
    lookedOrLookBudgetSpent(obs) &&
    Boolean(obs.dryGame) &&
    (obs.gameJuiceNudges ?? 0) < MAX_GAME_JUICE_NUDGES
  ) {
    return "gameJuiceNudge";
  }
  if (
    Boolean(obs.isAsset) &&
    lookedOrLookBudgetSpent(obs) &&
    Boolean(obs.placeholderAsset) &&
    (obs.assetSculptNudges ?? 0) < MAX_ASSET_SCULPT_NUDGES
  ) {
    return "assetSculptNudge";
  }
  if (
    !obs.isGame &&
    !obs.isAsset &&
    !obs.canvasEmpty &&
    !obs.canvasIncomplete &&
    Boolean(obs.adherenceIssues) &&
    lookedOrLookBudgetSpent(obs) &&
    (obs.adherenceNudges ?? 0) < MAX_ADHERENCE_NUDGES
  ) {
    return "adherenceNudge";
  }
  return null;
}

function pickToolStudio(obs: StudioContinueObservation): StudioContinueKind | null {
  if (studioLoop(obs) && obs.canvasWiped) return "gameWipeRestore";
  if (
    !(studioLoop(obs) && obs.canvasWiped) &&
    obs.isDesign &&
    obs.canvasIncomplete &&
    (obs.canvasIncompleteNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "canvasIncompleteNudge";
  }
  if (
    studioLoop(obs) &&
    !obs.canvasWiped &&
    lookedOrLookBudgetSpent(obs) &&
    !obs.canvasIncomplete &&
    ((obs.isGame && obs.gameUnplayable) || (obs.isAsset && obs.assetUnwired)) &&
    (obs.gameUnplayableNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "gameUnplayableNudge";
  }
  if (
    studioLoop(obs) &&
    !obs.canvasWiped &&
    !incompleteBlocksLook(obs) &&
    !obs.calledPlaywright &&
    (obs.wroteCanvas || obs.fakePlaytest || leftoverCanvasRepair(obs)) &&
    (obs.gamePlaywrightNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "gamePlaywrightNudge";
  }
  if (
    studioLoop(obs) &&
    obs.isGame &&
    !obs.canvasIncomplete &&
    !obs.canvasWiped &&
    !obs.gameUnplayable &&
    lookedOrLookBudgetSpent(obs) &&
    obs.unusedLinkedAssets &&
    (obs.unusedLinkedAssetNudges ?? 0) < MAX_UNUSED_LINKED_ASSET_NUDGES
  ) {
    return "unusedLinkedAssetsNudge";
  }
  if (
    studioLoop(obs) &&
    wantsStudioFollowUpMutate(obs) &&
    !obs.canvasWiped &&
    !obs.canvasIncomplete &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "designMutateNudge";
  }
  if (
    obs.isDesign &&
    (obs.wroteCanvas || leftoverCanvasRepair(obs)) &&
    !obs.hasToolError &&
    !incompleteBlocksLook(obs) &&
    !obs.canvasWiped &&
    !studioLoop(obs) &&
    !obs.calledPlaywright &&
    (obs.gamePlaywrightNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "gamePlaywrightNudge";
  }
  if (
    obs.isDesign &&
    idle(obs) &&
    !obs.canvasIncomplete &&
    wantsCanvasQuality(obs) &&
    lookedOrLookBudgetSpent(obs) &&
    (obs.designQualityNudges ?? 0) < MAX_DESIGN_QUALITY_NUDGES
  ) {
    return "designQualityNudge";
  }
  if (
    obs.isDesign &&
    !obs.isGame &&
    !obs.isAsset &&
    idle(obs) &&
    !obs.hasToolError &&
    !obs.canvasIncomplete &&
    !obs.canvasWiped &&
    Boolean(obs.adherenceIssues) &&
    lookedOrLookBudgetSpent(obs) &&
    (obs.adherenceNudges ?? 0) < MAX_ADHERENCE_NUDGES
  ) {
    return "adherenceNudge";
  }
  if (
    obs.isDesign &&
    !obs.isGame &&
    !obs.isAsset &&
    idle(obs) &&
    !obs.canvasIncomplete &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES &&
    Boolean(obs.iterateUnchanged)
  ) {
    return "designMutateNudge";
  }
  if (
    studioLoop(obs) &&
    obs.isGame &&
    !obs.canvasIncomplete &&
    !obs.canvasWiped &&
    !obs.gameUnplayable &&
    lookedOrLookBudgetSpent(obs) &&
    Boolean(obs.dryGame) &&
    (obs.gameJuiceNudges ?? 0) < MAX_GAME_JUICE_NUDGES
  ) {
    return "gameJuiceNudge";
  }
  if (
    studioLoop(obs) &&
    obs.isAsset &&
    !obs.canvasIncomplete &&
    !obs.canvasWiped &&
    !obs.assetUnwired &&
    lookedOrLookBudgetSpent(obs) &&
    Boolean(obs.placeholderAsset) &&
    (obs.assetSculptNudges ?? 0) < MAX_ASSET_SCULPT_NUDGES
  ) {
    return "assetSculptNudge";
  }
  if (
    studioLoop(obs) &&
    obs.isGame &&
    !obs.canvasWiped &&
    !obs.canvasIncomplete &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES &&
    Boolean(obs.canvasUnchanged) &&
    Boolean(obs.wroteCanvas)
  ) {
    return "designMutateNudge";
  }
  return null;
}

function pickCliStudio(obs: StudioContinueObservation): StudioContinueKind | null {
  if (obs.isDesign && !obs.planTurn && obs.canvasEmpty && obs.recoveredCanvas) {
    return "canvasRecovered";
  }
  if ((obs.isGame || obs.isAsset) && !obs.planTurn && obs.canvasWiped) return "gameWipeRestore";
  if (
    obs.isDesign &&
    !obs.planTurn &&
    obs.canvasEmpty &&
    (obs.canvasNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "canvasNudge";
  }
  if (
    obs.isDesign &&
    !obs.planTurn &&
    obs.canvasIncomplete &&
    (obs.canvasIncompleteNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "canvasIncompleteNudge";
  }
  if (
    obs.isDesign &&
    !obs.isGame &&
    !obs.isAsset &&
    !obs.planTurn &&
    (Boolean(obs.wroteCanvas) || leftoverCanvasRepair(obs)) &&
    !incompleteBlocksLook(obs) &&
    !obs.calledPlaywright &&
    (obs.gamePlaywrightNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "gamePlaywrightNudge";
  }
  if (
    obs.isDesign &&
    !obs.planTurn &&
    !obs.canvasIncomplete &&
    !obs.canvasEmpty &&
    wantsCanvasQuality(obs) &&
    lookedOrLookBudgetSpent(obs) &&
    (obs.designQualityNudges ?? 0) < MAX_DESIGN_QUALITY_NUDGES
  ) {
    return "designQualityNudge";
  }
  if (
    obs.isDesign &&
    !obs.isGame &&
    !obs.isAsset &&
    !obs.planTurn &&
    !obs.canvasIncomplete &&
    !obs.canvasEmpty &&
    Boolean(obs.adherenceIssues) &&
    lookedOrLookBudgetSpent(obs) &&
    (obs.adherenceNudges ?? 0) < MAX_ADHERENCE_NUDGES
  ) {
    return "adherenceNudge";
  }
  if (
    obs.isDesign &&
    !obs.isGame &&
    !obs.isAsset &&
    !obs.planTurn &&
    !obs.canvasEmpty &&
    !obs.canvasIncomplete &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES &&
    Boolean(obs.iterateUnchanged)
  ) {
    return "designMutateNudge";
  }
  if (
    obs.isDesign &&
    !obs.isGame &&
    !obs.isAsset &&
    !obs.planTurn &&
    !obs.canvasEmpty &&
    !obs.canvasIncomplete &&
    !obs.wroteCanvas &&
    !leftoverCanvasRepair(obs) &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "designMutateNudge";
  }
  if (
    ((obs.isGame && obs.gameUnplayable) || (obs.isAsset && obs.assetUnwired)) &&
    !obs.planTurn &&
    lookedOrLookBudgetSpent(obs) &&
    !obs.canvasIncomplete &&
    (obs.gameUnplayableNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "gameUnplayableNudge";
  }
  if (
    obs.isAsset &&
    !obs.planTurn &&
    obs.playwrightFailed &&
    (obs.gameUnplayableNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "gameUnplayableNudge";
  }
  if (
    (obs.isGame || obs.isAsset) &&
    !obs.planTurn &&
    !incompleteBlocksLook(obs) &&
    !obs.calledPlaywright &&
    (obs.wroteCanvas || obs.fakePlaytest || leftoverCanvasRepair(obs)) &&
    (obs.gamePlaywrightNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "gamePlaywrightNudge";
  }
  if (
    obs.isGame &&
    !obs.planTurn &&
    !obs.canvasIncomplete &&
    !obs.gameUnplayable &&
    lookedOrLookBudgetSpent(obs) &&
    obs.unusedLinkedAssets &&
    (obs.unusedLinkedAssetNudges ?? 0) < MAX_UNUSED_LINKED_ASSET_NUDGES
  ) {
    return "unusedLinkedAssetsNudge";
  }
  if (
    obs.isAsset &&
    !obs.planTurn &&
    !obs.canvasEmpty &&
    !obs.canvasIncomplete &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES &&
    !obs.wroteCanvas &&
    !obs.calledPlaywright
  ) {
    return "designMutateNudge";
  }
  if (
    wantsStudioFollowUpMutate(obs) &&
    !obs.planTurn &&
    !obs.canvasEmpty &&
    !obs.canvasIncomplete &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return "designMutateNudge";
  }
  if (
    obs.isGame &&
    !obs.planTurn &&
    !obs.canvasIncomplete &&
    !obs.gameUnplayable &&
    lookedOrLookBudgetSpent(obs) &&
    Boolean(obs.dryGame) &&
    (obs.gameJuiceNudges ?? 0) < MAX_GAME_JUICE_NUDGES
  ) {
    return "gameJuiceNudge";
  }
  if (
    obs.isAsset &&
    !obs.planTurn &&
    !obs.canvasIncomplete &&
    !obs.assetUnwired &&
    lookedOrLookBudgetSpent(obs) &&
    Boolean(obs.placeholderAsset) &&
    (obs.assetSculptNudges ?? 0) < MAX_ASSET_SCULPT_NUDGES
  ) {
    return "assetSculptNudge";
  }
  if (
    (obs.isGame || obs.isAsset) &&
    !obs.planTurn &&
    !obs.canvasEmpty &&
    !obs.canvasIncomplete &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES &&
    Boolean(obs.canvasUnchanged) &&
    Boolean(obs.wroteCanvas)
  ) {
    return "designMutateNudge";
  }
  return null;
}

/** Ordered Studio continue policy shared by model, tool, and CLI Turn adapters. */
export function pickStudioContinue(obs: StudioContinueObservation): StudioContinueKind | null {
  if (obs.source === "model") return pickModelStudio(obs);
  if (obs.source === "tool") return pickToolStudio(obs);
  return pickCliStudio(obs);
}
