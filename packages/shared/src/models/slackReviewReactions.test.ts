import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLACK_REVIEW_REACTIONS,
  parseSlackReactionNames,
  parseSlackReviewReactionMap,
  slackAddressedAdded,
  slackAddressedSnapshot,
  slackPostStopped,
  slackReviewReactionFor,
  slackReviewReactionPresetOf,
  SLACK_REVIEW_REACTION_PRESETS,
} from "./slackReviewReactions.js";
import { parseSlackReviewer } from "./slackReviewer.js";

const legend = SLACK_REVIEW_REACTION_PRESETS.legend.map;

describe("slack review reactions", () => {
  it("defaults to the classic set, so existing reviewers keep reacting as before", () => {
    expect(parseSlackReviewReactionMap(undefined)).toEqual(DEFAULT_SLACK_REVIEW_REACTIONS);
    expect(parseSlackReviewer({ channelId: "C1" })!.reactionMap).toEqual(
      SLACK_REVIEW_REACTION_PRESETS.classic.map,
    );
    expect(slackReviewReactionPresetOf(DEFAULT_SLACK_REVIEW_REACTIONS)).toBe("classic");
  });

  it("normalizes names, lists and presets", () => {
    expect(parseSlackReactionNames(":Speech_Balloon:, speech_balloon  name! x")).toEqual([
      "speech_balloon",
      "x",
    ]);
    const map = parseSlackReviewReactionMap({ ...legend, pickup: ":robot_face:" });
    expect(map).toEqual(legend);
    expect(slackReviewReactionPresetOf(map)).toBe("legend");
    expect(slackReviewReactionPresetOf({ ...legend, pickup: "eyes" })).toBeUndefined();
    // An explicitly cleared name stays cleared rather than falling back.
    expect(parseSlackReviewReactionMap({ working: "" }).working).toBe("");
  });

  it("picks a name per round, repeating the last", () => {
    expect(slackReviewReactionFor(legend, "commented", 0)).toBe("speech_balloon");
    expect(slackReviewReactionFor(legend, "commented", 1)).toBe("speech_balloon_plus1");
    expect(slackReviewReactionFor(legend, "commented", 2)).toBe("speech_balloon_plus2");
    expect(slackReviewReactionFor(legend, "commented", 7)).toBe("speech_balloon_plus2");
    expect(slackReviewReactionFor(legend, "approved")).toBeUndefined();
    expect(slackReviewReactionFor(legend, "clean")).toBeUndefined();
    expect(slackReviewReactionFor(DEFAULT_SLACK_REVIEW_REACTIONS, "clean")).toBe(
      "white_check_mark",
    );
  });

  it("reads stop and addressed reactions people leave", () => {
    expect(slackPostStopped(legend, [{ name: "mergedparrot", count: 1 }])).toBe(true);
    expect(slackPostStopped(legend, [{ name: "eyes", count: 2 }])).toBe(false);
    expect(slackPostStopped(DEFAULT_SLACK_REVIEW_REACTIONS, [{ name: "x", count: 1 }])).toBe(false);

    const before = slackAddressedSnapshot(legend, [
      { name: "lower_left_ballpoint_pen", count: 1 },
      { name: "fire", count: 3 },
    ]);
    expect(before).toEqual({ lower_left_ballpoint_pen: 1 });
    const after = slackAddressedSnapshot(legend, [
      { name: "lower_left_ballpoint_pen", count: 1 },
      { name: "ballpoint_pen_plus1::skin-tone-3", count: 1 },
    ]);
    expect(slackAddressedAdded(before, after)).toBe(true);
    expect(slackAddressedAdded(after, after)).toBe(false);
    expect(slackAddressedAdded(after, before)).toBe(false);
  });
});
