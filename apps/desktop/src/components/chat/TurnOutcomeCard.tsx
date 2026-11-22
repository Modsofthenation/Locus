import { verdictLabel, verdictTone } from "@/lib/riskGate";
import { useState } from "react";
import {
  formatTurnDuration,
  turnOutcomeHeadline,
  turnTestsLabel,
  type TurnOutcome,
} from "@/lib/turnOutcome";
import { PatchStackCard } from "./PatchStackCard";

const FILES_SHOWN = 5;

/**
 * Summary under the last reply of a finished turn: what changed, whether tests
 * passed, what it cost, and the next step (review, merge a worktree, open the PR,
 * continue, or undo the turn).
 */
export function TurnOutcomeCard({
  sessionId,
  outcome,
  onOpenPath,
  onContinue,
  onUndo,
  usageText,
  onMerge,
  mergeLabel = "Merge",
}: {
  sessionId: string;
  outcome: TurnOutcome;
  /** Tokens and cost for the turn, formatted like the composer's usage line. */
  usageText?: string;
  /** Worktree agents in a parallel group: merge this branch into the base checkout. */
  onMerge?: () => Promise<void>;
  mergeLabel?: string;
  onOpenPath: (path: string, line?: number) => void;
  onContinue: () => void;
  onUndo?: (checkpointId: string) => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string>();
  const meta = [usageText, formatTurnDuration(outcome.durationMs)].filter(Boolean).join(" · ");

  async function merge() {
    if (!onMerge) return;
    setMerging(true);
    setMergeError(undefined);
    try {
      await onMerge();
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : String(err));
    } finally {
      setMerging(false);
    }
  }
  const tests = turnTestsLabel(outcome.tests);
  const shown = outcome.files.slice(0, FILES_SHOWN);
  const more = outcome.files.length - shown.length;
  const canReview = outcome.patches.length > 0 || outcome.files.length > 0;

  function review() {
    if (outcome.patches.length) {
      setReviewing((open) => !open);
      return;
    }
    const first = outcome.files[0];
    if (first) onOpenPath(first.path);
  }

  return (
    <section className="turn-outcome" data-testid="turn-outcome" aria-label="Turn summary">
      <header className="turn-outcome-head">
        <span className="turn-outcome-title">{turnOutcomeHeadline(outcome)}</span>
        {tests ? (
          <span
            className={`turn-outcome-tests ${tests.ok ? "ok" : "failed"}`}
            data-testid="turn-outcome-tests"
          >
            {tests.ok ? "✓" : "✕"} {tests.text}
          </span>
        ) : null}
        {outcome.verdict ? (
          <span
            className={`turn-outcome-tests ${verdictTone(outcome.verdict) === "ok" ? "ok" : "failed"}`}
            data-testid="turn-outcome-verdict"
            title={outcome.verdict.reasons.join("\n") || undefined}
          >
            {verdictLabel(outcome.verdict)}
          </span>
        ) : null}
        {outcome.commands ? (
          <span className="turn-outcome-meta">
            {outcome.commands === 1 ? "1 command" : `${outcome.commands} commands`}
          </span>
        ) : null}
        {meta ? (
          <span className="turn-outcome-meta turn-outcome-usage" data-testid="turn-outcome-usage">
            {meta}
          </span>
        ) : null}
      </header>
      {shown.length ? (
        <ul className="turn-outcome-files">
          {shown.map((file) => (
            <li key={file.path}>
              <button type="button" className="link" onClick={() => onOpenPath(file.path)}>
                {file.path}
              </button>
              {file.additions || file.deletions ? (
                <span className="turn-outcome-stat">
                  <span className="add">+{file.additions}</span>{" "}
                  <span className="del">−{file.deletions}</span>
                </span>
              ) : null}
            </li>
          ))}
          {more > 0 ? <li className="turn-outcome-more">+{more} more</li> : null}
        </ul>
      ) : null}
      <div className="turn-outcome-actions">
        {canReview ? (
          <button
            type="button"
            className="btn small primary"
            aria-expanded={outcome.patches.length ? reviewing : undefined}
            onClick={review}
          >
            {reviewing ? "Hide changes" : "Review changes"}
          </button>
        ) : null}
        {onMerge ? (
          <button
            type="button"
            className="btn small"
            disabled={merging}
            title="Commit this agent's work and merge its branch into the base checkout"
            onClick={() => void merge()}
          >
            {merging ? "Merging…" : mergeLabel}
          </button>
        ) : null}
        {outcome.prUrl ? (
          <a className="btn small" href={outcome.prUrl} target="_blank" rel="noreferrer">
            Open PR
          </a>
        ) : null}
        <button type="button" className="btn small" onClick={onContinue}>
          Continue
        </button>
        {outcome.undoCheckpointId && onUndo ? (
          <button
            type="button"
            className="btn small ghost"
            title="Restore the chat and workspace to before this turn"
            onClick={() => onUndo(outcome.undoCheckpointId!)}
          >
            Undo this turn
          </button>
        ) : null}
      </div>
      {mergeError ? (
        <p className="turn-outcome-error" role="alert">
          {mergeError}
        </p>
      ) : null}
      {reviewing && outcome.patches.length ? (
        <PatchStackCard
          files={outcome.patches}
          meta={{ repoId: sessionId, number: 1, headSha: outcome.assistantId }}
          onOpenPath={onOpenPath}
        />
      ) : null}
    </section>
  );
}
