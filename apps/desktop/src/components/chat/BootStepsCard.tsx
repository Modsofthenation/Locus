import { useEffect, useState } from "react";
import {
  bootProgressTitle,
  bootStepMeta,
  formatBootDuration,
  type BootProgress,
  type BootStep,
} from "@locus/shared";
import {
  IconContainer,
  IconTaskBurst,
  IconTaskCancelled,
  IconTaskDone,
} from "@/components/layout/Icons";

function StepIcon({ state }: { state: BootStep["state"] }) {
  if (state === "done") return <IconTaskDone />;
  if (state === "error") return <IconTaskCancelled />;
  return <IconTaskBurst />;
}

function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  return now;
}

/** Guest boot step list shown in place of the generic "Waiting for the guest…" spinner. */
export function BootStepsCard({
  progress,
  onRetry,
}: {
  progress: BootProgress;
  onRetry?: () => void;
}) {
  const live = !progress.done && !progress.error;
  const now = useNow(live);
  const title = bootProgressTitle(progress);
  const steps = progress.steps.filter((step) => step.state !== "skipped");
  const failed = steps.find((step) => step.state === "error");
  const total = live ? formatBootDuration(now - progress.startedAt) : "";
  return (
    <div
      className="clone-card boot-steps"
      data-testid="boot-steps"
      data-failed={failed ? "true" : undefined}
      role="status"
      aria-live="polite"
      aria-label={title}
    >
      <div className="clone-card-head">
        <span className="clone-card-icon" aria-hidden>
          <IconContainer />
        </span>
        <span className="clone-card-title">{title}</span>
        {total ? <span className="boot-step-time">{total}</span> : null}
      </div>
      <ul>
        {steps.map((step) => {
          const meta = bootStepMeta(step, now);
          return (
            <li
              key={step.id}
              data-state={step.state}
              data-testid={`boot-step-${step.id}`}
              aria-current={step.state === "active" ? "step" : undefined}
            >
              <span className="boot-step-icon" aria-hidden>
                <StepIcon state={step.state} />
              </span>
              <span className="boot-step-label">{step.label}</span>
              {meta ? <span className="boot-step-time">{meta}</span> : null}
            </li>
          );
        })}
      </ul>
      {failed?.error ? (
        <div className="clone-card-phase" data-testid="boot-step-error">
          {failed.error}
        </div>
      ) : null}
      {failed && onRetry ? (
        <button
          type="button"
          className="btn small boot-steps-retry"
          data-testid="boot-steps-retry"
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
