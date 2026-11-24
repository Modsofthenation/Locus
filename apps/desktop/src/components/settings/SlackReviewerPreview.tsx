import { useState } from "react";
import {
  applySlackEmoji,
  formatSlackReviewFindings,
  formatSlackReviewUsage,
  renderSlackReviewerStatus,
  reviewPlural,
  slackMrkdwnToMarkdown,
  slackReviewOutcomeReaction,
  slackReviewOutcomesFor,
  type SlackReviewer,
  type SlackReviewOutcome,
} from "@locus/shared";
import { formatMarkdown } from "@/lib/markdown";

/** Sample PR the preview reviews. Real messages carry each review's own values. */
export const SLACK_PREVIEW_PR = {
  url: "https://github.com/acme/api/pull/482",
  label: "acme/api#482",
};

const OUTCOME_CHIPS: Record<SlackReviewOutcome, string> = {
  commented: "Left comments",
  approved: "Approved",
  changesRequested: "Changes requested",
  clean: "No issues",
  skipped: "Skipped",
  failed: "Failed",
  answered: "Answered",
};

/** Values for every template placeholder, as one sample review would fill them. */
export function slackPreviewVars(
  outcome: SlackReviewOutcome,
  model: { model: string; provider: string },
  opts: { cloneRepo?: boolean } = {},
): Record<string, string> {
  const comments = outcome === "changesRequested" ? 2 : outcome === "commented" ? 3 : 0;
  const summary =
    outcome === "changesRequested"
      ? "The refresh endpoint skips the session check, so a revoked token can still mint new ones."
      : outcome === "commented"
        ? "Token refresh can race with logout; two smaller notes on retries."
        : "Small, well-scoped change with tests.";
  return {
    title: "Refresh tokens on 401",
    author: "alice",
    sha: "3f9c2ab",
    model: model.model,
    provider: model.provider,
    files: "6 files (2 generated/lockfile skipped)",
    tokens: "9,840",
    checkout: opts.cloneRepo ? ", with the repo checked out to check callers and tests" : "",
    comments: reviewPlural(comments, "comment"),
    summary,
    // A first review has no earlier findings; the preview shows the plain reply.
    progress: "",
    findings: formatSlackReviewFindings(
      [
        {
          path: "src/auth/refresh.ts",
          line: 42,
          severity: "major" as const,
          body: "Refresh runs after logout clears the session, so it can mint a token for a signed-out user.",
        },
        {
          path: "src/http/retry.ts",
          line: 18,
          severity: "minor" as const,
          body: "Retries 401s with no backoff.",
        },
        {
          path: "src/http/retry.ts",
          line: 31,
          severity: "nit" as const,
          body: "Name the retry limit.",
        },
      ]
        .slice(0, comments)
        .map((row, i) => ({ ...row, id: i + 1 })),
    ),
    ahead: "1 review",
    dismissed: "#2 (`src/http/retry.ts:18`)",
    part: "2 of 4",
    usage: formatSlackReviewUsage({
      model: model.model,
      inputTokens: 10_240,
      outputTokens: 640,
      cachedInputTokens: 3_100,
      usd: 0.05,
      elapsedMs: 21_000,
      ...(opts.cloneRepo ? { lookups: 14 } : {}),
    }),
    reason: outcome === "failed" ? "the model call failed (429 rate limited)" : "it is a draft",
  };
}

