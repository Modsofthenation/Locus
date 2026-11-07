import { describe, expect, it } from "vitest";
import {
  ASK_USER_TOOL,
  DESIGN_CANVAS_PATH,
  MAX_SELF_CORRECTS_PER_TURN,
  MAX_CANVAS_NUDGES,
  MCP_CALL_NAME,
  MCP_GET_TOOL_INFO_NAME,
  MCP_LIST_TOOLS_NAME,
  READ_SKILL_TOOL,
  RUNTIME_TOOLS,
  WEBSEARCH_TOOL,
} from "@locus/shared";
import type { ExtraToolDef, ToolCall } from "@locus/shared";
import {
  approvalToolOutcome,
  canonicalToolName,
  bumpCliCounters,
  decideAfterCliRound,
  decideAfterModelRound,
  decideAfterToolRound,
  hideHarvestedCanvasChat,
  impliedToolCallsFromReply,
  freezePromptTools,
  cachedTurnAllowedTools,
  parentExtraTools,
  stablePromptExtraTools,
  parentModelToolChoice,
  parentToolKind,
  planToolRefusal,
  runParentToolCalls,
  calledPlaywright,
  calledFakeGamePlaytest,
  calledHudOnlyGamePlaytest,
  calledFakeAssetPlaytest,
  wroteLiveCanvas,
  refundLastRoundSlot,
} from "./agentTurn.js";

const modelBase = {
  toolCallCount: 0,
  hasText: false,
  planTurn: false,
  stopped: false,
  emptyRetries: 0,
  isDesign: false,
  guestReady: false,
  canvasEmpty: false,
  canvasIncomplete: false,
  canvasNudges: 0,
  canvasIncompleteNudges: 0,
  canvasMutatedThisTurn: false,
  designMutateNudges: 0,
};

describe("decideAfterModelRound", () => {
  it("retries a blank reply, then fills, then stops", () => {
    expect(decideAfterModelRound(modelBase)).toEqual({ kind: "retryEmpty" });
    expect(decideAfterModelRound({ ...modelBase, emptyRetries: 2 })).toEqual({ kind: "fillEmpty" });
    expect(decideAfterModelRound({ ...modelBase, hasText: true })).toEqual({ kind: "stop" });
    expect(decideAfterModelRound({ ...modelBase, planTurn: true })).toEqual({ kind: "stop" });
    expect(decideAfterModelRound({ ...modelBase, stopped: true })).toEqual({ kind: "stop" });
  });

  it("nudges an empty design canvas before a filled one, and runs tools when present", () => {
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasEmpty: true,
      }),
    ).toEqual({ kind: "canvasNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasEmpty: true,
        canvasNudges: 1,
      }),
    ).toEqual({ kind: "canvasNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasEmpty: true,
        canvasNudges: MAX_CANVAS_NUDGES,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasEmpty: false,
        canvasIncomplete: true,
        canvasNudges: MAX_CANVAS_NUDGES,
      }),
    ).toEqual({ kind: "canvasIncompleteNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasEmpty: false,
      }),
    ).toEqual({ kind: "designMutateNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasEmpty: false,
        designMutateNudges: 1,
      }),
    ).toEqual({ kind: "designMutateNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasEmpty: false,
        designMutateNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        canvasEmpty: false,
        designMutateNudges: 1,
      }),
    ).toEqual({ kind: "designMutateNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasIncomplete: true,
      }),
    ).toEqual({ kind: "canvasIncompleteNudge", dropBlank: false });
    expect(decideAfterModelRound({ ...modelBase, toolCallCount: 2, hasText: true })).toEqual({
      kind: "runTools",
    });
  });

  it("nudges a review session that stopped without a JSON verdict", () => {
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isReview: true,
        applyReviewVerdict: true,
      }),
    ).toEqual({ kind: "reviewRouting" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isReview: true,
        applyReviewVerdict: true,
        reviewRoutingNudges: 2,
      }),
    ).toEqual({ kind: "reviewVerdictNudge" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isReview: true,
        hasReviewVerdict: true,
        applyReviewVerdict: true,
      }),
    ).toEqual({ kind: "reviewRouting" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isReview: true,
        hasReviewVerdict: true,
        applyReviewVerdict: true,
        calledReview: true,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isReview: true,
        hasReviewVerdict: true,
        applyReviewVerdict: true,
        reviewRoutingNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isReview: true,
        applyReviewVerdict: false,
      }),
    ).toEqual({ kind: "stop" });
  });

  it("nudges coding agents that stop after edits without tests", () => {
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isCoding: true,
        mutatedThisTurn: true,
      }),
    ).toEqual({ kind: "verifyNudge" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isCoding: true,
        mutatedThisTurn: true,
        verifiedThisTurn: true,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isCoding: true,
        mutatedThisTurn: true,
        verifyNudges: 1,
      }),
    ).toEqual({ kind: "verifyNudge" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isCoding: true,
        mutatedThisTurn: true,
        verifyNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isCoding: true,
        searchRounds: 3,
      }),
    ).toEqual({ kind: "searchWander" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isCoding: true,
        searchWanderNudges: 1,
      }),
    ).toEqual({ kind: "searchWander" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isCoding: true,
        searchWanderNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
  });

  it("nudges a design write to look at the canvas before stopping", () => {
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        canvasIncomplete: true,
      }),
    ).toEqual({ kind: "canvasIncompleteNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        canvasIncomplete: true,
        canvasIncompleteNudges: MAX_CANVAS_NUDGES,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 1,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 2,
        genericDesign: true,
      }),
    ).toEqual({ kind: "designQualityNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 2,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "adherenceNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 1,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 2,
        dryGame: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 2,
        gameUnplayable: true,
      }),
    ).toEqual({ kind: "gameUnplayableNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 2,
        unusedLinkedAssets: true,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isAsset: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        genericDesign: true,
      }),
    ).toEqual({ kind: "designQualityNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        genericDesign: true,
        designQualityNudges: 1,
      }),
    ).toEqual({ kind: "designQualityNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        genericDesign: true,
        designQualityNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "adherenceNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        adherenceIssues: true,
        adherenceNudges: 1,
      }),
    ).toEqual({ kind: "adherenceNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        adherenceIssues: true,
        adherenceNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        genericDesign: true,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "designQualityNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isGame: true,
        guestReady: true,
        calledPlaywrightThisTurn: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isGame: true,
        guestReady: true,
        calledPlaywrightThisTurn: true,
        dryGame: true,
        gameJuiceNudges: 1,
      }),
    ).toEqual({ kind: "gameJuiceNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isGame: true,
        guestReady: true,
        calledPlaywrightThisTurn: true,
        dryGame: true,
        gameJuiceNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        gameUnplayable: true,
        unusedLinkedAssets: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "gameUnplayableNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        gameUnplayable: true,
        gameUnplayableNudges: 1,
      }),
    ).toEqual({ kind: "gameUnplayableNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        gameUnplayable: true,
        gameUnplayableNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isAsset: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        assetUnwired: true,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "gameUnplayableNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isGame: true,
        guestReady: true,
        calledPlaywrightThisTurn: true,
        unusedLinkedAssets: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isGame: true,
        guestReady: true,
        calledPlaywrightThisTurn: true,
        unusedLinkedAssets: true,
        unusedLinkedAssetNudges: 1,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isGame: true,
        guestReady: true,
        calledPlaywrightThisTurn: true,
        unusedLinkedAssets: true,
        unusedLinkedAssetNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isAsset: true,
        guestReady: true,
        calledPlaywrightThisTurn: true,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "assetSculptNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isAsset: true,
        guestReady: true,
        calledPlaywrightThisTurn: true,
        placeholderAsset: true,
        assetSculptNudges: 1,
      }),
    ).toEqual({ kind: "assetSculptNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isAsset: true,
        guestReady: true,
        calledPlaywrightThisTurn: true,
        placeholderAsset: true,
        assetSculptNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isAsset: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 2,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "assetSculptNudge", dropBlank: false });
  });

  it("rewrites a host-fallback canvas after a look even when it is not generic", () => {
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        genericDesign: true,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "designQualityNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 2,
        hostFallback: true,
      }),
    ).toEqual({ kind: "designQualityNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        hostFallback: true,
        designQualityNudges: 1,
      }),
    ).toEqual({ kind: "designQualityNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        hostFallback: true,
        designQualityNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        hostFallback: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "designQualityNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isAsset: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "designQualityNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        hostFallback: true,
        canvasIncomplete: true,
      }),
    ).toEqual({ kind: "canvasIncompleteNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        hostFallback: true,
        canvasIncomplete: true,
        canvasIncompleteNudges: MAX_CANVAS_NUDGES,
      }),
    ).toEqual({ kind: "stop" });
  });

  it("looks at leftover dry, placeholder, and generic canvases without a write", () => {
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isAsset: true,
        guestReady: true,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "designLookNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        genericDesign: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "designQualityNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        dryGame: true,
        calledPlaywrightThisTurn: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isAsset: true,
        guestReady: true,
        placeholderAsset: true,
        calledPlaywrightThisTurn: true,
      }),
    ).toEqual({ kind: "assetSculptNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        unusedLinkedAssets: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        unusedLinkedAssets: true,
        dryGame: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isGame: true,
        guestReady: true,
        gameUnplayable: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "gameUnplayableNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        isAsset: true,
        guestReady: true,
        assetUnwired: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "gameUnplayableNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
        adherenceIssues: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "adherenceNudge", dropBlank: false });
    expect(
      decideAfterModelRound({
        ...modelBase,
        hasText: true,
        isDesign: true,
        guestReady: true,
      }),
    ).toEqual({ kind: "designMutateNudge", dropBlank: false });
  });
});

