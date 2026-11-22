import { useCallback, useEffect, useState } from "react";
import {
  summarizeSlackReviewTrace,
  type SlackReviewTrace,
  type SlackReviewTraceStep,
} from "@locus/shared";
import { api } from "@/lib/api";
import { InlineError } from "@/components/layout/Skeleton";

/** How often a live trace (run still going) is fetched again. */
const LIVE_POLL_MS = 2_000;

/**
 * Toggle that shows a reviewer run's trace under its row: the prompt, the model's reasoning, each
 * tool call with its arguments and output, and the reply. Hidden for runs with no trace (runs
 * from before traces were kept, or still queued).
 */
export function SlackReviewTraceToggle(props: { traceId?: string }) {
  const [open, setOpen] = useState(false);
  if (!props.traceId) return null;
  return (
    <>
      <button
        type="button"
        className="btn small ghost slack-reviewer-trace-toggle"
        data-testid="slack-reviewer-trace-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide trace" : "Trace"}
      </button>
      {open ? <SlackReviewTraceView traceId={props.traceId} /> : null}
    </>
  );
}

export function SlackReviewTraceView(props: { traceId: string }) {
  const [trace, setTrace] = useState<SlackReviewTrace | undefined>();
  const [error, setError] = useState<string | undefined>();
  const load = useCallback(async () => {
    try {
      setTrace(await api.slackReviewerTrace(props.traceId));
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [props.traceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = trace?.live === true;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  if (error) {
    return (
      <div className="slack-reviewer-trace" data-testid="slack-reviewer-trace">
        <InlineError message={error} onRetry={() => void load()} />
      </div>
    );
  }
  if (!trace) {
    return (
      <div className="slack-reviewer-trace" data-testid="slack-reviewer-trace">
        <p className="hint">Loading trace…</p>
      </div>
    );
  }
  const counts = summarizeSlackReviewTrace(trace);
  return (
    <div className="slack-reviewer-trace" data-testid="slack-reviewer-trace">
      <p className="slack-reviewer-trace-summary">
        {[
          trace.model,
          `${counts.tools} tool call${counts.tools === 1 ? "" : "s"}`,
          counts.refused ? `${counts.refused} refused` : undefined,
          counts.thinking ? "with reasoning" : "no reasoning streamed",
          live ? "live" : undefined,
          trace.truncated ? "trimmed to fit" : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {trace.steps.length === 0 ? (
        <p className="hint">Nothing traced yet.</p>
      ) : (
        <ol className="slack-reviewer-trace-steps">
          {trace.steps.map((step, i) => (
            <TraceStep key={i} step={step} />
          ))}
        </ol>
      )}
      {!counts.thinking && !live ? (
        <p className="hint">
          This provider didn&apos;t stream its reasoning; the tool calls and reply are still shown.
        </p>
      ) : null}
    </div>
  );
}

function TraceStep(props: { step: SlackReviewTraceStep }) {
  const { step } = props;
  const time = new Date(step.at).toLocaleTimeString();
  switch (step.kind) {
    case "prompt":
      return (
        <li className="slack-reviewer-trace-step prompt">
          <details>
            <summary>
              <span className="label">Prompt</span>
              <span className="meta">
                {step.text.length.toLocaleString("en-US")} chars · {time}
              </span>
            </summary>
            <pre>{step.text}</pre>
          </details>
        </li>
      );
    case "thinking":
      return (
        <li
          className="slack-reviewer-trace-step thinking"
          data-testid="slack-reviewer-trace-thinking"
        >
          <details open>
            <summary>
              <span className="label">Thinking</span>
              <span className="meta">{time}</span>
            </summary>
            <pre>{step.text}</pre>
          </details>
        </li>
      );
    case "text":
      return (
        <li className="slack-reviewer-trace-step text">
          <details>
            <summary>
              <span className="label">Reply</span>
              <span className="meta">{time}</span>
            </summary>
            <pre>{step.text}</pre>
          </details>
        </li>
      );
    case "tool":
      return (
        <li
          className={`slack-reviewer-trace-step tool${step.refused ? " refused" : ""}`}
          data-testid="slack-reviewer-trace-tool"
        >
          <details>
            <summary>
              <span className="label">{step.tool}</span>
              {step.args ? <code className="args">{step.args}</code> : null}
              <span className="meta">
                {step.refused ? "refused · " : step.output === undefined ? "running · " : ""}
                {time}
              </span>
            </summary>
            {step.output !== undefined ? <pre>{step.output || "(empty)"}</pre> : null}
          </details>
        </li>
      );
    case "note":
      return (
        <li className="slack-reviewer-trace-step note">
          <span className="label">{step.text}</span>
          <span className="meta">{time}</span>
        </li>
      );
  }
}
