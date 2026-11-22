import {
  SLACK_REVIEW_SEVERITIES,
  type AiProvider,
  type SlackReviewer,
  type SlackReviewerStats,
} from "@locus/shared";
import { ModelPicker } from "./ModelPicker";
import { SettingsToggleRow } from "./SettingsBits";

type Patch = Partial<SlackReviewer> | ((row: SlackReviewer) => SlackReviewer);

function percent(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function usd(value: number): string {
  return `$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`;
}

/**
 * Behaviour → "Double-check blocker and major findings": the `verifyFindings` switch, and an
 * optional second-opinion model for the check (empty uses the review's model).
 */
export function SlackReviewerVerifyFields(props: {
  reviewer: SlackReviewer;
  providers: AiProvider[];
  /** The review runs on a CLI agent, whose own costs the picker can't show. */
  cli?: boolean;
  onPatch: (patch: Patch) => void;
}) {
  const { reviewer, onPatch } = props;
  const pinned = Boolean(reviewer.verifyProviderId);
  return (
    <>
      <SettingsToggleRow
        label="Double-check blocker and major findings before posting"
        hint="One small extra call, only when a review has a blocker or major finding: each is checked against the code around its line, and dropped or downgraded when the code doesn't back it up. The verdict follows what's left, so a false major no longer requests changes. If the check fails, the findings are posted as they are."
        on={reviewer.verifyFindings}
        testId={`slack-reviewer-verify-${reviewer.id}`}
        onChange={(verifyFindings) => onPatch({ verifyFindings })}
      />
      {reviewer.verifyFindings ? (
        <SettingsToggleRow
          label="Use a different model for the check"
          hint={
            pinned
              ? "A second opinion: the check runs on the model below."
              : "Off: the check uses the review's own model."
          }
          on={pinned}
          testId={`slack-reviewer-verify-model-${reviewer.id}`}
          onChange={(next) => {
            if (!next) {
              onPatch((row) => {
                const { verifyProviderId: _p, verifyModel: _m, ...rest } = row;
                return rest;
              });
              return;
            }
            const start =
              props.providers.find((row) => row.id === reviewer.providerId) ?? props.providers[0];
            if (start) {
              onPatch({
                verifyProviderId: start.id,
                verifyModel:
                  start.id === reviewer.providerId && reviewer.model
                    ? reviewer.model
                    : start.defaultModel,
              });
            }
          }}
        />
      ) : null}
      {reviewer.verifyFindings && pinned ? (
        <ModelPicker
          providers={props.providers}
          providerId={reviewer.verifyProviderId ?? ""}
          model={reviewer.verifyModel ?? ""}
          showCosts={!props.cli}
          onChange={({ providerId, model }) =>
            onPatch({ verifyProviderId: providerId, verifyModel: model })
          }
        />
      ) : null}
    </>
  );
}

/** A reviewer's accuracy over the last 30 days: findings, precision per severity, dismissals, spend. */
export function SlackReviewerAccuracy(props: { reviewerId: string; stats?: SlackReviewerStats }) {
  const { stats } = props;
  const testId = `slack-reviewer-accuracy-${props.reviewerId}`;
  if (!stats || (!stats.reviews && !stats.postedTotal && !stats.answers && !stats.failed)) {
    return (
      <>
        <h4 className="slack-reviewer-section">Accuracy</h4>
        <p className="hint" data-testid={testId}>
          No reviews in the last 30 days yet. Findings posted, dismissals and spend show up here.
        </p>
      </>
    );
  }
  const severities = SLACK_REVIEW_SEVERITIES.filter((severity) => stats.posted[severity]);
  const dismissedTotal =
    stats.dismissed["false-positive"] + stats.dismissed["by-design"] + stats.dismissed["wont-fix"];
  return (
    <>
      <h4 className="slack-reviewer-section">Accuracy</h4>
      <div data-testid={testId}>
        <p className="hint">
          Last {stats.days} days: {stats.reviews} {stats.reviews === 1 ? "review" : "reviews"},{" "}
          {stats.postedTotal} {stats.postedTotal === 1 ? "finding" : "findings"} posted
          {stats.verified
            ? `, ${stats.verified} double-checked (${stats.rejected} dropped, ${stats.downgraded} downgraded)`
            : ""}
          . Resolve rate {percent(stats.resolveRate)}
          {stats.usdPerWeek !== undefined ? ` · ${usd(stats.usdPerWeek)} / week` : ""}
          {stats.votes.up || stats.votes.down
            ? ` · 👍 ${stats.votes.up} · 👎 ${stats.votes.down}`
            : ""}
          .
        </p>
        {severities.length ? (
          <table className="model-cost-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th className="num">Posted</th>
                <th className="num">False positives</th>
                <th className="num">Precision</th>
              </tr>
            </thead>
            <tbody>
              {severities.map((severity) => (
                <tr key={severity}>
                  <td>{severity}</td>
                  <td className="num">{stats.posted[severity] ?? 0}</td>
                  <td className="num">{stats.falsePositives[severity] ?? 0}</td>
                  <td className="num">{percent(stats.precision[severity])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <p className="hint">
          Dismissed:{" "}
          {dismissedTotal
            ? `${stats.dismissed["false-positive"]} false positive, ${stats.dismissed["by-design"]} by design, ${stats.dismissed["wont-fix"]} won't fix`
            : "none"}
          . Precision is 1 − false-positive dismissals ÷ findings posted, so a wrong finding nobody
          dismissed still counts as right.
        </p>
      </div>
    </>
  );
}
