import { describe, expect, it, vi } from "vitest";
import type { AgentSession, ChatMessage } from "@locus/shared";
import { EMPTY_CANVAS_NUDGE } from "@locus/shared";
import { continueAfterCliRound, type CliTurnContinuePorts } from "./cliTurnContinue.js";

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Design",
    kind: "design",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    status: "running",
    os: "ubuntu",
    templateId: "docker",
    runtime: "docker",
    messages: [],
    ...partial,
  } as AgentSession;
}

function msg(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: partial.id ?? "m1",
    role: partial.role ?? "assistant",
    content: partial.content ?? "",
    createdAt: "2026-01-01",
    ...partial,
  };
}

function ports(overrides: Partial<CliTurnContinuePorts> = {}): CliTurnContinuePorts {
  return {
    require: async () => session(),
    hasSteerAfter: async () => false,
    flushStreaming: async () => undefined,
    readCanvas: async () => ({ html: null }),
    recoverCanvas: async () => false,
    restoreWipedCanvas: async () => undefined,
    rememberGoodStudioCanvas: () => undefined,
    leftoverAdherenceNudge: async () => undefined,
    studioIterateUnchanged: () => false,
    prefixPrompt: async (_id, prompt) => prompt,
    appendMessage: async () => undefined,
    gameCanvasBaseline: () => undefined,
    traces: { write: async () => undefined },
    now: () => "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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
  mutatedThisTurn: false,
  verifiedThisTurn: false,
  wroteCanvasThisTurn: false,
  calledPlaywrightThisTurn: false,
};

const base = {
  sessionId: "s1",
  replyId: "r1",
  abort: new AbortController(),
  turnId: "t1",
  round: 0,
  planTurn: false,
  designing: true,
  reviewing: false,
  messages: [msg({ id: "r1", role: "assistant" })],
  ...zeros,
};

describe("continueAfterCliRound", () => {
  it("returns the latest steer", async () => {
    const result = await continueAfterCliRound(ports({ hasSteerAfter: async () => true }), {
      ...base,
      messages: [
        msg({ id: "r1", role: "assistant" }),
        msg({ id: "u2", role: "user", content: "try again" }),
      ],
    });
    expect(result).toMatchObject({ stop: false, prompt: "try again" });
  });

  it("nudges an empty Design canvas", async () => {
    const result = await continueAfterCliRound(ports(), { ...base, traceNudges: true });
    expect(result.stop).toBe(false);
    if (result.stop) return;
    expect(result.canvasNudges).toBe(1);
    expect(result.prompt).toBe(EMPTY_CANVAS_NUDGE);
  });

  it("stops when the canvas already has HTML and this turn wrote and looked", async () => {
    const result = await continueAfterCliRound(
      ports({ readCanvas: async () => ({ html: "<html><body><h1>Hi</h1></body></html>" }) }),
      { ...base, wroteCanvasThisTurn: true, calledPlaywrightThisTurn: true },
    );
    expect(result).toEqual({ stop: true });
  });

  it("restores a wiped Game canvas after nudge budget", async () => {
    const restore = vi.fn();
    const baseline = `<html><body>${"x".repeat(900)}</body></html>`;
    const result = await continueAfterCliRound(
      ports({
        require: async () => session({ kind: "game" }),
        readCanvas: async () => ({ html: "<html><body></body></html>" }),
        gameCanvasBaseline: () => baseline,
        restoreWipedCanvas: restore,
      }),
      { ...base, designing: true, gameWipeNudges: 2 },
    );
    expect(restore).toHaveBeenCalledWith("s1");
    expect(result).toEqual({ stop: true });
  });
});
