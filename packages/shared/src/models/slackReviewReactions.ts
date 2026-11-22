/**
 * Reaction protocol for the Slack PR reviewer: which emoji the reviewer leaves on the original PR
 * post at each step, and which emoji left by people it reads back.
 *
 * Teams use the reaction stack on a PR post as its review status, so the names are configurable.
 * Two presets ship: `classic` (👀 while reviewing, then 📝 / ✅ / ❌) and `legend`, a common
 * channel legend where :robot_face: means a bot picked the PR up, :speech_balloon: (then
 * `_plus1` / `_plus2` on later rounds) means it left comments, a pen means the author addressed
 * them, and the ✅ tick is left to humans.
 */
import { normalizeSlackReactionName } from "./slack.js";

export interface SlackReviewReactionMap {
  /** Shown while a review runs, removed when it ends. Empty = none. */
  working: string;
  /** Left on the post when the reviewer picks the PR up, and kept. Empty = none. */
  pickup: string;
  /** Review left comments. One name per round (first review, second, third…); the last repeats. */
  commented: string[];
  /** Verdict mode asked for changes. Per round like `commented`. */
  changesRequested: string[];
  /** Verdict mode approved the PR on the forge. Empty = none (leave the tick to humans). */
  approved: string;
  /** Nothing to report. Empty = none. */
  clean: string;
  /** The review could not run. Empty = none. */
  failed: string;
  /**
   * Left by people: the author addressed the comments. With `rereviewOnAddressed`, a new one on a
   * watched post asks for a re-review.
   */
  addressed: string[];
  /** Left by people: merged or declined. The reviewer skips such a post and stops watching it. */
  stop: string[];
  /** Re-review when someone adds an `addressed` reaction to the post. */
  rereviewOnAddressed: boolean;
}

export const SLACK_REVIEW_REACTION_PRESET_IDS = ["classic", "legend"] as const;
export type SlackReviewReactionPresetId = (typeof SLACK_REVIEW_REACTION_PRESET_IDS)[number];

export const SLACK_REVIEW_REACTION_PRESETS: Record<
  SlackReviewReactionPresetId,
  { label: string; hint: string; map: SlackReviewReactionMap }
> = {
  classic: {
    label: "Classic",
    hint: "👀 while reviewing, then 📝 comments, ✅ clean or approved, ❌ changes requested.",
    map: {
      working: "eyes",
      pickup: "",
      commented: ["memo"],
      changesRequested: ["x"],
      approved: "white_check_mark",
      clean: "white_check_mark",
      failed: "",
      addressed: [],
      stop: [],
      rereviewOnAddressed: false,
    },
  },
  legend: {
    label: "PR review legend",
    hint: "🤖 picked up, 💬 comments (then 💬+1 / 💬+2 on re-reviews). A pen from the author asks for another look; merged or ❌ stops it. The ✅ tick stays with humans.",
    map: {
      working: "",
      pickup: "robot_face",
      commented: ["speech_balloon", "speech_balloon_plus1", "speech_balloon_plus2"],
      changesRequested: ["speech_balloon", "speech_balloon_plus1", "speech_balloon_plus2"],
      approved: "",
      clean: "",
      failed: "",
      addressed: [
        "lower_left_ballpoint_pen",
        "lower_left_fountain_pen",
        "ballpoint_pen_plus1",
        "ballpoint_pen_plus2",
      ],
      stop: ["mergedparrot", "x"],
      rereviewOnAddressed: true,
    },
  },
};

export const DEFAULT_SLACK_REVIEW_REACTIONS: SlackReviewReactionMap =
  SLACK_REVIEW_REACTION_PRESETS.classic.map;

const MAX_REACTION_NAMES = 12;

/** `:Speech_Balloon:` → `speech_balloon`. Anything that can't be an emoji name → "". */
export function slackReactionNameOrEmpty(raw: unknown): string {
  return typeof raw === "string" ? (normalizeSlackReactionName(raw) ?? "") : "";
}

