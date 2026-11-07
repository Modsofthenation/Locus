import { describe, expect, it } from "vitest";
import {
  compactLoopWallNotes,
  isBootWaitAssistant,
  isStartPromptResumeTail,
  lastUserMessageIndex,
  startPromptLooksIgnored,
  studioLoopNudge,
} from "./sessionBootNotes.js";
import {
  GAME_CANVAS_RESTORE_NOTE,
  GAME_MUTATE_NUDGE,
  EMPTY_CANVAS_NUDGE,
  INCOMPLETE_CANVAS_NUDGE,
  DESIGN_MUTATE_NUDGE,
  DESIGN_LOOK_NUDGE,
  DESIGN_QUALITY_NUDGE,
  HOST_FALLBACK_NUDGE,
  GAME_JUICE_NUDGE,
  ASSET_SCULPT_NUDGE,
  UNUSED_LINKED_ASSETS_PREFIX,
  SEARCH_WANDER_NUDGE,
  SELF_CORRECT_PATCH_NUDGE,
  VERIFY_NUDGE,
  REVIEW_VERDICT_NUDGE,
  REVIEW_ROUTING_NUDGE,
  OPS_ROUTING_NUDGE,
  type AgentSession,
  type ChatMessage,
} from "@locus/shared";

const stamp = "2020-01-01T00:00:00.000Z";

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, "role" | "content">): ChatMessage {
  return { id: partial.id ?? "m", createdAt: stamp, ...partial };
}