const cliBase = {
  aborted: false,
  isDesign: false,
  planTurn: false,
  canvasEmpty: false,
  canvasIncomplete: false,
  recoveredCanvas: false,
  canvasNudges: 0,
  canvasIncompleteNudges: 0,
  isReview: false,
  hasVerdict: false,
  applyThisTurn: true,
  reviewVerdictNudges: 0,
};

describe("decideAfterCliRound", () => {
  it("steers, nudges an empty canvas, then stops", () => {
    expect(decideAfterCliRound({ ...cliBase, steeredPrompt: "keep going" })).toEqual({
      kind: "steer",
      prompt: "keep going",
    });
    expect(decideAfterCliRound({ ...cliBase, isDesign: true, canvasEmpty: true })).toEqual({
      kind: "canvasNudge",
    });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        canvasEmpty: true,
        recoveredCanvas: true,
      }),
    ).toEqual({ kind: "canvasRecovered" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        recoveredCanvas: true,
        wroteCanvas: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 1,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
        genericDesign: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "adherenceNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        genericDesign: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        genericDesign: true,
        designQualityNudges: 1,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        genericDesign: true,
        designQualityNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "adherenceNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        adherenceIssues: true,
        adherenceNudges: 1,
      }),
    ).toEqual({ kind: "adherenceNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        adherenceIssues: true,
        adherenceNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        genericDesign: true,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(decideAfterCliRound({ ...cliBase, isReview: true, applyThisTurn: true })).toEqual({
      kind: "reviewRouting",
    });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isReview: true,
        applyThisTurn: true,
        reviewRoutingNudges: 2,
      }),
    ).toEqual({ kind: "reviewVerdictNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        canvasIncomplete: true,
      }),
    ).toEqual({ kind: "canvasIncompleteNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        canvasIncomplete: true,
        canvasNudges: MAX_CANVAS_NUDGES,
        wroteCanvas: true,
      }),
    ).toEqual({ kind: "canvasIncompleteNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        canvasIncomplete: true,
        canvasIncompleteNudges: MAX_CANVAS_NUDGES,
        wroteCanvas: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        canvasIncomplete: true,
        canvasIncompleteNudges: MAX_CANVAS_NUDGES,
        wroteCanvas: true,
        calledPlaywright: true,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        canvasIncomplete: true,
        canvasIncompleteNudges: MAX_CANVAS_NUDGES,
        wroteCanvas: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        calledPlaywright: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        designMutateNudges: 1,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        genericDesign: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        designMutateNudges: 1,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        designMutateNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        genericDesign: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        adherenceIssues: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "adherenceNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        designMutateNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(decideAfterCliRound(cliBase)).toEqual({ kind: "stop" });
  });

  it("nudges a search-only coding spawn to edit, then unverified edits to test", () => {
    expect(
      decideAfterCliRound({
        ...cliBase,
        isCoding: true,
        searchRounds: 3,
      }),
    ).toEqual({ kind: "searchWander" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isCoding: true,
        searchRounds: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isCoding: true,
        searchRounds: 3,
        mutatedThisTurn: true,
      }),
    ).toEqual({ kind: "verifyNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isCoding: true,
        mutatedThisTurn: true,
      }),
    ).toEqual({ kind: "verifyNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isCoding: true,
        mutatedThisTurn: true,
        verifiedThisTurn: true,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isCoding: true,
        mutatedThisTurn: true,
        verifyNudges: 1,
      }),
    ).toEqual({ kind: "verifyNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isCoding: true,
        mutatedThisTurn: true,
        verifyNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isCoding: true,
        searchRounds: 3,
        searchWanderNudges: 1,
      }),
    ).toEqual({ kind: "searchWander" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isCoding: true,
        searchWanderNudges: 1,
      }),
    ).toEqual({ kind: "searchWander" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isCoding: true,
        searchWanderNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isCoding: true,
        mutatedThisTurn: true,
        fixableFailure: {
          name: "apply_patch",
          id: "t1",
          error: '{"error":"failed to apply patch"}',
        },
      }),
    ).toEqual({ kind: "selfCorrect", error: '{"error":"failed to apply patch"}' });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isCoding: true,
        mutatedThisTurn: true,
        fixableFailure: {
          name: "apply_patch",
          id: "t1",
          error: '{"error":"failed to apply patch"}',
        },
        selfCorrects: 2,
      }),
    ).toEqual({ kind: "verifyNudge" });
  });

  it("nudges a search-heavy CLI ops or review spawn before a coding wander", () => {
    expect(
      decideAfterCliRound({
        ...cliBase,
        namedOps: true,
        searchRounds: 4,
      }),
    ).toEqual({ kind: "opsRouting" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        namedOps: true,
        calledOps: true,
        searchRounds: 4,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isReview: true,
        applyThisTurn: true,
        searchRounds: 2,
      }),
    ).toEqual({ kind: "reviewRouting" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isReview: true,
        applyThisTurn: true,
        calledReview: true,
      }),
    ).toEqual({ kind: "reviewVerdictNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isReview: true,
        applyThisTurn: true,
        hasVerdict: true,
        searchRounds: 2,
      }),
    ).toEqual({ kind: "reviewRouting" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isReview: true,
        applyThisTurn: true,
        hasVerdict: true,
        calledReview: true,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isReview: true,
        applyThisTurn: true,
        hasVerdict: true,
        searchRounds: 2,
        reviewRoutingNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
  });

  it("nudges Games to restore a wipe, playtest with playwright, and skip fake Node checks", () => {
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        canvasWiped: true,
      }),
    ).toEqual({ kind: "gameWipeRestore" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        gameUnplayable: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        gameUnplayable: true,
      }),
    ).toEqual({ kind: "gameUnplayableNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        calledPlaywright: true,
        assetUnwired: true,
      }),
    ).toEqual({ kind: "gameUnplayableNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 1,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
        dryGame: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
        unusedLinkedAssets: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        fakePlaytest: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        dryGame: true,
        gameJuiceNudges: 1,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        dryGame: true,
        gameJuiceNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        canvasUnchanged: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        canvasUnchanged: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        canvasUnchanged: true,
        dryGame: true,
        followUpMissing: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        canvasUnchanged: true,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        canvasUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        followUpMissing: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        followUpMissing: true,
        designMutateNudges: 1,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        followUpMissing: true,
        designMutateNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        followUpMissing: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        iterateUnchanged: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        iterateUnchanged: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        calledPlaywright: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        designMutateNudges: 1,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        designMutateNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        unusedLinkedAssets: true,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "assetSculptNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        placeholderAsset: true,
        assetSculptNudges: 1,
      }),
    ).toEqual({ kind: "assetSculptNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        placeholderAsset: true,
        assetSculptNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        canvasUnchanged: true,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "assetSculptNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        assetUnwired: true,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        playwrightFailed: true,
      }),
    ).toEqual({ kind: "gameUnplayableNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        canvasWiped: true,
        wroteCanvas: true,
        gameWipeNudges: 2,
      }),
    ).toEqual({ kind: "gameWipeRestore" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        gameUnplayable: true,
        gameUnplayableNudges: 2,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isGame: true,
        calledPlaywright: true,
        unusedLinkedAssets: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        unusedLinkedAssets: true,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        unusedLinkedAssets: true,
        unusedLinkedAssetNudges: 1,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        unusedLinkedAssets: true,
        unusedLinkedAssetNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isGame: true,
        planTurn: true,
        canvasWiped: true,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        canvasEmpty: true,
        canvasWiped: true,
        recoveredCanvas: true,
      }),
    ).toEqual({ kind: "canvasRecovered" });
  });

  it("nudges Assets for unwired 3D, HUD-only playtests, wipes, and zero-diff writes", () => {
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        canvasWiped: true,
      }),
    ).toEqual({ kind: "gameWipeRestore" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        assetUnwired: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 1,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "assetSculptNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        fakePlaytest: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        canvasUnchanged: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        canvasUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        calledPlaywright: true,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        canvasUnchanged: true,
        designMutateNudges: 1,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        canvasUnchanged: true,
        designMutateNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
  });
});

