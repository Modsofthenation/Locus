import { randomUUID } from "node:crypto";
import type { AgentSession, ChatMessage } from "@locus/shared";
import {
  EMPTY_CANVAS_NUDGE,
  GAME_CANVAS_RESTORE_NOTE,
  INCOMPLETE_CANVAS_NUDGE,
  MAX_CANVAS_NUDGES,
  SEARCH_WANDER_NUDGE,
  VERIFY_NUDGE,
  OPS_ROUTING_NUDGE,
  ASSET_SCULPT_NUDGE,
  GAME_JUICE_NUDGE,
  canvasHtmlIncomplete,
  canvasHtmlUnchanged,
  canvasLooksWiped,
  canvasQualityNudge,
  formatAdherenceNudge,
  gameFollowUpMissingFromCanvas,
  isAssetSession,
  isCodingLoopSession,
  isDesignSession,
  isGameSession,
  isOpsProgressTool,
  isWorkspaceSearchTool,
  lastUserMessage,
  looksGenericDesign,
  looksHostFallbackCanvas,
  looksLikeFixableFailure,
  looksLikeOpsPrompt,
  looksLikeUnusedLinkedAssets,
  looksPlayableGame,
  looksDryGame,
  looksPlaceholderAsset,
  looksUnwiredAsset,
  parseReviewSessionVerdict,
  REVIEW_ROUTING_NUDGE,
  REVIEW_VERDICT_NUDGE,
  selfCorrectNudge,
  shouldApplyReviewVerdict,
  turnUserPrompt,
  unusedLinkedAssetsNudge,
  wroteAgentCanvas,
  foldCodingVerifyFlags,
  forgeToolNameFromCall,
  isReviewProgressTool,
} from "@locus/shared";
import {
  assetPlaywrightFailed,
  bumpCliCounters,
  calledFakeAssetPlaytest,
  calledFakeGamePlaytest,
  calledHudOnlyGamePlaytest,
  calledPlaywright,
  decideAfterCliRound,
  wroteLiveCanvas,
  type CliRoundCounters,
} from "./agentTurn.js";
import { studioLoopNudge } from "./sessionBootNotes.js";
import type { SessionTraceLog } from "./traces.js";

export type CliTurnContinueInput = CliRoundCounters & {
  sessionId: string;
  replyId: string;
  abort: AbortController;
  turnId: string;
  round: number;
  planTurn: boolean;
  designing: boolean;
  reviewing: boolean;
  messages: ChatMessage[];
  traceNudges?: boolean;
  mutatedThisTurn: boolean;
  verifiedThisTurn: boolean;
  wroteCanvasThisTurn: boolean;
  calledPlaywrightThisTurn: boolean;
};

export type CliTurnContinueResult =
  | { stop: true }
  | ({ stop: false; prompt: string; wroteCanvasThisTurn: boolean } & CliRoundCounters);

export type CliTurnContinuePorts = {
  require: (sessionId: string) => Promise<AgentSession>;
  hasSteerAfter: (sessionId: string, replyId: string) => Promise<boolean>;
  flushStreaming: (sessionId: string) => Promise<void>;
  readCanvas: (sessionId: string) => Promise<{ html: string | null }>;
  recoverCanvas: (sessionId: string) => Promise<boolean>;
  restoreWipedCanvas: (sessionId: string) => Promise<unknown>;
  rememberGoodStudioCanvas: (sessionId: string, html: string) => void;
  leftoverAdherenceNudge: (
    session: AgentSession,
    html: string | null,
  ) => Promise<string | undefined>;
  studioIterateUnchanged: (input: {
    isGame: boolean;
    isAsset: boolean;
    isDesign: boolean;
    userText: string | undefined;
    html: string | null | undefined;
    sessionId: string;
  }) => boolean;
  prefixPrompt: (sessionId: string, prompt: string, planTurn: boolean) => Promise<string>;
  appendMessage: (sessionId: string, message: ChatMessage) => Promise<unknown>;
  gameCanvasBaseline: (sessionId: string) => string | undefined;
  traces: Pick<SessionTraceLog, "write">;
  now: () => string;
};

function keepGoing(
  counters: CliRoundCounters,
  prompt: string,
  wroteCanvasThisTurn: boolean,
): Exclude<CliTurnContinueResult, { stop: true }> {
  return { stop: false, prompt, ...counters, wroteCanvasThisTurn };
}

