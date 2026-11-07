import { isReviewProgressTool } from "./verdict.js";

/** Workspace-search rounds before we tell a reviewer to call git_pr_get. */
export const REVIEW_ROUTING_SEARCH_ROUNDS = 2;
export const MAX_REVIEW_ROUTING_NUDGES = 2;

export const REVIEW_ROUTING_NUDGE =
  'This is a PR review. The user message already has comments, the load path, and the change stack. Call git_pr_get include=["files"] (locus MCP on Cursor CLI) before grepping the clone. Listing MCP tools is not enough. Do not load ship-it or rewrite the branch. Finish with git_pr_review and the JSON verdict.';

export function shouldNudgeReviewRouting(obs: {
  isReview: boolean;
  calledReview: boolean;
  searchRounds: number;
  nudges: number;
  planTurn?: boolean;
  stopped?: boolean;
  applyThisTurn?: boolean;
  toolCallCount?: number;
}): boolean {
  if (!obs.isReview || obs.calledReview || obs.planTurn || obs.stopped) return false;
  if (obs.nudges >= MAX_REVIEW_ROUTING_NUDGES) return false;
  const searchedWithoutReview = obs.searchRounds >= REVIEW_ROUTING_SEARCH_ROUNDS;
  const finishingWithoutInspect = Boolean(obs.applyThisTurn);
  return searchedWithoutReview || finishingWithoutInspect;
}

export function calledReviewProgress(names: string[]): boolean {
  return names.some((name) => isReviewProgressTool(name));
}
