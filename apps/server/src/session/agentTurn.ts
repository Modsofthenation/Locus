import type { ExtraToolDef, ToolCall } from "@locus/shared";
import {
  ASK_USER_TOOL,
  DESIGN_CANVAS_PATH,
  DOCKER_SWARM_TOOL,
  HOST_SESSIONS_TOOL,
  MAX_SELF_CORRECTS_PER_TURN,
  MAX_CANVAS_NUDGES,
  MAX_ADHERENCE_NUDGES,
  MAX_DESIGN_QUALITY_NUDGES,
  MAX_GAME_JUICE_NUDGES,
  MAX_ASSET_SCULPT_NUDGES,
  MAX_UNUSED_LINKED_ASSET_NUDGES,
  READ_SKILL_TOOL,
  WORKFLOW_TOOLS,
  REMEMBER_TOOL,
  SUBSCRIBE_TOOL,
  UNSUBSCRIBE_TOOL,
  BRAIN_BRIEF_TOOL,
  BRAIN_READ_TOOLS,
  RUNTIME_TOOLS,
  WEBSEARCH_TOOL,
  canonicalToolName,
  htmlDocumentFromText,
  isDesignCanvasPath,
  looksLikeFakeGamePlaytest,
  looksLikeHudOnlyAssetPlaytest,
  looksLikeHudOnlyGamePlaytest,
  playwrightReportFailed,
  writeBodyFromToolArgs,
  stripHtmlDocumentFromChat,
  isMcpDiscoveryToolName,
  isPlanReadTool,
  isSpawnAgentToolName,
  isRepoMapToolName,
  parseUnifiedDiff,
  planExecCommandsAreSafe,
  shouldNudgeMissingReviewVerdict,
  shouldNudgeOpsRouting,
  shouldNudgeReviewRouting,
  shouldNudgeSearchWander,
  shouldNudgeVerify,
} from "@locus/shared";
import { extractEmbeddedToolCalls } from "@locus/providers";
import type { ToolResult } from "@locus/guest-agent";
import {
  incompleteBlocksLook,
  leftoverCanvasRepair,
  lookedOrLookBudgetSpent,
  wantsCanvasQuality,
  wantsStudioFollowUpMutate,
} from "./studioContinue.js";

export type AfterModelObservation = {
  toolCallCount: number;
  hasText: boolean;
  planTurn: boolean;
  stopped: boolean;
  emptyRetries: number;
  isDesign: boolean;
  guestReady: boolean;
  canvasEmpty: boolean;
  canvasIncomplete: boolean;
  canvasNudges: number;
  canvasIncompleteNudges: number;
  canvasMutatedThisTurn: boolean;
  designMutateNudges: number;
  isGame?: boolean;
  isAsset?: boolean;
  isReview?: boolean;
  hasReviewVerdict?: boolean;
  applyReviewVerdict?: boolean;
  reviewVerdictNudges?: number;
  calledReview?: boolean;
  reviewRoutingNudges?: number;
  isCoding?: boolean;
  mutatedThisTurn?: boolean;
  verifiedThisTurn?: boolean;
  verifyNudges?: number;
  namedOps?: boolean;
  searchRounds?: number;
  searchWanderNudges?: number;
  calledPlaywrightThisTurn?: boolean;
  gamePlaywrightNudges?: number;
  genericDesign?: boolean;
  hostFallback?: boolean;
  designQualityNudges?: number;
  dryGame?: boolean;
  gameJuiceNudges?: number;
  placeholderAsset?: boolean;
  assetSculptNudges?: number;
  adherenceIssues?: boolean;
  adherenceNudges?: number;
  unusedLinkedAssets?: boolean;
  unusedLinkedAssetNudges?: number;
  gameUnplayable?: boolean;
  assetUnwired?: boolean;
  gameUnplayableNudges?: number;
};

export type AfterModelDecision =
  | { kind: "retryEmpty" }
  | { kind: "canvasNudge"; dropBlank: boolean }
  | { kind: "canvasIncompleteNudge"; dropBlank: boolean }
  | { kind: "designMutateNudge"; dropBlank: boolean }
  | { kind: "reviewVerdictNudge" }
  | { kind: "reviewRouting" }
  | { kind: "designLookNudge"; dropBlank: boolean }
  | { kind: "designQualityNudge"; dropBlank: boolean }
  | { kind: "gameUnplayableNudge"; dropBlank: boolean }
  | { kind: "gameJuiceNudge"; dropBlank: boolean }
  | { kind: "assetSculptNudge"; dropBlank: boolean }
  | { kind: "unusedLinkedAssetsNudge"; dropBlank: boolean }
  | { kind: "adherenceNudge"; dropBlank: boolean }
  | { kind: "searchWander" }
  | { kind: "verifyNudge" }
  | { kind: "fillEmpty" }
  | { kind: "stop" }
  | { kind: "runTools" };

export type AfterToolObservation = {
  isDesign: boolean;
  isGame?: boolean;
  isAsset?: boolean;
  wroteCanvas: boolean;
  canvasIncomplete: boolean;
  canvasIncompleteNudges: number;
  gameUnplayable?: boolean;
  gameUnplayableNudges?: number;
  assetUnwired?: boolean;
  calledPlaywright?: boolean;
  fakePlaytest?: boolean;
  gamePlaywrightNudges?: number;
  canvasWiped?: boolean;
  gameWipeNudges?: number;
  hasToolError: boolean;
  planTurn: boolean;
  stopped: boolean;
  budgetOk: boolean;
  budgetMessage: string;
  selfCorrects: number;
  fixableFailure?: { name: string; id: string; error: string };
  lastRound: boolean;
  namedOps?: boolean;
  calledOps?: boolean;
  searchRounds?: number;
  opsRoutingNudges?: number;
  adherenceIssues?: boolean;
  adherenceNudges?: number;
  isReview?: boolean;
  calledReview?: boolean;
  applyThisTurn?: boolean;
  reviewRoutingNudges?: number;
  unusedLinkedAssets?: boolean;
  unusedLinkedAssetNudges?: number;
  canvasUnchanged?: boolean;
  followUpMissing?: boolean;
  iterateUnchanged?: boolean;
  designMutateNudges?: number;
  isCoding?: boolean;
  mutatedThisTurn?: boolean;
  verifiedThisTurn?: boolean;
  verifyNudges?: number;
  searchWanderNudges?: number;
  genericDesign?: boolean;
  hostFallback?: boolean;
  designQualityNudges?: number;
  dryGame?: boolean;
  gameJuiceNudges?: number;
  placeholderAsset?: boolean;
  assetSculptNudges?: number;
};

