/**
 * `reviewOnMention`: a reply in a thread of the reviewer's channel that it isn't watching, tagging
 * it with a review request or a PR link, reviews that PR in the thread. Only Socket Mode message
 * events say such a reply exists (`conversations.history` doesn't list thread replies), so this
 * runs on the events the service collected, one `conversations.replies` call per tagged reply.
 */
import {
  isSlackMentionReviewAsk,
  slackMentionPulls,
  slackPostStopped,
  slackReviewerQuestion,
  slackReviewerRequesterAllowed,
  type LocusConfig,
  type SlackMessage,
  type SlackReviewer,
} from "@locus/shared";
import type { SlackReviewerContext } from "./reviewerDeps.js";
import { reviewerStateFor, type StateFile } from "./reviewerState.js";
import { canonicalPullUrl, isHumanReply, reviewerMentionIds } from "./reviewerHelpers.js";

/** A thread reply Socket Mode reported. */
export interface MentionPoke {
  channelId: string;
  threadTs: string;
  ts: string;
  /** The event's text, when it carried one: replies with no mention of the reviewer are skipped unread. */
  text?: string;
}

/** Replies already looked at, so an edit or a second event for the same reply doesn't ask again. */
export const MAX_HANDLED_MENTIONS = 500;

export const MENTION_NO_PR_REPLY =
  ":mag: I couldn't find a pull request link in this thread. Tag me with one: `review <PR link>`.";

/**
 * Queue a review for each tagged reply in `pokes` that asks this reviewer for one, in a thread of
 * its channel it doesn't watch. Watched threads are left to `scanThreads`. `handled` is the
 * service's memory of replies already read (`channel:ts`).
 */
export async function scanMentions(
  ctx: SlackReviewerContext,
  reviewer: SlackReviewer,
  state: StateFile,
  config: LocusConfig,
  pokes: Iterable<MentionPoke>,
  handled: Set<string>,
): Promise<void> {
  if (!reviewer.reviewOnMention || !reviewer.channelId) return;
  const mentionIds = reviewerMentionIds(config, reviewer);
  if (!mentionIds.length) return;
  const rs = reviewerStateFor(state, reviewer);
  for (const poke of pokes) {
    if (poke.channelId !== reviewer.channelId || poke.threadTs === poke.ts) continue;
    const key = `${reviewer.id}:${poke.channelId}:${poke.ts}`;
    if (handled.has(key)) continue;
    // Watched: re-review, questions and dismissals there are `scanThreads`'s.
    if (Object.values(rs.threads ?? {}).some((thread) => thread.ts === poke.threadTs)) continue;
    if (poke.text !== undefined && !slackReviewerQuestion(poke.text, mentionIds)) continue;
    let rows: SlackMessage[];
    try {
      rows = await ctx.deps.slack.replies(reviewer.channelId, poke.threadTs);
    } catch (err) {
      if (ctx.noteSlackError(err)) throw err;
      continue; // Deleted thread or a blip: the event is gone, so is this request.
    }
    const request = rows.find((message) => message.ts === poke.ts);
    if (!request) continue;
    remember(handled, key);
    if (!isHumanReply(request) || ctx.ownPosts.has(request.ts)) continue;
    // Spends tokens like a posted link: only listed people may ask.
    if (!slackReviewerRequesterAllowed(reviewer, request.userId)) continue;
    if (!isSlackMentionReviewAsk(request.text, mentionIds)) continue;
    const root = rows.find((message) => message.ts === poke.threadTs);
    if (reviewer.reactions && root && slackPostStopped(reviewer.reactionMap, root.reactions)) {
      continue;
    }
    const { pulls, text } = slackMentionPulls(rows, poke.threadTs, request);
    if (!pulls.length) {
      await ctx.deps.slack
        .post(reviewer.channelId, MENTION_NO_PR_REPLY, poke.threadTs, undefined, reviewer.postAs)
        .catch(() => undefined);
      continue;
    }
    for (const pr of pulls) {
      void ctx.enqueue({
        reviewer,
        pr,
        url: canonicalPullUrl(pr, text),
        channelId: reviewer.channelId,
        messageTs: poke.threadTs,
        requestTs: request.ts,
      });
    }
  }
}

function remember(handled: Set<string>, key: string): void {
  handled.add(key);
  if (handled.size > MAX_HANDLED_MENTIONS) handled.delete(handled.values().next().value!);
}