describe("bumpCliCounters", () => {
  const zeros = {
    canvasNudges: 0,
    canvasIncompleteNudges: 0,
    reviewVerdictNudges: 0,
    gameWipeNudges: 0,
    gameUnplayableNudges: 0,
    gamePlaywrightNudges: 0,
    designMutateNudges: 0,
    unusedLinkedAssetNudges: 0,
    searchWanderNudges: 0,
    verifyNudges: 0,
    opsRoutingNudges: 0,
    reviewRoutingNudges: 0,
    selfCorrects: 0,
    designQualityNudges: 0,
    gameJuiceNudges: 0,
    assetSculptNudges: 0,
    adherenceNudges: 0,
  };

  it("increments the counter that matches the continue decision", () => {
    expect(bumpCliCounters(zeros, "canvasNudge").canvasNudges).toBe(1);
    expect(bumpCliCounters(zeros, "canvasNudge").canvasIncompleteNudges).toBe(0);
    expect(bumpCliCounters(zeros, "canvasIncompleteNudge").canvasNudges).toBe(0);
    expect(bumpCliCounters(zeros, "canvasIncompleteNudge").canvasIncompleteNudges).toBe(1);
    expect(bumpCliCounters(zeros, "reviewVerdictNudge").reviewVerdictNudges).toBe(1);
    expect(bumpCliCounters(zeros, "gameWipeNudge").gameWipeNudges).toBe(1);
    expect(bumpCliCounters(zeros, "gameWipeRestore").gameWipeNudges).toBe(1);
    expect(bumpCliCounters(zeros, "gameUnplayableNudge").gameUnplayableNudges).toBe(1);
    expect(bumpCliCounters(zeros, "gamePlaywrightNudge").gamePlaywrightNudges).toBe(1);
    expect(bumpCliCounters(zeros, "designMutateNudge").designMutateNudges).toBe(1);
    expect(bumpCliCounters(zeros, "unusedLinkedAssetsNudge").unusedLinkedAssetNudges).toBe(1);
    expect(bumpCliCounters(zeros, "searchWander").searchWanderNudges).toBe(1);
    expect(bumpCliCounters(zeros, "verifyNudge").verifyNudges).toBe(1);
    expect(bumpCliCounters(zeros, "opsRouting").opsRoutingNudges).toBe(1);
    expect(bumpCliCounters(zeros, "reviewRouting").reviewRoutingNudges).toBe(1);
    expect(bumpCliCounters(zeros, "selfCorrect").selfCorrects).toBe(1);
    expect(bumpCliCounters(zeros, "designQualityNudge").designQualityNudges).toBe(1);
    expect(bumpCliCounters(zeros, "gameJuiceNudge").gameJuiceNudges).toBe(1);
    expect(bumpCliCounters(zeros, "assetSculptNudge").assetSculptNudges).toBe(1);
    expect(bumpCliCounters(zeros, "adherenceNudge").adherenceNudges).toBe(1);
    expect(bumpCliCounters(zeros, "stop")).toEqual(zeros);
  });

  it("rewrites a host-fallback canvas after a look even when it is not generic", () => {
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        genericDesign: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        genericDesign: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        dryGame: true,
        calledPlaywright: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isGame: true,
        unusedLinkedAssets: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isGame: true,
        unusedLinkedAssets: true,
        dryGame: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        gameUnplayable: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "gameUnplayableNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        assetUnwired: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "gameUnplayableNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        adherenceIssues: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "adherenceNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
        hostFallback: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
        designQualityNudges: 2,
      }),
    ).toEqual({ kind: "stop" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
        canvasIncomplete: true,
      }),
    ).toEqual({ kind: "canvasIncompleteNudge" });
    expect(
      decideAfterCliRound({
        ...cliBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
        canvasIncomplete: true,
        canvasIncompleteNudges: MAX_CANVAS_NUDGES,
      }),
    ).toEqual({ kind: "stop" });
  });
});

