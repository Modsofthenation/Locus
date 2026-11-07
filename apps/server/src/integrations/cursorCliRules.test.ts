import { describe, expect, it } from "vitest";
import {
  CURSOR_CODING_ROUTING_CARD,
  CURSOR_DESIGN_ROUTING_CARD,
  CURSOR_GAME_ROUTING_CARD,
  CURSOR_ASSET_ROUTING_CARD,
  CURSOR_REVIEW_ROUTING_CARD,
} from "@locus/shared";
import { formatLocusCursorRule } from "./cursorCliRules.js";

describe("cursor cli session rules", () => {
  it("puts review routing in an alwaysApply rule and skips empty sessions", () => {
    expect(formatLocusCursorRule({})).toBeUndefined();
    const review = formatLocusCursorRule({ review: true, instructions: "Be terse." });
    expect(review).toContain("alwaysApply: true");
    expect(review).toContain(CURSOR_REVIEW_ROUTING_CARD);
    expect(review).toContain("still a review session");
    expect(review).toContain("Operator instructions:\nBe terse.");
  });

  it("puts coding wander/verify routing in an alwaysApply rule", () => {
    const coding = formatLocusCursorRule({ coding: true });
    expect(coding).toContain("alwaysApply: true");
    expect(coding).toContain(CURSOR_CODING_ROUTING_CARD);
    expect(coding).not.toContain(CURSOR_DESIGN_ROUTING_CARD);
    const design = formatLocusCursorRule({ coding: true, design: true });
    expect(design).toContain(CURSOR_DESIGN_ROUTING_CARD);
    expect(design).not.toContain(CURSOR_CODING_ROUTING_CARD);
  });

  it("uses the game routing card instead of the design card for Games", () => {
    const game = formatLocusCursorRule({ game: true, design: true });
    expect(game).toContain(CURSOR_GAME_ROUTING_CARD);
    expect(game).not.toContain(CURSOR_DESIGN_ROUTING_CARD);
    const design = formatLocusCursorRule({ design: true });
    expect(design).toContain(CURSOR_DESIGN_ROUTING_CARD);
    expect(design).not.toContain(CURSOR_GAME_ROUTING_CARD);
  });

  it("uses the asset routing card for Assets studios", () => {
    const assets = formatLocusCursorRule({ assets: true, design: true });
    expect(assets).toContain(CURSOR_ASSET_ROUTING_CARD);
    expect(assets).not.toContain(CURSOR_DESIGN_ROUTING_CARD);
    expect(assets).not.toContain(CURSOR_GAME_ROUTING_CARD);
  });
});