/** Slack mrkdwn as the Slack pane renders it: links, *bold*, _italic_, `code`, :emoji:. */
export function slackPreviewHtml(text: string): string {
  return applySlackEmoji(formatMarkdown(slackMrkdwnToMarkdown(text)));
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

function PreviewMessage(props: {
  name: string;
  time: string;
  text: string;
  hue: number;
  avatarUrl?: string;
  you?: boolean;
  app?: boolean;
  reactions?: string[];
  testId?: string;
}) {
  return (
    <article className={`slack-msg${props.you ? " you" : ""}`} data-testid={props.testId}>
      <span
        className="slack-avatar"
        style={{ background: `hsl(${props.hue} 28% 28%)` }}
        aria-hidden
      >
        {props.avatarUrl ? <img src={props.avatarUrl} alt="" /> : initials(props.name)}
      </span>
      <div className="slack-msg-body">
        <div className="slack-msg-meta">
          <strong className="slack-msg-name">{props.name}</strong>
          {props.app ? <span className="slack-reviewer-app-chip">App</span> : null}
          <time>{props.time}</time>
        </div>
        <div
          className="slack-md pr-md"
          dangerouslySetInnerHTML={{ __html: slackPreviewHtml(props.text) }}
        />
        {props.reactions?.length ? (
          <div className="slack-reactions">
            {props.reactions.map((name) => (
              <span key={name} className="slack-reaction" title={`:${name}:`}>
                <span dangerouslySetInnerHTML={{ __html: applySlackEmoji(`:${name}:`) }} />1
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/**
 * A mock Slack thread showing exactly what this reviewer posts for one outcome: the request,
 * the "started" reply, and the final reply, with this reviewer's templates, identity, and
 * reactions. Text goes through the same renderer as the Slack pane.
 */
export function SlackReviewerPreview(props: {
  reviewer: SlackReviewer;
  model: { model: string; provider: string };
  /** Signed-in Slack user, for "post as me". */
  me?: { name?: string; avatarUrl?: string };
}) {
  const { reviewer } = props;
  const outcomes = slackReviewOutcomesFor(reviewer.forgeMode);
  const [outcome, setOutcome] = useState<SlackReviewOutcome>("commented");
  // Switching to comment-only hides Approved / Changes requested; fall back without an effect.
  const shown = (outcomes.includes(outcome) ? outcome : "commented") as Exclude<
    SlackReviewOutcome,
    "answered"
  >;
  // Final messages start with an @-mention of the author when the sample author is mapped.
  const mention =
    reviewer.mentionAuthor &&
    reviewer.authorSlackIds.alice &&
    shown !== "skipped" &&
    shown !== "failed"
      ? "*@alice* "
      : "";
  const vars = slackPreviewVars(shown, props.model, { cloneRepo: reviewer.cloneRepo });
  // Skips are decided before the review starts, so they post no "started" line.
  const replies: Array<{ key: string; text: string }> = [
    ...(shown === "skipped"
      ? []
      : [
          {
            key: "started",
            text: renderSlackReviewerStatus(reviewer.status.started, SLACK_PREVIEW_PR, vars),
          },
        ]),
    {
      key: shown,
      text: `${mention}${renderSlackReviewerStatus(reviewer.status[shown], SLACK_PREVIEW_PR, vars)}`,
    },
  ];
  const asMe = reviewer.postAs === "user";
  const replyName = asMe ? props.me?.name || "You" : "Locus";
  const finalReaction = slackReviewOutcomeReaction(shown, reviewer.reactionMap);
  // Skips post nothing on the PR post; anything that started shows the pickup mark too.
  const pickup = shown === "skipped" ? "" : reviewer.reactionMap.pickup;
  const shownReactions = [pickup, finalReaction].filter((row): row is string => Boolean(row));
  const reactions = reviewer.reactions && shownReactions.length ? shownReactions : undefined;

  return (
    <div
      className="slack-reviewer-slack-preview"
      data-testid={`slack-reviewer-preview-${reviewer.id}`}
    >
      <div className="slack-reviewer-preview-head">
        <h4 className="slack-reviewer-section">Slack preview</h4>
        <div className="slack-reviewer-preview-chips" role="group" aria-label="Preview outcome">
          {outcomes.map((row) => (
            <button
              key={row}
              type="button"
              className={`btn small ghost${row === shown ? " on" : ""}`}
              aria-pressed={row === shown}
              data-testid={`slack-reviewer-preview-outcome-${row}`}
              onClick={() => setOutcome(row)}
            >
              {OUTCOME_CHIPS[row]}
            </button>
          ))}
        </div>
      </div>
      <div className="slack-reviewer-thread" aria-label="Slack thread preview">
        <PreviewMessage
          name="alice"
          time="10:02 AM"
          hue={200}
          text={`can someone take a look? ${SLACK_PREVIEW_PR.url}`}
          reactions={reactions}
          testId="slack-reviewer-preview-request"
        />
        <div className="slack-reviewer-thread-divider">
          <span>
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </span>
        </div>
        {replies.map((reply, i) => (
          <PreviewMessage
            key={reply.key}
            name={replyName}
            time={i === 0 ? "10:02 AM" : "10:03 AM"}
            hue={asMe ? 28 : 265}
            avatarUrl={asMe ? props.me?.avatarUrl : undefined}
            you={asMe}
            app={!asMe}
            text={reply.text}
            testId={`slack-reviewer-preview-reply-${reply.key}`}
          />
        ))}
      </div>
      <p className="hint">
        Sample PR and numbers. Real replies carry each review&apos;s model, files, findings, and
        usage.
        {reviewer.reactions ? " Reactions use your Slack account." : ""}
      </p>
    </div>
  );
}