describe("decideAfterToolRound", () => {
  const toolBase = {
    isDesign: false,
    wroteCanvas: false,
    canvasIncomplete: false,
    canvasIncompleteNudges: 0,
    hasToolError: false,
    planTurn: false,
    stopped: false,
    budgetOk: true,
    budgetMessage: "",
    selfCorrects: 0,
    lastRound: false,
  };

  it("stops on a live canvas write or a budget miss, else continues", () => {
    expect(decideAfterToolRound({ ...toolBase, isDesign: true, wroteCanvas: true })).toEqual({
      kind: "gamePlaywrightNudge",
    });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        genericDesign: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        genericDesign: true,
        designQualityNudges: 1,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        genericDesign: true,
        designQualityNudges: 2,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        followUpMissing: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        iterateUnchanged: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        iterateUnchanged: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        calledPlaywright: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        designMutateNudges: 1,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        designMutateNudges: 2,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        genericDesign: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        adherenceIssues: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "adherenceNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        canvasIncomplete: true,
      }),
    ).toEqual({ kind: "canvasIncompleteNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        gameUnplayable: true,
        gameUnplayableNudges: 0,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        gameUnplayable: true,
      }),
    ).toEqual({ kind: "gameUnplayableNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        calledPlaywright: true,
        assetUnwired: true,
      }),
    ).toEqual({ kind: "gameUnplayableNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        canvasIncomplete: true,
        canvasWiped: true,
      }),
    ).toEqual({ kind: "gameWipeRestore" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 1,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
        dryGame: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
        genericDesign: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        dryGame: true,
        gameJuiceNudges: 1,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        dryGame: true,
        gameJuiceNudges: 2,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        canvasUnchanged: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        canvasUnchanged: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        canvasUnchanged: true,
        dryGame: true,
        followUpMissing: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        canvasUnchanged: true,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        canvasUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        followUpMissing: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        followUpMissing: true,
        designMutateNudges: 1,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        followUpMissing: true,
        designMutateNudges: 2,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        calledPlaywright: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        designMutateNudges: 1,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        designMutateNudges: 2,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        unusedLinkedAssets: true,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        calledPlaywright: true,
        iterateUnchanged: true,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "designMutateNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        iterateUnchanged: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        calledPlaywright: true,
        unusedLinkedAssets: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        unusedLinkedAssets: true,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        unusedLinkedAssets: true,
        unusedLinkedAssetNudges: 1,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        unusedLinkedAssets: true,
        unusedLinkedAssetNudges: 2,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        fakePlaytest: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        assetUnwired: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        gamePlaywrightNudges: 2,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "assetSculptNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        fakePlaytest: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "assetSculptNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        placeholderAsset: true,
        assetSculptNudges: 1,
      }),
    ).toEqual({ kind: "assetSculptNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        placeholderAsset: true,
        assetSculptNudges: 2,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        assetUnwired: true,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        canvasWiped: true,
      }),
    ).toEqual({ kind: "gameWipeRestore" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        canvasWiped: true,
        gameWipeNudges: 2,
        calledPlaywright: true,
      }).kind,
    ).toBe("gameWipeRestore");
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        canvasWiped: true,
        planTurn: true,
      }).kind,
    ).toBe("continue");
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: false,
        canvasIncomplete: true,
      }),
    ).toEqual({ kind: "canvasIncompleteNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        canvasIncomplete: true,
        canvasIncompleteNudges: MAX_CANVAS_NUDGES,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        canvasIncomplete: true,
        canvasIncompleteNudges: MAX_CANVAS_NUDGES,
        calledPlaywright: true,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        canvasIncomplete: true,
        canvasIncompleteNudges: MAX_CANVAS_NUDGES,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        adherenceIssues: true,
        adherenceNudges: 0,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        adherenceIssues: true,
        adherenceNudges: 1,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        adherenceIssues: true,
        adherenceNudges: 2,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "adherenceNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        calledPlaywright: true,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "adherenceNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        genericDesign: true,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        adherenceIssues: true,
        adherenceNudges: 2,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(decideAfterToolRound({ ...toolBase, budgetOk: false, budgetMessage: "cap" })).toEqual({
      kind: "budgetStop",
      message: "cap",
    });
    expect(
      decideAfterToolRound({
        ...toolBase,
        lastRound: true,
        fixableFailure: { name: "exec", id: "t1", error: "Error: boom" },
      }),
    ).toEqual({
      kind: "continue",
      selfCorrect: { name: "exec", id: "t1", error: "Error: boom" },
      usedAllRounds: true,
    });
    expect(
      decideAfterToolRound({
        ...toolBase,
        namedOps: true,
        searchRounds: 4,
        opsRoutingNudges: 0,
        fixableFailure: { name: "exec", id: "t1", error: "Error: boom" },
      }),
    ).toEqual({
      kind: "continue",
      selfCorrect: undefined,
      opsRouting: true,
      usedAllRounds: false,
    });
    expect(
      decideAfterToolRound({
        ...toolBase,
        selfCorrects: MAX_SELF_CORRECTS_PER_TURN,
        fixableFailure: { name: "exec", id: "t1", error: "Error: boom" },
      }),
    ).toEqual({ kind: "continue", selfCorrect: undefined, usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isReview: true,
        searchRounds: 2,
        reviewRoutingNudges: 0,
        fixableFailure: { name: "exec", id: "t1", error: "Error: boom" },
      }),
    ).toEqual({
      kind: "continue",
      selfCorrect: undefined,
      reviewRouting: true,
      usedAllRounds: false,
    });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isReview: true,
        applyThisTurn: true,
        lastRound: true,
      }),
    ).toEqual({
      kind: "continue",
      selfCorrect: undefined,
      reviewRouting: true,
      usedAllRounds: true,
    });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isReview: true,
        applyThisTurn: true,
        calledReview: true,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isCoding: true,
        mutatedThisTurn: true,
      }),
    ).toEqual({ kind: "verifyNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isCoding: true,
        mutatedThisTurn: true,
        lastRound: true,
      }),
    ).toEqual({ kind: "verifyNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isCoding: true,
        mutatedThisTurn: true,
        verifiedThisTurn: true,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isCoding: true,
        mutatedThisTurn: true,
        verifyNudges: 1,
      }),
    ).toEqual({ kind: "verifyNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isCoding: true,
        mutatedThisTurn: true,
        verifyNudges: 2,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isCoding: true,
        searchRounds: 3,
        searchWanderNudges: 0,
        fixableFailure: { name: "exec", id: "t1", error: "Error: boom" },
      }),
    ).toEqual({
      kind: "continue",
      selfCorrect: undefined,
      searchWander: true,
      usedAllRounds: false,
    });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isCoding: true,
        searchWanderNudges: 1,
        fixableFailure: { name: "exec", id: "t1", error: "Error: boom" },
      }),
    ).toEqual({
      kind: "continue",
      selfCorrect: undefined,
      searchWander: true,
      usedAllRounds: false,
    });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isCoding: true,
        searchWanderNudges: 2,
        fixableFailure: { name: "exec", id: "t1", error: "Error: boom" },
      }),
    ).toEqual({
      kind: "continue",
      selfCorrect: { name: "exec", id: "t1", error: "Error: boom" },
      usedAllRounds: false,
    });
  });

  it("still fires canvas and routing walls on the last round so a refunded slot can patch", () => {
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        genericDesign: true,
        lastRound: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        dryGame: true,
        lastRound: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        placeholderAsset: true,
        lastRound: true,
      }),
    ).toEqual({ kind: "assetSculptNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        adherenceIssues: true,
        lastRound: true,
      }),
    ).toEqual({ kind: "adherenceNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        unusedLinkedAssets: true,
        lastRound: true,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        gameUnplayable: true,
        lastRound: true,
      }),
    ).toEqual({ kind: "gameUnplayableNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        lastRound: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        canvasIncomplete: true,
        lastRound: true,
      }),
    ).toEqual({ kind: "canvasIncompleteNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isReview: true,
        searchRounds: 2,
        lastRound: true,
      }),
    ).toEqual({
      kind: "continue",
      selfCorrect: undefined,
      reviewRouting: true,
      usedAllRounds: true,
    });
  });

  it("rewrites a host-fallback canvas after a look even when it is not generic", () => {
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        genericDesign: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        placeholderAsset: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        adherenceIssues: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        genericDesign: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        dryGame: true,
        calledPlaywright: true,
      }),
    ).toEqual({ kind: "gameJuiceNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        unusedLinkedAssets: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        unusedLinkedAssets: true,
        dryGame: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        gameUnplayable: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "gameUnplayableNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        assetUnwired: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "gameUnplayableNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        adherenceIssues: true,
        gamePlaywrightNudges: 2,
      }),
    ).toEqual({ kind: "adherenceNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        unusedLinkedAssets: true,
        gamePlaywrightNudges: 2,
        lastRound: true,
      }),
    ).toEqual({ kind: "unusedLinkedAssetsNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "gamePlaywrightNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
        lastRound: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isGame: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
        dryGame: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        isAsset: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
      }),
    ).toEqual({ kind: "designQualityNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
        designQualityNudges: 2,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
        canvasIncomplete: true,
      }),
    ).toEqual({ kind: "canvasIncompleteNudge" });
    expect(
      decideAfterToolRound({
        ...toolBase,
        isDesign: true,
        wroteCanvas: true,
        calledPlaywright: true,
        hostFallback: true,
        canvasIncomplete: true,
        canvasIncompleteNudges: MAX_CANVAS_NUDGES,
      }),
    ).toEqual({ kind: "continue", usedAllRounds: false });
  });
});

