import { MAX_CANVAS_NUDGES } from "@locus/shared";

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
