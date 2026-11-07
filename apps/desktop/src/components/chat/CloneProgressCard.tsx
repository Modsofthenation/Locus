import {
  CLONE_WAIT_HINT,
  IMAGE_BUILD_WAIT_HINT,
  formatCloneProgressPhase,
  formatImageBuildPhase,
  type CloneProgress,
  type ImageBuildProgress,
} from "@locus/shared";
import type { ReactNode } from "react";
import { IconContainer, IconRepo } from "@/components/layout/Icons";

function ProgressCard({
  title,
  percent,
  done,
  phase,
  waitHint,
  icon,
  testId,
}: {
  title: string;
  percent: number;
  done?: boolean;
  phase: string;
  waitHint: string;
  icon: ReactNode;
  testId: string;
}) {
  const pct = Math.min(100, Math.max(0, percent));
  const indeterminate = pct === 0 && !done;
  const waiting = !done;
  return (
    <div
      className="clone-card"
      data-testid={testId}
      data-done={done ? "true" : undefined}
      data-waiting={waiting ? "true" : undefined}
      role="status"
      aria-label={`${title}. ${phase}. ${waiting ? waitHint : ""} ${pct}%`.trim()}
    >
      <div className="clone-card-head">
        <span className="clone-card-icon" aria-hidden>
          {icon}
        </span>
        <span className="clone-card-title">{title}</span>
        <span className="clone-card-pct">{indeterminate ? "…" : `${pct}%`}</span>
      </div>
      <div
        className={`clone-card-bar${indeterminate ? " is-wait" : ""}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : pct}
      >
        <span style={indeterminate ? undefined : { width: `${pct}%` }} />
      </div>
      <div className="clone-card-phase">{phase}</div>
      {waiting ? <div className="clone-card-wait">{waitHint}</div> : null}
    </div>
  );
}

export function CloneProgressCard({
  progress,
  title,
  waitHint = CLONE_WAIT_HINT,
}: {
  progress: CloneProgress;
  title: string;
  waitHint?: string;
}) {
  return (
    <ProgressCard
      title={title}
      percent={progress.percent}
      done={progress.done}
      phase={formatCloneProgressPhase(progress)}
      waitHint={waitHint}
      icon={<IconRepo />}
      testId="clone-progress"
    />
  );
}

export function ImageBuildCard({
  progress,
  title,
}: {
  progress: ImageBuildProgress;
  title: string;
}) {
  return (
    <ProgressCard
      title={title}
      percent={progress.percent}
      done={progress.done}
      phase={formatImageBuildPhase(progress)}
      waitHint={IMAGE_BUILD_WAIT_HINT}
      icon={<IconContainer />}
      testId="image-build-progress"
    />
  );
}