describe("refundLastRoundSlot", () => {
  it("refunds only the last bounded round", () => {
    expect(refundLastRoundSlot(7, 8)).toBe(6);
    expect(refundLastRoundSlot(6, 8)).toBe(6);
    expect(refundLastRoundSlot(0, 1)).toBe(-1);
    expect(refundLastRoundSlot(3, null)).toBe(3);
    expect(refundLastRoundSlot(3, undefined)).toBe(3);
  });
});

describe("wroteLiveCanvas", () => {
  it("counts a successful canvas write or patch, not a failed one", () => {
    expect(
      wroteLiveCanvas([
        {
          id: "1",
          name: "file_write",
          arguments: { path: DESIGN_CANVAS_PATH, content: "<html></html>" },
          startedAt: "",
        },
      ]),
    ).toBe(true);
    expect(
      wroteLiveCanvas([
        {
          id: "1",
          name: "write",
          arguments: { path: DESIGN_CANVAS_PATH, content: "<html></html>" },
          startedAt: "",
        },
      ]),
    ).toBe(true);
    expect(
      wroteLiveCanvas([
        {
          id: "1",
          name: "file_write",
          arguments: { path: DESIGN_CANVAS_PATH },
          error: "denied",
          startedAt: "",
        },
      ]),
    ).toBe(false);
    expect(
      wroteLiveCanvas([
        {
          id: "1",
          name: "apply_patch",
          arguments: {
            patch: `--- a/workspace/index.html\n+++ b/workspace/index.html\n@@ -1 +1 @@\n-<p></p>\n+<p>hi</p>\n`,
          },
          startedAt: "",
        },
      ]),
    ).toBe(true);
    expect(
      wroteLiveCanvas([
        {
          id: "1",
          name: "apply_patch",
          arguments: {
            path: DESIGN_CANVAS_PATH,
            streamContent: '    <button type="button" id="bMode">Mode: Race</button>',
          },
          startedAt: "",
        },
      ]),
    ).toBe(true);
    expect(
      wroteLiveCanvas([
        {
          id: "1",
          name: "apply_patch",
          arguments: {
            path: DESIGN_CANVAS_PATH,
            streamContent: "<div id='over'></div>",
          },
          result: '{"error":"index.html changed on disk after this tool call read it."}',
          startedAt: "",
        },
      ]),
    ).toBe(false);
  });
});

describe("calledPlaywright", () => {
  it("counts playwright and MCP aliases, and flags a fake Node playtest", () => {
    expect(
      calledPlaywright([
        { id: "1", name: "playwright", arguments: { click: "#go" }, startedAt: "" },
      ]),
    ).toBe(true);
    expect(
      calledPlaywright([
        { id: "1", name: "CallMcpTool", arguments: { name: "playwright" }, startedAt: "" },
      ]),
    ).toBe(true);
    expect(
      calledPlaywright([
        { id: "1", name: "file_write", arguments: { path: "index.html" }, startedAt: "" },
      ]),
    ).toBe(false);
    expect(
      calledFakeGamePlaytest([
        {
          id: "1",
          name: "run_terminal_cmd",
          arguments: { command: "node .locus-game/_chk.mjs" },
          result: "ok 62477",
          startedAt: "",
        },
      ]),
    ).toBe(true);
    expect(
      calledFakeGamePlaytest([
        { id: "1", name: "playwright", arguments: { click: "text=Skirmish" }, startedAt: "" },
      ]),
    ).toBe(false);
    expect(
      calledFakeGamePlaytest([
        {
          id: "1",
          name: "playwright",
          arguments: { steps: ["click #bRestart", "expect road #"] },
          startedAt: "",
        },
      ]),
    ).toBe(true);
    expect(
      calledHudOnlyGamePlaytest([
        {
          id: "1",
          name: "playwright",
          arguments: { click: "#bRestart", expect_text: "bumps" },
          startedAt: "",
        },
      ]),
    ).toBe(true);
    expect(
      calledHudOnlyGamePlaytest([
        {
          id: "1",
          name: "playwright",
          arguments: { steps: ["click #bMode", "press ArrowUp"] },
          startedAt: "",
        },
      ]),
    ).toBe(false);
    expect(
      calledHudOnlyGamePlaytest([
        {
          id: "1",
          name: "playwright",
          arguments: { click: "#bRestart", expect_text: "bumps" },
          startedAt: "",
        },
        {
          id: "2",
          name: "playwright",
          arguments: { steps: ["click #bMode", "press ArrowUp"] },
          startedAt: "",
        },
      ]),
    ).toBe(false);
    expect(
      calledFakeAssetPlaytest([
        {
          id: "1",
          name: "playwright",
          arguments: { clicks: ["#btnWalk"], expect_text: "css-3d" },
          startedAt: "",
        },
      ]),
    ).toBe(true);
    expect(
      calledFakeAssetPlaytest([
        { id: "1", name: "playwright", arguments: { click: "#btnWire" }, startedAt: "" },
      ]),
    ).toBe(false);
  });
});

