import type { AgentSession, ChatMessage } from "@locus/shared";
import {
  ASSET_CANVAS_IFRAME_NUDGE,
  ASSET_CANVAS_WIPE_NUDGE,
  ASSET_PLAYWRIGHT_NUDGE,
  DESIGN_MUTATE_NUDGE,
  DESIGN_LOOK_NUDGE,
  DESIGN_QUALITY_NUDGE,
  HOST_FALLBACK_NUDGE,
  canvasQualityNudge,
  GAME_MUTATE_NUDGE,
  OPS_ROUTING_NUDGE,
  REVIEW_ROUTING_NUDGE,
  REVIEW_VERDICT_NUDGE,
  SEARCH_WANDER_NUDGE,
  SELF_CORRECT_CORS_NUDGE,
  SELF_CORRECT_MISSING_NUDGE,
  SELF_CORRECT_NUDGE,
  SELF_CORRECT_PATCH_NUDGE,
  SELF_CORRECT_TEST_NUDGE,
  VERIFY_NUDGE,
  DOCKER_BOOT_NOTE,
  DOCKER_READY_NOTE,
  EMPTY_CANVAS_NUDGE,
  GAME_CANVAS_IFRAME_NUDGE,
  GAME_CANVAS_RESTORE_NOTE,
  GAME_CANVAS_WIPE_NUDGE,
  GAME_PLAYWRIGHT_NUDGE,
  GAME_JUICE_NUDGE,
  INCOMPLETE_CANVAS_NUDGE,
  UNPLAYABLE_GAME_NUDGE,
  UNWIRED_ASSET_NUDGE,
  ASSET_SCULPT_NUDGE,
  VM_BOOT_NOTE,
  VM_INSTALL_NOTE,
  VM_READY_NOTE,
  isAdherenceNudge,
  unusedLinkedAssetsNudge,
  UNUSED_LINKED_ASSETS_PREFIX,
} from "@locus/shared";
import { EMPTY_CANVAS_NOTE } from "../design/designCanvas.js";
import { EMPTY_MODEL_REPLY } from "./sessionMockLlm.js";

export function lastUserMessageIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

export function isBootWaitAssistant(message: ChatMessage): boolean {
  if (message.role !== "assistant") return false;
  if (message.toolCalls?.length) return false;
  const text = message.content.trim();
  if (!text || text === EMPTY_MODEL_REPLY) return true;
  return /still starting|not ready yet|did not become ready|container is not ready|guest is not ready/i.test(
    text,
  );
}

export function isStartPromptResumeTail(message: ChatMessage): boolean {
  if (message.role === "assistant") return isBootWaitAssistant(message);
  if (message.role !== "system") return false;
  if (message.content.startsWith("Game canvas snapshot")) return true;
  if (message.content.startsWith("Asset canvas snapshot")) return true;
  if (message.content.startsWith("Design canvas snapshot")) return true;
  return (
    message.content === EMPTY_CANVAS_NUDGE ||
    message.content === DESIGN_MUTATE_NUDGE ||
    message.content === DESIGN_LOOK_NUDGE ||
    message.content === DESIGN_QUALITY_NUDGE ||
    message.content === HOST_FALLBACK_NUDGE ||
    message.content === GAME_MUTATE_NUDGE ||
    message.content === INCOMPLETE_CANVAS_NUDGE ||
    message.content === UNPLAYABLE_GAME_NUDGE ||
    message.content === GAME_JUICE_NUDGE ||
    message.content === GAME_PLAYWRIGHT_NUDGE ||
    message.content === GAME_CANVAS_WIPE_NUDGE ||
    message.content === GAME_CANVAS_RESTORE_NOTE ||
    message.content === GAME_CANVAS_IFRAME_NUDGE ||
    message.content === UNWIRED_ASSET_NUDGE ||
    message.content === ASSET_SCULPT_NUDGE ||
    message.content === ASSET_PLAYWRIGHT_NUDGE ||
    message.content === ASSET_CANVAS_WIPE_NUDGE ||
    message.content === ASSET_CANVAS_IFRAME_NUDGE ||
    message.content === SEARCH_WANDER_NUDGE ||
    message.content === VERIFY_NUDGE ||
    message.content === OPS_ROUTING_NUDGE ||
    message.content === REVIEW_ROUTING_NUDGE ||
    message.content === SELF_CORRECT_NUDGE ||
    message.content === SELF_CORRECT_PATCH_NUDGE ||
    message.content === SELF_CORRECT_TEST_NUDGE ||
    message.content === SELF_CORRECT_MISSING_NUDGE ||
    message.content === SELF_CORRECT_CORS_NUDGE ||
    isAdherenceNudge(message.content) ||
    message.content.startsWith(UNUSED_LINKED_ASSETS_PREFIX) ||
    message.content === EMPTY_CANVAS_NOTE ||
    message.content === EMPTY_MODEL_REPLY ||
    message.content.includes("did not become ready")
  );
}