export type AfterToolDecision =
  | { kind: "canvasDone" }
  | { kind: "canvasIncompleteNudge" }
  | { kind: "gameUnplayableNudge" }
  | { kind: "gamePlaywrightNudge" }
  | { kind: "gameWipeNudge" }
  | { kind: "gameWipeRestore" }
  | { kind: "designMutateNudge" }
  | { kind: "designQualityNudge" }
  | { kind: "gameJuiceNudge" }
  | { kind: "assetSculptNudge" }
  | { kind: "unusedLinkedAssetsNudge" }
  | { kind: "budgetStop"; message: string }
  | { kind: "adherenceNudge" }
  | { kind: "verifyNudge" }
  | {
      kind: "continue";
      selfCorrect?: { name: string; id: string; error: string };
      opsRouting?: boolean;
      reviewRouting?: boolean;
      searchWander?: boolean;
      usedAllRounds: boolean;
    };

/** Round-control policy after the model streams. Steer-after-reply stays on the adapter. */
export function decideAfterModelRound(obs: AfterModelObservation): AfterModelDecision {
  const blank = obs.toolCallCount === 0 && !obs.hasText;
  if (blank && !obs.planTurn && !obs.stopped && obs.emptyRetries < 2) {
    return { kind: "retryEmpty" };
  }
  if (
    obs.toolCallCount === 0 &&
    !obs.planTurn &&
    !obs.stopped &&
    obs.isDesign &&
    obs.guestReady &&
    obs.canvasNudges < MAX_CANVAS_NUDGES &&
    obs.canvasEmpty
  ) {
    return { kind: "canvasNudge", dropBlank: blank };
  }
  if (
    obs.toolCallCount === 0 &&
    !obs.planTurn &&
    !obs.stopped &&
    obs.isDesign &&
    obs.guestReady &&
    obs.canvasIncomplete &&
    obs.canvasIncompleteNudges < MAX_CANVAS_NUDGES
  ) {
    return { kind: "canvasIncompleteNudge", dropBlank: blank };
  }
  if (
    obs.toolCallCount === 0 &&
    !obs.planTurn &&
    !obs.stopped &&
    obs.isDesign &&
    obs.guestReady &&
    !obs.canvasEmpty &&
    !incompleteBlocksLook(obs) &&
    (obs.canvasMutatedThisTurn || leftoverCanvasRepair(obs)) &&
    !obs.calledPlaywrightThisTurn &&
    (obs.gamePlaywrightNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return { kind: "designLookNudge", dropBlank: blank };
  }
  if (
    obs.toolCallCount === 0 &&
    !obs.planTurn &&
    !obs.stopped &&
    obs.isDesign &&
    obs.guestReady &&
    !obs.canvasEmpty &&
    !obs.canvasIncomplete &&
    !obs.canvasMutatedThisTurn &&
    !leftoverCanvasRepair(obs) &&
    obs.designMutateNudges < MAX_CANVAS_NUDGES
  ) {
    return { kind: "designMutateNudge", dropBlank: blank };
  }
  if (
    obs.toolCallCount === 0 &&
    !obs.planTurn &&
    !obs.stopped &&
    obs.isDesign &&
    obs.guestReady &&
    !obs.canvasEmpty &&
    !obs.canvasIncomplete &&
    wantsCanvasQuality(obs) &&
    lookedOrLookBudgetSpent(obs) &&
    (obs.designQualityNudges ?? 0) < MAX_DESIGN_QUALITY_NUDGES
  ) {
    return { kind: "designQualityNudge", dropBlank: blank };
  }
  if (
    obs.toolCallCount === 0 &&
    !obs.planTurn &&
    !obs.stopped &&
    obs.guestReady &&
    lookedOrLookBudgetSpent(obs) &&
    ((Boolean(obs.isGame) && Boolean(obs.gameUnplayable)) ||
      (Boolean(obs.isAsset) && Boolean(obs.assetUnwired))) &&
    (obs.gameUnplayableNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return { kind: "gameUnplayableNudge", dropBlank: blank };
  }
  if (
    obs.toolCallCount === 0 &&
    !obs.planTurn &&
    !obs.stopped &&
    Boolean(obs.isGame) &&
    obs.guestReady &&
    lookedOrLookBudgetSpent(obs) &&
    Boolean(obs.unusedLinkedAssets) &&
    (obs.unusedLinkedAssetNudges ?? 0) < MAX_UNUSED_LINKED_ASSET_NUDGES
  ) {
    return { kind: "unusedLinkedAssetsNudge", dropBlank: blank };
  }
  if (
    obs.toolCallCount === 0 &&
    !obs.planTurn &&
    !obs.stopped &&
    Boolean(obs.isGame) &&
    obs.guestReady &&
    lookedOrLookBudgetSpent(obs) &&
    Boolean(obs.dryGame) &&
    (obs.gameJuiceNudges ?? 0) < MAX_GAME_JUICE_NUDGES
  ) {
    return { kind: "gameJuiceNudge", dropBlank: blank };
  }
  if (
    obs.toolCallCount === 0 &&
    !obs.planTurn &&
    !obs.stopped &&
    Boolean(obs.isAsset) &&
    obs.guestReady &&
    lookedOrLookBudgetSpent(obs) &&
    Boolean(obs.placeholderAsset) &&
    (obs.assetSculptNudges ?? 0) < MAX_ASSET_SCULPT_NUDGES
  ) {
    return { kind: "assetSculptNudge", dropBlank: blank };
  }
  if (
    obs.toolCallCount === 0 &&
    !obs.planTurn &&
    !obs.stopped &&
    obs.isDesign &&
    !obs.isGame &&
    !obs.isAsset &&
    obs.guestReady &&
    !obs.canvasEmpty &&
    !obs.canvasIncomplete &&
    Boolean(obs.adherenceIssues) &&
    lookedOrLookBudgetSpent(obs) &&
    (obs.adherenceNudges ?? 0) < MAX_ADHERENCE_NUDGES
  ) {
    return { kind: "adherenceNudge", dropBlank: blank };
  }
  if (
    obs.toolCallCount === 0 &&
    !obs.planTurn &&
    !obs.stopped &&
    shouldNudgeSearchWander({
      isCoding: Boolean(obs.isCoding),
      mutated: Boolean(obs.mutatedThisTurn),
      namedOps: Boolean(obs.namedOps),
      isReview: Boolean(obs.isReview),
      searchRounds: obs.searchRounds ?? 0,
      nudges: obs.searchWanderNudges ?? 0,
    })
  ) {
    return { kind: "searchWander" };
  }
  if (
    obs.toolCallCount === 0 &&
    !obs.planTurn &&
    !obs.stopped &&
    shouldNudgeVerify({
      isCoding: Boolean(obs.isCoding),
      mutated: Boolean(obs.mutatedThisTurn),
      verified: Boolean(obs.verifiedThisTurn),
      nudges: obs.verifyNudges ?? 0,
    })
  ) {
    return { kind: "verifyNudge" };
  }
  if (
    obs.toolCallCount === 0 &&
    Boolean(obs.hasText) &&
    !obs.planTurn &&
    !obs.stopped &&
    shouldNudgeReviewRouting({
      isReview: Boolean(obs.isReview),
      calledReview: Boolean(obs.calledReview),
      searchRounds: obs.searchRounds ?? 0,
      nudges: obs.reviewRoutingNudges ?? 0,
      applyThisTurn: obs.applyReviewVerdict,
      toolCallCount: obs.toolCallCount,
    })
  ) {
    return { kind: "reviewRouting" };
  }
  if (blank && !obs.planTurn && !obs.stopped) {
    if (missingReviewVerdict(obs)) return { kind: "reviewVerdictNudge" };
    return { kind: "fillEmpty" };
  }
  if (obs.stopped || obs.toolCallCount === 0) {
    if (missingReviewVerdict(obs)) return { kind: "reviewVerdictNudge" };
    return { kind: "stop" };
  }
  return { kind: "runTools" };
}

function missingReviewVerdict(obs: AfterModelObservation): boolean {
  return shouldNudgeMissingReviewVerdict({
    isReview: Boolean(obs.isReview),
    hasVerdict: Boolean(obs.hasReviewVerdict),
    applyThisTurn: obs.isReview ? obs.applyReviewVerdict !== false : false,
    nudges: obs.reviewVerdictNudges ?? 0,
    planTurn: obs.planTurn,
    stopped: obs.stopped,
  });
}

/** Round-control policy after tools finish. */
export function decideAfterToolRound(obs: AfterToolObservation): AfterToolDecision {
  const studioLoop = Boolean((obs.isGame || obs.isAsset) && !obs.planTurn && !obs.stopped);
  if (studioLoop && obs.canvasWiped) {
    return { kind: "gameWipeRestore" };
  }
  if (
    !(studioLoop && obs.canvasWiped) &&
    obs.isDesign &&
    obs.canvasIncomplete &&
    obs.canvasIncompleteNudges < MAX_CANVAS_NUDGES
  ) {
    return { kind: "canvasIncompleteNudge" };
  }
  if (
    studioLoop &&
    !obs.canvasWiped &&
    lookedOrLookBudgetSpent(obs) &&
    !obs.canvasIncomplete &&
    ((obs.isGame && obs.gameUnplayable) || (obs.isAsset && obs.assetUnwired)) &&
    (obs.gameUnplayableNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return { kind: "gameUnplayableNudge" };
  }
  if (
    studioLoop &&
    !obs.canvasWiped &&
    !incompleteBlocksLook(obs) &&
    !obs.calledPlaywright &&
    (obs.wroteCanvas || obs.fakePlaytest || leftoverCanvasRepair(obs)) &&
    (obs.gamePlaywrightNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return { kind: "gamePlaywrightNudge" };
  }
  if (
    studioLoop &&
    obs.isGame &&
    !obs.canvasIncomplete &&
    !obs.canvasWiped &&
    !obs.gameUnplayable &&
    lookedOrLookBudgetSpent(obs) &&
    obs.unusedLinkedAssets &&
    (obs.unusedLinkedAssetNudges ?? 0) < MAX_UNUSED_LINKED_ASSET_NUDGES
  ) {
    return { kind: "unusedLinkedAssetsNudge" };
  }
  if (
    studioLoop &&
    wantsStudioFollowUpMutate(obs) &&
    !obs.canvasWiped &&
    !obs.canvasIncomplete &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return { kind: "designMutateNudge" };
  }
  if (
    obs.isDesign &&
    (obs.wroteCanvas || leftoverCanvasRepair(obs)) &&
    !obs.hasToolError &&
    !incompleteBlocksLook(obs) &&
    !obs.canvasWiped &&
    !studioLoop &&
    !obs.calledPlaywright &&
    (obs.gamePlaywrightNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return { kind: "gamePlaywrightNudge" };
  }
  if (
    obs.isDesign &&
    !obs.planTurn &&
    !obs.stopped &&
    !obs.canvasIncomplete &&
    wantsCanvasQuality(obs) &&
    lookedOrLookBudgetSpent(obs) &&
    (obs.designQualityNudges ?? 0) < MAX_DESIGN_QUALITY_NUDGES
  ) {
    return { kind: "designQualityNudge" };
  }
  if (
    obs.isDesign &&
    !obs.isGame &&
    !obs.isAsset &&
    !obs.planTurn &&
    !obs.stopped &&
    !obs.hasToolError &&
    !obs.canvasIncomplete &&
    !obs.canvasWiped &&
    Boolean(obs.adherenceIssues) &&
    lookedOrLookBudgetSpent(obs) &&
    (obs.adherenceNudges ?? 0) < MAX_ADHERENCE_NUDGES
  ) {
    return { kind: "adherenceNudge" };
  }
  if (
    obs.isDesign &&
    !obs.isGame &&
    !obs.isAsset &&
    !obs.planTurn &&
    !obs.stopped &&
    !obs.canvasIncomplete &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES &&
    Boolean(obs.iterateUnchanged)
  ) {
    return { kind: "designMutateNudge" };
  }
  if (
    studioLoop &&
    obs.isGame &&
    !obs.canvasIncomplete &&
    !obs.canvasWiped &&
    !obs.gameUnplayable &&
    lookedOrLookBudgetSpent(obs) &&
    Boolean(obs.dryGame) &&
    (obs.gameJuiceNudges ?? 0) < MAX_GAME_JUICE_NUDGES
  ) {
    return { kind: "gameJuiceNudge" };
  }
  if (
    studioLoop &&
    obs.isAsset &&
    !obs.canvasIncomplete &&
    !obs.canvasWiped &&
    !obs.assetUnwired &&
    lookedOrLookBudgetSpent(obs) &&
    Boolean(obs.placeholderAsset) &&
    (obs.assetSculptNudges ?? 0) < MAX_ASSET_SCULPT_NUDGES
  ) {
    return { kind: "assetSculptNudge" };
  }
  if (
    studioLoop &&
    obs.isGame &&
    !obs.canvasWiped &&
    !obs.canvasIncomplete &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES &&
    Boolean(obs.canvasUnchanged) &&
    Boolean(obs.wroteCanvas)
  ) {
    return { kind: "designMutateNudge" };
  }
  if (!obs.budgetOk) return { kind: "budgetStop", message: obs.budgetMessage };
  if (
    shouldNudgeVerify({
      isCoding: Boolean(obs.isCoding),
      mutated: Boolean(obs.mutatedThisTurn),
      verified: Boolean(obs.verifiedThisTurn),
      nudges: obs.verifyNudges ?? 0,
      planTurn: obs.planTurn,
      stopped: obs.stopped,
    })
  ) {
    return { kind: "verifyNudge" };
  }
  const reviewRouting = shouldNudgeReviewRouting({
    isReview: Boolean(obs.isReview),
    calledReview: Boolean(obs.calledReview),
    searchRounds: obs.searchRounds ?? 0,
    nudges: obs.reviewRoutingNudges ?? 0,
    planTurn: obs.planTurn,
    stopped: obs.stopped,
    applyThisTurn: obs.applyThisTurn,
  });
  const opsRouting =
    !reviewRouting &&
    shouldNudgeOpsRouting({
      named: Boolean(obs.namedOps),
      calledOps: Boolean(obs.calledOps),
      searchRounds: obs.searchRounds ?? 0,
      nudges: obs.opsRoutingNudges ?? 0,
      planTurn: obs.planTurn,
      stopped: obs.stopped,
    });
  const searchWander =
    !reviewRouting &&
    !opsRouting &&
    shouldNudgeSearchWander({
      isCoding: Boolean(obs.isCoding),
      mutated: Boolean(obs.mutatedThisTurn),
      namedOps: Boolean(obs.namedOps),
      isReview: Boolean(obs.isReview),
      searchRounds: obs.searchRounds ?? 0,
      nudges: obs.searchWanderNudges ?? 0,
      planTurn: obs.planTurn,
      stopped: obs.stopped,
    });
  const selfCorrect =
    !reviewRouting &&
    !opsRouting &&
    !searchWander &&
    !obs.planTurn &&
    !obs.stopped &&
    obs.selfCorrects < MAX_SELF_CORRECTS_PER_TURN &&
    obs.fixableFailure
      ? obs.fixableFailure
      : undefined;
  return {
    kind: "continue",
    selfCorrect,
    ...(opsRouting ? { opsRouting: true } : {}),
    ...(reviewRouting ? { reviewRouting: true } : {}),
    ...(searchWander ? { searchWander: true } : {}),
    usedAllRounds: obs.lastRound,
  };
}

/** Last-round after-tool notes would inject then the for-loop would exit. Refund so the model sees them. */
export function refundLastRoundSlot(round: number, maxRounds: number | null | undefined): number {
  if (maxRounds != null && round === maxRounds - 1) return round - 1;
  return round;
}

export { canonicalToolName };

function canvasToolRejected(call: ToolCall): boolean {
  if (call.error) return true;
  const result = typeof call.result === "string" ? call.result : "";
  return /changed on disk/i.test(result);
}

export function wroteLiveCanvas(calls: ToolCall[]): boolean {
  return calls.some((call) => {
    if (canvasToolRejected(call)) return false;
    const name = canonicalToolName(call.name);
    const args = call.arguments ?? {};
    const path =
      (typeof args.path === "string" && args.path) ||
      (typeof args.target_file === "string" && args.target_file) ||
      "";
    if (name === "file_write") return isDesignCanvasPath(path);
    if (name !== "apply_patch") return false;
    const patch = typeof args.patch === "string" ? args.patch : "";
    if (parseUnifiedDiff(patch).some((file) => isDesignCanvasPath(file.path))) return true;
    const body = writeBodyFromToolArgs(args);
    return Boolean(isDesignCanvasPath(path) && body?.trim());
  });
}

export function calledPlaywright(calls: ToolCall[]): boolean {
  return calls.some((call) => {
    const name = canonicalToolName(call.name).replace(/^locus-/, "");
    if (name === "playwright" || /playwright/i.test(call.name)) return true;
    const nested = call.arguments?.name ?? call.arguments?.toolName ?? call.arguments?.tool;
    return typeof nested === "string" && /playwright/i.test(nested);
  });
}

export function assetPlaywrightFailed(calls: ToolCall[]): boolean {
  return calls.some((call) => {
    if (!calledPlaywright([call])) return false;
    if (call.error) return true;
    const result = typeof call.result === "string" ? call.result : "";
    return playwrightReportFailed(result);
  });
}

export function calledFakeGamePlaytest(calls: ToolCall[]): boolean {
  return calls.some((call) =>
    looksLikeFakeGamePlaytest({
      name: canonicalToolName(call.name),
      arguments: call.arguments,
      result: typeof call.result === "string" ? call.result : undefined,
    }),
  );
}

export function calledHudOnlyGamePlaytest(calls: ToolCall[]): boolean {
  const playwright = calls.filter((call) => calledPlaywright([call]));
  return (
    playwright.length > 0 &&
    playwright.every((call) =>
      looksLikeHudOnlyGamePlaytest({
        name: canonicalToolName(call.name),
        arguments: call.arguments,
      }),
    )
  );
}

export function calledFakeAssetPlaytest(calls: ToolCall[]): boolean {
  const playwright = calls.filter((call) => {
    const name = canonicalToolName(call.name).replace(/^locus-/, "");
    if (name === "playwright" || /playwright/i.test(call.name)) return true;
    const nested = call.arguments?.name ?? call.arguments?.toolName ?? call.arguments?.tool;
    return typeof nested === "string" && /playwright/i.test(nested);
  });
  return (
    playwright.length > 0 &&
    playwright.every((call) =>
      looksLikeHudOnlyAssetPlaytest({ name: call.name, arguments: call.arguments }),
    )
  );
}

export type ToolRoundPorts = {
  stop: () => boolean;
  stale: () => boolean;
  parallel: boolean;
  now: () => string;
  priorResult: (callId: string) => Promise<string | undefined>;
  execute: (call: ToolCall) => Promise<ToolResult | undefined>;
  hooks: {
    start: (call: ToolCall) => Promise<void>;
    finish: (call: ToolCall, result: ToolResult) => Promise<void>;
  };
};

const UNFINISHED_TOOL = "Tool did not return a result";
const CANCELLED_TOOL = "Cancelled";

/** Fan-out one model round's tool calls. Plan/approval stay in the execute adapter. */
export async function runParentToolCalls(calls: ToolCall[], ports: ToolRoundPorts): Promise<void> {
  const settled = new Set<ToolCall>();
  const runCall = async (call: ToolCall): Promise<void> => {
    if (ports.stop() || ports.stale()) return;
    const prior = await ports.priorResult(call.id);
    if (prior != null) {
      call.result = prior;
      call.finishedAt = call.finishedAt ?? ports.now();
      settled.add(call);
      return;
    }
    await ports.hooks.start(call);
    const result = await ports.execute(call);
    if (ports.stale()) return;
    await ports.hooks.finish(call, result ?? unfinishedToolResult(ports.stop()));
    settled.add(call);
  };
  if (ports.parallel) {
    await Promise.all(calls.map((call) => runCall(call)));
  } else {
    for (const call of calls) {
      await runCall(call);
      if (ports.stop() || ports.stale()) break;
    }
  }
  if (ports.stale()) return;
  for (const call of calls) {
    if (settled.has(call)) continue;
    await ports.hooks.finish(call, unfinishedToolResult(ports.stop()));
  }
}

function unfinishedToolResult(cancelled: boolean): ToolResult {
  return { ok: false, output: cancelled ? CANCELLED_TOOL : UNFINISHED_TOOL };
}

export const PLAN_READONLY_REFUSAL =
  "Plan mode is read-only. Put this step on the checklist instead of mutating.";

export const PLAN_EXEC_REFUSAL =
  "Plan mode only allows tests and read-only exec (npm test, git diff, rg). Put mutating commands on the checklist.";

export function planToolRefusal(
  name: string,
  planTurn: boolean,
  args?: Record<string, unknown>,
): string | undefined {
  if (!planTurn) return undefined;
  if (name === "exec" || name === "powershell") {
    return planExecCommandsAreSafe(args) ? undefined : PLAN_EXEC_REFUSAL;
  }
  if (isPlanReadTool(name) || name === "repo_map") return undefined;
  return PLAN_READONLY_REFUSAL;
}

export type ParentToolKind = "planRefuse" | "approval" | "execute";

export function parentToolKind(
  name: string,
  opts: { planTurn: boolean; needsApproval: boolean; args?: Record<string, unknown> },
): ParentToolKind {
  if (planToolRefusal(name, opts.planTurn, opts.args)) return "planRefuse";
  if (opts.needsApproval) return "approval";
  return "execute";
}

export type ApprovalToolOutcome =
  | { kind: "refused"; approval: "denied"; result: ToolResult }
  | { kind: "answered"; approval: "approved"; result: ToolResult }
  | { kind: "run"; approval: "approved" };

export function approvalToolOutcome(input: {
  askUser: boolean;
  decision: string;
  answer?: string;
}): ApprovalToolOutcome {
  if (input.decision !== "approved") {
    return {
      kind: "refused",
      approval: "denied",
      result: {
        ok: false,
        output: input.askUser
          ? "The operator declined to answer."
          : input.decision === "denied"
            ? "Denied by user"
            : "Cancelled",
      },
    };
  }
  if (input.askUser) {
    return {
      kind: "answered",
      approval: "approved",
      result: { ok: true, output: input.answer?.trim() || "(no answer)" },
    };
  }
  return { kind: "run", approval: "approved" };
}

/** Extra tool calls implied by assistant text when the model skipped native tool_calls. */
export function impliedToolCallsFromReply(input: {
  planTurn: boolean;
  hasToolCalls: boolean;
  isDesign: boolean;
  guestReady: boolean;
  canvasEmpty?: boolean;
  content?: string;
}): Array<{ name: string; arguments: Record<string, unknown> }> {
  if (input.planTurn || input.hasToolCalls || !input.content) return [];
  const embedded = extractEmbeddedToolCalls(input.content);
  if (embedded.length) return embedded;
  if (input.isDesign && input.guestReady) {
    const html = htmlDocumentFromText(input.content);
    if (html)
      return [{ name: "file_write", arguments: { path: DESIGN_CANVAS_PATH, content: html } }];
  }
  return [];
}

/** Drop harvested page source from the assistant bubble once it is a canvas write. */
export function hideHarvestedCanvasChat(content: string, implied: Array<{ name: string }>): string {
  if (!implied.some((row) => row.name === "file_write")) return content;
  return stripHtmlDocumentFromChat(content);
}

export type ParentExtraToolsInput = {
  planTurn: boolean;
  isDesign: boolean;
  isProject?: boolean;
  isHost?: boolean;
  inSubagent: boolean;
  webSearch: boolean;
  hasSkills: boolean;
  allowAskUser: boolean;
  persistMemory?: boolean;
  offerBrain?: boolean;
  mcpTools: ExtraToolDef[];
  pluginTools?: ExtraToolDef[];
};

/**
 * Advertise the non-MCP catalog once per turn so guest-ready / MCP connect
 * cannot bust the cached system prefix. MCP stays volatile.
 */
export function freezePromptTools<T extends { name: string }>(
  advertised: T[] | undefined,
  next: T[],
): { tools: T[]; advertised: T[] } {
  const catalog = next.filter((tool) => !tool.name.startsWith("mcp_"));
  const mcp = next.filter((tool) => tool.name.startsWith("mcp_"));
  const frozen = advertised ?? catalog;
  return { tools: [...frozen, ...mcp], advertised: frozen };
}

/**
 * Keep the tools JSON cache-stable for the turn. Guest-not-ready is enforced
 * at execute time; shrinking the advertised catalog busts Anthropic/OpenAI cache.
 */
export function cachedTurnAllowedTools(input: {
  planTurn: boolean;
  planToolNames: string[];
  sessionAllowedTools?: string[];
}): string[] | undefined {
  if (input.planTurn) return input.planToolNames;
  return input.sessionAllowedTools;
}

export function stablePromptExtraTools(input: ParentExtraToolsInput): ExtraToolDef[] {
  return parentExtraTools({
    ...input,
    planTurn: false,
    webSearch: false,
    mcpTools: [],
  }).filter((tool) => !tool.name.startsWith("mcp_"));
}

/** Extra tools offered to the parent model this round. MCP allowlisting stays on the adapter. */
export function parentExtraTools(input: ParentExtraToolsInput): ExtraToolDef[] {
  const extras: ExtraToolDef[] = [];
  if (input.planTurn) {
    extras.push(
      ...RUNTIME_TOOLS.filter((tool) => {
        if (isRepoMapToolName(tool.name) && input.isProject) return false;
        return tool.name === "repo_map" || tool.name === "task_list";
      }),
    );
    if (input.offerBrain !== false) extras.push(...BRAIN_READ_TOOLS);
  } else if (!input.isDesign) {
    extras.push(
      ...RUNTIME_TOOLS.filter((tool) => {
        if (isSpawnAgentToolName(tool.name) && (input.inSubagent || input.isProject)) return false;
        if (isRepoMapToolName(tool.name) && input.isProject) return false;
        return true;
      }),
    );
    if (input.offerBrain !== false) extras.push(...BRAIN_READ_TOOLS, BRAIN_BRIEF_TOOL);
  }
  if (input.isHost && !input.isProject) extras.push(HOST_SESSIONS_TOOL);
  if (!input.planTurn && !input.isDesign) extras.push(DOCKER_SWARM_TOOL);
  if (input.webSearch && !input.planTurn) extras.push(WEBSEARCH_TOOL);
  if (input.hasSkills) extras.push(READ_SKILL_TOOL);
  if (!input.planTurn && !input.isDesign && !input.inSubagent) extras.push(...WORKFLOW_TOOLS);
  if (input.allowAskUser) extras.push(ASK_USER_TOOL);
  if (input.persistMemory && !input.planTurn) extras.push(REMEMBER_TOOL);
  if (!input.planTurn && !input.isDesign && !input.inSubagent) {
    extras.push(SUBSCRIBE_TOOL, UNSUBSCRIBE_TOOL);
  }
  extras.push(
    ...(input.planTurn
      ? input.mcpTools.filter((tool) => isMcpDiscoveryToolName(tool.name))
      : input.mcpTools),
  );
  if (!input.planTurn && input.pluginTools?.length) extras.push(...input.pluginTools);
  return extras;
}

export type ParentToolChoiceInput = {
  canvasEmpty: boolean;
  canvasIncomplete: boolean;
  canvasNudges: number;
  canvasIncompleteNudges: number;
  designMutateNudges: number;
  isDesign: boolean;
  guestReady: boolean;
  planTurn: boolean;
  canvasMutatedThisTurn: boolean;
  calledPlaywrightThisTurn?: boolean;
  gamePlaywrightNudges?: number;
  isCoding?: boolean;
  mutatedThisTurn?: boolean;
  verifiedThisTurn?: boolean;
  verifyNudges?: number;
  searchWanderNudges?: number;
  genericDesign?: boolean;
  hostFallback?: boolean;
  designQualityNudges?: number;
  isGame?: boolean;
  isAsset?: boolean;
  dryGame?: boolean;
  gameJuiceNudges?: number;
  placeholderAsset?: boolean;
  assetSculptNudges?: number;
  adherenceIssues?: boolean;
  adherenceNudges?: number;
  unusedLinkedAssets?: boolean;
  unusedLinkedAssetNudges?: number;
  gameUnplayable?: boolean;
  assetUnwired?: boolean;
  gameUnplayableNudges?: number;
  isReview?: boolean;
  calledReview?: boolean;
  reviewRoutingNudges?: number;
};

/** Force native tool use when the canvas or design mutate path still needs a write. */
export function parentModelToolChoice(input: ParentToolChoiceInput): "required" | undefined {
  const forceCanvasMutate =
    input.isDesign &&
    input.guestReady &&
    !input.planTurn &&
    (!input.canvasMutatedThisTurn || input.canvasIncomplete);
  const forceLook =
    input.isDesign &&
    input.guestReady &&
    !input.planTurn &&
    (input.gamePlaywrightNudges ?? 0) > 0 &&
    !input.calledPlaywrightThisTurn;
  const forceWander =
    Boolean(input.isCoding) &&
    !input.planTurn &&
    !input.mutatedThisTurn &&
    (input.searchWanderNudges ?? 0) > 0;
  const forceVerify =
    Boolean(input.isCoding) &&
    !input.planTurn &&
    Boolean(input.mutatedThisTurn) &&
    !input.verifiedThisTurn &&
    (input.verifyNudges ?? 0) > 0;
  const forceQuality =
    input.isDesign &&
    input.guestReady &&
    !input.planTurn &&
    wantsCanvasQuality(input) &&
    (input.designQualityNudges ?? 0) > 0;
  const forceJuice =
    Boolean(input.isGame) &&
    input.guestReady &&
    !input.planTurn &&
    Boolean(input.dryGame) &&
    (input.gameJuiceNudges ?? 0) > 0;
  const forceSculpt =
    Boolean(input.isAsset) &&
    input.guestReady &&
    !input.planTurn &&
    Boolean(input.placeholderAsset) &&
    (input.assetSculptNudges ?? 0) > 0;
  const forceAdherence =
    input.isDesign &&
    input.guestReady &&
    !input.planTurn &&
    Boolean(input.adherenceIssues) &&
    (input.adherenceNudges ?? 0) > 0;
  const forceUnusedAssets =
    Boolean(input.isGame) &&
    input.guestReady &&
    !input.planTurn &&
    Boolean(input.unusedLinkedAssets) &&
    (input.unusedLinkedAssetNudges ?? 0) > 0;
  const forceUnplayable =
    input.guestReady &&
    !input.planTurn &&
    ((Boolean(input.isGame) && Boolean(input.gameUnplayable)) ||
      (Boolean(input.isAsset) && Boolean(input.assetUnwired))) &&
    (input.gameUnplayableNudges ?? 0) > 0;
  const forceReviewInspect =
    Boolean(input.isReview) &&
    !input.planTurn &&
    !input.calledReview &&
    (input.reviewRoutingNudges ?? 0) > 0;
  if (
    input.canvasEmpty ||
    input.canvasIncomplete ||
    input.canvasNudges ||
    input.canvasIncompleteNudges ||
    input.designMutateNudges ||
    forceCanvasMutate ||
    forceLook ||
    forceWander ||
    forceVerify ||
    forceQuality ||
    forceJuice ||
    forceSculpt ||
    forceAdherence ||
    forceUnusedAssets ||
    forceUnplayable ||
    forceReviewInspect
  ) {
    return "required";
  }
  return undefined;
}

export type AfterCliObservation = {
  aborted: boolean;
  steeredPrompt?: string;
  isDesign: boolean;
  planTurn: boolean;
  canvasEmpty: boolean;
  canvasIncomplete: boolean;
  recoveredCanvas: boolean;
  canvasNudges: number;
  canvasIncompleteNudges: number;
  isReview: boolean;
  hasVerdict: boolean;
  applyThisTurn: boolean;
  reviewVerdictNudges: number;
  isGame?: boolean;
  isAsset?: boolean;
  wroteCanvas?: boolean;
  gameUnplayable?: boolean;
  assetUnwired?: boolean;
  calledPlaywright?: boolean;
  playwrightFailed?: boolean;
  fakePlaytest?: boolean;
  canvasWiped?: boolean;
  canvasUnchanged?: boolean;
  gameWipeNudges?: number;
  gameUnplayableNudges?: number;
  gamePlaywrightNudges?: number;
  designMutateNudges?: number;
  unusedLinkedAssets?: boolean;
  unusedLinkedAssetNudges?: number;
  followUpMissing?: boolean;
  iterateUnchanged?: boolean;
  isCoding?: boolean;
  namedOps?: boolean;
  calledOps?: boolean;
  calledReview?: boolean;
  searchRounds?: number;
  mutatedThisTurn?: boolean;
  verifiedThisTurn?: boolean;
  searchWanderNudges?: number;
  verifyNudges?: number;
  opsRoutingNudges?: number;
  reviewRoutingNudges?: number;
  selfCorrects?: number;
  fixableFailure?: { name: string; id: string; error: string };
  genericDesign?: boolean;
  hostFallback?: boolean;
  designQualityNudges?: number;
  dryGame?: boolean;
  gameJuiceNudges?: number;
  placeholderAsset?: boolean;
  assetSculptNudges?: number;
  adherenceIssues?: boolean;
  adherenceNudges?: number;
};

export type AfterCliDecision =
  | { kind: "stop" }
  | { kind: "steer"; prompt: string }
  | { kind: "canvasRecovered" }
  | { kind: "canvasNudge" }
  | { kind: "canvasIncompleteNudge" }
  | { kind: "gameUnplayableNudge" }
  | { kind: "gamePlaywrightNudge" }
  | { kind: "gameWipeNudge" }
  | { kind: "gameWipeRestore" }
  | { kind: "designMutateNudge" }
  | { kind: "unusedLinkedAssetsNudge" }
  | { kind: "reviewRouting" }
  | { kind: "reviewVerdictNudge" }
  | { kind: "opsRouting" }
  | { kind: "searchWander" }
  | { kind: "verifyNudge" }
  | { kind: "selfCorrect"; error: string }
  | { kind: "designQualityNudge" }
  | { kind: "gameJuiceNudge" }
  | { kind: "assetSculptNudge" }
  | { kind: "adherenceNudge" };

/** Shared continue seam for Cursor / Claude / Codex CLI Turns. */
export function decideAfterCliRound(obs: AfterCliObservation): AfterCliDecision {
  if (obs.aborted) return { kind: "stop" };
  if (obs.steeredPrompt) return { kind: "steer", prompt: obs.steeredPrompt };
  if (obs.isDesign && !obs.planTurn && obs.canvasEmpty && obs.recoveredCanvas) {
    return { kind: "canvasRecovered" };
  }
  if ((obs.isGame || obs.isAsset) && !obs.planTurn && obs.canvasWiped) {
    return { kind: "gameWipeRestore" };
  }
  if (obs.isDesign && !obs.planTurn && obs.canvasEmpty && obs.canvasNudges < MAX_CANVAS_NUDGES) {
    return { kind: "canvasNudge" };
  }
  if (
    obs.isDesign &&
    !obs.planTurn &&
    obs.canvasIncomplete &&
    obs.canvasIncompleteNudges < MAX_CANVAS_NUDGES
  ) {
    return { kind: "canvasIncompleteNudge" };
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
    return { kind: "gamePlaywrightNudge" };
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
    return { kind: "designQualityNudge" };
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
    return { kind: "adherenceNudge" };
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
    return { kind: "designMutateNudge" };
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
    return { kind: "designMutateNudge" };
  }
  if (
    ((obs.isGame && obs.gameUnplayable) || (obs.isAsset && obs.assetUnwired)) &&
    !obs.planTurn &&
    lookedOrLookBudgetSpent(obs) &&
    !obs.canvasIncomplete &&
    (obs.gameUnplayableNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return { kind: "gameUnplayableNudge" };
  }
  if (
    obs.isAsset &&
    !obs.planTurn &&
    obs.playwrightFailed &&
    (obs.gameUnplayableNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return { kind: "gameUnplayableNudge" };
  }
  if (
    (obs.isGame || obs.isAsset) &&
    !obs.planTurn &&
    !incompleteBlocksLook(obs) &&
    !obs.calledPlaywright &&
    (obs.wroteCanvas || obs.fakePlaytest || leftoverCanvasRepair(obs)) &&
    (obs.gamePlaywrightNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return { kind: "gamePlaywrightNudge" };
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
    return { kind: "unusedLinkedAssetsNudge" };
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
    return { kind: "designMutateNudge" };
  }
  if (
    wantsStudioFollowUpMutate(obs) &&
    !obs.planTurn &&
    !obs.canvasEmpty &&
    !obs.canvasIncomplete &&
    (obs.designMutateNudges ?? 0) < MAX_CANVAS_NUDGES
  ) {
    return { kind: "designMutateNudge" };
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
    return { kind: "gameJuiceNudge" };
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
    return { kind: "assetSculptNudge" };
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
    return { kind: "designMutateNudge" };
  }
  if (
    shouldNudgeReviewRouting({
      isReview: obs.isReview && !obs.planTurn,
      calledReview: Boolean(obs.calledReview),
      searchRounds: obs.searchRounds ?? 0,
      nudges: obs.reviewRoutingNudges ?? 0,
      applyThisTurn: obs.applyThisTurn,
      toolCallCount: 0,
    })
  ) {
    return { kind: "reviewRouting" };
  }
  if (
    shouldNudgeMissingReviewVerdict({
      isReview: obs.isReview && !obs.planTurn,
      hasVerdict: obs.hasVerdict,
      applyThisTurn: obs.applyThisTurn,
      nudges: obs.reviewVerdictNudges,
    })
  ) {
    return { kind: "reviewVerdictNudge" };
  }
  if (
    shouldNudgeOpsRouting({
      named: Boolean(obs.namedOps),
      calledOps: Boolean(obs.calledOps),
      searchRounds: obs.searchRounds ?? 0,
      nudges: obs.opsRoutingNudges ?? 0,
      planTurn: obs.planTurn,
    })
  ) {
    return { kind: "opsRouting" };
  }
  if (
    shouldNudgeSearchWander({
      isCoding: Boolean(obs.isCoding),
      mutated: Boolean(obs.mutatedThisTurn),
      namedOps: Boolean(obs.namedOps),
      isReview: obs.isReview,
      searchRounds: obs.searchRounds ?? 0,
      nudges: obs.searchWanderNudges ?? 0,
      planTurn: obs.planTurn,
    })
  ) {
    return { kind: "searchWander" };
  }
  if (!obs.planTurn && obs.fixableFailure && (obs.selfCorrects ?? 0) < MAX_SELF_CORRECTS_PER_TURN) {
    return { kind: "selfCorrect", error: obs.fixableFailure.error };
  }
  if (
    shouldNudgeVerify({
      isCoding: Boolean(obs.isCoding),
      mutated: Boolean(obs.mutatedThisTurn),
      verified: Boolean(obs.verifiedThisTurn),
      nudges: obs.verifyNudges ?? 0,
      planTurn: obs.planTurn,
    })
  ) {
    return { kind: "verifyNudge" };
  }
  return { kind: "stop" };
}

export type CliRoundCounters = {
  canvasNudges: number;
  canvasIncompleteNudges: number;
  reviewVerdictNudges: number;
  gameWipeNudges: number;
  gameUnplayableNudges: number;
  gamePlaywrightNudges: number;
  designMutateNudges: number;
  unusedLinkedAssetNudges: number;
  searchWanderNudges: number;
  verifyNudges: number;
  opsRoutingNudges: number;
  reviewRoutingNudges: number;
  selfCorrects: number;
  designQualityNudges: number;
  gameJuiceNudges: number;
  assetSculptNudges: number;
  adherenceNudges: number;
};

/** Keep nudge counters next to the CLI continue decision, not in each runner. */
export function bumpCliCounters(
  counters: CliRoundCounters,
  kind: AfterCliDecision["kind"],
): CliRoundCounters {
  return {
    canvasNudges: kind === "canvasNudge" ? counters.canvasNudges + 1 : counters.canvasNudges,
    canvasIncompleteNudges:
      kind === "canvasIncompleteNudge"
        ? counters.canvasIncompleteNudges + 1
        : counters.canvasIncompleteNudges,
    reviewVerdictNudges:
      kind === "reviewVerdictNudge"
        ? counters.reviewVerdictNudges + 1
        : counters.reviewVerdictNudges,
    gameWipeNudges:
      kind === "gameWipeNudge" || kind === "gameWipeRestore"
        ? counters.gameWipeNudges + 1
        : counters.gameWipeNudges,
    gameUnplayableNudges:
      kind === "gameUnplayableNudge"
        ? counters.gameUnplayableNudges + 1
        : counters.gameUnplayableNudges,
    gamePlaywrightNudges:
      kind === "gamePlaywrightNudge"
        ? counters.gamePlaywrightNudges + 1
        : counters.gamePlaywrightNudges,
    designMutateNudges:
      kind === "designMutateNudge" ? counters.designMutateNudges + 1 : counters.designMutateNudges,
    unusedLinkedAssetNudges:
      kind === "unusedLinkedAssetsNudge"
        ? counters.unusedLinkedAssetNudges + 1
        : counters.unusedLinkedAssetNudges,
    searchWanderNudges:
      kind === "searchWander" ? counters.searchWanderNudges + 1 : counters.searchWanderNudges,
    verifyNudges: kind === "verifyNudge" ? counters.verifyNudges + 1 : counters.verifyNudges,
    opsRoutingNudges:
      kind === "opsRouting" ? counters.opsRoutingNudges + 1 : counters.opsRoutingNudges,
    reviewRoutingNudges:
      kind === "reviewRouting" ? counters.reviewRoutingNudges + 1 : counters.reviewRoutingNudges,
    selfCorrects: kind === "selfCorrect" ? counters.selfCorrects + 1 : counters.selfCorrects,
    designQualityNudges:
      kind === "designQualityNudge"
        ? counters.designQualityNudges + 1
        : counters.designQualityNudges,
    gameJuiceNudges:
      kind === "gameJuiceNudge" ? counters.gameJuiceNudges + 1 : counters.gameJuiceNudges,
    assetSculptNudges:
      kind === "assetSculptNudge" ? counters.assetSculptNudges + 1 : counters.assetSculptNudges,
    adherenceNudges:
      kind === "adherenceNudge" ? counters.adherenceNudges + 1 : counters.adherenceNudges,
  };
}