describe("runParentToolCalls", () => {
  function call(id: string, name = "grep"): ToolCall {
    return { id, name, arguments: { pattern: "x" }, startedAt: "" };
  }

  it("replays a prior result, then executes remaining calls serially", async () => {
    const executed: string[] = [];
    const finished: string[] = [];
    await runParentToolCalls([call("a"), call("b")], {
      stop: () => false,
      stale: () => false,
      parallel: false,
      now: () => "t",
      priorResult: async (id) => (id === "a" ? "cached" : undefined),
      execute: async (row) => {
        executed.push(row.id);
        return { ok: true, output: `ran ${row.id}` };
      },
      hooks: {
        start: async () => undefined,
        finish: async (row) => {
          finished.push(row.id);
        },
      },
    });
    expect(executed).toEqual(["b"]);
    expect(finished).toEqual(["b"]);
  });

  it("runs parallel calls together and skips work after stop", async () => {
    const executed: string[] = [];
    await runParentToolCalls([call("a"), call("b")], {
      stop: () => executed.length >= 1,
      stale: () => false,
      parallel: false,
      now: () => "t",
      priorResult: async () => undefined,
      execute: async (row) => {
        executed.push(row.id);
        return { ok: true, output: row.id };
      },
      hooks: {
        start: async () => undefined,
        finish: async () => undefined,
      },
    });
    expect(executed).toEqual(["a"]);

    const parallel: string[] = [];
    await runParentToolCalls([call("a"), call("b")], {
      stop: () => false,
      stale: () => false,
      parallel: true,
      now: () => "t",
      priorResult: async () => undefined,
      execute: async (row) => {
        parallel.push(row.id);
        return { ok: true, output: row.id };
      },
      hooks: {
        start: async () => undefined,
        finish: async () => undefined,
      },
    });
    expect(parallel.sort()).toEqual(["a", "b"]);
  });

  it("records a failure when a tool returns no result", async () => {
    const finished: string[] = [];
    await runParentToolCalls([call("a")], {
      stop: () => false,
      stale: () => false,
      parallel: false,
      now: () => "t",
      priorResult: async () => undefined,
      execute: async () => undefined,
      hooks: {
        start: async () => undefined,
        finish: async (row, result) => {
          finished.push(`${row.id}:${result.output}`);
        },
      },
    });
    expect(finished).toEqual(["a:Tool did not return a result"]);
  });

  it("closes tool calls that never started after stop", async () => {
    const ran: string[] = [];
    const finished: string[] = [];
    await runParentToolCalls([call("a"), call("b")], {
      stop: () => ran.length > 0,
      stale: () => false,
      parallel: false,
      now: () => "t",
      priorResult: async () => undefined,
      execute: async (row) => {
        ran.push(row.id);
        return { ok: true, output: row.id };
      },
      hooks: {
        start: async () => undefined,
        finish: async (row, result) => {
          finished.push(`${row.id}:${result.output}`);
        },
      },
    });
    expect(finished).toEqual(["a:a", "b:Cancelled"]);
  });

  it("does not record a result after the turn epoch goes stale", async () => {
    let started = false;
    const finished: string[] = [];
    await runParentToolCalls([call("a")], {
      stop: () => false,
      stale: () => started,
      parallel: false,
      now: () => "t",
      priorResult: async () => undefined,
      execute: async () => {
        started = true;
        return undefined;
      },
      hooks: {
        start: async () => undefined,
        finish: async (row) => {
          finished.push(row.id);
        },
      },
    });
    expect(finished).toEqual([]);
  });
});

describe("canonicalToolName", () => {
  it("maps Cursor and Claude write/read aliases onto catalog names", () => {
    expect(canonicalToolName("read")).toBe("file_read");
    expect(canonicalToolName("Read")).toBe("file_read");
    expect(canonicalToolName("read_file")).toBe("file_read");
    expect(canonicalToolName("file_read")).toBe("file_read");
    expect(canonicalToolName("write")).toBe("file_write");
    expect(canonicalToolName("Write")).toBe("file_write");
    expect(canonicalToolName("write_file")).toBe("file_write");
    expect(canonicalToolName("exec")).toBe("exec");
    expect(canonicalToolName("searchReplace")).toBe("apply_patch");
    expect(canonicalToolName("StrReplace")).toBe("apply_patch");
    expect(canonicalToolName("Edit")).toBe("apply_patch");
    expect(canonicalToolName("Shell")).toBe("exec");
    expect(canonicalToolName("Bash")).toBe("exec");
    expect(canonicalToolName("Grep")).toBe("grep");
    expect(canonicalToolName("Glob")).toBe("glob");
    expect(canonicalToolName("LS")).toBe("file_list");
  });
});

