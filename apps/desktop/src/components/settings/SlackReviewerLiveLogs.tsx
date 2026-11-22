import { useCallback, useEffect, useRef, useState } from "react";
import {
  SLACK_REVIEWER_API_LOG_MAX,
  type SlackReviewerApiLogEntry,
  type SlackReviewerApiPhase,
} from "@locus/shared";
import { api } from "@/lib/api";
import { InlineError } from "@/components/layout/Skeleton";

/** How often new calls are fetched while the log is open and not paused. */
const LOG_POLL_MS = 2_000;

const PHASE_LABEL: Record<SlackReviewerApiPhase, string> = {
  channel: "Channel poll",
  threads: "Thread poll",
  autoReview: "Auto-review poll",
  review: "Review",
};

type PhaseFilter = SlackReviewerApiPhase | "all" | "polls";

/**
 * Settings → Reviewers → Live logs: every Slack and forge call the reviewers make (channel
 * polls, thread polls, `autoReview` PR listing, and the calls a review makes), newest first, with
 * the redacted request and response. Fetches only while open.
 */
export function SlackReviewerLiveLogs(props: { reviewerName: (id: string) => string | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="slack-reviewer-runs-head">
        <h3>Live logs</h3>
        <button
          type="button"
          className="btn small ghost"
          data-testid="slack-reviewer-logs-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open ? (
        <SlackReviewerLiveLogsPanel reviewerName={props.reviewerName} />
      ) : (
        <p className="hint">
          The Slack and forge API calls the reviewers make while polling and reviewing, with what
          each returned.
        </p>
      )}
    </>
  );
}

function SlackReviewerLiveLogsPanel(props: { reviewerName: (id: string) => string | undefined }) {
  const [entries, setEntries] = useState<SlackReviewerApiLogEntry[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const lastSeq = useRef(0);

  const load = useCallback(async () => {
    try {
      const result = await api.slackReviewerLogs(lastSeq.current);
      // The server restarted: its sequence began again, so start over.
      if (result.lastSeq < lastSeq.current) {
        lastSeq.current = 0;
        setEntries([]);
        return;
      }
      lastSeq.current = result.lastSeq;
      if (result.entries.length)
        setEntries((rows) => [...rows, ...result.entries].slice(-SLACK_REVIEWER_API_LOG_MAX));
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => void load(), LOG_POLL_MS);
    return () => window.clearInterval(timer);
  }, [paused, load]);

  const shown = entries
    .filter((row) =>
      phase === "all" ? true : phase === "polls" ? row.phase !== "review" : row.phase === phase,
    )
    .filter((row) => !errorsOnly || !row.ok)
    .reverse();
  const failed = entries.filter((row) => !row.ok).length;

  return (
    <div className="slack-reviewer-logs" data-testid="slack-reviewer-logs">
      <div className="slack-reviewer-logs-bar">
        <select
          aria-label="Which calls"
          value={phase}
          onChange={(event) => setPhase(event.target.value as PhaseFilter)}
          data-testid="slack-reviewer-logs-phase"
        >
          <option value="all">All calls</option>
          <option value="polls">Polls only</option>
          <option value="channel">{PHASE_LABEL.channel}</option>
          <option value="threads">{PHASE_LABEL.threads}</option>
          <option value="autoReview">{PHASE_LABEL.autoReview}</option>
          <option value="review">Reviews</option>
        </select>
        <label className="slack-reviewer-logs-check">
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(event) => setErrorsOnly(event.target.checked)}
          />
          Errors only{failed ? ` (${failed})` : ""}
        </label>
        <span className={`slack-reviewer-logs-live${paused ? " paused" : ""}`} aria-live="polite">
          {paused ? "Paused" : "Live"}
        </span>
        <button
          type="button"
          className="btn small ghost"
          data-testid="slack-reviewer-logs-pause"
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="btn small ghost"
          data-testid="slack-reviewer-logs-clear"
          onClick={() => setEntries([])}
        >
          Clear
        </button>
      </div>
      {error ? <InlineError message={error} onRetry={() => void load()} /> : null}
      {shown.length === 0 ? (
        <p className="hint" data-testid="slack-reviewer-logs-empty">
          {entries.length
            ? "No calls match this filter."
            : "No calls yet. Channels are polled about every 20 seconds, threads every minute, and auto-review repos every 5 minutes."}
        </p>
      ) : (
        <ol className="slack-reviewer-logs-list" data-testid="slack-reviewer-logs-list">
          {shown.map((row) => (
            <LogRow
              key={row.seq}
              row={row}
              reviewerName={props.reviewerName(row.reviewerId ?? "")}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function LogRow(props: { row: SlackReviewerApiLogEntry; reviewerName?: string }) {
  const { row } = props;
  const t = Date.parse(row.at);
  return (
    <li className={`slack-reviewer-log${row.ok ? "" : " failed"}`} data-testid="slack-reviewer-log">
      <details>
        <summary>
          <time dateTime={row.at} title={new Date(t).toLocaleString()}>
            {new Date(t).toLocaleTimeString()}
          </time>
          <span className={`slack-reviewer-outcome ${row.ok ? "clean" : "failed"}`}>
            {row.ok ? "OK" : "Error"}
          </span>
          <span className="slack-reviewer-log-phase">{PHASE_LABEL[row.phase]}</span>
          <code className="slack-reviewer-log-call">
            {row.service}.{row.method}
          </code>
          {row.endpoint ? <span className="meta">{row.endpoint}</span> : null}
          <span className="slack-reviewer-log-summary">{row.summary}</span>
          <span className="meta">
            {[props.reviewerName, `${row.durationMs.toLocaleString("en-US")} ms`]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </summary>
        <div className="slack-reviewer-log-body">
          <p className="slack-reviewer-log-label">Request</p>
          <pre>{row.request}</pre>
          {row.response !== undefined ? (
            <>
              <p className="slack-reviewer-log-label">Response</p>
              <pre>{row.response}</pre>
            </>
          ) : (
            <>
              <p className="slack-reviewer-log-label">Error</p>
              <pre>{row.summary}</pre>
            </>
          )}
          {row.truncated ? (
            <p className="hint">Long values were trimmed. Credentials are never shown.</p>
          ) : null}
        </div>
      </details>
    </li>
  );
}