describe("sessionBootNotes", () => {
  it("finds the last user message", () => {
    expect(lastUserMessageIndex([])).toBe(-1);
    expect(
      lastUserMessageIndex([
        msg({ id: "u1", role: "user", content: "hi" }),
        msg({ id: "a1", role: "assistant", content: "ok" }),
        msg({ id: "u2", role: "user", content: "again" }),
      ]),
    ).toBe(2);
  });

  it("treats empty and still-starting assistant replies as boot waits", () => {
    expect(isBootWaitAssistant(msg({ role: "assistant", content: "" }))).toBe(true);
    expect(
      isBootWaitAssistant(msg({ role: "assistant", content: "The guest is not ready yet." })),
    ).toBe(true);
    expect(isBootWaitAssistant(msg({ role: "assistant", content: "Done." }))).toBe(false);
  });

  it("keeps boot-wait tails as resume, not a finished start prompt", () => {
    expect(isStartPromptResumeTail(msg({ role: "assistant", content: "" }))).toBe(true);
    expect(isStartPromptResumeTail(msg({ role: "user", content: "hi" }))).toBe(false);
    expect(
      isStartPromptResumeTail(msg({ role: "system", content: GAME_CANVAS_RESTORE_NOTE })),
    ).toBe(true);
    expect(isStartPromptResumeTail(msg({ role: "system", content: SEARCH_WANDER_NUDGE }))).toBe(
      true,
    );
    expect(isStartPromptResumeTail(msg({ role: "system", content: VERIFY_NUDGE }))).toBe(true);
    expect(isStartPromptResumeTail(msg({ role: "system", content: DESIGN_QUALITY_NUDGE }))).toBe(
      true,
    );
    expect(isStartPromptResumeTail(msg({ role: "system", content: HOST_FALLBACK_NUDGE }))).toBe(
      true,
    );
    expect(isStartPromptResumeTail(msg({ role: "system", content: GAME_JUICE_NUDGE }))).toBe(true);
    expect(isStartPromptResumeTail(msg({ role: "system", content: ASSET_SCULPT_NUDGE }))).toBe(
      true,
    );
    expect(
      isStartPromptResumeTail(
        msg({ role: "system", content: `${UNUSED_LINKED_ASSETS_PREFIX} Load @asset:knight.` }),
      ),
    ).toBe(true);
    expect(
      isStartPromptResumeTail(msg({ role: "system", content: SELF_CORRECT_PATCH_NUDGE })),
    ).toBe(true);
  });

  it("flags a start prompt that only got boot-wait replies", () => {
    const session: AgentSession = {
      id: "s1",
      title: "Agent",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      messages: [
        msg({ id: "u1", role: "user", content: "start" }),
        msg({ id: "a1", role: "assistant", content: "The guest is not ready yet." }),
      ],
      createdAt: stamp,
      updatedAt: stamp,
    };
    expect(startPromptLooksIgnored(session)).toBe(true);
    session.messages.push(
      msg({
        id: "a2",
        role: "assistant",
        content: "Working",
        toolCalls: [{ id: "t1", name: "exec", arguments: {}, startedAt: stamp }],
      }),
    );
    expect(startPromptLooksIgnored(session)).toBe(false);
  });

  it("uses the Games mutate copy when the canvas did not change for the request", () => {
    expect(studioLoopNudge("designMutateNudge", false)).toEqual({
      prompt: GAME_MUTATE_NUDGE,
      name: "game_mutate",
    });
    expect(studioLoopNudge("designMutateNudge", true).prompt).toBe(DESIGN_MUTATE_NUDGE);
    expect(studioLoopNudge("designMutateNudge", false, true)).toEqual({
      prompt: DESIGN_MUTATE_NUDGE,
      name: "design_mutate",
    });
    expect(studioLoopNudge("gamePlaywrightNudge", false, true)).toEqual({
      prompt: DESIGN_LOOK_NUDGE,
      name: "design_look",
    });
  });

  it("re-injects coding and review walls after compact, not only canvas walls", () => {
    const empty = {
      canvasNudges: 0,
      canvasIncompleteNudges: 0,
      designMutateNudges: 0,
      gamePlaywrightNudges: 0,
      gameUnplayableNudges: 0,
      designQualityNudges: 0,
      unusedLinkedAssetNudges: 0,
      unusedAssetSlugs: [] as string[],
      gameJuiceNudges: 0,
      assetSculptNudges: 0,
      adherenceNote: "",
      gameWipeNudges: 0,
      searchWanderNudges: 0,
      verifyNudges: 0,
      reviewVerdictNudges: 0,
      reviewRoutingNudges: 0,
      opsRoutingNudges: 0,
      isAsset: false,
      isDesignOnly: false,
    };
    expect(compactLoopWallNotes({ ...empty, designQualityNudges: 1 })).toContain(
      DESIGN_QUALITY_NUDGE,
    );
    expect(
      compactLoopWallNotes({ ...empty, designQualityNudges: 1, hostFallback: true }),
    ).toContain(HOST_FALLBACK_NUDGE);
    expect(
      compactLoopWallNotes({ ...empty, designQualityNudges: 1, hostFallback: true }),
    ).not.toContain(DESIGN_QUALITY_NUDGE);
    expect(compactLoopWallNotes({ ...empty, searchWanderNudges: 1 })).toContain(
      SEARCH_WANDER_NUDGE,
    );
    expect(compactLoopWallNotes({ ...empty, verifyNudges: 1 })).toContain(VERIFY_NUDGE);
    expect(compactLoopWallNotes({ ...empty, reviewVerdictNudges: 1 })).toContain(
      REVIEW_VERDICT_NUDGE,
    );
    expect(compactLoopWallNotes({ ...empty, reviewRoutingNudges: 1 })).toContain(
      REVIEW_ROUTING_NUDGE,
    );
    expect(compactLoopWallNotes({ ...empty, opsRoutingNudges: 1 })).toContain(OPS_ROUTING_NUDGE);
    expect(compactLoopWallNotes({ ...empty, canvasNudges: 2 })).toBe(EMPTY_CANVAS_NUDGE);
    expect(compactLoopWallNotes({ ...empty, canvasIncompleteNudges: 2 })).toBe(
      INCOMPLETE_CANVAS_NUDGE,
    );
    expect(compactLoopWallNotes(empty)).toBe("");
    expect(
      compactLoopWallNotes({
        ...empty,
        canvasSnapshot: "Design canvas snapshot\n- index.html 12 bytes",
      }),
    ).toMatch(/Design canvas snapshot/);
  });
});