describe("parent tool policy", () => {
  it("refuses mutating tools in plan mode and routes approval vs execute", () => {
    expect(planToolRefusal("apply_patch", true)).toMatch(/read-only/);
    expect(planToolRefusal("grep", true)).toBeUndefined();
    expect(planToolRefusal("repo_map", true)).toBeUndefined();
    expect(planToolRefusal("exec", true, { command: "npm test" })).toBeUndefined();
    expect(planToolRefusal("exec", true, { command: "git commit -am wip" })).toMatch(/tests/);
    expect(parentToolKind("apply_patch", { planTurn: true, needsApproval: true })).toBe(
      "planRefuse",
    );
    expect(
      parentToolKind("exec", {
        planTurn: true,
        needsApproval: false,
        args: { command: "npm test" },
      }),
    ).toBe("execute");
    expect(parentToolKind("exec", { planTurn: false, needsApproval: true })).toBe("approval");
    expect(parentToolKind("grep", { planTurn: false, needsApproval: false })).toBe("execute");
  });

  it("maps approval outcomes for ask_user and mutating tools", () => {
    expect(approvalToolOutcome({ askUser: true, decision: "denied" })).toEqual({
      kind: "refused",
      approval: "denied",
      result: { ok: false, output: "The operator declined to answer." },
    });
    expect(approvalToolOutcome({ askUser: false, decision: "cancelled" })).toMatchObject({
      kind: "refused",
      result: { output: "Cancelled" },
    });
    expect(approvalToolOutcome({ askUser: true, decision: "approved", answer: "  red  " })).toEqual(
      {
        kind: "answered",
        approval: "approved",
        result: { ok: true, output: "red" },
      },
    );
    expect(approvalToolOutcome({ askUser: false, decision: "approved" })).toEqual({
      kind: "run",
      approval: "approved",
    });
  });

  it("recovers embedded tool calls and a design HTML dump", () => {
    expect(
      impliedToolCallsFromReply({
        planTurn: false,
        hasToolCalls: false,
        isDesign: false,
        guestReady: true,
        canvasEmpty: true,
        content: '```json\n{"name":"grep","arguments":{"pattern":"x"}}\n```',
      }),
    ).toEqual([{ name: "grep", arguments: { pattern: "x" } }]);
    expect(
      impliedToolCallsFromReply({
        planTurn: false,
        hasToolCalls: false,
        isDesign: true,
        guestReady: true,
        canvasEmpty: true,
        content: "<html><body><p>Hi</p></body></html>",
      }),
    ).toMatchObject([{ name: "file_write", arguments: { path: DESIGN_CANVAS_PATH } }]);
    expect(
      impliedToolCallsFromReply({
        planTurn: false,
        hasToolCalls: false,
        isDesign: true,
        guestReady: true,
        canvasEmpty: false,
        content: "<!doctype html><html><body><p>Harbor</p></body></html>",
      }),
    ).toMatchObject([{ name: "file_write", arguments: { path: DESIGN_CANVAS_PATH } }]);
    expect(
      impliedToolCallsFromReply({
        planTurn: true,
        hasToolCalls: false,
        isDesign: true,
        guestReady: true,
        canvasEmpty: true,
        content: "<html></html>",
      }),
    ).toEqual([]);
  });

  it("strips harvested canvas HTML from the assistant bubble", () => {
    const html = `<!DOCTYPE html>\n<html><body>${"x".repeat(400)}</body></html>`;
    expect(hideHarvestedCanvasChat(`Draft:\n${html}`, [{ name: "file_write" }])).toBe("Draft:");
    expect(hideHarvestedCanvasChat(html, [{ name: "grep" }])).toBe(html);
  });
});

function extra(name: string): ExtraToolDef {
  return { name, description: name, parameters: { type: "object", properties: {} } };
}

const extraBase = {
  planTurn: false,
  isDesign: false,
  inSubagent: false,
  webSearch: false,
  hasSkills: false,
  allowAskUser: false,
  mcpTools: [] as ExtraToolDef[],
};

describe("parentExtraTools", () => {
  it("offers plan extras without spawn_agent or websearch", () => {
    const names = parentExtraTools({
      ...extraBase,
      planTurn: true,
      webSearch: true,
      hasSkills: true,
      allowAskUser: true,
      mcpTools: [extra(MCP_LIST_TOOLS_NAME), extra(MCP_CALL_NAME), extra(MCP_GET_TOOL_INFO_NAME)],
    }).map((tool) => tool.name);
    expect(names).toEqual([
      "task_list",
      "repo_map",
      "orient",
      "find_entity",
      "get_entity",
      "search_knowledge",
      "correct_graph",
      READ_SKILL_TOOL.name,
      ASK_USER_TOOL.name,
      MCP_LIST_TOOLS_NAME,
      MCP_GET_TOOL_INFO_NAME,
    ]);
  });

  it("drops runtime tools on design coding turns and keeps websearch", () => {
    const names = parentExtraTools({
      ...extraBase,
      isDesign: true,
      webSearch: true,
      mcpTools: [extra(MCP_CALL_NAME)],
    }).map((tool) => tool.name);
    expect(names).toEqual([WEBSEARCH_TOOL.name, MCP_CALL_NAME]);
  });

  it("hides spawn_agent from a nested coding turn", () => {
    const names = parentExtraTools({ ...extraBase, inSubagent: true }).map((tool) => tool.name);
    expect(names).toEqual([
      ...RUNTIME_TOOLS.filter((tool) => tool.name !== "spawn_agent").map((tool) => tool.name),
      "orient",
      "find_entity",
      "get_entity",
      "search_knowledge",
      "correct_graph",
      "brain_brief",
      "docker_swarm",
    ]);
  });

  it("offers plugin tools on coding turns and hides them in plan mode", () => {
    const pluginTools = [extra("plugin_status_list"), extra("manage_integration_plugin")];
    expect(parentExtraTools({ ...extraBase, pluginTools }).map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["plugin_status_list", "manage_integration_plugin"]),
    );
    expect(
      parentExtraTools({ ...extraBase, planTurn: true, pluginTools }).map((tool) => tool.name),
    ).not.toContain("plugin_status_list");
  });

  it("offers remember only when persistMemory is on and the turn is not /plan", () => {
    expect(parentExtraTools({ ...extraBase }).some((tool) => tool.name === "remember")).toBe(false);
    expect(
      parentExtraTools({ ...extraBase, persistMemory: true }).some(
        (tool) => tool.name === "remember",
      ),
    ).toBe(true);
    expect(
      parentExtraTools({ ...extraBase, persistMemory: true, planTurn: true }).some(
        (tool) => tool.name === "remember",
      ),
    ).toBe(false);
  });

  it("offers subscribe tools on coding turns only", () => {
    const names = parentExtraTools({ ...extraBase }).map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["subscribe", "unsubscribe", "list_workflows", "run_workflow"]),
    );
    expect(
      parentExtraTools({ ...extraBase, planTurn: true }).map((tool) => tool.name),
    ).not.toContain("subscribe");
    expect(
      parentExtraTools({ ...extraBase, isDesign: true }).map((tool) => tool.name),
    ).not.toContain("subscribe");
    expect(
      parentExtraTools({ ...extraBase, inSubagent: true }).map((tool) => tool.name),
    ).not.toContain("subscribe");
    expect(
      parentExtraTools({ ...extraBase, inSubagent: true }).map((tool) => tool.name),
    ).not.toContain("run_workflow");
  });

  it("offers host_sessions on host chats including canvases and /plan", () => {
    expect(parentExtraTools({ ...extraBase, isHost: true }).map((tool) => tool.name)).toContain(
      "host_sessions",
    );
    expect(
      parentExtraTools({ ...extraBase, isHost: true, isDesign: true }).map((tool) => tool.name),
    ).toContain("host_sessions");
    expect(
      parentExtraTools({ ...extraBase, isHost: true, planTurn: true }).map((tool) => tool.name),
    ).toContain("host_sessions");
    expect(parentExtraTools({ ...extraBase }).map((tool) => tool.name)).not.toContain(
      "host_sessions",
    );
    expect(
      parentExtraTools({ ...extraBase, isHost: true, isProject: true }).map((tool) => tool.name),
    ).not.toContain("host_sessions");
  });

  it("offers docker_swarm on coding turns", () => {
    expect(parentExtraTools({ ...extraBase }).map((tool) => tool.name)).toContain("docker_swarm");
    expect(parentExtraTools({ ...extraBase, inSubagent: true }).map((tool) => tool.name)).toContain(
      "docker_swarm",
    );
    expect(
      parentExtraTools({ ...extraBase, isDesign: true }).map((tool) => tool.name),
    ).not.toContain("docker_swarm");
    expect(
      parentExtraTools({ ...extraBase, planTurn: true }).map((tool) => tool.name),
    ).not.toContain("docker_swarm");
  });

  it("offers subscribe on project coordinators but not spawn_agent or repo_map", () => {
    const names = parentExtraTools({ ...extraBase, isProject: true }).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["subscribe", "unsubscribe", "task_list"]));
    expect(names).not.toContain("spawn_agent");
    expect(names).not.toContain("repo_map");
    expect(
      parentExtraTools({ ...extraBase, isProject: true, planTurn: true }).map((tool) => tool.name),
    ).not.toContain("repo_map");
  });

  it("keeps plan, web search, and MCP off the cached extra catalog", () => {
    const names = stablePromptExtraTools({
      ...extraBase,
      planTurn: true,
      webSearch: true,
      hasSkills: true,
      allowAskUser: true,
      persistMemory: true,
      mcpTools: [extra(MCP_LIST_TOOLS_NAME), extra(MCP_CALL_NAME)],
      pluginTools: [extra("plugin_status_list")],
    }).map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["scratchpad", "task_list", "repo_map", "spawn_agent", "remember"]),
    );
    expect(names).toContain(READ_SKILL_TOOL.name);
    expect(names).toContain(ASK_USER_TOOL.name);
    expect(names).toContain("plugin_status_list");
    expect(names).not.toContain(WEBSEARCH_TOOL.name);
    expect(names).not.toContain(MCP_LIST_TOOLS_NAME);
    expect(names).not.toContain(MCP_CALL_NAME);
    expect(
      stablePromptExtraTools({ ...extraBase, planTurn: true }).map((tool) => tool.name),
    ).toEqual(stablePromptExtraTools({ ...extraBase, planTurn: false }).map((tool) => tool.name));
  });

  it("freezes the advertised catalog and keeps MCP volatile", () => {
    const first = freezePromptTools(undefined, [extra("exec"), extra(MCP_LIST_TOOLS_NAME)]);
    expect(first.advertised.map((tool) => tool.name)).toEqual(["exec"]);
    expect(first.tools.map((tool) => tool.name)).toEqual(["exec", MCP_LIST_TOOLS_NAME]);
    const later = freezePromptTools(first.advertised, [
      extra("exec"),
      extra("file_write"),
      extra(MCP_CALL_NAME),
    ]);
    expect(later.advertised.map((tool) => tool.name)).toEqual(["exec"]);
    expect(later.tools.map((tool) => tool.name)).toEqual(["exec", MCP_CALL_NAME]);
  });

  it("does not shrink the tools JSON when the guest is still booting", () => {
    expect(
      cachedTurnAllowedTools({
        planTurn: false,
        planToolNames: ["file_read"],
        sessionAllowedTools: undefined,
      }),
    ).toBeUndefined();
    expect(
      cachedTurnAllowedTools({
        planTurn: false,
        planToolNames: ["file_read"],
        sessionAllowedTools: ["exec", "file_read"],
      }),
    ).toEqual(["exec", "file_read"]);
    expect(
      cachedTurnAllowedTools({
        planTurn: true,
        planToolNames: ["file_read", "grep"],
        sessionAllowedTools: ["exec"],
      }),
    ).toEqual(["file_read", "grep"]);
  });
});