/** A list from an array or a comma / space separated string, normalized and de-duplicated. */
export function parseSlackReactionNames(raw: unknown): string[] {
  const rows = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
  const out: string[] = [];
  for (const row of rows) {
    const name = slackReactionNameOrEmpty(row);
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= MAX_REACTION_NAMES) break;
  }
  return out;
}

export function parseSlackReviewReactionMap(raw: unknown): SlackReviewReactionMap {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SLACK_REVIEW_REACTIONS };
  const value = raw as Record<string, unknown>;
  const fallback = DEFAULT_SLACK_REVIEW_REACTIONS;
  const one = (key: keyof SlackReviewReactionMap, def: string) =>
    key in value ? slackReactionNameOrEmpty(value[key]) : def;
  const list = (key: keyof SlackReviewReactionMap, def: string[]) =>
    key in value ? parseSlackReactionNames(value[key]) : [...def];
  return {
    working: one("working", fallback.working),
    pickup: one("pickup", fallback.pickup),
    commented: list("commented", fallback.commented),
    changesRequested: list("changesRequested", fallback.changesRequested),
    approved: one("approved", fallback.approved),
    clean: one("clean", fallback.clean),
    failed: one("failed", fallback.failed),
    addressed: list("addressed", fallback.addressed),
    stop: list("stop", fallback.stop),
    rereviewOnAddressed: value.rereviewOnAddressed === true,
  };
}

/** The preset a map matches exactly, or undefined when it was edited. */
export function slackReviewReactionPresetOf(
  map: SlackReviewReactionMap,
): SlackReviewReactionPresetId | undefined {
  const key = JSON.stringify(parseSlackReviewReactionMap(map));
  return SLACK_REVIEW_REACTION_PRESET_IDS.find(
    (id) => JSON.stringify(SLACK_REVIEW_REACTION_PRESETS[id].map) === key,
  );
}

type FinalOutcome = "approved" | "commented" | "changesRequested" | "clean" | "skipped" | "failed";

/**
 * Reaction for a finished review. `round` counts earlier finished reviews of the same PR (0 for
 * the first), so a re-review that still has comments can use the next name in the list.
 */
export function slackReviewReactionFor(
  map: SlackReviewReactionMap,
  outcome: FinalOutcome | string,
  round = 0,
): string | undefined {
  const byRound = (names: string[]) =>
    names.length ? names[Math.min(Math.max(0, round), names.length - 1)] : undefined;
  const pick =
    outcome === "commented"
      ? byRound(map.commented)
      : outcome === "changesRequested"
        ? byRound(map.changesRequested)
        : outcome === "approved"
          ? map.approved
          : outcome === "clean"
            ? map.clean
            : outcome === "failed"
              ? map.failed
              : "";
  return pick || undefined;
}

/** Whether people have marked the post merged or declined. */
export function slackPostStopped(
  map: Pick<SlackReviewReactionMap, "stop">,
  reactions: Array<{ name: string; count: number }> | undefined,
): boolean {
  if (!map.stop.length) return false;
  return (reactions ?? []).some((row) => row.count > 0 && map.stop.includes(baseName(row.name)));
}

/** Count of each `addressed` reaction on the post, for spotting a new one. */
export function slackAddressedSnapshot(
  map: Pick<SlackReviewReactionMap, "addressed">,
  reactions: Array<{ name: string; count: number }> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of reactions ?? []) {
    const name = baseName(row.name);
    if (row.count > 0 && map.addressed.includes(name)) out[name] = (out[name] ?? 0) + row.count;
  }
  return out;
}

/** Whether `next` has an addressed reaction that `before` did not (or more of one). */
export function slackAddressedAdded(
  before: Record<string, number>,
  next: Record<string, number>,
): boolean {
  return Object.entries(next).some(([name, count]) => count > (before[name] ?? 0));
}

/** Slack reports skin tones as `name::skin-tone-2`. */
function baseName(name: string): string {
  return name.split("::")[0]!.toLowerCase();
}
