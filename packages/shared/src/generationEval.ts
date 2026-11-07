/** Pass/fail scorers for generation fixtures: coding tests, design HTML, games, assets. */

import { looksPlaceholderAsset, looksUnwiredAsset } from "./models/assetCanvas.js";
import { looksLikeUnusedLinkedAssets } from "./models/assetPack.js";
import {
  canvasHtmlIncomplete,
  looksHostFallbackCanvas,
  looksLikeHtmlDocumentDraft,
} from "./models/canvasStream.js";
import { looksGenericDesign } from "./models/designQuality.js";
import { looksDryGame, looksPlayableGame } from "./models/gameCanvas.js";
import { scoreCodingEval } from "./codingEval.js";

export type GenerationKind = "coding" | "design" | "game" | "asset";

export interface GenerationEvalScore {
  id: string;
  kind: GenerationKind;
  passed: boolean;
  reason: string;
}

export function scoreGenerationEval(input: {
  id: string;
  kind: GenerationKind;
  html?: string;
  testsRan?: boolean;
  testsOk?: boolean;
  source?: string;
  expectSource?: RegExp | string;
  assetSlugs?: string[];
}): GenerationEvalScore {
  if (input.kind === "coding") {
    const coding = scoreCodingEval({
      id: input.id,
      testsRan: Boolean(input.testsRan),
      testsOk: Boolean(input.testsOk),
      source: input.source,
      expectSource: input.expectSource,
    });
    return { id: input.id, kind: "coding", passed: coding.passed, reason: coding.reason };
  }
  const html = input.html?.trim() ?? "";
  if (looksHostFallbackCanvas(html)) {
    return { id: input.id, kind: input.kind, passed: false, reason: "host fallback" };
  }
  if (input.kind === "design") {
    if (!html || !looksLikeHtmlDocumentDraft(html) || canvasHtmlIncomplete(html)) {
      return { id: input.id, kind: "design", passed: false, reason: "canvas incomplete" };
    }
    if (looksGenericDesign(html)) {
      return { id: input.id, kind: "design", passed: false, reason: "generic template" };
    }
    return { id: input.id, kind: "design", passed: true, reason: "distinctive canvas" };
  }
  if (input.kind === "game") {
    if (!looksPlayableGame(html)) {
      return { id: input.id, kind: "game", passed: false, reason: "unplayable" };
    }
    if (looksLikeUnusedLinkedAssets(html, input.assetSlugs ?? [])) {
      return { id: input.id, kind: "game", passed: false, reason: "unused assets" };
    }
    if (looksDryGame(html)) {
      return { id: input.id, kind: "game", passed: false, reason: "dry" };
    }
    return { id: input.id, kind: "game", passed: true, reason: "playable" };
  }
  if (looksUnwiredAsset(html)) {
    return { id: input.id, kind: "asset", passed: false, reason: "unwired" };
  }
  if (looksPlaceholderAsset(html)) {
    return { id: input.id, kind: "asset", passed: false, reason: "placeholder" };
  }
  return { id: input.id, kind: "asset", passed: true, reason: "wired" };
}

const GENERATION_QUALITY_NEEDS_HUMAN: Record<string, string> = {
  "host fallback": "Canvas is a last-resort host draft. Needs a human.",
  "canvas incomplete": "Design canvas is incomplete. Needs a human.",
  "generic template": "Design canvas is still a generic AI template. Needs a human.",
  unplayable: "Game canvas is not playable. Needs a human.",
  "unused assets": "Game linked asset packs but never loaded them. Needs a human.",
  dry: "Game canvas is playable but still dry (no juice). Needs a human.",
  unwired: "3D asset canvas is unwired. Needs a human.",
  placeholder: "3D asset canvas is still a placeholder. Needs a human.",
};

/** Empty canvases skip. A written canvas that still fails the scorer cannot ship. */
export function generationQualityNeedsHuman(input: {
  kind: GenerationKind;
  html?: string | null;
  assetSlugs?: string[];
}): string | undefined {
  if (input.kind === "coding") return undefined;
  const html = input.html?.trim() ?? "";
  if (!html) return undefined;
  const score = scoreGenerationEval({
    id: "turn-end",
    kind: input.kind,
    html,
    assetSlugs: input.assetSlugs,
  });
  if (score.passed) return undefined;
  return (
    GENERATION_QUALITY_NEEDS_HUMAN[score.reason] ??
    `Generation failed: ${score.reason}. Needs a human.`
  );
}