export function startPromptLooksIgnored(session: AgentSession): boolean {
  const idx = lastUserMessageIndex(session.messages);
  if (idx < 0) return false;
  const after = session.messages.slice(idx + 1);
  if (after.some((message) => (message.toolCalls?.length ?? 0) > 0 || message.role === "tool"))
    return false;
  const assistants = after.filter((message) => message.role === "assistant");
  if (!assistants.length) return true;
  return assistants.every((message) => isBootWaitAssistant(message));
}

export function studioLoopNudge(
  kind: "gameUnplayableNudge" | "gamePlaywrightNudge" | "gameWipeNudge" | "designMutateNudge",
  assets: boolean,
  design = false,
): { prompt: string; name: string } {
  if (kind === "gameUnplayableNudge") {
    return assets
      ? { prompt: UNWIRED_ASSET_NUDGE, name: "unwired_asset" }
      : { prompt: UNPLAYABLE_GAME_NUDGE, name: "unplayable_game" };
  }
  if (kind === "gamePlaywrightNudge") {
    if (design) return { prompt: DESIGN_LOOK_NUDGE, name: "design_look" };
    return assets
      ? { prompt: ASSET_PLAYWRIGHT_NUDGE, name: "asset_playwright" }
      : { prompt: GAME_PLAYWRIGHT_NUDGE, name: "game_playwright" };
  }
  if (kind === "gameWipeNudge") {
    return assets
      ? { prompt: ASSET_CANVAS_WIPE_NUDGE, name: "asset_wipe" }
      : { prompt: GAME_CANVAS_WIPE_NUDGE, name: "game_wipe" };
  }
  if (design || assets) return { prompt: DESIGN_MUTATE_NUDGE, name: "design_mutate" };
  return { prompt: GAME_MUTATE_NUDGE, name: "game_mutate" };
}

export function compactLoopWallNotes(input: {
  canvasSnapshot?: string;
  canvasNudges: number;
  canvasIncompleteNudges: number;
  designMutateNudges: number;
  gamePlaywrightNudges: number;
  gameUnplayableNudges: number;
  designQualityNudges: number;
  hostFallback?: boolean;
  unusedLinkedAssetNudges: number;
  unusedAssetSlugs: string[];
  gameJuiceNudges: number;
  assetSculptNudges: number;
  adherenceNote: string;
  gameWipeNudges: number;
  searchWanderNudges: number;
  verifyNudges: number;
  reviewVerdictNudges: number;
  reviewRoutingNudges: number;
  opsRoutingNudges: number;
  isAsset: boolean;
  isDesignOnly: boolean;
}): string {
  return [
    input.canvasSnapshot?.trim() ?? "",
    input.canvasNudges ? EMPTY_CANVAS_NUDGE : "",
    input.canvasIncompleteNudges ? INCOMPLETE_CANVAS_NUDGE : "",
    input.designMutateNudges
      ? studioLoopNudge("designMutateNudge", input.isAsset, input.isDesignOnly).prompt
      : "",
    input.gamePlaywrightNudges
      ? studioLoopNudge("gamePlaywrightNudge", input.isAsset, input.isDesignOnly).prompt
      : "",
    input.gameUnplayableNudges ? studioLoopNudge("gameUnplayableNudge", input.isAsset).prompt : "",
    input.designQualityNudges ? canvasQualityNudge(Boolean(input.hostFallback)) : "",
    input.unusedLinkedAssetNudges ? unusedLinkedAssetsNudge(input.unusedAssetSlugs) : "",
    input.gameJuiceNudges ? GAME_JUICE_NUDGE : "",
    input.assetSculptNudges ? ASSET_SCULPT_NUDGE : "",
    input.adherenceNote,
    input.gameWipeNudges ? (input.isAsset ? ASSET_CANVAS_WIPE_NUDGE : GAME_CANVAS_WIPE_NUDGE) : "",
    input.searchWanderNudges ? SEARCH_WANDER_NUDGE : "",
    input.verifyNudges ? VERIFY_NUDGE : "",
    input.reviewVerdictNudges ? REVIEW_VERDICT_NUDGE : "",
    input.reviewRoutingNudges ? REVIEW_ROUTING_NUDGE : "",
    input.opsRoutingNudges ? OPS_ROUTING_NUDGE : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function cloneStartNote(input: {
  url: string;
  dest: string;
  runtime: AgentSession["runtime"];
  design?: boolean;
}): string {
  if (input.design) {
    return `Cloning ${input.url} into ${input.dest} for design context (read-only reference)`;
  }
  const where = input.runtime === "host" ? "host workspace" : "guest";
  return `Cloning ${input.url} into the ${where} at ${input.dest}`;
}

export function bootNote(
  status: string,
  error?: string,
  runtime: AgentSession["runtime"] = "vm",
): string | undefined {
  if (runtime === "host") return undefined;
  if (runtime === "docker") {
    if (status === "booting") return DOCKER_BOOT_NOTE;
    if (status === "running") return DOCKER_READY_NOTE;
    if (status === "error") return error || "Container entered an error state.";
    return undefined;
  }
  if (status === "installing") return VM_INSTALL_NOTE;
  if (status === "booting") return VM_BOOT_NOTE;
  if (status === "running") return VM_READY_NOTE;
  if (status === "error") return error || "Guest entered an error state.";
  return undefined;
}