describe("parentModelToolChoice", () => {
  const choiceBase = {
    canvasEmpty: false,
    canvasIncomplete: false,
    canvasNudges: 0,
    canvasIncompleteNudges: 0,
    designMutateNudges: 0,
    isDesign: false,
    guestReady: false,
    planTurn: false,
    canvasMutatedThisTurn: false,
  };

  it("requires tools for canvas empty, nudges, and an unmutated design follow-up", () => {
    expect(parentModelToolChoice({ ...choiceBase, canvasEmpty: true })).toBe("required");
    expect(parentModelToolChoice({ ...choiceBase, canvasNudges: 1 })).toBe("required");
    expect(parentModelToolChoice({ ...choiceBase, designMutateNudges: 1 })).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isDesign: true,
        guestReady: true,
      }),
    ).toBe("required");
  });

  it("leaves toolChoice unset after a canvas write or on a plan turn", () => {
    expect(parentModelToolChoice(choiceBase)).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
      }),
    ).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        canvasIncomplete: true,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isDesign: true,
        guestReady: true,
        planTurn: true,
      }),
    ).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 1,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        gamePlaywrightNudges: 1,
        calledPlaywrightThisTurn: true,
      }),
    ).toBeUndefined();
  });

  it("requires tools after a coding wander or verify note until the model edits or tests", () => {
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isCoding: true,
        searchWanderNudges: 1,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isCoding: true,
        searchWanderNudges: 1,
        mutatedThisTurn: true,
      }),
    ).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isCoding: true,
        mutatedThisTurn: true,
        verifyNudges: 1,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isCoding: true,
        mutatedThisTurn: true,
        verifiedThisTurn: true,
        verifyNudges: 1,
      }),
    ).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isCoding: true,
        planTurn: true,
        searchWanderNudges: 1,
      }),
    ).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        genericDesign: true,
        designQualityNudges: 1,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        genericDesign: false,
        designQualityNudges: 1,
      }),
    ).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        hostFallback: true,
        designQualityNudges: 1,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        hostFallback: false,
        genericDesign: false,
        designQualityNudges: 1,
      }),
    ).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        dryGame: true,
        gameJuiceNudges: 1,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        dryGame: false,
        gameJuiceNudges: 1,
      }),
    ).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        adherenceIssues: true,
        adherenceNudges: 1,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isDesign: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        adherenceIssues: false,
        adherenceNudges: 1,
      }),
    ).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        gameUnplayable: true,
        gameUnplayableNudges: 1,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        gameUnplayable: false,
        gameUnplayableNudges: 1,
      }),
    ).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isAsset: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        assetUnwired: true,
        gameUnplayableNudges: 1,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        unusedLinkedAssets: true,
        unusedLinkedAssetNudges: 1,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isGame: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        unusedLinkedAssets: false,
        unusedLinkedAssetNudges: 1,
      }),
    ).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isAsset: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        placeholderAsset: true,
        assetSculptNudges: 1,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isAsset: true,
        guestReady: true,
        canvasMutatedThisTurn: true,
        calledPlaywrightThisTurn: true,
        placeholderAsset: false,
        assetSculptNudges: 1,
      }),
    ).toBeUndefined();
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isReview: true,
        calledReview: false,
        reviewRoutingNudges: 1,
      }),
    ).toBe("required");
    expect(
      parentModelToolChoice({
        ...choiceBase,
        isReview: true,
        calledReview: true,
        reviewRoutingNudges: 1,
      }),
    ).toBeUndefined();
  });
});