/** Shared CLI Turn continue: steer, canvas recover, studio nudges. */
export async function continueAfterCliRound(
  ports: CliTurnContinuePorts,
  input: CliTurnContinueInput,
): Promise<CliTurnContinueResult> {
  if (input.abort.signal.aborted) return { stop: true };
  const continuePrompt = (prompt: string) =>
    ports.prefixPrompt(input.sessionId, prompt, input.planTurn);
  const counters: CliRoundCounters = {
    canvasNudges: input.canvasNudges,
    canvasIncompleteNudges: input.canvasIncompleteNudges,
    reviewVerdictNudges: input.reviewVerdictNudges,
    gameWipeNudges: input.gameWipeNudges,
    gameUnplayableNudges: input.gameUnplayableNudges,
    gamePlaywrightNudges: input.gamePlaywrightNudges,
    designMutateNudges: input.designMutateNudges,
    unusedLinkedAssetNudges: input.unusedLinkedAssetNudges,
    searchWanderNudges: input.searchWanderNudges,
    verifyNudges: input.verifyNudges,
    opsRoutingNudges: input.opsRoutingNudges,
    reviewRoutingNudges: input.reviewRoutingNudges,
    selfCorrects: input.selfCorrects,
    designQualityNudges: input.designQualityNudges,
    gameJuiceNudges: input.gameJuiceNudges,
    assetSculptNudges: input.assetSculptNudges,
    adherenceNudges: input.adherenceNudges,
  };
  if (await ports.hasSteerAfter(input.sessionId, input.replyId)) {
    const index = input.messages.findIndex((message) => message.id === input.replyId);
    const steers = input.messages
      .slice(index + 1)
      .filter((message) => message.role === "user" && message.content.trim());
    const next = steers[steers.length - 1]?.content.trim();
    if (!next) return { stop: true };
    return keepGoing(counters, await continuePrompt(next), input.wroteCanvasThisTurn);
  }
  await ports.flushStreaming(input.sessionId);
  const live = await ports.require(input.sessionId);
  const isGame = isGameSession(live);
  const isAsset = isAssetSession(live);
  let canvasHtml =
    input.designing && !input.planTurn
      ? (await ports.readCanvas(input.sessionId).catch(() => ({ html: null }))).html
      : null;
  let canvasEmpty = input.designing && !input.planTurn && !canvasHtml?.trim();
  const recoveredCanvas = canvasEmpty ? await ports.recoverCanvas(input.sessionId) : false;
  if (recoveredCanvas) {
    canvasHtml = (await ports.readCanvas(input.sessionId).catch(() => ({ html: null }))).html;
    canvasEmpty = input.designing && !input.planTurn && !canvasHtml?.trim();
  }
  const canvasIncomplete = input.designing && !input.planTurn && canvasHtmlIncomplete(canvasHtml);
  const reply = input.messages.find((message) => message.id === input.replyId);
  const toolCalls = reply?.toolCalls ?? [];
  const wroteCanvas = wroteLiveCanvas(toolCalls) || recoveredCanvas;
  const wroteThisTurn = input.wroteCanvasThisTurn || wroteCanvas;
  const calledLivePlaywright =
    calledPlaywright(toolCalls) &&
    !(isAsset && calledFakeAssetPlaytest(toolCalls)) &&
    !(isGame && calledHudOnlyGamePlaytest(toolCalls));
  const user = lastUserMessage(live.messages);
  const failed = toolCalls.find((call) => call.error && looksLikeFixableFailure(call.error, false));
  const adherenceDetail =
    input.designing && !isGame && !isAsset
      ? await ports.leftoverAdherenceNudge(live, canvasHtml)
      : undefined;
  const codingFlags = foldCodingVerifyFlags(toolCalls, {
    mutated: input.mutatedThisTurn,
    verified: input.verifiedThisTurn,
  });
  const decision = decideAfterCliRound({
    aborted: false,
    isDesign: input.designing,
    planTurn: input.planTurn,
    canvasEmpty,
    canvasIncomplete,
    recoveredCanvas: recoveredCanvas && canvasEmpty,
    canvasNudges: input.canvasNudges,
    canvasIncompleteNudges: input.canvasIncompleteNudges,
    isReview: input.reviewing,
    hasVerdict: Boolean(parseReviewSessionVerdict(input.messages)),
    applyThisTurn: shouldApplyReviewVerdict(input.messages),
    reviewVerdictNudges: input.reviewVerdictNudges,
    isGame,
    isAsset,
    wroteCanvas: input.wroteCanvasThisTurn || wroteCanvas,
    gameUnplayable: isGame && !looksPlayableGame(canvasHtml),
    assetUnwired: isAsset && looksUnwiredAsset(canvasHtml),
    calledPlaywright: input.calledPlaywrightThisTurn || calledLivePlaywright,
    playwrightFailed: isAsset && assetPlaywrightFailed(toolCalls),
    fakePlaytest:
      calledFakeGamePlaytest(toolCalls) ||
      (isAsset && calledFakeAssetPlaytest(toolCalls)) ||
      (isGame && calledHudOnlyGamePlaytest(toolCalls)),
    canvasWiped:
      (isGame || isAsset) &&
      canvasLooksWiped(ports.gameCanvasBaseline(input.sessionId), canvasHtml),
    canvasUnchanged:
      (isGame || isAsset) &&
      canvasHtmlUnchanged(ports.gameCanvasBaseline(input.sessionId), canvasHtml),
    followUpMissing: isGame && gameFollowUpMissingFromCanvas(user?.content, canvasHtml),
    iterateUnchanged: ports.studioIterateUnchanged({
      isGame,
      isAsset,
      isDesign: isDesignSession(live) && !isGame && !isAsset,
      userText: turnUserPrompt(live.messages) ?? user?.content,
      html: canvasHtml,
      sessionId: input.sessionId,
    }),
    gameWipeNudges: input.gameWipeNudges,
    gameUnplayableNudges: input.gameUnplayableNudges,
    gamePlaywrightNudges: input.gamePlaywrightNudges,
    designMutateNudges: input.designMutateNudges,
    unusedLinkedAssets: looksLikeUnusedLinkedAssets(
      canvasHtml,
      (live.assetRefs ?? []).map((row) => row.slug),
    ),
    unusedLinkedAssetNudges: input.unusedLinkedAssetNudges,
    isCoding: isCodingLoopSession(live),
    namedOps: looksLikeOpsPrompt(user?.content ?? ""),
    calledOps: toolCalls.some((call) => isOpsProgressTool(call.name)),
    calledReview: toolCalls.some(
      (call) =>
        isReviewProgressTool(call.name) || isReviewProgressTool(forgeToolNameFromCall(call)),
    ),
    searchRounds: wroteAgentCanvas(toolCalls)
      ? 0
      : toolCalls.filter((call) => isWorkspaceSearchTool(call.name, call.arguments)).length,
    mutatedThisTurn: codingFlags.mutated,
    verifiedThisTurn: codingFlags.verified,
    searchWanderNudges: input.searchWanderNudges,
    verifyNudges: input.verifyNudges,
    opsRoutingNudges: input.opsRoutingNudges,
    reviewRoutingNudges: input.reviewRoutingNudges,
    selfCorrects: input.selfCorrects,
    fixableFailure: failed?.error
      ? { name: failed.name, id: failed.id, error: failed.error }
      : undefined,
    genericDesign: input.designing && !isGame && !isAsset && looksGenericDesign(canvasHtml),
    hostFallback: input.designing && looksHostFallbackCanvas(canvasHtml),
    designQualityNudges: input.designQualityNudges,
    dryGame: isGame && looksDryGame(canvasHtml),
    gameJuiceNudges: input.gameJuiceNudges,
    placeholderAsset: isAsset && looksPlaceholderAsset(canvasHtml),
    assetSculptNudges: input.assetSculptNudges,
    adherenceIssues: Boolean(adherenceDetail),
    adherenceNudges: input.adherenceNudges,
  });
  if (
    (isGame || isAsset) &&
    canvasHtml &&
    !canvasLooksWiped(ports.gameCanvasBaseline(input.sessionId), canvasHtml)
  ) {
    ports.rememberGoodStudioCanvas(input.sessionId, canvasHtml);
  }
  if (decision.kind === "gameWipeRestore") {
    await ports.restoreWipedCanvas(input.sessionId);
    const next = bumpCliCounters(counters, decision.kind);
    if (input.traceNudges) {
      await ports.traces.write({
        t: ports.now(),
        kind: "selfCorrect",
        sessionId: input.sessionId,
        turnId: input.turnId,
        round: input.round,
        name: "game_restore",
        detail: GAME_CANVAS_RESTORE_NOTE,
      });
      await ports.appendMessage(input.sessionId, {
        id: randomUUID(),
        role: "system",
        content: GAME_CANVAS_RESTORE_NOTE,
        hidden: true,
        createdAt: ports.now(),
      });
    }
    if (next.gameWipeNudges >= MAX_CANVAS_NUDGES) return { stop: true };
    return keepGoing(next, await continuePrompt(GAME_CANVAS_RESTORE_NOTE), wroteThisTurn);
  }
  if (decision.kind === "canvasRecovered" || decision.kind === "stop") return { stop: true };
  const cliNudge =
    decision.kind === "canvasNudge"
      ? { prompt: EMPTY_CANVAS_NUDGE, name: "empty_canvas" }
      : decision.kind === "canvasIncompleteNudge"
        ? { prompt: INCOMPLETE_CANVAS_NUDGE, name: "incomplete_canvas" }
        : decision.kind === "gameUnplayableNudge" ||
            decision.kind === "gamePlaywrightNudge" ||
            decision.kind === "gameWipeNudge" ||
            decision.kind === "designMutateNudge"
          ? studioLoopNudge(decision.kind, isAsset, input.designing && !isGame && !isAsset)
          : decision.kind === "searchWander"
            ? { prompt: SEARCH_WANDER_NUDGE, name: "search_wander" }
            : decision.kind === "verifyNudge"
              ? { prompt: VERIFY_NUDGE, name: "verify" }
              : decision.kind === "opsRouting"
                ? { prompt: OPS_ROUTING_NUDGE, name: "ops_routing" }
                : decision.kind === "reviewRouting"
                  ? { prompt: REVIEW_ROUTING_NUDGE, name: "review_routing" }
                  : decision.kind === "selfCorrect"
                    ? { prompt: selfCorrectNudge(decision.error), name: "self_correct" }
                    : decision.kind === "designQualityNudge"
                      ? {
                          prompt: canvasQualityNudge(looksHostFallbackCanvas(canvasHtml)),
                          name: "design_quality",
                        }
                      : decision.kind === "gameJuiceNudge"
                        ? { prompt: GAME_JUICE_NUDGE, name: "game_juice" }
                        : decision.kind === "assetSculptNudge"
                          ? { prompt: ASSET_SCULPT_NUDGE, name: "asset_sculpt" }
                          : undefined;
  if (cliNudge) {
    if (input.traceNudges) {
      await ports.traces.write({
        t: ports.now(),
        kind: "selfCorrect",
        sessionId: input.sessionId,
        turnId: input.turnId,
        round: input.round,
        name: cliNudge.name,
        detail: cliNudge.prompt,
      });
      await ports.appendMessage(input.sessionId, {
        id: randomUUID(),
        role: "system",
        content: cliNudge.prompt,
        hidden: true,
        createdAt: ports.now(),
      });
    }
    return keepGoing(
      bumpCliCounters(counters, decision.kind),
      await continuePrompt(cliNudge.prompt),
      wroteThisTurn,
    );
  }
  if (decision.kind === "adherenceNudge") {
    const prompt = adherenceDetail ?? formatAdherenceNudge([]);
    if (input.traceNudges) {
      await ports.traces.write({
        t: ports.now(),
        kind: "selfCorrect",
        sessionId: input.sessionId,
        turnId: input.turnId,
        round: input.round,
        name: "design_adherence",
        detail: prompt,
      });
      await ports.appendMessage(input.sessionId, {
        id: randomUUID(),
        role: "system",
        content: prompt,
        hidden: true,
        createdAt: ports.now(),
      });
    }
    return keepGoing(
      bumpCliCounters(counters, decision.kind),
      await continuePrompt(prompt),
      wroteThisTurn,
    );
  }
  if (decision.kind === "unusedLinkedAssetsNudge") {
    const prompt = unusedLinkedAssetsNudge((live.assetRefs ?? []).map((row) => row.slug));
    if (input.traceNudges) {
      await ports.traces.write({
        t: ports.now(),
        kind: "selfCorrect",
        sessionId: input.sessionId,
        turnId: input.turnId,
        round: input.round,
        name: "unused_linked_assets",
        detail: prompt,
      });
      await ports.appendMessage(input.sessionId, {
        id: randomUUID(),
        role: "system",
        content: prompt,
        hidden: true,
        createdAt: ports.now(),
      });
    }
    return keepGoing(
      bumpCliCounters(counters, decision.kind),
      await continuePrompt(prompt),
      wroteThisTurn,
    );
  }
  if (decision.kind === "reviewVerdictNudge") {
    if (input.traceNudges) {
      await ports.traces.write({
        t: ports.now(),
        kind: "selfCorrect",
        sessionId: input.sessionId,
        turnId: input.turnId,
        round: input.round,
        name: "review_verdict",
        detail: REVIEW_VERDICT_NUDGE,
      });
    }
    return keepGoing(
      bumpCliCounters(counters, decision.kind),
      await continuePrompt(REVIEW_VERDICT_NUDGE),
      wroteThisTurn,
    );
  }
  return { stop: true };
}
